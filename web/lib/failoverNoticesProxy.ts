import { apiBaseUrlServer } from "./api";
import { getWebAuthState } from "./webAuth";
import type { FailoverNotice, FailoverParty, FailoverRouting } from "./failoverNotices";

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
// 4. Answer: nothing the API sends is passed on as it came. The body must be
//    the notices view (readNoticesView below) and the response is built again
//    here from the allowed fields only. This matters when the web and the API
//    are not the same release: an API older than 0.43.0 ignores the query and
//    answers the whole account listing, with key suffixes. Such an answer has
//    no `view: "notices"` mark, is refused with a fixed error and is dropped.

export const NOTICES_VIEW = "notices";

export type FailoverNoticesView = { view: typeof NOTICES_VIEW; notices: FailoverNotice[]; routing: FailoverRouting };

/** True when the query string is exactly `view=notices`. */
export function isExactNoticesQuery(search: URLSearchParams): boolean {
  const entries = [...search.entries()];
  return entries.length === 1 && entries[0]![0] === "view" && entries[0]![1] === NOTICES_VIEW;
}

const PROVIDERS = ["assemblyai", "deepgram", "openai_whisper"] as const;
const NOTICE_KINDS = ["moved", "blocked", "stopped"] as const;
const NOTICE_REASONS = ["rejected", "exhausted"] as const;
const ROUTING_STATES = ["legacy", "account", "blocked", "unavailable"] as const;
const UNAVAILABLE_REASONS = ["account_disabled", "key_revoked", "provider_mismatch"] as const;
const TOP_LEVEL_FIELDS = ["notices", "routing", "view"];
const MAX_BODY_CHARS = 262_144;
const MAX_NOTICES = 500;
const MAX_ID = 64;
const MAX_LABEL = 80;
// A key hint is a four-character mask plus at most the last four characters.
const MAX_HINT = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.find((entry) => entry === value);
}
function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && [...value].length <= max ? value : undefined;
}
function instant(value: unknown): string | undefined {
  const candidate = text(value, 40);
  return candidate !== undefined && !Number.isNaN(Date.parse(candidate)) ? candidate : undefined;
}

function readParty(value: unknown): FailoverParty | undefined {
  if (!isRecord(value)) return undefined;
  const accountId = text(value.accountId, MAX_ID);
  const label = text(value.label, MAX_LABEL);
  const provider = oneOf(PROVIDERS, value.provider);
  const keyHint = text(value.keyHint, MAX_HINT);
  if (accountId === undefined || label === undefined || provider === undefined || keyHint === undefined) return undefined;
  return { accountId, label, provider, keyHint };
}

function readNotice(value: unknown): FailoverNotice | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id, MAX_ID);
  const kind = oneOf(NOTICE_KINDS, value.kind);
  const reason = oneOf(NOTICE_REASONS, value.reason);
  const status = value.status === null ? null
    : typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599 ? value.status : undefined;
  const from = readParty(value.from);
  const to = value.to === null ? null : readParty(value.to);
  const serviceChanged = typeof value.serviceChanged === "boolean" ? value.serviceChanged : undefined;
  const count = typeof value.count === "number" && Number.isInteger(value.count) && value.count >= 1 ? value.count : undefined;
  const firstAt = instant(value.firstAt);
  const lastAt = instant(value.lastAt);
  if (id === undefined || kind === undefined || reason === undefined || status === undefined || from === undefined || to === undefined
    || serviceChanged === undefined || count === undefined || firstAt === undefined || lastAt === undefined) return undefined;
  return { id, kind, reason, status, from, to, serviceChanged, count, firstAt, lastAt };
}

function readRouting(value: unknown): FailoverRouting | undefined {
  if (!isRecord(value)) return undefined;
  const enabled = typeof value.enabled === "boolean" ? value.enabled : undefined;
  const state = oneOf(ROUTING_STATES, value.state);
  const reason = value.reason === null ? null : oneOf(UNAVAILABLE_REASONS, value.reason);
  const provider = oneOf(PROVIDERS, value.provider);
  const accountLabel = value.accountLabel === null ? null : text(value.accountLabel, MAX_LABEL);
  if (enabled === undefined || state === undefined || reason === undefined || provider === undefined || accountLabel === undefined) return undefined;
  return { enabled, state, reason, provider, accountLabel };
}

/**
 * Reads an API answer as the notices view and returns a NEW object holding the
 * allowed fields only, or nothing when the answer is anything else. The top
 * level must be exactly `view: "notices"`, `notices` and `routing`: an answer
 * without the mark, or carrying any other field (such as `accounts`), is not
 * this view. Inside a notice or the routing, every allowed field must be
 * present and well formed; a field this code does not know is left behind.
 */
export function readNoticesView(body: unknown): FailoverNoticesView | undefined {
  if (!isRecord(body) || body.view !== NOTICES_VIEW) return undefined;
  if (Object.keys(body).sort().join() !== TOP_LEVEL_FIELDS.join()) return undefined;
  if (!Array.isArray(body.notices) || body.notices.length > MAX_NOTICES) return undefined;
  const notices: FailoverNotice[] = [];
  for (const item of body.notices) {
    const notice = readNotice(item);
    if (!notice) return undefined;
    notices.push(notice);
  }
  const routing = readRouting(body.routing);
  if (!routing) return undefined;
  return { view: NOTICES_VIEW, notices, routing };
}

export async function proxyFailoverNotices(request: Request): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  if (await getWebAuthState(request) !== "authenticated") return fail("unauthorized", 401);
  if (request.method !== "GET") return fail("method_not_allowed", 405);
  if (!isExactNoticesQuery(new URL(request.url).searchParams)) return fail("invalid_request", 400);
  const key = process.env.Y2T_API_KEY?.trim();
  if (!key || key.length < 16) return fail("api_auth_not_configured", 503);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrlServer()}/provider-accounts?view=${NOTICES_VIEW}`, {
      method: "GET",
      headers: { "x-api-key": key },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return fail("api_unreachable", 502);
  }
  // From here on the API's own body is only read, never passed on.
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    return fail("api_refused_notices", 502);
  }
  let view: FailoverNoticesView | undefined;
  try {
    const raw = await response.text();
    view = raw.length > MAX_BODY_CHARS ? undefined : readNoticesView(JSON.parse(raw));
  } catch {
    view = undefined;
  }
  if (!view) return fail("api_answer_not_notices_view", 502);
  return Response.json(view, { status: 200, headers });
}
