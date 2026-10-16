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
        try FleetProtocol.require(profile == "local" || profile.hasPrefix("google:") && FleetProtocol.isAccount(String(profile.dropFirst(7))), "invalid-profile", "工作空間身分無效。")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let data = directory.appendingPathComponent("fleet.sqlite3")
        let descriptor = Darwin.open(directory.appendingPathComponent("owner.lock").path, O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 && flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { if descriptor >= 0 { Darwin.close(descriptor) }; throw FleetFailure("native-already-open", "工作空間已在另一個 Work Fleet 視窗開啟。") }
        do { key = try FleetKeychain.storageKey(existing: FileManager.default.fileExists(atPath: data.path)) }
        catch { Darwin.close(descriptor); throw error }
        owner = descriptor
        do {
            try FleetProtocol.require(sqlite3_open_v2(data.path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, "native-storage", "無法開啟本機資料庫。")
            sqlite3_busy_timeout(database, 5000)
            try execute("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;")
            let version = try scalar("PRAGMA user_version;") as? Int64 ?? 0
            try FleetProtocol.require(version == 0 || version == 1, "storage-version", "資料格式較新，請更新 Work Fleet。")
            try execute("CREATE TABLE IF NOT EXISTS records(profile TEXT,kind TEXT,revision INTEGER,data BLOB,PRIMARY KEY(profile,kind));")
            try execute("CREATE TABLE IF NOT EXISTS attachments(profile TEXT,id TEXT,data BLOB,PRIMARY KEY(profile,id));")
            try execute("CREATE TABLE IF NOT EXISTS staging(profile TEXT,token TEXT PRIMARY KEY,kind TEXT,digest TEXT,size INTEGER,data BLOB);")
            try execute("CREATE TABLE IF NOT EXISTS secrets(profile TEXT,kind TEXT,id TEXT,data BLOB,PRIMARY KEY(profile,kind,id));")
            try execute("DELETE FROM staging; PRAGMA user_version=1;")
        } catch { sqlite3_close(database); database = nil; Darwin.close(owner); owner = -1; throw error }
    }
    deinit { close() }
    private func synchronized<T>(_ action: () throws -> T) rethrows -> T { lock.lock(); defer { lock.unlock() }; return try action() }
    private func statement(_ sql: String, _ parameters: [Any]) throws -> OpaquePointer {
        try FleetProtocol.require(!closed, "native-closed", "本機資料庫已關閉。")
        var statement: OpaquePointer?; try FleetProtocol.require(sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK && statement != nil, "native-storage", "本機資料操作未完成。")
        for (index, value) in parameters.enumerated() {
            let position = Int32(index + 1); var status: Int32
            if let text = value as? String { status = sqlite3_bind_text(statement, position, text, -1, transient) }
            else if let data = value as? Data { status = data.withUnsafeBytes { sqlite3_bind_blob(statement, position, $0.baseAddress, Int32(data.count), transient) } }
            else if let number = value as? Int64 { status = sqlite3_bind_int64(statement, position, number) }
            else if let number = value as? Int { status = sqlite3_bind_int64(statement, position, Int64(number)) }
            else { status = sqlite3_bind_null(statement, position) }
            if status != SQLITE_OK { sqlite3_finalize(statement); throw FleetFailure("native-storage", "本機資料參數無效。") }
        }
        return statement!
    }
    private func execute(_ sql: String, _ parameters: [Any] = []) throws {
        if parameters.isEmpty {
            try FleetProtocol.require(sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK, "native-storage", "本機資料交易未完成。")
        } else {
            let request = try statement(sql, parameters); defer { sqlite3_finalize(request) }
            try FleetProtocol.require(sqlite3_step(request) == SQLITE_DONE, "native-storage", "本機資料交易未完成。")
        }
    }
    private func scalar(_ sql: String, _ parameters: [Any] = []) throws -> Any? {
        let request = try statement(sql, parameters); defer { sqlite3_finalize(request) }; let status = sqlite3_step(request)
        if status == SQLITE_DONE { return nil }; try FleetProtocol.require(status == SQLITE_ROW, "native-storage", "本機資料讀取未完成。")
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
        catch { throw FleetFailure("vault-unavailable", "本機加密內容無法讀取，請保留原資料並重試。") }
    }
    private func kind(_ value: String) throws { try FleetProtocol.require(["workspace", "journal"].contains(value), "invalid-record", "儲存種類無效。") }
    func record(_ kind: String) throws -> Data? { try synchronized { try self.kind(kind); guard let bytes = try scalar("SELECT data FROM records WHERE profile=? AND kind=?", [profile, kind]) as? Data else { return nil }; return try open(bytes, kind, "record") } }
    func attachment(_ id: String) throws -> Data? { try synchronized {
        try FleetProtocol.require(FleetProtocol.isDigest(id), "invalid-attachment", "附件身分無效。")
        guard let bytes = try scalar("SELECT data FROM attachments WHERE profile=? AND id=?", [profile, id]) as? Data else { return nil }
        let data = try open(bytes, "attachment", id); try FleetProtocol.require(FleetProtocol.digest(data) == id, "attachment-integrity", "附件校驗失敗。"); return data
    } }
    func secret(_ kind: String, _ id: String) throws -> Data? { try synchronized { guard let bytes = try scalar("SELECT data FROM secrets WHERE profile=? AND kind=? AND id=?", [profile, kind, id]) as? Data else { return nil }; return try open(bytes, "secret:" + kind, id) } }
    func secret(_ kind: String, _ id: String, _ bytes: Data) throws { try synchronized {
        try FleetProtocol.require(bytes.count <= 65536, "invalid-secret", "安全儲存內容過大。")
        try execute("INSERT OR REPLACE INTO secrets VALUES(?,?,?,?)", [profile, kind, id, try seal(bytes, "secret:" + kind, id)])
    } }
    func forget(_ kind: String, _ id: String) throws { try synchronized { try execute("DELETE FROM secrets WHERE profile=? AND kind=? AND id=?", [profile, kind, id]) } }
    /// Deletes everything this profile keeps on the device; Google credentials live in the Keychain and stay.
    func reset() throws { try synchronized {
        try transaction { for table in ["records", "attachments", "staging", "secrets"] { try execute("DELETE FROM \(table) WHERE profile=?", [profile]) } }
        // Return the freed pages so the deleted notes do not stay behind in the database file.
        try execute("PRAGMA wal_checkpoint(TRUNCATE)"); try execute("VACUUM")
    } }
    private func validate(_ bytes: Data) throws -> Int64 { let value = try FleetProtocol.json(bytes); try FleetProtocol.require(FleetProtocol.text(value, "profileId") == profile, "invalid-profile", "資料不屬於目前工作空間。"); return try FleetProtocol.number(value, "revision") }
    func stage(_ kind: String, _ bytes: Data, _ digest: String) throws -> String { try synchronized {
        try FleetProtocol.require(["workspace", "journal", "attachment", "backup"].contains(kind), "invalid-transfer", "傳輸種類無效。")
        let maximum = kind == "backup" ? FleetProtocol.backup : kind == "attachment" ? FleetProtocol.attachment : FleetProtocol.record
        try FleetProtocol.require(bytes.count <= maximum && FleetProtocol.isDigest(digest) && FleetProtocol.digest(bytes) == digest, "transfer-integrity", "傳輸內容校驗失敗。")
        if kind == "workspace" || kind == "journal" { _ = try validate(bytes) }
        let total = try scalar("SELECT COALESCE(SUM(size),0) FROM staging") as? Int64 ?? 0, count = try scalar("SELECT COUNT(*) FROM staging") as? Int64 ?? 0
        try FleetProtocol.require(total + Int64(bytes.count) <= 512 * 1024 * 1024 && count < 20008, "transfer-capacity", "暫存資料容量已滿。")
        let token = FleetProtocol.uuid(); try execute("INSERT INTO staging VALUES(?,?,?,?,?,?)", [profile, token, kind, digest, bytes.count, try seal(bytes, "staging", token)]); return token
    } }
    func staged(_ token: String, _ kind: String) throws -> Data { try synchronized {
        guard let bytes = try scalar("SELECT data FROM staging WHERE profile=? AND token=? AND kind=?", [profile, token, kind]) as? Data,
            let digest = try scalar("SELECT digest FROM staging WHERE profile=? AND token=? AND kind=?", [profile, token, kind]) as? String else { throw FleetFailure("transfer-missing", "原生傳輸已失效。") }
        let data = try open(bytes, "staging", token); try FleetProtocol.require(FleetProtocol.digest(data) == digest, "transfer-integrity", "傳輸內容校驗失敗。"); return data
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
    func recovery(_ kind: String, _ fromVersion: Int64) throws -> Data? { try synchronized {
        try self.kind(kind); try FleetProtocol.require(fromVersion > 0 && fromVersion <= 9_007_199_254_740_991, "invalid-migration", "資料升級版本無效。")
        let key = "migration:\(kind):\(fromVersion)"
        guard let bytes = try scalar("SELECT data FROM records WHERE profile=? AND kind=?", [profile, key]) as? Data else { return nil }
        return try open(bytes, key, "record")
    } }
    func commit(_ kind: String, _ token: String, _ expected: Int64?, _ attachments: [String], replaceAttachments: Bool = false, migrationFrom: Int64? = nil) throws { try synchronized {
        try FleetProtocol.require(!replaceAttachments || (kind == "workspace" && !profile.hasPrefix("google:")), "invalid-request", "只有本機工作空間可以清空附件後還原。")
        try self.kind(kind); let bytes = try staged(token, kind), revision = try validate(bytes)
        try FleetProtocol.require(revision == (expected.map { $0 + 1 } ?? 0) && Set(attachments).count == attachments.count && attachments.count <= 20000, "stale-workspace", "資料版本或附件條件不符。")
        try transaction {
            let current = try scalar("SELECT revision FROM records WHERE profile=? AND kind=?", [profile, kind]) as? Int64
            try FleetProtocol.require(current == expected, "stale-workspace", "工作空間已由另一個寫入者變更。")
            try FleetProtocol.require(migrationFrom == nil || current != nil, "invalid-migration", "找不到原始資料。")
            if let previous = try record(kind) {
                let before = try FleetProtocol.json(previous), after = try FleetProtocol.json(bytes)
                let oldSchema = before["schemaVersion"] == nil ? nil : try FleetProtocol.number(before, "schemaVersion")
                let newSchema = after["schemaVersion"] == nil ? nil : try FleetProtocol.number(after, "schemaVersion")
                if let from = migrationFrom {
                    try FleetProtocol.require(from > 0 && oldSchema == from && newSchema != nil && newSchema! > from && !replaceAttachments && attachments.isEmpty, "invalid-migration", "資料升級版本與原始資料不同。")
                    let key = "migration:\(kind):\(from)"
                    try execute("INSERT INTO records VALUES(?,?,?,?)", [profile, key, current!, try seal(previous, key, "record")])
                } else { try FleetProtocol.require(oldSchema == newSchema, "migration-required", "資料升級需要安全保存原始副本。") }
            }
            if replaceAttachments {
                try execute("DELETE FROM attachments WHERE profile=?", [profile])
                try execute("DELETE FROM records WHERE profile=? AND kind LIKE 'migration:workspace:%'", [profile])
            }
            for attachment in attachments { _ = try commitAttachment(attachment) }
            try execute("INSERT OR REPLACE INTO records VALUES(?,?,?,?)", [profile, kind, revision, try seal(bytes, kind, "record")]); try discard(token)
        }
    } }
    func close() { synchronized { if closed { return }; closed = true; sqlite3_close(database); database = nil; if owner >= 0 { flock(owner, LOCK_UN); Darwin.close(owner); owner = -1 } } }
}
