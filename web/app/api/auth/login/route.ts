import { NextRequest, NextResponse } from "next/server";
import {
  issueWebSessionToken,
  isSameOriginRequest,
  verifyOperatorPassphrase,
  WEB_SESSION_COOKIE,
  webAuthConfigurationError,
  webSessionCookieOptions,
} from "../../../../lib/webAuth";

type AttemptState = { count: number; resetAt: number };

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_CLIENT_ATTEMPTS = 5;
const MAX_GLOBAL_ATTEMPTS = 100;
const MAX_TRACKED_CLIENTS = 2048;
const GLOBAL_KEY = "__global__";
const OVERFLOW_KEY = "__overflow__";

const globalAuth = globalThis as typeof globalThis & {
  m2tLoginAttempts?: Map<string, AttemptState>;
};
const attempts = globalAuth.m2tLoginAttempts ?? new Map<string, AttemptState>();
globalAuth.m2tLoginAttempts = attempts;

function clientKey(request: NextRequest): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",") ?? [];
  return forwarded[forwarded.length - 1]?.trim() || "unknown";
}

function pruneAttempts(now: number): void {
  for (const [key, state] of attempts) {
    if (state.resetAt <= now) attempts.delete(key);
  }
}

function boundedClientKey(key: string): string {
  if (attempts.has(key) || attempts.size < MAX_TRACKED_CLIENTS) return key;
  return OVERFLOW_KEY;
}

function bucketRateLimited(key: string, limit: number, now: number): boolean {
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 0, resetAt: now + ATTEMPT_WINDOW_MS });
    return false;
  }
  return current.count >= limit;
}

function rateLimited(key: string, now = Date.now()): boolean {
  pruneAttempts(now);
  return bucketRateLimited(GLOBAL_KEY, MAX_GLOBAL_ATTEMPTS, now)
    || bucketRateLimited(boundedClientKey(key), MAX_CLIENT_ATTEMPTS, now);
}

function incrementBucket(key: string): void {
  const current = attempts.get(key);
  if (current) current.count += 1;
}

function recordFailure(key: string): void {
  incrementBucket(GLOBAL_KEY);
  incrementBucket(boundedClientKey(key));
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  if (webAuthConfigurationError()) {
    return NextResponse.json({ error: "web_auth_not_configured" }, { status: 503 });
  }

  const key = clientKey(request);
  if (rateLimited(key)) {
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }

  let passphrase = "";
  try {
    const body = (await request.json()) as { passphrase?: unknown };
    if (typeof body.passphrase === "string" && body.passphrase.length <= 512) {
      passphrase = body.passphrase;
    }
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!(await verifyOperatorPassphrase(passphrase))) {
    recordFailure(key);
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  attempts.delete(key);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    WEB_SESSION_COOKIE,
    await issueWebSessionToken(),
    webSessionCookieOptions()
  );
  return response;
}
