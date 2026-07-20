<!-- doc-version: 0.40.1 -->
# LLM Work Handoff

This file is the current operational snapshot. Historical detail belongs in
`HISTORY.md`, `HANDOFF_ARCHIVE.md`, `DECISIONS.md`, and the cross-project
roadmap.

- Last Updated: 2026-07-20

## Connections Program Ratification - 2026-07-20

- D-024 records the receiver-owned half of the operator-ratified bilateral
  connection model. The Plaud content wire contract remains frozen and Cortex
  remains a separate downstream hop.
- Media2Text's first real provisioning slice must replace environment-as-live-
  authority with an encrypted mutable runtime profile store and authenticated
  admin API/UI. `Y2T_TRANSCRIPTION_INTAKE_PROFILES_JSON` becomes a seed used
  only when that store is empty. A Doppler-writing CLI is not the primary UX.
- V1 uses a Plaud request bundle carrying the artifact bearer and a Media2Text
  grant bundle carrying the intake bearer plus status HMAC secret. Both are
  sensitive. Import enforces expiry, consumed-id rejection, request binding,
  and exact contract hashes. Operator custody is the V1 trust bootstrap; no
  signing PKI or false offline single-use guarantee is claimed.
- An honest `0.41.x` runtime-store/admin slice and `0.42.x` bundle slice are
  pre-authorized as a roadmap split, not as implementation or deployment GO.
- Plaud Mirror's `docs/design/CONNECTIONS_OPERATOR_EXPERIENCE.md` is the
  canonical full brief. This repo owns D-024 and its roadmap consequences rather
  than copying that document. Home Infra stays observation-only and ForgeOS
  may discover the owning artifacts.
- Wave 1 changed documentation only. NAS remains 0.39.3; source remains 0.40.1;
  no profile, secret, provider call, Cortex delivery, replay, scheduler, or
  deployment was changed.

## Final-Freeze Reconciliation - 2026-07-20

- Media2Text `0.40.1` producer acknowledgement commit
  `b90ebf74dad9e07e8a7727946cdf4d3da5da8016` is clean, published, and preserves
  all five operator-ratified contract artifacts byte-for-byte.
- Cortex commit `6aa96e53fa857e629c679c9d9db9860ae1e92df5` (`Freeze ratified
  Media2Text 0.40.1 pin`) is clean and published. Cortex durably records the
  exact pin as consumer-accepted, operator-ratified, producer-acknowledged, and
  final-frozen.
- This closes the horizontal final-freeze gate and supersedes the pending
  dispatch instructions in the dated 2026-07-19 Ratification Checkpoint and
  2026-07-18 Restart Checkpoint below. Preserve those checkpoints as execution
  history; do not send the acknowledgement prompt to Cortex again.
- Final freeze is not runtime authority. Media2Text remains deployed at 0.39.3,
  and Cortex delivery, deployment of 0.40.1, credentials, pending obligations,
  source-data processing, replay/backfill, provider spend, scheduler activation,
  and Plaud source-lifecycle changes remain disabled or separately gated.
- The next product-facing program is the now-ratified connections roadmap. Only
  its documentation baseline is authorized; runtime implementation retains a
  separate gate and must not present disabled behavior as live or change the
  frozen wire contract implicitly.

## Ratification Checkpoint - 2026-07-19

- The operator ratified the exact Transcript Ready v1 replacement pin produced
  by Media2Text `0.40.1` commit
  `fa20597200a82056da2dfd113216146d74f4a5c1` and independently ACCEPTED by
  Cortex consumer commit `73a3d11fa5a6046d97b3f09e54202016f9816c46`.
- The ratified five-artifact set is:
  - `docs/contracts/README.md`: `58b5ee254c9757e2f115a46df8e10eedb9384f537952130e11ab0a2842914076`
  - `docs/contracts/transcript-store.v1.schema.json`: `225fd511e2b1aa2abf7437bbd98bdb73f305aa84d25bdf6469889ff9774fd52d`
  - `docs/contracts/transcript-store.v2.schema.json`: `303e31cc279182b91564ba1528410457725556b538b32670304f83553523e543`
  - `docs/contracts/transcript-ready.v1.schema.json`: `2112c0e24573fcb0b03385793921e8698aa6ce0d07a462a26b1e7cbd10c75021`
  - `openapi.yaml`: `07f553ba6874172899bf8ebfc761c69553c8161a3284ed4d19eb33b93dd2f279`
- Read-only verification proved that current Media2Text HEAD preserves all five
  files byte-for-byte from `fa205972`; the working-tree SHA-256 values match the
  ratified set. Cortex independently passed the producer's focused 4/4 tests
  and a 24-case matrix in which only the two coherent event variants validate.
- This documentation slice is Media2Text's durable acknowledgement. Return its
  published commit to Cortex so Cortex can mark the pin operator-ratified and
  final-frozen in its own durable record.
- Ratification is not runtime authority. Do not deploy 0.40.1, configure
  `Y2T_TRANSCRIPT_READY_URL` or credentials, deliver pending obligations,
  process source data, replay/backfill, incur provider spend, or change the
  Plaud-to-Media2Text source-lifecycle contract under this acknowledgement.
- Known frozen-document debt: `docs/contracts/README.md` still describes the
  Plaud compatibility profile's live verification as pending. Preserve those
  ratified bytes; correct the prose only in a future contract version followed
  by a new consumer review and pin.

## Restart Checkpoint - 2026-07-18

- Safe source checkpoint: `main` and `origin/main` were clean and equal at
  `fa20597200a82056da2dfd113216146d74f4a5c1`, Media2Text `0.40.1`, immediately
  before the operator's planned machine shutdown.
- Runtime was deliberately not changed: NAS remains on `0.39.3` from `3cf1539`.
  Cortex delivery URL/credentials, scheduler, Plaud replay, pending-event
  emission, and provider spend remain disabled or unapproved.
- Horizontal gate: Cortex commit `ace98a4` is historical acceptance evidence
  for 0.40.0 only. Cortex must re-review 0.40.1 and publish a replacement
  consumer pin before this contract can be used live. Cortex Slice 4 may proceed
  independently; no Media2Text action depends on it.
- Latest sanitized live observation at `2026-07-18T13:21:02.691Z` remained
  truthful `degraded/warning`: 3 intake jobs require review, 0 Transcript Ready
  deliveries completed / 4 pending, and 21 source-status deliveries completed /
  0 pending.
- Resume sequence: read the mandatory onboarding chain, run `git fetch origin`,
  verify `HEAD == origin/main` and a clean worktree, then inspect Cortex's
  re-review response. If Cortex accepts, record its exact consumer SHA and pin;
  otherwise address only its concrete contract findings. Do not deploy or
  activate delivery as part of the pin-recording step.
- Frozen 0.40.1 review inputs:
  - `docs/contracts/README.md`: `58b5ee254c9757e2f115a46df8e10eedb9384f537952130e11ab0a2842914076`
  - `docs/contracts/transcript-store.v1.schema.json`: `225fd511e2b1aa2abf7437bbd98bdb73f305aa84d25bdf6469889ff9774fd52d`
  - `docs/contracts/transcript-store.v2.schema.json`: `303e31cc279182b91564ba1528410457725556b538b32670304f83553523e543`
  - `docs/contracts/transcript-ready.v1.schema.json`: `2112c0e24573fcb0b03385793921e8698aa6ce0d07a462a26b1e7cbd10c75021`
  - `openapi.yaml`: `07f553ba6874172899bf8ebfc761c69553c8161a3284ed4d19eb33b93dd2f279`

## Open work

- Operator issued GO for the complete roadmap in
  `docs/MEDIA_PIPELINE_CROSS_PROJECT_ROADMAP.md`.
- Release `0.38.0` introduced Media Contracts v1 on the Media2Text side:
  immutable Transcript Store records and representation snapshots, exact-byte
  integrity endpoints, provenance, bounded SQLite intake/lease/idempotency and
  outbox state, least-privilege intake auth, verified cross-host artifact
  fetch, legacy audio compatibility adapters, per-item HMAC delivery, and a
  sanitized Home Infra status producer.
- D-020 is the responsibility boundary: sources own original media;
  Media2Text owns intake/transcription/materialization/delivery obligations;
  Cortex owns semantic ingestion and retrieval.
- Internal `Media Intake v1` is implemented. Plaud Mirror's external
  Transcription Intake v1 Compatibility Profile is operator-ratified, copied
  byte-for-byte, and pinned to producer `0.14.1` commit
  `d393a0cefa17dfc4788294ef9bb5e5a89ed0f6b4`; D-021 records the adapter
  boundary. Transcript Ready v1 at Media2Text `fa205972` has Cortex consumer
  ACCEPT at `73a3d11`, exact operator ratification, Media2Text acknowledgement
  at `b90ebf7`, and Cortex final-freeze at `6aa96e5`. Separately authorized live
  use remains pending.
- The outbox persists every new item even when
  `Y2T_TRANSCRIPT_READY_URL` is unset. Pull reconciliation is available at
  `/v1/transcripts`.
- Patch `0.38.1` adds the project-owned Home Infra Protocol 0.9.0 contract and
  the canonical-host public status route required for truthful Portal
  registration.
- Patch `0.38.2` commits one byte-for-byte real legacy JSONL fixture for Cortex
  V1 at `fixtures/cortex-v1/ngAasdHcHxo/`. Its manifest records only provenance
  demonstrated by the existing sidecar, canonical response, run, and events;
  provider, engine, model version, and producer commit remain null with reasons.
  The fixture is offline evidence only and does not implement or activate live
  delivery, a Cortex webhook, or a frozen Transcript Ready contract.
- 2026-07-16 audit APPROVED commit `c982ced` (0.38.2): fixture bytes verified
  SHA-identical to the still-existing on-disk source artifact, manifest unknowns
  honest, validation genuine and CI-wired, scope confined to this repo.
  Observation (non-blocking): the canonical response contains AssemblyAI-specific
  keys, so provider is inferable; a `providerInferredFrom` note would help Cortex.
- The 2026-07-16 advisory phrase "ratified receiver-owned wire contract" was
  not an operator decision and is superseded. The operator subsequently
  authorized the producer compatibility profile and cross-repo execution.
- Release `0.39.0` implements the additive Plaud facade: producer-scoped bearer
  auth, collection-aware identity, separate artifact bearer fetch, durable
  monotonic HMAC status callbacks, pull reconciliation, and a contract hash
  pin. It does not enable Cortex delivery or bulk replay.
- The first production Plaud intake proved durable admission and exact
  authenticated artifact transfer, then failed before the provider call. The
  canary found two Media2Text defects: FFmpeg tools were probed with
  `--version` instead of `-version`, and status signatures included the
  transcript-store JSONL newline even though the wire contract requires compact
  JSON. Patch `0.39.1` fixes both and adds regression coverage. Deepgram was not
  called and the failed canary incurred no provider cost.
- Media2Text `0.39.1` and Plaud Mirror `0.14.2` now complete a real MP3 canary
  end to end. Intake `int_ead2ce026db741f6ed92c567ce6921d7fb9ed00be1a6ce529334d31e92ce9a91`
  produced transcript
  `trn_2f8ade4348ff1d915d302ccde5347d7ca8ceaaece28ec7bed4863301fbb3d5b7`;
  Plaud persists the distinct source and transcript-record SHA-256 values and
  released its pinned source lease after the terminal callback was replayed.
- A separate OGG canary reached Deepgram but was rejected because the Plaud
  container included an additional private stream. Patch `0.39.2` maps only
  the first audio stream into a deterministic provider-only MP3 derivative,
  preserves the hash-verified source bytes, and fails before provider execution
  if normalization cannot complete.
- The first `0.39.2` normalized OGG canary completed transcription as intake
  `int_8598602b836995413d2f70654d9401eecce6785fe3628d6fd003fa5609e2bd31`,
  but verification found that Transcript Store recorded the derivative MP3
  hash as the source revision instead of Plaud's admitted OGG hash. Patch
  `0.39.3` separates provider audio from the admitted source artifact, re-hashes
  and fail-closes against the admitted revision, and records the original MIME
  type/duration. The immutable `0.39.2` canary record is retained as evidence
  and must not be presented as correct provenance.
- Patch `0.39.3` is deployed from `3cf1539`. A new real OGG canary completed as
  Plaud recording `082298d30b32dfcfaa3fab312d9a36b7`,
  intake `int_9a0a5b350c75e276d92eb7f464d7844dc5ede57d4daf0a60e77ba99211f25226`
  and transcript
  `trn_02c5b5125b083ddcd0c08988dba7a377a90b07fbcd9a37822ea7deb3c40fe457`.
  Run `34db3827-83da-4e6b-9988-be74acf2008b` preserved the 32,768-byte,
  seven-second source MIME `audio/ogg` and source SHA-256
  `0f52872594aa61a3c4b522ad245d100ec7f95231750cdd98d9aa740bd8a778a9`,
  and distinct transcript-record SHA-256
  `d032644835480bfe174cd56940d3060341b91a269eca29a00fbd3849c087ec99`.
  Plaud received terminal status and released the source lease. The immutable
  provenance-incorrect 0.39.2 record remains retained as explicit audit
  evidence and is not presented as correct.
- The current Plaud backlog scope is 622 recordings and 608.0074 hours. USD
  335.62 is Plaud's local estimate using its configured Deepgram rate as of
  2026-07-18, not a Media2Text quote. This exceeds Media2Text's 30-day hard
  limits and requires a fresh receiver quotation plus a separate operator
  spend decision before bulk replay.
- 2026-07-17 audit APPROVED the b423d21..9d234fa slice: contract pin verified
  byte-for-byte against plaud-mirror `d393a0ce` (five schema SHA-256 matches),
  203/203 tests and all validators reproduced green, defect fixes confirmed in
  code, sibling repo states and catalog image 0.39.3 confirmed, live public
  status truthful. Observation: live counts have moved past the recorded
  evidence (3 intake jobs in review and 4 pending transcript obligations vs the
  documented 2 and 3) — post-deploy live Plaud activity; the next session should
  identify the third failed intake before treating retained failures as fully
  documented.
- Release `0.40.0` addresses Cortex's REQUEST CHANGES without enabling delivery:
  Plaud `createdAt` now reaches provenance-complete Transcript Store v2 records;
  v1 bytes remain untouched; SQLite projects retranscription/source revision,
  current/superseded/withdrawn state; pull reconciliation follows opaque cursors
  beyond 500; Cortex has a two-route read-only bearer; and HMAC delivery names
  its key id with a 300-second replay window and active/previous rotation rules.
  At that release point, Transcript Ready v1 and Store v2 remained drafts
  pending Cortex re-review. The source-lifecycle inbound wire contract is
  explicitly not implemented, Cortex delivery remains unset, and no Plaud
  backlog item was replayed.
- 2026-07-18 audit APPROVED commit `7cd5fe7` (0.40.0): all five published
  contract hashes recomputed identical, 208/208 tests reproduced, Cortex read
  key verified scoped to exactly the two GET transcript routes with timing-safe
  comparison and forced distinctness from operator/intake keys, outbox migration
  proven data-preserving by a real old-schema test, withdrawal verified
  source-event-keyed with no inbound HTTP route (correctly deferred), v1 schema
  change is metadata-only (`implemented-legacy`), CI green, NAS untouched at
  0.39.3. Not reproduced locally: Docker smoke. At audit time the live third
  failed intake from 2026-07-17 remained unidentified.
- Cortex accepted and pinned 0.40.0 at consumer commit `ace98a4`, then its
  post-ratification adversarial review found that the Transcript Ready schema
  allowed event/lifecycle contradictions that the producer does not emit.
  Patch `0.40.1` makes `transcript.ready` exclusively `current/true` without
  `sourceLifecycle`, makes `transcript.withdrawn` exclusively
  `withdrawn/false` with `sourceLifecycle` required, and proves crossed variants
  fail actual Draft 2020-12 validation. Mutable review/freeze state now lives in
  external producer/consumer commit and hash pins rather than schema bytes.
  The 0.40.0 consumer pin remains historical evidence and must be replaced
  before live use. Delivery, deployment, replay, and spend remain untouched.
  Validation: 210/210 tests, focused post-Ajv-update contract tests 4/4, TypeScript
  and Next.js production builds, OpenAPI lint/type regeneration without drift,
  Docker smoke, Cortex fixture integrity, version/naming sync, DocKit 10/10,
  diff check, and npm audit with zero vulnerabilities.

## Current Status

- Version: 0.40.1 in source; NAS remains on 0.39.3 from `3cf1539`. The contract
  correction is not deployed and has not activated Cortex delivery.
- Transcript Ready v1 is operator-ratified at the exact Media2Text `fa205972`
  five-artifact pin after Cortex consumer ACCEPT `73a3d11`. Media2Text recorded
  producer acknowledgement at `b90ebf7`, and Cortex recorded the pin
  final-frozen at `6aa96e5`. No runtime authority follows.
- Current NAS runtime: `0.39.3`, healthy and authenticated. The Plaud facade is
  reachable only on its three exact TLS machine routes; generic operator paths
  remain behind the web session boundary.
- Home Infra/Infra Portal: service identity is `Media2Text`, technical id is
  `y2t`, project id is `youtube2text`, and the catalog reports image 0.39.3
  with application auth satisfied. Home Infra 0.7.6
  release `bb350ea` is synchronized; Infra Portal 0.20.3 mounts exact source
  commits with no provenance warnings. Its project contract and sanitized
  pipeline job remain registered.
- Live pipeline status remains truthfully `degraded/warning`: the latest audit
  observed three failed intake jobs retained for review and four Transcript
  Ready obligations pending because Cortex delivery is intentionally disabled.
  A subsequent cross-project review identified the set as two retained
  historical canaries plus the 211.51-minute item blocked by the 180-minute
  economic policy; the policy block did not invoke the provider. Do not reuse
  the older 2/3 counts as current truth.
- Scheduler remains OFF. No YouTube channels are configured in the watchlist.
- Production Deepgram and AssemblyAI credentials were verified during the
  `0.37.x` safety rollout. The OpenAI credential returns 401 and remains an
  explicit external rotation gate; Deepgram is the production provider.
- Visible brand: Media2Text. Technical runtime/repo/env contract remains
  `youtube2text` + `Y2T_` per D-018.

## Next Gates

1. ~~Publish/deploy `0.39.3` and prove one provenance-correct OGG canary.~~ Done
   2026-07-17; source, provider derivative, transcript, callback, pull, and lease
   boundaries pass.
2. Bulk replay remains blocked for 622 items / 608.0074 hours. USD 335.62 is a
   Plaud-local estimate using its configured Deepgram rate as of 2026-07-18,
   not a Media2Text quotation. Produce a fresh receiver-owned quote before
   separate operator spend approval; then use bounded batches of 1, 5, and 25
   and respect live hard caps.
3. ~~Reconcile deployed Media2Text/Plaud versions, truthful degraded state,
   route provenance, and source commits through Home Infra/Infra Portal.~~ Done
   through synchronized Home Infra 0.7.6 and Portal 0.20.3.
4. ~~Send the committed 0.40.1 contract hashes and producer SHA to Cortex for a
   bounded re-review that replaces the historical 0.40.0 pin at `ace98a4`.~~
   Done: Cortex consumer ACCEPT is `73a3d11`, the operator ratified the exact
   pin, Media2Text published acknowledgement `b90ebf7`, and Cortex recorded the
   final freeze at `6aa96e5`. Do not dispatch this gate again; keep live delivery
   disabled pending separate authority.
5. Request separate authority for the D-024 runtime-profile/bundle design and
   implementation. Do not start `0.41.x`/`0.42.x` from this handoff alone.
6. Configure exact YouTube channel URLs disabled first, preview duration/cost,
   obtain operator cost approval, then canary at concurrency 1.

## Do Not Touch

- Cross-repo edits require explicit operator scope. The 2026-07-20 Wave 1
  documentation session had that scope; future implementation sessions return
  to repo-local ownership unless the operator explicitly broadens them.
- Do not globally rename `youtube2text` to `media2text` or introduce
  `MEDIA2TEXT_`/`M2T_` env prefixes.
- Do not rename Docker images, Doppler project/config, NAS paths,
  `y2t.lamanoriega.com`, or root package without a separate approved migration.
- Do not delete or rewrite existing transcript artifacts. Coordination-state
  retention never deletes Transcript Store or legacy presentation files.
- Do not enable scheduler, bulk historical replay, or Cortex delivery before
  the applicable contract and cost gates pass. The authorized Plaud canary is
  complete; further replay is a separate spend decision.
- Keep `.dockit-config.yml` `history_format: no-dash` and the D-018 naming check.

## Validation

```bash
npm test
npm run transcript:fixture:check
npm run build
npm run build:web
npm run api:contract:check
npm run version:check
npm run naming:check
scripts/check-version-sync.sh
scripts/dockit-validate-session.sh --human
npm run test:docker-smoke
```

Deployment must use `scripts/deploy-nas.sh`; direct NAS Compose invocation is
not the canonical path. Private host, credential, and rollback details remain
in Home Infra documentation.
