// ---- randomisers. Each keeps everything as it was for undo (one step back; a preset load clears it). With next bar
// ticked, while playing, a randomise's changes wait for the start of the next bar, its button flashing until then ----
let mUndoSnap = null;
const mUndoDraw = () => document.querySelectorAll('[data-undo]').forEach((b) => { b.disabled = !mUndoSnap; });
const mBarBtns = new Set();
function mRandomise(btn, fn) {
  startAudio();
  const was = snapshot();
  const bar = $('m-nextbar').checked && playing;
  if (bar) { barSync = true; mBarBtns.add(btn); btn.classList.add('pending'); }
  try { fn(); } finally { barSync = false; }
  mUndoSnap = was; mUndoDraw(); drawAll();
}
document.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', () => {
  if (!mUndoSnap) return;
  const s = mUndoSnap; mUndoSnap = null;
  const bar = $('m-nextbar').checked && playing;
  if (bar) barSync = true;
  try { useSnapshot(s, true); } finally { barSync = false; }
  mUndoDraw();
}));
eventHandlers.push((ev) => {
  if (ev.type !== 'step' || ev.step !== 0 || !mBarBtns.size) return;
  const bs = [...mBarBtns]; mBarBtns.clear();
  whenHeard(() => bs.forEach((b) => b.classList.remove('pending')));
});
stopHooks.push(() => { mBarBtns.forEach((b) => b.classList.remove('pending')); mBarBtns.clear(); });
storedCheck('m-nextbar', 'elixir-werkstatt-nextbar', false);

// sound: a new patch for the Werkstatt, in ranges that still play notes: the base note and the volume stay; mostly a
// saw or a pulse through the ladder with the EG on the filter, now and then the LFO on the VCO or the filter. One part per
// section of the voice page, so each section can be randomised on its own
// (rV: the voice being randomised, A unless a section button is pressed with one of B's tabs showing)
let rV = 'a';
const rSet = (key, v) => { const sp = WS_SPEC[key]; VOICE_OF[rV].set(key, Math.max(sp.min, Math.min(sp.max, Math.round(v)))); };
const RANDOM_VOICE = {
  tone() {
    rSet('wave', chance(0.5) ? 1 : 0); rSet('pwm', chance(0.5) ? 0 : rIn(10, 85)); rSet('fine', 0);
    const vib = chance(0.25);
    rSet('vcoMod', vib ? rIn(2, 25) : 0); rSet('vcoSrc', vib && chance(0.4) ? 1 : 0); rSet('glide', chance(0.3) ? rIn(5, 40) : 0);
  },
  shape() {
    rSet('attack', chance(0.75) ? rIn(0, 8) : rIn(8, 50)); rSet('decay', rIn(20, 80)); rSet('sustain', chance(0.3) ? 1 : 0); rSet('vcaMode', 0);
  },
  filter() {
    rSet('cutoff', rIn(25, 75)); rSet('reso', rIn(0, 85)); rSet('vcfSrc', chance(0.8) ? 1 : 0); rSet('vcfMod', rIn(10, 80));
    rSet('vcfPol', chance(0.15) ? 1 : 0); rSet('drive', rIn(15, 75));
  },
  mod() { rSet('lfoRate', rIn(20, 80)); rSet('lfoWave', chance(0.7) ? 0 : 1); } };
function randomSound() { Object.values(RANDOM_VOICE).forEach((f) => f()); }
// alter: every continuous knob (of the voice, or of the knobs given) moved up to 10% of its range either way
// (switches, the base note, fine and volume stay)
function alterSound(a = 0.1, keys = DR1) {
  for (const key of keys) {
    const sp = WS_SPEC[key], span = sp.max - sp.min;
    if (span < 20 || ['note', 'fine', 'volume'].includes(key)) continue;
    if ((key === 'vcoMod' || key === 'glide') && !ws[key]) continue;
    ws[key] = Math.max(sp.min, Math.min(sp.max, Math.round(ws[key] + (rnd() * 2 - 1) * a * span)));
  }
  sendWs();
}
// random fx: the echo on (half the time) at a musical length, the reverb as often (a room to a long hall), the ring mod
// now and then; alter fx: each moved a little
// (one part per effect, so the fx page can randomise each on its own)
const RANDOM_FX = {
  echo() {
    fx.send = chance(0.55) ? rIn(10, 60) : 0;
    setDelay(randomDelayPos());
    setValue(PAR.FX_DELAY_TYPE, chance(0.6) ? 1 : 0); setValue(PAR.FX_P3, rIn(40, 110)); setValue(PAR.FX_P4, chance(0.2) ? rIn(70, 105) : rIn(15, 70));
    fx.width = rIn(60, 160);
  },
  reverb() { fx.verb = chance(0.5) ? rIn(10, 55) : 0; fx.vPre = rIn(0, 90); fx.vDecay = rIn(70, 122); fx.vTone = rIn(30, 85); fx.vEarly = rIn(0, 127); },
  ring() { fx.ring = chance(0.2) ? rIn(10, 60) : 0; fx.ringWave = rIn(0, RING_W.length - 1); fx.ringFreq = rIn(5, 120); } };
function randomFx() { Object.values(RANDOM_FX).forEach((f) => f()); sendMix(); }
function alterFx(a = 0.1) {
  const nudge = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v + (rnd() * 2 - 1) * a * (hi - lo))));
  if (fx.send) fx.send = nudge(fx.send, 1, 100);
  if (fx.ring) fx.ring = nudge(fx.ring, 1, 100);
  if (fx.verb) fx.verb = nudge(fx.verb, 1, 100);
  fx.vPre = nudge(fx.vPre, 0, 127); fx.vDecay = nudge(fx.vDecay, 0, 124); fx.vTone = nudge(fx.vTone, 8, 120); fx.vEarly = nudge(fx.vEarly, 0, 127);
  setDelay(Math.max(0, Math.min(1, delayPos + (rnd() * 2 - 1) * a / 2)));
  setValue(PAR.FX_P3, nudge(values[PAR.FX_P3], 0, 127)); setValue(PAR.FX_P4, nudge(values[PAR.FX_P4], 0, 110));
  fx.width = nudge(fx.width, 0, 200); fx.ringFreq = nudge(fx.ringFreq, 0, 127);
  sendMix();
}
for (const id of ['m-mall']) $(id).addEventListener('click', (e) => mRandomise(e.currentTarget, () => { randomSound(); randomNotes(); randomFx(); }));
for (const id of ['m-valter', 'm-mvalter']) $(id).addEventListener('click', (e) => mRandomise(e.currentTarget, () => alterSound()));
for (const id of ['m-vrand', 'm-mvrand']) $(id).addEventListener('click', (e) => mRandomise(e.currentTarget, randomSound));
// the voice page's section randomisers: one section new, and its tab shown so the change can be seen
for (const b of document.querySelectorAll('[data-vrand]')) b.addEventListener('click', (e) => {
  const sec = b.dataset.vrand, voice = VP_TABS[mVSec][1] === 'b' ? 'b' : 'a';
  mVSec = VP_TABS.findIndex(([, v, secs]) => v === voice && secs.includes(sec)); mVoiceShow();
  mRandomise(e.currentTarget, () => { rV = voice; try { RANDOM_VOICE[sec](); } finally { rV = 'a'; } });
});
for (const b of document.querySelectorAll('[data-fxrand]')) b.addEventListener('click', (e) => mRandomise(e.currentTarget, () => { RANDOM_FX[b.dataset.fxrand](); sendMix(); }));
for (const id of ['m-fxr2', 'm-fxr3']) $(id).addEventListener('click', (e) => mRandomise(e.currentTarget, randomFx));
for (const id of ['m-fxa2', 'm-fxa3']) $(id).addEventListener('click', (e) => mRandomise(e.currentTarget, () => alterFx()));

// the metronome
const metroDraw = () => $('m-metro').setAttribute('aria-pressed', metroOn);
$('m-metro').addEventListener('click', () => { metroOn = !metroOn; store.set(METRO_KEY, metroOn ? '1' : '0'); metroDraw(); sendSeq(); });
metroDraw();
// (its arm swings on each beat as it's heard, while it's on)
eventHandlers.push((ev) => { if (ev.type === 'step' && ev.step % 4 === 0 && metroOn) whenHeard(() => $('m-metro').classList.toggle('tock')); });

// prefs: a tap on the title opens them (screen colours, preset tempo, version); done, the title again or Escape closes
function mPrefs(on) { $('m-prefs').hidden = !on; $('m-title').setAttribute('aria-expanded', on); if (on) mDepth(); }
$('m-title').addEventListener('click', () => mPrefs($('m-prefs').hidden));
$('m-prefs-close').addEventListener('click', () => mPrefs(false));
addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('m-prefs').hidden) mPrefs(false); } });
