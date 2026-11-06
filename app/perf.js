// ---- perf: eight dials in a line along the top, MIDI CC 1 to 8 in order: tempo, pitch, decay, filter, reso, mod, the
// echo send and the reverb send. Decay, filter and mod (the Werkstatt's vco mod) are macros on top of the sound; the rest move the same settings
// as their faders on the other pages ----
const PERF_DIALS = [
  ['tempo', { min: 40, max: 240, travel: 2, get: () => tempo, set: (v) => { tempo = v; sendSeq(); }, show: (v) => `${v} bpm`, dflt: 120 }],
  // pitch is free: hundredths of a semitone, over twice the travel
  ['pitch', { min: -24, max: 24, step: 0.01, travel: 2, get: () => macro.pitch, set: (v) => setMacro('pitch', v),
    show: (v) => (Math.abs(v) < 0.005 ? '0 st' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' st'), dflt: 0 }],
  ...['decay', 'filter'].map((m) => [m, { min: 0, max: 200, get: () => macro[m], set: (v) => setMacro(m, v), show: pct, dflt: 100 }]),
  ['reso', { min: 0, max: 100, get: () => ws.reso, set: (v) => setWs('reso', v), show: (v) => `${v}%`, dflt: () => LXR.WS_DEFAULTS.reso }],
  ['mod', { min: 0, max: 200, get: () => macro.fm, set: (v) => setMacro('fm', v), show: pct, dflt: 100 }],
  ...[['echo', 'send'], ['reverb', 'verb']].map(([l, k]) => [l, { min: 0, max: 100, get: () => fx[k], set: (v) => { fx[k] = v; sendMix(); }, show: sendPct, dflt: 0 }])];
const ccDials = PERF_DIALS.map(([label, o], i) => mFader($('m-perf'), label, { ...o, cc: i + 1 }));
// MIDI in (Web MIDI, any input, any channel): CC 1 to 8 turn the dials, 0..127 over each one's range. Access is asked
// for at the first touch (or straight away if it was given before); controllers plugged in later are picked up
{
  let redraw = 0;
  const onMidi = (e) => {
    const [st, n, v] = e.data;
    if ((st & 0xf0) !== 0xb0 || n < 1 || n > ccDials.length) return;
    const fd = ccDials[n - 1];
    fd.el.classList.add('cc');
    fd.move(fd.min + v / 127 * (fd.hiOf() - fd.min));
    if (!redraw) redraw = requestAnimationFrame(() => { redraw = 0; drawAll(); });
  };
  let asked = false;
  const ask = () => {
    if (asked || !navigator.requestMIDIAccess) return;
    asked = true;
    navigator.requestMIDIAccess().then((acc) => {
      const bind = () => acc.inputs.forEach((i) => { i.onmidimessage = onMidi; });
      bind(); acc.onstatechange = bind;
    }, () => {});
  };
  addEventListener('pointerdown', ask, { once: true, capture: true });
  if (navigator.permissions) navigator.permissions.query({ name: 'midi' }).then((p) => { if (p.state === 'granted') ask(); }, () => {});
}
