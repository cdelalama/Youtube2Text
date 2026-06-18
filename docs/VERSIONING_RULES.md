<!-- doc-version: 0.36.0 -->
# Versioning Rules

## Scope
These rules define how Youtube2Text versions are bumped, documented, and validated.

## Version Format
Use Semantic Versioning: `MAJOR.MINOR.PATCH`.

## Canonical Version Sources
The following files must stay synchronized:
- `package.json` (`version`)
- `openapi.yaml` (`info.version`)

The following docs must mirror the same version:
- `docs/llm/HANDOFF.md` (`Current Status -> Version`)
- `docs/PROJECT_CONTEXT.md` (`Current Status -> vX.Y.Z stable`)

Automated check:
- `npm run version:check`

## Bump Matrix

### Patch (`x.y.Z`)
- Bug fixes
- Non-breaking hardening/refactors
- Documentation-only updates that do not change API behavior

### Minor (`x.Y.z`)
- Backward-compatible features
- New optional settings/fields/endpoints
- Additive provider/features without breaking existing inputs

### Major (`X.y.z`)
- Breaking API/config/behavior changes
- Removed options/endpoints
- Required operator migration steps

## Required Steps Per Change
1. Decide bump level (`patch`, `minor`, `major`).
2. Update version in `package.json` and `openapi.yaml`.
3. Update mirrored version markers in:
   - `docs/llm/HANDOFF.md`
   - `docs/PROJECT_CONTEXT.md`
4. Add one append-only entry in `docs/llm/HISTORY.md`.
5. Run verification:
   - `npm run version:check`
   - `npm run api:contract:check`
   - `npm test`
6. If API surface changed, regenerate and commit:
   - `npm run api:types:generate`

## PR Gate
A PR touching API/config/docs must include:
- Updated version markers (if behavior/API changed)
- `docs/llm/HISTORY.md` entry
- Passing `version:check`, `api:contract:check`, and tests

## Secrets and Example Files
- Never commit real credentials.
- Keep `.env.example`, `config.yaml.example`, and `runs.yaml.example` aligned with supported settings.
- Document new env/config options in `README.md` and operational docs.

## Fail-Fast Rule
If `npm run version:check` fails, do not merge or release.
