# Repository Structure Guide

This document describes the current repository layout for Media2Text. The
repository/runtime name remains `youtube2text` by design.

## Top-Level Layout

`
youtube2text/
+- README.md
+- LLM_START_HERE.md
+- INTEGRATION.md
+- HOW_TO_USE.md
+- infra.contract.yml # Project-owned Home Infra Protocol contract
+- docs/
+- fixtures/        # committed consumer evidence
+- src/
+- scripts/
+- tests/
+- output/          # generated
+- audio/           # generated
+- web/             # Next.js admin UI
+- .github/
+- ...
`

## Directory Descriptions

| Path | Purpose | Notes |
|------|---------|-------|
| docs/ | Central documentation, policies, and runbooks | Required |
| docs/MEDIA_PIPELINE_CROSS_PROJECT_ROADMAP.md | Cross-project ownership, sequencing, gates, and session dispatch prompts | Planning |
| docs/llm/ | LLM-specific handoff/history/decisions | Required |
| docs/operations/ | Runbooks and operational procedures | Recommended |
| infra.contract.yml | Home Infra Protocol project/job ownership and status declaration | Required for portal registration |
| fixtures/ | Sanitized, byte-stable consumer evidence with integrity manifests | Tracked |
| src/ | Application source code | Required |
| scripts/ | Utility scripts (dev, release, ops) | Optional |
| tests/ | Automated tests | Recommended |
| output/ | Pipeline results by channel/video | Generated |
| audio/ | Downloaded audio artifacts | Generated |
| web/ | Next.js admin UI (Phase 1) | Optional |
| .github/ | Issue/PR templates and workflows | Optional |

## `src/` Modules (current)

- `src/cli/` - CLI entrypoints and orchestration.
- `src/api/` - HTTP API runner (SSE, runs persistence, auth, webhooks, scheduler, watchlist, retention, rate limiting, metrics, uploads).
- `src/config/` - configuration loading from `.env`, optional `config.yaml`/`runs.yaml`, and non-secret defaults from `output/_settings.json`.
- `src/youtube/` - enumeration/metadata/download wrappers around `yt-dlp`.
- `src/transcription/` - provider interface plus AssemblyAI, Deepgram, and OpenAI Whisper implementations.
- `src/formatters/` - derived artifacts (`.txt`, `.md`, `.jsonl`, optional `.csv`).
- `src/storage/` - output layout, idempotency checks, processed-index scan, and persistence helpers.
- `src/pipeline/` - the orchestrated pipeline (events, planning, run execution, JSONL event emitter).
- `src/transcripts/` - canonical serialization, hashing, legacy v1 reads, and
  provenance-complete immutable Transcript Store v2 records.
- `src/jobs/` - bounded SQLite intake/lease/idempotency/outbox state plus
  transcript lifecycle projections, artifact workers, and delivery workers.
- `src/utils/` - filesystem/exec/logging helpers (incl. audio splitting).
- `docs/contracts/` - Media2Text-owned schemas/lifecycle plus byte-pinned
  producer compatibility profiles. The Plaud Mirror profile copy includes its
  producer manifest and `pin.json`; changes require a reviewed producer SHA.

## Naming Conventions

- Canonical identifiers: YouTube `channel_id` and `video_id`.
- Outputs live under `output/<channel_title_slug>__<channel_id>/`.
- File basenames are configurable (see `Y2T_FILENAME_STYLE` in README).
- Generated directories (`output/`, `audio/`) should not be committed.
- Environment variables are uppercase with underscores (e.g., `ASSEMBLYAI_API_KEY`).

## Onboarding Notes

1. Read `README.md` for usage and configuration.
2. If integrating: read `INTEGRATION.md`.
2. Review `docs/PROJECT_CONTEXT.md` and `docs/ARCHITECTURE.md` for roadmap.
3. Read `docs/llm/README.md` and then `docs/llm/HANDOFF.md` before coding.
