// ---- voice: laid out like the DFAM's panel. The panel tab has the two voices as the DFAM has its two VCOs: VCO A
// (with its FM into B, as the DFAM's 1->2 FM), VCO B, the mixer, VCO B's VCF, then the four AR envelopes (env 4, the vco env, below). VCO B is the
// main voice (the randomisers and morph act on it). Inside, the main voice is still state `ws` / engine voice
// `a`, and VCO A (the modulator) is `wsB` / engine `b`, so presets keep their meaning; only the panel names differ.
// The xtra tab has the rest: VCO A's other knobs, the FM's switches, and everything else of VCO B ----
// every Werkstatt knob, for the randomisers
const DR1 = LXR.WS_PARAMS.map((q) => q[0]);
// a voice's knobs, and how to set one ('fm': the FM and mixer)
const VOICE_OF = { a: { st: ws, set: setWs }, b: { st: wsB, set: setWsB }, fm: { st: fm, set: setFm } };
// each tab: [title, rows of faders, sections]; each section: [heading, box id, [[voice, key, label?], ...]]. (Voice A's
// boxes are named as before, m-voice-tone, -shape, -filter, so presets' knob sequencers still find them)
const A_ = (...ks) => ks.map((k) => ['a', k]), B_ = (...ks) => ks.map((k) => ['b', k]);
const VP_TABS = [
  ['panel', 3, [
    ['vco a', 'm-voice-b', [...B_('note', 'wave', 'pwm'), ['fm', 'fm', 'a→b fm']]],
    ['vco b', 'm-voice-tone', A_('note', 'wave', 'pwm')],
    ['mixer', 'm-voice-mix', [['fm', 'levelB', 'vco a'], ['fm', 'levelA', 'vco b']]],
    ['vcf', 'm-voice-filter', A_('cutoff', 'reso', 'vcfMod')],
    // the four AR envelopes (env 4, the vco env, below): env 1 opens vco a's VCA, env 2 vco b's, env 3 is the mod (vcf mod, and vco mod set to
    // eg) of both; each with the gate that fires it
    ['env a', 'm-voice-env1', [['b', 'attack'], ['b', 'decay', 'release'], ['fm', 'trig1', 'gate']]],
    ['env b', 'm-voice-shape', [['a', 'attack'], ['a', 'decay', 'release'], ['fm', 'trig2', 'gate']]],
    ['vcf eg', 'm-voice-env3', [['fm', 'e3Attack', 'attack'], ['fm', 'e3Release', 'release'], ['fm', 'trig3', 'gate']]],
    // env 4: the vco env, on each VCO's pitch by its own amount (up or down)
    ['vco env', 'm-voice-env4', [['b', 'vcoEnv', 'amt a'], ['a', 'vcoEnv', 'amt b'], ['fm', 'e4Attack', 'attack'], ['fm', 'e4Release', 'release'], ['fm', 'trig4', 'gate']]]]],
  ['xtra', 3, [
    ['a', 'm-voice-bx', B_('fine', 'vcoMod', 'vcoSrc', 'glide', 'cutoff', 'reso', 'vcfMod', 'vcfSrc', 'vcfPol', 'drive',
      'vcaMode', 'volume', 'lfoRate', 'lfoWave')],
    ['fm', 'm-voice-fm', [['fm', 'fmSrc', 'src'], ['fm', 'fmMode', 'mode']]],
    ['b', 'm-voice-mod', A_('fine', 'vcoMod', 'vcoSrc', 'glide', 'vcfSrc', 'vcfPol', 'drive', 'vcaMode', 'volume', 'lfoRate', 'lfoWave')]]]];
let mVSec = 0;
const mVBoxes = VP_TABS.map(([title, rows, secs], k) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'm-btn'; b.setAttribute('role', 'tab'); b.textContent = title;
  b.addEventListener('click', () => { mVSec = k; mVoiceShow(); }); $('m-vsec').append(b);
  const tab = document.createElement('div'); tab.className = `m-vtab m-vrows${rows}`; $('m-vsets').append(tab);
  const cols = secs.map(([, , ks]) => Math.ceil(ks.length / rows));
  tab.style.gridTemplateColumns = cols.map((c) => `${c}fr`).join(' '); // (each section as wide as its columns)
  secs.forEach(([name, id, ks], j) => {
    const sec = document.createElement('div'); sec.className = 'm-vpart';
    const head = document.createElement('div'); head.className = 'm-fxhead'; head.innerHTML = '<b></b>'; head.firstChild.textContent = name;
    const box = document.createElement('div'); box.className = 'm-faders m-vset'; box.id = id;
    box.style.gridTemplateColumns = `repeat(${cols[j]}, minmax(0, 1fr))`; box.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    sec.append(head, box); tab.append(sec);
    for (const [voice, key, label] of ks) {
      const sp = WS_SPEC[key], V = VOICE_OF[voice];
      mFader(box, label || sp.label, { min: sp.min, max: sp.max, get: () => V.st[key], set: (x) => V.set(key, x), show: (x) => sp.show(x), dflt: () => sp.dflt });
    }
  });
  return tab;
});
function mVoiceShow() {
  [...$('m-vsec').children].forEach((b, k) => b.setAttribute('aria-selected', k === mVSec));
  mVBoxes.forEach((tab, k) => { tab.hidden = k !== mVSec; });
}
mVoiceShow();
