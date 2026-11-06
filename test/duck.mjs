// The duck (the fx returns turned down by the dry voice): off it changes nothing (test/sound.mjs holds that to the
// bit); at amount 0 it's the same sound as off (to rounding); full on, the fx under the voice all but go, and they
// come back in the gaps. Rendered through the player at a 48 kHz output, as test/sound.mjs does.
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const script = (id) => new RegExp(`<script id="${id}">\\n([\\s\\S]*?)</script>`).exec(html)[1];
const core = readFileSync(new URL('app/core.js', root), 'utf8');
const presets = /const BUILTIN_PRESETS = (.*);\n/.exec(html)[1];
const env = new Function(`${script('engine')}\n${script('player')}\nconst BUILTIN_PRESETS = ${presets};\n${core}
  return { Player, useSnapshot, snapshot, setFallback: (p) => { fallback = p; }, setPlaying: (v) => { playing = v; } };`)();
env.Player.seed = 1; // (the same pair of units every run)
let fails = 0;
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const base = JSON.parse(presets)[0];
function render(fxOver) {
  const p = new env.Player(48000);
  env.setFallback(p); env.setPlaying(true);
  const q = structuredClone(base);
  q.fx = { ...q.fx, send: 60, ring: 30, verb: 60, vDecay: 110, ...fxOver };
  q.dist = { mix: 0, type: 0, p: [70, 64, 80, 90] };
  q.master = { comp: false, thresh: -12, ratio: 3, attack: 5, release: 120, makeup: 0 };
  q.seq = { ...q.seq, density: 30 };
  env.useSnapshot(q, false);
  const n = 48000 * 4, L = new Float32Array(n), R = new Float32Array(n);
  for (let o = 0; o < n; o += 128) p.process(L.subarray(o, o + 128), R.subarray(o, o + 128));
  return [L, R];
}
const dry = render({ send: 0, ring: 0, verb: 0 });
const off = render({ duck: false });
const zero = render({ duck: true, dAmt: 0 });
const full = render({ duck: true, dAmt: 100, dThresh: -24, dAtk: 0, dHold: 0, dRel: 60 });
// the fx alone (the mix less the dry voice), as energy where the voice is loud and where it's quiet
const level = (x, y) => {
  let loud = 0, quiet = 0;
  for (let c = 0; c < 2; c++) for (let i = 0; i < x[c].length; i++) {
    const w = (x[c][i] - y[c][i]) ** 2;
    if (Math.abs(y[c][i]) > 0.05) loud += w; else quiet += w;
  }
  return { loud, quiet };
};
const a = level(off, dry), z = level(zero, dry), f = level(full, dry);
let diff = 0;
for (let c = 0; c < 2; c++) for (let i = 0; i < off[c].length; i++) diff = Math.max(diff, Math.abs(off[c][i] - zero[c][i]));
check(a.loud > 0 && a.quiet > 0, 'the fx are heard with the duck off');
check(diff < 1e-5, `amount 0 sounds as off (largest difference ${diff.toExponential(1)})`);
const dB = (k) => (10 * Math.log10(k)).toFixed(1);
check(f.loud < a.loud * 0.01, `full on, the fx under the voice drop ${dB(a.loud / f.loud)} dB`);
check(f.loud / a.loud < f.quiet / a.quiet, 'and less so in the gaps');
process.exit(fails ? 1 : 0);
