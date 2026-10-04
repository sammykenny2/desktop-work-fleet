import UIKit
import UniformTypeIdentifiers

@MainActor final class ShareViewController: UIViewController {
    private let note = UITextView(), message = UILabel(), save = UIButton(type: .system)
    private var working: Task<Void, Never>?
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .systemBackground
        let title = UILabel(); title.text = "分享至 Work Fleet"; title.font = .preferredFont(forTextStyle: .title2)
        message.text = "內容先保存至分享收件匣，開啟 App 後選擇群組接收。"; message.numberOfLines = 0
        note.font = .preferredFont(forTextStyle: .body); note.layer.borderWidth = 1; note.layer.borderColor = UIColor.separator.cgColor; note.heightAnchor.constraint(equalToConstant: 120).isActive = true
        save.setTitle("保存到收件匣", for: .normal); save.addTarget(self, action: #selector(receive), for: .touchUpInside)
        let cancel = UIButton(type: .system); cancel.setTitle("取消", for: .normal); cancel.addTarget(self, action: #selector(close), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [title, message, note, save, cancel]); stack.axis = .vertical; stack.spacing = 16; stack.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(stack)
        NSLayoutConstraint.activate([stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20), stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20), stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20)])
    }
    @objc private func close() { working?.cancel(); extensionContext?.cancelRequest(withError: NSError(domain: "WorkFleet", code: 1, userInfo: [NSLocalizedDescriptionKey: "已取消分享。"])); }
    private func item(_ provider: NSItemProvider, type: String) async throws -> NSSecureCoding? {
        try await withCheckedThrowingContinuation { continuation in provider.loadItem(forTypeIdentifier: type, options: nil) { value, error in if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: value) } } }
    }
    nonisolated private static func readFile(_ url: URL, name: String?, type: String?, maximum: Int) throws -> FleetCaptureAttachment {
        try FleetProtocol.require(url.isFileURL, "capture-source", "分享檔案位置無效。")
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        try FleetProtocol.require(values.isRegularFile == true && (values.fileSize ?? maximum + 1) <= maximum, "capture-capacity", "分享檔案總容量超過 25 MiB 或格式不支援。")
        let stream = try FileHandle(forReadingFrom: url); defer { try? stream.close() }; var bytes = Data()
        while let chunk = try stream.read(upToCount: min(65536, maximum - bytes.count + 1)), !chunk.isEmpty {
            try FleetProtocol.require(bytes.count + chunk.count <= maximum, "capture-capacity", "分享檔案總容量超過 25 MiB。")
            bytes.append(chunk)
        }
        let filename = name ?? url.lastPathComponent, mime = type.flatMap { UTType($0)?.preferredMIMEType } ?? UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        return FleetCaptureAttachment(bytes: bytes, name: filename.isEmpty ? "shared-file" : filename, type: mime)
    }
    private func fileURL(_ provider: NSItemProvider, maximum: Int) async throws -> FleetCaptureAttachment {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { value, error in
                do {
                    if let error { throw error }; guard let url = value as? URL else { throw FleetFailure("capture-source", "無法讀取分享檔案。") }
                    continuation.resume(returning: try Self.readFile(url, name: provider.suggestedName, type: nil, maximum: maximum))
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
    private func file(_ provider: NSItemProvider, type: String, maximum: Int) async throws -> FleetCaptureAttachment {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
                do {
                    if let error { throw error }; guard let url else { throw FleetFailure("capture-source", "無法讀取分享檔案。") }
                    continuation.resume(returning: try Self.readFile(url, name: provider.suggestedName, type: type, maximum: maximum))
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
    @objc private func receive() {
        guard working == nil else { return }; save.isEnabled = false; note.isEditable = false; message.text = "正在保存分享內容…"
        let addition = note.text ?? "", items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        working = Task {
            do {
                let inbox = try FleetCaptureInbox(); var texts: [String] = addition.isEmpty ? [] : [addition], files: [FleetCaptureAttachment] = []
                for item in items {
                    for value in [item.attributedTitle?.string, item.attributedContentText?.string].compactMap({ $0 }) where !value.isEmpty && !texts.contains(value) { texts.append(value) }
                }
                let providers = items.flatMap { $0.attachments ?? [] }; try FleetProtocol.require(providers.count <= 16, "capture-capacity", "一次最多分享 16 個項目。")
                var total = 0
                for provider in providers {
                    try Task.checkCancellation()
                    if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                        let value = try await item(provider, type: UTType.plainText.identifier)
                        if let text = value as? String { if !texts.contains(text) { texts.append(text) } }
                        else if let data = value as? Data, let text = String(data: data, encoding: .utf8) { if !texts.contains(text) { texts.append(text) } }
                        else { throw FleetFailure("capture-source", "無法讀取分享文字。") }
                    } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                        let attachment = try await fileURL(provider, maximum: FleetProtocol.attachment - total); total += attachment.bytes.count; files.append(attachment)
                    } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                        guard let url = try await item(provider, type: UTType.url.identifier) as? URL, ["http", "https"].contains(url.scheme ?? "") else { throw FleetFailure("capture-source", "分享網址格式不支援。") }; if !texts.contains(url.absoluteString) { texts.append(url.absoluteString) }
                    } else {
                        guard let type = provider.registeredTypeIdentifiers.first(where: { $0 != UTType.fileURL.identifier && UTType($0)?.conforms(to: .data) == true }) else { throw FleetFailure("capture-source", "此分享內容格式不支援。") }
                        let attachment = try await file(provider, type: type, maximum: FleetProtocol.attachment - total); total += attachment.bytes.count; files.append(attachment)
                    }
                    try FleetProtocol.require(texts.reduce(0, { $0 + $1.utf8.count }) <= FleetCaptureInbox.textLimit, "capture-capacity", "分享文字超過 256 KiB。")
                }
                try Task.checkCancellation(); try await inbox.offer(text: texts.joined(separator: "\n\n"), files: files); try Task.checkCancellation()
                extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
            } catch {
                guard !Task.isCancelled else { return }; working = nil; save.isEnabled = true; note.isEditable = true
                message.text = (error as? FleetFailure)?.message ?? "分享內容尚未保存，請保留原檔後重試。"
            }
        }
    }
}
