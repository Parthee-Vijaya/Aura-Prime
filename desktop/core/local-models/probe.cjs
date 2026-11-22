// SPDX-License-Identifier: EUPL-1.2
'use strict';
// Afprøvning af værktøjskald. En kodeagent arbejder kun, hvis modellen kan
// kalde et værktøj med gyldige argumenter og bagefter svare på resultatet.
// Prøven sender tre faste, opdigtede opgaver til en model på denne computer.
// Den beviser ikke, at modellen kan bygge en app, kun at grundlaget er til stede.
const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const TOOLS = [
  fn('read_file', 'Læs en fil i projektet.', { path: { type: 'string', description: 'Filens sti' } }, ['path']),
  fn('write_file', 'Skriv en fil i projektet.', { path: { type: 'string', description: 'Filens sti' }, content: { type: 'string', description: 'Filens indhold' } }, ['path', 'content'])
];
const SYSTEM = { role: 'system', content: 'Du er en kodeagent. Brug værktøjerne, når opgaven kræver det. Svar kort på dansk.' };
const called = (message, name, test) => {
  const first = message?.tool_calls?.[0]?.function;
  if (!first) return 'Svarede med tekst uden at kalde værktøjet.';
  if (first.name !== name) return `Kaldte ${String(first.name).slice(0, 40)} i stedet for ${name}.`;
  let args; try { args = typeof first.arguments === 'string' ? JSON.parse(first.arguments) : first.arguments; } catch { return 'Værktøjskaldet havde argumenter, der ikke kunne læses.'; }
  return args && test(args) ? null : 'Værktøjskaldet manglede de rigtige argumenter.';
};
const CHECKS = Object.freeze([
  { id: 'kald', label: 'Kalder et værktøj', messages: [SYSTEM, { role: 'user', content: 'Læs filen README.md med værktøjet read_file.' }],
    judge: message => called(message, 'read_file', args => /README\.md$/i.test(String(args.path || ''))) },
  { id: 'argumenter', label: 'Udfylder flere argumenter', messages: [SYSTEM, { role: 'user', content: 'Opret filen noter.txt med indholdet "Hej Aura" ved hjælp af værktøjet write_file.' }],
    judge: message => called(message, 'write_file', args => /noter\.txt$/i.test(String(args.path || '')) && String(args.content || '').includes('Hej Aura')) },
  { id: 'svar', label: 'Svarer på værktøjets resultat', messages: [SYSTEM, { role: 'user', content: 'Hvilket tal står i filen data.txt?' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"data.txt"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'Tallet er 42.' }],
    judge: message => message?.tool_calls?.length ? 'Kaldte et værktøj igen i stedet for at svare.' : /42/.test(String(message?.content || '')) ? null : 'Svaret indeholdt ikke resultatet fra værktøjet.' }
]);

async function probeToolCalls({ baseURL, model, fetch = globalThis.fetch, signal, timeout = 180_000 }) {
  let host; try { host = new URL(baseURL).hostname; } catch { host = ''; }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw Object.assign(new Error('Afprøvningen sender kun til en model på denne computer.'), { code: 'LOCAL_PROBE' });
  const checks = [];
  for (const check of CHECKS) {
    let detail;
    try {
      const response = await fetch(baseURL.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
        body: JSON.stringify({ model, messages: check.messages, tools: TOOLS, tool_choice: 'auto', temperature: 0, max_tokens: 512, stream: false }) });
      detail = response.ok ? check.judge((await response.json())?.choices?.[0]?.message) : `Modellen svarede med fejl ${response.status}.`;
    } catch { detail = signal?.aborted ? 'Afprøvningen blev afbrudt.' : 'Modellen svarede ikke.'; }
    checks.push({ id: check.id, label: check.label, ok: detail === null, detail: detail === null ? 'Bestået' : detail });
    if (signal?.aborted) break;
  }
  while (checks.length < CHECKS.length) { const check = CHECKS[checks.length]; checks.push({ id: check.id, label: check.label, ok: false, detail: 'Ikke afprøvet.' }); }
  return { passed: checks.every(check => check.ok), checks };
}
module.exports = { probeToolCalls, CHECKS, TOOLS };
