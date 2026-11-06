// ---- voice: the Werkstatt-01's knobs and switches in four sections: tone (the VCO: freq, wave, pwm, vco mod and its
// source, glide), shape (the EG's attack, decay and sustain, the VCA mode, volume), filter (the VCF: cutoff, res, vcf mod,
// its source and polarity, drive) and mod (the LFO). The page has two tabs, each with two sections side by side ----
const VP_PAGES = ['tone', 'shape', 'filter', 'mod'].map((sec) => [sec, LXR.WS_PARAMS.filter((q) => q[2] === sec).map((q) => q[0])]);
// every Werkstatt knob, for the randomisers
const DR1 = LXR.WS_PARAMS.map((q) => q[0]);
const VP_TABS = [['tone + shape', ['tone', 'shape']], ['filter + mod', ['filter', 'mod']]];
let mVSec = 0;
const mVBoxes = VP_TABS.map(([title, secs], k) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'm-btn'; b.setAttribute('role', 'tab'); b.textContent = title;
  b.addEventListener('click', () => { mVSec = k; mVoiceShow(); }); $('m-vsec').append(b);
  const tab = document.createElement('div'); tab.className = 'm-vtab'; $('m-vsets').append(tab);
  const cols = secs.map((name) => Math.ceil(VP_PAGES.find(([n]) => n === name)[1].length / 2));
  tab.style.gridTemplateColumns = cols.map((c) => `${c}fr`).join(' '); // (each section as wide as its columns)
  secs.forEach((name, j) => {
    const ps = VP_PAGES.find(([n]) => n === name)[1];
    const sec = document.createElement('div'); sec.className = 'm-vpart';
    const head = document.createElement('div'); head.className = 'm-fxhead'; head.innerHTML = '<b></b>'; head.firstChild.textContent = name;
    const box = document.createElement('div'); box.className = 'm-faders m-vset'; box.id = `m-voice-${name}`;
    box.style.gridTemplateColumns = `repeat(${cols[j]}, minmax(0, 1fr))`;
    sec.append(head, box); tab.append(sec);
    for (const key of ps) {
      const sp = WS_SPEC[key];
      mFader(box, sp.label, { min: sp.min, max: sp.max, get: () => ws[key], set: (x) => setWs(key, x), show: (x) => sp.show(x), dflt: () => sp.dflt });
    }
  });
  return tab;
});
function mVoiceShow() {
  [...$('m-vsec').children].forEach((b, k) => b.setAttribute('aria-selected', k === mVSec));
  mVBoxes.forEach((tab, k) => { tab.hidden = k !== mVSec; });
}
mVoiceShow();
