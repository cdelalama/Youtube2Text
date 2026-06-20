# Changelog

All notable changes to Media2Text/youtube2text are documented here. This file
is tracked by `docs/version-sync-manifest.yml` and updated via
`scripts/bump-version.sh`.
For the detailed, append-only session log see `docs/llm/HISTORY.md`.

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
