import { promises as fs } from "node:fs";
import { extname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { TranscriptionProvider, type ProviderCapabilities } from "../provider.js";
import { TranscriptJson, TranscriptionOptions } from "../types.js";
import {
  acceptProviderToken,
  jsonField,
  ProviderError,
  ProviderHttpError,
  ProviderRefusalError,
  type ProviderRefusalKind,
} from "../errors.js";
import { fetchWithTimeout, isAbortError } from "../../utils/fetch.js";

const DEFAULT_MAX_AUDIO_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MODEL = "nova-3";
const PROVIDER = "Deepgram";

export function getDeepgramCapabilities(
  maxAudioBytesOverride?: number
): ProviderCapabilities {
  return {
    maxAudioBytes: maxAudioBytesOverride ?? DEFAULT_MAX_AUDIO_BYTES,
    supportsDiarization: true,
  };
}

type DeepgramUtterance = {
  start?: number;
  end?: number;
  speaker?: number;
  transcript?: string;
};

type DeepgramAlternative = {
  transcript?: string;
};

type DeepgramChannel = {
  alternatives?: DeepgramAlternative[];
};

type DeepgramResults = {
  utterances?: DeepgramUtterance[];
  channels?: DeepgramChannel[];
  detected_language?: string;
};

type DeepgramResponse = {
  results?: DeepgramResults;
  metadata?: Record<string, unknown>;
};

/**
 * /v1/listen answers synchronously, so an HTTP error status means the audio was
 * not accepted as work. Documented shapes (developers.deepgram.com/docs/errors):
 * 401 INVALID_AUTH / INSUFFICIENT_PERMISSIONS, 403 INSUFFICIENT_PERMISSIONS
 * (project lacks access to the model) and 402 ASR_PAYMENT_REQUIRED (no credits).
 * 429, 5xx and everything else stay unclassified on purpose.
 */
export function classifyDeepgramRefusal(status: number): ProviderRefusalKind | undefined {
  if (status === 401 || status === 403) return "rejected";
  if (status === 402) return "exhausted";
  return undefined;
}

function normalizeDeepgramLanguage(code?: string): string | undefined {
  if (!code) return undefined;
  const trimmed = code.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/_/g, "-");
}

function utterancesToTranscript(utterances: DeepgramUtterance[] | undefined) {
  if (!utterances || utterances.length === 0) return [];
  return utterances.map((u) => ({
    speaker: u.speaker,
    start: typeof u.start === "number" ? Math.round(u.start * 1000) : undefined,
    end: typeof u.end === "number" ? Math.round(u.end * 1000) : undefined,
    text: u.transcript?.trim(),
  }));
}

function pickContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".mp4":
      return "audio/mp4";
    case ".webm":
      return "audio/webm";
    case ".flac":
      return "audio/flac";
    case ".ogg":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}

export class DeepgramProvider implements TranscriptionProvider {
  name: "deepgram" = "deepgram";
  private maxAudioBytesOverride?: number;
  private timeoutMs?: number;

  constructor(
    private apiKey: string,
    private model = DEFAULT_MODEL,
    private diarization = true,
    maxAudioBytesOverride?: number,
    timeoutMs?: number
  ) {
    this.maxAudioBytesOverride = maxAudioBytesOverride;
    this.timeoutMs = timeoutMs;
  }

  getCapabilities(): ProviderCapabilities {
    return getDeepgramCapabilities(this.maxAudioBytesOverride);
  }

  async transcribe(audioPath: string, opts: TranscriptionOptions): Promise<TranscriptJson> {
    const timeoutMs = opts.providerTimeoutMs ?? this.timeoutMs;
    const buffer = await fs.readFile(audioPath);
    const fileName = basename(audioPath);
    const contentType = pickContentType(audioPath);

    const params = new URLSearchParams();
    params.set("model", this.model || DEFAULT_MODEL);
    params.set("diarize", this.diarization ? "true" : "false");
    params.set("utterances", "true");
    params.set("punctuate", "true");
    params.set("smart_format", "true");

    const manualLanguage = normalizeDeepgramLanguage(opts.languageCode);
    const useAutoLanguage = opts.languageDetection === true || !manualLanguage;
    if (useAutoLanguage) {
      params.set("detect_language", "true");
    } else if (manualLanguage) {
      params.set("language", manualLanguage);
    }

    const url = `https://api.deepgram.com/v1/listen?${params.toString()}`;

    // Checked outside the request block so that a local cancellation or a
    // revoked key is never reported as a provider failure.
    if (opts.abortSignal?.aborted) throw new Error("Transcription cancelled locally");
    opts.beforeRequest?.();
    let res: Response;
    try {
      res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          signal: opts.abortSignal,
          headers: {
            Authorization: `Token ${this.apiKey}`,
            "Content-Type": contentType,
          },
          body: buffer,
        },
        timeoutMs
      );
    } catch (error) {
      if (opts.abortSignal?.aborted) throw new Error("Transcription cancelled locally");
      throw new ProviderError({ provider: PROVIDER, category: isAbortError(error) ? "timeout" : "network" });
    }

    if (!res.ok) {
      // The body is read only to pick one machine code; none of its text is kept.
      const token = acceptProviderToken(jsonField(await res.text().catch(() => ""), ["err_code"]), [this.apiKey]);
      const kind = classifyDeepgramRefusal(res.status);
      if (kind) throw new ProviderRefusalError({ provider: "deepgram", kind, status: res.status }, PROVIDER, token);
      throw new ProviderHttpError(PROVIDER, res.status, { token });
    }

    let data: DeepgramResponse;
    try {
      data = (await res.json()) as DeepgramResponse;
    } catch {
      // The request was accepted; an unreadable answer is never a refusal.
      throw new ProviderError({ provider: PROVIDER, category: "invalid-response", status: res.status });
    }
    const results = data.results ?? {};
    const utterances = utterancesToTranscript(results.utterances);
    const transcript =
      results.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ??
      utterances.map((u) => u.text ?? "").join(" ").trim();

    const providerRequestId =
      typeof data.metadata?.request_id === "string" ? data.metadata.request_id : null;
    return {
      id: providerRequestId ?? `deepgram-${randomUUID()}`,
      provider_transcript_id: providerRequestId,
      status: "completed",
      text: transcript.length > 0 ? transcript : undefined,
      utterances,
      language_code: results.detected_language ?? manualLanguage,
      provider: "deepgram",
      provider_metadata: data.metadata,
      sourceFile: fileName,
    };
  }
}
