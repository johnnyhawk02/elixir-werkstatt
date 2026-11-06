// ---- the screen: pages, transport and the faders every page uses; then the perf, voice, fx and master
// pages and the randomisers ----

// ---- pages: perf stays on the left; the others sit on the right, one at a time: swipe across them, or tap a page button. A swipe starts anywhere but on a fader, the
// steps or a list, so dragging those never turns the page ----
const mPages = $('m-pages'), PANELS = [...mPages.querySelectorAll('[data-m-panel]')];
// the screen is laid out once at 1000 x 600 and scaled as a whole to fit the window, as a plugin window resizes
const M_W = 1000, M_H = 600;
let mK = 1;
function mFit() { mK = Math.min(innerWidth / M_W, innerHeight / M_H); $('m').style.setProperty('--k', mK); }
mFit(); addEventListener('resize', mFit);
let mCur = 0;
const pageHooks = [];
function mGo(i, smooth) {
  mCur = Math.max(0, Math.min(PANELS.length - 1, i));
  const t = PANELS[mCur].dataset.mPanel;
  mPages.scrollTo({ left: PANELS[mCur].offsetLeft - PANELS[0].offsetLeft, behavior: smooth ? 'smooth' : 'instant' });
  document.querySelectorAll('[data-m-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.mTab === t));
  pageHooks.forEach((h) => h(t));
}
document.querySelectorAll('[data-m-tab]').forEach((b) => b.addEventListener('click', () => mGo(PANELS.findIndex((p) => p.dataset.mPanel === b.dataset.mTab))));
addEventListener('resize', () => mGo(mCur));
{
  const NOSWIPE = '.m-vtrack, .m-steps, select, input';
  let sw = null;
  mPages.addEventListener('pointerdown', (e) => {
    if (sw || e.target.closest(NOSWIPE)) return;
    sw = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, left: mPages.scrollLeft, on: false };
  });
  mPages.addEventListener('pointermove', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    if (!e.buttons) { if (sw.on) mPages.classList.remove('swiping'); sw = null; return; } // (no press held: not a swipe)
    const dx = (e.clientX - sw.x) / mK, dy = (e.clientY - sw.y) / mK;
    if (!sw.on) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }
      if (Math.abs(dx) < 12) return;
      sw.on = true; mPages.setPointerCapture(e.pointerId); mPages.classList.add('swiping');
    }
    mPages.scrollLeft = sw.left - dx;
  });
  const end = (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const s = sw; sw = null;
    if (!s.on) return;
    mPages.classList.remove('swiping');
    const dx = (e.clientX - s.x) / mK, fast = Math.abs(dx) / Math.max(1, e.timeStamp - s.t) > 0.5;
    mGo(mCur + (Math.abs(dx) > mPages.clientWidth * 0.2 || (fast && Math.abs(dx) > 30) ? (dx < 0 ? 1 : -1) : 0), true);
  };
  // (a swipe holds the pointer, so one that ends on a button doesn't press it)
  mPages.addEventListener('pointerup', end); mPages.addEventListener('pointercancel', end);
}
$('m').addEventListener('contextmenu', (e) => e.preventDefault());

// ---- transport ----
function setPlaying(on) {
  playing = on;
  const pb = $('m-play'); pb.setAttribute('aria-pressed', on); pb.setAttribute('aria-label', on ? 'stop (space)' : 'play (space)'); pb.title = pb.getAttribute('aria-label');
  sendSeq();
  if (!on) stopHooks.forEach((h) => h());
}
const stopHooks = [];
const togglePlay = async () => { await startAudio(); setPlaying(!playing); };
// a small play button under the title, doing as the space bar does: a triangle while stopped, a square while playing
$('m-play').addEventListener('click', togglePlay);
// the space bar (or the play button under the title) starts and stops, and R starts and
// stops a recording (both still type in a text box); space never presses the button that has the focus
addEventListener('keydown', (e) => {
  if (e.target.closest('input[type="text"], textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) togglePlay(); }
  else if (e.code === 'KeyR' && !e.repeat) recToggle();
}, true);
addEventListener('keyup', (e) => { if (e.code === 'Space' && !e.target.closest('input[type="text"], textarea, select')) e.preventDefault(); }, true);
// ---- faders: vertical, readout on top and label under; dragging moves the value from where it is (a touch doesn't jump
// it), the whole track's height is the full range (travel 2: twice it, for finer steps), a double tap on the label
// resets it, and holding one still for half a second opens its step sequencer. While a sequencer runs, the fader sets
// its base (fd.base) and the sequencer moves the value around it: the fill is the value heard, the bar the base ----
const mFaders = [];
function mFader(box, label, { min, max, step = 1, get, set, show, dflt, travel = 1, cc = 0, detents = [], catch: grab = 0 }) {
  const el = document.createElement('div');
  el.className = cc ? 'm-vf m-dial' : 'm-vf';
  el.innerHTML = '<output></output><div class="m-vtrack" role="slider" tabindex="0"><i></i><b></b></div><span class="m-flab"></span>';
  // a dial (cc: its MIDI CC number, shown in its middle) turns by dragging up and down over 200 px
  if (cc) el.querySelector('.m-vtrack').insertAdjacentHTML('beforeend', `<em aria-hidden="true">${cc}</em>`);
  el.querySelector('.m-flab').textContent = label;
  const tr = el.querySelector('.m-vtrack'), out = el.querySelector('output');
  tr.setAttribute('aria-label', label);
  const hiOf = () => (typeof max === 'function' ? max() : max);
  const snap = (v) => Math.round(Math.max(min, Math.min(hiOf(), min + Math.round((v - min) / step) * step)) * 1e6) / 1e6;
  const put = (v) => { v = snap(v); if (v !== get()) set(v); draw(); };
  const draw = () => {
    const hi = hiOf(), v = get();
    out.textContent = show(v); tr.style.setProperty('--f', (v - min) / (hi - min || 1));
    tr.classList.toggle('mod', fd.base !== null); if (fd.base !== null) tr.style.setProperty('--b', (fd.base - min) / (hi - min || 1));
    tr.setAttribute('aria-valuemin', min); tr.setAttribute('aria-valuemax', hi); tr.setAttribute('aria-valuenow', v); tr.setAttribute('aria-valuetext', show(v));
  };
  const fd = { key: `${box.id}:${label}`, label, min, hiOf, step, get, show, put, snap, el, draw, cc, seq: null, base: null, off: 0, glide: null };
  // a move of the fader: its base while a sequencer runs, else its value
  const move = (v) => { if (fd.base !== null) { fd.base = snap(v); fsApply(fd); } else put(v); };
  fd.move = move;
  let drag = null, hold = 0;
  tr.addEventListener('pointerdown', (e) => {
    tr.setPointerCapture(e.pointerId); el.classList.add('held');
    drag = { y: e.clientY, v: fd.base !== null ? fd.base : get(), h: cc ? 200 : tr.getBoundingClientRect().height };
    clearTimeout(hold);
    hold = setTimeout(() => { if (!drag) return; const v = drag.v; end(); move(v); fsOpen(fd); }, 500);
  });
  // a fader only moves while the press that started on it is held: a pointer moving over it with no button down (a
  // release the page never heard, outside the window or under the step sequencer) ends the drag instead
  tr.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!e.buttons) { end(); return; }
    if (Math.abs(drag.y - e.clientY) > 6) clearTimeout(hold);
    // a drag near a detent catches on it (within grab of it either way)
    let v = drag.v + (drag.y - e.clientY) / (drag.h * travel) * (hiOf() - min);
    const dt = detents.find((d) => Math.abs(v - d) <= grab); if (dt !== undefined) v = dt;
    move(v);
  });
  const end = () => { clearTimeout(hold); drag = null; el.classList.remove('held'); };
  tr.addEventListener('pointerup', end); tr.addEventListener('pointercancel', end); tr.addEventListener('lostpointercapture', end);
  tr.addEventListener('keydown', (e) => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (d) { e.preventDefault(); move((fd.base !== null ? fd.base : get()) + d * step); }
  });
  let last = 0;
  el.querySelector('.m-flab').addEventListener('click', () => {
    const t = performance.now();
    if (t - last < 350 && dflt !== undefined) move(typeof dflt === 'function' ? dflt() : dflt); last = t;
  });
  box.append(el); mFaders.push(fd); drawHooks.push(draw);
  return fd;
}
const pct = (v) => (v === 100 ? '0%' : (v > 100 ? '+' : '−') + Math.abs(v - 100) + '%');

const sendPct = (v) => (v ? v + '%' : 'off');
// ---- the glass isn't flat: each control's ink shadow deepens a little toward the top right of the screen (--d, used
// by the CSS), worked out from where it sits on its own page, and again when the screen's size changes ----
function mDepth() {
  const m = $('m').getBoundingClientRect();
  for (const el of document.querySelectorAll('.m-vf, .m-btn, .m-toggle, .m-pload, .m-tabs button, .m-chead, .m-title, .m-seq-lenrow, .m-step')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const x = (((r.left + r.width / 2 - m.left) % m.width) + m.width) % m.width / m.width, y = (r.top + r.height / 2 - m.top) / m.height;
    el.style.setProperty('--d', (1 + 0.7 * Math.max(0, Math.min(1, x)) * Math.max(0, Math.min(1, 1 - y))).toFixed(2));
  }
}
addEventListener('resize', mDepth);
