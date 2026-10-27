/* =====================================================================
   Pager -- real paged reading ("Flip pages"), modelled on Apple Books.
   Text is laid out in CSS columns, one column per page; PDFs lay their pages
   out side by side. The whole #content strip slides horizontally under your
   finger, so the neighbouring page is visible while you drag, and a release
   settles onto a page with a short ease-out. No scrolling is involved, so
   nothing is ever cut in half or skipped.
   ===================================================================== */
const Pager = {
  on:false, idx:0, count:1, W:0, H:0, top:0, mx:20, z:1, tx:0, ty:0, mode:null, wordsRef:null, fitW:0, _busy:false,

  c(){ return $("#content"); },
  rd(){ return $("#reader"); },

  /* ---------- enable / disable ---------- */
  want(){
    return !!RS.flip && UI.activeId != null && Reader.words.length > 0 && !(typeof Ink !== "undefined" && Ink.active);
  },
  sync(){
    const want = this.want(); this.label();
    if (want && this.on && (this.mode !== Reader.mode || this.wordsRef !== Reader.words)){ this.disable(true); this.enable(); return; }
    if (want && !this.on) this.enable();
    else if (!want && this.on) this.disable();
  },
  enable(){
    if (this.on) return;
    if (!Reading._justRestored){ try{ Reading.update(true); }catch(e){} }
    Reading._justRestored = false;
    const pos = Reading.pos || 0;
    Reading.stopAuto && Reading.stopAuto(true);
    this.on = true; this.mode = Reader.mode; this.wordsRef = Reader.words; this.z = 1;
    this.layout(pos);
    const rd = this.rd(); rd.scrollTop = 0; rd.scrollLeft = 0;
    this.idx = pos <= 0 ? 0 : clamp(this.pageOfWord(pos), 0, this.count - 1);   // a fresh book opens on its very first page (a cover picture has no words)
    this.place(false);
    Reading.setChrome(false);
    Reading.pos = this.firstWord(this.idx) || pos;
    Reading.updateProgressUI(); this.label();
    // web fonts can change line breaks after the first layout: re-flow once if they arrive late
    try{ if (document.fonts && document.fonts.status !== "loaded"){ document.fonts.ready.then(() => { if (this.on) this.relayout({ mode:Reader.mode, i:Reading.pos || 0, p:this.idx + 1 }); }); } }catch(e){}
    this.afterMove();
  },
  disable(keepPos){
    if (!this.on) return;
    const pos = Reading.pos || 0;
    this.on = false; this.z = 1;
    document.body.classList.remove("paged"); this.label();
    if (Reader._mio && Reader.mode === "text"){ document.querySelectorAll("#content p").forEach(q => { if (q._B && !q._B.done){ Reader._mio.unobserve(q); Reader._mio.observe(q); } }); }
    this.unwrapChunks();
    const c = this.c(), st = c.style;
    ["width", "height", "marginLeft", "marginTop", "columnWidth", "columnGap", "transform", "transition", "display", "alignItems"].forEach(k => st[k] = "");
    c.style.removeProperty("--pgW"); c.style.removeProperty("--flipw");
    Object.keys(Reader.pageWrappers || {}).forEach(k => { const w = Reader.pageWrappers[k]; w.style.width = ""; w.style.margin = ""; w.style.height = ""; if (w.dataset.pt != null) w.style.paddingTop = w.dataset.pt; delete w.dataset.rw; });
    if (!keepPos) setTimeout(() => { Reading.goToWord(pos, { noAudio:true }); }, 0);
  },

  /* ---------- geometry ---------- */
  metrics(){
    const rd = this.rd(); this.W = rd.clientWidth; const fullH = rd.clientHeight;
    this.top = Math.round(Math.max(16, fullH * 0.04)); const bottom = Math.round(Math.max(26, fullH * 0.055));
    this.H = Math.max(120, fullH - this.top - bottom);
    let mx = Math.max(16, Math.round(window.innerWidth * RS.mx / 100));
    if (this.W - 2 * mx > 760) mx = Math.round((this.W - 760) / 2);     // keep line length readable on tablets / landscape
    this.mx = mx;
  },
  layout(anchorWord){
    this.metrics();
    const c = this.c(), st = c.style;
    st.transition = "none";
    if (this.mode === "pdf"){
      document.body.classList.add("paged");
      st.marginLeft = "0px"; st.marginTop = this.top + "px"; st.height = this.H + "px"; st.columnWidth = ""; st.columnGap = "";
      this.count = Math.max(1, Reader.totalPages || Object.keys(Reader.pageWrappers).length);
      st.width = (this.count * this.W) + "px";
      c.style.setProperty("--pgW", this.W + "px");
      const m = Reader.pagePtWidth[this.idx + 1] ? this.idx + 1 : 1;
      const aspect = (Reader.pagePtWidth[m] && Reader.pagePtHeight[m]) ? Reader.pagePtWidth[m] / Reader.pagePtHeight[m] : 0.772;
      this.fitW = Math.floor(Math.min(this.W - 16, this.H * aspect));
      c.style.setProperty("--flipw", this.fitW + "px");
      Object.keys(Reader.pageWrappers).forEach(k => this.fitWrapper(Reader.pageWrappers[k], Number(k)));
    } else {
      // The book is a row of chapter-sized chunks, each its own multi-column box. Only the chunks
      // around the page you are on are ever laid out; the rest are "hidden" (zero layout/paint cost)
      // with an estimated width that is replaced by the exact one before you get there.
      this.ensureChunks();
      const wc = this.W - 2 * this.mx, gap = 2 * this.mx, mx = this.mx;
      this._wc = wc; this._gap = gap;
      st.marginLeft = "0px"; st.marginTop = this.top + "px"; st.height = this.H + "px"; st.width = "auto";
      st.display = "flex"; st.flexDirection = "row"; st.columnWidth = ""; st.columnGap = "";
      const base = "flex:none;height:" + this.H + "px;width:" + wc + "px;column-width:" + wc + "px;column-gap:" + gap + "px;column-fill:auto;margin:0 " + mx + "px;content-visibility:hidden;";
      this.chunks.forEach(ch => { ch.el.style.cssText = base; ch._measured = false; ch._vis = false; ch._pages = 1; });
      const k0 = (anchorWord > 0) ? this.chunkOfWord(anchorWord) : 0;
      document.body.classList.add("paged");     // only now: style/layout work is limited to the visible chunk
      this.measure(k0); this.chunks[k0]._vis = true;
      const c0 = this.chunks[k0], wpp = Math.max(60, (c0.w1 - c0.w0 + 1) / Math.max(1, c0._pages));
      this.chunks.forEach((ch, k) => {
        if (k === k0) return;
        ch._pages = Math.max(1, Math.ceil((ch.w1 - ch.w0 + 1) / wpp));
        ch.el.style.width = (ch._pages * wc + (ch._pages - 1) * gap) + "px";
      });
      this.recomputeStarts();
    }
  },
  // wrap the paragraphs into chunks (once per book): split at chapter headings once a chunk is big enough
  ensureChunks(){
    if (this.chunks && this.chunksFor === Reader.words && this.chunks[0] && this.chunks[0].el.parentNode === this.c()) return;
    const c = this.c(); this.unwrapChunks();
    const nodes = Array.prototype.slice.call(c.children).filter(n => n.tagName === "P" || n.tagName === "FIGURE");
    const chunks = []; let cur = null, wordsIn = 0, nextWord = 0;
    const open = () => { const el = document.createElement("section"); el.className = "pchunk"; cur = { el, w0:nextWord, w1:nextWord - 1 }; chunks.push(cur); wordsIn = 0; };
    nodes.forEach(p => {
      const B = p._B, n = B ? B.n : 40;
      const heading = p.classList.contains("k-h1") || p.classList.contains("k-h2");
      if (!cur || (heading && wordsIn >= 1800) || wordsIn >= 6000) open();
      cur.el.appendChild(p); wordsIn += n;
      if (B){ nextWord = B.first + B.n; cur.w1 = nextWord - 1; B.ch = chunks.length - 1; }
    });
    if (!chunks.length) open();
    chunks.forEach(ch => c.appendChild(ch.el));
    this.chunks = chunks; this.chunksFor = Reader.words;
  },
  unwrapChunks(){
    const c = this.c(); if (!this.chunks) return;
    this.chunks.forEach(ch => { const sec = ch.el; if (sec.parentNode === c){ while (sec.firstChild) c.insertBefore(sec.firstChild, sec); c.removeChild(sec); } });
    this.chunks = null; this.chunksFor = null;
  },
  chunkOfWord(i){
    const ch = this.chunks; let lo = 0, hi = ch.length - 1, ans = 0;
    while (lo <= hi){ const mid = (lo + hi) >> 1; if (ch[mid].w0 <= i){ ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  },
  chunkAt(idx){
    const ch = this.chunks; let lo = 0, hi = ch.length - 1, ans = 0;
    while (lo <= hi){ const mid = (lo + hi) >> 1; if (ch[mid]._start <= idx){ ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  },
  recomputeStarts(){ let s = 0; this.chunks.forEach(ch => { ch._start = s; s += ch._pages; }); this.count = Math.max(1, s); },
  // exact page count of one chunk (needs layout, so it is made visible while measured)
  measure(k){
    const ch = this.chunks[k], el = ch.el, wc = this._wc, gap = this._gap;
    el.style.contentVisibility = "visible"; el.style.width = wc + "px";
    const n = Math.max(1, Math.round((el.scrollWidth + gap) / (wc + gap)));
    el.style.width = (n * wc + (n - 1) * gap) + "px";
    ch._pages = n; ch._measured = true; ch._vis = true;
  },
  locate(idx){ const k = this.chunkAt(idx); return { k, local: idx - this.chunks[k]._start }; },
  relocate(loc){
    const ch = this.chunks[loc.k];
    this.idx = clamp(ch._start + Math.min(loc.local, ch._pages - 1), 0, this.count - 1);
    if (!this._moving){ this.tx = -this.idx * this.W; this.apply(false); }
  },
  // make chunk k exact (and laid out). Anything before the page you are on may shift it: keep it still.
  ensure(k, keepVisible){
    const ch = this.chunks[k]; if (!ch) return;
    if (ch._measured){ if (keepVisible && !ch._vis){ ch.el.style.contentVisibility = "visible"; ch._vis = true; } return; }
    const loc = this.chunks.length && this.idx >= 0 ? this.locate(Math.min(this.idx, this.count - 1)) : null, before = ch._pages;
    this.measure(k);
    if (!keepVisible){ ch.el.style.contentVisibility = "hidden"; ch._vis = false; }
    if (ch._pages !== before){ this.recomputeStarts(); if (loc) this.relocate(loc); }
  },
  windowUpdate(){
    if (!this.on || this.mode !== "text" || !this.chunks) return;
    const k = this.locate(this.idx).k;
    this.ensure(k, true);
    if (k > 0) this.ensure(k - 1, true);
    const k2 = this.locate(this.idx).k;
    if (k2 + 1 < this.chunks.length) this.ensure(k2 + 1, true);
    const kk = this.locate(this.idx).k;
    this.chunks.forEach((ch, j) => { if (Math.abs(j - kk) > 1 && ch._vis){ ch.el.style.contentVisibility = "hidden"; ch._vis = false; } });
  },
  // measure the rest of the book in the background, nearest chunks first, only while you are idle
  refine(){
    clearTimeout(this._refT);
    if (!this.on || this.mode !== "text" || !this.chunks) return;
    this._refT = setTimeout(() => {
      if (!this.on || !this.chunks) return;
      if (this._moving || this._touching){ this.refine(); return; }
      const kc = this.locate(this.idx).k; let best = -1, bd = 1e9;
      for (let j = 0; j < this.chunks.length; j++){ if (!this.chunks[j]._measured){ const d = Math.abs(j - kc); if (d < bd){ bd = d; best = j; } } }
      if (best < 0){ this.label(); return; }
      this.ensure(best, false); this.label();
      this.refine();
    }, 40);
  },
  // every PDF page is sized to fit the screen (both ways), centred in its own slot
  fitWrapper(w, p){
    const pw = Reader.pagePtWidth[p], ph = Reader.pagePtHeight[p];
    let width = this.fitW || (this.W - 16);
    if (pw && ph) width = Math.floor(Math.min(this.W - 16, this.H * pw / ph));
    if (w.dataset.pt == null) w.dataset.pt = w.style.paddingTop || "";
    // percentage padding would resolve against the (huge) strip, so give each page an explicit height instead
    const ratio = (pw && ph) ? ph / pw : (parseFloat(w.dataset.pt) / 100 || 1.294);
    const height = Math.round(width * ratio);
    w.style.paddingTop = "0"; w.style.height = height + "px";
    if (Math.abs((w.dataset.rw | 0) - width) > 2 || !w.style.width){
      w.style.width = width + "px"; w.style.margin = "0 " + ((this.W - width) / 2) + "px";
      if (w.dataset.rendered === "1" && w.dataset.rw){ w.dataset.rendered = "0"; }
    }
    w.dataset.rw = String(width);
  },
  relayout(anchor){
    if (!this.on) return;
    const a = anchor || { mode:Reader.mode, i:Reading.pos || 0, p:this.idx + 1 };
    this.z = 1; this.layout(a.i || 0);
    this.idx = clamp(Reader.mode === "pdf" ? (a.p || 1) - 1 : ((a.i || 0) <= 0 && this.idx === 0 ? 0 : this.pageOfWord(a.i || 0)), 0, this.count - 1);
    this.place(false);
    Reading.pos = this.firstWord(this.idx); Reading.updateProgressUI(); this.label();
    if (this.mode === "pdf"){ const w = Reader.pageWrappers[this.idx + 1]; if (w && w.dataset.rendered !== "1") renderPageCanvas(w, this.idx + 1); }
    else this.afterMove();
  },
  onResize(){
    if (!this.on) return;
    clearTimeout(this._rsT);
    this._rsT = setTimeout(() => this.relayout({ mode:Reader.mode, i:Reading.pos || 0, p:this.idx + 1 }), 80);
  },
  showAnchor(a){ this.relayout(a); },

  /* ---------- words <-> pages ---------- */
  pageOfWord(i){
    const w = Reader.words[i]; if (!w) return 0;
    if (this.mode === "pdf") return clamp((w.page || 1) - 1, 0, this.count - 1);
    const k = this.chunkOfWord(i); this.ensure(k, true);
    return clamp(Math.floor((Reader.wordLeft(i) + 2) / this.W), 0, this.count - 1);
  },
  firstWord(idx){
    if (this.mode === "pdf") return Reader.wordIndexForPage(idx + 1) || 0;
    const k = this.chunkAt(idx); this.ensure(k, true);
    const ch = this.chunks[k]; let lo = ch.w0, hi = Math.max(ch.w0, ch.w1), ans = Math.max(ch.w0, ch.w1);
    while (lo <= hi){
      const mid = (lo + hi) >> 1;
      if (Math.floor((Reader.wordLeft(mid) + 2) / this.W) >= idx){ ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return ans;
  },

  /* ---------- moving ---------- */
  apply(animate){
    if (animate){ this._moving = true; clearTimeout(this._mvT); this._mvT = setTimeout(() => { this._moving = false; }, 420); }
    const c = this.c(); c.style.transition = animate ? "transform .34s cubic-bezier(.22,.8,.24,1)" : "none";
    c.style.transform = "translate3d(" + this.tx + "px," + this.ty + "px,0) scale(" + this.z + ")";
  },
  place(animate){
    this.z = 1; this.tx = -this.idx * this.W; this.ty = 0; this.apply(animate);
  },
  goto(idx, animate){
    if (this.wordsRef !== Reader.words) return;   // stale layout (a different book is loading)
    if (this.mode === "text" && this.chunks){
      const loc = this.locate(clamp(idx, 0, this.count - 1)); this.ensure(loc.k, true);
      idx = clamp(this.chunks[loc.k]._start + Math.min(loc.local, this.chunks[loc.k]._pages - 1), 0, this.count - 1);
    }
    idx = clamp(idx, 0, this.count - 1);
    const changed = idx !== this.idx || this.z !== 1;
    if (Annot.selecting && changed) Annot.cancelSelection();
    this.idx = idx; this.place(animate !== false && changed);
    Reading.pos = this.firstWord(idx); Reading.lastActive = Date.now();
    Reading.updateProgressUI(); saveProgress(); this.label();
    if (changed) this.afterMove();
  },
  label(){
    let n = document.getElementById("pagerNum");
    if (!n){ n = document.createElement("div"); n.id = "pagerNum"; document.body.appendChild(n); }
    n.hidden = !this.on || Shelf.visible; if (this.on) n.textContent = (this.idx + 1) + " / " + this.count;
  },
  afterMove(){
    if (this.mode === "text"){ clearTimeout(this._wuT); this._wuT = setTimeout(() => { this.windowUpdate(); this.refine(); }, 30); return; }
    // make sure the neighbours are painted before they slide in
    if (this.mode === "pdf"){
      [this.idx, this.idx + 1, this.idx - 1].forEach(k => {
        const w = Reader.pageWrappers[k + 1]; if (w && w.dataset.rendered !== "1") renderPageCanvas(w, k + 1);
      });
    }
  },
  turn(dir){
    if (!this.on) return;
    if (Reading.chromeHidden() === false) Reading.setChrome(false);
    const to = this.idx + dir;
    if (to < 0 || to >= this.count){
      // a little rubber-band so you can feel the end
      this.tx = -this.idx * this.W + (dir > 0 ? -26 : 26); this.apply(true);
      setTimeout(() => { if (this.on) this.place(true); }, 120);
      toast(dir > 0 ? "End of book" : "Start of book", 700); return;
    }
    this.goto(to, true);
  },
  followTarget(t){
    if (!t) return;
    let page = null;
    if (this.mode === "pdf"){ const w = t.closest && t.closest(".pdfpage"); if (w) page = Number(w.dataset.page) - 1; }
    else if (t.dataset && t.dataset.i != null) page = this.pageOfWord(parseInt(t.dataset.i, 10));
    if (page != null && page !== this.idx) this.goto(page, true);
  },

  /* ---------- zoom (PDF) ---------- */
  pageBox(){
    const w = Reader.pageWrappers[this.idx + 1]; if (!w) return null;
    return { L:w.offsetLeft, T:w.offsetTop, w:w.offsetWidth, h:w.offsetHeight };
  },
  clampPan(){
    const b = this.pageBox(), vw = this.W, vh = this.rd().clientHeight, z = this.z; if (!b) return;
    const top = this.top, L = b.L, T = b.T + top;
    const loX = vw - z * (L + b.w), hiX = -z * L, loY = vh - z * (T + b.h), hiY = -z * T;
    this.tx = (z * b.w <= vw) ? (vw - z * b.w) / 2 - z * L : clamp(this.tx, loX, hiX);
    this.ty = (z * b.h <= vh) ? (vh - z * b.h) / 2 - z * T + 0 : clamp(this.ty, loY, hiY);
  },
  setZoom(z, p){
    if (this.mode !== "pdf") return;
    const rr = this.rd().getBoundingClientRect();
    const cx = (p && p.cx != null ? p.cx : rr.left + rr.width / 2) - rr.left, cy = (p && p.cy != null ? p.cy : rr.top + rr.height / 2) - rr.top;
    const z0 = this.z; this.z = clamp(z, 1, 5);
    // keep the point under the fingers fixed
    this.tx = cx - (this.z / z0) * (cx - this.tx); this.ty = cy - (this.z / z0) * (cy - this.ty);
    if (this.z <= 1.04){ this.z = 1; this.place(true); } else { this.clampPan(); this.apply(false); }
    clearTimeout(this._rzT); this._rzT = setTimeout(() => this.sharpen(), 220);
    toast("Zoom " + Math.round(this.z * 100) + "%", 700);
  },
  sharpen(){
    const w = Reader.pageWrappers[this.idx + 1]; if (!w || this.z <= 1) return;
    w.dataset.rendered = "0"; renderPageCanvas(w, this.idx + 1);
  }
};

/* ---------------- gestures: drag to turn, pinch, pan ---------------- */
(function(){
  const rd = $("#reader");
  let g = null, pz = null;
  const curTx = () => { try{ const m = new DOMMatrixReadOnly(getComputedStyle(Pager.c()).transform); return [m.e, m.f]; }catch(e){ return [Pager.tx, Pager.ty]; } };
  const blockClick = () => { _suppressNextClick = true; clearTimeout(_suppressClickT); _suppressClickT = setTimeout(() => { _suppressNextClick = false; }, 350); };

  rd.addEventListener("touchstart", (e) => {
    Pager._touching = true;
    if (!Pager.on || SelDrag.mode) return;
    // catching a page mid-slide freezes it right where it is
    const c = Pager.c(); if (c.style.transition !== "none"){ const t = curTx(); Pager.tx = t[0]; Pager.ty = t[1]; Pager.apply(false); }
    if (e.touches.length === 2){
      g = null; clearTimeout(_lpTimer); _lpTimer = null;
      const a = e.touches[0], b = e.touches[1], r = rd.getBoundingClientRect();
      pz = { d0:Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z0:Pager.z, tx0:Pager.tx, ty0:Pager.ty,
             cx:(a.clientX + b.clientX) / 2 - r.left, cy:(a.clientY + b.clientY) / 2 - r.top, scale:1 };
      Reading.pinching = true; blockClick(); return;
    }
    if (e.touches.length === 1 && !pz){
      const t = e.touches[0];
      g = { x:t.clientX, y:t.clientY, t:Date.now(), mode:null, lx:t.clientX, lt:Date.now(), vx:0, tx0:Pager.tx, ty0:Pager.ty };
    }
  }, { passive:true });

  rd.addEventListener("touchmove", (e) => {
    if (!Pager.on || SelDrag.mode) return;
    if (e.cancelable) e.preventDefault();
    if (pz && e.touches.length === 2){
      const a = e.touches[0], b = e.touches[1], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pz.scale = d / pz.d0;
      if (Pager.mode === "pdf"){
        const z = clamp(pz.z0 * pz.scale, 0.85, 5), k = z / pz.z0;
        Pager.z = z; Pager.tx = pz.cx - k * (pz.cx - pz.tx0); Pager.ty = pz.cy - k * (pz.cy - pz.ty0);
        if (z > 1) Pager.clampPan();
        Pager.apply(false);
      } else {
        toast("Text size " + Math.round(clamp(RS.fs * pz.scale, 12, 48)) + " px", 600);
      }
      return;
    }
    if (!g || e.touches.length !== 1) return;
    const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y, now = Date.now();
    if (!g.mode){
      if (Math.hypot(dx, dy) < 9) return;
      g.mode = (Pager.z > 1.02) ? "pan" : (Math.abs(dx) > Math.abs(dy) * 0.75 ? "swipe" : "none");
      clearTimeout(_lpTimer); _lpTimer = null;
      if (g.mode !== "none" && Annot.selecting) Annot.cancelSelection();
    }
    if (now - g.lt > 0){ g.vx = (t.clientX - g.lx) / (now - g.lt); g.lx = t.clientX; g.lt = now; }
    if (g.mode === "swipe"){
      let off = dx;
      if ((Pager.idx === 0 && dx > 0) || (Pager.idx === Pager.count - 1 && dx < 0)) off = dx * 0.28;   // rubber band at the ends
      Pager.tx = -Pager.idx * Pager.W + off; Pager.apply(false);
      if (Reading.chromeHidden() === false) Reading.setChrome(false);
    } else if (g.mode === "pan"){
      Pager.tx = g.tx0 + dx; Pager.ty = g.ty0 + dy; Pager.clampPan(); Pager.apply(false);
    }
  }, { passive:false });

  const finish = (e) => {
    setTimeout(() => { Pager._touching = false; }, 350);
    if (!Pager.on){ g = null; pz = null; return; }
    if (pz){
      if (e.touches && e.touches.length >= 2) return;
      const p = pz; pz = null; g = null;
      setTimeout(() => { Reading.pinching = false; }, 300); blockClick();
      if (Pager.mode === "pdf"){
        if (Pager.z < 1.06){ Pager.z = 1; Pager.place(true); }
        else { Pager.clampPan(); Pager.apply(true); clearTimeout(Pager._rzT); Pager._rzT = setTimeout(() => Pager.sharpen(), 200); }
      } else if (Math.abs(p.scale - 1) > 0.04){
        Settings.set("fs", Math.round(clamp(RS.fs * p.scale, 12, 48)));
      }
      return;
    }
    if (!g) return;
    const s = g; g = null;
    if (s.mode === "swipe"){
      const t = e.changedTouches && e.changedTouches[0]; const dx = t ? t.clientX - s.x : 0;
      const fast = Math.abs(s.vx) > 0.35, far = Math.abs(dx) > Pager.W * 0.2;
      let to = Pager.idx;
      if (far || fast){ to = Pager.idx + (dx < 0 ? 1 : -1); if (fast && !far) to = Pager.idx + (s.vx < 0 ? 1 : -1); }
      to = clamp(to, 0, Pager.count - 1);
      if (to !== Pager.idx) Pager.goto(to, true); else Pager.place(true);
      Reading.stopAuto && Reading.stopAuto(true); Follow.userScrolled(); blockClick();
    } else if (s.mode === "pan" || s.mode === "none"){ blockClick(); }
  };
  rd.addEventListener("touchend", finish, { passive:true });
  rd.addEventListener("touchcancel", finish, { passive:true });

  // the browser must never scroll the (overflow:hidden) reader on its own, e.g. to reveal a focused node
  rd.addEventListener("scroll", () => { if (Pager.on && (rd.scrollLeft || rd.scrollTop)){ rd.scrollLeft = 0; rd.scrollTop = 0; } }, { passive:true });
})();

Settings.load();
