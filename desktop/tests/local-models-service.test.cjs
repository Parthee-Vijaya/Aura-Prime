const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalModels } = require('../core/local-models/service.cjs');
const { describeHardware } = require('../core/local-models/hardware.cjs');

const GiB = 1024 ** 3;
function stubs(t, overrides = {}) {
  const log = [], downloaded = new Set(), state = { running: null, installed: false };
  const engine = {
    port: 11617, baseURL: 'http://127.0.0.1:11617/v1',
    engineState: async () => ({ supported: true, version: 'b1', installed: state.installed }),
    installEngine: async ({ onProgress }) => { log.push('install'); onProgress({ received: 5, total: 10 }); state.installed = true; },
    modelState: async model => ({ downloaded: downloaded.has(model.id), partialBytes: 0 }),
    downloadModel: async (model, { onProgress, signal }) => { log.push('download:' + model.id); onProgress({ received: 1, total: model.gguf.bytes }); if (overrides.hang) await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('Hentningen blev afbrudt.'), { code: 'LOCAL_ABORTED' })))); downloaded.add(model.id); },
    removeModel: async model => { log.push('remove:' + model.id); downloaded.delete(model.id); },
    start: async (model, { context }) => { log.push(`start:${model.id}:${context}`); state.running = { modelID: model.id, context }; return { ...state.running, baseURL: engine.baseURL }; },
    stop: async () => { log.push('stop'); state.running = null; },
    running: () => state.running
  };
  const events = [];
  const options = { engine, emit: event => events.push(event), now: () => 1_800_000_000_000,
    hardware: async () => describeHardware({ platform: 'darwin', arch: 'arm64', totalBytes: 16 * GiB, cpuModel: 'Apple M3' }),
    ollama: { status: async () => ({ running: true, version: '0.21.3', models: ['qwen3:4b'] }), pull: async ({ tag, onProgress }) => { log.push('pull:' + tag); onProgress({ received: 10, total: 10, status: 'success' }); } },
    probe: async ({ baseURL, model }) => { log.push(`probe:${baseURL}:${model}`); return { passed: true, checks: [{ id: 'kald', label: 'Kalder et værktøj', ok: true, detail: 'Bestået' }] }; }, ...overrides.options };
  return { log, events, engine, options };
}
async function service(t, overrides) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-service-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const parts = stubs(t, overrides);
  return { ...parts, directory, models: new LocalModels({ directory, ...parts.options }) };
}

test('the overview joins hardware, catalog fit, Ollama and the built-in engine', async t => {
  const { models } = await service(t);
  const view = await models.overview();
  assert.deepEqual(view.hardware, { chip: 'Apple M3', memoryBytes: 16 * GiB, budgetBytes: Math.floor(12 * GiB * 2 / 3), kind: 'apple-silicon', slow: false });
  assert.deepEqual(view.ollama, { running: true, version: '0.21.3' });
  assert.deepEqual(view.engine, { supported: true, version: 'b1', installed: false, running: null, port: 11617 });
  assert.equal(view.best, 'qwen3-4b');
  assert.equal(view.job, null);
  const qwen = view.models.find(model => model.id === 'qwen3-4b');
  assert.deepEqual(qwen.state, { ollama: true, builtin: false, partialBytes: 0, probes: { ollama: null, builtin: null } });
  assert.equal(view.models.find(model => model.id === 'ministral-3-3b').state.ollama, false);
});

test('with data rules on, Ollama is not contacted and its models are not listed', async t => {
  let asked = 0;
  const { models } = await service(t, { options: { ollama: { status: async () => { asked += 1; return { running: true, version: '0.21.3', models: ['qwen3:4b'] }; }, pull: async () => {} } } });
  const view = await models.overview({ ollama: false });
  assert.deepEqual([asked, view.ollama], [0, { running: false, version: null, blocked: true }]);
  assert.equal(view.models.find(model => model.id === 'qwen3-4b').state.ollama, false);
});

test('a built-in download installs the engine first, reports progress and announces the change', async t => {
  const { models, log, events } = await service(t);
  await models.download('qwen3-4b');
  assert.deepEqual(log, ['install', 'download:qwen3-4b']);
  assert.deepEqual(events.filter(event => event.type === 'local-models.progress').map(event => event.job.phase), ['engine', 'model']);
  assert.equal(events.at(-1).type, 'local-models.changed');
  assert.equal((await models.overview()).models.find(model => model.id === 'qwen3-4b').state.builtin, true);
  await models.download('qwen3-4b');
  assert.deepEqual(log.slice(2), ['download:qwen3-4b']);
});

test('only one job runs at a time, and cancel stops it', async t => {
  const { models } = await service(t, { hang: true });
  const pending = models.download('qwen3-4b');
  await new Promise(resolve => setTimeout(resolve, 20));
  await assert.rejects(models.pull('qwen3-4b'), /allerede i gang/i);
  assert.equal((await models.overview()).job.model, 'qwen3-4b');
  models.cancel();
  await assert.rejects(pending, /afbrudt/i);
  assert.equal((await models.overview()).job, null);
});

test('start uses the context that fits the machine and refuses a model that is too big', async t => {
  const { models, log } = await service(t);
  await models.download('qwen3-8b');
  assert.deepEqual(await models.start('qwen3-8b'), { modelID: 'qwen3-8b', context: 16384, baseURL: 'http://127.0.0.1:11617/v1' });
  assert.ok(log.includes('start:qwen3-8b:16384'));
  await assert.rejects(models.start('devstral-small'), /for stor/i);
  await assert.rejects(models.start('findes-ikke'), /ikke i kataloget/i);
  await models.stop();
  assert.equal((await models.overview()).engine.running, null);
});

test('a probe is stored per source and survives a restart; removing a model clears it', async t => {
  const { models, log, directory, options } = await service(t);
  await models.download('qwen3-4b');
  const built = await models.probe('qwen3-4b', 'builtin');
  assert.equal(built.passed, true);
  assert.ok(log.includes('start:qwen3-4b:32768') && log.includes('probe:http://127.0.0.1:11617/v1:qwen3-4b'));
  await models.probe('qwen3-4b', 'ollama');
  assert.ok(log.includes('probe:http://127.0.0.1:11434/v1:qwen3:4b'));
  const again = new LocalModels({ directory, ...options });
  const state = (await again.overview()).models.find(model => model.id === 'qwen3-4b').state;
  assert.deepEqual([state.probes.builtin.passed, state.probes.builtin.at, state.probes.ollama.passed], [true, '2027-01-15T08:00:00.000Z', true]);
  await assert.rejects(models.probe('ministral-3-3b', 'ollama'), /hent modellen/i);
  await assert.rejects(models.probe('qwen3-4b', 'andet'), /ukendt/i);
  await again.remove('qwen3-4b');
  assert.equal((await again.overview()).models.find(model => model.id === 'qwen3-4b').state.probes.builtin, null);
});

test('with data rules on, a probe through Ollama is refused before anything is sent', async t => {
  const { models, log } = await service(t);
  await assert.rejects(models.probe('qwen3-4b', 'ollama', { ollama: false }), { code: 'LOCAL_BLOCKED', message: /dataregler/ });
  assert.deepEqual(log.filter(line => line.startsWith('probe:')), []);
});

test('an Ollama pull uses the catalog tag and needs a running Ollama', async t => {
  const { models, log } = await service(t);
  await models.pull('ministral-3-3b');
  assert.deepEqual(log, ['pull:ministral-3:3b']);
  const stopped = await service(t, { options: { ollama: { status: async () => ({ running: false, version: null, models: [] }), pull: async () => { throw new Error('skal ikke kaldes'); } } } });
  await assert.rejects(stopped.models.pull('ministral-3-3b'), /Ollama kører ikke/i);
});
