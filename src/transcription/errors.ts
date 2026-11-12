import type { SttProviderId } from "../config/schema.js";
import { logWarn } from "../utils/logger.js";

// Disclosure rule for every error that comes from a speech-to-text provider
// (D-029): the text that leaves this module (thrown messages, and through them
// logs, run records, events, API responses and status) is built ONLY from parts
// owned by this code base: the provider name chosen here, the HTTP status, a
// category chosen by the code, an optional label taken from the fixed lists
// below, and an optional fixed note written here. No string supplied by a
// provider is ever kept or repeated, in any form, because a provider can echo a
// key in its answer, whole or in separated fragments. Upstream job identifiers
// follow the same rule: they stay inside the adapter that needs them.

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

// Provider error codes this code base recognises. They only make a message
// easier to read; no routing decision is taken from a label. Deepgram: the
// err_code values of developers.deepgram.com/docs/errors. OpenAI: the codes and
// types of developers.openai.com/api/docs/guides/error-codes, plus
// invalid_api_key and rate_limit_exceeded, which that guide does not list.
export const DEEPGRAM_ERROR_LABELS = [
  "INVALID_AUTH",
  "INSUFFICIENT_PERMISSIONS",
  "ASR_PAYMENT_REQUIRED",
  "PROJECT_NOT_FOUND",
  "INVALID_QUERY_PARAMETER",
  "PAYLOAD_ERROR",
  "REMOTE_CONTENT_ERROR",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "ASR_UNPROCESSABLE_ENTITY",
  "UNPROCESSABLE_ENTITY",
  "TOO_MANY_REQUESTS",
] as const;
export const OPENAI_ERROR_LABELS = [
  "invalid_api_key",
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "rate_limit_exceeded",
  "rate_limit_error",
  "slow_down",
  "invalid_request_error",
  "service_unavailable_error",
  "server_is_overloaded",
] as const;
/** The provider sent a code, but not one of the recognised ones. */
export const OTHER_LABEL = "other";
export type ProviderErrorLabel =
  | (typeof DEEPGRAM_ERROR_LABELS)[number]
  | (typeof OPENAI_ERROR_LABELS)[number]
  | typeof OTHER_LABEL;

/**
 * Turns what a provider sent as its error code into a label owned by this code
 * base. The result is the first candidate that equals an entry of `known`
 * (the entry itself, a constant of this file), "other" when the provider sent
 * something else, and nothing when it sent no code. The provider's own string
 * is never returned, so nothing it writes can reach an outward message.
 */
export function fixedLabel<T extends ProviderErrorLabel>(
  known: readonly T[],
  ...candidates: unknown[]
): T | typeof OTHER_LABEL | undefined {
  let sent = false;
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    sent = true;
    const label = known.find((entry) => entry === candidate);
    if (label !== undefined) return label;
  }
  return sent ? OTHER_LABEL : undefined;
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
  /** A constant of this file (see fixedLabel); never a provider string. */
  label?: ProviderErrorLabel;
  /** Fixed wording written in this code base; never provider text. */
  note?: string;
};

function providerErrorText(parts: ProviderErrorParts): string {
  return (
    `${parts.provider} error: ${parts.category}` +
    (parts.status === undefined ? "" : ` (HTTP ${parts.status})`) +
    (parts.label ? ` [${parts.label}]` : "") +
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
  readonly label?: ProviderErrorLabel;
  constructor(parts: ProviderErrorParts) {
    super(providerErrorText(parts));
    this.provider = parts.provider;
    this.category = parts.category;
    this.status = parts.status;
    this.label = parts.label;
  }
}

/** An HTTP error status from a provider. */
export class ProviderHttpError extends ProviderError {
  name = "ProviderHttpError";
  declare readonly status: number;
  constructor(provider: string, status: number, options: { category?: ProviderErrorCategory; label?: ProviderErrorLabel } = {}) {
    super({ provider, status, category: options.category ?? categoryForStatus(status), label: options.label });
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
  constructor(public refusal: DefinitiveRefusal, provider: string, label?: ProviderErrorLabel) {
    super({
      provider,
      status: refusal.status,
      category: refusal.kind === "exhausted" ? "payment-or-quota" : "authentication",
      label,
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
