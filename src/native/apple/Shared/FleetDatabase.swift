import Foundation
import SQLite3
import CryptoKit
import Darwin

final class FleetDatabase {
    private var database: OpaquePointer?
    private var owner: Int32 = -1
    private let lock = NSRecursiveLock()
    private let key: SymmetricKey
    private var closed = false
    let profile: String
    let directory: URL
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    init(directory: URL, profile: String) throws {
        self.directory = directory; self.profile = profile
        try FleetProtocol.require(profile == "local" || profile.hasPrefix("google:") && FleetProtocol.isAccount(String(profile.dropFirst(7))), "invalid-profile", "The workspace ID isn't valid.")
        // SPEC-006 DO: a failure to open the data names its cause, which the start-up alert and the page explain.
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        catch let error as CocoaError where error.code == .fileWriteOutOfSpace { throw FleetDatabase.failure("data-full") }
        catch let error as CocoaError where error.code == .fileWriteNoPermission || error.code == .fileReadNoPermission { throw FleetDatabase.failure("data-denied") }
        let data = directory.appendingPathComponent("fleet.sqlite3")
        let descriptor = Darwin.open(directory.appendingPathComponent("owner.lock").path, O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0o600)
        // A lock file that can't be created says why; only a held lock means another window has the workspace.
        guard descriptor >= 0 else {
            switch errno {
            case ENOSPC: throw FleetDatabase.failure("data-full")
            case EACCES, EPERM, EROFS: throw FleetDatabase.failure("data-denied")
            default: throw FleetDatabase.failure("data-unreadable")
            }
        }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { Darwin.close(descriptor); throw FleetFailure("native-already-open", "This workspace is already open in another Work Fleet window.") }
        do { key = try FleetKeychain.storageKey(existing: FileManager.default.fileExists(atPath: data.path)) }
        catch { Darwin.close(descriptor); throw error }
        owner = descriptor
        do {
            try FleetProtocol.require(sqlite3_open_v2(data.path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, "native-storage", "Couldn't open the local database.")
            sqlite3_busy_timeout(database, 5000)
            try execute("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;")
            let version = try scalar("PRAGMA user_version;") as? Int64 ?? 0
            try FleetProtocol.require(version == 0 || version == 1, "storage-version", "This data uses a newer format. Update Work Fleet.")
            try execute("CREATE TABLE IF NOT EXISTS records(profile TEXT,kind TEXT,revision INTEGER,data BLOB,PRIMARY KEY(profile,kind));")
            try execute("CREATE TABLE IF NOT EXISTS attachments(profile TEXT,id TEXT,data BLOB,PRIMARY KEY(profile,id));")
            try execute("CREATE TABLE IF NOT EXISTS staging(profile TEXT,token TEXT PRIMARY KEY,kind TEXT,digest TEXT,size INTEGER,data BLOB);")
            try execute("CREATE TABLE IF NOT EXISTS secrets(profile TEXT,kind TEXT,id TEXT,data BLOB,PRIMARY KEY(profile,kind,id));")
            try initializeRecords()
            try execute("DELETE FROM staging; PRAGMA user_version=1;")
        } catch { let named = FleetDatabase.classified(database, error); sqlite3_close(database); database = nil; Darwin.close(owner); owner = -1; throw named }
    }
    static let databaseFiles = ["fleet.sqlite3", "fleet.sqlite3-wal", "fleet.sqlite3-shm", "fleet.sqlite3-journal"]
    private static let messages = ["data-damaged": "The local data is damaged and can't be opened.",
        "data-full": "The disk is full, so the local data can't be opened. Free some space and open Work Fleet again.",
        "data-in-use": "Another program is using the local data. Close it and open Work Fleet again.",
        "data-denied": "Work Fleet isn't allowed to open its local data folder.", "data-unreadable": "The local data can't be opened."]
    static func failure(_ cause: String) -> FleetFailure { FleetFailure(cause, messages[cause] ?? "The local data can't be opened.") }
    /// Names a generic open failure from SQLite's last result code; every other failure keeps its own code and message.
    private static func classified(_ database: OpaquePointer?, _ error: Error) -> Error {
        guard let failure = error as? FleetFailure, failure.code == "native-storage" else { return error }
        let code = database.map { sqlite3_errcode($0) } ?? SQLITE_CANTOPEN
        switch code & 0xff {
        case SQLITE_CORRUPT, SQLITE_NOTADB: return Self.failure("data-damaged")
        case SQLITE_FULL: return Self.failure("data-full")
        case SQLITE_BUSY, SQLITE_LOCKED: return Self.failure("data-in-use")
        case SQLITE_PERM, SQLITE_READONLY, SQLITE_CANTOPEN, SQLITE_AUTH: return Self.failure("data-denied")
        default: return Self.failure("data-unreadable")
        }
    }
    /// Starting with empty data helps only data shown to be damaged: never a full disk, held files, a closed folder or a
    /// cause SQLite didn't name, which could be healthy data from a newer version.
    static func canSetAside(_ cause: String) -> Bool { cause == "data-damaged" }
    /// Moves the database files into a new dated set-aside folder inside the data folder and returns it. Nothing is deleted;
    /// a failed move puts back what it moved, and a put-back that fails too reports data-set-aside-incomplete, after which
    /// nothing may open the data folder. The storage key stays in the Keychain, so the set-aside copy stays readable.
    static func setAside(_ directory: URL, now: Date = Date()) throws -> URL {
        let manager = FileManager.default
        let present = databaseFiles.map { directory.appendingPathComponent($0) }.filter { manager.fileExists(atPath: $0.path) }
        try FleetProtocol.require(!present.isEmpty, "data-set-aside", "There is no local data to set aside.")
        let format = DateFormatter(); format.locale = Locale(identifier: "en_US_POSIX"); format.dateFormat = "yyyyMMdd-HHmmss"
        let folder = directory.appendingPathComponent("set-aside-" + format.string(from: now), isDirectory: true)
        try FleetProtocol.require(!manager.fileExists(atPath: folder.path), "data-set-aside", "The local data was just set aside. Wait a moment and try again.")
        var moved: [(URL, URL)] = []
        do {
            try manager.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            for source in present { let target = folder.appendingPathComponent(source.lastPathComponent); try manager.moveItem(at: source, to: target); moved.append((source, target)) }
            return folder
        } catch {
            var restored = true
            for (source, target) in moved.reversed() { do { try manager.moveItem(at: target, to: source) } catch { restored = false } }
            if (try? manager.contentsOfDirectory(atPath: folder.path))?.isEmpty == true { try? manager.removeItem(at: folder) }
            if !restored { throw FleetFailure("data-set-aside-incomplete", "Part of the local data is in \(folder.path). Nothing was deleted; move those files back before opening Work Fleet again.") }
            throw FleetFailure("data-set-aside", "The local data couldn't be set aside, and nothing was moved. Check the folder's permissions and try again.")
        }
    }
    deinit { close() }
    private func synchronized<T>(_ action: () throws -> T) rethrows -> T { lock.lock(); defer { lock.unlock() }; return try action() }
    private func statement(_ sql: String, _ parameters: [Any]) throws -> OpaquePointer {
        try FleetProtocol.require(!closed, "native-closed", "The local database is closed.")
        var statement: OpaquePointer?; try FleetProtocol.require(sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK && statement != nil, "native-storage", "The local data operation didn't finish.")
        for (index, value) in parameters.enumerated() {
            let position = Int32(index + 1); var status: Int32
            if let text = value as? String { status = sqlite3_bind_text(statement, position, text, -1, transient) }
            else if let data = value as? Data { status = data.withUnsafeBytes { sqlite3_bind_blob(statement, position, $0.baseAddress, Int32(data.count), transient) } }
            else if let number = value as? Int64 { status = sqlite3_bind_int64(statement, position, number) }
            else if let number = value as? Int { status = sqlite3_bind_int64(statement, position, Int64(number)) }
            else { status = sqlite3_bind_null(statement, position) }
            if status != SQLITE_OK { sqlite3_finalize(statement); throw FleetFailure("native-storage", "A local data parameter isn't valid.") }
        }
        return statement!
    }
    private func execute(_ sql: String, _ parameters: [Any] = []) throws {
        if parameters.isEmpty {
            try FleetProtocol.require(sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK, "native-storage", "The local data transaction didn't finish.")
        } else {
            let request = try statement(sql, parameters); defer { sqlite3_finalize(request) }
            try FleetProtocol.require(sqlite3_step(request) == SQLITE_DONE, "native-storage", "The local data transaction didn't finish.")
        }
    }
    private func scalar(_ sql: String, _ parameters: [Any] = []) throws -> Any? {
        let request = try statement(sql, parameters); defer { sqlite3_finalize(request) }; let status = sqlite3_step(request)
        if status == SQLITE_DONE { return nil }; try FleetProtocol.require(status == SQLITE_ROW, "native-storage", "Reading local data didn't finish.")
        switch sqlite3_column_type(request, 0) {
        case SQLITE_INTEGER: return sqlite3_column_int64(request, 0)
        case SQLITE_BLOB: return Data(bytes: sqlite3_column_blob(request, 0)!, count: Int(sqlite3_column_bytes(request, 0)))
        case SQLITE_TEXT: return String(cString: sqlite3_column_text(request, 0))
        default: return nil
        }
    }
    private func scope(_ kind: String, _ id: String) -> Data { Data("\(profile.utf8.count):\(profile)|\(kind)|\(id)".utf8) }
    private func seal(_ bytes: Data, _ kind: String, _ id: String) throws -> Data { try AES.GCM.seal(bytes, using: key, authenticating: scope(kind, id)).combined! }
    private func open(_ bytes: Data, _ kind: String, _ id: String) throws -> Data {
        do { return try AES.GCM.open(AES.GCM.SealedBox(combined: bytes), using: key, authenticating: scope(kind, id)) }
        catch { throw FleetFailure("vault-unavailable", "Couldn't read the encrypted local data. Keep the original data and try again.") }
    }
    private func kind(_ value: String) throws { try FleetProtocol.require(["workspace", "journal"].contains(value), "invalid-record", "The storage kind isn't valid.") }
    func record(_ kind: String) throws -> Data? { try synchronized {
        try self.kind(kind)
        // A database that opened but can't be read names its cause, which the page explains.
        let stored: Any?
        do { stored = try scalar("SELECT data FROM records WHERE profile=? AND kind=?", [profile, kind]) } catch { throw Self.classified(database, error) }
        guard let bytes = stored as? Data else { return nil }; return try open(bytes, kind, "record")
    } }
    func attachment(_ id: String) throws -> Data? { try synchronized {
        try FleetProtocol.require(FleetProtocol.isDigest(id), "invalid-attachment", "The attachment ID isn't valid.")
        guard let bytes = try scalar("SELECT data FROM attachments WHERE profile=? AND id=?", [profile, id]) as? Data else { return nil }
        let data = try open(bytes, "attachment", id); try FleetProtocol.require(FleetProtocol.digest(data) == id, "attachment-integrity", "The attachment failed its checksum."); return data
    } }
    func secret(_ kind: String, _ id: String) throws -> Data? { try synchronized { guard let bytes = try scalar("SELECT data FROM secrets WHERE profile=? AND kind=? AND id=?", [profile, kind, id]) as? Data else { return nil }; return try open(bytes, "secret:" + kind, id) } }
    func secret(_ kind: String, _ id: String, _ bytes: Data) throws { try synchronized {
        try FleetProtocol.require(bytes.count <= 65536, "invalid-secret", "The secure storage item is too large.")
        try execute("INSERT OR REPLACE INTO secrets VALUES(?,?,?,?)", [profile, kind, id, try seal(bytes, "secret:" + kind, id)])
    } }
    func forget(_ kind: String, _ id: String) throws { try synchronized { try execute("DELETE FROM secrets WHERE profile=? AND kind=? AND id=?", [profile, kind, id]) } }
    /// Deletes everything this profile keeps on the device; Google credentials live in the Keychain and stay.
    func reset() throws { try synchronized {
        try transaction { for table in ["records", "record_entries", "record_heads", "attachments", "staging", "secrets"] { try execute("DELETE FROM \(table) WHERE profile=?", [profile]) } }
        // Return the freed pages so the deleted notes do not stay behind in the database file.
        try execute("PRAGMA wal_checkpoint(TRUNCATE)"); try execute("VACUUM")
    } }
    private func validate(_ bytes: Data) throws -> Int64 { let value = try FleetProtocol.json(bytes); try FleetProtocol.require(FleetProtocol.text(value, "profileId") == profile, "invalid-profile", "The data doesn't belong to the current workspace."); return try FleetProtocol.number(value, "revision") }
    func stage(_ kind: String, _ bytes: Data, _ digest: String) throws -> String { try synchronized {
        try FleetProtocol.require(["workspace", "journal", "attachment", "backup"].contains(kind), "invalid-transfer", "The transfer kind isn't valid.")
        let maximum = kind == "backup" ? FleetProtocol.backup : kind == "attachment" ? FleetProtocol.attachment : FleetProtocol.record
        try FleetProtocol.require(bytes.count <= maximum && FleetProtocol.isDigest(digest) && FleetProtocol.digest(bytes) == digest, "transfer-integrity", "The transferred content failed its checksum.")
        if kind == "workspace" || kind == "journal" { _ = try validate(bytes) }
        let total = try scalar("SELECT COALESCE(SUM(size),0) FROM staging") as? Int64 ?? 0, count = try scalar("SELECT COUNT(*) FROM staging") as? Int64 ?? 0
        try FleetProtocol.require(total + Int64(bytes.count) <= 512 * 1024 * 1024 && count < 20008, "transfer-capacity", "Temporary storage is full.")
        let token = FleetProtocol.uuid(); try execute("INSERT INTO staging VALUES(?,?,?,?,?,?)", [profile, token, kind, digest, bytes.count, try seal(bytes, "staging", token)]); return token
    } }
    func staged(_ token: String, _ kind: String) throws -> Data { try synchronized {
        guard let bytes = try scalar("SELECT data FROM staging WHERE profile=? AND token=? AND kind=?", [profile, token, kind]) as? Data,
            let digest = try scalar("SELECT digest FROM staging WHERE profile=? AND token=? AND kind=?", [profile, token, kind]) as? String else { throw FleetFailure("transfer-missing", "The native transfer has expired.") }
        let data = try open(bytes, "staging", token); try FleetProtocol.require(FleetProtocol.digest(data) == digest, "transfer-integrity", "The transferred content failed its checksum."); return data
    } }
    func discard(_ token: String) throws { try synchronized { try execute("DELETE FROM staging WHERE profile=? AND token=?", [profile, token]) } }
    private func transaction<T>(_ action: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE"); do { let result = try action(); try execute("COMMIT"); return result } catch { try? execute("ROLLBACK"); throw error }
    }
    private func commitAttachment(_ token: String) throws -> String {
        let data = try staged(token, "attachment"), id = FleetProtocol.digest(data)
        try execute("INSERT OR IGNORE INTO attachments VALUES(?,?,?)", [profile, id, try seal(data, "attachment", id)]); try discard(token); return id
    }
    func putAttachment(_ token: String) throws -> String { try synchronized { try transaction { try commitAttachment(token) } } }
    func commit(_ kind: String, _ token: String, _ expected: Int64?, _ attachments: [String], replaceAttachments: Bool = false) throws { try synchronized {
        try FleetProtocol.require(!replaceAttachments || (kind == "workspace" && !profile.hasPrefix("google:")), "invalid-request", "Only the local workspace can clear its attachments while restoring.")
        try self.kind(kind); let bytes = try staged(token, kind), revision = try validate(bytes)
        try FleetProtocol.require(revision == (expected.map { $0 + 1 } ?? 0) && Set(attachments).count == attachments.count && attachments.count <= 20000, "stale-workspace", "The data version or attachments don't match.")
        try transaction {
            let current = try scalar("SELECT revision FROM records WHERE profile=? AND kind=?", [profile, kind]) as? Int64
            try FleetProtocol.require(current == expected, "stale-workspace", "Another writer changed the workspace.")
            if replaceAttachments { try execute("DELETE FROM attachments WHERE profile=?", [profile]) }
            for attachment in attachments { _ = try commitAttachment(attachment) }
            try execute("INSERT OR REPLACE INTO records VALUES(?,?,?,?)", [profile, kind, revision, try seal(bytes, kind, "record")]); try discard(token)
        }
    } }
    func close() { synchronized { if closed { return }; closed = true; sqlite3_close(database); database = nil; if owner >= 0 { flock(owner, LOCK_UN); Darwin.close(owner); owner = -1 } } }
}

extension FleetDatabase {
    private static let recordFormat = "work-fleet-local-records", batchBytes = 8 * 1024 * 1024
    private static let collections: Set<String> = ["meta", "current", "history", "draft", "outbox", "control", "job"]
    private static func recordRequire(_ condition: Bool) throws {
        try FleetProtocol.require(condition, "invalid-record-transaction", "The local record transaction is invalid. Saved data is unchanged.")
    }
    private static func recordKey(_ text: String) -> Bool {
        text.range(of: "^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$", options: .regularExpression) == text.startIndex..<text.endIndex
            && !["__proto__", "prototype", "constructor"].contains(text)
    }
    private func initializeRecords() throws {
        try execute("CREATE TABLE IF NOT EXISTS record_heads(profile TEXT PRIMARY KEY,revision INTEGER NOT NULL,commit_id TEXT NOT NULL,digest TEXT NOT NULL);")
        try execute("CREATE TABLE IF NOT EXISTS record_entries(profile TEXT NOT NULL,collection TEXT NOT NULL,id TEXT NOT NULL,entity TEXT NOT NULL,ordinal INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(profile,collection,id));")
        try execute("CREATE INDEX IF NOT EXISTS record_order ON record_entries(profile,collection,ordinal DESC,id DESC); CREATE INDEX IF NOT EXISTS record_entity ON record_entries(profile,collection,entity,ordinal DESC,id DESC);")
    }
    func recordStatus() throws -> [String: Any]? { try synchronized {
        if let revision = try scalar("SELECT revision FROM record_heads WHERE profile=?", [profile]) as? Int64 {
            guard let id = try scalar("SELECT commit_id FROM record_heads WHERE profile=?", [profile]) as? String,
                let digest = try scalar("SELECT digest FROM record_heads WHERE profile=?", [profile]) as? String else {
                throw FleetFailure("storage-integrity", "The local record receipt is incomplete.")
            }
            return ["format": Self.recordFormat, "schemaVersion": 1, "profileId": profile, "revision": revision, "commitId": id, "digest": digest]
        }
        // Detect the old format without decrypting its history or converting it.
        if try scalar("SELECT 1 FROM records WHERE profile=? AND kind='workspace'", [profile]) != nil {
            return ["format": "legacy-workspace", "profileId": profile]
        }
        return nil
    } }
    func recordEntry(_ collection: String, _ id: String) throws -> Data? { try synchronized {
        try Self.recordRequire(Self.collections.contains(collection) && Self.recordKey(id))
        guard let encrypted = try scalar("SELECT data FROM record_entries WHERE profile=? AND collection=? AND id=?", [profile, collection, id]) as? Data else { return nil }
        let bytes = try open(encrypted, "entry:" + collection, id), value = try FleetProtocol.json(bytes)
        try Self.recordRequire(value["collection"] as? String == collection && value["key"] as? String == id)
        return bytes
    } }
    func recordPage(_ query: [String: Any]) throws -> Data { try synchronized {
        try Self.recordRequire(Set(query.keys).isSubset(of: ["collection", "entity", "after", "limit", "expectedRevision", "order", "keysOnly"]))
        let keysOnly = query["keysOnly"] as? Bool ?? false
        if let flag = query["keysOnly"] { try Self.recordRequire(flag is NSNumber && CFGetTypeID(flag as CFTypeRef) == CFBooleanGetTypeID()) }
        let order = query["order"] as? String ?? "desc"
        try Self.recordRequire(query["order"] == nil || query["order"] is String); try Self.recordRequire(["asc", "desc"].contains(order))
        let collection = try FleetProtocol.text(query, "collection"), entity = query["entity"] is NSNull || query["entity"] == nil ? nil : query["entity"] as? String
        try Self.recordRequire(Self.collections.contains(collection) && (query["entity"] == nil || query["entity"] is NSNull || entity != nil)
            && (entity == nil || entity == "" || Self.recordKey(entity!)))
        let limit = try FleetProtocol.number(["limit": query["limit"] ?? 100], "limit", 100)
        try Self.recordRequire(limit > 0 && query["expectedRevision"] != nil)
        let expected: Int64? = query["expectedRevision"] is NSNull ? nil : try FleetProtocol.number(query, "expectedRevision")
        let status = try recordStatus()
        try FleetProtocol.require(status == nil || status?["format"] as? String == Self.recordFormat, "incompatible-local-data", "This profile uses an older format. Keep it or explicitly reset it before continuing.")
        try FleetProtocol.require(status?["revision"] as? Int64 == expected, "stale-writer", "Local data changed while reading its records. Reload before continuing.")
        var whereClause = "profile=? AND collection=?", parameters: [Any] = [profile, collection]
        if let entity { whereClause += " AND entity=?"; parameters.append(entity) }
        if query["after"] != nil && !(query["after"] is NSNull) {
            guard let after = query["after"] as? [String: Any] else { throw FleetFailure("invalid-record-transaction", "The record cursor is invalid.") }
            try Self.recordRequire(Set(after.keys) == ["ordinal", "key"])
            let ordinal = try FleetProtocol.number(after, "ordinal"), id = try FleetProtocol.text(after, "key")
            try Self.recordRequire(Self.recordKey(id)); whereClause += " AND (ordinal,id)" + (order == "asc" ? ">" : "<") + "(?,?)"; parameters += [ordinal, id]
        }
        parameters.append(limit + 1)
        let sorting = order == "asc" ? "ASC" : "DESC"
        let request = try statement("SELECT id,entity,ordinal," + (keysOnly ? "NULL" : "data") + " FROM record_entries WHERE " + whereClause + " ORDER BY ordinal " + sorting + ",id " + sorting + " LIMIT ?", parameters)
        defer { sqlite3_finalize(request) }
        var rows: [[String: Any]] = [], size = 512, more = false
        while true {
            let step = sqlite3_step(request)
            if step == SQLITE_DONE { break }
            try FleetProtocol.require(step == SQLITE_ROW, "native-storage", "The local record read did not finish.")
            let id = String(cString: sqlite3_column_text(request, 0)), storedEntity = String(cString: sqlite3_column_text(request, 1))
            let bytes = try keysOnly ? FleetProtocol.encode(["collection": collection, "key": id, "ordinal": sqlite3_column_int64(request, 2)])
                : open(Data(bytes: sqlite3_column_blob(request, 3), count: Int(sqlite3_column_bytes(request, 3))), "entry:" + collection, id)
            let row = try FleetProtocol.json(bytes)
            try Self.recordRequire(row["collection"] as? String == collection && row["key"] as? String == id && (keysOnly || row["entity"] as? String == storedEntity)
                && FleetProtocol.number(row, "ordinal") == sqlite3_column_int64(request, 2))
            if rows.count >= Int(limit) || (!rows.isEmpty && size + bytes.count > Self.batchBytes) { more = true; break }
            try Self.recordRequire(size + bytes.count <= Self.batchBytes); rows.append(row); size += bytes.count + 1
        }
        let next: Any = more && !rows.isEmpty ? ["ordinal": rows.last!["ordinal"]!, "key": rows.last!["key"]!] : NSNull()
        return try FleetProtocol.encode(["revision": expected.map { $0 as Any } ?? NSNull(), "rows": rows, "next": next])
    } }
    func commitRecords(_ token: String, _ expected: Int64?, _ attachments: [String]) throws -> [String: Any] { try synchronized {
        try Self.recordRequire(expected == nil || expected! >= 0 && expected! <= FleetProtocol.safeInteger)
        try Self.recordRequire(attachments.count <= 512 && Set(attachments).count == attachments.count)
        let bytes = try staged(token, "workspace")
        try Self.recordRequire(bytes.count <= Self.batchBytes)
        let value = try FleetProtocol.json(bytes), digest = FleetProtocol.digest(bytes)
        let expectedKeys: Set<String> = Set(["format", "schemaVersion", "profileId", "revision", "commitId", "puts", "deletes"] + (value["attachmentDeletes"] == nil ? [] : ["attachmentDeletes"]))
        try Self.recordRequire(Set(value.keys) == expectedKeys
            && value["format"] as? String == "work-fleet-record-transaction" && value["profileId"] as? String == profile
            && FleetProtocol.number(value, "schemaVersion") == 1)
        let revision = try FleetProtocol.number(value, "revision"), id = try FleetProtocol.text(value, "commitId")
        try Self.recordRequire(FleetProtocol.isUUID(id) && id == id.lowercased())
        guard let puts = value["puts"] as? [[String: Any]], let deletes = value["deletes"] as? [[String: Any]] else {
            throw FleetFailure("invalid-record-transaction", "The record changes are invalid.")
        }
        let attachmentDeletes = value["attachmentDeletes"] as? [String] ?? []
        try Self.recordRequire((value["attachmentDeletes"] == nil || value["attachmentDeletes"] is [String])
            && attachmentDeletes.allSatisfy { $0.count == 64 && FleetProtocol.isDigest($0) } && Set(attachmentDeletes).count == attachmentDeletes.count
            && puts.count + deletes.count + attachmentDeletes.count <= 512)
        var seen = Set<String>()
        for row in puts + deletes {
            let collection = try FleetProtocol.text(row, "collection"), key = try FleetProtocol.text(row, "key")
            try Self.recordRequire(Self.collections.contains(collection) && Self.recordKey(key) && seen.insert(collection + "|" + key).inserted)
        }
        return try transaction {
            var attachmentBytes: Int64 = 0
            for staged in attachments {
                guard let size = try scalar("SELECT size FROM staging WHERE profile=? AND token=? AND kind='attachment'", [profile, staged]) as? Int64 else {
                    throw FleetFailure("transfer-missing", "The native attachment transfer has expired.")
                }
                try Self.recordRequire(size >= 0 && size <= Int64(FleetProtocol.attachment))
                attachmentBytes += size; try Self.recordRequire(attachmentBytes <= 128 * 1024 * 1024)
            }
            let status = try recordStatus()
            if status?["revision"] as? Int64 == revision && status?["commitId"] as? String == id && status?["digest"] as? String == digest {
                for staged in [token] + attachments { try discard(staged) }
                return status!
            }
            try FleetProtocol.require(status == nil || status?["format"] as? String == Self.recordFormat, "incompatible-local-data", "This profile uses an older format. Keep it or explicitly reset it before continuing.")
            try FleetProtocol.require(status?["revision"] as? Int64 == expected, "stale-writer", "Another writer changed the local records. Keep your changes and reload.")
            try Self.recordRequire(revision == (expected.map { $0 + 1 } ?? 0))
            for row in puts {
                try Self.recordRequire(Set(row.keys) == ["collection", "key", "entity", "ordinal", "value"])
                try Self.recordRequire(FleetProtocol.encode(row).count <= Self.batchBytes - 1024)
                let collection = try FleetProtocol.text(row, "collection"), key = try FleetProtocol.text(row, "key")
                guard let entity = row["entity"] as? String else { throw FleetFailure("invalid-record-transaction", "The record entity is invalid.") }
                try Self.recordRequire(entity == "" || Self.recordKey(entity))
                let ordinal = try FleetProtocol.number(row, "ordinal", revision)
                if collection == "history", let previous = try recordEntry(collection, key) {
                    let old = try FleetProtocol.json(previous)
                    try FleetProtocol.require(old["entity"] as? String == entity
                        && FleetProtocol.encode(["value": old["value"]!]) == FleetProtocol.encode(["value": row["value"]!]),
                        "revision-collision", "A revision ID has different content. Saved data is unchanged.")
                    continue
                }
                try execute("INSERT INTO record_entries VALUES(?,?,?,?,?,?) ON CONFLICT(profile,collection,id) DO UPDATE SET entity=excluded.entity,ordinal=excluded.ordinal,data=excluded.data",
                    [profile, collection, key, entity, ordinal, try seal(FleetProtocol.encode(row), "entry:" + collection, key)])
            }
            for row in deletes {
                try Self.recordRequire(Set(row.keys) == ["collection", "key"])
                try execute("DELETE FROM record_entries WHERE profile=? AND collection=? AND id=?", [profile, try FleetProtocol.text(row, "collection"), try FleetProtocol.text(row, "key")])
            }
            for identity in attachmentDeletes { try execute("DELETE FROM attachments WHERE profile=? AND id=?", [profile, identity]) }
            for attachment in attachments { _ = try commitAttachment(attachment) }
            try execute("INSERT INTO record_heads VALUES(?,?,?,?) ON CONFLICT(profile) DO UPDATE SET revision=excluded.revision,commit_id=excluded.commit_id,digest=excluded.digest", [profile, revision, id, digest])
            try discard(token)
            return ["format": Self.recordFormat, "schemaVersion": 1, "profileId": profile, "revision": revision, "commitId": id, "digest": digest]
        }
    } }
}
