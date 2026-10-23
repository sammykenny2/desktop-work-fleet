import AppKit

@main @MainActor final class FleetApp: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuDelegate {
    private var window: NSWindow!
    private var host: FleetWebHost?
    private var statusItem: NSStatusItem?
    private var desktop: FleetDesktop?
    private var terminating = false
    private var mainAside = false
    private var shell: FleetHostShell?
    private var updates: FleetUpdates?
    private var attachmentFiles = FleetAttachmentFiles()
    private var tick: Timer?
    func applicationWillTerminate(_ notification: Notification) { tick?.invalidate(); attachmentFiles.close() }
    static func main() {
        // Release packaging exercises the actual dyld loader without opening UI, storage or login items.
        if CommandLine.arguments.contains("--check-runtime") { print("PASS Work Fleet runtime load"); return }
        let application = NSApplication.shared; let delegate = FleetApp(); application.delegate = delegate; application.setActivationPolicy(.regular); application.run()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Read before anything else handles events: macOS marks a login-item launch on the open-application event.
        let launchedAtLogin = FleetHostShell.detectLoginLaunch()
        do {
            let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("WorkFleet", isDirectory: true)
            // The stored display language applies before anything is drawn, including a failure alert and a sign-in start's menu bar.
            let shell = FleetHostShell(directory: directory, launchedAtLogin: launchedAtLogin); self.shell = shell; FleetText.apply(shell.language)
            let host = try FleetWebHost(directory: directory); self.host = host
            let config = (try? FleetProtocol.json(Data(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("Config/public.json")))) ?? [:]
            let updates = FleetUpdates(config: config, lastChecked: shell.lastUpdateCheck); self.updates = updates
            updates.publish = { [weak host] state in host?.event("update-state", ["state": state]) }
            updates.recordCheck = { [weak shell] time in shell?.recordUpdateCheck(time) }
            // A hidden page's timers slow down, so the host ticks every 20 seconds and a main window in the menu bar keeps syncing on time.
            tick = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak host] _ in MainActor.assumeIsolated { host?.event("host-tick") } }
            window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "Work Fleet"; window.minSize = NSSize(width: 380, height: 520); window.contentView = host.web; window.delegate = self; shell.apply(window)
            host.configure = { [weak self, weak host] service in
                guard let self, let host else { throw FleetFailure("native-closed", "The native session has ended.") }
                self.desktop?.close()
                let desktop = try FleetDesktop(assets: host.assets, send: { [weak host] name, values in host?.event(name, values) }, show: { [weak self] in self?.showHiddenMain() ?? false }, hide: { [weak self] in
                    guard let self, self.statusItem?.button != nil else { return false }; self.shell?.flush(); self.window.orderOut(nil); return true
                }, mainVisible: { [weak self] in self?.mainVisible($0) }); self.desktop = desktop
                await service.setDesktop { [weak desktop] method, args in guard let desktop else { throw FleetFailure("desktop-closed", "The desktop session has ended.") }; return try desktop.invoke(method, args) }
                await service.setShell { [weak self] method, args in guard let self else { throw FleetFailure("native-closed", "The native session has ended.") }; return try self.shellInvoke(method, args) }
                await service.setLanguage { [weak self] preference in guard let self else { throw FleetFailure("native-closed", "The native session has ended.") }; try self.changeLanguage(preference) }
                await service.setUpdates(self.updates?.capable == true)
                self.attachmentFiles.close(); let files = FleetAttachmentFiles(); self.attachmentFiles = files
                await service.setAttachmentFiles { bytes, name, open in
                    return try await files.invoke(bytes, name: name, open: open)
                }
            }
            host.stopped = { [weak self] in self?.desktop?.close(); self?.desktop = nil; self?.attachmentFiles.close() }
            host.finished = { [weak self] in guard let self else { return }; self.terminating = true; NSApplication.shared.reply(toApplicationShouldTerminate: true) }
            host.cancelled = { NSApplication.shared.reply(toApplicationShouldTerminate: false) }
            // SF Symbols are template images, so the menu-bar icon follows light/dark and highlight states.
            statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
            if let image = NSImage(systemSymbolName: "note.text", accessibilityDescription: "Work Fleet") { statusItem?.button?.image = image } else { statusItem?.button?.title = "w." }
            buildMenus()
            // A login-item start stays in the menu bar unless the user asked for the main window.
            if !shell.startHidden || statusItem?.button == nil { showMain() }
            shell.firstLaunch()
        } catch {
            let alert = NSAlert(); alert.messageText = "Work Fleet"; alert.informativeText = FleetText.dialog(error, fallback: "dialog.openFailed")
            alert.addButton(withTitle: FleetText.text("dialog.ok")); alert.runModal(); NSApplication.shared.terminate(nil)
        }
    }
    /// The menu bar menu and the application menus in the host locale; drawn again when the display language changes.
    private func buildMenus() {
        let menu = NSMenu(); menu.delegate = self; let show = NSMenuItem(title: FleetText.text("menuBar.open"), action: #selector(showMain), keyEquivalent: ""); show.target = self; menu.addItem(show)
        for (key, target) in [("menuBar.quickCapture", "@capture"), ("menuBar.adjustAll", "@all"), ("menuBar.toggleDesktop", "@toggle")] {
            let item = NSMenuItem(title: FleetText.text(key), action: #selector(desktopAction(_:)), keyEquivalent: ""); item.target = self; item.representedObject = target; menu.addItem(item)
        }
        if updates?.capable == true { let item = NSMenuItem(title: FleetText.text("menuBar.checkUpdates"), action: #selector(checkUpdates), keyEquivalent: ""); item.target = self; menu.addItem(item) }
        menu.addItem(.separator()); let quitItem = NSMenuItem(title: FleetText.text("menuBar.quit"), action: #selector(quit), keyEquivalent: "q"); quitItem.target = self; menu.addItem(quitItem); statusItem?.menu = menu
        let mainMenu = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu(); mainMenu.addItem(appItem); appItem.submenu = appMenu
        let appQuit = NSMenuItem(title: FleetText.text("menu.quit"), action: #selector(quit), keyEquivalent: "q"); appQuit.target = self; appMenu.addItem(appQuit)
        let editTitle = FleetText.text("menu.edit")
        let editItem = NSMenuItem(title: editTitle, action: nil, keyEquivalent: ""), editMenu = NSMenu(title: editTitle); mainMenu.addItem(editItem); editItem.submenu = editMenu
        for (key, selector, shortcut) in [("menu.undo", "undo:", "z"), ("menu.cut", "cut:", "x"), ("menu.copy", "copy:", "c"), ("menu.paste", "paste:", "v"), ("menu.selectAll", "selectAll:", "a")] {
            editMenu.addItem(NSMenuItem(title: FleetText.text(key), action: Selector(selector), keyEquivalent: shortcut))
        }
        NSApplication.shared.mainMenu = mainMenu
    }
    /// host.language.set: the preference is saved with the startup settings before the menus change language.
    private func changeLanguage(_ preference: String) throws {
        guard let shell else { throw FleetFailure("native-closed", "The native session has ended.") }
        try shell.setLanguage(preference); FleetText.apply(preference); buildMenus()
    }
    /// Shows the main window for a desktop action and reports whether it was hidden: ordered out, not minimized.
    private func showHiddenMain() -> Bool { let hidden = !window.isVisible && !window.isMiniaturized; showMain(); return hidden }
    @objc private func showMain() {
        if !window.isVisible { shell?.beforeShow(window) }
        window.makeKeyAndOrderFront(nil)
        if shell?.pendingMaximize == true { shell?.pendingMaximize = false; if !window.isZoomed { window.zoom(nil) } }
        NSApplication.shared.activate(ignoringOtherApps: false)
    }
    private func shellInvoke(_ method: String, _ args: [String: Any]) throws -> Any {
        guard let shell else { throw FleetFailure("native-closed", "The native session has ended.") }
        switch method {
        case "host.preferences.get": return shell.describe(trayAvailable: statusItem?.button != nil)
        case "host.preferences.set": return try shell.set(FleetProtocol.text(args, "name", 32), FleetProtocol.bool(args, "value"), trayAvailable: statusItem?.button != nil)
        case "host.preferences.openSystem": FleetHostShell.openSystemSettings(); return NSNull()
        case "host.window.resetPlacement": try shell.reset(window); return NSNull()
        case "update.state": return updates?.snapshot() ?? [:]
        case "update.check":
            if let updates { Task { await updates.check() } }
            return updates?.snapshot() ?? [:]
        // Sparkle's own dialogs download and install, so the page never asks for these on macOS.
        default: throw FleetFailure("unsupported-method", "The native host does not support this operation.")
        }
    }
    /// The menu bar asks once: no newer release gets a short answer here; a newer one opens Sparkle's update dialog.
    @objc private func checkUpdates() {
        guard let updates else { return }
        Task {
            await updates.check()
            guard updates.status == "up_to_date" || updates.status == "failed" else { return }
            NSApplication.shared.activate(ignoringOtherApps: true)
            let alert = NSAlert(); alert.messageText = FleetText.text("dialog.updateTitle")
            alert.informativeText = updates.status == "up_to_date" ? FleetText.text("dialog.upToDate", ["version": updates.currentText]) : updates.error?.message ?? FleetText.text("dialog.updateFailed")
            alert.addButton(withTitle: FleetText.text("dialog.ok")); alert.runModal()
        }
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
    @objc private func desktopAction(_ item: NSMenuItem) { if let target = item.representedObject as? String { desktop?.menuActive(false); desktop?.action(target) } }
    func menuWillOpen(_ menu: NSMenu) { desktop?.menuActive(true) }
    func menuDidClose(_ menu: NSMenu) { desktop?.menuActive(false) }
    // The close button keeps Work Fleet in the menu bar unless that setting is off; "Save and quit" still saves and quits.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if terminating { return true }
        if statusItem?.button != nil && shell?.closeToTray != false { shell?.flush(); sender.orderOut(nil) } else { NSApplication.shared.terminate(nil) }
        return false
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        shell?.flush()
        if terminating || host == nil { return .terminateNow }; Task { await host?.prepareClose() }; return .terminateLater
    }
    func application(_ application: NSApplication, open urls: [URL]) { for url in urls { _ = FleetGoogle.handle(url) } }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showMain(); return true }
}
