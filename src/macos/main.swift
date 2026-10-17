import AppKit
import WebKit
import CoreImage.CIFilterBuiltins

struct Note: Codable {
  var id: String
  var text: String
  var status: String
  var board: String
  var revision: Int
  var deleted: Bool
}
struct Snapshot: Codable {
  var epoch: String
  var notes: [Note]
  var role: String
}
struct Connection: Codable {
  var server: String
  var token: String
}
final class NoteCanvas: NSView {
  override var isFlipped: Bool { true }
  override func draw(_ rect: NSRect) {
    NSColor(calibratedRed: 0.99, green: 0.96, blue: 0.83, alpha: 1).setFill()
    bounds.fill()
  }
}
final class CardWindow: NSWindow {
  var locked = true
  override var canBecomeKey: Bool { !locked }
  override var canBecomeMain: Bool { !locked }
}
final class App: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  var card: CardWindow!
  var controls: NSWindow!
  var statusItem: NSStatusItem!
  var web: WKWebView?
  var timer: Timer?
  var connection: Connection?
  var snapshot: Snapshot?
  var previousApp: NSRunningApplication?
  var inFlight = false
  var generation = 0
  var draftSummary = ""
  var mode = 1
  var probe = CommandLine.arguments.contains("--probe")
  var webProbePhase = 1
  var webProbeRunning = false
  var pairing = false
  var probePolls = 0
  var probeBaseline: pid_t = 0
  var serverField = NSTextField(string: "http://127.0.0.1:9847")
  var inviteField = NSSecureTextField(string: "")
  var message = NSTextField(wrappingLabelWithString: "Enter a one-time pairing code to connect your notes.")
  var cardStatus = NSTextField(wrappingLabelWithString: "Not connected")
  var qr = NSImageView()
  var inviteLink = NSTextField(wrappingLabelWithString: "")
  let dataDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent(CommandLine.arguments.contains("--probe") ? "WorkFleet-Probe" : "WorkFleet", isDirectory: true)
  var configURL: URL { dataDir.appendingPathComponent("connection.json") }
  var cacheURL: URL { dataDir.appendingPathComponent("snapshot.json") }
  let session: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 8
    return URLSession(configuration: config)
  }()
  func diagnostic(_ event: String, _ fields: [String: Any] = [:]) {
    var value = fields
    value["event"] = event
    value["time"] = ISO8601DateFormatter().string(from: Date())
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
       let line = String(data: data, encoding: .utf8) { print(line); fflush(stdout) }
  }
  func button(_ title: String, _ action: Selector) -> NSButton {
    NSButton(title: title, target: self, action: action)
  }
  func applicationDidFinishLaunching(_ notification: Notification) {
    try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true,
                                             attributes: [.posixPermissions: 0o700])
    connection = (try? Data(contentsOf: configURL)).flatMap { try? JSONDecoder().decode(Connection.self, from: $0) }
    snapshot = (try? Data(contentsOf: cacheURL)).flatMap { try? JSONDecoder().decode(Snapshot.self, from: $0) }
    if let c = connection { serverField.stringValue = c.server }
    let launchArguments = CommandLine.arguments
    if let index = launchArguments.firstIndex(of: "--mode"), index + 1 < launchArguments.count,
       let selected = Int(launchArguments[index + 1]), (0...2).contains(selected) { mode = selected }
    let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
    card = CardWindow(contentRect: NSRect(x: screen.maxX - 470, y: screen.maxY - 540, width: 440, height: 500),
                      styleMask: [.borderless, .resizable], backing: .buffered, defer: false)
    card.minSize = NSSize(width: 380, height: 320)
    card.backgroundColor = NSColor(calibratedRed: 0.99, green: 0.96, blue: 0.83, alpha: 1)
    card.isOpaque = true
    card.hasShadow = true
    card.isReleasedWhenClosed = false
    card.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    card.setFrameAutosaveName(probe ? "probe-card" : "backlog-card")
    controls = NSWindow(contentRect: NSRect(x: screen.minX + 70, y: screen.midY - 220, width: 470, height: 540),
                        styleMask: [.titled, .closable], backing: .buffered, defer: false)
    controls.title = "Work Fleet · Connection and display"
    controls.isReleasedWhenClosed = false
    let modes = NSPopUpButton()
    modes.addItems(withTitles: ["Normal window", "Above desktop icons", "Below desktop icons (experimental)"])
    modes.selectItem(at: mode)
    modes.target = self; modes.action = #selector(changeMode(_:))
    qr.frame.size = NSSize(width: 170, height: 170)
    inviteLink.isSelectable = true
    controls.appearance = NSAppearance(named: .aqua)
    let controlCanvas = NoteCanvas(frame: NSRect(x: 0, y: 0, width: 470, height: 760))
    let items: [(NSView, CGFloat)] = [
      (NSTextField(labelWithString: "Server URL"), 20), (serverField, 28),
      (NSTextField(labelWithString: "One-time pairing code (valid for 5 minutes)"), 20), (inviteField, 28),
      (button("Pair this Mac", #selector(pair)), 32), (message, 52), (modes, 28),
      (button("Unlock / Edit", #selector(unlock)), 32), (button("Lock again", #selector(lock)), 32),
      (button("Create phone pairing QR code (admin)", #selector(invite)), 32), (qr, 180), (inviteLink, 80)]
    var controlY: CGFloat = 18
    for (view, height) in items {
      view.frame = NSRect(x: 18, y: controlY, width: 424, height: height)
      controlCanvas.addSubview(view); controlY += height + 9
    }
    controlCanvas.frame.size.height = controlY + 18
    let controlScroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 470, height: 540))
    controlScroll.hasVerticalScroller = true; controlScroll.documentView = controlCanvas
    controls.contentView = controlScroll
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    statusItem.button?.title = "WF"
    let menu = NSMenu()
    for (title, selector) in [("Quick capture / Unlock", #selector(unlock)), ("Lock", #selector(lock)),
                               ("Connection and display…", #selector(showControls)), ("Quit", #selector(quit))] {
      let item = NSMenuItem(title: title, action: selector, keyEquivalent: "")
      item.target = self; menu.addItem(item)
    }
    statusItem.menu = menu
    applyLockedPolicy(); render()
    card.orderBack(nil)
    diagnostic("launch", ["container": NSHomeDirectory().contains("/Containers/"),
      "screens": NSScreen.screens.count, "locked": card.locked, "level": card.level.rawValue])
    let args = CommandLine.arguments
    if let n = args.firstIndex(of: "--server"), n + 1 < args.count { serverField.stringValue = args[n + 1] }
    if probe { connection = nil; snapshot = nil; render() }
    if let n = args.firstIndex(of: "--invite"), n + 1 < args.count { inviteField.stringValue = args[n + 1]; pair() }
    if probe {
      probeBaseline = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
      let outside = URL(fileURLWithPath: "/Users/Shared/work-fleet-denial-\(UUID().uuidString)")
      do {
        try Data("sandbox-test".utf8).write(to: outside)
        try? FileManager.default.removeItem(at: outside)
        diagnostic("sandbox_write", ["denied": false])
      } catch {
        diagnostic("sandbox_write", ["denied": true, "errorCode": (error as NSError).code,
                                      "errorDomain": (error as NSError).domain])
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 55) {
        self.diagnostic("probe_timeout", ["received": self.probePolls]); NSApp.terminate(nil)
      }
    }
    timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.poll() }
    poll()
    if connection == nil && !probe { showControls() }
  }
  func applyLockedPolicy() {
    card.locked = true; card.ignoresMouseEvents = true
    switch mode {
    case 0: card.level = .normal
    case 2: card.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) - 1)
    default: card.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
    }
  }
  @objc func changeMode(_ sender: NSPopUpButton) {
    mode = sender.indexOfSelectedItem
    if card.locked { applyLockedPolicy(); card.orderBack(nil) }
    diagnostic("mode", ["mode": mode, "level": card.level.rawValue])
  }
  @objc func showControls() { NSApp.activate(ignoringOtherApps: true); controls.makeKeyAndOrderFront(nil) }
  @objc func quit() {
    guard let editor = web else { NSApp.terminate(nil); return }
    editor.evaluateJavaScript("typeof window.workFleetFlushDraft === 'function' ? window.workFleetFlushDraft() : !(document.getElementById('note-text')?.value)") { value, _ in
      if value as? Bool == true { NSApp.terminate(nil) }
      else {
        self.message.stringValue = "A draft is not stored yet or is still sending. Copy or export the text, or wait for the send to finish."
        self.unlock(); self.showControls()
      }
    }
  }
  func request(_ path: String, body: [String: Any]? = nil, authenticated: Bool = true,
               completion: @escaping (Int, Data?) -> Void) {
    let address = authenticated ? connection?.server : serverField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let base = address, let url = URL(string: base + path) else { completion(0, nil); return }
    var req = URLRequest(url: url)
    if authenticated, let token = connection?.token { req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
    if let body = body {
      req.httpMethod = "POST"; req.httpBody = try? JSONSerialization.data(withJSONObject: body)
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    session.dataTask(with: req) { data, response, _ in
      DispatchQueue.main.async { completion((response as? HTTPURLResponse)?.statusCode ?? 0, data) }
    }.resume()
  }
  @objc func pair() {
    guard !pairing else { return }
    if let editor = web {
      editor.evaluateJavaScript("typeof window.workFleetFlushDraft === 'function' ? window.workFleetFlushDraft() : !(document.getElementById('note-text')?.value)") { value, _ in
        if value as? Bool == true { self.performPair() }
        else { self.message.stringValue = "A draft is not stored yet. Copy or export the text, then pair again." }
      }
    } else { performPair() }
  }
  func performPair() {
    guard !pairing else { return }
    let base = serverField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard let url = URL(string: base), url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
          url.path.isEmpty, url.scheme == "https" || (url.scheme == "http" && ["127.0.0.1", "localhost"].contains(url.host ?? "")) else {
      message.stringValue = "Use HTTPS. On this Mac you can use http://127.0.0.1:9847."; return
    }
    serverField.stringValue = base
    if !card.locked { lock() }
    pairing = true
    request("/api/pair", body: ["code": inviteField.stringValue, "name": "Mac desktop"], authenticated: false) { status, data in
      self.pairing = false
      guard status == 200, let data = data,
            let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let token = result["token"] as? String else { self.message.stringValue = "Pairing failed (\(status)). Get a new invite."; return }
      if !self.card.locked { self.lock() }
      let nextConnection = Connection(server: base, token: token)
      do {
        try JSONEncoder().encode(nextConnection).write(to: self.configURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: self.configURL.path)
      } catch { self.message.stringValue = "Could not save the new connection; still using the previous server. Try again with a new invite."; return }
      self.generation += 1
      self.connection = nextConnection
      self.snapshot = nil
      self.draftSummary = ""
      try? FileManager.default.removeItem(at: self.cacheURL)
      self.web?.stopLoading(); self.web = nil
      self.inviteField.stringValue = ""; self.message.stringValue = "Paired. The locked note still receives updates."
      self.diagnostic("paired"); self.poll()
      if self.probe { self.invite() }
    }
  }
  func poll() {
    guard connection != nil, !inFlight else { return }
    inFlight = true
    let currentGeneration = generation
    let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
    request("/api/snapshot") { status, data in
      self.inFlight = false
      guard currentGeneration == self.generation else { return }
      if status == 200, let data = data, let snap = try? JSONDecoder().decode(Snapshot.self, from: data) {
        self.snapshot = snap
        do { try data.write(to: self.cacheURL, options: .atomic) }
        catch { self.message.stringValue = "Synced, but the offline cache could not be written." }
        self.cardStatus.stringValue = "Synced · \(DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .short)) · Locked\(self.draftSummary)"
        if self.card.locked { self.render() }
        self.diagnostic("snapshot", ["count": snap.notes.filter { !$0.deleted }.count,
          "revisionSum": snap.notes.reduce(0) { $0 + $1.revision },
          "locked": self.card.locked, "ignoresMouse": self.card.ignoresMouseEvents,
          "canBecomeKey": self.card.canBecomeKey, "isKey": self.card.isKeyWindow,
          "frontmostUnchanged": front == NSWorkspace.shared.frontmostApplication?.processIdentifier])
        if self.probe {
          self.probePolls += 1
          if self.probePolls == 3 {
            self.diagnostic("background_focus", ["unchanged": self.probeBaseline == NSWorkspace.shared.frontmostApplication?.processIdentifier])
            if let content = self.card.contentView,
               let bitmap = content.bitmapImageRepForCachingDisplay(in: content.bounds) {
              content.cacheDisplay(in: content.bounds, to: bitmap)
              if let png = bitmap.representation(using: .png, properties: [:]) {
                try? png.write(to: self.dataDir.appendingPathComponent("desktop.png"))
              }
            }
            self.unlock()
            self.diagnostic("unlocked", ["ignoresMouse": self.card.ignoresMouseEvents, "canBecomeKey": self.card.canBecomeKey])
            if CommandLine.arguments.contains("--web-probe") { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
              self.lock()
              self.diagnostic("relocked", ["ignoresMouse": self.card.ignoresMouseEvents, "canBecomeKey": self.card.canBecomeKey, "isKey": self.card.isKeyWindow])
              DispatchQueue.main.asyncAfter(deadline: .now() + 1) { NSApp.terminate(nil) }
            }
          }
        }
      } else {
        self.cardStatus.stringValue = (status == 401 ? "Access is no longer valid · Pair again" : "Offline · Showing the last content") + self.draftSummary
        self.diagnostic("sync_error", ["status": status])
      }
    }
  }
  func render() {
    guard card.locked else { return }
    let width = max(360, card.contentLayoutRect.width)
    let canvas = NoteCanvas(frame: NSRect(x: 0, y: 0, width: width, height: card.frame.height))
    var y: CGFloat = 20
    func label(_ text: String, size: CGFloat, bold: Bool = false) {
      let field = NSTextField(wrappingLabelWithString: text)
      field.font = bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size)
      field.textColor = NSColor(calibratedWhite: 0.15, alpha: 1)
      let measured = NSAttributedString(string: text, attributes: [.font: field.font!]).boundingRect(
        with: NSSize(width: width - 48, height: 10000), options: [.usesLineFragmentOrigin, .usesFontLeading])
      let height = ceil(measured.height) + 10
      field.frame = NSRect(x: 20, y: y, width: width - 40, height: height)
      canvas.addSubview(field); y += height + 8
    }
    label("My Backlog", size: 23, bold: true)
    cardStatus.removeFromSuperview()
    cardStatus.textColor = NSColor(calibratedWhite: 0.35, alpha: 1)
    cardStatus.font = .systemFont(ofSize: 12)
    cardStatus.frame = NSRect(x: 20, y: y, width: width - 40, height: 38)
    canvas.addSubview(cardStatus); y += 46
    let visible = (snapshot?.notes ?? []).filter { !$0.deleted && $0.status != "done" }
    if visible.isEmpty { label("Use WF in the menu bar to capture a thought.", size: 15) }
    for note in visible {
      label("\(note.status == "in_progress" ? "◐ In Progress" : "○ Todo") · \(note.board)", size: 12, bold: true)
      label(note.text, size: 15); y += 12
    }
    canvas.frame.size.height = max(y + 20, card.frame.height)
    let scroll = NSScrollView(frame: NSRect(origin: .zero, size: card.frame.size))
    scroll.hasVerticalScroller = true
    scroll.drawsBackground = true
    scroll.backgroundColor = card.backgroundColor
    scroll.documentView = canvas
    card.contentView = scroll
    scroll.contentView.scroll(to: .zero)
    scroll.reflectScrolledClipView(scroll.contentView)
    scroll.layoutSubtreeIfNeeded()
    scroll.displayIfNeeded()
  }
  @objc func unlock() {
    if pairing { message.stringValue = "Pairing in progress. Please wait."; showControls(); return }
    guard let connection = connection else { showControls(); return }
    if !card.locked { card.makeKeyAndOrderFront(nil); return }
    previousApp = NSWorkspace.shared.frontmostApplication
    card.locked = false; card.ignoresMouseEvents = false; card.level = .normal
    if web == nil {
      let configuration = WKWebViewConfiguration()
      if probe {
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addUserScript(WKUserScript(source: "window.validationErrors = []; window.addEventListener('error', e => window.validationErrors.push(e.message)); window.addEventListener('unhandledrejection', e => window.validationErrors.push(String(e.reason)));", injectionTime: .atDocumentStart, forMainFrameOnly: true))
      }
      let encoded = String(data: try! JSONSerialization.data(withJSONObject: ["token": connection.token]), encoding: .utf8)!
      let origin = String(data: try! JSONSerialization.data(withJSONObject: [connection.server]), encoding: .utf8)!
      let script = "if(location.origin === \(origin)[0]) { window.workFleetNative = \(encoded); }"
      configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
      let view = WKWebView(frame: card.contentView?.bounds ?? .zero, configuration: configuration)
      view.navigationDelegate = self
      view.load(URLRequest(url: URL(string: connection.server)!))
      web = view
    }
    card.contentView = web
    NSApp.activate(ignoringOtherApps: true); card.makeKeyAndOrderFront(nil)
  }
  @objc func lock() {
    guard !card.locked else { return }
    if let editor = web {
      editor.evaluateJavaScript("typeof window.workFleetDraftState === 'function' ? window.workFleetDraftState() : null") { result, _ in
        guard let state = result as? [String: Any] else { return }
        if state["storageFailed"] as? Bool == true { self.draftSummary = " · A draft could not be stored; unlock to copy its text" }
        else if (state["count"] as? Int ?? 0) > 0 { self.draftSummary = " · Drafts remain on this Mac" }
        else { self.draftSummary = "" }
        if self.card.locked { self.cardStatus.stringValue = "Locked" + self.draftSummary }
      }
    }
    // Keep the WebView alive, including memory text when local persistence failed.
    card.resignKey(); card.resignMain(); applyLockedPolicy(); render(); card.orderBack(nil)
    if let app = previousApp, app.processIdentifier != ProcessInfo.processInfo.processIdentifier { app.activate(options: []) }
    previousApp = nil
  }
  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = navigationAction.request.url, let base = connection.flatMap({ URL(string: $0.server) }),
          url.scheme == base.scheme, url.host == base.host, url.port == base.port else { decisionHandler(.cancel); return }
    decisionHandler(.allow)
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard probe && CommandLine.arguments.contains("--web-probe") && !webProbeRunning else { return }
    webProbeRunning = true
    diagnostic("web_start", ["phase": webProbePhase])
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
      webView.evaluateJavaScript("JSON.stringify({errors:window.validationErrors, ready:document.readyState, native:!!window.workFleetNative, initialized:typeof window.workFleetFlushDraft, state:document.getElementById('connection-state')?.textContent, text:document.getElementById('draft-state')?.textContent})") { value, error in
        self.diagnostic("web_state", ["state": value as? String ?? "unavailable", "evaluationError": error != nil])
      }
    }
    let args = CommandLine.arguments
    let peer = args.firstIndex(of: "--peer-invite").map { args[$0 + 1] } ?? ""
    guard let url = Bundle.main.url(forResource: "web-probe", withExtension: "js"),
          let script = try? String(contentsOf: url, encoding: .utf8) else { return }
    webView.callAsyncJavaScript(script, arguments: ["phase": webProbePhase, "peerCode": peer], in: nil, in: .page) { result in
      switch result {
      case .success(let checks):
        self.diagnostic("web_checks", ["phase": self.webProbePhase, "checks": checks as? [String] ?? []])
        if self.webProbePhase == 1 { self.webProbePhase = 2; self.webProbeRunning = false; webView.reload() }
        else {
          webView.takeSnapshot(with: nil) { image, _ in
            if let tiff = image?.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
               let png = rep.representation(using: .png, properties: [:]) {
              try? png.write(to: self.dataDir.appendingPathComponent("editor.png"))
            }
          }
          self.lock()
          self.diagnostic("relocked", ["ignoresMouse": self.card.ignoresMouseEvents, "canBecomeKey": self.card.canBecomeKey, "isKey": self.card.isKeyWindow])
          DispatchQueue.main.asyncAfter(deadline: .now() + 1) { NSApp.terminate(nil) }
        }
      case .failure(let error):
        self.diagnostic("web_error", ["description": String(describing: error)])
        NSApp.terminate(nil)
      }
    }
  }
  @objc func invite() {
    request("/api/invites", body: ["role": "editor"]) { status, data in
      guard status == 200, let data = data,
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let link = obj["url"] as? String else {
        self.message.stringValue = "Needs admin access or a new connection (\(status))."; return
      }
      let filter = CIFilter.qrCodeGenerator()
      filter.message = Data(link.utf8); filter.correctionLevel = "M"
      if let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 6, y: 6)),
         let image = CIContext().createCGImage(output, from: output.extent) {
        self.qr.image = NSImage(cgImage: image, size: NSSize(width: 170, height: 170))
        if self.probe {
          let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: CIContext(), options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])
          let decoded = detector?.features(in: output).compactMap { ($0 as? CIQRCodeFeature)?.messageString } ?? []
          self.diagnostic("qr", ["roundTrip": decoded.contains(link), "containsPermanentToken": link.contains(self.connection?.token ?? "invalid")])
        }
      }
      self.inviteLink.stringValue = link
      self.message.stringValue = "One-time QR code, valid for 5 minutes. The phone must be able to reach this server; a loopback address works only on this Mac."
      DispatchQueue.main.asyncAfter(deadline: .now() + 300) { self.qr.image = nil; self.inviteLink.stringValue = "Invite expired" }
    }
  }
}
let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
