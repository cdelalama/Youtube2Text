# Docs + Versioning Roadmap

## Goal
Make documentation and versioning predictable, testable, and release-safe.

## Baseline (2026-02-07)
- Version policy exists but had stale references.
- No automated check enforced consistency across all version markers.
- No single operational roadmap for docs/versioning lifecycle.

## Milestones

### M1 - Consistency Guardrails (Due: 2026-02-10)
Scope:
- Normalize `docs/VERSIONING_RULES.md` with an explicit source-of-truth policy.
- Add automated checker (`npm run version:check`).
- Add unit tests for checker behavior and repo synchronization.

Done when:
- `npm run version:check` passes.
- `npm test` includes version-check tests and passes.
- `docs/PROJECT_CONTEXT.md` and `docs/llm/HANDOFF.md` match `package.json`.

### M2 - Contributor Workflow (Due: 2026-02-12)
Scope:
- Update PR checklist to require docs/version checks when relevant.
- Add operations index entry for this roadmap.

Done when:
- `.github/PULL_REQUEST_TEMPLATE.md` references version/docs checks.
- `docs/operations/README.md` links this roadmap.

### M3 - Release Execution Runbook (Due: 2026-02-14)
Scope:
- Define release-ready command sequence and rollback notes in docs.
- Require history entry for each version-impacting change.

Done when:
- Release instructions are explicit and command-based.
- Version-impacting changes are reflected in `docs/llm/HISTORY.md`.

### M4 - Continuous Enforcement (Due: 2026-02-17)
Scope:
- Enforce checks in CI (or local pre-merge workflow if CI unavailable).
- Track drift incidents and reduce manual correction loops.

Done when:
- Merge path requires green status for:
  - `npm run version:check`
  - `npm run api:contract:check`
  - `npm test`

## Execution Plan (Current Sprint)
1. Implement M1 and M2 in this change set.
2. Run full local validation (build, contract, tests, version checks).
3. Prepare follow-up PR for M3/M4 if CI workflow is not yet wired.

## Risks and Mitigations
- Risk: stale docs survive while code changes quickly.
  - Mitigation: fail-fast `version:check` + required PR checklist.
- Risk: manual semver bumps become inconsistent.
  - Mitigation: enforce canonical sources and mirrored markers.
- Risk: generated API types drift from OpenAPI.
  - Mitigation: keep `api:contract:check` mandatory in release flow.
