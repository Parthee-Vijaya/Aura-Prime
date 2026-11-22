const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { download, allowedSource } = require('../core/local-models/download.cjs');
const { ollamaStatus, hasTag, pull } = require('../core/local-models/ollama.cjs');

const body = crypto.randomBytes(300_000), digest = crypto.createHash('sha256').update(body).digest('hex');
async function fixture(t, handler) {
  const requests = [];
  const server = http.createServer((request, response) => { requests.push({ url: request.url, method: request.method, range: request.headers.range }); handler(request, response); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-local-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { base: `http://127.0.0.1:${server.address().port}`, requests, directory };
}
const ranged = (request, response) => {
  const from = request.headers.range ? Number(/bytes=(\d+)-/.exec(request.headers.range)[1]) : 0;
  response.writeHead(from ? 206 : 200, { 'content-length': body.length - from }); response.end(body.subarray(from));
};
const any = () => true;

test('only https downloads from the pinned hosts are allowed by default', () => {
  assert.equal(allowedSource('https://huggingface.co/a/b/resolve/x/y.gguf'), true);
  assert.equal(allowedSource('https://github.com/ggml-org/llama.cpp/releases/download/b1/x.tar.gz'), true);
  assert.equal(allowedSource('http://huggingface.co/a'), false);
  assert.equal(allowedSource('https://huggingface.co.evil.example/a'), false);
  assert.equal(allowedSource('file:///etc/passwd'), false);
});

test('a download is verified by size and checksum before it gets its final name', async t => {
  const { base, directory } = await fixture(t, ranged), file = path.join(directory, 'm', 'model.gguf'), seen = [];
  const result = await download({ url: base + '/model', file, bytes: body.length, sha256: digest, allowed: any, onProgress: p => seen.push(p) });
  assert.deepEqual(result, { file, resumed: false });
  assert.deepEqual(await fs.readFile(file), body);
  await assert.rejects(fs.stat(file + '.part'));
  assert.deepEqual(seen.at(-1), { received: body.length, total: body.length });
});

test('an interrupted download resumes from the bytes already on disk', async t => {
  const { base, directory, requests } = await fixture(t, ranged), file = path.join(directory, 'model.gguf');
  await fs.writeFile(file + '.part', body.subarray(0, 100_000));
  const result = await download({ url: base + '/model', file, bytes: body.length, sha256: digest, allowed: any });
  assert.equal(result.resumed, true);
  assert.equal(requests[0].range, 'bytes=100000-');
  assert.deepEqual(await fs.readFile(file), body);
});

test('a wrong checksum removes the file and explains what happened', async t => {
  const { base, directory } = await fixture(t, ranged), file = path.join(directory, 'model.gguf');
  await assert.rejects(download({ url: base + '/model', file, bytes: body.length, sha256: 'a'.repeat(64), allowed: any }), /kontrolsum/i);
  await assert.rejects(fs.stat(file)); await assert.rejects(fs.stat(file + '.part'));
});

test('a server error, a wrong size, a blocked address and a full disk are refused', async t => {
  const { base, directory } = await fixture(t, (request, response) => request.url === '/short' ? response.end('kort') : response.writeHead(503).end());
  const file = path.join(directory, 'model.gguf'), options = { file, bytes: body.length, sha256: digest };
  await assert.rejects(download({ ...options, url: base + '/fejl', allowed: any }), /503/);
  await assert.rejects(download({ ...options, url: base + '/short', allowed: any }), /størrelse/i);
  await assert.rejects(download({ ...options, url: base + '/model' }), /ikke en godkendt kilde/i);
  await assert.rejects(download({ ...options, url: base + '/model', allowed: any, freeBytes: async () => 1000 }), /diskplads/i);
});

test('an aborted download keeps its partial file for the next attempt', async t => {
  const { base, directory } = await fixture(t, (request, response) => { response.writeHead(200, { 'content-length': body.length }); response.write(body.subarray(0, 50_000)); });
  const file = path.join(directory, 'model.gguf'), controller = new AbortController();
  const pending = download({ url: base + '/model', file, bytes: body.length, sha256: digest, allowed: any, signal: controller.signal, onProgress: p => { if (p.received >= 50_000) controller.abort(); } });
  await assert.rejects(pending, /afbrudt/i);
  assert.equal((await fs.stat(file + '.part')).size, 50_000);
});

test('Ollama status lists installed models and tells a stopped server apart', async t => {
  const { base } = await fixture(t, (request, response) => request.url === '/api/version' ? response.end('{"version":"0.21.3"}') : response.end('{"models":[{"name":"qwen3:4b"},{"name":"ministral-3:latest"}]}'));
  assert.deepEqual(await ollamaStatus({ baseURL: base }), { running: true, version: '0.21.3', models: ['qwen3:4b', 'ministral-3:latest'] });
  assert.deepEqual(await ollamaStatus({ baseURL: 'http://127.0.0.1:9', timeout: 300 }), { running: false, version: null, models: [] });
  assert.equal(hasTag(['qwen3:4b'], 'qwen3:4b'), true);
  assert.equal(hasTag(['qwen3:4b-q8'], 'qwen3:4b'), false);
});

test('an Ollama pull reports summed progress and ends on success', async t => {
  const lines = [{ status: 'pulling manifest' }, { status: 'pulling a', digest: 'a', total: 100, completed: 40 }, { status: 'pulling b', digest: 'b', total: 50, completed: 50 }, { status: 'pulling a', digest: 'a', total: 100, completed: 100 }, { status: 'verifying sha256 digest' }, { status: 'success' }];
  const { base, requests } = await fixture(t, (request, response) => { let sent = ''; request.on('data', chunk => sent += chunk); request.on('end', () => { requests.at(-1).body = sent; response.end(lines.map(line => JSON.stringify(line)).join('\n') + '\n'); }); });
  const seen = [];
  await pull({ tag: 'qwen3:4b', baseURL: base, onProgress: p => seen.push(p) });
  assert.deepEqual(JSON.parse(requests[0].body), { model: 'qwen3:4b', stream: true });
  assert.deepEqual(seen.at(-1), { received: 150, total: 150, status: 'success' });
  assert.ok(seen.some(p => p.received === 90 && p.total === 150));
});

test('an Ollama pull refuses odd tags and surfaces the server error', async t => {
  const { base } = await fixture(t, (request, response) => response.end('{"error":"pull model manifest: file does not exist"}\n'));
  await assert.rejects(pull({ tag: 'qwen3:4b; rm -rf', baseURL: base }), /modelnavn/i);
  await assert.rejects(pull({ tag: 'qwen3:4b', baseURL: base }), /file does not exist/);
  const silent = await fixture(t, (request, response) => response.end('{"status":"pulling manifest"}\n'));
  await assert.rejects(pull({ tag: 'qwen3:4b', baseURL: silent.base }), /afsluttede ikke/i);
});
