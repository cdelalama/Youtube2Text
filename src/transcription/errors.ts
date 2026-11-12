import type { SttProviderId } from "../config/schema.js";
import { logWarn } from "../utils/logger.js";

// Disclosure rule for every error that comes from a speech-to-text provider
// (D-029): the text that leaves this module (thrown messages, and through them
// logs, run records, events, API responses and status) is built from fixed
// parts only. Those parts are the provider name chosen here, the HTTP status, a
// category chosen by the code, an optional fixed note written here, and AT MOST
// one machine token supplied by the provider. No free provider text is ever
// kept, because a provider can echo part of a key in its answer.

export type ProviderErrorCategory =
  | "authentication"
  | "payment-or-quota"
  | "rate-limit"
  | "server-error"
  | "invalid-request"
  | "invalid-response"
  | "timeout"
  | "network"
  | "transcription-failed"
  | "unclassified";

const TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;
const KEY_RUN = 4;

/**
 * Accepts one provider-supplied machine token (an error code or type, or a job
 * identifier) only when it is a short plain identifier and shares no run of
 * four or more consecutive characters with a key in use. A key shorter than
 * four characters is compared whole. Anything else is dropped.
 */
export function acceptProviderToken(candidate: unknown, secrets: string[]): string | undefined {
  if (typeof candidate !== "string" || !TOKEN.test(candidate)) return undefined;
  const token = candidate.toLowerCase();
  for (const raw of secrets) {
    const secret = (raw ?? "").toLowerCase();
    if (!secret) continue;
    const run = Math.min(KEY_RUN, secret.length);
    for (let start = 0; start + run <= secret.length; start += 1) {
      if (token.includes(secret.slice(start, start + run))) return undefined;
    }
  }
  return candidate;
}

/** Category for an HTTP error status when the adapter has no better knowledge. */
export function categoryForStatus(status: number): ProviderErrorCategory {
  if (status === 401 || status === 403) return "authentication";
  if (status === 402) return "payment-or-quota";
  if (status === 408) return "timeout";
  if (status === 429) return "rate-limit";
  if (status >= 500) return "server-error";
  if (status >= 400) return "invalid-request";
  return "unclassified";
}

export type ProviderErrorParts = {
  /** Fixed label chosen by the adapter, for example "Deepgram". */
  provider: string;
  category: ProviderErrorCategory;
  status?: number;
  /** Already passed through acceptProviderToken. */
  token?: string;
  /** Fixed wording written in this code base; never provider text. */
  note?: string;
};

function providerErrorText(parts: ProviderErrorParts): string {
  return (
    `${parts.provider} error: ${parts.category}` +
    (parts.status === undefined ? "" : ` (HTTP ${parts.status})`) +
    (parts.token ? ` [${parts.token}]` : "") +
    (parts.note ? `; ${parts.note}` : "")
  );
}

/**
 * Every failure of a provider request. What the pipeline needs to decide is in
 * typed fields; the message repeats only those fixed parts.
 */
export class ProviderError extends Error {
  name = "ProviderError";
  readonly provider: string;
  readonly category: ProviderErrorCategory;
  readonly status?: number;
  readonly token?: string;
  constructor(parts: ProviderErrorParts) {
    super(providerErrorText(parts));
    this.provider = parts.provider;
    this.category = parts.category;
    this.status = parts.status;
    this.token = parts.token;
  }
}

/** An HTTP error status from a provider. */
export class ProviderHttpError extends ProviderError {
  name = "ProviderHttpError";
  declare readonly status: number;
  constructor(provider: string, status: number, options: { category?: ProviderErrorCategory; token?: string } = {}) {
    super({ provider, status, category: options.category ?? categoryForStatus(status), token: options.token });
  }
}

/**
 * Stops an AssemblyAI run on credit wording, as it always did. It is NOT a
 * definitive refusal: its status/wording match is undocumented, so it never
 * moves work to another key or account.
 */
export class InsufficientCreditsError extends ProviderError {
  name = "InsufficientCreditsError";
  constructor(provider: string, status?: number) {
    super({ provider, status, category: "payment-or-quota" });
  }
}

export type ProviderRefusalKind = "rejected" | "exhausted";

/**
 * A definitive refusal answered by the provider BEFORE it accepted the audio as
 * work: authentication/permission refused ("rejected") or payment/quota refused
 * ("exhausted"). It is the only signal that may move work to another key or
 * account (D-029). Timeouts, network failures, 5xx, rate limits and every
 * failure after acceptance never carry it, because the provider may still bill.
 */
export type DefinitiveRefusal = {
  provider: SttProviderId;
  kind: ProviderRefusalKind;
  status: number;
};

export class ProviderRefusalError extends ProviderError {
  name = "ProviderRefusalError";
  constructor(public refusal: DefinitiveRefusal, provider: string, token?: string) {
    super({
      provider,
      status: refusal.status,
      category: refusal.kind === "exhausted" ? "payment-or-quota" : "authentication",
      token,
    });
  }
}

export function definitiveRefusalOf(error: unknown): DefinitiveRefusal | undefined {
  return error instanceof ProviderRefusalError ? error.refusal : undefined;
}

/**
 * A 4xx answer that looks like a refusal but matches no shape documented by the
 * provider. The job fails as it always did; only the status code is logged here
 * (never the body), so the operator can see why the work did not move.
 */
export function logUnclassifiedRefusal(provider: string, status: number): void {
  logWarn(
    `${provider} answered HTTP ${status}, which is not a documented definitive refusal; ` +
      "the work is not moved to another key or account."
  );
}

/** Reads one field of a JSON body, or nothing. Never throws. */
export function jsonField(body: string, path: string[]): unknown {
  try {
    let value: unknown = JSON.parse(body);
    for (const key of path) {
      if (!value || typeof value !== "object") return undefined;
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  } catch {
    return undefined;
  }
}
