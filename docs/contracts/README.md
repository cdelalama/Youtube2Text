# Media Contracts

## Lifecycle

Contracts move through these states and never skip consumer review:

`draft -> consumer-reviewed -> operator-ratified -> frozen (version + commit SHA) -> implemented -> live-verified -> superseded`

| Contract | Owner | Consumer | State |
|---|---|---|---|
| Transcript Store v1 | Media2Text | Cortex and operator tools | implemented legacy; immutable records remain readable |
| Transcript Store v2 | Media2Text | Cortex and operator tools | draft implemented producer side; Cortex re-review required |
| Transcript Ready v1 | Media2Text | Cortex | revised draft; Cortex re-review required |
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
- New records use `media2text.transcript.v2`. Existing v1 records remain
  byte-identical and retrievable; Media2Text never invents missing provenance
  while projecting them into the list feed.
- `materializedAt` is Media2Text processing time. `source.createdAt` is the
  original typed source time. For Plaud it is the exact producer-supplied
  recording `createdAt`, tagged `recorded`; it is never replaced by
  `materializedAt`. A missing source time is `null` with an explicit reason.
- Provider, configured model name, provider-reported model version and evidence
  path, run id, source artifact revision/hash/bytes/MIME/duration, and every
  generated representation hash/bytes/generator/derivation are preserved. A
  provider that does not report one unambiguous model version produces `null`
  plus `versionUnavailableReason`; Media2Text does not infer a version.
- Delivery is at-least-once, signed with HMAC-SHA256 over
  `${timestamp}.${canonicalBody}` and uses a fixed operator-configured target.
- Cortex must persist inbox/idempotency state before acknowledging the event.
- `GET /v1/transcripts` and `GET /v1/transcripts/{transcriptId}` are the pull
  reconciliation path. Pull is recovery, not the primary completion path.
- List reconciliation is cursor-based and has no 500-record total ceiling.
  Pages contain at most 500 items, sort by `(materializedAt, transcriptId)`
  descending, and return an opaque `nextCursor` plus `hasMore`. A consumer must
  follow cursors until `nextCursor` is `null`; new records inserted during a
  traversal do not displace older records behind the cursor.
- `Y2T_CORTEX_TRANSCRIPT_READ_KEY` is a separate least-privilege bearer accepted
  only by the transcript list and exact-record GET operations. It cannot read
  metrics, settings, intakes, runs, or any write route. The operator API key
  remains valid for the same two GET operations.
- A missing target URL does not discard events. Rows remain pending until the
  contract is frozen and the target is configured.

## Revision And Source Lifecycle Semantics

- The immutable transcript record is evidence, not mutable lifecycle state.
  `current`, `superseded`, and `withdrawn` are catalog/list/event projections so
  an older record never needs to be rewritten.
- Identity is `(source.authority, sourceCollectionId or empty, sourceItemId)`.
  The first transcript is revision 1 with reason `initial`.
- A new transcript for the same source identity and the same artifact revision
  is a `retranscription`; a different artifact revision is a `source-revision`.
  Both create a new immutable transcript id, increment revision, mark the prior
  projection `superseded`, and link both directions. An identical transcript id
  is idempotent and creates no revision.
- Default pull returns the latest projection for every source, including
  withdrawn tombstones. `includeSuperseded=true` adds historical records. Exact
  retrieval remains available for superseded and withdrawn transcript ids.
- Media2Text never decides that source media was deleted. It records withdrawal
  only from an authenticated lifecycle assertion made by the matching source
  authority. The resulting `transcript.withdrawn` event and pull tombstone carry
  that source event id/time/reason; transcript evidence is retained. The inbound
  source-lifecycle wire contract is not implemented in this slice and must be
  reviewed with its producer before any live withdrawal signal is accepted.

## HMAC Verification And Rotation

- Each delivery includes `X-Media2Text-Event`, `X-Media2Text-Event-Id`,
  `X-Media2Text-Timestamp`, `X-Media2Text-Key-Id`,
  `X-Media2Text-Signature-Version: hmac-sha256-v1`, and
  `X-Media2Text-Signature: sha256=<hex>`.
- The receiver rejects timestamps more than 300 seconds in the past or future,
  verifies the key selected by `Key-Id`, verifies HMAC over the exact canonical
  body, and then atomically deduplicates `eventId` before returning success.
- Rotation is active/previous: provision the new key and key id at Cortex,
  retain the previous verification key for at least the 300-second replay
  window plus the maximum in-flight request timeout, then switch the producer
  active key. Retries are signed afresh with the currently active producer key.
  Unknown or retired key ids fail closed. Secrets never appear in event bodies.

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
