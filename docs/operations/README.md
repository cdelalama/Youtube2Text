# Operations Runbooks

Use this folder to store operational procedures, drills, and incident response guides. Each runbook should be self-contained and reference related automation or scripts when relevant.

Suggested sections for each runbook:
1. Purpose and scope
2. Prerequisites and required access
3. Step-by-step procedure
4. Validation / rollback steps
5. Contact or escalation information

Create new documents in this directory as your operational footprint grows.

Index:
- `API_CONTRACT.md` - OpenAPI + generated types/client + contract-check workflow to prevent endpoint/type drift.
- `DEPLOY_PLAYBOOK.md` - Single-tenant server deployment guidance (Docker + reverse proxy + security).
- `DOCS_VERSIONING_ROADMAP.md` - Delivery roadmap for documentation/versioning guardrails and release discipline.
