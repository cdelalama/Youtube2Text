<!-- doc-version: 0.39.2 -->
# Project Context - Media2Text

## Vision
Build a modular local-first pipeline to turn YouTube/video sources and direct
audio files into speaker-diarized transcripts, stored on disk in structured
formats for later analysis, UI browsing, and downstream automation.

Naming architecture:
- Visible brand: Media2Text.
- Technical runtime/repo/config contract: `youtube2text` and `Y2T_`.
- This split is intentional; see `docs/llm/DECISIONS.md` D-018.

## Objectives
1. Provide a CLI that accepts a public YouTube channel, playlist, or video URL with optional filters (date, max videos).
2. Enumerate videos reliably without requiring YouTube API keys.
3. Download audio-only tracks per video using `yt-dlp`.
4. Transcribe audio via AssemblyAI (diarization), Deepgram (diarization), or OpenAI Whisper API.
5. Persist results as `.json` (canonical) plus clean, speaker-labeled `.txt` and `.md` (timestamps + wrapping), plus `.jsonl` (one utterance per line), with optional `.csv` export.
6. Ensure idempotency and robust fault handling (skip already processed videos, retry transient failures).

## Stakeholders
- Product owner: TBD
- Technical owner: TBD
- Primary users: Researchers, creators, or teams needing diarized transcripts at scale.
- Additional stakeholders: TBD

## Architectural Overview
The system is designed as a set of reusable stages coordinated by a CLI orchestrator.

Stages:
- **InputResolver**: resolves a channel/playlist URL to a list of video IDs and metadata.
- **AudioExtractor**: downloads and caches audio locally (mp3/wav).
- **TranscriptionProvider**: interface for ASR backends; AssemblyAI + Deepgram + OpenAI Whisper implementations.
- **Formatter**: converts diarized transcript JSON to readable `.txt` and optional `.csv`.
- **Storage**: persists outputs under a stable on-disk layout and performs idempotency checks.
- **Orchestrator (CLI)**: applies filters, concurrency limits, retries/backoff, and logging.

This separation keeps the pipeline local-first and makes later extensions straightforward:
- replace AssemblyAI with another provider,
- add semantic post-processing (summaries/topics),
- attach a web dashboard that reads stored outputs only,
- package the pipeline for deployment (Docker image included for the HTTP API runner).

## Key Components
| Component | Purpose | Owner | Notes |
|-----------|---------|-------|-------|
| InputResolver | Channel/playlist -> video list | TBD | Uses `yt-dlp --flat-playlist`. |
| AudioExtractor | Video -> local audio file | TBD | Wraps `yt-dlp` for audio-only download. |
| TranscriptionProvider | Audio -> transcript | TBD | AssemblyAI (diarized) + Deepgram (diarized) + OpenAI Whisper API. |
| Formatter | Transcript -> txt/csv | TBD | Speaker-labeled output. |
| Storage | Persist outputs + idempotency | TBD | Layout: `output/<channel_title_slug>__<channel_id>/<basename>.*`. |
| Orchestrator (CLI) | Pipeline coordination | TBD | Concurrency, retries, filters. |

## Current Status (2026-07-17)
v0.39.2 stable in source implements the commit-pinned Plaud Mirror
Transcription Intake v1 compatibility profile as an additive facade over the
existing Media2Text job domain. It adds producer-scoped bearer authentication,
collection-aware idempotency, a separate artifact bearer, durable monotonic
HMAC status callbacks, pull reconciliation, and byte-pinned contract tests.
The NAS runs v0.39.1 behind the least-exposure Home Infra route. A bounded MP3
canary completed the full Plaud Mirror -> Media2Text -> Plaud Mirror path,
including authenticated artifact transfer, Deepgram transcription, immutable
Transcript Store materialization, signed push, pull reconciliation, distinct
source/transcript hashes, and source lease release. An OGG canary exposed a
Plaud container with an additional private stream that Deepgram rejected;
v0.39.2 preserves the verified original and creates a deterministic
single-stream MP3 provider derivative before any provider reservation. v0.38.2
also provides Cortex V1 with a committed byte-stable real
legacy JSONL fixture, but live Transcript Ready delivery remains separately
gated on Cortex review. The runtime includes provider-boundary usage accounting,
hard economic limits, signed application sessions, CI, registry deployment,
Transcript Store v1, bounded SQLite coordination, and sanitized Home Infra
status. The deployed runtime currently has
the Media2Text operator console splitting `Estado` and `Nueva captura`,
English-mode activity table headers fixed on the `Status` screen, and explicit
scheduler auto-start OFF copy when `Y2T_SCHEDULER_ENABLED=false`. All planned phases (0-3.0) and
security hardening (P0/P1/P2) complete. Pipeline Integration API added for
external orchestration. Media2Text is now the visible product brand while the
technical runtime remains `youtube2text`.

Completed:
- CLI supports channel/playlist/single-video URLs + direct audio input
- Audio download via `yt-dlp`, cached locally
- AssemblyAI diarized transcription + Deepgram + OpenAI Whisper API (multi-key load balancer)
- Outputs: `.json`, readable `.txt` and `.md`, `.jsonl`, optional `.csv`
- Optional comments dump via `yt-dlp` into `.comments.json` (non-fatal)
- Per-video `.meta.json` and per-channel `_channel.json` sidecars for browsing/indexing
- Structured JSONL events via `--json-events` (for a future service/UI)
- Language auto-detection via yt-dlp metadata/captions (with manual override)
- AssemblyAI automatic language detection fallback when yt-dlp has no language
- Node test coverage for core, API, auth, provider safety, ledger concurrency,
  and provider-boundary economic enforcement
- yt-dlp error classification + smarter retries (no retries for access-denied)
- HTTP API runner with OpenAPI spec (SSE events + artifacts listing)
- API run/event persistence on disk (restart-safe by default)
- Docker image + docker compose for the API runner
- Phase 2.1: API key auth, plan preview, webhooks, cache-first, integration docs
- Phase 2.2: Extended healthcheck, CORS allowlist, retention/cleanup
- Phase 2.3: Scheduler/watchlist (cron): plan-first followed-channels automation
- Phase 2.4: Cancel runs (cooperative) + write rate limiting
- Phase 2.4.x: OpenAPI 4XX completeness, graceful shutdown, debug logs endpoint
- Phase 2.5: Watchlist web UI + Prometheus metrics endpoint
- Phase 2.6: Run configuration UX (maxNewVideos + plan preview)
- Phase 2.7: Channel catalog cache + processed index + Settings UI
- Phase 2.8: Security hardening (validation, sanitization, rate limiting)
- Phase 2.9: STT provider capability refactor
- Phase 3.0: Direct audio input (`POST /audio` + audioId runs + CLI `--audio`)
- Security Audit v8: All P0/P1/P2 items fixed (11 CRITICAL + 18 HIGH + 17 MEDIUM)
- Feature Mining Phase A: Atomic file writes + provider timeouts
- Feature Mining Phase B: Multi-key load balancer with failover
- Provider-boundary usage ledger, hard economic limits, and live cost metrics
- GitHub Actions CI, stable yt-dlp pin/watch, and registry NAS deploy/rollback
- Redesigned Next.js Media2Text operator console with visible roadmap badges,
  direct audio upload, transcript format views, and speaker labels
- DELETE endpoints for library channels and videos (web UI + API)
- Graceful handling of deleted content in run detail pages
- Byte-stable real JSONL consumer fixture with a sanitized provenance manifest
  and automated SHA-256/JSONL validation

Optional / not yet implemented:
- Feature Mining Phase D: Error categorization + ETA estimation
- Phase 3+: Multi-tenant cloud platform (auth, DB, object storage, workers, billing)

## Roadmap / Milestones
1. Phase 0: Core service hardening (yt-dlp reliability, HTTP API runner, disk persistence, Docker) - DONE
2. Phase 1: Local-first web UI (OpenAPI contract, global SSE, output formats) - DONE
3. Phase 2: Hosted single-tenant service - DONE (all sub-phases 2.1-2.9)
4. Phase 3.0: Direct audio input (`POST /audio` + audioId runs + CLI `--audio`) - DONE
5. Security: Audit v7 (S1-S4) + Audit v8 (P0/P1/P2) - DONE
6. Feature Mining Phase A: Atomic writes + provider timeouts - DONE
7. Feature Mining Phase B: Multi-key load balancer - DONE
8. Feature Mining Phase C: Deepgram provider - DONE
9. Feature Mining Phase D: Error categorization + ETA estimation - optional, not started
10. Phase 3+: Multi-tenant cloud platform - optional, not started

## References
- AssemblyAI API Docs: https://www.assemblyai.com/docs/
- Deepgram API Docs: https://developers.deepgram.com/
- OpenAI Whisper API: https://platform.openai.com/docs/guides/speech-to-text
- yt-dlp Docs: https://github.com/yt-dlp/yt-dlp
