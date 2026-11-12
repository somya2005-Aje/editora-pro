#!/usr/bin/env python3
"""Deploy Editora Pro to Cloudflare Pages with Wrangler, using the stored token.
Same pattern as VoiceWorld deploy.py / LifeOS wrangler_deploy.py. Token is never read or printed.

Cloudflare Pages rejects any single file over 25 MiB, and
app/vendor/ffmpeg-core.wasm is ~31 MiB — so the web deploy EXCLUDES ONLY
that one file. Everything else under app/vendor/ IS shipped: the small
@ffmpeg/ffmpeg + @ffmpeg/util ESM wrapper files (entry.js, worker.js,
dist/esm/*.js, util.js — kilobytes each) and ffmpeg-core.js (110 KB).

That split is load-bearing, not incidental (Job 0, 2026-11-12):
loadFFmpeg() imports ./vendor/ffmpeg/entry.js, and the wrapper builds its
worker as new Worker(new URL("./worker.js", import.meta.url)) — a wrapper
loaded from esm.sh makes a cross-origin worker and Chrome refuses it
("Failed to construct 'Worker' ... cannot be accessed from origin
'https://editora-pro.pages.dev'"). With the wrapper served same-origin
the worker constructs fine; the core JS loads from the app and only the
wasm falls back to the jsDelivr CDN at runtime (fetched as a blob URL).
The vendor/ files stay whole on disk in final-deploy/ for the APK build,
where they are bundled as app assets (no 25 MiB limit there).

Same rule for the Canvas export's MP4 muxer (2026-11-12 WebCodecs rebuild):
app/vendor/mp4-muxer/mp4-muxer.mjs (65 KB, mp4-muxer 5.0.0, MIT) is
imported same-origin by doVideoExport(); it must ship in the web deploy
(the wasm exclusion does not touch it).
"""
import os
import shutil
import subprocess
import sys

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import dynamic_credential_entry

PROJECT_DIR = os.path.expanduser("~/workspace/editora-pro")
STAGING_DIR = os.path.expanduser("~/workspace/editora-pro/.web-deploy")
ACCOUNT_ID = "617e5ccdaae4cb0e07706e4e3a012801"
# The ONLY file excluded from the web deploy: the 31 MiB wasm core.
# (Cloudflare Pages single-file limit is 25 MiB.)
WEB_EXCLUDED = os.path.join("app", "vendor", "ffmpeg-core.wasm")


def build_staging() -> None:
    if os.path.exists(STAGING_DIR):
        shutil.rmtree(STAGING_DIR)
    shutil.copytree(os.path.join(PROJECT_DIR, "final-deploy"), STAGING_DIR)
    excluded = os.path.join(STAGING_DIR, WEB_EXCLUDED)
    if os.path.exists(excluded):
        os.remove(excluded)
    # Safety: refuse to stage if the wasm is still there (would fail the deploy),
    # and refuse to stage if the small wrapper files are missing (would break
    # the same-origin FFmpeg worker at runtime).
    assert not os.path.exists(excluded), "wasm still in staging: " + excluded
    for needed in (
        os.path.join("app", "vendor", "ffmpeg", "entry.js"),
        os.path.join("app", "vendor", "ffmpeg", "worker.js"),
        os.path.join("app", "vendor", "ffmpeg-core.js"),
        os.path.join("app", "vendor", "util", "util.js"),
        os.path.join("app", "vendor", "mp4-muxer", "mp4-muxer.mjs"),
        os.path.join("app", "vendor", "webm-muxer", "webm-muxer.mjs"),
    ):
        assert os.path.exists(os.path.join(STAGING_DIR, needed)), "missing in staging: " + needed
    print("Staging ready (excludes only %s): %s" % (WEB_EXCLUDED, STAGING_DIR))


def main() -> int:
    build_staging()
    entry = dynamic_credential_entry("custom.cloudflare")
    surrogate = str(entry["surrogate"]).strip()
    env = dict(os.environ)
    env["CLOUDFLARE_API_TOKEN"] = surrogate
    env["CLOUDFLARE_ACCOUNT_ID"] = ACCOUNT_ID
    cmd = [
        "npx", "--yes", "wrangler@4.160.0", "pages", "deploy",
        STAGING_DIR, "--project-name", "editora-pro", "--commit-dirty=true",
    ]
    proc = subprocess.run(cmd, cwd=PROJECT_DIR, env=env)
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
