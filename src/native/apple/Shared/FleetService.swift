import Foundation

actor FleetService {
    private struct Transfer {
        let kind: String, size: Int, digest: String
        var bytes: Data, used: Date
    }
    private let database: FleetDatabase
    private let backups: FleetBackup
    let google: FleetGoogle
    private let drive: FleetDrive
    private var transfers: [String: Transfer] = [:]
    private var staged = Set<String>()
    private var closed = false
    private(set) var ready = false, closeReady = false
    private let platform: String
    var desktop: (@MainActor (String, [String: Any]) async throws -> Any)?
    private var exports: (@MainActor (Data, String, String) async throws -> Any)?
    private var capture: ((String, [String: Any]) async throws -> Any)?
    /// ADR-043: startup settings and the main window, owned by the macOS app delegate on the main actor.
    private var shell: (@MainActor (String, [String: Any]) throws -> Any)?
    private var updates = false
    init(database: FleetDatabase, google: FleetGoogle, platform: String, choose: @escaping @MainActor () async throws -> URL) {
        self.database = database; self.google = google; self.platform = platform
        backups = FleetBackup(database: database, choose: choose); drive = FleetDrive(google: google, profile: database.profile)
    }
    func setDesktop(_ handler: @escaping @MainActor (String, [String: Any]) async throws -> Any) { desktop = handler }
    func setExports(_ handler: @escaping @MainActor (Data, String, String) async throws -> Any) { exports = handler }
    func setCapture(_ handler: @escaping (String, [String: Any]) async throws -> Any) { capture = handler }
    func setShell(_ handler: @escaping @MainActor (String, [String: Any]) throws -> Any) { shell = handler }
    func setUpdates(_ available: Bool) { updates = available }
    private func add(_ value: Transfer) throws -> String {
        try FleetProtocol.require(!closed && transfers.count < 8 && transfers.values.reduce(value.size, { $0 + $1.size }) <= 256 * 1024 * 1024, "transfer-busy", "原生傳輸忙碌。")
        let id = FleetProtocol.uuid(); transfers[id] = value; return id
    }
    private func transfer(_ id: String) throws -> Transfer {
        guard var value = transfers[id] else { throw FleetFailure("transfer-missing", "原生傳輸已失效。") }; value.used = Date(); transfers[id] = value; return value
    }
    private func owned(_ args: [String: Any]) throws -> String { let id = try FleetProtocol.text(args, "token"); try FleetProtocol.require(staged.contains(id), "transfer-missing", "原生傳輸不屬於此視窗。"); return id }
    private func download(_ bytes: Data?) throws -> Any {
        guard let bytes else { return NSNull() }; let digest = FleetProtocol.digest(bytes)
        let id = try add(Transfer(kind: "download", size: bytes.count, digest: digest, bytes: bytes, used: Date())); return ["token": id, "size": bytes.count, "sha256": digest]
    }
    func invoke(_ method: String, _ args: [String: Any]) async throws -> Any {
        try FleetProtocol.require(!closed, "native-closed", "原生工作階段已結束。")
        for (id, value) in transfers where Date().timeIntervalSince(value.used) > 300 { transfers.removeValue(forKey: id) }
        if method.hasPrefix("desktop."), let desktop { return try await desktop(method, args) }
        if method.hasPrefix("capture."), let capture {
            let result = try await capture(method, args); try FleetProtocol.require(!closed, "stale-session", "原生工作階段已結束。")
            if let bytes = result as? Data { return try download(bytes) }; return result
        }
        if method == "file.export", let exports {
            let bytes = try database.staged(owned(args), "backup")
            let result = try await exports(bytes, FleetProtocol.text(args, "name", 240), FleetProtocol.text(args, "action", 16))
            try FleetProtocol.require(!closed, "stale-session", "原生工作階段已結束。"); return result
        }
        if method.hasPrefix("backup.") { return try await backups.invoke(method, args, isolation: self, upload: { try self.database.staged(self.owned(args), "backup") }, download: { try self.download($0) }) }
        if method.hasPrefix("google.") {
            switch method {
            case "google.status": return await google.status()
            case "google.signIn": return try await google.signIn()
            case "google.open": return ["profileId": try await google.open(FleetProtocol.text(args, "accountId"))]
            case "google.signOut": try await google.signOut(); return ["profileId": "local"]
            case "google.local": return ["profileId": "local"]
            default:
                let bytes = method == "google.create" ? try database.staged(owned(args), "attachment") : nil
                let result = try await drive.invoke(method, args, bytes: bytes)
                try FleetProtocol.require(!closed, "stale-session", "Google 工作階段已結束。")
                if let data = result as? Data { return try download(data) }; return result
            }
        }
        if ["host.preferences.get", "host.preferences.set", "host.preferences.openSystem", "host.window.resetPlacement",
            "update.state", "update.check", "update.download", "update.install"].contains(method) {
            guard let shell else { throw FleetFailure("unsupported-method", "原生主機沒有此操作。") }
            return try await shell(method, args)
        }
        switch method {
        case "host.info":
            return ["protocol": 1, "platform": platform, "profileId": database.profile, "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0",
                "distribution": "app", "storage": "sqlite-keychain", "maxChunkBytes": FleetProtocol.chunk,
                "maxMessageBytes": 1024 * 1024, "maxRecordBytes": FleetProtocol.record, "maxAttachmentBytes": FleetProtocol.attachment, "maxBackupBytes": FleetProtocol.backup,
                "capabilities": ["nativeStorage": true, "schemaMigration": true, "automaticFiles": true, "backupFiles": true, "secureBackup": true, "google": await google.available, "desktopPresentation": desktop != nil, "fileExport": exports != nil, "fileShare": exports != nil && platform == "ios", "shareInbox": capture != nil,
                                 "hostPreferences": shell != nil, "updates": updates]]
        case "host.ready": ready = true; return NSNull()
        case "host.closeReady": closeReady = true; return NSNull()
        case "host.closeCancel": closeReady = false; return NSNull()
        case "host.backgroundReady": try FleetProtocol.require(FleetProtocol.isUUID(FleetProtocol.text(args, "id")), "invalid-request", "背景保存身分無效。"); return NSNull()
        case "transfer.begin":
            let kind = try FleetProtocol.text(args, "kind"), digest = try FleetProtocol.text(args, "sha256")
            try FleetProtocol.require(["workspace", "journal", "backup", "attachment"].contains(kind) && FleetProtocol.isDigest(digest), "invalid-transfer", "傳輸種類或校驗值無效。")
            let maximum = kind == "backup" ? FleetProtocol.backup : kind == "attachment" ? FleetProtocol.attachment : FleetProtocol.record
            let size = Int(try FleetProtocol.number(args, "size", Int64(maximum)))
            return ["token": try add(Transfer(kind: kind, size: size, digest: digest, bytes: Data(), used: Date()))]
        case "transfer.append":
            let id = try FleetProtocol.text(args, "token"); var value = try transfer(id)
            guard let bytes = Data(base64Encoded: try FleetProtocol.text(args, "base64", FleetProtocol.chunk * 4 / 3 + 4)), !bytes.isEmpty else { throw FleetFailure("invalid-transfer", "傳輸分片無效。") }
            try FleetProtocol.require(value.kind != "download" && FleetProtocol.number(args, "offset", Int64(FleetProtocol.backup)) == value.bytes.count && bytes.count <= FleetProtocol.chunk && value.bytes.count + bytes.count <= value.size, "transfer-offset", "傳輸順序或容量不符。")
            value.bytes.append(bytes); transfers[id] = value; return ["offset": value.bytes.count]
        case "transfer.finish":
            let id = try FleetProtocol.text(args, "token"), value = try transfer(id)
            try FleetProtocol.require(value.kind != "download" && value.bytes.count == value.size, "transfer-incomplete", "傳輸尚未完整。")
            let sealed = try database.stage(value.kind, value.bytes, value.digest); staged.insert(sealed); transfers.removeValue(forKey: id); return ["token": sealed]
        case "transfer.discard":
            let id = try FleetProtocol.text(args, "token"); transfers.removeValue(forKey: id); if staged.remove(id) != nil { try database.discard(id) }; return NSNull()
        case "transfer.read":
            let value = try transfer(FleetProtocol.text(args, "token")), offset = Int(try FleetProtocol.number(args, "offset", Int64(FleetProtocol.backup)))
            try FleetProtocol.require(value.kind == "download" && offset <= value.size, "invalid-transfer", "下載位置無效。")
            let end = min(value.size, offset + FleetProtocol.chunk); return ["offset": offset, "base64": value.bytes.subdata(in: offset..<end).base64EncodedString(), "done": end == value.size]
        case "storage.reset":
            transfers.removeAll(); staged.removeAll(); try database.reset(); return ["profileId": database.profile]
        case "storage.load": return try download(database.record(FleetProtocol.text(args, "kind")))
        case "storage.recovery": return try download(database.recovery(FleetProtocol.text(args, "kind"), FleetProtocol.number(args, "fromVersion")))
        case "storage.attachment": return try download(database.attachment(FleetProtocol.text(args, "id")))
        case "storage.putAttachment":
            let id = try owned(args), digest = try database.putAttachment(id); staged.remove(id); return ["id": digest]
        case "storage.commit":
            let id = try owned(args), attachments = args["attachments"] as? [String] ?? []
            try FleetProtocol.require(args["expectedRevision"] != nil && attachments.allSatisfy({ staged.contains($0) }), "invalid-request", "提交條件或附件身分無效。")
            let expected = args["expectedRevision"] is NSNull ? nil : try FleetProtocol.number(args, "expectedRevision")
            let replaceAttachments = args["replaceAttachments"] == nil ? false : try FleetProtocol.bool(args, "replaceAttachments")
            let migrationFrom = args["migrationFrom"] == nil ? nil : try FleetProtocol.number(args, "migrationFrom")
            try database.commit(FleetProtocol.text(args, "kind"), id, expected, attachments, replaceAttachments: replaceAttachments, migrationFrom: migrationFrom); staged.remove(id); for id in attachments { staged.remove(id) }; return NSNull()
        default: throw FleetFailure("unsupported-method", "原生主機沒有此操作。")
        }
    }
    func close() async {
        if closed { return }; closed = true; await drive.close(); await google.close()
        for id in staged { try? database.discard(id) }; staged.removeAll(); transfers.removeAll(); database.close()
    }
}
