// ---- the seq page: a gate and pitch sequencer. Four pages of sixteen steps; length says how many of them play (1 to
// 64, through the pages in turn). Along the top: the page tabs (the one playing underlined, those past the length
// faded), copy (the page shown onto the next), morph (shows the morph lane), shift and oct - / oct + (both pitch lanes
// an octave). Then the lanes, each sixteen steps: gate a and gate b (each step's gate time: bottom rests, then a
// quarter to all of the step, top holds on to the next; the envelopes choose which gate fires them), pitch a and
// pitch b (vco a's and vco b's pitch on each step, two octaves of the scale, set on every step as a sequencer's pitch
// CVs are), and the morph values. Under them the faders (root, scale, length, density, morph, algo) and random,
// alter, undo ----
let nsPage = 0;
const nsAbs = (i) => nsPage * 16 + i;
const nsStep = (i) => seq.steps[nsAbs(i)];
// a change to the sequence: to the player, and onto the page
const nsChanged = () => { sendSeq(); nsDraw(); };
const nsRow = (id, cls, html) => Array.from({ length: 16 }, (_, i) => {
  const c = document.createElement('div'); c.className = cls; c.dataset.i = i; c.setAttribute('role', 'gridcell');
  c.innerHTML = html; $(id).append(c); return c;
});
const CELL = '<i class="m-sbar"></i><span class="m-sn"></span>';
// the lanes: [box id, the step's key, its cells]
const NS_LANES = [['m-ga', 'ga'], ['m-gb', 'gb'], ['m-pa', 'pa'], ['m-pb', 'pb'], ['m-morphs', 'm']].map(([id, k]) => [id, k, nsRow(id, 'm-step m-gstep', CELL)]);
const nsCellsOf = (k) => NS_LANES.find((l) => l[1] === k)[2];
const GATE_NAMES = ['rest', '¼', '½', '¾', 'full', 'hold'];
// the morph lane: shown or not
let nsLaneMorph = false;
$('m-nlane').addEventListener('click', () => { nsLaneMorph = !nsLaneMorph; nsDraw(); });
function nsDraw() {
  const thin = thinned(), top = degMax();
  for (const [, k, cells] of NS_LANES) cells.forEach((c, i) => {
    const st = nsStep(i), s = nsAbs(i), any = st.ga > 0 || st.gb > 0;
    c.classList.toggle('thin', thin[s]); c.classList.toggle('out', s >= seq.len);
    let f, txt, label;
    if (k === 'ga' || k === 'gb') { f = st[k] / 5; txt = GATE_NAMES[st[k]]; label = `step ${i + 1} gate ${k[1]}: ${txt}`; c.classList.toggle('rest', !st[k]); }
    else if (k === 'm') { const mv = st.m || 0; f = mv / 100; txt = String(mv); label = `step ${i + 1} morph: ${mv}`; c.classList.toggle('rest', !any); }
    else { f = (Math.min(st[k], top) + 1) / (top + 1); txt = noteName(k === 'pa' ? stepNoteA(st) : stepNoteB(st)); label = `step ${i + 1} pitch ${k[1]}: ${txt}`; c.classList.toggle('rest', !any); }
    c.style.setProperty('--f', f); c.querySelector('.m-sn').textContent = txt; c.setAttribute('aria-label', label);
  });
  $('m-mlane').hidden = !nsLaneMorph; document.querySelector('.m-seqpage').classList.toggle('morph', nsLaneMorph);
  $('m-nlane').setAttribute('aria-pressed', nsLaneMorph);
  $('m-morphs').classList.toggle('off', !seq.morph);
  document.querySelectorAll('#m-npages [data-page]').forEach((b) => { b.setAttribute('aria-selected', +b.dataset.page === nsPage); b.classList.toggle('out', +b.dataset.page * 16 >= seq.len); });
  $('m-ncopy').textContent = `copy to ${Math.min(nsPage + 2, PAGES)}`; $('m-ncopy').disabled = nsPage >= PAGES - 1;
  $('m-noct-out').textContent = seq.oct > 0 ? `+${seq.oct}` : String(seq.oct);
  $('m-noct-dn').disabled = seq.oct <= OCT_MIN; $('m-noct-up').disabled = seq.oct >= OCT_MAX;
}
drawHooks.push(nsDraw);
const nsShow = (pg) => { nsPage = pg; nsDraw(); nsNow(); };
$('m-npages').addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) nsShow(+b.dataset.page); });
// octave down and up: both pitch lanes, every page
const nsOct = (k) => { seq.oct = Math.max(OCT_MIN, Math.min(OCT_MAX, seq.oct + k)); nsChanged(); };
// shift: the whole sequence (the steps within its length, every lane) a step left or right, wrapping round at the length
function nsShift(k) {
  const n = seq.len, was = seq.steps.slice(0, n);
  for (let s = 0; s < n; s++) seq.steps[s] = was[(s - k + n) % n];
  nsChanged();
}
for (const b of document.querySelectorAll('[data-nshift]')) b.addEventListener('click', () => nsShift(+b.dataset.nshift));
$('m-noct-dn').addEventListener('click', () => nsOct(-1));
$('m-noct-up').addEventListener('click', () => nsOct(1));
// hear a step as it's set, while stopped: its pitches on its own gates (a pitch set on a resting step: both gates)
function nsHear(st) {
  if (playing) return;
  const any = st.ga > 0 || st.gb > 0;
  startAudio(); send({ type: 'note', na: degSemis(st.pa), nb: degSemis(st.pb), ga: any ? st.ga : 4, gb: any ? st.gb : 4, m: (st.m || 0) / 100 });
}
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
// each lane: the value where the touch is on the step's bar (gates 0..5, pitches a degree of the two octaves, morph 0..100 in fives)
for (const [id, k, cells] of NS_LANES) {
  const steps = k === 'ga' || k === 'gb' ? 6 : k === 'm' ? 21 : degMax() + 1;
  nsLane($(id), (i, e, first) => {
    const st = nsStep(i), n = k === 'pa' || k === 'pb' ? degMax() + 1 : steps;
    let v = Math.floor(nsY(cells[i].querySelector('.m-sbar') || cells[i], e) * n);
    if (k === 'm') v *= 5;
    if (v !== (st[k] || 0)) { st[k] = v; return k !== 'm'; }
    return first ? false : null;
  });
}
// the step playing (if its page is shown) and its page, marked as they're heard
let nsAt = null;
function nsNow() {
  for (const [, , cells] of NS_LANES) cells.forEach((c, i) => c.classList.toggle('now', !!nsAt && nsAt.page === nsPage && i === nsAt.step));
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
// length: a drag catches at 16, 32 and 48 (a page, two, three)
// (the main page has the same fader: a move of either redraws both)
const nsLen = (v) => { seq.len = v; nsChanged(); drawAll(); };
nsFader('length', 'len', { set: nsLen, min: 1, max: NSTEPS, show: (v) => String(v), detents: [16, 32, 48], catch: 2.5 });
nsFader('density', 'density', { set: (v) => { seq.density = v; nsChanged(); drawAll(); }, min: 0, max: 100, step: 5, show: (v) => v + '%' });
// morph: off, or the voice parameter the morph lane moves
nsFader('morph', 'morph', { min: 0, max: MORPH_DESTS.length, show: (v) => (v ? MORPH_DESTS[v - 1][0] : 'off') });

// random: a new line for a page, made by the algorithm picked on the algo fader (kept in the preset). Each makes 16
// steps of { d: degree of the scale, gate, acc, slide }, so whatever it makes stays in the key; twoLanes then makes the
// sequencer's two gates and two pitches of it: the line is gate a and pitch b, and gate b and pitch a come from it in
// one of a few ways, picked per randomise (partners)
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
  const n = SCALES[seq.scale][1].length, pool = patternzPool(), a = patternzPage(n, pool), up = pick([2, 3, 4]), P = partners();
  const a2 = twoLanes(a, P), a3 = twoLanes(a.map((x) => st(x.d + up, x.gate, x.acc, x.slide)), P);
  a2.forEach((x, i) => { seq.steps[i] = x; seq.steps[16 + i] = { ...x }; seq.steps[32 + i] = a3[i]; });
  alterPage(1, rIn(2, 3));
  twoLanes(patternzPage(n, pool), P).forEach((x, i) => { seq.steps[48 + i] = x; });
}
// gate b, from the line: its accents (the hits that stand out), the rests between its notes (the two interlock), the
// same gates, or an even pattern of its own
const GATE_B = {
  accents: (L) => L.map((x) => (x.gate && x.acc ? pick([1, 2, 3]) : 0)),
  between: (L) => L.map((x) => (x.gate ? 0 : chance(0.7) ? pick([1, 2]) : 0)),
  same: (L) => L.map((x) => x.gate),
  euclid: () => { const h = euclid(rIn(3, 7), rIn(0, 15)), g = pick([1, 2, 3]); return h.map((on) => (on ? g : 0)); },
};
// pitch a, from the line: a drone on the root, the same notes, the same a fixed step up the scale, or a slow line of its own (a note a beat)
const PITCH_A = {
  drone: (L) => L.map(() => 0),
  same: (L) => L.map((x) => x.d),
  interval: (L, n) => { const up = pick([2, 4, n]); return L.map((x) => Math.min(degMax(), x.d + up)); },
  slow: (L, n) => { let d = 0; return L.map((x, i) => { if (i % 4 === 0) d = pick([0, 0, 2, 4, n - 1, n]); return Math.min(degMax(), d); }); },
};
const partners = () => ({ gb: pick(Object.keys(GATE_B)), pa: pick(Object.keys(PITCH_A)) });
function twoLanes(L, P = partners()) {
  const n = SCALES[seq.scale][1].length, pa = PITCH_A[P.pa](L, n);
  let gb = GATE_B[P.gb](L);
  if (!gb.some(Boolean)) gb = GATE_B.euclid();
  return L.map((x, i) => ({ ga: x.gate, gb: gb[i], pa: pa[i], pb: x.d, w: x.w, m: 0 }));
}
function randomPage(pg, P = partners()) {
  const n = SCALES[seq.scale][1].length;
  const algo = SEQ_ALGOS[seq.algo] || SEQ_ALGOS[0];
  twoLanes(algo[1](n), P).forEach((x, i) => { seq.steps[pg * 16 + i] = x; });
}
// alter: k steps of a page changed a little: a pitch a step or two up or down the scale, a gate played or rested
function alterPage(pg, k = rIn(2, 4)) {
  for (let j = 0; j < k; j++) {
    const st = seq.steps[pg * 16 + rIn(0, 15)], what = rIn(0, 3);
    if (what < 2) { const p = what ? 'pa' : 'pb'; st[p] = Math.max(0, Math.min(degMax(), st[p] + pick([-2, -1, 1, 2]))); }
    else { const g = what === 2 ? 'ga' : 'gb'; st[g] = st[g] && chance(0.5) ? 0 : rIn(1, 5); }
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
for (const b of document.querySelectorAll('[data-nrand]')) b.addEventListener('click', (e) => mRandomise(e.currentTarget, () => { if (SEQ_ALGOS[seq.algo][0] === 'patternz') patternzPages(); else { const P = partners(); for (let pg = 0; pg < PAGES; pg++) randomPage(pg, P); } sendSeq(); }));
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
