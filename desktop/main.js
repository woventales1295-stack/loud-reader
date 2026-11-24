const { app, BrowserWindow, Menu, protocol, net, shell, dialog, ipcMain } = require("electron");
const path = require("path"); const fs = require("fs"); const { pathToFileURL } = require("url");

protocol.registerSchemesAsPrivileged([{ scheme: "loudreader", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

let win = null, rendererReady = false; const pendingFiles = []; const saves = new Map(); let saveSeq = 0;

function sendFile(p) {
  try {
    const bytes = fs.readFileSync(p); const name = path.basename(p);
    if (win && rendererReady) win.webContents.send("open-file", name, bytes); else pendingFiles.push([name, bytes]);
  } catch (e) { dialog.showErrorBox("Couldn't open file", String(e && e.message || e)); }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 820, minWidth: 420, minHeight: 480, title: "Loud Reader", backgroundColor: "#1d1330",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false }
  });
  win.loadURL("loudreader://app/index.html");
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("loudreader://")) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  // exports that still use a plain browser download (small files): ask where to save, like any Mac app
  win.webContents.session.on("will-download", (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath("downloads"), item.getFilename()) });
  });
  win.on("closed", () => { win = null; rendererReady = false; });
}

function buildMenu() {
  const template = [
    { role: "appMenu" },
    { label: "File", submenu: [{ role: "close" }] },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "togglefullscreen" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
    { role: "windowMenu" }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Streaming saves: backups can be many GB, so the renderer sends small chunks that go straight to disk.
let lastSaveDir = null;
ipcMain.handle("save:begin", async (_e, name, reuseDir) => {
  const safe = path.basename(String(name || "LoudReader.bin")); let target;
  if (reuseDir && lastSaveDir) target = path.join(lastSaveDir, safe);   // later parts of a split backup go next to the first
  else {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("downloads"), safe) });
    if (r.canceled || !r.filePath) return null; target = r.filePath; lastSaveDir = path.dirname(target);
  }
  const id = ++saveSeq; const stream = fs.createWriteStream(target);
  const rec = { stream, path: target, err: null }; stream.on("error", (e) => { rec.err = e; }); saves.set(id, rec); return id;
});
ipcMain.handle("save:write", async (_e, id, u8) => {
  const rec = saves.get(id); if (!rec || rec.err) throw new Error(rec && rec.err ? rec.err.message : "no such save");
  const buf = Buffer.from(u8.buffer ? u8.buffer : u8, u8.byteOffset || 0, u8.byteLength);
  if (!rec.stream.write(buf)) await new Promise((res) => rec.stream.once("drain", res));
  return true;
});
ipcMain.handle("save:finish", async (_e, id) => {
  const rec = saves.get(id); if (!rec) return null; saves.delete(id);
  await new Promise((res) => rec.stream.end(res)); if (rec.err) throw rec.err; return rec.path;
});
ipcMain.handle("save:abort", async (_e, id) => {
  const rec = saves.get(id); if (!rec) return false; saves.delete(id);
  try { rec.stream.destroy(); fs.unlinkSync(rec.path); } catch (_) {} return true;
});
ipcMain.handle("shell:reveal", (_e, p) => { try { shell.showItemInFolder(String(p)); } catch (_) {} return true; });
ipcMain.on("renderer-ready", () => { rendererReady = true; while (pendingFiles.length) { const [n, b] = pendingFiles.shift(); win && win.webContents.send("open-file", n, b); } });

app.on("open-file", (e, p) => { e.preventDefault(); sendFile(p); });
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_e, argv) => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } argv.slice(1).filter((a) => fs.existsSync(a) && fs.statSync(a).isFile()).forEach(sendFile); });
  app.whenReady().then(() => {
    protocol.handle("loudreader", (req) => {
      const u = new URL(req.url); const rel = decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname);
      const file = path.normalize(path.join(__dirname, "app", rel));
      if (!file.startsWith(path.join(__dirname, "app"))) return new Response("forbidden", { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    buildMenu(); createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
