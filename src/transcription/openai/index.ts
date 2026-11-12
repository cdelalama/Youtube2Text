import { promises as fs } from "node:fs";
import { basename } from "node:path";
import { TranscriptionProvider, type ProviderCapabilities } from "../provider.js";
import { TranscriptJson, TranscriptionOptions } from "../types.js";
import { ProviderRefusalError, sanitizeProviderErrorText, type ProviderRefusalKind } from "../errors.js";
import { fetchWithTimeout, isAbortError } from "../../utils/fetch.js";

const DEFAULT_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export function getOpenAiWhisperCapabilities(
  maxAudioBytesOverride?: number
): ProviderCapabilities {
  return {
    maxAudioBytes: maxAudioBytesOverride ?? DEFAULT_MAX_AUDIO_BYTES,
    supportsDiarization: false,
  };
}

type OpenAiSegment = {
  start?: number;
  end?: number;
  text?: string;
};

type OpenAiWhisperResponse = {
  text?: string;
  language?: string;
  segments?: OpenAiSegment[];
};

const OPENAI_BILLING_CODES = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "billing_hard_limit_reached",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
]);

/**
 * /v1/audio/transcriptions answers synchronously, so an HTTP error status means
 * the audio was not accepted as work. Documented shapes
 * (developers.openai.com/api/docs/guides/error-codes): 401 invalid
 * authentication, 403 unsupported country/region, and 429 billing refusals whose
 * body carries error.type "insufficient_quota" or a billing error.code. A plain
 * 429 rate limit, 5xx and everything else stay unclassified on purpose. 402 is
 * not documented by OpenAI; it is treated as a payment refusal by HTTP meaning.
 */
export function classifyOpenAiRefusal(status: number, body: string): ProviderRefusalKind | undefined {
  if (status === 401 || status === 403) return "rejected";
  if (status === 402) return "exhausted";
  if (status !== 429) return undefined;
  try {
    const error = (JSON.parse(body) as { error?: { type?: unknown; code?: unknown } }).error;
    const type = typeof error?.type === "string" ? error.type : "";
    const code = typeof error?.code === "string" ? error.code : "";
    return type === "insufficient_quota" || OPENAI_BILLING_CODES.has(code) ? "exhausted" : undefined;
  } catch {
    return undefined;
  }
}

function normalizeOpenAiLanguage(code?: string): string | undefined {
  if (!code) return undefined;
  const trimmed = code.trim().toLowerCase();
  if (!trimmed) return undefined;
  const primary = trimmed.split(/[-_]/)[0];
  return primary || undefined;
}

function segmentsToUtterances(segments: OpenAiSegment[] | undefined) {
  if (!segments || segments.length === 0) return [];
  return segments.map((segment) => ({
    start: typeof segment.start === "number" ? Math.round(segment.start * 1000) : undefined,
    end: typeof segment.end === "number" ? Math.round(segment.end * 1000) : undefined,
    text: segment.text?.trim(),
  }));
}

export class OpenAiWhisperProvider implements TranscriptionProvider {
  name: "openai_whisper" = "openai_whisper";
  private maxAudioBytesOverride?: number;
  private timeoutMs?: number;

  constructor(
    private apiKey: string,
    private model: string,
    maxAudioBytesOverride?: number,
    timeoutMs?: number
  ) {
    this.maxAudioBytesOverride = maxAudioBytesOverride;
    this.timeoutMs = timeoutMs;
  }

  getCapabilities(): ProviderCapabilities {
    return getOpenAiWhisperCapabilities(this.maxAudioBytesOverride);
  }

  async transcribe(audioPath: string, opts: TranscriptionOptions): Promise<TranscriptJson> {
    const timeoutMs = opts.providerTimeoutMs ?? this.timeoutMs;
    const buffer = await fs.readFile(audioPath);
    const fileName = basename(audioPath);
    const file = new File([buffer], fileName);
    const form = new FormData();
    form.append("file", file);
    form.append("model", this.model);
    form.append("response_format", "verbose_json");

    const useAutoLanguage = opts.languageDetection === true || !opts.languageCode;
    if (!useAutoLanguage) {
      const normalized = normalizeOpenAiLanguage(opts.languageCode);
      if (normalized) {
        form.append("language", normalized);
      }
    }

    let res: Response;
    try {
      opts.abortSignal?.throwIfAborted();
      opts.beforeRequest?.();
      res = await fetchWithTimeout("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        signal: opts.abortSignal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
      }, timeoutMs);
    } catch (error) {
      if (opts.abortSignal?.aborted) throw new Error("Transcription cancelled locally");
      if (isAbortError(error)) {
        throw new Error("OpenAI Whisper request timed out");
      }
      throw error;
    }

    if (!res.ok) {
      const text = await res.text();
      const safe = sanitizeProviderErrorText(text, [this.apiKey]);
      const message = `OpenAI Whisper API error (${res.status}): ${safe || res.statusText}`;
      const kind = classifyOpenAiRefusal(res.status, text);
      if (kind) {
        throw new ProviderRefusalError({ provider: "openai_whisper", kind, status: res.status }, message);
      }
      throw new Error(message);
    }

    const data = (await res.json()) as OpenAiWhisperResponse;
    const utterances = segmentsToUtterances(data.segments);
    const text =
      data.text?.trim() ||
      utterances.map((u) => u.text ?? "").join(" ").trim();

    return {
      id: `openai-${Date.now()}`,
      provider_transcript_id: null,
      status: "completed",
      text: text.length > 0 ? text : undefined,
      utterances,
      language_code: data.language ?? normalizeOpenAiLanguage(opts.languageCode),
      provider: "openai_whisper",
    };
  }
}
