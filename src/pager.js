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
    return !!RS.flip && document.body.classList.contains("reading") && Reader.words.length > 0 && !(typeof Ink !== "undefined" && Ink.active);
  },
  sync(){
    const want = this.want();
    if (want && this.on && (this.mode !== Reader.mode || this.wordsRef !== Reader.words)){ this.disable(true); this.enable(); return; }
    if (want && !this.on) this.enable();
    else if (!want && this.on) this.disable();
  },
  enable(){
    if (this.on) return;
    try{ Reading.update(true); }catch(e){}
    const pos = Reading.pos || 0;
    Reading.stopAuto && Reading.stopAuto(true);
    this.on = true; this.mode = Reader.mode; this.wordsRef = Reader.words; this.z = 1;
    document.body.classList.add("paged");
    const rd = this.rd(); rd.scrollTop = 0; rd.scrollLeft = 0;
    this.layout();
    this.idx = clamp(this.pageOfWord(pos), 0, this.count - 1);
    this.place(false);
    Reading.setChrome(false);
    Reading.pos = this.firstWord(this.idx) || pos;
    Reading.updateProgressUI(); this.label();
    // late layout (fonts, first canvases): settle once more
    setTimeout(() => { if (this.on){ this.relayout({ mode:Reader.mode, i:pos, p:this.idx + 1 }); } }, 250);
  },
  disable(keepPos){
    if (!this.on) return;
    const pos = Reading.pos || 0;
    this.on = false; this.z = 1;
    document.body.classList.remove("paged"); this.label();
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
  layout(){
    this.metrics();
    const c = this.c(), st = c.style;
    st.transition = "none";
    if (this.mode === "pdf"){
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
      const wc = this.W - 2 * this.mx;
      st.marginLeft = this.mx + "px"; st.marginTop = this.top + "px";
      st.width = wc + "px"; st.height = this.H + "px"; st.columnWidth = wc + "px"; st.columnGap = (2 * this.mx) + "px";
      void c.offsetWidth;
      this.count = Math.max(1, Math.round((c.scrollWidth + 2 * this.mx) / this.W));
    }
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
    this.z = 1; this.layout();
    this.idx = clamp(Reader.mode === "pdf" ? (a.p || 1) - 1 : this.pageOfWord(a.i || 0), 0, this.count - 1);
    this.place(false);
    Reading.pos = this.firstWord(this.idx); Reading.updateProgressUI(); this.label();
    if (this.mode === "pdf"){ const w = Reader.pageWrappers[this.idx + 1]; if (w && w.dataset.rendered !== "1") renderPageCanvas(w, this.idx + 1); }
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
    const s = w.span; if (!s) return 0;
    return clamp(Math.floor((s.offsetLeft + 2) / this.W), 0, this.count - 1);
  },
  firstWord(idx){
    if (this.mode === "pdf") return Reader.wordIndexForPage(idx + 1) || 0;
    const n = Reader.words.length; let lo = 0, hi = n - 1, ans = n - 1;
    while (lo <= hi){
      const mid = (lo + hi) >> 1, s = Reader.words[mid].span;
      if (!s){ hi = mid - 1; continue; }
      if (Math.floor((s.offsetLeft + 2) / this.W) >= idx){ ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return ans;
  },

  /* ---------- moving ---------- */
  apply(animate){
    const c = this.c(); c.style.transition = animate ? "transform .34s cubic-bezier(.22,.8,.24,1)" : "none";
    c.style.transform = "translate3d(" + this.tx + "px," + this.ty + "px,0) scale(" + this.z + ")";
  },
  place(animate){
    this.z = 1; this.tx = -this.idx * this.W; this.ty = 0; this.apply(animate);
  },
  goto(idx, animate){
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
    n.hidden = !this.on; if (this.on) n.textContent = (this.idx + 1) + " / " + this.count;
  },
  afterMove(){
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
