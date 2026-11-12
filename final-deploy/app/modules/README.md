# app/modules/ — how to add a module

- Vanilla JS, no framework, no bundler. One classic `<script>` per
  module, loaded in `index.html` / `photo.html` BEFORE `app.js` /
  `photo.js` (load order: `icons.js` → `modules/*.js` → editor script).
- Each module is an IIFE that exports exactly one `window.*` name
  (`EPHistory`, `EPProjectStore`, `EPTokens`, …).
- No DOM access at load time (the DOM may not exist yet); expose
  functions/objects only.
- Never rename a module's public export without updating both editors
  and this README.
- Splitting the monoliths (`app.js`, `photo.js`) continues in later
  phases: move one feature at a time, keep the old function names as
  thin wrappers where call sites are many, and re-run `node --check`
  + the jsdom harness + the id audit after every move.
