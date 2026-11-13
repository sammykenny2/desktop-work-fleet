import AppKit

@main @MainActor final class PinItAnywhereApp: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var host: PinItAnywhereWebHost?
    private var statusItem: NSStatusItem?
    private var statusMenu: PinItAnywhereTrayMenu?
    private var desktop: PinItAnywhereDesktop?
    private var terminating = false
    private var mainAside = false
    private var shell: PinItAnywhereHostShell?
    private var updates: PinItAnywhereUpdates?
    private var attachmentFiles = PinItAnywhereAttachmentFiles()
    private var tick: Timer?
    func applicationWillTerminate(_ notification: Notification) { tick?.invalidate(); attachmentFiles.close() }
    static func main() {
        // Release packaging exercises the actual dyld loader without opening UI, storage or login items.
        if CommandLine.arguments.contains("--check-runtime") { print("PASS Pin It Anywhere runtime load"); return }
        let application = NSApplication.shared; let delegate = PinItAnywhereApp(); application.delegate = delegate; application.setActivationPolicy(.regular)
        // NSApplication's delegate is weak. Release optimization must not retire the owner while the run loop is active.
        withExtendedLifetime(delegate) { application.run() }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Read before anything else handles events: macOS marks a login-item launch on the open-application event.
        let launchedAtLogin = PinItAnywhereHostShell.detectLoginLaunch()
        do {
            let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PinItAnywhere", isDirectory: true)
            // The stored display language applies before anything is drawn, including a failure alert and a sign-in start's menu bar.
            let shell = PinItAnywhereHostShell(directory: directory, launchedAtLogin: launchedAtLogin); self.shell = shell; PinItAnywhereText.apply(shell.language)
            let host = try PinItAnywhereWebHost(directory: directory); self.host = host
            let config = (try? PinItAnywhereProtocol.json(Data(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("Config/public.json")))) ?? [:]
            let updates = PinItAnywhereUpdates(config: config, lastChecked: shell.lastUpdateCheck); self.updates = updates
            updates.publish = { [weak host] state in host?.event("update-state", ["state": state]) }
            updates.recordCheck = { [weak shell] time in shell?.recordUpdateCheck(time) }
            // A hidden page's timers slow down, so the host ticks every 20 seconds and a main window in the menu bar keeps syncing on time.
            tick = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak host] _ in MainActor.assumeIsolated { host?.event("host-tick") } }
            window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = PinItAnywhereText.text("common.appName"); window.minSize = NSSize(width: 380, height: 520); window.contentView = host.web; window.delegate = self; shell.apply(window)
            host.configure = { [weak self, weak host] service in
                guard let self, let host else { throw PinItAnywhereFailure("native-closed", "The native session has ended.") }
                self.desktop?.close()
                let desktop = try PinItAnywhereDesktop(assets: host.assets, send: { [weak host] name, values in host?.event(name, values) }, show: { [weak self] in self?.showHiddenMain() ?? false }, hide: { [weak self] in
                    guard let self, self.statusItem?.button != nil else { return false }; self.shell?.flush(); self.window.orderOut(nil); return true
                }, mainVisible: { [weak self] in self?.mainVisible($0) }); self.desktop = desktop
                await service.setDesktop { [weak desktop] method, args in guard let desktop else { throw PinItAnywhereFailure("desktop-closed", "The desktop session has ended.") }; return try desktop.invoke(method, args) }
                await service.setShell { [weak self] method, args in guard let self else { throw PinItAnywhereFailure("native-closed", "The native session has ended.") }; return try self.shellInvoke(method, args) }
                await service.setLanguage { [weak self] preference in guard let self else { throw PinItAnywhereFailure("native-closed", "The native session has ended.") }; try self.changeLanguage(preference) }
                await service.setUpdates(self.updates?.capable == true)
                self.attachmentFiles.close(); let files = PinItAnywhereAttachmentFiles(); self.attachmentFiles = files
                await service.setAttachmentFiles { bytes, name, open in
                    return try await files.invoke(bytes, name: name, open: open)
                }
            }
            host.stopped = { [weak self] in self?.desktop?.close(); self?.desktop = nil; self?.attachmentFiles.close() }
            host.finished = { [weak self] in guard let self else { return }; self.terminating = true; NSApplication.shared.reply(toApplicationShouldTerminate: true) }
            host.cancelled = { [weak self] message in
                NSApplication.shared.reply(toApplicationShouldTerminate: false)
                self?.updates?.resumePresentation()
                guard let message, !message.isEmpty else { return }
                // The update window can cover the renderer. Explain a refused quit above Sparkle, after cancelling termination.
                let area = PinItAnywhereUpdatePresentation.requestedArea()
                Task { [weak self] in
                    await self?.updates?.showMessage(title: PinItAnywhereText.text("dialog.quitCancelled"), message: message, warning: true, on: area)
                }
            }
            // The catalog's StatusItem glyph is a template image, so the menu-bar icon follows light/dark and highlight
            // states. Its vector is drawn on a 32-unit grid; 16 pt matches the height of the system menu-bar symbols.
            statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
            let glyph = NSImage(named: "StatusItem").map { image -> NSImage in
                image.size = NSSize(width: 16, height: 16); image.isTemplate = true
                image.accessibilityDescription = PinItAnywhereText.text("common.appName"); return image
            } ?? NSImage(systemSymbolName: "note.text", accessibilityDescription: PinItAnywhereText.text("common.appName"))
            if let glyph { statusItem?.button?.image = glyph } else { statusItem?.button?.title = "p." }
            statusItem?.button?.target = self
            statusItem?.button?.action = #selector(statusItemClicked(_:))
            statusItem?.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
            buildMenus()
            // A login-item start stays in the menu bar unless the user asked for the main window.
            if !shell.startHidden || statusItem?.button == nil { showMain() }
            shell.firstLaunch()
        } catch {
            let alert = NSAlert(); alert.messageText = PinItAnywhereText.text("common.appName"); alert.informativeText = PinItAnywhereText.dialog(error, fallback: "dialog.openFailed")
            alert.addButton(withTitle: PinItAnywhereText.text("dialog.ok")); alert.runModal(); NSApplication.shared.terminate(nil)
        }
    }
    /// The menu bar menu and the application menus in the host locale; drawn again when the display language changes.
    private func buildMenus() {
        if statusMenu == nil { statusMenu = PinItAnywhereTrayMenu(state: { [weak self] in
            guard let self else { return .init() }
            return .init(mainVisible: window.isVisible && !window.isMiniaturized, adjusting: desktop?.adjusting == true,
                         ready: desktop?.menuActionsAvailable == true, updates: updates?.capable == true, shortcuts: desktop?.shortcutAnswers ?? [])
        }, invoke: { [weak self] action in self?.trayAction(action) }, active: { [weak self] in self?.desktop?.menuActive($0) }) }
        let mainMenu = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu(); mainMenu.addItem(appItem); appItem.submenu = appMenu
        let appQuit = NSMenuItem(title: PinItAnywhereText.text("menu.quit"), action: #selector(quit), keyEquivalent: "q"); appQuit.target = self; appMenu.addItem(appQuit)
        let editTitle = PinItAnywhereText.text("menu.edit")
        let editItem = NSMenuItem(title: editTitle, action: nil, keyEquivalent: ""), editMenu = NSMenu(title: editTitle); mainMenu.addItem(editItem); editItem.submenu = editMenu
        for (key, selector, shortcut) in [("menu.undo", "undo:", "z"), ("menu.cut", "cut:", "x"), ("menu.copy", "copy:", "c"), ("menu.paste", "paste:", "v"), ("menu.selectAll", "selectAll:", "a")] {
            editMenu.addItem(NSMenuItem(title: PinItAnywhereText.text(key), action: Selector(selector), keyEquivalent: shortcut))
        }
        NSApplication.shared.mainMenu = mainMenu
    }
    /// host.language.set: the preference is saved with the startup settings before the menus change language.
    private func changeLanguage(_ preference: String) throws {
        guard let shell else { throw PinItAnywhereFailure("native-closed", "The native session has ended.") }
        try shell.setLanguage(preference); PinItAnywhereText.apply(preference); buildMenus()
        window.title = PinItAnywhereText.text("common.appName")
        statusItem?.button?.image?.accessibilityDescription = PinItAnywhereText.text("common.appName")
    }
    /// Shows the main window for a desktop action and reports whether it was hidden: ordered out, not minimized.
    private func showHiddenMain() -> Bool { let hidden = !window.isVisible && !window.isMiniaturized; showMain(); return hidden }
    // Attaching a menu to NSStatusItem consumes every click. Keep it separate so a primary click opens the window.
    @objc private func statusItemClicked(_ button: NSStatusBarButton) {
        let event = NSApplication.shared.currentEvent
        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
            desktop?.prepareMenu()
            statusMenu?.reload(); statusMenu?.menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.minY), in: button)
        } else { showMain() }
    }
    @objc private func showMain() {
        mainAside = false
        if !window.isVisible { shell?.beforeShow(window) }
        PinItAnywhereTrayMenu.showMain(window)
        if shell?.pendingMaximize == true { shell?.pendingMaximize = false; if !window.isZoomed { window.zoom(nil) } }
        NSApplication.shared.activate(ignoringOtherApps: false)
    }
    private func shellInvoke(_ method: String, _ args: [String: Any]) throws -> Any {
        guard let shell else { throw PinItAnywhereFailure("native-closed", "The native session has ended.") }
        switch method {
        case "host.preferences.get": return shell.describe(trayAvailable: statusItem?.button != nil)
        case "host.preferences.set": return try shell.set(PinItAnywhereProtocol.text(args, "name", 32), PinItAnywhereProtocol.bool(args, "value"), trayAvailable: statusItem?.button != nil)
        case "host.preferences.openSystem": PinItAnywhereHostShell.openSystemSettings(); return NSNull()
        case "host.window.resetPlacement": try shell.reset(window); return NSNull()
        case "data.reveal": NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: try PinItAnywhereProtocol.text(args, "path", 4096), isDirectory: true)]); return NSNull()
        case "update.state": return updates?.snapshot() ?? [:]
        case "update.check":
            let area = PinItAnywhereUpdatePresentation.requestedArea(owner: window)
            if let updates { Task { await updates.check(on: area) } }
            return updates?.snapshot() ?? [:]
        // Sparkle's own dialogs download and install, so the page never asks for these on macOS.
        default: throw PinItAnywhereFailure("unsupported-method", "The native host does not support this operation.")
        }
    }
    /// The menu bar asks once: no newer release gets a short answer here; a newer one opens Sparkle's update dialog.
    @objc private func checkUpdates() {
        guard let updates else { return }
        let area = PinItAnywhereUpdatePresentation.requestedArea()
        Task { await updates.check(on: area, showResult: true) }
    }
    func windowDidMove(_ notification: Notification) { shell?.observe(window) }
    func windowDidResize(_ notification: Notification) { shell?.observe(window) }
    func windowDidDeminiaturize(_ notification: Notification) { shell?.observe(window) }
    func windowDidExitFullScreen(_ notification: Notification) { shell?.observe(window) }
    /// The owner asks only for a main window that had the focus as adjust mode began. Minimized, it keeps its frame;
    /// only the window minimized here comes back.
    private func mainVisible(_ visible: Bool) {
        if visible { if mainAside { mainAside = false; window.deminiaturize(nil); showMain() } }
        else if !mainAside && window.isVisible && !window.isMiniaturized { mainAside = true; window.miniaturize(nil) }
    }
    @objc private func quit() { NSApplication.shared.terminate(nil) }
    private func trayAction(_ action: String) {
        switch action {
        case "show": DispatchQueue.main.async { [weak self] in self?.showMain() }
        case "update": DispatchQueue.main.async { [weak self] in self?.checkUpdates() }
        case "exit": DispatchQueue.main.async { [weak self] in self?.quit() }
        default:
            guard desktop?.menuActionsAvailable == true else { showMain(); return }
            desktop?.menuAction(action)
        }
    }
    // The close button keeps Pin It Anywhere in the menu bar unless that setting is off; Quit still saves first.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if terminating { return true }
        if statusItem?.button != nil && shell?.closeToTray != false { shell?.flush(); sender.orderOut(nil) } else { NSApplication.shared.terminate(nil) }
        return false
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        shell?.flush()
        updates?.suspendPresentation()
        if terminating || host == nil { return .terminateNow }; Task { await host?.prepareClose() }; return .terminateLater
    }
    func application(_ application: NSApplication, open urls: [URL]) { for url in urls { _ = PinItAnywhereGoogle.handle(url) } }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showMain(); return true }
}
