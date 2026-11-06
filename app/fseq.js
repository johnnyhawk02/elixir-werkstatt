// ---- fader step sequencers: holding a fader still for half a second opens one for it: 2 to 16 steps, each an offset
// from the fader's setting (up or down, up to depth of its range) that it takes while playing (the step is the bar's
// 16th counted from the start, wrapped at the length, so short ones run against the bar), jumping to it or, with slew,
// gliding to it over up to a whole step; each step lasts a 16th note up to 8 bars. The fader still moves its setting
// meanwhile, and stopping (or switching the sequencer off) puts the setting back. Draw the steps with a finger,
// randomise them (random, drunk, wobbly, ramp, s&h or sparse), or switch it off; a fader with one running is marked.
// A step can slide (the slide button, then tap or drag along the steps): it's legato, gliding from its own offset to
// the next step's over the whole step instead of jumping there. Presets keep them ----
const FS_MAX = 16;
const fsCells = Array.from({ length: FS_MAX }, (_, i) => { const c = document.createElement('i'); c.dataset.i = i; c.innerHTML = '<b>S</b>'; $('m-fs-steps').append(c); return c; });
// the slide button: while it's on, a touch on the steps switches their slides instead of painting them
let fsSlideMode = false;
let fsF = null;
const FS_STEPS = [1, 2, 4, 8, 16, 32, 64, 128];
const fsStepName = (v) => (v < 16 ? `1/${16 / v}` : v === 16 ? '1 bar' : `${v / 16} bars`);
// a step's offset, -1..1 of depth, in twentieths
const fsOff = (x) => Math.round(Math.max(-1, Math.min(1, x)) * 20) / 20;
const fsNew = () => ({ on: true, len: 16, slew: 0, step: 1, depth: 50, vals: new Array(FS_MAX).fill(0), slides: new Array(FS_MAX).fill(false) });
// the value heard: the setting moved by the current offset
function fsApply(f) {
  const q = f.seq;
  if (f.base === null) f.base = f.get();
  f.put(f.base + f.off * (q ? q.depth / 100 : 0) * (f.hiOf() - f.min));
}
// back to the setting, the sequencer let go
function fsRelease(f) {
  if (f.base === null) return;
  const b = f.base; f.glide = null; f.off = 0; f.base = null; f.put(b);
}
function fsOpen(fd) {
  if (!fd.seq) fd.seq = fsNew();
  fsF = fd; $('m-fs-name').textContent = fd.label; $('m-fs-val').textContent = '';
  $('m-fs').hidden = false; fsDraw();
}
function fsDraw() {
  const q = fsF.seq;
  fsCells.forEach((c, i) => {
    const v = q.vals[i];
    c.style.setProperty('--up', Math.max(0, v)); c.style.setProperty('--dn', Math.max(0, -v));
    c.classList.toggle('off', i >= q.len); c.classList.toggle('slide', !!q.slides[i]);
  });
  $('m-fs-slide').setAttribute('aria-pressed', fsSlideMode);
  $('m-fs-type').textContent = FS_RAND[fsType][0];
  $('m-fs-depth').style.setProperty('--w', q.depth / 100); $('m-fs-depth-out').textContent = `±${q.depth}%`;
  $('m-fs-len').style.setProperty('--w', (q.len - 2) / (FS_MAX - 2)); $('m-fs-len-out').textContent = `${q.len} steps`;
  $('m-fs-slew').style.setProperty('--w', q.slew / 100); $('m-fs-slew-out').textContent = q.slew ? `${q.slew}%` : 'off';
  $('m-fs-speed').style.setProperty('--w', (FS_STEPS.indexOf(q.step) + 1) / FS_STEPS.length); $('m-fs-speed-out').textContent = fsStepName(q.step);
  $('m-fs-on').setAttribute('aria-pressed', q.on); $('m-fs-on').textContent = q.on ? 'on' : 'off';
  fsMarks();
}
const fsMarks = () => mFaders.forEach((f) => f.el.classList.toggle('seq', !!(f.seq && f.seq.on)));
// presets keep them by fader (its box and label), with the settings, not the values heard
fseqSnapshot = () => {
  const out = {};
  for (const f of mFaders) if (f.seq) out[f.key] = { on: f.seq.on, len: f.seq.len, slew: f.seq.slew, step: f.seq.step, depth: f.seq.depth, vals: f.seq.vals.slice(), slides: f.seq.slides.slice() };
  return out;
};
const fsSnap0 = snapshot;
snapshot = function () {
  const held = mFaders.filter((f) => f.base !== null).map((f) => [f, f.get()]);
  for (const [f] of held) f.put(f.base);
  const s = fsSnap0();
  for (const [f, v] of held) f.put(v);
  return s;
};
fseqUse = (all) => {
  for (const f of mFaders) {
    const q = all[f.key];
    f.base = null; f.off = 0; f.glide = null;
    f.seq = q ? { on: !!q.on, len: Math.max(2, Math.min(FS_MAX, q.len | 0)), slew: q.slew || 0, step: FS_STEPS.includes(q.step) ? q.step : 1,
      depth: typeof q.depth === 'number' ? q.depth : 50, vals: Array.from({ length: FS_MAX }, (_, i) => (Number.isFinite(q.vals[i]) ? q.vals[i] : 0)),
      slides: Array.from({ length: FS_MAX }, (_, i) => !!(q.slides && q.slides[i])) } : null;
  }
  if (fsF) { if (fsF.seq) fsDraw(); else $('m-fs-close').click(); }
  fsMarks();
};
// painting: a step takes the offset at the finger's height (the middle is none); dragging across paints the steps it passes
{
  const box = $('m-fs-steps');
  let painting = false, slideTo = null;
  const paint = (e, first) => {
    const r = box.getBoundingClientRect(), cols = 16, rows = 1;
    const col = Math.max(0, Math.min(cols - 1, Math.floor((e.clientX - r.left) / r.width * cols)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor((e.clientY - r.top) / r.height * rows)));
    const i = row * cols + col, c = fsCells[i], cr = c.getBoundingClientRect();
    if (c.classList.contains('off')) return;
    // in slide mode the first step touched switches its slide, and the rest of a drag sets the others the same
    if (fsSlideMode) {
      if (first || slideTo === null) slideTo = !fsF.seq.slides[i];
      fsF.seq.slides[i] = slideTo; fsDraw(); return;
    }
    const o = fsF.seq.vals[i] = fsOff(1 - 2 * (e.clientY - cr.top) / cr.height);
    $('m-fs-val').textContent = `${o > 0 ? '+' : o < 0 ? '−' : ''}${Math.round(Math.abs(o) * fsF.seq.depth)}%`;
    fsDraw();
  };
  box.addEventListener('pointerdown', (e) => { box.setPointerCapture(e.pointerId); painting = true; paint(e, true); });
  const stop = () => { painting = false; slideTo = null; };
  box.addEventListener('pointermove', (e) => { if (painting && !e.buttons) stop(); else if (painting) paint(e, false); });
  box.addEventListener('pointerup', stop); box.addEventListener('pointercancel', stop); box.addEventListener('lostpointercapture', stop); dragStops.add(stop);
}
// length, slew, speed and depth: vertical faders, the bottom 0 and the top all the way
function fsBar(bar, setFrac) {
  const at = (e) => { const r = bar.getBoundingClientRect(); setFrac(Math.max(0, Math.min(1, (r.bottom - e.clientY) / r.height))); fsDraw(); };
  let held = false;
  bar.addEventListener('pointerdown', (e) => { bar.setPointerCapture(e.pointerId); held = true; at(e); });
  bar.addEventListener('pointermove', (e) => { if (held && !e.buttons) held = false; else if (held) at(e); });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) bar.addEventListener(t, () => { held = false; });
  dragStops.add(() => { held = false; });
}
fsBar($('m-fs-len'), (x) => { fsF.seq.len = 2 + Math.round(x * (FS_MAX - 2)); });
fsBar($('m-fs-slew'), (x) => { fsF.seq.slew = Math.round(x * 20) * 5; });
fsBar($('m-fs-speed'), (x) => { fsF.seq.step = FS_STEPS[Math.min(FS_STEPS.length - 1, Math.floor(x * FS_STEPS.length))]; });
fsBar($('m-fs-depth'), (x) => { fsF.seq.depth = Math.round(x * 20) * 5; if (fsF.base !== null) fsApply(fsF); });
// the kinds of randomise, each over the length: random: any offset each step; drunk: a walk, a small step up or down
// from the last; wobbly: two slow waves together, coming back round at the length; ramp: a rise or fall over the
// length; s&h: a new offset held for 2 to 4 steps; sparse: mostly none, now and then a spike
const rr = () => rnd() * 2 - 1;
const FS_RAND = [
  ['random', () => Array.from({ length: FS_MAX }, rr)],
  ['drunk', () => { let v = rr() * 0.5; return Array.from({ length: FS_MAX }, () => { v += rr() * 0.3; if (v > 1 || v < -1) v = Math.sign(v) * 2 - v; return v; }); }],
  ['wobbly', (n) => { const a = 1 + Math.floor(rnd() * 2), b = 2 + Math.floor(rnd() * 3), pa = rnd() * 6.3, pb = rnd() * 6.3, mix = 0.3 + rnd() * 0.4;
    return Array.from({ length: FS_MAX }, (_, i) => (1 - mix) * Math.sin(2 * Math.PI * a * i / n + pa) + mix * Math.sin(2 * Math.PI * b * i / n + pb)); }],
  ['ramp', (n) => { const up = rnd() < 0.5; return Array.from({ length: FS_MAX }, (_, i) => { const x = (i % n) / Math.max(1, n - 1) * 2 - 1; return up ? x : -x; }); }],
  ['s&h', () => { const hold = 2 + Math.floor(rnd() * 3); let v = 0; return Array.from({ length: FS_MAX }, (_, i) => { if (i % hold === 0) v = rr(); return v; }); }],
  ['sparse', () => Array.from({ length: FS_MAX }, () => (rnd() < 0.22 ? rr() : 0))],
];
const FS_TYPE_KEY = 'elixir-werkstatt-seqrand';
let fsType = Math.max(0, FS_RAND.findIndex(([n]) => n === store.get(FS_TYPE_KEY)));
$('m-fs-type').addEventListener('click', () => { fsType = (fsType + 1) % FS_RAND.length; store.set(FS_TYPE_KEY, FS_RAND[fsType][0]); fsDraw(); });
$('m-fs-rand').addEventListener('click', () => { const q = fsF.seq; q.vals = FS_RAND[fsType][1](q.len).map(fsOff); q.on = true; fsDraw(); });
// the main page's knob seq randomiser: the knob sequencers all cleared, then new ones on one to three of the faders
// worth moving (the filter most often), each of a random kind, length, speed, depth and slew, now and then with a
// slide or two; knob seqs off clears them all. Both can be undone
const FS_TARGETS = ['m-voice-filter:cutoff', 'm-voice-filter:cutoff', 'm-voice-filter:cutoff', 'm-voice-filter:reso', 'm-voice-filter:vcf mod',
  'm-voice-mod:drive', 'm-voice-tone:pwm', 'm-voice-tone:pwm', 'm-voice-mod:vco mod', 'm-voice-shape:decay', 'm-voice-mod:lfo rate',
  'm-voice-b:b→a fm', 'm-echo:send', 'm-echo:feedback', 'm-verb:send', 'm-ring:freq'];
function fsClearAll() { for (const f of mFaders) { fsRelease(f); f.seq = null; } if (fsF) $('m-fs-close').click(); fsMarks(); }
function fsRandomAll() {
  fsClearAll();
  const keys = new Set();
  for (let n = rIn(1, 3); keys.size < n;) keys.add(pick(FS_TARGETS));
  for (const key of keys) {
    const f = mFaders.find((x) => x.key === key); if (!f) continue;
    const q = f.seq = fsNew();
    q.len = pick([4, 8, 8, 16, 16, 16, 3, 6, 12]); q.step = pick([1, 1, 1, 2, 4, 16]); q.depth = rIn(3, 12) * 5;
    q.slew = chance(0.4) ? rIn(2, 10) * 10 : 0;
    // (never one that does nothing: a sparse one can come out empty over a short length)
    do q.vals = FS_RAND[rIn(0, FS_RAND.length - 1)][1](q.len).map(fsOff); while (!q.vals.slice(0, q.len).some((v) => v));
    if (chance(0.3)) for (let i = 0; i < q.len; i++) q.slides[i] = chance(0.25);
  }
  fsMarks();
}
$('m-fsrand').addEventListener('click', (e) => mRandomise(e.currentTarget, fsRandomAll));
$('m-fsoff').addEventListener('click', (e) => mRandomise(e.currentTarget, fsClearAll));
$('m-fs-on').addEventListener('click', () => { fsF.seq.on = !fsF.seq.on; if (!fsF.seq.on) fsRelease(fsF); fsDraw(); });
$('m-fs-slide').addEventListener('click', () => { fsSlideMode = !fsSlideMode; fsDraw(); });
$('m-fs-close').addEventListener('click', () => { $('m-fs').hidden = true; fsF = null; fsSlideMode = false; });
// the glides, a frame at a time while any is moving
let fsGlideOn = false;
function fsGlideRun() {
  if (fsGlideOn) return;
  fsGlideOn = true;
  const tick = () => {
    const now = performance.now();
    let any = false;
    for (const f of mFaders) {
      const g = f.glide; if (!g) continue;
      const k = Math.min(1, (now - g.t0) / g.ms);
      f.off = g.from + (g.to - g.from) * k; fsApply(f);
      if (k < 1 && f.seq && f.seq.on) any = true; else f.glide = null;
    }
    if (any) requestAnimationFrame(tick); else fsGlideOn = false;
  };
  requestAnimationFrame(tick);
}
// one step of a fader's sequencer: its offset, jumped to or, with slew, glided to over that share of the step. A
// slide step starts on its own offset and glides to the next step's over the whole step
function fsStep(f, i, ms) {
  const q = f.seq, k = Math.floor(i) % q.len, to = q.vals[k] || 0;
  if (q.slides[k]) { f.off = to; fsApply(f); f.glide = { from: to, to: q.vals[(k + 1) % q.len] || 0, t0: performance.now(), ms }; fsGlideRun(); }
  else if (q.slew) { f.glide = { from: f.off, to, t0: performance.now(), ms: q.slew / 100 * ms }; fsGlideRun(); } else { f.glide = null; f.off = to; fsApply(f); }
  if (f === fsF) fsCells.forEach((c, j) => c.classList.toggle('now', j === k));
}
// stopping puts every fader back to its setting
stopHooks.push(() => { mFaders.forEach(fsRelease); fsCells.forEach((c) => c.classList.remove('now')); });
// on each 16th (as the audio thread reaches it, ahead of the output), every running sequencer steps its fader
eventHandlers.push((ev) => {
  if (ev.type !== 'step' || !playing) return;
  const n = ev.bar * 16 + ev.step, stepMs = 60000 / tempo / 4;
  for (const f of mFaders) if (f.seq && f.seq.on && n % f.seq.step === 0) fsStep(f, n / f.seq.step, stepMs * f.seq.step);
});
