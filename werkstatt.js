// A component-level model of the Moog Werkstatt-01 voice: expo converter and VCO, transistor ladder VCF, attack/decay
// envelope with sustain, OTA VCA, LFO and glide. It replaces the LXR drum 1 voice of Elixir Synth in this copy, Elixir Werkstatt.
//
// The circuit blocks come from Johnny's DFAM model (github.com/johnnyhawk02/dfam-model, js/dfam.js), which models
// them from the Werkstatt-01 schematic (Moog BRD-10-011-1111, sheets 3 to 6): the matched-pair expo converter with
// bulk emitter resistance, the four-stage tanh ladder solved by the trapezoidal rule and Newton, the capacitor
// envelope with its steering diode and comparator, and the LM13700 VCA. What's new here is the Werkstatt's own
// panel around them: one VCO with a saw / pulse switch and PWM, VCO MOD and VCF MOD (each from the LFO or the EG,
// the VCF's with a polarity switch), the LFO (triangle / square), the EG's sustain switch, the VCA mode switch
// (EG / ON) and glide.
//
// Component values are estimates (the schematic gives the topology, not every value that matters): they're the
// constants in WS_CIRCUIT, in SI units. The VCO is modelled as a ramp core (an integrator reset by a comparator) whose
// saw and comparator pulse are band-limited with polyBLEP; that and the panel ranges are assumptions to check
// against a real Werkstatt.

const PI = Math.PI;
const K_BOLTZMANN = 1.380649e-23, K_CHARGE = 1.602176634e-19;
const thermalVoltage = (tempK) => (K_BOLTZMANN * tempK) / K_CHARGE;
const clampW = (x, a, b) => Math.min(Math.max(x, a), b);

// the knobs and switches: [key, label, section, min, max, default, show]. Sections: tone (the VCO), shape (EG and
// VCA), filter (the VCF) and mod (the LFO)
const pctW = (v) => `${Math.round(v)}%`;
const NOTE_W = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteW = (m) => NOTE_W[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const hzW = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)}k` : hz >= 10 ? `${Math.round(hz)}` : hz.toFixed(1));
export const cutoffHz = (k) => 20 * Math.pow(1000, k / 100); // 20 Hz .. 20 kHz
export const lfoHz = (k) => 0.1 * Math.pow(1000, k / 100); // 0.1 .. 100 Hz
export const WS_PARAMS = [
  ['note', 'freq', 'tone', 12, 72, 36, (v) => noteW(v)], // the VCO's base note, a semitone a step
  ['fine', 'fine', 'tone', -50, 50, 0, (v) => `${v > 0 ? '+' : ''}${v} ct`],
  ['wave', 'wave', 'tone', 0, 1, 0, (v) => ['saw', 'pulse'][v]],
  ['pwm', 'pwm', 'tone', 0, 100, 0, pctW], // 0: square, 100: a narrow pulse
  ['vcoMod', 'vco mod', 'tone', 0, 100, 0, pctW],
  ['vcoSrc', 'vco src', 'tone', 0, 1, 0, (v) => ['lfo', 'eg'][v]],
  ['glide', 'glide', 'tone', 0, 100, 0, pctW],
  ['attack', 'attack', 'shape', 0, 100, 0, pctW],
  ['decay', 'decay', 'shape', 0, 100, 45, pctW],
  ['sustain', 'sustain', 'shape', 0, 1, 0, (v) => ['off', 'on'][v]],
  ['vcaMode', 'vca', 'shape', 0, 1, 0, (v) => ['eg', 'on'][v]],
  ['volume', 'volume', 'shape', 0, 100, 80, pctW],
  ['cutoff', 'cutoff', 'filter', 0, 100, 55, (v) => hzW(cutoffHz(v))],
  ['reso', 'reso', 'filter', 0, 100, 45, pctW],
  ['vcfMod', 'vcf mod', 'filter', 0, 100, 45, pctW],
  ['vcfSrc', 'vcf src', 'filter', 0, 1, 1, (v) => ['lfo', 'eg'][v]],
  ['vcfPol', 'polarity', 'filter', 0, 1, 0, (v) => ['+', '−'][v]],
  ['drive', 'drive', 'filter', 0, 100, 40, pctW], // the mixer level into the ladder (not a Werkstatt knob)
  ['lfoRate', 'lfo rate', 'mod', 0, 100, 45, (v) => `${hzW(lfoHz(v))} Hz`],
  ['lfoWave', 'lfo wave', 'mod', 0, 1, 0, (v) => ['tri', 'square'][v]],
].map(Object.freeze);
export const WS_DEFAULTS = Object.freeze(Object.fromEntries(WS_PARAMS.map((p) => [p[0], p[5]])));

// estimated component values, SI units
export const WS_CIRCUIT = Object.freeze({
  oversample: 2, // the circuit runs at twice the engine's rate
  temperature: 25, trimTemperature: 25, // C
  vcoCap: 4.7e-9, vcoThreshold: 5, vcoResetTime: 400e-9, // ramp capacitor F, comparator level V, reset (4066 + LM393) s
  vcoMaxHz: 20000, expoRbulk: 2, // expo current limit, bulk emitter resistance ohm
  vcoModOctaves: 3, vcfModOctaves: 7, // VCO MOD and VCF MOD at full knob, octaves (LFO: either way; EG: up)
  vcfCap: 68e-9, vcfMaxHz: 40000, resonanceMax: 1.12, // ladder caps F, control current limit, loop gain at full RES
  ladderIn: [0.0015, 0.02], ladderNoise: 2e-7, // mixer volts to ladder volts at drive 0 and 100, input noise V rms
  egCap: 1e-6, egSupply: 12, egDiode: 0.6, egPeak: 8, // envelope cap F, supply V, steering diode V, comparator V
  attackMinR: 1e3, attackPotR: 1e6, decayMinR: 2.2e3, decayPotR: 2e6, potTaper: 100, // ohms; audio-taper base
  glideCap: 1e-6, glidePotR: 470e3, // glide lag: RC on the pitch CV
  vcaRabc: 47e3, vcaDivTop: 33e3, vcaDivBottom: 220, vcaRf: 30e3, vcaFeedthroughSd: 0.004,
  lfoAmp: 5, // LFO swing, +/- V
  outputHp: 10, // output coupling, Hz
});

// ---------------------------------------------------------------- components (after dfam-model js/dfam.js)

// xorshift64 on two uint32 halves (dfam-model's Rng)
class WRng {
  constructor(seed = 1) {
    const s = (BigInt.asUintN(64, BigInt(seed)) * 0x9E3779B97F4A7C15n + 1n) & 0xFFFFFFFFFFFFFFFFn;
    this.hi = Number(s >> 32n) >>> 0; this.lo = Number(s & 0xFFFFFFFFn) >>> 0; this.spare = 0; this.haveSpare = false;
  }
  next() {
    let hi = this.hi, lo = this.lo, h, l;
    h = ((hi << 13) | (lo >>> 19)) >>> 0; l = (lo << 13) >>> 0; hi = (hi ^ h) >>> 0; lo = (lo ^ l) >>> 0;
    l = ((lo >>> 7) | (hi << 25)) >>> 0; h = hi >>> 7; hi = (hi ^ h) >>> 0; lo = (lo ^ l) >>> 0;
    h = ((hi << 17) | (lo >>> 15)) >>> 0; l = (lo << 17) >>> 0; this.hi = (hi ^ h) >>> 0; this.lo = (lo ^ l) >>> 0;
  }
  uniform() { this.next(); return (this.hi * 2097152 + (this.lo >>> 11)) / 9007199254740992; }
  gaussian() {
    if (this.haveSpare) { this.haveSpare = false; return this.spare; }
    const u1 = Math.max(this.uniform(), 1e-300), u2 = this.uniform(), r = Math.sqrt(-2 * Math.log(u1));
    this.spare = r * Math.sin(2 * PI * u2); this.haveSpare = true;
    return r * Math.cos(2 * PI * u2);
  }
}

// matched-pair expo converter: Vt ln(I/Iref) + rE (I - Iref) = dV, solved by Newton in the log domain
class ExpoConverter {
  constructor(iRef, tempK, trimTempK, rE) {
    this.iRef = iRef; this.vt = thermalVoltage(tempK); this.vPerVolt = thermalVoltage(trimTempK) * Math.log(2); this.rE = rE;
  }
  current(cv, iMax) {
    const dV = cv * this.vPerVolt, vt = this.vt, rI = this.rE * this.iRef;
    let x = Math.min(dV / vt, Math.log(iMax / this.iRef));
    for (let k = 0; k < 6; k++) {
      const e = Math.exp(x), step = (vt * x + rI * (e - 1) - dV) / (vt + rI * e);
      x -= step;
      if (Math.abs(step) < 1e-9) break;
    }
    return Math.min(this.iRef * Math.exp(x), iMax);
  }
}
const audioTaper = (knob, rMax, base) => (rMax * (Math.pow(base, clampW(knob, 0, 1)) - 1)) / (base - 1);

// Moog transistor ladder: four tanh differential-pair stages with resonance feedback, trapezoidal rule + Newton
class LadderFilter {
  constructor(fs, cap, tempK, rng, inputNoise) {
    this.dt = 1 / fs; this.c = cap; this.vt = thermalVoltage(tempK); this.noise = inputNoise; this.rng = rng;
    this.v = new Float64Array(4); this.x = new Float64Array(4); this.fOld = new Float64Array(4); this.f = new Float64Array(4);
    this.vinPrev = 0; this.M = [0, 1, 2, 3].map(() => new Float64Array(5)); this.dx = new Float64Array(4);
  }
  currentForCutoff(hz) { return 2 * PI * hz * 4 * this.c * this.vt; }
  deriv(vin, x, g, k, f) {
    const s = 1 / (2 * this.vt), t0 = Math.tanh(x[0] * s), t1 = Math.tanh(x[1] * s), t2 = Math.tanh(x[2] * s), t3 = Math.tanh(x[3] * s);
    f[0] = g * (Math.tanh((vin - 4 * k * x[3]) * s) - t0); f[1] = g * (t0 - t1); f[2] = g * (t1 - t2); f[3] = g * (t2 - t3);
  }
  dT(x) { const t = Math.tanh(x / (2 * this.vt)); return (1 - t * t) / (2 * this.vt); }
  process(vin, current, k) {
    vin += this.rng.gaussian() * this.noise;
    const g = current / (2 * this.c), h = 0.5 * this.dt, { v, x, fOld, f, M, dx } = this;
    this.deriv(this.vinPrev, v, g, k, fOld);
    for (let i = 0; i < 4; i++) x[i] = v[i] + this.dt * fOld[i];
    for (let it = 0; it < 8; it++) {
      this.deriv(vin, x, g, k, f);
      const du = this.dT(vin - 4 * k * x[3]), d0 = this.dT(x[0]), d1 = this.dT(x[1]), d2 = this.dT(x[2]), d3 = this.dT(x[3]);
      for (let i = 0; i < 4; i++) { M[i].fill(0); M[i][4] = x[i] - v[i] - h * (fOld[i] + f[i]); }
      M[0][0] = 1 + h * g * d0; M[0][3] = h * g * 4 * k * du;
      M[1][0] = -h * g * d0; M[1][1] = 1 + h * g * d1;
      M[2][1] = -h * g * d1; M[2][2] = 1 + h * g * d2;
      M[3][2] = -h * g * d2; M[3][3] = 1 + h * g * d3;
      solve4(M, dx);
      let maxStep = 0;
      for (let i = 0; i < 4; i++) { x[i] -= dx[i]; maxStep = Math.max(maxStep, Math.abs(dx[i])); }
      if (maxStep < 1e-10) break;
    }
    v.set(x); this.vinPrev = vin;
    return v[3];
  }
}
function solve4(M, out) {
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (p !== c) { const t = M[c]; M[c] = M[p]; M[p] = t; }
    for (let r = c + 1; r < 4; r++) { const m = M[r][c] / M[c][c]; for (let j = c; j < 5; j++) M[r][j] -= m * M[c][j]; }
  }
  for (let i = 3; i >= 0; i--) { let s = M[i][4]; for (let j = i + 1; j < 4; j++) s -= M[i][j] * out[j]; out[i] = s / M[i][i]; }
}

// LM13700 VCA: Iout = Iabc tanh(Vd / 2Vt), Iabc from the control voltage through rabc, with a little control feedthrough
class OtaVca {
  constructor(C, tempK, rng) {
    this.vt = thermalVoltage(tempK); this.feedthrough = rng.gaussian() * C.vcaFeedthroughSd;
    this.rabc = C.vcaRabc; this.divider = C.vcaDivBottom / (C.vcaDivTop + C.vcaDivBottom); this.rf = C.vcaRf;
  }
  process(vin, vCtrl) {
    const iabc = Math.max(vCtrl, 0) / this.rabc;
    return iabc * (Math.tanh(vin * this.divider / (2 * this.vt)) + this.feedthrough) * this.rf;
  }
}

// windowed-sinc decimator, oversampled rate to the engine's
class Decimator {
  constructor(factor, tapsPerPhase = 16) {
    const n = factor * tapsPerPhase + 1, fc = 0.45 / factor;
    this.h = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const m = i - (n - 1) / 2, sinc = m === 0 ? 2 * fc : Math.sin(2 * PI * fc * m) / (PI * m);
      const w = 0.42 - 0.5 * Math.cos((2 * PI * i) / (n - 1)) + 0.08 * Math.cos((4 * PI * i) / (n - 1));
      this.h[i] = sinc * w; sum += this.h[i];
    }
    for (let i = 0; i < n; i++) this.h[i] /= sum;
    this.n = n; this.buf = new Float64Array(2 * n); this.pos = 0;
  }
  push(x) { const n = this.n; this.buf[this.pos] = this.buf[this.pos + n] = x; this.pos = (this.pos + 1) % n; }
  out() { let acc = 0; const h = this.h, b = this.buf, p = this.pos; for (let i = 0; i < this.n; i++) acc += h[i] * b[p + i]; return acc; }
}

// ---------------------------------------------------------------- the Werkstatt's own blocks

// polyBLEP: the band-limited step's correction at phase t (in samples' worth of phase inc dt) around a jump
const blep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};

// The VCO: the expo converter's current charges the ramp capacitor; at the comparator's threshold a switch dumps it,
// taking the reset time (so the top end runs a little flat, as the hardware does). The saw is the ramp; the pulse is a
// second comparator between the ramp and the PWM voltage. f = Ic / (C Vth), period + reset time
class RampVco {
  constructor(fs, C) {
    this.fs = fs; this.dt = 1 / fs; this.cap = C.vcoCap; this.vth = C.vcoThreshold; this.tr = C.vcoResetTime;
    this.ph = 0;
  }
  // ic: the expo current; width: the pulse's high part, 0.5 (square) to 0.05. Returns [saw, pulse], +/- 5 V
  process(ic, width) {
    const fRamp = ic / (this.cap * this.vth), f = 1 / (1 / fRamp + this.tr);
    const inc = Math.min(0.49, f * this.dt);
    this.ph += inc;
    if (this.ph >= 1) this.ph -= 1;
    const p = this.ph;
    const saw = 2 * p - 1 - blep(p, inc);
    let q = p < width ? 1 : -1;
    q += blep(p, inc);
    q -= blep((p - width + 1) % 1, inc);
    return [saw * 5, q * 5];
  }
}

// The EG: a gate charges the capacitor through the attack pot and a diode towards the supply; the comparator ends the
// attack at the peak. With sustain on it holds there while the gate is held; then (or straight away with sustain off)
// it runs down through the decay pot. A new gate starts from wherever the capacitor is
class Eg {
  constructor(fs, C) { this.dt = 1 / fs; this.c = C.egCap; this.vSrc = C.egSupply - C.egDiode; this.vPeak = C.egPeak; this.v = 0; this.stage = 0; this.gate = false; }
  on() { this.gate = true; this.stage = 1; }
  off() { this.gate = false; if (this.stage !== 0) this.stage = 3; }
  process(rA, rD, sustain) {
    if (this.stage === 1) {
      this.v = this.vSrc + (this.v - this.vSrc) * Math.exp(-this.dt / (rA * this.c));
      if (this.v >= this.vPeak) { this.v = this.vPeak; this.stage = sustain && this.gate ? 2 : 3; }
    } else if (this.stage === 2) {
      if (!sustain || !this.gate) this.stage = 3;
    } else if (this.stage === 3) {
      this.v *= Math.exp(-this.dt / (rD * this.c));
      if (this.v < 1e-6) { this.v = 0; this.stage = 0; }
    }
    return this.v;
  }
}

// The LFO: an integrator and a Schmitt trigger (a triangle core), +/- lfoAmp
class Lfo {
  constructor(fs, amp) { this.dt = 1 / fs; this.amp = amp; this.ph = 0.25; }
  process(hz, square) {
    this.ph = (this.ph + hz * this.dt) % 1;
    const tri = this.ph < 0.5 ? 4 * this.ph - 1 : 3 - 4 * this.ph;
    return (square ? (this.ph < 0.5 ? 1 : -1) : tri) * this.amp;
  }
}

// ---------------------------------------------------------------- the voice

export class Werkstatt {
  constructor(sampleRate, seed = 1) {
    const C = WS_CIRCUIT;
    this.C = C; this.os = C.oversample; this.fs = sampleRate * this.os;
    const tempK = 273.15 + C.temperature, trimK = 273.15 + C.trimTemperature;
    const rng = new WRng(seed);
    this.vco = new RampVco(this.fs, C);
    // iRef: the current that makes A4 (440 Hz) at 0 V of pitch CV
    this.vcoExpo = new ExpoConverter(440 * C.vcoCap * C.vcoThreshold, tempK, trimK, C.expoRbulk);
    this.vcoIMax = C.vcoMaxHz * C.vcoCap * C.vcoThreshold;
    this.ladder = new LadderFilter(this.fs, C.vcfCap, tempK, new WRng(seed + 17), C.ladderNoise);
    this.vcfExpo = new ExpoConverter(1, tempK, trimK, C.expoRbulk);
    this.vcfIMax = this.ladder.currentForCutoff(Math.min(C.vcfMaxHz, 0.45 * this.fs));
    this.eg = new Eg(this.fs, C);
    this.vca = new OtaVca(C, tempK, rng);
    this.lfo = new Lfo(this.fs, C.lfoAmp);
    this.decim = new Decimator(this.os);
    this.hpA = Math.exp((-2 * PI * C.outputHp) / sampleRate); this.hpX = 0; this.hpY = 0;
    this.p = { ...WS_DEFAULTS };
    this.offset = 0; // semitones from the base note (the sequencer's note plus the perf pitch)
    this.cv = null; // the pitch CV after glide, volts (1 V/oct from A4)
    this.set({});
  }
  // knobs by key (any subset); a value is clamped to its range
  set(p) {
    for (const [k, , , lo, hi] of WS_PARAMS) if (p && typeof p[k] === 'number') this.p[k] = clampW(p[k], lo, hi);
    const C = this.C, q = this.p;
    this.vcfExpo.iRef = this.ladder.currentForCutoff(cutoffHz(q.cutoff));
    this.k = C.resonanceMax * q.reso / 100;
    this.rA = C.attackMinR + audioTaper(q.attack / 100, C.attackPotR, C.potTaper);
    this.rD = C.decayMinR + audioTaper(q.decay / 100, C.decayPotR, C.potTaper);
    this.glideA = q.glide > 0 ? Math.exp(-1 / (audioTaper(q.glide / 100, C.glidePotR, C.potTaper) * C.glideCap * this.fs)) : 0;
    this.lin = C.ladderIn[0] * Math.pow(C.ladderIn[1] / C.ladderIn[0], q.drive / 100);
    this.width = 0.5 - 0.45 * q.pwm / 100;
  }
  // the note: semitones from the base note (fractions glide in pitch only). gate: open the EG (a new note); without
  // it only the pitch moves (a slide)
  noteOn(offset, gate = true) { this.offset = offset; if (gate) this.eg.on(); }
  setOffset(offset) { this.offset = offset; }
  noteOff() { this.eg.off(); }
  tick() {
    const q = this.p, C = this.C;
    const target = (q.note + q.fine / 100 + this.offset - 69) / 12;
    if (this.cv === null) this.cv = target;
    this.cv = this.glideA ? target + (this.cv - target) * this.glideA : target;
    const env = this.eg.process(this.rA, this.rD, q.sustain);
    const lfo = this.lfo.process(lfoHz(q.lfoRate), q.lfoWave);
    // the mod sources as volts: the LFO either way, the EG up (both scaled so full knob gives the octaves set)
    const src = (s) => (s ? env / C.egPeak : lfo / C.lfoAmp);
    const vcoCv = this.cv + q.vcoMod / 100 * C.vcoModOctaves * src(q.vcoSrc);
    const [saw, pulse] = this.vco.process(this.vcoExpo.current(vcoCv, this.vcoIMax), this.width);
    const osc = q.wave ? pulse : saw;
    const vcfCv = (q.vcfPol ? -1 : 1) * q.vcfMod / 100 * C.vcfModOctaves * src(q.vcfSrc);
    const filt = this.ladder.process(osc * this.lin, this.vcfExpo.current(vcfCv, this.vcfIMax), this.k) / this.lin;
    return this.vca.process(filt, q.vcaMode ? C.egPeak : env);
  }
  // n samples at the engine's rate into out (a Float32Array), on the int16 scale the player expects
  render(out, n = out.length) {
    const d = this.decim, g = this.p.volume / 100 * 10000;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < this.os; k++) d.push(this.tick());
      const x = d.out();
      const y = this.hpA * (this.hpY + x - this.hpX); this.hpX = x; this.hpY = y;
      out[i] = y * g;
    }
    return out;
  }
  // true while the voice can still be heard (the EG open, or the VCA held on)
  get sounding() { return this.p.vcaMode === 1 || this.eg.stage !== 0; }
}
