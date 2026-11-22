const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalEngine } = require('../core/local-models/engine.cjs');
const { probeToolCalls } = require('../core/local-models/probe.cjs');

// Kører kun, når en rigtig llama.cpp-server og en rigtig modelfil er angivet:
//   AURA_TEST_LLAMA_SERVER=/sti/til/llama-server AURA_TEST_GGUF=/sti/til/model.gguf npm test
const binary = process.env.AURA_TEST_LLAMA_SERVER, gguf = process.env.AURA_TEST_GGUF;
test('a real llama.cpp server starts a real model, reports its context and answers the tool probe', { skip: !(binary && gguf) && 'ingen rigtig motor angivet', timeout: 600_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-live-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const engine = new LocalEngine({ directory, port: 11699 });
  t.after(() => engine.stop());
  // Motorens mappe peger på den rigtige servers mappe, så dens egne biblioteker følger med.
  await fs.mkdir(path.dirname(engine.engineDirectory), { recursive: true });
  await fs.symlink(path.dirname(binary), engine.engineDirectory);
  const model = { id: 'live-model', gguf: { repo: 'x/y', file: path.basename(gguf), revision: '0'.repeat(40), bytes: (await fs.stat(gguf)).size, sha256: '0'.repeat(64) } };
  await fs.mkdir(path.dirname(engine.modelFile(model)), { recursive: true });
  await fs.symlink(gguf, engine.modelFile(model));
  const context = Number(process.env.AURA_TEST_CONTEXT || 4096);
  const started = await engine.start(model, { context });
  assert.equal(started.baseURL, 'http://127.0.0.1:11699/v1');
  const listed = (await (await fetch(started.baseURL + '/models')).json()).data[0];
  assert.deepEqual([listed.id, listed.meta.n_ctx], ['live-model', context]);
  const result = await probeToolCalls({ baseURL: started.baseURL, model: 'live-model' });
  assert.equal(result.checks.length, 3);
  for (const check of result.checks) t.diagnostic(`${check.id}: ${check.ok ? 'bestået' : check.detail}`);
  t.diagnostic(`samlet: ${result.passed ? 'bestået' : 'ikke bestået'}`);
  await engine.stop();
  await assert.rejects(fetch(started.baseURL + '/models'));
});
