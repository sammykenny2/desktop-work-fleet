import Foundation

actor PinItAnywhereService {
    private struct Transfer {
        let kind: String, size: Int, digest: String
        var bytes: Data, used: Date
    }
    private let database: PinItAnywhereDatabase
    private let backups: PinItAnywhereBackup
    let google: PinItAnywhereGoogle
    private let drive: PinItAnywhereDrive
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
    private var attachmentFiles: (@MainActor (Data, String, Bool) async throws -> Any)?
    /// Stores the display-language preference: macOS beside its startup settings, iOS in user defaults (docs/i18n.md).
    private var language: (@MainActor (String) throws -> Void)?
    /// Answers requests naming another profile (ADR-066), with its own transfers and staged data on its own view of the database.
    private var companion: PinItAnywhereService?, companionProfile: String?
    private var ownsGoogle = true
    private static let companionMethods = ["storage.", "transfer.", "backup.", "attachment.", "file."]
    init(database: PinItAnywhereDatabase, google: PinItAnywhereGoogle, platform: String, choose: @escaping @MainActor () async throws -> URL) {
        self.database = database; self.google = google; self.platform = platform
        backups = PinItAnywhereBackup(database: database, choose: choose); drive = PinItAnywhereDrive(google: google, profile: database.profile)
    }
    func setDesktop(_ handler: @escaping @MainActor (String, [String: Any]) async throws -> Any) { desktop = handler }
    func setExports(_ handler: @escaping @MainActor (Data, String, String) async throws -> Any) { exports = handler }
    func setCapture(_ handler: @escaping (String, [String: Any]) async throws -> Any) { capture = handler }
    func setShell(_ handler: @escaping @MainActor (String, [String: Any]) throws -> Any) { shell = handler }
    func setUpdates(_ available: Bool) { updates = available }
    func setAttachmentFiles(_ handler: @escaping @MainActor (Data, String, Bool) async throws -> Any) { attachmentFiles = handler }
    func setLanguage(_ handler: @escaping @MainActor (String) throws -> Void) { language = handler }
    func setCompanion(_ service: PinItAnywhereService, profile: String) async {
        companion = service; companionProfile = profile
        await service.adopt(attachmentFiles: attachmentFiles, exports: exports)
    }
    private func adopt(attachmentFiles: (@MainActor (Data, String, Bool) async throws -> Any)?, exports: (@MainActor (Data, String, String) async throws -> Any)?) {
        self.attachmentFiles = attachmentFiles; self.exports = exports; ownsGoogle = false
    }
    #if DEBUG
    func readOnlyDriveProbe() async -> [String: Any] { await drive.readOnlyProbe() }
    #endif
    private func add(_ value: Transfer) throws -> String {
        try PinItAnywhereProtocol.require(!closed && transfers.count < 8 && transfers.values.reduce(value.size, { $0 + $1.size }) <= 256 * 1024 * 1024, "transfer-busy", "Native transfers are busy.")
        let id = PinItAnywhereProtocol.uuid(); transfers[id] = value; return id
    }
    private func transfer(_ id: String) throws -> Transfer {
        guard var value = transfers[id] else { throw PinItAnywhereFailure("transfer-missing", "The native transfer has expired.") }; value.used = Date(); transfers[id] = value; return value
    }
    private func owned(_ args: [String: Any]) throws -> String { let id = try PinItAnywhereProtocol.text(args, "token"); try PinItAnywhereProtocol.require(staged.contains(id), "transfer-missing", "The native transfer belongs to another window."); return id }
    private func download(_ bytes: Data?) throws -> Any {
        guard let bytes else { return NSNull() }; let digest = PinItAnywhereProtocol.digest(bytes)
        let id = try add(Transfer(kind: "download", size: bytes.count, digest: digest, bytes: bytes, used: Date())); return ["token": id, "size": bytes.count, "sha256": digest]
    }
    func invoke(_ method: String, _ args: [String: Any]) async throws -> Any {
        try PinItAnywhereProtocol.require(!closed, "native-closed", "The native session has ended.")
        if let named = args["profile"], named as? String != database.profile {
            // A request naming data this session does not hold is refused rather than answered from the wrong profile.
            guard let companion, named as? String == companionProfile, Self.companionMethods.contains(where: { method.hasPrefix($0) }) else {
                throw PinItAnywhereFailure("invalid-profile", "This request names data that isn't open.")
            }
            return try await companion.invoke(method, args)
        }
        for (id, value) in transfers where Date().timeIntervalSince(value.used) > 300 { transfers.removeValue(forKey: id) }
        if method.hasPrefix("desktop."), let desktop { return try await desktop(method, args) }
        if ["attachment.preview", "attachment.open"].contains(method) {
            guard let attachmentFiles else { throw PinItAnywhereFailure("unsupported-method", "This platform can't open attachments yet.") }
            guard let bytes = try database.attachment(PinItAnywhereProtocol.text(args, "id")) else {
                try PinItAnywhereProtocol.require(method != "attachment.open", "missing-attachment", "The attachment hasn't been downloaded. Finish syncing first.")
                return ["available": false, "png": NSNull()] as [String: Any]
            }
            let result = try await attachmentFiles(bytes, PinItAnywhereProtocol.text(args, "name", 240), method == "attachment.open")
            try PinItAnywhereProtocol.require(!closed, "stale-session", "The native session has ended."); return result
        }
        if method.hasPrefix("capture."), let capture {
            let result = try await capture(method, args); try PinItAnywhereProtocol.require(!closed, "stale-session", "The native session has ended.")
            if let bytes = result as? Data { return try download(bytes) }; return result
        }
        if method == "file.export", let exports {
            let bytes = try database.staged(owned(args), "backup")
            let result = try await exports(bytes, PinItAnywhereProtocol.text(args, "name", 240), PinItAnywhereProtocol.text(args, "action", 16))
            try PinItAnywhereProtocol.require(!closed, "stale-session", "The native session has ended."); return result
        }
        if method.hasPrefix("backup.") { return try await backups.invoke(method, args, isolation: self, upload: { try self.database.staged(self.owned(args), "backup") }, download: { try self.download($0) }) }
        if method.hasPrefix("google.") {
            switch method {
            case "google.status": return await google.status()
            case "google.signIn": return try await google.signIn()
            case "google.open": return ["profileId": try await google.open(PinItAnywhereProtocol.text(args, "accountId"))]
            case "google.signOut": try await google.signOut(); return ["profileId": "local"]
            case "google.local": return ["profileId": "local"]
            default:
                let bytes = ["google.create", "google.dataset.create"].contains(method) ? try database.staged(owned(args), "attachment") : nil
                let result = try await drive.invoke(method, args, bytes: bytes)
                try PinItAnywhereProtocol.require(!closed, "stale-session", "The Google session has ended.")
                if let data = result as? Data { return try download(data) }; return result
            }
        }
        // SPEC-006 DO: the folder of data the page couldn't read; the host reopens the page on empty data after a set-aside.
        if method == "data.location" { return ["path": database.directory.path] }
        if method == "data.setAside" { return ["profileId": database.profile] }
        if method == "data.reveal" {
            guard let shell else { throw PinItAnywhereFailure("unsupported-method", "The native host does not support this operation.") }
            return try await shell(method, ["path": database.directory.path])
        }
        if ["host.preferences.get", "host.preferences.set", "host.preferences.openSystem", "host.window.resetPlacement",
            "update.state", "update.check", "update.download", "update.install"].contains(method) {
            guard let shell else { throw PinItAnywhereFailure("unsupported-method", "The native host does not support this operation.") }
            return try await shell(method, args)
        }
        switch method {
        case "host.info":
            return ["protocol": 1, "platform": platform, "profileId": database.profile, "companionProfile": companionProfile.map { $0 as Any } ?? NSNull(), "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0",
                "distribution": platform == "ios" ? "ios" : "app", "storage": "sqlite-keychain", "maxChunkBytes": PinItAnywhereProtocol.chunk,
                "maxMessageBytes": 1024 * 1024, "maxRecordBytes": PinItAnywhereProtocol.record, "maxAttachmentBytes": PinItAnywhereProtocol.attachment, "maxBackupBytes": PinItAnywhereProtocol.backup,
                "capabilities": ["nativeStorage": true, "recordStorage": true, "automaticFiles": true, "backupFiles": true, "secureBackup": true, "google": await google.available, "desktopPresentation": desktop != nil, "fileExport": exports != nil, "fileShare": exports != nil && platform == "ios", "shareInbox": capture != nil,
                                 "hostPreferences": shell != nil, "updates": updates, "attachmentFiles": attachmentFiles != nil, "languagePreference": language != nil,
                                 "dataRecovery": platform == "macos" && shell != nil],
                "language": PinItAnywhereText.describe()]
        case "host.language.set":
            guard let language else { throw PinItAnywhereFailure("unsupported-method", "The native host does not support this operation.") }
            let preference = try PinItAnywhereProtocol.text(args, "preference", 16)
            try PinItAnywhereProtocol.require(PinItAnywhereText.preferences.contains(preference), "invalid-request", "The display language must be auto, en or zh-TW.")
            try await language(preference); return PinItAnywhereText.describe()
        case "host.ready": ready = true; return NSNull()
        case "host.closeReady": closeReady = true; return NSNull()
        case "host.closeCancel": closeReady = false; return NSNull()
        case "host.backgroundReady": try PinItAnywhereProtocol.require(PinItAnywhereProtocol.isUUID(PinItAnywhereProtocol.text(args, "id")), "invalid-request", "The background save ID isn't valid."); return NSNull()
        case "transfer.begin":
            let kind = try PinItAnywhereProtocol.text(args, "kind"), digest = try PinItAnywhereProtocol.text(args, "sha256")
            try PinItAnywhereProtocol.require(["workspace", "journal", "backup", "attachment"].contains(kind) && PinItAnywhereProtocol.isDigest(digest), "invalid-transfer", "The transfer kind or checksum isn't valid.")
            let maximum = kind == "backup" ? PinItAnywhereProtocol.backup : kind == "attachment" ? PinItAnywhereProtocol.attachment : PinItAnywhereProtocol.record
            let size = Int(try PinItAnywhereProtocol.number(args, "size", Int64(maximum)))
            return ["token": try add(Transfer(kind: kind, size: size, digest: digest, bytes: Data(), used: Date()))]
        case "transfer.append":
            let id = try PinItAnywhereProtocol.text(args, "token"); var value = try transfer(id)
            guard let bytes = Data(base64Encoded: try PinItAnywhereProtocol.text(args, "base64", PinItAnywhereProtocol.chunk * 4 / 3 + 4)), !bytes.isEmpty else { throw PinItAnywhereFailure("invalid-transfer", "The transfer chunk isn't valid.") }
            try PinItAnywhereProtocol.require(value.kind != "download" && PinItAnywhereProtocol.number(args, "offset", Int64(PinItAnywhereProtocol.backup)) == value.bytes.count && bytes.count <= PinItAnywhereProtocol.chunk && value.bytes.count + bytes.count <= value.size, "transfer-offset", "The transfer order or size doesn't match.")
            value.bytes.append(bytes); transfers[id] = value; return ["offset": value.bytes.count]
        case "transfer.finish":
            let id = try PinItAnywhereProtocol.text(args, "token"), value = try transfer(id)
            try PinItAnywhereProtocol.require(value.kind != "download" && value.bytes.count == value.size, "transfer-incomplete", "The transfer isn't complete.")
            let sealed = try database.stage(value.kind, value.bytes, value.digest); staged.insert(sealed); transfers.removeValue(forKey: id); return ["token": sealed]
        case "transfer.discard":
            let id = try PinItAnywhereProtocol.text(args, "token"); transfers.removeValue(forKey: id); if staged.remove(id) != nil { try database.discard(id) }; return NSNull()
        case "transfer.read":
            let value = try transfer(PinItAnywhereProtocol.text(args, "token")), offset = Int(try PinItAnywhereProtocol.number(args, "offset", Int64(PinItAnywhereProtocol.backup)))
            try PinItAnywhereProtocol.require(value.kind == "download" && offset <= value.size, "invalid-transfer", "The download position isn't valid.")
            let end = min(value.size, offset + PinItAnywhereProtocol.chunk); return ["offset": offset, "base64": value.bytes.subdata(in: offset..<end).base64EncodedString(), "done": end == value.size]
        case "storage.reset":
            transfers.removeAll(); staged.removeAll(); try database.reset(); return ["profileId": database.profile]
        case "storage.load": return try download(database.record(PinItAnywhereProtocol.text(args, "kind")))
        case "storage.records.status":
            if let status = try database.recordStatus() { return status }; return NSNull()
        case "storage.records.get": return try download(database.recordEntry(PinItAnywhereProtocol.text(args, "collection"), PinItAnywhereProtocol.text(args, "key")))
        case "storage.records.page": return try download(database.recordPage(args))
        case "storage.attachment": return try download(database.attachment(PinItAnywhereProtocol.text(args, "id")))
        case "storage.putAttachment":
            let id = try owned(args), digest = try database.putAttachment(id); staged.remove(id); return ["id": digest]
        case "storage.commit", "storage.records.commit":
            let id = try owned(args), attachments = args["attachments"] as? [String] ?? []
            try PinItAnywhereProtocol.require(args["expectedRevision"] != nil && attachments.allSatisfy({ staged.contains($0) }), "invalid-request", "The commit conditions or attachment IDs aren't valid.")
            let expected = args["expectedRevision"] is NSNull ? nil : try PinItAnywhereProtocol.number(args, "expectedRevision")
            if method == "storage.records.commit" {
                let result = try database.commitRecords(id, expected, attachments); staged.remove(id); for id in attachments { staged.remove(id) }; return result
            }
            let replaceAttachments = args["replaceAttachments"] == nil ? false : try PinItAnywhereProtocol.bool(args, "replaceAttachments")
            try database.commit(PinItAnywhereProtocol.text(args, "kind"), id, expected, attachments, replaceAttachments: replaceAttachments); staged.remove(id); for id in attachments { staged.remove(id) }; return NSNull()
        default: throw PinItAnywhereFailure("unsupported-method", "The native host does not support this operation.")
        }
    }
    func close() async {
        if closed { return }; closed = true; await companion?.close(); await drive.close(); if ownsGoogle { await google.close() }
        for id in staged { try? database.discard(id) }; staged.removeAll(); transfers.removeAll(); database.close()
    }
}
