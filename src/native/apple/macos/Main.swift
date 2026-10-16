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
    func applicationWillTerminate(_ notification: Notification) { attachmentFiles.close() }
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
            let host = try FleetWebHost(directory: directory); self.host = host
            let shell = FleetHostShell(directory: directory, launchedAtLogin: launchedAtLogin); self.shell = shell
            let config = (try? FleetProtocol.json(Data(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("Config/public.json")))) ?? [:]
            let updates = FleetUpdates(config: config, lastChecked: shell.lastUpdateCheck); self.updates = updates
            updates.publish = { [weak host] state in host?.event("update-state", ["state": state]) }
            updates.recordCheck = { [weak shell] time in shell?.recordUpdateCheck(time) }
            window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "Work Fleet"; window.minSize = NSSize(width: 380, height: 520); window.contentView = host.web; window.delegate = self; shell.apply(window)
            host.configure = { [weak self, weak host] service in
                guard let self, let host else { throw FleetFailure("native-closed", "原生工作階段已結束。") }
                self.desktop?.close()
                let desktop = try FleetDesktop(assets: host.assets, send: { [weak host] name, values in host?.event(name, values) }, show: { [weak self] in self?.showMain() }, hide: { [weak self] in
                    guard let self, self.statusItem?.button != nil else { return false }; self.shell?.flush(); self.window.orderOut(nil); return true
                }, mainVisible: { [weak self] in self?.mainVisible($0) }); self.desktop = desktop
                await service.setDesktop { [weak desktop] method, args in guard let desktop else { throw FleetFailure("desktop-closed", "桌面工作階段已結束。") }; return try desktop.invoke(method, args) }
                await service.setShell { [weak self] method, args in guard let self else { throw FleetFailure("native-closed", "原生工作階段已結束。") }; return try self.shellInvoke(method, args) }
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
            let menu = NSMenu(); menu.delegate = self; let show = NSMenuItem(title: "開啟 Work Fleet", action: #selector(showMain), keyEquivalent: ""); show.target = self; menu.addItem(show)
            for (title, target) in [("快速記錄", "@capture"), ("調整所有群組", "@all"), ("顯示／隱藏桌面便箋", "@toggle")] {
                let item = NSMenuItem(title: title, action: #selector(desktopAction(_:)), keyEquivalent: ""); item.target = self; item.representedObject = target; menu.addItem(item)
            }
            if updates.capable { let item = NSMenuItem(title: "檢查更新…", action: #selector(checkUpdates), keyEquivalent: ""); item.target = self; menu.addItem(item) }
            menu.addItem(.separator()); let quitItem = NSMenuItem(title: "保存並結束", action: #selector(quit), keyEquivalent: "q"); quitItem.target = self; menu.addItem(quitItem); statusItem?.menu = menu
            let mainMenu = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu(); mainMenu.addItem(appItem); appItem.submenu = appMenu
            let appQuit = NSMenuItem(title: "保存並結束 Work Fleet", action: #selector(quit), keyEquivalent: "q"); appQuit.target = self; appMenu.addItem(appQuit)
            let editItem = NSMenuItem(title: "編輯", action: nil, keyEquivalent: ""), editMenu = NSMenu(title: "編輯"); mainMenu.addItem(editItem); editItem.submenu = editMenu
            for (title, selector, key) in [("復原", "undo:", "z"), ("剪下", "cut:", "x"), ("拷貝", "copy:", "c"), ("貼上", "paste:", "v"), ("全選", "selectAll:", "a")] { editMenu.addItem(NSMenuItem(title: title, action: Selector(selector), keyEquivalent: key)) }
            NSApplication.shared.mainMenu = mainMenu
            // A login-item start stays in the menu bar unless the user asked for the main window.
            if !shell.startHidden || statusItem?.button == nil { showMain() }
            shell.firstLaunch()
        } catch { let alert = NSAlert(); alert.messageText = "Work Fleet"; alert.informativeText = (error as? FleetFailure)?.message ?? "無法開啟安全工作空間。"; alert.runModal(); NSApplication.shared.terminate(nil) }
    }
    @objc private func showMain() {
        if !window.isVisible { shell?.beforeShow(window) }
        window.makeKeyAndOrderFront(nil)
        if shell?.pendingMaximize == true { shell?.pendingMaximize = false; if !window.isZoomed { window.zoom(nil) } }
        NSApplication.shared.activate(ignoringOtherApps: false)
    }
    private func shellInvoke(_ method: String, _ args: [String: Any]) throws -> Any {
        guard let shell else { throw FleetFailure("native-closed", "原生工作階段已結束。") }
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
        default: throw FleetFailure("unsupported-method", "原生主機沒有此操作。")
        }
    }
    /// The menu bar asks once: no newer release gets a short answer here; a newer one opens Sparkle's update dialog.
    @objc private func checkUpdates() {
        guard let updates else { return }
        Task {
            await updates.check()
            guard updates.status == "up_to_date" || updates.status == "failed" else { return }
            NSApplication.shared.activate(ignoringOtherApps: true)
            let alert = NSAlert(); alert.messageText = "Work Fleet 更新"
            alert.informativeText = updates.status == "up_to_date" ? "Work Fleet \(updates.currentText) 已是最新版本。" : updates.error?.message ?? "更新沒有完成，請稍後再試。"
            alert.runModal()
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
    // The close button keeps Work Fleet in the menu bar unless that setting is off; 保存並結束 still saves and quits.
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
