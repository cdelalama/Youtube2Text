export class InsufficientCreditsError extends Error {
  name = "InsufficientCreditsError";
  constructor(message: string) {
    super(message);
  }
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
