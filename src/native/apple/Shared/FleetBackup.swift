import Foundation
import CryptoKit
import CommonCrypto
import Darwin

final class FleetBackup {
    private let database: FleetDatabase
    private let choose: @MainActor () async throws -> URL
    private var manual: [String: String] = [:]
    private static let fields = ["id", "scheduleId", "policyId", "destinationId", "name", "sourceRevision", "createdAt", "encrypted", "sha256", "size"]
    init(database: FleetDatabase, choose: @escaping @MainActor () async throws -> URL) { self.database = database; self.choose = choose }
    private func metadata(_ kind: String, _ id: String) throws -> [String: Any]? { guard let bytes = try database.secret(kind, id) else { return nil }; return try FleetProtocol.json(bytes) }
    private func save(_ kind: String, _ id: String, _ value: [String: Any]) throws { try database.secret(kind, id, FleetProtocol.encode(value)) }
    private func grant(_ selected: URL) throws -> String {
        let scoped = selected.startAccessingSecurityScopedResource(); defer { if scoped { selected.stopAccessingSecurityScopedResource() } }
        let descriptor = Darwin.open(selected.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
        try FleetProtocol.require(descriptor >= 0, "backup-permission", "無法開啟選擇的備份資料夾。"); defer { Darwin.close(descriptor) }
        var info = stat(); try FleetProtocol.require(fstat(descriptor, &info) == 0, "backup-permission", "無法確認備份位置。"); let id = FleetProtocol.uuid()
        #if os(macOS)
        let bookmark = try selected.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil)
        #else
        let bookmark = try selected.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        #endif
        try save("backup-directory", id, ["bookmark": bookmark.base64EncodedString(), "device": String(info.st_dev), "inode": String(info.st_ino), "name": selected.lastPathComponent]); return id
    }
    private func directory<T>(_ id: String, _ work: (Int32) throws -> T) throws -> T {
        guard let saved = try metadata("backup-directory", id), let bookmark = Data(base64Encoded: try FleetProtocol.text(saved, "bookmark", 65536)) else { throw FleetFailure("backup-permission", "請重新選擇備份資料夾。") }
        var stale = false
        #if os(macOS)
        let url = try URL(resolvingBookmarkData: bookmark, options: [.withSecurityScope, .withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale)
        #else
        let url = try URL(resolvingBookmarkData: bookmark, options: .withoutUI, relativeTo: nil, bookmarkDataIsStale: &stale)
        #endif
        try FleetProtocol.require(!stale, "backup-permission", "備份位置授權已過期，請重新選擇。")
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let descriptor = Darwin.open(url.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
        try FleetProtocol.require(descriptor >= 0, "backup-permission", "備份資料夾目前無法存取。"); defer { Darwin.close(descriptor) }
        var info = stat(); try FleetProtocol.require(fstat(descriptor, &info) == 0 && String(info.st_dev) == saved["device"] as? String && String(info.st_ino) == saved["inode"] as? String, "backup-permission", "備份資料夾身分已變更。"); return try work(descriptor)
    }
    private func read(_ descriptor: Int32, _ name: String, _ identity: [String: Any]? = nil) throws -> Data? {
        let file = openat(descriptor, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        if file < 0 && errno == ENOENT { return nil }
        try FleetProtocol.require(file >= 0, "backup-permission", "備份檔案不可讀。"); defer { Darwin.close(file) }
        var info = stat(); try FleetProtocol.require(fstat(file, &info) == 0 && info.st_mode & S_IFMT == S_IFREG && info.st_size >= 0 && info.st_size <= FleetProtocol.backup, "backup-unconfirmed", "備份檔案種類或容量無效。")
        if let identity { try FleetProtocol.require(String(info.st_dev) == identity["device"] as? String && String(info.st_ino) == identity["inode"] as? String, "backup-file-unowned", "備份檔案已被替換，已保留。") }
        var bytes = Data(); var chunk = [UInt8](repeating: 0, count: 65536)
        while true { let count = Darwin.read(file, &chunk, chunk.count); if count == 0 { break }; try FleetProtocol.require(count > 0 && bytes.count + count <= FleetProtocol.backup, "backup-unconfirmed", "備份讀取未完成。"); bytes.append(contentsOf: chunk.prefix(count)) }
        return bytes
    }
    private func create(_ descriptor: Int32, _ name: String, _ bytes: Data, _ record: ([String: Any]) throws -> Void) throws {
        let file = openat(descriptor, name, O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0o600)
        try FleetProtocol.require(file >= 0, "backup-file-unowned", "備份檔案已存在或無法建立，未覆寫。"); defer { Darwin.close(file) }
        var info = stat(); try FleetProtocol.require(fstat(file, &info) == 0 && info.st_mode & S_IFMT == S_IFREG, "backup-unconfirmed", "無法確認新備份檔案。")
        let identity: [String: Any] = ["device": String(info.st_dev), "inode": String(info.st_ino)]
        try record(identity)
        try bytes.withUnsafeBytes { buffer in
            var offset = 0
            while offset < bytes.count { let count = Darwin.write(file, buffer.baseAddress!.advanced(by: offset), bytes.count - offset); try FleetProtocol.require(count > 0, "backup-unconfirmed", "新備份尚未寫入完整，保留供檢查。"); offset += count }
        }
        try FleetProtocol.require(fsync(file) == 0 && fsync(descriptor) == 0, "backup-unconfirmed", "備份尚未完成安全保存，保留新檔供檢查。")
        let saved = try read(descriptor, name, identity); try FleetProtocol.require(saved == bytes, "backup-unconfirmed", "備份讀回校驗失敗，保留檔案供檢查。")
    }
    private func job(_ value: [String: Any]) throws -> [String: Any] {
        var job: [String: Any] = [:]; for field in Self.fields { try FleetProtocol.require(value[field] != nil, "invalid-backup-job", "備份工作缺必要欄位。"); job[field] = value[field] }
        for field in ["id", "scheduleId", "policyId", "destinationId"] { try FleetProtocol.require(FleetProtocol.isUUID(FleetProtocol.text(job, field)), "invalid-backup-job", "備份身分無效。") }
        try FleetProtocol.require(FleetProtocol.text(job, "name") == "work-fleet-auto-\(FleetProtocol.text(job, "id")).zip", "invalid-backup-job", "備份檔名無效。")
        _ = try FleetProtocol.number(job, "sourceRevision"); _ = try FleetProtocol.number(job, "createdAt"); _ = try FleetProtocol.bool(job, "encrypted")
        try FleetProtocol.require(FleetProtocol.isDigest(FleetProtocol.text(job, "sha256")) && FleetProtocol.number(job, "size", Int64(FleetProtocol.backup)) > 0, "invalid-backup-job", "備份校驗值或容量無效。"); return job
    }
    private func same(_ a: [String: Any], _ b: [String: Any]) throws -> Bool { try FleetProtocol.encode(job(a)) == FleetProtocol.encode(job(b)) }
    private func journal(_ job: [String: Any], _ operation: String) throws -> [String: Any]? {
        guard let bytes = try database.record("journal") else { throw FleetFailure("backup-job-unowned", "備份排程尚未保存。") }
        let value = try FleetProtocol.json(bytes); try FleetProtocol.require(FleetProtocol.text(value, "profileId") == database.profile, "backup-profile", "備份帳號已切換。")
        let pending = value["pending"] as? [String: Any]; let isPending = try pending.map { try same($0, job) } ?? false
        guard let inventory = value["inventory"] as? [[String: Any]], inventory.count <= 10000 else { throw FleetFailure("invalid-backup-journal", "備份紀錄無效。") }
        let matching = try inventory.filter { try same($0, job) }
        try FleetProtocol.require(operation == "create" ? isPending : isPending || matching.count == 1, "backup-job-unowned", "備份不在目前排程中。")
        if operation != "remove" { return nil }
        guard let latest = value["lastSuccess"] as? [String: Any], let settings = value["settings"] as? [String: Any] else { throw FleetFailure("backup-retention", "缺少最新備份確認，保留舊檔。") }
        try FleetProtocol.require(matching.count == 1 && !isPending && FleetProtocol.text(matching[0], "status") == "verified" && FleetProtocol.text(latest, "id") != FleetProtocol.text(job, "id")
            && FleetProtocol.text(latest, "scheduleId") == FleetProtocol.text(job, "scheduleId") && FleetProtocol.text(latest, "destinationId") == FleetProtocol.text(job, "destinationId")
            && FleetProtocol.text(settings, "scheduleId") == FleetProtocol.text(job, "scheduleId") && FleetProtocol.text(settings, "destinationId") == FleetProtocol.text(job, "destinationId"), "backup-retention", "備份不符合清理條件，已保留。")
        return try self.job(latest)
    }
    private func owned(_ job: [String: Any]) throws -> [String: Any]? {
        guard let saved = try metadata("backup-file", FleetProtocol.text(job, "id")), let previous = saved["job"] as? [String: Any] else { return nil }
        try FleetProtocol.require(same(previous, job), "backup-file-unowned", "備份原生身分不符。"); return saved
    }
    private func verified(_ descriptor: Int32, _ job: [String: Any], _ identity: [String: Any]?) throws -> Data {
        guard let identity, let bytes = try read(descriptor, FleetProtocol.text(job, "name"), identity) else { throw FleetFailure("backup-unconfirmed", "備份檔案未確認，保留舊檔。") }
        try FleetProtocol.require(bytes.count == FleetProtocol.number(job, "size") && FleetProtocol.digest(bytes) == FleetProtocol.text(job, "sha256"), "backup-unconfirmed", "備份內容已改變，未清理。"); return bytes
    }
    func invoke(_ method: String, _ args: [String: Any], isolation: isolated FleetService, upload: () throws -> Data, download: (Data?) throws -> Any) async throws -> Any {
        if args["profileId"] != nil { try FleetProtocol.require(FleetProtocol.text(args, "profileId") == database.profile, "backup-profile", "備份帳號已切換。") }
        switch method {
        case "backup.choose", "backup.manual.choose":
            let selected = try await choose(); let id = try grant(selected)
            if method == "backup.choose" { return ["destinationId": id, "destinationName": selected.lastPathComponent] }
            let token = FleetProtocol.uuid(); manual[token] = id; return ["destinationId": token, "name": "work-fleet-backup-\(token).zip"]
        case "backup.authorize": return try directory(FleetProtocol.text(args, "destinationId")) { _ in NSNull() }
        case "backup.manual.save":
            let token = try FleetProtocol.text(args, "destinationId"); guard let id = manual.removeValue(forKey: token) else { throw FleetFailure("backup-permission", "請重新選擇備份位置。") }
            let bytes = try upload(); try directory(id) { try create($0, "work-fleet-backup-\(token).zip", bytes) { _ in } }; return ["saved": true, "receipt": FleetProtocol.uuid()]
        case "backup.create":
            let job = try self.job(args); _ = try journal(job, "create"); let bytes = try upload()
            try FleetProtocol.require(bytes.count == FleetProtocol.number(job, "size") && FleetProtocol.digest(bytes) == FleetProtocol.text(job, "sha256"), "backup-integrity", "備份內容與工作不符。")
            try directory(FleetProtocol.text(job, "destinationId")) { descriptor in
                if let previous = try owned(job) { _ = try verified(descriptor, job, previous) }
                else { try create(descriptor, FleetProtocol.text(job, "name"), bytes) { identity in var saved = identity; saved["job"] = job; try save("backup-file", FleetProtocol.text(job, "id"), saved) } }
            }
            return ["saved": true, "receipt": try FleetProtocol.text(job, "id")]
        case "backup.read":
            let job = try self.job(args); _ = try journal(job, "read")
            return try directory(FleetProtocol.text(job, "destinationId")) { descriptor in
                if let identity = try owned(job) { return try download(verified(descriptor, job, identity)) }
                try FleetProtocol.require(read(descriptor, FleetProtocol.text(job, "name")) == nil, "backup-file-unowned", "同名檔案缺原生建立紀錄，已保留。"); return NSNull()
            }
        case "backup.remove":
            let job = try self.job(args); guard let latest = try journal(job, "remove"), let identity = try owned(job) else { throw FleetFailure("backup-file-unowned", "備份不屬於目前排程。") }
            try directory(FleetProtocol.text(latest, "destinationId")) { newest in
                _ = try verified(newest, latest, owned(latest))
                try directory(FleetProtocol.text(job, "destinationId")) { descriptor in
                    _ = try verified(descriptor, job, identity)
                    try FleetProtocol.require(unlinkat(descriptor, FleetProtocol.text(job, "name"), 0) == 0 && fsync(descriptor) == 0, "backup-permission", "備份尚未完成清理。")
                }
            }
            try database.forget("backup-file", FleetProtocol.text(job, "id")); return ["removed": true]
        case "backup.key.create":
            let password = try FleetProtocol.text(args, "password", 1024); try FleetProtocol.require(password.unicodeScalars.count >= 12, "backup-password", "備份密碼至少 12 個字元。")
            let id = FleetProtocol.uuid(); try database.secret("backup-key", id, Data(password.utf8)); return ["keyId": id]
        case "backup.encrypt":
            guard let password = try database.secret("backup-key", FleetProtocol.text(args, "keyId")) else { throw FleetFailure("backup-key-unavailable", "備份金鑰不存在，未改存明文。") }
            return try download(FleetBackupEncryption.encrypt(upload(), password))
        default: throw FleetFailure("unsupported-method", "備份主機沒有此操作。")
        }
    }
}
enum FleetBackupEncryption {
    private static func random(_ count: Int) -> Data { Data((0..<count).map { _ in UInt8.random(in: .min ... .max) }) }
    private static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
    static func encrypt(_ plaintext: Data, _ password: Data) throws -> Data {
        try FleetProtocol.require(!plaintext.isEmpty && plaintext.count <= 136 * 1024 * 1024, "backup-limit", "備份容量超限。")
        let salt = random(16), nonce = random(12)
        let aad = Data("{\"cipher\":\"AES-256-GCM\",\"format\":\"work-fleet-encrypted-backup\",\"iterations\":600000,\"kdf\":\"PBKDF2-HMAC-SHA256\",\"nonce\":\"\(hex(nonce))\",\"salt\":\"\(hex(salt))\",\"schemaVersion\":1,\"tagBits\":128}".utf8)
        var derived = [UInt8](repeating: 0, count: 32)
        let status = password.withUnsafeBytes { passwordBuffer in salt.withUnsafeBytes { saltBuffer in
            CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), passwordBuffer.bindMemory(to: Int8.self).baseAddress, password.count, saltBuffer.bindMemory(to: UInt8.self).baseAddress, salt.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 600000, &derived, 32)
        } }
        defer { for index in derived.indices { derived[index] = 0 } }
        try FleetProtocol.require(status == kCCSuccess, "backup-vault-unavailable", "備份金鑰無法衍生。")
        let sealed = try AES.GCM.seal(plaintext, using: SymmetricKey(data: derived), nonce: AES.GCM.Nonce(data: nonce), authenticating: aad)
        let result = zip([("encryption.json", aad), ("payload.bin", sealed.ciphertext + sealed.tag)])
        try FleetProtocol.require(result.count <= FleetProtocol.backup, "backup-limit", "加密備份容量超限。"); return result
    }
    private static func crc(_ bytes: Data) -> UInt32 { var crc: UInt32 = 0xffffffff; for byte in bytes { crc ^= UInt32(byte); for _ in 0..<8 { crc = crc & 1 == 1 ? crc >> 1 ^ 0xedb88320 : crc >> 1 } }; return crc ^ 0xffffffff }
    private static func word(_ value: UInt16, _ output: inout Data) { var value = value.littleEndian; withUnsafeBytes(of: &value) { output.append(contentsOf: $0) } }
    private static func long(_ value: UInt32, _ output: inout Data) { var value = value.littleEndian; withUnsafeBytes(of: &value) { output.append(contentsOf: $0) } }
    private static func zip(_ entries: [(String, Data)]) -> Data {
        var output = Data(), directory = Data()
        for (name, bytes) in entries {
            let encoded = Data(name.utf8), offset = UInt32(output.count), size = UInt32(bytes.count), checksum = crc(bytes)
            long(0x04034b50, &output); word(20, &output); word(0x0800, &output); word(0, &output); word(0, &output); word(33, &output); long(checksum, &output); long(size, &output); long(size, &output); word(UInt16(encoded.count), &output); word(0, &output); output.append(encoded); output.append(bytes)
            long(0x02014b50, &directory); word(20, &directory); word(20, &directory); word(0x0800, &directory); word(0, &directory); word(0, &directory); word(33, &directory); long(checksum, &directory); long(size, &directory); long(size, &directory); word(UInt16(encoded.count), &directory); word(0, &directory); word(0, &directory); word(0, &directory); word(0, &directory); long(0, &directory); long(offset, &directory); directory.append(encoded)
        }
        let offset = UInt32(output.count); output.append(directory); long(0x06054b50, &output); word(0, &output); word(0, &output); word(UInt16(entries.count), &output); word(UInt16(entries.count), &output); long(UInt32(directory.count), &output); long(offset, &output); word(0, &output); return output
    }
}
