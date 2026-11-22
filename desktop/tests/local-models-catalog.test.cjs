const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeHardware, probeHardware } = require('../core/local-models/hardware.cjs');
const { models, fit, recommend, requirement, findModel, CONTEXTS } = require('../core/local-models/catalog.cjs');

const GB = 1e9, GiB = 1024 ** 3;
const mac = gib => describeHardware({ platform: 'darwin', arch: 'arm64', totalBytes: gib * GiB, cpuModel: 'Apple M3' });

test('every catalog model is pinned to a verified file, licence and tool template', () => {
  assert.ok(models.length >= 6);
  assert.equal(new Set(models.map(model => model.id)).size, models.length);
  for (const model of models) {
    assert.match(model.id, /^[a-z0-9][a-z0-9.-]{1,40}$/);
    assert.match(model.gguf.repo, /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/);
    assert.match(model.gguf.file, /^[A-Za-z0-9._-]+\.gguf$/);
    assert.match(model.gguf.revision, /^[0-9a-f]{40}$/);
    assert.match(model.gguf.sha256, /^[0-9a-f]{64}$/);
    assert.ok(model.gguf.bytes > GB && model.gguf.kvBytesPerToken > 0);
    assert.match(model.ollama.tag, /^[a-z0-9][a-z0-9._-]*:[a-z0-9._-]+$/);
    assert.equal(model.license, 'apache-2.0');
    assert.equal(model.toolsInTemplate, true);
    for (const field of ['name', 'publisher', 'origin', 'parameters', 'note']) assert.ok(model[field]);
  }
});

test('Apple Silicon gets two thirds of what is left after 4 GB is kept free', () => {
  const hardware = mac(16);
  assert.equal(hardware.kind, 'apple-silicon');
  assert.equal(hardware.budgetBytes, Math.floor(12 * GiB * 2 / 3));
  assert.equal(hardware.slow, false);
  assert.equal(hardware.chip, 'Apple M3');
});

test('a dedicated NVIDIA card sets the budget; a plain processor is marked slow', () => {
  const nvidia = describeHardware({ platform: 'linux', arch: 'x64', totalBytes: 64 * GiB, cpuModel: 'Xeon', gpus: [{ name: 'RTX 4090', vramBytes: 24 * GiB }, { name: 'RTX 3060', vramBytes: 12 * GiB }] });
  assert.equal(nvidia.kind, 'nvidia');
  assert.equal(nvidia.budgetBytes, Math.floor(24 * GiB * 0.9));
  const cpu = describeHardware({ platform: 'win32', arch: 'x64', totalBytes: 16 * GiB, cpuModel: 'Core i5' });
  assert.deepEqual([cpu.kind, cpu.slow, cpu.budgetBytes], ['cpu', true, 6 * GiB]);
  assert.equal(describeHardware({ platform: 'darwin', arch: 'arm64', totalBytes: 2 * GiB }).budgetBytes, 0);
});

test('the probe reads memory and chip and survives a missing nvidia-smi', async () => {
  const os = { platform: () => 'linux', arch: () => 'x64', totalmem: () => 32 * GiB, cpus: () => [{ model: 'Ryzen 7' }] };
  const none = await probeHardware({ os, run: async () => { throw new Error('ENOENT'); } });
  assert.deepEqual([none.kind, none.chip, none.memoryBytes], ['cpu', 'Ryzen 7', 32 * GiB]);
  const card = await probeHardware({ os, run: async command => { assert.equal(command, 'nvidia-smi'); return 'NVIDIA RTX A2000, 12282\n'; } });
  assert.deepEqual([card.kind, card.gpus[0].name, card.gpus[0].vramBytes], ['nvidia', 'NVIDIA RTX A2000', 12282 * 1024 * 1024]);
  const apple = await probeHardware({ os: { platform: () => 'darwin', arch: () => 'arm64', totalmem: () => 96 * GiB, cpus: () => [{ model: 'Apple M3 Ultra' }] }, run: async () => { throw new Error('skal ikke kaldes'); } });
  assert.deepEqual([apple.kind, apple.chip], ['apple-silicon', 'Apple M3 Ultra']);
});

test('requirement adds weights, context memory and a fixed overhead', () => {
  const model = findModel('ministral-3-3b');
  assert.equal(requirement(model, 16384), model.gguf.bytes + model.gguf.kvBytesPerToken * 16384 + GiB);
});

test('fit picks the largest context that stays inside the budget', () => {
  const small = mac(16);
  assert.deepEqual([fit(findModel('ministral-3-3b'), small).status, fit(findModel('ministral-3-3b'), small).context], ['fits', 32768]);
  assert.deepEqual([fit(findModel('qwen3-8b'), small).status, fit(findModel('qwen3-8b'), small).context], ['tight', 16384]);
  assert.deepEqual([fit(findModel('devstral-small'), small).status, fit(findModel('devstral-small'), small).context], ['too-big', null]);
  for (const model of models) assert.equal(fit(model, mac(96)).status, 'fits');
  const model = findModel('ministral-3-3b');
  const onlyChat = { ...small, budgetBytes: requirement(model, 8192) + 1 };
  assert.deepEqual([fit(model, onlyChat).status, fit(model, onlyChat).context], ['chat-only', 8192]);
  assert.deepEqual(CONTEXTS, [32768, 16384, 8192]);
});

test('recommend marks the largest model that fits with full context', () => {
  const list = recommend(mac(16));
  assert.equal(list.best, 'qwen3-4b');
  assert.equal(list.models.length, models.length);
  const entry = list.models.find(model => model.id === 'qwen3-4b');
  assert.deepEqual(Object.keys(entry).sort(), ['bytes', 'fit', 'id', 'license', 'name', 'note', 'ollama', 'origin', 'parameters', 'publisher', 'source'].sort());
  assert.equal(entry.source, 'https://huggingface.co/Qwen/Qwen3-4B-GGUF');
  assert.equal(recommend(mac(8)).best, null);
  assert.equal(recommend(mac(32)).best, 'gpt-oss-20b');
  assert.equal(findModel('findes-ikke'), null);
});
