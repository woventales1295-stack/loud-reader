<script>
"use strict";
/* ---------- boot: decode inlined libraries, then start the app ---------- */
function b64text(id){
  const b64 = document.getElementById(id).textContent.trim();
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}
function b64bytes(id){
  const b64 = document.getElementById(id).textContent.trim();
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function blobURL(text, type){ return URL.createObjectURL(new Blob([text], { type: type || "text/javascript" })); }
function loadJS(text){
  return new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = blobURL(text);
    s.onload = () => res(); s.onerror = () => rej(new Error("script load failed"));
    document.head.appendChild(s);
  });
}
/* v2: heavy optional libraries are decoded only when first needed. */
let _unrarP=null, _mobiP=null;
function ensureUnrar(){
  if(!_unrarP){
    _unrarP=(async()=>{ if(!window.UnrarJS) await loadJS(b64text("lib-unrar")); return window.UnrarJS; })();
    _unrarP.catch(()=>{ _unrarP=null; });
  }
  return _unrarP;
}
function ensureMobi(){
  // mobi.js (foliate-js) is an ES module: load it through a blob: URL.
  if(!_mobiP){
    _mobiP=import(blobURL(b64text("lib-mobi")));
    _mobiP.catch(()=>{ _mobiP=null; });
  }
  return _mobiP;
}
/* Heavy libraries are decoded + evaluated only when a file type needs them, so the shelf
   appears almost immediately. The two common ones are warmed up in the background. */
const _libP={};
function _ensure(name, fn){ if(!_libP[name]){ _libP[name]=fn(); _libP[name].catch(()=>{ delete _libP[name]; }); } return _libP[name]; }
function ensurePdf(){ return _ensure("pdf", async()=>{
  if(!window.pdfjsLib) await loadJS(b64text("lib-pdf"));
  pdfjsLib.GlobalWorkerOptions.workerSrc = blobURL(b64text("lib-pdfworker"));
}); }
function ensureZip(){ return _ensure("zip", async()=>{ if(!window.JSZip) await loadJS(b64text("lib-jszip")); }); }
function ensureMammoth(){ return _ensure("mammoth", async()=>{ if(!window.mammoth) await loadJS(b64text("lib-mammoth")); }); }
function ensureTess(){ return _ensure("tess", async()=>{ if(!window.Tesseract) await loadJS(b64text("tess-main")); }); }
(function boot(){
  try{
    document.getElementById("boot").remove();
    appInit();
    setTimeout(()=>{ ensureZip().then(()=>ensurePdf()).catch(()=>{}); }, 1800);   // warm up while the user browses the shelf
  }catch(e){
    console.error(e);
    document.getElementById("boot").textContent = "Failed to initialize: " + e.message;
  }
})();

/* ============================================================
   The app  (started by boot() once libraries are ready)
   ============================================================ */
function appInit(){
const $ = (s) => document.querySelector(s);
const el = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };
const fmtSize = (b) => b < 1024 ? b+" B" : b < 1048576 ? (b/1024).toFixed(0)+" KB" : (b/1048576).toFixed(1)+" MB";
const setStatus = (t) => { $("#status").textContent = t; };
const extOf = (n) => { const m = /\.([a-z0-9]+)$/i.exec(n); return m ? m[1].toLowerCase() : ""; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()));
const BOOK_EXTS = ["pdf","epub","docx","mobi","azw","azw3","prc","fb2","txt","md","markdown","html","htm","xhtml"];
const COMIC_EXTS = ["cbz","cbr","zip","rar"];   // archives of page images (read via OCR)
const ALL_EXTS = BOOK_EXTS.concat(COMIC_EXTS);
const isComicExt = (e) => COMIC_EXTS.includes(e);
const isPagedExt = (e) => e==="pdf" || isComicExt(e); // shown as page images with a highlight box

/* ---------- in-page dialogs (WebView does not reliably show alert/confirm/prompt) ---------- */
let _dlgResolve=null;
function dlgClose(val){ $("#dlg").hidden=true; const r=_dlgResolve; _dlgResolve=null; if(r) r(val); }
// opts: {title, msg, input:{value,placeholder}, choices:[{label,value,danger}], ok, cancel, hideOk}
function dlg(opts){
  if(_dlgResolve) dlgClose(null);
  opts=opts||{};
  $("#dlgTitle").textContent=opts.title||"";
  $("#dlgMsg").textContent=opts.msg||"";
  const inp=$("#dlgInput"); inp.hidden=!opts.input;
  if(opts.input){ inp.value=opts.input.value||""; inp.placeholder=opts.input.placeholder||""; }
  const ch=$("#dlgChoices"); ch.innerHTML="";
  (opts.choices||[]).forEach(c=>{ const b=el("button", c.danger?"danger":""); b.textContent=c.label;
    b.onclick=()=>dlgClose({choice:c.value}); ch.appendChild(b); });
  $("#dlgOk").textContent=opts.ok||"OK"; $("#dlgOk").hidden=!!opts.hideOk;
  $("#dlgCancel").textContent=opts.cancel||"Cancel"; $("#dlgCancel").hidden=opts.cancel===false;
  $("#dlg").hidden=false;
  if(opts.input) setTimeout(()=>{ inp.focus(); inp.select(); },50);
  return new Promise(res=>{ _dlgResolve=res; });
}
$("#dlgOk").onclick=()=>{ const v=$("#dlgInput").hidden?{ok:true}:{ok:true,value:$("#dlgInput").value}; dlgClose(v); };
$("#dlgCancel").onclick=()=>dlgClose(null);
$("#dlgInput").addEventListener("keydown",(e)=>{ if(e.key==="Enter") $("#dlgOk").click(); });
const dlgAlert=(title,msg)=>dlg({title,msg,cancel:false});
const dlgConfirm=async(title,msg,ok,danger)=>!!(await dlg({title,msg,ok:ok||"OK"}));
const dlgPrompt=async(title,value,ph)=>{ const r=await dlg({title,input:{value:value||"",placeholder:ph||""}}); return r?r.value:null; };
const dlgChoose=async(title,choices)=>{ const r=await dlg({title,choices,hideOk:true}); return r?r.choice:null; };

/* ---------- native bridge helpers (no-ops outside the Android wrapper) ---------- */
const Native = {
  has: typeof AndroidBridge!=="undefined",
  keepOn(on){ try{ if(this.has) AndroidBridge.setKeepScreenOn(!!on); }catch(e){} },
  // Saves a Blob. Android: chunked base64 into Downloads/LoudReader (large single bridge
  // calls fail inside the bridge itself). Browser: normal download.
  async saveBlob(name, mime, blob){
    if(!this.has){
      const a=el("a"); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click();
      setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },2000); return {ok:true, uri:null};
    }
    if(!AndroidBridge.beginSave(name, mime)) return {ok:false};
    const CH=3*65536; // multiple of 3 => every chunk is independently valid base64
    for(let off=0; off<blob.size; off+=CH){
      const b64=await new Promise((res,rej)=>{ const fr=new FileReader();
        fr.onload=()=>res(String(fr.result).split(",")[1]||""); fr.onerror=()=>rej(fr.error);
        fr.readAsDataURL(blob.slice(off, Math.min(blob.size, off+CH))); });
      if(!AndroidBridge.appendChunk(b64)){ try{ AndroidBridge.abortSave(); }catch(e){} return {ok:false}; }
    }
    const uri=AndroidBridge.finishSave();
    return uri ? {ok:true, uri} : {ok:false};
  },
  open(uri, mime){ try{ return this.has && AndroidBridge.openUri(uri, mime); }catch(e){ return false; } },
  // Lets the user import a whole folder (with subfolders) from the device.
  // Resolves to an array of {id,name,path,size} (path includes the picked
  // folder's own name as its first segment, matching webkitRelativePath's
  // convention) or null if unsupported/cancelled.
  pickFolder(){
    if(!this.has || typeof AndroidBridge.pickFolder!=="function") return Promise.resolve(null);
    return new Promise((resolve)=>{
      window.__onFolderManifest=(manifest)=>{ window.__onFolderManifest=null; window.__onFolderCancelled=null; resolve(manifest||[]); };
      window.__onFolderCancelled=()=>{ window.__onFolderManifest=null; window.__onFolderCancelled=null; resolve(null); };
      try{ AndroidBridge.pickFolder(); }catch(e){ window.__onFolderManifest=null; window.__onFolderCancelled=null; resolve(null); }
    });
  },
  // Pulls one manifested folder-import entry's bytes (chunked, same CH as
  // saveBlob) and wraps them as a real File so it can flow through the same
  // importFiles() pipeline as a normally-picked file.
  async readImportedFile(entry){
    const CH=3*65536;
    const parts=[]; let offset=0;
    for(;;){
      let b64; try{ b64=AndroidBridge.readImportChunk(entry.id, offset, CH); }catch(e){ b64=""; }
      if(!b64) break;
      const bin=atob(b64); const bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
      parts.push(bytes); offset+=bytes.length;
      if(bytes.length<CH) break;
    }
    const file=new File(parts, entry.name, {});
    try{ Object.defineProperty(file,"_relPath",{value:entry.path||entry.name,enumerable:false}); }catch(e){ file._relPath=entry.path||entry.name; }
    return file;
  }
};
async function saveAndReport(name, mime, blob){
  let r; try{ r=await Native.saveBlob(name, mime, blob); }catch(e){ r={ok:false}; }
  if(!r.ok){ await dlgAlert("Save failed","The file could not be saved."); return; }
  if(r.uri){
    setStatus("Saved to Downloads/LoudReader/"+name);
    if(await dlgConfirm("Saved","Saved to Downloads/LoudReader/"+name+"\n\nOpen it now?","Open")) Native.open(r.uri, mime);
  } else setStatus("Downloaded "+name);
}

/* ---------- IndexedDB: docs (heavy) + meta (light) ---------- */
const liteDoc = (d) => ({ id:d.id, name:d.name, size:d.size, type:d.type, addedAt:d.addedAt, ocrText:!!(d.ocrText && d.ocrText.length) });
const DB = (() => {
  let dbp;
  function open(){
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("loud-reader", 6);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath:"id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath:"id" });
        if (!db.objectStoreNames.contains("lib")){
          // light per-book catalog: the shelf lists books from here and never touches the heavy "docs" records
          const ls = db.createObjectStore("lib", { keyPath:"id" });
          if (db.objectStoreNames.contains("docs")){
            r.transaction.objectStore("docs").openCursor().onsuccess = (e) => { const c = e.target.result; if (c){ ls.put(liteDoc(c.value)); c.continue(); } };
          }
        }
        if (!db.objectStoreNames.contains("parsed")) db.createObjectStore("parsed", { keyPath:"id" });
        if (!db.objectStoreNames.contains("annotations")){
          const store = db.createObjectStore("annotations", { keyPath:"id" });
          store.createIndex("byDoc", "docId", { unique:false });
        }
        if (!db.objectStoreNames.contains("ink")){
          const store = db.createObjectStore("ink", { keyPath:"id" });
          store.createIndex("byDoc", "docId", { unique:false });
        }
      };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const run = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => { const rq = fn(db.transaction(store, mode).objectStore(store)); rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); });
  };
  return {
    async putDoc(d){ const db=await open(); return new Promise((res,rej)=>{ const tx=db.transaction(["docs","lib"],"readwrite");
      tx.objectStore("docs").put(d); tx.objectStore("lib").put(liteDoc(d)); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); tx.onabort=()=>rej(tx.error||new Error("write aborted")); }); },
    getDoc:(id)=>run("docs","readonly",s=>s.get(id)),
    allDocs:()=>run("lib","readonly",s=>s.getAll()),
    async delDoc(id){ const db=await open(); return new Promise((res,rej)=>{ const tx=db.transaction(["docs","lib"],"readwrite");
      tx.objectStore("docs").delete(id); tx.objectStore("lib").delete(id); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); },
    getMeta:(id)=>run("meta","readonly",s=>s.get(id)), allMeta:()=>run("meta","readonly",s=>s.getAll()),
    delMeta:(id)=>run("meta","readwrite",s=>s.delete(id)),
    async setMeta(id,patch){ const cur=(await this.getMeta(id))||{id}; Object.assign(cur,patch,{id}); return run("meta","readwrite",s=>s.put(cur)); },
    putParsed:(d)=>run("parsed","readwrite",s=>s.put(d)), getParsed:(id)=>run("parsed","readonly",s=>s.get(id)),
    delParsed:(id)=>run("parsed","readwrite",s=>s.delete(id)),
    putAnnotation:(a)=>run("annotations","readwrite",s=>s.put(a)),
    delAnnotation:(id)=>run("annotations","readwrite",s=>s.delete(id)),
    async annotationsForDoc(docId){
      const db = await open();
      return new Promise((res,rej)=>{
        const idx = db.transaction("annotations","readonly").objectStore("annotations").index("byDoc");
        const rq = idx.getAll(docId);
        rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error);
      });
    },
    async delAnnotationsForDoc(docId){
      const items = await this.annotationsForDoc(docId);
      return Promise.all(items.map(a=>this.delAnnotation(a.id)));
    },
    putInk:(s)=>run("ink","readwrite",st=>st.put(s)),
    delInk:(id)=>run("ink","readwrite",st=>st.delete(id)),
    async inkForDoc(docId){
      const db = await open();
      return new Promise((res,rej)=>{
        const idx = db.transaction("ink","readonly").objectStore("ink").index("byDoc");
        const rq = idx.getAll(docId);
        rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error);
      });
    },
    async delInkForDoc(docId){
      const items = await this.inkForDoc(docId);
      return Promise.all(items.map(s=>this.delInk(s.id)));
    },
  };
})();

/* ---------- theme ---------- */
const Theme = {
  SETTINGS_ID:"__settings__", // reserved id in the "meta" store -- never collides with a document id (those are UUIDs/timestamps)
  current:"dark",
  async init(){
    let saved=null;
    try{ const m=await DB.getMeta(this.SETTINGS_ID); saved=m&&m.theme; }catch(e){}
    const theme = (["light","dark","sepia","gray","black"].indexOf(saved)>=0) ? saved
      : (window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    this.apply(theme);
  },
  apply(theme){
    this.current=theme;
    document.documentElement.setAttribute("data-theme", theme);
    try{ const mt=document.querySelector('meta[name="theme-color"]'); if(mt) mt.content = ({light:"#ffffff",dark:"#14161a",sepia:"#f4ecd8",gray:"#3a3d42",black:"#000000"})[theme]||"#14161a"; }catch(e){}
    const btn=$("#themeBtn"); if(!btn) return;
    btn.innerHTML = theme==="light"
      ? '<svg viewBox="0 0 24 24"><path d="M12 4V2m0 20v-2M4 12H2m20 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4M5.6 18.4 4.2 19.8M19.8 4.2l-1.4 1.4M12 7a5 5 0 100 10 5 5 0 000-10z"/></svg> Switch to dark mode'
      : '<svg viewBox="0 0 24 24"><path d="M20.7 15.3A8.5 8.5 0 119 3.3a7 7 0 0011.7 12z"/></svg> Switch to light mode';
    btn.title = theme==="light" ? "Switch to dark mode" : "Switch to light mode";
  },
  async setTheme(t){ this.apply(t); try{ await DB.setMeta(this.SETTINGS_ID,{theme:t}); }catch(e){} },
  async toggle(){
    const next = this.current==="light" ? "dark" : "light";
    this.setTheme(next);
  }
};
$("#themeBtn").onclick=()=>{ closeMoreMenu(); Settings.open(); };
Theme.init();

/* ---------- read-aloud toggle: lets the app be used for silent/direct reading ---------- */
const ReadAloud = {
  enabled:true,
  async init(){
    let saved=null;
    try{ const m=await DB.getMeta(Theme.SETTINGS_ID); saved=m&&m.readAloud; }catch(e){}
    this.enabled = saved!==false; // default on, matching existing behavior
    this.apply();
  },
  apply(){
    const btn=$("#readAloudBtn"); if(!btn) return;
    btn.innerHTML = this.enabled
      ? '<svg viewBox="0 0 24 24"><path d="M5 9v6h4l5 5V4L9 9H5zm13.5 3c0-1.77-1-3.29-2.5-4.03v8.05c1.5-.73 2.5-2.25 2.5-4.02z"/></svg> Read aloud: On'
      : '<svg viewBox="0 0 24 24"><path d="M5 9v6h4l5 5V4L9 9H5zm9.4 3 2-2-1.4-1.4-2 2-2-2L9.6 10l2 2-2 2L11 15.4l2-2 2 2 1.4-1.4z"/></svg> Read aloud: Off (direct reading)';
    btn.title = this.enabled ? "Turn off to read silently" : "Turn on to have books read aloud";
    UI.enableControls(UI.activeId!=null && Reader.words.length>0);
  },
  async toggle(){
    this.enabled=!this.enabled;
    if(!this.enabled && Speech.playing) Speech.pause();
    this.apply();
    try{ await DB.setMeta(Theme.SETTINGS_ID,{readAloud:this.enabled}); }catch(e){}
  }
};
$("#readAloudBtn").onclick=()=>{ ReadAloud.toggle(); };
ReadAloud.init(); // load the saved on/off state -- without this it silently resets to "on" every launch
async function parsePDF(blob, onProgress, ctx){
  await ensurePdf();
  const pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
  if (ctx) ctx.pages = pdf.numPages;
  const rawLines = []; // one entry per visually-distinct line: {page, y, pageHeight, pageWidth, fontSize, items:[{str,x,y,w,h}]}
  for (let p=1;p<=pdf.numPages;p++){
    const page = await pdf.getPage(p); const content = await page.getTextContent();
    const vp = page.getViewport({scale:1});
    const pageHeight = vp.height || 792, pageWidth = vp.width || 612;
    let lineItems=[], lastY=null, lineSizes=[];
    const flush=(atY)=>{
      if(lineItems.length){
        const fs = lineSizes.length ? (lineSizes.reduce((a,b)=>a+b,0)/lineSizes.length) : 0;
        rawLines.push({ page:p, y:(atY==null?lastY:atY), pageHeight, pageWidth, fontSize:fs, items:lineItems });
        lineItems=[]; lineSizes=[];
      }
    };
    for (const it of content.items){
      const y=it.transform[5];
      if(lastY!==null && Math.abs(y-lastY)>4) flush(lastY);
      const x=it.transform[4];
      const h=Math.abs(it.transform[3])||0;
      const w=(it.width!=null && it.width>0) ? it.width : (Math.abs(it.transform[0])*(it.str||"").length*0.5);
      lineItems.push({str:it.str, x, y, w, h});
      lineSizes.push(h);
      if(it.hasEOL) flush(y);
      lastY=y;
    }
    flush(lastY);
    onProgress && onProgress(p/pdf.numPages);
  }
  return classifyPdfLines(rawLines);
}

/* Splits a line's pdf.js text items into word-level {str,x,y,w,h} records.
   Each item's own width is distributed across its characters proportionally
   (a reasonable approximation without a full text-shaping engine) when the
   item contains internal whitespace. Adjacent items with no real gap between
   them (common for kerned runs) are merged into a single word rather than
   split, using a gap threshold relative to line height. */
function lineItemsToWords(items, pageHeight){
  const words=[]; let pending=null;
  const GAP_FRAC=0.25;
  for (const it of items){
    const pieces = (it.str||"").split(/(\s+)/);
    let cx=it.x; const totalChars=(it.str||"").length || 1;
    for (const piece of pieces){
      if (piece==="") continue;
      const pw = it.w * (piece.length/totalChars);
      if (/^\s+$/.test(piece)){
        if (pending){ words.push(pending); pending=null; }
        cx += pw; continue;
      }
      const wordX=cx; cx += pw;
      if (pending){
        const gap = wordX - (pending.x+pending.w);
        if (gap > (it.h||8)*GAP_FRAC){ words.push(pending); pending={str:piece, x:wordX, baselineY:it.y, w:pw, h:it.h}; }
        else { pending.str += piece; pending.w = (wordX+pw) - pending.x; }
      } else {
        pending = {str:piece, x:wordX, baselineY:it.y, w:pw, h:it.h};
      }
    }
  }
  if (pending) words.push(pending);
  // PDF space has Y=0 at the page bottom, growing up, with `y` recorded as
  // the text baseline. Convert to Y=0 at the page top growing down (the
  // canvas/CSS convention) using a rough ascent/descent split, since exact
  // glyph metrics aren't available here -- fine for a highlight box, which
  // doesn't need pixel-perfect alignment.
  return mergeStandaloneDevanagariMarks(words.map(w=>({
    str:w.str, x:w.x, w:w.w,
    y: pageHeight - (w.baselineY + w.h*0.8),
    h: w.h
  })));
}

/* Heuristic header/footer/footnote detection for PDFs.
   Basis: text in the top/bottom ~8% margin band of a page that either (a) repeats
   near-verbatim on 2+ pages (running header/footer/title), or (b) is a short
   page-number-shaped line, is treated as header/footer. Bottom-margin text that
   doesn't match either pattern but is set noticeably smaller than the document's
   median body font size is treated as a footnote. Everything else -- including
   ordinary paragraphs that merely happen to start/end near a margin -- is left
   as body text; this deliberately favors under-triggering over accidentally
   silencing real content. Genuinely a heuristic: expect occasional misses on
   unusual layouts, not perfect extraction. */
function classifyPdfLines(rawLines){
  const TOP_FRAC=0.08, BOT_FRAC=0.08, GAP_SPLIT=20;
  const lineText = l => l.items.map(i=>i.str).join("").replace(/\s+/g," ").trim();
  const pages=[...new Set(rawLines.map(l=>l.page))].sort((a,b)=>a-b);
  const byPage={};
  rawLines.forEach(l=>{
    const frac = 1 - (l.y / (l.pageHeight||792)); // ~0 near top edge, ~1 near bottom edge
    let zone="body";
    if (frac<=TOP_FRAC) zone="top"; else if (frac>=1-BOT_FRAC) zone="bottom";
    (byPage[l.page] || (byPage[l.page]={top:[],body:[],bottom:[]}))[zone].push(l);
  });

  // Detects a vertical whitespace gutter in the body band's text items,
  // analogous to the pixel-based detector used for scanned pages, but
  // working on item X-coverage instead of rendered pixel density (text
  // items are sparse, so a coarser bucket resolution is enough). Needed
  // because pdf.js returns text items in whatever order the PDF's content
  // stream defines -- usually column-by-column for typeset documents, but
  // not guaranteed, and some producers emit roughly row-by-row across the
  // full page width, which interleaves both columns' text.
  function detectTextColumnGutter(lines, pageWidth){
    if (!pageWidth) return null;
    const BUCKETS=200;
    const occ=new Float32Array(BUCKETS);
    lines.forEach(l=>l.items.forEach(it=>{
      const b0=Math.max(0,Math.floor(it.x/pageWidth*BUCKETS));
      const b1=Math.min(BUCKETS-1,Math.ceil((it.x+it.w)/pageWidth*BUCKETS));
      for (let b=b0;b<=b1;b++) occ[b]=1;
    }));
    const searchStart=Math.floor(BUCKETS*0.35), searchEnd=Math.floor(BUCKETS*0.65);
    let bestStart=-1,bestEnd=-1,bestLen=0,curStart=-1;
    for (let b=searchStart;b<=searchEnd;b++){
      if (occ[b]===0){ if(curStart===-1) curStart=b; }
      else { if(curStart!==-1){ const len=b-curStart; if(len>bestLen){bestLen=len;bestStart=curStart;bestEnd=b;} curStart=-1; } }
    }
    if (curStart!==-1){ const len=searchEnd-curStart; if(len>bestLen){bestLen=len;bestStart=curStart;bestEnd=searchEnd;} }
    const MIN_LEN=Math.max(3,Math.floor(BUCKETS*0.015)), MAX_LEN=Math.floor((searchEnd-searchStart)*0.7);
    if (bestLen<MIN_LEN || bestLen>MAX_LEN) return null;
    let leftOcc=0,rightOcc=0;
    for (let b=Math.max(0,bestStart-15); b<bestStart; b++) leftOcc+=occ[b];
    for (let b=bestEnd; b<Math.min(BUCKETS,bestEnd+15); b++) rightOcc+=occ[b];
    if (leftOcc<3 || rightOcc<3) return null; // require real content on both sides, not just a sparse/blank page
    return ((bestStart+bestEnd)/2)/BUCKETS*pageWidth;
  }

  Object.keys(byPage).forEach(pnum=>{
    const bodyLines=byPage[pnum].body;
    if (bodyLines.length<4) return; // too little content to reliably judge column layout
    const pageWidth=bodyLines[0].pageWidth;
    const gutterX=detectTextColumnGutter(bodyLines, pageWidth);
    if (gutterX==null) return;
    const left=[], right=[];
    bodyLines.forEach(l=>{
      let leftW=0, rightW=0;
      l.items.forEach(it=>{ if ((it.x+it.w/2)<gutterX) leftW+=it.w; else rightW+=it.w; });
      (leftW>=rightW ? left : right).push(l);
    });
    left.sort((a,b)=>b.y-a.y); right.sort((a,b)=>b.y-a.y);
    byPage[pnum].body = left.concat(right);
  });

  function clusterBand(lines){
    const sorted=[...lines].sort((a,b)=>b.y-a.y); // top-to-bottom reading order
    const groups=[]; let cur=null;
    sorted.forEach(l=>{
      if(cur && Math.abs(cur.lastY-l.y)<=GAP_SPLIT){ cur.lines.push(l); cur.lastY=l.y; }
      else { cur={lines:[l], lastY:l.y}; groups.push(cur); }
    });
    return groups.map(g=>({
      text: g.lines.map(lineText).join(" ").replace(/\s+/g," ").trim(),
      words: g.lines.reduce((acc,l)=>acc.concat(lineItemsToWords(l.items, l.pageHeight)), []),
      fontSize: g.lines.reduce((a,x)=>a+x.fontSize,0)/g.lines.length,
      page: g.lines[0].page
    }));
  }

  const topGroups=[], botGroups=[];
  Object.keys(byPage).forEach(pnum=>{
    clusterBand(byPage[pnum].top).forEach(g=>topGroups.push(g));
    clusterBand(byPage[pnum].bottom).forEach(g=>botGroups.push(g));
  });

  const norm = s => s.toLowerCase().replace(/\d+/g,"#").replace(/[^\p{L}\p{N}# ]+/gu," ").replace(/\s+/g," ").trim();
  const pageNumPattern = /^[\W]*(page\s*)?#+(\s*(of|\/)\s*#+)?[\W]*$/i;
  function repeatMapFor(groups){
    const m={};
    groups.forEach(g=>{ const k=norm(g.text); if(!m[k]) m[k]=new Set(); m[k].add(g.page); });
    return m;
  }
  const topRepeat=repeatMapFor(topGroups), botRepeat=repeatMapFor(botGroups);

  const bodyFS = rawLines.filter(l=>{
    const frac=1-(l.y/(l.pageHeight||792));
    return frac>TOP_FRAC && frac<1-BOT_FRAC;
  }).map(l=>l.fontSize).filter(f=>f>0).sort((a,b)=>a-b);
  const medianFS = bodyFS.length ? bodyFS[Math.floor(bodyFS.length/2)] : 0;

  function classify(g, repeatMap, isBottom){
    if(!g.text) return "body";
    const k=norm(g.text);
    const repeated = repeatMap[k] && repeatMap[k].size>=2;
    const looksLikePageNum = g.text.split(/\s+/).length<=8 && pageNumPattern.test(norm(g.text));
    if (repeated || looksLikePageNum) return isBottom?"footer":"header";
    if (isBottom && medianFS>0 && g.fontSize>0 && g.fontSize < medianFS*0.85) return "footnote";
    return "body";
  }

  const byPageOut={};
  topGroups.forEach(g=>{ const o=(byPageOut[g.page] || (byPageOut[g.page]={top:[],bottom:[]})); if(g.text) o.top.push({text:g.text, words:g.words, role:classify(g,topRepeat,false), page:g.page, pageWidth:g.pageWidth, pageHeight:g.pageHeight}); });
  botGroups.forEach(g=>{ const o=(byPageOut[g.page] || (byPageOut[g.page]={top:[],bottom:[]})); if(g.text) o.bottom.push({text:g.text, words:g.words, role:classify(g,botRepeat,true), page:g.page, pageWidth:g.pageWidth, pageHeight:g.pageHeight}); });

  const out=[];
  pages.forEach(p=>{
    const bp=byPageOut[p]||{top:[],bottom:[]};
    bp.top.forEach(b=>out.push(b));
    const bodyLines=byPage[p]?byPage[p].body:[];
    const bodyText=bodyLines.map(lineText).join(" ").replace(/\s+/g," ").trim();
    const bodyWords=bodyLines.reduce((acc,l)=>acc.concat(lineItemsToWords(l.items, l.pageHeight)), []);
    if (bodyText) out.push({text:bodyText, words:bodyWords, role:"body", page:p});
    bp.bottom.forEach(b=>out.push(b));
  });
  return out;
}
async function parseDOCX(blob){ await ensureMammoth(); const res = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() }); return htmlToBlocks(res.value, {docx:true}); }
// resolve an href found inside archive file `fromPath` to a normalized archive path (no #fragment)
function zipPath(fromPath, href){
  href=String(href||"").split("#")[0]; if(!href) return "";
  if(/^[a-z][a-z0-9+.-]*:/i.test(href)) return "";          // http:, data:, ...
  try{ href=decodeURIComponent(href); }catch(e){}
  const base = href.startsWith("/") ? "" : fromPath.slice(0, fromPath.lastIndexOf("/")+1);
  const out=[]; (base+href).split("/").forEach(seg=>{ if(!seg||seg===".") return; if(seg==="..") out.pop(); else out.push(seg); });
  return out.join("/");
}
async function parseEPUB(blob, onProgress, ctx){
  await ensureZip();
  const zip = await JSZip.loadAsync(blob);
  const xml = (t)=>new DOMParser().parseFromString(t,"application/xml");
  const opfPath = xml(await zip.file("META-INF/container.xml").async("string")).querySelector("rootfile").getAttribute("full-path");
  const opf = xml(await zip.file(opfPath).async("string"));
  const items={}; opf.querySelectorAll("manifest > item").forEach(i=>items[i.getAttribute("id")]={ href:i.getAttribute("href"), type:i.getAttribute("media-type")||"", props:i.getAttribute("properties")||"" });
  const spine=[...opf.querySelectorAll("spine > itemref")].map(i=>i.getAttribute("idref"));
  const getFile=(path)=>zip.file(path)||zip.file(path.replace(/^\.?\//,""));
  const blocks=[], fileStart={}, anchors={};
  let n=0;
  for (const idref of spine){
    n++; if(onProgress) onProgress(n/spine.length);
    const it=items[idref]; if(!it||!it.href) continue;
    const path=zipPath(opfPath, it.href);
    const f=getFile(path); if(!f) continue;
    const base=blocks.length; fileStart[path]=base;
    const part=htmlToBlocks(await f.async("string"), {
      epub:true,
      resolveImg:(src)=>zipPath(path, src),
      onAnchor:(id,local)=>{ if(!(path+"#"+id in anchors)) anchors[path+"#"+id]=base+local; }
    });
    for (const b of part) blocks.push(b);
  }
  // table of contents: EPUB3 nav document, else the EPUB2 NCX
  try{
    const toc=[];
    const navItem=Object.values(items).find(i=>/\bnav\b/.test(i.props));
    const ncxItem=(opf.querySelector("spine")&&items[opf.querySelector("spine").getAttribute("toc")]) || Object.values(items).find(i=>/dtbncx/.test(i.type));
    const resolve=(from,href,title,lvl)=>{
      const path=zipPath(from, href); const frag=(String(href).split("#")[1]||"");
      let blk=null; if(frag){ try{ blk=anchors[path+"#"+decodeURIComponent(frag)]; }catch(e){} if(blk==null) blk=anchors[path+"#"+frag]; }
      if(blk==null) blk=fileStart[path];
      title=String(title||"").replace(/\s+/g," ").trim();
      if(blk!=null && title) toc.push({title, blk, lvl:Math.max(1,Math.min(3,lvl))});
    };
    if(navItem){
      const np=zipPath(opfPath, navItem.href); const nf=getFile(np);
      if(nf){
        const nd=new DOMParser().parseFromString(await nf.async("string"),"text/html");
        const nav=[...nd.querySelectorAll("nav")].find(x=>/toc/i.test(x.getAttribute("epub:type")||x.getAttribute("role")||x.id||"")) || nd.querySelector("nav");
        const walk=(ol,lvl)=>{ if(!ol) return; [...ol.children].forEach(li=>{ if(li.tagName!=="LI") return;
          const a=li.querySelector(":scope > a, :scope > span > a"); const label=li.querySelector(":scope > a, :scope > span");
          if(a) resolve(np, a.getAttribute("href")||"", a.textContent, lvl); else if(label){ /* heading without link */ }
          const sub=li.querySelector(":scope > ol"); if(sub) walk(sub, lvl+1); }); };
        if(nav) walk(nav.querySelector("ol"), 1);
      }
    }
    if(toc.length<2 && ncxItem){
      const cp=zipPath(opfPath, ncxItem.href); const cf=getFile(cp);
      if(cf){
        toc.length=0;
        const nd=xml(await cf.async("string"));
        const walk=(parent,lvl)=>{ [...parent.children].forEach(el2=>{ if(el2.localName!=="navPoint") return;
          const label=el2.querySelector(":scope > navLabel > text"); const c=el2.querySelector(":scope > content");
          if(c) resolve(cp, c.getAttribute("src")||"", label?label.textContent:"", lvl);
          walk(el2, lvl+1); }); };
        const map=nd.querySelector("navMap"); if(map) walk(map,1);
      }
    }
    toc.sort((x,y)=>x.blk-y.blk);
    const seen=new Set(); const clean=toc.filter(t=>{ const k=t.blk+"|"+t.title; if(seen.has(k)) return false; seen.add(k); return true; });
    if(ctx) ctx.toc=clean;
  }catch(e){ console.warn("toc parse failed", e); }
  return blocks;
}
/* role tagging: "body" is read aloud, anything else is shown (dimmed) but skipped.
   - DOCX: mammoth never includes header1.xml/footer1.xml content in convertToHtml's
     output, so running headers/footers are already absent -- nothing to strip there.
     Footnotes/endnotes DO come through: an inline superscript reference marker plus
     a list item near the end of the body, both carrying ids like "footnote-3" by
     mammoth's own convention. Both are tagged/stripped here.
   - EPUB: reflowable text has no page concept in this app, so headers/footers
     structurally don't apply. Footnotes are detected via the EPUB3/ARIA semantic
     markers (epub:type="noteref"/"footnote", role="doc-noteref"/"doc-footnote")
     where publishers use them -- this is best-effort, since plenty of EPUBs mark
     footnotes with nothing more than an arbitrary class name or none at all. */
function htmlToBlocks(html, opts){
  opts = opts || {};
  const doc = (typeof html==="string") ? new DOMParser().parseFromString(html,"text/html") : html; // string or an already-parsed Document (MOBI sections)
  doc.querySelectorAll("script,style,head").forEach(n=>n.remove());

  // Strip inline footnote/endnote reference markers so a bare "1" isn't read
  // aloud mid-sentence. Uses only plain attribute selectors (no CSS namespace
  // escaping) for reliability.
  doc.querySelectorAll('sup a[id^="footnote-ref-"], sup a[id^="endnote-ref-"], a[role="doc-noteref"]').forEach(a=>{
    const sup=a.closest("sup"); (sup||a).remove();
  });
  if (opts.epub){
    doc.querySelectorAll("a").forEach(a=>{
      const et=a.getAttribute("epub:type")||"";
      if(/noteref/i.test(et)){ const sup=a.closest("sup"); (sup||a).remove(); }
    });
  }

  function isFootnoteNode(n){
    if (opts.docx){
      let a=n;
      while(a){ if(a.id && /^(footnote|endnote)-/i.test(a.id)) return true; a=a.parentElement; }
    }
    if (opts.epub){
      let a=n;
      while(a){
        const et=(a.getAttribute && (a.getAttribute("epub:type")||a.getAttribute("role")))||"";
        if (/footnote/i.test(et)) return true;
        a=a.parentElement;
      }
    }
    return false;
  }

  // Structural walk: every piece of text is emitted exactly once, in document order, as
  // its own paragraph. (The old "querySelectorAll(p,li,blockquote,td…)" approach duplicated
  // text whenever blocks nested -- <li><p>, <blockquote><p>, <td><p> -- and silently dropped
  // text that sat directly in a <div> or after a <br>, which is how many converted EPUBs are built.)
  doc.querySelectorAll("nav,audio,video,object,canvas,rt,[hidden]").forEach(n=>n.remove());
  const BLOCK=new Set("P H1 H2 H3 H4 H5 H6 LI BLOCKQUOTE TD TH PRE DIV SECTION ARTICLE ASIDE UL OL TABLE TBODY THEAD TFOOT TR DL DT DD FIGURE FIGCAPTION HEADER FOOTER MAIN BODY FORM ADDRESS DETAILS SUMMARY CENTER HGROUP".split(" "));
  const BLOCK_SEL="p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,pre,div,section,article,aside,ul,ol,table,tr,dl,dt,dd,figure,figcaption,details,center";
  const kindFor=(tag,inherit)=>{
    if (/^H[1-6]$/.test(tag)) return "h"+tag[1];
    if (tag==="BLOCKQUOTE") return "quote";
    if (tag==="LI"||tag==="DT"||tag==="DD") return "li";
    if (tag==="PRE") return "pre";
    if (tag==="P"||tag==="DIV"||tag==="TD"||tag==="TH") return (inherit==="li"||inherit==="quote") ? inherit : undefined;
    return inherit;
  };
  const blocks=[];
  function walk(n, kind){
    let run=[];
    const flush=()=>{
      const t=run.join("").replace(/\s+/g," ").trim(); run=[];
      if (!t) return;
      const blk={ text:t, role: isFootnoteNode(n) ? "footnote" : "body" };
      if (kind) blk.kind=kind;
      blocks.push(blk);
    };
    n.childNodes.forEach(c=>{
      if (c.nodeType===3){ run.push(c.nodeValue); return; }
      if (c.nodeType!==1) return;
      const tag=c.tagName;
      if (c.id && opts.onAnchor){ if (BLOCK.has(tag)) flush(); opts.onAnchor(c.id, blocks.length); }
      if (tag==="IMG" || (tag.toLowerCase()==="svg")){
        let src=""; let alt="";
        if (tag==="IMG"){ src=c.getAttribute("src")||""; alt=c.getAttribute("alt")||""; const w=parseInt(c.getAttribute("width"),10), h=parseInt(c.getAttribute("height"),10); if ((w&&w<48)||(h&&h<48)) return; }
        else { const im=c.querySelector("image"); if (im) src=im.getAttribute("xlink:href")||im.getAttribute("href")||""; }
        if (src){
          const ref = /^data:image\//i.test(src) ? src : (opts.resolveImg ? opts.resolveImg(src) : "");
          if (ref){ flush(); blocks.push({ img:ref, alt, role:"body" }); }
        }
        return;
      }
      if (tag==="HR"){ flush(); return; }
      if (tag==="BR"){
        // a <br> mid-sentence (hard-wrapped lines from converted books) is just a space;
        // after a finished sentence, a short line (verse) or a doubled <br> it ends the paragraph
        const cur=run.join("").replace(/\s+/g," ").trim();
        if (!cur || cur.length<45 || /[.!?\u2026:;"\u201d\u2019)\]]$/.test(cur) || (c.previousSibling && c.previousSibling.nodeName==="BR")) flush(); else run.push(" ");
        return;
      }
      if (BLOCK.has(tag) || (c.querySelector && c.querySelector(BLOCK_SEL+",img,svg"))){ flush(); walk(c, kindFor(tag, kind)); }
      else run.push(c.textContent);
    });
    flush();
  }
  if (doc.body) walk(doc.body, undefined);
  if (!blocks.length){ const t=(doc.body?doc.body.textContent:"").replace(/\s+/g," ").trim(); if(t) blocks.push({text:t, role:"body"}); }
  return blocks;
}
/* ---------- v2 formats: TXT / Markdown / FB2 / HTML / MOBI / comics ---------- */
function decodeBytes(buf, hint){
  const u8=new Uint8Array(buf);
  if(u8[0]===0xEF&&u8[1]===0xBB&&u8[2]===0xBF) return new TextDecoder("utf-8").decode(u8.subarray(3));
  if(u8[0]===0xFF&&u8[1]===0xFE) return new TextDecoder("utf-16le").decode(u8.subarray(2));
  if(u8[0]===0xFE&&u8[1]===0xFF) return new TextDecoder("utf-16be").decode(u8.subarray(2));
  if(hint){ try{ return new TextDecoder(hint).decode(u8); }catch(e){} }
  try{ return new TextDecoder("utf-8",{fatal:true}).decode(u8); }
  catch(e){ return new TextDecoder("windows-1252").decode(u8); }
}
// Light Markdown -> plain-text blocks: drops syntax characters so they aren't read aloud.
function markdownToBlocks(text){
  const blocks=[]; let para=[]; let inFence=false;
  const flush=()=>{ const t=para.join(" ").replace(/\s+/g," ").trim(); if(t) blocks.push({text:t,role:"body"}); para=[]; };
  const inline=(l)=>l
    .replace(/!\[([^\]]*)\]\([^)]*\)/g,"$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g,"$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g,"$1")
    .replace(/<(https?:[^>]+)>/g,"$1")
    .replace(/<\/?[a-zA-Z][^>]*>/g,"")
    .replace(/`+([^`]*)`+/g,"$1")
    .replace(/(\*\*|__)(.+?)\1/g,"$2")
    .replace(/(^|[\s(])(\*|_)(?=\S)(.+?)(?<=\S)\2(?=$|[\s).,;:!?])/g,"$1$3")
    .replace(/~~(.+?)~~/g,"$1");
  for(const raw of text.replace(/\r\n?/g,"\n").split("\n")){
    if(/^\s*(```|~~~)/.test(raw)){ flush(); inFence=!inFence; continue; }
    if(inFence){ const t=raw.trim(); if(t) blocks.push({text:t,role:"body"}); continue; }
    let l=raw.trim();
    if(!l){ flush(); continue; }
    if(/^([-*_]\s*){3,}$/.test(l)||/^(=+|-+)$/.test(l)) { flush(); continue; }   // rules / setext underlines
    if(/^\[[^\]]+\]:\s*\S+/.test(l)) continue;                                      // reference link definitions
    if(/^\|?[\s:|-]+\|?$/.test(l) && l.includes("-")) continue;                      // table separator rows
    const heading=/^#{1,6}\s+/.test(l);
    l=l.replace(/^#{1,6}\s+/,"").replace(/\s+#+\s*$/,"").replace(/^(>\s*)+/,"");
    const item=/^([-*+]|\d+[.)])\s+/.test(l);
    l=l.replace(/^([-*+]|\d+[.)])\s+/,"").replace(/^\[[ xX]\]\s+/,"");
    if(l.startsWith("|")||l.includes(" | ")) l=l.replace(/\|/g," ");
    l=inline(l);
    if(heading||item){ flush(); const t=l.replace(/\s+/g," ").trim(); if(t) blocks.push({text:t,role:"body"}); }
    else para.push(l);
  }
  flush(); return blocks;
}
function plainTextToBlocks(text){
  text=text.replace(/\r\n?/g,"\n");
  let parts=text.split(/\n[ \t]*\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
  if(parts.length<=1 && text.split("\n").filter(l=>l.trim()).length>3)   // no blank lines at all: one block per line
    parts=text.split("\n").map(x=>x.trim()).filter(Boolean);
  return parts.map(t=>({text:t,role:"body"}));
}
async function parseTextFile(blob, ext){
  const text=decodeBytes(await blob.arrayBuffer());
  return (ext==="md"||ext==="markdown") ? markdownToBlocks(text) : plainTextToBlocks(text);
}
async function parseHTMLFile(blob){ return htmlToBlocks(decodeBytes(await blob.arrayBuffer()), {}); }
async function parseFB2(blob){
  const buf=await blob.arrayBuffer();
  const head=new TextDecoder("latin1").decode(new Uint8Array(buf,0,Math.min(300,buf.byteLength)));
  const m=/encoding=["']([\w-]+)["']/i.exec(head);
  const d=new DOMParser().parseFromString(decodeBytes(buf, m&&m[1]),"application/xml");
  if(d.getElementsByTagName("parsererror").length) throw new Error("This FB2 file is not valid XML.");
  [...d.getElementsByTagName("a")].forEach(a=>{ if(a.getAttribute("type")==="note") a.remove(); }); // inline note markers
  const blocks=[];
  [...d.getElementsByTagName("body")].forEach(body=>{
    const notes=(body.getAttribute("name")||"")==="notes";
    body.querySelectorAll("p,v").forEach(n=>{
      const t=(n.textContent||"").replace(/\s+/g," ").trim(); if(t) blocks.push({text:t, role:notes?"footnote":"body"});
    });
  });
  return blocks;
}
async function parseMOBI(blob){
  const mod=await ensureMobi();
  const unzlib=async(u8)=>{ const ds=new DecompressionStream("deflate"); const w=ds.writable.getWriter(); w.write(u8); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer()); };
  const mobi=new mod.MOBI({unzlib}); let book;
  try{ book=await mobi.open(blob); }
  catch(e){ throw new Error("Could not read this MOBI/AZW file ("+(e&&e.message||e)+")."); }
  if(mobi.headers && mobi.headers.palmdoc && mobi.headers.palmdoc.encryption>0)
    throw new Error("This book is DRM-protected and cannot be read.");
  const blocks=[];
  for(const sec of (book.sections||[])){
    let d; try{ d=await sec.createDocument(); }catch(e){ continue; }
    for(const b of htmlToBlocks(d,{})) blocks.push(b);
  }
  return blocks;
}

/* Comics / image archives (CBZ, CBR, ZIP, RAR). Pages are shown as images; reading aloud needs OCR. */
const IMG_RE=/\.(jpe?g|png|gif|webp|bmp|avif)$/i;
const naturalCmp=(a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"});
const comicCache={id:null, entries:null};
const imgMime=(n)=>{ const e=extOf(n); return e==="jpg"?"image/jpeg":"image/"+e; };
async function loadComicEntries(doc, onProgress){
  if(comicCache.id===doc.id && comicCache.entries) return comicCache.entries;
  const head=new Uint8Array(await doc.blob.slice(0,8).arrayBuffer());
  const isRar=head[0]===0x52&&head[1]===0x61&&head[2]===0x72&&head[3]===0x21; // "Rar!"
  let entries=[];
  if(isRar){
    const U=await ensureUnrar();
    const data=new Uint8Array(await doc.blob.arrayBuffer());
    const wasm=b64bytes("unrar-wasm");
    const ex=await U.createExtractorFromData({wasmBinary: wasm.buffer, data});
    const names=[...ex.getFileList().fileHeaders].filter(h=>!h.flags.directory && IMG_RE.test(h.name) && !/(^|\/)(__MACOSX|\._)/.test(h.name)).map(h=>h.name).sort(naturalCmp);
    const byName=new Map(); let n=0;
    for(const f of ex.extract({files:names}).files){
      // the bundled unrar build yields the bytes directly as `extraction`; newer builds wrap them as `extraction.data`
      const bytes=f.extraction && (f.extraction.data || (f.extraction instanceof Uint8Array ? f.extraction : null));
      if(bytes) byName.set(f.fileHeader.name, new Blob([bytes],{type:imgMime(f.fileHeader.name)}));
      if(onProgress) onProgress(++n/Math.max(1,names.length));
    }
    entries=names.filter(nm=>byName.has(nm)).map(nm=>({name:nm, getBlob:()=>Promise.resolve(byName.get(nm))}));
  } else {
    await ensureZip(); const zip=await JSZip.loadAsync(doc.blob);
    const files=[]; zip.forEach((path,f)=>{ if(!f.dir && IMG_RE.test(path) && !/(^|\/)(__MACOSX|\._)/.test(path)) files.push(f); });
    files.sort((a,b)=>naturalCmp(a.name,b.name));
    entries=files.map(f=>({name:f.name, getBlob:()=>f.async("blob").then(b=>b.type?b:new Blob([b],{type:imgMime(f.name)}))}));
  }
  if(!entries.length) throw new Error("No page images were found in this archive.");
  comicCache.id=doc.id; comicCache.entries=entries;
  return entries;
}
// Presents image pages through the small subset of the pdf.js page API that the reader and OCR use.
async function openImageBook(doc, onProgress){
  const entries=await loadComicEntries(doc, onProgress);
  const cache=new Map();
  const bmp=async(n)=>{
    if(cache.has(n)) return cache.get(n);
    const b=await createImageBitmap(await entries[n-1].getBlob());
    cache.set(n,b);
    if(cache.size>6){ const k=cache.keys().next().value; try{ cache.get(k).close(); }catch(e){} cache.delete(k); }
    return b;
  };
  return {
    numPages:entries.length, lazyDims:true,
    async getPage(n){
      const b=await bmp(n);
      return {
        getViewport:({scale})=>({width:b.width*scale, height:b.height*scale}),
        render:({canvasContext,viewport})=>({promise:Promise.resolve().then(()=>{ canvasContext.drawImage(b,0,0,viewport.width,viewport.height); })})
      };
    },
    destroy(){ cache.forEach(b=>{ try{ b.close(); }catch(e){} }); cache.clear(); }
  };
}
async function openPageSource(doc){
  if(isComicExt(extOf(doc.name))) return openImageBook(doc);
  await ensurePdf(); return pdfjsLib.getDocument({ data: await doc.blob.arrayBuffer() }).promise;
}
async function parseComic(doc, onProgress, ctx){
  const entries=await loadComicEntries(doc, onProgress);
  if(ctx){ ctx.pages=entries.length; ctx.comic=true; }
  return []; // no text until OCR is run
}

async function parseDoc(doc, onProgress, ctx){
  const ext = extOf(doc.name);
  if (ext==="pdf") return parsePDF(doc.blob,onProgress,ctx);
  if (ext==="docx") return parseDOCX(doc.blob);
  if (ext==="epub") return parseEPUB(doc.blob,onProgress,ctx);
  if (["mobi","azw","azw3","prc"].includes(ext)) return parseMOBI(doc.blob);
  if (ext==="fb2") return parseFB2(doc.blob);
  if (["txt","md","markdown"].includes(ext)) return parseTextFile(doc.blob, ext);
  if (["html","htm","xhtml"].includes(ext)) return parseHTMLFile(doc.blob);
  if (isComicExt(ext)) return parseComic(doc, onProgress, ctx);
  throw new Error("Unsupported file type: ."+ext);
}

/* ---------- OCR (fully embedded, self-contained worker — no network) ----------
   Tesseract's worker normally fetches its WASM core (via importScripts) and the
   language model (via fetch) from URLs. Here we prepend a shim to the worker that
   intercepts both and serves them from base64 baked into the worker itself, so
   nothing is ever requested over the network. */
/* Detects a vertical whitespace gutter near the horizontal center of a
   rendered page image, indicating a 2-column layout. Returns the gutter's
   x-coordinate (px) to split on, or null for single-column (or anything
   ambiguous -- deliberately conservative, since a wrong split is worse than
   no split). Tesseract's own automatic column detection is not used for
   ordering: it's known to sometimes read straight across both columns by
   row instead of down one column then the other, which is exactly the
   failure this works around. */
// A word consisting entirely of Devanagari combining marks (matras, virama,
// anusvara, visarga, candrabindu, and related vowel-sign variants) can never
// legally stand alone -- these always attach to a preceding consonant/vowel.
// If word-boundary detection (gap-based in the text-layer path, or
// Tesseract's own segmentation in the OCR path) wrongly splits one off, it
// ends up as its own entry in Reader.words[] -- and since the TTS utterance
// is built by joining words with a space, that space gets spoken aloud as a
// syllable break. This merges any such stray mark into the previous word,
// extending its bounding box to cover both when position data is present.
const DEVANAGARI_PURE_MARK = /^[\u0900-\u0903\u093A\u093C\u093E-\u094D\u0951-\u0957\u0962\u0963]+$/;
function mergeStandaloneDevanagariMarks(words){
  const out=[];
  for (const w of words){
    const str = (w.str!==undefined) ? w.str : w.text;
    if (out.length && str && DEVANAGARI_PURE_MARK.test(str)){
      const prev = out[out.length-1];
      if (prev.str!==undefined) prev.str += str; else prev.text += str;
      if (prev.x!=null && w.x!=null){
        const left=Math.min(prev.x, w.x), right=Math.max(prev.x+prev.w, w.x+w.w);
        const top=Math.min(prev.y, w.y), bot=Math.max(prev.y+prev.h, w.y+w.h);
        prev.x=left; prev.w=right-left; prev.y=top; prev.h=bot-top;
      }
    } else {
      out.push(Object.assign({}, w));
    }
  }
  return out;
}

function detectColumnGutter(canvas){
  try{
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const yStart = Math.floor(h*0.12), yEnd = Math.floor(h*0.88); // skip likely header/footer bands
    const bandH = Math.max(1, yEnd-yStart);
    const img = ctx.getImageData(0, yStart, w, bandH).data;
    const colDensity = new Float32Array(w);
    const rowStep = Math.max(1, Math.floor(bandH/300)); // sample ~300 rows for speed
    let sampledRows = 0;
    for (let y=0; y<bandH; y+=rowStep){
      sampledRows++;
      const rowOff = y*w*4;
      for (let x=0; x<w; x++){
        const idx = rowOff + x*4;
        const lum = (img[idx]+img[idx+1]+img[idx+2])/3;
        if (lum < 180) colDensity[x] += 1; // count "ink" pixels per column
      }
    }
    if (!sampledRows) return null;
    for (let x=0;x<w;x++) colDensity[x] /= sampledRows;

    // Look for the widest contiguous blank band within the middle third of the page.
    const searchStart = Math.floor(w*0.35), searchEnd = Math.floor(w*0.65);
    const DENSITY_THRESH = 0.01;
    let bestStart=-1, bestEnd=-1, bestLen=0, curStart=-1;
    for (let x=searchStart; x<=searchEnd; x++){
      if (colDensity[x] < DENSITY_THRESH){ if(curStart===-1) curStart=x; }
      else { if(curStart!==-1){ const len=x-curStart; if(len>bestLen){bestLen=len;bestStart=curStart;bestEnd=x;} curStart=-1; } }
    }
    if (curStart!==-1){ const len=searchEnd-curStart; if(len>bestLen){bestLen=len;bestStart=curStart;bestEnd=searchEnd;} }

    const MIN_GUTTER_PX = Math.max(8, Math.floor(w*0.008));
    const MAX_GUTTER_PX = Math.floor((searchEnd-searchStart)*0.6); // too wide = probably sparse/blank page, not a real gutter
    if (bestLen < MIN_GUTTER_PX || bestLen > MAX_GUTTER_PX) return null;

    // Require real ink density just outside both sides of the candidate gutter,
    // confirming there's actually a column of text on each side (not just a
    // stray gap on a sparsely-filled page).
    const sideSample = 40, MIN_SIDE_DENSITY = 0.03;
    let leftD=0, ln=0; for(let x=Math.max(0,bestStart-sideSample); x<bestStart; x++){ leftD+=colDensity[x]; ln++; }
    let rightD=0, rn=0; for(let x=bestEnd; x<Math.min(w,bestEnd+sideSample); x++){ rightD+=colDensity[x]; rn++; }
    leftD = ln?leftD/ln:0; rightD = rn?rightD/rn:0;
    if (leftD<MIN_SIDE_DENSITY || rightD<MIN_SIDE_DENSITY) return null;

    return Math.floor((bestStart+bestEnd)/2);
  } catch(e){ return null; }
}
function cropCanvas(src, sx, sy, sw, sh){
  const c = el("canvas"); c.width=sw; c.height=sh;
  c.getContext("2d").drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

const OCR_OUT = { text:true, blocks:true };
const OCR = {
  cancel:false, _workerURL:null, _langBytesEng:null, _langBytesHin:null,
  _buildWorkerURL(){
    if (this._workerURL) return this._workerURL;
    const coreB64 = document.getElementById("tess-core").textContent.trim();
    const langEngB64 = document.getElementById("tess-lang").textContent.trim();
    const langHinB64 = document.getElementById("tess-lang-hin").textContent.trim();
    const workerText = b64text("tess-worker");
    const shim =
      'var __CORE_B64="' + coreB64 + '";\n' +
      'var __LANG_ENG_B64="' + langEngB64 + '";\n' +
      'var __LANG_HIN_B64="' + langHinB64 + '";\n' +
      '(function(){\n' +
      'function _t(b){var s=atob(b),n=s.length,a=new Uint8Array(n);for(var i=0;i<n;i++)a[i]=s.charCodeAt(i);return new TextDecoder("utf-8").decode(a);}\n' +
      'function _b(b){var s=atob(b),n=s.length,a=new Uint8Array(n);for(var i=0;i<n;i++)a[i]=s.charCodeAt(i);return a;}\n' +
      'var _imp=self.importScripts.bind(self);\n' +
      'self.importScripts=function(){for(var i=0;i<arguments.length;i++){if(typeof arguments[i]==="string"&&/tesseract-core/.test(arguments[i])){(0,eval)(_t(__CORE_B64));return;}}return _imp.apply(self,arguments);};\n' +
      'var _f=self.fetch?self.fetch.bind(self):null;\n' +
      'self.fetch=function(u,o){try{var s=(typeof u==="string")?u:(u&&u.url);' +
      'if(s&&/hin\\.traineddata/.test(s)){return Promise.resolve(new Response(_b(__LANG_HIN_B64),{status:200,headers:{"Content-Type":"application/octet-stream"}}));}' +
      'if(s&&/eng\\.traineddata/.test(s)){return Promise.resolve(new Response(_b(__LANG_ENG_B64),{status:200,headers:{"Content-Type":"application/octet-stream"}}));}' +
      '}catch(e){}return _f?_f(u,o):Promise.reject(new Error("network disabled"));};\n' +
      '})();\n';
    this._workerURL = blobURL(shim + workerText);
    return this._workerURL;
  },
  async run(doc, onProgress, langOrder){
    this.cancel = false;
    if (!this._langBytesEng) this._langBytesEng = b64bytes("tess-lang");
    if (!this._langBytesHin) this._langBytesHin = b64bytes("tess-lang-hin");
    const langBytesEng = this._langBytesEng, langBytesHin = this._langBytesHin;

    // Also cover the case where the language model is requested from the main thread.
    // Routes by matching the language code in the filename -- NOT a blind single-blob
    // return -- since eng+hin loads two separate trained-data files.
    const origFetch = self.fetch ? self.fetch.bind(self) : null;
    self.fetch = function(u, o){
      try{
        const s=(typeof u==="string")?u:(u&&u.url);
        if(s && /hin\.traineddata/.test(s)) return Promise.resolve(new Response(langBytesHin,{status:200}));
        if(s && /eng\.traineddata/.test(s)) return Promise.resolve(new Response(langBytesEng,{status:200}));
      }catch(e){}
      return origFetch ? origFetch(u,o) : Promise.reject(new Error("network disabled"));
    };

    let worker, pdfSrcRef=null;
    try{
      const pdf = await openPageSource(doc); pdfSrcRef=pdf;
      const comic = isComicExt(extOf(doc.name));
      await ensureTess(); worker = await Tesseract.createWorker(langOrder||"hin+eng", 1, {
        workerPath: this._buildWorkerURL(), workerBlobURL:false,
        corePath:"core", langPath:"lang", gzip:true,
        logger:(m)=>{ if(m.status==="recognizing text") onProgress && onProgress({ frac:m.progress }); }
      });
      // Devanagari-specific tuning recommended by the hin.traineddata file itself
      // (visible as embedded config text) but not applied by default. Most
      // importantly: pageseg_devanagari_split_strategy splits the shirorekha
      // (the connecting head-stroke across Devanagari letters) before
      // recognition -- without it, conjunct clusters are a well-documented
      // source of garbled Hindi output. tessedit_char_blacklist(1) is
      // deliberately NOT set here, unlike the file's own Hindi-only
      // recommendation -- this worker does combined eng+hin recognition, and
      // blacklisting "1" would break English/numeral recognition in mixed
      // documents (page numbers, amounts, dates).
      try{
        await worker.setParameters({
          pageseg_devanagari_split_strategy: 1,
          segment_nonalphabetic_script: 1,
          tosp_old_to_method: "T",
          tosp_old_to_constrain_sp_kn: "T",
          tosp_old_sp_kn_th_factor: "4.0",
          tosp_only_small_gaps_for_kern: "T",
          tosp_use_pre_chopping: "T",
          classify_misfit_junk_penalty: "0.125",
          merge_fragments_in_matrix: "F"
        });
      }catch(e){ /* non-fatal: recognition still runs with defaults if this fails */ }
      const blocks=[];
      let lastPage=0;
      for (let p=1;p<=pdf.numPages;p++){
        if (this.cancel) break;
        onProgress && onProgress({ page:p, pages:pdf.numPages, frac:0 });
        const page=await pdf.getPage(p);
        const vp1=page.getViewport({scale:1});
        // Image pages are already raster: never upscale much (memory), and cap huge scans.
        const scale = comic ? Math.min(2, Math.max(0.5, 2200/vp1.width)) : Math.min(3.5, Math.max(1.5, 2200/vp1.width));
        const vp=page.getViewport({scale});
        const pageHeightPts=vp1.height;
        const canvas=el("canvas"); canvas.width=vp.width; canvas.height=vp.height;
        const cx=canvas.getContext("2d",{willReadFrequently:true});
        await page.render({canvasContext:cx, viewport:vp}).promise;
        const gutterX = detectColumnGutter(canvas);

        // Converts Tesseract's word bboxes (canvas pixel space, top-down,
        // possibly relative to a cropped column) into the same top-down
        // PDF-point-scaled space used by the text-layer extraction path.
        function wordsFromResult(res, xOffsetPx){
          // tesseract.js 5+/6 only returns word boxes inside data.blocks (and only when asked for them)
          let raw = (res && res.data && Array.isArray(res.data.words)) ? res.data.words : null;
          if (!raw && res && res.data && Array.isArray(res.data.blocks)){
            raw=[]; res.data.blocks.forEach(bl=>(bl.paragraphs||[]).forEach(pa=>(pa.lines||[]).forEach(li=>(li.words||[]).forEach(w=>raw.push(w)))));
          }
          if (!raw || !raw.length) return null; // signals "no word-level data available"
          const out=[];
          raw.forEach(w=>{
            if (!w || !w.text || !w.bbox) return;
            const t=w.text.trim(); if(!t) return;
            const x0=(w.bbox.x0+xOffsetPx)/scale, x1=(w.bbox.x1+xOffsetPx)/scale;
            const y0=w.bbox.y0/scale, y1=w.bbox.y1/scale;
            out.push({str:t, x:x0, y:y0, w:Math.max(0.5,x1-x0), h:Math.max(0.5,y1-y0)});
          });
          return out;
        }

        let pageText, pageWords=null;
        if (gutterX != null){
          const left = cropCanvas(canvas, 0, 0, gutterX, canvas.height);
          const right = cropCanvas(canvas, gutterX, 0, canvas.width-gutterX, canvas.height);
          const leftRes = await worker.recognize(left, {}, OCR_OUT);
          const rightRes = await worker.recognize(right, {}, OCR_OUT);
          pageText = leftRes.data.text + "\n\n" + rightRes.data.text;
          const lw=wordsFromResult(leftRes,0), rw=wordsFromResult(rightRes,gutterX);
          if (lw && rw) pageWords = lw.concat(rw);
        } else {
          const res = await worker.recognize(canvas, {}, OCR_OUT);
          pageText = res.data.text;
          pageWords = wordsFromResult(res, 0);
        }

        if (pageWords && pageWords.length){
          // Match OCR'd words back to text-derived paragraphs by position in
          // reading order: cut a new block every time as many words have
          // been consumed as that paragraph contains. Assumes Tesseract's
          // data.words is in the same order/count as data.text tokenizes to
          // -- true in the normal case; a mismatch (e.g. an unusual
          // hyphenation) only misaligns the highlight box for that one
          // paragraph, not the read-aloud text itself, and never carries
          // past a page boundary since this resets every page.
          let wi=0;
          pageText.split(/\n{2,}/).forEach(par=>{
            const t=par.replace(/\s+/g," ").trim(); if(!t) return;
            const n=t.split(/\s+/).filter(Boolean).length;
            let slice=pageWords.slice(wi, wi+n); wi+=n;
            slice=mergeStandaloneDevanagariMarks(slice);
            const mergedText=slice.map(w=>w.str).join(" ") || t;
            blocks.push({text:mergedText, words:slice, page:p, role:"body"});
          });
        } else {
          pageText.split(/\n{2,}/).forEach(par=>{ const t=par.replace(/\s+/g," ").trim(); if(t) blocks.push({text:t, page:p, role:"body"}); });
        }
        lastPage=p;
      }
      return { blocks, pages: lastPage };
    } finally {
      if (origFetch) self.fetch = origFetch;
      if (worker) { try{ await worker.terminate(); }catch(e){} }
      try{ if(pdfSrcRef && pdfSrcRef.destroy) pdfSrcRef.destroy(); }catch(e){}
    }
  }
};

/* ---------- reader model ---------- */
class TextWord{
  constructor(text, skip, bi){ this.text=text; this.skip=skip; this.b=bi; this._s=null; }
  get span(){ const B=Reader.blocks[this.b]; if(B && !B.done) Reader._mat(B); return this._s; }
}
const Reader = {
  words:[], sentStart:[], sentEnd:[], starts:[], pageStartWord:{}, totalPages:0, bodyWordCount:0,
  mode:"text", pdfProxy:null, pageWrappers:{}, pageDisplayScale:{}, pagePtWidth:{}, pagePtHeight:{}, _io:null,

  // Text view. Every word needs to be addressable, but a real <span> per word (150k+ DOM
  // nodes for a normal novel) made opening a book take many seconds and every tap laggy.
  // So paragraphs start as ONE text node; a paragraph's per-word <span>s are created the
  // first time anything asks a word for its .span (the getter below) or when it scrolls
  // near the screen. Span metrics are identical to plain text, so layout never shifts.
  _mat(B){
    if (B.done) return; B.done=true;
    const p=B.p, words=this.words; p.textContent="";
    const frag=document.createDocumentFragment();
    for (let k=0;k<B.n;k++){
      if (k>0) frag.appendChild(document.createTextNode(" "));
      const w=words[B.first+k]; const span=el("span","w"); span.textContent=w.text; span.dataset.i=B.first+k; w._s=span; frag.appendChild(span);
    }
    p.appendChild(frag);
    if (this._mio) this._mio.unobserve(p);
  },
  // horizontal position of a word measured from the left edge of #content, WITHOUT creating its
  // <span> (creating spans dirties layout, and in paged mode that re-flows every column of the book)
  wordLeft(i){
    const w=this.words[i]; if(!w) return 0;
    const c=$("#content").getBoundingClientRect().left;
    if(w._s) return w._s.getBoundingClientRect().left-c;
    const B=this.blocks[w.b]; if(!B) return 0;
    if(B.done){ const s=w._s; return s ? s.getBoundingClientRect().left-c : 0; }
    if(!B.offs){ const o=new Int32Array(B.n); let acc=0; for(let k=0;k<B.n;k++){ o[k]=acc; acc+=this.words[B.first+k].text.length+1; } B.offs=o; }
    const tn=B.p.firstChild; if(!tn) return 0;
    const k=i-B.first, off=B.offs[k], len=w.text.length;
    const r=document.createRange(); try{ r.setStart(tn,off); r.setEnd(tn,Math.min(off+len, tn.length)); }catch(e){ return 0; }
    const rc=r.getClientRects()[0]||r.getBoundingClientRect();
    return rc.left-c;
  },
  // make sure the paragraph under a screen point has its word spans (needed for press-to-select)
  matAtPoint(x,y){
    const h=document.elementFromPoint(x,y); const p=h&&h.closest&&h.closest("#content p"); if(p&&p._B&&!p._B.done) this._mat(p._B);
  },
  imgLoader:null,
  // EPUB pictures live inside the zip: unpack each one only when it comes near the screen
  setImageSource(doc){
    if (this._imgUrls){ this._imgUrls.forEach(u=>{ try{ URL.revokeObjectURL(u); }catch(e){} }); }
    this._imgUrls=[]; this.imgLoader=null;
    if (extOf(doc.name)!=="epub") return;
    let zp=null; const cache=new Map();
    const types={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",svg:"image/svg+xml",bmp:"image/bmp"};
    this.imgLoader=(path)=>{
      if (cache.has(path)) return cache.get(path);
      const pr=(async()=>{
        await ensureZip(); if(!zp) zp=JSZip.loadAsync(doc.blob); const zip=await zp;
        const f=zip.file(path)||zip.file(path.replace(/^\//,"")); if(!f) throw new Error("missing image");
        const buf=await f.async("uint8array");
        const url=URL.createObjectURL(new Blob([buf],{type:types[path.split(".").pop().toLowerCase()]||"image/jpeg"}));
        this._imgUrls.push(url); return url;
      })();
      cache.set(path,pr); return pr;
    };
  },
  render(blocks, opts){
    this.mode="text";
    this._teardownPdf();
    opts = opts || {};
    if (this._mio){ this._mio.disconnect(); this._mio=null; }
    const content=$("#content"); content.innerHTML="";
    this.words=[]; this.sentStart=[]; this.sentEnd=[]; this.starts=[]; this.blocks=[]; this.blockWord=[];
    this.pageStartWord={}; this.totalPages=0; this.bodyWordCount=0;
    if (this._iio){ this._iio.disconnect(); this._iio=null; }
    this._iio = new IntersectionObserver((entries)=>{
      for (const e of entries){ if (e.isIntersecting){ this._iio.unobserve(e.target); this.loadFigure(e.target); } }
    }, { root:$("#reader"), rootMargin:"300% 300% 300% 300%" });
    this._mio = new IntersectionObserver((entries)=>{
      if (typeof Pager!=="undefined" && Pager.on) return;   // paged mode creates spans on demand only (layout is expensive there)
      for (const e of entries){ if (e.isIntersecting){ const B=e.target._B; if (B) this._mat(B); } }
    }, { root:$("#reader"), rootMargin:"250% 250% 250% 250%" });
    const frag=document.createDocumentFragment(); this._figs=[];
    let lastPage=null;
    blocks.forEach((raw,bi)=>{
      this.blockWord[bi]=this.words.length;
      const b = (typeof raw==="string") ? {text:raw, role:"body"} : raw;
      const role=b.role||"body";
      if (b.img){   // picture: shown in place, no words, loaded lazily
        const fig=el("figure","k-img"); const im=el("img"); im.alt=b.alt||""; im.decoding="async"; fig.appendChild(im); fig._src=b.img;
        frag.appendChild(fig); this._figs.push(fig); return;
      }
      const hasWords = Array.isArray(b.words) && b.words.length>0;
      if (!hasWords && !(b.text||"").trim()) return;
      if (b.page!=null){
        if (b.page!==lastPage){ if(this.pageStartWord[b.page]==null) this.pageStartWord[b.page]=this.words.length; lastPage=b.page; }
        if (b.page>this.totalPages) this.totalPages=b.page;
      }
      const p=el("p"); if(role!=="body") p.className="aux"; if(b.kind) p.classList.add("k-"+b.kind);
      const toks = hasWords ? b.words.map(w=>w.str) : b.text.split(/\s+/).filter(Boolean);
      if (!toks.length) return;
      const bk=this.blocks.length, B={p, first:this.words.length, n:toks.length, done:false, kind:b.kind||""};
      this.blocks.push(B); p._B=B;
      const skip = role!=="body";
      for (let k=0;k<toks.length;k++) this.words.push(new TextWord(toks[k], skip, bk));
      if (!skip) this.bodyWordCount+=toks.length;
      p.textContent=toks.join(" ");
      this.words[this.words.length-1].blockEnd=true;
      frag.appendChild(p);
    });
    if (opts.totalPages && opts.totalPages>this.totalPages) this.totalPages=opts.totalPages;
    content.appendChild(frag); this.buildSentences();
    content.querySelectorAll("p").forEach(p=>this._mio.observe(p));
    this._figs.forEach(f=>this._iio.observe(f));
  },
  loadFigure(fig){
    if (fig._loaded) return; fig._loaded=true;
    const im=fig.firstChild, src=fig._src;
    const done=()=>fig.classList.add("loaded");
    im.onload=done; im.onerror=()=>{ fig.classList.add("broken"); };
    if (/^data:/i.test(src)){ im.src=src; return; }
    if (!this.imgLoader){ fig.classList.add("broken"); return; }
    this.imgLoader(src).then(u=>{ im.src=u; }).catch(()=>fig.classList.add("broken"));
  },

  // Renders the PDF as real page images (like any other PDF viewer) with a
  // highlight box overlaid at the current word's position, instead of
  // reflowing extracted text into styled paragraphs. Text is still extracted
  // in the background (already done by the time this is called) purely to
  // drive speech and highlighting.
  async renderPdf(blocks, doc, opts){
    opts = opts || {};
    this.mode="pdf";
    this._teardownPdf();
    const content=$("#content"); content.innerHTML="";
    this.words=[]; this.sentStart=[]; this.sentEnd=[]; this.starts=[];
    this.pageStartWord={}; this.totalPages=0; this.bodyWordCount=0;
    this.pageWrappers={}; this.pageDisplayScale={}; this.pagePtWidth={}; this.pagePtHeight={};

    let lastPage=null;
    blocks.forEach(raw=>{
      const b = (typeof raw==="string") ? {text:raw, role:"body"} : raw;
      const text=b.text||""; if(!text) return;
      const role=b.role||"body";
      if (b.page!=null){
        if (b.page!==lastPage){ if(this.pageStartWord[b.page]==null) this.pageStartWord[b.page]=this.words.length; lastPage=b.page; }
        if (b.page>this.totalPages) this.totalPages=b.page;
      }
      if (Array.isArray(b.words) && b.words.length){
        b.words.forEach(w=>{
          this.words.push({text:w.str, page:b.page, x:w.x, y:w.y, w:w.w, h:w.h, skip: role!=="body"});
          if (role==="body") this.bodyWordCount++;
        });
      } else {
        // No position data for this block (e.g. an OCR page where
        // word-level output wasn't available) -- still read normally, just
        // without a highlight box for these specific words.
        text.split(/\s+/).filter(Boolean).forEach(tok=>{
          this.words.push({text:tok, page:b.page, x:null, y:null, w:null, h:null, skip: role!=="body"});
          if (role==="body") this.bodyWordCount++;
        });
      }
      if (this.words.length) this.words[this.words.length-1].blockEnd=true;
    });
    if (opts.totalPages && opts.totalPages>this.totalPages) this.totalPages=opts.totalPages;
    this.buildSentences();

    this.pdfProxy = await openPageSource(doc);
    const n = Math.max(this.totalPages, this.pdfProxy.numPages||0);
    const frag=document.createDocumentFragment();
    let firstDims=null; // image books: don't decode every page up front; assume page 1's shape until each page renders
    for (let p=1;p<=n;p++){
      let vp1;
      if (this.pdfProxy.lazyDims && firstDims) vp1=firstDims;
      else {
        try{ vp1=(await this.pdfProxy.getPage(p)).getViewport({scale:1}); }
        catch(e){ vp1={width:612,height:792}; }
        if (this.pdfProxy.lazyDims) firstDims=vp1;
      }
      this.pagePtWidth[p]=vp1.width; this.pagePtHeight[p]=vp1.height;
      const wrapper=el("div","pdfpage"); wrapper.dataset.page=String(p); wrapper.dataset.rendered="0";
      wrapper.style.paddingTop=(vp1.height/vp1.width*100)+"%";
      wrapper.appendChild(el("canvas"));
      wrapper.appendChild(el("div","pdfhl"));
      const label=el("div","pdfpagenum"); label.textContent="Page "+p; wrapper.appendChild(label);
      wrapper.addEventListener("click",(e)=>{
        const canvas=wrapper.querySelector("canvas"); const rect=canvas.getBoundingClientRect();
        const scale=this.pageDisplayScale[p] || (rect.width/(this.pagePtWidth[p]||612));
        const px=(e.clientX-rect.left)/scale, py=(e.clientY-rect.top)/scale;
        const idx=this.wordIndexNearPoint(p, px, py);
        if (idx!=null) handleWordTap(idx);
      });
      this.pageWrappers[p]=wrapper;
      frag.appendChild(wrapper);
    }
    content.appendChild(frag);

    this._io = new IntersectionObserver((entries)=>{
      entries.forEach(entry=>{
        const wrapper=entry.target; const p=Number(wrapper.dataset.page);
        if (entry.isIntersecting){ if (wrapper.dataset.rendered!=="1") renderPageCanvas(wrapper,p); }
        else if (wrapper.dataset.rendered==="1"){ clearPageCanvas(wrapper); }
      });
    }, { root: $("#reader"), rootMargin: "120% 100% 120% 100%" });
    Object.values(this.pageWrappers).forEach(w=>this._io.observe(w));
  },

  _teardownPdf(){
    if (this._io){ this._io.disconnect(); this._io=null; }
    if (this.pdfProxy){ try{ this.pdfProxy.destroy(); }catch(e){} this.pdfProxy=null; }
    this.pageWrappers={};
    if (typeof Ink!=="undefined") Ink._drawing=null; // old canvases are gone with the DOM rebuild
  },

  wordIndexNearPoint(page, px, py){
    let best=null, bestDist=Infinity;
    for (let i=0;i<this.words.length;i++){
      const w=this.words[i]; if (w.page!==page || w.x==null) continue;
      const dx=(w.x+w.w/2)-px, dy=(w.y+w.h/2)-py;
      const dist=dx*dx+dy*dy;
      if (dist<bestDist){ bestDist=dist; best=i; }
    }
    return best;
  },

  buildSentences(){
    const n=this.words.length; this.sentStart=new Array(n); this.sentEnd=new Array(n);
    let start=0; const closers=/[.!?…]["'”’)\]]*$/;
    for(let i=0;i<n;i++){ const w=this.words[i];
      if(closers.test(w.text)||w.blockEnd||(i-start>=40)||i===n-1){
        for(let j=start;j<=i;j++){ this.sentStart[j]=start; this.sentEnd[j]=i; }
        this.starts.push(start); start=i+1;
      }
    }
  },
  textFrom(a,b){ let s=""; for(let i=a;i<=b;i++){ s+=(i>a?" ":"")+this.words[i].text; } return s; },
  wordIndexForPage(n){
    if(!this.totalPages) return null;
    n=Math.max(1, Math.min(n, this.totalPages));
    if(this.pageStartWord[n]!=null) return this.pageStartWord[n];
    for(let p=n;p<=this.totalPages;p++){ if(this.pageStartWord[p]!=null) return this.pageStartWord[p]; }
    for(let p=n;p>=1;p--){ if(this.pageStartWord[p]!=null) return this.pageStartWord[p]; }
    return null;
  }
};

async function renderPageCanvas(wrapper, pageNum){
  if (wrapper.dataset.rendered==="1" || wrapper.dataset.rendering==="1" || !Reader.pdfProxy) return;
  wrapper.dataset.rendering="1";
  try{
    const page = await Reader.pdfProxy.getPage(pageNum);
    const vp1 = page.getViewport({scale:1});
    Reader.pagePtWidth[pageNum]=vp1.width; Reader.pagePtHeight[pageNum]=vp1.height;
    if (Pager.on) Pager.fitWrapper(wrapper, pageNum);
    const cssWidth = wrapper.clientWidth || 800;
    const displayScale = cssWidth / vp1.width;
    Reader.pagePtWidth[pageNum]=vp1.width; Reader.pagePtHeight[pageNum]=vp1.height;
    if(!Pager.on) wrapper.style.paddingTop=(vp1.height/vp1.width*100)+"%"; else wrapper.dataset.pt=(vp1.height/vp1.width*100)+"%";
    const boost = (Pager.on && Pager.z>1) ? Pager.z : 1;
    const dpr = Math.max(1, Math.min(Math.min(2, window.devicePixelRatio||1)*boost, 3200/cssWidth)); // capped to bound memory
    const vp = page.getViewport({scale: displayScale*dpr});
    const canvas = wrapper.querySelector("canvas");
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    await page.render({canvasContext:canvas.getContext("2d"), viewport:vp}).promise;
    Reader.pageDisplayScale[pageNum] = displayScale;
    wrapper.dataset.rendered="1";
    if (typeof Annot!=="undefined") Annot.items.filter(a=>a.page===pageNum).forEach(a=>Annot.renderOne(a));
    if (typeof Ink!=="undefined") Ink.redrawPage(wrapper, pageNum);
  } catch(e){ console.error("PDF page render failed", pageNum, e); }
  finally { wrapper.dataset.rendering="0"; }
}
function clearPageCanvas(wrapper){
  // Un-render pages that scroll far out of view: a book-length PDF rendered
  // fully at once would hold hundreds of full-resolution canvases in memory
  // simultaneously and crash the WebView. The wrapper's height is already
  // reserved via padding-top (set from the page's aspect ratio before any
  // rendering happens), so clearing the canvas doesn't shift scroll position.
  const canvas = wrapper.querySelector("canvas");
  if (canvas){ canvas.width=0; canvas.height=0; }
  wrapper.querySelectorAll(".pdfannot:not(.sel-preview-pdf)").forEach(n=>n.remove());
  wrapper.dataset.rendered="0";
}

/* ---------- speech ---------- */
const Speech = {
  synth:window.speechSynthesis, playing:false, cursor:0, utter:null, voices:[],
  loadVoices(){
    this.voices=this.synth?this.synth.getVoices():[];
    const sel=$("#voiceSel");
    if(!this.voices.length){ sel.innerHTML="<option>Default</option>"; return; }
    const cur=sel.value; sel.innerHTML="";
    this.voices.forEach((v,i)=>{ const o=el("option"); o.value=i; o.textContent=`${v.name} (${v.lang})${v.default?" ★":""}`; sel.appendChild(o); });
    if(!cur){ const def=this.voices.findIndex(v=>v.default); const en=this.voices.findIndex(v=>/^en/i.test(v.lang)); sel.value=def>=0?def:(en>=0?en:0); } else sel.value=cur;
  },
  currentVoice(){ const i=parseInt($("#voiceSel").value,10); return Number.isFinite(i)?this.voices[i]:null; },
  speakFrom(wordIdx, force){
    if(!this.synth){ dlgAlert("No speech engine","This device has no text-to-speech engine available."); return; }
    this.synth.cancel();
    if(!force){
      // Silently skip past whole header/footer/footnote blocks rather than
      // reading them -- but only for automatic continuation/navigation.
      // A direct tap on that text (force=true) is still honored below.
      while(wordIdx<Reader.words.length && Reader.words[wordIdx].skip){
        wordIdx = Reader.sentEnd[wordIdx]+1;
      }
    }
    if(wordIdx>=Reader.words.length){ this.stop(true); return; }
    const endWord=Reader.sentEnd[wordIdx]; const text=Reader.textFrom(wordIdx,endWord);
    const offs=[]; let acc=0;
    for(let i=wordIdx;i<=endWord;i++){ offs.push({at:acc,word:i}); acc+=Reader.words[i].text.length+1; }
    this.cursor=wordIdx;
    const u=new SpeechSynthesisUtterance(text);
    const v=this.currentVoice(); if(v){ u.voice=v; u.lang=v.lang; }
    u.rate=parseFloat($("#rate").value); u.pitch=parseFloat($("#pitch").value);
    u.onboundary=(e)=>{ if(e.name && e.name!=="word") return;
      let lo=0,hi=offs.length-1,pick=0;
      while(lo<=hi){ const mid=(lo+hi)>>1; if(offs[mid].at<=e.charIndex){ pick=mid; lo=mid+1; } else hi=mid-1; }
      highlight(offs[pick].word); this.cursor=offs[pick].word; saveProgress();
    };
    u.onend=()=>{ if(!this.playing) return; markReadUpTo(endWord); this.cursor=endWord+1; this.speakFrom(endWord+1); };
    u.onerror=(ev)=>{ if(ev.error!=="interrupted"&&ev.error!=="canceled") setStatus("Speech error: "+ev.error); };
    this.utter=u; this.synth.speak(u);
  },
  play(force){ if(!Reader.words.length || !ReadAloud.enabled) return;
    const resuming = this.synth.paused&&this.synth.speaking;
    this.playing=true; UI.setPlaying(true); Reading.keepAwake(); showDock(true);
    if(resuming){ Follow.setOn(true); this.synth.resume(); }
    else{
      if(!force){ this.cursor=Reading.audioStartIndex(); }   // start where the reader is looking, not where audio last stopped
      Follow.setOn(true); this.speakFrom(this.cursor||0, force);
    }
    updateDockInfo(); },
  pause(){ this.playing=false; UI.setPlaying(false); Reading.keepAwake(); if(this.synth.speaking) this.synth.pause(); saveProgress(true); updateDockInfo(); Follow.setOn(true); },
  toggle(){ this.playing?this.pause():this.play(); },
  stop(finished){ this.playing=false; UI.setPlaying(false); Reading.keepAwake(); if(this.synth) this.synth.cancel(); if(finished) setStatus("Finished."); saveProgress(true); if(typeof updateDockInfo==="function") updateDockInfo(); Follow.setOn(true); },
  seekTo(wordIdx,resume){ wordIdx=Math.max(0,Math.min(wordIdx,Reader.words.length-1)); const s=Reader.sentStart[wordIdx];
    this.cursor=s; highlight(s); markReadUpTo(s-1); saveProgress(true); if(resume&&this.playing) this.speakFrom(s); },
  next(){ this.jump(Reader.sentEnd[this.cursor]+1); },
  prev(){ const cs=Reader.sentStart[this.cursor]; this.jump(cs>0?Reader.sentStart[cs-1]:0); },
  jump(wordIdx){ if(wordIdx>=Reader.words.length){ this.stop(true); return; } wordIdx=Math.max(0,wordIdx); this.cursor=wordIdx;
    highlight(wordIdx); markReadUpTo(wordIdx-1); saveProgress(true); if(this.playing) this.speakFrom(wordIdx); }
};

let lastHi=-1;
// Margins scale with the reader's actual current height so this behaves
// sensibly in both the normal layout (header/footer visible, #reader is
// shorter) and fullscreen (header/footer hidden, #reader nearly fills the
// screen) -- fixed pixel margins tuned for one don't translate to the other.
//
// Auto-scroll is coalesced through one rAF slot and only fires when the
// target actually needs to move into view. Calling el.scrollIntoView every
// single word (every ~200-500ms while reading, faster at higher speeds)
// used to start a brand-new smooth-scroll animation on top of whatever the
// previous word's scroll was still doing, which reads as a jittery, stepped
// scroll rather than one continuous glide. Coalescing to the latest target
// and skipping the call entirely when already comfortably in view fixes that.
let _scrollRAF=0, _scrollTarget=null;
function smoothScrollIntoViewIfNeeded(target){
  if(!Follow.shouldScroll()) return;
  if(Pager.on){ Pager.followTarget(target); return; }   // reading position is the user's; audio only drives the view while "follow" is on
  _scrollTarget=target;
  if(_scrollRAF) return;
  _scrollRAF=requestAnimationFrame(()=>{
    _scrollRAF=0;
    const t=_scrollTarget; _scrollTarget=null;
    if(!t || !t.isConnected) return;
    const container=t.closest("#reader")||$("#reader");
    const cr=container.getBoundingClientRect(), tr=t.getBoundingClientRect();
    const margin=Math.max(40, cr.height*0.18);
    if(tr.top<cr.top+margin || tr.bottom>cr.bottom-margin){
      t.scrollIntoView({block:"center",behavior:"smooth"});
    }
  });
}
function highlight(i){
  if(i===lastHi) return;
  if (Reader.mode==="pdf"){ highlightPdf(i); lastHi=i; return; }
  if(lastHi>=0 && Reader.words[lastHi] && Reader.words[lastHi].span) Reader.words[lastHi].span.classList.remove("speaking");
  const w=Reader.words[i];
  if(w && w.span){ w.span.classList.add("speaking"); w.span.classList.remove("read");
    smoothScrollIntoViewIfNeeded(w.span);
  }
  lastHi=i;
}
let _readMark=-1;
function markReadUpTo(i){
  if (Reader.mode==="pdf") return; // no trailing "already read" shading over a real page image
  if (!RS.dimRead){ _readMark=-1; return; }
  const W=Reader.words; if(!W.length) return;
  i=Math.min(i, W.length-1);
  // only touch words whose paragraph is already on the page; incremental from the previous mark
  const lo=Math.min(_readMark, i)+1, hi=Math.max(_readMark, i);
  for(let k=Math.max(0,lo-1);k<=hi&&k<W.length;k++){ const s=W[k]._s; if(!s) continue; if(k<=i){ s.classList.remove("speaking"); s.classList.add("read"); } else s.classList.remove("read"); }
  _readMark=i;
}
let _lastHlBox=null; // {page,left,top} of the previously shown .pdfhl box, for the snap-vs-glide decision below
function highlightPdf(i, noScroll){
  const w=Reader.words[i]; if(!w || w.page==null || w.x==null) return;
  Object.keys(Reader.pageWrappers).forEach(p=>{
    if (Number(p)!==w.page){ const hl=Reader.pageWrappers[p].querySelector(".pdfhl"); if(hl) hl.style.display="none"; }
  });
  const wrapper=Reader.pageWrappers[w.page]; if(!wrapper) return;
  const positionAndShow=()=>{
    const scale=Reader.pageDisplayScale[w.page] || (wrapper.clientWidth/(Reader.pagePtWidth[w.page]||612));
    const hl=wrapper.querySelector(".pdfhl");
    const left=w.x*scale, top=w.y*scale;
    const width=Math.max(w.w,4)*scale, height=Math.max(w.h,4)*scale;
    // A CSS-transitioned move reads as a natural, legible glide between two
    // nearby words (same line, or wrapping to the next) but as a distracting
    // box flying across the page for a big jump (a seek, skip-sentence, or
    // a tap far away) -- so those snap straight to the new spot instead of
    // animating through everything in between.
    const prev=_lastHlBox;
    const bigJump = !prev || prev.page!==w.page || Math.hypot(left-prev.left, top-prev.top) > height*4;
    // Toggled before the position changes: "noglide" turns the CSS transition
    // off so a big jump snaps instantly, and stays off until a later small
    // move re-enables it -- so a run of big jumps (fast seeking) never
    // animates either.
    hl.classList.toggle("noglide", bigJump);
    hl.style.left=left+"px"; hl.style.top=top+"px";
    hl.style.width=width+"px"; hl.style.height=height+"px";
    hl.style.display="block";
    _lastHlBox={page:w.page,left,top};
    if(!noScroll) smoothScrollIntoViewIfNeeded(hl);
  };
  if (wrapper.dataset.rendered==="1") positionAndShow();
  else renderPageCanvas(wrapper, w.page).then(positionAndShow);
}

let _saveT=0;
function saveProgress(force){
  if(UI.activeId==null || !Reader.words.length) return;
  const now=Date.now(); if(!force && now-_saveT<2500) return; _saveT=now;
  DB.setMeta(UI.activeId,{ progress:Reading.pos, audioPos:Speech.cursor, wordCount:Reader.words.length, lastOpened:now });
}

const UI = {
  activeId:null,
  setPlaying(on){ $("#playIcon").innerHTML=on?'<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>':'<path d="M8 5v14l11-7z"/>'; $("#playBtn").title=on?"Pause":"Play"; },
  enableControls(on){
    const ttsOn = on && (typeof ReadAloud==="undefined" || ReadAloud.enabled);
    ["#playBtn","#prevBtn","#nextBtn","#voiceSel","#rate","#pitch"].forEach(s=>{ const e=$(s); if(e) e.disabled=!ttsOn; });
    $("#seek").disabled=!on; // scrubbing/position-marking still works without read-aloud
    if(typeof updateDockInfo==="function") updateDockInfo();
  },
  updateSeek(){ /* the reading position drives the progress UI now: see Reading.update */ },
  refreshLibrary(){ return Shelf.render(); }
};

/* ---------- shelf: library home screen with folders ---------- */
const Shelf = {
  cwd:null, visible:false, overReader:false, sort:"recent",
  selectMode:false, selected:new Set(),
  async _load(){
    const [docs,metas]=await Promise.all([DB.allDocs(),DB.allMeta()]);
    const metaById={}; metas.forEach(m=>metaById[m.id]=m);
    const folders=metas.filter(m=>m.kind==="folder");
    const fids=new Set(folders.map(f=>f.id));
    const folderOf=(d)=>{ const f=metaById[d.id]&&metaById[d.id].folderId; return (f&&fids.has(f))?f:null; };
    return {docs,metaById,folders,fids,folderOf};
  },
  chain(folders, id){ const out=[]; let cur=id; const seen=new Set();
    while(cur && !seen.has(cur)){ seen.add(cur); const f=folders.find(x=>x.id===cur); if(!f) break; out.unshift(f); cur=f.parent||null; }
    return out; },
  show(overReader){ this.visible=true; this.overReader=!!overReader&&UI.activeId!=null; $("#shelf").hidden=false; if(typeof Reading!=="undefined") Reading.syncChrome(); return this.render(); },
  hide(){ if(this.selectMode) this.exitSelectMode(true); this.visible=false; $("#shelf").hidden=true; if(typeof Reading!=="undefined") Reading.syncChrome(); },
  async up(){
    const {folders}=await this._load(); const f=folders.find(x=>x.id===this.cwd);
    this.cwd=(f&&f.parent)||null; return this.render();
  },
  async render(){
    if(!this.visible) return;
    const {docs,metaById,folders,fids,folderOf}=await this._load();
    if(this.cwd && !fids.has(this.cwd)) this.cwd=null;
    // breadcrumbs
    const crumbs=$("#crumbs"); crumbs.innerHTML="";
    const mk=(label,id,last)=>{ const b=el("button"); b.textContent=label; b.onclick=()=>{ this.cwd=id; this.render(); }; crumbs.appendChild(b);
      if(!last){ const sp=el("span","sep"); sp.textContent="›"; crumbs.appendChild(sp); } };
    const chain=this.chain(folders,this.cwd);
    mk("Library",null,chain.length===0);
    chain.forEach((f,i)=>mk(f.name,f.id,i===chain.length-1));
    // data for this level
    const here=docs.filter(d=>folderOf(d)===this.cwd);
    const subs=folders.filter(f=>((f.parent&&fids.has(f.parent))?f.parent:null)===this.cwd).sort((a,b)=>naturalCmp(a.name||"",b.name||""));
    const pctOf=(d)=>{ const m=metaById[d.id]; return (m&&m.progress>0&&m.wordCount>1)?Math.min(100,Math.round(m.progress/(m.wordCount-1)*100)):0; };
    const last=(d)=>(metaById[d.id]&&metaById[d.id].lastOpened)||d.addedAt||0;
    if(this.sort==="name") here.sort((a,b)=>naturalCmp(a.name,b.name));
    else if(this.sort==="progress") here.sort((a,b)=>pctOf(b)-pctOf(a)||last(b)-last(a));
    else here.sort((a,b)=>last(b)-last(a));
    const list=$("#libList"); list.innerHTML="";
    if(!subs.length && !here.length){
      list.innerHTML = this.cwd ? '<div class="empty">This folder is empty.<br>Tap “Add files” to import books here.</div>'
        : '<div class="empty">Your library is empty.<br>Tap “Add files” to import PDF, EPUB, MOBI, DOCX, FB2, TXT, Markdown, HTML or comic (CBZ/CBR) files.</div>';
      return;
    }
    subs.forEach(f=>{
      const li=el("li"); const ic=el("div","ficon folder"); ic.textContent="📁";
      const meta=el("div","meta"); const nm=el("div","name"); nm.textContent=f.name;
      const sub=el("div","sub"); const n=docs.filter(d=>folderOf(d)===f.id).length+folders.filter(x=>x.parent===f.id).length;
      sub.textContent=n+(n===1?" item":" items"); meta.append(nm,sub);
      const more=el("button","more"); more.textContent="⋯"; more.title="Folder options";
      more.onclick=(e)=>{ e.stopPropagation(); this.folderMenu(f); };
      if(this.selectMode){
        const chk=el("div","checkmark"+(this.selected.has(f.id)?" checked":""));
        li.classList.add("selectableItem"); if(this.selected.has(f.id)) li.classList.add("selected");
        li.append(chk,ic,meta); li.onclick=()=>{ this.toggleSelect(f.id); this.render(); };
      } else { li.append(ic,meta,more); li.onclick=()=>{ this.cwd=f.id; this.render(); }; }
      list.appendChild(li);
    });
    here.forEach(d=>{
      const li=el("li"); if(d.id===UI.activeId) li.classList.add("active"); li.dataset.id=d.id;
      const ext=extOf(d.name); const ic=el("div","ficon "+ext); ic.textContent=ext.toUpperCase().slice(0,5);
      const meta=el("div","meta"); const nm=el("div","name"); nm.textContent=d.name;
      const sub=el("div","sub"); const size=el("span"); size.textContent=fmtSize(d.size); sub.appendChild(size);
      const pc=pctOf(d); if(pc>0){ const pill=el("span","pill progress"); pill.textContent=pc+"%"; sub.appendChild(pill); }
      if(d.ocrText){ const pill=el("span","pill"); pill.textContent="OCR"; sub.appendChild(pill); }
      meta.append(nm,sub);
      if(this.selectMode){
        const chk=el("div","checkmark"+(this.selected.has(d.id)?" checked":""));
        li.classList.add("selectableItem");
        if(this.selected.has(d.id)) li.classList.add("selected");
        li.append(chk,ic,meta);
        li.onclick=()=>{ this.toggleSelect(d.id); this.render(); };
      } else {
        const more=el("button","more"); more.textContent="⋯"; more.title="Book options";
        more.onclick=(e)=>{ e.stopPropagation(); this.bookMenu(d); };
        li.append(ic,meta,more); li.onclick=()=>openDoc(d.id);
      }
      list.appendChild(li);
    });
  },
  toggleSelect(id){
    if(this.selected.has(id)) this.selected.delete(id); else this.selected.add(id);
    this.updateSelectBar();
  },
  updateSelectBar(){
    const n=this.selected.size; $("#selectCount").textContent=n+" selected";
    $("#selectMoveBtn").disabled=!n; $("#selectDelBtn").disabled=!n;
  },
  async selectAll(){
    const {docs,folders,fids,folderOf}=await this._load();
    const ids=[...docs.filter(d=>folderOf(d)===this.cwd).map(d=>d.id),...folders.filter(f=>((f.parent&&fids.has(f.parent))?f.parent:null)===this.cwd).map(f=>f.id)];
    if(ids.every(i=>this.selected.has(i))) this.selected.clear(); else ids.forEach(i=>this.selected.add(i));
    this.updateSelectBar(); this.render();
  },
  enterSelectMode(){
    this.selectMode=true; this.selected.clear();
    $("#selectBar").hidden=false; $("#selectModeBtn").classList.add("active");
    this.updateSelectBar(); this.render();
  },
  exitSelectMode(quiet){
    this.selectMode=false; this.selected.clear();
    $("#selectBar").hidden=true; $("#selectModeBtn").classList.remove("active");
    if(!quiet) this.render();
  },
  _subtree(folders,id){ const out=new Set([id]); let grew=true; while(grew){ grew=false; folders.forEach(f=>{ if(f.parent && out.has(f.parent) && !out.has(f.id)){ out.add(f.id); grew=true; } }); } return out; },
  async _purgeBook(id){
    if(UI.activeId===id) closeCurrentDoc();
    await Promise.all([DB.delDoc(id),DB.delParsed(id).catch(()=>{}),DB.delMeta(id),DB.delAnnotationsForDoc(id),DB.delInkForDoc(id)]);
    if(comicCache.id===id){ comicCache.id=null; comicCache.entries=null; }
    this.selected.delete(id);
  },
  async deleteSelected(){
    if(!this.selected.size) return;
    const {docs,folders}=await this._load();
    const fSel=folders.filter(f=>this.selected.has(f.id)), bSel=docs.filter(d=>this.selected.has(d.id));
    const allF=new Set(); fSel.forEach(f=>this._subtree(folders,f.id).forEach(i=>allF.add(i)));
    const metas=await DB.allMeta(); const inside=new Set(docs.filter(d=>{ const m=metas.find(x=>x.id===d.id); return m&&m.folderId&&allF.has(m.folderId); }).map(d=>d.id));
    bSel.forEach(d=>inside.add(d.id));
    const msg=(inside.size)+" book(s)"+(allF.size?" and "+allF.size+" folder(s)":"")+" will be permanently removed, along with their highlights and notes. This can’t be undone.";
    if(!await dlgConfirm("Delete "+this.selected.size+" selected item(s)?",msg,"Delete")) return;
    for(const id of inside) await this._purgeBook(id);
    for(const id of allF) await DB.delMeta(id);
    this.exitSelectMode();
    toast("Deleted");
  },
  async moveSelected(){
    if(!this.selected.size) return;
    const {folders}=await this._load();
    const label=(f)=>this.chain(folders,f.id).map(x=>x.name).join(" / ");
    const banned=new Set(); folders.filter(f=>this.selected.has(f.id)).forEach(f=>this._subtree(folders,f.id).forEach(i=>banned.add(i)));   // a folder can't go inside itself
    const opts=[{label:"📚 Library (top level)",value:"__root"}];
    folders.filter(f=>!banned.has(f.id)).sort((a,b)=>naturalCmp(label(a),label(b))).forEach(f=>opts.push({label:"📁 "+label(f),value:f.id}));
    opts.push({label:"＋ New folder…",value:"__new"});
    let c=await dlgChoose("Move "+this.selected.size+" item(s) to",opts); if(c==null) return;
    if(c==="__new"){ c=await this.newFolder(this.cwd); if(!c) return; }
    const target=c==="__root"?null:c;
    for(const id of this.selected){
      if(folders.some(f=>f.id===id)) await DB.setMeta(id,{parent:target}); else await DB.setMeta(id,{folderId:target});
    }
    this.exitSelectMode();
  },
  async newFolder(parent){
    const name=(await dlgPrompt("New folder","","Folder name")||"").trim(); if(!name) return null;
    const id="folder:"+uid(); await DB.setMeta(id,{kind:"folder",name,parent:parent==null?null:parent,createdAt:Date.now()});
    return id;
  },
  // Non-interactive version of newFolder, used by folder import: walks/creates
  // a chain of nested folders (segs, e.g. ["Sci-Fi","Asimov"]) under parentId,
  // reusing any that already exist by name at each level, and returns the leaf id.
  async ensureFolderPath(parentId, segs){
    let cur=parentId;
    for(const name of segs){
      if(!name) continue;
      const {folders}=await this._load();
      const existing=folders.find(f=>f.name===name && (f.parent||null)===(cur||null));
      if(existing){ cur=existing.id; continue; }
      const id="folder:"+uid();
      await DB.setMeta(id,{kind:"folder",name,parent:cur==null?null:cur,createdAt:Date.now()});
      cur=id;
    }
    return cur;
  },
  async folderMenu(f){
    const c=await dlgChoose(f.name,[{label:"Rename",value:"rename"},{label:"Delete folder (keep its books)",value:"del",danger:true},{label:"Delete folder and everything in it",value:"delall",danger:true}]);
    if(c==="rename"){ const n=(await dlgPrompt("Rename folder",f.name)||"").trim(); if(n){ await DB.setMeta(f.id,{name:n}); } }
    else if(c==="del"){
      if(!await dlgConfirm("Delete folder?","“"+f.name+"” will be removed. Its books and sub-folders move up one level.","Delete")) return;
      const {docs,folders}=await this._load(); const parent=f.parent||null;
      for(const d of docs){ const m=await DB.getMeta(d.id); if(m&&m.folderId===f.id) await DB.setMeta(d.id,{folderId:parent}); }
      for(const x of folders){ if(x.parent===f.id) await DB.setMeta(x.id,{parent}); }
      await DB.delMeta(f.id);
    }
    else if(c==="delall"){
      const {docs,folders}=await this._load(); const sub=this._subtree(folders,f.id); const metas=await DB.allMeta();
      const ids=docs.filter(d=>{ const m=metas.find(x=>x.id===d.id); return m&&m.folderId&&sub.has(m.folderId); }).map(d=>d.id);
      if(!await dlgConfirm("Delete folder and contents?","“"+f.name+"”, its "+ids.length+" book(s) and sub-folders will be permanently removed, along with highlights and notes.","Delete")) return;
      for(const id of ids) await this._purgeBook(id);
      for(const i of sub) await DB.delMeta(i);
    }
    await this.render();
  },
  async bookMenu(d){
    const c=await dlgChoose(d.name,[{label:"Open",value:"open"},{label:"Move to folder…",value:"move"},{label:"Delete from library",value:"del",danger:true}]);
    if(c==="open") openDoc(d.id);
    else if(c==="move") await this.moveBook(d);
    else if(c==="del") await this.deleteBook(d);
  },
  async moveBook(d){
    const {folders,metaById}=await this._load(); const cur=(metaById[d.id]&&metaById[d.id].folderId)||null;
    const label=(f)=>this.chain(folders,f.id).map(x=>x.name).join(" / ");
    const opts=[{label:(cur==null?"✓ ":"")+"📚 Library (top level)",value:"__root"}];
    folders.slice().sort((a,b)=>naturalCmp(label(a),label(b))).forEach(f=>opts.push({label:(cur===f.id?"✓ ":"")+"📁 "+label(f),value:f.id}));
    opts.push({label:"＋ New folder…",value:"__new"});
    let c=await dlgChoose("Move “"+d.name+"” to",opts); if(c==null) return;
    if(c==="__new"){ c=await this.newFolder(this.cwd); if(!c) return; }
    await DB.setMeta(d.id,{folderId:c==="__root"?null:c});
    await this.render();
  },
  async deleteBook(d){
    if(!await dlgConfirm("Remove book?","Remove “"+d.name+"” from your library? Its highlights and notes are deleted too.","Remove")) return;
    await this._purgeBook(d.id); this.updateSelectBar();
    await this.render();
  }
};
$("#newFolderBtn").onclick=async()=>{ if(await Shelf.newFolder(Shelf.cwd)) Shelf.render(); };
$("#sortSel").onchange=(e)=>{ Shelf.sort=e.target.value; Shelf.render(); try{ DB.setMeta(Theme.SETTINGS_ID,{sort:Shelf.sort}); }catch(_){} };
(async()=>{ try{ const m=await DB.getMeta(Theme.SETTINGS_ID); if(m&&m.sort){ Shelf.sort=m.sort; $("#sortSel").value=m.sort; } }catch(e){} })();

const WELCOME_HTML=$("#content").innerHTML;
function closeCurrentDoc(){
  UI.activeId=null; Speech.stop(); currentDoc=null; currentBlocks=null;   // null the id first so stop() doesn't re-save progress for a deleted book
  Reader.render([]); $("#content").innerHTML=WELCOME_HTML;
  $("#welcomeAdd").onclick=()=>$("#fileInput").click();
  $("#docTitle").textContent="No document open"; setStatus("Add a book to begin."); if(typeof Reading!=="undefined"){ Reading.syncChrome(); showDock(false); }
  UI.enableControls(false); hideOcrBar(); updatePageNav(); updateViewModeBtn(false,"text");
  if(!Shelf.visible) Shelf.show(false);
}

// opts.targetFolderId overrides Shelf.cwd as the destination (used by folder
// import, which fans a single picked tree out across several folders).
// opts.silent skips the per-batch dialogs/auto-open/status line -- the caller
// (importFolder) reports a single combined summary once all batches are in.
async function importFiles(fileList, opts){
  opts=opts||{};
  const all=[...fileList];
  const files=all.filter(f=>ALL_EXTS.includes(extOf(f.name)));
  const skipped=all.filter(f=>!ALL_EXTS.includes(extOf(f.name)));
  if(!files.length){
    if(!opts.silent) await dlgAlert("Unsupported file","Supported formats: PDF, EPUB, MOBI/AZW/AZW3, DOCX, FB2, TXT, Markdown, HTML, CBZ/CBR (ZIP/RAR of images).");
    return {added:0, skipped:skipped.length, firstId:null};
  }
  const target = opts.targetFolderId!==undefined ? opts.targetFolderId : Shelf.cwd;
  let firstId=null;
  let n=0;
  for(let f of files){ const id=uid(); n++;
    if(files.length>1 && !opts.quiet) setStatus("Importing "+n+" / "+files.length+"…");
    if(f._entry){ try{ f=await Native.readImportedFile(f._entry); }catch(e){ continue; } }   // folder import: one file in memory at a time
    await DB.putDoc({id,name:f.name,size:f.size,type:f.type,addedAt:Date.now(),blob:f});
    f=null; await new Promise(r=>setTimeout(r,0));
    if(target) await DB.setMeta(id,{folderId:target});
    if(!firstId) firstId=id; }
  if(opts.silent) return {added:files.length, skipped:skipped.length, firstId};
  await UI.refreshLibrary();
  if(skipped.length) await dlgAlert("Some files were skipped","Not a supported format:\n"+skipped.map(f=>"• "+f.name).join("\n"));
  if(files.length===1 && firstId) openDoc(firstId);
  else setStatus("Added "+files.length+" books.");
  return {added:files.length, skipped:skipped.length, firstId};
}

// Imports a batch of files that carry folder structure (webkitRelativePath
// from a real <input webkitdirectory>, or the ._relPath this app attaches to
// files pulled via Native.pickFolder/readImportedFile), recreating that
// structure as nested folders under the currently open folder.
async function importFolder(fileList){
  const all=[...fileList];
  if(!all.length) return;
  const relPath=(f)=>f.webkitRelativePath || f._relPath || f.name;
  const groups=new Map(); // "Sub/Dir" (relative to the picked root) -> files[]
  all.forEach(f=>{
    const parts=relPath(f).split("/").filter(Boolean);
    parts.pop();   // drop the filename itself
    parts.shift(); // drop the picked root folder's own name -- that's Shelf.cwd, not a new subfolder
    const key=parts.join("/");
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(f);
  });
  let added=0, skipped=0;
  for(const [dirKey, files] of groups){
    const segs=dirKey?dirKey.split("/"):[];
    const folderId = segs.length ? await Shelf.ensureFolderPath(Shelf.cwd, segs) : Shelf.cwd;
    const r = await importFiles(files, {targetFolderId:folderId, silent:true});
    added+=r.added; skipped+=r.skipped;
  }
  await UI.refreshLibrary();
  if(!added){ await dlgAlert("No supported files found","That folder didn't contain any files in a supported format."); return; }
  setStatus(`Imported ${added} book(s) from folder`+(skipped?`, skipped ${skipped} unsupported file(s).`:"."));
}

let parseToken=0;
const PARSE_V=2;
async function openDoc(id){
  const token=++parseToken; Speech.stop();
  const doc=await DB.getDoc(id); if(!doc) return;
  UI.activeId=id; Shelf.hide();
  hideOcrBar();
  $("#docTitle").textContent=doc.name;
  $("#content").innerHTML='<div class="welcome"><h1>⏳</h1><p>Preparing this document…</p></div>';
  setStatus("Reading "+doc.name+" …"); UI.enableControls(false);
  try{
    let blocks, fromOcr=false;
    if(doc.ocrText&&doc.ocrText.length){ blocks=doc.ocrText; fromOcr=true; }
    else {
      // parsed text is cached (PDF text extraction is the slow part), so reopening a book is instant
      let cached=null; try{ cached=await DB.getParsed(id); }catch(e){}
      if(cached && cached.v===PARSE_V && Array.isArray(cached.blocks)){ blocks=cached.blocks; doc._ctx=cached.ctx||{}; }
      else {
        const ctx={}; blocks=await parseDoc(doc,(p)=>{ if(token===parseToken) setStatus(`Reading… ${Math.round(p*100)}%`); },ctx); doc._ctx=ctx;
        // structured-cloning a big parse result blocks the UI for a moment: do it later, and skip monster books
        if(blocks.length && !ctx.comic && blocks.length<60000) setTimeout(()=>{ if(UI.activeId===id) DB.putParsed({id, v:PARSE_V, blocks, ctx}).catch(()=>{}); }, 2500);
      }
    }
    if(token!==parseToken) return;
    if(!blocks.length && !(doc._ctx&&doc._ctx.comic)) blocks=["(No readable text was found in this document.)"];
    finishOpen(doc,blocks,fromOcr);
  }catch(err){ if(token!==parseToken) return; console.error(err);
    $("#content").innerHTML='<div class="welcome"><h1>⚠️</h1><p>Could not read this file.</p></div>'; setStatus("Error: "+(err.message||err)); }
}

let currentDoc=null, currentBlocks=null, currentFromOcr=false;
async function finishOpen(doc, blocks, fromOcr){
  currentDoc=doc; currentBlocks=blocks; currentFromOcr=fromOcr;
  if (typeof Annot!=="undefined") Annot.cancelSelection();
  if (typeof Ink!=="undefined"){ Ink.setActive(false); await Ink.loadForDoc(doc.id); }
  const ext = extOf(doc.name);
  const isPdf = isPagedExt(ext);        // page-image documents: PDF and comics
  const isComic = isComicExt(ext);
  let mode = "text";
  let autoFellBack=false;
  if (isComic && !fromOcr){ mode="pdf"; }   // nothing to reflow until OCR has produced text
  else if (isPdf){
    let pref="pdf";
    try{ const s=await DB.getMeta(Theme.SETTINGS_ID); if(s&&s.viewMode) pref=s.viewMode; }catch(e){}
    const hasAnyPosition = blocks.some(b => b && typeof b==="object" && Array.isArray(b.words) && b.words.length>0);
    if (pref==="pdf" && !hasAnyPosition){ mode="text"; autoFellBack=true; }
    else mode = pref;
  }

  Reader.setImageSource(doc);
  if (typeof Pager!=="undefined" && Pager.on) Pager.disable(true);   // old book's page layout must not touch the new book (it used to reset the saved position to page 1)
  if (isPdf && mode==="pdf") await Reader.renderPdf(blocks, doc, { totalPages: doc._ctx&&doc._ctx.pages });
  else Reader.render(blocks, { totalPages: doc._ctx&&doc._ctx.pages });
  await Annot.loadForDoc(doc.id);

  lastHi=-1; _lastHlBox=null;
  const seek=$("#seek"); seek.max=Math.max(0,Reader.words.length-1); seek.value=0; seek.disabled=false;
  UI.enableControls(true);
  updatePageNav();
  updateViewModeBtn(isPdf, mode);
  const meta=await DB.getMeta(doc.id); let resumedPct=0;
  Speech.cursor = (meta && meta.audioPos>0 && meta.audioPos<Reader.words.length) ? meta.audioPos : 0;
  resumedPct = Reading.restore(meta) || 0;
  Reading.syncChrome();
  DB.setMeta(doc.id,{ wordCount:Reader.words.length, lastOpened:Date.now() });
  const wc=Reader.bodyWordCount; const base=`${wc.toLocaleString()} words · ${Reader.starts.length.toLocaleString()} sentences`;
  const fallbackNote = autoFellBack ? " (switched to text view — this document has no word positions to tap in PDF view)" : "";
  setStatus((resumedPct?`Resumed at ${resumedPct}% · ${base}.`:`Ready · ${base}.`)+` ${fallbackNote}`);
  const pages=doc._ctx&&doc._ctx.pages;
  const lowText=!fromOcr && ext==="pdf" && (Reader.bodyWordCount<Math.max(25,(pages||1)*10));
  if(isComic && !fromOcr){ showOcrBar(doc, "comic"); setStatus(`${(pages||0).toLocaleString()} pages · run OCR to read this aloud.`); }
  else if(lowText) showOcrBar(doc, "scanned");
  else if(!fromOcr && ext==="pdf" && looksLikeGarbledDevanagari()) showOcrBar(doc, "garbled");
}

function updateViewModeBtn(isPdf, mode){
  const row=$("#viewModeRow"), btn=$("#viewModeBtn");
  if (!isPdf){ row.hidden=true; if (typeof Ink!=="undefined") Ink.setAvailable(false); return; }
  row.hidden=false;
  btn.textContent = mode==="pdf" ? "\uD83D\uDCC4 PDF view (tap to switch to Text)" : "\uD83D\uDCDD Text view (tap to switch to PDF)";
  if (typeof Ink!=="undefined") Ink.setAvailable(mode==="pdf");
}
$("#viewModeBtn").onclick=async()=>{
  if (!currentDoc || !currentBlocks) return;
  const next = Reader.mode==="pdf" ? "text" : "pdf";
  const savedCursor = Reading.measure ? (Reading.measure()||0) : (Speech.cursor||0);
  Speech.stop();
  try{ await DB.setMeta(Theme.SETTINGS_ID,{viewMode:next}); }catch(e){}
  if (next==="pdf") await Reader.renderPdf(currentBlocks, currentDoc, { totalPages: currentDoc._ctx&&currentDoc._ctx.pages });
  else Reader.render(currentBlocks, { totalPages: currentDoc._ctx&&currentDoc._ctx.pages });
  Annot.renderAll();
  lastHi=-1; _lastHlBox=null;
  $("#seek").max=Math.max(0,Reader.words.length-1);
  updatePageNav();
  updateViewModeBtn(true, next);
  const idx=Math.min(savedCursor, Math.max(0,Reader.words.length-1));
  Speech.cursor=idx; Reading.pos=idx; Reading.syncChrome();
  setTimeout(()=>Reading.goToWord(idx,{noAudio:true}),50);
  closeMoreMenu();
};

let ocrDocRef=null;
// Devanagari combining marks (matras, anusvara, visarga, candrabindu, nukta,
// virama, and related vowel-sign variants) that can never legally start a
// word -- they must follow a consonant. A meaningful fraction of words
// starting with one of these is a strong, font-agnostic signal that the
// PDF's text layer comes from a legacy non-Unicode Hindi font (Kruti Dev,
// DevLys, Chanakya, and similar were common in Indian publishing) rather
// than genuine extracted text -- the glyphs render correctly in a normal
// viewer, but the underlying character codes aren't real Unicode.
const DEVANAGARI_BAD_START = /^[\u0900-\u0903\u093A\u093C\u093E-\u094D\u0951-\u0957\u0962\u0963]/;
function looksLikeGarbledDevanagari(){
  let checked=0, bad=0;
  for (const w of Reader.words){
    if (w.skip) continue;
    const t=w.text;
    if (!/[\u0900-\u097F]/.test(t)) continue; // only count words with some Devanagari content
    checked++;
    if (DEVANAGARI_BAD_START.test(t)) bad++;
    if (checked>=2000) break; // sampling this many words is plenty to detect systemic corruption
  }
  return checked>=30 && (bad/checked) > 0.04;
}

function showOcrBar(doc, reason){
  ocrDocRef=doc;
  $("#ocrMsg").textContent = reason==="comic"
    ? "These are page images. Run OCR so the text can be read aloud and highlighted (works offline; may take a while for long comics)."
    : reason==="garbled"
    ? "This page displays fine, but its underlying text looks scrambled — likely a legacy (non-Unicode) font. Run OCR so it can be read aloud correctly (works offline)."
    : "This page displays fine, but little selectable text was found underneath it — likely a scan. Run OCR so it can be read aloud (works offline).";
  if (reason==="garbled") $("#ocrLangOrder").value="hin+eng";
  if (reason==="comic") $("#ocrLangOrder").value="eng+hin";
  $("#ocrProg").hidden=true; $("#ocrCancel").hidden=true; $("#ocrRun").hidden=false; $("#ocrRun").disabled=false; $("#ocrDismiss").hidden=false; $("#ocrLangOrder").hidden=false;
  $("#ocrBar").classList.add("show");
}
function hideOcrBar(){ $("#ocrBar").classList.remove("show"); ocrDocRef=null; }
$("#ocrDismiss").onclick=hideOcrBar;
$("#ocrCancel").onclick=()=>{ OCR.cancel=true; $("#ocrCancel").disabled=true; $("#ocrMsg").textContent="Cancelling…"; };
$("#ocrRun").onclick=async()=>{
  if(!ocrDocRef) return; const doc=ocrDocRef; Speech.stop();
  const langOrder=$("#ocrLangOrder").value;
  $("#ocrRun").hidden=true; $("#ocrDismiss").hidden=true; $("#ocrLangOrder").hidden=true; $("#ocrCancel").hidden=false; $("#ocrCancel").disabled=false;
  $("#ocrProg").hidden=false; $("#ocrProg").value=0; $("#ocrMsg").textContent="Starting OCR engine…";
  let curPage=1, totalPages=1;
  try{
    const result=await OCR.run(doc,(p)=>{
      if(p.page){ curPage=p.page; totalPages=p.pages; $("#ocrMsg").textContent=`OCR — page ${p.page} of ${p.pages}…`; }
      if(typeof p.frac==="number"){ $("#ocrProg").value=Math.min(100,Math.round(((curPage-1)+p.frac)/totalPages*100)); }
    }, langOrder);
    const blocks=result.blocks;
    if(OCR.cancel){ hideOcrBar(); setStatus("OCR cancelled."); return; }
    if(!blocks.length){ $("#ocrMsg").textContent="OCR found no readable text on these pages."; $("#ocrCancel").hidden=true; $("#ocrDismiss").hidden=false; return; }
    doc.ocrText=blocks; doc._ctx={pages:result.pages};
    const stored=await DB.getDoc(doc.id); stored.ocrText=blocks; stored._ctx=doc._ctx; await DB.putDoc(stored);
    hideOcrBar(); finishOpen(stored,blocks,true); UI.refreshLibrary();
  }catch(err){ console.error(err);
    $("#ocrMsg").textContent="OCR failed: "+(err.message||err);
    $("#ocrCancel").hidden=true; $("#ocrDismiss").hidden=false; $("#ocrRun").hidden=false; $("#ocrRun").disabled=false;
  }
};

function updatePageNav(){
  const nav=$("#pageNav"); const tp=Reader.totalPages||0;
  if (tp>1){
    nav.hidden=false;
    $("#pageInput").max=tp; $("#pageInput").value=1;
    $("#pageTotal").textContent=tp;
  } else {
    nav.hidden=true;
  }
}
function goToPage(){
  const n=parseInt($("#pageInput").value,10);
  if(!Number.isFinite(n)) return;
  const idx=Reader.wordIndexForPage(n);
  if(idx==null){ setStatus("No content found for that page."); return; }
  Reading.goToWord(idx,{noAudio:true});
}
$("#pageGoBtn").onclick=goToPage;

let _resizeSettleT=0, _lastReaderW=0;
function handleReaderResize(force){
  if (typeof Pager!=="undefined" && Pager.on){ Pager.onResize(); return; }
  if (Reader.mode!=="pdf"){ _lastReaderW=$("#reader").clientWidth; return; }
  const rw=$("#reader").clientWidth;
  const widthChanged = force===true || Math.abs(rw-_lastReaderW)>1; _lastReaderW=rw;
  const apply=()=>{
    Object.keys(Reader.pageWrappers).forEach(pStr=>{
      const p=Number(pStr), wrapper=Reader.pageWrappers[p];
      if (wrapper.dataset.rendered==="1"){
        Reader.pageDisplayScale[p] = wrapper.clientWidth/(Reader.pagePtWidth[p]||612);
      }
    });
    // reposition (never scroll to) the audio highlight, then re-render sharp canvases
    if (lastHi>=0 && Speech.playing) highlightPdf(lastHi, true);
  };
  if (widthChanged && Reading.withAnchor) Reading.withAnchor(apply); else apply();
  clearTimeout(_resizeSettleT);
  _resizeSettleT=setTimeout(()=>{
    const redo=()=>Object.keys(Reader.pageWrappers).forEach(pStr=>{
      const p=Number(pStr), wrapper=Reader.pageWrappers[p];
      if (wrapper.dataset.rendered==="1"){ wrapper.dataset.rendered="0"; renderPageCanvas(wrapper,p); }
    });
    if (Reading.withAnchor) Reading.withAnchor(redo); else redo();
  }, 300);
}
new ResizeObserver(()=>handleReaderResize()).observe($("#reader"));

function openMoreMenu(){
  const btn=$("#moreBtn"), menu=$("#moreMenu");
  const r=btn.getBoundingClientRect();
  menu.style.top=(r.bottom+8)+"px";
  menu.style.right=(window.innerWidth-r.right)+"px";
  menu.hidden=false;
}
function closeMoreMenu(){ $("#moreMenu").hidden=true; }
$("#moreBtn").onclick=(e)=>{ e.stopPropagation(); $("#moreMenu").hidden ? openMoreMenu() : closeMoreMenu(); };
document.addEventListener("click",(e)=>{
  const menu=$("#moreMenu");
  if (!menu.hidden && !menu.contains(e.target) && e.target!==$("#moreBtn") && !$("#moreBtn").contains(e.target)) closeMoreMenu();
});
// Selecting the theme or view-mode item keeps the menu open (their own
// handlers already run above); only Page-jump's Go button and Fullscreen
// should close it, since those represent a completed action.
$("#pageGoBtn").addEventListener("click", closeMoreMenu);
$("#fullscreenBtn").onclick=()=>toggleFullscreen(true);
$("#exitFullscreenBtn").onclick=()=>toggleFullscreen(false);
$("#pageInput").addEventListener("keydown",(e)=>{ if(e.key==="Enter") goToPage(); });

function handleWordTap(i){ /* superseded by Reading.onTap (tap zones); kept so old callers don't break */ }

/* ---------- highlights & notes ---------- */
// One record covers both: a highlight is just a record with note:"". Presence
// of non-empty note text is what shows the small note-icon marker. This
// avoids a separate "type" field and the branching that would come with it.
function wordIndexAtEvent(e){
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  if (!hit) return null;
  if (Reader.mode==="text"){
    const span=hit.closest(".w"); if(!span) return null;
    return parseInt(span.dataset.i,10);
  }
  const wrapper=hit.closest(".pdfpage"); if(!wrapper) return null;
  const p=Number(wrapper.dataset.page);
  const canvas=wrapper.querySelector("canvas"); if(!canvas) return null;
  const rect=canvas.getBoundingClientRect();
  const scale=rect.width/(Reader.pagePtWidth[p]||612);
  const px=(e.clientX-rect.left)/scale, py=(e.clientY-rect.top)/scale;
  return Reader.wordIndexNearPoint(p, px, py);
}

const Annot = {
  items:[], selecting:false, startIdx:null, endIdx:null, _selPreviewEl:null,

  async loadForDoc(docId){
    try{ this.items = await DB.annotationsForDoc(docId) || []; }catch(e){ this.items=[]; }
    this.renderAll();
  },
  startSelection(idx){
    if (!Reader.words[idx]) return;
    this.selecting=true; this.startIdx=idx; this.endIdx=idx;
    this._showSelectionOverlay(); this._showToolbar();
  },
  extendSelection(idx){
    if (!this.selecting || !Reader.words[idx]) return;
    if (Reader.mode==="pdf" && Reader.words[idx].page !== Reader.words[this.startIdx].page) return; // keep selection within one page in pdf mode
    this.endIdx=idx;
    this._showSelectionOverlay(); this._positionToolbar();
  },
  cancelSelection(){
    this.selecting=false; this.startIdx=null; this.endIdx=null;
    this._clearSelectionOverlay();
    $("#annotToolbar").hidden=true;
  },
  range(){ if(this.startIdx==null||this.endIdx==null) return [0,-1]; return [Math.min(this.startIdx,this.endIdx), Math.max(this.startIdx,this.endIdx)]; },

  _wordSpanBBox(a,b,page){
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(let i=a;i<=b;i++){ const w=Reader.words[i]; if(!w||w.x==null||(page!=null&&w.page!==page)) continue;
      minX=Math.min(minX,w.x); maxX=Math.max(maxX,w.x+w.w); minY=Math.min(minY,w.y); maxY=Math.max(maxY,w.y+w.h); }
    return minX===Infinity ? null : {x:minX,y:minY,w:maxX-minX,h:maxY-minY};
  },
  _showSelectionOverlay(){
    this._clearSelectionOverlay();
    const [a,b]=this.range();
    if (Reader.mode==="pdf"){
      const page=Reader.words[a].page; const wrapper=Reader.pageWrappers[page]; if(!wrapper) return;
      const scale=Reader.pageDisplayScale[page]||(wrapper.clientWidth/(Reader.pagePtWidth[page]||612));
      const bb=this._wordSpanBBox(a,b,page); if(!bb) return;
      const elx=el("div"); elx.className="pdfannot sel-preview-pdf"; elx.dataset.color="yellow";
      elx.style.left=(bb.x*scale)+"px"; elx.style.top=(bb.y*scale)+"px";
      elx.style.width=(bb.w*scale)+"px"; elx.style.height=(bb.h*scale)+"px";
      elx.style.outline="2px dashed #6a45ff";
      wrapper.appendChild(elx); this._selPreviewEl=elx;
    } else {
      for(let i=a;i<=b;i++){ const w=Reader.words[i]; if(w&&w.span) w.span.classList.add("sel-preview"); }
    }
  },
  _clearSelectionOverlay(){
    if (this._selPreviewEl){ this._selPreviewEl.remove(); this._selPreviewEl=null; }
    document.querySelectorAll(".w.sel-preview").forEach(s=>s.classList.remove("sel-preview"));
  },
  _showToolbar(){ $("#annotToolbar").hidden=false; this._positionToolbar(); },
  _positionToolbar(){
    const bar=$("#annotToolbar"); if(bar.hidden) return;
    let rect=null;
    if (Reader.mode==="pdf" && this._selPreviewEl) rect=this._selPreviewEl.getBoundingClientRect();
    else { const [,b]=this.range(); const w=Reader.words[b]; if(w&&w.span) rect=w.span.getBoundingClientRect(); }
    if (!rect) return;
    const barW=bar.offsetWidth||220;
    let left=rect.left+rect.width/2-barW/2;
    left=Math.max(8,Math.min(left, window.innerWidth-barW-8));
    let top=rect.top-56; if (top<8) top=rect.bottom+10;
    bar.style.left=left+"px"; bar.style.top=top+"px";
  },

  async saveHighlight(color){
    const [a,b]=this.range(); if(b<a) return;
    const id=crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random());
    const rec={ id, docId:UI.activeId, page:(Reader.words[a]?Reader.words[a].page:null), startWord:a, endWord:b, color, note:"", createdAt:Date.now() };
    try{ await DB.putAnnotation(rec); }catch(e){}
    this.items.push(rec); this.cancelSelection(); this.renderAll();
  },
  openNoteEditor(existing){
    const [selA,selB]=this.range();
    const a=existing?existing.startWord:selA, b=existing?existing.endWord:selB;
    if (b<a) return;
    $("#noteModalTitle").textContent = existing ? "Edit note" : "Add note";
    $("#noteModalQuote").textContent = Reader.textFrom(a,b).slice(0,180);
    $("#noteText").value = existing ? (existing.note||"") : "";
    $("#noteDeleteBtn").hidden = !existing;
    const modal=$("#noteModal");
    modal.dataset.editingId = existing ? existing.id : "";
    modal.dataset.startWord = a; modal.dataset.endWord = b;
    modal.dataset.color = existing ? existing.color : "blue";
    modal.hidden=false;
    setTimeout(()=>$("#noteText").focus(),50);
  },
  async saveNote(){
    const modal=$("#noteModal");
    const text=$("#noteText").value.trim();
    const a=parseInt(modal.dataset.startWord,10), b=parseInt(modal.dataset.endWord,10);
    const editingId=modal.dataset.editingId;
    const id=editingId || (crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random()));
    const rec={ id, docId:UI.activeId, page:(Reader.words[a]?Reader.words[a].page:null), startWord:a, endWord:b, color:modal.dataset.color||"blue", note:text, createdAt:Date.now() };
    try{ await DB.putAnnotation(rec); }catch(e){}
    const idx=this.items.findIndex(x=>x.id===id);
    if (idx>=0) this.items[idx]=rec; else this.items.push(rec);
    modal.hidden=true; this.cancelSelection(); this.renderAll();
  },
  async deleteAnnotation(id){
    try{ await DB.delAnnotation(id); }catch(e){}
    this.items=this.items.filter(x=>x.id!==id);
    this.renderAll();
    $("#noteModal").hidden=true;
  },

  renderAll(){
    document.querySelectorAll(".pdfannot:not(.sel-preview-pdf)").forEach(n=>n.remove());
    document.querySelectorAll(".w.hl-yellow,.w.hl-green,.w.hl-pink,.w.hl-blue").forEach(s=>s.classList.remove("hl-yellow","hl-green","hl-pink","hl-blue"));
    document.querySelectorAll(".note-icon").forEach(n=>n.remove());
    this.items.forEach(a=>this.renderOne(a));
  },
  renderOne(a){
    if (Reader.mode==="pdf"){
      const wrapper=Reader.pageWrappers[a.page]; if(!wrapper || wrapper.dataset.rendered!=="1") return; // re-drawn when that page's canvas renders, see renderPageCanvas
      const scale=Reader.pageDisplayScale[a.page]||(wrapper.clientWidth/(Reader.pagePtWidth[a.page]||612));
      const bb=this._wordSpanBBox(a.startWord,a.endWord,a.page); if(!bb) return;
      const rectEl=el("div"); rectEl.className="pdfannot"; rectEl.dataset.color=a.color;
      rectEl.style.left=(bb.x*scale)+"px"; rectEl.style.top=(bb.y*scale)+"px";
      rectEl.style.width=(bb.w*scale)+"px"; rectEl.style.height=(bb.h*scale)+"px";
      rectEl.addEventListener("click",(e)=>{ e.stopPropagation(); Annot.openNoteEditor(a); });
      wrapper.appendChild(rectEl);
      if (a.note){
        const marker=el("div"); marker.className="pdfannot note-marker";
        marker.style.left=Math.max(0,bb.x*scale-8)+"px"; marker.style.top=(bb.y*scale-8)+"px";
        marker.style.background = a.color==="yellow"?"#ffe066":a.color==="green"?"#8ce99a":a.color==="pink"?"#ffa8c5":"#8ecdf7";
        marker.innerHTML='<svg viewBox="0 0 24 24"><path d="M4 4h16v12H8l-4 4V4z"/></svg>';
        marker.addEventListener("click",(e)=>{ e.stopPropagation(); Annot.openNoteEditor(a); });
        wrapper.appendChild(marker);
      }
    } else {
      for(let i=a.startWord;i<=a.endWord;i++){ const w=Reader.words[i]; if(w&&w.span) w.span.classList.add("hl-"+a.color); }
      if (a.note){
        const w=Reader.words[a.startWord];
        if (w&&w.span&&w.span.parentNode){
          const icon=el("span","note-icon");
          icon.innerHTML='<svg viewBox="0 0 24 24"><path d="M4 4h16v12H8l-4 4V4z"/></svg>';
          icon.addEventListener("click",(e)=>{ e.stopPropagation(); Annot.openNoteEditor(a); });
          w.span.parentNode.insertBefore(icon, w.span);
        }
      }
    }
  }
};

let _lpTimer=null, _lpStartX=0, _lpStartY=0, _lpFired=false, _suppressNextClick=false, _suppressClickT=null;
const LP_MS=480, LP_MOVE_TOL=10;
function suppressNextClick(){
  _suppressNextClick=true;
  // Safety net: if for any reason the click event never actually fires
  // (so our own click handler never gets a chance to consume this flag),
  // it self-clears shortly after -- a stale "true" here would otherwise
  // silently break every future tap-to-read.
  clearTimeout(_suppressClickT);
  _suppressClickT=setTimeout(()=>{ _suppressNextClick=false; }, 400);
}
/* ---- press-and-drag selection (long-press a word, drag to extend; handles to adjust) ---- */
// strict hit-test: a press must be ON a word (or within a hair of one), never on blank space
function wordIndexStrict(e){
  if (Reader.mode==="text"){
    Reader.matAtPoint(e.clientX, e.clientY);
    for (const dx of [0,-5,5]){
      const hit=document.elementFromPoint(e.clientX+dx, e.clientY); const sp=hit&&hit.closest&&hit.closest(".w");
      if (sp) return parseInt(sp.dataset.i,10);
    }
    return null;
  }
  const idx=wordIndexAtEvent(e); if (idx==null) return null;
  const w=Reader.words[idx]; const hit=document.elementFromPoint(e.clientX,e.clientY); const wr=hit&&hit.closest&&hit.closest(".pdfpage"); if(!wr||!w) return null;
  const p=Number(wr.dataset.page), cv=wr.querySelector("canvas"); if(!cv) return null;
  const rc=cv.getBoundingClientRect(); const sc=rc.width/(Reader.pagePtWidth[p]||612);
  const px=(e.clientX-rc.left)/sc, py=(e.clientY-rc.top)/sc;
  const pad=Math.max(4,w.h*0.5);
  return (px>=w.x-pad && px<=w.x+w.w+pad && py>=w.y-pad && py<=w.y+w.h+pad) ? idx : null;
}
function wordClientRect(i){
  const w=Reader.words[i]; if(!w) return null;
  if (Reader.mode==="text") return w.span ? w.span.getBoundingClientRect() : null;
  const wr=Reader.pageWrappers[w.page]; if(!wr||w.x==null) return null;
  const cv=wr.querySelector("canvas"); const rc=(cv||wr).getBoundingClientRect();
  const sc=rc.width/(Reader.pagePtWidth[w.page]||612);
  return {left:rc.left+w.x*sc, right:rc.left+(w.x+w.w)*sc, top:rc.top+w.y*sc, bottom:rc.top+(w.y+w.h)*sc};
}
const SelDrag = {
  mode:null, anchor:null, timer:0, edge:0, x:0, y:0, startX:0, startY:0, pid:null,
  handles:null,
  ensureHandles(){
    if (this.handles) return;
    this.handles=["a","b"].map(k=>{ const h=el("div"); h.className="selHandle"; h.dataset.k=k; h.hidden=true; document.body.appendChild(h);
      h.addEventListener("pointerdown",(e)=>{ e.preventDefault(); e.stopPropagation();
        const [lo,hi]=Annot.range(); this.anchor = (k==="a") ? hi : lo; this.mode="handle"; this.pid=e.pointerId;
        try{ h.setPointerCapture(e.pointerId); }catch(_){}
        this.x=e.clientX; this.y=e.clientY; });
      h.addEventListener("pointermove",(e)=>{ if(this.mode!=="handle") return; this.x=e.clientX; this.y=e.clientY-26; this.move(); });
      const up=()=>{ if(this.mode==="handle") this.end(); };
      h.addEventListener("pointerup",up); h.addEventListener("pointercancel",up);
      return h; });
  },
  position(){
    this.ensureHandles();
    const show = Annot.selecting && Annot.startIdx!=null;
    if (!show){ this.handles.forEach(h=>h.hidden=true); return; }
    const [lo,hi]=Annot.range(); const r1=wordClientRect(lo), r2=wordClientRect(hi);
    const rr=$("#reader").getBoundingClientRect();
    const put=(h,r,x)=>{ if(!r || r.bottom<rr.top || r.top>rr.bottom){ h.hidden=true; return; } h.hidden=false; h.style.left=(x-14)+"px"; h.style.top=(r.bottom-2)+"px"; };
    put(this.handles[0],r1,r1?r1.left:0); put(this.handles[1],r2,r2?r2.right:0);
  },
  move(){
    const e={clientX:this.x, clientY:this.y};
    let idx=wordIndexAtEvent(e);
    if (idx==null && Reader.mode==="text"){ for(const dx of [-8,8,-16,16]){ idx=wordIndexAtEvent({clientX:this.x+dx,clientY:this.y}); if(idx!=null) break; } }
    if (idx!=null){ Annot.startIdx=this.anchor; Annot.extendSelection(idx); this.position(); }
    const rr=$("#reader").getBoundingClientRect();
    this.edge = this.y<rr.top+80 ? -1 : (this.y>rr.bottom-80 ? 1 : 0);
    if (this.edge && !this.scrollT && !Pager.on) this.scrollT=setInterval(()=>{ if(!this.edge||!this.mode){ clearInterval(this.scrollT); this.scrollT=0; return; }
      $("#reader").scrollTop += this.edge*14; this.move(); }, 30);
  },
  end(){
    this.mode=null; this.edge=0; clearInterval(this.scrollT); this.scrollT=0; suppressNextClick(); this.position();
    if (Annot.selecting) Annot._positionToolbar();
  }
};
Annot.reposition=function(){ SelDrag.position(); };
{ const _cs=Annot.cancelSelection, _ss=Annot.startSelection, _es=Annot.extendSelection;
  Annot.cancelSelection=function(){ _cs.call(this); SelDrag.mode=null; SelDrag.position(); };
  Annot.startSelection=function(i){ _ss.call(this,i); SelDrag.position(); };
  Annot.extendSelection=function(i){ _es.call(this,i); SelDrag.position(); }; }

$("#content").addEventListener("pointerdown",(e)=>{
  if (typeof Ink!=="undefined" && Ink.active) return; // stylus is drawing, not selecting
  if (e.pointerType==="mouse" && e.button!==0) return;
  if (!e.isPrimary){ clearTimeout(_lpTimer); _lpTimer=null; return; }   // second finger = pinch, not a press
  _lpFired=false; _lpStartX=e.clientX; _lpStartY=e.clientY; SelDrag.x=e.clientX; SelDrag.y=e.clientY;
  clearTimeout(_lpTimer);
  _lpTimer=setTimeout(()=>{
    _lpTimer=null;
    const idx=wordIndexStrict({clientX:_lpStartX, clientY:_lpStartY});
    if (idx==null) return;                          // pressed blank space: do nothing at all
    _lpFired=true;
    if (Annot.selecting) Annot.cancelSelection();
    Annot.startSelection(idx); SelDrag.anchor=idx; SelDrag.mode="new";
    try{ navigator.vibrate && navigator.vibrate(12); }catch(_){}
  }, LP_MS);
});
$("#content").addEventListener("pointermove",(e)=>{
  if (SelDrag.mode==="new"){ SelDrag.x=e.clientX; SelDrag.y=e.clientY; SelDrag.move(); return; }
  if (!_lpTimer) return;
  if (Math.hypot(e.clientX-_lpStartX, e.clientY-_lpStartY) > LP_MOVE_TOL){ clearTimeout(_lpTimer); _lpTimer=null; }
});
const _lpCancel=()=>{ clearTimeout(_lpTimer); _lpTimer=null; if(SelDrag.mode==="new") SelDrag.end(); };
$("#content").addEventListener("pointerup",()=>{ clearTimeout(_lpTimer); _lpTimer=null; if (SelDrag.mode==="new") SelDrag.end(); else if (_lpFired) suppressNextClick(); });
$("#content").addEventListener("pointercancel",_lpCancel);
$("#reader").addEventListener("scroll",()=>{ if(Annot.selecting) SelDrag.position(); },{passive:true});
// while dragging a selection the page must not scroll under the finger
document.addEventListener("touchmove",(e)=>{ if(SelDrag.mode && e.cancelable) e.preventDefault(); },{passive:false});
$("#content").addEventListener("contextmenu",(e)=>e.preventDefault());

$("#annotToolbar").querySelectorAll(".swatch").forEach(btn=>{
  btn.addEventListener("click",()=>Annot.saveHighlight(btn.dataset.color));
});
$("#annotNoteBtn").onclick=()=>{ $("#annotToolbar").hidden=true; Annot.openNoteEditor(null); };
$("#annotCancelBtn").onclick=()=>Annot.cancelSelection();
$("#noteCancelBtn").onclick=()=>{ $("#noteModal").hidden=true; Annot.cancelSelection(); };
$("#noteSaveBtn").onclick=()=>Annot.saveNote();
$("#noteDeleteBtn").onclick=()=>{ const id=$("#noteModal").dataset.editingId; if(id) Annot.deleteAnnotation(id); };

/* ---------- stylus ink annotation ----------
   Pen-only free-hand marks over a PDF/comic page. Strokes are stored in PDF-point
   space (like Annot's word boxes) so they stay correctly placed across zoom/resize.
   The canvas per page is created lazily the first time that page renders, and is
   pointer-events:none until ink mode is switched on (see .inkcanvas in css.html). */
const Ink = {
  active:false, color:"#ff3b30", width:2.5, items:[], _drawing:null,

  async loadForDoc(docId){
    try{ this.items = await DB.inkForDoc(docId) || []; }catch(e){ this.items=[]; }
  },
  strokesForPage(page){ return this.items.filter(s=>s.page===page); },

  setAvailable(on){
    $("#inkToolsRow").hidden=!on;
    if(!on && this.active) this.setActive(false);
  },
  setActive(on){
    this.active=!!on;
    $("#inkToolsBtn").classList.toggle("active", this.active);
    $("#inkPanel").hidden=!this.active;
    if(this.active){
      $("#inkPanel").querySelectorAll(".swatch[data-ink-color]").forEach(b=>b.classList.toggle("selected", b.dataset.inkColor===this.color));
      $("#inkWidth").value=this.width;
    }
    Object.keys(Reader.pageWrappers||{}).forEach(p=>{
      const c=Reader.pageWrappers[p].querySelector(".inkcanvas");
      if(c) c.style.pointerEvents = this.active ? "auto" : "none";
    });
    if(!this.active) this._drawing=null;
  },
  currentPage(){
    let best=null, bestTop=Infinity;
    Object.values(Reader.pageWrappers||{}).forEach(w=>{
      const top=Math.abs(w.getBoundingClientRect().top);
      if (top<bestTop){ bestTop=top; best=Number(w.dataset.page); }
    });
    return best;
  },

  // Called from renderPageCanvas every time a page (re)renders, same pattern as Annot.renderOne.
  redrawPage(wrapper, pageNum){
    let canvas=wrapper.querySelector(".inkcanvas");
    if(!canvas){
      canvas=el("canvas","inkcanvas");
      wrapper.insertBefore(canvas, wrapper.querySelector(".pdfpagenum"));
      this._wirePointerEvents(canvas, pageNum);
    }
    const cssW=wrapper.clientWidth||1, cssH=wrapper.clientHeight||1;
    const dpr=Math.min(2, window.devicePixelRatio||1);
    canvas.width=Math.round(cssW*dpr); canvas.height=Math.round(cssH*dpr);
    canvas.style.pointerEvents = this.active ? "auto" : "none";
    const ctx=canvas.getContext("2d");
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const scale=(Reader.pageDisplayScale[pageNum]||(cssW/(Reader.pagePtWidth[pageNum]||612)))*dpr;
    this.strokesForPage(pageNum).forEach(s=>this._paintStroke(ctx, s, scale));
  },
  _paintStroke(ctx, s, scale){
    if(!s.pts || s.pts.length<2) return;
    ctx.save(); ctx.lineCap="round"; ctx.lineJoin="round";
    ctx.strokeStyle=s.color; ctx.lineWidth=Math.max(1,(s.width||2.5)*scale);
    ctx.beginPath(); ctx.moveTo(s.pts[0][0]*scale, s.pts[0][1]*scale);
    for(let i=1;i<s.pts.length;i++) ctx.lineTo(s.pts[i][0]*scale, s.pts[i][1]*scale);
    ctx.stroke(); ctx.restore();
  },

  _wirePointerEvents(canvas, pageNum){
    const toDocPt=(e)=>{
      const rect=canvas.getBoundingClientRect();
      const scale=Reader.pageDisplayScale[pageNum] || (rect.width/(Reader.pagePtWidth[pageNum]||612));
      return [(e.clientX-rect.left)/scale, (e.clientY-rect.top)/scale];
    };
    canvas.addEventListener("pointerdown",(e)=>{
      if(!this.active || e.pointerType!=="pen") return;
      e.preventDefault(); e.stopPropagation();
      try{ canvas.setPointerCapture(e.pointerId); }catch(err){}
      this._drawing={page:pageNum, pts:[toDocPt(e)], canvas};
      this._liveDraw(canvas, pageNum);
    });
    canvas.addEventListener("pointermove",(e)=>{
      if(!this._drawing || this._drawing.canvas!==canvas) return;
      e.preventDefault(); e.stopPropagation();
      this._drawing.pts.push(toDocPt(e));
      this._liveDraw(canvas, pageNum);
    });
    const finish=(e)=>{
      if(!this._drawing || this._drawing.canvas!==canvas) return;
      e.preventDefault(); e.stopPropagation();
      const d=this._drawing; this._drawing=null;
      this._commitStroke(d);
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
  },
  _liveDraw(canvas, pageNum){
    this.redrawPage(canvas.closest(".pdfpage"), pageNum); // repaint committed strokes
    const dpr=Math.min(2, window.devicePixelRatio||1);
    const cssW=canvas.closest(".pdfpage").clientWidth||1;
    const scale=(Reader.pageDisplayScale[pageNum]||(cssW/(Reader.pagePtWidth[pageNum]||612)))*dpr;
    this._paintStroke(canvas.getContext("2d"), {pts:this._drawing.pts, color:this.color, width:this.width}, scale);
  },
  async _commitStroke(d){
    if(!d.pts || d.pts.length<2 || !UI.activeId) return;
    const rec={ id:uid(), docId:UI.activeId, page:d.page, color:this.color, width:this.width, pts:d.pts, createdAt:Date.now() };
    try{ await DB.putInk(rec); }catch(e){}
    this.items.push(rec);
    const wrapper=Reader.pageWrappers[d.page]; if(wrapper) this.redrawPage(wrapper, d.page);
  },
  async undo(){
    if(!this.items.length) return;
    let latest=this.items[0];
    for(const s of this.items) if(s.createdAt>latest.createdAt) latest=s;
    try{ await DB.delInk(latest.id); }catch(e){}
    this.items=this.items.filter(s=>s.id!==latest.id);
    const wrapper=Reader.pageWrappers[latest.page]; if(wrapper) this.redrawPage(wrapper, latest.page);
  },
  async clearPage(pageNum){
    const onPage=this.strokesForPage(pageNum); if(!onPage.length) return;
    for(const s of onPage){ try{ await DB.delInk(s.id); }catch(e){} }
    const ids=new Set(onPage.map(s=>s.id));
    this.items=this.items.filter(s=>!ids.has(s.id));
    const wrapper=Reader.pageWrappers[pageNum]; if(wrapper) this.redrawPage(wrapper, pageNum);
  }
};
$("#inkToolsBtn").onclick=()=>{ Ink.setActive(!Ink.active); closeMoreMenu(); };
$("#inkDoneBtn").onclick=()=>Ink.setActive(false);
$("#inkPanel").querySelectorAll(".swatch[data-ink-color]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    Ink.color=btn.dataset.inkColor;
    $("#inkPanel").querySelectorAll(".swatch[data-ink-color]").forEach(b=>b.classList.toggle("selected", b===btn));
  });
});
$("#inkWidth").oninput=(e)=>{ Ink.width=parseFloat(e.target.value)||2.5; };
$("#inkUndoBtn").onclick=()=>Ink.undo();
$("#inkClearPageBtn").onclick=async()=>{
  const p=Ink.currentPage(); if(p==null) return;
  if(!Ink.strokesForPage(p).length) return;
  if(!await dlgConfirm("Clear ink?","Remove all pen marks on this page?","Clear")) return;
  Ink.clearPage(p);
};

function fmtAnnotSnippet(a){
  try{ return Reader.textFrom(a.startWord, Math.min(a.endWord, a.startWord+25)).slice(0,140); }catch(e){ return ""; }
}
function openAnnotList(){
  const body=$("#annotListBody"); body.innerHTML="";
  const items=[...Annot.items].sort((x,y)=>x.startWord-y.startWord);
  if (!items.length){ body.innerHTML='<div class="empty">No highlights or notes yet — long-press a word to start one.</div>'; }
  items.forEach(a=>{
    const row=el("div","annotRow");
    const dot=el("div","swatchDot"); dot.style.background = a.color==="yellow"?"#ffe066":a.color==="green"?"#8ce99a":a.color==="pink"?"#ffa8c5":"#8ecdf7";
    const bodyEl=el("div","annotBody");
    const quote=el("div","annotQuote"); quote.textContent=fmtAnnotSnippet(a);
    bodyEl.appendChild(quote);
    if (a.note){ const noteEl=el("div","annotNote"); noteEl.textContent=a.note; bodyEl.appendChild(noteEl); }
    const del=el("button","annotDel"); del.textContent="✕"; del.title="Delete";
    del.addEventListener("click",(e)=>{ e.stopPropagation(); Annot.deleteAnnotation(a.id); openAnnotList(); });
    row.appendChild(dot); row.appendChild(bodyEl); row.appendChild(del);
    row.addEventListener("click",()=>{
      $("#annotListModal").hidden=true;
      Speech.jump(a.startWord);
    });
    body.appendChild(row);
  });
  $("#annotListModal").hidden=false;
}
$("#annotListBtn").onclick=()=>{ closeMoreMenu(); openAnnotList(); };
const baseName=(n)=>(n||"book").replace(/\.[^.]+$/,"").replace(/[\\/:*?"<>|]+/g,"_").slice(0,80)||"book";
async function exportAnnotations(){
  const items=[...Annot.items].sort((x,y)=>x.startWord-y.startWord);
  if(!items.length){ await dlgAlert("Nothing to export","This book has no highlights or notes yet."); return; }
  const fmt=await dlgChoose("Export highlights & notes",[{label:"Markdown (.md)",value:"md"},{label:"Plain text (.txt)",value:"txt"}]); if(!fmt) return;
  const title=currentDoc?currentDoc.name:"Book"; let out="";
  if(fmt==="md") out+="# Highlights & notes — "+title+"\n\n";
  else out+="Highlights & notes — "+title+"\n\n";
  items.forEach((a,i)=>{
    const q=Reader.textFrom(a.startWord,a.endWord).trim(); const pg=a.page?" (page "+a.page+")":"";
    if(fmt==="md"){ out+="> "+q+"\n"; out+="\n*"+a.color+" highlight"+pg+"*\n"; if(a.note) out+="\n**Note:** "+a.note.replace(/\n/g,"\n> ")+"\n"; out+="\n---\n\n"; }
    else { out+=(i+1)+". \""+q+"\""+pg+" ["+a.color+"]\n"; if(a.note) out+="   Note: "+a.note.replace(/\n/g,"\n   ")+"\n"; out+="\n"; }
  });
  await saveAndReport(baseName(title)+"-highlights."+fmt, fmt==="md"?"text/markdown":"text/plain", new Blob([out],{type:"text/plain;charset=utf-8"}));
}
$("#annotExportBtn").onclick=()=>{ exportAnnotations(); };
$("#saveTextBtn").onclick=async()=>{
  closeMoreMenu();
  if(!Reader.words.length){ await dlgAlert("No text","Open a book with readable text first."); return; }
  let out="", line=[];
  Reader.words.forEach(w=>{ if(!w.skip) line.push(w.text); if(w.blockEnd){ if(line.length) out+=line.join(" ")+"\n\n"; line=[]; } });
  if(line.length) out+=line.join(" ")+"\n";
  await saveAndReport(baseName(currentDoc&&currentDoc.name)+".txt","text/plain",new Blob([out],{type:"text/plain;charset=utf-8"}));
};

/* ---------- back button (called from MainActivity.onBackPressed) ---------- */
window.__handleBack=function(){
  if(!$("#dlg").hidden){ dlgClose(null); return true; }
  if(Shelf.visible && Shelf.selectMode){ Shelf.exitSelectMode(); return true; }
  if(!$("#noteModal").hidden){ $("#noteCancelBtn").click(); return true; }
  if(!$("#annotListModal").hidden){ $("#annotListModal").hidden=true; return true; }
  if(Annot.selecting){ Annot.cancelSelection(); return true; }
  if(!$("#moreMenu").hidden){ closeMoreMenu(); return true; }
  if(typeof Settings!=="undefined"){
    if(!$("#settingsSheet").hidden){ Settings.close(); return true; }
    if(!$("#navSheet").hidden){ Nav.close(); return true; }
    if(!$("#searchChip").hidden){ Reading.clearSearch(); return true; }
    if(!$("#autoChip").hidden){ Reading.stopAuto(); return true; }
    if(!$("#listenDock").hidden && UI.activeId!=null && !Shelf.visible){ if(Speech.playing) Speech.pause(); showDock(false); return true; }
    if(document.body.classList.contains("reading") && document.body.classList.contains("chrome-hidden")){ Reading.setChrome(true); return true; }
  }
  if(document.body.classList.contains("reading-fullscreen")){ toggleFullscreen(false); return true; }
  if(Shelf.visible){
    if(Shelf.cwd){ Shelf.up(); return true; }
    if(Shelf.overReader && UI.activeId!=null){ Shelf.hide(); return true; }
    return false;                      // shelf root: let the app exit
  }
  if(UI.activeId!=null){               // reader -> shelf (in the book's own folder)
    if(Speech.playing) Speech.pause(); else saveProgress(true);
    DB.getMeta(UI.activeId).then(m=>{ Shelf.cwd=(m&&m.folderId)||null; Shelf.show(false); });
    return true;
  }
  return false;
};
$("#annotListCloseBtn").onclick=()=>{ $("#annotListModal").hidden=true; };

function toggleFullscreen(force){
  const on = force!==undefined ? force : !document.body.classList.contains("reading-fullscreen");
  document.body.classList.toggle("reading-fullscreen", on);
  $("#exitFullscreenBtn").hidden=!on;
  if (on){ closeMoreMenu(); }
}
/* scrubber is handled in reading.js (it scrolls the page, not the audio) */
$("#playBtn").onclick=()=>Speech.toggle();
$("#nextBtn").onclick=()=>Speech.next();
$("#prevBtn").onclick=()=>Speech.prev();
$("#rate").oninput=(e)=>{ $("#rateVal").textContent=parseFloat(e.target.value).toFixed(1)+"×"; if(Speech.playing) Speech.speakFrom(Speech.cursor); };
$("#rate").addEventListener("change",()=>{ try{DB.setMeta(Theme.SETTINGS_ID,{ttsRate:$("#rate").value,ttsPitch:$("#pitch").value});}catch(e){} });
$("#pitch").oninput=(e)=>{ $("#pitchVal").textContent=parseFloat(e.target.value).toFixed(1); if(Speech.playing) Speech.speakFrom(Speech.cursor); };
$("#voiceSel").onchange=()=>{ if(Speech.playing) Speech.speakFrom(Speech.cursor); };
$("#menuBtn").onclick=()=>{ if(Shelf.visible){ if(UI.activeId!=null) Shelf.hide(); } else Shelf.show(true); };
$("#addBtn").onclick=()=>$("#fileInput").click();
$("#welcomeAdd").onclick=()=>$("#fileInput").click();
$("#fileInput").onchange=(e)=>{ importFiles(e.target.files); e.target.value=""; };
["dragover","drop"].forEach(ev=>document.addEventListener(ev,(e)=>{ e.preventDefault(); if(ev==="drop"&&e.dataTransfer.files.length) importFiles(e.dataTransfer.files); }));

/* ---------- multi-select move + folder import -- wire up the toolbar ---------- */
$("#selectModeBtn").onclick=()=>Shelf.enterSelectMode();
$("#selectCancelBtn").onclick=()=>Shelf.exitSelectMode();
$("#selectMoveBtn").onclick=()=>Shelf.moveSelected();
$("#selectDelBtn").onclick=()=>Shelf.deleteSelected();
$("#selectAllBtn").onclick=()=>Shelf.selectAll();
$("#importFolderBtn").onclick=async()=>{
  if (Native.has && typeof AndroidBridge.pickFolder==="function"){
    setStatus("Importing folder…");
    let manifest; try{ manifest=await Native.pickFolder(); }catch(e){ manifest=null; }
    if (!manifest){ setStatus("Import cancelled."); return; }
    if (!manifest.length){ await dlgAlert("Empty folder","That folder didn't contain any files."); return; }
    // lightweight stand-ins: the real bytes are pulled one file at a time while importing
    const files=manifest.map(entry=>({ name:entry.name, size:entry.size||0, type:"", _relPath:entry.path||entry.name, _entry:entry }));
    await importFolder(files);
  } else {
    $("#folderInput").click(); // browser fallback: real <input webkitdirectory>
  }
};
$("#folderInput").onchange=(e)=>{ importFolder(e.target.files); e.target.value=""; };
window.addEventListener("beforeunload",()=>saveProgress(true));
if(window.speechSynthesis){ Speech.loadVoices(); speechSynthesis.onvoiceschanged=()=>Speech.loadVoices(); }
else $("#voiceSel").innerHTML="<option>No TTS available</option>";
setInterval(()=>{ if(Speech.playing&&speechSynthesis.speaking&&!speechSynthesis.paused){ speechSynthesis.pause(); speechSynthesis.resume(); } },12000);
/*__READING_JS__*/
Shelf.show(false);

window.__LoudReader = { Pager, Reading, Settings, Follow, Reader, Speech, DB, UI, OCR, Shelf, Native, Annot, openDoc, importFiles, parseDoc, dlg };
} /* end appInit */
</script>
</body>
</html>
