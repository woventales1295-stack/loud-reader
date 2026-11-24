import Cocoa
import WebKit

let selfTest = ProcessInfo.processInfo.environment["LR_SELFTEST"] == "1"

// JavaScript side of the bridge: gives the page the same DesktopBridge API the Electron build used.
let shimJS = """
(function(){
  const post=(o)=>window.webkit.messageHandlers.native.postMessage(o);
  const b64=(u8)=>{ let s=''; const C=0x8000; for(let i=0;i<u8.length;i+=C) s+=String.fromCharCode.apply(null,u8.subarray(i,i+C)); return btoa(s); };
  let cb=null; const q=[];
  window.DesktopBridge={platform:'darwin',
    beginSave:(name,reuse)=>post({op:'begin',name:name,reuse:!!reuse}),
    write:(id,u8)=>post({op:'write',id:id,b64:b64(u8)}),
    finish:(id)=>post({op:'finish',id:id}), abort:(id)=>post({op:'abort',id:id}), reveal:(p)=>post({op:'reveal',path:p}),
    onOpenFile:(f)=>{ cb=f; while(q.length) f.apply(null,q.shift()); }};
  window.__lrOpen=async(path,name,size)=>{
    const parts=[]; const STEP=4194304;
    for(let o=0;o<size;o+=STEP){ const r=await post({op:'read',path:path,off:o,len:Math.min(STEP,size-o)}); const bin=atob(r); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); parts.push(u); }
    const blob=new Blob(parts); if(cb) cb(name,blob); else q.push([name,blob]);
  };
})();
"""

let selfTestJS = """
const r = {};
try {
  for (let i = 0; i < 200 && !window.__LoudReader; i++) await new Promise(s => setTimeout(s, 100));
  const L = window.__LoudReader; r.app = !!L; r.desktop = !!(L && L.Native.desktop);
  r.idb = await new Promise(res => { const q = indexedDB.open('lr-selftest', 1); q.onupgradeneeded = () => q.result.createObjectStore('a');
    q.onsuccess = () => { const tx = q.result.transaction('a', 'readwrite'); tx.objectStore('a').put(1, 'k'); tx.oncomplete = () => res(true); }; q.onerror = () => res(String(q.error)); });
  r.wasm = typeof WebAssembly; r.speech = typeof speechSynthesis;
  await L.importFiles([new File(['hello world '.repeat(300)], 't.txt')], { silent: true });
  r.docs = (await L.DB.allDocs()).length;
  const res = await L.Backup.make(); r.backup = res.results.map(x => x.uri + ':' + x.size);
  r.ok = r.app && r.desktop && r.idb === true && r.docs >= 1 && r.backup.length > 0;
} catch (e) { r.err = String(e && e.message || e); r.ok = false; }
return JSON.stringify(r);
"""

func jsStr(_ s: String) -> String {
    let d = try! JSONSerialization.data(withJSONObject: [s], options: [])
    let t = String(data: d, encoding: .utf8)!
    return String(t.dropFirst().dropLast())
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    var window: NSWindow!
    var web: WKWebView!
    var saves: [Int: (handle: FileHandle, path: String)] = [:]
    var saveSeq = 0
    var lastDir: URL?
    var pending: [URL] = []
    var pageReady = false

    func applicationDidFinishLaunching(_ n: Notification) {
        buildMenu()
        let conf = WKWebViewConfiguration()
        let ucc = WKUserContentController()
        ucc.addUserScript(WKUserScript(source: shimJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.addScriptMessageHandler(self, contentWorld: .page, name: "native")
        conf.userContentController = ucc
        web = WKWebView(frame: .zero, configuration: conf)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1120, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Loud Reader"
        window.minSize = NSSize(width: 420, height: 480)
        window.contentView = web
        window.setFrameAutosaveName("LoudReaderMain")
        if !window.setFrameUsingName("LoudReaderMain") { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        let page = Bundle.main.resourceURL!.appendingPathComponent("app/index.html")
        web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        if selfTest { DispatchQueue.main.asyncAfter(deadline: .now() + 150) { print("SELFTEST timeout"); exit(2) } }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func application(_ application: NSApplication, open urls: [URL]) {
        for u in urls { if pageReady { deliver(u) } else { pending.append(u) } }
    }

    func deliver(_ u: URL) {
        let size = ((try? FileManager.default.attributesOfItem(atPath: u.path))?[.size] as? NSNumber)?.intValue ?? 0
        web.evaluateJavaScript("window.__lrOpen(\(jsStr(u.path)),\(jsStr(u.lastPathComponent)),\(size))", completionHandler: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        for u in pending { deliver(u) }
        pending.removeAll()
        if selfTest {
            webView.callAsyncJavaScript(selfTestJS, arguments: [:], in: nil, in: .page) { result in
                switch result {
                case .success(let v):
                    let s = (v as? String) ?? "nil"
                    print("SELFTEST " + s)
                    exit(s.contains("\"ok\":true") ? 0 : 1)
                case .failure(let e):
                    print("SELFTEST failure \(e)")
                    exit(1)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = navigationAction.request.url, let sc = u.scheme?.lowercased(), sc == "http" || sc == "https" || sc == "mailto" {
            NSWorkspace.shared.open(u); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = navigationAction.request.url { NSWorkspace.shared.open(u) }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = parameters.allowsMultipleSelection
        p.canChooseDirectories = parameters.allowsDirectories
        p.canChooseFiles = true
        p.beginSheetModal(for: window) { r in completionHandler(r == .OK ? p.urls : nil) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.runModal(); completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }

    // ---- bridge calls from the page ----
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let m = message.body as? [String: Any], let op = m["op"] as? String else { replyHandler(nil, "bad message"); return }
        switch op {
        case "begin":
            let safe = ((m["name"] as? String) ?? "LoudReader.bin") as NSString
            let name = safe.lastPathComponent
            let reuse = (m["reuse"] as? Bool) ?? false
            let start: (URL) -> Void = { url in
                FileManager.default.createFile(atPath: url.path, contents: nil)
                if let h = try? FileHandle(forWritingTo: url) {
                    self.saveSeq += 1
                    self.saves[self.saveSeq] = (h, url.path)
                    self.lastDir = url.deletingLastPathComponent()
                    replyHandler(self.saveSeq, nil)
                } else { replyHandler(nil, "Can't write to \(url.path)") }
            }
            if selfTest { start(URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name)); return }
            if reuse, let d = lastDir { start(d.appendingPathComponent(name)); return }
            let panel = NSSavePanel()
            panel.nameFieldStringValue = name
            panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            panel.beginSheetModal(for: window) { r in
                if r == .OK, let u = panel.url { start(u) } else { replyHandler(NSNull(), nil) }
            }
        case "write":
            guard let id = (m["id"] as? NSNumber)?.intValue, let s = saves[id], let b = m["b64"] as? String, let d = Data(base64Encoded: b) else { replyHandler(nil, "bad write"); return }
            do { try s.handle.write(contentsOf: d); replyHandler(true, nil) } catch { replyHandler(nil, "\(error)") }
        case "finish":
            guard let id = (m["id"] as? NSNumber)?.intValue, let s = saves[id] else { replyHandler(NSNull(), nil); return }
            saves[id] = nil
            try? s.handle.close()
            replyHandler(s.path, nil)
        case "abort":
            if let id = (m["id"] as? NSNumber)?.intValue, let s = saves[id] {
                saves[id] = nil; try? s.handle.close(); try? FileManager.default.removeItem(atPath: s.path)
            }
            replyHandler(true, nil)
        case "reveal":
            if let p = m["path"] as? String { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p)]) }
            replyHandler(true, nil)
        case "read":
            guard let p = m["path"] as? String, let off = (m["off"] as? NSNumber)?.uint64Value, let len = (m["len"] as? NSNumber)?.intValue,
                  let h = FileHandle(forReadingAtPath: p) else { replyHandler(nil, "can't read"); return }
            defer { try? h.close() }
            do { try h.seek(toOffset: off); let d = try h.read(upToCount: len) ?? Data(); replyHandler(d.base64EncodedString(), nil) }
            catch { replyHandler(nil, "\(error)") }
        default:
            replyHandler(nil, "unknown op")
        }
    }

    // ---- menus ----
    @objc func zoomIn(_ s: Any?) { web.pageZoom = min(3.0, web.pageZoom + 0.1) }
    @objc func zoomOut(_ s: Any?) { web.pageZoom = max(0.5, web.pageZoom - 0.1) }
    @objc func zoomReset(_ s: Any?) { web.pageZoom = 1.0 }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "About Loud Reader", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Loud Reader", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Loud Reader", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit"); editItem.submenu = edit
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View"); viewItem.submenu = view
        let fs = view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.command, .control]
        view.addItem(.separator())
        view.addItem(withTitle: "Zoom In", action: #selector(zoomIn(_:)), keyEquivalent: "+").target = self
        view.addItem(withTitle: "Zoom Out", action: #selector(zoomOut(_:)), keyEquivalent: "-").target = self
        view.addItem(withTitle: "Actual Size", action: #selector(zoomReset(_:)), keyEquivalent: "0").target = self

        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window"); winItem.submenu = win
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        NSApp.windowsMenu = win
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
