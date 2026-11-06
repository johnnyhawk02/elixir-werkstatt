// ---- presets: everything (the sound, perf macros, notes, tempo, effects, master and the fader sequencers) under a
// two-word name, kept in this browser under elixir-werkstatt's own key. Save new, save over the loaded one, load, delete,
// import and export. While playing, a preset waits for the next bar: until it's heard, the one playing stays marked
// and the new one's row flashes ----
const SAVE_KEY = 'elixir-werkstatt-presets';
const fromData = (p, extra) => ({ ...structuredClone(p), ...extra });
const presetList = [{ name: 'Init', ...snapshot(), builtin: true },
  ...BUILTIN_PRESETS.filter((p) => p && p.v === PRESET_V && p.kit).map((p) => fromData(p, { builtin: true }))];
const presetData = (k) => { const { builtin, saved, ...p } = k; return structuredClone(p); };
try { for (const p of JSON.parse(store.get(SAVE_KEY)) || []) if (p && p.v === PRESET_V && p.kit) presetList.push(fromData(p, { saved: true })); } catch (e) {}
const storePresets = () => store.set(SAVE_KEY, JSON.stringify(presetList.filter((k) => k.saved).map(presetData)));
let pCur = presetList[0], pPending = null, pShown = null;
storedCheck('m-pbpm', 'elixir-werkstatt-presetbpm');
storedCheck('m-bigbuf', BIGBUF_KEY, false);
// (a take being recorded keeps the buffer it has: the new one comes with the next start)
$('m-bigbuf').addEventListener('change', () => { if (recState === 'off') restartAudio(); });
// the audio readout in the prefs: the output's rate and buffer, and the audio thread's load (the share of the time it
// has that it spends, and its longest block): what to look at when the sound breaks up
eventHandlers.push((ev) => {
  if (ev.type !== 'load' || $('m-prefs').hidden) return;
  const lat = ((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000;
  $('m-aload').textContent = `audio: ${(ctx.sampleRate / 1000).toFixed(1)} kHz, ${lat ? Math.round(lat) + ' ms out' : 'latency unknown'}, `
    + `load ${Math.round(ev.busy * 100)}%, longest block ${ev.peak.toFixed(1)} of ${ev.quantum.toFixed(1)} ms`;
});
// a new name: two made-up words
const SYL = ['ka', 'zu', 'mo', 'ree', 'vax', 'lo', 'quin', 'tor', 'ba', 'shi', 'nek', 'ul', 'dra', 'po', 'ix', 'fen', 'yo', 'gar', 'mi', 'sol'];
const word = () => { const w = Array.from({ length: rIn(2, 3) }, () => pick(SYL)).join(''); return w[0].toUpperCase() + w.slice(1); };
function newName() { let n; do n = `${word()} ${word()}`; while (presetList.some((k) => k.name === n)); return n; }
function pLoad(k) {
  startAudio();
  const shown = pPending ? pShown : pCur;
  if (playing) barSync = true;
  try { useSnapshot(k, !$('m-pbpm').checked); } finally { barSync = false; }
  pShown = shown; pCur = k; pPending = playing ? k : null;
  mUndoSnap = null; mUndoDraw();
  pDraw();
}
eventHandlers.push((ev) => {
  if (ev.type !== 'step' || ev.step !== 0 || !pPending) return;
  const p = pPending; whenHeard(() => { if (pPending === p) { pPending = null; pDraw(); } });
});
stopHooks.push(() => { if (pPending) { pPending = null; pDraw(); } });
function pDraw() {
  const over = !pPending && pCur.saved ? pCur : null;
  $('m-pover').disabled = !over; $('m-pover').textContent = over ? `save over ${over.name}` : 'save over';
  // (the main page names the preset over its buttons, so its save over is just that)
  $('m-mover').disabled = !over;
  $('m-mcur').textContent = (pPending ? pShown : pCur).name;
  const list = $('m-plist'), cur = pPending ? pShown : pCur;
  list.innerHTML = '';
  const group = (t) => { const li = document.createElement('li'); li.className = 'm-pgroup'; li.textContent = t; list.append(li); };
  const row = (k) => {
    const li = document.createElement('li'); li.classList.toggle('cur', k === cur); li.classList.toggle('pending', k === pPending);
    li.innerHTML = '<button class="m-pload" type="button"><b></b><small></small></button>';
    li.querySelector('b').textContent = k.name; li.querySelector('small').textContent = `${k.tempo} bpm`;
    li.querySelector('.m-pload').addEventListener('click', () => pLoad(k));
    if (k.saved) {
      const d = document.createElement('button'); d.className = 'm-pdel'; d.type = 'button'; d.textContent = '✕';
      d.setAttribute('aria-label', `Delete ${k.name}`);
      d.addEventListener('click', () => {
        if (!confirm(`Delete ${k.name}?`)) return;
        presetList.splice(presetList.indexOf(k), 1); storePresets();
        if (pCur === k) pCur = presetList[0];
        pDraw();
      });
      li.append(d);
    } else { const gap = document.createElement('span'); gap.className = 'm-pdel'; li.append(gap); }
    list.append(li);
  };
  const mine = presetList.filter((k) => k.saved);
  if (mine.length) { group('mine'); mine.slice().reverse().forEach(row); } else group('mine: none yet, save makes one');
  group('built in');
  presetList.filter((k) => k.builtin).forEach(row);
}
pageHooks.push((t) => { if (t === 'presets' || t === 'main') pDraw(); });
// save new and save over, here and on the main page (each says what it did under itself)
const pNote = (t) => { $('m-pnote').textContent = t; $('m-mnote').textContent = t; };
for (const id of ['m-psave', 'm-msave']) $(id).addEventListener('click', () => {
  const k = { name: newName(), ...snapshot(), saved: true };
  presetList.push(k); storePresets(); pCur = k; pPending = null;
  pNote(`Saved as ${k.name}.`);
  pDraw();
});
for (const id of ['m-pover', 'm-mover']) $(id).addEventListener('click', () => {
  const k = pCur;
  if (!k.saved || !confirm(`Save the current sound over ${k.name}?`)) return;
  Object.assign(k, snapshot()); storePresets();
  pNote(`Saved over ${k.name}.`);
  pDraw();
});
// files: { elixirSynth: 1, presets: [...] }; a name already saved here is skipped
$('m-pimport').addEventListener('change', async (e) => {
  let n = 0, bad = 0;
  for (const f of e.target.files) {
    try {
      for (const p of JSON.parse(await f.text()).presets || []) {
        if (!p || p.v !== PRESET_V || !p.kit || !p.name) { bad++; continue; }
        if (presetList.some((k) => k.saved && k.name === p.name)) continue;
        presetList.push(fromData(p, { saved: true })); n++;
      }
    } catch (err) { bad++; }
  }
  e.target.value = '';
  if (n) storePresets();
  $('m-pnote').textContent = (n ? `Imported ${n}.` : 'Nothing new to import.') + (bad ? ` ${bad} skipped: not Elixir presets.` : '');
  pDraw();
});
$('m-pexport').addEventListener('click', async () => {
  const list = presetList.filter((k) => k.saved).map(presetData);
  if (!list.length) { $('m-pnote').textContent = 'No presets of yours to export yet.'; return; }
  const blob = new Blob([JSON.stringify({ elixirSynth: 1, presets: list }, null, 1)], { type: 'application/json' });
  if (await mOffer({ blob, name: 'elixir-werkstatt-presets.json' }, 'application/json')) $('m-pnote').textContent = `Exported ${list.length} preset${list.length > 1 ? 's' : ''}.`;
});
pDraw();
