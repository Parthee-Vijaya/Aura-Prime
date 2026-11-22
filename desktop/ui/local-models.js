// SPDX-License-Identifier: EUPL-1.2
// Indstillinger › Lokale modeller: maskintjek, anbefaling, hentning, start og
// afprøvning. Al tekst sættes med textContent; intet herfra tolkes som HTML.
(function () {
  'use strict';
  const FIT = { fits: 'Passer', tight: 'Stramt', 'chat-only': 'Kun til samtale', 'too-big': 'For stor' };
  const FIT_HELP = {
    fits: 'Modellen kan køre med fuld arbejdshukommelse på denne computer.',
    tight: 'Modellen kan køre, men med kortere arbejdshukommelse. Lange opgaver bliver sammenfattet tidligere.',
    'chat-only': 'Der er kun plads til korte samtaler, ikke til at bygge.',
    'too-big': 'Modellen kræver mere hukommelse, end denne computer kan give den.'
  };
  const OLLAMA_URL = 'http://127.0.0.1:11434';
  const gb = bytes => (bytes / 1e9).toFixed(1).replace('.', ',') + ' GB';
  const memory = bytes => Math.round(bytes / 1024 ** 3) + ' GB';
  const day = iso => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? '' : `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`; };
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const button = (label, onClick, { primary = false, disabled = false, title = '' } = {}) => {
    const node = el('button', primary ? 'primary' : '', label); node.type = 'button'; node.disabled = disabled; if (title) node.title = title;
    node.addEventListener('click', onClick); return node;
  };
  let tools = null, view = null, working = false, unsubscribe = null;
  const openAlternatives = new Set();

  async function load() {
    try { view = await tools.invoke('localModelsOverview'); }
    catch (error) { view = null; draw(); tools.announce([error.message || 'Lokale modeller kunne ikke hentes.'], true); return; }
    draw();
  }
  async function act(work, done) {
    if (working) return;
    working = true; tools.announce(['']);
    let message = '', failed = false;
    try { const result = await work(); message = typeof result === 'string' ? result : done || ''; }
    catch (error) { message = error.message || 'Handlingen kunne ikke gennemføres.'; failed = true; }
    working = false;
    await load();
    tools.announce([message], failed);
  }
  async function ensureConnection(kind, name, baseURL) {
    const state = await tools.invoke('connectionState');
    if (state?.connections?.some(item => item.kind === kind && (!baseURL || item.baseURL === baseURL))) return;
    const next = await tools.invoke('saveConnection', { kind, name, ...(baseURL ? { baseURL } : {}) });
    window.dispatchEvent(new CustomEvent('aura:connections', { detail: { state: next } }));
  }

  function progress(job) {
    const wrap = el('div', 'local-progress'); wrap.dataset.progress = job.model;
    const label = el('span', 'local-progress-label'), bar = el('div', 'local-progress-bar'), fill = el('div', 'local-progress-fill');
    bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.append(fill);
    wrap.append(label, bar, button('Afbryd', () => { void tools.invoke('localModelsCancel').catch(() => {}); }));
    paint(wrap, job);
    return wrap;
  }
  function paint(wrap, job) {
    const share = job.total > 0 ? Math.min(100, Math.round(job.received / job.total * 100)) : 0;
    wrap.querySelector('.local-progress-fill').style.width = share + '%';
    wrap.querySelector('.local-progress-bar').setAttribute('aria-valuenow', String(share));
    wrap.querySelector('.local-progress-label').textContent = job.total > 0
      ? `${job.phase === 'engine' ? 'Henter motoren' : 'Henter modellen'}: ${gb(job.received)} af ${gb(job.total)} (${share} %)`
      : job.phase === 'engine' ? 'Henter motoren …' : 'Forbereder hentningen …';
  }
  function probeLine(record, source) {
    if (!record) return null;
    const failed = record.checks?.find(check => !check.ok);
    const line = el('small', 'local-probe', `Værktøjskald afprøvet ${day(record.at)}${source === 'ollama' ? ' i Ollama' : ''}: ${record.passed ? 'bestået' : 'ikke bestået'}${failed ? ` (${failed.label.toLowerCase()}: ${failed.detail})` : ''}`);
    line.dataset.passed = String(record.passed);
    return line;
  }

  function builtinActions(model) {
    const box = el('div', 'local-actions'), { engine, job } = view, state = model.state, tooBig = model.fit.status === 'too-big';
    if (job?.kind === 'builtin' && job.model === model.id) { box.append(progress(job)); return box; }
    const busy = working || Boolean(job);
    if (!state.builtin) {
      box.append(button(`${state.partialBytes ? 'Fortsæt hentning' : 'Hent'} · ${gb(model.bytes)}`, () => act(() => tools.invoke('localModelsDownload', { id: model.id }), `${model.name} er hentet og kontrolleret.`),
        { primary: view.best === model.id, disabled: busy || tooBig, title: tooBig ? FIT_HELP['too-big'] : engine.installed ? '' : 'Første gang hentes også Auras motor (ca. 17 MB).' }));
      return box;
    }
    const running = engine.running?.modelID === model.id;
    if (running) {
      box.append(el('span', 'local-status', 'Kører'), button('Stop', () => act(() => tools.invoke('localModelsStop'), `${model.name} er stoppet.`), { disabled: busy }));
    } else {
      box.append(button('Brug', () => act(async () => {
        await tools.invoke('localModelsStart', { id: model.id });
        await ensureConnection('builtin', 'Aura lokal motor');
        return `${model.name} kører. Vælg «Aura lokal motor» som AI-forbindelse i dit projekt.`;
      }), { primary: true, disabled: busy || tooBig, title: tooBig ? FIT_HELP['too-big'] : 'Starter modellen på denne computer. Det kan tage op til et par minutter.' }));
    }
    box.append(button('Afprøv værktøjskald', () => act(async () => {
      const result = await tools.invoke('localModelsProbe', { id: model.id, source: 'builtin' });
      return result.passed ? `${model.name} bestod afprøvningen af værktøjskald.` : `${model.name} bestod ikke afprøvningen. Brug den til samtale, ikke til at bygge.`;
    }), { disabled: busy || tooBig, title: 'Sender tre faste, opdigtede opgaver til modellen på denne computer.' }));
    if (!running) box.append(button('Fjern', () => act(() => tools.invoke('localModelsRemove', { id: model.id }), `${model.name} er fjernet fra denne computer.`), { disabled: busy }));
    return box;
  }
  function ollamaActions(model) {
    const box = el('div', 'local-actions'), { ollama, job } = view, tag = model.ollama.tag;
    if (ollama.blocked) { box.append(el('small', '', 'Projektets dataregler tillader ikke, at Aura søger efter Ollama. Åbn Lokale modeller fra et projekt uden dataregler.')); return box; }
    if (!ollama.running) { box.append(el('small', '', 'Ollama kører ikke på denne computer. Åbn Ollama, og vælg Lokale modeller igen.')); return box; }
    if (job?.kind === 'ollama' && job.model === model.id) { box.append(progress(job)); return box; }
    const busy = working || Boolean(job), tooBig = model.fit.status === 'too-big';
    if (!model.state.ollama) {
      box.append(button(`Hent med Ollama (${tag})`, () => act(() => tools.invoke('localModelsPull', { id: model.id }), `${model.name} er hentet i Ollama.`), { disabled: busy || tooBig, title: tooBig ? FIT_HELP['too-big'] : '' }));
    } else {
      box.append(button('Brug med Ollama', () => act(async () => { await ensureConnection('ollama', 'Ollama på denne computer', OLLAMA_URL); return `Vælg «Ollama på denne computer» og modellen ${tag} i dit projekt.`; }), { disabled: busy }),
        button('Afprøv værktøjskald', () => act(async () => {
          const result = await tools.invoke('localModelsProbe', { id: model.id, source: 'ollama' });
          return result.passed ? `${model.name} bestod afprøvningen i Ollama.` : `${model.name} bestod ikke afprøvningen i Ollama.`;
        }), { disabled: busy }));
    }
    if (model.ollama.note) box.append(el('small', '', model.ollama.note));
    return box;
  }
  function row(model) {
    const item = el('article', 'local-model'); item.dataset.model = model.id; item.dataset.fit = model.fit.status;
    const head = el('div', 'local-model-head'), title = el('strong', '', model.name), fit = el('span', 'local-fit', FIT[model.fit.status]);
    fit.dataset.fit = model.fit.status; fit.title = FIT_HELP[model.fit.status];
    head.append(title, fit);
    if (view.best === model.id) head.append(el('span', 'local-best', 'Anbefalet til denne computer'));
    const link = el('button', 'text-button', 'Kilde'); link.type = 'button'; link.addEventListener('click', () => { void tools.invoke('openExternalLink', model.source).catch(() => {}); });
    const facts = el('small', 'local-facts', `${model.publisher} · ${model.origin} · ${model.parameters} parametre · ${gb(model.bytes)} · licens ${model.license} · `);
    facts.append(link);
    item.append(head, el('p', 'local-note', `${model.note} ${FIT_HELP[model.fit.status]}`), facts);
    if (view.engine.supported) {
      item.append(builtinActions(model));
      const alternative = el('details', 'local-alternative'); alternative.append(el('summary', '', 'Brug Ollama i stedet'), ollamaActions(model));
      // Et afsnit, brugeren har åbnet, eller som viser en igangværende hentning, bliver stående åbent, når listen tegnes igen.
      alternative.open = openAlternatives.has(model.id) || (view.job?.kind === 'ollama' && view.job.model === model.id);
      alternative.addEventListener('toggle', () => { if (alternative.open) openAlternatives.add(model.id); else openAlternatives.delete(model.id); });
      item.append(alternative);
    } else item.append(ollamaActions(model));
    for (const source of ['builtin', 'ollama']) { const line = probeLine(model.state.probes[source], source); if (line) item.append(line); }
    return item;
  }

  function draw() {
    if (!tools || !tools.isCurrent()) return;
    const content = tools.content, nodes = [];
    if (!view) nodes.push(tools.note('Undersøger computeren …'));
    else {
      const { hardware, engine, ollama } = view;
      const machine = el('section', 'plugin-group local-machine');
      machine.append(el('h4', '', 'Din computer'), el('p', 'local-note',
        `${hardware.chip} med ${memory(hardware.memoryBytes)} hukommelse. Aura holder 4 GB fri til systemet og regner med op til ${gb(hardware.budgetBytes)} til en lokal model.` +
        (hardware.slow ? ' Computeren har intet understøttet grafikkort, så svarene bliver langsomme.' : '')));
      if (view.best) machine.append(el('p', 'local-note', `Anbefalet til denne computer: ${view.models.find(model => model.id === view.best)?.name}.`));
      machine.append(tools.note(view.best ? 'Modellerne herunder er vurderet efter, hvad der kan være i hukommelsen. At en model passer, betyder ikke, at den kan bygge en app. Afprøv værktøjskald, før du bruger den til at bygge.'
        : 'Ingen model i kataloget kan køre med fornuftig arbejdshukommelse på denne computer. Brug en AI-forbindelse fra AI-forbindelser i stedet.'));
      const list = el('section', 'plugin-group local-list'); list.append(el('h4', '', 'Modeller'));
      for (const model of view.models) list.append(row(model));
      const about = el('section', 'plugin-group local-about'); about.append(el('h4', '', 'Sådan virker det'));
      about.append(tools.note(engine.supported
        ? `Aura henter modellen fra Hugging Face og en fastlåst udgave af llama.cpp (${engine.version}) fra GitHub. Begge dele kontrolleres mod kendte kontrolsummer, før de bruges. Modellen kører kun på denne computer og lytter på port ${engine.port}.`
        : 'Auras indbyggede motor findes endnu ikke til denne type computer. Du kan hente og bruge modellerne gennem Ollama.'));
      about.append(tools.note(ollama.blocked ? 'Aura har ikke søgt efter Ollama, fordi projektet har dataregler.' : ollama.running ? `Ollama ${ollama.version || ''} kører på denne computer.`.replace('  ', ' ') : 'Ollama er ikke fundet på denne computer. Den er kun nødvendig, hvis du vil bruge Ollama i stedet for Auras motor.'));
      about.append(tools.note('Projektets dataregler gælder stadig. Arbejdsformen «Kun lokal» kræver, at din organisation har dokumenteret modtageren. Lokale modeller er langsommere og mindre dygtige end de store udbyderes modeller.'));
      nodes.push(machine, list, about);
    }
    content.replaceChildren(...[...content.children].slice(0, 2), ...nodes);
    tools.feedbackArea();
  }

  window.AuraLocalModels = {
    open(options) {
      tools = options; view = null; working = false; openAlternatives.clear();
      if (!unsubscribe && window.harness?.onEvent) unsubscribe = window.harness.onEvent(event => {
        if (!tools || !tools.isCurrent()) return;
        if (event?.type === 'local-models.progress' && event.job) {
          const wrap = tools.content.querySelector(`[data-progress="${CSS.escape(event.job.model)}"]`);
          if (wrap) paint(wrap, event.job); else if (view) { view.job = event.job; draw(); }
        } else if (event?.type === 'local-models.changed' && !working) void load();
      });
      draw();
      return load();
    }
  };
})();
