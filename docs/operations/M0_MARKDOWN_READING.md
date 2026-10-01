# M0: private transcript reading on desktop and mobile

Status: local preparation; device transfer and real-device acceptance remain open.
Owner: Media2Text. Source 0.41.0 adds offline tooling; NAS stays on 0.39.3.

## Operator instructions

Use [the Spanish reading guide](M0_READING_GUIDE.es.md) with Carlos. It names
the prepared archive, personal NAS folder, computer and Android steps, and the
observable result. Recorded Portal product context identifies Android; do not
repeat the platform question. Installed apps and device success remain unverified.

## Scope and sequence

Carlos selected both desktop and mobile on 2026-09-30. The September 29
Codex/Opus consensus is adopted here for this bounded M0 preparation: first
read/search existing transcripts, then M1 one new recording, M2 daily
reliability, and M3 Cortex. Bilateral provisioning is retained backlog, not a
prerequisite. Its historical 0.41/0.42 version suggestion is not a reservation.
This slice does not activate processing, subscriptions, synchronization, replay,
Cortex delivery, or a new production worker on the development VM.

The existing authenticated browser entry is
`https://y2t.lamanoriega.com/?screen=library`. Executor browser checks at 1440
and 390 pixels passed reading/download, without overflow or page errors;
anonymous library access returned 401. This is viewport evidence, not testing
on Carlos's devices. The legacy library still lacks content search, stable
per-transcript links and trusted-record exclusion; its displayed upload date
must not be treated as original recording time. It is interim browsing, not
M0 acceptance.

## Offline export

The tools use Node 24 and built-ins only. Keep input, exclusion policy and
manifest in private custody outside both Git and the reading vault. No
credential enters the vault. Keep readers/sync clients closed while exporting;
the exporter lock serializes cooperating exporters, not other editing software.
The vault is a reading replica; annotations belong in a separate folder.

1. On the existing NAS API container, run the reviewed
   `scripts/snapshot-markdown-input.mjs` using its already configured
   `Y2T_API_KEY` and `OUTPUT_DIR`. Pipe the script over authenticated SSH to
   `docker exec -i youtube2text-api node --input-type=module`, capturing stdout
   directly into a private file on the operator host. Do not print stdout,
   copy container environment values, or put the result in Git.
2. The collector performs authenticated GETs, checks record hashes against
   response/catalog metadata and immutable Markdown bytes, checks inventory
   completeness, and reads admission identity through read-only SQLite in one
   transaction. It never instantiates the migration-capable job store or copies
   a live SQLite database. It is bounded below 500 records and to intake v1;
   mixed/v2/larger inventories fail pending a reviewed collector extension.
3. Prepare `exclusions.json` with
   `{"schemaVersion":"media2text.markdown-exclusions.v1","items":[{"transcriptId":"the-private-id","reason":"reason"}]}`.
   Retain the known historical derivative/source mismatch. Additional personal
   exclusions can be added later without asking the operator to approve an
   already-proven defective record.
4. Run, with absolute private paths:

   ```sh
   node scripts/export-markdown-vault.mjs SNAPSHOT EXCLUSIONS VAULT MANIFEST
   ```

The export validates exact input record and representation hashes, compares
source identity against **separate admission evidence**, and rejects duplicate
trusted source items. Comparing two fields in the same defective record is
insufficient. The input is trusted operator evidence, not a signed package;
hashes cannot authenticate a malicious input author.

Stable filenames derive from authority, collection and source item. The
Spanish index links every eligible note. Frontmatter preserves identities,
source/record hashes, provider/model, duration and materialization time. V1
recording time stays null with an explicit reason. Body text is rendered from
the verified canonical payload with timestamp/speaker labels and escaped
Markdown/HTML; legacy processing-date and audio-URL labels are not copied.
Ordinary hyphens, decimals, percentages and single equals signs remain literal
for raw Markdown search. Dollar signs and active markup are escaped to avoid
math or hidden comments; search the number/words or account for the backslash
when searching exact marked-up text.

A second identical run is byte-identical. Existing generated files must match
the prior manifest before replacement. Personal edits block the export; no
full-text conflict copies are created. Excluding an unchanged previously
exported note replaces its body with a content-free stub. An edited excluded
note blocks and requires manual reconciliation before claiming withdrawal.
Absence from an input snapshot is never interpreted as deletion. Original
records, previous snapshots and backups remain intact; exclusion is not erasure.

## Transfer and recovery

The output is ordinary Markdown, prepared for a local Obsidian vault on both
devices. The operator guide uses the recorded Android environment and a manual USB copy;
this preparation does not buy Obsidian Sync or choose a new cloud service.
The web entry can be used meanwhile with the existing login and network access.

Transfer only the vault folder, not the input snapshot, API keys or custody
manifest. Keep one export master and copy reading replicas explicitly. Verify
file hashes on the desktop after transfer; on the phone, use the matching
archive plus record count, index links and search/read checks. A phone-side
cryptographic comparison is not claimed. No automatic update or bidirectional note merge is
implemented. A safe recovery test regenerates into a **new** private directory
using the same snapshot and exclusion list, then compares relative file hashes;
do not delete a user's existing vault to test recovery.

A crash during multiple file replacements can leave a partial projection.
There is no whole-vault transaction: do not distribute it without a successful
manifest/hash verification. Retain the old evidence and regenerate into a new
directory. Do not remove an unknown live lock or replace edited notes to force
success. Filesystem race resistance assumes private custody and exclusive
operator access; this is not a hostile multi-user synchronization system.

## Acceptance

- Automated export guard tests, exact repeated export and regeneration hash
  comparison pass; excluded record has no searchable body.
- Current executor snapshot: 76 immutable v1 records observed at
  2026-09-30T21:35:27Z; one admitted-source mismatch excluded; 75 distinct
  candidates. These are dated observations, not a continuously live count.
- On both actual devices: open the folder in the chosen reader, find two
  personally meaningful terms, open results/index links and read one note
  offline. Physical-device and reading-quality acceptance belong to Carlos.
- M0 is not complete until transfer and both device checks pass. M1 still needs
  a fresh budget/headroom check and a separately bounded new recording.

No live API/content contract changed. The historically ratified five-artifact
pin remains at commit fa205972; schemas and contract README retain those bytes.
The current OpenAPI version marker follows the new product version, as in prior
DocKit bumps; current-file bytes are not advertised as the old exact pin or as
new consumer acceptance. Cortex delivery remains disabled.

Dependency validation found pre-existing advisory failures. Compatible lock-only
updates (including Next.js 15.5.27) are included and revalidated in source. They
do not remediate the still-deployed 0.39.3 service; runtime upgrade/recovery is
a separately scoped follow-up before expanding use or network exposure.

The bounded collector can hit the API read rate limit near its inventory limit;
it fails without exporting a partial snapshot. Retry later; do not raise service
limits for M0. Official reader guidance: [open a folder as a vault](https://help.obsidian.md/Files+and+folders/Manage+vaults)
and [core Search](https://help.obsidian.md/Plugins/Search).

## Prepared delivery evidence

The final source checks pass: 228 tests including 18 exporter cases, both builds,
contracts, version/naming checks and dependency audits with zero findings.
The private 75-note ZIP was staged in the operator's personal NAS folder and
read back byte-identically. This is artifact preparation, not device transfer
or independent audio recovery. The existing web view was checked against every
paragraph of one eligible canonical Plaud record at both viewport sizes.
