const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { definitions, normalize, listModels, modelLimits, modelCatalogURL } = require('../core/connections.cjs');
const { EXTERNAL } = require('../core/privacy-product-boundary.cjs');
const { DEFAULT_PORT } = require('../core/local-models/engine.cjs');

test('the built-in engine is a keyless local connection with a fixed loopback address', () => {
  const def = definitions.builtin;
  assert.deepEqual([def.name, def.group, def.keyRequired, def.protocol, def.baseURL], ['Aura lokal motor', 'local', false, 'openai', `http://127.0.0.1:${DEFAULT_PORT}/v1`]);
  assert.equal(def.editableBaseURL, undefined);
  const saved = normalize({ kind: 'builtin', name: 'Aura lokal motor', baseURL: 'https://andet.example/v1' });
  assert.equal(saved.baseURL, def.baseURL);
  assert.equal(modelCatalogURL(saved), def.baseURL + '/models');
  assert.match(def.training, /denne computer/);
});

test('a llama.cpp model list gives the running context, so replies never outgrow it', async t => {
  const server = http.createServer((request, response) => response.end(JSON.stringify({ object: 'list', data: [{ id: 'qwen3-8b', object: 'model', owned_by: 'llamacpp', meta: { n_ctx: 16384, n_ctx_train: 40960 } }] })));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const connection = { id: 'c1', kind: 'builtin', name: 'Aura lokal motor', baseURL: `http://127.0.0.1:${server.address().port}/v1` };
  const [model] = await listModels(connection, '');
  assert.deepEqual([model.id, model.limits.context], ['qwen3-8b', 16384]);
  assert.deepEqual(modelLimits(connection, model), { context: 16384, output: 8192 });
});

test('fetching a model or the engine counts as external communication', () => {
  for (const channel of ['local-models:pull', 'local-models:download']) assert.equal(EXTERNAL.has(channel), true, channel);
  for (const channel of ['local-models:overview', 'local-models:start', 'local-models:stop', 'local-models:probe', 'local-models:cancel', 'local-models:remove']) assert.equal(EXTERNAL.has(channel), false, channel);
});
