// Indstillinger › Lokale modeller, set gennem den rigtige app: maskintjek og pasform, start og stop af den
// indbyggede motor, afprøvning af værktøjskald og hentning gennem Ollama. Motoren og Ollama er efterligninger
// med samme flag og svar som de rigtige; modelfilen er en tom fil med katalogets præcise størrelse.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const helpers = require('./ui-test-helpers.cjs');
const lock = require('../core/local-models/engine-lock.json');
const { findModel } = require('../core/local-models/catalog.cjs');

const FAKE_ENGINE = `#!/usr/bin/env node
const http = require('http'), a = process.argv.slice(2), get = n => a[a.indexOf(n) + 1]; let chats = 0;
const call = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
http.createServer((q, s) => {
  if (q.url === '/health') return s.end('{"status":"ok"}');
  if (q.url === '/v1/models') return s.end(JSON.stringify({ data: [{ id: get('--alias'), meta: { n_ctx: +get('--ctx-size') } }] }));
  if (q.url === '/v1/chat/completions') { q.resume(); return q.on('end', () => { const n = ++chats; s.end(JSON.stringify({ choices: [{ message: n === 1 ? call('read_file', { path: 'README.md' }) : n === 2 ? call('write_file', { path: 'noter.txt', content: 'Hej Aura' }) : { role: 'assistant', content: 'Tallet er 42.' } }] })); }); }
  s.writeHead(404).end();
}).listen(+get('--port'), get('--host'));
process.on('SIGTERM', () => process.exit(0));
`;
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-local-models-ui-')); let app;
  const pulled = [], tags = [];
  const ollama = http.createServer((request, response) => {
    if (request.url === '/api/version') return response.end('{"version":"0.21.3"}');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: tags.map(name => ({ name })) }));
    if (request.url === '/api/pull') { let body = ''; request.on('data', chunk => body += chunk); return request.on('end', async () => {
      const tag = JSON.parse(body).model; pulled.push(tag);
      for (const line of [{ status: 'pulling manifest' }, { status: 'pulling a', digest: 'a', total: 2_000_000_000, completed: 900_000_000 }, { status: 'pulling a', digest: 'a', total: 2_000_000_000, completed: 2_000_000_000 }, { status: 'success' }]) { response.write(JSON.stringify(line) + '\n'); await new Promise(resolve => setTimeout(resolve, 150)); }
      tags.push(tag); response.end();
    }); }
    response.writeHead(404).end();
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  try {
    const fixture = path.join(root, 'fixture.json');
    await fs.writeFile(fixture, JSON.stringify({ hardware: { platform: 'darwin', arch: 'arm64', totalBytes: 16 * 1024 ** 3, cpuModel: 'Apple M3' }, ollamaURL: `http://127.0.0.1:${ollama.address().port}` }));
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, HARNESS_LOCAL_MODELS_FIXTURE: fixture } });
    await helpers.isolateDocuments(app, path.join(root, 'Dokumenter'));
    const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await helpers.skipIntroduction(page); await helpers.toOnboarding(page);
    // En hentet model og en installeret motor, lagt hvor appen selv ville lægge dem.
    const local = path.join(await app.evaluate(({ app }) => app.getPath('userData')), 'harness', 'local-models'), model = findModel('qwen3-4b');
    await fs.mkdir(path.join(local, 'engine', lock.llama), { recursive: true });
    await fs.writeFile(path.join(local, 'engine', lock.llama, 'llama-server'), FAKE_ENGINE, { mode: 0o755 });
    await fs.mkdir(path.join(local, 'models', model.id), { recursive: true });
    await (await fs.open(path.join(local, 'models', model.id, model.gguf.file), 'w')).close();
    await fs.truncate(path.join(local, 'models', model.id, model.gguf.file), model.gguf.bytes);

    // På startsiden er sidepanelet skjult; menupunktet åbnes ad appens egen vej, som de øvrige prøver gør.
    await page.evaluate(() => document.querySelector('#local-models-button').click());
    await page.waitForFunction(() => document.querySelectorAll('#settings-content .local-model').length === 8);
    const row = id => page.locator(`#settings-content .local-model[data-model="${id}"]`);
    const text = selector => page.locator(selector).innerText();
    assert.match(await text('#settings-content .local-machine'), /Apple M3 med 16 GB hukommelse/);
    assert.equal(await text('#settings-section-title'), 'Lokale modeller');
    // Pasform: 4B passer med fuld arbejdshukommelse, 8B er stram, 24B er for stor på 16 GB.
    assert.equal(await row('qwen3-4b').locator('.local-fit').innerText(), 'Passer');
    assert.equal(await row('qwen3-4b').locator('.local-best').count(), 1);
    assert.equal(await page.locator('#settings-content .local-best').count(), 1, 'kun én model anbefales');
    assert.equal(await row('qwen3-8b').locator('.local-fit').innerText(), 'Stramt');
    assert.equal(await row('devstral-small').locator('.local-fit').innerText(), 'For stor');
    assert.equal(await row('devstral-small').locator('.local-actions button').first().isDisabled(), true, 'en for stor model kan ikke hentes');
    assert.match(await row('ministral-3-3b').locator('.local-actions button').first().innerText(), /^Hent · 2,1 GB$/);
    await page.screenshot({ path: path.join(process.env.AURA_SHOT_DIR || root, 'local-models-oversigt.png') });

    // Brug: motoren startes på denne computer, og forbindelsen «Aura lokal motor» gemmes.
    await row('qwen3-4b').getByRole('button', { name: 'Brug', exact: true }).click();
    await row('qwen3-4b').locator('.local-status').waitFor();
    assert.equal(await row('qwen3-4b').locator('.local-status').innerText(), 'Kører');
    assert.match(await text('#settings-feedback'), /Qwen3 4B kører\. Vælg «Aura lokal motor»/);
    const connections = async () => (await page.evaluate(() => window.harness.connectionState())).value.connections;
    const builtin = (await connections()).find(item => item.kind === 'builtin');
    assert.deepEqual([builtin.name, builtin.baseURL], ['Aura lokal motor', 'http://127.0.0.1:11617/v1']);
    // Modelkataloget for forbindelsen læser den kørende kontekst fra motoren.
    const listed = (await page.evaluate(id => window.harness.models(id), builtin.id)).value;
    assert.deepEqual([listed[0].id, listed[0].limits.context], ['qwen3-4b', 32768]);

    // Afprøvning af værktøjskald gemmes og vises med dato.
    await row('qwen3-4b').getByRole('button', { name: 'Afprøv værktøjskald' }).click();
    await row('qwen3-4b').locator('.local-probe[data-passed="true"]').waitFor();
    assert.match(await row('qwen3-4b').locator('.local-probe').innerText(), /^Værktøjskald afprøvet \d+\.\d+\.\d{4}: bestået$/);
    await page.screenshot({ path: path.join(process.env.AURA_SHOT_DIR || root, 'local-models-koerer.png') });
    await row('qwen3-4b').getByRole('button', { name: 'Stop' }).click();
    await row('qwen3-4b').getByRole('button', { name: 'Brug', exact: true }).waitFor();
    assert.equal(await row('qwen3-4b').locator('.local-status').count(), 0);
    await assert.rejects(fetch('http://127.0.0.1:11617/health'), 'motoren er stoppet');

    // Ollama som alternativ: hentning med fremdrift, derefter en gemt Ollama-forbindelse.
    await row('ministral-3-3b').locator('.local-alternative summary').click();
    await row('ministral-3-3b').getByRole('button', { name: 'Hent med Ollama (ministral-3:3b)' }).click();
    await row('ministral-3-3b').locator('.local-progress').waitFor();
    await page.waitForFunction(() => /Ministral 3 3B er hentet i Ollama/.test(document.querySelector('#settings-feedback')?.textContent || ''));
    assert.deepEqual(pulled, ['ministral-3:3b']);
    assert.equal(await row('ministral-3-3b').locator('.local-alternative').evaluate(node => node.open), true, 'det åbnede afsnit bliver stående åbent');
    await row('ministral-3-3b').getByRole('button', { name: 'Brug med Ollama' }).click();
    await page.waitForFunction(() => /Vælg «Ollama på denne computer» og modellen ministral-3:3b/.test(document.querySelector('#settings-feedback')?.textContent || ''));
    assert.equal((await connections()).filter(item => item.kind === 'ollama').length, 1);
    assert.deepEqual(errors, [], 'ingen fejl i vinduet');
    console.log('Lokale modeller: oversigt, start og stop, afprøvning og Ollama-hentning er bestået.');
  } finally { await app?.close().catch(() => {}); await new Promise(resolve => { ollama.closeAllConnections(); ollama.close(resolve); }); await fs.rm(root, { recursive: true, force: true }).catch(() => {}); }
})().catch(error => { console.error(error); process.exit(1); });
