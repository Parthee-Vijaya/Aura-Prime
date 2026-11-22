// Kvalificerer den indbyggede motor med de rigtige, fastlåste filer på denne computer:
// henter llama.cpp fra GitHub, kontrollerer kontrolsummen, pakker ud, henter en lille rigtig
// model fra Hugging Face, starter den og afprøver værktøjskald. Kræver netværk og ca. 700 MB.
//   node scripts/verify-local-engine.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalEngine } = require('../core/local-models/engine.cjs');
const { probeToolCalls } = require('../core/local-models/probe.cjs');

// En lille model, der kun bruges til denne prøve. Den står ikke i appens katalog.
const MODEL = { id: 'qwen3-0.6b-proeve', gguf: { repo: 'Qwen/Qwen3-0.6B-GGUF', file: 'Qwen3-0.6B-Q8_0.gguf', revision: '23749fefcc72300e3a2ad315e1317431b06b590a', bytes: 639446688, sha256: '9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031' } };
const CONTEXT = 8192;
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-engine-proeve-')), engine = new LocalEngine({ directory, port: 11698 }), started = Date.now();
  const step = (name, detail = '') => console.log(`${String(Math.round((Date.now() - started) / 1000)).padStart(4)} s  ${name}${detail ? ': ' + detail : ''}`);
  try {
    const state = await engine.engineState();
    assert.equal(state.supported, true, `Motoren er ikke fastlåst til ${process.platform}-${process.arch}.`);
    step('Platform', `${process.platform}-${process.arch}, ${os.cpus()[0]?.model}, ${Math.round(os.totalmem() / 1024 ** 3)} GB`);
    await engine.installEngine();
    assert.equal((await engine.engineState()).installed, true);
    step('Motor hentet, kontrolleret og pakket ud', `llama.cpp ${state.version}`);
    await engine.downloadModel(MODEL);
    assert.equal((await engine.modelState(MODEL)).downloaded, true);
    step('Model hentet og kontrolleret', MODEL.gguf.file);
    const running = await engine.start(MODEL, { context: CONTEXT });
    const listed = (await (await fetch(running.baseURL + '/models')).json()).data[0];
    assert.deepEqual([listed.id, listed.meta.n_ctx], [MODEL.id, CONTEXT]);
    step('Motor startet', `${running.baseURL}, kontekst ${listed.meta.n_ctx}`);
    const result = await probeToolCalls({ baseURL: running.baseURL, model: MODEL.id });
    for (const check of result.checks) step(`Værktøjskald – ${check.label}`, check.detail);
    assert.equal(result.passed, true, 'Afprøvningen af værktøjskald blev ikke bestået.');
    await engine.stop();
    await assert.rejects(fetch(running.baseURL + '/models'));
    step('Motor stoppet');
    console.log('Den indbyggede motor er kvalificeret på denne computer.');
  } finally { await engine.stop().catch(() => {}); await fs.rm(directory, { recursive: true, force: true }).catch(() => {}); }
})().catch(error => { console.error(error.message || error); process.exit(1); });
