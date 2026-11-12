# Editora Pro — Phase 4 + 5 Report (Video track)

**Date:** 2026-11-12
**Scope:** video editor only. Files touched (and nothing else):
- `final-deploy/app/index.html` — 871 → 973 lines
- `final-deploy/app/app.css` — 341 → 393 lines
- `final-deploy/app/app.js` — 5,589 → 5,959 lines

NOT touched: `photo.html/css/js`, `icons.js`, `modules/`, `TEST_REPORT.md`,
landing page, `deploy.py`, the zip. No deploy, no APK build. New icons are
inline SVG / registry icons only — `icons.js` was not edited.

**Rules kept:** free, ad-free, no AI, no watermark, no login. No emoji tool
icons (SVG only). `[hidden]{display:none!important}` remains the first rule
of `app.css` (line 5) — modals never stack. Every new control is wired to a
real action; nothing is presented as functional without an implementation.

---

## Phase 4 — Video Editor MVP: what was built

### Desktop layout (roadmap §4)
- **Top menubar** (`#menubar`): File, Edit, View, Sequence, Clip, Effects,
  Audio, Help — 8 menus, 52 items, each dispatching to a real action via
  `menuAction()` (new project, save, backup, export, frame export, undo/redo,
  split/cut/copy/paste/duplicate/delete, panel toggles, zoom, timeline
  expand, fullscreen, theme, markers, insert/ripple, go-to-start/end, frame
  rate, merge, reverse, freeze, speed, effects/transitions/filters/audio
  panels, audio split/normalize/preview-FX/ducking, shortcuts, Export Center,
  settings, about). One dropdown open at a time; outside-click and Escape
  close it.
- **Left panel tabs (7, roadmap order):** Media Bin, Effects, Transitions,
  Titles, Captions, Audio, Assets. (Was 9 tabs: Import/Audio/Text/Stickers/
  Effects/Trans/Captions/Filters/Pro.) Filters & Color and Pro Tools content
  moved into the Effects panel as sections (all element ids preserved, so
  existing JS bindings still work); Stickers moved into Assets; Crop moved
  from the Effects panel into the right Inspector's Video tab; Audio is now
  a real hub panel (its buttons invoke the same inspector-audio controls)
  instead of a button that only opened the inspector with a toast.
- **Program Monitor:** playback + timecode (existing), plus new resolution
  readout (`#monRes`, e.g. "1920×1080 · 16:9", updates when the export
  resolution changes) and safe-area toggle (`#btnSafeAreas`, cyan action-safe
  90% / amber title-safe 80% guides).
- **Right Inspector:** Video tab now has Crop (`cropRatio`, `cropZoom`) and a
  new "Effect parameters (selected clip)" section (`#inspFxParams`) — one
  live slider row per effect on the selected clip, with a remove button.
  Audio / Speed / Animation / Adjustment tabs unchanged.
- **Bottom timeline:** 5 tracks kept (V1, V2 · Overlay, Text, A1, A2) with
  ruler, playhead, snapping, zoom, per-track mute (`S.mutedTracks`, new
  `.tmute` buttons — red when muted), lock, visibility, clip thumbnails
  (image `<img>`, video `<video preload="metadata">`, music icon for audio),
  clip label spans, and real decoded waveforms on A1/A2 clips
  (`ensureAudioPeaks` + `drawClipWaveform`, 96 peaks, lazy
  `OfflineAudioContext` decode, cached on the media record).
- **Timeline expand** (`#btnTlExpand`): expanded mode (420px desktop /
  60vh mobile, taller tracks/clips).

### Mobile (CSS + touch)
- Toolbar becomes a sticky bottom strip above the fixed bottom nav
  (44px min-height, 56px min-width tool buttons); menubar scrolls
  horizontally; timeline expands to 60vh; mute/lock/visibility buttons
  ≥32px.
- Pinch-zoom on the timeline (two pointers, ignores pinches starting on a
  clip, `S.zoom` clamped 40–300, throttled re-render). Select/move/trim/
  split by touch tap/drag use the preserved Job 0 pointer handling (below).

### Functionality verified in jsdom (own harness, 80 checks)
- Import (thumbnails, search/sort UI present, drag/drop to timeline),
  preview playback, trim/split/move/delete, volume, save project
  (versioned JSON v1 via `project-store`, snapshot round-trip preserves the
  new fields), export (see below), undo/redo, ripple delete, insert/replace,
  frame-by-frame (`seek` ±1/fps), freeze frame, speed, reverse flag,
  captions panel, keyframes — all still wired and exercised by the harness
  where jsdom allows (see Limitations for what jsdom cannot prove).

---

## Phase 5 — Video Advanced: what was built

### Transitions — the headline work
- **Controls added to the Transitions panel:** Easing select
  (`#transEase`: linear / easeIn / easeOut / easeInOut / smooth),
  Edge softness slider (`#transSoft` 0–100%), **Preview** button
  (`#btnTransPreview`: seeks to `clip.start − 0.15s`, plays, auto-pauses
  after `transDur + 0.8s`), **Remove** button (`#btnRemoveTrans`), and
  Apply now stores type + duration + easing + softness on the clip.
  Transition presets also save/load easing + softness.
- **Easing is real:** `transCompute()` reshapes the progress `p`
  (easeIn `p²`, easeOut `1−(1−p)²`, easeInOut piecewise, smoothstep
  `p²(3−2p)`) before computing every transition's `clipShape`/opacity.
- **Edge softness is real but approximate:** a blur ramp during the
  transition (`out.blur += inv × 10 × soft`) plus gradient-mask feathering
  for wipes in the preview. It is NOT a true mask feather in the Canvas
  export (see Limitations).
- **True between-clips cross-dissolve (fade family only):** the timeline
  model has no clip overlap, so a true blend is implemented as: during the
  first `transDur` seconds of a clip with a fade-family transition
  (`fade, dissolve, crossdissolve, filmdissolve, fadeblack, fadewhite`),
  the previous adjacent clip's **last frame is held** underneath while the
  incoming clip fades in over it (alpha = offset/duration). Implemented in
  `crossBlendPrev()` + the Canvas export `drawFrame` loop and in the live
  preview (`drawOverlayFX`: second video element for video prev-clips,
  `exportImgCache` for image prev-clips, composited on `overlayCanvas`).
  Other transition types keep their per-clip entry animation. The FFmpeg
  path is unchanged — it fades each clip in/out and does NOT cross-dissolve
  (see Limitations).
- **Transition shape preview:** `refreshVideoStyle()` now applies
  `transCompute()`'s `clipShape` to the video element as CSS `clip-path` /
  `mask-image` (wipe inset, circle, clock conic-gradient, diag polygon,
  rect inset, diamond polygon), overriding mask/crop clip-path while the
  transition runs.
- **Verification (jsdom, proven):** `crossBlendPrev` unit checks (finds the
  previous clip at 0.5s with e=0.5; null past the window / non-fade /
  no-transition / gap); easing values differ in the right order;
  softness adds blur during a wipe and `clipShape.soft` is the 0..1
  fraction; preview applies the wipe clip-path to the video element;
  Apply/Remove/Preview/preset-save all store and restore easing+softness;
  **export proof: 212 `drawCover` calls in a 4s Canvas export, 121 for the
  first clip, latest at 2969ms — i.e. the previous clip's last frame IS
  drawn during the [2s, 3s) transition window of the second clip.**
  The full 54-transition matrix was NOT verified one-by-one (see
  Limitations) — the shared engine is verified; individual non-fade
  transitions render as per-clip entry animations in preview + Canvas
  export and are not pruned from the list.

### Titles
- Quick-add row in the Titles & Text panel: **Lower Third** (40px, bottom,
  slide, background on), **Credits** (56px, centre, fade, 5s), **End Screen**
  (64px, centre, fade, 4s) — all inserted at the playhead via
  `addTitleClip(kind)`. The 14 existing text presets are unchanged.

### Captions
- Captions tab/panel unchanged (manual entry, SRT/VTT import/export,
  multiple tracks, karaoke, browser SpeechRecognition honestly labelled,
  no AI). Tab opens its panel — verified. SRT/VTT import was not re-run
  in this track (pre-existing, see TEST_REPORT.md).

### Keyframes / speed
- Pre-existing keyframe system untouched (21 presets, lanes, Bezier editor,
  ease, copy/paste) and still wired; speed ramp / time remapping / frame
  hold / motion blur unchanged. Inspector Speed tab opens from the Clip
  menu. Per-preset export verification was not re-run in this track.

### Audio
- New Audio hub panel + track mute (see Phase 4). Mute is honoured in
  exports: FFmpeg skips muted audio tracks (listed in the export's skipped
  note) and Canvas export sets muted clips' gain to 0; preview mutes the
  video element when the active clip's track is muted.
- The 18 Web Audio effects + FFmpeg filter-chain parity are pre-existing
  and unchanged; per-effect audibility in export was not re-run in this
  track.

### Filters + colour grading
- The 35 filters (+Normal) and 22 grading items (incl. Curves / HSL /
  colour wheels / LUT .cube) are reused unchanged and still wired through
  the Effects panel. Per-item "changes preview AND export" verification was
  not re-run one-by-one in this track (engine-level wiring intact).

### Export presets + queue / history
- Export preset select (`#expPreset`) with built-ins: YouTube 1080p,
  YouTube 720p, Fast draft 480p, High quality 1080p, High quality 4K
  (each `{res, fps, bitrate, fmt, codec}`); custom presets save to
  `localStorage["editora-export-presets"]` with a name
  (`#btnSaveExpPreset`); applying a preset updates the dialog rows and the
  monitor resolution readout. Verified: built-ins list, YouTube 720p
  applies 720p/30fps/MP4, custom preset saves and re-applies.
- "Add to queue" feeds the Export Center with a real queued entry
  (verified: queue length 1, status queued). Queue-run-to-completed-history
  was not asserted end-to-end in jsdom (see Limitations).

---

## Job 0 non-regression evidence (all preserved, none reverted)
1. **Timeline clip selection:** pointerdown does NOT `preventDefault`;
   drag starts only after >4px movement; in-place style updates while
   dragging; tap selects on `pointerup`; `_clipTapAt` guard stops the
   timeline-scroll click handler seeking after a clip tap. Verified in
   jsdom: pointerdown+pointerup with NO click event selects the clip and
   opens Properties; a 60px drag moves the clip (2s → 2.6s) and keeps the
   selection.
2. **FFmpeg loader / export guard:** `loadFFmpeg()` same-origin wrapper +
   CDN fallback with independent `res.ok` checks (code untouched); Canvas
   export uses `captureStream(0)` + explicit `track.requestFrame()` per
   drawn frame; minimum-size guard `max(4 KB, duration × 2 KB/s)` reports
   FAILURE with no download link. Verified: 10-byte recording → FAILED, no
   link, frames requested; healthy 300 KB recording → "Done" with download
   link, ~120 frames for 4s @ 30fps.
3. **Import counter:** `addFiles()` snapshots `[...files]` synchronously.
   Verified in jsdom: 2 files → media 0→2, toast
   "2 file(s) imported — saved", 2 gallery items.

---

## Verification summary

| Check | Result |
|---|---|
| `node --check final-deploy/app/app.js` | PASS (5,959 lines) |
| Own jsdom harness `/tmp/p45/harness.js` | **80/80 PASS** (menubar 8 menus/52 items, 7 tabs, titles, safe areas, monitor readout, track mute, timeline expand, thumbnails/waveforms, tap-select, drag, easing/softness, transition apply/remove/preview/presets, inspector effect params, export presets, queue feed, snapshot round-trip, undo/redo, pinch-zoom, export guard, healthy export, cross-blend draw proof) |
| Original harness `verify/harness.js` (86 checks) | **84/86** — the 2 failures are both **photo-track only** (`photo: 32 tool buttons — got 35` — photo.html now has 35 `data-tool` buttons vs a stale expectation of 32; `photo: Layers drawer button toggles drawer` — photo.js drawer logic). The photo section loads only photo.html/photo.js/icons.js; none of my files are loaded there. Not mine to fix — photo track owns them. |
| Static audit `verify/audit.py` | **0 failures** — 519 ids / 0 duplicates in index.html; all 451 JS id refs resolve; all id'd controls wired or data-driven; icon-only buttons labelled; 126 icons in registry, 108 used, 0 unknown; `[hidden]` first rule in app.css; no placeholder/demo content; no unexpected external URLs; no `window.open`. (The earlier photo fgSwatch/bgSwatch failure is gone — fixed by the parallel photo track.) |
| `git status` | My modified files are exactly `final-deploy/app/index.html`, `app.css`, `app.js`. (TEST_REPORT.md / deploy.py / zip changes are pre-existing, by others.) |

**Harness environment note (jsdom only, not an app bug):** jsdom's
`window.Image` is a stub that never loads data URLs, so `exportImgCache()`
always returned null and no image ever drew in exports. The harness fixes
this by assigning `window.Image = require("@napi-rs/canvas").Image` after
DOM creation (node-canvas's Image loads but is rejected by jsdom's
@napi-rs/canvas-backed 2d contexts; the napi Image loads AND draws).
jsdom's canvas `drawImage` also rejects HTMLVideoElement sources (real
browsers accept them), so the harness's `drawCover` is rebound to skip
video-source draws in the preview blend only. Both shims live in
`/tmp/p45/harness.js`, not in the app.

---

## Honest limitations (what this track does NOT prove)

- **No live-browser or real-device testing was done** (this environment has
  no live browser). jsdom cannot play video, decode audio, or run a real
  MediaRecorder/FFmpeg. Everything above is jsdom-level evidence; the §8
  live tests below are still required.
- **54-transition matrix not verified one-by-one.** The shared engine
  (`transCompute` + easing + softness + cross-blend) is proven; fade-family
  cross-dissolve is proven in preview + Canvas export. Non-fade
  transitions render as per-clip entry animations; each one's visual
  correctness in preview AND export still needs a live pass, and any that
  fail it should be removed from the list then.
- **Filters (35), grading items (22), audio effects (18), keyframe presets
  (21):** reused unchanged; per-item preview+export verification was not
  re-run in this track.
- **FFmpeg export renders per-clip fades only** — no true cross-dissolve
  there (a real `xfade` graph is not in the concat exporter). The Canvas
  export is the true-blend path. The export dialog note says this.
- **Edge softness** is a blur ramp (+ preview gradient mask), not a true
  mask feather in the Canvas export.
- **A1/A2 audio clips are silent in preview** (pre-existing gap — only the
  video element's audio plays; audio clips sound in exports). Mute affects
  exports and video-clip audio in preview.
- **LUT file is not saved with the project** (pre-existing — the LUT name
  is saved, the .cube file itself is not).
- **Export queue:** "Add to queue" creates a real queued entry in the
  Export Center; the full queue-run → completed/failed history entry was
  not asserted end-to-end in jsdom.
- **Captions SRT/VTT import** and **speech recognition** were not re-run in
  this track (pre-existing, browser-labelled, no AI).

## Coming Later (labelled, not pretending)
- Nothing new was labelled "Coming Later" in this track — every control
  added here is wired to a real action. Pre-existing omissions carried
  forward from TEST_REPORT.md: offline speech-to-text (Vosk, ~40 MB model
  — breaks offline-first), optical-flow motion blur, multi-camera editing.
  The 18 unused registry icons remain reserved for later phases.

## What the parent must live-test (§8 video acceptance tests)
1. **Import plays:** import a real video/photo/audio; it plays in the
   Program Monitor; thumbnails appear in Media Bin; drag to timeline works
   by mouse AND touch.
2. **Trim/split/move change playback:** trim, split, move and delete a clip
   and confirm the preview and the exported file reflect the change.
3. **Transition renders across two adjacent clips:** put two clips
   adjacent, apply a fade-family transition (duration 1s) and confirm the
   preview visibly cross-dissolves at the boundary; change duration /
   easing / softness / direction and confirm the output changes; then
   export via **Canvas** (true blend) and via **Video Engine / FFmpeg**
   (per-clip fade only — confirm the note matches reality).
4. **Filter/effect changes preview AND export:** apply a filter and a
   per-clip effect, confirm both the preview and the exported file show
   them.
5. **Mobile:** on a phone-sized viewport, confirm controls are readable /
   tappable, nothing covers the canvas or timeline, timeline expands to
   full height, pinch-zoom works, and the bottom tool strip opens drawers.
6. **Export engines:** FFmpeg loads with no Worker error and the MP4 has
   the correct duration (ffprobe); Canvas export has the correct duration
   and extension; the tiny-blob failure guard still reports failure instead
   of a download link; toast reads "N file(s) imported — saved".
7. **Clip tap-select by mouse AND touch** on a real device (Job 0).
8. **A1/A2 audio:** confirm audio clips sound in the export (they are
   silent in preview — pre-existing gap, see above).
