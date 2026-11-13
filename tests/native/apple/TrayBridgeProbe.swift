import AppKit
import CryptoKit

// The real native database and bridge run against disposable data and a synthetic key; never the user's Keychain.
enum PinItAnywhereKeychain {
    static func storageKey(existing: Bool) throws -> SymmetricKey { SymmetricKey(data: Data(repeating: 57, count: 32)) }
    static func read(_ id: String) throws -> Data? { nil }
    static func save(_ id: String, _ data: Data) throws { }
    static func remove(_ id: String) throws { }
}

@MainActor final class TrayBridgeProbe: NSObject, NSApplicationDelegate {
    var host: PinItAnywhereWebHost!, desktop: PinItAnywhereDesktop?, window: NSWindow!
    var publications = 0
    var actionsSent = 0
    var selectingMenu = false
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task {
            do { try await run(); desktop?.close(); await host.stop(); print("PASS tray bridge: hidden-owner toggle, adjust, finish and quick capture"); exit(0) }
            catch {
                if let host, let state = try? await host.web.evaluateJavaScript("JSON.stringify({ready:document.readyState,url:location.href,body:document.body?.innerText.slice(0,1200)})") {
                    fputs("Synthetic owner diagnostic: \(state)\n", stderr)
                }
                fputs("FAIL tray bridge: \(error)\n", stderr); exit(1)
            }
        }
    }
    func value(_ script: String) async throws -> Bool { (try await host.web.evaluateJavaScript(script) as? Bool) == true }
    func until(_ label: String, _ predicate: () async throws -> Bool) async throws {
        let end = ProcessInfo.processInfo.systemUptime + 25
        while ProcessInfo.processInfo.systemUptime < end {
            if (try? await predicate()) == true { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw NSError(domain: "TrayBridgeProbe", code: 1, userInfo: [NSLocalizedDescriptionKey: label])
    }
    func run() async throws {
        PinItAnywhereText.apply("en")
        host = try PinItAnywhereWebHost(directory: URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true))
        window = NSWindow(contentRect: NSRect(x: -10000, y: -10000, width: 1180, height: 800), styleMask: [.titled, .miniaturizable], backing: .buffered, defer: false)
        window.contentView = host.web; window.orderFront(nil)
        host.configure = { [weak self] service in
            guard let self else { return }
            self.desktop?.close()
            let desktop = try PinItAnywhereDesktop(assets: self.host.assets, send: { [weak self] name, args in
                if name == "desktop-action" { self?.actionsSent += 1 }
                self?.host.event(name, args)
            },
                show: { [weak self] in guard let self else { return false }; let hidden = !self.window.isVisible; self.window.orderFront(nil); return hidden },
                hide: { [weak self] in self?.window.orderOut(nil); return true }, mainVisible: { _ in },
                foregroundProcess: { [weak self] in self?.selectingMenu == true ? nil : NSWorkspace.shared.frontmostApplication?.processIdentifier })
            self.desktop = desktop
            await service.setDesktop { [weak self, weak desktop] method, args in
                guard let desktop else { throw PinItAnywhereFailure("desktop-closed", "The synthetic desktop closed.") }
                let result = try desktop.invoke(method, args)
                if method == "desktop.frame.publish" { self?.publications += 1 }
                return result
            }
        }
        try await until("The production owner must become ready") { try await self.value("document.body.dataset.ready === 'true'") }
        try await until("The native desktop must start") { self.desktop?.menuActionsAvailable == true }
        _ = try await value("document.querySelector('.first-note button').click(); true")
        try await until("The synthetic editor must open") { try await self.value("document.querySelector('#editor-dialog').open") }
        _ = try await value("{ const field=document.querySelector('#editor-text'); field.value='Synthetic tray note'; field.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#editor-form').requestSubmit(); } true")
        try await until("The synthetic note must save") { try await self.value("!document.querySelector('#editor-dialog').open && document.querySelectorAll('.note-paper').length === 1") }
        window.orderOut(nil)
        let strictBefore = actionsSent; selectingMenu = true; desktop?.action("@toggle"); selectingMenu = false
        guard actionsSent == strictBefore else {
            throw NSError(domain: "TrayBridgeProbe", code: 4, userInfo: [NSLocalizedDescriptionKey: "A global shortcut must still require a foreground app"])
        }
        let menu = PinItAnywhereTrayMenu(state: { [weak self] in
            .init(adjusting: self?.desktop?.adjusting == true, ready: self?.desktop?.menuActionsAvailable == true)
        }, invoke: { [weak self] target in self?.desktop?.menuAction(target) }, active: { [weak self] in self?.desktop?.menuActive($0) })
        func choose(_ target: String) throws {
            self.desktop?.prepareMenu()
            menu.reload(); menu.menuWillOpen(menu.menu)
            guard let index = menu.menu.items.firstIndex(where: { $0.representedObject as? String == target }) else {
                throw NSError(domain: "TrayBridgeProbe", code: 2, userInfo: [NSLocalizedDescriptionKey: "Missing \(target)"])
            }
            selectingMenu = true
            menu.menu.performActionForItem(at: index)
            selectingMenu = false
        }
        let before = publications; try choose("@toggle")
        try await until("Toggle from a hidden owner must publish") { self.publications > before }
        _ = try await value("document.querySelector('#settings-button').click(); true")
        try await until("Settings must open") { try await self.value("document.querySelector('#settings-dialog').open") }
        guard try await value("document.querySelector('#desktop-visible').checked === false") else {
            throw NSError(domain: "TrayBridgeProbe", code: 3, userInfo: [NSLocalizedDescriptionKey: "Toggle did not change the saved desktop choice"])
        }
        _ = try await value("document.querySelector('#close-settings').click(); true")
        try await until("Settings must close") { try await self.value("!document.querySelector('#settings-dialog').open") }
        try choose("@all"); try await until("Adjust must reach the real owner") { self.desktop?.adjusting == true }
        try choose("@stop"); try await until("Done must leave adjustment") { self.desktop?.adjusting == false }
        try choose("@capture")
        try await until("Quick capture must open the real editor") { try await self.value("document.querySelector('#editor-dialog').open") }
        guard window.isVisible else {
            throw NSError(domain: "TrayBridgeProbe", code: 5, userInfo: [NSLocalizedDescriptionKey: "Quick capture opened an editor behind a hidden main window"])
        }
        _ = try await value("document.querySelector('#close-editor-button').click(); true")
        try await until("The synthetic editor must close") { try await self.value("!document.querySelector('#editor-dialog').open") }
    }
}

@main struct TrayBridgeMain {
    @MainActor static func main() {
        let app = NSApplication.shared; app.setActivationPolicy(.prohibited)
        guard !NSScreen.screens.isEmpty else { print("SKIP tray bridge: no graphical Mac session"); exit(77) }
        let delegate = TrayBridgeProbe(); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
