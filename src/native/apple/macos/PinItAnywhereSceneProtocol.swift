import AppKit
import CoreFoundation

struct PinItAnywhereSceneFrame {
    struct Card { let id: String, layer: String, rect: NSRect, interactive: Bool, draggable: Bool }
    let sequence: Int64, topology: Int64, cards: [Card]
    /// A stage notice only keeps the topmost scene on screen; it never becomes an input region.
    var notice: NSRect? = nil
    /// While adjusting, the topmost scene is the modal adjust overlay.
    var adjusting = false
    /// The view showing the in-place editor, if any: a quick edit hands the keyboard back when it leaves.
    var editorView: String? = nil
    static func rect(_ object: Any?) throws -> NSRect {
        guard let object = object as? [String: Any] else { throw PinItAnywhereFailure("scene-frame", "The desktop position isn't valid.") }
        func number(_ key: String) throws -> Double {
            guard let value = object[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite else { throw PinItAnywhereFailure("scene-frame", "The desktop position isn't valid.") }; return value.doubleValue
        }
        let result = try NSRect(x: number("x"), y: number("y"), width: number("width"), height: number("height"))
        try PinItAnywhereProtocol.require(result.width > 0 && result.height > 0, "scene-frame", "The desktop size isn't valid."); return result
    }
    static func parse(_ data: Data, session: String, previous: Int64) throws -> PinItAnywhereSceneFrame {
        let value = try PinItAnywhereProtocol.json(data)
        try fields(value, "protocol sessionId sequence topology locale workspaceRevision layoutRevision groups operationScope activeGroupId cards editor dropTarget fallbacks notice quickMove")
        // The key that starts a quick move in the scene; the host only relays it.
        if let raw = value["quickMove"], !(raw is NSNull) { try PinItAnywhereProtocol.require(["meta", "ctrl"].contains(raw as? String ?? ""), "scene-frame", "The desktop quick move key isn't valid.") }
        try PinItAnywhereProtocol.require(PinItAnywhereProtocol.number(value, "protocol", 1) == 1 && PinItAnywhereProtocol.text(value, "sessionId") == session, "scene-session", "The desktop frame belongs to an earlier session.")
        let sequence = try PinItAnywhereProtocol.number(value, "sequence"), topology = try PinItAnywhereProtocol.number(value, "topology")
        try PinItAnywhereProtocol.require(sequence > previous, "scene-order", "The desktop frame is out of date.")
        _ = try PinItAnywhereProtocol.number(value, "workspaceRevision"); _ = try PinItAnywhereProtocol.number(value, "layoutRevision")
        // The owner's UI locale, which each scene applies before drawing; the host only relays it.
        if let raw = value["locale"], !(raw is NSNull) { _ = try PinItAnywhereProtocol.text(value, "locale", 16) }
        guard let scope = value["operationScope"] as? [String: Any] else { throw PinItAnywhereFailure("scene-frame", "The desktop adjust scope isn't valid.") }
        try fields(scope, "kind groupId"); let kind = try PinItAnywhereProtocol.text(scope, "kind")
        try PinItAnywhereProtocol.require(["none", "group", "all"].contains(kind), "scene-frame", "The desktop adjust scope isn't valid.")
        guard let groups = value["groups"] as? [[String: Any]], let cards = value["cards"] as? [[String: Any]], groups.count <= 20000, cards.count <= 20000 else { throw PinItAnywhereFailure("scene-frame", "The desktop frame is too large.") }
        for group in groups {
            try fields(group, "id name color region"); _ = try PinItAnywhereProtocol.text(group, "id", 128); _ = try PinItAnywhereProtocol.text(group, "name", PinItAnywhereProtocol.record); try color(group)
            if !(group["region"] is NSNull) { _ = try rect(group["region"]) }
        }
        var ids = Set<String>(); var output: [Card] = []
        for card in cards {
            try fields(card, "id groupId revision summary text format attachmentCount attachments rect layer interactive draggable editing selected completed mine color opacity unsaved blank")
            if let raw = card["attachments"] {
                guard let files = raw as? [[String: Any]], files.count <= 20000 else { throw PinItAnywhereFailure("scene-frame", "The attachment list isn't valid.") }
                for file in files { try fields(file, "id name"); _ = try PinItAnywhereProtocol.text(file, "id", 128); _ = try PinItAnywhereProtocol.text(file, "name", PinItAnywhereProtocol.record) }
            }
            let id = try PinItAnywhereProtocol.text(card, "id", 128), layer = try PinItAnywhereProtocol.text(card, "layer")
            try PinItAnywhereProtocol.require(ids.insert(id).inserted && ["desktop", "floating", "wallpaper"].contains(layer), "scene-frame", "A desktop note ID or layer isn't valid.")
            _ = try PinItAnywhereProtocol.text(card, "groupId", 128); try color(card)
            // A paper resting on the Top layer may be see-through from 30%; every other paper is opaque.
            if let raw = card["opacity"] {
                guard let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue >= 0.3, number.doubleValue <= 1,
                      layer == "floating" || number.doubleValue == 1 else { throw PinItAnywhereFailure("scene-frame", "A desktop note's opacity isn't valid.") }
            }
            guard let text = card["text"] as? String, text.utf16.count <= 8 * 1024 * 1024 else { throw PinItAnywhereFailure("scene-frame", "The desktop note text is too large.") }
            for flag in ["interactive", "draggable", "editing", "selected", "completed", "mine"] { _ = try PinItAnywhereProtocol.bool(card, flag) }
            // A paper showing unsaved changes carries a dot (ADR-061); frames from before it leave the flag out.
            if card["unsaved"] != nil { _ = try PinItAnywhereProtocol.bool(card, "unsaved") }
            if card["blank"] != nil { _ = try PinItAnywhereProtocol.bool(card, "blank") }
            if layer == "wallpaper" {
                try PinItAnywhereProtocol.require(!PinItAnywhereProtocol.bool(card, "interactive") && !PinItAnywhereProtocol.bool(card, "draggable") && !PinItAnywhereProtocol.bool(card, "editing"), "scene-frame", "Notes on the wallpaper layer must let clicks through.")
            }
            output.append(try Card(id: id, layer: layer, rect: rect(card["rect"]), interactive: PinItAnywhereProtocol.bool(card, "interactive"), draggable: PinItAnywhereProtocol.bool(card, "draggable")))
        }
        var notice: NSRect? = nil
        if let raw = value["notice"], !(raw is NSNull) {
            guard let object = raw as? [String: Any] else { throw PinItAnywhereFailure("scene-frame", "The desktop notice isn't valid.") }
            try fields(object, "id rect title text step steps")
            _ = try PinItAnywhereProtocol.number(object, "id"); _ = try PinItAnywhereProtocol.number(object, "step"); _ = try PinItAnywhereProtocol.number(object, "steps")
            _ = try PinItAnywhereProtocol.text(object, "title", 200); _ = try PinItAnywhereProtocol.text(object, "text", 200)
            notice = try rect(object["rect"])
        }
        let editorView = (value["editor"] as? [String: Any])?["viewId"] as? String
        return PinItAnywhereSceneFrame(sequence: sequence, topology: topology, cards: output, notice: notice, adjusting: kind != "none", editorView: editorView)
    }
    private static func fields(_ object: [String: Any], _ allowed: String) throws {
        let fields = Set(allowed.split(separator: " ").map(String.init)); try PinItAnywhereProtocol.require(object.keys.allSatisfy(fields.contains), "scene-frame", "The desktop frame contains data that isn't for display.")
    }
    private static func color(_ object: [String: Any]) throws {
        let value = try PinItAnywhereProtocol.text(object, "color"); try PinItAnywhereProtocol.require(value.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil, "scene-frame", "The desktop color isn't valid.")
    }
}

@MainActor final class PinItAnywhereSceneTransfers {
    private struct Entry { let owner: String, allocation: String, size: Int, digest: String, frame: Bool; var bytes: Data, sealed = false, retained = false, used = Date() }
    private var entries: [String: Entry] = [:]
    func begin(_ owner: String, _ args: [String: Any], maximum: Int) throws -> Any {
        for (id, value) in entries where !value.retained && Date().timeIntervalSince(value.used) > 300 { entries.removeValue(forKey: id) }
        let size = Int(try PinItAnywhereProtocol.number(args, "size", Int64(maximum))), digest = try PinItAnywhereProtocol.text(args, "sha256")
        let frame = maximum == PinItAnywhereProtocol.record
        var allocations = Set<String>(); var total = 0, lane = 0
        for entry in entries.values where allocations.insert(entry.allocation).inserted { total += entry.size; if entry.frame == frame { lane += entry.size } }
        try PinItAnywhereProtocol.require(size > 0 && PinItAnywhereProtocol.isDigest(digest), "scene-size", "The desktop transfer size or checksum isn't valid.")
        try PinItAnywhereProtocol.require(entries.count < 192 && total + size <= 384 * 1024 * 1024 && lane + size <= (frame ? 320 : 64) * 1024 * 1024, "scene-busy", "A desktop frame is still transferring. Try again in a moment.")
        let id = PinItAnywhereProtocol.uuid(); entries[id] = Entry(owner: owner, allocation: id, size: size, digest: digest, frame: frame, bytes: Data()); return ["token": id]
    }
    private func entry(_ owner: String, _ token: String) throws -> Entry {
        guard var entry = entries[token], entry.owner == owner else { throw PinItAnywhereFailure("scene-missing", "The desktop transfer belongs to another window or has expired.") }; entry.used = Date(); entries[token] = entry; return entry
    }
    func append(_ owner: String, _ args: [String: Any]) throws -> Any {
        let token = try PinItAnywhereProtocol.text(args, "token"); var value = try entry(owner, token)
        guard let bytes = Data(base64Encoded: try PinItAnywhereProtocol.text(args, "base64", PinItAnywhereProtocol.chunk * 4 / 3 + 4)) else { throw PinItAnywhereFailure("scene-size", "The desktop transfer chunk isn't valid.") }
        try PinItAnywhereProtocol.require(!value.sealed && PinItAnywhereProtocol.number(args, "offset", Int64(value.size)) == value.bytes.count && bytes.count > 0 && bytes.count <= PinItAnywhereProtocol.chunk && value.bytes.count + bytes.count <= value.size, "scene-offset", "The desktop transfer order or size doesn't match.")
        value.bytes.append(bytes); entries[token] = value; return ["offset": value.bytes.count]
    }
    func seal(_ owner: String, _ token: String) throws -> Data {
        var value = try entry(owner, token)
        try PinItAnywhereProtocol.require(value.bytes.count == value.size && (value.sealed || PinItAnywhereProtocol.digest(value.bytes) == value.digest), "scene-integrity", "The desktop transfer is incomplete or failed its checksum.")
        value.sealed = true; entries[token] = value; return value.bytes
    }
    func retain(_ owner: String, _ token: String) throws { var value = try entry(owner, token); value.retained = true; entries[token] = value }
    func lease(_ owner: String, _ token: String, _ reader: String) throws -> [String: Any] {
        let value = try entry(owner, token); try PinItAnywhereProtocol.require(value.sealed && entries.count < 192, "scene-busy", "The desktop frame isn't ready to read.")
        let id = PinItAnywhereProtocol.uuid(); entries[id] = Entry(owner: reader, allocation: value.allocation, size: value.size, digest: value.digest, frame: value.frame, bytes: value.bytes, sealed: true)
        return ["token": id, "size": value.size, "sha256": value.digest]
    }
    func read(_ owner: String, _ token: String, _ args: [String: Any]) throws -> Any {
        let value = try entry(owner, token), offset = Int(try PinItAnywhereProtocol.number(args, "offset", Int64(value.size)))
        try PinItAnywhereProtocol.require(value.sealed, "scene-incomplete", "The desktop transfer isn't complete.")
        let end = min(value.size, offset + PinItAnywhereProtocol.chunk); return ["offset": offset, "base64": value.bytes.subdata(in: offset..<end).base64EncodedString(), "done": end == value.size]
    }
    func drop(_ owner: String, _ token: String) { if entries[token]?.owner == owner { entries.removeValue(forKey: token) } }
    func dropOwner(_ owner: String) { for (id, value) in entries where value.owner == owner { entries.removeValue(forKey: id) } }
    func close() { entries.removeAll() }
}
