# STT accounts and long-audio audit

Observed: 2026-10-23. Source baseline: `9df9de1` (0.41.3); observed NAS
application: 0.39.3. Status: read-only audit and proposed design. No runtime,
credential, budget, provider, replay or contract change is implemented here.

## Request and disposition

Carlos requested an account/credit inventory, remote credential-management
instructions, inspection of the existing provider interfaces, and Opus consensus
on provider-aware splitting with a report. This captures the request as
IDEA-0005 and the bounded design as IDEA-0006. Both remain proposed, not accepted
architecture. Existing D-020/D-022/D-026, M1 acceptance, M2 reliability, M3 and
bilateral connection priorities remain authoritative and unchanged.

The existing transcription request remains open for the long recording. The
original attempt stopped at a local economic gate before any provider call.
Other completed results were exported separately in private custody. Neither
this audit nor that export establishes acceptance of M1 or daily reliability.

## Credential custody and account structure

- Doppler project `youtube2text`, production config `prd`, in the established
  primary workspace, owns the STT secrets. The environment names `dev`,
  `dev_personal`, `stg` and `prd` are configurations, not provider accounts.
  A cross-config comparison found identical STT credentials in `dev`,
  `dev_personal` and `prd`; `stg` has none of the inspected STT key names.
  These environments therefore do not provide separate reserves of credits.
- Single-key names: `ASSEMBLYAI_API_KEY`, `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`.
  Supported pools: `Y2T_ASSEMBLYAI_API_KEYS`, `Y2T_DEEPGRAM_API_KEYS`, as CSV.
  No pools are presently populated. OpenAI has no pool adapter.
- Provider billing accounts/projects are separate from Doppler login/workspace.
  Their ownership must not be inferred from the Doppler identity. A key is an
  access credential; another key in the same billing scope is not new credit.
- Production bootstrap uses a restricted `.env` holding the Doppler service
  token, then `deploy/nas/start.sh` downloads a mode-restricted temporary
  `.env.doppler`, supplies container environment variables and removes the
  temporary file. STT values matched Doppler in the read-only comparison.
  They still exist in the running container environment, accessible to the
  infrastructure administrator. They do not belong in Git, reports or chats.
- The Settings API excludes secrets. A Doppler edit is not a live application
  update: the owner deployment path must recreate the containers and verify
  the resulting configuration. Never instruct an operator to use bare Compose
  in place of the documented startup/reconciliation path.

Cloud dashboards can be reached while traveling; they require the operator's
own authenticated session. No authenticated provider session was available to
this executor. Home-only application access retains its existing remote-access
route. An operator can prepare a credential in Doppler without being at home;
the agent owns the subsequent deployment work once that scope is selected.

## Balance observations and a configuration fault

| Provider | Observed access | Balance conclusion |
| --- | --- | --- |
| Deepgram | One effective key; project listing succeeds; project balances returns 403 | Unknown, not zero. Current key cannot read the balance. |
| AssemblyAI | One effective key; account endpoint returns 200 with an empty object | Unknown. No numeric credit evidence was returned. |
| OpenAI | Stored key returns 401 for models and organization costs | Unknown. Stored credential is not usable in these checks. |

The current OpenAI path also has an independent configuration fault:
`Y2T_OPENAI_API_KEY` is defined but empty by Compose. `getEnv()` prefers a
defined primary name, even when empty, so it masks the nonempty legacy
`OPENAI_API_KEY`; subsequent filtering removes the value. The effective
`openaiApiKey` is absent. Supplying a valid key under the correct effective name
and fixing blank-alias fallback are separate remedies; neither was applied.

The local usage ledger is an estimate against internal caps. It is not vendor
credit, cash billing, an invoice or a grant of free usage. It has no normalized
account/project/credit model. AssemblyAI's best-effort credit reader also treats
an untyped `credit_balance` number as minutes, an unsafe unit assumption.
No balance or account identity should be invented from these observations.

Official account references checked during the audit:
- Deepgram credits attach to the first project, rather than each API key:
  <https://developers.deepgram.com/guides/deep-dives/using-multiple-projects>.
- AssemblyAI workspace/project/key and billing management:
  <https://www.assemblyai.com/docs/account-management>.
- OpenAI's documented organization Costs API uses an Admin key and reports
  costs, not a proven remaining-credit balance:
  <https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs>.
  This audit adds no administrative credentials to transcription containers.

## Existing interfaces and actual limits

`src/transcription/provider.ts` exposes only `maxAudioBytes` and diarization.
It lacks duration, upload-versus-transcription endpoint, format/channel limits,
processing deadlines, account identity and the provenance/date of each limit.
The existing splitter in `src/utils/audio.ts` is invoked by
`src/pipeline/run.ts` when the effective byte ceiling is exceeded. It uses
ffprobe, estimated bytes per second, FFmpeg stream-copy and overlap; it then
checks actual piece sizes. It does not split according to a duration ceiling.

| Adapter | Declared in current code | Official evidence checked 2026-10-23 |
| --- | --- | --- |
| AssemblyAI | 5 GiB | Transcription: 5 GB / 10 h. Upload endpoint: 2.2 GB. Our adapter uploads first, so its current declaration is too permissive. |
| Deepgram | 2 GiB | Documented maximum: 2 GB. Nova processing deadline: 10 min; Whisper: 20 min. These are processing timeouts, not audio-duration limits. |
| OpenAI Whisper | 25 MiB | Documented upload maximum: 25 MB. The existing adapter uses `whisper-1`; changing models needs a compatibility decision. |

Official pages:
- <https://www.assemblyai.com/docs/faq/are-there-any-limits-on-file-size-or-file-duration-for-files-submitted-to-the-api>
- <https://developers.deepgram.com/docs/pre-recorded-audio>
- <https://developers.openai.com/api/docs/guides/speech-to-text>

Do not treat decimal MB/GB and binary MiB/GiB as identical at the boundary.
No numerical maximum audio duration was established for Deepgram from that
page. A missing limit is unknown, not unlimited. The selected long MP3 fits
AssemblyAI's upload and duration limits and Deepgram's documented byte limit;
it exceeds OpenAI's file limit. Its existing failure was an internal item cap.
Deepgram's local 120-second HTTP timeout is a separate feasibility concern.

## Reliability findings to resolve before paid split execution

1. **Merge provenance:** `merge.ts` invents a `merged-*` id and drops provider
   metadata. `transcripts/store.ts` can mistake it for a provider-issued id.
   Preserve per-piece ids/model evidence in a private manifest and represent
   the aggregate truthfully within the frozen contract's existing fields.
2. **Boundary text and speakers:** overlap trimming adjusts utterance timing
   without trimming text that crosses the boundary. A synthetic runtime test
   retained the same boundary phrase twice. There is also a distinct geometry
   defect: noninitial chunks extend on both sides, while merge trims only the
   leading overlap. With three or more pieces, trailing overlap survives from
   the preceding piece and can duplicate the next boundary even for utterances
   entirely inside it. Piece-local speaker numbers are
   also copied as if they were globally consistent. The plain-text fallback
   lacks deduplication and mixed text/utterance results can lose content.
3. **Paid progress:** successful pieces live in memory; a later error discards
   them. Retry can pay for prior successful work again. A poll timeout can also
   leave a paid AssemblyAI job without a durable recovery reference.
4. **Key failover:** `loadBalancer.ts` moves to another key after generic
   errors, including ambiguous failures after a billable submission. It is
   round-robin/error failover, not balance-aware routing. Pools are empty now,
   but adding keys would activate this behavior. Credit errors and account
   boundaries need explicit handling before recommending automatic pools.
   Deepgram HTTP errors are generic errors, never `InsufficientCreditsError`;
   its credit exhaustion cannot activate the pipeline's corresponding stop-all
   branch. This is a source finding, not an observed exhausted balance.
5. **Local preparation:** stream-copy cut points are approximate. Measured
   output, robust cleanup on intermediate failure, and truthful offsets are
   needed. The current source cap groups intakes as `uploads`, and rate
   estimates omit model/features/account distinctions. The merge retains only
   the first piece's language; manual language provenance can be labelled
   `yt-dlp` even when that was not its source.

Useful behavior to retain: atomic batch reservations, original-item duration
checks despite splitting, potentially billable failures kept in the ledger,
failed intakes remaining terminal, and immutable source/result identities.

## Proposed implementation inside Media2Text

Extend the existing shared preparation path; no separately deployed service is
justified by this audit. Prefer a whole file when the selected profile's
technical constraints and economic policy permit it. Splitting is conditional,
not a way to evade the original-item cap or an automatic choice for long audio.

1. A secret-free provider/model/endpoint profile declares technical limits,
   deadline, credential reference, account alias and dated evidence. Credit
   evidence has amount, currency/unit, scope, observation time and confidence;
   missing data is explicitly unknown.
2. A pure planner calculates provisional pieces, billable overlap and economic
   decisions. A separate local preparation step produces and measures files;
   the final plan is frozen only after actual sizes/durations are checked.
   Neither step calls a transcription provider. Keep the original file.
3. Fix one provider/model/account per item. Automatic cross-provider or
   cross-account continuation is not part of the proposal. Ambiguous
   post-submission failure blocks blind resend until reconciliation.
4. Persist piece attempts and successful private results. Resume only exact
   compatible pieces, preserving plan/input hashes and provider evidence.
   Merge with explicit overlap treatment and chunk-scoped speakers unless a
   real reconciliation method establishes speaker identity.
5. Produce a Spanish pre-send report with whole-file/piece choice, limits,
   measured durations/bytes, estimated cost, credit certainty and every block.
   Produce a result report with completed/failed/unknown pieces, attempts,
   provider references, partial recovery, empty-text flags and merge limitations.
   Keep private media metadata and ids in private custody, outside this report.

Opus additionally proposed a narrowly scoped per-item budget exception rather
than a global cap increase. This is an unaccepted policy idea, not an existing
feature, and is not required merely to report the present block. Any exception
design needs explicit owner disposition and independent review. Do not replay
the terminal original intake or change its idempotency identity implicitly.

## Validation and next gate

Read-only evidence: effective runtime settings/capabilities/ledger, credential
presence and equality, provider account responses, browser authentication
availability, official limits, and a synthetic boundary-merge reproduction.
No audio was sent to a provider and no billable transcription was requested.
The private audit packet retains actual recording/budget/account observations.

Before implementation: obtain a scoped owner decision on the proposal. Before
execution: confirm usable account credit and a reviewed plan that satisfies
the real limits. Suggested tests cover three-piece boundaries, mixed output,
speaker/provenance truth, byte/duration thresholds, zero-provider-call planning,
atomic budget accounting, durable partial recovery and ambiguous-send failover.
Deployment and paid execution retain existing gates; no extra canary spend is
implicitly authorized by this report.

Dossier assessment: `no_change`. This is a bounded audit and unaccepted design,
not a new accepted milestone, policy or roadmap priority. The curated status
already keeps economic feedback, failure recovery and daily reliability open.
No private audit details are admitted to its existing single-source allowlist.
A later accepted design or implementation requires a fresh assessment.

Independent exact Opus 5.5/high advice is retained privately with native
parent/session/round evidence; see `docs/llm/REVIEWS.md` for the reconciled verdict.
