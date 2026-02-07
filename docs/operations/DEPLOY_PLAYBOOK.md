# Deploy Playbook (Single-Tenant Admin)

This playbook documents a pragmatic server deployment for Youtube2Text as a single-tenant (admin-only) service.
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

## Strongly recommended (servers)

- `Y2T_API_KEY` (required; enforces `X-API-Key` on all API endpoints except `GET /health`)
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
2) `Y2T_CORS_ORIGINS` set to specific origins (avoid `*`).
3) `Y2T_WEBHOOK_ALLOWED_DOMAINS` set (explicit allowlist).
4) `Y2T_WEBHOOK_SECRET` set (HMAC signatures enabled).
5) `Y2T_HEALTH_DEEP_PUBLIC=false` (deep health requires auth).
6) If using a proxy: `Y2T_TRUST_PROXY=true` only when behind a trusted proxy.
7) API not exposed publicly if avoidable; otherwise ensure rate limits are enabled.

## Reverse proxy (recommended)

Terminate TLS in a reverse proxy (Caddy/Nginx/Traefik) and forward:
- `https://y2t.example.com/` -> web container `:3000`
- Optionally: do not expose the API port at all; the web UI proxies `/api/*`.

## Health and ops

- Basic health: `GET /health`
- Deep health (deps + disk + persistence): `GET /health?deep=true` (requires API key unless `Y2T_HEALTH_DEEP_PUBLIC=true`)
- Manual retention cleanup: `POST /maintenance/cleanup`

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

## Suggested deployment steps (high level)

1) Copy `docker-compose.yml` to your server.
2) Provide env vars (`.env` file, Doppler, or shell env):
   - `ASSEMBLYAI_API_KEY`
   - `Y2T_API_KEY` (recommended)
   - `Y2T_CORS_ORIGINS` (recommended)
3) Run: `docker compose up --build -d`
4) Verify:
   - Web loads at your domain
   - `GET /health?deep=true` reports `ok: true`
5) Periodically check disk usage and retention settings.
