# STT account administration implementation - 2026-10-23

State: account source 0.42.0 published; corrected 0.42.1 qualified for publication.
Product runtime remains 0.39.3 until actual guarded deployment. Baseline: 977ab9b84685edce796303d477c1f68b9c91a7c7 (0.41.3).
Carlos approved the exact account UI proposal with Go. The attributed scope is
in MEDIA2TEXT_ACCOUNT_ACCESS_AUTHORITY_2026-10-23.md. D-028 owns this increment.

## Operator outcome

The existing Settings screen gains Transcription accounts. Add an account using
provider, a recognizable alias and an API key. Saving does not select the account
or transcribe anything. Check access is optional and sends no audio. Then choose
Use for new transcriptions. Multiple accounts at one provider and different
providers are supported. The UI uses the existing language and responsive shell.

Balance remains Unknown. Access accepted means the provider accepted a read-only
authenticated request; it does not prove credit, account identity, model access
or transcription readiness. Aliases are operator labels. Multiple credentials
inside one account never imply separate credit reserves. Detailed billing and
automatic routing remain separate work.

Adding/renaming/disabling/selecting accounts and maintaining keys requires a
login within five minutes. A stale session opens an inline password confirmation;
after confirmation the operator repeats the action. Saved tokens are write-only,
shown with only their last four characters. No token goes to browser storage,
settings JSON, logs, run records, SSE, webhooks or transcript exports.

## Credential custody

The API opens a dedicated SQLite database in Y2T_CREDENTIALS_DIR, outside output
and audio trees. Directory mode 0700 and database 0600 are required; symlink paths
and overlap with exported paths are rejected. AES-256-GCM envelopes use random
IVs, version/provider/account/key AAD and separate HKDF-derived encryption and
duplicate-fingerprint keys. Y2T_CREDENTIAL_MASTER_KEY is a 64-hex bootstrap secret
in the existing private Doppler project/config. Never put its value in Git.
The web container does not receive the master or mount the private database.

Y2T_CREDENTIAL_ADMIN_PROOF_SECRET is a separate 64-hex secret shared only by web and
API. It must differ from every operator/intake/reader/profile/session/master
credential. The proof binds the exact body bytes, POST, fixed path, expiry and
random nonce. The API rejects replay and non-loopback peers even with forwarded
headers. Machine API keys alone cannot mutate provider accounts. The common
Doppler config remains a custody boundary: an authorized principal that can run
that config can retrieve its secrets. Per-container injection reduces exposure
but is not a separate Doppler access-control boundary.

Recovery requires BOTH a coherent private database and the exact master key.
For runtime backup, drain accepted work and stop the API writer, copy the private
directory with restrictive permissions into protected owner backup custody,
retain the existing master separately in its approved secret store, then restart.
Do not export this directory through audio/output synchronization. Restore only
into an absent isolated private path; verify permissions, account count, selected
mode and decryptability with synthetic credentials before replacing runtime.
Wrong-master and modified-ciphertext restoration fails closed. Losing or changing
the master without migration makes the database unreadable; master rotation is
not implemented. A same-NAS restore is logical recovery, not independent backup.
The production backup/restore receipt is still pending.

## Selection, rotation and intake

Each provider explicitly uses legacy environment credentials or a selected
registry account. Existing keys are read-only masked references. Import copies
exactly ONE chosen legacy key into ONE named account and never selects it.
Do not auto-import an environment pool as a single billing account. Registry
selection clears legacy pools in the effective provider config. An unavailable
selected account fails closed; no alternate account or legacy fallback occurs.

The existing provider selector and account selection work together. The account
action first selects the default for its provider, then saves that provider in
Settings. Partial failure is reported explicitly; accepted work remains pinned.
New URL, upload, scheduler and producer-intake jobs use live saved settings.
Accepted jobs pin the provider/account/immutable key version. Intake references
survive restarts in the private database; duplicate admission keeps its original
pin. Jobs accepted before registry deployment have no historic pin and retain
the existing execution behavior when first processed. Legacy mode pins provider
and in-process startup config, not an immutable externally managed secret across
a container recreation. Cached transcript reuse does not need a valid STT key.

Ordinary key rotation and disabling apply to new work. Existing work can finish
with its pinned version. Local emergency revocation blocks queued work, cancels
matching active runs, propagates aborts, and checks the version before every
provider request/retry/chunk. A provider may continue or charge already accepted
work; local revocation does not revoke the provider-side key. The UI says so and
requires a second explicit local-revocation action. Revoke externally at the
provider if the key was compromised. Never replay ambiguous submissions against
another account. Existing item/run/30-day economic gates remain unchanged.

The CLI keeps its existing environment/YAML workflow; account administration
and registry selection belong to the API/web service. A registry-only API may
start without legacy STT keys. That does not provision credentials for a separate
CLI process. Blank primary environment values now allow a nonempty legacy alias.
Settings source labels reflect the running API's persisted-settings precedence.

## Access probes and application access

Fixed read-only GET endpoints: Deepgram /v1/projects, OpenAI /v1/models,
AssemblyAI /v2/transcript?limit=1. Only status is classified; response bodies are
cancelled without parsing or retention. Redirects are refused; timeout 10 seconds;
six probes per minute. 401 means rejected, 403 insufficient verification
permission, transport/other status unavailable. None reports a billing balance.
AssemblyAI's documented transcript-list authentication check replaces the
undocumented /v2/account probe. No live STT request was used for verification.

Existing login/provider/topology are preserved under the exact owner disposition.
Stateless logout clears the current browser cookie but cannot revoke a copied
valid session. Admin writes expire five minutes after issuance, even when the
normal session remains valid longer. The actual NAS Y2T_WEB_AUTH_SESSION_HOURS was read as 12 on 2026-10-23.
Real login/use/logout acceptance remains before activation. This is not server-side session
revocation. Next.js is pinned 15.5.28 to address the release dependency finding.

## Acceptance and remaining gates

The full 246-test suite and backend build pass after independent review R1
corrections. Fifteen account tests cover encryption/restart/restore, private
paths, selection, lifecycle, role/proof/body denial, UTF-8, cache/intake and
rollback/readmission. The earlier 243-test run and web production build also
passed; the post-review web production rebuild also passes. No paid STT was submitted.

An isolated real React component with synthetic API passed 390/768/1440 widths,
no horizontal overflow or browser errors, add/save without selection, manual
selection, rename, five-minute reauthentication, rotation, two-step revocation
and disable. Author inspected mobile and desktop screenshots. This is not
actual deployed browser/authentication acceptance.

R1 changed private pin writes to upsert on new admission: the jobs database
alone owns duplicate detection, so an orphan selection after rollback/pruning
cannot override current settings. Duplicates still retain the accepted pin.
R2 guards the optional AssemblyAI credits call before provider access and outside
its warning fallback. Media child processes omit the new bootstrap secrets;
web rejects a proof secret equal to its session secret; AssemblyAI poll waits
react to cancellation. DEPLOY_PLAYBOOK now specifies UID/mode/ACL/bootstrap,
backup and legacy-preserving rollback. Edge requests arrive as loopback, so
route allowlisting plus operator key/proof remain part of the boundary.

Known limits: private audit/work-selection rows have no retention policy yet.
The CLI does not resolve registry keys; the shared loader can defer its missing
legacy-key failure until provider construction if registry environment variables
are present. This does not activate registry use from CLI. Existing legacy
failover remains separate. Exact independent source R2 returned SOURCE_GO, closing R1-R4. Owner publication,
Sentinel/Hermes installation, private NAS recovery, immutable deployment and
actual consumer/operator/Dossier readback remain execution work.

Sentinel will observe only current web/API availability, not successful speech
recognition, billing, login, transcript correctness or completed delivery.
The earlier adaptive audio preparation/report proposal, long-recording economic
block and M1/M2/M3 acceptance retain their separate scopes. This feature does
not raise limits or start transcription of the long recording.

Dossier assessment: refresh_required for accepted implementation and changed
next step. Curate only the admitted project status; retain private review,
credential, audio, account and runtime evidence outside shared publication.

## Dependency release gate correction - 2026-10-23

A fresh image build/audit observed the updated HIGH Zod advisory GHSA-mrhx-c7xc-m3w5, despite an earlier zero-audit result. Exact independent Opus product R4 blocks releasing0.42.0: the new credential object surface is unaffected, but existing authenticated run arrays are reachable and the project audit gate disallows the finding. No risk exception was invented. The API candidate was never deployed; its published source, complete logs, registry digest and native NAS recovery are retained.

Candidate0.42.1 pins the fixed main Zod4.6.7 API, updates the record key schema, bounds config.videoIds at5000 and rejects oversized nested run arrays before their element schema. Override sanitization retains only explicitly supplied non-undefined fields, preventing Zod4 partial defaults from replacing effective provider, paths or credential selection. Full248 tests, no-emit typecheck and backend build pass; seven focused default/array/environment/Plaud cases pass. Web production build also passes. Focused independent review receipt and publication remain before release. No provider call or account selection was performed.

Upstream evidence: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5 ; https://github.com/colinhacks/zod/pull/6652 ; https://zod.dev/v4/changelog .

## 0.42.1 release qualification

A newly published HIGH Zod advisory blocked 0.42.0 before product deployment.
Zod 4.6.7 passes 248 tests, seven focused cases, typecheck, backend/web builds,
API contract and zero-finding root/web audits. Exact Opus R5/R7 SOURCE_GO covers
the correction and deployment tooling. Six private tests and actual NAS Compose
5.1.1-qnap3 prove existing loopback overlay preservation, start/verification
failure restoration, digest input and source-provenance guards. Both images are
verified against registry content/config hashes and exact source/version labels.
A partial build, post-push digest mismatch or failed restoration is a manual
reconciliation gate; do not retry blindly. No failed candidate is deployed.
The API 0.42.0 candidate remains in registry/NAS custody with matching layers;
only its specifically reviewed disposable DEV artifacts were finalized.
Current Portal mobile/desktop readback correctly shows Media2Text monitored,
notifications disabled and the retained processing/delivery issues. This is
availability acceptance only, not proof of successful new transcriptions.
