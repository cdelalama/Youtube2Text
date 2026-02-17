# LLM Work Handoff

This file is the current operational snapshot. Keep it short (target: 1-2 screens).
Older long-form notes were moved to `docs/llm/HANDOFF_ARCHIVE.md`.

All content should be ASCII-only to avoid Windows encoding issues.

## Current Status
- Version: 0.35.0 (versions must stay synced: `package.json` + `openapi.yaml`)
- CLI: stable; primary workflow (must not break)
- API: stable; OpenAPI at `openapi.yaml`; generated frontend types at `web/lib/apiTypes.gen.ts`
- Web: Next.js admin UI (Runs/Library/Watchlist/Settings)
- STT providers: AssemblyAI + Deepgram + OpenAI Whisper

## Architecture Discussion: RAG Pipeline (2026-02-16, brainstorming)

### Thread status (read this first)
- Latest comment: 2026-02-16 18:55 UTC - GPT-5 - Review posted (actionable adjustments below).
- Current owner for decision: project owner (pending final go/no-go on ingestion implementation).
- Canonical order rule: prepend new comments to `Comment Log` (newest first).

### Comment format (mandatory for this thread)
- `Timestamp (UTC) | Author | Type (proposal/review/decision) | Status`
- 1 short paragraph summary + flat bullet list of concrete actions.
- Never edit older comments; only prepend a new one.

### Comment log (newest first)

#### 2026-02-16 18:55 UTC | GPT-5 | review | status: recommended-with-adjustments
Summary:
- The proposed RAG architecture is viable and directionally correct: keep youtube2text focused on transcription/scheduling and build ingestion/vectorization as a separate service.

Actions:
- Keep ingestion run-scoped by `runId` (consume `GET /runs/{id}/artifacts`) instead of channel re-list as primary path.
- Treat webhook delivery as at-least-once: enforce idempotency in ingestion DB and verify signatures.
- Use polling-first control path (`GET /runs/{id}` / `GET /runs/{id}/logs`) and keep SSE optional.
- Start with TypeScript ingestion service for operational consistency; revisit Python if local-NLP stack needs dominate.
- Keep compose together in dev for simplicity; split deploy units in production.

#### 2026-02-16 17:40 UTC | Claude Opus 4.6 | proposal | status: pending review
Summary:
- Proposed using youtube2text as the transcription source feeding a separate ingestion/vectorization service with PostgreSQL + pgvector and downstream analysis services.

Actions:
- Reuse youtube2text watchlist/scheduler + run terminal webhooks.
- Implement separate ingestion service to fetch transcript artifacts, chunk, embed, and persist vectors.
- Keep analysis services separate from transcription and ingestion.
- Resolve open questions on stack, embeddings, chunking strategy, compose layout, and pgvector instance.

Context: The owner wants to use youtube2text as the transcription engine feeding a larger
RAG (Retrieval-Augmented Generation) pipeline. Use case: follow channels (e.g. Pablo Gil),
auto-transcribe new videos daily, vectorize transcripts, then run analysis services on top
(bias detection, prediction tracking, sentiment analysis, etc.).

### Key decisions (pending final decision)

1. **youtube2text is feature-complete for this use case.** The watchlist + scheduler already
   handles "detect new videos and transcribe". Webhooks notify when a run finishes. No new
   youtube2text development needed beyond maintenance.

2. **Ingestion Service = SEPARATE PROJECT, separate Docker container.** Not part of
   youtube2text. Different responsibility (vectorization != transcription), different
   dependencies (embedding models, pgvector), independent release cycle.

3. **Internal scheduler (youtube2text) for transcription, NOT external cron.** The built-in
   watchlist/scheduler already calls /runs/plan, only creates runs when new videos exist,
   and sends webhooks on completion. No reason to duplicate this externally.

4. **Database: PostgreSQL + pgvector** (could reuse existing TimescaleDB on dev-vm or new
   instance). Schema sketch:
   - `channels` (id, title, url)
   - `videos` (id, channel_id, title, date, url, vectorized_at)
   - `chunks` (id, video_id, speaker, text, start_ms, end_ms, embedding vector(1536))

### Proposed architecture

```
youtube2text (this project, DONE)
  watchlist -> scheduler -> transcribe -> webhook run:done
       |
       v
Ingestion Service (NEW separate project)
  1. Receives webhook (run:done with channelDirName + video list)
  2. Calls youtube2text API: GET /library/.../videos/.../jsonl
  3. Chunks utterances (~500 tokens per chunk)
  4. Generates embeddings (OpenAI text-embedding-3-small or local model)
  5. INSERT into PostgreSQL + pgvector
  6. Idempotency: tracks which videos are already vectorized
       |
       v
PostgreSQL + pgvector (vector store)
       |
       v
Analysis Services (future, each a separate project)
  - Bias detector, prediction tracker, sentiment analysis, etc.
  - Query the vector DB for relevant chunks
  - Can use LLM for analysis (Claude/GPT with retrieved context)
```

### Runtime layout (docker-compose in ~/runtime/youtube2text/)

The Ingestion Service would be an additional container in the same compose file (or a
separate compose in ~/runtime/ingestion-service/). TBD based on coupling preference.

### Open questions for GPT/next session
- Ingestion Service stack: TypeScript (consistency with y2t) vs Python (better embedding
  ecosystem)?
- Embedding model: OpenAI API vs local (e.g. sentence-transformers)?
- Chunk strategy: by time window, by token count, or by speaker turn?
- Should the Ingestion Service live in the same docker-compose or its own?
- pgvector instance: reuse TimescaleDB or dedicated PostgreSQL?

### What youtube2text still needs (minor, for this integration)
- Ensure webhook payload includes enough info (channelDirName, video basenames, videoIds)
  so the Ingestion Service does not need to re-list videos.
- Potentially: a "list new videos since timestamp" endpoint for backfill (low priority,
  can use existing /library endpoints).

## Graceful Handling of Deleted Content in Runs (0.35.0)
- `listVideos()` in fsAdapter.ts now returns `[]` if channel dir is missing (instead of throwing)
- Run detail page catches artifact fetch errors and shows empty state
- `RunArtifactsLive` shows "Content has been deleted" when a finished run has 0 artifacts
- Historical runs remain visible in the runs list for reference

## DELETE Endpoints for Library Content (0.35.0)
- `DELETE /library/channels/:channelDirName` - removes channel output dir, audio dir, and catalog cache
- `DELETE /library/channels/:channelDirName/videos/:basename` - removes all files for a single video
- Returns 409 Conflict if an active run targets the channel
- Web UI: delete buttons on channel page (ChannelActions) and per-video (VideoActions)
- Does NOT cascade to _runs or _watchlist (operational data stays intact)
- Tests: 8 new tests in `tests/apiLibraryDelete.test.ts`

## Deepgram Provider (0.34.0) - Implemented
Goal: add Deepgram as a third STT provider (Nova-3 + diarization) while reusing existing interfaces.

Decisions (confirmed):
- Multi-key support: YES (`Y2T_DEEPGRAM_API_KEYS` + failure threshold/cooldown, reuse `MultiKeyProvider`).
- Configurable model + diarization: YES (config + Settings UI + docs).

Implementation summary:
- Provider: `src/transcription/deepgram/index.ts` (sync API, raw binary body).
- Config: `sttProvider=deepgram`, `deepgramApiKey(s)`, `deepgramModel`, `deepgramDiarization`.
- Factory + registry: wired in `createTranscriptionProvider()` + `listProviderCapabilities()`.
- API + Settings + OpenAPI: schemas/validation updated; types regenerated.
- CLI + runs.yaml: support for `sttProvider=deepgram`, model, and diarization.
- Docs/examples updated: README/HOW_TO_USE/INTEGRATION/.env.example/config.yaml.example/runs.yaml.example.
- Tests updated: provider validation + /providers capability list + load balancer signature.

### Claude review (2026-02-02) - Answers + additions

**Answers to open questions:**
- Model string: `nova-3` (query param `model=nova-3`).
- Diarization: `diarize=true` query param. ALSO requires `utterances=true` to get speaker-labeled segments (without it, only word-level speaker labels).
- Max upload: **2 GB** file size, 10-minute processing timeout. Set `maxAudioBytes` to `2 * 1024 * 1024 * 1024`. Audio splitting is effectively unnecessary for Deepgram.

**Additions to the plan (GPT steps kept, these are supplements):**

A) **Deepgram is synchronous** (like OpenAI Whisper, unlike AssemblyAI).
   - Single `POST https://api.deepgram.com/v1/listen` returns the transcript in the response.
   - No polling. `pollIntervalMs` and `maxPollMinutes` from `TranscriptionOptions` are unused.
   - Follow the OpenAI provider pattern, not the AssemblyAI pattern.

B) **Default query params** for every request:
   ```
   model=nova-3&diarize=true&utterances=true&punctuate=true&smart_format=true
   ```
   Plus either `detect_language=true` (auto) or `language=xx` (manual).

C) **Auth header format** is non-standard: `Authorization: Token <key>` (not Bearer).

D) **Multi-key support from day one**: add `Y2T_DEEPGRAM_API_KEYS=key1,key2` (plural) following the AssemblyAI pattern. Reuse existing `MultiKeyProvider` from `loadBalancer.ts`. Config fields: `deepgramApiKeys`, `deepgramKeyFailureThreshold`, `deepgramKeyCooldownMs`.

E) **Request body is raw binary**, not multipart/form-data.
   - Read file as Buffer, send as body with `Content-Type: audio/mpeg` (or appropriate mime).
   - Detect mime from file extension (mp3->audio/mpeg, wav->audio/wav, etc.).

F) **Timestamp conversion**: Deepgram returns seconds (float). Convert to ms: `Math.round(start * 1000)`.

G) **Response mapping (concrete)**:
   ```
   results.utterances[] -> TranscriptUtterance[]
     .speaker (number)    -> speaker
     .start (seconds)     -> Math.round(start * 1000)
     .end (seconds)       -> Math.round(end * 1000)
     .transcript          -> text
   results.channels[0].alternatives[0].transcript -> TranscriptJson.text
   results.channels[0].detected_language          -> language_code
   TranscriptJson.id     -> randomUUID() (Deepgram is stateless, no persistent ID)
   TranscriptJson.status -> "completed"
   ```

H) **Step 4 correction**: registry.ts was removed in Phase 2.9. Capabilities live on `getCapabilities()`. Only wire in `factory.ts`.

Response to H) (verified in repo, 2026-02-02):
- `src/transcription/registry.ts` exists and is used by `/providers` (via `listProviderCapabilities()`).
- Therefore Deepgram MUST be added to both `factory.ts` and `registry.ts` to keep `/providers` accurate.

I) **Concurrency limits** (document in Operator Notes):
   - Deepgram: 5 concurrent requests (pay-as-you-go), 15 (paid), 100 (enterprise).
   - Interacts with `Y2T_MAX_CONCURRENT_RUNS_PER_KEY`.

J) **Optional future**: `getAccount()` for pre-flight balance check via `GET /v1/projects/{project_id}/balances`. Requires knowing the project_id. Defer unless needed.

## Latest Checks (0.35.0)
- API types: `npm run api:types:generate` OK
- Tests: `npm test` 134/134 pass
- Build: `npm run build` + `npm --prefix web run build` OK
- API contract: `npm run api:contract:check` OK
- Version sync: `npm run version:check` OK

## Documentation Alignment Fixes (0.33.0)
- Added `assemblyAiApiKeys` to `config.yaml.example`.
- Removed obsolete "P1 load balancer" implementation notes.
- Documented multi-key AssemblyAI in `INTEGRATION.md`.

## Phase 2.8.2 (DONE): Server-side clamps/validation
- Added server-side validation/clamping for settings, runs, and watchlist inputs.
- Invalid `afterDate` or manual `languageCode` returns 400; numeric fields clamp to safe bounds.
- New helper: `src/api/validation.ts` with shared limits.

## Phase 2.8.2b (DONE): API hardening follow-ups
- Done: sanitize 500 responses (no internal error leaks).
- Done: log persistence failures (no silent `.catch(() => {})`).
- Done: request-body schema validation via Zod (remove unsafe casts).

## Review Notes (Claude v7 FULL audit 2026-01-02)
- Docs/code alignment: 100%; no issues found
- Tests: `npm test` 110/110 pass
- Build: OK (`npm run build`, `npm --prefix web run build`, `npm run api:contract:check`)
- Docker: healthy
- STT Providers: AssemblyAI + Deepgram + OpenAI Whisper fully documented and implemented
- npm audit: 0 vulnerabilities

## Security Audit v8 (Claude Opus 4.5, 2026-01-03) - FULL CODE REVIEW

Audited all 73 source files in src/**/*.ts. Historical audits in `docs/llm/HANDOFF_ARCHIVE.md`.

### CRITICAL (8 issues - fix immediately)

1. **PowerShell Command Injection** - `health.ts:49`
   ```typescript
   const script = `(Get-PSDrive -Name '${drive}').Free`;
   ```
   - Risk: If Y2T_OUTPUT_DIR contains special chars, executes arbitrary code
   - Fix: Use array arguments instead of template string

2. **Path Traversal in Persistence** - `persistence.ts:21-23`
   ```typescript
   runDir: (runId) => join(rootDir, runId)  // runId not validated
   ```
   - Risk: `runId = "../../../etc"` reads/writes outside directory
   - Fix: Validate runId is UUID format, check for `..`

3. **Symlink Attack in Retention** - `retention.ts:36-52,139`
   - `listFilesRecursive()` follows symlinks without checking
   - `fs.rm()` deletes symlink targets outside audioDir
   - Fix: Use `lstat()` instead of `stat()`, check `isSymbolicLink()`

4. **IP Spoofing Bypasses All Rate Limits** - `ip.ts:30-45`
   ```typescript
   if (isTrustProxyEnabled()) {
     const forwarded = getHeader(req, "x-forwarded-for");  // No proxy validation
   ```
   - Risk: With Y2T_TRUST_PROXY=true, anyone can spoof IP via header
   - Fix: Require trusted proxy IP whitelist, or disable by default

5. **SSE Unbounded Connections** - `server.ts:240-277`
   - Global counter only, no per-IP limit
   - Race condition: concurrent requests can exceed sseMaxClients
   - Fix: Add per-IP connection tracking, use atomic increment

6. **Timing Attack on API Key Length** - `auth.ts:70`
   ```typescript
   return equal && a.length === b.length;  // Length comparison leaks timing
   ```
   - Risk: Attacker can determine exact API key length
   - Fix: Compare lengths using constant-time method

7. **API Key Exposed in Error Messages** - `assemblyai/http.ts:38,60`
   ```typescript
   throw new Error(`AssemblyAI error ${response.status}: ${text}`);
   ```
   - Risk: If API returns key in error response, it gets logged
   - Fix: Sanitize error text before including in exception

8. **Insecure Mode Too Easy to Enable** - `auth.ts:24-26`
   - Y2T_ALLOW_INSECURE_NO_API_KEY=true disables all auth
   - Risk: Accidental production deployment without auth
   - Fix: Add startup warning, require explicit confirmation

### HIGH (12 issues)

| # | File:Line | Issue | Fix |
|---|-----------|-------|-----|
| 1 | `auth.ts:192-200` | Brute force keyed on spoofable IP | Key on API key hash + IP tuple |
| 2 | `auth.ts:96` | Auth limiter disabled if maxRequests=0 | Enforce minimum (e.g., 5) |
| 3 | `health.ts:73-83` | TOCTOU race in health probe file | Use randomUUID for probe filename |
| 4 | `fs.ts:25-26` | mkdir recursive follows symlinks | Check parent dir is not symlink |
| 5 | `retention.ts:61-82` | fs.stat() dereferences symlinks | Use lstat() |
| 6 | `eventBuffer.ts:16-23` | Unbounded memory per run (no event size limit) | Add max event size |
| 7 | `runManager.ts:74-106` | No per-API-key concurrent run limit | Add Y2T_MAX_CONCURRENT_RUNS_PER_KEY |
| 8 | `server.ts:299-312` | SSE connections bypass request timeout | Add max SSE lifetime |
| 9 | `schemas.ts:153,164,173` | URL fields have no format validation | Add .url() to Zod schema |
| 10 | `uploads.ts:71` | Content-Type check uses .includes() (bypassable) | Use .startsWith() |
| 11 | `webhooks.ts:113-251` | DNS rebinding TOCTOU (resolve then fetch) | Re-resolve at fetch time |
| 12 | `run.ts:717-720` | Error messages logged unsanitized | Sanitize before logging |

### MEDIUM (15 issues)

| File:Line | Issue |
|-----------|-------|
| `auth.ts:163-169` | No minimum API key length validation |
| `auth.ts:15` | Header array joining can cause confusion |
| `ip.ts:10-22` | Loose IP normalization accepts malformed IPs |
| `schemas.ts:168,179` | z.record(z.unknown()) allows prototype pollution |
| `schemas.ts:178` | callbackUrl has no URL format validation in schema |
| `persistence.ts:41-58` | No symlink check when loading persisted runs |
| `watchlist.ts:55-65` | Predictable temp filename (Date.now()) |
| `fsAdapter.ts:50-80` | Inconsistent validation: listChannels vs listVideos |
| `rateLimit.ts:68-90` | Float precision loss in token bucket refill |
| `server.ts:261-277` | SSE counter race condition (check-then-increment) |
| `server.ts:369-447` | Metrics endpoint has expensive I/O operations |
| `uploads.ts:95-232` | No timeout on upload stream (slow-read attack) |
| `health.ts:140` | Full directory paths exposed in deep health response |
| `openai/index.ts:51` | API key in private field (debugger exposure risk) |
| `assemblyai/client.ts:61` | Audio file path logged in plain text |

### VERIFIED SECURE (no action needed)

- Command execution: `exec.ts` uses spawn() with shell:false
- Path traversal in server.ts: isSafeBaseName() validation exists
- Webhook SSRF: Private IP blocking + domain allowlist
- Timing-safe key comparison: timingSafeEqual() used (except length)
- Secrets in persistence: API keys excluded from _settings.json
- Body size limits: Y2T_MAX_BODY_BYTES enforced
- Error responses to clients: Generic messages, no stack traces
- Upload filenames: UUID-based, no path traversal possible
- npm audit: 0 vulnerabilities

### Security Roadmap v8 (do in priority order)

**P0 - CRITICAL (do first):**
1. Fix PowerShell injection in health.ts:49 (use array args)
2. Validate runId in persistence.ts (UUID format, no ..)
3. Fix symlink attacks in retention.ts (use lstat)
4. Add per-IP SSE connection limits
5. Fix timing attack in auth.ts:70 (constant-time length compare)

**P1 - HIGH:**
6. Disable Y2T_TRUST_PROXY by default or require proxy whitelist
7. Sanitize API error messages before logging
8. Add minimum API key length (32+ chars)
9. Add per-API-key concurrent run limit
10. Fix Content-Type validation in uploads.ts

**P2 - MEDIUM:**
11. Add URL format validation to Zod schemas
12. Add upload stream timeout
13. Remove directory paths from health response
14. Use randomUUID for all temp filenames
15. Add event size limits to EventBuffer

## Security Audit v8 Merge (Claude + GPT)
Goal: merge Claude v8 findings with GPT full-code audit. Status labels:
- Confirmed: verified in code review
- Conditional: real only if deployment is misconfigured or input is untrusted
- Needs verification: likely, but not proven from code alone

Confirmed:
- IP spoofing risk when Y2T_TRUST_PROXY=true without a real proxy (auth/rate limit keyed on forwarded IP).
- Arbitrary URL input in POST /runs (and watchlist if allow-any is enabled) allows non-YouTube fetches via yt-dlp; keep API private or add strict URL validation.
- AssemblyAI/OpenAI error bodies are logged verbatim; can leak provider response content (sanitize).
- No per-IP SSE limit (global cap only); DoS potential.

Conditional:
- PowerShell drive query in health.ts is safe today (outputDir is operator-controlled), but becomes code-injection risk if outputDir becomes user-controlled.
- Insecure mode (Y2T_ALLOW_INSECURE_NO_API_KEY=true) disables auth; safe only for local dev.
- Settings/config JSON (z.record) is permissive; safe if API is private, but should be tightened for public use.

Needs verification / hardening recommended:
- Retention symlink handling (use lstat + skip symlinks explicitly).
- Persistence runId path traversal (runId is internal UUID today; add validation for defense in depth).
- SSE request lifetime (consider max duration).
- Upload stream timeout (slow-read attack).
- EventBuffer max event size.

Claude items likely over-severity (keep as low):
- API key length timing leak: safeEqual pads buffers; length check is minor.
- Auth failure limiter "disabled when maxRequests=0": intentional config; keep as policy.

## Security Audit v8 - Round 2 (Additional Findings)

Second pass auditing CLI, config, YouTube modules, pipeline, and formatters.

### CRITICAL (3 additional issues)

9. **ytDlpPath Command Execution** - `config/schema.ts:33`, `deps.ts:13-17`
   ```typescript
   ytDlpPath: z.string().optional(),  // No path validation
   ```
   - Risk: User-controlled path passed directly to spawn()
   - Fix: Validate path exists and is executable, disallow path traversal

10. **URL Passed to yt-dlp Without Validation** - `youtube/enumerate.ts:52-54`
    ```typescript
    const result = await exec(ytDlpPath, [...args, url]);  // url from user input
    ```
    - Risk: Arbitrary URL/file path passed to yt-dlp
    - Fix: Validate URL is YouTube domain before passing to yt-dlp

11. **CLI Path Traversal in --audio** - `cli/index.ts:24,86,136`
    - `--audio` flag accepts any file path without validation
    - Risk: Could read files outside intended directories
    - Fix: Validate path is within allowed directories

### HIGH (6 additional issues)

| # | File:Line | Issue | Fix |
|---|-----------|-------|-----|
| 13 | `config/loader.ts:13` | YAML.parse() without safe options allows prototype pollution | Use `YAML.parse(raw, { schema: 'core' })` |
| 14 | `config/runs.ts:56` | YAML parsing of runs.yaml has same issue | Add safe parse options |
| 15 | `utils/exec.ts:21-25` | Unbounded stdout/stderr buffer accumulation | Add max buffer size limit |
| 16 | `pipeline/run.ts:247-256` | TOCTOU race in processed video detection | Use atomic file operations |
| 17 | `youtube/catalogCache.ts:136-155` | Cache poisoning via channelId from yt-dlp output | Validate channelId format before caching |
| 18 | `cli/index.ts:32-33,89-90` | --outDir and --audioDir accept paths without validation | Validate paths, check for traversal |

### MEDIUM (2 additional issues)

| File:Line | Issue |
|-----------|-------|
| `formatters/csv.ts:3-18` | CSV formula injection - values starting with =,@,+,- not escaped |
| `utils/logger.ts:41,45,49,60` | Log injection - user input logged without sanitization |

### Updated Security Roadmap (with Round 2)

**P0 - CRITICAL (do first):**
1. Fix PowerShell injection in health.ts:49
2. Validate runId in persistence.ts (UUID format)
3. Fix symlink attacks in retention.ts (use lstat)
4. Add per-IP SSE connection limits
5. Fix timing attack in auth.ts:70
6. *NEW:* Validate ytDlpPath in config/schema.ts
7. *NEW:* Validate YouTube URL before passing to yt-dlp
8. *NEW:* Validate --audio path in CLI

**P1 - HIGH:**
9. Disable Y2T_TRUST_PROXY by default
10. Sanitize API error messages before logging
11. Add minimum API key length (32+ chars)
12. Add per-API-key concurrent run limit
13. Fix Content-Type validation in uploads.ts
14. *NEW:* Use safe YAML parsing options
15. *NEW:* Add max buffer size to exec.ts
16. *NEW:* Validate cache keys from yt-dlp output
17. *NEW:* Validate CLI --outDir/--audioDir paths

**P2 - MEDIUM:**
18. Add URL format validation to Zod schemas
19. Add upload stream timeout
20. Remove directory paths from health response
21. Use randomUUID for all temp filenames
22. Add event size limits to EventBuffer
23. *NEW:* Escape CSV formula characters
24. *NEW:* Sanitize log output

## Security Roadmap v8 Status (0.32.0)
- All P0/P1/P2 items above are DONE.
- Remaining non-roadmap audit items to consider later:
  - `fs.ts` symlink guard for recursive mkdir
  - Webhook DNS re-resolve before fetch (TOCTOU)
  - Processed-video TOCTOU in `pipeline/run.ts`

## Phase 3.0 (DONE): Direct audio input
- `POST /audio` uploads local audio (stored under `audio/_uploads`, metadata in `output/_uploads`).
- `POST /runs` accepts `audioId` to transcribe uploaded audio.
- CLI: `--audio` + `--audioTitle` (local file input).
- `runs.yaml` supports `audioPath` + `audioTitle`.
- Upload size limit: `Y2T_MAX_UPLOAD_MB` (default 1024).
- Output goes under `output/uploads/*` and `audio/uploads/*`.
- Upload handler waits for file stream close and applies title field even if it arrives after file.

## Claude vs Implementation (Phase 3.0)
- Claude suggested `/runs/upload` with pipeline reuse; we implemented `/audio` + `POST /runs` with `audioId` (same flow, different endpoint naming).
- Pipeline reuse: kept single `runPipeline` with `RunInput` union; audio path skips yt-dlp/comments only.
- Storage layout: staging under `_uploads`, final outputs under `uploads` (matches Claude).
- Tests: added upload + audioId run + schema tests (matches Claude expectation).

## Testing / Sanity Pass
- `npm test`
- `npm run build`
- `npm --prefix web run build`
- `npm run api:contract:check`
- `npm run test:docker-smoke` (may take >5 min locally; injects `Y2T_API_KEY=smoke`)

## Bug Fix: ERR_HTTP_HEADERS_SENT crash (0.33.1)
- `json()` in `src/api/http.ts` now guards against double-response (checks `headersSent`/`writableEnded`).
- Request timeout handler in `src/api/server.ts` also guards and wraps in try/catch.
- Root cause: async handlers completing after the request timeout already sent a 408.
- Tests: `tests/apiRequestTimeout.test.ts` (2 tests).

## Web UI Improvements (0.33.1)
- Renamed labels: `live`/`offline` -> `Connected`/`Disconnected`, `Library` -> `View channel`, `Refresh` -> `Reload`.
- Added "Re-run" button per video card in both RunArtifactsLive and library channel page. Calls `POST /runs` with `force: true` and redirects to the new run page.
- Added "Fetch comments" button per video card. Calls new endpoint (see below).
- New backend endpoint: `POST /library/channels/:channelDirName/videos/:basename/fetch-comments`
  - Reads video metadata to get videoId, calls `fetchVideoComments()` via yt-dlp, saves `.comments.json`.
  - Returns `{ ok: true, count: N }` on success, 502 on fetch failure.
  - Protected by existing auth + write rate limiter.
- New Next.js proxy route: `web/app/api/library/channels/[channelDirName]/videos/[basename]/fetch-comments/route.ts`.
- New client component: `web/app/library/[channelDirName]/VideoActions.tsx` (Re-run + Fetch comments buttons).

## Secrets Management
- Secrets can be provided via `.env` file or [Doppler](https://www.doppler.com/) secrets manager.
- Doppler project: `youtube2text`, environment: `dev`.
- When using Doppler, prefix commands with `doppler run --` (no `.env` file needed).
- Documentation updated: README.md, HOW_TO_USE.md, DEPLOY_PLAYBOOK.md.

## Operator Notes
- Secrets must include `ASSEMBLYAI_API_KEY` when `sttProvider=assemblyai` (via `.env` or Doppler).
- Secrets must include `OPENAI_API_KEY` or `Y2T_OPENAI_API_KEY` when `sttProvider=openai_whisper`.
- Optional: `Y2T_MAX_AUDIO_MB` (cap before splitting) + `Y2T_SPLIT_OVERLAP_SECONDS` (overlap between chunks).
- Optional: `Y2T_MAX_UPLOAD_MB` (max upload size for `POST /audio`).
- `Y2T_API_KEY` is required for the HTTP API server (set `Y2T_ALLOW_INSECURE_NO_API_KEY=true` and `Y2T_ALLOW_INSECURE_NO_API_KEY_CONFIRM=I_UNDERSTAND` for local dev only).
- `GET /health?deep=true` requires `X-API-Key` unless `Y2T_HEALTH_DEEP_PUBLIC=true`.
- If the API is behind a trusted proxy/load balancer, set `Y2T_TRUST_PROXY=true` and `Y2T_TRUST_PROXY_IPS`.
- `Y2T_API_KEY_MIN_BYTES` enforces a minimum key length (default 32).
- `Y2T_SSE_MAX_CLIENTS` caps concurrent SSE connections (default 1000, `0` disables).
- `Y2T_SSE_MAX_CLIENTS_PER_IP` caps SSE connections per IP (default 50).
- `Y2T_SSE_MAX_LIFETIME_SECONDS` closes long-lived SSE streams (default 0 disables).
- `Y2T_MAX_EVENT_BYTES` caps SSE payload size (default 65536).
- `Y2T_UPLOAD_TIMEOUT_MS` bounds upload stream lifetime (default 120000).
- `Y2T_MAX_CONCURRENT_RUNS_PER_KEY` caps concurrent queued/running runs per API key (default 0 disables).
- `Y2T_RUN_ALLOW_ANY_URL=true` allows non-YouTube run URLs (not recommended).
- `Y2T_EXEC_MAX_BYTES` caps external command output capture (default 50MB).
- `Y2T_HEALTH_INCLUDE_PATHS=true` exposes deep health filesystem paths.
- `Y2T_API_KEY_MAX_BYTES` caps `X-API-Key` size; read/health rate limits and request timeout are configurable (see README).
- Security note: `callbackUrl` webhooks allow any http(s) URL unless `Y2T_WEBHOOK_ALLOWED_DOMAINS` is set; keep API private or enable the allowlist.

## Feature Mining: ShellSpeechToText (2026-01-03)

Analyzed sibling project at `C:\Users\cdela\OneDrive\coding\Shell\ShellSpeechToText` for reusable patterns.

### Project Overview
- Batch audio transcription processor using Deepgram Nova-3
- CLI-only (no API/Web), ~4,600 lines TypeScript
- Focus: reliability, monitoring, multi-account load balancing

### Potentially Useful Features (priority order)

**P1 - Load Balancer with Multiple API Keys** (HIGH VALUE)
- File: `../Shell/ShellSpeechToText/src/services/deepgram-load-balancer.service.ts`
- Pattern: Round-robin across multiple API accounts with automatic failover
- Features:
  - Tracks error count per account (disables after 3 consecutive errors)
  - Credit exhaustion detection
  - Auto-reset when account recovers
- Y2T application: Support `Y2T_ASSEMBLYAI_API_KEYS=key1,key2,key3` for load distribution
- Effort: Medium | Value: High (resilience, avoid rate limits)

**P2 - Deepgram as Third STT Provider** (HIGH VALUE)
- Files:
  - `../Shell/ShellSpeechToText/src/services/deepgram.service.ts` (core transcription)
  - `../Shell/ShellSpeechToText/src/services/deepgram-billing.service.ts` (balance check)
- Features:
  - Nova-3 model with speaker diarization
  - Language detection or hint-based
  - Simpler API than AssemblyAI
- Y2T application: Add `sttProvider: deepgram` option (factory pattern already supports this)
- Effort: Medium | Value: High (more provider options)

**P3 - Error Categorization System** (MEDIUM VALUE)
- File: `../Shell/ShellSpeechToText/src/utils/errors.ts`
- Pattern:
  ```typescript
  enum ErrorCategory { NETWORK, API, FILE, USER, SECURITY, SYSTEM }
  ```
- Features:
  - Analyzes error message to classify category
  - Determines if error is retryable
  - User-friendly messages per category
- Y2T application: Replace ad-hoc error handling with structured classification
- Effort: Low | Value: Medium (smarter retries, better UX)

**P4 - ML-based Processing Time Estimation** (MEDIUM VALUE)
- Files:
  - `../Shell/ShellSpeechToText/src/services/stats.service.ts` (ML estimation)
  - `../Shell/ShellSpeechToText/src/data/processing-stats.json` (historical data)
- Pattern:
  - Categorize files by size (voice <500KB, short <5MB, medium <15MB, long <40MB, very_long 40MB+)
  - Store actual processing times per category
  - Predict ETA using historical averages
- Y2T application: Add ETA field to run progress events
- Effort: Medium | Value: Medium (better progress UX)

**P5 - AI Text Cleaning Post-Process** (LOW VALUE)
- File: `../Shell/ShellSpeechToText/src/services/text-cleaner.service.ts`
- Pattern: Send transcription to GPT-4o or Claude for cleanup
- Features:
  - Corrects punctuation, spelling
  - Custom prompt from file
  - Dual-model comparison
- Y2T application: Optional pipeline stage `cleanWithAI: true`
- Effort: High | Value: Low (adds cost, niche use case)

**P6 - Telegram Bot Monitoring** (LOW VALUE)
- Files:
  - `../Shell/ShellSpeechToText/src/services/monitoring-bot.service.ts`
  - `../Shell/ShellSpeechToText/src/services/telegram-notifications.service.ts`
- Features: `/status`, `/balance`, `/retry` commands, error notifications
- Y2T application: Already have webhooks + SSE, this is redundant
- Effort: Medium | Value: Low (nice-to-have)

### Features We Already Have Better
- **File watching**: Our watchlist/scheduler is more powerful than their chokidar watcher
- **Cleanup**: Our retention.ts already handles this
- **API/Web**: They have none; we have full REST API + Next.js UI
- **Tests**: They have none; we have 110 tests

### Technical Differences
| Aspect | ShellSpeechToText | Youtube2Text |
|--------|-------------------|--------------|
| STT Provider | Deepgram Nova-3 | AssemblyAI + OpenAI Whisper |
| Input sources | Local files only | YouTube + local files |
| Interface | CLI only | CLI + REST API + Web UI |
| Concurrency | 20 parallel default | Configurable per API key |
| Tests | None | 120 tests |
| Audio splitting | 80MB threshold | Configurable Y2T_MAX_AUDIO_MB |

### Additional Patterns Found (Round 2 Analysis)

**From ShellSpeechToText - missed in first pass:**

| Pattern | File:Lines | Description | Y2T Value |
|---------|------------|-------------|-----------|
| Atomic file writes | `stats.service.ts:110-118` | Write to temp, atomic rename | HIGH - prevents corruption |
| Unicode progress bars | `progress.ts:95-106` | Partial blocks (half, quarter) | LOW - cosmetic |
| Hybrid ETA | `progress.ts:114-149` | Blend statistical + rate-based | MEDIUM - better UX |
| FFmpeg local+PATH | `audio-splitter.service.ts:244-264` | Check ./bin/ then system | LOW - we use deps.ts |
| File watcher debounce | `file-watcher.ts:116-128` | Timer map per file | LOW - we use scheduler |
| Exponential backoff | `load-balancer.service.ts:151` | `1000 * attempts` ms | MEDIUM - simpler than ours |
| Filename sanitize | `audio-splitter.service.ts:137` | Regex `[^a-zA-Z0-9_-]` | LOW - we use slugify |
| AbortController timeout | `deepgram-billing.service.ts:62` | 15s fetch timeout | MEDIUM - we lack this |
| Markdown escaping | `monitoring-bot.service.ts:104` | Escape special chars | LOW - Telegram specific |
| Model param detection | `text-cleaner.service.ts:175-186` | gpt-5/o1/o3 use different params | MEDIUM - future proofing |

### Implementation Notes for Future LLM

**If implementing P2 (Deepgram provider):**
1. Read `deepgram.service.ts` for API usage
2. Create `src/transcription/deepgram/index.ts` following OpenAI pattern
3. Add to factory and registry
4. Add `DEEPGRAM_API_KEY` to config schema

**If implementing atomic file writes:**
1. Read `stats.service.ts:110-118` for pattern
2. Apply to `persistence.ts` and `settings.ts`
3. Pattern: write temp file -> fs.rename() (atomic on same filesystem)

**AbortController timeout notes (DONE):**
1. Pattern applied in `src/transcription/assemblyai/http.ts` and `src/transcription/openai/index.ts`.
2. Config/Env: `providerTimeoutMs` / `Y2T_PROVIDER_TIMEOUT_MS` (default 120000).

## Roadmap: Feature Mining Adoption (status)

Goal: adopt the strongest ideas from `ShellSpeechToText` without copying code, preserving Y2T interfaces and modularity.

### Phase A - Low-risk hardening (DONE)
1) Atomic file writes (HIGH) - DONE
   - Target: `src/api/persistence.ts`, `src/config/settings.ts`, `src/utils/fs.ts`
   - Pattern reference: `C:\\Users\\cdela\\OneDrive\\coding\\Shell\\ShellSpeechToText\\src\\services\\stats.service.ts`
   - Approach: write to temp file + rename (same filesystem) for JSON/text writes.
   - Tests: `tests/atomicWrites.test.ts`

2) AbortController timeouts for external API calls (MEDIUM) - DONE
   - Target: `src/transcription/assemblyai/http.ts`, `src/transcription/openai/index.ts`
   - Pattern reference: `C:\\Users\\cdela\\OneDrive\\coding\\Shell\\ShellSpeechToText\\src\\services\\deepgram-billing.service.ts`
   - New env: `Y2T_PROVIDER_TIMEOUT_MS` (default 120000)

### Phase B - Provider resiliency (DONE)
3) Multi-key load balancer (HIGH) - DONE
   - Target: `src/transcription/loadBalancer.ts`, `src/transcription/factory.ts`
   - Pattern reference: `C:\\Users\\cdela\\OneDrive\\coding\\Shell\\ShellSpeechToText\\src\\services\\deepgram-load-balancer.service.ts`
   - Env: `Y2T_ASSEMBLYAI_API_KEYS=key1,key2` (optional), `Y2T_ASSEMBLYAI_KEY_FAILURES`, `Y2T_ASSEMBLYAI_KEY_COOLDOWN_MS`
   - Behavior: round-robin, disable key after N consecutive errors, auto-reset after cooldown.
   - Tests: `tests/loadBalancer.test.ts`

### Phase C - Provider expansion (DONE)
4) Deepgram provider (HIGH, completed in v0.34.0)
   - Target: `src/transcription/deepgram/index.ts`, register in factory/registry.
   - Pattern reference: `C:\\Users\\cdela\\OneDrive\\coding\\Shell\\ShellSpeechToText\\src\\services\\deepgram.service.ts`
   - Env: `DEEPGRAM_API_KEY` (or `Y2T_DEEPGRAM_API_KEY`), model setting.
   - Tests: capability listing, basic request mapping (mocked).

### Phase D - UX/observability improvements
5) Error categorization (MEDIUM)
   - Target: new `src/utils/errors.ts` or expand `transcription/errors.ts`
   - Pattern reference: `C:\\Users\\cdela\\OneDrive\\coding\\Shell\\ShellSpeechToText\\src\\utils\\errors.ts`
   - Outcome: standardized retryable vs terminal errors + user-facing messages.

6) ETA + hybrid estimation (MEDIUM)
   - Target: `src/pipeline/events.ts` (new `run:eta` or fields on `video:*`)
   - Pattern reference: `C:\\Users\\cdela\\OneDrive\\coding\\Shell\\ShellSpeechToText\\src\\services\\stats.service.ts`
   - Outcome: optional ETA (CLI + UI), based on file size categories and historical averages.

### Low priority (optional)
7) AI text cleaning post-process (LOW)
   - Target: optional pipeline stage after transcription.
8) Telegram bot monitoring (LOW)
   - Redundant with SSE + webhooks; only if required later.

## Code Review Notes (v0.32.0 audit by Claude Opus 4.5)

**Audit date:** 2026-01-04

**Overall:** Phase A implementation is solid (9/10). All P0/P1/P2 security items fixed correctly.

### Minor issues (non-blocking)

1. **Duplicated `fetchWithTimeout` utility** - RESOLVED
   - Extracted to `src/utils/fetch.ts` and reused in both providers.

2. **Missing timeout tests**
   - `tests/atomicWrites.test.ts` covers atomic writes
   - No tests verify provider timeout actually aborts requests
   - Low priority since AbortController is standard Node.js API

### Verified correct

| Security fix | File:Line | Status |
|--------------|-----------|--------|
| PowerShell injection | `health.ts:52-60` | OK - uses param() + array args |
| runId path traversal | `persistence.ts:19-29` | OK - UUID regex + no `..` |
| Symlink in retention | `retention.ts:39,48-50` | OK - isSymbolicLink filter |
| SSE per-IP limit | `server.ts:260` | OK - Y2T_SSE_MAX_CLIENTS_PER_IP |
| Timing attack length | `auth.ts:71-77` | OK - timingSafeEqual for length |
| Insecure mode confirm | `auth.ts:26-28` | OK - double confirmation |
| Min API key length | `auth.ts:96-103` | OK - Y2T_API_KEY_MIN_BYTES |
| EventBuffer size | `eventBuffer.ts:10-31` | OK - maxEventBytes + truncate |
| CSV formula injection | `csv.ts:3-9` | OK - neutralizeFormula() |
| Log sanitization | `logger.ts:10-16` | OK - sanitizeLogText() |
| Exec max buffer | `exec.ts:16-23` | OK - Y2T_EXEC_MAX_BYTES |
| Health path redaction | `health.ts:104-106,146` | OK - Y2T_HEALTH_INCLUDE_PATHS |
| Atomic file writes | `fs.ts:30-67` | OK - temp + rename pattern |
| Provider timeouts | `assemblyai/http.ts`, `openai/index.ts` | OK - AbortController |

### Paradigm compliance

- Functional style: YES (no unnecessary classes)
- Zod validation: YES (schema.ts updated)
- NonSecretSettings: YES (providerTimeoutMs added)
- Test framework: YES (node:test)
- Error handling: Consistent

## OpenClaw Skill Integration (Proposed)

Goal: Expose youtube2text as an OpenClaw skill so Winston (and other agents) can transcribe YouTube videos with speaker diarization.

### OpenClaw Skills Overview

OpenClaw skills are modular packages with:
- `SKILL.md` (required): YAML frontmatter (name + description) + markdown instructions
- `scripts/` (optional): Shell/Python scripts for deterministic operations
- `references/` (optional): Documentation to load on-demand
- `assets/` (optional): Templates, boilerplate

Key design principles:
- Conciseness: Context window is precious; only non-obvious info
- Progressive disclosure: Lean SKILL.md (<500 lines), split to references
- Description triggers the skill: Must include "when to use" info

### Existing Similar Skills (bundled with OpenClaw)

| Skill | What it does | Diarization? |
|-------|--------------|--------------|
| `summarize` | YouTube transcript extraction (best-effort) | No |
| `openai-whisper` | Local Whisper CLI transcription | No |
| `openai-whisper-api` | OpenAI Whisper API transcription | No |
| `video-frames` | Extract frames from video via ffmpeg | N/A |

**youtube2text advantage**: Speaker diarization, structured output (JSON/JSONL), bulk processing, multiple STT providers.

### Recommended Integration: HTTP API Wrapper

Since youtube2text already exposes an HTTP API (port 8787), create a thin wrapper skill:

```
Youtube2Text/
├── src/
├── web/
├── skill/                      # <- NEW
│   ├── SKILL.md
│   └── scripts/
│       ├── transcribe.sh       # POST /runs with URL
│       ├── plan.sh             # POST /runs/plan (preview)
│       ├── upload-audio.sh     # POST /audio
│       ├── fetch-artifact.sh   # GET /library/.../format
│       └── wait-for-run.sh     # Poll /runs/{id}/events (SSE)
└── package.json
```

**Why same repo (not separate)?**
- Versionado junto con la API que consume
- Un solo repo que mantener
- Los scripts pueden referenciar el mismo openapi.yaml
- Documentacion centralizada

### Winston opinion (2026-02-04)
For Carlos' goals (avoid operating a remote multi-user service and reduce support burden), prefer a SEPARATE repo for the OpenClaw skill (thin HTTP API wrapper).

Rationale:
- Decouple release cycles: Youtube2Text can evolve without forcing skill packaging changes.
- Keep the main repo focused: avoid OpenClaw-specific scaffolding in core product.
- Reduce accidental support/ownership: the skill can default to self-host (localhost) and make remote use an explicit opt-in via Y2T_API_BASE_URL.
- The "reference openapi.yaml" benefit is nice but not required; the skill can validate capabilities via /health and /providers and pin minimum API expectations.

### Claude Code opinion (2026-02-04)
Disagree with separate repo. Recommend keeping skill in same repo (`skill/` or `integrations/openclaw/`).

Where Winston is right:
- Decoupling release cycles makes sense
- Avoiding OpenClaw scaffolding in core repo is clean

Where I disagree:
- The skill is ~200 lines total (5 curl scripts + 1 SKILL.md). Not significant "scaffolding".
- Separate repo for something this small adds:
  - Another repo to maintain (issues, PRs, CI)
  - Manual sync when API changes
  - More friction for contributors

The "accidental support/ownership" concern is solved with documentation: "This skill assumes youtube2text API running locally. Remote use is your responsibility."

Recommendation: Start in same repo. Extract to separate repo only if skill grows significantly or needs to be published to an OpenClaw registry.

**Why wrapper (not monolithic)?**
- No need to bundle Node.js + yt-dlp + 200MB node_modules
- Shell scripts ~50 lines each
- Auto-benefits from youtube2text updates
- Lean context for LLM

### GPT-5 recommendation (2026-02-16)

Decision:
- Keep the wrapper architecture (OpenClaw skill calls Youtube2Text HTTP API).
- Prefer a separate skill repo for current goals (lower support burden, decoupled release cycle).

Rationale:
- Wrapper keeps complexity low and reuses already stable API surfaces.
- Separate repo avoids coupling product releases to skill packaging and ownership.
- The skill can still pin minimum API expectations via `GET /health` + `version`.

Execution advice:
- Use polling-first flow in scripts:
  1) `GET /health`
  2) `POST /runs/plan`
  3) `POST /runs`
  4) Poll `GET /runs/{id}` (or `GET /runs/{id}/logs`)
  5) `GET /runs/{id}/artifacts`
- Keep `GET /runs/{id}/events` (SSE) as optional enhancement, not a hard dependency for shell scripts.
- Default skill mode should be local/self-host; remote usage should be explicit opt-in via base URL env.

### SKILL.md Frontmatter (Draft)

```yaml
---
name: youtube2text-api
description: "Transcribe YouTube videos with speaker diarization and structured output.
  Use when: (1) transcribe YouTube video/channel/playlist, (2) need speaker labels (who said what),
  (3) want structured output (JSON/JSONL/Markdown). Requires youtube2text API at http://127.0.0.1:8787."
---
```

### Implementation Roadmap

1. Verify youtube2text API running: `curl http://127.0.0.1:8787/health`
2. Create `skill/` directory structure
3. Write SKILL.md with triggers + workflow + API reference
4. Implement wrapper scripts (curl-based)
5. Test with OpenClaw: `openclaw skills install ./skill`

### API Endpoints Used by Skill

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Check API is running |
| `POST /runs/plan` | Preview what will be processed (no credits) |
| `POST /runs` | Start transcription run |
| `GET /runs/{id}/events` | SSE progress stream |
| `GET /runs/{id}/artifacts` | Retrieve outputs |
| `POST /audio` | Upload local audio file |
| `GET /library/channels/{ch}/videos/{id}/{format}` | Download transcript |

## Where To Read More
- `docs/llm/HISTORY.md` (append-only change log)
- `docs/llm/DECISIONS.md` (why we chose things)
- `docs/llm/HANDOFF_ARCHIVE.md` (older handoff content, audits, UX decisions)
