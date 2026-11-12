import { retry } from "../../utils/retry.js";
import { setTimeout as delay } from "node:timers/promises";
import { logStep } from "../../utils/logger.js";
import { TranscriptJson, TranscriptionOptions } from "../types.js";
import {
  InsufficientCreditsError,
  ProviderHttpError,
  ProviderRefusalError,
  type DefinitiveRefusal,
} from "../errors.js";
import { requestJson, uploadFile } from "./http.js";
import { buildCreateTranscriptRequestBody } from "./request.js";

type CreateResponse = { id: string; status: string };

export class AssemblyAiClient {
  constructor(
    private apiKey: string,
    private timeoutMs?: number,
    private retryBaseDelayMs = 2000
  ) {}

  async getAccount(): Promise<Record<string, unknown>> {
    return await requestJson<Record<string, unknown>>(
      this.apiKey,
      "/account",
      { method: "GET" },
      this.timeoutMs
    );
  }

  async uploadAudio(audioPath: string, timeoutMs?: number, signal?: AbortSignal, beforeRequest?: () => void): Promise<string> {
    const data = await uploadFile(this.apiKey, audioPath, timeoutMs ?? this.timeoutMs, signal, beforeRequest);
    return data.upload_url;
  }

  async createTranscript(
    audioUrl: string,
    options: Pick<
      TranscriptionOptions,
      "languageCode" | "languageDetection" | "languageConfidenceThreshold"
    >,
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<CreateResponse> {
    return await requestJson<CreateResponse>(this.apiKey, "/transcript", {
      method: "POST",
      signal,
      body: JSON.stringify({
        ...buildCreateTranscriptRequestBody({
          audioUrl,
          languageCode: options.languageCode,
          languageDetection: options.languageDetection,
          languageConfidenceThreshold: options.languageConfidenceThreshold,
        }),
      }),
    }, timeoutMs ?? this.timeoutMs);
  }

  async getTranscript(id: string, timeoutMs?: number, signal?: AbortSignal): Promise<TranscriptJson> {
    return await requestJson<TranscriptJson>(
      this.apiKey,
      `/transcript/${id}`,
      {
      method: "GET",
      signal,
      },
      timeoutMs ?? this.timeoutMs
    );
  }

  async transcribe(
    audioPath: string,
    opts: TranscriptionOptions
  ): Promise<TranscriptJson> {
    const timeoutMs = opts.providerTimeoutMs ?? this.timeoutMs;
    const guard = () => { opts.abortSignal?.throwIfAborted(); opts.beforeRequest?.(); };
    const retryOptions = {
      retries: opts.retries,
      baseDelayMs: this.retryBaseDelayMs,
      maxDelayMs: Math.max(this.retryBaseDelayMs, 20000),
      shouldRetry: shouldRetryAssemblyAiRequest,
    };

    logStep("upload", `Uploading to AssemblyAI: ${audioPath}`);
    let created: CreateResponse;
    try {
      const uploadUrl = await retry(
        () => { guard(); return this.uploadAudio(audioPath, timeoutMs, opts.abortSignal, guard); },
        retryOptions
      );

      // A timed-out create response may still have created billable work.
      guard();
      created = await this.createTranscript(uploadUrl, {
        languageCode: opts.languageCode,
        languageDetection: opts.languageDetection,
        languageConfidenceThreshold: opts.languageConfidenceThreshold,
      }, timeoutMs, opts.abortSignal);
    } catch (error) {
      // Work is accepted only when the create call answers 2xx. Everything
      // after this block is post-acceptance and is never classified.
      throw asSubmissionRefusal(error);
    }
    const deadline = Date.now() + opts.maxPollMinutes * 60 * 1000;

    logStep("transcribe", `Transcription started: ${created.id}`);

    while (Date.now() < deadline) {
      const current = await retry(
        () => { guard(); return this.getTranscript(created.id, timeoutMs, opts.abortSignal); },
        retryOptions
      );
      if (current.status === "completed") return current;
      if (current.status === "error") {
        throw new Error(`Transcription error: ${JSON.stringify(current)}`);
      }
      await delay(opts.pollIntervalMs, undefined, { signal: opts.abortSignal });
    }

    throw new Error(
      `Transcription timed out after ${opts.maxPollMinutes} minutes; upstream job ${created.id} was not recreated`
    );
  }
}

/**
 * Classifies a failed upload or create call. Documented shapes
 * (assemblyai.com/docs/errors and the pre-recorded common-errors guide): HTTP 401
 * "Authentication error, API token missing/invalid" and HTTP 400 "Your current
 * account balance is negative..." on POST /v2/transcript. HTTP 402 and the older
 * credit wordings already recognised by this adapter are undocumented for this
 * API and are accepted only with a 400/402 status. AssemblyAI documents 403 as a
 * request-rate limit, so it is deliberately not a refusal. Timeouts, network
 * failures, 429 and 5xx stay unclassified.
 */
export function classifyAssemblyAiSubmissionRefusal(error: unknown): DefinitiveRefusal | undefined {
  if (error instanceof ProviderHttpError) {
    if (error.status === 401) return { provider: "assemblyai", kind: "rejected", status: 401 };
    if (error.status === 400 && /account balance is negative/i.test(error.message)) {
      return { provider: "assemblyai", kind: "exhausted", status: 400 };
    }
    return undefined;
  }
  if (error instanceof InsufficientCreditsError && (error.status === 400 || error.status === 402)) {
    return { provider: "assemblyai", kind: "exhausted", status: error.status };
  }
  return undefined;
}

function asSubmissionRefusal(error: unknown): unknown {
  const refusal = classifyAssemblyAiSubmissionRefusal(error);
  if (!refusal) return error;
  if (error instanceof InsufficientCreditsError) {
    error.refusal = refusal;
    return error;
  }
  return new ProviderRefusalError(refusal, (error as Error).message);
}

export function shouldRetryAssemblyAiRequest(error: unknown): boolean {
  if (error instanceof InsufficientCreditsError) return false;
  if (error instanceof ProviderHttpError) {
    return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("timed out") || message.includes("network") || message.includes("fetch failed");
}
