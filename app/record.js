// ---- record: R starts a take at once (and starts playing), R again stops it and downloads it as a WAV (44.1 kHz,
// 16-bit, the finished mix). While it runs, the title corner shows REC and the time ----
let recState = 'off', recChunks = [], recT0 = 0, recTimer = 0, takeNo = 0;
function recUi() {
  const on = recState === 'on';
  const ind = $('m-rec-t');
  ind.hidden = recState === 'off'; ind.classList.toggle('on', on);
  clearInterval(recTimer);
  if (on) {
    const tick = () => { const t = Math.max(0, (performance.now() - recT0) / 1000); ind.textContent = `rec ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
    tick(); recTimer = setInterval(tick, 250);
  } else ind.textContent = recState === 'saving' ? 'saving' : '';
}
async function recToggle() {
  if (recState === 'off') {
    await startAudio();
    recChunks = []; recState = 'on'; recT0 = performance.now();
    post({ type: 'rec' });
    if (!playing) setPlaying(true);
  } else if (recState === 'on') { recState = 'saving'; post({ type: 'recStop' }); }
  recUi();
}
eventHandlers.push((ev) => {
  if (ev.type === 'recData') recChunks.push(ev);
  else if (ev.type === 'rec' && ev.state === 'done') finishTake(ev);
});
async function finishTake(ev) {
  const n = recChunks.reduce((a, c) => a + c.L.length, 0), rate = 44100;
  if (n) {
    const src = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: LXR.REAL_FS });
    for (const [ch, key] of [[0, 'L'], [1, 'R']]) { const d = src.getChannelData(ch); let o = 0; for (const c of recChunks) { d.set(c[key], o); o += c[key].length; } }
    const frames = Math.round(n * rate / LXR.REAL_FS), off = new OfflineAudioContext(2, frames, rate);
    const bs = off.createBufferSource(); bs.buffer = src; bs.connect(off.destination); bs.start();
    const out = await off.startRendering();
    const name = `elixir-werkstatt ${(pCur && pCur.name) || 'take'} ${ev.bpm}bpm ${++takeNo}.wav`.replace(/[^\w' .-]/g, '');
    mDownload({ blob: wavBlob(out.getChannelData(0), out.getChannelData(1), rate), name });
  }
  recChunks = []; recState = 'off'; recUi();
}
function wavBlob(L, R, rate) {
  const n = L.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true);
  v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 4, true);
  let o = 44;
  // triangular dither, clipped at full scale
  for (let i = 0; i < n; i++) for (const x of [L[i], R[i]]) { v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(x * 32767 + rnd() - rnd()))), true); o += 2; }
  return new Blob([buf], { type: 'audio/wav' });
}
function mDownload(t) {
  const a = document.createElement('a'), url = URL.createObjectURL(t.blob);
  a.href = url; a.download = t.name; a.style.display = 'none';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
// phones get the share sheet (save to files, apps); elsewhere it downloads (false if the share sheet was cancelled)
async function mOffer(t, type) {
  const file = new File([t.blob], t.name, { type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: t.name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  mDownload(t);
  return true;
}
recUi();
