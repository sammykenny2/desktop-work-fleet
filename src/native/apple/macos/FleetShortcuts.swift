import AppKit
import Carbon

@MainActor final class FleetShortcuts {
    private var handler: EventHandlerRef?
    private var active: [UInt32: (EventHotKeyRef, String)] = [:]
    private var nextID: UInt32 = 0
    private var bindings: [(key: String, target: String)] = []
    private(set) var registrations: [[String: String]] = []
    var blocked = false { didSet { if blocked != oldValue { refresh() } } }
    var action: ((String) -> Void)?, changed: (([[String: String]]) -> Void)?
    init() {
        var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            var id = EventHotKeyID(); let result = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
            if result == noErr {
                let owner = Unmanaged<FleetShortcuts>.fromOpaque(context).takeUnretainedValue()
                let captured = id.id
                Task { @MainActor in if let entry = owner.active[captured], !owner.suspended { owner.action?(entry.1) } }
            }
            return result
        }, 1, &type, Unmanaged.passUnretained(self).toOpaque(), &handler)
    }
    var suspended: Bool { Self.suspends(blocked: blocked, active: NSApplication.shared.isActive, keyWindow: NSApplication.shared.keyWindow != nil) }
    /// A focused Work Fleet window handles shortcuts itself, so registrations are released only while one has the keyboard.
    /// A minimized or menu-bar-only main window leaves the app active with no key window, and nothing else would see the keys.
    nonisolated static func suspends(blocked: Bool, active: Bool, keyWindow: Bool) -> Bool { blocked || active && keyWindow }
    func configure(_ args: [String: Any]) throws -> Any {
        guard let values = args["bindings"] as? [[String: Any]], values.count <= 32 else { throw FleetFailure("shortcut-settings", "This device can have up to 32 shortcuts.") }
        var next: [(String, String)] = [], keys = Set<String>()
        for value in values {
            let key = try FleetProtocol.text(value, "key", 80), target = try FleetProtocol.text(value, "target", 128)
            try FleetProtocol.require(keys.insert(key).inserted && target.range(of: "^(?:@(?:all|capture|toggle)|[A-Za-z0-9][A-Za-z0-9._:-]{0,127})$", options: .regularExpression) != nil && !["__proto__", "constructor", "prototype"].contains(target), "shortcut-settings", "A shortcut target isn't valid.")
            next.append((key, target))
        }
        bindings = next; refresh(); return ["registrations": registrations]
    }
    func refresh() {
        clear(); var result: [[String: String]] = []
        for binding in bindings {
            let parsed = Self.parse(binding.key); var status = parsed.status
            if status == "available" {
                if suspended { status = "suspended" }
                else if handler == nil { status = "unavailable" }
                else {
                    nextID &+= 1; var reference: EventHotKeyRef?
                    let code = RegisterEventHotKey(parsed.key, parsed.modifiers, EventHotKeyID(signature: 0x57464C54, id: nextID), GetApplicationEventTarget(), 0, &reference)
                    if code == noErr, let reference { active[nextID] = (reference, binding.target) }
                    else { status = code == OSStatus(eventHotKeyExistsErr) ? "conflict" : "unavailable" }
                }
            }
            result.append(["key": binding.key, "target": binding.target, "status": status])
        }
        registrations = result; changed?(result)
    }
    private static func parse(_ text: String) -> (key: UInt32, modifiers: UInt32, status: String) {
        let parts = text.split(separator: "+").map(String.init), order = ["Ctrl", "Alt", "Shift", "Meta"]
        guard parts.count >= 2 && parts.count <= 5, let name = parts.last else { return (0, 0, "invalid") }
        var modifiers: UInt32 = 0, previous = -1
        for part in parts.dropLast() {
            guard let index = order.firstIndex(of: part), index > previous else { return (0, 0, "invalid") }; previous = index
            modifiers |= [UInt32(controlKey), UInt32(optionKey), UInt32(shiftKey), UInt32(cmdKey)][index]
        }
        guard modifiers & UInt32(controlKey | optionKey | cmdKey) != 0 else { return (0, 0, "invalid") }
        let names = ["A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6, "X": 7, "C": 8, "V": 9, "B": 11, "Q": 12, "W": 13, "E": 14, "R": 15, "Y": 16, "T": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29, "O": 31, "U": 32, "I": 34, "P": 35, "L": 37, "J": 38, "K": 40, "N": 45, "M": 46, "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97, "F7": 98, "F8": 100, "F9": 101, "F10": 109, "F11": 103, "F12": 111, "F13": 105, "F14": 107, "F15": 113, "F16": 106, "F17": 64, "F18": 79, "F19": 80, "F20": 90]
        guard let key = names[name] else { return (0, modifiers, "invalid") }
        if modifiers & UInt32(cmdKey) != 0 && ["Q", "W", "H", "M", " "].contains(name) { return (UInt32(key), modifiers, "reserved") }
        if modifiers & UInt32(cmdKey | controlKey) != 0 && modifiers & UInt32(optionKey) == 0 && ["A", "C", "X", "V", "Z", "Y"].contains(name) { return (UInt32(key), modifiers, "editing") }
        return (UInt32(key), modifiers, "available")
    }
    private func clear() { for entry in active.values { UnregisterEventHotKey(entry.0) }; active.removeAll() }
    func close() { clear(); if let handler { RemoveEventHandler(handler) }; handler = nil; action = nil; changed = nil }
}
