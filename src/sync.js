
/* ---------- Wi-Fi sync: two devices on the same network merge positions, bookmarks, highlights, ink and books ---------- */
const Sync = (() => {
  const SETS="__settings__", CH=512*1024, PORT_HINT=8765;
  const POS=["progress","page","wordCount","audioPos"], FIN=["finished","finishedAt"], BM=["bookmarks"];
  let code=null, hosting=false, hostInfo=null, bad=0, running=false, onHostActivity=null;
  const incoming={}; let bookCache={id:null,blob:null};
  const toB64=(u8)=>{ let s="",C=0x8000; for(let i=0;i<u8.length;i+=C) s+=String.fromCharCode.apply(null,u8.subarray(i,i+C)); return btoa(s); };
  const fromB64=(t)=>{ const bin=atob(t), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; };
  const stampPos=(m)=>m.pu||m.lastOpened||0, stampFin=(m)=>m.fu||m.finishedAt||0, stampBm=(m)=>m.bu||0;
  const aStamp=(a)=>a.ut||a.createdAt||0;

  /* ----- what this device has (everything except the book files themselves) ----- */
  async function localState(){
    const docs=await DB.allDocs(), all=await DB.allMeta(), ids=new Set(docs.map(d=>d.id));
    const meta={}; let tomb={docs:{},ann:{},ink:{}};
    for(const m of all){
      if(m.id==="__tomb__"){ tomb={docs:m.docs||{},ann:m.ann||{},ink:m.ink||{}}; continue; }
      if(!ids.has(m.id)) continue;
      const o={}; for(const k of [...POS,...FIN,...BM,"pu","fu","bu","lastOpened"]) if(m[k]!==undefined) o[k]=m[k];
      meta[m.id]=o;
    }
    const keep=(r)=>ids.has(r.docId);
    return { v:1, name:Sync.deviceName(), docs:docs.map(d=>({id:d.id,name:d.name,size:d.size||0,type:d.type,addedAt:d.addedAt})), meta,
      ann:(await DB.getAllOf("annotations")).filter(keep), ink:(await DB.getAllOf("ink")).filter(keep), tomb };
  }

  /* ----- pure merge rules: what must `to` take from `from` ----- */
  function metaPatch(f,t){
    const p={}; let any=false;
    const take=(keys,stamps)=>{ for(const k of keys) if(f[k]!==undefined) p[k]=f[k]; for(const k of stamps) if(f[k]!==undefined) p[k]=f[k]; any=true; };
    if(!t){ take([...POS,...FIN,...BM],["pu","fu","bu"]); if(f.lastOpened) p.lastOpened=f.lastOpened; return any?p:null; }
    if(stampPos(f)>stampPos(t)){ take(POS,["pu"]); if(p.pu===undefined) p.pu=stampPos(f); }
    if(stampFin(f)>stampFin(t)){ take(FIN,["fu"]); if(p.fu===undefined) p.fu=stampFin(f); }
    if(stampBm(f)>stampBm(t)) take(BM,["bu"]);
    if((f.lastOpened||0)>(t.lastOpened||0)){ p.lastOpened=f.lastOpened; any=true; }
    return any?p:null;
  }
  function need(f,t){
    const out={books:[],meta:[],ann:[],ink:[],delDocs:[],delAnn:[],delInk:[]};
    const tD=new Set(t.docs.map(d=>d.id)), fD=new Set(f.docs.map(d=>d.id)), tt=t.tomb||{}, ft=f.tomb||{};
    const tdt=tt.docs||{}, tat=tt.ann||{}, tit=tt.ink||{};
    for(const d of f.docs) if(!tD.has(d.id) && !tdt[d.id]) out.books.push(d.id);
    for(const id in (ft.docs||{})) if(tD.has(id) && !fD.has(id)) out.delDocs.push(id);
    for(const id of fD){ if(tdt[id]) continue; const fm=f.meta[id]; if(!fm) continue; const p=metaPatch(fm,t.meta[id]); if(p) out.meta.push(Object.assign({id},p)); }
    const tA=new Map(t.ann.map(a=>[a.id,a])), tI=new Map(t.ink.map(a=>[a.id,a]));
    for(const a of f.ann){ if(tat[a.id]||tdt[a.docId]) continue; const x=tA.get(a.id); if(!x||aStamp(a)>aStamp(x)) out.ann.push(a); }
    for(const k of f.ink){ if(tit[k.id]||tdt[k.docId]) continue; if(!tI.has(k.id)) out.ink.push(k); }
    for(const id in (ft.ann||{})){ const x=tA.get(id); if(x && aStamp(x)<=ft.ann[id]) out.delAnn.push(id); }
    for(const id in (ft.ink||{})) if(tI.has(id)) out.delInk.push(id);
    return out;
  }

  /* ----- apply a change set on this device ----- */
  async function apply(ch){
    const have=new Set((await DB.allDocs()).map(d=>d.id)); const n={meta:0,ann:0,ink:0,del:0};
    for(const id of ch.delDocs||[]){ if(have.has(id)){ try{ await Shelf._purgeBook(id); have.delete(id); n.del++; }catch(e){} } }
    for(const p of ch.meta||[]){ if(!have.has(p.id)) continue; const cur=(await DB.getMeta(p.id))||{id:p.id}; await DB.putOf("meta",Object.assign(cur,p)); n.meta++; }
    for(const a of ch.ann||[]){ if(have.has(a.docId)){ await DB.putOf("annotations",a); n.ann++; } }
    for(const k of ch.ink||[]){ if(have.has(k.docId)){ await DB.putOf("ink",k); n.ink++; } }
    for(const id of ch.delAnn||[]){ try{ await DB.delAnnotation(id); n.ann++; }catch(e){} }
    for(const id of ch.delInk||[]){ try{ await DB.delInk(id); n.ink++; }catch(e){} }
    return n;
  }

  /* ----- host side: answers requests that the native server forwards ----- */
  function parseTarget(t){ const i=t.indexOf("?"), path=i<0?t:t.slice(0,i), q={}; if(i>=0) for(const kv of t.slice(i+1).split("&")){ const j=kv.indexOf("="); if(j>0) q[decodeURIComponent(kv.slice(0,j))]=decodeURIComponent(kv.slice(j+1)); } return {path,q}; }
  const J=(o,status)=>({status:status||200,text:JSON.stringify(o)});
  async function handle(method,target,body){
    try{
      const {path,q}=parseTarget(target);
      if(!hosting||!code) return J({error:"not hosting"},503);
      if(q.c!==code){ bad++; if(bad>=25) stopHost(); return J({error:"bad code"},403); }
      if(onHostActivity) onHostActivity("busy");
      if(path==="/ping") return J({ok:true,name:Sync.deviceName(),v:1});
      if(path==="/state") return J(await localState());
      if(path==="/bookinfo"){ const d=await DB.getDoc(q.id); if(!d) return J({error:"no such book"},404); const {blob,...rest}=d; return J({rest,bsize:blob?blob.size:0}); }
      if(path==="/book"){
        if(bookCache.id!==q.id){ const d=await DB.getDoc(q.id); bookCache={id:q.id,blob:d&&d.blob||null}; }
        const b=bookCache.blob, off=+q.off||0, len=+q.len||CH; if(!b||off>=b.size) return {status:200,text:""};
        return {status:200,text:toB64(new Uint8Array(await b.slice(off,Math.min(b.size,off+len)).arrayBuffer()))};
      }
      if(path==="/apply" && method==="POST"){ const n=await apply(JSON.parse(body)); if(onHostActivity) onHostActivity("applied",n); return J({ok:true,n}); }
      if(path==="/bookbegin" && method==="POST"){ const o=JSON.parse(body); incoming[q.id]={rest:o.rest,bsize:o.bsize,parts:[],got:0}; return J({ok:true}); }
      if(path==="/bookchunk" && method==="POST"){ const s=incoming[q.id]; if(!s) return J({error:"no upload"},409); if(+q.off!==s.got) return J({error:"out of order",got:s.got},409); const u=fromB64(body); s.parts.push(u); s.got+=u.length; return J({ok:true,got:s.got}); }
      if(path==="/bookend" && method==="POST"){ const s=incoming[q.id]; if(!s) return J({error:"no upload"},409); delete incoming[q.id];
        if(s.got!==s.bsize) return J({error:"size mismatch"},409);
        const doc=Object.assign({},s.rest); if(s.bsize) doc.blob=new Blob(s.parts,{type:s.rest.type||""}); await DB.putDoc(doc); await DB.untomb("docs",q.id).catch(()=>{});
        if(onHostActivity) onHostActivity("book",s.rest.name); return J({ok:true}); }
      return J({error:"unknown"},404);
    }catch(e){ return J({error:String(e&&e.message||e)},500); }
  }

  /* ----- native server control ----- */
  function newCode(){ const a=new Uint32Array(1); (crypto.getRandomValues?crypto.getRandomValues(a):(a[0]=Math.random()*4294967295)); return String(100000+(a[0]%900000)); }
  async function startHost(kind){
    if(kind==="bt"){
      const r=await Native.btStart(); if(!r||r.error||!r.ok) throw new Error((r&&r.error)||"Couldn't start Bluetooth sync.");
      hosting=true; code=newCode(); bad=0; Native.keepOn(true);
      return {code, addrs:["Bluetooth: this device shows up as “"+(r.name||"this device")+"”"], bt:true};
    }
    const r=await Native.syncStart(); if(!r||!r.port) throw new Error("Couldn't start the sync listener on this device.");
    hostInfo=r; hosting=true; code=newCode(); bad=0; Native.keepOn(true);
    return {code, addrs:(r.ips&&r.ips.length?r.ips:["(no Wi-Fi address found)"]).map(ip=>ip+":"+r.port), port:r.port};
  }
  function stopHost(){ hosting=false; code=null; hostInfo=null; bad=0; for(const k in incoming) delete incoming[k]; bookCache={id:null,blob:null}; try{ Native.syncStop(); Native.btStop(); }catch(e){} Native.keepOn(false); if(onHostActivity) onHostActivity("stopped"); }

  /* ----- client side ----- */
  let transport=async(addr,method,target,body)=>{
    if(addr.indexOf("bt:")===0) return Native.btRequest(addr.slice(3),method,target,body);
    const ac=new AbortController(), to=setTimeout(()=>ac.abort(),120000);
    try{ const r=await fetch("http://"+addr+target,{method,body:method==="POST"?body:undefined,headers:method==="POST"?{"Content-Type":"text/plain"}:undefined,signal:ac.signal,cache:"no-store"}); return {status:r.status,text:await r.text()}; }
    finally{ clearTimeout(to); }
  };
  function normAddr(a){ a=String(a||"").trim(); if(/^bt:/i.test(a)) return "bt:"+a.slice(3).trim(); a=a.replace(/^https?:\/\//i,"").replace(/\/.*$/,""); if(!a) return ""; return /:\d+$/.test(a)?a:a+":"+PORT_HINT; }
  async function sync(addrIn,codeIn,progress,choose){
    if(running) throw new Error("A sync is already running."); running=true;
    const say=(m,f)=>{ try{ progress&&progress(m,f); }catch(e){} };
    try{
      const addr=normAddr(addrIn), c=String(codeIn||"").trim(); if(!addr) throw new Error("Enter the other device's address."); if(!/^\d{6}$/.test(c)) throw new Error("The code is 6 digits.");
      const call=async(method,path,params,body)=>{
        const qs="?c="+c+Object.keys(params||{}).map(k=>"&"+k+"="+encodeURIComponent(params[k])).join("");
        let r; try{ r=await transport(addr,method,path+qs,body); }catch(e){ if(addr.indexOf("bt:")===0) throw new Error("Bluetooth: "+String(e&&e.message||e)+". Pair the devices first, and on the phone tap “Wait over Bluetooth”."); throw new Error("Couldn't reach "+addr+". Both devices must be on the same Wi-Fi, and the other one must be showing its sync code."); }
        if(r.status===403) throw new Error("That code isn't right. Check the code shown on the other device.");
        if(r.status===503) throw new Error("The other device isn't waiting for a sync. Tap \"Show my sync code\" there first.");
        if(r.status!==200){ let m=""; try{ m=JSON.parse(r.text).error; }catch(e){} throw new Error("The other device reported an error"+(m?": "+m:"")+"."); }
        return r.text;
      };
      const callJ=async(...a)=>JSON.parse(await call(...a));
      say("Connecting…",0); const hi=await callJ("GET","/ping");
      say("Comparing libraries…",.05);
      const remote=await callJ("GET","/state"), local=await localState();
      const toLocal=need(remote,local), toRemote=need(local,remote);
      if(choose){
        const nm=(docs,id)=>{ const d=docs.find(x=>x.id===id); return {id,name:(d&&d.name)||"book",size:(d&&d.size)||0}; };
        const plan={ peer:hi.name||"other device", incoming:toLocal.books.map(i=>nm(remote.docs,i)), outgoing:toRemote.books.map(i=>nm(local.docs,i)),
          delIn:toLocal.delDocs.map(i=>nm(local.docs,i)), delOut:toRemote.delDocs.map(i=>nm(remote.docs,i)),
          posIn:toLocal.meta.length, posOut:toRemote.meta.length, noteIn:toLocal.ann.length+toLocal.ink.length+toLocal.delAnn.length+toLocal.delInk.length, noteOut:toRemote.ann.length+toRemote.ink.length+toRemote.delAnn.length+toRemote.delInk.length };
        const sel=await choose(plan); if(!sel) throw new Error("__cancel__");
        for(const [ch,books,dels] of [[toLocal,sel.incoming,sel.delIn],[toRemote,sel.outgoing,sel.delOut]]){
          const all=new Set(ch.books), off=new Set(ch.books.filter(i=>!books.has(i)));
          ch.books=ch.books.filter(i=>books.has(i)); ch.delDocs=ch.delDocs.filter(i=>dels.has(i));
          ch.meta=ch.meta.filter(m=>!off.has(m.id)); ch.ann=ch.ann.filter(a=>!off.has(a.docId)); ch.ink=ch.ink.filter(k=>!off.has(k.docId));
          if(!sel.positions) ch.meta=[];
          if(!sel.notes){ ch.ann=[]; ch.ink=[]; ch.delAnn=[]; ch.delInk=[]; }
        }
      }
      const sum={booksIn:0,booksOut:0,meta:0,notes:0,deleted:0,peer:hi.name||"other device"};
      const totalBooks=toLocal.books.length+toRemote.books.length; let doneBooks=0;
      const bookFrac=(f)=>.1+.8*((doneBooks+f)/Math.max(1,totalBooks));
      for(const id of toLocal.books){
        const nm=(remote.docs.find(d=>d.id===id)||{}).name||"book"; say("Receiving “"+nm+"”…",bookFrac(0));
        const info=await callJ("GET","/bookinfo",{id}); const parts=[]; let off=0;
        while(off<info.bsize){ const t=await call("GET","/book",{id,off,len:CH}); if(!t) break; const u=fromB64(t); parts.push(u); off+=u.length; say("Receiving “"+nm+"” "+Math.round(off/1048576)+" MB…",bookFrac(info.bsize?off/info.bsize:1)); await new Promise(r=>setTimeout(r,0)); }
        if(off!==info.bsize) throw new Error("“"+nm+"” didn't arrive completely. Try again.");
        const doc=Object.assign({},info.rest); if(info.bsize) doc.blob=new Blob(parts,{type:info.rest.type||""});
        await DB.putDoc(doc); await DB.untomb("docs",id).catch(()=>{}); doneBooks++; sum.booksIn++;
      }
      for(const id of toRemote.books){
        const d=await DB.getDoc(id); if(!d) continue; const {blob,...rest}=d, size=blob?blob.size:0; say("Sending “"+(d.name||"book")+"”…",bookFrac(0));
        await call("POST","/bookbegin",{id},JSON.stringify({rest,bsize:size}));
        for(let off=0;off<size;off+=CH){ const u=new Uint8Array(await blob.slice(off,Math.min(size,off+CH)).arrayBuffer()); await call("POST","/bookchunk",{id,off},toB64(u)); say("Sending “"+(d.name||"book")+"” "+Math.round((off+u.length)/1048576)+" MB…",bookFrac((off+u.length)/size)); await new Promise(r=>setTimeout(r,0)); }
        await call("POST","/bookend",{id}); doneBooks++; sum.booksOut++;
      }
      say("Merging progress and notes…",.92);
      const nl=await apply(toLocal); const nr=(await callJ("POST","/apply",{},JSON.stringify(toRemote))).n||{};
      sum.meta=nl.meta+(nr.meta||0); sum.notes=nl.ann+nl.ink+(nr.ann||0)+(nr.ink||0); sum.deleted=nl.del+(nr.del||0);
      try{ await DB.setMeta(SETS,{syncPeer:addr,lastSync:Date.now()}); }catch(e){}
      try{ Shelf.render(); }catch(e){}
      say("Done",1); return sum;
    } finally{ running=false; try{ if(String(addrIn||"").trim().toLowerCase().indexOf("bt:")===0) Native.btClose(); }catch(e){} }
  }

  return {
    deviceName(){ return Native.desktop?"Mac":(Native.has?"Android":"Browser"); },
    available(){ return Native.has||Native.desktop; }, btHost(){ return Native.has; }, btClient(){ return Native.desktop; },
    startHost, stopHost, sync, handle, localState, need, apply, normAddr,
    isHosting:()=>hosting, setActivity(fn){ onHostActivity=fn; },
    _test:{ setCode(c){ code=c; hosting=true; }, setTransport(fn){ transport=fn; }, fromB64, toB64 }
  };
})();

/* ----- bridge entry points used by the native servers ----- */
window.__lrSyncHandle=async(method,target,body)=>{ const r=await Sync.handle(method,target,body||""); return [r.status,r.text]; };        // macOS: result returned directly
window.__lrSyncDispatch=async(id,method,target)=>{ let r; try{ r=await Sync.handle(method,target,method==="POST"?AndroidBridge.syncBody(id):""); }catch(e){ r={status:500,text:"{}"}; } AndroidBridge.syncReply(id,r.status,r.text); };   // Android: reply via bridge

/* ----- the Sync window ----- */
(function(){
  const modal=$("#syncModal"); if(!modal) return;
  const st=$("#syncStatus"), bar=$("#syncBar i");
  const setSt=(m,f)=>{ st.textContent=m||""; if(f!=null) bar.style.width=Math.round(f*100)+"%"; };
  let hostBusy=false;
  Sync.setActivity((what,x)=>{
    if(what==="busy") setSt("Another device is syncing with this one…");
    else if(what==="applied"){ setSt("Synced. This device is still waiting — tap Stop when you're done."); try{ Shelf.render(); }catch(e){} }
    else if(what==="book") setSt("Received “"+x+"”…");
    else if(what==="stopped"){ $("#syncHostOn").hidden=true; $("#syncHostOff").hidden=false; }
  });
  async function open(){
    closeMoreMenu(); modal.hidden=false; setSt("",0);
    if(!Sync.available()){ $("#syncBody").hidden=true; $("#syncNone").hidden=false; return; }
    $("#syncBody").hidden=false; $("#syncNone").hidden=true;
    $("#syncBtHostBtn").hidden=!Sync.btHost(); $("#syncBtRow").hidden=!Sync.btClient(); if(Sync.btClient()) fillBt();
    try{ const m=await DB.getMeta("__settings__"); if(m&&m.syncPeer&&!$("#syncAddrIn").value) $("#syncAddrIn").value=m.syncPeer; if(m&&m.lastSync) setSt("Last synced "+new Date(m.lastSync).toLocaleString()+(m.syncPeer?" with "+m.syncPeer:"")); }catch(e){}
  }
  function close(){ if(Sync.isHosting()) Sync.stopHost(); modal.hidden=true; }
  $("#syncMenuBtn").onclick=open; $("#syncClose").onclick=close;
  modal.addEventListener("click",(e)=>{ if(e.target===modal) close(); });
  $("#syncHostBtn").onclick=async()=>{
    if(hostBusy) return; hostBusy=true;
    try{ const r=await Sync.startHost(); $("#syncAddr").textContent=r.addrs.join("\n"); $("#syncCode").textContent=r.code; $("#syncHostOn").hidden=false; $("#syncHostOff").hidden=true; setSt("Waiting for the other device… keep this window open."); }
    catch(e){ setSt(String(e&&e.message||e)); } finally{ hostBusy=false; }
  };
  $("#syncBtHostBtn").onclick=async()=>{
    if(hostBusy) return; hostBusy=true;
    try{ const r=await Sync.startHost("bt"); $("#syncAddr").textContent=r.addrs.join("\n"); $("#syncCode").textContent=r.code; $("#syncHostOn").hidden=false; $("#syncHostOff").hidden=true; setSt("Waiting for your Mac… it must already be paired with this phone. Keep this window open."); }
    catch(e){ setSt(String(e&&e.message||e)); } finally{ hostBusy=false; }
  };
  async function fillBt(){
    const sel=$("#syncBtSel"); sel.innerHTML=""; const o0=el("option"); o0.value=""; o0.textContent="Choose a paired phone…"; sel.appendChild(o0);
    const list=await Native.btList(); list.forEach(d=>{ const o=el("option"); o.value=d.addr; o.textContent=d.name||d.addr; sel.appendChild(o); });
    if(!list.length) setSt("No paired Bluetooth devices found. Pair your phone in System Settings › Bluetooth first.");
  }
  $("#syncBtSel").onchange=(e)=>{ if(e.target.value) $("#syncAddrIn").value="bt:"+e.target.value; };
  $("#syncBtRefresh").onclick=fillBt;
  $("#syncHostStop").onclick=()=>{ Sync.stopHost(); setSt(""); };
  const fmt=(n)=>n>=1048576?(n/1048576).toFixed(1)+" MB":Math.max(1,Math.round(n/1024))+" KB";
  function choose(plan){
    return new Promise((resolve)=>{
      const box=$("#syncPlan"); box.innerHTML=""; const boxes=document.querySelectorAll("#syncBody .syncBox"); boxes.forEach(b=>b.hidden=true); box.hidden=false;
      const groups=[];
      const sec=(title,items,kind)=>{ if(!items.length) return; const h=el("div","planHead"); const t=el("b"); t.textContent=title+" ("+items.length+")"; h.appendChild(t);
        const all=el("button","planAll"); all.textContent="None"; h.appendChild(all); box.appendChild(h); const rows=[];
        items.forEach(it=>{ const l=el("label","planRow"); const c=el("input"); c.type="checkbox"; c.checked=true; const sp=el("span"); sp.textContent=it.name+(it.size?"  ·  "+fmt(it.size):""); l.appendChild(c); l.appendChild(sp); box.appendChild(l); rows.push([c,it.id]); });
        all.onclick=()=>{ const on=all.textContent==="All"; rows.forEach(r=>r[0].checked=on); all.textContent=on?"None":"All"; };
        groups.push([kind,rows]); };
      sec("Books to receive from "+plan.peer,plan.incoming,"incoming"); sec("Books to send to "+plan.peer,plan.outgoing,"outgoing");
      sec("Books to remove here (deleted on "+plan.peer+")",plan.delIn,"delIn"); sec("Books to remove on "+plan.peer+" (deleted here)",plan.delOut,"delOut");
      const opt=(label,n,m)=>{ const l=el("label","planRow"); const c=el("input"); c.type="checkbox"; c.checked=true; const sp=el("span"); sp.textContent=label+" — "+n+" in, "+m+" out"; l.appendChild(c); l.appendChild(sp); box.appendChild(l); return c; };
      const hh=el("div","planHead"); const tt=el("b"); tt.textContent="Also merge"; hh.appendChild(tt); box.appendChild(hh);
      const cp=opt("Reading positions, finished & bookmarks",plan.posIn,plan.posOut), cn=opt("Highlights, notes & drawings",plan.noteIn,plan.noteOut);
      const act=el("div","modalActions"); const cancel=el("button"); cancel.textContent="Cancel"; const go=el("button","btn-accent"); go.textContent="Sync selected"; act.appendChild(cancel); act.appendChild(el("span","grow")); act.appendChild(go); box.appendChild(act);
      const done=(v)=>{ box.hidden=true; box.innerHTML=""; boxes.forEach(b=>b.hidden=false); resolve(v); };
      cancel.onclick=()=>done(null);
      go.onclick=()=>{ const sel={incoming:new Set(),outgoing:new Set(),delIn:new Set(),delOut:new Set(),positions:cp.checked,notes:cn.checked}; groups.forEach(g=>g[1].forEach(r=>{ if(r[0].checked) sel[g[0]].add(r[1]); })); done(sel); };
      if(!plan.incoming.length&&!plan.outgoing.length&&!plan.delIn.length&&!plan.delOut.length&&!plan.posIn&&!plan.posOut&&!plan.noteIn&&!plan.noteOut){ done({incoming:new Set(),outgoing:new Set(),delIn:new Set(),delOut:new Set(),positions:true,notes:true}); }
      else setSt("Choose what to sync.",.1);
    });
  }
  $("#syncGo").onclick=async()=>{
    const b=$("#syncGo"); b.disabled=true;
    try{ const s=await Sync.sync($("#syncAddrIn").value,$("#syncCodeIn").value,setSt,choose);
      const bits=[]; if(s.booksIn) bits.push(s.booksIn+" book"+(s.booksIn>1?"s":"")+" received"); if(s.booksOut) bits.push(s.booksOut+" sent"); if(s.meta) bits.push(s.meta+" position/bookmark update"+(s.meta>1?"s":"")); if(s.notes) bits.push(s.notes+" highlight/note change"+(s.notes>1?"s":"")); if(s.deleted) bits.push(s.deleted+" removed");
      setSt("Synced with "+s.peer+(bits.length?": "+bits.join(", ")+".":" — everything was already up to date."),1);
    }catch(e){ setSt(e&&e.message==="__cancel__"?"Sync cancelled — nothing was changed.":String(e&&e.message||e),0); }
    finally{ b.disabled=false; }
  };
})();
