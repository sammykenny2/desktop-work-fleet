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
        _ = try await value("document.querySelector('#compose').click(); true")
        try await until("The second synthetic editor must open") { try await self.value("document.querySelector('#editor-dialog').open") }
        _ = try await value("{ const field=document.querySelector('#editor-text'); field.value='Second synthetic stacking note'; field.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#editor-form').requestSubmit(); } true")
        try await until("The second note must save") { try await self.value("!document.querySelector('#editor-dialog').open && document.querySelectorAll('.note-paper').length === 2") }
        try choose("@toggle") // The earlier toggle hid desktop notes; show them before checking resident order.
        try choose("@all")
        try await until("Stacking adjustment must start") { self.desktop?.adjusting == true }
        guard let desktop, let views = Mirror(reflecting: desktop).children.first(where: { $0.label == "views" })?.value as? [PinItAnywhereSceneSurface],
              let floating = views.first(where: { $0.layer == "floating" }), let wallpaper = views.first(where: { $0.layer == "wallpaper" }) else {
            throw NSError(domain: "TrayBridgeProbe", code: 6, userInfo: [NSLocalizedDescriptionKey: "Missing native stacking surfaces"])
        }
        try await until("Both papers must reach the real WKWebView") { floating.downloading?.cards.count == 2 && floating.applied == floating.downloading?.sequence }
        let cards = floating.downloading!.cards, rear = cards[0], front = cards[1]
        let info = try floating.dispatch!(floating, "scene.info", [:]) as! [String: Any]
        var serial = 10000
        func command(_ method: String, _ args: [String: Any]) async throws {
            serial += 1
            _ = try floating.dispatch!(floating, "scene.command", ["topology": info["topology"]!, "command": [
                "id": PinItAnywhereProtocol.uuid(), "sessionId": info["sessionId"]!, "serial": serial, "method": method, "args": args]])
            try await until("The native owner must settle \(method)") {
                Mirror(reflecting: desktop).children.first(where: { $0.label == "commands" }).map { Mirror(reflecting: $0.value).children.isEmpty } == true
            }
        }
        func drag(_ paper: PinItAnywhereSceneFrame.Card, _ target: NSPoint, returning: Bool = false) async throws {
            let id = PinItAnywhereProtocol.uuid(), start = NSPoint(x: paper.rect.minX + 30, y: paper.rect.minY + 16)
            func point(_ p: NSPoint) -> [String: Any] { ["x": p.x, "y": p.y] }
            let common: [String: Any] = ["gestureId": id, "pointerId": 1]
            try await command("pointer.down", common.merging(["cardId": paper.id, "point": point(start)]) { _, new in new })
            try await command("pointer.move", common.merging(["point": point(target), "labels": []]) { _, new in new })
            try await command("pointer.up", common.merging(["point": point(returning ? start : target), "labels": []]) { _, new in new })
        }
        // Move one paper exactly onto another through the production native mailbox/controller/SQLite path.
        try await drag(front, NSPoint(x: rear.rect.minX + 30, y: rear.rect.minY + 16))
        try await command("card.select", ["cardId": rear.id])
        try await until("A selected rear paper must become frontmost") { floating.downloading?.cards.last?.id == rear.id }
        let back = floating.downloading!.cards.first(where: { $0.id == front.id })!
        try await drag(back, NSPoint(x: back.rect.minX + 50, y: back.rect.minY + 16), returning: true)
        try await until("An order-only drag must become frontmost") { floating.downloading?.cards.last?.id == front.id && floating.applied == floating.downloading?.sequence }
        let hit = "document.elementFromPoint(\(rear.rect.midX - floating.viewport.minX),\(rear.rect.minY + 16 - floating.viewport.minY))?.closest('.card')?.dataset.cardId"
        let painted = try await floating.web.evaluateJavaScript(hit) as? String
        guard painted == front.id else { throw NSError(domain: "TrayBridgeProbe", code: 7, userInfo: [NSLocalizedDescriptionKey: "WKWebView paint/hit order differs from the saved order"]) }
        try await command("interaction.done", [:])
        try await until("Done must preserve the front paper on the resident Wallpaper layer") {
            desktop.adjusting == false && wallpaper.downloading?.cards.last?.id == front.id && wallpaper.applied == wallpaper.downloading?.sequence
        }
        let top = try await wallpaper.web.evaluateJavaScript("[...document.querySelectorAll('.card')].sort((a,b)=>Number(a.style.zIndex)-Number(b.style.zIndex)).at(-1)?.dataset.cardId") as? String
        guard top == front.id else { throw NSError(domain: "TrayBridgeProbe", code: 8, userInfo: [NSLocalizedDescriptionKey: "Resident WKWebView lost the completed drag order"]) }
        print("PASS macOS stacking: real native mailbox, renderer, encrypted SQLite, overlap hit order and persistence after Done")
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
