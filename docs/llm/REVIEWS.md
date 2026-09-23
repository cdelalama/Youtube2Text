# Reviews

## 2026-09-23 - DocKit fleet source update

Review: exact claude-opus-5-5, requested high effort, read-only Read/Glob/Grep.
Session: e06df549-3d43-4283-90a3-4f1833f7af04; modelUsage verified.
Command selected --model claude-opus-5-5 --effort high --restricted
--permission-mode dontAsk --tools Read,Glob,Grep --allowedTools Read,Glob,Grep
--strict-mcp-config --mcp-config empty; resumed the same session for findings.
Reviewed candidate tree (non-commit object): c683fb0cb8bd2ef3010699e4d51dd1dad56b6ac1.
Status: SOURCE/ROLLOUT GO after three same-session rounds. Publication is source-only.
Validation: project version/session checks pass; identical delivery helpers use
the central 84-case suite; DocKit source validator suite passes 96 cases.
Evidence is executor-supplied. Receipt-only metadata does not change delivery
inputs. See LLM-DocKit/docs/FLEET_ROLLOUT_2026-09-23.md for final verdict,
publication and project-specific exceptions. No runtime authority is added.


Keep this file ASCII-only to avoid Windows encoding issues.

## 2025-12-14 - Claude - Phase 1 Web UI Review

### What GPT did well
- Next.js 14 App Router with RSC: pages fetch on server, minimal client JS.
- `output: "standalone"` in next.config.mjs: optimized Docker bundle.
- Minimal deps: only next, react, react-dom (no UI framework bloat).
- Clean separation: `lib/api.ts`, `lib/apiSchema.ts`, `app/` pages.
- CSS variables for theming, no heavy frameworks.
- Docker multi-stage uses `.next/standalone` output correctly.
- API extended with `/library/channels`, `/library/channels/:id/videos`, artifact streaming.
- Reuses `FileSystemStorageAdapter` - no path logic duplication.
- Excludes `_runs/` from channel listing (dirs starting with `_` are reserved).
- SSE client (`RunEvents.tsx`) uses `EventSource` correctly.

### Areas to improve (future iterations)
- Types duplicated: resolved via OpenAPI-generated types + `web/lib/apiSchema.ts` facade.
- No error handling in UI: resolved (global error boundary with actionable instructions).
- No form to create runs: resolved (`CreateRunForm` posts `POST /runs`).
- Mixed styling: resolved (no inline `style={{}}` in `web/app/*`).
- SSE no auto-reconnect: EventSource auto-reconnects, but UX could be improved (backoff/last-error display).

### Verdict
Good scaffold for Phase 1 "local-first admin". Functional, minimal, correct architecture. Issues are minor and fixable in later iterations.
