<!-- doc-version: 0.39.2 -->
# Media2Text Architecture (youtube2text Engine)

> Version: 0.39.0 (synced with package.json)
> Last Updated: 2026-07-15
> Status: Implemented baseline plus gated cross-project roadmap
> Authors: Claude + GPT-5.2 (viewpoints preserved)

## Overview

Media2Text ships today as a standalone CLI pipeline backed by the
`youtube2text` engine. The roadmap evolves it into:
1. A core library that can run as CLI or as a service (Phase 0).
2. A local-first web UI that reads existing outputs and can run jobs (Phase 1).
3. A hosted single-tenant service for one admin workspace (Phase 2).
4. A multi-tenant cloud platform (Phase 3+, optional).

## Non-negotiables

- CLI independence: the CLI must remain fully functional and usable without any web code.
- Shared core: web/service layers reuse the same core modules; core never depends on web.
- Local-first path to cloud: validate correctness + UX locally before committing to cloud infra.
- Public videos only: no cookies ingestion/refresh; members-only/private content is out of scope.

## Claude vs GPT Notes (kept explicit)

Claude (original intent):
- Cloud-first multi-tenant platform (Next.js + Supabase + object storage + Redis/BullMQ).
- Import the CLI core as a library inside workers.
- RLS everywhere for isolation.
- UI early to validate UX.

GPT-5.2 (adjustment):
- Insert a core hardening/service-first Phase 0 before any UI.
- Treat structured progress events as a first-class contract (no log parsing).
- Keep CLI behavior identical by default; new capabilities are opt-in flags/config.

## System Architecture (high level)

Layers:

1. Core pipeline (shared)
   - YouTube enumeration + metadata
   - Audio extraction
   - ASR provider(s)
   - Formatters
   - Storage abstraction
   - Progress/event emission

2. Runners (thin shells)
   - CLI runner (current)
   - Future HTTP API runner
   - Future worker runner (cloud)

3. UI
   - Phase 1 local-first web UI
   - Phase 2+ cloud UI

Key point: the service and UI are replaceable shells around the same core.

## Storage Strategy

Local-first artifacts on disk. Current layout:

- `output/<channel_title_slug>__<channel_id>/<basename>.json`
- `output/<channel_title_slug>__<channel_id>/<basename>.txt`
- `output/<channel_title_slug>__<channel_id>/<basename>.md`
- `output/<channel_title_slug>__<channel_id>/<basename>.jsonl`
- `output/<channel_title_slug>__<channel_id>/<basename>.csv` (optional)
- `output/<channel_title_slug>__<channel_id>/<basename>.comments.json` (optional, non-fatal)
- `output/<channel_title_slug>__<channel_id>/<basename>.meta.json` (sidecar for indexing/browsing)
- `output/<channel_title_slug>__<channel_id>/_channel.json` (per-channel metadata)
- `output/<channel_title_slug>__<channel_id>/_errors.jsonl` (per-channel error log)
- `audio/<channel_title_slug>__<channel_id>/<basename>.<ext>`
- `output/_uploads/<audioId>.json` + `audio/_uploads/<audioId>.<ext>` (uploaded audio staging)
- `output/_usage/ledger.json` (atomic provider-call reservations and estimated cost)
- `output/_transcripts/v1/<prefix>/<transcriptId>.json` plus
  `<transcriptId>/transcript.*` (immutable canonical Transcript Store v1 records
  and representation snapshots; legacy presentation paths remain compatibility references)
- `output/_jobs/media2text.sqlite` (bounded intake, lease, idempotency, and durable outbox coordination state)
- `output/uploads/<basename>.*` + `audio/uploads/<basename>.<ext>` (processed local audio runs)

Future multi-tenancy (Phase 2+) can wrap the same structure under a `user_id` prefix:
`output/<user_id>/...` and `audio/<user_id>/...`.

## Events Contract

Core emits structured events via a `PipelineEventEmitter` port. Example event types:

- `run:start`, `run:done`, `run:cancelled`, `run:error`
- `video:start`, `video:skip`, `video:error`, `video:done`
- `video:stage` (download|transcribe|split|comments|save|format)
  Note: `split` is conditional (only when audio exceeds provider limit).

Runners decide how to consume events:
- CLI default: human logs to stdout.
- CLI `--json-events`: JSONL events to stdout (logs to stderr).
- API runner: translate events to SSE/WebSocket streams.

`video:done` includes `transcriptId` and the canonical record SHA-256. Before
that event is emitted, the pipeline has written the immutable Transcript Store
record and inserted its deterministic `transcript.ready` outbox obligation.
Run-level `callbackUrl` webhooks remain a compatibility surface; per-item
outbox delivery is the guaranteed integration path.

## Media Intake and Cortex Boundary

Media2Text owns authenticated media admission, integrity verification,
transcription, immutable transcript materialization, cost enforcement, and
per-item completion delivery. Source systems own original media. Cortex owns
semantic ingestion and retrieval, not provider execution or Media2Text state.

`POST /v1/intakes` commits an idempotent SQLite obligation before returning
`202`; a worker later fetches bytes from an exact allowlisted origin, verifies
size and SHA-256, and enters the existing pipeline. Legacy `/audio` plus
audio-backed `/runs` are adapters to the same job state machine. The Home Infra
surface is the sanitized `/status/media-pipeline` snapshot, not a transport.

Plaud Mirror integration is an additive adapter at the HTTP boundary. The
frozen producer profile is authenticated by a producer-specific admission
bearer, translated into the internal `media2text.intake.v1` request, and kept
isolated by source authority plus collection identity. Artifact fetch uses a
separate bearer and exact origin allowlist. Accepted, processing, and terminal
status events enter a second durable outbox in the same SQLite transaction as
their state change; an HMAC worker delivers them in monotonic order while
producer-scoped pull remains the reconciliation path. Home Infra only routes
these exact machine endpoints and observes sanitized health.

## Transcription, Language Handling, Credits

Transcription is abstracted via a `TranscriptionProvider` (AssemblyAI + Deepgram + OpenAI Whisper). Multi-key load balancing with automatic failover is supported for AssemblyAI and Deepgram.

Language handling requirement: non-English videos transcribe poorly when forced to `en_us`.

Implemented approach (Phase 0):
1. Manual override (`--language` / `languageCode`) when desired.
2. Otherwise auto-detect per video using yt-dlp metadata priority:
   - `metadata.language` (most reliable)
   - `subtitles` (manually uploaded)
   - `automatic_captions` (filtered to AssemblyAI-supported codes)
3. If still undetected, enable provider automatic language detection (AssemblyAI `language_detection: true`, OpenAI Whisper by omitting language).

Audio size limits:
- Providers declare a max upload size (e.g., OpenAI Whisper 25 MB, Deepgram 2 GB).
- If an audio file exceeds the effective limit, the pipeline splits it into chunks with overlap, transcribes each chunk, then merges timestamps while trimming the overlap region.

Persist detected language in per-video `.meta.json` for later UI/RAG use.

Credits behavior:
- Preflight account/balance check is best-effort (warn/abort/none).
- Hard stop on "insufficient credits" errors is mandatory.
- Independently of provider balance APIs, v0.37.0 measures audio duration and
  reserves it in a persistent ledger immediately before every provider call.
  Environment-only hard caps cover item, run, source/24h, total minutes/30d,
  and estimated USD/30d. Corrupt or unavailable state fails closed.
- Split audio is reserved atomically before the first chunk is sent. Failed or
  crash-interrupted calls stay counted as potentially billable; chunks that
  are definitely never sent are released.

## Phases / Roadmap (counted, sequential)

### Phase 0 - Core service hardening (no web UI)

Completed:
1. PipelineEventEmitter + CLI `--json-events`.
2. StorageAdapter + filesystem implementation for reading existing `output/`.
3. Sidecar metadata (`_channel.json`, `<basename>.meta.json`) for indexing/browsing.
4. Language auto-detection (metadata/captions) + unit tests.
5. yt-dlp reliability hardening (public videos only)
   - Do not expose arbitrary yt-dlp flags via Settings/UI/API (security).
   - If yt-dlp reports missing JS runtime warnings (EJS), upgrade yt-dlp with
     its default extras and install a supported JS runtime (per yt-dlp docs).
     The Docker API image bakes this in with `yt-dlp[default]` plus Node.js
     enabled through `/etc/yt-dlp.conf`.
6. Minimal HTTP API runner (service shell around core)
   - `POST /runs` to start a run
   - `GET /runs/:id/events` (SSE) to stream JSON events
   - `GET /runs/:id/artifacts` to list produced outputs
7. Persist API runs/events on disk (survive restarts)
   - Persist under `output/_runs/<runId>/` by default
   - Reload on startup; use `Last-Event-ID` for SSE reconnect
8. Dockerize once the API exists
   - Image bundles Node + yt-dlp default extras + ffmpeg
   - Volumes for `output/` and `audio/`

Remaining:
- None (scheduler/watchlist implemented in Phase 2.3).

Exit criteria: core still runs as CLI exactly like today and can be embedded in a service with structured events.

### Phase 1 - Local-first web UI (kept from Claude, moved later)

Goal: browse outputs + run jobs locally as an admin.

Implementation note (Phase 1):
- UI stack: Next.js admin UI in `web/` consuming the existing API runner (SSE for events).
- The hosted operator console uses a signed server-side session boundary. The
  browser never receives `Y2T_API_KEY`; the Next.js BFF verifies the session
  before injecting that credential into private API calls (v0.36.12).

Phase 1 sequencing (do in order):
1. UI scaffold + API library endpoints (DONE)
2. UI error handling when API is down (DONE)
3. OpenAPI contract + generated TS types/client + contract-check workflow (DONE) (see `docs/operations/API_CONTRACT.md`)
4. Global SSE stream for run updates (DONE)
5. UI polish (styling consistency DONE; SSE event summaries DONE; remaining UX polish planned)
6. Output format expansion (MD + JSONL) (DONE)

Screens:
- Dashboard (runs + errors + recent channels/videos)
- Runs/Queue with real-time progress (from JSON events)
- Channel library with filters/search (reads `output/`)
- Video view: audio player + transcript + comments tab + exports

### Phase 2 - Hosted single-tenant service (admin)

Goal: deploy Media2Text for one admin workspace (no public signup) while keeping the CLI unchanged.

Add:

Phase 2.1 - Integration MVP (API-first; do in order):
1) X-API-Key auth for API + admin UI (env `Y2T_API_KEY`) - DONE (v0.6.0)
2) `POST /runs/plan` to enumerate + skip counts + estimate without transcribing - DONE (v0.6.0)
3) Webhooks via `callbackUrl` on `POST /runs` (`run:done` / `run:error`) - DONE (v0.7.0)
4) Cache-first for single-video URLs (return cached artifacts unless `force`) - DONE (v0.8.0)
5) Integration docs (`INTEGRATION.md`) with curl + n8n examples - DONE

Phase 2.2 - Ops hardening (DONE):
- extended healthcheck (deps + disk)
- configurable CORS allowlist
- retention/cleanup policy for runs + audio

Phase 2.3 - Scheduler/watchlist (cron) (DONE):
- maintain a followed-channels list (global interval, optional per-channel override)
- scheduler runs every N minutes:
  - call `POST /runs/plan` for each followed channel
  - only create a run if there are new videos to process

Phase 2.4 - Control + robustness (DONE):
- cancel run endpoint
- rate limiting (per API key/IP)
- optional worker/queue if synchronous execution becomes limiting
- tighten input validation (watchlist URLs should be channel/playlist only; avoid accepting arbitrary URLs)

Phase 2.4.x (polish/stabilize) (DONE):
- 2.4.1 OpenAPI polish: add `license` + `operationId` (cleaner client generation, fewer lint warnings)
- 2.4.2 Watchlist safety: validate watchlist URLs (channel/playlist only) + document override if needed
- 2.4.3 Regression tests: cache-first channel thumbnail backfill
- 2.4.4 Ops docs: add cron examples for retention cleanup in deploy playbook
- 2.4.5 OpenAPI completeness: add missing 4XX responses (reduce linter noise; clarifies auth/error surfaces)
- 2.4.6 Graceful shutdown: handle SIGTERM/SIGINT without losing as much work
- 2.4.7 Debug endpoint: `GET /runs/:id/logs` for non-SSE environments

Phase 2.5 - Admin UX + monitoring (DONE):
- Watchlist UI page (`/watchlist`) for managing recurring sources and basic scheduler controls.
- Prometheus metrics endpoint (`GET /metrics`) for production monitoring.

Phase 2.6 - Run configuration UX (DONE):
- Implemented `maxNewVideos` semantics (limit AFTER skip) to support incremental backfills ("10 now, 10 later").
- Implemented plan preview UX (total/processed/remaining) before spending credits.
- Kept CLI + runs.yaml parity with API/web.
- UX polish: Create Run warns about `force=true` + `maxNewVideos`; run detail Downloads auto-updates as videos finish.

Phase 2.7 - Settings + planning performance (DONE):
- Settings UI for non-secret defaults (persist to `output/_settings.json`), secrets remain env-only (DONE in v0.17.0).
- Optional cost/duration preview (best-effort, non-blocking).
- Channel catalog caching + processed index for exact fast planning (DONE in v0.16.0):
  - Cache full channel catalog under `output/_catalog/<channelId>.json` (exact; first run is expensive).
  - Maintain a fast processed-id scan (set of ids) derived from `output/<channelDir>/*.json` transcripts.
  - Used by `POST /runs/plan` and runs to avoid per-video filesystem checks.

Phase 2.8 - Security hardening for hosted use (DONE):
1) Make API auth mandatory for non-local deployments (DONE)
   - Require `Y2T_API_KEY` by default in Docker/hosted mode; keep a deliberate escape hatch for local dev only.
2) Server-side clamps/validation for config inputs (DONE in v0.20.0)
   - Reject or clamp pathological values for: concurrency, pollIntervalMs, maxPollMinutes, retries, commentsMax, catalogMaxAgeHours, afterDate format, manual languageCode allowlist.
   - Apply to: `PATCH /settings`, `POST /runs`, `POST /watchlist` (and any future endpoints that accept overrides).
3) Harden API error handling and persistence (DONE in v0.20.2)
   - Sanitize 500 responses (no internal error leaks).
   - Log persistence failures (no silent catch).
   - Replace unsafe request-body casts with schema validation (Zod).
4) Rate limiting (write limiting) (DONE in v0.21.0)
    - Per API key (primary) and optionally per IP; stricter limits on write endpoints (`POST /runs`, `PATCH /settings`, watchlist mutations, scheduler triggers).
5) Tests + docs
   - Unit tests for auth-required mode, clamp behavior, and rate limiting.
   - Update README + OpenAPI error responses for 401/429 where relevant.
6) Application authentication at the web/BFF boundary (DONE in v0.36.12)
   - Signed `HttpOnly`, `SameSite=Strict` sessions and login throttling.
   - Fail closed before backend API-key injection.
   - Same-origin validation for state-changing BFF requests.

Phase 2.9 - STT provider capability refactor (DONE in v0.28.1):
1) Move provider capabilities onto `TranscriptionProvider.getCapabilities()`.
2) Remove static capabilities registry; list providers from provider modules.
3) Pipeline reads max upload size from the active provider instance.
4) `/providers` endpoint returns provider-sourced capabilities.

### Phase 3.0 - Direct audio input (DONE in v0.31.0)

- Accept local audio files (skip yt-dlp) via CLI (`--audio` + `--audioTitle`) or API (`POST /audio` + `POST /runs` with `audioId`).
- Upload size limit: `Y2T_MAX_UPLOAD_MB` (default 1024).
- Output goes under `output/uploads/*` and `audio/uploads/*`.

### Phase 3+ - Cloud multi-tenant platform (optional, not started)

Add:
- user auth + private workspaces per user
- persistent DB indexes (runs/jobs, channels, videos, errors)
- object storage for artifacts
- workers/queues for background processing
- usage tracking + admin controls (foundation for future billing)

## Tech Debt Backlog (post-Phase 2.8)
- Phase 2.8 backlog items completed in v0.23.x.
- Provider capabilities now live on the provider interface (DONE v0.28.1).

## Security Roadmap v7 (planned, do in order)
Phase S1 - Real-risk fixes (high priority) (DONE)
1) Hash API keys in rate limiter buckets (avoid raw key in memory).
2) Protect /health?deep=true (require API key or new opt-in env).

Phase S2 - Webhook hardening (DONE)
3) Mitigate DNS rebinding for callbackUrl (resolve host -> block private IPs). (DONE)
4) Require or strongly recommend Y2T_WEBHOOK_ALLOWED_DOMAINS in production docs. (DONE)

Phase S3 - Operational hardening (config guidance) (DONE)
5) Tighten trust proxy guidance (do not enable without a real proxy).
6) CORS guidance: avoid "*" in production.

Phase S4 - Verification (DONE)
7) Add security checklist for deployments (API key, allowlist, deep health). (DONE)
8) Add tests for deep health auth + webhook DNS rebinding. (DONE)

## Security Roadmap v8 (hardening, DONE)

Security audit hardening (P0/P1/P2) completed in v0.31.1.
See `docs/llm/HANDOFF.md` for the full checklist and status.

## Phase 2.10+ - Feature Mining Adoption (planned, do in order)

Goal: adopt the best reliability patterns from `ShellSpeechToText` without copying code, preserving Y2T interfaces and modularity.

Phase A - Low-risk hardening (DONE):
1) Atomic file writes (temp + rename) for persistence/settings writes. (DONE)
   - Reference: `C:\Users\cdela\OneDrive\coding\Shell\ShellSpeechToText\src\services\stats.service.ts`
2) AbortController timeouts for external API calls (provider fetches). (DONE)
   - Reference: `C:\Users\cdela\OneDrive\coding\Shell\ShellSpeechToText\src\services\deepgram-billing.service.ts`

Phase B - Provider resiliency (DONE):
3) Multi-key load balancer for STT providers (round-robin + failover). (DONE)
   - Reference: `C:\Users\cdela\OneDrive\coding\Shell\ShellSpeechToText\src\services\deepgram-load-balancer.service.ts`

Phase C - Provider expansion (DONE):
4) Deepgram provider (completed in v0.34.0).
   - Reference: `C:\Users\cdela\OneDrive\coding\Shell\ShellSpeechToText\src\services\deepgram.service.ts`

Phase D - UX/observability:
5) Error categorization + user-friendly messages.
   - Reference: `C:\Users\cdela\OneDrive\coding\Shell\ShellSpeechToText\src\utils\errors.ts`
6) ETA estimation + hybrid ETA (optional).
   - Reference: `C:\Users\cdela\OneDrive\coding\Shell\ShellSpeechToText\src\services\stats.service.ts`

Low priority:
7) AI text cleaning post-process.
8) Telegram bot monitoring (redundant with webhooks + SSE).
