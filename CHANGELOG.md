# Changelog

All notable changes to Media2Text/youtube2text are documented here. This file
is tracked by `docs/version-sync-manifest.yml` and updated via
`scripts/bump-version.sh`.
For the detailed, append-only session log see `docs/llm/HISTORY.md`.

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
