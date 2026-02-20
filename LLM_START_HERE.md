# LLM Start Guide - Youtube2Text

## Read This First (Mandatory)

Welcome to Youtube2Text. Before you contribute, review and adapt the sections below to match the project requirements. Replace angle-bracket placeholders (<...>) with real values and share this file with every LLM agent.

Recommended reading order:
0. `~/infrastructure/` (network, servers, services, conventions — shared across all projects)
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
- Last Updated: 2026-02-18 - Claude Opus 4.6
- Working on: Phases 0-3.0 complete. v0.36.0 adds Pipeline Integration API (beforeDate, videoResults, GET /catalog, videoIds). Optional roadmap: Phase D (error categorization, ETA estimation) and Phase 3+ (multi-tenant cloud platform).
- Status: v0.36.0 stable. CLI + API + Web UI + Docker all operational. 146/146 tests passing. Build + API contract checks passing. Security roadmap v8 P0/P1/P2 done.

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

## Customization Notes for Maintainers
- Replace <PROJECT_NAME> with the actual project name.
- Define the conversation language (or remove the rule if not applicable).
- Remove or adapt any sections that do not align with your workflow (e.g., environment file policy).
- Populate docs/STRUCTURE.md with details about your repository layout.

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
