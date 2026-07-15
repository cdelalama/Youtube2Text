<!-- doc-version: 0.38.0 -->
# LLM Work Handoff

This file is the current operational snapshot. Historical detail belongs in
`HISTORY.md`, `HANDOFF_ARCHIVE.md`, `DECISIONS.md`, and the cross-project
roadmap.

- Last Updated: 2026-07-15

## Open work

- Operator issued GO for the complete roadmap in
  `docs/MEDIA_PIPELINE_CROSS_PROJECT_ROADMAP.md`.
- Source release `0.38.0` implements Media Contracts v1 on the Media2Text side:
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

## Current Status

- Version: 0.38.0 in source; publication and NAS deployment pending this session.
- Current NAS runtime before this rollout: `0.37.3`, healthy and authenticated.
- Home Infra/Infra Portal: service identity is `Media2Text`, technical id is
  `y2t`, project id is `youtube2text`, application auth is satisfied, and the
  deployed image is `0.37.3`.
- Scheduler remains OFF. No YouTube channels are configured in the watchlist.
- Production Deepgram and AssemblyAI credentials were verified during the
  `0.37.x` safety rollout. The OpenAI credential returns 401 and remains an
  explicit external rotation gate; Deepgram is the production provider.
- Visible brand: Media2Text. Technical runtime/repo/env contract remains
  `youtube2text` + `Y2T_` per D-018.

## Next Gates

1. Pass tests, builds, OpenAPI/type drift, naming, version sync, DocKit, Docker
   smoke, and status-snapshot validation for `0.38.0`.
2. Commit and push `0.38.0`; require green GitHub CI.
3. Deploy through `scripts/deploy-nas.sh`, retain `0.37.3` for rollback, and
   verify health, auth, usage enforcement, scheduler OFF, status snapshot, and
   Transcript Store API.
4. Register the now-live sanitized media-pipeline status producer in Home Infra
   and sync committed portal inputs to the NAS. Home Infra does not transport
   media or run backfills.
5. Export one real byte-stable `0.38.0` transcript fixture with
   `npm run transcript:export-fixture -- <ignored-output-path>`. Do not satisfy
   this gate with synthetic content.
6. Ask Cortex to review `transcript-ready.v1.schema.json` and Plaud Mirror to
   review `media-intake.v1.schema.json`. Freeze only after consumer review and
   operator ratification.
7. Configure exact YouTube channel URLs disabled first, preview duration/cost,
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
