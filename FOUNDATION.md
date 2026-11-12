# Editora Pro — FOUNDATION (Phase 0, frozen 2026-11-12)

Source of truth for the professional rebuild. Roadmap:
`~/workspace/user/files/Editora_Pro_Professional_Redesign_Roadmap_6_5pg0.pdf`.
Current state before this phase: `TEST_REPORT.md` (Stages 1–6 + Job 0 fixes).
This document freezes what later phases build on. Change it only by
explicit decision, recorded with a date.

## 0. Non-negotiable product rules

- Free, no ads, no subscription, no premium-locked tools, no watermark.
- No AI assistant, no generative AI, no AI-powered retouching/captions.
- No feature shown as available until it is implemented and tested.
  Anything not yet built is labelled **"Coming Later"** and disabled —
  never a dead link, dead button, or empty screen.
- No decorative emoji tool grids, no fake controls, no empty popups.
- **No placeholder artwork, ever**: no sample image, no "Your text",
  no demo/test-pattern content on any canvas or empty state. Empty states
  are clean cards with real actions only (Open Image / New Canvas /
  Recent Projects for photo; Import / New Project for video).
- Preserve the user's original files. Never overwrite source media unless
  the user explicitly chooses to replace it.
- Clear error messages for unsupported formats, memory limits, failed
  exports, missing codecs. Never report success for a failed/empty export.
- Offline-first: all editing local (Canvas, Web Audio, IndexedDB,
  vendored FFmpeg). The web build's only network fallback is the FFmpeg
  wasm from a CDN when the vendored core cannot load; the APK bundles it.
- One codebase (`final-deploy/`): the website is only the host/download
  page. The product is the Android app (Capacitor wrapper, built later).

## 1. Page map — 8 sections

| # | Section | Route / view | Contents |
|---|---|---|---|
| 1 | Home | `app/index.html` → `homeView` | Create Video, Edit Photo, Open Project, Recent Projects, Import Media, Storage status (real `navigator.storage.estimate()`), Recently Exported |
| 2 | Video Editor | `app/index.html` → `#app` | Timeline, Preview, Media, Audio, Text, Captions, Transitions, Effects, Filters, Color, Keyframes |
| 3 | Photo Editor | `app/photo.html` | Canvas, Tools, Layers, Properties, Adjustments, Masks, History, Export |
| 4 | Projects | `projectsView` | All, Video, Photo, Recent, Favorites, Drafts, Recovered, Project backup |
| 5 | Media Library | `libraryView` | Videos, Photos, Audio, Imported files, Folders, Favorites, Search |
| 6 | Templates & Assets | `templatesView` | Titles, caption styles, transitions, effects presets, LUTs, shapes, stickers, sound effects |
| 7 | Export Center | `exportView` | Export settings, queue, progress, completed exports, failed exports |
| 8 | Settings | `settingsView` | Appearance, language, autosave, storage, cache, keyboard shortcuts, performance, about |

Navigation behaviour (frozen):
- Desktop: persistent left sidebar with icon + label; active section
  clearly highlighted. Inside the Video Editor the same destinations are
  reachable from the top bar (the editor's left panel is the tool panel,
  not app navigation).
- Mobile (≤900px): compact bottom navigation for the 8 primary
  destinations + a separate tool drawer inside the editors. The bottom
  nav never covers the canvas or timeline; content gets bottom padding.
- Breadcrumb / "Back to Home" action on every screen and in both
  editors; it never loses the current project (projects autosave ~1s
  after each change; navigation does not discard state).
- One modal at a time, always through `openModal()` / `closeModal()` /
  `closeAllModals()`; Escape + backdrop close. The
  `[hidden]{display:none!important}` rule (app.css line 5) must never be
  removed or weakened — it is the P0 fix for the first-load modal stack.

## 2. Design system tokens (§5)

One clean UI font family everywhere; no oversized emoji, no decorative text.

```
--font-ui: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif
--fs-xs: 11px   --fs-sm: 12px   --fs-md: 13px   --fs-base: 14px
--fs-lg: 15px   --fs-h2: 18px   --fs-h1: 26px (screen) / 32px (home hero)
--sp-1: 4px  --sp-2: 6px  --sp-3: 8px  --sp-4: 12px  --sp-5: 16px  --sp-6: 24px
--radius-sm: 6px  --radius-md: 8px  --radius-lg: 12px  --radius-xl: 16px
--btn-h: 32px  --btn-h-sm: 26px  --btn-h-lg: 40px
--icon-sm: 16px  --icon-md: 20px  --icon-lg: 24px
--sidebar-w: 212px  --toolpanel-w: 300px  --inspector-w: 290px
--bottomnav-h: 56px
```

Dark theme (default, restrained professional):
```
--bg: #14161a (app) / #0b1026 (photo)   --bg2: #1d1f24 / #10172a
--panel: #23262c / #141c33              --panel2: #191c21 / #1a2340
--line: #33373f / #263154                --txt: #f2f3f5 / #e8ecf7
--mut: #9aa0ab / #9aa7c7
--acc (ONE blue/cyan accent): #00c8d7 / #06b6d4 (photo) — cyan family only
--ok: #22c55e   --warn: #f59e0b   --err: #f43f5e   --info: #22d3ee
```
Light theme (polished, same tokens, same accent family):
```
--bg: #eef1f6   --bg2: #ffffff   --panel: #ffffff   --panel2: #f1f4fa
--line: #cbd3e0  --txt: #141a33   --mut: #55608a
--acc: #0891b2   --ok: #16a34a   --warn: #b45309   --err: #dc2626
```
Rules: accent is the only saturated hue in chrome (besides semantic
ok/warn/err); panels slightly lighter than background; subtle 1px
borders; consistent button heights (`--btn-h`); aligned panel edges;
selected tool / active nav = accent fill or accent underline, never a
random colour. Icons: one consistent inline-SVG family (Lucide-style,
24×24, stroke `currentColor`, stroke-width 2, round caps/joins) via
`app/icons.js` (`epIcon(name)`, `epHydrateIcons(root)`). **No emoji as a
tool/chrome icon anywhere.** Emoji survive only inside user content the
user adds (e.g. a sticker emoji text clip) — never in chrome, labels,
buttons, or status text. Every icon-only control has a `title` tooltip
and an `aria-label`.

Panels: resizable/collapsible on desktop (drag grips on the video
editor's left/right panels, widths persisted; collapse toggles in the
top bar), contextual drawers on mobile (photo right panel slides in;
video panels collapse behind a Panels toggle). Never stack modals.

## 3. Responsive breakpoints

- `≤900px` — mobile: bottom nav, canvas-first editors, tool drawers,
  touch targets ≥44px, no permanent tool grids over the canvas.
- `901–1280px` — compact desktop: sidebar 212px, tool panel 264px,
  inspector 260px (panels resizable; defaults shrink, never overlap).
- `>1280px` — full desktop: sidebar 212px, tool panel 300px,
  inspector 290px.
- Test at 360px, 768px, 1280px widths and landscape phones. Never
  merely scale the desktop UI down.

## 4. Versioned JSON project format

Module: `app/modules/project-store.js` (`window.EPProjectStore`).
Format version is **1**. Records without `formatVersion` are v1
(the shape shipped by Stages 1–6). `formatVersion > 1` is refused on
open/restore with a clear message ("made by a newer version") — never
silently migrated, never silently dropped.

### Video project record (IndexedDB `editora-pro`, store `projects`, keyPath `name`)
```
{ formatVersion: 1, app: "editora-pro-video",
  name: string, updated: epoch-ms,
  data: string,              // JSON snapshot — see below (snapshot v1)
  mediaIds: string[] }       // ids in store `media` {id,name,type,blob,fav,folderId,addedAt}
```
Snapshot v1 (`data`, produced by `snapshot()`): `clips`, `textClips`,
`audioClips`, `captions`, `keyframes`, `markers`, `color`, `fx`,
`preset`, `rotation`, `flipH`, `flipV`, `cropZoom`, `posX`, `posY`,
`scaleX`, `scaleY`, `projectName`, `capStyle`, `cropRatio`, `fps`,
`rippleAll`, `filterId`, `filterIntensity`, `curves`, `hsl`, `wheels`,
`balance`, `lutName`, `lutIntensity`, `transDir`, `transSpeed`,
`transReverse`, `transIntensity`, `capTracks`, `capTrackSel`,
`audioFx`, `motionBlur`, `splitScreen`, `proxyOn`, `duckOn`, `duckAmt`.
`localStorage["editora-current"]` holds the same record as a fallback.
Media blobs live only in IndexedDB; a project opened on another
device/browser restores the timeline, not the media (backup reports
exactly which media are missing).

### Photo project record (IndexedDB `editora-pro-photo`, key = project name)
```
{ formatVersion: 1, app: "editora-pro-photo",
  w, h, straighten, projectName, savedAt: ISO-string,
  layers: [ {id,name,kind,opacity,blend,visible,locked,clip,adj,
             text,shape,data (PNG dataURL|null), maskData|null,
             children? (groups)} ] }
```
`__autosave__` key holds the last autosave. Undo snapshots are the
same shape minus `formatVersion`/`savedAt` (in-memory only).

### Backup / restore shape
- Video full backup (Export Center): one JSON file
  `{formatVersion:1, app:"editora-pro-video-backup", project, manifest:[{id,name,type,size}], media:{id: dataURL} (only files <5 MB embedded)}`.
  Restore reports missing media by name.
- Photo backup (`.json`): `{formatVersion:1, app:"editora-pro-photo-backup", ...serialize(), savedAt}`.
- Settings: `localStorage["editora-settings"]` (video) /
  `localStorage["editora-photo-theme"]` (photo theme only).
- Export history: `localStorage["editora-export-history"]` (max 50).

### History / reversible commands
Module: `app/modules/history.js` (`window.EPHistory`).
Both editors use a snapshot-based reversible command stack through it:
`push()` (serialize current state), `undo()` / `redo()` (restore a
snapshot), `clear()`, `canUndo()` / `canRedo()`. Video cap 60 entries,
photo cap 25 (full PNG dataURLs). Every edit operation that changes
document state goes through `pushHistory()` / `pushUndo()`; Undo/Redo
must restore exactly the snapshotted state (including UI sync).

## 5. Supported media formats (honest limits)

Import — video editor (`video/*,image/*,audio/*`):
video MP4/WebM/MOV (whatever the browser can decode — no codec is
guaranteed; undecodable files fail with a message, never a silent
skip); images JPG/PNG/WebP/GIF/BMP; audio MP3/WAV/OGG/M4A (browser
decodable). Import of an unsupported type is rejected with a toast
naming the file.
Import — photo editor (`image/jpeg,image/png,image/webp,image/gif,image/bmp`):
JPG, PNG, WebP, GIF, BMP. Images over 4000px on a side are scaled down
to 4000px with a toast saying so.

Export — video: MP4 (H.264 + AAC) via FFmpeg.wasm when the engine
loads, else Canvas + MediaRecorder (H.264 MP4 only if the browser
supports the `avc1` mime; otherwise WebM VP9 and the file is named
`.webm`). H.265 is offered only if a real runtime support test proves
it. Resolutions 480p–4K; 4K/2K render at the device canvas maximum and
fall back to 1080p with a note. Minimum-size failure guard: a recording
below `max(4 KB, duration × 2 KB/s)` is reported as FAILED, never
"Done — 0.0 MB". FFmpeg path renders V1 + audio only; V2 overlays,
text/captions, non-fade transitions and most effects are listed as
skipped per export; Canvas export covers them.
Export — photo: PNG (transparency kept), JPG (transparent areas filled
white), WebP. **No TIFF** — no browser/WebView encoder. Quality
10–100%, optional export width. Frame export from video: PNG/JPG/WebP.
Audio: WAV export for synthesized tones / reversed audio only; no MP3
encoder in-app.

## 6. Module map (scaffolding this phase creates; later phases fill in)

```
app/icons.js                  — icon registry + epIcon()/epHydrateIcons()
app/modules/history.js        — EPHistory reversible-command stack (USED by app.js + photo.js)
app/modules/project-store.js  — formatVersion, validate/migrate/stamp, backup shape
app/modules/tokens.js         — design tokens mirrored for JS (spacing, sizes, breakpoints)
app/modules/README.md         — how to add a module (classic script, window.* export, no bundler)
```
Rules: vanilla JS, no framework, no bundler. Classic `<script>` tags,
load order: `icons.js` → `modules/*.js` → `app.js` / `photo.js`.
Never edit a module's public name without updating both editors.
Splitting the monoliths continues in later phases; every moved piece
must keep working (node --check + jsdom harness + id audit each time).

## 7. §8 acceptance tests (checklist — app is not done until these pass)

- [ ] Photo Editor with no image shows a clean empty state, not a random image.
- [ ] Importing a photo displays the correct image at a sensible fit-to-screen zoom.
- [ ] Crop, rotate and resize visibly change the document and can be undone/redone.
- [ ] Adding a text layer creates editable text; changing font/size/color updates the canvas.
- [ ] Adding, hiding, reordering and deleting layers changes the visible composition correctly.
- [ ] Save, close, reopen and recover a project without losing layers or settings.
- [ ] Export creates a real file in the selected format and reports failures honestly.
- [ ] Video import plays in the preview; timeline trim/split/move changes playback as expected.
- [ ] A transition visibly renders across two adjacent clips; its duration and settings affect output.
- [ ] A filter/effect changes the actual preview and final export, not just a label or thumbnail.
- [ ] Mobile controls remain readable, tappable and do not cover the canvas or timeline.
- [ ] No control is presented as functional if it has no implemented action.

## 8. What this phase changed (Phase 0+1, 2026-11-12)

- This file (the freeze above).
- Removed placeholder/demo content: photo text default "Your text" →
  empty input (fallback "Text" only if added empty); video text default
  "Hello Editora!" → empty input (handler already fell back to "Text");
  collage 2×2 quadrants no longer draw "Photo N" placeholder artwork —
  empty transparent layers named "Photo 1..4". Sticker emoji list kept:
  those are user-added content, not chrome.
- Icons: `app/icons.js` registry; every emoji tool icon in both editors
  replaced with inline SVG (see TEST_REPORT.md Phase 0+1 for counts).
- Nav: desktop left sidebar / mobile bottom nav; Back to Home on every
  screen; mobile tool drawers; panel resize/collapse on desktop.
- Modules: `app/modules/{history,project-store,tokens}.js`; video +
  photo undo/redo now run through `EPHistory`.
- Design tokens + light theme for the photo editor; single-modal rule
  kept (`[hidden]{display:none!important}` untouched).
