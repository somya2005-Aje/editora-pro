# Editora Pro — Phase 6 Report (Assets & Management, redesign)

**Agent:** Phase 6 (assets and management) · **Date:** 2026-11-12
**Scope — ONLY these files were touched:**
- `final-deploy/app/index.html` (973 → 977 lines)
- `final-deploy/app/app.js` (5,959 → 6,124 lines)
- `final-deploy/app/photo.html` (666 → 668 lines)
- `final-deploy/app/photo.js` (3,150 → 3,183 lines)
- `final-deploy/app/photo.css` (261 → 263 lines)

NOT touched: landing page `final-deploy/index.html`, `app.css`, `icons.js`,
`app/modules/`, `TEST_REPORT.md`, `deploy.py`, the zip. No deploy, no APK
build. No new icon was needed (all icons used already exist in the
registry). This report **supersedes** the old `PHASE6_REPORT.md` from the
pre-blueprint build, which described a different Phase 6 (§5 extras /
split screen / chroma / etc. — those features already exist in the app
from earlier phases and were not re-built here).

**Sources read first:** roadmap PDF §6/§8, `FOUNDATION.md` (format v1,
tokens), `PHASE2_3_REPORT.md`, `PHASE4_5_REPORT.md`, `TEST_REPORT.md`
(current state + Job 0 fixes).

**Starting point (honest):** most of Phase 6's surface already existed
from the earlier build — Projects filters + CRUD, Media Library + folders,
Templates/Assets screens, full backup/restore, export queue + history,
storage meter. This phase did **not** re-claim that work. It closed the
gaps where the existing surface was incomplete, un-persisted, or
un-verified (see §1), and fixed one real bug found while verifying (§5).

**Rules kept:** free, ad-free, no AI, no watermark, no login. SVG icons
only (registry, no new icons). `[hidden]{display:none!important}` untouched
in both CSS files; single-modal rule intact. Job 0 fixes preserved
(selection pointer handling, FFmpeg loader, export min-size guard, import
counter — none of that code was touched). No licensed-music claims anywhere:
only the existing built-in synthesized tones, labelled as such.

---

## 1. What was built / fixed

### 1.1 Export queue — now persisted, with retry + live progress (`app.js`)
- **Was:** the queue lived in memory only (TEST_REPORT honest limitation:
  "gone on reload"). **Now:** every queue change is saved to
  `localStorage["editora-export-queue"]` (`saveQueueState()` at the end of
  `renderQueue()`); `loadQueueState()` restores it in `init()` before the
  queue first renders.
- **Interrupted jobs are honest:** a job with status `running` when the app
  closed is marked **Failed** on the next load with the reason
  "Interrupted — the app was closed or reloaded while this export was
  running. Retry it from the queue." It never silently restarts and never
  claims success.
- **Retry:** failed jobs get a Retry button in Export Center (back to
  Queued, persisted). Any non-running job can be removed from the queue
  (previously only queued jobs had a delete button).
- **Progress:** while a job runs, `runQueue()` polls `#expStatus` twice a
  second and mirrors the engine's real status text into that job's row
  (`.q-progress`, `data-qid` per row). Pause / Cancel / sequential run
  behaviour is unchanged.

### 1.2 Recovery history — a real log, not just a filter (`app.js`, `index.html`)
- **Was:** "Recovered" was only a derived filter (autosave-only projects).
  **Now:** a `localStorage["editora-recovery-history"]` log (max 20, one
  entry per project+reason, newest first) with a rendered list on the
  Projects screen (`#recoveryList`, timestamps) and a Clear button (asks
  first; clears the list only, never the projects).
- Recorded when: (a) startup finds a saved video project that was never
  saved manually (`checkRecoveredProjects()`, run after `openDB()` in
  `init()`); (b) the user opens such a project (`openProject()`).
- Wiring: `renderRecoveryHistory()` runs whenever the Projects screen is
  shown; `btnClearRecovery` is bound in `init()`.

### 1.3 Photo projects are fully manageable from the Projects screen (`app.js`)
- **Was:** photo rows had only an "Open" button that showed a toast and
  linked to `photo.html` (user had to find the project again). **Now:**
  photo rows have Open / Rename / Duplicate / Delete, operating directly
  on the same-origin `editora-pro-photo` IndexedDB
  (`openPhotoDB` / `photoDBGet` / `photoDBPut` / `photoDBDel`, key = project
  name; rename updates `projectName` + `savedAt`, duplicate deep-copies the
  record). Delete asks for confirmation; favorites follow a rename.
- **Open deep-links:** Open goes to `photo.html?open=<name>`, and the Photo
  Editor opens that project directly (see 1.6). The Photo Editor top bar
  now also links back to Projects (`./index.html#projects`) and Exports
  (`./index.html#export`); the video app honours `#projects` / `#library` /
  `#templates` / `#export` / `#settings` deep links on load.

### 1.4 Import-all validation (`app.js`)
- **Was:** `importAllProjects()` accepted any JSON array whose first record
  had `.data` — no version check, no per-record validation. **Now:** every
  record goes through `EPProjectStore.validate()` (future versions refused
  with the "made by a newer version" reason) + `migrate()`, records without
  timeline data are skipped, and the toast reports the exact outcome
  ("N project(s) imported; skipped M: …").

### 1.5 Media Library — really persistent across sessions (`app.js`)
- **Was:** `S.media` only held the current session's imports; after a
  reload the library showed only the current project's media, and deleting
  from the library removed the in-memory entry but left the blob in
  IndexedDB. **Now:**
  - `loadAllMediaFromDB()` runs after `openDB()` in `init()`: every blob in
    the `media` store is loaded back (object URL, fav, folder, added date,
    size; video/audio durations via metadata), so the library shows
    everything imported on this device.
  - `openProject()` **merges** instead of wiping `S.media`, so opening a
    project no longer hides other imported media.
  - Library and Media Bin deletes also call `deleteMediaFromDB(id)`, so the
    blob is really gone (Clear Cache and the library now agree).
  - Folders were already real (create/rename/delete, assign via per-item
    select, filter by folder) and are unchanged; folder assignment persists
    through the existing autosave (media records are written with
    `folderId` on save).

### 1.6 Photo editor (`photo.js`, `photo.html`, `photo.css`)
- **Shared export history:** photo exports now write into the same
  `localStorage["editora-export-history"]` the video Export Center reads
  (`recordPhotoExport()`, same record shape: name, settings
  e.g. "Photo export · PNG 200×100", real byte size, date, status, note).
  A successful export records Completed; a null-blob encode failure records
  **Failed** with the reason instead of vanishing.
- **`?open=` deep link:** `photo.html?open=Name` opens that saved project
  directly; the autosave restore is skipped in that case so the two cannot
  race and overwrite each other.
- **Nav links:** "Projects" and "Exports" links in the top bar (styled like
  the existing Back-to-Home link).

### 1.7 Settings — Clear Data now covers both databases (`app.js`)
- `btnClearData` (confirm first, unchanged) now also deletes the
  `editora-pro-photo` database, not just `editora-pro`. Storage numbers
  (`navigator.storage.estimate()`, real MB/quota) and cache numbers (saved
  media count) were already real and are unchanged; Clear Cache already
  removed only unused blobs and is unchanged.

### 1.8 Templates & assets — verified, no rebuild needed
- Checked, not rebuilt: video templates (6, apply colour + fx + text),
  title styles (4), caption styles (4), 14 text presets, intro templates
  (3) and outro templates (3) applying real timeline treatments, transition
  / effect / grade preset libraries, LUT library (honest: name only,
  re-import the `.cube` — labelled in the UI), stickers (land as timeline
  clips), shapes (coloured overlay clips), backgrounds (real 1920×1080
  images made on-device), SFX + BGM (built-in synthesized tones only).
  Every tile applies for real or is labelled; nothing new was added and
  nothing was found dead. The one honest gap is the LUT file itself (see
  §4).

---

## 2. Bug found during verification — fixed in the app, not the tests

**`getPhotoProjects()` poisoned the photo database (real bug, pre-existing).**
Opening the video app's Projects screen called
`indexedDB.open("editora-pro-photo", 1)` with **no** `onupgradeneeded`
handler. On a browser that had never opened the Photo Editor, that created
an empty v1 database with **no object store** — and since the version was
already 1, the Photo Editor's own `openDB()` could never create the store
afterwards, so every photo save/load in that browser would fail. Fix:
`getPhotoProjects()` now creates the store on upgrade, and if it finds an
empty v1 database it closes it, deletes it, and reopens it (same repair
added to `photo.js` `openDB()`). Found because the harness hung seeding a
photo project after the video screen had opened the DB.

**Second-order fix from the same investigation:** the video app opened a
fresh `editora-pro-photo` connection on every Projects render and never
closed it, which blocks `deleteDatabase` — so Settings → Clear all saved
data could never actually delete the photo DB. `getPhotoProjects()` and the
photo rename/duplicate/delete helpers now `close()` their connections.

---

## 3. Verification — evidence

### 3.1 New harness: `verify/phase6_harness.js` — **61 passed, 0 failed**
jsdom + node-canvas + fake-indexeddb, loads the real `index.html` /
`photo.html` with all real scripts. Run:
`cd ~/workspace/editora-pro/verify && node phase6_harness.js` (~20 s).

It traces one real flow per feature, end to end:
- **Projects:** create via the real app → save → list → rename → duplicate
  → favorite + Favorites filter → per-project Backup downloads JSON →
  delete. Photo project: list → rename → duplicate → delete.
- **Recovery:** seed an autosave-only project → `checkRecoveredProjects()`
  logs it with timestamp → list renders → Recovered filter shows it →
  Clear empties the list, project stays.
- **Backup/restore flow:** create "P6 Backup" → `makeVideoBackup` shape
  (v1, manifest) → delete it → `importFullBackup` from the backup File →
  project reopens with name + clip → toast honestly reports the missing
  (manifest-only) media.
- **Import-all:** future-version file refused (not stored, toast says
  "skipped"); valid v1 file imported.
- **Media library:** seed a blob in IndexedDB → `loadAllMediaFromDB()`
  restores it → grid shows it → search filters → create folder → assign
  media via the folder select → folder filter shows only it → delete
  removes the IndexedDB blob too.
- **Templates:** Cinematic template changes the project (preset +
  contrast 115); intro template adds a title clip at 0s; title style sets
  the text panel (Impact/72); sticker lands on the timeline; LUT library
  honest when empty.
- **Queue:** add job → persisted in localStorage → simulate reload with a
  `running` job → marked Failed with "Interrupted…" → Retry button →
  re-queued and persisted.
- **History:** Completed (real 1.2 MB size shown) + Failed with reason,
  newest first; Re-export button present; delete removes the entry; Home
  Recently Exported reflects it.
- **Settings:** storage shows the real estimate (1.2 MB); cache info
  counts saved media; Clear Cache removes a seeded orphan blob.
- **Photo:** `?open=` opens the named project (DOM-verified); nav links
  present; real export through the modal records Completed with a real
  size in the shared history; **deliberate failure** (stubbed `toBlob`
  → null) shows an honest error, no download, and records Failed with the
  reason.
- **Navigation:** all 8 sections reachable; mobile nav has all 7 screen
  buttons; no empty screens; Clear Data wipes saved data with confirmation.

Harness note: the first run hung twice (no output for minutes) — both
hangs were harness/DB issues, not app deadlocks: (1) seeding a photo
project into a store-less empty v1 DB (the §2 bug, fixed in the app);
(2) a `deleteDatabase` blocked by the video DOM's still-open photo
connections (fixed by closing connections; harness also runs the photo
test first now). A 180 s watchdog was added so a hang fails loudly.

### 3.2 Static checks
- `node --check` PASS on all touched JS: `app.js` (6,124 lines),
  `photo.js` (3,183 lines), `icons.js`, `modules/{history,project-store,
  tokens}.js`.
- `verify/audit.py` — **0 failures** (ids, handler coverage, icon-only
  labels, `[hidden]` rule, no placeholder/demo content, no unexpected
  external URLs, no `window.open`).
- `verify/harness.js` (Phase 0+1) — **84/86**, the same 2 failures already
  documented as pre-existing photo-track stale expectations in
  `PHASE4_5_REPORT.md` ("photo: 32 tool buttons — got 35",
  "photo: Layers drawer button toggles drawer"). No new failures.
- `verify/photo_phase23_harness.js` — **89/89 PASS**.

### 3.3 Job 0 fixes — preserved (not regressed)
Timeline clip selection, FFmpeg loader, export min-size guard, and import
counter code were not touched; the 84/86 + 89/89 harness runs above cover
the shell and photo flows, and `audit.py` passes. The export-guard and
selection behaviours themselves were not re-driven here — they are covered
by the Phase 4+5 harness evidence and the parent's live tests (§5).

---

## 4. Honest limitations / Coming Later

- **Queue runs are jsdom-unverified end to end.** The queue persists,
  retries, and reports progress, but a full run (2 jobs → both Completed
  with real files) needs a real browser: jsdom has no MediaRecorder and
  cannot run FFmpeg. The run path itself (`runQueue` → `doExport` →
  `recordExport`) is unchanged pre-existing code. Live-test item §5.1.
- **Queue jobs store export settings, not a project snapshot.** If the
  user edits the timeline after queuing and before running, the export
  reflects the edited timeline. (Same behaviour as the pre-existing queue.)
- **LUT files are still not stored** (name only; the `.cube` must be
  re-imported after reopening). Pre-existing, honestly labelled in the UI
  on the Templates screen and in the LUT library.
- **Photo exports join the shared history but not the queue.** A photo
  export runs immediately from the Photo Editor; there is no photo export
  queue (a photo export is a single instant render, not a batch job).
- **Recovery history covers video projects.** A photo autosave restore
  still announces itself only by toast in the Photo Editor; it is not
  listed in the Projects recovery history.
- **Media library loads every saved blob at startup** (object URLs for all
  of them). Correct for the library's purpose, but a very large library
  (many big videos) will hold many object URLs from launch.
- **Clear Data deletes the photo DB only when no other tab holds it open**
  (IndexedDB `deleteDatabase` blocks on open connections in another tab).
  Same is true of any browser app; the in-app connections are now closed.
- **Backups are local JSON files** (no cloud backup). A full backup embeds
  media under 5 MB only; larger media are manifest-only and must be
  re-imported after restore — the restore says exactly which by name.
- **No new "Coming Later" labels were needed.** Everything on the
  Projects / Library / Templates / Export screens is implemented; the only
  pre-existing Coming Later item (photo Rotate View) is untouched.

---

## 5. What the parent must live-test (real browser / real phone)

1. **Queue, end to end:** queue 480p + 720p + 1080p (one tap) → Run queue
   → all three complete with real files, progress visible per job, history
   entries with real sizes. Then cancel a run mid-job and retry a failed
   job.
2. **Interrupted queue:** start a queue run, reload the page mid-export →
   the running job must show Failed "Interrupted…" on the next load, and
   Retry must re-queue it.
3. **Backup flow with a real video:** create a project with a real video
   file → Full backup → delete the project → Restore → it reopens; a file
   under 5 MB restores its media, a larger one is reported missing by name.
4. **Media library on device:** import media, put some in a folder, reload
   → library still shows everything, folder filter works, delete removes it.
5. **Photo management:** rename / duplicate / delete a photo project from
   the Projects screen; Open deep-links into the Photo Editor with that
   project open; export a photo and confirm it appears in Export Center
   history.
6. **Recovery:** edit a project, do NOT save manually, reload → it appears
   under Recovered and in Recovery history with a timestamp.
7. **Clear Data / Clear Cache** with real data on device (confirm dialogs,
   photo DB really gone).
8. **Mobile (360 px):** Projects / Library / Templates / Export Center
   screens readable and tappable; bottom nav reaches all sections.

## Files added
- `verify/phase6_harness.js` — the 61-check harness above (run as in §3.1).
- This report: `PHASE6_REPORT.md` (supersedes the pre-blueprint one).
