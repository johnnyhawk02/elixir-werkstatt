// The audio thread: runs the Werkstatt-01 voice (werkstatt.js) as a mono synth, the note sequencer, the echo, reverb and ring mod
// sends, the distortion and compressor on the mix and the recorder, and resamples the engine's rate to the output's.
// Used inside the AudioWorklet (or a ScriptProcessor fallback).
// the tempo-synced echo: 1/128 of a bar at 0, a whole bar at 1, evenly in octaves between
const delaySamples = (pos, bpm) => 240 / bpm * Math.pow(2, -7 * (1 - pos)) * LXR.REAL_FS;
const RING_MAKEUP = 3;
// a step's gate: 0 rests, 1 to 4 close after a quarter to all of the step, 5 lets the note ring out
const GATE_RING = 5;
// a sample into the engine's int16 buses, saturated
const int16 = (x) => Math.max(-32768, Math.min(32767, Math.round(x)));
class Player {
  constructor(outRate) {
    this.e = new LXR.LxrEngine();
    this.e.loadInitKit();
    // the voice is the Werkstatt (werkstatt.js), in place of the LXR's drum 1: the engine renders none of its own voices
    // and is kept for its FX bus (the echo), which takes the Werkstatt's output as drum 1's, panned centre
    this.e.voices = 0;
    this.e.drums[0].triggeredPanL = this.e.drums[0].triggeredPanR = Math.SQRT1_2;
    // two of them: voice A and voice B, B able to frequency-modulate A (WerkstattPair)
    // a fresh seed each start, so each run is a different pair of units (their spread and noise); the tests fix it with
    // Player.seed. (The LXR engine's own random numbers stay the firmware's)
    this.seed = Player.seed ?? 1 + Math.floor(Math.random() * 0x7ffffffe);
    this.w = new LXR.WerkstattPair(LXR.REAL_FS, this.seed);
    // ws: the Werkstatt's knobs as the page set them (the morph moves one of them from here)
    this.ws = { ...LXR.WS_DEFAULTS }; this.fm = { ...LXR.FM_DEFAULTS };
    this.gateOpen = false;
    this.ratio = LXR.REAL_FS / outRate;
    this.A = [new Float32Array(64), new Float32Array(64)];
    this.B = [new Float32Array(64), new Float32Array(64)];
    this.idx = 0; this.frac = 0;
    // the sequence: 16 steps a page (up to 4 pages) of { n: semitones from middle C, gate, acc, slide }
    this.steps = Array.from({ length: 16 }, () => ({ n: 0, gate: 0, acc: false, slide: false }));
    this.playing = false; this.bpm = 120; this.vel = 100; this.accGain = 0.5; this.glide = 0.35;
    this.len = 16; this.pos = 0;
    this.step = 0; this.bar = 0; this.toNext = 0; this.atBar = []; this.clock = 0;
    // pitch: the perf page's pitch, in semitones (hundredths), added to every note
    this.pitch = 0;
    // the note sounding (in semitones from middle C, before pitch), where a slide has it now (cur), its slide and where its gate closes
    this.note = 0; this.cur = 0; this.slideFrom = null; this.slideAt = 0; this.slideLen = 1; this.cutAt = Infinity;
    // the voice's gain: the accent (an unaccented note is turned down by the accent amount) times the gate
    this.gain = 1; this.gainTo = 1; this.gate = 1;
    // the morph (off unless the sequence names a Werkstatt knob): each step's morph value (0..1) takes that knob from
    // the sound's own value (0) to the top (1), set as the step triggers and glided over the slide on a slide into it.
    // Off, the parameter is put back and nothing here touches the voice
    this.morphPar = null; this.mCur = 0; this.mFrom = null; this.mTo = 0; this.mSet = null;
    this.rec = null;
    // the metronome: a short blip on each beat (clickN counts its samples, -1 silent), added after the recorder
    this.metro = false; this.clickN = -1; this.clickF = 1000;
    // the master: the distortion as an insert on the mix, then a compressor, the same design as the LXR-02's FX compressor
    this.master = { comp: true, thresh: -12, ratio: 3, attack: 5, release: 120, makeup: 0 };
    // the echo is the engine's own FX bus (the firmware's delay, tempo-synced, all wet as a send); the ring mod a send bus
    this.delayPos = 1 + Math.log2(3 / 16) / 7;
    this.dist = new LXR.FxBus(); this.dist.fxType = LXR.FX_DISTORTION; this.dist.forceWet = true;
    this.ring = new LXR.FxBus(); this.ring.fxType = LXR.FX_RING; this.ring.forceWet = true;
    // the reverb: the firmware's own (compiled out of the LXR-02, switched back on in the engine), a send bus
    this.verb = new LXR.FxBus(); this.verb.fxType = LXR.FX_REVERB; this.verb.forceWet = true;
    this.fxRng = new LXR.Rng(Player.seed !== undefined ? 0x2545f491 : this.seed);
    this.sendE = 0; this.sendR = 0; this.sendV = 0; this.verbQuiet = 256; this.echoWidth = 1; this.fxGain = new Float32Array(6);
    this.distMix = 0; this.distAt = 0;
    this.busIn = new Float32Array(128); this.busOut = new Int16Array(128);
    this.compEnv = 0; this.gr = 0;
    // the ducker: the fx returns (echo, ring mod, reverb) turned down by the dry voice, a sidechain on top of the fx.
    // Off, the returns go straight into the mix as before (to the bit); on, they're summed in W first, then ducked
    this.duck = { on: false, amt: 70, thresh: -18, atk: 1, hold: 50, rel: 250 };
    this.W = [new Float32Array(64), new Float32Array(64)];
    this.duckEnv = 0; this.duckHold = 0; this.dk = 0;
    this.events = [];
    this._render(this.A); this._render(this.B);
  }
  msg(m) {
    if (m.type === 'param') this.e.setParam(m.par, m.value);
    else if (m.type === 'kit') this.e.loadKit(m.values);
    else if (m.type === 'ws') { Object.assign(this.ws, m.p); this.w.a.set(this.ws); if (this.morphPar !== null) { this.mSet = null; this.setMorph(this.mCur); } }
    else if (m.type === 'wsB') this.w.b.set(m.p);
    else if (m.type === 'fm') { Object.assign(this.fm, m.p); this.w.setFm(this.fm); if (this.morphPar !== null) { this.mSet = null; this.setMorph(this.mCur); } }
    else if (m.type === 'pitch') { this.pitch = m.v; this.setPitch(this.cur); }
    else if (m.type === 'note') this.play(m.n, m.acc, m.gate, false, m.m || 0);
    else if (m.type === 'delay') this.delayPos = m.pos;
    else if (m.type === 'atBar') { if (this.playing) this.atBar.push(m.m); else this.msg(m.m); }
    else if (m.type === 'mix') {
      Object.assign(this.master, m.master);
      this.dist.distortion.type = m.dist.type;
      m.dist.p.forEach((v, i) => this.dist.setParameter(i, v / 127));
      this.distMix = (m.dist.mix || 0) / 100;
      this.ring.ringmod.osc.waveform = m.ring.wave;
      this.ring.setParameter(0, m.ring.freq / 127);
      if (m.verb) m.verb.forEach((v, i) => this.verb.setParameter(i, v / 127));
      if (m.duck) { Object.assign(this.duck, m.duck); if (!this.duck.on) { this.duckEnv = 0; this.duckHold = 0; } }
      this.sendE = m.sendE; this.sendR = m.sendR; this.sendV = m.sendV || 0; this.echoWidth = m.width / 100;
    } else if (m.type === 'rec') {
      this.rec = { L: new Float32Array(16384), R: new Float32Array(16384), n: 0 };
      this.events.push({ type: 'rec', state: 'on' });
    } else if (m.type === 'recStop') { if (this.rec) this.recEnd(); }
    else if (m.type === 'seq') {
      // a live change wins over one still waiting for the bar
      this.atBar = this.atBar.filter((q) => q.type !== 'seq');
      this.metro = !!m.metro; this.steps = m.steps; this.bpm = m.bpm; this.e.bpm = m.bpm; this.vel = m.vel; this.glide = m.glide;
      this.len = Math.max(1, Math.min(this.steps.length, m.len || this.steps.length)); if (this.pos >= this.len) this.pos = 0;
      this.accGain = Math.pow(10, -m.accentDb / 20);
      const mp = m.morph === undefined ? null : m.morph;
      if (mp !== this.morphPar) {
        if (this.morphPar !== null) this.morphTo(this.morphPar, null);
        this.morphPar = mp; this.mCur = 0; this.mFrom = null; this.mSet = null;
      }
      if (m.playing && !this.playing) { this.step = 0; this.pos = 0; this.bar = 0; this.toNext = 0; this.cutAt = Infinity; this.slideFrom = null; this.mFrom = null; }
      this.playing = m.playing;
      if (!this.playing) { this.flushBar(); this.cutAt = this.clock; }
    }
  }
  recFlush() {
    const r = this.rec;
    if (r.n) this.events.push({ type: 'recData', L: r.L.slice(0, r.n), R: r.R.slice(0, r.n) });
    r.n = 0;
  }
  recEnd() { this.recFlush(); this.events.push({ type: 'rec', state: 'done', bpm: this.bpm }); this.rec = null; }
  // a preset (or a randomise) waiting for the bar: its messages come in on the first step of the next one
  flushBar() {
    const q = this.atBar; this.atBar = [];
    for (const m of q) this.msg(m.type === 'seq' ? { ...m, playing: this.playing } : m);
  }
  // the voice to semitone n (from the sound's base note) plus pitch, without a new gate
  setPitch(n) { this.w.setOffset(n + this.pitch); }
  // a note: the pitch, and a new gate for the EG (it starts from wherever its capacitor is, as on the hardware).
  // slide: glide there from the note sounding instead, without a new gate. mv: the step's morph value
  play(n, acc, gate, slide, mv = 0) {
    if (slide) { this.slideFrom = this.cur; this.slideAt = 0; if (this.morphPar !== null) { this.mFrom = this.mCur; this.mTo = mv; } }
    else {
      this.slideFrom = null;
      if (this.morphPar !== null) { this.mFrom = null; this.mCur = mv; this.setMorph(mv); }
      this.gainTo = acc ? 1 : this.accGain; this.cur = n;
      this.w.noteOn(n + this.pitch); this.gateOpen = true;
    }
    this.note = n;
    const len = LXR.REAL_FS * 60 / this.bpm / 4;
    this.slideLen = Math.max(64, this.glide * len);
    this.cutAt = gate >= GATE_RING ? Infinity : this.clock + gate / 4 * len;
  }
  // the morph knob at k (0..1) of the way from the sound's own value to the top; at 0 exactly the sound's value
  setMorph(k) {
    const par = this.morphPar;
    if (par === null || k === this.mSet) return;
    this.mSet = k;
    this.morphTo(par, k);
  }
  // a morph knob (voice A's, or the FM's) at k of the way to its top; null: back to the sound's own value
  morphTo(par, k) {
    const fm = par in this.fm, b = fm ? this.fm[par] : this.ws[par];
    const top = (fm ? LXR.FM_PARAMS : LXR.WS_PARAMS).find((q) => q[0] === par)[4], v = k ? b + (top - b) * k : b;
    if (fm) this.w.setFm({ ...this.fm, [par]: v }); else this.w.a.set({ [par]: v });
  }
  // step s (of the sequence's len steps): its note, slid into from the step before when that one slides and both play; a step that slides on
  // keeps its gate open into the next (the sequence wraps at its length)
  doStep(s) {
    const S = this.steps, N = this.len, cur = S[s], prev = S[(s + N - 1) % N], next = S[(s + 1) % N];
    if (!cur.gate) return;
    const slideIn = prev.slide && prev.gate > 0 && this.cutAt === Infinity && this.gate > 0;
    this.play(cur.n, cur.acc, cur.slide && next.gate ? GATE_RING : cur.gate, slideIn, cur.m || 0);
    if (slideIn && cur.acc) this.gainTo = 1;
  }
  _render(dst) {
    if (this.playing) {
      if (this.toNext <= 0) {
        if (this.step === 0 && this.atBar.length) this.flushBar();
        const len = LXR.REAL_FS * 60 / this.bpm / 4;
        // the sequence plays through its length (the pages in turn) and starts again; a bar is still 16 steps
        this.doStep(this.pos);
        if (this.metro && this.step % 4 === 0) { this.clickN = 0; this.clickF = this.step === 0 ? 1760 : 1175; }
        this.events.push({ type: 'step', step: this.pos % 16, page: Math.floor(this.pos / 16), bar: this.bar, gr: this.gr, dk: this.dk });
        this.pos = (this.pos + 1) % this.len;
        this.gr = 0; this.dk = 0;
        this.step = (this.step + 1) % 16;
        if (this.step === 0) this.bar++;
        this.toNext += len;
      }
      this.toNext -= 64;
    }
    // a slide: the pitch glides from the note before over the glide time
    if (this.slideFrom !== null) {
      this.slideAt += 64;
      const k = Math.min(1, this.slideAt / this.slideLen);
      this.cur = this.slideFrom + (this.note - this.slideFrom) * k;
      this.setPitch(this.cur);
      if (this.mFrom !== null) { this.mCur = this.mFrom + (this.mTo - this.mFrom) * k; this.setMorph(this.mCur); }
      if (k >= 1) { this.slideFrom = null; this.cur = this.note; this.mFrom = null; }
    }
    // the gate closes: the EG lets go (it runs down at its decay, or holds on with the VCA switched to on)
    if (this.clock >= this.cutAt && this.gateOpen) { this.w.noteOff(); this.gateOpen = false; }
    this.clock += 64;
    // the engine runs for its FX bus; the voice is the Werkstatt's, put where the engine's drum 1 would be heard
    this.e.renderBlock();
    const e = this.e, v = e.drums[0];
    this.w.render(e.voiceOut[0]);
    const [L, R] = dst;
    // the fx returns go into W: the mix itself, or (ducking) a bus of their own
    const D = this.duck, ducking = D.on;
    const [WL, WR] = ducking ? this.W : dst;
    // the voice, its gain (the accent) ramped over the block
    const g1 = this.gainTo * this.gate, g0 = this.gain, dg = (g1 - g0) / 64;
    const o = e.voiceOut[0];
    const isDelay = e.fx.fxType === LXR.FX_DELAY;
    e.fx.forceWet = isDelay;
    e.fx.setDelaySync(isDelay ? delaySamples(this.delayPos, this.bpm) : null);
    const pl = v.triggeredPanL / 32768, pr = v.triggeredPanR / 32768;
    for (let i = 0; i < 64; i++) { const s = o[i] * (g0 + dg * i); L[i] = s * pl; R[i] = s * pr; }
    this.gain = g1;
    // the echo: the firmware's FX bus, sample-exact, fed at the echo send when the voice is routed to it
    this.fxGain[0] = e.audioRouting[0] === LXR.MIXER_ROUTING_FX_BUS ? g1 * this.sendE : 0;
    const fx = e.renderFx(this.fxGain, this.echoWidth);
    // the ring mod and reverb buses: the voice at each one's send, saturated to int16; the firmware's ring mod carrier
    // is quiet, so it gets makeup gain. The reverb runs every block, sent to or not, so its tail rings out
    // (with nothing sent, the ring mod's output is silence: its carrier just moves on)
    const bo = this.busOut, rg = this.sendR * g1;
    if (!rg && this.ring.idleRing(this.fxRng)) bo.fill(0); else this.busFeed(this.ring, rg, o, v);
    if (ducking) { WL.fill(0); WR.fill(0); }
    for (let i = 0; i < 64; i++) {
      WL[i] += (bo[2 * i] * RING_MAKEUP + fx[2 * i]) / 32768; WR[i] += (bo[2 * i + 1] * RING_MAKEUP + fx[2 * i + 1]) / 32768;
    }
    // (once nothing is sent and its tail has been silent for a while, it rests until something is sent again)
    const vg = this.sendV * g1;
    if (vg || this.verbQuiet < 256) {
      this.busFeed(this.verb, vg, o, v);
      let quiet = !vg;
      for (let i = 0; i < 64; i++) { WL[i] += bo[2 * i] / 32768; WR[i] += bo[2 * i + 1] / 32768; if (bo[2 * i]) quiet = false; }
      this.verbQuiet = quiet ? this.verbQuiet + 1 : 0;
    }
    if (ducking) this.duckFx(L, R, o, g0, dg);
    // the distortion, a master insert: the whole mix through the firmware's distortion, blended in at its mix amount,
    // ramped across the block; at 0 it's bypassed
    if (this.distMix || this.distAt) {
      const di = this.dist.input;
      for (let i = 0; i < 64; i++) { di[2 * i] = int16(L[i] * 32768); di[2 * i + 1] = int16(R[i] * 32768); }
      bo.fill(0);
      this.dist.process(bo, 64, this.fxRng);
      const m0 = this.distAt, m1 = this.distMix;
      for (let i = 0; i < 64; i++) { const m = m0 + (m1 - m0) * (i + 1) / 64; L[i] += (bo[2 * i] / 32768 - L[i]) * m; R[i] += (bo[2 * i + 1] / 32768 - R[i]) * m; }
      this.distAt = m1;
    }
    const M = this.master;
    if (M.comp) {
      // peak detector in dB, attack/release smoothing, gain = over * (1/ratio - 1) + makeup
      const ca = Math.exp(-1000 / (M.attack * LXR.REAL_FS)), cr = Math.exp(-1000 / (M.release * LXR.REAL_FS));
      const slope = 1 / M.ratio - 1, mk = Math.pow(10, M.makeup / 20);
      // (a peak well under the threshold is under it without its log: below this, over is 0 however the log rounds)
      const under = Math.pow(10, M.thresh / 20) * 0.999;
      let env = this.compEnv, gr = this.gr;
      for (let i = 0; i < 64; i++) {
        const peak = Math.max(Math.abs(L[i]), Math.abs(R[i])) + 1e-9;
        const over = peak < under ? 0 : Math.max(0, 20 * Math.log10(peak) - M.thresh);
        env = over + (over > env ? ca : cr) * (env - over);
        const g = Math.pow(10, env * slope / 20) * mk;
        L[i] *= g; R[i] *= g;
        gr = Math.max(gr, -env * slope);
      }
      this.compEnv = env; this.gr = gr;
    }
    // the recorder takes the finished mix at the engine's own rate
    const r = this.rec;
    if (r) { r.L.set(L, r.n); r.R.set(R, r.n); r.n += 64; if (r.n === r.L.length) this.recFlush(); }
    // the metronome's blip (about 40 ms), heard but not recorded
    if (this.clickN >= 0) {
      const w = 2 * Math.PI * this.clickF / LXR.REAL_FS, d = 120 / LXR.REAL_FS;
      for (let i = 0; i < 64; i++, this.clickN++) { const s = Math.sin(w * this.clickN) * Math.exp(-d * this.clickN) * 0.3; L[i] += s; R[i] += s; }
      if (this.clickN > LXR.REAL_FS * 0.04) this.clickN = -1;
    }
  }
  // the ducker: the dry voice (as heard, before its pan) is the key. Its peak level is followed sample by sample: up at
  // the attack (0: at once), held at its top for the hold, then down at the release. The fx are turned down in
  // proportion to that level, all the way (by the amount) once it reaches the threshold, so the ducking takes the
  // voice's own shape: a linear gain, nothing per sample but a few multiplies
  duckFx(L, R, o, g0, dg) {
    const D = this.duck, [WL, WR] = this.W, FS = LXR.REAL_FS;
    const ca = D.atk > 0 ? Math.exp(-1000 / (D.atk * FS)) : 0, cr = Math.exp(-1000 / (Math.max(1, D.rel) * FS));
    // (the voice's samples are on the int16 scale: the threshold is taken there)
    const holdN = Math.round(D.hold * FS / 1000), inv = 1 / (32768 * Math.pow(10, D.thresh / 20)), depth = D.amt / 100;
    let env = this.duckEnv, hold = this.duckHold, top = 0;
    for (let i = 0; i < 64; i++) {
      const k = Math.abs(o[i] * (g0 + dg * i));
      if (k >= env) { env = k + ca * (env - k); hold = holdN; }
      else if (hold > 0) hold--;
      else env = k + cr * (env - k);
      const d = Math.min(1, env * inv);
      if (d > top) top = d;
      const g = 1 - depth * d;
      L[i] += WL[i] * g; R[i] += WR[i] * g;
    }
    this.duckEnv = env < 1e-9 ? 0 : env; this.duckHold = hold;
    // the meter: the deepest ducking in dB this step
    const db = -20 * Math.log10(Math.max(1e-2, 1 - depth * top));
    if (db > this.dk) this.dk = db;
  }
  // a send bus: voice v's block o at the send's gain, saturated to int16, through the bus into this.busOut
  busFeed(bus, gain, o, v) {
    const bi = this.busIn, bo = this.busOut;
    for (let i = 0; i < 64; i++) {
      bi[2 * i] = gain ? int16(o[i] * v.triggeredPanL * gain) : 0;
      bi[2 * i + 1] = gain ? int16(o[i] * v.triggeredPanR * gain) : 0;
    }
    bus.input.set(bi); bo.fill(0);
    bus.process(bo, 64, this.fxRng);
  }
  process(L, R) {
    for (let n = 0; n < L.length; n++) {
      while (this.idx >= 64) {
        const t = this.A; this.A = this.B; this.B = t;
        this._render(this.B);
        this.idx -= 64;
      }
      const i = this.idx, fr = this.frac;
      const l0 = this.A[0][i], r0 = this.A[1][i];
      const l1 = i < 63 ? this.A[0][i + 1] : this.B[0][0];
      const r1 = i < 63 ? this.A[1][i + 1] : this.B[1][0];
      L[n] = l0 + (l1 - l0) * fr;
      R[n] = r0 + (r1 - r0) * fr;
      this.frac += this.ratio;
      const k = Math.floor(this.frac);
      this.idx += k; this.frac -= k;
    }
  }
}
