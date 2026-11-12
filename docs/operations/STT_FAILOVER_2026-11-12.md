# Automatic key and account failover with operator notice - 2026-11-12

State: source prepared on task branch `work/stt-failover-20261112`, candidate
0.43.4. NOT deployed: the NAS still runs 0.42.2. Three independent reviews by
Codex (of 0.43.0, 0.43.1 and 0.43.3) said do not merge or deploy yet; 0.43.4
answers the third and waits for the next one (see `docs/llm/REVIEWS.md`). The switch is
off by default, so installing this release changes no routing until Carlos
turns it on. What does change with the switch off is listed below under
"Changes that apply with the switch off".
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
- Each key shows its marks: rejected by the service, out of credit or quota, or
  both, each with the time since when and the HTTP status that caused it. A
  mark stays until he clears it; a completed transcription never clears it.
- "Marcar como disponible" puts a key back in use after he topped up or fixed
  it. It is the only thing that clears "out of credit".
- A notice for every automatic change, kept until he dismisses it. It tells
  what happened in the past tense: which service refused which account and key
  (last four characters), why, and what the affected job continued with. When
  the service changed it says so and that quality may differ. Dismissing a
  notice never silences the next change, even an identical one. The notice is
  shown as a banner on every screen of the console, Settings included, followed
  by a separate sentence on where new work goes right now. The open console
  re-reads notices and key state every 20 seconds.
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

- Adapters classify. Only they know the phase. They throw a typed
  `ProviderRefusalError` (`src/transcription/errors.ts`) only for shapes the
  provider documents; nothing else may infer a refusal.
- The pipeline (`transcribePiece` in `src/pipeline/sttSession.ts`) reacts only
  to that typed refusal and rethrows every other error untouched.
- The private store (`recordRefusal` in `src/credentials/store.ts`) records the
  key's health, then decides whether the work may move (switch, list, health,
  and whether part of the recording was already accepted) BEFORE rewriting any
  pin, and writes the audit event and the notice in the same transaction.

Each attempt is bound to its own pin. A recording keeps the key it started with
until its own request is refused, even if another recording of the same run has
already moved the run. Its availability guard (checked before every request,
retry and poll) and local revocation act on that exact key: revoking a key
cancels a run while any of its recordings still owns that key, between pieces
too, whatever the run's current key is.

## Where key characters and provider text may appear

D-028 accepted showing the last four characters of a saved key on the accounts
screen. The rule for this feature: those characters appear ONLY on the
authenticated accounts screen and inside its failover notice. They never appear
in logs, audit rows, failover events, the public status route, error messages
or any response that another screen needs.

- Stored rows (`audit`, `failover_events`, `failover_notices`, `key_marks`) hold
  account and credential identifiers. The hint and the account alias are added
  only when a notice is rendered for the authenticated UI.
- The banner on the other screens reads `GET /provider-accounts?view=notices`:
  pending notices and current routing. It carries no account listing and no key
  suffix of the existing configuration; the full snapshot is read only by the
  accounts screen. Any other query on that route is refused with 400.

Provider text is closed off for every provider error, not only for refusals.
A provider can echo part of a key in its answer, and a filter over free text
cannot be made complete (short or separated fragments survive it). So no free
provider text is kept anywhere. `src/transcription/errors.ts` builds every
outward text from fixed parts only:

- the provider name chosen by the adapter;
- the HTTP status;
- a category chosen by the code: `authentication`, `payment-or-quota`,
  `rate-limit`, `server-error`, `invalid-request`, `invalid-response`,
  `timeout`, `network`, `transcription-failed` or `unclassified`;
- at most one machine token supplied by the provider, accepted only if it
  matches `^[A-Za-z0-9_.-]{1,64}$` and shares no run of four or more consecutive
  characters with the key in use (a key shorter than four characters is
  compared whole);
- for two AssemblyAI cases, a fixed note written in the code.

Examples: `Deepgram error: payment-or-quota (HTTP 402) [ASR_PAYMENT_REQUIRED]`,
`OpenAI Whisper error: rate-limit (HTTP 429) [rate_limit_exceeded]`,
`AssemblyAI error: server-error (HTTP 503)`, `Deepgram error: timeout`,
`AssemblyAI error: network`.

The token is the provider's error code or type (Deepgram `err_code`; OpenAI
`error.code`, else `error.type`). AssemblyAI answers errors with free text, so
its HTTP errors carry no token. Two AssemblyAI errors after acceptance carry
the job identifier as their one token, under the same checks, because it is the
only reference for looking the job up: a job that ends in error
(`AssemblyAI error: transcription-failed [<job id>]; the accepted job ended in
error at the provider`) and polling that gives up. The provider's own
explanation of a failed job is not quoted.

What the pipeline needs to decide is in typed fields of `ProviderError`
(`status`, `category`, `token`), not in the message. `sanitizeProviderErrorText`
no longer exists. The failover errors (`FailoverExhaustedError`,
`RecordingStoppedError`) are fixed text with provider, reason and status.

## Provider error shapes

Only shapes supported by the provider's own documentation move work. Everything
else is unclassified: the job fails as before, with a fixed-part error, and for
refusal-looking statuses the adapter also logs the HTTP status code so the
reason is visible. Documentation
was read on 2026-11-12 through a fetch tool that summarises each page; no live
provider was called and no real refusal was observed.

| Provider | Where work is accepted | Rejected | Exhausted | Unclassified on purpose |
| --- | --- | --- | --- | --- |
| Deepgram | Synchronous `POST /v1/listen`; a 4xx means no work | 401 `INVALID_AUTH` / `INSUFFICIENT_PERMISSIONS`; 403 `INSUFFICIENT_PERMISSIONS` | 402 `ASR_PAYMENT_REQUIRED` | 429, 5xx, timeout, network, a failure after a 2xx |
| OpenAI | Synchronous `POST /v1/audio/transcriptions` | every 401; 403 only with the documented text "Country, region, or territory not supported" | 429 with `error.type` `insufficient_quota` or `error.code` `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, `organization_usage_limit_exceeded` | 402 (OpenAI documents none), any other 403, a plain 429 rate limit, 5xx, timeout, network, a failure after a 2xx |
| AssemblyAI | `POST /v2/transcript` answering 2xx. Upload and create are before acceptance; polling is after | 401 "Authentication error, API token missing/invalid" on upload or create | 400 "Your current account balance is negative" on create only | 402 and this adapter's older credit wordings (undocumented for this API), 403, 429, 5xx, timeout, network, a create call with no answer, every polling error, a job that ends in `status: error` |

Sources: <https://developers.deepgram.com/docs/errors>,
<https://developers.openai.com/api/docs/guides/error-codes>,
<https://www.assemblyai.com/docs/errors.md>,
<https://www.assemblyai.com/docs/pre-recorded-audio/guides/common_errors_and_solutions.md>.

Notes:

- AssemblyAI 403 does not move work because it is ambiguous, not because it is
  a rate limit: the troubleshooting guide describes 403 as no access to the
  requested resource and 429 as too many requests, while the errors page also
  ties 403 to a request-volume limit and to "Cannot access uploaded file".
- AssemblyAI's older credit wording match (`InsufficientCreditsError`) is
  unchanged: it still stops the run as before, and it never moves work.
- OpenAI `organization_usage_limit_exceeded` is documented as a usage limit
  assigned by OpenAI rather than as billing; it is kept because the same page
  groups it with "billing, spend, or quota errors" that a retry cannot fix.
- A 403 is a permission answer, not always a bad key: Deepgram uses it when the
  project lacks access to the model, OpenAI for an unsupported region. Moving is
  still safe for billing, and the notice shows the HTTP status.

## Changes that apply with the switch off

Routing does not change until the switch is on. These things do:

1. The wording of every provider error (see above). Old texts such as
   "Deepgram API error (503): <provider text>", "Deepgram request timed out" or
   "Transcription error: {...}" no longer occur.
2. Key marks. A definitive refusal, or a rejected access check, marks the key
   on the accounts screen until he clears it. With the switch off the key is
   still used.
3. The console re-reads accounts and notices every 20 seconds and shows a band
   on every screen when a notice is pending or new jobs are being refused.
4. A selected account that he disabled, or whose current key he revoked, is
   shown as what it is: new jobs are refused, with the reason. It is no longer
   described as the existing configuration.
5. `GET /provider-accounts` refuses any query other than exactly `view=notices`.
6. The legacy key pool log line shows a key's position, not its first characters.
7. The private database gains five tables; 0.42.2 ignores them.

## Order of attempts

1. The remaining keys of the same account: current key first, then his order.
2. The accounts of his list from the top, skipping the one already in use.

A candidate must be an enabled account with a key that is not locally revoked
and not marked rejected or exhausted. If nothing is left the job fails closed:
"Automatic account change stopped: ... no other enabled, healthy key or account
is left", and he gets a notice. A key refused for a recording is never tried
again for that recording; there is no attempt counter, so every definitive
refusal is recorded and every remaining candidate is tried.

A key carries two independent, latched marks. "Out of credit" is cleared only
by "Marcar como disponible". "Rejected" is also cleared by an accepted
"Comprobar acceso". An access check never proves credit, so it never clears
"out of credit", not even when the key was refused for access in between. A
completed transcription clears neither, because that request may have been
accepted before the refusal. A key with either mark is skipped for new work.

The destination of every move is chosen at that moment, inside the same
transaction that records it: current health, availability and order, excluding
the keys the recording was already refused with. So a key another job has just
marked is not used because a sibling went there earlier, and a key the operator
re-enabled meanwhile is not handed back to the recording it refused.

The account he selected stays his selection. When its key is marked unhealthy
and the switch is on, new work goes to the next candidate; when he marks the key
available again, new work returns to it.

What does not start a move: a provider on the existing environment keys (legacy
mode has no account to move from), an account he disabled, a key he revoked
locally, and the optional AssemblyAI low-balance check at the start of a run.

A selected account that cannot take work (disabled, or its current key revoked)
is its own state, "unavailable", distinct from the deliberate use of the
existing configuration. New work is refused, and both the "Nuevos trabajos"
line and the band say so with the reason, in Spanish. The band appears for this
even when no notice is pending.

## Accepted work is not re-pinned silently

A job keeps the key it was accepted with. It moves only when the provider
definitively refuses that job's own request, and that move writes an audit event
naming the job, updates its recorded selection (and its intake's, so a restart
does not replay the refused key), and raises the notice. Other queued jobs pinned
to the same key are left alone until their own request is refused. Changing the
switch, the list or the key order never touches accepted work. Two jobs refused
at the same moment each move once to the same next key. A second recording of a
run that already moved has its destination chosen again and gets its own audit
event and notice, even when it ends on the same key.

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
the new service's limits.

If part was already accepted and the next candidate is another service, the
recording stops. This is decided before anything is moved: the refusal is
recorded, a distinct `recording_stopped` event is written, the recording keeps
its real provider pin, and the notice says that the recording stopped, not that
another account took over. Two services are never mixed in one transcript. The
notice and the job error both say plainly that transcribing the recording again
repeats the parts already done and that those parts can be charged again. New
work is a separate matter: it moves, and that move gets its own notice.

## Telling the operator

1. Audit. Table `failover_events` in the private database: time, kind, job,
   reason, HTTP status, from and to (provider, account, key identifiers), and
   whether the service changed. The existing `audit` table also records health
   changes, moves, the switch and order changes. No key value is stored.
2. Notice in the web UI, until dismissed. Every automatic change produces a
   pending notice: repeats of the same pending change share one notice with a
   count, and a notice he dismissed never silences the next change. There are
   three kinds: another key or account took over; nothing was left; a partly
   transcribed recording stopped. A notice is a past event and is worded in the
   past tense; it does not claim that a key is unused or that a destination is
   in use now. Current routing is shown apart: the "Nuevos trabajos" line in
   Settings and one sentence after the banner. A read that started before a
   change on the screen never replaces what that change returned.
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
4. Order: deploy Media2Text first (the default route is unchanged), then change
   Sentinel. No Media2Text setting has to change afterwards.
5. Optional, Home Infra: point the Portal status URL at the opt-in form if the
   Portal should list the check by name. It already shows the degraded aggregate.

Recovery is natural: when he dismisses the notices the check returns to ok.

## Deployment: what remains

Nothing below was done. The NAS runs 0.42.2.

1. Review of the current candidate by a different model family (the requesting
   session obtains it from Codex), then merge to `main`.
2. Build and publish immutable API and web images of the reviewed version and
   deploy with
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
  "Marcar como disponible" does. Marks never clear by themselves, so a key he
  topped up stays skipped until he marks it available.
- Provider errors no longer say what the provider wrote, only its status, a
  category and at most one code. Diagnosing an unusual failure may need the
  provider's own console.
- A provider code is dropped when it shares four consecutive characters with the
  key in use, even by coincidence.
- Key health is recorded even with the switch off, as information only; the
  screen says so and warns before the switch is turned on with marked keys.
- A provider refusal in an undocumented shape (for example an OpenAI or
  AssemblyAI 402) does not move work: the job fails as before.
- The notice count can overstate by one if an intake admission is rolled back.
- Audit, event and notice rows have no retention policy, like the existing
  audit rows.
- The CLI and legacy environment key pools are unchanged, including the pool's
  own round-robin; only its log line no longer shows key characters.
- The UI was type-checked and built, not exercised in a browser.

## Validation

`tests/sttFailover.test.ts`, 31 tests, all with local fakes: same-account next
key; next account after every key; cross-service move and transcript provider;
no move on timeout, network error, 5xx, rate limit and post-acceptance failures;
no move after a 2xx or after the upload; switch off identical to an unpinned
run; accepted work not re-pinned silently; each attempt guarded and revocable by
its own pin while a sibling recording moves the run; two jobs refused at once;
an older success not erasing a newer refusal; exhaustion surviving a later
access refusal and an accepted check; a sibling's destination re-validated and
its follow audited and announced; a re-enabled key not handed back to the
recording it refused; a partly transcribed recording refused on its second
piece; every refusal recorded with no attempt counter; caps enforced; no key
character and no provider text in logs, run records, events, stored audit rows,
the status route or error texts, on refusals and on the older paths (5xx, rate
limit, unclassified status, unreadable answer, network, timeout, AssemblyAI
polling and job failure), with ordinary and with short secrets; the machine
token filter; a selected account that cannot take work shown as unavailable;
the band told once after a whole selection; the notices-only read and its
proxy, refusing any other query; an older screen read never replacing a newer
change; notice wording; documented-only provider shapes; fixed default status
shape and the opt-in check;
account API actions. Exact results for this candidate are in
`docs/llm/HISTORY.md`.
