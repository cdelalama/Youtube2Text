import { retry } from "../../utils/retry.js";
import { logStep } from "../../utils/logger.js";
import { TranscriptJson, TranscriptionOptions } from "../types.js";
import { InsufficientCreditsError, ProviderHttpError } from "../errors.js";
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

  async uploadAudio(audioPath: string, timeoutMs?: number): Promise<string> {
    const data = await uploadFile(this.apiKey, audioPath, timeoutMs ?? this.timeoutMs);
    return data.upload_url;
  }

  async createTranscript(
    audioUrl: string,
    options: Pick<
      TranscriptionOptions,
      "languageCode" | "languageDetection" | "languageConfidenceThreshold"
    >,
    timeoutMs?: number
  ): Promise<CreateResponse> {
    return await requestJson<CreateResponse>(this.apiKey, "/transcript", {
      method: "POST",
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

  async getTranscript(id: string, timeoutMs?: number): Promise<TranscriptJson> {
    return await requestJson<TranscriptJson>(
      this.apiKey,
      `/transcript/${id}`,
      {
      method: "GET",
      },
      timeoutMs ?? this.timeoutMs
    );
  }

  async transcribe(
    audioPath: string,
    opts: TranscriptionOptions
  ): Promise<TranscriptJson> {
    const timeoutMs = opts.providerTimeoutMs ?? this.timeoutMs;
    const retryOptions = {
      retries: opts.retries,
      baseDelayMs: this.retryBaseDelayMs,
      maxDelayMs: Math.max(this.retryBaseDelayMs, 20000),
      shouldRetry: shouldRetryAssemblyAiRequest,
    };

    logStep("upload", `Uploading to AssemblyAI: ${audioPath}`);
    const uploadUrl = await retry(
      () => this.uploadAudio(audioPath, timeoutMs),
      retryOptions
    );

    // A timed-out create response may still have created billable work.
    const created = await this.createTranscript(uploadUrl, {
      languageCode: opts.languageCode,
      languageDetection: opts.languageDetection,
      languageConfidenceThreshold: opts.languageConfidenceThreshold,
    }, timeoutMs);
    const deadline = Date.now() + opts.maxPollMinutes * 60 * 1000;

    logStep("transcribe", `Transcription started: ${created.id}`);

    while (Date.now() < deadline) {
      const current = await retry(
        () => this.getTranscript(created.id, timeoutMs),
        retryOptions
      );
      if (current.status === "completed") return current;
      if (current.status === "error") {
        throw new Error(`Transcription error: ${JSON.stringify(current)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, opts.pollIntervalMs));
    }

    throw new Error(
      `Transcription timed out after ${opts.maxPollMinutes} minutes; upstream job ${created.id} was not recreated`
    );
  }
}

export function shouldRetryAssemblyAiRequest(error: unknown): boolean {
  if (error instanceof InsufficientCreditsError) return false;
  if (error instanceof ProviderHttpError) {
    return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("timed out") || message.includes("network") || message.includes("fetch failed");
}
