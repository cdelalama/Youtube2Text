<!-- doc-version: 0.40.1 -->
# LLM Work Handoff

This file is the current operational snapshot. Historical detail belongs in
`HISTORY.md`, `HANDOFF_ARCHIVE.md`, `DECISIONS.md`, and the cross-project
roadmap.

- Last Updated: 2026-07-18

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
  boundary. The corrected Transcript Ready v1 candidate in 0.40.1 awaits a
  replacement Cortex commit/hash pin before live use.
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
- The current Plaud backlog estimate is 622 recordings, 608.0074 hours, and
  USD 335.62 at the configured Deepgram rate.
  This exceeds Media2Text's 30-day hard limits and requires a separate operator
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
  Transcript Ready v1 and Store v2 remain drafts pending Cortex re-review. The
  source-lifecycle inbound wire contract is explicitly not implemented, Cortex
  delivery remains unset, and no Plaud backlog item was replayed.
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
2. Bulk replay remains blocked until the 622-item / 608.0074-hour / estimated
   USD 335.62 envelope receives separate operator spend approval; use bounded
   batches of 1, 5, and 25 after approval and respect the live hard caps.
3. ~~Reconcile deployed Media2Text/Plaud versions, truthful degraded state,
   route provenance, and source commits through Home Infra/Infra Portal.~~ Done
   through synchronized Home Infra 0.7.6 and Portal 0.20.3.
4. Send the committed 0.40.1 contract hashes and producer SHA to Cortex for a
   bounded re-review that replaces the historical 0.40.0 pin at `ace98a4`.
   Keep live delivery disabled until Cortex accepts and publishes its new pin.
5. Configure exact YouTube channel URLs disabled first, preview duration/cost,
   obtain operator cost approval, then canary at concurrency 1.

## Do Not Touch

- Cross-repo edits require explicit operator scope. This session is
  Media2Text-only; Cortex, Plaud Mirror, Home Infra, and Protocol remain untouched.
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
