/* Editora Pro — Photo Editor (Canvas compositor, Vanilla JS) */
"use strict";
window.Photo = (function(){
  const cv = ()=>document.getElementById("photoCanvas");
  const ctx = ()=>cv().getContext("2d");
  let baseImg=null, baseName="photo";
  let layers=[]; // {id,kind:'text'|'shape'|'sticker'|'image',text,x,y,w,h,size,color,font,shape,emoji,img,opacity,blend,visible,locked,rotation}
  let selLayer=null, filterName="Normal", straightenDeg=0, flipPhoto=false;
  let paintLayer=null; // offscreen canvas for brush strokes
  let drawing=false, lastPt=null, cropStart=null, selRect=null;
  const FILTERS={
    Normal:"", Vintage:"sepia(0.45) contrast(0.9) brightness(1.05) saturate(0.8)",
    "B&W":"grayscale(1) contrast(1.15)", Warm:"sepia(0.25) saturate(1.2) brightness(1.03)",
    Cool:"hue-rotate(180deg) saturate(0.9) brightness(1.02)", Vivid:"saturate(1.5) contrast(1.18)",
    Sepia:"sepia(1)", Noir:"grayscale(1) contrast(1.35) brightness(0.95)",
    Fade:"brightness(1.08) contrast(0.85) saturate(0.85)", Duotone:"grayscale(1) sepia(0.6) hue-rotate(240deg) saturate(2.2)",
    Retro:"sepia(0.6) contrast(1.05) brightness(0.95)", Bright:"brightness(1.2) saturate(1.1)",
  };
  function hasImage(){return !!baseImg;}
  function loadFile(file){
    const url=URL.createObjectURL(file);baseName=file.name.replace(/\.[^.]+$/,"");
    const im=new Image();im.onload=()=>{
      baseImg=im;layers=[];selLayer=null;paintLayer=null;
      cv().width=im.naturalWidth;cv().height=im.naturalHeight;
      document.getElementById("photoHint").textContent=im.naturalWidth+"×"+im.naturalHeight+" — "+file.name;
      document.getElementById("modePhoto").click();
      render();toast("Image opened: "+file.name);
    };im.src=url;
  }
  function colorFilter(){
    const c=(window.S&&S.color)?S.color:{brightness:100,contrast:100,saturation:100,exposure:0,temperature:0};
    return `brightness(${c.brightness/100*(1+c.exposure/200)}) contrast(${c.contrast/100}) saturate(${c.saturation/100})${c.temperature>0?` sepia(${Math.min(30,c.temperature/3)}%)`:""} ${FILTERS[filterName]||""}`;
  }
  function render(){
    const c=cv(),x=ctx();if(!c)return;
    x.save();x.clearRect(0,0,c.width,c.height);
    x.filter=colorFilter();
    if(baseImg){
      x.save();x.translate(c.width/2,c.height/2);x.rotate(straightenDeg*Math.PI/180);x.scale(flipPhoto?-1:1,1);
      const s=Math.min(c.width/baseImg.naturalWidth,c.height/baseImg.naturalHeight);
      x.drawImage(baseImg,-baseImg.naturalWidth*s/2,-baseImg.naturalHeight*s/2,baseImg.naturalWidth*s,baseImg.naturalHeight*s);
      x.restore();
    }
    x.filter="none";
    if(paintLayer)x.drawImage(paintLayer,0,0);
    layers.forEach(L=>{
      if(L.visible===false)return;
      x.save();x.globalAlpha=(L.opacity??100)/100;x.globalCompositeOperation=L.blend||"source-over";
      x.translate(L.x,L.y);x.rotate((L.rotation||0)*Math.PI/180);
      if(L.kind==="text"){
        x.font=`bold ${L.size||48}px ${L.font||"Arial"}`;
        x.textAlign="center";x.textBaseline="middle";
        x.fillStyle=L.color||"#ffffff";
        if(L.outline){x.strokeStyle="#000";x.lineWidth=3;x.strokeText(L.text,0,0);}
        x.fillText(L.text,0,0);
      }else if(L.kind==="shape"){
        x.fillStyle=L.color||"#ff3366";
        if(L.shape==="circle"){x.beginPath();x.arc(0,0,(L.w||100)/2,0,Math.PI*2);x.fill();}
        else if(L.shape==="line"){x.strokeStyle=L.color;x.lineWidth=L.h||6;x.beginPath();x.moveTo(-(L.w||150)/2,0);x.lineTo((L.w||150)/2,0);x.stroke();}
        else x.fillRect(-(L.w||150)/2,-(L.h||100)/2,L.w||150,L.h||100);
      }else if(L.kind==="sticker"){
        x.font=`${L.size||80}px Arial`;x.textAlign="center";x.textBaseline="middle";x.fillText(L.emoji||"⭐",0,0);
      }else if(L.kind==="image"&&L.img){
        x.drawImage(L.img,-(L.w||200)/2,-(L.h||200)/2,L.w||200,L.h||200);
      }
      x.restore();
      if(selLayer===L.id){x.save();x.strokeStyle="#06b6d4";x.lineWidth=2;x.setLineDash([6,4]);x.strokeRect(L.x-(L.w||160)/2-4,L.y-(L.h||60)/2-4,(L.w||160)+8,(L.h||60)+8);x.restore();}
    });
    if(selRect){x.save();x.strokeStyle="#f43f5e";x.lineWidth=2;x.setLineDash([6,4]);x.strokeRect(selRect.x,selRect.y,selRect.w,selRect.h);x.restore();}
    x.restore();
    renderLayerList();
  }
  function renderLayerList(){
    const box=document.getElementById("layerList");if(!box)return;box.innerHTML="";
    if(!layers.length){box.innerHTML='<p class="hint">No layers yet. Add text, shape, sticker or image.</p>';return;}
    layers.forEach((L,i)=>{
      const d=document.createElement("div");d.className="lyr"+(selLayer===L.id?" sel":"");
      d.innerHTML=`<span>${L.visible===false?"🙈":"👁"}</span><span class="nm">${L.kind}: ${L.text||L.emoji||L.shape||L.name||""}</span><span>${L.locked?"🔒":""}</span>`;
      d.onclick=()=>{selLayer=L.id;document.getElementById("layerOp").value=L.opacity??100;document.getElementById("layerOpV").textContent=(L.opacity??100)+"%";document.getElementById("layerBlend").value=L.blend||"source-over";render();};
      d.querySelector("span").onclick=e=>{e.stopPropagation();L.visible=L.visible===false?true:false;render();};
      box.appendChild(d);
    });
  }
  function addTextLayer(text){
    if(!baseImg){toast("Open an image first");return;}
    layers.push({id:"L"+Math.random().toString(36).slice(2,7),kind:"text",text:text||"Your text",x:cv().width/2,y:cv().height/2,w:300,h:60,size:56,color:"#ffffff",font:"Arial",opacity:100,blend:"source-over",visible:true});
    selLayer=layers[layers.length-1].id;render();
  }
  function addShape(){
    if(!baseImg){toast("Open an image first");return;}
    const shape=prompt("Shape? rect / circle / line","rect")||"rect";
    layers.push({id:"L"+Math.random().toString(36).slice(2,7),kind:"shape",shape:shape.toLowerCase()==="circle"?"circle":shape.toLowerCase()==="line"?"line":"rect",x:cv().width/2,y:cv().height/2,w:180,h:120,color:"#ff3366",opacity:100,blend:"source-over",visible:true});
    selLayer=layers[layers.length-1].id;render();
  }
  function addStickerEmoji(e){
    if(!baseImg){toast("Open an image first");return;}
    layers.push({id:"L"+Math.random().toString(36).slice(2,7),kind:"sticker",emoji:e||"⭐",x:cv().width/2,y:cv().height/2,w:90,h:90,size:80,opacity:100,blend:"source-over",visible:true});
    selLayer=layers[layers.length-1].id;render();
  }
  function getLayers(){return layers.map(L=>({id:L.id,kind:L.kind,text:L.text,emoji:L.emoji,shape:L.shape,name:L.name}));}
  function selectLayer(id){selLayer=id;render();}
  function addImageLayer(file){
    const url=URL.createObjectURL(file);const im=new Image();
    im.onload=()=>{layers.push({id:"L"+Math.random().toString(36).slice(2,7),kind:"image",img:im,name:file.name,x:cv().width/2,y:cv().height/2,w:220,h:220,opacity:100,blend:"source-over",visible:true});selLayer=layers[layers.length-1].id;render();};
    im.src=url;
  }
  function applyFilter(name){filterName=name;document.querySelectorAll("#photoFilters .fx-btn").forEach(b=>b.classList.toggle("on",b.textContent===name));render();}
  function setCanvasSize(v){
    if(v==="orig"||!baseImg)return;
    const [w,h]=v.split("x").map(Number);
    // resize canvas to preset, keep image cover-fit
    const old=cv();const tmp=document.createElement("canvas");tmp.width=old.width;tmp.height=old.height;tmp.getContext("2d").drawImage(old,0,0);
    cv().width=w;cv().height=h;
    const x=ctx();x.drawImage(tmp,0,0,w,h);
    baseImg=tmpToImage();render();
  }
  function tmpToImage(){const im=new Image();im.src=cv().toDataURL();return im;}
  function exportDataURL(fmt,q,targetW,transparent){
    const src=cv();
    let out=src;
    if(targetW&&targetW>0&&targetW!==src.width){
      out=document.createElement("canvas");out.width=targetW;out.height=Math.round(src.height*targetW/src.width);
      out.getContext("2d").drawImage(src,0,0,out.width,out.height);
    }
    if(transparent&&fmt==="png"){
      // rebuild without the white base: draw only layers + paint on transparent canvas
      const t=document.createElement("canvas");t.width=out.width;t.height=out.height;
      const tx=t.getContext("2d");
      if(paintLayer)tx.drawImage(paintLayer,0,0,t.width,t.height);
      layers.forEach(L=>{if(L.visible===false)return;tx.save();tx.globalAlpha=(L.opacity??100)/100;tx.globalCompositeOperation=L.blend||"source-over";tx.translate(L.x/out.width*t.width,L.y/out.height*t.height);if(L.kind==="text"){tx.font=`bold ${L.size}px ${L.font}`;tx.textAlign="center";tx.fillStyle=L.color;tx.fillText(L.text,0,0);}else if(L.kind==="sticker"){tx.font=`${L.size}px Arial`;tx.textAlign="center";tx.fillText(L.emoji,0,0);}tx.restore();});
      return t.toDataURL("image/png");
    }
    return out.toDataURL("image/"+fmt, q);
  }
  /* flood fill (paint bucket) on paint layer */
  function floodFill(sx,sy,hex){
    const c=cv(),x=ctx();if(!paintLayer){paintLayer=document.createElement("canvas");paintLayer.width=c.width;paintLayer.height=c.height;}
    const px=paintLayer.getContext("2d");
    const img=px.getImageData(0,0,c.width,c.height);const d=img.data;
    const i=(sy*c.width+sx)*4;const tr=d[i],tg=d[i+1],tb=d[i+2],ta=d[i+3];
    const [r,g,b]=[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
    if(tr===r&&tg===g&&tb===b&&ta===255)return;
    const stack=[[sx,sy]];const seen=new Uint8Array(c.width*c.height);
    while(stack.length){const [cx2,cy2]=stack.pop();if(cx2<0||cy2<0||cx2>=c.width||cy2>=c.height)continue;const k=cy2*c.width+cx2;if(seen[k])continue;seen[k]=1;const j=k*4;if(d[j]!==tr||d[j+1]!==tg||d[j+2]!==tb||d[j+3]!==ta)continue;d[j]=r;d[j+1]=g;d[j+2]=b;d[j+3]=255;stack.push([cx2+1,cy2],[cx2-1,cy2],[cx2,cy2+1],[cx2,cy2-1]);}
    px.putImageData(img,0,0);render();
  }
  function canvasPos(e){
    const r=cv().getBoundingClientRect();
    return {x:Math.round((e.clientX-r.left)*cv().width/r.width), y:Math.round((e.clientY-r.top)*cv().height/r.height)};
  }
  function bindCanvas(){
    const c=cv();
    c.addEventListener("pointerdown",e=>{
      const tool=document.getElementById("photoTool").value;
      const p=canvasPos(e);
      if(tool==="picker"){
        const d=ctx().getImageData(p.x,p.y,1,1).data;
        const hex="#"+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,"0")).join("");
        document.getElementById("brushColor").value=hex;toast("Picked color "+hex);
        return;
      }
      if(tool==="bucket"){floodFill(p.x,p.y,document.getElementById("brushColor").value);return;}
      if(tool==="crop"||tool==="rectsel"){cropStart=p;selRect={x:p.x,y:p.y,w:0,h:0};drawing=true;return;}
      if(tool==="brush"||tool==="eraser"){
        if(!paintLayer){paintLayer=document.createElement("canvas");paintLayer.width=c.width;paintLayer.height=c.height;}
        drawing=true;lastPt=p;return;
      }
      // select/move layer
      const L=[...layers].reverse().find(l=>Math.abs(p.x-l.x)<(l.w||160)/2+10&&Math.abs(p.y-l.y)<(l.h||60)/2+10);
      if(L){selLayer=L.id;drawing=true;lastPt=p;render();}
    });
    c.addEventListener("pointermove",e=>{
      if(!drawing)return;const p=canvasPos(e);const tool=document.getElementById("photoTool").value;
      if(tool==="brush"||tool==="eraser"){
        const px=paintLayer.getContext("2d");
        px.globalCompositeOperation=tool==="eraser"?"destination-out":"source-over";
        px.globalAlpha=(+document.getElementById("brushOp").value)/100;
        px.strokeStyle=document.getElementById("brushColor").value;
        px.lineWidth=+document.getElementById("brushSize").value;px.lineCap="round";
        px.beginPath();px.moveTo(lastPt.x,lastPt.y);px.lineTo(p.x,p.y);px.stroke();
        lastPt=p;render();return;
      }
      if((tool==="crop"||tool==="rectsel")&&cropStart){
        selRect={x:Math.min(cropStart.x,p.x),y:Math.min(cropStart.y,p.y),w:Math.abs(p.x-cropStart.x),h:Math.abs(p.y-cropStart.y)};render();return;
      }
      if(lastPt){const L=layers.find(l=>l.id===selLayer);if(L&&!L.locked){L.x+=p.x-lastPt.x;L.y+=p.y-lastPt.y;lastPt=p;render();}}
    });
    const up=()=>{
      if(!drawing)return;drawing=false;
      const tool=document.getElementById("photoTool").value;
      if((tool==="crop"||tool==="rectsel")&&selRect&&selRect.w>10&&selRect.h>10){
        const r=selRect;const tmp=document.createElement("canvas");tmp.width=r.w;tmp.height=r.h;
        tmp.getContext("2d").drawImage(cv(),r.x,r.y,r.w,r.h,0,0,r.w,r.h);
        cv().width=r.w;cv().height=r.h;ctx().drawImage(tmp,0,0);
        const im=new Image();im.onload=()=>{baseImg=im;layers=[];selRect=null;render();toast("Cropped to selection");};im.src=tmp.toDataURL();
      }
      lastPt=null;cropStart=null;
    };
    c.addEventListener("pointerup",up);c.addEventListener("pointerleave",up);
  }
  function init(){
    const pf=document.getElementById("photoFilters");
    Object.keys(FILTERS).forEach(n=>{const b=document.createElement("button");b.className="fx-btn"+(n==="Normal"?" on":"");b.textContent=n;b.onclick=()=>applyFilter(n);pf.appendChild(b);});
    bindCanvas();
    document.getElementById("btnAddTxtLayer").onclick=()=>{const t=prompt("Text for layer:","Hello!");if(t!==null)addTextLayer(t);};
    document.getElementById("btnAddShape").onclick=addShape;
    document.getElementById("btnAddSticker").onclick=addSticker;
    document.getElementById("btnAddImgLayer").onclick=()=>document.getElementById("layerImgInput").click();
    document.getElementById("layerImgInput").addEventListener("change",e=>{if(e.target.files[0])addImageLayer(e.target.files[0]);e.target.value="";});
    document.getElementById("btnPhotoPreset").onclick=()=>{const s=prompt("Canvas size — type one: 1280x720, 1080x1080, 1080x1920, 1200x628","1280x720");if(s)setCanvasSize(s.trim());};
    document.getElementById("photoSize").addEventListener("change",e=>setCanvasSize(e.target.value));
    document.getElementById("brushSize").addEventListener("input",e=>document.getElementById("brushSizeV").textContent=e.target.value+"px");
    document.getElementById("brushOp").addEventListener("input",e=>document.getElementById("brushOpV").textContent=e.target.value+"%");
    document.getElementById("straighten").addEventListener("input",e=>{straightenDeg=+e.target.value;document.getElementById("straightenV").textContent=straightenDeg+"°";render();});
    document.getElementById("btnRotL").onclick=()=>{straightenDeg-=90;render();};
    document.getElementById("btnRotR").onclick=()=>{straightenDeg+=90;render();};
    document.getElementById("btnFlipPhotoH").onclick=()=>{flipPhoto=!flipPhoto;render();};
    document.getElementById("layerOp").addEventListener("input",e=>{const L=layers.find(l=>l.id===selLayer);if(L){L.opacity=+e.target.value;document.getElementById("layerOpV").textContent=e.target.value+"%";render();}});
    document.getElementById("layerBlend").addEventListener("change",e=>{const L=layers.find(l=>l.id===selLayer);if(L){L.blend=e.target.value;render();}});
    document.getElementById("btnLayerUp").onclick=()=>{const i=layers.findIndex(l=>l.id===selLayer);if(i>0){[layers[i-1],layers[i]]=[layers[i],layers[i-1]];render();}};
    document.getElementById("btnLayerDown").onclick=()=>{const i=layers.findIndex(l=>l.id===selLayer);if(i>=0&&i<layers.length-1){[layers[i+1],layers[i]]=[layers[i],layers[i+1]];render();}};
    document.getElementById("btnLayerDup").onclick=()=>{const L=layers.find(l=>l.id===selLayer);if(L){const c={...L,id:"L"+Math.random().toString(36).slice(2,7),x:L.x+20,y:L.y+20};layers.push(c);selLayer=c.id;render();}};
    document.getElementById("btnLayerDel").onclick=()=>{layers=layers.filter(l=>l.id!==selLayer);selLayer=null;render();};
    // double-click a text layer to edit its text
    cv().addEventListener("dblclick",e=>{
      const p=canvasPos(e);const L=[...layers].reverse().find(l=>l.kind==="text"&&Math.abs(p.x-l.x)<(l.w||160)/2+10&&Math.abs(p.y-l.y)<(l.h||60)/2+10);
      if(L){const t=prompt("Edit text:",L.text);if(t!==null){L.text=t;render();}}
    });
  }
  document.addEventListener("DOMContentLoaded",init);
  return {loadFile,render,hasImage,applyFilter,setCanvasSize,addTextLayer,addStickerEmoji,getLayers,selectLayer,exportDataURL};
})();
