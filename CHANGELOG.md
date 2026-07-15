# Changelog

All notable changes to Media2Text/youtube2text are documented here. This file
is tracked by `docs/version-sync-manifest.yml` and updated via
`scripts/bump-version.sh`.
For the detailed, append-only session log see `docs/llm/HISTORY.md`.

## [0.38.0] - 2026-07-15

### Added
- Added immutable, content-addressed Transcript Store v1 records with embedded
  provider payload, provenance, immutable representation snapshots, exact-byte
  read APIs, and a verified real-fixture export command.
- Added durable Media Intake v1 coordination using SQLite for intake jobs,
  leases, attempts, idempotency, and a deterministic per-item completion
  outbox. Remote artifact fetches require an exact origin allowlist and verify
  declared size plus SHA-256 before transcription.
- Added least-privilege `X-Media2Text-Intake-Key` authentication, sanitized
  `GET /status/media-pipeline`, draft Media Intake/Transcript Ready schemas,
  and D-020 ownership/delivery semantics.

### Changed
- `POST /audio` and audio-backed `POST /runs` now act as compatibility adapters
  to the same intake state machine used by `/v1/intakes`.
- Successful `video:done` events and `run.videoResults[]` include immutable
  transcript identity and record hash. Every completion persists one durable
  `transcript.ready` obligation before the done event.
- Node.js 24 is now the minimum runtime because coordination state uses the
  built-in SQLite API. Terminal job/outbox state has a 365-day default
  retention horizon; transcript artifacts are never pruned by it.

### Fixed
- Transcript integrity hashes now identify the exact bytes returned by the
  individual transcript endpoint, and immutable records no longer point only
  at legacy presentation paths that a forced reprocess can overwrite.

## [0.37.3] - 2026-07-15

### Added

### Changed

### Fixed
- NAS deployment now forces the legacy SCP transport supported by QNAP instead
  of assuming that its SSH server provides an SFTP subsystem.

## [0.37.2] - 2026-07-15

### Added

### Changed

### Fixed
- Web session verification now rejects non-canonical Base64URL payload and
  signature encodings, removing token-representation ambiguity.

## [0.37.1] - 2026-07-15

### Added

### Changed
- Updated the official GitHub `checkout` and `setup-node` actions to v7 so CI
  runs natively on the supported Node 24 action runtime.

### Fixed

## [0.37.0] - 2026-07-15

### Added
- Added a persistent provider-boundary usage ledger with hard caps by item,
  run, source/24h, total minutes/30d, and estimated USD/30d.
- Added authenticated `GET /metrics/cost`, Prometheus usage gauges, plan-time
  duration/cost estimates, and live operator-console budget visibility.
- Added GitHub Actions CI for tests, builds, version/naming/API contracts, plus
  Dependabot and a weekly stable yt-dlp upstream watch.
- Added versioned NAS compose/start/stop assets, registry-based deployment and
  rollback automation, and an authenticated post-deploy verifier.

### Changed
- Provider credentials and economic policy can no longer be overridden by run
  payloads. Provider key pools remain available through env/Doppler for staged
  rotation and failover.
- The API and web runtime images now run as the unprivileged `node` user; the
  web image moves to Node 24 and yt-dlp is pinned to stable `2026.7.4`.
- Updated the web runtime to Next.js 15.5.20 with patched PostCSS 8.5.19, and
  updated the API YAML parser and Redocly contract CLI, leaving the engine and
  web dependency audits free of known vulnerabilities.
- YouTube catalog entries carry duration when yt-dlp provides it, allowing
  preflight estimates to be complete without downloading audio.

### Fixed
- Runs blocked by an economic limit now finish as `run:error` and stop queued
  work before any denied provider call is made.
- Runtime manifests and standalone assets are owned by the unprivileged `node`
  user, so health/version reporting remains readable after dropping root.
- Empty optional numeric environment variables remain unset instead of being
  interpreted as zero, preserving documented values such as `Y2T_MAX_AUDIO_MB=`.
- The production web healthcheck now probes `/login`, which remains HTTP 200
  after application authentication redirects `/`.

## [0.36.12] - 2026-07-14

### Added
- Added application authentication for the Next.js operator console using a
  signed, `HttpOnly`, `SameSite=Strict` session cookie, login throttling, and
  same-origin checks for state-changing BFF requests.
- Added `Y2T_WEB_AUTH_SECRET`, `Y2T_WEB_AUTH_PASSPHRASE`, and
  `Y2T_WEB_AUTH_SESSION_HOURS` deployment settings.

### Changed
- **Breaking correction:** `GET /runs/{runId}/artifacts` now returns only
  artifacts produced by that run. It no longer leaks every artifact currently
  stored for the run's channel.
- AssemblyAI retries are split into upload, create, and polling phases. A
  potentially billable create request is not repeated, while polling can retry
  without uploading or creating the transcription again.
- Scheduler entries skipped because run capacity is full remain immediately
  eligible for the next scheduler pass instead of being deferred for a full
  interval.

### Fixed
- Fixed OpenAI Whisper construction so `providerTimeoutMs` is no longer
  interpreted as the audio-size limit, which previously reduced the effective
  limit to roughly 117 KB with the default timeout.
- Fixed AssemblyAI `creditsCheck=abort` so low, unavailable, unsupported, or
  failed balance checks abort the run instead of being caught and downgraded to
  a warning.
- Fixed the web BFF trust boundary: unauthenticated requests are rejected
  before the server injects the private backend `Y2T_API_KEY`.

## [0.36.11] - 2026-07-04

### Added
- Added a Next.js `/api/health` proxy so the Media2Text console can display
  the live engine version reported by the API.

### Changed
- Shared the video candidate selection logic between plan preview and pipeline
  execution. Runs still re-select from the current catalog when they start, but
  now use the same date/video-id/processed filtering as `/runs/plan`.
- The operator console now displays the live `/health` or `/metrics` version
  instead of a hardcoded app version.

### Fixed
- Fixed `beforeDate` run execution parity: `POST /runs` no longer processes
  videos outside the upper date bound that `POST /runs/plan` excludes.
- Persisted `queued` or `running` API runs are now marked `error` with an
  `interrupted` reason on server startup, preventing zombie active runs after a
  crash, SIGKILL, or OOM restart.

## [0.36.10] - 2026-06-22

### Changed

- Synced LLM-DocKit tooling to template v4.12.3. Trace governance now treats
  `advisor` as a first-class role alongside `executor` and `auditor`, and the
  bootstrap message clarifies session-start vs stale-read re-verification
  behavior.
- Bumped source/package/OpenAPI version markers to 0.36.10 for the tooling
  sync. No Media2Text runtime, API, Docker, or served UI behavior changed in
  this patch; NAS production remains on runtime 0.36.8.

## [0.36.9] - 2026-06-20

### Added

- `docs/integrations/CODEX.md` documents the LLM-DocKit Codex CLI
  SessionStart integration for this repository.
- `scripts/dockit-install-codex-hook.sh` and `scripts/dockit-trace-status.sh`
  are now available from the synced DocKit substrate.

### Changed

- Synced LLM-DocKit tooling to template v4.12.1, including validator,
  test-validator, hook, and manifest updates.
- Bumped source/package/OpenAPI version markers to 0.36.9 for the tooling
  sync. No Media2Text runtime behavior changed in this patch.

### Fixed

- Adopted the upstream DocKit sync fix that normalizes copied template
  `doc-version` markers to the downstream project version before validation.

## [0.36.8] - 2026-06-20

### Added
- Added explicit scheduler auto-start state in the operator console: when NAS
  reports `Y2T_SCHEDULER_ENABLED=false`, Status and Automations show that
  watchlist/scheduler capabilities exist but periodic production auto-start is
  disarmed.

### Changed

### Fixed

## [0.36.7] - 2026-06-19

### Added

### Changed

### Fixed
- Fixed the recent activity table headers on the `Status` screen so English
  mode renders `SOURCE`, `TYPE`, `WHEN`, and `STATUS` instead of Spanish labels.

## [0.36.6] - 2026-06-19

### Added
- Added a dedicated `Estado` / `Status` screen and navigation item before
  `Nueva captura` / `New capture` across desktop, mobile, and foldable layouts.

### Changed
- Split the previous combined status-and-capture surface: `Estado` now contains
  the system banner, metrics, honesty note, recent activity table, and NEXT
  banner, while `Nueva captura` contains only the link/audio composer.
- The mobile tab bar now exposes both `Estado` and `Nueva captura` as separate
  destinations.
- Cost surfaces keep the `ESTIMADO` label but no longer show hardcoded fake
  currency/minute values before `/metrics/cost` exists.

### Fixed

## [0.36.5] - 2026-06-19

### Added
- Rebuilt the web admin as the Media2Text operator console, including the
  capture, library, transcript, activity, cost, errors, sources, automations,
  API/output, and settings surfaces from the supplied redesign.
- Added direct web support for audio uploads through `POST /audio` followed by
  `audioId` run creation.
- Added visible roadmap state badges (`LIVE`, `PARCIAL`, `ESTIMADO`,
  `TODAVIA NO IMPLEMENTADO`) so future capabilities are shown without
  presenting them as live backend data.
- Added speaker-map UI in transcript view: STT speaker labels are shown as real
  data, while human speaker renaming is marked as not implemented.
- Added project-level `PRODUCT.md` and `DESIGN.md` context for future UI work.

### Changed
- Replaced the older multi-page admin shell with a single Media2Text console
  and redirected legacy web pages to the new shell.
- The Next.js proxy now forwards binary/multipart bodies and returns a stable
  JSON 502 when the API backend is unreachable.

### Fixed
- Avoided duplicated speaker labels such as `Speaker Speaker 0` when providers
  already return speaker-prefixed values.
- Added a `.gitignore` exception so the `web/app/api/audio` proxy route is not
  hidden by the generated `audio/` output ignore rule.

## [0.36.4] - 2026-06-19

### Added
- Docker smoke now verifies yt-dlp EJS readiness: `yt-dlp` is executable,
  Node.js is new enough for EJS, `yt_dlp_ejs` is installed, and
  `/etc/yt-dlp.conf` enables the Node runtime.

### Changed
- The API Docker image now builds on Node.js 24 and installs
  `yt-dlp[default]` so the matching `yt-dlp-ejs` challenge solver package is
  bundled for modern YouTube extraction.
- Docker configures yt-dlp internally with `--js-runtimes node` instead of
  reintroducing user-configurable yt-dlp flags.
- `docs/SCRIBERR_COMPARISON.md` is now tracked as a feature-mining reference
  and refreshed for the Media2Text/youtube2text naming split.

### Fixed
- Fixed the remaining yt-dlp EJS setup gap for the managed Docker/NAS runtime:
  plan/run paths now execute in an image with EJS components and a supported
  JavaScript runtime available.
- EJS setup failures are classified as non-retryable dependency errors with an
  actionable installation hint instead of generic retryable unknown failures.

## [0.36.3] - 2026-06-19

### Added
- `.dockit-config.yml` now sets `history_format: no-dash` so the upstream
  DocKit validator preserves this repository's strict HISTORY contract.

### Changed
- Adopted LLM-DocKit v4.9.6 guardrails for configurable HISTORY validation and
  structured JSON/YAML/package-lock version marker handling.

### Fixed
- Superseded the local D-019 DocKit validator fork with upstream behavior:
  unknown marker types now fail, package-lock versions are checked structurally,
  and strict no-dash HISTORY enforcement is configured rather than patched.
- Retained the project-specific pre-commit naming guard required by D-018 after
  the upstream DocKit hook sync.

## [0.36.2] - 2026-06-19

### Added
- `.dockit-config.yml` to preserve local DocKit section ownership and set the
  Trace timezone for future sessions.

### Changed
- Trace onboarding now requires second-level timestamp precision and explicit
  stale-Trace re-verification.
- Version-sync manifest keeps project-specific package/OpenAPI targets in a
  preserved section after DocKit sync.

### Fixed
- Reconciled a DocKit sync regression before commit: package/OpenAPI/lockfile
  version markers are checked again, D-019 HISTORY format enforcement remains
  active, and `scripts/check-version-sync.sh` is back to 11 targets with no
  unknown-marker false-green.

## [0.36.1] - 2026-06-18

### Added
- Media2Text visible-brand overlay for README, web metadata/header, and OpenAPI
  title/description.
- Naming contract guardrail (`npm run naming:check`) to keep `youtube2text` and
  `Y2T_` as intentional technical identifiers.
- D-019 records the local DocKit validator fork for HISTORY no-dash/newest-first
  enforcement.

### Changed
- Version governance now distinguishes repo-docs-only edits from
  served/runtime/API/tooling changes that require a product version bump.
- Version sync now includes `package-lock.json`.
- Naming contract checks now scan tracked and untracked non-ignored files.

### Fixed
- Prevented future drift between the Media2Text brand and the youtube2text
  runtime contract by recording D-018 and wiring a narrow automated check.

## [0.36.0] - 2026-02-21

### Added
- Pipeline Integration API for external orchestration: `beforeDate` filter on
  `POST /runs/plan` and `POST /runs`, `videoIds` param for exact ID processing,
  `GET /catalog` read-only catalog access, and `videoResults` per-video outcome
  tracking in `RunRecord` (flows to webhook payload).
- NAS production deployment (tagged images, Doppler `prd` config, auth enforced).

### Changed
- Adopted LLM-DocKit version-sync tooling (`VERSION`, version-sync manifest,
  session validator, pre-commit hook) alongside the existing
  `npm run version:check` workflow.

### Fixed
- (none)
