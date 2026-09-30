// Offline Plaud v1 reading projection. Never contacts a provider or edits source evidence.
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, resolve, join, relative, isAbsolute, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const inside = (root, path) => path === root || (!relative(root, path).startsWith('..') && !isAbsolute(relative(root, path)));
const fail = code => { throw new Error(code); };
const text = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/([\\`*_\[\]()#!|~$])/g, '\\$1').replace(/[\r\n]+/g, ' ')
  .replace(/%%/g, '\\%\\%').replace(/==/g, '\\=\\=')
  .replace(/^([+-])(?=\s|$)/, '\\$1')
  .replace(/^(\d{1,9})\.(?=\s|$)/, '$1\\.')
  .replace(/^(?=(?:-\s*){3,}$)-/, '\\-');
const time = ms => Number.isFinite(ms) && ms >= 0 ? [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map(n => String(n).padStart(2, '0')).join(':') : 'hora desconocida';

async function inspect(path) {
  try { return await fs.lstat(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

async function safePath(path) {
  let current = parse(path).root;
  for (const part of relative(current, path).split('/').filter(Boolean)) {
    current = join(current, part);
    const stat = await inspect(current);
    if (stat?.isSymbolicLink() || (stat?.isFile() && stat.nlink !== 1)) fail('unsafe_link');
    if (stat?.isDirectory() && await inspect(join(current, '.git'))) fail('private_data_must_be_outside_git');
  }
}

async function atomicWrite(path, content) {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, path);
}

function render(record, recordHash) {
  const s = record.source;
  const metadata = {
    title: s.title, aliases: [s.title], transcriptId: record.transcriptId,
    sourceAuthority: s.authority, sourceCollectionId: s.sourceCollectionId ?? null,
    sourceItemId: s.sourceItemId, sourceArtifactRevision: s.artifactRevision,
    recordSha256: recordHash, recordedAt: null,
    recordedAtUnavailableReason: 'El registro original no conserva la fecha de grabación.',
    materializedAt: record.createdAt, durationSeconds: record.artifact.durationSeconds,
    provider: record.transcription.provider, model: record.transcription.model,
    language: record.transcription.languageCode ?? null,
  };
  const lines = ['---', ...Object.entries(metadata).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---', '', `# ${text(s.title)}`, '',
    'Fecha de grabación: desconocida. La fecha de procesamiento figura en las propiedades.', '',
    'Copia generada. Escribe tus anotaciones en una nota aparte.', '', '## Transcripción', ''];
  const payload = record.transcription.payload;
  if (!payload || (typeof payload.text !== 'string' && !Array.isArray(payload.utterances))) fail('missing_transcript_body');
  if (payload.utterances?.length) {
    for (const u of payload.utterances) {
      if (typeof u.text !== 'string') fail('invalid_utterance');
      lines.push(`### ${time(u.start)} · Hablante ${text(u.speaker ?? 'desconocido')}`, '', text(u.text), '');
    }
  } else lines.push(text(payload.text), '');
  return lines.join('\n');
}

/** Input is a trusted, private, complete snapshot prepared by the operator.
 * Admission identities MUST come from the receiver's intake evidence, not the record itself.
 * Hashes prove snapshot consistency, not authenticity of an untrusted input file.
 */
export async function exportVault({ snapshotPath, exclusionsPath, vaultPath, manifestPath }) {
  const [input, exclusionsFile, vault, manifestFile] = [snapshotPath, exclusionsPath, vaultPath, manifestPath].map(p => resolve(p));
  for (const p of [input, exclusionsFile, vault, manifestFile]) await safePath(p);
  if ([input, exclusionsFile, manifestFile].some(p => inside(vault, p))) fail('custody_must_be_outside_vault');
  if (new Set([input, exclusionsFile, manifestFile]).size !== 3) fail('overlapping_custody');
  const snapshotRaw = await fs.readFile(input);
  const snapshot = JSON.parse(snapshotRaw);
  const exclusions = JSON.parse(await fs.readFile(exclusionsFile, 'utf8'));
  if (snapshot.schemaVersion !== 'media2text.markdown-input.v1' || snapshot.complete !== true || !Array.isArray(snapshot.items) || !snapshot.items.length) fail('incomplete_snapshot');
  if (exclusions.schemaVersion !== 'media2text.markdown-exclusions.v1' || !Array.isArray(exclusions.items)) fail('invalid_exclusions');
  const denied = new Map();
  for (const item of exclusions.items) {
    if (typeof item.transcriptId !== 'string' || typeof item.reason !== 'string' || !item.reason.trim() || denied.has(item.transcriptId)) fail('invalid_exclusion');
    denied.set(item.transcriptId, item.reason);
  }
  const outputs = new Map();
  const records = [], excluded = [], ids = new Set(), identities = new Set();
  for (const item of snapshot.items) {
    if (typeof item.recordBytes !== 'string' || sha256(item.recordBytes) !== item.recordSha256) fail('record_hash_mismatch');
    const r = JSON.parse(item.recordBytes), s = r.source, a = item.admission;
    if (r.schemaVersion !== 'media2text.transcript.v1' || s?.kind !== 'intake' || typeof r.transcriptId !== 'string' || !s.authority || !s.sourceItemId || typeof s.title !== 'string') fail('unsupported_record');
    if (ids.has(r.transcriptId)) fail('duplicate_transcript');
    ids.add(r.transcriptId);
    const md = r.representations?.find(v => v.format === 'markdown');
    if (!md || typeof item.markdownBytes !== 'string' || sha256(item.markdownBytes) !== md.sha256 || Buffer.byteLength(item.markdownBytes) !== md.bytes) fail('markdown_integrity_mismatch');
    if (!a || !a.authority || !a.sourceItemId || !a.artifactRevision) fail('missing_admission_evidence');
    const mismatch = a.authority !== s.authority || a.sourceItemId !== s.sourceItemId || (a.sourceCollectionId ?? null) !== (s.sourceCollectionId ?? null) || a.artifactRevision !== s.artifactRevision || a.artifactRevision !== `sha256:${r.artifact?.sha256}`;
    const reason = denied.get(r.transcriptId) ?? (mismatch ? 'admitted_source_mismatch' : null);
    if (reason) { excluded.push({ transcriptId: r.transcriptId, reason }); continue; }
    const identity = JSON.stringify([s.authority, s.sourceCollectionId ?? null, s.sourceItemId]);
    if (identities.has(identity)) fail('duplicate_source_requires_resolution');
    identities.add(identity);
    const path = `Transcripciones/${sha256(identity)}.md`;
    const body = render(r, item.recordSha256);
    outputs.set(path, body);
    records.push({ transcriptId: r.transcriptId, sourceIdentity: JSON.parse(identity), path, recordSha256: item.recordSha256, sha256: sha256(body) });
  }
  for (const id of denied.keys()) if (!ids.has(id)) fail('exclusion_not_in_snapshot');
  records.sort((a, b) => a.path.localeCompare(b.path));
  const byId = new Map(snapshot.items.map(i => { const r = JSON.parse(i.recordBytes); return [r.transcriptId, r]; }));
  outputs.set('LEEME.md', ['# Mis transcripciones', '', `${records.length} transcripciones disponibles. ${excluded.length} registros excluidos.`, '',
    'Abre esta carpeta como bóveda en Obsidian. Usa la búsqueda para encontrar palabras en todas las notas.', '',
    'Las transcripciones son copias generadas; conserva tus anotaciones en una carpeta aparte.',
    'La fecha de procesamiento no es la fecha de grabación. Esta copia no se actualiza automáticamente.', '',
    ...records.map(r => `- [${text(byId.get(r.transcriptId).source.title)}](${r.path})`), ''].join('\n'));
  const priorStat = await inspect(manifestFile);
  const prior = priorStat ? JSON.parse(await fs.readFile(manifestFile, 'utf8')) : null;
  if (prior && (prior.schemaVersion !== 'media2text.markdown-vault.v1' || prior.vaultPath !== vault || !Array.isArray(prior.files) || !Array.isArray(prior.records))) fail('invalid_previous_manifest');
  const oldFiles = new Map();
  for (const file of prior?.files ?? []) {
    if (!/^(LEEME\.md|Transcripciones\/[a-f0-9]{64}\.md)$/.test(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || oldFiles.has(file.path)) fail('invalid_previous_path');
    oldFiles.set(file.path, file.sha256);
  }
  for (const previous of prior?.records ?? []) {
    if (!ids.has(previous.transcriptId)) fail('source_absence_is_not_withdrawal');
    if (!outputs.has(previous.path)) {
      if (!excluded.some(e => e.transcriptId === previous.transcriptId)) fail('unresolved_previous_record');
      if (!oldFiles.has(previous.path)) fail('invalid_previous_record');
      // No title or searchable transcript body survives an explicit exclusion.
      outputs.set(previous.path, '# Transcripción retirada de esta copia\n\nEl registro está excluido. No se incluye su contenido.\n');
    }
  }
  // Retain earlier metadata-only stubs on subsequent runs.
  for (const [path] of oldFiles) if (!outputs.has(path)) outputs.set(path, '# Transcripción retirada de esta copia\n\nEl registro está excluido. No se incluye su contenido.\n');
  for (const [path, body] of outputs) {
    const target = join(vault, path); await safePath(target);
    const stat = await inspect(target);
    if (stat && (!stat.isFile() || !oldFiles.has(path) || sha256(await fs.readFile(target)) !== oldFiles.get(path))) fail('edited_or_unowned_generated_file');
    if (!stat && oldFiles.has(path)) fail('missing_generated_file_requires_restore');
    if (!body) fail('empty_output');
  }
  // Preflight completes before any output mutation; serialize cooperating exporters.
  await fs.mkdir(dirname(manifestFile), { recursive: true, mode: 0o700 });
  const lockPath = `${manifestFile}.lock`;
  let lock;
  try { lock = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('exporter_lock_present'); throw error; }
  try {
    // Detect another exporter that finished between preflight and lock acquisition.
    const current = await inspect(manifestFile);
    if (Boolean(current) !== Boolean(prior) || (prior && (await fs.readFile(manifestFile, 'utf8')) !== json(prior))) fail('manifest_changed_during_preflight');
    for (const [path, body] of outputs) {
      const target = join(vault, path);
      await safePath(target);
      const stat = await inspect(target);
      if (stat && (!stat.isFile() || !oldFiles.has(path) || sha256(await fs.readFile(target)) !== oldFiles.get(path))) fail('edited_or_unowned_generated_file');
      if (!stat || sha256(body) !== oldFiles.get(path)) await atomicWrite(target, body);
    }
    const manifest = { schemaVersion: 'media2text.markdown-vault.v1', generator: 'Media2Text offline M0 v1', vaultPath: vault,
      snapshotSha256: sha256(snapshotRaw), records, excluded,
      files: [...outputs].map(([path, body]) => ({ path, sha256: sha256(body) })).sort((a, b) => a.path.localeCompare(b.path)) };
    await atomicWrite(manifestFile, json(manifest));
    return { records: records.length, excluded: excluded.length, files: outputs.size, manifestSha256: sha256(json(manifest)) };
  } finally { await lock.close(); await fs.unlink(lockPath); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4) { console.error('Usage: node scripts/export-markdown-vault.mjs SNAPSHOT EXCLUSIONS VAULT MANIFEST'); process.exitCode = 2; }
  else {
    try { console.log(JSON.stringify(await exportVault({ snapshotPath: args[0], exclusionsPath: args[1], vaultPath: args[2], manifestPath: args[3] }))); }
    catch (error) { console.error(`Export blocked: ${/^[a-z_]+$/.test(error.message) ? error.message : 'invalid_input_or_filesystem_error'}`); process.exitCode = 1; }
  }
}
