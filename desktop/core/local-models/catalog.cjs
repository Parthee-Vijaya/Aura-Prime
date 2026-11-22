// SPDX-License-Identifier: EUPL-1.2
'use strict';
const catalog = require('./catalog.json');
const { GiB } = require('./hardware.cjs');

// Kontekst i tokens. Aura regner med 32.768 for ukendte modeller; 16.384 er
// det mindste, en kodeagent kan arbejde i, og 8.192 rækker kun til samtale.
const CONTEXTS = Object.freeze([32768, 16384, 8192]);
const STATUS = Object.freeze({ 32768: 'fits', 16384: 'tight', 8192: 'chat-only' });
const OVERHEAD_BYTES = GiB;
const models = Object.freeze(catalog.models.map(Object.freeze));

const findModel = id => models.find(model => model.id === id) || null;
/** Modelfil + nøgle- og værdilager for konteksten + fast tillæg til beregningsbuffere. */
const requirement = (model, context) => model.gguf.bytes + model.gguf.kvBytesPerToken * context + OVERHEAD_BYTES;

/** Vælger den største kontekst, der holder sig inden for maskinens loft. */
function fit(model, hardware) {
  for (const context of CONTEXTS) {
    const neededBytes = requirement(model, context);
    if (neededBytes <= hardware.budgetBytes) return { status: STATUS[context], context, neededBytes, budgetBytes: hardware.budgetBytes };
  }
  return { status: 'too-big', context: null, neededBytes: requirement(model, CONTEXTS[CONTEXTS.length - 1]), budgetBytes: hardware.budgetBytes };
}

/** Kataloget set fra denne maskine. `best` er den største model med fuld kontekst, ellers den største stramme. */
function recommend(hardware) {
  const list = models.map(model => ({ id: model.id, name: model.name, publisher: model.publisher, origin: model.origin, parameters: model.parameters, note: model.note,
    license: model.license, bytes: model.gguf.bytes, source: `https://huggingface.co/${model.gguf.repo}`, ollama: { ...model.ollama }, fit: fit(model, hardware) }));
  const largest = status => list.filter(model => model.fit.status === status).sort((a, b) => b.bytes - a.bytes)[0];
  return { checkedAt: catalog.checkedAt, best: (largest('fits') || largest('tight'))?.id || null, models: list };
}
module.exports = { models, findModel, requirement, fit, recommend, CONTEXTS, OVERHEAD_BYTES };
