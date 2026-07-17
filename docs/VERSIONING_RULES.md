<!-- doc-version: 0.39.1 -->
# Versioning Rules

## Scope
These rules define how Media2Text/youtube2text versions are bumped,
documented, and validated.

Naming note:
- `Media2Text` is the visible product brand.
- `youtube2text` and `Y2T_` remain the technical runtime/config contract. See
  `docs/llm/DECISIONS.md` D-018.

## Version Format
Use Semantic Versioning: `MAJOR.MINOR.PATCH`.

## Canonical Version Sources
The product version is anchored by:
- `package.json` (`version`)
- `package-lock.json` (`version` and root package version)
- `openapi.yaml` (`info.version`)

The DocKit mirror must match the same version:
- `VERSION`
- `CHANGELOG.md` (`## [X.Y.Z]`)
- docs with `<!-- doc-version: X.Y.Z -->` listed in
  `docs/version-sync-manifest.yml`

The following prose markers must also mirror the same version:
- `docs/llm/HANDOFF.md` (`Current Status -> Version`)
- `docs/PROJECT_CONTEXT.md` (`Current Status -> vX.Y.Z stable`)

Automated checks:
- `npm run version:check`
- `scripts/check-version-sync.sh`

## What Requires A Version Bump

Version-impacting changes:
- Served UI copy or behavior (`web/app/**`, generated visible pages, public
  metadata).
- API contract or API docs served to consumers (`openapi.yaml`, generated API
  types when the spec changes).
- Runtime behavior in `src/**`.
- Config/env behavior, defaults, compose, Docker, deploy scripts, or operational
  scripts.
- Release/tooling scripts that affect validation, build, deploy, or versioning.

Not version-impacting by themselves:
- Repo documentation and memory only (`README.md`, `HOW_TO_USE.md`,
  `INTEGRATION.md`, `docs/**`, `LLM_START_HERE.md`).
- HISTORY/HANDOFF/DECISIONS updates that only document state or rationale.
- Formatting/comment-only docs edits with no served runtime effect.

If a session mixes both categories, treat it as version-impacting.

## Bump Matrix

### Patch (`x.y.Z`)
- Bug fixes
- Non-breaking hardening/refactors
- Served branding/copy changes
- Non-breaking governance/tooling changes
- Documentation updates bundled with a served/runtime change

### Minor (`x.Y.z`)
- Backward-compatible features
- New optional settings/fields/endpoints
- Additive provider/features without breaking existing inputs

### Major (`X.y.z`)
- Breaking API/config/behavior changes
- Removed options/endpoints
- Required operator migration steps

## Required Steps Per Change
1. Decide whether the change is version-impacting.
2. If yes, decide bump level (`patch`, `minor`, `major`) and run:
   - `scripts/bump-version.sh <new_version>`
3. Update the prose status markers in:
   - `docs/llm/HANDOFF.md`
   - `docs/PROJECT_CONTEXT.md`
4. Add one append-only entry at the top of `docs/llm/HISTORY.md`.
5. Run verification appropriate to the change:
   - `npm run naming:check`
   - `npm run version:check`
   - `scripts/check-version-sync.sh`
   - `npm run api:contract:check`
   - `npm test`
6. If API schema changed, regenerate and commit:
   - `npm run api:types:generate`

## PR Gate
A PR touching version-impacting surfaces must include:
- Updated version markers from `scripts/bump-version.sh`
- `docs/llm/HISTORY.md` entry
- Passing `naming:check`, `version:check`, `check-version-sync.sh`,
  `api:contract:check`, and tests

A repo-docs-only PR may have no version bump, but still needs a HISTORY entry
when an LLM session changed files.

## Secrets and Example Files
- Never commit real credentials.
- Keep `.env.example`, `config.yaml.example`, and `runs.yaml.example` aligned with supported settings.
- Document new env/config options in `README.md` and operational docs.

## Fail-Fast Rule
If `npm run version:check` fails, do not merge or release.
If `npm run naming:check` fails, do not rename internals to match the brand;
read `docs/llm/DECISIONS.md` D-018.
