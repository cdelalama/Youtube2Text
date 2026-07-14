export const WEB_SESSION_COOKIE = "m2t_session";

type SessionPayload = {
  v: 1;
  iat: number;
  exp: number;
  nonce: string;
};

export type WebAuthState = "authenticated" | "unauthenticated" | "misconfigured";

const encoder = new TextEncoder();

function authSecret(): string {
  return process.env.Y2T_WEB_AUTH_SECRET?.trim() ?? "";
}

function operatorPassphrase(): string {
  return process.env.Y2T_WEB_AUTH_PASSPHRASE ?? "";
}

function sessionHours(): number {
  const parsed = Number(process.env.Y2T_WEB_AUTH_SESSION_HOURS ?? "12");
  if (!Number.isFinite(parsed)) return 12;
  return Math.min(168, Math.max(1, Math.trunc(parsed)));
}

export function webAuthConfigurationError(): string | undefined {
  if (authSecret().length < 32) return "Y2T_WEB_AUTH_SECRET must be at least 32 characters";
  if (operatorPassphrase().length < 12) {
    return "Y2T_WEB_AUTH_PASSPHRASE must be at least 12 characters";
  }
  return undefined;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer as ArrayBuffer;
}

async function importHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(authSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function issueWebSessionToken(nowMs = Date.now()): Promise<string> {
  const error = webAuthConfigurationError();
  if (error) throw new Error(error);

  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const payload: SessionPayload = {
    v: 1,
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(nowMs / 1000) + sessionHours() * 60 * 60,
    nonce: toBase64Url(nonce),
  };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importHmacKey(),
    encoder.encode(encodedPayload)
  );
  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyWebSessionToken(
  token: string | undefined,
  nowMs = Date.now()
): Promise<boolean> {
  if (!token || webAuthConfigurationError()) return false;
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra !== undefined) return false;

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await importHmacKey(),
      fromBase64Url(encodedSignature),
      encoder.encode(encodedPayload)
    );
    if (!valid) return false;
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(encodedPayload))
    ) as Partial<SessionPayload>;
    return payload.v === 1 && typeof payload.exp === "number" && payload.exp > nowMs / 1000;
  } catch {
    return false;
  }
}

export async function verifyOperatorPassphrase(candidate: string): Promise<boolean> {
  if (webAuthConfigurationError()) return false;
  const key = await importHmacKey();
  const expected = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(operatorPassphrase())
  );
  return crypto.subtle.verify("HMAC", key, expected, encoder.encode(candidate));
}

function cookieValue(request: Request, name: string): string | undefined {
  const raw = request.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export async function getWebAuthState(request: Request): Promise<WebAuthState> {
  if (webAuthConfigurationError()) return "misconfigured";
  const token = cookieValue(request, WEB_SESSION_COOKIE);
  return (await verifyWebSessionToken(token)) ? "authenticated" : "unauthenticated";
}

function lastForwardedValue(value: string | null): string | undefined {
  const values = value?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
  return values[values.length - 1];
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const requestUrl = new URL(request.url);
    const host = lastForwardedValue(request.headers.get("x-forwarded-host"))
      ?? request.headers.get("host")?.trim();
    const protocol = lastForwardedValue(request.headers.get("x-forwarded-proto"))
      ?? requestUrl.protocol.replace(/:$/, "");
    const publicOrigin = host ? new URL(`${protocol}://${host}`).origin : requestUrl.origin;
    return new URL(origin).origin === publicOrigin;
  } catch {
    return false;
  }
}

export function webSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionHours() * 60 * 60,
  };
}
