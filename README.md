# Editora Pro — Free All-in-One Video & Photo Editor

**FREE · AD-FREE · NO AI · NO WATERMARK · NO LOGIN · NO PAYWALL**

Built from `Editora_Pro_Master_Prompt_2_vvx5.pdf` (in `~/workspace/user/files/`).
HTML + CSS + Vanilla JavaScript only. No frameworks, no ads, no analytics,
no AI assistant or generative features. All processing happens on the user's
device; files are never uploaded anywhere.

## Deploy layout (Cloudflare Pages Direct Upload — files at zip root)

```
final-deploy/
  index.html        Landing page (root)
  app/
    index.html      The editor app
    app.css
    app.js          Video editor logic
    photo.js        Photo editor logic
  assets/logo.svg
```

A ready-made zip is at `~/workspace/editora-pro/editora-pro-deploy.zip`
(files at zip root, verified with `unzip -l`). Upload it as a Cloudflare
Pages Direct Upload. Landing: `/`, app: `/app/`.

To run locally: serve the folder over HTTP, e.g.
`cd final-deploy && python3 -m http.server 8000` then open
http://localhost:8000/ (file:// works for most features, but video/audio
and IndexedDB prefer http://).

## What works

### Video editor
- Import video/image/audio (file picker + drag & drop anywhere), Media Library
  with thumbnails, search, favorites, sort, delete
- Preview: play/pause, frame step, seek, speed 0.25–2×, volume, fullscreen
- Trim (in/out sliders + numeric), split at playhead, duplicate/delete clips
- Timeline: video / text / audio tracks, click-to-seek, drag clips, drag trim
  handles, zoom, snap to playhead, track lock
- Rotate 90/180/270, flip H/V, crop ratio + zoom, freeze frame, reverse preview
- Color grading: brightness, contrast, saturation, exposure, temperature,
  tint, highlights, shadows, sharpness + 7 presets + save custom preset
- Effects: blur, glow, glitch, vignette, film grain, RGB split, VHS, Noir
- Transitions: fade, dissolve, slide, wipe, zoom, blur, flash, spin (+ duration)
- Text overlays (font/size/color/bg/outline/shadow/position/animation),
  manual captions with timing, karaoke highlight, SRT import, SRT/VTT export
- Audio: import, volume, fade in/out, mute, ducking, bass/treble, waveform,
  voice recording via mic (MediaRecorder)
- Keyframes: opacity / scale / position X / Y at playhead, interpolated in preview
- Undo/redo (Ctrl+Z / Ctrl+Y), keyboard shortcuts (Space, S, Del, arrows)
- Export: 480p/720p/1080p/2K/4K, 24–60 FPS, WebM/MP4, bitrate, progress,
  cancel — via canvas.captureStream + MediaRecorder. **No watermark.**

### Photo editor
- Open JPG/PNG/WebP/BMP/GIF; crop (drag), rect-select → crop, resize presets
  (YouTube thumbnail, Instagram post/story, Facebook post), rotate, flip,
  straighten
- Adjustments: brightness, contrast, saturation, exposure, temperature
  (live on canvas) + 11 filters (Normal, Vintage, B&W, Warm, Cool, Vivid,
  Sepia, Noir, Fade, Duotone, Retro, Bright)
- Layers: text / shape / sticker / image, reorder, opacity, blend modes,
  hide/show, lock, duplicate, delete, rename-by-edit (double-click text)
- Brush, eraser, color picker (eyedropper), paint bucket (flood fill)
- Export: JPG/PNG/WebP, quality slider, custom width, transparent PNG option

### Projects / Templates / Settings
- Auto-save (10 s debounce) to IndexedDB + localStorage fallback, manual save,
  project list, rename, duplicate, delete, JSON backup import/export, recovery
  notice on load
- 6 video templates + 6 photo templates that really apply their look
- Settings: autosave on/off, default export resolution/FPS, theme dark/light,
  clear all data, about

## Honest limitations (see TEST_REPORT.md for the full list)
- 4K/2K export renders at the max canvas size the device/browser supports;
  falls back to 1080p with an on-screen note.
- Reverse is preview-only; export renders forward (true reverse needs
  re-encoding; MP4 export falls back to WebM if the browser lacks MP4 recording).
- No automatic speech-to-text: the spec allows it only via a conventional
  offline engine and none is bundled — captions are manual or SRT/VTT import.
- No clone stamp / healing brush / lasso / magnetic select / LUT import /
  curves UI — omitted rather than faked (see TEST_REPORT.md).
