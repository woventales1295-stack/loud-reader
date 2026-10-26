/* =====================================================================
   Reading layer (v2.2) -- reading position, appearance, chrome, zoom,
   contents / bookmarks / search / stats, auto-scroll, audio dock.

   Core idea: the READING position (what is at the top of your screen) is
   separate from the AUDIO cursor (where the voice is). Zoom, font, margin or
   window changes re-anchor to the reading position; the voice only moves the
   page while "follow" is on and you haven't scrolled away on your own.
   ===================================================================== */
const FONT_STACKS = {
  sans:  '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari",Helvetica,Arial,sans-serif',
  serif: 'Georgia,"Noto Serif","Droid Serif","Noto Serif Devanagari",Cambria,"Times New Roman",serif',
  book:  'Charter,"Bitstream Charter","Iowan Old Style",Palatino,"Palatino Linotype","Noto Serif","Noto Serif Devanagari",Georgia,serif',
  mono:  '"Noto Sans Mono","Droid Sans Mono",Menlo,Consolas,"Courier New",monospace'
};
const THEME_LIST = [
  { id:"light", name:"Light", bg:"#f3f5f9", fg:"#1a2230" },
  { id:"sepia", name:"Sepia", bg:"#f4ecd8", fg:"#433422" },
  { id:"gray",  name:"Paper", bg:"#dcdcdc", fg:"#1d1d1d" },
  { id:"dark",  name:"Dark",  bg:"#0f1216", fg:"#e7ecf3" },
  { id:"black", name:"Black", bg:"#000000", fg:"#cfd3da" }
];
const RS_DEFAULT = { font:"sans", fs:20, lh:1.8, ps:1.0, mx:6, align:"left", hyphen:false, dim:0, warm:0,
  tapZones:true, volKeys:false, keepOn:true, tapWordRead:false, dimRead:false, pdfZoom:1, autoSpeed:6, flip:false };
const RS = Object.assign({}, RS_DEFAULT);
const HDR_H = 56;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- toast ---------------- */
let _toastT = 0;
function toast(msg, ms){
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(_toastT); _toastT = setTimeout(()=>{ t.hidden = true; }, ms || 2200);
}
// Status line messages become toasts while reading (the status bar itself is hidden then).
new MutationObserver(()=>{
  if (!document.body.classList.contains("reading")) return;
  const m = $("#status").textContent; if (m) toast(m, 2600);
}).observe($("#status"), { childList:true, characterData:true, subtree:true });

/* ---------------- audio follow ---------------- */
const Follow = {
  on:true, userScrollT:0,
  shouldScroll(){ return Speech.playing && this.on; },
  setOn(v){
    this.on = !!v; $("#followChip").hidden = this.on || !Speech.playing;
    const c = $("#followChk"); if (c) c.checked = this.on;
  },
  userScrolled(){
    if (!Speech.playing) return;
    if (this.on) this.setOn(false);
    clearTimeout(this.userScrollT);
    // once the reader settles with the spoken word back on screen, quietly re-attach
    this.userScrollT = setTimeout(()=>{
      if ($("#followChk").checked && Speech.playing && Reading.isWordVisible(Speech.cursor, true)) this.setOn(true);
    }, 900);
  },
  goBack(){
    this.setOn(true);
    if (Speech.cursor != null) Reading.goToWord(Speech.cursor, { smooth:true, noAudio:true });
  }
};
$("#followBtn").onclick = () => Follow.goBack();
$("#followChk").onchange = (e) => { if (e.target.checked) Follow.goBack(); else Follow.setOn(false); };

/* ---------------- reading position ---------------- */
const Reading = {
  pos:0, anchor:null, suspend:0, lastScrollTop:0, userTouching:false,
  chapters:null, chapIdx:-1, bookmarks:[], marksLoadedFor:null,
  readSecs:0, readWords:0, sessWords:0, lastActive:0, lastTick:0, lastPos:0,
  searchHits:[], searchIdx:-1, searchQuery:"",

  rd(){ return $("#reader"); },
  chromeHidden(){ return document.body.classList.contains("chrome-hidden"); },
  inset(){ return 8 + ((document.body.classList.contains("reading") && !this.chromeHidden()) ? HDR_H : 0); },
  topLine(){ return this.rd().getBoundingClientRect().top + this.inset(); },

  /* --- measuring: what is at the top of the screen? --- */
  _firstPageBelow(line){
    const n = Reader.totalPages || Object.keys(Reader.pageWrappers).length; let lo = 1, hi = n, ans = n;
    while (lo <= hi){
      const mid = (lo + hi) >> 1, w = Reader.pageWrappers[mid]; if (!w){ lo = mid + 1; continue; }
      if (w.getBoundingClientRect().bottom > line){ ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return ans;
  },
  wordForPageFrac(p, frac){
    const ptH = Reader.pagePtHeight[p] || 792, y0 = frac * ptH;
    let i = Reader.pageStartWord[p];
    if (i == null) return Reader.wordIndexForPage(p) || 0;
    for (; i < Reader.words.length && Reader.words[i].page === p; i++){
      const w = Reader.words[i]; if (w.y != null && w.y + w.h * 0.6 >= y0) return i;
    }
    return clamp(i - 1, 0, Reader.words.length - 1);
  },
  measure(){
    if (!Reader.words.length) return null;
    if (Pager.on){
      const i = Pager.firstWord(Pager.idx);
      return Reader.mode === "pdf" ? { mode:"pdf", p:Pager.idx + 1, frac:0, i } : { mode:"text", i, off:0 };
    }
    const line = this.topLine();
    if (Reader.mode === "pdf"){
      const p = this._firstPageBelow(line), w = Reader.pageWrappers[p]; if (!w) return null;
      const r = w.getBoundingClientRect();
      const frac = clamp((line - r.top) / Math.max(1, r.height), 0, 0.999);
      return { mode:"pdf", p, frac, i:this.wordForPageFrac(p, frac) };
    }
    let lo = 0, hi = Reader.words.length - 1, ans = Reader.words.length - 1;
    while (lo <= hi){
      const mid = (lo + hi) >> 1, s = Reader.words[mid].span; if (!s){ hi = mid - 1; continue; }
      if (s.getBoundingClientRect().bottom > line + 1){ ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    const s = Reader.words[ans].span;
    return { mode:"text", i:ans, off: s ? s.getBoundingClientRect().top - line : 0 };
  },
  restoreAnchor(a){
    if (!a || !Reader.words.length) return;
    if (Pager.on){ Pager.showAnchor(a); return; }
    const rd = this.rd(), line = this.topLine();
    this.suspend++;
    try{
      if (a.mode === "pdf" && Reader.mode === "pdf"){
        const w = Reader.pageWrappers[a.p]; if (!w) return;
        const r = w.getBoundingClientRect();
        rd.scrollTop += (r.top + a.frac * r.height) - line;
      } else if (Reader.mode === "text"){
        const s = Reader.words[clamp(a.i, 0, Reader.words.length - 1)].span; if (!s) return;
        rd.scrollTop += (s.getBoundingClientRect().top - (line + (a.off || 0)));
      }
    } finally { requestAnimationFrame(()=>{ this.suspend = Math.max(0, this.suspend - 1); }); }
  },
  // Run a layout-changing function while keeping the same text at the top of the screen.
  withAnchor(fn){
    if (Pager.on){ const pa = this.measure() || this.anchor; fn(); Pager.relayout(pa); return; }
    const a = this.measure() || this.anchor;
    fn();
    if (a) this.restoreAnchor(a);
    // late reflow (fonts, images, async canvases): re-assert once more next frame
    requestAnimationFrame(()=>{ if (a) this.restoreAnchor(a); });
  },

  /* --- scrolling to things --- */
  goToWord(i, opts){
    opts = opts || {};
    if (!Reader.words.length) return;
    i = clamp(i, 0, Reader.words.length - 1);
    if (Pager.on){
      Pager.goto(Pager.pageOfWord(i), !!opts.smooth);
      this.pos = i;
      if (!opts.noAudio && Speech.playing){ Speech.jump(Reader.sentStart[i]); }
      else if (!opts.noAudio){ Speech.cursor = Reader.sentStart[i]; }
      this.updateProgressUI(); return;
    }
    const rd = this.rd(), line = this.topLine() + 4; let top = null;
    if (Reader.mode === "pdf"){
      const w = Reader.words[i], p = w.page != null ? w.page : 1, wr = Reader.pageWrappers[p]; if (!wr) return;
      const r = wr.getBoundingClientRect(), ptH = Reader.pagePtHeight[p] || 792;
      const y = (w.y != null) ? (w.y / ptH) * r.height : 0;
      top = rd.scrollTop + (r.top + Math.max(0, y - 28)) - line;
    } else {
      const s = Reader.words[i].span; if (!s) return;
      top = rd.scrollTop + (s.getBoundingClientRect().top - line);
    }
    this.suspend++;
    rd.scrollTo({ top:Math.max(0, top), behavior: opts.smooth ? "smooth" : "auto" });
    setTimeout(()=>{ this.suspend = Math.max(0, this.suspend - 1); this.update(true); }, opts.smooth ? 450 : 30);
    this.pos = i;
    if (!opts.noAudio && Speech.playing){ Speech.jump(Reader.sentStart[i]); }
    else if (!opts.noAudio){ Speech.cursor = Reader.sentStart[i]; }
    this.updateProgressUI();
  },
  flipActive(){ return Pager.on; },
  pageTurn(dir){
    if (Pager.on){ Pager.turn(dir); return; }
    const rd = this.rd(), h = rd.clientHeight - this.inset() - 28;
    if (Reader.mode === "pdf"){
      rd.scrollBy({ top: dir * h * 0.92, behavior:"smooth" }); return;
    }
    // text: land on a clean line instead of slicing a line in half
    const line = this.topLine();
    if (dir > 0){
      const a = this.measure(); let i = a ? a.i : 0, guard = 0;
      const limit = line + h * 0.94;
      let lo = i, hi = Reader.words.length - 1, ans = hi;
      while (lo <= hi){ const mid = (lo + hi) >> 1, s = Reader.words[mid].span; if (!s){ hi = mid - 1; continue; }
        if (s.getBoundingClientRect().top >= limit - 2){ ans = mid; hi = mid - 1; } else lo = mid + 1; }
      const s = Reader.words[ans].span; if (!s) return;
      rd.scrollBy({ top: s.getBoundingClientRect().top - line - 2, behavior:"smooth" });
    } else rd.scrollBy({ top: -h * 0.94, behavior:"smooth" });
  },

  /* --- visible? --- */
  isWordVisible(i, strict){
    const w = Reader.words[i]; if (!w) return false;
    if (Pager.on) return Pager.pageOfWord(i) === Pager.idx;
    const r = this.rd().getBoundingClientRect(), top = r.top + (strict ? this.inset() : 0), bot = r.bottom - (strict ? 60 : 0);
    if (Reader.mode === "pdf"){
      const wr = Reader.pageWrappers[w.page]; if (!wr) return false;
      const pr = wr.getBoundingClientRect(), ptH = Reader.pagePtHeight[w.page] || 792;
      const y = pr.top + (w.y != null ? (w.y / ptH) * pr.height : 0);
      return y >= top && y <= bot;
    }
    if (!w.span) return false;
    const sr = w.span.getBoundingClientRect(); return sr.bottom > top && sr.top < bot;
  },
  // where read-aloud should begin when you press play: the sentence at the top of the screen
  audioStartIndex(){
    const cur = Speech.cursor || 0;
    if (this.isWordVisible(cur, true)) return Reader.sentStart[cur] != null ? Reader.sentStart[cur] : cur;
    const p = this.pos || 0, s = Reader.sentStart[p];
    if (s === p || s == null) return p;
    return (Reader.sentEnd[p] + 1 < Reader.words.length) ? Reader.sentEnd[p] + 1 : p;
  },

  /* --- scroll tracking --- */
  update(force){
    if (this.suspend && !force) return;
    const a = this.measure(); if (!a) return;
    this.anchor = a; const old = this.pos; this.pos = a.i;
    const d = a.i - old;
    if (d > 0 && d < 1500){ this.readWords += d; this.sessWords += d; }
    this.lastActive = Date.now();
    this.updateProgressUI();
    saveProgress();
  },
  updateProgressUI(){
    const n = Reader.words.length; if (!n) return;
    const i = clamp(this.pos, 0, n - 1);
    const seek = $("#seek");
    if (!this._scrubbing){ seek.max = Math.max(0, n - 1); seek.value = i; }
    const pct = n > 1 ? Math.round((i / (n - 1)) * 100) : 100;
    const left = this.minutesLeft();
    $("#posLabel").textContent = pct + "%";
    let hint = "";
    if (Pager.on){ hint = "Page " + (Pager.idx + 1) + " of " + Pager.count; }
    else if (Reader.totalPages > 1){
      const pg = Reader.mode === "pdf" ? (this.anchor && this.anchor.p) : (Reader.words[i] && Reader.words[i].page);
      if (pg) hint = "Page " + pg + " of " + Reader.totalPages;
    }
    if (left != null) hint += (hint ? " · " : "") + (left < 1 ? "<1 min left" : (left >= 90 ? Math.round(left / 6) / 10 + " h left" : Math.round(left) + " min left"));
    $("#wordHint").textContent = hint;
    const pi = $("#pageInput"); if (pi && Reader.totalPages > 1 && document.activeElement !== pi){
      const pg = Reader.mode === "pdf" ? (this.anchor && this.anchor.p) : (Reader.words[i] && Reader.words[i].page); if (pg) pi.value = pg; }
    this.updateChapter(i);
    this.updateBookmarkBtn();
  },
  wpm(){ return (this.readSecs > 150 && this.readWords > 300) ? clamp(this.readWords / (this.readSecs / 60), 90, 600) : 230; },
  minutesLeft(){ const n = Reader.words.length; if (!n) return null; return Math.max(0, (n - 1 - this.pos) / this.wpm()); },

  /* --- chapters (outline when the file has one, otherwise a careful guess) --- */
  async getChapters(){
    if (this.chapters) return this.chapters;
    let list = [];
    try{ if (currentDoc && extOf(currentDoc.name) === "pdf") list = await this._pdfOutline(); }catch(e){ list = []; }
    if (list.length < 2){
      const toc = currentDoc && currentDoc._ctx && currentDoc._ctx.toc;
      if (toc && toc.length && Reader.blockWord){
        list = toc.map(t => ({ title:t.title, i:Reader.blockWord[t.blk], lvl:t.lvl })).filter(t => t.i != null && t.i < Reader.words.length);
        // an entry that points past the last word of its block (e.g. an image-only page) belongs to the next word
      }
    }
    if (list.length < 2) list = this._headingChapters();
    if (list.length < 2) list = this._guessChapters();
    list.sort((a, b) => a.i - b.i);
    this.chapters = list; return list;
  },
  async _pdfOutline(){
    const pdf = await openPageSource(currentDoc), out = [];
    try{
      const ol = pdf.getOutline ? await pdf.getOutline() : null; if (!ol) return out;
      const walk = async (items, lvl) => {
        for (const it of items){
          if (out.length > 600) return;
          try{
            let dest = it.dest; if (typeof dest === "string") dest = await pdf.getDestination(dest);
            if (Array.isArray(dest)){
              const pg = (await pdf.getPageIndex(dest[0])) + 1, wi = Reader.wordIndexForPage(pg);
              if (wi != null && it.title) out.push({ title:String(it.title).trim(), i:wi, lvl, page:pg });
            }
          }catch(e){}
          if (it.items && it.items.length) await walk(it.items, Math.min(lvl + 1, 3));
        }
      };
      await walk(ol, 1);
    } finally { try{ pdf.destroy(); }catch(e){} }
    return out;
  },
  // chapters from real headings (h1-h3) when the book has them but no table of contents
  _headingChapters(){
    const bl = Reader.blocks || [], W = Reader.words;
    for (const lv of ["h1", "h2", "h3"]){
      const hits = bl.filter(B => B.kind === lv && !W[B.first].skip);
      if (hits.length >= 2){
        return hits.map(B => ({ title: W.slice(B.first, B.first + Math.min(B.n, 14)).map(w => w.text).join(" "), i:B.first, lvl:1 }));
      }
    }
    return [];
  },
  _guessChapters(){
    const W = Reader.words, out = [], n = W.length;
    const rx = /^(chapter|part|book|section|prologue|epilogue|introduction|preface|foreword|afterword|appendix|acknowledg|contents|canto|act|scene|volume|adhyay|अध्याय|भाग|खंड|प्रस्तावना)\b/i;
    let start = 0;
    for (let k = 0; k < n; k++){
      if (!(k === n - 1 || W[k].blockEnd)) continue;
      const len = k - start + 1;
      if (len <= 12){
        const txt = W.slice(start, k + 1).map(w => w.text).join(" ").trim();
        const letters = txt.replace(/[^A-Za-z]/g, "");
        const allCaps = letters.length >= 4 && letters === letters.toUpperCase() && txt.length <= 60;
        const md = /^#{1,6}$/.test(W[start].text) || /^#{1,6}\S/.test(W[start].text);
        if (!W[start].skip && txt.length <= 80 && (rx.test(txt) || allCaps || md || /^[IVXLC]{1,6}\.?$/.test(txt) || /^\d{1,3}[.)]?(\s+\S.*)?$/.test(txt) && len <= 8)){
          out.push({ title: txt.replace(/^#{1,6}\s*/, ""), i:start, lvl:1 });
        }
      }
      start = k + 1;
    }
    // collapse accidental runs (e.g. "1" "2" "3" page numbers) -- keep only if reasonably spaced
    const keep = []; let last = -1e9;
    out.forEach(c => { if (c.i - last >= 120) { keep.push(c); last = c.i; } });
    return keep.length >= 2 ? keep : [];
  },
  updateChapter(i){
    const ch = this.chapters; let label = "";
    if (ch && ch.length){
      let lo = 0, hi = ch.length - 1, ans = -1;
      while (lo <= hi){ const m = (lo + hi) >> 1; if (ch[m].i <= i + 2){ ans = m; lo = m + 1; } else hi = m - 1; }
      this.chapIdx = ans; if (ans >= 0) label = ch[ans].title;
    }
    $("#chapLabel").textContent = label;
    $("#hdrSub").textContent = label || ($("#posLabel").textContent || "");
  },

  /* --- restore on open --- */
  restore(meta){
    const willPage = !!RS.flip && Reader.words.length > 0 && !(typeof Ink !== "undefined" && Ink.active);
    const rd = this.rd(); if (!willPage){ rd.scrollTop = 0; rd.scrollLeft = 0; }
    this.chapters = null; this.chapIdx = -1; this.anchor = null;
    this.readSecs = (meta && meta.readSecs) || 0; this.readWords = (meta && meta.readWords) || 0; this.sessWords = 0;
    this.clearSearch(); this.bookmarks = (meta && meta.bookmarks) || []; this.marksLoadedFor = UI.activeId;
    const p = meta && meta.progress > 0 && meta.progress < Reader.words.length ? meta.progress : 0;
    this.pos = p; this.lastPos = p;
    const go = () => { if (p > 0) this.goToWord(p, { noAudio:true }); else this.update(true); this.updateProgressUI(); };
    if (willPage){ this._justRestored = true; }   // the pager lays the book out and goes to this.pos itself
    else { go(); requestAnimationFrame(go); setTimeout(go, 220); }   // layout (fonts/canvases) can settle late
    this.getChapters().then(()=>this.updateProgressUI()).catch(()=>{});
  },

  /* --- bookmarks --- */
  visibleRange(){
    const a = this.measure(); if (!a) return [0, 0];
    const rd = this.rd().getBoundingClientRect(); let b = a.i;
    if (Reader.mode === "pdf"){
      const p = this._firstPageBelow(rd.bottom - 4); b = Reader.words.length ? this.wordForPageFrac(p, 0.999) : a.i;
    } else {
      let lo = a.i, hi = Reader.words.length - 1, ans = hi;
      while (lo <= hi){ const m = (lo + hi) >> 1, s = Reader.words[m].span; if (!s){ hi = m - 1; continue; }
        if (s.getBoundingClientRect().top > rd.bottom - 40){ ans = m; hi = m - 1; } else lo = m + 1; }
      b = Math.max(a.i, ans - 1);
    }
    return [a.i, b];
  },
  bookmarkHere(){
    const [a, b] = this.visibleRange();
    return this.bookmarks.find(m => m.i >= a && m.i <= b) || null;
  },
  updateBookmarkBtn(){
    const on = !!this.bookmarkHere();
    const btn = $("#bookmarkBtn"); btn.classList.toggle("on", on);
    $("#bookmarkPath").setAttribute("d", on
      ? "M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z"
      : "M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2zm0 15-5-2.18L7 18V5h10v13z");
  },
  async toggleBookmark(){
    if (UI.activeId == null || !Reader.words.length) return;
    const ex = this.bookmarkHere();
    if (ex){ this.bookmarks = this.bookmarks.filter(m => m.id !== ex.id); toast("Bookmark removed"); }
    else {
      const [a] = this.visibleRange(), n = Reader.words.length;
      const snip = Reader.textFrom(a, Math.min(n - 1, a + 14));
      const pg = Reader.words[a] && Reader.words[a].page;
      this.bookmarks.push({ id:uid(), i:a, t:Date.now(), pct: n > 1 ? Math.round(a / (n - 1) * 100) : 0, snip, page: pg || null,
        chap: (this.chapIdx >= 0 && this.chapters && this.chapters[this.chapIdx]) ? this.chapters[this.chapIdx].title : "" });
      toast("Bookmarked");
    }
    this.bookmarks.sort((x, y) => x.i - y.i);
    try{ await DB.setMeta(UI.activeId, { bookmarks:this.bookmarks }); }catch(e){}
    this.updateBookmarkBtn();
  },

  /* --- in-book search --- */
  search(q){
    this.searchQuery = q; this.searchHits = []; this.searchIdx = -1;
    const W = Reader.words; q = (q || "").trim().toLowerCase();
    if (q.length < 2 || !W.length) return [];
    const offs = new Array(W.length); let acc = 0; const parts = new Array(W.length);
    for (let k = 0; k < W.length; k++){ offs[k] = acc; parts[k] = W[k].text.toLowerCase(); acc += parts[k].length + 1; }
    const hay = parts.join(" ");
    let from = 0; const hits = [];
    const wordAt = (c) => { let lo = 0, hi = W.length - 1, ans = 0; while (lo <= hi){ const m = (lo + hi) >> 1; if (offs[m] <= c){ ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
    while (hits.length < 800){
      const at = hay.indexOf(q, from); if (at < 0) break;
      const a = wordAt(at), b = wordAt(at + q.length - 1);
      hits.push({ a, b, at }); from = at + Math.max(1, q.length);
    }
    this.searchHits = hits; return hits;
  },
  clearSearchMarks(){
    document.querySelectorAll(".w.searchhit").forEach(e => e.classList.remove("searchhit"));
    document.querySelectorAll(".pdfsearch").forEach(e => e.remove());
  },
  markHit(h){
    this.clearSearchMarks();
    for (let k = h.a; k <= h.b; k++){
      const w = Reader.words[k]; if (!w) continue;
      if (Reader.mode === "text" && w.span) w.span.classList.add("searchhit");
      else if (Reader.mode === "pdf" && w.x != null){
        const wr = Reader.pageWrappers[w.page]; if (!wr) continue;
        const pw = Reader.pagePtWidth[w.page] || 612, ph = Reader.pagePtHeight[w.page] || 792;
        const d = el("div", "pdfsearch");
        d.style.left = (w.x / pw * 100) + "%"; d.style.top = (w.y / ph * 100) + "%";
        d.style.width = (Math.max(w.w, 4) / pw * 100) + "%"; d.style.height = (Math.max(w.h, 4) / ph * 100) + "%";
        wr.appendChild(d);
      }
    }
  },
  gotoHit(k){
    if (!this.searchHits.length) return;
    this.searchIdx = ((k % this.searchHits.length) + this.searchHits.length) % this.searchHits.length;
    const h = this.searchHits[this.searchIdx];
    this.goToWord(h.a, { smooth:false, noAudio:true });
    this.markHit(h);
    $("#searchChip").hidden = false; $("#searchCount").textContent = (this.searchIdx + 1) + " / " + this.searchHits.length;
  },
  clearSearch(){ this.searchHits = []; this.searchIdx = -1; this.clearSearchMarks(); $("#searchChip").hidden = true; },

  /* --- chrome visibility + body state --- */
  syncChrome(){
    const reading = UI.activeId != null && !Shelf.visible;
    document.body.classList.toggle("reading", reading);
    document.body.classList.toggle("pdfmode", reading && Reader.mode === "pdf");
    $("#content").classList.toggle("pdfmode", Reader.mode === "pdf");
    $("#hdrTitleBtn").hidden = !reading;
    Pager.sync();
    if (!reading){ document.body.classList.remove("chrome-hidden"); this.stopAuto(); }
    $("#hdrTitle").textContent = (currentDoc && UI.activeId != null) ? ($("#docTitle").textContent || "") : "";
    this.keepAwake();
  },
  keepAwake(){
    const reading = document.body.classList.contains("reading");
    Native.keepOn(!!(Speech.playing || (RS.keepOn && reading) || this._auto));
  },
  setChrome(show){
    document.body.classList.toggle("chrome-hidden", !show);
    if (!show){ $("#moreMenu").hidden = true; }
  },

  /* --- tap handling: middle toggles bars, edges turn pages --- */
  onTap(e){
    if (Reading.pinching || Ink.active) return;
    if (Annot.selecting){ Annot.cancelSelection(); return; }   // a tap away from a selection just dismisses it
    if (!Reader.words.length) return;
    if (window.getSelection && String(window.getSelection()).length > 0) return;
    // a tap on a note icon or an overlay control should keep its own behavior
    if (e.target.closest(".note-icon, .pdfannot, button, a, input, select")) return;
    if (RS.tapWordRead && ReadAloud.enabled){
      const idx = wordIndexAtEvent(e);
      if (idx != null){ Speech.cursor = idx; highlight(idx); showDock(true); Follow.setOn(true);
        if (!Speech.playing) Speech.play(true); else Speech.speakFrom(idx, true); return; }
    }
    this.stopAuto(true);
    const w = window.innerWidth, x = e.clientX;
    if (RS.tapZones && x < w * 0.22){ this.pageTurn(-1); Follow.userScrolled(); return; }
    if (RS.tapZones && x > w * 0.78){ this.pageTurn(1); Follow.userScrolled(); return; }
    this.setChrome(this.chromeHidden());
  },

  /* --- auto-scroll --- */
  _auto:false, _autoRAF:0, _autoLast:0, _autoAcc:0, _autoPaused:false,
  startAuto(){
    if (!Reader.words.length) return;
    if (Pager.on){ toast("Auto-scroll works in Scroll page style"); return; } this._auto = true; this._autoLast = 0; this._autoAcc = 0;
    this.setChrome(false); $("#autoChip").hidden = false; this._autoLabel(); this.keepAwake();
    const step = (t) => {
      if (!this._auto) return;
      if (this._autoLast && !this._autoPaused){
        const dt = Math.min(0.08, (t - this._autoLast) / 1000);
        this._autoAcc += RS.autoSpeed * 8 * dt;
        const whole = Math.floor(this._autoAcc);
        if (whole >= 1){ const rd = this.rd(), before = rd.scrollTop; rd.scrollTop = before + whole; this._autoAcc -= whole;
          if (Math.abs(rd.scrollTop - before) < 1 && whole >= 1){ this.stopAuto(); toast("End of book"); return; } }
      }
      this._autoLast = t; this._autoRAF = requestAnimationFrame(step);
    };
    this._autoRAF = requestAnimationFrame(step);
  },
  stopAuto(quiet){
    if (!this._auto) return; this._auto = false; cancelAnimationFrame(this._autoRAF); $("#autoChip").hidden = true; this.keepAwake();
    if (!quiet) toast("Auto-scroll stopped");
  },
  _autoLabel(){ $("#autoLabel").textContent = "Auto-scroll · " + RS.autoSpeed; },

  /* --- stats --- */
  _statFlushT:0,
  tick(){
    const now = Date.now();
    if (!document.body.classList.contains("reading") || document.hidden || !Reader.words.length){ this.lastTick = now; return; }
    const active = (now - this.lastActive < 45000) || Speech.playing || this._auto;
    if (active){ this.readSecs += 5; this._dayAdd(5, this.sessWords); this.sessWords = 0; }
    this.lastTick = now;
    if (now - this._statFlushT > 20000){ this._statFlushT = now; this.flush(); }
  },
  _day:null,
  _dayAdd(secs, words){ if (!this._day) this._day = { s:0, w:0 }; this._day.s += secs; this._day.w += words; },
  async flush(){
    if (UI.activeId != null && Reader.words.length){
      try{ await DB.setMeta(UI.activeId, { readSecs:this.readSecs, readWords:this.readWords }); }catch(e){}
    }
    if (this._day && (this._day.s || this._day.w)){
      const d = this._day; this._day = null;
      try{
        const m = (await DB.getMeta(Theme.SETTINGS_ID)) || {}; const st = m.stats || { days:{} };
        const k = new Date().toISOString().slice(0, 10); const cur = st.days[k] || { s:0, w:0 };
        cur.s += d.s; cur.w += d.w; st.days[k] = cur;
        const keys = Object.keys(st.days).sort(); while (keys.length > 400) delete st.days[keys.shift()];
        await DB.setMeta(Theme.SETTINGS_ID, { stats:st });
      }catch(e){}
    }
  }
};
setInterval(() => Reading.tick(), 5000);
document.addEventListener("visibilitychange", () => { if (document.hidden){ Reading.flush(); saveProgress(true); } });
window.addEventListener("pagehide", () => { Reading.flush(); });

/* scroll tracking (rAF-coalesced) */
let _scrRAF = 0;
$("#reader").addEventListener("scroll", () => {
  if (_scrRAF) return;
  _scrRAF = requestAnimationFrame(() => {
    _scrRAF = 0; const rd = $("#reader"), st = rd.scrollTop;
    // hide the bars when the reader scrolls down on their own (like a book: out of the way)
    if (Reading.userTouching && st > Reading.lastScrollTop + 14 && document.body.classList.contains("reading") && !Reading.chromeHidden()) Reading.setChrome(false);
    Reading.lastScrollTop = st; Reading.update(); if (Annot.selecting && Annot.reposition) Annot.reposition();
  });
}, { passive:true });
// manual scrolling (finger / wheel / keys) detaches the page from the voice
$("#reader").addEventListener("touchstart", () => { Reading.userTouching = true; if (Reading._auto) Reading._autoPaused = true; }, { passive:true });
const _touchEnd = () => { Reading.userTouching = false; if (Reading._auto) setTimeout(() => { Reading._autoPaused = false; }, 600); };
$("#reader").addEventListener("touchend", _touchEnd, { passive:true });
$("#reader").addEventListener("touchcancel", _touchEnd, { passive:true });
$("#reader").addEventListener("touchmove", () => { if (!Reading.pinching) Follow.userScrolled(); }, { passive:true });
$("#reader").addEventListener("wheel", (e) => { if (!e.ctrlKey) Follow.userScrolled(); }, { passive:true });

/* tap routing: replaces the old "tap a word = start speaking" behaviour */
$("#reader").addEventListener("click", (e) => {
  if (_suppressNextClick){ _suppressNextClick = false; clearTimeout(_suppressClickT); e.stopPropagation(); return; }
  Reading.onTap(e);
});

/* ---------------- pinch to zoom (PDF page zoom / text size) ---------------- */
let _pz = null;
function _dist(t){ return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
$("#reader").addEventListener("touchstart", (e) => {
  if (e.touches.length !== 2 || Pager.on) return;
  clearTimeout(_lpTimer); _lpTimer = null;
  const rd = $("#reader"), c = $("#content"), rr = rd.getBoundingClientRect();
  const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
  const cr = c.getBoundingClientRect();
  _pz = { d0:_dist(e.touches), scale:1, cx, cy, rr,
    fx:(cx - cr.left) / Math.max(1, cr.width), fy:(cy - cr.top) / Math.max(1, cr.height),
    base: Reader.mode === "pdf" ? RS.pdfZoom : RS.fs, anchor:Reading.measure() };
  Reading.pinching = true; _suppressNextClick = true; clearTimeout(_suppressClickT);
  c.style.willChange = "transform";
}, { passive:true });
$("#reader").addEventListener("touchmove", (e) => {
  if (!_pz || e.touches.length !== 2) return;
  e.preventDefault();
  const lim = Reader.mode === "pdf" ? [1 / _pz.base, 4 / _pz.base] : [12 / _pz.base, 48 / _pz.base];
  _pz.scale = clamp(_dist(e.touches) / _pz.d0, lim[0], lim[1]);
  const c = $("#content"), cr = c.getBoundingClientRect();
  if (Reader.mode === "pdf"){
    c.style.transformOrigin = (_pz.fx * 100) + "% " + (_pz.fy * 100) + "%"; c.style.transform = "scale(" + _pz.scale + ")";
  } else {
    const rr = $("#reader").getBoundingClientRect();
    c.style.transformOrigin = "50% " + Math.max(0, _pz.cy - cr.top) + "px"; c.style.transform = "scale(" + (0.5 + _pz.scale / 2) + ")";
    toast("Text size " + Math.round(_pz.base * _pz.scale) + " px", 700);
  }
}, { passive:false });
const _pinchEnd = (e) => {
  if (!_pz) return; if (e.touches && e.touches.length >= 2) return;
  const p = _pz; _pz = null; const c = $("#content"); c.style.transform = ""; c.style.transformOrigin = ""; c.style.willChange = "";
  setTimeout(() => { Reading.pinching = false; }, 350);
  if (Math.abs(p.scale - 1) < 0.03) return;
  if (Reader.mode === "pdf") Settings.zoomPdf(RS.pdfZoom * p.scale, p);
  else Settings.set("fs", Math.round(clamp(RS.fs * p.scale, 12, 48)));
};
$("#reader").addEventListener("touchend", _pinchEnd, { passive:true });
$("#reader").addEventListener("touchcancel", _pinchEnd, { passive:true });
// ctrl/cmd + wheel (desktop & Chromebook trackpads)
$("#reader").addEventListener("wheel", (e) => {
  if (!e.ctrlKey && !e.metaKey) return; e.preventDefault();
  const f = e.deltaY < 0 ? 1.08 : 1 / 1.08;
  if (Pager.on && Reader.mode === "pdf") Pager.setZoom(clamp(Pager.z * f, 1, 5), { cx:e.clientX, cy:e.clientY });
  else if (Reader.mode === "pdf") Settings.zoomPdf(RS.pdfZoom * f, { cx:e.clientX, cy:e.clientY });
  else Settings.set("fs", Math.round(clamp(RS.fs * f, 12, 48)));
}, { passive:false });

/* ---------------- appearance / text settings ---------------- */
function syncScrim(){ const sc = $("#sheetScrim"); if (sc) sc.hidden = $("#settingsSheet").hidden && $("#navSheet").hidden; }
const Settings = {
  async load(){
    let saved = null; try{ const m = await DB.getMeta(Theme.SETTINGS_ID); saved = m && m.rs; }catch(e){}
    Object.assign(RS, RS_DEFAULT, saved || {});
    this.applyAll();
  },
  save(){ DB.setMeta(Theme.SETTINGS_ID, { rs:Object.assign({}, RS) }).catch(()=>{}); },
  applyAll(){
    const c = $("#content").style, r = $("#reader").style;
    c.setProperty("--fs", RS.fs + "px"); c.setProperty("--lh", RS.lh); c.setProperty("--ps", RS.ps + "em");
    c.setProperty("--ff", FONT_STACKS[RS.font] || FONT_STACKS.sans); c.setProperty("--ta", RS.align);
    c.setProperty("--hy", RS.hyphen ? "auto" : "manual"); c.setProperty("--pdfzoom", RS.pdfZoom);
    r.setProperty("--mx", RS.mx + "vw");
    document.documentElement.style.setProperty("--dim", RS.dim); document.documentElement.style.setProperty("--warm", RS.warm);
    document.documentElement.classList.toggle("hasDim", RS.dim > 0); document.documentElement.classList.toggle("hasWarm", RS.warm > 0);
    if (!document.documentElement.lang) document.documentElement.lang = "en";
    $("#fontSize") && ($("#fontSize").value = RS.fs);
    try{ if (Native.has) AndroidBridge.setVolumeKeyPaging(!!RS.volKeys); }catch(e){}
    Reading.keepAwake(); Pager.sync();
  },
  set(key, val){
    RS[key] = val;
    const layout = ["fs","lh","ps","mx","font","align","hyphen"].includes(key);
    if (layout && Reader.words.length) Reading.withAnchor(() => this.applyAll()); else this.applyAll();
    if (key === "fs" || key === "font" || key === "flip") this.syncOpen();
    this.save();
  },
  zoomPdf(z, p){
    if (Pager.on){ Pager.setZoom(clamp(z, 1, 5), p); return; }
    z = clamp(z, 1, 4); if (Math.abs(z - RS.pdfZoom) < 0.01) return;
    const rd = $("#reader"), c = $("#content");
    const rr = rd.getBoundingClientRect(), cr0 = c.getBoundingClientRect();
    const cx = p && p.cx != null ? p.cx : rr.left + rr.width / 2, cy = p && p.cy != null ? p.cy : rr.top + rr.height / 2;
    const fx = (cx - cr0.left) / Math.max(1, cr0.width), fy = (cy - cr0.top) / Math.max(1, cr0.height);
    RS.pdfZoom = z; this.applyAll(); void c.offsetWidth;
    const cr1 = c.getBoundingClientRect();
    rd.scrollLeft += (cr1.left + fx * cr1.width) - cx;
    rd.scrollTop += (cr1.top + fy * cr1.height) - cy;
    if (z === 1) rd.scrollLeft = 0;
    handleReaderResize(true);
    this.save(); this.syncOpen();
    toast("Zoom " + Math.round(z * 100) + "%", 900);
  },
  reset(){
    Object.assign(RS, RS_DEFAULT, { pdfZoom:RS.pdfZoom });
    Reading.withAnchor(() => this.applyAll()); this.save(); this.build();
  },
  open(){ this.build(); $("#settingsSheet").hidden = false; $("#sheetScrim").hidden = false; },
  close(){ $("#settingsSheet").hidden = true; syncScrim(); },
  syncOpen(){ if (!$("#settingsSheet").hidden) this.build(); },
  build(){
    const b = $("#settingsBody"), sc = b.scrollTop, th = Theme.current;
    const seg = (key, items) => '<div class="seg">' + items.map(([v, l]) => '<button data-k="' + key + '" data-v="' + v + '" class="' + (String(RS[key]) === String(v) ? 'sel' : '') + '">' + l + '</button>').join("") + '</div>';
    const rng = (key, min, max, step, label, fmt) => '<div class="setRow"><label>' + label + '</label><input type="range" data-r="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + RS[key] + '"><span class="val">' + (fmt ? fmt(RS[key]) : RS[key]) + '</span></div>';
    const tog = (key, label) => '<div class="setRow"><label class="chk" style="width:auto;flex:1"><input type="checkbox" data-t="' + key + '"' + (RS[key] ? ' checked' : '') + '> ' + label + '</label></div>';
    b.innerHTML =
      '<div class="setTitle">Theme</div><div class="themeRow">' + THEME_LIST.map(t => '<button class="themeSw' + (t.id === th ? ' sel' : '') + '" data-theme="' + t.id + '" style="background:' + t.bg + ';color:' + t.fg + '">' + t.name + '</button>').join("") + '</div>' +
      '<div class="setTitle">Text</div>' +
      '<div class="setRow"><label>Size</label><button class="stepBtn" data-step="-1">A−</button><input type="range" data-r="fs" min="12" max="48" step="1" value="' + RS.fs + '"><button class="stepBtn" data-step="1">A+</button><span class="val">' + RS.fs + '</span></div>' +
      '<div class="setRow"><label>Font</label>' + seg("font", [["sans","Sans"],["serif","Serif"],["book","Book"],["mono","Mono"]]) + '</div>' +
      rng("lh", 1.2, 2.6, 0.1, "Line spacing", v => (+v).toFixed(1)) +
      rng("ps", 0, 2.4, 0.1, "Paragraphs", v => (+v).toFixed(1)) +
      rng("mx", 0, 22, 1, "Side margins", v => v + "%") +
      '<div class="setRow"><label>Align</label>' + seg("align", [["left","Left"],["justify","Justify"]]) + '</div>' +
      tog("hyphen", "Hyphenate words") +
      (Reader.mode === "pdf" && !Pager.on ? '<div class="setTitle">PDF page</div>' + rng("pdfZoom", 1, 4, 0.1, "Zoom", v => Math.round(v * 100) + "%") + '<div class="setRow"><span class="lbl"></span><div class="seg"><button data-fit="1">Fit width</button><button data-fit="1.5">150%</button><button data-fit="2">200%</button></div></div>' : '') +
      '<div class="setTitle">Screen</div>' +
      rng("dim", 0, 0.7, 0.05, "Dim", v => Math.round(v * 100) + "%") +
      rng("warm", 0, 0.5, 0.05, "Warm light", v => Math.round(v * 200) + "%") +
      tog("keepOn", "Keep screen on while reading") +
      '<div class="setTitle">Turning pages</div>' +
      '<div class="setRow"><label>Page style</label>' + seg("flip", [["false","Scroll"],["true","Flip pages"]]) + '</div>' +
      (RS.flip ? '<div class="setRow"><span class="lbl" style="font-size:12px;opacity:.7">Swipe or tap the screen edges to turn pages. ' + (Reader.mode === "pdf" ? 'Pinch to zoom a page, drag to pan, and pinch back out to flip again.' : 'Pinch to change text size.') + '</span></div>' : '') +
      tog("tapZones", "Tap the screen edges to turn pages (centre shows/hides bars)") +
      tog("volKeys", "Use volume keys to turn pages") +
      '<div class="setRow"><label>Auto-scroll</label><div class="seg"><button data-auto="1">' + (Reading._auto ? "Stop" : "Start") + '</button></div></div>' +
      (Reading._auto || true ? rng("autoSpeed", 1, 30, 1, "Speed", v => v) : '') +
      '<div class="setTitle">Read aloud</div>' +
      tog("tapWordRead", "Tap a word to start reading aloud from it") +
      tog("dimRead", "Dim text the voice has already read") +
      '<div class="setRow"><button class="grow" data-act="reset" style="width:100%">Reset text settings</button></div>';
    b.scrollTop = sc;
  }
};
$("#settingsBody").addEventListener("input", (e) => {
  const r = e.target.dataset && e.target.dataset.r; if (!r) return;
  const v = parseFloat(e.target.value);
  if (r === "pdfZoom"){ Settings.zoomPdf(v, null); }
  else if (r === "autoSpeed"){ RS.autoSpeed = v; Reading._autoLabel(); Settings.save(); }
  else Settings.set(r, v);
  const val = e.target.parentElement.querySelector(".val");
  if (val){ val.textContent = r === "mx" ? v + "%" : r === "dim" ? Math.round(v * 100) + "%" : r === "warm" ? Math.round(v * 200) + "%" : r === "pdfZoom" ? Math.round(v * 100) + "%" : (r === "lh" || r === "ps") ? v.toFixed(1) : v; }
});
$("#settingsBody").addEventListener("change", (e) => {
  const t = e.target.dataset && e.target.dataset.t; if (!t) return;
  RS[t] = !!e.target.checked; Settings.applyAll(); Settings.save();
  if (t === "dimRead" && !RS.dimRead) document.querySelectorAll(".w.read").forEach(x => x.classList.remove("read"));
});
$("#settingsBody").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.theme){ Theme.setTheme(b.dataset.theme); Settings.build(); return; }
  if (b.dataset.k){ const dv = b.dataset.v; Settings.set(b.dataset.k, dv === "true" ? true : dv === "false" ? false : dv); return; }
  if (b.dataset.step){ Settings.set("fs", clamp(RS.fs + parseInt(b.dataset.step, 10), 12, 48)); return; }
  if (b.dataset.fit){ Settings.zoomPdf(parseFloat(b.dataset.fit), null); return; }
  if (b.dataset.auto){ if (Reading._auto) Reading.stopAuto(); else { Settings.close(); Reading.startAuto(); } return; }
  if (b.dataset.act === "reset"){ Settings.reset(); }
});
$("#typeBtn").onclick = () => { Nav.close(); Settings.open(); };
$("#sheetScrim").onclick = () => { Settings.close(); Nav.close(); };

/* ---------------- contents / bookmarks / search / stats sheet ---------------- */
const Nav = {
  tab:"toc",
  open(tab){
    if (!Reader.words.length) return;
    Settings.close(); this.tab = tab || this.tab || "toc";
    $("#navSheet").hidden = false; $("#sheetScrim").hidden = false; this.render();
  },
  close(){ $("#navSheet").hidden = true; syncScrim(); },
  async render(){
    document.querySelectorAll("#navSheet .sheetTabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === this.tab));
    const body = $("#navBody"); body.innerHTML = "";
    if (this.tab === "toc") await this.renderToc(body);
    else if (this.tab === "marks") this.renderMarks(body);
    else if (this.tab === "search") this.renderSearch(body);
    else await this.renderStats(body);
  },
  async renderToc(body){
    body.innerHTML = '<div class="navEmpty">Finding chapters…</div>';
    const list = await Reading.getChapters(); body.innerHTML = "";
    if (!list.length){
      body.innerHTML = '<div class="navEmpty">No chapters were found in this book.<br>Jump by percentage instead:</div>';
      const row = el("div", "seg"); row.style.padding = "0 4px";
      [0, 10, 20, 30, 40, 50, 60, 70, 80, 90].forEach(p => { const b = el("button"); b.textContent = p + "%"; b.onclick = () => { Reading.goToWord(Math.round(Reader.words.length * p / 100), { noAudio:true }); this.close(); }; row.appendChild(b); });
      body.appendChild(row); return;
    }
    list.forEach((c, k) => {
      const r = el("div", "navRow" + (c.lvl > 1 ? " l" + Math.min(3, c.lvl) : "") + (k === Reading.chapIdx ? " cur" : ""));
      const t = el("div", "t"); t.textContent = c.title;
      const pg = el("div", "pg"); pg.textContent = c.page ? "p. " + c.page : Math.round(c.i / Math.max(1, Reader.words.length - 1) * 100) + "%";
      r.append(t, pg); r.onclick = () => { Reading.goToWord(c.i, { noAudio:false }); this.close(); }; body.appendChild(r);
    });
    const cur = body.querySelector(".cur"); if (cur) cur.scrollIntoView({ block:"center" });
  },
  renderMarks(body){
    const list = Reading.bookmarks;
    const add = el("button", "btn-accent"); add.textContent = Reading.bookmarkHere() ? "Remove bookmark on this page" : "＋ Bookmark this page";
    add.onclick = async () => { await Reading.toggleBookmark(); this.render(); }; body.appendChild(add);
    if (!list.length){ const e = el("div", "navEmpty"); e.textContent = "No bookmarks yet."; body.appendChild(e); }
    list.forEach(m => {
      const r = el("div", "navRow"); const t = el("div", "t"); t.textContent = m.snip || "(bookmark)";
      const s = el("small"); s.textContent = (m.chap ? m.chap + " · " : "") + (m.page ? "p. " + m.page + " · " : "") + m.pct + "%"; t.appendChild(s);
      const rm = el("button", "rm"); rm.textContent = "✕"; rm.title = "Delete";
      rm.onclick = async (ev) => { ev.stopPropagation(); Reading.bookmarks = Reading.bookmarks.filter(x => x.id !== m.id); try{ await DB.setMeta(UI.activeId, { bookmarks:Reading.bookmarks }); }catch(err){} Reading.updateBookmarkBtn(); this.render(); };
      r.append(t, rm); r.onclick = () => { Reading.goToWord(m.i, { noAudio:false }); this.close(); }; body.appendChild(r);
    });
    const hl = el("button"); hl.textContent = "Highlights & notes…"; hl.onclick = () => { this.close(); openAnnotList(); }; body.appendChild(hl);
  },
  renderSearch(body){
    const inp = el("input"); inp.id = "navSearchIn"; inp.type = "search"; inp.placeholder = "Search this book…"; inp.value = Reading.searchQuery || "";
    inp.autocomplete = "off"; body.appendChild(inp);
    const res = el("div"); res.id = "navResults"; res.style.display = "flex"; res.style.flexDirection = "column"; body.appendChild(res);
    let t = 0;
    const run = () => {
      const q = inp.value; const hits = Reading.search(q); res.innerHTML = "";
      if (q.trim().length < 2){ res.innerHTML = '<div class="navEmpty">Type at least 2 letters.</div>'; return; }
      if (!hits.length){ res.innerHTML = '<div class="navEmpty">No matches.</div>'; return; }
      const info = el("div", "navEmpty"); info.style.padding = "4px"; info.textContent = hits.length + (hits.length >= 800 ? "+" : "") + " matches"; res.appendChild(info);
      hits.slice(0, 200).forEach((h, k) => {
        const r = el("div", "navRow"); const tt = el("div", "t");
        const a = Math.max(0, h.a - 7), b = Math.min(Reader.words.length - 1, h.b + 9);
        const pre = Reader.textFrom(a, h.a - 1 >= a ? h.a - 1 : a - 1 < 0 ? a : a), txt = [];
        let html = "";
        for (let i = a; i <= b; i++){ const w = Reader.words[i].text.replace(/[&<>]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[c])); html += (i > a ? " " : "") + ((i >= h.a && i <= h.b) ? '<mark class="hit">' + w + '</mark>' : w); }
        tt.innerHTML = html;
        const pg = el("div", "pg"); const pgn = Reader.words[h.a].page; pg.textContent = pgn ? "p. " + pgn : Math.round(h.a / Math.max(1, Reader.words.length - 1) * 100) + "%";
        r.append(tt, pg); r.onclick = () => { this.close(); Reading.gotoHit(k); }; res.appendChild(r);
      });
    };
    inp.addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 220); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter"){ clearTimeout(t); run(); inp.blur(); } });
    if (Reading.searchQuery) run();
    setTimeout(() => { if (!Reading.searchQuery) inp.focus(); }, 80);
  },
  async renderStats(body){
    let st = null; try{ const m = await DB.getMeta(Theme.SETTINGS_ID); st = m && m.stats; }catch(e){}
    await Reading.flush(); try{ const m = await DB.getMeta(Theme.SETTINGS_ID); st = m && m.stats; }catch(e){}
    const days = (st && st.days) || {}; const keys = Object.keys(days).sort();
    const today = new Date().toISOString().slice(0, 10);
    const sum = (ks) => ks.reduce((a, k) => ({ s:a.s + days[k].s, w:a.w + days[k].w }), { s:0, w:0 });
    const wk = []; for (let d = 0; d < 7; d++){ wk.push(new Date(Date.now() - d * 864e5).toISOString().slice(0, 10)); }
    const t = sum(keys.filter(k => k === today)), w = sum(keys.filter(k => wk.includes(k))), all = sum(keys);
    let streak = 0; for (let d = 0; d < 400; d++){ const k = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10); if (days[k] && days[k].s >= 60) streak++; else if (d > 0) break; else if (!days[k]) continue; }
    const fm = (s) => s < 90 ? Math.round(s) + " s" : s < 5400 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(1) + " h";
    const box = (b, l) => '<div class="statBox"><b>' + b + '</b><span>' + l + '</span></div>';
    const wpm = Math.round(Reading.wpm());
    body.innerHTML = '<div class="statGrid">' + box(fm(t.s), "Read today") + box(fm(w.s), "Last 7 days") + box(streak + " day" + (streak === 1 ? "" : "s"), "Reading streak") +
      box(all.w.toLocaleString(), "Words read (all time)") + box(wpm + " wpm", "Your pace") + box(fm(Reading.readSecs), "Time in this book") + '</div>' +
      '<div class="navEmpty" style="padding:6px">Time counts while you scroll, turn pages, or listen.</div>';
  }
};
document.querySelectorAll("#navSheet .sheetTabs button").forEach(b => b.onclick = () => { Nav.tab = b.dataset.tab; Nav.render(); });
$("#searchBtn").onclick = () => Nav.open("search");
$("#hdrTitleBtn").onclick = () => Nav.open("toc");
$("#bookmarkBtn").onclick = () => Reading.toggleBookmark();
$("#searchPrev").onclick = () => Reading.gotoHit(Reading.searchIdx - 1);
$("#searchNext").onclick = () => Reading.gotoHit(Reading.searchIdx + 1);
$("#searchClear").onclick = () => Reading.clearSearch();

/* progress scrubber now scrolls the page (it used to move the voice) */
(function(){
  const seek = $("#seek");
  seek.addEventListener("pointerdown", () => { Reading._scrubbing = true; });
  const done = () => { Reading._scrubbing = false; };
  seek.addEventListener("pointerup", done); seek.addEventListener("pointercancel", done); seek.addEventListener("change", done);
  seek.addEventListener("input", () => {
    const i = parseInt(seek.value, 10); if (!Number.isFinite(i)) return;
    Reading.goToWord(i, { noAudio:true });
    const n = Reader.words.length; $("#posLabel").textContent = (n > 1 ? Math.round(i / (n - 1) * 100) : 100) + "%";
    Follow.userScrolled();
  });
})();

/* ---------------- audio dock ---------------- */
function showDock(show){
  const d = $("#listenDock"); d.hidden = !show;
  $("#listenBtn").classList.toggle("on", !!show);
  if (show) updateDockInfo();
}
function updateDockInfo(){
  const info = $("#dockInfo"); if (!info) return;
  if (!ReadAloud.enabled){ info.textContent = "Read aloud is off (turn on in ⋯ menu)"; return; }
  info.textContent = Speech.playing ? "Reading aloud…" : "Read aloud from the top of your screen";
}
$("#listenBtn").onclick = () => { if (!ReadAloud.enabled){ toast("Read aloud is turned off — enable it in the ⋯ menu"); return; } showDock($("#listenDock").hidden); };
$("#dockMore").onclick = () => { $("#dockPanel").hidden = !$("#dockPanel").hidden; };
$("#dockClose").onclick = () => { if (Speech.playing || Speech.synth && Speech.synth.speaking) Speech.stop(); Follow.setOn(true); $("#followChip").hidden = true; showDock(false); };
const Sleep = {
  t:0, until:0, chapterEnd:null,
  set(v){
    clearInterval(this.t); this.until = 0; this.chapterEnd = null; $("#sleepLeft").textContent = "";
    if (v === "chapter"){
      const ch = Reading.chapters || []; const nxt = ch.find(c => c.i > (Speech.cursor || 0));
      this.chapterEnd = nxt ? nxt.i : Reader.words.length; this.t = setInterval(() => this.check(), 700); $("#sleepLeft").textContent = "chapter";
      return;
    }
    const m = parseInt(v, 10); if (!m) return;
    this.until = Date.now() + m * 60000; this.t = setInterval(() => this.check(), 1000); this.check();
  },
  check(){
    if (this.chapterEnd != null){ if ((Speech.cursor || 0) >= this.chapterEnd){ this.fire(); } return; }
    const left = this.until - Date.now(); if (left <= 0){ this.fire(); return; }
    $("#sleepLeft").textContent = Math.ceil(left / 60000) + "m";
  },
  fire(){ clearInterval(this.t); this.until = 0; this.chapterEnd = null; $("#sleepSel").value = "0"; $("#sleepLeft").textContent = ""; if (Speech.playing) Speech.pause(); toast("Sleep timer: paused"); }
};
$("#sleepSel").onchange = (e) => Sleep.set(e.target.value);

/* selection toolbar: read from here / copy / look up */
function _selText(){ const [a, b] = Annot.range(); return b >= a ? Reader.textFrom(a, Math.min(b, a + 400)) : ""; }
$("#annotReadBtn").onclick = () => {
  const [a] = Annot.range(); Annot.cancelSelection();
  if (!ReadAloud.enabled){ toast("Read aloud is turned off — enable it in the ⋯ menu"); return; }
  showDock(true); Follow.setOn(true); Speech.cursor = a; highlight(a);
  if (!Speech.playing) Speech.play(true); else Speech.speakFrom(a, true);
};
$("#annotCopyBtn").onclick = () => {
  const t = _selText(); Annot.cancelSelection(); if (!t) return;
  let ok = false; try{ if (Native.has && AndroidBridge.copyText){ AndroidBridge.copyText(t); ok = true; } }catch(e){}
  if (!ok){ try{ navigator.clipboard.writeText(t); ok = true; }catch(e){} }
  toast(ok ? "Copied" : "Couldn't copy");
};
$("#annotDefineBtn").onclick = () => {
  const [a, b] = Annot.range(); let t = _selText().replace(/[.,;:!?"“”()\[\]]/g, "").trim(); Annot.cancelSelection();
  if (!t) return; if (b - a > 6) t = t.split(/\s+/).slice(0, 6).join(" ");
  let ok = false; try{ if (Native.has && AndroidBridge.lookupWord){ AndroidBridge.lookupWord(t); ok = true; } }catch(e){}
  if (!ok) toast("Look-up needs the Android app");
};

/* volume keys (native calls this) */
window.__volKey = (dir) => { Reading.stopAuto(true); Reading.pageTurn(dir); Follow.userScrolled(); };

/* keyboard (external keyboards / Chromebooks) */
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
  if (!document.body.classList.contains("reading")) return;
  if (e.code === "Space" || e.code === "PageDown" || e.code === "ArrowRight"){ e.preventDefault(); Reading.pageTurn(e.shiftKey ? -1 : 1); Follow.userScrolled(); }
  else if (e.code === "PageUp" || e.code === "ArrowLeft"){ e.preventDefault(); Reading.pageTurn(-1); Follow.userScrolled(); }
  else if (e.key === "p" || e.key === "P"){ if (ReadAloud.enabled){ showDock(true); Speech.toggle(); } }
  else if (e.key === "+" || e.key === "="){ Settings.set("fs", clamp(RS.fs + 1, 12, 48)); }
  else if (e.key === "-"){ Settings.set("fs", clamp(RS.fs - 1, 12, 48)); }
  else if (e.key === "/"){ e.preventDefault(); Nav.open("search"); }
});

/* auto-scroll chip */
$("#autoFaster").onclick = () => { RS.autoSpeed = clamp(RS.autoSpeed + 1, 1, 30); Reading._autoLabel(); Settings.save(); };
$("#autoSlower").onclick = () => { RS.autoSpeed = clamp(RS.autoSpeed - 1, 1, 30); Reading._autoLabel(); Settings.save(); };
$("#autoStop").onclick = () => Reading.stopAuto();



// safety net: never leave the dimming scrim up without a sheet on screen
document.addEventListener("visibilitychange", syncScrim); window.addEventListener("pageshow", syncScrim); setInterval(syncScrim, 2000);
