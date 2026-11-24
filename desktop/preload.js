const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("DesktopBridge", {
  platform: process.platform,
  beginSave: (name) => ipcRenderer.invoke("save:begin", name),          // -> id | null (user cancelled)
  write: (id, u8) => ipcRenderer.invoke("save:write", id, u8),
  finish: (id) => ipcRenderer.invoke("save:finish", id),                // -> saved path
  abort: (id) => ipcRenderer.invoke("save:abort", id),
  reveal: (p) => ipcRenderer.invoke("shell:reveal", p),
  onOpenFile: (cb) => { ipcRenderer.on("open-file", (_e, name, bytes) => cb(name, bytes)); ipcRenderer.send("renderer-ready"); }
});
