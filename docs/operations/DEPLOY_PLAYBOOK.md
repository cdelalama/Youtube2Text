# Deploy Playbook (Single-Tenant Admin)

This playbook documents a pragmatic server deployment for Media2Text as a
single-tenant (admin-only) service. The runtime/image names remain
`youtube2text-*` by design.
It does not replace the CLI: the CLI remains fully operational and can be run separately.

## Goals

- Run API + Web via Docker Compose on a server.
- Keep secrets out of the browser (web proxies API calls).
- Make the deployment safe by default: require an API key, restrict CORS, and lock down webhooks.

## Prerequisites

- Docker + Docker Compose on the server
- An AssemblyAI API key (when `sttProvider=assemblyai`)
- A Deepgram API key (when `sttProvider=deepgram`)
- An OpenAI API key (when `sttProvider=openai_whisper`)
- A domain name + TLS termination (recommended)

## Required environment

- `ASSEMBLYAI_API_KEY` (required when `sttProvider=assemblyai`)
- `DEEPGRAM_API_KEY` (required when `sttProvider=deepgram`)
- `OPENAI_API_KEY` or `Y2T_OPENAI_API_KEY` (required when `sttProvider=openai_whisper`)
- `Y2T_ASSEMBLYAI_API_KEYS` / `Y2T_DEEPGRAM_API_KEYS` (optional comma-separated
  rotation pools; keep the singular key during staged rotation, then remove it)
- `Y2T_API_KEY` (private API credential; at least 32 characters)
- `Y2T_WEB_AUTH_SECRET` (random web-session signing secret; at least 32 characters)
- `Y2T_WEB_AUTH_PASSPHRASE` (operator console passphrase; at least 12 characters)
- `Y2T_INTAKE_API_KEY` (least-privilege producer credential; at least 32
  characters). Configure it before onboarding an external producer. It only
  authorizes `POST /v1/intakes` and cannot read or administer the API.
- `Y2T_TRANSCRIPTION_INTAKE_PROFILES_JSON` (secret JSON array for external
  compatibility profiles). Each object requires `id`, `authority`, independent
  `intakeBearer`, `artifactBearer`, and `statusHmacSecret` values, plus exact
  HTTPS `artifactOrigins` and `callbackOrigins`. Keep the entire value in
  Doppler; never commit it or print it in logs.
- `Y2T_CORTEX_TRANSCRIPT_READ_KEY` (optional least-privilege Cortex bearer; at
  least 32 characters). It authorizes only transcript listing and exact-record
  retrieval and must differ from intake, operator, and HMAC credentials.

## Strongly recommended (servers)

- `Y2T_WEB_AUTH_SESSION_HOURS` (signed console-session lifetime; default 12,
  clamped to 1-168 hours)
- `Y2T_CORS_ORIGINS` (comma-separated exact origin allowlist)
  - Example: `https://y2t.example.com`
  - Avoid `*` in production.
- `Y2T_WEBHOOK_ALLOWED_DOMAINS` (comma-separated allowlist for `callbackUrl`)
- `Y2T_WEBHOOK_MAX_AGE_SECONDS` (adds `X-Y2T-Max-Age` for replay protection)
- Webhook hosts are resolved and blocked if they resolve to private/loopback IPs (DNS rebinding protection)
  - Production guidance: always set `Y2T_WEBHOOK_ALLOWED_DOMAINS` to an explicit allowlist.
- `Y2T_MAX_BODY_BYTES` (request body limit, default 1,000,000)
- `Y2T_MAX_UPLOAD_MB` (upload size limit for `POST /audio`, default 1024)
- `Y2T_UPLOAD_TIMEOUT_MS` (upload timeout for `POST /audio`, default 120000)
- `Y2T_AUTH_FAIL_MAX` + `Y2T_AUTH_FAIL_WINDOW_MS` (rate limit auth failures)
- Defaults: `Y2T_AUTH_FAIL_MAX=30`, `Y2T_AUTH_FAIL_WINDOW_MS=60000`
- `Y2T_TRUST_PROXY=true` (if running behind a trusted reverse proxy; uses `X-Forwarded-For`/`X-Real-IP`)
  - Do not enable unless traffic actually comes through a trusted proxy/load balancer.
- `Y2T_TRUST_PROXY_IPS` (proxy allowlist when `Y2T_TRUST_PROXY=true`)
- `Y2T_API_KEY_MAX_BYTES` (cap `X-API-Key` header length; default 256)
- `Y2T_API_KEY_MIN_BYTES` (minimum API key length; default 32)
- `Y2T_RATE_LIMIT_WRITE_MAX` + `Y2T_RATE_LIMIT_WINDOW_MS` (rate limit write endpoints; defaults 60 / 60000ms)
- `Y2T_RATE_LIMIT_READ_MAX` + `Y2T_RATE_LIMIT_READ_WINDOW_MS` (rate limit read endpoints; defaults 300 / 60000ms)
- `Y2T_RATE_LIMIT_HEALTH_MAX` + `Y2T_RATE_LIMIT_HEALTH_WINDOW_MS` (throttle deep health checks; defaults 30 / 60000ms)
- `Y2T_HEALTH_DEEP_PUBLIC=false` (set true to allow unauthenticated deep health checks)
- `Y2T_HEALTH_INCLUDE_PATHS=false` (redact filesystem paths in deep health output)
- `Y2T_SSE_MAX_CLIENTS` (cap concurrent SSE connections; default 1000, `0` disables)
- `Y2T_SSE_MAX_CLIENTS_PER_IP` (cap SSE clients per IP; default 50)
- `Y2T_SSE_MAX_LIFETIME_SECONDS` (close long-lived SSE streams; default 0 disables)
- `Y2T_REQUEST_TIMEOUT_MS` (global request timeout for non-SSE requests)
- Default: `Y2T_REQUEST_TIMEOUT_MS=30000`
- `Y2T_RUN_TIMEOUT_MINUTES` (safety net for stuck runs)
- Default: `Y2T_RUN_TIMEOUT_MINUTES=240`
- `Y2T_MAX_BUFFERED_EVENTS_PER_RUN` (SSE replay buffer size; default 5000)
- `Y2T_MAX_EVENT_BYTES` (SSE event payload cap; default 65536)
- `Y2T_MAX_CONCURRENT_RUNS_PER_KEY` (cap concurrent runs per API key; default 0 disables)
- `Y2T_RUN_ALLOW_ANY_URL` (allow non-YouTube URLs for runs; default false)
- `Y2T_EXEC_MAX_BYTES` (cap stdout/stderr captured from external commands; default 50MB)
- `Y2T_API_PERSIST_DIR` (override persisted runs dir; default `output/_runs/`)
- `Y2T_SHUTDOWN_TIMEOUT_SECONDS` (graceful shutdown wait; default 60)
- `Y2T_WATCHLIST_ALLOW_ANY_URL` (allow non-channel/playlist watchlist URLs; default false)
- `Y2T_WEBHOOK_SECRET` (HMAC signature for webhooks; optional)
- `Y2T_WEBHOOK_RETRIES` (webhook retries; default 3)
- `Y2T_WEBHOOK_TIMEOUT_MS` (per-attempt webhook timeout; default 5000)
- `NEXT_PUBLIC_Y2T_API_BASE_URL` (web browser API base URL; must be publicly reachable)
- `Y2T_USAGE_ENFORCEMENT=enforce` (provider-boundary economic guard; do not use
  `track` for unattended production runs)
- `Y2T_USAGE_MAX_ITEM_MINUTES=180`
- `Y2T_USAGE_MAX_RUN_MINUTES=300`
- `Y2T_USAGE_MAX_SOURCE_MINUTES_24H=600`
- `Y2T_USAGE_MAX_TOTAL_MINUTES_30D=3000`
- `Y2T_USAGE_MAX_TOTAL_USD_30D=25`
- `Y2T_INTAKE_ARTIFACT_ALLOWED_ORIGINS` (comma-separated exact HTTPS origins
  from which the intake worker may fetch media; leave empty until a producer
  contract is approved)
- `Y2T_INTAKE_MAX_ARTIFACT_MB` (hard fetched-artifact cap; default 2048)
- `Y2T_INTAKE_FETCH_ATTEMPTS` (bounded fetch attempts; default 5)
- `Y2T_INTAKE_FETCH_TIMEOUT_MS` (per-attempt timeout; default 120000)
- `Y2T_INTAKE_LEASE_MS` (crash-recovery lease; default 300000)
- `Y2T_INTAKE_TERMINAL_RETENTION_DAYS` (terminal coordination-row retention;
  default 365; immutable transcript records are unaffected)
- `Y2T_INTAKE_STATUS_OUTBOX_ENABLED` (default true; starts only when at least
  one transcription profile exists)
- `Y2T_INTAKE_STATUS_OUTBOX_INTERVAL_MS` (default 1000)
- `Y2T_INTAKE_STATUS_OUTBOX_MAX_ATTEMPTS` (default 20)
- `Y2T_INTAKE_STATUS_OUTBOX_TIMEOUT_MS` (default 10000)
- `Y2T_TRANSCRIPT_READY_URL`, `Y2T_TRANSCRIPT_READY_SECRET`, and
  `Y2T_TRANSCRIPT_READY_KEY_ID` (fixed downstream endpoint, active HMAC secret,
  and non-secret key selector). Leave delivery unset until the consumer has
  reviewed the contract and the operator has ratified a version plus commit SHA.
 
docker-compose defaults:
- The compose file now uses `${VAR:-default}` for all optional env vars to match code defaults.

If `Y2T_API_KEY` is missing, the API server will refuse to start (unless you explicitly set `Y2T_ALLOW_INSECURE_NO_API_KEY=true` **and** `Y2T_ALLOW_INSECURE_NO_API_KEY_CONFIRM=I_UNDERSTAND` for local development only).
If you expose the API port publicly in that state, anyone can call it.

## Optional ops knobs (Phase 2.2)

- `Y2T_API_PERSIST_RUNS` (default: true)
- `Y2T_API_PERSIST_DIR` (default: `output/_runs/`)
- `Y2T_RETENTION_RUNS_DAYS` (default: 30; `-1` disables)
- `Y2T_RETENTION_AUDIO_DAYS` (default: 7; `-1` disables)
- `Y2T_MAX_AUDIO_MB` (cap audio size before splitting; provider limit applies if lower)
- `Y2T_SPLIT_OVERLAP_SECONDS` (overlap seconds between split chunks; default 2)

Retention never deletes transcripts under `output/<channelDir>/*`.
It only deletes operational run persistence (`output/_runs/*`) and old audio cache files (`audio/*`).

Non-secret defaults:
- The API/web UI can persist non-secret defaults to `output/_settings.json` via `GET/PATCH /settings`.
- This file is safe to keep on disk (no secrets) and is persisted via the `output/` volume mount.

## Ports and exposure (recommended)

- Expose the Web UI to the Internet (TLS): `:3000`
- Keep the API private (no public exposure) when possible:
  - If you must expose it, enforce `Y2T_API_KEY` and restrict `Y2T_CORS_ORIGINS`.

## Security checklist (before going public)

1) `Y2T_API_KEY` set (and NOT using `Y2T_ALLOW_INSECURE_NO_API_KEY=true`).
2) `Y2T_WEB_AUTH_SECRET` and `Y2T_WEB_AUTH_PASSPHRASE` set; verify an
   unauthenticated web request redirects to `/login` and an unauthenticated
   `/api/runs` request returns `401`.
3) `Y2T_CORS_ORIGINS` set to specific origins (avoid `*`).
4) `Y2T_WEBHOOK_ALLOWED_DOMAINS` set (explicit allowlist).
5) `Y2T_WEBHOOK_SECRET` set (HMAC signatures enabled).
6) `Y2T_HEALTH_DEEP_PUBLIC=false` (deep health requires auth).
7) If using a proxy: `Y2T_TRUST_PROXY=true` only when behind a trusted proxy.
8) API not exposed publicly if avoidable; otherwise ensure rate limits are enabled.
9) `Y2T_USAGE_ENFORCEMENT=enforce`; inspect `GET /metrics/cost` and confirm the
   limits/rates match the operator-approved spend before enabling the scheduler.
10) `Y2T_INTAKE_API_KEY` is distinct from `Y2T_API_KEY`; producer credentials
    must not grant operator access.
11) Every configured intake artifact origin is HTTPS and explicitly approved.
12) `Y2T_TRANSCRIPT_READY_URL` remains empty until its contract is frozen. If
    configured, require a separate random `Y2T_TRANSCRIPT_READY_SECRET`, an
    explicit key id, and Cortex active/previous verification keys during rotation.
13) For every transcription profile, verify the admission bearer, artifact
    bearer, and callback HMAC secret are distinct and at least 32 characters.
14) Route only the exact machine endpoints through the public TLS proxy; do not
    expose the remaining API surface or reuse the operator API key.

## Reverse proxy (recommended)

Terminate TLS in a reverse proxy (Caddy/Nginx/Traefik) and forward:
- `https://y2t.example.com/` -> web container `:3000`
- Exact machine paths `GET /v1/intake-capabilities`, `POST /v1/intakes`, and
  `GET /v1/intakes/{id}` -> API container `:8787`.
- Keep every other API path private; the web UI proxies its operator `/api/*`
  calls only after application authentication.

## Health and ops

- Basic health: `GET /health`
- Deep health (deps + disk + persistence): `GET /health?deep=true` (requires API key unless `Y2T_HEALTH_DEEP_PUBLIC=true`)
- Manual retention cleanup: `POST /maintenance/cleanup`
- Usage and estimated cost: `GET /metrics/cost` (authenticated)
- Media-pipeline status for Home Infra: `GET /status/media-pipeline` (public,
  sanitized, and rate limited)
- Canonical-host status for Infra Portal:
  `GET /api/status/media-pipeline` on the web origin (public sanitized proxy)
- Intake reconciliation: `GET /v1/intakes` (authenticated operator API)
- Producer capabilities and reconciliation: `GET /v1/intake-capabilities` and
  `GET /v1/intakes/{id}` with that producer's admission bearer
- Immutable transcript reconciliation: `GET /v1/transcripts` (authenticated
  operator API or transcript-only Cortex bearer; cursor traversal required)

The persistent usage ledger lives under `output/_usage/ledger.json`, inside the
existing output volume. Do not delete or edit it during routine deploys. Failed
or unresolved reservations are intentionally retained as potentially billable.
Usage limits and rates are environment-only, so configure them in Doppler or the
server env rather than `config.yaml` or API settings. A numeric limit of `0`
disables that individual cap.

Media Contracts state lives in the existing output volume:

- `output/_jobs/media2text.sqlite` is the bounded coordination database for
  intake leases and durable per-item delivery obligations.
- `output/_transcripts/v1/` contains immutable canonical transcript records and
  representation snapshots from the legacy schema.
- `output/_transcripts/v2/` contains provenance-complete records and immutable
  representation snapshots created from 0.40.0 onward.

Back up both paths with the output volume. Do not copy the SQLite file while it
is being modified; use a SQLite-aware backup or stop the API first. Routine
retention may prune terminal coordination rows, but never transcript records.

## Periodic maintenance (cron example)

Retention cleanup is safe by default (it never deletes transcripts under `output/<channelDir>/*`), but you still need to run it periodically on long-lived servers.

Linux cron example (daily at 03:15):

```cron
15 3 * * * curl -sS -X POST "http://127.0.0.1:8787/maintenance/cleanup" -H "X-API-Key: $Y2T_API_KEY" >/dev/null 2>&1
```

Notes:
- If `Y2T_API_KEY` is set on the server (required by default), clients must include the header.
- If the API is not exposed publicly, run this on the same host/container network (or via your reverse proxy if you intentionally expose it).

## Secrets management

Secrets can be provided via `.env` file or via [Doppler](https://www.doppler.com/) secrets manager.

| Method | Setup |
|--------|-------|
| `.env` file | Copy `.env.example` to `.env` on the server and fill in secrets. Compose reads it automatically. |
| Doppler | Install Doppler CLI, run `doppler login` + `doppler setup`, then prefix commands with `doppler run --`. No `.env` file needed. |

When using Doppler with Docker Compose:

```bash
doppler run -- docker compose up --build -d
```

## Suggested deployment steps (generic server)

1) Copy `docker-compose.yml` to your server.
2) Provide env vars (`.env` file, Doppler, or shell env):
   - `ASSEMBLYAI_API_KEY`
   - `Y2T_API_KEY`
   - `Y2T_WEB_AUTH_SECRET`
   - `Y2T_WEB_AUTH_PASSPHRASE`
   - `Y2T_INTAKE_API_KEY`
   - `Y2T_CORTEX_TRANSCRIPT_READ_KEY` (only after Cortex consumer review)
   - `Y2T_CORS_ORIGINS` (recommended)
3) Run: `docker compose up --build -d`
4) Verify:
   - Web loads at your domain
   - `GET /health?deep=true` reports `ok: true`
5) Periodically check disk usage and retention settings.

---

## Production deployment notes

The production deployment uses Docker Compose with pre-built images (no `build:` in
compose). Secrets are managed via Doppler service tokens fetched at startup using the
`dopplerhq/cli` Docker image.

Key design decisions:
- Healthchecks use `node` (not `wget`/`curl`) because the slim runtime images do not include them
- `start.sh` uses `umask 077` + `trap` to protect ephemeral secrets files
- On NAS, never run Compose directly for this service. Always use `/bin/sh
  start.sh`, which fetches Doppler secrets and invokes Compose with
  `--env-file .env.doppler`. A raw `docker-compose up -d` starts the API with
  blank secrets and can leave it unhealthy.
- `NEXT_PUBLIC_Y2T_API_BASE_URL` is the browser-reachable API URL for SSE streaming
- Scheduler is OFF by default in production; enable after e2e validation
- `Y2T_CORS_ORIGINS` must match the web UI origin

### Healthcheck (important)

The API container has no `wget` or `curl`. Use this Node.js healthcheck:

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "const h=require('http');h.get('http://localhost:8787/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 15s
```

If the healthcheck fails, `depends_on: condition: service_healthy` will block the web
container from starting.

### yt-dlp EJS readiness

The API image installs `yt-dlp[default]` so the matching `yt-dlp-ejs` challenge
solver package is present, and it enables the bundled Node.js runtime for yt-dlp
through `/etc/yt-dlp.conf`. Do not replace this with user-configurable yt-dlp
flags; arbitrary yt-dlp args are intentionally not exposed through Settings/UI/API.

### Deploy a new version

```bash
# From a clean, committed release tree. This runs all gates, builds and pushes
# both images to registry.lamanoriega.com, installs versioned NAS runtime files,
# starts through Doppler-aware start.sh, verifies auth/cost/scheduler state, and
# restores the previous deployment files automatically if verification fails.
scripts/deploy-nas.sh <VERSION>

# Explicit rollback uses retained registry tags.
scripts/deploy-nas.sh --rollback <PREVIOUS_VERSION>
```

The previous `docker save | ssh docker load` procedure remains an emergency
fallback, not the normal deployment path. NAS builds remain prohibited.

### Verification checklist

- [ ] `/health` returns OK with correct version
- [ ] `/runs` without API key returns 401
- [ ] `/runs` with API key returns 200
- [ ] Web UI loads and shows correct version
- [ ] `/metrics/cost` with API key returns `enforcement: enforce` and the approved limits
- [ ] `/status/media-pipeline` returns a sanitized status document without auth
- [ ] The web origin `/api/status/media-pipeline` returns the same public status
      without an operator session
- [ ] `/v1/intakes` and `/v1/transcripts` reject unauthenticated requests and
      return reconciliation data with the operator API key
- [ ] The Cortex transcript bearer lists/fetches transcripts but receives 401
      from `/metrics`, settings, runs, intakes, and every write route
- [ ] `Y2T_TRANSCRIPT_READY_URL` is unset unless the reviewed contract version
      and producer/consumer commit SHAs are recorded

For server-specific deployment details (paths, credentials, workarounds), see the
private infrastructure documentation.
