import Cocoa
import WebKit
import Network
import IOBluetooth

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
    btList:()=>post({op:'btList'}), btRequest:(a,m,t,b)=>post({op:'btRequest',addr:a,m:m,t:t,b:b}), btClose:()=>post({op:'btClose'}),
    syncStart:()=>post({op:'syncStart'}), syncStop:()=>post({op:'syncStop'}),
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
  const h = await L.Sync.startHost(); r.host = h.addrs;
  const ping = await (await fetch('http://127.0.0.1:' + h.port + '/ping?c=' + h.code)).json(); r.ping = ping.ok;
  const sm = await L.Sync.sync('127.0.0.1:' + h.port, h.code); r.sync = sm.peer;
  L.Sync.stopHost();
  r.ok = r.app && r.desktop && r.idb === true && r.docs >= 1 && r.backup.length > 0 && r.ping === true && !!r.sync;
} catch (e) { r.err = String(e && e.message || e); r.ok = false; }
return JSON.stringify(r);
"""

func jsStr(_ s: String) -> String {
    let d = try! JSONSerialization.data(withJSONObject: [s], options: [])
    let t = String(data: d, encoding: .utf8)!
    return String(t.dropFirst().dropLast())
}

// Small HTTP/1.1 server (text in, text out) for Wi-Fi sync. Requests are forwarded to the page's JavaScript.
final class SyncServer {
    private var listener: NWListener?
    private let q = DispatchQueue(label: "lr.sync")
    var forward: ((String, String, String, @escaping (Int, String) -> Void) -> Void)?

    func start(_ done: @escaping (Int?) -> Void) {
        stop()
        attempt(fixed: true, done)
    }

    private func attempt(fixed: Bool, _ done: @escaping (Int?) -> Void) {
        var l: NWListener?
        if fixed, let p = NWEndpoint.Port(rawValue: 8765) { l = try? NWListener(using: .tcp, on: p) } else { l = try? NWListener(using: .tcp) }
        guard let lis = l else { if fixed { attempt(fixed: false, done) } else { done(nil) }; return }
        listener = lis
        var fired = false
        lis.stateUpdateHandler = { [weak self] st in
            switch st {
            case .ready:
                if !fired { fired = true; done(Int(lis.port?.rawValue ?? 0)) }
            case .failed:
                lis.cancel()
                if !fired { fired = true; if fixed { self?.attempt(fixed: false, done) } else { done(nil) } }
            default: break
            }
        }
        lis.newConnectionHandler = { [weak self] c in self?.accept(c) }
        lis.start(queue: q)
    }

    func stop() { listener?.cancel(); listener = nil }

    static func localIPs() -> [String] {
        var out: [String] = []
        var ifa: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifa) == 0, let first = ifa else { return out }
        defer { freeifaddrs(ifa) }
        var p: UnsafeMutablePointer<ifaddrs>? = first
        while let cur = p {
            let f = Int32(cur.pointee.ifa_flags)
            if let sa = cur.pointee.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET), (f & IFF_UP) != 0, (f & IFF_LOOPBACK) == 0 {
                var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                if getnameinfo(sa, socklen_t(sa.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                    let ip = String(cString: host)
                    let parts = ip.split(separator: ".").compactMap { Int($0) }
                    if parts.count == 4, parts[0] == 10 || (parts[0] == 172 && (16...31).contains(parts[1])) || (parts[0] == 192 && parts[1] == 168) { out.append(ip) }
                }
            }
            p = cur.pointee.ifa_next
        }
        return out
    }

    private func accept(_ c: NWConnection) {
        c.start(queue: q)
        var buf = Data()
        func more() {
            c.receive(minimumIncompleteLength: 1, maximumLength: 262144) { [weak self] data, _, done, err in
                guard let self = self else { c.cancel(); return }
                if let d = data { buf.append(d) }
                if let req = self.parse(buf) { self.handle(c, req); return }
                if buf.count > 17 * 1024 * 1024 || done || err != nil { c.cancel(); return }
                more()
            }
        }
        more()
    }

    private func parse(_ buf: Data) -> (String, String, String)? {
        guard let r = buf.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let head = String(decoding: buf[buf.startIndex..<r.lowerBound], as: UTF8.self)
        let lines = head.components(separatedBy: "\r\n")
        let parts = (lines.first ?? "").split(separator: " ")
        guard parts.count >= 2 else { return ("BAD", "/", "") }
        var len = 0
        for l in lines.dropFirst() { let kv = l.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }; if kv.count == 2, kv[0].lowercased() == "content-length" { len = Int(kv[1]) ?? 0 } }
        let body = buf[r.upperBound...]
        if body.count < len { return nil }
        return (String(parts[0]), String(parts[1]), String(decoding: body.prefix(len), as: UTF8.self))
    }

    private func handle(_ c: NWConnection, _ req: (String, String, String)) {
        if req.0 == "OPTIONS" { respond(c, 204, ""); return }
        if req.0 == "BAD" { respond(c, 400, ""); return }
        guard let fwd = forward else { respond(c, 503, "{}"); return }
        fwd(req.0, req.1, req.2) { [weak self] st, tx in self?.respond(c, st, tx) }
    }

    private func respond(_ c: NWConnection, _ status: Int, _ text: String) {
        let b = Data(text.utf8)
        let reason = status == 200 ? "OK" : (status == 204 ? "No Content" : "Error")
        let head = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: \(b.count)\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Allow-Private-Network: true\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        var out = Data(head.utf8); out.append(b)
        c.send(content: out, completion: .contentProcessed { _ in c.cancel() })
    }
}

// Bluetooth (classic RFCOMM) client: talks to the phone's "Loud Reader Sync" service with length-prefixed JSON frames.
final class BTLink: NSObject, IOBluetoothRFCOMMChannelDelegate {
    static let uuid: [UInt8] = [0x5a,0x1a,0x3f,0x0e,0x6c,0x0b,0x4f,0x6e,0x9d,0x27,0x4c,0x6f,0x75,0x64,0x52,0x64]
    var addr = ""
    private var device: IOBluetoothDevice?
    private var channel: IOBluetoothRFCOMMChannel?
    private var onOpen: ((String?) -> Void)?
    private var pending: ((Int, String, String?) -> Void)?
    private var buf = Data()
    private let lock = NSLock()
    private let writeQ = DispatchQueue(label: "lr.bt.write")
    var isOpen: Bool { channel != nil && (channel?.isOpen() ?? false) }

    static func paired() -> [[String: String]] {
        let devs = (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice]) ?? []
        return devs.map { ["name": $0.name ?? "Unknown device", "addr": $0.addressString ?? ""] }
    }

    func connect(_ address: String, _ done: @escaping (String?) -> Void) {
        close()
        addr = address
        guard let dev = IOBluetoothDevice(addressString: address) else { done("That Bluetooth device wasn't found."); return }
        device = dev
        onOpen = done
        if dev.performSDPQuery(self) != kIOReturnSuccess { finishOpen("Couldn't start talking to the phone over Bluetooth.") }
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in self?.finishOpen("Timed out connecting. Is \"Wait over Bluetooth\" showing on the phone?") }
    }

    private func finishOpen(_ err: String?) {
        guard let cb = onOpen else { return }
        onOpen = nil
        cb(err)
    }

    @objc func sdpQueryComplete(_ dev: IOBluetoothDevice!, status: IOReturn) {
        guard status == kIOReturnSuccess else { finishOpen("The phone doesn't offer the Loud Reader sync service. On the phone, tap \"Wait over Bluetooth\" first."); return }
        let u = BTLink.uuid.withUnsafeBytes { IOBluetoothSDPUUID(bytes: $0.baseAddress, length: 16) }
        guard let rec = dev.getServiceRecord(for: u) else { finishOpen("The phone isn't waiting for a sync. On the phone, tap \"Wait over Bluetooth\"."); return }
        var cid: BluetoothRFCOMMChannelID = 0
        guard rec.getRFCOMMChannelID(&cid) == kIOReturnSuccess else { finishOpen("Couldn't find the sync channel on the phone."); return }
        var ch: IOBluetoothRFCOMMChannel?
        if dev.openRFCOMMChannelAsync(&ch, withChannelID: cid, delegate: self) != kIOReturnSuccess { finishOpen("Couldn't open the Bluetooth channel."); return }
        channel = ch
    }

    func rfcommChannelOpenComplete(_ rfcommChannel: IOBluetoothRFCOMMChannel!, status error: IOReturn) {
        finishOpen(error == kIOReturnSuccess ? nil : "Bluetooth connection failed (is the phone paired with this Mac?).")
    }

    func rfcommChannelClosed(_ rfcommChannel: IOBluetoothRFCOMMChannel!) {
        channel = nil
        if let p = pending { pending = nil; p(0, "", "The Bluetooth connection closed.") }
    }

    func rfcommChannelData(_ rfcommChannel: IOBluetoothRFCOMMChannel!, data dataPointer: UnsafeMutableRawPointer!, length dataLength: Int) {
        lock.lock(); buf.append(Data(bytes: dataPointer, count: dataLength)); lock.unlock()
        parse()
    }

    private func parse() {
        lock.lock()
        guard buf.count >= 4 else { lock.unlock(); return }
        let len = Int(buf[buf.startIndex]) << 24 | Int(buf[buf.startIndex + 1]) << 16 | Int(buf[buf.startIndex + 2]) << 8 | Int(buf[buf.startIndex + 3])
        guard buf.count >= 4 + len else { lock.unlock(); return }
        let payload = Data(buf.subdata(in: (buf.startIndex + 4)..<(buf.startIndex + 4 + len)))
        buf = Data(buf.dropFirst(4 + len))
        lock.unlock()
        var st = 500, tx = "{}"
        if let o = (try? JSONSerialization.jsonObject(with: payload)) as? [String: Any] { st = (o["s"] as? NSNumber)?.intValue ?? 500; tx = (o["x"] as? String) ?? "{}" }
        if let p = pending { pending = nil; p(st, tx, nil) }
    }

    func request(_ method: String, _ target: String, _ body: String, _ done: @escaping (Int, String, String?) -> Void) {
        guard let ch = channel, ch.isOpen() else { done(0, "", "Not connected over Bluetooth."); return }
        guard let json = try? JSONSerialization.data(withJSONObject: ["m": method, "t": target, "b": body]) else { done(0, "", "bad request"); return }
        pending = done
        var frame = Data()
        var n = UInt32(json.count).bigEndian
        withUnsafeBytes(of: &n) { frame.append(contentsOf: $0) }
        frame.append(json)
        let mtu = max(64, Int(ch.getMTU()))
        writeQ.async { [weak self] in
            var off = 0
            while off < frame.count {
                let end = min(frame.count, off + mtu)
                var chunk = [UInt8](frame[off..<end])
                if ch.writeSync(&chunk, length: UInt16(chunk.count)) != kIOReturnSuccess {
                    DispatchQueue.main.async { if let p = self?.pending { self?.pending = nil; p(0, "", "Sending over Bluetooth failed.") } }
                    return
                }
                off = end
            }
        }
    }

    func close() {
        channel?.close(); channel = nil
        device?.closeConnection(); device = nil
        buf = Data(); pending = nil; onOpen = nil
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    var window: NSWindow!
    var web: WKWebView!
    var saves: [Int: (handle: FileHandle, path: String)] = [:]
    var saveSeq = 0
    var lastDir: URL?
    var pending: [URL] = []
    var pageReady = false
    let sync = SyncServer()
    var btLink: BTLink?

    func applicationDidFinishLaunching(_ n: Notification) {
        buildMenu()
        sync.forward = { [weak self] method, target, body, reply in
            DispatchQueue.main.async {
                guard let self = self else { reply(503, "{}"); return }
                self.web.callAsyncJavaScript("return await window.__lrSyncHandle(m, t, b)", arguments: ["m": method, "t": target, "b": body], in: nil, in: .page) { result in
                    if case .success(let v) = result, let arr = v as? [Any], arr.count == 2, let st = (arr[0] as? NSNumber)?.intValue, let tx = arr[1] as? String { reply(st, tx) } else { reply(500, "{}") }
                }
            }
        }
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
        case "syncStart":
            sync.start { port in
                DispatchQueue.main.async {
                    guard let p = port else { replyHandler("{}", nil); return }
                    let ips = SyncServer.localIPs().map { "\"\($0)\"" }.joined(separator: ",")
                    replyHandler("{\"port\":\(p),\"ips\":[\(ips)]}", nil)
                }
            }
        case "syncStop":
            sync.stop(); replyHandler(true, nil)
        case "btList":
            let d = (try? JSONSerialization.data(withJSONObject: BTLink.paired())) ?? Data("[]".utf8)
            replyHandler(String(decoding: d, as: UTF8.self), nil)
        case "btRequest":
            guard let addr = m["addr"] as? String, let me = m["m"] as? String, let t = m["t"] as? String else { replyHandler(nil, "bad request"); return }
            let body = (m["b"] as? String) ?? ""
            let go: (BTLink) -> Void = { link in
                link.request(me, t, body) { st, tx, err in
                    DispatchQueue.main.async { if let e = err { replyHandler(nil, e) } else { replyHandler([st, tx], nil) } }
                }
            }
            if let l = btLink, l.addr == addr, l.isOpen { go(l); return }
            let l = BTLink(); btLink = l
            l.connect(addr) { err in
                DispatchQueue.main.async { if let e = err { replyHandler(nil, e) } else { go(l) } }
            }
        case "btClose":
            btLink?.close(); btLink = nil; replyHandler(true, nil)
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
