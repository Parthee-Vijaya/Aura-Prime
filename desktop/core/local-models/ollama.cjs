// SPDX-License-Identifier: EUPL-1.2
'use strict';
const OLLAMA_URL = 'http://127.0.0.1:11434';
const TAG = /^[a-z0-9][a-z0-9._-]{0,60}:[a-z0-9][a-z0-9._-]{0,60}$/;
const fail = (message, code) => Object.assign(new Error(message), { code });

/** Om Ollama kører på denne computer, og hvilke modeller den har. Kun faste GET-kald til loopback. */
async function ollamaStatus({ fetch = globalThis.fetch, baseURL = OLLAMA_URL, timeout = 2500 } = {}) {
  try {
    const read = async route => { const response = await fetch(baseURL + route, { signal: AbortSignal.timeout(timeout) }); if (!response.ok) throw new Error(String(response.status)); return response.json(); };
    const version = await read('/api/version'), tags = await read('/api/tags');
    return { running: true, version: typeof version?.version === 'string' ? version.version.slice(0, 40) : null,
      models: (Array.isArray(tags?.models) ? tags.models : []).map(model => model?.name).filter(name => typeof name === 'string').slice(0, 500) };
  } catch { return { running: false, version: null, models: [] }; }
}
const hasTag = (names, tag) => names.includes(tag);

/** Beder Ollama hente en katalogmodel og melder samlet fremdrift for alle lag. */
async function pull({ tag, fetch = globalThis.fetch, baseURL = OLLAMA_URL, signal, onProgress = () => {} }) {
  if (!TAG.test(tag || '')) throw fail('Modelnavnet er ikke et gyldigt Ollama-navn.', 'LOCAL_TAG');
  let response;
  try { response = await fetch(baseURL + '/api/pull', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: tag, stream: true }) }); }
  catch { throw signal?.aborted ? fail('Hentningen blev afbrudt.', 'LOCAL_ABORTED') : fail('Ollama svarer ikke. Åbn Ollama, og prøv igen.', 'LOCAL_OLLAMA'); }
  if (!response.ok) throw fail(`Ollama svarede ${response.status}.`, 'LOCAL_OLLAMA');
  const layers = new Map(); let buffer = '', done = false;
  const read = line => {
    if (!line.trim()) return;
    let event; try { event = JSON.parse(line); } catch { return; }
    if (event.error) throw fail('Ollama kunne ikke hente modellen: ' + String(event.error).slice(0, 200), 'LOCAL_OLLAMA');
    if (event.digest && Number.isFinite(event.total)) layers.set(event.digest, { total: event.total, completed: Math.min(event.completed || 0, event.total) });
    let received = 0, total = 0; for (const layer of layers.values()) { received += layer.completed; total += layer.total; }
    if (event.status === 'success') done = true;
    onProgress({ received, total, status: String(event.status || '').slice(0, 60) });
  };
  try {
    const decoder = new TextDecoder();
    for await (const chunk of response.body) { buffer += decoder.decode(chunk, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop(); for (const line of lines) read(line); }
    read(buffer);
  } catch (error) {
    if (error.code) throw error;
    throw signal?.aborted ? fail('Hentningen blev afbrudt.', 'LOCAL_ABORTED') : fail('Forbindelsen til Ollama blev afbrudt under hentningen.', 'LOCAL_OLLAMA');
  }
  if (!done) throw fail('Ollama afsluttede ikke hentningen. Prøv igen.', 'LOCAL_OLLAMA');
  return { tag };
}
module.exports = { ollamaStatus, hasTag, pull, OLLAMA_URL, TAG };
