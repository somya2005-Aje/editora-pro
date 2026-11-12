/* Editora Pro — Video Editor (Vanilla JS, no ads, no AI, no watermark) */
"use strict";
const $=id=>document.getElementById(id);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fmt=t=>{t=Math.max(0,t||0);const m=Math.floor(t/60),s=t%60;return String(m).padStart(2,"0")+":"+s.toFixed(1).padStart(4,"0");};
const toast=(m,ms=2600)=>{const t=$("toast");t.textContent=m;t.classList.add("show");clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove("show"),ms);};
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
  color:{brightness:100,contrast:100,saturation:100,exposure:0,temperature:0,tint:0,sharpness:0,highlights:0,shadows:0},
  preset:"Normal", fx:{}, fxStrength:60, rotation:0, flipH:false, flipV:false, cropRatio:"free", cropZoom:100,
  reverse:false, speed:1, curTime:0, duration:0, selClip:null, selType:null, snap:true, zoom:100,
  locked:{video:false,text:false,audio:false}, karaoke:false, transType:"none", transDur:0.5, posX:0, posY:0, scaleX:100, scaleY:100,
  clipboard:null, exportOnly:null, mediaFilterAdded:false,
  audVol:80, vidVol:100, fadeIn:0, fadeOut:0, bass:0, treble:0, muted:false,
  settings:{autosave:true,defRes:"1080",defFps:30}, dirty:false, exporting:false,
};
let history=[], hIndex=-1, historyLock=false;
window.S=S; // expose state so photo.js can read live color values
function snapshot(){return JSON.stringify({clips:S.clips,textClips:S.textClips,audioClips:S.audioClips,captions:S.captions,keyframes:S.keyframes,color:S.color,fx:S.fx,preset:S.preset,rotation:S.rotation,flipH:S.flipH,flipV:S.flipV,cropZoom:S.cropZoom,posX:S.posX,posY:S.posY,scaleX:S.scaleX,scaleY:S.scaleY,projectName:S.projectName});}
function pushHistory(){if(historyLock)return;history=history.slice(0,hIndex+1);history.push(snapshot());if(history.length>60)history.shift();hIndex=history.length-1;markDirty();}
function applySnapshot(json){historyLock=true;try{const d=JSON.parse(json);Object.assign(S,{clips:d.clips,textClips:d.textClips,audioClips:d.audioClips,captions:d.captions,keyframes:d.keyframes,color:d.color,fx:d.fx,preset:d.preset,rotation:d.rotation,flipH:d.flipH,flipV:d.flipV,cropZoom:d.cropZoom,posX:d.posX||0,posY:d.posY||0,scaleX:d.scaleX||100,scaleY:d.scaleY||100,projectName:d.projectName});$("projectName").value=S.projectName;syncColorUI();syncInspectorTransform();renderAll();}finally{historyLock=false;}}
function undo(){if(hIndex>0){hIndex--;applySnapshot(history[hIndex]);toast("Undone");}}
function redo(){if(hIndex<history.length-1){hIndex++;applySnapshot(history[hIndex]);toast("Redone");}}
function markDirty(){S.dirty=true;}

/* ---------- COLOR / FILTER ---------- */
const COLOR_DEFS=[["brightness","Brightness",0,200,100,"%",v=>v],["contrast","Contrast",0,200,100,"%",v=>v],["saturation","Saturation",0,200,100,"%",v=>v],["exposure","Exposure",-100,100,0,"",v=>v],["temperature","Temperature",-100,100,0,"",v=>v],["tint","Tint",-100,100,0,"",v=>v],["highlights","Highlights",-100,100,0,"",v=>v],["shadows","Shadows",-100,100,0,"",v=>v],["sharpness","Sharpness",0,100,0,"",v=>v]];
const PRESETS={
  Normal:{brightness:100,contrast:100,saturation:100,exposure:0,temperature:0,tint:0,highlights:0,shadows:0,sharpness:0},
  Vintage:{brightness:105,contrast:90,saturation:80,exposure:5,temperature:25,tint:10,highlights:-10,shadows:15,sharpness:0},
  "B&W":{brightness:100,contrast:115,saturation:0,exposure:0,temperature:0,tint:0,highlights:0,shadows:0,sharpness:10},
  Warm:{brightness:102,contrast:102,saturation:115,exposure:3,temperature:35,tint:5,highlights:5,shadows:0,sharpness:0},
  Cool:{brightness:100,contrast:105,saturation:105,exposure:0,temperature:-30,tint:-5,highlights:5,shadows:5,sharpness:0},
  Vivid:{brightness:103,contrast:118,saturation:150,exposure:2,temperature:5,tint:0,highlights:0,shadows:-5,sharpness:15},
  VHS:{brightness:98,contrast:110,saturation:130,exposure:0,temperature:10,tint:15,highlights:-15,shadows:10,sharpness:0},
};
function buildColorUI(){
  const box=$("colorSliders");box.innerHTML="";
  COLOR_DEFS.forEach(([key,label,min,max,def])=>{
    const w=document.createElement("div");
    w.innerHTML=`<label>${label} <span id="cv_${key}">${S.color[key]}</span></label><input type="range" min="${min}" max="${max}" value="${S.color[key]}" data-k="${key}">`;
    w.querySelector("input").addEventListener("input",e=>{S.color[key]=+e.target.value;$("cv_"+key).textContent=S.color[key];applyFilters();markDirty();});
    box.appendChild(w);
  });
  const pl=$("presetList");pl.innerHTML="";
  Object.keys(PRESETS).forEach(name=>{
    const b=document.createElement("button");b.className="fx-btn";b.textContent=name;
    b.onclick=()=>{applyPreset(name);};
    pl.appendChild(b);
  });
  // photo adjust panel mirrors color sliders for photo mode
  const pa=$("photoAdjust");pa.innerHTML="";
  [["brightness","Brightness",0,200],["contrast","Contrast",0,200],["saturation","Saturation",0,200],["exposure","Exposure",-100,100],["temperature","Temperature",-100,100]].forEach(([key,label,min,max])=>{
    const w=document.createElement("div");
    w.innerHTML=`<label>${label} <span id="pv_${key}">${S.color[key]}</span></label><input type="range" min="${min}" max="${max}" value="${S.color[key]}" data-k="${key}">`;
    w.querySelector("input").addEventListener("input",e=>{S.color[key]=+e.target.value;$("pv_"+key).textContent=S.color[key];const cv=$("cv_"+key);if(cv)cv.textContent=S.color[key];applyFilters();if(window.Photo)Photo.render();markDirty();});
    pa.appendChild(w);
  });
}
function syncColorUI(){buildColorUI();}
function applyPreset(name){const p=PRESETS[name];if(!p)return;Object.assign(S.color,p);S.preset=name;buildColorUI();applyFilters();if(window.Photo)Photo.render();pushHistory();toast("Preset applied: "+name);}
function cssFilterString(){
  const c=S.color;
  const temp=c.temperature>0?` sepia(${Math.min(30,c.temperature/3)}%)`:"";
  const tint=c.tint>0?` hue-rotate(${c.tint/5}deg)`:"";
  let f=`brightness(${c.brightness/100*(1+c.exposure/200)}) contrast(${c.contrast/100}) saturate(${c.saturation/100})${temp}${tint}`;
  if(c.sharpness>0) f+=` contrast(${1+c.sharpness/500})`;
  return f;
}
function applyFilters(){
  const v=$("previewVideo");
  v.style.filter=cssFilterString();
  const rot=S.rotation, fx=S.fx;
  let extra="";
  if(fx.blur) extra+=` blur(${(S.fxStrength/100*8).toFixed(1)}px)`;
  if(fx.glow) extra+=` drop-shadow(0 0 ${S.fxStrength/4}px rgba(255,255,255,.9))`;
  if(fx.vignette) extra+=` brightness(${1-S.fxStrength/400})`;
  v.style.filter=cssFilterString()+extra;
  v.style.transform=`translate(${S.posX||0}px,${S.posY||0}px) rotate(${rot}deg) scale(${((S.flipH?-1:1)*(S.cropZoom/100)*((S.scaleX||100)/100)).toFixed(3)},${((S.flipV?-1:1)*(S.cropZoom/100)*((S.scaleY||100)/100)).toFixed(3)})`;
  v.style.opacity=1;
  drawOverlayFX();
}
/* overlay canvas: vignette / grain / rgb-split approximation + glitch */
function drawOverlayFX(){
  const cv=$("overlayCanvas"),st=$("videoStage");if(!cv)return;
  const r=st.getBoundingClientRect();cv.width=Math.max(2,r.width);cv.height=Math.max(2,r.height);
  const x=cv.getContext("2d");x.clearRect(0,0,cv.width,cv.height);
  if(S.fx.vignette){const g=x.createRadialGradient(cv.width/2,cv.height/2,Math.min(cv.width,cv.height)*.35,cv.width/2,cv.height/2,Math.max(cv.width,cv.height)*.75);g.addColorStop(0,"rgba(0,0,0,0)");g.addColorStop(1,`rgba(0,0,0,${.35+S.fxStrength/200})`);x.fillStyle=g;x.fillRect(0,0,cv.width,cv.height);}
  if(S.fx.grain){x.fillStyle=`rgba(255,255,255,${S.fxStrength/600})`;for(let i=0;i<300;i++){x.fillRect(Math.random()*cv.width,Math.random()*cv.height,1.5,1.5);}}
  if(S.fx.glitch){x.fillStyle=`rgba(255,0,80,${S.fxStrength/400})`;x.fillRect(0,Math.random()*cv.height,cv.width,4+Math.random()*14);x.fillStyle=`rgba(0,255,255,${S.fxStrength/500})`;x.fillRect(0,Math.random()*cv.height,cv.width,3+Math.random()*10);}
  if(S.fx.rgb){x.fillStyle=`rgba(255,0,0,${S.fxStrength/500})`;x.fillRect(0,0,3,cv.height);x.fillStyle=`rgba(0,0,255,${S.fxStrength/500})`;x.fillRect(cv.width-3,0,3,cv.height);}
}

/* ---------- MEDIA ---------- */
function mediaType(f){if(f.type.startsWith("video/"))return"video";if(f.type.startsWith("image/"))return"image";if(f.type.startsWith("audio/"))return"audio";const e=(f.name.split(".").pop()||"").toLowerCase();if(["mp4","mov","webm","mkv","avi"].includes(e))return"video";if(["mp3","wav","aac","m4a","flac","ogg"].includes(e))return"audio";return"image";}
function addFiles(files){
  [...files].forEach(f=>{
    const type=mediaType(f);const url=URL.createObjectURL(f);
    const m={id:uid(),name:f.name,type,url,file:f,fav:false,duration:0};
    S.media.push(m);
    if(type==="video"){const v=document.createElement("video");v.preload="metadata";v.src=url;v.onloadedmetadata=()=>{m.duration=v.duration;renderMediaList();updateDuration();};}
    if(type==="audio"){const a=new Audio(url);a.onloadedmetadata=()=>{m.duration=a.duration;renderMediaList();drawWaveform(m);};m.audioEl=a;}
  });
  renderMediaList();pushHistory();toast(files.length+" file(s) imported");
}
function renderMediaList(){
  const q=($("mediaSearch").value||"").toLowerCase();const favOnly=$("btnFavFilter").classList.contains("on");
  const list=$("mediaList");list.innerHTML="";
  const usedIds=new Set([...S.clips,...S.audioClips].map(c=>c.mediaId));
  const items=S.media.filter(m=>(!favOnly||m.fav)&&(!S.mediaFilterAdded||usedIds.has(m.id))&&(!q||m.name.toLowerCase().includes(q)));
  if(!items.length){list.innerHTML='<p class="hint">No media matches.</p>';return;}
  items.forEach(m=>{
    const d=document.createElement("div");d.className="media-item";d.draggable=true;
    d.dataset.id=m.id;
    const thumb=m.type==="image"?`<img src="${m.url}" alt="">`:m.type==="video"?`<video src="${m.url}" muted preload="metadata"></video>`:`<div class="aud-ico">🎵</div>`;
    d.innerHTML=`<div class="thumb">${thumb}${m.duration?`<span class="dur-badge">${fmt(m.duration)}</span>`:""}</div><div class="mi-name">${m.name}</div><div class="mi-meta">${m.type}${m.duration?" · "+fmt(m.duration):""}</div>
      <div class="mi-actions"><button class="mini" data-act="fav" title="Favorite">${m.fav?"★":"☆"}</button>
      <button class="mini" data-act="add" title="Add to timeline">+ Timeline</button>
      <button class="mini" data-act="del" title="Delete">🗑</button></div>`;
    d.addEventListener("click",e=>{
      const act=e.target.dataset.act;
      if(act==="fav"){m.fav=!m.fav;renderMediaList();}
      else if(act==="del"){S.media=S.media.filter(x=>x.id!==m.id);renderMediaList();toast("Media removed");}
      else if(act==="add"){addToTimeline(m);}
      else if(m.type==="video"||m.type==="image"){loadPreview(m);}
    });
    d.addEventListener("dragstart",e=>{e.dataTransfer.setData("text/media",m.id);});
    list.appendChild(d);
  });
}
function addToTimeline(m){
  if(m.type==="audio"){
    S.audioClips.push({id:uid(),mediaId:m.id,name:m.name,start:totalDuration(),duration:m.duration||10,vol:S.audVol});
    drawWaveform(m);
  }else{
    const start=totalDuration();
    S.clips.push({id:uid(),mediaId:m.id,name:m.name,start,duration:m.duration||5,trimIn:0,trimOut:m.duration||5,opacity:100,scale:100,rotation:0,transition:"none",transDur:0.5});
    if(m.type==="video"||m.type==="image") loadPreview(m);
  }
  updateDuration();renderTimeline();pushHistory();toast("Added to timeline: "+m.name);
}
function totalDuration(){return S.clips.reduce((a,c)=>a+c.duration,0);}
function updateDuration(){
  const d=totalDuration();S.duration=d;
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
  else{video.style.display="";video.src=m.url;video.load();hideImagePreview();video.onloadedmetadata=()=>{S.duration=Math.max(S.duration,video.duration||0);updateDuration();};}
  applyFilters();
}
let imgPrev=null;
function showImagePreview(m){hideImagePreview();imgPrev=document.createElement("img");imgPrev.src=m.url;imgPrev.style.cssText="max-width:100%;max-height:100%;object-fit:contain";$("videoStage").insertBefore(imgPrev,video);}
function hideImagePreview(){if(imgPrev){imgPrev.remove();imgPrev=null;}}
function currentClipAt(t){let acc=0;for(const c of S.clips){if(t>=acc&&t<acc+c.duration)return{clip:c,offset:t-acc,acc};acc+=c.duration;}return null;}
function seek(t){
  S.curTime=clamp(t,0,Math.max(0.01,totalDuration()||video.duration||0));
  const hit=currentClipAt(S.curTime);
  if(hit){const m=S.media.find(x=>x.id===hit.clip.mediaId);
    video.muted=S.muted||!!hit.clip.muted;
    video.style.opacity=hit.clip.disabled?0.25:1;
    if(m&&m.type==="video"){if(curMedia!==m)loadPreview(m);if(Math.abs(video.currentTime-(hit.clip.trimIn+hit.offset))>0.25)video.currentTime=hit.clip.trimIn+hit.offset;}
    else if(m&&m.type==="image"){if(curMedia!==m)loadPreview(m);}
  } else { video.muted=S.muted; video.style.opacity=1; }
  updateTimeUI();renderTextOverlay();positionPlayhead();
}
function updateTimeUI(){const tot=totalDuration()||video.duration||0;$("timeDisplay").textContent=fmt(S.curTime)+" / "+fmt(tot);}
function togglePlay(){
  if(S.reverse){reversePlay();return;}
  if(video.paused){video.play().catch(()=>toast("Press play on the video — browser blocked autoplay"));$("btnPlay").textContent="⏸ Pause";}
  else{video.pause();$("btnPlay").textContent="▶ Play";}
}
function reversePlay(){
  if(reverseTimer){clearInterval(reverseTimer);reverseTimer=null;$("btnPlay").textContent="▶ Play";return;}
  video.pause();$("btnPlay").textContent="⏸ Reversing…";
  reverseTimer=setInterval(()=>{seek(S.curTime-0.1);if(S.curTime<=0){clearInterval(reverseTimer);reverseTimer=null;$("btnPlay").textContent="▶ Play";}},100);
}
video.addEventListener("timeupdate",()=>{if(!S.reverse&&curMedia&&curMedia.type==="video"){const hit=currentClipAt(S.curTime);/* keep curTime in sync with video clock */}});
video.addEventListener("ended",()=>{$("btnPlay").textContent="▶ Play";});
setInterval(()=>{ // sync clock while playing
  if(!video.paused&&curMedia&&curMedia.type==="video"){
    const hit=currentClipAt(S.curTime);
    if(hit){const want=hit.clip.trimIn+hit.offset;S.curTime=Math.min(totalDuration(),hit.acc+Math.max(0,video.currentTime-hit.clip.trimIn));}
    else S.curTime=clamp(S.curTime+0.1,0,totalDuration());
    updateTimeUI();renderTextOverlay();positionPlayhead();
    if(S.curTime>=totalDuration()-0.05){video.pause();$("btnPlay").textContent="▶ Play";}
  }
},100);
function frameStep(d){video.pause();seek(S.curTime+d/30);}

/* ---------- TEXT OVERLAY / CAPTIONS ---------- */
function activeTextAt(t){return S.textClips.filter(c=>t>=c.start&&t<c.start+c.duration);}
function activeCaptionAt(t){return S.captions.find(c=>t>=c.start&&t<=c.end);}
function renderTextOverlay(){
  const box=$("textOverlay");box.innerHTML="";
  const t=S.curTime;
  activeTextAt(t).forEach(c=>{
    const el=document.createElement("div");el.className="ov-text";
    el.textContent=c.text;el.style.fontFamily=c.font;el.style.fontSize=(c.size*0.7)+"px";el.style.color=c.color;
    el.style.top=c.pos==="top"?"8%":c.pos==="center"?"42%":"78%";
    if(c.bgOn)el.style.background=c.bg;
    if(c.outline)el.style.webkitTextStroke="1px #000";
    if(c.shadow)el.style.textShadow="3px 3px 6px #000";
    if(c.anim==="fade")el.style.animation="fadeIn .6s ease";
    if(c.anim==="slide")el.style.animation="slideUp .6s ease";
    if(c.anim==="pop")el.style.animation="popIn .4s ease";
    box.appendChild(el);
  });
  const cap=activeCaptionAt(t);
  if(cap){
    const el=document.createElement("div");el.className="ov-text";
    el.style.top="86%";el.style.background="rgba(0,0,0,.65)";el.style.fontSize="22px";
    if(S.karaoke){const words=cap.text.split(" ");const frac=(t-cap.start)/Math.max(.1,cap.end-cap.start);const n=Math.floor(frac*words.length);el.innerHTML=words.map((w,i)=>i<n?`<span style="color:#fde047">${w}</span>`:w).join(" ");}
    else el.textContent=cap.text;
    box.appendChild(el);
  }
}
function renderCapList(){
  const box=$("capList");box.innerHTML="";
  S.captions.forEach(c=>{
    const r=document.createElement("div");r.className="cap-row";
    r.innerHTML=`<input type="number" step="0.1" value="${c.start}" title="start s" style="width:56px"><input type="number" step="0.1" value="${c.end}" title="end s" style="width:56px"><input value="${c.text.replace(/"/g,"&quot;")}" style="flex:1"><button class="mini">🗑</button>`;
    const [s,e,txt,del]=r.querySelectorAll("input,button");
    s.onchange=()=>{c.start=+s.value;pushHistory();};
    e.onchange=()=>{c.end=+e.value;pushHistory();};
    txt.onchange=()=>{c.text=txt.value;pushHistory();};
    del.onclick=()=>{S.captions=S.captions.filter(x=>x.id!==c.id);renderCapList();renderTimeline();pushHistory();};
    box.appendChild(r);
  });
}
function parseSRT(txt){
  const out=[];const blocks=txt.trim().split(/\n\s*\n/);
  const toSec=s=>{const p=s.trim().split(/[:,]/);return (+p[0])*3600+(+p[1])*60+(+p[2])+ (+p[3])/1000;};
  blocks.forEach(b=>{const lines=b.split("\n").map(x=>x.trim()).filter(Boolean);if(lines.length<2)return;const tm=lines.find(l=>l.includes("-->"));if(!tm)return;const [a,bb]=tm.split("-->");const text=lines.slice(lines.indexOf(tm)+1).join(" ");if(text)out.push({id:uid(),text,start:toSec(a),end:toSec(bb)});});
  return out;
}
function toSRT(){return S.captions.map((c,i)=>`${i+1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}`).join("\n\n");}
function srtTime(t){const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=Math.floor(t%60),ms=Math.floor(t%1*1000);return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms).padStart(3,"0")}`;}
function toVTT(){return "WEBVTT\n\n"+S.captions.map(c=>`${srtTime(c.start).replace(",",".")} --> ${srtTime(c.end).replace(",",".")}\n${c.text}`).join("\n\n");}
function downloadText(name,content,mime="text/plain"){const b=new Blob([content],{type:mime});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);}

/* ---------- TIMELINE ---------- */
const PX_PER_SEC=()=>S.zoom; // px per second
function renderRuler(){
  const r=$("tlRuler");const tot=Math.max(10,totalDuration());r.style.width=(tot*PX_PER_SEC()+40)+"px";r.innerHTML="";
  const step=tot>120?10:tot>30?5:1;
  for(let t=0;t<=tot;t+=step){const s=document.createElement("span");s.style.left=(t*PX_PER_SEC())+"px";s.textContent=fmt(t);r.appendChild(s);}
}
function renderTimeline(){
  renderRuler();
  const draw=(trackEl,items,type)=>{
    trackEl.innerHTML="";trackEl.style.width=Math.max(10,totalDuration())*PX_PER_SEC()+40+"px";
    trackEl.classList.toggle("locked",S.locked[type]);
    items.forEach((it,idx)=>{
      const d=document.createElement("div");d.className="clip "+(type==="text"?"text":type==="audio"?"audio":"");
      if(S.selClip===it.id)d.classList.add("sel");
      if(it.disabled)d.classList.add("disabled");
      d.style.left=(it.start*PX_PER_SEC())+"px";d.style.width=Math.max(14,it.duration*PX_PER_SEC())+"px";
      if(type==="video"&&idx===0){const b=document.createElement("span");b.className="cover-badge";b.textContent="Cover";d.appendChild(b);}
      d.appendChild(document.createTextNode(it.name||it.text||"Clip"));
      d.dataset.id=it.id;d.dataset.type=type;
      const hl=document.createElement("span");hl.className="handle l";const hr=document.createElement("span");hr.className="handle r";
      d.append(hl,hr);
      d.addEventListener("pointerdown",e=>startClipDrag(e,it,type,d,hl.contains(e.target)?"l":hr.contains(e.target)?"r":"move"));
      d.addEventListener("click",e=>{if(e.target.classList.contains("handle"))return;selectClip(it,type);});
      trackEl.appendChild(d);
    });
  };
  draw($("trackVideo"),S.clips,"video");
  draw($("trackText"),S.textClips,"text");
  draw($("trackAudio"),S.audioClips,"audio");
  // Photo track (photo mode only): layers as blocks, click selects the layer
  const tp=$("trackPhoto"),tlp=$("tlabelPhoto");
  const photoMode=S.mode==="photo";
  tp.hidden=!photoMode;tlp.hidden=!photoMode;
  if(photoMode&&window.Photo&&Photo.getLayers){
    tp.innerHTML="";tp.style.width="800px";
    Photo.getLayers().forEach((L,i)=>{
      const d=document.createElement("div");d.className="clip photo";
      d.style.left=(i*130)+"px";d.style.width="120px";
      d.textContent=(L.kind||"layer")+": "+(L.text||L.emoji||L.shape||L.name||"");
      d.addEventListener("click",()=>Photo.selectLayer(L.id));
      tp.appendChild(d);
    });
  }
  $("tlInfo").textContent=`${S.clips.length} video clip(s) · ${S.textClips.length} text · ${S.audioClips.length} audio · total ${fmt(totalDuration())}`;
  positionPlayhead();
}
function positionPlayhead(){
  const tot=Math.max(0.01,totalDuration());
  $("playhead").style.left=(S.curTime*PX_PER_SEC())+"px";
}
function selectClip(it,type){
  S.selClip=it.id;S.selType=type;
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
  renderTimeline();
}
/* Sync the right-inspector Transform controls with global transform state */
function syncInspectorTransform(){
  const set=(id,v)=>{const el=$(id);if(el)el.value=v;};
  set("inspScale",S.cropZoom);const sv=$("inspScaleV");if(sv)sv.textContent=S.cropZoom+"%";
  set("inspScaleX",S.scaleX||100);set("inspScaleY",S.scaleY||100);
  set("inspPosX",S.posX||0);set("inspPosY",S.posY||0);
  set("inspRot",S.rotation);const rv=$("inspRotV");if(rv)rv.textContent=S.rotation+"°";
}
function startClipDrag(e,it,type,el,mode){
  if(S.locked[type]){toast("Track is locked");return;}
  e.preventDefault();e.stopPropagation();
  const startX=e.clientX,origStart=it.start,origDur=it.duration;
  const move=ev=>{
    const dt=(ev.clientX-startX)/PX_PER_SEC();
    if(mode==="move"){let ns=Math.max(0,origStart+dt);if(S.snap){const ph=S.curTime;if(Math.abs(ns-ph)<0.3)ns=ph;if(Math.abs(ns+it.duration-ph)<0.3)ns=ph-it.duration;}it.start=Math.round(ns*10)/10;}
    else if(mode==="l"){const ns=clamp(origStart+dt,0,origStart+origDur-0.2);it.duration=origDur-(ns-origStart);it.start=ns;if(it.trimIn!==undefined)it.trimIn=clamp(it.trimIn+(ns-origStart),0,it.trimOut);}
    else{it.duration=Math.max(0.2,origDur+dt);if(it.trimOut!==undefined)it.trimOut=Math.min(it.trimOut+dt,999);}
    renderTimeline();positionPlayhead();
  };
  const up=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);pushHistory();updateDuration();};
  document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);
}
$("tlScroll").addEventListener("click",e=>{
  if(e.target.closest(".clip"))return;
  const r=$("tlScroll").getBoundingClientRect();
  const x=e.clientX-r.left+$("tlScroll").scrollLeft;
  seek(x/PX_PER_SEC());
});
function splitAtPlayhead(){
  const hit=currentClipAt(S.curTime);
  if(!hit){toast("No clip under the playhead");return;}
  const c=hit.clip,off=hit.offset;
  if(off<0.2||off>c.duration-0.2){toast("Move the playhead inside a clip to split");return;}
  const second={...c,id:uid(),start:c.start+off,duration:c.duration-off,trimIn:c.trimIn+off,name:c.name+" (2)"};
  c.duration=off;c.trimOut=c.trimIn+off;
  const idx=S.clips.indexOf(c);S.clips.splice(idx+1,0,second);
  updateDuration();renderTimeline();pushHistory();toast("Clip split ✂");
}
function deleteSelected(){
  if(!S.selClip){toast("Select a clip first");return;}
  if(S.selType==="video")S.clips=S.clips.filter(c=>c.id!==S.selClip);
  if(S.selType==="text")S.textClips=S.textClips.filter(c=>c.id!==S.selClip);
  if(S.selType==="audio")S.audioClips=S.audioClips.filter(c=>c.id!==S.selClip);
  S.selClip=null;$("clipProps").hidden=true;updateDuration();renderTimeline();pushHistory();toast("Clip deleted");
}
function duplicateSelected(){
  if(!S.selClip){toast("Select a clip first");return;}
  const list=S.selType==="video"?S.clips:S.selType==="text"?S.textClips:S.audioClips;
  const it=list.find(c=>c.id===S.selClip);if(!it)return;
  const copy={...it,id:uid(),start:it.start+it.duration,name:(it.name||it.text||"Clip")+" copy"};
  list.push(copy);updateDuration();renderTimeline();pushHistory();toast("Clip duplicated");
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
    r.innerHTML=`<span>◆ ${k.prop} @ ${k.time.toFixed(1)}s = ${k.value}</span><button class="mini">🗑</button>`;
    r.querySelector("button").onclick=()=>{S.keyframes=S.keyframes.filter(x=>x.id!==k.id);renderKfList();pushHistory();};
    r.onclick=e=>{if(e.target.tagName!=="BUTTON"){seek(k.time);}};
    box.appendChild(r);
  });
  if(!S.keyframes.length)box.innerHTML='<p class="hint">No keyframes yet.</p>';
}
function kfValue(prop,t){
  const ks=S.keyframes.filter(k=>k.prop===prop).sort((a,b)=>a.time-b.time);
  if(!ks.length)return null;
  if(t<=ks[0].time)return ks[0].value;
  if(t>=ks[ks.length-1].time)return ks[ks.length-1].value;
  for(let i=0;i<ks.length-1;i++){const a=ks[i],b=ks[i+1];if(t>=a.time&&t<=b.time){const f=(t-a.time)/(b.time-a.time);return a.value+(b.value-a.value)*f;}}
  return ks[ks.length-1].value;
}
setInterval(()=>{ // apply keyframes live during preview
  if(!video.paused){
    const op=kfValue("opacity",S.curTime);if(op!==null)video.style.opacity=op/100;
    const sc=kfValue("scale",S.curTime);if(sc!==null)video.style.transform=`translate(${S.posX||0}px,${S.posY||0}px) rotate(${S.rotation}deg) scale(${((S.flipH?-1:1)*(sc/100)*(S.cropZoom/100)*((S.scaleX||100)/100)).toFixed(3)},${((S.flipV?-1:1)*(sc/100)*(S.cropZoom/100)*((S.scaleY||100)/100)).toFixed(3)})`;
  }
},120);

/* ---------- AUDIO ---------- */
let audioCtx=null, mediaRecorder=null, recChunks=[];
function ensureAudioCtx(){if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();return audioCtx;}
function drawWaveform(m){
  const cv=$("waveCanvas");if(!cv||!m)return;const x=cv.getContext("2d");x.fillStyle="#0d1330";x.fillRect(0,0,cv.width,cv.height);
  const src=m.audioEl||new Audio(m.url);
  const draw=()=>{try{
    const ctx=ensureAudioCtx();const el=m.audioEl||src;if(!el._src){el._src=ctx.createMediaElementSource(el);const an=ctx.createAnalyser();an.fftSize=256;el._src.connect(an);an.connect(ctx.destination);el._an=an;}
    const an=el._an;const data=new Uint8Array(an.frequencyBinCount);
    const loop=()=>{an.getByteFrequencyData(data);x.fillStyle="#0d1330";x.fillRect(0,0,cv.width,cv.height);x.fillStyle="#22c55e";const w=cv.width/data.length;for(let i=0;i<data.length;i++){const h=data[i]/255*cv.height;x.fillRect(i*w,cv.height-h,w-1,h);}if(!el.paused)requestAnimationFrame(loop);};
    el.play().catch(()=>{});loop();
  }catch(err){x.fillStyle="#a7b0d6";x.font="12px sans-serif";x.fillText("Waveform unavailable in this browser",10,30);}};
  if(src.readyState>=1)draw();else src.onloadedmetadata=draw;
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
    mediaRecorder.start();$("btnRecord").disabled=true;$("btnStopRec").disabled=false;toast("Recording… tap ■ Stop when done");
  }catch(err){toast("Microphone not available: "+err.message);}
}

/* ---------- EXPORT (Canvas + MediaRecorder, no watermark) ---------- */
function exportCanvasSize(reqH){
  const map={480:[854,480],720:[1280,720],1080:[1920,1080],1440:[2560,1440],2160:[3840,2160]};
  let [w,h]=map[reqH]||map[1080];
  const maxW=4096,maxH=4096; // honest device cap check
  const test=document.createElement("canvas");test.width=w;test.height=h;
  try{const cx=test.getContext("2d");if(!cx)throw 0;}catch(e){w=1920;h=1080;}
  if(w>maxW||h>maxH){w=1920;h=1080;}
  return{w,h,note:(reqH==="2160"||reqH==="1440")?"Requested "+reqH+"p — rendering at "+h+"p (device/browser limit).":""};
}
const _imgCache={};
function exportImgCache(m){if(!_imgCache[m.id]){const im=new Image();im.src=m.url;_imgCache[m.id]=im;}const im=_imgCache[m.id];return im.complete&&im.naturalWidth?im:null;}
async function doVideoExport(){
  if(!S.clips.length){toast("Add a clip to the timeline first");return;}
  if(S.exporting)return;S.exporting=true;
  $("btnCancelExport").disabled=false;$("expProgress").hidden=false;$("expResult").innerHTML="";
  const res=$("expRes").value,fps=+$("expFps").value,fmtSel=$("expFmt").value,bitrate=+$("expBitrate").value;
  const {w,h,note}=exportCanvasSize(res);
  const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d");
  const stream=canvas.captureStream(fps);
  // mix in audio track if present
  let audioDest=null;
  try{
    const actx=ensureAudioCtx();audioDest=actx.createMediaStreamDestination();
    S.audioClips.forEach(ac=>{const m=S.media.find(x=>x.id===ac.mediaId);if(m){const el=new Audio(m.url);el.volume=(ac.vol??80)/100;el._src=actx.createMediaElementSource(el);el._src.connect(audioDest);el._el=el;}});
    if(video.src){const vs=actx.createMediaElementSource(video);vs.connect(audioDest);}
    audioDest.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
  }catch(e){/* audio mix optional */}
  const mime=fmtSel==="mp4"?(MediaRecorder.isTypeSupported("video/mp4")?"video/mp4":"video/webm"): "video/webm";
  let rec;try{rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:bitrate});}catch(e){rec=new MediaRecorder(stream);}
  const chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  const only=S.exportOnly;
  const total=only?only.duration:totalDuration();let cancelled=false;
  $("btnCancelExport").onclick=()=>{cancelled=true;try{rec.stop();}catch(e){}};
  const done=new Promise(res2=>{rec.onstop=()=>res2();});
  rec.start(250);
  const t0=performance.now();
  const drawFrame=(t)=>{
    if(cancelled)return;
    const hit=currentClipAt(t);
    ctx.fillStyle="#000";ctx.fillRect(0,0,w,h);
    ctx.filter=cssFilterString();
    if(hit){
      const m=S.media.find(x=>x.id===hit.clip.mediaId);
      if(hit.clip.disabled){/* deactivated clip renders as black — skip drawing media */}
      // draw from the live preview video element (already seeked by seek())
      else if(m&&m.type==="image"){const im=exportImgCache(m);if(im)drawCover(ctx,im,w,h);}
      else if(video.readyState>=2&&video.videoWidth){drawCover(ctx,video,w,h);}
      // transition fade in/out
      const tr=hit.clip.transition&&hit.clip.transition!=="none"?hit.clip.transition:S.transType;
      const td=hit.clip.transDur||S.transDur;
      let alpha=1;
      if(tr==="fade"||tr==="dissolve"){const fi=clamp(hit.offset/td,0,1),fo=clamp((hit.clip.duration-hit.offset)/td,0,1);alpha=Math.min(fi,fo);}
      if(tr==="flash"){alpha=hit.offset<td?0.4+0.6*hit.offset/td:1;}
      ctx.globalAlpha=alpha;
      // text overlays drawn on export canvas
      activeTextAt(t).forEach(c=>{ctx.save();ctx.globalAlpha=alpha;ctx.font=`bold ${Math.round(c.size*w/1280)}px ${c.font}`;ctx.textAlign="center";ctx.fillStyle=c.color;if(c.bgOn){ctx.fillStyle=c.bg;const tw=ctx.measureText(c.text).width;ctx.fillRect(w/2-tw/2-10,h*(c.pos==="top"?0.12:c.pos==="center"?0.5:0.82)-30,tw+20,44);ctx.fillStyle=c.color;}ctx.fillText(c.text,w/2,h*(c.pos==="top"?0.12:c.pos==="center"?0.5:0.82));ctx.restore();});
      const cap=activeCaptionAt(t);if(cap){ctx.save();ctx.font=`bold ${Math.round(26*w/1280)}px Arial`;ctx.textAlign="center";const tw=ctx.measureText(cap.text).width;ctx.fillStyle="rgba(0,0,0,.65)";ctx.fillRect(w/2-tw/2-10,h*0.88-28,tw+20,40);ctx.fillStyle="#fff";ctx.fillText(cap.text,w/2,h*0.88);ctx.restore();}
      ctx.globalAlpha=1;
    }
    const pct=Math.min(100,t/total*100);
    $("expFill").style.width=pct+"%";$("expPct").textContent=Math.round(pct)+"%";
    $("expStatus").textContent=" Rendering "+fmt(t)+" / "+fmt(total)+(note?" · "+note:"");
  };
  // render loop: step through timeline in real time (accurate sync), using the preview video
  video.pause();
  const step=1/fps;
  const base=only?only.start:0;
  for(let t=0;t<=total;t+=step){
    if(cancelled)break;
    seek(base+t);await new Promise(r=>setTimeout(r,Math.max(1,1000/fps*0.5)));
    drawFrame(base+t);
    // keep audio in sync
    if(audioDest)S.audioClips.forEach(ac=>{const m=S.media.find(x=>x.id===ac.mediaId);});
  }
  if(!cancelled){try{rec.stop();}catch(e){}}
  await done;
  S.exporting=false;$("btnCancelExport").disabled=true;S.exportOnly=null;
  if(cancelled){$("expStatus").textContent="Export cancelled.";return;}
  const blob=new Blob(chunks,{type:rec.mimeType||"video/webm"});
  const ext=(rec.mimeType||"").includes("mp4")?"mp4":"webm";
  const url=URL.createObjectURL(blob);
  const fname=(S.projectName||"editora-export").replace(/[^\w\-]+/g,"-")+"."+ext;
  window.__lastExport={blob,url,name:fname,kind:"video"};
  $("expStatus").textContent="Done — "+(blob.size/1048576).toFixed(1)+" MB, no watermark.";
  $("expResult").innerHTML=`<a href="${url}" download="${fname}">⬇ Download your video (.${ext})</a> <button id="btnShareResult" class="mini">↗ Share</button>${note?`<p class="hint">${note}</p>`:""}`;
  toast("Export complete — no watermark");
}
function drawCover(ctx,src,w,h){
  const sw=src.videoWidth||src.naturalWidth||src.width, sh=src.videoHeight||src.naturalHeight||src.height;
  if(!sw||!sh)return;
  const s=Math.max(w/sw,h/sh),dw=sw*s,dh=sh*s;
  const kx=w/1280; // keep position offsets proportional to export width
  ctx.save();ctx.translate(w/2+(S.posX||0)*kx,h/2+(S.posY||0)*kx);ctx.rotate(S.rotation*Math.PI/180);ctx.scale((S.flipH?-1:1)*(S.cropZoom/100)*((S.scaleX||100)/100),(S.flipV?-1:1)*(S.cropZoom/100)*((S.scaleY||100)/100));
  ctx.drawImage(src,-dw/2,-dh/2,dw,dh);ctx.restore();
}
function doPhotoExport(){
  if(!window.Photo||!Photo.hasImage()){toast("Open an image in Photo mode first");return;}
  const fmtSel=$("expPhotoFmt").value,q=+$("expPhotoQ").value/100,w=+$("expPhotoW").value;
  const url=Photo.exportDataURL(fmtSel,q,w,$("expPhotoTrans").checked);
  const fname=(S.projectName||"editora-photo").replace(/[^\w\-]+/g,"-")+"."+(fmtSel==="jpeg"?"jpg":fmtSel);
  const a=document.createElement("a");a.href=url;a.download=fname;a.click();
  fetch(url).then(r=>r.blob()).then(b=>{window.__lastExport={blob:b,url,name:fname,kind:"photo"};}).catch(()=>{});
  $("expResult").innerHTML=`<a href="${url}" download="${fname}">⬇ Download your photo</a> <button id="btnShareResult" class="mini">↗ Share</button>`;
  $("expStatus").textContent="Photo exported — no watermark.";toast("Photo exported");
}

/* ---------- PROJECTS (IndexedDB + localStorage fallback) ---------- */
let db=null;
function openDB(){return new Promise(res=>{try{const rq=indexedDB.open("editora-pro",1);rq.onupgradeneeded=e=>{e.target.result.createObjectStore("projects",{keyPath:"name"});};rq.onsuccess=e=>{db=e.target.result;res(db);};rq.onerror=()=>res(null);}catch(e){res(null);}});}
function projectData(){return{name:S.projectName,updated:Date.now(),data:snapshot(),color:S.color};}
async function saveProject(silent){
  const d=projectData();
  try{localStorage.setItem("editora-current",JSON.stringify(d));}catch(e){}
  if(db){try{await new Promise((res,rej)=>{const tx=db.transaction("projects","readwrite");tx.objectStore("projects").put(d);tx.oncomplete=res;tx.onerror=rej;});}catch(e){}}
  S.dirty=false;const at=$("autosaveText");if(at)at.textContent="● Auto saved: "+new Date().toLocaleTimeString();if(!silent)toast("Project saved ✓");
}
async function listProjects(){
  const box=$("projectList");box.innerHTML="";
  let names=[];
  if(db){try{names=await new Promise(res=>{const tx=db.transaction("projects","readonly");const rq=tx.objectStore("projects").getAll();rq.onsuccess=()=>res(rq.result||[]);rq.onerror=()=>res([]);});}catch(e){}}
  if(!names.length){try{const c=localStorage.getItem("editora-current");if(c)names=[JSON.parse(c)];}catch(e){}}
  if(!names.length){box.innerHTML='<p class="hint">No saved projects yet.</p>';return;}
  names.forEach(p=>{
    const r=document.createElement("div");r.className="cap-row";
    r.innerHTML=`<span style="flex:1">${p.name} <small style="color:var(--mut)">${new Date(p.updated).toLocaleString()}</small></span><button class="mini">Open</button><button class="mini">Rename</button><button class="mini">Duplicate</button><button class="mini">🗑</button>`;
    const [open,ren,dup,del]=r.querySelectorAll("button");
    open.onclick=()=>{applySnapshot(p.data);$("projectsModal").hidden=true;toast("Project opened: "+p.name);};
    ren.onclick=()=>{const n=prompt("New name:",p.name);if(n){p.name=n;saveProject(true);listProjects();}};
    dup.onclick=()=>{const c={...p,name:p.name+" copy",updated:Date.now()};if(db){const tx=db.transaction("projects","readwrite");tx.objectStore("projects").put(c);}listProjects();toast("Duplicated");};
    del.onclick=()=>{if(db){const tx=db.transaction("projects","readwrite");tx.objectStore("projects").delete(p.name);}listProjects();};
    box.appendChild(r);
  });
}
setInterval(()=>{if(S.settings.autosave&&S.dirty)saveProject(true);},10000);
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
const PHOTO_TEMPLATES={
  Thumbnail:{filter:"Vivid",text:"🔥 NEW VIDEO!",size:"1280x720"},
  Poster:{filter:"Vintage",text:"GRAND OPENING",size:"1080x1080"},
  Quote:{filter:"Noir",text:"“Dream big.”",size:"1080x1080"},
  Sale:{filter:"Warm",text:"50% OFF SALE!",size:"1080x1080"},
  Story:{filter:"Cool",text:"Swipe Up ↗",size:"1080x1920"},
  Profile:{filter:"Normal",text:"",size:"1080x1080"},
};
function buildTemplateUI(){
  const vt=$("videoTemplates");vt.innerHTML="";
  Object.keys(VIDEO_TEMPLATES).forEach(n=>{const b=document.createElement("button");b.className="fx-btn";b.textContent="🎬 "+n;b.onclick=()=>{const t=VIDEO_TEMPLATES[n];Object.assign(S.color,PRESETS.Normal,t.color);S.fx=t.fx;S.preset=n;buildColorUI();buildFxUI();applyFilters();$("txtFont").value=t.text.font;$("txtSize").value=t.text.size;$("txtColor").value=t.text.color;pushHistory();toast("Video template applied: "+n);};vt.appendChild(b);});
  const pt=$("photoTemplates");pt.innerHTML="";
  Object.keys(PHOTO_TEMPLATES).forEach(n=>{const b=document.createElement("button");b.className="fx-btn";b.textContent="🖼️ "+n;b.onclick=()=>{const t=PHOTO_TEMPLATES[n];if(window.Photo){Photo.applyFilter(t.filter);if(t.size&&t.size!=="orig"){$("photoSize").value=t.size;Photo.setCanvasSize(t.size);}if(t.text)Photo.addTextLayer(t.text);}toast("Photo template applied: "+n);};pt.appendChild(b);});
}

/* ---------- WIRING ---------- */
function bind(id,ev,fn){const el=$(id);if(el)el.addEventListener(ev,fn);}
function init(){
  buildColorUI();buildFxUI();buildTemplateUI();renderTimeline();renderCapList();renderKfList();renderMediaList();pushHistory();
  openDB().then(()=>{try{const c=localStorage.getItem("editora-current");if(c){const p=JSON.parse(c);if(p.data){/* recovery offered, not forced */toast("Saved project found — open Projects → to restore");}} }catch(e){}});
  // mode tabs
  bind("modeVideo","click",()=>setMode("video"));bind("modePhoto","click",()=>setMode("photo"));
  function setMode(m){S.mode=m;$("modeVideo").classList.toggle("on",m==="video");$("modePhoto").classList.toggle("on",m==="photo");$("videoStage").style.display=m==="video"?"":"none";$("photoStage").hidden=m!=="photo";$("playerModeLabel").textContent=m==="video"?"— Video Editor":"— Photo Editor";if(m==="photo"&&window.Photo)Photo.render();if(m==="photo"&&typeof showPanel==="function")showPanel("photo");renderTimeline();toast(m==="video"?"Video Editor":"Photo Editor");}
  window.setMode=setMode;
  // sidebar tabs
  $$(".stab").forEach(b=>b.addEventListener("click",()=>{$$(".stab").forEach(x=>x.classList.remove("on"));b.classList.add("on");$$(".panel").forEach(p=>p.classList.remove("on"));$("tab-"+b.dataset.tab).classList.add("on");}));
  // theme
  bind("btnTheme","click",()=>{const b=document.body;b.dataset.theme=b.dataset.theme==="dark"?"light":"dark";$("btnTheme").textContent=b.dataset.theme==="dark"?"🌙":"☀️";});
  bind("btnUndo","click",undo);bind("btnRedo","click",redo);
  document.addEventListener("keydown",e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&!e.shiftKey){e.preventDefault();undo();}
    else if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==="y"||(e.shiftKey&&e.key.toLowerCase()==="z"))){e.preventDefault();redo();}
    else if(e.key===" "&&e.target.tagName!=="INPUT"&&e.target.tagName!=="TEXTAREA"){e.preventDefault();togglePlay();}
    else if(e.key.toLowerCase()==="s"&&e.target.tagName!=="INPUT"){splitAtPlayhead();}
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
  bind("audioInput","change",e=>{addFiles(e.target.files);e.target.value="";});
  bind("btnImportPhoto","click",()=>$("photoInput").click());
  bind("photoInput","change",e=>{if(e.target.files[0]&&window.Photo)Photo.loadFile(e.target.files[0]);e.target.value="";});
  const dz=$("dropZone");
  ["dragover","dragenter"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("over");}));
  ["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("over");}));
  dz.addEventListener("drop",e=>{if(e.dataTransfer.files.length)addFiles(e.dataTransfer.files);});
  document.addEventListener("dragover",e=>e.preventDefault());
  document.addEventListener("drop",e=>{e.preventDefault();if(e.dataTransfer.files.length)addFiles(e.dataTransfer.files);});
  bind("mediaSearch","input",renderMediaList);
  bind("btnFavFilter","click",e=>{e.target.classList.toggle("on");renderMediaList();});
  bind("btnSortName","click",()=>{S.media.sort((a,b)=>a.name.localeCompare(b.name));renderMediaList();toast("Sorted by name");});
  // transport
  bind("btnPlay","click",togglePlay);
  bind("btnPrevFrame","click",()=>frameStep(-1));
  bind("btnNextFrame","click",()=>frameStep(1));
  bind("speedSel","change",e=>{S.speed=+e.target.value;video.playbackRate=S.speed;});
  bind("volSlider","input",e=>{video.volume=e.target.value/100;S.vidVol=+e.target.value;$("vidVol").value=S.vidVol;$("vidVolV").textContent=S.vidVol+"%";});
  bind("btnFull","click",()=>{const st=$("videoStage");if(document.fullscreenElement)document.exitFullscreen();else st.requestFullscreen&&st.requestFullscreen();});
  bind("btnSplit","click",splitAtPlayhead);
  bind("btnDupClip","click",duplicateSelected);
  bind("btnDelClip","click",deleteSelected);
  bind("btnTrimApply","click",()=>{
    const hit=currentClipAt(S.curTime)||(S.selClip?{clip:S.clips.find(c=>c.id===S.selClip)}:null);
    const c=hit&&hit.clip;if(!c){toast("Select a clip first");return;}
    const ti=+$("trimIn").value,to=+$("trimOut").value;
    c.trimIn=clamp(ti,0,c.trimOut);c.trimOut=clamp(to,c.trimIn,999);c.duration=c.trimOut-c.trimIn;
    updateDuration();renderTimeline();pushHistory();toast("Trim applied");
  });
  // trim inputs sync
  [["trimIn","trimInR"],["trimOut","trimOutR"]].forEach(([n,r])=>{bind(n,"input",()=>{$(r).value=$(n).value;});bind(r,"input",()=>{$(n).value=$(r).value;});});
  // timeline head
  bind("tlZoom","input",e=>{S.zoom=+e.target.value;renderTimeline();});
  bind("btnSnap","click",e=>{S.snap=!S.snap;e.target.textContent="🧲 Snap: "+(S.snap?"On":"Off");});
  bind("btnAddTrack","click",()=>{S.textClips.push({id:uid(),text:"New text",start:S.curTime,duration:3,font:"Arial",size:48,color:"#ffffff",bg:"#000000",bgOn:false,outline:true,shadow:true,pos:"bottom",anim:"none"});renderTimeline();renderTextOverlay();pushHistory();toast("Text clip added at playhead");});
  $$(".tlk").forEach(b=>b.addEventListener("click",()=>{const t=b.dataset.track;S.locked[t]=!S.locked[t];b.textContent=S.locked[t]?"🔒":"🔓";renderTimeline();toast(t+" track "+(S.locked[t]?"locked":"unlocked"));}));
  // clip props
  bind("btnClipApply","click",()=>{
    const list=S.selType==="video"?S.clips:S.selType==="text"?S.textClips:S.audioClips;
    const it=list&&list.find(c=>c.id===S.selClip);if(!it)return;
    if(it.name!==undefined)it.name=$("clipName").value;
    if(it.text!==undefined)it.text=$("clipName").value;
    it.start=+$("clipStart").value;it.duration=Math.max(0.2,+$("clipDur").value);
    it.opacity=+$("clipOpacity").value;it.scale=+$("clipScale").value;it.rotation=+$("clipRot").value;
    updateDuration();renderTimeline();renderTextOverlay();pushHistory();toast("Clip updated");
  });
  [["clipOpacity","clipOpacityV","%"],["clipScale","clipScaleV","%"],["clipRot","clipRotV","°"]].forEach(([id,vid,suf])=>bind(id,"input",()=>{$(vid).textContent=$(id).value+suf;}));
  // text tab
  bind("txtSize","input",e=>$("txtSizeV").textContent=e.target.value+"px");
  bind("btnAddText","click",()=>{
    S.textClips.push({id:uid(),text:$("txtContent").value||"Text",start:+$("txtStart").value,duration:+$("txtDur").value,font:$("txtFont").value,size:+$("txtSize").value,color:$("txtColor").value,bg:$("txtBg").value,bgOn:$("txtBgOn").checked,outline:$("txtOutline").checked,shadow:$("txtShadow").checked,pos:$("txtPos").value,anim:$("txtAnim").value});
    renderTimeline();renderTextOverlay();pushHistory();toast("Text added to timeline");
  });
  bind("btnAddCap","click",()=>{S.captions.push({id:uid(),text:"New caption",start:S.curTime,end:S.curTime+2});renderCapList();pushHistory();});
  bind("btnImportSRT","click",()=>$("srtInput").click());
  bind("srtInput","change",e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{const parsed=parseSRT(r.result);S.captions=S.captions.concat(parsed);renderCapList();pushHistory();toast(parsed.length+" captions imported");};r.readAsText(f);e.target.value="";});
  bind("btnExportSRT","click",()=>{if(!S.captions.length){toast("No captions yet");return;}downloadText("captions.srt",toSRT(),"text/plain");});
  bind("btnExportVTT","click",()=>{if(!S.captions.length){toast("No captions yet");return;}downloadText("captions.vtt",toVTT(),"text/vtt");});
  bind("karaokeToggle","change",e=>{S.karaoke=e.target.checked;renderTextOverlay();});
  // audio tab
  bind("btnRecord","click",startRecording);
  bind("btnStopRec","click",()=>{if(mediaRecorder&&mediaRecorder.state!=="inactive"){mediaRecorder.stop();$("btnRecord").disabled=false;$("btnStopRec").disabled=true;}});
  bind("audVol","input",e=>{S.audVol=+e.target.value;$("audVolV").textContent=S.audVol+"%";});
  bind("vidVol","input",e=>{S.vidVol=+e.target.value;$("vidVolV").textContent=S.vidVol+"%";video.volume=S.vidVol/100;});
  bind("audFadeIn","input",e=>{S.fadeIn=+e.target.value;$("audFadeInV").textContent=S.fadeIn+"s";});
  bind("audFadeOut","input",e=>{S.fadeOut=+e.target.value;$("audFadeOutV").textContent=S.fadeOut+"s";});
  bind("btnMute","click",()=>{S.muted=!S.muted;video.muted=S.muted;toast(S.muted?"Muted":"Unmuted");});
  bind("btnDuck","click",()=>{S.audVol=25;$("audVol").value=25;$("audVolV").textContent="25%";toast("Music ducked to 25% under voice");});
  bind("audBass","input",e=>{S.bass=+e.target.value;$("audBassV").textContent=S.bass+" dB";toast("Bass "+S.bass+" dB — applied via Web Audio on export mix (preview uses video volume)");});
  bind("audTreble","input",e=>{S.treble=+e.target.value;$("audTrebleV").textContent=S.treble+" dB";});
  bind("audSpeed","change",e=>{S.audioClips.forEach(ac=>{const m=S.media.find(x=>x.id===ac.mediaId);if(m&&m.audioEl)m.audioEl.playbackRate=+e.target.value;});});
  // effects tab
  bind("fxStrength","input",e=>{S.fxStrength=+e.target.value;$("fxStrengthV").textContent=S.fxStrength+"%";applyFilters();});
  bind("btnRot90","click",()=>{S.rotation=(S.rotation+90)%360;applyFilters();pushHistory();});
  bind("btnRot180","click",()=>{S.rotation=(S.rotation+180)%360;applyFilters();pushHistory();});
  bind("btnRot270","click",()=>{S.rotation=(S.rotation+270)%360;applyFilters();pushHistory();});
  bind("btnFlipH","click",()=>{S.flipH=!S.flipH;applyFilters();pushHistory();});
  bind("btnFlipV","click",()=>{S.flipV=!S.flipV;applyFilters();pushHistory();});
  bind("cropRatio","change",e=>{S.cropRatio=e.target.value;toast("Crop ratio "+S.cropRatio+" — applied on export canvas (preview shows zoom)");});
  bind("cropZoom","input",e=>{S.cropZoom=+e.target.value;$("cropZoomV").textContent=S.cropZoom+"%";applyFilters();});
  bind("btnFreeze","click",()=>{if(curMedia&&curMedia.type==="video"){video.pause();const c=document.createElement("canvas");c.width=video.videoWidth;c.height=video.videoHeight;c.getContext("2d").drawImage(video,0,0);c.toBlob(b=>{const url=URL.createObjectURL(b);const m={id:uid(),name:"Freeze frame "+fmt(S.curTime),type:"image",url,fav:false,duration:0};S.media.push(m);renderMediaList();addToTimeline(m);toast("Freeze frame saved as image clip");});}else toast("Load a video first");});
  bind("btnReverse","click",()=>{S.reverse=!S.reverse;toast(S.reverse?"Reverse preview ON — press Play to play backwards":"Reverse preview OFF");});
  // color tab
  bind("btnSavePreset","click",()=>{const n=prompt("Preset name:","My Look");if(!n)return;PRESETS[n]={...S.color};localStorage.setItem("editora-presets",JSON.stringify(PRESETS));buildColorUI();toast("Preset saved: "+n);});
  bind("btnResetColor","click",()=>{applyPreset("Normal");});
  try{const saved=JSON.parse(localStorage.getItem("editora-presets")||"null");if(saved)Object.assign(PRESETS,saved);}catch(e){}
  // transitions / keyframes
  bind("transType","change",e=>{S.transType=e.target.value;});
  bind("transDur","input",e=>{S.transDur=+e.target.value;$("transDurV").textContent=S.transDur+"s";});
  bind("btnApplyTrans","click",()=>{const c=S.clips.find(x=>x.id===S.selClip);if(!c){toast("Select a video clip first");return;}c.transition=S.transType;c.transDur=S.transDur;pushHistory();toast("Transition "+S.transType+" applied to clip");});
  bind("kfVal","input",e=>$("kfValV").textContent=e.target.value);
  bind("btnAddKF","click",()=>{S.keyframes.push({id:uid(),prop:$("kfProp").value,time:S.curTime,value:+$("kfVal").value});renderKfList();pushHistory();toast("Keyframe added @ "+fmt(S.curTime));});
  bind("btnDelKF","click",()=>{S.keyframes=S.keyframes.filter(k=>Math.abs(k.time-S.curTime)>0.15);renderKfList();pushHistory();});
  // export modal
  bind("btnExport","click",()=>{$("exportModal").hidden=false;$("exportVideoOpts").hidden=S.mode!=="video";$("exportPhotoOpts").hidden=S.mode!=="photo";$("expRes").value=S.settings.defRes;$("expFps").value=String(S.settings.defFps);});
  bind("btnCloseExport","click",()=>{$("exportModal").hidden=true;});
  bind("btnDoExport","click",()=>{if(S.mode==="photo")doPhotoExport();else doVideoExport();});
  bind("expPhotoQ","input",e=>$("expPhotoQV").textContent=e.target.value+"%");
  // projects modal
  bind("btnProjects","click",()=>{$("projectsModal").hidden=false;listProjects();});
  bind("btnCloseProjects","click",()=>{$("projectsModal").hidden=true;});
  bind("btnNewProject","click",()=>{if(confirm("Start a new project? Unsaved changes are kept in the current autosave.")){S.clips=[];S.textClips=[];S.audioClips=[];S.captions=[];S.keyframes=[];S.media=[];S.projectName="Untitled Project";$("projectName").value=S.projectName;updateDuration();renderAll();pushHistory();}});
  bind("btnSaveProject","click",()=>saveProject(false));
  bind("btnExportProj","click",()=>downloadText((S.projectName||"project").replace(/[^\w\-]+/g,"-")+".json",JSON.stringify(projectData(),null,2),"application/json"));
  bind("btnImportProj","click",()=>$("projInput").click());
  bind("projInput","change",e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const p=JSON.parse(r.result);applySnapshot(p.data);toast("Project restored");}catch(err){toast("Invalid project file");}};r.readAsText(f);e.target.value="";});
  // templates modal
  bind("btnTemplates","click",()=>{$("templatesModal").hidden=false;});
  bind("btnCloseTemplates","click",()=>{$("templatesModal").hidden=true;});
  // settings modal
  bind("btnSettings","click",()=>{$("settingsModal").hidden=false;});
  bind("btnCloseSettings","click",()=>{$("settingsModal").hidden=true;});
  bind("setAutosave","change",e=>{S.settings.autosave=e.target.checked;});
  bind("setDefRes","change",e=>{S.settings.defRes=e.target.value;});
  bind("setDefFps","change",e=>{S.settings.defFps=+e.target.value;});
  bind("btnClearData","click",()=>{if(confirm("Clear ALL saved projects and presets on this device?")){localStorage.clear();if(db){db.close();indexedDB.deleteDatabase("editora-pro");}toast("All local data cleared");}});
  applyFilters();
}
function renderAll(){renderMediaList();renderTimeline();renderCapList();renderKfList();renderTextOverlay();updateDuration();applyFilters();}
document.addEventListener("DOMContentLoaded",init);

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
  const list=S.selType==="video"?S.clips:S.selType==="text"?S.textClips:S.selType==="audio"?S.audioClips:null;
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
  const c=S.selType==="video"?selectedClipObj():null;
  if(!c){toast("Select a video clip first");return;}
  S.audioClips.push({id:uid(),mediaId:c.mediaId,name:(c.name||"clip")+" (audio)",start:c.start,duration:c.duration,vol:80});
  if(muteToo){c.muted=true;video.muted=true;toast("Audio extracted to the audio track — original clip muted");}
  else toast("Audio separated to the audio track");
  renderTimeline();pushHistory();
}
function exportSelectedClip(){
  const c=S.selType==="video"?selectedClipObj():null;
  if(!c){toast("Select a video clip first");return;}
  S.exportOnly={start:c.start,duration:c.duration};
  $("btnExport").click();
  toast("Exporting only the selected clip");
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
  {act:"transcript",label:"Transcript",kbd:""},
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
      S.clipboard={type:S.selType,data:JSON.parse(JSON.stringify(c))};toast("Copied");break;
    case "cut":
      if(!c){toast("Select a clip first");return;}
      S.clipboard={type:S.selType,data:JSON.parse(JSON.stringify(c))};deleteSelected();break;
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
      const box=$("transcriptList");box.innerHTML="";
      const list=S.selType==="video"&&c?S.captions.filter(cp=>cp.start>=c.start&&cp.start<=c.start+c.duration):S.captions;
      if(!list.length)box.innerHTML='<p class="hint">No captions in this range yet. Add captions from the Captions panel.</p>';
      list.forEach(cp=>{const r=document.createElement("div");r.className="cap-row";r.innerHTML=`<span style="width:110px;color:var(--mut)">${fmt(cp.start)} – ${fmt(cp.end)}</span><span style="flex:1">${cp.text}</span>`;box.appendChild(r);});
      $("transcriptModal").hidden=false;break;}
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
      if(!c||S.selType!=="video"){toast("Select a video clip first");return;}
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
    if(tab==="audio"){showInspector("audio");$$(".toolbtn").forEach(x=>x.classList.toggle("on",x===b));toast("Audio — right panel");}
    else if(tab==="photo"){if(window.setMode)window.setMode("photo");showPanel("photo");}
    else{if(S.mode==="photo"&&window.setMode)window.setMode("video");showPanel(tab);}
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
    const c=S.selType==="video"?selectedClipObj():null;
    if(!c){toast("Select a video clip first");return;}
    const sp=+e.target.value/100;
    if(!c.baseDur)c.baseDur=Math.max(0.2,(c.trimOut-c.trimIn)||c.duration);
    c.speed=sp;c.duration=Math.max(0.2,c.baseDur/sp);c.trimOut=c.trimIn+c.baseDur;
    updateDuration();renderTimeline();pushHistory();toast("Clip speed "+sp.toFixed(2)+"× — duration "+c.duration.toFixed(1)+"s");
  });
  bind("txtAnim","change",e=>{
    const c=S.selType==="text"?selectedClipObj():null;
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
  });
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
  // share
  bind("btnShare","click",shareLastExport);
  $("expResult").addEventListener("click",e=>{if(e.target&&e.target.id==="btnShareResult")shareLastExport();});
  // shortcuts + transcript modals
  bind("btnShortcuts","click",()=>{$("shortcutsModal").hidden=false;});
  bind("btnCloseShortcuts","click",()=>{$("shortcutsModal").hidden=true;});
  bind("btnCloseTranscript","click",()=>{$("transcriptModal").hidden=true;});
  // timeline toolbar — select tool
  bind("btnSelectTool","click",()=>toast("Select tool — drag clips to move, drag a clip edge to trim"));
  // track show/hide (eye icons)
  $$(".tvis").forEach(b=>b.addEventListener("click",()=>{
    const t=b.dataset.track;
    const trackEl=t==="photo"?$("trackPhoto"):t==="video"?$("trackVideo"):t==="text"?$("trackText"):$("trackAudio");
    const hidden=trackEl.style.display==="none";
    trackEl.style.display=hidden?"":"none";
    const label=b.closest(".tlabel");if(label&&t!=="photo")label.style.display=hidden?"":"none";
    b.textContent=hidden?"👁":"🙈";
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
      if(S.mode==="photo"&&window.Photo&&Photo.addStickerEmoji){Photo.addStickerEmoji(em);}
      else{
        S.textClips.push({id:uid(),text:em,start:S.curTime,duration:3,font:"Arial",size:80,color:"#ffffff",bg:"#000000",bgOn:false,outline:false,shadow:true,pos:"center",anim:"pop"});
        renderTimeline();renderTextOverlay();pushHistory();toast("Sticker added to timeline");
      }
    });
    sg.appendChild(b);
  });
  // filters panel — video color presets
  const fp=$("filterPresets");
  Object.keys(PRESETS).forEach(name=>{
    const b=document.createElement("button");b.className="fx-btn";b.textContent=name;
    b.addEventListener("click",()=>applyPreset(name));
    fp.appendChild(b);
  });
  // right-click context menu on timeline clips
  tls.addEventListener("contextmenu",e=>{
    const clipEl=e.target.closest(".clip");
    if(!clipEl)return;
    e.preventDefault();
    const it=(clipEl.dataset.type==="video"?S.clips:clipEl.dataset.type==="text"?S.textClips:S.audioClips).find(c=>c.id===clipEl.dataset.id);
    if(it)selectClip(it,clipEl.dataset.type);
    showCtxMenu(e.clientX,e.clientY);
  });
  document.addEventListener("click",e=>{if(!e.target.closest("#ctxMenu"))hideCtxMenu();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")hideCtxMenu();});
  // replace-clip file picker
  bind("replaceInput","change",e=>{
    const f=e.target.files[0];e.target.value="";
    if(!f||!window.__replaceClipId)return;
    addFiles([f]);
    setTimeout(()=>{
      const m=S.media[S.media.length-1];
      const c=S.clips.find(x=>x.id===window.__replaceClipId);
      if(m&&c&&(m.type==="video"||m.type==="image")){
        c.mediaId=m.id;c.name=m.name;
        if(m.duration){c.duration=m.duration;c.trimIn=0;c.trimOut=m.duration;}
        loadPreview(m);updateDuration();renderTimeline();pushHistory();toast("Clip replaced: "+m.name);
      }
      window.__replaceClipId=null;
    },900);
  });
});
