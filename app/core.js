// ---- the state: the sound (drum 1's parameters and the perf macros), the note sequence, the effects and the master,
// and the audio thread they're sent to ----
const $ = (id) => document.getElementById(id);
const { PAR, PARAM_DTYPES, MOD_TARGETS, MOD_TARGET_VOICE_RANGES, VOICE_PAGES, INIT_KIT, OSC_WAVE_NAMES, FILTER_TYPE_NAMES, LFO_SYNC_NAMES } = LXR;
// iOS: play Web Audio through the ringer switch like a music app
try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
const rnd = Math.random;
const rIn = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// this device's own settings (localStorage, which a private window may refuse): get(key) is null when there's none
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
};
// a checkbox kept on this device, on unless dflt is off
function storedCheck(id, key, dflt = true) {
  const v = store.get(key);
  $(id).checked = v === null ? dflt : v === '1';
  $(id).addEventListener('change', () => store.set(key, $(id).checked ? '1' : '0'));
}

// ---- the sound: parameter values 0..127 by parameter number. Only drum 1's are used; the firmware's init kit, made
// into a plain saw pluck (no kick drop, a low-pass with some resonance), is where everything starts ----
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const SYNTH0 = { COARSE1: 36, OSC_WAVE_DRUM1: 2, VELOA1: 0, VELOD1: 70, VOL_SLOPE1: 40, MODAMNT1: 0, MOD_EG1: 20,
  FILTER_FREQ_1: 70, RESO_1: 70, FILTER_TYPE_1: 0, FILTER_DRIVE_1: 20, DRIVE1: 63, VOL1: 110, VOICE_LFO1: 1,
  AUDIO_OUT1: 0, FX_TYPE: LXR.FX_DELAY, FX_P1: 0, FX_P2: 0, FX_P3: 90, FX_P4: 50, FX_DELAY_TYPE: 0 };
const initValues = new Uint8Array(PAR.END_OF_SOUND_PARAMETERS);
for (let i = 8; i < PAR.END_OF_SOUND_PARAMETERS; i++) initValues[i - 8] = INIT_KIT[i];
for (const [n, v] of Object.entries(SYNTH0)) initValues[PAR[n]] = v;
const factoryInit = initValues.slice();
const values = initValues.slice();
// drum 1's targets (velocity and LFO) are only its own parameters
const [T0, T1] = MOD_TARGET_VOICE_RANGES[0];
const TARGETS = [0, ...Array.from({ length: T1 - T0 + 1 }, (_, i) => T0 + i)].filter((i) => !MOD_TARGETS[i][0].startsWith('FX_'));
const nice = (t) => t.toLowerCase().replace(/_/g, ' ');
// a parameter's range and readout, from the firmware's parameter_dtypes table (coarse reads as the note it plays)
const TRANSIENT_NAMES = ['snap', 'offset', 'click', 'click 2', 'tick', 'kick', 'rim', 'drop', 'hat', 'clap', 'kick 2', 'snare', 'tom', 'snap 2', ...LXR.EXTRA_CLICK_NAMES];
const LFO_WAVES = ['sin', 'tri', 'saw up', 'saw dn', 'square', 'random', 'exp up', 'exp dn'];
function spec(par) {
  const menu = (names) => ({ min: 0, max: names.length - 1, show: (v) => names[v] ?? String(v) });
  if (par === PAR.COARSE1) return { min: 0, max: 127, show: (v) => noteName(v) };
  if (par === PAR.FM_FREQ1) return { min: 0, max: 127, show: (v) => { const x = v - 60; return (x > 0 ? '+' : '') + x; } };
  if (par === PAR.VEL_DEST_1 || par === PAR.TARGET_LFO1) return { min: 0, max: TARGETS.length - 1, idx: true, show: (i) => (i ? nice(MOD_TARGETS[TARGETS[i]][0]) : 'none') };
  if (par === PAR.RETRIGGER_LFO1) return menu(['off', 'on']);
  switch (PARAM_DTYPES[par] || '0B127') {
    case 'PM63': return { min: 0, max: 127, show: (v) => { const x = v - 63; return (x > 0 ? '+' : '') + x; } };
    case 'ON_OFF': case '0b1': return menu(['off', 'on']);
    case 'menu:WAVEFORM': return menu(OSC_WAVE_NAMES.map((s) => s.toLowerCase()));
    case 'menu:FILTER': return menu(FILTER_TYPE_NAMES.map((s) => s.toLowerCase()));
    case 'menu:TRANS': return menu(TRANSIENT_NAMES);
    case 'menu:LFO_WAVES': return menu(LFO_WAVES);
    case 'menu:SYNC_RATES': return menu(LFO_SYNC_NAMES.map((s) => s.toLowerCase()));
    case 'menu:MIX_FM': return menu(['fm', 'mix']);
    default: return { min: 0, max: 127, show: String };
  }
}
// a target menu's fader position is an index into TARGETS
const parGet = (par) => (spec(par).idx ? Math.max(0, TARGETS.indexOf(values[par])) : values[par]);
const parSet = (par, x) => setValue(par, spec(par).idx ? TARGETS[x] : x);

// ---- the voice: the Werkstatt-01 (werkstatt.js), its knobs and switches by key (LXR.WS_PARAMS). The LXR parameters
// above are still the engine's, for its FX bus (the echo); its own voices are silent ----
const WS_SPEC = Object.fromEntries(LXR.WS_PARAMS.map(([key, label, sec, min, max, dflt, show]) => [key, { key, label, sec, min, max, dflt, show }]));
const ws = { ...LXR.WS_DEFAULTS };
function setWs(key, v) { ws[key] = v; sendWs(); }
// voice B: a second Werkstatt on the same notes (its knobs in wsB, the perf macros leave it alone), and fm: the FM from B
// into A and the two voices' levels (LXR.FM_PARAMS)
for (const [key, label, sec, min, max, dflt, show] of LXR.FM_PARAMS) WS_SPEC[key] = { key, label, sec, min, max, dflt, show };
const wsB = { ...LXR.WS_DEFAULTS }, fm = { ...LXR.FM_DEFAULTS };
const sendWsB = () => send({ type: 'wsB', p: { ...wsB } }), sendFm = () => send({ type: 'fm', p: { ...fm } });
function setWsB(key, v) { wsB[key] = v; sendWsB(); }
function setFm(key, v) { fm[key] = v; sendFm(); }

// ---- the perf macros, offsets on top of the sound (the sound keeps its own values): decay and filter from -100%
// (down to the knob's bottom) through 0 (as the sound) to +100% (all the way up), on voice A's decay and cutoff; pitch moves every note by up to two octaves either way in hundredths of a semitone ----
const MACROS = { decay: 'decay', filter: 'cutoff' }; // (fm: the perf dial is the B into A FM itself now; macro.fm stays, unused, for older presets)
const MACRO0 = { pitch: 0, decay: 100, filter: 100, fm: 100 };
const macro = { ...MACRO0 };
const macroOf = Object.fromEntries(Object.entries(MACROS).map(([m, p]) => [p, m]));
function wsEff(key) {
  const m = macroOf[key], v = ws[key];
  if (!m || macro[m] === 100) return v;
  const { min, max } = WS_SPEC[key], k = (macro[m] - 100) / 100;
  return k > 0 ? v + (max - v) * k : min + (v - min) * (1 + k);
}
function sendWs() { send({ type: 'ws', p: Object.fromEntries(Object.keys(ws).map((k) => [k, wsEff(k)])) }); }
const effValues = () => Array.from(values);
function setMacro(m, v) {
  macro[m] = v;
  if (m === 'pitch') send({ type: 'pitch', v });
  else sendWs();
}
function setValue(par, v) {
  values[par] = v;
  send({ type: 'param', par, value: v });
  // the LFO always runs on drum 1
  if (par === PAR.TARGET_LFO1) send({ type: 'param', par: PAR.VOICE_LFO1, value: 1 });
}

// ---- the note sequence: four pages of 16 steps, played in turn a bar each; each step a degree of the scale (0 the root, up two octaves and more), a gate (0 rests, 1-4
// a quarter to all of the step, 5 rings), an accent and a slide into the next; root and scale say which notes those are ----
const SCALES = [['major', [0, 2, 4, 5, 7, 9, 11]], ['minor', [0, 2, 3, 5, 7, 8, 10]], ['dorian', [0, 2, 3, 5, 7, 9, 10]],
  ['phrygian', [0, 1, 3, 5, 7, 8, 10]], ['mixolyd', [0, 2, 4, 5, 7, 9, 10]], ['harm min', [0, 2, 3, 5, 7, 8, 11]],
  ['pent min', [0, 3, 5, 7, 10]], ['pent maj', [0, 2, 4, 7, 9]], ['blues', [0, 3, 5, 6, 7, 10]], ['chromatic', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]]];
// a step's slider covers two octaves of the scale: the root (0) up to the root two octaves up (twice the scale's notes)
const degMax = (sc = seq.scale) => 2 * SCALES[sc][1].length;
// the octave buttons move the whole sequence, OCT_MIN to OCT_MAX octaves from where its notes are written
const OCT_MIN = -2, OCT_MAX = 2;
// the morph: off (0), or which voice parameter each step's morph value (st.m, 0 to 100) takes from the sound's own value
// up to the top, gliding between steps on a slide (so the timbre moves with the pitch); off, the steps' values are kept
// but nothing is heard of them
const MORPH_DESTS = [['cutoff', 'cutoff'], ['pwm', 'pwm'], ['vco mod', 'vcoMod'], ['vcf mod', 'vcfMod'], ['reso', 'reso'], ['drive', 'drive'], ['fm amt', 'fm']];
const SEQ0 = { root: 0, scale: 1, oct: 0, density: 100, len: 64, accent: 6, glide: 35, vel: 100, algo: 8, morph: 0,
  steps: [[0, 4, 1, 0], [0, 2, 0, 0], [7, 3, 0, 1], [8, 4, 0, 0], [0, 0, 0, 0], [3, 3, 1, 0], [0, 2, 0, 0], [5, 4, 0, 1],
    [4, 4, 0, 0], [0, 2, 1, 0], [0, 0, 0, 0], [7, 3, 0, 0], [6, 4, 1, 1], [7, 4, 0, 0], [2, 2, 0, 0], [0, 3, 0, 0]].map(([d, gate, acc, slide]) => ({ d, gate, acc: !!acc, slide: !!slide })) };
const PAGES = 4, NSTEPS = PAGES * 16;
// a sequence with fewer pages (one, from before there were four) is repeated to fill them, so it plays as it did
const fillPages = (steps) => Array.from({ length: NSTEPS }, (_, i) => ({ ...steps[i % steps.length] }));
SEQ0.steps = fillPages(SEQ0.steps);
const seq = structuredClone(SEQ0);
// a degree's semitones above the root's C, moved by the octave buttons (the note heard: the voice's coarse, plus this, plus pitch)
const degSemis = (d, sc = seq.scale, root = seq.root, oct = seq.oct) => { const s = SCALES[sc][1]; return root + 12 * oct + s[d % s.length] + 12 * Math.floor(d / s.length); };
const stepNote = (st) => ws.note + degSemis(st.d);
let playing = false, tempo = 120;
// density: each step has a weight, w, 0 to 99 (the randomisers deal them out at random); as the density comes down
// from 100, the steps weighted under 100 - density drop out, the lowest first, until at 0 even a 99 is gone. A step
// with no weight (from before there were weights) takes one from where it sits in the bar: the downbeats high,
// the off-beat 16ths low
const DENSITY_ORDER = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
const stepWeight = (st, s) => (Number.isFinite(st.w) ? st.w : Math.round(99 - DENSITY_ORDER.indexOf(s % 16) * 99 / 15));
const thinned = () => seq.steps.map((st, s) => s < seq.len && st.gate > 0 && stepWeight(st, s) < 100 - seq.density);
// the metronome (on the main page): a click on each beat while playing, high on the bar's first; a setting of this
// browser's, not of the preset, and not in a recording
const METRO_KEY = 'elixir-werkstatt-metro';
let metroOn = store.get(METRO_KEY) === '1';
function sendSeq() {
  const thin = thinned();
  const md = MORPH_DESTS[seq.morph - 1];
  send({ type: 'seq', playing, metro: metroOn, len: seq.len, bpm: tempo, vel: seq.vel, glide: seq.glide / 100, accentDb: seq.accent, morph: md ? md[1] : null,
    steps: seq.steps.map((st, s) => ({ n: degSemis(st.d), gate: thin[s] ? 0 : st.gate, acc: st.acc, slide: st.slide, m: (st.m || 0) / 100 })) });
}

// ---- effects and master: echo, reverb and ring mod sends; the echo's tone, feedback and ping pong are the engine's own
// FX bus settings (in the sound); the reverb's are the firmware's four reverb parameters (0..127); the distortion and
// compressor on the whole mix ----
const FX0 = { send: 0, ring: 0, width: 100, ringWave: 0, ringFreq: 40, verb: 0, vPre: 16, vDecay: 100, vTone: 60, vEarly: 64,
  // the ducker on the fx returns, keyed by the dry voice: off, amount (%), threshold (dB), attack, hold, release (ms)
  duck: false, dAmt: 70, dThresh: -18, dAtk: 1, dHold: 50, dRel: 250 };
const fx = { ...FX0 };
const DIST0 = { mix: 0, type: 0, p: [70, 64, 80, 90] };
const dist = structuredClone(DIST0);
const MASTER0 = { comp: true, thresh: -12, ratio: 3, attack: 5, release: 120, makeup: 0 };
const master = { ...MASTER0 };
const RATIOS = [1.5, 2, 3, 4, 6, 8, 20];
// musical echo times as fractions of a bar: straight, dotted and triplet, 1/128 .. 1/1
const NOTES = [];
for (let k = 0; k <= 7; k++) {
  const d = 2 ** k;
  NOTES.push([1 / d, '1/' + d]);
  if (k > 0 && k < 7) NOTES.push([1.5 / d, '1/' + d + '.']);
  if (k > 0) NOTES.push([2 / 3 / d, '1/' + d + 't']);
}
const posOf = (frac) => 1 + Math.log2(frac) / 7;
let delayPos = posOf(3 / 16);
const showDelay = (v) => {
  const frac = Math.pow(2, -7 * (1 - v / 1000));
  const [nf, name] = NOTES.reduce((a, b) => (Math.abs(Math.log2(b[0] / frac)) < Math.abs(Math.log2(a[0] / frac)) ? b : a));
  return `${Math.abs(nf / frac - 1) < 0.004 ? '' : '≈'}${name}`;
};
// the echo time a randomiser picks: 1/16, 1/8, dotted 1/8 or 1/4, or a triplet 1/16, 1/8 or 1/4, up to 1% off
function randomDelayPos() {
  const pool = [1 / 16, 1 / 8, 3 / 16, 1 / 4, 1 / 24, 1 / 12, 1 / 6];
  return Math.max(0, Math.min(1, posOf(pool[Math.floor(rnd() * pool.length)] * (1 + (rnd() * 2 - 1) * 0.01))));
}
function setDelay(pos) { delayPos = pos; send({ type: 'delay', pos }); }
// an echo send above 0 routes the voice to the echo bus
function sendMix() {
  const out = fx.send > 0 ? LXR.MIXER_ROUTING_FX_BUS : 0;
  if (values[PAR.AUDIO_OUT1] !== out) setValue(PAR.AUDIO_OUT1, out);
  send({ type: 'mix', master: { ...master }, dist, ring: { wave: fx.ringWave, freq: fx.ringFreq }, sendE: fx.send / 100, sendR: fx.ring / 100, width: fx.width,
    sendV: fx.verb / 100, verb: [fx.vPre, fx.vDecay, fx.vTone, fx.vEarly],
    duck: { on: fx.duck, amt: fx.dAmt, thresh: fx.dThresh, atk: fx.dAtk, hold: fx.dHold, rel: fx.dRel } });
}

// ---- audio ----
let ctx = null, node = null, fallback = null;
const pending = [];
// while barSync is set (a preset, or a randomise with next bar ticked), messages wait in the player for the next bar
let barSync = false;
// post: straight to the audio thread if it's running; send: through barSync, and kept until the audio starts
function post(m) { if (node) node.port.postMessage(m); else if (fallback) fallback.msg(m); else return false; return true; }
function send(m) { if (barSync) m = { type: 'atBar', m }; if (!post(m)) pending.push(m); }
// the output buffer: the shortest the device gives ('interactive'), as it was first. A long one ('playback', the
// 'bigger audio buffer' pref) was the default for a while (v84 to v90), and on a phone the timing went to pieces with
// it, chunks of audio skipped (Chrome may not give the audio thread its real-time priority then), so it's only an
// option now
const BIGBUF_KEY = 'elixir-werkstatt-bigbuf';
async function startAudio() {
  if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: store.get(BIGBUF_KEY) === '1' ? 'playback' : 'interactive' });
  try {
    const src = $('engine').textContent + $('player').textContent + `
      const now = globalThis.performance && performance.now ? () => performance.now() : () => Date.now();
      registerProcessor('lxr', class extends AudioWorkletProcessor {
        constructor() { super({ numberOfInputs: 0 }); this.p = new Player(sampleRate); this.port.onmessage = (e) => this.p.msg(e.data);
          this.busy = 0; this.peak = 0; this.n = 0; }
        process(_, outputs) { const o = outputs[0], t0 = now(); this.p.process(o[0], o[1] || o[0]);
          // the load: the time spent here against the audio made, sent about once a second (timed with whatever clock the
          // audio thread has, which can be in whole milliseconds: over a second that still averages out)
          const dt = now() - t0; this.busy += dt; if (dt > this.peak) this.peak = dt;
          if (++this.n === 375) { this.port.postMessage({ type: 'load', busy: this.busy / (this.n * o[0].length / sampleRate * 1000), peak: this.peak, quantum: o[0].length / sampleRate * 1000 }); this.busy = 0; this.peak = 0; this.n = 0; }
          if (this.p.events.length) { for (const ev of this.p.events) this.port.postMessage(ev); this.p.events.length = 0; } return true; }
      });`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    node = new AudioWorkletNode(ctx, 'lxr', { numberOfInputs: 0, outputChannelCount: [2] });
    node.port.onmessage = (e) => onEvent(e.data);
    node.connect(ctx.destination);
  } catch (err) {
    // no AudioWorklet: the same player on the main thread
    fallback = new Player(ctx.sampleRate);
    const sp = ctx.createScriptProcessor(1024, 0, 2);
    sp.onaudioprocess = (e) => {
      fallback.process(e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1));
      for (const ev of fallback.events) onEvent(ev);
      fallback.events.length = 0;
    };
    sp.connect(ctx.destination);
  }
  // (anything sent before the audio started is in the state below, so it's sent fresh)
  pending.length = 0;
  sendAll();
}
// a new buffer size takes a new audio context: the old one closed, everything sent to the new one
async function restartAudio() {
  if (!ctx) return;
  const old = ctx;
  if (node) { node.port.onmessage = null; node.disconnect(); }
  ctx = null; node = null; fallback = null;
  old.close().catch(() => {});
  await startAudio();
}
// everything, to a new audio thread or for a preset
function sendAll() {
  send({ type: 'kit', values: effValues() });
  sendWs(); sendWsB(); sendFm();
  send({ type: 'pitch', v: macro.pitch });
  send({ type: 'delay', pos: delayPos });
  sendMix(); sendSeq();
}
// events from the audio thread: each file adds its own handlers
const eventHandlers = [];
function onEvent(ev) { for (const h of eventHandlers) h(ev); }
// the audio thread runs ahead of what's heard: fn when its latest event reaches the speakers
const whenHeard = (fn) => setTimeout(fn, ctx && ctx.outputLatency ? ctx.outputLatency * 1000 : 0);

// ---- a snapshot of everything a preset keeps, and putting one back ----
const PRESET_V = 1;
let fseqSnapshot = () => ({}), fseqUse = () => {};
function snapshot() {
  return { v: PRESET_V, kit: Array.from(values), ws: { ...ws }, wsB: { ...wsB }, fm: { ...fm }, macro: { ...macro }, tempo, seq: structuredClone(seq), fx: { ...fx }, dpos: delayPos,
    dist: structuredClone(dist), master: { ...master }, fseqs: fseqSnapshot() };
}
const drawHooks = [];
const drawAll = () => drawHooks.forEach((d) => d());
function useSnapshot(p, keepTempo) {
  const kit = Uint8Array.from(p.kit);
  values.set(kit.subarray(0, values.length));
  values[PAR.VOICE_LFO1] = 1;
  // (a preset from before the Werkstatt has no ws: it plays on the Werkstatt's own default sound)
  Object.assign(ws, LXR.WS_DEFAULTS, p.ws || {});
  // (and one from before voice B has none: B starts as a copy of A, with the FM off and B silent)
  Object.assign(wsB, LXR.WS_DEFAULTS, p.wsB || p.ws || {});
  Object.assign(fm, LXR.FM_DEFAULTS, p.fm || {});
  Object.assign(macro, MACRO0, p.macro);
  if (!keepTempo && p.tempo) tempo = p.tempo;
  Object.assign(seq, structuredClone(SEQ0), structuredClone(p.seq || {}));
  seq.steps = fillPages(seq.steps.length ? seq.steps.slice(0, NSTEPS) : SEQ0.steps);
  Object.assign(fx, FX0, p.fx);
  delayPos = typeof p.dpos === 'number' ? p.dpos : posOf(3 / 16);
  Object.assign(dist, structuredClone(DIST0), structuredClone(p.dist || {}));
  Object.assign(master, MASTER0, p.master);
  fseqUse(p.fseqs || {});
  sendAll(); drawAll();
}
