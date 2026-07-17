<!-- doc-version: 0.39.2 -->
# LLM Work Handoff

This file is the current operational snapshot. Historical detail belongs in
`HISTORY.md`, `HANDOFF_ARCHIVE.md`, `DECISIONS.md`, and the cross-project
roadmap.

- Last Updated: 2026-07-17

## Open work

- Operator issued GO for the complete roadmap in
  `docs/MEDIA_PIPELINE_CROSS_PROJECT_ROADMAP.md`.
- Deployed release `0.38.0` implements Media Contracts v1 on the Media2Text side:
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
  boundary. Transcript Ready v1 remains draft pending Cortex review.
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
- The current Plaud backlog estimate before the OGG follow-up canary is 624
  recordings, 608.0113 hours, and USD 335.62 at the configured Deepgram rate.
  This exceeds Media2Text's 30-day hard limits and requires a separate operator
  spend decision before bulk replay.

## Current Status

- Version: 0.39.2 in source; patch validation and coordinated deployment are
  active.
- Current NAS runtime: `0.39.1`, healthy and authenticated. The Plaud facade is
  reachable only on its three exact TLS machine routes; generic operator paths
  remain behind the web session boundary.
- Home Infra/Infra Portal: service identity is `Media2Text`, technical id is
  `y2t`, project id is `youtube2text`, application auth is satisfied, and the
  catalog still reports the prior deployed version until the final coordinated
  reconciliation. Its project contract and sanitized pipeline job remain
  registered.
- Scheduler remains OFF. No YouTube channels are configured in the watchlist.
- Production Deepgram and AssemblyAI credentials were verified during the
  `0.37.x` safety rollout. The OpenAI credential returns 401 and remains an
  explicit external rotation gate; Deepgram is the production provider.
- Visible brand: Media2Text. Technical runtime/repo/env contract remains
  `youtube2text` + `Y2T_` per D-018.

## Next Gates

1. Publish and deploy `0.39.2`, then run one short OGG canary to verify the
   provider derivative, successful transcription, signed terminal state, pull
   reconciliation, distinct hashes, and source lease release.
2. Recalculate the remaining eligible Plaud backlog after the OGG canary.
   Bulk replay remains blocked until the USD 335.62-class estimate receives a
   separate operator spend approval; use batches of 1, 5, and 25 after approval.
3. Reconcile the deployed Media2Text/Plaud versions, truthful degraded state,
   route provenance, and source commits through Home Infra and Infra Portal.
4. Keep Cortex live delivery disabled until Cortex reviews and freezes
   Transcript Ready v1. The committed 0.38.2 fixture remains its current input.
5. Configure exact YouTube channel URLs disabled first, preview duration/cost,
   obtain operator cost approval, then canary at concurrency 1.

## Do Not Touch

- Cross-repo edits require explicit operator scope. This session has that scope
  only for Plaud Mirror and Home Infra coordination; Cortex and Home Infra
  Protocol remain untouched.
- Do not globally rename `youtube2text` to `media2text` or introduce
  `MEDIA2TEXT_`/`M2T_` env prefixes.
- Do not rename Docker images, Doppler project/config, NAS paths,
  `y2t.lamanoriega.com`, or root package without a separate approved migration.
- Do not delete or rewrite existing transcript artifacts. Coordination-state
  retention never deletes Transcript Store or legacy presentation files.
- Do not enable scheduler, bulk historical replay, or Cortex delivery before
  the applicable contract and cost gates pass. One bounded Plaud canary is
  authorized after deployment and conformance checks.
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
