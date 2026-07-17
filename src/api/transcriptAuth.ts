import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const MIN_KEY_LENGTH = 32;
const MAX_KEY_LENGTH = 2048;

function configuredKey(): string | undefined {
  const key = process.env.Y2T_CORTEX_TRANSCRIPT_READ_KEY?.trim();
  return key || undefined;
}

export function validateTranscriptReaderAuthConfig(): void {
  const key = configuredKey();
  if (key && (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH)) {
    throw new Error(
      `Y2T_CORTEX_TRANSCRIPT_READ_KEY must contain ${MIN_KEY_LENGTH}-${MAX_KEY_LENGTH} characters`
    );
  }
  if (
    key &&
    [process.env.Y2T_API_KEY, process.env.Y2T_INTAKE_API_KEY]
      .map((value) => value?.trim())
      .some((value) => value === key)
  ) {
    throw new Error(
      "Y2T_CORTEX_TRANSCRIPT_READ_KEY must differ from operator and intake credentials"
    );
  }
}

export function hasValidTranscriptReaderKey(req: IncomingMessage): boolean {
  const expected = configuredKey();
  const authorization = req.headers.authorization;
  if (!expected || typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return false;
  }
  const actual = authorization.slice("Bearer ".length).trim();
  if (!actual || actual.length > MAX_KEY_LENGTH) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
