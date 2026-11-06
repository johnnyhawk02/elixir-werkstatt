// Builds index.html (the self-contained page) from index.src.html, the page's code in app/ and the engine modules.
//   node build.mjs [--out file]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const here = new URL('.', import.meta.url);
const read = (f) => readFileSync(new URL(f, here), 'utf8');

// strip ES module syntax so the engine's files run as one classic script (page and AudioWorklet)
const strip = (src) => src
  .replace(/^import[\s\S]*?from\s+'[^']+';\n/gm, '')
  .replace(/^export \{[^}]*\};\n/gm, '')
  .replace(/^export (const|function|class) /gm, '$1 ');
const engine = [read('lxr-tables.js'), read('lxr-ui-data.js'), read('lxr-clicks.js'), read('lxr.js')].map(strip).join('\n');
const names = ['LxrEngine', 'PAR', 'CC', 'CC2', 'BLOCK', 'REAL_FS', 'PARAM_DTYPES', 'MOD_TARGETS', 'MOD_TARGET_VOICE_RANGES', 'VOICE_PAGES',
  'INIT_KIT', 'OSC_WAVE_NAMES', 'FILTER_TYPE_NAMES', 'LFO_WAVE_NAMES', 'LFO_SYNC_NAMES', 'MIXER_ROUTING_FX_BUS', 'FX_DELAY', 'FX_DISTORTION',
  'FX_RING', 'FX_REVERB', 'FxBus', 'Rng', 'DIST_NAMES', 'DELAY_NAMES', 'EXTRA_CLICK_NAMES'];
// the Werkstatt-01 voice (werkstatt.js), in its own scope, its names added to LXR's
const wsNames = ['Werkstatt', 'WerkstattPair', 'WS_PARAMS', 'WS_DEFAULTS', 'FM_PARAMS', 'FM_DEFAULTS', 'WS_CIRCUIT', 'cutoffHz', 'lfoHz'];
const werk = `const WS = (() => {\n${strip(read('werkstatt.js'))}\nreturn { ${wsNames.join(', ')} };\n})();\n`;
const bundle = `const LXR = (() => {\n${engine}\n${werk}\nreturn { ${names.join(', ')}, ...WS };\n})();\n`;
const outArg = process.argv.indexOf('--out');
const outFile = outArg > 0 ? process.argv[outArg + 1] : null;

// built-in presets: presets/*.json, each { elixirSynth: 1, presets: [...] } as the presets page exports them
const PRESET_V = Number(/const PRESET_V = (\d+);/.exec(read('app/core.js'))[1]);
const presetDir = new URL('presets/', here);
const presets = existsSync(presetDir) ? readdirSync(presetDir).filter((f) => /\.json$/i.test(f)).sort()
  .flatMap((f) => JSON.parse(readFileSync(new URL(f, presetDir), 'utf8')).presets || []) : [];
for (const p of presets) if (p.v !== PRESET_V) throw new Error(`presets/: ${p.name} is format v${p.v}, the page reads v${PRESET_V}`);

// the seq page's patternz random: patterns/patternz.json, made by tools/import-patternz.mjs
const patternz = JSON.parse(read('patterns/patternz.json')).patterns;

// the page's own code, run in this order as one classic script (each file sees the ones before it)
const APP = ['core', 'ui', 'perf', 'voice', 'fx', 'noteseq', 'fseq', 'random', 'presets', 'record', 'lcd', 'pwa'];
const app = APP.map((f) => read(`app/${f}.js`)).join('\n');
const esc = (t) => t.replace(/<\/script/gi, '<\\/script');
const page = read('index.src.html')
  .replace('/*@CSS@*/\n', () => read('app/style.css'))
  .replace('/*@PLAYER@*/\n', () => read('app/player.js'))
  .replace('/*@APP@*/\n', () => app)
  .replace('/*@ENGINE@*/\n', () => esc(bundle))
  .replace('/*@PRESETS@*/\n', () => `const BUILTIN_PRESETS = ${esc(JSON.stringify(presets))};\nconst PATTERNZ = ${JSON.stringify(patternz)};\n`);
// the version, by the title and in the presets footer, so a phone shows which one it has: the number of the commit
// this build goes into (one past the commits so far), and when it was built (UK time)
let ver = 1;
try { ver = Number(execSync('git rev-list --count HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString()) + 1; } catch (e) { /* no commits yet */ }
const built = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
writeFileSync(outFile || new URL('index.html', here), page.replaceAll('@VER@', () => ver).replace('@BUILT@', () => built));
console.log(`${outFile || 'index.html'}: ${(page.length / 1024).toFixed(1)} KB`);
