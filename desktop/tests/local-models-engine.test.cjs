const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalEngine, DEFAULT_PORT } = require('../core/local-models/engine.cjs');
const lock = require('../core/local-models/engine-lock.json');

const skip = process.platform === 'win32';
// En lille efterligning af llama-server: samme flag, samme svar på /health og /v1/models.
const FAKE = `#!/usr/bin/env node
const http = require('http'), a = process.argv.slice(2), get = n => a[a.indexOf(n) + 1];
if (process.env.FAKE_FAIL) { console.error('error: failed to allocate buffer'); process.exit(1); }
http.createServer((q, s) => q.url === '/health' ? s.end('{"status":"ok"}') : q.url === '/v1/models' ? s.end(JSON.stringify({ data: [{ id: get('--alias'), meta: { n_ctx: +get('--ctx-size') } }] })) : s.writeHead(404).end())
  .listen(+get('--port'), get('--host'));
process.on('SIGTERM', () => process.exit(0));
`;
const model = { id: 'lille-model', gguf: { repo: 'aura/test', file: 'lille.gguf', revision: 'f'.repeat(40), bytes: 4096, sha256: '' } };
const modelBytes = crypto.randomBytes(4096); model.gguf.sha256 = crypto.createHash('sha256').update(modelBytes).digest('hex');
const freePort = () => new Promise(resolve => { const s = http.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

async function setup(t, { env } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-engine-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const pack = path.join(directory, 'pack', 'llama-test'); await fs.mkdir(pack, { recursive: true });
  await fs.writeFile(path.join(pack, 'llama-server'), FAKE, { mode: 0o755 });
  execFileSync('tar', ['-czf', path.join(directory, 'engine.tar.gz'), '-C', path.join(directory, 'pack'), 'llama-test']);
  const archive = await fs.readFile(path.join(directory, 'engine.tar.gz'));
  const server = http.createServer((request, response) => request.url.endsWith('.gguf') ? response.end(modelBytes) : request.url === '/engine.tar.gz' ? response.end(archive) : response.writeHead(404).end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const testLock = { llama: 'test', targets: { 'test-arm64': { name: 'engine.tar.gz', url: base + '/engine.tar.gz', checksum: crypto.createHash('sha256').update(archive).digest('hex'), bytes: archive.length } } };
  const engine = new LocalEngine({ directory: path.join(directory, 'data'), platform: 'test', arch: 'arm64', lock: testLock, port: await freePort(), allowed: () => true, modelURL: () => base + '/lille.gguf', env });
  t.after(() => engine.stop());
  return { engine, directory, base };
}

test('the pinned engine release names a verified archive for the released platform', () => {
  assert.match(lock.llama, /^b\d+$/);
  for (const target of ['darwin-arm64', 'linux-x64']) {
    const entry = lock.targets[target];
    assert.ok(entry.url.startsWith(`https://github.com/ggml-org/llama.cpp/releases/download/${lock.llama}/llama-${lock.llama}-bin-`));
    assert.match(entry.checksum, /^[0-9a-f]{64}$/);
    assert.ok(entry.bytes > 5_000_000 && entry.url.endsWith(entry.name));
  }
  assert.equal(DEFAULT_PORT, 11617);
});

test('an unsupported platform says so and refuses to install', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-engine-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const engine = new LocalEngine({ directory, platform: 'win32', arch: 'x64' });
  assert.deepEqual(await engine.engineState(), { supported: false, version: lock.llama, installed: false });
  await assert.rejects(engine.installEngine(), /findes endnu ikke til denne/i);
});

test('install verifies and unpacks the engine; a model is downloaded, started, replaced and stopped', { skip }, async t => {
  const { engine } = await setup(t), seen = [];
  assert.equal((await engine.engineState()).installed, false);
  await assert.rejects(engine.start(model, { context: 8192 }), /hent motoren/i);
  await engine.installEngine({ onProgress: p => seen.push(p) });
  assert.deepEqual(await engine.engineState(), { supported: true, version: 'test', installed: true });
  assert.ok(seen.length && seen.at(-1).received === seen.at(-1).total);
  await assert.rejects(engine.start(model, { context: 8192 }), /hent modellen/i);
  assert.deepEqual(await engine.modelState(model), { downloaded: false, partialBytes: 0 });
  await engine.downloadModel(model);
  assert.deepEqual(await engine.modelState(model), { downloaded: true, partialBytes: 0 });
  const started = await engine.start(model, { context: 16384 });
  assert.deepEqual(started, { modelID: 'lille-model', context: 16384, baseURL: engine.baseURL });
  assert.deepEqual(engine.running(), { modelID: 'lille-model', context: 16384 });
  assert.equal((await (await fetch(engine.baseURL + '/models')).json()).data[0].meta.n_ctx, 16384);
  const again = await engine.start(model, { context: 8192 });
  assert.equal(again.context, 8192);
  await engine.stop();
  assert.equal(engine.running(), null);
  await assert.rejects(fetch(engine.baseURL + '/models'));
  await engine.removeModel(model);
  assert.equal((await engine.modelState(model)).downloaded, false);
});

test('a tampered engine archive is refused', { skip }, async t => {
  const { engine } = await setup(t);
  engine.lock.targets['test-arm64'].checksum = 'b'.repeat(64);
  await assert.rejects(engine.installEngine(), /kontrolsum/i);
  assert.equal((await engine.engineState()).installed, false);
});

test('an engine that dies during start explains why, and a busy port is not taken over', { skip }, async t => {
  const failing = await setup(t, { env: { FAKE_FAIL: '1' } });
  await failing.engine.installEngine(); await failing.engine.downloadModel(model);
  await assert.rejects(failing.engine.start(model, { context: 8192 }), /hukommelse/i);
  assert.equal(failing.engine.running(), null);
  const busy = await setup(t);
  await busy.engine.installEngine(); await busy.engine.downloadModel(model);
  const other = http.createServer((q, s) => s.end('{"status":"ok"}')); await new Promise(resolve => other.listen(busy.engine.port, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => other.close(resolve)));
  await assert.rejects(busy.engine.start(model, { context: 8192 }), /porten .* er optaget/i);
});
