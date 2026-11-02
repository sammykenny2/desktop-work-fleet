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
        let second = try batch(1, [row("draft", "one", 1, "new local text"), row("history", "r1", 1, "second")])
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
        let ascending = try FleetProtocol.json(database.recordPage(["collection": "history", "entity": "card:one", "order": "asc", "limit": 1, "expectedRevision": 1]))
        try require((ascending["rows"] as? [[String: Any]])?.first?["key"] as? String == "r0", "oldest pending page failed")
        let following = try FleetProtocol.json(database.recordPage(["collection": "history", "entity": "card:one", "order": "asc", "after": ascending["next"]!, "limit": 1, "expectedRevision": 1]))
        try require((following["rows"] as? [[String: Any]])?.first?["key"] as? String == "r1", "ascending continuation failed")
        let keys = try FleetProtocol.json(database.recordPage(["collection": "history", "keysOnly": true, "expectedRevision": 1]))
        try require((keys["rows"] as? [[String: Any]])?.allSatisfy { Set($0.keys) == ["collection", "key", "ordinal"] } == true, "metadata paging returned values")
        database.close()
        database = try FleetDatabase(directory: directory, profile: "local")
        try require(recordRevision(database) == 1 && database.recordEntry("draft", "one") != nil, "reopen lost committed records")
        let attachmentBytes = Data("delete only with receipt".utf8), attachmentID = FleetProtocol.digest(attachmentBytes)
        _ = try database.putAttachment(database.stage("attachment", attachmentBytes, attachmentID))
        var deletion = try FleetProtocol.json(batch(2, [])); deletion["attachmentDeletes"] = [attachmentID]
        let deletionBytes = try FleetProtocol.encode(deletion)
        _ = try commit(deletionBytes, 1)
        try require(database.attachment(attachmentID) == nil, "attachment delete failed")
        _ = try database.commitRecords(database.stage("workspace", deletionBytes, FleetProtocol.digest(deletionBytes)), 1,
            [database.stage("attachment", attachmentBytes, attachmentID)])
        try require(database.attachment(attachmentID) == nil, "exact replay applied extra attachment bytes")
        try database.reset()
        try require(database.recordStatus() == nil && database.recordEntry("history", "r0") == nil, "reset kept records")
        let leadingBOM = "\u{FEFF}hello\u{FEFF}"
        for text in ["", "\u{0301}hello", "\u{FEFF}\u{FEFF}hello", "\u{0000}hello", "e\u{0301}"] {
            let decoded = try FleetProtocol.json(FleetProtocol.encode(["text": text]))["text"] as? String
            try require(decoded.map { Array($0.utf8) } == Array(text.utf8), "JSON changed Unicode scalars")
        }
        for source in ["{\"text\":\"\\uFEFFhello\\uFEFF\"}", "{\"text\":\"" + leadingBOM + "\"}"] {
            let decoded = try FleetProtocol.json(Data(source.utf8))["text"] as? String
            try require(decoded.map { Array($0.utf8) } == Array(leadingBOM.utf8), "JSON changed literal or escaped U+FEFF")
        }
        let unicode = try batch(0, [row("current", "bom", 0, leadingBOM), row("history", "bom", 0, leadingBOM)])
        _ = try commit(unicode, nil)
        database.close(); database = try FleetDatabase(directory: directory, profile: "local")
        for collection in ["current", "history"] {
            let saved = try FleetProtocol.json(database.recordEntry(collection, "bom")!)
            try require(((saved["value"] as? [String: Any])?["text"] as? String).map { Array($0.utf8) } == Array(leadingBOM.utf8), "SQLite changed U+FEFF")
        }
        _ = try commit(batch(1, [row("history", "bom", 1, leadingBOM)]), 0)
        try database.reset()
        let legacy = try FleetProtocol.encode(["profileId": "local", "revision": 0, "text": "old data retained"])
        try database.commit("workspace", database.stage("workspace", legacy, FleetProtocol.digest(legacy)), nil, [])
        try require(database.recordStatus()?["format"] as? String == "legacy-workspace", "legacy presence not detected")
        do { _ = try commit(batch(0, []), nil); throw FleetFailure("probe", "legacy profile was converted") }
        catch let failure as FleetFailure { try require(failure.code == "incompatible-local-data", "unexpected legacy error") }
        try require(database.record("workspace") == legacy, "legacy data changed")
        var sabotage: OpaquePointer?
        try require(sqlite3_open(directory.appendingPathComponent("fleet.sqlite3").path, &sabotage) == SQLITE_OK, "cannot open isolated fault connection")
        try require(sqlite3_exec(sabotage, "DROP TABLE record_heads; DROP TABLE record_entries;", nil, nil, nil) == SQLITE_OK, "cannot inject read failure")
        sqlite3_close(sabotage)
        let reads: [() throws -> Void] = [{ _ = try database.recordStatus() }, { _ = try database.recordEntry("current", "one") },
            { _ = try database.recordPage(["collection": "current", "expectedRevision": NSNull()]) }]
        for read in reads {
            do { try read(); throw FleetFailure("probe", "read failure was accepted") }
            catch let failure as FleetFailure { try require(failure.code == "data-unreadable", "record read omitted recovery classification") }
        }
        database.close()
        print("PASS record CAS, replay, immutable history, rollback, paging, reopen, reset and legacy preservation")
    }
    static func recordRevision(_ database: FleetDatabase) throws -> Int64? { try database.recordStatus()?["revision"] as? Int64 }
}
