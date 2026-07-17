# Integration Guide (API-first)

This document is for integrating Media2Text into other systems (n8n, custom
backends, cron, etc.). The API runtime and compose service names remain
`youtube2text`/`youtube2text-api` by design.
It does not replace the CLI.

## URLs and Auth

Default local API:
- `http://127.0.0.1:8787`

The server refuses to start unless `Y2T_API_KEY` is set (use `Y2T_ALLOW_INSECURE_NO_API_KEY=true` **and** `Y2T_ALLOW_INSECURE_NO_API_KEY_CONFIRM=I_UNDERSTAND` for local development only).
When `Y2T_API_KEY` is set, all endpoints require `X-API-Key` except basic
`GET /health` and the sanitized `GET /status/media-pipeline`. Deep health
requires a key unless `Y2T_HEALTH_DEEP_PUBLIC=true`.
Remote media producers may use the separate `X-Media2Text-Intake-Key` only for
`POST /v1/intakes`; it cannot read transcripts, settings, runs, or other jobs.
If the API sits behind a trusted reverse proxy, set `Y2T_TRUST_PROXY=true` and `Y2T_TRUST_PROXY_IPS=<proxy_ip[,proxy_ip]>` so rate limiting uses `X-Forwarded-For` / `X-Real-IP`.
Never enable `Y2T_TRUST_PROXY` unless requests are actually coming through a trusted proxy or load balancer.
`Y2T_API_KEY_MAX_BYTES` caps the `X-API-Key` header size (default 256). `Y2T_API_KEY_MIN_BYTES` enforces a minimum API key length (default 32).

Example (PowerShell):

```powershell
$env:Y2T_API_KEY="your_admin_key"
curl -H "X-API-Key: $env:Y2T_API_KEY" http://127.0.0.1:8787/runs
```

Multi-key AssemblyAI (optional):
- Set `Y2T_ASSEMBLYAI_API_KEYS=key1,key2` to enable round-robin + failover.
- Use `Y2T_ASSEMBLYAI_KEY_FAILURES` and `Y2T_ASSEMBLYAI_KEY_COOLDOWN_MS` to tune failure threshold and cooldown.

Multi-key Deepgram (optional):
- Set `Y2T_DEEPGRAM_API_KEYS=key1,key2` to enable round-robin + failover.
- Use `Y2T_DEEPGRAM_KEY_FAILURES` and `Y2T_DEEPGRAM_KEY_COOLDOWN_MS` to tune failure threshold and cooldown.

## Core endpoints

### 1) Health

```bash
curl http://127.0.0.1:8787/health
```

### 1b) Settings (optional non-secret defaults)

The API can persist non-secret defaults to `output/_settings.json` (never secrets).
These settings affect planning and runs unless overridden per-run.

Precedence:
`output/_settings.json` (lowest) < `config.yaml` < `.env` (highest) < per-run overrides.

Fetch current settings + effective values:

```bash
curl -sS http://127.0.0.1:8787/settings
```

The response also includes `sources` per field (`env`, `config.yaml`, `settingsFile`, `default`, `unset`) so UIs can explain where each effective value comes from.

Update settings (send `null` to clear a key):

```bash
curl -sS -X PATCH http://127.0.0.1:8787/settings \
  -H "Content-Type: application/json" \
  -d '{"settings":{"maxNewVideos":10,"afterDate":"2024-01-01","csvEnabled":true}}'
```

### 2) Plan a run (no transcription)

Use this to avoid wasted credits. It enumerates and counts what is already processed.

```bash
curl -sS -X POST http://127.0.0.1:8787/runs/plan \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/@SomeChannel","force":false,"maxNewVideos":10,"afterDate":"2024-01-01"}'
```

Response includes:
- `plan.totalVideos`
- `plan.alreadyProcessed`
- `plan.unprocessed` (total unprocessed under filters)
- `plan.toProcess` (selected for this run; capped by `maxNewVideos`)
- `plan.videos[]` with `processed: true|false` (full list under filters)
- `plan.selectedVideos[]` (the videos that will be processed)

### 3) Start a run

```bash
curl -sS -X POST http://127.0.0.1:8787/runs \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/@SomeChannel","force":false,"maxNewVideos":10,"afterDate":"2024-01-01"}'
```

Notes:
- For single-video URLs, `POST /runs` is cache-first: if artifacts already exist and `force=false`, it returns a `done` run immediately (no download/transcribe).
- For channel/playlist runs, idempotency is handled by per-video skip checks.
- By default, run URLs must be YouTube. Override (not recommended): `Y2T_RUN_ALLOW_ANY_URL=true`.

### 3a) Upload a local audio file

Upload the audio first:

```bash
curl -sS -X POST http://127.0.0.1:8787/audio \
  -H "X-API-Key: $Y2T_API_KEY" \
  -F "file=@/path/to/local-audio.mp3" \
  -F "title=Local audio sample"
```

Then start a run using the returned `audioId`:

```bash
curl -sS -X POST http://127.0.0.1:8787/runs \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $Y2T_API_KEY" \
  -d '{"audioId":"<AUDIO_ID>","callbackUrl":"https://example.com/webhook"}'
```

`POST /audio` now creates a `held` intake record. The audio-backed run activates
that record and uses the same lease, completion, and outbox state machine as
remote media intake while preserving the legacy HTTP response.

### 3b) Durable remote media intake

`Media Intake v1` is the network-safe replacement for producer-local paths.
The producer sends an authenticated HTTP(S) artifact URL plus its exact byte
length and SHA-256. Media2Text commits the idempotent obligation before
returning `202`, then downloads and verifies bytes asynchronously.

```bash
curl -sS -X POST http://127.0.0.1:8787/v1/intakes \
  -H "Content-Type: application/json" \
  -H "X-Media2Text-Intake-Key: $Y2T_INTAKE_API_KEY" \
  -d '{
    "schemaVersion":"media2text.intake.v1",
    "eventId":"plaud:item-123:revision-1",
    "idempotencyKey":"plaud:item-123:revision-1",
    "source":{
      "authority":"plaud-mirror",
      "itemId":"item-123",
      "artifactRevision":"sha256:<SHA256>"
    },
    "artifact":{
      "url":"https://media-source.example/artifacts/item-123",
      "sha256":"<SHA256>",
      "bytes":123456,
      "contentType":"audio/mpeg"
    }
  }'
```

The exact origin must appear in `Y2T_INTAKE_ARTIFACT_ALLOWED_ORIGINS`.
Identical retries return the same `intakeId`; conflicting reuse returns `409`.
Status is available to an operator at `GET /v1/intakes/{intakeId}`. Responses
never expose the artifact URL or a local storage path.

#### Plaud Mirror compatibility profile

Media2Text also implements the exact Plaud Mirror Transcription Intake v1
Compatibility Profile pinned in
`docs/contracts/plaud-mirror-transcription-intake-v1/`. Configure a producer
profile in secret storage with an admission bearer, a distinct artifact bearer,
a distinct callback HMAC secret, and exact HTTPS origin allowlists. The profile
uses these machine routes:

- `GET /v1/intake-capabilities`
- `POST /v1/intakes`
- `GET /v1/intakes/{intakeId}`

The admission bearer cannot access operator routes or another producer's jobs.
The artifact bearer is sent only while fetching the immutable source artifact.
Accepted, processing, transcribed, and failed callbacks are persisted before
delivery, sent in monotonic order, and signed with
`X-Transcription-Timestamp` plus `X-Transcription-Signature`. Pull status is the
reconciliation path when a callback is lost. Run the Plaud-owned provider probe
against the public TLS origin before enabling a destination or enqueueing a
real recording.

### 3c) Transcript Store and completion

Each successful item writes a canonical immutable record under
`output/_transcripts/v1/` and returns its identity in `video:done` and
`run.videoResults[]`.

```bash
curl -sS -H "X-API-Key: $Y2T_API_KEY" \
  http://127.0.0.1:8787/v1/transcripts?limit=10
curl -sS -H "X-API-Key: $Y2T_API_KEY" \
  http://127.0.0.1:8787/v1/transcripts/<TRANSCRIPT_ID>
```

The individual response body is the exact canonical byte sequence named by
`ETag` and `X-Media2Text-Record-SHA256`. Every record also inserts one durable
`transcript.ready` event. When `Y2T_TRANSCRIPT_READY_URL` is configured, the
outbox delivers it with `X-Media2Text-Event-Id`, timestamp, and HMAC signature.
The contract is at-least-once; consumers persist idempotency before ACK.

## Error responses (common)

Most endpoints can return these errors (JSON):

| Status | error | Meaning |
|--------|-------|---------|
| 400 | `bad_request` | Validation failed (invalid inputs, header too long, bad date, etc.) |
| 401 | `unauthorized` | Missing or invalid `X-API-Key` |
| 404 | `not_found` | Resource not found |
| 408 | `request_timeout` | Request timed out (`Y2T_REQUEST_TIMEOUT_MS` or `Y2T_UPLOAD_TIMEOUT_MS`) |
| 413 | `payload_too_large` | JSON body exceeds `Y2T_MAX_BODY_BYTES` |
| 429 | `rate_limited` | Rate limit exceeded (see Retry-After) |
| 500 | `internal_error` | Internal error (sanitized message) |
| 500 | `server_misconfigured` | Server missing required env (e.g., `Y2T_API_KEY`) |

### 3d) Cancel a run

Cancellation is cooperative. In-flight work may finish, but the run will stop as soon as practical and end with `status: cancelled`.

```bash
curl -sS -X POST http://127.0.0.1:8787/runs/<RUN_ID>/cancel
```

### 4) Observe progress

SSE (run events):
- `GET /runs/{runId}/events`

Global SSE (run list updates):
- `GET /events`
Use `Y2T_SSE_MAX_CLIENTS` to cap concurrent SSE connections (default 1000, `0` disables).
Use `Y2T_SSE_MAX_CLIENTS_PER_IP` to cap SSE connections per IP (default 50).
Use `Y2T_SSE_MAX_LIFETIME_SECONDS` to close long-lived streams (default 0 disables).
Use `Y2T_MAX_EVENT_BYTES` to clamp oversized SSE payloads (default 65536).
Use `Y2T_REQUEST_TIMEOUT_MS` to bound non-SSE request time (default 30000, `0` disables).

Example (bash/curl):

```bash
curl -N http://127.0.0.1:8787/runs/<RUN_ID>/events
```

### 4b) Fetch recent run logs (JSON)

If you cannot use SSE (or want a quick debug snapshot), fetch the recent buffered events as JSON:

```bash
curl -sS "http://127.0.0.1:8787/runs/<RUN_ID>/logs?tail=200"
```

### 5) Get produced artifacts

List artifacts for a run:

```bash
curl -sS http://127.0.0.1:8787/runs/<RUN_ID>/artifacts
```

Download artifacts (direct):
- `GET /library/channels/{channelDirName}/videos/{basename}/txt`
- `GET /library/channels/{channelDirName}/videos/{basename}/md`
- `GET /library/channels/{channelDirName}/videos/{basename}/jsonl`
- `GET /library/channels/{channelDirName}/videos/{basename}/json`
- `GET /library/channels/{channelDirName}/videos/{basename}/meta`
- `GET /library/channels/{channelDirName}/videos/{basename}/comments`
- `GET /library/channels/{channelDirName}/videos/{basename}/csv`
- `GET /library/channels/{channelDirName}/videos/{basename}/audio`

Example:

```bash
curl -L "http://127.0.0.1:8787/library/channels/<CHANNEL_DIR>/videos/<BASENAME>/md" -o transcript.md
```

### 6) Delete library content

Delete an entire channel (output dir + audio dir + catalog cache):

```bash
curl -sS -X DELETE http://127.0.0.1:8787/library/channels/<CHANNEL_DIR> \
  -H "X-API-Key: $Y2T_API_KEY"
```

Response:

```json
{ "ok": true, "deleted": { "outputFiles": 42, "audioRemoved": true, "catalogCacheRemoved": true } }
```

Delete a single video (all file variants + audio):

```bash
curl -sS -X DELETE http://127.0.0.1:8787/library/channels/<CHANNEL_DIR>/videos/<BASENAME> \
  -H "X-API-Key: $Y2T_API_KEY"
```

Response:

```json
{ "ok": true, "deleted": { "outputFiles": 7, "audioFiles": 1 } }
```

Notes:
- Returns 404 if the channel or video does not exist.
- Returns 409 Conflict if an active run (queued or running) targets the channel.
- Does not cascade to `_runs/` or `_watchlist.json` (operational data stays intact).
- Historical runs referencing deleted content will show "Content has been deleted" in the web UI.

## Webhooks (callbackUrl)

`POST /runs` supports `callbackUrl`. When the run ends, the API sends a POST webhook:
- `type: "run:done"` when status becomes `done`
- `type: "run:error"` when status becomes `error`
- `type: "run:cancelled"` when status becomes `cancelled`

Payload:

```json
{
  "type": "run:done",
  "timestamp": "2025-12-15T00:00:00.000Z",
  "run": { "runId": "...", "status": "done", "...": "..." }
}
```

Signature (optional):
- The API always includes:
  - `content-type: application/json`
  - `x-y2t-event: run:done` (example event name)
  - `x-y2t-timestamp: 2025-12-15T00:00:00.000Z`
- If `Y2T_WEBHOOK_SECRET` is set, the API also includes:
  - `x-y2t-signature: sha256=<hex>` where HMAC-SHA256 is computed over:
    - `${timestamp}.${body}`
  - If `Y2T_WEBHOOK_MAX_AGE_SECONDS` is set, the API also includes `X-Y2T-Max-Age`.
    Use it (or your own fixed window) to reject old/replayed requests.

Retry policy:
- Retries for `429`, `5xx`, and network errors.
- Configure with:
  - `Y2T_WEBHOOK_RETRIES` (default `3`)
  - `Y2T_WEBHOOK_TIMEOUT_MS` (default `5000`)
- Redirects are not followed (to prevent SSRF).
- Hostnames are resolved and blocked if they resolve to private/loopback IPs (DNS rebinding protection).
- Production guidance: set `Y2T_WEBHOOK_ALLOWED_DOMAINS` to an explicit allowlist and avoid wildcard CORS.

Recommended replay protection (receiver):
- Parse `X-Y2T-Timestamp` and reject if older than `X-Y2T-Max-Age` seconds.
- Verify `X-Y2T-Signature` against the raw request body.

## n8n (suggested flow)

Goal: run -> wait -> fetch artifacts -> send to next system.

1) HTTP Request: `POST /runs/plan`
   - If `plan.toProcess == 0`, do nothing (or fetch artifacts directly).
2) HTTP Request: `POST /runs` (optionally set `callbackUrl` to your n8n webhook URL)
3) If using `callbackUrl`:
   - n8n Webhook Trigger receives `run:done` / `run:error`
4) HTTP Request: `GET /runs/{runId}/artifacts`
5) HTTP Request: download `md` and/or `jsonl` for each video and pass to the next workflow step.

## Docker notes

- For server-to-server calls inside the compose network, use `Y2T_API_BASE_URL=http://youtube2text-api:8787`.
- For browser-visible URLs, prefer going through the web UI `http://localhost:3000` which proxies `/api/*` to the API and does not expose secrets to the browser.

## Monitoring (Prometheus)

The API exposes a Prometheus-compatible metrics endpoint:

- `GET /metrics` (text/plain; version=0.0.4; charset=utf-8)

If `Y2T_API_KEY` is set, include `X-API-Key: ...`.

## Watchlist URL safety

The watchlist is meant for recurring sources (channels/playlists). By default, `POST /watchlist` rejects single-video URLs.
Override (not recommended): set `Y2T_WATCHLIST_ALLOW_ANY_URL=true`.

## Channel avatars in Library (best-effort)

The web UI Library page can show a small channel avatar.

How it works:
- The pipeline stores `channelThumbnailUrl` in `output/<channelDirName>/_channel.json` (best-effort from yt-dlp channel metadata).
- The API exposes it in `GET /library/channels`.

If you already have a channel folder created before this feature existed (or before v0.9.2), rerun that channel (or any video from it) once to populate the field.
