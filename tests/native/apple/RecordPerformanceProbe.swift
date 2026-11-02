import Foundation
import CryptoKit

// Disposable benchmark profiles use a synthetic key, never the user's Keychain.
enum FleetKeychain {
    static func storageKey(existing: Bool) throws -> SymmetricKey { SymmetricKey(data: Data(repeating: 37, count: 32)) }
}

@main struct RecordPerformanceProbe {
    static func main() throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        var results: [[String: Any]] = []
        for total in [20000, 100000] {
            let directory = root.appendingPathComponent(String(total))
            var database = try FleetDatabase(directory: directory, profile: "local")
            var revision: Int64? = nil
            func row(_ collection: String, _ key: String, _ ordinal: Int64) -> [String: Any] {
                ["collection": collection, "key": key, "entity": "fixture", "ordinal": ordinal,
                 "value": ["text": String(repeating: "x", count: 128), "id": key, "revision": UUID().uuidString.lowercased()]]
            }
            func commit(_ rows: [[String: Any]]) throws -> Int {
                let next = (revision ?? -1) + 1
                let bytes = try FleetProtocol.encode(["format": "work-fleet-record-transaction", "schemaVersion": 1,
                    "profileId": "local", "revision": next, "commitId": FleetProtocol.uuid(), "puts": rows, "deletes": []])
                _ = try database.commitRecords(database.stage("workspace", bytes, FleetProtocol.digest(bytes)), revision, [])
                revision = next
                return bytes.count
            }
            for offset in stride(from: 0, to: 2000, by: 400) {
                _ = try commit((offset..<offset + 400).map { row("current", "c\($0)", (revision ?? -1) + 1) })
            }
            for offset in stride(from: 0, to: total, by: 400) {
                _ = try commit((offset..<min(offset + 400, total)).map { row("history", "r\($0)", (revision ?? -1) + 1) })
            }
            var times: [String: [Double]] = [:], sizes: [String: Int] = [:]
            func measure(_ name: String, _ work: () throws -> Int) throws {
                let start = DispatchTime.now().uptimeNanoseconds
                let size = try work()
                times[name, default: []].append(Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
                sizes[name] = max(sizes[name] ?? 0, size)
            }
            for _ in 0..<14 {
                try measure("openCurrent") {
                    database.close(); database = try FleetDatabase(directory: directory, profile: "local")
                    var after: Any = NSNull(), count = 0, bytes = 0
                    repeat {
                        let data = try database.recordPage(["collection": "current", "entity": "fixture", "limit": 100,
                            "expectedRevision": revision!, "after": after])
                        let page = try FleetProtocol.json(data)
                        bytes += data.count; count += (page["rows"] as! [[String: Any]]).count; after = page["next"]!
                    } while !(after is NSNull)
                    guard count == 2000 else { throw FleetFailure("probe", "Incomplete current read") }
                    return bytes
                }
                try measure("twoRowDraftCommit") {
                    try commit([row("draft", "draft", revision! + 1), row("meta", "active", revision! + 1)])
                }
                try measure("fourRowSaveCommit") {
                    try commit([row("current", "c0", revision! + 1), row("history", FleetProtocol.uuid(), revision! + 1),
                                row("draft", "draft", revision! + 1), row("meta", "active", revision! + 1)])
                }
            }
            var metrics: [String: Any] = [:]
            for (name, series) in times {
                let samples = Array(series.dropFirst(2)).sorted()
                metrics[name] = ["p50ms": samples[samples.count / 2], "p95ms": samples.last!, "maxSerializedBytes": sizes[name]!]
            }
            results.append(["current": 2000, "history": total, "stats": metrics]); database.close()
        }
        let data = try JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted, .sortedKeys])
        print(String(data: data, encoding: .utf8)!)
    }
}
