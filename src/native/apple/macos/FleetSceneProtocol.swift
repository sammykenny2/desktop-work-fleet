import AppKit
import CoreFoundation

struct FleetSceneFrame {
    struct Card { let id: String, layer: String, rect: NSRect, interactive: Bool, draggable: Bool }
    let sequence: Int64, topology: Int64, cards: [Card]
    /// A stage notice only keeps the topmost scene on screen; it never becomes an input region.
    var notice: NSRect? = nil
    static func rect(_ object: Any?) throws -> NSRect {
        guard let object = object as? [String: Any] else { throw FleetFailure("scene-frame", "桌面位置無效。") }
        func number(_ key: String) throws -> Double {
            guard let value = object[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite else { throw FleetFailure("scene-frame", "桌面位置無效。") }; return value.doubleValue
        }
        let result = try NSRect(x: number("x"), y: number("y"), width: number("width"), height: number("height"))
        try FleetProtocol.require(result.width > 0 && result.height > 0, "scene-frame", "桌面尺寸無效。"); return result
    }
    static func parse(_ data: Data, session: String, previous: Int64) throws -> FleetSceneFrame {
        let value = try FleetProtocol.json(data)
        try fields(value, "protocol sessionId sequence topology workspaceRevision layoutRevision groups operationScope activeGroupId cards editor dropTarget fallbacks notice")
        try FleetProtocol.require(FleetProtocol.number(value, "protocol", 1) == 1 && FleetProtocol.text(value, "sessionId") == session, "scene-session", "桌面畫面屬於舊工作階段。")
        let sequence = try FleetProtocol.number(value, "sequence"), topology = try FleetProtocol.number(value, "topology")
        try FleetProtocol.require(sequence > previous, "scene-order", "桌面畫面已過期。")
        _ = try FleetProtocol.number(value, "workspaceRevision"); _ = try FleetProtocol.number(value, "layoutRevision")
        guard let groups = value["groups"] as? [[String: Any]], let cards = value["cards"] as? [[String: Any]], groups.count <= 20000, cards.count <= 20000 else { throw FleetFailure("scene-frame", "桌面畫面容量無效。") }
        for group in groups {
            try fields(group, "id name color region"); _ = try FleetProtocol.text(group, "id", 128); _ = try FleetProtocol.text(group, "name", FleetProtocol.record); try color(group)
            if !(group["region"] is NSNull) { _ = try rect(group["region"]) }
        }
        var ids = Set<String>(); var output: [Card] = []
        for card in cards {
            try fields(card, "id groupId revision summary text format attachmentCount rect layer interactive draggable editing selected completed mine color")
            let id = try FleetProtocol.text(card, "id", 128), layer = try FleetProtocol.text(card, "layer")
            try FleetProtocol.require(ids.insert(id).inserted && ["desktop", "floating", "wallpaper"].contains(layer), "scene-frame", "桌面卡片身分或層級無效。")
            _ = try FleetProtocol.text(card, "groupId", 128); try color(card)
            guard let text = card["text"] as? String, text.utf16.count <= 8 * 1024 * 1024 else { throw FleetFailure("scene-frame", "桌面文字容量無效。") }
            for flag in ["interactive", "draggable", "editing", "selected", "completed", "mine"] { _ = try FleetProtocol.bool(card, flag) }
            if layer == "wallpaper" {
                try FleetProtocol.require(!FleetProtocol.bool(card, "interactive") && !FleetProtocol.bool(card, "draggable") && !FleetProtocol.bool(card, "editing"), "scene-frame", "桌布層必須保持滑鼠穿透。")
            }
            output.append(try Card(id: id, layer: layer, rect: rect(card["rect"]), interactive: FleetProtocol.bool(card, "interactive"), draggable: FleetProtocol.bool(card, "draggable")))
        }
        var notice: NSRect? = nil
        if let raw = value["notice"], !(raw is NSNull) {
            guard let object = raw as? [String: Any] else { throw FleetFailure("scene-frame", "桌面提示格式無效。") }
            try fields(object, "id rect title text step steps")
            _ = try FleetProtocol.number(object, "id"); _ = try FleetProtocol.number(object, "step"); _ = try FleetProtocol.number(object, "steps")
            _ = try FleetProtocol.text(object, "title", 200); _ = try FleetProtocol.text(object, "text", 200)
            notice = try rect(object["rect"])
        }
        return FleetSceneFrame(sequence: sequence, topology: topology, cards: output, notice: notice)
    }
    private static func fields(_ object: [String: Any], _ allowed: String) throws {
        let fields = Set(allowed.split(separator: " ").map(String.init)); try FleetProtocol.require(object.keys.allSatisfy(fields.contains), "scene-frame", "桌面畫面含非呈現資料。")
    }
    private static func color(_ object: [String: Any]) throws {
        let value = try FleetProtocol.text(object, "color"); try FleetProtocol.require(value.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil, "scene-frame", "桌面色彩無效。")
    }
}

@MainActor final class FleetSceneTransfers {
    private struct Entry { let owner: String, allocation: String, size: Int, digest: String, frame: Bool; var bytes: Data, sealed = false, retained = false, used = Date() }
    private var entries: [String: Entry] = [:]
    func begin(_ owner: String, _ args: [String: Any], maximum: Int) throws -> Any {
        for (id, value) in entries where !value.retained && Date().timeIntervalSince(value.used) > 300 { entries.removeValue(forKey: id) }
        let size = Int(try FleetProtocol.number(args, "size", Int64(maximum))), digest = try FleetProtocol.text(args, "sha256")
        let frame = maximum == FleetProtocol.record
        var allocations = Set<String>(); var total = 0, lane = 0
        for entry in entries.values where allocations.insert(entry.allocation).inserted { total += entry.size; if entry.frame == frame { lane += entry.size } }
        try FleetProtocol.require(size > 0 && FleetProtocol.isDigest(digest), "scene-size", "桌面傳輸容量或校驗值無效。")
        try FleetProtocol.require(entries.count < 192 && total + size <= 384 * 1024 * 1024 && lane + size <= (frame ? 320 : 64) * 1024 * 1024, "scene-busy", "桌面畫面仍在傳輸，請稍後重試。")
        let id = FleetProtocol.uuid(); entries[id] = Entry(owner: owner, allocation: id, size: size, digest: digest, frame: frame, bytes: Data()); return ["token": id]
    }
    private func entry(_ owner: String, _ token: String) throws -> Entry {
        guard var entry = entries[token], entry.owner == owner else { throw FleetFailure("scene-missing", "桌面傳輸不屬於此視窗或已失效。") }; entry.used = Date(); entries[token] = entry; return entry
    }
    func append(_ owner: String, _ args: [String: Any]) throws -> Any {
        let token = try FleetProtocol.text(args, "token"); var value = try entry(owner, token)
        guard let bytes = Data(base64Encoded: try FleetProtocol.text(args, "base64", FleetProtocol.chunk * 4 / 3 + 4)) else { throw FleetFailure("scene-size", "桌面分片無效。") }
        try FleetProtocol.require(!value.sealed && FleetProtocol.number(args, "offset", Int64(value.size)) == value.bytes.count && bytes.count > 0 && bytes.count <= FleetProtocol.chunk && value.bytes.count + bytes.count <= value.size, "scene-offset", "桌面傳輸順序或容量不符。")
        value.bytes.append(bytes); entries[token] = value; return ["offset": value.bytes.count]
    }
    func seal(_ owner: String, _ token: String) throws -> Data {
        var value = try entry(owner, token)
        try FleetProtocol.require(value.bytes.count == value.size && (value.sealed || FleetProtocol.digest(value.bytes) == value.digest), "scene-integrity", "桌面传輸不完整或校驗失敗。")
        value.sealed = true; entries[token] = value; return value.bytes
    }
    func retain(_ owner: String, _ token: String) throws { var value = try entry(owner, token); value.retained = true; entries[token] = value }
    func lease(_ owner: String, _ token: String, _ reader: String) throws -> [String: Any] {
        let value = try entry(owner, token); try FleetProtocol.require(value.sealed && entries.count < 192, "scene-busy", "桌面畫面尚未可讀。")
        let id = FleetProtocol.uuid(); entries[id] = Entry(owner: reader, allocation: value.allocation, size: value.size, digest: value.digest, frame: value.frame, bytes: value.bytes, sealed: true)
        return ["token": id, "size": value.size, "sha256": value.digest]
    }
    func read(_ owner: String, _ token: String, _ args: [String: Any]) throws -> Any {
        let value = try entry(owner, token), offset = Int(try FleetProtocol.number(args, "offset", Int64(value.size)))
        try FleetProtocol.require(value.sealed, "scene-incomplete", "桌面傳輸尚未完整。")
        let end = min(value.size, offset + FleetProtocol.chunk); return ["offset": offset, "base64": value.bytes.subdata(in: offset..<end).base64EncodedString(), "done": end == value.size]
    }
    func drop(_ owner: String, _ token: String) { if entries[token]?.owner == owner { entries.removeValue(forKey: token) } }
    func dropOwner(_ owner: String) { for (id, value) in entries where value.owner == owner { entries.removeValue(forKey: id) } }
    func close() { entries.removeAll() }
}
