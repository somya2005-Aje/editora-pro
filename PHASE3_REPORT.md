# Editora Pro — PHASE 3 REPORT (2026-11-12)

Scope: `final-deploy/app/index.html`, `app.css`, `app.js` ONLY (video editor).
Photo editor files (`photo.html`/`photo.css`/`photo.js`), the landing page
(`final-deploy/index.html`), `TEST_REPORT.md`, `PHASE1_REPORT.md`,
`PHASE2_REPORT.md` and the deploy zip were NOT touched. NOT deployed.
Vanilla JS only. No AI, no ads, no paywall, no watermark, no login —
verified by scan (zero hits for AdMob/AdSense/InMobi/OpenAI/Gemini/Premium
in `app.js`; the single `paywall` hit and the single `window.open` hit are
both inside code comments, not code). No new CDN dependency — the vendored
FFmpeg in `app/vendor/` is reused; nothing new is fetched at runtime.

APK target (user order 06:23 IST, "Browser ke liye mat banana, app ke liye
banao — sab app ke andar ho"): everything built here runs inside the
Capacitor WebView (`capacitor://localhost`). All new controls are plain
buttons / selects / sliders / canvases with pointer events — the curve
editor and the color wheels use Pointer Events, so touch drag works, not
only mouse. No `window.open`, no desktop-only assumption, no new permission.

## What was built

### 1. Transitions — all 54 blueprint transitions, one shared engine
- Registry `TRANSITIONS` (54 + None), grouped exactly as the blueprint:
  Basic (5), Zoom/Slide/Push (13), Wipe/Spin/Blur (11), Glitch/Flash/
  Cinematic (11), Motion/3D/Shape/Creative (14). The picker shows ONLY
  these — every one renders in preview AND in the Canvas export. Items
  marked ◆ (the fade family) also render in the Video Engine export.
- One engine, `transCompute(clip, offset)` → {opacity, scale, tx, ty,
  rot, blur, clipShape, overlay, shake, pixel}, drives preview
  (`applyTransitionPreview` → `refreshVideoStyle` + `drawOverlayFX`),
  Canvas export (transforms + canvas clip paths + overlays + a glitch
  pixel pass in `drawFrame`), and the FFmpeg mapping
  (`ffmpegTransFilter`). The three paths cannot drift apart.
- Every transition supports the blueprint controls, stored per clip
  (transition, transDur, transDir, transSpeed, transReverse,
  transIntensity): Duration 0.2–2 s, Direction (left/right/up/down,
  where meaningful), Speed 25–200% (compresses the ramp), Reverse
  (runs the ramp backwards, where meaningful), Intensity 10–200%
  (scales the magnitude), live preview, and preset saving
  (localStorage `editora-trans-presets`, listed under the panel with
  one-tap load). Legacy ids from old projects (`slide`/`zoom`/`blur`/
  `flash`/`spin`) are aliased to the new ids so old projects still render.
- Real canvas math per type: fades = opacity (+ black/white overlay for
  Fade Black/White); zoom = scale (+ blur for Zoom Blur, overshoot for
  Punch Zoom); slide/push = translate (push travels further than slide);
  wipes = canvas clip paths (rect / circle / clock wedge / diagonal /
  rectangle / diamond); spin/whirl/cube/flip/page-turn/3D-rotate =
  rotation (+ scale); blur family = canvas blur filter; glitch family =
  slice-shift pixel pass; flash/burn/leak/flare = colour overlays
  (flare adds a radial gradient); whip pan / motion sweep = translate +
  blur; camera shake = sinusoidal translate; liquid/ink = scale + blur +
  circle clip; smoke = opacity + blur + grey overlay; mask reveal =
  rect clip + opacity.

### 2. Effects — all 54 blueprint effects, per clip
- Registry `EFFECT_GROUPS` (54 effects in the 5 blueprint groups) with
  `EFFECT_LABELS`. The Effects panel is now grouped; each button toggles
  that effect on the SELECTED video clip (`clip.fx = {effectId:
  strength}` — the clip's effects travel with it through split /
  duplicate / copy-paste, and persist in the project snapshot).
  Strength is the existing Effect strength slider (0–100%) and applies
  when an effect is switched on. Copy / Paste / Clear buttons move a
  clip's whole effect set to another clip. The 8 legacy global effects
  (blur/glow/glitch/vignette/grain/RGB-split/VHS/Noir) are kept as-is
  and merged into the active clip's map by `activeClipFx()`, so old
  projects keep working.
- Rendering: preview = CSS filter/transform approximation on the
  `<video>` element + seeded overlay drawing in `drawOverlayFX`
  (rain/snow/particles/bokeh/dust/scratches, fog/smoke gradient,
  scanlines for CRT/VHS, flicker/strobe, glitch slices, flare/leak
  gradients, halftone dots). Canvas export = real pixel math in
  `applyFxPixels` (+ `remapDistort` for wave/ripple/warp/fisheye/swirl
  and a real per-row luminance sort for Pixel Sort) + 2D overlay
  drawing in `applyCanvasFramePixels`. Every effect below renders in
  at least the Canvas export; the preview column is the approximation.
- Pixel Sort is a real sort (8 px horizontal bands sorted by luminance
  on the rows the strength selects). Noise Reduction is traditional
  spatial denoise (see §4). Nothing is faked with a toast.

### 3. Filters — all 35 named filters (+ Normal)
- Registry `FILTERS` (36 entries). Each filter is real color math
  (brightness/contrast/saturation/exposure/temperature/tint/highlights/
  shadows/sepia/hue + optional pixel op). Every button shows a colour
  swatch thumbnail approximating the look.
- Controls (blueprint Filter Controls): thumbnail (swatch), before/after
  preview toggle (Hold: Before — press-and-hold shows the unfiltered
  preview), intensity slider 0–100% (scales the filter's params),
  apply/remove (tap a filter / Remove filter / Normal), save custom
  preset (saves current grading + filter into the preset list), copy /
  paste settings (copies filter + intensity + all grading: colour,
  curves, HSL, wheels, balance).
- Rendering: preview = `cssFilterString()` (filter params merged with
  the base grading, scaled by intensity); Canvas export = the same
  params inside `applyGradePixels()`; Video Engine = `ffmpegEqFull()`
  (eq + hue) — see the per-filter table; duotone/invert/solarize/
  posterize pixel ops are Canvas-only and are listed as skipped by
  the FFmpeg path in the export result.

### 4. Color grading — all 22 blueprint items, real
- Sliders (Adjustment tab, all in `COLOR_DEFS`, all live): Exposure,
  Brightness, Contrast, Saturation, Vibrance, Temperature, Tint,
  Highlights, Shadows, Whites, Blacks, Gamma, Sharpen, Dehaze, Fade
  (lift blacks), Vignette, Noise Reduction. Presets updated to carry
  every new key so applying one never leaves a stale value behind.
- RGB Curves: a real draggable-points curve editor (canvas, Pointer
  Events — touch drag works; tap to add a point, double-tap a point to
  remove it), per channel RGB / R / G / B, reset per channel. Rendered
  in the Canvas export as per-channel 256-entry LUTs (`curveLUT`) and
  in the Video Engine export as a real FFmpeg `curves` filter
  (`ffmpegCurvesFilter`, only emitted when a curve actually changed).
- HSL: hue shift / saturation / lightness sliders — real RGB↔HSL pixel
  math (`rgb2hsl`/`hsl2rgb`) in the Canvas export. Preview: graded
  still frame (below).
- Color Wheels: three draggable wheels (Shadows / Midtones /
  Highlights) with a strength slider each — the wheel offset pushes
  that tonal range toward a colour, weighted by luminance, in the
  Canvas export pixel math.
- Color Balance: Red / Green / Blue sliders — real channel offsets in
  the Canvas export pixel math.
- LUT import (.cube): `parseCube` parses the file on-device (TITLE,
  LUT_3D_SIZE, data lines; invalid files are rejected with the reason).
  Applied in the Canvas export by trilinear interpolation (`lutApply`)
  blended by the LUT intensity slider, and in the Video Engine export
  via FFmpeg `lut3d` (the .cube text is rebuilt from the parsed data
  and written into the engine; intensity is Canvas-only there and the
  export result says so). The LUT file itself is NOT saved with the
  project — only its name is persisted, and reopening a project tells
  the user to re-import the .cube file.
- Vignette: radial distance darkening in the pixel math (plus the
  existing CSS approximation in preview). Fade: lifts blacks toward
  white, weighted by darkness. Sharpen: unsharp via a 3×3 Laplacian
  blend. Dehaze: midtone contrast + saturation lift. Noise Reduction:
  traditional signal processing — a 3×3 spatial average blended by
  strength — labelled honestly as "Noise reduction (spatial denoise)"
  in the UI.
- Grade preview (still frame): curves, HSL, wheels, balance and LUT
  cannot be shown through the live `<video>` element, so the
  Adjustment tab has a still-frame canvas that draws the current
  video frame with the exact same `applyGradePixels` math as the
  Canvas export (auto-refreshes 300 ms after a control changes, plus
  a manual Refresh button). This is labelled as a still frame, not a
  live preview — the live preview covers the sliders/filters that CSS
  can express.
- Double-grading guard: when pixel grading is active, `drawFrame`
  sets `ctx.filter="none"` and lets the pixel math do all the grading;
  otherwise it keeps the fast CSS-filter path. The grade is never
  applied twice.

## Verification (this session — code + a real functional harness, no live browser)
- `node --check app/app.js` — PASS (re-run after every edit batch).
- **Functional harness** (`/tmp/phase3_test.js`, loads the REAL `app.js`
  in a stub-DOM vm, not a copy of the logic): **39/39 PASS**, including:
  - registries: 55 transition entries (54 + None), all 54 blueprint
    transition ids present, 54 effects, 36 filter entries (35 named +
    Normal), all 35 blueprint filter names present;
  - transitions: fade 0.5 opacity at mid-edge, 1 mid-clip; reverse at
    edge = 1; speed 200% completes early; slideleft tx −120; spin360
    rot 360; circlewipe clipShape {circle, prog 0.5}; fadeblack overlay
    alpha 1; legacy alias slide → slideleft; FFmpeg fade filter
    emitted, slide filter empty (honestly skipped);
  - curves/LUT: curveLUT identity + custom point; parseCube valid 2³
    accepted, garbage rejected; lutApply identity;
  - pixel math: brightness 200 doubles a pixel; a curve point lifts a
    midtone to exactly 200; invert flips a pixel; posterize levels;
    pixelSort + fisheye run; rgbSplit shifts channels; innerShadow
    darkens only edge pixels; gradeActive false at defaults, true with
    vibrance; cssFilterString shows Teal & Orange saturation 1.250; FFmpeg curves filter empty at
    identity, emitted when a curve changes;
  - flows: `init()` runs without throwing (builds all Phase 3 UI);
    `applyFilter('Cyberpunk')` changes state; select clip → set a
    per-clip effect → `activeClipFx()` returns it; snapshot →
    applySnapshot round-trips filter, intensity, HSL and balance.
- **ID audit** (`/tmp/audit_phase3.py`): 351 ids in `index.html`, ZERO
  duplicate ids; all 176 `$("…")` ids referenced in JS exist in the
  HTML (the 16 "missing" hits are the same pre-existing `$$()` class /
  attribute selectors as Phases 1–2 — `.panel`, `.modal`, `.toolbtn`,
  `.itab`, `.tlk`, `.tvis`, `.lib-nav-item`, `[data-nav]`,
  `#alignRow [data-align]`, `#menuDrop [data-m]`, `#projFilters
  [data-pf]`, `#libTabs [data-lt]`, `.appnav [data-screen]`, `.ipanel`,
  `#curveChanRow [data-curve]`, `#fxGroups [data-fx]` — all present);
  all 207 button/select/input controls have a handler/binding; all 51
  new Phase 3 ids exist in HTML and are wired in JS.
- Forbidden scan: zero hits for AdMob/AdSense/InMobi/OpenAI/Gemini/
  Premium; no new `window.open`; no new CDN fetch/import.
- Phase 1–2 regression: the harness `init()` run exercises the Phase 1
  screens/builders and Phase 2 helpers in the same file; the id audit
  covers all pre-existing controls; `transSettings` aliases keep old
  transition values rendering; legacy global effects still merge via
  `activeClipFx()`.

## Render-path tables

Key: P = preview (live video element + overlay canvas; an approximation
where CSS cannot express the math — the graded still frame shows the
real pixels for curves/HSL/wheels/balance/LUT), C = Canvas export
(real pixel math / canvas transforms), F = Video Engine (FFmpeg) export.

### Transitions (54)
| Transition | P | C | F |
|---|---|---|---|
| Fade, Dissolve, Cross Dissolve, Film Dissolve | ✓ | ✓ | ✓ (real `fade` filter) |
| Fade Black, Fade White | ✓ | ✓ | ✓ (real `fade` with color) |
| Zoom In/Out/Through, Zoom Blur, Punch Zoom | ✓ | ✓ | — (listed as skipped) |
| Slide Left/Right/Up/Down, Push Left/Right/Up/Down | ✓ | ✓ | — |
| Linear/Circle/Clock/Diagonal Wipe | ✓ | ✓ | — |
| Spin Left/Right, 360 Spin, Whirl | ✓ | ✓ | — |
| Gaussian/Motion/Radial Blur | ✓ | ✓ | — |
| RGB/Digital/Pixel Glitch, Signal Error | ✓ | ✓ | — |
| White/Black/Camera Flash | ✓ | ✓ | — |
| Film Burn, Light Leak, Lens Flare | ✓ | ✓ | — |
| Whip Pan, Camera Shake, Motion Sweep | ✓ | ✓ | — |
| Cube, Flip, Page Turn, 3D Rotate | ✓ | ✓ | — |
| Circle/Rectangle/Diamond Reveal | ✓ | ✓ | — |
| Liquid, Ink Spread, Smoke Reveal, Mask Reveal | ✓ | ✓ | — |

### Effects (54)
| Effect | P (approx) | C (real) | F |
|---|---|---|---|
| Gaussian / Motion / Radial / Lens / Zoom / Directional Blur | ✓ (CSS blur) | ✓ (3×3 box-blur blend) | — (listed as skipped) |
| RGB Split, Digital Glitch, VHS Distortion | ✓ | ✓ (channel shift / slice shift / chroma shift + scanlines) | — |
| Pixel Sort | ✓ (overlay slices) | ✓ (real per-row luminance sort) | — |
| Camera Shake, Handheld, Zoom Shake | ✓ (CSS jitter) | ✓ (sinusoidal translate in drawFrame) | — |
| Camera Flash | ✓ | ✓ (overlay flash) | — |
| Glow, Bloom | ✓ (drop-shadow) | ✓ (highlight lift) | — |
| Lens Flare, Light Leak, Sun Rays | ✓ (gradient) | ✓ (radial gradient) | — |
| Film Grain, Dust, Scratches, Film Burn, Film Flicker | ✓ | ✓ (seeded noise / specks / warm gradient / flicker) | — |
| Wave, Ripple, Warp, Fisheye, Swirl | ✓ (CSS approx) | ✓ (coordinate remap, nearest sampling) | — |
| VHS, CRT, Old TV, Analog Noise | ✓ (scanlines) | ✓ (chroma shift + scanlines + noise) | — |
| Motion Trail, Echo, Ghosting | ✓ | ✓ (blend with previous exported frame) | — |
| Strobe | ✓ | ✓ (frame on/off by time) | — |
| Drop / Long / Inner Shadow | ✓ (CSS drop-shadow) | ✓ (offset black copy in drawFrame / edge darkening) | — |
| Sketch, Cartoon-style edge, Posterize, Halftone | ✓ | ✓ (edge + levels / dot pattern) | — |
| Rain, Snow, Fog, Smoke, Bokeh, Particles | ✓ (seeded overlay) | ✓ (seeded 2D drawing) | — |
| RGB Shift, Duotone, Invert, Solarize | ✓ | ✓ (pixel math) | — |

### Filters (35 named + Normal)
All 35: preview ✓ (CSS filter string, intensity-scaled), Canvas
export ✓ (same params in `applyGradePixels`), Video Engine ✓ via
`ffmpegEqFull` (eq brightness/contrast/saturation + hue) — EXCEPT the
pixel-op filters, which are Canvas-only in FFmpeg and listed as skipped:
none of the 35 named filters uses a pixel op except where noted below.
Cinematic, Hollywood, Teal & Orange, Moody, Dark Cinematic, Vintage,
Retro 80s, Retro 90s, VHS, Black & White, Sepia, Warm, Cool, Golden
Hour, Sunset, Night, Blue Hour, Film Look, Portrait, Natural, Matte,
Faded, Pastel, High Contrast, Dreamy, Soft Glow, Cyberpunk, Neon,
Horror, Documentary, Wedding, Travel, Food, Landscape, Street
Photography — all P ✓ / C ✓ / F ✓ (eq/hue approximation).

### Color grading (22)
| Item | P | C | F |
|---|---|---|---|
| Exposure, Brightness, Contrast, Saturation, Temperature, Tint, Highlights, Shadows | ✓ (CSS) | ✓ (pixel math) | ✓ (eq/hue) |
| Vibrance, Whites, Blacks, Gamma | ✓ (approx) | ✓ | ✓ (gamma via eq; vibrance/whites/blacks folded into eq) |
| RGB Curves | still-frame ✓ | ✓ (per-channel LUTs) | ✓ (FFmpeg `curves`) |
| HSL | still-frame ✓ | ✓ (RGB↔HSL math) | — (listed as skipped) |
| Color Wheels | still-frame ✓ | ✓ (luminance-weighted offsets) | — (listed as skipped) |
| Color Balance | still-frame ✓ | ✓ (channel offsets) | — (folded into eq approximately; not listed separately) |
| LUT import (.cube) | still-frame ✓ | ✓ (trilinear, intensity slider) | ✓ (`lut3d`, full strength; intensity Canvas-only, stated in result) |
| Vignette, Fade | ✓ (CSS approx) | ✓ | ✓ (folded into eq) |
| Sharpen | ✓ (CSS approx) | ✓ (3×3 Laplacian unsharp) | — (listed as skipped) |
| Dehaze | ✓ (approx) | ✓ (midtone contrast + sat) | ✓ (folded into eq) |
| Noise Reduction | ✓ (approx) | ✓ (3×3 spatial average blend) | — (listed as skipped) |

## Honest Limitations (Phase 3 — what is NOT implemented and why)
- FFmpeg export renders only the fade family of transitions. A real
  cross-clip dissolve/slide/wipe would need an `xfade` graph over
  overlapping inputs; the exporter is concat-based, so those
  transitions are listed by name as skipped instead of faked. The
  Canvas export renders all 54.
- FFmpeg export does not render per-clip effects, HSL, color wheels,
  sharpen or noise reduction — each export result lists exactly what
  was skipped. Curves and LUT do render there (`curves`, `lut3d`).
- Drop Shadow / Long Shadow: the Canvas export draws an offset black
  copy of the frame behind the clip (draw-level); Inner Shadow darkens
  the frame edges in the pixel math. All three also render in the
  preview via CSS drop-shadow / brightness.
- Curves / HSL / wheels / balance / LUT have no live-video preview:
  a `<video>` element cannot take pixel math. The graded still frame
  in the Adjustment tab shows the real pixels; the live preview shows
  the CSS-expressible part. This is labelled in the UI, not hidden.
- The LUT file is not saved with the project (a 33³ LUT is ~100 KB of
  JSON on every autosave). Only the name + intensity persist; the user
  re-imports the .cube file after reopening. The UI says so.
- Pixel grading + distortion run a full-frame `getImageData` pass per
  exported frame. At 1080p on a slow phone this is measurably slower
  than the plain Canvas export (the export is still real-time paced,
  so the file duration stays exact — a slow frame draws stale rather
  than stretching the file, as before).
- Echo / Ghosting / Motion Trail blend with the previous exported
  frame only; they do not trail across a cut, and the first frame has
  no trail. The preview approximation is a brightness lift, not a
  trail.
- Blur effects in the Canvas export use a 3×3 box-blur blend, not a
  true Gaussian kernel — labelled as a blur approximation in the code;
  visually it is a soft blur at the chosen strength.
- Transition "Flip" is a 2D rotation + scale approximation, not a
  true 3D page/cube transform; "Cube" / "Page Turn" / "3D Rotate" are
  2D rotation/scale approximations for the same reason (no WebGL
  pipeline in this build).
- No live-browser / live-WebView run was done in this session (no
  live-browser access from this agent). All verification above is code
  trace + the Node harness against the real file.

## APK-readiness
- WORKS IN A WEBVIEW (no native code needed): all new controls are
  plain buttons/selects/sliders/canvases with Pointer Events (curve
  editor and wheels drag with touch); no new network use; transition /
  effect / filter / grading state is plain timeline/project data, so it
  persists through the existing IndexedDB autosave and restores on
  reload (LUT file excepted — see Limitations); no new permissions.
- The vendored FFmpeg loader is untouched; the new `curves` / `lut3d`
  filters need only the already-vendored engine. `final-deploy/app/
  vendor/` is still the only extra asset the APK must include.
- NOTHING in Phase 3 changes the export engines' structure, the
  deploy packaging, or the photo editor.

## Files changed
- `final-deploy/app/index.html` (585 → 665 lines): Transitions panel
  (grouped picker + direction/speed/intensity/reverse + preset save),
  Effects panel (grouped per-clip list + copy/paste/clear), Filters
  panel (intensity, before/after hold, remove, save/copy/paste),
  Adjustment tab (curves canvas, HSL, 3 wheels, balance, LUT import,
  grade still-frame preview); export-modal hint updated to the fade
  family + curves/LUT.
- `final-deploy/app/app.css` (240 → 249 lines): Phase 3 panel styles
  (fx groups, filter swatches, curve/wheel canvases).
- `final-deploy/app/app.js` (2353 → 3354 lines): Phase 3 section
  (registries, `transCompute`, `ffmpegTransFilter`, `parseCube`,
  `lutApply`, `curveLUT`, `rgb2hsl`/`hsl2rgb`, `applyGradePixels`,
  `applyFxPixels`, `remapDistort`, `applyCanvasFramePixels`,
  `ffmpegEqFull`, `ffmpegCurvesFilter`, UI builders, curve/wheel
  editors, LUT import, grade thumb); wired into `init`,
  `applyTransitionPreview`, `refreshVideoStyle`, `drawOverlayFX`,
  `drawFrame`, `doFFmpegExport`, `selectClip`, `applyPreset`,
  `snapshot`/`applySnapshot`; new colour keys in `COLOR_DEFS`/
  `PRESETS`; `cssFilterString` now merges the filter layer.
- This report: `~/workspace/editora-pro/PHASE3_REPORT.md`.

## Required live check (parent, before announcing)
1. Desktop Chrome (serve `final-deploy` over HTTP): import a video →
   select a clip → apply a Slide transition + a Zoom Blur transition →
   check the preview animates at the clip edges; toggle Invert + Rain
   on the clip → preview changes; apply Teal & Orange at 50% →
   preview changes; drag a curve point → grade still frame changes;
   import a .cube LUT → still frame changes.
2. Export Canvas 720p — confirm the file shows the transition, the
   effect and the grade; export Video Engine — confirm the fade-family
   transition + curves/LUT render and the result lists the skipped
   transitions/effects by name.
3. Same flow on one Android phone (touch only): drag a curve point
   and a color wheel with a finger; all new buttons are tappable;
   no keyboard needed.
