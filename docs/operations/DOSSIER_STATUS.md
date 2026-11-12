# Media2Text curated project status

Observed: 2026-11-12. This is the sole source admitted to the dedicated technical
Dossier. It contains no media content, personal titles, raw conversations or
credentials. Engineering documentation remains English; the operator reader is
curated in Spanish. It is a project status, not a complete operational archive.

## Current automatic-failover increment (2026-11-12)

Media2Text 0.43.5 is installed on the NAS since November 12 (20:40 UTC), from
source 6bab5a2, which is the reviewed 0.43.5 code. The previous version was
0.42.2 and can be restored.

What Carlos can use now: everything he had, plus, in Settings > Cuentas de
transcripcion, a new switch for the automatic change of key and account. The
switch is off, so new transcriptions go to the same account as before and
nothing moves by itself. He can already add his accounts to the list and order
them. He should leave the switch off for now: one correction requested by the
independent review comes first (below).

What the switch will do once it is on (decision D-029, his words of November
12: "si una cuenta se queda sin saldo, debería intentar con la misma cuenta
conseguir un token nuevo y si no, cambiar de cuenta. Y decídmelo, sobre todo
porque puede cambiar la calidad"): when a provider definitively refuses a
request before accepting the audio, in a shape that provider documents (for
example a rejected key or no credit), Media2Text tries the next key of the same
account and then the next account in his order, which may be another service.
It tells him every time with a notice that is kept until he dismisses it and is
shown on every screen, with a plain sentence when the service changed. Any
other failure fails the job as before. Usage caps are unchanged.

What already changed, with the switch off: provider errors are worded with
fixed parts and never show what the provider wrote; a refused key is marked on
the accounts screen until he clears the mark, and is still used; the console
re-reads accounts every 20 seconds and shows a band when a notice is pending or
new jobs are being refused; the public status says degraded while the selected
account cannot take work.

How it was checked: a model from a different family (Codex) reviewed the work
in five passes and accepted its deployment with the switch off. The test suite
passes (279 of 279). The deployment's own verification passed (version, refusal
without a key, usage enforcement, scheduler off, operator login). Afterwards
the stored switch was read as off, with no automatic change recorded and his
one saved account in place. The agent did not exercise the new screen in a
browser.

What remains and who acts:

- Executing agent: correct the first of three follow-ups left by the review
  (with more than 500 pending notices the band would stop updating without
  saying so), have it reviewed and install it. The other two are smaller and
  are written down.
- Carlos, after that: open Settings > Cuentas de transcripcion, check that a
  saved account is selected, add his accounts to the list in the order he
  wants and turn the switch on. He should see the switch stay on and the list
  in his order. The existing (legacy) configuration takes no part in automatic
  changes, which is why a saved account must be selected first.
- Not built: an immediate message to his phone when a change happens. It needs
  separate work and his choice to receive it.

A first real automatic change can only be seen when a real key is refused. No
paid test was made and none is implied. The account-management section below
describes 0.42.2 and stays as the record of that delivery.

## Account-management increment (2026-10-24)

Media2Text 0.42.2 is installed from reviewed source 8c3f0a5. Settings supports
named provider accounts, write-only masked keys, explicit selection, rotation
and local revocation. The actual mobile/desktop flow, five-minute reauthentication
and logout pass. A coherent private copy restores with the matching master across
reopen and rejects a different master in an isolated container without network.
This is same-NAS recovery. The installation-test account remains disabled,
unselected and unprobed; legacy selections and all spending limits are unchanged.

Exact independent Opus review covers source and actual operator clarity.
The usable existing login is preserved. Formal password activity metadata remains
unresolved, and reviewed Dossier publication/readback is still in progress.
Home shared reader HTTP503 and Sentinel standard shared backup refusal retain their separate scope.
The executor owns feasible documentary closure; Carlos can use Settings now.

The long-recording economic block, existing shorter result, adaptive audio/report
proposal and M1-M3 acceptance remain separate. No provider spend, automatic routing
or imported credentials were part of qualification. Previous history is retained.

## Previously delivered product and retained acceptance

Media2Text converts YouTube/video and direct audio into structured and readable
transcripts. The existing Plaud connection can process new recordings under its
current limits. M0 is accepted: Carlos confirmed reading, phrase search and
offline use on computer and Android on October 1. The October 7 integration brought its then-published source from 0.41.2 to
0.41.3. Production 0.42.2 now has actual account/login/recovery proof; formal delivery remains separate.

A post-M0 recording has already been transcribed and delivered as the separate
M1 note package, reusing its result with zero incremental transcription cost.
The existing private reading guide tells Carlos where to obtain that package
and how to open it in Obsidian on both devices. A prepared file is not personal
acceptance and does not update itself when new notes arrive.

The service is available, with retained processing failures and downstream
delivery work still requiring follow-up. Those limitations are not repaired by
adding documentation. The account release includes qualified dependency corrections. Other runtime
security and upstream-tool changes retain their separately reviewed scope.

## Roadmap and next action

- M0, read existing notes on computer and Android: done by operator confirmation.
- M1, read a new recording: in progress. Carlos opens the prepared M1 package in
  Obsidian on the computer and Android, recognizes the recording, finds a phrase
  and reopens it without a connection on both. That confirmation completes M1.
  If a step fails, he names the device and step; the agent owns technical repair.
- M2, reliable daily use: pending. The agent must address failure recovery,
  pause/economic-limit feedback, several natural daily cycles and delivery of
  newly created notes to both devices. A single successful note cannot close it.
- M3, Cortex use: pending with its separate consumer/runtime prerequisites.
- Retained foundations and bilateral connection waves: still owned work with
  their original contracts and gates. Their separate listing starts no execution
  and creates no new dependency between independent lines.
- Dedicated Dossier: delivered under the October 7 authorization. Integration
  guidance, admission and reviewed native/shared content are available. The
  Portal card opens the dedicated reader; all five Spanish sections pass on
  desktop/mobile viewports and a coherent copy restores in isolated same-NAS
  custody. The other eight readers and every historical record are preserved.

## Decisions

- D-018: Media2Text is the visible brand; youtube2text remains the stable technical
  project identity. No repository, runtime or configuration rename is implied.
- D-024: bilateral connection provisioning remains accepted work with separate
  implementation/deployment gates; it is not a prerequisite to reading M1.
- D-026: make existing transcripts useful before paying for more processing.
  M1 reuses an existing result; new paid tests and replay retain their approvals.
- D-027: adopt the shared integration instructions and a dedicated, narrowly
  curated Media2Text Dossier. Plaud history and product acceptance stay separate.

## Changes and remaining limits

The October 7 task follows Carlos's request to resolve the documentation gap
reported by Portal. It adds project-owned continuity rather than treating the
Plaud Dossier as Media2Text's own. It preserves earlier history and priorities.

The delivery adds instructions, a declaration, a narrow allowlist and published
owner admission. Shared publication, current/exact-history readback, Spanish
desktop/mobile inspection and isolated restoration are verified. The existing
Portal image/configuration and all other service/contract bytes are preserved.
Same-NAS restoration does not establish physically independent recovery. Native
Windows/fleet acceptance and personal phone acceptance are not inferred.

M1 device confirmation remains an independent operator acceptance step.
The account runtime 0.42.2 is delivered; reviewed documentary closure remains.
No replay, new provider call, budget increase, scheduler change or Cortex
activation is part of this closeout.

## Account closeout clarification - 2026-10-24

Until an explicit account selection, legacy environment credentials remain active.
Existing access is preserved, with no new routes, automatic scheduling or paid audio.
D-028 records Carlos's accepted Go for encrypted accounts with explicit selection.
The current password works; only its formal event identity remains unresolved.
Carlos was optionally asked for the exact Doppler activity date/time to complete
that record; this is not required to use the application and never requests a secret.
