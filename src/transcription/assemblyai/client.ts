import { retry } from "../../utils/retry.js";
import { setTimeout as delay } from "node:timers/promises";
import { logStep } from "../../utils/logger.js";
import { TranscriptJson, TranscriptionOptions } from "../types.js";
import {
  InsufficientCreditsError,
  logUnclassifiedRefusal,
  ProviderError,
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
    // Work is accepted only when the create call answers 2xx. Upload and create
    // are the two phases where a refusal can be definitive; everything after
    // them is post-acceptance and is never classified.
    let uploadUrl: string;
    try {
      uploadUrl = await retry(
        () => { guard(); return this.uploadAudio(audioPath, timeoutMs, opts.abortSignal, guard); },
        retryOptions
      );
    } catch (error) {
      throw asSubmissionRefusal(error, "upload");
    }
    let created: CreateResponse;
    try {
      // A timed-out create response may still have created billable work.
      guard();
      created = await this.createTranscript(uploadUrl, {
        languageCode: opts.languageCode,
        languageDetection: opts.languageDetection,
        languageConfidenceThreshold: opts.languageConfidenceThreshold,
      }, timeoutMs, opts.abortSignal);
    } catch (error) {
      throw asSubmissionRefusal(error, "create");
    }
    const deadline = Date.now() + opts.maxPollMinutes * 60 * 1000;

    // The job identifier comes from the provider. It is used only here, to poll
    // the job; it is never written to a log, an error, a run record or an event.
    logStep("transcribe", "Transcription started: AssemblyAI accepted the job");

    while (Date.now() < deadline) {
      const current = await retry(
        () => { guard(); return this.getTranscript(created.id, timeoutMs, opts.abortSignal); },
        retryOptions
      );
      if (current.status === "completed") return current;
      if (current.status === "error") {
        // The provider's own explanation is free text and is not kept.
        throw new ProviderError({ provider: "AssemblyAI", category: "transcription-failed",
          note: "the accepted job ended in error at the provider" });
      }
      await delay(opts.pollIntervalMs, undefined, { signal: opts.abortSignal });
    }

    throw new ProviderError({ provider: "AssemblyAI", category: "timeout",
      note: `polling gave up after ${opts.maxPollMinutes} minutes; the upstream job was not recreated` });
  }
}

/**
 * Classifies a failed upload or create call from its typed fields. Only shapes
 * AssemblyAI documents are definitive (assemblyai.com/docs/errors and the
 * pre-recorded common-errors guide): HTTP 401 in either phase, and the HTTP 400
 * negative-balance answer of POST /v2/transcript, which the HTTP layer marks as
 * payment-or-quota. Unclassified on purpose: 402 and this adapter's older
 * credit wordings (not documented for this API); 403, which is ambiguous
 * (documented both as no access to the resource and as a request volume
 * limit); 429, 5xx, timeouts and network failures.
 */
export function classifyAssemblyAiSubmissionRefusal(
  error: unknown,
  phase: "upload" | "create"
): DefinitiveRefusal | undefined {
  if (!(error instanceof ProviderHttpError)) return undefined;
  if (error.status === 401) return { provider: "assemblyai", kind: "rejected", status: 401 };
  if (phase === "create" && error.status === 400 && error.category === "payment-or-quota") {
    return { provider: "assemblyai", kind: "exhausted", status: 400 };
  }
  return undefined;
}

function asSubmissionRefusal(error: unknown, phase: "upload" | "create"): unknown {
  const refusal = classifyAssemblyAiSubmissionRefusal(error, phase);
  if (refusal) return new ProviderRefusalError(refusal, (error as ProviderHttpError).provider);
  if (error instanceof ProviderError && !(error instanceof ProviderRefusalError)) {
    const refusalLike = error.status === 402 || error.status === 403
      || (error.status === 400 && error.category === "payment-or-quota");
    if (refusalLike) logUnclassifiedRefusal("AssemblyAI", error.status!);
  }
  return error;
}

export function shouldRetryAssemblyAiRequest(error: unknown): boolean {
  if (error instanceof InsufficientCreditsError) return false;
  if (error instanceof ProviderError) {
    if (error.category === "timeout" || error.category === "network") return true;
    const status = error.status;
    return status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500);
  }
  // Errors that did not come from the HTTP layer (for example a stand-in used in tests).
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("timed out") || message.includes("network") || message.includes("fetch failed");
}
