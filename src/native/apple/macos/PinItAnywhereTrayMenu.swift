import AppKit

/// A menu selection may activate this app as tracking ends; that is still the same user gesture.
/// Activating another app or waiting longer than five seconds never renews its permission to take focus.
struct PinItAnywhereActivationIntent {
    let id = PinItAnywhereProtocol.uuid()
    let process: pid_t
    let fromMenu: Bool
    let created: TimeInterval
    init(process: pid_t, fromMenu: Bool = false, now: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        self.process = process; self.fromMenu = fromMenu; created = now
    }
    func current(now: TimeInterval, foreground: pid_t?, ownProcess: pid_t) -> Bool {
        let age = now - created
        return age >= 0 && age <= 5 && (foreground == process || fromMenu && foreground == ownProcess)
    }
    func survivesActivation(_ process: pid_t?, ownProcess: pid_t) -> Bool { fromMenu && process == ownProcess }
}

/// The same action order and state rules as Windows TrayMenu and Linux tray.entries.
@MainActor final class PinItAnywhereTrayMenu: NSObject, NSMenuDelegate {
    struct State {
        var mainVisible = false, adjusting = false, ready = false, updates = false
        var shortcuts: [[String: String]] = []
    }
    struct Entry {
        let action: String, text: String
        var shortcut: String? = nil
        var enabled = true
        static let separator = Entry(action: "", text: "")
    }
    static func entries(_ state: State) -> [Entry] {
        func key(_ target: String) -> String? { state.shortcuts.first { $0["target"] == target && $0["status"] == "available" }?["key"] }
        var rows = [Entry(action: "show", text: "menuBar.open")]
        if state.mainVisible { rows.append(Entry(action: "@hide", text: "menuBar.hideMain", enabled: state.ready)) }
        rows += [.separator, Entry(action: "@capture", text: "menuBar.quickCapture", shortcut: key("@capture"), enabled: state.ready),
                 Entry(action: "@toggle", text: "menuBar.toggleDesktop", shortcut: key("@toggle"), enabled: state.ready),
                 Entry(action: state.adjusting ? "@stop" : "@all", text: state.adjusting ? "menuBar.finishAdjusting" : "menuBar.adjustAll",
                       shortcut: state.adjusting ? nil : key("@all"), enabled: state.ready), .separator]
        if state.updates { rows += [Entry(action: "update", text: "menuBar.checkUpdates"), .separator] }
        rows.append(Entry(action: "exit", text: "menuBar.quit")); return rows
    }
    let menu = NSMenu()
    private let state: () -> State, invoke: (String) -> Void, active: (Bool) -> Void
    init(state: @escaping () -> State, invoke: @escaping (String) -> Void, active: @escaping (Bool) -> Void) {
        self.state = state; self.invoke = invoke; self.active = active
        super.init(); menu.delegate = self; menu.autoenablesItems = false
    }
    func reload() {
        menu.removeAllItems()
        for row in Self.entries(state()) {
            if row.action.isEmpty { menu.addItem(.separator()); continue }
            let item = NSMenuItem(title: PinItAnywhereText.text(row.text), action: #selector(selected(_:)), keyEquivalent: "")
            item.target = self; item.representedObject = row.action; item.isEnabled = row.enabled
            if let shortcut = row.shortcut { Self.equivalent(shortcut, item: item) }
            if row.action == "exit" { item.keyEquivalent = "q"; item.keyEquivalentModifierMask = .command }
            menu.addItem(item)
        }
    }
    static func showMain(_ window: NSWindow) {
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
    }
    private static func equivalent(_ key: String, item: NSMenuItem) {
        let parts = key.split(separator: "+").map(String.init); guard let last = parts.last else { return }
        var flags: NSEvent.ModifierFlags = []
        for part in parts.dropLast() {
            switch part { case "Ctrl": flags.insert(.control); case "Alt": flags.insert(.option)
            case "Shift": flags.insert(.shift); case "Meta": flags.insert(.command); default: return }
        }
        if last.count == 1 { item.keyEquivalent = last.lowercased() }
        else if last.hasPrefix("F"), let number = Int(last.dropFirst()), (1...24).contains(number),
                let scalar = UnicodeScalar(0xF704 + number - 1) { item.keyEquivalent = String(scalar) }
        item.keyEquivalentModifierMask = flags
    }
    @objc private func selected(_ item: NSMenuItem) {
        guard item.isEnabled, let action = item.representedObject as? String else { return }
        menu.cancelTracking(); active(false); invoke(action)
    }
    func menuWillOpen(_ menu: NSMenu) { active(true) }
    func menuDidClose(_ menu: NSMenu) { active(false) }
}
