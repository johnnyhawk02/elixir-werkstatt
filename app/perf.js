// ---- tempo: one dial in the top line, beside play (MIDI CC 1). The other perf dials are gone, to give the pages the
// room: reso and the FM are on the voice page, the sends on the fx page; the decay, filter and pitch macros are no more
// (a preset that has them is baked into its sound on loading) ----
const PERF_DIALS = [
  ['tempo', { min: 40, max: 240, travel: 2, get: () => tempo, set: (v) => { tempo = v; sendSeq(); }, show: (v) => `${v} bpm`, dflt: 120 }]];
const ccDials = PERF_DIALS.map(([label, o], i) => mFader($('m-perf'), label, { ...o, cc: i + 1 }));
// MIDI in (Web MIDI, any input, any channel): CC 1 turns the tempo, 0..127 over each one's range. Access is asked
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
