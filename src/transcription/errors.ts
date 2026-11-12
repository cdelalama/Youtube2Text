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

const REFUSAL_REASON: Record<ProviderRefusalKind, string> = {
  rejected: "key or permission rejected",
  exhausted: "no credit or quota left",
};

/**
 * Its message is built from fixed codes only: the adapter's own prefix with the
 * HTTP status, plus the reason. It never carries the provider's response text,
 * which can echo part of the key (some providers answer an invalid key with its
 * first and last characters).
 */
export class ProviderRefusalError extends Error {
  name = "ProviderRefusalError";
  constructor(public refusal: DefinitiveRefusal, prefix: string) {
    super(`${prefix}: ${REFUSAL_REASON[refusal.kind]}`);
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

const MIN_SECRET_FRAGMENT = 4;

/**
 * Provider text kept in an error message. Besides the whole secret, every run
 * of four or more consecutive characters of a secret is redacted, so a masked
 * echo such as "sk-ab...wxyz" cannot expose the first or last characters of a
 * key. Unrelated text that happens to share such a run is redacted too; that is
 * accepted. Everything else in the provider body still passes through, cut to
 * `maxLen` characters.
 */
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
  const truncated = out.length > maxLen;
  if (truncated) out = out.slice(0, maxLen);
  for (const secret of secrets) {
    if (!secret || secret.length < 2 * MIN_SECRET_FRAGMENT) continue;
    out = redactFragments(out, secret);
  }
  return truncated ? `${out}...` : out;
}

function redactFragments(text: string, secret: string): string {
  let out = "";
  for (let index = 0; index < text.length; ) {
    let length = 0;
    while (
      index + length < text.length &&
      secret.includes(text.slice(index, index + length + 1))
    ) {
      length += 1;
    }
    if (length >= MIN_SECRET_FRAGMENT) {
      out += "[redacted]";
      index += length;
    } else {
      out += text[index];
      index += 1;
    }
  }
  return out;
}
