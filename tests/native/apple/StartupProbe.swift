import AppKit
import WebKit

@main @MainActor final class StartupProbe: NSObject, NSApplicationDelegate {
    private var host: FleetWebHost?
    private var window: NSWindow?
    private var desktop: FleetDesktop?

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
            do { try await run(); print("PASS signed Keychain create/update/read, encrypted SQLite reopen, native bridge and renderer startup"); exit(0) }
            catch { fputs("FAIL \((error as? FleetFailure)?.message ?? String(describing: error))\n", stderr); exit(1) }
        }
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
        let host = try FleetWebHost(directory: root.appendingPathComponent("renderer", isDirectory: true))
        self.host = host
        host.web.configuration.userContentController.addUserScript(WKUserScript(source: "globalThis.__probeErrors = []; addEventListener('error', e => __probeErrors.push(e.message || e.target?.src || 'Script load error'), true); addEventListener('unhandledrejection', e => __probeErrors.push(String(e.reason))); addEventListener('securitypolicyviolation', e => __probeErrors.push(e.violatedDirective + ': ' + e.blockedURI));", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host.web
        self.window = window
        host.configure = { [weak self, weak host] service in
            guard let self, let host else { throw FleetFailure("startup-probe", "Host was released") }
            let desktop = try FleetDesktop(assets: host.assets, send: { [weak host] name, values in host?.event(name, values) }, show: {}, hide: { false })
            self.desktop = desktop
            await service.setDesktop { [weak desktop] method, args in
                guard let desktop else { throw FleetFailure("startup-probe", "Desktop was released") }
                return try desktop.invoke(method, args)
            }
        }
        host.stopped = { [weak self] in self?.desktop?.close() }
        var lastState = "No renderer response"
        for _ in 0..<200 {
            do {
                let value = try await host.web.evaluateJavaScript("({status: document.querySelector('#status')?.textContent || '', error: document.querySelector('#status')?.classList.contains('error') || false, storage: document.querySelector('#storage-note')?.textContent || '', groups: document.querySelector('#groups')?.children.length || 0, ready: document.readyState, errors: globalThis.__probeErrors || [], bridge: typeof globalThis.__workFleetReceive, resources: performance.getEntriesByType('resource').map(e => e.name)})")
                if let state = value as? [String: Any] {
                    lastState = String(describing: state)
                    if state["status"] as? String == "已開啟本機資料",
                        (state["storage"] as? String)?.hasPrefix("加密保存在這台裝置") == true, (state["groups"] as? Int ?? 0) > 0 {
                        await host.stop()
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
