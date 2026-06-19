import { apiBaseUrlServer } from "./api";

function apiKeyHeader(): Record<string, string> {
  const key = process.env.Y2T_API_KEY;
  if (!key || key.trim().length === 0) return {};
  return { "x-api-key": key.trim() };
}

function copyHeaderIfPresent(from: Headers, to: Headers, name: string) {
  const value = from.get(name);
  if (value) to.set(name, value);
}

export async function proxyToApi(request: Request, path: string): Promise<Response> {
  const url = `${apiBaseUrlServer()}${path}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(apiKeyHeader())) headers.set(k, v);

  copyHeaderIfPresent(request.headers, headers, "content-type");
  copyHeaderIfPresent(request.headers, headers, "accept");
  copyHeaderIfPresent(request.headers, headers, "last-event-id");

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: "api_unreachable", message },
      { status: 502 }
    );
  }

  const outHeaders = new Headers();
  copyHeaderIfPresent(res.headers, outHeaders, "content-type");
  copyHeaderIfPresent(res.headers, outHeaders, "cache-control");
  copyHeaderIfPresent(res.headers, outHeaders, "content-disposition");

  return new Response(res.body, { status: res.status, headers: outHeaders });
}
