import AppKit

@MainActor final class PinItAnywhereDesktop {
    static let layers = ["desktop", "floating", "wallpaper"]
    private struct Display { let id: String, primary: Bool, native: NSRect, viewport: NSRect, work: NSRect }
    private struct Command { let view: PinItAnywhereSceneSurface, id: String, upload: String?, draft: Bool, created = Date() }
    private typealias Intent = PinItAnywhereActivationIntent
    let session = PinItAnywhereProtocol.uuid()
    private let assets: URL, referenceTop: CGFloat
    private let send: (String, [String: Any]) -> Void, show: () -> Bool, hide: () -> Bool, mainVisible: (Bool) -> Void
    private let foregroundProcess: () -> pid_t?
    private let transfers = PinItAnywhereSceneTransfers(), shortcuts = PinItAnywhereShortcuts()
    private var displays: [Display], proposed: [Display]?
    private var views: [PinItAnywhereSceneSurface] = [], commands: [String: Command] = [:], flushes: [String: (String, String)] = [:], frozen: [String: String] = [:]
    private var sceneIntents: [String: (String, Intent)] = [:], bindings: [String: String] = [:]
    private var intent: Intent?, focusSequence: Int64?, frame: PinItAnywhereSceneFrame?, frameToken: String?
    private var menuOrigin: pid_t?
    private var topology: Int64 = 0, proposedTopology: Int64 = 0
    // A quick edit's keyboard request, honoured once its view shows the frame and only shortly after a scene asked to edit.
    private var editRequested: TimeInterval = 0, editorFocus: (view: String, sequence: Int64)?
    private var started = false, closed = false, displayPending = false, blocked = false, menu = false
    var menuActionsAvailable: Bool { started && !closed && !blocked }
    var adjusting: Bool { frame?.adjusting == true }
    var shortcutAnswers: [[String: String]] { shortcuts.lastAnswers }
    private var observers: [(NotificationCenter, NSObjectProtocol)] = [], displayTask: Task<Void, Never>?
    init(assets: URL, send: @escaping (String, [String: Any]) -> Void, show: @escaping () -> Bool, hide: @escaping () -> Bool, mainVisible: @escaping (Bool) -> Void,
         foregroundProcess: @escaping () -> pid_t? = { NSWorkspace.shared.frontmostApplication?.processIdentifier }) throws {
        self.assets = assets; self.send = send; self.show = show; self.hide = hide; self.mainVisible = mainVisible
        self.foregroundProcess = foregroundProcess
        guard let primary = NSScreen.screens.first else { throw PinItAnywhereFailure("desktop-display", "No display is available.") }
        referenceTop = primary.frame.maxY; displays = try Self.readDisplays(top: primary.frame.maxY)
        for display in displays { for layer in Self.layers { _ = newView(display, layer) } }
        shortcuts.action = { [weak self] in self?.action($0) }; shortcuts.changed = { [weak self] in self?.send("desktop-shortcut-status", ["registrations": $0]) }
        observe(.default, NSApplication.didChangeScreenParametersNotification) { [weak self] in self?.refreshDisplays() }
        let workspace = NSWorkspace.shared.notificationCenter
        observe(workspace, NSWorkspace.willSleepNotification) { [weak self] in self?.invalidateDisplays(); self?.displayTask?.cancel() }
        observe(workspace, NSWorkspace.didWakeNotification) { [weak self] in self?.refreshDisplays() }
        observe(workspace, NSWorkspace.activeSpaceDidChangeNotification) { [weak self] in self?.refreshDisplays() }
        let activationObserver = workspace.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] notification in
            let process = (notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.processIdentifier
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.intent?.survivesActivation(process, ownProcess: ProcessInfo.processInfo.processIdentifier) != true { self.revokeIntent() }
                self.shortcuts.refresh()
            }
        }
        observers.append((workspace, activationObserver))
        for name in [NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification, NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification] {
            observe(.default, name) { [weak self] in Task { @MainActor in self?.shortcuts.refresh() } }
        }
    }
    private func observe(_ center: NotificationCenter, _ name: Notification.Name, _ action: @escaping @MainActor () -> Void) {
        let token = center.addObserver(forName: name, object: nil, queue: .main) { _ in MainActor.assumeIsolated { action() } }; observers.append((center, token))
    }
    private static func readDisplays(top: CGFloat) throws -> [Display] {
        let screens = NSScreen.screens; try PinItAnywhereProtocol.require(!screens.isEmpty && screens.count <= 16, "desktop-display", "There are more displays than supported. Your data is kept.")
        return try screens.enumerated().map { index, screen in
            guard let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { throw PinItAnywhereFailure("desktop-display", "Couldn't identify a display.") }
            func logical(_ rect: NSRect) -> NSRect { NSRect(x: rect.minX, y: top - rect.maxY, width: rect.width, height: rect.height) }
            return Display(id: id.stringValue, primary: index == 0, native: screen.frame, viewport: logical(screen.frame), work: logical(screen.visibleFrame))
        }
    }
    private func newView(_ display: Display, _ layer: String) -> PinItAnywhereSceneSurface {
        let view = PinItAnywhereSceneSurface(display: display.id, viewport: display.viewport, nativeBounds: display.native, layer: layer, assets: assets)
        view.dispatch = { [weak self] view, method, args in guard let self else { throw PinItAnywhereFailure("scene-closed", "The desktop session has closed.") }; return try self.scene(view, method, args) }
        view.lost = { [weak self] in self?.retire($0) }; views.append(view); return view
    }
    private func rect(_ value: NSRect) -> [String: Any] { ["x": value.minX, "y": value.minY, "width": value.width, "height": value.height] }
    private func workAreas(_ displays: [Display]) -> [[String: Any]] { displays.map { var value = rect($0.work); value["id"] = $0.id; value["primary"] = $0.primary; return value } }
    private func viewInfo(_ view: PinItAnywhereSceneSurface) -> [String: Any] { ["viewId": view.id, "layer": view.layer, "active": view.active, "viewport": rect(view.viewport), "adjustOverlay": view.layer == "floating"] }
    // Adjust mode is a modal overlay on every host: the topmost scene tints the screen and carries the adjust controls.
    private func info() -> [String: Any] {
        ["sessionId": session, "referenceDpi": 96, "topology": topology, "layers": Self.layers, "residentLayers": Self.layers, "adjustOverlay": true,
            "workAreas": workAreas(displays), "views": views.filter { !$0.retired }.map(viewInfo)]
    }
    private func view(_ id: String) throws -> PinItAnywhereSceneSurface {
        guard let value = views.first(where: { $0.id == id && !$0.retired && $0.ready }) else { throw PinItAnywhereFailure("desktop-view", "The desktop window has closed or isn't ready yet.") }; return value
    }
    private func current(_ value: Intent) -> Bool {
        value.current(now: ProcessInfo.processInfo.systemUptime, foreground: foregroundProcess(),
                      ownProcess: ProcessInfo.processInfo.processIdentifier)
    }
    private func capture() -> Intent? { guard !blocked && !menu, let process = foregroundProcess() else { return nil }; return Intent(process: process) }
    private func revokeIntent() { intent = nil; focusSequence = nil; sceneIntents.removeAll() }
    func action(_ target: String) {
        guard !closed && started, let captured = capture() else { return }; intent = captured; focusSequence = nil
        send("desktop-action", ["target": target, "intent": captured.id])
    }
    /// Remember only the origin before tracking; activation permission is created by the later selection.
    func prepareMenu() { menuOrigin = foregroundProcess() }
    /// Capture at selection, then dispatch after menu tracking. Never create a fresh intent in the queued callback.
    func menuAction(_ target: String) {
        guard menuActionsAvailable, !menu else { return }
        // The native tracking loop can temporarily have no frontmost app. A menu selection is still an explicit action.
        let captured = Intent(process: menuOrigin ?? foregroundProcess() ?? ProcessInfo.processInfo.processIdentifier, fromMenu: true)
        menuOrigin = nil
        intent = captured; focusSequence = nil
        DispatchQueue.main.async { [weak self] in
            guard let self, !closed, started else { return }
            send("desktop-action", ["target": target, "intent": captured.id])
        }
    }
    func menuActive(_ active: Bool) { menu = active; shortcuts.blocked = blocked || menu }
    private func startViews() {
        for view in views where view.active && !view.retired { Task { @MainActor in do { try await view.start() } catch { if !closed { retire(view) } } } }
    }
    private func invalidateDisplays() {
        guard !closed else { return }; displayPending = true; revokeIntent(); editorFocus = nil
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
            catch { if !closed { send("desktop-error", ["message": PinItAnywhereText.text("desktop.displaysUnreadable")] ) } }
        }
    }
    private func applyDisplays(_ args: [String: Any]) throws -> Any {
        let requested = try PinItAnywhereProtocol.number(args, "topology")
        if requested == topology && !displayPending { return info() }
        guard requested == proposedTopology, let next = proposed else { throw PinItAnywhereFailure("desktop-topology", "The displays changed again. The layout is being applied again.") }
        var assignments: [String: Display] = [:]
        if let editor = args["editorViewId"] as? String {
            let editing = try view(editor), paper = try PinItAnywhereSceneFrame.rect(args["editorRect"])
            let destination = next.max { left, right in
                func score(_ display: Display) -> CGFloat { let overlap = paper.intersection(display.viewport); return overlap.isEmpty ? 0 : overlap.width * overlap.height }
                return score(left) < score(right) || score(left) == score(right) && left.id != editing.display
            }!; assignments[editing.id] = destination
        } else { try PinItAnywhereProtocol.require(args["editorViewId"] is NSNull, "desktop-view", "The editing window ID isn't valid.") }
        for stable in [true, false] {
            for display in next { for layer in Self.layers {
                if views.contains(where: { $0.layer == layer && assignments[$0.id]?.id == display.id }) { continue }
                var match = views.first { !$0.retired && $0.layer == layer && assignments[$0.id] == nil && (!stable || $0.display == display.id) }
                if match == nil && !stable {
                    try PinItAnywhereProtocol.require(views.filter { !$0.retired }.count < 48, "desktop-capacity", "There are too many desktop windows. Save, then reopen Pin It Anywhere.")
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
        try PinItAnywhereProtocol.require(!closed, "desktop-closed", "The desktop session has closed."); sweep()
        switch method {
        case "desktop.info": return info()
        case "desktop.start": started = true; startViews(); if displayPending { refreshDisplays() }; return info()
        case "desktop.displays.retry": refreshDisplays(); return NSNull()
        case "desktop.displays.apply": return try applyDisplays(args)
        case "desktop.shortcuts.configure":
            let result = try shortcuts.configure(args); bindings = Dictionary(uniqueKeysWithValues: shortcuts.registrations.map { ($0["key"]!, $0["target"]!) })
            for view in views where view.ready && !view.retired { view.event("desktop-shortcuts", ["bindings": bindings]) }; return result
        case "desktop.shortcuts.block": blocked = try PinItAnywhereProtocol.bool(args, "blocked"); shortcuts.blocked = blocked || menu; return NSNull()
        case "desktop.intent":
            if NSApplication.shared.isActive, let captured = capture() { intent = captured; focusSequence = nil; return ["intent": captured.id] }; return ["intent": NSNull()]
        case "desktop.hideMain": try PinItAnywhereProtocol.require(hide(), "tray-unavailable", "The menu bar isn't available, so the main window stays open."); return NSNull()
        case "desktop.mainVisible": mainVisible(try PinItAnywhereProtocol.bool(args, "visible")); return NSNull()
        case "desktop.showMain":
            guard let id = args["intent"] as? String, let intent, id == intent.id, current(intent) else { return ["activated": false] }
            // `hidden` tells quick capture that the window was in the menu bar, so closing the editor puts it back there.
            revokeIntent(); return ["activated": true, "hidden": show()]
        case "desktop.focus":
            guard let intent, intent.id == (args["intent"] as? String), current(intent) else { return ["accepted": false] }
            focusSequence = try PinItAnywhereProtocol.number(args, "sequence"); for view in views { if tryFocus(view) { break } }; return ["accepted": true]
        case "desktop.focusEditor":
            let id = try PinItAnywhereProtocol.text(args, "viewId", 128), sequence = try PinItAnywhereProtocol.number(args, "sequence")
            guard ProcessInfo.processInfo.systemUptime - editRequested < 5, views.contains(where: { $0.id == id && $0.layer == "floating" && !$0.retired }) else { return ["accepted": false] }
            editorFocus = (id, sequence); for view in views where view.id == id { tryFocusEditor(view) }; return ["accepted": true]
        case "desktop.frame.begin": return try transfers.begin("owner", args, maximum: PinItAnywhereProtocol.record)
        case "desktop.frame.append": return try transfers.append("owner", args)
        case "desktop.frame.publish":
            let token = try PinItAnywhereProtocol.text(args, "token"), next = try PinItAnywhereSceneFrame.parse(transfers.seal("owner", token), session: session, previous: frame?.sequence ?? -1)
            try transfers.retain("owner", token); if let previous = frameToken { transfers.drop("owner", previous) }; frameToken = token; frame = next
            for view in views where view.ready && !view.retired { view.event("desktop-frame", ["sequence": next.sequence]) }; return ["sequence": next.sequence]
        case "desktop.frame.discard": let token = try PinItAnywhereProtocol.text(args, "token"); if token != frameToken { transfers.drop("owner", token) }; return NSNull()
        case "desktop.command.read":
            let pending = try pending(args); guard let upload = pending.upload else { throw PinItAnywhereFailure("scene-command", "This command has no large input.") }; return try transfers.read(pending.view.id, upload, args)
        case "desktop.reply":
            let ticket = try PinItAnywhereProtocol.text(args, "ticket"), pending = try pending(args), ok = try PinItAnywhereProtocol.bool(args, "ok")
            try PinItAnywhereProtocol.require(PinItAnywhereProtocol.encode(args).count <= 64 * 1024, "scene-size", "The desktop reply is too large.")
            pending.view.event("desktop-command-result", ["commandId": pending.id, "ok": ok, "result": args["result"] ?? NSNull(), "error": args["error"] ?? NSNull()]); release(ticket); return NSNull()
        case "desktop.flush":
            let view = try view(PinItAnywhereProtocol.text(args, "viewId")), id = try PinItAnywhereProtocol.text(args, "id"), draft = try PinItAnywhereProtocol.text(args, "draftId")
            try PinItAnywhereProtocol.require(PinItAnywhereProtocol.isUUID(id) && flushes.count < 4 && flushes[id] == nil, "scene-busy", "A desktop draft is still being saved.")
            flushes[id] = (view.id, draft); frozen[id] = view.id; view.event("desktop-flush", ["id": id, "draftId": draft]); return NSNull()
        case "desktop.flush.cancel": flushes.removeValue(forKey: try PinItAnywhereProtocol.text(args, "id")); return NSNull()
        case "desktop.flush.release":
            let id = try PinItAnywhereProtocol.text(args, "id"); flushes.removeValue(forKey: id)
            if let source = frozen.removeValue(forKey: id), let view = try? view(source) { view.event("desktop-unfreeze", ["id": id, "resume": source == (args["viewId"] as? String), "draftId": args["draftId"] ?? NSNull()]) }; return NSNull()
        default: throw PinItAnywhereFailure("unsupported-method", "The desktop host does not support this operation.")
        }
    }
    private func scene(_ view: PinItAnywhereSceneSurface, _ method: String, _ args: [String: Any]) throws -> Any {
        try PinItAnywhereProtocol.require(!closed && !view.retired, "scene-closed", "The desktop session has closed."); sweep()
        switch method {
        case "scene.info": view.ready = true; var value = viewInfo(view); value["sessionId"] = session; value["topology"] = topology; value["bindings"] = bindings; return value
        case "scene.intent":
            sceneIntents = sceneIntents.filter { current($0.value.1) }
            if sceneIntents.count < 32 && ProcessInfo.processInfo.systemUptime - view.lastInput < 1, let captured = capture() { sceneIntents[captured.id] = (view.id, captured); return ["intent": captured.id] }; return ["intent": NSNull()]
        case "scene.report": send("desktop-error", ["viewId": view.id, "message": try PinItAnywhereProtocol.text(args, "message", 2000)]); return NSNull()
        case "scene.frame":
            guard let token = frameToken, let frame, !displayPending, frame.topology == topology else { return NSNull() }
            if let previous = view.download { transfers.drop(view.id, previous) }; let lease = try transfers.lease("owner", token, view.id)
            view.download = lease["token"] as? String; view.downloading = frame; return lease
        case "scene.read": return try transfers.read(view.id, PinItAnywhereProtocol.text(args, "token"), args)
        case "scene.discard": transfers.drop(view.id, try PinItAnywhereProtocol.text(args, "token")); return NSNull()
        case "scene.applied":
            let sequence = try PinItAnywhereProtocol.number(args, "sequence"), requested = try PinItAnywhereProtocol.number(args, "topology")
            guard !displayPending, view.active, requested == topology, let frame = view.downloading, frame.topology == topology else { return ["accepted": false] }
            try PinItAnywhereProtocol.require(sequence == frame.sequence && sequence >= view.applied, "scene-order", "The desktop input doesn't match the frame on screen yet.")
            view.apply(frame); view.applied = sequence; _ = tryFocus(view); tryFocusEditor(view); return ["accepted": true]
        case "scene.command.begin": return try transfers.begin(view.id, args, maximum: 16 * 1024 * 1024)
        case "scene.command.append": return try transfers.append(view.id, args)
        case "scene.command":
            let token = args["token"] as? String; let command: [String: Any]
            if let token { command = try PinItAnywhereProtocol.json(transfers.seal(view.id, token)) }
            else if let value = args["command"] as? [String: Any] { command = value; try PinItAnywhereProtocol.require(PinItAnywhereProtocol.encode(value).count <= 64 * 1024, "scene-size", "The desktop command is too large.") }
            else { throw PinItAnywhereFailure("scene-command", "The desktop command isn't valid.") }
            let id = try PinItAnywhereProtocol.text(command, "id"), method = try PinItAnywhereProtocol.text(command, "method"), requested = try PinItAnywhereProtocol.number(args, "topology")
            try PinItAnywhereProtocol.require(PinItAnywhereProtocol.isUUID(id) && PinItAnywhereProtocol.text(command, "sessionId") == session && PinItAnywhereProtocol.number(command, "serial") > 0 && command["args"] is [String: Any], "scene-session", "The desktop command belongs to another session.")
            let allowed = ["pointer.down", "pointer.move", "pointer.up", "pointer.cancel", "card.select", "card.edit", "card.transfer", "card.check", "editor.change", "editor.save", "editor.end", "editor.full", "editor.cancel", "editor.delete", "interaction.escape", "interaction.shortcut", "interaction.done", "layout.arrange", "attachment.preview", "attachment.open"]
            try PinItAnywhereProtocol.require(allowed.contains(method), "unsupported-method", "The desktop surface does not support this operation.")
            if method == "card.edit" { editRequested = ProcessInfo.processInfo.systemUptime }
            let draft = method == "editor.change"
            try PinItAnywhereProtocol.require(draft || !displayPending && view.active && requested == topology, "desktop-topology", "Desktop positions are updating. Keep your current text.")
            try PinItAnywhereProtocol.require(commands.values.filter { $0.draft == draft }.count < (draft ? 4 : 24) && !commands.values.contains { $0.view === view && $0.id == id }, "scene-busy", "A desktop operation is still in progress.")
            let ticket = PinItAnywhereProtocol.uuid(); commands[ticket] = Command(view: view, id: id, upload: token, draft: draft)
            var admitted: Any = NSNull()
            if ["editor.full", "interaction.shortcut"].contains(method), let id = args["intent"] as? String, let captured = sceneIntents.removeValue(forKey: id), captured.0 == view.id, current(captured.1) { intent = captured.1; focusSequence = nil; admitted = id }
            var message: [String: Any] = ["ticket": ticket, "viewId": view.id, "intent": admitted, "topology": requested]
            if let token { let bytes = try transfers.seal(view.id, token); message["transfer"] = ["size": bytes.count, "sha256": PinItAnywhereProtocol.digest(bytes)] } else { message["command"] = command }
            send("desktop-command", message); return ["accepted": true]
        case "scene.flushed":
            let id = try PinItAnywhereProtocol.text(args, "id"), draft = try PinItAnywhereProtocol.text(args, "draftId")
            guard let pending = flushes[id], pending.0 == view.id, pending.1 == draft else { throw PinItAnywhereFailure("scene-flush", "The draft save request has expired.") }
            let ok = try PinItAnywhereProtocol.bool(args, "ok"), sequence = try PinItAnywhereProtocol.number(args, "sequence"); flushes.removeValue(forKey: id)
            send("desktop-flushed", ["id": id, "viewId": view.id, "draftId": draft, "ok": ok, "sequence": sequence]); return NSNull()
        default: throw PinItAnywhereFailure("unsupported-method", "The desktop surface has no access to storage or system operations.")
        }
    }
    private func tryFocusEditor(_ view: PinItAnywhereSceneSurface) {
        guard let focus = editorFocus, focus.view == view.id, !displayPending, view.active, !view.retired, view.ready, view.applied >= focus.sequence else { return }
        editorFocus = nil; view.focusEditor()
    }
    private func tryFocus(_ view: PinItAnywhereSceneSurface) -> Bool {
        guard let sequence = focusSequence, let intent else { return false }
        guard current(intent) else { revokeIntent(); return false }
        guard !displayPending, view.active, !view.retired, view.ready, view.layer == "floating", view.applied >= sequence,
            view.downloading?.cards.contains(where: { $0.layer == view.layer && $0.draggable && $0.rect.intersects(view.viewport) }) == true else { return false }
        revokeIntent(); view.focus(); return true
    }
    private func pending(_ args: [String: Any]) throws -> Command {
        guard let value = commands[try PinItAnywhereProtocol.text(args, "ticket")] else { throw PinItAnywhereFailure("scene-command", "The desktop operation has expired.") }; return value
    }
    private func release(_ ticket: String) { if let value = commands.removeValue(forKey: ticket), let token = value.upload { transfers.drop(value.view.id, token) } }
    private func sweep() { for (ticket, value) in commands where Date().timeIntervalSince(value.created) > 120 { release(ticket) } }
    private func retire(_ view: PinItAnywhereSceneSurface) {
        guard !view.retired else { return }; view.close(); transfers.dropOwner(view.id)
        for (ticket, value) in commands where value.view === view { release(ticket) }
        sceneIntents = sceneIntents.filter { $0.value.0 != view.id }; flushes = flushes.filter { $0.value.0 != view.id }; frozen = frozen.filter { $0.value != view.id }
        send("desktop-view-lost", ["viewId": view.id, "message": PinItAnywhereText.text("desktop.viewLost")])
    }
    func close() {
        guard !closed else { return }; closed = true; displayTask?.cancel(); shortcuts.close()
        for (center, token) in observers { center.removeObserver(token) }; observers.removeAll()
        for view in views { view.close() }; views.removeAll(); transfers.close(); commands.removeAll(); flushes.removeAll(); frozen.removeAll(); revokeIntent()
    }
}
