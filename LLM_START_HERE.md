<!-- doc-version: 0.36.1 -->
# LLM Start Guide - Media2Text

## Read This First (Mandatory)

Welcome to Media2Text. Review the rules below and share this file with every LLM agent before contributing. The technical runtime/repo remains `youtube2text`; see docs/llm/DECISIONS.md D-018 before changing names. The canonical, version-managed rules live in the DOCKIT-TEMPLATE blocks at the end of this file; do not edit them outside those blocks.

Recommended reading order:
0. `~/src/home-infra/docs/` (network, servers, services, conventions -- shared across all projects)
1. This file (rules, workflows, and current expectations)
2. docs/PROJECT_CONTEXT.md (vision, architecture, current state)
3. docs/VERSIONING_RULES.md (version management policy)
4. docs/llm/README.md (LLM docs index)
5. docs/llm/HANDOFF.md (current work state and priorities)

## Critical Rules (Non-Negotiable)

### Language Policy
- All code and documentation: English (update if your project needs a different language)
- Conversation with the user: Spanish
- Comments in code: English
- File names: English

### Documentation Update Rules
- Update docs/llm/HANDOFF.md every time you make a change.
- Append an entry to docs/llm/HISTORY.md in every session.
- HISTORY format: YYYY-MM-DD - <LLM_NAME> - <Brief summary> - Files: [list] - Version impact: [yes/no + details]

### Commit Message Policy
- Every response that includes code or documentation changes must end with suggested commit information:
  - **Title:** under 72 characters
  - **Description:** under 200 characters, focused on user impact and why the change matters
- Format:
  `
  ## Commit Info
  **Title:** <concise title>
  **Description:** <short explanation of what changed and why>
  `

### Version Management
- Check VERSION declarations in scripts or modules before editing.
- Do not bump versions without consulting docs/VERSIONING_RULES.md.
- Synchronize version numbers across related files when changes span multiple scripts.

### Environment Files (If Applicable)
- It is OK to update `.env.example` to reflect supported configuration (never commit real credentials).
- Never commit real credentials in `.env` or elsewhere.
- If a new variable is needed, document it in README and `docs/llm/HANDOFF.md`.

## Current Focus (Snapshot)

Source of truth: docs/llm/HANDOFF.md.
- Last Updated: 2026-06-18
- Working on: Media2Text visible-brand overlay on the existing youtube2text runtime, plus naming/version guardrails.
- Status: v0.36.1 stable in source. CLI + API + Web UI + Docker operational. 152/152 tests passing. Security roadmap v8 P0/P1/P2 done. Production NAS deployment remains documented separately in HANDOFF.

Keep this section synchronized with the "Current Status" block in docs/llm/HANDOFF.md.

## Getting Started Checklist
- [ ] Read this entire file and update placeholders
- [ ] Review docs/PROJECT_CONTEXT.md
- [ ] Review docs/VERSIONING_RULES.md
- [ ] Read the current docs/llm/HANDOFF.md
- [ ] Confirm scope with the user
- [ ] Complete the work
- [ ] Update docs/llm/HANDOFF.md
- [ ] Add an entry to docs/llm/HISTORY.md

## Quick Navigation
- Project Overview: docs/PROJECT_CONTEXT.md
- Version Rules: docs/VERSIONING_RULES.md
- LLM Docs Index: docs/llm/README.md
- Current Work State: docs/llm/HANDOFF.md
- Change History: docs/llm/HISTORY.md
- Decision Rationale: docs/llm/DECISIONS.md
- Runbooks: docs/operations/

## LLM-to-LLM Communication
When handing off to another LLM:
1. Update docs/llm/HANDOFF.md with the current state and next steps.
2. Append an entry to docs/llm/HISTORY.md following the required format.
3. Ensure the snapshot in this file matches the latest status.

## Do Not Touch Zones
Use the Do Not Touch section in docs/llm/HANDOFF.md to flag any files or areas that must remain unchanged without explicit approval from the user.

---

Every change must be documented. If you are unsure about a rule, ask the user before proceeding.

<!-- DOCKIT-TEMPLATE:START doc-update-rules -->
### Documentation Update Rules
- Update docs/llm/HANDOFF.md every time you make a change.
- Append an entry to docs/llm/HISTORY.md in every session.
- HISTORY format: YYYY-MM-DD - <LLM_NAME> - <Brief summary> - Files: [list] - Version impact: [yes/no + details]
- Put long-form rationale in docs/llm/DECISIONS.md and link to it from HANDOFF.
- Prefer ASCII-only in docs/llm/* to avoid Windows encoding issues.
<!-- DOCKIT-TEMPLATE:END doc-update-rules -->

<!-- DOCKIT-TEMPLATE:START doc-sync-rules -->
### Documentation Sync Rules
- Keep this file's "Current Focus" section synchronized with docs/llm/HANDOFF.md "Current Status".
- Keep docs/STRUCTURE.md synchronized with the actual repository file tree.
- Keep docs/PROJECT_CONTEXT.md synchronized with architectural reality.
- Version markers (`<!-- doc-version: X.Y.Z -->`) in documentation files are managed by `scripts/bump-version.sh`. See `docs/version-sync-manifest.yml` for the full list of tracked files.
<!-- DOCKIT-TEMPLATE:END doc-sync-rules -->

<!-- DOCKIT-TEMPLATE:START commit-policy -->
### Commit Message Policy
- Every response that includes code or documentation changes must end with suggested commit information:
  - **Title:** under 72 characters
  - **Description:** under 200 characters, focused on user impact and why the change matters
- Format:
  `
  ## Commit Info
  **Title:** <concise title>
  **Description:** <short explanation of what changed and why>
  `
<!-- DOCKIT-TEMPLATE:END commit-policy -->

<!-- DOCKIT-TEMPLATE:START version-management -->
### Version Management
- Every commit that changes served/product code, API, runtime config, deploy files, or validation tooling MUST include a version bump. Repo docs/README-only edits do not require a bump by themselves.
- For version bumps, run `scripts/bump-version.sh <new_version>`; do not edit version strings manually.
- The bump script reads `docs/version-sync-manifest.yml` to update all tracked files atomically.
- Validate sync with `scripts/check-version-sync.sh` (also available as pre-commit hook).
- Do not bump versions without consulting docs/VERSIONING_RULES.md for impact level (patch/minor/major).
- Do NOT batch multiple code commits without versioning. No exceptions.
<!-- DOCKIT-TEMPLATE:END version-management -->

<!-- DOCKIT-TEMPLATE:START env-policy -->
### Environment Files (If Applicable)
- Do not edit generated .env.example files directly.
- Never change or remove existing credentials in .env or equivalent secret stores.
- If a new variable is needed, document it in the relevant README and ask the user to add it manually.
<!-- DOCKIT-TEMPLATE:END env-policy -->

<!-- DOCKIT-TEMPLATE:START checklist -->
## Getting Started Checklist
- [ ] Read this entire file and update placeholders
- [ ] Review docs/PROJECT_CONTEXT.md
- [ ] Review docs/VERSIONING_RULES.md
- [ ] Read the current docs/llm/HANDOFF.md
- [ ] Install pre-commit hook: `cp scripts/pre-commit-hook.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`
- [ ] Run `scripts/check-version-sync.sh` to verify version markers
- [ ] Confirm scope with the user
- [ ] Complete the work
- [ ] Update docs/llm/HANDOFF.md
- [ ] Add an entry to docs/llm/HISTORY.md
<!-- DOCKIT-TEMPLATE:END checklist -->

<!-- DOCKIT-TEMPLATE:START llm-communication -->
## LLM-to-LLM Communication
When handing off to another LLM:
1. Update docs/llm/HANDOFF.md with the current state and next steps.
2. Append an entry to docs/llm/HISTORY.md following the required format.
3. Ensure the snapshot in this file matches the latest status.
<!-- DOCKIT-TEMPLATE:END llm-communication -->

<!-- DOCKIT-TEMPLATE:START trace-protocol -->
## Trace Protocol

For execution or audit work, begin each substantive execution report or audit
verdict with a compact `Trace` header, then write the normal explanation in
prose. The header is for orientation; it does not replace the message.

Required chat header fields:
- `Role`: `executor` or `auditor`
- `Sent`: `YYYY-MM-DD HH:MM <local-tz> (HH:MM UTC)`. The order is mandatory:
  local time first, UTC second in parentheses.
- `Subject`: current task, or commit hash/title being implemented or audited
- `Resulting state`: what this message leaves true after it is sent
- `Repo state`: local branch vs origin and worktree status verified now
- `Validation`: checks run and result
- `Next gate`: who/what should act next

Time verification:
- Verify `Sent` before writing it; do not infer or mentally convert the time.
- If shell access is available, run both:
  ```sh
  date -u '+%Y-%m-%d %H:%M UTC'
  TZ=Europe/Madrid date '+%Y-%m-%d %H:%M %Z'
  ```
- Replace `Europe/Madrid` with `trace_protocol.local_timezone` from
  `.dockit-config.yml` when the project sets one.
- If the agent cannot verify the clock, write:
  `Sent: unverified client time YYYY-MM-DD HH:MM <claimed-tz>`.

Recommended `Resulting state` shape:

```text
Resulting state: HEAD=<hash|unchanged (hash)>; version=<version|none>; gate=<opened|cleared|blocked|superseded|next-slice>; <short note>
```

Examples:

```text
Resulting state: HEAD=01f90bb; version=4.9.1; gate=cleared; supersedes audit of d6fc816
Resulting state: HEAD=unchanged (01f90bb); version=none; gate=cleared; ready for next slice
Resulting state: HEAD=unchanged (d6fc816); version=none; gate=blocked; requires executor patch v4.9.1
```

Use clear prose after the header. Explain what changed, why it matters, what
was verified, and what risk remains.

When `trace_protocol.enabled: true` is set in `.dockit-config.yml`, the durable
half is enforced by `scripts/dockit-validate-session.sh --check trace-protocol`:
- `docs/llm/HANDOFF.md` must contain a `## Trace Anchor` section.
- HANDOFF Trace Anchor commit times may use `YYYY-MM-DD HH:MM:SS UTC` or
  `YYYY-MM-DD HH:MM UTC`.
- `docs/llm/HISTORY.md` entries dated on or after `trace_protocol.since` that
  reference backtick-quoted commit hashes must end with an inline footer:
  `Trace: role=executor|auditor; commits=hash1,hash2; state=...; validation=...; next=...`

Projects can set the local timezone used in `Sent` with:

```yaml
trace_protocol:
  local_timezone: Europe/Madrid
```

Projects that do not use executor/auditor windows can disable the chat-side
convention with:

```yaml
trace_protocol:
  enabled: false
```
<!-- DOCKIT-TEMPLATE:END trace-protocol -->

<!-- DOCKIT-TEMPLATE:START do-not-touch -->
## Do Not Touch Zones
Use the Do Not Touch section in docs/llm/HANDOFF.md to flag any files or areas that must remain unchanged without explicit approval from the user.
<!-- DOCKIT-TEMPLATE:END do-not-touch -->

<!-- DOCKIT-TEMPLATE:START footer -->
---

Every change must be documented. If you are unsure about a rule, ask the user before proceeding.
<!-- DOCKIT-TEMPLATE:END footer -->
