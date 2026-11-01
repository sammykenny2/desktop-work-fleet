import Foundation
import CryptoKit
import SQLite3

// The production SQLite/encryption code runs with a synthetic key, never the user's Keychain.
enum FleetKeychain {
    static func storageKey(existing: Bool) throws -> SymmetricKey { SymmetricKey(data: Data(repeating: 37, count: 32)) }
}

@main struct RecordStoreProbe {
    static func main() throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        var database = try FleetDatabase(directory: directory, profile: "local")
        func require(_ condition: Bool, _ message: String) throws { if !condition { throw FleetFailure("probe", message) } }
        func row(_ collection: String, _ key: String, _ ordinal: Int, _ text: String) -> [String: Any] {
            ["collection": collection, "key": key, "entity": "card:one", "ordinal": ordinal, "value": ["text": text]]
        }
        func batch(_ revision: Int, _ rows: [[String: Any]]) throws -> Data {
            try FleetProtocol.encode(["format": "work-fleet-record-transaction", "schemaVersion": 1, "profileId": "local",
                "revision": revision, "commitId": FleetProtocol.uuid(), "puts": rows, "deletes": []])
        }
        func commit(_ bytes: Data, _ expected: Int64?) throws -> [String: Any] {
            try database.commitRecords(database.stage("workspace", bytes, FleetProtocol.digest(bytes)), expected, [])
        }
        let initial = try batch(0, [row("current", "one", 0, "saved"), row("history", "r0", 0, "saved")])
        let first = try commit(initial, nil)
        let replayToken = try database.stage("workspace", initial, FleetProtocol.digest(initial))
        try require(database.commitRecords(replayToken, nil, [])["commitId"] as? String == first["commitId"] as? String, "exact replay failed")
        do { _ = try database.staged(replayToken, "workspace"); throw FleetFailure("probe", "replay kept its staged upload") }
        catch let failure as FleetFailure { try require(failure.code == "transfer-missing", "unexpected replay cleanup error") }
        let second = try batch(1, [row("draft", "one", 1, "new local text")])
        _ = try commit(second, 0)
        do { _ = try commit(batch(1, []), 0); throw FleetFailure("probe", "stale commit accepted") }
        catch let failure as FleetFailure { try require(failure.code == "stale-writer", "unexpected stale commit error") }
        do { _ = try commit(batch(2, [row("current", "one", 2, "must roll back"), row("history", "r0", 2, "collision")]), 1); throw FleetFailure("probe", "history overwritten") }
        catch let failure as FleetFailure { try require(failure.code == "revision-collision", "unexpected collision error") }
        let current = try FleetProtocol.json(database.recordEntry("current", "one")!)
        try require((current["value"] as? [String: Any])?["text"] as? String == "saved", "transaction was not rolled back")
        let withAttachment = try batch(2, [row("current", "one", 2, "must roll back with attachment")])
        do { _ = try database.commitRecords(database.stage("workspace", withAttachment, FleetProtocol.digest(withAttachment)), 1, [FleetProtocol.uuid()]); throw FleetFailure("probe", "missing attachment accepted") }
        catch let failure as FleetFailure { try require(failure.code == "transfer-missing", "unexpected attachment error") }
        try require(database.recordEntry("current", "one") == FleetProtocol.encode(current), "attachment failure left partial records")
        let page = try FleetProtocol.json(database.recordPage(["collection": "history", "entity": "card:one", "after": NSNull(), "limit": 1, "expectedRevision": 1]))
        try require((page["rows"] as? [[String: Any]])?.count == 1, "indexed page failed")
        database.close()
        database = try FleetDatabase(directory: directory, profile: "local")
        try require(recordRevision(database) == 1 && database.recordEntry("draft", "one") != nil, "reopen lost committed records")
        try database.reset()
        try require(database.recordStatus() == nil && database.recordEntry("history", "r0") == nil, "reset kept records")
        let legacy = try FleetProtocol.encode(["profileId": "local", "revision": 0, "text": "old data retained"])
        try database.commit("workspace", database.stage("workspace", legacy, FleetProtocol.digest(legacy)), nil, [])
        try require(database.recordStatus()?["format"] as? String == "legacy-workspace", "legacy presence not detected")
        do { _ = try commit(batch(0, []), nil); throw FleetFailure("probe", "legacy profile was converted") }
        catch let failure as FleetFailure { try require(failure.code == "incompatible-local-data", "unexpected legacy error") }
        try require(database.record("workspace") == legacy, "legacy data changed")
        database.close()
        print("PASS record CAS, replay, immutable history, rollback, paging, reopen, reset and legacy preservation")
    }
    static func recordRevision(_ database: FleetDatabase) throws -> Int64? { try database.recordStatus()?["revision"] as? Int64 }
}
