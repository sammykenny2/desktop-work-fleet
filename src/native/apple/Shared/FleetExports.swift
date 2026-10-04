import Foundation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

@MainActor final class FleetExports: NSObject {
    private static func filename(_ name: String) -> String {
        let denied = CharacterSet(charactersIn: "\\/:*?\"<>|").union(.controlCharacters)
        let value = String(String.UnicodeScalarView(name.unicodeScalars.map { denied.contains($0) ? "_" : $0 })).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty || value == "." || value == ".." ? "work-fleet-export" : String(value.prefix(180))
    }
    #if os(macOS)
    func export(_ bytes: Data, name: String, action: String, window: NSWindow?) async throws -> Any {
        try FleetProtocol.require(action == "save", "file-export", "此平台請使用檔案匯出。");
        let panel = NSSavePanel(); panel.nameFieldStringValue = Self.filename(name); panel.canCreateDirectories = true
        let response: NSApplication.ModalResponse = await withCheckedContinuation { continuation in
            if let window { panel.beginSheetModal(for: window) { continuation.resume(returning: $0) } }
            else { panel.begin { continuation.resume(returning: $0) } }
        }
        guard response == .OK, let destination = panel.url else { return ["completed": false] }
        let scoped = destination.startAccessingSecurityScopedResource(); defer { if scoped { destination.stopAccessingSecurityScopedResource() } }
        try bytes.write(to: destination, options: .atomic); return ["completed": true, "shared": false]
    }
    #else
    private var continuation: CheckedContinuation<Bool, Error>?
    private var temporary: URL?
    private var picker: UIViewController?
    private var timeout: Task<Void, Never>?
    func export(_ bytes: Data, name: String, action: String, presenter: UIViewController?) async throws -> Any {
        try FleetProtocol.require(["save", "share", "shareText"].contains(action) && continuation == nil && presenter != nil && presenter?.presentedViewController == nil, "file-busy", "檔案選擇器目前不可用。");
        let items: [Any]; var file: URL?
        if action == "shareText" {
            guard bytes.count <= 128 * 1024, let text = String(data: bytes, encoding: .utf8) else { throw FleetFailure("file-capacity", "文字分享容量或格式無效，請改用檔案分享。") }
            items = [text]
        } else {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
            let folder = root.appendingPathComponent(FleetProtocol.uuid(), isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
            let destination = folder.appendingPathComponent(Self.filename(name)); try bytes.write(to: destination, options: [.atomic, .completeFileProtection]); temporary = folder
            file = destination; items = [destination]
        }
        let completed: Bool = try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            if action != "save" {
                let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
                controller.completionWithItemsHandler = { [weak self] _, completed, _, error in
                    Task { @MainActor in self?.finish(completed, error: error) }
                }
                if let popover = controller.popoverPresentationController, let view = presenter?.view {
                    popover.sourceView = view; popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1); popover.permittedArrowDirections = []
                }
                picker = controller; presenter?.present(controller, animated: true)
            } else {
                let controller = UIDocumentPickerViewController(forExporting: [file!], asCopy: true); controller.delegate = self
                picker = controller; presenter?.present(controller, animated: true)
            }
            timeout = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(110)) } catch { return }
                self?.picker?.dismiss(animated: true); self?.finish(false, error: FleetFailure("file-timeout", "檔案選擇逾時，請重試。"))
            }
        }
        return ["completed": completed, "shared": action != "save"]
    }
    private func finish(_ completed: Bool, error: Error? = nil) {
        guard let pending = continuation else { return }; continuation = nil; timeout?.cancel(); timeout = nil; picker = nil
        if let temporary { try? FileManager.default.removeItem(at: temporary) }; temporary = nil
        if let error { pending.resume(throwing: error) } else { pending.resume(returning: completed) }
    }
    func close() { picker?.dismiss(animated: false); finish(false, error: FleetFailure("native-closed", "原生工作階段已結束。")) }
    #endif
}
#if os(iOS)
extension FleetExports: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finish(!urls.isEmpty) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(false) }
}
#endif
