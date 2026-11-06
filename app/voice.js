// ---- voice: two Werkstatt-01 voices, A and B, each with its knobs and switches in four sections: tone (the VCO: freq,
// wave, pwm, vco mod and its source, glide), shape (the EG's attack, decay and sustain, the VCA mode, volume), filter
// (the VCF: cutoff, res, vcf mod, its source and polarity, drive) and mod (the LFO); then fm + mix: B into A's VCO
// (amount, source, expo or linear) and the two voices' levels. Five tabs, each with its sections side by side ----
const VP_PAGES = [...['tone', 'shape', 'filter', 'mod'].map((sec) => [sec, LXR.WS_PARAMS.filter((q) => q[2] === sec).map((q) => q[0])]),
  ['fm', LXR.FM_PARAMS.map((q) => q[0])]];
// every Werkstatt knob, for the randomisers
const DR1 = LXR.WS_PARAMS.map((q) => q[0]);
// each tab: [title, voice ('a', 'b', or null for the fm + mix), sections]
const VP_TABS = [['a tone', 'a', ['tone', 'shape']], ['a filter', 'a', ['filter', 'mod']],
  ['b tone', 'b', ['tone', 'shape']], ['b filter', 'b', ['filter', 'mod']], ['fm + mix', null, ['fm']]];
// a voice's knobs, and how to set one
const VOICE_OF = { a: { st: ws, set: setWs }, b: { st: wsB, set: setWsB } };
let mVSec = 0;
const mVBoxes = VP_TABS.map(([title, voice, secs], k) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'm-btn'; b.setAttribute('role', 'tab'); b.textContent = title;
  b.addEventListener('click', () => { mVSec = k; mVoiceShow(); }); $('m-vsec').append(b);
  const tab = document.createElement('div'); tab.className = 'm-vtab'; $('m-vsets').append(tab);
  const cols = secs.map((name) => Math.ceil(VP_PAGES.find(([n]) => n === name)[1].length / 2));
  tab.style.gridTemplateColumns = cols.map((c) => `${c}fr`).join(' '); // (each section as wide as its columns)
  secs.forEach((name, j) => {
    const ps = VP_PAGES.find(([n]) => n === name)[1];
    const sec = document.createElement('div'); sec.className = 'm-vpart';
    const head = document.createElement('div'); head.className = 'm-fxhead'; head.innerHTML = '<b></b>';
    head.firstChild.textContent = voice ? `${voice} ${name}` : 'fm (b into a) + mix';
    // (voice A's boxes keep the ids they had before voice B, so presets' knob sequencers still find them)
    const box = document.createElement('div'); box.className = 'm-faders m-vset'; box.id = voice === 'b' ? `m-voice-b-${name}` : `m-voice-${name}`;
    box.style.gridTemplateColumns = `repeat(${cols[j]}, minmax(0, 1fr))`;
    sec.append(head, box); tab.append(sec);
    const V = voice ? VOICE_OF[voice] : { st: fm, set: setFm };
    for (const key of ps) {
      const sp = WS_SPEC[key];
      mFader(box, sp.label, { min: sp.min, max: sp.max, get: () => V.st[key], set: (x) => V.set(key, x), show: (x) => sp.show(x), dflt: () => sp.dflt });
    }
  });
  return tab;
});
function mVoiceShow() {
  [...$('m-vsec').children].forEach((b, k) => b.setAttribute('aria-selected', k === mVSec));
  mVBoxes.forEach((tab, k) => { tab.hidden = k !== mVSec; });
}
mVoiceShow();
