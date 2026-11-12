import type { SttProviderId } from "../config/schema.js";
import { logWarn } from "../utils/logger.js";

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

/**
 * Stops an AssemblyAI run on credit wording, as it always did. It is NOT a
 * definitive refusal: its status/wording match is undocumented, so it never
 * moves work to another key or account.
 */
export class InsufficientCreditsError extends Error {
  name = "InsufficientCreditsError";
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
