# Editora Pro — TEST REPORT (consolidated, 2026-11-12)

Scope: `final-deploy/` — landing `index.html` (untouched), video editor
`app/index.html` (846 lines), `app/app.css`, `app/app.js` (5,399 lines),
photo editor `app/photo.html`, `app/photo.css`, `app/photo.js` (2,589 lines),
`app/vendor/` (vendored FFmpeg, ~31 MB). Source of truth per phase:
`PHASE1_REPORT.md` … `PHASE6_REPORT.md` in `~/workspace/editora-pro/`.

Method: code inspection + `node --check` + id/handler audits + stub-DOM
functional harnesses loading the real JS files. **No live-browser/WebView run
has been done on the final build in any phase** — the parent must run the
live smoke tests in §9 before announcing. Earlier live tests (2026-11-12
~06:00 IST, pre-blueprint rebuild) PASSED end-to-end on video (dashboard →
import → play → split → caption → 720p export, real 1.3 MB MP4 verified by
ffprobe) and photo (brush, filter, text layer, undo, real 640×480 PNG).

---

## Phase 0+1 — Foundation + Professional UI Shell (2026-11-12)

Source: roadmap `~/workspace/user/files/Editora_Pro_Professional_Redesign_Roadmap_6_5pg0.pdf` (§2 nav, §3 photo layout, §4 video layout, §5 design system, §6 architecture, §7 phases, §8 acceptance tests). Landing page `final-deploy/index.html` untouched. No deploy, no APK (both still stopped until the rebuild is verified live).

### Phase 0 — FOUNDATION.md frozen

`~/workspace/editora-pro/FOUNDATION.md` (14 KB) freezes: non-negotiable product rules (free, no ads, no subscription, no watermark, no login, no AI; APK is the product, web is host/download only); 8-section page map (Home, Video Editor, Photo Editor, Projects, Media Library, Templates & Assets, Export Center, Settings); design tokens (font scale, spacing `--sp-1..6`, radii, button heights 26/32/40 px, icon sizes 16/20/24, sidebar 212 px, tool panel 300 px, inspector 290 px, bottom nav 56 px); dark theme tokens + light theme tokens (single blue/cyan accent `#00c8d7` dark / `#0891b2` light; semantic ok `#22c55e`, warn `#f59e0b`, err `#f43f5e`); breakpoints ≤900 px mobile / 901–1280 compact / >1280 full desktop; versioned JSON project format v1 (records without `formatVersion` = v1; `formatVersion > 1` refused with a clear message); backup/restore shapes; media formats with honest limits (photo export JPG/PNG/WebP, no TIFF; video MP4 H.264 via FFmpeg else Canvas/MediaRecorder, H.265 only if a runtime test proves it, min-size failure guard `max(4 KB, duration × 2 KB/s)`); §8 acceptance-test checklist; module map. Placeholder removal decisions: photo text default `"Your text"` → empty input (fallback `"Text"` only if added empty); video text default `"Hello Editora!"` → empty input; collage quadrants → empty transparent layers named "Photo 1..4", no drawn art.

### Phase 1 — what was built

- **Navigation (§2):** desktop persistent left sidebar (icon + label, active = accent fill) in every screen view; mobile compact bottom nav (`#mobileNav`, 7 screen buttons) + photo bottom nav (Home / Tools / Layers / Adjust / Export); `Back to Home` button on every screen header; `Home → Open Project` button.
- **Panel system:** desktop resizable grips (sidebar 220–480 px, inspector 220–440 px, widths persisted in `localStorage["editora-panel-widths"]`), collapse buttons (`hide-left`/`hide-right`), mobile Panels toggle; photo right-panel drawers from the bottom nav.
- **Icons — every emoji tool icon replaced** with inline SVG (Lucide-style, one family) + text label where space allows + tooltip + accessible label. Counts: `index.html` **162** `data-ic` spans, `photo.html` **69**, `app.js` **76** `epIcon()`/`epSetIcon()` call sites, `photo.js` **5**. Shared registry `app/icons.js` (173 lines, **126 icons**, 105 used, 21 reserved for later phases; unknown name falls back to `help-circle` + console.warn). Emoji audit after the change: **0 non-sticker emoji** in `app.js`, `photo.js`, `index.html`, `photo.html`. The only emoji left are the two sticker-emoji arrays in `app.js` (`emojis`, `ASSET_EMOJIS`, 16 each) — user content (stickers the user adds), explicitly allowed.
- **Modules (`app/modules/`, classic scripts, load order icons → modules → editor):** `history.js` — `window.EPHistory`, dual modes (`post` = video semantics, `pre` = photo checkpoint semantics), cap, lock during restore; `project-store.js` — `FORMAT_VERSION=1`, `stampVideo/stampPhoto`, `validate` (refuses future versions), `makeVideoBackup/makePhotoBackup`; `tokens.js` — `window.EPTokens`; `README.md` — module conventions.
- **History refactor (no behaviour change):** `app.js` uses `EPHistory` post mode (limit 60, same seed-once-in-`init()` quirk preserved); `photo.js` uses pre mode (limit 25, same 51 `pushUndo()` call sites). Backup import accepts both new (`manifest`/`media`) and old (`mediaManifest`/`mediaData`) keys and refuses `formatVersion`/`version > 1`.
- **Themes:** single accent enforced (`photo.css --accent2` purple `#7c3aed` → cyan `#0ea5b7`); full light-theme block for photo; theme toggles in both editors (video persists via settings, photo via `localStorage["editora-photo-theme"]`).
- **"Coming Later": nothing.** All 8 sections are built and reachable; the `.coming-later` class + badge exist for later phases to use when a destination is not yet built — no dead links, no empty screens in this phase.

### Job 0 fixes — verified NOT regressed

`[hidden]{display:none!important}` is still the first rule in `app.css` (line 5, after the P0 comment) and present in `photo.css`; single-modal helpers `openModal()`/`closeModal()`/`closeAllModals()` + Escape + backdrop close intact (harness: zero modals on load, opening a second modal closes the first). Timeline clip selection via pointerup, FFmpeg same-origin wrapper, canvas export min-size guard, and footer import counter were not touched by this phase's edits (their code paths are unchanged; the zip check below re-verifies the wrapper files ship).

### Verification (this phase)

- `node --check` PASS on all 6 JS files: `icons.js`, `modules/history.js`, `modules/project-store.js`, `modules/tokens.js`, `app.js` (5,589 lines), `photo.js` (2,607 lines). `index.html` 871 lines, `photo.html` 401 lines.
- **jsdom harness `~/workspace/editora-pro/verify/harness.js`: 86 passed, 0 failed** (run twice, stable). Covers: no script errors on load; icons hydrated (every `[data-ic]` → SVG); zero modals on load; single-modal + Escape; all 8 screens reachable + Back to Home; mobile nav present + its Projects button navigates; theme toggle both editors (+ photo persistence); panel grips/collapse/Panels toggle; EPHistory undo/redo round-trips via real DOM edits (video text clip add → undo → redo; photo text layer add → undo → redo); project-store stamp/validate (refuses future versions); storage meter; toolbar tabs; toast; photo empty state + actions; 32 photo tools with icons/labels/tooltips; bottom-nav drawers; undo-on-empty-stack toast.
- **Static audit `~/workspace/editora-pro/verify/audit.py`: 0 failures.** `index.html` 485 ids / `photo.html` 296 ids, 0 duplicates; all 424 `app.js` + 197 `photo.js` id references resolve; every id'd control wired, data-driven, or intentionally disabled with a reason (`btnVoskCap`); every icon-only button has `title`/`aria-label`; all 105 used icon names exist in the registry; no placeholder/demo content; no external URLs / `window.open` in code (only the FFmpeg CDN fallback).
- **Deploy zip rebuilt:** `editora-pro-deploy.zip` (235,522 bytes, 30 files). `unzip -l` verified: `app/vendor/ffmpeg-core.wasm` **absent (0 entries)**; wrapper files present (`ffmpeg/entry.js`, `ffmpeg/worker.js`, `ffmpeg-core.js`, `util/util.js`); new `icons.js` + `modules/` present; landing `index.html` at zip root.
- Harness setup: `verify/README.md` documents the run (`npm install jsdom @napi-rs/canvas canvas`, `node harness.js`, `python3 audit.py`).

### Honest limits (Phase 0+1)

- **No live-browser run yet** — the harness is jsdom only (needs `@napi-rs/canvas` for `getContext`; `window.Image` shimmed with `@napi-rs/canvas`'s `Image` because jsdom 31 never fires `Image.onload` for data URLs, which photo `restoreSnap` awaits — in a real browser this fires immediately; the shim is harness-only, app code untouched). jsdom has no layout engine, so **CSS media queries (mobile bottom nav, panel collapse visuals) cannot be verified here** — they need the parent's live-browser test (§9). First-edit undo quirk preserved as-is (video seeds history once in `init()`). Photo light theme recolors the main surfaces; some hardcoded dark values may remain in minor spots. Panel resize/collapse is desktop-only; mobile uses the Panels toggle + drawers.

---

## P0 fix — first-load modal stack (parent's live-browser finding)

**Symptom:** on first load, Settings/Shortcuts/Transcript/Export/Projects/
Templates modals stacked open, Close buttons dead to every input, editor
unreachable by mouse.
**Root cause (verified in code):** `app.css` `.modal{display:flex}` overrode
the UA stylesheet's `[hidden]{display:none}`.
**Fix:** `[hidden]{display:none!important}` as the first rule in `app.css`;
`openModal()`/`closeModal()`/`closeAllModals()` helpers (one modal at a
time), Escape + backdrop close, modals open only from click handlers, and
the load-time "Saved project found" toast removed (projects surface only on
the dashboard). **Coordinator re-verified 2026-11-12 ~07:40 IST:** the rule
is still line 5 of `app.css`; all modals carry `hidden`; no JS opens a modal
on load.

## Stages 1–5 — rebuild (pre-blueprint, live-tested then)

- **Stage 1:** Home Dashboard (VIDEO/PHOTO cards, Recent Projects from
  IndexedDB with media blobs), CapCut-style editor, import with real
  thumbnails, 5-track timeline (V1/V2/Text/A1/A2).
- **Stage 2:** Trim/Split/Cut/Merge/Delete/Duplicate, Crop/Rotate, per-clip
  Speed 0.25–2×, Reverse flag (true reverse via FFmpeg), Freeze frame,
  Undo/Redo. Export: FFmpeg.wasm (real MP4 libx264+AAC) + canvas/
  MediaRecorder fallback, 480p–4K, 24–60 FPS, progress + cancel.
- **Stage 3:** Transitions/effects/text/captions/audio; caption panel (not a
  modal) with manual captions, SRT/VTT import/export, karaoke, browser
  SpeechRecognition labelled honestly (not AI); waveform from decoded peaks;
  bass/treble as a real Web Audio EQ.
- **Stage 4 (photo):** standalone canvas editor — layers, masks, brush/
  eraser, rect+lasso select, clone stamp, feathered healing (labelled),
  text/shapes, 12 filters, adjustments, undo/redo, IndexedDB autosave,
  JPG/PNG/WebP export.
- **Stage 5 (coordinator check):** independent id audit + flow traces; zip
  rebuilt.

## Job 0 fixes — live-test showstoppers (2026-11-12, from the parent's desktop-Chrome smoke test 07:10–07:15 IST)

### (a) Timeline clips could not be selected — FIXED (root cause found in code)

**Symptom:** clicking a clip (single/double, label/body/right end, native
pointer, small drag, Select tool) never selected it; right panel stayed on
"Select a clip on the timeline to edit its properties here"; every
"Apply to selected clip" answered "Select a video clip first".
**Root cause — two independent kills, both in `app.js`:**
1. `startClipDrag()` called `e.preventDefault()` on `pointerdown`.
   Cancelling `pointerdown` suppresses the compatibility mouse events in
   Chrome, so the clip's `click` listener (which calls `selectClip`)
   NEVER fired — mouse and touch alike.
2. Even if it had fired, the `pointerup` handler called
   `renderTimeline()`, which does `trackEl.innerHTML=""` and re-creates
   every clip node — the node under the pointer was destroyed before any
   click could dispatch to it. The `pointermove` handler did the same
   thing mid-drag, so even a small drag killed the gesture.
**Fix (`app.js`, `app.css`):** no `preventDefault`/`stopPropagation` on
`pointerdown` (CSS `touch-action:none` + existing `user-select:none` on
`.clip` handle scrolling/selection instead); a drag only starts after
>4 px of movement; while dragging, only the dragged node's
`style.left`/`style.width` are updated in place — never a full
re-render, so the pointer target survives; on `pointerup` a tap selects
the clip directly and a drag selects it after the move (plus a
`pointercancel` listener and `setPointerCapture`). The `click` listener
stays only as a fallback. A `_clipTapAt` guard stops the `tlScroll`
click handler from seeking the playhead on the click that follows a clip
tap (after the re-render its target is the track, not a clip). Locked
tracks still block dragging but no longer block selection.
**Minor footer bug from the same test:** the toast read "0 file(s)
imported — saved" while sample.mp4 was in the gallery. Root cause:
`addFiles()` passed the file input's *live* `FileList` into the async
save-then-toast, but the change handler clears the input
(`e.target.value=""`) right after the call — clearing the input empties
that same live `FileList`, so the count read later was 0. Fix: `addFiles`
snapshots `[...files]` synchronously and toasts the snapshot's length;
empty input now toasts "No file chosen" instead of "0 file(s)". Also
fixed in passing: a drop on the drop zone bubbled to the document-level
drop handler, importing the same files twice (duplicate gallery entries
+ double toast) — the zone handler now stops propagation.
**Verification:** `node --check` PASS; Node VM harness loading the real
`app.js` with DOM stubs — tap with NO click event dispatched selects the
clip (`S.selClip`, properties panel opens), a 60 px drag moves the clip
(start 0 → 0.6) and keeps it selected. 8/8 harness checks PASS
(harness kept at `/tmp/job0_harness.js`, ephemeral).

### (b) Export produced an empty file + FFmpeg never loaded — FIXED

**Symptom:** export (720p/30fps/MP4/H.264/5Mbps, Engine Auto) reported
"Done — 0.0 MB, MP4 (H.264/AAC), 150 frames @ 30 fps" but the file was
4.9 KB, ffprobe duration 0.03 s. In-app FFmpeg error: "Failed to
construct 'Worker': Script at
'https://esm.sh/@ffmpeg/ffmpeg@0.12.15/es2022/worker.js' cannot be
accessed from origin 'https://editora-pro.pages.dev'."
**Fix 1 — same-origin wrapper (`deploy.py`, `app.js` `loadFFmpeg()`):**
`deploy.py` used to exclude the whole `app/vendor/` from the web deploy,
so the wrapper import 404'd and the loader fell back to esm.sh — and the
wrapper builds its worker as `new Worker(new URL("./worker.js",
import.meta.url), {type:"module"})` (verified by reading
`vendor/ffmpeg/ffmpeg.js`), i.e. the worker URL is resolved against the
*wrapper's* URL, so an esm.sh wrapper means a cross-origin worker and
Chrome refuses to construct it. The web deploy now ships the small
wrapper files (`entry.js`, `worker.js`, `ffmpeg.js`,
`dist/esm/*.js`, `util/util.js`) and `ffmpeg-core.js` (110 KB) and
excludes ONLY `app/vendor/ffmpeg-core.wasm` (31 MB > Pages 25 MiB
limit); `deploy.py`'s staging asserts the wasm is out and the wrappers
are in. `loadFFmpeg()` now resolves the core JS and the wasm
independently with `res.ok` checks (plain `toBlobURL()` never throws on
a 404 — it blobs the error page): core JS loads from the app on web,
the wasm falls back to the jsDelivr CDN on web (both local in the APK),
both passed to the worker as blob URLs; the worker loads the core via
dynamic `import()` (a module worker has no `importScripts` — verified in
`vendor/ffmpeg/worker.js`). The FFmpeg result now names the actual file
sources (`S.ffCoreSrc`: "app core + CDN wasm" / "app core + app wasm").
**Fix 2 — canvas fallback recorded ~0 frames (`doVideoExport()`):**
root cause: `canvas.captureStream(fps)` only delivers frames when the
compositor presents the canvas; a detached export canvas drawn from
`setTimeout` is not reliably presented, so the recorder received
essentially one frame while the code reported "150 frames". Fix:
`captureStream(0)` + an explicit `track.requestFrame()` after every
drawn frame — exactly one requested frame per drawn frame, independent
of the compositor, rAF, or tab visibility (browsers without
`requestFrame` fall back to the old fps-paced capture). **Guard:** if
the recorded blob is below `max(4 KB, duration × 2 KB/s)` (≈10 KB for a
5 s clip) the export now reports FAILURE with the reason, records a
Failed entry in history, and offers no download link — never "Done —
0.0 MB". The same floor is applied to the FFmpeg path (a tiny encode
returns false so the caller falls back to Canvas and says so, instead
of offering a broken file); the generic fallback note no longer
overwrites a specific reason set by the FFmpeg path.
**Fix 3 — honest result text:** unchanged in shape (already named the
engine + real codec/extension); now also names the FFmpeg file sources
and the failure guard names the engine that actually failed.
**Verification:** `node --check` PASS on `app.js`/`photo.js`; the same
VM harness drove the real `doVideoExport()` with a stub MediaRecorder:
empty recording (10 bytes) → returns `false`, status "Export failed:
Canvas export recorded only 0.0 KB …", no download link; healthy
recording → returns `true`, "Done — 0.2 MB, MP4 (H.264/AAC), 11 frames
@ 10 fps", download link present, and `requestFrame` was called exactly
once per drawn frame (11/11). `deploy.py` staging run verified:
`.web-deploy` (784 KB) has all 9 small vendor files, wasm absent.
`editora-pro-deploy.zip` rebuilt: 24 files, 758 KB (was 33 MB), files at
zip root, `app/vendor/ffmpeg-core.wasm` ABSENT, all wrapper JS files +
`ffmpeg-core.js` PRESENT (verified with `unzip -l`). The wasm stays on
disk in `final-deploy/app/vendor/` for the APK build. NOT deployed.
**Remaining limits / what the parent must live-test in a real browser
before announcing:** (1) import sample.mp4 → click the timeline clip →
properties panel must open (mouse AND touch tap); drag the clip, trim a
handle, then Split/Merge/Delete on the selected clip; (2) export Engine
Auto 720p → the Video Engine must now load (no Worker error in the
console/status) and the downloaded MP4 must be ~MB-sized with the full
duration in ffprobe; (3) export Engine Canvas → same duration check;
(4) confirm the toast reads "1 file(s) imported — saved". The harness
proves the logic with stubs; only a real Chrome run proves the worker
constructs and the recorder receives frames on the live origin.

## 4 fixes (2026-11-12, from the parent's live smoke tests)

1. Photo had no click-to-browse import (only drag-drop) → top-bar Open
   Image button + empty-state click + Ctrl+O.
2. "Drop image to open" stayed overlaid after load → hint now shows only
   for file drags + `dragend` handler hides it.
3. Autosave not instant (import lost on quick reload) → ~1 s debounce,
   save-before-toast in both editors, serialised video saves.
4. Export was VP9/Opus-in-MP4, 8.1 s for a 5 s clip → explicit `avc1`
   mime requests, extension from the real mime type, exact frame-count
   wall-clock render schedule; FFmpeg load errors now recorded + surfaced.

## Phase 1 — Navigation (§1, §2, §8)

Nav bar (Home/Video Editor/Projects/Media Library/Templates/Export Center/
Settings + Photo link) via `showScreen()`; old Projects/Templates/Settings
modals replaced by full screens. Home: Recently Exported (real history),
Storage meter (`navigator.storage.estimate()`) + Clear cache. Projects:
All/Video/Photo/Recent/Favorites/Drafts/Recovered + Open/Rename/Duplicate/
Delete/Backup/Favorite. Media Library: Videos/Photos/Audio/Imported/
Favorites/Recent/Custom Folders (full CRUD) + search/sort/thumbnails/
preview/drag-to-timeline. Templates: 6 video + 4 title + 4 caption styles,
all applied for real. Export Center (basic): real export dialogs + history
(Completed/Failed). Settings: 12 sections, all real persisted controls.
Top toolbar: Save/Undo/Redo/Preview Quality (really caps preview render
size). Markers: M key + button, ruler flags, jump/delete, persisted.
**FFmpeg vendored:** `@ffmpeg/core` JS + 31 MB wasm + ESM modules in
`app/vendor/`; loader tries local first, CDN fallback.
Verification: `node --check` + vendor modules PASS; audit 292 ids, 0 dup,
171 controls wired; one flow traced per screen.

## Phase 2 — Cut & Edit (§3)

Audit fixed 5 real bugs: speed-blind Split/Cut trim points; drag-trim clamp
(999 → source length); Apply Trim ignoring speed; Duplicate overlapping the
next clip; Merge now refuses different-speed clips. NEW: Ripple delete
(same-track/all-tracks toggle, gaps preserved); Insert edit (shifts later
clips right, splits straddling clip, never overwrites); Replace edit (keeps
position/duration, trims replacement to fit); frame-by-frame with FPS
selector (24/25/30/50/60) + `HH:MM:SS:FF` timecode; numeric Duration
editing that really re-times (`setClipDuration`, clamped for media).
Verification: stub-DOM harness on the real `app.js` **35/35 PASS**; id audit
300 ids, 0 dup, 176 controls bound.

## Phase 3 — Transitions / Effects / Filters / Grading (§3)

**54 transitions** (all 5 blueprint groups) via one shared engine
`transCompute()` — duration/direction/speed/reverse/intensity/preview/
preset saving; legacy ids aliased. **54 effects, per clip** (`clip.fx`,
travels with split/duplicate/copy-paste); Canvas export = real pixel math
(`applyFxPixels`, `remapDistort`, real per-row Pixel Sort). **35 filters
(+ Normal)** as real color math, with thumbnails, intensity, hold-to-compare
before/after, apply/remove, custom presets, copy/paste. **22 grading
items, real:** 17 sliders, touch-draggable RGB Curves editor (per-channel),
HSL, 3 color wheels, color balance, `.cube` LUT import (trilinear +
intensity, FFmpeg `lut3d`), graded still-frame preview of exact
Canvas-export pixels. FFmpeg renders fade family + eq/hue + `curves` +
`lut3d`; skips listed by name in the export result.
Verification: harness **39/39 PASS** (transition math, curve LUT, `.cube`
parse, pixel math incl. curve lift to exactly 200, pixel sort, fisheye,
snapshot round-trip); id audit 351 ids, 0 dup, 207 controls wired.

## Phase 4 — Text / Captions / Audio / Keyframes / Speed (§3)

**Text:** 14 presets (Titles…Kinetic) via one `applyTextPreset()` (Text
panel + Templates screen), full controls; 14 animations through one
deterministic engine `textAnimState()` (preview = Canvas export). Fixed a
Phase 3 bug: `fadeIn`/`slideUp`/`popIn` keyframes were named but undefined.
**Captions:** multiple tracks (Main + Secondary + add-by-name); per-word
timings + word editor; split/merge; SRT/VTT import/export; **real ASS
export** (`\k` karaoke tags). **Vosk attempted, NOT shipped:** vosk-browser
needs a ~40 MB runtime download, no offline bundle — breaks the
offline-first APK rule; panel shows a disabled Vosk button with the reason;
working auto-captions remain honestly-labelled browser SpeechRecognition.
**Audio Studio:** clip split/merge/nudge/trim; pitch shift; reverse
(FFmpeg `areverse`, Canvas reverses buffer to WAV); peak normalization to
−1 dB; stereo/mono + pan; **18 real effects** (5-band EQ, bass, treble,
generated-impulse reverb, echo, delay, chorus, flanger, phaser, distortion,
compressor, limiter, gate, noise reduction) as a real Web Audio chain +
FFmpeg filter chain, 3 s effect preview; 10 synthesized SFX + 3 BGM tones
generated on-device to WAV (labelled built-in tones, no licensed music).
**Keyframes:** 21 presets writing real keyframes; lane under the timeline
(draggable dots, touch Pointer Events); per-keyframe Ease In/Out/In-Out;
Bezier editor; copy/paste/delete. **Speed:** speed ramp (source-time map),
time remapping, frame hold, motion blur (Canvas export). Optical flow
omitted (needs a frame-interpolation engine).
Verification: harness **61/61 PASS**; id audit 411 ids, 0 dup, 306 controls
wired (except intentionally-disabled Vosk button + 3 wheel sliders on a
dynamic bind loop). Harness caught + fixed a frame-hold resume bug and a
mid-phase deletion of 6 caption functions (restored, re-verified).

## Phase 5 — Photo expansion (§4)

Selections: Ellipse, Polygon Lasso (tap-to-place), Quick Selection
(region-grow), Color Range, Magic Wand; Feather/Expand/Contract/Invert work
with all types. Brushes: Pencil, Airbrush (Flow), Blur, Sharpen, Smudge,
Dodge, Burn, Sponge + Flow/Strength sliders. Layers: Groups
(collapse/expand/drag-into/move-as-unit), Merge Down, Flatten, Clipping
Masks, Adjustment Layers; **all 16 blend modes**. Adjustments: RGB Curves
editor, Levels, HSL, Color Balance, LUT `.cube` import + intensity.
Filters: +15 as real pixel math. Retouching: Spot Healing (feathered,
labelled), Red-eye tap, Skin tone, Teeth-whitening brush, Manual smoothing,
Local exposure, Selective color. Background: Refine Edges, delete/fill.
Transform: Perspective (4-corner quad), Free Transform. Design Studio:
real documents at exact sizes (YT thumb, IG post/story, FB cover/post, A4
poster, banner, logo, 2×2 collage, custom W×H, transparent bg), frames,
gradients/patterns. Status bar: zoom %, dimensions, zoom controls.
Verification: `node --check` PASS; id audit 290 ids, 0 dup, 190 controls
wired; DOM-stub harness **160/160**; real pixel tests **22/22** (curve LUTs,
HSL round-trip, `.cube` parse/reject, every filter changes pixels).

## Phase 6 — Extras / Templates & Assets / Export Center (§5, §6, §7)

**§5:** Split screen 2/3/4 (real composite preview + Canvas export cells;
FFmpeg lists as skipped); V2 PiP extended as a split-screen source; Chroma
key (colour picker by tapping the frame, tolerance + spill suppression;
Canvas keying over V2, FFmpeg `colorkey` to black, stated); Shape/Linear/
Radial masking (feathered, Canvas export); Proxy editing (auto 480p proxies
via vendored FFmpeg for videos ≥60 s or ≥100 MB; preview toggle; exports
always use originals); Audio ducking rebuilt (was a static 25% volume set —
now real time-based A2 dips under A1 voice in Canvas export); Markers
extended with colours + names; Freeze frame verified; **Frame export**
(current frame as PNG/JPG/WebP, grade/text/captions burned in + history);
**Batch export queue** (add jobs / queue 480p+720p+1080p, run in order,
per-job Done/Failed with reasons, pause/cancel); **Full project backup**
(one JSON + media manifest + small media embedded; restore reports missing
media); Custom presets (effect presets new, grade presets, transition
presets on Templates screen).
**§6:** Intro/Outro templates applying full treatments; transition/effect/
grade preset libraries; LUT library (names remembered, files re-imported —
stated honestly); Stickers, Shapes, Backgrounds (real 1920×1080 images made
on-device); SFX library; music labelled built-in synthesized tones only.
**§7:** Custom resolution (validated 16–4096) + custom bitrate (0.5–50
Mbps); H.264 default, H.265 offered only if a real support test proves it;
MP4/WebM; queue, frame-as-photo export, history with re-export + delete +
failure reasons.
Verification: harness **32/32 PASS**; id audit 480 ids, 0 dup, 293 controls
wired (except the 3 known pre-existing cases); flow traces in code.

## Phase 7 — Coordinator independent verification (2026-11-12 ~07:40 IST)

- `node --check final-deploy/app/app.js` — PASS. `node --check
  final-deploy/app/photo.js` — PASS.
- ID audit (own script): video `index.html` 480 ids, 0 duplicates; 267 JS
  `$()` refs, the only "missing" hits are `$$()` class/attribute selectors
  (`.modal`, `.panel`, `.tlk`, `.appnav [data-screen]`, `#splitCells
  [data-cell]`, etc.), all present. Photo `photo.html` 290 ids, 0
  duplicates; 194 JS refs, 0 missing.
- Forbidden scan on `final-deploy/app/`: no AdMob/AdSense/InMobi, no
  OpenAI/Gemini, no "Join Pro"/paywall — the only hits are comments stating
  "no AI/ads/paywall/watermark". No `window.open` in code (one comment
  mention only). No unexpected external URLs in JS.
- P0 fix intact (`app.css:5` `[hidden]{display:none!important}`).
- `app/vendor/` present: `ffmpeg-core.js` + 31 MB `ffmpeg-core.wasm`,
  `ffmpeg/dist/{entry,ffmpeg,worker}.js`, `util/util.js`.
- File sizes: `app.js` 5,399 lines, `index.html` 846 lines, `photo.js`
  2,589 lines, `photo.html` 389 lines. All six phase reports present
  (`PHASE1_REPORT.md` … `PHASE6_REPORT.md`).
- Deploy zip rebuilt: `editora-pro-deploy.zip` — files at zip root
  (verified with `unzip -l`), **including `app/vendor/`**. NOT deployed
  (parent deploys).

## Honest limitations — consolidated (everything omitted + why)

- **Multi-camera editing** — needs a synced multi-angle engine; omitted.
- **Optical flow** — needs a frame-interpolation engine; omitted.
- **Vosk offline speech recognition** — model needs a ~40 MB runtime
  download, no offline bundle; not shipped. Auto-captions = browser
  SpeechRecognition (mic, Chrome/Edge, hears the room not the video
  audio) + manual captions.
- **TIFF** — no browser/WebView encoder; photo export is JPG/PNG/WebP.
- **H.265** — offered only if a real support test proves it; otherwise
  omitted from the UI.
- **Content-aware healing / magnetic lasso** — need inpainting/edge engines;
  healing is a labelled feathered clone, lasso is freehand/polygon.
- **Warp (photo)** — omitted, not listed. **LUT files** (video + photo)
  are not saved with the project (name only — re-import after reopening).
- **FFmpeg export** renders V1 + audio only: V2 overlays, text/captions,
  slide/wipe/blur/spin transitions and glitch/grain/RGB/glow/vignette
  effects are listed as skipped per export; Canvas export covers them.
  FFmpeg renders only the fade family of transitions (concat-based
  exporter can't do `xfade`). True reverse only via FFmpeg.
- **Merge** is same-source adjacent clips only. **Curves/HSL/wheels/LUT**
  have a still-frame preview, not live-video. **Blur** is a 3×3 box-blur
  blend, not true Gaussian. **3D transitions** are 2D approximations.
- **4K/2K** render at the device/browser canvas maximum, fallback to 1080p
  with a note. **Blend mode** in the inspector is preview-only; export
  renders normal blend (UI says so).
- **Proxies and the export queue live in memory only** (gone on reload).
- **Photo:** adjustment layers affect everything below, not single layers;
  LUT in-memory only; transform preview shows a 55% ghost until Apply;
  per-pixel adjustments can lag near the 4000px cap; undo snapshots store
  full PNG dataURLs (max 25). Straighten must be applied before precise
  crop/selection work.
- **Projects** restore media only on the same device/browser (IndexedDB
  blobs). JSON backup restores the timeline, not the media files (full
  backup embeds small media only).
- **Canvas export** is real-time (~0.5× frame pacing); FFmpeg path needs
  network on first use unless the vendored core loads locally (now the
  default). If the device blocks the vendored load, Canvas is the working
  path and the export result says so.
- **Speech captions** need mic + Chrome/Edge; timing is phrase-level, not
  word-level, unless words are timed manually.

## APK-readiness — consolidated (product is the Android app, per user order)

- **One codebase:** `final-deploy/` is the app; the website is only the
  host/download page. No forked version.
- **Works in a WebView:** all editing is local (Canvas, Web Audio,
  IndexedDB, vendored FFmpeg); zero runtime CDN dependencies in `photo.*`;
  video uses vendored FFmpeg first with CDN fallback (flagged below).
  Touch-first: Pointer Events throughout (curve editor, wheels, keyframe
  lane, Bezier editor, clone long-press, polygon lasso taps); no
  keyboard-only paths; no `window.open`; no localhost-server assumptions.
- **Must be packaged:** `final-deploy/app/vendor/` (~31 MB: FFmpeg core
  JS + wasm + ESM modules) — the APK builder must include it in the
  packaged assets or FFmpeg features (true reverse, proxies, H.265 test,
  fast MP4 export) will fall back to CDN/canvas.
- **Needs Capacitor plugins (not in the web build):** Filesystem + Share
  for export-to-gallery / save-to-device and native Share sheet; native
  gallery picker for import (web file input works in WebView but the
  native picker is the proper app path); MediaLibrary/Filesystem for
  Recently Exported on-device.
- **CDN/offline gaps:** video FFmpeg loader still has a CDN fallback
  (esm.sh/jsDelivr) if the vendored core fails to load — in the APK the
  vendored copy should load; if it doesn't, export falls back to Canvas
  and says so. Vosk model download is NOT bundled (by design — see above).
- **Not yet proven:** no live run inside `capacitor://localhost` yet —
  vendored FFmpeg load + offline export in the APK, and the touch-only
  flows on a real Android phone, still need the parent's live test.

## §9 Required live tests (parent, before announcing)

Desktop Chrome + one Android phone (touch-only for the new controls):
1. First load `/app/` — dashboard, zero modals, Close never needed.
2. Video: import → + Timeline → Split → Merge → Ripple delete → Insert →
   Replace → caption + ASS export → Export 720p (FFmpeg engine: H.264 MP4,
   correct duration) → Export Canvas engine (correct duration + extension).
3. Transitions/effects/filters/grading: apply a Zoom transition, a glitch
   effect, a Teal & Orange filter, drag a curve point + import a `.cube`
   LUT → preview changes; export and confirm.
4. Text/captions/audio: typewriter text in preview + Canvas export; second
   caption track; audio pitch/reverse/normalize + one effect preview;
   keyframe lane drag + speed ramp.
5. Photo: Open button import → brush → lasso delete → mask paint → clone
   (long-press) → Curves edit → export PNG with transparency.
6. Export Center: queue 480p+720p+1080p batch → all complete with history;
   frame export; project backup + restore.
7. Reload within 2 s of an import — media + timeline must be back.
8. Android phone, touch only: import from gallery, drag a clip, drag a
   curve point, add a caption, export — all without a keyboard.

## Phase 7 — Coordinator final verification (2026-11-12 ~03:10 IST)

Coordinator (not the phase builders) re-ran every harness and audit itself, fixed two stale test expectations, and rebuilt the zip. **No live-browser/WebView run has been done on this final build in any phase** — §9 above is still the parent's job before announcing.

- `node --check` PASS: app.js (5,959 lines), photo.js (3,150 lines), icons.js, all modules.
- `verify/harness.js` (main): **87 passed, 0 failed** — was 84/86; the 2 failures were stale expectations, fixed in the test (not the app) with reasons: (1) "32 tool buttons" → 35 (11 canonical tools + flyout variants after the Phase 2+3 redesign); (2) "Layers drawer button toggles drawer" → `btnDrawerLayers` is "Show layers panel" (`openRight`), it opens, never toggles — the test now asserts it shows the Layers tab and that `btnCloseRight` closes the drawer. Both verified against photo.js (`openRight` only adds "open"; close is `btnCloseRight` / `btnNavTools`).
- `verify/photo_phase23_harness.js`: **89 passed, 0 failed** (real pixels via node-canvas).
- `verify/phase6_harness.js`: **61 passed, 0 failed**.
- `verify/audit.py`: **0 failures** (ids, refs, wiring, icons, no placeholder/demo content, no `window.open`, no unexpected external URLs — only the FFmpeg CDN fallback).
- `editora-pro-deploy.zip` rebuilt by the coordinator from the web-deploy staging: **30 files at zip root, 255 KB**; `app/vendor/ffmpeg-core.wasm` **absent** (Pages 25 MiB limit); small vendored @ffmpeg ESM wrapper files present (`ffmpeg/entry.js`, `worker.js`, `ffmpeg-core.js`, `util/util.js`); `icons.js` + `modules/` present. (First rebuild attempt by the coordinator was wrong — nested under `final-deploy/` and included the wasm — caught by `unzip -l`, discarded, rebuilt correctly.)
- Job 0 fixes re-verified intact in the final code: `[hidden]{display:none!important}` first in both CSS files; pointerup clip selection; FFmpeg loader with `ffCoreSrc` tracking; canvas export `requestFrame` path + minimum-size failure guard; import counter snapshot.

### §8 acceptance-test results (code/harness level)
- Photo empty state clean; import shows correct image at fit zoom; crop/rotate/resize change doc + undo/redo; text layer editable; layers add/hide/reorder/delete change composition; save/close/reopen/recover without losing layers/settings; export creates a real file + honest failures — all covered by the photo harness (89/89) + audit.
- Video import plays; timeline trim/split/move change playback; fade-family transition cross-dissolves across two adjacent clips in preview + Canvas export (212 `drawCover` calls in a 4 s export, first clip drawn as late as 2969 ms); filter/effect changes preview AND export (engine-level wiring verified; per-item live verification still needed) — covered by the video harness (80/80) + main harness.
- Mobile controls readable/tappable, don't cover canvas/timeline — covered by harness layout checks; real-device touch still needs the parent's live test.
- No control presented as functional without an implemented action — audit 0 failures; only "Coming Later" item in the whole UI is Rotate View (photo View menu).

### Consolidated Coming Later / honest limitations
- Rotate View (photo) — Coming Later, disabled. Vosk offline captions — not shipped (would need a ~40 MB model download, breaks offline-first APK rule; browser SpeechRecognition stays, honestly labelled). Optical flow, multi-camera, TIFF export — omitted with reasons. FFmpeg export is V1+audio only (V2/text/captions/some effects listed as skipped per export; Canvas covers them); LUT files stored by name only (re-import the `.cube`); queue jobs store settings, not a project snapshot; photo exports join history but have no queue; recovery history covers video projects only; A1/A2 audio silent in preview (sound in exports); adjustment layers affect all layers below; LUT in-memory only; undo = full PNG snapshots, cap 25.
- APK-readiness: one codebase; website is host/download only; touch-first (Pointer Events, no keyboard-only paths); offline-first (photo zero CDN deps; video vendored FFmpeg first, CDN fallback). APK builder must package `final-deploy/app/vendor/` (~31 MB wasm) or FFmpeg features fall back to CDN/canvas. Needs Capacitor plugins (not in web build): Filesystem + Share, native gallery picker, MediaLibrary for on-device Recently Exported. Proxies + export queue live in memory only (gone on reload). No live run inside `capacitor://localhost` yet.

### Parent must live-test (in addition to §9)
- Job 0 re-test on the live origin: click a timeline clip (mouse AND touch tap) → properties open; drag/trim/Split/Merge/Delete on the selected clip; Export Engine Auto 720p → Video Engine loads with no Worker error, MP4 is MB-sized with full duration in ffprobe; Export Engine Canvas → same duration/size check; toast reads "N file(s) imported — saved".
- Then deploy the rebuilt zip and build the APK from this verified build.

## Job 1 — Export fix (2026-11-12, parent's live test 08:43 IST on the blueprint build)

Two showstoppers from the parent's live test of the blueprint build
(clips could not be selected — already FIXED in Job 0 and verified live;
this job is the remaining export failure only). Clip selection was NOT
touched. Landing page NOT touched. NOT deployed.

### (1) FFmpeg never loads on the web build — FIXED (root cause verified)

**Symptom:** in-app error `RuntimeError: Aborted(CompileError:
WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44
4f @+0)` — `3c 21 44 4f` is `<!DO`, i.e. HTML.
**Root cause (parent verified with curl):**
`https://editora-pro.pages.dev/app/vendor/ffmpeg-core.wasm` returns HTTP
200 with 15,733 bytes of HTML — Cloudflare Pages' SPA fallback for the
excluded file (the 31 MB wasm is NOT in the web deploy, Pages 25 MiB
limit). The landing `index.html` is exactly 15,733 bytes, confirming the
fallback serves it for missing paths. The loader's old `blobFrom()` only
checked `res.ok`, so the HTML "loaded" as the wasm and `ff.load()` died
with the magic-word error, with no fallback to the CDN. The jsDelivr CDN
file is fine (32,232,419 bytes, `application/wasm`).
**Fix (`app.js` `loadFFmpeg`, `fetchEngineFile` replaces `blobFrom`):**
every engine file is validated BEFORE use — `res.ok`, content-type must
not be `text/html`, `.wasm` must start with the `00 61 73 6d` magic bytes
(first 4 bytes checked), `core.js` must not start with `<` (after
whitespace). On ANY validation failure for the local file, that file
falls back to the jsDelivr CDN URL — an HTML response is never accepted
as an engine file, and the failure reason is recorded. Core JS and wasm
resolve independently (local core.js is shipped; wasm is CDN on web,
local in the APK). The export result already names the actual sources
(`S.ffCoreSrc`: "app core + CDN wasm" / "app core + app wasm"); a total
load failure still records `S.ffError` and the export falls back to
Canvas with the reason stated.
**Verification:** `node --check` PASS; the validation logic was run in
Node against the real files — the on-disk wasm (32,232,419 bytes) passes
the magic check, an HTML page fails it (→ CDN fallback), real `core.js`
passes the JS check, HTML fails it.

### (2) Canvas fallback recorded a BAD video — FIXED (root cause traced)

**Symptom (parent ffprobe of the live Canvas export):** 75 KB total,
duration 4.53 s (expected 5.0 s), video stream only 7 kb/s at 4.85 fps
(expected 30 fps / ~5 Mbps), audio Opus 125 kb/s.
**Root cause:** the render loop seeked the video element once per frame
and drew immediately — but setting `currentTime` is async, so every draw
used the STALE frame from the previous seek. The recorder got the same
picture ~150 times (tiny bitrate, ~5 fps of distinct frames) while the
code claimed "150 frames".
**Fix (`app.js` `doVideoExport`, full loop rewrite):** the export now
plays the media in REAL TIME like the preview does. `ensureExportMedia(t)`
switches the video element once per clip (seek once + play) and corrects
drift only when it exceeds 0.35 s; `ensureOverlayVideo(t)` does the same
for the V2 overlay; split-screen cells play continuously with drift
correction >0.4 s instead of seeking per frame; the cross-dissolve
underlay is a `prevSnap` canvas snapshot of the outgoing clip's last
frame taken at the clip switch (the old code seeked v2Video to
trimOut−0.04 on EVERY frame); chroma-key background and PiP draw the
continuously playing v2Video directly. A setTimeout-driven loop (not
rAF — rAF stops when the tab is hidden and would stall the export)
draws one frame per fps slot against the recorder clock
(`t0` at `rec.start()`); `requestFrame()` runs AFTER each draw completes
so the captured frame is the new one, and a `drawing` guard prevents
overlapping draws (a slow draw skips slots, which the validation below
catches honestly). Pre-roll: the first clip's media is loaded and its
first frame awaited BEFORE `rec.start()`, so the export does not open
with black frames. The dead per-frame seek helper `seekEl` was removed.
**Post-export validation (new):** the file is read back — real duration
via a temp video element (`probeBlobDuration`, 6 s timeout) must be
within 0.3 s of the timeline, and the effective frame rate (frames
actually requested ÷ timeline seconds) must be ≥80% of the requested
FPS. If either fails, the export reports FAILURE with the exact reason,
records a Failed history entry, and offers no download link — never
"Done" on a bad file. The size floor (`max(4 KB, duration × 2 KB/s)`)
still applies first. The success status now states the ACTUAL duration
and effective fps, not just the expected values. **Progress bar:** set
to 100% on completion (`setProg(100)` after `await done`) — the old
99% stick came from progress being set inside `drawFrame` from
`t/total` (last frame `t=(totalFrames−1)/fps`).

### (3) Three nits from the same live test — all fixed

**(a) History tab tooltip "undefined minutes":** the literal string
"minutes"/"minute" does NOT exist anywhere in the shipped JS/HTML
(grep over `final-deploy/app/`, `index.html`, `app/modules/`);
the History tab tooltip in `app/photo.html:264` is literally
"History — named actions, click to jump back"; history items in
`photo.js` `renderHistory()` use `e.at.toLocaleTimeString()` and titles
"Jump back to the state before: "+name / "Redo: "+name. The literal bug
is NOT reproducible from current code — possibly the deployed build at
test time predated a fix, or the tooltip came from another element.
Hardened anyway (`photo.js` `safeHistTime`): `e.at` is coerced with
`new Date()` (a string `at` from a restored entry used to throw and kill
the whole history list) and `e.name` falls back to "Edit", so no history
tooltip can ever contain `undefined`. **Live re-test must confirm the
tooltip text.**
**(b) Split leaves a stale Duration field:** root cause traced —
`splitClipAt` mutates `clip.duration`/`trimOut` but `splitAtPlayhead`
only called `updateDuration(); renderTimeline(); pushHistory();` and
never re-selected; `selectClip` is what fills `$("clipDur")`. Fix: after
split (and the same staleness in `cutSelected`/`mergeSelected`), if the
edited clip is selected, re-call `selectClip(c, c.track||"v1")`.
**(c) Footer "0 file(s) imported" while media is present:** verified
FIXED in code — `addFiles` already snapshots `[...files]`
synchronously (the Job 0 live-FileList fix) and the toast uses the
snapshot; single `fileInput` change binding; `init()` registered once.
Hardened further: the count is now captured once in a `const n` and
both toasts use `n`, so no mutation can ever make it read 0. The
deployed build at test time may have predated the Job 0 fix. **Live
re-test must confirm the toast reads "1 file(s) imported — saved".**

### Verification (Job 1)

- `node --check` PASS on `app.js` (6,290 lines) and `photo.js` (3,192 lines).
- Loader validation logic executed in Node against the real engine files
  (see (1) above).
- Code trace: `drawFrame` is pure on its `t` parameter (no `S.curTime` /
  `seek()` reference inside), so the real-time loop cannot desync it;
  `seekEl` has zero remaining call sites (definition removed); all helpers
  used by the new loop (`ensureExportMedia`, `ensureOverlayVideo`,
  `prevSnap`, `probeBlobDuration`, `setProg`, `framesRequested`) verified
  defined and referenced consistently.
- **No live-browser run yet** — the harness-level checks above prove the
  logic; only a real Chrome run proves the worker constructs and the
  recorder receives true 30 fps frames on the live origin.
- Deploy zip rebuilt: `editora-pro-deploy.zip` — **30 files, 264,115
  bytes, files at zip root** (verified with `unzip -l`),
  `app/vendor/ffmpeg-core.wasm` **ABSENT**, all wrapper JS files +
  `ffmpeg-core.js` PRESENT. NOT deployed.

### Live re-test checklist (parent, before announcing)

1. Export Engine Auto 720p/30fps, 5 s clip → Video Engine loads with no
   Worker/magic-word error; result names the sources ("app core + CDN
   wasm"); downloaded MP4 is MB-sized H.264/AAC, 5.0 s duration at
   30 fps in ffprobe.
2. Export Engine Canvas, same clip → same duration/fps/size checks;
   progress bar reaches 100% and status shows the ACTUAL duration and
   effective fps.
3. Import sample.mp4 → toast reads "1 file(s) imported — saved".
4. Split a clip → the Duration field updates immediately without
   re-clicking. Cut and Merge → same.
5. Photo editor: make an edit, hover a History item → tooltip shows the
   action name and a real time, never "undefined".

---

## Job 2 — Effects fill (2026-11-12)

**Order:** "Sara effect or jo jo sab khali hai usse fill karo — sab jo jo video main effect ya etc jo jo khali hai wo fill karo."
**Scope:** every entry in TRANSITIONS, EFFECT_GROUPS, FILTERS, photo FILTER_PRESETS,
TEXT_ANIMS, AUDIO_FX_DEFS, and the 22 color-grading items — plus every
Effects/Filters/Transitions/Color/Audio panel section and the one known
Coming Later (photo Rotate View). Backups of the pre-Job-2 files:
`backups-job2/app.js.pre-job2`, `backups-job2/photo.js.pre-job2` (outside
`final-deploy`, never shipped). Job 1 (export fix) code was not touched —
verified by diffing against those backups: zero changed lines mention any
Job 1 identifier (`loadFFmpeg`, `doVideoExport`, `ensureExportMedia`,
`prevSnap`, `splitAtPlayhead`, `cutSelected`, `mergeSelected`, etc.).

**Result: 0 items removed. Every listed item now visibly changes pixels/audio
in at least the preview and the Canvas export, and differs from its nearest
sibling.** Nothing was faked by renaming a copy: each fix is different math,
different pixels, or a different audio node/filter (verified by the pixel
harness below).

**Counts audited:** transitions 54 · clip effects 54 · video filters 35 ·
photo filters 27 · text anims 14 · audio FX 18 · grading items 22 = **224 items**.
**Khali found and fixed: 38** (see "What was khali" per table). **Removed: 0.**

**Verification:** new harness `verify/effects_audit_harness.js` (jsdom +
node-canvas, loads the REAL app.js/photo.js) — **315 checks, 0 failures**.
It applies every effect/filter to a real test frame and requires pixels to
change vs unfiltered AND differ from the nearest sibling (mean abs channel
diff > 0.5, or > 20 changed pixels for sparse effects); transitions are
compared via `transCompute` output; text anims via `textAnimState`; audio
via the Web Audio node signature + the FFmpeg filter string.
Regression: `verify/harness.js` 87 passed / 0 failed; `verify/audit.py`
FAILURES: 0; `verify/photo_phase23_harness.js` 89 passed / 0 failed;
`verify/phase6_harness.js` 61 passed / 0 failed. `node --check app.js photo.js`
passes after every batch.

### What was khali, and what each fix does

**Transitions (11 fixes).** (a) fade/dissolve/crossdissolve/filmdissolve were
one identical opacity ramp: fade stays plain opacity; dissolve adds a melting
blur; crossdissolve adds a settle-zoom; filmdissolve adds a warm orange wash
+ blur. FFmpeg still maps all four to the fade filter (documented engine
limit, honestly listed as skipped for the rest). (b) circlewipe vs
circlereveal were the same centre circle: wipe grows from the centre, reveal
grows from the top-left corner (new `cx`/`cy` on the clip shape, honoured in
preview + Canvas export). (c) liquid vs inkspread were identical: liquid
keeps zoom+blur+circle; inkspread is a dark ink wash + stronger blur, no
zoom. (d) maskreveal vs rectreveal were near-identical: maskreveal now adds
fade + blur on top of the rect wipe. (e) rgbglitch/digitalglitch/pixelglitch/
signalerror all ran the same digital-glitch pass in Canvas export: each now
maps to its own pixel effect (RGB split / band shift / pixelate / channel
corruption) and the preview overlay draws each differently. (f) slide/push
ids ignored their own direction — the panel default "left" always won, so
Slide Right slid left: the Direction dropdown now defaults to "Auto (from
transition)" and each directional id carries its own direction; an explicit
panel direction still overrides it. (g) zoomin/zoomout labels were swapped
AND zoomout ended at 1.5x scale, popping back to 1.0 when the transition
ended: zoomin now grows 0.5→1.0, zoomout shrinks 1.5→1.0; both settle at 1.0.

**Clip effects (26 fixes).** (a) All 6 blurs were one 3×3 box blur: gauss =
3×3 box, lens = wider 5×5 box, zoom = samples along the radial line,
radial = samples along the arc (rotational smear), directional = horizontal
5-tap, motion = diagonal 5-tap. (b) rgbShift was rgbSplit renamed: it now
also boosts saturation +30%. (c) digitalGlitch/pixelGlitch/signalError were
one band-shift branch: digital = band shift, pixel = whole 8×8 blocks shift,
signal = R/B channel swap in seeded bands + brightness jitter. (d) vhsDist/
vhs/crt/oldtv were one branch: vhsDist = chromatic shift + scanlines,
vhs = row tracking-noise jitter, crt = strong scanlines + edge darkening +
green tint, oldtv = desaturation + scanlines + slow flicker. (e) analogNoise
vs filmGrain: analog = per-pixel noise, film = one noise value per 4×4 block.
(f) glow vs bloom: glow lifts highlights > 0.55; bloom uses a lower threshold,
stronger lift + neighbour bleed. (g) dust vs scratches: dust = per-pixel
specks, scratches = vertical hairlines seeded per column. (h) fog vs smoke
were the same bottom gradient (preview + export): fog keeps the gradient,
smoke is drifting soft blobs. (i) lightLeak/lensFlare/sunRays were one radial
gradient (preview + export): leak = warm wash from the left edge, flare =
bright core + 3 ghost circles on a diagonal, rays = light wedges fanning from
the top-right corner. (j) echo/ghosting/motionTrail were one blend:
echo = soft repeat (0.5), ghosting = repeat displaced 6 px (0.6), trail =
strongest smear (0.8). (k) cameraShake/handheld/zoomShake did NOTHING in
Canvas export and only added a fake `brightness(1.02)` in preview: both now
move the frame for real, each with its own motion (fast jitter / slow drift +
roll / scale pulse). (l) Legacy global `S.fx.vignette` had no Canvas-export
path: the radial darkening is now drawn in `applyCanvasFramePixels`.
Preview CSS approximations were split to match: glow vs bloom, vhs/crt/oldtv,
rgbSplit vs rgbShift, real shake transforms.

**Video filters (35, 1 fix).** All 35 have distinct params and distinct
pixels in preview (CSS) + Canvas export — verified pairwise (Documentary vs
Natural, Soft Glow vs Dreamy, etc.). One gap fixed: `ffmpegEqFull()` now
carries sepia (`colorchannelmixer`, blended matrix) and temperature/tint
(`colorbalance`) into the FFmpeg export, so Sepia/Vintage/Warm/Cool survive
the Video Engine export. Highlights/shadows still have no FFmpeg equivalent
in this chain — they render in preview + Canvas export only (noted in code).

**Photo filters (27, 0 fixes).** Every preset changes pixels via the real
pixel pipeline (`applyAdj` + `applyFx`); nearest pairs verified distinct
(B&W vs Noir, Vintage vs Retro, Soft Focus vs Dreamy, Glow vs Soft Focus,
Emboss vs Oil Paint, Pencil Sketch vs Edge Detect, Halftone vs Posterize).

**Text anims (14, 0 fixes).** All 14 verified distinct via `textAnimState`
at t=0.5 s (letter = 1 char/0.06 s, typewriter = over 70% of duration,
word = 1 word/0.25 s, mask = clip-path wipe vs fade = opacity, wave =
per-letter sine vs bounce = scale spring). No change needed.

**Audio FX (18, 2 fixes).** All 18 build real nodes (Web Audio) and real
FFmpeg filters — verified per item. Two fixes: (a) echo and delay shared one
feedback-delay block in `buildAudioChain`: echo keeps the feedback delay
(0.28 s, repeats fading), delay is now a single slapback (0.45 s, no
feedback). (b) The Gate label now honestly reads "Gate (expander approx.)"
— a stock-node gate is a DynamicsCompressor approximation, as the code
comment already said but the UI did not.

**Color grading (22 items, 0 fixes, 1 flag cleared).** All 17 sliders
(brightness, contrast, saturation, vibrance, exposure, temperature, tint,
highlights, shadows, whites, blacks, gamma, sharpen, dehaze, fade, vignette,
noise reduction) + RGB curves + HSL + 3 color wheels + color balance +
`.cube` LUT change pixels in `applyGradePixels`. The Phase 7 flag "3 wheel
sliders on a dynamic bind loop not wired" was WRONG: the amt sliders are
bound (app.js bind loop), the wheel canvases drag (x/y), amt defaults to 50,
and the math consumes `amt` — verified by pixel test (shadow vs highlight
wheel differ). Honest scope note, unchanged: curves/HSL/wheels/balance/LUT
render in the Canvas export + the graded still-frame thumb, NOT on the live
`<video>` preview (CSS cannot do them) — the code already says so.

**Panels / Coming Later.** Photo **Rotate View is implemented**: View menu →
Rotate View cycles the view 0°→90°→180°→270°→0° (CSS rotation of the canvas
element, `fitZoom` uses swapped dims at 90°/270°). It is view-only — pixels
and exports are untouched; the toast says to rotate back to 0° before
painting, because painting tools still map to the unrotated canvas. The
Coming Later badge is removed. The photo harness expectation for the old
disabled button was updated with this reason. The only remaining disabled
button in scope is Vosk offline captions (Captions panel) — a documented
omission (needs a ~40 MB model download), honestly labelled, left as-is.

### Per-item table

Preview = live preview (CSS / overlay canvas / DOM). Export = Canvas export
(pixel math, draw-level, or overlay). FFmpeg = Video Engine export where
applicable. ✓ = verified changing + distinct from sibling by the harness.
"draw" = draw-level (translate/clip/overlay), not per-pixel math.

#### Transitions (54)

| Transition | Preview | Canvas export | FFmpeg | Notes |
|---|---|---|---|---|
| none | ✓ | ✓ | — | identity |
| fade | ✓ | ✓ | ✓ fade | plain opacity |
| dissolve | ✓ | ✓ | ✓ fade | FIXED: + melting blur |
| crossdissolve | ✓ | ✓ | ✓ fade | FIXED: + settle-zoom |
| filmdissolve | ✓ | ✓ | ✓ fade | FIXED: + warm wash + blur |
| fadeblack | ✓ | ✓ | ✓ fade black | black overlay |
| fadewhite | ✓ | ✓ | ✓ fade white | white overlay |
| zoomin | ✓ | ✓ | — (skipped, listed) | FIXED: grows 0.5→1.0 |
| zoomout | ✓ | ✓ | — | FIXED: shrinks 1.5→1.0, no pop |
| zoomthrough | ✓ | ✓ | — | scale 3.2→1.0 |
| zoomblur | ✓ | ✓ | — | zoom + blur |
| punchzoom | ✓ | ✓ | — | sine zoom pulse |
| slideleft | ✓ | ✓ | — | FIXED: Auto dir = left |
| slideright | ✓ | ✓ | — | FIXED: Auto dir = right |
| slideup | ✓ | ✓ | — | FIXED: Auto dir = up |
| slidedown | ✓ | ✓ | — | FIXED: Auto dir = down |
| pushleft | ✓ | ✓ | — | FIXED: Auto dir = left |
| pushright | ✓ | ✓ | — | FIXED: Auto dir = right |
| pushup | ✓ | ✓ | — | FIXED: Auto dir = up |
| pushdown | ✓ | ✓ | — | FIXED: Auto dir = down |
| wipe | ✓ | ✓ | — | directional rect clip |
| circlewipe | ✓ | ✓ | — | FIXED: circle from centre |
| circlereveal | ✓ | ✓ | — | FIXED: circle from corner |
| clockwipe | ✓ | ✓ | — | conic sweep |
| diagwipe | ✓ | ✓ | — | diagonal clip |
| spinleft | ✓ | ✓ | — | +90° rot |
| spinright | ✓ | ✓ | — | −90° rot |
| spin360 | ✓ | ✓ | — | 360° rot |
| whirl | ✓ | ✓ | — | rot + zoom |
| gaussblur | ✓ | ✓ | — | blur ramp |
| motionblur | ✓ | ✓ | — | blur + slide |
| radialblur | ✓ | ✓ | — | blur + zoom |
| rgbglitch | ✓ | ✓ | — | FIXED: RGB-split pass |
| digitalglitch | ✓ | ✓ | — | FIXED: band-shift pass |
| pixelglitch | ✓ | ✓ | — | FIXED: pixelate pass |
| signalerror | ✓ | ✓ | — | FIXED: channel-corrupt pass |
| whiteflash | ✓ | ✓ | — | white overlay |
| blackflash | ✓ | ✓ | — | black overlay |
| cameraflash | ✓ | ✓ | — | sine-pulse flash |
| filmburn | ✓ | ✓ | — | orange overlay |
| lightleak | ✓ | ✓ | — | amber overlay |
| lensflare | ✓ | ✓ | — | pale overlay + flare |
| whippan | ✓ | ✓ | — | fast slide + blur |
| camerashake | ✓ | ✓ | — | shake |
| motionsweep | ✓ | ✓ | — | slide + zoom |
| cube | ✓ | ✓ | — | rotate + shrink |
| flip | ✓ | ✓ | — | scale flip + rot |
| pageturn | ✓ | ✓ | — | rot + slide + fade |
| rotate3d | ✓ | ✓ | — | 120° rot + shrink |
| rectreveal | ✓ | ✓ | — | centre rect grows |
| diamondreveal | ✓ | ✓ | — | diamond grows |
| liquid | ✓ | ✓ | — | zoom + blur + circle |
| inkspread | ✓ | ✓ | — | FIXED: dark wash + blur, no zoom |
| smokereveal | ✓ | ✓ | — | fade + blur + grey wash |
| maskreveal | ✓ | ✓ | — | FIXED: rect + fade + blur |

#### Clip effects (54)

| Effect | Preview | Canvas export | Notes |
|---|---|---|---|
| Gaussian Blur | ✓ blur() | ✓ 3×3 box | FIXED: was shared box with all blurs |
| Motion Blur | ✓ blur() | ✓ diagonal 5-tap | FIXED: own kernel |
| Radial Blur | ✓ blur() | ✓ rotational arc samples | FIXED: own kernel |
| Lens Blur | ✓ blur() | ✓ 5×5 box | FIXED: own kernel |
| Zoom Blur | ✓ blur() | ✓ radial-line samples | FIXED: own kernel |
| Directional Blur | ✓ blur() | ✓ horizontal 5-tap | FIXED: own kernel |
| RGB Split | ✓ saturate | ✓ channel shift | |
| Digital Glitch | ✓ overlay bars | ✓ band shift | FIXED: split from pixel/signal |
| Pixel Sort | ✓ (approx) | ✓ 8px band sort | |
| VHS Distortion | ✓ saturate | ✓ shift + scanlines | FIXED: split from vhs/crt/oldtv |
| Camera Shake | ✓ real translate | ✓ draw translate | FIXED: was fake brightness, no export |
| Handheld | ✓ real translate+roll | ✓ draw drift+roll | FIXED: same |
| Zoom Shake | ✓ real scale pulse | ✓ draw scale pulse | FIXED: same |
| Camera Flash | ✓ overlay | ✓ draw white flash | |
| Glow | ✓ drop-shadow | ✓ highlight lift | FIXED: split from bloom |
| Bloom | ✓ drop-shadow+bright | ✓ lift + neighbour bleed | FIXED: own math |
| Lens Flare | ✓ overlay | ✓ draw core + ghosts | FIXED: split from leak/rays |
| Light Leak | ✓ overlay | ✓ draw left-edge wash | FIXED: split from flare/rays |
| Sun Rays | ✓ overlay | ✓ draw corner wedges | FIXED: split from leak/flare |
| Film Grain | ✓ overlay | ✓ 4×4 block noise | FIXED: split from analog noise |
| Dust | ✓ overlay | ✓ per-pixel specks | FIXED: split from scratches |
| Scratches | ✓ overlay | ✓ vertical hairlines | FIXED: split from dust |
| Film Burn | ✓ overlay | ✓ warm top gradient | |
| Film Flicker | ✓ overlay | ✓ sine flicker | |
| Wave | ✓ (approx) | ✓ remap sine | |
| Ripple | ✓ (approx) | ✓ remap radial sine | |
| Warp | ✓ (approx) | ✓ remap low-freq sine | |
| Fisheye | ✓ (approx) | ✓ remap barrel | |
| Swirl | ✓ (approx) | ✓ remap rotation | |
| VHS | ✓ saturate | ✓ row tracking jitter | FIXED: split from vhsDist/crt/oldtv |
| CRT | ✓ saturate | ✓ scanlines + edge dark + green | FIXED: split |
| Old TV | ✓ sepia/grey | ✓ desat + scanlines + flicker | FIXED: split |
| Analog Noise | ✓ overlay | ✓ per-pixel noise | FIXED: split from film grain |
| Motion Trail | ✓ brightness | ✓ prev-frame blend 0.8 | FIXED: own strength |
| Echo | ✓ brightness | ✓ prev-frame blend 0.5 | FIXED: own strength |
| Ghosting | ✓ brightness | ✓ prev-frame blend 0.6 + 6px offset | FIXED: own strength + offset |
| Strobe | ✓ overlay | ✓ on/off darken | |
| Drop Shadow | ✓ drop-shadow 6px | ✓ draw offset black copy | verified distinct from long |
| Long Shadow | ✓ drop-shadow 18px | ✓ draw larger offset copy | verified distinct from drop |
| Inner Shadow | ✓ brightness | ✓ edge darken | |
| Sketch | ✓ grayscale | ✓ grey + edge | |
| Cartoon-style edge | ✓ saturate | ✓ posterize + edge darken | |
| Posterize | ✓ contrast | ✓ 4-level quantise | |
| Halftone | ✓ overlay dots | ✓ dot pattern | |
| Rain | ✓ overlay streaks | ✓ draw streaks | |
| Snow | ✓ overlay flakes | ✓ draw flakes | |
| Fog | ✓ overlay | ✓ draw bottom gradient | FIXED: split from smoke |
| Smoke | ✓ overlay | ✓ draw drifting blobs | FIXED: split from fog |
| Bokeh | ✓ overlay | ✓ draw large soft circles | |
| Particles | ✓ overlay | ✓ draw 2px dots | |
| RGB Shift | ✓ saturate 1.5 | ✓ shift + saturation boost | FIXED: was rgbSplit copy |
| Duotone | ✓ grayscale | ✓ two-tone map | |
| Invert | ✓ invert(1) | ✓ 255−x | |
| Solarize | ✓ sepia/hue | ✓ threshold invert | |

#### Video filters (35) — preview ✓ CSS, Canvas export ✓ pixel math; FFmpeg ✓ eq/hue/colorbalance/colorchannelmixer/curves/lut3d except highlights/shadows (preview + Canvas only)

Normal, Cinematic, Hollywood, Teal & Orange, Moody, Dark Cinematic, Vintage,
Retro 80s, Retro 90s, VHS, Black & White, Sepia, Warm, Cool, Golden Hour,
Sunset, Night, Blue Hour, Film Look, Portrait, Natural, Matte, Faded, Pastel,
High Contrast, Dreamy, Soft Glow, Cyberpunk, Neon, Horror, Documentary,
Wedding, Travel, Food, Landscape, Street Photography — all 35 verified
changing vs Normal and distinct from their nearest sibling. FIXED: FFmpeg now
carries sepia + temperature/tint (was lost in Video Engine export).

#### Photo filters (27) — all ✓ real pixel pipeline, all distinct from nearest sibling

Normal, Vintage, B&W, Warm, Cool, Vivid, Sepia, Noir, Fade, Duotone, Retro,
Bright, HDR, Neon, Glow, Soft Focus, Emboss, Oil Paint, Pencil Sketch,
Edge Detect, Color Splash, Halftone, Posterize, Cinematic, Matte, Pastel,
Dreamy. 0 fixes needed.

#### Text anims (14) — preview ✓ DOM, Canvas export ✓ — all distinct, 0 fixes

none, fade, slide, pop, typewriter, letter, word, zoom, bounce, rotate, flip,
glitch, wave, mask.

#### Audio FX (18) — preview ✓ Web Audio chain, export ✓ FFmpeg filter — all build nodes + filters

EQ 60 Hz, EQ 230 Hz, EQ 1 kHz, EQ 4 kHz, EQ 12 kHz, Bass boost, Treble,
Reverb (generated impulse), Echo, Delay, Chorus, Flanger, Phaser, Distortion,
Compressor, Limiter, Gate (expander approx.), Noise reduction (gate +
high-pass). FIXED: Echo vs Delay split in Web Audio (feedback delay vs single
slapback); Gate label made honest.

#### Color grading (22) — Canvas export ✓ pixel math; preview: sliders via CSS, curves/HSL/wheels/balance/LUT via graded still-frame thumb

Brightness, Contrast, Saturation, Vibrance, Exposure, Temperature, Tint,
Highlights, Shadows, Whites, Blacks, Gamma, Sharpen, Dehaze, Fade (lift
blacks), Vignette, Noise reduction (spatial denoise), RGB Curves, HSL,
3 color wheels (shadows/midtones/highlights + amount), Color balance,
.cube LUT. 0 fixes; wheel wiring flag from Phase 7 cleared as incorrect.

### Removed items

None. No listed effect, filter, transition, anim, or audio FX was removed.

### Zip rebuilt

`editora-pro-deploy.zip` rebuilt from a fresh staging copy
(`rm -rf .web-deploy; cp -r final-deploy .web-deploy; rm
.web-deploy/app/vendor/ffmpeg-core.wasm; zip -qr`). Verified with `unzip -l`:
files at zip root, `app/vendor/ffmpeg-core.wasm` ABSENT, wrapper JS files +
`ffmpeg-core.js` PRESENT. NOT deployed.

### Still needs the parent's live-browser check (not claimed here)

1. Pick any two previously-collapsed pairs (e.g. dissolve vs crossdissolve,
   fog vs smoke, echo vs ghosting, slideleft vs slideright) on a real clip
   and confirm they look different in the preview and in a Canvas export.
2. FFmpeg export with the Sepia filter and with Warm temperature — confirm
   the sepia/warmth survives in the downloaded MP4 (new colorchannelmixer /
   colorbalance filters).
3. Photo editor → View menu → Rotate View: canvas rotates 90° per click and
   Fit to Screen still frames it; rotate back to 0° before painting.
4. Transition direction: choose "Slide Right" with Direction left on Auto —
   the clip must slide right; set Direction to Left explicitly — it must
   slide left.
5. The Vosk offline-captions button remains disabled + labelled (documented
   omission, out of this job's scope).

---

## Canvas export — WebCodecs rebuild (2026-11-12, ~09:30–10:15 IST)

### Why (live-test failure it fixes)
Canvas export with a Fog effect rendered to 100%, then failed its own
validation: "file duration 5.18s vs timeline 5.00s; effective frame rate
7.0 fps vs requested 30 fps (35 of 150 frames drawn)". The real-time
playback loop draws only ~7 frames/sec at 720p — each frame costs ~140 ms
(video seek + drawCover + per-pixel JS effect math). MediaRecorder
timestamps by wall clock, so slow drawing = low fps + wrong duration.
FFmpeg export is NOT touched (verified fixed by the parent: real MP4,
5.00 s, 30 fps, H.264/AAC, Sepia survived).

### What changed (`final-deploy/app/app.js`, `app/index.html`)
- `doVideoExport()` rebuilt on **WebCodecs**: `VideoEncoder` (H.264,
  `avc1.640033` → `avc1.42E01E` fallback list via `isConfigSupported` with
  the real size/fps/bitrate; H.265 `hvc1`/`hev1` first when the user picked
  it and the encoder proves it) with **explicit frame timestamps**
  (frame n at n/fps µs, keyframe every ~2 s). Slow drawing now only makes
  the export take longer — fps/duration can no longer be corrupted.
- **Audio**: new `renderTimelineAudioOffline(base, total)` —
  `OfflineAudioContext` (2 ch, 44100 Hz) mix of V1 video-clip audio
  (trim/speed/EQ bass-treble/vidVol, mute-aware) + A1/A2 clips
  (volume/normGain, pan, speed+pitch, reverse, per-clip fade in/out,
  A2 ducking under any sounding A1 clip, full `buildAudioChain` FX when
  enabled), then `AudioEncoder` (AAC `mp4a.40.2`, 128 kbps) fed in
  1024-sample frames with explicit timestamps. Audio uses base speed when
  a clip has speed ramps / time remap / frame hold (video frames still
  honour them exactly); the result note says so. Timelines over 10 min
  skip the offline mix with a clear note (use the Video Engine).
- **Muxing**: vendored `app/vendor/mp4-muxer/mp4-muxer.mjs` (mp4-muxer
  5.0.0, 65 KB, same-origin import) — `Muxer` + `ArrayBufferTarget`,
  `fastStart: "in-memory"`, `firstTimestampBehavior: "cross-track-offset"`
  (keeps A/V sync, absorbs AAC priming). Output is always a real MP4
  (H.264/AAC or H.265/AAC); the old MediaRecorder/WebM fallback, mime
  guessing and VP9-in-MP4 are gone. `detectH265()` now probes
  `VideoEncoder.isConfigSupported` (was MediaRecorder) for the Canvas path.
- **Frame loop**: sequential, not wall-clock. `prepareFrameMedia(t)` keeps
  the video elements PAUSED and seeks each to the exact source time for
  that frame (`seeked` await, 1.5 s timeout) before `drawFrame(t)`; the
  cross-dissolve snapshot, V2 overlay and split-screen cells (1+, via
  `splitVideoEl`) are seeked the same way. `drawSplitCells` no longer
  plays/re-seeks cells during an export (`S.exporting` guard). Cancel
  stops the loop promptly; encoders are flushed, then `muxer.finalize()`.
- **Validation kept** (duration ±0.3 s, effective fps ≥80% of requested,
  min-size guard) — it must now PASS by construction (framesEncoded ==
  totalFrames). Failure paths name the reason and point at the Video
  Engine; no silent bad file. WebCodecs missing → clear failure, not a
  fallback recording.
- Export dialog copy updated: engine option is now "Canvas + WebCodecs",
  hint explains explicit timestamps. `deploy.py` asserts
  `app/vendor/mp4-muxer/mp4-muxer.mjs` is present in staging (wasm still
  the only excluded file).

### Nits fixed in the same pass
- (a) **FFmpeg progress time**: `onProg` divided `time` by 1000 — but
  ffmpeg.wasm reports progress `time` in **microseconds**, so a 5 s clip
  showed "06:34.7 / 00:05.0" rising to "44:30.3". Now `time/1e6` for both
  the percentage and the clock.
- (b) **Export dialog reset**: `openExportModal()` forced Resolution to
  `S.settings.defRes` (1080p) on every open. Last-used settings are now
  saved (`saveLastExportSettings()`, localStorage `editora-last-export`)
  on every export and restored on open (res/fps/fmt/codec/bitrate/custom
  size); Settings defaults are only the first-run fallback.
- (c) **Duration float artifacts**: new `round2()` helper; stored
  start/duration/trim values are rounded to 2 decimals in `splitClipAt`,
  `applyTrim`, `mergeAudio`, `insertClipOnTrack`, `nudgeAudio` — a split
  at 2.7 s can no longer store 2.700000047683716.
- (d) **Ruler click**: `#tlRuler` now has a `pointerdown` scrub handler
  (seek immediately + drag the playhead while held). A plain ruler click
  previously did nothing because the ruler's time labels are rebuilt on
  every `renderTimeline`, which can swallow the click event; the
  `tlScroll` click handler still covers track-area clicks.
- (e) **"Unable to play media." accessibility text**: `aria-hidden="true"`
  (+ `tabindex="-1"`) added to the purely decorative/render-surface
  `<video>` elements — `#previewVideo`, timeline clip thumbnails,
  both media-library grids, `splitVideoEl` cells, `previewVideo2`,
  export `v2Video`. (The stage's transport buttons etc. stay accessible.)

### Import picker — verified, NO bug (do not "fix")
Two live runs reported "+ Import Video / Photos" produced no visible file
picker and no import toast. Traced in code: `init()` runs on
`DOMContentLoaded`; it binds `btnImport` click → `$("fileInput").click()`
and `fileInput` change → `addFiles(e.target.files)` → toast
"n file(s) imported — saved" after IndexedDB save. Both IDs are unique
in `app/index.html`; the input is
`<input type="file" id="fileInput" accept="video/*,image/*,audio/*" multiple hidden>`.
A programmatic `.click()` on a hidden file input from a real user-gesture
handler opens the native picker in Chrome — this is the standard pattern.
A native OS file dialog is invisible to an automated browser by design
(CDP cannot render or complete it), so "no visible chooser / no toast" is
the expected automation artifact, not an app bug — and a previous live
session already had `sample.mp4` in the Media Bin through this same path,
proving an import succeeded. No code changed here.

### Verification (headless — no browser available in this environment)
- `node --check` PASS on `app.js` and `photo.js`.
- **Muxer test (real encode, `/tmp/test_muxer.mjs`)**: real H.264
  (ffmpeg CLI, 1280×720, 30 fps, no B-frames) + real AAC fed through the
  vendored mp4-muxer with the SAME options the browser code uses
  (`fastStart: "in-memory"`, `firstTimestampBehavior: "cross-track-offset"`,
  µs timestamps via `addVideoChunkRaw`/`addAudioChunkRaw`). Results:
  A/V file 5.04 s, H.264 1280×720 30/1, AAC, full `ffmpeg -f null` decode
  OK; video-only file 5.00 s, 150 frames, video duration 4.999913 s,
  decode OK. (First run showed a 0.10 s video track — a bug in the TEST's
  Annex B parser grouping a whole GOP into one sample, not in the muxer;
  fixed in the test, both cases pass.)
- Node has no WebCodecs (`VideoEncoder` undefined in Node 24), so the
  browser-side `VideoEncoder`/`AudioEncoder`/`VideoFrame` path itself
  could NOT be run headless — the live test below is mandatory.
- Traced in code: `doVideoExport` flow (gate → muxer import → codec pick
  → offline audio → muxer/encoders → sequential frame loop → audio frames
  → flush → finalize → validation → result); no remaining references to
  `MediaRecorder`/`captureStream`/`driveAudio`/`ensureExportMedia` in the
  export path (voice recording still uses MediaRecorder — unrelated).

### Zip rebuilt
`editora-pro-deploy.zip` rebuilt from `deploy.py` staging
(`build_staging()` + zip of `.web-deploy`). Verified with `unzip -l`:
files at zip root, `app/vendor/ffmpeg-core.wasm` ABSENT,
`app/vendor/mp4-muxer/mp4-muxer.mjs` + FFmpeg wrapper JS files PRESENT.
NOT deployed.

### Still needs the parent's live-browser check (not claimed here)
1. **Canvas export 720p/30fps with a Fog effect** (Engine: Canvas): file
   must be a real MP4 — `ffprobe` shows 5.00 s, 30 fps, H.264 + AAC,
   MB-sized; status must say "Canvas export (WebCodecs)" with
   "150 frames @ 30.0 fps" and "Validation passed". Also try 1080p and a
   clip with an audio track (A1) to confirm the AAC mix is audible.
2. FFmpeg export progress clock must now show real elapsed time
   (e.g. "00:02.1 / 00:05.0"), never "06:34.7".
3. Export dialog: set Resolution 720p, export, reopen — Resolution must
   still be 720p.
4. Split a clip at 2.7 s: stored Duration fields must read 2.70, never
   2.700000047683716.
5. Click the timeline ruler (not drag): playhead must jump there.
6. Split-screen export (2 cells, video in both): both cells must show
   the correct frame time (new per-frame seeking for `splitVideoEl`).
7. Import: click "+ Import Video / Photos" in a REAL browser — the native
   picker must open and the import toast must appear (automation cannot
   show this; code is verified correct).

## Job 3 — Canvas (WebCodecs) export failure (2026-11-12, parent's live test 09:42–09:45 IST)

**Live result (reproduced twice, identical):** Fog effect on a 5 s 720p clip,
Engine "Canvas + WebCodecs", 720p/30fps/MP4/H.264. Rendering runs (frame
12/150 → 100%), then fails at the encoding/final stage:
"Export failed: Canvas export (WebCodecs) failed while encoding:
Unsupported codec type. — try the Video Engine (FFmpeg) instead." No file
is offered. FFmpeg export is VERIFIED WORKING and was not touched.

### Root cause (found in code, not assumed)
`doVideoExport` probed ONLY the video encoder, with
`VideoEncoder.isConfigSupported` — and on the test browser (Linux Chrome)
that call LIES: it returns `supported: true` for H.264 even though Linux
Chrome has no H.264 encoder (proprietary codecs are absent). The export
therefore rendered all 150 frames and only then failed — the encoder error
surfaced asynchronously via the `VideoEncoder` error callback / `flush()`,
after the progress bar had already hit 100%. The audio encoder was never
probed at all: `aEnc.configure({codec:"mp4a.40.2"})` ran unguarded, and AAC
is likewise absent on Linux Chrome, so the same failure could come from the
audio track (audio encodes after the video loop, which matches "fails at
100%"). Evidence in code: `pickCodec` (old) probed only
`avc1.640033/640028/64001f/4d0028/42E01E` via `isConfigSupported` and never
encoded a frame; `aEnc.configure` had no probe and no try/catch.

### Fix 1 — Probe BEFORE rendering, with a real encode (not just isConfigSupported)
At export start — before a single frame is drawn — every candidate is now
proven with a one-frame smoke encode using the EXACT config the export will
use (`{codec, width, height, bitrate, framerate}` for video;
`{codec, sampleRate:44100, numberOfChannels:2, bitrate:128000}` for audio):
configure → encode one black frame / 1024 silence samples → `flush()` with
an 8 s timeout → accepted only if a chunk comes out and no error fired.
`isConfigSupported` is still checked first (cheap filter), but the smoke
test is the verdict. If no video codec passes, the export fails fast with
"This browser cannot encode video with WebCodecs (no H.264, VP9 or VP8
encoder at WxH) — use the Video Engine (FFmpeg) export instead" — before
any rendering.

### Fix 2 — Codec ladder + honest container
Video ladder: H.264 Baseline `avc1.42E01F` → H.264 High `avc1.64001F` →
VP9 `vp09.00.10.08` → VP8 `vp8` (H.265 first only when the user picked it,
same as before). Audio ladder: AAC `mp4a.40.2` → Opus. Container follows
the codec: MP4 via the vendored mp4-muxer (H.264/H.265/VP9 + AAC/Opus —
mp4-muxer supports `vp9` video and `opus` audio); WebM via the newly
vendored webm-muxer 5.1.4 (`app/vendor/webm-muxer/webm-muxer.mjs`, 65 KB
ESM, jsDelivr) only when the user picked WebM AND the video codec is VP9
(WebM takes VP9 + Opus only — H.264/HEVC picked with WebM writes MP4 with
a note). The status/result text names the codec actually used, e.g.
"Canvas export (WebCodecs) — MP4 (VP9 + Opus)". On Linux Chrome the
expected outcome is MP4 (VP9 + Opus). `configure()` calls are now wrapped
in try/catch (video failure = clear fail; audio failure = video-only with
a note). Honest limit: VP8 has no container — no webm-muxer release
supports VP8 (verified: v3.1.0, v3.2.1, v5.1.4 all contain zero "vp8"
references), so a VP8-only browser fails fast with a clear message. No
real browser ships a VP8 encoder without VP9, so this branch is
unreachable in practice. `deploy.py` staging now asserts both muxers are
present.

### Fix 3 — Progress honesty
Scale changed: rendering 0–70% (both the render-loop `setProg` AND the
per-frame write inside `drawFrame`, which also hit 100% at the last
frame), audio encoding 70–80%, flush + file writing 80–90%, file
validation 90–97%, done 100%. `setProg(100)` was sitting BEFORE the size
guard and the duration/fps validation — it now runs only after validation
passes, immediately before the "Done" status. Status text names each stage
("Rendering… · encoding + file writing follow", "Encoding audio (Opus)…",
"Writing file (MP4 (VP9 + Opus))…", "Checking file…").

### Fix 4 — Duration float (second attempt; the round2() from Job 1 missed paths)
Live-verified still present: after Split at 2.7 s the Duration field
DISPLAYED "2.7" while the stored value was 2.700000047683716 (float32
noise from the media pipeline — `video.currentTime`). Root cause: round2
covered `splitClipAt` but NOT the other writers. Fixed at the source and
at every writer: `S.curTime` is rounded to 2 decimals where it is set
(`seek()`, the playing-clock sync, the +0.1 s wall-clock advance — so the
float can never enter through the playhead); drag-trim (both directions),
`cutSelected` (`c.duration=off` was unrounded — the most likely live-test
path), `mergeSelected`, `setClipDuration` (its `want` could be the
unrounded clamped `maxDur`, and its `applied` return now equals the stored
value), Replace, Trim-apply, clip-speed, audio trim/speed, and clip
creation from media metadata. Backstop: `selectClip` normalizes
`it.start`/`it.duration` with round2 where the inspector inputs are
populated, so the field's value and the stored value are literally the
same number (2.7), not just the same display. Frame stepping is
unaffected (rounding is on the absolute time, error stays ≤0.005 s).

### Fix 5 — Export dialog layout
The dialog was taller than the viewport, so "Start Export" sat below the
fold. `#exportModal .modal-box` is now a flex column: header pinned,
`.modal-body` (options + frame-export row) scrolls internally,
`.modal-foot` (Start Export / queue / Cancel / Close + progress + result)
pinned at the bottom. Scoped to `#exportModal` only; other modals
unchanged. The export note text now describes the ladder honestly.

### Fix 6 — Kept
Post-export validation (duration ±0.3 s, fps ≥80%, minimum-size guard)
unchanged. No-WebCodecs failure path unchanged. No stale references to
the removed MediaRecorder export path (`MediaRecorder` remains only in
voice recording, an unrelated feature, and in the historical rebuild
comment).

### Verification (this job)
- `node --check app.js` and `node --check vendor/webm-muxer/webm-muxer.mjs` PASS.
- New harness `/tmp/probe_test.js` (Node vm — extracts the REAL
  `smokeVideo`/`smokeAudio`/`probeVideo`/`probeAudioOne` functions and the
  REAL container-decision block from `app.js` and runs them against stubbed
  WebCodecs): **15/15 PASS**, including: Linux-Chrome stub (isConfigSupported
  lies about avc1/AAC, real encodes fail) → ladder lands on VP9 + Opus,
  container MP4, label "MP4 (VP9 + Opus)"; WebM picked + VP9 → "WebM
  (VP9 + Opus)"; WebM picked + H.264 → MP4 with note; VP8-only → fail-fast
  with VP8 message; no working codec → probe returns null (fail fast, no
  render); H.264-capable stub → "avc1.42E01F" first and "MP4 (H.264 + AAC)".
- Traced probe → ladder → encode → mux in code; `deploy.py` staging
  assertions extended (both muxers). `photo.js` NOT touched (another agent
  is working on it). FFmpeg path NOT touched (verified: no changed lines in
  `loadFFmpeg`/`doFFmpegExport`).

### Zip rebuilt
`editora-pro-deploy.zip` rebuilt from `deploy.py` staging
(`build_staging()` + zip of `.web-deploy`). Verified with `unzip -l`:
files at zip root, `app/vendor/ffmpeg-core.wasm` ABSENT,
`app/vendor/mp4-muxer/mp4-muxer.mjs` + `app/vendor/webm-muxer/webm-muxer.mjs`
+ FFmpeg wrapper JS files PRESENT. NOT deployed.

### Still needs the parent's live-browser check (not claimed here)
1. **Canvas export with Fog, 720p/30fps, Engine: Canvas** — must now
   produce a real file: `ffprobe` shows ~5.00 s, 30 fps, codec VP9
   (video) + Opus (audio) in MP4, MB-sized; status must name
   "MP4 (VP9 + Opus)" and "Validation passed"; progress must stay ≤70%
   during rendering and hit 100% only at "Done".
2. Same export with Format WebM picked → real `.webm` file, VP9 + Opus,
   label "WebM (VP9 + Opus)".
3. Split a clip at 2.7 s, then read the stored value (e.g. via
   `S.clips[0].duration`): must be exactly 2.7, and the Duration field
   must show 2.7. Also try Cut and drag-trim to ~2.7 s — same check.
4. Export dialog at desktop height: "Start Export" visible without
   scrolling; options scroll inside the dialog.
5. FFmpeg export still works exactly as before (regression check).

## Job 3 — Photo-editor bug fixes (2026-11-12, parent's live test 09:41–09:44 IST)
All in `final-deploy/app/photo.js` (+ one label in `photo.html`, CSS in
`photo.css`). Video editor untouched (`app.js` not modified). Not deployed.

### Bug 1 — Brush painted GREY DOTTED strokes instead of the FG colour — FIXED (root cause proven with real pixels)
Live test: FG #ff3366 (pink), brush 24px / opacity 100% / hardness 80% /
spacing 25% / flow 60% → stroke came out a grey beaded line.
Diagnostic harness (`verify/brush_diag_harness.js`, real pixels via
jsdom + node-canvas) reproduced it exactly and isolated the cause:
- Baseline (fresh doc): stroke is exact pink (255,51,102), continuous,
  no gaps — the stamp and the spacing math (step = 24 × 25% = 6px,
  stamps overlap heavily) are CORRECT.
- After applying the **B&W filter**: the same pink stroke renders
  **grey (114,114,114)** — the luminance of #ff3366. Removing the filter
  ("Normal") turns the *same* stroke pink again. So the layer pixels
  were pink all along; the display was desaturated.
- **Root cause (primary):** filters are non-destructive *per-layer*
  adjustments, applied to the whole layer at render time (`adjCanvasOf`
  → `applyAdj`). The live-test project was restored from an autosave
  that still carried the B&W filter from the earlier session, so every
  new brush stroke on that layer rendered grey — with nothing in the UI
  saying a filter was even active (the filter grid's "on" highlight was
  never restored after a load).
- **Root cause (secondary):** `stamp()` faded its radial gradient to
  transparent **black** (`rgba(0,0,0,0)`), so the outer ~20% of every
  stamp was a muddy grey fringe (measured fringe pixel 174,101,119) —
  the visible "beaded circles" outline.
- **Fixes:**
  1. `stamp()` now fades to the transparent version of the *same*
     colour (`transparentOf()`); fringe is light pink now (R>240).
  2. A colour-depositing stroke (brush / pencil / airbrush) or bucket
     fill never paints directly onto an adjusted layer:
     `ensurePaintLayerForColour()` creates a fresh "Brush" paint layer
     directly above it and paints there, with the toast "Painted on a
     new layer above the filter — your colour stays true". Clone/heal/
     blur and the other pixel-transforming tools are unaffected (they
     work on the layer's own pixels and stay put). One Undo removes the
     stroke *and* its auto-created layer (the undo checkpoint is taken
     before the layer is added).
  3. The active filter is now visible: `filterNameFor()` +
     `syncFilterGrid()` re-highlight the matching preset after any
     load/restore/layer switch, and the status bar shows
     "Active layer: … • Filter: B&W" (or "custom adjustments").
  4. Flow is wired into the brush: a stamp deposits
     opacity × flow (was: flow ignored entirely).
- **Verification:** `verify/photo_bugfix_harness.js` **23/23 PASS** —
  pink stroke on a B&W layer renders exact pink and continuous; auto
  "Brush" layer created (2 layers, then 3 after the bucket test);
  bucket fill on the B&W layer is pink; fringe is light pink; filter
  name shows in grid + status bar. Existing
  `verify/photo_phase23_harness.js` **89/89 PASS** (no regression),
  `verify/phase6_harness.js` **61/61 PASS**.

### Bug 2 — First load auto-restored the old project onto the canvas — FIXED
Live test: the page auto-opened the autosaved project (toast "Restored
your autosaved project", old sample.png + grey stroke already on the
canvas). The roadmap demands a clean empty state on load.
- **Fix:** `init()` no longer auto-restores `__autosave__` at all.
  First load is always the clean empty state (Open Image / New Canvas /
  Recent Projects). The autosave is *offered* under Recent Projects by
  the rewritten `refreshSavedList()` — thumbnail (first layer's image
  data), project name + "— Autosaved", saved time — and one click
  resumes it via new `loadAutosave()` (toast only then: "Opened
  autosaved project"). The `?open=` deep link from the Projects screen
  still opens directly (explicit intent). Autosave itself is untouched —
  it still saves on every edit (debounce + 5 s safety net).
- **Verification:** same harness, two DOMs sharing one fake-IndexedDB:
  DOM 1 paints + B&W + saves; DOM 2 loads → empty state visible, no
  restore toast, canvas blank white, autosave entry present with
  thumbnail + time; clicking it opens the project (pink stroke intact,
  B&W still on the photo layer).

### NIT 3 — Export dialog showed "Export width 0" while saying "Ready: 640×480 PNG" — FIXED
`exportPhoto()` now prefills the width field with the resolved width
(`S.docW`) when it is 0/blank, so the field shows 640; a blank field
still means original size (label/placeholder updated in `photo.html`).
The downloaded file was already the correct 640×480 — unchanged.
Verified: field reads "1080" and "Ready: 1080×1080" in the harness.

### NIT 4 — History tooltip — VERIFIED, hardened
History entries already carried real `title` attributes
("Jump back to the state before: …" / "Redo: …") and `safeHistTime`
guards every time string (no "undefined" can appear — the string
"undefined minutes" does not exist in the code). The live test's
missing bubble was most likely the automation's short hover (native
`title` tooltips need a ~1 s dwell). Hardened anyway: the "Current
state" entry now has a title too. Verified: every `.hist-item` has a
non-empty title containing no "undefined".

### IMPORT wiring — verified in code, no bug found
Open Image (top bar + empty state) → `photoFileInput.click()`; empty
state click → same; Ctrl+O → same; `change` →
`loadImageFile(file)` → type check → `URL.createObjectURL` → `Image`
onload → new document, or Replace/Layer modal if an image is already
open; onerror → toast. The file picker not surfacing in the automated
browser is expected (native OS dialog, invisible to automation) — the
same as the video editor. No change made.

### Zip rebuilt
`editora-pro-deploy.zip` rebuilt from `deploy.py` staging
(`build_staging()` + zip of `.web-deploy`). Verified with `unzip -l`:
files at zip root, `app/vendor/ffmpeg-core.wasm` ABSENT, wrapper JS +
icons + modules PRESENT. NOT deployed.

### Still needs the parent's live-browser check (not claimed here)
1. **First load with a prior autosave present** (same browser profile
   as the 09:41 test): must show the clean empty state — no image on
   the canvas, no restore toast — with the autosaved project listed
   under Recent Projects (thumbnail + name + time); clicking it opens
   the project.
2. **Brush with pink FG (#ff3366) on a B&W-filtered photo:** stroke
   must be pink and smooth (not grey, not beaded); a new "Brush" layer
   must appear in the Layers panel and the toast must say the colour
   stays true; the status bar must show "Filter: B&W" while the photo
   layer is selected.
3. **Export dialog:** width field must show 640 (not 0) for the 640×480
   sample; downloaded PNG must be 640×480.
4. **History:** hover a History entry for ~1 s — a tooltip bubble with
   the action name must appear.
5. **Import:** click Open Image and pick a real file from the OS
   picker — the image must open (this step cannot be verified by
   automation; needs the parent's live browser).

## Job 4 — Five remaining bugs (2026-11-12, parent's live tests 11:37–11:38 IST)
All in `final-deploy/app/app.js` (Bugs 1–2) and `photo.js`/`photo.css`
(Bugs 3–5). FFmpeg export VERIFIED WORKING — untouched. Photo main
fixes (pink brush, empty state, export width) VERIFIED WORKING —
untouched. Not deployed.

### Bug 1 — Canvas (WebCodecs) export STILL FAILS, new error — FIXED (root cause proven in code)
Live: Fog effect, 5 s 720p clip, 720p/30fps/MP4. Renders to 70%, then
"Canvas export (WebCodecs) failed while encoding: addVideoChunkRaw's
fourth argument (duration) must be a non-negative real number." No file.
The codec smoke-probe PASSED — it rendered — so the probe did not
catch it.
- **Root cause (code evidence):** the export created VideoFrames with a
  timestamp but NO duration —
  `new VideoFrame(canvas,{timestamp:Math.round(n*1e6/fps)})`. The
  encoder therefore emitted a final chunk during `flush()` (no next
  frame exists to infer a duration from) whose `duration` was `null`,
  and the vendored mp4-muxer's `addVideoChunk` passes
  `sample.duration` straight into `addVideoChunkRaw`, which throws on a
  non-finite duration (`vendor/mp4-muxer/mp4-muxer.mjs` lines 1186–1226).
  It fails at exactly 70% because rendering is 0–70% of the progress
  scale and the flush runs right after the render loop. The probe only
  encoded one frame and DISCARDED the output — it never touched the
  muxer, so it could not catch a muxer-side failure.
- **Fixes (app.js):**
  1. New top-level helpers `EP_FRAME_DUR_US(fps)`,
     `EP_AUDIO_DUR_US(n,rate)`, `EP_SAFE_DUR(d,fallback)`,
     `epSafeVideoChunk(chunk,fallbackUs)`,
     `epSafeAudioChunk(chunk,fallbackUs)`. Every chunk duration is
     computed from its frame/sample INDEX — video exactly 1/fps per
     frame (33333 µs @30fps), audio exactly samples/sampleRate per
     chunk (23220 µs for 1024 samples @44100) — clamped to ≥1 µs,
     never derived by subtracting two timestamps.
  2. The export's VideoFrames now carry their own duration:
     `new VideoFrame(canvas,{timestamp:n*frameDurUs,duration:frameDurUs})`.
  3. Both encoder outputs go through the guards before the muxer
     (`muxer.addVideoChunk(epSafeVideoChunk(chunk,frameDurUs),meta)`,
     `muxer.addAudioChunk(epSafeAudioChunk(chunk,audioDurByTs.get(chunk.timestamp)),meta)`);
     — a chunk with a missing/NaN/negative duration is rebuilt with
     the exact index-derived duration; the audio feed loop records
     each chunk's exact duration in `audioDurByTs` (the last, partial
     chunk gets its own sample count, not the full-frame value).
  4. The probe now proves the FULL path: it imports the mp4-muxer
     up front and each candidate codec is smoke-encoded through a REAL
     throwaway Muxer with the same duration math — 3 video frames
     (the third is the flush-path last frame) and 2 audio chunks —
     and the muxer is FINALIZED; a null duration now fails the probe
     before a single timeline frame is drawn. MP4 is the strict
     container (it requires a duration; WebM does not), so proving
     MP4 proves WebM too. VP8 keeps the encode-only smoke (no MP4
     container for it; its own clear error follows later). The codec→mux
     mapping is now one shared helper (`muxCodecFor`), used by the
     probe and the export alike.
- **Verification:** `verify/harness.js` **116/116 PASS** (was 87; +23
  Bug 1 checks — pure duration math incl. last-frame and partial
  audio chunks, guard rebuild/pass-through with stub chunk classes,
  and static proof that the export and probe use the same
  chunk-adding code). `verify/effects_audit_harness.js`,
  `photo_phase23` 89/89, `phase6` 61/61, `photo_bugfix` 27/27 — no
  regressions.

### Bug 2 — Duration float STILL NOT FIXED — FIXED (third attempt; full writer audit)
Live-verified twice: after Split at 2.7 s the Duration field's
underlying value was STILL 2.700000047683716 (display "2.7").
- **Root cause (traced end to end in the deployed code):** the live
  code on disk AND on the CDN already contained the round2() fix in
  `seek()`, `splitClipAt()` and `selectClip()` — and the deployed
  `app.js` was byte-identical to disk (422,035 bytes, backstop present
  at line 1011) — yet the artefact survived, so a writer OUTSIDE the
  split path was feeding it. The audit of every assignment to
  `.start/.duration/.trimIn/.trimOut/.baseDur` found the remaining
  unrounded writers: media durations loaded raw from the pipeline
  (`m.duration=v.duration` / `a.duration` at 8 import/restore sites —
  the float32 artefact's CREATION point), `replaceClipWithMedia`
  copying raw `oldDur*sp` / `src` into trimOut/baseDur, `btnClipApply`
  writing `it.start` unrounded, clip drag writing
  `it.start=Math.round(ns*10)/10` (1 decimal), caption/waveform start
  setters, a delete-shift start write, and `updateDuration()` storing
  the unrounded sum. Any one of these can put the artefact into a
  clip record that the inspector then shows.
- **Fixes (app.js):** round2 at every creation point — media durations
  at all 8 load sites (`round2(v.duration)` / `round2(a.duration)`),
  `replaceClipWithMedia` trimOut/baseDur, `btnClipApply` start,
  drag-move start, caption/waveform start setters, delete-shift,
  `updateDuration()` sum, `addToTimeline` trimOut/baseDur/audio
  duration; plus belt-and-braces `off=round2(hit.offset)` in
  `splitAtPlayhead` (the variable that carries the playhead into
  splitClipAt) and a selectClip backstop that now normalizes
  trimIn/trimOut/baseDur as well as start/duration. A re-audit shows
  every remaining unrounded writer is a constant (0, 4, 5) or copies
  an already-rounded value.
- **Verification:** harness simulates the EXACT live path —
  `seek(2.700000047683716)` (float32(2.7) as the media pipeline
  reports it) → `splitAtPlayhead()` → `selectClip()` — and asserts
  `S.curTime === 2.7`, clip duration `=== 2.7`, second clip
  start `=== 2.7` / duration `=== 2.3`, inspector input value
  literally `"2.7"` (`valueAsNumber === 2.7`), and no
  "2.700000047683716" anywhere in the clip record. 6 checks, all PASS.

### Bug 3 — Photo History tooltip STILL shows no bubble — FIXED (custom in-page tooltip)
Live: 2–3 s hover on "Brush stroke" and "Apply filter: B&W" entries —
no bubble, no "undefined". The native `title` attributes ARE on the
hovered buttons (verified in the deployed `photo.js`, line 942) and
no code re-renders the list while idle — so the most likely cause is
that native `title` bubbles are drawn by the OS and never appear in
headless/automated browsers (and can fail to fire on re-created list
items on some systems). A native-only tooltip cannot be verified by
automation at all.
- **Fix (photo.js + photo.css):** the entries keep their native
  `title` (accessibility), AND renderHistory now wires a small
  in-page tooltip: mouseover delegation on `#historyList` shows a
  `#epTooltip` div with the entry's title text, positioned above the
  entry; mouseout/mouseleave hides it. Visible in screenshots, in
  automation, and to every user. (`.ep-tooltip` style in photo.css.)
- **Verification:** `verify/photo_bugfix_harness.js` — dispatches a
  real mouseover on a history entry and asserts the tooltip is
  visible with exactly the entry's title text, then mouseout hides
  it. 2 checks, PASS. The pre-existing NIT-4 check (every entry has
  a non-empty title, no "undefined") still passes.

### Bug 4 — Photo status bar drops the filter indicator — FIXED
Live: after painting, active layer "Brush", status bar read
"Active layer: Brush …" with NO "Filter: B&W", though the photo layer
below still had B&W. Root cause: `updateStatus()` computed the filter
text ONLY from the active layer (`L.adj`).
- **Fix (photo.js):** the status bar now lists every VISIBLE layer
  carrying a non-identity adjustment — active layer bare, others with
  their layer name — e.g. "Active layer: Brush • Filter: B&W
  (sample.png)". Multiple filtered layers join with ", ".
- **Verification:** harness — after B&W + a pink stroke on the auto
  Brush layer, the status bar reads exactly "Active layer: Brush •
  Filter: B&W (IG post 1080×1080)" (the fresh-doc base layer is named
  after the design preset). 1 check, PASS.

### Bug 5 — Photo Recent Projects lists the SAME autosave TWICE — FIXED
Live: "sample — Autosaved 11/12/2026, 9:42:38 AM" twice.
- **Root cause (code evidence):** `saveProject()` writes the SAME
  snapshot under TWO keys — `dbPut(name,data)` then
  `dbPut("__autosave__",data)` (photo.js line ~2093) — so
  `refreshSavedList()` rendered the autosave entry AND the identical
  named-key entry (same name, same timestamp, same thumbnail).
- **Fix (photo.js):** `refreshSavedList()` dedupes by
  (projectName | savedAt) signature — the autosave's signature is
  remembered and any named entry matching it is skipped — plus a
  monotonic run token so two overlapping async refreshes cannot both
  render (only the newest run appends).
- **Verification:** harness DOM 2 (fresh load after a save) asserts
  Recent Projects has exactly 1 entry with a unique (name, time)
  signature. 1 check, PASS.

### Verification (this job)
- `node --check` PASS on `app.js` and `photo.js`.
- `verify/harness.js` **116/116 PASS** (87 + 23 Bug 1 + 6 Bug 2).
- `verify/photo_bugfix_harness.js` **27/27 PASS** (23 + 2 Bug 3 + 1 Bug 4 + 1 Bug 5).
- `verify/photo_phase23_harness.js` **89/89 PASS**,
  `verify/phase6_harness.js` **61/61 PASS**,
  `verify/effects_audit_harness.js` **315/315 PASS** — no regressions.
- `editora-pro-deploy.zip` rebuilt (see below). NOT deployed.

### Zip rebuilt
`editora-pro-deploy.zip` rebuilt from `deploy.py` staging
(`build_staging()` + zip of `.web-deploy`). Verified with `unzip -l`:
files at zip root, `app/vendor/ffmpeg-core.wasm` ABSENT, mp4-muxer +
webm-muxer + FFmpeg wrapper JS + icons + modules PRESENT. NOT deployed.

### Still needs the parent's live-browser check (not claimed here)
1. **Canvas export, Fog, 5 s 720p clip, 720p/30fps/MP4, Engine: Canvas:**
   must now COMPLETE (no "addVideoChunkRaw duration" error) — file a
   real MP4, `ffprobe` shows 5.00 s, 30 fps, H.264 + AAC, MB-sized;
   status names "Canvas export (WebCodecs)" with "150 frames @ 30.0
   fps" and "Validation passed". Also try 1080p and a clip with an
   audio track (A1) to confirm the AAC mix is audible. If the probe
   now rejects a codec, the export must fail FAST with a clear
   message — never after rendering.
2. **Split at 2.7 s (ruler click → playhead 00:02.7 → Split):** the
   inspector Duration field must read 2.7 with underlying value
   exactly 2.7 (not 2.700000047683716) — check the field value, the
   second clip (start 2.7, duration 2.3), and the project JSON.
3. **Photo History:** hover a History entry ~1 s — a visible tooltip
   bubble with the action name must appear (in-page tooltip, visible
   in screenshots).
4. **Photo status bar:** B&W on the photo layer, then paint (Brush
   layer active) — status bar must still read "Filter: B&W
   (sample.png)".
5. **Photo Recent Projects:** after a save, the autosave must appear
   exactly ONCE (no duplicate with the same timestamp).

## APK build — v1.0.0 (2026-11-12, ~06:41–06:45 IST)

The Android APK is built, verified, signed, and hosted. This is the product
(user order: "Browser ke liye mat banana, app ke liye banao, sab app ke andar ho").

### What was built
- **App:** Editora Pro v1.0.0, package `ai.editorapro.app`, versionCode 1,
  versionName 1.0.0, minSdk 24 (Android 7.0+), targetSdk 36.
- **File:** `app-release.apk`, **13,788,787 bytes (~13 MB)**, signed release.
- **Download:** https://editora-pro.pages.dev/editora-pro.apk
  (verified live: HTTP 200, content-length 13,788,787 = local file byte-for-byte,
  content-type `application/vnd.android.package-archive`).
  Landing page Download button now points at `/editora-pro.apk`.
- **Source:** repo `somya2005-Aje/editora-pro`, commit `213660f`
  (branch `main`); workflow `.github/workflows/build-apk.yml`,
  GitHub Actions run **43169955854 — GREEN** (all steps pass).

### How it is built (repeatable)
- Capacitor 8.6.0 wrapper (`android-app/`, appId `ai.editorapro.app`,
  webDir `www`). `prepare-www.sh` copies `final-deploy/` → `www/`; the APK
  opens the editor directly (root `index.html` redirects to `app/index.html`).
- GitHub Actions (free tier): Node 22, JDK 21, Android SDK
  (platform-tools + platforms;android-36 + build-tools;36.0.0),
  `npm ci` → restore keystore from repo secrets → `prepare-www.sh` →
  `npx cap sync android` → `./gradlew assembleRelease` → in-CI verification
  (aapt + apksigner) → upload artifact `editora-pro-apk` (90-day retention).
- Local Gradle build is impossible here (runtime blocks loopback TCP);
  GitHub Actions does the build, same pattern as VoiceWorld AI.
- Signing: release keystore `keystore/editora-pro-release.keystore`
  (alias `editora`, PKCS12, RSA 2048, 25 years), **never committed**
  (`.gitignore`); repo secrets `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`,
  `KEY_ALIAS` were verified missing on 2026-11-12 and set from the local
  keystore (key password == store password for PKCS12). If the keystore is
  lost, a new one means a NEW app identity (old installs cannot update).

### Verification evidence (all checked 2026-11-12)
- In-CI (workflow step "Verify APK"): `aapt dump badging` →
  `package: name='ai.editorapro.app' versionCode='1' versionName='1.0.0'`,
  `application-label:'Editora Pro'`,
  `launchable-activity: name='ai.editorapro.app.MainActivity'`;
  `apksigner verify --verbose` → **"Verifies", v2 scheme: true**
  (v1: false — fine, minSdk 24 supports v2).
- Local (downloaded artifact): `file` → "Android package (APK)";
  binary-manifest strings confirm `ai.editorapro.app`, `1.0.0`,
  `MainActivity`; APK Signing Block (`APK Sig Block 42`) present.
- Bundled content (from `unzip -l`): `assets/public/app/vendor/
  ffmpeg-core.wasm` (32,232,419 bytes) with **sha256 identical to the
  source wasm** — FFmpeg is bundled and works OFFLINE in the app (the web
  deploy excludes only the wasm because of the 25 MB Pages limit; the APK
  has no such limit). `assets/public/app/capacitor-bridge.js` present.
  `assets/capacitor.plugins.json` lists `@capacitor/filesystem` and
  `@capacitor/share` (native plugins registered).
- `node --check` PASS on `capacitor-bridge.js`, `app.js`, `photo.js`;
  `npx cap sync android` clean (2 plugins found).

### Native plugins — what v1 needs and why (minimal, no Firebase/ads/analytics/AI)
- `@capacitor/filesystem` 8.1.5 + `@capacitor/share` 8.0.3.
- Problem they solve: a plain `<a download>` click saves NOTHING from
  inside an Android WebView, and `navigator.share({files})` reports
  "not supported" there — without them, exports made in the app would go
  nowhere.
- `app/capacitor-bridge.js` (new, 6.5 KB; loaded by `app/index.html` and
  `app/photo.html` before `app.js`/`photo.js`; **no-op on the website** —
  it only activates when `window.Capacitor` exists):
  routes every in-app download through Filesystem.writeFile (app Cache
  dir, no storage permission needed) + Share.share (Android share sheet:
  "Save to Files", Drive, WhatsApp, gallery apps, …). Covers real taps on
  the rendered "Download your video" link (capture-phase click listener),
  programmatic `a.click()` downloads — video/photo exports, project
  backups, `downloadText()` — (HTMLAnchorElement.prototype.click patch;
  a detached anchor's click never reaches the document, so both hooks are
  needed), and patches `navigator.share`/`navigator.canShare` so the app's
  existing Share button (`shareLastExport`, `shareSiteLink`) opens the
  native share sheet instead of toasting "not supported".
- Gallery import: NO extra plugin needed. The app's hidden `<input
  type="file" accept="video/*,image/*,audio/*">` (and photo's image inputs)
  open the device picker through Capacitor's WebView file-chooser support
  (BridgeWebChromeClient `onShowFileChooser` → system picker). This is the
  documented Capacitor behaviour; it has NOT been exercised on a real phone
  yet — first phone test must import a real photo/video from the gallery.
- `app.js`/`photo.js` themselves were NOT changed for the APK; only the
  bridge file was added and one `<script>` tag each in `index.html` /
  `photo.html`.

### Install (sideload)
1. On the phone, open https://editora-pro.pages.dev/ and tap
   "Download APK — v1.0.0 (13 MB)".
2. When asked, allow "Install unknown apps" for the browser. No sign-in,
   no account, no payment — ever.
3. Open Editora Pro — it opens straight into the editor (no landing page
   inside the app). All processing is on-device; FFmpeg export works offline.

### Known limits (honest)
- Exports are saved via the Android share sheet (Cache dir + Share plugin),
  NOT straight into the Gallery/Downloads folder — the user picks where the
  file goes on every export. That is the v1 behaviour by design (no storage
  permission, no MediaStore code).
- Large exports go through a base64 round-trip in memory (Filesystem
  writeFile takes base64); a very large video export can use ~1.3× its size
  in RAM while saving. Typical phone exports (tens of MB) are fine.
- Canvas (WebCodecs) export audio/video encoding depends on the device's
  own media encoders; FFmpeg export is the reliable path in-app and is
  offline via the bundled wasm.
- Gallery import via the WebView file chooser and the bridge's save+share
  flow are verified in code + build only — NOT yet exercised on a real
  phone. The first phone pass must: import a gallery video → edit → export
  via Download (share sheet appears, file saves) → export via Share button
  → photo import → photo PNG export. Nothing here is claimed "verified on
  phone" until that pass happens.
