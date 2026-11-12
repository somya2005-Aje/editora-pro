# Editora Pro — PHASE 4 REPORT (2026-11-12)

Scope: `final-deploy/app/index.html`, `app.css`, `app.js` ONLY (video editor).
Photo editor files (`photo.html`/`photo.css`/`photo.js`), the landing page
(`final-deploy/index.html`), `TEST_REPORT.md`, `PHASE1_REPORT.md`,
`PHASE2_REPORT.md`, `PHASE3_REPORT.md` and the deploy zip were NOT touched.
NOT deployed. Vanilla JS + Web Audio API only. No AI, no ads, no paywall,
no watermark, no login — verified by scan (zero hits for AdMob/AdSense/
InMobi/OpenAI/Gemini/Premium in `app.js`; the two `paywall` hits and the
single `window.open` hit are inside code comments, not code). No new CDN
dependency — the vendored FFmpeg in `app/vendor/` is reused; nothing new
is fetched at runtime.

APK target (user order 06:23 IST, "Browser ke liye mat banana, app ke liye
banao — sab app ke andar ho"): everything built here runs inside the
Capacitor WebView (`capacitor://localhost`). All new controls are plain
buttons / selects / sliders / canvases with Pointer Events — the keyframe
lane dots and the Bezier editor drag with touch, not only mouse. No
`window.open`, no desktop-only assumption, no new permission, no new
network use. New state (text fields, caption tracks/words, audio FX,
speed keyframes, time maps, frame holds, keyframe easings) is plain
timeline/project data, so it persists through the existing IndexedDB
autosave and restores on reload.

## What was built

### 1. Text & Typography — 14 presets, 14 animations, full controls
- Registry `TEXT_PRESETS` (14, all real): Titles, Headings, Subtitles,
  Credits, End screens, Lower thirds, 3D-style, Neon, Gradient, Outline,
  Shadow, Glow, Transparent text, Kinetic typography. Each sets font,
  size, weight, colour, background, outline, shadow, position, animation,
  letter spacing, line height, alignment, rotation, opacity and gradient.
  Offered in TWO places, one implementation (`applyTextPreset`): the Text
  panel preset dropdown (`#txtPreset`) and the Templates screen
  (`#textPresets`, built by `buildTextPresets()`, alongside the Phase 1
  Title styles — no duplicated dead list).
- Full typography controls in the Text panel (all wired to the selected
  text clip, and used as defaults for the next clip): font family, size,
  weight (400/700/900), colour, background + show toggle, outline,
  shadow, letter spacing, line height, alignment (left/center/right),
  position, rotation, opacity, gradient text (colour 2). All fields are
  stored on the text clip and persist in the project snapshot.
- Text animations that REALLY animate — one deterministic engine,
  `textAnimState(clip, localTime, duration)`, drives BOTH the preview
  (`renderTextOverlay`, recomputed on every 100 ms clock tick) and the
  Canvas export (`drawAnimatedText` in `drawFrame`): Typewriter,
  letter-by-letter, word-by-word, fade, zoom, bounce, slide, rotate,
  flip, glitch, wave (per-character sine offsets), mask reveal, plus the
  old fade/slide/pop. The animation list in the Animation tab now offers
  all 14. **Bug fixed on the way:** Phase 3 named the CSS animations
  `fadeIn`/`slideUp`/`popIn` but never defined them in `app.css`, so the
  old text animations were no-ops. The keyframes are now defined
  (plus `bounceIn`/`zoomIn`).

### 2. Captions — tracks, word timings, split/merge, ASS, Vosk attempt
- MULTIPLE caption tracks: `S.capTracks` (built-in Main + Secondary, plus
  "New caption track" adds more, any name). Captions carry `trackId`
  (default Main; old captions get it on snapshot load). The caption list,
  inline editing and SRT/VTT/ASS export all operate on the SELECTED track
  (`#capTrackSel`); the preview renders BOTH tracks at once (Main at the
  bottom, Secondary above it in yellow). Exports are named per track
  (`captions-main.srt`, …) and the result toast names the track.
- Word/sentence timestamps: each caption row has a ▦ Words editor — the
  words are auto-split evenly across the caption's duration, and every
  word's text/start/end is editable. Karaoke highlighting uses the word
  timings when present (the word whose interval contains the playhead),
  otherwise the old fraction method.
- Split caption (splits the text at the middle word, second half starts
  at the midpoint time) and Merge captions (merges a caption with the
  next one on the same track) — both real, both in the caption row.
- Timing editing (pre-existing, verified) and karaoke (pre-existing,
  verified + word-timing upgrade). SRT/VTT import (pre-existing parser,
  now tags imported captions with the selected track) and export
  (pre-existing, now per selected track) — verified.
- ASS export: REAL `.ass` output (`toASS`) — `[Script Info]`,
  `[V4+ Styles]` (font/size/colours from the caption style, converted
  to ASS `&H00BBGGRR`), `[Events]` with `Dialogue` lines, and `\k`
  karaoke tags (centiseconds) when the caption has word timings.
- Speech recognition — VOSK ATTEMPTED, NOT SHIPPED (honest): `vosk-browser`
  0.0.8 exists on npm, but it needs its speech model (~40 MB,
  e.g. `vosk-model-small-en-us-0.15`) downloaded at runtime — there is no
  offline-bundled model in this app, and a runtime download would break
  the offline-first rule for the Android app (and add ~40 MB + wasm to
  the APK assets). The Captions panel therefore has a DISABLED
  "Offline auto-captions (Vosk) — not available offline" button with the
  reason written next to it, and the existing browser SpeechRecognition
  button stays, clearly labelled as browser speech recognition (not AI).
  No auto-caption button fakes captions: the only working auto-caption
  path is the real browser one.

### 3. Audio Studio — clip editing, real effects, synthesized library
- Audio clip editing on A1/A2: Split audio at playhead (speed-aware
  `splitClipAt`), Merge audio with next (same-source, adjacent),
  Nudge ±1 frame (at the project frame rate), Trim audio to the trim
  bars. All real, all on the selected audio clip.
- Pitch shift: per-clip semitones (−12…+12). Preview plays at the
  shifted pitch (playbackRate — speed follows pitch in preview, labelled
  as such); the Video Engine export preserves the clip length with
  `asetrate` + `aresample`; the Canvas export plays the shifted pitch.
- Speed per audio clip, Reverse audio (per-clip flag): true reverse in
  the Video Engine export (`areverse`); the Canvas export reverses the
  audio buffer on-device before recording (`reversedAudioUrl` —
  decode, reverse the samples, re-encode as WAV).
- Normalize: real peak normalization — decodes the clip, measures the
  true peak, sets `clip.normGain` so the peak hits −1 dB (0.89). Applies
  in both export paths (FFmpeg `volume=`, canvas gain).
- Stereo/mono toggle + channel balance (StereoPanner in preview/canvas,
  `pan=mono|…` / `stereotools=balance_out` in FFmpeg).
- Audio EFFECTS (18 controls, `S.audioFx`): 5-band EQ (60/230/1000/4000/
  12000 Hz), bass boost, treble, reverb, echo, delay, chorus, flanger,
  phaser, distortion, compressor, limiter, gate, noise reduction.
  Each is a REAL Web Audio node chain (`buildAudioChain` — BiquadFilters,
  generated-impulse ConvolverNode for reverb, DelayNode feedback for
  echo/delay, LFO-driven delay for chorus/flanger, allpass LFO for
  phaser, WaveShaper for distortion, DynamicsCompressor for compressor/
  limiter/gate) used in the audio preview AND the Canvas export mix, and
  a REAL FFmpeg audio filter chain (`ffmpegAudioFx` — `equalizer`,
  `bass`, `treble`, `aecho`, `adelay`, `chorus`, `flanger`, `aphaser`,
  `acrusher` for distortion, `acompressor`, `alimiter`, `agate`,
  `highpass` + `afftdn` for noise reduction) used in the Video Engine
  export. "Preview selected audio with effects" plays the selected clip
  through the chain for 3 s. Noise reduction is honestly labelled
  "traditional: noise-gate + high-pass" (Web Audio) / `afftdn` (FFmpeg),
  not AI. The gate in Web Audio is a DynamicsCompressor used as an
  expander approximation + high-pass — labelled as such in the code.
- Audio LIBRARY: 10 synthesized sound effects (whoosh, pop, ding,
  swoosh, applause, click, riser, boom, chime, sparkle) and 3 background
  tones (Calm pad, Upbeat loop, Ambient drone) — all generated on-device
  with Web Audio oscillators/noise and rendered to WAV via
  OfflineAudioContext (`encodeWAV`). ▶ previews each one; "+ Timeline"
  adds it as a real audio clip (the WAV blob becomes a media record, so
  it saves with the project). Labelled everywhere as built-in
  synthesized tones — no licensed music is claimed.

### 4. Animation & Keyframes — presets, lane, easing, Bezier
- Animation presets that REALLY apply (21, `ANIM_PRESETS`): Position,
  Scale, Rotation, Opacity, Zoom, Pan, Bounce, Shake, Swing, Pulse,
  Pop In/Out, Fade In/Out, Slide In/Out, Rotate In/Out, Elastic,
  Spring, Overshoot. Applying one writes real keyframes onto the
  timeline starting at the playhead (with easings). Rotation is a real
  keyframe prop now: the live interval applies `kfValue("rotation")` to
  `S.rotation`, so Rotate/Rotate In/Out visibly rotate the preview.
- Keyframe timeline: a lane (`#kfLane`) under the timeline shows every
  keyframe as a draggable ◆ dot (position = time, label = prop, tap to
  select + seek, drag to move the time — Pointer Events, touch works).
  The existing keyframe list now shows the easing per keyframe.
- Ease In / Ease Out / Ease In-Out per keyframe (`_easeKf`, applied in
  `kfValue` interpolation), plus a custom Bezier curve editor
  (`#bezierCanvas`, draggable control points, Pointer Events, touch
  works) for the selected keyframe's segment. Copy / paste / delete
  keyframes are wired (`S.kfClipboard`, paste at the playhead).
- Interpolation is visible in the preview: the existing 120 ms live
  interval now also applies rotation keyframes, and `refreshVideoStyle`
  composes keyframe opacity/scale/position with transitions/transform.

### 5. Speed & Motion — ramp, time remap, frame hold, motion blur
- Speed ramp: per-clip speed keyframes (`clip.speedKf`, offset + speed).
  `clipSpeedAt` interpolates linearly; `sourceTimeForOffset` integrates
  the speed over the clip (0.05 s steps) so the source time is exact.
  Preview: `seek()` sets the video time from the integral and the
  playback rate from the ramp; the playback clock inverts the map
  (`offsetForSourceTime`). Canvas export renders the ramp because its
  render loop calls the same `seek()`. The Video Engine export lists
  the ramp as skipped (it cannot vary speed inside one re-encoded
  clip) — honest labelling, not faking.
- Time remapping: per-clip time-map editor (`clip.timeMap`, output-time
  → source-time points, piecewise-linear). Overrides the speed ramp
  while it has 2+ points; same preview + Canvas-export rendering.
- Frame hold: hold one frame for N seconds inside the selected clip
  (`clip.frameHold = {at, dur}`) — the source time freezes during the
  hold window and resumes after it. Renders in preview + Canvas export.
- Freeze frame (pre-existing) and Reverse (pre-existing) verified
  untouched. Motion blur: real frame blending in the Canvas export
  (previous exported frame blended at 0.35 alpha when the toggle is on);
  the Video Engine export lists it as skipped.
- Optical flow: OMITTED — true frame interpolation needs a
  frame-interpolation engine (optical-flow estimation + frame synthesis)
  that this build does not have; the Speed tab says so in the UI.

## Verification (this session — code + a real functional harness, no live browser)
- `node --check app/app.js` — PASS (re-run after every edit batch).
- **Functional harness** (`/tmp/phase4_test.js`, loads the REAL `app.js`
  in a stub-DOM vm, not a copy of the logic): **61/61 PASS**, including:
  - registries: 14 text presets, 14 text animations, 21 animation
    presets, 54 transitions + None (Phase 3 intact), 10 SFX, 3 BGM,
    18 audio-FX controls, 2 default caption tracks;
  - text animations: typewriter empty → partial → full; word/letter
    reveal; fade 0→1; zoom 0.5→1; wave flag; mask 0→1; bounce >1;
  - keyframes: linear 50, easeIn 25, easeOut 75, Bezier identity 50,
    Bezier custom in range;
  - speed: ramp 1→2×, source time 0→5 s = 6.25 source s, inverse map
    back to 5 s; time-map interpolation; frame hold freezes at 2 s and
    resumes after the hold (this caught a real bug — the resume
    integration used `offset−holdDur` instead of
    `offset−holdAt−holdDur`, fixed and re-tested);
  - captions: SRT/VTT export only the selected track (Main 2, Secondary
    1); split → 4 captions, merge → 3; auto word timings 4 words 0→4 s;
    ASS has `[Script Info]`/`[V4+ Styles]`/`[Events]`, `\k100` karaoke
    tags, a real Dialogue line;
  - audio FX: FFmpeg chain contains `equalizer`, `bass`, `aecho`,
    `acompressor`, `areverse`, `asetrate`, `pan=mono`, `volume=1.200`,
    and is empty when idle;
  - flows: Fade In preset adds 2 keyframes at the playhead, Bounce
    adds 4; Neon preset sets the selected text clip's font/colour/
    animation; Gradient sets the gradient flag; snapshot round-trips
    `capTracks`/`audioFx`/`motionBlur`;
  - `init()` runs without throwing against the stub DOM (exercises all
    Phase 4 builders + wiring).
- **ID audit** (`/tmp/audit_phase4.py`): 411 ids in `index.html`, ZERO
  duplicate ids; all 214 `$("…")` ids referenced in JS exist in the
  HTML (the 16 "missing" hits are the same pre-existing `$$()` class /
  attribute selectors as Phases 1–3 — `.panel`, `.modal`, `.toolbtn`,
  `.itab`, `.tlk`, `.tvis`, `.lib-nav-item`, `[data-nav]`,
  `#alignRow [data-align]`, `#menuDrop [data-m]`, `#projFilters [data-pf]`,
  `#libTabs [data-lt]`, `.appnav [data-screen]`, `.ipanel`,
  `#curveChanRow [data-curve]`, `#fxGroups [data-fx]` — all present);
  306 controls in the HTML, 250 with ids; all are wired except
  `btnVoskCap` (intentionally disabled, no handler — it is a labelled
  dead end, not a fake control) and the three wheel-amount sliders,
  which are wired by the `[[id, key]].forEach(bind…)` loop in Phase 3
  (dynamic binding, verified by grep). All 48 new Phase 4 ids exist in
  HTML and are referenced in JS.
- Phase 1–3 regression: the harness loads the whole file (all registries
  and helpers intact); `init()` exercises the Phase 1 screens, Phase 2
  helpers and Phase 3 builders in the same run; the id audit covers all
  pre-existing controls.
- One regression caught and fixed during this phase (not in the harness
  count): restoring the broken `toASS` string accidentally deleted
  `parseSRT` / `syncCapStyleUI` / `toSRT` / `srtTime` / `toVTT` /
  `downloadText` — all six were restored (with the Phase 4 track
  changes) and re-verified by `node --check` + the harness SRT/VTT
  tests. No duplicate function definitions remain.

## Render-path tables (Phase 4 additions)

Key: P = preview, C = Canvas export, F = Video Engine (FFmpeg) export.

### Text animations (14)
All 14: P ✓ (deterministic `textAnimState`) / C ✓ (same engine in
`drawAnimatedText`) / F — (text is not rendered by the FFmpeg path at
all, as before — listed as skipped there).

### Audio (per clip / global FX)
| Feature | P | C | F |
|---|---|---|---|
| Trim / split / merge / nudge (audio clips) | ✓ (timeline) | ✓ | ✓ (trim via attrim) |
| Pitch shift | ✓ (playbackRate; speed follows pitch) | ✓ (playbackRate) | ✓ (`asetrate`+`aresample`, length preserved) |
| Clip speed | ✓ | ✓ | ✓ (`atempo`) |
| Reverse audio | — (labelled) | ✓ (buffer reversed on-device) | ✓ (`areverse`) |
| Normalize (peak) | — | ✓ (gain) | ✓ (`volume=`) |
| Stereo / mono, balance | ✓ (StereoPanner) | ✓ | ✓ (`pan` / `stereotools`) |
| EQ / bass / treble / reverb / echo / delay / chorus / flanger / phaser / distortion / compressor / limiter / gate / noise reduction | ✓ (Web Audio chain, preview button) | ✓ (same chain in the export mix) | ✓ (FFmpeg audio filters) |
| SFX library / BGM tones | ✓ (preview) | ✓ (timeline audio clips) | ✓ (timeline audio clips) |

### Speed & motion
| Feature | P | C | F |
|---|---|---|---|
| Speed ramp (speed keyframes) | ✓ | ✓ | — (listed as skipped) |
| Time remapping | ✓ | ✓ | — (listed as skipped) |
| Frame hold | ✓ | ✓ | — (listed as skipped) |
| Motion blur | — | ✓ (frame blending) | — (listed as skipped) |
| Optical flow | — | — | — (omitted, see below) |

## Honest Limitations (Phase 4 — what is NOT implemented and why)
- Optical flow is omitted: true frame interpolation needs an
  optical-flow estimator + frame synthesizer; no such engine exists in
  this vanilla-JS build. The Speed tab states this in the UI.
- Vosk offline auto-captions are not shipped: the engine needs a ~40 MB
  model downloaded at runtime (no offline-bundled model exists in the
  app), which would break the offline-first APK rule and add ~40 MB +
  wasm to the packaged assets. The button is present but disabled with
  the reason beside it; the working auto-caption path is the browser's
  built-in speech recognition, labelled honestly (not AI).
- Speed ramp / time remap / frame hold / motion blur render in the
  preview and the Canvas export only. The Video Engine (FFmpeg) export
  re-encodes each clip at one constant speed, so those features are
  listed by name as skipped in its export result instead of faked.
- Text, captions and V2 overlays are still not rendered by the Video
  Engine export (pre-existing limitation) — the Canvas export burns
  them in, including the Phase 4 text animations.
- Audio pitch in the preview and Canvas export changes the playback
  rate, so pitch and speed move together there; only the Video Engine
  export separates them (resampling). The Audio tab says so.
- The Web Audio "gate" is a DynamicsCompressor used as an expander
  approximation + high-pass — there is no stock Web Audio gate node.
  FFmpeg uses the real `agate` filter. Labelled in the code and UI.
- Distortion in the FFmpeg path is `acrusher` (bit-crush) — FFmpeg has
  no WaveShaper equivalent; the Web Audio path uses a real WaveShaper.
- Reverb in the FFmpeg path is a multi-tap `aecho` — FFmpeg has no
  convolution reverb without an IR file; the Web Audio path uses a real
  generated-impulse ConvolverNode.
- If a reversed audio clip fails to decode, the Canvas export's audio
  mix for that clip is skipped (the outer try/catch treats audio as
  optional, as before) — the video still exports.
- The keyframe lane shows keyframes for the whole project (keyframes
  are global, as in Phase 3 — they are not per-clip). The selected
  keyframe (`S.selKf`) is UI state and is not persisted in the project
  snapshot; the keyframes themselves are.
- No live-browser / live-WebView run was done in this session (no
  live-browser access from this agent). All verification above is code
  trace + the Node harness against the real file.

## APK-readiness
- WORKS IN A WEBVIEW (no native code needed): all new controls are
  plain buttons/selects/sliders/canvases with Pointer Events (keyframe
  lane drag + Bezier drag work with touch); no new network use; all new
  state is plain timeline/project data, so it persists through the
  existing IndexedDB autosave and restores on reload; no new
  permissions (microphone is already needed for the existing voice
  record / browser speech captions).
- The vendored FFmpeg loader is untouched; the new FFmpeg audio filters
  need only the already-vendored engine. `final-deploy/app/vendor/` is
  still the only extra asset the APK must include.
- NOTHING in Phase 4 changes the export engines' structure, the deploy
  packaging, or the photo editor.

## Files changed
- `final-deploy/app/index.html` (665 → 727 lines): Text panel preset
  dropdown + full typography controls; Captions panel track selector,
  new-track button, ASS export, disabled Vosk button + note; Audio tab
  clip tools, pitch/speed/reverse/normalize/stereo/pan, FX panel
  container, SFX + BGM grids; Speed tab ramp/remap/hold/motion-blur;
  Animation tab full animation list, preset picker, easing select,
  Bezier canvas, keyframe copy/paste/delete; keyframe lane under the
  timeline; Templates screen text-presets section; `rotation` option
  in the keyframe property list.
- `final-deploy/app/app.css` (249 → 263 lines): `@keyframes` for
  fadeIn/slideUp/popIn/bounceIn/zoomIn (the Phase 3 animations were
  undefined), keyframe-lane dot styles, Bezier canvas cursor, FX panel
  spacing.
- `final-deploy/app/app.js` (3372 → 4294 lines): Phase 4 section
  (`TEXT_PRESETS`, `textAnimState`, `drawAnimatedText`,
  `applyTextPreset`, `buildTextPresets`, `ANIM_PRESETS`,
  `applyAnimPreset`, `renderKfLane`, `drawBezier`/`wireBezier`,
  `clipSpeedAt`, `sourceTimeForOffset`/`offsetForSourceTime`,
  `renderSpeedKfList`, `AUDIO_FX_DEFS`, `buildAudioFxPanel`,
  `makeImpulse`, `buildAudioChain`, `ffmpegAudioFx`,
  `selectedAudioClip`, audio clip ops, `normalizeAudioClip`,
  `encodeWAV`, `reversedAudioUrl`, SFX/BGM synthesis + grids,
  `previewAudioFx`, `buildPhase4UI`/`wirePhase4`); `renderTextOverlay`
  rewritten (animation engine + typography + dual-track captions);
  `renderCapList` rewritten (track filter, split/merge, word editor);
  `toASS` + `toASSExport` added; `parseSRT`/`toSRT`/`toVTT` now
  per-track; `kfValue` now eases (linear/easeIn/easeOut/easeInOut/
  Bezier); rotation keyframe prop wired into the live interval;
  `seek()` + playback clock use the speed/time-map integral; Canvas
  export text drawing uses `drawAnimatedText`, audio mix routes through
  the FX chain + reversed buffers + motion-blur blending; FFmpeg export
  adds the audio FX chain and the skipped-list notes; snapshot/
  applySnapshot persist caption tracks, audio FX and motion blur;
  `init`/`renderAll`/`selectClip` wired to the Phase 4 builders.
- This report: `~/workspace/editora-pro/PHASE4_REPORT.md`.

## Required live check (parent, before announcing)
1. Desktop Chrome (serve `final-deploy` over HTTP): add a text clip →
   apply the Neon preset → set animation Typewriter → play: the text
   types itself in the preview. Export Canvas 720p — confirm the
   exported file shows the same typewriter animation.
2. Captions: add captions on Main + Secondary → export SRT (Main) and
   ASS → open the ASS file and check the `[Events]` lines and `\k`
   tags after adding word timings. Split + merge a caption in the panel.
3. Audio: import an audio clip → set pitch +6, Reverse, Normalize →
   tap "Preview selected audio with effects" with Reverb at 50% →
   export Video Engine — confirm the result lists the audio filters as
   applied. Tap a sound effect ▶, then "+ Timeline".
4. Keyframes/speed: select a video clip → apply the Bounce preset →
   drag a ◆ in the keyframe lane → set a speed keyframe 2× at 2 s →
   play: the clip visibly bounces and speeds up; export Canvas and
   confirm the ramp is in the file.
5. Same flow on one Android phone (touch only): drag a keyframe dot
   and a Bezier control point with a finger; all new buttons tappable;
   no keyboard needed.
