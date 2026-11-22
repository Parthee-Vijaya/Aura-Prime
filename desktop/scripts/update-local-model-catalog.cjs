// SPDX-License-Identifier: EUPL-1.2
'use strict';
// Vedligeholdelse: henter størrelse, kontrolsum, licens og modeltal for hver
// katalogmodel direkte fra Hugging Face og skriver dem til kataloget.
//   node scripts/update-local-model-catalog.cjs          (viser forskelle)
//   node scripts/update-local-model-catalog.cjs --write  (opdaterer filen)
// Kræver netværk og kører derfor ikke som del af den almindelige kontrol.
const fs = require('node:fs');
const path = require('node:path');
const FILE = path.join(__dirname, '..', 'core', 'local-models', 'catalog.json');
const HF = 'https://huggingface.co';
const headers = { 'user-agent': 'aura-prime-catalog' };

async function json(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url} svarede ${response.status}`);
  return response.json();
}
/** Læser nøgletal fra GGUF-filens hoved uden at hente hele filen. */
async function ggufHeader(url, wanted) {
  for (const bytes of [1 << 18, 1 << 21, 1 << 24, 1 << 26]) {
    const response = await fetch(url, { headers: { ...headers, range: `bytes=0-${bytes - 1}` } });
    if (!response.ok) throw new Error(`${url} svarede ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    try { return parseGguf(buffer, wanted); } catch (error) { if (error.message !== 'MERE') throw error; }
  }
  throw new Error('GGUF-hovedet er større end forventet.');
}
function parseGguf(buffer, wanted) {
  let at = 0; const found = {};
  const need = n => { if (at + n > buffer.length) throw new Error('MERE'); };
  const u32 = () => { need(4); const v = buffer.readUInt32LE(at); at += 4; return v; };
  const u64 = () => { need(8); const v = Number(buffer.readBigUInt64LE(at)); at += 8; return v; };
  const string = () => { const n = u64(); need(n); const v = buffer.toString('utf8', at, at + n); at += n; return v; };
  const SIZE = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
  const value = type => {
    if (type === 8) return string();
    if (type === 9) { const inner = u32(), count = u64(); if (SIZE[inner]) { need(SIZE[inner] * count); at += SIZE[inner] * count; return null; } for (let i = 0; i < count; i++) value(inner); return null; }
    if (!SIZE[type]) throw new Error('Ukendt GGUF-type ' + type);
    need(SIZE[type]); const start = at; at += SIZE[type];
    return type === 4 ? buffer.readUInt32LE(start) : type === 5 ? buffer.readInt32LE(start) : type === 10 ? Number(buffer.readBigUInt64LE(start)) : type === 11 ? Number(buffer.readBigInt64LE(start)) : type === 2 ? buffer.readUInt16LE(start) : null;
  };
  if (buffer.toString('latin1', 0, 4) !== 'GGUF') throw new Error('Filen er ikke en GGUF-fil.');
  at = 4; u32(); u64(); const count = u64();
  for (let i = 0; i < count; i++) {
    const key = string(), type = u32(), v = value(type);
    const short = key.replace(/^[^.]+\./, '');
    if (wanted.includes(short) && typeof v === 'number') found[short] = v;
    if (wanted.every(name => name in found || name === 'attention.key_length')) { if (key.startsWith('tokenizer.')) break; }
    if (key.startsWith('tokenizer.') && wanted.filter(name => name !== 'attention.key_length').every(name => name in found)) break;
  }
  return found;
}
async function refresh(entry) {
  const info = await json(`${HF}/api/models/${entry.gguf.repo}?blobs=true`);
  const file = info.siblings.find(item => item.rfilename === entry.gguf.file);
  if (!file?.lfs?.sha256) throw new Error(`${entry.gguf.repo} mangler ${entry.gguf.file}`);
  const url = `${HF}/${entry.gguf.repo}/resolve/${info.sha}/${entry.gguf.file}`;
  const head = await ggufHeader(url, ['block_count', 'embedding_length', 'attention.head_count', 'attention.head_count_kv', 'attention.key_length', 'context_length']);
  const heads = head['attention.head_count'], kvHeads = head['attention.head_count_kv'] || heads;
  const headSize = head['attention.key_length'] || Math.round(head.embedding_length / heads);
  if (![head.block_count, kvHeads, headSize].every(Number.isFinite)) throw new Error(`${entry.id}: GGUF-hovedet mangler modeltal.`);
  return { ...entry, license: info.cardData?.license || entry.license,
    toolsInTemplate: /\btools\b/.test(info.gguf?.chat_template || ''),
    gguf: { ...entry.gguf, revision: info.sha, bytes: file.size, sha256: file.lfs.sha256,
      trainedContext: head.context_length || info.gguf?.context_length || null,
      // Nøgle- og værdilager pr. token i 16-bit: 2 × lag × hoveder × hovedstørrelse × 2 byte.
      kvBytesPerToken: 2 * head.block_count * kvHeads * headSize * 2 } };
}
(async () => {
  const catalog = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const models = [];
  for (const entry of catalog.models) { const next = await refresh(entry); models.push(next); console.log(`${entry.id}: ${(next.gguf.bytes / 1e9).toFixed(2)} GB, ${next.gguf.kvBytesPerToken} byte/token, licens ${next.license}, værktøjer i skabelon: ${next.toolsInTemplate}`); }
  const next = { ...catalog, checkedAt: new Date().toISOString().slice(0, 10), models };
  const changed = JSON.stringify(next.models) !== JSON.stringify(catalog.models);
  if (process.argv.includes('--write')) { fs.writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n'); console.log(changed ? 'Kataloget er opdateret.' : 'Ingen ændringer.'); }
  else { console.log(changed ? 'Kataloget afviger fra kilderne. Kør med --write.' : 'Kataloget svarer til kilderne.'); process.exitCode = changed ? 1 : 0; }
})().catch(error => { console.error(error.message); process.exit(1); });
