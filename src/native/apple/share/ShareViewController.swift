import UIKit
import UniformTypeIdentifiers

/// The sheet draws its own text from the host table in the app's display language. Failures this sheet raises carry
/// that text; they never reach the main window, which reads the inbox and sends its own English errors.
@MainActor final class ShareViewController: UIViewController {
    private let note = UITextView(), message = UILabel(), save = UIButton(type: .system)
    private var working: Task<Void, Never>?
    override func viewDidLoad() {
        super.viewDidLoad(); FleetText.apply(FleetText.storedPreference()); view.backgroundColor = .systemBackground
        let title = UILabel(); title.text = FleetText.text("share.title"); title.font = .preferredFont(forTextStyle: .title2)
        message.text = FleetText.text("share.hint"); message.numberOfLines = 0
        note.font = .preferredFont(forTextStyle: .body); note.layer.borderWidth = 1; note.layer.borderColor = UIColor.separator.cgColor; note.heightAnchor.constraint(equalToConstant: 120).isActive = true
        save.setTitle(FleetText.text("share.save"), for: .normal); save.addTarget(self, action: #selector(receive), for: .touchUpInside)
        let cancel = UIButton(type: .system); cancel.setTitle(FleetText.text("share.cancel"), for: .normal); cancel.addTarget(self, action: #selector(close), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [title, message, note, save, cancel]); stack.axis = .vertical; stack.spacing = 16; stack.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(stack)
        NSLayoutConstraint.activate([stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20), stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20), stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20)])
    }
    @objc private func close() { working?.cancel(); extensionContext?.cancelRequest(withError: NSError(domain: "WorkFleet", code: 1, userInfo: [NSLocalizedDescriptionKey: FleetText.text("share.cancelled")])); }
    private func item(_ provider: NSItemProvider, type: String) async throws -> NSSecureCoding? {
        try await withCheckedThrowingContinuation { continuation in provider.loadItem(forTypeIdentifier: type, options: nil) { value, error in if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: value) } } }
    }
    nonisolated private static func readFile(_ url: URL, name: String?, type: String?, maximum: Int) throws -> FleetCaptureAttachment {
        try FleetProtocol.require(url.isFileURL, "capture-source", FleetText.text("share.fileLocation"))
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        try FleetProtocol.require(values.isRegularFile == true && (values.fileSize ?? maximum + 1) <= maximum, "capture-capacity", FleetText.text("share.filesTooLargeOrUnsupported"))
        let stream = try FileHandle(forReadingFrom: url); defer { try? stream.close() }; var bytes = Data()
        while let chunk = try stream.read(upToCount: min(65536, maximum - bytes.count + 1)), !chunk.isEmpty {
            try FleetProtocol.require(bytes.count + chunk.count <= maximum, "capture-capacity", FleetText.text("share.filesTooLarge"))
            bytes.append(chunk)
        }
        let filename = name ?? url.lastPathComponent, mime = type.flatMap { UTType($0)?.preferredMIMEType } ?? UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        return FleetCaptureAttachment(bytes: bytes, name: filename.isEmpty ? "shared-file" : filename, type: mime)
    }
    private func fileURL(_ provider: NSItemProvider, maximum: Int) async throws -> FleetCaptureAttachment {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { value, error in
                do {
                    if let error { throw error }; guard let url = value as? URL else { throw FleetFailure("capture-source", FleetText.text("share.fileUnreadable")) }
                    continuation.resume(returning: try Self.readFile(url, name: provider.suggestedName, type: nil, maximum: maximum))
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
    private func file(_ provider: NSItemProvider, type: String, maximum: Int) async throws -> FleetCaptureAttachment {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
                do {
                    if let error { throw error }; guard let url else { throw FleetFailure("capture-source", FleetText.text("share.fileUnreadable")) }
                    continuation.resume(returning: try Self.readFile(url, name: provider.suggestedName, type: type, maximum: maximum))
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
    @objc private func receive() {
        guard working == nil else { return }; save.isEnabled = false; note.isEditable = false; message.text = FleetText.text("share.saving")
        let addition = note.text ?? "", items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        working = Task {
            do {
                let inbox = try FleetCaptureInbox(); var texts: [String] = addition.isEmpty ? [] : [addition], files: [FleetCaptureAttachment] = []
                for item in items {
                    for value in [item.attributedTitle?.string, item.attributedContentText?.string].compactMap({ $0 }) where !value.isEmpty && !texts.contains(value) { texts.append(value) }
                }
                let providers = items.flatMap { $0.attachments ?? [] }; try FleetProtocol.require(providers.count <= 16, "capture-capacity", FleetText.text("share.tooManyItems"))
                var total = 0
                for provider in providers {
                    try Task.checkCancellation()
                    if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                        let value = try await item(provider, type: UTType.plainText.identifier)
                        if let text = value as? String { if !texts.contains(text) { texts.append(text) } }
                        else if let data = value as? Data, let text = String(data: data, encoding: .utf8) { if !texts.contains(text) { texts.append(text) } }
                        else { throw FleetFailure("capture-source", FleetText.text("share.textUnreadable")) }
                    } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                        let attachment = try await fileURL(provider, maximum: FleetProtocol.attachment - total); total += attachment.bytes.count; files.append(attachment)
                    } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                        guard let url = try await item(provider, type: UTType.url.identifier) as? URL, ["http", "https"].contains(url.scheme ?? "") else { throw FleetFailure("capture-source", FleetText.text("share.linkUnsupported")) }; if !texts.contains(url.absoluteString) { texts.append(url.absoluteString) }
                    } else {
                        guard let type = provider.registeredTypeIdentifiers.first(where: { $0 != UTType.fileURL.identifier && UTType($0)?.conforms(to: .data) == true }) else { throw FleetFailure("capture-source", FleetText.text("share.formatUnsupported")) }
                        let attachment = try await file(provider, type: type, maximum: FleetProtocol.attachment - total); total += attachment.bytes.count; files.append(attachment)
                    }
                    try FleetProtocol.require(texts.reduce(0, { $0 + $1.utf8.count }) <= FleetCaptureInbox.textLimit, "capture-capacity", FleetText.text("share.textTooLong"))
                }
                try Task.checkCancellation(); try await inbox.offer(text: texts.joined(separator: "\n\n"), files: files); try Task.checkCancellation()
                extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
            } catch {
                guard !Task.isCancelled else { return }; working = nil; save.isEnabled = true; note.isEditable = true
                // The shared inbox code reports English for the main window; the one code it raises here gets the sheet's text.
                let failure = error as? FleetFailure
                message.text = failure?.code == "capture-unavailable" ? FleetText.text("share.inboxUnavailable") : failure?.message ?? FleetText.text("share.notSaved")
            }
        }
    }
}
