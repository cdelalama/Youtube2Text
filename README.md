<!-- doc-version: 0.36.1 -->
# Media2Text

Media2Text is the visible product name for the `youtube2text` engine: a
local-first, modular CLI/API/Web service that:
1. Enumerates videos from a public YouTube channel, playlist, or a single video URL.
2. Accepts direct local audio input without YouTube.
3. Downloads audio-only tracks using `yt-dlp` when the source is YouTube.
4. Transcribes audio with AssemblyAI (diarization), Deepgram (diarization), or OpenAI Whisper API.
5. Stores structured results on disk for later analysis or UI browsing.

Technical naming contract: `youtube2text`, `youtube2text-api`,
`youtube2text-web`, and all `Y2T_` environment variables are intentional
runtime identifiers. Do not rename them to match the Media2Text brand.

The goal is to keep each stage separable and replaceable (e.g., swapping AssemblyAI for another ASR provider, adding semantic post-processing, or attaching a web dashboard).

Quick links:
- Practical walkthrough: `HOW_TO_USE.md`
- Integration guide (curl/n8n/webhooks): `INTEGRATION.md`
- LLM snapshot/roadmap: `docs/llm/HANDOFF.md`
- Deployment playbook (single-tenant admin): `docs/operations/DEPLOY_PLAYBOOK.md`
- Versioning policy: `docs/VERSIONING_RULES.md`
- Docs/versioning roadmap: `docs/operations/DOCS_VERSIONING_ROADMAP.md`

## Core Capabilities

- Channel/playlist enumeration via `yt-dlp --flat-playlist` (no YouTube API key required).
- Audio-only download in `mp3` or `wav`.
- AssemblyAI upload + diarized transcription (`speaker_labels: true`), Deepgram diarized transcription, or OpenAI Whisper API (no diarization).
- Idempotent processing: skips videos already processed unless forced.
- Output formats: `.json` (canonical), readable `.txt` + `.md` (timestamps + wrapping), `.jsonl` (LLM-friendly, one utterance per line), optional `.csv`.
- Optional per-video comments dump via `yt-dlp` into `.comments.json`.
- Optional per-video metadata sidecar `.meta.json` for browsing/indexing.
- Fault handling with retries/backoff and per-video error logs.
- Automatic audio splitting when provider size limits are exceeded (overlap trimmed).
- Direct local audio input (skip yt-dlp download stage) via CLI or API.
- Library UX: channel avatars are best-effort from yt-dlp metadata (stored in `output/<channelDir>/_channel.json`). If a channel folder was created before avatars existed (or before v0.9.2), rerun that channel (or any video from it) once to populate the thumbnail URL.

## Architecture (High Level)

Pipeline stages with explicit module boundaries:

- **InputResolver**: resolves a channel/playlist URL to a list of video IDs and metadata.
- **AudioExtractor**: downloads and caches audio tracks locally.
- **TranscriptionProvider**: interface for ASR backends (AssemblyAI + Deepgram + OpenAI Whisper).
- **Formatter**: converts diarized transcript JSON into `.txt`, `.md`, `.jsonl` and optional `.csv` formats.
- **Storage**: writes outputs and handles idempotency checks.
- **Orchestrator (CLI)**: coordinates stages with concurrency, filtering, retries, and logging.

Later extensions read from `output/` only (e.g., React dashboard), keeping the pipeline server-agnostic.

## Requirements

- Node.js 18+
- `yt-dlp` installed and available on PATH (system dependency)
- AssemblyAI API key (required when `sttProvider=assemblyai`)
- Deepgram API key (required when `sttProvider=deepgram`)
- OpenAI API key (required when `sttProvider=openai_whisper`)
- Windows/macOS/Linux

### Production Note

For local development, Media2Text relies on a system-installed `yt-dlp`.
When deploying to a server or container, ensure `yt-dlp` is installed in that environment as well. For the HTTP API runner, a Docker image/docker-compose setup is included (see "Docker (API runner)" below).

### Troubleshooting yt-dlp on Windows

If you installed `yt-dlp` via `winget`, PowerShell can sometimes resolve it via an alias while child processes (like Node.js) cannot.
If Media2Text reports "yt-dlp not found" but `yt-dlp --version` works in your shell, restart the shell or ensure the real `yt-dlp.exe` path is on PATH.
The pipeline also attempts to resolve the executable via PowerShell automatically.

If VSCode's integrated terminal still cannot find it, set an explicit path (preferred `Y2T_YT_DLP_PATH`, legacy `YT_DLP_PATH` also supported):

```powershell
$env:Y2T_YT_DLP_PATH="C:\path\to\yt-dlp.exe"
npm run dev
```

You can also pass an explicit path via CLI or `runs.yaml`:

```powershell
npm run dev -- --ytDlpPath "C:\Users\cdela\AppData\Local\Microsoft\WinGet\Links\yt-dlp.exe"
```

### OpenAI Whisper API

If you set `sttProvider=openai_whisper`, provide `OPENAI_API_KEY` (or `Y2T_OPENAI_API_KEY`).
Whisper API does not provide speaker diarization.

### Deepgram API

If you set `sttProvider=deepgram`, provide `DEEPGRAM_API_KEY` (or `Y2T_DEEPGRAM_API_KEY`).
Deepgram supports speaker diarization.

### yt-dlp extractor warnings (public videos)

If you see warnings about a missing JavaScript runtime (EJS), upgrade `yt-dlp` and install a supported JS runtime as documented by yt-dlp (this project does not expose arbitrary yt-dlp flags via Settings/UI/API for security reasons).

Note: Media2Text only targets public videos. If a channel contains members-only/private/age-restricted videos, yt-dlp will fail for those and Media2Text will record the failure and continue with the rest.

## Configuration

Configuration is loaded (lowest to highest precedence) from:

1. Optional `output/_settings.json` for non-secret defaults (created via `GET/PATCH /settings` or the web UI Settings page).
2. Optional `config.yaml` for non-secret defaults.
3. Environment variables — provided via `.env` file **or** a secrets manager such as [Doppler](https://www.doppler.com/).

Per-run overrides (CLI flags, `runs.yaml`, `POST /runs` request fields) override these defaults for that run.

### Secrets management

You can provide secrets (API keys, auth tokens) in two ways:

| Method | When to use |
|--------|-------------|
| `.env` file | Local development on a single machine. Copy `.env.example` to `.env` and fill in your keys. |
| [Doppler](https://www.doppler.com/) | Recommended for teams or multi-machine setups. Secrets are stored centrally and injected at runtime — no `.env` file needed. |

**Using Doppler:**

```bash
# One-time setup (per machine)
doppler login
cd ~/src/youtube2text
doppler setup          # select project + environment

# Run with secrets injected
doppler run -- npm run dev:api
doppler run -- npm run dev
doppler run -- docker compose up --build
```

When using Doppler, you do not need a `.env` file. Both methods use the same environment variable names documented below.

Example environment variables:

```
ASSEMBLYAI_API_KEY=your_key_here
Y2T_ASSEMBLYAI_API_KEYS=key1,key2
DEEPGRAM_API_KEY=your_key_here
Y2T_DEEPGRAM_API_KEYS=key1,key2
OPENAI_API_KEY=your_openai_key_here
Y2T_OPENAI_API_KEY=
Y2T_OUTPUT_DIR=output
Y2T_AUDIO_DIR=audio
Y2T_STT_PROVIDER=assemblyai
Y2T_OPENAI_WHISPER_MODEL=whisper-1
Y2T_DEEPGRAM_MODEL=nova-3
Y2T_DEEPGRAM_DIARIZATION=true
Y2T_MAX_AUDIO_MB=
Y2T_SPLIT_OVERLAP_SECONDS=2
Y2T_FILENAME_STYLE=title_id   # id | id_title | title_id
Y2T_AUDIO_FORMAT=mp3
Y2T_LANGUAGE_CODE=en_us
Y2T_LANGUAGE_DETECTION=auto   # auto | manual
Y2T_CONCURRENCY=2
Y2T_MAX_NEW_VIDEOS=
Y2T_AFTER_DATE=
Y2T_CSV_ENABLED=false
Y2T_ASSEMBLYAI_CREDITS_CHECK=warn   # warn | abort | none
Y2T_ASSEMBLYAI_MIN_BALANCE_MINUTES=60
Y2T_COMMENTS_ENABLED=true
Y2T_COMMENTS_MAX=100
Y2T_CATALOG_MAX_AGE_HOURS=168
Y2T_MAX_UPLOAD_MB=1024
Y2T_ASSEMBLYAI_KEY_FAILURES=2
Y2T_ASSEMBLYAI_KEY_COOLDOWN_MS=60000
Y2T_DEEPGRAM_KEY_FAILURES=2
Y2T_DEEPGRAM_KEY_COOLDOWN_MS=60000
```

Notes:
- Boolean env vars like `Y2T_CSV_ENABLED` / `Y2T_COMMENTS_ENABLED` only override config when set; accepted truthy values: `true`, `1`, `yes`.
- For consistency, prefer `Y2T_*` env vars. Legacy unprefixed names (e.g. `OUTPUT_DIR`, `CONCURRENCY`, `COMMENTS_ENABLED`, `YT_DLP_PATH`) are still supported.
- `Y2T_STT_PROVIDER` selects the speech-to-text backend (`assemblyai`, `deepgram`, or `openai_whisper`).
- `Y2T_OPENAI_WHISPER_MODEL` sets the OpenAI Whisper model (default `whisper-1`).
- `OPENAI_API_KEY` / `Y2T_OPENAI_API_KEY` provide OpenAI credentials.
- `DEEPGRAM_API_KEY` / `Y2T_DEEPGRAM_API_KEY` provide Deepgram credentials.
- `Y2T_DEEPGRAM_MODEL` sets the Deepgram model (default `nova-3`).
- `Y2T_DEEPGRAM_DIARIZATION` enables speaker diarization in Deepgram (default `true`).
- `Y2T_ASSEMBLYAI_API_KEYS` enables multi-key failover for AssemblyAI (comma-separated).
- `Y2T_DEEPGRAM_API_KEYS` enables multi-key failover for Deepgram (comma-separated).
- `Y2T_MAX_AUDIO_MB` sets a per-file audio size cap before splitting (provider limit applies if lower).
- `Y2T_SPLIT_OVERLAP_SECONDS` sets overlap between chunks (default 2s).
- API/settings inputs are normalized server-side: numeric fields are clamped to safe bounds, `afterDate` must be YYYY-MM-DD, and manual `languageCode` must be a supported AssemblyAI code (OpenAI Whisper accepts primary codes).

Example files:

- `.env.example` - template of supported env vars (copy to `.env`, or import into Doppler).
- `config.yaml.example` - optional non-secret defaults (copy to `config.yaml`).
- `runs.yaml.example` - optional batch runs template (copy to `runs.yaml` or `runs.yml`).
- `output/_settings.json` - optional non-secret defaults persisted by the API/web UI (never commit this file).

## CLI Usage

```
youtube2text [channel_or_playlist_or_video_url] [options]
```

Options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--audio` | path | unset | Transcribe a local audio file instead of YouTube. |
| `--audioTitle` | string | unset | Title to use for a local audio run. |
| `--maxNewVideos` | number | unset | Process at most N NEW (unprocessed) videos (limit is applied after skipping already-processed videos). |
| `--after` | date | unset | Only process videos after YYYY-MM-DD. |
| `--outDir` | path | `output` | Output root directory. |
| `--audioDir` | path | `audio` | Audio cache directory. |
| `--filenameStyle` | `id|id_title|title_id` | `title_id` | Output/audio filename style. |
| `--audioFormat` | `mp3|wav` | `mp3` | Audio download format. |
| `--sttProvider` | `assemblyai|deepgram|openai_whisper` | `assemblyai` | Speech-to-text provider. |
| `--deepgramModel` | string | `nova-3` | Deepgram model (only for `sttProvider=deepgram`). |
| `--deepgramDiarization` | `true|false` | `true` | Deepgram diarization (only for `sttProvider=deepgram`). |
| `--openaiWhisperModel` | string | `whisper-1` | OpenAI Whisper model (only for `sttProvider=openai_whisper`). |
| `--maxAudioMB` | number | unset | Max audio size before splitting (provider limit applies if lower). |
| `--splitOverlapSeconds` | number | `2` | Overlap seconds between chunks when splitting. |
| `--language` | string | `en_us` | Language code used when manual. |
| `--languageDetection` | `auto|manual` | `auto` | Detect language per video via yt-dlp metadata/captions; if undetected, fall back to provider automatic language detection. |
| `--concurrency` | number | `2` | Parallel videos processed. |
| `--force` | boolean | false | Reprocess even if outputs exist. |
| `--csv` | boolean | false | Emit `.csv` alongside `.json`/`.txt`. |
| `--assemblyAiCreditsCheck` | `warn|abort|none` | `warn` | Preflight AssemblyAI credits check mode (only for `sttProvider=assemblyai`). |
| `--assemblyAiMinBalanceMinutes` | number | `60` | Warn/abort if remaining credits below N minutes. |
| `--comments` | boolean | true | Fetch comments via yt-dlp and save `.comments.json`. |
| `--commentsMax` | number | 100 | Limit comments per video when fetching. |
| `--json-events` | boolean | false | Emit JSONL pipeline events to stdout (logs go to stderr). |

Note: The CLI accepts only YouTube URLs by default. Override (not recommended): set `Y2T_RUN_ALLOW_ANY_URL=true`.

### Incremental backfills (`maxNewVideos`)

`maxNewVideos` is designed for incremental channel backfills:

- The limit is applied **after** skipping already-processed videos, so repeated runs can naturally continue the backfill ("10 now, 10 later").
- With `--force`, every video is treated as "unprocessed", so `--maxNewVideos` becomes "reprocess up to N videos" (typically the newest N). This can spend transcription credits again.

## HTTP API (experimental)

This project also ships an optional local HTTP API runner. It does not replace the CLI.

Run in dev mode:

```powershell
npm run dev:api
```

Or build and run:

```powershell
npm run build
npm run api
```

Defaults:
- Listens on `http://127.0.0.1:8787` (set `HOST`/`PORT` to override)

Persistence (default enabled):
- Runs and SSE events are persisted under `output/_runs/<runId>/` so restarts do not lose history.
- Disable with `Y2T_API_PERSIST_RUNS=false`.
- Override directory with `Y2T_API_PERSIST_DIR=...`.

Auth (required for server/Docker):
- `Y2T_API_KEY` is required to run the HTTP API server (clients must send `X-API-Key: ...`, except `GET /health`).
  - For local development only, you can set `Y2T_ALLOW_INSECURE_NO_API_KEY=true` **and** `Y2T_ALLOW_INSECURE_NO_API_KEY_CONFIRM=I_UNDERSTAND` to start the API server without auth.
- Example:
  - `curl -H "X-API-Key: $Y2T_API_KEY" http://127.0.0.1:8787/runs`

Rate limiting (write endpoints):
- In-memory rate limit for `POST/PATCH/DELETE` (per API key or IP).
- Configure via env:
  - `Y2T_RATE_LIMIT_WRITE_MAX` (default `60`, set `0` to disable)
  - `Y2T_RATE_LIMIT_WINDOW_MS` (default `60000`)
- Exceeded limits return HTTP 429 with `Retry-After`.
 - Uses a token-bucket refill to avoid fixed-window bursts.

Rate limiting (read endpoints):
- Optional in-memory rate limit for `GET` endpoints (per API key or IP).
- Configure via env:
  - `Y2T_RATE_LIMIT_READ_MAX` (default `300`, set `0` to disable)
  - `Y2T_RATE_LIMIT_READ_WINDOW_MS` (default `60000`)
 - Uses a token-bucket refill to avoid fixed-window bursts.

Deep health throttle:
- `Y2T_RATE_LIMIT_HEALTH_MAX` (default `30`) and `Y2T_RATE_LIMIT_HEALTH_WINDOW_MS` (default `60000`).
- `Y2T_HEALTH_DEEP_PUBLIC` (default `false`) to allow unauthenticated `GET /health?deep=true`.
- `Y2T_HEALTH_INCLUDE_PATHS` (default false) to include filesystem paths in deep health output.

Run timeout safety net:
- `Y2T_RUN_TIMEOUT_MINUTES` (default `240`, set `0` to disable) marks a run as `error` if it stays `running` too long.

Null handling:
- For optional API inputs, `null` is treated as "unset" (e.g. `maxNewVideos`, `afterDate`, `intervalMinutes` on watchlist create).

Graceful shutdown (server/Docker):
- On `SIGTERM`/`SIGINT`, the API stops the scheduler and requests cancellation for queued/running runs, then waits up to `Y2T_SHUTDOWN_TIMEOUT_SECONDS` before exiting.

CORS (recommended for server deployments):
- By default the API sends no CORS headers (browser access blocked).
- To allow browser access from specific origins, set `Y2T_CORS_ORIGINS` (comma-separated), e.g.:
  - `Y2T_CORS_ORIGINS=https://your-admin.example.com,http://localhost:3000`

Request body size limit:
- `Y2T_MAX_BODY_BYTES` (default 1,000,000). Requests above this limit return 413.

Audio upload limit:
- `Y2T_MAX_UPLOAD_MB` (default 1024). Uploads above this limit return 413.

Auth failure rate limiting (brute-force protection):
- `Y2T_AUTH_FAIL_MAX` (default 30) and `Y2T_AUTH_FAIL_WINDOW_MS` (default 60000).
- If the API runs behind a trusted reverse proxy, set `Y2T_TRUST_PROXY=true` and `Y2T_TRUST_PROXY_IPS=<proxy_ip[,proxy_ip]>` to rate-limit by `X-Forwarded-For`/`X-Real-IP`.
- `Y2T_API_KEY_MAX_BYTES` (default 256) caps the `X-API-Key` header size.
- `Y2T_API_KEY_MIN_BYTES` (default 32) enforces a minimum API key length.

SSE connection limit:
- `Y2T_SSE_MAX_CLIENTS` (default 1000, set `0` to disable) caps concurrent SSE clients to avoid FD exhaustion.
- `Y2T_SSE_MAX_CLIENTS_PER_IP` (default 50) caps SSE clients per source IP.
- `Y2T_SSE_MAX_LIFETIME_SECONDS` (default 0 disables) closes long-lived SSE streams to prevent resource leaks.
- `Y2T_MAX_BUFFERED_EVENTS_PER_RUN` (default `5000`) - Maximum events buffered per run for SSE replay.
- `Y2T_MAX_EVENT_BYTES` (default 65536) clamps oversized SSE events.

Request timeout:
- `Y2T_REQUEST_TIMEOUT_MS` (default 30000, set `0` to disable) bounds non-SSE request lifetime.
- `Y2T_UPLOAD_TIMEOUT_MS` (default 120000) bounds multipart upload lifetime.
- `Y2T_EXEC_MAX_BYTES` (default 50MB) caps stdout+stderr captured from external commands.

Retention / cleanup (ops hardening):
- Configure via env:
  - `Y2T_RETENTION_RUNS_DAYS` (default `30`, set `-1` to disable)
  - `Y2T_RETENTION_AUDIO_DAYS` (default `7`, set `-1` to disable)
- Cleanup scope:
  - Deletes only run persistence under `output/_runs/*` and old audio cache under `audio/*`
  - Never deletes transcripts under `output/<channelDir>/*`
- Cleanup triggers:
  - Best-effort automatic cleanup on API startup
  - Manual: `POST /maintenance/cleanup`

Scheduler / watchlist (Phase 2.3, opt-in):
- Maintain a list of followed channels via `POST /watchlist`.
- The in-process scheduler periodically calls `POST /runs/plan` and creates a run only when `toProcess > 0`.
- Enable with:
  - `Y2T_SCHEDULER_ENABLED=true`
  - `Y2T_SCHEDULER_INTERVAL_MINUTES=60` (default)
  - `Y2T_SCHEDULER_MAX_CONCURRENT_RUNS=1` (default)
- By default, watchlist entries are intended to be channel/playlist URLs (recurring sources). Set `Y2T_WATCHLIST_ALLOW_ANY_URL=true` to override (not recommended).
- Manual testing:
  - `POST /scheduler/trigger`

Monitoring:
- `GET /metrics` exposes Prometheus text metrics (requires `X-API-Key`).
  - Includes catalog cache counters: `y2t_catalog_cache_hit_total`, `y2t_catalog_cache_miss_total`, `y2t_catalog_cache_expired_total`, `y2t_catalog_full_refresh_total`, `y2t_catalog_incremental_refresh_total`, `y2t_catalog_incremental_added_videos_total`.

Webhooks (optional, production guidance):
- `POST /runs` supports `callbackUrl`. The API sends a POST webhook when the run ends:
  - `run:done` when status becomes `done`
  - `run:error` when status becomes `error`
  - `run:cancelled` when status becomes `cancelled`
- `callbackUrl` must be http(s) and is blocked for localhost/private IPs by default.
- Hostnames are resolved and blocked if they resolve to private/loopback IPs (DNS rebinding protection).
- Strongly recommended in production: set `Y2T_WEBHOOK_ALLOWED_DOMAINS` to an explicit allowlist.
- Webhooks do not follow redirects (redirects return an error to prevent SSRF).
- Optional domain allowlist: `Y2T_WEBHOOK_ALLOWED_DOMAINS=example.com,sub.example.com`
- Optional replay window: `Y2T_WEBHOOK_MAX_AGE_SECONDS` adds `X-Y2T-Max-Age` to headers.
- Delivery settings:
  - `Y2T_WEBHOOK_RETRIES` (default `3`) - Number of retry attempts for failed deliveries.
  - `Y2T_WEBHOOK_TIMEOUT_MS` (default `5000`) - Request timeout per attempt in milliseconds.
- If `Y2T_WEBHOOK_SECRET` is set, requests include:
  - `X-Y2T-Timestamp` (ISO timestamp)
  - `X-Y2T-Signature` (`sha256=<hex>`), where HMAC-SHA256 is computed over `${timestamp}.${body}`

STT provider selection:
- `Y2T_STT_PROVIDER` selects the speech-to-text provider (`assemblyai`, `deepgram`, or `openai_whisper`).
- Deepgram uses `DEEPGRAM_API_KEY`/`Y2T_DEEPGRAM_API_KEY` and `Y2T_DEEPGRAM_MODEL` (default `nova-3`).
- OpenAI Whisper uses `OPENAI_API_KEY`/`Y2T_OPENAI_API_KEY` and `Y2T_OPENAI_WHISPER_MODEL` (default `whisper-1`).
- `Y2T_ASSEMBLYAI_CREDITS_CHECK` only applies when `sttProvider=assemblyai`.
- `Y2T_MAX_AUDIO_MB` sets a per-file audio size cap before splitting (provider limit applies if lower).
- `Y2T_SPLIT_OVERLAP_SECONDS` sets overlap between chunks (default 2s).

Run limiting:
- `Y2T_MAX_CONCURRENT_RUNS_PER_KEY` (default 0 disables) caps concurrent queued/running runs per API key.
- By default, `POST /runs` and `POST /runs/plan` accept YouTube URLs only. Set `Y2T_RUN_ALLOW_ANY_URL=true` to allow non-YouTube URLs (not recommended).
- `maxNewVideos` has the same semantics as the CLI: the limit is applied after skipping already-processed videos (incremental backfills). With `force=true`, it becomes "reprocess up to N videos".

Endpoints:
- `GET /health`
- `GET /health?deep=true` (best-effort deps + disk + persistence checks; requires `X-API-Key` unless `Y2T_HEALTH_DEEP_PUBLIC=true`)
- `GET /providers` (provider capabilities: max upload size, diarization support)
- `GET /metrics` (Prometheus text format)
- `POST /maintenance/cleanup` (retention cleanup for `output/_runs/*` + old audio cache)
- `POST /audio` (upload local audio, returns `audioId`)
- `GET /settings`, `PATCH /settings` (persist non-secret defaults to `output/_settings.json`)
- `GET /watchlist`, `POST /watchlist`, `PATCH /watchlist/:id`, `DELETE /watchlist/:id` (followed channels list)
- `GET /scheduler/status`, `POST /scheduler/start|stop|trigger` (Phase 2.3, opt-in)
- `GET /events` (SSE global stream for run updates)
- `POST /runs/plan` with JSON body `{ "url": "...", "force": false, "maxNewVideos": 10, "afterDate": "2024-01-01" }` (enumerate + skip counts, no transcription)
- `POST /runs` with JSON body `{ "url": "...", "force": false, "maxNewVideos": 10, "afterDate": "2024-01-01", "callbackUrl": "https://..." }` (cache-first for single-video URLs)
- `POST /runs` with JSON body `{ "audioId": "...", "callbackUrl": "https://..." }` (transcribe an uploaded audio file)
- `GET /runs`
- `GET /runs/:id`
- `POST /runs/:id/cancel`
- `GET /runs/:id/logs?tail=200` (JSON tail of recent events; convenience alternative to SSE)
- `GET /runs/:id/events` (SSE, supports `Last-Event-ID`)
- `GET /runs/:id/artifacts`
- `GET /library/channels`
- `GET /library/channels/:channelDirName`
- `GET /library/channels/:channelDirName/videos`
- `GET /library/channels/:channelDirName/videos/:basename/:kind` where `kind` is `txt|md|json|jsonl|meta|comments|csv|audio`
- `DELETE /library/channels/:channelDirName` (delete channel: output dir + audio dir + catalog cache; returns 409 if active run targets channel)
- `DELETE /library/channels/:channelDirName/videos/:basename` (delete single video: all file variants + audio)

## Docker (API runner)

Docker runs the HTTP API runner (and optionally the web UI via docker-compose). It does not replace the CLI.

Note: the Docker image includes a container healthcheck that polls `GET /health`.

Prerequisites:
- Docker + Docker Compose
- `ASSEMBLYAI_API_KEY` available as an environment variable

Run:

```powershell
$env:ASSEMBLYAI_API_KEY="your_key_here"
$env:Y2T_API_KEY="your_admin_key_here"
docker compose up --build
```

Open:
- Web UI: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:8787`

Data is persisted locally via bind mounts:
- `./output` -> `/data/output` (includes `output/_runs/` for persisted runs/events)
- `./audio` -> `/data/audio`

Optional (reproducible builds): pin `yt-dlp` version at build time:

```powershell
docker build --build-arg YT_DLP_VERSION=2025.01.01 -t youtube2text-api .
```

### Docker smoke test (no credits)

This repo includes a no-credit smoke test that:
1) builds the Docker image
2) starts the API container
3) checks `GET /health`, `GET /runs`, and `GET /settings`
4) stops the container

Run:

```powershell
npm run test:docker-smoke
```

## Web UI (Next.js, Phase 1 - experimental)

This repo includes an admin UI built with Next.js. It reads existing outputs via the API and streams run progress via SSE. It does not replace the CLI.
It can also start runs via the API (`POST /runs`).
The runs list auto-updates via the global SSE stream (`GET /events`).
The run detail page auto-updates the Downloads list as videos finish (no manual refresh).

Run locally (two terminals):

```powershell
npm run dev:api
```

```powershell
cd web
npm install
npm run dev
```

Defaults:
- Web: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:8787`

Pages:
- Runs: `/`
- Library: `/library`
- Watchlist: `/watchlist` (manage scheduler sources; per-entry interval override in hours + "Run now")
- Settings: `/settings` (persist non-secret defaults to `output/_settings.json`)

Library channel pages include quick actions (Open on YouTube / Copy URL / Run this channel) and can compute channel totals on-demand via `POST /runs/plan`.

### Exact channel totals performance

Exact totals require enumerating the full channel listing via yt-dlp (which can be 1000+ videos). To keep planning exact but fast on subsequent requests, the pipeline caches:

- Channel catalog: `output/_catalog/<channelId>.json` (full list; first time is expensive, then refreshes incrementally).
- Processed index: built by scanning `output/<channelDir>/*.json` transcript files once per plan/run (avoids per-video existence checks for the entire channel listing).
- TTL: set `Y2T_CATALOG_MAX_AGE_HOURS` (default `168`). When exceeded, the next plan/run forces a full refresh of the catalog.
- When the TTL expires, the app logs: `[catalog] Cache expired ... forcing full refresh`.

Run via Docker Compose (API + Web):

```powershell
$env:ASSEMBLYAI_API_KEY="your_key_here"
docker compose up --build
```

### runs.yaml (optional)

If you run the CLI **without** providing a URL, and a `runs.yaml` (or `runs.yml`) file exists in the project root, Media2Text will execute each run in sequence. Each run can use either `url` (YouTube channel/playlist/video) or `audioPath` (local file).

YAML must use spaces (no tabs). You can use either:

- Object form (recommended):
  ```yaml
  runs:
    - url: "https://..."
  ```
- Root array form:
  ```yaml
  - url: "https://..."
  - url: "https://..."
  ```

Example `runs.yaml`:

```yaml
runs:
  - url: "https://www.youtube.com/@somechannel"
    maxNewVideos: 10
    after: "2024-01-01"
    concurrency: 2
    csvEnabled: false

  - url: "https://www.youtube.com/playlist?list=PLxxxx"
    maxNewVideos: 5
    after: "2023-06-01"
    outDir: "output_alt"
    audioDir: "audio_alt"
    csvEnabled: true
    force: false

  - audioPath: "C:\\path\\to\\local-audio.mp3"
    audioTitle: "Local audio sample"
    outDir: "output_alt"
    audioDir: "audio_alt"
    sttProvider: openai_whisper
    openaiWhisperModel: whisper-1
```

Fields in `runs.yaml` override defaults from `config.yaml`/`.env` for that specific run.

## Output Layout

Outputs are organized by channel folder named `<channel_title_slug>__<channel_id>` when available. Filenames depend on `filenameStyle` (default `title_id`):

```
output/<channel_title_slug>__<channel_id>/<title_slug>__<video_id>.json   # default title_id
output/<channel_title_slug>__<channel_id>/<video_id>.json                # filenameStyle=id
output/<channel_title_slug>__<channel_id>/<video_id>__<title_slug>.json  # filenameStyle=id_title
output/<channel_title_slug>__<channel_id>/<basename>.md                  # markdown transcript
output/<channel_title_slug>__<channel_id>/<basename>.jsonl               # utterances as JSONL (one per line)
output/<channel_title_slug>__<channel_id>/<basename>.comments.json       # if comments enabled
output/<channel_title_slug>__<channel_id>/<basename>.meta.json           # per-video metadata
output/<channel_title_slug>__<channel_id>/_channel.json                  # per-channel metadata
```

Raw audio is stored under:

```
audio/<channel_title_slug>__<channel_id>/<title_slug>__<video_id>.<ext>  # default title_id
```

Uploaded local audio is copied into a dedicated channel folder:

```
audio/uploads/<title_slug>__<audio_id>.<ext>
output/uploads/<title_slug>__<audio_id>.* (transcripts + meta)
```
Failures are recorded per channel in:

```
output/<channel_title_slug>__<channel_id>/_errors.jsonl
```

## Idempotency & Retries

- A video is considered processed if the expected JSON file exists under the current `filenameStyle`.
- Reprocessing requires `--force`.
- Download and transcription retries are handled independently with exponential backoff.

Audio splitting:
- If the audio exceeds the effective limit (provider limit, optionally lowered by `Y2T_MAX_AUDIO_MB`), the pipeline splits the audio, transcribes chunks, and merges timestamps while trimming the overlap.

Polling and retry configuration (optional):
- `Y2T_POLL_INTERVAL_MS` (default `5000`) - Polling interval for AssemblyAI transcription status.
- `Y2T_MAX_POLL_MINUTES` (default `60`) - Maximum polling time before timeout.
- `Y2T_DOWNLOAD_RETRIES` (default `2`) - Retry count for yt-dlp download failures.
- `Y2T_TRANSCRIPTION_RETRIES` (default `2`) - Retry count for AssemblyAI transcription failures.
- `Y2T_PROVIDER_TIMEOUT_MS` (default `120000`) - Abort provider API calls after this many milliseconds.

## Roadmap

- DONE: Phase 0 (core service hardening), Phase 1 (local-first web UI), Phase 2 (single-tenant hosted admin), Phase 3.0 (direct audio input).
- DONE: Security hardening roadmaps v7 and v8 (P0/P1/P2).
- DONE: Feature Mining Phases A/B/C (atomic writes + provider timeouts, multi-key load balancer, Deepgram provider).
- NEXT (optional): Feature Mining Phase D (error categorization + ETA estimation).
- NEXT (optional): Phase 3+ multi-tenant cloud platform.

## Testing

Run unit tests:

```powershell
npm test
```

Build TypeScript output:

```powershell
npm run build
```
