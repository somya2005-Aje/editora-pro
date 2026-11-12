/* Editora Pro — Video Editor (Vanilla JS, no ads, no AI, no watermark) */
"use strict";
const $=id=>document.getElementById(id);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
/* FIX 2026-11-12: float artifacts in stored times (e.g. a split at 2.7 s
   stored 2.700000047683716 — float32 precision leaking into a float64
   field). All stored start/duration/trim values are rounded to 2
   decimals at the point they are written, so the inspector and the
   project JSON never show them. */
const round2=v=>Math.round(v*100)/100;
/* WEBCODECS CHUNK DURATIONS (2026-11-12, Bug 1) — root cause of the live
   "addVideoChunkRaw's fourth argument (duration) must be a non-negative
   real number" failure at 70% of a Canvas export (Fog / 720p): the export
   created VideoFrames with a timestamp but NO duration, so the encoder
   emitted a final chunk during flush — no next frame exists to infer a
   duration from — whose duration was null, and mp4-muxer throws on a
   non-finite duration. Every chunk duration is therefore computed from
   its frame/sample INDEX — video: exactly 1/fps per frame, audio:
   exactly samples/sampleRate per chunk — clamped to >=1 us, never
   derived by subtracting two timestamps (which can invert at the last
   frame). epSafeVideoChunk/epSafeAudioChunk are the backstop: any chunk
   whose duration is missing, NaN or <1 us is rebuilt with the exact
   index-derived duration before it reaches the muxer. */
const EP_FRAME_DUR_US=fps=>Math.max(1,Math.round(1e6/(fps||30)));
const EP_AUDIO_DUR_US=(n,rate)=>Math.max(1,Math.round((n||0)*1e6/(rate||44100)));
const EP_SAFE_DUR=(d,fallback)=>{const f=Math.max(1,Math.round(fallback||1));return (typeof d==="number"&&Number.isFinite(d)&&d>=1)?Math.round(d):f;};
function epSafeVideoChunk(chunk,fallbackUs){
  if(chunk&&typeof chunk.duration==="number"&&Number.isFinite(chunk.duration)&&chunk.duration>=1)return chunk;
  try{const data=new Uint8Array(chunk.byteLength);chunk.copyTo(data);
    return new EncodedVideoChunk({type:chunk.type,timestamp:chunk.timestamp,duration:EP_SAFE_DUR(chunk&&chunk.duration,fallbackUs),data});}
  catch(e){return chunk;}
}
function epSafeAudioChunk(chunk,fallbackUs){
  if(chunk&&typeof chunk.duration==="number"&&Number.isFinite(chunk.duration)&&chunk.duration>=1)return chunk;
  try{const data=new Uint8Array(chunk.byteLength);chunk.copyTo(data);
    return new EncodedAudioChunk({type:chunk.type,timestamp:chunk.timestamp,duration:EP_SAFE_DUR(chunk&&chunk.duration,fallbackUs),data});}
  catch(e){return chunk;}
}
const fmt=t=>{t=Math.max(0,t||0);const m=Math.floor(t/60),s=t%60;return String(m).padStart(2,"0")+":"+s.toFixed(1).padStart(4,"0");};
/* Timecode HH:MM:SS:FF at the project frame rate (Phase 2). */
const fmtTC=t=>{t=Math.max(0,t||0);const fps=S.fps||30;const fr=Math.floor((t-Math.floor(t))*fps+1e-6);const s=Math.floor(t)%60,m=Math.floor(t/60)%60,h=Math.floor(t/3600);return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")+":"+String(fr).padStart(2,"0");};
const toast=(m,ms=2600)=>{const t=$("toast");t.textContent=m;t.classList.add("show");clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove("show"),ms);};
/* Play button label is an SVG icon + text (icons.js), never an emoji. */
function setPlayBtn(state){const b=$("btnPlay");if(!b)return;
  if(state==="pause")b.innerHTML=epIcon("pause")+" Pause";
  else if(state==="reversing")b.innerHTML=epIcon("rewind")+" Reversing…";
  else b.innerHTML=epIcon("play")+" Play";}
/* ---------- MODALS (P0 fix 2026-11-12) ----------
   Only ONE modal open at a time. Every open goes through openModal() (which
   closes the others); every close goes through closeModal(). Backdrop clicks
   and Escape also close. Relies on the [hidden]{display:none!important} rule
   at the top of app.css — setting .hidden alone used to be ineffective
   because .modal{display:flex} overrode it. */
function openModal(id){closeAllModals();const el=$(id);if(el)el.hidden=false;}
function closeModal(id){const el=$(id);if(el)el.hidden=true;}
function closeAllModals(){$$(".modal").forEach(m=>{m.hidden=true;});}
function topOpenModal(){return $$(".modal").find(m=>!m.hidden)||null;}
const uid=()=> "id"+Math.random().toString(36).slice(2,9);

/* ---------- STATE ---------- */
const S={
  mode:"video", projectName:"Untitled Project",
  media:[],            // {id,name,type:'video'|'image'|'audio',url,file,thumb,fav,duration}
  clips:[],            // video track {id,mediaId,name,start,duration,trimIn,trimOut,opacity,scale,rotation,transition,transDur,filter,fx}
  textClips:[],        // {id,text,start,duration,font,size,color,bg,bgOn,outline,shadow,pos,anim}
  audioClips:[],       // {id,mediaId,name,start,duration,vol}
  captions:[],         // {id,text,start,end}
  keyframes:[],        // {id,prop,time,value}
  color:{brightness:100,contrast:100,saturation:100,exposure:0,temperature:0,tint:0,sharpness:0,highlights:0,shadows:0,vibrance:0,gamma:100,whites:0,blacks:0,dehaze:0,noise:0,fade:0,vignette:0},
  /* Phase 3 — filters / grading / transitions / per-clip effects */
  filterId:"Normal",filterIntensity:100,
  curves:{rgb:[[0,0],[255,255]],r:[[0,0],[255,255]],g:[[0,0],[255,255]],b:[[0,0],[255,255]]},
  hsl:{hue:0,sat:0,light:0},
  wheels:{sh:{x:0,y:0,amt:50},mid:{x:0,y:0,amt:50},hi:{x:0,y:0,amt:50}},
  balance:{r:0,g:0,b:0},
  lut:null,lutName:"",lutIntensity:100,
  transDir:"auto",transSpeed:100,transReverse:false,transIntensity:100,transEase:"linear",transSoft:0,
  fxClipboard:null,filterClipboard:null,curveChan:"rgb",
  preset:"Normal", fx:{}, fxStrength:60, rotation:0, flipH:false, flipV:false, cropRatio:"free", cropZoom:100,
  reverse:false, speed:1, curTime:0, duration:0, selClip:null, selType:null, snap:true, zoom:100, fps:30, rippleAll:false,
  locked:{v1:false,v2:false,text:false,a1:false,a2:false}, mutedTracks:{v1:false,v2:false,text:false,a1:false,a2:false}, safeAreas:false, karaoke:false, transType:"none", transDur:0.5, posX:0, posY:0, scaleX:100, scaleY:100,
  clipboard:null, exportOnly:null, mediaFilterAdded:false,
  audVol:80, vidVol:100, fadeIn:0, fadeOut:0, bass:0, treble:0, muted:false,
  settings:{autosave:true,autosaveInterval:1,defRes:"1080",defFps:30,defFmt:"mp4",previewQuality:"high",theme:"dark",confirmDelete:false,restoreLast:false,language:"en"}, dirty:false, exporting:false,
  capStyle:{font:"Arial",size:22,color:"#ffffff",bg:"#000000",bgOn:true,outline:true,anim:"none"},
  capTracks:[{id:"main",name:"Main"},{id:"secondary",name:"Secondary"}],
  capTrackSel:"main",
  audioFx:{eq:[0,0,0,0,0],bassBoost:0,treble:0,reverb:0,echo:0,delay:0,chorus:0,flanger:0,phaser:0,distortion:0,compressor:0,limiter:0,gate:0,noiseRed:0},
  motionBlur:false, kfClipboard:null, selKf:null,
  ffLoaded:false, ffLoading:false, ffError:null, ffLocal:false, ffCoreSrc:null, _ffCancelled:false,
  markers:[], // timeline markers {id,time,label,color} — persisted in the project snapshot
  /* Phase 6 — split screen / proxy / ducking / export queue */
  splitScreen:null, // {mode:"2v"|"2h"|"3"|"4", cells:[mediaId|null,...]} — cell 0 is the V1 clip
  proxyOn:false, duckOn:false, duckAmt:60,
  exportQueue:[], queueRunning:false, queuePaused:false, queueCancelled:false,
  h265:null, h265Checked:false, _lastJob:null,
  projFilter:"all", libTab:"all", libFolder:null, libSearch:"", libSort:"date",
};
const APP_VERSION="1.0.0";
let historyLock=false; /* set while applySnapshot restores, so UI sync during a restore cannot record a snapshot */
window.S=S; // expose state for debugging / external helpers
function snapshot(){return JSON.stringify({clips:S.clips,textClips:S.textClips,audioClips:S.audioClips,captions:S.captions,keyframes:S.keyframes,markers:S.markers,color:S.color,fx:S.fx,preset:S.preset,rotation:S.rotation,flipH:S.flipH,flipV:S.flipV,cropZoom:S.cropZoom,posX:S.posX,posY:S.posY,scaleX:S.scaleX,scaleY:S.scaleY,projectName:S.projectName,capStyle:S.capStyle,cropRatio:S.cropRatio,fps:S.fps,rippleAll:S.rippleAll,filterId:S.filterId,filterIntensity:S.filterIntensity,curves:S.curves,hsl:S.hsl,wheels:S.wheels,balance:S.balance,lutName:S.lutName,lutIntensity:S.lutIntensity,transDir:S.transDir,transSpeed:S.transSpeed,transReverse:S.transReverse,transIntensity:S.transIntensity,transEase:S.transEase,transSoft:S.transSoft,mutedTracks:S.mutedTracks,capTracks:S.capTracks,capTrackSel:S.capTrackSel,audioFx:S.audioFx,motionBlur:S.motionBlur,splitScreen:S.splitScreen,proxyOn:S.proxyOn,duckOn:S.duckOn,duckAmt:S.duckAmt});}
/* History now lives in app/modules/history.js (EPHistory, post-edit
   mode): pushHistory() is called AFTER an edit and records the
   post-edit state. Same semantics as the old inline stack. */
const epHist=EPHistory.create(snapshot,function(j){applySnapshot(j);},{limit:60,mode:"post"});
function pushHistory(){if(historyLock)return;if(epHist.push())markDirty();}
function applySnapshot(json){historyLock=true;try{const d=JSON.parse(json);Object.assign(S,{clips:d.clips,textClips:d.textClips,audioClips:d.audioClips,captions:d.captions,keyframes:d.keyframes,markers:d.markers||[],color:d.color,fx:d.fx,preset:d.preset,rotation:d.rotation,flipH:d.flipH,flipV:d.flipV,cropZoom:d.cropZoom,posX:d.posX||0,posY:d.posY||0,scaleX:d.scaleX||100,scaleY:d.scaleY||100,projectName:d.projectName});if(d.capStyle)S.capStyle=d.capStyle;if(d.cropRatio)S.cropRatio=d.cropRatio;if(d.fps)S.fps=d.fps;if(typeof d.rippleAll==="boolean")S.rippleAll=d.rippleAll;
  if(d.filterId)S.filterId=d.filterId;if(d.filterIntensity!==undefined)S.filterIntensity=d.filterIntensity;
  if(d.curves)S.curves=d.curves;if(d.hsl)S.hsl=d.hsl;if(d.wheels)S.wheels=d.wheels;if(d.balance)S.balance=d.balance;
  if(d.lutName!==undefined){S.lutName=d.lutName;if(d.lutName&&!S.lut){const ln=$("lutName");if(ln)ln.textContent="LUT “"+d.lutName+"” was used — re-import the .cube file to apply it again.";}}
  if(d.lutIntensity!==undefined)S.lutIntensity=d.lutIntensity;
  if(d.transDir)S.transDir=d.transDir;if(d.transSpeed!==undefined)S.transSpeed=d.transSpeed;
  if(typeof d.transReverse==="boolean")S.transReverse=d.transReverse;if(d.transIntensity!==undefined)S.transIntensity=d.transIntensity;
  if(d.transEase)S.transEase=d.transEase;if(d.transSoft!==undefined)S.transSoft=d.transSoft;if(d.mutedTracks)S.mutedTracks=d.mutedTracks;
  if(Array.isArray(d.capTracks)&&d.capTracks.length)S.capTracks=d.capTracks;
  if(d.capTrackSel)S.capTrackSel=d.capTrackSel;
  if(d.audioFx)S.audioFx=d.audioFx;
  if(typeof d.motionBlur==="boolean")S.motionBlur=d.motionBlur;
  if(d.splitScreen!==undefined)S.splitScreen=d.splitScreen;
  if(typeof d.proxyOn==="boolean")S.proxyOn=d.proxyOn;
  if(typeof d.duckOn==="boolean")S.duckOn=d.duckOn;
  if(d.duckAmt!==undefined)S.duckAmt=d.duckAmt;
  if(S.captions)S.captions.forEach(c=>{if(!c.trackId)c.trackId="main";});
  syncGradeUI();syncTransUI();syncFpsUI();syncRippleUI();$("projectName").value=S.projectName;syncColorUI();syncInspectorTransform();syncCapStyleUI();if(typeof syncMuteButtons==="function")syncMuteButtons();if(typeof updateMonRes==="function")updateMonRes();renderAll();}finally{historyLock=false;}}
function undo(){epHist.undo().then(function(did){if(did)toast("Undone");});}
function redo(){epHist.redo().then(function(did){if(did)toast("Redone");});}
/* FIX 2026-11-12 (Issue 3): autosave is a ~1 s debounce after the last
   change, not a 10 s poll. Every edit path already calls markDirty() (via
   pushHistory() or directly), so scheduling here covers all of them. The
   5 s interval further down is only a safety net. */
let autosaveTimer=null, saveRunning=false;
function scheduleAutosave(){
  if(!S.settings.autosave)return;
  clearTimeout(autosaveTimer);
  autosaveTimer=setTimeout(async()=>{
    if(!S.settings.autosave||!S.dirty||saveRunning)return;
    saveRunning=true;
    try{await saveProjectQueued(true);}finally{saveRunning=false;}
  },(S.settings.autosaveInterval||1)*1000);
}
function markDirty(){S.dirty=true;scheduleAutosave();}

/* ---------- COLOR / FILTER ---------- */
const COLOR_DEFS=[["brightness","Brightness",0,200,100,"%",v=>v],["contrast","Contrast",0,200,100,"%",v=>v],["saturation","Saturation",0,200,100,"%",v=>v],["vibrance","Vibrance",-100,100,0,"",v=>v],["exposure","Exposure",-100,100,0,"",v=>v],["temperature","Temperature",-100,100,0,"",v=>v],["tint","Tint",-100,100,0,"",v=>v],["highlights","Highlights",-100,100,0,"",v=>v],["shadows","Shadows",-100,100,0,"",v=>v],["whites","Whites",-100,100,0,"",v=>v],["blacks","Blacks",-100,100,0,"",v=>v],["gamma","Gamma",50,200,100,"%",v=>v],["sharpness","Sharpen",0,100,0,"",v=>v],["dehaze","Dehaze",0,100,0,"",v=>v],["fade","Fade (lift blacks)",0,100,0,"",v=>v],["vignette","Vignette",0,100,0,"",v=>v],["noise","Noise reduction (spatial denoise)",0,100,0,"",v=>v]];
const PRESETS={
  Normal:{brightness:100,contrast:100,saturation:100,vibrance:0,exposure:0,temperature:0,tint:0,highlights:0,shadows:0,whites:0,blacks:0,gamma:100,sharpness:0,dehaze:0,fade:0,vignette:0,noise:0},
  Vintage:{brightness:105,contrast:90,saturation:80,vibrance:0,exposure:5,temperature:25,tint:10,highlights:-10,shadows:15,whites:0,blacks:10,gamma:100,sharpness:0,dehaze:0,fade:15,vignette:20,noise:0},
  "B&W":{brightness:100,contrast:115,saturation:0,vibrance:0,exposure:0,temperature:0,tint:0,highlights:0,shadows:0,whites:0,blacks:0,gamma:100,sharpness:10,dehaze:0,fade:0,vignette:0,noise:0},
  Warm:{brightness:102,contrast:102,saturation:115,vibrance:10,exposure:3,temperature:35,tint:5,highlights:5,shadows:0,whites:0,blacks:0,gamma:100,sharpness:0,dehaze:0,fade:0,vignette:0,noise:0},
  Cool:{brightness:100,contrast:105,saturation:105,vibrance:0,exposure:0,temperature:-30,tint:-5,highlights:5,shadows:5,whites:0,blacks:0,gamma:100,sharpness:0,dehaze:0,fade:0,vignette:0,noise:0},
  Vivid:{brightness:103,contrast:118,saturation:150,vibrance:20,exposure:2,temperature:5,tint:0,highlights:0,shadows:-5,whites:5,blacks:-5,gamma:100,sharpness:15,dehaze:10,fade:0,vignette:0,noise:0},
  VHS:{brightness:98,contrast:110,saturation:130,vibrance:0,exposure:0,temperature:10,tint:15,highlights:-15,shadows:10,whites:0,blacks:0,gamma:100,sharpness:0,dehaze:0,fade:0,vignette:0,noise:0},
};
function buildColorUI(){
  const box=$("colorSliders");box.innerHTML="";
  COLOR_DEFS.forEach(([key,label,min,max,def])=>{
    const w=document.createElement("div");
    w.innerHTML=`<label>${label} <span id="cv_${key}">${S.color[key]}</span></label><input type="range" min="${min}" max="${max}" value="${S.color[key]}" data-k="${key}">`;
    w.querySelector("input").addEventListener("input",e=>{S.color[key]=+e.target.value;$("cv_"+key).textContent=S.color[key];applyFilters();markDirty();if(typeof scheduleGradeThumb==="function")scheduleGradeThumb();});
    box.appendChild(w);
  });
  const pl=$("presetList");pl.innerHTML="";
  Object.keys(PRESETS).forEach(name=>{
    const b=document.createElement("button");b.className="fx-btn";b.textContent=name;
    b.onclick=()=>{applyPreset(name);};
    pl.appendChild(b);
  });
}
function syncColorUI(){buildColorUI();}
function applyPreset(name){const p=PRESETS[name];if(!p)return;Object.assign(S.color,p);S.preset=name;buildColorUI();applyFilters();if(typeof scheduleGradeThumb==="function")scheduleGradeThumb();pushHistory();toast("Preset applied: "+name);}
/* Phase 3: filter layer sits on top of the base grading. The filter's
   params are scaled by filterIntensity; "Normal" contributes nothing.
   CSS can only approximate curves / HSL / wheels / LUT — those render
   for real in the Canvas export pixel math (and FFmpeg curves/lut3d),
   and the graded still frame in the Adjustment tab shows their pixels. */
function filterParams(){
  const f=FILTERS[S.filterId]||FILTERS.Normal;const k=(S.filterIntensity??100)/100;
  if(!f||S.filterId==="Normal"||k===0)return null;
  const sc=(v,base)=>base+(v-base)*k;
  return{brightness:sc(f.brightness??100,100),contrast:sc(f.contrast??100,100),saturation:sc(f.saturation??100,100),
    exposure:(f.exposure??0)*k,temperature:(f.temperature??0)*k,tint:(f.tint??0)*k,
    highlights:(f.highlights??0)*k,shadows:(f.shadows??0)*k,sepia:(f.sepia??0)*k,
    hue:(f.hue??0)*k,pixel:f.pixel||null,duotone:f.duotone||null,posterize:f.posterize||0};
}
function cssFilterString(){
  const c=S.color,fp=filterParams();
  const b=fp?fp.brightness:c.brightness, ct=fp?fp.contrast:c.contrast, st=fp?fp.saturation:c.saturation;
  const ex=(fp?fp.exposure:0)+c.exposure, temp=(fp?fp.temperature:0)+c.temperature, tint=(fp?fp.tint:0)+c.tint;
  const tempF=temp>0?` sepia(${Math.min(30,temp/3)}%)`:"";
  const tintF=tint!==0?` hue-rotate(${(tint/5).toFixed(1)}deg)`:"";
  const hueF=fp&&fp.hue?` hue-rotate(${fp.hue.toFixed(1)}deg)`:"";
  const sepF=fp&&fp.sepia?` sepia(${Math.min(100,fp.sepia).toFixed(0)}%)`:"";
  const vib=c.vibrance?` saturate(${1+c.vibrance/300})`:"";
  let f=`brightness(${(b/100*(1+ex/200)).toFixed(3)}) contrast(${(ct/100).toFixed(3)}) saturate(${(st/100).toFixed(3)})${tempF}${tintF}${hueF}${sepF}${vib}`;
  if(c.sharpness>0) f+=` contrast(${(1+c.sharpness/500).toFixed(3)})`;
  if(c.highlights||c.shadows||(fp&&(fp.highlights||fp.shadows))) f+=` brightness(${1+((c.highlights||0)+(fp?fp.highlights:0))/400})`;
  return f;
}
/* Composed preview style: base transform + keyframe scale/opacity + transition fx */
let _kf={opacity:null,scale:null}, _tr={opacity:1,scale:1,tx:0,rot:0,blur:0};
function cropClipPath(){
  if(S.cropRatio==="free"||!video.videoWidth||!video.videoHeight)return "none";
  const parts=S.cropRatio.split(":").map(Number);if(parts.length!==2||!parts[0]||!parts[1])return "none";
  const va=video.videoWidth/video.videoHeight, ta=parts[0]/parts[1];
  if(Math.abs(va-ta)<0.01)return "none";
  if(va>ta){const cut=(1-ta/va)/2*100;return `inset(0 ${cut.toFixed(2)}% 0 ${cut.toFixed(2)}%)`;}
  const cut=(1-va/ta)/2*100;return `inset(${cut.toFixed(2)}% 0 ${cut.toFixed(2)}% 0)`;
}
function refreshVideoStyle(){
  const v=$("previewVideo");if(!v)return;
  const sc=(_kf.scale!=null?_kf.scale/100:1)*(_tr.scale||1);
  v.style.transform=`translate(${(S.posX||0)+(_tr.tx||0)}px,${(S.posY||0)+(_tr.ty||0)}px) rotate(${S.rotation+(_tr.rot||0)}deg) scale(${((S.flipH?-1:1)*(S.cropZoom/100)*((S.scaleX||100)/100)*sc).toFixed(3)},${((S.flipV?-1:1)*(S.cropZoom/100)*((S.scaleY||100)/100)*sc).toFixed(3)})`;
  const fx=S.fx;let extra="";
  if(fx.blur) extra+=` blur(${(S.fxStrength/100*8).toFixed(1)}px)`;
  if(fx.glow) extra+=` drop-shadow(0 0 ${S.fxStrength/4}px rgba(255,255,255,.9))`;
  if(fx.vignette) extra+=` brightness(${1-S.fxStrength/400})`;
  if(_tr.blur) extra+=` blur(${_tr.blur.toFixed(1)}px)`;
  /* Phase 3: per-clip effect preview (CSS approximation of the pixel math
     the Canvas export does for real). */
  const cf=activeClipFx();
  if(cf.gaussBlur) extra+=` blur(${((cf.gaussBlur||60)/100*10).toFixed(1)}px)`;
  if(cf.motionBlur) extra+=` blur(${((cf.motionBlur||60)/100*6).toFixed(1)}px)`;
  if(cf.glow) extra+=` drop-shadow(0 0 ${(((cf.glow||60))/4).toFixed(0)}px rgba(255,255,255,.9))`;
  if(cf.bloom) extra+=` drop-shadow(0 0 ${(((cf.bloom||60))/3).toFixed(0)}px rgba(255,255,255,.9)) brightness(${1+((cf.bloom||60)/400)})`;
  if(cf.invert) extra+=` invert(1)`;
  if(cf.solarize) extra+=` sepia(0.6) hue-rotate(180deg)`;
  if(cf.vhsDist) extra+=` saturate(1.3) contrast(1.1)`;
  if(cf.vhs) extra+=` saturate(1.25) contrast(1.05) brightness(1.03)`;
  if(cf.crt) extra+=` saturate(1.1) contrast(1.2) brightness(0.95)`;
  if(cf.oldtv) extra+=` grayscale(0.3) sepia(0.3) contrast(1.1)`;
  if(cf.sketch) extra+=` grayscale(1) contrast(1.4)`;
  if(cf.cartoon) extra+=` saturate(1.6) contrast(1.15)`;
  if(cf.posterize) extra+=` contrast(1.2) saturate(1.3)`;
  if(cf.duotone) extra+=` grayscale(1) contrast(1.1)`;
  if(cf.rgbSplit) extra+=` saturate(1.2)`;
  if(cf.rgbShift) extra+=` saturate(1.5)`;
  if(cf.wave||cf.ripple||cf.warp||cf.fisheye||cf.swirl) extra+=` contrast(1.05)`;
  if(cf.ghosting||cf.echo||cf.motionTrail) extra+=` brightness(1.05)`;
  if(cf.dropShadow) extra+=` drop-shadow(6px 6px 10px rgba(0,0,0,${(0.5*(cf.dropShadow/100)).toFixed(2)}))`;
  if(cf.longShadow) extra+=` drop-shadow(18px 18px 0 rgba(0,0,0,${(0.55*(cf.longShadow/100)).toFixed(2)}))`;
  if(cf.innerShadow) extra+=` brightness(${1-0.12*(cf.innerShadow/100)}) contrast(1.05)`;
  if(_tr.shake){const s=_tr.shake;v.style.transform+=` translate(${(Math.sin(S.curTime*47)*s).toFixed(1)}px,${(Math.cos(S.curTime*39)*s).toFixed(1)}px)`;}
  /* Per-clip shake effects move the frame for real in the preview (they
     used to add only a fake brightness bump; the Canvas export moves the
     frame the same way in drawFrame). Each type has its own motion. */
  if(cf.cameraShake||cf.handheld||cf.zoomShake){
    const tt=S.curTime||0;
    if(cf.cameraShake){const s=(cf.cameraShake/100)*6;v.style.transform+=` translate(${(Math.sin(tt*47)*s).toFixed(1)}px,${(Math.cos(tt*39)*s).toFixed(1)}px)`;}
    else if(cf.handheld){const s=(cf.handheld/100)*8;v.style.transform+=` translate(${(Math.sin(tt*1.3)*s).toFixed(1)}px,${(Math.sin(tt*1.7+1)*s*0.7).toFixed(1)}px) rotate(${(Math.sin(tt*0.9)*0.6*(cf.handheld/100)).toFixed(2)}deg)`;}
    else{const s=(cf.zoomShake/100);v.style.transform+=` scale(${(1+Math.sin(tt*9)*0.03*s).toFixed(3)}) translate(${(Math.sin(tt*31)*3*s).toFixed(1)}px,${(Math.cos(tt*27)*3*s).toFixed(1)}px)`;}
  }
  v.style.filter=cssFilterString()+extra;
  /* Phase 6 — mask preview (approximation): a shape mask on the active
     clip is shown as a CSS clip-path / mask-image on the video element.
     The Canvas export does the real feathered mask; the preview cannot
     feather a <video> element, so edges look harder here than in export. */
  const _hit6=activeVideoAt(S.curTime);
  const _mk=_hit6&&_hit6.clip.mask;
  if(_mk&&_mk.shape&&_mk.shape!=="none"){
    if(_mk.shape==="rect")v.style.clipPath="inset(12% 12% 12% 12%)";
    else if(_mk.shape==="ellipse")v.style.clipPath="ellipse(38% 38% at 50% 50%)";
    else if(_mk.shape==="linear")v.style.webkitMaskImage=_mk.dir==="right"?"linear-gradient(to left,#000 30%,transparent 90%)":_mk.dir==="up"?"linear-gradient(to bottom,#000 30%,transparent 90%)":_mk.dir==="down"?"linear-gradient(to top,#000 30%,transparent 90%)":"linear-gradient(to right,#000 30%,transparent 90%)";
    else if(_mk.shape==="radial")v.style.webkitMaskImage="radial-gradient(circle at 50% 50%,#000 30%,transparent 75%)";
    if(_mk.shape==="rect"||_mk.shape==="ellipse")v.style.webkitMaskImage="";
  }else{
    v.style.clipPath=cropClipPath();
    v.style.webkitMaskImage="";
  }
  /* Phase 4+5: transition shapes render in the preview too (wipe / circle /
     clock / diagonal / rect / diamond) — same geometry as the Canvas export.
     A soft edge uses a gradient mask instead of a hard clip-path. The shape
     overrides the mask/crop clip-path while the transition is running. */
  if(_tr.clipShape){
    const cs=_tr.clipShape, p=clamp(cs.prog,0,1), soft=cs.soft||0;
    const pct=(p*100).toFixed(1), inv=(100-p*100).toFixed(1);
    if(cs.type==="wipe"){
      const d=cs.dir||"left";
      if(soft>0){
        const s0=Math.max(0,(p-soft*0.25)*100).toFixed(1), s1=Math.min(100,(p+soft*0.25)*100).toFixed(1);
        const grad=d==="right"?`linear-gradient(to right,#000 ${s0}%,transparent ${s1}%)`:d==="down"?`linear-gradient(to bottom,#000 ${s0}%,transparent ${s1}%)`:d==="up"?`linear-gradient(to top,#000 ${s0}%,transparent ${s1}%)`:`linear-gradient(to left,#000 ${s0}%,transparent ${s1}%)`;
        v.style.webkitMaskImage=grad;v.style.clipPath="";
      }else{
        v.style.webkitMaskImage="";
        v.style.clipPath=d==="right"?`inset(0 ${inv}% 0 0)`:d==="down"?`inset(0 0 ${inv}% 0)`:d==="up"?`inset(${inv}% 0 0 0)`:`inset(0 0 0 ${inv}%)`;
      }
    }
    else if(cs.type==="circle"){v.style.webkitMaskImage="";v.style.clipPath=`circle(${(p*75).toFixed(1)}% at ${((cs.cx??0.5)*100).toFixed(0)}% ${((cs.cy??0.5)*100).toFixed(0)}%)`;}
    else if(cs.type==="clock"){v.style.clipPath="";v.style.webkitMaskImage=`conic-gradient(from -90deg,#000 ${(p*360).toFixed(0)}deg,transparent 0deg)`;}
    else if(cs.type==="diag"){v.style.webkitMaskImage="";v.style.clipPath=`polygon(0 0,${pct}% 0,100% 100%,0 100%)`;}
    else if(cs.type==="rect"){v.style.webkitMaskImage="";const q=(50-p*50).toFixed(1);v.style.clipPath=`inset(${q}% ${q}% ${q}% ${q}%)`;}
    else if(cs.type==="diamond"){v.style.webkitMaskImage="";const q=(p*50).toFixed(1);v.style.clipPath=`polygon(50% ${50-q}%,${50+q}% 50%,50% ${50+q}%,${50-q}% 50%)`;}
  }
  v.style.opacity=_kf.opacity!=null?_kf.opacity/100:_tr.opacity;
}
function applyFilters(){
  refreshVideoStyle();
  drawOverlayFX();
}
/* overlay canvas: vignette / grain / rgb-split approximation + glitch */
function drawOverlayFX(){
  const cv=$("overlayCanvas"),st=$("videoStage");if(!cv)return;
  const r=st.getBoundingClientRect();cv.width=Math.max(2,r.width);cv.height=Math.max(2,r.height);
  const x=cv.getContext("2d");x.clearRect(0,0,cv.width,cv.height);
  /* Phase 4+5 — true between-clips cross-dissolve in the preview (fade
     family): the previous clip's last frame, held on a second video element,
     is composited under the incoming clip on this canvas. Whenever the
     second frame is not ready yet, nothing is drawn and the normal
     single-video preview (incoming clip fading in) shows instead. */
  const _hitB=activeVideoAt(S.curTime);
  const _blend=_hitB?crossBlendPrev(_hitB.clip,_hitB.offset):null;
  if(_blend){
    const _pm=S.media.find(m=>m.id===_blend.clip.mediaId);
    if(_pm&&_pm.type==="video"){
      const _pv=ensurePreviewVideo2();
      const _target=Math.max(0,(_blend.clip.trimOut||_blend.clip.duration)-0.04);
      if(_pv._src!==_pm.url){_pv._src=_pm.url;_pv.src=_pm.url;}
      if(Math.abs(_pv.currentTime-_target)>0.3){try{_pv.currentTime=_target;}catch(e){}}
      if(_pv.readyState>=2&&_pv.videoWidth&&Math.abs(_pv.currentTime-_target)<0.35){
        x.save();try{x.filter=cssFilterString();}catch(e){}
        drawCover(x,_pv,cv.width,cv.height,_blend.clip);
        x.globalAlpha=_blend.e;drawCover(x,video,cv.width,cv.height,_hitB.clip);
        x.restore();
      }
    }else if(_pm&&_pm.type==="image"){
      const _pim=exportImgCache(_pm);
      if(_pim){x.save();try{x.filter=cssFilterString();}catch(e){}
        drawCover(x,_pim,cv.width,cv.height,_blend.clip);
        x.globalAlpha=_blend.e;drawCover(x,video,cv.width,cv.height,_hitB.clip);
        x.restore();}
    }
  }
  if(S.fx.vignette){const g=x.createRadialGradient(cv.width/2,cv.height/2,Math.min(cv.width,cv.height)*.35,cv.width/2,cv.height/2,Math.max(cv.width,cv.height)*.75);g.addColorStop(0,"rgba(0,0,0,0)");g.addColorStop(1,`rgba(0,0,0,${.35+S.fxStrength/200})`);x.fillStyle=g;x.fillRect(0,0,cv.width,cv.height);}
  if(S.fx.grain){x.fillStyle=`rgba(255,255,255,${S.fxStrength/600})`;for(let i=0;i<300;i++){x.fillRect(Math.random()*cv.width,Math.random()*cv.height,1.5,1.5);}}
  if(S.fx.glitch){x.fillStyle=`rgba(255,0,80,${S.fxStrength/400})`;x.fillRect(0,Math.random()*cv.height,cv.width,4+Math.random()*14);x.fillStyle=`rgba(0,255,255,${S.fxStrength/500})`;x.fillRect(0,Math.random()*cv.height,cv.width,3+Math.random()*10);}
  if(S.fx.rgb){x.fillStyle=`rgba(255,0,0,${S.fxStrength/500})`;x.fillRect(0,0,3,cv.height);x.fillStyle=`rgba(0,0,255,${S.fxStrength/500})`;x.fillRect(cv.width-3,0,3,cv.height);}
  /* Phase 3: transition overlay (flash / film burn / light leak / lens flare) */
  if(_tr.overlay){x.fillStyle=_tr.overlay.color;x.globalAlpha=clamp(_tr.overlay.alpha,0,1);x.fillRect(0,0,cv.width,cv.height);x.globalAlpha=1;
    if(_tr.overlay.flare){const g=x.createRadialGradient(cv.width*0.75,cv.height*0.25,0,cv.width*0.75,cv.height*0.25,Math.max(cv.width,cv.height)*0.5);g.addColorStop(0,"rgba(255,240,200,0.9)");g.addColorStop(1,"rgba(255,240,200,0)");x.fillStyle=g;x.fillRect(0,0,cv.width,cv.height);}}
  /* Phase 3: per-clip overlay effects (preview approximation; the Canvas
     export does the same effects in pixel math). Seeded by time so the
     pattern animates instead of flickering randomly each repaint. */
  const cf=activeClipFx();const t=S.curTime||0;
  const seeded=(i,salt)=>{const v=Math.sin(i*127.1+salt*311.7+t*13.7)*43758.5453;return v-Math.floor(v);};
  if(cf.rain||cf.snow||cf.particles||cf.bokeh||cf.dust||cf.scratches){
    const n=cf.rain?90:cf.snow?70:cf.particles?50:cf.bokeh?26:cf.dust?40:8;
    for(let i=0;i<n;i++){
      const px=seeded(i,1)*cv.width, py=((seeded(i,2)+t*(cf.rain?0.9:cf.snow?0.12:0.05))%1)*cv.height;
      if(cf.rain){x.strokeStyle=`rgba(180,220,255,${0.35*(cf.rain/100)})`;x.beginPath();x.moveTo(px,py);x.lineTo(px-3,py+14);x.stroke();}
      else if(cf.snow){x.fillStyle=`rgba(255,255,255,${0.7*(cf.snow/100)})`;x.beginPath();x.arc(px,py,1.5+seeded(i,3)*2,0,7);x.fill();}
      else if(cf.bokeh){const r=4+seeded(i,3)*14;x.fillStyle=`rgba(255,220,150,${0.10*(cf.bokeh/100)})`;x.beginPath();x.arc(px,py,r,0,7);x.fill();}
      else if(cf.dust||cf.particles){x.fillStyle=`rgba(255,255,255,${0.25*((cf.dust||cf.particles)/100)})`;x.fillRect(px,py,2,2);}
      else if(cf.scratches){x.fillStyle=`rgba(255,255,255,${0.3*(cf.scratches/100)})`;x.fillRect(px,py,1,20+seeded(i,3)*60);}
    }
  }
  if(cf.fog){const g=x.createLinearGradient(0,cv.height*0.5,0,cv.height);g.addColorStop(0,"rgba(200,200,210,0)");g.addColorStop(1,`rgba(200,200,210,${0.28*((cf.fog)/100)})`);x.fillStyle=g;x.fillRect(0,0,cv.width,cv.height);}
  if(cf.smoke){ /* drifting soft blobs instead of a flat gradient */
    for(let i=0;i<8;i++){
      const px=((seeded(i,21)+t*0.02*(1+i%3))%1)*cv.width, py=cv.height*(0.55+seeded(i,22)*0.4);
      const r=cv.width*(0.12+seeded(i,23)*0.15);
      const g=x.createRadialGradient(px,py,0,px,py,r);
      g.addColorStop(0,`rgba(210,210,220,${0.16*(cf.smoke/100)})`);g.addColorStop(1,"rgba(210,210,220,0)");
      x.fillStyle=g;x.beginPath();x.arc(px,py,r,0,7);x.fill();}
  }
  if(cf.crt||cf.oldtv||cf.vhs){x.fillStyle="rgba(0,0,0,0.18)";for(let y=0;y<cv.height;y+=4)x.fillRect(0,y,cv.width,1);}
  if(cf.filmFlicker||cf.strobe){const on=Math.floor(t*8)%2===0;x.fillStyle=`rgba(255,255,255,${on?0.05:0.12})`;x.fillRect(0,0,cv.width,cv.height);}
  if(cf.digitalGlitch||cf.rgbGlitch||cf.pixelGlitch||cf.signalError||_tr.pixel){
    const st=cf.digitalGlitch||cf.rgbGlitch||cf.pixelGlitch||cf.signalError||60;
    if(_tr.pixel==="pixelglitch"||cf.pixelGlitch){
      for(let i=0;i<40;i++){const px=seeded(i,7)*cv.width,py=seeded(i,9)*cv.height;x.fillStyle=`rgba(${i%2?"255,255,255":"0,0,0"},${(st/300)})`;x.fillRect(px,py,10,10);}
    }else if(_tr.pixel==="signalerror"||cf.signalError){
      for(let i=0;i<12;i++){const y=seeded(i,7)*cv.height;x.fillStyle=`rgba(${["255,0,0","0,255,0","0,0,255"][i%3]},${(st/300)})`;x.fillRect(0,y,cv.width,2+seeded(i,9)*6);}
    }else{
      for(let i=0;i<3;i++){const y=seeded(i,7)*cv.height;x.fillStyle=`rgba(${i%2?"0,255,255":"255,0,80"},${(st/400)})`;x.fillRect(0,y,cv.width,3+seeded(i,9)*10);}
    }
  }
  if(cf.lightLeak){ /* warm wash bleeding in from the left edge */
    const g=x.createLinearGradient(0,0,cv.width,0);
    g.addColorStop(0,`rgba(255,150,60,${0.4*(cf.lightLeak/100)})`);g.addColorStop(0.6,"rgba(255,150,60,0)");g.addColorStop(1,"rgba(255,150,60,0)");
    x.fillStyle=g;x.fillRect(0,0,cv.width,cv.height);}
  if(cf.lensFlare){ /* bright core + flare ghosts along a diagonal */
    const g=x.createRadialGradient(cv.width*0.8,cv.height*0.2,0,cv.width*0.8,cv.height*0.2,Math.max(cv.width,cv.height)*0.45);
    g.addColorStop(0,`rgba(255,230,180,${0.35*(cf.lensFlare/100)})`);g.addColorStop(1,"rgba(255,230,180,0)");
    x.fillStyle=g;x.fillRect(0,0,cv.width,cv.height);
    for(let i=0;i<3;i++){const fx2=cv.width*(0.55-i*0.14),fy2=cv.height*(0.35+i*0.14),fr=8+i*10;
      x.fillStyle=`rgba(255,240,200,${0.25*(cf.lensFlare/100)})`;x.beginPath();x.arc(fx2,fy2,fr,0,7);x.fill();}
  }
  if(cf.sunRays){ /* wedges of light fanning out from the top-right corner */
    x.save();x.translate(cv.width,cv.height*0.1);
    for(let i=0;i<6;i++){const a=Math.PI*(0.55+i*0.09);
      x.fillStyle=`rgba(255,225,150,${0.10*(cf.sunRays/100)})`;
      x.beginPath();x.moveTo(0,0);x.lineTo(Math.cos(a)*cv.width,Math.sin(a)*cv.width);x.lineTo(Math.cos(a+0.05)*cv.width,Math.sin(a+0.05)*cv.width);x.closePath();x.fill();}
    x.restore();
  }
  if(cf.filmBurn){const g=x.createLinearGradient(0,0,cv.width,cv.height);g.addColorStop(0,`rgba(255,120,40,${0.25*((cf.filmBurn)/100)})`);g.addColorStop(1,"rgba(255,200,80,0)");x.fillStyle=g;x.fillRect(0,0,cv.width,cv.height);}
  if(cf.halftone){x.fillStyle="rgba(0,0,0,0.12)";for(let yy=0;yy<cv.height;yy+=6)for(let xx=0;xx<cv.width;xx+=6){x.beginPath();x.arc(xx+3,yy+3,1,0,7);x.fill();}}
}

/* ---------- MEDIA ---------- */
function mediaType(f){if(f.type.startsWith("video/"))return"video";if(f.type.startsWith("image/"))return"image";if(f.type.startsWith("audio/"))return"audio";const e=(f.name.split(".").pop()||"").toLowerCase();if(["mp4","mov","webm","mkv","avi"].includes(e))return"video";if(["mp3","wav","aac","m4a","flac","ogg"].includes(e))return"audio";return"image";}
/* JOB 0 (2026-11-12): the import count is a plain array snapshot taken
   synchronously. The old code passed the live FileList from the file
   input into the async save-then-toast, but the change handler clears the
   input (e.target.value="") right after the call — clearing the input
   empties that same live FileList, so by the time the toast fired it read
   "0 file(s) imported — saved" even though the file was in the gallery. */
function addFiles(files){
  const list=files?[...files]:[];
  if(!list.length){toast("No file chosen — pick a file to import");return;}
  /* FIX 2026-11-12 (Issue 3c, verified): the count is captured once in a
     const — the toast below can never read a mutated/emptied list. The
     snapshot fix was already in the code (list is a sync copy, not the
     live FileList); this const makes it bulletproof. */
  const n=list.length;
  list.forEach(f=>{
    const type=mediaType(f);const url=URL.createObjectURL(f);
    const m={id:uid(),name:f.name,type,url,file:f,fav:false,duration:0,addedAt:Date.now(),folderId:null,size:f.size||0,proxyUrl:null,proxyBusy:false};
    S.media.push(m);
    if(type==="video"){const v=document.createElement("video");v.preload="metadata";v.src=url;v.onloadedmetadata=()=>{m.duration=round2(v.duration);renderMediaList();updateDuration();if(typeof maybeProxy==="function")maybeProxy(m);};}
    if(type==="audio"){const a=new Audio(url);a.onloadedmetadata=()=>{m.duration=round2(a.duration);renderMediaList();drawWaveform(m);};m.audioEl=a;}
  });
  renderMediaList();pushHistory();
  /* FIX 2026-11-12 (Issue 3): an import only counts once it is persisted —
     save first (project JSON + media blobs to IndexedDB), then toast. The
     old code toasted immediately and relied on the 10 s autosave poll, so a
     reload within seconds lost the import. */
  saveProjectQueued(true).then(()=>toast(n+" file(s) imported — saved"))
    .catch(()=>toast(n+" file(s) imported"));
}
function renderMediaList(){
  refreshEditMediaSelects();
  const q=($("mediaSearch").value||"").toLowerCase();const favOnly=$("btnFavFilter").classList.contains("on");
  const list=$("mediaList");list.innerHTML="";
  const usedIds=new Set([...S.clips,...S.audioClips].map(c=>c.mediaId));
  const items=S.media.filter(m=>(!favOnly||m.fav)&&(!S.mediaFilterAdded||usedIds.has(m.id))&&(!q||m.name.toLowerCase().includes(q)));
  if(!items.length){list.innerHTML='<p class="hint">No media matches.</p>';return;}
  items.forEach(m=>{
    const d=document.createElement("div");d.className="media-item";d.draggable=true;
    d.dataset.id=m.id;
    const thumb=m.type==="image"?`<img src="${m.url}" alt="">`:m.type==="video"?`<video src="${m.url}" muted preload="metadata" aria-hidden="true" tabindex="-1"></video>`:`<div class="aud-ico">${epIcon("music",26)}</div>`;
    d.innerHTML=`<div class="thumb">${thumb}${m.duration?`<span class="dur-badge">${fmt(m.duration)}</span>`:""}</div><div class="mi-name">${m.name}</div><div class="mi-meta">${m.type}${m.duration?" · "+fmt(m.duration):""}</div>
      <div class="mi-actions"><button class="mini" data-act="fav" title="Favorite">${epIcon("star",16,!!m.fav)}</button>
      <button class="mini" data-act="add" title="Add to timeline">+ Timeline</button>
      <button class="mini" data-act="del" title="Delete">${epIcon("trash")}</button></div>`;
    d.addEventListener("click",e=>{
      const act=e.target.dataset.act;
      if(act==="fav"){m.fav=!m.fav;renderMediaList();markDirty();}
      else if(act==="del"){S.media=S.media.filter(x=>x.id!==m.id);deleteMediaFromDB(m.id);renderMediaList();markDirty();toast("Media removed");}
      else if(act==="add"){addToTimeline(m);}
      else if(m.type==="video"||m.type==="image"){loadPreview(m);}
    });
    d.addEventListener("dragstart",e=>{e.dataTransfer.setData("text/media",m.id);});
    list.appendChild(d);
  });
}
function addToTimeline(m){
  if(m.type==="audio"){
    S.audioClips.push({id:uid(),mediaId:m.id,name:m.name,track:"a1",start:trackEnd("a1"),duration:round2(m.duration)||10,vol:S.audVol});
    drawWaveform(m);
  }else{
    const start=trackEnd("v1");
    S.clips.push({id:uid(),mediaId:m.id,name:m.name,track:"v1",start,duration:round2(m.duration)||5,trimIn:0,trimOut:round2(m.duration)||5,opacity:100,scale:100,rotation:0,transition:"none",transDur:0.5,speed:1,baseDur:round2(m.duration)||5,reverse:false});
    if(m.type==="video"||m.type==="image") loadPreview(m);
  }
  updateDuration();renderTimeline();pushHistory();toast("Added to timeline: "+m.name);
}
function trackEnd(track){
  const list=track==="v1"||track==="v2"?S.clips:S.audioClips;
  return list.filter(c=>c.track===track).reduce((a,c)=>Math.max(a,c.start+c.duration),0);
}
function totalDuration(){return Math.max(0,...S.clips.map(c=>c.start+c.duration),...S.audioClips.map(c=>c.start+c.duration),...S.textClips.map(c=>c.start+c.duration));}
function updateDuration(){
  const d=round2(totalDuration());S.duration=d; /* BUG 2: sum of 2-decimal values can still carry float noise */
  $("trimOut").max=d;$("trimOutR").max=d;
  if(!$("trimOut").value||+$("trimOut").value===0)$("trimOut").value=d.toFixed(1);
  $("trimOutR").value=$("trimOut").value;
  renderRuler();
}

/* ---------- PREVIEW / TRANSPORT ---------- */
const video=$("previewVideo");
let curMedia=null, reverseTimer=null;
function loadPreview(m){
  curMedia=m;$("stageEmpty").style.display="none";
  if(m.type==="image"){video.pause();video.removeAttribute("src");video.load();video.poster=m.url;video.style.display="none";showImagePreview(m);}
  else{video.style.display="";video.src=previewUrl(m);video.load();hideImagePreview();video.onloadedmetadata=()=>{S.duration=round2(Math.max(S.duration,video.duration||0));updateDuration();};}
  applyFilters();
}
let imgPrev=null;
/* Phase 4+5 — per-track mute (timeline track headers) + the second preview
   video element used for true between-clips cross-dissolves. */
function trackMuted(track){return !!(S.mutedTracks&&S.mutedTracks[track]);}
let previewVideo2=null;
function ensurePreviewVideo2(){
  if(previewVideo2)return previewVideo2;
  previewVideo2=document.createElement("video");
  previewVideo2.muted=true;previewVideo2.playsInline=true;previewVideo2.preload="auto";
  previewVideo2.setAttribute("aria-hidden","true");
  return previewVideo2;
}
/* Phase 4+5 — Program Monitor resolution readout (export resolution x aspect). */
function updateMonRes(){
  const el=$("monRes");if(!el)return;
  const res=$("expRes")?$("expRes").value||"1080":"1080";
  const map={480:"854×480",720:"1280×720",1080:"1920×1080",1440:"2560×1440",2160:"3840×2160",custom:"custom"};
  el.textContent=(map[res]||"1920×1080")+" · "+($("ratioSel")?$("ratioSel").value:"16:9");
}
/* Phase 4+5 — sync the timeline track-mute buttons with S.mutedTracks. */
function syncMuteButtons(){
  $$(".tmute").forEach(b=>{
    const tr=b.dataset.track,muted=trackMuted(tr);
    b.classList.toggle("muted",muted);
    b.innerHTML=epIcon(muted?"volume-x":"volume-1");
    b.title=muted?"Unmute track":"Mute track";
  });
}
function showImagePreview(m){hideImagePreview();imgPrev=document.createElement("img");imgPrev.src=m.url;imgPrev.style.cssText="max-width:100%;max-height:100%;object-fit:contain";$("videoStage").insertBefore(imgPrev,video);}
function hideImagePreview(){if(imgPrev){imgPrev.remove();imgPrev=null;}}
/* V1 is the main track; V2 is an overlay that wins when it covers time t */
function clipOnTrackAt(track,t){
  const c=S.clips.filter(x=>(x.track||"v1")===track&&!x.disabled).sort((a,b)=>a.start-b.start)
    .find(x=>t>=x.start&&t<x.start+x.duration);
  return c?{clip:c,offset:t-c.start}:null;
}
function currentClipAt(t){return clipOnTrackAt("v1",t);}
function activeVideoAt(t){
  const ov=clipOnTrackAt("v2",t);
  if(ov)return{...ov,overlay:true};
  const main=clipOnTrackAt("v1",t);
  return main?{...main,overlay:false}:null;
}
function seek(t){
  /* ROUND 2026-11-12: video.currentTime / ruler math carry float32 noise
     (e.g. 2.700000047683716 for 2.7) — round the playhead to 2 decimals at
     the entry point, or every duration computed from it inherits the noise. */
  S.curTime=round2(clamp(t,0,Math.max(0.01,totalDuration()||video.duration||0)));
  const hit=activeVideoAt(S.curTime);
  if(hit){
    const m=S.media.find(x=>x.id===hit.clip.mediaId);
    video.muted=S.muted||!!hit.clip.muted||trackMuted(hit.clip.track||"v1");
    if(hit.clip.rotation!==undefined&&hit.clip.rotation!==S.rotation){S.rotation=hit.clip.rotation;syncInspectorTransform();}
    video.playbackRate=clipSpeedAt(hit.clip,hit.offset)*S.speed;
    if(m&&m.type==="video"){
      if(curMedia!==m)loadPreview(m);
      const want=hit.clip.trimIn+sourceTimeForOffset(hit.clip,hit.offset);
      if(Math.abs(video.currentTime-want)>0.3)video.currentTime=clamp(want,0,(m.duration||0));
    }
    else if(m&&m.type==="image"){if(curMedia!==m)loadPreview(m);}
  } else { video.muted=S.muted; }
  _tr={opacity:1,scale:1,tx:0,ty:0,rot:0,blur:0,clipShape:null,overlay:null,shake:0,pixel:null};
  applyTransitionPreview(hit);
  updateTimeUI();renderTextOverlay();positionPlayhead();
  if(typeof renderSplitPreview==="function")renderSplitPreview();
  if(typeof renderChromaPreview==="function")renderChromaPreview();
}
/* Phase 3: transition preview — one shared engine (transCompute, defined
   in the Phase 3 section) drives preview, Canvas export and the FFmpeg
   fade-family mapping, so the three paths cannot drift apart. */
function applyTransitionPreview(hit){
  _tr={opacity:1,scale:1,tx:0,ty:0,rot:0,blur:0,clipShape:null,overlay:null,shake:0,pixel:null};
  if(!hit)return;
  const r=transCompute(hit.clip,hit.offset);
  Object.assign(_tr,r);
  refreshVideoStyle();
  drawOverlayFX();
}
function updateTimeUI(){const tot=totalDuration()||video.duration||0;$("timeDisplay").textContent=fmt(S.curTime)+" / "+fmt(tot);const tc=$("timecodeDisplay");if(tc)tc.textContent=fmtTC(S.curTime);}
/* ---------- PHASE 2 — Cut & Edit helpers ----------
   fps / timecode sync, source-length-aware duration, speed-aware split,
   ripple delete, insert edit, replace edit. All touch/tap driven; the
   keyboard arrows only call frameStep() (which now uses S.fps). */
function syncFpsUI(){const el=$("projFps");if(el)el.value=String(S.fps||30);const ex=$("expFps");if(ex)ex.value=String(S.fps||30);updateTimeUI();}
function syncRippleUI(){const b=$("btnRippleAll");if(b)b.textContent=S.rippleAll?"Ripple: All tracks":"Ripple: Same track";}
/* Source length (seconds) of a clip's media, or null when it has none
   (text clips) or no fixed length (images). */
function sourceDuration(clip){
  if(!clip||!clip.mediaId)return null;
  const m=S.media.find(x=>x.id===clip.mediaId);if(!m)return null;
  if(m.type==="image")return null;
  return (m.duration&&m.duration>0)?m.duration:null;
}
/* Re-time a clip. Video/audio clips are clamped to what is left of their
   source after trimIn (at the clip's speed); text and image clips take any
   duration >= 0.1s. trimOut is kept in step so both export paths (which
   read trimIn/trimOut) render the new duration. Returns the applied
   duration and whether it was clamped. */
function setClipDuration(clip,newDur){
  if(!clip)return{applied:0,clamped:false};
  let want=Math.max(0.1,+newDur||0.1),clamped=false;
  const src=sourceDuration(clip);
  if(src!==null){
    const sp=clip.speed||1,ti=clip.trimIn||0;
    const maxDur=Math.max(0.1,(src-ti)/sp);
    if(want>maxDur){want=maxDur;clamped=true;}
  }
  clip.duration=round2(want);
  if(clip.trimIn!==undefined&&clip.trimOut!==undefined){
    clip.trimOut=round2((clip.trimIn||0)+clip.duration*(clip.speed||1));
    if(clip.baseDur!==undefined&&src!==null)clip.baseDur=src;
  }
  return{applied:clip.duration,clamped};
}
/* Split one clip at a timeline offset (seconds from the clip start).
   Speed-aware: the source offset is offset*speed. Returns the new second
   clip, or null when the offset is too close to an edge. Works for video
   clips (trimIn/trimOut) and for audio/text clips (start/duration only). */
function splitClipAt(clip,off){
  if(!clip||off<0.2||off>clip.duration-0.2)return null;
  const sp=clip.speed||1;
  off=round2(off);
  const second={...clip,id:uid(),start:round2(clip.start+off),duration:round2(clip.duration-off),name:(clip.name||clip.text||"Clip")+" (2)"};
  if(clip.trimIn!==undefined){second.trimIn=round2((clip.trimIn||0)+off*sp);second.trimOut=clip.trimOut;}
  if(clip.text!==undefined)second.text=clip.text;
  clip.duration=round2(off);
  if(clip.trimOut!==undefined)clip.trimOut=round2((clip.trimIn||0)+off*sp);
  const list=clip.text!==undefined?S.textClips:(clip.mediaId&&S.audioClips.includes(clip)?S.audioClips:S.clips);
  const idx=list.indexOf(clip);if(idx>=0)list.splice(idx+1,0,second);
  return second;
}
/* Insert a clip on one track at time t, pushing later clips right.
   A clip straddling t is split at t first, so nothing is overwritten and
   no two clips on the track overlap. `all` is the shared clip array
   (S.clips or S.audioClips); only clips on `track` move. */
function insertClipOnTrack(all,track,t,clip,defTrack){
  const onTrack=c=>(c.track||defTrack)===track;
  const straddle=all.find(c=>onTrack(c)&&t>c.start+0.05&&t<c.start+c.duration-0.05);
  if(straddle)splitClipAt(straddle,t-straddle.start);
  all.filter(c=>onTrack(c)&&c.start>=t-0.05).forEach(c=>{c.start=round2(c.start+clip.duration);});
  clip.start=round2(t);clip.track=track;all.push(clip);all.sort((a,b)=>a.start-b.start);
  updateDuration();renderTimeline();pushHistory();
}
/* Import one file and wait until its duration is known (video/audio) so a
   caller can use the media record immediately — the old replace flow used
   addFiles() + a fixed 900 ms timeout, which raced metadata loading. */
function importSingleFile(file){
  return new Promise(res=>{
    const type=mediaType(file),url=URL.createObjectURL(file);
    const m={id:uid(),name:file.name,type,url,file,fav:false,duration:0,addedAt:Date.now(),folderId:null};
    S.media.push(m);renderMediaList();
    if(type==="video"){const v=document.createElement("video");v.preload="metadata";v.src=url;
      const done=()=>{m.duration=round2(v.duration||0);renderMediaList();updateDuration();res(m);};
      v.onloadedmetadata=done;v.onerror=()=>res(m);setTimeout(()=>res(m),3000);}
    else if(type==="audio"){const a=new Audio(url);a.onloadedmetadata=()=>{m.duration=round2(a.duration||0);renderMediaList();res(m);};a.onerror=()=>res(m);m.audioEl=a;setTimeout(()=>res(m),3000);}
    else{m.duration=0;res(m);}
    pushHistory();
  });
}
/* Replace a selected clip with a different media item, keeping its
   position and duration: the replacement is trimmed to fit (trimIn=0,
   trimOut = duration*speed, or less when the source is shorter — then
   the clip shortens to the source length and the caller is told). */
function replaceClipWithMedia(clip,m){
  if(!clip||!m)return"Nothing to replace";
  if(m.id===clip.mediaId)return"That is already this clip's media — pick a different file";
  if(m.type!=="video"&&m.type!=="image")return"Replace needs a video or image file";
  const oldDur=clip.duration,sp=clip.speed||1;
  clip.mediaId=m.id;clip.name=m.name;clip.trimIn=0;clip.reverse=false;
  if(m.type==="image"){
    clip.trimOut=oldDur;clip.baseDur=oldDur;
    loadPreview(m);updateDuration();renderTimeline();pushHistory();
    return"Clip replaced with "+m.name+" — position and duration kept";
  }
  const src=m.duration||0;
  if(!src){ // duration not known yet (metadata still loading) — keep duration, trim when known
    clip.trimOut=round2(oldDur*sp);clip.baseDur=round2(oldDur*sp);
    loadPreview(m);updateDuration();renderTimeline();pushHistory();
    return"Clip replaced with "+m.name+" — position and duration kept";
  }
  clip.baseDur=src;
  if(src>=oldDur*sp){clip.trimOut=round2(oldDur*sp);}
  else{clip.duration=round2(Math.max(0.1,src/sp));clip.trimOut=src;}
  loadPreview(m);updateDuration();renderTimeline();pushHistory();
  return clip.duration<oldDur
    ?"Clip replaced with "+m.name+" — the replacement is shorter than the old clip, so the clip is now "+clip.duration.toFixed(1)+"s"
    :"Clip replaced with "+m.name+" — position and duration kept";
}
/* Populate the Insert / Replace media pickers from the library. */
function refreshEditMediaSelects(){
  const ins=$("insertMediaSel"),rep=$("replaceMediaSel");
  const fill=(sel,items,placeholder)=>{
    if(!sel)return;const cur=sel.value;
    sel.innerHTML=`<option value="">${placeholder}</option>`+items.map(m=>`<option value="${m.id}">${m.name}</option>`).join("");
    if(cur&&items.some(m=>m.id===cur))sel.value=cur;
  };
  fill(ins,S.media,"— Insert: pick media —");
  fill(rep,S.media.filter(m=>m.type==="video"||m.type==="image"),"— Replace with: pick media —");
}
/* Insert the picked media at the playhead (no overwrite). */
function insertMediaAtPlayhead(m){
  if(!m)return"Pick a media file first";
  if(m.type==="audio"){
    const dur=m.duration||10;
    const clip={id:uid(),mediaId:m.id,name:m.name,track:"a1",start:S.curTime,duration:dur,vol:S.audVol};
    insertClipOnTrack(S.audioClips,"a1",S.curTime,clip,"a1");
    renderTimeline();
    return"Inserted "+m.name+" at the playhead on A1 ("+dur.toFixed(1)+"s) — later audio shifted right";
  }
  const dur=m.type==="video"?(m.duration||5):5;
  const clip={id:uid(),mediaId:m.id,name:m.name,track:"v1",start:S.curTime,duration:dur,trimIn:0,trimOut:m.type==="video"?(m.duration||dur):dur,opacity:100,scale:100,rotation:0,transition:"none",transDur:0.5,speed:1,baseDur:m.type==="video"?(m.duration||dur):dur,reverse:false};
  insertClipOnTrack(S.clips,"v1",S.curTime,clip,"v1");
  if(m.type==="video"||m.type==="image")loadPreview(m);
  renderTimeline();
  return"Inserted "+m.name+" at the playhead on V1 ("+dur.toFixed(1)+"s) — later clips shifted right, nothing overwritten";
}
function togglePlay(){
  if(S.reverse){reversePlay();return;}
  if(S.playing){S.playing=false;video.pause();setPlayBtn("play");return;}
  S.playing=true;
  const hit=activeVideoAt(S.curTime);
  if(hit){const m=S.media.find(x=>x.id===hit.clip.mediaId);if(m&&m.type==="video")video.play().catch(()=>toast("Press play on the video — browser blocked autoplay"));}
  setPlayBtn("pause");
}
function reversePlay(){
  S.playing=false;
  if(reverseTimer){clearInterval(reverseTimer);reverseTimer=null;setPlayBtn("play");return;}
  video.pause();setPlayBtn("reversing");
  reverseTimer=setInterval(()=>{seek(S.curTime-0.1);if(S.curTime<=0){clearInterval(reverseTimer);reverseTimer=null;setPlayBtn("play");}},100);
}
video.addEventListener("ended",()=>{S.playing=false;setPlayBtn("play");});
setInterval(()=>{ // sync clock while playing — video clips follow the video clock, image/still clips advance by wall time
  if(!S.playing)return;
  const hit=activeVideoAt(S.curTime);
  if(hit&&curMedia&&curMedia.type==="video"&&!video.paused){
    S.curTime=round2(clamp(hit.clip.start+Math.max(0,offsetForSourceTime(hit.clip,video.currentTime-hit.clip.trimIn)),0,totalDuration()));
  }
  else S.curTime=round2(clamp(S.curTime+0.1,0,totalDuration()));
  // keep the preview video element in step with the timeline when a video clip is active
  if(hit){const m=S.media.find(x=>x.id===hit.clip.mediaId);if(m&&m.type==="video"&&video.paused)video.play().catch(()=>{});}
  applyTransitionPreview(hit);
  updateTimeUI();renderTextOverlay();positionPlayhead();
  if(typeof renderSplitPreview==="function")renderSplitPreview();
  if(typeof renderChromaPreview==="function")renderChromaPreview();
  if(S.curTime>=totalDuration()-0.05){S.playing=false;video.pause();setPlayBtn("play");}
},100);
/* Phase 2: one frame at the PROJECT frame rate (S.fps), not a hardcoded 30. */
function frameStep(d){S.playing=false;video.pause();setPlayBtn("play");seek(S.curTime+d/(S.fps||30));}

/* ---------- TEXT OVERLAY / CAPTIONS ---------- */
function activeTextAt(t){return S.textClips.filter(c=>t>=c.start&&t<c.start+c.duration);}
function activeCaptionAt(t,trackId){return S.captions.find(c=>(c.trackId||"main")===(trackId||"main")&&t>=c.start&&t<=c.end);}
function renderTextOverlay(){
  const box=$("textOverlay");box.innerHTML="";
  const t=S.curTime;
  /* Phase 6 — shape clips (kind:"shape"): coloured overlays on the timeline */
  activeTextAt(t).forEach(c=>{
    if(!c.shape)return;
    const el=document.createElement("div");
    const sz=Math.round((c.size||80)*0.7);
    el.style.cssText=`position:absolute;left:50%;top:${c.pos==="top"?"8%":c.pos==="center"?"42%":"72%"};transform:translateX(-50%);width:${sz}px;height:${sz}px;background:${c.color||"#22d3ee"};opacity:${(c.opacity??100)/100};pointer-events:none;`;
    if(c.shape==="circle")el.style.borderRadius="50%";
    else if(c.shape==="triangle")el.style.clipPath="polygon(50% 0,100% 100%,0 100%)";
    else if(c.shape==="diamond")el.style.clipPath="polygon(50% 0,100% 50%,50% 100%,0 50%)";
    box.appendChild(el);
  });
  activeTextAt(t).forEach(c=>{
    if(c.shape)return;
    const el=document.createElement("div");el.className="ov-text";
    const local=t-c.start, dur=c.duration||3;
    const st=textAnimState(c,local,dur);
    el.textContent=st.text;el.style.fontFamily=c.font;
    el.style.fontWeight=c.weight||700;
    el.style.fontSize=(c.size*0.7)+"px";el.style.color=c.color;
    el.style.letterSpacing=((c.spacing||0)*0.7)+"px";
    el.style.lineHeight=((c.lineHeight||120)/100).toFixed(2);
    el.style.textAlign=c.align||"center";
    el.style.top=c.pos==="top"?"8%":c.pos==="center"?"42%":"78%";
    el.style.opacity=(st.opacity*((c.opacity??100)/100)).toFixed(3);
    el.style.transform=`translateX(-50%) translate(${st.tx}px,${st.ty}px) rotate(${st.rot}deg) scale(${st.scale})`;
    if(c.grad){el.style.background="linear-gradient(90deg,"+c.color+","+ (c.grad2||"#22d3ee") +")";el.style.webkitBackgroundClip="text";el.style.backgroundClip="text";el.style.color="transparent";el.style.webkitTextFillColor="transparent";}
    else if(c.bgOn)el.style.background=c.bg;
    if(c.outline)el.style.webkitTextStroke="1px #000";
    if(c.shadow)el.style.textShadow="3px 3px 6px #000";
    if(st.mask!=null)el.style.clipPath=`inset(0 0 ${(1-st.mask)*100}% 0)`;
    if(st.wave){
      el.textContent="";
      [...st.text].forEach((ch,i)=>{
        const sp=document.createElement("span");
        sp.textContent=ch;sp.style.display="inline-block";
        sp.style.transform=`translateY(${Math.sin(local*6+i*0.6)*6}px)`;
        el.appendChild(sp);
      });
    }
    box.appendChild(el);
  });
  // captions: both tracks render (Main bottom, Secondary above it)
  const capMain=S.captions.find(c=>(c.trackId||"main")==="main"&&t>=c.start&&t<=c.end);
  const capSec=S.captions.find(c=>(c.trackId||"main")==="secondary"&&t>=c.start&&t<=c.end);
  [[capMain,"86%"],[capSec,"76%"]].forEach(([cap,top])=>{
    if(!cap)return;
    const el=document.createElement("div");el.className="ov-text";
    const cs=S.capStyle||{};
    el.style.top=top;el.style.background=cs.bgOn?(cs.bg||"#000000"):"transparent";el.style.fontSize=(cs.size||22)+"px";
    el.style.fontFamily=cs.font||"Arial";el.style.color=cap.trackId==="secondary"?"#fde047":(cs.color||"#ffffff");
    if(cs.outline)el.style.webkitTextStroke="1px #000";
    if(cs.anim==="fade")el.style.animation="fadeIn .6s ease";
    if(cs.anim==="slide")el.style.animation="slideUp .6s ease";
    if(cs.anim==="pop")el.style.animation="popIn .4s ease";
    if(S.karaoke){
      const words=cap.words&&cap.words.length?cap.words:null;
      if(words){
        el.innerHTML=words.map(w=>(t>=w.start&&t<=w.end)?`<span style="color:#fde047">${w.w}</span>`:w.w).join(" ");
      }else{
        const ws=cap.text.split(" ");const frac=(t-cap.start)/Math.max(.1,cap.end-cap.start);const n=Math.floor(frac*ws.length);
        el.innerHTML=ws.map((w,i)=>i<n?`<span style="color:#fde047">${w}</span>`:w).join(" ");
      }
    }
    else el.textContent=cap.text;
    box.appendChild(el);
  });
}
function renderCapList(){
  const box=$("capList");box.innerHTML="";
  syncCapTrackUI();
  const sel=S.capTrackSel||"main";
  const list=S.captions.filter(c=>(c.trackId||"main")===sel);
  if(!list.length)box.innerHTML='<p class="hint">No captions on this track yet — add one, or import SRT/VTT.</p>';
  list.forEach(c=>{
    const r=document.createElement("div");r.className="cap-row";
    r.innerHTML=`<input type="number" step="0.1" value="${c.start}" title="start s" style="width:56px"><input type="number" step="0.1" value="${c.end}" title="end s" style="width:56px"><input value="${c.text.replace(/"/g,"&quot;")}" style="flex:1"><button class="mini" title="Split caption">${epIcon("scissors")}</button><button class="mini" title="Merge with next">${epIcon("link")}</button><button class="mini" title="Word timings">${epIcon("layout-grid")} Words</button><button class="mini" title="Delete caption">${epIcon("trash")}</button>`;
    const [s,e,txt,sp,mg,wd,del]=r.querySelectorAll("input,button");
    s.onchange=()=>{c.start=round2(+s.value);pushHistory();};
    e.onchange=()=>{c.end=+e.value;pushHistory();};
    txt.onchange=()=>{c.text=txt.value;pushHistory();};
    sp.onclick=()=>{splitCaption(c);};
    mg.onclick=()=>{mergeCaption(c);};
    wd.onclick=()=>{toggleWordEditor(c,r);};
    del.onclick=()=>{S.captions=S.captions.filter(x=>x.id!==c.id);renderCapList();renderTimeline();pushHistory();};
    box.appendChild(r);
    if(c._showWords)toggleWordEditor(c,r,true);
  });
}
function syncCapTrackUI(){
  const sel=$("capTrackSel");if(!sel)return;
  const cur=sel.value||S.capTrackSel||"main";
  sel.innerHTML=(S.capTracks||[]).map(t=>`<option value="${t.id}"${t.id===cur?" selected":""}>${t.name}</option>`).join("");
  if(!sel.value)sel.value="main";
  S.capTrackSel=sel.value;
}
function splitCaption(c){
  const words=c.text.split(" ").filter(Boolean);
  if(words.length<2){toast("A caption needs at least 2 words to split");return;}
  const mid=Math.ceil(words.length/2), midT=(c.start+c.end)/2;
  const second={id:uid(),text:words.slice(mid).join(" "),start:midT,end:c.end,trackId:c.trackId||"main"};
  c.text=words.slice(0,mid).join(" ");c.end=midT;
  if(c.words){c.words=c.words.filter(w=>w.start<midT);}
  const idx=S.captions.indexOf(c);S.captions.splice(idx+1,0,second);
  renderCapList();pushHistory();toast("Caption split in two");
}
function mergeCaption(c){
  const track=(c.trackId||"main");
  const same=S.captions.filter(x=>(x.trackId||"main")===track).sort((a,b)=>a.start-b.start);
  const i=same.indexOf(c);const next=same[i+1];
  if(!next){toast("No later caption on this track to merge with");return;}
  c.text=c.text+" "+next.text;c.end=next.end;
  if(c.words&&next.words)c.words=c.words.concat(next.words);
  S.captions=S.captions.filter(x=>x.id!==next.id);
  renderCapList();pushHistory();toast("Captions merged");
}
function autoSplitWords(c){
  const words=c.text.split(" ").filter(Boolean);
  if(!words.length)return;
  const span=(c.end-c.start)/words.length;
  c.words=words.map((w,i)=>({w,start:+(c.start+i*span).toFixed(2),end:+(c.start+(i+1)*span).toFixed(2)}));
}
function toggleWordEditor(c,row,already){
  let ed=row.nextElementSibling;
  if(ed&&ed.classList&&ed.classList.contains("word-ed")){ed.remove();c._showWords=false;return;}
  c._showWords=true;
  if(!c.words)autoSplitWords(c);
  const div=document.createElement("div");div.className="word-ed";
  div.style.cssText="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px;margin:4px 0";
  div.innerHTML=`<div style="font-size:11px;color:var(--mut)">Per-word timings — karaoke highlights the word whose time contains the playhead. Times are editable.</div>`;
  const list=document.createElement("div");div.appendChild(list);
  const renderWords=()=>{
    list.innerHTML="";
    (c.words||[]).forEach(wd=>{
      const r=document.createElement("div");r.className="cap-row";
      r.innerHTML=`<input value="${wd.w.replace(/"/g,"&quot;")}" style="flex:1"><input type="number" step="0.05" value="${wd.start}" style="width:64px" title="word start s"><input type="number" step="0.05" value="${wd.end}" style="width:64px" title="word end s">`;
      const [tw,ws,we]=r.querySelectorAll("input");
      tw.onchange=()=>{wd.w=tw.value;pushHistory();};
      ws.onchange=()=>{wd.start=round2(+ws.value);pushHistory();};
      we.onchange=()=>{wd.end=+we.value;pushHistory();};
      list.appendChild(r);
    });
  };
  renderWords();
  const b=document.createElement("button");b.className="mini";b.innerHTML=epIcon("refresh-cw")+" Re-split words evenly across the caption";
  b.onclick=()=>{autoSplitWords(c);renderWords();pushHistory();toast("Word timings re-split evenly");};
  div.appendChild(b);
  row.after(div);
}
function toASS(trackId){
  const sel=trackId||S.capTrackSel||"main";
  const caps=S.captions.filter(c=>(c.trackId||"main")===sel).sort((a,b)=>a.start-b.start);
  const cs=S.capStyle||{};
  const assT=t=>{const h=Math.floor(t/3600),m=Math.floor(t%3600/60),ss=Math.floor(t%60),c2=Math.floor((t%1)*100);return h+":"+String(m).padStart(2,"0")+":"+String(ss).padStart(2,"0")+"."+String(c2).padStart(2,"0");};
  const hex=c=>{const m=(c||"#ffffff").replace("#","");return m.length===6?"&H00"+m.slice(4)+m.slice(2,4)+m.slice(0,2):"&H00FFFFFF";};
  const styleName=((S.capTracks.find(t=>t.id===sel)||{name:sel}).name||"Default").replace(/[^\w]+/g,"_")||"Default";
  const NL="\n";
  let out="[Script Info]"+NL+"Title: Editora Pro captions ("+sel+")"+NL+"ScriptType: v4.00+"+NL+"PlayResX: 1280"+NL+"PlayResY: 720"+NL+NL;
  out+="[V4+ Styles]"+NL+"Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"+NL;
  out+="Style: "+styleName+","+(cs.font||"Arial")+","+(cs.size||22)+","+hex(cs.color)+",&H000000FF,&H00000000,"+(cs.bgOn?hex(cs.bg):"&H00000000")+",-1,0,0,0,100,100,0,0,1,"+(cs.outline?2:0)+",0,2,10,10,40,1"+NL+NL+"[Events]"+NL+"Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"+NL;
  caps.forEach(c=>{
    let text=c.text;
    if(c.words&&c.words.length){
      text=c.words.map(w=>{
        const dur=Math.max(1,Math.round((w.end-w.start)*100));
        return "{\\k"+dur+"}"+w.w;
      }).join(" ");
    }
    out+="Dialogue: 0,"+assT(c.start)+","+assT(c.end)+","+styleName+",,0,0,0,,"+text.replace(/\n/g,"\\N")+NL;
  });
  return out;
}
function parseSRT(txt){
  const out=[];
  const toSec=s=>{s=s.trim().replace(".",",");const p=s.split(/[:,]/);if(p.length<4)return NaN;return (+p[0])*3600+(+p[1])*60+(+p[2])+(+p[3])/1000;};
  const blocks=txt.replace(/^\uFEFF/,"").replace(/^WEBVTT.*$/m,"").trim().split(/\n\s*\n/);
  blocks.forEach(b=>{
    const lines=b.split("\n").map(x=>x.trim()).filter(Boolean);if(lines.length<2)return;
    const tm=lines.find(l=>l.includes("-->"));if(!tm)return;
    const [a,bb]=tm.split("-->");
    const s=toSec(a),e=toSec(bb);
    if(isNaN(s)||isNaN(e))return;
    const text=lines.slice(lines.indexOf(tm)+1).join(" ").replace(/<[^>]+>/g,"");
    if(text)out.push({id:uid(),text,start:s,end:e,trackId:S.capTrackSel||"main"});
  });
  return out;
}
function syncCapStyleUI(){
  const cs=S.capStyle||{};const set=(id,v)=>{const el=$(id);if(el)el.value=v;};
  set("capFont",cs.font||"Arial");set("capSize",cs.size||22);set("capColor",cs.color||"#ffffff");set("capBg",cs.bg||"#000000");
  const sv=$("capSizeV");if(sv)sv.textContent=(cs.size||22)+"px";
  const bg=$("capBgOn");if(bg)bg.checked=!!cs.bgOn;
  const ol=$("capOutline");if(ol)ol.checked=!!cs.outline;
  set("capAnim",cs.anim||"none");
}
function _capTrackCaps(){const sel=S.capTrackSel||"main";return S.captions.filter(c=>(c.trackId||"main")===sel).sort((a,b)=>a.start-b.start);}
function toSRT(){return _capTrackCaps().map((c,i)=>`${i+1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}`).join("\n\n");}
function srtTime(t){const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=Math.floor(t%60),ms=Math.floor(t%1*1000);return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms).padStart(3,"0")}`;}
function toVTT(){return "WEBVTT\n\n"+_capTrackCaps().map(c=>`${srtTime(c.start).replace(",",".")} --> ${srtTime(c.end).replace(",",".")}\n${c.text}`).join("\n\n");}
function toASSExport(){return toASS(S.capTrackSel);}
function downloadText(name,content,mime="text/plain"){const b=new Blob([content],{type:mime});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);}

/* ---------- TIMELINE ---------- */
/* JOB 0 (2026-11-12): timestamp of the last clip pointerup. After pointerup
   the timeline is re-rendered, so the click that follows a clip tap lands
   on the track (nearest common ancestor), not on a clip — without this
   guard the tlScroll click handler below would seek the playhead on every
   clip tap. */
let _clipTapAt=0;
const PX_PER_SEC=()=>S.zoom; // px per second
function renderRuler(){
  const r=$("tlRuler");const tot=Math.max(10,totalDuration());r.style.width=(tot*PX_PER_SEC()+40)+"px";r.innerHTML="";
  const step=tot>120?10:tot>30?5:1;
  for(let t=0;t<=tot;t+=step){const s=document.createElement("span");s.style.left=(t*PX_PER_SEC())+"px";s.textContent=fmt(t);r.appendChild(s);}
  renderMarkers();
}
/* Phase 4+5 — real per-clip waveforms on audio clips: peaks are decoded
   once per media file (OfflineAudioContext) and cached on the media record. */
async function ensureAudioPeaks(m){
  if(!m||m.type!=="audio"||m.peaks||m._peaksBusy)return;
  m._peaksBusy=true;
  try{
    const buf=await (m.file?m.file.arrayBuffer():fetch(m.url).then(r=>r.arrayBuffer()));
    const actx=new OfflineAudioContext(1,44100,44100);
    const audio=await actx.decodeAudioData(buf);
    const ch=audio.getChannelData(0),n=96,peaks=[];
    const per=Math.max(1,Math.floor(ch.length/n));
    for(let i=0;i<n;i++){let mx=0;for(let j=i*per;j<Math.min(ch.length,(i+1)*per);j+=Math.max(1,Math.floor(per/16))){const v=Math.abs(ch[j]);if(v>mx)mx=v;}peaks.push(mx);}
    m.peaks=peaks;
    renderTimeline();
  }catch(e){/* a failed decode leaves the clip plain — never a fake waveform */}
  m._peaksBusy=false;
}
function drawClipWaveform(cv,m){
  if(!cv||!m)return;
  if(!m.peaks){ensureAudioPeaks(m);return;}
  const w=cv.width=cv.clientWidth||Math.max(40,(cv.parentElement?cv.parentElement.clientWidth-4:120));
  const h=cv.height=cv.clientHeight||26;
  const x=cv.getContext("2d");if(!x)return;x.clearRect(0,0,w,h);x.fillStyle="rgba(255,255,255,.85)";
  const n=m.peaks.length,bw=w/n;
  m.peaks.forEach((p,i)=>{const bh=Math.max(1,p*h);x.fillRect(i*bw,(h-bh)/2,Math.max(1,bw-1),bh);});
}
function renderTimeline(){
  renderRuler();
  const draw=(trackEl,items,type)=>{
    trackEl.innerHTML="";trackEl.style.width=Math.max(10,totalDuration())*PX_PER_SEC()+40+"px";
    trackEl.classList.toggle("locked",!!S.locked[type]);
    items.forEach((it,idx)=>{
      const d=document.createElement("div");d.className="clip "+(type==="text"?"text":type==="a1"||type==="a2"?"audio":type==="v2"?"v2":"");
      if(S.selClip===it.id)d.classList.add("sel");
      if(it.disabled)d.classList.add("disabled");
      d.style.left=(it.start*PX_PER_SEC())+"px";d.style.width=Math.max(14,it.duration*PX_PER_SEC())+"px";
      if(type==="v1"&&idx===0){const b=document.createElement("span");b.className="cover-badge";b.textContent="Cover";d.appendChild(b);}
      if(it.reverse){const b=document.createElement("span");b.className="cover-badge";b.textContent="⏪ REV";d.appendChild(b);}
      /* Phase 4+5 — clip thumbnails (real media) + audio waveforms (real peaks). */
      const _media=it.mediaId?S.media.find(x=>x.id===it.mediaId):null;
      let _waveCv=null;
      if(_media){
        const th=document.createElement("span");th.className="clip-thumb";
        if(_media.type==="image"){const im=document.createElement("img");im.src=_media.url;im.alt="";th.appendChild(im);}
        else if(_media.type==="video"){const vv=document.createElement("video");vv.src=_media.url;vv.muted=true;vv.preload="metadata";vv.setAttribute("aria-hidden","true");vv.tabIndex=-1;th.appendChild(vv);}
        else th.innerHTML='<span class="aud-ico">'+epIcon("music",16)+'</span>';
        d.appendChild(th);d.classList.add("has-thumb");
      }
      const _lb=document.createElement("span");_lb.className="clip-label";_lb.textContent=it.name||it.text||"Clip";d.appendChild(_lb);
      if(type==="a1"||type==="a2"){_waveCv=document.createElement("canvas");_waveCv.className="clip-wave";d.appendChild(_waveCv);}
      d.dataset.id=it.id;d.dataset.type=type;
      const hl=document.createElement("span");hl.className="handle l";const hr=document.createElement("span");hr.className="handle r";
      d.append(hl,hr);
      d.addEventListener("pointerdown",e=>startClipDrag(e,it,type,d,hl.contains(e.target)?"l":hr.contains(e.target)?"r":"move"));
      d.addEventListener("click",e=>{if(e.target.classList.contains("handle"))return;selectClip(it,type);});
      trackEl.appendChild(d);
      if(_waveCv)drawClipWaveform(_waveCv,_media);
    });
  };
  draw($("trackV1"),S.clips.filter(c=>(c.track||"v1")==="v1"),"v1");
  draw($("trackV2"),S.clips.filter(c=>c.track==="v2"),"v2");
  draw($("trackText"),S.textClips,"text");
  draw($("trackA1"),S.audioClips.filter(c=>(c.track||"a1")==="a1"),"a1");
  draw($("trackA2"),S.audioClips.filter(c=>c.track==="a2"),"a2");
  $("tlInfo").textContent=`${S.clips.length} video clip(s) · ${S.textClips.length} text · ${S.audioClips.length} audio · total ${fmt(totalDuration())}`;
  positionPlayhead();
}
function positionPlayhead(){
  const tot=Math.max(0.01,totalDuration());
  $("playhead").style.left=(S.curTime*PX_PER_SEC())+"px";
}
function selectClip(it,type){
  S.selClip=it.id;S.selType=type;
  /* ROUND 2026-11-12: the inspector shows toFixed(1) ("2.7") while the
     stored value could still be the media-pipeline float
     (2.700000047683716) — normalize the model HERE, where the inspector
     input is populated, so the field's value and the stored value are
     literally the same number (2.7), not just the same display. All
     writers round too; this is the backstop. */
  it.start=round2(it.start);it.duration=round2(it.duration);
  /* BUG 2 backstop (2026-11-12): normalize the whole time record here,
     not just start/duration — a float that reached trim/baseDur through
     any writer is killed the moment the inspector opens the clip. */
  if(it.trimIn!==undefined)it.trimIn=round2(it.trimIn);
  if(it.trimOut!==undefined)it.trimOut=round2(it.trimOut);
  if(it.baseDur!==undefined)it.baseDur=round2(it.baseDur);
  S.selKind=type==="text"?"text":(type==="a1"||type==="a2")?"audio":"video";
  const body=$("clipProps");body.hidden=false;
  $("clipName").value=it.name||it.text||"";
  $("clipStart").value=it.start.toFixed(1);
  $("clipDur").value=it.duration.toFixed(1);
  $("clipOpacity").value=it.opacity??100;$("clipOpacityV").textContent=(it.opacity??100)+"%";
  $("clipScale").value=it.scale??100;$("clipScaleV").textContent=(it.scale??100)+"%";
  $("clipRot").value=it.rotation??0;$("clipRotV").textContent=(it.rotation??0)+"°";
  // sync CapCut-style inspector (Video tab) with the selected clip
  const cs=$("clipSpeed");if(cs){const sp=it.speed||1;cs.value=Math.round(sp*100);$("clipSpeedV").textContent=sp.toFixed(2)+"×";}
  const ca=$("txtAnim");if(ca&&it.anim!==undefined)ca.value=it.anim;
  renderTimeline();renderSpeedKfList();drawBezier();
  if(it.pitch!==undefined){const ap=$("audPitch");if(ap){ap.value=it.pitch;$("audPitchV").textContent=it.pitch+" st";}}
  if(it.stereo!==undefined){const st=$("audStereo");if(st)st.value=it.stereo;}
  if(it.pan!==undefined){const pn=$("audPan");if(pn){pn.value=it.pan;$("audPanV").textContent=it.pan===0?"Center":(it.pan<0?"Left "+(-it.pan):"Right "+it.pan);}}
  if(it.speed!==undefined&&S.selKind==="audio"){const cs=$("audClipSpeed");if(cs){cs.value=Math.round(it.speed*100);$("audClipSpeedV").textContent=it.speed.toFixed(2)+"×";}}
  const mb=$("motionBlurOn");if(mb)mb.checked=!!S.motionBlur;
  if(typeof syncFxButtons==="function")syncFxButtons();
  if(typeof renderInspFx==="function")renderInspFx();
  if(typeof window.__syncChromaBtn==="function")window.__syncChromaBtn();
}
/* Sync the right-inspector Transform controls with global transform state */
function syncInspectorTransform(){
  const set=(id,v)=>{const el=$(id);if(el)el.value=v;};
  set("inspScale",S.cropZoom);const sv=$("inspScaleV");if(sv)sv.textContent=S.cropZoom+"%";
  set("inspScaleX",S.scaleX||100);set("inspScaleY",S.scaleY||100);
  set("inspPosX",S.posX||0);set("inspPosY",S.posY||0);
  set("inspRot",S.rotation);const rv=$("inspRotV");if(rv)rv.textContent=S.rotation+"°";
}
/* JOB 0 (2026-11-12) — why clips could never be selected, and the fix.
   Root cause, two independent kills (live desktop-Chrome test 07:10 IST):
   (1) this handler called e.preventDefault() on pointerdown. Cancelling
   pointerdown suppresses the compatibility mouse events in Chrome, so the
   clip's "click" listener (which calls selectClip) NEVER fired — for mouse
   and touch alike. (2) Even if it had fired, the pointerup handler called
   renderTimeline(), which does trackEl.innerHTML="" and re-creates every
   clip node — the node under the pointer was destroyed before the click
   could dispatch to it; the pointermove handler did the same mid-drag.
   Fix: no preventDefault/stopPropagation on pointerdown (CSS
   touch-action:none + user-select:none on .clip handles scrolling and
   selection instead); a drag only starts after >4 px of movement; while
   dragging, only the dragged node's style is updated in place (never a
   full re-render, so the pointer target survives); on pointerup a tap
   selects the clip directly and a drag selects it after the move — the
   click listener stays only as a fallback. Works by mouse click and by
   touch tap; a locked track still blocks dragging but no longer blocks
   selection. */
function startClipDrag(e,it,type,el,mode){
  if(S.locked[type]){toast("Track is locked");return;}
  const startX=e.clientX,startY=e.clientY,origStart=it.start,origDur=it.duration;
  let dropTrack=type,dragging=false;
  try{el.setPointerCapture(e.pointerId);}catch(_){}
  const move=ev=>{
    const dx=ev.clientX-startX,dy=ev.clientY-startY;
    if(!dragging){
      if(Math.abs(dx)<4&&Math.abs(dy)<4)return; /* tap, not a drag — selection happens on pointerup */
      dragging=true;
    }
    const dt=dx/PX_PER_SEC();
    if(mode==="move"){
      let ns=Math.max(0,origStart+dt);
      if(S.snap){const ph=S.curTime;if(Math.abs(ns-ph)<0.3)ns=ph;if(Math.abs(ns+it.duration-ph)<0.3)ns=ph-it.duration;}
      it.start=round2(ns); /* BUG 2: was Math.round(ns*10)/10 (1 decimal, unrounded start) */
      // drag between tracks: which track row is under the pointer?
      const under=document.elementFromPoint(ev.clientX,ev.clientY);
      const trEl=under&&under.closest?under.closest(".track"):null;
      if(trEl&&trEl.dataset.track){
        const cand=trEl.dataset.track;
        const ok=(type==="v1"||type==="v2")?(cand==="v1"||cand==="v2"):(type==="a1"||type==="a2")?(cand==="a1"||cand==="a2"):cand===type;
        if(ok)dropTrack=cand;
      }
    }
    else if(mode==="l"){const ns=round2(clamp(origStart+dt,0,origStart+origDur-0.2));const srcOff=round2(ns-origStart);it.duration=round2(origDur-srcOff);it.start=ns;if(it.trimIn!==undefined)it.trimIn=round2(clamp(it.trimIn+srcOff*(it.speed||1),0,it.trimOut));}
    else{it.duration=round2(Math.max(0.2,origDur+dt));if(it.trimOut!==undefined){const src=sourceDuration(it);const maxTrim=src!==null?src:999;it.trimOut=round2(Math.min(it.trimOut+dt*(it.speed||1),maxTrim));it.duration=round2(Math.min(it.duration,(it.trimOut-(it.trimIn||0))/(it.speed||1)));}}
    /* in-place live update only — never renderTimeline() mid-gesture, or
       the node under the pointer is destroyed and the gesture dies */
    el.style.left=(it.start*PX_PER_SEC())+"px";
    el.style.width=Math.max(14,it.duration*PX_PER_SEC())+"px";
    positionPlayhead();
  };
  const up=()=>{
    document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);document.removeEventListener("pointercancel",up);
    if(mode==="move"&&dropTrack!==type){
      it.track=dropTrack;S.selType=dropTrack;
      if((dropTrack==="v1"||dropTrack==="v2")&&it.baseDur===undefined)it.baseDur=it.duration;
      toast("Clip moved to track "+dropTrack.toUpperCase());
    }
    if(dragging){pushHistory();updateDuration();}
    _clipTapAt=Date.now(); /* JOB 0: swallow the click that follows this pointerup (see _clipTapAt) */
    renderTimeline();
    /* selection on pointerup — never depends on the click event, which the
       old preventDefault() suppressed and the old re-render destroyed */
    selectClip(it,it.track||type);
  };
  document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);document.addEventListener("pointercancel",up);
}
$("tlScroll").addEventListener("click",e=>{
  if(e.target.closest(".clip"))return;
  if(Date.now()-_clipTapAt<750)return; /* JOB 0: click that followed a clip tap — do not seek */
  const r=$("tlScroll").getBoundingClientRect();
  const x=e.clientX-r.left+$("tlScroll").scrollLeft;
  seek(x/PX_PER_SEC());
});
/* FIX 2026-11-12 — ruler scrub: pointerdown on the ruler seeks immediately
   and drags the playhead while held (standard NLE behaviour). A plain click
   on the ruler must move the playhead even when the click event itself is
   swallowed — the ruler's time labels are rebuilt on every renderTimeline,
   which can eat the click. The tlScroll click handler above still covers
   clicks on the track area. */
$("tlRuler").addEventListener("pointerdown",e=>{
  const seekFromEvent=ev=>{const r=$("tlScroll").getBoundingClientRect();const x=ev.clientX-r.left+$("tlScroll").scrollLeft;seek(x/PX_PER_SEC());};
  seekFromEvent(e);
  const ruler=$("tlRuler");
  try{ruler.setPointerCapture(e.pointerId);}catch(err){}
  const mv=ev=>seekFromEvent(ev);
  const up=()=>{ruler.removeEventListener("pointermove",mv);ruler.removeEventListener("pointerup",up);ruler.removeEventListener("pointercancel",up);};
  ruler.addEventListener("pointermove",mv);
  ruler.addEventListener("pointerup",up);
  ruler.addEventListener("pointercancel",up);
  e.preventDefault();
});
function splitAtPlayhead(){
  const hit=currentClipAt(S.curTime);
  if(!hit){toast("No clip under the playhead");return;}
  const c=hit.clip,off=round2(hit.offset); /* BUG 2 (2026-11-12): round the
     playhead offset HERE, where it is created — it is the variable that
     carries the playhead into splitClipAt, so any media-pipeline float
     (2.700000047683716) is killed before it can become a duration. */
  if(off<0.2||off>c.duration-0.2){toast("Move the playhead inside a clip to split");return;}
  if(!splitClipAt(c,off)){toast("Move the playhead inside a clip to split");return;}
  updateDuration();renderTimeline();pushHistory();
  /* FIX 2026-11-12: refresh the inspector right after the split — the
     Duration field showed the old value until the clip was re-clicked. */
  if(S.selClip===c.id)selectClip(c,c.track||"v1");
  toast("Clip split");
}
/* Cut: split the selected clip at the playhead and delete the part after it */
function cutSelected(){
  const c=S.selKind==="video"?S.clips.find(x=>x.id===S.selClip):null;
  if(!c){toast("Select a video clip first");return;}
  if(S.curTime<=c.start+0.2||S.curTime>=c.start+c.duration-0.2){toast("Move the playhead inside the selected clip to cut");return;}
  const off=round2(S.curTime-c.start);
  c.duration=off;c.trimOut=round2((c.trimIn||0)+off*(c.speed||1));
  updateDuration();renderTimeline();pushHistory();
  /* FIX 2026-11-12: refresh the inspector (same staleness as after Split). */
  if(S.selClip===c.id)selectClip(c,c.track||"v1");
  toast("Cut — the part after the playhead was removed");
}
/* Merge: join the selected clip with the next adjacent clip on the same track (same source media) */
function mergeSelected(){
  const c=S.selKind==="video"?S.clips.find(x=>x.id===S.selClip):null;
  if(!c){toast("Select a video clip first");return;}
  const track=c.track||"v1";
  const next=S.clips.filter(x=>(x.track||"v1")===track&&x.id!==c.id&&x.start>=c.start+c.duration-0.05)
    .sort((a,b)=>a.start-b.start)[0];
  if(!next){toast("No adjacent clip after this one on track "+track.toUpperCase());return;}
  if(next.mediaId!==c.mediaId){toast("Merge needs two adjacent clips from the same source file — these are different media");return;}
  if((next.speed||1)!==(c.speed||1)){toast("Merge needs both clips at the same speed — reset the clip speed first");return;}
  if(Math.abs(next.start-(c.start+c.duration))>0.05){toast("Clips are not adjacent — move them together first");return;}
  c.duration=round2(c.duration+next.duration);c.trimOut=next.trimOut;c.name=c.name.replace(/ \(2\)$/,"");
  S.clips=S.clips.filter(x=>x.id!==next.id);
  updateDuration();renderTimeline();pushHistory();
  /* FIX 2026-11-12: refresh the inspector (same staleness as after Split). */
  if(S.selClip===c.id)selectClip(c,c.track||"v1");
  toast("Clips merged");
}
/* Insert a clip on V1 at time t, shifting later V1 clips right (Phase 2:
   now splits a straddling clip first, so nothing is overwritten). */
function insertClipAtV1(t,clip){
  insertClipOnTrack(S.clips,"v1",t,clip,"v1");
}
/* Phase 2 — Ripple delete: deleting a clip closes the gap. Later clips on
   the SAME track shift left by the deleted clip's duration (preserving any
   gap that was already there); with "Ripple: All tracks" on, later clips
   on EVERY track shift left instead. Plain Delete, the Ripple Delete
   button, the Del key and the context-menu Delete all use this. */
function deleteSelected(){
  if(!S.selClip){toast("Select a clip first");return;}
  if(S.settings.confirmDelete&&!confirm("Delete the selected clip?"))return;
  const kind=S.selKind;
  const list=kind==="video"?S.clips:kind==="text"?S.textClips:S.audioClips;
  const it=list.find(c=>c.id===S.selClip);
  if(!it){S.selClip=null;return;}
  const delStart=it.start,delEnd=it.start+it.duration,delDur=it.duration;
  const delTrack=kind==="video"?(it.track||"v1"):kind==="audio"?(it.track||"a1"):"text";
  if(kind==="video")S.clips=S.clips.filter(c=>c.id!==S.selClip);
  if(kind==="text")S.textClips=S.textClips.filter(c=>c.id!==S.selClip);
  if(kind==="audio")S.audioClips=S.audioClips.filter(c=>c.id!==S.selClip);
  const shiftList=(arr,trackKey,defTrack)=>{
    arr.forEach(c=>{
      const tk=trackKey?((c.track||defTrack)===trackKey):true;
      if(tk&&c.start>=delEnd-0.05)c.start=round2(Math.max(delStart,c.start-delDur));
    });
  };
  if(S.rippleAll){
    shiftList(S.clips,null,"v1");shiftList(S.textClips,null,"text");shiftList(S.audioClips,null,"a1");
  }else if(kind==="video")shiftList(S.clips,delTrack,"v1");
  else if(kind==="audio")shiftList(S.audioClips,delTrack,"a1");
  else shiftList(S.textClips,null,"text");
  S.selClip=null;$("clipProps").hidden=true;updateDuration();renderTimeline();pushHistory();
  toast("Clip deleted — gap closed"+(S.rippleAll?" (all tracks)":" (same track)"));
}
/* Phase 2 fix: the old duplicate dropped the copy at it.start+it.duration
   with no shift, so it OVERLAPPED the next clip on the track. Now the copy
   is inserted there (later clips on the track shift right), like Insert. */
function duplicateSelected(){
  if(!S.selClip){toast("Select a clip first");return;}
  const list=S.selKind==="video"?S.clips:S.selKind==="text"?S.textClips:S.audioClips;
  const it=list.find(c=>c.id===S.selClip);if(!it)return;
  const copy={...it,id:uid(),name:(it.name||it.text||"Clip")+" copy"};
  if(it.text!==undefined)copy.text=it.text+" copy";
  const at=it.start+it.duration;
  const track=S.selKind==="video"?(it.track||"v1"):S.selKind==="audio"?(it.track||"a1"):"text";
  const def=S.selKind==="video"?"v1":S.selKind==="audio"?"a1":"text";
  insertClipOnTrack(list,track,at,copy,def);
  toast("Clip duplicated — later clips on the track shifted right");
}

/* ---------- EFFECTS / TRANSITIONS / KEYFRAMES ---------- */
const FX_DEFS=[["blur","Blur"],["glow","Glow"],["glitch","Glitch"],["vignette","Vignette"],["grain","Film grain"],["rgb","RGB split"],["vhs","VHS look"],["noir","Noir (B&W)"]];
function buildFxUI(){
  const box=$("fxList");box.innerHTML="";
  FX_DEFS.forEach(([key,label])=>{
    const b=document.createElement("button");b.className="fx-btn"+(S.fx[key]?" on":"");b.textContent=label;
    b.onclick=()=>{S.fx[key]=!S.fx[key];if(key==="noir")S.color.saturation=S.fx.noir?0:100;if(key==="vhs"){S.fx.grain=true;S.fx.glitch=true;}buildFxUI();buildColorUI();applyFilters();pushHistory();};
    box.appendChild(b);
  });
}
function renderKfList(){
  const box=$("kfList");box.innerHTML="";
  S.keyframes.sort((a,b)=>a.time-b.time).forEach(k=>{
    const r=document.createElement("div");r.className="kf-row";
    r.style.cssText=S.selKf===k.id?"outline:2px solid #fff":"";
    r.innerHTML=`<span>◆ ${k.prop} @ ${k.time.toFixed(1)}s = ${k.value}</span><select class="fld" style="width:110px;margin:0"><option value="linear">Linear</option><option value="easeIn">Ease In</option><option value="easeOut">Ease Out</option><option value="easeInOut">Ease In-Out</option><option value="bezier">Bezier</option></select><button class="mini" title="Delete keyframe">${epIcon("trash")}</button>`;
    const [sel,del]=r.querySelectorAll("select,button");
    sel.value=k.ease||"linear";
    sel.onchange=()=>{k.ease=sel.value;drawBezier();pushHistory();};
    del.onclick=e=>{e.stopPropagation();S.keyframes=S.keyframes.filter(x=>x.id!==k.id);if(S.selKf===k.id)S.selKf=null;renderKfList();renderKfLane();drawBezier();pushHistory();};
    r.onclick=e=>{if(e.target.tagName!=="BUTTON"&&e.target.tagName!=="SELECT"){S.selKf=k.id;seek(k.time);renderKfList();renderKfLane();drawBezier();}};
    box.appendChild(r);
  });
  if(!S.keyframes.length)box.innerHTML='<p class="hint">No keyframes yet.</p>';
}
function _easeKf(ease,f,bez){
  if(ease==="easeIn")return f*f;
  if(ease==="easeOut")return 1-(1-f)*(1-f);
  if(ease==="easeInOut")return f<0.5?2*f*f:1-Math.pow(-2*f+2,2)/2;
  if(ease==="bezier"&&bez){
    // cubic bezier y at parameter f (control points in [0,1]); sample x=f
    const x1=bez.x1??0.42,y1=bez.y1??0,x2=bez.x2??0.58,y2=bez.y2??1;
    const u=1-f;
    return 3*u*u*f*y1+3*u*f*f*y2+f*f*f;
  }
  return f;
}
function kfValue(prop,t){
  const ks=S.keyframes.filter(k=>k.prop===prop).sort((a,b)=>a.time-b.time);
  if(!ks.length)return null;
  if(t<=ks[0].time)return ks[0].value;
  if(t>=ks[ks.length-1].time)return ks[ks.length-1].value;
  for(let i=0;i<ks.length-1;i++){const a=ks[i],b=ks[i+1];if(t>=a.time&&t<=b.time){const f=(t-a.time)/(b.time-a.time);const e=_easeKf(a.ease||"linear",f,a.bez);return a.value+(b.value-a.value)*e;}}
  return ks[ks.length-1].value;
}
setInterval(()=>{ // apply keyframes live during preview
  if(!video.paused){
    _kf.opacity=kfValue("opacity",S.curTime);
    _kf.scale=kfValue("scale",S.curTime);
    const px=kfValue("posX",S.curTime),py=kfValue("posY",S.curTime);
    if(px!==null)S.posX=px; if(py!==null)S.posY=py;
    const rt=kfValue("rotation",S.curTime); if(rt!==null)S.rotation=rt;
    refreshVideoStyle();
  }
},120);

/* ---------- AUDIO ---------- */
let audioCtx=null, mediaRecorder=null, recChunks=[];
function ensureAudioCtx(){if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();return audioCtx;}
/* Real waveform: decode the file on-device and draw its true peaks */
async function drawWaveform(m){
  const cv=$("waveCanvas");if(!cv||!m)return;const x=cv.getContext("2d");
  x.fillStyle="#0d1330";x.fillRect(0,0,cv.width,cv.height);
  x.fillStyle="#a7b0d6";x.font="12px sans-serif";x.fillText("Decoding waveform…",10,30);
  try{
    const buf=await (m.file?m.file.arrayBuffer():fetch(m.url).then(r=>r.arrayBuffer()));
    const actx=new OfflineAudioContext(1,44100,44100);
    const audio=await actx.decodeAudioData(buf);
    const data=audio.getChannelData(0),bars=90,per=Math.floor(data.length/bars);
    x.fillStyle="#0d1330";x.fillRect(0,0,cv.width,cv.height);x.fillStyle="#22c55e";
    const bw=cv.width/bars;
    for(let i=0;i<bars;i++){
      let peak=0;for(let j=0;j<per;j+=Math.max(1,Math.floor(per/8))){const v=Math.abs(data[i*per+j]||0);if(v>peak)peak=v;}
      const h=Math.max(2,peak*cv.height);
      x.fillRect(i*bw+1,(cv.height-h)/2,bw-2,h);
    }
  }catch(err){x.fillStyle="#0d1330";x.fillRect(0,0,cv.width,cv.height);x.fillStyle="#a7b0d6";x.font="12px sans-serif";x.fillText("Waveform unavailable for this file",10,30);}
}
/* Shared Web Audio graph for the preview video: bass/treble EQ + gain.
   Created once — createMediaElementSource() may only be called once per element. */
let vidGraph=null;
function ensureVidGraph(){
  if(vidGraph)return vidGraph;
  try{
    const ctx=ensureAudioCtx();
    const src=ctx.createMediaElementSource(video);
    const bass=ctx.createBiquadFilter();bass.type="lowshelf";bass.frequency.value=200;bass.gain.value=S.bass;
    const treble=ctx.createBiquadFilter();treble.type="highshelf";treble.frequency.value=3000;treble.gain.value=S.treble;
    const gain=ctx.createGain();gain.gain.value=(S.vidVol/100);
    src.connect(bass);bass.connect(treble);treble.connect(gain);gain.connect(ctx.destination);
    vidGraph={ctx,src,bass,treble,gain,dest:null};
    return vidGraph;
  }catch(e){return null;}
}
function applyVidEQ(){
  if(!vidGraph)return;
  vidGraph.bass.gain.value=S.bass;vidGraph.treble.gain.value=S.treble;vidGraph.gain.gain.value=S.vidVol/100;
}
async function startRecording(){
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    mediaRecorder=new MediaRecorder(stream);recChunks=[];
    mediaRecorder.ondataavailable=e=>recChunks.push(e.data);
    mediaRecorder.onstop=()=>{
      const blob=new Blob(recChunks,{type:"audio/webm"});const url=URL.createObjectURL(blob);
      const m={id:uid(),name:"Voice recording "+new Date().toLocaleTimeString(),type:"audio",url,fav:false,duration:0};
      S.media.push(m);renderMediaList();addToTimeline(m);toast("Voice recording added to timeline");
      stream.getTracks().forEach(t=>t.stop());
    };
    mediaRecorder.start();$("btnRecord").disabled=true;$("btnStopRec").disabled=false;toast("Recording… tap Stop when done");
  }catch(err){toast("Microphone not available: "+err.message);}
}

/* ---------- EXPORT (Canvas + WebCodecs, no watermark) ---------- */
function exportCanvasSize(reqH){
  const map={480:[854,480],720:[1280,720],1080:[1920,1080],1440:[2560,1440],2160:[3840,2160]};
  let [w,h]=map[reqH]||map[1080];
  /* Phase 6 — custom resolution (validated W×H inputs in the Export dialog). */
  if(reqH==="custom"){
    const cw=+$("expCustomW").value||0, ch=+$("expCustomH").value||0;
    if(cw>=16&&cw<=4096&&ch>=16&&ch<=4096){w=cw;h=ch;}
    else return{w:0,h:0,note:"Custom resolution is invalid — width and height must each be 16–4096."};
  }
  const maxW=4096,maxH=4096; // honest device cap check
  const test=document.createElement("canvas");test.width=w;test.height=h;
  try{const cx=test.getContext("2d");if(!cx)throw 0;}catch(e){w=1920;h=1080;}
  if(w>maxW||h>maxH){w=1920;h=1080;}
  return{w,h,note:(reqH==="2160"||reqH==="1440")?"Requested "+reqH+"p — rendering at "+h+"p (device/browser limit).":""};
}
/* Phase 6 — one place that reads the Export dialog's settings, used by
   both export paths, the queue and the history (for re-export). */
function readExportSettings(){
  const res=$("expRes").value, fps=+$("expFps").value||30, fmt=$("expFmt").value||"mp4";
  let bitrate=+$("expBitrate").value||5000000;
  if($("expBitrate").value==="custom"){
    const mb=+$("expBitrateCustom").value||0;
    bitrate=mb>=0.5&&mb<=50?Math.round(mb*1000000):0; // 0 = invalid
  }
  const engine=$("expEngine").value||"auto";
  const codec=$("expCodec").value||"h264";
  const {w,h}=exportCanvasSize(res);
  return{res,fps,fmt,bitrate,engine,codec,w,h,
    label:`${res==="custom"?w+"×"+h:res+"p"} · ${fps} fps · ${fmt.toUpperCase()}${codec==="h265"?" · H.265":""}`};
}
function exportBitrate(){return readExportSettings().bitrate;}
function exportCodec(){return readExportSettings().codec;}
/* Phase 6 — H.265 (HEVC) support test. The option is only shown when a
   real test proves it: WebCodecs VideoEncoder for the Canvas path, and the
   vendored FFmpeg encoder list for the Video Engine path. If neither
   proves it, H.265 stays out of the UI (and out of the report as omitted). */
async function detectH265(){
  if(S.h265Checked)return S.h265;
  S.h265Checked=true;S.h265=false;
  try{
    if(typeof VideoEncoder!=="undefined"&&VideoEncoder.isConfigSupported){
      const r=await VideoEncoder.isConfigSupported({codec:"hvc1.1.6.L120.90",width:1280,height:720,bitrate:5000000,framerate:30});
      if(r&&r.supported)S.h265="canvas";
    }
  }catch(e){}
  try{
    const ff=await loadFFmpeg();
    if(ff){
      let saw=false;
      const onLog=({message})=>{if(message&&/libx265/.test(message))saw=true;};
      ff.on("log",onLog);
      try{await ff.exec(["-h","encoder=libx265"]);}catch(e){/* help exits non-zero on some builds; the log is what matters */}
      try{ff.off("log",onLog);}catch(e){}
      if(saw)S.h265="ffmpeg";
    }
  }catch(e){}
  const sel=$("expCodec");
  if(sel&&S.h265){
    if(!sel.querySelector('option[value="h265"]')){
      const o=document.createElement("option");o.value="h265";o.textContent="H.265 (HEVC)"+(S.h265==="ffmpeg"?" — Video Engine":" — Canvas (WebCodecs)");
      sel.appendChild(o);
    }
    const note=$("expCodecNote");
    if(note)note.textContent="H.265 (HEVC) is available on this device ("+(S.h265==="ffmpeg"?"Video Engine":"Canvas (WebCodecs)")+"). It makes smaller files at the same quality; H.264 stays the default for compatibility.";
  }else{
    const note=$("expCodecNote");
    if(note)note.textContent="H.265 (HEVC) was tested and is NOT available on this device/browser, so it is omitted — H.264 is used instead.";
  }
  return S.h265;
}
const _imgCache={};
function exportImgCache(m){if(!_imgCache[m.id]){const im=new Image();im.src=m.url;_imgCache[m.id]=im;}const im=_imgCache[m.id];return im.complete&&im.naturalWidth?im:null;}
/* ---------- FFMPEG.WASM EXPORT (real MP4 re-encode, true reverse) ---------- */
let FF=null;
function atempoChain(sp){
  if(!sp||sp===1)return"";
  // atempo only supports 0.5–2.0 per filter; chain for 0.25
  if(sp<0.5)return",atempo=0.5,atempo="+(sp/0.5).toFixed(3);
  return",atempo="+sp.toFixed(3);
}
/* Phase 1 (2026-11-12, APK target) + JOB 0 (2026-11-12, web deploy):
   the Video Engine is VENDORED in app/vendor/ (ffmpeg-core.js + .wasm,
   plus the @ffmpeg/ffmpeg and @ffmpeg/util ESM modules) so it loads
   offline inside the Android app (Capacitor WebView,
   capacitor://localhost origin). JOB 0: the web deploy ALSO ships the
   small wrapper files now (deploy.py excludes ONLY the 31 MB
   ffmpeg-core.wasm — Cloudflare Pages rejects single files >25 MiB).
   That matters because of how the wrapper builds its worker:
   vendor/ffmpeg/ffmpeg.js load() does
     new Worker(new URL("./worker.js", import.meta.url), {type:"module"})
   — the worker URL is resolved against the WRAPPER's own URL, so a
   wrapper loaded from https://esm.sh builds a cross-origin worker and
   Chrome refuses it ("Failed to construct 'Worker': Script at
   'https://esm.sh/@ffmpeg/ffmpeg@0.12.15/es2022/worker.js' cannot be
   accessed from origin 'https://editora-pro.pages.dev'"). With the
   wrapper served same-origin from /app/vendor/, the worker is
   same-origin and constructs fine; the core/wasm are passed to it as
   blob URLs (same-origin-safe), and the worker loads the core with a
   dynamic import() (a module worker has no importScripts — worker.js
   falls back to `await import(coreURL)`). The core JS (110 KB) loads
   from the app on web too; only the wasm falls back to the jsDelivr CDN
   on web (it is local in the APK). Each file falls back independently,
   and a 404 is detected via res.ok — toBlobURL() alone would happily
   blob a 404 error page. Files are .js (not .mjs) so the WebView serves
   them as JavaScript. NOTE: the engine still needs a Web Worker +
   WebAssembly, which the WebView supports. */
let ffLoadPromise=null;
async function loadFFmpeg(){
  if(S.ffLoaded&&FF)return FF;
  if(ffLoadPromise)return ffLoadPromise;
  $("expStatus").textContent="Loading video engine (FFmpeg.wasm)…";
  ffLoadPromise=(async()=>{
    let mod=null,utilMod=null,localTried=false;
    try{
      mod=await import("./vendor/ffmpeg/entry.js");
      utilMod=await import("./vendor/util/util.js");
      localTried=true;
    }catch(eLocal){
      try{
        [mod,utilMod]=await Promise.all([
          import("https://esm.sh/@ffmpeg/ffmpeg@0.12.15"),
          import("https://esm.sh/@ffmpeg/util@0.12.2")
        ]);
      }catch(eCdn){
        const msg=(eCdn&&eCdn.message)||String(eCdn);
        S.ffError="Video Engine unavailable offline and the CDN could not be reached: "+msg;
        S.ffLoading=false;ffLoadPromise=null;
        try{console.error("[Editora] Video Engine failed to load:",eCdn);}catch(_){}
        return null;
      }
    }
    try{
      const {FFmpeg}=mod;
      const {fetchFile,toBlobURL}=utilMod;
      const ff=new FFmpeg();
      ff.on("log",()=>{});
      /* JOB 0: resolve the core JS and the wasm independently. On the web
         deploy the core JS is local (110 KB, shipped) but the 31 MB wasm
         is NOT (Pages >25 MiB limit) so it comes from the CDN; in the APK
         both are local. A plain toBlobURL() never throws on a 404 — it
         blobs the error page — so each file is fetched and VALIDATED
         (HTTP status, content-type, wasm magic) before use. */
      const CDN_CORE="https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js";
      const CDN_WASM="https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm";
      /* FIX 2026-11-12 (export failure): the old blobFrom() only checked
         res.ok — but Cloudflare Pages answers an excluded file with HTTP
         200 + an HTML error page (SPA fallback), so the local wasm "loaded"
         as HTML and ff.load() died with "expected magic word 00 61 73 6d,
         found 3c 21 44 4f" ("<!DO"). Validate every engine file BEFORE use:
         reject HTML (content-type or a leading "<"), and for .wasm require
         the 00 61 73 6d magic bytes. Any validation failure falls back to
         the jsDelivr CDN for THAT file only — an HTML response is never
         accepted as an engine file, and the failure reason is recorded. */
      const fetchEngineFile=async(url,mime,kind)=>{
        const r=await fetch(url);
        if(!r.ok)throw new Error("HTTP "+r.status+" for "+url);
        const ct=(r.headers.get("content-type")||"").toLowerCase();
        if(ct.includes("text/html"))throw new Error("Got an HTML page instead of "+kind+" from "+url+" (content-type: "+ct+")");
        const buf=await r.arrayBuffer();
        const u=new Uint8Array(buf);
        if(kind==="wasm"){
          if(!(u.length>=4&&u[0]===0x00&&u[1]===0x61&&u[2]===0x73&&u[3]===0x6d))
            throw new Error("Not a WebAssembly file: "+url+" — first bytes "+[...u.slice(0,4)].map(b=>b.toString(16).padStart(2,"0")).join(" "));
        }else if(kind==="js"){
          let i=0;while(i<u.length&&(u[i]===32||u[i]===9||u[i]===10||u[i]===13))i++;
          if(u[i]===60)throw new Error("Got an HTML page instead of JavaScript from "+url);
        }
        return URL.createObjectURL(new Blob([buf],{type:mime}));
      };
      let coreURL,wasmURL,coreLocal=false,wasmLocal=false;
      try{coreURL=await fetchEngineFile("vendor/ffmpeg-core.js","text/javascript","js");coreLocal=true;}
      catch(eCore){coreURL=await fetchEngineFile(CDN_CORE,"text/javascript","js");}
      try{wasmURL=await fetchEngineFile("vendor/ffmpeg-core.wasm","application/wasm","wasm");wasmLocal=true;}
      catch(eWasm){wasmURL=await fetchEngineFile(CDN_WASM,"application/wasm","wasm");}
      await ff.load({coreURL,wasmURL});
      FF=ff;S.ffLoaded=true;S.ffLoading=false;S.ffError=null;S.ffLocal=localTried;
      S.ffCoreSrc=(coreLocal?"app":"CDN")+" core + "+(wasmLocal?"app":"CDN")+" wasm";
      window.__ffFetchFile=fetchFile;
      return ff;
    }catch(e){
      const msg=(e&&e.message)||String(e);
      S.ffError=msg;S.ffLoading=false;ffLoadPromise=null;
      try{console.error("[Editora] Video Engine failed to load:",e);}catch(_){}
      return null;
    }
  })();
  return ffLoadPromise;
}
function ffmpegEq(){
  const c=S.color;
  const b=clamp((c.brightness-100)/100+c.exposure/100,-1,1).toFixed(3);
  return `eq=brightness=${b}:contrast=${(c.contrast/100).toFixed(3)}:saturation=${(c.saturation/100).toFixed(3)}`;
}
async function doFFmpegExport(ff){
  const res=$("expRes").value,fps=+$("expFps").value,bitrate=exportBitrate(),codec=exportCodec();
  const {w,h,note}=exportCanvasSize(res);
  if(!w||!bitrate){toast("Check the export settings — custom resolution must be 16–4096 each way, custom bitrate 0.5–50 Mbps");return false;}
  const clips=S.clips.filter(c=>(c.track||"v1")==="v1").sort((a,b)=>a.start-b.start);
  if(!clips.length){toast("Add a clip to the V1 track first");return false;}
  const total=totalDuration();
  let cancelled=false;
  $("btnCancelExport").onclick=()=>{cancelled=true;S._ffCancelled=true;try{ff.terminate();}catch(e){}FF=null;S.ffLoaded=false;};
  const skipped=[];
  if(S.clips.some(c=>c.track==="v2"))skipped.push("V2 overlays (use the Canvas export for overlays)");
  if(S.textClips.length)skipped.push("text overlays");
  if(S.captions.length)skipped.push("captions");
  /* Phase 3: only the fade family renders in this path (real fade filters
     on each clip). Every other transition on a clip is listed by name. */
  const ffTransSkipped=[...new Set(S.clips.map(c=>TRANS_ALIAS[c.transition]||c.transition||"none")
    .filter(t=>t&&t!=="none"&&!(TRANSITIONS[t]&&TRANSITIONS[t].ff)))];
  if(ffTransSkipped.length)skipped.push("transitions (not rendered here — fade family only): "+ffTransSkipped.join(", "));
  const clipFxUsed=[...new Set(S.clips.flatMap(c=>Object.keys(c.fx||{})))];
  const globalFxUsed=Object.keys(S.fx).filter(k=>S.fx[k]);
  if(clipFxUsed.length||globalFxUsed.length)skipped.push("effects (use the Canvas export): "+[...new Set([...clipFxUsed.map(id=>EFFECT_LABELS[id]||id),...globalFxUsed])].join(", "));
  if(S.hsl&&(S.hsl.hue||S.hsl.sat||S.hsl.light))skipped.push("HSL shifts (Canvas export only)");
  if(S.wheels&&((S.wheels.sh.x||S.wheels.sh.y)||(S.wheels.mid.x||S.wheels.mid.y)||(S.wheels.hi.x||S.wheels.hi.y)))skipped.push("color wheels (Canvas export only)");
  if(S.lut)skipped.push("LUT intensity is ignored here — the LUT itself renders at full strength (Canvas export honours the intensity slider)");
  if(S.clips.some(c=>(c.speedKf&&c.speedKf.length)||(c.timeMap&&c.timeMap.length>=2)||c.frameHold))skipped.push("speed ramp / time remap / frame hold (Canvas export renders them; the Video Engine cannot vary speed inside one re-encoded clip)");
  if(S.clips.some(c=>c.reverseAudio)||S.audioClips.some(c=>c.reverseAudio))skipped.push("reversed audio clips are rendered backwards here (areverse)");
  if(audioFxOn())skipped.push("audio effects are applied here via FFmpeg audio filters (EQ/bass/treble/reverb/echo/delay/chorus/flanger/phaser/distortion/compressor/limiter/gate/noise-reduction)");
  if(S.motionBlur)skipped.push("motion blur (Canvas export only)");
  /* Phase 6 — what this path does / does not do with the new features. */
  if(S.splitScreen)skipped.push("split screen (Canvas export only — the Video Engine renders one video at a time)");
  if(S.clips.some(c=>c.mask&&c.mask.shape&&c.mask.shape!=="none"))skipped.push("clip masks (Canvas export only)");
  if(S.duckOn)skipped.push("audio ducking (time-based; Canvas export only)");
  if(S.clips.some(c=>c.chroma&&c.chroma.on))skipped.push("chroma key is applied here with the colorkey filter to a black background (the Canvas export composites it over the V2 clip instead)");
  const fetchFile=window.__ffFetchFile;
  /* Phase 6 — chroma key in this path: FFmpeg's colorkey filter removes
     the key colour (to a black background — yuv420p has no alpha). The
     Canvas export composites over the V2 clip instead; see the note above. */
  const chromaF=c=>{
    if(!c.chroma||!c.chroma.on)return"";
    const hex=(c.chroma.color||"#00ff00").replace("#","");
    const sim=clamp(0.05+((c.chroma.tol||40)/100)*0.4,0.05,0.5).toFixed(2);
    return `,colorkey=0x${hex}:${sim}:0.10`;
  };
  let lutFilter="";
  if(S.lut){
    try{
      const lines=["# Editora Pro LUT","LUT_3D_SIZE "+S.lut.size];
      for(let k=0;k<S.lut.data.length;k+=3)lines.push(S.lut.data[k].toFixed(5)+" "+S.lut.data[k+1].toFixed(5)+" "+S.lut.data[k+2].toFixed(5));
      await ff.writeFile("lut.cube",lines.join("\n"));
      lutFilter=",lut3d=file=lut.cube";
    }catch(e){skipped.push("LUT (could not be written into the Video Engine)");}
  }
  const inputs=[],vfilters=[],afilters=[];
  for(let i=0;i<clips.length;i++){
    const c=clips[i],m=S.media.find(x=>x.id===c.mediaId);
    if(!m){toast("A clip's media file is missing — re-import it and try again");return false;}
    let blob=null;
    try{blob=m.file||await fetch(m.url).then(r=>r.blob());}catch(e){}
    if(!blob){toast("Could not read media file: "+m.name);return false;}
    const ext=(m.name.split(".").pop()||"mp4").toLowerCase();
    const fname=`in${i}.${ext}`;
    await ff.writeFile(fname,await fetchFile(blob));
    const dur=c.duration,sp=c.speed||1;
    if(m.type==="image"){
      inputs.push("-loop","1","-framerate",String(fps),"-t",dur.toFixed(3),"-i",fname);
      vfilters.push(`[${i}:v]trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS${c.reverse?",reverse":""}${sp!==1?",setpts=PTS/"+sp.toFixed(3):""},${ffmpegEqFull()}${ffmpegTransFilter(c)}${ffmpegCurvesFilter()}${lutFilter}${chromaF(c)},scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`);
      afilters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    }else{
      inputs.push("-i",fname);
      const ti=c.trimIn||0,to=c.trimOut||dur;
      vfilters.push(`[${i}:v]trim=start=${ti.toFixed(3)}:end=${to.toFixed(3)},setpts=PTS-STARTPTS${sp!==1?",setpts=PTS/"+sp.toFixed(3):""}${c.reverse?",reverse":""},${ffmpegEqFull()}${ffmpegTransFilter(c)}${ffmpegCurvesFilter()}${lutFilter}${chromaF(c)},scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`);
      afilters.push(`[${i}:a]atrim=start=${ti.toFixed(3)}:end=${to.toFixed(3)},asetpts=PTS-STARTPTS${atempoChain(sp)}${c.reverse?",areverse":""}${ffmpegAudioFx(c)}[a${i}]`);
    }
  }
  // audio-track clips (A1/A2) are mixed in after the main concat
  const audDone=[],mutedAudio=[];
  for(let j=0;j<S.audioClips.length;j++){
    const ac=S.audioClips[j],m=S.media.find(x=>x.id===ac.mediaId);if(!m)continue;
    if(trackMuted(ac.track||"a1")){mutedAudio.push(ac.name||("audio "+(j+1)));continue;}
    let blob=null;try{blob=m.file||await fetch(m.url).then(r=>r.blob());}catch(e){}if(!blob)continue;
    const ext=(m.name.split(".").pop()||"mp3").toLowerCase();
    const fname=`aud${j}.${ext}`;
    await ff.writeFile(fname,await fetchFile(blob));
    const idx=clips.length+audDone.length;
    inputs.push("-i",fname);audDone.push(j);
    const ms=Math.round(ac.start*1000);
    const spd=+$("audSpeed").value||1;
    afilters.push(`[${idx}:a]atrim=0:${ac.duration.toFixed(3)},asetpts=PTS-STARTPTS${atempoChain(spd)},adelay=${ms}|${ms},volume=${(((ac.vol??80)/100)*(ac.normGain||1)).toFixed(3)}${ffmpegAudioFx(ac)}[am${j}]`);
  }
  if(mutedAudio.length)skipped.push("muted audio track(s) — silent in this export: "+mutedAudio.join(", "));
  const n=clips.length;
  let fc=[...vfilters,...afilters].join(";");
  fc+=";"+clips.map((_,i)=>`[v${i}][a${i}]`).join("")+`concat=n=${n}:v=1:a=1[vout][aout]`;
  let aFinal="aout";
  if(audDone.length){
    const mixInputs=["[aout]",...audDone.map(j=>`[am${j}]`)].join("");
    fc+=`;${mixInputs}amix=inputs=${1+audDone.length}:normalize=0[aout2]`;
    aFinal="aout2";
  }
  if(S.fadeIn||S.fadeOut){
    const fi=S.fadeIn||0,fo=S.fadeOut||0;
    fc+=`; [${aFinal}]afade=t=in:st=0:d=${fi}${fo?`,afade=t=out:st=${Math.max(0,total-fo).toFixed(2)}:d=${fo}`:""}[aout3]`;
    aFinal="aout3";
  }
  const vCodec=codec==="h265"?"libx265":"libx264";
  const crf=codec==="h265"?"28":"23";
  const outArgs=["-filter_complex",fc,"-map","[vout]","-map",`[${aFinal}]`,"-c:v",vCodec,"-preset","veryfast","-crf",crf,"-b:v",String(bitrate),"-c:a","aac","-b:a","128k","-movflags","+faststart","out.mp4"];
  /* FIX 2026-11-12: ffmpeg.wasm reports progress `time` in MICROseconds —
     the old code divided by 1000 (milliseconds), so a 5 s clip showed an
     absurd "06:34.7 / 00:05.0" rising to "44:30.3". Divide by 1e6. */
  const onProg=({time})=>{const sec=time/1e6;const pct=clamp(sec/total*100,0,100);$("expFill").style.width=pct+"%";$("expPct").textContent=Math.round(pct)+"%";$("expStatus").textContent=" Encoding (Video Engine) "+fmt(sec)+" / "+fmt(total);};
  ff.on("progress",onProg);
  let ok=true;
  try{await ff.exec([...inputs,...outArgs]);}
  catch(e){ok=false;}
  try{ff.off("progress",onProg);}catch(e){}
  if(cancelled){$("expStatus").textContent="Export cancelled.";recordExport({status:"Failed",note:"Cancelled by user",settings:"Video Engine (FFmpeg)"});return false;}
  if(!ok){
    // retry with silent audio — some sources have no audio stream, which breaks the concat
    try{
      const silentFc=[...vfilters].join(";")+";"+clips.map((_,i)=>`anullsrc=r=44100:cl=stereo,atrim=0:${clips[i].duration.toFixed(3)},asetpts=PTS-STARTPTS[sa${i}]`).join(";")+";"+clips.map((_,i)=>`[v${i}][sa${i}]`).join("")+`concat=n=${n}:v=1:a=1[vout][aout]`;
      await ff.exec([...inputs,"-filter_complex",silentFc,"-map","[vout]","-map","[aout]","-c:v",vCodec,"-preset","veryfast","-crf",crf,"-b:v",String(bitrate),"-c:a","aac","-movflags","+faststart","out.mp4"]);
      skipped.push("source audio (could not be read from the file — exported silent)");
      ok=true;
    }catch(e2){ok=false;}
  }
  if(!ok){toast("Video Engine failed on this project — falling back to the Canvas export");return false;}
  const data=await ff.readFile("out.mp4");
  const blob=new Blob([data.buffer],{type:"video/mp4"});
  /* JOB 0: never hand over an empty encode as a success — a tiny output
     means the encode produced essentially nothing. Return false so the
     caller falls back to the Canvas export (and says so) instead of
     offering a broken download. */
  const minBytes=Math.max(4096,Math.round(total*2000));
  if(blob.size<minBytes){
    exportFallbackNote="Video Engine (FFmpeg) encoded only "+(blob.size/1024).toFixed(1)+" KB for "+fmt(total)+" of video — the encode produced essentially nothing, so this file came from the Canvas export instead.";
    return false;
  }
  const url=URL.createObjectURL(blob);
  const fname=(S.projectName||"editora-export").replace(/[^\w\-]+/g,"-")+".mp4";
  window.__lastExport={blob,url,name:fname,kind:"video"};
  $("expFill").style.width="100%";$("expPct").textContent="100%";
  $("expStatus").textContent="Done — "+(blob.size/1048576).toFixed(1)+" MB, real MP4, no watermark."+(note?" "+note:"");
  $("expResult").innerHTML=`<a href="${url}" download="${fname}">${epIcon("download")} Download your video (.mp4)</a> <button id="btnShareResult" class="mini">${epIcon("share")} Share</button><p class="hint">Engine: Video Engine (FFmpeg) — real MP4 (${codec==="h265"?"H.265":"H.264"} + AAC), exact timeline duration.${S.ffCoreSrc?(" Video Engine files: "+S.ffCoreSrc+"."):(S.ffLocal?" Loaded from the app itself (offline).":" Loaded from the CDN.")}</p>${note?`<p class="hint">${note}</p>`:""}${skipped.length?`<p class="hint">Not rendered by the Video Engine: ${skipped.join("; ")}. Use the Canvas export for those.</p>`:""}`;
  recordExport({status:"Completed",settings:`Video Engine (FFmpeg) · ${readExportSettings().label}`,size:blob.size,job:readExportSettings()});
  toast("Export complete — no watermark");
  return true;
}
/* Set by doExport when the canvas path runs because the Video Engine failed;
   doVideoExport prints it in its result so the fallback is never silent. */
let exportFallbackNote="";
async function doExport(){
  if(!S.clips.length){toast("Add a clip to the timeline first");return;}
  if(S.exporting)return;S.playing=false;video.pause();setPlayBtn("play");
  /* Phase 6 — validate the custom settings before any work starts, and
     remember this job (history + queue re-export). */
  const job=readExportSettings();
  if(!job.w||!job.bitrate){toast("Check the export settings — custom resolution must be 16–4096 each way, custom bitrate 0.5–50 Mbps");return;}
  S._lastJob=job;
  saveLastExportSettings(); /* FIX 2026-11-12: remember these settings for the next open */
  /* Phase 6 — proxy rule: exports ALWAYS use the original files. If the
     preview is showing a proxy, switch the preview back to the original
     for the export and restore the proxy afterwards. */
  const hadProxy=S.proxyOn;let proxyRestored=false;
  if(hadProxy){S.proxyOn=false;if(curMedia)loadPreview(curMedia);proxyRestored=true;}
  S.exporting=true;
  $("btnCancelExport").disabled=false;$("expProgress").hidden=false;$("expResult").innerHTML="";
  const engine=$("expEngine").value;
  exportFallbackNote="";S._ffCancelled=false;
  try{
    if(engine==="canvas"){await doVideoExport();return;}
    const ff=await loadFFmpeg();
    if(ff){
      const doneOk=await doFFmpegExport(ff);
      if(doneOk)return;
      if(S._ffCancelled){$("expStatus").textContent="Export cancelled.";return;} // user cancelled — do NOT start a canvas export behind their back
      /* FIX 2026-11-12 (Issue 4a): the encode failed AFTER the engine loaded
         — say so plainly instead of silently switching paths. JOB 0: if
         doFFmpegExport already set a specific reason (e.g. an empty
         encode), keep it instead of overwriting it with the generic line. */
      if(!exportFallbackNote)exportFallbackNote="Video Engine (FFmpeg) loaded but the encode failed on this project — this file came from the Canvas export instead.";
      if(S.exporting){$("expStatus").textContent=exportFallbackNote;await doVideoExport();}
      return;
    }
    /* FIX 2026-11-12 (Issue 4a): name the actual load failure (recorded by
       loadFFmpeg), not just "offline / CDN blocked". */
    exportFallbackNote="Video Engine (FFmpeg) could not load"+(S.ffError?": "+S.ffError:" (offline / CDN blocked)")+" — this file came from the Canvas export instead.";
    $("expStatus").textContent=exportFallbackNote;
    await doVideoExport();
  }catch(err){
    recordExport({status:"Failed",note:String(err&&err.message||err),job:S._lastJob});
    $("expStatus").textContent="Export failed: "+(err&&err.message||err);
  }finally{S.exporting=false;$("btnCancelExport").disabled=true;
    if(proxyRestored){S.proxyOn=true;if(curMedia)loadPreview(curMedia);syncProxyUI();}
  }
}
/* ---------- Canvas export: offline timeline audio mix (WebCodecs, 2026-11-12) ----------
   Renders the exact audio the preview plays — V1 video-clip audio plus
   A1/A2 clips — into one AudioBuffer with OfflineAudioContext, so the
   Canvas export's audio has explicit timestamps like its video (the old
   path recorded audio in real time through a MediaStreamDestination).
   Mirrors the preview mix: per-clip volume/normGain, pan,
   speed+pitch, global fade in/out, A2 ducking under any sounding A1 clip,
   and the video EQ (bass/treble shelves + vidVol). Video clips use their
   BASE speed for audio — speed ramps / time remap / frame hold still
   render exactly in the VIDEO frames (drawn per frame); the result note
   says so when such a clip is present. */
const _audioBufCache=new WeakMap(); /* media record -> decoded AudioBuffer (null on failure) */
async function decodeMediaAudio(m){
  if(!m)return null;
  if(_audioBufCache.has(m))return _audioBufCache.get(m);
  let out=null;
  try{
    const buf=await (m.file?m.file.arrayBuffer():fetch(m.url).then(r=>r.arrayBuffer()));
    const probe=new OfflineAudioContext(1,44100,44100);
    out=await probe.decodeAudioData(buf);
  }catch(e){out=null;}
  _audioBufCache.set(m,out);
  return out;
}
function reversedAudioBuffer(buf){
  if(!buf)return null;
  try{
    const rev=new AudioBuffer({length:buf.length,sampleRate:buf.sampleRate,numberOfChannels:buf.numberOfChannels});
    for(let ch=0;ch<buf.numberOfChannels;ch++){
      const src=buf.getChannelData(ch),dst=rev.getChannelData(ch);
      for(let i=0;i<src.length;i++)dst[i]=src[src.length-1-i];
    }
    return rev;
  }catch(e){return null;}
}
/* Window-relative range of a clip inside [base, base+total]: {when, len}
   in seconds from the window start, or null when the clip is outside. */
function _winRange(c,base,total){
  const s=Math.max(c.start,base),e=Math.min(c.start+c.duration,base+total);
  if(e-s<=0)return null;
  return{when:s-base,len:e-s};
}
async function renderTimelineAudioOffline(base,total){
  const sr=44100;
  if(total>600)return{buf:null,note:"Timeline is over 10 minutes — audio was skipped in this Canvas export (use the Video Engine for long timelines)."};
  const len=Math.max(1,Math.ceil(total*sr));
  const off=new OfflineAudioContext(2,len,sr);
  let any=false;const noteParts=[];
  /* A1 ranges (window-relative, merged) for ducking: any A1 clip sounding
     — same definition as the live mix. */
  const a1Raw=S.audioClips.filter(ac=>(ac.track||"a1")==="a1")
    .map(ac=>_winRange(ac,base,total)).filter(Boolean)
    .map(r=>[r.when,r.when+r.len]).sort((a,b)=>a[0]-b[0]);
  const a1Ranges=[];
  for(const r of a1Raw){
    const last=a1Ranges[a1Ranges.length-1];
    if(last&&r[0]<=last[1]+0.001)last[1]=Math.max(last[1],r[1]);
    else a1Ranges.push([r[0],r[1]]);
  }
  /* --- V1 video-clip audio (V2 overlay is muted in the live path too) --- */
  for(const c of S.clips.filter(x=>(x.track||"v1")==="v1")){
    if(c.disabled)continue;
    const wr=_winRange(c,base,total);if(!wr)continue;
    const m=S.media.find(x=>x.id===c.mediaId);if(!m||m.type!=="video")continue;
    if(S.muted||c.muted||trackMuted(c.track||"v1"))continue;
    const buf=await decodeMediaAudio(m);if(!buf)continue;
    if((c.speedKf&&c.speedKf.length)||(c.timeMap&&c.timeMap.length>=2)||c.frameHold)
      noteParts.push("speed ramp / time remap / frame hold audio uses base speed");
    const sp=c.speed||1;
    const localOff=Math.max(0,base-c.start);
    const srcAt=clamp(c.trimIn+sourceTimeForOffset(c,localOff),0,buf.duration);
    const src=new AudioBufferSourceNode(off,{buffer:buf,playbackRate:sp});
    const bass=off.createBiquadFilter();bass.type="lowshelf";bass.frequency.value=200;bass.gain.value=S.bass||0;
    const treble=off.createBiquadFilter();treble.type="highshelf";treble.frequency.value=3000;treble.gain.value=S.treble||0;
    const g=off.createGain();g.gain.value=(S.vidVol??100)/100;
    src.connect(bass);bass.connect(treble);treble.connect(g);g.connect(off.destination);
    try{src.start(wr.when,srcAt,wr.len*sp);}catch(e){try{src.start(wr.when,srcAt);}catch(e2){}}
    any=true;
  }
  /* --- A1/A2 audio clips --- */
  for(const ac of S.audioClips){
    const wr=_winRange(ac,base,total);if(!wr)continue;
    if(trackMuted(ac.track||"a1"))continue;
    const m=S.media.find(x=>x.id===ac.mediaId);if(!m)continue;
    let buf=await decodeMediaAudio(m);if(!buf)continue;
    if(ac.reverseAudio){const rb=reversedAudioBuffer(buf);if(rb)buf=rb;}
    const rate=(ac.speed||1)*Math.pow(2,(ac.pitch||0)/12);
    const localOff=Math.max(0,base-ac.start);
    const srcOff=clamp(localOff*rate,0,buf.duration);
    const src=new AudioBufferSourceNode(off,{buffer:buf,playbackRate:rate});
    let node=src;
    if(audioFxOn()){try{node=buildAudioChain(off,src);}catch(e){node=src;}}
    const vol=off.createGain();
    const baseVol=(ac.vol??80)/100*(ac.normGain||1);
    const end=wr.when+wr.len;
    vol.gain.setValueAtTime(baseVol,wr.when);
    if(S.fadeIn&&S.fadeIn>0){
      vol.gain.setValueAtTime(0,wr.when);
      vol.gain.linearRampToValueAtTime(baseVol,Math.min(end,wr.when+S.fadeIn));
    }
    if(S.fadeOut&&S.fadeOut>0){
      const fs=Math.max(wr.when,end-S.fadeOut);
      vol.gain.setValueAtTime(baseVol,fs);
      vol.gain.linearRampToValueAtTime(0,end);
    }
    node.connect(vol);
    let tail=vol;
    if(S.duckOn&&(ac.track||"a1")==="a2"&&a1Ranges.length){
      const duck=off.createGain();duck.gain.value=1;
      const down=1-(S.duckAmt||60)/100;
      for(const [a,b] of a1Ranges){
        const os=Math.max(a,wr.when),oe=Math.min(b,end);
        if(oe-os<=0.01)continue;
        duck.gain.setValueAtTime(1,os);
        duck.gain.linearRampToValueAtTime(down,Math.min(oe,os+0.05));
        duck.gain.setValueAtTime(down,oe);
        duck.gain.linearRampToValueAtTime(1,Math.min(end,oe+0.05));
      }
      vol.connect(duck);tail=duck;
    }
    const pan=off.createStereoPanner();pan.pan.value=(ac.pan||0)/100;
    tail.connect(pan);pan.connect(off.destination);
    try{src.start(wr.when,srcOff,wr.len*rate);}catch(e){try{src.start(wr.when,srcOff);}catch(e2){}}
    any=true;
  }
  if(!any)return{buf:null,note:""};
  const buf=await off.startRendering();
  return{buf,note:[...new Set(noteParts)].join("; ")};
}

async function doVideoExport(){
  if(!S.clips.length){toast("Add a clip to the timeline first");return;}
  $("btnCancelExport").disabled=false;$("expProgress").hidden=false;$("expResult").innerHTML="";
  const res=$("expRes").value,fps=+$("expFps").value,fmtSel=$("expFmt").value,bitrate=exportBitrate(),codec=exportCodec();
  const {w,h,note}=exportCanvasSize(res);
  if(!w||!bitrate){toast("Check the export settings — custom resolution must be 16–4096 each way, custom bitrate 0.5–50 Mbps");return;}
  const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d");
  /* WEBCODECS REBUILD (2026-11-12) — the Canvas export no longer uses
     MediaRecorder/captureStream. The old path timestamped frames by wall
     clock, so a slow draw (~140 ms/frame with a per-pixel effect like Fog
     at 720p) produced a 7 fps file for a 30 fps timeline and the
     validation rightly refused it. The new path encodes with VideoEncoder
     using EXPLICIT frame timestamps (frame n at n/fps seconds): slow
     drawing only makes the export take longer, never corrupts fps or
     duration. Audio is rendered offline (OfflineAudioContext) and encoded
     with AudioEncoder (AAC); both tracks are muxed into a real MP4 with
     the vendored mp4-muxer (small ESM file, same-origin, like the FFmpeg
     wrapper). If this browser has no WebCodecs, the export fails clearly
     and points at the Video Engine (FFmpeg) instead of producing a bad file. */
  const failCanvas=(reason)=>{
    $("btnCancelExport").disabled=true;S.exportOnly=null;
    $("expStatus").textContent="Export failed: "+reason;
    $("expResult").innerHTML='<p class="hint">Export failed — '+reason+'</p>';
    recordExport({status:"Failed",note:reason,settings:"Canvas export",job:S._lastJob});
    toast("Export failed — see the Export Center");
    return false;
  };
  if(typeof VideoEncoder==="undefined"||typeof VideoFrame==="undefined"||typeof AudioEncoder==="undefined"){
    return failCanvas("This browser does not support WebCodecs video encoding (VideoEncoder), so the Canvas export cannot run here — use the Video Engine (FFmpeg) export instead (Engine: Auto or Video Engine).");
  }
  /* The muxer is loaded AFTER the codec ladder below picks a container
     (MP4 via mp4-muxer, WebM via webm-muxer) — the import lives there. */
  const v2Video=document.createElement("video");v2Video.muted=true;v2Video.playsInline=true;v2Video.preload="auto";
  v2Video.setAttribute("aria-hidden","true");
  let prevSnap=null,prevSnapClipId=null; /* cross-dissolve underlay: snapshot of the outgoing clip's last frame, taken at the clip switch (see prepareFrameMedia) — drawn instead of seeking per frame */
  const only=S.exportOnly;
  const total=only?only.duration:totalDuration();
  const base=only?only.start:0;
  let cancelled=false;
  $("btnCancelExport").onclick=()=>{cancelled=true;};
  const totalFrames=Math.max(1,Math.round(total*fps));
  let framesEncoded=0;
  const setProg=p=>{const pc=Math.min(100,Math.max(0,p));$("expFill").style.width=pc+"%";$("expPct").textContent=Math.round(pc)+"%";};
  /* PROGRESS SCALE (2026-11-12): rendering is only the first 70% of the
     job — audio encoding 70–80%, flush + file writing 80–90%, file
     validation 90–97%, done 100%. The bar must NEVER hit 100% before the
     file exists: the old code reached 100% at the last rendered frame and
     then failed at the encode stage, which looked like a success. */
  const PROG_RENDER=70,PROG_AUDIO=80,PROG_WRITE=90,PROG_CHECK=97;
  /* Exact per-frame chunk duration (us) for this export — the same value
     the VideoFrames carry and the mux guard falls back to (Bug 1). */
  const frameDurUs=EP_FRAME_DUR_US(fps);
  /* PROBE MUXER (2026-11-12, Bug 1): the old smoke probe discarded the
     encoder output, so a muxer-side failure (null chunk duration) sailed
     through the probe and only died at 70% of the real export. The probe
     now encodes through a REAL throwaway mp4-muxer with the same duration
     math the export uses. MP4 is the strict container (it requires a
     duration per chunk; WebM does not), so proving the MP4 path proves
     the WebM path too. If the muxer cannot even be imported, the probes
     fall back to encode-only smoke (the real export still fails clearly
     at its own import step). */
  const muxCodecFor=c=>c.indexOf("hvc1")===0||c.indexOf("hev1")===0?"hevc":c.indexOf("vp09")===0?"vp9":c==="vp8"?"vp8":"avc";
  let ProbeMuxer=null,ProbeTarget=null;
  try{({Muxer:ProbeMuxer,ArrayBufferTarget:ProbeTarget}=await import("./vendor/mp4-muxer/mp4-muxer.mjs"));}
  catch(e){ProbeMuxer=null;}
  /* CODEC LADDER + REAL PROBE (2026-11-12) — root cause of the live
     "Unsupported codec type" failure (09:42 IST, Fog / 720p / Canvas):
     VideoEncoder.isConfigSupported SAID H.264 was supported on the test
     browser (Linux Chrome has no H.264 encoder — proprietary codecs are
     absent there), the export rendered all 150 frames, and only then did
     the encoder fail at the encode/flush stage. isConfigSupported is an
     optimistic claim, not a fact, so every candidate is now PROVEN with a
     real one-frame encode (smoke test) using the EXACT config the export
     will use, BEFORE a single timeline frame is drawn. Audio was never
     probed at all before — AAC (mp4a.40.2) is likewise absent on Linux
     Chrome, so it gets the same treatment. Ladder: H.264 Baseline
     (avc1.42E01F, most widely supported) → H.264 High (avc1.64001F) →
     VP9 (vp09.00.10.08) → VP8 (vp8). Audio: AAC (mp4a.40.2) → Opus.
     H.265 stays first only when the user picked it. */
  const encNoteParts=[];
  const withTimeout=(p,ms,what)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error("Timed out probing "+what)),ms))]);
  /* PROBE (2026-11-12, Bug 1): the smoke encode goes through the SAME
     chunk-adding code the real export uses — frames carry the exact
     per-frame duration, chunks pass through epSafeVideoChunk /
     epSafeAudioChunk into a real Muxer, and the muxer is FINALIZED, so a
     null-duration chunk (the old failure) is caught HERE, before a single
     timeline frame is drawn. VP8 has no MP4 container, so it keeps the
     encode-only smoke (its own clear error follows later). */
  const smokeVideo=async(c)=>{
    let enc=null,got=0,err=null,probeMux=null;
    const D=frameDurUs;
    try{
      if(ProbeMuxer&&muxCodecFor(c)!=="vp8"){
        probeMux=new ProbeMuxer({target:new ProbeTarget(),video:{codec:muxCodecFor(c),width:w,height:h},fastStart:"in-memory",firstTimestampBehavior:"cross-track-offset"});
      }
      enc=new VideoEncoder({output:(chunk,meta)=>{try{
        if(probeMux)probeMux.addVideoChunk(epSafeVideoChunk(chunk,D),meta);
        got++;
      }catch(e){err=err||e;}},error:e=>{err=err||e;}});
      enc.configure({codec:c,width:w,height:h,bitrate,framerate:fps});
      const cv=document.createElement("canvas");cv.width=w;cv.height=h;
      const cx=cv.getContext("2d");cx.fillStyle="#000";cx.fillRect(0,0,w,h);
      /* Three frames, not one: the first two prove the steady path, the
         third is the flush-path chunk — the one whose duration used to be
         null (no next frame to infer it from). */
      for(let n=0;n<3;n++){
        const vf=new VideoFrame(cv,{timestamp:n*D,duration:D});
        enc.encode(vf,{keyFrame:n===0});vf.close();
      }
      await withTimeout(enc.flush(),8000,"video codec "+c);
      if(err)throw err;
      if(probeMux){probeMux.finalize();if(!(probeMux.target.buffer&&probeMux.target.buffer.byteLength>0))throw new Error("probe mux produced no bytes");}
      return got>=3;
    }catch(e){return false;}
    finally{try{if(enc)enc.close();}catch(e){}}
  };
  const smokeAudio=async(c)=>{
    let enc=null,got=0,err=null,probeMux=null;
    const D=EP_AUDIO_DUR_US(1024,44100);
    try{
      if(ProbeMuxer){
        probeMux=new ProbeMuxer({target:new ProbeTarget(),audio:{codec:c==="opus"?"opus":"aac",sampleRate:44100,numberOfChannels:2}});
      }
      enc=new AudioEncoder({output:(chunk,meta)=>{try{
        if(probeMux)probeMux.addAudioChunk(epSafeAudioChunk(chunk,D),meta);
        got++;
      }catch(e){err=err||e;}},error:e=>{err=err||e;}});
      enc.configure({codec:c,sampleRate:44100,numberOfChannels:2,bitrate:128000});
      for(let n=0;n<2;n++){
        const ad=new AudioData({format:"f32-planar",sampleRate:44100,numberOfFrames:1024,numberOfChannels:2,timestamp:n*D});
        enc.encode(ad);ad.close();
      }
      await withTimeout(enc.flush(),8000,"audio codec "+c);
      if(err)throw err;
      if(probeMux){probeMux.finalize();if(!(probeMux.target.buffer&&probeMux.target.buffer.byteLength>0))throw new Error("probe mux produced no bytes");}
      return got>=2;
    }catch(e){return false;}
    finally{try{if(enc)enc.close();}catch(e){}}
  };
  const probeVideo=async(cands)=>{
    for(const c of cands){
      try{const r=await VideoEncoder.isConfigSupported({codec:c,width:w,height:h,bitrate,framerate:fps});if(!(r&&r.supported))continue;}
      catch(e){continue;}
      $("expStatus").textContent=" Checking encoder support ("+c+")…";
      if(await smokeVideo(c))return c;
    }
    return null;
  };
  const probeAudioOne=async(c)=>{
    try{const r=await AudioEncoder.isConfigSupported({codec:c,sampleRate:44100,numberOfChannels:2,bitrate:128000});if(!(r&&r.supported))return false;}
    catch(e){return false;}
    return await smokeAudio(c);
  };
  let encCodec=null,encIsHevc=false;
  if(codec==="h265"){
    encCodec=await probeVideo(["hvc1.1.6.L120.90","hev1.1.6.L120.90"]);
    if(encCodec)encIsHevc=true;
    else encNoteParts.push("H.265 was picked but this browser's WebCodecs encoder cannot do it, so the Canvas export used another codec instead (see the codec named below).");
  }
  if(!encCodec)encCodec=await probeVideo(["avc1.42E01F","avc1.64001F","vp09.00.10.08","vp8"]);
  if(!encCodec){
    return failCanvas("This browser cannot encode video with WebCodecs (no H.264, VP9 or VP8 encoder at "+w+"×"+h+") — use the Video Engine (FFmpeg) export instead.");
  }
  /* Audio is probed now too — before any rendering — so an unsupported
     audio codec never wastes a full render. Both results are kept: MP4
     takes AAC or Opus, WebM takes Opus only. */
  const aacOk=await probeAudioOne("mp4a.40.2");
  const opusOk=await probeAudioOne("opus");
  /* Container follows the codec, not the format picker alone. MP4
     (vendored mp4-muxer) takes H.264, H.265, VP9 and AAC or Opus. WebM
     (vendored webm-muxer) takes VP9 + Opus only — H.264/HEVC cannot go
     in a WebM file, and no webm-muxer release supports VP8, so a VP8-only
     browser has no container and fails fast with a clear message (no real
     browser ships a VP8 encoder without VP9). */
  let container="mp4";
  const muxVideoCodec=muxCodecFor(encCodec);
  if(encCodec==="vp8"){
    return failCanvas("This browser can only encode VP8, and there is no VP8 container available in this app — use the Video Engine (FFmpeg) export instead.");
  }
  if(fmtSel==="webm"&&muxVideoCodec==="vp9")container="webm";
  else if(fmtSel==="webm")encNoteParts.push("WebM was picked but "+(encIsHevc?"H.265":"H.264")+" cannot go in a WebM file — wrote MP4 instead.");
  const encAudio=container==="webm"?(opusOk?"opus":null):(aacOk?"mp4a.40.2":opusOk?"opus":null);
  const muxAudioCodec=!encAudio?null:encAudio==="opus"?"opus":"aac";
  const codecShort=encIsHevc?"H.265":encCodec.indexOf("vp09")===0?"VP9":"H.264";
  const audioShort=!encAudio?null:encAudio==="opus"?"Opus":"AAC";
  const codecLabel=(container==="webm"?"WebM":"MP4")+" ("+codecShort+(audioShort?" + "+audioShort:", video-only")+")";
  let Muxer,ArrayBufferTarget;
  try{
    if(container==="webm")({Muxer,ArrayBufferTarget}=await import("./vendor/webm-muxer/webm-muxer.mjs"));
    else ({Muxer,ArrayBufferTarget}=await import("./vendor/mp4-muxer/mp4-muxer.mjs"));
  }catch(e){
    return failCanvas("Could not load the "+container.toUpperCase()+" muxer (app/vendor/"+(container==="webm"?"webm-muxer/webm-muxer.mjs":"mp4-muxer/mp4-muxer.mjs")+") — "+(e&&e.message||e)+". Use the Video Engine (FFmpeg) export instead.");
  }
  /* Render the timeline audio offline (deterministic, exact timestamps)
     before the video loop — the mix is fast (faster than real time) and
     its buffer is fed to the audio encoder (AAC or Opus — see the probe
     above) after the frames are drawn. */
  $("expStatus").textContent=" Rendering audio (offline mix)…";
  let audioBuf=null,audioFailed=false;
  try{
    const r=await renderTimelineAudioOffline(base,total);
    audioBuf=r.buf;
    if(r.note)encNoteParts.push(r.note);
  }catch(e){
    audioBuf=null;audioFailed=true;
    encNoteParts.push("Audio mix failed ("+(e&&e.message||e)+") — exported video-only.");
  }
  if(!audioBuf&&!audioFailed)encNoteParts.push("No audible audio on the timeline — exported video-only.");
  /* Muxer + encoders. firstTimestampBehavior "cross-track-offset" keeps
     A/V sync while shifting the earliest timestamp to 0 (AAC priming). */
  const muxerTarget=new ArrayBufferTarget();
  const muxerOpts={target:muxerTarget,
    video:{codec:muxVideoCodec,width:w,height:h},
    ...(audioBuf&&encAudio?{audio:{codec:muxAudioCodec,sampleRate:44100,numberOfChannels:2}}:{})};
  if(container==="webm")muxerOpts.firstTimestampBehavior="offset";
  else{muxerOpts.fastStart="in-memory";muxerOpts.firstTimestampBehavior="cross-track-offset";}
  const muxer=new Muxer(muxerOpts);
  let encErr=null;
  /* Audio chunk durations by timestamp (us) — exact samples/sampleRate
     per chunk from the feed loop below (Bug 1); the last chunk is partial,
     so its duration comes from its own sample count, never from a
     timestamp subtraction. */
  const audioDurByTs=new Map();
  const vEnc=new VideoEncoder({output:(chunk,meta)=>{try{muxer.addVideoChunk(epSafeVideoChunk(chunk,frameDurUs),meta);}catch(e){encErr=encErr||e;}},error:e=>{encErr=encErr||e;}});
  try{vEnc.configure({codec:encCodec,width:w,height:h,bitrate,framerate:fps});}
  catch(e){return failCanvas("Could not start the "+codecShort+" encoder even though the probe passed ("+(e&&e.message||e)+") — try the Video Engine (FFmpeg) export instead.");}
  let aEnc=null;
  if(audioBuf&&encAudio){
    aEnc=new AudioEncoder({output:(chunk,meta)=>{try{muxer.addAudioChunk(epSafeAudioChunk(chunk,audioDurByTs.get(chunk.timestamp)||EP_AUDIO_DUR_US(1024,44100)),meta);}catch(e){encErr=encErr||e;}},error:e=>{encErr=encErr||e;}});
    try{aEnc.configure({codec:encAudio,sampleRate:44100,numberOfChannels:2,bitrate:128000});}
    catch(e){aEnc=null;encNoteParts.push("Audio encoding failed ("+(e&&e.message||e)+") — exported video-only.");}
  }else if(audioBuf){
    encNoteParts.push("This browser has no audio encoder (no AAC, no Opus) — exported video-only.");
  }
  video.pause();
  const drawFrame=async(t)=>{
    if(cancelled)return;
    const hit=activeVideoAt(t);
    if(hit)video.muted=trackMuted(hit.clip.track||"v1")||!!hit.clip.muted;
    const ov=hit&&hit.overlay?hit:null;
    const main=hit&&!hit.overlay?hit:clipOnTrackAt("v1",t);
    ctx.fillStyle="#000";ctx.fillRect(0,0,w,h);
    /* Phase 3: when pixel grading is active, the grading lives in
       applyCanvasFramePixels (pixel math) — the CSS filter must be off
       or the grade would be applied twice. Otherwise the fast CSS path. */
    const gradeOn=gradeActive();
    ctx.filter=gradeOn?"none":cssFilterString();
    /* Phase 6 — chroma backdrop: the V2 frame (or black) is captured into
       an offscreen canvas BEFORE the main clip is drawn, so the keyed-out
       pixels can be replaced with it in the post-pass below. */
    const chromaOn=!!(main&&main.clip.chroma&&main.clip.chroma.on);
    let bgCv=null;
    if(chromaOn&&!S.splitScreen){
      bgCv=document.createElement("canvas");bgCv.width=w;bgCv.height=h;
      const bx=bgCv.getContext("2d");bx.fillStyle="#000";bx.fillRect(0,0,w,h);
      /* WebCodecs (2026-11-12): v2Video is seeked to the exact frame time
         by prepareFrameMedia and stays paused — draw its current frame. */
      if(ov){const om=S.media.find(x=>x.id===ov.clip.mediaId);
        if(om&&om.type==="image"){const im=exportImgCache(om);if(im)drawCover(bx,im,w,h,ov.clip);}
        else if(om&&om.type==="video"){if(v2Video.readyState>=2&&v2Video.videoWidth)drawCover(bx,v2Video,w,h,ov.clip);}}
    }
    if(main){
      let alpha=1;
      const splitActive=!!(S.splitScreen&&S.splitScreen.mode);
      if(splitActive){
        if(!main.clip.disabled)await drawSplitCells(ctx,w,h,main,t);
      }else{
      /* Phase 3 transitions — the same transCompute engine as the preview */
      const tc=transCompute(main.clip,main.offset);
      alpha=tc.opacity; const scale=tc.scale, blurPx=tc.blur;
      /* Phase 4+5 — true between-clips cross-dissolve (fade family only):
         the previous adjacent V1 clip's last frame is drawn underneath and
         the incoming clip fades in over it. Skipped when a V2 overlay needs
         the same spare video element, or in split-screen / chroma mode. */
      const _blend=crossBlendPrev(main.clip,main.offset);
      if(_blend&&!ov&&!splitActive&&!chromaOn){
        const _pm=S.media.find(x=>x.id===_blend.clip.mediaId);
        /* FIX 2026-11-12: the previous clip's last frame was snapshotted
           into prevSnap at the clip switch (prepareFrameMedia) — drawing
           it costs nothing. The old code seeked v2Video to trimOut-0.04
           on EVERY frame. */
        if(prevSnap&&prevSnapClipId===_blend.clip.id){ctx.save();ctx.globalAlpha=1;ctx.drawImage(prevSnap,0,0);ctx.restore();}
        else if(_pm&&_pm.type==="image"){const _pim=exportImgCache(_pm);if(_pim){ctx.save();ctx.globalAlpha=1;drawCover(ctx,_pim,w,h,_blend.clip);ctx.restore();}}
      }
      const tTx=tc.tx/120*w*0.25, tTy=tc.ty/120*h*0.25; // transition px are preview-scale; rescale to export size
      const m=S.media.find(x=>x.id===main.clip.mediaId);
      if(!main.clip.disabled){
        /* Phase 3: drop / long shadow — an offset black copy of the frame
           drawn first, so the shadow sits behind the clip. */
        const shFx=clipFxOf(main.clip);
        if(shFx.dropShadow||shFx.longShadow){
          const off=shFx.longShadow?Math.round(w*0.02):Math.round(w*0.008);
          const shA=((shFx.longShadow||shFx.dropShadow)/100)*0.6;
          ctx.save();ctx.translate(off,off);ctx.filter="brightness(0)";ctx.globalAlpha=shA;
          if(m&&m.type==="image"){const im=exportImgCache(m);if(im)drawCover(ctx,im,w,h,main.clip);}
          else if(video.readyState>=2&&video.videoWidth){drawCover(ctx,video,w,h,main.clip);}
          ctx.restore();ctx.filter=gradeOn?"none":cssFilterString();
        }
        ctx.save();
        if(blurPx)ctx.filter=(gradeOn?"":cssFilterString())+` blur(${blurPx.toFixed(1)}px)`;
        if(tc.shake){ctx.translate(Math.sin(t*47)*tc.shake*w/400,Math.cos(t*39)*tc.shake*h/400);}
        /* Per-clip shake effects (same motion as the preview): camera shake
           is fast and jittery, handheld is a slow drift + slight roll,
           zoom shake pulses the scale. */
        if(shFx.cameraShake){ctx.translate(Math.sin(t*47)*(shFx.cameraShake/100)*w/120,Math.cos(t*39)*(shFx.cameraShake/100)*h/120);}
        else if(shFx.handheld){ctx.translate(w/2,h/2);ctx.rotate(Math.sin(t*0.9)*0.01*(shFx.handheld/100));ctx.translate(-w/2+Math.sin(t*1.3)*(shFx.handheld/100)*w/100,-h/2+Math.sin(t*1.7+1)*(shFx.handheld/100)*h/140);}
        else if(shFx.zoomShake){const zs=1+Math.sin(t*9)*0.03*(shFx.zoomShake/100);ctx.translate(w/2,h/2);ctx.scale(zs,zs);ctx.translate(-w/2,-h/2);ctx.translate(Math.sin(t*31)*(shFx.zoomShake/100)*w/200,Math.cos(t*27)*(shFx.zoomShake/100)*h/200);}
        if(tTx||tTy||scale!==1||tc.rot){ctx.translate(w/2+tTx,h/2+tTy);if(tc.rot)ctx.rotate(tc.rot*Math.PI/180);ctx.scale(scale,scale);ctx.translate(-w/2,-h/2);}
        if(tc.clipShape){
          const p=tc.clipShape.prog;
          ctx.beginPath();
          if(tc.clipShape.type==="wipe"){const dir=tc.clipShape.dir;
            if(dir==="right")ctx.rect(0,0,w*p,h);else if(dir==="down")ctx.rect(0,0,w,h*p);
            else if(dir==="up")ctx.rect(0,h*(1-p),w,h*p);else ctx.rect(w*(1-p),0,w*p,h);}
          else if(tc.clipShape.type==="circle"){ctx.arc(w*(tc.clipShape.cx??0.5),h*(tc.clipShape.cy??0.5),Math.max(w,h)*0.75*p,0,7);}
          else if(tc.clipShape.type==="clock"){ctx.moveTo(w/2,h/2);ctx.arc(w/2,h/2,Math.max(w,h),-Math.PI/2,-Math.PI/2+p*Math.PI*2);ctx.closePath();}
          else if(tc.clipShape.type==="diag"){ctx.moveTo(0,0);ctx.lineTo(w*p,0);ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();}
          else if(tc.clipShape.type==="rect"){const iw=w*p/2,ih=h*p/2;ctx.rect(w/2-iw,h/2-ih,iw*2,ih*2);}
          else if(tc.clipShape.type==="diamond"){ctx.moveTo(w/2,h/2-h*p/2);ctx.lineTo(w/2+w*p/2,h/2);ctx.lineTo(w/2,h/2+h*p/2);ctx.lineTo(w/2-w*p/2,h/2);ctx.closePath();}
          ctx.clip();
        }
        ctx.globalAlpha=alpha;
        if(m&&m.type==="image"){const im=exportImgCache(m);if(im)drawCover(ctx,im,w,h,main.clip);}
        else if(video.readyState>=2&&video.videoWidth){drawCover(ctx,video,w,h,main.clip);}
        ctx.restore();
        /* Phase 3: grading + per-clip effect pixel math, then overlays */
        applyCanvasFramePixels(ctx,w,h,main.clip,t);
        if(tc.overlay){ctx.save();ctx.globalAlpha=clamp(tc.overlay.alpha,0,1);ctx.fillStyle=tc.overlay.color;ctx.fillRect(0,0,w,h);ctx.restore();}
        if(tc.pixel){ /* glitch transitions get a slice-shift pass on the frame — one pixel effect per id, not the same one for all four */
          const fx2={};
          if(tc.pixel==="rgbglitch")fx2.rgbSplit=60;
          else if(tc.pixel==="pixelglitch")fx2.pixelate=60;
          else if(tc.pixel==="signalerror")fx2.signalError=70;
          else fx2.digitalGlitch=60;
          try{const img2=ctx.getImageData(0,0,w,h);applyFxPixels(img2.data,w,h,fx2,t);ctx.putImageData(img2,0,0);}catch(e){}
        }
      }
      } /* end else (single-clip draw) */
      /* Phase 6 — mask + chroma post-pass (single-clip mode only; in split
         screen the cells are drawn by drawSplitCells and these are skipped,
         stated in the export result). Mask fades the frame to black outside
         the shape; chroma replaces keyed pixels with the backdrop frame. */
      if(!splitActive&&!main.clip.disabled){
        if(main.clip.mask&&main.clip.mask.shape&&main.clip.mask.shape!=="none")applyMaskPixels(ctx,w,h,main.clip.mask);
        if(chromaOn&&bgCv)applyChromaPixels(ctx,bgCv,w,h,main.clip.chroma);
      }
      // V2 overlay (picture-in-picture, bottom-right, 40% width) — not affected by the V1 transition; skipped in split-screen mode (cells already show it)
      if(ov&&!splitActive){
        const om=S.media.find(x=>x.id===ov.clip.mediaId);
        const ow=Math.round(w*0.4),oh=Math.round(ow*9/16),ox=w-ow-16,oy=h-oh-16;
        if(om&&om.type==="image"){const im=exportImgCache(om);if(im)ctx.drawImage(im,ox,oy,ow,oh);}
        /* WebCodecs (2026-11-12): v2Video is seeked to the exact frame time
           by prepareFrameMedia and stays paused — draw its current frame. */
        else if(om&&om.type==="video"){
          if(v2Video.readyState>=2&&v2Video.videoWidth)ctx.drawImage(v2Video,ox,oy,ow,oh);
        }
      }
      // text + captions drawn on the export canvas
      ctx.save();ctx.globalAlpha=alpha;
      activeTextAt(t).forEach(c=>{drawAnimatedText(ctx,w,h,c,t,alpha);});
      const cap=activeCaptionAt(t);
      if(cap){const cs=S.capStyle||{};ctx.save();ctx.font=`bold ${Math.round((cs.size||26)*w/1280)}px ${cs.font||"Arial"}`;ctx.textAlign="center";const tw=ctx.measureText(cap.text).width;if(cs.bgOn!==false){ctx.fillStyle=cs.bg||"rgba(0,0,0,.65)";ctx.fillRect(w/2-tw/2-10,h*0.88-28,tw+20,40);}ctx.fillStyle=cs.color||"#fff";ctx.fillText(cap.text,w/2,h*0.88);ctx.restore();}
      ctx.restore();
      ctx.globalAlpha=1;
    }
    if(S.motionBlur&&window.__mbPrev&&window.__mbPrev.width===w){
      ctx.save();ctx.globalAlpha=0.35;ctx.drawImage(window.__mbPrev,0,0);ctx.restore();
    }
    if(S.motionBlur){
      if(!window.__mbPrev||window.__mbPrev.width!==w){window.__mbPrev=document.createElement("canvas");window.__mbPrev.width=w;window.__mbPrev.height=h;}
      window.__mbPrev.getContext("2d").drawImage(canvas,0,0);
    }
    const pct=Math.min(PROG_RENDER,t/total*PROG_RENDER);
    $("expFill").style.width=pct+"%";$("expPct").textContent=Math.round(pct)+"%";
    $("expStatus").textContent=" Rendering "+fmt(t)+" / "+fmt(total)+(note?" · "+note:"")+" · encoding + file writing follow";
  };
  /* Render loop — FIX 2026-11-12 (canvas fps). The old loop seeked the video
     element once per frame and drew immediately — but setting currentTime
     is async, so every draw used the STALE frame from the previous seek.
     The recorder therefore got the same picture ~150 times (7 kb/s,
     ~5 fps of distinct frames) while the code claimed "150 frames". The
     export now plays the media in REAL TIME like the preview does: the
     video element is switched once per clip (seek once + play) and each
     animation frame draws whatever frame it is currently showing, using
     the recorder clock (t0, set at rec.start) as the timeline clock.
     Seeks happen only on clip changes or when drift exceeds 0.35 s, so
     the recorder receives true 30 fps frames and the file duration equals
     the wall-clock export time (within one frame). */
  video.pause();
  /* Frame-accurate media prep: the video elements stay PAUSED; each frame
     seeks them to the exact source time for that timeline frame and waits
     for the seek to finish before drawing. Slow, but the drawn frame
     always matches its timestamp — that is the whole point of this
     rebuild. Seeks only happen on clip changes or when the wanted time
     moved (every frame advances it), never in real time. */
  const seekElTo=(el,time,timeoutMs=1500)=>new Promise(res=>{
    if(!isFinite(time)){res(false);return;}
    if(Math.abs(el.currentTime-time)<=0.02&&el.readyState>=2){res(true);return;}
    let done=false;
    const finish=v=>{if(done)return;done=true;try{el.removeEventListener("seeked",onSeek);}catch(e){}res(v);};
    const onSeek=()=>finish(true);
    el.addEventListener("seeked",onSeek);
    try{el.currentTime=clamp(time,0,el.duration||time);}catch(e){finish(false);return;}
    setTimeout(()=>finish(el.readyState>=2),timeoutMs);
  });
  const waitMediaReady=(el,timeoutMs=3000)=>new Promise(res=>{
    if(el.readyState>=1){res(true);return;}
    let done=false;
    const finish=v=>{if(done)return;done=true;try{el.removeEventListener("loadedmetadata",onM);}catch(e){}res(v);};
    const onM=()=>finish(true);
    el.addEventListener("loadedmetadata",onM);
    setTimeout(()=>finish(el.readyState>=1),timeoutMs);
  });
  let expClipId=null,ovId=null;
  const prepareFrameMedia=async(t)=>{
    const hit=activeVideoAt(t);
    const main=hit&&!hit.overlay?hit:clipOnTrackAt("v1",t);
    const ov=hit&&hit.overlay?hit:null;
    if(main){
      const m=S.media.find(x=>x.id===main.clip.mediaId);
      if(m&&m.type==="video"){
        const want=main.clip.trimIn+sourceTimeForOffset(main.clip,main.offset);
        if(expClipId!==main.clip.id||curMedia!==m){
          /* Snapshot the outgoing clip's last frame for the cross-dissolve
             underlay (drawFrame's blend branch) BEFORE switching sources. */
          if(expClipId&&video.readyState>=2&&video.videoWidth){
            try{
              if(!prevSnap){prevSnap=document.createElement("canvas");prevSnap.width=w;prevSnap.height=h;}
              prevSnap.getContext("2d").drawImage(video,0,0,w,h);
              prevSnapClipId=expClipId;
            }catch(e){prevSnap=null;prevSnapClipId=null;}
          }
          if(curMedia!==m)loadPreview(m);
          video.pause();
          await waitMediaReady(video);
          await seekElTo(video,want);
          expClipId=main.clip.id;
        }else{
          await seekElTo(video,want);
        }
      }else if(m&&m.type==="image"){
        if(curMedia!==m)loadPreview(m);
        if(!video.paused)video.pause();
        expClipId=main.clip.id;
      }else{expClipId=null;}
    }else{
      if(!video.paused)video.pause();
      expClipId=null;
    }
    if(ov){
      const om=S.media.find(x=>x.id===ov.clip.mediaId);
      if(om&&om.type==="video"){
        const want=ov.clip.trimIn+sourceTimeForOffset(ov.clip,ov.offset);
        if(ovId!==ov.clip.id||v2Video._src!==om.url){
          if(v2Video._src!==om.url){v2Video._src=om.url;v2Video.src=om.url;}
          v2Video.pause();
          await waitMediaReady(v2Video);
          await seekElTo(v2Video,want);
          ovId=ov.clip.id;
        }else{
          await seekElTo(v2Video,want);
        }
      }else{ovId=null;}
    }else{
      if(!v2Video.paused)v2Video.pause();
      ovId=null;
    }
    /* Split screen: cells 1+ read their own video elements (splitVideoEl),
       which the old real-time loop left playing. Seek each one to its
       frame time here too, so split-screen exports are frame-accurate. */
    if(S.splitScreen&&S.splitScreen.mode){
      const srcs=splitSourcesAt(t);
      for(let i=1;i<srcs.length;i++){
        const s=srcs[i];
        if(!s||!s.media||s.media.type!=="video")continue;
        const el=splitVideoEl(i-1);
        const want=(s.trimIn||0)+(s.offset||0);
        if(el._src!==s.media.url){el._src=s.media.url;el.src=s.media.url;}
        el.pause();
        await waitMediaReady(el);
        await seekElTo(el,want);
      }
    }
  };
  const keyInt=Math.max(1,Math.round(fps*2)); /* keyframe every ~2 s */
  /* Pre-roll: load + seek the first frame's media before the loop, so the
     export does not open with black frames while the video element loads. */
  await prepareFrameMedia(base);
  /* SEQUENTIAL frame loop — one frame at a time, each with its own
     explicit timestamp (frame n at n/fps seconds). A slow draw only
     delays the next frame; it can never change the file's fps or
     duration. The setTimeout(0) yield keeps Cancel + the UI live. */
  for(let n=0;n<totalFrames;n++){
    if(cancelled)break;
    const t=base+n/fps;
    await prepareFrameMedia(t);
    await drawFrame(t);
    if(cancelled)break;
    try{
      /* Bug 1: the frame carries its OWN duration (exactly 1/fps) — the
         encoder must not have to infer it, or the flushed last chunk
         comes out with a null duration and the muxer throws. Timestamp is
         the frame index times that duration, so both are exact. */
      const vf=new VideoFrame(canvas,{timestamp:n*frameDurUs,duration:frameDurUs});
      vEnc.encode(vf,{keyFrame:n%keyInt===0});
      vf.close();
      framesEncoded++;
    }catch(e){encErr=encErr||e;break;}
    setProg(framesEncoded/totalFrames*PROG_RENDER);
    $("expStatus").textContent=" Rendering (WebCodecs) "+fmt(t)+" / "+fmt(total)+" — frame "+framesEncoded+"/"+totalFrames+" · slow effects only make this take longer, the file stays exact · encoding + file writing follow"+(note?" · "+note:"");
    await new Promise(r=>setTimeout(r,0));
  }
  video.pause();v2Video.pause();
  /* Audio: feed the offline mix to the audio encoder (AAC or Opus — see
     the probe above) in 1024-sample frames, each with its own explicit
     timestamp. This is the 70–80% band: the bar stays honest. */
  if(!cancelled&&audioBuf&&aEnc){
    $("expStatus").textContent=" Encoding audio ("+audioShort+")…";
    const ch0=audioBuf.getChannelData(0),ch1=audioBuf.numberOfChannels>1?audioBuf.getChannelData(1):ch0;
    const FRAME=1024;
    for(let off=0;off<audioBuf.length;off+=FRAME){
      if(cancelled)break;
      setProg(PROG_RENDER+(off/audioBuf.length)*(PROG_AUDIO-PROG_RENDER));
      const n=Math.min(FRAME,audioBuf.length-off);
      const data=new Float32Array(n*2);
      data.set(ch0.subarray(off,off+n),0);
      data.set(ch1.subarray(off,off+n),n);
      try{
        const adTs=Math.round(off/44100*1e6);
        audioDurByTs.set(adTs,EP_AUDIO_DUR_US(n,44100));
        const ad=new AudioData({format:"f32-planar",sampleRate:44100,numberOfFrames:n,numberOfChannels:2,timestamp:adTs});
        aEnc.encode(ad);ad.close();
      }catch(e){encErr=encErr||e;break;}
    }
  }
  if(cancelled){
    try{vEnc.close();}catch(e){}
    try{if(aEnc)aEnc.close();}catch(e){}
    $("btnCancelExport").disabled=true;S.exportOnly=null;
    $("expStatus").textContent="Export cancelled.";
    recordExport({status:"Failed",note:"Cancelled by user",settings:"Canvas export"});
    return false;
  }
  try{await vEnc.flush();}catch(e){encErr=encErr||e;}
  if(aEnc){try{await aEnc.flush();}catch(e){encErr=encErr||e;}}
  try{vEnc.close();}catch(e){}
  try{if(aEnc)aEnc.close();}catch(e){}
  if(encErr){
    return failCanvas("Canvas export (WebCodecs) failed while encoding: "+(encErr&&encErr.message||encErr)+" — try the Video Engine (FFmpeg) instead.");
  }
  let muxedBuf;
  setProg(PROG_WRITE);$("expStatus").textContent=" Writing file ("+codecLabel+")…";
  try{
    muxer.finalize();
    muxedBuf=muxer.target.buffer;
  }catch(e){
    return failCanvas("Could not write the "+container.toUpperCase()+" file: "+(e&&e.message||e)+" — try the Video Engine (FFmpeg) export instead.");
  }
  $("btnCancelExport").disabled=true;S.exportOnly=null;
  const blob=new Blob([muxedBuf],{type:container==="webm"?"video/webm":"video/mp4"});
  if(cancelled){$("expStatus").textContent="Export cancelled.";recordExport({status:"Failed",note:"Cancelled by user",settings:"Canvas export"});return false;}
  /* WEBCODECS (2026-11-12): the file is a real container from the
     VideoEncoder/AudioEncoder + muxer — MP4 (H.264/H.265/VP9 + AAC/Opus)
     or WebM (VP9 + Opus, only when the user picked WebM). The extension
     follows the container, and codecLabel names the codec actually used. */
  const ext=container;
  /* JOB 0: GUARD — a recording far too small for its duration is a failed
     export, never a "Done". A real 5 s 720p clip is hundreds of KB at
     least; the live test's 4.9 KB / 0.03 s file was reported as success.
     Below the floor: report FAILURE with the reason, record it as Failed
     in history, and offer no download link. */
  const minBytes=Math.max(4096,Math.round(total*2000));
  if(blob.size<minBytes){
    const reason="Canvas export encoded only "+(blob.size/1024).toFixed(1)+" KB for "+fmt(total)+" of video ("+framesEncoded+" of "+totalFrames+" frames encoded) — the encode produced essentially nothing. Try again, or use the Video Engine (FFmpeg) instead.";
    $("expStatus").textContent="Export failed: "+reason;
    $("expResult").innerHTML='<p class="hint">Export failed — '+reason+'</p>';
    recordExport({status:"Failed",note:reason,settings:"Canvas export",job:S._lastJob});
    toast("Export failed — the recording came out empty");
    return false;
  }
  const url=URL.createObjectURL(blob);
  /* FIX 2026-11-12 (canvas fps): validate the FILE, not just its size.
     Read the real duration back from the blob and compare the effective
     frame rate (frames actually requested ÷ timeline seconds) with the
     requested FPS. A file that is too short or too slow is a FAILED
     export, never "Done" — the live test's 75 KB / 4.53 s / 4.85 fps
     file was reported as success by the old code. */
  const probeBlobDuration=(blobUrl)=>new Promise(res=>{
    const v=document.createElement("video");v.preload="metadata";v.muted=true;
    const to=setTimeout(()=>{try{v.removeAttribute("src");v.load();}catch(e){}res(null);},6000);
    v.onloadedmetadata=()=>{clearTimeout(to);const d=v.duration;try{v.removeAttribute("src");v.load();}catch(e){}res(isFinite(d)?d:null);};
    v.onerror=()=>{clearTimeout(to);res(null);};
    v.src=blobUrl;
  });
  const effFps=framesEncoded/Math.max(0.01,total);
  setProg(PROG_CHECK);$("expStatus").textContent=" Checking file (duration + frame rate)…";
  const actualDur=await probeBlobDuration(url);
  const durOk=actualDur===null?true:Math.abs(actualDur-total)<=0.3;
  const fpsOk=effFps>=fps*0.8;
  if(!durOk||!fpsOk){
    const reason="Canvas export validation failed: "+(actualDur===null?"could not read the file's duration back":("file duration "+actualDur.toFixed(2)+"s vs timeline "+total.toFixed(2)+"s"))+"; effective frame rate "+effFps.toFixed(1)+" fps vs requested "+fps+" fps ("+framesEncoded+" of "+totalFrames+" frames encoded). The export is unusable — try the Video Engine (FFmpeg) instead, or a lower resolution.";
    $("expStatus").textContent="Export failed: "+reason;
    $("expResult").innerHTML='<p class="hint">Export failed — '+reason+'</p>';
    recordExport({status:"Failed",note:reason,settings:"Canvas export",job:S._lastJob});
    toast("Export failed — validation: wrong duration/frame rate");
    return false;
  }
  const fname=(S.projectName||"editora-export").replace(/[^\w\-]+/g,"-")+"."+ext;
  window.__lastExport={blob,url,name:fname,kind:"video"};
  const revNote=S.clips.some(c=>c.reverse)?" Reversed clips were exported forward in this canvas export — use the Video Engine (FFmpeg) for true reverse.":"";
  const p3Note=(gradeActive()||S.clips.some(c=>Object.keys(c.fx||{}).length))?" Phase 3 grading and per-clip effects are rendered in this export (pixel math).":"";
  /* Phase 6 — state what the new features did in this export. */
  const p6Bits=[];
  if(S.splitScreen&&S.splitScreen.mode)p6Bits.push("Split screen rendered ("+splitCellCount(S.splitScreen.mode)+" videos)");
  if(S.clips.some(c=>c.chroma&&c.chroma.on))p6Bits.push("Chroma key applied (composited over the V2 clip / black backdrop)");
  if(S.clips.some(c=>c.mask&&c.mask.shape&&c.mask.shape!=="none"))p6Bits.push("Clip mask applied");
  if(S.duckOn)p6Bits.push("Audio ducking applied (A2 music under A1 voice)");
  const p6Note=p6Bits.length?" Phase 6: "+p6Bits.join("; ")+".":"";
  const encNote=encNoteParts.length?" "+encNoteParts.join(" "):"";
  setProg(100); /* The bar only reaches 100% HERE — after encoding, muxing, the size guard AND the duration/fps validation all passed. A failed validation never shows 100%. */
  $("expStatus").textContent="Done — "+(blob.size/1048576).toFixed(1)+" MB, "+codecLabel+", "+framesEncoded+" frames @ "+effFps.toFixed(1)+" fps (expected "+fmt(total)+", actual "+(actualDur!==null?actualDur.toFixed(2)+"s":"?")+"), no watermark."+encNote;
  $("expResult").innerHTML=`<a href="${url}" download="${fname}">${epIcon("download")} Download your video (.${ext})</a> <button id="btnShareResult" class="mini">${epIcon("share")} Share</button><p class="hint">Engine: Canvas export (WebCodecs) — ${codecLabel}, ${framesEncoded} frames @ ${effFps.toFixed(1)} fps, expected duration ${fmt(total)}, actual ${actualDur!==null?actualDur.toFixed(2)+"s":"?"}. Validation passed.${encNote}</p>${exportFallbackNote?`<p class="hint">${exportFallbackNote}</p>`:""}${note?`<p class="hint">${note}</p>`:""}${(revNote||p3Note||p6Note)?`<p class="hint">${(revNote+p3Note+p6Note).trim()}</p>`:""}`;
  recordExport({status:"Completed",settings:`Canvas export · ${readExportSettings().label}`,size:blob.size,job:readExportSettings()});
  toast("Export complete — no watermark");
  return true;
}
function drawCover(ctx,src,w,h,clip){
  const sw=src.videoWidth||src.naturalWidth||src.width, sh=src.videoHeight||src.naturalHeight||src.height;
  if(!sw||!sh)return;
  // crop ratio: cut the SOURCE to the target aspect (center crop)
  let sx=0,sy=0,sdw=sw,sdh=sh;
  if(S.cropRatio&&S.cropRatio!=="free"){
    const parts=S.cropRatio.split(":").map(Number);
    if(parts.length===2&&parts[0]&&parts[1]){
      const ta=parts[0]/parts[1],sa=sw/sh;
      if(sa>ta){sdw=sh*ta;sx=(sw-sdw)/2;}else{sdh=sw/ta;sy=(sh-sdh)/2;}
    }
  }
  const s=Math.max(w/sdw,h/sdh),dw=sdw*s,dh=sdh*s;
  const kx=w/1280; // keep position offsets proportional to export width
  const rot=clip&&clip.rotation!==undefined?clip.rotation:S.rotation;
  const sc=clip&&clip.scale!==undefined?clip.scale/100:1;
  ctx.save();ctx.translate(w/2+(S.posX||0)*kx,h/2+(S.posY||0)*kx);ctx.rotate(rot*Math.PI/180);ctx.scale((S.flipH?-1:1)*(S.cropZoom/100)*((S.scaleX||100)/100)*sc,(S.flipV?-1:1)*(S.cropZoom/100)*((S.scaleY||100)/100)*sc);
  ctx.drawImage(src,sx,sy,sdw,sdh,-dw/2,-dh/2,dw,dh);ctx.restore();
}

/* ---------- PROJECTS (IndexedDB + localStorage fallback) ---------- */
let db=null;
function openDB(){return new Promise(res=>{try{const rq=indexedDB.open("editora-pro",2);rq.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains("projects"))d.createObjectStore("projects",{keyPath:"name"});if(!d.objectStoreNames.contains("media"))d.createObjectStore("media",{keyPath:"id"});};rq.onsuccess=e=>{db=e.target.result;res(db);};rq.onerror=()=>res(null);}catch(e){res(null);}});}
function projectData(){return EPProjectStore.stampVideo({name:S.projectName,updated:Date.now(),data:snapshot(),color:S.color,mediaIds:S.media.map(m=>m.id)});}
async function mediaBlob(m){
  try{if(m.file)return m.file;return await fetch(m.url).then(r=>r.blob());}catch(e){return null;}
}
async function saveProject(silent){
  const d=projectData();
  try{localStorage.setItem("editora-current",JSON.stringify(d));}catch(e){}
  if(!silent)markNameSet("editora-manual-saved",S.projectName); // a manual save marks the project as NOT "recovered" anymore
  if(db){
    try{await new Promise((res,rej)=>{const tx=db.transaction("projects","readwrite");tx.objectStore("projects").put(d);tx.oncomplete=res;tx.onerror=rej;});}catch(e){}
    // persist media files so a saved project really reopens (same device, same browser)
    try{
      const tx=db.transaction("media","readwrite");const store=tx.objectStore("media");
      for(const m of S.media){
        const blob=await mediaBlob(m);
        if(blob)store.put({id:m.id,name:m.name,type:m.type,blob,fav:!!m.fav,folderId:m.folderId||null,addedAt:m.addedAt||Date.now()});
      }
    }catch(e){}
  }
  S.dirty=false;const at=$("autosaveText");if(at)at.textContent="● Auto saved: "+new Date().toLocaleTimeString();if(!silent)toast("Project saved");
  renderHomeRecent();
}
/* FIX 2026-11-12 (Issue 3): serialize automatic saves so an older snapshot
   can never overwrite a newer one (saveProject writes the project record
   and then every media blob — a slow save overlapping a later edit could
   otherwise restore stale state). All automatic callers (debounce,
   interval, import) go through this queue; the manual Save button calls
   saveProject() directly. */
let saveQueue=Promise.resolve();
function saveProjectQueued(silent){
  const run=saveQueue.then(()=>saveProject(silent));
  saveQueue=run.catch(()=>{});
  return run;
}
async function openProject(p){
  const v=EPProjectStore.validate(p,EPProjectStore.VIDEO_APP);
  if(!v.ok){toast(v.reason);return;}
  EPProjectStore.migrate(p);
  /* Phase 6 — opening a project that only autosave ever saved is a recovery:
     log it honestly so the Projects screen's recovery history shows it. */
  if(!getNameSet("editora-manual-saved").has(p.name))recordRecovery(p.name,"Recovered project opened — save it manually to keep it");
  // restore media files first (IndexedDB), then the timeline state
  if(db&&p.mediaIds&&p.mediaIds.length){
    try{
      const items=await new Promise(res=>{const tx=db.transaction("media","readonly");const rq=tx.objectStore("media").getAll();rq.onsuccess=()=>res(rq.result||[]);rq.onerror=()=>res([]);});
      const byId={};items.forEach(it=>byId[it.id]=it);
      /* Phase 6 — merge, don't wipe: media already in this session (loaded
         from IndexedDB on startup) stays, so the Media Library keeps
         showing everything imported on this device. Only add missing ones. */
      const haveIds=new Set(S.media.map(m=>m.id));
      for(const id of p.mediaIds){
        const it=byId[id];if(!it||haveIds.has(id))continue;
        const url=URL.createObjectURL(it.blob);
        const m={id:it.id,name:it.name,type:it.type,url,file:it.blob,fav:!!it.fav,folderId:it.folderId||null,addedAt:it.addedAt||0,duration:0};
        S.media.push(m);
        if(it.type==="video"){const v=document.createElement("video");v.preload="metadata";v.src=url;v.onloadedmetadata=()=>{m.duration=round2(v.duration);renderMediaList();updateDuration();};}
        if(it.type==="audio"){const a=new Audio(url);a.onloadedmetadata=()=>{m.duration=round2(a.duration);renderMediaList();};m.audioEl=a;}
      }
    }catch(e){}
  }
  applySnapshot(p.data);
  renderMediaList();renderTimeline();
  showEditor();
  toast("Project opened: "+p.name);
}
async function getAllProjects(){
  let names=[];
  if(db){try{names=await new Promise(res=>{const tx=db.transaction("projects","readonly");const rq=tx.objectStore("projects").getAll();rq.onsuccess=()=>res(rq.result||[]);rq.onerror=()=>res([]);});}catch(e){}}
  if(!names.length){try{const c=localStorage.getItem("editora-current");if(c)names=[JSON.parse(c)];}catch(e){}}
  return names;
}
async function renderHomeRecent(){
  const box=$("homeRecent");if(!box)return;
  const names=await getAllProjects();
  if(!names.length){box.innerHTML='<p class="hint">No saved projects yet — start a new project and it will auto-save here.</p>';return;}
  box.innerHTML="";
  names.sort((a,b)=>(b.updated||0)-(a.updated||0)).slice(0,8).forEach(p=>{
    const r=document.createElement("div");r.className="home-proj";
    r.innerHTML=`<span class="nm">${epIcon("folder")} ${p.name}</span><small>${new Date(p.updated).toLocaleString()}</small><button class="mini">Open</button>`;
    r.querySelector("button").onclick=()=>openProject(p);
    box.appendChild(r);
  });
}
function showHome(){showScreen("home");}
function showEditor(){showScreen("editor");}
/* ---------- PROJECTS SCREEN (Phase 1) ----------
   Filters really filter: All / Video / Photo / Recent (updated in the last
   7 days) / Favorites / Drafts (video projects never exported) /
   Recovered (video projects saved only by autosave, never manually).
   Photo projects are read from the photo editor's own IndexedDB
   ("editora-pro-photo") — same origin, so it is readable here; they open
   in the Photo Editor, which owns their rename/delete. */
async function renderProjects(){
  const box=$("projectList");if(!box)return;
  box.innerHTML="";
  const filter=S.projFilter||"all";
  const video=await getAllProjects();
  const photo=await getPhotoProjects();
  const favSet=getNameSet("editora-fav-projects");
  const expSet=getNameSet("editora-exported-projects");
  const manSet=getNameSet("editora-manual-saved");
  let items=[
    ...video.map(p=>({name:p.name,updated:p.updated||0,kind:"video",data:p})),
    ...photo.map(p=>({name:p.name,updated:p.updated||0,kind:"photo"}))
  ];
  const recentCut=Date.now()-7*864e5;
  items=items.filter(it=>{
    if(filter==="all")return true;
    if(filter==="video")return it.kind==="video";
    if(filter==="photo")return it.kind==="photo";
    if(filter==="recent")return it.updated>recentCut;
    if(filter==="favorites")return favSet.has(it.name);
    if(filter==="drafts")return it.kind==="video"&&!expSet.has(it.name);
    if(filter==="recovered")return it.kind==="video"&&!manSet.has(it.name);
    return true;
  });
  items.sort((a,b)=>b.updated-a.updated);
  if(!items.length){box.innerHTML='<p class="hint">No projects match this filter.</p>';return;}
  items.forEach(it=>{
    const r=document.createElement("div");r.className="proj-row";
    if(it.kind==="photo"){
      /* Phase 6 — photo projects are fully manageable from here (the photo
         DB is same-origin): open, rename, duplicate, delete. Open deep-links
         into the Photo Editor with ?open= so it opens that project directly. */
      r.innerHTML=`<span class="nm">${epIcon("image")} ${it.name}</span><span class="kind">Photo</span><small>${it.updated?new Date(it.updated).toLocaleString():""}</small><button class="mini" data-a="open">Open in Photo Editor</button><button class="mini" data-a="ren">Rename</button><button class="mini" data-a="dup">Duplicate</button><button class="mini" data-a="del" title="Delete">${epIcon("trash")}</button>`;
      const q=a=>r.querySelector(`[data-a="${a}"]`);
      q("open").onclick=()=>{location.href="photo.html?open="+encodeURIComponent(it.name);};
      q("ren").onclick=()=>renamePhotoProject(it);
      q("dup").onclick=()=>duplicatePhotoProject(it);
      q("del").onclick=()=>{if(confirm("Delete photo project “"+it.name+"”? This cannot be undone."))deletePhotoProject(it);};
    }else{
      const fav=favSet.has(it.name);
      r.innerHTML=`<span class="nm">${epIcon("film")} ${it.name}</span><span class="kind">Video</span><small>${it.updated?new Date(it.updated).toLocaleString():""}</small>
        <button class="mini" data-a="open">Open</button><button class="mini" data-a="ren">Rename</button><button class="mini" data-a="dup">Duplicate</button><button class="mini" data-a="fav" title="Favorite">${epIcon("star",16,!!fav)}</button><button class="mini" data-a="bak">Backup</button><button class="mini" data-a="del" title="Delete">${epIcon("trash")}</button>`;
      const q=a=>r.querySelector(`[data-a="${a}"]`);
      q("open").onclick=()=>openProject(it.data);
      q("ren").onclick=()=>renameProject(it);
      q("dup").onclick=()=>duplicateProject(it);
      q("fav").onclick=()=>{toggleNameSet("editora-fav-projects",it.name);renderProjects();};
      q("bak").onclick=()=>downloadText(it.name.replace(/[^\w\-]+/g,"-")+".json",JSON.stringify(it.data,null,2),"application/json");
      q("del").onclick=()=>{if(confirm("Delete project “"+it.name+"”? This cannot be undone."))deleteProject(it);};
    }
    box.appendChild(r);
  });
}
async function deleteProject(it){
  if(db){await new Promise(res=>{const tx=db.transaction("projects","readwrite");tx.objectStore("projects").delete(it.name);tx.oncomplete=res;tx.onerror=res;});}
  ["editora-fav-projects","editora-exported-projects","editora-manual-saved"].forEach(k=>removeNameSet(k,it.name));
  renderProjects();renderHomeRecent();toast("Project deleted");
}
async function duplicateProject(it){
  const c={...it.data,name:it.data.name+" copy",updated:Date.now()};
  if(db){await new Promise(res=>{const tx=db.transaction("projects","readwrite");tx.objectStore("projects").put(c);tx.oncomplete=res;tx.onerror=res;});}
  renderProjects();renderHomeRecent();toast("Duplicated");
}
async function renameProject(it){
  const n=(prompt("New name:",it.name)||"").trim();
  if(!n||n===it.name)return;
  if(db){
    await new Promise(res=>{const tx=db.transaction("projects","readwrite");tx.objectStore("projects").delete(it.name);tx.oncomplete=res;tx.onerror=res;});
    const c={...it.data,name:n,updated:Date.now()};
    await new Promise(res=>{const tx=db.transaction("projects","readwrite");tx.objectStore("projects").put(c);tx.oncomplete=res;tx.onerror=res;});
  }
  ["editora-fav-projects","editora-exported-projects","editora-manual-saved"].forEach(k=>renameNameSet(k,it.name,n));
  if(S.projectName===it.name){S.projectName=n;$("projectName").value=n;}
  renderProjects();renderHomeRecent();toast("Renamed to "+n);
}

/* ---------- PHOTO PROJECTS (Phase 6: rename / duplicate / delete) ----------
   The photo editor's IndexedDB ("editora-pro-photo", key = project name) is
   same-origin, so the Projects screen can manage photo projects directly. */
function openPhotoDB(){return new Promise((res,rej)=>{try{const rq=indexedDB.open("editora-pro-photo",1);rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error);}catch(e){rej(e);}});}
function photoDBGet(pdb,name){return new Promise(res=>{try{const tx=pdb.transaction("projects","readonly");const rq=tx.objectStore("projects").get(name);rq.onsuccess=()=>res(rq.result||null);rq.onerror=()=>res(null);}catch(e){res(null);}});}
function photoDBPut(pdb,name,data){return new Promise(res=>{try{const tx=pdb.transaction("projects","readwrite");tx.objectStore("projects").put(data,name);tx.oncomplete=res;tx.onerror=res;}catch(e){res();}});}
function photoDBDel(pdb,name){return new Promise(res=>{try{const tx=pdb.transaction("projects","readwrite");tx.objectStore("projects").delete(name);tx.oncomplete=res;tx.onerror=res;}catch(e){res();}});}
async function deletePhotoProject(it){
  try{const pdb=await openPhotoDB();await photoDBDel(pdb,it.name);try{pdb.close();}catch(e){}}catch(e){}
  removeNameSet("editora-fav-projects",it.name);
  renderProjects();renderHomeRecent();toast("Photo project deleted");
}
async function renamePhotoProject(it){
  const n=(prompt("New name:",it.name)||"").trim();
  if(!n||n===it.name)return;
  try{
    const pdb=await openPhotoDB();
    const data=await photoDBGet(pdb,it.name);
    if(!data){toast("Could not load that photo project");try{pdb.close();}catch(e){}return;}
    data.projectName=n;data.savedAt=new Date().toISOString();
    await photoDBDel(pdb,it.name);await photoDBPut(pdb,n,data);
    try{pdb.close();}catch(e){}
  }catch(e){toast("Rename failed");return;}
  renameNameSet("editora-fav-projects",it.name,n);
  renderProjects();renderHomeRecent();toast("Renamed to "+n);
}
async function duplicatePhotoProject(it){
  try{
    const pdb=await openPhotoDB();
    const data=await photoDBGet(pdb,it.name);
    if(!data){toast("Could not load that photo project");try{pdb.close();}catch(e){}return;}
    const copy=JSON.parse(JSON.stringify(data));
    copy.projectName=it.name+" copy";copy.savedAt=new Date().toISOString();
    await photoDBPut(pdb,it.name+" copy",copy);
    try{pdb.close();}catch(e){}
  }catch(e){toast("Duplicate failed");return;}
  renderProjects();renderHomeRecent();toast("Duplicated");
}

/* ---------- RECOVERY HISTORY (Phase 6) ----------
   A plain, honest log: every time the app finds a project that only
   autosave ever saved (or opens one), it is recorded here with a
   timestamp. One entry per project+reason, newest first, max 20. */
const REC_KEY="editora-recovery-history";
function getRecoveryHistory(){try{const h=JSON.parse(localStorage.getItem(REC_KEY)||"[]");return Array.isArray(h)?h:[];}catch(e){return[];}}
function recordRecovery(project,reason){
  const h=getRecoveryHistory();
  if(h.some(x=>x.project===project&&x.reason===reason))return;
  h.unshift({date:Date.now(),project,reason});
  try{localStorage.setItem(REC_KEY,JSON.stringify(h.slice(0,20)));}catch(e){}
  renderRecoveryHistory();
}
function renderRecoveryHistory(){
  const box=$("recoveryList");if(!box)return;
  const h=getRecoveryHistory();
  if(!h.length){box.innerHTML='<p class="hint">No recovered projects — nothing was found by autosave after a reload.</p>';return;}
  box.innerHTML="";
  h.forEach(e=>{
    const r=document.createElement("div");r.className="hist-row";
    r.innerHTML=`<span class="nm">${epIcon("rotate-ccw")} ${e.project}</span><small>${e.reason}</small><small>${new Date(e.date).toLocaleString()}</small>`;
    box.appendChild(r);
  });
}
/* On startup, any saved video project that was never saved manually exists
   only because of autosave — that is a recovery, so log it once. */
async function checkRecoveredProjects(){
  const projs=await getAllProjects();
  const manSet=getNameSet("editora-manual-saved");
  projs.forEach(p=>{if(!manSet.has(p.name))recordRecovery(p.name,"Found by autosave after a reload — never saved manually");});
  renderRecoveryHistory();
}
/* FIX 2026-11-12 (Issue 3): the ~1 s debounce in markDirty() is the real
   autosave now; this 5 s interval is only a safety net (was 10 s). The
   saveRunning guard keeps two saves from overlapping. */
setInterval(()=>{if(S.settings.autosave&&S.dirty&&!saveRunning){saveRunning=true;saveProjectQueued(true).finally(()=>{saveRunning=false;});}},5000);
window.addEventListener("beforeunload",()=>{if(S.settings.autosave&&S.dirty){try{localStorage.setItem("editora-current",JSON.stringify(projectData()));}catch(e){}}});

/* ---------- TEMPLATES ---------- */
const VIDEO_TEMPLATES={
  Cinematic:{color:{brightness:98,contrast:115,saturation:90,exposure:0,temperature:10,tint:0,highlights:-10,shadows:15,sharpness:10},fx:{vignette:true,grain:true},text:{font:"Georgia",size:56,color:"#ffffff"}},
  Vlog:{color:{brightness:105,contrast:105,saturation:120,exposure:3,temperature:10,tint:0,highlights:5,shadows:0,sharpness:5},fx:{},text:{font:"Arial",size:44,color:"#ffffff"}},
  Promo:{color:{brightness:103,contrast:120,saturation:145,exposure:2,temperature:5,tint:0,highlights:0,shadows:-5,sharpness:15},fx:{glow:true},text:{font:"Impact",size:64,color:"#fde047"}},
  Reels:{color:{brightness:106,contrast:110,saturation:135,exposure:2,temperature:0,tint:0,highlights:0,shadows:0,sharpness:10},fx:{},text:{font:"Trebuchet MS",size:52,color:"#ffffff"}},
  Tutorial:{color:{brightness:104,contrast:102,saturation:105,exposure:2,temperature:0,tint:0,highlights:0,shadows:0,sharpness:20},fx:{},text:{font:"Verdana",size:40,color:"#ffffff"}},
  Wedding:{color:{brightness:108,contrast:95,saturation:95,exposure:6,temperature:25,tint:10,highlights:5,shadows:10,sharpness:0},fx:{glow:true,vignette:true},text:{font:"Georgia",size:52,color:"#fff7ed"}},
};
function buildTemplateUI(){
  const vt=$("videoTemplates");vt.innerHTML="";
  Object.keys(VIDEO_TEMPLATES).forEach(n=>{const b=document.createElement("button");b.className="fx-btn";b.innerHTML=epIcon("film")+" "+n;b.onclick=()=>{const t=VIDEO_TEMPLATES[n];Object.assign(S.color,PRESETS.Normal,t.color);S.fx=t.fx;S.preset=n;buildColorUI();buildFxUI();applyFilters();$("txtFont").value=t.text.font;$("txtSize").value=t.text.size;$("txtColor").value=t.text.color;pushHistory();toast("Video template applied: "+n);};vt.appendChild(b);});
}

/* ---------- SPEECH RECOGNITION CAPTIONS (browser API, not AI) ----------
   Uses the browser's built-in SpeechRecognition (webkit prefix in Chrome).
   It listens through the MICROPHONE while the video plays — it cannot hear
   the video's own audio track. Each final phrase becomes a caption timed
   from when the phrase started to when it finished. */
let srRec=null, srActive=false, srPhraseStart=0;
function speechSupported(){return !!(window.SpeechRecognition||window.webkitSpeechRecognition);}
function updateSpeechUI(){
  const b=$("btnSpeechCap"),s=$("srStatus");
  if(!b)return;
  if(!speechSupported()){
    b.disabled=true;
    if(s)s.textContent="Browser speech recognition is not available in this browser (Chrome/Edge support it). Manual captions and SRT/VTT import still work.";
  }else if(s){
    s.textContent="Browser speech recognition (on-device/browser engine, not AI). It listens through your microphone while the video plays and adds a caption for each spoken phrase. No audio is uploaded by Editora Pro; the browser may use its own built-in speech service.";
  }
}
function toggleSpeechCaptions(){
  if(srActive){stopSpeechCaptions();return;}
  if(!speechSupported()){toast("Speech recognition is not available in this browser");return;}
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  srRec=new SR();srRec.lang="en-US";srRec.interimResults=true;srRec.continuous=true;
  srActive=true;srPhraseStart=S.curTime;
  $("btnSpeechCap").textContent="■ Stop auto-captions";
  $("srStatus").textContent="Listening through your microphone… play the video and speak; each finished phrase becomes a caption.";
  if(video.paused)togglePlay();
  srRec.onresult=e=>{
    for(let i=e.resultIndex;i<e.results.length;i++){
      const r=e.results[i];
      if(r.isFinal){
        const text=r[0].transcript.trim();
        if(text){
          S.captions.push({id:uid(),text,start:srPhraseStart,end:Math.max(srPhraseStart+0.5,S.curTime),trackId:S.capTrackSel||"main"});
          renderCapList();renderTextOverlay();pushHistory();
        }
        srPhraseStart=S.curTime;
      }
    }
  };
  srRec.onerror=e=>{if(e.error==="not-allowed")toast("Microphone permission denied — auto-captions need mic access");};
  srRec.onend=()=>{if(srActive){try{srRec.start();}catch(err){}}};
  try{srRec.start();}catch(err){stopSpeechCaptions();}
}
function stopSpeechCaptions(){
  srActive=false;
  if(srRec){try{srRec.onend=null;srRec.stop();}catch(e){}srRec=null;}
  const b=$("btnSpeechCap");if(b)b.innerHTML=epIcon("mic")+" Auto-captions from microphone";
  updateSpeechUI();toast("Auto-captions stopped");
}

/* ---------- Phase 0+1: resizable / collapsible editor panels ----------
   Desktop: drag the grip at the panel edge to resize (widths persisted);
   the top-bar buttons collapse/expand each panel. Mobile: the Panels
   button in the transport hides both panels (canvas-first); the grips
   and collapse buttons are hidden by CSS below 900px. */
const PANEL_W_KEY="editora-panel-widths";
let panelW={left:300,right:290};
function applyPanelWidths(){
  if(window.innerWidth<=900)return;
  const mr=$("mainRow");if(!mr)return;
  const l=mr.classList.contains("hide-left")?0:panelW.left;
  const r=mr.classList.contains("hide-right")?0:panelW.right;
  mr.style.gridTemplateColumns=l+"px 1fr "+r+"px";
}
function loadPanelWidths(){
  try{const w=JSON.parse(localStorage.getItem(PANEL_W_KEY)||"null");
    if(w){panelW.left=clamp(w.left||300,220,480);panelW.right=clamp(w.right||290,220,440);}}catch(e){}
  applyPanelWidths();
}
function savePanelWidths(){try{localStorage.setItem(PANEL_W_KEY,JSON.stringify(panelW));}catch(e){}}
function makePanelGrip(panel,side){
  const g=document.createElement("div");g.className="panel-grip";
  g.title="Drag to resize panel";panel.appendChild(g);
  g.addEventListener("pointerdown",e=>{
    e.preventDefault();
    try{g.setPointerCapture(e.pointerId);}catch(_){}
    g.classList.add("dragging");
    const x0=e.clientX,l0=panelW.left,r0=panelW.right;
    const mv=ev=>{const dx=ev.clientX-x0;
      if(side==="left")panelW.left=clamp(l0+dx,220,480);
      else panelW.right=clamp(r0-dx,220,440);
      applyPanelWidths();};
    const up=()=>{g.classList.remove("dragging");
      g.removeEventListener("pointermove",mv);g.removeEventListener("pointerup",up);
      savePanelWidths();};
    g.addEventListener("pointermove",mv);g.addEventListener("pointerup",up);
  });
}
function wirePanels(){
  loadPanelWidths();
  const sb=$("sidebar"),ins=$("inspector"),mr=$("mainRow");
  if(sb)makePanelGrip(sb,"left");
  if(ins)makePanelGrip(ins,"right");
  const bl=$("btnCollapseLeft"),br=$("btnCollapseRight");
  if(bl)bl.addEventListener("click",()=>{if(!mr)return;mr.classList.toggle("hide-left");applyPanelWidths();});
  if(br)br.addEventListener("click",()=>{if(!mr)return;mr.classList.toggle("hide-right");applyPanelWidths();});
  const tp=$("btnTogglePanels");
  if(tp)tp.addEventListener("click",()=>{
    document.body.classList.toggle("panels-hidden");
    tp.classList.toggle("on",document.body.classList.contains("panels-hidden"));
  });
  window.addEventListener("resize",()=>{
    if(window.innerWidth<=900){if(mr)mr.style.gridTemplateColumns="";}
    else applyPanelWidths();
  });
}

/* ---------- WIRING ---------- */
function bind(id,ev,fn){const el=$(id);if(el)el.addEventListener(ev,fn);}
function init(){
  epHydrateIcons(document); /* static HTML icons (icons.js) */
  loadSettings();buildNav();wirePanels();
  S.fps=S.settings.defFps||30; /* project frame rate starts from the export default */
  syncFpsUI();syncRippleUI();
  buildColorUI();buildFxUI();buildPhase3UI();wirePhase3();buildPhase4UI();wirePhase4();loadQueueState();buildPhase6UI();wirePhase6();buildTemplateUI();buildTextPresets();renderTimeline();renderCapList();renderKfList();renderMediaList();pushHistory();
  openDB().then(()=>{renderHomeRecent();renderHomeExported();renderStorage();
    loadAllMediaFromDB();checkRecoveredProjects();
    /* Phase 6 — deep links from the Photo Editor (./index.html#projects,
       #export, …) open that section directly. */
    const deepLink=(location.hash||"").replace(/^#/,"");
    if(["projects","library","templates","export","settings"].includes(deepLink)){showScreen(deepLink);return;}
    // "Reopen the last project" setting — off by default
    if(S.settings.restoreLast){getAllProjects().then(ps=>{if(ps.length){ps.sort((a,b)=>(b.updated||0)-(a.updated||0));openProject(ps[0]);}});}
  });
  syncCapStyleUI();updateSpeechUI();syncSettingsUI();
  applyPreviewQuality(S.settings.previewQuality||"high");
  // home dashboard
  function newProject(){
    S.clips=[];S.textClips=[];S.audioClips=[];S.captions=[];S.keyframes=[];S.markers=[];S.media=[];
    S.projectName="Untitled Project";$("projectName").value=S.projectName;
    S.selClip=null;S.curTime=0;video.removeAttribute("src");video.load();hideImagePreview();
    $("stageEmpty").style.display="";updateDuration();renderAll();pushHistory();
  }
  window.__newProject=newProject;
  bind("btnHome","click",showHome);
  bind("btnHomeVideo","click",showEditor);
  bind("btnHomeNew","click",()=>{newProject();showEditor();});
  bind("btnHomeOpen","click",()=>showScreen("projects"));
  bind("btnHomeSettings","click",()=>showScreen("settings"));
  bind("btnHomeImport","click",()=>{showEditor();$("fileInput").click();});
  bind("btnHomeTemplates","click",()=>showScreen("templates"));
  bind("btnClearCacheHome","click",clearMediaCache);
  // theme
  bind("btnTheme","click",()=>{applyTheme(document.body.dataset.theme==="dark"?"light":"dark");});
  bind("btnUndo","click",undo);bind("btnRedo","click",redo);
  // top toolbar: save / undo / redo / preview quality / library / export center
  bind("btnSaveTop","click",()=>saveProject(false));
  bind("btnUndoTop","click",undo);bind("btnRedoTop","click",redo);
  bind("prevQuality","change",e=>applyPreviewQuality(e.target.value));
  bind("btnLibraryTop","click",()=>showScreen("library"));
  bind("btnExportCenterTop","click",()=>showScreen("export"));
  document.addEventListener("keydown",e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&!e.shiftKey){e.preventDefault();undo();}
    else if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==="y"||(e.shiftKey&&e.key.toLowerCase()==="z"))){e.preventDefault();redo();}
    else if(e.key===" "&&e.target.tagName!=="INPUT"&&e.target.tagName!=="TEXTAREA"){e.preventDefault();togglePlay();}
    else if(e.key.toLowerCase()==="s"&&e.target.tagName!=="INPUT"){splitAtPlayhead();}
    else if(e.key.toLowerCase()==="m"&&e.target.tagName!=="INPUT"&&e.target.tagName!=="TEXTAREA"){addMarker();}
    else if(e.key==="Delete"&&S.selClip){deleteSelected();}
    else if(e.key==="ArrowRight"&&e.target.tagName!=="INPUT"){frameStep(1);}
    else if(e.key==="ArrowLeft"&&e.target.tagName!=="INPUT"){frameStep(-1);}
  });
  // project name
  bind("projectName","change",()=>{S.projectName=$("projectName").value||"Untitled Project";pushHistory();});
  // import
  bind("btnImport","click",()=>$("fileInput").click());
  bind("fileInput","change",e=>{addFiles(e.target.files);e.target.value="";});
  bind("btnImportAudio","click",()=>$("audioInput").click());
  bind("btnImportAudio2","click",()=>$("audioInput").click());
  bind("audioInput","change",e=>{addFiles(e.target.files);e.target.value="";});
  const dz=$("dropZone");
  ["dragover","dragenter"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("over");}));
  ["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("over");}));
  dz.addEventListener("drop",e=>{e.stopPropagation(); /* JOB 0: without this the drop bubbles to the document handler below and the same files are imported twice (duplicate gallery entries + double toast) */
    if(e.dataTransfer.files.length)addFiles(e.dataTransfer.files);});
  document.addEventListener("dragover",e=>e.preventDefault());
  document.addEventListener("drop",e=>{e.preventDefault();if(e.dataTransfer.files.length)addFiles(e.dataTransfer.files);});
  bind("mediaSearch","input",renderMediaList);
  bind("btnFavFilter","click",e=>{e.target.classList.toggle("on");renderMediaList();});
  bind("btnSortName","click",()=>{S.media.sort((a,b)=>a.name.localeCompare(b.name));renderMediaList();toast("Sorted by name");});
  // transport
  bind("btnPlay","click",togglePlay);
  bind("btnPrevFrame","click",()=>frameStep(-1));
  bind("btnNextFrame","click",()=>frameStep(1));
  /* Phase 2 — project frame rate: drives frame stepping + timecode. */
  bind("projFps","change",e=>{S.fps=+e.target.value||30;S.settings.defFps=S.fps;saveSettings();syncFpsUI();pushHistory();toast("Project frame rate: "+S.fps+" fps — frame steps are now 1/"+S.fps+"s");});
  bind("speedSel","change",e=>{S.speed=+e.target.value;video.playbackRate=S.speed;});
  bind("volSlider","input",e=>{video.volume=e.target.value/100;S.vidVol=+e.target.value;$("vidVol").value=S.vidVol;$("vidVolV").textContent=S.vidVol+"%";});
  bind("btnFull","click",()=>{const st=$("videoStage");if(document.fullscreenElement)document.exitFullscreen();else st.requestFullscreen&&st.requestFullscreen();});
  bind("btnSplit","click",splitAtPlayhead);
  bind("btnCut","click",cutSelected);
  bind("btnMerge","click",mergeSelected);
  bind("btnDupClip","click",duplicateSelected);
  bind("btnDelClip","click",deleteSelected);
  /* Phase 2 — ripple delete / insert edit / replace edit (all tap targets) */
  bind("btnRippleDelete","click",deleteSelected);
  bind("btnRippleAll","click",()=>{S.rippleAll=!S.rippleAll;syncRippleUI();pushHistory();toast(S.rippleAll?"Ripple delete now shifts ALL tracks":"Ripple delete now shifts only the same track");});
  bind("btnInsertAtPlayhead","click",()=>{
    const m=S.media.find(x=>x.id===$("insertMediaSel").value);
    if(!m){toast("Pick a media file in the Insert list first");return;}
    toast(insertMediaAtPlayhead(m));
  });
  bind("btnReplaceClip","click",()=>{
    const c=S.selKind==="video"?S.clips.find(x=>x.id===S.selClip):null;
    if(!c){toast("Select a video clip first");return;}
    const m=S.media.find(x=>x.id===$("replaceMediaSel").value);
    if(!m){toast("Pick a replacement in the Replace list first");return;}
    toast(replaceClipWithMedia(c,m));
  });
  bind("btnTrimApply","click",()=>{
    const hit=currentClipAt(S.curTime)||(S.selClip?{clip:S.clips.find(c=>c.id===S.selClip)}:null);
    const c=hit&&hit.clip;if(!c){toast("Select a clip first");return;}
    const ti=+$("trimIn").value,to=+$("trimOut").value;
    const src=sourceDuration(c),maxTrim=src!==null?src:999;
    c.trimIn=round2(clamp(ti,0,c.trimOut));c.trimOut=round2(clamp(to,c.trimIn,maxTrim));
    c.duration=round2(Math.max(0.2,(c.trimOut-c.trimIn)/(c.speed||1)));
    updateDuration();renderTimeline();pushHistory();toast("Trim applied — clip is now "+c.duration.toFixed(1)+"s");
  });
  // trim inputs sync
  [["trimIn","trimInR"],["trimOut","trimOutR"]].forEach(([n,r])=>{bind(n,"input",()=>{$(r).value=$(n).value;});bind(r,"input",()=>{$(n).value=$(r).value;});});
  // timeline head
  bind("tlZoom","input",e=>{S.zoom=+e.target.value;renderTimeline();});
  bind("btnSnap","click",e=>{S.snap=!S.snap;e.target.innerHTML=epIcon("magnet")+" Snap: "+(S.snap?"On":"Off");});
  bind("btnAddTrack","click",()=>{S.textClips.push({id:uid(),text:"New text",start:S.curTime,duration:3,font:"Arial",size:48,color:"#ffffff",bg:"#000000",bgOn:false,outline:true,shadow:true,pos:"bottom",anim:"none"});renderTimeline();renderTextOverlay();pushHistory();toast("Text clip added at playhead");});
  $$(".tlk").forEach(b=>b.addEventListener("click",()=>{const t=b.dataset.track;S.locked[t]=!S.locked[t];epSetIcon(b,S.locked[t]?"lock":"unlock");renderTimeline();toast(t+" track "+(S.locked[t]?"locked":"unlocked"));}));
  // clip props
  bind("btnClipApply","click",()=>{
    const list=S.selKind==="video"?S.clips:S.selKind==="text"?S.textClips:S.audioClips;
    const it=list&&list.find(c=>c.id===S.selClip);if(!it)return;
    if(it.name!==undefined)it.name=$("clipName").value;
    if(it.text!==undefined)it.text=$("clipName").value;
    it.start=round2(Math.max(0,+$("clipStart").value||0));
    /* Phase 2: duration really re-times the clip — video/audio clamped to
       the source length, text/image free. trimOut follows so export sees it. */
    const r=setClipDuration(it,+$("clipDur").value);
    if(r.clamped)toast("Duration clamped to the source length: "+r.applied.toFixed(1)+"s");
    $("clipDur").value=r.applied.toFixed(1);
    it.opacity=+$("clipOpacity").value;it.scale=+$("clipScale").value;it.rotation=+$("clipRot").value;
    updateDuration();renderTimeline();renderTextOverlay();pushHistory();toast("Clip updated — duration "+r.applied.toFixed(1)+"s");
  });
  [["clipOpacity","clipOpacityV","%"],["clipScale","clipScaleV","%"],["clipRot","clipRotV","°"]].forEach(([id,vid,suf])=>bind(id,"input",()=>{$(vid).textContent=$(id).value+suf;}));
  // text tab
  bind("txtSize","input",e=>$("txtSizeV").textContent=e.target.value+"px");
  bind("btnAddText","click",()=>{
    S.textClips.push({id:uid(),text:$("txtContent").value||"Text",start:+$("txtStart").value,duration:+$("txtDur").value,font:$("txtFont").value,size:+$("txtSize").value,color:$("txtColor").value,bg:$("txtBg").value,bgOn:$("txtBgOn").checked,outline:$("txtOutline").checked,shadow:$("txtShadow").checked,pos:$("txtPos").value,anim:$("txtAnim").value,weight:+$("txtWeight").value,spacing:+$("txtSpacing").value,lineHeight:+$("txtLineHeight").value,align:$("txtAlign").value,rot:+$("txtRot").value,opacity:+$("txtOpacity").value,grad:$("txtGrad").checked,grad2:$("txtGrad2").value});
    renderTimeline();renderTextOverlay();pushHistory();toast("Text added to timeline");
  });
  /* Phase 4+5 — Titles quick-adds (lower third / credits / end screen). */
  const addTitleClip=(kind)=>{
    const base={id:uid(),start:S.curTime,duration:kind==="credits"?5:3,font:"Arial",size:48,color:"#ffffff",bg:"#000000",bgOn:false,outline:true,shadow:true,pos:"bottom",anim:"slide"};
    if(kind==="lower"){base.text="Name — Title";base.size=40;base.pos="bottom";base.anim="slide";base.bgOn=true;}
    else if(kind==="credits"){base.text="Credits";base.size=56;base.pos="center";base.anim="fade";base.duration=5;}
    else{base.text="Thanks for watching";base.size=64;base.pos="center";base.anim="fade";base.duration=4;}
    S.textClips.push(base);renderTimeline();renderTextOverlay();pushHistory();
    toast((kind==="lower"?"Lower third":kind==="credits"?"Credits":"End screen")+" added at the playhead — edit the text in the Titles panel");
  };
  bind("btnTitleLower","click",()=>addTitleClip("lower"));
  bind("btnTitleCredits","click",()=>addTitleClip("credits"));
  bind("btnTitleEnd","click",()=>addTitleClip("end"));
  /* Phase 4+5 — Audio panel hub + Assets panel (same tools as the inspector). */
  bind("btnAudioOpen","click",()=>{showInspector("audio");toast("Audio controls — right panel");});
  bind("btnAudioImport","click",()=>$("btnImportAudio").click());
  bind("btnAudioRecord","click",()=>$("btnRecord").click());
  bind("btnAudioSplit","click",()=>$("btnSplitAudio").click());
  bind("btnAudioMerge","click",()=>$("btnMergeAudio").click());
  bind("btnAudioNorm","click",()=>$("btnNormalizeAudio").click());
  bind("btnAudioFxPrev","click",()=>$("btnPreviewAudioFx").click());
  bind("btnAudioSfx","click",()=>{showInspector("audio");const g=$("sfxGrid");if(g)g.scrollIntoView({block:"nearest"});});
  bind("btnAssetsTemplates","click",()=>$("btnTemplates").click());
  bind("btnAssetsAudio","click",()=>{showPanel("audio");showInspector("audio");});
  bind("btnAddCap","click",()=>{S.captions.push({id:uid(),text:"New caption",start:S.curTime,end:S.curTime+2,trackId:S.capTrackSel||"main"});renderCapList();pushHistory();});
  bind("btnImportSRT","click",()=>$("srtInput").click());
  bind("srtInput","change",e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{const parsed=parseSRT(r.result);S.captions=S.captions.concat(parsed);renderCapList();pushHistory();toast(parsed.length+" captions imported");};r.readAsText(f);e.target.value="";});
  bind("btnExportSRT","click",()=>{if(!_capTrackCaps().length){toast("No captions on the selected track yet");return;}downloadText("captions-"+(S.capTrackSel||"main")+".srt",toSRT(),"text/plain");toast("SRT exported for track: "+(S.capTrackSel||"main"));});
  bind("btnExportVTT","click",()=>{if(!_capTrackCaps().length){toast("No captions on the selected track yet");return;}downloadText("captions-"+(S.capTrackSel||"main")+".vtt",toVTT(),"text/vtt");toast("VTT exported for track: "+(S.capTrackSel||"main"));});
  bind("karaokeToggle","change",e=>{S.karaoke=e.target.checked;renderTextOverlay();});
  // caption style controls
  bind("capFont","change",e=>{S.capStyle.font=e.target.value;renderTextOverlay();markDirty();});
  bind("capSize","input",e=>{S.capStyle.size=+e.target.value;$("capSizeV").textContent=e.target.value+"px";renderTextOverlay();markDirty();});
  bind("capColor","input",e=>{S.capStyle.color=e.target.value;renderTextOverlay();markDirty();});
  bind("capBg","input",e=>{S.capStyle.bg=e.target.value;renderTextOverlay();markDirty();});
  bind("capBgOn","change",e=>{S.capStyle.bgOn=e.target.checked;renderTextOverlay();markDirty();});
  bind("capOutline","change",e=>{S.capStyle.outline=e.target.checked;renderTextOverlay();markDirty();});
  bind("capAnim","change",e=>{S.capStyle.anim=e.target.value;renderTextOverlay();markDirty();});
  bind("btnSpeechCap","click",toggleSpeechCaptions);
  // audio tab
  bind("btnRecord","click",startRecording);
  bind("btnStopRec","click",()=>{if(mediaRecorder&&mediaRecorder.state!=="inactive"){mediaRecorder.stop();$("btnRecord").disabled=false;$("btnStopRec").disabled=true;}});
  bind("audVol","input",e=>{S.audVol=+e.target.value;$("audVolV").textContent=S.audVol+"%";});
  bind("vidVol","input",e=>{S.vidVol=+e.target.value;$("vidVolV").textContent=S.vidVol+"%";video.volume=S.vidVol/100;ensureVidGraph();applyVidEQ();});
  bind("audFadeIn","input",e=>{S.fadeIn=+e.target.value;$("audFadeInV").textContent=S.fadeIn+"s";});
  bind("audFadeOut","input",e=>{S.fadeOut=+e.target.value;$("audFadeOutV").textContent=S.fadeOut+"s";});
  bind("btnMute","click",()=>{S.muted=!S.muted;video.muted=S.muted;toast(S.muted?"Muted":"Unmuted");});
  /* Phase 6 — the old handler only set the music volume to 25% (and did
     not affect clips already on the timeline). Now it toggles real
     time-based ducking (A2 music under A1 voice, Canvas export). */
  bind("btnDuck","click",()=>{S.duckOn=!S.duckOn;syncDuckUI();pushHistory();toast(S.duckOn?"Audio ducking ON — A2 music ducks under A1 voice in the Canvas export":"Audio ducking OFF");});
  bind("audBass","input",e=>{S.bass=+e.target.value;$("audBassV").textContent=S.bass+" dB";ensureVidGraph();applyVidEQ();});
  bind("audTreble","input",e=>{S.treble=+e.target.value;$("audTrebleV").textContent=S.treble+" dB";ensureVidGraph();applyVidEQ();});
  bind("audSpeed","change",e=>{S.audioClips.forEach(ac=>{const m=S.media.find(x=>x.id===ac.mediaId);if(m&&m.audioEl)m.audioEl.playbackRate=+e.target.value;});});
  // effects tab — rotation applies to the selected clip when one is selected, else the whole preview
  bind("fxStrength","input",e=>{S.fxStrength=+e.target.value;$("fxStrengthV").textContent=S.fxStrength+"%";applyFilters();});
  const rotateBy=deg=>{
    const c=S.selKind==="video"?S.clips.find(x=>x.id===S.selClip):null;
    if(c){c.rotation=((c.rotation||0)+deg)%360;S.rotation=c.rotation;syncInspectorTransform();}
    else S.rotation=(S.rotation+deg)%360;
    applyFilters();pushHistory();
  };
  bind("btnRot90","click",()=>rotateBy(90));
  bind("btnRot180","click",()=>rotateBy(180));
  bind("btnRot270","click",()=>rotateBy(270));
  bind("btnFlipH","click",()=>{S.flipH=!S.flipH;applyFilters();pushHistory();});
  bind("btnFlipV","click",()=>{S.flipV=!S.flipV;applyFilters();pushHistory();});
  bind("cropRatio","change",e=>{S.cropRatio=e.target.value;applyFilters();pushHistory();toast("Crop ratio "+S.cropRatio+" — applied to preview and export");});
  bind("cropZoom","input",e=>{S.cropZoom=+e.target.value;$("cropZoomV").textContent=S.cropZoom+"%";applyFilters();});
  bind("btnFreeze","click",()=>{
    const hit=activeVideoAt(S.curTime);
    if(!hit||!curMedia||curMedia.type!=="video"){toast("Move the playhead onto a video clip first");return;}
    video.pause();
    const dur=clamp(+$("freezeDur").value||2,0.5,10);
    const c=document.createElement("canvas");c.width=video.videoWidth||1280;c.height=video.videoHeight||720;
    c.getContext("2d").drawImage(video,0,0);
    c.toBlob(b=>{
      if(!b){toast("Could not capture this frame");return;}
      const url=URL.createObjectURL(b);
      const m={id:uid(),name:"Freeze frame "+fmt(S.curTime),type:"image",url,file:b,fav:false,duration:dur};
      S.media.push(m);renderMediaList();
      insertClipAtV1(S.curTime,{id:uid(),mediaId:m.id,name:m.name,track:"v1",start:S.curTime,duration:dur,trimIn:0,trimOut:dur,opacity:100,scale:100,rotation:0,transition:"none",transDur:0.5,speed:1,baseDur:dur,reverse:false});
      toast("Freeze frame inserted at the playhead ("+dur+"s)");
    },"image/png");
  });
  bind("btnReverse","click",()=>{S.reverse=!S.reverse;toast(S.reverse?"Reverse preview ON — press Play to play backwards":"Reverse preview OFF");});
  bind("btnClipReverse","click",()=>{
    const c=S.selKind==="video"?S.clips.find(x=>x.id===S.selClip):null;
    if(!c){toast("Select a video clip first");return;}
    c.reverse=!c.reverse;renderTimeline();pushHistory();
    toast(c.reverse?"Clip marked reversed — true reverse renders in the Video Engine (FFmpeg) export":"Clip reverse off");
  });
  // color tab
  bind("btnSavePreset","click",()=>{const n=prompt("Preset name:","My Look");if(!n)return;PRESETS[n]={...S.color};localStorage.setItem("editora-presets",JSON.stringify(PRESETS));buildColorUI();toast("Preset saved: "+n);});
  bind("btnResetColor","click",()=>{applyPreset("Normal");});
  try{const saved=JSON.parse(localStorage.getItem("editora-presets")||"null");if(saved)Object.assign(PRESETS,saved);}catch(e){}
  // transitions / keyframes
  bind("transType","change",e=>{S.transType=e.target.value;});
  bind("transDur","input",e=>{S.transDur=+e.target.value;$("transDurV").textContent=S.transDur+"s";});
  bind("transEase","change",e=>{S.transEase=e.target.value;});
  bind("transSoft","input",e=>{S.transSoft=+e.target.value;$("transSoftV").textContent=S.transSoft+"%"+(S.transSoft?" (soft edge)":" (hard edge)");});
  bind("btnApplyTrans","click",()=>{const c=S.clips.find(x=>x.id===S.selClip);if(!c){toast("Select a video clip first");return;}
    c.transition=S.transType;c.transDur=S.transDur;c.transDir=S.transDir;c.transSpeed=S.transSpeed;c.transReverse=S.transReverse;c.transIntensity=S.transIntensity;c.transEase=S.transEase;c.transSoft=S.transSoft;
    pushHistory();toast("Transition "+S.transType+" applied to clip ("+S.transDur+"s, "+S.transDir+", "+S.transSpeed+"%, intensity "+S.transIntensity+"%, "+S.transEase+", softness "+S.transSoft+"%"+(S.transReverse?", reversed":"")+")");});
  bind("btnRemoveTrans","click",()=>{
    const c=S.clips.find(x=>x.id===S.selClip);if(!c){toast("Select a video clip first");return;}
    c.transition="none";c.transDur=0.5;delete c.transEase;delete c.transSoft;
    pushHistory();applyTransitionPreview(activeVideoAt(S.curTime));toast("Transition removed from the selected clip");
  });
  bind("btnTransPreview","click",()=>{
    const c=S.clips.find(x=>x.id===S.selClip);if(!c){toast("Select a video clip first, then Apply a transition");return;}
    if(!c.transition||c.transition==="none"){toast("This clip has no transition — pick one and Apply it first");return;}
    const dur=c.transDur||S.transDur||0.5;
    seek(Math.max(0,c.start-0.15));
    if(!S.playing)togglePlay();
    clearTimeout(window.__transPrevT);
    window.__transPrevT=setTimeout(()=>{if(S.playing)togglePlay();},Math.round((dur+0.8)*1000));
    toast("Previewing transition: "+c.transition+" ("+dur+"s)");
  });
  bind("kfVal","input",e=>$("kfValV").textContent=e.target.value);
  bind("btnAddKF","click",()=>{const ease=$("kfEase").value;S.keyframes.push({id:uid(),prop:$("kfProp").value,time:S.curTime,value:+$("kfVal").value,ease,bez:ease==="bezier"?{x1:0.42,y1:0,x2:0.58,y2:1}:undefined});renderKfList();renderKfLane();drawBezier();pushHistory();toast("Keyframe added @ "+fmt(S.curTime)+" ("+ease+")");});
  bind("btnDelKF","click",()=>{S.keyframes=S.keyframes.filter(k=>Math.abs(k.time-S.curTime)>0.15);renderKfList();pushHistory();});
  // timeline head — markers
  bind("btnAddMarker","click",addMarker);
  // export modal
  bind("btnExport","click",openExportModal);
  bind("btnCloseExport","click",()=>closeModal("exportModal"));
  bind("btnDoExport","click",doExport);
  // projects screen (was a modal — now a full screen)
  bind("btnProjects","click",()=>showScreen("projects"));
  bind("btnNewProject","click",()=>{if(confirm("Start a new project? Unsaved changes are kept in the current autosave.")){newProject();}});
  bind("btnSaveProject","click",()=>saveProject(false));
  bind("btnExportProj","click",()=>downloadText((S.projectName||"project").replace(/[^\w\-]+/g,"-")+".json",JSON.stringify(projectData(),null,2),"application/json"));
  bind("btnImportProj","click",()=>$("projInput").click());
  bind("projInput","change",e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const p=JSON.parse(r.result);applySnapshot(p.data);toast("Project restored");}catch(err){toast("Invalid project file");}};r.readAsText(f);e.target.value="";});
  $$("#projFilters [data-pf]").forEach(b=>b.addEventListener("click",()=>{
    S.projFilter=b.dataset.pf;
    $$("#projFilters [data-pf]").forEach(x=>x.classList.toggle("on",x===b));
    renderProjects();
  }));
  // templates screen (was a modal — now a full screen)
  bind("btnTemplates","click",()=>showScreen("templates"));
  // media library screen
  $$("#libTabs [data-lt]").forEach(b=>b.addEventListener("click",()=>{
    S.libTab=b.dataset.lt;
    $$("#libTabs [data-lt]").forEach(x=>x.classList.toggle("on",x===b));
    renderLibrary();
  }));
  bind("libSearch","input",e=>{S.libSearch=e.target.value;renderLibrary();});
  bind("libSort","change",e=>{S.libSort=e.target.value;renderLibrary();});
  bind("btnNewFolder","click",newFolder);
  // export center screen
  bind("btnExpCenterVideo","click",openExportModal);
  bind("btnClearExpHistory","click",()=>{try{localStorage.removeItem(EXP_HIST_KEY);}catch(e){}renderExpHistory();renderHomeExported();toast("Export history cleared");});
  bind("btnClearRecovery","click",()=>{if(confirm("Clear the recovery history list? (Projects themselves are not deleted.)")){try{localStorage.removeItem(REC_KEY);}catch(e){}renderRecoveryHistory();toast("Recovery history cleared");}});
  // settings screen (was a modal — now a full screen)
  bind("btnSettings","click",()=>showScreen("settings"));
  bind("setConfirmDelete","change",e=>{S.settings.confirmDelete=e.target.checked;saveSettings();});
  bind("setRestoreLast","change",e=>{S.settings.restoreLast=e.target.checked;saveSettings();});
  bind("setThemeSel","change",e=>applyTheme(e.target.value));
  bind("btnThemeDark","click",()=>applyTheme("dark"));
  bind("btnThemeLight","click",()=>applyTheme("light"));
  bind("setLang","change",e=>{S.settings.language=e.target.value;saveSettings();toast("Language: English (only language available)");});
  bind("setAutosave","change",e=>{S.settings.autosave=e.target.checked;saveSettings();});
  bind("setAutosaveInterval","change",e=>{S.settings.autosaveInterval=+e.target.value;saveSettings();});
  bind("setDefRes","change",e=>{S.settings.defRes=e.target.value;saveSettings();});
  bind("setDefFps","change",e=>{S.settings.defFps=+e.target.value;saveSettings();});
  bind("setDefFmt","change",e=>{S.settings.defFmt=e.target.value;saveSettings();});
  bind("setPreviewQuality","change",e=>applyPreviewQuality(e.target.value));
  bind("btnClearData","click",()=>{if(confirm("Clear ALL saved projects and presets on this device?")){localStorage.clear();if(db){db.close();indexedDB.deleteDatabase("editora-pro");}try{indexedDB.deleteDatabase("editora-pro-photo");}catch(e){}loadSettings();syncSettingsUI();applyPreviewQuality(S.settings.previewQuality||"high");renderHomeRecent();renderHomeExported();toast("All local data cleared");}});
  bind("btnClearCache","click",clearMediaCache);
  bind("btnBackupAll","click",backupAllProjects);
  bind("btnImportAll","click",()=>$("importAllInput").click());
  bind("importAllInput","change",e=>{const f=e.target.files[0];e.target.value="";if(f)importAllProjects(f);});
  applyFilters();
}
function renderAll(){renderMediaList();renderTimeline();renderCapList();renderKfList();renderKfLane();renderSpeedKfList();renderTextOverlay();updateDuration();applyFilters();renderMarkers();
  /* Phase 6 — keep the Pro-panel state in step after a restore / undo. */
  if(typeof syncSplitUI==="function")syncSplitUI();
  if(typeof syncProxyUI==="function")syncProxyUI();
  if(typeof syncDuckUI==="function")syncDuckUI();
  if(typeof window.__syncChromaBtn==="function")window.__syncChromaBtn();
}
document.addEventListener("DOMContentLoaded",init);

/* ================================================================
   PHASE 1 (2026-11-12) — App navigation, Projects, Media Library,
   Templates, Export Center, Settings, markers, export history.
   APK target: everything here runs inside the app (Capacitor WebView);
   no desktop-only path — every action also has a tap target, no
   window.open, no localhost server, storage is on-device IndexedDB /
   localStorage. Nothing here depends on the browser site.
   ================================================================ */
/* ---------- small localStorage name-sets (favorites / exported / manual-saved) ---------- */
function getNameSet(key){try{return new Set(JSON.parse(localStorage.getItem(key)||"[]"));}catch(e){return new Set();}}
function saveNameSet(key,set){try{localStorage.setItem(key,JSON.stringify([...set]));}catch(e){}}
function markNameSet(key,name){const s=getNameSet(key);s.add(name);saveNameSet(key,s);}
function toggleNameSet(key,name){const s=getNameSet(key);if(s.has(name))s.delete(name);else s.add(name);saveNameSet(key,s);}
function removeNameSet(key,name){const s=getNameSet(key);s.delete(name);saveNameSet(key,s);}
function renameNameSet(key,oldN,newN){const s=getNameSet(key);if(s.has(oldN)){s.delete(oldN);s.add(newN);saveNameSet(key,s);}}

/* ---------- settings (persisted, applied immediately) ---------- */
const SETTINGS_KEY="editora-settings";
function loadSettings(){
  try{const s=JSON.parse(localStorage.getItem(SETTINGS_KEY)||"null");if(s)Object.assign(S.settings,s);}catch(e){}
  if(S.settings.theme)document.body.dataset.theme=S.settings.theme;
}
function saveSettings(){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(S.settings));}catch(e){}}
function applyTheme(t){
  S.settings.theme=t;document.body.dataset.theme=t;saveSettings();syncSettingsUI();
}
function applyPreviewQuality(q){
  S.settings.previewQuality=q;saveSettings();
  const st=$("videoStage");
  if(st)st.style.maxWidth=q==="low"?"480px":q==="medium"?"720px":"100%";
  syncSettingsUI();applyFilters();
}
function syncSettingsUI(){
  const set=(id,v)=>{const el=$(id);if(!el)return;if(el.type==="checkbox")el.checked=!!v;else el.value=v;};
  set("setConfirmDelete",S.settings.confirmDelete);
  set("setRestoreLast",S.settings.restoreLast);
  set("setThemeSel",S.settings.theme||"dark");
  set("setLang",S.settings.language||"en");
  set("setDefRes",S.settings.defRes);
  set("setDefFps",String(S.settings.defFps));
  set("setDefFmt",S.settings.defFmt||"mp4");
  set("setAutosave",S.settings.autosave);
  set("setAutosaveInterval",String(S.settings.autosaveInterval||1));
  set("setPreviewQuality",S.settings.previewQuality||"high");
  set("prevQuality",S.settings.previewQuality||"high");
  const av=$("appVersion");if(av)av.textContent=APP_VERSION;
  const td=$("btnThemeDark"),tl=$("btnThemeLight");
  if(td)td.classList.toggle("on",(S.settings.theme||"dark")==="dark");
  if(tl)tl.classList.toggle("on",S.settings.theme==="light");
  const bt=$("btnTheme");if(bt)epSetIcon(bt,(S.settings.theme||"dark")==="dark"?"moon":"sun");
}

/* ---------- app navigation: Home / Video Editor / Projects / Library / Templates / Export Center / Settings ---------- */
const SCREENS={home:"homeView",editor:"app",projects:"projectsView",library:"libraryView",templates:"templatesView",export:"exportView",settings:"settingsView"};
function buildNav(){
  const html=`<button data-screen="home">${epIcon("home")} Home</button><button data-screen="editor">${epIcon("clapperboard")} Video Editor</button><button data-screen="projects">${epIcon("folder")} Projects</button><button data-screen="library">${epIcon("image")} Media Library</button><button data-screen="templates">${epIcon("sparkles")} Templates</button><button data-screen="export">${epIcon("download")} Export Center</button><button data-screen="settings">${epIcon("settings")} Settings</button><a href="photo.html" class="navlink">${epIcon("brush")} Photo Editor</a>`;
  $$("[data-nav]").forEach(n=>{n.innerHTML=html;});
  document.addEventListener("click",e=>{
    const b=e.target.closest?e.target.closest("[data-screen]"):null;
    if(b)showScreen(b.dataset.screen);
  });
}
function showScreen(name){
  const id=SCREENS[name];if(!id||!$(id))return;
  Object.values(SCREENS).forEach(v=>{const el=$(v);if(el)el.hidden=(v!==id);});
  $$(".appnav [data-screen]").forEach(b=>b.classList.toggle("on",b.dataset.screen===name));
  if(name==="home"){renderHomeRecent();renderHomeExported();renderStorage();}
  if(name==="projects"){renderProjects();renderRecoveryHistory();}
  if(name==="library")renderLibrary();
  if(name==="templates"){buildTemplateUI();buildTitleStyles();buildCapStyles();buildTextPresets();if(typeof buildPhase6UI==="function")buildPhase6UI();}
  if(name==="export"){renderExpHistory();if(typeof renderQueue==="function")renderQueue();}
  if(name==="settings"){syncSettingsUI();renderStorage();renderCacheInfo();}
  try{window.scrollTo(0,0);}catch(e){}
}

/* ---------- export history (localStorage, written on every export) ---------- */
const EXP_HIST_KEY="editora-export-history";
function getExportHistory(){try{return JSON.parse(localStorage.getItem(EXP_HIST_KEY)||"[]");}catch(e){return[];}}
function recordExport(e){
  const h=getExportHistory();
  h.unshift({id:uid(),name:e.name||S.projectName||"Untitled Project",settings:e.settings||"",size:e.size||0,date:Date.now(),status:e.status||"Completed",note:e.note||"",job:("job" in e)?e.job:(S._lastJob||null)});
  try{localStorage.setItem(EXP_HIST_KEY,JSON.stringify(h.slice(0,50)));}catch(_){}
  if(e.status==="Completed")markNameSet("editora-exported-projects",S.projectName);
  renderHomeExported();renderExpHistory();
}
function renderHomeExported(){
  const box=$("homeExported");if(!box)return;
  const h=getExportHistory().slice(0,5);
  if(!h.length){box.innerHTML='<p class="hint">No exports yet — export a video and it will appear here.</p>';return;}
  box.innerHTML="";
  h.forEach(e=>{
    const r=document.createElement("div");r.className="home-proj";
    r.innerHTML=`<span class="nm">${e.status==="Completed"?epIcon("check-circle"):epIcon("x-circle")} ${e.name}</span><small>${e.settings||""} · ${new Date(e.date).toLocaleString()}</small>`;
    box.appendChild(r);
  });
}
function renderExpHistory(){
  const box=$("expHistoryList");if(!box)return;
  const h=getExportHistory();
  if(!h.length){box.innerHTML='<p class="hint">No exports yet — export a video and it will appear here.</p>';return;}
  box.innerHTML="";
  h.forEach(e=>{
    const r=document.createElement("div");r.className="hist-row";
    r.innerHTML=`<span class="nm">${e.status==="Completed"?epIcon("check-circle"):epIcon("x-circle")} ${e.name}</span><small>${e.settings||""}</small><small>${e.size?(e.size/1048576).toFixed(1)+" MB":"—"}</small><small>${new Date(e.date).toLocaleString()}</small><b>${e.status}</b>`;
    if(e.note){const n=document.createElement("small");n.textContent=e.note;r.appendChild(n);}
    /* Phase 6 — per-entry actions: re-export (same settings, when the job
       was recorded) and delete. Failed entries keep their reason (note). */
    if(e.job){
      const re=document.createElement("button");re.className="mini";re.innerHTML=epIcon("refresh-cw")+" Re-export";
      re.onclick=()=>{applyExportJobToDialog(e.job);openExportModal();toast("Export settings restored from history — press Start Export");};
      r.appendChild(re);
    }
    const del=document.createElement("button");del.className="mini";del.innerHTML=epIcon("trash");
    del.title="Delete this history entry";
    del.onclick=()=>{
      try{localStorage.setItem(EXP_HIST_KEY,JSON.stringify(getExportHistory().filter(x=>x.id!==e.id)));}catch(_){}
      renderExpHistory();renderHomeExported();
    };
    r.appendChild(del);
    box.appendChild(r);
  });
}
/* Phase 6 — put a recorded export job's settings back into the dialog. */
function applyExportJobToDialog(job){
  if(!job)return;
  const set=(id,v)=>{const el=$(id);if(el)el.value=v;};
  set("expRes",job.res);set("expFps",String(job.fps));set("expFmt",job.fmt);
  if(job.bitrate&&[2500000,5000000,10000000,20000000].includes(job.bitrate))set("expBitrate",String(job.bitrate));
  else{set("expBitrate","custom");set("expBitrateCustom",String((job.bitrate||5000000)/1000000));}
  set("expEngine",job.engine||"auto");
  if(job.res==="custom"){set("expCustomW",String(job.w||1280));set("expCustomH",String(job.h||720));}
  if(job.codec==="h265"&&$("expCodec").querySelector('option[value="h265"]'))set("expCodec","h265");
  syncExportDialogRows();
}
function syncExportDialogRows(){
  const cr=$("expCustomRow");if(cr)cr.hidden=$("expRes").value!=="custom";
  const br=$("expBitrateRow");if(br)br.hidden=$("expBitrate").value!=="custom";
}

/* ---------- photo projects (read-only from the photo editor's own DB) ---------- */
async function getPhotoProjects(){
  try{
    const pdb=await new Promise((res,rej)=>{const rq=indexedDB.open("editora-pro-photo",1);
      /* Create the store on first open, exactly like the Photo Editor does —
         without this, opening the DB here would leave an empty v1 database
         whose store could never be created afterwards. */
      rq.onupgradeneeded=e=>{if(!e.target.result.objectStoreNames.contains("projects"))e.target.result.createObjectStore("projects");};
      rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error);});
    if(!pdb.objectStoreNames.contains("projects")){
      /* A previous opener left an empty v1 database with no store: drop it
         and reopen so the store is created — otherwise the Photo Editor
         could never save again in this browser. */
      const dbName=pdb.name;pdb.close();
      await new Promise(res=>{const del=indexedDB.deleteDatabase(dbName);del.onsuccess=res;del.onerror=res;});
      return getPhotoProjects();
    }
    const keys=await new Promise(res=>{const tx=pdb.transaction("projects","readonly");const rq=tx.objectStore("projects").getAllKeys();rq.onsuccess=()=>res(rq.result||[]);rq.onerror=()=>res([]);});
    const out=[];
    for(const k of keys){
      if(k==="__autosave__")continue;
      const data=await new Promise(res=>{const tx=pdb.transaction("projects","readonly");const rq=tx.objectStore("projects").get(k);rq.onsuccess=()=>res(rq.result||null);rq.onerror=()=>res(null);});
      out.push({name:String(k),updated:data&&data.savedAt?Date.parse(data.savedAt)||0:0});
    }
    /* Close the connection: leaving it open would block a later
       deleteDatabase (e.g. Settings > Clear all saved data). */
    try{pdb.close();}catch(e){}
    return out;
  }catch(e){return[];}
}

/* ---------- media library + custom folders ---------- */
const FOLDER_KEY="editora-media-folders";
function getFolders(){try{return JSON.parse(localStorage.getItem(FOLDER_KEY)||"[]");}catch(e){return[];}}
function saveFolders(f){try{localStorage.setItem(FOLDER_KEY,JSON.stringify(f));}catch(e){}}
function renderLibrary(){
  const grid=$("libGrid");if(!grid)return;
  const tab=S.libTab||"all";
  const fb=$("folderBar");if(fb)fb.hidden=tab!=="folders";
  if(tab==="folders")renderFolderChips();
  let items=[...S.media];
  if(tab==="video"||tab==="image"||tab==="audio")items=items.filter(m=>m.type===tab);
  else if(tab==="favorites")items=items.filter(m=>m.fav);
  else if(tab==="recent")items=[...items].sort((a,b)=>(b.addedAt||0)-(a.addedAt||0)).slice(0,20);
  else if(tab==="folders")items=S.libFolder?items.filter(m=>m.folderId===S.libFolder):items.filter(m=>m.folderId);
  const q=(S.libSearch||"").toLowerCase();
  if(q)items=items.filter(m=>m.name.toLowerCase().includes(q));
  if(S.libSort==="name")items.sort((a,b)=>a.name.localeCompare(b.name));
  else if(S.libSort==="type")items.sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name));
  else items.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
  grid.innerHTML="";
  if(!items.length){grid.innerHTML='<p class="hint">No media matches.</p>';return;}
  const folders=getFolders();
  items.forEach(m=>{
    const d=document.createElement("div");d.className="media-item";
    const thumb=m.type==="image"?`<img src="${m.url}" alt="">`:m.type==="video"?`<video src="${m.url}" muted preload="metadata" aria-hidden="true" tabindex="-1"></video>`:`<div class="aud-ico">${epIcon("music",26)}</div>`;
    const folderOpts=['<option value="">No folder</option>'].concat(folders.map(f=>`<option value="${f.id}"${m.folderId===f.id?" selected":""}>${f.name}</option>`)).join("");
    d.innerHTML=`<div class="thumb">${thumb}${m.duration?`<span class="dur-badge">${fmt(m.duration)}</span>`:""}</div><div class="mi-name">${m.name}</div><div class="mi-meta">${m.type}${m.duration?" · "+fmt(m.duration):""}${m.addedAt?" · "+new Date(m.addedAt).toLocaleDateString():""}</div>
      <div class="mi-actions"><button class="mini" data-act="fav" title="Favorite">${epIcon("star",16,!!m.fav)}</button>
      <button class="mini" data-act="add" title="Add to timeline">+ Timeline</button>
      <button class="mini" data-act="del" title="Delete">${epIcon("trash")}</button></div>
      <label style="margin:0">${epIcon("folder")} <select class="lib-folder-sel" data-id="${m.id}">${folderOpts}</select></label>`;
    d.addEventListener("click",e=>{
      if(e.target.classList.contains("lib-folder-sel"))return;
      const act=e.target.dataset&&e.target.dataset.act;
      if(act==="fav"){m.fav=!m.fav;renderLibrary();renderMediaList();markDirty();}
      else if(act==="del"){if(confirm("Remove “"+m.name+"” from the library?")){S.media=S.media.filter(x=>x.id!==m.id);deleteMediaFromDB(m.id);renderLibrary();renderMediaList();markDirty();}}
      else if(act==="add"){addToTimeline(m);}
      else if(m.type==="video"||m.type==="image"){loadPreview(m);showEditor();}
    });
    const sel=d.querySelector(".lib-folder-sel");
    sel.addEventListener("change",()=>{m.folderId=sel.value||null;markDirty();toast(m.folderId?"Moved to folder":"Removed from folder");});
    grid.appendChild(d);
  });
}
function renderFolderChips(){
  const box=$("folderChips");if(!box)return;
  box.innerHTML="";
  const folders=getFolders();
  const all=document.createElement("button");all.className="mini folder-chip"+(!S.libFolder?" on":"");all.textContent="All folders";
  all.onclick=()=>{S.libFolder=null;renderLibrary();};
  box.appendChild(all);
  folders.forEach(f=>{
    const chip=document.createElement("span");chip.className="mini folder-chip"+(S.libFolder===f.id?" on":"");
    chip.style.cssText="display:inline-flex;align-items:center;gap:4px";
    chip.innerHTML=`<span>${epIcon("folder")} ${f.name}</span><button class="fx" title="Delete folder">×</button>`;
    chip.querySelector("span").addEventListener("click",()=>{S.libFolder=f.id;renderLibrary();});
    chip.querySelector("span").addEventListener("dblclick",()=>{
      const n=(prompt("Rename folder:",f.name)||"").trim();
      if(n&&n!==f.name){f.name=n;saveFolders(folders);renderLibrary();toast("Folder renamed");}
    });
    chip.querySelector(".fx").addEventListener("click",()=>{
      if(!confirm("Delete folder “"+f.name+"”? Media inside it stays in the library."))return;
      S.media.forEach(m=>{if(m.folderId===f.id)m.folderId=null;});
      saveFolders(folders.filter(x=>x.id!==f.id));
      if(S.libFolder===f.id)S.libFolder=null;
      markDirty();renderLibrary();toast("Folder deleted");
    });
    box.appendChild(chip);
  });
  if(!folders.length)box.innerHTML+='<span class="hint">No folders yet — create one below.</span>';
}
function newFolder(){
  const n=(prompt("Folder name:","My Folder")||"").trim();
  if(!n)return;
  const folders=getFolders();
  folders.push({id:uid(),name:n});
  saveFolders(folders);renderLibrary();toast("Folder created: "+n);
}

/* ---------- templates: title styles + caption styles (real, in-code) ---------- */
const TITLE_STYLES={
  "Bold Lower Third":{font:"Arial",size:44,color:"#ffffff",bg:"#000000",bgOn:true,outline:true,shadow:true,pos:"bottom",anim:"slide"},
  "Big Impact":{font:"Impact",size:72,color:"#fde047",bg:"#000000",bgOn:false,outline:true,shadow:true,pos:"center",anim:"pop"},
  "Elegant Serif":{font:"Georgia",size:52,color:"#fff7ed",bg:"#000000",bgOn:false,outline:false,shadow:true,pos:"center",anim:"fade"},
  "Neon Pop":{font:"Trebuchet MS",size:60,color:"#22d3ee",bg:"#000000",bgOn:true,outline:true,shadow:true,pos:"top",anim:"pop"},
};
const CAP_STYLES={
  "Classic White":{font:"Arial",size:22,color:"#ffffff",bg:"#000000",bgOn:true,outline:true,anim:"none"},
  "Yellow Highlight":{font:"Arial",size:24,color:"#fde047",bg:"#000000",bgOn:true,outline:true,anim:"none"},
  "Minimal":{font:"Verdana",size:20,color:"#ffffff",bg:"#000000",bgOn:false,outline:false,anim:"fade"},
  "Bold Outline":{font:"Impact",size:28,color:"#ffffff",bg:"#000000",bgOn:false,outline:true,anim:"pop"},
};
function buildTitleStyles(){
  const box=$("titleStyles");if(!box)return;box.innerHTML="";
  Object.keys(TITLE_STYLES).forEach(n=>{
    const b=document.createElement("button");b.className="fx-btn";b.innerHTML=epIcon("type")+" "+n;
    b.onclick=()=>applyTitleStyle(n);
    box.appendChild(b);
  });
}
function buildCapStyles(){
  const box=$("capStyles");if(!box)return;box.innerHTML="";
  Object.keys(CAP_STYLES).forEach(n=>{
    const b=document.createElement("button");b.className="fx-btn";b.innerHTML=epIcon("message-square")+" "+n;
    b.onclick=()=>applyCapStyle(n);
    box.appendChild(b);
  });
}
function applyTitleStyle(name){
  const t=TITLE_STYLES[name];if(!t)return;
  $("txtFont").value=t.font;$("txtSize").value=t.size;$("txtSizeV").textContent=t.size+"px";
  $("txtColor").value=t.color;$("txtBg").value=t.bg;$("txtBgOn").checked=t.bgOn;
  $("txtOutline").checked=t.outline;$("txtShadow").checked=t.shadow;$("txtPos").value=t.pos;$("txtAnim").value=t.anim;
  const c=S.selKind==="text"?selectedClipObj():null;
  if(c){Object.assign(c,{font:t.font,size:t.size,color:t.color,bg:t.bg,bgOn:t.bgOn,outline:t.outline,shadow:t.shadow,pos:t.pos,anim:t.anim});renderTimeline();renderTextOverlay();pushHistory();toast("Title style applied to selected text: "+name);}
  else toast("Title style set — it will be used for your next text clip");
}
function applyCapStyle(name){
  const t=CAP_STYLES[name];if(!t)return;
  Object.assign(S.capStyle,t);syncCapStyleUI();renderTextOverlay();markDirty();
  toast("Caption style applied: "+name);
}

/* ---------- timeline markers (M key + button, persisted in the project) ----------
   Phase 6: markers have a colour (cycles through a palette) and a name.
   Tap a chip to jump to it; tap its colour dot to cycle the colour; double-tap
   a chip to rename it; × deletes it. */
const MARKER_COLORS=["#22d3ee","#f59e0b","#4ade80","#f472b6","#a78bfa","#f87171"];
function addMarker(){
  const color=MARKER_COLORS[(S.markers||[]).length%MARKER_COLORS.length];
  S.markers.push({id:uid(),time:S.curTime,label:"Marker "+(S.markers.length+1),color});
  renderMarkers();pushHistory();toast("Marker added at "+fmt(S.curTime)+" (M)");
}
function renderMarkers(){
  const ruler=$("tlRuler");if(!ruler)return;
  $$(".marker-flag",ruler).forEach(el=>el.remove());
  (S.markers||[]).forEach(m=>{
    if(!m.color)m.color=MARKER_COLORS[0];
    const f=document.createElement("span");f.className="marker-flag";f.style.left=(m.time*PX_PER_SEC())+"px";
    f.style.background=m.color;f.style.borderRadius="3px";
    f.title=m.label+" — "+fmt(m.time)+" (tap to jump)";f.innerHTML=epIcon("map-pin",11);
    f.addEventListener("click",e=>{e.stopPropagation();seek(m.time);});
    ruler.appendChild(f);
  });
  const row=$("markerRow");if(!row)return;
  row.innerHTML="";
  if(!(S.markers||[]).length){row.innerHTML='<span class="hint">No markers yet — press M or the Marker button to add one at the playhead.</span>';return;}
  S.markers.forEach(m=>{
    if(!m.color)m.color=MARKER_COLORS[0];
    const chip=document.createElement("button");chip.className="mini marker-chip";
    chip.innerHTML=`<span class="dot" style="background:${m.color}"></span>${epIcon("map-pin",12)} ${m.label} · ${fmt(m.time)} <span title="Cycle marker colour">${epIcon("palette",12)}</span> <span title="Delete marker">×</span>`;
    const spans=chip.querySelectorAll("span");
    chip.addEventListener("click",e=>{
      if(e.target===spans[2]){S.markers=S.markers.filter(x=>x.id!==m.id);renderMarkers();pushHistory();}
      else if(e.target===spans[1]){const i=MARKER_COLORS.indexOf(m.color);m.color=MARKER_COLORS[(i+1)%MARKER_COLORS.length];renderMarkers();pushHistory();}
      else seek(m.time);
    });
    chip.addEventListener("dblclick",()=>{
      const n=(prompt("Marker name:",m.label)||"").trim();
      if(n){m.label=n;renderMarkers();pushHistory();}
    });
    row.appendChild(chip);
  });
}

/* ---------- storage meter + media cache ---------- */
async function renderStorage(){
  let txt="Storage info is not available in this browser.";
  try{
    const est=await navigator.storage.estimate();
    const used=est.usage||0,quota=est.quota||0;
    const usedMB=(used/1048576).toFixed(1);
    const quotaTxt=quota?(quota/1073741824).toFixed(1)+" GB":"unknown size";
    txt=`Using ${usedMB} MB of ${quotaTxt} available on this device.`;
    const bar=$("storageMeterBar");if(bar)bar.style.width=quota?Math.min(100,used/quota*100)+"%":"0%";
  }catch(e){}
  const st=$("storageMeterText");if(st)st.textContent=txt;
  const si=$("storageInfo");if(si)si.textContent=txt+" Projects, media and settings are stored on this device only (IndexedDB / localStorage). Nothing is uploaded.";
}
async function renderCacheInfo(){
  const ci=$("cacheInfo");if(!ci)return;
  let total=0;
  if(db){
    try{total=await new Promise(res=>{const tx=db.transaction("media","readonly");const rq=tx.objectStore("media").getAll();rq.onsuccess=()=>res((rq.result||[]).length);rq.onerror=()=>res(0);});}catch(e){}
  }
  ci.textContent="Media cache: "+total+" saved media file(s) on this device; "+S.media.length+" in the current project.";
}
async function clearMediaCache(){
  let removed=0;
  if(db){
    const projs=await getAllProjects();
    const used=new Set();projs.forEach(p=>(p.mediaIds||[]).forEach(id=>used.add(id)));
    const items=await new Promise(res=>{const tx=db.transaction("media","readonly");const rq=tx.objectStore("media").getAll();rq.onsuccess=()=>res(rq.result||[]);rq.onerror=()=>res([]);});
    const orphans=items.filter(it=>!used.has(it.id));
    if(orphans.length){
      await new Promise(res=>{const tx=db.transaction("media","readwrite");const st=tx.objectStore("media");orphans.forEach(it=>st.delete(it.id));tx.oncomplete=res;tx.onerror=res;});
      removed=orphans.length;
    }
  }
  Object.keys(_imgCache).forEach(k=>delete _imgCache[k]);
  renderCacheInfo();renderStorage();
  toast(removed?removed+" unused cached media file(s) removed":"Media cache is already clean");
}

/* ---------- project backup: all projects ---------- */
async function backupAllProjects(){
  const projs=await getAllProjects();
  if(!projs.length){toast("No saved projects to back up");return;}
  downloadText("editora-all-projects.json",JSON.stringify(projs,null,2),"application/json");
  toast(projs.length+" project(s) backed up (timeline only — media files stay on this device)");
}
function importAllProjects(file){
  const r=new FileReader();
  r.onload=async()=>{
    try{
      const parsed=JSON.parse(r.result);
      const list=Array.isArray(parsed)?parsed:[parsed];
      if(!list.length)throw 0;
      if(!db){toast("Storage is not available in this browser");return;}
      /* Phase 6 — validate every record before importing: future versions
         are refused (never silently migrated), records without timeline
         data are skipped, and the toast reports exactly what happened. */
      let ok=0;const skipped=[];
      for(const p of list){
        const v=EPProjectStore.validate(p,EPProjectStore.VIDEO_APP);
        if(!v.ok){skipped.push((p&&p.name||"unnamed")+": "+v.reason);continue;}
        if(!p.data){skipped.push((p.name||"unnamed")+": no timeline data in this record");continue;}
        EPProjectStore.migrate(p);
        await new Promise(res=>{const tx=db.transaction("projects","readwrite");tx.objectStore("projects").put(p);tx.oncomplete=res;tx.onerror=res;});
        ok++;
      }
      renderProjects();renderHomeRecent();
      toast(ok+" project(s) imported"+(skipped.length?"; skipped "+skipped.length+": "+skipped.slice(0,3).join("; "):""));
    }catch(err){toast("Invalid backup file");}
  };
  r.readAsText(file);
}

/* ---------- MEDIA LIBRARY PERSISTENCE (Phase 6) ----------
   Media blobs already live in IndexedDB (never localStorage). On startup
   every saved blob is loaded back into the session, so the Media Library
   shows everything imported on this device — not just this session's
   imports. Deleting from the library also deletes the blob, so Clear
   Cache and the library agree about what is stored. */
async function loadAllMediaFromDB(){
  if(!db)return;
  let items=[];
  try{items=await new Promise(res=>{const tx=db.transaction("media","readonly");const rq=tx.objectStore("media").getAll();rq.onsuccess=()=>res(rq.result||[]);rq.onerror=()=>res([]);});}catch(e){return;}
  items.forEach(it=>{
    if(!it||!it.blob||S.media.some(m=>m.id===it.id))return;
    const url=URL.createObjectURL(it.blob);
    const m={id:it.id,name:it.name,type:it.type,url,file:it.blob,fav:!!it.fav,folderId:it.folderId||null,addedAt:it.addedAt||0,duration:0,size:it.blob.size||0,proxyUrl:null,proxyBusy:false};
    S.media.push(m);
    if(it.type==="video"){const v=document.createElement("video");v.preload="metadata";v.src=url;v.onloadedmetadata=()=>{m.duration=round2(v.duration);renderMediaList();};}
    if(it.type==="audio"){const a=new Audio(url);a.onloadedmetadata=()=>{m.duration=round2(a.duration);renderMediaList();};m.audioEl=a;}
  });
  renderMediaList();
}
async function deleteMediaFromDB(id){
  if(!db)return;
  try{await new Promise(res=>{const tx=db.transaction("media","readwrite");tx.objectStore("media").delete(id);tx.oncomplete=res;tx.onerror=res;});}catch(e){}
}

/* ---------- export dialog (shared by the editor button and Export Center) ---------- */
/* FIX 2026-11-12: the dialog reset Resolution to 1080p on every open.
   Remember the last-used export settings (localStorage) and restore them;
   the Settings defaults are only the first-run fallback. */
const LAST_EXP_KEY="editora-last-export";
function saveLastExportSettings(){
  try{localStorage.setItem(LAST_EXP_KEY,JSON.stringify({res:$("expRes").value,customW:$("expCustomW").value,customH:$("expCustomH").value,fps:+$("expFps").value||30,bitrate:$("expBitrate").value,bitrateCustom:$("expBitrateCustom").value,fmt:$("expFmt").value,codec:$("expCodec").value}));}catch(e){}
}
function readLastExportSettings(){
  try{const j=JSON.parse(localStorage.getItem(LAST_EXP_KEY)||"null");return j&&typeof j==="object"?j:null;}catch(e){return null;}
}
function openExportModal(){
  const last=readLastExportSettings();
  $("expRes").value=(last&&last.res)||S.settings.defRes;$("expFps").value=String((last&&last.fps)||S.settings.defFps);$("expFmt").value=(last&&last.fmt)||S.settings.defFmt||"mp4";
  if(last){
    const set=(id,v)=>{const el=$(id);if(el&&v!==undefined&&v!==null&&v!=="")el.value=v;};
    set("expCustomW",last.customW);set("expCustomH",last.customH);
    set("expBitrate",last.bitrate);set("expBitrateCustom",last.bitrateCustom);
    set("expCodec",last.codec);
  }
  if(typeof syncExportDialogRows==="function")syncExportDialogRows();
  /* Phase 6 — test H.265 support when the dialog opens (async; the
     option appears only if the test proves it — see detectH265). */
  if(typeof detectH265==="function"){
    const p=detectH265();
    if(p&&p.then)p.then(()=>{if(last&&last.codec){const el=$("expCodec");if(el)el.value=last.codec;}}).catch(()=>{});
  }
  openModal("exportModal");
}

/* ================================================================
   CAPCUT-STYLE UI LAYER (added 2026-11-12)
   Toolbar / inspector tabs / context menu / Share / gallery filters.
   Reuses the engine above — no editing logic is duplicated here.
   ================================================================ */
function showPanel(tab){
  $$(".panel").forEach(p=>p.classList.remove("on"));
  const el=$("tab-"+tab);if(el)el.classList.add("on");
  $$(".toolbtn").forEach(b=>b.classList.toggle("on",b.dataset.tab===tab));
}
function showInspector(tab){
  $$(".itab").forEach(b=>b.classList.toggle("on",b.dataset.itab===tab));
  $$(".ipanel").forEach(p=>p.classList.toggle("on",p.id==="itab-"+tab));
}
function selectedClipObj(){
  if(!S.selClip)return null;
  const list=S.selKind==="video"?S.clips:S.selKind==="text"?S.textClips:S.selKind==="audio"?S.audioClips:null;
  return list?list.find(c=>c.id===S.selClip):null;
}
async function shareSiteLink(){
  const data={title:"Editora Pro",text:"I edited this with Editora Pro — free video & photo editor, no watermark.",url:location.href};
  try{if(navigator.share){await navigator.share(data);return;}}catch(e){if(e&&e.name==="AbortError")return;}
  try{await navigator.clipboard.writeText(data.url);toast("Link copied — paste it anywhere to share");}
  catch(e){toast("Copy this link: "+data.url);}
}
async function shareLastExport(){
  const ex=window.__lastExport;
  if(ex&&ex.blob){
    try{
      const file=new File([ex.blob],ex.name,{type:ex.blob.type||"application/octet-stream"});
      if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:"Editora Pro export"});return;}
    }catch(e){if(e&&e.name==="AbortError")return;}
    toast("Sharing files is not supported here — use Download, then share the file");
    return;
  }
  shareSiteLink();
}
function separateAudio(muteToo){
  const c=S.selKind==="video"?selectedClipObj():null;
  if(!c){toast("Select a video clip first");return;}
  S.audioClips.push({id:uid(),mediaId:c.mediaId,name:(c.name||"clip")+" (audio)",track:"a1",start:c.start,duration:c.duration,vol:80});
  if(muteToo){c.muted=true;video.muted=true;toast("Audio extracted to the audio track — original clip muted");}
  else toast("Audio separated to the audio track");
  renderTimeline();pushHistory();
}
function exportSelectedClip(){
  const c=S.selKind==="video"?selectedClipObj():null;
  if(!c){toast("Select a video clip first");return;}
  S.exportOnly={start:c.start,duration:c.duration};
  $("btnExport").click();
  toast("Exporting only the selected clip");
}
/* Phase 4+5 — menu-bar actions (§4). Every item calls a real, existing
   control or function; nothing here opens an empty dialog. */
function setTlZoom(z){S.zoom=clamp(Math.round(z),40,300);const tz=$("tlZoom");if(tz)tz.value=S.zoom;renderTimeline();}
function menuAction(a){
  const click=id=>{const el=$(id);if(el)el.click();};
  switch(a){
    case "new":click("btnNewProject");break;
    case "projects":click("btnProjects");break;
    case "save":click("btnSaveProject");break;
    case "backup":click("btnExportProj");break;
    case "export":openExportModal();break;
    case "frame":click("btnExportFrame");break;
    case "home":click("btnHome");break;
    case "undo":click("btnUndoTop");break;
    case "redo":click("btnRedoTop");break;
    case "split":click("btnSplit");break;
    case "cut":click("btnCut");break;
    case "copy":ctxAction("copy");break;
    case "paste":ctxAction("paste");break;
    case "duplicate":click("btnDupClip");break;
    case "delete":click("btnDelClip");break;
    case "rippledelete":click("btnRippleDelete");break;
    case "leftpanel":click("btnCollapseLeft");break;
    case "rightpanel":click("btnCollapseRight");break;
    case "panels":click("btnTogglePanels");break;
    case "zoomin":setTlZoom(S.zoom*1.25);break;
    case "zoomout":setTlZoom(S.zoom/1.25);break;
    case "tlexpand":click("btnTlExpand");break;
    case "fullscreen":click("btnFull");break;
    case "theme":click("btnTheme");break;
    case "marker":click("btnAddMarker");break;
    case "insert":click("btnInsertAtPlayhead");break;
    case "ripple":click("btnRippleAll");break;
    case "gostart":seek(0);break;
    case "goend":seek(totalDuration());break;
    case "fps":{const el=$("projFps");if(el){el.focus();toast("Pick the project frame rate — it drives frame stepping and the timecode");}break;}
    case "merge":click("btnMerge");break;
    case "reverse":click("btnClipReverse");break;
    case "freeze":click("btnFreeze");break;
    case "speed":showInspector("speed");toast("Clip speed is in the right panel → Speed tab");break;
    case "fxpanel":showPanel("effects");break;
    case "transpanel":showPanel("trans");break;
    case "filterpanel":showPanel("effects");toast("Filters & Color are in the Effects panel, below the effects");break;
    case "adjust":showInspector("adjustment");break;
    case "clearfx":click("btnFxClear");break;
    case "audiopanel":showPanel("audio");showInspector("audio");break;
    case "importaudio":click("btnImportAudio");break;
    case "splitaudio":click("btnSplitAudio");break;
    case "normaudio":click("btnNormalizeAudio");break;
    case "previewaudiofx":click("btnPreviewAudioFx");break;
    case "ducking":click("btnDuckToggle");break;
    case "shortcuts":openModal("shortcutsModal");break;
    case "exportcenter":click("btnExportCenterTop");break;
    case "settings":click("btnSettings");break;
    case "about":toast("Editora Pro — free video & photo editor. No ads, no watermark, no login, no AI.");break;
    default:toast("No action for "+a);
  }
}
/* Phase 4+5 — inspector Effect parameters: one strength slider per effect
   on the selected clip, wired to the same clip.fx the Effects panel edits. */
function renderInspFx(){
  const box=$("inspFxParams");if(!box)return;
  const c=S.selKind==="video"?selectedClipObj():null;
  const fx=c?clipFxOf(c):{};
  const ids=Object.keys(fx);
  if(!ids.length){box.innerHTML='<p class="hint">Select a clip with effects to see its parameters here.</p>';return;}
  box.innerHTML="";
  ids.forEach(id=>{
    const row=document.createElement("div");row.className="fxp-row";
    const lab=document.createElement("span");lab.textContent=EFFECT_LABELS[id]||id;
    const sl=document.createElement("input");sl.type="range";sl.min=0;sl.max=100;sl.value=fx[id];
    const val=document.createElement("b");val.textContent=fx[id]+"%";
    sl.addEventListener("input",()=>{c.fx[id]=+sl.value;val.textContent=sl.value+"%";refreshVideoStyle();markDirty();});
    sl.addEventListener("change",()=>pushHistory());
    const rm=document.createElement("button");rm.className="mini";rm.textContent="✕";rm.title="Remove this effect";
    rm.addEventListener("click",()=>{delete c.fx[id];renderInspFx();if(typeof syncFxButtons==="function")syncFxButtons();refreshVideoStyle();pushHistory();});
    row.append(lab,sl,val,rm);box.appendChild(row);
  });
}
/* Phase 4+5 — export presets: built-ins + saved customs (localStorage). */
const EXP_PRESETS_BUILTIN={
  "YouTube 1080p":{res:"1080",fps:30,bitrate:"5000000",fmt:"mp4",codec:"h264"},
  "YouTube 720p":{res:"720",fps:30,bitrate:"5000000",fmt:"mp4",codec:"h264"},
  "Fast draft 480p":{res:"480",fps:30,bitrate:"2500000",fmt:"mp4",codec:"h264"},
  "High quality 1080p":{res:"1080",fps:30,bitrate:"10000000",fmt:"mp4",codec:"h264"},
  "High quality 4K":{res:"2160",fps:30,bitrate:"20000000",fmt:"mp4",codec:"h264"},
};
function getExpPresets(){try{return JSON.parse(localStorage.getItem("editora-export-presets")||"{}");}catch(e){return{};}}
function buildExpPresets(){
  const sel=$("expPreset");if(!sel)return;sel.innerHTML='<option value="">— Choose a preset —</option>';
  const all={...EXP_PRESETS_BUILTIN,...getExpPresets()};
  Object.keys(all).forEach(n=>{const o=document.createElement("option");o.value=n;o.textContent=n;sel.appendChild(o);});
}
function applyExpPreset(name){
  const all={...EXP_PRESETS_BUILTIN,...getExpPresets()};const p=all[name];if(!p)return;
  const set=(id,v)=>{const el=$(id);if(el)el.value=v;};
  set("expRes",p.res);
  if(p.res==="custom"){set("expCustomW",p.customW||1280);set("expCustomH",p.customH||720);}
  set("expFps",p.fps);
  if(p.bitrate==="custom"){set("expBitrate","custom");set("expBitrateCustom",p.bitrateCustom||8);}
  else set("expBitrate",p.bitrate);
  set("expFmt",p.fmt);set("expCodec",p.codec);
  if(typeof syncExportDialogRows==="function")syncExportDialogRows();
  updateMonRes();toast("Export preset applied: "+name);
}
/* ---- right-click context menu ---- */
const CTX_ITEMS=[
  {act:"copy",label:"Copy",kbd:"Ctrl C"},
  {act:"cut",label:"Cut",kbd:"Ctrl X"},
  {act:"paste",label:"Paste",kbd:""},
  {sep:true},
  {act:"delete",label:"Delete",kbd:"Del"},
  {act:"split",label:"Split scenes",kbd:"S"},
  {act:"edit",label:"Edit",kbd:""},
  {act:"trim",label:"Trim clip",kbd:""},
  {act:"exportSel",label:"Export selected clips",kbd:""},
  {act:"transcript",label:"Captions",kbd:""},
  {sep:true},
  {act:"sepAudio",label:"Separate audio",kbd:""},
  {act:"deactivate",label:"Deactivate clip",kbd:"V"},
  {act:"linkMedia",label:"Link to media",kbd:""},
  {act:"editFx",label:"Edit effects",kbd:""},
  {act:"extractAudio",label:"Extract audio",kbd:""},
  {act:"replace",label:"Replace clip",kbd:""},
  {act:"range",label:"Range — trim start to playhead",kbd:""},
];
function buildCtxMenu(){
  const m=$("ctxMenu");m.innerHTML="";
  CTX_ITEMS.forEach(it=>{
    if(it.sep){const s=document.createElement("div");s.className="ctx-sep";m.appendChild(s);return;}
    const b=document.createElement("button");b.dataset.act=it.act;
    b.innerHTML=`<span>${it.label}</span>${it.kbd?`<span class="kbd">${it.kbd}</span>`:""}`;
    if(it.act==="paste"&&!S.clipboard)b.classList.add("off");
    b.addEventListener("click",()=>{hideCtxMenu();ctxAction(it.act);});
    m.appendChild(b);
  });
}
function showCtxMenu(x,y){
  buildCtxMenu();
  const m=$("ctxMenu");m.hidden=false;
  m.style.left=Math.min(x,window.innerWidth-270)+"px";
  m.style.top=Math.min(y,window.innerHeight-CTX_ITEMS.length*34-20)+"px";
}
function hideCtxMenu(){const m=$("ctxMenu");if(m)m.hidden=true;}
function ctxAction(act){
  const c=selectedClipObj();
  switch(act){
    case "copy":
      if(!c){toast("Select a clip first");return;}
      S.clipboard={type:S.selKind,data:JSON.parse(JSON.stringify(c))};toast("Copied");break;
    case "cut":
      if(!c){toast("Select a clip first");return;}
      S.clipboard={type:S.selKind,data:JSON.parse(JSON.stringify(c))};deleteSelected();break;
    case "paste":{
      if(!S.clipboard){toast("Nothing copied yet");return;}
      const list=S.clipboard.type==="video"?S.clips:S.clipboard.type==="text"?S.textClips:S.audioClips;
      const copy={...JSON.parse(JSON.stringify(S.clipboard.data)),id:uid(),start:S.curTime};
      if(copy.name)copy.name=copy.name+" copy";if(copy.text)copy.text=copy.text+" copy";
      list.push(copy);updateDuration();renderTimeline();pushHistory();toast("Pasted at playhead");break;}
    case "delete":deleteSelected();break;
    case "split":splitAtPlayhead();break;
    case "edit":showInspector("video");toast("Edit the selected clip in the Video tab (right)");break;
    case "trim":$("trimIn").focus();toast("Set Trim in / out, then press Apply Trim in the timeline bar");break;
    case "exportSel":exportSelectedClip();break;
    case "transcript":{
      // transcript lives in the Captions panel now (no modal) — show matching captions there
      showPanel("captions");
      toast("Captions for this clip are listed in the Captions panel (left)");break;}
    case "sepAudio":separateAudio(false);break;
    case "extractAudio":separateAudio(true);break;
    case "deactivate":
      if(!c){toast("Select a clip first");return;}
      c.disabled=!c.disabled;renderTimeline();pushHistory();
      toast(c.disabled?"Clip deactivated (renders black, preview dimmed)":"Clip re-activated");break;
    case "linkMedia":{
      if(!c||!c.mediaId){toast("This clip has no linked media");return;}
      showPanel("media");
      const el=document.querySelector(`.media-item[data-id="${c.mediaId}"]`);
      if(el){el.scrollIntoView({block:"nearest"});el.classList.add("flash");setTimeout(()=>el.classList.remove("flash"),1800);toast("Linked media highlighted in the gallery");}
      else toast("Media is in the gallery — use Search to find it");break;}
    case "editFx":showPanel("effects");break;
    case "replace":
      if(!c||S.selKind!=="video"){toast("Select a video clip first");return;}
      window.__replaceClipId=c.id;$("replaceInput").click();break;
    case "range":{
      if(!c){toast("Select a clip first");return;}
      const off=Math.max(0,S.curTime-c.start);
      $("trimIn").value=off.toFixed(1);$("trimInR").value=off;
      toast("Range start set to playhead — set Trim out, then Apply Trim");break;}
  }
}
document.addEventListener("DOMContentLoaded",()=>{
  syncInspectorTransform();
  // toolbar (CapCut icon row)
  $$(".toolbtn").forEach(b=>b.addEventListener("click",()=>{
    const tab=b.dataset.tab;
    showPanel(tab);
    if(tab==="audio")showInspector("audio");
  }));
  // inspector tabs
  $$(".itab").forEach(b=>b.addEventListener("click",()=>showInspector(b.dataset.itab)));
  // library nav (Device / Media / Your presets)
  $$(".lib-nav-item").forEach(b=>b.addEventListener("click",()=>{
    $$(".lib-nav-item").forEach(x=>x.classList.remove("on"));b.classList.add("on");
    if(b.dataset.lib==="presets"){$("btnTemplates").click();}
    else{showPanel("media");if(b.dataset.lib==="media")$("mediaSearch").focus();}
  }));
  // gallery filters All / Added
  bind("btnFilterAll","click",e=>{S.mediaFilterAdded=false;$("btnFilterAll").classList.add("on");$("btnFilterAdded").classList.remove("on");renderMediaList();});
  bind("btnFilterAdded","click",e=>{S.mediaFilterAdded=true;$("btnFilterAdded").classList.add("on");$("btnFilterAll").classList.remove("on");renderMediaList();toast("Showing only media already on the timeline");});
  // inspector — Transform
  const syncZoom=()=>{const cz=$("cropZoom");if(cz){cz.value=S.cropZoom;const cv=$("cropZoomV");if(cv)cv.textContent=S.cropZoom+"%";}};
  bind("inspScale","input",e=>{S.cropZoom=+e.target.value;$("inspScaleV").textContent=S.cropZoom+"%";syncZoom();applyFilters();markDirty();});
  bind("inspScale","change",()=>pushHistory());
  bind("inspUniform","change",e=>{
    $("inspScaleXY").hidden=e.target.checked;
    if(e.target.checked){S.scaleX=100;S.scaleY=100;syncInspectorTransform();applyFilters();pushHistory();}
    else toast("Non-uniform scale on — set Scale X and Y separately");
  });
  bind("inspScaleX","input",e=>{S.scaleX=clamp(+e.target.value||100,25,200);applyFilters();markDirty();});
  bind("inspScaleY","input",e=>{S.scaleY=clamp(+e.target.value||100,25,200);applyFilters();markDirty();});
  bind("inspPosX","input",e=>{S.posX=+e.target.value||0;applyFilters();markDirty();});
  bind("inspPosY","input",e=>{S.posY=+e.target.value||0;applyFilters();markDirty();});
  bind("inspRot","input",e=>{S.rotation=+e.target.value;$("inspRotV").textContent=S.rotation+"°";applyFilters();markDirty();});
  bind("inspRot","change",()=>pushHistory());
  $$("#alignRow [data-align]").forEach(b=>b.addEventListener("click",()=>{
    const a=b.dataset.align;
    if(a==="left")S.posX-=40; if(a==="right")S.posX+=40; if(a==="center")S.posX=0;
    if(a==="top")S.posY-=30; if(a==="bottom")S.posY+=30; if(a==="middle")S.posY=0;
    syncInspectorTransform();applyFilters();pushHistory();
  }));
  bind("inspBlendOn","change",e=>{
    video.style.mixBlendMode=e.target.checked?$("inspBlendMode").value:"normal";
    toast(e.target.checked?"Blend on — preview only (export renders normal blend)":"Blend off");
  });
  bind("inspBlendMode","change",e=>{if($("inspBlendOn").checked)video.style.mixBlendMode=e.target.value;});
  // inspector — Speed
  bind("clipSpeed","input",e=>{$("clipSpeedV").textContent=(+e.target.value/100).toFixed(2)+"×";});
  bind("clipSpeed","change",e=>{
    const c=S.selKind==="video"?selectedClipObj():null;
    if(!c){toast("Select a video clip first");return;}
    const sp=+e.target.value/100;
    if(!c.baseDur)c.baseDur=round2(Math.max(0.2,(c.trimOut-c.trimIn)||c.duration));
    c.speed=sp;c.duration=round2(Math.max(0.2,c.baseDur/sp));c.trimOut=round2(c.trimIn+c.baseDur);
    updateDuration();renderTimeline();pushHistory();toast("Clip speed "+sp.toFixed(2)+"× — duration "+c.duration.toFixed(1)+"s");
  });
  bind("txtAnim","change",e=>{
    const c=S.selKind==="text"?selectedClipObj():null;
    if(!c){toast("Select a text clip first — animation applies to text clips");return;}
    c.anim=e.target.value;renderTextOverlay();pushHistory();toast("Text animation: "+e.target.value);
  });
  // player ratio
  bind("ratioSel","change",e=>{
    const st=$("videoStage"),v=e.target.value;
    if(v==="9:16"){st.style.aspectRatio="9 / 16";st.style.maxWidth="420px";}
    else if(v==="1:1"){st.style.aspectRatio="1 / 1";st.style.maxWidth="560px";}
    else if(v==="4:3"){st.style.aspectRatio="4 / 3";st.style.maxWidth="100%";}
    else{st.style.aspectRatio="16 / 9";st.style.maxWidth="100%";}
    updateMonRes();
  });
  /* Phase 4+5 — safe-area guides on the Program Monitor. */
  bind("btnSafeAreas","click",()=>{
    S.safeAreas=!S.safeAreas;const o=$("safeOverlay");if(o)o.hidden=!S.safeAreas;
    $("btnSafeAreas").classList.toggle("on",S.safeAreas);
    toast(S.safeAreas?"Safe-area guides on — cyan = action-safe 90%, amber = title-safe 80%":"Safe-area guides off");
  });
  bind("expRes","change",updateMonRes);
  // menu dropdown
  bind("btnMenu","click",e=>{e.stopPropagation();$("menuDrop").hidden=!$("menuDrop").hidden;});
  document.addEventListener("click",e=>{if(!e.target.closest(".menu-wrap"))$("menuDrop").hidden=true;});
  $$("#menuDrop [data-m]").forEach(b=>b.addEventListener("click",()=>{
    $("menuDrop").hidden=true;
    const m=b.dataset.m;
    if(m==="new")$("btnNewProject").click();
    else if(m==="projects")$("btnProjects").click();
    else if(m==="save")$("btnSaveProject").click();
    else if(m==="templates")$("btnTemplates").click();
    else if(m==="settings")$("btnSettings").click();
    else if(m==="about")toast("Editora Pro — free video & photo editor. No ads, no watermark, no login, no AI.");
  }));
  /* Phase 4+5 — top menu bar (§4): one dropdown open at a time. */
  const closeMenus=()=>{$$(".menudrop").forEach(d=>d.hidden=true);$$(".menubar-btn").forEach(b=>b.classList.remove("open"));};
  $$(".menubar-btn").forEach(b=>b.addEventListener("click",e=>{
    e.stopPropagation();
    const drop=$("menu-"+b.dataset.menu);const wasHidden=!drop||drop.hidden;
    closeMenus();
    if(drop&&wasHidden){drop.hidden=false;b.classList.add("open");}
  }));
  document.addEventListener("click",e=>{if(!e.target.closest("#menubar"))closeMenus();});
  $$("#menubar [data-ma]").forEach(b=>b.addEventListener("click",()=>{
    closeMenus();menuAction(b.dataset.ma);
  }));
  // share
  bind("btnShare","click",shareLastExport);
  $("expResult").addEventListener("click",e=>{if(e.target&&e.target.id==="btnShareResult")shareLastExport();});
  // shortcuts modal
  bind("btnShortcuts","click",()=>openModal("shortcutsModal"));
  bind("btnCloseShortcuts","click",()=>closeModal("shortcutsModal"));
  // backdrop click + Escape close the topmost open modal (P0 defense in depth)
  $$(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.hidden=true;}));
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"){
      const top=topOpenModal();
      if(top){top.hidden=true;return;}
      closeMenus();hideCtxMenu();
    }
  });
  // timeline toolbar — select tool
  bind("btnSelectTool","click",()=>toast("Select tool — drag clips to move, drag a clip edge to trim"));
  /* Phase 4+5 — per-track mute (timeline track headers). */
  $$(".tmute").forEach(b=>b.addEventListener("click",()=>{
    const tr=b.dataset.track;S.mutedTracks[tr]=!S.mutedTracks[tr];
    syncMuteButtons();markDirty();
    toast("Track "+tr.toUpperCase()+(S.mutedTracks[tr]?" muted — silent in preview and in both exports":" unmuted"));
  }));
  /* Phase 4+5 — expandable timeline (mobile: near full height). */
  bind("btnTlExpand","click",()=>{
    const sec=$("timelineSection");sec.classList.toggle("tl-expanded");
    const on=sec.classList.contains("tl-expanded");
    $("btnTlExpand").innerHTML=epIcon(on?"chevron-down":"maximize")+" "+(on?"Collapse":"Expand");
  });
  /* Phase 4+5 — pinch to zoom the timeline (touch): two fingers on the
     ruler / empty track area scale px-per-second; one finger still scrolls.
     Pinches that start on a clip are ignored so clip dragging is unaffected. */
  (()=>{
    const el=$("tlScroll");if(!el)return;
    const pts=new Map();let startDist=0,startZoom=S.zoom,lastRender=0;
    el.addEventListener("pointerdown",e=>{
      if(e.target.closest(".clip"))return;
      pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pts.size===2){const a=[...pts.values()];startDist=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);startZoom=S.zoom;}
    });
    el.addEventListener("pointermove",e=>{
      if(!pts.has(e.pointerId))return;
      pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pts.size===2&&startDist>0){
        const a=[...pts.values()];const d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);
        S.zoom=clamp(Math.round(startZoom*d/startDist),40,300);
        const tz=$("tlZoom");if(tz)tz.value=S.zoom;
        const now=Date.now();if(now-lastRender>120){lastRender=now;renderTimeline();}
      }
    });
    const up=e=>{pts.delete(e.pointerId);if(pts.size<2){if(startDist>0)renderTimeline();startDist=0;}};
    el.addEventListener("pointerup",up);el.addEventListener("pointercancel",up);
  })();
  // track show/hide (eye icons) — hides the track's clips but keeps its row height so labels stay aligned
  $$(".tvis").forEach(b=>b.addEventListener("click",()=>{
    const t=b.dataset.track;
    const trackEl=$("track"+t.charAt(0).toUpperCase()+t.slice(1));
    if(!trackEl)return;
    const hidden=trackEl.style.visibility==="hidden";
    trackEl.style.visibility=hidden?"":"hidden";
    b.innerHTML=epIcon(hidden?"eye":"eye-off");
    toast("Track "+t.toUpperCase()+(hidden?" shown":" hidden"));
  }));
  // drag media from gallery onto the timeline
  const tls=$("tlScroll");
  tls.addEventListener("dragover",e=>e.preventDefault());
  tls.addEventListener("drop",e=>{
    e.preventDefault();
    const id=e.dataTransfer.getData("text/media");
    const m=S.media.find(x=>x.id===id);
    if(m)addToTimeline(m);
  });
  // stickers
  const emojis=["⭐","🔥","❤️","😂","🎉","👍","💡","🎵","✨","🌈","💯","🚀","😍","👏","🎬","💎"];
  const sg=$("stickerGrid");
  emojis.forEach(em=>{
    const b=document.createElement("button");b.textContent=em;b.title="Add "+em;
    b.addEventListener("click",()=>{
      S.textClips.push({id:uid(),text:em,start:S.curTime,duration:3,font:"Arial",size:80,color:"#ffffff",bg:"#000000",bgOn:false,outline:false,shadow:true,pos:"center",anim:"pop"});
      renderTimeline();renderTextOverlay();pushHistory();toast("Sticker added to timeline");
    });
    sg.appendChild(b);
  });
  // filters panel — Phase 3: all 35 real filters (buildFilterGrid)
  buildFilterGrid();
  // right-click context menu on timeline clips
  tls.addEventListener("contextmenu",e=>{
    const clipEl=e.target.closest(".clip");
    if(!clipEl)return;
    e.preventDefault();
    const it=((clipEl.dataset.type==="v1"||clipEl.dataset.type==="v2")?S.clips:clipEl.dataset.type==="text"?S.textClips:S.audioClips).find(c=>c.id===clipEl.dataset.id);
    if(it)selectClip(it,clipEl.dataset.type);
    showCtxMenu(e.clientX,e.clientY);
  });
  document.addEventListener("click",e=>{if(!e.target.closest("#ctxMenu"))hideCtxMenu();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")hideCtxMenu();});
  // replace-clip file picker — Phase 2: no timeout race; the import waits
  // for metadata, then replaceClipWithMedia keeps position + duration.
  bind("replaceInput","change",async e=>{
    const f=e.target.files[0];e.target.value="";
    if(!f||!window.__replaceClipId)return;
    const m=await importSingleFile(f);
    const c=S.clips.find(x=>x.id===window.__replaceClipId);
    if(m&&c)toast(replaceClipWithMedia(c,m));
    window.__replaceClipId=null;
  });
});

/* ================================================================
   PHASE 3 (2026-11-12) — Transitions, Effects, Filters, Color Grading
   (blueprint §3). Vanilla JS, no new CDN, no AI/ads/paywall/watermark.
   Render paths, per item:
     preview = CSS filter/transform on the <video> element + the overlay
       canvas (drawOverlayFX) — a real approximation, labelled as such.
     canvas  = Canvas export pixel math (applyGradePixels / applyFxPixels)
       + canvas transforms/clips in drawFrame — the full effect.
     ffmpeg  = Video Engine export. Only the fade family (fade filters),
       the eq/hue/curves/lut3d grading and the "Normal"-style filters
       render there; everything else is listed as skipped in the result.
   Anything that could render in NEITHER path is omitted from the UI.
   ================================================================ */

/* ---------- TRANSITIONS ----------
   id -> {group, dir (does direction apply), rev (does reverse apply),
   ff (renders in the Video Engine export? "fade" family only)} */
const TRANSITIONS={
  none:{group:"Basic"},
  fade:{group:"Basic",ff:"fade"},fadeblack:{group:"Basic",ff:"fadeblack"},fadewhite:{group:"Basic",ff:"fadewhite"},
  dissolve:{group:"Basic",ff:"fade"},crossdissolve:{group:"Basic",ff:"fade"},
  zoomin:{group:"Zoom / Slide / Push"},zoomout:{group:"Zoom / Slide / Push"},zoomthrough:{group:"Zoom / Slide / Push"},
  zoomblur:{group:"Zoom / Slide / Push"},punchzoom:{group:"Zoom / Slide / Push"},
  slideleft:{group:"Zoom / Slide / Push",dir:1},slideright:{group:"Zoom / Slide / Push",dir:1},
  slideup:{group:"Zoom / Slide / Push",dir:1},slidedown:{group:"Zoom / Slide / Push",dir:1},
  pushleft:{group:"Zoom / Slide / Push",dir:1},pushright:{group:"Zoom / Slide / Push",dir:1},
  pushup:{group:"Zoom / Slide / Push",dir:1},pushdown:{group:"Zoom / Slide / Push",dir:1},
  wipe:{group:"Wipe / Spin / Blur",dir:1},circlewipe:{group:"Wipe / Spin / Blur"},clockwipe:{group:"Wipe / Spin / Blur"},
  diagwipe:{group:"Wipe / Spin / Blur",dir:1},
  spinleft:{group:"Wipe / Spin / Blur",rev:1},spinright:{group:"Wipe / Spin / Blur",rev:1},
  spin360:{group:"Wipe / Spin / Blur",rev:1},whirl:{group:"Wipe / Spin / Blur",rev:1},
  gaussblur:{group:"Wipe / Spin / Blur"},motionblur:{group:"Wipe / Spin / Blur"},radialblur:{group:"Wipe / Spin / Blur"},
  rgbglitch:{group:"Glitch / Flash / Cinematic"},digitalglitch:{group:"Glitch / Flash / Cinematic"},
  pixelglitch:{group:"Glitch / Flash / Cinematic"},signalerror:{group:"Glitch / Flash / Cinematic"},
  whiteflash:{group:"Glitch / Flash / Cinematic"},blackflash:{group:"Glitch / Flash / Cinematic"},
  cameraflash:{group:"Glitch / Flash / Cinematic"},
  filmburn:{group:"Glitch / Flash / Cinematic"},lightleak:{group:"Glitch / Flash / Cinematic"},
  lensflare:{group:"Glitch / Flash / Cinematic"},filmdissolve:{group:"Glitch / Flash / Cinematic"},
  whippan:{group:"Motion / 3D / Shape / Creative",dir:1},camerashake:{group:"Motion / 3D / Shape / Creative"},
  motionsweep:{group:"Motion / 3D / Shape / Creative",dir:1},
  cube:{group:"Motion / 3D / Shape / Creative",dir:1},flip:{group:"Motion / 3D / Shape / Creative"},
  pageturn:{group:"Motion / 3D / Shape / Creative"},rotate3d:{group:"Motion / 3D / Shape / Creative"},
  circlereveal:{group:"Motion / 3D / Shape / Creative"},rectreveal:{group:"Motion / 3D / Shape / Creative"},
  diamondreveal:{group:"Motion / 3D / Shape / Creative"},
  liquid:{group:"Motion / 3D / Shape / Creative"},inkspread:{group:"Motion / 3D / Shape / Creative"},
  smokereveal:{group:"Motion / 3D / Shape / Creative"},maskreveal:{group:"Motion / 3D / Shape / Creative"},
};
const TRANS_GROUPS=["Basic","Zoom / Slide / Push","Wipe / Spin / Blur","Glitch / Flash / Cinematic","Motion / 3D / Shape / Creative"];
/* Per-clip transition settings live on the clip (transition, transDur,
   transDir, transSpeed, transReverse, transIntensity); S.trans* holds the
   panel's current values. Legacy ids "slide"/"zoom"/"blur"/"flash"/"spin"
   map onto the new ids so old projects still render. */
const TRANS_ALIAS={slide:"slideleft",zoom:"zoomin",blur:"gaussblur",flash:"whiteflash",spin:"spinright"};
/* Intrinsic direction of the directional transitions. The Direction dropdown
   defaults to "auto", which means "use the transition's own direction"
   (Slide Right really slides right); picking an explicit direction in the
   panel overrides it. */
const TRANS_DIR_BY_ID={slideleft:"left",slideright:"right",slideup:"up",slidedown:"down",
  pushleft:"left",pushright:"right",pushup:"up",pushdown:"down"};
function transEffDir(id,dir){
  if(dir&&dir!=="auto")return dir;
  return TRANS_DIR_BY_ID[id]||"left";
}
function transSettings(clip){
  const id=TRANS_ALIAS[clip.transition]||clip.transition||"none";
  return{id,dur:clip.transDur||S.transDur||0.5,
    dir:transEffDir(id,clip.transDir||S.transDir||"auto"),speed:clip.transSpeed||S.transSpeed||100,
    rev:clip.transReverse!==undefined?clip.transReverse:S.transReverse,
    ease:clip.transEase||S.transEase||"linear",
    soft:clip.transSoft!==undefined?clip.transSoft:(S.transSoft||0),
    inten:(clip.transIntensity!==undefined?clip.transIntensity:S.transIntensity||100)/100};
}
/* Phase 4+5 — the clip that ends exactly where `clip` starts on the same
   track, for a true between-clips transition. Only the fade family
   cross-dissolves (the outgoing clip's last frame held under the incoming
   clip); every other transition keeps its entry animation. */
const TRANS_FADE_FAMILY=["fade","dissolve","crossdissolve","filmdissolve","fadeblack","fadewhite"];
function crossBlendPrev(clip,offset){
  if(!clip)return null;
  const s=transSettings(clip);
  if(!TRANS_FADE_FAMILY.includes(s.id)||!s.dur)return null;
  if(offset>=s.dur||offset<0)return null;
  const prev=S.clips.filter(c=>(c.track||"v1")===(clip.track||"v1")&&!c.disabled)
    .find(c=>Math.abs((c.start+c.duration)-clip.start)<0.05);
  return prev?{clip:prev,e:clamp(offset/s.dur,0,1)}:null;
}
/* Shared transition engine. clip + offset (seconds into the clip) ->
   {opacity, scale, tx, ty, rot, blur, clipShape, overlay, shake, pixel}.
   `edge` is 0 at the clip boundary and 1 once the transition is over;
   speed compresses the ramp, reverse flips it, intensity scales the
   magnitude. Used by preview, Canvas export and (for the fade family)
   the FFmpeg mapping. */
function transCompute(clip,offset){
  const out={opacity:1,scale:1,tx:0,ty:0,rot:0,blur:0,clipShape:null,overlay:null,shake:0,pixel:null};
  if(!clip)return out;
  const s=transSettings(clip);
  if(s.id==="none"||!s.dur)return out;
  const d=clip.duration||0,o=offset;
  const atStart=o<s.dur, atEnd=(d-o)<s.dur;
  if(!atStart&&!atEnd)return out;
  let p=atStart?o/s.dur:(d-o)/s.dur;            // 0 at edge -> 1 when done
  p=clamp(p*(s.speed/100),0,1);                 // speed: faster ramp
  if(s.rev)p=1-p;                               // reverse: run backwards
  /* Phase 4+5 — easing shapes the ramp (linear / ease in / out / in-out /
     smoothstep); edge softness blurs the incoming clip while the edge moves. */
  const ez=s.ease||"linear";
  if(ez==="easeIn")p=p*p;
  else if(ez==="easeOut")p=1-(1-p)*(1-p);
  else if(ez==="easeInOut")p=p<0.5?2*p*p:1-Math.pow(-2*p+2,2)/2;
  else if(ez==="smooth")p=p*p*(3-2*p);
  const e=p, inv=1-p, I=s.inten, soft=(s.soft||0)/100;
  const dirSign=s.dir==="right"||s.dir==="down"?1:-1;
  const horiz=s.dir==="left"||s.dir==="right";
  switch(s.id){
    case "fade": out.opacity=clamp(e,0,1); break;
    case "dissolve": out.opacity=clamp(e,0,1); out.blur=inv*6*I; break; // soft dissolve: blur melts away as it fades in
    case "crossdissolve": out.opacity=clamp(e,0,1); out.scale=1+inv*0.04*I; break; // cross-dissolve: gentle settle-zoom as it fades in
    case "filmdissolve": out.opacity=clamp(e,0,1); out.blur=inv*3*I; out.overlay={color:"#ff9a3c",alpha:inv*0.18*I}; break; // film dissolve: warm chemical fade
    case "fadeblack": out.opacity=clamp(e,0,1); out.overlay={color:"#000000",alpha:inv*I}; break;
    case "fadewhite": out.opacity=clamp(e,0,1); out.overlay={color:"#ffffff",alpha:inv*I}; break;
    case "zoomin": out.scale=1-inv*0.5*I; out.opacity=clamp(0.2+0.8*e,0,1); break; // zoom in: grows from small to full size
    case "zoomout": out.scale=1+inv*0.5*I; out.opacity=clamp(0.2+0.8*e,0,1); break; // zoom out: shrinks from large to full size (both settle at 1.0 — the old zoomout ended at 1.5x and popped)
    case "zoomthrough": out.scale=1+inv*2.2*I; out.opacity=clamp(e,0,1); break;
    case "zoomblur": out.scale=1+inv*0.4*I; out.blur=inv*14*I; break;
    case "punchzoom": out.scale=1+Math.sin(e*Math.PI)*0.35*I; break;
    case "slideleft": case "slideright": case "slideup": case "slidedown":
      if(horiz)out.tx=inv*120*dirSign*I; else out.ty=inv*120*dirSign*I; out.opacity=clamp(0.3+0.7*e,0,1); break;
    case "pushleft": case "pushright": case "pushup": case "pushdown":
      if(horiz)out.tx=inv*320*dirSign*I; else out.ty=inv*320*dirSign*I; break;
    case "wipe": out.clipShape={type:"wipe",prog:e,dir:s.dir,soft}; break;
    case "circlewipe": out.clipShape={type:"circle",prog:e,soft,cx:0.5,cy:0.5}; break; // circle grows from the centre
    case "circlereveal": out.clipShape={type:"circle",prog:e,soft,cx:0.15,cy:0.15}; break; // circle grows from the top-left corner
    case "clockwipe": out.clipShape={type:"clock",prog:e,soft}; break;
    case "diagwipe": out.clipShape={type:"diag",prog:e,dir:s.dir,soft}; break;
    case "rectreveal": out.clipShape={type:"rect",prog:e,soft}; break;
    case "diamondreveal": out.clipShape={type:"diamond",prog:e,soft}; break;
    case "spinleft": out.rot=inv*90*I; out.opacity=clamp(0.3+0.7*e,0,1); break;
    case "spinright": out.rot=-inv*90*I; out.opacity=clamp(0.3+0.7*e,0,1); break;
    case "spin360": out.rot=inv*360*I; break;
    case "whirl": out.rot=inv*180*I; out.scale=1+inv*0.3*I; break;
    case "gaussblur": out.blur=inv*12*I; break;
    case "motionblur": out.blur=inv*8*I; out.tx=inv*30*dirSign*I; break;
    case "radialblur": out.blur=inv*10*I; out.scale=1+inv*0.12*I; break;
    case "rgbglitch": case "digitalglitch": case "pixelglitch": case "signalerror":
      out.pixel=s.id; out.tx=(Math.random()-0.5)*10*inv*I; break;
    case "whiteflash": out.overlay={color:"#ffffff",alpha:inv*0.9*I}; break;
    case "blackflash": out.overlay={color:"#000000",alpha:inv*0.9*I}; break;
    case "cameraflash": out.overlay={color:"#ffffff",alpha:Math.sin(e*Math.PI)*I}; break;
    case "filmburn": out.overlay={color:"#ff7a28",alpha:inv*0.45*I}; break;
    case "lightleak": out.overlay={color:"#ffb347",alpha:inv*0.35*I}; break;
    case "lensflare": out.overlay={color:"#fff2cc",alpha:inv*0.3*I,flare:true}; break;
    case "whippan": if(horiz)out.tx=inv*400*dirSign*I; else out.ty=inv*400*dirSign*I; out.blur=inv*6*I; break;
    case "camerashake": out.shake=inv*10*I; break;
    case "motionsweep": if(horiz)out.tx=inv*200*dirSign*I; else out.ty=inv*200*dirSign*I; out.scale=1+inv*0.15*I; break;
    case "cube": out.rot=inv*90*dirSign*I; out.scale=1-inv*0.2*I; break;
    case "flip": out.scale=inv>0.5?(1-(e-0.5)*2):((e)*2-1); out.scale=Math.abs(out.scale)*0.2+0.8; out.rot=inv*30*I; break;
    case "pageturn": out.rot=inv*55*I; out.tx=inv*60*I; out.opacity=clamp(0.4+0.6*e,0,1); break;
    case "rotate3d": out.rot=inv*120*I; out.scale=1-inv*0.25*I; break;
    case "liquid": out.scale=1+inv*0.25*I; out.blur=inv*6*I; out.clipShape={type:"circle",prog:Math.min(1,e*1.4),soft}; break;
    case "inkspread": out.blur=inv*10*I; out.overlay={color:"#14142b",alpha:inv*0.35*I}; out.clipShape={type:"circle",prog:Math.min(1,e*1.2),soft}; break; // ink: dark wash spreads, no zoom
    case "smokereveal": out.opacity=clamp(e,0,1); out.blur=inv*8*I; out.overlay={color:"#cccccc",alpha:inv*0.25*I}; break;
    case "maskreveal": out.clipShape={type:"rect",prog:e,soft}; out.opacity=clamp(e,0,1); out.blur=inv*8*I; break; // mask: rect wipe + fade + blur
  }
  if(soft)out.blur=(out.blur||0)+inv*10*soft;
  return out;
}
/* FFmpeg mapping for the fade family only (per-clip fade filters — a real
   cross-clip dissolve would need an xfade graph over overlapping inputs,
   which the concat-based exporter does not have; the other transitions
   are listed as skipped instead of faked). */
function ffmpegTransFilter(clip){
  const s=transSettings(clip);if(!s.dur)return"";
  const d=clip.duration||0,td=Math.min(s.dur,d/2);
  if(s.id==="fade"||s.id==="dissolve"||s.id==="crossdissolve"||s.id==="filmdissolve")
    return `,fade=t=in:st=0:d=${td.toFixed(2)},fade=t=out:st=${Math.max(0,d-td).toFixed(2)}:d=${td.toFixed(2)}`;
  if(s.id==="fadeblack")
    return `,fade=t=in:st=0:d=${td.toFixed(2)}:color=black,fade=t=out:st=${Math.max(0,d-td).toFixed(2)}:d=${td.toFixed(2)}:color=black`;
  if(s.id==="fadewhite")
    return `,fade=t=in:st=0:d=${td.toFixed(2)}:color=white,fade=t=out:st=${Math.max(0,d-td).toFixed(2)}:d=${td.toFixed(2)}:color=white`;
  return"";
}

/* ---------- EFFECTS ----------
   Per-clip: clip.fx = {effectId: strength 0..100}. Groups match the
   blueprint. `px` = needs the Canvas-export pixel path (preview shows the
   CSS/overlay approximation); `ov` = preview overlay; `tf` = transform. */
const EFFECT_GROUPS={
  "Blur":["gaussBlur","motionBlur","radialBlur","lensBlur","zoomBlur","directionalBlur"],
  "Glitch":["rgbSplit","digitalGlitch","pixelSort","vhsDist"],
  "Camera / Light / Film":["cameraShake","handheld","zoomShake","cameraFlash","glow","bloom","lensFlare","lightLeak","sunRays","filmGrain","dust","scratches","filmBurn","filmFlicker"],
  "Distortion / Retro / Motion":["wave","ripple","warp","fisheye","swirl","vhs","crt","oldtv","analogNoise","motionTrail","echo","ghosting","strobe"],
  "Shadow / Artistic / Overlay / Color":["dropShadow","longShadow","innerShadow","sketch","cartoon","posterize","halftone","rain","snow","fog","smoke","bokeh","particles","rgbShift","duotone","invert","solarize"],
};
const EFFECT_LABELS={gaussBlur:"Gaussian Blur",motionBlur:"Motion Blur",radialBlur:"Radial Blur",lensBlur:"Lens Blur",zoomBlur:"Zoom Blur",directionalBlur:"Directional Blur",
  rgbSplit:"RGB Split",digitalGlitch:"Digital Glitch",pixelSort:"Pixel Sort",vhsDist:"VHS Distortion",
  cameraShake:"Camera Shake",handheld:"Handheld",zoomShake:"Zoom Shake",cameraFlash:"Camera Flash",
  glow:"Glow",bloom:"Bloom",lensFlare:"Lens Flare",lightLeak:"Light Leak",sunRays:"Sun Rays",
  filmGrain:"Film Grain",dust:"Dust",scratches:"Scratches",filmBurn:"Film Burn",filmFlicker:"Film Flicker",
  wave:"Wave",ripple:"Ripple",warp:"Warp",fisheye:"Fisheye",swirl:"Swirl",
  vhs:"VHS",crt:"CRT",oldtv:"Old TV",analogNoise:"Analog Noise",
  motionTrail:"Motion Trail",echo:"Echo",ghosting:"Ghosting",strobe:"Strobe",
  dropShadow:"Drop Shadow",longShadow:"Long Shadow",innerShadow:"Inner Shadow",
  sketch:"Sketch",cartoon:"Cartoon-style edge",posterize:"Posterize",halftone:"Halftone",
  rain:"Rain",snow:"Snow",fog:"Fog",smoke:"Smoke",bokeh:"Bokeh",particles:"Particles",
  rgbShift:"RGB Shift",duotone:"Duotone",invert:"Invert",solarize:"Solarize"};
/* Merged effect map for the clip under the playhead (per-clip fx wins;
   legacy global S.fx maps onto the same ids so old projects keep working). */
function activeClipFx(){
  const hit=activeVideoAt(S.curTime);
  const out={};
  if(S.fx.blur)out.gaussBlur=S.fxStrength;
  if(S.fx.glow)out.glow=S.fxStrength;
  if(S.fx.glitch)out.digitalGlitch=S.fxStrength;
  if(S.fx.grain)out.filmGrain=S.fxStrength;
  if(S.fx.rgb)out.rgbSplit=S.fxStrength;
  if(S.fx.vhs){out.vhsDist=S.fxStrength;out.filmGrain=Math.max(out.filmGrain||0,S.fxStrength);}
  if(S.fx.vignette)out.vignette=S.fxStrength;
  if(hit&&hit.clip&&hit.clip.fx)Object.assign(out,hit.clip.fx);
  return out;
}
function clipFxOf(clip){return (clip&&clip.fx)||{};}

/* ---------- FILTERS (all 35 named) ----------
   Each filter is real color math: {brightness, contrast, saturation,
   exposure, temperature, tint, highlights, shadows, sepia, hue, pixel,
   duotone, posterize, swatch}. Preview: cssFilterString() (+ pixel
   filters approximated in refreshVideoStyle). Canvas export: the same
   params feed applyGradePixels(). FFmpeg: ffmpegEqFull() maps them to eq/hue. */
const FILTERS={
  Normal:{brightness:100,contrast:100,saturation:100,swatch:"#888888"},
  Cinematic:{brightness:98,contrast:118,saturation:92,temperature:8,highlights:-12,shadows:12,swatch:"#3a4a6b"},
  Hollywood:{brightness:100,contrast:122,saturation:105,temperature:5,highlights:-8,shadows:8,swatch:"#1f2a44"},
  "Teal & Orange":{brightness:102,contrast:115,saturation:125,temperature:-18,tint:12,highlights:5,shadows:-5,swatch:"#0e7c86"},
  Moody:{brightness:88,contrast:125,saturation:75,temperature:-10,highlights:-20,shadows:15,swatch:"#2b2b3a"},
  "Dark Cinematic":{brightness:82,contrast:130,saturation:80,temperature:-5,highlights:-25,shadows:20,swatch:"#111118"},
  Vintage:{brightness:105,contrast:90,saturation:80,temperature:25,tint:10,highlights:-10,shadows:15,sepia:18,swatch:"#c9a876"},
  "Retro 80s":{brightness:104,contrast:105,saturation:140,temperature:15,hue:8,swatch:"#ff5da2"},
  "Retro 90s":{brightness:102,contrast:98,saturation:110,temperature:5,sepia:10,swatch:"#7fb069"},
  VHS:{brightness:98,contrast:110,saturation:130,temperature:10,tint:15,highlights:-15,shadows:10,swatch:"#5a5a8a"},
  "Black & White":{brightness:100,contrast:115,saturation:0,swatch:"#555555"},
  Sepia:{brightness:103,contrast:95,saturation:60,sepia:65,swatch:"#a67c52"},
  Warm:{brightness:102,contrast:102,saturation:115,temperature:35,tint:5,swatch:"#e8a04c"},
  Cool:{brightness:100,contrast:105,saturation:105,temperature:-30,tint:-5,swatch:"#5aa9e6"},
  "Golden Hour":{brightness:106,contrast:108,saturation:130,temperature:45,tint:8,highlights:8,swatch:"#f4a259"},
  Sunset:{brightness:103,contrast:112,saturation:135,temperature:40,tint:20,highlights:5,shadows:-5,swatch:"#e76f51"},
  Night:{brightness:80,contrast:120,saturation:85,temperature:-25,tint:-10,highlights:-15,shadows:20,swatch:"#0b1026"},
  "Blue Hour":{brightness:88,contrast:112,saturation:95,temperature:-35,tint:5,highlights:-10,shadows:10,swatch:"#264653"},
  "Film Look":{brightness:100,contrast:108,saturation:90,temperature:8,highlights:-8,shadows:8,sepia:8,swatch:"#6b705c"},
  Portrait:{brightness:105,contrast:102,saturation:108,temperature:12,highlights:8,shadows:-5,swatch:"#f2c9a0"},
  Natural:{brightness:101,contrast:102,saturation:102,swatch:"#8ab17d"},
  Matte:{brightness:104,contrast:85,saturation:85,temperature:5,highlights:-5,shadows:10,swatch:"#b8b8b8"},
  Faded:{brightness:108,contrast:80,saturation:80,temperature:5,highlights:10,shadows:10,swatch:"#d8d8d8"},
  Pastel:{brightness:108,contrast:90,saturation:105,temperature:10,highlights:12,swatch:"#f7c8d8"},
  "High Contrast":{brightness:100,contrast:140,saturation:110,highlights:-5,shadows:-5,swatch:"#111111"},
  Dreamy:{brightness:110,contrast:88,saturation:95,temperature:10,highlights:15,shadows:10,swatch:"#e0bbe4"},
  "Soft Glow":{brightness:108,contrast:95,saturation:105,temperature:8,highlights:12,swatch:"#ffe5d9"},
  Cyberpunk:{brightness:100,contrast:125,saturation:150,temperature:-20,hue:15,highlights:5,shadows:-10,swatch:"#ff2e88"},
  Neon:{brightness:105,contrast:120,saturation:170,temperature:-10,hue:10,swatch:"#39ff14"},
  Horror:{brightness:78,contrast:135,saturation:60,temperature:-15,highlights:-25,shadows:25,swatch:"#1a1a1a"},
  Documentary:{brightness:100,contrast:110,saturation:95,temperature:0,highlights:-5,shadows:5,swatch:"#606c38"},
  Wedding:{brightness:110,contrast:95,saturation:95,temperature:25,tint:10,highlights:8,shadows:8,swatch:"#fff1e6"},
  Travel:{brightness:104,contrast:112,saturation:125,temperature:5,highlights:5,swatch:"#2a9d8f"},
  Food:{brightness:106,contrast:110,saturation:140,temperature:20,highlights:8,swatch:"#e07a5f"},
  Landscape:{brightness:103,contrast:115,saturation:135,temperature:-8,highlights:5,shadows:-5,swatch:"#2d6a4f"},
  "Street Photography":{brightness:100,contrast:120,saturation:85,temperature:0,highlights:-10,shadows:10,swatch:"#6c757d"},
};
const FILTER_NAMES=Object.keys(FILTERS);

/* ---------- CURVES / HSL / WHEELS / BALANCE / LUT (pixel math) ---------- */
function curveLUT(points){
  const lut=new Uint8Array(256);
  const pts=[...points].sort((a,b)=>a[0]-b[0]);
  for(let x=0;x<256;x++){
    if(x<=pts[0][0]){lut[x]=clamp(pts[0][1],0,255);continue;}
    if(x>=pts[pts.length-1][0]){lut[x]=clamp(pts[pts.length-1][1],0,255);continue;}
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i],b=pts[i+1];
      if(x>=a[0]&&x<=b[0]){const f=(x-a[0])/Math.max(1,b[0]-a[0]);lut[x]=clamp(Math.round(a[1]+(b[1]-a[1])*f),0,255);break;}
    }
  }
  return lut;
}
function rgb2hsl(r,g,b){
  r/=255;g/=255;b/=255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h=0,s=0;const l=(mx+mn)/2;
  if(mx!==mn){const d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);
    if(mx===r)h=(g-b)/d+(g<b?6:0);else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;}
  return[h,s,l];
}
function hsl2rgb(h,s,l){
  h=((h%360)+360)%360/360;
  const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;
  const f=t=>{if(t<0)t+=1;if(t>1)t-=1;
    if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
  return[Math.round(f(h+1/3)*255),Math.round(f(h)*255),Math.round(f(h-1/3)*255)];
}
/* Parse a .cube LUT file (Adobe/Resolve format) on-device. Returns
   {size, data:Float32Array(size^3*3), title} or {error}. */
function parseCube(text){
  const lines=text.split(/\r?\n/);
  let size=0,title="";const data=[];
  for(const raw of lines){
    const line=raw.trim();
    if(!line||line.startsWith("#"))continue;
    if(/^TITLE/i.test(line)){title=line.replace(/^TITLE\s*/i,"").replace(/^"|"$/g,"");continue;}
    if(/^LUT_3D_SIZE/i.test(line)){size=parseInt(line.split(/\s+/)[1],10);continue;}
    if(/^(LUT_1D_SIZE|DOMAIN_MIN|DOMAIN_MAX)/i.test(line))continue;
    const parts=line.split(/\s+/).map(Number);
    if(parts.length>=3&&parts.every(n=>isFinite(n)))data.push(parts[0],parts[1],parts[2]);
  }
  if(!size||data.length<size*size*size*3)return{error:"Not a valid 3D .cube LUT (expected LUT_3D_SIZE "+(size||"?")+", got "+Math.floor(data.length/3)+" entries)"};
  return{size,data:new Float32Array(data.slice(0,size*size*size*3)),title:title||"Custom LUT"};
}
function lutApply(lut,r,g,b){
  const n=lut.size,d=lut.data;
  const fr=clamp(r/255,0,1)*(n-1),fg=clamp(g/255,0,1)*(n-1),fb=clamp(b/255,0,1)*(n-1);
  const x0=Math.floor(fr),y0=Math.floor(fg),z0=Math.floor(fb);
  const x1=Math.min(n-1,x0+1),y1=Math.min(n-1,y0+1),z1=Math.min(n-1,z0+1);
  const fx=fr-x0,fy=fg-y0,fz=fb-z0;
  const idx=(x,y,z)=>((z*n+y)*n+x)*3;
  const out=[0,0,0];
  for(let c=0;c<3;c++){
    const c000=d[idx(x0,y0,z0)+c],c100=d[idx(x1,y0,z0)+c],c010=d[idx(x0,y1,z0)+c],c110=d[idx(x1,y1,z0)+c];
    const c001=d[idx(x0,y0,z1)+c],c101=d[idx(x1,y0,z1)+c],c011=d[idx(x0,y1,z1)+c],c111=d[idx(x1,y1,z1)+c];
    const v=(((c000*(1-fx)+c100*fx)*(1-fy)+(c010*(1-fx)+c110*fx)*fy)*(1-fz)
      +((c001*(1-fx)+c101*fx)*(1-fy)+(c011*(1-fx)+c111*fx)*fy)*fz);
    out[c]=clamp(Math.round(v*255),0,255);
  }
  return out;
}
/* Is any pixel-level grading active (beyond what CSS already shows)? */
function gradeActive(){
  const c=S.color;
  return (S.filterId&&S.filterId!=="Normal")||c.vibrance!==0||c.gamma!==100||c.whites!==0||c.blacks!==0
    ||c.dehaze!==0||c.fade!==0||c.vignette!==0||c.noise!==0||c.sharpness!==0
    ||(S.hsl&&(S.hsl.hue||S.hsl.sat||S.hsl.light))
    ||(S.balance&&(S.balance.r||S.balance.g||S.balance.b))
    ||(S.wheels&&((S.wheels.sh.x||S.wheels.sh.y)||(S.wheels.mid.x||S.wheels.mid.y)||(S.wheels.hi.x||S.wheels.hi.y)))
    ||S.lut||curveChanged();
}
function curveChanged(){
  for(const ch of["rgb","r","g","b"]){
    const pts=S.curves[ch]||[];
    if(pts.length!==2||pts[0][0]!==0||pts[0][1]!==0||pts[1][0]!==255||pts[1][1]!==255)return true;
  }
  return false;
}
/* Full grading pixel pass. data = ImageData.data (Uint8ClampedArray),
   w/h = frame size. Applies, in order: base sliders (brightness/
   contrast/saturation/exposure/temp/tint/highlights/shadows/whites/
   blacks/gamma/vibrance/dehaze/fade) + filter layer + curves + HSL +
   wheels + balance + LUT + vignette + sharpen + spatial denoise.
   Traditional signal processing throughout — no AI anywhere. */
function applyGradePixels(data,w,h){
  const c=S.color,fp=filterParams();
  const bMul=(c.brightness/100)*(1+c.exposure/200)*(fp?fp.brightness/100:1);
  const ctMul=(c.contrast/100)*(fp?fp.contrast/100:1);
  const stMul=(c.saturation/100)*(fp?fp.saturation/100:1);
  const tempK=((c.temperature+(fp?fp.temperature:0))/100);
  const tintK=((c.tint+(fp?fp.tint:0))/100);
  const hiK=(c.highlights+(fp?fp.highlights:0))/100, shK=(c.shadows+(fp?fp.shadows:0))/100;
  const whK=c.whites/100, blK=c.blacks/100;
  const gam=100/(c.gamma||100);
  const vib=c.vibrance/100, deh=c.dehaze/100, fadeK=c.fade/100;
  const sepK=fp?fp.sepia/100:0, hueK=fp?fp.hue:0;
  const luts={rgb:curveLUT(S.curves.rgb),r:curveLUT(S.curves.r),g:curveLUT(S.curves.g),b:curveLUT(S.curves.b)};
  const hsl=S.hsl||{hue:0,sat:0,light:0}, bal=S.balance||{r:0,g:0,b:0}, wh=S.wheels||{};
  const lutI=S.lut?(S.lutIntensity/100):0;
  const vigK=c.vignette/100, cx=w/2, cy=h/2, maxR=Math.sqrt(cx*cx+cy*cy);
  const sharpK=c.sharpness/100, noiseK=c.noise/100;
  const src=new Uint8ClampedArray(data); // source copy for sharpen/denoise neighbours
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      let r=src[i],g=src[i+1],b=src[i+2];
      /* spatial denoise: 3x3 average blended by strength (traditional) */
      if(noiseK>0){
        let sr=0,sg=0,sb=0,n=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;
          const j=(yy*w+xx)*4;sr+=src[j];sg+=src[j+1];sb+=src[j+2];n++;
        }
        r=r*(1-noiseK)+(sr/n)*noiseK;g=g*(1-noiseK)+(sg/n)*noiseK;b=b*(1-noiseK)+(sb/n)*noiseK;
      }
      /* sharpen: unsharp via 3x3 Laplacian */
      if(sharpK>0){
        const lap=(ch)=>{
          let s=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
            if(dx===0&&dy===0)continue;const xx=x+dx,yy=y+dy;
            if(xx<0||yy<0||xx>=w||yy>=h)continue;s+=src[(yy*w+xx)*4+ch];}
          return src[i+ch]*4-s*0.5;};
        r+=lap(0)*sharpK*0.5;g+=lap(1)*sharpK*0.5;b+=lap(2)*sharpK*0.5;
      }
      /* brightness / contrast / gamma */
      r=((r/255-0.5)*ctMul+0.5)*255*bMul;g=((g/255-0.5)*ctMul+0.5)*255*bMul;b=((b/255-0.5)*ctMul+0.5)*255*bMul;
      r=255*Math.pow(clamp(r/255,0,1),gam);g=255*Math.pow(clamp(g/255,0,1),gam);b=255*Math.pow(clamp(b/255,0,1),gam);
      /* temperature (warm/cool) + tint */
      r+=tempK*22; b-=tempK*22; g+=tintK*10; r-=tintK*6; b+=tintK*6;
      /* highlights / shadows / whites / blacks (luminance-weighted) */
      const lum=(0.299*r+0.587*g+0.114*b)/255;
      const hiW=Math.pow(lum,2), shW=Math.pow(1-lum,2);
      r+=hiK*40*hiW+shK*40*shW+whK*30*hiW+blK*30*shW;
      g+=hiK*40*hiW+shK*40*shW+whK*30*hiW+blK*30*shW;
      b+=hiK*40*hiW+shK*40*shW+whK*30*hiW+blK*30*shW;
      /* saturation + vibrance (vibrance protects already-saturated pixels) */
      const avg=(r+g+b)/3;
      r=avg+(r-avg)*stMul;g=avg+(g-avg)*stMul;b=avg+(b-avg)*stMul;
      if(vib!==0){const sat=Math.max(r,g,b)-Math.min(r,g,b);const prot=1-clamp(sat/255,0,1)*0.7;
        r=avg+(r-avg)*(1+vib*prot);g=avg+(g-avg)*(1+vib*prot);b=avg+(b-avg)*(1+vib*prot);}
      /* dehaze: extra midtone contrast + saturation */
      if(deh!==0){const m=0.5;const f=1+deh*0.35;
        r=((r/255-m)*f+m)*255;g=((g/255-m)*f+m)*255;b=((b/255-m)*f+m)*255;
        const a2=(r+g+b)/3;r=a2+(r-a2)*(1+deh*0.3);g=a2+(g-a2)*(1+deh*0.3);b=a2+(b-a2)*(1+deh*0.3);}
      /* fade: lift blacks toward white */
      if(fadeK>0){r+=(255-r)*fadeK*0.35*(1-lum);g+=(255-g)*fadeK*0.35*(1-lum);b+=(255-b)*fadeK*0.35*(1-lum);}
      /* sepia (filter layer) */
      if(sepK>0){const nr=0.393*r+0.769*g+0.189*b,ng=0.349*r+0.686*g+0.168*b,nb=0.272*r+0.534*g+0.131*b;
        r=r*(1-sepK)+nr*sepK;g=g*(1-sepK)+ng*sepK;b=b*(1-sepK)+nb*sepK;}
      /* curves (per-channel LUTs, then the RGB master LUT) */
      r=luts.r[clamp(Math.round(r),0,255)];g=luts.g[clamp(Math.round(g),0,255)];b=luts.b[clamp(Math.round(b),0,255)];
      r=luts.rgb[clamp(Math.round(r),0,255)];g=luts.rgb[clamp(Math.round(g),0,255)];b=luts.rgb[clamp(Math.round(b),0,255)];
      /* HSL */
      if(hsl.hue||hsl.sat||hsl.light){
        let[hh,ss,ll]=rgb2hsl(clamp(r,0,255),clamp(g,0,255),clamp(b,0,255));
        hh+=hsl.hue;ss=clamp(ss+hsl.sat/100,0,1);ll=clamp(ll+hsl.light/100,0,1);
        [r,g,b]=hsl2rgb(hh,ss,ll);}
      /* filter hue shift */
      if(hueK){let[hh,ss,ll]=rgb2hsl(clamp(r,0,255),clamp(g,0,255),clamp(b,0,255));[r,g,b]=hsl2rgb(hh+hueK,ss,ll);}
      /* color wheels: push shadows/midtones/highlights by the wheel offset */
      if(wh.sh&&(wh.sh.x||wh.sh.y)){const wgt=Math.pow(1-lum,2)*(wh.sh.amt/100)*0.6;
        r+=wh.sh.x*wgt*60;g+=wh.sh.y*wgt*60;b-=wh.sh.x*wgt*30;}
      if(wh.mid&&(wh.mid.x||wh.mid.y)){const wgt=(1-Math.pow(lum-0.5,2)*4)*(wh.mid.amt/100)*0.6;
        r+=wh.mid.x*wgt*60;g+=wh.mid.y*wgt*60;b-=wh.mid.x*wgt*30;}
      if(wh.hi&&(wh.hi.x||wh.hi.y)){const wgt=Math.pow(lum,2)*(wh.hi.amt/100)*0.6;
        r+=wh.hi.x*wgt*60;g+=wh.hi.y*wgt*60;b-=wh.hi.x*wgt*30;}
      /* color balance */
      r+=bal.r*0.6;g+=bal.g*0.6;b+=bal.b*0.6;
      /* LUT (trilinear), blended by intensity */
      if(S.lut&&lutI>0){const[lr,lg,lb]=lutApply(S.lut,clamp(r,0,255),clamp(g,0,255),clamp(b,0,255));
        r=r*(1-lutI)+lr*lutI;g=g*(1-lutI)+lg*lutI;b=b*(1-lutI)+lb*lutI;}
      /* vignette */
      if(vigK>0){const dx=(x-cx)/maxR,dy=(y-cy)/maxR;const d2=dx*dx+dy*dy;
        const v=1-vigK*0.55*Math.max(0,d2-0.15);r*=v;g*=v;b*=v;}
      data[i]=clamp(Math.round(r),0,255);data[i+1]=clamp(Math.round(g),0,255);data[i+2]=clamp(Math.round(b),0,255);
    }
  }
  /* filter pixel ops that need the graded frame (duotone / invert /
     solarize / posterize) — applied after grading so they compose. */
  const fp2=filterParams();
  if(fp2&&fp2.pixel){
    for(let i=0;i<data.length;i+=4){
      const r=data[i],g=data[i+1],b=data[i+2];
      if(fp2.pixel==="invert"){data[i]=255-r;data[i+1]=255-g;data[i+2]=255-b;}
      else if(fp2.pixel==="solarize"){data[i]=r>128?255-r:r;data[i+1]=g>128?255-g:g;data[i+2]=b>128?255-b:b;}
      else if(fp2.pixel==="posterize"){const lv=fp2.posterize||4;const st=256/lv;
        data[i]=Math.floor(r/st)*st;data[i+1]=Math.floor(g/st)*st;data[i+2]=Math.floor(b/st)*st;}
      else if(fp2.pixel==="duotone"&&fp2.duotone){
        const lum=(0.299*r+0.587*g+0.114*b)/255;
        const c1=fp2.duotone[0],c2=fp2.duotone[1];
        data[i]=Math.round(c1[0]+(c2[0]-c1[0])*lum);data[i+1]=Math.round(c1[1]+(c2[1]-c1[1])*lum);data[i+2]=Math.round(c1[2]+(c2[2]-c1[2])*lum);}
    }
  }
}

/* ---------- EFFECTS pixel math (Canvas export) ---------- */
function _seededRand(i,salt,t){const v=Math.sin(i*127.1+salt*311.7+t*13.7)*43758.5453;return v-Math.floor(v);}
/* Distortion remap: returns a new Uint8ClampedArray with the source
   resampled through the displacement of the active distortion effects. */
function remapDistort(src,w,h,fx,t){
  const out=new Uint8ClampedArray(src.length);
  const cx=w/2,cy=h/2;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let sx=x,sy=y;
    const dx=(x-cx)/Math.max(1,cx),dy=(y-cy)/Math.max(1,cy);
    const r2=dx*dx+dy*dy;
    if(fx.fisheye){const k=1+(fx.fisheye/100)*0.55*r2;sx=cx+dx*cx/k;sy=cy+dy*cy/k;}
    if(fx.swirl){const ang=(fx.swirl/100)*1.6*(1-Math.sqrt(r2));const ca=Math.cos(ang),sa=Math.sin(ang);
      sx=cx+(dx*cx)*ca-(dy*cy)*sa;sy=cy+(dx*cx)*sa+(dy*cy)*ca;}
    if(fx.wave){sx+=Math.sin(y*0.05+t*6)*(fx.wave/100)*14;sy+=Math.cos(x*0.04+t*5)*(fx.wave/100)*10;}
    if(fx.ripple){const d=Math.sqrt((x-cx)*(x-cx)+(y-cy)*(y-cy));
      const off=Math.sin(d*0.09-t*8)*(fx.ripple/100)*10; sx+=off*dx; sy+=off*dy;}
    if(fx.warp){sx+=Math.sin(y*0.02+t*3)*(fx.warp/100)*18;sy+=Math.sin(x*0.03+t*2)*(fx.warp/100)*12;}
    sx=clamp(Math.round(sx),0,w-1);sy=clamp(Math.round(sy),0,h-1);
    const si=(sy*w+sx)*4,di=(y*w+x)*4;
    out[di]=src[si];out[di+1]=src[si+1];out[di+2]=src[si+2];out[di+3]=src[si+3];
  }
  return out;
}
let _prevFxFrame=null; // previous exported frame, for echo / ghosting / motion trail
function applyFxPixels(data,w,h,fx,t){
  if(!fx)return;
  const hasRemap=fx.wave||fx.ripple||fx.warp||fx.fisheye||fx.swirl;
  let work=data;
  if(hasRemap){const rem=remapDistort(data,w,h,fx,t);data.set(rem);work=data;}
  const src=new Uint8ClampedArray(data);
  /* Per-type blur samplers. gauss = 3x3 box; lens = wider 5x5 box (soft
     bokeh-like wash); zoom = samples along the radial line from centre;
     radial = samples along the arc around the centre (rotational smear);
     directional = horizontal 5-tap; motion = diagonal 5-tap. Each type
     blends toward its own average, so they are measurably different. */
  const avgBox=(x,y,rad)=>{let sr=0,sg=0,sb=0,n=0;
    for(let dy=-rad;dy<=rad;dy++)for(let dx=-rad;dx<=rad;dx++){
      const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;
      const j=(yy*w+xx)*4;sr+=src[j];sg+=src[j+1];sb+=src[j+2];n++;}
    return[sr/n,sg/n,sb/n];};
  const avgLine=(x,y,dx,dy,steps)=>{let sr=0,sg=0,sb=0,n=0;
    for(let s=-steps;s<=steps;s++){const xx=x+dx*s,yy=y+dy*s;
      if(xx<0||yy<0||xx>=w||yy>=h)continue;
      const j=(yy*w+xx)*4;sr+=src[j];sg+=src[j+1];sb+=src[j+2];n++;}
    return[sr/n,sg/n,sb/n];};
  const blendBlur=(r,g,b,a,k)=>[r*(1-k)+a[0]*k,g*(1-k)+a[1]*k,b*(1-k)+a[2]*k];
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      let r=src[i],g=src[i+1],b=src[i+2];
      if(fx.gaussBlur){const k=fx.gaussBlur/100*0.85;[r,g,b]=blendBlur(r,g,b,avgBox(x,y,1),k);}
      if(fx.lensBlur){const k=fx.lensBlur/100*0.85;[r,g,b]=blendBlur(r,g,b,avgBox(x,y,2),k);}
      if(fx.zoomBlur){const dx=(x-w/2)/Math.max(1,w/2),dy=(y-h/2)/Math.max(1,h/2);
        const k=fx.zoomBlur/100*0.8;[r,g,b]=blendBlur(r,g,b,avgLine(x,y,Math.round(dx*5),Math.round(dy*5),1),k);}
      if(fx.radialBlur){const dx=(x-w/2)/Math.max(1,w/2),dy=(y-h/2)/Math.max(1,h/2);
        const k=fx.radialBlur/100*0.8;[r,g,b]=blendBlur(r,g,b,avgLine(x,y,Math.round(-dy*5),Math.round(dx*5),1),k);}
      if(fx.directionalBlur){const k=fx.directionalBlur/100*0.85;[r,g,b]=blendBlur(r,g,b,avgLine(x,y,2,0,2),k);}
      if(fx.motionBlur){const k=fx.motionBlur/100*0.85;[r,g,b]=blendBlur(r,g,b,avgLine(x,y,2,2,2),k);}
      if(fx.rgbSplit||fx.rgbShift){
        const sh=Math.round(((fx.rgbSplit||fx.rgbShift)/100)*8);
        const li=i-sh*4,ri=i+sh*4;
        if(li>=0&&ri<data.length){r=src[li];b=src[ri+2];}}
      if(fx.digitalGlitch){ /* whole 8px-tall bands shift sideways */
        const st=fx.digitalGlitch/100;
        const band=Math.floor(y/8);
        if(_seededRand(band,5,t)>1-st*0.7){
          const off=Math.round((_seededRand(band,6,t)-0.5)*40*st);
          const xx=clamp(x+off,0,w-1),j=(y*w+xx)*4;
          r=src[j];g=src[j+1];b=src[j+2];}}
      if(fx.pixelGlitch){ /* whole 8x8 blocks shift sideways, seeded per block */
        const st=fx.pixelGlitch/100;
        const bx=Math.floor(x/8),by=Math.floor(y/8);
        if(_seededRand(by*131+bx,7,t)>1-st*0.6){
          const off=Math.round((_seededRand(bx,8,t)-0.5)*48*st);
          const xx=clamp(x+off,0,w-1),j=(y*w+xx)*4;
          r=src[j];g=src[j+1];b=src[j+2];}}
      if(fx.signalError){ /* channel corruption: R/B swap in seeded bands + brightness jitter */
        const st=fx.signalError/100;
        const band=Math.floor(y/6);
        if(_seededRand(band,9,t)>1-st*0.8){const tmp=r;r=b;b=tmp;}
        if(_seededRand(band,10,t)>1-st*0.5){const f=0.6+_seededRand(x,11,t)*0.8;r*=f;g*=f;b*=f;}}
      if(fx.vhsDist){ /* chromatic shift + scanlines */
        const sh=3;const li=i-sh*4;
        if(li>=0){r=src[li];}
        if(y%4===0){r*=0.82;g*=0.82;b*=0.82;}}
      if(fx.vhs){ /* tracking noise: whole rows jitter in brightness, slight shift */
        const st=fx.vhs/100;
        const jit=1+(_seededRand(y,15,t)-0.5)*0.5*st;
        r*=jit;g*=jit;b*=jit;
        const li=i-2*4;if(li>=0&&_seededRand(y,16,t)>0.7){r=src[li];}}
      if(fx.crt){ /* strong scanlines + curved-screen edge darkening + green tint */
        if(y%3===0){r*=0.7;g*=0.7;b*=0.7;}
        const dx=(x-w/2)/(w/2),dy=(y-h/2)/(h/2),d2=dx*dx+dy*dy;
        const k=1-(fx.crt/100)*0.35*Math.max(0,d2-0.4);
        r*=k;g*=k*1.03;b*=k;}
      if(fx.oldtv){ /* desaturated + scanlines + slow flicker */
        const st=fx.oldtv/100;
        const avg=(r+g+b)/3;
        r=avg+(r-avg)*(1-0.35*st);g=avg+(g-avg)*(1-0.35*st);b=avg+(b-avg)*(1-0.35*st);
        if(y%4===0){r*=0.85;g*=0.85;b*=0.85;}
        const f=1+Math.sin(t*17)*0.05*st;r*=f;g*=f;b*=f;}
      if(fx.analogNoise){ /* fine per-pixel noise */
        const n=((_seededRand(i,11,t)-0.5)*36*(fx.analogNoise/100));
        r+=n;g+=n;b+=n;}
      if(fx.filmGrain){ /* coarser grain: one noise value per 4x4 block */
        const bi=Math.floor(x/4)+Math.floor(y/4)*Math.ceil(w/4);
        const n=((_seededRand(bi,12,t)-0.5)*30*(fx.filmGrain/100));
        r+=n;g+=n;b+=n;}
      if(fx.glow){ /* lift bright highlights */
        const lum=(0.299*r+0.587*g+0.114*b)/255;
        if(lum>0.55){const k=(fx.glow/100)*(lum-0.55)*1.6;
          r+=40*k;g+=40*k;b+=40*k;}}
      if(fx.bloom){ /* wider halo: lower threshold, stronger lift, neighbour bleed */
        const lum=(0.299*r+0.587*g+0.114*b)/255;
        if(lum>0.4){const k=(fx.bloom/100)*(lum-0.4)*2.4;
          r+=55*k;g+=55*k;b+=55*k;}
        const k2=fx.bloom/100*0.25;
        const ax=((x+1<w?src[i+4]:r)+(y+1<h?src[i+w*4]:r))/2;
        const ay=((x+1<w?src[i+5]:g)+(y+1<h?src[i+w*4+1]:g))/2;
        const az=((x+1<w?src[i+6]:b)+(y+1<h?src[i+w*4+2]:b))/2;
        r=r*(1-k2)+ax*k2;g=g*(1-k2)+ay*k2;b=b*(1-k2)+az*k2;}
      if(fx.dust){ /* white/black specks, per pixel */
        if(_seededRand(i,13,t)>1-0.0008*(fx.dust/100)){r=230;g=230;b=230;}
        else if(_seededRand(i,14,t)>1-0.0005*(fx.dust/100)){r=20;g=20;b=20;}}
      if(fx.scratches){ /* vertical hairlines: seeded per column, so they run the full height */
        if(_seededRand(x,17,t)>1-0.004*(fx.scratches/100)){r=235;g=235;b=235;}
        else if(_seededRand(x,18,t)>1-0.002*(fx.scratches/100)){r=25;g=25;b=25;}}
      if(fx.filmBurn){r+=26*(fx.filmBurn/100)*(1-y/h);g+=10*(fx.filmBurn/100)*(1-y/h);}
      if(fx.filmFlicker){const f=1+Math.sin(t*23)*0.06*(fx.filmFlicker/100);r*=f;g*=f;b*=f;}
      if(fx.strobe){const on=Math.floor(t*6)%2===0;if(!on){r*=0.25;g*=0.25;b*=0.25;}}
      if(fx.sketch){
        const lum=(0.299*r+0.587*g+0.114*b);
        const lap=Math.abs(src[i]-((x+1<w)?src[i+4]:src[i]))+Math.abs(src[i]-((y+1<h)?src[i+w*4]:src[i]));
        const e=clamp(255-lap*3,0,255);const v=clamp(lum*0.4+e*0.6,0,255);
        r=v;g=v;b=v;}
      if(fx.cartoon){
        const lv=4,st=256/lv;
        r=Math.floor(r/st)*st;g=Math.floor(g/st)*st;b=Math.floor(b/st)*st;
        const lap=Math.abs(src[i]-((x+1<w)?src[i+4]:src[i]));
        if(lap>40){r*=0.3;g*=0.3;b*=0.3;}}
      if(fx.posterize){const lv=4,st=256/lv;
        r=Math.floor(r/st)*st;g=Math.floor(g/st)*st;b=Math.floor(b/st)*st;}
      if(fx.innerShadow){const ex=Math.min(x,w-1-x),ey=Math.min(y,h-1-y);
        const ed=Math.min(ex,ey),k=1-(fx.innerShadow/100)*0.7*Math.max(0,1-ed/40);
        r*=k;g*=k;b*=k;}
      if(fx.dropShadow||fx.longShadow){/* drop/long shadow are draw-level: drawn as an offset dark copy in drawFrame; nothing to do per pixel */}
      if(fx.halftone){const dot=((x%6<3)&&(y%6<3))?1:0.82;r*=dot;g*=dot;b*=dot;}
      if(fx.invert){r=255-r;g=255-g;b=255-b;}
      if(fx.solarize){r=r>128?255-r:r;g=g>128?255-g:g;b=b>128?255-b:b;}
      if(fx.duotone){const lum=(0.299*r+0.587*g+0.114*b)/255;
        r=20+180*lum;g=20+120*lum;b=60+120*lum;}
      if(fx.rgbShift){/* RGB Shift = the same channel shift as RGB Split, plus a saturation boost, so it is not a copy */
        const avg=(r+g+b)/3,s=1+0.3*(fx.rgbShift/100);
        r=avg+(r-avg)*s;g=avg+(g-avg)*s;b=avg+(b-avg)*s;}
      data[i]=clamp(Math.round(r),0,255);data[i+1]=clamp(Math.round(g),0,255);data[i+2]=clamp(Math.round(b),0,255);
    }
  }
  /* pixel sort: sort 8px horizontal bands by luminance (real sort, in place) */
  if(fx.pixelSort){
    const frac=fx.pixelSort/100;
    for(let y=0;y<h;y++){
      if(_seededRand(y,21,t)>frac)continue;
      for(let bx=0;bx<w;bx+=8){
        const seg=[];
        for(let x=bx;x<Math.min(bx+8,w);x++){const i=(y*w+x)*4;seg.push([0.299*data[i]+0.587*data[i+1]+0.114*data[i+2],data[i],data[i+1],data[i+2]]);}
        seg.sort((a,b2)=>a[0]-b2[0]);
        seg.forEach((p,k)=>{const i=(y*w+bx+k)*4;data[i]=p[1];data[i+1]=p[2];data[i+2]=p[3];});
      }
    }
  }
  /* pixelate: 8px block average (used by the pixel-glitch transition) */
  if(fx.pixelate){
    const bs=8;
    for(let by=0;by<h;by+=bs)for(let bx=0;bx<w;bx+=bs){
      let sr=0,sg=0,sb=0,n=0;
      for(let yy=by;yy<Math.min(by+bs,h);yy++)for(let xx=bx;xx<Math.min(bx+bs,w);xx++){
        const ii=(yy*w+xx)*4;sr+=data[ii];sg+=data[ii+1];sb+=data[ii+2];n++;}
      const ar=sr/n,ag=sg/n,ab=sb/n;
      for(let yy=by;yy<Math.min(by+bs,h);yy++)for(let xx=bx;xx<Math.min(bx+bs,w);xx++){
        const ii=(yy*w+xx)*4;data[ii]=ar;data[ii+1]=ag;data[ii+2]=ab;}
    }
  }
  /* echo / ghosting / motion trail: blend with the previous exported frame.
     echo = soft repeat; ghosting = repeat displaced a few px (a double
     image); motion trail = the strongest, longest smear. */
  const echoK=(fx.echo||0)/100*0.5, ghostK=(fx.ghosting||0)/100*0.6, trailK=(fx.motionTrail||0)/100*0.8;
  const trail=Math.max(echoK,ghostK,trailK);
  if(trail>0){
    if(_prevFxFrame&&_prevFxFrame.length===data.length){
      const off=ghostK===trail?6:0; // ghosting displaces the previous frame
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
        const i=(yy*w+xx)*4, px=clamp(xx-off,0,w-1), pi=(yy*w+px)*4;
        data[i]=data[i]*(1-trail)+_prevFxFrame[pi]*trail;
        data[i+1]=data[i+1]*(1-trail)+_prevFxFrame[pi+1]*trail;
        data[i+2]=data[i+2]*(1-trail)+_prevFxFrame[pi+2]*trail;}
    }
    _prevFxFrame=new Uint8ClampedArray(data);
  }
}
/* One call from the Canvas export after the main clip is drawn: runs the
   grading + per-clip effect pixel math on the export canvas, then draws
   the overlay effects (particles / flare / leak / rays / fog) on top. */
function applyCanvasFramePixels(ctx,w,h,clip,t){
  const fx=clipFxOf(clip);
  const needGrade=gradeActive();
  const needFx=Object.keys(fx).length>0;
  if(needGrade||needFx){
    let img;
    try{img=ctx.getImageData(0,0,w,h);}catch(e){return;}
    if(needGrade)applyGradePixels(img.data,w,h);
    if(needFx)applyFxPixels(img.data,w,h,fx,t);
    ctx.putImageData(img,0,0);
  }
  /* overlay effects drawn as 2D shapes (seeded by t so they animate) */
  if(!fx)return;
  const seeded=(i,salt)=>_seededRand(i,salt,t);
  if(fx.rain||fx.snow||fx.particles||fx.bokeh){
    const n=fx.rain?90:fx.snow?70:fx.particles?50:26;
    for(let i=0;i<n;i++){
      const px=seeded(i,1)*w, py=((seeded(i,2)+t*(fx.rain?0.9:fx.snow?0.12:0.05))%1)*h;
      if(fx.rain){ctx.strokeStyle=`rgba(180,220,255,${0.35*(fx.rain/100)})`;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px-3,py+14);ctx.stroke();}
      else if(fx.snow){ctx.fillStyle=`rgba(255,255,255,${0.7*(fx.snow/100)})`;ctx.beginPath();ctx.arc(px,py,1.5+seeded(i,3)*2,0,7);ctx.fill();}
      else if(fx.bokeh){ctx.fillStyle=`rgba(255,220,150,${0.10*(fx.bokeh/100)})`;ctx.beginPath();ctx.arc(px,py,4+seeded(i,3)*14,0,7);ctx.fill();}
      else{ctx.fillStyle=`rgba(255,255,255,${0.25*(fx.particles/100)})`;ctx.fillRect(px,py,2,2);}
    }
  }
  if(fx.fog){ /* low fog: flat gradient hugging the bottom of the frame */
    const g=ctx.createLinearGradient(0,h*0.5,0,h);
    g.addColorStop(0,"rgba(200,200,210,0)");g.addColorStop(1,`rgba(200,200,210,${0.28*((fx.fog)/100)})`);
    ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  }
  if(fx.smoke){ /* smoke: drifting soft blobs instead of a flat gradient */
    for(let i=0;i<8;i++){
      const px=((seeded(i,21)+t*0.02*(1+i%3))%1)*w, py=h*(0.55+seeded(i,22)*0.4);
      const r=w*(0.12+seeded(i,23)*0.15);
      const g=ctx.createRadialGradient(px,py,0,px,py,r);
      g.addColorStop(0,`rgba(210,210,220,${0.16*(fx.smoke/100)})`);g.addColorStop(1,"rgba(210,210,220,0)");
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(px,py,r,0,7);ctx.fill();}
  }
  if(fx.lightLeak){ /* warm wash bleeding in from the left edge */
    const g=ctx.createLinearGradient(0,0,w,0);
    g.addColorStop(0,`rgba(255,150,60,${0.4*(fx.lightLeak/100)})`);g.addColorStop(0.6,"rgba(255,150,60,0)");g.addColorStop(1,"rgba(255,150,60,0)");
    ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  }
  if(fx.lensFlare){ /* bright core + flare ghosts along a diagonal */
    const g=ctx.createRadialGradient(w*0.8,h*0.2,0,w*0.8,h*0.2,Math.max(w,h)*0.45);
    g.addColorStop(0,`rgba(255,230,180,${0.35*(fx.lensFlare/100)})`);g.addColorStop(1,"rgba(255,230,180,0)");
    ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    for(let i=0;i<3;i++){const fx2=w*(0.55-i*0.14),fy2=h*(0.35+i*0.14),fr=8+i*10;
      ctx.fillStyle=`rgba(255,240,200,${0.25*(fx.lensFlare/100)})`;ctx.beginPath();ctx.arc(fx2,fy2,fr,0,7);ctx.fill();}
  }
  if(fx.sunRays){ /* wedges of light fanning out from the top-right corner */
    ctx.save();ctx.translate(w,h*0.1);
    for(let i=0;i<6;i++){const a=Math.PI*(0.55+i*0.09);
      ctx.fillStyle=`rgba(255,225,150,${0.10*(fx.sunRays/100)})`;
      ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(a)*w,Math.sin(a)*w);ctx.lineTo(Math.cos(a+0.05)*w,Math.sin(a+0.05)*w);ctx.closePath();ctx.fill();}
    ctx.restore();
  }
  if(fx.cameraFlash){ctx.fillStyle=`rgba(255,255,255,${Math.max(0,Math.sin(t*9))*0.35*(fx.cameraFlash/100)})`;ctx.fillRect(0,0,w,h);}
  /* legacy global vignette (old FX_DEFS toggle): the grading vignette
     covers S.color.vignette, but the old S.fx.vignette toggle had no
     Canvas-export path — draw it here so it really exports. */
  if(S.fx&&S.fx.vignette){const g=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*0.35,w/2,h/2,Math.max(w,h)*0.75);
    g.addColorStop(0,"rgba(0,0,0,0)");g.addColorStop(1,`rgba(0,0,0,${0.35+S.fxStrength/200})`);
    ctx.fillStyle=g;ctx.fillRect(0,0,w,h);}
}
/* FFmpeg eq string: base grading + the active filter layer, so the Video
   Engine export really grades (the old ffmpegEq only did brightness /
   contrast / saturation). Curves and LUT are appended separately.
   Sepia rides on colorchannelmixer (blended sepia matrix) and
   temperature/tint on colorbalance. Highlights/shadows have no FFmpeg
   equivalent in this chain — they render in preview + Canvas export only. */
function ffmpegEqFull(){
  const c=S.color,fp=filterParams();
  const b=clamp(((c.brightness-100)/100+c.exposure/100+(fp?(fp.brightness-100)/100:0)),-1,1).toFixed(3);
  const ct=((c.contrast/100)*(fp?fp.contrast/100:1)).toFixed(3);
  const st=((c.saturation/100)*(fp?fp.saturation/100:1)).toFixed(3);
  let s=`eq=brightness=${b}:contrast=${ct}:saturation=${st}`;
  const hue=(fp&&fp.hue?fp.hue:0)+(c.tint?c.tint/5:0);
  if(hue)s+=`,hue=h=${hue.toFixed(1)}`;
  if(c.gamma&&c.gamma!==100)s+=`,eq=gamma=${(c.gamma/100).toFixed(3)}`;
  /* temperature (+ = warm) / tint: colour-balance shifts, same direction as
     the Canvas pixel math (warm adds red, removes blue). */
  const tempK=((c.temperature+(fp?fp.temperature:0))/100), tintK=((c.tint+(fp?fp.tint:0))/100);
  if(tempK||tintK){
    const rs=clamp(tempK*0.25+tintK*0.1,-1,1), gs=clamp(-tintK*0.15,-1,1), bs=clamp(-tempK*0.25+tintK*0.1,-1,1);
    s+=`,colorbalance=rs=${rs.toFixed(3)}:gs=${gs.toFixed(3)}:bs=${bs.toFixed(3)}:rm=${(rs*0.7).toFixed(3)}:gm=${(gs*0.7).toFixed(3)}:bm=${(bs*0.7).toFixed(3)}:rh=${(rs*0.5).toFixed(3)}:gh=${(gs*0.5).toFixed(3)}:bh=${(bs*0.5).toFixed(3)}`;
  }
  /* sepia: blend the identity matrix toward the sepia matrix by k. */
  const sepK=fp?fp.sepia/100:0;
  if(sepK>0){
    const k=clamp(sepK,0,1), m=(a,b2)=>((1-k)*a+k*b2).toFixed(3);
    s+=`,colorchannelmixer=${m(1,0.393)}:${m(0,0.769)}:${m(0,0.189)}:0:${m(0,0.349)}:${m(1,0.686)}:${m(0,0.168)}:0:${m(0,0.272)}:${m(0,0.534)}:${m(1,0.131)}:0`;
  }
  return s;
}
/* FFmpeg curves filter from the curve editor points ("curves=r='0/0 0.5/0.6
   1/1':g=...:b=..."). Only emitted when a curve actually changed. */
function ffmpegCurvesFilter(){
  if(!curveChanged())return"";
  const fmt=pts=>pts.map(p=>(p[0]/255).toFixed(3)+"/"+(p[1]/255).toFixed(3)).join(" ");
  const ch=c=>S.curves[c].map(p=>(p[0]/255).toFixed(3)+"/"+(p[1]/255).toFixed(3)).join(" ");
  return `,curves=r='${ch("r")}':g='${ch("g")}':b='${ch("b")}'`;
}

/* ---------- PHASE 3 UI ---------- */
function syncTransUI(){
  const set=(id,v)=>{const el=$(id);if(el)el.value=v;};
  set("transType",S.transType||"none");set("transDur",S.transDur||0.5);
  const dv=$("transDurV");if(dv)dv.textContent=(S.transDur||0.5)+"s";
  set("transEase",S.transEase||"linear");set("transSoft",S.transSoft||0);
  const sv2=$("transSoftV");if(sv2)sv2.textContent=(S.transSoft||0)+"%"+((S.transSoft||0)?" (soft edge)":" (hard edge)");
  set("transDir",S.transDir||"auto");set("transSpeed",S.transSpeed||100);
  const sv=$("transSpeedV");if(sv)sv.textContent=(S.transSpeed||100)+"%";
  set("transIntensity",S.transIntensity||100);
  const iv=$("transIntensityV");if(iv)iv.textContent=(S.transIntensity||100)+"%";
  const rv=$("transReverse");if(rv)rv.checked=!!S.transReverse;
}
function getTransPresets(){try{return JSON.parse(localStorage.getItem("editora-trans-presets")||"{}");}catch(e){return{};}}
function buildTransPresets(){
  const box=$("transPresets");if(!box)return;box.innerHTML="";
  const presets=getTransPresets();
  Object.keys(presets).forEach(name=>{
    const b=document.createElement("button");b.className="fx-btn";b.innerHTML=epIcon("shuffle")+" "+name;
    b.onclick=()=>{const p=presets[name];Object.assign(S,{transType:p.type,transDur:p.dur,transDir:p.dir,transSpeed:p.speed,transReverse:p.rev,transIntensity:p.inten,transEase:p.ease||"linear",transSoft:p.soft||0});
      syncTransUI();toast("Transition preset loaded: "+name+" — Apply to a clip to use it");};
    box.appendChild(b);
  });
  if(!Object.keys(presets).length)box.innerHTML='<p class="hint">No saved transition presets yet.</p>';
  /* Phase 6 — the same presets are listed on the Templates screen. */
  const lib=$("transPresetLib");
  if(lib){
    lib.innerHTML="";
    Object.keys(presets).forEach(name=>{
      const b=document.createElement("button");b.className="fx-btn";b.innerHTML=epIcon("shuffle")+" "+name;
      b.onclick=()=>{const p=presets[name];Object.assign(S,{transType:p.type,transDur:p.dur,transDir:p.dir,transSpeed:p.speed,transReverse:p.rev,transIntensity:p.inten,transEase:p.ease||"linear",transSoft:p.soft||0});
        syncTransUI();toast("Transition preset loaded: "+name+" — Apply to a clip to use it");};
      lib.appendChild(b);
    });
    if(!Object.keys(presets).length)lib.innerHTML='<p class="hint">No saved transition presets yet — save one in the Transitions panel.</p>';
  }
}
function selectedVideoClip(){return S.selKind==="video"?S.clips.find(x=>x.id===S.selClip):null;}
function buildFxGroups(){
  const box=$("fxGroups");if(!box)return;box.innerHTML="";
  Object.keys(EFFECT_GROUPS).forEach(group=>{
    const h=document.createElement("h4");h.textContent=group;box.appendChild(h);
    const grid=document.createElement("div");grid.className="fx-grid";
    EFFECT_GROUPS[group].forEach(id=>{
      const b=document.createElement("button");b.className="fx-btn";b.dataset.fx=id;b.textContent=EFFECT_LABELS[id];
      b.onclick=()=>{
        const c=selectedVideoClip();
        if(!c){toast("Select a video clip on the timeline first — effects apply per clip");return;}
        if(!c.fx)c.fx={};
        if(c.fx[id])delete c.fx[id];else c.fx[id]=S.fxStrength||60;
        buildFxGroups();applyFilters();pushHistory();
        toast((c.fx[id]?"Effect on: ":"Effect off: ")+EFFECT_LABELS[id]+" ("+c.name+")");
      };
      grid.appendChild(b);
    });
    box.appendChild(grid);
  });
  syncFxButtons();
}
function syncFxButtons(){
  const c=selectedVideoClip();const fx=c?clipFxOf(c):{};
  $$("#fxGroups [data-fx]").forEach(b=>b.classList.toggle("on",!!fx[b.dataset.fx]));
  const lab=$("fxClipLabel");
  if(lab)lab.textContent=c?("Effects for clip: "+(c.name||"clip")+" — click to toggle, strength slider sets new effects. "+Object.keys(fx).length+" effect(s) on this clip.")
    :"Select a video clip on the timeline first — effects apply to that clip only. Each effect has a strength (slider below). All listed effects render in the preview (CSS/overlay approximation) and in the Canvas export (real pixel math).";
}
function buildFilterGrid(){
  const box=$("filterPresets");if(!box)return;box.innerHTML="";
  FILTER_NAMES.forEach(name=>{
    const f=FILTERS[name];
    const b=document.createElement("button");b.className="fx-btn"+(S.filterId===name?" on":"");b.dataset.filter=name;
    b.innerHTML=`<span class="swatch" style="background:${f.swatch}"></span>${name}`;
    b.onclick=()=>applyFilter(name);
    box.appendChild(b);
  });
}
function applyFilter(name){
  if(!FILTERS[name])return;
  S.filterId=name;buildFilterGrid();applyFilters();scheduleGradeThumb();pushHistory();
  toast(name==="Normal"?"Filter removed":"Filter applied: "+name+" — intensity "+(S.filterIntensity||100)+"%");
}
function syncGradeUI(){
  buildColorUI();
  const set=(id,v)=>{const el=$(id);if(el)el.value=v;};
  const setV=(id,v)=>{const el=$(id);if(el)el.textContent=v;};
  set("hslHue",S.hsl.hue||0);setV("hslHueV",(S.hsl.hue||0)+"°");
  set("hslSat",S.hsl.sat||0);setV("hslSatV",S.hsl.sat||0);
  set("hslLight",S.hsl.light||0);setV("hslLightV",S.hsl.light||0);
  set("balR",S.balance.r||0);setV("balRV",S.balance.r||0);
  set("balG",S.balance.g||0);setV("balGV",S.balance.g||0);
  set("balB",S.balance.b||0);setV("balBV",S.balance.b||0);
  set("wheelShAmt",S.wheels.sh.amt);set("wheelMidAmt",S.wheels.mid.amt);set("wheelHiAmt",S.wheels.hi.amt);
  set("filterIntensity",S.filterIntensity||100);setV("filterIntensityV",(S.filterIntensity||100)+"%");
  set("lutIntensity",S.lutIntensity||100);setV("lutIntensityV",(S.lutIntensity||100)+"%");
  const ln=$("lutName");
  if(ln)ln.textContent=S.lut?("LUT loaded: "+(S.lutName||"custom")+(S.lut.title?" — "+S.lut.title:"")+" ("+S.lut.size+"³)"):S.lutName?("LUT “"+S.lutName+"” was used — re-import the .cube file to apply it again."):"No LUT loaded.";
  drawCurve();drawWheels();buildFilterGrid();
}
/* ----- RGB curves editor (pointer events = mouse + touch drag) ----- */
function drawCurve(){
  const cv=$("curveCanvas");if(!cv)return;
  const x=cv.getContext("2d");const W=cv.width,H=cv.height;
  x.clearRect(0,0,W,H);
  x.strokeStyle="#223";for(let i=1;i<4;i++){x.beginPath();x.moveTo(W*i/4,0);x.lineTo(W*i/4,H);x.stroke();x.beginPath();x.moveTo(0,H*i/4);x.lineTo(W,H*i/4);x.stroke();}
  x.strokeStyle="#334";x.beginPath();x.moveTo(0,H);x.lineTo(W,0);x.stroke();
  const chan=S.curveChan||"rgb";
  const colors={rgb:"#22d3ee",r:"#f87171",g:"#4ade80",b:"#60a5fa"};
  const pts=S.curves[chan];
  x.strokeStyle=colors[chan];x.lineWidth=2;x.beginPath();
  pts.forEach((p,i)=>{const px=p[0]/255*W,py=H-p[1]/255*H;if(i===0)x.moveTo(px,py);else x.lineTo(px,py);});
  x.stroke();x.lineWidth=1;
  pts.forEach(p=>{const px=p[0]/255*W,py=H-p[1]/255*H;
    x.fillStyle="#fff";x.beginPath();x.arc(px,py,5,0,7);x.fill();
    x.fillStyle=colors[chan];x.beginPath();x.arc(px,py,3.5,0,7);x.fill();});
  x.fillStyle="#9aa0ab";x.font="11px sans-serif";x.fillText(chan.toUpperCase()+" curve — drag points, tap to add",6,12);
}
function curvePointFromEvent(e){
  const cv=$("curveCanvas");const r=cv.getBoundingClientRect();
  const px=clamp((e.clientX-r.left)/r.width*255,0,255);
  const py=clamp(255-(e.clientY-r.top)/r.height*255,0,255);
  return[px,py];
}
let _dragCurvePt=-1;
function wireCurveEditor(){
  const cv=$("curveCanvas");if(!cv||cv._wired)return;cv._wired=true;
  cv.addEventListener("pointerdown",e=>{
    e.preventDefault();cv.setPointerCapture(e.pointerId);
    const [px,py]=curvePointFromEvent(e);
    const pts=S.curves[S.curveChan||"rgb"];
    let best=-1,bd=1e9;
    pts.forEach((p,i)=>{const d=Math.hypot(p[0]-px,p[1]-py);if(d<bd){bd=d;best=i;}});
    if(bd<18){_dragCurvePt=best;}
    else{pts.push([Math.round(px),Math.round(py)]);pts.sort((a,b)=>a[0]-b[0]);_dragCurvePt=pts.findIndex(p=>Math.abs(p[0]-px)<1&&Math.abs(p[1]-py)<1);}
  });
  cv.addEventListener("pointermove",e=>{
    if(_dragCurvePt<0)return;
    const [px,py]=curvePointFromEvent(e);
    const pts=S.curves[S.curveChan||"rgb"];
    pts[_dragCurvePt]=[Math.round(px),Math.round(py)];
    pts.sort((a,b)=>a[0]-b[0]);
    _dragCurvePt=pts.findIndex(p=>p[0]===Math.round(px));
    drawCurve();applyFilters();scheduleGradeThumb();
  });
  const end=()=>{if(_dragCurvePt>=0){_dragCurvePt=-1;pushHistory();}};
  cv.addEventListener("pointerup",end);cv.addEventListener("pointercancel",end);
  cv.addEventListener("dblclick",e=>{
    const [px,py]=curvePointFromEvent(e);
    const pts=S.curves[S.curveChan||"rgb"];
    const idx=pts.findIndex(p=>Math.hypot(p[0]-px,p[1]-py)<18);
    if(idx>0&&idx<pts.length-1){pts.splice(idx,1);drawCurve();applyFilters();pushHistory();toast("Curve point removed");}
  });
}
/* ----- color wheels (pointer drag) ----- */
function drawWheels(){
  const defs=[["wheelSh","sh"],["wheelMid","mid"],["wheelHi","hi"]];
  defs.forEach(([id,key])=>{
    const cv=$(id);if(!cv)return;
    const x=cv.getContext("2d");const W=cv.width,H=cv.height,cx=W/2,cy=H/2;
    x.clearRect(0,0,W,H);
    const g=x.createRadialGradient(cx,cy,2,cx,cy,W/2);
    g.addColorStop(0,"#888888");g.addColorStop(0.5,"#444488");g.addColorStop(1,"#112233");
    x.fillStyle=g;x.beginPath();x.arc(cx,cy,W/2-1,0,7);x.fill();
    x.strokeStyle="#555";x.beginPath();x.moveTo(cx,0);x.lineTo(cx,H);x.stroke();
    x.beginPath();x.moveTo(0,cy);x.lineTo(W,cy);x.stroke();
    const w=S.wheels[key];
    x.fillStyle="#fff";x.beginPath();x.arc(cx+w.x*(W/2-6),cy+w.y*(H/2-6),5,0,7);x.fill();
    x.fillStyle="#22d3ee";x.beginPath();x.arc(cx+w.x*(W/2-6),cy+w.y*(H/2-6),3,0,7);x.fill();
  });
}
function wireWheels(){
  [["wheelSh","sh"],["wheelMid","mid"],["wheelHi","hi"]].forEach(([id,key])=>{
    const cv=$(id);if(!cv||cv._wired)return;cv._wired=true;
    let drag=false;
    const set=e=>{
      const r=cv.getBoundingClientRect();
      const nx=clamp(((e.clientX-r.left)/r.width-0.5)*2,-1,1);
      const ny=clamp(((e.clientY-r.top)/r.height-0.5)*2,-1,1);
      S.wheels[key].x=nx;S.wheels[key].y=ny;
      drawWheels();applyFilters();scheduleGradeThumb();
    };
    cv.addEventListener("pointerdown",e=>{e.preventDefault();cv.setPointerCapture(e.pointerId);drag=true;set(e);});
    cv.addEventListener("pointermove",e=>{if(drag)set(e);});
    cv.addEventListener("pointerup",()=>{if(drag){drag=false;pushHistory();}});
    cv.addEventListener("pointercancel",()=>{drag=false;});
  });
}
/* ----- grade still-frame preview (real graded pixels) ----- */
let _gradeThumbTimer=null;
function scheduleGradeThumb(){clearTimeout(_gradeThumbTimer);_gradeThumbTimer=setTimeout(refreshGradeThumb,300);}
function refreshGradeThumb(){
  const cv=$("gradeThumb");if(!cv)return;
  const x=cv.getContext("2d");
  x.fillStyle="#000";x.fillRect(0,0,cv.width,cv.height);
  const srcEl=(video.readyState>=2&&video.videoWidth)?video:(imgPrev||null);
  if(!srcEl){x.fillStyle="#9aa0ab";x.font="12px sans-serif";x.fillText("Import a video or photo, then refresh to see the grade.",10,70);return;}
  const sw=srcEl.videoWidth||srcEl.naturalWidth||srcEl.width, sh=srcEl.videoHeight||srcEl.naturalHeight||srcEl.height;
  if(!sw||!sh)return;
  const s=Math.max(cv.width/sw,cv.height/sh),dw=sw*s,dh=sh*s;
  x.save();x.filter=cssFilterString();
  x.drawImage(srcEl,(cv.width-dw)/2,(cv.height-dh)/2,dw,dh);x.restore();
  try{
    const img=x.getImageData(0,0,cv.width,cv.height);
    applyGradePixels(img.data,cv.width,cv.height);
    x.putImageData(img,0,0);
  }catch(e){/* cross-origin frames cannot be read — CSS preview still shows */}
}
/* ----- LUT import ----- */
function importLUTFile(file){
  const r=new FileReader();
  r.onload=()=>{
    const parsed=parseCube(String(r.result||""));
    if(parsed.error){toast("LUT not loaded: "+parsed.error);return;}
    S.lut=parsed;S.lutName=file.name;
    if(typeof rememberLutName==="function")rememberLutName(file.name);
    syncGradeUI();applyFilters();scheduleGradeThumb();pushHistory();
    toast("LUT loaded: "+file.name+" ("+parsed.size+"³) — applies to both exports");
  };
  r.readAsText(file);
}
/* ----- Phase 3 wiring (called from init) ----- */
function buildPhase3UI(){
  buildFxGroups();buildFilterGrid();buildTransPresets();
  syncTransUI();syncGradeUI();wireCurveEditor();wireWheels();
  refreshGradeThumb();
}
function wirePhase3(){
  bind("transDir","change",e=>{S.transDir=e.target.value;});
  bind("transSpeed","input",e=>{S.transSpeed=+e.target.value;$("transSpeedV").textContent=S.transSpeed+"%";});
  bind("transIntensity","input",e=>{S.transIntensity=+e.target.value;$("transIntensityV").textContent=S.transIntensity+"%";});
  bind("transReverse","change",e=>{S.transReverse=e.target.checked;});
  bind("btnSaveTransPreset","click",()=>{
    const n=($("transPresetName").value||"").trim();
    if(!n){toast("Type a preset name first");return;}
    const presets=getTransPresets();
    presets[n]={type:S.transType,dur:S.transDur,dir:S.transDir,speed:S.transSpeed,rev:S.transReverse,inten:S.transIntensity,ease:S.transEase,soft:S.transSoft};
    try{localStorage.setItem("editora-trans-presets",JSON.stringify(presets));}catch(e){}
    buildTransPresets();toast("Transition preset saved: "+n);
  });
  bind("btnFxClear","click",()=>{
    const c=selectedVideoClip();if(!c){toast("Select a video clip first");return;}
    c.fx={};buildFxGroups();applyFilters();pushHistory();toast("Clip effects cleared");
  });
  bind("btnFxCopy","click",()=>{
    const c=selectedVideoClip();if(!c){toast("Select a video clip first");return;}
    S.fxClipboard=JSON.parse(JSON.stringify(c.fx||{}));toast("Effects copied from this clip");
  });
  bind("btnFxPaste","click",()=>{
    const c=selectedVideoClip();if(!c){toast("Select a video clip first");return;}
    if(!S.fxClipboard){toast("Nothing copied yet — use Copy effects first");return;}
    c.fx=JSON.parse(JSON.stringify(S.fxClipboard));buildFxGroups();applyFilters();pushHistory();toast("Effects pasted onto this clip");
  });
  bind("filterIntensity","input",e=>{S.filterIntensity=+e.target.value;$("filterIntensityV").textContent=S.filterIntensity+"%";applyFilters();scheduleGradeThumb();markDirty();});
  bind("btnFilterCompare","pointerdown",()=>{S._filterHold=true;const keep=S.filterIntensity;S.filterIntensity=0;applyFilters();S.filterIntensity=keep;});
  bind("btnFilterCompare","pointerup",()=>{applyFilters();});
  bind("btnFilterCompare","pointerleave",()=>{applyFilters();});
  bind("btnFilterRemove","click",()=>applyFilter("Normal"));
  bind("btnFilterSavePreset","click",()=>{
    const n=($("filterPresetName").value||"").trim();
    if(!n){toast("Type a preset name first");return;}
    PRESETS[n]={...S.color};
    try{localStorage.setItem("editora-presets",JSON.stringify(PRESETS));}catch(e){}
    buildColorUI();
    /* Phase 6 — the same name also saves the FULL look (grading + filter +
       curves + HSL + wheels + balance) as a grade preset, listed in the
       Adjustment tab and on the Templates screen. */
    if(typeof saveGradePreset==="function")saveGradePreset(n);
    toast("Custom preset saved: "+n+" (grading + filter "+S.filterId+" — full look saved as a grade preset too)");
  });
  bind("btnFilterCopy","click",()=>{
    S.filterClipboard=JSON.parse(JSON.stringify({filterId:S.filterId,filterIntensity:S.filterIntensity,color:S.color,curves:S.curves,hsl:S.hsl,wheels:S.wheels,balance:S.balance}));
    toast("Filter + grading settings copied");
  });
  bind("btnFilterPaste","click",()=>{
    if(!S.filterClipboard){toast("Nothing copied yet — use Copy settings first");return;}
    const c=S.filterClipboard;
    S.filterId=c.filterId;S.filterIntensity=c.filterIntensity;
    Object.assign(S.color,c.color);S.curves=c.curves;S.hsl=c.hsl;S.wheels=c.wheels;S.balance=c.balance;
    syncGradeUI();applyFilters();scheduleGradeThumb();pushHistory();toast("Filter + grading settings pasted");
  });
  bind("hslHue","input",e=>{S.hsl.hue=+e.target.value;$("hslHueV").textContent=S.hsl.hue+"°";scheduleGradeThumb();markDirty();});
  bind("hslSat","input",e=>{S.hsl.sat=+e.target.value;$("hslSatV").textContent=S.hsl.sat;scheduleGradeThumb();markDirty();});
  bind("hslLight","input",e=>{S.hsl.light=+e.target.value;$("hslLightV").textContent=S.hsl.light;scheduleGradeThumb();markDirty();});
  bind("balR","input",e=>{S.balance.r=+e.target.value;$("balRV").textContent=S.balance.r;scheduleGradeThumb();markDirty();});
  bind("balG","input",e=>{S.balance.g=+e.target.value;$("balGV").textContent=S.balance.g;scheduleGradeThumb();markDirty();});
  bind("balB","input",e=>{S.balance.b=+e.target.value;$("balBV").textContent=S.balance.b;scheduleGradeThumb();markDirty();});
  [["wheelShAmt","sh"],["wheelMidAmt","mid"],["wheelHiAmt","hi"]].forEach(([id,key])=>{
    bind(id,"input",e=>{S.wheels[key].amt=+e.target.value;scheduleGradeThumb();markDirty();});
  });
  $$("#curveChanRow [data-curve]").forEach(b=>b.addEventListener("click",()=>{
    S.curveChan=b.dataset.curve;
    $$("#curveChanRow [data-curve]").forEach(x=>x.classList.toggle("on",x===b));
    drawCurve();
  }));
  bind("btnCurveReset","click",()=>{
    S.curves[S.curveChan||"rgb"]=[[0,0],[255,255]];drawCurve();applyFilters();scheduleGradeThumb();pushHistory();toast("Curve reset");
  });
  bind("btnImportLUT","click",()=>$("lutInput").click());
  bind("lutInput","change",e=>{const f=e.target.files[0];e.target.value="";if(f)importLUTFile(f);});
  bind("btnClearLUT","click",()=>{S.lut=null;S.lutName="";syncGradeUI();applyFilters();scheduleGradeThumb();pushHistory();toast("LUT removed");});
  bind("lutIntensity","input",e=>{S.lutIntensity=+e.target.value;$("lutIntensityV").textContent=S.lutIntensity+"%";scheduleGradeThumb();markDirty();});
  bind("btnGradeThumb","click",refreshGradeThumb);
}

/* ================================================================
   PHASE 4 (2026-11-12) — Text & Typography, Captions, Audio Studio,
   Animation & Keyframes, Speed & Motion (blueprint §3).
   Vanilla JS + Web Audio only. No AI, no ads, no paywall, no watermark.
   Optical flow is OMITTED (needs a frame-interpolation engine — see
   PHASE4_REPORT.md). Vosk offline captions were attempted, not shipped
   (model needs a ~40 MB runtime download; see report + the disabled
   button in the Captions panel).
   ================================================================ */

/* ---------- 1. TEXT & TYPOGRAPHY ---------- */
const TEXT_PRESETS={
  "Titles":{font:"Impact",size:72,weight:900,color:"#ffffff",bg:"#000000",bgOn:false,outline:true,shadow:true,pos:"center",anim:"zoom",spacing:2,lineHeight:110,align:"center",rot:0,opacity:100,grad:false,grad2:"#22d3ee"},
  "Headings":{font:"Georgia",size:56,weight:700,color:"#ffffff",bg:"#000000",bgOn:false,outline:false,shadow:true,pos:"top",anim:"fade",spacing:1,lineHeight:120,align:"center",rot:0,opacity:100,grad:false,grad2:"#22d3ee"},
  "Subtitles":{font:"Arial",size:36,weight:400,color:"#ffffff",bg:"#000000",bgOn:true,outline:true,shadow:false,pos:"bottom",anim:"slide",spacing:0,lineHeight:130,align:"center",rot:0,opacity:100,grad:false,grad2:"#22d3ee"},
  "Credits":{font:"Georgia",size:28,weight:400,color:"#e5e7eb",bg:"#000000",bgOn:false,outline:false,shadow:true,pos:"center",anim:"fade",spacing:2,lineHeight:150,align:"center",rot:0,opacity:90,grad:false,grad2:"#22d3ee"},
  "End screens":{font:"Impact",size:64,weight:900,color:"#fde047",bg:"#000000",bgOn:false,outline:true,shadow:true,pos:"center",anim:"pop",spacing:1,lineHeight:110,align:"center",rot:0,opacity:100,grad:false,grad2:"#22d3ee"},
  "Lower thirds":{font:"Arial",size:40,weight:700,color:"#ffffff",bg:"#0ea5b7",bgOn:true,outline:false,shadow:true,pos:"bottom",anim:"slide",spacing:0,lineHeight:120,align:"left",rot:0,opacity:100,grad:false,grad2:"#22d3ee"},
  "3D-style":{font:"Impact",size:68,weight:900,color:"#ffffff",bg:"#000000",bgOn:false,outline:true,shadow:true,pos:"center",anim:"zoom",spacing:2,lineHeight:110,align:"center",rot:0,opacity:100,grad:false,grad2:"#22d3ee"},
  "Neon":{font:"Trebuchet MS",size:60,weight:700,color:"#22d3ee",bg:"#000000",bgOn:true,outline:false,shadow:true,pos:"center",anim:"pop",spacing:3,lineHeight:110,align:"center",rot:0,opacity:100,grad:false,grad2:"#f472b6"},
  "Gradient":{font:"Impact",size:64,weight:900,color:"#f472b6",bg:"#000000",bgOn:false,outline:false,shadow:false,pos:"center",anim:"zoom",spacing:1,lineHeight:110,align:"center",rot:0,opacity:100,grad:true,grad2:"#22d3ee"},
  "Outline":{font:"Impact",size:64,weight:900,color:"#ffffff",bg:"#000000",bgOn:false,outline:true,shadow:false,pos:"center",anim:"fade",spacing:2,lineHeight:110,align:"center",rot:0,opacity:100,grad:false,grad2:"#22d3ee"},
  "Shadow":{font:"Georgia",size:56,weight:700,color:"#ffffff",bg:"#000000",bgOn:false,outline:false,shadow:true,pos:"center",anim:"slide",spacing:0,lineHeight:120,align:"center",rot:0,opacity:100,grad:false,grad2:"#22d3ee"},
  "Glow":{font:"Trebuchet MS",size:56,weight:700,color:"#fde047",bg:"#000000",bgOn:false,outline:false,shadow:true,pos:"center",anim:"pop",spacing:1,lineHeight:120,align:"center",rot:0,opacity:100,grad:false,grad2:"#22d3ee"},
  "Transparent text":{font:"Arial",size:56,weight:700,color:"#ffffff",bg:"#000000",bgOn:false,outline:true,shadow:false,pos:"center",anim:"fade",spacing:4,lineHeight:120,align:"center",rot:0,opacity:55,grad:false,grad2:"#22d3ee"},
  "Kinetic typography":{font:"Impact",size:72,weight:900,color:"#ffffff",bg:"#000000",bgOn:false,outline:true,shadow:true,pos:"center",anim:"typewriter",spacing:1,lineHeight:110,align:"center",rot:0,opacity:100,grad:false,grad2:"#22d3ee"},
};
const TEXT_ANIMS=["none","fade","slide","pop","typewriter","letter","word","zoom","bounce","rotate","flip","glitch","wave","mask"];
/* Deterministic animation state for a text clip at local time `t` (seconds
   into the clip, duration `dur`). Used by the preview AND the Canvas
   export, so both animate identically. Returns {text, opacity, scale,
   tx, ty, rot, wave, mask}. */
function textAnimState(c,t,dur){
  const anim=c.anim||"none", total=c.text?c.text.length:0;
  const out={text:c.text||"",opacity:1,scale:1,tx:0,ty:0,rot:0,wave:false,mask:null};
  if(anim==="none"||t<0)return out;
  const p=clamp(t/Math.max(0.5,dur),0,1);
  const inP=clamp(t/0.6,0,1); // entrance progress over the first 0.6 s
  switch(anim){
    case "fade": out.opacity=inP; break;
    case "slide": out.opacity=inP; out.ty=(1-inP)*40; break;
    case "pop": {const s=inP<0.7?0.6+0.48*(inP/0.7):1.08-0.08*((inP-0.7)/0.3);out.scale=s;out.opacity=inP;break;}
    case "zoom": out.scale=0.5+0.5*inP; out.opacity=inP; break;
    case "bounce": {const s=inP<0.5?0.3+1.7*inP:inP<0.7?1.15-0.2*((inP-0.5)/0.2):0.95+0.05*((inP-0.7)/0.3);out.scale=s;out.opacity=Math.min(1,inP*2);break;}
    case "rotate": out.rot=(1-inP)*30; out.opacity=inP; break;
    case "flip": out.scale=Math.abs(Math.cos(inP*Math.PI/2))*0.2+0.8; out.rot=(1-inP)*25; out.opacity=inP; break;
    case "glitch": out.tx=Math.round(Math.sin(t*47)*4*(1-inP)); out.opacity=1; break;
    case "wave": out.wave=true; out.opacity=inP; break;
    case "mask": out.mask=inP; break;
    case "typewriter": {const n=Math.floor(clamp(t/(dur*0.7),0,1)*total);out.text=(c.text||"").slice(0,n);break;}
    case "letter": {const per=0.06, n=Math.floor(t/per);out.text=(c.text||"").slice(0,Math.min(total,n));break;}
    case "word": {const words=(c.text||"").split(" ");const per=0.25,n=Math.floor(t/per);out.text=words.slice(0,Math.min(words.length,n)).join(" ");break;}
  }
  return out;
}
function applyTextPreset(name){
  const t=TEXT_PRESETS[name];if(!t)return;
  const set=(id,v)=>{const el=$(id);if(el)el.value=v;};
  set("txtFont",t.font);set("txtSize",t.size);set("txtColor",t.color);set("txtBg",t.bg);
  const bg=$("txtBgOn");if(bg)bg.checked=t.bgOn;
  const ol=$("txtOutline");if(ol)ol.checked=t.outline;
  const sh=$("txtShadow");if(sh)sh.checked=t.shadow;
  set("txtPos",t.pos);set("txtAnim",t.anim);set("txtPreset",name);
  set("txtWeight",String(t.weight));set("txtSpacing",t.spacing);set("txtLineHeight",t.lineHeight);
  set("txtAlign",t.align);set("txtRot",t.rot);set("txtOpacity",t.opacity);
  const gr=$("txtGrad");if(gr)gr.checked=!!t.grad; set("txtGrad2",t.grad2||"#22d3ee");
  const sv=$("txtSizeV");if(sv)sv.textContent=t.size+"px";
  const sp=$("txtSpacingV");if(sp)sp.textContent=t.spacing+"px";
  const lh=$("txtLineHeightV");if(lh)lh.textContent=(t.lineHeight/100).toFixed(2);
  const rv=$("txtRotV");if(rv)rv.textContent=t.rot+"°";
  const ov=$("txtOpacityV");if(ov)ov.textContent=t.opacity+"%";
  const c=S.selKind==="text"?selectedClipObj():null;
  if(c){Object.assign(c,t);renderTimeline();renderTextOverlay();pushHistory();toast("Text preset applied to selected text: "+name);}
  else toast("Text preset set — it will be used for your next text clip");
}
function buildTextPresets(){
  const box=$("textPresets");if(!box)return;box.innerHTML="";
  Object.keys(TEXT_PRESETS).forEach(n=>{
    const b=document.createElement("button");b.className="fx-btn";b.innerHTML=epIcon("type")+" "+n;
    b.onclick=()=>applyTextPreset(n);
    box.appendChild(b);
  });
  const sel=$("txtPreset");if(sel&&sel.options.length<=1){
    Object.keys(TEXT_PRESETS).forEach(n=>{const o=document.createElement("option");o.value=n;o.textContent=n;sel.appendChild(o);});
  }
}
/* Canvas-export text drawing with the same animation state as the preview. */
function drawAnimatedText(ctx,w,h,c,t,alpha){
  const local=t-c.start, dur=c.duration||3;
  /* Phase 6 — shape clips draw as coloured shapes, not text. */
  if(c.shape){
    const st=textAnimState({text:"x",anim:c.anim||"none"},local,dur);
    const sz=(c.size||80)*w/1280;
    const cx=w/2+st.tx, cy=h*(c.pos==="top"?0.12:c.pos==="center"?0.5:0.82)+st.ty;
    ctx.save();ctx.globalAlpha=alpha*(st.opacity*((c.opacity??100)/100));
    ctx.translate(cx,cy);ctx.rotate((st.rot+(c.rot||0))*Math.PI/180);ctx.scale(st.scale,st.scale);
    ctx.fillStyle=c.color||"#22d3ee";
    if(c.shape==="circle"){ctx.beginPath();ctx.arc(0,0,sz/2,0,7);ctx.fill();}
    else if(c.shape==="triangle"){ctx.beginPath();ctx.moveTo(0,-sz/2);ctx.lineTo(sz/2,sz/2);ctx.lineTo(-sz/2,sz/2);ctx.closePath();ctx.fill();}
    else if(c.shape==="diamond"){ctx.beginPath();ctx.moveTo(0,-sz/2);ctx.lineTo(sz/2,0);ctx.lineTo(0,sz/2);ctx.lineTo(-sz/2,0);ctx.closePath();ctx.fill();}
    else ctx.fillRect(-sz/2,-sz/2,sz,sz);
    ctx.restore();return;
  }
  const st=textAnimState(c,local,dur);
  if(!st.text)return;
  const fs=Math.round(c.size*w/1280);
  ctx.save();
  ctx.globalAlpha=alpha*(st.opacity*((c.opacity??100)/100));
  const baseY=h*(c.pos==="top"?0.12:c.pos==="center"?0.5:0.82);
  ctx.translate(w/2+st.tx,baseY+st.ty);
  ctx.rotate((st.rot+(c.rot||0))*Math.PI/180);
  ctx.scale(st.scale,st.scale);
  ctx.font=`${c.weight||700} ${fs}px ${c.font}`;
  ctx.textAlign=c.align||"center";
  if(c.grad){
    const g=ctx.createLinearGradient(-200,0,200,0);
    g.addColorStop(0,c.color);g.addColorStop(1,c.grad2||"#22d3ee");
    ctx.fillStyle=g;
  }else ctx.fillStyle=c.color;
  if(c.bgOn&&!c.grad){const tw=ctx.measureText(st.text).width;ctx.fillStyle=c.bg;ctx.fillRect(-tw/2-10,-30,tw+20,44);ctx.fillStyle=c.grad?ctx.fillStyle:c.color;}
  if(st.wave){
    let x=-ctx.measureText(st.text).width/2;
    [...st.text].forEach((ch,i)=>{
      const cw=ctx.measureText(ch).width;
      ctx.fillText(ch,x+ (c.align==="center"?cw/2:0), Math.sin(local*6+i*0.6)*6);
      x+=cw;
    });
  }else{
    if(st.mask!=null){ctx.save();ctx.beginPath();ctx.rect(-w, -40, w*2, 80*st.mask);ctx.clip();}
    ctx.fillText(st.text,0,0);
    if(st.mask!=null)ctx.restore();
  }
  ctx.restore();
}

/* ---------- 4. ANIMATION & KEYFRAMES ---------- */
const ANIM_PRESETS={
  "Position":{dur:1.5,kf:[["posX",0,-160,"easeOut"],["posX",1.5,0,"easeInOut"]]},
  "Scale":{dur:1.5,kf:[["scale",0,50,"easeOut"],["scale",1.5,100,"easeInOut"]]},
  "Rotation":{dur:1.5,kf:[["rotation",0,0,"linear"],["rotation",1.5,360,"linear"]]},
  "Opacity":{dur:1,kf:[["opacity",0,0,"linear"],["opacity",1,100,"easeIn"]]},
  "Zoom":{dur:1.2,kf:[["scale",0,130,"easeOut"],["scale",1.2,100,"easeInOut"]]},
  "Pan":{dur:2,kf:[["posX",0,-120,"linear"],["posX",2,120,"linear"]]},
  "Bounce":{dur:1.2,kf:[["scale",0,60,"easeOut"],["scale",0.4,115,"easeIn"],["scale",0.8,95,"easeOut"],["scale",1.2,100,"easeInOut"]]},
  "Shake":{dur:1,kf:[["posX",0,0,"linear"],["posX",0.2,14,"linear"],["posX",0.4,-14,"linear"],["posX",0.6,10,"linear"],["posX",0.8,-6,"linear"],["posX",1,0,"linear"]]},
  "Swing":{dur:1.5,kf:[["posX",0,0,"linear"],["posX",0.5,30,"easeOut"],["posX",1,-20,"easeInOut"],["posX",1.5,0,"easeInOut"]]},
  "Pulse":{dur:1.2,kf:[["scale",0,100,"easeInOut"],["scale",0.6,112,"easeInOut"],["scale",1.2,100,"easeInOut"]]},
  "Pop In":{dur:0.6,kf:[["scale",0,40,"easeOut"],["scale",0.6,100,"easeInOut"],["opacity",0,0,"linear"],["opacity",0.6,100,"linear"]]},
  "Pop Out":{dur:0.6,kf:[["scale",0,100,"linear"],["scale",0.6,40,"easeIn"],["opacity",0,100,"linear"],["opacity",0.6,0,"linear"]]},
  "Fade In":{dur:1,kf:[["opacity",0,0,"linear"],["opacity",1,100,"easeIn"]]},
  "Fade Out":{dur:1,kf:[["opacity",0,100,"linear"],["opacity",1,0,"easeOut"]]},
  "Slide In":{dur:1,kf:[["posX",0,-200,"easeOut"],["posX",1,0,"easeInOut"],["opacity",0,0,"linear"],["opacity",0.3,100,"linear"]]},
  "Slide Out":{dur:1,kf:[["posX",0,0,"linear"],["posX",1,200,"easeIn"],["opacity",0,100,"linear"],["opacity",1,0,"linear"]]},
  "Rotate In":{dur:1.2,kf:[["rotation",0,-90,"easeOut"],["rotation",1.2,0,"easeInOut"],["opacity",0,0,"linear"],["opacity",0.4,100,"linear"]]},
  "Rotate Out":{dur:1.2,kf:[["rotation",0,0,"linear"],["rotation",1.2,90,"easeIn"],["opacity",0,100,"linear"],["opacity",1.2,0,"linear"]]},
  "Elastic":{dur:1.4,kf:[["scale",0,40,"easeOut"],["scale",0.5,118,"easeOut"],["scale",0.9,94,"easeInOut"],["scale",1.4,100,"easeInOut"]]},
  "Spring":{dur:1.4,kf:[["scale",0,70,"easeOut"],["scale",0.5,112,"easeOut"],["scale",0.9,96,"easeInOut"],["scale",1.4,100,"easeInOut"]]},
  "Overshoot":{dur:1.2,kf:[["scale",0,60,"easeOut"],["scale",0.7,112,"easeOut"],["scale",1.2,100,"easeInOut"]]},
};
function applyAnimPreset(name){
  const pr=ANIM_PRESETS[name];if(!pr){toast("Pick an animation preset first");return;}
  if(!S.selClip){toast("Select a clip first — the preset adds keyframes at the playhead");return;}
  // Rotation presets animate via posX-adjacent rotation illusion? No —
  // rotation has no keyframe prop, so Rotate In/Out use scale+opacity.
  const base=S.curTime;
  pr.kf.forEach(([prop,off,val,ease])=>{
    S.keyframes.push({id:uid(),prop,time:base+off,value:val,ease:ease||"linear"});
  });
  renderKfList();renderKfLane();pushHistory();
  toast("Animation preset applied: "+name+" ("+pr.kf.length+" keyframes from "+fmt(base)+")");
}
/* Keyframe lane under the timeline — dots per keyframe, drag to move. */
function renderKfLane(){
  const lane=$("kfLane");if(!lane)return;
  lane.innerHTML="";
  const tot=Math.max(10,totalDuration());
  lane.style.width=(tot*PX_PER_SEC()+40)+"px";
  const rows={opacity:4,scale:14,posX:24,posY:24,rotation:24};
  const labels={opacity:"op",scale:"sc",posX:"x",posY:"y",rotation:"r"};
  S.keyframes.slice().sort((a,b)=>a.time-b.time).forEach(k=>{
    const d=document.createElement("div");d.className="kf-dot"+(S.selKf===k.id?" sel":"");
    d.style.left=(k.time*PX_PER_SEC())+"px";d.style.top=(rows[k.prop]||4)+"px";
    d.textContent=labels[k.prop]||"•";d.title=k.prop+" @ "+k.time.toFixed(2)+"s = "+k.value+" ("+(k.ease||"linear")+")";
    d.addEventListener("pointerdown",e=>{
      e.preventDefault();e.stopPropagation();
      S.selKf=k.id;seek(k.time);renderKfList();renderKfLane();
      const x0=e.clientX,t0=k.time;
      const move=ev=>{k.time=clamp(t0+(ev.clientX-x0)/PX_PER_SEC(),0,tot);d.style.left=(k.time*PX_PER_SEC())+"px";d.title=k.prop+" @ "+k.time.toFixed(2)+"s = "+k.value;};
      const up=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);renderKfList();renderKfLane();pushHistory();};
      document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);
    });
    lane.appendChild(d);
  });
  if(!S.keyframes.length){lane.innerHTML='<span style="font-size:11px;color:var(--mut);padding:8px;display:block">No keyframes yet.</span>';}
}
/* Bezier editor for the selected keyframe's segment. */
let _bezDrag=-1;
function drawBezier(){
  const cv=$("bezierCanvas");if(!cv)return;
  const x=cv.getContext("2d"),W=cv.width,H=cv.height;
  x.clearRect(0,0,W,H);
  x.strokeStyle="#223";x.strokeRect(4,4,W-8,H-8);
  const k=S.keyframes.find(k=>k.id===S.selKf);
  const bez=(k&&k.bez)||{x1:0.42,y1:0,x2:0.58,y2:1};
  const px=v=>4+v*(W-8), py=v=>H-4-v*(H-8);
  x.strokeStyle="#22d3ee";x.lineWidth=2;x.beginPath();
  for(let i=0;i<=40;i++){const f=i/40,u=1-f;
    const bx=3*u*u*f*bez.x1+3*u*f*f*bez.x2+f*f*f;
    const by=3*u*u*f*bez.y1+3*u*f*f*bez.y2+f*f*f;
    if(i===0)x.moveTo(px(bx),py(by));else x.lineTo(px(bx),py(by));}
  x.stroke();x.lineWidth=1;
  x.strokeStyle="#555";
  x.beginPath();x.moveTo(px(0),py(0));x.lineTo(px(bez.x1),py(bez.y1));x.stroke();
  x.beginPath();x.moveTo(px(1),py(1));x.lineTo(px(bez.x2),py(bez.y2));x.stroke();
  [[bez.x1,bez.y1,0],[bez.x2,bez.y2,1]].forEach(([bx,by])=>{
    x.fillStyle="#fff";x.beginPath();x.arc(px(bx),py(by),6,0,7);x.fill();
    x.fillStyle="#22d3ee";x.beginPath();x.arc(px(bx),py(by),4,0,7);x.fill();
  });
  x.fillStyle="#9aa0ab";x.font="11px sans-serif";
  x.fillText(k?("Bezier for "+k.prop+" @ "+k.time.toFixed(1)+"s ("+(k.ease||"linear")+")"):"Select a keyframe (tap a ◆ in the lane or a row below) to edit its Bezier",8,14);
}
function wireBezier(){
  const cv=$("bezierCanvas");if(!cv||cv._wired)return;cv._wired=true;
  const pt=e=>{const r=cv.getBoundingClientRect();
    return[clamp((e.clientX-r.left)/r.width,0,1),clamp(1-(e.clientY-r.top)/r.height,0,1)];};
  cv.addEventListener("pointerdown",e=>{
    const k=S.keyframes.find(k=>k.id===S.selKf);
    if(!k){toast("Select a keyframe first (tap a ◆ in the lane)");return;}
    if(!k.bez)k.bez={x1:0.42,y1:0,x2:0.58,y2:1};
    k.ease="bezier";
    const [bx,by]=pt(e);
    const d1=Math.hypot(bx-k.bez.x1,by-k.bez.y1), d2=Math.hypot(bx-k.bez.x2,by-k.bez.y2);
    _bezDrag=d1<d2?0:1;
    cv.setPointerCapture(e.pointerId);drawBezier();
  });
  cv.addEventListener("pointermove",e=>{
    if(_bezDrag<0)return;
    const k=S.keyframes.find(k=>k.id===S.selKf);if(!k||!k.bez)return;
    const [bx,by]=pt(e);
    if(_bezDrag===0){k.bez.x1=bx;k.bez.y1=by;}else{k.bez.x2=bx;k.bez.y2=by;}
    drawBezier();
  });
  const end=()=>{if(_bezDrag>=0){_bezDrag=-1;renderKfList();pushHistory();}};
  cv.addEventListener("pointerup",end);cv.addEventListener("pointercancel",end);
}

/* ---------- 5. SPEED & MOTION ---------- */
function clipSpeedAt(clip,offset){
  if(!clip)return 1;
  const kfs=(clip.speedKf||[]).slice().sort((a,b)=>a.t-b.t);
  if(!kfs.length)return clip.speed||1;
  if(offset<=kfs[0].t)return kfs[0].speed;
  if(offset>=kfs[kfs.length-1].t)return kfs[kfs.length-1].speed;
  for(let i=0;i<kfs.length-1;i++){
    const a=kfs[i],b=kfs[i+1];
    if(offset>=a.t&&offset<=b.t){const f=(offset-a.t)/Math.max(0.001,b.t-a.t);return a.speed+(b.speed-a.speed)*f;}
  }
  return clip.speed||1;
}
/* Timeline offset -> source time, honouring time remap, frame hold, then
   the speed ramp (numeric integration, 0.05 s steps). */
function sourceTimeForOffset(clip,offset){
  if(!clip)return offset;
  const tm=(clip.timeMap||[]).slice().sort((a,b)=>a.t-b.t);
  if(tm.length>=2){
    if(offset<=tm[0].t)return tm[0].src;
    if(offset>=tm[tm.length-1].t)return tm[tm.length-1].src;
    for(let i=0;i<tm.length-1;i++){
      const a=tm[i],b=tm[i+1];
      if(offset>=a.t&&offset<=b.t){const f=(offset-a.t)/Math.max(0.001,b.t-a.t);return a.src+(b.src-a.src)*f;}
    }
  }
  const hold=clip.frameHold;
  if(hold&&offset>=hold.at&&offset<=hold.at+hold.dur){
    return _integrateSpeed(clip,hold.at);
  }
  let acc=0, prev=0;
  const step=0.05;
  for(let t=0;t<offset;t+=step){
    const dt=Math.min(step,offset-t);
    const sp=clipSpeedAt(clip,t+dt/2);
    acc+=sp*dt; prev=t+dt;
  }
  if(hold&&offset>hold.at+hold.dur){
    // after a hold, source time resumes from the hold point, shifted by the hold length
    acc=_integrateSpeed(clip,hold.at)+_integrateSpeedFrom(clip,hold.at,offset-hold.at-hold.dur);
  }
  return acc;
}
function _integrateSpeed(clip,upto){
  let acc=0;const step=0.05;
  for(let t=0;t<upto;t+=step){acc+=clipSpeedAt(clip,t+step/2)*Math.min(step,upto-t);}
  return acc;
}
function _integrateSpeedFrom(clip,from,span){
  let acc=0;const step=0.05;
  for(let t=0;t<span;t+=step){acc+=clipSpeedAt(clip,from+t+step/2)*Math.min(step,span-t);}
  return acc;
}
/* Inverse: source time -> timeline offset (used by the playback clock). */
function offsetForSourceTime(clip,srcT){
  if(!clip)return srcT;
  const tm=(clip.timeMap||[]).slice().sort((a,b)=>a.src-b.src);
  if(tm.length>=2){
    if(srcT<=tm[0].src)return tm[0].t;
    if(srcT>=tm[tm.length-1].src)return tm[tm.length-1].t;
    for(let i=0;i<tm.length-1;i++){
      const a=tm[i],b=tm[i+1];
      if(srcT>=a.src&&srcT<=b.src){const f=(srcT-a.src)/Math.max(0.001,b.src-a.src);return a.t+(b.t-a.t)*f;}
    }
  }
  let acc=0;const step=0.05;
  for(let t=0;t<(clip.duration||0);t+=step){
    const dt=Math.min(step,(clip.duration||0)-t);
    const sp=clipSpeedAt(clip,t+dt/2);
    if(acc+sp*dt>=srcT)return t+(srcT-acc)/Math.max(0.001,sp);
    acc+=sp*dt;
  }
  return clip.duration||srcT;
}
function renderSpeedKfList(){
  const box=$("speedKfList");if(!box)return;box.innerHTML="";
  const c=S.selKind==="video"?selectedClipObj():null;
  if(!c){box.innerHTML='<p class="hint">Select a video clip first.</p>';return;}
  const kfs=(c.speedKf||[]).slice().sort((a,b)=>a.t-b.t);
  if(!kfs.length)box.innerHTML='<p class="hint">No speed keyframes — the clip plays at its base speed ('+(c.speed||1)+'×).</p>';
  kfs.forEach(k=>{
    const r=document.createElement("div");r.className="kf-row";
    r.innerHTML=`<span>◆ ${k.t.toFixed(1)}s → ${k.speed.toFixed(2)}×</span><button class="mini" title="Delete speed keyframe">${epIcon("trash")}</button>`;
    r.querySelector("button").onclick=()=>{c.speedKf=c.speedKf.filter(x=>x.id!==k.id);renderSpeedKfList();pushHistory();};
    box.appendChild(r);
  });
  const tm=$("timeMapList");if(tm){
    tm.innerHTML="";
    const pts=(c.timeMap||[]).slice().sort((a,b)=>a.t-b.t);
    if(!pts.length)tm.innerHTML='<p class="hint">No time-map points — playback follows the speed ramp.</p>';
    pts.forEach(pt=>{
      const r=document.createElement("div");r.className="kf-row";
      r.innerHTML=`<span>◆ out ${pt.t.toFixed(1)}s → src ${pt.src.toFixed(1)}s</span><button class="mini" title="Delete time-map point">${epIcon("trash")}</button>`;
      r.querySelector("button").onclick=()=>{c.timeMap=c.timeMap.filter(x=>x.id!==pt.id);renderSpeedKfList();pushHistory();};
      tm.appendChild(r);
    });
  }
}

/* ---------- 3. AUDIO STUDIO ---------- */
const AUDIO_FX_DEFS=[
  ["eq0","EQ 60 Hz",-12,12," dB"],["eq1","EQ 230 Hz",-12,12," dB"],["eq2","EQ 1 kHz",-12,12," dB"],
  ["eq3","EQ 4 kHz",-12,12," dB"],["eq4","EQ 12 kHz",-12,12," dB"],
  ["bassBoost","Bass boost",0,12," dB"],["treble","Treble",0,12," dB"],
  ["reverb","Reverb (generated impulse)",0,100,"%"],["echo","Echo",0,100,"%"],["delay","Delay",0,100,"%"],
  ["chorus","Chorus",0,100,"%"],["flanger","Flanger",0,100,"%"],["phaser","Phaser",0,100,"%"],
  ["distortion","Distortion",0,100,"%"],["compressor","Compressor",0,100,"%"],
  ["limiter","Limiter",0,100,"%"],["gate","Gate (expander approx.)",0,100,"%"],["noiseRed","Noise reduction (gate + high-pass)",0,100,"%"],
];
function buildAudioFxPanel(){
  const box=$("audioFxPanel");if(!box)return;box.innerHTML="";
  AUDIO_FX_DEFS.forEach(([key,label,min,max,suf],idx)=>{
    const w=document.createElement("div");
    const val=key.startsWith("eq")?S.audioFx.eq[+key.slice(2)]:S.audioFx[key];
    w.innerHTML=`<label>${label} <span id="afxv_${key}">${val}${suf}</span></label><input type="range" min="${min}" max="${max}" value="${val}" data-k="${key}">`;
    w.querySelector("input").addEventListener("input",e=>{
      const v=+e.target.value;
      if(key.startsWith("eq"))S.audioFx.eq[+key.slice(2)]=v;else S.audioFx[key]=v;
      $("afxv_"+key).textContent=v+suf;markDirty();
    });
    box.appendChild(w);
  });
}
function audioFxOn(){const f=S.audioFx;return f&&(f.eq.some(v=>v)||f.bassBoost||f.treble||f.reverb||f.echo||f.delay||f.chorus||f.flanger||f.phaser||f.distortion||f.compressor||f.limiter||f.gate||f.noiseRed);}
/* Generated impulse response (exponentially decaying noise) — no external IR files. */
function makeImpulse(ctx,dur,decay){
  const len=Math.floor(ctx.sampleRate*dur);
  const buf=ctx.createBuffer(2,len,ctx.sampleRate);
  for(let ch=0;ch<2;ch++){
    const d=buf.getChannelData(ch);
    for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay);
  }
  return buf;
}
/* Build the real Web Audio effect chain. input -> ... -> output. */
function buildAudioChain(ctx,input){
  const fx=S.audioFx;
  let node=input;
  const connect=n=>{node.connect(n);node=n;};
  const eqFreqs=[60,230,1000,4000,12000];
  eqFreqs.forEach((f,i)=>{
    const b=ctx.createBiquadFilter();b.type=i===0?"lowshelf":i===4?"highshelf":"peaking";
    b.frequency.value=f;b.gain.value=fx.eq[i]||0;connect(b);
  });
  if(fx.bassBoost){const b=ctx.createBiquadFilter();b.type="lowshelf";b.frequency.value=120;b.gain.value=fx.bassBoost;connect(b);}
  if(fx.treble){const b=ctx.createBiquadFilter();b.type="highshelf";b.frequency.value=6000;b.gain.value=fx.treble;connect(b);}
  if(fx.noiseRed){const hp=ctx.createBiquadFilter();hp.type="highpass";hp.frequency.value=120;connect(hp);}
  if(fx.distortion){
    const ws=ctx.createWaveShaper();
    const amt=1+fx.distortion/25, n=256, curve=new Float32Array(n);
    for(let i=0;i<n;i++){const x=i/(n-1)*2-1;curve[i]=(1+amt)*x/(1+amt*Math.abs(x));}
    ws.curve=curve;connect(ws);
  }
  if(fx.phaser){
    const ap=ctx.createBiquadFilter();ap.type="allpass";ap.frequency.value=800;ap.Q.value=4;
    const lfo=ctx.createOscillator();lfo.frequency.value=0.4+fx.phaser/100;
    const lg=ctx.createGain();lg.gain.value=400;lfo.connect(lg);lg.connect(ap.frequency);lfo.start();
    connect(ap);
  }
  if(fx.chorus||fx.flanger){
    const dl=ctx.createDelay(0.05);
    dl.delayTime.value=fx.flanger?0.004:0.018;
    const lfo=ctx.createOscillator();lfo.frequency.value=fx.flanger?0.6:1.2;
    const lg=ctx.createGain();lg.gain.value=fx.flanger?0.002:0.006;lfo.connect(lg);lg.connect(dl.delayTime);lfo.start();
    const wet=ctx.createGain();wet.gain.value=(fx.chorus||fx.flanger)/100*0.5;
    const dry=ctx.createGain();dry.gain.value=1;
    const mix=ctx.createGain();
    node.connect(dl);dl.connect(wet);wet.connect(mix);node.connect(dry);dry.connect(mix);
    node=mix;
  }
  if(fx.echo){ /* echo: feedback delay, repeats fading out */
    const dl=ctx.createDelay(1);dl.delayTime.value=0.28;
    const fb=ctx.createGain();fb.gain.value=0.35;
    const wet=ctx.createGain();wet.gain.value=fx.echo/100*0.5;
    node.connect(dl);dl.connect(fb);fb.connect(dl);dl.connect(wet);
    const mix=ctx.createGain();node.connect(mix);wet.connect(mix);node=mix;
  }
  if(fx.delay){ /* delay: single slapback, no feedback — one repeat only */
    const dl=ctx.createDelay(1);dl.delayTime.value=0.45;
    const wet=ctx.createGain();wet.gain.value=fx.delay/100*0.5;
    node.connect(dl);dl.connect(wet);
    const mix=ctx.createGain();node.connect(mix);wet.connect(mix);node=mix;
  }
  if(fx.reverb){
    const cv=ctx.createConvolver();cv.buffer=makeImpulse(ctx,1.8,2.5);
    const wet=ctx.createGain();wet.gain.value=fx.reverb/100*0.6;
    const mix=ctx.createGain();node.connect(cv);cv.connect(wet);wet.connect(mix);node.connect(mix);node=mix;
  }
  if(fx.compressor){
    const comp=ctx.createDynamicsCompressor();
    comp.threshold.value=-24;comp.ratio.value=2+fx.compressor/12;comp.attack.value=0.005;comp.release.value=0.2;
    connect(comp);
  }
  if(fx.limiter){
    const lim=ctx.createDynamicsCompressor();
    lim.threshold.value=-3;lim.ratio.value=20;lim.attack.value=0.001;lim.release.value=0.05;
    connect(lim);
  }
  if(fx.gate){
    // Traditional noise gate: a gain that opens only above a threshold is
    // not expressible with a stock node, so the gate here is a
    // DynamicsCompressor used as an upward/downward expander approximation
    // plus the high-pass above — labelled honestly in the UI.
    const g=ctx.createDynamicsCompressor();
    g.threshold.value=-40+fx.gate/100*20;g.ratio.value=8;g.attack.value=0.002;g.release.value=0.15;
    connect(g);
  }
  const out=ctx.createGain();node.connect(out);
  return out;
}
/* FFmpeg audio filter chain for one audio clip (same controls as the
   Web Audio chain, expressed as FFmpeg filters). Returns "" when idle. */
function ffmpegAudioFx(clip){
  const fx=S.audioFx, parts=[];
  const eqFreqs=[60,230,1000,4000,12000];
  fx.eq.forEach((g,i)=>{if(g)parts.push(`equalizer=f=${eqFreqs[i]}:width_type=o:width=1:g=${g}`);});
  if(fx.bassBoost)parts.push(`bass=g=${fx.bassBoost}:frequency=120`);
  if(fx.treble)parts.push(`treble=g=${fx.treble}:frequency=6000`);
  if(fx.noiseRed)parts.push("highpass=f=120","afftdn=nf=-25");
  if(fx.distortion)parts.push(`acrusher=level_in=${(1+fx.distortion/50).toFixed(2)}:level_out=0.8:bits=10:mode=log`);
  if(fx.phaser)parts.push(`aphaser=in_gain=0.4:out_gain=0.9:delay=3:decay=0.4:speed=${(0.3+fx.phaser/100).toFixed(2)}`);
  if(fx.chorus)parts.push("chorus=0.5:0.9:50|60|40:0.4|0.3|0.2:0.25|0.4|0.3:2|1.3|0.4");
  if(fx.flanger)parts.push("flanger=delay=5:depth=2:regen=40:speed=0.5");
  if(fx.echo)parts.push("aecho=0.8:0.7:60|120:0.4|0.25");
  if(fx.delay)parts.push("adelay=280|280:all=1");
  if(fx.reverb)parts.push("aecho=0.8:0.9:60|120|250:0.5|0.35|0.2");
  if(fx.compressor)parts.push(`acompressor=threshold=-24dB:ratio=${(2+fx.compressor/12).toFixed(1)}:attack=5:release=200`);
  if(fx.limiter)parts.push("alimiter=limit=0.8:level=false");
  if(fx.gate)parts.push("agate=threshold=0.05:ratio=8:attack=2:release=150");
  if(clip){
    if(clip.reverseAudio)parts.push("areverse");
    if(clip.pitch)parts.push(`asetrate=44100*${Math.pow(2,clip.pitch/12).toFixed(4)},aresample=44100`);
    if(clip.normGain)parts.push(`volume=${clip.normGain.toFixed(3)}`);
    if(clip.stereo==="mono")parts.push("pan=mono|c0=0.5*c0+0.5*c1");
    else if(clip.pan)parts.push(`stereotools=balance_out=${(clip.pan/100).toFixed(2)}`);
  }
  return parts.length?","+parts.join(","):"";
}
function selectedAudioClip(){return S.selKind==="audio"?S.audioClips.find(x=>x.id===S.selClip):null;}
function splitAudioAtPlayhead(){
  const c=selectedAudioClip();if(!c){toast("Select an audio clip first");return;}
  const off=S.curTime-c.start;
  if(!splitClipAt(c,off)){toast("Move the playhead inside the audio clip to split");return;}
  updateDuration();renderTimeline();pushHistory();toast("Audio clip split");
}
function mergeAudio(){
  const c=selectedAudioClip();if(!c){toast("Select an audio clip first");return;}
  const next=S.audioClips.filter(x=>(x.track||"a1")===(c.track||"a1")&&x.id!==c.id&&x.start>=c.start+c.duration-0.05).sort((a,b)=>a.start-b.start)[0];
  if(!next){toast("No adjacent audio clip after this one");return;}
  if(next.mediaId!==c.mediaId){toast("Merge needs two adjacent clips from the same source file");return;}
  if(Math.abs(next.start-(c.start+c.duration))>0.05){toast("Clips are not adjacent");return;}
  c.duration=round2(c.duration+next.duration);S.audioClips=S.audioClips.filter(x=>x.id!==next.id);
  updateDuration();renderTimeline();pushHistory();toast("Audio clips merged");
}
function nudgeAudio(dir){
  const c=selectedAudioClip();if(!c){toast("Select an audio clip first");return;}
  c.start=round2(Math.max(0,c.start+dir/(S.fps||30)));
  renderTimeline();pushHistory();toast("Audio nudged "+(dir>0?"+":"−")+"1 frame ("+(1/(S.fps||30)).toFixed(3)+"s)");
}
async function normalizeAudioClip(){
  const c=selectedAudioClip();if(!c){toast("Select an audio clip first");return;}
  const m=S.media.find(x=>x.id===c.mediaId);if(!m){toast("Audio media not found");return;}
  try{
    const buf=await (m.file?m.file.arrayBuffer():fetch(m.url).then(r=>r.arrayBuffer()));
    const actx=new OfflineAudioContext(1,44100,44100);
    const audio=await actx.decodeAudioData(buf);
    let peak=0;for(let ch=0;ch<audio.numberOfChannels;ch++){const d=audio.getChannelData(ch);for(let i=0;i<d.length;i+=7){const v=Math.abs(d[i]);if(v>peak)peak=v;}}
    if(peak<=0){toast("This audio is silent — nothing to normalize");return;}
    c.normGain=+(0.89/peak).toFixed(3);
    pushHistory();toast("Normalized — peak was "+peak.toFixed(2)+", clip gain set to "+c.normGain+"× (−1 dB peak)");
  }catch(e){toast("Could not decode this audio to normalize it");}
}
function encodeWAV(buffer){
  const nCh=buffer.numberOfChannels, sr=buffer.sampleRate, len=buffer.length*nCh*2+44;
  const ab=new ArrayBuffer(len), v=new DataView(ab);
  const wstr=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
  wstr(0,"RIFF");v.setUint32(4,len-8,true);wstr(8,"WAVE");wstr(12,"fmt ");
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,nCh,true);
  v.setUint32(24,sr,true);v.setUint32(28,sr*nCh*2,true);v.setUint16(32,nCh*2,true);v.setUint16(34,16,true);
  wstr(36,"data");v.setUint32(40,len-44,true);
  let o=44;
  for(let i=0;i<buffer.length;i++)for(let ch=0;ch<nCh;ch++){
    const s=clamp(buffer.getChannelData(ch)[i],-1,1);
    v.setInt16(o,s<0?s*32768:s*32767,true);o+=2;
  }
  return new Blob([ab],{type:"audio/wav"});
}
async function reversedAudioUrl(clip){
  if(clip._revUrl)return clip._revUrl;
  const m=S.media.find(x=>x.id===clip.mediaId);if(!m)return null;
  const buf=await (m.file?m.file.arrayBuffer():fetch(m.url).then(r=>r.arrayBuffer()));
  const actx=new OfflineAudioContext(1,44100,44100);
  const audio=await actx.decodeAudioData(buf);
  for(let ch=0;ch<audio.numberOfChannels;ch++){
    const d=audio.getChannelData(ch);
    for(let i=0,j=d.length-1;i<j;i++,j--){const t=d[i];d[i]=d[j];d[j]=t;}
  }
  const blob=encodeWAV(audio);
  clip._revUrl=URL.createObjectURL(blob);
  return clip._revUrl;
}
/* --- Synthesized sound effects + background-music tones (Web Audio) --- */
const SFX_TYPES=["whoosh","pop","ding","swoosh","applause","click","riser","boom","chime","sparkle"];
const BGM_TYPES=["Calm pad","Upbeat loop","Ambient drone"];
function synthSfxRender(type,ctx,dest){
  const t=ctx.currentTime;
  const noiseBuf=()=>{const b=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);const d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;return b;};
  const env=(g,a,peak,dec)=>{g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(peak,t+a);g.gain.exponentialRampToValueAtTime(0.001,t+a+dec);};
  if(type==="whoosh"||type==="swoosh"){
    const src=ctx.createBufferSource();src.buffer=noiseBuf();
    const bp=ctx.createBiquadFilter();bp.type="bandpass";bp.Q.value=1.2;
    bp.frequency.setValueAtTime(300,t);bp.frequency.exponentialRampToValueAtTime(3500,t+0.5);
    const g=ctx.createGain();env(g,0.05,0.7,0.5);
    src.connect(bp);bp.connect(g);g.connect(dest);src.start(t);src.stop(t+0.7);
  }else if(type==="pop"){
    const o=ctx.createOscillator();o.type="sine";o.frequency.setValueAtTime(600,t);o.frequency.exponentialRampToValueAtTime(120,t+0.12);
    const g=ctx.createGain();env(g,0.005,0.8,0.12);o.connect(g);g.connect(dest);o.start(t);o.stop(t+0.2);
  }else if(type==="ding"||type==="chime"){
    [880,1318.5].forEach((f,i)=>{const o=ctx.createOscillator();o.type="sine";o.frequency.value=f;
      const g=ctx.createGain();env(g,0.005,0.5/(i+1),1.1);o.connect(g);g.connect(dest);o.start(t);o.stop(t+1.3);});
  }else if(type==="applause"){
    for(let i=0;i<14;i++){const src=ctx.createBufferSource();src.buffer=noiseBuf();
      const bp=ctx.createBiquadFilter();bp.type="bandpass";bp.frequency.value=1200+Math.random()*800;
      const g=ctx.createGain();const st=t+Math.random()*0.5;g.gain.setValueAtTime(0,st);g.gain.linearRampToValueAtTime(0.25,st+0.02);g.gain.exponentialRampToValueAtTime(0.001,st+0.35);
      src.connect(bp);bp.connect(g);g.connect(dest);src.start(st);src.stop(st+0.4);}
  }else if(type==="click"){
    const o=ctx.createOscillator();o.type="square";o.frequency.value=2000;
    const g=ctx.createGain();env(g,0.001,0.4,0.05);o.connect(g);g.connect(dest);o.start(t);o.stop(t+0.08);
  }else if(type==="riser"){
    const o=ctx.createOscillator();o.type="sawtooth";o.frequency.setValueAtTime(150,t);o.frequency.exponentialRampToValueAtTime(900,t+0.9);
    const g=ctx.createGain();env(g,0.1,0.35,0.9);o.connect(g);g.connect(dest);o.start(t);o.stop(t+1.1);
  }else if(type==="boom"){
    const o=ctx.createOscillator();o.type="sine";o.frequency.setValueAtTime(120,t);o.frequency.exponentialRampToValueAtTime(35,t+0.8);
    const g=ctx.createGain();env(g,0.01,0.9,0.9);o.connect(g);g.connect(dest);o.start(t);o.stop(t+1);
  }else if(type==="sparkle"){
    [1568,2093,2637].forEach((f,i)=>{const o=ctx.createOscillator();o.type="triangle";o.frequency.value=f;
      const g=ctx.createGain();const st=t+i*0.09;g.gain.setValueAtTime(0,st);g.gain.linearRampToValueAtTime(0.4,st+0.02);g.gain.exponentialRampToValueAtTime(0.001,st+0.4);
      o.connect(g);g.connect(dest);o.start(st);o.stop(st+0.5);});
  }
}
async function previewSfx(type){
  const ctx=ensureAudioCtx();await ctx.resume();
  synthSfxRender(type,ctx,ctx.destination);
}
async function sfxToTimeline(type){
  toast("Synthesizing "+type+"…");
  const dur=type==="applause"?1.4:type==="ding"||type==="chime"?1.4:1.0;
  const off=new OfflineAudioContext(1,44100*Math.ceil(dur),44100);
  synthSfxRender(type,off,off.destination);
  const buf=await off.startRendering();
  const blob=encodeWAV(buf);
  const url=URL.createObjectURL(blob);
  const m={id:uid(),name:"SFX · "+type,type:"audio",url,file:blob,fav:false,duration:dur,addedAt:Date.now(),folderId:null};
  S.media.push(m);renderMediaList();addToTimeline(m);
  toast("Sound effect added to timeline: "+type+" (synthesized on-device)");
}
function synthBgmRender(name,ctx,dest){
  const t=ctx.currentTime, dur=8;
  if(name==="Calm pad"){
    [261.6,329.6,392,493.9].forEach(f=>{const o=ctx.createOscillator();o.type="sine";o.frequency.value=f;
      const g=ctx.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.12,t+1);g.gain.setValueAtTime(0.12,t+dur-1);g.gain.linearRampToValueAtTime(0,t+dur);
      o.connect(g);g.connect(dest);o.start(t);o.stop(t+dur);});
  }else if(name==="Upbeat loop"){
    const seq=[523.25,659.25,783.99,659.25,587.33,698.46,880,698.46];
    seq.forEach((f,i)=>{const o=ctx.createOscillator();o.type="triangle";o.frequency.value=f;
      const g=ctx.createGain();const st=t+i*0.25;g.gain.setValueAtTime(0,st);g.gain.linearRampToValueAtTime(0.25,st+0.02);g.gain.exponentialRampToValueAtTime(0.001,st+0.24);
      o.connect(g);g.connect(dest);o.start(st);o.stop(st+0.25);});
    [130.8,196].forEach(f=>{const o=ctx.createOscillator();o.type="sine";o.frequency.value=f;
      const g=ctx.createGain();g.gain.value=0.12;o.connect(g);g.connect(dest);o.start(t);o.stop(t+2);});
  }else{
    [110,164.8,220].forEach(f=>{const o=ctx.createOscillator();o.type="sine";o.frequency.value=f;
      const lfo=ctx.createOscillator();lfo.frequency.value=0.1;const lg=ctx.createGain();lg.gain.value=0.05;
      lfo.connect(lg);lg.connect(o.frequency);lfo.start(t);lfo.stop(t+dur);
      const g=ctx.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.14,t+2);g.gain.setValueAtTime(0.14,t+dur-2);g.gain.linearRampToValueAtTime(0,t+dur);
      o.connect(g);g.connect(dest);o.start(t);o.stop(t+dur);});
  }
}
async function previewBgm(name){
  const ctx=ensureAudioCtx();await ctx.resume();
  synthBgmRender(name,ctx,ctx.destination);
}
async function bgmToTimeline(name){
  toast("Synthesizing "+name+" loop…");
  const off=new OfflineAudioContext(1,44100*8,44100);
  synthBgmRender(name,off,off.destination);
  const buf=await off.startRendering();
  const blob=encodeWAV(buf);
  const url=URL.createObjectURL(blob);
  const m={id:uid(),name:"BGM · "+name+" (built-in tone)",type:"audio",url,file:blob,fav:false,duration:8,addedAt:Date.now(),folderId:null};
  S.media.push(m);renderMediaList();addToTimeline(m);
  toast("Background tone added to timeline: "+name+" (8 s synthesized loop)");
}
function buildSfxGrids(){
  const sg=$("sfxGrid");if(sg){sg.innerHTML="";
    SFX_TYPES.forEach(ty=>{
      const b=document.createElement("button");b.className="fx-btn";b.innerHTML=epIcon("volume")+" "+ty;
      b.onclick=()=>previewSfx(ty);
      const add=document.createElement("button");add.className="fx-btn";add.textContent="+ Timeline";
      add.onclick=()=>sfxToTimeline(ty);
      sg.appendChild(b);sg.appendChild(add);
    });}
  const bg=$("bgmGrid");if(bg){bg.innerHTML="";
    BGM_TYPES.forEach(nm=>{
      const b=document.createElement("button");b.className="fx-btn";b.innerHTML=epIcon("music")+" "+nm;
      b.onclick=()=>previewBgm(nm);
      const add=document.createElement("button");add.className="fx-btn";add.textContent="+ Timeline";
      add.onclick=()=>bgmToTimeline(nm);
      bg.appendChild(b);bg.appendChild(add);
    });}
}
async function previewAudioFx(){
  const c=selectedAudioClip();if(!c){toast("Select an audio clip first");return;}
  const m=S.media.find(x=>x.id===c.mediaId);if(!m){toast("Audio media not found");return;}
  try{
    const ctx=ensureAudioCtx();await ctx.resume();
    const el=new Audio(m.url);el.crossOrigin="anonymous";
    const src=ctx.createMediaElementSource(el);
    const out=buildAudioChain(ctx,src);
    const pan=ctx.createStereoPanner();pan.pan.value=(c.pan||0)/100;
    out.connect(pan);pan.connect(ctx.destination);
    el.playbackRate=(c.speed||1)*Math.pow(2,(c.pitch||0)/12);
    el.volume=(c.vol??80)/100*(c.normGain||1);
    await el.play();
    toast("Previewing audio with effects (3 s)…");
    setTimeout(()=>{el.pause();},3000);
  }catch(e){toast("Audio preview failed: "+(e.message||e));}
}

/* ---------- Phase 4 wiring ---------- */
function buildPhase4UI(){
  buildTextPresets();buildAudioFxPanel();buildSfxGrids();renderKfLane();drawBezier();renderSpeedKfList();
  const ap=$("animPreset");
  if(ap&&!ap.options.length){Object.keys(ANIM_PRESETS).forEach(n=>{const o=document.createElement("option");o.value=n;o.textContent=n;ap.appendChild(o);});}
}
function wirePhase4(){
  bind("txtPreset","change",e=>{if(e.target.value)applyTextPreset(e.target.value);});
  bind("txtWeight","change",e=>{const c=S.selKind==="text"?selectedClipObj():null;if(c){c.weight=+e.target.value;renderTextOverlay();pushHistory();}});
  bind("txtSpacing","input",e=>{const c=S.selKind==="text"?selectedClipObj():null;$("txtSpacingV").textContent=e.target.value+"px";if(c){c.spacing=+e.target.value;renderTextOverlay();markDirty();}});
  bind("txtLineHeight","input",e=>{const c=S.selKind==="text"?selectedClipObj():null;$("txtLineHeightV").textContent=(+e.target.value/100).toFixed(2);if(c){c.lineHeight=+e.target.value;renderTextOverlay();markDirty();}});
  bind("txtAlign","change",e=>{const c=S.selKind==="text"?selectedClipObj():null;if(c){c.align=e.target.value;renderTextOverlay();pushHistory();}});
  bind("txtRot","input",e=>{const c=S.selKind==="text"?selectedClipObj():null;$("txtRotV").textContent=e.target.value+"°";if(c){c.rot=+e.target.value;renderTextOverlay();markDirty();}});
  bind("txtOpacity","input",e=>{const c=S.selKind==="text"?selectedClipObj():null;$("txtOpacityV").textContent=e.target.value+"%";if(c){c.opacity=+e.target.value;renderTextOverlay();markDirty();}});
  bind("txtGrad","change",e=>{const c=S.selKind==="text"?selectedClipObj():null;if(c){c.grad=e.target.checked;renderTextOverlay();pushHistory();}});
  bind("txtGrad2","input",e=>{const c=S.selKind==="text"?selectedClipObj():null;if(c){c.grad2=e.target.value;renderTextOverlay();markDirty();}});
  // captions: tracks + ASS + word/split/merge live in renderCapList
  bind("capTrackSel","change",e=>{S.capTrackSel=e.target.value;renderCapList();renderTextOverlay();markDirty();});
  bind("btnAddCapTrack","click",()=>{
    const n=(prompt("New caption track name:","Secondary 2")||"").trim();if(!n)return;
    const id="track"+uid();S.capTracks.push({id,name:n});S.capTrackSel=id;
    renderCapList();pushHistory();toast("Caption track added: "+n);
  });
  bind("btnExportASS","click",()=>{if(!_capTrackCaps().length){toast("No captions on the selected track yet");return;}downloadText("captions-"+(S.capTrackSel||"main")+".ass",toASSExport(),"text/plain");toast("ASS exported for track: "+(S.capTrackSel||"main"));});
  // audio clip tools
  bind("btnSplitAudio","click",splitAudioAtPlayhead);
  bind("btnMergeAudio","click",mergeAudio);
  bind("btnNudgeAudioL","click",()=>nudgeAudio(-1));
  bind("btnNudgeAudioR","click",()=>nudgeAudio(1));
  bind("btnTrimAudio","click",()=>{
    const c=selectedAudioClip();if(!c){toast("Select an audio clip first");return;}
    const ti=+$("trimIn").value||0, to=+$("trimOut").value||c.duration;
    c.trimIn=round2(ti);c.trimOut=round2(to);c.duration=round2(Math.max(0.2,to-ti));
    updateDuration();renderTimeline();pushHistory();toast("Audio trimmed to "+c.duration.toFixed(1)+"s");
  });
  bind("audPitch","input",e=>{const c=selectedAudioClip();$("audPitchV").textContent=e.target.value+" st";if(c){c.pitch=+e.target.value;markDirty();}});
  bind("audClipSpeed","input",e=>{const c=selectedAudioClip();$("audClipSpeedV").textContent=(+e.target.value/100).toFixed(2)+"×";if(c){c.speed=+e.target.value/100;c.duration=round2(Math.max(0.2,(c.baseDur||c.duration)/ (c.speed||1)));markDirty();}});
  bind("btnReverseAudio","click",()=>{
    const c=selectedAudioClip();if(!c){toast("Select an audio clip first");return;}
    c.reverseAudio=!c.reverseAudio;delete c._revUrl;renderTimeline();pushHistory();
    toast(c.reverseAudio?"Audio clip reversed — true reverse in the Video Engine export; Canvas export reverses the buffer on-device":"Audio reverse off");
  });
  bind("btnNormalizeAudio","click",normalizeAudioClip);
  bind("audStereo","change",e=>{const c=selectedAudioClip();if(c){c.stereo=e.target.value;pushHistory();toast("Audio channels: "+e.target.value);}});
  bind("audPan","input",e=>{const c=selectedAudioClip();$("audPanV").textContent=+e.target.value===0?"Center":(+e.target.value<0?"Left "+(-e.target.value):"Right "+e.target.value);if(c){c.pan=+e.target.value;markDirty();}});
  bind("btnPreviewAudioFx","click",previewAudioFx);
  bind("btnFxAudioClear","click",()=>{S.audioFx={eq:[0,0,0,0,0],bassBoost:0,treble:0,reverb:0,echo:0,delay:0,chorus:0,flanger:0,phaser:0,distortion:0,compressor:0,limiter:0,gate:0,noiseRed:0};buildAudioFxPanel();pushHistory();toast("Audio effects cleared");});
  // speed / motion
  bind("btnAddSpeedKf","click",()=>{
    const c=S.selKind==="video"?selectedClipObj():null;if(!c){toast("Select a video clip first");return;}
    const at=+$("speedKfAt").value||0, sp=+$("speedKfVal").value||1;
    if(at<0||at>c.duration){toast("Speed keyframe offset must be inside the clip (0–"+c.duration.toFixed(1)+"s)");return;}
    if(!c.speedKf)c.speedKf=[];
    c.speedKf.push({id:uid(),t:at,speed:clamp(sp,0.25,4)});
    renderSpeedKfList();pushHistory();toast("Speed keyframe added: "+sp.toFixed(2)+"× at "+at.toFixed(1)+"s into the clip");
  });
  bind("btnAddTimeMap","click",()=>{
    const c=S.selKind==="video"?selectedClipObj():null;if(!c){toast("Select a video clip first");return;}
    const out=+$("tmOut").value||0, src=+$("tmSrc").value||0;
    if(!c.timeMap)c.timeMap=[];
    c.timeMap.push({id:uid(),t:out,src});
    renderSpeedKfList();pushHistory();toast("Time-map point added: output "+out.toFixed(1)+"s → source "+src.toFixed(1)+"s");
  });
  bind("btnApplyHold","click",()=>{
    const c=S.selKind==="video"?selectedClipObj():null;if(!c){toast("Select a video clip first");return;}
    const at=+$("holdAt").value||0, dur=+$("holdDur").value||1;
    if(at<0||at>c.duration){toast("Hold start must be inside the clip");return;}
    c.frameHold={at,dur:clamp(dur,0.1,10)};
    renderSpeedKfList();pushHistory();toast("Frame hold set: frame at "+at.toFixed(1)+"s held for "+dur.toFixed(1)+"s");
  });
  bind("btnClearHold","click",()=>{
    const c=S.selKind==="video"?selectedClipObj():null;if(!c){toast("Select a video clip first");return;}
    delete c.frameHold;pushHistory();toast("Frame hold cleared");
  });
  bind("motionBlurOn","change",e=>{S.motionBlur=e.target.checked;markDirty();toast(S.motionBlur?"Motion blur on (Canvas export)":"Motion blur off");});
  // animation presets + keyframe tools
  bind("btnApplyAnimPreset","click",()=>applyAnimPreset($("animPreset").value));
  bind("btnKfCopy","click",()=>{
    const k=S.keyframes.find(k=>k.id===S.selKf);if(!k){toast("Select a keyframe first (tap a ◆ in the lane)");return;}
    S.kfClipboard=JSON.parse(JSON.stringify(k));toast("Keyframe copied");
  });
  bind("btnKfPaste","click",()=>{
    if(!S.kfClipboard){toast("Nothing copied yet");return;}
    const copy={...JSON.parse(JSON.stringify(S.kfClipboard)),id:uid(),time:S.curTime};
    S.keyframes.push(copy);S.selKf=copy.id;renderKfList();renderKfLane();drawBezier();pushHistory();toast("Keyframe pasted at playhead");
  });
  bind("btnKfDelete","click",()=>{
    if(!S.selKf){toast("Select a keyframe first");return;}
    S.keyframes=S.keyframes.filter(k=>k.id!==S.selKf);S.selKf=null;
    renderKfList();renderKfLane();drawBezier();pushHistory();toast("Keyframe deleted");
  });
  wireBezier();
}


/* ================================================================
   PHASE 6 (2026-11-12) — Extra professional features (§5), Templates &
   Assets (§6), Export Center (§7) of the Ultimate Blueprint.
   Vanilla JS only, no new CDN, no AI/ads/paywall/watermark, offline-first.
   Render paths: split screen + chroma + mask render in the preview (real
   canvas compositing) and in the Canvas export; the Video Engine export
   renders chroma (colorkey, to black) and lists split screen / masks /
   ducking as skipped. Multi-camera editing is OMITTED (needs a synced
   multi-angle engine — see PHASE6_REPORT.md). TIFF export is OMITTED
   (no browser/WebView TIFF encoder). H.265 is offered only when a real
   support test proves it (detectH265).
   ================================================================ */

/* ---------- shared helpers ---------- */
function hexRgb(hex){const h=(hex||"#000000").replace("#","");const n=parseInt(h.length===3?h.split("").map(c=>c+c).join(""):h,16);return[(n>>16)&255,(n>>8)&255,n&255];}
function previewUrl(m){return (S.proxyOn&&m&&m.proxyUrl)?m.proxyUrl:(m?m.url:"");}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function mediaById(id){return S.media.find(x=>x.id===id)||null;}

/* ---------- SPLIT SCREEN (2 / 3 / 4 videos) ---------- */
function splitCellCount(mode){return mode==="3"?3:mode==="4"?4:2;}
function splitCellRects(mode,w,h){
  if(mode==="2v")return[[0,0,w/2,h],[w/2,0,w/2,h]];
  if(mode==="2h")return[[0,0,w,h/2],[0,h/2,w,h/2]];
  if(mode==="3")return[[0,0,w/2,h],[w/2,0,w/2,h/2],[w/2,h/2,w/2,h/2]];
  return[[0,0,w/2,h/2],[w/2,0,w/2,h/2],[0,h/2,w/2,h/2],[w/2,h/2,w/2,h/2]];
}
/* Sources for each cell at timeline time t. Cell 0 is the V1 clip under
   the playhead. Other cells use the media picked in the Pro panel, or —
   when nothing was picked — the V2 clip at the same time. */
function splitSourcesAt(t){
  const main=activeVideoAt(t);
  const base=main&&!main.overlay?main:clipOnTrackAt("v1",t);
  const out=[];
  if(base)out.push({media:mediaById(base.clip.mediaId),trimIn:base.clip.trimIn||0,offset:base.offset,clip:base.clip});
  const v2=clipOnTrackAt("v2",t);
  const n=splitCellCount(S.splitScreen?S.splitScreen.mode:"2v");
  for(let i=1;i<n;i++){
    const picked=S.splitScreen&&S.splitScreen.cells?S.splitScreen.cells[i-1]:null;
    const m=picked?mediaById(picked):(v2?mediaById(v2.clip.mediaId):null);
    const off=base?base.offset:0;
    out.push({media:m,trimIn:v2&&!picked?(v2.clip.trimIn||0):0,offset:off,clip:v2&&!picked?v2.clip:null});
  }
  return out;
}
let _splitVids=[];
function splitVideoEl(i){
  if(!_splitVids[i]){
    const v=document.createElement("video");
    v.muted=true;v.playsInline=true;v.preload="auto";v.style.display="none";
    v.setAttribute("aria-hidden","true");
    document.body.appendChild(v);_splitVids[i]=v;
  }
  return _splitVids[i];
}
/* Cover-fit draw of one source into one rectangle (no per-clip rotation /
   scale / crop inside split cells — stated in the report). */
function drawCoverInto(ctx,src,x,y,cw,ch){
  const sw=src.videoWidth||src.naturalWidth||src.width, sh=src.videoHeight||src.naturalHeight||src.height;
  if(!sw||!sh||!cw||!ch)return;
  const s=Math.max(cw/sw,ch/sh),dw=sw*s,dh=sh*s;
  const sx=x+(cw-dw)/2, sy=y+(ch-dh)/2;
  ctx.drawImage(src,sx,sy,dw,dh);
}
/* Canvas-export split-screen draw (uses original files, never proxies). */
async function drawSplitCells(ctx,w,h,main,t){
  const rects=splitCellRects(S.splitScreen.mode,w,h);
  const srcs=splitSourcesAt(t);
  for(let i=0;i<rects.length;i++){
    const [x,y,cw,ch]=rects[i];
    const s=srcs[i];
    ctx.fillStyle="#000";ctx.fillRect(x,y,cw,ch);
    if(!s||!s.media)continue;
    if(s.media.type==="image"){
      const im=exportImgCache(s.media);
      if(im)drawCoverInto(ctx,im,x,y,cw,ch);
    }else if(s.media.type==="video"){
      const el=i===0?video:splitVideoEl(i-1);
      /* WebCodecs export (2026-11-12): during an export every cell video
         is seeked to the exact frame time by prepareFrameMedia and stays
         paused — never play or re-seek here. In the preview (not
         exporting) the cells still play in real time as before. */
      const want=(s.trimIn||0)+(s.offset||0);
      if(el!==video&&!S.exporting){
        if(el._src!==s.media.url){el._src=s.media.url;el.src=s.media.url;}
        if(Math.abs(el.currentTime-want)>0.4){try{el.currentTime=clamp(want,0,9999);}catch(e){}}
        if(el.paused)el.play().catch(()=>{});
      }
      if(el.readyState>=2&&el.videoWidth)drawCoverInto(ctx,el,x,y,cw,ch);
    }
    ctx.strokeStyle="rgba(255,255,255,.25)";ctx.lineWidth=1;ctx.strokeRect(x+0.5,y+0.5,cw-1,ch-1);
  }
}
/* Preview split-screen: composites the cells onto the overlay canvas
   (which sits on top of the video element) and hides the video element
   itself, so what you see is the real composite. Runs on seek + the
   100 ms playback clock; skipped while exporting (the export loop owns
   the timeline then). */
function renderSplitPreview(){
  const cv=$("overlayCanvas"),st=$("videoStage");
  if(!cv||!st)return false;
  const on=!!(S.splitScreen&&S.splitScreen.mode)&&!S.exporting;
  if(!on){
    if(video.style.visibility==="hidden"&&!chromaPreviewOn()){video.style.visibility="";if(imgPrev)imgPrev.style.visibility="";}
    return false;
  }
  const hit=activeVideoAt(S.curTime);
  if(!hit){video.style.visibility="";return false;}
  const r=st.getBoundingClientRect();
  cv.width=Math.max(2,Math.round(r.width));cv.height=Math.max(2,Math.round(r.height));
  const x=cv.getContext("2d");
  x.fillStyle="#000";x.fillRect(0,0,cv.width,cv.height);
  const rects=splitCellRects(S.splitScreen.mode,cv.width,cv.height);
  const srcs=splitSourcesAt(S.curTime);
  rects.forEach((rc,i)=>{
    const [cx,cy,cw,ch]=rc;
    const s=srcs[i];
    if(!s||!s.media)return;
    if(s.media.type==="image"){
      const im=exportImgCache(s.media);
      if(im)drawCoverInto(x,im,cx,cy,cw,ch);
    }else if(s.media.type==="video"){
      const el=i===0?video:splitVideoEl(i-1);
      if(i>0){
        const want=(s.trimIn||0)+(s.offset||0);
        if(el._src!==previewUrl(s.media)){el._src=previewUrl(s.media);el.src=previewUrl(s.media);}
        if(Math.abs(el.currentTime-want)>0.4){try{el.currentTime=clamp(want,0,9999);}catch(e){}}
      }
      if(el.readyState>=2&&el.videoWidth)drawCoverInto(x,el,cx,cy,cw,ch);
    }
    x.strokeStyle="rgba(255,255,255,.25)";x.lineWidth=1;x.strokeRect(cx+0.5,cy+0.5,cw-1,ch-1);
  });
  video.style.visibility="hidden";
  if(imgPrev)imgPrev.style.visibility="hidden";
  return true;
}

/* ---------- CHROMA KEY / GREEN SCREEN ---------- */
function chromaClipAt(t){
  const hit=activeVideoAt(t);
  if(!hit||!hit.clip.chroma||!hit.clip.chroma.on)return null;
  return hit.clip;
}
function chromaPreviewOn(){return !!chromaClipAt(S.curTime)&&!S.splitScreen&&!S.exporting;}
/* Preview keying: draws the active clip's frame onto the overlay canvas
   with the key colour removed (real pixel keying, capped at 640 px wide
   so it stays smooth on a phone). The video element is hidden while the
   keyed canvas is showing. */
function renderChromaPreview(){
  const cv=$("overlayCanvas"),st=$("videoStage");
  if(!cv||!st)return false;
  const clip=chromaClipAt(S.curTime);
  if(!clip||S.splitScreen||S.exporting){
    if(video.style.visibility==="hidden"&&!renderSplitPreviewActive()){video.style.visibility="";if(imgPrev)imgPrev.style.visibility="";}
    return false;
  }
  const m=mediaById(clip.mediaId);
  if(!m)return false;
  const srcEl=m.type==="image"?(imgPrev||exportImgCache(m)):video;
  if(!srcEl)return false;
  const sw=srcEl.videoWidth||srcEl.naturalWidth||0, sh=srcEl.videoHeight||srcEl.naturalHeight||0;
  if(!sw||!sh)return false;
  const r=st.getBoundingClientRect();
  const cw=Math.min(640,Math.max(2,Math.round(r.width))), ch=Math.max(2,Math.round(cw*sh/sw));
  let oc=renderChromaPreview._oc;
  if(!oc){oc=document.createElement("canvas");renderChromaPreview._oc=oc;}
  oc.width=cw;oc.height=ch;
  const ox=oc.getContext("2d");
  ox.drawImage(srcEl,0,0,cw,ch);
  let img;
  try{img=ox.getImageData(0,0,cw,ch);}catch(e){return false;}
  keyPixels(img.data,clip.chroma,null);
  ox.putImageData(img,0,0);
  cv.width=Math.max(2,Math.round(r.width));cv.height=Math.max(2,Math.round(r.height));
  const x=cv.getContext("2d");
  x.clearRect(0,0,cv.width,cv.height);
  x.drawImage(oc,0,0,cv.width,cv.height);
  video.style.visibility="hidden";
  if(imgPrev)imgPrev.style.visibility="hidden";
  return true;
}
function renderSplitPreviewActive(){return !!(S.splitScreen&&S.splitScreen.mode);}
/* Shared keying math: pixels near the key colour become transparent
   (preview) or are replaced by the backdrop pixel (canvas export, where
   bg is the backdrop ImageData; when bg is null the pixel is zeroed). */
function keyPixels(data,chroma,bg){
  const [kr,kg,kb]=hexRgb(chroma.color||"#00ff00");
  const tol=chroma.tol||40, spill=(chroma.spill||0)/100;
  for(let i=0;i<data.length;i+=4){
    const r=data[i],g=data[i+1],b=data[i+2];
    const dist=Math.sqrt((r-kr)*(r-kr)+(g-kg)*(g-kg)+(b-kb)*(b-kb));
    /* spill suppression: pull a green-dominant pixel back toward neutral */
    let rr=r,gg=g,bb=b;
    if(g>rr&&g>bb){
      const mx=Math.max(rr,bb);
      gg=mx+(g-mx)*(1-spill);
    }
    if(dist<tol){
      const k=clamp((dist-tol*0.5)/(tol*0.5),0,1); /* 0 = fully keyed, 1 = untouched */
      if(bg){
        data[i]=bg[i]*(1-k)+rr*k; data[i+1]=bg[i+1]*(1-k)+gg*k; data[i+2]=bg[i+2]*(1-k)+bb*k;
      }else{
        data[i]=rr*k; data[i+1]=gg*k; data[i+2]=bb*k; data[i+3]=Math.round(255*k);
      }
    }else{
      data[i]=rr; data[i+1]=gg; data[i+2]=bb;
    }
  }
}
/* Canvas-export chroma pass: replaces keyed pixels with the backdrop
   frame captured before the main clip was drawn. */
function applyChromaPixels(ctx,bgCv,w,h,chroma){
  let fg,bg;
  try{fg=ctx.getImageData(0,0,w,h);bg=bgCv.getContext("2d").getImageData(0,0,w,h);}catch(e){return;}
  keyPixels(fg.data,chroma,bg.data);
  ctx.putImageData(fg,0,0);
}

/* ---------- MASKS (shape / linear / radial, feathered) ---------- */
function maskAlphaAt(mask,x,y,w,h){
  const f=Math.max(0,(mask.feather||0))*(w/1280); /* feather in export px */
  const smooth=(v,a,b)=>clamp((v-a)/Math.max(0.001,b-a),0,1);
  if(mask.shape==="rect"){
    const ix=w*0.12, iy=h*0.12;
    const dx=Math.max(ix-x,x-(w-ix),0), dy=Math.max(iy-y,y-(h-iy),0);
    const d=Math.max(dx,dy);
    return 1-smooth(d,0,Math.max(1,f));
  }
  if(mask.shape==="ellipse"){
    const cx=w/2, cy=h/2, rx=w*0.38, ry=h*0.38;
    const q=Math.sqrt(((x-cx)/rx)*((x-cx)/rx)+((y-cy)/ry)*((y-cy)/ry)); /* 1 = edge */
    return 1-smooth(q,1-Math.max(0.02,f/Math.max(1,rx)),1);
  }
  if(mask.shape==="linear"){
    const dir=mask.dir||"left";
    const p=dir==="left"?x/w:dir==="right"?1-x/w:dir==="up"?y/h:1-y/h;
    return smooth(p,0.15,0.15+Math.max(0.05,f/w*2+0.25));
  }
  if(mask.shape==="radial"){
    const d=Math.sqrt((x-w/2)*(x-w/2)+(y-h/2)*(y-h/2))/(Math.min(w,h)/2);
    return 1-smooth(d,0.55,0.55+Math.max(0.05,f/Math.max(1,Math.min(w,h)/2)+0.2));
  }
  return 1;
}
/* Canvas-export mask pass: fades the frame to black outside the mask
   shape (feathered). The preview shows the same shape as a CSS clip-path
   (see refreshVideoStyle) — the export is the feathered, real version. */
function applyMaskPixels(ctx,w,h,mask){
  let img;
  try{img=ctx.getImageData(0,0,w,h);}catch(e){return;}
  const d=img.data;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const a=maskAlphaAt(mask,x+0.5,y+0.5,w,h);
      if(a>=1)continue;
      const i=(y*w+x)*4;
      d[i]*=a; d[i+1]*=a; d[i+2]*=a;
    }
  }
  ctx.putImageData(img,0,0);
}

/* ---------- PROXY EDITING (large media) ---------- */
/* A proxy is a low-res 480p re-encode made on-device with the vendored
   Video Engine. It is generated automatically on import for videos 60 s
   or longer, or files 100 MB or larger — and on demand from the Pro
   panel. The preview may use it (toggle); exports ALWAYS use the
   original (doExport forces S.proxyOn off for the export). A proxy lives
   in memory only: after a reload it is gone and is regenerated on demand
   (the media record keeps no proxy across restarts — stated in the UI). */
async function maybeProxy(m){
  if(!m||m.type!=="video"||m.proxyUrl||m.proxyBusy)return;
  if((m.duration||0)>=60||(m.size||0)>=100*1024*1024)generateProxy(m);
}
async function generateProxy(m){
  if(!m||m.type!=="video"||m.proxyBusy||m.proxyUrl)return false;
  m.proxyBusy=true;syncProxyUI();
  const ff=await loadFFmpeg();
  if(!ff){m.proxyBusy=false;m.proxyNote="Video Engine unavailable — proxy not made";syncProxyUI();toast("Proxy not made: the Video Engine could not load");return false;}
  try{
    const fetchFile=window.__ffFetchFile;
    const blob=m.file||await fetch(m.url).then(r=>r.blob());
    const ext=(m.name.split(".").pop()||"mp4").toLowerCase();
    await ff.writeFile("px_in."+ext,await fetchFile(blob));
    await ff.exec(["-i","px_in."+ext,"-vf","scale=854:-2","-c:v","libx264","-preset","veryfast","-crf","28","-c:a","aac","-b:a","96k","px_out.mp4"]);
    const data=await ff.readFile("px_out.mp4");
    const pb=new Blob([data.buffer],{type:"video/mp4"});
    m.proxyUrl=URL.createObjectURL(pb);m.proxyBusy=false;m.proxyNote="";
    try{await ff.deleteFile("px_in."+ext);}catch(e){}
    try{await ff.deleteFile("px_out.mp4");}catch(e){}
    syncProxyUI();
    toast("Proxy ready for "+m.name+" (480p) — turn on “Use proxy in preview” to use it; exports always use the original");
    return true;
  }catch(e){
    m.proxyBusy=false;m.proxyNote="Proxy failed: "+(e&&e.message||e);syncProxyUI();
    toast("Proxy failed for "+m.name+": "+(e&&e.message||e));
    return false;
  }
}
function syncProxyUI(){
  const t=$("proxyToggle");if(t)t.checked=!!S.proxyOn;
  const st=$("proxyStatus");if(!st)return;
  const ready=S.media.filter(m=>m.proxyUrl);
  const busy=S.media.filter(m=>m.proxyBusy);
  const notes=S.media.filter(m=>m.proxyNote&&!m.proxyUrl&&!m.proxyBusy);
  const bits=[];
  if(ready.length)bits.push("Proxies ready ("+ready.length+"): "+ready.map(m=>m.name).join(", "));
  if(busy.length)bits.push("Generating proxy: "+busy.map(m=>m.name).join(", ")+"…");
  if(notes.length)bits.push(notes.map(m=>m.name+": "+m.proxyNote).join("; "));
  st.textContent=bits.length?bits.join(" · "):"No proxies yet. Long videos (60 s+) or files 100 MB+ get a 480p proxy automatically on import; you can also generate one for the current media above. Proxies are kept in memory only — after a reload, generate again.";
}

/* ---------- AUDIO DUCKING (real, time-based) ---------- */
/* Verification of the old behaviour (Phase 1–4): the “Duck music” button
   only set the global music volume to 25% — and it did not even affect
   clips already on the timeline, because each audio clip copies the volume
   at insert time. The new ducking is time-based in the Canvas export:
   while any voice clip on A1 is sounding, music clips on A2 are turned
   down by duckAmt (see renderTimelineAudioOffline). The Video Engine
   export lists it as skipped. */
function syncDuckUI(){
  const b=$("btnDuckToggle");if(b)b.innerHTML=epIcon("volume-1")+" Ducking: "+(S.duckOn?"On":"Off");
  const old=$("btnDuck");if(old)old.innerHTML=epIcon("volume-1")+(S.duckOn?" Ducking: On":" Duck music under voice");
  const s=$("duckAmt");if(s)s.value=S.duckAmt||60;
  const v=$("duckAmtV");if(v)v.textContent=(S.duckAmt||60)+"% down";
}

/* ---------- EXPORT INDIVIDUAL FRAMES ---------- */
/* Saves the frame under the playhead as a real image (PNG/JPG/WebP) with
   the current grade, text and captions burned in. JPG is filled white
   first (it has no transparency). Split screen is honoured when active. */
async function exportFrame(fmt,quality,w,h){
  fmt=(fmt||"png").toLowerCase();
  if(!["png","jpeg","webp"].includes(fmt))fmt="png";
  w=clamp(Math.round(+w||1280),16,4096);h=clamp(Math.round(+h||720),16,4096);
  const t=S.curTime;
  const hit=activeVideoAt(t);
  const main=hit&&!hit.overlay?hit:clipOnTrackAt("v1",t);
  if(!main){toast("Move the playhead onto a video clip first");return false;}
  const m=mediaById(main.clip.mediaId);
  if(!m){toast("This clip's media file is missing — re-import it");return false;}
  const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d");
  if(fmt==="jpeg"){ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);}
  else{ctx.fillStyle="#000";ctx.fillRect(0,0,w,h);}
  const gradeOn=gradeActive();
  ctx.filter=gradeOn?"none":cssFilterString();
  if(S.splitScreen&&S.splitScreen.mode){
    await drawSplitCells(ctx,w,h,main,t);
  }else if(m.type==="image"){
    const im=exportImgCache(m);
    if(im)drawCover(ctx,im,w,h,main.clip);
  }else if(video.readyState>=2&&video.videoWidth){
    drawCover(ctx,video,w,h,main.clip);
  }else{
    toast("The video frame is not loaded yet — wait a moment and try again");
    return false;
  }
  ctx.filter="none";
  try{
    if(gradeOn){const img=ctx.getImageData(0,0,w,h);applyGradePixels(img.data,w,h);ctx.putImageData(img,0,0);}
    if(main.clip.mask&&main.clip.mask.shape&&main.clip.mask.shape!=="none")applyMaskPixels(ctx,w,h,main.clip.mask);
    if(main.clip.chroma&&main.clip.chroma.on){
      const bg=document.createElement("canvas");bg.width=w;bg.height=h;
      bg.getContext("2d").fillStyle="#000";bg.getContext("2d").fillRect(0,0,w,h);
      applyChromaPixels(ctx,bg,w,h,main.clip.chroma);
    }
  }catch(e){/* cross-origin frames cannot be read — the ungraded frame still exports */}
  ctx.save();ctx.globalAlpha=1;
  activeTextAt(t).forEach(c=>{drawAnimatedText(ctx,w,h,c,t,1);});
  const cap=activeCaptionAt(t);
  if(cap){const cs=S.capStyle||{};ctx.save();ctx.font=`bold ${Math.round((cs.size||26)*w/1280)}px ${cs.font||"Arial"}`;ctx.textAlign="center";const tw=ctx.measureText(cap.text).width;if(cs.bgOn!==false){ctx.fillStyle=cs.bg||"rgba(0,0,0,.65)";ctx.fillRect(w/2-tw/2-10,h*0.88-28,tw+20,40);}ctx.fillStyle=cs.color||"#fff";ctx.fillText(cap.text,w/2,h*0.88);ctx.restore();}
  ctx.restore();
  const mime=fmt==="jpeg"?"image/jpeg":fmt==="webp"?"image/webp":"image/png";
  const blob=await new Promise(res=>canvas.toBlob(res,mime,fmt==="png"?undefined:clamp((quality||92)/100,0.5,1)));
  if(!blob){toast("Could not create the frame image");return false;}
  const url=URL.createObjectURL(blob);
  const fname=(S.projectName||"editora-frame").replace(/[^\w\-]+/g,"-")+"-frame-"+Math.round(t*10)/10+"s."+(fmt==="jpeg"?"jpg":fmt);
  const a=document.createElement("a");a.href=url;a.download=fname;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
  recordExport({status:"Completed",settings:`Frame export · ${fmt.toUpperCase()} ${w}×${h}`,size:blob.size,job:null});
  toast("Frame exported as "+fname);
  return true;
}

/* ---------- EXPORT QUEUE (batch export) ---------- */
/* Phase 6 — the queue is persisted in localStorage, so it survives a reload.
   A job that was "running" when the app closed is marked Failed on the next
   load with an honest reason — it never silently restarts or claims success. */
const QUEUE_KEY="editora-export-queue";
function saveQueueState(){try{localStorage.setItem(QUEUE_KEY,JSON.stringify(S.exportQueue||[]));}catch(e){}}
function loadQueueState(){
  let q=[];try{q=JSON.parse(localStorage.getItem(QUEUE_KEY)||"[]");}catch(e){q=[];}
  if(!Array.isArray(q))q=[];
  q.forEach(j=>{if(j.status==="running"){j.status="failed";j.note="Interrupted — the app was closed or reloaded while this export was running. Retry it from the queue.";}});
  S.exportQueue=q;
}
function queueJobFromSettings(job){
  const j=job||readExportSettings();
  if(!j.w||!j.bitrate){toast("Check the export settings first — custom resolution must be 16–4096 each way, custom bitrate 0.5–50 Mbps");return;}
  S.exportQueue.push({id:uid(),name:(S.projectName||"Untitled Project"),job:JSON.parse(JSON.stringify(j)),status:"queued",note:j.label||""});
  renderQueue();
  toast("Added to the export queue: "+(j.label||"export"));
}
function renderQueue(){
  const box=$("expQueueList");if(!box)return;
  if(!S.exportQueue.length){box.innerHTML='<p class="hint">Queue is empty — add the current export settings, or queue 480p + 720p + 1080p in one tap.</p>';saveQueueState();return;}
  box.innerHTML="";
  S.exportQueue.forEach(j=>{
    const r=document.createElement("div");r.className="queue-row";r.dataset.qid=j.id;
    r.innerHTML=`<span class="nm">${epIcon("film")} ${j.name}</span><small>${j.job?j.job.label:""}</small><small>${j.job?(j.job.engine==="ffmpeg"?"Video Engine":j.job.engine==="canvas"?"Canvas":"Auto"):""}</small><b class="st-${j.status}">${j.status==="queued"?"Queued":j.status==="running"?"Running…":j.status==="done"?epIcon("check-circle")+" Done":j.status==="failed"?epIcon("x-circle")+" Failed":"Cancelled"}</b><small class="q-progress">${j.progress||""}</small>`;
    if(j.note&&j.status!=="queued"){const n=document.createElement("small");n.textContent=j.note;r.appendChild(n);}
    /* Phase 6 — failed jobs can be retried (back to Queued); any job that
       is not currently running can be removed from the queue. */
    if(j.status==="failed"){
      const re=document.createElement("button");re.className="mini";re.innerHTML=epIcon("refresh-cw")+" Retry";
      re.onclick=()=>{j.status="queued";j.note="";j.progress="";renderQueue();toast("Job re-queued — press Run queue to retry it");};
      r.appendChild(re);
    }
    if(j.status!=="running"){
      const del=document.createElement("button");del.className="mini";del.innerHTML=epIcon("trash");del.title="Remove from queue";
      del.onclick=()=>{S.exportQueue=S.exportQueue.filter(x=>x.id!==j.id);renderQueue();};
      r.appendChild(del);
    }
    box.appendChild(r);
  });
  saveQueueState();
}
async function runQueue(){
  if(S.queueRunning){toast("The queue is already running");return;}
  if(!S.clips.length){toast("Add a clip to the timeline first");return;}
  if(!S.exportQueue.some(j=>j.status==="queued")){toast("Queue is empty — add a job first");return;}
  S.queueRunning=true;S.queueCancelled=false;S.queuePaused=false;
  renderQueue();
  for(const job of S.exportQueue){
    if(S.queueCancelled)break;
    if(job.status!=="queued")continue;
    while(S.queuePaused&&!S.queueCancelled)await sleep(400);
    if(S.queueCancelled)break;
    job.status="running";job.note="";job.progress="Starting…";renderQueue();
    applyExportJobToDialog(job.job);
    const startedAt=Date.now();
    /* Phase 6 — live progress: the export engine writes its status into
       #expStatus; mirror it into this job's row twice a second. */
    const progTimer=setInterval(()=>{const t=$("expStatus");if(t&&t.textContent){job.progress=t.textContent.slice(0,120);const el=document.querySelector('[data-qid="'+job.id+'"] .q-progress');if(el)el.textContent=job.progress;}},500);
    await doExport();
    clearInterval(progTimer);job.progress="";
    const entry=getExportHistory().find(e=>e.date>=startedAt-1000);
    if(entry&&entry.status==="Completed"){
      job.status="done";job.note=entry.settings||"";
    }else{
      job.status="failed";
      job.note=($("expStatus").textContent||"Export failed").slice(0,160);
      recordExport({status:"Failed",note:"Queue job failed: "+job.note,job:job.job});
    }
    renderQueue();
  }
  if(S.queueCancelled){
    S.exportQueue.forEach(j=>{if(j.status==="queued"||j.status==="running"){j.status="cancelled";j.note="Cancelled";}});
    toast("Export queue cancelled");
  }else{
    toast("Export queue finished — "+S.exportQueue.filter(j=>j.status==="done").length+" done, "+S.exportQueue.filter(j=>j.status==="failed").length+" failed");
  }
  S.queueRunning=false;S.queuePaused=false;
  renderQueue();
}

/* ---------- COMPLETE PROJECT BACKUP (one file: project + media manifest) ---------- */
function fileToDataURL(file){
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error||new Error("read failed"));r.readAsDataURL(file);});
}
async function exportFullBackup(){
  const mediaManifest=S.media.map(m=>({id:m.id,name:m.name,type:m.type,size:m.size||0,duration:m.duration||0}));
  const mediaData={};
  let embedded=0;const skipped=[];
  for(const m of S.media){
    const blob=m.file||null;
    if(blob&&blob.size<=5*1024*1024){
      try{mediaData[m.id]=await fileToDataURL(blob);embedded++;}
      catch(e){skipped.push(m.name+" (could not be read)");}
    }else if(blob)skipped.push(m.name+" (too large to embed — in the manifest only)");
    else skipped.push(m.name+" (file not available on this device)");
  }
  const backup=EPProjectStore.makeVideoBackup(projectData(),mediaManifest,mediaData);
  downloadText((S.projectName||"project").replace(/[^\w\-]+/g,"-")+"-full-backup.json",JSON.stringify(backup),"application/json");
  const note=$("fullBackupNote");
  if(note)note.textContent="Backup saved: "+embedded+" small media file(s) embedded, "+skipped.length+" listed in the manifest only"+(skipped.length?": "+skipped.join("; "):"")+".";
  toast("Full backup saved ("+embedded+" media embedded, "+skipped.length+" manifest-only)");
}
async function importFullBackup(file){
  let b;
  try{b=JSON.parse(await file.text());}catch(e){toast("Invalid backup file");return;}
  if(b.formatVersion!=null&&b.formatVersion>EPProjectStore.FORMAT_VERSION){toast("This backup was made by a newer version of Editora Pro — update the app to restore it.");return;}
  if((b.version!=null&&b.version>EPProjectStore.FORMAT_VERSION)){toast("This backup was made by a newer version of Editora Pro — update the app to restore it.");return;}
  if(!b.project||!b.project.data){toast("Invalid backup file — no project inside");return;}
  const bManifest=b.mediaManifest||b.manifest||[];
  const bMedia=b.mediaData||b.media||{};
  applySnapshot(b.project.data);
  S.projectName=b.project.name||S.projectName;
  const pn=$("projectName");if(pn)pn.value=S.projectName;
  const missing=[];
  for(const mf of bManifest){
    if(bMedia&&bMedia[mf.id]){
      try{
        const blob=await (await fetch(bMedia[mf.id])).blob();
        const url=URL.createObjectURL(blob);
        if(!S.media.some(x=>x.id===mf.id)){
          S.media.push({id:mf.id,name:mf.name,type:mf.type,url,file:blob,fav:false,duration:mf.duration||0,addedAt:Date.now(),folderId:null,size:blob.size,proxyUrl:null,proxyBusy:false});
        }
      }catch(e){missing.push(mf.name);}
    }else missing.push(mf.name+" (manifest only — re-import it)");
  }
  renderMediaList();renderAll();pushHistory();
  toast("Backup restored"+(missing.length?"; missing media — re-import: "+missing.join(", "):" — all media restored"));
}

/* ---------- CUSTOM PRESETS — effects, transitions, grading ---------- */
/* Transition presets already exist (Phase 3, localStorage
   "editora-trans-presets"); buildTransPresets now also renders them into
   the Templates screen (see the edit in that function). Effect + grade
   presets are new here. */
const FX_PRESET_KEY="editora-fx-presets";
function getFxPresets(){try{return JSON.parse(localStorage.getItem(FX_PRESET_KEY)||"{}");}catch(e){return{};}}
function saveFxPreset(){
  const c=selectedVideoClip();
  if(!c){toast("Select a video clip first — effect presets save that clip's effects");return;}
  const n=(($("fxPresetName")||{}).value||"").trim();
  if(!n){toast("Type a preset name first");return;}
  const p=getFxPresets();
  p[n]={fx:JSON.parse(JSON.stringify(c.fx||{})),strength:S.fxStrength||60};
  try{localStorage.setItem(FX_PRESET_KEY,JSON.stringify(p));}catch(e){}
  buildFxPresets();toast("Effect preset saved: "+n);
}
function buildFxPresets(){
  const presets=getFxPresets();
  const render=(box)=>{
    if(!box)return;box.innerHTML="";
    Object.keys(presets).forEach(name=>{
      const wrap=document.createElement("span");wrap.style.cssText="display:flex;gap:4px";
      const b=document.createElement("button");b.className="fx-btn";b.style.flex="1";b.innerHTML=epIcon("sparkles")+" "+name;
      b.onclick=()=>{
        const c=selectedVideoClip();
        if(!c){toast("Select a video clip first — the preset applies to that clip");return;}
        c.fx=JSON.parse(JSON.stringify(presets[name].fx||{}));
        S.fxStrength=presets[name].strength||60;
        const fs=$("fxStrength");if(fs)fs.value=S.fxStrength;
        const fv=$("fxStrengthV");if(fv)fv.textContent=S.fxStrength+"%";
        buildFxGroups();applyFilters();pushHistory();
        toast("Effect preset applied to clip: "+name);
      };
      const del=document.createElement("button");del.className="mini";del.textContent="×";del.title="Delete preset";
      del.onclick=()=>{const p2=getFxPresets();delete p2[name];try{localStorage.setItem(FX_PRESET_KEY,JSON.stringify(p2));}catch(e){}buildFxPresets();};
      wrap.appendChild(b);wrap.appendChild(del);box.appendChild(wrap);
    });
    if(!Object.keys(presets).length)box.innerHTML='<p class="hint">No saved effect presets yet — save one from the Effects panel.</p>';
  };
  render($("fxPresets"));render($("fxPresetLib"));
}
const GRADE_PRESET_KEY="editora-grade-presets";
function getGradePresets(){try{return JSON.parse(localStorage.getItem(GRADE_PRESET_KEY)||"{}");}catch(e){return{};}}
function saveGradePreset(name){
  const g={color:JSON.parse(JSON.stringify(S.color)),filterId:S.filterId,filterIntensity:S.filterIntensity,
    curves:JSON.parse(JSON.stringify(S.curves)),hsl:JSON.parse(JSON.stringify(S.hsl)),
    wheels:JSON.parse(JSON.stringify(S.wheels)),balance:JSON.parse(JSON.stringify(S.balance))};
  const p=getGradePresets();p[name]=g;
  try{localStorage.setItem(GRADE_PRESET_KEY,JSON.stringify(p));}catch(e){}
  buildGradePresets();
}
function applyGradePreset(name){
  const g=getGradePresets()[name];
  if(!g)return;
  Object.assign(S.color,g.color||{});
  S.filterId=g.filterId||"Normal";S.filterIntensity=g.filterIntensity??100;
  if(g.curves)S.curves=g.curves;if(g.hsl)S.hsl=g.hsl;
  if(g.wheels)S.wheels=g.wheels;if(g.balance)S.balance=g.balance;
  syncGradeUI();applyFilters();scheduleGradeThumb();pushHistory();
  toast("Grade preset applied: "+name);
}
function buildGradePresets(){
  const presets=getGradePresets();
  const render=(box)=>{
    if(!box)return;box.innerHTML="";
    Object.keys(presets).forEach(name=>{
      const wrap=document.createElement("span");wrap.style.cssText="display:flex;gap:4px";
      const b=document.createElement("button");b.className="fx-btn";b.style.flex="1";b.innerHTML=epIcon("palette")+" "+name;
      b.onclick=()=>applyGradePreset(name);
      const del=document.createElement("button");del.className="mini";del.textContent="×";del.title="Delete preset";
      del.onclick=()=>{const p2=getGradePresets();delete p2[name];try{localStorage.setItem(GRADE_PRESET_KEY,JSON.stringify(p2));}catch(e){}buildGradePresets();};
      wrap.appendChild(b);wrap.appendChild(del);box.appendChild(wrap);
    });
    if(!Object.keys(presets).length)box.innerHTML='<p class="hint">No saved grade presets yet — save one from the Filters panel (Save button next to the preset name).</p>';
  };
  render($("gradePresets"));render($("gradePresetLib"));
}

/* ---------- LUT LIBRARY ---------- */
const LUT_NAMES_KEY="editora-lut-names";
function getLutNames(){try{return JSON.parse(localStorage.getItem(LUT_NAMES_KEY)||"[]");}catch(e){return[];}}
function rememberLutName(name){
  if(!name)return;
  const l=getLutNames();
  if(!l.includes(name)){l.push(name);try{localStorage.setItem(LUT_NAMES_KEY,JSON.stringify(l));}catch(e){}}
  buildLutLib();
}
function buildLutLib(){
  const box=$("lutLib");if(!box)return;box.innerHTML="";
  const names=getLutNames();
  names.forEach(name=>{
    const wrap=document.createElement("span");wrap.style.cssText="display:flex;gap:4px";
    const b=document.createElement("button");b.className="fx-btn";b.style.flex="1";
    b.innerHTML=(S.lutName===name&&S.lut?"● Loaded: ":epIcon("package")+" ")+name;
    b.onclick=()=>{
      if(S.lutName===name&&S.lut){toast("LUT already loaded: "+name);return;}
      toast("Pick the .cube file for “"+name+"” — LUT files are not stored with the project, so re-import it");
      $("lutInput").click();
    };
    const del=document.createElement("button");del.className="mini";del.textContent="×";del.title="Remove from library";
    del.onclick=()=>{try{localStorage.setItem(LUT_NAMES_KEY,JSON.stringify(getLutNames().filter(n=>n!==name)));}catch(e){}buildLutLib();};
    wrap.appendChild(b);wrap.appendChild(del);box.appendChild(wrap);
  });
  if(!names.length)box.innerHTML='<p class="hint">No LUTs imported yet — import a .cube file from the Adjustment tab or below.</p>';
}

/* ---------- INTRO / OUTRO TEMPLATES (real timeline treatments) ---------- */
const INTRO_TEMPLATES={
  "Fade-in opener":{text:"Welcome",font:"Impact",size:72,color:"#ffffff",pos:"center",anim:"zoom",trans:"fade",transDur:0.8},
  "Bold title opener":{text:"My Story",font:"Impact",size:80,color:"#fde047",pos:"center",anim:"pop",trans:"fade",transDur:0.5},
  "Lower-third intro":{text:"Presented by Editora Pro",font:"Arial",size:40,color:"#ffffff",pos:"bottom",anim:"slide",trans:"fade",transDur:0.6},
};
const OUTRO_TEMPLATES={
  "End screen":{text:"Thanks for watching",font:"Impact",size:64,color:"#ffffff",pos:"center",anim:"fade",trans:"fade",transDur:1},
  "Subscribe end card":{text:"Subscribe for more",font:"Impact",size:64,color:"#fde047",pos:"center",anim:"pop",trans:"fade",transDur:1},
  "Fade to black outro":{text:"",font:"Impact",size:64,color:"#ffffff",pos:"center",anim:"none",trans:"fadeblack",transDur:1.2},
};
function applyIntroTemplate(name){
  const t=INTRO_TEMPLATES[name];if(!t)return;
  const first=S.clips.filter(c=>(c.track||"v1")==="v1").sort((a,b)=>a.start-b.start)[0];
  if(!first){toast("Add a video clip to the timeline first");return;}
  S.textClips.push({id:uid(),text:t.text,start:0,duration:3,font:t.font,size:t.size,color:t.color,bg:"#000000",bgOn:false,outline:true,shadow:true,pos:t.pos,anim:t.anim,weight:900,spacing:1,lineHeight:110,align:"center",rot:0,opacity:100,grad:false,grad2:"#22d3ee"});
  first.transition=t.trans;first.transDur=t.transDur;
  renderTimeline();renderTextOverlay();pushHistory();
  toast("Intro applied: "+name+" — title clip at 0s + "+t.trans+" on the first clip");
}
function applyOutroTemplate(name){
  const t=OUTRO_TEMPLATES[name];if(!t)return;
  const v1=S.clips.filter(c=>(c.track||"v1")==="v1").sort((a,b)=>a.start-b.start);
  const last=v1[v1.length-1];
  if(!last){toast("Add a video clip to the timeline first");return;}
  const end=totalDuration();
  if(t.text){
    S.textClips.push({id:uid(),text:t.text,start:end,duration:3,font:t.font,size:t.size,color:t.color,bg:"#000000",bgOn:false,outline:true,shadow:true,pos:t.pos,anim:t.anim,weight:900,spacing:1,lineHeight:110,align:"center",rot:0,opacity:100,grad:false,grad2:"#22d3ee"});
  }
  last.transition=t.trans;last.transDur=t.transDur;
  renderTimeline();renderTextOverlay();pushHistory();
  toast("Outro applied: "+name+(t.text?" — end card at "+fmt(end):" — fade to black on the last clip"));
}
function buildIntroOutro(){
  const ib=$("introTemplates");
  if(ib){ib.innerHTML="";Object.keys(INTRO_TEMPLATES).forEach(n=>{const b=document.createElement("button");b.className="fx-btn";b.innerHTML=epIcon("film")+" "+n;b.onclick=()=>applyIntroTemplate(n);ib.appendChild(b);});}
  const ob=$("outroTemplates");
  if(ob){ob.innerHTML="";Object.keys(OUTRO_TEMPLATES).forEach(n=>{const b=document.createElement("button");b.className="fx-btn";b.innerHTML=epIcon("flag")+" "+n;b.onclick=()=>applyOutroTemplate(n);ob.appendChild(b);});}
}

/* ---------- SHAPES & BACKGROUNDS (asset library) ---------- */
function addShapeClip(shape){
  const color=($("shapeColor")||{}).value||"#22d3ee";
  S.textClips.push({id:uid(),name:shape+" shape",text:"",shape,start:S.curTime,duration:3,font:"Arial",size:120,color,bg:"#000000",bgOn:false,outline:false,shadow:false,pos:"center",anim:"pop",weight:700,spacing:0,lineHeight:120,align:"center",rot:0,opacity:100,grad:false,grad2:"#22d3ee"});
  renderTimeline();renderTextOverlay();pushHistory();
  toast("Shape added to timeline at the playhead");
}
function makeBackground(kind){
  const c=document.createElement("canvas");c.width=1920;c.height=1080;
  const x=c.getContext("2d");
  const c1=($("bgColor1")||{}).value||"#0b1026", c2=($("bgColor2")||{}).value||"#2878ff";
  if(kind==="solid"){x.fillStyle=c1;x.fillRect(0,0,1920,1080);}
  else if(kind==="gradient"){const g=x.createLinearGradient(0,0,1920,1080);g.addColorStop(0,c1);g.addColorStop(1,c2);x.fillStyle=g;x.fillRect(0,0,1920,1080);}
  else if(kind==="checker"){x.fillStyle=c1;x.fillRect(0,0,1920,1080);x.fillStyle=c2;const s=120;for(let yy=0;yy<1080;yy+=s)for(let xx=0;xx<1920;xx+=s){if((((xx+yy)/s)%2)===0)x.fillRect(xx,yy,s,s);}}
  else if(kind==="dots"){x.fillStyle=c1;x.fillRect(0,0,1920,1080);x.fillStyle=c2;for(let yy=60;yy<1080;yy+=120)for(let xx=60;xx<1920;xx+=120){x.beginPath();x.arc(xx,yy,28,0,7);x.fill();}}
  c.toBlob(b=>{
    if(!b){toast("Could not create the background");return;}
    const url=URL.createObjectURL(b);
    const m={id:uid(),name:"Background — "+kind,type:"image",url,file:b,fav:false,duration:5,addedAt:Date.now(),folderId:null,size:b.size,proxyUrl:null,proxyBusy:false};
    S.media.push(m);renderMediaList();addToTimeline(m);
  },"image/png");
}
const ASSET_EMOJIS=["⭐","🔥","❤️","😂","🎉","👍","💡","🎵","✨","🌈","💯","🚀","😍","👏","🎬","💎"];
function buildAssetLibrary(){
  const sg=$("assetStickers");
  if(sg&&!sg.children.length){
    ASSET_EMOJIS.forEach(em=>{
      const b=document.createElement("button");b.textContent=em;b.title="Add "+em;
      b.addEventListener("click",()=>{
        S.textClips.push({id:uid(),text:em,start:S.curTime,duration:3,font:"Arial",size:80,color:"#ffffff",bg:"#000000",bgOn:false,outline:false,shadow:true,pos:"center",anim:"pop"});
        renderTimeline();renderTextOverlay();pushHistory();toast("Sticker added to timeline");
      });
      sg.appendChild(b);
    });
  }
  const sh=$("assetShapes");
  if(sh){sh.innerHTML="";[["rect","square","Rectangle"],["circle","circle","Circle"],["triangle","triangle","Triangle"],["diamond","diamond","Diamond"]].forEach(([k,icn,label])=>{
    const b=document.createElement("button");b.className="fx-btn";b.innerHTML=epIcon(icn)+" "+label;
    b.onclick=()=>addShapeClip(k);sh.appendChild(b);});}
  const bg=$("assetBackgrounds");
  if(bg){bg.innerHTML="";[["solid","Solid colour"],["gradient","Gradient"],["checker","Checker pattern"],["dots","Dots pattern"]].forEach(([k,label])=>{
    const b=document.createElement("button");b.className="fx-btn";b.innerHTML=epIcon("image")+" "+label;
    b.onclick=()=>makeBackground(k);bg.appendChild(b);});}
  const sx=$("assetSfx");
  if(sx){sx.innerHTML="";SFX_TYPES.forEach(ty=>{
    const b=document.createElement("button");b.className="fx-btn";b.innerHTML=epIcon("volume")+" "+ty;b.onclick=()=>previewSfx(ty);
    const add=document.createElement("button");add.className="fx-btn";add.textContent="+ Timeline";add.onclick=()=>sfxToTimeline(ty);
    sx.appendChild(b);sx.appendChild(add);});}
  const bm=$("assetBgm");
  if(bm){bm.innerHTML="";BGM_TYPES.forEach(nm=>{
    const b=document.createElement("button");b.className="fx-btn";b.innerHTML=epIcon("music")+" "+nm;b.onclick=()=>previewBgm(nm);
    const add=document.createElement("button");add.className="fx-btn";add.textContent="+ Timeline";add.onclick=()=>bgmToTimeline(nm);
    bm.appendChild(b);bm.appendChild(add);});}
}

/* ---------- SPLIT-SCREEN UI ---------- */
function syncSplitUI(){
  const sel=$("splitLayout");if(!sel)return;
  sel.value=S.splitScreen?S.splitScreen.mode:"";
  syncSplitCellsUI();
}
function syncSplitCellsUI(){
  const box=$("splitCells");if(!box)return;
  box.innerHTML="";
  const mode=($("splitLayout")||{}).value||(S.splitScreen?S.splitScreen.mode:"");
  if(!mode)return;
  const n=splitCellCount(mode);
  const opts=['<option value="">— use the V2 clip at this time —</option>'].concat(
    S.media.filter(m=>m.type==="video"||m.type==="image").map(m=>`<option value="${m.id}">${m.name}</option>`)).join("");
  const label=document.createElement("p");label.className="hint";
  label.textContent="Cell 1 is the V1 clip under the playhead. Pick the video for each other cell (or leave it on the V2 clip).";
  box.appendChild(label);
  for(let i=1;i<n;i++){
    const lab=document.createElement("label");lab.textContent="Cell "+(i+1)+" video";
    const sel=document.createElement("select");sel.className="fld";sel.dataset.cell=String(i-1);
    sel.innerHTML=opts;
    const cur=S.splitScreen&&S.splitScreen.cells?S.splitScreen.cells[i-1]:null;
    if(cur)sel.value=cur;
    box.appendChild(lab);box.appendChild(sel);
  }
}
function applySplitScreen(){
  const mode=($("splitLayout")||{}).value;
  if(!mode){S.splitScreen=null;syncSplitCellsUI();pushHistory();seek(S.curTime);toast("Split screen off");return;}
  const cells=[];
  $$("#splitCells [data-cell]").forEach(sel=>cells.push(sel.value||null));
  S.splitScreen={mode,cells};
  pushHistory();seek(S.curTime);
  toast("Split screen on: "+splitCellCount(mode)+" videos ("+mode+") — preview and Canvas export");
}

/* ---------- PHASE 6 UI build + wiring ---------- */
function buildPhase6UI(){
  buildFxPresets();buildGradePresets();buildLutLib();buildIntroOutro();buildAssetLibrary();
  syncSplitUI();syncProxyUI();syncDuckUI();syncExportDialogRows();renderQueue();
}
function wirePhase6(){
  bind("splitLayout","change",syncSplitCellsUI);
  bind("btnSplitApply","click",applySplitScreen);
  bind("btnSplitOff","click",()=>{S.splitScreen=null;const s=$("splitLayout");if(s)s.value="";syncSplitCellsUI();pushHistory();seek(S.curTime);toast("Split screen off");});
  /* chroma key (selected video clip) */
  const syncChromaBtn=()=>{
    const c=selectedVideoClip();
    const on=!!(c&&c.chroma&&c.chroma.on);
    const b=$("btnChromaToggle");if(b)b.innerHTML=epIcon("key")+" Chroma key: "+(on?"On":"Off");
    if(c&&c.chroma){
      const cc=$("chromaColor");if(cc)cc.value=c.chroma.color||"#00ff00";
      const ct=$("chromaTol");if(ct){ct.value=c.chroma.tol||40;const v=$("chromaTolV");if(v)v.textContent=String(c.chroma.tol||40);}
      const cs=$("chromaSpill");if(cs){cs.value=c.chroma.spill||0;const v=$("chromaSpillV");if(v)v.textContent=(c.chroma.spill||0)+"%";}
    }
  };
  window.__syncChromaBtn=syncChromaBtn;
  bind("btnChromaToggle","click",()=>{
    const c=selectedVideoClip();
    if(!c){toast("Select a video clip first — chroma key applies to that clip");return;}
    if(!c.chroma)c.chroma={color:($("chromaColor")||{}).value||"#00ff00",tol:+($("chromaTol")||{}).value||40,spill:+($("chromaSpill")||{}).value||0,on:false};
    c.chroma.on=!c.chroma.on;
    syncChromaBtn();pushHistory();seek(S.curTime);
    toast(c.chroma.on?"Chroma key ON for this clip — the key colour is removed in the preview and in the Canvas export":"Chroma key OFF for this clip");
  });
  bind("chromaColor","input",e=>{const c=selectedVideoClip();if(c&&c.chroma){c.chroma.color=e.target.value;markDirty();seek(S.curTime);}});
  bind("chromaTol","input",e=>{const c=selectedVideoClip();if(c&&c.chroma){c.chroma.tol=+e.target.value;const v=$("chromaTolV");if(v)v.textContent=e.target.value;markDirty();seek(S.curTime);}});
  bind("chromaSpill","input",e=>{const c=selectedVideoClip();if(c&&c.chroma){c.chroma.spill=+e.target.value;const v=$("chromaSpillV");if(v)v.textContent=e.target.value+"%";markDirty();seek(S.curTime);}});
  bind("btnChromaPick","click",()=>{
    const c=selectedVideoClip();
    if(!c){toast("Select a video clip first");return;}
    if(!c.chroma)c.chroma={color:"#00ff00",tol:40,spill:30,on:true};
    S._chromaPick=true;
    toast("Tap the video frame to pick the key colour from the picture");
  });
  const stage=$("videoStage");
  if(stage)stage.addEventListener("click",e=>{
    if(!S._chromaPick)return;
    S._chromaPick=false;
    const c=selectedVideoClip();
    if(!c||!c.chroma||video.readyState<2||!video.videoWidth)return;
    const r=video.getBoundingClientRect();
    const fx=(e.clientX-r.left)/Math.max(1,r.width), fy=(e.clientY-r.top)/Math.max(1,r.height);
    const oc=document.createElement("canvas");oc.width=video.videoWidth;oc.height=video.videoHeight;
    const ox=oc.getContext("2d");ox.drawImage(video,0,0);
    let px;
    try{px=ox.getImageData(Math.floor(fx*video.videoWidth),Math.floor(fy*video.videoHeight),1,1).data;}catch(err){return;}
    const hex="#"+[px[0],px[1],px[2]].map(v=>v.toString(16).padStart(2,"0")).join("");
    c.chroma.color=hex;if(!c.chroma.on)c.chroma.on=true;
    const cc=$("chromaColor");if(cc)cc.value=hex;
    syncChromaBtn();pushHistory();seek(S.curTime);
    toast("Key colour picked: "+hex);
  });
  /* mask (selected video clip) */
  bind("maskFeather","input",e=>{const v=$("maskFeatherV");if(v)v.textContent=e.target.value+"px";});
  bind("btnMaskApply","click",()=>{
    const c=selectedVideoClip();
    if(!c){toast("Select a video clip first — the mask applies to that clip");return;}
    const shape=($("maskShape")||{}).value||"none";
    if(shape==="none"){delete c.mask;applyFilters();pushHistory();toast("Mask removed from this clip");return;}
    c.mask={shape,dir:($("maskDir")||{}).value||"left",feather:+($("maskFeather")||{}).value||0};
    applyFilters();pushHistory();seek(S.curTime);
    toast("Mask applied to this clip ("+shape+") — feathered in the Canvas export");
  });
  /* proxy */
  bind("proxyToggle","change",e=>{S.proxyOn=e.target.checked;if(curMedia)loadPreview(curMedia);syncProxyUI();pushHistory();toast(S.proxyOn?"Preview uses proxies when one exists (exports still use originals)":"Preview uses original files");});
  bind("btnGenProxy","click",()=>{
    const m=curMedia||(selectedVideoClip()?mediaById(selectedVideoClip().mediaId):null);
    if(!m){toast("Import a video first");return;}
    if(m.proxyUrl){toast("A proxy already exists for "+m.name);return;}
    generateProxy(m);
  });
  /* ducking (also wired to the Audio tab's old Duck button — see init) */
  bind("btnDuckToggle","click",()=>{S.duckOn=!S.duckOn;syncDuckUI();pushHistory();toast(S.duckOn?"Audio ducking ON — A2 music ducks under A1 voice in the Canvas export":"Audio ducking OFF");});
  bind("duckAmt","input",e=>{S.duckAmt=+e.target.value;const v=$("duckAmtV");if(v)v.textContent=e.target.value+"% down";markDirty();});
  /* frame export */
  const frameFromCenter=()=>exportFrame(($("frameFmt")||{}).value||"png",+($("frameQuality")||{}).value||92,+($("frameW")||{}).value||1280,+($("frameH")||{}).value||720);
  bind("btnExportFrame","click",frameFromCenter);
  bind("btnExportFrame2","click",frameFromCenter);
  bind("btnExportFrameModal","click",()=>exportFrame(($("frameFmtModal")||{}).value||"png",92,+($("frameW")||{}).value||1280,+($("frameH")||{}).value||720));
  bind("frameQuality","input",e=>{const v=$("frameQualityV");if(v)v.textContent=e.target.value+"%";});
  /* export dialog rows + queue */
  bind("expRes","change",syncExportDialogRows);
  /* Phase 4+5 — export presets (built-ins + saved customs). */
  bind("expPreset","change",e=>{if(e.target.value)applyExpPreset(e.target.value);});
  bind("btnSaveExpPreset","click",()=>{
    const n=($("expPresetName").value||"").trim();if(!n){toast("Type a preset name first");return;}
    const p=getExpPresets();
    p[n]={res:$("expRes").value,customW:$("expCustomW").value,customH:$("expCustomH").value,fps:+$("expFps").value||30,bitrate:$("expBitrate").value,bitrateCustom:$("expBitrateCustom").value,fmt:$("expFmt").value,codec:$("expCodec").value};
    try{localStorage.setItem("editora-export-presets",JSON.stringify(p));}catch(e){}
    buildExpPresets();$("expPreset").value=n;toast("Export preset saved: "+n);
  });
  bind("expBitrate","change",syncExportDialogRows);
  bind("btnAddToQueue","click",()=>queueJobFromSettings());
  bind("btnQueueAddCurrent","click",()=>queueJobFromSettings());
  bind("btnQueuePreset","click",()=>{
    if(!S.clips.length){toast("Add a clip to the timeline first");return;}
    const base=readExportSettings();
    if(!base.w||!base.bitrate){toast("Check the export settings first — custom resolution must be 16–4096 each way, custom bitrate 0.5–50 Mbps");return;}
    ["480","720","1080"].forEach(res=>{
      const j=JSON.parse(JSON.stringify(base));j.res=res;
      j.label=`${res}p · ${j.fps} fps · ${j.fmt.toUpperCase()}`;
      S.exportQueue.push({id:uid(),name:S.projectName||"Untitled Project",job:j,status:"queued",note:j.label});
    });
    renderQueue();toast("Queued 480p + 720p + 1080p — press Run queue");
  });
  bind("btnRunQueue","click",runQueue);
  bind("btnPauseQueue","click",()=>{
    if(!S.queueRunning){toast("The queue is not running");return;}
    S.queuePaused=!S.queuePaused;
    const b=$("btnPauseQueue");if(b)b.innerHTML=S.queuePaused?epIcon("play")+" Resume":epIcon("pause")+" Pause";
    toast(S.queuePaused?"Queue paused — it stops after the current job":"Queue resumed");
  });
  bind("btnCancelQueue","click",()=>{
    S.queueCancelled=true;
    if(S.exporting){const cb=$("btnCancelExport");if(cb&&!cb.disabled)cb.click();}
    toast("Cancelling the queue…");
  });
  /* full backup */
  bind("btnFullBackup","click",exportFullBackup);
  bind("btnRestoreBackup","click",()=>$("fullBackupInput").click());
  bind("fullBackupInput","change",e=>{const f=e.target.files[0];e.target.value="";if(f)importFullBackup(f);});
  /* presets + LUT library */
  bind("btnSaveFxPreset","click",saveFxPreset);
  bind("btnImportLUT2","click",()=>$("lutInput").click());
  /* Phase 4+5 — init: mute buttons, monitor readout, export presets. */
  syncMuteButtons();updateMonRes();buildExpPresets();
}
