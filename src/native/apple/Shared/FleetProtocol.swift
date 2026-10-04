import Foundation
import CryptoKit
import CoreFoundation

struct FleetFailure: Error {
    let code: String
    let message: String
    init(_ code: String, _ message: String) { self.code = code; self.message = message }
}
enum FleetProtocol {
    static let chunk = 256 * 1024, record = 128 * 1024 * 1024, attachment = 25 * 1024 * 1024, backup = 136 * 1024 * 1024 + 4096
    static let safeInteger: Int64 = 9_007_199_254_740_991
    static func require(_ condition: Bool, _ code: String, _ message: String) throws { if !condition { throw FleetFailure(code, message) } }
    static func uuid() -> String { UUID().uuidString.lowercased() }
    static func isUUID(_ value: String) -> Bool { UUID(uuidString: value) != nil && value.count == 36 }
    static func text(_ value: [String: Any], _ key: String, _ maximum: Int = 256) throws -> String {
        guard let text = value[key] as? String, !text.isEmpty, text.utf16.count <= maximum else { throw FleetFailure("invalid-request", "文字欄位無效。") }; return text
    }
    static func number(_ value: [String: Any], _ key: String, _ maximum: Int64 = safeInteger) throws -> Int64 {
        guard let number = value[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { throw FleetFailure("invalid-request", "數字欄位無效。") }
        let result = number.int64Value
        try require(number.doubleValue.isFinite && number.doubleValue == Double(result) && result >= 0 && result <= maximum, "invalid-request", "數字欄位超限。"); return result
    }
    static func bool(_ value: [String: Any], _ key: String) throws -> Bool {
        guard let number = value[key] as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { throw FleetFailure("invalid-request", "布林欄位無效。") }; return number.boolValue
    }
    static func encode(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes]) }
    static func json(_ bytes: Data) throws -> [String: Any] {
        var guardParser = JsonGuard(bytes: Array(bytes)); try guardParser.validate()
        guard let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { throw FleetFailure("invalid-json", "JSON 需要單一物件。") }; return value
    }
    static func digest(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    static func isDigest(_ text: String) -> Bool { text.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil }
    static func isAccount(_ text: String) -> Bool { text.range(of: "^[A-Za-z0-9_-]{1,255}$", options: .regularExpression) != nil }
    private struct JsonGuard {
        let bytes: [UInt8]; var position = 0
        mutating func whitespace() { while position < bytes.count && [9, 10, 13, 32].contains(bytes[position]) { position += 1 } }
        mutating func take(_ byte: UInt8) throws { whitespace(); try FleetProtocol.require(position < bytes.count && bytes[position] == byte, "invalid-json", "JSON 格式無效。"); position += 1 }
        mutating func string() throws -> String {
            whitespace(); let start = position; try take(34)
            while position < bytes.count {
                let byte = bytes[position]; position += 1
                if byte == 34 {
                    guard let value = try JSONSerialization.jsonObject(with: Data(bytes[start..<position]), options: .fragmentsAllowed) as? String else { throw FleetFailure("invalid-json", "JSON 字串無效。") }; return value
                }
                if byte == 92 { try FleetProtocol.require(position < bytes.count, "invalid-json", "JSON 字串未完成。"); position += 1 }
                else { try FleetProtocol.require(byte >= 32, "invalid-json", "JSON 字串含無效字元。") }
            }
            throw FleetFailure("invalid-json", "JSON 字串未完成。")
        }
        mutating func value(_ depth: Int) throws {
            whitespace(); try FleetProtocol.require(depth <= 128 && position < bytes.count, "invalid-json", "JSON 層級或格式無效。")
            switch bytes[position] {
            case 123:
                position += 1; whitespace(); var names = Set<String>()
                if position < bytes.count && bytes[position] == 125 { position += 1; return }
                while true {
                    let name = try string(); try FleetProtocol.require(names.insert(name).inserted, "invalid-json", "JSON 欄位重複。")
                    try take(58); try value(depth + 1); whitespace()
                    if position < bytes.count && bytes[position] == 125 { position += 1; return }; try take(44)
                }
            case 91:
                position += 1; whitespace(); if position < bytes.count && bytes[position] == 93 { position += 1; return }
                while true { try value(depth + 1); whitespace(); if position < bytes.count && bytes[position] == 93 { position += 1; return }; try take(44) }
            case 34: _ = try string()
            default:
                let start = position
                while position < bytes.count && ![9, 10, 13, 32, 44, 93, 125].contains(bytes[position]) { position += 1 }
                try FleetProtocol.require(position > start, "invalid-json", "JSON 值無效。")
                _ = try JSONSerialization.jsonObject(with: Data(bytes[start..<position]), options: .fragmentsAllowed)
            }
        }
        mutating func validate() throws { try value(0); whitespace(); try FleetProtocol.require(position == bytes.count, "invalid-json", "JSON 尾端含額外資料。") }
    }
}
