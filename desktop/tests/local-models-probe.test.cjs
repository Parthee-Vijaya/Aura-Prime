const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { probeToolCalls, CHECKS } = require('../core/local-models/probe.cjs');

async function fake(t, answer) {
  const requests = [];
  const server = http.createServer((request, response) => { let body = ''; request.on('data', chunk => body += chunk); request.on('end', () => { const parsed = JSON.parse(body); requests.push(parsed); response.end(JSON.stringify({ choices: [{ message: answer(parsed, requests.length) }] })); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { baseURL: `http://127.0.0.1:${server.address().port}/v1`, requests };
}
const call = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }] });
const good = (request, n) => n === 1 ? call('read_file', { path: 'README.md' }) : n === 2 ? call('write_file', { path: 'noter.txt', content: 'Hej Aura' }) : { role: 'assistant', content: 'Tallet er 42.' };

test('a model that calls the tools correctly and then answers passes all three checks', async t => {
  const { baseURL, requests } = await fake(t, good);
  const result = await probeToolCalls({ baseURL, model: 'qwen3:4b' });
  assert.equal(result.passed, true);
  assert.deepEqual(result.checks.map(check => [check.id, check.ok]), CHECKS.map(check => [check.id, true]));
  assert.equal(requests.length, 3);
  assert.deepEqual([requests[0].model, requests[0].temperature, requests[0].stream, requests[0].tools.length], ['qwen3:4b', 0, false, 2]);
  assert.equal(requests[2].messages.at(-1).role, 'tool');
});

test('plain text instead of a tool call, broken arguments and a needless extra call all fail', async t => {
  const talk = await fake(t, () => ({ role: 'assistant', content: 'Jeg kan desværre ikke læse filer.' }));
  const talked = await probeToolCalls({ baseURL: talk.baseURL, model: 'm' });
  assert.equal(talked.passed, false);
  assert.match(talked.checks[0].detail, /uden at kalde/i);
  const broken = await fake(t, (request, n) => n === 2 ? call('write_file', '{"path": "noter.txt", ') : good(request, n));
  assert.deepEqual((await probeToolCalls({ baseURL: broken.baseURL, model: 'm' })).checks.map(check => check.ok), [true, false, true]);
  const eager = await fake(t, (request, n) => n === 3 ? call('read_file', { path: 'data.txt' }) : good(request, n));
  const result = await probeToolCalls({ baseURL: eager.baseURL, model: 'm' });
  assert.deepEqual([result.passed, result.checks[2].ok], [false, false]);
});

test('the probe only talks to this computer and reports a silent server as a failure', async t => {
  await assert.rejects(probeToolCalls({ baseURL: 'https://api.example.com/v1', model: 'm' }), /kun .* denne computer/i);
  const result = await probeToolCalls({ baseURL: 'http://127.0.0.1:9/v1', model: 'm', timeout: 500 });
  assert.equal(result.passed, false);
  assert.match(result.checks[0].detail, /svarede ikke/i);
  assert.equal(result.checks.length, 3);
});
