# Elixir Werkstatt

A mono synth in the browser: [Elixir Synth](https://github.com/johnnyhawk02/elixir-synth) with its LXR drum 1 voice
replaced by a component-level model of the **Moog Werkstatt-01** voice. **Play it (once GitHub Pages is on for this
repo): https://johnnyhawk02.github.io/elixir-werkstatt/**

Everything around the voice is Elixir Synth's: the note sequencer, the fader sequencers, the echo,
reverb and ring mod, the distortion and compressor, presets and the recorder. The echo, distortion, ring mod and reverb
are still the JavaScript port of the Erica Synths LXR-02 firmware's FX code
([erica-synths/lxr-desktop-app](https://github.com/erica-synths/lxr-desktop-app), GPL-3.0, commit a43cd4f). Elixir
Werkstatt is unofficial: it is not made, approved or endorsed by Moog or Erica Synths.

## The Werkstatt voice

`werkstatt.js` models the Werkstatt-01's signal path block by block. The circuit blocks come from
[dfam-model](https://github.com/johnnyhawk02/dfam-model) (`js/dfam.js`), which models them from the Werkstatt-01
schematic (Moog BRD-10-011-1111):

- **VCO**: a matched-pair expo converter (with bulk emitter resistance, so the top end runs a touch flat) driving a
  ramp core, worked out as the circuit: the current charges the timing capacitor; at the threshold the comparator
  fires a one-shot that closes the reset switch, and the capacitor discharges through the switch's on-resistance
  (not all the way: the ramp starts again from what's left). The saw is the capacitor's voltage; the pulse is a second
  comparator against the PWM voltage, flipping inside the reset too. Each sample is solved exactly between those
  events, and each edge is band-limited (polyBLEP) at its exact time and size.
- **VCF**: the four-stage transistor ladder, each stage a tanh differential pair, with resonance feedback, solved per
  sample by the trapezoidal rule and Newton's method. It self-oscillates at the top of RES.
- **EG**: the timing capacitor charges through the attack pot and a diode until the comparator trips at the peak, then
  runs down through the decay pot. Sustain on holds the peak while the gate is held.
- **VCA**: an LM13700 OTA, Iout = Iabc tanh(Vin / 2Vt), with its control feedthrough. The VCA switch picks the EG or
  on (a drone).
- **LFO**: triangle or square, 0.1 Hz to 100 Hz.
- **Glide**: an RC lag on the pitch CV.

The voice runs at twice the engine's 44 140 Hz and is decimated with a windowed-sinc filter. Component values that the
schematic doesn't settle are estimates, in `WS_CIRCUIT` (SI units). Two things are assumptions to check against a real
Werkstatt: the VCO as a ramp core (the panel's saw / pulse switch) and the panel ranges (cutoff 20 Hz to 20 kHz, LFO
0.1 to 100 Hz, VCO MOD up to 3 octaves, VCF MOD up to 7). The **drive** knob (the level into the ladder) isn't on the
Werkstatt's panel.

### VCO A, VCO B and the FM

There are two Werkstatts, the same circuit, both playing the sequencer's notes (each from its own base note, so their
freqs set the ratio). As on the DFAM, the first frequency-modulates the second: **vco a** modulates **vco b**, set on
the **a→b fm** knob, modelled as a circuit too. VCO B is the main voice: its VCF and EG
are on the panel, and the randomisers and morph act on it.

- **fm src**: VCO A's raw saw or pulse, taken before the mixer (the default), or VCO A after its own VCF and VCA, so its
  envelope shapes the modulation like a two-operator FM synth.
- **fm mode**: **expo** sums the source into B's expo converter (A's +/- 5 V swings B up to +/- 10 octaves at full);
  **lin** feeds it through a resistor as a current straight into B's ramp capacitor, linear FM. There is no
  through-zero: on a deep negative swing B's core stalls, as a real ramp core would.
- The fm knob is an audio-taper pot: fine at the bottom, very deep at the top. The **mixer** sets the two levels; VCO A
  is silent by default, so it only modulates.

VCO A only runs while it's heard or modulating, so with the FM off and its level at 0 it costs nothing. Inside (and in
presets) the main voice is still `ws` and the modulator `wsB`, with the FM and levels in `fm` (`levelA` is the main
voice's level); a preset from before the second voice starts the modulator as a copy of the main one, with the FM off.

The voice page is laid out like the DFAM's panel, the two VCOs first, with the rest in an xtra tab:

| tab | section | controls |
|---|---|---|
| panel | vco a | freq (the base note), wave (saw / pulse), pwm, a→b fm (the FM amount) |
| | vco b | freq, wave, pwm |
| | mixer | vco a, vco b (the two levels) |
| | vcf | VCO B's cutoff, reso, vcf mod |
| | vca a env | env 1, opening VCO A's VCA: attack, release, gate (a / b / a+b) |
| | vca b env | env 2, opening VCO B's VCA: attack, release, gate |
| | vcf env | env 3, the EG mod of both voices (vcf mod, and vco mod set to eg): attack, release, gate |
| xtra | a | the rest of VCO A: fine, vco mod and src, glide, its whole VCF, its VCA switch, volume, its LFO |
| | fm | src (a vco / a out), mode (expo / lin) |
| | b | fine, vco mod, vco src (lfo / eg), glide, vcf src (lfo / eg), polarity (+ / −), drive, vca (eg / on), volume, lfo rate, lfo wave |

The three envelopes are ARs (the capacitor EG circuit, held at the top while its gate is on, then released), and each
chooses the gate that fires it: gate a, gate b, or either. By default gate a plays VCO B (env 2), gate b VCO A (env 1),
and either fires the filter envelope. The sustain switch of Elixir Synth's EG is gone.

**The seq page** is a gate and pitch sequencer, like the DFAM's: four lanes of sixteen steps (four pages, up to 64
steps). **gate a** and **gate b** set each step's gate time (rest, a quarter to all of the step, or hold on to the
next); **pitch a** and **pitch b** set VCO A's and VCO B's pitch on each step (two octaves of the root and scale, on
top of each VCO's freq), set on every step whether it has a gate or not, as a sequencer's pitch CVs are. The morph lane
(the morph button) moves one knob step by step. Random makes a line with the algo fader's algorithm as gate a and pitch
b, and gate b and pitch a from it (its accents, the gaps between its notes, the same, or a pattern of its own; a drone,
the same notes, a fixed step up, or a slow line). A preset from before (one note a step) plays its notes on both VCOs
and both gates.

Presets keep the voice as `ws` (its knobs by name). A preset from Elixir Synth loads with its sequence and effects and
the Werkstatt's default sound. Presets here are kept under their own browser key, apart from Elixir Synth's.

## The screen

The screen is landscape, 5:3, laid out once at 1000 x 600 and scaled as a whole to fit the window, with the case
showing round it where the window is a different shape. That is how the plugin's window will resize.

The top line is slim: the title (tap it for the prefs), the metronome, play and the **tempo** dial (drag it up or
down; MIDI CC 1 on any channel turns it too). The pages have the rest of the screen: tap the page buttons along the
bottom of the window, or swipe across them. The space bar starts and stops. Dragging a fader, a dial or the steps never
turns the page. R starts and stops a recording. (Elixir Synth's other perf dials are gone, for the room: reso and the
FM are on the voice page, the sends on the fx page, and an old preset's pitch, decay and filter macros are baked into
its sound when it loads.)

  Drive, echo feedback, reverb decay and the distortion mix are on the voice, fx and mstr pages.

  Chrome asks for MIDI access at the first touch.
- **SEQ**: the gate and pitch sequencer (gate a, gate b, pitch a, pitch b; see above). Pick the page (the one
  playing is underlined), then draw across a lane's steps. *Copy to n+1* copies the page shown onto the next one and
  moves there (it's off on page 4); shift moves the pattern, oct moves both pitch lanes. *Length* sets how many steps
  play, 1 to 64 through the pages in turn; a drag catches at 16, 32 and 48. Root, scale, density, morph, algo, and
  random, alter (the page shown) and undo. The algo fader picks how random writes the line: 1 dice, 2 acid, 3 euclid,
  4 arp, 5 walk, 6 motif, 7 groove, 8 phrase, 9 pure, 10 patternz (random bits of a bank of acid patterns, looped,
  moved up or down the scale, sometimes backwards, and put in the key; page 2 is page 1 changed a little, page 3 is
  page 1 moved up, page 4 a new cut-up). Presets from before there were pages play their one page on all four.
- **VOICE**: both Werkstatt voices and the FM, on a DFAM-style panel tab and an xtra tab (see above).
- **FX**: the echo (tempo-synced on musical lengths, ping pong, tone, feedback, width), the reverb (send, predelay,
  decay, tone, early reflections; at the top its decay holds) and the ring mod, with random, alter and undo.
- **MSTR**: distortion (tube, fold or rat) on the whole mix, then the compressor.
- **PRST**: presets, kept in this browser: save new, save over, load, delete, import and export. While playing, a
  preset comes in at the next bar.
- **Prefs**: tap the ELIXIR title. Screen colours, whether loading a preset uses its tempo, and the version.

Hold any fader for half a second to open its step sequencer: 2 to 16 steps, depth, slew, speed, draw with a finger,
randomise, on or off. Presets keep them.

**R** records the finished mix from the moment you press it (REC and the time show under the title) and downloads a WAV when you press it again.

## The LXR engine (the effects)

The LXR engine still runs, for its FX bus (the echo): it renders none of its own voices, and the Werkstatt's output goes
in where its drum 1 would be. The notes below are from Elixir Synth; the drum 1 parts (`setDrumPitch()`, the declick)
are no longer used by the voice.

`lxr.js` follows the firmware's C line by line. Elixir Mobile's `verify.mjs` compares it sample for sample with the
firmware's own code built for the Cortex-M7 and run under qemu (see `ref/`). The engine runs as it does there, in
64-sample blocks at the firmware's rate, resampled to the phone's.

Elixir Synth adds two things to it. `setDrumPitch()` moves drum 1 to a note between semitones without a retrigger,
for the pitch dial and for slides. A note on a whole semitone goes through the firmware's own trigger and is
bit-exact; `test/engine.mjs` checks that.

The engine also declicks retriggers (`engine.declick`, on by default; `verify.mjs` turns it off, since the firmware
has none). The firmware's trigger restarts the voice from silence (it resets the filter and the oscillator), so a
note still sounding when the next one starts would jump straight to the new one's first sample and change direction
there. The engine takes both out with an offset that starts at the jump, leaves at the old note's slope and dies away
over a few ms (critically damped, a 2 ms time constant). The declicked voice is in `engine.voiceOut` and goes to the FX
bus; `engine.out` stays the firmware's. Matching the slope matters with the filter closed down, where a near-sine has
nothing on top to hide a kink. A host that scales the voice tells the trigger how the old note was last heard; the
player (`app/player.js`) does, and starts a retrigger at its new gain (accent) at once, the offset taking up the step.

And the reverb: the firmware has one (`FX/Reverb.c` and `FX/VerbTools/`), compiled out of the LXR-02 with
`USE_REVERB 0`. `lxr.js` ports it line by line as the FX bus's `FX_REVERB`, with its quirks (a mono output, loop 2
running through loop 1's allpass, a modulated allpass whose depth is never set). It hasn't been compared sample for
sample with the firmware, since the firmware never builds it.

## Files

| Path | What it is |
|---|---|
| `index.html` | the whole app in one file, built by `build.mjs` |
| `index.src.html` | the page's markup |
| `app/` | the page's code: `style.css`, `player.js` (the audio thread), then `core` (state, audio, shared helpers), `ui` (pages, faders), `perf`, `voice`, `fx`, `noteseq`, `fseq`, `random`, `presets`, `record`, `lcd` (screen colours), `pwa` |
| `werkstatt.js` | the Werkstatt-01 voice |
| `lxr.js`, `lxr-tables.js`, `lxr-ui-data.js`, `lxr-clicks.js` | the LXR engine (its FX bus) |
| `presets/` | the built-in presets, in the format the presets page exports |
| `patterns/`, `tools/import-patternz.mjs` | the patterns patternz random cuts up, and the script that reads them from `.pat` and `.ph2seq` files |
| `sw.js`, `manifest.webmanifest`, `icons/` | the offline app |
| `test/` | `engine.mjs` (sound, in Node: tuning, the sequencer, the reverb, the presets' levels), `sound.mjs` (every preset's audio hashed, so a refactor can't change the sound) and `smoke.mjs` (the page, in Chromium at three window sizes) |
| `verify.mjs`, `ref/` | the sample-for-sample comparison with the firmware |

## Build and test

```sh
node build.mjs               # rebuild index.html
node test/engine.mjs         # tuning, cents, the sequencer, the reverb, the presets' levels
node test/sound.mjs          # the sound unchanged, bit for bit (--write records it, only when a change is meant)
node test/smoke.mjs          # the page at 1000 x 600, 1600 x 900 and 700 x 520 (needs Playwright)
```

## Licence

GPL-3.0-only, like the firmware it is derived from (see [LICENSE](LICENSE)). "Erica Synths", "LXR" and "LXR-02" are
trademarks of Erica Synths; they are used here only to say where the engine comes from.
