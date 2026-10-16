import AppKit
import QuickLookThumbnailing

/// Materializes attachment copies in a private temporary directory. The renderer never supplies a path.
@MainActor final class FleetAttachmentFiles {
    private let root = FileManager.default.temporaryDirectory.appendingPathComponent("WorkFleet-attachments-" + UUID().uuidString, isDirectory: true)
    private var previews: [String: [String: Any]] = [:]
    private var copies: [URL] = []
    private var closed = false
    private var requests: [UUID: QLThumbnailGenerator.Request] = [:]
    private static let executable = Set(["exe", "com", "bat", "cmd", "ps1", "msi", "msp", "scr", "lnk", "url", "desktop", "sh", "app", "command", "vbs", "js", "jse", "wsf", "hta", "cpl", "pif", "vbe", "wsh", "py", "pyw", "rb", "pl", "jar", "jnlp", "webloc", "workflow", "action", "run", "deb", "rpm", "pkg", "dmg", "reg", "inf"])
    static func filename(_ name: String) throws -> String {
        try FleetProtocol.require(!name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && name.count <= 240, "invalid-attachment", "附件檔名無效。")
        let denied = CharacterSet(charactersIn: "\\/:*?\"<>|").union(.controlCharacters)
        var clean = String(String.UnicodeScalarView(name.unicodeScalars.map { denied.contains($0) ? "_" : $0 })).trimmingCharacters(in: CharacterSet(charactersIn: ". "))
        if clean.utf8.count > 180 {
            let ext = (clean as NSString).pathExtension
            let suffix = !ext.isEmpty && ext.utf8.count <= 32 ? "." + ext : ""
            var stem = String(clean.dropLast(suffix.count))
            while stem.utf8.count + suffix.utf8.count > 180 { stem.removeLast() }
            clean = stem + suffix
        }
        return clean.isEmpty ? "attachment.bin" : clean
    }
    func invoke(_ bytes: Data, name: String, open: Bool) async throws -> Any {
        try FleetProtocol.require(!closed, "native-closed", "附件工作階段已結束。")
        let name = try Self.filename(name), key = FleetProtocol.digest(bytes) + ":" + name
        try FleetProtocol.require(bytes.count <= FleetProtocol.attachment, "attachment-capacity", "附件超過容量上限。")
        if !open, let result = previews[key] { return result }
        try FleetProtocol.require(!open || !Self.executable.contains((name as NSString).pathExtension.lowercased()), "attachment-not-document", "此類檔案請先匯出，再自行選擇開啟方式。")
        let folder = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let file = folder.appendingPathComponent(name); try bytes.write(to: file, options: .atomic)
        if open {
            try FileManager.default.setAttributes([.posixPermissions: 0o400], ofItemAtPath: file.path)
            copies.append(folder)
            guard NSWorkspace.shared.open(file) else { throw FleetFailure("attachment-open", "無法開啟附件，請確認已安裝對應的應用程式。") }
            return ["opened": true]
        }
        defer { try? FileManager.default.removeItem(at: folder) }
        let request = QLThumbnailGenerator.Request(fileAt: file, size: NSSize(width: 128, height: 128), scale: 1, representationTypes: .all)
        let requestID = UUID(); requests[requestID] = request
        defer { requests.removeValue(forKey: requestID) }
        let image: NSImage? = await withCheckedContinuation { continuation in
            var completed = false
            let timer = Task { @MainActor in
                do { try await Task.sleep(for: .seconds(10)) } catch { return }
                guard !completed else { return }; completed = true
                QLThumbnailGenerator.shared.cancel(request); continuation.resume(returning: nil)
            }
            QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { thumbnail, _ in
                Task { @MainActor in
                    guard !completed else { return }; completed = true; timer.cancel()
                    continuation.resume(returning: thumbnail?.nsImage)
                }
            }
        }
        try FleetProtocol.require(!closed, "stale-session", "附件工作階段已結束。")
        let png = Self.png(image ?? NSWorkspace.shared.icon(forFile: file.path))
        let result: [String: Any] = ["available": true, "png": png.map { $0.base64EncodedString() } as Any? ?? NSNull()]
        if previews.count >= 64, let first = previews.keys.first { previews.removeValue(forKey: first) }; previews[key] = result
        return result
    }
    private static func png(_ image: NSImage) -> Data? {
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 128, pixelsHigh: 128, bitsPerSample: 8,
            samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
            let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return nil }
        NSGraphicsContext.saveGraphicsState(); defer { NSGraphicsContext.restoreGraphicsState() }; NSGraphicsContext.current = context
        let factor = min(128 / max(image.size.width, 1), 128 / max(image.size.height, 1))
        let size = NSSize(width: image.size.width * factor, height: image.size.height * factor)
        image.draw(in: NSRect(x: (128 - size.width) / 2, y: (128 - size.height) / 2, width: size.width, height: size.height))
        guard let data = bitmap.representation(using: .png, properties: [:]), data.count <= 256 * 1024 else { return nil }; return data
    }
    func close() {
        closed = true; for request in requests.values { QLThumbnailGenerator.shared.cancel(request) }; requests.removeAll()
        for folder in copies { try? FileManager.default.removeItem(at: folder) }; copies.removeAll(); previews.removeAll(); try? FileManager.default.removeItem(at: root)
    }
}
