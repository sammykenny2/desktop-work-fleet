import AppKit

@main struct TrayMenuProbe {
    @MainActor static func main() throws {
        let app = NSApplication.shared; app.setActivationPolicy(.prohibited)
        let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String: Any]
        let shortcuts = fixture["shortcuts"] as! [[String: String]]
        func check(_ value: Bool, _ message: String) throws {
            if !value { throw NSError(domain: "TrayMenuProbe", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
        }
        for test in fixture["cases"] as! [[String: Any]] {
            let rows = PinItAnywhereTrayMenu.entries(.init(mainVisible: test["mainVisible"] as! Bool, adjusting: test["adjusting"] as! Bool,
                ready: test["ready"] as! Bool, updates: test["updates"] as! Bool, shortcuts: shortcuts))
            try check(rows.map(\.action) == test["actions"] as! [String], "Shared action order: \(test["name"]!)")
            try check(rows.filter { !$0.enabled }.map(\.action) == test["disabled"] as! [String], "Shared enabled state")
            let keys = Dictionary(uniqueKeysWithValues: rows.compactMap { row in row.shortcut.map { (row.action, $0) } })
            try check(keys == test["keys"] as! [String: String], "Shared shortcut hints")
        }
        var state = PinItAnywhereTrayMenu.State(mainVisible: true, ready: true, updates: true, shortcuts: shortcuts)
        var tracking = false, sentWhileTracking = false; var actions: [String] = []
        let controller = PinItAnywhereTrayMenu(state: { state }, invoke: { action in
            sentWhileTracking = sentWhileTracking || tracking; actions.append(action)
        }, active: { tracking = $0 })
        controller.reload(); controller.menu.update()
        try check(!controller.menu.autoenablesItems, "Explicit readiness must not be overridden by responder validation")
        let capture = controller.menu.items.first { $0.representedObject as? String == "@capture" }!
        try check(capture.keyEquivalent == "n" && capture.keyEquivalentModifierMask == [.control, .shift], "Native shortcut annotation")
        let expected = controller.menu.items.compactMap { $0.representedObject as? String }
        for index in controller.menu.items.indices where !controller.menu.items[index].isSeparatorItem {
            controller.menuWillOpen(controller.menu)
            controller.menu.performActionForItem(at: index)
        }
        try check(actions == expected && !sentWhileTracking, "Every enabled native menu item dispatches once after unblocking")
        state.adjusting = true; controller.reload()
        try check(controller.menu.items.contains { $0.representedObject as? String == "@stop" }, "Adjusting offers Done")
        state.ready = false; controller.reload(); let before = actions
        for index in controller.menu.items.indices where !(controller.menu.items[index].isEnabled) {
            controller.menu.performActionForItem(at: index)
        }
        try check(actions == before, "Unavailable desktop actions never dispatch")
        PinItAnywhereText.apply("zh-TW"); controller.reload()
        try check(controller.menu.items[0].title == PinItAnywhereText.zhTW["menuBar.open"], "Menus follow the host language")
        let menuIntent = PinItAnywhereActivationIntent(process: 111, fromMenu: true, now: 10)
        try check(menuIntent.current(now: 11, foreground: 222, ownProcess: 222), "A menu may activate its own app")
        try check(menuIntent.survivesActivation(222, ownProcess: 222), "Own activation keeps the menu gesture")
        try check(!menuIntent.survivesActivation(333, ownProcess: 222), "Another app revokes the gesture")
        try check(!menuIntent.current(now: 16, foreground: 222, ownProcess: 222), "The menu cannot renew an expired gesture")
        try check(!menuIntent.current(now: 11, foreground: 333, ownProcess: 222), "The menu cannot take focus from a third app")
        let hotkeyIntent = PinItAnywhereActivationIntent(process: 111, now: 10)
        try check(!hotkeyIntent.current(now: 11, foreground: 222, ownProcess: 222), "Global shortcut focus policy is unchanged")
        // A disposable native window verifies both hidden and minimized opening; it never reads product data.
        let window = NSWindow(contentRect: NSRect(x: -10000, y: -10000, width: 240, height: 160),
                              styleMask: [.titled, .miniaturizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        PinItAnywhereTrayMenu.showMain(window); try check(window.isVisible, "Open reveals a hidden main window")
        window.miniaturize(nil)
        PinItAnywhereTrayMenu.showMain(window); try check(!window.isMiniaturized && window.isVisible, "Open restores a minimized main window")
        window.orderOut(nil); window.close()
        print("PASS tray menu: shared order, native actions, readiness, language, focus intent and window restoration")
    }
}
