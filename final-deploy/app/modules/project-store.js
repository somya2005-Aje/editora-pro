/* Editora Pro — versioned JSON project format (Phase 0+1)
   Frozen in FOUNDATION.md §4. Format version is 1. Records without
   `formatVersion` are v1 (the shape shipped by Stages 1–6). A record
   whose formatVersion is > CURRENT is refused on open/restore — never
   silently migrated, never silently dropped.
   Classic script; load before app.js / photo.js. Pure functions, no DOM. */
(function(){
"use strict";
var CURRENT=1;
var VIDEO_APP="editora-pro-video";
var PHOTO_APP="editora-pro-photo";
var VIDEO_BACKUP_APP="editora-pro-video-backup";
var PHOTO_BACKUP_APP="editora-pro-photo-backup";

function isObj(v){return v&&typeof v==="object"&&!Array.isArray(v);}

/* Stamp a video project record (IndexedDB `editora-pro` / localStorage
   `editora-current`) with its format version. Safe to call on v1 records
   that lack the field. */
function stampVideo(rec){
  if(!isObj(rec))return rec;
  if(rec.formatVersion==null)rec.formatVersion=CURRENT;
  if(!rec.app)rec.app=VIDEO_APP;
  return rec;
}
function stampPhoto(rec){
  if(!isObj(rec))return rec;
  if(rec.formatVersion==null)rec.formatVersion=CURRENT;
  if(!rec.app)rec.app=PHOTO_APP;
  return rec;
}
/* Validate a record before opening it. Returns {ok:true} or
   {ok:false, reason:string}. Unknown future versions are refused. */
function validate(rec, app){
  if(!isObj(rec))return {ok:false,reason:"Not a project file (expected a JSON object)."};
  if(app&&rec.app&&rec.app!==app&&rec.app!==VIDEO_BACKUP_APP&&rec.app!==PHOTO_BACKUP_APP)
    return {ok:false,reason:"This file is a "+rec.app+" project, not an Editora Pro "+app+" project."};
  if(rec.formatVersion!=null&&rec.formatVersion>CURRENT)
    return {ok:false,reason:"This project was made by a newer version of Editora Pro (format v"+rec.formatVersion+"). Update the app to open it."};
  return {ok:true};
}
/* Migrate a record to the current format. v1 has no migration steps yet —
   this is the single place future migrations live. Returns the record. */
function migrate(rec){
  if(!isObj(rec))return rec;
  if(rec.formatVersion==null){rec.formatVersion=CURRENT;}
  return rec;
}
/* Backup file shape (video full backup: one JSON + media manifest;
   media <5 MB embedded as dataURLs). */
function makeVideoBackup(project, manifest, embeddedMedia){
  return {formatVersion:CURRENT, app:VIDEO_BACKUP_APP,
    project:project, manifest:manifest||[],
    media:embeddedMedia||{}, backedUpAt:new Date().toISOString()};
}
function makePhotoBackup(doc){
  var b={formatVersion:CURRENT, app:PHOTO_BACKUP_APP};
  if(isObj(doc))for(var k in doc)b[k]=doc[k];
  b.savedAt=new Date().toISOString();
  return b;
}
window.EPProjectStore={
  FORMAT_VERSION:CURRENT, VIDEO_APP:VIDEO_APP, PHOTO_APP:PHOTO_APP,
  VIDEO_BACKUP_APP:VIDEO_BACKUP_APP, PHOTO_BACKUP_APP:PHOTO_BACKUP_APP,
  stampVideo:stampVideo, stampPhoto:stampPhoto,
  validate:validate, migrate:migrate,
  makeVideoBackup:makeVideoBackup, makePhotoBackup:makePhotoBackup
};
})();
