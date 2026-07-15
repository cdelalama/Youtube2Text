import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  const length = Math.max(a.length, b.length, 1);
  const paddedA = Buffer.alloc(length);
  const paddedB = Buffer.alloc(length);
  a.copy(paddedA);
  b.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB) && a.length === b.length;
}

export function validateIntakeAuthConfig(): void {
  const key = process.env.Y2T_INTAKE_API_KEY?.trim();
  if (key && key.length < 32) {
    throw new Error("Y2T_INTAKE_API_KEY must be at least 32 characters");
  }
}

export function hasValidIntakeKey(req: IncomingMessage): boolean {
  const expected = process.env.Y2T_INTAKE_API_KEY?.trim();
  if (!expected) return false;
  const actual = req.headers["x-media2text-intake-key"];
  if (typeof actual !== "string" || actual.length > 1024) return false;
  return constantTimeEqual(actual.trim(), expected);
}
