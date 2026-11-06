// ---- the screen's colours: five LCD looks, picked on the presets page and kept on this device. Each sets the
// colour variables on the screen (style.css), so the whole screen changes at once. glow is how much the lit pixels
// bloom: full on the backlit (negative) looks, little on the ones with dark pixels on a light panel ----
const LCD_LOOKS = [
  ['blue', { panel: '#2238e6', ink: '#eef3ff', 'panel-rgb': '34 56 230', 'ink-rgb': '225 235 255', 'light-rgb': '185 215 255', 'shade-rgb': '6 12 90', glow: 1 }],
  ['green', { panel: '#9fbf3b', ink: '#1d2b0c', 'panel-rgb': '159 191 59', 'ink-rgb': '29 43 12', 'light-rgb': '214 236 140', 'shade-rgb': '40 60 10', glow: 0.3 }],
  ['amber', { panel: '#2a1300', ink: '#ffb43a', 'panel-rgb': '42 19 0', 'ink-rgb': '255 180 58', 'light-rgb': '140 70 0', 'shade-rgb': '0 0 0', glow: 1 }],
  ['grey', { panel: '#c9cdc2', ink: '#20242a', 'panel-rgb': '201 205 194', 'ink-rgb': '32 36 42', 'light-rgb': '240 244 236', 'shade-rgb': '70 75 70', glow: 0.3 }],
  ['red', { panel: '#1e0306', ink: '#ff4a3d', 'panel-rgb': '30 3 6', 'ink-rgb': '255 74 61', 'light-rgb': '130 20 20', 'shade-rgb': '0 0 0', glow: 1 }],
];
const LCD_KEY = 'elixir-werkstatt-lcd';
let lcdLook = 0;
function setLcd(i) {
  lcdLook = LCD_LOOKS[i] ? i : 0;
  for (const m of document.querySelectorAll('.m, .m-turn'))
    for (const [k, v] of Object.entries(LCD_LOOKS[lcdLook][1])) m.style.setProperty('--' + k, String(v));
  document.querySelectorAll('#m-lcd [data-lcd]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.lcd === lcdLook));
  store.set(LCD_KEY, LCD_LOOKS[lcdLook][0]);
}
LCD_LOOKS.forEach(([name], i) => {
  const b = document.createElement('button'); b.className = 'm-btn'; b.type = 'button'; b.dataset.lcd = i; b.textContent = name;
  b.addEventListener('click', () => setLcd(i)); $('m-lcd').append(b);
});
setLcd(LCD_LOOKS.findIndex(([n]) => n === store.get(LCD_KEY)));
