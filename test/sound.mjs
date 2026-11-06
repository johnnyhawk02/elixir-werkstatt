// Holds the sound still through refactors: every built-in preset (and Init), as it is and with the effects, master,
// pitch, octave, density and length pushed, is rendered for four bars through the player at a 48 kHz output, and
// the audio's hash is checked against test/sound-golden.json. Any change to what's heard, however small, fails.
//   node test/sound.mjs            check
//   node test/sound.mjs --write    record the hashes (only when a change to the sound is meant)
//   node test/sound.mjs --root DIR use DIR's index.html and app/core.js (to record from another checkout)
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const root = arg('--root') ? new URL(`file://${arg('--root').replace(/\/?$/, '/')}`) : new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const script = (id) => new RegExp(`<script id="${id}">\\n([\\s\\S]*?)</script>`).exec(html)[1];
const core = readFileSync(new URL('app/core.js', root), 'utf8');
const presets = /const BUILTIN_PRESETS = (.*);\n/.exec(html)[1];
const env = new Function(`${script('engine')}\n${script('player')}\nconst BUILTIN_PRESETS = ${presets};\n${core}
  return { LXR, Player, useSnapshot, snapshot, setFallback: (p) => { fallback = p; }, setPlaying: (v) => { playing = v; } };`)();
const { Player } = env;

const pushed = (p) => {
  const q = structuredClone(p);
  q.fx = { ...q.fx, send: 60, ring: 40, verb: 50, width: 150, ringWave: 2, ringFreq: 70, vDecay: 110 };
  q.dist = { mix: 60, type: 1, p: [90, 40, 70, 100] };
  q.master = { comp: true, thresh: -24, ratio: 6, attack: 3, release: 200, makeup: 4 };
  q.macro = { pitch: 0.37, decay: 140, filter: 70, fm: 160 };
  // voice B: an octave and a fifth up, into A by FM and heard a little
  q.wsB = { ...(q.ws || {}), note: ((q.ws && q.ws.note) || 36) + 19 }; q.fm = { fm: 40, fmSrc: 0, fmMode: 0, levelA: 100, levelB: 25 };
  q.seq = { ...q.seq, oct: 1, density: 60, len: 20, glide: 80 };
  return q;
};
const init = { name: 'Init', ...env.snapshot() };
const cases = [init, ...JSON.parse(presets)].flatMap((p) => [[p.name, p], [`${p.name} pushed`, pushed(p)]]);
const out = {};
for (const [name, pr] of cases) {
  const p = new Player(48000);
  env.setFallback(p); env.setPlaying(true);
  env.useSnapshot(pr, false);
  const n = Math.ceil(48000 * 240 / (pr.tempo || 120) * 4 / 128) * 128, L = new Float32Array(n), R = new Float32Array(n);
  for (let o = 0; o < n; o += 128) p.process(L.subarray(o, o + 128), R.subarray(o, o + 128));
  out[name] = createHash('sha256').update(Buffer.from(L.buffer)).update(Buffer.from(R.buffer)).digest('hex').slice(0, 16);
}
const file = new URL('sound-golden.json', import.meta.url);
if (process.argv.includes('--write')) { writeFileSync(file, JSON.stringify(out, null, 1) + '\n'); console.log(`wrote ${Object.keys(out).length} hashes`); process.exit(0); }
const gold = JSON.parse(readFileSync(file, 'utf8'));
let fails = 0;
for (const [k, h] of Object.entries(out)) { const ok = gold[k] === h; if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${k} sounds the same`); }
if (Object.keys(gold).length !== Object.keys(out).length) { fails++; console.log('FAIL the cases differ from the recorded ones'); }
process.exit(fails ? 1 : 0);
