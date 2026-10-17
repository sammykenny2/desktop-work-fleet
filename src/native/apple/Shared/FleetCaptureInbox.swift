#if os(iOS)
import Foundation
import CryptoKit
import Security
import Darwin

struct FleetCaptureAttachment { let bytes: Data, name: String, type: String }
actor FleetCaptureInbox {
    private let root: URL, group: String
    static let textLimit = 256 * 1024, metadataLimit = 2 * 1024 * 1024
    init() throws {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "FleetCaptureAppGroup") as? String,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { throw FleetFailure("capture-unavailable", "The Share inbox can't be opened right now. Notes can still be saved.") }
        self.group = group; root = container.appendingPathComponent("CaptureInbox", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
    }
    private func locked<T>(_ work: () throws -> T) throws -> T {
        let descriptor = Darwin.open(root.appendingPathComponent(".lock").path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        try FleetProtocol.require(descriptor >= 0, "capture-unavailable", "The Share inbox is in use. Try again.")
        defer { Darwin.close(descriptor) }
        try FleetProtocol.require(flock(descriptor, LOCK_EX) == 0, "capture-unavailable", "The Share inbox is in use. Try again.")
        defer { flock(descriptor, LOCK_UN) }; return try work()
    }
    private func key() throws -> SymmetricKey {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: group + ".capture.v1",
            kSecAttrAccount as String: "key", kSecAttrAccessGroup as String: group, kSecUseDataProtectionKeychain as String: true]
        var read = query; read[kSecReturnData as String] = true; read[kSecMatchLimit as String] = kSecMatchLimitOne
        var found: CFTypeRef?; let status = SecItemCopyMatching(read as CFDictionary, &found)
        if status == errSecSuccess, let data = found as? Data, data.count == 32 { return SymmetricKey(data: data) }
        try FleetProtocol.require(status == errSecItemNotFound, "capture-unavailable", "Couldn't read the Share inbox key. Unlock the device and try again.")
        let folders = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        try FleetProtocol.require(!folders.contains { FleetProtocol.isUUID($0.lastPathComponent) }, "capture-unavailable", "The Share inbox key is missing. The shared content is kept.")
        var bytes = Data(count: 32); let random = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        try FleetProtocol.require(random == errSecSuccess, "capture-unavailable", "Couldn't create the Share inbox key.")
        var add = query; add[kSecValueData as String] = bytes; add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        try FleetProtocol.require(SecItemAdd(add as CFDictionary, nil) == errSecSuccess, "capture-unavailable", "Couldn't save the Share inbox key.")
        return SymmetricKey(data: bytes)
    }
    private func folder(_ id: String) throws -> URL { try FleetProtocol.require(FleetProtocol.isUUID(id), "capture-id", "The shared item ID isn't valid."); return root.appendingPathComponent(id, isDirectory: true) }
    private func read(_ url: URL, maximum: Int) throws -> Data {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        try FleetProtocol.require(values.isRegularFile == true && values.isSymbolicLink != true && (values.fileSize ?? maximum + 1) <= maximum, "capture-damaged", "The shared content's size or format isn't valid.")
        let bytes = try Data(contentsOf: url); try FleetProtocol.require(bytes.count <= maximum, "capture-damaged", "The shared content is over the size limit."); return bytes
    }
    private func open(_ bytes: Data, scope: String) throws -> Data { try AES.GCM.open(AES.GCM.SealedBox(combined: bytes), using: key(), authenticating: Data((group + ":" + scope).utf8)) }
    private func save(_ bytes: Data, to url: URL, scope: String) throws {
        guard let data = try AES.GCM.seal(bytes, using: key(), authenticating: Data((group + ":" + scope).utf8)).combined else { throw FleetFailure("capture-unavailable", "Couldn't save the shared content.") }
        try data.write(to: url, options: [.atomic, .completeFileProtection]); let handle = try FileHandle(forWritingTo: url); defer { try? handle.close() }; try handle.synchronize()
    }
    private func metadata(_ id: String) throws -> [String: Any] {
        let encoded = try read(folder(id).appendingPathComponent("item"), maximum: Self.metadataLimit + 28)
        var item = try FleetProtocol.json(open(encoded, scope: id + ":item"))
        try FleetProtocol.require(try FleetProtocol.number(item, "v", 1) == 1 && FleetProtocol.text(item, "id") == id, "capture-damaged", "The shared content's version or ID isn't valid.")
        item["receipt"] = FleetProtocol.digest(encoded); return item
    }
    /// Only the Share Extension offers content, and its sheet shows these refusals as they are, so they use the host table.
    func offer(text: String, files: [FleetCaptureAttachment]) throws {
        try Task.checkCancellation()
        try locked {
            try FleetProtocol.require(text.utf8.count <= Self.textLimit && files.count <= 16 && (!text.isEmpty || !files.isEmpty) && files.reduce(0, { $0 + $1.bytes.count }) <= FleetProtocol.attachment, "capture-capacity", FleetText.text("share.overLimit"))
            let folders = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])
            let captures = folders.filter { FleetProtocol.isUUID($0.lastPathComponent) }
            var total = 0
            for folder in captures { for file in try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.fileSizeKey]) { total += try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0 } }
            try FleetProtocol.require(captures.count < 64 && total + files.reduce(0, { $0 + $1.bytes.count }) + Self.metadataLimit < 512 * 1024 * 1024, "capture-capacity", FleetText.text("share.inboxFull"))
            _ = try key(); let id = FleetProtocol.uuid(), destination = try folder(id)
            try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: false, attributes: [.protectionKey: FileProtectionType.complete])
            do {
                var attachments: [[String: Any]] = []
                for file in files {
                    try Task.checkCancellation()
                    let fileId = FleetProtocol.uuid(); try save(file.bytes, to: destination.appendingPathComponent(fileId), scope: id + ":file:" + fileId)
                    attachments.append(["fileId": fileId, "id": FleetProtocol.digest(file.bytes), "name": String(file.name.prefix(180)), "type": String(file.type.prefix(160)), "size": file.bytes.count])
                }
                let item: [String: Any] = ["v": 1, "id": id, "text": text, "receivedAt": Int64(Date().timeIntervalSince1970 * 1000), "attachments": attachments]
                let bytes = try FleetProtocol.encode(item); try FleetProtocol.require(bytes.count <= Self.metadataLimit, "capture-capacity", FleetText.text("share.overLimit"))
                try Task.checkCancellation(); try save(bytes, to: destination.appendingPathComponent("item"), scope: id + ":item")
            } catch { try? FileManager.default.removeItem(at: destination); throw error }
        }
    }
    func invoke(_ method: String, _ args: [String: Any]) throws -> Any {
        try locked {
            if method == "capture.list" {
                let folders = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).filter { FleetProtocol.isUUID($0.lastPathComponent) && FileManager.default.fileExists(atPath: $0.appendingPathComponent("item").path) }
                try FleetProtocol.require(folders.count <= 64, "capture-capacity", "The Share inbox holds more items than supported.")
                return try folders.map { folder -> [String: Any] in
                    let id = folder.lastPathComponent
                    do { let item = try metadata(id); return ["id": id, "receipt": item["receipt"]!, "preview": String((item["text"] as? String ?? "").prefix(110)), "fileCount": (item["attachments"] as? [Any] ?? []).count, "receivedAt": item["receivedAt"]!] }
                    catch { return ["id": id, "receipt": FleetProtocol.digest(try read(folder.appendingPathComponent("item"), maximum: Self.metadataLimit + 28)), "preview": FleetText.text("share.damagedPreview"), "fileCount": 0, "receivedAt": 0, "damaged": true] }
                }
            }
            let id = try FleetProtocol.text(args, "id"), destination = try folder(id)
            if method == "capture.item" { return try FleetProtocol.encode(metadata(id)) }
            if method == "capture.attachment" {
                let fileId = try FleetProtocol.text(args, "fileId"); try FleetProtocol.require(FleetProtocol.isUUID(fileId), "capture-id", "The shared file ID isn't valid.")
                let item = try metadata(id)
                guard let expected = (item["attachments"] as? [[String: Any]])?.first(where: { $0["fileId"] as? String == fileId }) else { throw FleetFailure("capture-source", "The shared file doesn't belong to this item.") }
                let bytes = try open(read(destination.appendingPathComponent(fileId), maximum: FleetProtocol.attachment + 28), scope: id + ":file:" + fileId)
                try FleetProtocol.require(try FleetProtocol.number(expected, "size", Int64(FleetProtocol.attachment)) == bytes.count && FleetProtocol.text(expected, "id") == FleetProtocol.digest(bytes), "capture-damaged", "The shared file failed its checksum.")
                return bytes
            }
            if method == "capture.ack" {
                let file = destination.appendingPathComponent("item"); guard FileManager.default.fileExists(atPath: file.path) else { return NSNull() }
                try FleetProtocol.require(try FleetProtocol.text(args, "receipt") == FleetProtocol.digest(read(file, maximum: Self.metadataLimit + 28)), "capture-stale", "The shared content changed. Reopen the Share inbox.")
                try FileManager.default.removeItem(at: destination); return NSNull()
            }
            throw FleetFailure("unsupported-method", "The Share inbox does not support this operation.")
        }
    }
}
#endif
