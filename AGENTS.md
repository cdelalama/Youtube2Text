# LLM Agent Context

This project participates in a homelab whose source of truth lives in
`~/src/home-infra/`. Any LLM agent (Claude Code, Codex CLI, Cursor, or
any other) working in this repository must read the relevant homelab
context before making infrastructure-affecting changes.

This file is the canonical agent-instructions document for this project.
`CLAUDE.md` (if present) is a symlink to this file so Claude Code's
loader picks it up; the content stays LLM-neutral on purpose.

## Required reading (in this order)

1. `~/src/home-infra/docs/CONVENTIONS.md` — homelab build, deploy,
   secrets (Doppler), and NAS/QNAP quirks.
2. `~/src/home-infra/docs/INVENTORY.md` — current observed state of
   hosts, IPs, ports.
3. `~/src/home-infra/docs/SERVICES.md` — services already running per
   host.
4. `.claude/checklists/homelab-project.md` — local deploy checklist
   for this project (installed by the homelab profile).
5. `~/src/home-infra-protocol/docs/PROJECT_CONTRACTS.md` and
   `~/src/home-infra-protocol/SPEC.md` before completing or changing
   `infra.contract.yml`.

## Mandatory updates

When an operator-authorized deployment or acceptance changes the homelab —
deployment target, exposed URL, secrets, host placement, runtime version, image
tag — its control-plane slice must update `~/src/home-infra/`:

- `docs/INVENTORY.md` — when hosts, IPs, or ports change.
- `docs/SERVICES.md` — when a service is added, removed, or
  relocated to another host.
- `docs/PROJECTS.yml` — the canonical typed project registry, when a project is
  created or retired or when accepted source/runtime/lifecycle reality changes.
  Regenerate `docs/PROJECTS.md` through
  `python3 scripts/project-registry.py render --write`; never hand-edit the
  generated projection. Internal patch releases that never reach an accepted
  source or runtime do not warrant a registry update.
- `catalog/project-acceptances.yml` — when Home Infra explicitly accepts a
  Project Birth transition or other declared project interface.
- `catalog/services.yml` — when required by the resolved owner integration policy
  (`infra-portal` will render it).
- `catalog/project-contracts.yml` — when a required consumer project contract or
  its bundled status/capability inputs are accepted.

These updates are not optional for a completed deployment, but contract
validation does not authorize them automatically. The operator's global rule
(`~/.claude/CLAUDE.md`) classifies the updates as mandatory while the protocol
keeps acceptance as a separate gate.

## Project interface

This project ships a starter `infra.contract.yml` describing how it may
participate in the infrastructure. The reusable format is documented in
`~/src/home-infra-protocol/docs/PROJECT_CONTRACTS.md`.

Real projects now use `sync_jobs[]` and `telemetry_jobs[]` to publish
sanitized status snapshots consumed by Home Infra and Infra Portal. The
project contract still does not become infrastructure truth automatically:
Home Infra remains authoritative only after explicit operator acceptance.

Before claiming the interface is implemented:

1. classify each loop as sync (external source of truth) or telemetry
   (self/host observation);
2. replace every TODO and remove examples that do not apply;
3. produce a sanitized representative status snapshot for every declared job;
4. run the canonical validator from the protocol checkout:

   ```sh
   ~/src/home-infra-protocol/scripts/validate-project-interface.py \
     --contract infra.contract.yml \
     --status <job-id>=<representative-status.json>
   ```

The validator is invoked across the repo boundary and must not be copied here.
Passing validation proves contract shape only. It does not prove deployment,
freshness, successful backup, or Home Infra acceptance.

Private adopter-only fields under incubation, including
`operational_review`, must not be added to this reusable project template.

## Anti-rules

- Do not invent infrastructure facts. Real state lives in
  `~/src/home-infra/`. If you do not see something there, it is not
  true.
- Do not duplicate `home-infra/docs/CONVENTIONS.md` content into this
  project. Link to it from `docs/operations/DEPLOY_PLAYBOOK.md`.
- Do not deploy without walking through
  `.claude/checklists/homelab-project.md`. Every checked item is a
  guarantee.
- Do not put secret values in this file or in `infra.contract.yml`.
  Secrets are referenced only by approved store and variable name (normally
  Doppler in this homelab).
- Do not copy the protocol validator into this project. Invoke the canonical
  script from `~/src/home-infra-protocol`.
- Do not edit Home Infra automatically after validation. Present the contract,
  status location, and provenance for explicit operator acceptance.
- Do not edit `home-infra` from inside this project's automation. The
  operator does it during deploy, with the checklist as the gate.
- Do not patch or restart shared edge-caddy manually. Use Home Infra's
  source-controlled configuration and `scripts/edge-caddy-config` helper.
- Do not sync Portal inputs from the consumer repo. Use Home Infra's
  `scripts/sync-portal-inputs-to-nas.sh` and verify provenance without a Portal
  restart.
- Commit and push clean Home Infra and project-contract source inputs before
  either shared edge apply or Portal synchronization; both runtime paths must
  be traceable to published revisions.

## Required integration validation

Resolve consumer obligations from the infrastructure owner's current policy and
trusted subject admission, independently of the project plan. Invoke the owner
integration gate at study intake, Project Birth, review and delivery closeout.
Missing admission, missing complete plan, stale relevant policy, missing checker
or a skipped required check cannot yield overall PASS. The owner's default
applies to headless/API projects as well as browser interfaces. Exclusions need
a scoped authentic operator instruction retained by the owner, never agent N/A.

Use the canonical ForgeOS integration matrix in reviewer packets. Documentary
validation is only one component of the owner's composed closeout. Required
Portal evidence joins intended published catalog, accepted consumer input,
project/service identity, rendered access and backend function. Required Dossier
evidence distinguishes declaration, native capture, admitted reviewed publication,
fixed reader, exact history/permalink and coherent recovery. Source planning
requires no live runtime. Legacy adoption follows explicit owner dispositions;
no inferred new obligation or historical receipt rewrite.
