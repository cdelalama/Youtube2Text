# Automatic key and account failover with operator notice - 2026-11-12

State: source prepared on task branch `work/stt-failover-20261112`, candidate
0.43.0. NOT deployed: the NAS still runs 0.42.2. Independent review by a
different model family is still pending. The switch is off by default, so
installing this release changes nothing until Carlos turns it on.
Decision: `docs/llm/DECISIONS.md` D-029. Operator guide (Spanish):
`STT_ACCOUNTS_OPERATOR_GUIDE_2026-10-24.md`, section "Cambio automático".

## Authority

Carlos, 2026-11-12 about 00:45 Europe/Madrid, in a Claude Code session working on
his Cortex project. Asked whether Media2Text should move by itself to the next
account when one is rejected or out of credit, he answered, verbatim:

> Y sí, tendrías que mandar, si una cuenta se queda sin saldo, debería intentar
> con la misma cuenta conseguir un token nuevo y si no, cambiar de cuenta. Y
> decídmelo, sobre todo porque puede cambiar la calidad.

Reading used for this work:

1. When a key runs out of credit or is rejected, try the next enabled key of
   the same account.
2. If none works, switch to the next account, which may belong to another
   speech-to-text service.
3. Tell him every time this happens, saying clearly when the service changed,
   because transcription quality can change.

The words were relayed by the requesting Cortex session; this repository holds
no transcript of that conversation. D-028 (2026-10-23) excluded automatic account
failover; D-029 supersedes only that exclusion.

## What the operator gets

In Settings > Transcription accounts:

- One switch, "Usar automáticamente la siguiente clave o cuenta". Off by default.
- An ordered list of the accounts allowed to take over. It can mix services.
  Only listed, enabled accounts can ever receive moved work.
- Each account's keys in order (current key first, then the order he sets).
- Each key shows its state: ok, rejected by the service, or out of credit/quota,
  with the time since when and the HTTP status that caused it.
- "Marcar como disponible" puts a key back in use after he topped up or fixed it.
- A notice for every automatic change, kept until he dismisses it, naming the
  account and key (last four characters) that stopped, why, and what took over.
  When the service changed it says so and that quality may differ. The same
  notice is shown as a banner on every screen of the console.
- The line "Nuevos trabajos" shows which account is really in use.

## The safety rule

Work moves to another key or account ONLY when the provider definitively refused
the request before accepting the audio as work: authentication or permission
refused, or payment/quota refused, as an HTTP answer to the submission.

It NEVER moves on a timeout, a network error, a 5xx, a rate limit, or anything
after the provider accepted the audio. In those cases the first provider may
still bill, so the job fails exactly as before. `STT_PROVIDER_AUDIT_2026-10-23.md`
explains why generic failover after an ambiguous billable submission is unsafe.

The rule is enforced in three places:

- Adapters classify. Only they know the phase. They attach a typed
  `DefinitiveRefusal` (`src/transcription/errors.ts`) and nothing else does.
- The pipeline (`transcribePiece` in `src/pipeline/run.ts`) reacts only to that
  typed refusal and rethrows every other error untouched.
- The private store (`recordRefusal` in `src/credentials/store.ts`) decides
  whether a move is allowed (switch, list, health) and writes the audit event
  and the notice in the same transaction as the move.

## Provider error shapes

Verified means: read in the adapter code and in the provider's official
documentation on 2026-11-12. No live provider was called; no real refusal was
observed. Assumed means: not documented for that endpoint, accepted on HTTP
meaning or on wording this adapter already recognised.

| Provider | Where work is accepted | Rejected | Exhausted | Deliberately not a refusal |
| --- | --- | --- | --- | --- |
| Deepgram | Synchronous `POST /v1/listen`; a 4xx means no work | 401 `INVALID_AUTH` / `INSUFFICIENT_PERMISSIONS`, 403 `INSUFFICIENT_PERMISSIONS` (verified) | 402 `ASR_PAYMENT_REQUIRED` (verified) | 429, 5xx, timeout, network |
| OpenAI | Synchronous `POST /v1/audio/transcriptions` | 401, 403 unsupported country/region (verified) | 429 with `error.type` `insufficient_quota` or a billing `error.code` (verified); 402 (assumed, undocumented) | 429 rate limit, 5xx, timeout, network |
| AssemblyAI | `POST /v2/transcript` answering 2xx. Upload and create are before acceptance; polling is after | 401 on upload or create (verified) | 400 "Your current account balance is negative" on create (verified); 402 and the older credit wordings with a 400/402 status (assumed) | 403 (documented as a request-rate limit), 429, 5xx, timeout, network, every polling error, a job that ends in `status: error` |

Sources: <https://developers.deepgram.com/docs/errors>,
<https://developers.openai.com/api/docs/guides/error-codes>,
<https://www.assemblyai.com/docs/errors.md>,
<https://www.assemblyai.com/docs/pre-recorded-audio/guides/common_errors_and_solutions.md>.

Notes:

- OpenAI: `error.type` `insufficient_quota` and the `error.code` values
  `credit_balance_exhausted`, `organization_spend_limit_exceeded`,
  `project_spend_limit_exceeded` and `organization_usage_limit_exceeded` are
  documented. `insufficient_quota` and `billing_hard_limit_reached` as
  `error.code` are older shapes and are assumed.
- A 403 is a permission answer, not always a bad key: Deepgram uses it when the
  project lacks access to the model, OpenAI for an unsupported region. Moving is
  still safe for billing, and the notice shows the HTTP status.
- AssemblyAI's existing loose credit wording match is unchanged. It still stops
  the run as before; it only becomes a refusal with a 400/402 status before
  acceptance. The documented 400 balance message was not recognised before and
  with the switch off it still fails as an ordinary 400.

## Order of attempts

1. The remaining keys of the same account: current key first, then his order.
2. The accounts of his list from the top, skipping the one already in use.

A candidate must be an enabled account with a key that is not locally revoked
and not marked rejected or exhausted. If nothing is left the job fails closed:
"Automatic account change stopped: ... no other enabled, healthy key or account
is left", and he gets a notice.

The account he selected stays his selection. When its key is marked unhealthy
and the switch is on, new work goes to the next candidate; when he marks the key
available again, new work returns to it.

What does not start a move: a provider on the existing environment keys (legacy
mode has no account to move from), an account he disabled, a key he revoked
locally, and the optional AssemblyAI low-balance check at the start of a run.

## Accepted work is not re-pinned silently

A job keeps the key it was accepted with. It moves only when the provider
definitively refuses that job's own request, and that move writes an audit event
naming the job, updates its recorded selection (and its intake's, so a restart
does not replay the refused key), and raises the notice. Other queued jobs pinned
to the same key are left alone until their own request is refused. Changing the
switch, the list or the key order never touches accepted work.

## Usage caps and cost

Nothing raises a cap. Every request still reserves usage first, for the service
that will do the work, at that service's rate:

- Same service: the reservation of the refused request is reused, so a refused
  request is not counted twice.
- Another service: the refused reservation is released (the provider never
  accepted it) and a new one is made for the new service. If a cap does not
  allow it the job fails with the usual usage-limit error and no audio is sent.

## Split recordings

A recording larger than the service's limit is sent in pieces. If a piece is
refused, the next key of the same service continues with that piece; pieces
already accepted are kept. A change to another service is made only when no
piece of that recording was accepted yet; the recording is then planned again for
the new service's limits. If part was already accepted, the recording fails with
a clear reason instead of paying twice or mixing two services in one transcript.
New work still moves, and he is told.

## Telling the operator

1. Audit. Table `failover_events` in the private database: time, kind, job,
   reason, HTTP status, from and to (provider, account, key identifiers), and
   whether the service changed. The existing `audit` table also records health
   changes, moves, the switch and order changes. No key value is stored.
2. Notice in the web UI, until dismissed. Repeats of the same pending change
   share one notice with a count. New work that only follows a change he already
   dismissed is audited but does not raise the same notice again; a key that
   fails again after being re-enabled does.
3. The transcript. The immutable record already has `transcription.provider`
   and `transcription.model`; they now name the service that actually did the
   work, and `/v1/transcripts` exposes them as before. Transcript Ready v1 has no
   provider field and was NOT changed: a consumer reads the provider from the
   record the event points to.
4. The status route, below.

## Status route

`GET /status/media-pipeline` (public, sanitized; web path
`/api/status/media-pipeline`):

- Default response: still exactly three checks and the same five top-level
  keys. An automatic change awaiting review, or nothing left to take over, sets
  `condition: degraded`, `severity: warning` and a summary that says so.
- With `?include=stt_account_failover`: a fourth check is added.

```json
{ "name": "stt_account_failover", "label": "Transcription account failover",
  "condition": "degraded", "severity": "warning",
  "summary": "1 automatic account change notice(s) await operator review; the transcription service changed.",
  "pending_notices": 1, "service_changed": true, "blocked": false }
```

`pending_notices` counts undismissed notices, `service_changed` is true when any
of them changed service, `blocked` is true when the switch is on, the selected
key is unhealthy and nothing listed can take over. No account alias, key hint or
identifier is exposed.

Why opt-in: the deployed Sentinel readiness probe for Media2Text
(`sentinel/src/sentinel_readiness_probe.py`, read at origin/main on 2026-11-12)
accepts only the exact default shape: those five keys, exactly three named
checks, severities `none` or `warning`, summaries of at most 180 characters. A
fourth check in the default response would make Sentinel report Media2Text as
failing. The default response therefore keeps that shape, and a test pins it.

## Immediate push message: proposal

Not implemented here. This repository adds no bot token and calls no external
service.

How the homelab notifies today (Home Infra origin/main, 2026-11-12): Sentinel on
its Pi owns incident lifecycle and Telegram delivery for the fleet, and already
polls this status URL every 30 seconds
(`docs/integration-sentinel-plans/youtube2text.json`). The owner record
`MEDIA2TEXT_ACCOUNTS_DELIVERY_2026-10-23.md` limits Media2Text to availability
only: "Record local incidents only, with no message queue, Telegram or phone
alert promise." The separate `infra-health-monitor` on dev-vm watches Portal and
aggregate state and sends Telegram directly; it is the independent watcher, not
the place for application rules.

Proposed route: Sentinel. It is the existing sender, it already reads this
route, and it keeps detection, notification and recovery separate. Work outside
this repository, none of it done:

1. Carlos decides that Media2Text may send him Telegram messages for automatic
   account changes. Today's owner record says no phone alert for this target.
2. Home Infra (owner session) updates the Media2Text Sentinel plan and delivery
   record: probe `...?include=stt_account_failover`, and a notification rule on
   the check named `stt_account_failover` (alert when `condition` is `degraded`;
   say the service changed when `service_changed` is true; treat `blocked` as the
   more urgent case).
3. Sentinel (its own repository and owner session) extends the fixed Media2Text
   contract to accept the fourth check and its three extra fields, adds the rule
   and message text, and delivers through its existing Telegram sender. This
   needs Sentinel's own review and guarded installation.
4. Order: deploy Media2Text 0.43.0 first (the default route is unchanged), then
   change Sentinel. No Media2Text setting has to change afterwards.
5. Optional, Home Infra: point the Portal status URL at the opt-in form if the
   Portal should list the check by name. It already shows the degraded aggregate.

Recovery is natural: when he dismisses the notices the check returns to ok.

## Deployment: what remains

Nothing below was done. The NAS runs 0.42.2.

1. Independent review of this branch by a different model family (the
   requesting session obtains it from Codex) and merge to `main`.
2. Build and publish immutable 0.43.0 API and web images and deploy with
   `docs/operations/DEPLOY_PLAYBOOK.md`. No new secret, environment variable,
   port or mount. The private database gains five tables on first start
   (`CREATE TABLE IF NOT EXISTS`); 0.42.2 ignores them, so rollback is safe.
3. Update Home Infra's deployed-reality records for the new version.
4. Carlos opens Settings, adds or imports the accounts he wants, orders the
   list and turns the switch on. Until then behaviour is unchanged.
5. A first real automatic change can only be observed when a real key is
   refused. No paid test is implied or authorized by this work.

## Known limits

- A refused request still reaches the provider once per job pinned to that key.
  With AssemblyAI the audio is uploaded before the create call is refused.
- An access check cannot prove credit, so it never clears "out of credit"; only
  "Marcar como disponible" or a completed request does.
- Key health is recorded even with the switch off, as information only.
- The notice count can overstate by one if an intake admission is rolled back.
- Audit, event and notice rows have no retention policy, like the existing
  audit rows.
- The CLI and legacy environment key pools are unchanged, including the pool's
  own round-robin; only its log line no longer shows key characters.
- The UI was type-checked and built, not exercised in a browser.

## Validation

`tests/sttFailover.test.ts`, 17 tests, all with local fakes: same-account next
key; next account after every key; cross-service move and transcript provider;
no move on timeout, network error, 5xx, rate limit and post-acceptance failures;
switch off identical to an unpinned run; accepted work not re-pinned silently;
caps enforced; no secret in audit, notices, events, snapshots, logs or the
private database; unhealthy keys skipped until re-enabled or re-checked; split
recordings; typed errors per provider; fixed default status shape and the opt-in
check; account API actions. Exact results for this candidate are in
`docs/llm/HISTORY.md`.
