/* Editora Pro — shared icon registry (Phase 0+1)
   One consistent inline-SVG family (Lucide-style: 24x24 viewBox, stroke
   currentColor, stroke-width 2, round caps/joins, no fill unless noted).
   NO emoji as tool/chrome icons anywhere — every chrome icon comes from
   here. Emoji survive only inside user content the user adds (e.g. a
   sticker emoji text clip), never in chrome.
   Usage (classic script, load BEFORE app.js / photo.js):
     epIcon("save")                 -> '<svg ...>...</svg>' string
     epIcon("play", 20)             -> sized svg
     epIcon("star", 18, true)       -> filled variant (star, heart, eye...)
     epHydrateIcons(document)       -> fills every [data-ic] element
     epSetIcon(el, "moon")          -> el.innerHTML = epIcon("moon")
   In HTML: <span class="ico" data-ic="save"></span> Label
   In JS template strings: ${epIcon("trash")} Delete
   Add a new icon: add one entry to EP_ICONS (inner SVG markup only). */
(function(){
"use strict";
var EP_ICONS={
"home":'<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>',
"film":'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 4l3 5M12 4l3 5M17 4l3 5"/>',
"clapperboard":'<path d="M3 8.5 20.5 4.5 21 9 3.5 13z"/><path d="M3 13v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6"/><path d="M7.5 6.5 10 10M12 5.5l2.5 3.5M16.5 4.8 19 8"/>',
"image":'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 3 3 4-4 4 4"/>',
"folder":'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
"folder-plus":'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/>',
"library":'<rect x="3" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><rect x="17" y="4" width="4" height="16" rx="1"/>',
"layout-grid":'<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
"sparkles":'<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z"/><path d="M18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/><path d="M5 16l.7 1.8L7.5 18.5l-1.8.7L5 21l-.7-1.8L2.5 18.5l1.8-.7z"/>',
"download":'<path d="M12 3v12"/><path d="m6 11 6 6 6-6"/><path d="M4 21h16"/>',
"upload":'<path d="M12 21V9"/><path d="m6 13 6-6 6 6"/><path d="M4 3h16"/>',
"settings":'<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.23.6.86 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.65 0-1.28.4-1.51 1z"/>',
"save":'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
"search":'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>',
"trash":'<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
"star":'<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>',
"eye":'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
"eye-off":'<path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.9 3.9M6.6 6.6A16.6 16.6 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
"lock":'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
"unlock":'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
"moon":'<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
"sun":'<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',
"undo":'<path d="M8.5 5 3 10.5 8.5 16"/><path d="M3 10.5h11a6 6 0 0 1 0 12h-2"/>',
"redo":'<path d="m15.5 5 5.5 5.5-5.5 5.5"/><path d="M21 10.5H10a6 6 0 0 0 0 12h2"/>',
"play":'<path d="M7 4.5v15l13-7.5z"/>',
"pause":'<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
"stop":'<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
"scissors":'<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.2 7.8 20 19M8.2 16.2 20 5"/>',
"link":'<path d="M10 14a5 5 0 0 0 7.1 0l2.4-2.4a5 5 0 0 0-7.1-7.1L11 5.9"/><path d="M14 10a5 5 0 0 0-7.1 0l-2.4 2.4a5 5 0 0 0 7.1 7.1L13 18.1"/>',
"copy":'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
"clipboard":'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4a2 2 0 0 1 6 0"/><path d="M9 4h6v3H9z"/><path d="M9 12h6M9 16h4"/>',
"plus":'<path d="M12 5v14M5 12h14"/>',
"minus":'<path d="M5 12h14"/>',
"x":'<path d="M18 6 6 18M6 6l12 12"/>',
"check":'<path d="m4 12.5 5 5L20 6.5"/>',
"check-circle":'<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16.5 9"/>',
"x-circle":'<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
"chevron-down":'<path d="m6 9 6 6 6-6"/>',
"chevron-right":'<path d="m9 6 6 6-6 6"/>',
"chevron-left":'<path d="m15 6-6 6 6 6"/>',
"menu":'<path d="M4 6h16M4 12h16M4 18h16"/>',
"share":'<path d="M12 3v13"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
"keyboard":'<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
"mic":'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4"/>',
"music":'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
"type":'<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
"smile":'<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.2 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/><path d="M9 9.5h.01M15 9.5h.01"/>',
"shuffle":'<path d="M3 6h4l10 12h4"/><path d="m17 4 4 4-4 4"/><path d="M3 18h4l2.5-3"/><path d="m17 16 4 4-4 4"/><path d="M14.5 9 21 6"/>',
"message-square":'<path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12z"/>',
"palette":'<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.2" fill="currentColor" stroke="none"/><path d="M12 21a9 9 0 0 1 0-18c1.5 0 2 .8 1.6 1.9-.5 1.3.3 2.6 1.7 2.6H17a4 4 0 0 1 4 4c0 5-4 9.5-9 9.5z"/>',
"puzzle":'<path d="M14 7V4a2 2 0 0 0-4 0v3H7a2 2 0 0 0-2 2v3H2a2 2 0 0 0 0 4h3v3a2 2 0 0 0 2 2h3v3a2 2 0 0 0 4 0v-3h3a2 2 0 0 0 2-2v-3h3a2 2 0 0 0 0-4h-3V9a2 2 0 0 0-2-2z"/>',
"magnet":'<path d="M5 4h4v7a3 3 0 0 0 6 0V4h4"/><path d="M5 4v7a7 7 0 0 0 14 0V4"/><path d="M5 4h4M15 4h4"/>',
"map-pin":'<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/>',
"rotate-cw":'<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>',
"rotate-ccw":'<path d="M3 12a9 9 0 1 0 2.6-6.3"/><path d="M3 3v6h6"/>',
"refresh-cw":'<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/><path d="M3 12a9 9 0 0 0 2.6 6.3"/><path d="M3 21v-6h6"/>',
"flip-h":'<path d="M12 3v18"/><path d="M8 8 3 12l5 4"/><path d="m16 8 5 4-5 4"/>',
"flip-v":'<path d="M3 12h18"/><path d="m8 8 4-5 4 5"/><path d="m8 16 4 5 4-5"/>',
"snowflake":'<path d="M12 2v20M4 6l16 12M20 6 4 18"/><path d="m12 6-2-2M12 6l2-2M12 18l-2 2M12 18l2 2"/>',
"rewind":'<path d="M11 17V7l-9 5z"/><path d="M21 17V7l-9 5z"/>',
"fast-forward":'<path d="m13 17 9-5-9-5z"/><path d="m3 17 9-5-9-5z"/>',
"bar-chart":'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
"volume":'<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
"volume-x":'<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/>',
"volume-1":'<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
"camera":'<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
"target":'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
"layers":'<path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
"sliders":'<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h13M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
"move":'<path d="M12 2v20M2 12h20"/><path d="m9 5 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
"hand":'<path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11m0-5.5v-1a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V12m0-3a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.3L4.6 14a1.6 1.6 0 0 1 2.6-1.8L8 13.5"/>',
"zoom-in":'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/><path d="M11 8v6M8 11h6"/>',
"zoom-out":'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/><path d="M8 11h6"/>',
"crop":'<path d="M6 2v16a2 2 0 0 0 2 2h14"/><path d="M2 6h16a2 2 0 0 1 2 2v14"/>',
"pencil":'<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
"eraser":'<path d="m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
"droplet":'<path d="M12 2.7s6.5 7 6.5 11.3a6.5 6.5 0 0 1-13 0C5.5 9.7 12 2.7 12 2.7z"/>',
"paint-bucket":'<path d="m5 11 8.5-8.5a2.1 2.1 0 0 1 3 3L8 14"/><path d="M5 11h9l-1.5 2.5L11 16l3 3a2.1 2.1 0 0 1-3 3L5 16z"/><path d="M16 8 9 15"/>',
"wand":'<path d="m6 21 15-15"/><path d="M15 4l1.5 1.5L18 4l-1.5 1.5L15 4z"/><path d="M20 9l1 1-1 1-1-1z"/><path d="M9 4l1 1-1 1-1-1z"/><path d="M4 12l1 1-1 1-1-1z"/>',
"lasso":'<path d="M12 3a9 9 0 1 0 9 9"/><path d="M21 3v6h-6"/><path d="M12 12l3.5-3.5"/>',
"stamp":'<path d="M12 3a3 3 0 0 1 3 3c0 1.5-1 2.5-2 3v3h-2V9c-1-.5-2-1.5-2-3a3 3 0 0 1 3-3z"/><path d="M5 21h14"/><path d="M7 17h10v4H7z"/>',
"arrow-left":'<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
"arrow-right":'<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
"arrow-up":'<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
"arrow-down":'<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
"more-horizontal":'<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
"info":'<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
"alert-triangle":'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
"file-json":'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10 12a2 2 0 0 0-2 2c0 1.5 2 1.5 2 3a2 2 0 0 1-2 2M14 12a2 2 0 0 1 2 2c0 1.5-2 1.5-2 3a2 2 0 0 0 2 2"/>',
"clock":'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
"maximize":'<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
"skip-back":'<path d="M19 20 9 12l10-8z"/><path d="M5 19V5"/>',
"skip-forward":'<path d="m5 4 10 8-10 8z"/><path d="M19 5v14"/>',
"align-left":'<path d="M3 6h18M3 12h12M3 18h15"/>',
"align-center":'<path d="M3 6h18M7 12h10M5 18h14"/>',
"align-right":'<path d="M3 6h18M9 12h12M6 18h15"/>',
"flag":'<path d="M5 21V4"/><path d="M5 4h13l-2.5 4L18 12H5"/>',
"package":'<path d="m12 2 9 5v10l-9 5-9-5V7z"/><path d="m3 7 9 5 9-5"/><path d="M12 22V12"/>',
"square":'<rect x="4" y="4" width="16" height="16" rx="2"/>',
"circle":'<circle cx="12" cy="12" r="9"/>',
"triangle":'<path d="M12 3.5 21.5 20h-19z"/>',
"diamond":'<path d="M12 2.5 21 12l-9 9.5L3 12z"/>',
"panel-left":'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
"panel-right":'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
"panel-bottom":'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15h18"/>',
"key":'<circle cx="8" cy="15" r="4.5"/><path d="m11 12 9-9"/><path d="m16 4 3 3M13 7l3 3"/>',
"minus-circle":'<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
"grip":'<circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none"/>',
"mouse-pointer":'<path d="m4 3 7.5 18 2.5-7.5L21.5 11z"/>',
"sun-medium":'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
"waves":'<path d="M2 6c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2"/><path d="M2 12c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2"/><path d="M2 18c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2"/>',
"brush":'<path d="m9.5 13.5-1 8.5-3-3 8.5-1"/><path d="M14.5 4.5a5 5 0 0 1 7 7L11 22l-4.5-4.5z"/><path d="M14 7l3 3"/>',
"blend":'<circle cx="9" cy="9" r="6.5"/><circle cx="15" cy="15" r="6.5"/>',
"archive":'<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
"hard-drive":'<path d="M22 12H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/><path d="M6 16h.01M10 16h.01"/>',
"help-circle":'<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.6-3 4"/><path d="M12 17h.01"/>',
"gradient":'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16c4-6 6 4 10-2s6 2 8-2"/>',
"frame":'<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>',
"text-cursor":'<path d="M5 5h14M12 5v14M9 19h6"/>',
"ruler":'<path d="M3 17 17 3l4 4L7 21z"/><path d="m8 16 1.5 1.5M11 13l1.5 1.5M14 10l1.5 1.5M17 7l1.5 1.5"/>',
"shapes":'<path d="M8 3H5a2 2 0 0 0-2 2v3"/><rect x="3" y="3" width="8" height="8" rx="1.5"/><circle cx="16.5" cy="16.5" r="5.5"/>',
"eyedropper":'<path d="m18 11-8.5 8.5a2.1 2.1 0 0 1-3-3L15 8"/><path d="m14 7 3 3"/><path d="m18 3 3 3-9.5 9.5"/>',
"contrast":'<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>',
"gauge":'<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M12 12 15.5 6.5"/><path d="M20.5 15a9 9 0 1 0-17 0"/>',
"wind":'<path d="M3 8h9a3 3 0 1 0-3-3"/><path d="M3 12h13a3 3 0 1 1-3 3"/><path d="M3 16h6a2.5 2.5 0 1 1-2.5 2.5"/>',
"bandage":'<rect x="2" y="9" width="20" height="6" rx="3" transform="rotate(-45 12 12)"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
"eyedropper":'<path d="m18 11-8.5 8.5a2.1 2.1 0 0 1-3-3L15 8"/><path d="m14 7 3 3"/><path d="m18 3 3 3-9.5 9.5"/>'
};
var FILLED={"star":1,"eye":0};
function epIcon(name,size,filled){
  var inner=EP_ICONS[name];
  if(!inner){if(typeof console!=="undefined"&&console.warn)console.warn("Editora icon missing:",name);inner=EP_ICONS["help-circle"];name="help-circle";}
  var s=size||18;
  var fillAttr=(filled||FILLED[name])?' fill="currentColor" stroke="none"':"";
  /* Filled variant: keep the same outline paths but fill them (star). */
  return '<svg class="ep-svg" width="'+s+'" height="'+s+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"'+fillAttr+'>'+inner+'</svg>';
}
function epHydrateIcons(root){
  root=root||document;
  var els=root.querySelectorAll?root.querySelectorAll("[data-ic]"):[];
  for(var i=0;i<els.length;i++){
    var el=els[i],name=el.getAttribute("data-ic");
    if(!name||el.getAttribute("data-ic-done"))continue;
    var size=parseInt(el.getAttribute("data-ic-size")||"18",10)||18;
    el.innerHTML=epIcon(name,size,el.getAttribute("data-ic-filled")==="1");
    el.setAttribute("data-ic-done","1");
  }
  return els.length;
}
function epSetIcon(el,name,size){if(el)el.innerHTML=epIcon(name,size||18);}
window.EP_ICONS=EP_ICONS;
window.epIcon=epIcon;
window.epHydrateIcons=epHydrateIcons;
window.epSetIcon=epSetIcon;
})();
