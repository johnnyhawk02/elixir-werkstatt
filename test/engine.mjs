// Checks the synth's sound side without a browser: the built page's engine, audio thread and state (app/core.js) run
// in Node, the player rendering offline.
//   node test/engine.mjs [index.html]
// - the Werkstatt voice is in tune: its base note plus the sequencer's offset lands on the right frequency, and pitch
//   between semitones moves it in cents
// - the sequencer: rests don't play, a slide glides into the next step without a new gate, a short gate lets the EG go;
//   four pages play in turn
// - the reverb leaves a finite tail, and holds at the top of its decay
// - every built-in preset loads and plays at a sane level
import { readFileSync } from 'node:fs';
const html = readFileSync(process.argv[2] || new URL('../index.html', import.meta.url), 'utf8');
const script = (id) => new RegExp(`<script id="${id}">\\n([\\s\\S]*?)</script>`).exec(html)[1];
const core = readFileSync(new URL('../app/core.js', import.meta.url), 'utf8');
const presets = /const BUILTIN_PRESETS = (.*);\n/.exec(html)[1];
const env = new Function(`${script('engine')}\n${script('player')}\nconst BUILTIN_PRESETS = ${presets};\n${core}
  return { LXR, Player, useSnapshot, snapshot, SCALES, degSemis, setFallback: (p) => { fallback = p; }, setPlaying: (v) => { playing = v; } };`)();
const { LXR, Player } = env;
Player.seed = 1; // (the same pair of units every run, so the sound can be compared)
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

// tuning: a drone (VCA on, filter open) measured by its zero crossings, against equal temperament from A4 = 440 Hz
const freqOf = (p, secs = 1) => {
  const L = []; for (let b = 0; b < Math.ceil(LXR.REAL_FS * secs / 64); b++) { p._render(p.A); L.push(...p.A[0]); }
  const half = Math.floor(L.length / 2); let first = -1, last = -1, n = 0;
  for (let i = half + 1; i < L.length; i++) if (L[i - 1] < 0 && L[i] >= 0) { const t = i - 1 + L[i - 1] / (L[i - 1] - L[i]); if (first < 0) first = t; else n++; last = t; }
  return n / ((last - first) / LXR.REAL_FS);
};
const drone = () => {
  const p = new Player(LXR.REAL_FS);
  p.msg({ type: 'mix', master: { comp: false }, dist: { type: 0, p: [0, 0, 0, 0], mix: 0 }, ring: { wave: 0, freq: 40 }, sendE: 0, sendR: 0, width: 100, sendV: 0 });
  p.msg({ type: 'ws', p: { vcaMode: 1, cutoff: 100, reso: 0, wave: 0 } });
  return p;
};
{
  let worst = 0;
  for (const n of [-12, 0, 7, 21, 33]) {
    const p = drone(); p.msg({ type: 'note', n, acc: true, gate: 5 });
    const want = 440 * Math.pow(2, (36 + n - 69) / 12), c = 1200 * Math.log2(freqOf(p) / want);
    worst = Math.max(worst, Math.abs(c));
  }
  check(worst < 3, `the Werkstatt is in tune from C1 to A4 (worst ${worst.toFixed(2)} cents; the expo's bulk resistance runs it a little flat up top)`);
  // each step sets both VCOs' pitches: vco b (the main voice, heard here) a fifth up
  const p = drone(); p.msg({ type: 'note', na: 0, nb: 0, gate: 5 }); const f0 = freqOf(p);
  p.msg({ type: 'note', na: 0, nb: 7, gate: 5 }); const c = 1200 * Math.log2(freqOf(p) / f0);
  check(Math.abs(c - 700) < 3, `a step's pitch b of +7 is +${c.toFixed(1)} cents on vco b`);
}
// voice B into voice A: with the FM off and B at level 0, B isn't run and A sounds as it did alone; FM (expo or linear,
// from B's VCO or its output) changes A's sound and stays finite and sane; B's level brings B in
{
  const run = (fmP, wsB) => {
    const p = drone(); p.msg({ type: 'ws', p: { vcaMode: 1, cutoff: 70, reso: 30 } });
    if (wsB) p.msg({ type: 'wsB', p: wsB }); if (fmP) p.msg({ type: 'fm', p: fmP });
    p.msg({ type: 'note', n: 0, acc: true, gate: 5 });
    const L = []; for (let b = 0; b < 200; b++) { p._render(p.A); L.push(...p.A[0]); }
    let bad = false, peak = 0; for (const x of L) { if (!Number.isFinite(x)) bad = true; peak = Math.max(peak, Math.abs(x)); }
    return { L, bad, peak, bTicks: p.w.b.cv !== null };
  };
  const diff = (x, y) => x.L.reduce((m, v, i) => Math.max(m, Math.abs(v - y.L[i])), 0);
  const off = run(null, null), quiet = run({ fm: 0, levelB: 0 }, { note: 48, vcaMode: 1, cutoff: 100 });
  check(!off.bTicks && diff(off, quiet) === 0, 'FM off and B silent: B is not run, and A sounds the same');
  const B = { note: 55, vcaMode: 1, cutoff: 100, reso: 0 };
  const cases = [['expo from b vco', { fm: 50 }], ['lin from b vco', { fm: 70, fmMode: 1 }], ['expo from b out', { fm: 50, fmSrc: 1 }], ['b level', { levelB: 80 }]];
  for (const [name, f] of cases) {
    const r = run(f, B);
    check(!r.bad && r.peak < 1.5 && diff(r, off) > 0.01, `${name}: changes the sound, finite and sane (peak ${(20 * Math.log10(r.peak)).toFixed(1)} dB)`);
  }
}
// the sequencer: two gate lanes and two pitch lanes. Gates open on their steps and close after their times; each
// envelope follows the gate it's set to (by default env 2, vco b's VCA, on gate a; env 1, vco a's, on gate b; env 3,
// the filters', on either); each step sets both pitches
{
  const p = new Player(LXR.REAL_FS), gates = [], offs = [];
  const gt = p.w.gate.bind(p.w), so = p.w.setOffsets.bind(p.w);
  p.w.gate = (l, on) => { if (on) gates.push([p.step, 'ab'[l]]); gt(l, on); };
  p.w.setOffsets = (a, b) => { offs.push([Math.round(a), Math.round(b)]); so(a, b); };
  const S = (ga, gb, na = 0, nb = 0) => ({ ga, gb, na, nb, m: 0 });
  const steps = [S(4, 0, 0, 0), S(0, 2, 5, 3), S(1, 1, 7, 2), ...Array.from({ length: 13 }, () => S(0, 0))];
  p.msg({ type: 'seq', playing: true, bpm: 120, steps });
  const len = LXR.REAL_FS * 60 / 120 / 4;
  let env2Early = false, env1On = false, env2OnB = false, env3B = false;
  for (let b = 0; b < Math.ceil(4 * len / 64); b++) {
    p._render(p.A);
    if (p.step === 2 && p.toNext > 0 && p.w.b.eg.stage !== 0) env1On = true;
    if (p.step === 2 && p.toNext > len * 0.6 && (p.w.a.eg.stage === 1 || p.w.a.eg.stage === 2)) env2OnB = true;
    if (p.step === 2 && p.toNext > len * 0.6 && (p.w.e3.stage === 1 || p.w.e3.stage === 2)) env3B = true;
    if (p.step === 3 && p.toNext < len * 0.3 && p.w.a.eg.stage === 3) env2Early = true;
  }
  check(JSON.stringify(gates.slice(0, 4)) === JSON.stringify([[0, 'a'], [1, 'b'], [2, 'a'], [2, 'b']]), `the gates open on their steps (${JSON.stringify(gates.slice(0, 4))})`);
  check(JSON.stringify(offs.slice(0, 3)) === '[[0,0],[5,3],[7,2]]', `each step sets both pitches (${JSON.stringify(offs.slice(0, 3))})`);
  check(env1On && env3B && !env2OnB, 'gate b fires env 1 and env 3, not env 2');
  check(env2Early, 'a quarter gate lets its envelope go before its step is out');
}
// four pages: they play in turn, a bar each, then page 1 again
{
  const p = new Player(LXR.REAL_FS), hits = [];
  const so = p.w.setOffsets.bind(p.w);
  p.w.setOffsets = (a, b) => { if (p.step % 16 === 0) hits.push(Math.round(b)); so(a, b); };
  const steps = Array.from({ length: 64 }, (_, i) => ({ na: 0, nb: Math.floor(i / 16), ga: i % 16 === 0 ? 4 : 0, gb: 0, m: 0 }));
  p.msg({ type: 'seq', playing: true, bpm: 120, steps });
  for (let b = 0; b < Math.ceil(LXR.REAL_FS * 2 * 4.5 / 64); b++) p._render(p.A);
  check(JSON.stringify(hits) === '[0,1,2,3,0]', `four pages play in turn (${JSON.stringify(hits)})`);
}
// the reverb: a note sent to it leaves a tail after the voice has stopped, finite and at a sane level, and at the top
// of its decay (with the tone in the middle) it holds
{
  // the reverb alone (no compressor): the loudest sample, and the loudest from `from` seconds on, over `secs` seconds
  const run = (decay, secs, from) => {
    const p = new Player(LXR.REAL_FS);
    p.msg({ type: 'mix', master: { comp: false }, dist: { type: 0, p: [0, 0, 0, 0], mix: 0 }, ring: { wave: 0, freq: 40 }, sendE: 0, sendR: 0,
      width: 100, sendV: 1, verb: [16, decay, 64, 64] });
    p.msg({ type: 'note', n: 0, acc: true, gate: 2 });
    let peak = 0, tail = 0, bad = false;
    for (let b = 0; b < Math.ceil(LXR.REAL_FS * secs / 64); b++) {
      p._render(p.A);
      for (const ch of p.A) for (const x of ch) { if (!Number.isFinite(x)) bad = true; peak = Math.max(peak, Math.abs(x)); if (b * 64 > LXR.REAL_FS * from) tail = Math.max(tail, Math.abs(x)); }
    }
    return { peak, tail, bad };
  };
  const dB = (x) => (20 * Math.log10(x)).toFixed(1);
  const r = run(100, 0.6, 0.4), held = run(127, 3, 2.8);
  check(!r.bad && !held.bad && r.peak < 1.5 && held.peak < 1.5, `reverb: finite and sane (peak ${dB(r.peak)} dB)`);
  check(r.tail > 0.001, `reverb: a tail after the note (${dB(r.tail)} dB at 0.4 s)`);
  check(held.tail > 0.01, `reverb: decay at the top holds (${dB(held.tail)} dB after 2.8 s)`);
}
// the built-in presets: each loads and plays at a sane level
{
  const list = JSON.parse(presets);
  for (const pr of list) {
    const p = new Player(LXR.REAL_FS);
    env.setFallback(p); env.setPlaying(true);
    env.useSnapshot(pr, false);
    let peak = 0, sum = 0, n = 0, bad = false;
    for (let b = 0; b < Math.ceil(LXR.REAL_FS * 240 / pr.tempo * 2 / 64); b++) {
      p._render(p.A);
      for (const ch of p.A) for (const x of ch) { if (!Number.isFinite(x)) bad = true; peak = Math.max(peak, Math.abs(x)); sum += x * x; n++; }
    }
    const rms = Math.sqrt(sum / n);
    check(!bad && peak > 0.05 && peak < 1.5, `${pr.name}: peak ${(20 * Math.log10(peak)).toFixed(1)} dB, rms ${(20 * Math.log10(rms)).toFixed(1)} dB`);
  }
}
process.exit(fails ? 1 : 0);
