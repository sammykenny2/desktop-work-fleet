import AppKit

@MainActor final class FleetDesktop {
    static let layers = ["desktop", "floating", "wallpaper"]
    private struct Display { let id: String, primary: Bool, native: NSRect, viewport: NSRect, work: NSRect }
    private struct Command { let view: FleetSceneSurface, id: String, upload: String?, draft: Bool, created = Date() }
    private struct Intent { let id = FleetProtocol.uuid(), process: pid_t, created = ProcessInfo.processInfo.systemUptime }
    let session = FleetProtocol.uuid()
    private let assets: URL, referenceTop: CGFloat
    private let send: (String, [String: Any]) -> Void, show: () -> Void, hide: () -> Bool, mainVisible: (Bool) -> Void
    private let transfers = FleetSceneTransfers(), shortcuts = FleetShortcuts()
    private var displays: [Display], proposed: [Display]?
    private var views: [FleetSceneSurface] = [], commands: [String: Command] = [:], flushes: [String: (String, String)] = [:], frozen: [String: String] = [:]
    private var sceneIntents: [String: (String, Intent)] = [:], bindings: [String: String] = [:]
    private var intent: Intent?, focusSequence: Int64?, frame: FleetSceneFrame?, frameToken: String?
    private var topology: Int64 = 0, proposedTopology: Int64 = 0
    private var started = false, closed = false, displayPending = false, blocked = false, menu = false
    private var observers: [(NotificationCenter, NSObjectProtocol)] = [], displayTask: Task<Void, Never>?
    init(assets: URL, send: @escaping (String, [String: Any]) -> Void, show: @escaping () -> Void, hide: @escaping () -> Bool, mainVisible: @escaping (Bool) -> Void) throws {
        self.assets = assets; self.send = send; self.show = show; self.hide = hide; self.mainVisible = mainVisible
        guard let primary = NSScreen.screens.first else { throw FleetFailure("desktop-display", "目前沒有可用螢幕。") }
        referenceTop = primary.frame.maxY; displays = try Self.readDisplays(top: primary.frame.maxY)
        for display in displays { for layer in Self.layers { _ = newView(display, layer) } }
        shortcuts.action = { [weak self] in self?.action($0) }; shortcuts.changed = { [weak self] in self?.send("desktop-shortcut-status", ["registrations": $0]) }
        observe(.default, NSApplication.didChangeScreenParametersNotification) { [weak self] in self?.refreshDisplays() }
        let workspace = NSWorkspace.shared.notificationCenter
        observe(workspace, NSWorkspace.willSleepNotification) { [weak self] in self?.invalidateDisplays(); self?.displayTask?.cancel() }
        observe(workspace, NSWorkspace.didWakeNotification) { [weak self] in self?.refreshDisplays() }
        observe(workspace, NSWorkspace.activeSpaceDidChangeNotification) { [weak self] in self?.refreshDisplays() }
        observe(workspace, NSWorkspace.didActivateApplicationNotification) { [weak self] in self?.revokeIntent(); self?.shortcuts.refresh() }
        for name in [NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification, NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification] {
            observe(.default, name) { [weak self] in Task { @MainActor in self?.shortcuts.refresh() } }
        }
    }
    private func observe(_ center: NotificationCenter, _ name: Notification.Name, _ action: @escaping @MainActor () -> Void) {
        let token = center.addObserver(forName: name, object: nil, queue: .main) { _ in MainActor.assumeIsolated { action() } }; observers.append((center, token))
    }
    private static func readDisplays(top: CGFloat) throws -> [Display] {
        let screens = NSScreen.screens; try FleetProtocol.require(!screens.isEmpty && screens.count <= 16, "desktop-display", "螢幕數量超過支援容量，資料仍保留。")
        return try screens.enumerated().map { index, screen in
            guard let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { throw FleetFailure("desktop-display", "無法讀取螢幕身分。") }
            func logical(_ rect: NSRect) -> NSRect { NSRect(x: rect.minX, y: top - rect.maxY, width: rect.width, height: rect.height) }
            return Display(id: id.stringValue, primary: index == 0, native: screen.frame, viewport: logical(screen.frame), work: logical(screen.visibleFrame))
        }
    }
    private func newView(_ display: Display, _ layer: String) -> FleetSceneSurface {
        let view = FleetSceneSurface(display: display.id, viewport: display.viewport, nativeBounds: display.native, layer: layer, assets: assets)
        view.dispatch = { [weak self] view, method, args in guard let self else { throw FleetFailure("scene-closed", "桌面工作階段已關閉。") }; return try self.scene(view, method, args) }
        view.lost = { [weak self] in self?.retire($0) }; views.append(view); return view
    }
    private func rect(_ value: NSRect) -> [String: Any] { ["x": value.minX, "y": value.minY, "width": value.width, "height": value.height] }
    private func workAreas(_ displays: [Display]) -> [[String: Any]] { displays.map { var value = rect($0.work); value["id"] = $0.id; value["primary"] = $0.primary; return value } }
    private func viewInfo(_ view: FleetSceneSurface) -> [String: Any] { ["viewId": view.id, "layer": view.layer, "active": view.active, "viewport": rect(view.viewport), "adjustOverlay": view.layer == "floating"] }
    // Adjust mode is a modal overlay on every host: the topmost scene tints the screen and carries the adjust controls.
    private func info() -> [String: Any] {
        ["sessionId": session, "referenceDpi": 96, "topology": topology, "layers": Self.layers, "residentLayers": Self.layers, "adjustOverlay": true,
            "workAreas": workAreas(displays), "views": views.filter { !$0.retired }.map(viewInfo)]
    }
    private func view(_ id: String) throws -> FleetSceneSurface {
        guard let value = views.first(where: { $0.id == id && !$0.retired && $0.ready }) else { throw FleetFailure("desktop-view", "桌面視窗已關閉或尚未就緒。") }; return value
    }
    private func current(_ value: Intent) -> Bool {
        ProcessInfo.processInfo.systemUptime - value.created <= 5 && NSWorkspace.shared.frontmostApplication?.processIdentifier == value.process
    }
    private func capture() -> Intent? { guard !blocked && !menu, let process = NSWorkspace.shared.frontmostApplication?.processIdentifier else { return nil }; return Intent(process: process) }
    private func revokeIntent() { intent = nil; focusSequence = nil; sceneIntents.removeAll() }
    func action(_ target: String) {
        guard !closed && started, let captured = capture() else { return }; intent = captured; focusSequence = nil
        send("desktop-action", ["target": target, "intent": captured.id])
    }
    func menuActive(_ active: Bool) { menu = active; shortcuts.blocked = blocked || menu }
    private func startViews() {
        for view in views where view.active && !view.retired { Task { @MainActor in do { try await view.start() } catch { if !closed { retire(view) } } } }
    }
    private func invalidateDisplays() {
        guard !closed else { return }; displayPending = true; revokeIntent()
        for view in views where !view.retired { view.suspend(); if view.ready { view.event("desktop-displays-changing") } }
        if started { send("desktop-displays-changing", [:]) }
    }
    private func refreshDisplays() {
        invalidateDisplays(); displayTask?.cancel()
        displayTask = Task { @MainActor in
            do {
                try await Task.sleep(nanoseconds: 250_000_000); guard !closed else { return }
                proposed = try Self.readDisplays(top: referenceTop); proposedTopology += 1
                if started, let proposed { send("desktop-displays", ["topology": proposedTopology, "workAreas": workAreas(proposed)]) }
            } catch is CancellationError { }
            catch { if !closed { send("desktop-error", ["message": "無法讀取目前螢幕，已保留資料與編輯文字；請在主畫面重試桌面呈現。"] ) } }
        }
    }
    private func applyDisplays(_ args: [String: Any]) throws -> Any {
        let requested = try FleetProtocol.number(args, "topology")
        if requested == topology && !displayPending { return info() }
        guard requested == proposedTopology, let next = proposed else { throw FleetFailure("desktop-topology", "螢幕已再次變更，正在重新套用版面。") }
        var assignments: [String: Display] = [:]
        if let editor = args["editorViewId"] as? String {
            let editing = try view(editor), paper = try FleetSceneFrame.rect(args["editorRect"])
            let destination = next.max { left, right in
                func score(_ display: Display) -> CGFloat { let overlap = paper.intersection(display.viewport); return overlap.isEmpty ? 0 : overlap.width * overlap.height }
                return score(left) < score(right) || score(left) == score(right) && left.id != editing.display
            }!; assignments[editing.id] = destination
        } else { try FleetProtocol.require(args["editorViewId"] is NSNull, "desktop-view", "編輯視窗身分無效。") }
        for stable in [true, false] {
            for display in next { for layer in Self.layers {
                if views.contains(where: { $0.layer == layer && assignments[$0.id]?.id == display.id }) { continue }
                var match = views.first { !$0.retired && $0.layer == layer && assignments[$0.id] == nil && (!stable || $0.display == display.id) }
                if match == nil && !stable {
                    try FleetProtocol.require(views.filter { !$0.retired }.count < 48, "desktop-capacity", "桌面視窗容量已滿；請保存後重新開啟。")
                    match = newView(display, layer)
                }
                if let match { assignments[match.id] = display }
            } }
        }
        for view in views where !view.retired {
            view.active = assignments[view.id] != nil
            if let display = assignments[view.id] { view.setBounds(display: display.id, viewport: display.viewport, nativeBounds: display.native) } else { view.hide() }
        }
        displays = next; topology = requested; displayPending = false
        for view in views where view.ready && !view.retired { view.event("desktop-viewport", ["topology": topology, "view": viewInfo(view)]) }
        Task { @MainActor in if !closed { startViews() } }; return info()
    }
    func invoke(_ method: String, _ args: [String: Any]) throws -> Any {
        try FleetProtocol.require(!closed, "desktop-closed", "桌面工作階段已關閉。"); sweep()
        switch method {
        case "desktop.info": return info()
        case "desktop.start": started = true; startViews(); if displayPending { refreshDisplays() }; return info()
        case "desktop.displays.retry": refreshDisplays(); return NSNull()
        case "desktop.displays.apply": return try applyDisplays(args)
        case "desktop.shortcuts.configure":
            let result = try shortcuts.configure(args); bindings = Dictionary(uniqueKeysWithValues: shortcuts.registrations.map { ($0["key"]!, $0["target"]!) })
            for view in views where view.ready && !view.retired { view.event("desktop-shortcuts", ["bindings": bindings]) }; return result
        case "desktop.shortcuts.block": blocked = try FleetProtocol.bool(args, "blocked"); shortcuts.blocked = blocked || menu; return NSNull()
        case "desktop.intent":
            if NSApplication.shared.isActive, let captured = capture() { intent = captured; focusSequence = nil; return ["intent": captured.id] }; return ["intent": NSNull()]
        case "desktop.hideMain": try FleetProtocol.require(hide(), "tray-unavailable", "選單列目前不可用，主畫面保持開啟。"); return NSNull()
        case "desktop.mainVisible": mainVisible(try FleetProtocol.bool(args, "visible")); return NSNull()
        case "desktop.showMain":
            guard let id = args["intent"] as? String, let intent, id == intent.id, current(intent) else { return ["activated": false] }
            revokeIntent(); show(); return ["activated": true]
        case "desktop.focus":
            guard let intent, intent.id == (args["intent"] as? String), current(intent) else { return ["accepted": false] }
            focusSequence = try FleetProtocol.number(args, "sequence"); for view in views { if tryFocus(view) { break } }; return ["accepted": true]
        case "desktop.frame.begin": return try transfers.begin("owner", args, maximum: FleetProtocol.record)
        case "desktop.frame.append": return try transfers.append("owner", args)
        case "desktop.frame.publish":
            let token = try FleetProtocol.text(args, "token"), next = try FleetSceneFrame.parse(transfers.seal("owner", token), session: session, previous: frame?.sequence ?? -1)
            try transfers.retain("owner", token); if let previous = frameToken { transfers.drop("owner", previous) }; frameToken = token; frame = next
            for view in views where view.ready && !view.retired { view.event("desktop-frame", ["sequence": next.sequence]) }; return ["sequence": next.sequence]
        case "desktop.frame.discard": let token = try FleetProtocol.text(args, "token"); if token != frameToken { transfers.drop("owner", token) }; return NSNull()
        case "desktop.command.read":
            let pending = try pending(args); guard let upload = pending.upload else { throw FleetFailure("scene-command", "此命令沒有大型输入。") }; return try transfers.read(pending.view.id, upload, args)
        case "desktop.reply":
            let ticket = try FleetProtocol.text(args, "ticket"), pending = try pending(args), ok = try FleetProtocol.bool(args, "ok")
            try FleetProtocol.require(FleetProtocol.encode(args).count <= 64 * 1024, "scene-size", "桌面操作回覆過大。")
            pending.view.event("desktop-command-result", ["commandId": pending.id, "ok": ok, "result": args["result"] ?? NSNull(), "error": args["error"] ?? NSNull()]); release(ticket); return NSNull()
        case "desktop.flush":
            let view = try view(FleetProtocol.text(args, "viewId")), id = try FleetProtocol.text(args, "id"), draft = try FleetProtocol.text(args, "draftId")
            try FleetProtocol.require(FleetProtocol.isUUID(id) && flushes.count < 4 && flushes[id] == nil, "scene-busy", "桌面草稿仍在保存。")
            flushes[id] = (view.id, draft); frozen[id] = view.id; view.event("desktop-flush", ["id": id, "draftId": draft]); return NSNull()
        case "desktop.flush.cancel": flushes.removeValue(forKey: try FleetProtocol.text(args, "id")); return NSNull()
        case "desktop.flush.release":
            let id = try FleetProtocol.text(args, "id"); flushes.removeValue(forKey: id)
            if let source = frozen.removeValue(forKey: id), let view = try? view(source) { view.event("desktop-unfreeze", ["id": id, "resume": source == (args["viewId"] as? String), "draftId": args["draftId"] ?? NSNull()]) }; return NSNull()
        default: throw FleetFailure("unsupported-method", "桌面主機沒有此操作。")
        }
    }
    private func scene(_ view: FleetSceneSurface, _ method: String, _ args: [String: Any]) throws -> Any {
        try FleetProtocol.require(!closed && !view.retired, "scene-closed", "桌面工作階段已關閉。"); sweep()
        switch method {
        case "scene.info": view.ready = true; var value = viewInfo(view); value["sessionId"] = session; value["topology"] = topology; value["bindings"] = bindings; return value
        case "scene.intent":
            sceneIntents = sceneIntents.filter { current($0.value.1) }
            if sceneIntents.count < 32 && ProcessInfo.processInfo.systemUptime - view.lastInput < 1, let captured = capture() { sceneIntents[captured.id] = (view.id, captured); return ["intent": captured.id] }; return ["intent": NSNull()]
        case "scene.report": send("desktop-error", ["viewId": view.id, "message": try FleetProtocol.text(args, "message", 2000)]); return NSNull()
        case "scene.frame":
            guard let token = frameToken, let frame, !displayPending, frame.topology == topology else { return NSNull() }
            if let previous = view.download { transfers.drop(view.id, previous) }; let lease = try transfers.lease("owner", token, view.id)
            view.download = lease["token"] as? String; view.downloading = frame; return lease
        case "scene.read": return try transfers.read(view.id, FleetProtocol.text(args, "token"), args)
        case "scene.discard": transfers.drop(view.id, try FleetProtocol.text(args, "token")); return NSNull()
        case "scene.applied":
            let sequence = try FleetProtocol.number(args, "sequence"), requested = try FleetProtocol.number(args, "topology")
            guard !displayPending, view.active, requested == topology, let frame = view.downloading, frame.topology == topology else { return ["accepted": false] }
            try FleetProtocol.require(sequence == frame.sequence && sequence >= view.applied, "scene-order", "桌面輸入尚未對應已顯示畫面。")
            view.apply(frame); view.applied = sequence; _ = tryFocus(view); return ["accepted": true]
        case "scene.command.begin": return try transfers.begin(view.id, args, maximum: 16 * 1024 * 1024)
        case "scene.command.append": return try transfers.append(view.id, args)
        case "scene.command":
            let token = args["token"] as? String; let command: [String: Any]
            if let token { command = try FleetProtocol.json(transfers.seal(view.id, token)) }
            else if let value = args["command"] as? [String: Any] { command = value; try FleetProtocol.require(FleetProtocol.encode(value).count <= 64 * 1024, "scene-size", "桌面命令過大。") }
            else { throw FleetFailure("scene-command", "桌面命令格式無效。") }
            let id = try FleetProtocol.text(command, "id"), method = try FleetProtocol.text(command, "method"), requested = try FleetProtocol.number(args, "topology")
            try FleetProtocol.require(FleetProtocol.isUUID(id) && FleetProtocol.text(command, "sessionId") == session && FleetProtocol.number(command, "serial") > 0 && command["args"] is [String: Any], "scene-session", "桌面命令工作階段無效。")
            let allowed = ["pointer.down", "pointer.move", "pointer.up", "pointer.cancel", "card.select", "card.edit", "card.details", "card.transfer", "editor.change", "editor.save", "editor.end", "editor.full", "interaction.escape", "interaction.shortcut", "interaction.done", "layout.arrange"]
            try FleetProtocol.require(allowed.contains(method), "unsupported-method", "桌面表面沒有此操作。")
            let draft = method == "editor.change"
            try FleetProtocol.require(draft || !displayPending && view.active && requested == topology, "desktop-topology", "桌面座標正在更新，請保留目前文字。")
            try FleetProtocol.require(commands.values.filter { $0.draft == draft }.count < (draft ? 4 : 24) && !commands.values.contains { $0.view === view && $0.id == id }, "scene-busy", "桌面操作仍在處理。")
            let ticket = FleetProtocol.uuid(); commands[ticket] = Command(view: view, id: id, upload: token, draft: draft)
            var admitted: Any = NSNull()
            if ["card.details", "editor.full", "interaction.shortcut"].contains(method), let id = args["intent"] as? String, let captured = sceneIntents.removeValue(forKey: id), captured.0 == view.id, current(captured.1) { intent = captured.1; focusSequence = nil; admitted = id }
            var message: [String: Any] = ["ticket": ticket, "viewId": view.id, "intent": admitted, "topology": requested]
            if let token { let bytes = try transfers.seal(view.id, token); message["transfer"] = ["size": bytes.count, "sha256": FleetProtocol.digest(bytes)] } else { message["command"] = command }
            send("desktop-command", message); return ["accepted": true]
        case "scene.flushed":
            let id = try FleetProtocol.text(args, "id"), draft = try FleetProtocol.text(args, "draftId")
            guard let pending = flushes[id], pending.0 == view.id, pending.1 == draft else { throw FleetFailure("scene-flush", "草稿保存請求已失效。") }
            let ok = try FleetProtocol.bool(args, "ok"), sequence = try FleetProtocol.number(args, "sequence"); flushes.removeValue(forKey: id)
            send("desktop-flushed", ["id": id, "viewId": view.id, "draftId": draft, "ok": ok, "sequence": sequence]); return NSNull()
        default: throw FleetFailure("unsupported-method", "桌面表面沒有儲存或系統操作權限。")
        }
    }
    private func tryFocus(_ view: FleetSceneSurface) -> Bool {
        guard let sequence = focusSequence, let intent else { return false }
        guard current(intent) else { revokeIntent(); return false }
        guard !displayPending, view.active, !view.retired, view.ready, view.layer == "floating", view.applied >= sequence,
            view.downloading?.cards.contains(where: { $0.layer == view.layer && $0.draggable && $0.rect.intersects(view.viewport) }) == true else { return false }
        revokeIntent(); view.focus(); return true
    }
    private func pending(_ args: [String: Any]) throws -> Command {
        guard let value = commands[try FleetProtocol.text(args, "ticket")] else { throw FleetFailure("scene-command", "桌面操作已失效。") }; return value
    }
    private func release(_ ticket: String) { if let value = commands.removeValue(forKey: ticket), let token = value.upload { transfers.drop(value.view.id, token) } }
    private func sweep() { for (ticket, value) in commands where Date().timeIntervalSince(value.created) > 120 { release(ticket) } }
    private func retire(_ view: FleetSceneSurface) {
        guard !view.retired else { return }; view.close(); transfers.dropOwner(view.id)
        for (ticket, value) in commands where value.view === view { release(ticket) }
        sceneIntents = sceneIntents.filter { $0.value.0 != view.id }; flushes = flushes.filter { $0.value.0 != view.id }; frozen = frozen.filter { $0.value != view.id }
        send("desktop-view-lost", ["viewId": view.id, "message": "桌面畫面程序已停止，最後確認的草稿仍保留於主畫面。"])
    }
    func close() {
        guard !closed else { return }; closed = true; displayTask?.cancel(); shortcuts.close()
        for (center, token) in observers { center.removeObserver(token) }; observers.removeAll()
        for view in views { view.close() }; views.removeAll(); transfers.close(); commands.removeAll(); flushes.removeAll(); frozen.removeAll(); revokeIntent()
    }
}
