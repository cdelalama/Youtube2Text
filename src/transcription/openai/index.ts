import { promises as fs } from "node:fs";
import { basename } from "node:path";
import { TranscriptionProvider, type ProviderCapabilities } from "../provider.js";
import { TranscriptJson, TranscriptionOptions } from "../types.js";
import {
  fixedLabel,
  jsonField,
  logUnclassifiedRefusal,
  OPENAI_ERROR_LABELS,
  ProviderError,
  ProviderHttpError,
  ProviderRefusalError,
  type ProviderRefusalKind,
} from "../errors.js";
import { fetchWithTimeout, isAbortError } from "../../utils/fetch.js";

const DEFAULT_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const PROVIDER = "OpenAI Whisper";

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

// 429 codes the error-codes guide documents as billing, spend or quota refusals
// ("Retrying billing, spend, or quota errors won't restore API access").
const OPENAI_DOCUMENTED_QUOTA_CODES = new Set([
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
]);
const OPENAI_UNSUPPORTED_REGION = /country, region, or territory not supported/i;

/**
 * /v1/audio/transcriptions answers synchronously, so an HTTP error status means
 * the audio was not accepted as work. Only shapes documented in
 * developers.openai.com/api/docs/guides/error-codes are definitive: every 401
 * (invalid authentication), the 403 "Country, region, or territory not
 * supported", and a 429 whose body carries error.type "insufficient_quota" or a
 * documented quota error.code. Everything else is unclassified on purpose: a
 * 402 (OpenAI documents none), any other 403, a plain 429 rate limit, 5xx.
 */
export function classifyOpenAiRefusal(status: number, body: string): ProviderRefusalKind | undefined {
  if (status === 401) return "rejected";
  if (status === 403) return OPENAI_UNSUPPORTED_REGION.test(body) ? "rejected" : undefined;
  if (status !== 429) return undefined;
  try {
    const error = (JSON.parse(body) as { error?: { type?: unknown; code?: unknown } }).error;
    const type = typeof error?.type === "string" ? error.type : "";
    const code = typeof error?.code === "string" ? error.code : "";
    return type === "insufficient_quota" || OPENAI_DOCUMENTED_QUOTA_CODES.has(code) ? "exhausted" : undefined;
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

    // Checked outside the request block so that a local cancellation or a
    // revoked key is never reported as a provider failure.
    if (opts.abortSignal?.aborted) throw new Error("Transcription cancelled locally");
    opts.beforeRequest?.();
    let res: Response;
    try {
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
      throw new ProviderError({ provider: PROVIDER, category: isAbortError(error) ? "timeout" : "network" });
    }

    if (!res.ok) {
      // The body is read only to classify and to recognise its code; nothing the provider wrote is kept.
      const text = await res.text().catch(() => "");
      const label = fixedLabel(OPENAI_ERROR_LABELS, jsonField(text, ["error", "code"]), jsonField(text, ["error", "type"]));
      const kind = classifyOpenAiRefusal(res.status, text);
      if (kind) {
        throw new ProviderRefusalError({ provider: "openai_whisper", kind, status: res.status }, PROVIDER, label);
      }
      if (res.status === 402 || res.status === 403) logUnclassifiedRefusal("OpenAI", res.status);
      throw new ProviderHttpError(PROVIDER, res.status, { label });
    }

    let data: OpenAiWhisperResponse;
    try {
      data = (await res.json()) as OpenAiWhisperResponse;
    } catch {
      // The request was accepted; an unreadable answer is never a refusal.
      throw new ProviderError({ provider: PROVIDER, category: "invalid-response", status: res.status });
    }
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
