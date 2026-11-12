import { apiBaseUrlServer } from "./api";

// Only this exact opt-in is forwarded; every other query is dropped so the
// default response keeps its fixed public shape.
const FAILOVER_CHECK = "stt_account_failover";

export async function proxyPublicMediaStatus(request?: Request): Promise<Response> {
  const includeFailover = request
    ? new URL(request.url).searchParams.getAll("include").includes(FAILOVER_CHECK)
    : false;
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrlServer()}/status/media-pipeline${includeFailover ? `?include=${FAILOVER_CHECK}` : ""}`, {
      method: "GET",
      cache: "no-store",
    });
  } catch {
    return Response.json(
      {
        observed_at: new Date().toISOString(),
        condition: "degraded",
        severity: "error",
        summary: "Media pipeline status is temporarily unavailable.",
      },
      { status: 502 }
    );
  }

  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}
