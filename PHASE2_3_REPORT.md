# Editora Pro — Photo Track, Phases 2 + 3 — Report

**Agent:** photo track (Phases 2 + 3) · **Date:** 2026-11-12
**Scope — ONLY these files were touched:**
- `final-deploy/app/photo.html` (666 lines, 52,936 B)
- `final-deploy/app/photo.css` (261 lines, 16,354 B)
- `final-deploy/app/photo.js` (3,150 lines, 166,448 B)

No other file was modified: not `app/index.html`, `app.css`, `app.js`, `icons.js`, `modules/`, `TEST_REPORT.md`, landing page, `deploy.py`, or the zip. No deploy, no APK build.

**Sources read first:** roadmap PDF `Editora_Pro_Professional_Redesign_Roadmap_6_5pg0.pdf` (§3, §5, §6, §8), `FOUNDATION.md` (frozen tokens, project format v1), `TEST_REPORT.md` (prior state + Job 0 fixes — all preserved, see §6).

---

## 1. What was built — Phase 2 (Photo Editor MVP)

Layout rebuilt to roadmap §3 on top of the Phase 1 shell (persistent sidebar, shared `icons.js` SVG registry, frozen design tokens — reused, not redefined).

**Desktop shell**
- Top menu bar: **File, Edit, Image, Layer, Select, Filter, View, Help** — every menu opens real actions (~45 in `MENU_ACTIONS`); the Filter menu is populated from the 27 `FILTER_PRESETS` by JS. Only one menu open at a time; Escape closes menus.
- Undo / Redo / Save Project / Export follow the menus (top bar + mobile top bar).
- Left vertical **labelled** toolbar, 11 canonical tools with SVG icon + text label + tooltip: **Move, Selection, Crop, Brush, Eraser, Clone/Heal, Text, Shape, Gradient, Hand, Zoom**. Group flyouts: Selection (7 variants: rectangle, ellipse, lasso, polygon lasso, magic wand, quick selection, free select), Brush (9 variants: brush, airbrush, pencil, blur, sharpen, smudge, dodge, burn, sponge), Clone/Heal (4: clone stamp, healing, spot healing, red-eye). Picking a variant updates the canonical button's icon, label, and `data-tool`.
- **FG/BG color row** under the toolbar: foreground `#ff3366`, background `#06b6d4`, swap button (X key). Both swatches are real `<input type="color">` controls.
- Center: large canvas on checkerboard/neutral stage. **Before import, a clean empty-state card** with Open Image + Create New Canvas + **Recent Projects** (last 5 saved projects, newest first). No sample artwork, no "Your text", no test pattern anywhere.
- Right panel with **4 real tabs: Layers / Properties / Adjustments / History**.
- Bottom status bar: zoom %, image dimensions + layer count, **color profile** ("Color: sRGB (canvas working space)" when a doc is open), active tool, contextual hint.

**Mobile (≤900px)**
- Top bar: Back / doc name / Undo / Redo / Save / Export + overflow menu.
- Bottom nav: **Tools / Layers / Adjust / Text / More** (touch targets ≥44px). Tools opens the left toolbar as a bottom sheet; Layers/Adjust open the right panel as a slide-in drawer; Text selects the Text tool + Properties tab; More opens a popover (Export, Save, Open, New, History, Filters, New from Preset, Theme). Nothing permanent covers the canvas.
- **Pinch zoom + two-finger pan** via Pointer Events (`S.pointers` tracking; second finger cancels the single-pointer gesture and starts a pinch: zoom = z0 × d/d0, pan via stage scroll). Canvas has `touch-action:none`.

**Functionality (all real, all pixel-verified where harness-able)**
- Open image by button click, drag-drop onto the canvas, and canvas click (empty-state Open Image + top-bar Open Image + Ctrl+O). Import JPG/PNG/WebP/GIF/BMP; >4000px/side scaled to 4000px with a toast.
- Zoom/pan (wheel, Zoom tool click/marquee, Hand drag, fit/100% menu actions).
- Crop with confirm/cancel + **8 transform handles** (corners + edge midpoints, drawn in the overlay, draggable with ratio constraint); rotate 90° L/R; flip H/V; resize (exact W/H inputs).
- Brush: size / hardness / opacity / **spacing** (default 25%, step = size × spacing/100) / flow / strength, FG/BG color. Eraser. Text: editable text layers — font, size, color, **weight (400/700), align (left/center/right)** update the canvas live. Adjustments: brightness, contrast, exposure, saturation, temperature, **tint** (new slider; + = magenta shift, real pixel math in `applyAdj`).
- Layers: add / delete / duplicate / rename / reorder / hide / lock / opacity / 16 blend modes / group / ungroup / merge down / flatten / clipping mask / layer masks / adjustment layers (non-destructive).
- **Undo/redo with NAMED history actions**: `pushUndo(name)` records a parallel `histLog` (cap 25) alongside `EPHistory` snapshots; ~50 call sites named (e.g. "Brush stroke", "Crop", "Rotate 90°", "Add text layer", "Apply filter: B&W", "Gradient linear layer", "Merge down", "Flatten image", "Apply LUT"). History tab lists "Current state" + newest-first past actions + redo entries; **click an entry to jump** to that state.
- Save project: versioned JSON v1 via `EPProjectStore` (IndexedDB `editora-pro-photo`), `__autosave__` key, backup download / restore from `.json`.
- Export: **confirmation modal** — renders to blob first, shows real dimensions/format and **estimated file size** (`fmtSize`), Download enabled only when the blob is ready; failure (null blob) shows an honest error in the modal. PNG (transparency kept), JPG (transparent areas filled white), WebP, quality + export-width inputs.

**Kept working from the earlier build:** clone stamp, healing, masks, filters, all selection tools — each re-verified after the rebuild (harness §4); two real bugs found and fixed in the process (see §5).

## 2. What was built — Phase 3 (Photo Advanced)

- **Selection:** rectangle, ellipse, lasso, polygon lasso, magic-wand-style color selection, quick selection, feather, invert, deselect. Clearly visible marching-ants boundary (animated overlay, `antsOffset` interval).
- **Clone/heal:** real pixel ops with brush size / hardness / sample source / strength. Clone stamp Alt-click sample (green crosshair + circle source marker drawn in the overlay); healing = labelled feathered clone; spot healing; red-eye correction (real pixel op — desaturates/red-removes the clicked eye region).
- **Masks:** paintable layer masks, clipping masks, adjustment layers (non-destructive). **All 16 blend modes:** Normal, Multiply, Screen, Overlay, Soft Light, Hard Light, Darken, Lighten, Color Dodge, Color Burn, Difference, Exclusion, Hue, Saturation, Color, Luminosity.
- **Shapes:** rectangle, ellipse, line, **polygon** (regular n-gon, sides slider 3–8, default 5, live-updating) + **Gradient tool** (drag → live preview overlay → real gradient layer, linear along the drag vector or radial from drag start, FG→BG colors; or fills the active selection if "fill selection" is checked).
- **History panel:** named actions, click to jump (see Phase 2).
- **Curves / Levels / HSL / Color Balance** adjustments; LUT `.cube` import/apply (in-memory only — see §7).
- **WebP export** (in the export modal alongside PNG/JPG).
- **Performance:** only visible layers are rendered; undo snapshots capped at 25; per-pixel adjustments note the 4000px lag limit (see §7).
- **Graphic Design Studio presets at exact sizes** (YouTube thumbnail, Instagram post/story, Facebook cover/post, poster, banner) via the existing canvas-size mechanism — 9 presets in the Properties tab + "New from Design Preset…" menu/modal.

## 3. Verification — evidence

### 3.1 New harness: `verify/photo_phase23_harness.js` — **89 passed, 0 failed**

jsdom + node-canvas (real pixels) + fake-indexeddb. Run: `cd ~/workspace/editora-pro/verify && node photo_phase23_harness.js` (~30 s).

It drives real flows on a 1080×1080 design-preset document (avoids jsdom file-load Image issues): brush pixel paint, undo/redo pixel round-trip, brightness/tint pixel math, text layer add + live size change (dark-pixel count), layer add/dup/del/hide/reorder, gradient layer, selection delete, crop with handle resize, resize, rotate/flip by pixel remap, clone stamp, zoom/hand tools, Filter menu, history jump, save/close/reopen via IndexedDB, export PNG + JPEG with real size + download trigger, mobile bottom nav, flyouts, keyboard shortcuts, menu open/close/Escape, single-modal rule, no-emoji DOM check, icon hydration.

All 89 checks (final run): load/icons/chrome (5), empty state (3), modals/menus (7), toolbar (3), right panel/status/mobile (4), filters/blend/presets/coming-later (4), doc create (4), brush + undo/redo (6), clone (3), adjustments (3), text (3), layers (5), gradient (2), selection (2), crop (2), resize (2), rotate/flip/reorder (4), zoom/hand (2), filter menu (1), history (3), save/close/reopen (4), export PNG+JPEG (8), mobile nav (4), flyouts (3), keys (2).

### 3.2 Static audit: `verify/audit.py` — **0 failures**

- `photo.html`: 342 ids, 0 duplicates.
- `photo.js` → `photo.html`: all 228 JS id refs resolve.
- All id'd controls wired or data-driven (after the swatch fix, §5).
- Icon-only buttons all have title/aria-label; icons: 126 in registry, 108 used, 0 unknown.
- `photo.css`: `[hidden]{display:none!important}` present.
- No placeholder/demo content in photo.html/photo.js; no unexpected external URLs (only the FFmpeg CDN fallback); no `window.open`.

### 3.3 `node --check photo.js` — PASS.

### 3.4 §8 photo acceptance tests — mapping

| §8 test | Evidence |
|---|---|
| Clean empty state | Harness: visible on load; Open + blank canvas + Recent Projects; no placeholder text; zero modals open on load. |
| Import shows correct image at fit zoom | **Harness uses design-preset creation, not file import** (jsdom cannot drive the file picker). Import code path (`newDocFromImage`, Image decode) is exercised indirectly by save/reopen (dataURL Image loads). **Real file import is a live-test item** (§8). |
| Crop / rotate / resize change doc + undo/redo | Harness, pixel-level: crop 1080→500×500 + undo; resize →640×480 + undo; rotate/flip by pixel remap + undo. |
| Text layer editable | Harness: add text layer, live size change changes canvas pixels. |
| Layers add/hide/reorder/delete change composition | Harness: add/dup/del/hide/reorder, each pixel- or list-verified. |
| Save/close/reopen/recover without losing layers/settings | Harness: save toast + Recent Projects list; close → empty state; reopen via Recent restores 1080×1080 doc. **Autosave crash-recovery on reload not exercised in harness** (fake-indexeddb is per-process; a reload test needs a second JSDOM over the same DB) — live-test item. |
| Export creates a real file + honest failures | Harness: PNG + JPEG blobs with real byte sizes, download triggered with correct filename, toast confirms size; confirmation modal + disabled-until-ready Download. Null-blob failure path is code-reviewed only, not triggered in harness. |
| Mobile controls readable/tappable, don't cover canvas | Harness: bottom-nav actions + drawer open/close verified. **Real 360px layout is a live-test item.** |
| No control presented as functional without an implemented action | Audit: every id'd control wired; the single unimplemented item (Rotate View) is disabled + labelled "Coming Later". |

## 4. Bugs found during verification (all fixed in the app, not the tests)

1. **`flow` / `strength` had no defaults** in `S.brush` — airbrush, blur, sharpen, smudge, dodge, burn, sponge painted **nothing** until the slider was touched once. Defaults added (`flow:60, strength:50`); this was a genuine pre-existing bug in the earlier build.
2. **Clone/healing strokes left dotted gaps** — `strokeAt` dabbed clone/heal only at the segment endpoint, so fast drags skipped the pixels between pointermove events (brush interpolates; clone didn't). Fixed: clone/heal dabs now interpolate along the segment at the brush-spacing step.
3. **FG/BG swatch rim unclickable** — the 2px button padding around the nested color input did nothing on click. Added explicit click-forwarding (`fgSwatch` → `brushColor.click()`, same for BG). Also cleared the audit's only failure.
4. **`setPointerCapture` crash in jsdom** — calls in `bindCanvas`/`bindCurves` wrapped in try/catch (harmless in real browsers, hardens older engines).
5. **Harness-only issues (not app bugs):** history-jump waits must wait for the *specific* target entry to reach the redo section (undo restores decode large PNG dataURLs async — slow in jsdom, ~1s+ for 4 layers; a too-short wait let a late `restoreSnap` resurrect a closed document); clone/text pixel assertions must avoid sampling the clone-source crosshair marker (`#22c55e` at the exact sample point) and the text glyph centre.

## 5. Job 0 fixes — preserved (verified, not regressed)

1. Open Image button in top bar + empty-state click + Ctrl+O — all present and wired (harness: empty state + menu bar checks; audit: id refs resolve).
2. "Drop image to open" hint only for file drags + `dragend` hides it — code untouched in behavior.
3. ~1s autosave debounce + save-before-toast in import, serialised saves — code untouched in behavior (save/close/reopen harness checks pass).

## 6. Coming Later list

- **Rotate View** (View menu) — disabled, labelled "Coming Later". This is the only Coming Later item in the photo UI.
- Everything else shown in the UI is implemented. (Pre-existing omissions carry over: content-aware healing and magnetic lasso are not implemented — healing is labelled as feathered clone, not content-aware.)

## 7. Honest limitations

Carried over from TEST_REPORT.md (still true):
- Adjustment layers affect everything below them, not single layers.
- LUT is in-memory only (name persisted, file must be re-imported after reopen).
- Transform preview shows a 55% ghost until Apply.
- Per-pixel adjustments can lag near the 4000px cap.
- Undo snapshots store full PNG dataURLs (max 25).
- Straighten must be applied before precise crop/selection.
- Blur is a 3×3 box-blur blend, not true Gaussian.

New / confirmed this round:
- Undo/redo restores are async Image decodes; in jsdom with 4 large layers they take ~1s+ (in a real browser they are fast, but a rapid double-undo immediately after a big undo could briefly show a stale composite — not observed, just the mechanism).
- Harness cannot drive the real file picker, real drag-drop from the OS, real pinch gestures, or a real 360px touch layout — those are live-test items (§8).
- WebP export is in the UI but was **not** exercised by the harness (only PNG + JPEG blobs were produced); verify in a real browser.
- The old Phase 0+1 harness (`verify/harness.js`) asserts "32 tool buttons" — that expectation now **fails by design** (the toolbar is 11 canonical tools + flyout variants). The coordinator should update that expectation; I did not edit the old harness.

## 8. What the parent must live-test (real browser / real phone)

1. Real file import: file-picker open, drag-drop a JPG/PNG/WebP from the OS, canvas click to open — image appears at fit zoom, correct dimensions in the status bar.
2. Pinch zoom + two-finger pan on a real phone; bottom sheets at 360px (Tools sheet, Layers/Adjust drawers) don't cover the canvas and all targets are ≥44px.
3. WebP export in a real browser (real file, correct extension/size).
4. Crop-handle dragging with mouse and touch (corner + edge handles, ratio constraint).
5. Export confirmation flow end-to-end (modal → real size → Download → file on disk).
6. Save → close → reopen on device, including autosave recovery after a reload.
7. Clone/heal stroke continuity on a fast drag (the gap fix, §4.2) and the clone-source marker visibility.
8. The full menu surface once (every File/Edit/Image/Layer/Select/Filter/View/Help item does what it says — the harness covers the main flows; a human pass over the ~45 actions is cheap insurance).

## 9. Files added (verify only, not app code)

- `verify/photo_phase23_harness.js` — the 89-check harness (run as above). Deps installed in `verify/node_modules` (jsdom, @napi-rs/canvas, canvas, fake-indexeddb).
- Scratch probes (`probe*.js`, `dbg.js`) were deleted after use; the harness is the kept artifact.
- This report: `PHASE2_3_REPORT.md`.
