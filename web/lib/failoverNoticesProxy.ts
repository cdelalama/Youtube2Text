import { apiBaseUrlServer } from "./api";
import { getWebAuthState } from "./webAuth";

// The whole web side of the banner's read, in one place.
//
//   browser  GET /api/provider-accounts?view=notices
//   API      GET /provider-accounts?view=notices
//
// It answers only pending failover notices and current routing. It never
// returns the account listing or any key suffix of the existing configuration;
// those belong to the accounts screen, which reads the same path with no query.
//
// 1. Session: the request must carry the operator's signed session cookie
//    (getWebAuthState in webAuth.ts verifies signature and expiry). The
//    middleware applies the same check to every /api path before this runs.
// 2. Query: exactly `view=notices`, once, and nothing else. Any other query on
//    this route is refused with 400, never forwarded and never answered with
//    the full snapshot.
// 3. Forwarding: a fixed upstream URL with the operator API key held by the web
//    server. Nothing from the browser request is copied upstream.

export const NOTICES_VIEW = "notices";

/** True when the query string is exactly `view=notices`. */
export function isExactNoticesQuery(search: URLSearchParams): boolean {
  const entries = [...search.entries()];
  return entries.length === 1 && entries[0]![0] === "view" && entries[0]![1] === NOTICES_VIEW;
}

export async function proxyFailoverNotices(request: Request): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  if (await getWebAuthState(request) !== "authenticated") return fail("unauthorized", 401);
  if (request.method !== "GET") return fail("method_not_allowed", 405);
  if (!isExactNoticesQuery(new URL(request.url).searchParams)) return fail("invalid_request", 400);
  const key = process.env.Y2T_API_KEY?.trim();
  if (!key || key.length < 16) return fail("api_auth_not_configured", 503);
  try {
    const response = await fetch(`${apiBaseUrlServer()}/provider-accounts?view=${NOTICES_VIEW}`, {
      method: "GET",
      headers: { "x-api-key": key },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    return new Response(response.body, { status: response.status, headers: { ...headers, "content-type": "application/json" } });
  } catch {
    return fail("api_unreachable", 502);
  }
}
