# How to Use Youtube2Text

This is a practical usage guide for this repository (not a scaffold).

Most users should start with `README.md`. If you are integrating this into another system, also read `INTEGRATION.md`.

## What you can do

- Run the CLI to transcribe a channel/playlist/video URL into local artifacts.
- Run the CLI or API to transcribe a local audio file.
- Run the local HTTP API runner to start runs and stream progress via SSE.
- Use the Next.js admin UI (minimal) as a local control panel over the API.
- Deploy API+Web via Docker Compose (still CLI-compatible; CLI is not removed).

## Secrets

Secrets (API keys, auth tokens) can be provided via a `.env` file or via [Doppler](https://www.doppler.com/) secrets manager.

With **`.env`**: copy `.env.example` to `.env` and fill in your keys.

With **Doppler** (recommended for multi-machine setups): run `doppler login`, then `doppler setup` in the project directory. Prefix any command with `doppler run --` to inject secrets automatically (no `.env` file needed).

All quickstart examples below assume secrets are available in the environment (via either method).

## Quickstart (CLI)

1) Install dependencies:

```powershell
npm install
```

2) Configure AssemblyAI:

```powershell
$env:ASSEMBLYAI_API_KEY="your_key_here"
```

Or, with Doppler: `doppler run -- npm run dev -- https://...` (skip step 2).

3) Run a URL:

```powershell
npm run dev -- https://www.youtube.com/@SomeChannel
```

Optional: limit the run to N new (unprocessed) videos:

```powershell
npm run dev -- --maxNewVideos 10 https://www.youtube.com/@SomeChannel
```

Outputs go to `output/` and `audio/`.

Optional: transcribe a local audio file (skip yt-dlp):

```powershell
npm run dev -- --audio "C:\path\to\local-audio.mp3" --audioTitle "Local audio"
```

Note: the Library page shows channel avatars when available. These are best-effort from yt-dlp metadata (stored in `output/<channelDir>/_channel.json`). If a channel folder was created before avatars existed (or before v0.9.2), rerun that channel (or any video from it) once to populate the thumbnail URL.

## Quickstart (API + Web in dev)

Terminal 1:

```powershell
$env:ASSEMBLYAI_API_KEY="your_key_here"
$env:Y2T_API_KEY="dev_key"
npm run dev:api
```

Terminal 2:

```powershell
cd web
npm install
npm run dev
```

Open:
- Web UI: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:8787`

## Quickstart (Docker Compose)

```powershell
$env:ASSEMBLYAI_API_KEY="your_key_here"
$env:Y2T_API_KEY="your_admin_key_here"   # required unless Y2T_ALLOW_INSECURE_NO_API_KEY=true + confirm
docker compose up --build
```

Or, with Doppler: `doppler run -- docker compose up --build`.

## Auth (important)

- The API refuses to start unless `Y2T_API_KEY` is set.
- For local development only, set `Y2T_ALLOW_INSECURE_NO_API_KEY=true` and `Y2T_ALLOW_INSECURE_NO_API_KEY_CONFIRM=I_UNDERSTAND` to run without auth.
- When `Y2T_API_KEY` is set, clients must send `X-API-Key` to the API (except `GET /health`; deep health requires a key unless `Y2T_HEALTH_DEEP_PUBLIC=true`).

The web UI does not expose the key to the browser; it proxies API calls via `/api/*`.

## Graceful shutdown (servers)

When the API process receives `SIGTERM`/`SIGINT` (Docker restart, deploy, Ctrl+C), it:
- stops the scheduler
- requests cancellation for queued/running runs
- waits up to `Y2T_SHUTDOWN_TIMEOUT_SECONDS` (default `60`) before exiting

## CORS (server deployments)

- By default the API sends no CORS headers (browser access blocked).
- To allow browser access, set `Y2T_CORS_ORIGINS` to a comma-separated allowlist of origins (exact match), e.g.:
  - `Y2T_CORS_ORIGINS=https://your-admin.example.com,http://localhost:3000`

## Retention / cleanup (server deployments)

- Configure via env:
  - `Y2T_RETENTION_RUNS_DAYS` (default `30`, set `-1` to disable)
  - `Y2T_RETENTION_AUDIO_DAYS` (default `7`, set `-1` to disable)
- Cleanup scope:
  - Deletes only API run persistence under `output/_runs/*` and old audio cache under `audio/*`
  - Never deletes transcripts under `output/<channelDir>/*`
- Triggers:
  - Best-effort automatic cleanup on API startup
  - Manual: `POST /maintenance/cleanup`

## Scheduler / watchlist (Phase 2.3, optional)

This is opt-in to avoid surprise runs.

- Enable:
  - `Y2T_SCHEDULER_ENABLED=true`
  - `Y2T_SCHEDULER_INTERVAL_MINUTES=60` (default)
  - `Y2T_SCHEDULER_MAX_CONCURRENT_RUNS=1` (default)
- Watchlist is intended for recurring sources (channel/playlist URLs). By default, non-channel/playlist URLs are rejected. Override (not recommended): `Y2T_WATCHLIST_ALLOW_ANY_URL=true`.
- Watchlist endpoints:
  - `POST /watchlist` with `{ "channelUrl": "https://www.youtube.com/@SomeChannel" }`
  - `GET /watchlist`
  - `PATCH /watchlist/<id>` to change `enabled` or `intervalMinutes`
  - `DELETE /watchlist/<id>`
- Scheduler endpoints:
  - `GET /scheduler/status`
  - `POST /scheduler/start`, `POST /scheduler/stop`
  - `POST /scheduler/trigger` (run one cycle now)

Web UI:
- Use `/watchlist` in the Next.js admin UI for watchlist + scheduler controls (it proxies API calls via `/api/*`).
- Per entry, you can:
  - override the interval (hours) or clear it to use the scheduler global default
  - click "Run now" (plan-first; only creates a run when there are new videos)

## Monitoring

- `GET /metrics` exposes Prometheus text metrics for server monitoring (requires `X-API-Key` if `Y2T_API_KEY` is set).

## Integration

See `INTEGRATION.md` for:
- planning runs with `POST /runs/plan`
- uploading local audio with `POST /audio`
- webhooks via `callbackUrl`
- artifact download patterns
- an n8n flow template

## Operational docs

- API contract/types: `docs/operations/API_CONTRACT.md`
- Roadmap/architecture: `docs/ARCHITECTURE.md`
- LLM handoff and decisions: `docs/llm/HANDOFF.md`, `docs/llm/DECISIONS.md`
