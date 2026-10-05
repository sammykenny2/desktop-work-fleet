import AppKit

@main @MainActor final class FleetApp: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuDelegate {
    private var window: NSWindow!
    private var host: FleetWebHost?
    private var statusItem: NSStatusItem?
    private var desktop: FleetDesktop?
    private var terminating = false
    static func main() { let application = NSApplication.shared; let delegate = FleetApp(); application.delegate = delegate; application.setActivationPolicy(.regular); application.run() }
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("WorkFleet", isDirectory: true)
            let host = try FleetWebHost(directory: directory); self.host = host
            window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "Work Fleet"; window.minSize = NSSize(width: 380, height: 520); window.contentView = host.web; window.delegate = self; window.center(); window.makeKeyAndOrderFront(nil)
            host.configure = { [weak self, weak host] service in
                guard let self, let host else { throw FleetFailure("native-closed", "原生工作階段已結束。") }
                self.desktop?.close()
                let desktop = try FleetDesktop(assets: host.assets, send: { [weak host] name, values in host?.event(name, values) }, show: { [weak self] in self?.showMain() }, hide: { [weak self] in
                    guard let self, self.statusItem?.button != nil else { return false }; self.window.orderOut(nil); return true
                }); self.desktop = desktop
                await service.setDesktop { [weak desktop] method, args in guard let desktop else { throw FleetFailure("desktop-closed", "桌面工作階段已結束。") }; return try desktop.invoke(method, args) }
            }
            host.stopped = { [weak self] in self?.desktop?.close(); self?.desktop = nil }
            host.finished = { [weak self] in guard let self else { return }; self.terminating = true; NSApplication.shared.reply(toApplicationShouldTerminate: true) }
            host.cancelled = { NSApplication.shared.reply(toApplicationShouldTerminate: false) }
            statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength); statusItem?.button?.title = "w."
            let menu = NSMenu(); menu.delegate = self; let show = NSMenuItem(title: "開啟 Work Fleet", action: #selector(showMain), keyEquivalent: ""); show.target = self; menu.addItem(show)
            for (title, target) in [("快速記錄", "@capture"), ("操作所有群組", "@all"), ("顯示／隱藏桌面便箋", "@toggle")] {
                let item = NSMenuItem(title: title, action: #selector(desktopAction(_:)), keyEquivalent: ""); item.target = self; item.representedObject = target; menu.addItem(item)
            }
            menu.addItem(.separator()); let quitItem = NSMenuItem(title: "保存並結束", action: #selector(quit), keyEquivalent: "q"); quitItem.target = self; menu.addItem(quitItem); statusItem?.menu = menu
            let mainMenu = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu(); mainMenu.addItem(appItem); appItem.submenu = appMenu
            let appQuit = NSMenuItem(title: "保存並結束 Work Fleet", action: #selector(quit), keyEquivalent: "q"); appQuit.target = self; appMenu.addItem(appQuit)
            let editItem = NSMenuItem(title: "編輯", action: nil, keyEquivalent: ""), editMenu = NSMenu(title: "編輯"); mainMenu.addItem(editItem); editItem.submenu = editMenu
            for (title, selector, key) in [("復原", "undo:", "z"), ("剪下", "cut:", "x"), ("拷貝", "copy:", "c"), ("貼上", "paste:", "v"), ("全選", "selectAll:", "a")] { editMenu.addItem(NSMenuItem(title: title, action: Selector(selector), keyEquivalent: key)) }
            NSApplication.shared.mainMenu = mainMenu
        } catch { let alert = NSAlert(); alert.messageText = "Work Fleet"; alert.informativeText = (error as? FleetFailure)?.message ?? "無法開啟安全工作空間。"; alert.runModal(); NSApplication.shared.terminate(nil) }
    }
    @objc private func showMain() { window.makeKeyAndOrderFront(nil); NSApplication.shared.activate(ignoringOtherApps: false) }
    @objc private func quit() { NSApplication.shared.terminate(nil) }
    @objc private func desktopAction(_ item: NSMenuItem) { if let target = item.representedObject as? String { desktop?.menuActive(false); desktop?.action(target) } }
    func menuWillOpen(_ menu: NSMenu) { desktop?.menuActive(true) }
    func menuDidClose(_ menu: NSMenu) { desktop?.menuActive(false) }
    // The close button keeps Work Fleet in the menu bar; 保存並結束 still saves and quits.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if terminating { return true }; if statusItem?.button != nil { sender.orderOut(nil) } else { NSApplication.shared.terminate(nil) }; return false
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if terminating || host == nil { return .terminateNow }; Task { await host?.prepareClose() }; return .terminateLater
    }
    func application(_ application: NSApplication, open urls: [URL]) { for url in urls { _ = FleetGoogle.handle(url) } }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showMain(); return true }
}
