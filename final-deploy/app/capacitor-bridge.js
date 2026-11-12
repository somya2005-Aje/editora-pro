/* Editora Pro — Capacitor bridge (APK only).
 *
 * Loaded by app/index.html and app/photo.html. On the WEBSITE this file is a
 * no-op: it does nothing unless window.Capacitor exists (i.e. inside the
 * Android app's WebView).
 *
 * Why it exists: a plain <a download> click does NOT save a file from inside
 * an Android WebView, and navigator.share({files}) reports "not supported"
 * there — so without this bridge, exports made in the app would go nowhere.
 * The bridge routes every in-app download/share through the native
 * Filesystem + Share plugins:
 *   1. blob -> base64 -> Filesystem.writeFile into the app Cache dir
 *   2. Share.share opens the Android share sheet ("Save to Files", Drive,
 *      WhatsApp, Gallery apps, ...) so the user chooses where it goes.
 *
 * Covered paths (no changes to app.js / photo.js needed):
 *   - user taps the rendered "Download your video" link (DOM click listener)
 *   - programmatic a.click() downloads: video/photo exports, project backups,
 *     downloadText() (HTMLAnchorElement.prototype.click patch — a detached
 *     anchor's click never reaches the document, so both hooks are needed)
 *   - the existing Share button (shareLastExport / shareSiteLink): patches
 *     navigator.share / navigator.canShare so the app's own share code works.
 *
 * Files are saved to Cache (no storage permission needed on modern Android);
 * the share sheet is the way the user moves them out of the app.
 */
(function () {
  'use strict';
  if (!window.Capacitor || !window.Capacitor.Plugins) return;
  var Plugins = window.Capacitor.Plugins;
  if (!Plugins.Filesystem || !Plugins.Share) {
    if (window.console) console.warn('[capacitor-bridge] Filesystem/Share plugin missing');
    return;
  }
  var Filesystem = Plugins.Filesystem;
  var Share = Plugins.Share;

  function toast(msg) {
    try { if (typeof window.toast === 'function') { window.toast(msg); return; } } catch (e) {}
    if (window.console) console.log('[capacitor-bridge] ' + msg);
  }

  function safeName(name) {
    name = String(name || 'editora-export');
    return name.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'editora-export';
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onloadend = function () {
        var dataUrl = String(reader.result || '');
        var comma = dataUrl.indexOf(',');
        if (comma < 0) { reject(new Error('Could not read file')); return; }
        resolve(dataUrl.slice(comma + 1));
      };
      reader.onerror = function () { reject(new Error('Could not read file')); };
      reader.readAsDataURL(blob);
    });
  }

  // Save a Blob into the app Cache dir and open the Android share sheet.
  // Returns true on success, false on failure (toast shown either way).
  async function capSaveAndShare(blob, filename) {
    filename = safeName(filename);
    toast('Saving ' + filename + '…');
    try {
      var base64 = await blobToBase64(blob);
      var saved = await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: 'CACHE'
      });
      var uri = saved && saved.uri;
      if (!uri) throw new Error('Save returned no file');
      await Share.share({
        title: 'Editora Pro export',
        text: filename,
        url: uri,
        dialogTitle: 'Save or share your export'
      });
      return true;
    } catch (e) {
      if (e && (e.name === 'AbortError' || /cancelled/i.test(String(e.message || '')))) return false;
      if (window.console) console.error('[capacitor-bridge] save/share failed', e);
      toast('Could not save that file in the app. Try again, or export from the website.');
      return false;
    }
  }

  // --- Route a blob: download anchor through the native save+share flow. ---
  function routeAnchor(a) {
    var href = a.getAttribute('href') || '';
    if (!href || href.indexOf('blob:') !== 0) return false;
    var name = a.getAttribute('download') || 'editora-export';
    fetch(href).then(function (res) { return res.blob(); })
      .then(function (blob) { return capSaveAndShare(blob, name); })
      .catch(function (e) {
        if (window.console) console.error('[capacitor-bridge] download failed', e);
        toast('Could not save that file in the app.');
      });
    return true;
  }

  // 1) Real taps on rendered <a download> links (e.g. the export result link).
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (!t) return;
    if (routeAnchor(t)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // 2) Programmatic a.click() on detached anchors (exports, backups, downloadText).
  var nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      if (this.hasAttribute && this.hasAttribute('download')) {
        var href = this.getAttribute('href') || '';
        if (href.indexOf('blob:') === 0) { routeAnchor(this); return; }
      }
    } catch (e) { /* fall through to the native click */ }
    return nativeClick.call(this);
  };

  // 3) Make the app's existing Share buttons work in the WebView.
  //    navigator.share({files}) is unsupported in WebView (canShare -> false),
  //    so shareLastExport() currently just toasts. Patch both so the same app
  //    code opens the native share sheet instead.
  try {
    Object.defineProperty(Navigator.prototype, 'canShare', {
      configurable: true,
      value: function (data) {
        if (!data) return false;
        if (data.files && data.files.length) return true;
        return !!(data.url || data.text || data.title);
      }
    });
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: async function (data) {
        data = data || {};
        if (data.files && data.files.length) {
          var file = data.files[0];
          var blob = file instanceof Blob ? file : new Blob([file]);
          await capSaveAndShare(blob, file.name || 'editora-export');
          return;
        }
        await Share.share({
          title: data.title || 'Editora Pro',
          text: data.text || '',
          url: data.url || undefined,
          dialogTitle: 'Share'
        });
      }
    });
  } catch (e) {
    if (window.console) console.warn('[capacitor-bridge] navigator.share patch failed', e);
  }

  if (window.console) console.log('[capacitor-bridge] active (Filesystem + Share)');
})();
