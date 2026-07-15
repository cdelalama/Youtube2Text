import { apiBaseUrlServer } from "./api";

export async function proxyPublicMediaStatus(): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrlServer()}/status/media-pipeline`, {
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
