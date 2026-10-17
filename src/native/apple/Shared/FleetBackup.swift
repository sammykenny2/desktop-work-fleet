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
        try FleetProtocol.require(descriptor >= 0, "backup-permission", "Couldn't open the selected backup folder."); defer { Darwin.close(descriptor) }
        var info = stat(); try FleetProtocol.require(fstat(descriptor, &info) == 0, "backup-permission", "Couldn't check the backup location."); let id = FleetProtocol.uuid()
        #if os(macOS)
        let bookmark = try selected.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil)
        #else
        let bookmark = try selected.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        #endif
        try save("backup-directory", id, ["bookmark": bookmark.base64EncodedString(), "device": String(info.st_dev), "inode": String(info.st_ino), "name": selected.lastPathComponent]); return id
    }
    private func directory<T>(_ id: String, _ work: (Int32) throws -> T) throws -> T {
        guard let saved = try metadata("backup-directory", id), let bookmark = Data(base64Encoded: try FleetProtocol.text(saved, "bookmark", 65536)) else { throw FleetFailure("backup-permission", "Choose the backup folder again.") }
        var stale = false
        #if os(macOS)
        let url = try URL(resolvingBookmarkData: bookmark, options: [.withSecurityScope, .withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale)
        #else
        let url = try URL(resolvingBookmarkData: bookmark, options: .withoutUI, relativeTo: nil, bookmarkDataIsStale: &stale)
        #endif
        try FleetProtocol.require(!stale, "backup-permission", "Access to the backup location has expired. Choose it again.")
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let descriptor = Darwin.open(url.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
        try FleetProtocol.require(descriptor >= 0, "backup-permission", "The backup folder can't be accessed right now."); defer { Darwin.close(descriptor) }
        var info = stat(); try FleetProtocol.require(fstat(descriptor, &info) == 0 && String(info.st_dev) == saved["device"] as? String && String(info.st_ino) == saved["inode"] as? String, "backup-permission", "The backup folder has changed."); return try work(descriptor)
    }
    private func read(_ descriptor: Int32, _ name: String, _ identity: [String: Any]? = nil) throws -> Data? {
        let file = openat(descriptor, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        if file < 0 && errno == ENOENT { return nil }
        try FleetProtocol.require(file >= 0, "backup-permission", "The backup file can't be read."); defer { Darwin.close(file) }
        var info = stat(); try FleetProtocol.require(fstat(file, &info) == 0 && info.st_mode & S_IFMT == S_IFREG && info.st_size >= 0 && info.st_size <= FleetProtocol.backup, "backup-unconfirmed", "The backup file type or size isn't valid.")
        if let identity { try FleetProtocol.require(String(info.st_dev) == identity["device"] as? String && String(info.st_ino) == identity["inode"] as? String, "backup-file-unowned", "The backup file was replaced, so it was kept.") }
        var bytes = Data(); var chunk = [UInt8](repeating: 0, count: 65536)
        while true { let count = Darwin.read(file, &chunk, chunk.count); if count == 0 { break }; try FleetProtocol.require(count > 0 && bytes.count + count <= FleetProtocol.backup, "backup-unconfirmed", "Reading the backup didn't finish."); bytes.append(contentsOf: chunk.prefix(count)) }
        return bytes
    }
    private func create(_ descriptor: Int32, _ name: String, _ bytes: Data, _ record: ([String: Any]) throws -> Void) throws {
        let file = openat(descriptor, name, O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0o600)
        try FleetProtocol.require(file >= 0, "backup-file-unowned", "The backup file already exists or can't be created. Nothing was overwritten."); defer { Darwin.close(file) }
        var info = stat(); try FleetProtocol.require(fstat(file, &info) == 0 && info.st_mode & S_IFMT == S_IFREG, "backup-unconfirmed", "Couldn't check the new backup file.")
        let identity: [String: Any] = ["device": String(info.st_dev), "inode": String(info.st_ino)]
        try record(identity)
        try bytes.withUnsafeBytes { buffer in
            var offset = 0
            while offset < bytes.count { let count = Darwin.write(file, buffer.baseAddress!.advanced(by: offset), bytes.count - offset); try FleetProtocol.require(count > 0, "backup-unconfirmed", "The new backup wasn't written completely. It was kept for inspection."); offset += count }
        }
        try FleetProtocol.require(fsync(file) == 0 && fsync(descriptor) == 0, "backup-unconfirmed", "The backup isn't safely saved yet. The new file was kept for inspection.")
        let saved = try read(descriptor, name, identity); try FleetProtocol.require(saved == bytes, "backup-unconfirmed", "The backup failed its read-back check. The file was kept for inspection.")
    }
    private func job(_ value: [String: Any]) throws -> [String: Any] {
        var job: [String: Any] = [:]; for field in Self.fields { try FleetProtocol.require(value[field] != nil, "invalid-backup-job", "The backup job is missing required fields."); job[field] = value[field] }
        for field in ["id", "scheduleId", "policyId", "destinationId"] { try FleetProtocol.require(FleetProtocol.isUUID(FleetProtocol.text(job, field)), "invalid-backup-job", "A backup ID isn't valid.") }
        try FleetProtocol.require(FleetProtocol.text(job, "name") == "work-fleet-auto-\(FleetProtocol.text(job, "id")).zip", "invalid-backup-job", "The backup file name isn't valid.")
        _ = try FleetProtocol.number(job, "sourceRevision"); _ = try FleetProtocol.number(job, "createdAt"); _ = try FleetProtocol.bool(job, "encrypted")
        try FleetProtocol.require(FleetProtocol.isDigest(FleetProtocol.text(job, "sha256")) && FleetProtocol.number(job, "size", Int64(FleetProtocol.backup)) > 0, "invalid-backup-job", "The backup checksum or size isn't valid."); return job
    }
    private func same(_ a: [String: Any], _ b: [String: Any]) throws -> Bool { try FleetProtocol.encode(job(a)) == FleetProtocol.encode(job(b)) }
    private func journal(_ job: [String: Any], _ operation: String) throws -> [String: Any]? {
        guard let bytes = try database.record("journal") else { throw FleetFailure("backup-job-unowned", "The backup schedule hasn't been saved yet.") }
        let value = try FleetProtocol.json(bytes); try FleetProtocol.require(FleetProtocol.text(value, "profileId") == database.profile, "backup-profile", "The account changed since this backup started.")
        let pending = value["pending"] as? [String: Any]; let isPending = try pending.map { try same($0, job) } ?? false
        guard let inventory = value["inventory"] as? [[String: Any]], inventory.count <= 10000 else { throw FleetFailure("invalid-backup-journal", "The backup record isn't valid.") }
        let matching = try inventory.filter { try same($0, job) }
        try FleetProtocol.require(operation == "create" ? isPending : isPending || matching.count == 1, "backup-job-unowned", "This backup isn't part of the current schedule.")
        if operation != "remove" { return nil }
        guard let latest = value["lastSuccess"] as? [String: Any], let settings = value["settings"] as? [String: Any] else { throw FleetFailure("backup-retention", "The latest backup isn't confirmed, so older backups were kept.") }
        try FleetProtocol.require(matching.count == 1 && !isPending && FleetProtocol.text(matching[0], "status") == "verified" && FleetProtocol.text(latest, "id") != FleetProtocol.text(job, "id")
            && FleetProtocol.text(latest, "scheduleId") == FleetProtocol.text(job, "scheduleId") && FleetProtocol.text(latest, "destinationId") == FleetProtocol.text(job, "destinationId")
            && FleetProtocol.text(settings, "scheduleId") == FleetProtocol.text(job, "scheduleId") && FleetProtocol.text(settings, "destinationId") == FleetProtocol.text(job, "destinationId"), "backup-retention", "This backup doesn't meet the cleanup rules, so it was kept.")
        return try self.job(latest)
    }
    private func owned(_ job: [String: Any]) throws -> [String: Any]? {
        guard let saved = try metadata("backup-file", FleetProtocol.text(job, "id")), let previous = saved["job"] as? [String: Any] else { return nil }
        try FleetProtocol.require(same(previous, job), "backup-file-unowned", "The backup's file record doesn't match."); return saved
    }
    private func verified(_ descriptor: Int32, _ job: [String: Any], _ identity: [String: Any]?) throws -> Data {
        guard let identity, let bytes = try read(descriptor, FleetProtocol.text(job, "name"), identity) else { throw FleetFailure("backup-unconfirmed", "The backup file isn't confirmed, so older backups were kept.") }
        try FleetProtocol.require(bytes.count == FleetProtocol.number(job, "size") && FleetProtocol.digest(bytes) == FleetProtocol.text(job, "sha256"), "backup-unconfirmed", "The backup's contents changed, so it wasn't cleaned up."); return bytes
    }
    func invoke(_ method: String, _ args: [String: Any], isolation: isolated FleetService, upload: () throws -> Data, download: (Data?) throws -> Any) async throws -> Any {
        if args["profileId"] != nil { try FleetProtocol.require(FleetProtocol.text(args, "profileId") == database.profile, "backup-profile", "The account changed since this backup started.") }
        switch method {
        case "backup.choose", "backup.manual.choose":
            let selected = try await choose(); let id = try grant(selected)
            if method == "backup.choose" { return ["destinationId": id, "destinationName": selected.lastPathComponent] }
            let token = FleetProtocol.uuid(); manual[token] = id; return ["destinationId": token, "name": "work-fleet-backup-\(token).zip"]
        case "backup.authorize": return try directory(FleetProtocol.text(args, "destinationId")) { _ in NSNull() }
        case "backup.manual.save":
            let token = try FleetProtocol.text(args, "destinationId"); guard let id = manual.removeValue(forKey: token) else { throw FleetFailure("backup-permission", "Choose the backup location again.") }
            let bytes = try upload(); try directory(id) { try create($0, "work-fleet-backup-\(token).zip", bytes) { _ in } }; return ["saved": true, "receipt": FleetProtocol.uuid()]
        case "backup.create":
            let job = try self.job(args); _ = try journal(job, "create"); let bytes = try upload()
            try FleetProtocol.require(bytes.count == FleetProtocol.number(job, "size") && FleetProtocol.digest(bytes) == FleetProtocol.text(job, "sha256"), "backup-integrity", "The backup contents don't match the backup job.")
            try directory(FleetProtocol.text(job, "destinationId")) { descriptor in
                if let previous = try owned(job) { _ = try verified(descriptor, job, previous) }
                else { try create(descriptor, FleetProtocol.text(job, "name"), bytes) { identity in var saved = identity; saved["job"] = job; try save("backup-file", FleetProtocol.text(job, "id"), saved) } }
            }
            return ["saved": true, "receipt": try FleetProtocol.text(job, "id")]
        case "backup.read":
            let job = try self.job(args); _ = try journal(job, "read")
            return try directory(FleetProtocol.text(job, "destinationId")) { descriptor in
                if let identity = try owned(job) { return try download(verified(descriptor, job, identity)) }
                try FleetProtocol.require(read(descriptor, FleetProtocol.text(job, "name")) == nil, "backup-file-unowned", "A file with this name has no record of being created here, so it was kept."); return NSNull()
            }
        case "backup.remove":
            let job = try self.job(args); guard let latest = try journal(job, "remove"), let identity = try owned(job) else { throw FleetFailure("backup-file-unowned", "This backup doesn't belong to the current schedule.") }
            try directory(FleetProtocol.text(latest, "destinationId")) { newest in
                _ = try verified(newest, latest, owned(latest))
                try directory(FleetProtocol.text(job, "destinationId")) { descriptor in
                    _ = try verified(descriptor, job, identity)
                    try FleetProtocol.require(unlinkat(descriptor, FleetProtocol.text(job, "name"), 0) == 0 && fsync(descriptor) == 0, "backup-permission", "The backup cleanup didn't finish.")
                }
            }
            try database.forget("backup-file", FleetProtocol.text(job, "id")); return ["removed": true]
        case "backup.key.create":
            let password = try FleetProtocol.text(args, "password", 1024); try FleetProtocol.require(password.unicodeScalars.count >= 12, "backup-password", "The backup password needs at least 12 characters.")
            let id = FleetProtocol.uuid(); try database.secret("backup-key", id, Data(password.utf8)); return ["keyId": id]
        case "backup.encrypt":
            guard let password = try database.secret("backup-key", FleetProtocol.text(args, "keyId")) else { throw FleetFailure("backup-key-unavailable", "The backup key is missing. Nothing was saved unencrypted.") }
            return try download(FleetBackupEncryption.encrypt(upload(), password))
        default: throw FleetFailure("unsupported-method", "The backup host does not support this operation.")
        }
    }
}
enum FleetBackupEncryption {
    private static func random(_ count: Int) -> Data { Data((0..<count).map { _ in UInt8.random(in: .min ... .max) }) }
    private static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
    static func encrypt(_ plaintext: Data, _ password: Data) throws -> Data {
        try FleetProtocol.require(!plaintext.isEmpty && plaintext.count <= 136 * 1024 * 1024, "backup-limit", "The backup is over the size limit.")
        let salt = random(16), nonce = random(12)
        let aad = Data("{\"cipher\":\"AES-256-GCM\",\"format\":\"work-fleet-encrypted-backup\",\"iterations\":600000,\"kdf\":\"PBKDF2-HMAC-SHA256\",\"nonce\":\"\(hex(nonce))\",\"salt\":\"\(hex(salt))\",\"schemaVersion\":1,\"tagBits\":128}".utf8)
        var derived = [UInt8](repeating: 0, count: 32)
        let status = password.withUnsafeBytes { passwordBuffer in salt.withUnsafeBytes { saltBuffer in
            CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), passwordBuffer.bindMemory(to: Int8.self).baseAddress, password.count, saltBuffer.bindMemory(to: UInt8.self).baseAddress, salt.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 600000, &derived, 32)
        } }
        defer { for index in derived.indices { derived[index] = 0 } }
        try FleetProtocol.require(status == kCCSuccess, "backup-vault-unavailable", "Couldn't derive the backup key.")
        let sealed = try AES.GCM.seal(plaintext, using: SymmetricKey(data: derived), nonce: AES.GCM.Nonce(data: nonce), authenticating: aad)
        let result = zip([("encryption.json", aad), ("payload.bin", sealed.ciphertext + sealed.tag)])
        try FleetProtocol.require(result.count <= FleetProtocol.backup, "backup-limit", "The encrypted backup is over the size limit."); return result
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
