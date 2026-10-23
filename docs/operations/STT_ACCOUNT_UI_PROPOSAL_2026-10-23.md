# Multiple STT accounts in the existing operator UI

Status: functional proposal, not implemented or selected architecture.
Baseline: `573cfee`, source 0.41.3. Carlos clarified on 2026-10-23 that he owns
multiple accounts at multiple providers and wants to add their tokens easily
inside the existing Media2Text interface. Editing Doppler is not the requested
operator workflow. This extends IDEA-0005 without replacing its earlier origin.

## What exists now

The executor authenticated to the existing canonical console and inspected
Settings at desktop and mobile widths. The API-key panel is informational,
labelled partial: no account list, add-key button or secret input exists.
The inspection ended with logout; no setting or provider credential changed.
Private screenshots/readback remain outside Git and Dossier.

- Reusable: Settings shell, authenticated web proxy, provider selector and
  AssemblyAI, Deepgram and OpenAI adapters.
- Partial: AssemblyAI/Deepgram environment key pools use generic round-robin
  and error failover; they do not model accounts, projects or shared balances.
- Missing: account/credential administration API, private encrypted mutable
  secret storage, provider/account selection, lifecycle audit and account-level
  balance evidence. Current settings explicitly accept only non-secret fields.
- Current copy incorrectly advertises unsupported adapter options and a stale
  Deepgram model. Effective-setting precedence also differs from the source
  attribution reported to the UI. Correct these before promising a default
  account that is actually used.
- D-024 selects encrypted runtime provisioning for producer connections. That
  store is not implemented here and is not an STT-account store. Its direction
  informs this proposal but does not establish approval or existing code.

Source anchors: `web/app/MediaConsole.tsx` (`renderSettings`),
`src/config/settings.ts`, `web/lib/apiProxy.ts`,
`src/transcription/factory.ts`, `src/transcription/loadBalancer.ts`,
`src/jobs/transcriptionProfile.ts` and D-024.

## Proposed operator flow

In Settings, provide **Transcription accounts** with **Add account** as the
primary action. The Spanish UI asks for three ordinary inputs: provider,
friendly account name, API key. Account/project details appear only when the
provider requires them; additional keys can be added to an existing account.

Example flow, not an existing feature:
`Ajustes > Cuentas de transcripcion > Anadir cuenta > Proveedor / Nombre / Clave`
followed by `Comprobar acceso`, `Guardar`, and `Usar para nuevas transcripciones`.
Saving must not silently select the account or start a transcription. An access
check must use a nonbillable supported endpoint; otherwise say verification is
unavailable. A successful access check does not prove credit or processing
readiness. Permit saving an unverified key with an explicit state.

List each account's provider, friendly name, selected/default state, key state,
and balance evidence or **Unknown**. Distinguish expired/rejected credentials
from missing billing permission. Permit renaming, adding/replacing a key,
disabling it and selecting an account. Full saved keys are never returned.
Account labels are operator aliases; do not infer a verified provider identity
from a label. Show a project only when it matters to billing or access.

Use the existing responsive navigation and controls. Mobile gets a single-column
form, visible action feedback and large touch targets, without forcing a wide
desktop table. Account details and key maintenance use progressive disclosure.

## Proposed backend and execution boundaries

- Model provider, account/billing project, credential version and processing
  profile separately. Multiple keys for the same billing scope share credit;
  changing a key must not create a fresh credit balance.
- Store credentials in a dedicated private encrypted runtime store outside
  output/transcript/export paths. The current coordination SQLite is beneath
  `output/_jobs`, so do not place secret ciphertext there merely because it
  already exists. Use dedicated private application state; jobs retain only
  opaque references and non-secret metadata. Keep the bootstrap encryption
  key in Doppler; use authenticated encryption and a keyed duplicate fingerprint.
  This adds a new custody/backup obligation and needs a reviewed restore test.
  Do not put secrets in `_settings.json`, logs, API reads or browser storage.
- Use authenticated, explicitly authorized administration endpoints with origin
  protection, bounded payloads, redacted errors and metadata-only auditing.
  Require recent operator reauthentication for secret writes, with a short
  freshness window so adding several accounts need not repeat the password for
  each row. Intake and downstream read credentials cannot administer accounts.
  Rate-limit access probes; never log their request bodies.
  The current login's suitability for new secret-management actions must be
  qualified against owner access policy before deployment. No login-provider
  migration or shared SSO is selected by this proposal.
- After the feature is deployed, UI changes should affect new work without a
  container recreation. Pin account and credential version for accepted work;
  define queued/in-flight rotation and disable semantics, including explicit
  emergency revocation rather than silently keeping a compromised key active.
  Disabling locally
  must not pretend to revoke the key at its provider.
- Import existing environment keys only through an explicit one-time migration
  with defined precedence. Avoid two competing live sources of credentials.
  Preserve existing working processing while validating the migration. Display
  unmigrated environment credentials as read-only legacy account references.
  Select one explicit source mode per provider: legacy, or a registry default.
  An invalid/disabled registry default must stop; it must not silently fall back
  to another account or a legacy key. Correct source attribution to match the
  effective precedence.
- Start with manual account/default selection. Do not reuse generic failover
  across accounts after an ambiguous submission: it can duplicate billable
  work. Record the chosen account privately with the attempt and enforce the
  existing item/run/global economic limits.
- Balance evidence is optional, dated, scoped and typed. API-reported credit,
  an operator-entered observation, and local estimated consumption are distinct.
  Providers without an available balance API remain usable with **Unknown**;
  adding the account must not wait on a universal billing integration.

## Delivery proposal and acceptance

Deliver a coherent first feature: encrypted account/credential storage plus
authenticated UI/API administration and explicit default selection for new work.
Once Carlos selects this scope, the agent owns implementation, tests,
deployment preparation and migration.
Detailed balances, automatic account routing and adaptive audio preparation
remain separately bounded additions; the earlier audio/report proposal stays
open and is not a prerequisite to adding accounts.

Acceptance should demonstrate adding two accounts for the same provider and
one for another provider, saving/reloading, retaining them after restart,
rejecting unauthorized access, masking saved secrets, replacing/disabling a
key with truthful state, and resolving the selected account for each supported
entry path (including Plaud intakes). Fake-provider tests can prove selection
without spending credit; any live transcription retains its existing scope and
economic gates. A UI-only form is not complete delivery.

This is a moderate feature spanning frontend, API, storage and worker selection,
not a cosmetic field addition or a new standalone service. Existing Next.js
dependency findings remain an application release gate. No estimate of elapsed
implementation time or percentage complete is established by this audit.

## Continuity and Dossier assessment

IDEA-0005 retains the clarified operator request; IDEA-0008 records this proposed
runtime account/credential design. Neither is marked implemented. The existing
long-recording budget block, M1 acceptance, M2 reliability and M3 remain open;
this proposal does not choose their priority or increase a budget.

Dossier: `no_change`, accepted by the independent reviewer for this bounded
clarification/design record.
No accepted architecture, runtime capability, product milestone or roadmap
priority changes. Reassess when the operator selects implementation scope.
Exact Opus consensus/reconciliation and source review belong in `REVIEWS.md`.
