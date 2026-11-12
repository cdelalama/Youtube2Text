## 2026-11-12 - Automatic account failover: fourth independent review (0.43.4) and fixes in 0.43.5

Review, as relayed by the requesting Cortex session: Codex gpt-6-astra,
reasoning effort max, read-only, session
01a1d0ae-34a8-7193-9ae3-3a696f72ad03, candidate commit `34164d7` (0.43.4). The
requesting session also reported its own run of `559021c`: backend and web type
checks clean, 279 of 279 tests. Provenance limit as before: the executor
(Claude, claude-fable-5-2) received the findings through the requesting session
and did not see the review session or verify its model metadata.

Marked RESOLVED by the reviewer: the unavailable-selection state, the refresh
after a complete selection, and the proxy evidence. Still no automatic second
paid submission. Verdict: do not merge or deploy; two release blockers and two
tracked follow-ups. 0.43.5 below is the executor's answer and has NOT been
reviewed.

Release blockers:

1. Provider tokens in outward text (acceptProviderToken, providerErrorText). A
   provider string with a separated key fragment still passed ("AB-CD" for a
   key ending "ABCD"; a whole 32-character key split with dots fits the
   64-character limit) and reached errors, logs and events. Fixed by removing
   provider-supplied strings from every outward message: acceptProviderToken
   and the token field are gone. A recognised provider code is mapped to a
   label owned by the code (DEEPGRAM_ERROR_LABELS, OPENAI_ERROR_LABELS,
   fixedLabel in src/transcription/errors.ts); anything else the provider sends
   becomes the fixed label "other"; no code, no label. The label type is a
   union of those constants, so a raw string cannot be passed by mistake. No
   routing decision uses a label. Upstream job identifiers stay internal: the
   AssemblyAI job id is used only to poll and is no longer in the "Transcription
   started" log line or in the job-failed and polling-timeout errors. The
   disclosure test now also compares with every separator removed, and covers a
   separated fragment and a dotted key as an error code and as a job identifier.
   Assumed, not read in documentation: the OpenAI labels invalid_api_key and
   rate_limit_exceeded (the error-codes guide does not list them).
   Not changed, for the reviewer to judge: the identifier a provider returns
   with a finished transcript remains inside the stored transcript file, as
   before this work; it is transcript content, not a message, log, run record
   or event.
2. Mixed rollout (proxyFailoverNotices). The proxy forwarded the upstream body
   unchanged; an API before 0.43.0 ignores view=notices and returns the full
   account snapshot, so a new web in front of an old API would have sent
   account data and legacy key hints to every screen's banner read. Fixed: the
   API marks the answer with view "notices"; the proxy (readNoticesView in
   web/lib/failoverNoticesProxy.ts) accepts only a body whose top level is
   exactly view, notices and routing, validates every allowed field and builds
   a new response from those fields only. Anything else gets a fixed 502
   (api_answer_not_notices_view, or api_refused_notices when the API did not
   answer 200) and nothing upstream is forwarded. Tested with a fake upstream
   that answers like 0.42.2, with the listing carrying the mark, with the view
   carrying an account listing, without the mark, with a whole key as a hint,
   with non-JSON and with API errors; and the API's real answer is checked
   against the web's reader.
   Judgement for the reviewer: an unknown top-level field refuses the answer;
   an unknown field inside a notice or the routing is left behind and the rest
   is passed on, so that a later API field does not blank the band.

Tracked follow-ups, both done now:

3. runAccountAction. If the POST threw after the server committed (also while
   reading its JSON), neither reload nor notification happened. Fixed: a lost
   answer, and a 5xx answer, are treated as "may be stored". The change is not
   sent again; the snapshot is read back, the banner is told, and the outcome
   is "uncertain" with a Spanish message that says the list shows what is
   stored ("unreachable" when the read-back fails too). Only a 4xx counts as
   the API saying it changed nothing. Limit: a half-made selection is shown,
   not completed.
4. sttFailoverStatus. It ignored selection.state "unavailable". Fixed: the
   public status reports degraded with one fixed sentence, no alias, reason or
   identifier, also with the switch off and no notice pending. The default
   response keeps the shape the deployed probe requires; the opt-in check gains
   selection_unavailable.

Also done: the operator guide states in Spanish the reviewer's conditions
before turning the switch on (a saved account selected, the fallback order
reviewed, because the legacy configuration does not take part).

The new behaviour changes with the switch off are listed in CHANGELOG 0.43.5,
in the operator guide and in docs/operations/STT_FAILOVER_2026-11-12.md.

tests/sttFailover.test.ts still has 31 tests; four of them were extended.
Exact totals are in the HISTORY entry for 0.43.5.

Not done: review of 0.43.5; any browser exercise of the screen; deployment.

## 2026-11-12 - Automatic account failover: third independent review (0.43.3) and fixes in 0.43.4

Review, as relayed by the requesting Cortex session: Codex gpt-6-astra,
reasoning effort max, read-only, inline diff, session
01a1d069-c3ac-7602-9a01-a3992659e321, candidate commit `67dbcb2` (0.43.3).
Provenance limit as before: the executor (Claude, claude-fable-5-2) received the
findings through the requesting session and did not see the review session or
verify its model metadata.

Marked RESOLVED by the reviewer: all seven first-pass points and, from the
second pass, exhaustion latching, sibling validation and repeated candidates.
No automatic second paid submission is demonstrated. The reviewer accepts that
behaviour changes with the switch off, provided the release notes say so.
Verdict: still do not merge or deploy, also with the switch off, for four
points. 0.43.4 below is the executor's answer; it was reviewed afterwards (entry above).

1. Disclosure boundary on the older provider error paths (the reason for
   holding the release). sanitizeProviderErrorText still forwarded up to 200
   characters of provider body; fragments shorter than four characters or
   separated ones survived; the fragment filter was skipped for secrets shorter
   than eight characters. Fixed for every provider error: the function is
   removed and no free provider text is kept anywhere. src/transcription/errors.ts
   builds outward text from fixed parts only (provider name, HTTP status, a
   category chosen by the code, at most one provider machine token matching
   ^[A-Za-z0-9_.-]{1,64}$ with no run of four or more key characters; a key
   shorter than four is compared whole). Status, category and token are typed
   fields of ProviderError. Covered: HTTP errors of the three adapters,
   timeouts, network failures, unreadable 2xx answers, AssemblyAI polling
   failures, an AssemblyAI job ending in error and its polling time-out.
   Judgement for the reviewer: those last two AssemblyAI errors carry the
   provider's job identifier as their one token (same checks), not an error
   code, because it is the only reference to look the job up; the log line
   "Transcription started" applies the same filter. One existing test outside
   the feature expected the old job-error wording and was updated.
2. Unavailable selection shown as legacy routing. Fixed: the store reports the
   operator's selection as legacy, selected or unavailable with a reason
   (account_disabled, key_revoked); the notices view exposes routing state
   legacy, account, blocked or unavailable. The settings line and the band say
   in Spanish that new jobs are refused and why. The band also appears for this
   state when no notice is pending.
3. Banner refresh before the selection is complete. Fixed: one operator action
   is orchestrated by web/lib/accountAction.ts, which tells the band once, after
   the accounts request, the settings request and the read-back, also when the
   provider could not be activated (the message says so and the screen shows
   the real resulting state).
4. Web proxy of the notices view. Gathered in one unit, web/lib/failoverNoticesProxy.ts:
   session check, exact-query validation and fixed forwarding. Any other query
   on that route is now refused with 400 at the web proxy and at the API,
   instead of being ignored. Supporting files: web/lib/webAuth.ts
   (getWebAuthState), web/lib/credentialProxy.ts (dispatch),
   web/app/api/provider-accounts/route.ts (binding), web/middleware.ts (first
   session gate); API side src/credentials/routes.ts and noticesView in
   src/credentials/store.ts.

Behaviour changes with the switch off are now listed in CHANGELOG 0.43.4, in
the operator guide and in docs/operations/STT_FAILOVER_2026-11-12.md.

tests/sttFailover.test.ts now has 31 tests; exact totals are in the HISTORY
entry for 0.43.4.

Not done: review of 0.43.4; any browser exercise of the screen; deployment.

## 2026-11-12 - Automatic account failover: second independent review (0.43.1) and fixes in 0.43.2

Review, as relayed by the requesting Cortex session: Codex gpt-6-astra,
reasoning effort max, read-only, inline diff, session
01a1d029-3e3e-70f0-9b43-3ae390a740b1, candidate commit `a8fa9fe` (0.43.1).
Verdict: do not merge or deploy yet, also with the switch off. Provenance
limit as before: the executor (Claude, claude-fable-5-2) received the findings
through the requesting session and did not see the review session or verify its
model metadata. The verdict covers 0.43.1 only; 0.43.2 below is the executor's
answer and has NOT been reviewed, so the gate stays closed.

Resolved according to the reviewer (first-review items 1, 4, 5, 7): per-attempt
guards and pin ownership; eligibility of a partly transcribed recording;
refresh triggers; assumed refusal shapes, keeping OpenAI
organization_usage_limit_exceeded as exhausted with the reviewer's agreement.

Findings of the second pass and how each was handled in 0.43.2:

A. BLOCKER, key hints. Rule as accepted in D-028 and restated by the requesting
   session: the last four characters of a key may appear only where the
   authenticated accounts screen shows them and in the failover notice inside
   that UI; never in logs, audit rows, the public status route, error messages
   or a response another screen needs.
   (1) The banner on other screens now reads GET /provider-accounts?view=notices:
   pending notices and current routing, no account listing, no suffix of the
   existing configuration. The web proxy forwards only that exact view.
   (2) audit, failover_events, failover_notices and key_marks store identifiers
   only; hint and alias are derived when a notice is rendered. This was already
   so; a test now reads the stored rows.
   (3) ProviderRefusalError, FailoverExhaustedError, RecordingStoppedError and
   FailoverRepeatedCandidateError are built from fixed provider, status and
   reason codes; no provider text and no cause message. This changes the text of
   a 401/402/403 refusal with the switch off too.
   sanitizeProviderErrorText, used by every other provider error: it redacted
   only an exact copy of the whole key, so a masked echo of a key kept its first
   and last characters. It now also redacts any run of four or more consecutive
   key characters. The rest of the provider body (200 characters) still passes
   into those older errors, logs, run records and events. Not removed: those
   errors predate this feature.
B. Exhaustion could be cleared by accident. Fixed: exhausted and rejected are
   two independent latched marks (table key_marks). An access refusal adds
   rejected without touching exhausted; an accepted access check clears rejected
   only; only "mark as available" clears exhausted.
C. A sibling's destination was followed blindly and the follow left no trace.
   Fixed: the follow shortcut is gone. Every refusal makes the store choose the
   destination at that moment, inside the transaction, on current health,
   availability, order and exclusions, and every recording's transition gets
   its own event and notice, also when it ends on the sibling's key.
D. Repeated candidate detected after commitment. Fixed: the recording's refused
   credential ids go into candidate selection and are excluded before any move
   is committed. A key re-enabled meanwhile is not handed back to the recording
   it refused; the next healthy key is tried; no move that did not happen is
   recorded. The after-the-fact check remains only as a defensive stop.
E. A read that started before a change could replace the newer snapshot. Fixed
   with an ordering gate (web/lib/snapshotGate.ts) used by the accounts screen
   and by the banner: reads that began before a change started or finished, or
   that arrive after a newer read, are dropped.
F. Notice wording. Notices now tell the event in the past tense and never claim
   that a key is unused or a destination in use now. Current routing is shown
   apart (the "Nuevos trabajos" line; one sentence after the banner). The
   stopped-recording notice (Spanish) and RecordingStoppedError say that
   transcribing the recording again repeats the parts already done and that
   those can be charged again.

Found while testing and fixed: the log-capturing test helper replaced standard
output and could swallow a test result of the runner (one of 28 tests was not
counted in one run). It now captures standard error only. The 270 total
reported for 0.43.1 matched the expected count, so nothing was hidden then.

Tests added for B to E as the reviewer's scenarios and for the disclosure rule
of A. tests/sttFailover.test.ts now has 29 tests; exact totals are in the
HISTORY entry for 0.43.2.

0.43.3, test-only follow-up, same day: a mutation check showed that the
end-to-end disclosure test did not exercise the switch-off path, where a
refusal becomes the job error and reaches logs, events and run records (the
adapter tests already pinned the exact fixed messages). The test now covers it.
No product code changed after 0.43.2. The web production build of the 0.43.2
web source finished with exit 0.

Not done: review of 0.43.2/0.43.3; any browser exercise of the screen;
deployment.

## 2026-11-12 - Automatic account failover: independent review of 0.43.0 and fixes in 0.43.1

Review, as relayed by the requesting Cortex session: Codex gpt-6-astra,
reasoning effort max, read-only, inline diff, session
01a1cd4f-1482-7183-8dac-be9bc8a11a49, candidate commit `d6868aa` (0.43.0).
Verdict: do not merge or deploy yet; one blocker and six should-fix.
Provenance limit: the executor (Claude, claude-fable-5-2) received the findings
through the requesting session and did not see the review session or verify its
returned model metadata. The verdict covers 0.43.0 only. 0.43.1 below is the
executor's answer; it has NOT been re-reviewed, so the gate stays closed.

Findings and how each was handled in 0.43.1:

1. BLOCKER. Guards and revocation followed the run's current pin, not the
   attempt's: while one upload used K1 a sibling could move the run to K2 and the
   first upload's guard then validated K2. Fixed. Each recording now owns its
   pin (src/pipeline/sttSession.ts) and keeps it until its own request is
   refused. The guard passed to the adapter is bound to that attempt's pin for
   its whole life, and RunManager tracks every outstanding pin of a run (each
   recording holds its pin from start to end, between pieces too), so revoking
   a key cancels the run while any recording still owns it. Test with two
   concurrent recordings; both halves are confirmed by mutation.
2. An older success erased a newer refusal. Fixed by removing success-clearing
   altogether: a rejected or exhausted mark is latched until the operator's
   reset or, for rejected only, his successful re-check. Interleaving tested.
3. A dismissed notice silenced a later identical move. Fixed: every automatic
   change, including new work routed past a marked key, produces a pending
   notice; pending repeats share a counter; a dismissed one never suppresses
   the next. Operator guide updated.
4. The move was committed before checking whether the recording may move.
   Fixed: recordRefusal records health, then decides before rewriting anything.
   A partly transcribed recording whose next candidate is another service gets a
   distinct recording_stopped event and a "stopped" notice; its pin and recorded
   selection are untouched, and the notice says the recording stopped. The same
   check applies when a sibling recording already moved the run.
5. Notices refreshed only on terminal run updates, Settings went stale and the
   banner was hidden there. Fixed: the console and the open Settings screen
   re-read every 20 seconds while visible and on run activity; the banner shows
   on every screen including Settings.
6. The 25-attempt cap threw before recording the refusal. Fixed: the cap is
   gone. A key refused for a recording is never tried again for it, every
   definitive refusal is recorded first, and a registry answer that repeats an
   already refused key stops with its own explicit reason.
7. Provider shapes marked assumed. Removed. OpenAI: every 401, 403 only with the
   documented unsupported-region text, 429 only with error.type
   insufficient_quota or a documented quota error.code; a bare 402 is not
   definitive. AssemblyAI: 401, and the documented negative-balance 400 at
   creation only; 402 and the older credit wordings are unclassified. AssemblyAI
   403 still never moves work, with the corrected reason: it is ambiguous (no
   access to the resource in the troubleshooting guide; a request-volume limit
   and an upload access error on the errors page), not a rate limit.
   Unclassified refusals fail as before and are logged with the status only.

Judgement left for the reviewer: OpenAI organization_usage_limit_exceeded is
kept as exhausted. It is documented, but as a usage limit assigned by OpenAI,
not as billing; the same page groups it with quota errors a retry cannot fix.

Requested tests added: two jobs refused at once (one move each, no lost health);
a partly transcribed recording refused on its second piece (same provider
continues; other provider stops with the right notice and pin); failures after
a 2xx or after the upload never move work. tests/sttFailover.test.ts now has 22
tests. Exact totals are in the HISTORY entry for 0.43.1.

Not done: re-review of 0.43.1; any browser exercise of the screen; deployment.

## 2026-11-12 - Automatic account failover 0.43.0: before the review (superseded above)

No independent review yet: Claude author (claude-fable-5-2), so a Claude review
would not be independent. The requesting Cortex session obtains the review from
Codex, a different model family. Until that verdict is recorded here, candidate
0.43.0 on branch work/stt-failover-20261112 is unreviewed source. The author's
own tests and mutation checks are validation, not review. Points the reviewer
should test first: the safety rule in D-029, the provider shapes marked assumed
in docs/operations/STT_FAILOVER_2026-11-12.md, release of a refused usage
reservation on a service change, and the fixed default status shape.

## 2026-10-24 - Account delivery actual-view review and curation

Strict schema2 native capture accepted without warnings. Manifest SHA-256: product R10 448d3dc2f67025cdda3f1b78866e1475298a9b3674f2101d577705127206140d; integration R14 fe6f5128e169cca3e3742739a0091a481c03764cbe2a26f9faa0401a7bb0db54.

Exact claude-opus-5-5/high/firstParty product session e0d88e64-79d2-4f5c-840f-c134dafb83a5
R10 returned FUNCTIONAL_UI_GO after actual screenshots. G1 private recovery and
G2 explicit cookie lifetime/logout limits are fulfilled. Integration session
fab90ca9-da32-4b7e-9764-9fd527bfc6b8 retained R6/R7 readiness recovery, R8-R10
bounded artifact/private-recovery reviews, and R11 required curation corrections.
R12 returned CURATION_GO/SOURCE_DOCS_GO/HELPERS_GO; R13 accepted the sharing
preflight correction after the private-URL rejection proved no native write.
All exact native rounds are strictly captured. Hook check-status remains unknown
with zero recorded errors (exit3), not asserted successful. Source and history
are preserved. R14 returned SCOPED_CLOSEOUT_GO after inspecting actual P/R shared and S native
reader views, Portal, restore/publication receipts and the owner matrix. Required
C1 is incorporated in Home and Sentinel receipts: Sentinel self-surveillance is
unconfirmed with a missing snapshot; Sentinel/Portal retain diagnosis, with no
claim that it is or is not a regression. The nonblocking image-badge regression
is retained as HI-PORTAL-DIGEST-BADGE. R14 explicitly requires no further review
after this receipt correction. This is not whole-delivery acceptance.

## 2026-10-24 - Product R8/R9: deployment verification correction

Exact claude-opus-5-5/high, firstParty canonical metadata verified, same independent
session e0d88e64-79d2-4f5c-840f-c134dafb83a5. R8's temporary public-readiness guard
worked in attempt two, which exposed the verifier's absolute-redirect defect.
Both attempts restored exact prior runtime file hashes and healthy 0.39.3 images.
R9 returns SOURCE_GO for permanent bounded public readiness and exact canonical
/login validation, including relative/absolute acceptance and foreign-origin/path
rejection. All existing authentication, sanitized status, transcript, enforce and
disabled-scheduler checks remain. Four focused regressions and 248 application
tests pass, as do backend build, contract, versions, naming and DocKit. Both
production dependency audits report zero vulnerabilities. Record focused tests
on the published SHA; new immutable images must match that SHA. Use a fresh
non-overlapping attended window with at least480seconds, fresh runtime check and
drain, one guarded attempt; reconcile any failure without automatic replay.
Runtime web digest, real browser/account/logout, restore, handoff, consumers and
Dossier remain separate gates. R9 strict schema2 capture accepted without warnings;
hook outcome unknown, zero recorded errors. Manifest SHA-256: ba69cd0bbfc0faedd8876f490555dd6d2fa1f92b91bbce772995e5d849713ae2.

## 2026-10-23 - Product R5/R6/R7: qualified 0.42.1 source

Exact claude-opus-5-5/high, canonical firstParty metadata verified, independent
session e0d88e64-79d2-4f5c-840f-c134dafb83a5 and original parent session retained.
R5 returned SOURCE_GO for fixed Zod 4.6.7, explicit-only overrides and bounded
arrays, conditional on the web build, which passed. All 248 tests, seven focused
cases, typecheck, backend/web builds, contract and root/web audits (zero) pass.
R6 required four bounded deployment corrections. R7 returned SOURCE_GO after
checking restoration on start/verification failure, unconditional source
provenance, immutable registry content/config/OCI labels and explicit build guards.
Actual NAS Compose 5.1.1-qnap3 passes legacy and digest interpolation with its
existing loopback overlay. Three installation and three hardening tests pass.
The web build context excludes environment files. Doppler cannot override release
identity or the owner compose file. Partial build, digest mismatch or failed
restoration must be reconciled from retained evidence; never replay blindly.
One admitted sequential image-build job is allowed; default Docker storage can
retain local images. No capacity-floor bypass or broad cleanup is authorized.
The exact reviewed functional hashes are retained before source publication.
Strict schema-2 capture accepted R5/R6/R7 without warnings. Hook outcome remains
unknown, zero recorded errors. Capture manifest hashes:
- R5: 973e274c4fb813523846b3a6780817b6e9971fa32f904cce1177313c5f3127a3.
- R6: 2be066857c0f0b3f0e09f21f9782ae2ac92aef9a91cc55144c4fbc918c6135a3.
- R7: 2a61bdf5fe51489ed8d9ae4c253d679a7f1a083d8c5c0fd845f9b8e3f0523d41.

SOURCE_GO is source/tooling acceptance, not deployed login/use/logout, recovery
or complete consumer/Dossier delivery. Earlier audio/economic and M1-M3 gates
remain unchanged. No paid STT, automatic import or account selection occurred.

## 2026-10-23 - Product R4 dependency gate

Exact claude-opus-5-5/high, canonicalModel firstParty verified, independent session e0d88e64-79d2-4f5c-840f-c134dafb83a5. R4 blocks the0.42.0 release after a fresh HIGH Zod advisory; accounts object schema is unaffected, but existing authenticated run arrays and project audit gate require a fixed main API. Requires preserving explicit-only overrides under v4 defaults, bounded arrays, Plaud contract compatibility, all tests/builds/audits and focused review. No risk exception or legacy-v3 import workaround. Strict schema2 capture accepted without warnings; manifest88051dd7a134eca0882f21e27541fa3503dff0aeb3ef15a89c040e522ed7bc5b; hook outcome unknown with zero recorded errors. Full private native evidence retained.

## 2026-10-23 - Identity publication prerequisite (R3)

Exact same independent product reviewer e0d88e64-79d2-4f5c-840f-c134dafb83a5,
claude-opus-5-5/high with canonical firstParty metadata verified, returned
SOURCE_GO for identity publication followed by the unchanged feature after a
real build matrix PASS. Required intermediate coherence: package/markers agree,
DocKit/version/naming/idea/workspace checks pass on the exact tree. The precommit
hook treats ForgeOS JSON as versioned configuration, so this identity-only
release is 0.41.4; full reviewed account functionality remains 0.42.0.
The already reviewed version-marker and exact-authority filename checks are
included because the old checkers misclassify these identity documents.
No application runtime behavior changes. Source tools match published trusted
ForgeOS f754766d, also pinned by the owner gate. Protocol guidance is CURRENT.
R3 strict native capture accepted without warnings; manifest
c24774498fb9f4aae13986fbeea164f5ed497ba65f3cd4367468ff05a2ad6004.
Hook outcome unknown, zero recorded errors. Identity f7aedf1 passed its exact source checks and was published. The subsequent
actual build matrix is PASS with CURRENT guidance, owner70e25b1e. Restored
functional source matches all 45 R2 file hashes; retained candidate stash is
preserved. Actual runtime/operator/consumer/Dossier acceptance remains pending.

## 2026-10-23 - STT account implementation 0.42.0

- Approved scope: Carlos's Go to the concrete proposal at 977ab9b, D-028.
  Parent Codex session 01a165c4-a385-73d1-8725-97abf11165ad.
- Exact claude-opus-5-5/high, canonical modelUsage and firstParty metadata
  verified for advisor bb9c480d-acc8-4342-83bf-105db27ab794 rounds 1/2 and
  independent reviewer e0d88e64-79d2-4f5c-840f-c134dafb83a5 rounds 1/2.
  CLI explicitly selects --model claude-opus-5-5 --effort high, plan permission,
  Read/Grep/Glob only, --no-chrome --print --output-format json. No substitution.
  Exact invocation, native transcript, prompt/result/stderr and file-hash packets
  remain private under the parent session's provider-accounts implementation evidence.
- Advisor consensus required dedicated proof secret, private admission pins,
  individual legacy import, atomic custody, matching-key recovery and existing
  access qualification; round 2 confirmed Go authority without another generic
  approval. It retained owner/Sentinel/consumer and actual access gates.
- Reviewer R1: CHANGES_REQUIRED for orphan pin reuse after rollback/pruning,
  unguarded optional credit lookup, final suite and deployment bootstrap docs.
  R2: SOURCE_GO after upsert-on-new-admission plus duplicate-preserving regression,
  pre-provider revocation guard, full 246/246 suite and exact UID/mode/secret/
  legacy-preserving rollback instructions. Two publication conditions (current
  continuation/check results and numeric spacing) are applied. Documentation
  receipts are the only post-review changes; source code hashes remain pinned.
- Additional corrections: child processes omit master/proof environment values;
  BFF checks proof/session-secret separation; AssemblyAI poll waits abort.
  Private table retention and the documented legacy-only CLI limitation remain.
- Backend and web production builds pass with Next 15.5.28; root/web npm audits
  report zero findings. Author and reviewer inspected actual component screenshots
  at mobile/desktop; synthetic API exercise passed at 390/768/1440 with no overflow
  or browser errors. Fixture selection readiness was corrected after R2 so a
  disabled selected account displays the real fail-closed warning. This isolated
  component proof is not deployed login/use/logout or physical-device acceptance.
- Strict native capture schema 2 accepted all four rounds without warnings:
  advisor R1 e71fcf6c349bda4ff3162ce53d646e08a6a6695fab8e2446bddc7ab9ebf04b97;
  advisor R2 6ffbe9aeef54797a0133af029b3f00179d218c107ef3010ca4d6b794ae0708b3;
  reviewer R1 c3e695f61b4f6761855333f28e0c0e498410a85980a690b7ad19702efae7cf2e;
  reviewer R2 3b88d94a1a4589d4f36be950683b37a179a35831483036194447f48566bf1348.
  --check-status reports hook outcome unknown, zero recorded errors; native
  capture is retained without inventing hook success.
- Owner plan published at 70e25b1e; integration plan regenerated from that
  authority. Build matrix first requires publication of the already reviewed
  Birth/auth contracts. The two pristine stale Protocol instruction files were
  updated exactly to published dba90811 templates; no project customization
  was overwritten. A bounded review covers this publication prerequisite.
- SOURCE_GO does not accept runtime or complete delivery. Owner published auth/
  Sentinel plan, private NAS backup/restore, bootstrap, immutable deployment,
  actual anonymous/stale/reauth/logout/edge tests, operator retrieval handoff,
  Portal/Dossier readers/history and consumer qualification remain required.
  Existing long-audio economic/report and M1-M3 gates are preserved; no paid STT.

## 2026-10-23 - Multi-account STT UI proposal

- Exact independent claude-opus-5-5/high, canonical modelUsage verified; resumed
  session b46816ed-9070-4040-bc23-51c68e537fdb, parent Codex session
  01a165c4-a385-73d1-8725-97abf11165ad, cumulative rounds 4 and 5.
- Read-only command: claude --model claude-opus-5-5 --effort high
  --permission-mode plan --tools Read,Grep,Glob --allowedTools Read,Grep,Glob
  --no-chrome --resume <session> --print --output-format json. Raw invocation,
  native conversation, prompts/results and screenshots remain private.
- Source baseline 573cfee5e92dabc07692e890a2d3e8f0c9622fbd; final candidate tree
  d4a11eca1fca03a84340766943eb8e7c6ee25390 (includes permitted mechanical receipts).
- Actual executor UI readback: existing authenticated Settings, 1440px desktop
  and 390px mobile, login HTTP200, API-key panel informational, zero secret
  inputs/add-account controls, then logout. Reviewer inspected the mobile
  screenshot and primary code. This proves existing UI state, not delivery of
  the proposed feature or operator acceptance on a physical device.
- Round 4: conditional consensus. Agreed on simple account form, provider/account/
  key separation, explicit account selection, encrypted mutable storage, access
  probes without spend, source-precedence repair and truthful provider copy.
- Round 5: CONSENSUS_GO and SOURCE_GO for documentation only, no blockers.
  Reconciled private storage outside output/_jobs rather than the current jobs
  database; recent reauthentication window rather than a password for every
  new key; no login-provider migration. Account selection fails closed, does
  not silently fall back to legacy or another account, and covers Plaud intake.
- Strict schema-2 capture accepted both rounds with native parent evidence.
  Round4 manifest: 844c1a9d9f6163ee32bec471c925047e3194e7c704091889084a3b9625b46c93.
  Round5 manifest: 16d272db1a43cea1767712d7acc4d6df968bbd652461a52de404e7d08233f3e6.
  Manual capture verified; hook status unknown, zero recorded errors here.
- Review allowed mechanical task, validation and publication receipts. The
  explicit-baseline idea guard initially rejected a changed IDEA-0005 origin;
  its exact original origin was restored. The new attributed clarification
  remains in B004, the proposal and documentation_refs, without erasing history.
  IDEA-0008 records the agent design, not a duplicate operator request.
- Portable task record copied exactly from installed task-workspace status;
  existing curated WORK_INDEX annotations and all older records preserved.
  Parent verification follows publication. Checks: explicit-baseline idea guard,
  workspace schema, naming, version metadata, 13-file version manifest and diff.
  Runtime tests/build are not required for documentation-only work. Existing
  critical Next.js dependency CI/release gate remains open and unchanged.
- Dossier no_change accepted: proposal only, no accepted architecture, milestone
  or priority. Earlier audio preparation, long-recording budget and M1-M3 gates
  remain open; implementation/deployment/spend are not inferred.

## 2026-10-23 - STT accounts and provider-aware audio audit

- Independent read-only advisor/reviewer: exact claude-opus-5-5, high effort;
  actual modelUsage canonicalModel verified in all three rounds. Session:
  b46816ed-9070-4040-bc23-51c68e537fdb. Parent Codex session:
  01a165c4-a385-73d1-8725-97abf11165ad.
- Invocation: claude --model claude-opus-5-5 --effort high
  --permission-mode plan --tools Read,Grep,Glob --allowedTools Read,Grep,Glob
  --no-chrome --print --output-format json; initial --session-id, subsequent
  --resume of the same native session. Raw prompt/result/invocation/native
  transcripts remain in private custody, never in Git or Dossier.
- Baseline commit: 9df9de1a097c7139aaecf4c981e0abf2fdcf8e16.
  Reviewed initial candidate tree: b4d7c4a3bc4b54085c0ed777bacfaddcdfcfa92d.
  Reviewed final candidate tree: 925ebf11efab970cd8585b365aa1caf4111d346c.
  These are tree objects, not release commits. Subsequent mechanical review,
  work/export, validation and publication receipts were explicitly permitted.
- Round 1: conditional consensus. Executor corrected the claim that the long
  file fit every adapter (OpenAI does not), distinguished upload/processing
  limits, confirmed blank-primary OpenAI masking plus independent key rejection,
  and separated pure planning from actual local file preparation.
- Round 2: CONSENSUS_GO, documentary CHANGES_REQUIRED. R1 remote access and
  deployment wording, R3 overlap/credit/language findings and R4 recall triggers
  were corrected. R2 was reconciled: preserve M1, but answer Carlos's current
  balance request instead of redirecting him to a device test. Cross-config
  equality does not imply distinct credit reserves.
- Round 3: CONSENSUS_GO and SOURCE_GO for documentation only, no open blockers.
  R5 mechanical receipts follow here and in work/idea indexes. Design remains
  proposed; no runtime, credential, budget, contract or spending authority.
- Strict schema-2 captures accepted all three rounds with native parent and
  actual-model provenance. Manifest hashes by round:
  1: 7af556d8598d70dde525acf505b56929bcf2da520a7e5c9bd283d114098cccdb;
  2: eb399516f80c6bbffa84a37ee815d6174efe679afd76d847f5f0318d3c02611c;
  3: 5ca80631733939e0a3f35be4938ecf84647a7e10ecbde93e600ed409e5ab3c56.
  Manual capture is verified; hook status remains unknown with zero recorded
  errors at this capture root. An earlier incorrectly formed status invocation
  was rejected and retained; it was not a review rejection or lost evidence.
- Validation: explicit-baseline idea continuity, workspace schema, naming,
  version metadata, 13-file version manifest and diff checks pass. All seven
  API/generated/contract files compared byte-identical to baseline. No runtime
  tests/build were required for documentation-only changes. The normal session
  check passes with its existing long-HANDOFF advisory and implicit-baseline
  idea warning; the explicit-baseline idea check separately passes without
  warnings. Initial isolated version check lacked yaml; the byte-identical
  primary script with existing dependencies validated the candidate cwd.
- Task closeout: the installed bulk export refused the existing curated index.
  Preserved every earlier record/index annotation and added only the exact new
  host-ledger record plus its index/reconciliation entry. Parent verification
  against fetched publication follows; no checkout or history was removed.
- Dossier: no_change accepted by reviewer; no accepted policy, milestone or
  roadmap change. Existing M2 failure/economic feedback remains open. The last
  local L2 export was checked; current reader access was not asserted.


- Publication readback: origin/main contains 172f878; installed task-workspace
  verify-parent confirms all six exact records. Clean primary fast-forwarded.
  Idea continuity CI39935749137 passes. General CI39935749214 fails on
  existing Next.js dependency advisories GHSA-2464-fhr4-w9xw and
  GHSA-p3m5-59mp-jv5r; web/package-lock.json is unchanged from 9df9de1
  (SHA-256 3f2f4a9185d8ec37edd4ec5c2627d1ad9880682583e9f90b78e0631bef58ddc3).
  Later test/build/contract steps were skipped. No production exploitability
  claim, dependency correction or application deployment is inferred.

## 2026-10-01 - M0 operator acceptance receipt

- Exact independent reviewer: `claude-opus-5-5`; high effort requested; returned modelUsage/canonicalModel verified. Read-only session `151ff611-275b-4ad9-bf7e-68e03cca6e7a`, prior complete owner onboarding retained, bounded primary receipt/diff review.
- Command: `claude -p --resume 151ff611-275b-4ad9-bf7e-68e03cca6e7a --model claude-opus-5-5 --effort high --restricted --tools Read,Glob,Grep --allowedTools Read,Glob,Grep --permission-mode dontAsk --strict-mcp-config --mcp-config '{"mcpServers":{}}' --max-turns 8 --add-dir /home/cdelalama/src --add-dir /home/cdelalama/.local/state/plaud-mirror/m0-acceptance-20261001 --output-format json`.
- Verdict: SOURCE_GO after C1 explicitly preserves Carlos's approval of one recording and its cost. Corrected the guide to quote Carlos's real answer separately from the test criterion, and reconciled current focus/Trace. Final document/version/whitespace checks required before commit; the reviewer allowed these conditions and receipt metadata without another round.
- Native caller-side capture SHA256 `a6afc44ffcdbb695de1e30f6320e74277ff82a027c679f090d6397bf7caa2c87`, copy equality verified. Private packet contains baseline commits, exact reviewed patches, prompts and result; no transcript contents are in Git.
- Scope: records explicit M0 user acceptance on both devices, not an independently observed device test. M1 processing, Dossier S7 and runtime/expense changes remain outside this receipt. No product-code tests repeated for this documentation-only acceptance record.

## 2026-10-01 - Shared operator clarity and roadmap continuity

- Advisor: exact `claude-opus-5-5`, high effort, session `aee91cc8-92ab-44df-9fff-649a6c56df80`; canonicalModel verified. Native capture SHA256 `442c06282448f710a81721e79cc44ae6a8865c698a66135f40bed4d5341b8cce`.
- Independent reviewer: exact `claude-opus-5-5`, high effort, session `151ff611-275b-4ad9-bf7e-68e03cca6e7a`; canonicalModel verified. Earlier rounds had partial onboarding and remain advisory; the final round received all 22 ordered onboarding files for DocKit, ForgeOS and Portal in full and rechecked current Plaud/Media2Text/Home Infra context loaded earlier. Native final capture SHA256 `5158d1be34f5520ba5b5f5875880d916630cc1c85b97da5176fb06ac9e0fdc80`.
- Verdict: SOURCE_GO and CURATION_GO after R1-R5 (template neutrality, logical folder names, honest blocker/installation step, history format, source/date markers), K1-K2 (heading integrity and final build) and V-09 (authorised visual deviation). The missing Home Infra validator subsequently passed. The reviewer explicitly authorised these bounded documentary conditions and delivery/version/source-pin receipts without another round.
- Validation: all six owner session/version/work checks pass; final Portal suite 195/195, typecheck and client/server build pass. Existing oversized-handoff warnings remain advisory. Tests/logs were executor evidence, not independently rerun by Opus.
- Boundary: source and curation approval; production/browser delivery requires its own receipt. No actual-device M0 acceptance, independent recovery, original-golden replacement or unrelated Portal integration closure is claimed. Captures and private inputs remain outside Git.
# Reviews

## 2026-09-30 - M0 independent source review and final checks

- Auditor: exact claude-opus-5-5, high effort; actual modelUsage verified in
  each round. Read-only session 151ff611-275b-4ad9-bf7e-68e03cca6e7a; full
  Media2Text onboarding loaded before review. No writes, network or delegation.
- Command: claude -p --resume <session> --model claude-opus-5-5 --effort high
  --restricted --tools Read,Glob,Grep --allowedTools Read,Glob,Grep
  --permission-mode dontAsk --strict-mcp-config --mcp-config <empty>
  --max-turns 32 (follow-up 16) --output-format json, with candidate roots and
  private evidence packet explicitly admitted.
- First reviewed Media2Text tree: 0c92c4a04434afc9371c886c6b2d99f12dfa946a.
  Plaud tree: 43a6a7c2e4f5253d1b89652a9a7613ec98ef1cca.
  Follow-up Media2Text tree: c92ba70d7a07798b4038595c8100c88e22417311.
- Conditional GO: R1 corrects HANDOFF date/source meaning and removes obsolete
  version-number reservation. R2 makes markup escaping contextual so ordinary
  e-mail, decimals, percentages, COVID-19 and a=b remain searchable. Both exact
  fixes are applied; the auditor explicitly requires no new full round after
  their specified byte/test checks and C1. Plaud's mechanical 0.16.9 documentation
  bump resolves the version-policy observation; runtime remains unchanged.
- C1 PASS: 228 tests (18 exporter cases); engine and web builds; API contract;
  version/naming/manifest/session checks; both dependency installs and audits
  (zero findings); Plaud session/prose checks; diff checks. First test attempt
  lacked the isolated worktree's web dependencies; rerun used its own locked
  dependencies. An accidental nested storage-admission wrapper was stopped;
  the canonical single-wrapper build passed. Neither is hidden runtime evidence.
- Compatible dependency locks are included; NAS security remediation remains a
  separately scoped runtime upgrade, not an effect of source publication.
- Actual HTTPS checks at 1440/390 render every paragraph of one eligible Plaud
  record identically to its canonical payload; anonymous access is 401. Private
  export has 75 notes, one excluded record, repeated identical bytes and fresh
  regeneration matching all 76 file hashes. The NAS ZIP readback is byte-identical.
  These executor checks do not constitute physical-device acceptance.
- Complete native session capture source/copy SHA-256 after source round 1:
  4419b5fb36f9d26f287d26611c2e22536793cec533cc237af1f531b0c4033f7c.
  After follow-up:
  8e1ea4469f5f47dcaff0935dd6db9ee39009f1b51ba125b1c292cdd741f48d14.
  Raw commands, results, patches, test logs and hash-verified captures remain in
  private M0 custody outside Git. No transcripts or credentials are committed.
- Allowed follow-through: record validation/review metadata, close retained
  preparation tasks and publish source. Device transfer, actual reading/search,
  deployment, spend, replay and automatic synchronization remain separate.


## 2026-09-30 - Desktop/mobile M0 advisory

Exact claude-opus-5-5, high effort, canonical modelUsage verified. Session
 aee91cc8-92ab-44df-9fff-649a6c56df80 resumed the September 29 consensus.
Command: claude -p --resume <session> --model claude-opus-5-5 --effort high
--restricted --permission-mode plan --tools Read,Glob,Grep
--allowedTools Read,Glob,Grep --strict-mcp-config --mcp-config <empty>
--max-turns 12 --output-format json, with both owner roots admitted.
Verdict: prefer offline Media2Text-owned Markdown export; existing web is only
interim browsing. Executor retains separate admission comparison (internal
record self-consistency alone cannot detect every derivative mismatch), does
not require destructive device recovery, and treats transfer/device acceptance
as open. Raw prompt/result and exact command remain in private M0 custody.
Caller copied the complete native transcript after the restricted round;
source/copy SHA-256: 99bc7788b5c103245710c49273e5b77df50cd167c81fb69dafa295cf64781149.
Advice is not independent source approval or runtime/device acceptance.


## 2026-09-23 - DocKit fleet source update

Review: exact claude-opus-5-5, requested high effort, read-only Read/Glob/Grep.
Session: e06df549-3d43-4283-90a3-4f1833f7af04; modelUsage verified.
Command selected --model claude-opus-5-5 --effort high --restricted
--permission-mode dontAsk --tools Read,Glob,Grep --allowedTools Read,Glob,Grep
--strict-mcp-config --mcp-config empty; resumed the same session for findings.
Reviewed candidate tree (non-commit object): c683fb0cb8bd2ef3010699e4d51dd1dad56b6ac1.
Status: SOURCE/ROLLOUT GO after three same-session rounds. Publication is source-only.
Validation: project version/session checks pass; identical delivery helpers use
the central 84-case suite; DocKit source validator suite passes 96 cases.
Evidence is executor-supplied. Receipt-only metadata does not change delivery
inputs. See LLM-DocKit/docs/FLEET_ROLLOUT_2026-09-23.md for final verdict,
publication and project-specific exceptions. No runtime authority is added.


Keep this file ASCII-only to avoid Windows encoding issues.

## 2025-12-14 - Claude - Phase 1 Web UI Review

### What GPT did well
- Next.js 14 App Router with RSC: pages fetch on server, minimal client JS.
- `output: "standalone"` in next.config.mjs: optimized Docker bundle.
- Minimal deps: only next, react, react-dom (no UI framework bloat).
- Clean separation: `lib/api.ts`, `lib/apiSchema.ts`, `app/` pages.
- CSS variables for theming, no heavy frameworks.
- Docker multi-stage uses `.next/standalone` output correctly.
- API extended with `/library/channels`, `/library/channels/:id/videos`, artifact streaming.
- Reuses `FileSystemStorageAdapter` - no path logic duplication.
- Excludes `_runs/` from channel listing (dirs starting with `_` are reserved).
- SSE client (`RunEvents.tsx`) uses `EventSource` correctly.

### Areas to improve (future iterations)
- Types duplicated: resolved via OpenAPI-generated types + `web/lib/apiSchema.ts` facade.
- No error handling in UI: resolved (global error boundary with actionable instructions).
- No form to create runs: resolved (`CreateRunForm` posts `POST /runs`).
- Mixed styling: resolved (no inline `style={{}}` in `web/app/*`).
- SSE no auto-reconnect: EventSource auto-reconnects, but UX could be improved (backoff/last-error display).

### Verdict
Good scaffold for Phase 1 "local-first admin". Functional, minimal, correct architecture. Issues are minor and fixable in later iterations.

## M1 reuse consensus - 2026-10-07

Exact `claude-opus-5-5`, effort high, separate advisory session
`c5e246c9-e348-435d-a928-149a8c614966`. Returned `modelUsage` and `canonicalModel` match in both rounds.
Read-only tools Read/Glob/Grep; no shell, network, write, MCP or subagents.
Command: `/home/cdelalama/.local/bin/claude -p --resume c5e246c9-e348-435d-a928-149a8c614966 --model claude-opus-5-5 --effort high --restricted --permission-mode dontAsk --tools Read,Glob,Grep --allowedTools Read,Glob,Grep --strict-mcp-config --mcp-config '{"mcpServers":{}}' --settings '{"disableAllHooks":true}' --output-format json --disable-slash-commands --max-turns 12` with approved source/evidence add-dir arguments.
Native caller capture SHA-256 b0be9a4f3de68d29d7f02a8eecc3a81f89c89817b1c34b2b02b0fbcf18c72608; copied byte-identically from the exact session. Raw evidence remains private.
CONSENSUS_GO with four required clarifications, applied: dated M1/M2 criteria
amendment; existing automatic spend remains live; disclose +28 completions and
+8 unclassified failures; separate internal rates from provider invoices.
Corrected advisor's multilingual/multichannel label against official Deepgram
pricing. No runtime upgrade for v1 reuse; future v2 needs collector support.
This consensus is not the independent audit or device acceptance.

## M1 preparation independent source and curation audit - 2026-10-07

Reviewer: exact `claude-opus-5-5`, high effort, independent read-only session
`f18e7ccb-059b-4869-8f3b-a79926259ddd`, separate from the advisory session.
Returned `modelUsage` and `canonicalModel` verified. Read/Glob/Grep only;
no shell, network, writes, MCP or subagents. Private note content was excluded.
Command: `/home/cdelalama/.local/bin/claude -p --session-id f18e7ccb-059b-4869-8f3b-a79926259ddd --model claude-opus-5-5 --effort high --restricted --permission-mode dontAsk --tools Read,Glob,Grep --allowedTools Read,Glob,Grep --strict-mcp-config --mcp-config '{"mcpServers":{}}' --settings '{"disableAllHooks":true}' --output-format json --disable-slash-commands --max-turns 35` with the named source and private-evidence add-dir arguments.
Reviewed Plaud `461a52e4ba619e7d7981bf946be6ec7d2707fe9c`
(tree `cff9a8d85515bda0e8c1b2a1bb35ea081e8c4edb`) and Media2Text
`6041ff8a1a6b45f6a93676bd8d760ebdc23516b2`
(tree `6d71a418f861791318fd74b7c178c7ed13380024`).
Native caller capture SHA-256 b8ccd3e128240ce721fb80a4cb2c0a24fb4815bb8bd7990935721e42a5d9c65a; copied byte-identically from the exact session.
Raw evidence remains private.

Verdict: REQUEST_CHANGES (R1 only) and CURATION_GO on the unchanged L8 draft.
R1 required a dated October 7 amendment to Media2Text's cross-project roadmap;
its history already claimed that update. The executor inspected the narrow diff
and confirmed it adds exactly the requested M1 reuse/acceptance, still-enabled
automatic path, retained M2 obligations and v1/v2 collector boundaries, preserving
the older dated record. This satisfies the auditor's explicitly permitted narrow
executor confirmation; conditional source-publication gate is cleared.
No new full source round is required. Plaud `461a52e` must remain reachable for
the two L8 source pins. Actual reader and delivery review remains a separate gate.

Advisory follow-through: device acceptance must explicitly include reading,
search and offline use on both computer and Android. Do not infer that from a
weaker confirmation. The already delivered ZIP remains byte-identical, 4,768
bytes, SHA-256 `fca5ff9cf50ebb86437ce0b0a75b80b7ad455cb8187ec6b381c8e687fed3c5e8`.
A5 pricing recollection was checked against the official prerecorded pricing
page: prerecorded diarization is included; streaming has a separate add-on.
Installed rates/caps remain unchanged. A2 wording, A3 dated older status blocks,
A4 indexes and A6 dated failure history are nonblocking follow-ups, not claims
of M1 acceptance. Receipt-only closure may proceed without recursive snapshots.

### M1 actual reader/delivery and narrow CI repair review - 2026-10-07

Same independent `claude-opus-5-5`/high session resumed; exact returned
`modelUsage` and `canonicalModel` verified. Command is the source-audit command
above with `--resume` instead of `--session-id`, `--max-turns 20`, otherwise the
same read-only restriction and add-dir arguments. Native caller capture SHA-256
`77bf962fd431db7b7d8325979e083fe67f3c5e0a2d616106d5fee7c45e6942a7`, byte-identical to that exact session; raw transcript stays private.
Media narrow reviewed diff SHA-256
`1516db872932a040b84333ac48bbd31105918b12c5269c8194626cc2f4dce98f`.

R1 confirmed. SOURCE_GO for Media2Text 0.41.1's sole existing source-map-js lock
entry change 1.2.1 -> 1.2.2 plus release metadata/docs, conditional on final CI
passing before reporting green. 228/228 local tests and web/engine builds pass;
quarantine integrity and two registry signatures verified. Runtime is unchanged.
The old yt-dlp upstream-watch failure remains separately declared.

RENDER_GO and DELIVERED_GO for M1 preparation only: actual Spanish Now/next-step
and M1-dialog screenshots inspected, exact L8/S8 and seven earlier records,
eight-record complete archive/restore, package and unchanged runtime identities.
Independent physical recovery and Carlos's M1 reading/search/offline acceptance
on both devices remain open. Receipt-only closeout is permitted without another
round/capture, including final CI, delivered-state prose and closed preparation
records. Changing the package, L8, dependency scope or runtime needs re-review.
Use the stronger acceptance wording in the final operator message; the existing
M1 dialog already states it. No weakening from the shorter next-step phrase.
The audit's phrase "8 + 80 failures" is not a new count: current total is 80,
including 8 added since September 29, with 622 unsent separately.

Final condition satisfied: Media2Text CI 37612260162 on `41c73eea7000fce7b48d6e4fd51271aee7a7f702` passed.
No runtime deployment. The package was freshly read back at 11:08:33 UTC and
still matches the reviewed SHA-256/4,768 bytes. Actual-device acceptance remains open.

## Idea continuity - 2026-10-07

- Requested and actual model: claude-opus-5-5; high effort.
- Advisor session: 139ec679-ca1a-4e18-824a-a16dfcda41b1, rounds 1-2.
- Verdict: CONSENSUS_GO with explicit implementation conditions; advisory only.
- Evidence: caller-side prompt/argv/result/stderr/native SHA256 and immutable
  parent/round capture under private continuity implementation state.
- Reconciled conditions: native versus authoritative references; no index
  priority; explicit publication baseline; historical and newly closed task
  distinction; pinned helper; strict exact-session capture; scoped recovery.
- Independent source reviewer: 3677ad88-e970-484d-aafb-648aeca229e5,
  rounds 1-2, actual claude-opus-5-5 canonical metadata/high effort verified.
- Round1 withheld SOURCE_GO for malformed hook JSON, committed-index deletion
  with a dirty tree, historical-only authority references and final test evidence.
  All were corrected with regressions; nonblocking continuity/capture findings
  were also incorporated. Round2 returned SOURCE_GO.
- Prepublication conditions met: validation-02.json records zero-exit explicit
  original-baseline checks with the full project map for all eight adopters;
  final capture fixture archive dev-stage-t7ze66_6-1791384486936008847.tar.gz
  was read back on NAS and staging finalized. Exact helper SHA256 is pinned in
  each IDEA_INDEX; 16 idea, 14 capture and 96 existing validator tests pass.
- Native rounds and growing parent snapshots are immutably captured outside Git;
  legacy capture error history remains visible, not evidence of universal loss.
- Source acceptance does not constitute installed-host or Dossier delivery.
  Actual operator-view review and recovery receipts follow separately.


## 2026-10-07 - Idea continuity bounded delivery

Exact `claude-opus-5-5` with high effort, independent session
`3677ad88-e970-484d-aafb-648aeca229e5`, returned DELIVERY_GO on the actual
reader/recovery and closing receipt packet. Model metadata and native parent/round
artifacts are retained outside Git. The earlier advisor/consensus session was
`139ec679-ca1a-4e18-824a-a16dfcda41b1`. All four shared histories and local Forge L6
were restored and compared; fifty desktop/mobile section checks passed.
Remaining history, same-hardware recovery limits, source-only legacy integrations,
Portal dependency audit and ForgeOS transport/backup limits stay explicit.
Final receipts change no application code, priority, source allowlist or admission.
