<!-- doc-version: 0.38.2 -->
# LLM Work Handoff

This file is the current operational snapshot. Historical detail belongs in
`HISTORY.md`, `HANDOFF_ARCHIVE.md`, `DECISIONS.md`, and the cross-project
roadmap.

- Last Updated: 2026-07-15

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
- `Media Intake v1` and `Transcript Ready v1` remain
  `draft-consumer-review-required`. Do not configure live Plaud or Cortex
  delivery until their owning sessions review the schemas and the operator
  freezes a version plus commit SHA.
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

## Current Status

- Version: 0.38.2 in source. This fixture/validation patch does not require a
  NAS deployment.
- Current NAS runtime: `0.38.1`, healthy and authenticated. Media pipeline
  status is `ok`; Transcript Store contains no new 0.38.x records.
- Home Infra/Infra Portal: service identity is `Media2Text`, technical id is
  `y2t`, project id is `youtube2text`, application auth is satisfied, and the
  deployed image is `0.38.1`. Its project contract and sanitized pipeline job
  are registered and observed without warnings.
- Scheduler remains OFF. No YouTube channels are configured in the watchlist.
- Production Deepgram and AssemblyAI credentials were verified during the
  `0.37.x` safety rollout. The OpenAI credential returns 401 and remains an
  explicit external rotation gate; Deepgram is the production provider.
- Visible brand: Media2Text. Technical runtime/repo/env contract remains
  `youtube2text` + `Y2T_` per D-018.

## Next Gates

1. Give Cortex commit-pinned access to the 0.38.2 fixture and manifest so its
   Slice 2 can test exact bytes and honest unknown legacy provenance. The
   evidence fixture does not authorize live integration.
2. Export the first new byte-stable 0.38.x Transcript Store fixture when a real
   new transcript exists; do not replace that native-provenance gate with the
   legacy Cortex evidence sample.
3. Ask Cortex to review `transcript-ready.v1.schema.json` and Plaud Mirror to
   review `media-intake.v1.schema.json`. Freeze only after consumer review and
   operator ratification.
4. Configure exact YouTube channel URLs disabled first, preview duration/cost,
   obtain operator cost approval, then canary at concurrency 1. Exact channel
   URLs are not yet available in this repository.

## Do Not Touch

- Do not edit Cortex, Plaud Mirror, Home Infra Protocol, or Infra Portal from
  this repository/session.
- Do not globally rename `youtube2text` to `media2text` or introduce
  `MEDIA2TEXT_`/`M2T_` env prefixes.
- Do not rename Docker images, Doppler project/config, NAS paths,
  `y2t.lamanoriega.com`, or root package without a separate approved migration.
- Do not delete or rewrite existing transcript artifacts. Coordination-state
  retention never deletes Transcript Store or legacy presentation files.
- Do not enable scheduler, historical replay, intake producer traffic, or
  Cortex delivery before the applicable contract/cost gates pass.
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
