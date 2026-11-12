/* Editora Pro — Photo Editor (Stage 4, standalone page)
   Vanilla JS + Canvas API. Every tool edits real pixels on layer canvases.
   No AI, no ads, no paid features, no watermark, no login.
   Projects live in IndexedDB "editora-pro-photo" (separate from the video editor). */
"use strict";
(function(){
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const uid=()=> "L"+Math.random().toString(36).slice(2,8);
const BLENDS=["source-over","multiply","screen","overlay","soft-light","hard-light","darken","lighten","color-dodge","color-burn","difference","exclusion","hue","saturation","color","luminosity"];

/* ---------------- state ---------------- */
const S={
  docW:1200, docH:800, hasDoc:false, layers:[], activeId:null,
  tool:"move", straighten:0, zoom:1, viewRot:0, editMask:false,
  brush:{size:24,color:"#ff3366",bgColor:"#06b6d4",opacity:100,hardness:80,spacing:25,flow:60,strength:50},
  cropRatio:"free", cropRect:null, sel:null, /* {type:'rect'|'lasso', rect, path, feather, inverted} */
  cloneSrc:null, cloneOffset:null, adjScope:"layer", selOnly:false,
  dirty:false, projectName:"Untitled Photo",
  pendingFile:null, shapePreview:null, lassoPath:null, moving:null,
  painting:false, lastPt:null, longPressTimer:null, longPressPt:null,
  gradPreview:null, pendingExport:null, clipLayer:null, pinch:null, pointers:null,
  /* PHASE 5 state */
  polyPath:null, selColor:"#ff3366", pickingSelColor:false,
  transform:null, /* {mode:'transform'|'perspective', layerId, quad:[{x,y}x4], rot:0, origData, handle:null} */
  smudgeBuf:null, curvesChannel:"rgb", lutStore:{}, /* layerId -> {size,data,name} */
};
const LUT_STORE=S.lutStore; // parsed .cube LUTs live here (in-memory; see report — not persisted)
const FILTER_PRESETS={
  "Normal":{},
  "Vintage":{brightness:5,contrast:-10,saturation:-20,fx:"sepia",fxAmt:0.45,fade:0.12},
  "B&W":{saturation:-100,contrast:15,fx:"bw",fxAmt:1},
  "Warm":{temperature:35,saturation:15,brightness:3,fx:"none",fxAmt:0},
  "Cool":{temperature:-35,saturation:-5,brightness:2,fx:"none",fxAmt:0},
  "Vivid":{saturation:50,contrast:18,fx:"none",fxAmt:0},
  "Sepia":{fx:"sepia",fxAmt:1,saturation:0},
  "Noir":{fx:"bw",fxAmt:1,contrast:35,brightness:-5},
  "Fade":{brightness:8,contrast:-15,saturation:-15,fade:0.18,fx:"none",fxAmt:0},
  "Duotone":{fx:"duotone",fxAmt:1,saturation:0},
  "Retro":{fx:"sepia",fxAmt:0.6,contrast:5,brightness:-5,fade:0.06},
  "Bright":{brightness:20,saturation:10,fx:"none",fxAmt:0},
  "HDR":{fx:"hdr",fxAmt:1,contrast:12,sharpness:35,saturation:15},
  "Neon":{fx:"neon",fxAmt:1,contrast:20,saturation:40},
  "Glow":{fx:"glow",fxAmt:0.8,brightness:6},
  "Soft Focus":{fx:"softfocus",fxAmt:0.7,brightness:8},
  "Emboss":{fx:"emboss",fxAmt:1,saturation:-40},
  "Oil Paint":{fx:"oil",fxAmt:0.8,saturation:20},
  "Pencil Sketch":{fx:"sketch",fxAmt:1},
  "Edge Detect":{fx:"edge",fxAmt:1},
  "Color Splash":{fx:"splash",fxAmt:1},
  "Halftone":{fx:"halftone",fxAmt:1},
  "Posterize":{fx:"posterize",fxAmt:1},
  "Cinematic":{temperature:-10,contrast:20,saturation:10,vignette:25,fx:"none",fxAmt:0},
  "Matte":{contrast:-20,brightness:5,fade:0.15,fx:"none",fxAmt:0},
  "Pastel":{saturation:-10,brightness:10,contrast:-15,fx:"none",fxAmt:0},
  "Dreamy":{fx:"softfocus",fxAmt:0.5,brightness:8,saturation:10},
};
function defaultCurves(){const id=[[0,0],[255,255]];return {rgb:id.map(p=>p.slice()),r:id.map(p=>p.slice()),g:id.map(p=>p.slice()),b:id.map(p=>p.slice())};}
function defaultAdj(){return {brightness:0,contrast:0,saturation:0,exposure:0,temperature:0,tint:0,
  highlights:0,shadows:0,sharpness:0,blur:0,vignette:0,grain:0,fx:"none",fxAmt:0,fade:0,
  curves:defaultCurves(),levels:{black:0,white:255,gamma:1},
  hsl:{h:0,s:0,l:0},cb:{sh:[0,0,0],mid:[0,0,0],hi:[0,0,0]},
  lutName:"",lutIntensity:100};}
function curvesIdentity(c){if(!c)return true;
  for(const ch of ["rgb","r","g","b"]){const p=c[ch];
    if(!p||p.length!==2||p[0][0]!==0||p[0][1]!==0||p[1][0]!==255||p[1][1]!==255)return false;}
  return true;}
function isIdentityAdj(a){return !a||(a.brightness===0&&a.contrast===0&&a.saturation===0&&a.exposure===0&&
  a.temperature===0&&(a.tint||0)===0&&a.highlights===0&&a.shadows===0&&a.sharpness===0&&a.blur===0&&
  a.vignette===0&&a.grain===0&&a.fx==="none"&&a.fade===0&&
  (!a.levels||(a.levels.black===0&&a.levels.white===255&&a.levels.gamma===1))&&
  (!a.hsl||(a.hsl.h===0&&a.hsl.s===0&&a.hsl.l===0))&&
  (!a.cb||(a.cb.sh.every(v=>v===0)&&a.cb.mid.every(v=>v===0)&&a.cb.hi.every(v=>v===0)))&&
  curvesIdentity(a.curves)&&(!a.lutName||!LUT_STORE[a.lutName]));}
function toast(msg){const t=$("toast");t.textContent=msg;t.hidden=false;
  clearTimeout(toast._t);toast._t=setTimeout(()=>{t.hidden=true;},2800);}
/* FIX 2026-11-12 (Issue 3): autosave is a ~1 s debounce after the last
   change, not a 20 s poll. markDirty() schedules it; markSaved() cancels any
   pending timer. The 5 s interval in init() is only a safety net. */
let autosaveTimer=null;
function scheduleAutosave(){
  clearTimeout(autosaveTimer);
  autosaveTimer=setTimeout(()=>{if(S.dirty&&S.hasDoc)saveProject(true);},1000);
}
function markDirty(){S.dirty=true;$("autosaveText").textContent="● Unsaved changes";scheduleAutosave();}
function markSaved(){S.dirty=false;clearTimeout(autosaveTimer);$("autosaveText").textContent="● Auto saved "+new Date().toLocaleTimeString();}
/* FIX 2026-11-12 (Issue 1): a doc is "empty" until it holds a real image
   layer. blankDoc() creates a white paint layer only, so hasImageLayer()
   is the honest test for "is there anything to edit yet". */
function allLeaves(list){
  const out=[];
  for(const L of (list||S.layers)){
    if(L.kind==="group")out.push(...allLeaves(L.children));
    else out.push(L);}
  return out;
}
function hasImageLayer(){return allLeaves().some(l=>l.kind==="image");}
function activeLayer(){return S.activeId?findLayer(S.activeId):null;}
function makeCanvas(w,h){const c=document.createElement("canvas");c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c;}
function canvasCtx(c){return c.getContext("2d",{willReadFrequently:true});}

/* ---------------- pixel pipeline: real adjustments ---------------- */
function applyAdj(src,adj){
  if(isIdentityAdj(adj)) return src;
  let base=src;
  if(adj.blur>0){const t=makeCanvas(src.width,src.height);const x=t.getContext("2d");
    x.filter="blur("+adj.blur+"px)";x.drawImage(src,0,0);x.filter="none";base=t;}
  const w=base.width,h=base.height,out=makeCanvas(w,h),ox=canvasCtx(out);
  const img=canvasCtx(base).getImageData(0,0,w,h),d=img.data;
  const expF=Math.pow(2,adj.exposure/100*1.5);
  const conC=clamp(adj.contrast/100,-0.95,0.95),conF=(1+conC)/(1-conC);
  const satF=1+adj.saturation/100, tempT=adj.temperature/100;
  const cx=w/2,cy=h/2;
  // PHASE 5: precompute per-channel curve LUTs (identity unless points moved)
  const curveLUTs={};
  if(adj.curves&&!curvesIdentity(adj.curves)){
    for(const ch of ["rgb","r","g","b"])curveLUTs[ch]=curveLUT(adj.curves[ch]);
  }
  const lut=LUT_STORE[adj.lutName]||null;
  const lutAmt=lut?clamp((adj.lutIntensity==null?100:adj.lutIntensity)/100,0,1):0;
  const lv=adj.levels||{black:0,white:255,gamma:1};
  const lvRange=Math.max(1,lv.white-lv.black), lvGamma=clamp(lv.gamma||1,0.1,3);
  const hslA=adj.hsl||{h:0,s:0,l:0};
  const cb=adj.cb||{sh:[0,0,0],mid:[0,0,0],hi:[0,0,0]};
  for(let y=0;y<h;y++){
    const dy=(y-cy)/(h/2), dy2=dy*dy;
    for(let x=0;x<w;x++){
      const i=(y*w+x)*4, a=d[i+3];
      if(a===0) continue;
      let r=d[i]*expF,g=d[i+1]*expF,b=d[i+2]*expF;
      r+=adj.brightness; g+=adj.brightness; b+=adj.brightness;
      // PHASE 5 — Levels: black/white point + gamma
      if(lv.black!==0||lv.white!==255||lvGamma!==1){
        r=255*Math.pow(clamp((r-lv.black)/lvRange,0,1),lvGamma);
        g=255*Math.pow(clamp((g-lv.black)/lvRange,0,1),lvGamma);
        b=255*Math.pow(clamp((b-lv.black)/lvRange,0,1),lvGamma);}
      r=(r-128)*conF+128; g=(g-128)*conF+128; b=(b-128)*conF+128;
      const lum=0.299*r+0.587*g+0.114*b;
      r=lum+(r-lum)*satF; g=lum+(g-lum)*satF; b=lum+(b-lum)*satF;
      r+=tempT*30; b-=tempT*30;
      // Tint: + = magenta (red+blue up, green down), − = green
      const tintT=(adj.tint||0)/100; r+=tintT*25; g-=tintT*25; b+=tintT*25;
      // PHASE 5 — Color balance: shadows/midtones/highlights RGB offsets
      if(cb.sh.some(v=>v!==0)||cb.mid.some(v=>v!==0)||cb.hi.some(v=>v!==0)){
        const ln=clamp(lum/255,0,1);
        const wSh=(1-ln)*(1-ln), wMid=1-Math.abs(ln-0.5)*2, wHi=ln*ln;
        r+=cb.sh[0]*wSh+cb.mid[0]*Math.max(0,wMid)+cb.hi[0]*wHi;
        g+=cb.sh[1]*wSh+cb.mid[1]*Math.max(0,wMid)+cb.hi[1]*wHi;
        b+=cb.sh[2]*wSh+cb.mid[2]*Math.max(0,wMid)+cb.hi[2]*wHi;}
      // PHASE 5 — HSL shift (per-pixel, only when set)
      if(hslA.h!==0||hslA.s!==0||hslA.l!==0){
        const hsl=rgbToHsl(clamp(r,0,255)/255,clamp(g,0,255)/255,clamp(b,0,255)/255);
        hsl[0]=(hsl[0]+hslA.h/360+1)%1;
        hsl[1]=clamp(hsl[1]*(1+hslA.s/100),0,1);
        hsl[2]=clamp(hsl[2]+hslA.l/100,0,1);
        const rgb=hslToRgb(hsl[0],hsl[1],hsl[2]);r=rgb[0]*255;g=rgb[1]*255;b=rgb[2]*255;}
      if(adj.highlights!==0&&lum>128){const f=(adj.highlights/100)*((lum-128)/127);r+=(255-r)*f*0.6;g+=(255-g)*f*0.6;b+=(255-b)*f*0.6;}
      if(adj.shadows!==0&&lum<128){const f=(adj.shadows/100)*((128-lum)/128);r+=f*48;g+=f*48;b+=f*48;}
      if(adj.fx==="sepia"&&adj.fxAmt>0){const amt=adj.fxAmt;
        const sr=0.393*r+0.769*g+0.189*b, sg=0.349*r+0.686*g+0.168*b, sb=0.272*r+0.534*g+0.131*b;
        r=r+(sr-r)*amt; g=g+(sg-g)*amt; b=b+(sb-b)*amt;}
      else if(adj.fx==="bw"){r=g=b=lum;}
      else if(adj.fx==="duotone"){const t2=clamp(lum/255,0,1);
        r=20+(255-20)*t2; g=20+(220-20)*t2; b=60+(150-60)*t2;}
      if(adj.fade>0){r=r*(1-adj.fade*0.25)+255*adj.fade*0.07;g=g*(1-adj.fade*0.25)+255*adj.fade*0.07;b=b*(1-adj.fade*0.25)+255*adj.fade*0.07;}
      // PHASE 5 — RGB curves (per-channel LUT, RGB applied to all channels first)
      if(curveLUTs.rgb){r=curveLUTs.rgb[clamp(Math.round(r),0,255)];g=curveLUTs.rgb[clamp(Math.round(g),0,255)];b=curveLUTs.rgb[clamp(Math.round(b),0,255)];}
      if(curveLUTs.r)r=curveLUTs.r[clamp(Math.round(r),0,255)];
      if(curveLUTs.g)g=curveLUTs.g[clamp(Math.round(g),0,255)];
      if(curveLUTs.b)b=curveLUTs.b[clamp(Math.round(b),0,255)];
      // PHASE 5 — .cube LUT (nearest-neighbour 3D lookup, blended by intensity)
      if(lut&&lutAmt>0){
        const n=lut.size,fr=clamp(Math.round(r/255*(n-1)),0,n-1),fg=clamp(Math.round(g/255*(n-1)),0,n-1),fb=clamp(Math.round(b/255*(n-1)),0,n-1);
        const li=((fb*n+fg)*n+fr)*3;
        r=r+(lut.data[li]*255-r)*lutAmt;g=g+(lut.data[li+1]*255-g)*lutAmt;b=b+(lut.data[li+2]*255-b)*lutAmt;}
      if(adj.vignette>0){const dx=(x-cx)/(w/2),dist=Math.sqrt(dx*dx+dy2);
        const vf=1-(adj.vignette/100)*Math.max(0,dist-0.45)*1.5;r*=vf;g*=vf;b*=vf;}
      if(adj.grain>0){const hs=Math.sin(x*12.9898+y*78.233)*43758.5453,hh=hs-Math.floor(hs);
        const n=(hh-0.5)*(adj.grain/100)*36;r+=n;g+=n;b+=n;}
      d[i]=clamp(r,0,255);d[i+1]=clamp(g,0,255);d[i+2]=clamp(b,0,255);
    }
  }
  ox.putImageData(img,0,0);
  if(adj.sharpness>0){ // 3x3 sharpen convolution, amount scales with slider
    const a=(adj.sharpness/100)*0.9;
    const srcImg=ox.getImageData(0,0,w,h),sd=srcImg.data,dst=ox.createImageData(w,h),dd=dst.data;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      for(let k=0;k<3;k++){
        const c=sd[i+k],up=y>0?sd[((y-1)*w+x)*4+k]:c,dn=y<h-1?sd[((y+1)*w+x)*4+k]:c,
          lf=x>0?sd[(y*w+x-1)*4+k]:c,rt=x<w-1?sd[(y*w+x+1)*4+k]:c;
        dd[i+k]=clamp(c*(1+4*a)-a*(up+dn+lf+rt),0,255);
      }
      dd[i+3]=sd[i+3];
    }
    ox.putImageData(dst,0,0);
  }
  // PHASE 5: filter effects that need neighbourhood math (real pixel ops, no CSS filters)
  if(adj.fx&&adj.fx!=="none"&&adj.fx!=="sepia"&&adj.fx!=="bw"&&adj.fx!=="duotone"){
    applyFx(out,adj.fx,adj.fxAmt==null?1:adj.fxAmt);
  }
  return out;
}
/* ---------- PHASE 5 helpers: curves / HSL / convolution / FX ---------- */
function curveLUT(points){
  const lut=new Uint8Array(256);
  const pts=points.slice().sort((a,b)=>a[0]-b[0]);
  for(let v=0;v<256;v++){
    if(v<=pts[0][0]){lut[v]=clamp(Math.round(pts[0][1]),0,255);continue;}
    if(v>=pts[pts.length-1][0]){lut[v]=clamp(Math.round(pts[pts.length-1][1]),0,255);continue;}
    for(let k=0;k<pts.length-1;k++){
      if(v>=pts[k][0]&&v<=pts[k+1][0]){
        const t=(v-pts[k][0])/Math.max(1,pts[k+1][0]-pts[k][0]);
        lut[v]=clamp(Math.round(pts[k][1]+(pts[k+1][1]-pts[k][1])*t),0,255);break;}
    }
  }
  return lut;
}
function rgbToHsl(r,g,b){
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h=0,s=0;const l=(mx+mn)/2;
  if(mx!==mn){const d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);
    if(mx===r)h=(g-b)/d+(g<b?6:0);else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h/=6;}
  return [h,s,l];
}
function hslToRgb(h,s,l){
  if(s===0)return [l,l,l];
  const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;
  const f=t=>{if(t<0)t+=1;if(t>1)t-=1;
    if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
  return [f(h+1/3),f(h),f(h-1/3)];
}
function conv3(src,kernel,div){
  const w=src.width,h=src.height,out=makeCanvas(w,h),ox=canvasCtx(out);
  const img=canvasCtx(src).getImageData(0,0,w,h),d=img.data,dst=ox.createImageData(w,h),dd=dst.data;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4;
    for(let k=0;k<3;k++){
      let sum=0;
      for(let ky=-1;ky<=1;ky++)for(let kx=-1;kx<=1;kx++){
        const xx=clamp(x+kx,0,w-1),yy=clamp(y+ky,0,h-1);
        sum+=d[(yy*w+xx)*4+k]*kernel[(ky+1)*3+kx+1];}
      dd[i+k]=clamp(sum/div,0,255);
    }
    dd[i+3]=d[i+3];
  }
  ox.putImageData(dst,0,0);return out;
}
function blurCanvas(src,px){
  const t=makeCanvas(src.width,src.height),x=t.getContext("2d");
  x.filter="blur("+px+"px)";x.drawImage(src,0,0);x.filter="none";return t;
}
function applyFx(canvas,fx,amt){
  const w=canvas.width,h=canvas.height,ctx=canvasCtx(canvas);
  if(fx==="hdr"){ // local-contrast style: sharpen + contrast lift, blended by amt
    const sharp=conv3(canvas,[0,-1,0,-1,5,-1,0,-1,0],1);
    const img=ctx.getImageData(0,0,w,h),d=img.data;
    const simg=canvasCtx(sharp).getImageData(0,0,w,h).data;
    for(let i=0;i<d.length;i+=4){for(let k=0;k<3;k++)d[i+k]=clamp(d[i+k]+(simg[i+k]-d[i+k])*amt*0.7,0,255);}
    ctx.putImageData(img,0,0);return;}
  if(fx==="glow"){const b=blurCanvas(canvas,6);
    ctx.save();ctx.globalAlpha=clamp(amt,0,1)*0.7;ctx.globalCompositeOperation="screen";ctx.drawImage(b,0,0);ctx.restore();return;}
  if(fx==="softfocus"){const b=blurCanvas(canvas,4);
    const img=ctx.getImageData(0,0,w,h),d=img.data;
    const bimg=canvasCtx(b).getImageData(0,0,w,h).data;
    for(let i=0;i<d.length;i+=4){for(let k=0;k<3;k++)d[i+k]=clamp(d[i+k]*(1-amt*0.5)+bimg[i+k]*amt*0.5,0,255);}
    ctx.putImageData(img,0,0);return;}
  if(fx==="emboss"){const e=conv3(canvas,[-2,-1,0,-1,1,1,0,1,2],1);
    const img=ctx.getImageData(0,0,w,h),d=img.data;
    const eimg=canvasCtx(e).getImageData(0,0,w,h).data;
    for(let i=0;i<d.length;i+=4){for(let k=0;k<3;k++)d[i+k]=clamp(128+(eimg[i+k]-128)*amt+(d[i+k]-128)*(1-amt),0,255);}
    ctx.putImageData(img,0,0);return;}
  if(fx==="oil"){ // posterize colour steps + slight blur = oil-paint feel
    const b=blurCanvas(canvas,2);
    const img=canvasCtx(b).getImageData(0,0,w,h),d=img.data;
    const steps=8;
    for(let i=0;i<d.length;i+=4){for(let k=0;k<3;k++){
      const v=Math.round(d[i+k]/255*steps)/steps*255;
      d[i+k]=clamp(v+(d[i+k]-v)*(1-amt),0,255);}}
    ctx.putImageData(img,0,0);return;}
  if(fx==="sketch"){ // grayscale -> invert -> blur -> color-dodge = pencil sketch
    const img=ctx.getImageData(0,0,w,h),d=img.data;
    for(let i=0;i<d.length;i+=4){const l=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];d[i]=d[i+1]=d[i+2]=l;}
    ctx.putImageData(img,0,0);
    const inv=makeCanvas(w,h),ix=inv.getContext("2d");ix.drawImage(canvas,0,0);
    const iimg=canvasCtx(inv).getImageData(0,0,w,h),id=iimg.data;
    for(let i=0;i<id.length;i+=4){id[i]=255-id[i];id[i+1]=255-id[i+1];id[i+2]=255-id[i+2];}
    canvasCtx(inv).putImageData(iimg,0,0);
    const blurred=blurCanvas(inv,3);
    const bimg=canvasCtx(blurred).getImageData(0,0,w,h).data;
    const gimg=ctx.getImageData(0,0,w,h),gd=gimg.data;
    for(let i=0;i<gd.length;i+=4){for(let k=0;k<3;k++){
      const base=gd[i+k],blend=bimg[i+k];
      const dodged=blend>=255?255:Math.min(255,base*255/Math.max(1,255-blend));
      gd[i+k]=clamp(base+(dodged-base)*amt,0,255);}}
    ctx.putImageData(gimg,0,0);return;}
  if(fx==="edge"){ // Sobel magnitude
    const img=ctx.getImageData(0,0,w,h),d=img.data;
    const gray=new Float32Array(w*h);
    for(let i=0;i<w*h;i++)gray[i]=0.299*d[i*4]+0.587*d[i*4+1]+0.114*d[i*4+2];
    const out=ctx.createImageData(w,h),od=out.data;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const g=(dx,dy)=>gray[clamp(y+dy,0,h-1)*w+clamp(x+dx,0,w-1)];
      const gx=-g(-1,-1)-2*g(-1,0)-g(-1,1)+g(1,-1)+2*g(1,0)+g(1,1);
      const gy=-g(-1,-1)-2*g(0,-1)-g(1,-1)+g(-1,1)+2*g(0,1)+g(1,1);
      const m=clamp(Math.hypot(gx,gy),0,255),i=(y*w+x)*4;
      od[i]=od[i+1]=od[i+2]=m;od[i+3]=d[i+3];}
    ctx.putImageData(out,0,0);return;}
  if(fx==="splash"){ // keep colours near the brush-colour hue, desaturate the rest
    const [br,bg,bb]=hexToRgb(S.brush.color);
    const targetH=rgbToHsl(br/255,bg/255,bb/255)[0];
    const img=ctx.getImageData(0,0,w,h),d=img.data;
    for(let i=0;i<d.length;i+=4){
      const hsl=rgbToHsl(d[i]/255,d[i+1]/255,d[i+2]/255);
      let dh=Math.abs(hsl[0]-targetH);dh=Math.min(dh,1-dh);
      if(dh>0.08){const l=hsl[2]*255;d[i]=d[i+1]=d[i+2]=l;}
      else if(amt<1){const l=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
        d[i]=clamp(d[i]*amt+l*(1-amt),0,255);d[i+1]=clamp(d[i+1]*amt+l*(1-amt),0,255);d[i+2]=clamp(d[i+2]*amt+l*(1-amt),0,255);}}
    ctx.putImageData(img,0,0);return;}
  if(fx==="halftone"){ // dot grid: cell brightness -> dot radius
    const cell=8;
    const img=ctx.getImageData(0,0,w,h),d=img.data;
    ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);
    ctx.fillStyle="#000";
    for(let cy=0;cy<h;cy+=cell)for(let cx=0;cx<w;cx+=cell){
      let sum=0,n=0;
      for(let y=cy;y<Math.min(cy+cell,h);y++)for(let x=cx;x<Math.min(cx+cell,w);x++){
        const i=(y*w+x)*4;sum+=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];n++;}
      const lum=sum/Math.max(1,n)/255;
      const r=(cell/2)*(1-lum)*amt;
      if(r>0.4){ctx.beginPath();ctx.arc(cx+cell/2,cy+cell/2,r,0,Math.PI*2);ctx.fill();}}
    return;}
  if(fx==="posterize"){
    const img=ctx.getImageData(0,0,w,h),d=img.data,levels=4;
    for(let i=0;i<d.length;i+=4){for(let k=0;k<3;k++){
      const q=Math.round(d[i+k]/255*(levels-1))/(levels-1)*255;
      d[i+k]=clamp(d[i+k]+(q-d[i+k])*amt,0,255);}}
    ctx.putImageData(img,0,0);return;}
  if(fx==="neon"){ // Sobel edges, tinted cyan/magenta, screened over the image
    const edge=makeCanvas(w,h),ex=edge.getContext("2d");ex.drawImage(canvas,0,0);
    applyFx(edge,"edge",1);
    const eimg=canvasCtx(edge).getImageData(0,0,w,h),ed=eimg.data;
    for(let i=0;i<ed.length;i+=4){const m=ed[i];
      ed[i]=clamp(m*0.2,0,255);ed[i+1]=clamp(m*0.9,0,255);ed[i+2]=clamp(m,0,255);}
    canvasCtx(edge).putImageData(eimg,0,0);
    ctx.save();ctx.globalAlpha=clamp(amt,0,1);ctx.globalCompositeOperation="screen";ctx.drawImage(edge,0,0);ctx.restore();return;}
}
/* .cube LUT parser (Adobe .cube, on-device, no network) */
function parseCube(text){
  const lines=text.split(/\r?\n/);
  let size=0;const data=[];
  for(const ln of lines){
    const t=ln.trim();
    if(!t||t.startsWith("#"))continue;
    if(t.toUpperCase().startsWith("LUT_3D_SIZE")){size=parseInt(t.split(/\s+/)[1],10);continue;}
    if(/^[A-Za-z_]/.test(t))continue; // TITLE / DOMAIN lines etc.
    const parts=t.split(/\s+/).map(Number);
    if(parts.length>=3&&parts.every(v=>isFinite(v)))data.push(parts[0],parts[1],parts[2]);
  }
  if(!size)size=Math.round(Math.cbrt(data.length/3));
  if(!size||size<2||data.length<size*size*size*3)return null;
  return {size:size,data:new Float32Array(data.slice(0,size*size*size*3))};
}
function adjCanvasOf(L){
  if(isIdentityAdj(L.adj)) return L.canvas;
  if(!L.adjCanvas||L.adjDirty){L.adjCanvas=applyAdj(L.canvas,L.adj);L.adjDirty=false;}
  return L.adjCanvas;
}
function invalidateAdj(L){L.adjDirty=true;L.adjCanvas=null;}

/* ---------------- selection mask (feathered) ----------------
   S.sel shapes: {type:'rect'|'ellipse'|'lasso'|'poly', rect|path, feather, inverted, expand, contract}
   or pixel selections: {type:'mask', mask:<canvas>, feather, inverted, expand, contract}
   (mask selections come from Wand / Quick Selection / Color Range). */
function dilateMask(mask,n){
  if(n<=0)return mask;
  const out=makeCanvas(mask.width,mask.height),x=out.getContext("2d");
  for(let dy=-n;dy<=n;dy+=Math.max(1,Math.round(n/2)))for(let dx=-n;dx<=n;dx+=Math.max(1,Math.round(n/2))){
    x.drawImage(mask,dx,dy);}
  x.drawImage(mask,0,0);return out;
}
function erodeMask(mask,n){
  if(n<=0)return mask;
  // erosion = intersection of the mask shifted in the 4 directions
  const w=mask.width,h=mask.height;
  const inter=(a,b)=>{const t=makeCanvas(w,h),x=t.getContext("2d");
    x.drawImage(a,0,0);x.globalCompositeOperation="destination-in";x.drawImage(b,0,0);return t;};
  const shift=(dx,dy)=>{const t=makeCanvas(w,h);t.getContext("2d").drawImage(mask,dx,dy);return t;};
  let out=inter(mask,shift(n,0));out=inter(out,shift(-n,0));
  out=inter(out,shift(0,n));out=inter(out,shift(0,-n));return out;
}
function buildSelMask(){
  const sel=S.sel;if(!sel) return null;
  let m;
  if(sel.type==="mask"&&sel.mask){m=makeCanvas(S.docW,S.docH);m.getContext("2d").drawImage(sel.mask,0,0);}
  else{
    m=makeCanvas(S.docW,S.docH);const x=m.getContext("2d");
    x.fillStyle="#fff";
    const trace=()=>{
      if(sel.type==="rect"){x.fillRect(sel.rect.x,sel.rect.y,sel.rect.w,sel.rect.h);}
      else if(sel.type==="ellipse"&&sel.rect){
        x.beginPath();x.ellipse(sel.rect.x+sel.rect.w/2,sel.rect.y+sel.rect.h/2,
          Math.abs(sel.rect.w)/2,Math.abs(sel.rect.h)/2,0,0,Math.PI*2);x.fill();}
      else if((sel.type==="lasso"||sel.type==="poly")&&sel.path&&sel.path.length>2){
        x.beginPath();x.moveTo(sel.path[0].x,sel.path[0].y);
        for(let i=1;i<sel.path.length;i++)x.lineTo(sel.path[i].x,sel.path[i].y);
        x.closePath();x.fill();}};
    trace();
    if(sel.inverted){
      const full=makeCanvas(S.docW,S.docH),fx=full.getContext("2d");
      fx.fillStyle="#fff";fx.fillRect(0,0,S.docW,S.docH);
      fx.globalCompositeOperation="destination-out";fx.drawImage(m,0,0);
      m=full;}
  }
  if(sel.expand>0)m=dilateMask(m,Math.round(sel.expand));
  if(sel.contract>0)m=erodeMask(m,Math.round(sel.contract));
  if(sel.inverted&&sel.type==="mask"){
    const full=makeCanvas(S.docW,S.docH),fx=full.getContext("2d");
    fx.fillStyle="#fff";fx.fillRect(0,0,S.docW,S.docH);
    fx.globalCompositeOperation="destination-out";fx.drawImage(m,0,0);
    m=full;}
  if(sel.feather>0){const f=makeCanvas(S.docW,S.docH),fc=f.getContext("2d");
    fc.filter="blur("+sel.feather+"px)";fc.drawImage(m,0,0);return f;}
  return m;
}
/* Region-grow selection (Wand = contiguous only, Quick Selection adds to the
   existing mask as you drag). Tolerance 0-100 maps to an RGB distance. */
function regionGrowMask(sx,sy,tolerance,addTo){
  const src=compCanvas,w=S.docW,h=S.docH;
  const ctx=canvasCtx(src),img=ctx.getImageData(0,0,w,h),d=img.data;
  sx=clamp(Math.round(sx),0,w-1);sy=clamp(Math.round(sy),0,h-1);
  const si=(sy*w+sx)*4,tr=d[si],tg=d[si+1],tb=d[si+2];
  const tol=tolerance/100*160;
  const out=addTo||makeCanvas(w,h),ox=canvasCtx(out);
  const oimg=ox.getImageData(0,0,w,h),od=oimg.data;
  const seen=new Uint8Array(w*h),stack=[[sx,sy]];
  const close=(i)=>Math.abs(d[i]-tr)+Math.abs(d[i+1]-tg)+Math.abs(d[i+2]-tb)<=tol*3;
  while(stack.length){
    const [cx,cy]=stack.pop();
    if(cx<0||cy<0||cx>=w||cy>=h)continue;
    const k=cy*w+cx;if(seen[k])continue;seen[k]=1;
    const j=k*4;if(!close(j))continue;
    od[j]=255;od[j+1]=255;od[j+2]=255;od[j+3]=255;
    stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
  }
  ox.putImageData(oimg,0,0);
  return out;
}
function colorRangeMask(hex,tolerance){
  const [tr,tg,tb]=hexToRgb(hex),tol=tolerance/100*160;
  const w=S.docW,h=S.docH,out=makeCanvas(w,h),ox=canvasCtx(out);
  const img=canvasCtx(compCanvas).getImageData(0,0,w,h),d=img.data;
  const oimg=ox.createImageData(w,h),od=oimg.data;
  for(let i=0;i<d.length;i+=4){
    if(Math.abs(d[i]-tr)+Math.abs(d[i+1]-tg)+Math.abs(d[i+2]-tb)<=tol*3){
      od[i]=255;od[i+1]=255;od[i+2]=255;od[i+3]=255;}}
  ox.putImageData(oimg,0,0);return out;
}
function selBBox(){
  const sel=S.sel;if(!sel)return null;
  if(sel.type==="rect"||sel.type==="ellipse")return {...sel.rect};
  if(sel.type==="mask"&&sel.mask){
    const d=canvasCtx(sel.mask).getImageData(0,0,S.docW,S.docH).data;
    let x0=S.docW,y0=S.docH,x1=0,y1=0,found=false;
    for(let y=0;y<S.docH;y++)for(let x=0;x<S.docW;x++){
      if(d[(y*S.docW+x)*4+3]>10){found=true;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}}
    return found?{x:x0,y:y0,w:x1-x0+1,h:y1-y0+1}:null;}
  if(!sel.path||!sel.path.length)return null;
  let xs=sel.path.map(p=>p.x),ys=sel.path.map(p=>p.y);
  const x0=Math.min(...xs),y0=Math.min(...ys);
  return {x:x0,y:y0,w:Math.max(...xs)-x0,h:Math.max(...ys)-y0};
}

/* ---------------- compositing ----------------
   PHASE 5 rewrite: layers composite onto a running full-doc canvas so
   adjustment layers can transform everything below them, and clipping
   masks can clip a layer to the alpha of the layer beneath it. The running
   canvas is then drawn into the target with the straighten rotation. */
const compCanvas=makeCanvas(S.docW,S.docH); // offscreen composite (no overlay) — eyedropper reads this
function compositeTo(ctx,tw,th){
  // build the running composite at document resolution
  const run=makeCanvas(S.docW,S.docH),rx=run.getContext("2d");
  const selMask=(S.sel&&S.selOnly)?buildSelMask():null;
  const leaves=flatLayers();
  let prevRendered=null;
  for(const L of leaves){
    if(L.kind==="adjlayer"){
      // adjustment layer: apply its adjustments to everything below, non-destructively
      if(!isIdentityAdj(L.adj)){
        const adjusted=applyAdj(run,L.adj);
        rx.clearRect(0,0,S.docW,S.docH);rx.drawImage(adjusted,0,0);}
      prevRendered=null;continue;}
    let src=layerRendered(L);
    if(L.clip&&prevRendered){ // clipping mask: keep only where the layer below is opaque
      const t=makeCanvas(S.docW,S.docH),tx=t.getContext("2d");
      tx.drawImage(src,0,0);tx.globalCompositeOperation="destination-in";tx.drawImage(prevRendered,0,0);
      src=t;}
    const op=clamp(L._effOpacity!=null?L._effOpacity:L.opacity,0,100)/100;
    rx.save();rx.globalAlpha=op;
    rx.globalCompositeOperation=BLENDS.includes(L.blend)?L.blend:"source-over";
    if(selMask&&!isIdentityAdj(L.adj)){
      // selection-only adjustments: base unadjusted everywhere, adjusted only inside selection
      rx.globalCompositeOperation="source-over";
      let base=L.canvas;
      if(L.mask){const t=makeCanvas(S.docW,S.docH),tx=t.getContext("2d");
        tx.drawImage(base,0,0);tx.globalCompositeOperation="destination-in";tx.drawImage(L.mask,0,0);base=t;}
      rx.drawImage(base,0,0);
      rx.save();rx.globalCompositeOperation=BLENDS.includes(L.blend)?L.blend:"source-over";
      const clip=makeCanvas(S.docW,S.docH),cx2=clip.getContext("2d");
      cx2.drawImage(src,0,0);cx2.globalCompositeOperation="destination-in";cx2.drawImage(selMask,0,0);
      rx.drawImage(clip,0,0);rx.restore();
    }else{
      rx.drawImage(src,0,0);
    }
    rx.restore();
    prevRendered=src;
  }
  // transform preview: draw the active layer through its live quad instead of its normal spot
  if(S.transform&&S.transform.live){
    const T=S.transform,L=findLayer(T.layerId);
    if(L&&L.canvas){
      // erase the layer's normal contribution is complex; the preview draws the
      // transformed copy over the composite (slightly brighter = honest preview)
      const t=makeCanvas(S.docW,S.docH),tx=t.getContext("2d");
      tx.globalAlpha=0.55;drawQuadImage(tx,layerRendered(L),T.quad);
      rx.save();rx.globalCompositeOperation="source-over";rx.drawImage(t,0,0);rx.restore();}
  }
  ctx.save();ctx.clearRect(0,0,tw,th);
  const sx=tw/S.docW, sy=th/S.docH;
  ctx.translate(tw/2,th/2);
  if(S.straighten)ctx.rotate(S.straighten*Math.PI/180);
  ctx.translate(-tw/2,-th/2);
  ctx.scale(sx,sy);
  ctx.drawImage(run,0,0);
  ctx.restore();
}
/* Draw an image through an arbitrary quad (two triangles, affine each) —
   used for perspective / free-transform preview and commit. */
function drawQuadImage(ctx,img,quad){
  const w=img.width,h=img.height;
  const tri=(p0,p1,p2,q0,q1,q2)=>{
    const dx1=p1.x-p0.x,dy1=p1.y-p0.y,dx2=p2.x-p0.x,dy2=p2.y-p0.y;
    const ux1=q1.x-q0.x,uy1=q1.y-q0.y,ux2=q2.x-q0.x,uy2=q2.y-q0.y;
    const det=dx1*dy2-dx2*dy1;if(Math.abs(det)<0.001)return;
    const a=(ux1*dy2-ux2*dy1)/det,b=(ux2*dx1-ux1*dx2)/det;
    const c=(uy1*dy2-uy2*dy1)/det,d=(uy2*dx1-uy1*dx2)/det;
    ctx.save();
    ctx.beginPath();ctx.moveTo(q0.x,q0.y);ctx.lineTo(q1.x,q1.y);ctx.lineTo(q2.x,q2.y);ctx.closePath();ctx.clip();
    ctx.transform(a,c,b,d,q0.x-a*p0.x-b*p0.y,q0.y-c*p0.x-d*p0.y);
    ctx.drawImage(img,0,0);
    ctx.restore();};
  tri({x:0,y:0},{x:w,y:0},{x:0,y:h},quad[0],quad[1],quad[3]);
  tri({x:w,y:0},{x:w,y:h},{x:0,y:h},quad[1],quad[2],quad[3]);
}
function render(){
  if(!S.hasDoc){return;}
  compCanvas.width=S.docW;compCanvas.height=S.docH;
  compositeTo(compCanvas.getContext("2d"),S.docW,S.docH);
  const cv=$("photoCanvas");
  if(cv.width!==S.docW)cv.width=S.docW;
  if(cv.height!==S.docH)cv.height=S.docH;
  const x=cv.getContext("2d");
  x.clearRect(0,0,S.docW,S.docH);
  x.drawImage(compCanvas,0,0);
  drawOverlay(x);
  updateStatus();
}
let antsOffset=0;
function drawOverlay(x){
  x.save();
  // crop rectangle (with draggable corner/edge handles)
  if(S.cropRect){const r=S.cropRect;
    x.fillStyle="rgba(0,0,0,0.45)";x.fillRect(0,0,S.docW,r.y);x.fillRect(0,r.y+r.h,S.docW,S.docH-r.y-r.h);
    x.fillRect(0,r.y,r.x,r.h);x.fillRect(r.x+r.w,r.y,S.docW-r.x-r.w,r.h);
    x.strokeStyle="#06b6d4";x.lineWidth=2;x.setLineDash([8,5]);x.lineDashOffset=-antsOffset;
    x.strokeRect(r.x,r.y,r.w,r.h);x.setLineDash([]);
    const hs=clamp(12/S.zoom,6,24);
    x.fillStyle="#fff";x.strokeStyle="#06b6d4";x.lineWidth=2;
    const hx=[r.x,r.x+r.w/2,r.x+r.w],hy=[r.y,r.y+r.h/2,r.y+r.h];
    for(const px of hx)for(const py of hy){
      if(px!==r.x&&px!==r.x+r.w&&py!==r.y&&py!==r.y+r.h)continue; // corners + edge mids only
      x.beginPath();x.rect(px-hs/2,py-hs/2,hs,hs);x.fill();x.stroke();}}
  // selection marching ants (finished selection)
  if(S.sel){x.strokeStyle="#f43f5e";x.lineWidth=2;x.setLineDash([8,5]);x.lineDashOffset=-antsOffset;
    x.beginPath();
    if(S.sel.type==="rect"){x.rect(S.sel.rect.x,S.sel.rect.y,S.sel.rect.w,S.sel.rect.h);}
    else if(S.sel.type==="ellipse"&&S.sel.rect){
      x.ellipse(S.sel.rect.x+S.sel.rect.w/2,S.sel.rect.y+S.sel.rect.h/2,
        Math.abs(S.sel.rect.w)/2,Math.abs(S.sel.rect.h)/2,0,0,Math.PI*2);}
    else if(S.sel.type==="mask"&&S.sel.mask){
      // marching ants around a pixel mask: draw the mask edge as a dashed outline
      x.save();x.setLineDash([]);x.globalAlpha=0.25;x.drawImage(S.sel.mask,0,0);x.restore();
      x.beginPath();x.rect(0,0,S.docW,S.docH);}
    else if(S.sel.path){x.moveTo(S.sel.path[0].x,S.sel.path[0].y);
      for(let i=1;i<S.sel.path.length;i++)x.lineTo(S.sel.path[i].x,S.sel.path[i].y);x.closePath();}
    x.stroke();x.setLineDash([]);}
  // polygon lasso points while placing
  if(S.polyPath&&S.polyPath.length){x.strokeStyle="#f43f5e";x.lineWidth=2;x.setLineDash([8,5]);x.lineDashOffset=-antsOffset;
    x.beginPath();x.moveTo(S.polyPath[0].x,S.polyPath[0].y);
    for(let i=1;i<S.polyPath.length;i++)x.lineTo(S.polyPath[i].x,S.polyPath[i].y);
    x.stroke();x.setLineDash([]);
    x.fillStyle="#f43f5e";
    for(const p of S.polyPath){x.beginPath();x.arc(p.x,p.y,5,0,Math.PI*2);x.fill();}}
  // lasso path while drawing
  if(S.lassoPath&&S.lassoPath.length>1){x.strokeStyle="#f43f5e";x.lineWidth=2;x.setLineDash([8,5]);x.lineDashOffset=-antsOffset;
    x.beginPath();x.moveTo(S.lassoPath[0].x,S.lassoPath[0].y);
    for(let i=1;i<S.lassoPath.length;i++)x.lineTo(S.lassoPath[i].x,S.lassoPath[i].y);
    x.stroke();x.setLineDash([]);}
  // shape drag preview
  if(S.shapePreview){const p=S.shapePreview;
    x.save();x.globalAlpha=0.7;x.fillStyle=$("shapeFill").value;x.strokeStyle=$("shapeStroke").value;
    x.lineWidth=+$("shapeStrokeW").value;
    drawShapePath(x,p.kind,p.x,p.y,p.w,p.h,+$("shapeSides").value||5);x.restore();}
  // gradient drag preview
  if(S.gradPreview){const g=S.gradPreview;
    x.save();x.globalAlpha=0.65;
    let gr;
    if($("gradKind").value==="radial"){const rr=Math.hypot(g.x1-g.x0,g.y1-g.y0);
      gr=x.createRadialGradient(g.x0,g.y0,0,g.x0,g.y0,Math.max(1,rr));}
    else gr=x.createLinearGradient(g.x0,g.y0,g.x1,g.y1);
    gr.addColorStop(0,S.brush.color);gr.addColorStop(1,S.brush.bgColor);
    x.fillStyle=gr;
    x.fillRect(Math.min(g.x0,g.x1),Math.min(g.y0,g.y1),Math.max(1,Math.abs(g.x1-g.x0)),Math.max(1,Math.abs(g.y1-g.y0)));
    x.restore();}
  // zoom-tool marquee preview
  if(S.zoomRect){const r=S.zoomRect;
    x.strokeStyle="#06b6d4";x.lineWidth=2;x.setLineDash([6,4]);
    x.strokeRect(r.x,r.y,r.w,r.h);x.setLineDash([]);}
  // clone source marker
  if(S.cloneSrc&&(S.tool==="clone"||S.tool==="healing")){
    x.strokeStyle="#22c55e";x.lineWidth=2;x.beginPath();
    x.arc(S.cloneSrc.x,S.cloneSrc.y,Math.max(8,S.brush.size/2),0,Math.PI*2);x.stroke();
    x.beginPath();x.moveTo(S.cloneSrc.x-12,S.cloneSrc.y);x.lineTo(S.cloneSrc.x+12,S.cloneSrc.y);
    x.moveTo(S.cloneSrc.x,S.cloneSrc.y-12);x.lineTo(S.cloneSrc.x,S.cloneSrc.y+12);x.stroke();}
  // active text/shape layer bounds
  const L=activeLayer();
  if(L&&(L.kind==="text"||L.kind==="shape")&&S.tool!=="brush"&&S.tool!=="eraser"){
    const b=layerBounds(L);
    if(b){x.strokeStyle="#06b6d4";x.lineWidth=1.5;x.setLineDash([6,4]);x.strokeRect(b.x-4,b.y-4,b.w+8,b.h+8);x.setLineDash([]);}}
  // PHASE 5: free-transform / perspective handles
  if(S.transform&&S.transform.live){
    const q=S.transform.quad;
    x.save();x.strokeStyle="#06b6d4";x.lineWidth=2;
    x.beginPath();x.moveTo(q[0].x,q[0].y);
    for(let i=1;i<4;i++)x.lineTo(q[i].x,q[i].y);
    x.closePath();x.stroke();
    x.fillStyle="#06b6d4";
    for(let i=0;i<4;i++){x.beginPath();x.arc(q[i].x,q[i].y,8,0,Math.PI*2);x.fill();}
    // edge-mid shear handles + rotate handle (free transform only)
    if(S.transform.mode==="transform"){
      const mids=[{x:(q[0].x+q[1].x)/2,y:(q[0].y+q[1].y)/2,k:"shearH"},
        {x:(q[1].x+q[2].x)/2,y:(q[1].y+q[2].y)/2,k:"shearV"},
        {x:(q[2].x+q[3].x)/2,y:(q[2].y+q[3].y)/2,k:"shearH"},
        {x:(q[3].x+q[0].x)/2,y:(q[3].y+q[0].y)/2,k:"shearV"}];
      x.fillStyle="#f59e0b";
      for(const m of mids){x.fillRect(m.x-6,m.y-6,12,12);}
      const cx=(q[0].x+q[2].x)/2,cy=(q[0].y+q[2].y)/2;
      const rx2=(q[0].x+q[1].x)/2,ry2=Math.min(q[0].y,q[1].y)-44;
      x.strokeStyle="#f59e0b";x.beginPath();x.moveTo(cx,Math.min(q[0].y,q[1].y));x.lineTo(rx2,ry2);x.stroke();
      x.beginPath();x.arc(rx2,ry2,9,0,Math.PI*2);x.fill();}
    x.restore();}
  x.restore();
}
function layerBounds(L){
  if(L.kind==="text"&&L.text){const m=measureText(L.text);return {x:L.text.x-m.w/2,y:L.text.y-m.h/2,w:m.w,h:m.h};}
  if(L.kind==="shape"&&L.shape){return {x:L.shape.x,y:L.shape.y,w:L.shape.w,h:L.shape.h};}
  return null;
}
setInterval(()=>{if(S.sel||S.cropRect){antsOffset=(antsOffset+1)%16;render();}},120);

/* ---------------- text / shape rasterizers ---------------- */
function measureText(t){
  // measure with the same per-char spacing logic used to draw
  const lines=t.str.split("\n");
  let w=0;const tmp=document.createElement("canvas").getContext("2d");
  tmp.font=(t.weight||"400")+" "+t.size+"px "+t.font;
  for(const ln of lines){
    let lw=0;for(const ch of ln){lw+=tmp.measureText(ch).width+t.spacing;}
    if(ln.length)lw-=t.spacing;w=Math.max(w,lw);}
  return {w:w,h:lines.length*t.size*(t.lineHeight/100)};
}
function drawTextOn(ctx,t,cx,cy){
  ctx.save();ctx.font=(t.weight||"400")+" "+t.size+"px "+t.font;ctx.textBaseline="middle";
  ctx.fillStyle=t.color;
  if(t.shadow){ctx.shadowColor="rgba(0,0,0,0.6)";ctx.shadowBlur=6;ctx.shadowOffsetX=3;ctx.shadowOffsetY=3;}
  const lines=t.str.split("\n"),lh=t.size*(t.lineHeight/100);
  const totalH=lines.length*lh;
  const maxW=Math.max.apply(null,lines.map(ln=>{
    let lw=0;for(const ch of ln){lw+=ctx.measureText(ch).width+t.spacing;}
    return ln.length?lw-t.spacing:0;}));
  const align=t.align||"center";
  lines.forEach((ln,li)=>{
    let lw=0;for(const ch of ln){lw+=ctx.measureText(ch).width+t.spacing;}
    if(ln.length)lw-=t.spacing;
    let x=align==="left"?cx-maxW/2:align==="right"?cx+maxW/2-lw:cx-lw/2;
    const y=cy-totalH/2+li*lh+lh/2;
    for(const ch of ln){
      if(t.outline){ctx.strokeStyle=t.outlineColor;ctx.lineWidth=Math.max(2,t.size/14);
        ctx.strokeText(ch,x,y);}
      ctx.fillText(ch,x,y);
      x+=ctx.measureText(ch).width+t.spacing;
    }
  });
  ctx.restore();
}
function drawShapePath(ctx,kind,x,y,w,h,sides){
  ctx.beginPath();
  if(kind==="ellipse"){ctx.ellipse(x+w/2,y+h/2,Math.abs(w)/2,Math.abs(h)/2,0,0,Math.PI*2);}
  else if(kind==="polygon"){
    const n=clamp(Math.round(sides||5),3,12),cx=x+w/2,cy=y+h/2,rx=Math.abs(w)/2,ry=Math.abs(h)/2;
    for(let i=0;i<n;i++){
      const a=-Math.PI/2+i*2*Math.PI/n,px=cx+rx*Math.cos(a),py=cy+ry*Math.sin(a);
      if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}
    ctx.closePath();}
  else if(kind==="line"){ctx.moveTo(x,y);ctx.lineTo(x+w,y+h);}
  else if(kind==="arrow"){
    const x2=x+w,y2=y+h,ang=Math.atan2(y2-y,x2-x),hl=Math.min(28,Math.hypot(w,h)*0.3);
    ctx.moveTo(x,y);ctx.lineTo(x2,y2);
    ctx.moveTo(x2,y2);ctx.lineTo(x2-hl*Math.cos(ang-0.45),y2-hl*Math.sin(ang-0.45));
    ctx.moveTo(x2,y2);ctx.lineTo(x2-hl*Math.cos(ang+0.45),y2-hl*Math.sin(ang+0.45));
  }
  else{ctx.rect(x,y,w,h);}
  if(kind==="line"||kind==="arrow"){ctx.stroke();}
  else{ctx.fill();ctx.stroke();}
}
function rasterizeTextLayer(L){
  const x=canvasCtx(L.canvas);x.clearRect(0,0,S.docW,S.docH);
  drawTextOn(x,L.text,L.text.x,L.text.y);invalidateAdj(L);
}
function rasterizeShapeLayer(L){
  const x=canvasCtx(L.canvas);x.clearRect(0,0,S.docW,S.docH);
  const s=L.shape;x.save();x.fillStyle=s.fill;x.strokeStyle=s.stroke;x.lineWidth=s.strokeW;
  x.globalAlpha=clamp(s.opacity,1,100)/100;drawShapePath(x,s.kind,s.x,s.y,s.w,s.h,s.sides);x.restore();
  invalidateAdj(L);
}
function newLayer(name,kind){
  const L={id:uid(),name:name||("Layer "+(S.layers.length+1)),kind:kind||"paint",
    canvas:makeCanvas(S.docW,S.docH),mask:null,opacity:100,blend:"source-over",
    visible:true,locked:false,adj:defaultAdj(),adjCanvas:null,adjDirty:true,
    text:null,shape:null,version:0,children:null,collapsed:false,clip:false};
  if(kind==="group"){L.children=[];L.canvas=null;}
  if(kind==="adjlayer"){L.canvas=null;}
  return L;
}
/* PHASE 5 — layer tree helpers. Groups hold children; the composite works on
   the flattened leaf list (top-to-bottom draw order preserved). */
function flatLayers(list,groupOp){
  const out=[];
  for(const L of (list||S.layers)){
    if(!L.visible)continue;
    if(L.kind==="group"){
      const op=(groupOp==null?100:groupOp)*(L.opacity/100);
      out.push(...flatLayers(L.children,op));
      continue;}
    const copy=L;
    if(groupOp!=null&&groupOp!==100){out.push(Object.assign({},L,{_effOpacity:Math.round(L.opacity*groupOp/100)}));}
    else out.push(L);
  }
  return out;
}
function findLayer(id,list){
  for(const L of (list||S.layers)){
    if(L.id===id)return L;
    if(L.children){const f=findLayer(id,L.children);if(f)return f;}}
  return null;
}
function parentListOf(id,list){
  list=list||S.layers;
  for(const L of list){
    if(L.id===id)return list;
    if(L.children){const f=parentListOf(id,L.children);if(f)return f;}}
  return null;
}
function layerRendered(L){
  // adjusted + masked version of one leaf layer (fresh canvas each call)
  let src=adjCanvasOf(L);
  if(L.mask){
    const t=makeCanvas(S.docW,S.docH),tx=t.getContext("2d");
    tx.drawImage(src,0,0);tx.globalCompositeOperation="destination-in";tx.drawImage(L.mask,0,0);
    src=t;}
  return src;
}

/* ---------------- layers panel ---------------- */
function renderLayerList(){
  const box=$("layerList");box.innerHTML="";
  if(!S.layers.length){box.innerHTML='<p class="layer-empty">No layers yet. Open an image or add a layer.</p>';return;}
  const renderOne=(L,depth)=>{
    const d=document.createElement("div");
    d.className="layer-item"+(L.id===S.activeId?" sel":"")+(L.locked?" locked":"")+
      (L.kind==="group"?" group-row":"")+(depth>0?" child-row":"")+(L.kind==="adjlayer"?" adj-row":"");
    d.draggable=true;d.dataset.id=L.id;
    if(L.kind==="group"){
      const col=document.createElement("button");col.className="collapse-btn";
      col.innerHTML=epIcon(L.collapsed?"chevron-right":"chevron-down",14);col.title=L.collapsed?"Expand group":"Collapse group";
      col.onclick=e=>{e.stopPropagation();L.collapsed=!L.collapsed;renderLayerList();};
      d.appendChild(col);
    }
    const thumb=document.createElement("canvas");thumb.width=48;thumb.height=36;
    if(L.canvas)thumb.getContext("2d").drawImage(L.canvas,0,0,48,36);
    else if(L.kind==="adjlayer"){const tc=thumb.getContext("2d");tc.fillStyle="#7c3aed";tc.fillRect(0,0,48,36);tc.fillStyle="#fff";tc.font="bold 16px Arial";tc.fillText("fx",14,24);}
    else if(L.kind==="group"){const tc=thumb.getContext("2d");tc.fillStyle="#1a2340";tc.fillRect(0,0,48,36);tc.fillStyle="#f59e0b";tc.font="bold 18px Arial";tc.fillText("▣",14,26);}
    const nm=document.createElement("span");nm.className="lname";
    nm.textContent=L.name+(L.kind==="group"?" ("+(L.children?L.children.length:0)+")":L.kind!=="paint"?" ("+L.kind+")":"");
    nm.title="Double-click to rename";
    nm.ondblclick=()=>{const n=prompt("Rename layer:",L.name);if(n!==null&&n.trim()){pushUndo("Rename layer");L.name=n.trim();renderLayerList();markDirty();}};
    const eye=document.createElement("button");eye.className="licon";eye.innerHTML=epIcon(L.visible?"eye":"eye-off",16);
    eye.title=L.visible?"Hide layer":"Show layer";
    eye.onclick=e=>{e.stopPropagation();L.visible=!L.visible;render();renderLayerList();markDirty();};
    const lk=document.createElement("button");lk.className="licon";lk.innerHTML=epIcon(L.locked?"lock":"unlock",16);
    lk.title=L.locked?"Unlock layer":"Lock layer";
    lk.onclick=e=>{e.stopPropagation();L.locked=!L.locked;renderLayerList();markDirty();};
    d.appendChild(thumb);d.appendChild(nm);
    if(L.mask){const mb=document.createElement("span");mb.className="mask-badge";mb.textContent="mask";d.appendChild(mb);}
    if(L.clip){const cb=document.createElement("span");cb.className="mask-badge";cb.textContent="clip";d.appendChild(cb);}
    d.appendChild(eye);d.appendChild(lk);
    d.onclick=()=>{selectLayer(L.id);};
    d.ondragstart=e=>{e.dataTransfer.setData("text/plain",L.id);};
    d.ondragover=e=>{e.preventDefault();};
    d.ondrop=e=>{e.preventDefault();const dragId=e.dataTransfer.getData("text/plain");
      const fromList=parentListOf(dragId),toList=parentListOf(L.id);
      const from=fromList?fromList.findIndex(l=>l.id===dragId):-1;
      const to=toList?toList.findIndex(l=>l.id===L.id):-1;
      if(from<0)return;
      pushUndo("Reorder layer");
      if(L.kind==="group"&&fromList!==L.children){
        // drop ONTO a group: move the layer inside it
        const [mv]=fromList.splice(from,1);
        L.children.push(mv);L.collapsed=false;
        render();renderLayerList();markDirty();toast("Moved into group “"+L.name+"”");return;}
      if(fromList===toList&&from!==to){
        const [mv]=fromList.splice(from,1);toList.splice(to,0,mv);render();renderLayerList();markDirty();}};
    box.appendChild(d);
    if(L.kind==="group"&&!L.collapsed&&(L.children||[]).length){
      [...L.children].reverse().forEach(c=>renderOne(c,depth+1));}
  };
  [...S.layers].reverse().forEach(L=>renderOne(L,0));
  updateLayerControls();
}
function selectLayer(id){
  S.activeId=id;S.editMask=false;$("btnEditMask").classList.remove("on");$("optMask").hidden=true;
  const L=activeLayer();
  if(L){$("layerOpacity").value=L.opacity;$("layerOpacityVal").textContent=L.opacity+"%";
    $("layerBlend").value=L.blend;
    if(L.kind==="text"&&L.text)loadTextPanel(L.text);
    if(L.kind==="shape"&&L.shape)loadShapePanel(L.shape);
    loadAdjPanel();
    $("maskStatus").textContent=L.mask?(S.editMask?"Painting on mask — black hides, white reveals.":"Layer has a mask. Use “Edit mask” to paint on it."):"No mask on the selected layer.";}
  render();renderLayerList();
}
function updateLayerControls(){
  const L=activeLayer();
  $("btnAddMask").disabled=!L||!L.canvas;$("btnEditMask").disabled=!L||!L.mask;
  $("btnApplyMask").disabled=!L||!L.mask;$("btnDeleteMask").disabled=!L||!L.mask;
  $("btnDupLayer").disabled=!L;$("btnDelLayer").disabled=!L;
  $("btnLayerUp").disabled=!L;$("btnLayerDown").disabled=!L;
  $("btnMergeDown").disabled=!L||!L.canvas;
  $("btnClipMask").disabled=!L||!L.canvas;
  $("btnUngroup").disabled=!L||L.kind!=="group";
  $("layerOpacity").disabled=!L;$("layerBlend").disabled=!L||L.kind==="adjlayer"||L.kind==="group";
  if(L)$("btnClipMask").innerHTML=epIcon("scissors")+(L.clip?" Unclip":" Clip to below");
}
function updateStatus(){
  const L=activeLayer();
  /* BUG 4 (2026-11-12): the filter indicator vanished when the active
     layer changed — a B&W photo layer below a fresh Brush layer showed
     only "Active layer: Brush". A filter belongs to the LAYER that
     carries it, so list every visible layer that carries one (the active
     layer bare, the others with their layer name), whatever is selected. */
  const filtParts=[];
  for(const leaf of allLeaves()){
    if(leaf.visible===false||isIdentityAdj(leaf.adj))continue;
    const nm=filterNameFor(leaf.adj)||"custom adjustments";
    filtParts.push(leaf===L?nm:nm+" ("+(leaf.name||"Layer")+")");
  }
  const filt=filtParts.length?(" • Filter: "+filtParts.join(", ")):"";
  $("photoHint").textContent=S.hasDoc?((L?("Active layer: "+L.name+(L.locked?" (locked)":"")+(S.editMask?" — editing MASK":"")+filt):"No layer selected")):"No image open.";
  $("docInfo").textContent=S.hasDoc?(S.docW+"×"+S.docH+" px • "+allLeaves().length+" layer"+(allLeaves().length===1?"":"s")+(S.straighten?" • straighten "+S.straighten+"°":"")):"";
  $("toolHint").textContent="Tool: "+toolName(S.tool)+(S.cloneSrc&&(S.tool==="clone"||S.tool==="healing")?" • source set":"");
  const cp=$("colorProfile");
  if(cp)cp.textContent=S.hasDoc?"Color: sRGB (canvas working space)":"";
  if(document.activeElement!==$("resizeW"))$("resizeW").value=S.docW;
  if(document.activeElement!==$("resizeH"))$("resizeH").value=S.docH;
}
function toolName(t){return {move:"Move",brush:"Brush",pencil:"Pencil",airbrush:"Airbrush",
  blurbrush:"Blur brush",sharpenbrush:"Sharpen brush",smudge:"Smudge",dodge:"Dodge",burn:"Burn",
  sponge:"Sponge",eraser:"Eraser",crop:"Crop",rectsel:"Rect select",ellipsesel:"Ellipse select",
  lasso:"Lasso",polylasso:"Polygon lasso",quicksel:"Quick selection",wand:"Magic wand",
  colorrange:"Color range",clone:"Clone stamp",healing:"Healing (feathered clone)",
  spotheal:"Spot healing",redeye:"Red-eye",whiten:"Teeth whitening",smoothbrush:"Smoothing",
  localexp:"Local exposure",text:"Text",shape:"Shape",picker:"Color picker",bucket:"Paint bucket",
  transform:"Free transform",perspective:"Perspective",
  gradient:"Gradient",hand:"Hand",zoom:"Zoom"}[t]||t;}

/* ---------------- undo / redo (snapshot stack) ---------------- */
function serializeLayer(L){
  if(L.kind==="group")return {id:L.id,name:L.name,kind:"group",opacity:L.opacity,blend:L.blend,
    visible:L.visible,locked:L.locked,collapsed:!!L.collapsed,
    children:(L.children||[]).map(serializeLayer)};
  const adjCopy=JSON.parse(JSON.stringify({...L.adj,lutName:L.adj.lutName||""}));
  return {id:L.id,name:L.name,kind:L.kind,opacity:L.opacity,blend:L.blend,
    visible:L.visible,locked:L.locked,clip:!!L.clip,adj:adjCopy,
    text:L.text?{...L.text}:null,shape:L.shape?{...L.shape}:null,
    data:L.canvas?L.canvas.toDataURL("image/png"):null,
    maskData:L.mask?L.mask.toDataURL("image/png"):null};
}
function serialize(){
  return {w:S.docW,h:S.docH,straighten:S.straighten,projectName:S.projectName,
    layers:S.layers.map(serializeLayer)};
}
/* History now lives in app/modules/history.js (EPHistory, pre-edit
   mode): pushUndo() is called BEFORE an edit and records the pre-edit
   state (a checkpoint). Same semantics as the old inline stacks. */
const epHist=EPHistory.create(serialize,function(snap){return restoreSnap(snap);},{limit:25,mode:"pre"});
/* Named history log (Phase 2+3): EPHistory stores snapshots only, so the
   names live here in parallel. pushUndo(name) records the name of the edit
   that is about to happen; undo moves the newest name to the redo list, so
   the History panel can list named actions and jump to any of them. */
let histLog=[], histRedoLog=[];
function clearHistLog(){histLog=[];histRedoLog=[];renderHistory();}
function pushUndo(name){
  if(!S.hasDoc)return;
  epHist.push();
  histLog.push({id:uid(),name:name||"Edit",at:new Date()});
  if(histLog.length>25)histLog.shift();
  histRedoLog.length=0;
  renderHistory();
}
/* FIX 2026-11-12 (History tooltip): history entries restored from storage
   can carry `at` as a string instead of a Date — calling .toLocaleTimeString()
   on a string throws and the whole list fails to render. Coerce defensively
   and never show an undefined name/time. (The literal string "undefined
   minutes" does not exist anywhere in the codebase — grep-verified — so the
   reported tooltip cannot be produced by current code; this hardening makes
   every history tooltip well-formed regardless, and the live re-test must
   confirm the tooltip text.) */
function safeHistTime(at){try{const d=at instanceof Date?at:new Date(at);return isNaN(d.getTime())?"":d.toLocaleTimeString();}catch(e){return"";}}
function renderHistory(){
  const box=$("historyList");if(!box)return;
  /* BUG 3 (2026-11-12): native `title` bubbles are drawn by the OS and
     never appear in headless/automated browsers — and on some systems
     they never fire on list items that are re-created on every edit. So
     the entries ALSO get a small in-page tooltip: it shows the same text
     on hover, positioned above the entry, and is visible in screenshots
     and to every user. The native title stays too (accessibility). */
  if(!box._tipBound){
    box._tipBound=true;
    const tipEl=()=>{let t=$("epTooltip");if(!t){t=document.createElement("div");t.id="epTooltip";t.className="ep-tooltip";t.hidden=true;document.body.appendChild(t);}return t;};
    box.addEventListener("mouseover",e=>{
      const it=e.target&&e.target.closest?e.target.closest(".hist-item"):null;
      if(!it||!it.title)return;
      const el=tipEl();el.textContent=it.title;el.hidden=false;
      try{const r=it.getBoundingClientRect(),tw=el.offsetWidth||260,th=el.offsetHeight||28;
        el.style.left=Math.max(8,Math.min((window.innerWidth||1024)-tw-8,r.left))+"px";
        el.style.top=Math.max(8,r.top-th-6)+"px";}catch(err){}
    });
    box.addEventListener("mouseout",e=>{
      const it=e.target&&e.target.closest?e.target.closest(".hist-item"):null;
      const to=e.relatedTarget&&e.relatedTarget.closest?e.relatedTarget.closest(".hist-item"):null;
      if(it&&it!==to){const el=$("epTooltip");if(el)el.hidden=true;}
    });
    box.addEventListener("mouseleave",()=>{const el=$("epTooltip");if(el)el.hidden=true;});
  }
  if(!histLog.length&&!histRedoLog.length){
    box.innerHTML='<p class="hint">No actions yet. Every edit is recorded here with its name — click an action to jump back to the state before it.</p>';
    return;}
  box.innerHTML="";
  const cur=document.createElement("div");
  cur.className="hist-item current";
  cur.title="Current state — the document as it is now";
  cur.innerHTML='<span class="hname">Current state</span><span class="htime">now</span>';
  box.appendChild(cur);
  histLog.slice().reverse().forEach(e=>{
    const b=document.createElement("button");
    b.className="hist-item";b.dataset.hid=e.id;
    b.title="Jump back to the state before: "+(e.name||"Edit");
    const nm=document.createElement("span");nm.className="hname";nm.textContent=e.name||"Edit";
    const tm=document.createElement("span");tm.className="htime";tm.textContent=safeHistTime(e.at);
    b.appendChild(nm);b.appendChild(tm);
    b.onclick=()=>jumpHistory(e.id);
    box.appendChild(b);});
  histRedoLog.slice().reverse().forEach(e=>{
    const b=document.createElement("button");
    b.className="hist-item redo";b.dataset.hid=e.id;
    b.title="Redo: "+(e.name||"Edit");
    const nm=document.createElement("span");nm.className="hname";nm.textContent="↩ "+(e.name||"Edit");
    const tm=document.createElement("span");tm.className="htime";tm.textContent=safeHistTime(e.at);
    b.appendChild(nm);b.appendChild(tm);
    b.onclick=()=>jumpHistory(e.id);
    box.appendChild(b);});
}
async function jumpHistory(id){
  let guard=0;
  while(guard++<25){
    const i=histLog.findIndex(e=>e.id===id);
    if(i>=0){const steps=histLog.length-i;
      for(let s=0;s<steps;s++)await stepUndo();
      return;}
    const j=histRedoLog.findIndex(e=>e.id===id);
    if(j>=0){const steps=histRedoLog.length-j;
      for(let s=0;s<steps;s++)await stepRedo();
      return;}
    return;
  }
}
function stepUndo(){
  if(!epHist.canUndo())return Promise.resolve(false);
  const e=histLog.pop();if(e)histRedoLog.push(e);
  return epHist.undo().then(ok=>{renderHistory();return ok;});
}
function stepRedo(){
  if(!epHist.canRedo())return Promise.resolve(false);
  const e=histRedoLog.pop();if(e)histLog.push(e);
  return epHist.redo().then(ok=>{renderHistory();return ok;});
}
function restoreSnap(snap){
  return new Promise(resolve=>{
    S.docW=snap.w;S.docH=snap.h;S.straighten=snap.straighten;S.projectName=snap.projectName||S.projectName;
    $("projectName").value=S.projectName;$("straighten").value=S.straighten;
    $("straightenVal").textContent=S.straighten+"°";
    const loadImg=src=>new Promise(res=>{const im=new Image();im.onload=()=>res(im);im.onerror=()=>res(null);im.src=src;});
    const loadLayer=async ld=>{
      const L=newLayer(ld.name,ld.kind);
      Object.assign(L,{id:ld.id,opacity:ld.opacity,blend:ld.blend,visible:ld.visible,
        locked:ld.locked,clip:!!ld.clip,collapsed:!!ld.collapsed,
        adj:{...defaultAdj(),...(ld.adj||{}),levels:{...defaultAdj().levels,...((ld.adj||{}).levels||{})},
          hsl:{...defaultAdj().hsl,...((ld.adj||{}).hsl||{})},
          cb:{sh:[0,0,0],mid:[0,0,0],hi:[0,0,0],...((ld.adj||{}).cb||{})},
          curves:(ld.adj&&ld.adj.curves)||defaultCurves()},
        text:ld.text?{...ld.text}:null,shape:ld.shape?{...ld.shape}:null});
      if(ld.kind==="group"){
        L.children=await Promise.all((ld.children||[]).map(loadLayer));
        return L;}
      if(L.canvas){L.canvas.width=S.docW;L.canvas.height=S.docH;
        if(ld.data){const im=await loadImg(ld.data);
          if(im)canvasCtx(L.canvas).drawImage(im,0,0);}}
      if(ld.maskData){
        const mim=await loadImg(ld.maskData);
        if(mim){L.mask=makeCanvas(S.docW,S.docH);canvasCtx(L.mask).drawImage(mim,0,0);}
      }
      return L;
    };
    Promise.all(snap.layers.map(loadLayer)).then(ls=>{
      S.layers=ls;
      const leaves=allLeaves();
      S.activeId=leaves.length?leaves[leaves.length-1].id:null;
      S.sel=null;S.cropRect=null;S.cloneSrc=null;S.transform=null;S.hasDoc=true;
      $("emptyState").classList.add("hidden");
      $("dropHint").hidden=true; // FIX 2026-11-12 (Issue 2): never leave the drop hint up after a load
      render();renderLayerList();loadAdjPanel();markDirty();resolve();
    });
  });
}
function doUndo(){
  if(!epHist.canUndo()){toast("Nothing to undo");return;}
  stepUndo().then(()=>toast("Undid"));
}
function doRedo(){
  if(!epHist.canRedo()){toast("Nothing to redo");return;}
  stepRedo().then(()=>toast("Redid"));
}

/* ---------------- documents: new / open / add layer ---------------- */
function blankDoc(){
  pushUndo("New blank canvas");
  S.docW=1200;S.docH=800;S.straighten=0;S.layers=[];S.sel=null;S.cropRect=null;S.cloneSrc=null;
  const bg=newLayer("Background","paint");
  const x=canvasCtx(bg.canvas);x.fillStyle="#ffffff";x.fillRect(0,0,1200,800);
  S.layers.push(bg);S.activeId=bg.id;S.hasDoc=true;
  /* FIX 2026-11-12 (Issue 1): a blank doc has NO image, so the empty state
     (with its Open button) must stay visible. The old code hid it here, which
     left first paint with no import button anywhere — drag-drop was the only
     way in. "Start with a blank canvas" / the top-bar Open button dismiss it. */
  $("emptyState").classList.remove("hidden");
  $("dropHint").hidden=true;
  render();renderLayerList();markDirty();fitZoom();
}
function newDocFromImage(img,name){
  epHist.clear();clearHistLog();
  let w=img.naturalWidth,h=img.naturalHeight;
  const MAX=4000;
  if(w>MAX||h>MAX){const s=Math.min(MAX/w,MAX/h);w=Math.round(w*s);h=Math.round(h*s);toast("Image scaled down to "+w+"×"+h+" (4000px cap)");}
  S.docW=w;S.docH=h;S.straighten=0;S.layers=[];S.sel=null;S.cropRect=null;S.cloneSrc=null;
  const L=newLayer(name||"Background","image");
  canvasCtx(L.canvas).drawImage(img,0,0,w,h);
  S.layers.push(L);S.activeId=L.id;S.hasDoc=true;S.projectName=(name||"Untitled Photo").replace(/\.[^.]+$/,"");
  $("projectName").value=S.projectName;
  $("emptyState").classList.add("hidden");
  $("dropHint").hidden=true; // FIX 2026-11-12 (Issue 2)
  render();renderLayerList();fitZoom();
  /* FIX 2026-11-12 (Issue 3): the "Opened" toast must only appear AFTER the
     import is actually persisted — save first, then toast. markDirty() alone
     only scheduled a save up to 20 s away, so a quick reload lost the import. */
  markDirty();
  saveProject(true).then(()=>toast("Opened "+w+"×"+h+" — saved"))
    .catch(()=>toast("Opened "+w+"×"+h+" (save failed — storage blocked)"));
}
function addImageLayer(img,name){
  pushUndo("Add image layer");
  const L=newLayer(name||"Image","image");
  const s=Math.min(1,(S.docW*0.8)/img.naturalWidth,(S.docH*0.8)/img.naturalHeight);
  const w=Math.round(img.naturalWidth*s),h=Math.round(img.naturalHeight*s);
  const x=canvasCtx(L.canvas);
  x.drawImage(img,(S.docW-w)/2,(S.docH-h)/2,w,h);
  S.layers.push(L);S.activeId=L.id;
  $("dropHint").hidden=true; // FIX 2026-11-12 (Issue 2)
  render();renderLayerList();markDirty();
  /* FIX 2026-11-12 (Issue 3): persist before confirming, same as open. */
  saveProject(true).then(()=>toast("Added as new layer: "+(name||"image")+" — saved"))
    .catch(()=>toast("Added as new layer: "+(name||"image")+" (save failed — storage blocked)"));
}
function loadImageFile(file){
  if(!file)return;
  if(!/^image\//.test(file.type)&&!/\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name)){
    toast("Not an image file — JPG, PNG, WebP, GIF or BMP only");return;}
  const url=URL.createObjectURL(file);
  const img=new Image();
  img.onload=()=>{
    URL.revokeObjectURL(url);
    /* FIX 2026-11-12 (Issue 1): a blank doc has no image layer, so open the
       file straight into a new document instead of asking Replace/Layer
       against an empty white canvas. (Old test `!S.hasDoc` never fired —
       blankDoc() sets hasDoc=true at startup.) */
    if(!hasImageLayer()){newDocFromImage(img,file.name);return;}
    S.pendingFile={img:img,name:file.name};
    $("importModalText").textContent="“"+file.name+"” ("+img.naturalWidth+"×"+img.naturalHeight+"). Replace the current image, or add it as a new layer on top?";
    showModal("importModal");
  };
  img.onerror=()=>{URL.revokeObjectURL(url);toast("Could not read that image file");};
  img.src=url;
}

/* ---------------- canvas transforms (real pixel ops) ---------------- */
function shiftCanvas(c,dx,dy){
  const t=makeCanvas(c.width,c.height);
  t.getContext("2d").drawImage(c,dx,dy);
  const x=canvasCtx(c);x.clearRect(0,0,c.width,c.height);x.drawImage(t,0,0);
}
function rotateCanvas90(c,dir){
  const t=makeCanvas(c.height,c.width),x=t.getContext("2d");
  x.translate(t.width/2,t.height/2);x.rotate(dir*Math.PI/2);x.drawImage(c,-c.width/2,-c.height/2);
  c.width=t.width;c.height=t.height;
  const cx=canvasCtx(c);cx.clearRect(0,0,c.width,c.height);cx.drawImage(t,0,0);
}
function flipCanvas(c,horiz){
  const t=makeCanvas(c.width,c.height),x=t.getContext("2d");
  x.translate(horiz?c.width:0, horiz?0:c.height);x.scale(horiz?-1:1,horiz?1:-1);x.drawImage(c,0,0);
  const cx=canvasCtx(c);cx.clearRect(0,0,c.width,c.height);cx.drawImage(t,0,0);
}
function doRotate(dir){
  if(!S.hasDoc)return;pushUndo("Rotate 90°");
  for(const L of allLeaves()){if(!L.canvas)continue;rotateCanvas90(L.canvas,dir);if(L.mask)rotateCanvas90(L.mask,dir);
    if(L.kind==="text"&&L.text){
      const ox=L.text.x,oy=L.text.y;
      if(dir===1){L.text.x=S.docH-oy;L.text.y=ox;}       // clockwise: (x,y)->(H-y, x)
      else{L.text.x=oy;L.text.y=S.docW-ox;}              // counter-clockwise: (x,y)->(y, W-x)
    }
    if(L.kind==="shape"&&L.shape){const s=L.shape,ox=s.x,oy=s.y;
      if(dir===1){s.x=S.docH-(oy+s.h);s.y=ox;}
      else{s.x=oy;s.y=S.docW-(ox+s.w);}
      const tmp=s.w;s.w=s.h;s.h=tmp;}
    invalidateAdj(L);}
  const tmp=S.docW;S.docW=S.docH;S.docH=tmp;
  render();renderLayerList();markDirty();fitZoom();toast("Rotated 90°");
}
function doFlip(horiz){
  if(!S.hasDoc)return;pushUndo("Flip");
  for(const L of allLeaves()){if(!L.canvas)continue;flipCanvas(L.canvas,horiz);if(L.mask)flipCanvas(L.mask,horiz);
    if(L.kind==="text"&&L.text)L.text.x=S.docW-L.text.x;
    if(L.kind==="shape"&&L.shape)L.shape.x=S.docW-(L.shape.x+L.shape.w);
    invalidateAdj(L);}
  render();markDirty();toast(horiz?"Flipped horizontally":"Flipped vertically");
}
function applyCropRect(r){
  r={x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.w),h:Math.round(r.h)};
  r.x=clamp(r.x,0,S.docW-1);r.y=clamp(r.y,0,S.docH-1);
  r.w=clamp(r.w,1,S.docW-r.x);r.h=clamp(r.h,1,S.docH-r.y);
  pushUndo("Crop");
  for(const L of allLeaves()){
    if(!L.canvas)continue;
    const cropOne=c=>{const t=makeCanvas(r.w,r.h);t.getContext("2d").drawImage(c,r.x,r.y,r.w,r.h,0,0,r.w,r.h);
      c.width=r.w;c.height=r.h;canvasCtx(c).drawImage(t,0,0);};
    cropOne(L.canvas);if(L.mask)cropOne(L.mask);
    if(L.kind==="text"&&L.text){L.text.x-=r.x;L.text.y-=r.y;rasterizeTextLayer(L);}
    if(L.kind==="shape"&&L.shape){L.shape.x-=r.x;L.shape.y-=r.y;rasterizeShapeLayer(L);}
    invalidateAdj(L);}
  S.docW=r.w;S.docH=r.h;S.sel=null;S.cropRect=null;
  render();renderLayerList();markDirty();fitZoom();toast("Cropped to "+r.w+"×"+r.h);
}
function applyResize(w,h){
  w=clamp(Math.round(w)||S.docW,1,8000);h=clamp(Math.round(h)||S.docH,1,8000);
  if(w===S.docW&&h===S.docH)return;
  pushUndo("Resize image");
  for(const L of allLeaves()){
    if(!L.canvas)continue;
    const scaleOne=c=>{const t=makeCanvas(w,h);t.getContext("2d").drawImage(c,0,0,w,h);
      c.width=w;c.height=h;canvasCtx(c).drawImage(t,0,0);};
    scaleOne(L.canvas);if(L.mask)scaleOne(L.mask);
    if(L.kind==="text"&&L.text){L.text.x*=w/S.docW;L.text.y*=h/S.docH;L.text.size*=Math.min(w/S.docW,h/S.docH);rasterizeTextLayer(L);}
    if(L.kind==="shape"&&L.shape){const s=L.shape;s.x*=w/S.docW;s.y*=h/S.docH;s.w*=w/S.docW;s.h*=h/S.docH;rasterizeShapeLayer(L);}
    invalidateAdj(L);}
  S.docW=w;S.docH=h;S.sel=null;S.cropRect=null;
  render();renderLayerList();markDirty();fitZoom();toast("Resized to "+w+"×"+h);
}
function applyStraighten(){
  const deg=S.straighten;if(!deg||!S.hasDoc){toast("Straighten angle is 0°");return;}
  pushUndo("Straighten");
  const rad=Math.abs(deg)*Math.PI/180;
  const nw=Math.round(S.docW*Math.cos(rad)+S.docH*Math.sin(rad));
  const nh=Math.round(S.docW*Math.sin(rad)+S.docH*Math.cos(rad));
  for(const L of allLeaves()){
    if(!L.canvas)continue;
    const rotOne=c=>{const t=makeCanvas(nw,nh),x=t.getContext("2d");
      x.translate(nw/2,nh/2);x.rotate(deg*Math.PI/180);x.drawImage(c,-S.docW/2,-S.docH/2);
      c.width=nw;c.height=nh;canvasCtx(c).drawImage(t,0,0);};
    rotOne(L.canvas);if(L.mask)rotOne(L.mask);
    if(L.kind==="text"&&L.text){const cx=L.text.x-S.docW/2,cy=L.text.y-S.docH/2;
      const r2=deg*Math.PI/180;L.text.x=nw/2+cx*Math.cos(r2)-cy*Math.sin(r2);L.text.y=nh/2+cx*Math.sin(r2)+cy*Math.cos(r2);rasterizeTextLayer(L);}
    if(L.kind==="shape"&&L.shape){const s=L.shape;const cx=s.x+s.w/2-S.docW/2,cy=s.y+s.h/2-S.docH/2;
      const r2=deg*Math.PI/180;const nx=nw/2+cx*Math.cos(r2)-cy*Math.sin(r2),ny=nh/2+cx*Math.sin(r2)+cy*Math.cos(r2);
      s.x=nx-s.w/2;s.y=ny-s.h/2;rasterizeShapeLayer(L);}
    invalidateAdj(L);}
  S.docW=nw;S.docH=nh;S.straighten=0;$("straighten").value=0;$("straightenVal").textContent="0°";
  render();renderLayerList();markDirty();fitZoom();toast("Straighten applied");
}

/* ---------------- zoom ---------------- */
function applyZoom(){
  const cv=$("photoCanvas");
  cv.style.width=Math.round(S.docW*S.zoom)+"px";
  cv.style.height=Math.round(S.docH*S.zoom)+"px";
  /* Rotate View (view only — the document pixels are untouched): rotate the
     canvas element itself. Painting tools still map to the unrotated canvas,
     so rotate back to 0° before painting. */
  cv.style.transformOrigin="center center";
  cv.style.transform=S.viewRot?`rotate(${S.viewRot*90}deg)`:"";
  $("zoomRange").value=Math.round(S.zoom*100);
  $("zoomLabel").textContent=Math.round(S.zoom*100)+"%";
  const sz=$("statusZoom");if(sz)sz.textContent=Math.round(S.zoom*100)+"%";
}
function fitZoom(){
  const stage=$("photoStage");
  const availW=stage.clientWidth-36,availH=stage.clientHeight-36;
  if(availW<=0||availH<=0)return;
  /* a 90°/270° view rotation swaps the visible width/height */
  const ew=(S.viewRot%2)?S.docH:S.docW, eh=(S.viewRot%2)?S.docW:S.docH;
  S.zoom=clamp(Math.min(availW/ew,availH/eh),0.05,4);
  applyZoom();
}

/* ---------------- painting: brush / eraser / clone / healing / bucket ---------------- */
function paintTarget(){
  const L=activeLayer();if(!L)return null;
  if(S.editMask){
    if(!L.mask)return null;
    return {canvas:L.mask,isMask:true,layer:L};
  }
  return {canvas:L.canvas,isMask:false,layer:L};
}
/* FIX 2026-11-12 (Bug 1, root cause): filters are non-destructive per-layer
   adjustments, applied to the WHOLE layer at render time (adjCanvasOf) — so
   a B&W filter left on a layer from a previous session desaturates every
   NEW brush stroke on that layer too: the user picks pink and sees grey,
   with nothing in the UI saying why. A colour-depositing stroke therefore
   never paints directly onto an adjusted layer: it gets a fresh paint layer
   directly above it, where the chosen colour survives exactly. Clone/heal/
   blur and the other pixel-transforming tools are unaffected — they work on
   the layer's own pixels and stay where they are. */
function ensurePaintLayerForColour(){
  if(S.editMask)return;
  const tgt=paintTarget();if(!tgt||!tgt.layer||!tgt.layer.canvas)return;
  if(isIdentityAdj(tgt.layer.adj))return;
  const nl=newLayer("Brush","paint");
  const list=parentListOf(tgt.layer.id);
  const ix=list?list.findIndex(l=>l.id===tgt.layer.id):-1;
  if(ix>=0)list.splice(ix+1,0,nl);else S.layers.push(nl);
  S.activeId=nl.id;renderLayerList();
  toast("Painted on a new layer above the filter — your colour stays true");
}
function transparentOf(color){
  // transparent version of the SAME colour — fading a gradient to
  // transparent black (rgba(0,0,0,0)) pulls the edge toward grey, so every
  // brush stamp used to carry a muddy grey fringe (Bug 1, 2026-11-12).
  if(typeof color==="string"&&/^#[0-9a-fA-F]{6}$/.test(color)){
    const [r,g,b]=hexToRgb(color);return "rgba("+r+","+g+","+b+",0)";}
  return "rgba(0,0,0,0)";
}
function stamp(ctx,x,y,size,color,opacity,hardness,mode){
  const r=size/2;if(r<0.5)return;
  const g=ctx.createRadialGradient(x,y,0,x,y,r);
  const hard=clamp(hardness/100,0,1);
  const inner=hard<1?hard:1;
  g.addColorStop(0,color);
  g.addColorStop(inner,color);
  g.addColorStop(1,transparentOf(color));
  ctx.save();ctx.globalCompositeOperation=mode;ctx.globalAlpha=opacity;
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.restore();
}
function paintLine(target,x0,y0,x1,y1){
  const ctx=canvasCtx(target.canvas);
  const mode=S.editMask?"source-over":(S.tool==="eraser"?"destination-out":"source-over");
  const color=S.editMask?$("maskPaint").value:S.brush.color;
  const size=S.brush.size,op=S.brush.opacity/100,hard=S.brush.hardness;
  // FIX 2026-11-12 (Bug 1): Flow was ignored — every stamp painted at full
  // opacity whatever the Flow slider said. A stamp deposits
  // opacity × flow; overlapping stamps build up toward full opacity.
  const flow=(S.brush.flow==null?100:S.brush.flow)/100,alpha=op*flow;
  const dist=Math.hypot(x1-x0,y1-y0),step=Math.max(1,size*((S.brush.spacing==null?25:S.brush.spacing)/100));
  const n=Math.max(1,Math.ceil(dist/step));
  for(let i=0;i<=n;i++){
    const t=i/n;stamp(ctx,x0+(x1-x0)*t,y0+(y1-y0)*t,size,color,alpha,hard,mode);
  }
  target.layer.version++;invalidateAdj(target.layer);
}
function cloneStampAt(target,dx,dy){
  if(!S.cloneOffset)return;
  const L=target.layer,src=L.canvas;
  const sx=dx+S.cloneOffset.x, sy=dy+S.cloneOffset.y, r=S.brush.size/2;
  const ctx=canvasCtx(target.canvas);
  if(S.tool==="healing"){
    // feathered clone: copy the source patch, soften its edge with a radial gradient mask
    const patch=makeCanvas(S.brush.size,S.brush.size),px=patch.getContext("2d");
    px.drawImage(src,sx-r,sy-r,S.brush.size,S.brush.size,0,0,S.brush.size,S.brush.size);
    px.globalCompositeOperation="destination-in";
    const g=px.createRadialGradient(r,r,0,r,r,r);
    g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(0.6,"rgba(255,255,255,0.9)");g.addColorStop(1,"rgba(255,255,255,0)");
    px.fillStyle=g;px.fillRect(0,0,S.brush.size,S.brush.size);
    ctx.save();ctx.globalAlpha=S.brush.opacity/100;ctx.drawImage(patch,dx-r,dy-r);ctx.restore();
  }else{
    ctx.save();ctx.globalAlpha=S.brush.opacity/100;
    ctx.drawImage(src,sx-r,sy-r,S.brush.size,S.brush.size,dx-r,dy-r,S.brush.size,S.brush.size);
    ctx.restore();
  }
  L.version++;invalidateAdj(L);
}
function hexToRgb(hex){return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];}
function floodFill(target,sx,sy,tolerance){
  const c=target.canvas,w=c.width,h=c.height;
  const ctx=canvasCtx(c),img=ctx.getImageData(0,0,w,h),d=img.data;
  sx=clamp(Math.round(sx),0,w-1);sy=clamp(Math.round(sy),0,h-1);
  const si=(sy*w+sx)*4,tr=d[si],tg=d[si+1],tb=d[si+2],ta=d[si+3];
  const [fr,fg,fb]=hexToRgb(S.brush.color);
  if(tr===fr&&tg===fg&&tb===fb&&ta===255)return;
  const tol=tolerance/100*255;
  const match=i=>Math.abs(d[i]-tr)<=tol&&Math.abs(d[i+1]-tg)<=tol&&Math.abs(d[i+2]-tb)<=tol&&Math.abs(d[i+3]-ta)<=tol;
  const seen=new Uint8Array(w*h),stack=[[sx,sy]];
  while(stack.length){
    const [cx,cy]=stack.pop();
    if(cx<0||cy<0||cx>=w||cy>=h)continue;
    const k=cy*w+cx;if(seen[k])continue;seen[k]=1;
    const j=k*4;if(!match(j))continue;
    d[j]=fr;d[j+1]=fg;d[j+2]=fb;d[j+3]=255;
    stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
  }
  ctx.putImageData(img,0,0);
  target.layer.version++;invalidateAdj(target.layer);
}

/* ---------------- pointer handling ---------------- */
function toDoc(e){
  const cv=$("photoCanvas"),r=cv.getBoundingClientRect();
  let x=(e.clientX-r.left)*S.docW/r.width, y=(e.clientY-r.top)*S.docH/r.height;
  if(S.straighten){ // inverse-rotate into unrotated layer space
    const rad=-S.straighten*Math.PI/180,cx=S.docW/2,cy=S.docH/2;
    const dx=x-cx,dy=y-cy;
    x=cx+dx*Math.cos(rad)-dy*Math.sin(rad);
    y=cy+dx*Math.sin(rad)+dy*Math.cos(rad);
  }
  return {x:x,y:y};
}
function hitLayer(p){
  const leaves=allLeaves();
  for(let i=leaves.length-1;i>=0;i--){
    const L=leaves[i];
    if(!L.visible||L.locked||!L.canvas)continue;
    const b=layerBounds(L);
    if(b&&(p.x<b.x-6||p.x>b.x+b.w+6||p.y<b.y-6||p.y>b.y+b.h+6))continue;
    const ix=clamp(Math.round(p.x),0,S.docW-1),iy=clamp(Math.round(p.y),0,S.docH-1);
    const a=canvasCtx(L.canvas).getImageData(ix,iy,1,1).data[3];
    if(a>10)return L;
  }
  return null;
}
function rasterizeIfVector(L){
  // once painted on, a text/shape layer becomes a plain paint layer so strokes survive edits
  if(L.kind==="text"||L.kind==="shape"){L.kind="paint";L.text=null;L.shape=null;toast("Layer rasterized — text/shape is now pixels");}
}
function bindCanvas(){
  const cv=$("photoCanvas");
  cv.addEventListener("pointerdown",e=>{
    if(!S.hasDoc)return;
    /* FIX 2026-11-12 (Issue 1): clicking the empty canvas opens the file
       picker. (In practice the empty-state overlay covers the canvas while
       no image is open, and its own click handler does the same — this is
       the belt-and-braces path for any state where the overlay is hidden
       but no image layer exists yet.) */
    if(!hasImageLayer()&&!$("emptyState").classList.contains("hidden")){
      $("photoFileInput").click();return;
    }
    e.preventDefault();try{cv.setPointerCapture(e.pointerId);}catch(_){/* no pointer capture (older engine) — drag still works via window pointer events */}
    if(!S.pointers)S.pointers=new Map();
    S.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(S.pointers.size===2){
      // second finger down: cancel any single-pointer gesture, start pinch zoom + two-finger pan
      S.painting=false;S.moving=null;S.lassoPath=null;
      if(S.longPressTimer){clearTimeout(S.longPressTimer);S.longPressTimer=null;}
      const pts=[...S.pointers.values()];
      const st=$("photoStage");
      S.pinch={d0:Math.max(1,Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)),
        z0:S.zoom,mid0:{x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2},
        sl0:st.scrollLeft,st0:st.scrollTop};
      return;
    }
    const p=toDoc(e);
    // long-press on touch = clone source sampling
    if((S.tool==="clone"||S.tool==="healing")&&e.pointerType==="touch"){
      S.longPressPt=p;
      S.longPressTimer=setTimeout(()=>{S.cloneSrc={...p};S.cloneOffset=null;
        $("cloneStatus").textContent="Source set at "+Math.round(p.x)+", "+Math.round(p.y)+" — now paint to clone.";
        updateStatus();render();},600);
    }
    if((S.tool==="clone"||S.tool==="healing")&&e.altKey){
      S.cloneSrc={...p};S.cloneOffset=null;
      $("cloneStatus").textContent="Source set at "+Math.round(p.x)+", "+Math.round(p.y)+" — now paint to clone.";
      updateStatus();render();return;
    }
    const L=activeLayer();
    if(S.tool==="picker"){
      const ix=clamp(Math.round(p.x),0,S.docW-1),iy=clamp(Math.round(p.y),0,S.docH-1);
      const d=canvasCtx(compCanvas).getImageData(ix,iy,1,1).data;
      const hex="#"+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,"0")).join("");
      if(S.pickingSelColor){ // selective-color pick (from the Retouch panel)
        S.pickingSelColor=false;S.selColor=hex;
        const sw=$("selColorSwatch");sw.textContent=hex;sw.style.background=hex;
        setTool("move");toast("Selective color set to "+hex+" — adjust hue/saturation/lightness, then Apply");return;}
      S.brush.color=hex;$("brushColor").value=hex;
      $("textColor").value=hex;$("shapeFill").value=hex;
      toast("Picked "+hex);return;
    }
    if(S.tool==="bucket"){
      if(!L||L.locked){toast("Select an unlocked layer first");return;}
      pushUndo("Flood fill");
      // bucket deposits colour too — same rule as the brush (Bug 1)
      ensurePaintLayerForColour();
      floodFill(paintTarget()||{canvas:L.canvas,layer:L},p.x,p.y,+$("bucketTolerance").value);
      render();markDirty();return;
    }
    if(S.tool==="transform"||S.tool==="perspective"){
      if(!S.transform)startTransform(S.tool);
      if(S.transform){
        const h=transformHandleAt(p);
        if(h){S.moving={kind:"transform",handle:h,start:p,origQuad:S.transform.quad.map(q=>({...q}))};render();return;}
      }
      return;
    }
    if(S.tool==="ellipsesel"){
      S.moving={kind:"ellipsesel",start:p};S.sel={type:"ellipse",rect:{x:p.x,y:p.y,w:0,h:0},feather:+$("selFeather").value,inverted:false,expand:0,contract:0};
      render();return;
    }
    if(S.tool==="polylasso"){
      // tap-to-place vertices (touch-friendly); double-tap / Enter closes
      if(!S.polyPath)S.polyPath=[];
      S.polyPath.push(p);render();return;
    }
    if(S.tool==="quicksel"){
      const tol=+$("selTolerance").value;
      const prev=(S.sel&&S.sel.type==="mask")?S.sel.mask:null;
      const mask=regionGrowMask(p.x,p.y,tol,prev);
      S.sel={type:"mask",mask:mask,feather:+$("selFeather").value,inverted:false,expand:0,contract:0};
      S.moving={kind:"quicksel"};render();return;
    }
    if(S.tool==="wand"){
      const mask=regionGrowMask(p.x,p.y,+$("selTolerance").value,null);
      S.sel={type:"mask",mask:mask,feather:+$("selFeather").value,inverted:false,expand:0,contract:0};
      render();toast("Wand selection made — use the Selection panel");return;
    }
    if(S.tool==="colorrange"){
      const ix=clamp(Math.round(p.x),0,S.docW-1),iy=clamp(Math.round(p.y),0,S.docH-1);
      const d=canvasCtx(compCanvas).getImageData(ix,iy,1,1).data;
      const hex="#"+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,"0")).join("");
      const mask=colorRangeMask(hex,+$("selTolerance").value);
      S.sel={type:"mask",mask:mask,feather:+$("selFeather").value,inverted:false,expand:0,contract:0};
      S.brush.color=hex;$("brushColor").value=hex;
      render();toast("Color range selected: "+hex);return;
    }
    if(S.tool==="spotheal"){
      if(!L||L.locked){toast("Select an unlocked layer first");return;}
      if(S.editMask){toast("Spot healing paints on the image, not the mask");return;}
      pushUndo("Spot healing");if(!S.editMask)rasterizeIfVector(L);
      spotHealAt(paintTarget()||{canvas:L.canvas,layer:L},p.x,p.y);
      render();markDirty();return;
    }
    if(S.tool==="redeye"){
      if(!L||L.locked){toast("Select an unlocked layer first");return;}
      pushUndo("Red-eye correction");if(!S.editMask)rasterizeIfVector(L);
      redEyeAt(paintTarget()||{canvas:L.canvas,layer:L},p.x,p.y);
      render();markDirty();toast("Red-eye corrected at that spot");return;
    }
    if(S.tool==="hand"){
      S.moving={kind:"hand",last:{x:e.clientX,y:e.clientY}};return;
    }
    if(S.tool==="zoom"){
      S.moving={kind:"zoom",start:p};S.zoomRect=null;return;
    }
    if(S.tool==="gradient"){
      S.moving={kind:"gradient",start:p};S.gradPreview={x0:p.x,y0:p.y,x1:p.x,y1:p.y};render();return;
    }
    if(S.tool==="crop"){
      if(S.cropRect){const h=cropHandleAt(p);
        if(h){S.moving={kind:"cropresize",handle:h,origRect:{...S.cropRect}};render();return;}}
      S.moving={kind:"crop",start:p};S.cropRect={x:p.x,y:p.y,w:0,h:0};render();return;
    }
    if(S.tool==="rectsel"){
      S.moving={kind:"rectsel",start:p};S.sel={type:"rect",rect:{x:p.x,y:p.y,w:0,h:0},feather:+$("selFeather").value,inverted:false};
      render();return;
    }
    if(S.tool==="lasso"){
      S.moving={kind:"lasso"};S.lassoPath=[p];S.sel=null;render();return;
    }
    if(S.tool==="text"){
      const hit=hitLayer(p);
      if(hit&&hit.kind==="text"){selectLayer(hit.id);return;}
      addTextLayerAt(p.x,p.y);return;
    }
    if(S.tool==="shape"){
      S.moving={kind:"shape",start:p};S.shapePreview={kind:$("shapeKind").value,x:p.x,y:p.y,w:0,h:0};render();return;
    }
    if(S.tool==="brush"||S.tool==="pencil"||S.tool==="airbrush"||S.tool==="eraser"||
       S.tool==="clone"||S.tool==="healing"||S.tool==="blurbrush"||S.tool==="sharpenbrush"||
       S.tool==="smudge"||S.tool==="dodge"||S.tool==="burn"||S.tool==="sponge"||
       S.tool==="whiten"||S.tool==="smoothbrush"||S.tool==="localexp"){
      if(S.tool==="clone"||S.tool==="healing"){
        if(!S.cloneSrc){toast("Alt-click (or long-press) to set a clone source first");return;}
        if(!S.cloneOffset)S.cloneOffset={x:S.cloneSrc.x-p.x,y:S.cloneSrc.y-p.y};
      }
      if(!L||L.locked){toast("Select an unlocked layer first");return;}
      if(S.editMask&&!L.mask){toast("This layer has no mask — add one first");return;}
      if(S.editMask&&(S.tool==="blurbrush"||S.tool==="sharpenbrush"||S.tool==="smudge"||
        S.tool==="dodge"||S.tool==="burn"||S.tool==="sponge"||S.tool==="whiten"||
        S.tool==="smoothbrush"||S.tool==="localexp")){
        toast("That brush works on the image, not on a mask — switch off mask editing first");return;}
      pushUndo(toolName(S.tool)+" stroke");
      if(!S.editMask)rasterizeIfVector(L);
      // colour-depositing tools never paint onto an adjusted layer (Bug 1):
      // the adjustment would desaturate the new stroke — paint above it.
      if(S.tool==="brush"||S.tool==="pencil"||S.tool==="airbrush")ensurePaintLayerForColour();
      S.painting=true;S.lastPt=p;
      const tgt=paintTarget();if(!tgt)return;
      strokeAt(tgt,p.x,p.y,p.x,p.y);
      render();markDirty();return;
    }
    // move tool: pick + drag a layer
    const hit=hitLayer(p);
    if(hit){selectLayer(hit.id);S.moving={kind:"move",layer:hit,last:p};}
    else{S.moving=null;selectLayer(null);renderLayerList();}
  });
  cv.addEventListener("pointermove",e=>{
    if(!S.hasDoc)return;
    const p=toDoc(e);
    if(S.pointers&&S.pointers.has(e.pointerId))S.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(S.pinch&&S.pointers&&S.pointers.size>=2){
      // pinch zoom + two-finger pan (mobile)
      const pts=[...S.pointers.values()];
      const d=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      if(d>10){S.zoom=clamp(S.pinch.z0*d/S.pinch.d0,0.05,4);applyZoom();}
      const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
      const st=$("photoStage");
      st.scrollLeft=S.pinch.sl0-(mid.x-S.pinch.mid0.x);
      st.scrollTop=S.pinch.st0-(mid.y-S.pinch.mid0.y);
      return;
    }
    if(S.longPressTimer&&S.longPressPt&&Math.hypot(p.x-S.longPressPt.x,p.y-S.longPressPt.y)>12){
      clearTimeout(S.longPressTimer);S.longPressTimer=null;}
    if(S.moving&&S.moving.kind==="hand"){
      const st=$("photoStage");
      st.scrollLeft-=e.clientX-S.moving.last.x;st.scrollTop-=e.clientY-S.moving.last.y;
      S.moving.last={x:e.clientX,y:e.clientY};return;}
    if(S.moving&&S.moving.kind==="cropresize"){
      const mv=S.moving,o=mv.origRect,h=mv.handle;
      let x0=o.x,y0=o.y,x1=o.x+o.w,y1=o.y+o.h;
      if(h.indexOf("w")>=0)x0=p.x; if(h.indexOf("e")>=0)x1=p.x;
      if(h.indexOf("n")>=0)y0=p.y; if(h.indexOf("s")>=0)y1=p.y;
      let r={x:Math.min(x0,x1),y:Math.min(y0,y1),w:Math.abs(x1-x0),h:Math.abs(y1-y0)};
      r=constrainRatio(r,S.cropRatio,true);
      S.cropRect=r;render();return;}
    if(S.moving&&S.moving.kind==="gradient"){
      S.gradPreview={x0:S.moving.start.x,y0:S.moving.start.y,x1:p.x,y1:p.y};render();return;}
    if(S.moving&&S.moving.kind==="zoom"){
      S.zoomRect={x:Math.min(S.moving.start.x,p.x),y:Math.min(S.moving.start.y,p.y),
        w:Math.abs(p.x-S.moving.start.x),h:Math.abs(p.y-S.moving.start.y)};render();return;}
    if(S.painting&&S.lastPt){
      const tgt=paintTarget();if(!tgt)return;
      strokeAt(tgt,S.lastPt.x,S.lastPt.y,p.x,p.y);
      S.lastPt=p;render();return;
    }
    const mv=S.moving;if(!mv)return;
    if(mv.kind==="transform"&&S.transform){
      const T=S.transform,h=mv.handle,dx=p.x-mv.start.x,dy=p.y-mv.start.y;
      const q=T.quad;
      if(h.kind==="corner"){q[h.i].x=mv.origQuad[h.i].x+dx;q[h.i].y=mv.origQuad[h.i].y+dy;}
      else if(h.kind==="shearH"){ // top/bottom edge: shift x by drag, scaled by distance from centre
        const s=dx*0.5;q[0].x=mv.origQuad[0].x+s;q[1].x=mv.origQuad[1].x+s;
        q[2].x=mv.origQuad[2].x-s;q[3].x=mv.origQuad[3].x-s;}
      else if(h.kind==="shearV"){
        const s=dy*0.5;q[0].y=mv.origQuad[0].y+s;q[3].y=mv.origQuad[3].y+s;
        q[1].y=mv.origQuad[1].y-s;q[2].y=mv.origQuad[2].y-s;}
      else if(h.kind==="rotate"){
        const cx=(mv.origQuad[0].x+mv.origQuad[2].x)/2,cy=(mv.origQuad[0].y+mv.origQuad[2].y)/2;
        const a0=Math.atan2(mv.start.y-cy,mv.start.x-cx),a1=Math.atan2(p.y-cy,p.x-cx);
        const da=a1-a0;
        for(let i=0;i<4;i++){
          const ox=mv.origQuad[i].x-cx,oy=mv.origQuad[i].y-cy;
          q[i].x=cx+ox*Math.cos(da)-oy*Math.sin(da);
          q[i].y=cy+ox*Math.sin(da)+oy*Math.cos(da);}}
      render();return;
    }
    if(mv.kind==="quicksel"){
      const tol=+$("selTolerance").value;
      const prev=(S.sel&&S.sel.type==="mask")?S.sel.mask:null;
      const mask=regionGrowMask(p.x,p.y,tol,prev);
      S.sel={type:"mask",mask:mask,feather:+$("selFeather").value,inverted:false,expand:0,contract:0};
      render();return;
    }
    if(mv.kind==="crop"||mv.kind==="rectsel"||mv.kind==="ellipsesel"){
      let r={x:Math.min(mv.start.x,p.x),y:Math.min(mv.start.y,p.y),w:Math.abs(p.x-mv.start.x),h:Math.abs(p.y-mv.start.y)};
      r=constrainRatio(r,S.cropRatio,mv.kind==="crop");
      if(mv.kind==="crop")S.cropRect=r;else S.sel.rect=r;
      render();return;
    }
    if(mv.kind==="lasso"){S.lassoPath.push(p);render();return;}
    if(mv.kind==="shape"){
      S.shapePreview={kind:$("shapeKind").value,x:Math.min(mv.start.x,p.x),y:Math.min(mv.start.y,p.y),
        w:Math.abs(p.x-mv.start.x),h:Math.abs(p.y-mv.start.y)};render();return;
    }
    if(mv.kind==="move"&&mv.layer){
      const L=mv.layer,dx=p.x-mv.last.x,dy=p.y-mv.last.y;
      mv.last=p;
      if(L.kind==="text"&&L.text){L.text.x+=dx;L.text.y+=dy;rasterizeTextLayer(L);}
      else if(L.kind==="shape"&&L.shape){L.shape.x+=dx;L.shape.y+=dy;rasterizeShapeLayer(L);}
      else{shiftCanvas(L.canvas,Math.round(dx),Math.round(dy));if(L.mask)shiftCanvas(L.mask,Math.round(dx),Math.round(dy));invalidateAdj(L);}
      render();markDirty();return;
    }
  });
  const up=e=>{
    if(S.pointers)S.pointers.delete(e.pointerId);
    if(!S.pointers||S.pointers.size<2)S.pinch=null;
    if(S.longPressTimer){clearTimeout(S.longPressTimer);S.longPressTimer=null;}
    if(S.painting){S.painting=false;S.lastPt=null;render();renderLayerList();return;}
    const mv=S.moving;S.moving=null;if(!mv)return;
    if(mv.kind==="gradient"){
      const g=S.gradPreview;S.gradPreview=null;
      if(g&&Math.hypot(g.x1-g.x0,g.y1-g.y0)>8)applyGradient(g);
      render();return;}
    if(mv.kind==="zoom"){
      const r=S.zoomRect;S.zoomRect=null;
      if(r&&r.w>20&&r.h>20){
        const st=$("photoStage");
        S.zoom=clamp(Math.min((st.clientWidth-40)/r.w,(st.clientHeight-40)/r.h),0.05,4);
        applyZoom();
        const cxp=18+(r.x+r.w/2)*S.zoom, cyp=18+(r.y+r.h/2)*S.zoom;
        st.scrollLeft=cxp-st.clientWidth/2;st.scrollTop=cyp-st.clientHeight/2;
      }else{
        S.zoom=clamp(S.zoom*(e.altKey?1/1.5:1.5),0.05,4);applyZoom();
      }
      render();return;}
    if(mv.kind==="cropresize"){render();return;}
    if(mv.kind==="lasso"&&S.lassoPath&&S.lassoPath.length>2){
      S.sel={type:"lasso",path:S.lassoPath.slice(),feather:+$("selFeather").value,inverted:false};
      S.lassoPath=null;toast("Lasso selection made — use the Selection panel");render();return;
    }
    if(mv.kind==="shape"&&S.shapePreview){
      const pv=S.shapePreview;S.shapePreview=null;
      if(pv.w>4&&pv.h>4||(pv.kind==="line"||pv.kind==="arrow")&&(pv.w>4||pv.h>4)){
        pushUndo("Add shape");addShapeLayer(pv);
      }
      render();return;
    }
    if(mv.kind==="crop"||mv.kind==="rectsel"){render();return;}
  };
  cv.addEventListener("pointerup",up);
  cv.addEventListener("pointercancel",up);
  cv.addEventListener("dblclick",e=>{
    if(!S.hasDoc)return;
    const p=toDoc(e);
    if(S.tool==="polylasso"&&S.polyPath&&S.polyPath.length>2){
      closePolyLasso();return;}
    const L=hitLayer(p);
    if(L&&L.kind==="text"&&L.text){
      selectLayer(L.id);
      const t=prompt("Edit text:",L.text.str);
      if(t!==null){pushUndo("Edit text");L.text.str=t;$("textInput").value=t;rasterizeTextLayer(L);render();markDirty();}
    }
  });
}
function closePolyLasso(){
  if(!S.polyPath||S.polyPath.length<3){S.polyPath=null;return;}
  S.sel={type:"poly",path:S.polyPath.slice(),feather:+$("selFeather").value,inverted:false,expand:0,contract:0};
  S.polyPath=null;render();toast("Polygon selection closed — use the Selection panel");
}
function cropHandleAt(p){
  // hit-test the crop rectangle's corner/edge handles (radius in doc units)
  if(!S.cropRect)return null;
  const r=S.cropRect,hr=clamp(14/S.zoom,6,28);
  const xs=[{v:r.x,k:"w"},{v:r.x+r.w/2,k:""},{v:r.x+r.w,k:"e"}];
  const ys=[{v:r.y,k:"n"},{v:r.y+r.h/2,k:""},{v:r.y+r.h,k:"s"}];
  for(const X of xs)for(const Y of ys){
    if(!X.k&&!Y.k)continue;
    if(Math.abs(p.x-X.v)<=hr&&Math.abs(p.y-Y.v)<=hr)return (Y.k+X.k)||null;}
  return null;
}
function applyGradient(g){
  // real gradient layer (or selection fill) from a drag vector
  if(!S.hasDoc)return;
  const kind=$("gradKind").value;
  const paint=(ctx,w,h)=>{
    let gr;
    if(kind==="radial"){const r=Math.hypot(g.x1-g.x0,g.y1-g.y0);
      gr=ctx.createRadialGradient(g.x0,g.y0,0,g.x0,g.y0,Math.max(1,r));}
    else gr=ctx.createLinearGradient(g.x0,g.y0,g.x1,g.y1);
    gr.addColorStop(0,S.brush.color);gr.addColorStop(1,S.brush.bgColor);
    ctx.fillStyle=gr;ctx.fillRect(0,0,w,h);};
  if($("gradFillSel").checked&&S.sel){
    const L=activeLayer();if(!L||!L.canvas){toast("Select a layer first");return;}
    pushUndo("Gradient fill selection");
    const mask=buildSelMask();
    const t=makeCanvas(S.docW,S.docH),tx=t.getContext("2d");
    paint(tx,S.docW,S.docH);
    tx.globalCompositeOperation="destination-in";tx.drawImage(mask,0,0);
    canvasCtx(L.canvas).drawImage(t,0,0);
    L.version++;invalidateAdj(L);render();renderLayerList();markDirty();
    toast("Gradient filled selection");return;}
  pushUndo("Gradient "+kind+" layer");
  const L=newLayer("Gradient ("+kind+")","paint");
  paint(canvasCtx(L.canvas),S.docW,S.docH);
  S.layers.push(L);S.activeId=L.id;
  render();renderLayerList();markDirty();toast("Gradient layer added");
}
function constrainRatio(r,ratio,isCrop){
  if(!ratio||ratio==="free")return r;
  if(typeof ratio==="string"&&ratio.indexOf("x")>0){ // preset size — ratio only for the drag box
    const [pw,ph]=ratio.split("x").map(Number);ratio=pw/ph;}
  ratio=parseFloat(ratio);if(!ratio||!isFinite(ratio))return r;
  if(r.w/r.h>ratio)r.w=r.h*ratio;else r.h=r.w/ratio;
  return r;
}

/* ---------------- selection operations ---------------- */
function selOpDelete(){
  const L=activeLayer();
  if(!S.sel){toast("Make a selection first (Rect or Lasso tool)");return;}
  if(!L||L.locked){toast("Select an unlocked layer first");return;}
  pushUndo("Delete inside selection");
  const mask=buildSelMask(),ctx=canvasCtx(L.canvas);
  ctx.save();ctx.globalCompositeOperation="destination-out";ctx.drawImage(mask,0,0);ctx.restore();
  L.version++;invalidateAdj(L);render();renderLayerList();markDirty();toast("Deleted inside selection");
}
function selOpFill(){
  const L=activeLayer();
  if(!S.sel){toast("Make a selection first");return;}
  if(!L||L.locked){toast("Select an unlocked layer first");return;}
  pushUndo("Fill selection");
  const mask=buildSelMask();
  const t=makeCanvas(S.docW,S.docH),tx=t.getContext("2d");
  tx.fillStyle=S.brush.color;tx.fillRect(0,0,S.docW,S.docH);
  tx.globalCompositeOperation="destination-in";tx.drawImage(mask,0,0);
  canvasCtx(L.canvas).drawImage(t,0,0);
  L.version++;invalidateAdj(L);render();renderLayerList();markDirty();toast("Filled selection");
}
function selOpInvert(){
  if(!S.sel){toast("Make a selection first");return;}
  S.sel.inverted=!S.sel.inverted;render();toast(S.sel.inverted?"Selection inverted":"Selection restored");
}
function selOpExpand(){
  if(!S.sel){toast("Make a selection first");return;}
  if(S.sel.type==="rect"||S.sel.type==="ellipse"){
    S.sel.rect.x-=5;S.sel.rect.y-=5;S.sel.rect.w+=10;S.sel.rect.h+=10;
  }else if(S.sel.path){
    const cx=S.sel.path.reduce((a,p)=>a+p.x,0)/S.sel.path.length;
    const cy=S.sel.path.reduce((a,p)=>a+p.y,0)/S.sel.path.length;
    S.sel.path=S.sel.path.map(p=>({x:cx+(p.x-cx)*1.05,y:cy+(p.y-cy)*1.05}));
  }else if(S.sel.type==="mask"){
    S.sel.mask=dilateMask(S.sel.mask,5);
  }
  render();toast("Selection expanded");
}
function selOpContract(){
  if(!S.sel){toast("Make a selection first");return;}
  if(S.sel.type==="rect"||S.sel.type==="ellipse"){
    S.sel.rect.x+=5;S.sel.rect.y+=5;S.sel.rect.w=Math.max(1,S.sel.rect.w-10);S.sel.rect.h=Math.max(1,S.sel.rect.h-10);
  }else if(S.sel.path){
    const cx=S.sel.path.reduce((a,p)=>a+p.x,0)/S.sel.path.length;
    const cy=S.sel.path.reduce((a,p)=>a+p.y,0)/S.sel.path.length;
    S.sel.path=S.sel.path.map(p=>({x:cx+(p.x-cx)*0.95,y:cy+(p.y-cy)*0.95}));
  }else if(S.sel.type==="mask"){
    S.sel.mask=erodeMask(S.sel.mask,5);
  }
  render();toast("Selection contracted");
}
function selOpCrop(){
  const b=selBBox();
  if(!b||b.w<2||b.h<2){toast("Selection is too small to crop");return;}
  applyCropRect(b);
}

/* ---------------- text / shape layers ---------------- */
function readTextPanel(){
  return {str:$("textInput").value||"Text",font:$("textFont").value,size:+$("textSize").value,
    weight:$("textWeight").value,align:$("textAlign").value,
    color:$("textColor").value,outline:$("textOutline").checked,outlineColor:$("textOutlineColor").value,
    shadow:$("textShadow").checked,spacing:+$("textSpacing").value,lineHeight:+$("textLineHeight").value,
    x:S.docW/2,y:S.docH/2};
}
function loadTextPanel(t){
  $("textInput").value=t.str;$("textFont").value=t.font;$("textSize").value=t.size;
  $("textWeight").value=t.weight||"400";$("textAlign").value=t.align||"center";
  $("textSizeVal").textContent=t.size+"px";$("textColor").value=t.color;
  $("textOutline").checked=!!t.outline;$("textOutlineColor").value=t.outlineColor||"#000000";
  $("textShadow").checked=!!t.shadow;$("textSpacing").value=t.spacing;
  $("textSpacingVal").textContent=t.spacing+"px";$("textLineHeight").value=t.lineHeight;
  $("textLineHeightVal").textContent=t.lineHeight+"%";
}
function addTextLayerAt(x,y){
  if(!S.hasDoc)return;
  pushUndo("Add text layer");
  const t=readTextPanel();t.x=x;t.y=y;
  const L=newLayer(t.str.slice(0,18)||"Text","text");L.text=t;
  rasterizeTextLayer(L);S.layers.push(L);S.activeId=L.id;
  render();renderLayerList();markDirty();toast("Text layer added — drag to move, edit in the Text panel");
}
function loadShapePanel(s){
  $("shapeKind").value=s.kind;$("shapeFill").value=s.fill;$("shapeStroke").value=s.stroke;
  $("shapeSides").value=s.sides||5;$("shapeSidesVal").textContent=s.sides||5;
  $("shapeStrokeW").value=s.strokeW;$("shapeStrokeWVal").textContent=s.strokeW+"px";
  $("shapeOpacity").value=s.opacity;$("shapeOpacityVal").textContent=s.opacity+"%";
}
function readShapePanel(){
  return {kind:$("shapeKind").value,sides:+$("shapeSides").value||5,fill:$("shapeFill").value,stroke:$("shapeStroke").value,
    strokeW:+$("shapeStrokeW").value,opacity:+$("shapeOpacity").value,x:0,y:0,w:100,h:100};
}
function addShapeLayer(pv){
  const s=readShapePanel();s.x=pv.x;s.y=pv.y;s.w=pv.w;s.h=pv.h;
  const L=newLayer(s.kind+" shape","shape");L.shape=s;
  rasterizeShapeLayer(L);S.layers.push(L);S.activeId=L.id;
  render();renderLayerList();markDirty();toast("Shape layer added");
}

/* ---------------- adjustments + filters ---------------- */
const ADJ_KEYS=["brightness","contrast","saturation","exposure","temperature","tint","highlights","shadows","sharpness","blur","vignette","grain"];
function adjTargets(){
  if(S.adjScope==="all")return allLeaves().filter(l=>!l.locked&&l.canvas);
  const L=activeLayer();return L?[L]:[];
}
function loadAdjPanel(){
  const L=activeLayer(),a=L?L.adj:defaultAdj();
  for(const k of ADJ_KEYS){
    const inp=$("adj"+k[0].toUpperCase()+k.slice(1));
    if(inp){inp.value=a[k];const v=$("adj"+k[0].toUpperCase()+k.slice(1)+"Val");
      if(v)v.textContent=k==="blur"?a[k]+"px":a[k];}
  }
  // PHASE 5: advanced adjustments
  const lv=a.levels||{black:0,white:255,gamma:1};
  $("levelsBlack").value=lv.black;$("levelsBlackVal").textContent=lv.black;
  $("levelsWhite").value=lv.white;$("levelsWhiteVal").textContent=lv.white;
  $("levelsGamma").value=Math.round(lv.gamma*100);$("levelsGammaVal").textContent=lv.gamma.toFixed(2);
  const hs=a.hsl||{h:0,s:0,l:0};
  $("hslHue").value=hs.h;$("hslHueVal").textContent=hs.h+"°";
  $("hslSat").value=hs.s;$("hslSatVal").textContent=hs.s;
  $("hslLight").value=hs.l;$("hslLightVal").textContent=hs.l;
  const cb=a.cb||{sh:[0,0,0],mid:[0,0,0],hi:[0,0,0]};
  const cbMap={cbShR:["sh",0],cbShG:["sh",1],cbShB:["sh",2],cbMidR:["mid",0],cbMidG:["mid",1],cbMidB:["mid",2],cbHiR:["hi",0],cbHiG:["hi",1],cbHiB:["hi",2]};
  for(const id in cbMap){const [zone,i]=cbMap[id];
    $(id).value=cb[zone][i];$(id+"Val").textContent=cb[zone][i];}
  $("lutIntensity").value=a.lutIntensity==null?100:a.lutIntensity;
  $("lutIntensityVal").textContent=(a.lutIntensity==null?100:a.lutIntensity)+"%";
  $("lutStatus").textContent=a.lutName?("LUT: "+a.lutName+(LUT_STORE[a.lutName]?"":" (not loaded — re-import the .cube file)")):"No LUT loaded. A .cube file is parsed on-device and applied with the intensity above.";
  drawCurves();
  syncFilterGrid(); // keep the filter grid's highlight true after any load/restore (Bug 1)
}
/* PHASE 5 — RGB curves editor (small canvas, draggable points) */
function curvesPoints(){
  const L=activeLayer();
  if(!L)return defaultCurves()[S.curvesChannel];
  if(!L.adj.curves)L.adj.curves=defaultCurves();
  return L.adj.curves[S.curvesChannel];
}
function drawCurves(){
  const cv=$("curvesCanvas");if(!cv)return;
  const x=cv.getContext("2d"),W=cv.width,H=cv.height;
  x.clearRect(0,0,W,H);
  x.fillStyle="#0d1330";x.fillRect(0,0,W,H);
  x.strokeStyle="#263154";x.lineWidth=1;
  for(let i=1;i<4;i++){x.beginPath();x.moveTo(W*i/4,0);x.lineTo(W*i/4,H);x.stroke();
    x.beginPath();x.moveTo(0,H*i/4);x.lineTo(W,H*i/4);x.stroke();}
  x.strokeStyle="#9aa7c7";x.beginPath();x.moveTo(0,H);x.lineTo(W,0);x.stroke();
  const pts=curvesPoints();
  const lut=curveLUT(pts);
  x.strokeStyle=S.curvesChannel==="rgb"?"#e8ecf7":S.curvesChannel==="r"?"#f43f5e":S.curvesChannel==="g"?"#22c55e":"#38bdf8";
  x.lineWidth=2;x.beginPath();
  for(let v=0;v<256;v++){const px=v/255*W,py=H-lut[v]/255*H;
    if(v===0)x.moveTo(px,py);else x.lineTo(px,py);}
  x.stroke();
  x.fillStyle="#06b6d4";
  for(const p of pts){x.beginPath();x.arc(p[0]/255*W,H-p[1]/255*H,6,0,Math.PI*2);x.fill();
    x.strokeStyle="#fff";x.lineWidth=1;x.stroke();}
}
function bindCurves(){
  const cv=$("curvesCanvas");
  let dragIdx=-1;
  const toVal=e=>{
    const r=cv.getBoundingClientRect();
    return [clamp(Math.round((e.clientX-r.left)/r.width*255),0,255),
            clamp(Math.round((1-(e.clientY-r.top)/r.height)*255),0,255)];
  };
  cv.addEventListener("pointerdown",e=>{
    e.preventDefault();try{cv.setPointerCapture(e.pointerId);}catch(_){/* no pointer capture (older engine) — drag still works via window pointer events */}
    const [vx,vy]=toVal(e),pts=curvesPoints();
    let best=-1,bd=1e9;
    pts.forEach((p,i)=>{const d=Math.hypot(p[0]-vx,p[1]-vy);if(d<bd){bd=d;best=i;}});
    if(bd<24){dragIdx=best;pushUndo("Edit curves");}
    else{ // tap the line: add a point there
      const L=activeLayer();if(!L)return;
      pushUndo("Edit curves");
      pts.push([vx,vy]);pts.sort((a,b)=>a[0]-b[0]);
      dragIdx=pts.findIndex(p=>p[0]===vx&&p[1]===vy);
      invalidateAdj(L);render();markDirty();}
    drawCurves();
  });
  cv.addEventListener("pointermove",e=>{
    if(dragIdx<0)return;
    const [vx,vy]=toVal(e),L=activeLayer();if(!L)return;
    const pts=curvesPoints();
    pts[dragIdx]=[vx,vy];
    if(dragIdx>0)pts[dragIdx][0]=Math.max(pts[dragIdx-1][0]+1,pts[dragIdx][0]);
    if(dragIdx<pts.length-1)pts[dragIdx][0]=Math.min(pts[dragIdx+1][0]-1,pts[dragIdx][0]);
    invalidateAdj(L);drawCurves();render();markDirty();
  });
  cv.addEventListener("pointerup",()=>{dragIdx=-1;});
  cv.addEventListener("dblclick",e=>{
    const [vx,vy]=toVal(e),pts=curvesPoints(),L=activeLayer();if(!L)return;
    let best=-1,bd=1e9;
    pts.forEach((p,i)=>{const d=Math.hypot(p[0]-vx,p[1]-vy);if(d<bd){bd=d;best=i;}});
    if(best>0&&best<pts.length-1&&bd<24){pushUndo("Edit curves");pts.splice(best,1);invalidateAdj(L);drawCurves();render();markDirty();}
  });
  $("curvesChannel").addEventListener("change",e=>{S.curvesChannel=e.target.value;drawCurves();});
  $("btnCurvesReset").onclick=()=>{
    const L=activeLayer();if(!L)return;
    pushUndo("Reset curves");L.adj.curves=defaultCurves();invalidateAdj(L);drawCurves();render();markDirty();toast("Curves reset");
  };
}
let adjUndoArmed=false;
function bindAdjustments(){
  for(const k of ADJ_KEYS){
    const id="adj"+k[0].toUpperCase()+k.slice(1),inp=$(id),val=$(id+"Val");
    if(!inp)continue;
    inp.addEventListener("pointerdown",()=>{adjUndoArmed=false;});
    inp.addEventListener("focus",()=>{adjUndoArmed=false;});
    inp.addEventListener("input",()=>{
      if(!adjUndoArmed){pushUndo("Adjustments");adjUndoArmed=true;}
      const v=+inp.value;
      if(val)val.textContent=k==="blur"?v+"px":v;
      for(const L of adjTargets()){L.adj[k]=v;invalidateAdj(L);}
      document.querySelectorAll("#filterGrid button").forEach(b=>b.classList.remove("on"));
      render();markDirty();
    });
    inp.addEventListener("change",()=>{adjUndoArmed=false;});
  }
  $("adjScope").addEventListener("change",e=>{S.adjScope=e.target.value;loadAdjPanel();});
  $("btnResetAdj").addEventListener("click",()=>{
    if(!S.hasDoc)return;pushUndo("Reset adjustments");
    for(const L of adjTargets()){L.adj=defaultAdj();invalidateAdj(L);}
    loadAdjPanel();render();markDirty();toast("Adjustments reset");
  });
}
function buildFilters(){
  const grid=$("filterGrid");grid.innerHTML="";
  Object.keys(FILTER_PRESETS).forEach(name=>{
    const b=document.createElement("button");b.textContent=name;b.dataset.filter=name;
    b.onclick=()=>{
      if(!S.hasDoc){toast("Open an image first");return;}
      pushUndo("Apply filter: "+name);
      const patch=FILTER_PRESETS[name];
      for(const L of adjTargets()){L.adj={...defaultAdj(),...patch};invalidateAdj(L);}
      loadAdjPanel();
      grid.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));
      render();markDirty();toast("Filter: "+name);
    };
    grid.appendChild(b);
  });
  grid.querySelector("button").classList.add("on");
}
/* Which named filter preset (if any) matches this layer's adjustments, so
   the UI can say so instead of silently desaturating new paint (Bug 1).
   "Normal" = identity. A preset matches when every field in its patch
   equals the layer's value; a hand-tuned slider mix has no preset name. */
function filterNameFor(adj){
  if(!adj)return null;
  if(isIdentityAdj(adj))return "Normal";
  for(const name of Object.keys(FILTER_PRESETS)){
    const patch=FILTER_PRESETS[name];if(!Object.keys(patch).length)continue;
    let ok=true;
    for(const k of Object.keys(patch)){if(adj[k]!==patch[k]){ok=false;break;}}
    if(ok)return name;
  }
  return null;
}
function syncFilterGrid(){
  const L=activeLayer();if(!L)return; // no doc yet — leave the grid as built
  const name=filterNameFor(L.adj);
  document.querySelectorAll("#filterGrid button").forEach(b=>{
    b.classList.toggle("on",!!name&&b.dataset.filter===name);});
}

/* ---------------- export (with confirmation + real file size) ---------------- */
function fmtSize(bytes){
  if(bytes<1024)return bytes+" B";
  if(bytes<1024*1024)return (bytes/1024).toFixed(1)+" KB";
  return (bytes/1024/1024).toFixed(2)+" MB";
}
/* Phase 6 — photo exports feed the SAME export history the video editor
   shows in its Export Center (localStorage "editora-export-history", same
   record shape). A photo export therefore appears in Export Center history
   with its real size and format, and a failed encode is recorded as Failed
   with its reason instead of vanishing. */
const PHOTO_EXP_HIST_KEY="editora-export-history";
function recordPhotoExport(status,settings,size,note){
  let h=[];try{h=JSON.parse(localStorage.getItem(PHOTO_EXP_HIST_KEY)||"[]");}catch(e){h=[];}
  h.unshift({id:uid(),name:S.projectName||"Untitled Photo",settings:settings||"",size:size||0,date:Date.now(),status:status,note:note||"",job:null});
  try{localStorage.setItem(PHOTO_EXP_HIST_KEY,JSON.stringify(h.slice(0,50)));}catch(e){}
}
function exportPhoto(){
  // renders the export, measures the real blob, then asks for confirmation —
  // the size shown is the exact size of the file that will be downloaded.
  if(!S.hasDoc){toast("Nothing to export — open an image first");return;}
  const fmt=$("exportFormat").value,q=+$("exportQuality").value/100;
  // NIT 2026-11-12: the width field showed 0 ("original") while the dialog
  // said "Ready: 640×480" — prefill the resolved width so the field shows
  // the real size. A blank/0 field still means original size.
  if(!+$("exportWidth").value)$("exportWidth").value=S.docW;
  const w=+$("exportWidth").value||S.docW;
  const h=Math.round(S.docH*w/S.docW);
  const out=makeCanvas(w,h),ctx=out.getContext("2d");
  if(fmt==="jpeg"){ctx.fillStyle="#ffffff";ctx.fillRect(0,0,w,h);}
  compositeTo(ctx,w,h);
  const mime=fmt==="jpeg"?"image/jpeg":fmt==="webp"?"image/webp":"image/png";
  $("exportSizeText").textContent="Rendering "+w+"×"+h+" "+fmt.toUpperCase()+"…";
  $("btnDoExport").disabled=true;
  showModal("exportModal");
  out.toBlob(blob=>{
    if(!blob){$("exportSizeText").textContent="Export failed in this browser — the image could not be encoded.";recordPhotoExport("Failed","Photo export · "+fmt.toUpperCase()+" "+w+"×"+h,0,"The image could not be encoded in this browser.");return;}
    S.pendingExport={blob:blob,
      name:(S.projectName||"photo").replace(/[\\/:*?"<>|]/g,"")+"."+(fmt==="jpeg"?"jpg":fmt),
      w:w,h:h,fmt:fmt};
    $("exportSizeText").textContent="Ready: "+w+"×"+h+" "+fmt.toUpperCase()+
      " — estimated file size "+fmtSize(blob.size)+
      (fmt==="png"?" (transparency kept)":fmt==="jpeg"?" (transparent areas filled white)":" (transparency kept)");
    $("btnDoExport").disabled=false;
  },mime,fmt==="png"?undefined:q);
  $("btnExportTop").blur();
}
function confirmExport(){
  const p=S.pendingExport;
  if(!p){toast("Nothing ready to export yet");return;}
  S.pendingExport=null;
  const a=document.createElement("a");
  a.href=URL.createObjectURL(p.blob);
  a.download=p.name;
  a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  hideModals();
  recordPhotoExport("Completed","Photo export · "+p.fmt.toUpperCase()+" "+p.w+"×"+p.h,p.blob.size,"");
  toast("Exported "+p.w+"×"+p.h+" "+p.fmt.toUpperCase()+" — "+fmtSize(p.blob.size));
}

/* ---------------- IndexedDB (separate store: editora-pro-photo) ---------------- */
let dbPromise=null;
function openDB(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open("editora-pro-photo",1);
    req.onupgradeneeded=e=>{e.target.result.createObjectStore("projects");};
    req.onsuccess=e=>{
      const db=e.target.result;
      if(!db.objectStoreNames.contains("projects")){
        /* An opener that never created the store left an empty v1 database
           behind: drop it and reopen so the store is created — otherwise
           every save/load in this editor would fail. */
        const name=db.name;db.close();
        const del=indexedDB.deleteDatabase(name);
        del.onsuccess=()=>{dbPromise=null;openDB().then(resolve,reject);};
        del.onerror=()=>reject(del.error);
        return;
      }
      resolve(db);
    };
    req.onerror=()=>reject(req.error);
  });
  return dbPromise;
}
function dbPut(key,data){
  return openDB().then(db=>new Promise((res,rej)=>{
    const tx=db.transaction("projects","readwrite");
    tx.objectStore("projects").put(data,key);
    tx.oncomplete=res;tx.onerror=()=>rej(tx.error);
  }));
}
function dbGet(key){
  return openDB().then(db=>new Promise((res,rej)=>{
    const req=db.transaction("projects","readonly").objectStore("projects").get(key);
    req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);
  }));
}
function dbKeys(){
  return openDB().then(db=>new Promise((res,rej)=>{
    const req=db.transaction("projects","readonly").objectStore("projects").getAllKeys();
    req.onsuccess=()=>res(req.result||[]);req.onerror=()=>rej(req.error);
  }));
}
/* FIX 2026-11-12 (Issue 3): never run two IndexedDB saves concurrently and
   never report "saved" before the write lands. Callers that await the
   returned promise (import, Save button) get a toast only after the put
   resolves; overlapping calls chain behind the in-flight one. */
let saveInFlight=null;
function saveProject(silent){
  if(saveInFlight)return saveInFlight.then(()=>saveProject(silent));
  if(!S.hasDoc){if(!silent)toast("Nothing to save yet");return Promise.resolve();}
  const name=(S.projectName||"Untitled Photo").trim();
  const data=EPProjectStore.stampPhoto({...serialize(),savedAt:new Date().toISOString()});
  saveInFlight=dbPut(name,data).then(()=>dbPut("__autosave__",data)).then(()=>{
    markSaved();if(!silent)toast("Saved project “"+name+"”");refreshSavedList();
  }).catch(()=>{if(!silent)toast("Save failed — browser storage blocked");})
  .finally(()=>{saveInFlight=null;});
  return saveInFlight;
}
/* BUG 5 (2026-11-12): two guards. (1) saveProject writes the SAME
   snapshot under the project-name key AND "__autosave__", so without a
   dedupe the identical project listed twice (same name, same timestamp).
   (2) refreshSavedList is async — two overlapping runs could both clear
   and append, doubling the autosave. A run token lets only the newest
   run render. */
let refreshSavedListRun=0;
function refreshSavedList(){
  const run=++refreshSavedListRun;
  // Recent Projects (empty-state card): the autosaved project first, then
  // named projects — each with a thumbnail, name and saved time. One click
  // resumes it (Bug 2: the autosave is OFFERED here, never auto-opened).
  const rl=$("recentList");if(!rl)return;
  const thumbOf=snap=>{
    const walk=ls=>{for(const l of (ls||[])){if(l.kind==="group"){const t=walk(l.children);if(t)return t;}else if(l.data)return l.data;}return null;};
    try{return walk(snap.layers);}catch(e){return null;}};
  const timeOf=snap=>{try{const d=new Date(snap.savedAt);return isNaN(d.getTime())?"":d.toLocaleString();}catch(e){return"";}};
  const item=(key,label,snap,onOpen)=>{
    const b=document.createElement("button");b.className="recent-item";
    const th=thumbOf(snap);
    if(th){const im=document.createElement("img");im.className="recent-thumb";im.src=th;im.alt="";b.appendChild(im);}
    const tx=document.createElement("span");tx.className="recent-text";
    const nm=document.createElement("span");nm.className="recent-name";nm.textContent=label;
    const tm=document.createElement("span");tm.className="recent-time";tm.textContent=timeOf(snap);
    tx.appendChild(nm);tx.appendChild(tm);b.appendChild(tx);
    b.title="Open "+label;
    b.onclick=onOpen;
    return b;};
  Promise.all([dbGet("__autosave__").catch(()=>null),dbKeys().catch(()=>[])])
  .then(async ([auto,keys])=>{
    if(run!==refreshSavedListRun)return; /* stale run — a newer refresh started */
    rl.innerHTML="";
    const names=(keys||[]).filter(k=>k!=="__autosave__");
    const seen=new Set(); /* (project name | savedAt) already listed */
    let any=false;
    if(auto&&auto.layers&&auto.layers.length){
      seen.add((auto.projectName||"Untitled Photo")+"|"+(auto.savedAt||""));
      rl.appendChild(item("__autosave__",(auto.projectName||"Untitled Photo")+" — Autosaved",auto,()=>loadAutosave()));
      any=true;}
    for(const n of names.slice(-5).reverse()){
      const snap=await dbGet(n).catch(()=>null);
      if(!snap)continue;
      if(run!==refreshSavedListRun)return;
      /* BUG 5 dedupe: this named key holds the very snapshot already
         shown as the autosave (same project, same save time) — skip it. */
      const sig=(snap.projectName||n)+"|"+(snap.savedAt||"");
      if(seen.has(sig))continue;
      seen.add(sig);
      rl.appendChild(item(n,n,snap,()=>loadSaved(n)));
      any=true;}
    if(!any)rl.innerHTML='<p class="hint">No recent projects yet.</p>';
  }).catch(()=>{});
}
function loadAutosave(){
  dbGet("__autosave__").then(data=>{
    if(!data){toast("No autosaved project found");return;}
    const v=EPProjectStore.validate(data,EPProjectStore.PHOTO_APP);
    if(!v.ok){toast(v.reason);return;}
    epHist.clear();clearHistLog();
    restoreSnap(data).then(()=>{toast("Opened autosaved project");S.dirty=false;markSaved();refreshSavedList();});
  }).catch(()=>toast("Could not load the autosaved project"));
}
function loadSaved(name){
  dbGet(name).then(data=>{
    if(!data){toast("No saved project named “"+name+"”");return;}
    const v=EPProjectStore.validate(data,EPProjectStore.PHOTO_APP);
    if(!v.ok){toast(v.reason);return;}
    epHist.clear();clearHistLog();
    restoreSnap(data).then(()=>{toast("Opened saved project “"+name+"”");refreshSavedList();});
  }).catch(()=>toast("Could not load that project"));
}

/* ================= PHASE 5 — brush engines, retouch, transform ================= */
/* Region brush ops: work on a square region around (x,y) of the target canvas. */
function brushRegion(target,x,y,fn){
  const c=target.canvas,r=Math.max(2,Math.round(S.brush.size/2));
  const x0=clamp(Math.round(x-r),0,c.width-1),y0=clamp(Math.round(y-r),0,c.height-1);
  const w=Math.min(2*r,c.width-x0),h=Math.min(2*r,c.height-y0);
  if(w<1||h<1)return;
  const ctx=canvasCtx(c),img=ctx.getImageData(x0,y0,w,h);
  fn(img.data,w,h,x0,y0);
  ctx.putImageData(img,x0,y0);
  target.layer.version++;invalidateAdj(target.layer);
}
function radialFalloff(dx,dy,r){
  const d=Math.hypot(dx,dy)/r;return d>=1?0:Math.pow(1-d,1.5);
}
function paintPencil(target,x0,y0,x1,y1){
  // hard 1px strokes: draw 1px-wide line segments, no soft edge
  const ctx=canvasCtx(target.canvas);
  ctx.save();ctx.globalCompositeOperation=S.editMask?"source-over":"source-over";
  ctx.globalAlpha=S.brush.opacity/100;ctx.fillStyle=S.editMask?$("maskPaint").value:S.brush.color;
  ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(Math.round(x0)+0.5,Math.round(y0)+0.5);
  ctx.lineTo(Math.round(x1)+0.5,Math.round(y1)+0.5);ctx.stroke();
  ctx.restore();
  target.layer.version++;invalidateAdj(target.layer);
}
function paintAirbrush(target,x,y){
  // soft spray: random dots inside the radius, amount = flow
  const ctx=canvasCtx(target.canvas),r=S.brush.size/2;
  const n=Math.round(S.brush.flow/100*40)+4;
  ctx.save();ctx.globalAlpha=S.brush.opacity/100;
  ctx.fillStyle=S.editMask?$("maskPaint").value:S.brush.color;
  for(let i=0;i<n;i++){
    const a=Math.random()*Math.PI*2,rr=Math.sqrt(Math.random())*r;
    ctx.fillRect(x+Math.cos(a)*rr,y+Math.sin(a)*rr,1.5,1.5);}
  ctx.restore();
  target.layer.version++;invalidateAdj(target.layer);
}
function paintBlurBrush(target,x,y){
  const c=target.canvas,r=Math.max(2,Math.round(S.brush.size/2));
  const region=makeCanvas(2*r,2*r),rx=region.getContext("2d");
  rx.drawImage(c,x-r,y-r,2*r,2*r,0,0,2*r,2*r);
  const blurred=blurCanvas(region,Math.max(1,S.brush.strength/25));
  // stamp the blurred patch through a soft radial mask
  const masked=makeCanvas(2*r,2*r),mx=masked.getContext("2d");
  mx.drawImage(blurred,0,0);
  mx.globalCompositeOperation="destination-in";
  const g=mx.createRadialGradient(r,r,0,r,r,r);
  g.addColorStop(0,"rgba(255,255,255,"+(S.brush.strength/100)+")");
  g.addColorStop(1,"rgba(255,255,255,0)");
  mx.fillStyle=g;mx.fillRect(0,0,2*r,2*r);
  canvasCtx(c).drawImage(masked,x-r,y-r);
  target.layer.version++;invalidateAdj(target.layer);
}
function paintSharpenBrush(target,x,y){
  const amt=S.brush.strength/100*0.9;
  brushRegion(target,x,y,(d,w,h)=>{
    const src=new Uint8ClampedArray(d);
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
      const i=(yy*w+xx)*4,fall=radialFalloff(xx-w/2,yy-h/2,w/2)*amt;
      if(fall<=0)continue;
      for(let k=0;k<3;k++){
        const c=src[i+k],up=yy>0?src[((yy-1)*w+xx)*4+k]:c,dn=yy<h-1?src[((yy+1)*w+xx)*4+k]:c,
          lf=xx>0?src[(yy*w+xx-1)*4+k]:c,rt=xx<w-1?src[(yy*w+xx+1)*4+k]:c;
        d[i+k]=clamp(c+(c*(1+4*fall)-fall*(up+dn+lf+rt)-c),0,255);}}
  });
}
function paintDodgeBurn(target,x,y,mode){
  const amt=S.brush.strength/100;
  brushRegion(target,x,y,(d,w,h)=>{
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
      const i=(yy*w+xx)*4,fall=radialFalloff(xx-w/2,yy-h/2,w/2)*amt;
      if(fall<=0)continue;
      for(let k=0;k<3;k++){
        d[i+k]=mode==="dodge"?clamp(d[i+k]+(255-d[i+k])*fall*0.5,0,255)
          :clamp(d[i+k]*(1-fall*0.5),0,255);}}
  });
}
function paintSponge(target,x,y){
  const amt=S.brush.strength/100,mode=$("spongeMode").value;
  brushRegion(target,x,y,(d,w,h)=>{
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
      const i=(yy*w+xx)*4,fall=radialFalloff(xx-w/2,yy-h/2,w/2)*amt;
      if(fall<=0)continue;
      const lum=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
      const f=mode==="saturate"?1+fall:Math.max(0,1-fall);
      d[i]=clamp(lum+(d[i]-lum)*f,0,255);
      d[i+1]=clamp(lum+(d[i+1]-lum)*f,0,255);
      d[i+2]=clamp(lum+(d[i+2]-lum)*f,0,255);}
  });
}
function paintSmudge(target,x,y,last){
  // smear: copy the patch from the previous point, draw it shifted toward the
  // current point through a soft mask, then the next stamp samples the smeared pixels
  if(!last)return;
  const c=target.canvas,r=Math.max(2,Math.round(S.brush.size/2));
  const dx=(x-last.x)*0.35,dy=(y-last.y)*0.35;
  const patch=makeCanvas(2*r,2*r),px=patch.getContext("2d");
  px.drawImage(c,last.x-r,last.y-r,2*r,2*r,0,0,2*r,2*r);
  px.globalCompositeOperation="destination-in";
  const g=px.createRadialGradient(r,r,0,r,r,r);
  g.addColorStop(0,"rgba(255,255,255,"+(S.brush.strength/100*0.8)+")");
  g.addColorStop(1,"rgba(255,255,255,0)");
  px.fillStyle=g;px.fillRect(0,0,2*r,2*r);
  canvasCtx(c).drawImage(patch,last.x-r+dx,last.y-r+dy);
  target.layer.version++;invalidateAdj(target.layer);
}
function paintWhiten(target,x,y){
  // teeth whitening: desaturate yellow + brighten, softly
  const amt=S.brush.strength/100;
  brushRegion(target,x,y,(d,w,h)=>{
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
      const i=(yy*w+xx)*4,fall=radialFalloff(xx-w/2,yy-h/2,w/2)*amt;
      if(fall<=0)continue;
      const r=d[i],g=d[i+1],b=d[i+2];
      const yellowish=(r>80&&g>70&&b<r-10)?1:0.4; // teeth are warm; stronger effect on yellow
      const lum=0.299*r+0.587*g+0.114*b;
      const f=yellowish*fall;
      d[i]=clamp(lum+(r-lum)*(1-f*0.85)+22*f,0,255);
      d[i+1]=clamp(lum+(g-lum)*(1-f*0.85)+22*f,0,255);
      d[i+2]=clamp(lum+(b-lum)*(1-f*0.85)+26*f,0,255);}
  });
}
function paintSmoothBrush(target,x,y){paintBlurBrush(target,x,y);}
function paintLocalExp(target,x,y){
  const amt=+$("localExpAmt").value/100;
  const f=Math.pow(2,amt*1.2);
  brushRegion(target,x,y,(d,w,h)=>{
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
      const i=(yy*w+xx)*4,fall=radialFalloff(xx-w/2,yy-h/2,w/2);
      if(fall<=0)continue;
      for(let k=0;k<3;k++)d[i+k]=clamp(d[i+k]*(1+ (f-1)*fall),0,255);}
  });
}
/* Dispatch one brush stamp / stroke segment by tool. */
function strokeAt(tgt,x0,y0,x1,y1){
  const t=S.tool;
  if(t==="clone"||t==="healing"){
    // interpolate dabs along the stroke (same spacing as the brush) so a
    // fast drag paints a continuous line instead of dotted gaps
    const dist=Math.hypot(x1-x0,y1-y0);
    const step=Math.max(1,S.brush.size*((S.brush.spacing==null?25:S.brush.spacing)/100));
    const n=Math.max(1,Math.ceil(dist/step));
    for(let i=0;i<=n;i++){
      const k=i/n;cloneStampAt(tgt,x0+(x1-x0)*k,y0+(y1-y0)*k);
    }
    return;}
  if(t==="pencil"){paintPencil(tgt,x0,y0,x1,y1);return;}
  if(t==="airbrush"){paintAirbrush(tgt,x1,y1);return;}
  if(t==="blurbrush"){paintBlurBrush(tgt,x1,y1);return;}
  if(t==="sharpenbrush"){paintSharpenBrush(tgt,x1,y1);return;}
  if(t==="smudge"){paintSmudge(tgt,x1,y1,{x:x0,y:y0});return;}
  if(t==="dodge"){paintDodgeBurn(tgt,x1,y1,"dodge");return;}
  if(t==="burn"){paintDodgeBurn(tgt,x1,y1,"burn");return;}
  if(t==="sponge"){paintSponge(tgt,x1,y1);return;}
  if(t==="whiten"){paintWhiten(tgt,x1,y1);return;}
  if(t==="smoothbrush"){paintSmoothBrush(tgt,x1,y1);return;}
  if(t==="localexp"){paintLocalExp(tgt,x1,y1);return;}
  paintLine(tgt,x0,y0,x1,y1);
}
function spotHealAt(target,x,y){
  // single-click feathered patch sampled from a nearby offset (NOT content-aware)
  const L=target.layer,src=L.canvas,r=S.brush.size/2;
  const ox=x+r*2.2,oy=y+r*1.4; // sample just down-right of the spot
  const ctx=canvasCtx(target.canvas);
  const patch=makeCanvas(S.brush.size,S.brush.size),px=patch.getContext("2d");
  px.drawImage(src,ox-r,oy-r,S.brush.size,S.brush.size,0,0,S.brush.size,S.brush.size);
  px.globalCompositeOperation="destination-in";
  const g=px.createRadialGradient(r,r,0,r,r,r);
  g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(0.6,"rgba(255,255,255,0.9)");g.addColorStop(1,"rgba(255,255,255,0)");
  px.fillStyle=g;px.fillRect(0,0,S.brush.size,S.brush.size);
  ctx.save();ctx.globalAlpha=S.brush.opacity/100;ctx.drawImage(patch,x-r,y-r);ctx.restore();
  L.version++;invalidateAdj(L);
}
function redEyeAt(target,x,y){
  // desaturate + darken red pixels in a small region around the tap
  brushRegion(target,x,y,(d,w,h)=>{
    for(let i=0;i<d.length;i+=4){
      const r=d[i],g=d[i+1],b=d[i+2];
      if(r>90&&r>g+35&&r>b+30){ // red-eye pixel
        const lum=0.299*r+0.587*g+0.114*b;
        d[i]=clamp(lum*0.75,0,255);d[i+1]=clamp(lum*0.75,0,255);d[i+2]=clamp(lum*0.8,0,255);}
    }
  });
}
/* Retouch region ops (selection or whole layer) */
function applyToSelRegion(fn){
  const L=activeLayer();
  if(!L||!L.canvas||L.locked){toast("Select an unlocked layer first");return false;}
  pushUndo("Apply region effect");
  const mask=S.sel?buildSelMask():null;
  const ctx=canvasCtx(L.canvas);
  const img=ctx.getImageData(0,0,S.docW,S.docH);
  fn(img.data,S.docW,S.docH,mask?canvasCtx(mask).getImageData(0,0,S.docW,S.docH).data:null);
  ctx.putImageData(img,0,0);
  L.version++;invalidateAdj(L);render();renderLayerList();markDirty();
  return true;
}
function applySkinTone(){
  const warmth=+$("skinWarmth").value,smooth=+$("skinSmooth").value;
  const L=activeLayer();
  if(!L||!L.canvas){toast("Select a layer first");return;}
  if(smooth>0){ // smoothing = blurred copy blended inside the region
    pushUndo("Apply skin tone");
    const blurred=blurCanvas(L.canvas,Math.max(1,smooth/20));
    const mask=S.sel?buildSelMask():null;
    const ctx=canvasCtx(L.canvas);
    ctx.save();
    if(mask){const t=makeCanvas(S.docW,S.docH),tx=t.getContext("2d");
      tx.drawImage(blurred,0,0);tx.globalCompositeOperation="destination-in";tx.drawImage(mask,0,0);
      ctx.globalAlpha=smooth/100;ctx.drawImage(t,0,0);}
    else{ctx.globalAlpha=smooth/100;ctx.drawImage(blurred,0,0);}
    ctx.restore();
    L.version++;invalidateAdj(L);
  }
  if(warmth!==0){
    applyToSelRegion((d,w,h,md)=>{
      for(let i=0;i<d.length;i+=4){
        const m=md?md[i+3]/255:1;if(m<=0)continue;
        d[i]=clamp(d[i]+warmth*0.3*m,0,255);d[i+2]=clamp(d[i+2]-warmth*0.3*m,0,255);}
    });
  }else render();
  toast("Skin tone applied"+(S.sel?" inside the selection":" to the layer"));
}
function applySelectiveColor(){
  const [tr,tg,tb]=hexToRgb(S.selColor);
  const targetH=rgbToHsl(tr/255,tg/255,tb/255)[0];
  const dh=+$("selColorHue").value,ds=+$("selColorSat").value,dl=+$("selColorLight").value;
  if(!applyToSelRegion((d,w,h,md)=>{
    for(let i=0;i<d.length;i+=4){
      const m=md?md[i+3]/255:1;if(m<=0)continue;
      const hsl=rgbToHsl(d[i]/255,d[i+1]/255,d[i+2]/255);
      let dHue=Math.abs(hsl[0]-targetH);dHue=Math.min(dHue,1-dHue);
      if(dHue>0.1)return;
      hsl[0]=(hsl[0]+dh/360+1)%1;
      hsl[1]=clamp(hsl[1]*(1+ds/100),0,1);
      hsl[2]=clamp(hsl[2]+dl/100,0,1);
      const rgb=hslToRgb(hsl[0],hsl[1],hsl[2]);
      d[i]=clamp(rgb[0]*255,0,255);d[i+1]=clamp(rgb[1]*255,0,255);d[i+2]=clamp(rgb[2]*255,0,255);}
  }))return;
  toast("Selective color applied");
}
/* Background replacement */
function bgDelete(){
  const L=activeLayer();
  if(!S.sel){toast("Select the subject first (any selection tool)");return;}
  if(!L||!L.canvas||L.locked){toast("Select an unlocked layer first");return;}
  pushUndo("Delete background");
  const mask=buildSelMask();
  const inv=makeCanvas(S.docW,S.docH),ix=inv.getContext("2d");
  ix.fillStyle="#fff";ix.fillRect(0,0,S.docW,S.docH);
  ix.globalCompositeOperation="destination-out";ix.drawImage(mask,0,0);
  const ctx=canvasCtx(L.canvas);
  ctx.save();ctx.globalCompositeOperation="destination-out";ctx.drawImage(inv,0,0);ctx.restore();
  L.version++;invalidateAdj(L);render();renderLayerList();markDirty();
  toast("Background deleted — subject kept, rest is transparent");
}
function bgFillColor(){
  const L=activeLayer();
  if(!S.sel){toast("Select the subject first (any selection tool)");return;}
  if(!L||!L.canvas||L.locked){toast("Select an unlocked layer first");return;}
  pushUndo("Fill background with color");
  const mask=buildSelMask();
  const inv=makeCanvas(S.docW,S.docH),ix=inv.getContext("2d");
  ix.fillStyle="#fff";ix.fillRect(0,0,S.docW,S.docH);
  ix.globalCompositeOperation="destination-out";ix.drawImage(mask,0,0);
  const fill=makeCanvas(S.docW,S.docH),fx=fill.getContext("2d");
  fx.fillStyle=S.brush.color;fx.fillRect(0,0,S.docW,S.docH);
  fx.globalCompositeOperation="destination-in";fx.drawImage(inv,0,0);
  canvasCtx(L.canvas).drawImage(fill,0,0);
  L.version++;invalidateAdj(L);render();renderLayerList();markDirty();
  toast("Background filled with "+S.brush.color);
}
function bgFillImage(img){
  const L=activeLayer();
  if(!S.sel){toast("Select the subject first (any selection tool)");return;}
  if(!L||!L.canvas||L.locked){toast("Select an unlocked layer first");return;}
  pushUndo("Fill background with image");
  const mask=buildSelMask();
  const inv=makeCanvas(S.docW,S.docH),ix=inv.getContext("2d");
  ix.fillStyle="#fff";ix.fillRect(0,0,S.docW,S.docH);
  ix.globalCompositeOperation="destination-out";ix.drawImage(mask,0,0);
  const fill=makeCanvas(S.docW,S.docH),fx=fill.getContext("2d");
  const s=Math.max(S.docW/img.naturalWidth,S.docH/img.naturalHeight);
  const w=img.naturalWidth*s,h=img.naturalHeight*s;
  fx.drawImage(img,(S.docW-w)/2,(S.docH-h)/2,w,h);
  fx.globalCompositeOperation="destination-in";fx.drawImage(inv,0,0);
  canvasCtx(L.canvas).drawImage(fill,0,0);
  L.version++;invalidateAdj(L);render();renderLayerList();markDirty();
  toast("Background replaced with image");
}
/* Transform (free transform / perspective) */
function startTransform(mode){
  const L=activeLayer();
  if(!L||!L.canvas){toast("Select a layer with pixels first");return;}
  if(L.kind==="text"||L.kind==="shape")rasterizeIfVector(L);
  const b=layerBounds(L)||{x:0,y:0,w:S.docW,h:S.docH};
  let quad;
  if(L.kind==="text"||L.kind==="shape"){quad=[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}];}
  else quad=[{x:0,y:0},{x:S.docW,y:0},{x:S.docW,y:S.docH},{x:0,y:S.docH}];
  S.transform={mode:mode,layerId:L.id,quad:quad,origData:L.canvas.toDataURL("image/png"),handle:null,live:true};
  setTool(mode==="perspective"?"perspective":"transform");
  render();toast(mode==="perspective"?"Perspective: drag the 4 corners, then Apply":"Free transform: drag corners to scale, edges to shear, top circle to rotate, then Apply");
}
function transformHandleAt(p){
  const T=S.transform;if(!T)return null;
  const q=T.quad;
  for(let i=0;i<4;i++)if(Math.hypot(p.x-q[i].x,p.y-q[i].y)<14)return {kind:"corner",i:i};
  if(T.mode==="transform"){
    const mids=[{x:(q[0].x+q[1].x)/2,y:(q[0].y+q[1].y)/2,k:"shearH"},
      {x:(q[1].x+q[2].x)/2,y:(q[1].y+q[2].y)/2,k:"shearV"},
      {x:(q[2].x+q[3].x)/2,y:(q[2].y+q[3].y)/2,k:"shearH"},
      {x:(q[3].x+q[0].x)/2,y:(q[3].y+q[0].y)/2,k:"shearV"}];
    for(const m of mids)if(Math.abs(p.x-m.x)<12&&Math.abs(p.y-m.y)<12)return {kind:m.k};
    const rx2=(q[0].x+q[1].x)/2,ry2=Math.min(q[0].y,q[1].y)-44;
    if(Math.hypot(p.x-rx2,p.y-ry2)<14)return {kind:"rotate"};
  }
  return null;
}
function applyTransform(){
  const T=S.transform;if(!T)return;
  const L=findLayer(T.layerId);
  if(!L||!L.canvas){S.transform=null;render();return;}
  pushUndo("Free transform");
  const src=makeCanvas(S.docW,S.docH);
  const im=new Image();
  im.onload=()=>{
    src.getContext("2d").drawImage(im,0,0);
    const out=makeCanvas(S.docW,S.docH),ox=out.getContext("2d");
    drawQuadImage(ox,src,T.quad);
    const ctx=canvasCtx(L.canvas);ctx.clearRect(0,0,S.docW,S.docH);ctx.drawImage(out,0,0);
    if(L.mask){ // keep the mask roughly aligned: same quad on the mask
      const mout=makeCanvas(S.docW,S.docH),mx=mout.getContext("2d");
      drawQuadImage(mx,L.mask,T.quad);
      const mc=canvasCtx(L.mask);mc.clearRect(0,0,S.docW,S.docH);mc.drawImage(mout,0,0);}
    L.version++;invalidateAdj(L);
    S.transform=null;render();renderLayerList();markDirty();toast("Transform applied");
  };
  im.onerror=()=>{S.transform=null;render();toast("Transform failed");};
  im.src=T.origData;
}
function cancelTransform(){S.transform=null;render();toast("Transform cancelled");}
/* Design studio */
function newDesignDoc(w,h,transparent,name){
  epHist.clear();clearHistLog();
  S.docW=w;S.docH=h;S.straighten=0;S.layers=[];S.sel=null;S.cropRect=null;S.cloneSrc=null;S.transform=null;
  const bg=newLayer(name||("Design "+w+"×"+h),"paint");
  if(!transparent){const x=canvasCtx(bg.canvas);x.fillStyle="#ffffff";x.fillRect(0,0,w,h);}
  S.layers.push(bg);S.activeId=bg.id;S.hasDoc=true;
  S.projectName=name||("Design "+w+"×"+h);
  $("projectName").value=S.projectName;
  $("emptyState").classList.add("hidden");$("dropHint").hidden=true;
  render();renderLayerList();fitZoom();markDirty();
  saveProject(true).then(()=>toast("New "+w+"×"+h+" canvas — saved"));
}
function newCollageDoc(){
  newDesignDoc(1080,1080,false,"Collage 2×2");
  // 4 empty quadrant layers (transparent — no placeholder artwork is
  // ever drawn on the canvas; open images and add them as layers, one
  // per quadrant, then move each into place)
  const quads=[{x:0,y:0},{x:540,y:0},{x:0,y:540},{x:540,y:540}];
  quads.forEach((q,i)=>{
    const L=newLayer("Photo "+(i+1),"paint");
    S.layers.push(L);});
  S.activeId=S.layers[S.layers.length-1].id;
  render();renderLayerList();markDirty();
  toast("Collage 2×2 ready — open images and drag them in as layers, one per quadrant");
}
function applyFrame(style){
  if(!S.hasDoc){toast("Open or create a canvas first");return;}
  pushUndo("Add frame");
  const L=newLayer("Frame ("+style+")","paint");
  const x=canvasCtx(L.canvas),m=Math.min(S.docW,S.docH);
  if(style==="simple"){x.strokeStyle="#111111";x.lineWidth=Math.max(4,m*0.02);x.strokeRect(x.lineWidth/2,x.lineWidth/2,S.docW-x.lineWidth,S.docH-x.lineWidth);}
  else if(style==="double"){
    x.strokeStyle="#111111";x.lineWidth=Math.max(4,m*0.02);x.strokeRect(8,8,S.docW-16,S.docH-16);
    x.strokeStyle="#ffffff";x.lineWidth=3;x.strokeRect(22,22,S.docW-44,S.docH-44);
    x.strokeStyle="#111111";x.lineWidth=2;x.strokeRect(28,28,S.docW-56,S.docH-56);}
  else if(style==="polaroid"){
    const bw=Math.round(m*0.06);
    x.fillStyle="#ffffff";x.fillRect(0,0,S.docW,S.docH);
    x.globalCompositeOperation="destination-out";
    x.fillRect(bw,bw,S.docW-bw*2,S.docH-bw*3); // photo window; bottom stays white
    x.globalCompositeOperation="source-over";}
  else if(style==="rounded"){
    const r=Math.round(m*0.08);
    x.strokeStyle="#111111";x.lineWidth=Math.max(4,m*0.02);
    x.beginPath();
    x.moveTo(r,0);x.lineTo(S.docW-r,0);x.arcTo(S.docW,0,S.docW,r,r);
    x.lineTo(S.docW,S.docH-r);x.arcTo(S.docW,S.docH,S.docW-r,S.docH,r);
    x.lineTo(r,S.docH);x.arcTo(0,S.docH,0,S.docH-r,r);
    x.lineTo(0,r);x.arcTo(0,0,r,0,r);x.closePath();x.stroke();}
  S.layers.push(L);S.activeId=L.id;
  render();renderLayerList();markDirty();toast("Frame added: "+style);
}
function fillLayerOrSel(kind){
  if(!S.hasDoc){toast("Open or create a canvas first");return;}
  const c1=$("fillColor1").value,c2=$("fillColor2").value;
  const paintOn=(ctx,w,h)=>{
    if(kind==="linear"){const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,c1);g.addColorStop(1,c2);ctx.fillStyle=g;}
    else if(kind==="radial"){const g=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.max(w,h)/2);g.addColorStop(0,c1);g.addColorStop(1,c2);ctx.fillStyle=g;}
    else if(kind==="checker"){
      const s=32,t=makeCanvas(s*2,s*2),tx=t.getContext("2d");
      tx.fillStyle=c1;tx.fillRect(0,0,s*2,s*2);tx.fillStyle=c2;
      tx.fillRect(0,0,s,s);tx.fillRect(s,s,s,s);
      ctx.fillStyle=ctx.createPattern(t,"repeat");}
    else if(kind==="dots"){
      const s=28,t=makeCanvas(s,s),tx=t.getContext("2d");
      tx.fillStyle=c1;tx.fillRect(0,0,s,s);tx.fillStyle=c2;
      tx.beginPath();tx.arc(s/2,s/2,6,0,Math.PI*2);tx.fill();
      ctx.fillStyle=ctx.createPattern(t,"repeat");}
    else{ // lines
      const s=24,t=makeCanvas(s,s),tx=t.getContext("2d");
      tx.fillStyle=c1;tx.fillRect(0,0,s,s);tx.strokeStyle=c2;tx.lineWidth=4;
      tx.beginPath();tx.moveTo(0,s);tx.lineTo(s,0);tx.stroke();
      ctx.fillStyle=ctx.createPattern(t,"repeat");}
    ctx.fillRect(0,0,w,h);};
  if(S.sel){
    pushUndo("Fill selection");
    const L=activeLayer();if(!L||!L.canvas){toast("Select a layer first");return;}
    const mask=buildSelMask();
    const t=makeCanvas(S.docW,S.docH),tx=t.getContext("2d");
    paintOn(tx,S.docW,S.docH);
    tx.globalCompositeOperation="destination-in";tx.drawImage(mask,0,0);
    canvasCtx(L.canvas).drawImage(t,0,0);
    L.version++;invalidateAdj(L);render();renderLayerList();markDirty();
    toast("Selection filled with "+kind);return;}
  pushUndo("Fill layer");
  const L=newLayer(kind+" fill","paint");
  paintOn(canvasCtx(L.canvas),S.docW,S.docH);
  S.layers.push(L);S.activeId=L.id;
  render();renderLayerList();markDirty();toast("New layer filled with "+kind);
}
const OPT_FOR_TOOL={move:null,brush:"optBrush",pencil:"optBrush",airbrush:"optBrush",
  blurbrush:"optBrush",sharpenbrush:"optBrush",smudge:"optBrush",dodge:"optBrush",burn:"optBrush",
  sponge:"optBrush",eraser:"optBrush",crop:"optCrop",
  rectsel:"optSelect",ellipsesel:"optSelect",lasso:"optSelect",polylasso:"optSelect",
  quicksel:"optSelect",wand:"optSelect",colorrange:"optSelect",
  clone:"optClone",healing:"optClone",spotheal:"optRetouch",redeye:"optRetouch",
  whiten:"optRetouch",smoothbrush:"optRetouch",localexp:"optRetouch",
  text:"optText",shape:"optShape",picker:"optBrush",bucket:"optBucket",
  transform:"optTransform",perspective:"optTransform",
  gradient:"optGradient",hand:null,zoom:null};
/* Tool groups in the left toolbar: one canonical button per group; picking a
   variant updates the canonical button's icon + label to that variant. */
const GROUP_OF={rectsel:"selection",ellipsesel:"selection",lasso:"selection",polylasso:"selection",
  quicksel:"selection",wand:"selection",colorrange:"selection",
  brush:"brush",pencil:"brush",airbrush:"brush",blurbrush:"brush",sharpenbrush:"brush",
  smudge:"brush",dodge:"brush",burn:"brush",sponge:"brush",
  clone:"clone",healing:"clone",spotheal:"clone",redeye:"clone"};
const GROUP_BTN={selection:"toolSelection",brush:"toolBrush",clone:"toolCloneHeal"};
const GROUP_LABEL={selection:"Selection",brush:"Brush",clone:"Clone/Heal"};
const TOOL_ICON={move:"move",rectsel:"square",ellipsesel:"circle",lasso:"lasso",polylasso:"shapes",
  quicksel:"wand",wand:"sparkles",colorrange:"palette",crop:"crop",brush:"brush",pencil:"pencil",
  airbrush:"wind",blurbrush:"blend",sharpenbrush:"zoom-in",smudge:"hand",dodge:"sun-medium",
  burn:"moon",sponge:"droplet",eraser:"eraser",clone:"stamp",healing:"bandage",spotheal:"plus",
  redeye:"eye",text:"type",shape:"square",gradient:"gradient",hand:"hand",zoom:"zoom-in",
  picker:"eyedropper",bucket:"paint-bucket",transform:"frame",perspective:"ruler"};
function closeToolPops(){
  document.querySelectorAll(".tool-pop").forEach(p=>{p.hidden=true;});
  document.querySelectorAll(".menu-btn.open").forEach(b=>b.classList.remove("open"));
}
function setTool(t){
  if(S.transform&&(t!=="transform"&&t!=="perspective"))S.transform=null; // leaving transform discards the unapplied quad
  S.tool=t;S.editMask=false;$("btnEditMask").classList.remove("on");$("optMask").hidden=true;
  closeToolPops();
  document.querySelectorAll(".tool-btn").forEach(b=>b.classList.toggle("on",b.dataset.tool===t));
  // sync the group button (icon + label) to the chosen variant
  const g=GROUP_OF[t];
  if(g){
    const gb=$(GROUP_BTN[g]);
    if(gb){gb.dataset.tool=t;
      const ico=gb.querySelector(".ico");if(ico&&TOOL_ICON[t])epSetIcon(ico,TOOL_ICON[t],20);
      const lab=gb.querySelector("span:not(.ico):not(.fly)");if(lab)lab.textContent=toolName(t);
      gb.title=toolName(t)+" — click to open the "+GROUP_LABEL[g].toLowerCase()+" flyout";
    }
  }
  document.querySelectorAll(".opt-group").forEach(g2=>{g2.hidden=true;});
  const opt=OPT_FOR_TOOL[t];if(opt)$(opt).hidden=false;
  if(t==="clone"||t==="healing")$("cloneStatus").textContent=S.cloneSrc?
    "Source set at "+Math.round(S.cloneSrc.x)+", "+Math.round(S.cloneSrc.y)+" — now paint to clone.":
    "No source set. Alt-click (or long-press on touch) on the canvas to sample a source point, then paint.";
  $("photoCanvas").style.cursor=t==="move"?"default":t==="hand"?"grab":t==="picker"?"copy":"crosshair";
  updateStatus();
}
/* PHASE 5 — bindings for the new tools/panels (called from init) */
function bindPhase5(){
  // brush flow / strength
  $("brushFlow").addEventListener("input",e=>{S.brush.flow=+e.target.value;$("brushFlowVal").textContent=e.target.value+"%";});
  $("brushStrength").addEventListener("input",e=>{S.brush.strength=+e.target.value;$("brushStrengthVal").textContent=e.target.value+"%";});
  // selection: tolerance, expand/contract, refine edges, background
  $("selTolerance").addEventListener("input",e=>{$("selToleranceVal").textContent=e.target.value;});
  $("btnSelExpand").onclick=selOpExpand;
  $("btnSelContract").onclick=selOpContract;
  $("refineExpand").addEventListener("input",e=>{$("refineExpandVal").textContent=e.target.value+"px";});
  $("refineContract").addEventListener("input",e=>{$("refineContractVal").textContent=e.target.value+"px";});
  $("btnRefineApply").onclick=()=>{
    if(!S.sel){toast("Make a selection first");return;}
    S.sel.expand=+$("refineExpand").value;S.sel.contract=+$("refineContract").value;
    S.sel.feather=+$("selFeather").value;render();
    toast("Refine applied — feather "+S.sel.feather+"px, expand "+S.sel.expand+"px, contract "+S.sel.contract+"px");};
  $("btnRefineReset").onclick=()=>{
    $("refineExpand").value=0;$("refineExpandVal").textContent="0px";
    $("refineContract").value=0;$("refineContractVal").textContent="0px";
    if(S.sel){S.sel.expand=0;S.sel.contract=0;render();}
    toast("Refine reset");};
  $("btnBgDelete").onclick=bgDelete;
  $("btnBgFillColor").onclick=bgFillColor;
  $("btnBgFillImage").onclick=()=>$("bgImageInput").click();
  $("bgImageInput").addEventListener("change",e=>{
    const f=e.target.files[0];if(!f)return;
    const url=URL.createObjectURL(f),img=new Image();
    img.onload=()=>{URL.revokeObjectURL(url);bgFillImage(img);};
    img.onerror=()=>{URL.revokeObjectURL(url);toast("Could not read that image");};
    img.src=url;e.target.value="";});
  // retouch
  $("localExpAmt").addEventListener("input",e=>{$("localExpAmtVal").textContent=(+e.target.value>=0?"+":"")+e.target.value;});
  $("skinWarmth").addEventListener("input",e=>{$("skinWarmthVal").textContent=(+e.target.value>=0?"+":"")+e.target.value;});
  $("skinSmooth").addEventListener("input",e=>{$("skinSmoothVal").textContent=e.target.value;});
  $("btnApplySkin").onclick=applySkinTone;
  $("selColorHue").addEventListener("input",e=>{$("selColorHueVal").textContent=e.target.value+"°";});
  $("selColorSat").addEventListener("input",e=>{$("selColorSatVal").textContent=e.target.value;});
  $("selColorLight").addEventListener("input",e=>{$("selColorLightVal").textContent=e.target.value;});
  $("btnPickSelColor").onclick=()=>{
    S.pickingSelColor=true;setTool("picker");
    toast("Tap the canvas to pick the color for selective color");};
  $("btnApplySelColor").onclick=applySelectiveColor;
  // transform
  $("btnApplyTransform").onclick=applyTransform;
  $("btnCancelTransform").onclick=()=>{cancelTransform();setTool("move");};
  // layers: groups, merge, flatten, clipping, adjustment layers
  $("btnAddGroup").onclick=()=>{
    if(!S.hasDoc){toast("Open an image first");return;}
    pushUndo("Group layers");
    const g=newLayer("Group","group");
    const L=activeLayer();
    if(L){
      const list=parentListOf(L.id);
      const i=list.indexOf(L);
      list.splice(i,1);g.children.push(L);
    }
    S.layers.push(g);S.activeId=g.id;
    render();renderLayerList();markDirty();
    toast("Group created — the active layer moved inside it. Drag more layers onto it to add them.");};
  $("btnUngroup").onclick=()=>{
    const L=activeLayer();if(!L||L.kind!=="group")return;
    pushUndo("Ungroup");
    const list=parentListOf(L.id),i=list.indexOf(L);
    list.splice(i,1,...(L.children||[]));
    S.activeId=S.layers.length?S.layers[S.layers.length-1].id:null;
    render();renderLayerList();markDirty();toast("Group ungrouped");};
  $("btnMergeDown").onclick=()=>{
    const leaves=allLeaves();
    const i=leaves.findIndex(l=>l.id===S.activeId);
    if(i<1){toast("Nothing below to merge into");return;}
    const top=leaves[i],below=leaves[i-1];
    if(!top.canvas||!below.canvas||top.locked||below.locked){toast("Both layers must be unlocked pixel layers");return;}
    pushUndo("Merge down");
    const ctx=canvasCtx(below.canvas);
    ctx.save();ctx.globalAlpha=clamp(top.opacity,0,100)/100;
    ctx.globalCompositeOperation=BLENDS.includes(top.blend)?top.blend:"source-over";
    ctx.drawImage(layerRendered(top),0,0);ctx.restore();
    below.version++;invalidateAdj(below);
    const list=parentListOf(top.id);list.splice(list.indexOf(top),1);
    S.activeId=below.id;
    render();renderLayerList();markDirty();toast("Merged down into "+below.name);};
  $("btnFlatten").onclick=()=>{
    if(!S.hasDoc)return;
    pushUndo("Flatten image");
    const flat=makeCanvas(S.docW,S.docH);
    compositeTo(flat.getContext("2d"),S.docW,S.docH);
    const L=newLayer("Background","image");
    canvasCtx(L.canvas).drawImage(flat,0,0);
    S.layers=[L];S.activeId=L.id;
    render();renderLayerList();markDirty();toast("Image flattened to one layer");};
  $("btnClipMask").onclick=()=>{
    const L=activeLayer();if(!L||!L.canvas)return;
    pushUndo("Toggle clipping mask");L.clip=!L.clip;render();renderLayerList();markDirty();
    toast(L.clip?"Clipped to the layer below":"Clipping removed");};
  $("btnAdjLayer").onclick=()=>{
    if(!S.hasDoc){toast("Open an image first");return;}
    pushUndo("Add adjustment layer");
    const L=newLayer("Adjustment","adjlayer");
    S.layers.push(L);S.activeId=L.id;
    render();renderLayerList();loadAdjPanel();markDirty();
    toast("Adjustment layer added — edit it with the Adjustments panel; layers below change, this layer stays non-destructive");};
  // advanced adjustments: levels / HSL / color balance / LUT
  const advUndo={armed:false};
  const advBind=(id,fn)=>{
    const el=$(id);
    el.addEventListener("pointerdown",()=>{advUndo.armed=false;});
    el.addEventListener("input",()=>{
      if(!advUndo.armed){pushUndo("Advanced adjustments");advUndo.armed=true;}
      fn(+el.value);});
    el.addEventListener("change",()=>{advUndo.armed=false;});
  };
  advBind("levelsBlack",v=>{const L=activeLayer();if(!L)return;L.adj.levels.black=v;$("levelsBlackVal").textContent=v;invalidateAdj(L);render();markDirty();});
  advBind("levelsWhite",v=>{const L=activeLayer();if(!L)return;L.adj.levels.white=v;$("levelsWhiteVal").textContent=v;invalidateAdj(L);render();markDirty();});
  advBind("levelsGamma",v=>{const L=activeLayer();if(!L)return;L.adj.levels.gamma=v/100;$("levelsGammaVal").textContent=(v/100).toFixed(2);invalidateAdj(L);render();markDirty();});
  advBind("hslHue",v=>{const L=activeLayer();if(!L)return;L.adj.hsl.h=v;$("hslHueVal").textContent=v+"°";invalidateAdj(L);render();markDirty();});
  advBind("hslSat",v=>{const L=activeLayer();if(!L)return;L.adj.hsl.s=v;$("hslSatVal").textContent=v;invalidateAdj(L);render();markDirty();});
  advBind("hslLight",v=>{const L=activeLayer();if(!L)return;L.adj.hsl.l=v;$("hslLightVal").textContent=v;invalidateAdj(L);render();markDirty();});
  const cbBind=(id,zone,i)=>{
    advBind(id,v=>{const L=activeLayer();if(!L)return;L.adj.cb[zone][i]=v;$(id+"Val").textContent=v;invalidateAdj(L);render();markDirty();});
  };
  cbBind("cbShR","sh",0);cbBind("cbShG","sh",1);cbBind("cbShB","sh",2);
  cbBind("cbMidR","mid",0);cbBind("cbMidG","mid",1);cbBind("cbMidB","mid",2);
  cbBind("cbHiR","hi",0);cbBind("cbHiG","hi",1);cbBind("cbHiB","hi",2);
  advBind("lutIntensity",v=>{const L=activeLayer();if(!L)return;L.adj.lutIntensity=v;$("lutIntensityVal").textContent=v+"%";invalidateAdj(L);render();markDirty();});
  $("btnLutImport").onclick=()=>$("lutFileInput").click();
  $("lutFileInput").addEventListener("change",e=>{
    const f=e.target.files[0];if(!f)return;
    const r=new FileReader();
    r.onload=()=>{
      const lut=parseCube(String(r.result));
      if(!lut){toast("That .cube file could not be parsed");return;}
      const L=activeLayer();
      if(!L){toast("Select a layer first");return;}
      pushUndo("Apply LUT");
      const key=f.name.replace(/\.[^.]+$/,"")+" ("+lut.size+")";
      LUT_STORE[key]=lut;L.adj.lutName=key;L.adj.lutIntensity=100;
      $("lutIntensity").value=100;$("lutIntensityVal").textContent="100%";
      invalidateAdj(L);loadAdjPanel();render();markDirty();
      toast("LUT loaded: "+key);
    };
    r.readAsText(f);e.target.value="";});
  bindCurves();
  // design studio
  document.querySelectorAll("[data-design]").forEach(b=>b.addEventListener("click",()=>{
    if(b.dataset.design==="collage"){newCollageDoc();return;}
    const [w,h]=b.dataset.design.split("x").map(Number);
    newDesignDoc(w,h,$("designTransparent").checked,b.textContent.trim());
  }));
  $("btnNewDesign").onclick=()=>{
    const w=clamp(+$("designW").value||1080,1,8000),h=clamp(+$("designH").value||1080,1,8000);
    newDesignDoc(w,h,$("designTransparent").checked,"Custom "+w+"×"+h);};
  document.querySelectorAll("[data-frame]").forEach(b=>b.addEventListener("click",()=>applyFrame(b.dataset.frame)));
  $("btnFillLayer").onclick=()=>fillLayerOrSel($("fillKind").value);
  $("btnFillSel").onclick=()=>{
    if(!S.sel){toast("Make a selection first, then fill it");return;}
    fillLayerOrSel($("fillKind").value);};
  // status-bar zoom controls (same actions as the left zoom row — touch-friendly)
  $("zoomOut2").onclick=()=>{S.zoom=clamp(S.zoom/1.25,0.05,4);applyZoom();};
  $("zoomIn2").onclick=()=>{S.zoom=clamp(S.zoom*1.25,0.05,4);applyZoom();};
  $("zoomFit2").onclick=fitZoom;
  $("zoom100").onclick=()=>{S.zoom=1;applyZoom();};
}
/* ================= PHASE 2+3 — menu bar, right tabs, modals ================= */
/* Single-modal rule: showModal() hides every other modal first. */
function showModal(id){
  document.querySelectorAll(".modal").forEach(m=>{m.hidden=true;});
  const m=$(id);if(m)m.hidden=false;
}
function hideModals(){
  document.querySelectorAll(".modal").forEach(m=>{m.hidden=true;});
}
function closeMenus(){
  document.querySelectorAll(".menu-list").forEach(m=>{if(m.id!=="overflowMenu"&&m.id!=="moreSheet")m.hidden=true;});
  document.querySelectorAll(".menu-btn.open").forEach(b=>b.classList.remove("open"));
}
function switchRightTab(name){
  document.querySelectorAll(".rtab[data-tab]").forEach(b=>b.classList.toggle("on",b.dataset.tab===name));
  ["layers","properties","adjustments","history"].forEach(n=>{
    const p=$("tab"+n[0].toUpperCase()+n.slice(1));if(p)p.hidden=(n!==name);});
  if(name==="history")renderHistory();
  if(name==="adjustments")loadAdjPanel();
}
function openRight(tab){
  $("photoRight").classList.add("open");
  if(tab)switchRightTab(tab);
}
function copyLayer(){
  const L=activeLayer();
  if(!L){toast("Select a layer first");return;}
  S.clipLayer=serializeLayer(L);
  toast("Copied layer “"+L.name+"”");
}
function pasteLayer(){
  const c=S.clipLayer;
  if(!c){toast("Nothing copied yet — use Copy Layer first");return;}
  if(!S.hasDoc){toast("Open an image first");return;}
  if(c.kind==="group"){toast("Groups cannot be pasted — use Duplicate on the group instead");return;}
  pushUndo("Paste layer");
  const L=newLayer((c.name||"Layer")+" copy",c.kind);
  Object.assign(L,{opacity:c.opacity,blend:c.blend,visible:c.visible,locked:false,
    adj:c.adj?JSON.parse(JSON.stringify(c.adj)):defaultAdj(),
    text:c.text?{...c.text}:null,shape:c.shape?{...c.shape}:null,clip:!!c.clip});
  const done=()=>{S.layers.push(L);S.activeId=L.id;
    if(L.kind==="text"&&L.text)rasterizeTextLayer(L);
    if(L.kind==="shape"&&L.shape)rasterizeShapeLayer(L);
    render();renderLayerList();markDirty();toast("Layer pasted");};
  if(c.data&&L.canvas){
    const im=new Image();
    im.onload=()=>{canvasCtx(L.canvas).drawImage(im,0,0);done();};
    im.onerror=()=>done();
    im.src=c.data;
  }else done();
}
function showHelp(kind){
  const t=$("helpTitle"),b=$("helpBody");
  if(kind==="shortcuts"){
    t.textContent="Keyboard shortcuts";
    b.innerHTML='<div class="help-keys">'
      +'<b>Ctrl+O</b><span>Open image</span>'
      +'<b>Ctrl+S</b><span>Save project</span>'
      +'<b>Ctrl+Z / Ctrl+Y</b><span>Undo / Redo</span>'
      +'<b>V / B / E / C</b><span>Move / Brush / Eraser / Crop</span>'
      +'<b>M / L / T / U</b><span>Rect select / Lasso / Text / Shape</span>'
      +'<b>H / Z / I / G</b><span>Hand / Zoom / Picker / Bucket</span>'
      +'<b>X</b><span>Swap foreground / background colors</span>'
      +'<b>Esc</b><span>Clear selection / close panels</span>'
      +'<b>Enter</b><span>Close polygon lasso</span>'
      +'</div><p class="hint">On touch: drag with one finger to use the tool, pinch to zoom, drag with two fingers to pan.</p>';
  }else{
    t.textContent="About Editora Pro";
    b.innerHTML='<p>Editora Pro — a free photo + video editor. No ads, no watermark, no login, no AI.</p>'
      +'<p class="hint">Photo editor: layers, masks, selections, clone/healing, curves, HSL, LUTs, filters and PNG / JPG / WebP export. Projects save locally in this browser (IndexedDB).</p>'
      +'<p class="hint">Photo editor rebuild (Phases 2 + 3), project format v1.</p>';
  }
  showModal("helpModal");
}
function openSavedModal(){
  const box=$("savedProjectList");if(!box)return;
  box.innerHTML='<p class="hint">Loading…</p>';
  showModal("savedModal");
  dbKeys().then(keys=>{
    const names=keys.filter(k=>k!=="__autosave__");
    box.innerHTML="";
    if(!names.length){box.innerHTML='<p class="hint">No saved projects yet.</p>';return;}
    names.forEach(n=>{
      const b=document.createElement("button");
      b.textContent=n;
      b.onclick=()=>{hideModals();loadSaved(n);};
      box.appendChild(b);});
  }).catch(()=>{box.innerHTML='<p class="hint">Could not list saved projects.</p>';});
}
function buildFilterMenu(){
  const list=$("menuFilter");if(!list)return;
  list.innerHTML="";
  Object.keys(FILTER_PRESETS).forEach(name=>{
    const b=document.createElement("button");
    b.className="menu-item";b.textContent=name;b.dataset.filter=name;
    b.onclick=()=>{
      closeMenus();
      const gridBtn=[...document.querySelectorAll("#filterGrid button")].find(x=>x.dataset.filter===name);
      if(gridBtn)gridBtn.click();
      else toast("Open an image first");};
    list.appendChild(b);});
}
const MENU_ACTIONS={
  open:()=>$("photoFileInput").click(),
  newBlank:()=>{if(S.dirty&&!confirm("Start a new blank photo? Unsaved changes will be lost."))return;blankDoc();},
  newPreset:()=>showModal("presetModal"),
  save:()=>saveProject(false),
  openSaved:()=>openSavedModal(),
  backup:()=>{
    if(!S.hasDoc){toast("Nothing to back up yet");return;}
    const blob=new Blob([JSON.stringify(EPProjectStore.makePhotoBackup(serialize()),null,1)],{type:"application/json"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);
    a.download=(S.projectName||"photo")+".editora-photo.json";a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),5000);toast("Project backup downloaded");},
  restore:()=>$("projectFileInput").click(),
  export:()=>exportPhoto(),
  closeProject:()=>{
    if(S.dirty)saveProject(true);
    S.layers=[];S.activeId=null;S.hasDoc=false;S.sel=null;S.cropRect=null;S.transform=null;
    S.docW=1200;S.docH=800;
    $("emptyState").classList.remove("hidden");
    renderLayerList();updateStatus();toast("Project closed — autosaved");},
  undo:()=>doUndo(), redo:()=>doRedo(),
  copyLayer:()=>copyLayer(), pasteLayer:()=>pasteLayer(),
  dupLayer:()=>$("btnDupLayer").click(),
  selectAll:()=>{if(!S.hasDoc){toast("Open an image first");return;}
    S.sel={type:"rect",rect:{x:0,y:0,w:S.docW,h:S.docH},feather:0,inverted:false};
    render();toast("Selected the whole canvas");},
  deselect:()=>{S.sel=null;S.lassoPath=null;render();toast("Selection cleared");},
  invertSel:()=>selOpInvert(),
  fillSel:()=>selOpFill(),
  featherSel:()=>{const v=prompt("Feather radius (px, 0–50):",""+($("selFeather").value||0));
    if(v===null)return;const n=clamp(Math.round(+v)||0,0,50);
    $("selFeather").value=n;$("selFeatherVal").textContent=n+"px";
    if(S.sel){S.sel.feather=n;render();}toast("Feather set to "+n+"px");},
  expandSel:()=>selOpExpand(), contractSel:()=>selOpContract(),
  rotateL:()=>doRotate(-1), rotateR:()=>doRotate(1),
  flipH:()=>doFlip(true), flipV:()=>doFlip(false),
  resize:()=>{openRight("properties");setTool("crop");setTimeout(()=>$("resizeW").focus(),50);},
  straighten:()=>{openRight("properties");setTool("crop");setTimeout(()=>$("straighten").focus(),50);},
  cropToSel:()=>selOpCrop(),
  imgInfo:()=>{if(!S.hasDoc){toast("No image open");return;}
    toast(S.docW+"×"+S.docH+" px • "+allLeaves().length+" layers • sRGB • zoom "+Math.round(S.zoom*100)+"%");},
  layerNew:()=>$("btnAddLayer").click(),
  layerDelete:()=>$("btnDelLayer").click(),
  layerRename:()=>{const L=activeLayer();if(!L){toast("Select a layer first");return;}
    const n=prompt("Rename layer:",L.name);
    if(n!==null&&n.trim()){pushUndo("Rename layer");L.name=n.trim();renderLayerList();markDirty();}},
  layerUp:()=>$("btnLayerUp").click(),
  layerDown:()=>$("btnLayerDown").click(),
  layerGroup:()=>$("btnAddGroup").click(),
  layerUngroup:()=>$("btnUngroup").click(),
  layerMerge:()=>$("btnMergeDown").click(),
  layerFlatten:()=>$("btnFlatten").click(),
  layerClip:()=>$("btnClipMask").click(),
  layerAdj:()=>$("btnAdjLayer").click(),
  layerMask:()=>$("btnAddMask").click(),
  zoomIn:()=>{S.zoom=clamp(S.zoom*1.25,0.05,4);applyZoom();},
  zoomOut:()=>{S.zoom=clamp(S.zoom/1.25,0.05,4);applyZoom();},
  zoomFit:()=>fitZoom(),
  zoom100:()=>{S.zoom=1;applyZoom();},
  rotateView:()=>{S.viewRot=(S.viewRot+1)%4;fitZoom();applyZoom();
    toast(S.viewRot?("View rotated "+(S.viewRot*90)+"° — view only, pixels unchanged. Rotate back to 0° before painting."):"View rotation cleared");},
  toggleTheme:()=>$("btnThemePhoto").click(),
  toggleLeft:()=>{$("photoLeft").classList.toggle("open");},
  toggleRight:()=>{$("photoRight").classList.toggle("open");},
  shortcuts:()=>showHelp("shortcuts"),
  about:()=>showHelp("about"),
  history:()=>openRight("history"),
  filters:()=>openRight("adjustments"),
};
function bindPhotoShell(){
  // menu buttons toggle their dropdown (one at a time)
  document.querySelectorAll(".menu-btn").forEach(btn=>{
    btn.addEventListener("click",e=>{
      e.stopPropagation();
      const list=$("menu"+btn.dataset.menu[0].toUpperCase()+btn.dataset.menu.slice(1));
      const wasHidden=!list||list.hidden;
      closeMenus();
      if(list&&wasHidden){list.hidden=false;btn.classList.add("open");}
    });
  });
  document.addEventListener("click",e=>{
    if(!e.target.closest(".menu")&&!e.target.closest("#overflowMenu")&&!e.target.closest("#moreSheet"))closeMenus();
    if(!e.target.closest(".tool-pop")&&!e.target.closest("[data-group]"))closeToolPops();
    if(!e.target.closest("#moreSheet")&&!e.target.closest("#btnNavMore"))$("moreSheet").hidden=true;
    if(!e.target.closest("#overflowMenu")&&!e.target.closest("#btnOverflow"))$("overflowMenu").hidden=true;
  });
  // every [data-act] button runs its menu action
  document.addEventListener("click",e=>{
    const el=e.target.closest("[data-act]");
    if(!el)return;
    const act=el.dataset.act;
    closeMenus();$("moreSheet").hidden=true;$("overflowMenu").hidden=true;
    if(act.indexOf("tool:")===0){setTool(act.slice(5));return;}
    const fn=MENU_ACTIONS[act];
    if(fn)fn();else toast("That action is not available yet");
  });
  // group flyouts on the left toolbar (bound after the generic .tool-btn
  // binding in init, so setTool runs first and this re-opens the flyout)
  const groupPop={selection:"popSelection",brush:"popBrush",clone:"popClone"};
  document.querySelectorAll("[data-group]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const pop=$(groupPop[btn.dataset.group]);
      if(!pop)return;
      const wasHidden=pop.hidden;
      closeToolPops();
      if(wasHidden)pop.hidden=false;
    });
  });
  // right-panel tabs
  document.querySelectorAll(".rtab[data-tab]").forEach(b=>{
    b.addEventListener("click",()=>{openRight(b.dataset.tab);});
  });
  $("btnCloseRight").onclick=()=>$("photoRight").classList.remove("open");
  $("btnHistUndo").onclick=doUndo;$("btnHistRedo").onclick=doRedo;
  $("btnHistClear").onclick=()=>{epHist.clear();clearHistLog();toast("History cleared");};
  // export modal
  $("btnExportCancel").onclick=()=>{S.pendingExport=null;hideModals();};
  $("btnDoExport").onclick=confirmExport;
  // saved modal
  $("btnSavedClose").onclick=hideModals;
  // preset modal (its preset buttons carry data-design, bound in bindPhase5)
  $("btnPresetClose").onclick=hideModals;
  document.querySelectorAll("#presetModal [data-design]").forEach(b=>{
    b.addEventListener("click",()=>hideModals());
  });
  // help modal
  $("btnHelpClose").onclick=hideModals;
  // backdrop click closes any modal
  document.querySelectorAll(".modal").forEach(m=>{
    m.addEventListener("click",e=>{if(e.target===m)hideModals();});
  });
  // overflow (mobile top bar)
  $("btnOverflow").onclick=e=>{e.stopPropagation();
    const m=$("overflowMenu");m.hidden=!m.hidden;};
  // mobile bottom nav: Tools / Layers / Adjust / Text / More
  $("btnNavTools").onclick=()=>{$("photoRight").classList.remove("open");
    $("photoLeft").classList.toggle("open");};
  $("btnNavLayers").onclick=()=>{$("photoLeft").classList.remove("open");openRight("layers");};
  $("btnNavAdjust").onclick=()=>{$("photoLeft").classList.remove("open");openRight("adjustments");};
  $("btnNavText").onclick=()=>{$("photoLeft").classList.remove("open");setTool("text");openRight("properties");};
  $("btnNavMore").onclick=e=>{e.stopPropagation();
    const m=$("moreSheet");m.hidden=!m.hidden;};
  $("btnCloseLeft").onclick=()=>$("photoLeft").classList.remove("open");
  $("btnToolSettings").onclick=()=>{$("photoLeft").classList.remove("open");openRight("properties");};
  // foreground / background colors
  $("brushBgColor").addEventListener("input",e=>{S.brush.bgColor=e.target.value;});
  $("btnSwapColors").onclick=()=>{
    const f=S.brush.color;S.brush.color=S.brush.bgColor;S.brush.bgColor=f;
    $("brushColor").value=S.brush.color;$("brushBgColor").value=S.brush.bgColor;
    toast("Swapped colors — foreground is now "+S.brush.color);};
  // brush spacing
  $("brushSpacing").addEventListener("input",e=>{S.brush.spacing=+e.target.value;$("brushSpacingVal").textContent=e.target.value+"%";});
  // text weight / align (live)
  const textLive2=()=>{const L=activeLayer();
    if(L&&L.kind==="text"&&L.text){Object.assign(L.text,readTextPanel());rasterizeTextLayer(L);render();markDirty();}};
  ["textWeight","textAlign"].forEach(id=>$(id).addEventListener("change",textLive2));
  // polygon sides (live)
  $("shapeSides").addEventListener("input",e=>{$("shapeSidesVal").textContent=e.target.value;
    const L=activeLayer();
    if(L&&L.kind==="shape"&&L.shape){L.shape.sides=+e.target.value;rasterizeShapeLayer(L);render();markDirty();}});
  buildFilterMenu();
}

function init(){
  epHydrateIcons(document); /* static HTML icons (icons.js) */
  /* Theme (Phase 0+1): dark default, polished light theme, persisted. */
  try{const t=localStorage.getItem("editora-photo-theme");if(t)document.body.dataset.theme=t;}catch(e){}
  const syncPhotoTheme=()=>{const b=$("btnThemePhoto");if(b)epSetIcon(b,(document.body.dataset.theme||"dark")==="dark"?"moon":"sun");};
  const tb=$("btnThemePhoto");
  if(tb)tb.onclick=()=>{const t=(document.body.dataset.theme||"dark")==="dark"?"light":"dark";
    document.body.dataset.theme=t;
    try{localStorage.setItem("editora-photo-theme",t);}catch(e){}
    syncPhotoTheme();};
  syncPhotoTheme();
  buildFilters();bindAdjustments();bindCanvas();bindPhase5();
  // tool buttons
  document.querySelectorAll(".tool-btn").forEach(b=>b.addEventListener("click",()=>setTool(b.dataset.tool)));
  bindPhotoShell(); // menu bar, right tabs, modals, mobile bottom nav — after the
  // generic .tool-btn binding, so group flyouts re-open after setTool() closes them
  // brush options
  $("brushSize").addEventListener("input",e=>{S.brush.size=+e.target.value;$("brushSizeVal").textContent=e.target.value+"px";});
  $("brushColor").addEventListener("input",e=>{S.brush.color=e.target.value;});
  $("fgSwatch").addEventListener("click",()=>$("brushColor").click());
  $("bgSwatch").addEventListener("click",()=>$("brushBgColor").click());
  $("brushOpacity").addEventListener("input",e=>{S.brush.opacity=+e.target.value;$("brushOpacityVal").textContent=e.target.value+"%";});
  $("brushHardness").addEventListener("input",e=>{S.brush.hardness=+e.target.value;$("brushHardnessVal").textContent=e.target.value+"%";});
  // zoom
  $("zoomOut").onclick=()=>{S.zoom=clamp(S.zoom/1.25,0.05,4);applyZoom();};
  $("zoomIn").onclick=()=>{S.zoom=clamp(S.zoom*1.25,0.05,4);applyZoom();};
  $("zoomFit").onclick=fitZoom;
  $("zoomRange").addEventListener("input",e=>{S.zoom=+e.target.value/100;applyZoom();});
  // crop / transform
  $("cropRatio").addEventListener("change",e=>{S.cropRatio=e.target.value;});
  $("btnApplyCrop").onclick=()=>{if(!S.cropRect||S.cropRect.w<2||S.cropRect.h<2){toast("Drag a crop box on the canvas first");return;}applyCropRect(S.cropRect);};
  $("btnCancelCrop").onclick=()=>{S.cropRect=null;render();toast("Crop cancelled");};
  $("btnApplyResize").onclick=()=>applyResize(+$("resizeW").value,+$("resizeH").value);
  $("btnRotateL").onclick=()=>doRotate(-1);
  $("btnRotateR").onclick=()=>doRotate(1);
  $("btnFlipH").onclick=()=>doFlip(true);
  $("btnFlipV").onclick=()=>doFlip(false);
  $("straighten").addEventListener("input",e=>{S.straighten=+e.target.value;$("straightenVal").textContent=S.straighten+"°";render();});
  $("btnApplyStraighten").onclick=applyStraighten;
  $("btnResetStraighten").onclick=()=>{S.straighten=0;$("straighten").value=0;$("straightenVal").textContent="0°";render();};
  // selection
  $("selFeather").addEventListener("input",e=>{$("selFeatherVal").textContent=e.target.value+"px";if(S.sel){S.sel.feather=+e.target.value;render();}});
  $("selOnlyAdj").addEventListener("change",e=>{S.selOnly=e.target.checked;render();toast(e.target.checked?"Adjustments now apply to the selection only":"Adjustments apply to the whole layer");});
  $("btnSelCrop").onclick=selOpCrop;
  $("btnSelDelete").onclick=selOpDelete;
  $("btnSelFill").onclick=selOpFill;
  $("btnSelInvert").onclick=selOpInvert;
  $("btnSelDeselect").onclick=()=>{S.sel=null;S.lassoPath=null;render();toast("Selection cleared");};
  // clone
  $("btnCloneClear").onclick=()=>{S.cloneSrc=null;S.cloneOffset=null;$("cloneStatus").textContent="No source set. Alt-click (or long-press on touch) on the canvas to sample a source point, then paint.";render();};
  // text
  const textLive=()=>{const L=activeLayer();
    if(L&&L.kind==="text"&&L.text){Object.assign(L.text,readTextPanel());rasterizeTextLayer(L);render();markDirty();}};
  $("textInput").addEventListener("input",()=>{const L=activeLayer();
    if(L&&L.kind==="text"&&L.text){L.text.str=$("textInput").value;rasterizeTextLayer(L);render();markDirty();}});
  ["textFont","textColor","textOutlineColor"].forEach(id=>$(id).addEventListener("input",textLive));
  ["textOutline","textShadow"].forEach(id=>$(id).addEventListener("change",textLive));
  $("textSize").addEventListener("input",e=>{$("textSizeVal").textContent=e.target.value+"px";textLive();});
  $("textSpacing").addEventListener("input",e=>{$("textSpacingVal").textContent=e.target.value+"px";textLive();});
  $("textLineHeight").addEventListener("input",e=>{$("textLineHeightVal").textContent=e.target.value+"%";textLive();});
  $("btnAddText").onclick=()=>{if(!S.hasDoc){toast("Open an image first");return;}addTextLayerAt(S.docW/2,S.docH/2);};
  // shapes
  $("shapeStrokeW").addEventListener("input",e=>{$("shapeStrokeWVal").textContent=e.target.value+"px";shapeLive();});
  $("shapeOpacity").addEventListener("input",e=>{$("shapeOpacityVal").textContent=e.target.value+"%";shapeLive();});
  ["shapeKind","shapeFill","shapeStroke"].forEach(id=>$(id).addEventListener("input",shapeLive));
  function shapeLive(){const L=activeLayer();
    if(L&&L.kind==="shape"&&L.shape){Object.assign(L.shape,readShapePanel());rasterizeShapeLayer(L);render();markDirty();}}
  // bucket
  $("bucketTolerance").addEventListener("input",e=>{$("bucketToleranceVal").textContent=e.target.value;});
  // layers
  $("btnAddLayer").onclick=()=>{if(!S.hasDoc){toast("Open an image first");return;}
    pushUndo("Add layer");const L=newLayer("Paint layer","paint");S.layers.push(L);S.activeId=L.id;
    render();renderLayerList();markDirty();toast("Blank layer added — paint on it with the Brush");};
  $("btnDupLayer").onclick=()=>{const L=activeLayer();if(!L)return;pushUndo("Duplicate layer");
    const dupOne=src=>{
      const c=newLayer(src.name+" copy",src.kind);
      Object.assign(c,{opacity:src.opacity,blend:src.blend,visible:src.visible,locked:false,
        adj:JSON.parse(JSON.stringify(src.adj)),text:src.text?{...src.text}:null,
        shape:src.shape?{...src.shape}:null,clip:!!src.clip});
      if(src.canvas)canvasCtx(c.canvas).drawImage(src.canvas,0,0);
      if(src.mask){c.mask=makeCanvas(S.docW,S.docH);canvasCtx(c.mask).drawImage(src.mask,0,0);}
      if(src.kind==="group")c.children=(src.children||[]).map(dupOne);
      return c;};
    const c=dupOne(L);
    const list=parentListOf(L.id);list.splice(list.indexOf(L)+1,0,c);
    S.activeId=c.id;render();renderLayerList();markDirty();toast("Layer duplicated");};
  $("btnDelLayer").onclick=()=>{const L=activeLayer();if(!L)return;
    if(allLeaves().length+S.layers.filter(l=>l.kind==="group").length<=1){toast("Cannot delete the last layer");return;}
    pushUndo("Delete layer");
    const list=parentListOf(L.id);list.splice(list.indexOf(L),1);
    const leaves=allLeaves();S.activeId=leaves.length?leaves[leaves.length-1].id:null;
    render();renderLayerList();markDirty();toast("Layer deleted");};
  $("btnLayerUp").onclick=()=>{const list=parentListOf(S.activeId);if(!list)return;
    const i=list.findIndex(l=>l.id===S.activeId);
    if(i>=0&&i<list.length-1){pushUndo("Move layer up");const t=list[i];list[i]=list[i+1];list[i+1]=t;render();renderLayerList();markDirty();}};
  $("btnLayerDown").onclick=()=>{const list=parentListOf(S.activeId);if(!list)return;
    const i=list.findIndex(l=>l.id===S.activeId);
    if(i>0){pushUndo("Move layer down");const t=list[i];list[i]=list[i-1];list[i-1]=t;render();renderLayerList();markDirty();}};
  $("layerOpacity").addEventListener("input",e=>{const L=activeLayer();if(!L)return;
    L.opacity=+e.target.value;$("layerOpacityVal").textContent=e.target.value+"%";render();markDirty();});
  $("layerBlend").addEventListener("change",e=>{const L=activeLayer();if(!L)return;
    L.blend=e.target.value;render();markDirty();});
  // masks
  $("btnAddMask").onclick=()=>{const L=activeLayer();if(!L)return;
    if(L.mask){toast("This layer already has a mask");return;}
    pushUndo("Add layer mask");L.mask=makeCanvas(S.docW,S.docH);
    const x=L.mask.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,S.docW,S.docH);
    render();renderLayerList();markDirty();toast("Mask added — white reveals, black hides. Use “Edit mask” to paint on it.");};
  $("btnEditMask").onclick=()=>{const L=activeLayer();if(!L||!L.mask)return;
    const on=!S.editMask;
    if(on)setTool("brush"); // setTool clears editMask, so set it after
    S.editMask=on;$("btnEditMask").classList.toggle("on",on);
    $("optMask").hidden=!on;
    $("maskHint").textContent=on?"You are painting on the layer mask, not the image. Use “Black — hide” / “White — reveal” above; brush size and opacity still apply.":"You are painting on the layer mask, not the image. Black hides pixels, white reveals them. Switch back with “Done editing mask”.";
    $("maskStatus").textContent=on?"Painting on MASK — black hides, white reveals. Click “Edit mask” again when done.":"Layer has a mask. Use “Edit mask” to paint on it.";
    render();};
  $("btnApplyMask").onclick=()=>{const L=activeLayer();if(!L||!L.mask)return;pushUndo("Apply mask");
    const ctx=canvasCtx(L.canvas);ctx.save();ctx.globalCompositeOperation="destination-in";
    ctx.drawImage(L.mask,0,0);ctx.restore();L.mask=null;S.editMask=false;
    $("btnEditMask").classList.remove("on");$("optMask").hidden=true;
    invalidateAdj(L);render();renderLayerList();markDirty();toast("Mask applied permanently");};
  $("btnDeleteMask").onclick=()=>{const L=activeLayer();if(!L||!L.mask)return;pushUndo("Delete mask");
    L.mask=null;S.editMask=false;$("btnEditMask").classList.remove("on");$("optMask").hidden=true;
    render();renderLayerList();markDirty();toast("Mask deleted — hidden pixels restored");};
  // top bar
  $("btnUndo").onclick=doUndo;$("btnRedo").onclick=doRedo;
  $("btnNewPhoto").onclick=()=>{if(S.dirty&&!confirm("Start a new blank photo? Unsaved changes will be lost."))return;blankDoc();};
  $("btnSavePhoto").onclick=()=>saveProject(false);
  $("btnExportTop").onclick=exportPhoto;
  $("projectName").addEventListener("input",e=>{S.projectName=e.target.value;markDirty();});
  $("btnDrawerLayers").onclick=()=>openRight("layers");
  $("btnDrawerAdjust").onclick=()=>openRight("adjustments");
  // export section
  $("exportFormat").addEventListener("change",e=>{
    $("exportNote").textContent=e.target.value==="png"
      ?"PNG keeps transparency (layers flatten onto a transparent canvas). JPG fills transparent areas with white."
      :e.target.value==="jpeg"?"JPG fills transparent areas with white and uses the quality slider above."
      :"WebP keeps transparency like PNG, usually at a smaller file size.";});
  $("exportQuality").addEventListener("input",e=>{$("exportQualityVal").textContent=e.target.value+"%";});
  // btnDoExport is the export-modal confirm button (bound in bindPhotoShell)
  $("btnDownloadBackup").onclick=()=>{
    if(!S.hasDoc){toast("Nothing to back up yet");return;}
    const blob=new Blob([JSON.stringify(EPProjectStore.makePhotoBackup(serialize()),null,1)],{type:"application/json"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);
    a.download=(S.projectName||"photo")+".editora-photo.json";a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),5000);toast("Project backup downloaded");};
  $("btnImportBackup").onclick=()=>$("projectFileInput").click();
  $("projectFileInput").addEventListener("change",e=>{
    const f=e.target.files[0];if(!f)return;
    const r=new FileReader();
    r.onload=()=>{try{const data=JSON.parse(r.result);
      const v=EPProjectStore.validate(data,EPProjectStore.PHOTO_APP);
      if(!v.ok){toast(v.reason);return;}
      if(!data.layers||!data.w)throw new Error("bad file");
      epHist.clear();clearHistLog();
      restoreSnap(data).then(()=>toast("Backup restored"));
    }catch(err){toast("That file is not an Editora Pro photo project");}};
    r.readAsText(f);e.target.value="";});
  // import modal (single-modal rule: showModal hides the others first)
  $("choiceReplace").onclick=()=>{hideModals();
    if(S.pendingFile){newDocFromImage(S.pendingFile.img,S.pendingFile.name);S.pendingFile=null;}};
  $("choiceLayer").onclick=()=>{hideModals();
    if(S.pendingFile){addImageLayer(S.pendingFile.img,S.pendingFile.name);S.pendingFile=null;}};
  $("choiceCancel").onclick=()=>{hideModals();S.pendingFile=null;};
  // file input + open buttons (FIX 2026-11-12, Issue 1: the Open button now
  // also lives in the top bar, not only inside the empty state)
  $("btnOpenImage").onclick=()=>$("photoFileInput").click();
  $("btnOpenImageTop").onclick=()=>$("photoFileInput").click();
  $("btnBlankCanvas").onclick=e=>{e.stopPropagation();$("emptyState").classList.add("hidden");$("photoCanvas").focus&&$("photoCanvas").focus();toast("Blank canvas — pick the Brush and paint, or open an image from the top bar");};
  $("emptyState").addEventListener("click",e=>{
    if(e.target.closest("button"))return; // buttons have their own handlers
    $("photoFileInput").click(); // clicking the empty canvas / its text opens the picker
  });
  $("photoFileInput").addEventListener("change",e=>{if(e.target.files[0])loadImageFile(e.target.files[0]);e.target.value="";});
  // drag & drop (whole page)
  // FIX 2026-11-12 (Issue 2): the old handler showed "Drop image to open" on
  // ANY dragenter — including dragging a layer to reorder it — and those
  // drags end with dragend, not drop, so the hint stayed on screen forever.
  // Now: only file drags show it, and dragend/drop/load always hide it.
  let dragDepth=0;
  const dragHasFiles=e=>{try{return e.dataTransfer&&[...(e.dataTransfer.types||[])].includes("Files");}catch(_){return false;}};
  const hideDropHint=()=>{dragDepth=0;$("dropHint").hidden=true;};
  window.addEventListener("dragenter",e=>{if(!dragHasFiles(e))return;e.preventDefault();dragDepth++;$("dropHint").hidden=false;});
  window.addEventListener("dragleave",()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$("dropHint").hidden=true;});
  window.addEventListener("dragover",e=>{if(dragHasFiles(e))e.preventDefault();});
  window.addEventListener("dragend",hideDropHint);
  window.addEventListener("drop",e=>{e.preventDefault();hideDropHint();
    const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
    if(f)loadImageFile(f);});
  // keyboard
  window.addEventListener("keydown",e=>{
    const tag=(e.target.tagName||"").toLowerCase();
    const typing=tag==="input"||tag==="select"||tag==="textarea";
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&!e.shiftKey){e.preventDefault();doUndo();return;}
    if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==="y"||(e.shiftKey&&e.key.toLowerCase()==="z"))){e.preventDefault();doRedo();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();saveProject(false);return;}
    /* FIX 2026-11-12 (Issue 1): Ctrl+O opens the image picker. (Placed
       with the other Ctrl shortcuts, before the typing early-return.) */
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="o"){e.preventDefault();$("photoFileInput").click();return;}
    if(typing)return;
    if(e.key==="Enter"&&S.tool==="polylasso"&&S.polyPath&&S.polyPath.length>2){e.preventDefault();closePolyLasso();return;}
    if(e.key==="Escape"){S.sel=null;S.cropRect=null;S.lassoPath=null;S.polyPath=null;S.shapePreview=null;
      closeMenus();closeToolPops();$("moreSheet").hidden=true;$("overflowMenu").hidden=true;
      if(S.transform){cancelTransform();}render();return;}
    if(e.key.toLowerCase()==="x"){$("btnSwapColors").click();return;}
    const map={v:"move",b:"brush",e:"eraser",c:"crop",m:"rectsel",l:"lasso",t:"text",u:"shape",i:"picker",g:"bucket",h:"hand",z:"zoom"};
    if(map[e.key.toLowerCase()])setTool(map[e.key.toLowerCase()]);
  });
  window.addEventListener("beforeunload",()=>{if(S.dirty)saveProject(true);});
  window.addEventListener("resize",()=>{if(S.hasDoc)fitZoom();});
  // FIX 2026-11-12 (Issue 3): the ~1 s debounce in markDirty() is the real
  // autosave now; this 5 s interval is only a safety net (was 20 s).
  setInterval(()=>{if(S.dirty&&S.hasDoc)saveProject(true);},5000);
  // start: blank canvas, then try to restore autosave
  blankDoc();S.dirty=false;markSaved();
  /* Phase 6 — deep link from the Projects screen (photo.html?open=Name):
     open that project directly instead of restoring the autosave, so the
     two do not race and overwrite each other. */
  let openParam=null;
  try{openParam=new URLSearchParams(location.search).get("open");}catch(e){}
  if(openParam){loadSaved(openParam);}
  /* FIX 2026-11-12 (Bug 2): NEVER auto-restore the autosave onto the
     canvas. First load is always the clean empty state (Open Image / New
     Canvas / Recent Projects) — the roadmap's rule. An autosaved project
     is listed under Recent Projects by refreshSavedList() and opens with
     one click; no restore toast on load. (The ?open= deep link above is
     an explicit open from the Projects screen, so it still opens.)
     Autosave itself is untouched — it still saves. */
  refreshSavedList();
  renderHistory();
  setTool("move");
  updateStatus();
}
document.addEventListener("DOMContentLoaded",init);
})();
