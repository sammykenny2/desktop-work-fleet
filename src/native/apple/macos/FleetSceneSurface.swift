import AppKit
import WebKit

@MainActor final class FleetScenePanel: NSPanel {
    var allowKey = false
    override var canBecomeKey: Bool { allowKey }
    override var canBecomeMain: Bool { false }
    convenience init(rect: NSRect, level: NSWindow.Level) {
        self.init(contentRect: rect, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        self.level = level; isOpaque = false; backgroundColor = .clear; hasShadow = false; hidesOnDeactivate = false
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]; animationBehavior = .none; isReleasedWhenClosed = false
    }
}

@MainActor final class FleetSceneSurface: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    static func windowLevel(_ layer: String) -> NSWindow.Level {
        switch layer {
        case "wallpaper": return NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
        case "desktop": return NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
        case "floating": return .floating
        default: preconditionFailure("Unknown desktop layer")
        }
    }
    let id = FleetProtocol.uuid(), layer: String
    var display: String, viewport: NSRect, nativeBounds: NSRect
    var active = true, ready = false, retired = false, applied: Int64 = -1
    var downloading: FleetSceneFrame?, download: String?
    private(set) var lastInput: TimeInterval = 0
    let panel: FleetScenePanel, web: WKWebView, document: URL, assets: URL
    private var hits: [String: FleetScenePanel] = [:]
    private var started = false, admitted = 0
    var dispatch: ((FleetSceneSurface, String, [String: Any]) throws -> Any)?
    var lost: ((FleetSceneSurface) -> Void)?
    init(display: String, viewport: NSRect, nativeBounds: NSRect, layer: String, assets: URL) {
        self.display = display; self.viewport = viewport; self.nativeBounds = nativeBounds; self.layer = layer; self.assets = assets
        document = assets.appendingPathComponent("desktop/index.html")
        let level = Self.windowLevel(layer)
        panel = FleetScenePanel(rect: nativeBounds, level: level); panel.ignoresMouseEvents = true
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent(); config.preferences.javaScriptCanOpenWindowsAutomatically = false
        web = WKWebView(frame: NSRect(origin: .zero, size: nativeBounds.size), configuration: config); web.underPageBackgroundColor = .clear
        // WebKit paints an opaque base under transparent pages, which would turn the whole full-screen scene into a solid sheet over the wallpaper.
        // The guard keeps a WebKit without this setter from raising; the layer probe then fails on isOpaque instead.
        if web.responds(to: NSSelectorFromString("_setDrawsBackground:")) { web.setValue(false, forKey: "drawsBackground") }
        super.init(); web.autoresizingMask = [.width, .height]; panel.contentView = web; web.navigationDelegate = self; config.userContentController.add(self, name: "workFleet")
        if #available(macOS 13.3, *) { web.isInspectable = false }
    }
    func start() async throws {
        guard !started else { return }; started = true
        let rules = "[{\"trigger\":{\"url-filter\":\"^https?://\"},\"action\":{\"type\":\"block\"}}]"
        let blocker: WKContentRuleList = try await withCheckedThrowingContinuation { continuation in
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "work-fleet-scene-assets-v1", encodedContentRuleList: rules) { result, error in
                if let error { continuation.resume(throwing: error) }
                else if let result { continuation.resume(returning: result) }
                else { continuation.resume(throwing: FleetFailure("native-assets", "無法保護本機畫面。")) }
            }
        }
        guard !retired else { return }; web.configuration.userContentController.add(blocker); web.loadFileURL(document, allowingReadAccessTo: assets)
    }
    func event(_ name: String, _ values: [String: Any] = [:]) { var message = values; message["v"] = 1; message["event"] = name; post(message) }
    private func post(_ message: [String: Any]) {
        guard !retired else { return }; web.callAsyncJavaScript("globalThis.__workFleetReceive(value);", arguments: ["value": message], in: nil, in: .page, completionHandler: nil)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard !retired, admitted < 32, message.frameInfo.isMainFrame, message.frameInfo.request.url?.standardizedFileURL == document.standardizedFileURL,
            web.url?.standardizedFileURL == document.standardizedFileURL, let value = message.body as? [String: Any], let id = value["id"] as? String, FleetProtocol.isUUID(id) else { return }
        admitted += 1; defer { admitted -= 1 }
        do {
            try FleetProtocol.require(FleetProtocol.encode(value).count <= 1024 * 1024 && FleetProtocol.number(value, "v", 1) == 1, "scene-command", "桌面協定無效。")
            guard let args = value["params"] as? [String: Any], let dispatch else { throw FleetFailure("scene-command", "桌面工作階段已關閉。") }
            let result = try dispatch(self, FleetProtocol.text(value, "method"), args); post(["v": 1, "id": id, "ok": true, "result": result])
        } catch {
            let failure = error as? FleetFailure ?? FleetFailure("scene-command", "桌面操作未完成，請保留未保存文字。")
            post(["v": 1, "id": id, "ok": false, "error": ["code": failure.code, "message": failure.message]])
        }
    }
    func setBounds(display: String, viewport: NSRect, nativeBounds: NSRect) {
        suspend(); self.display = display; self.viewport = viewport; self.nativeBounds = nativeBounds; panel.setFrame(nativeBounds, display: true); applied = -1
    }
    func suspend() { for hit in hits.values { hit.orderOut(nil) }; panel.allowKey = false }
    func hide() { suspend(); panel.orderOut(nil) }
    func apply(_ frame: FleetSceneFrame) {
        let cards = frame.cards.filter { $0.layer == layer && $0.rect.intersects(viewport) }
        let notice = layer == "floating" && (frame.notice?.intersects(viewport) ?? false)
        guard !cards.isEmpty || notice else { hide(); return }
        // The visual surface always ignores the mouse. Only explicitly interactive paper rectangles receive events.
        panel.orderFrontRegardless(); var live = Set<String>(), covered: [NSRect] = []
        for card in cards.reversed() {
            let clipped = card.rect.intersection(viewport)
            var pieces = [clipped]
            if layer != "wallpaper" && card.interactive {
                for cover in covered { pieces = pieces.flatMap { Self.subtract($0, cover) }; if pieces.isEmpty { break } }
                for (index, piece) in pieces.enumerated() {
                    let id = "\(card.id):\(index)"; live.insert(id)
                    let bounds = NSRect(x: nativeBounds.minX + piece.minX - viewport.minX, y: nativeBounds.maxY - piece.maxY + viewport.minY, width: piece.width, height: piece.height)
                    let hit = hits[id] ?? FleetScenePanel(rect: bounds, level: panel.level)
                    if hits[id] == nil { let input = FleetSceneInput(frame: NSRect(origin: .zero, size: bounds.size)); input.autoresizingMask = [.width, .height]; input.surface = self; hit.contentView = input; hits[id] = hit }
                    (hit.contentView as? FleetSceneInput)?.operable = card.draggable; hit.setFrame(bounds, display: false); hit.order(.above, relativeTo: panel.windowNumber)
                }
            }
            covered.append(clipped)
        }
        for (id, hit) in hits where !live.contains(id) { hit.orderOut(nil) }
        if live.isEmpty { panel.allowKey = false; if panel.isKeyWindow { panel.resignKey() } }
    }
    private static func subtract(_ rect: NSRect, _ cover: NSRect) -> [NSRect] {
        let overlap = rect.intersection(cover); if overlap.isEmpty { return [rect] }
        return [NSRect(x: rect.minX, y: rect.minY, width: overlap.minX - rect.minX, height: rect.height),
            NSRect(x: overlap.maxX, y: rect.minY, width: rect.maxX - overlap.maxX, height: rect.height),
            NSRect(x: overlap.minX, y: rect.minY, width: overlap.width, height: overlap.minY - rect.minY),
            NSRect(x: overlap.minX, y: overlap.maxY, width: overlap.width, height: rect.maxY - overlap.maxY)].filter { !$0.isEmpty }
    }
    func forward(_ event: NSEvent, from input: FleetSceneInput) {
        guard layer != "wallpaper", let source = input.window, !retired, active else { return }
        lastInput = ProcessInfo.processInfo.systemUptime
        let screen = source.convertPoint(toScreen: event.locationInWindow), point = panel.convertPoint(fromScreen: screen)
        if event.type == .scrollWheel {
            let arguments: [String: Any] = ["x": point.x, "y": panel.frame.height - point.y, "dx": event.scrollingDeltaX, "dy": event.scrollingDeltaY]
            web.callAsyncJavaScript("const e=document.elementFromPoint(x,y)?.closest('.card-body'); if(e)e.scrollBy({left:-dx,top:-dy});", arguments: arguments, in: nil, in: .page, completionHandler: nil); return
        }
        if event.type == .leftMouseDown {
            panel.allowKey = true; panel.makeKey(); panel.makeFirstResponder(web)
        }
        guard let forwarded = NSEvent.mouseEvent(with: event.type, location: point, modifierFlags: event.modifierFlags, timestamp: event.timestamp,
            windowNumber: panel.windowNumber, context: nil, eventNumber: event.eventNumber, clickCount: event.clickCount, pressure: event.pressure) else { return }
        panel.sendEvent(forwarded)
    }
    func focus() { guard layer == "floating", !retired, active else { return }; panel.allowKey = true; NSApplication.shared.activate(ignoringOtherApps: true); panel.makeKey(); panel.makeFirstResponder(web); event("desktop-focus") }
    func close() { retired = true; for hit in hits.values { hit.close() }; hits.removeAll(); panel.close(); web.configuration.userContentController.removeScriptMessageHandler(forName: "workFleet") }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { hide(); lost?(self) }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.targetFrame?.isMainFrame == true, navigationAction.request.url?.standardizedFileURL == document.standardizedFileURL { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url, ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }; decisionHandler(.cancel)
    }
}

@MainActor final class FleetSceneInput: NSView {
    weak var surface: FleetSceneSurface?
    var operable = false
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { surface?.forward(event, from: self) }
    override func mouseUp(with event: NSEvent) { surface?.forward(event, from: self) }
    override func mouseDragged(with event: NSEvent) { surface?.forward(event, from: self) }
    override func rightMouseDown(with event: NSEvent) { surface?.forward(event, from: self) }
    override func rightMouseUp(with event: NSEvent) { surface?.forward(event, from: self) }
    override func scrollWheel(with event: NSEvent) { surface?.forward(event, from: self) }
}
