import type { SttProviderId } from "../config/schema.js";

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

export class InsufficientCreditsError extends Error {
  name = "InsufficientCreditsError";
  /** Set only by an adapter that knows the request was refused before acceptance. */
  refusal?: DefinitiveRefusal;
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export class ProviderRefusalError extends Error {
  name = "ProviderRefusalError";
  constructor(public refusal: DefinitiveRefusal, message: string) {
    super(message);
  }
}

export function definitiveRefusalOf(error: unknown): DefinitiveRefusal | undefined {
  if (error instanceof ProviderRefusalError) return error.refusal;
  if (error instanceof InsufficientCreditsError) return error.refusal;
  return undefined;
}

export class ProviderHttpError extends Error {
  name = "ProviderHttpError";

  constructor(
    public provider: string,
    public status: number,
    message: string
  ) {
    super(`${provider} error ${status}: ${message}`);
  }
}

export function sanitizeProviderErrorText(
  text: string,
  secrets: string[] = [],
  maxLen = 200
): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join("[redacted]");
  }
  out = out.replace(/[\r\n\t]+/g, " ").trim();
  if (out.length > maxLen) {
    out = `${out.slice(0, maxLen)}...`;
  }
  return out;
}
