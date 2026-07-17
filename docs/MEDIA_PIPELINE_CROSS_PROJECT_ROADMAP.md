# Media Pipeline Cross-Project Roadmap

Status: operator-ratified execution and session-dispatch artifact.

Execution checkpoint (2026-07-17): the Media2Text safety foundation, Transcript
Store, Home Infra status producer, Plaud compatibility facade, registry deploy,
and real MP3/OGG canaries are complete in deployed 0.39.3. Home Infra 0.7.6 is
synchronized. The remaining Plaud replay (622 items, 608.0074 hours, estimated
USD 335.62), live Transcript Ready delivery to Cortex, and YouTube scheduler
remain independently gated. Stage descriptions below retain their original
ratified baseline numbers as execution history, not current runtime claims.

This document assigns work across Media2Text, Home Infra, Plaud Mirror, and
Cortex. It does not authorize one repository to edit another. Each project must
load its own onboarding and validate its own current state before acting.

## Current Scope Decision

Cortex V1 has operator GO and proceeds in its own repository and session.
Media2Text must not edit Cortex or adopt Cortex internals. The live integration
remains gated on consumer review and a versioned, commit-pinned Transcript Ready
contract, but Media2Text is authorized to build the safety foundation,
provenance, Transcript Store, a real byte-stable fixture/export, and its side of
the contract. The only independent Cortex prerequisite recorded here is
containment of its development PostgreSQL exposure and default credential.

## Non-Negotiable Boundaries

- Media2Text is the visible product name. `youtube2text`, `Y2T_`, `y2t`, the
  Docker image names, Doppler project, runtime paths, and hostname remain stable
  technical identifiers.
- Home Infra Protocol is the declaration and observation plane. It is not a
  media transport or message bus.
- Infra Portal is a read-only consumer. It renders service identity,
  authentication placement, project contracts, sync jobs, telemetry jobs, and
  sanitized status snapshots. It does not execute replay or backfill actions.
- A webhook `202 Accepted` means that the receiver durably persisted an
  idempotent obligation to process an artifact reference. It does not mean that
  the artifact has been downloaded or transcribed.
- Artifact transfer must work across hosts over an authenticated network
  boundary. Shared filesystem paths and shared Docker volumes are not part of
  the contract, even if services are later co-located.
- `POST /audio`, audio-backed `POST /runs`, future producer webhooks, and future
  `/v1` routes must converge on one internal intake state machine. Compatibility
  routes may remain, but they must not own separate processing pipelines.
- Durable outbound delivery is the primary completion path. Pull reconciliation
  is the recovery path.
- No scheduler or historical replay is enabled until authentication, cost caps,
  restart recovery, and operator cost approval pass.

## Project Ownership Map

| Project | Work now | Work later | Explicitly not owned |
|---|---|---|---|
| `youtube2text` / Media2Text | Safety, application login, cost controls, deployment automation, provenance, Transcript Store, fixture/export, protocol status producer, versioned contracts | Plaud intake adapter, durable completion outbox, YouTube backfill | Embeddings, semantic search, Cortex ingestion truth |
| `home-infra` | Correct Media2Text catalog identity and current auth policy | Register Media2Text/Cortex project contracts only after status producers are live | Running project syncs or moving media bytes |
| `home-infra-protocol` | No change required | Consider upstream-watch vocabulary only after adopter evidence exists | Product-specific media event schemas |
| `infra-portal` | No code change required | Consume future protocol additions after they are released and registered | Replay, backfill, transcription, credential management |
| `plaud-mirror` | No integration work until Media Intake v1 is frozen | Authenticated artifact serving, versioned event, historical replay | Transcription and Cortex ingestion |
| `cortex` | Execute Cortex V1 independently and contain development PostgreSQL | Consume the frozen Transcript Ready contract | Media download and transcription |

## Delivery Sequence

### Stage 0 - Immediate Containment

Owner: Cortex session.

- Bind development PostgreSQL to loopback or a private container network.
- Remove the default-password fallback and rotate the actual database role.
- Verify the old credential fails, the new credential works, health remains
  green, and existing row counts are unchanged.
- Do not implement Media2Text integration in this stage.

Gate: no LAN-visible PostgreSQL listener and no default credential.

### Stage 1 - Home Infra Truth

Owner: Home Infra session.

- Change only the visible catalog name from `youtube2text` to `Media2Text`.
- Keep `id: y2t`, technical image names, hostname, and deployment path.
- Add `project_id: youtube2text`, `state_policy: production_write`, and the
  existing Doppler `prd` secret-source reference.
- Keep `authentication.mode: none` until application login is deployed. Record
  the Home Infra expectation for `application` authentication and any temporary
  waiver only with operator-approved dates and reason.
- Reconcile source version `0.36.11` versus NAS runtime `0.36.8` in private
  deployed-reality documentation without changing the runtime image.
- Do not register a Media2Text project contract or sync job yet. The required
  protocol status endpoints do not exist, so registration would create a
  misleading `never_observed` project.

Gate: catalog audit passes, committed inputs are synced to NAS, live Infra
Portal shows `Media2Text`, and runtime still honestly shows `0.36.8` plus
`authentication.mode: none`.

### Stage 2 - Media2Text Safety Foundation

Owner: this repository.

- Fix the OpenAI Whisper constructor argument bug.
- Make run artifacts run-scoped rather than channel-scoped.
- Fix AssemblyAI abort/retry behavior so polling failures cannot re-upload and
  re-buy work, and so a configured abort actually aborts.
- Fix scheduler fairness before enabling automatic channel work.
- Add application login to the web/BFF boundary. Unauthenticated BFF requests
  must never receive an injected backend API key.
- Add provider-boundary usage accounting and hard limits by item, run, source,
  and rolling period. Preflight estimates and actual usage must share the same
  ledger.
- Separate provider and service credentials between development and production,
  rotate them one at a time, and test before revoking old credentials.
- Add CI for tests, version, naming, and API contract checks.
- Add registry-based NAS deployment automation before repeated canary cycles.
- Pin `yt-dlp` and add dependency/upstream monitoring. Do not model release
  monitoring as a Home Infra `sync_job`.

Gate: negative auth tests, cost-cap tests, provider tests, full repository gates,
and one scripted deployment with rollback evidence.

Progress (2026-07-15): release `0.37.3` completes and deploys the safety
foundation: the `0.36.12` correctness/authentication work plus a
persistent provider-boundary usage ledger, hard economic limits, plan-time
cost estimates, live cost metrics, CI, registry deployment/rollback assets, a
pinned yt-dlp stable release, and a separate weekly upstream watch. The
credential verification, scripted NAS deployment, rollback evidence, and Home
Infra/Portal reconciliation. The scheduler remains disabled as required.

### Stage 3 - Media Contracts v1

Owner: this repository.

- Record the Media2Text/Cortex responsibility boundary and guaranteed
  per-item-notification requirement in the next free decision entry.
- Add immutable provenance to every new transcript and preserve all existing
  transcript artifacts.
- Define Transcript Store v1 and produce one byte-stable real fixture/export
  for Cortex without creating a live dependency on Cortex.
- Freeze Transcript Ready v1 after Cortex consumer review.
- Freeze a versioned Media Intake v1 schema before producer implementation.
- Define stable source item identity, artifact revision/hash, event identity,
  idempotency key, correlation identifiers, and error semantics.
- Add bounded SQLite state only for new job semantics: intake jobs, leases,
  attempts, idempotency, and durable outbox. Do not migrate unrelated JSON
  stores merely for consistency.
- Persist the obligation before returning `202`; fetch bytes asynchronously.
- Make `/v1/intakes` the canonical media admission resource. Keep legacy
  `/audio` and audio-backed `/runs` as compatibility adapters into the same
  service. Keep run/batch control separate where it is a genuinely different
  resource.
- Publish sanitized Home Infra status snapshots for the implemented source
  lanes.

Gate: duplicate-delivery tests, crash/restart tests at every job stage, artifact
integrity verification, and protocol snapshot schema validation.

Progress (2026-07-17): `0.38.0` is deployed and implements immutable Transcript
Store v1, provenance and exact-byte pull endpoints; persistent intake, lease,
attempt, idempotency, and outbox state; least-privilege intake authentication;
cross-host size/hash verification; legacy audio compatibility adapters; and a
sanitized status producer. Duplicate, lease recovery, integrity, auth-scope,
exact-byte, legacy adapter, and HMAC delivery tests pass. Media Intake v1 and
Transcript Ready v1 are intentionally still `draft-consumer-review-required`:
Plaud Mirror and Cortex must review them before an operator-ratified frozen SHA
can be claimed. A real byte-stable fixture can only be exported after the first
new `0.38.x` transcript exists; the export command and integrity guard are in
place and must not be satisfied with a synthetic artifact.
Patch `0.38.1` adds the project-owned Home Infra Protocol 0.9.0 contract and a
canonical-host public status route so Home Infra can register the deployed job
without embedding a private API address in the public project contract.

Progress (2026-07-17, Cortex re-review): source `0.40.0` adds Transcript Store
v2, preserves source recording time and exact provenance, removes the 500-row
pull ceiling with opaque cursors, defines retranscription/source-revision/
tombstone projections, and adds scoped Cortex read auth plus HMAC rotation
semantics. Transcript Ready v1 and Store v2 remain revised drafts; live delivery
and deployment are still gated on Cortex acceptance and frozen hashes.
Patch `0.38.2` publishes the exact Cortex evidence fixture. Source release
`0.39.0` implements the producer-reviewed, commit-pinned Plaud Mirror
compatibility profile; NAS deployment and live verification remain the current
gate.

### Stage 4 - Plaud Mirror Adapter

Owners: Plaud Mirror and Media2Text.

- Plaud Mirror `0.14.1` publishes the Transcription Intake v1 Compatibility
  Profile, three-credential boundary, durable delivery, authenticated artifact
  serving, capabilities, status receiver, cost guard, and executable provider
  probe at commit `d393a0c`.
- Media2Text `0.39.0` pins those exact schema bytes and implements an additive
  receiver facade, collection-aware idempotency, artifact bearer fetch,
  producer-scoped pull, and durable monotonic HMAC status callbacks.
- A future neutral Content Intake Protocol is deliberately deferred until a
  successful live canary plus a second structurally distinct processing profile
  supplies evidence for the core/profile split.

Gate: deploy both releases, pass the Plaud provider probe across the public TLS
boundary, and process one operator-approved recording into exactly one immutable
Media2Text transcript while push and pull status agree.

### Stage 5 - Cortex Adapter (Separate Track, Integration Gated)

Owner: the active Cortex session after Transcript Ready v1 is frozen.

- Consume the frozen Transcript Ready contract rather than Media2Text internals.
- Re-review the Media2Text 0.40.0 draft first: Store v2 distinguishes source
  recording time from materialization, pull is cursor-complete, lifecycle is a
  projection with source-owned tombstones, and Cortex receives a read-only
  transcript credential. Do not enable delivery until both sides freeze hashes.
- Require HMAC/authentication and persist inbox/idempotency state before ACK.
- Replace process-local queue and deduplication with durable jobs.
- Keep general-content ingestion separate from MED and multi-principal policy
  work unless the Cortex decisions explicitly join them.
- Publish a sanitized Cortex-from-Media2Text sync status snapshot before Home
  Infra registration.

Gate: receiver restart and duplicate-event tests prove no loss or duplicate
document visibility.

### Stage 6 - Canary And Historical Replay

Owners: Plaud Mirror and Media2Text sessions; Cortex only if Stage 5 is ready.

- Compute total eligible duration, provider rate, retry allowance, and maximum
  possible spend before enqueueing work.
- Require explicit operator approval of that estimate.
- Process one item, then 5, then 25, then bounded batches.
- Start with transcription concurrency 1 and stop automatically on cost,
  authentication, integrity, or repeated-delivery thresholds.
- Reconcile source items, Media2Text jobs, transcript artifacts, outbox state,
  and downstream documents after every batch.

Gate: approved cost envelope and zero unexplained differences across all active
stages.

### Stage 7 - YouTube Channels

Owner: this repository.

- Add the selected channels disabled first.
- Preview catalog coverage, duration, and cost before processing.
- Enable one channel at a time with concurrency 1 and a low `maxNewVideos`.
- Emit one durable completion event per video, not only one terminal event for
  the whole run.
- Enable unattended scheduling only after fairness, budget, and reconciliation
  checks pass.

Gate: two channels incrementally reach the approved coverage target without
budget, auth, or reconciliation alerts.

## Copy/Paste Prompt - Home Infra Session Now

```text
Onboarding first. Work only in ~/src/home-infra and treat its current HEAD,
worktree, docs, and live portal as authoritative. Do not edit youtube2text,
home-infra-protocol, infra-portal, Plaud Mirror, or Cortex.

Goal: make the current Media2Text service identity and authentication policy
truthful without claiming capabilities that are not deployed.

Verify the current y2t catalog record and D-018 in
~/src/youtube2text/docs/llm/DECISIONS.md read-only. Then:
1. Keep service id y2t, y2t.lamanoriega.com, youtube2text image/runtime names,
   and the deployed v0.36.8 image.
2. Change the visible name and description to Media2Text.
3. Add project_id youtube2text, state_policy production_write, and the existing
   Doppler youtube2text/prd secrets_source reference using current Home Infra
   schema conventions.
4. Keep authentication.mode none because application login is not deployed.
   Add an expectation for application auth and a temporary waiver only if the
   operator supplies/approves every required date and reason. Do not invent
   waiver metadata.
5. Reconcile private docs to source v0.36.11 versus NAS runtime v0.36.8.
6. Do not create/register a Media2Text project contract or sync_jobs yet; there
   is no live protocol status endpoint.
7. Run the catalog audit and all required Home Infra validators. Commit and push
   the scoped change, sync committed portal inputs to NAS through the canonical
   script, and verify the live /api/catalog record. Preserve unrelated work.

Report exact source commit, synced marker, live name/project_id/auth mode/image,
and any deferred policy field.
```

## Copy/Paste Message - Active Cortex Session Now

```text
Keep the current Cortex architecture evaluation and all existing uncommitted
work intact. Do not implement Media2Text/Plaud integration yet.

One independent security issue needs immediate containment: the live
development PostgreSQL container has been observed listening beyond loopback
with a default credential. Re-verify first. If still true, bind it to loopback
or a private container network, remove the default-password fallback, rotate
the actual database role through a secret-safe path, and prove the old password
fails while the new password works. Preserve current data and report row counts
before/after. Keep this as a separate scoped commit from the architecture work.

Record only this future dependency: Cortex will later consume a versioned
Transcript Ready contract from Media2Text through a durable authenticated inbox.
Do not freeze that contract in Cortex now.
```

## Copy/Paste Prompt - Future Plaud Mirror Session

Use this only after Media Intake v1 exists at a committed Media2Text SHA.

```text
Onboarding first. Work only in Plaud Mirror and preserve unrelated work. Read
the committed Media Intake v1 contract from the supplied Media2Text SHA; do not
copy an uncommitted or conversational schema.

Implement the Plaud producer adapter: least-privilege authenticated artifact
serving, opaque artifact references, additive versioned recording-ready events,
hash/size/duration integrity fields, and historical replay that enqueues existing
verified local artifacts without re-downloading them. Preserve the existing
durable outbox, HMAC, retry FSM, operator auth, dismissal, and tombstone
semantics. The receiver's 202 means durable obligation only. Do not introduce
shared filesystem or Docker-volume coupling.

Stop after one end-to-end canary and report contract tests, outbox state, byte
integrity, duplicate behavior, and restart recovery. Do not start bulk replay.
```

## Upstream Watch Follow-Up

Media2Text is not a fork and has no source-code upstream remote. Its relevant
upstreams are dependencies such as `yt-dlp`, Node images, npm packages, provider
APIs, and DocKit governance.

The immediate implementation belongs in Media2Text CI: pin versions, use
Dependabot where supported, and publish a project-owned upstream-watch result.
After both Plaud Mirror and Media2Text have proven watchers, file downstream
feedback in Home Infra Protocol. Do not add an `upstream_watch_jobs` field or
Infra Portal code from this roadmap without a separately accepted protocol
change.
