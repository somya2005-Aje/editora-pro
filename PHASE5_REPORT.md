# Editora Pro — PHASE 5 REPORT (Photo Editor expansion)

Date: 2026-11-12. Scope: `final-deploy/app/photo.html`, `photo.css`, `photo.js` ONLY.
Parallel agent owns `app/index.html`, `app.css`, `app.js`; landing page, `TEST_REPORT.md`
and the deploy zip were NOT touched. NOT deployed. Vanilla JS + Canvas API only.
No AI, no ads, no paywall, no watermark, no login.

## What was built (§4 of the Ultimate Blueprint)

### 1. Selection tools (all real, on the canvas)
- **Ellipse select** — drag an ellipse; marching ants + feather/expand/contract/invert all work with it.
- **Polygon Lasso** — tap/click to place vertices, double-tap or Enter to close (touch-friendly, no keyboard needed).
- **Quick Selection** — tolerance-based region grow from the tap point; dragging adds to the region.
- **Color Range** — tap a color; every pixel in the image within tolerance is selected.
- **Magic Wand** — tolerance click, contiguous region only.
- Pixel selections are stored as a real mask canvas. **Feather / Expand / Contract / Invert**
  verified in code to work with every selection type (shape selections expand/contract
  geometrically; mask selections dilate/erode by offset-stamping / 4-direction intersection).

### 2. Brush tools (real pixel ops on the active layer)
Pencil (hard 1px strokes), Airbrush (soft spray, Flow slider), Blur Brush (blurred patch
stamped through a soft radial mask), Sharpen Brush (3×3 convolution, strength-scaled),
Smudge Brush (patch dragged from the previous point), Dodge / Burn (per-pixel lighten/darken
with radial falloff), Sponge (saturate/desaturate mode switch). All share Brush size/opacity;
Flow and Strength sliders added to the Brush panel.

### 3. Layers & Masks
- **Layer Groups** — folder layers: create (active layer moves inside), collapse/expand,
  drag layers into a group or reorder inside it, group opacity multiplies children,
  move as a unit (group rows move/duplicate/delete with their children).
- **Merge Down** — active layer composited into the layer below (blend + opacity honoured).
- **Flatten Image** — all layers composited to one Background layer.
- **Clipping Masks** — toggle per layer; pixels only show where the layer below is opaque.
- **Adjustment Layers** — a layer type with no pixels; its adjustments are applied to the
  running composite of everything below it, non-destructively (edit it with the normal
  Adjustments panel).
- **Blend modes extended 8 → all 16**: Normal, Multiply, Screen, Overlay, Soft Light,
  Hard Light, Darken, Lighten, Color Dodge, Color Burn, Difference, Exclusion, Hue,
  Saturation, Color, Luminosity (all real `globalCompositeOperation` values at composite time).

### 4. Adjustments
- **RGB Curves** — real curve editor on a 220×220 canvas: draggable points, per-channel
  RGB/R/G/B, tap the line to add a point, double-tap a point to remove it; applied as a
  per-channel 256-entry LUT.
- **Levels** — black point / white point / gamma sliders.
- **HSL** — hue shift / saturation / lightness sliders (per-pixel RGB↔HSL).
- **Color Balance** — shadows / midtones / highlights RGB sliders, weighted by luminance.
- **LUT import (.cube)** — parsed on-device (size + data rows, comments/TITLE/DOMAIN lines
  skipped), nearest-neighbour 3D lookup with an intensity slider. Applied per layer.

### 5. Filters & Effects (new presets, all real pixel math — no CSS filters)
Added 15 presets: HDR, Neon, Glow, Soft Focus, Emboss, Oil Paint, Pencil Sketch,
Edge Detection, Color Splash, Halftone, Posterize, Cinematic, Matte, Pastel, Dreamy.
Implemented in `applyFx` via convolution (emboss/HDR-sharpen), Sobel edges (edge/neon),
screen-blended blur (glow), blur-mix (soft focus), colour-step quantise (oil/posterize),
grayscale→invert→blur→dodge (pencil sketch), dot-grid rasterisation (halftone),
hue-gated desaturation (color splash, reference colour = brush colour).
Previously existing 12 presets kept.

### 6. Retouching
- **Spot Healing** — single tap patches a blemish from nearby pixels through a feathered
  mask (labelled honestly; NOT content-aware).
- **Red-eye correction** — tap a red eye; red pixels in the region are desaturated + darkened.
- **Skin-tone adjustment** — selection (or whole layer) + warmth slider + smoothing slider
  (blur blended inside the region).
- **Teeth whitening** — manual masking brush: desaturates yellow + brightens where painted.
- **Manual smoothing** — blur brush within the painted area.
- **Local exposure** — painted mask + exposure slider (−100…+100).
- **Selective color** — pick a colour (tap the canvas), then hue/saturation/lightness sliders
  applied only to pixels near that hue, inside the selection if one exists.

### 7. Background editing
- **Refine Edges** — feather + expand + contract sliders on the active selection/mask,
  Apply/Reset buttons, live re-render.
- **Background replacement** — select the subject, then Delete background (everything outside
  the selection → transparency), Fill background with colour, or Fill background with an image
  (in-app file picker, cover-fit).

### 8. Basic tools
- **Perspective transform** — drag the 4 corners to skew the active layer; preview draws the
  layer through the quad (two-triangle affine split); Apply bakes it onto the layer canvas.
- **Free Transform** — corner handles scale, edge handles shear, top circle handle rotates;
  Apply bakes it. Leaving the tool without Apply discards the unapplied quad.
- **Warp: OMITTED** (no bulge/pinch mesh implemented; not listed anywhere in the UI).

### 9. Graphic Design Studio
Preset buttons really create new documents at exact dimensions: YouTube thumbnail 1280×720,
Instagram post 1080×1080, Instagram story 1080×1920, Facebook cover 820×312,
Facebook post 1200×630, Poster A4 1240×1754, Banner 1200×300, Logo canvas 1000×1000,
Collage 2×2 (1080×1080 with 4 labelled quadrant layers), custom W×H canvas,
transparent-background checkbox (blank doc with no white fill — transparent PNG export
already existed). Photo frames: Simple / Double / Polaroid / Rounded border layers.
Gradients (linear/radial) and patterns (checker/dots/lines) as fill on a new layer or
inside the selection.

### 10. Workspace
Bottom status bar now has zoom %, image dimensions, and canvas controls (zoom in/out,
Fit, 100%) in addition to the existing left zoom row. Left toolbar (icons + labels +
tooltips) and right panels kept.

## Verification (this session — no live browser available to this agent)
- `node --check photo.js` — PASS.
- ID/handler audit (scripted): **290 ids in photo.html, 0 duplicates; all 194 `$("…")`
  references in photo.js exist in HTML; all 190 button/select/input controls wired**
  (tool buttons via `.tool-btn` delegation, adjustment sliders via the `ADJ_KEYS` loop,
  color-balance sliders via `cbBind("…")` string literals, preset/frame buttons via
  `data-design` / `data-frame` delegation).
- **DOM-stub harness** (`/tmp/photo_harness.js`, Node): executed `init()` and fired
  160 checks — every tool button, every new button (groups/merge/flatten/clip/adj-layer/
  refine/background/retouch/transform/design/LUT/curves/status-zoom), every new slider
  input, and a full canvas pointerdown→move→up flow per tool (brush, pencil, airbrush,
  blur, sharpen, smudge, dodge, burn, sponge, rect/ellipse/lasso/poly/quick/wand/color-range,
  spot-heal, red-eye, whiten, smooth, local-exp, clone, heal, bucket, picker, crop, shape,
  text, move), polygon close via double-tap, transform + perspective apply/cancel,
  curves drag, Enter/Escape keys — **160 OK, 0 failures**.
- **Pixel-level tests** (`/tmp/photo_pixel_test.js`, real in-memory canvas):
  curve LUT identity/interp, HSL round-trip (4 colours), `.cube` parse (2³ LUT + bad-file
  rejection), and every FX (posterize, edge, emboss, halftone, oil, sketch, HDR, neon,
  glow, soft focus, color splash) verified to actually change pixels as specified —
  **22 pass, 0 fail**. (Soft-focus initially "failed" only because the test's fake canvas
  ignored `ctx.filter` blur; after adding a box-blur to the fake it passes — real browsers
  apply `ctx.filter`, the same mechanism Stage 4 blur already uses.)
- **Trace (one real flow per new tool, in code):** wand → `regionGrowMask` →
  `S.sel={type:"mask"}` → `buildSelMask` → `selOpDelete` destination-outs the mask;
  curves drag → `curvesPoints` → `invalidateAdj` → `applyAdj` curve LUT; LUT import →
  `parseCube` → `LUT_STORE` → `applyAdj` 3D lookup; transform drag →
  `transformHandleAt` → `S.transform.quad` → `drawQuadImage` preview → `applyTransform`
  bakes via `drawQuadImage`; design preset → `newDesignDoc(w,h,…)` → `S.docW/docH` set,
  `fitZoom`, save-then-toast.
- Existing behaviour preserved: top-bar Open Image button, empty-state behaviour,
  ~1 s autosave with save-before-toast, undo/redo snapshots (now serialise groups,
  adjustment layers, clipping flag, curves/levels/HSL/color-balance/LUT name), IndexedDB
  store unchanged (`editora-pro-photo`), Stage 4 snapshot format still loads
  (old snapshots lack the new fields; defaults are merged on restore).

## APK-readiness (per the user's order: the Android app is the product)
- **Works in a Capacitor WebView (`capacitor://localhost`) as built:** everything in
  `photo.*` is vanilla JS + Canvas 2D + IndexedDB with **zero runtime CDN dependencies**
  (verified: no `http(s)://` URLs, no `window.open`, no `localhost` references in any
  photo file). All processing is local on-device; projects save on-device (IndexedDB);
  import uses the in-app `<input type="file">` picker, which in a Capacitor WebView
  opens the system gallery/file chooser.
- **Touch-first:** every action is reachable by tap — no desktop-keyboard shortcut is the
  only path to anything. Clone-stamp source setting works via 600 ms touch long-press
  (kept from Stage 4); polygon lasso uses taps + double-tap/Enter; transform uses drag
  handles; all panels have buttons. Touch targets follow the existing mobile bottom
  toolbar / right-drawer pattern; new tools were added to the same toolbar grid.
- **Needs native/Capacitor plugins (not yet wired — the app shell must add them):**
  1. **Save/share to device** — export currently triggers an `<a download>` click.
     In a desktop browser that downloads a file; inside a Capacitor WebView the download
     may not land in the gallery. Needs `@capacitor/filesystem` (write the exported blob
     to cache/files) + `@capacitor/share` (or MediaStore save) for "save to gallery".
  2. **Gallery import** — the file input works in the WebView, but a native picker
     (`@capacitor/camera` `getPhoto` / Filesystem) gives a better gallery experience and
     handles large images without the WebView file-input quirks on some Android versions.
  3. **No other native needs:** no camera capture is used by the photo editor itself,
     no network, no push, no billing.
- **Gaps remaining:**
  - Export inside the app is untested in a real WebView — the download-click path must be
    replaced/verified with the Filesystem+Share plugins above before the APK is announced.
  - **LUT does not persist across reload** — parsed `.cube` data lives in the in-memory
    `LUT_STORE`; the layer stores only the LUT name + intensity, so after a reload the
    adjustment is skipped and the panel says "not loaded — re-import the .cube file".
    (Persisting multi-KB LUT arrays into the IndexedDB snapshot was deferred to keep
    project JSON small.)
  - Transform preview draws the transformed layer as a 55%-alpha ghost over the composite
    (the untransformed layer is still underneath until Apply); it is a preview, not the
    final pixels.
  - Group opacity + per-layer adjustments interact through a shallow copy in
    `flatLayers()` (adjustment cache is shared with the original layer); visually correct
    in normal use, but an adjustment edited while its group opacity is non-100% may need
    one extra render to refresh.
  - No live-browser or on-device test was possible in this session (no browser access from
    this agent): the parent must smoke-test on desktop Chrome + one Android phone / the
    Capacitor build before announcing — open image → wand select → delete → curves →
    LUT import → group + merge down → design preset 1080×1080 → export PNG.

## Honest Limitations (everything omitted + why)
- **Warp (bulge/pinch mesh): omitted** — not implemented, not listed in the UI.
- **Magnetic lasso: omitted** — needs real edge-snapping; lasso stays freehand, polygon
  lasso is the precise alternative.
- **Content-aware healing: omitted** — needs an inpainting engine; Spot Healing and the
  Healing tool are feathered clones and say so in the UI.
- **TIFF: omitted** — no browser/WebView encoder; import/export stay JPG/PNG/WebP/GIF/BMP.
- **LUT persistence: not persisted** (see APK-readiness above) — re-import after reload.
- **Quick Selection / Wand / Color Range** use RGB-distance tolerance on the composite
  canvas; they do not do edge-aware refinement beyond the Refine Edges feather/expand/
  contract controls.
- **Adjustment layers** apply to the composite of all layers below, including other
  adjustment layers below them; they cannot target a single layer.
- **Perspective/Free Transform** bake pixels (rasterises text/shape layers first, with a
  toast); the transform is not re-editable after Apply (undo restores it).
- **Performance:** adjustments are `getImageData` per layer; curves/levels/HSL/LUT add
  per-pixel work, so slider drags on near-4000px images can lag briefly (same caveat as
  Stage 4; identity adjustments skip the pipeline entirely).
