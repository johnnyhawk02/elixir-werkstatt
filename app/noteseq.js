// ---- the seq page: the note sequencer. Four pages of sixteen steps; length says how many of them play (1 to 64,
// through the pages in turn). Along the top: the page tabs (the one playing underlined, those past the length faded),
// copy (the page shown onto the next) and oct - / oct + (the whole sequence an octave). Then the page's sixteen steps:
// a step's height is its note, two octaves of the scale (a touch on a resting step brings it on), and the A and S under
// it switch its accent and slide (tap, or drag along the row). Under the notes, a lane of the steps' gate times
// (bottom rests, then a quarter to all of the step, top rings), or (the morph button) of their morph values. Under that
// the faders (root, scale, accent, length, density, glide, morph, algo) and random, alter, undo ----
let nsPage = 0;
const nsAbs = (i) => nsPage * 16 + i;
const nsStep = (i) => seq.steps[nsAbs(i)];
// a change to the sequence: to the player, and onto the page
const nsChanged = () => { sendSeq(); nsDraw(); };
const nsRow = (id, cls, html) => Array.from({ length: 16 }, (_, i) => {
  const c = document.createElement('div'); c.className = cls; c.dataset.i = i; c.setAttribute('role', 'gridcell');
  c.innerHTML = html; $(id).append(c); return c;
});
const nsCells = nsRow('m-steps', 'm-step',
  '<span class="m-sn"></span><i class="m-sbar"></i><span class="m-sm"><b class="a" role="button" aria-label="accent">A</b><b class="s" role="button" aria-label="slide">S</b></span>');
const nsGates = nsRow('m-gates', 'm-step m-gstep', '<i class="m-sbar"></i><span class="m-sn"></span>');
const nsMorphs = nsRow('m-morphs', 'm-step m-gstep', '<i class="m-sbar"></i><span class="m-sn"></span>');
const GATE_NAMES = ['rest', '¼', '½', '¾', 'full', 'ring'];
// which lane is under the notes: the gate times, or the morph values
let nsLaneMorph = false;
$('m-nlane').addEventListener('click', () => { nsLaneMorph = !nsLaneMorph; nsDraw(); });
function nsDraw() {
  const thin = thinned(), top = degMax();
  nsCells.forEach((c, i) => {
    const st = nsStep(i), g = nsGates[i], name = st.gate ? noteName(stepNote(st)) : 'rest';
    for (const el of [c, g]) { el.classList.toggle('thin', thin[nsAbs(i)]); el.classList.toggle('out', nsAbs(i) >= seq.len); el.classList.toggle('rest', !st.gate); }
    c.classList.toggle('acc', st.acc); c.classList.toggle('slide', st.slide);
    c.style.setProperty('--f', (Math.min(st.d, top) + 1) / (top + 1));
    c.querySelector('.m-sn').textContent = st.gate ? name : '—';
    c.setAttribute('aria-label', `step ${i + 1}: ${name}${st.acc ? ', accent' : ''}${st.slide ? ', slide' : ''}`);
    g.style.setProperty('--f', st.gate / 5);
    g.querySelector('.m-sn').textContent = GATE_NAMES[st.gate];
    g.setAttribute('aria-label', `step ${i + 1} gate: ${GATE_NAMES[st.gate]}`);
    const mc = nsMorphs[i], mv = st.m || 0;
    mc.classList.toggle('thin', thin[nsAbs(i)]); mc.classList.toggle('out', nsAbs(i) >= seq.len); mc.classList.toggle('rest', !st.gate);
    mc.style.setProperty('--f', mv / 100);
    mc.querySelector('.m-sn').textContent = String(mv);
    mc.setAttribute('aria-label', `step ${i + 1} morph: ${mv}`);
  });
  $('m-gates').hidden = nsLaneMorph; $('m-morphs').hidden = !nsLaneMorph;
  $('m-nlane').setAttribute('aria-pressed', nsLaneMorph);
  $('m-nlane').textContent = nsLaneMorph ? 'gates' : 'morph';
  $('m-morphs').classList.toggle('off', !seq.morph);
  document.querySelectorAll('#m-npages [data-page]').forEach((b) => { b.setAttribute('aria-selected', +b.dataset.page === nsPage); b.classList.toggle('out', +b.dataset.page * 16 >= seq.len); });
  $('m-ncopy').textContent = `copy to ${Math.min(nsPage + 2, PAGES)}`; $('m-ncopy').disabled = nsPage >= PAGES - 1;
  $('m-noct-out').textContent = seq.oct > 0 ? `+${seq.oct}` : String(seq.oct);
  $('m-noct-dn').disabled = seq.oct <= OCT_MIN; $('m-noct-up').disabled = seq.oct >= OCT_MAX;
}
drawHooks.push(nsDraw);
const nsShow = (pg) => { nsPage = pg; nsDraw(); nsNow(); };
$('m-npages').addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) nsShow(+b.dataset.page); });
// octave down and up: the whole sequence, every page
const nsOct = (k) => { seq.oct = Math.max(OCT_MIN, Math.min(OCT_MAX, seq.oct + k)); nsChanged(); };
// shift: the whole sequence (the steps within its length, every lane: note, gate, accent, slide, morph) a step left
// or right, wrapping round at the length
function nsShift(k) {
  const n = seq.len, was = seq.steps.slice(0, n);
  for (let s = 0; s < n; s++) seq.steps[s] = was[(s - k + n) % n];
  nsChanged();
}
for (const b of document.querySelectorAll('[data-nshift]')) b.addEventListener('click', () => nsShift(+b.dataset.nshift));
$('m-noct-dn').addEventListener('click', () => nsOct(-1));
$('m-noct-up').addEventListener('click', () => nsOct(1));
// hear a note as it's set, while stopped
function nsHear(st) { if (!playing && st.gate) { startAudio(); send({ type: 'note', n: degSemis(st.d), acc: st.acc, gate: st.gate, m: (st.m || 0) / 100 }); } }
// how high a touch is on el: 0 at its bottom to 1 at its top
const nsY = (el, e) => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(0.999, (r.bottom - e.clientY) / r.height)); };
// a row of sixteen that a touch, or a drag across, edits: edit(i, e, first) changes step i and says whether to play it
// (true), that it changed without a note to play (false), or that nothing changed (null)
function nsLane(box, edit) {
  let on = false;
  const at = (e, first) => {
    const r = box.getBoundingClientRect();
    const i = Math.max(0, Math.min(15, Math.floor((e.clientX - r.left) / r.width * 16)));
    const hear = edit(i, e, first);
    if (hear === null) return;
    if (hear || first) nsHear(nsStep(i));
    nsChanged();
  };
  box.addEventListener('pointerdown', (e) => { box.setPointerCapture(e.pointerId); on = true; at(e, true); });
  const stop = () => { on = false; };
  box.addEventListener('pointermove', (e) => { if (on && !e.buttons) stop(); else if (on) at(e, false); });
  box.addEventListener('pointerup', stop); box.addEventListener('pointercancel', stop); box.addEventListener('lostpointercapture', stop); dragStops.add(stop);
}
// the notes; a touch that starts on the A/S row (or a little above it: the left half is A, the right S) switches that,
// and a drag along the row sets the others the same. Otherwise the note is where the touch is on the step's bar
{
  let flag = null;
  nsLane($('m-steps'), (i, e, first) => {
    const st = nsStep(i);
    if (first) {
      const m = nsCells[i].querySelector('.m-sm').getBoundingClientRect();
      const k = e.clientX < m.left + m.width / 2 ? 'acc' : 'slide';
      flag = e.clientY >= m.top - m.height * 0.5 ? { k, to: !st[k], seen: new Set() } : null;
    }
    if (flag) {
      if (flag.seen.has(i)) return null;
      flag.seen.add(i); st[flag.k] = flag.to;
      return false;
    }
    const d = Math.min(degMax(), Math.floor(nsY(nsCells[i].querySelector('.m-sbar'), e) * (degMax() + 1)));
    if (d !== st.d || !st.gate) { st.d = d; if (!st.gate) st.gate = 4; return true; }
    return first ? false : null;
  });
}
// the gate times
nsLane($('m-gates'), (i, e, first) => {
  const st = nsStep(i), g = Math.floor(nsY(nsGates[i], e) * 6);
  if (g !== st.gate) { st.gate = g; return true; }
  return first ? false : null;
});
// the morph values, 0 (the bottom) to 100 (the top) in fives
nsLane($('m-morphs'), (i, e, first) => {
  const st = nsStep(i), m = Math.floor(nsY(nsMorphs[i], e) * 21) * 5;
  if (m !== (st.m || 0)) { st.m = m; return true; }
  return first ? false : null;
});
// the step playing (if its page is shown) and its page, marked as they're heard
let nsAt = null;
function nsNow() {
  nsCells.forEach((c, i) => c.classList.toggle('now', !!nsAt && nsAt.page === nsPage && i === nsAt.step));
  document.querySelectorAll('#m-npages [data-page]').forEach((b) => b.classList.toggle('now', !!nsAt && +b.dataset.page === nsAt.page));
}
eventHandlers.push((ev) => {
  if (ev.type !== 'step') return;
  if (document.hidden) { nsAt = ev; return; }
  whenHeard(() => { if (playing) { nsAt = ev; nsNow(); } });
});
stopHooks.push(() => { nsAt = null; nsNow(); });
// (out of sight the step marker stands still, and catches up on the next step back on screen)

// the faders: each a setting of the sequence
const nsFader = (label, key, o) => mFader($('m-seqf'), label, { get: () => seq[key], set: (v) => { seq[key] = v; nsChanged(); }, dflt: SEQ0[key], ...o });
nsFader('root', 'root', { min: 0, max: 11, show: (v) => NOTE_NAMES[v] });
nsFader('scale', 'scale', { min: 0, max: SCALES.length - 1, show: (v) => SCALES[v][0] });
nsFader('accent', 'accent', { min: 0, max: 12, show: (v) => `+${v}dB` });
// length: a drag catches at 16, 32 and 48 (a page, two, three)
// (the main page has the same fader: a move of either redraws both)
const nsLen = (v) => { seq.len = v; nsChanged(); drawAll(); };
nsFader('length', 'len', { set: nsLen, min: 1, max: NSTEPS, show: (v) => String(v), detents: [16, 32, 48], catch: 2.5 });
nsFader('density', 'density', { set: (v) => { seq.density = v; nsChanged(); drawAll(); }, min: 0, max: 100, step: 5, show: (v) => v + '%' });
nsFader('glide', 'glide', { min: 0, max: 100, step: 5, show: (v) => v + '%' });
// morph: off, or the voice parameter the morph lane moves
nsFader('morph', 'morph', { min: 0, max: MORPH_DESTS.length, show: (v) => (v ? MORPH_DESTS[v - 1][0] : 'off') });

// random: a new line for a page, made by the algorithm picked on the algo fader (kept in the preset). Each makes 16
// steps of { d: degree of the scale, gate, acc, slide }, so whatever it makes stays in the key
const st = (d, gate, acc = false, slide = false) => ({ d: Math.max(0, Math.min(degMax(), d)), gate, acc, slide, w: rIn(0, 99) });
const euclid = (k, rot) => Array.from({ length: 16 }, (_, i) => ((i + rot) * k) % 16 < k);
const SEQ_ALGOS = [
  // 1 dice: each step on its own: mostly the root and the notes near it, now and then an octave up; about one step in
  // five rests, one in five accented and one in six sliding
  ['dice', (n) => {
    const near = [0, 0, 0, 1, 2, 2, 3, 4, 4, n - 1, n - 2].map((d) => (d + n) % n);
    return Array.from({ length: 16 }, (_, i) => {
      let d = pick(near);
      if (chance(0.18)) d += n;
      if (chance(0.06)) d += n;
      return st(d, i && chance(0.22) ? 0 : pick([2, 3, 4, 4, 5]), chance(0.2), chance(0.17));
    });
  }],
  // 2 acid: a 303 line: the root and its octave, now and then the fifth or the seventh, short notes, lots of slides
  // and accents, few rests
  ['acid', (n) => Array.from({ length: 16 }, (_, i) => {
    const d = pick([0, 0, 0, n, n, 4 % n, n - 1, n + 2]);
    return st(d, i && chance(0.15) ? 0 : pick([1, 2, 2, 3]), chance(0.35), chance(0.3));
  })],
  // 3 euclid: hits spread as evenly as they go (5 to 11 in 16, turned round), playing a three-note cell over them
  ['euclid', (n) => {
    const hits = euclid(rIn(5, 11), rIn(0, 15)), cell = [0, pick([2, 4, n - 1]), pick([1, 3, n])];
    let k = 0;
    return hits.map((h, i) => (h || i === 0 ? st(cell[k++ % 3], pick([2, 3, 4]), i % 4 === 0, false) : st(0, 0)));
  }],
  // 4 arp: the chord (root, third, fifth, octave) up, down or up and down, every step, the beat accented
  ['arp', (n) => {
    const tones = [0, 2, 4, n], order = pick(['up', 'down', 'updown']);
    const seqd = order === 'up' ? tones : order === 'down' ? tones.slice().reverse() : [...tones, tones[2], tones[1]];
    const oct = chance(0.4) ? n : 0;
    return Array.from({ length: 16 }, (_, i) => st(seqd[i % seqd.length] + (i >= 8 ? oct : 0), pick([2, 2, 3]), i % 4 === 0, false));
  }],
  // 5 walk: from the root, each note a step or two up or down the scale from the last; a step slides into its
  // neighbour now and then; a few rests
  ['walk', (n) => {
    let d = pick([0, n]);
    return Array.from({ length: 16 }, (_, i) => {
      if (i) d = Math.max(0, Math.min(2 * n, d + pick([-2, -1, -1, 1, 1, 2, 0])));
      return st(d, i && chance(0.15) ? 0 : pick([3, 4, 4]), chance(0.15), chance(0.2));
    });
  }],
  // 6 motif: a four-step idea, then it again, then moved up the scale, then a changed ending that comes home to
  // the root (A A A' B)
  ['motif', (n) => {
    const A = Array.from({ length: 4 }, (_, i) => st(i === 0 ? 0 : pick([0, 1, 2, 4, n - 1]), i && chance(0.25) ? 0 : pick([2, 3, 4]), i === 0, chance(0.15)));
    const up = pick([1, 2, 4]);
    const B = A.map((x, i) => (i < 2 ? { ...x } : st(i === 3 ? 0 : pick([1, 2, 4]), pick([3, 4, 5]), i === 3, false)));
    return [...A, ...A.map((x) => ({ ...x })), ...A.map((x) => ({ ...x, d: x.d + up })), ...B];
  }],
  // 7 groove: a bass groove: the root on a syncopated rhythm (3+3+2, or one like it), the octave or fifth on the
  // offbeats between, and quiet ghost notes
  ['groove', (n) => {
    const rhythm = pick([[0, 3, 6, 8, 11, 14], [0, 3, 6, 10, 12], [0, 2, 3, 6, 8, 10, 11, 14], [0, 4, 7, 10, 12, 14]]);
    return Array.from({ length: 16 }, (_, i) => {
      if (rhythm.includes(i)) return st(i % 8 === 0 ? 0 : pick([0, 0, n, 4 % n]), pick([2, 3]), i % 8 === 0 || chance(0.25), chance(0.1));
      return chance(0.25) ? st(pick([0, n, 4 % n]), 1, false, false) : st(0, 0);
    });
  }],
  // 8 phrase: a slow tune: longer notes that ring, mostly moving by step, a breath (rest) now and then, ending on
  // the root
  ['phrase', (n) => {
    const out = [];
    let d = pick([0, 2, 4]);
    while (out.length < 16) {
      const len = Math.min(16 - out.length, pick([2, 2, 3, 4]));
      if (out.length + len >= 16) d = pick([0, n]);
      out.push(st(d, 5, out.length % 8 === 0, chance(0.25)));
      for (let k = 1; k < len; k++) out.push(st(d, 0));
      if (chance(0.2) && out.length < 15) out.push(st(0, 0));
      d = Math.max(0, Math.min(2 * n, d + pick([-2, -1, -1, 1, 1, 2, 3])));
    }
    return out.slice(0, 16);
  }],
  // 9 pure: no shaping at all: each step on its own, any note of the two octaves, any gate (a rest as likely as any
  // other), an accent and a slide each one time in two
  ['pure', (n) => Array.from({ length: 16 }, () => st(rIn(0, 2 * n), rIn(0, 5), chance(0.5), chance(0.5)))],
  // 10 patternz: bits of a bank of acid patterns (below)
  ['patternz', (n) => patternzPage(n, patternzPool())]];
// patternz: a page cut up from a few of the bank's patterns: short bits taken at random, each looped, moved up or down the
// scale and sometimes turned backwards. The notes land on the nearest of the scale's, so it stays in the key
const patternzPool = () => Array.from({ length: rIn(2, 3) }, () => pick(PATTERNZ));
const patternzDeg = (semi, n) => {
  const s = SCALES[seq.scale][1], pc = ((semi % 12) + 12) % 12;
  let at = 0;
  s.forEach((x, i) => { if (Math.abs(x - pc) < Math.abs(s[at] - pc)) at = i; });
  let d = at + n * Math.floor(semi / 12);
  while (d < 0) d += n;
  while (d > degMax()) d -= n;
  return d;
};
function patternzBit(p) {
  const len = Math.min(p.length, pick([2, 3, 4, 4, 6, 8, 8, 12, 16]));
  let bit = [];
  for (let k = 0; k < 8 && !bit.some((v) => v & 1); k++) { const at = rIn(0, p.length - len); bit = p.slice(at, at + len); }
  return chance(0.2) ? bit.reverse() : bit;
}
function patternzPage(n, pool) {
  const out = [];
  while (out.length < 16) {
    const bit = patternzBit(pick(pool)), end = Math.min(16, out.length + pick([4, 8, 8, 16]));
    let move = pick([0, 0, 0, 2, 3, 4, n, -n]), k = 0;
    while (out.length < end) {
      if (k && k % bit.length === 0 && chance(0.3)) move = pick([0, 0, 1, 2, -1, n]);
      const v = bit[k++ % bit.length], slide = !!(v & 4);
      out.push(st(patternzDeg((v >> 3) - 24, n) + move, v & 1 ? (slide ? 4 : pick([1, 2, 2, 3])) : 0, !!(v & 2), slide));
    }
  }
  if (!out.some((x) => x.gate)) out[0].gate = 3;
  return out;
}
// the whole sequence: a page, the same with a few steps changed, the same moved up the scale, and a new page from the
// same patterns to end on
function patternzPages() {
  const n = SCALES[seq.scale][1].length, pool = patternzPool(), a = patternzPage(n, pool), up = pick([2, 3, 4]);
  a.forEach((x, i) => { seq.steps[i] = x; seq.steps[16 + i] = { ...x }; seq.steps[32 + i] = st(x.d + up, x.gate, x.acc, x.slide); });
  alterPage(1, rIn(2, 3));
  patternzPage(n, pool).forEach((x, i) => { seq.steps[48 + i] = x; });
}
function randomPage(pg) {
  const n = SCALES[seq.scale][1].length;
  const algo = SEQ_ALGOS[seq.algo] || SEQ_ALGOS[0];
  algo[1](n).forEach((x, i) => { seq.steps[pg * 16 + i] = x; });
}
// alter: k steps of a page changed a little: a note a step or two up or down the scale, a rest played or a note
// rested, an accent or a slide switched
function alterPage(pg, k = rIn(2, 4)) {
  for (let j = 0; j < k; j++) {
    const st = seq.steps[pg * 16 + rIn(0, 15)], what = rIn(0, 3);
    if (what === 0 || (what === 1 && !st.gate)) { st.d = Math.max(0, Math.min(degMax(), st.d + pick([-2, -1, 1, 2]))); if (!st.gate) st.gate = 4; }
    else if (what === 1) st.gate = chance(0.4) ? 0 : rIn(1, 5);
    else if (what === 2) st.acc = !st.acc;
    else st.slide = !st.slide;
  }
}
// copy: page 1 onto pages 2 to 4, each changed a little (two or three steps; the last page, the turnaround, a few more)
function copyVary() {
  for (let pg = 1; pg < PAGES; pg++) {
    for (let i = 0; i < 16; i++) seq.steps[pg * 16 + i] = { ...seq.steps[i] };
    alterPage(pg, pg === PAGES - 1 ? rIn(3, 5) : rIn(2, 3));
  }
}
// the whole sequence, for the perf page's randomisers: a new page 1 and its variations
function randomNotes() { if (SEQ_ALGOS[seq.algo][0] === 'patternz') patternzPages(); else { randomPage(0); copyVary(); } sendSeq(); }
// random: all 64 steps, each page a new line of its own (not a variation of page 1), whichever page is shown
for (const b of document.querySelectorAll('[data-nrand]')) b.addEventListener('click', (e) => mRandomise(e.currentTarget, () => { if (SEQ_ALGOS[seq.algo][0] === 'patternz') patternzPages(); else for (let pg = 0; pg < PAGES; pg++) randomPage(pg); sendSeq(); }));
for (const b of document.querySelectorAll('[data-nalter]')) b.addEventListener('click', (e) => mRandomise(e.currentTarget, () => { alterPage(nsPage); sendSeq(); }));
// copy to the next page: the page shown, exactly, onto the one after it, which is then shown (so pressing it again
// carries on to the next); off on page 4. Undo puts the page back as it was
$('m-ncopy').addEventListener('click', (e) => {
  if (nsPage >= PAGES - 1) return;
  const from = nsPage;
  mRandomise(e.currentTarget, () => { for (let i = 0; i < 16; i++) seq.steps[(from + 1) * 16 + i] = { ...seq.steps[from * 16 + i] }; sendSeq(); });
  nsShow(from + 1);
});
// the algorithm random uses: its number on the fader, its name on the random button
mFader($('m-seqf'), 'algo', { min: 0, max: SEQ_ALGOS.length - 1, get: () => seq.algo, set: (v) => { seq.algo = v; drawAll(); }, show: (v) => String(v + 1), dflt: SEQ0.algo });
// the main page has algo, density and length too, under the notes' randomisers (the same settings: a move of either
// fader redraws both)
mFader($('m-mlen'), 'algo', { min: 0, max: SEQ_ALGOS.length - 1, get: () => seq.algo, set: (v) => { seq.algo = v; drawAll(); }, show: (v) => SEQ_ALGOS[v][0], dflt: SEQ0.algo });
mFader($('m-mlen'), 'density', { get: () => seq.density, set: (v) => { seq.density = v; nsChanged(); drawAll(); }, dflt: SEQ0.density, min: 0, max: 100, step: 5, show: (v) => v + '%' });
mFader($('m-mlen'), 'length', { get: () => seq.len, set: nsLen, dflt: SEQ0.len, min: 1, max: NSTEPS, show: (v) => String(v), detents: [16, 32, 48], catch: 2.5 });
drawHooks.push(() => { document.querySelectorAll('[data-nalgo]').forEach((e) => { e.textContent = `${seq.algo + 1} ${SEQ_ALGOS[seq.algo][0]}`; }); });
