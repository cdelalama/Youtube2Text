import { createHash, createHmac, randomBytes } from "node:crypto";
import { apiBaseUrlServer } from "./api";
import { getWebAuthState, hasRecentOperatorAuth, isSameOriginRequest } from "./webAuth";

export async function proxyCredentials(request: Request): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  if (await getWebAuthState(request) !== "authenticated") return fail("unauthorized", 401);
  if (!["GET", "POST"].includes(request.method)) return fail("method_not_allowed", 405);
  if (request.method === "POST" && !isSameOriginRequest(request)) return fail("invalid_origin", 403);
  if (request.method === "POST" && !(await hasRecentOperatorAuth(request))) return fail("recent_auth_required", 403);
  const key = process.env.Y2T_API_KEY?.trim();
  if (!key || key.length < 16) return fail("api_auth_not_configured", 503);
  const upstreamHeaders = new Headers({ "x-api-key": key, "content-type": "application/json" });
  let body: Buffer | undefined;
  if (request.method === "POST") {
    const proofSecret = process.env.Y2T_CREDENTIAL_ADMIN_PROOF_SECRET?.trim();
    if (!proofSecret || !/^[a-f0-9]{64}$/i.test(proofSecret) || proofSecret === key
      || proofSecret === process.env.Y2T_WEB_AUTH_SECRET?.trim()) return fail("credential_admin_secret_not_configured", 503);
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (!reader) return fail("invalid_request", 400);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 16_384) { await reader.cancel(); return fail("payload_too_large", 413); }
      chunks.push(value);
    }
    body = Buffer.concat(chunks);
    const expires = Math.floor(Date.now() / 1000) + 30;
    const nonce = randomBytes(16).toString("hex");
    const digest = createHash("sha256").update(body).digest("hex");
    const signature = createHmac("sha256", proofSecret).update(`m2t-credential-admin-v1\nPOST\n/provider-accounts\n${expires}\n${nonce}\n${digest}`).digest("hex");
    upstreamHeaders.set("x-m2t-admin-proof", `${expires}.${nonce}.${signature}`);
  }
  try {
    const response = await fetch(`${apiBaseUrlServer()}/provider-accounts`, { method: request.method, body: body ? new Uint8Array(body).buffer : undefined,
      headers: upstreamHeaders, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
    return new Response(response.body, { status: response.status, headers: { ...headers, "content-type": "application/json" } });
  } catch { return fail("api_unreachable", 502); }
}
