import Foundation
import WebKit
#if os(macOS)
import AppKit
#else
import UIKit
#endif

@MainActor final class FleetWebHost: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    let web: WKWebView
    let assets: URL
    let document: URL
    private var service: FleetService?
    private var google: FleetGoogle?
    private let directory: URL
    private let config: [String: Any]
    private var epoch = 0, admitted = 0
    private var closing = false
    private let exports = FleetExports()
    private var directoryContinuation: CheckedContinuation<URL, Error>?
    var finished: (() -> Void)?
    var cancelled: (() -> Void)?
    var configure: (@MainActor (FleetService) async throws -> Void)?
    var stopped: (() -> Void)?
    var backgroundFinished: ((String) -> Void)?
    #if os(macOS)
    let platform = "macos"
    #else
    let platform = "ios"
    weak var presenter: UIViewController?
    #endif
    init(directory: URL) throws {
        self.directory = directory
        guard let resources = Bundle.main.resourceURL else { throw FleetFailure("native-assets", "封裝資產不存在。") }
        assets = resources.appendingPathComponent("Assets", isDirectory: true); document = assets.appendingPathComponent("app/index.html")
        config = try FleetProtocol.json(Data(contentsOf: resources.appendingPathComponent("Config/public.json")))
        let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        web = WKWebView(frame: .zero, configuration: configuration)
        super.init(); configuration.userContentController.add(self, name: "workFleet")
        web.navigationDelegate = self; web.uiDelegate = self
        if #available(macOS 13.3, iOS 16.4, *) { web.isInspectable = false }
        Task { await open() }
    }
    private func open() async {
        do {
            let marker = directory.appendingPathComponent("profile.txt")
            let selected = (try? String(contentsOf: marker, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)) ?? "local"
            let profile = selected == "local" || selected.hasPrefix("google:") && FleetProtocol.isAccount(String(selected.dropFirst(7))) ? selected : "local"
            let database = try FleetDatabase(directory: directory, profile: profile)
            let google = try FleetGoogle(profile: profile, config: config); self.google = google
            #if os(macOS)
            google.presenting = { [weak self] in self?.web.window }
            #else
            google.presenting = { [weak self] in self?.presenter }
            #endif
            service = FleetService(database: database, google: google, platform: platform, choose: { [weak self] in
                guard let self else { throw FleetFailure("native-closed", "原生工作階段已結束。") }; return try await self.chooseDirectory()
            })
            if let service { try await configure?(service) }
            await service?.setExports { [weak self] bytes, name, action in
                guard let self else { throw FleetFailure("native-closed", "原生工作階段已結束。") }
                #if os(macOS)
                return try await self.exports.export(bytes, name: name, action: action, window: self.web.window)
                #else
                return try await self.exports.export(bytes, name: name, action: action, presenter: self.presenter)
                #endif
            }
            let rules = "[{\"trigger\":{\"url-filter\":\"^https?://\"},\"action\":{\"type\":\"block\"}}]"
            let blocker: WKContentRuleList = try await withCheckedThrowingContinuation { continuation in
                WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "work-fleet-local-assets-v1", encodedContentRuleList: rules) { rules, error in
                    if let error { continuation.resume(throwing: error) }
                    else if let rules { continuation.resume(returning: rules) }
                    else { continuation.resume(throwing: FleetFailure("native-assets", "無法設定本機資產保護。")) }
                }
            }
            web.configuration.userContentController.add(blocker); web.loadFileURL(document, allowingReadAccessTo: assets)
        } catch { showFailure(error) }
    }
    func event(_ name: String, _ values: [String: Any] = [:]) {
        var message = values; message["v"] = 1; message["event"] = name; reply(message)
    }
    private func reply(_ message: [String: Any]) {
        web.callAsyncJavaScript("globalThis.__workFleetReceive(value);", arguments: ["value": message], in: nil, in: .page, completionHandler: nil)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.standardizedFileURL == document.standardizedFileURL,
            web.url?.standardizedFileURL == document.standardizedFileURL, let request = message.body as? [String: Any], let service, admitted < 32 else { return }
        do {
            let bytes = try FleetProtocol.encode(request); try FleetProtocol.require(bytes.count <= 1024 * 1024 && FleetProtocol.number(request, "v", 1) == 1, "invalid-request", "原生協定或容量無效。")
            let id = try FleetProtocol.text(request, "id"), method = try FleetProtocol.text(request, "method")
            guard FleetProtocol.isUUID(id), let args = request["params"] as? [String: Any] else { return }; admitted += 1; let current = epoch
            Task {
                let response: [String: Any]; var next: String?
                do {
                    let result = try await service.invoke(method, args); response = ["v": 1, "id": id, "ok": true, "result": result]
                    if ["google.open", "google.signOut", "google.local"].contains(method) { next = (result as? [String: Any])?["profileId"] as? String }
                } catch {
                    let failure = error as? FleetFailure ?? FleetFailure("native-unavailable", "原生操作未完成，請保留草稿後重試。")
                    response = ["v": 1, "id": id, "ok": false, "error": ["code": failure.code, "message": failure.message]]
                }
                admitted -= 1; guard current == epoch else { return }; reply(response)
                if let next { await switchProfile(next) }
                else if method == "host.closeCancel" { closing = false; cancelled?() }
                else if method == "host.backgroundReady", let id = args["id"] as? String { backgroundFinished?(id) }
                else if closing { if await service.closeReady { await stop(); finished?() } }
            }
        } catch { /* Invalid sources and envelopes never reach native capabilities. */ }
    }
    private func switchProfile(_ profile: String) async {
        epoch += 1
        #if os(iOS)
        exports.close()
        #endif
        await service?.close(); service = nil
        do { try Data(profile.utf8).write(to: directory.appendingPathComponent("profile.txt"), options: .atomic); await open() }
        catch { showFailure(error) }
    }
    func prepareClose() async {
        guard !closing else { return }; closing = true
        if let service, await service.ready { event("host-close-requested") }
        else { await stop(); finished?() }
    }
    func stop() async {
        epoch += 1; stopped?()
        #if os(iOS)
        exports.close()
        #endif
        await service?.close(); service = nil; google = nil; web.configuration.userContentController.removeScriptMessageHandler(forName: "workFleet")
    }
    private func showFailure(_ error: Error) {
        let text = (error as? FleetFailure)?.message ?? "無法開啟安全工作空間。請保留 App 資料並重試。"
        #if os(macOS)
        let alert = NSAlert(); alert.messageText = "Work Fleet"; alert.informativeText = text; alert.runModal()
        #else
        let alert = UIAlertController(title: "Work Fleet", message: text, preferredStyle: .alert); alert.addAction(UIAlertAction(title: "關閉", style: .default)); presenter?.present(alert, animated: true)
        #endif
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame?.isMainFrame == true && url.standardizedFileURL == document.standardizedFileURL { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated, ["https", "http"].contains(url.scheme ?? "") {
            #if os(macOS)
            NSWorkspace.shared.open(url)
            #else
            UIApplication.shared.open(url)
            #endif
        }
        decisionHandler(.cancel)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { Task { await stop(); showFailure(FleetFailure("native-view", "畫面程序已停止；最後已保存的資料仍保留，請重新開啟。")) } }
    private func chooseDirectory() async throws -> URL {
        #if os(macOS)
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        let response: NSApplication.ModalResponse = await withCheckedContinuation { continuation in panel.begin { continuation.resume(returning: $0) } }
        guard response == .OK, let url = panel.url else { throw FleetFailure("backup-cancelled", "已取消選擇。") }; return url
        #else
        guard let presenter, directoryContinuation == nil else { throw FleetFailure("backup-permission", "資料夾選擇器目前不可用。") }
        return try await withCheckedThrowingContinuation { continuation in
            directoryContinuation = continuation; let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false); picker.delegate = self; picker.allowsMultipleSelection = false; presenter.present(picker, animated: true)
        }
        #endif
    }
    #if os(macOS)
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard frame.isMainFrame else { completionHandler(nil); return }; let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = false; panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.begin { response in completionHandler(response == .OK ? panel.urls : nil) }
    }
    #endif
}
#if os(iOS)
import UniformTypeIdentifiers
extension FleetWebHost: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let continuation = directoryContinuation; directoryContinuation = nil
        if let url = urls.first { continuation?.resume(returning: url) } else { continuation?.resume(throwing: FleetFailure("backup-cancelled", "已取消選擇。")) }
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { directoryContinuation?.resume(throwing: FleetFailure("backup-cancelled", "已取消選擇。")); directoryContinuation = nil }
}
#endif
