# Editora Pro — PHASE 2 REPORT (2026-11-12)

Scope: `final-deploy/app/index.html`, `app.css`, `app.js` ONLY (video editor).
Photo editor files (`photo.html`/`photo.css`/`photo.js`), the landing page
(`final-deploy/index.html`), `TEST_REPORT.md`, `PHASE1_REPORT.md` and the
deploy zip were NOT touched. NOT deployed. Vanilla JS only. No AI, no ads,
no paywall, no watermark, no login — verified by scan (zero hits for
AdMob/AdSense/InMobi/OpenAI/Gemini/paywall/Premium in `app.js`; the single
`window.open` hit is inside a code comment, not code).

APK target (user order 06:23 IST, "Browser ke liye mat banana, app ke liye
banao — sab app ke andar ho"): everything built here runs inside the
Capacitor WebView (`capacitor://localhost`). No new CDN dependency, no
`window.open` flow, no desktop-only assumption. Every new action is a
tap target (buttons + media-picker dropdowns) as well as a keyboard
shortcut where one exists; frame-step buttons are tappable.

## What was built / verified / fixed

### 1. Cut & Edit audit — every existing tool traced, 5 real bugs fixed
Traced in code and fixed where broken (all in `app.js` unless noted):

| Tool | Verdict |
|---|---|
| Trim (trim in/out + Apply Trim, edge drag handles) | WORKED, but 2 bugs: right-edge drag clamped `trimOut` to 999 instead of the source length, and Apply Trim ignored clip speed (`duration = trimOut-trimIn`). Both fixed: `trimOut` now clamps to the source duration, duration is `(trimOut-trimIn)/speed`. |
| Split at playhead (S / ✂ Split) | WORKED, but speed-blind: for a 2× clip the second half got `trimIn = trimIn+off` (timeline seconds) instead of `trimIn+off*speed`. Fixed via new `splitClipAt()` (speed-aware, shared by split/insert/duplicate). |
| Cut (split + delete after playhead) | WORKED, same speed bug in `trimOut`. Fixed the same way. |
| Merge (same-source adjacent) | WORKED, plus a new guard: merge is now refused when the two clips run at different speeds (their trim ranges would no longer join cleanly), with a toast saying so. Same-source + adjacency checks kept. |
| Delete | WORKED, now ripple (see §2). |
| Duplicate | HALF-WIRED — FIXED: the old code dropped the copy at `start+duration` with no shift, so it OVERLAPPED the next clip on the track. Duplicate now inserts the copy there and shifts later clips on the track right. |
| Crop (ratio 16:9/9:16/1:1/4:3 + zoom) | WORKED (global crop: preview via `cropClipPath`, export via source-rect in `drawCover` + FFmpeg scale/pad). Unchanged. |
| Resize | WORKED as Scale % in the inspector (25–200%, per clip via Apply, plus Scale X/Y + global transform). Unchanged. |
| Rotate / Flip | WORKED: rotate is per-clip when a clip is selected (else global); flip is global (`S.flipH`/`S.flipV`, preview + export). See Limitations for the flip scope. |
| Freeze frame | WORKED (captures the frame as a PNG image clip, inserts at playhead). Now uses the fixed insert path (see §3), so a freeze inside a clip splits it first instead of overlapping it. |
| Frame-by-frame | WAS BROKEN (hardcoded `/30`): `frameStep()` stepped 1/30 s regardless of frame rate. Fixed — see §5. |

Nothing was removed: every listed tool above is real and wired.

### 2. NEW — Ripple delete
- Delete (timeline 🗑 button, Del key, context-menu Delete, and the new
  ⇤ Ripple Delete button) now closes the gap: later clips shift left by
  the deleted clip's duration, preserving any gap that was already there
  (e.g. deleting a 5 s clip moves a clip at 7 s to 2 s, not to 0 s).
- Scope toggle: **Ripple: Same track / Ripple: All tracks** button
  (`#btnRippleAll`, in the timeline bar). Default is **same-track only**;
  with All tracks on, later clips on every track (V1/V2/Text/A1/A2) shift
  left. The choice is persisted in the project snapshot (`rippleAll`) and
  in undo/redo history. The delete toast states which scope applied.
- Works for video, text and audio clips (each ripples within its own
  track list when same-track is on).

### 3. NEW — Insert edit
- Timeline bar: media-picker dropdown (`#insertMediaSel`, populated from
  the library) + **⇥ Insert at Playhead** button. The picked media is
  inserted at the playhead on V1 (video/image) or A1 (audio); later clips
  on that track shift right by the inserted duration — nothing is
  overwritten.
- A clip straddling the playhead is split at the playhead first
  (`insertClipOnTrack` + `splitClipAt`), so the timeline never overlaps.
  The old `insertClipAtV1` (used by Freeze frame) had the same overlap
  flaw for straddling clips; it now delegates to the fixed path.
- Freeze frame, Duplicate and Insert all share this one insert path.

### 4. NEW — Replace edit
- Timeline bar: media-picker dropdown (`#replaceMediaSel`, video/image
  only) + **🔄 Replace Clip** button, plus the existing right-click
  context-menu → Replace (file picker). Both go through
  `replaceClipWithMedia(clip, media)`:
  - keeps the clip's **position and duration**; the replacement is
    trimmed to fit (`trimIn=0`, `trimOut = duration*speed`);
  - if the replacement source is **shorter** than the clip, the clip
    shortens to the source length and the toast says so (e.g. 5 s → 4 s);
  - the clip's `baseDur` is reset to the new source, so later speed
    changes re-time from the correct length; the per-clip `reverse` flag
    is cleared (it belonged to the old media).
- Fixed the old context-menu Replace flow: it used `addFiles()` + a
  fixed 900 ms `setTimeout` that raced metadata loading, and it set the
  clip duration to the new file's full length (changing position/duration).
  It now uses `importSingleFile()` (awaits `loadedmetadata`, 3 s cap)
  and then `replaceClipWithMedia()`.

### 5. Frame-by-frame navigation + timecode
- New **FPS selector** in the transport (`#projFps`: 24/25/30/50/60,
  default 30, initialised from the export default, persisted in the
  project snapshot and in undo/redo). Changing it also keeps the Export
  dialog's FPS in step.
- `frameStep()` now steps exactly `1/S.fps` seconds (was hardcoded
  1/30 s). The ⏮ −1f / ⏭ +1f transport buttons are tappable; ←/→ keys
  call the same function. Playback is paused before stepping, as before.
- New **timecode display** in the transport (`#timecodeDisplay`,
  `HH:MM:SS:FF` at the project frame rate, e.g. `01:01:01:15`),
  updated on every seek/time update via `fmtTC()`. The old `MM:SS.t`
  display is kept alongside it.

### 6. Duration editing (numeric field that really re-times)
- The inspector **Duration (s)** field (`#clipDur` + Apply to clip) now
  goes through `setClipDuration(clip, seconds)`:
  - **Video/audio clips: clamped to the source length** — the maximum is
    `(sourceDuration − trimIn) / speed`. Asking for 20 s on a 10 s source
    with `trimIn=2` applies 8 s and toasts "Duration clamped to the
    source length".
  - **Text and image clips: free** — any duration ≥ 0.1 s.
  - `trimOut` is kept in step (`trimIn + duration*speed`) and `baseDur`
    follows the source, so **both export paths render the new duration**:
    FFmpeg reads `trimIn/trimOut`, the canvas path reads
    `duration` + `trimIn`.
  - The field itself is re-written with the applied (possibly clamped)
    value after Apply, so the UI never shows a duration the timeline
    does not have.
- The same clamp is now applied by Trim Apply and by right-edge drag
  trimming (see §1).

## Verification (this session — code + a real functional harness, no live browser)
- `node --check app/app.js` — PASS (re-run after every edit batch).
- **Functional harness** (`/tmp/phase2_test.js`, loads the REAL `app.js`
  in a stub-DOM vm, not a copy of the logic): **35/35 PASS**, including:
  - timecode: `fmtTC(3661.5)` @30 fps = `01:01:01:15`; @25 fps
    `fmtTC(1.04)` = `00:00:01:01`;
  - frame step: +1 frame @25 fps = +0.04 s exactly, @30 fps = +1/30 s;
  - speed-aware split: 2× clip split at 4 s → first `trimOut=8`,
    second `trimIn=8`, durations 4 s + 6 s;
  - duration clamp: video 20 s → 8 s clamped (`trimOut=10`); text and
    image free to 100 s;
  - ripple same-track: B 5→0, V2 and audio untouched; ripple all-tracks:
    B/V2/audio 5→0, text 6→1 (gap preserved); deleted clip gone;
  - insert at a boundary: new clip at 5 s, B 5→9; insert inside a clip:
    3 clips, zero overlaps on V1, inserted clip at 4 s;
  - replace: shorter source 5 s → 4 s, start kept at 2 s; longer source
    keeps 4 s duration with `trimOut=4`, media swapped;
  - duplicate: copy inserted at 5 s, B 5→10, no overlap;
  - merge blocked when speeds differ (clips unchanged);
  - Phase 1 regression in the same harness: `addMarker()` adds a
    marker, `recordExport()` runs, `showScreen("projects")` and
    `showScreen("home")` run without throwing.
- **ID audit** (`/tmp/audit_phase2.py`): 300 ids in `index.html`, ZERO
  duplicate ids; all 154 `$("…")` ids referenced in JS exist in the HTML
  (the 14 "missing" hits are `$$()` class/attribute selectors —
  `.panel`, `.modal`, `.toolbtn`, `.itab`, `.tlk`, `.tvis`,
  `.lib-nav-item`, `[data-nav]`, `#alignRow [data-align]`,
  `#menuDrop [data-m]`, `#projFilters [data-pf]`, `#libTabs [data-lt]`,
  `.appnav [data-screen]`, `.ipanel` — all present); all 176
  button/select/input controls have a handler/binding; all 8 new Phase 2
  ids (`btnRippleDelete`, `btnRippleAll`, `btnInsertAtPlayhead`,
  `btnReplaceClip`, `insertMediaSel`, `replaceMediaSel`, `projFps`,
  `timecodeDisplay`) exist in HTML and are wired in JS.
- Phase 1 features re-checked by trace + harness: screens switch
  (`showScreen`), markers add/jump/delete (`addMarker`/`renderMarkers`,
  persisted in `snapshot()`), export history records (`recordExport` on
  both export paths), vendored FFmpeg loader untouched, modal `[hidden]`
  fix untouched.
- Forbidden scan: zero hits for AdMob/AdSense/InMobi/OpenAI/Gemini/
  paywall/Premium; no new `window.open`; no new CDN fetch/import.

## Honest Limitations (Phase 2 — what is NOT implemented and why)
- Ripple delete shifts clips whose start is at/after the deleted clip's
  end. A clip that *straddles* the deleted clip's range (possible only
  after manual drag-overlap, since the editor normally prevents
  overlaps) is not re-timed — it is left where it is. Dragging clips on
  top of each other is still possible; the timeline does not yet forbid
  overlapping drags.
- Insert edit splits a straddling clip at the playhead. It does not offer
  "insert and overwrite" or "insert into a gap without shifting" modes —
  one insert behaviour (shift right, never overwrite) is implemented.
- Replace keeps duration only when the replacement source is at least as
  long as the clip (at its speed). A shorter source shortens the clip —
  there is no way to keep the duration by looping/padding the source,
  and the UI says so instead of faking it.
- Replace works for video/image clips only (the media pickers list only
  those; audio replacement is not offered — an audio clip is replaced by
  deleting it and inserting the new audio at the playhead).
- Flip (H/V) is global, not per-clip: flipping affects the whole preview
  and export, while rotation is per-clip. A per-clip flip would need the
  flip flags stored on the clip like rotation is — not done here.
- Crop ratio/zoom is global, not per-clip (same as before Phase 2).
  Per-clip crop would need the ratio stored on the clip.
- Frame stepping pauses playback and seeks; on a slow device the seek
  for a video clip can land up to ~0.3 s off before the `seek()` clamp
  corrects it (pre-existing seek tolerance, unchanged).
- The FPS selector sets the project frame rate for stepping, timecode
  and the Export dialog default. It does not re-time existing clips and
  does not change the frame rate of already-imported source media.
- Duration editing clamps to the *known* source length. If a clip's
  media metadata has not loaded yet (duration 0/unknown), the clamp
  cannot apply and the field accepts the value; the clamp applies once
  metadata arrives and the duration is next edited.
- No live-browser / live-WebView run was done in this session (no
  live-browser access from this agent). All verification above is code
  trace + the Node harness against the real file.

## APK-readiness
- WORKS IN A WEBVIEW (no native code needed): all new controls are plain
  buttons/selects (tap targets, no keyboard-only paths, no hover-only
  UI); no new network use; ripple/insert/replace/duration state is plain
  timeline data, so it persists through the existing IndexedDB autosave
  and restores on reload; `confirm()` is used only when the existing
  "Ask before deleting" setting is on (same as before).
- NO new permissions needed: no microphone, camera, or file-system
  access beyond the existing import picker.
- The insert/replace pickers list media already imported on the device
  (`S.media`). On a fresh project with no imports they show only the
  placeholder — import media first (same as the rest of the editor).
- NOTHING in Phase 2 changes the export engines, the vendored FFmpeg
  loader, or the deploy packaging: `final-deploy/app/vendor/` is still
  the only extra asset the APK must include.

## Files changed
- `final-deploy/app/index.html`: transport timecode + FPS selector +
  frame-step button labels; timeline bar ripple/insert/replace controls
  (2 buttons + 2 selects + Ripple Delete button); duration-field title.
- `final-deploy/app/app.css`: `#timecodeDisplay` + `.tl-select` styles.
- `final-deploy/app/app.js`: Phase 2 helpers (`fmtTC`, `syncFpsUI`,
  `syncRippleUI`, `sourceDuration`, `setClipDuration`, `splitClipAt`,
  `insertClipOnTrack`, `importSingleFile`, `replaceClipWithMedia`,
  `refreshEditMediaSelects`, `insertMediaAtPlayhead`); ripple delete in
  `deleteSelected`; fixed split/cut/trim/drag/duplicate; `frameStep`
  uses `S.fps`; `snapshot()`/`applySnapshot()` persist `fps`/`rippleAll`;
  wiring for all new controls; fixed Replace file-picker flow.
- This report: `~/workspace/editora-pro/PHASE2_REPORT.md`.

## Required live check (parent, before announcing)
1. Desktop Chrome (serve `final-deploy` over HTTP): import 2 videos →
   Split a 2× clip → check the second half starts at the right frame;
   set Duration 20 s on a 10 s clip → expect clamp to the source length;
   Delete a middle clip → later clip closes the gap; toggle Ripple: All
   tracks → delete again → V2/text/audio close too.
2. Insert: pick media in the Insert list at a playhead inside a clip →
   clip splits, inserted clip sits at the playhead, no overlap.
   Replace: pick a shorter video in the Replace list → clip shortens and
   the toast says so; pick a longer one → duration unchanged.
3. Frame step: set FPS 25 → tap +1f five times → timecode advances
   exactly 5 frames (`:05`); ←/→ keys do the same.
4. Same flow on one Android phone (touch only): all new buttons are
   tappable, dropdowns open, no keyboard needed.
