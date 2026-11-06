// Drives the built page in Chromium at three window sizes (the 1000 x 600 layout itself, a wide window and a small one, where
// it scales to fit): no errors, the screen keeps its 5:3 shape inside the window, no page scrolls but the presets list,
// swipes and the page buttons along the bottom turn the page, fader drags don't, holding a fader opens
// its sequencer, MIDI CC 1 turns the tempo dial, the reverb sends, the note grid edits steps on four pages and copies
// page 1 to the others, space plays and stops, play runs the steps, presets save and load, and record downloads a WAV; a phone held upright is asked to turn sideways.
//   node test/smoke.mjs [index.html]   (needs Playwright)
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = pathToFileURL(process.argv[2] || new URL('../index.html', import.meta.url).pathname).href;
let fails = 0;
const VP_FILTER = ['cutoff', 'reso', 'vcfMod', 'vcfSrc', 'vcfPol', 'drive']; // the Werkstatt's filter section
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
for (const [w, h] of [[1000, 600], [1600, 900], [700, 520]]) {
  console.log(`-- ${w} x ${h}`);
  const c = await b.newContext({ viewport: { width: w, height: h }, acceptDownloads: true });
  // a stand-in MIDI controller: one input, its handler kept where the test can call it
  await c.addInitScript(() => {
    const input = { onmidimessage: null };
    window.__midiIn = input;
    navigator.requestMIDIAccess = () => Promise.resolve({ inputs: new Map([['x', input]]), onstatechange: null });
  });
  const pg = await c.newPage(), errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(url); await pg.waitForTimeout(300);
  const page = () => pg.evaluate(() => document.querySelector('[data-m-tab][aria-selected="true"]').dataset.mTab);
  const box = async (sel) => pg.locator(sel).first().boundingBox();
  // drag with the mouse (pointer events), from one point to another
  const drag = async (x0, y0, x1, y1, steps = 12) => { await pg.mouse.move(x0, y0); await pg.mouse.down(); await pg.mouse.move(x1, y1, { steps }); await pg.mouse.up(); await pg.waitForTimeout(450); };
  // the screen: 5:3, as big as the window lets it be, inside it
  const sr = await box('#m');
  check(Math.abs(sr.width / sr.height - 5 / 3) < 0.01 && sr.x >= -0.5 && sr.y >= -0.5 && sr.x + sr.width <= w + 0.5 && sr.y + sr.height <= h + 0.5
    && (Math.abs(sr.width - w) < 1 || Math.abs(sr.height - h) < 1), `the screen is 5:3 and fits the window (${Math.round(sr.width)} x ${Math.round(sr.height)})`);
  // no perf dials: one slim top line (title, metronome, play, the tempo dial) over the pages; the sixteen note steps in one line
  check(await pg.evaluate(() => { const r = [...document.querySelectorAll('#m-perf .m-dial')].map((e) => e.getBoundingClientRect()), top = document.querySelector('.m-top').getBoundingClientRect();
    const pages = $('m-pages').getBoundingClientRect(), p = $('m-play').getBoundingClientRect();
    const s = [...document.querySelectorAll('#m-pb .m-step')].map((e) => e.getBoundingClientRect());
    return r.length === 1 && r[0].left >= p.right && r[0].bottom <= pages.top + 1 && top.height < $('m').getBoundingClientRect().height * 0.12 && s.length === 16 && s.every((b) => Math.abs(b.top - s[0].top) < 1); }), 'one tempo dial in the slim top line, and the steps are one line');
  // no randomise button or popup: the main page has the randomisers
  check(await pg.evaluate(() => !$('m-rnd') && !$('m-rnd-open')), 'no randomise popup');
  // the page buttons sit along the bottom, under the pages, and there's no x/y page
  check(await pg.evaluate(() => { const t = document.querySelector('.m > .m-tabs').getBoundingClientRect(), p = $('m-pages').getBoundingClientRect(), m = $('m').getBoundingClientRect();
    return t.top >= p.bottom - 1 && m.bottom - t.bottom < 20 * mK && document.querySelectorAll('[data-m-tab]').length === 6 && !document.querySelector('[data-m-tab="xy"], [data-m-panel="xy"]'); }), 'the page buttons are along the bottom; no x/y page');
  // no page scrolls; every panel fits
  for (const t of ['main', 'seq', 'voice', 'fx', 'comp', 'presets']) {
    await pg.click(`[data-m-tab="${t}"]`);
    const o = await pg.evaluate((t) => { const p = document.querySelector(`[data-m-panel="${t}"]`); return [p.scrollHeight - p.clientHeight, document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth]; }, t);
    check(o.every((v) => v <= 0), `${t}: fits the screen (${o})`);
  }
  // the main page: the first one, every page's randomisers and save, each button whole, all inside the page
  await pg.click('[data-m-tab="main"]');
  check(await pg.evaluate(() => { const p = document.querySelector('[data-m-panel="main"]').getBoundingClientRect(), bs = [...document.querySelectorAll('.m-main-card .m-btn, .m-main-card .m-chk, .m-main-card .m-toggle')];
    return PANELS[0].dataset.mPanel === 'main' && bs.length === 22 && bs.every((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.bottom <= p.bottom + 0.5 && e.scrollWidth <= e.clientWidth; }); }), 'main: every randomiser and save fit, each whole');
  const mainBefore = await pg.evaluate(() => JSON.stringify([ws.cutoff, ws.reso, ws.vcfMod, ws.drive]));
  await pg.click('.m-main-card [data-vrand="filter"]');
  check(await pg.evaluate((b) => JSON.stringify([ws.cutoff, ws.reso, ws.vcfMod, ws.drive]) !== b && !document.querySelector('.m-main-card [data-undo]').disabled && mCur === 0, mainBefore), 'main: a section randomiser works there and can be undone');
  await pg.click('.m-main-card [data-undo]');
  check(await pg.evaluate((b) => JSON.stringify([ws.cutoff, ws.reso, ws.vcfMod, ws.drive]) === b, mainBefore), 'main: undo puts it back');
  await pg.click('.m-main-card .m-nextbar');
  check(await pg.evaluate(() => $('m-nextbar').checked && localStorage.getItem('elixir-werkstatt-nextbar') === '1'), 'main: next bar is kept');
  await pg.click('.m-main-card .m-nextbar');
  // shift on the main page moves the pattern as the seq page's does
  const shBefore = await pg.evaluate(() => JSON.stringify(seq.steps.slice(0, seq.len)));
  await pg.click('.m-main-card [data-nshift="1"]');
  check(await pg.evaluate((b) => { const was = JSON.parse(b), n = seq.len; return JSON.stringify(seq.steps[1]) === JSON.stringify(was[0]) && JSON.stringify(seq.steps[0]) === JSON.stringify(was[n - 1]); }, shBefore), 'main: shift moves the pattern a step');
  await pg.click('.m-main-card [data-nshift="-1"]');
  // knob seqs: new sequencers on one to three faders (their faders marked), undo puts back none, off clears them
  await pg.click('#m-fsrand');
  check(await pg.evaluate(() => { const on = mFaders.filter((f) => f.seq && f.seq.on); return on.length >= 1 && on.length <= 3 && on.every((f) => f.el.classList.contains('seq') && f.seq.vals.slice(0, f.seq.len).some((v) => v)); }), 'main: knob seqs makes new fader sequencers');
  await pg.click('.m-main-card [data-undo]');
  check(await pg.evaluate(() => !mFaders.some((f) => f.seq && f.seq.on)), 'main: knob seqs can be undone');
  await pg.click('#m-fsrand'); await pg.click('#m-fsoff');
  check(await pg.evaluate(() => !mFaders.some((f) => f.seq) && !document.querySelector('.m-vf.seq')), 'main: knob seqs off clears them');
  // length on the main page is the seq page's length
  await pg.evaluate(() => { seq.len = 64; drawAll(); });
  { const r = await box('#m-mlen .m-vf:nth-child(3) .m-vtrack'); await drag(r.x + r.width / 2, r.y + 4, r.x + r.width / 2, r.y + 4 + r.height * (64 - 33) / 63, 6); }
  check(await pg.evaluate(() => seq.len === 32 && document.querySelector('#m-seqf .m-vf:nth-child(3) output').textContent === '32'), `main: the length fader sets the seq's length (${await pg.evaluate(() => seq.len)})`);
  await pg.evaluate(() => { seq.len = 64; sendSeq(); drawAll(); });
  // algo and density there are the seq page's too
  await pg.evaluate(() => { seq.algo = 0; seq.density = 100; drawAll(); });
  await pg.focus('#m-mlen .m-vf:nth-child(1) .m-vtrack'); await pg.keyboard.press('ArrowUp');
  await pg.focus('#m-mlen .m-vf:nth-child(2) .m-vtrack'); await pg.keyboard.press('ArrowDown');
  check(await pg.evaluate(() => seq.algo === 1 && seq.density === 95 && document.querySelector('#m-seqf .m-vf:nth-child(4) output').textContent === '95%'
    && document.querySelector('#m-mlen .m-vf:nth-child(1) output').textContent === SEQ_ALGOS[1][0]), 'main: algo and density faders set the seq\'s');
  await pg.evaluate(() => { seq.algo = 0; seq.density = 100; sendSeq(); drawAll(); });
  // the metronome: a toggle kept in this browser; the player clicks on each beat with it on, and is silent with it off
  await pg.click('#m-metro');
  check(await pg.evaluate(() => metroOn && $('m-metro').getAttribute('aria-pressed') === 'true' && localStorage.getItem('elixir-werkstatt-metro') === '1'), 'the metronome (beside the title) turns on and is kept');
  check(await pg.evaluate(() => { const m = $('m-metro').getBoundingClientRect(), t = $('m-title').getBoundingClientRect(); return m.left >= t.right && m.top < t.bottom && m.right <= $('m-play').getBoundingClientRect().left; }), 'the metronome sits beside the title');
  await pg.click('#m-metro');
  check(await pg.evaluate(() => {
    const peak = (metro) => { const p = new Player(48000), L = new Float32Array(48000), R = new Float32Array(48000);
      p.msg({ type: 'seq', playing: true, metro, len: 16, bpm: 120, vel: 100, glide: 0, accentDb: 0, steps: Array.from({ length: 16 }, () => ({ n: 0, gate: 0, acc: false, slide: false, m: 0 })) });
      p.process(L, R); let m = 0, last = -1e9, beats = 0; for (let i = 0; i < L.length; i++) { m = Math.max(m, Math.abs(L[i])); if (Math.abs(L[i]) > 0.05 && i - last > 4000) beats++; if (Math.abs(L[i]) > 0.05) last = i; } return [m, beats]; };
    const [on, n] = peak(true), [off] = peak(false); return !metroOn && on > 0.1 && off < 0.01 && n === 2; }), 'main: the metronome clicks on the beats (two a second at 120 bpm), silent when off');
  // the voice page, laid out like the DFAM: a panel tab and an xtra tab, each's sections side by side
  await pg.click('[data-m-tab="voice"]');
  check(await pg.evaluate(() => document.querySelectorAll('#m-vsec .m-btn').length === 2 && [...document.querySelectorAll('.m-vtab')].every((t) => {
    const [a, b] = [...t.querySelectorAll('.m-vpart')].map((e) => e.getBoundingClientRect()); return !b || (Math.abs(a.top - b.top) < 1 && a.right <= b.left + 1); })
    && [...document.querySelectorAll('.m-vset')].length === 11), 'voice: panel and xtra tabs, sections side by side');
  // the voice's randomisers, down the right of the voice page: a section's button changes only that section and shows its tab
  check(await pg.evaluate(() => { const v = document.querySelector('.m-voice-card .m-vbtns').getBoundingClientRect(), s = $('m-vsets').getBoundingClientRect(); return v.left >= s.right; }), 'voice: the randomisers sit on the right');
  {
    const snap = () => pg.evaluate(() => Object.fromEntries(DR1.map((n) => [n, ws[n]])));
    const was = await snap();
    await pg.click('.m-voice-card [data-vrand="filter"]');
    const now = await snap(), filt = VP_FILTER;
    check(Object.keys(now).every((n) => filt.includes(n) || now[n] === was[n]) && filt.some((n) => now[n] !== was[n])
      && await pg.evaluate(() => mVSec === 0 && !$('m-vsets').children[0].hidden), 'voice: random filter changes the filter section only, and shows it');
    await pg.click('.m-vbtns [data-undo]');
    check(JSON.stringify(await snap()) === JSON.stringify(was), 'voice: undo puts it back');
    await pg.click('#m-vsec .m-btn >> nth=0');
  }
  // the seq page's random, alter and undo: a column down the right, as on the voice and fx pages
  await pg.click('[data-m-tab="seq"]');
  check(await pg.evaluate(() => { const c = document.querySelector('.m-seqpage > .m-vbtns').getBoundingClientRect(); return ['.m-npages', '#m-pb', '.m-seqlow'].every((q) => document.querySelector(q).getBoundingClientRect().right <= c.left); }), 'seq: random, alter and undo sit on the right');
  // the fx page's randomisers, down its right: one effect's button changes only that effect; undo puts it back
  await pg.click('[data-m-tab="fx"]');
  {
    const snap = () => pg.evaluate(() => JSON.stringify([fx, delayPos, values[PAR.FX_P3], values[PAR.FX_P4], values[PAR.FX_DELAY_TYPE]]));
    const o = (j) => { const [f, ...r] = JSON.parse(j); return { ...f, rest: r }; };
    const was = o(await snap());
    check(await pg.evaluate(() => document.querySelector('.m-fx-card .m-vbtns').getBoundingClientRect().left >= document.querySelector('.m-fxsets').getBoundingClientRect().right), 'fx: the randomisers sit on the right');
    await pg.click('.m-fx-card [data-fxrand="reverb"]');
    const now = o(await snap()), V = ['verb', 'vPre', 'vDecay', 'vTone', 'vEarly'];
    check(Object.keys(now).every((k) => V.includes(k) || JSON.stringify(now[k]) === JSON.stringify(was[k])) && V.some((k) => now[k] !== was[k]), 'fx: random reverb changes the reverb only');
    await pg.click('.m-fx-card [data-undo]');
    check(JSON.stringify(o(await snap())) === JSON.stringify(was), 'fx: undo puts it back');
  }
  // targets: every button at least 36 px high in the 1000 x 600 layout
  const small = await pg.evaluate(() => [...document.querySelectorAll('.m button, .m .m-btn')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height / mK < 36; }).map((e) => e.textContent.trim()));
  check(!small.length, `buttons at least 36 px high ${small.length ? small.join(', ') : ''}`);
  // swipes, across the pages on the right
  await pg.click('[data-m-tab="seq"]');
  let r = await box('.m-npages');
  await drag(r.x + r.width - 20, r.y + 10, r.x + r.width - 20 - sr.width * 0.4, r.y + 14);
  check(await page() === 'voice', 'swipe left turns to voice');
  r = await box('.m-vsec');
  await drag(r.x + 20, r.y + 10, r.x + 20 + sr.width * 0.4, r.y + 10);
  check(await page() === 'seq', 'swipe right turns back to seq');
  // the tempo dial dragged sideways and up moves it, and doesn't turn the page
  r = await box('#m-perf .m-vtrack');
  const before = await pg.evaluate(() => tempo);
  await drag(r.x + r.width / 2, r.y + r.height / 2, r.x + r.width / 2 + sr.width * 0.3, r.y + r.height / 2 - sr.height * 0.3);
  check(await page() === 'seq' && await pg.evaluate(() => tempo) > before, 'a tempo dial drag moves the tempo, not the page');
  // MIDI: CC 1 sends the tempo to the top, on any channel; other CCs do nothing
  await pg.evaluate(() => { const v = fx.verb; window.__midiIn.onmidimessage({ data: [0xb3, 1, 127] }); window.__midiIn.onmidimessage({ data: [0xb0, 8, 64] }); window.__v0 = v; fx.verb = 50; sendMix(); drawAll(); });
  check(await pg.evaluate(() => tempo === 240 && document.querySelectorAll('#m-perf .m-dial').length === 1), 'MIDI CC 1 turns the tempo');
  await pg.evaluate(() => { tempo = 120; sendSeq(); drawAll(); });
  // the reverb: the FX page's reverb send is the same as the dial's
  await pg.click('[data-m-tab="fx"]');
  check(await pg.evaluate(() => document.querySelector('#m-verb .m-vtrack').getAttribute('aria-valuenow') === '50'), 'the fx page shows the reverb send');
  await pg.evaluate(() => window.__midiIn.onmidimessage({ data: [0xb0, 10, 0] }));
  // holding a fader opens its step sequencer
  await pg.click('[data-m-tab="voice"]');
  r = await box('#m-voice-tone .m-vtrack');
  await pg.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await pg.mouse.down(); await pg.waitForTimeout(650); await pg.mouse.up();
  check(await pg.isVisible('#m-fs') && await pg.textContent('#m-fs-name') === 'freq', 'holding a fader opens its sequencer');
  r = await box('#m-fs-rand'); await pg.click('#m-fs-rand');
  // slide: with the slide button on, a drag along the first three steps slides them; a slide step glides to the next
  // step's offset over the whole step
  await pg.click('#m-fs-slide');
  {
    const c0 = await box('#m-fs-steps i:nth-child(1)'), c2 = await box('#m-fs-steps i:nth-child(3)');
    await pg.mouse.move(c0.x + c0.width / 2, c0.y + c0.height / 2); await pg.mouse.down();
    await pg.mouse.move(c2.x + c2.width / 2, c2.y + c2.height / 2, { steps: 6 }); await pg.mouse.up();
  }
  check(await pg.evaluate(() => { const q = fsF.seq; return q.slides.slice(0, 4).join() === 'true,true,true,false' && document.querySelector('#m-fs-steps i.slide b').offsetWidth > 0; }), 'a drag with slide on slides the steps');
  check(await pg.evaluate(() => { const f = fsF, q = f.seq; fsStep(f, 1, 125); const g = f.glide, ok = g && g.from === q.vals[1] && g.to === q.vals[2] && g.ms === 125; fsRelease(f); return ok; }), 'a slide step glides to the next step over the whole step');
  await pg.click('#m-fs-slide');
  await pg.click('#m-fs-close');
  check(await pg.evaluate(() => mFaders.find((f) => f.key === 'm-voice-tone:freq').seq.vals.some((v) => v)), 'randomise fills its steps');
  // the lanes: the bottom of a gate step rests it, the top holds it; a tap high on a pitch step sets a high note
  await pg.click('[data-m-tab="seq"]');
  check(await pg.evaluate(() => ['m-ga', 'm-gb', 'm-pa', 'm-pb'].every((id) => $(id).children.length === 16) && [...document.querySelectorAll('.m-lane > b')].slice(0, 4).map((e) => e.textContent).join() === 'gate a,gate b,pitch a,pitch b'), 'seq: four lanes, gate a, gate b, pitch a, pitch b');
  r = await box('#m-ga .m-gstep >> nth=1');
  await pg.mouse.click(r.x + r.width / 2, r.y + r.height - 3);
  check(await pg.evaluate(() => seq.steps[1].ga === 0), 'a gate a step rested');
  r = await box('#m-gb .m-gstep >> nth=3');
  await pg.mouse.click(r.x + r.width / 2, r.y + 3);
  check(await pg.evaluate(() => seq.steps[3].gb === 5 && $('m-gb').children[3].textContent === 'hold'), 'the top of a gate b step holds');
  r = await box('#m-pa .m-sbar >> nth=2');
  await pg.mouse.click(r.x + r.width / 2, r.y + 2);
  check(await pg.evaluate(() => seq.steps[2].pa === degMax()), 'the top of a pitch a step is two octaves up');
  // a drag along pitch b sets each step it crosses
  const pb4 = await box('#m-pb .m-sbar >> nth=4'), pb8 = await box('#m-pb .m-sbar >> nth=8');
  await pg.mouse.move(pb4.x + pb4.width / 2, pb4.y + pb4.height - 2); await pg.mouse.down();
  await pg.mouse.move(pb8.x + pb8.width / 2, pb8.y + pb8.height - 2, { steps: 8 }); await pg.mouse.up();
  check(await pg.evaluate(() => [4, 5, 6, 7, 8].every((i) => seq.steps[i].pb === 0)), 'a drag along pitch b sets the steps');
  // pages: page 2's steps are steps 17 to 32; copy makes pages 2 to 4 page 1 with a few steps changed
  await pg.click('#m-npages [data-page="1"]');
  r = await box('#m-ga .m-gstep >> nth=5');
  await pg.mouse.click(r.x + r.width / 2, r.y + r.height - 3);
  check(await pg.evaluate(() => seq.steps.length === 64 && seq.steps[21].ga === 0), 'page 2 edits its own steps');
  // shift: right moves every step one later (the last wraps to the first), left puts it back
  const sh0 = await pg.evaluate(() => JSON.stringify(seq.steps.slice(0, seq.len)));
  await pg.click('#m-nshift-r');
  check(await pg.evaluate((sh0) => { const a = JSON.parse(sh0), n = seq.len; return JSON.stringify(seq.steps[1]) === JSON.stringify(a[0]) && JSON.stringify(seq.steps[0]) === JSON.stringify(a[n - 1]); }, sh0), 'shift right moves the pattern a step later, wrapping at the length');
  await pg.click('#m-nshift-l');
  check(await pg.evaluate((sh0) => JSON.stringify(seq.steps.slice(0, seq.len)) === sh0, sh0), 'shift left puts it back');
  // octave buttons: the whole sequence moves an octave, held to -2 .. +2; the top of a step is two octaves up
  const n0 = await pg.evaluate(() => degSemis(seq.steps[0].pb));
  await pg.click('#m-noct-up');
  check(await pg.evaluate((n0) => seq.oct === 1 && degSemis(seq.steps[0].pb) === n0 + 12 && $('m-noct-out').textContent === '+1', n0), 'oct + moves the sequence up an octave');
  for (let k = 0; k < 4; k++) await pg.click('#m-noct-dn', { force: true });
  check(await pg.evaluate(() => seq.oct === -2 && $('m-noct-dn').disabled), 'oct - stops at two down');
  await pg.evaluate(() => { seq.oct = 0; sendSeq(); nsDraw(); });
  check(await pg.evaluate(() => degSemis(degMax()) - degSemis(0) === 24), 'a step covers two octaves');
  // density: each step's weight (0-99) against it: at 50 the steps weighted under 50 drop out, at 0 every one, at 100 none
  check(await pg.evaluate(() => { const was = seq.density, ws = seq.steps.map((x, s) => stepWeight(x, s)), on = (s) => s < seq.len && (seq.steps[s].ga || seq.steps[s].gb);
    const at = (d) => { seq.density = d; return thinned(); };
    const half = at(50).every((t, s) => t === !!(on(s) && ws[s] < 50)), none = at(0).every((t, s) => t === !!on(s)), all = !at(100).some(Boolean);
    seq.density = was; return half && none && all; }), 'density drops the steps weighted under 100 - density');
  check(await pg.evaluate(() => { randomPage(1); return seq.steps.slice(16, 32).every((x) => Number.isInteger(x.w) && x.w >= 0 && x.w <= 99); }), 'random gives every step a weight 0 to 99');
  // morph: the morph button shows the morph lane under the others; the top of a step there sets 100, and the morph
  // fader (off by default) names the parameter it moves
  await pg.click('#m-nlane');
  check(await pg.evaluate(() => !$('m-mlane').hidden && $('m-nlane').getAttribute('aria-pressed') === 'true'), 'the morph button shows the morph lane');
  {
    const b = await pg.locator('#m-morphs .m-step').nth(5).boundingBox();
    await pg.mouse.click(b.x + b.width / 2, b.y + 2);
  }
  check(await pg.evaluate(() => seq.steps[16 + 5].m === 100 && seq.morph === 0), 'the top of a morph step sets 100, the morph still off');
  await pg.click('#m-nlane');
  check(await pg.evaluate(() => $('m-mlane').hidden), 'and hides it again');
  // copy, on page 2: 'copy to 3' puts page 2 onto page 3 exactly and shows page 3; on page 4 it's off
  check(await pg.textContent('#m-ncopy') === 'copy to 3', 'on page 2 the copy button says copy to 3');
  await pg.click('#m-ncopy');
  check(await pg.evaluate(() => nsPage === 2 && JSON.stringify(seq.steps.slice(32, 48)) === JSON.stringify(seq.steps.slice(16, 32))), 'copy puts the page onto the next and shows it');
  const p4 = await pg.evaluate(() => JSON.stringify(seq.steps.slice(48, 64)));
  await pg.click('#m-ncopy');
  check(await pg.evaluate(() => nsPage === 3 && $('m-ncopy').disabled && $('m-ncopy').textContent === 'copy to 4'), 'on page 4 copy is off');
  await pg.click('.m-seqpage [data-undo]');
  check(await pg.evaluate((p4) => JSON.stringify(seq.steps.slice(48, 64)) === p4, p4), 'copy can be undone');
  // every algorithm makes a valid page
  check(await pg.evaluate(() => SEQ_ALGOS.every((_, a) => { seq.algo = a; for (let k = 0; k < 100; k++) { randomPage(1); const p = seq.steps.slice(16, 32);
    if (p.some((x) => ![x.pa, x.pb].every((d) => d >= 0 && d <= degMax()) || ![x.ga, x.gb].every((g) => g >= 0 && g <= 5)) || !p.some((x) => x.ga) || !p.some((x) => x.gb)) return false; } return true; })), 'all ten algorithms make valid pages');
  check(await pg.evaluate(() => { seq.algo = SEQ_ALGOS.findIndex((a) => a[0] === 'patternz'); const seen = new Set(); for (let k = 0; k < 50; k++) { randomNotes(); if (seq.steps.some((x) => !(x.pb >= 0 && x.pb <= degMax() && x.pa >= 0 && x.pa <= degMax() && Number.isInteger(x.w)))) return false; seen.add(JSON.stringify(seq.steps)); } return PATTERNZ.length > 100 && seen.size === 50; }), 'patternz fills all four pages with fresh cut-ups');
  await pg.evaluate(() => { seq.algo = 0; });
  await pg.click('#m-npages [data-page="0"]');
  // the space bar starts and stops
  await pg.keyboard.press('Space'); await pg.waitForTimeout(300);
  const on = await pg.evaluate(() => playing);
  await pg.keyboard.press('Space'); await pg.waitForTimeout(200);
  check(on && !(await pg.evaluate(() => playing)), 'space starts and stops');
  const seqBefore = await pg.evaluate(() => JSON.stringify(seq.steps));
  await pg.click('#m-nrand');
  check(await pg.isEnabled('#m-nalter ~ [data-undo]'), 'random notes can be undone');
  check(await pg.evaluate((b) => { const was = JSON.parse(b); return [0, 1, 2, 3].every((pg) => JSON.stringify(seq.steps.slice(pg * 16, pg * 16 + 16)) !== JSON.stringify(was.slice(pg * 16, pg * 16 + 16))); }, seqBefore), 'random renews every page');
  check(await pg.evaluate(() => { const p = (k) => JSON.stringify(seq.steps.slice(k * 16, k * 16 + 16).map((x) => [x.pb, x.ga])); return new Set([0, 1, 2, 3].map(p)).size === 4; }), 'each page gets its own pattern');
  // play runs the steps
  await pg.keyboard.press('Space'); await pg.waitForTimeout(1200);
  check(await pg.evaluate(() => document.querySelectorAll('#m-pb .m-step.now').length === 1 && document.querySelectorAll('#m-ga .m-step.now').length === 1), 'playing lights the step');
  // length: a drag on its fader catches at 32; at 20 steps the playing stays on pages 1 and 2, and steps past it fade
  r = await box('#m-seqf .m-vtrack >> nth=2');
  await pg.evaluate(() => { seq.len = 64; drawAll(); });
  const dy = r.height * (64 - 33) / 63;
  await drag(r.x + r.width / 2, r.y + 4, r.x + r.width / 2, r.y + 4 + dy, 6);
  check(await pg.evaluate(() => seq.len === 32), `a length drag catches at 32 (${await pg.evaluate(() => seq.len)})`);
  await pg.evaluate(() => { seq.len = 20; sendSeq(); drawAll(); window.__pages = new Set(); window.__maxpos = 0;
    eventHandlers.push((ev) => { if (ev.type === 'step') { __pages.add(ev.page); __maxpos = Math.max(__maxpos, ev.page * 16 + ev.step); } }); });
  await pg.waitForTimeout(3500);
  check(await pg.evaluate(() => __maxpos === 19 && __pages.size === 2), 'at length 20 the sequence loops after step 20');
  await pg.click('#m-npages [data-page="1"]');
  check(await pg.evaluate(() => $('m-pb').children[4].classList.contains('out') && !$('m-pb').children[3].classList.contains('out') && document.querySelector('#m-npages [data-page="2"]').classList.contains('out')), 'steps and pages past the length fade');
  await pg.click('#m-npages [data-page="0"]');
  await pg.evaluate(() => { seq.len = 64; sendSeq(); drawAll(); });
  // presets: load a built-in one, save a new one
  await pg.click('[data-m-tab="presets"]');
  await pg.click('.m-pload >> text=Acid Line');
  await pg.waitForTimeout(1500);
  // the screen's colours: five LCD looks on the presets page; amber turns the screen amber and is kept
  await pg.click('[data-m-tab="presets"]');
  // the title opens the prefs (the screen colours live there); done closes them
  await pg.click('#m-title');
  check(await pg.evaluate(() => !$('m-prefs').hidden), 'a tap on the title opens the prefs');
  await pg.click('#m-lcd [data-lcd="2"]');
  check(await pg.evaluate(() => document.querySelectorAll('#m-lcd [data-lcd]').length === 5 && getComputedStyle($('m')).backgroundColor === 'rgb(42, 19, 0)'
    && localStorage.getItem('elixir-werkstatt-lcd') === 'amber'), 'an LCD look changes the screen colours and is kept');
  await pg.click('#m-lcd [data-lcd="0"]');
  await pg.click('#m-prefs-close');
  check(await pg.evaluate(() => $('m-prefs').hidden), 'done closes the prefs');
  check(await pg.evaluate(() => tempo === 128 && seq.root === 9), 'a built-in preset loads (at the next bar)');
  await pg.click('#m-psave');
  check(await pg.evaluate(() => JSON.parse(localStorage.getItem('elixir-werkstatt-presets')).length === 1), 'save new keeps a preset in its own storage');
  await pg.click('[data-m-tab="main"]');
  await pg.click('#m-msave');
  check(await pg.evaluate(() => JSON.parse(localStorage.getItem('elixir-werkstatt-presets')).length === 2 && $('m-mcur').textContent === pCur.name && /^Saved as/.test($('m-mnote').textContent) && !$('m-mover').disabled), 'main: save new saves a preset and names it');
  // record: a take downloads as a WAV
  await pg.keyboard.press('r'); await pg.waitForTimeout(1000);
  check(await pg.evaluate(() => !$('m-rec-t').hidden && /rec \d:\d\d/i.test($('m-rec-t').textContent)), 'R records, and the title corner shows it');
  const dl = pg.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await pg.keyboard.press('r');
  const d = await dl;
  check(!!d && /\.wav$/.test(d.suggestedFilename()), `record downloads ${d ? d.suggestedFilename() : 'nothing'}`);
  check(!errs.length, `no page errors ${errs.join('; ')}`);
  await c.close();
}
// a phone held upright gets the turn-your-phone prompt over the screen; held sideways, the screen itself
for (const [w, h, up] of [[390, 844, true], [844, 390, false]]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  const pg = await c.newPage(); await pg.goto(url); await pg.waitForTimeout(300);
  const [turn, seen] = await pg.evaluate(() => [getComputedStyle($('m-turn')).display !== 'none', getComputedStyle($('m')).visibility === 'visible']);
  check(turn === up && seen === !up, `phone ${up ? 'upright shows the turn prompt' : 'sideways shows the screen'}`);
  await c.close();
}
await b.close();
process.exit(fails ? 1 : 0);
