// SPDX-License-Identifier: EUPL-1.2
'use strict';
const { spawn, execFile } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { download } = require('./download.cjs');
const DEFAULT_PORT = 11617;
const START_TIMEOUT_MS = 180_000;
const fail = (message, code) => Object.assign(new Error(message), { code });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const untar = (archive, directory) => new Promise((resolve, reject) => execFile('tar', ['-xzf', archive, '-C', directory], { windowsHide: true }, error => error ? reject(error) : resolve()));

/**
 * Den indbyggede motor: en fastlåst, kontrolsum-tjekket udgave af llama.cpp's
 * server, som Aura henter efter brugerens valg og selv starter og stopper.
 * Den lytter kun på 127.0.0.1 og på en fast port, så en organisation kan
 * dokumentere modtageren. Ingen model eller motor hentes uden et udtrykkeligt valg.
 */
class LocalEngine {
  constructor({ directory, platform = process.platform, arch = process.arch, lock = require('./engine-lock.json'), fetch = globalThis.fetch, port = DEFAULT_PORT, allowed, modelURL, env = {} }) {
    Object.assign(this, { directory, platform, arch, lock, fetch, port, allowed, env });
    this.modelURL = modelURL || (model => `https://huggingface.co/${model.gguf.repo}/resolve/${model.gguf.revision}/${model.gguf.file}`);
    this.current = null;
  }
  get baseURL() { return `http://127.0.0.1:${this.port}/v1`; }
  get target() { return this.lock.targets[`${this.platform}-${this.arch}`] || null; }
  get engineDirectory() { return path.join(this.directory, 'engine', this.lock.llama); }
  modelFile(model) { return path.join(this.directory, 'models', model.id, model.gguf.file); }
  running() { return this.current ? { modelID: this.current.modelID, context: this.current.context } : null; }

  async binary() {
    const walk = async (directory, depth) => {
      for (const entry of await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(directory, entry.name);
        if (entry.isFile() && entry.name === 'llama-server') return full;
        if (entry.isDirectory() && depth < 3) { const found = await walk(full, depth + 1); if (found) return found; }
      }
      return null;
    };
    return walk(this.engineDirectory, 0);
  }
  async engineState() { return { supported: Boolean(this.target), version: this.lock.llama, installed: Boolean(this.target && await this.binary()) }; }

  async installEngine({ onProgress, signal } = {}) {
    const target = this.target;
    if (!target) throw fail('Den indbyggede motor findes endnu ikke til denne type computer. Brug Ollama i stedet.', 'LOCAL_UNSUPPORTED');
    if (await this.binary()) return this.engineState();
    const archive = path.join(this.directory, 'engine', target.name), staging = this.engineDirectory + '.tmp';
    await download({ url: target.url, file: archive, bytes: target.bytes, sha256: target.checksum, fetch: this.fetch, signal, onProgress, ...(this.allowed ? { allowed: this.allowed } : {}) });
    await fsp.rm(staging, { recursive: true, force: true }); await fsp.mkdir(staging, { recursive: true });
    try { await untar(archive, staging); await fsp.rm(this.engineDirectory, { recursive: true, force: true }); await fsp.rename(staging, this.engineDirectory); }
    catch { await fsp.rm(staging, { recursive: true, force: true }); throw fail('Motoren kunne ikke pakkes ud. Prøv at hente den igen.', 'LOCAL_UNPACK'); }
    finally { await fsp.rm(archive, { force: true }); }
    if (!await this.binary()) throw fail('Motorens pakke indeholder ikke den forventede server.', 'LOCAL_UNPACK');
    return this.engineState();
  }

  async modelState(model) {
    const file = this.modelFile(model), size = name => fsp.stat(name).then(stat => stat.size, () => 0);
    return { downloaded: await size(file) === model.gguf.bytes, partialBytes: await size(file + '.part') };
  }
  async downloadModel(model, { onProgress, signal } = {}) {
    if ((await this.modelState(model)).downloaded) return { file: this.modelFile(model), resumed: false };
    return download({ url: this.modelURL(model), file: this.modelFile(model), bytes: model.gguf.bytes, sha256: model.gguf.sha256, fetch: this.fetch, signal, onProgress, ...(this.allowed ? { allowed: this.allowed } : {}) });
  }
  async removeModel(model) {
    if (this.current?.modelID === model.id) await this.stop();
    await fsp.rm(path.dirname(this.modelFile(model)), { recursive: true, force: true });
  }

  async #healthy() {
    try { const response = await this.fetch(`http://127.0.0.1:${this.port}/health`, { signal: AbortSignal.timeout(1500) }); return response.ok && (await response.json())?.status === 'ok'; }
    catch { return false; }
  }
  async start(model, { context }) {
    const binary = await this.binary();
    if (!binary) throw fail('Hent motoren, før en model kan startes.', 'LOCAL_ENGINE_MISSING');
    if (!(await this.modelState(model)).downloaded) throw fail('Hent modellen, før den kan startes.', 'LOCAL_MODEL_MISSING');
    if (!Number.isInteger(context) || context < 2048 || context > 262144) throw fail('Konteksten er uden for det tilladte.', 'LOCAL_CONTEXT');
    await this.stop();
    if (await this.#healthy()) throw fail(`Porten ${this.port} er optaget af et andet program. Luk det, og prøv igen.`, 'LOCAL_PORT');
    const args = ['-m', this.modelFile(model), '--host', '127.0.0.1', '--port', String(this.port), '--ctx-size', String(context), '--parallel', '1', '--alias', model.id, '--no-webui', '--offline'];
    const child = spawn(binary, args, { cwd: path.dirname(binary), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', ...this.env } });
    let log = '', exited = null;
    const keep = chunk => { log = (log + chunk).slice(-4000); };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    child.on('error', error => { exited = error.message; });
    // Lukker appen uventet, må motoren ikke blive ved med at holde modellen i hukommelsen.
    const reap = () => child.kill('SIGKILL'); process.once('exit', reap);
    child.on('exit', code => { exited = `kode ${code}`; process.removeListener('exit', reap); if (this.current?.child === child) this.current = null; });
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (!await this.#healthy()) {
      if (exited !== null) throw fail(/alloc|out of memory|insufficient memory/i.test(log) ? 'Der var ikke hukommelse nok til modellen. Vælg en mindre model.' : 'Motoren stoppede under opstart. Prøv igen, eller vælg en anden model.', 'LOCAL_START');
      if (Date.now() > deadline) { child.kill('SIGKILL'); throw fail('Modellen blev ikke klar inden for tre minutter.', 'LOCAL_START'); }
      await sleep(250);
    }
    if (exited !== null) throw fail(`Porten ${this.port} er optaget af et andet program. Luk det, og prøv igen.`, 'LOCAL_PORT');
    this.current = { modelID: model.id, context, child };
    return { modelID: model.id, context, baseURL: this.baseURL };
  }
  async stop() {
    const child = this.current?.child; this.current = null;
    if (!child || child.exitCode !== null) return;
    const gone = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    if (await Promise.race([gone.then(() => true), sleep(5000).then(() => false)]) === false) { child.kill('SIGKILL'); await gone; }
  }
}
module.exports = { LocalEngine, DEFAULT_PORT };
