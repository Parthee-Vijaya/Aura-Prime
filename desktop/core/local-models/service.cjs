// SPDX-License-Identifier: EUPL-1.2
'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');
const { probeHardware } = require('./hardware.cjs');
const { findModel, recommend, fit } = require('./catalog.cjs');
const { ollamaStatus, hasTag, pull, OLLAMA_URL } = require('./ollama.cjs');
const { probeToolCalls } = require('./probe.cjs');
const fail = (message, code) => Object.assign(new Error(message), { code });
const SOURCES = ['ollama', 'builtin'];

/**
 * Lokale modeller: maskintjek, anbefaling, hentning (gennem Ollama eller den
 * indbyggede motor), start og stop samt afprøvning af værktøjskald.
 * Intet hentes eller startes uden et kald herfra, og kun én hentning ad gangen.
 */
class LocalModels {
  constructor({ directory, engine, emit = () => {}, now = Date.now, hardware = probeHardware, ollama = { status: ollamaStatus, pull }, probe = probeToolCalls }) {
    Object.assign(this, { directory, engine, emit, now, hardwareProbe: hardware, ollama, probeImpl: probe });
    this.job = null; this.controller = null; this.cachedHardware = null; this.lastEmit = 0;
  }
  get stateFile() { return path.join(this.directory, 'state.json'); }
  async #state() { try { const value = JSON.parse(await fsp.readFile(this.stateFile, 'utf8')); return value && typeof value.probes === 'object' ? value : { probes: {} }; } catch { return { probes: {} }; } }
  async #save(state) { await fsp.mkdir(this.directory, { recursive: true }); await fsp.writeFile(this.stateFile + '.tmp', JSON.stringify(state, null, 2)); await fsp.rename(this.stateFile + '.tmp', this.stateFile); }
  async hardware() { return this.cachedHardware ||= await this.hardwareProbe(); }
  #model(id) { const model = findModel(id); if (!model) throw fail('Modellen findes ikke i kataloget.', 'LOCAL_UNKNOWN'); return model; }

  /** `ollama: false` bruges i projekter med dataregler: her søges der ikke efter en lokal server, som ikke er en godkendt modtager. */
  async overview({ ollama: askOllama = true } = {}) {
    const hardware = await this.hardware(), list = recommend(hardware), engine = await this.engine.engineState(), saved = await this.#state();
    const ollama = askOllama ? await this.ollama.status() : { running: false, version: null, models: [], blocked: true };
    const models = [];
    for (const entry of list.models) {
      const model = findModel(entry.id), local = await this.engine.modelState(model);
      models.push({ ...entry, state: { ollama: hasTag(ollama.models, model.ollama.tag), builtin: local.downloaded, partialBytes: local.partialBytes,
        probes: { ollama: saved.probes['ollama:' + model.id] || null, builtin: saved.probes['builtin:' + model.id] || null } } });
    }
    return { hardware: { chip: hardware.chip, memoryBytes: hardware.memoryBytes, budgetBytes: hardware.budgetBytes, kind: hardware.kind, slow: hardware.slow },
      checkedAt: list.checkedAt, best: list.best, ollama: { running: ollama.running, version: ollama.version, ...(ollama.blocked ? { blocked: true } : {}) },
      engine: { ...engine, running: this.engine.running(), port: this.engine.port }, models, job: this.job && { ...this.job } };
  }

  async #run(kind, model, work) {
    if (this.job) throw fail('En hentning er allerede i gang. Vent, eller afbryd den først.', 'LOCAL_BUSY');
    this.controller = new AbortController(); this.job = { kind, model: model.id, phase: 'model', received: 0, total: 0, status: '' };
    const progress = phase => value => {
      Object.assign(this.job, { phase, received: value.received, total: value.total, status: value.status || '' });
      const current = this.now();
      if (phase !== this.lastPhase || current - this.lastEmit >= 200 || value.received === value.total) { this.lastPhase = phase; this.lastEmit = current; this.emit({ type: 'local-models.progress', job: { ...this.job } }); }
    };
    try { return await work(progress, this.controller.signal); }
    finally { this.job = null; this.controller = null; this.lastPhase = null; this.emit({ type: 'local-models.changed' }); }
  }
  cancel() { this.controller?.abort(); }

  /** Henter en katalogmodel gennem Ollama, som brugeren selv har installeret. */
  async pull(id) {
    const model = this.#model(id);
    return this.#run('ollama', model, async (progress, signal) => {
      if (!(await this.ollama.status()).running) throw fail('Ollama kører ikke på denne computer. Åbn Ollama, og prøv igen.', 'LOCAL_OLLAMA');
      await this.ollama.pull({ tag: model.ollama.tag, signal, onProgress: progress('model') });
      return { id: model.id };
    });
  }
  /** Henter motoren, hvis den mangler, og derefter modelfilen. Begge dele kontrolleres mod fastlåste kontrolsummer. */
  async download(id) {
    const model = this.#model(id);
    return this.#run('builtin', model, async (progress, signal) => {
      if (!(await this.engine.engineState()).installed) await this.engine.installEngine({ signal, onProgress: progress('engine') });
      await this.engine.downloadModel(model, { signal, onProgress: progress('model') });
      return { id: model.id };
    });
  }
  async start(id) {
    const model = this.#model(id), chosen = fit(model, await this.hardware());
    if (!chosen.context) throw fail('Modellen er for stor til denne computer. Vælg en mindre model.', 'LOCAL_TOO_BIG');
    return this.engine.start(model, { context: chosen.context });
  }
  async stop() { await this.engine.stop(); this.emit({ type: 'local-models.changed' }); }
  async remove(id) {
    const model = this.#model(id);
    await this.engine.removeModel(model);
    const state = await this.#state(); delete state.probes['builtin:' + model.id]; await this.#save(state);
    this.emit({ type: 'local-models.changed' });
  }

  /** Afprøver værktøjskald mod modellen på denne computer og gemmer resultatet pr. kilde. */
  async probe(id, source, { ollama: askOllama = true } = {}) {
    const model = this.#model(id);
    if (!SOURCES.includes(source)) throw fail('Ukendt kilde til afprøvningen.', 'LOCAL_PROBE');
    let target;
    if (source === 'ollama') {
      if (!askOllama) throw fail('Projektets dataregler tillader ikke, at Aura kalder Ollama herfra.', 'LOCAL_BLOCKED');
      if (!hasTag((await this.ollama.status()).models, model.ollama.tag)) throw fail('Hent modellen i Ollama, før den afprøves.', 'LOCAL_MODEL_MISSING');
      target = { baseURL: OLLAMA_URL + '/v1', model: model.ollama.tag };
    } else {
      if (!(await this.engine.modelState(model)).downloaded) throw fail('Hent modellen, før den afprøves.', 'LOCAL_MODEL_MISSING');
      if (this.engine.running()?.modelID !== model.id) await this.start(model.id);
      target = { baseURL: this.engine.baseURL, model: model.id };
    }
    const result = await this.probeImpl(target);
    const record = { passed: result.passed, at: new Date(this.now()).toISOString(), checks: result.checks };
    const state = await this.#state(); state.probes[`${source}:${model.id}`] = record; await this.#save(state);
    this.emit({ type: 'local-models.changed' });
    return record;
  }
}
module.exports = { LocalModels, SOURCES };
