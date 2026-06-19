# Decisions (Rationale)

Keep this file stable and relatively compact. Put "why" here (tradeoffs, rejected options, pitfalls).

All content should be ASCII-only to avoid Windows encoding issues.

## D-001 - CLI independence (non-negotiable)

Decision:
- The CLI must remain fully operational even as service/web layers are added.

Rationale:
- CLI is the primary workflow today and must stay usable for bulk channel transcription.
- Web/API should be a thin shell around the same core pipeline, not a replacement.

Implications:
- Core modules must not import web code.
- Runners (CLI/API) should be separable.

## D-002 - Scope: public videos only (no cookies)

Decision:
- Do not support members-only/private videos. Do not implement cookie ingestion/refresh.

Rationale:
- Operational/security complexity is high and not needed for the intended use (public channels).

Implications:
- When yt-dlp cannot access content, mark it as failed with a clear reason and continue.

## D-003 - Language detection priority chain

Problem:
- Forcing `en_us` makes non-English videos transcribe poorly.
- A naive approach that picks the first key from `automatic_captions` can pick bogus languages (YouTube lists many possible auto-caption languages).

Decision:
- Use this priority chain when `languageDetection=auto`:
  1. `metadata.language` (most reliable; declared language)
  2. `subtitles` (manually uploaded)
  3. `automatic_captions` (filtered to AssemblyAI-supported codes only)
  4. if still undetected: use AssemblyAI Automatic Language Detection (ALD)
  5. only if ALD is disabled: fallback to configured default (`languageCode`, e.g. `en_us`)

Rationale:
- No new dependencies.
- Avoids false positives like detecting a Spanish video as `ab`.

AssemblyAI-supported whitelist:
- `en`, `en_au`, `en_uk`, `en_us`, `es`, `fr`, `de`, `it`, `pt`, `nl`, `hi`, `ja`, `zh`, `fi`, `ko`, `pl`, `ru`, `tr`, `uk`, `vi`

Test fixtures:
- See `tests/fixtures/test-videos.md`.

## D-004 - Do not expose arbitrary yt-dlp flags (security)

Problem:
- YouTube upstream changes can require additional tokens for some player clients (e.g. android/ios), breaking public downloads.

Decision:
- Do not expose arbitrary yt-dlp flags via Settings/UI/API (or any remote-configurable surface).
- Remove `ytDlpExtraArgs` / `YT_DLP_EXTRA_ARGS` from supported configuration.

Rationale:
- Allowing arbitrary yt-dlp args is a high-risk footgun if the API/UI is ever exposed beyond localhost (potentially enabling file writes, cookie usage, or other abuse).
- If we ever need advanced downloader customization again, reintroduce it as an explicit opt-in build/deploy-time feature with strict allowlists (not by default).

## D-005 - Interfaces: what to abstract now vs later

Implemented now (needed for Phase 0 -> Phase 1 layering):
- `StorageAdapter`: web needs to read `output/` without duplicating path logic.
- `PipelineEventEmitter`: service/web needs structured events; do not parse logs.
- `InsufficientCreditsError`: avoid coupling pipeline control flow to AssemblyAI-specific errors.

Deferred (YAGNI until a second implementation exists):
- YouTube resolver abstraction beyond yt-dlp
- Audio extractor abstraction
- Formatter abstraction (txt/csv/json)

## D-006 - AssemblyAI ALD fallback when yt-dlp has no language

Problem:
- Some videos have no YouTube language metadata (`language` field is null, no subtitles, no automatic_captions).
- Example: Chinese educational videos often lack this data.
- Current D-003 priority chain falls back to default (e.g. `en_us`), causing poor transcription.

Solution:
- Use AssemblyAI Automatic Language Detection (ALD) as a fallback when YouTube metadata is unavailable.
- ALD is enabled via `language_detection: true` in the transcription request.
- Supports 99 languages (more than our 20-language whitelist).
- Docs: https://www.assemblyai.com/docs/speech-to-text/speech-recognition#automatic-language-detection

Implementation sketch:
```typescript
// In transcription request when YouTube detection fails:
if (!detected) {
  transcriptParams.language_detection = true;
  // Do NOT set language_code when using ALD
}
```

Tradeoffs:
- Pro: Works for any spoken language without manual config.
- Pro: No additional API cost (same price per minute).
- Con: Slightly longer processing time (ALD analyzes first ~60s of audio).
- Con: Cannot use language_code hint; ALD decides autonomously.

Decision status: IMPLEMENTED.

Test case: Chinese video `https://www.youtube.com/watch?v=GBbgCupe6hg` (yt-dlp language is null / no usable captions).

Validation results (2025-12-14):
| Language | Video URL | `language` field | Mapped | Status |
|----------|-----------|------------------|--------|--------|
| Spanish | cYb0Mb_pI_8 | `es-US` | `es` | OK |
| English | sYlHLNZ0E8A | `en` | `en_us` | OK |
| French | VRKw5Vk_iWM | `fr` | `fr` | OK |
| German | o5HLxhvJmJo | `de` | `de` | OK |
| Chinese | GBbgCupe6hg | `null` | (ALD) | Implemented; needs e2e validate |

## D-007 - Minimal HTTP API runner (Phase 0.2)

Decision:
- Add a minimal local HTTP API runner as a separate entrypoint (`youtube2text-api`) without affecting the CLI.

Rationale:
- Enables n8n/Zapier integration and future web UI without parsing logs.
- Reuses the same core pipeline and `PipelineEventEmitter` contract.

Design choices (Phase 0.2):
- In-process server using Node `http` (no new dependencies).
- In-memory RunManager (no DB); runs are ephemeral per process.
- SSE endpoint streams structured pipeline events and supports `Last-Event-ID`.
- Artifacts endpoint reads from the filesystem adapter (`output/`) after/during runs.

## D-008 - Persist API runs/events on disk (Phase 0.2.1)

Decision:
- Persist API runs and SSE events to disk by default so a server restart does not lose run history.

Rationale:
- Docker/server restarts are normal and losing run context is confusing.
- Keeps Phase 0 local-first and avoids adding a DB before Phase 1.

Design choices:
- Persist under `output/_runs/<runId>/run.json` and `output/_runs/<runId>/events.jsonl`.
- Reload into memory on server startup, keeping an in-memory buffer for SSE.
- Controlled by env vars:
  - `Y2T_API_PERSIST_RUNS` (default: true)
  - `Y2T_API_PERSIST_DIR` (optional override)

## D-009 - Docker packaging for the API runner (Phase 0.3)

Decision:
- Provide a Docker image and docker-compose setup for the HTTP API runner.
- Docker does not replace the CLI; CLI remains the primary local workflow.

Rationale:
- Server-style deployments need `yt-dlp` + `ffmpeg` available, and Docker is the most repeatable way to bundle them.
- Keeps Phase 0 local-first while enabling a "run it anywhere" service for n8n/webhooks/web UI later.

Design choices:
- Multi-stage Docker build:
  - Builder: install Node deps + build `dist/`.
  - Runtime: install `ffmpeg` + `python3`/`pip` + `yt-dlp[default]`, then run `node dist/api.js`.
- Install `yt-dlp` into a Python virtualenv inside the image (avoids Debian/PEP-668 "externally managed environment" errors without using `--break-system-packages`).
- Use a Node.js runtime new enough for yt-dlp EJS and enable it through
  `/etc/yt-dlp.conf` (`--js-runtimes node`) inside the image. This keeps EJS
  support available for YouTube without exposing arbitrary yt-dlp flags to
  Settings/UI/API.
- Optional reproducibility: allow pinning `yt-dlp` via `--build-arg YT_DLP_VERSION=...`.
- Bind mounts for persistence:
  - `./output` -> `/data/output` (includes `output/_runs/` for persisted runs/events)
  - `./audio` -> `/data/audio`

Non-goals:
- Cookies/members-only support.

## D-010 - Phase 1 admin UI: Next.js + separate web service

Decision:
- Build the Phase 1 local-first admin UI using Next.js (in `web/`).
- Deploy as a separate service/container from the API runner (docker-compose with `youtube2text-api` + `youtube2text-web`).

Rationale:
- Keeps CLI independent and unchanged.
- Keeps the API runner as the single interface to the filesystem outputs (web does not reimplement `output/` parsing).
- Avoids the "two processes in one container" anti-pattern and keeps deployments simpler to debug (logs/healthchecks).

Design choices:
- Web consumes API:
  - Runs: `GET /runs`, `GET /runs/:id`, SSE `GET /runs/:id/events`
  - Library: `GET /library/channels`, `GET /library/channels/:channelDirName/videos`, `GET /library/.../:basename/:kind` for artifact viewing
- Web uses `Y2T_API_BASE_URL` (server-side fetch) and `NEXT_PUBLIC_Y2T_API_BASE_URL` (browser/SSE).
  - Important: do not render `Y2T_API_BASE_URL` into HTML (browser cannot reach Docker-internal hostnames).

## D-011 - API contract and type generation (Phase 1 - planned)

Decision:
- Use OpenAPI as the authoritative API contract and generate TypeScript types (and optionally a client) for the Next.js UI.
- Add a "contract check" command that fails if generated artifacts are out-of-date, preventing endpoint/type drift.

Rationale:
- The API surface will grow (runs control, library search, config validation).
- We do not want `web/` to duplicate API types forever, and we do not want hand-maintained docs/specs to drift.

Operational rule:
- Any change to endpoints or request/response JSON must update the OpenAPI spec and keep `npm run api:contract:check` passing.

Reference:
- See `docs/operations/API_CONTRACT.md` for the planned workflow and scripts.

## D-012 - Global SSE stream for a "live" UI (Phase 1)

Decision:
- Add a global SSE endpoint (`GET /events`) that emits `run:created` and `run:updated` events so the runs list can update without manual refresh.

Rationale:
- Makes the admin UI feel "alive" without polling.
- Keeps per-run SSE (`/runs/:id/events`) for detailed progress while providing a lightweight app-wide stream for status changes.

## D-013 - Additional transcript artifacts for long videos (MD + JSONL)

Decision:
- Keep `.json` as the canonical transcription artifact (provider response).
- Always emit two additional derived artifacts:
  - `.md` for human readability (headings + paragraph wrapping + timestamps).
  - `.jsonl` for downstream LLM tooling (one utterance per line; streamable/chunkable).

Rationale:
- 1-2h videos produce very large `.json` files; they are not pleasant to open, search, or send to other systems.
- `.md` is easy to read in GitHub/VS Code and better than raw `.txt` for structured viewing.
- `.jsonl` is the easiest universal interchange for RAG/embeddings/chunked processing without loading everything into memory.

Non-goals (for now):
- Do not compress `.json` by default (`.json.gz`) until disk pressure is a real problem.
- Do not require any web/UI changes to keep CLI usable (CLI remains primary workflow).

## D-014 - Phase 2 Integration MVP (API-first)

Decision (in progress):
- Treat the HTTP API + `openapi.yaml` as the primary integration surface for Phase 2.
- Keep the web UI as a minimal admin panel (not the integration surface).

Phase 2.1 scope (planned; do in order):
1) X-API-Key auth (env `Y2T_API_KEY`) for API + admin UI (implemented in v0.6.0)
2) `POST /runs/plan` (enumerate + skip counts + estimate) without transcribing (implemented in v0.6.0)
3) Webhooks via `callbackUrl` on `POST /runs` (`run:done` / `run:error`)
4) Cache-first for single-video URLs (return cached artifacts unless `force`)
5) Integration docs (`INTEGRATION.md`) with curl + n8n examples

Rationale:
- Enables n8n/external backends to orchestrate runs without depending on UI behavior.
- Prevents accidental spend: planning endpoint + cache-first reduce redundant transcription.
- Keeps CLI unchanged and avoids premature multi-tenant complexity.

Operational rule:
- Any API change must update `openapi.yaml` and keep `npm run api:contract:check` passing.

## D-015 - Scheduler/watchlist (cron) should use planning endpoint

Decision (planned):
- Implement "followed channels" + scheduler as a separate Phase 2 step that calls `POST /runs/plan` to decide whether to enqueue a run.
- Support a global interval with optional per-channel overrides.

Rationale:
- Avoids running expensive pipelines when there are no new videos.
- Keeps scheduling logic simple and auditable (plan -> decide -> run).

## D-016 - Channel avatars: cache-first backfill + prefer square images

Problem:
- The Library UI relies on `output/<channelDir>/_channel.json` containing `channelThumbnailUrl`.
- With cache-first single-video runs (`POST /runs` with `force=false` and outputs already present), the API can return `done` immediately without running the pipeline. This means older channel folders created before the avatar feature can remain missing `channelThumbnailUrl` even if the user "re-runs" a single video URL.
- yt-dlp channel metadata often contains both banner-like thumbnails (very wide) and avatar-like thumbnails (square). Picking the "largest" thumbnail can select a banner instead of an avatar.

Decision:
- Keep cache-first behavior (no unnecessary downloads/transcription), but add a best-effort "fire-and-forget" backfill step on the cache-first path to update `_channel.json` when missing `channelThumbnailUrl`.
- When selecting a channel image from `thumbnails[]`, prefer "square-ish" candidates (aspect ratio ~0.8-1.25) over wide banners; then select the largest by area among candidates.

Rationale:
- Preserves the main goal of cache-first: do not spend credits or time when artifacts already exist.
- Improves UX immediately without requiring a full channel re-run just to populate avatars.
- Heuristic selection is simple, dependency-free, and robust enough for a best-effort UI enhancement.

Implications:
- Backfill is best-effort: failures are ignored and do not change run status.
- `_channel.json` remains the single source of truth for channel metadata shown in the Library.

## D-017 - Retention cleanup: operational data only

Problem:
- A long-running server accumulates operational state over time:
  - API persisted runs/events under `output/_runs/*`
  - audio cache files under `audio/*`
- Unbounded growth can fill disk and break the service.

Decision:
- Implement retention cleanup that only targets:
  - persisted run folders under `output/_runs/*`
  - old audio cache files under `audio/*`
- Never delete transcript artifacts under `output/<channelDir>/*`.
- Provide both:
  - best-effort cleanup on API startup
  - an explicit API trigger (`POST /maintenance/cleanup`)
- Configure via env (server-friendly):
  - `Y2T_RETENTION_RUNS_DAYS` (default 30; `-1` disables)
  - `Y2T_RETENTION_AUDIO_DAYS` (default 7; `-1` disables)

Rationale:
- Keeps the user-visible "library" immutable by default (transcripts are the product).
- Keeps ops concerns (disk pressure) manageable without introducing a DB or cron subsystem yet.
- Env-first config fits Docker deployments and avoids adding config-writing endpoints early.

## D-018 - Name architecture: Media2Text brand, youtube2text runtime

Decision:
- The visible product brand is **Media2Text**.
- The technical codename/runtime remains `youtube2text`.
- The environment variable prefix remains `Y2T_`.
- The root package name remains `youtube2text`.
- This dual naming is intentional product architecture, not cleanup debt.

Rationale:
- The product now handles both YouTube/video sources and direct audio input.
  `Media2Text` describes that visible user-facing scope better than
  `Youtube2Text`.
- `youtube2text` and `Y2T_` are deployed technical contracts. They appear in
  Doppler, compose files, Docker image names, CLI/bin names, runtime paths,
  scripts, docs, and operational muscle memory.
- Renaming those internals would be a breaking operational migration with little
  benefit for the current local-first/homelab product.

Implications:
- Allowed: change user-facing copy, README headline, UI title/header, OpenAPI
  title/description, and GitHub description to use `Media2Text`.
- Allowed: add an optional vanity hostname later as an alias to the same backend.
- Not allowed without a new owner-approved decision and versioned migration:
  global replacement of `youtube2text` with `media2text`, changing `Y2T_`
  environment variables, changing root package name, renaming Docker images,
  changing Doppler project/config contracts, changing compose/runtime paths, or
  removing the existing `y2t.lamanoriega.com` hostname.
- A guardrail must fail if new `MEDIA2TEXT_` or `M2T_` environment variable
  prefixes are introduced, or if the root package name stops being
  `youtube2text`.

## D-019 - HISTORY format enforcement via upstream DocKit

Decision:
- Keep this repository on strict no-dash HISTORY entries by setting
  `history_format: no-dash` in `.dockit-config.yml`.
- The former local `scripts/dockit-validate-session.sh` fork is superseded by
  LLM-DocKit v4.9.6, which supports configurable `any`, `dash`, and `no-dash`
  HISTORY validation plus newest-first enforcement.

Rationale:
- The repository's documented HISTORY format is intentionally stricter than the
  obsolete leading-dash style.
- The validator must catch that drift directly, preventing a passive
  documentation rule from being silently ignored by later LLM sessions.
- Upstreaming the behavior avoids repeatedly reapplying a local script fork after
  `dockit-sync`, while still preserving this repository's stricter contract.

Implications:
- Do not remove `history_format: no-dash` unless the owner explicitly changes
  the repository's HISTORY contract.
- Future `dockit-sync` runs should take upstream validator/version-sync scripts
  without reintroducing a local fork, as long as the strict no-dash behavior and
  version marker checks still validate.
- Superseded evidence (2026-06-19): adopter smoke verified upstream scripts
  perform 11-target bump round-trip, detect version drift and unknown markers,
  reject dash-formatted HISTORY under `history_format: no-dash`, and preserve
  the `DOCKIT_ALLOW_READ_ONLY_SKIP=1` zero-diff skip.
