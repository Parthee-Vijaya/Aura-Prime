// SPDX-License-Identifier: EUPL-1.2
'use strict';
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const HOSTS = new Set(['huggingface.co', 'github.com']);
const MARGIN_BYTES = 512 * 1024 * 1024;

/** Kun https fra de fastlåste kilder. Viderestillinger følges, men indholdet godkendes først af kontrolsummen. */
function allowedSource(url) {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && HOSTS.has(parsed.hostname); }
  catch { return false; }
}
const fail = (message, code) => Object.assign(new Error(message), { code });
async function diskFree(directory) { const stat = await fsp.statfs(directory); return stat.bavail * stat.bsize; }
function fileDigest(file) {
  return new Promise((resolve, reject) => { const hash = crypto.createHash('sha256'); fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex'))); });
}

/**
 * Henter en fastlåst fil til `<file>.part`, genoptager en afbrudt hentning og
 * giver først filen sit endelige navn, når størrelse og SHA-256 passer.
 */
async function download({ url, file, bytes, sha256, fetch = globalThis.fetch, signal, onProgress = () => {}, allowed = allowedSource, freeBytes = diskFree }) {
  if (!allowed(url)) throw fail('Adressen er ikke en godkendt kilde til lokale modeller.', 'LOCAL_SOURCE');
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || !/^[0-9a-f]{64}$/.test(sha256 || '')) throw fail('Filen mangler en fastlåst størrelse eller kontrolsum.', 'LOCAL_PIN');
  const part = file + '.part';
  await fsp.mkdir(path.dirname(file), { recursive: true });
  let have = (await fsp.stat(part).catch(() => null))?.size || 0;
  if (have > bytes) { await fsp.rm(part, { force: true }); have = 0; }
  const resumed = have > 0;
  if (have < bytes) {
    if (await freeBytes(path.dirname(file)) < bytes - have + MARGIN_BYTES) throw fail('Der mangler diskplads til filen. Ryd plads, og prøv igen.', 'LOCAL_DISK');
    let response;
    try { response = await fetch(url, { signal, redirect: 'follow', headers: have ? { range: `bytes=${have}-` } : {} }); }
    catch (error) { throw signal?.aborted ? fail('Hentningen blev afbrudt. Det hentede gemmes, så du kan fortsætte senere.', 'LOCAL_ABORTED') : fail('Kilden kunne ikke nås. Kontrollér netværket, og prøv igen.', 'LOCAL_NETWORK'); }
    if (response.status === 200 && have) { await fsp.rm(part, { force: true }); have = 0; }
    else if (!(response.status === 200 || response.status === 206 && have)) throw fail(`Kilden svarede ${response.status}. Prøv igen senere.`, 'LOCAL_HTTP');
    const handle = await fsp.open(part, 'a');
    try {
      for await (const chunk of response.body) {
        await handle.write(chunk); have += chunk.length;
        if (have > bytes) throw fail('Filen har en anden størrelse end den fastlåste. Den er ikke gemt.', 'LOCAL_SIZE');
        onProgress({ received: have, total: bytes });
      }
    } catch (error) {
      if (error.code === 'LOCAL_SIZE') { await handle.close(); await fsp.rm(part, { force: true }); throw error; }
      if (signal?.aborted) throw fail('Hentningen blev afbrudt. Det hentede gemmes, så du kan fortsætte senere.', 'LOCAL_ABORTED');
      throw fail('Forbindelsen blev afbrudt under hentningen. Prøv igen for at fortsætte.', 'LOCAL_NETWORK');
    } finally { await handle.close().catch(() => {}); }
  }
  if (have !== bytes) { await fsp.rm(part, { force: true }); throw fail('Filen har en anden størrelse end den fastlåste. Den er ikke gemt.', 'LOCAL_SIZE'); }
  if (await fileDigest(part) !== sha256) { await fsp.rm(part, { force: true }); throw fail('Filens kontrolsum passer ikke med den fastlåste. Filen er slettet.', 'LOCAL_CHECKSUM'); }
  await fsp.rename(part, file);
  onProgress({ received: bytes, total: bytes });
  return { file, resumed };
}
module.exports = { download, allowedSource, fileDigest };
