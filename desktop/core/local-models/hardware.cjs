// SPDX-License-Identifier: EUPL-1.2
'use strict';
const { execFile } = require('node:child_process');
const GiB = 1024 ** 3;
const RESERVED_BYTES = 4 * GiB;

/**
 * Hvor meget hukommelse en lokal model må bruge på maskinen.
 * Der holdes altid 4 GB fri til systemet, Aura og kodeagenten. Apple Silicon
 * deler hukommelsen mellem processor og grafik, og macOS lader grafikdelen
 * bruge omkring to tredjedele; derfor to tredjedele af resten. Et dedikeret
 * NVIDIA-kort sætter loftet ved sit eget lager. Uden grafikkort regnes med
 * halvdelen af resten, og maskinen mærkes som langsom.
 */
function describeHardware({ platform, arch, totalBytes, cpuModel = '', gpus = [] }) {
  const base = { platform, arch, chip: cpuModel || 'Ukendt processor', memoryBytes: totalBytes, gpus };
  const free = Math.max(0, totalBytes - RESERVED_BYTES);
  if (platform === 'darwin' && arch === 'arm64') return { ...base, kind: 'apple-silicon', budgetBytes: Math.floor(free * 2 / 3), slow: false };
  const largest = gpus.reduce((best, gpu) => Math.max(best, gpu.vramBytes || 0), 0);
  if (largest > 0) return { ...base, kind: 'nvidia', budgetBytes: Math.floor(largest * 0.9), slow: false };
  return { ...base, kind: 'cpu', budgetBytes: Math.floor(free / 2), slow: true };
}

const runFile = (command, args) => new Promise((resolve, reject) => execFile(command, args, { timeout: 4000, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(String(stdout))));

/** Læser maskinens hukommelse, processor og eventuelle NVIDIA-kort. Sender intet ud af maskinen. */
async function probeHardware({ os = require('node:os'), run = runFile } = {}) {
  const platform = os.platform(), arch = os.arch();
  let gpus = [];
  if (!(platform === 'darwin' && arch === 'arm64')) {
    try {
      const output = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
      gpus = output.split('\n').map(line => line.split(',').map(part => part.trim())).filter(([name, mib]) => name && Number(mib) > 0).slice(0, 8)
        .map(([name, mib]) => ({ name: name.slice(0, 80), vramBytes: Number(mib) * 1024 * 1024 }));
    } catch { gpus = []; }
  }
  return describeHardware({ platform, arch, totalBytes: os.totalmem(), cpuModel: String(os.cpus()?.[0]?.model || '').trim().slice(0, 80), gpus });
}
module.exports = { describeHardware, probeHardware, GiB, RESERVED_BYTES };
