# Homelab Project Deploy Checklist

Walk through every item before declaring a deploy of this project
complete. If an item does not apply, mark `N/A` with one line of
justification (so the next reader knows it was considered, not
forgotten).

Required consumer obligations are excluded from this N/A convention. They use
the owner-resolved integration plan and authentic scoped operator exclusions.

## Build and image

- [ ] Artifact provenance is immutable. A first-party image is built and pushed
  to the private registry with a version tag and recorded digest; an upstream
  image is pinned to the reviewed platform digest. `docker save | ssh docker
  load` is a documented fallback only.
- [ ] The target host can resolve and fetch the exact declared image digest.
- [ ] Image naming and transfer follow the current
  `~/src/home-infra/docs/CONVENTIONS.md` *Docker Image Management* rules.

## Secrets

- [ ] Doppler project + config exist in the operator-approved workspace.
- [ ] On dev-vm: Doppler CLI authenticated (`doppler login`).
- [ ] On NAS: service token configured (Doppler CLI not installed on
  NAS; use `dopplerhq/cli` Docker image with `DOPPLER_TOKEN`).
- [ ] No secret values committed to this repo, to `infra.contract.yml`,
  or to any docs.

## Runtime

- [ ] `docker-compose.yml` placed at the standard path:
  - dev-vm: `~/runtime/<project>/docker-compose.yml`
  - NAS: `/share/Container/compose/<project>/docker-compose.yml`
- [ ] Container starts cleanly (`docker compose up -d`).
- [ ] Healthcheck passes (if defined). Logs show no errors on startup.
- [ ] On NAS, verified the docker-compose path workaround:
  `/usr/local/lib/docker/cli-plugins/docker-compose up -d`.

## Home Infra source publication gate (`~/src/home-infra/`)

- [ ] `docs/INVENTORY.md` updated when hosts, ports, or IPs change.
- [ ] `docs/SERVICES.md` updated with the new or relocated service.
- [ ] Canonical `docs/PROJECTS.yml` updated and validated; generated
  `docs/PROJECTS.md` refreshed only through
  `python3 scripts/project-registry.py render --write`.
- [ ] Project Birth acceptance recorded in
  `catalog/project-acceptances.yml` when applicable.
- [ ] `catalog/services.yml` updated when required by the resolved owner integration policy
  (will be rendered by `infra-portal`).
- [ ] `catalog/project-contracts.yml` and the Portal contract bundler updated
  when required by the resolved owner integration policy.
- [ ] The vhost is declared in Home Infra's source-controlled edge-caddy
  configuration with the narrowest backend route.
- [ ] Catalog, project registry, generated projection, contract joins and edge
  candidate all validate.
- [ ] All Home Infra source inputs committed and pushed before DNS, edge apply,
  runtime catalog synchronization, or Portal readback.

## Network and TLS (only if the project exposes UI / API / status)

- [ ] DNS configured through Home Infra's current bounded UniFi procedure:
  `<service>.lamanoriega.com → <host-ip>` (TTL 300).
- [ ] The Home Infra edge helper passed check and apply from the clean published
  Home Infra revision:
  ```sh
  scripts/edge-caddy-config --check
  scripts/edge-caddy-config --apply
  ```
  The helper owns candidate validation, backup, bounded recreation, adjacent
  ingress checks and automatic rollback; do not patch the NAS Caddyfile or
  restart the shared proxy manually.
- [ ] HTTPS verified from LAN
  (`curl -fsS https://<service>.lamanoriega.com/...`).
- [ ] Cert chain confirmed
  (`*.lamanoriega.com` wildcard, currently valid).

## Required consumers (owner-resolved obligations)

- [ ] Record the `delivery_gate.py check` integration verdict. Generic N/A is
  forbidden for required Portal/Dossier obligations.

- [ ] Ran Home Infra's canonical `scripts/sync-portal-inputs-to-nas.sh` only
  after the Home Infra and project contract revisions were clean and pushed.
- [ ] Verified catalog, contracts and provenance readback without restarting
  Infra Portal.

## Documentation in this project

- [ ] `docs/operations/DEPLOY_PLAYBOOK.md` reflects the deploy reality
  (paths, images, hosts, compose location, rollback recipe). Links to
  `~/src/home-infra/docs/CONVENTIONS.md` instead of duplicating it.
- [ ] `docs/llm/HANDOFF.md` *Last Updated* and *Session Focus* match
  this session.
- [ ] `docs/llm/HISTORY.md` has an entry for this deploy.
- [ ] `CHANGELOG.md` reflects the new version.
- [ ] `VERSION` and all version-synced doc-version markers in sync
  (`scripts/check-version-sync.sh`).
- [ ] Project repo committed and pushed.

## Project interface

- [ ] `infra.contract.yml` declared at the project root, with `TODO`
      placeholders replaced by real values.
- [ ] Every project-owned loop classified correctly:
      `sync_jobs[]` for an external source of truth,
      `telemetry_jobs[]` for self/host observation.
- [ ] Every declared job has a sanitized representative status snapshot.
- [ ] Operator-visible capabilities are declared in `capabilities[]`; every
      restricted capability has a stable reason and explicit enablement path.
- [ ] Capabilities that require runtime proof reference a telemetry job, and
      its representative snapshot publishes the complete observation set.
- [ ] Canonical validation passes without a copied validator:
      `~/src/home-infra-protocol/scripts/validate-project-interface.py
      --contract infra.contract.yml
      --status <job-id>=<representative-status.json>`.
- [ ] Periodic jobs declare `stale_after > cadence`; producer snapshots do not
      self-declare freshness.
- [ ] No secret values in the contract; only approved store and variable
      references.
- [ ] Note in `docs/llm/DECISIONS.md` recording that this project
      declares a contract and which protocol version it targets.
- [ ] Contract and status provenance presented to the operator; Home Infra was
      not edited or treated as accepting the interface automatically.
- [ ] Private incubating fields such as `operational_review` were not copied
      into the reusable project contract.
- [ ] Capability observations contain availability evidence only and do not
      repeat policy, scope, risk, secret, identity, command, or message data.

## Final smoke check

- [ ] From a LAN client: the service responds at its public URL with
  the expected status, payload, or login screen.
- [ ] From a WireGuard client: same as above.
- [ ] No regression in adjacent services on the same host
  (spot-check at least one other vhost on `edge-caddy`).

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
