import AppKit
import WebKit

@main @MainActor final class StartupProbe: NSObject, NSApplicationDelegate {
    private var host: FleetWebHost?
    private var window: NSWindow?
    private var desktop: FleetDesktop?
    private var closeReason: String?
    private var closeFinished = false
    private var hostStopped = false

    static func main() {
        if CommandLine.arguments.contains("--cleanup") {
            guard Bundle.main.bundleIdentifier?.hasPrefix("app.workfleet.startupprobe.") == true else { exit(1) }
            do {
                try FleetKeychain.remove("probe-roundtrip")
                try FleetKeychain.remove("storage-key")
                print("PASS probe-owned Keychain cleanup")
                exit(0)
            } catch { fputs("FAIL probe-owned Keychain cleanup\n", stderr); exit(1) }
        }
        let application = NSApplication.shared
        let delegate = StartupProbe()
        application.delegate = delegate
        application.setActivationPolicy(.prohibited)
        application.run()
    }

    private func check(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
        if try !value() { throw FleetFailure("startup-probe", message) }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.global().asyncAfter(deadline: .now() + 60) {
            fputs("FAIL signed native startup timed out\n", stderr)
            exit(1)
        }
        Task {
            do {
                try await run()
                print("PASS signed Keychain, encrypted SQLite, native renderer startup and graceful AppKit termination")
                NSApp.reply(toApplicationShouldTerminate: true)
            }
            catch { fputs("FAIL \((error as? FleetFailure)?.message ?? String(describing: error))\n", stderr); exit(1) }
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Task { await host?.prepareClose() }
        return .terminateLater
    }

    private func waitFor(_ condition: () -> Bool) async throws {
        for _ in 0..<100 {
            if condition() { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw FleetFailure("startup-probe", "The native close handshake did not finish")
    }

    private func verifyClose(_ host: FleetWebHost, directory: URL) async throws {
        host.cancelled = { [weak self] reason in
            self?.closeReason = reason
            NSApp.reply(toApplicationShouldTerminate: false)
        }
        host.finished = { [weak self] in self?.closeFinished = true }
        // A native Quit must visibly refuse unfinished IME input and keep the host alive for another attempt.
        _ = try await host.web.evaluateJavaScript("document.querySelector('#compose').click()")
        for _ in 0..<50 {
            if try await host.web.evaluateJavaScript("document.querySelector('#editor-dialog').open") as? Bool == true { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        _ = try await host.web.evaluateJavaScript("document.querySelector('#editor-text').dispatchEvent(new CompositionEvent('compositionstart'))")
        NSApp.perform(#selector(NSApplication.terminate(_:)), with: nil, afterDelay: 0)
        try await waitFor { self.closeReason != nil }
        try check(!hostStopped && !closeFinished, "Rejected close tore down the native host")
        try check(closeReason?.isEmpty == false, "Rejected close omitted its visible reason")
        // Keep an unsaved draft and idle Settings open, as when an update is installed from Settings.
        _ = try await host.web.evaluateJavaScript("""
            (() => {
                const input = document.querySelector('#editor-text');
                input.dispatchEvent(new CompositionEvent('compositionend'));
                input.value = 'Native quit keeps this unsaved draft';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                document.querySelector('#settings-dialog').showModal();
            })()
            """)
        NSApp.perform(#selector(NSApplication.terminate(_:)), with: nil, afterDelay: 0)
        try await waitFor { self.closeFinished }
        try check(hostStopped, "Close acknowledged before native resources stopped")
        // The real database must be unlocked and contain the draft before AppKit is told it may terminate.
        let database = try FleetDatabase(directory: directory, profile: "local")
        defer { database.close() }
        let receipt = try database.recordStatus()
        let page = try database.recordPage(["collection": "draft", "expectedRevision": receipt?["revision"] ?? NSNull()])
        try check(String(decoding: page, as: UTF8.self).contains("Native quit keeps this unsaved draft"), "The final draft was not durably saved")
        print("PASS native close cancellation reason, retry with idle Settings, draft readback and database release")
    }

    private func run() async throws {
        guard Bundle.main.bundleIdentifier?.hasPrefix("app.workfleet.startupprobe.") == true else {
            throw FleetFailure("startup-probe", "The probe requires its own isolated bundle identity")
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("startup-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        defer { try? FleetKeychain.remove("probe-roundtrip"); try? FleetKeychain.remove("storage-key") }
        try FleetKeychain.save("probe-roundtrip", Data("first".utf8))
        try check(FleetKeychain.read("probe-roundtrip") == Data("first".utf8), "Keychain create/read failed")
        try FleetKeychain.save("probe-roundtrip", Data("updated".utf8))
        try check(FleetKeychain.read("probe-roundtrip") == Data("updated".utf8), "Keychain update/read failed")
        print("PASS signed Keychain create/update/read")
        let directory = root.appendingPathComponent("sqlite", isDirectory: true)
        let bytes = try FleetProtocol.encode(["profileId": "local", "revision": 0, "fixture": "synthetic startup"])
        let first = try FleetDatabase(directory: directory, profile: "local")
        let token = try first.stage("workspace", bytes, FleetProtocol.digest(bytes))
        try first.commit("workspace", token, nil, [])
        first.close()
        let reopened = try FleetDatabase(directory: directory, profile: "local")
        try check(reopened.record("workspace") == bytes, "Encrypted SQLite reopen failed")
        reopened.close()
        print("PASS encrypted SQLite reopen")
        // The probe pins the display language to English before the window opens, as a stored preference would.
        FleetText.apply("en")
        let host = try FleetWebHost(directory: root.appendingPathComponent("renderer", isDirectory: true))
        self.host = host
        host.web.configuration.userContentController.addUserScript(WKUserScript(source: "globalThis.__probeErrors = []; addEventListener('error', e => __probeErrors.push(e.message || e.target?.src || 'Script load error'), true); addEventListener('unhandledrejection', e => __probeErrors.push(String(e.reason))); addEventListener('securitypolicyviolation', e => __probeErrors.push(e.violatedDirective + ': ' + e.blockedURI));", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host.web
        self.window = window
        host.configure = { [weak self, weak host] service in
            guard let self, let host else { throw FleetFailure("startup-probe", "Host was released") }
            let desktop = try FleetDesktop(assets: host.assets, send: { [weak host] name, values in host?.event(name, values) }, show: { false }, hide: { false }, mainVisible: { _ in })
            self.desktop = desktop
            await service.setDesktop { [weak desktop] method, args in
                guard let desktop else { throw FleetFailure("startup-probe", "Desktop was released") }
                return try desktop.invoke(method, args)
            }
            // host.info then reports the pinned preference, so the renderer starts in English on any system language.
            await service.setLanguage { preference in FleetText.apply(preference) }
        }
        host.stopped = { [weak self] in self?.desktop?.close(); self?.hostStopped = true }
        var lastState = "No renderer response"
        for _ in 0..<200 {
            do {
                let value = try await host.web.evaluateJavaScript("({status: document.querySelector('#status')?.textContent || '', error: document.querySelector('#status')?.classList.contains('error') || false, storage: document.querySelector('#storage-note')?.textContent || '', groups: document.querySelectorAll('#groups .group-row[data-group-id]').length, lang: document.documentElement.lang, chinese: /[\\u3400-\\u9fff]/.test((document.querySelector('#status')?.textContent || '') + (document.querySelector('#storage-note')?.textContent || '')), ready: document.readyState, errors: globalThis.__probeErrors || [], bridge: typeof globalThis.__workFleetReceive, resources: performance.getEntriesByType('resource').map(e => e.name)})")
                if let state = value as? [String: Any] {
                    lastState = String(describing: state)
                    // Element state, not wording: the catalogs own the text. Startup finished in English with native storage and groups.
                    if (state["status"] as? String)?.isEmpty == false, state["error"] as? Bool == false, state["lang"] as? String == "en",
                        state["chinese"] as? Bool == false, (state["storage"] as? String)?.isEmpty == false, state["bridge"] as? String == "function",
                        (state["groups"] as? Int ?? 0) > 0 {
                        try await verifyClose(host, directory: root.appendingPathComponent("renderer", isDirectory: true))
                        return
                    }
                }
            } catch {
                lastState = String(describing: error)
            }
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        throw FleetFailure("startup-probe", "The bundled renderer did not complete native startup: " + lastState)
    }
}
