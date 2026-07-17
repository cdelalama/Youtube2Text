# Media Contracts

## Lifecycle

Contracts move through these states and never skip consumer review:

`draft -> consumer-reviewed -> operator-ratified -> frozen (version + commit SHA) -> implemented -> live-verified -> superseded`

| Contract | Owner | Consumer | State |
|---|---|---|---|
| Transcript Store v1 | Media2Text | Cortex and operator tools | implemented; live verification pending |
| Transcript Ready v1 | Media2Text | Cortex | draft; Cortex review required |
| Media Intake v1 | Media2Text | internal/legacy adapters | implemented internal domain |
| Plaud Mirror Transcription Intake v1 Compatibility Profile | Plaud Mirror | Media2Text | operator-ratified and frozen at producer commit `d393a0c`; implemented; live verification pending |

The JSON Schema files are machine-readable. This document adds transport and
failure semantics that JSON Schema cannot express.

## Intake Semantics

- `POST /v1/intakes` is the canonical network admission resource. It accepts
  the internal `media2text.intake.v1` shape for existing integrations and the
  external `transcription.intake.v1` shape for a configured producer profile.
- The producer authenticates with a least-privilege
  `X-Media2Text-Intake-Key`; that credential cannot read transcripts or mutate
  settings.
- A Plaud-compatible producer authenticates with its profile-specific bearer.
  That bearer can read capabilities, admit work, and pull only its own intake
  status. Its separate artifact bearer is sent only to approved artifact
  origins; its separate HMAC secret signs callbacks only to approved callback
  origins.
- Media2Text returns `202` only after SQLite commits the request and its
  idempotency identity. It has not downloaded or transcribed the artifact yet.
- Repeating an identical request returns the same intake with
  `deduplicated: true`. Reusing an idempotency key or artifact revision with a
  different request returns `409 idempotency_conflict`.
- Artifact URLs must cross an authenticated network boundary and match an
  operator-controlled exact-origin allowlist. Local paths and shared volumes
  are forbidden contract fields.
- Media2Text verifies declared byte length and SHA-256 before transcription.

The frozen Plaud schema bytes and pin metadata live in
`plaud-mirror-transcription-intake-v1/`. They are producer-owned compatibility
artifacts, not a neutral universal standard. D-021 defines the evidence gate
for a future neutral Content Intake extraction.

## Completion Semantics

- Every completed Transcript Store record creates one deterministic durable
  `transcript.ready` outbox row before the pipeline emits `video:done`.
- Delivery is at-least-once, signed with HMAC-SHA256 over
  `${timestamp}.${canonicalBody}` and uses a fixed operator-configured target.
- Cortex must persist inbox/idempotency state before acknowledging the event.
- `GET /v1/transcripts` and `GET /v1/transcripts/{transcriptId}` are the pull
  reconciliation path. Pull is recovery, not the primary completion path.
- A missing target URL does not discard events. Rows remain pending until the
  contract is frozen and the target is configured.

## Error Semantics

Intake status is one of `held` (legacy upload awaiting an explicit run),
`accepted`, `fetching`, `ready`, `running`, `completed`, or `failed`. Permanent
origin, size, hash, and schema failures do
not retry. Network, timeout, 408, 429, and 5xx fetch failures retry within a
bounded attempt count. Provider failures end the intake as `failed`; an
operator must explicitly replay them because retrying may spend money.

Outbox status is one of `pending`, `delivering`, `delivered`, or `dead`.
Timeout, 408, 429, and 5xx responses retry with bounded exponential backoff.
Other 4xx responses and exhausted attempts become `dead` and appear as a
degraded Home Infra status check.

Plaud-compatible producer callbacks additionally expose `accepted`,
`processing`, `transcribed`, and `failed`. Media2Text persists those status
events in sequence before delivery, signs `${timestamp}.${canonicalBody}` with
the profile HMAC secret, and supports authenticated pull reconciliation at
`GET /v1/intakes/{intakeId}`.

Terminal intake and outbox coordination rows have a time-bounded retention
window (365 days by default). This bounds SQLite growth and defines the durable
idempotency horizon. Transcript Store records and legacy presentation artifacts
are not deleted by coordination-state retention.
