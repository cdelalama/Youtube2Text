import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportVault, sha256 } from '../scripts/export-markdown-vault.mjs';

async function setup(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'm2t-vault-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const md = '# Legacy date\n\nwords';
  const revision = `sha256:${'a'.repeat(64)}`;
  const record = {
    schemaVersion: 'media2text.transcript.v1', transcriptId: 'trn_one', createdAt: '2026-09-01T12:00:00Z',
    source: { kind: 'intake', authority: 'plaud', sourceItemId: 'one', sourceCollectionId: 'collection', title: 'Meeting [private]', artifactRevision: revision },
    artifact: { sha256: 'a'.repeat(64), durationSeconds: 60 },
    transcription: { provider: 'deepgram', model: 'nova', payload: { utterances: [{ speaker: 0, start: 1000, text: 'Searchable apples <img src="https://example.invalid"> ![remote](https://example.invalid)' }] } },
    representations: [{ format: 'markdown', sha256: sha256(md), bytes: Buffer.byteLength(md) }],
  };
  const item = { recordBytes: JSON.stringify(record), recordSha256: sha256(JSON.stringify(record)), markdownBytes: md,
    admission: { authority: 'plaud', sourceItemId: 'one', sourceCollectionId: 'collection', artifactRevision: revision } };
  const snapshot = { schemaVersion: 'media2text.markdown-input.v1', complete: true, items: [item] };
  const exclusions = { schemaVersion: 'media2text.markdown-exclusions.v1', items: [] };
  const args = { snapshotPath: join(root, 'snapshot.json'), exclusionsPath: join(root, 'exclusions.json'), vaultPath: join(root, 'vault'), manifestPath: join(root, 'manifest.json') };
  const save = async () => { await fs.writeFile(args.snapshotPath, JSON.stringify(snapshot)); await fs.writeFile(args.exclusionsPath, JSON.stringify(exclusions)); };
  await save();
  return { root, record, item, snapshot, exclusions, args, save,
    updateRecord: () => { item.recordBytes = JSON.stringify(record); item.recordSha256 = sha256(item.recordBytes); },
    manifest: async () => JSON.parse(await fs.readFile(args.manifestPath, 'utf8')) };
}

test('repeat export is byte identical; Spanish reader and honest date; source untouched', async t => {
  const f = await setup(t); const before = await fs.readFile(f.args.snapshotPath);
  const first = await exportVault(f.args); const m = await f.manifest();
  const note = await fs.readFile(join(f.args.vaultPath, m.records[0].path), 'utf8');
  assert.match(note, /recordedAt: null/); assert.match(note, /materializedAt: "2026-09-01/);
  assert.match(note, /Hablante 0/); assert.match(note, /Searchable apples/);
  assert.ok(!note.includes('<img')); assert.ok(!note.includes('![remote]('));
  assert.deepEqual(await exportVault(f.args), first);
  assert.deepEqual(await fs.readFile(f.args.snapshotPath), before);
});

test('intake comparison catches a self-consistent but wrong source/derivative identity', async t => {
  const f = await setup(t); f.record.artifact.sha256 = 'b'.repeat(64); f.record.source.artifactRevision = `sha256:${'b'.repeat(64)}`;
  f.updateRecord(); await f.save(); const r = await exportVault(f.args);
  assert.equal(r.records, 0); assert.equal(r.excluded, 1);
  assert.equal((await f.manifest()).excluded[0].reason, 'admitted_source_mismatch');
});

test('explicit exclusion removes body and stays removed on repeat and fresh regeneration', async t => {
  const f = await setup(t); await exportVault(f.args); const m = await f.manifest();
  f.exclusions.items.push({ transcriptId: 'trn_one', reason: 'operator exclusion' }); await f.save();
  await exportVault(f.args); const body = await fs.readFile(join(f.args.vaultPath, m.records[0].path), 'utf8');
  assert.ok(!body.includes('Searchable')); assert.ok(!body.includes('Meeting'));
  assert.deepEqual(await exportVault(f.args), await exportVault(f.args));
  const fresh = { ...f.args, vaultPath: join(f.root, 'restored'), manifestPath: join(f.root, 'restored-manifest.json') };
  assert.equal((await exportVault(fresh)).records, 0);
  assert.equal((await fs.readdir(fresh.vaultPath)).length, 1);
});

test('edited generated note blocks exclusion without overwriting or conflict copies', async t => {
  const f = await setup(t); await exportVault(f.args); const m = await f.manifest();
  const path = join(f.args.vaultPath, m.records[0].path); await fs.appendFile(path, '\nPersonal note');
  f.exclusions.items.push({ transcriptId: 'trn_one', reason: 'withdraw' }); await f.save();
  await assert.rejects(exportVault(f.args), /edited_or_unowned/);
  assert.match(await fs.readFile(path, 'utf8'), /Personal note/);
  assert.equal((await fs.readdir(join(f.args.vaultPath, 'Transcripciones'))).length, 1);
});

for (const [name, mutate, message] of [
  ['record hash', f => { f.item.recordBytes += ' '; }, /record_hash/],
  ['Markdown bytes', f => { f.item.markdownBytes += 'x'; }, /markdown_integrity/],
  ['missing admission', f => { delete f.item.admission; }, /missing_admission/],
  ['incomplete snapshot', f => { f.snapshot.complete = false; }, /incomplete_snapshot/],
  ['unknown schema', f => { f.record.schemaVersion = 'media2text.transcript.v2'; f.updateRecord(); }, /unsupported_record/],
  ['duplicate transcript', f => { f.snapshot.items.push(structuredClone(f.item)); }, /duplicate_transcript/],
  ['duplicate source', f => { const i = structuredClone(f.item), r = JSON.parse(i.recordBytes); r.transcriptId = 'trn_two'; i.recordBytes = JSON.stringify(r); i.recordSha256 = sha256(i.recordBytes); f.snapshot.items.push(i); }, /duplicate_source/],
]) test(`${name} blocks before creating vault`, async t => {
  const f = await setup(t); mutate(f); await f.save(); await assert.rejects(exportVault(f.args), message);
  await assert.rejects(fs.stat(f.args.vaultPath), { code: 'ENOENT' });
});

test('unowned output, symbolic links and hard links are refused', async t => {
  const f = await setup(t); await fs.mkdir(f.args.vaultPath); await fs.writeFile(join(f.args.vaultPath, 'LEEME.md'), 'mine');
  await assert.rejects(exportVault(f.args), /edited_or_unowned/);
  await fs.rename(f.args.vaultPath, join(f.root, 'elsewhere'));
  await fs.symlink(join(f.root, 'elsewhere'), f.args.vaultPath); await assert.rejects(exportVault(f.args), /unsafe_link/);
  await fs.unlink(f.args.vaultPath); await fs.link(f.args.snapshotPath, join(f.root, 'linked-input'));
  await assert.rejects(exportVault(f.args), /unsafe_link/);
});

test('missing previous record cannot silently retain a stale searchable body', async t => {
  const f = await setup(t); await exportVault(f.args);
  f.record.transcriptId = 'trn_two'; f.record.source.sourceItemId = 'two'; f.item.admission.sourceItemId = 'two'; f.updateRecord(); await f.save();
  await assert.rejects(exportVault(f.args), /source_absence/);
});

test('custody inside vault and concurrent exporter lock fail closed', async t => {
  const f = await setup(t);
  await assert.rejects(exportVault({ ...f.args, manifestPath: join(f.args.vaultPath, 'manifest.json') }), /custody_must/);
  await fs.writeFile(`${f.args.manifestPath}.lock`, 'retained owner'); await assert.rejects(exportVault(f.args), /exporter_lock_present/);
  await assert.rejects(fs.stat(f.args.vaultPath), { code: 'ENOENT' });
});

test('Obsidian-specific syntax stays literal and visible', async t => {
  const f = await setup(t);
  f.record.transcription.payload.utterances = [
    '$20 y $30 %%visible%% ==literal== e-mail 3.5 50% COVID-19 a=b Pérez-Reverte',
    '- lista', '+ otra', '1. texto', '---', '3.5 sigue siendo decimal',
  ].map(value => ({ speaker: 0, start: 1000, text: value }));
  f.updateRecord(); await f.save(); await exportVault(f.args);
  const m = await f.manifest(); const note = await fs.readFile(join(f.args.vaultPath, m.records[0].path), 'utf8');
  for (const escaped of ['\\$20', '\\%\\%visible\\%\\%', '\\=\\=literal', '\\- lista', '\\+ otra', '1\\. texto']) assert.ok(note.includes(escaped));
  for (const term of ['e-mail', '3.5', '50%', 'COVID-19', 'a=b', 'Pérez-Reverte']) assert.ok(note.includes(term));
  assert.ok(!note.includes('e\\-mail')); assert.ok(!note.includes('3\\.5')); assert.ok(!note.includes('COVID\\-19'));
});

test('private inputs inside a Git checkout are refused', async t => {
  const f = await setup(t); await fs.mkdir(join(f.root, '.git'));
  await assert.rejects(exportVault(f.args), /private_data_must_be_outside_git/);
});

test('unknown exclusions and missing generated files fail closed', async t => {
  const f = await setup(t); f.exclusions.items.push({ transcriptId: 'unknown', reason: 'operator' }); await f.save();
  await assert.rejects(exportVault(f.args), /exclusion_not_in_snapshot/);
  f.exclusions.items = []; await f.save(); await exportVault(f.args); const m = await f.manifest();
  await fs.unlink(join(f.args.vaultPath, m.records[0].path));
  await assert.rejects(exportVault(f.args), /missing_generated_file_requires_restore/);
});

test('un-excluding a stub restores only the verified generated body', async t => {
  const f = await setup(t); await exportVault(f.args); const original = await f.manifest();
  f.exclusions.items.push({ transcriptId: 'trn_one', reason: 'operator' }); await f.save(); await exportVault(f.args);
  f.exclusions.items = []; await f.save(); await exportVault(f.args);
  assert.deepEqual((await f.manifest()).files, original.files);
});
