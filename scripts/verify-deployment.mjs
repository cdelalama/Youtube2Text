const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const apiUrl = args.get("--api-url") ?? "http://10.0.0.220:8787";
const webUrl = args.get("--web-url") ?? "https://y2t.lamanoriega.com";
const expectedVersion = args.get("--version");
const legacy = process.argv.includes("--legacy");

if (!expectedVersion) throw new Error("--version is required");

async function waitFor(label, operation, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw new Error(`${label} did not become ready: ${lastError?.message ?? lastError}`);
}

function expectStatus(response, expected, label) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    throw new Error(`${label}: expected HTTP ${allowed.join("/")}, got ${response.status}`);
  }
}

const health = await waitFor("API health", async () => {
  const response = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(5_000) });
  expectStatus(response, 200, "GET /health");
  const body = await response.json();
  if (body.version !== expectedVersion) {
    throw new Error(`expected version ${expectedVersion}, got ${body.version}`);
  }
  return body;
});
console.log(`[verify] API health version=${health.version}`);

const unauthenticatedRuns = await fetch(`${apiUrl}/runs`);
expectStatus(unauthenticatedRuns, 401, "unauthenticated GET /runs");
console.log("[verify] backend authentication rejects missing key");

if (legacy) {
  const root = await waitFor("legacy web", async () => {
    const response = await fetch(webUrl, { redirect: "manual" });
    expectStatus(response, 200, "legacy web root");
    return response;
  });
  console.log(`[verify] legacy web status=${root.status}`);
  process.exit(0);
}

const mediaStatusResponse = await fetch(`${apiUrl}/status/media-pipeline`);
expectStatus(mediaStatusResponse, 200, "GET /status/media-pipeline");
const mediaStatus = await mediaStatusResponse.json();
if (!["ok", "degraded"].includes(mediaStatus?.condition) || !mediaStatus?.observed_at) {
  throw new Error("media pipeline status is not a valid sanitized snapshot");
}
console.log(`[verify] media pipeline status condition=${mediaStatus.condition}`);

const apiKey = process.env.Y2T_API_KEY;
const passphrase = process.env.Y2T_WEB_AUTH_PASSPHRASE;
if (!apiKey || !passphrase) {
  throw new Error("Y2T_API_KEY and Y2T_WEB_AUTH_PASSPHRASE are required for full verification");
}

const headers = { "x-api-key": apiKey };
const transcriptsResponse = await fetch(`${apiUrl}/v1/transcripts?limit=1`, { headers });
expectStatus(transcriptsResponse, 200, "authenticated GET /v1/transcripts");
const transcriptsBody = await transcriptsResponse.json();
if (transcriptsBody?.schemaVersion !== "media2text.transcript-list.v1") {
  throw new Error("Transcript Store API returned an unexpected schema version");
}
console.log(`[verify] transcript store records=${transcriptsBody.items?.length ?? 0}`);

const usageResponse = await fetch(`${apiUrl}/metrics/cost`, { headers });
expectStatus(usageResponse, 200, "authenticated GET /metrics/cost");
const usageBody = await usageResponse.json();
if (usageBody?.usage?.policy?.enforcement !== "enforce") {
  throw new Error("production usage enforcement is not enforce");
}
console.log(
  `[verify] usage enforce cost30d=${usageBody.usage.last30d.estimatedUsd} cap30d=${usageBody.usage.policy.maxTotalUsd30d}`
);

const schedulerResponse = await fetch(`${apiUrl}/scheduler/status`, { headers });
expectStatus(schedulerResponse, 200, "authenticated GET /scheduler/status");
const schedulerBody = await schedulerResponse.json();
if (schedulerBody?.status?.enabled !== false || schedulerBody?.status?.running !== false) {
  throw new Error("scheduler must remain disabled for this rollout");
}
console.log("[verify] scheduler disabled");

const root = await waitFor("web login redirect", async () => {
  const response = await fetch(webUrl, { redirect: "manual" });
  expectStatus(response, [307, 308], "web root redirect");
  if (!response.headers.get("location")?.startsWith("/login")) {
    throw new Error("web root did not redirect to /login");
  }
  return response;
});
console.log(`[verify] web root protected status=${root.status}`);

const loginPage = await fetch(`${webUrl}/login`);
expectStatus(loginPage, 200, "GET /login");

const unauthenticatedBff = await fetch(`${webUrl}/api/metrics/cost`);
expectStatus(unauthenticatedBff, 401, "unauthenticated web BFF");

const loginResponse = await fetch(`${webUrl}/api/auth/login`, {
  method: "POST",
  redirect: "manual",
  headers: {
    origin: new URL(webUrl).origin,
    "content-type": "application/json",
  },
  body: JSON.stringify({ passphrase }),
});
expectStatus(loginResponse, 200, "operator login");
const setCookie = loginResponse.headers.get("set-cookie") ?? "";
const cookie = setCookie.split(";", 1)[0];
if (!cookie.startsWith("m2t_session=")) {
  throw new Error("operator login did not issue the signed session cookie");
}

const authenticatedBff = await fetch(`${webUrl}/api/metrics/cost`, {
  headers: { cookie },
});
expectStatus(authenticatedBff, 200, "authenticated web BFF");
console.log("[verify] operator login and authenticated BFF succeeded");
