import AppKit
import ServiceManagement

@main @MainActor enum HostShellProbe {
    final class Service {
        var state: SMAppService.Status
        var registrations = 0, removals = 0
        var failRegistration = false
        init(_ state: SMAppService.Status) { self.state = state }
        var item: FleetHostShell.LoginItem {
            FleetHostShell.LoginItem(status: { self.state }, register: {
                self.registrations += 1
                if self.failRegistration { throw NSError(domain: "fixture", code: 1) }
                self.state = .enabled
            }, unregister: { self.removals += 1; self.state = .notRegistered })
        }
    }

    static func check(_ value: @autoclosure () -> Bool, _ message: String) throws {
        if !value() { throw FleetFailure("host-shell-probe", message) }
    }
    static func startup(_ shell: FleetHostShell) -> [String: Any] {
        shell.describe(trayAvailable: true)["startAtLogin"] as! [String: Any]
    }
    static func preferences(_ directory: URL, enabled: Bool) throws {
        try FleetProtocol.encode(["version": 1, "startAtLogin": enabled])
            .write(to: directory.appendingPathComponent(FleetHostShell.preferencesFile))
    }
    static func main() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("host-shell-" + UUID().uuidString)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: directory) }
            let name = CommandLine.arguments[1]
            if name == "system" { try system(directory) }
            else if name == "language" { try language(directory) }
            else if name == "language-rules" { try rules() }
            else { try fixture(name, directory) }
            print("PASS " + name)
        } catch {
            fputs("FAIL \((error as? FleetFailure)?.message ?? String(describing: error))\n", stderr)
            exit(1)
        }
    }
    static func fixture(_ name: String, _ directory: URL) throws {
        let service = Service(name == "first-disabled" ? .notRegistered : .notFound)
        if name == "existing-notfound" { try preferences(directory, enabled: true) }
        if name == "registration-error" { try preferences(directory, enabled: false) }
        if name == "approval" { service.state = .requiresApproval }
        if name == "enabled" { service.state = .enabled }
        let shell = FleetHostShell(directory: directory, launchedAtLogin: false, loginItem: service.item)
        switch name {
        case "notfound-state":
            let value = startup(shell)
            try check(value["available"] as? Bool == true, "Unseen service must allow registration")
            try check(value["enabled"] as? Bool == false && value["state"] as? String == "disabled", "Unseen service is not enabled")
            try check(value["reason"] is NSNull, "Unseen service must not blame the installation folder")
            let open = shell.describe(trayAvailable: true)["openMainAtLogin"] as! [String: Any]
            try check(open["available"] as? Bool == true, "Hidden login launch preference must remain editable")
        case "first-notfound", "first-disabled":
            shell.firstLaunch()
            try check(service.registrations == 1 && startup(shell)["enabled"] as? Bool == true, "First launch must register the default")
            try check(FileManager.default.fileExists(atPath: directory.appendingPathComponent(FleetHostShell.preferencesFile).path), "First launch must save preferences")
        case "existing-notfound":
            shell.firstLaunch()
            try check(service.registrations == 0, "Subsequent launch must respect an absent system entry")
            let value = try shell.set("startAtLogin", true, trayAvailable: true)
            try check(service.registrations == 1 && (value["startAtLogin"] as! [String: Any])["enabled"] as? Bool == true, "User can retry registration after the old first-launch failure")
        case "approval", "enabled":
            shell.firstLaunch()
            _ = try shell.set("startAtLogin", true, trayAvailable: true)
            try check(service.registrations == 0, "Do not register an enabled or approval-pending entry again")
            try check(startup(shell)["state"] as? String == (name == "approval" ? "requires-approval" : "enabled"), "Show actual system approval state")
            _ = try shell.set("startAtLogin", false, trayAvailable: true)
            try check(service.removals == 1 && startup(shell)["enabled"] as? Bool == false, "Turning off removes the entry")
        case "off-unseen":
            _ = try shell.set("startAtLogin", false, trayAvailable: true)
            try check(service.removals == 0 && service.registrations == 0, "Turning off an unseen entry needs no service mutation")
            let reopened = FleetHostShell(directory: directory, launchedAtLogin: false, loginItem: service.item)
            reopened.firstLaunch()
            try check(!reopened.startAtLogin && service.registrations == 0, "Persisted off preference remains off on restart")
        case "registration-error":
            service.failRegistration = true
            do { _ = try shell.set("startAtLogin", true, trayAvailable: true); throw FleetFailure("host-shell-probe", "Registration failure was hidden") }
            catch let failure as FleetFailure { try check(failure.code == "startup-write", "Registration failure must reach the UI") }
            let reopened = FleetHostShell(directory: directory, launchedAtLogin: false, loginItem: service.item)
            try check(!shell.startAtLogin && !reopened.startAtLogin && startup(shell)["enabled"] as? Bool == false, "Failure must not claim registration succeeded or change the saved preference")
            service.failRegistration = false
            _ = try shell.set("startAtLogin", true, trayAvailable: true)
            try check(service.registrations == 2 && startup(shell)["enabled"] as? Bool == true, "Retry remains possible after registration fails")
        default: throw FleetFailure("host-shell-probe", "Unknown case")
        }
    }
    /// The display language lives in host-preferences.json beside the startup settings; damage never blocks startup.
    static func language(_ directory: URL) throws {
        let file = directory.appendingPathComponent(FleetHostShell.preferencesFile)
        let service = Service(.notRegistered)
        let shell = FleetHostShell(directory: directory, launchedAtLogin: false, loginItem: service.item)
        try check(shell.language == "auto", "A new device starts at auto")
        try shell.setLanguage("zh-TW")
        let saved = try FleetProtocol.json(Data(contentsOf: file))
        try check(saved["language"] as? String == "zh-TW" && (saved["version"] as? NSNumber)?.intValue == 1, "The language is saved with the startup settings in version 1")
        try check(FleetHostShell(directory: directory, launchedAtLogin: false, loginItem: service.item).language == "zh-TW", "The saved language survives a restart")
        do { try shell.setLanguage("fr"); throw FleetFailure("host-shell-probe", "An unknown language was stored") }
        catch let failure as FleetFailure { try check(failure.code == "invalid-request", "An unknown language is an invalid request") }
        try check(shell.language == "zh-TW", "A refused language keeps the previous one")
        for damaged in ["\"garbage\"", "1", "null", "\"ZH-TW\""] {
            try Data("{\"version\":1,\"startAtLogin\":false,\"language\":\(damaged)}".utf8).write(to: file)
            let reopened = FleetHostShell(directory: directory, launchedAtLogin: false, loginItem: service.item)
            try check(reopened.language == "auto" && !reopened.startAtLogin, "A damaged language reads as auto and keeps the other settings: \(damaged)")
        }
    }
    /// The same cases as tests/i18n.test.js, so the menus resolve exactly like the window.
    static func rules() throws {
        let cases: [(String, String?)] = [("en", "en"), ("en-US", "en"), ("EN_gb", "en"), ("zh", "zh-TW"), ("zh-TW", "zh-TW"), ("zh_TW.UTF-8", "zh-TW"),
            ("zh-Hant", "zh-TW"), ("zh-Hant-TW", "zh-TW"), ("zh-HK", "zh-TW"), ("zh-MO", "zh-TW"), ("zh-CN", nil), ("zh-Hans-CN", nil), ("zh-SG", nil),
            ("ja-JP", nil), ("C", nil), ("C.UTF-8", nil), ("", nil)]
        for (tag, expected) in cases { try check(FleetText.match(tag) == expected, "\(tag) must match \(expected ?? "nothing")") }
        try check(FleetText.resolve("auto", ["ja-JP", "zh-CN", "zh-TW", "en-US"]) == "zh-TW", "Auto takes the first matching system language")
        try check(FleetText.resolve("auto", ["fr-FR"]) == "en" && FleetText.resolve("auto", []) == "en", "Nothing matching means English")
        try check(FleetText.resolve("en", ["zh-TW"]) == "en" && FleetText.resolve("zh-TW", ["en-US"]) == "zh-TW", "A pinned preference wins")
        try check(FleetText.resolve("fr", ["zh-TW"]) == "zh-TW", "An unknown preference resolves like auto")
        FleetText.apply("zh-TW")
        try check(FleetText.preference == "zh-TW" && FleetText.locale == "zh-TW" && FleetText.text("menuBar.quit") == FleetText.zhTW["menuBar.quit"], "zh-TW text comes from the Traditional Chinese block")
        FleetText.apply("en")
        try check(FleetText.text("menuBar.quit") == "Save and quit", "English text comes from the English block")
        try check(FleetText.text("dialog.upToDate", ["version": "1.2.3"]) == "Work Fleet 1.2.3 is up to date.", "Placeholders are filled")
        try check(FleetText.text("missing.key") == "missing.key", "A missing key stays visible")
        FleetText.apply("fr")
        try check(FleetText.preference == "auto" && FleetText.locale == FleetText.resolve("auto", FleetText.system), "An unknown preference applies as auto")
        let described = FleetText.describe()
        try check(described["preference"] as? String == "auto" && described["system"] is [String], "host.info reports the preference and the system languages")
        try check(Set(FleetText.en.keys) == Set(FleetText.zhTW.keys), "Both blocks have the same keys")
        func placeholders(_ text: String) -> [String] {
            let pattern = try! NSRegularExpression(pattern: "\\{([A-Za-z0-9_]+)\\}")
            return pattern.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { (text as NSString).substring(with: $0.range(at: 1)) }.sorted()
        }
        for (key, text) in FleetText.en { try check(placeholders(text) == placeholders(FleetText.zhTW[key] ?? ""), "\(key) must have the same placeholders in both blocks") }
        try check(placeholders(FleetText.en["dialog.upToDate"] ?? "") == ["version"], "The placeholder pattern finds names")
    }
    static func system(_ directory: URL) throws {
        guard Bundle.main.bundleIdentifier?.hasPrefix("app.workfleet.loginprobe.") == true else {
            throw FleetFailure("host-shell-probe", "System registration requires an isolated probe identity")
        }
        let service = SMAppService.mainApp
        let initial = service.status
        try check(initial == .notFound || initial == .notRegistered, "Unique probe must start without a registered entry")
        print("Initial SMAppService status: \(initial.rawValue)")
        let shell = FleetHostShell(directory: directory, launchedAtLogin: false)
        do {
            try check(startup(shell)["available"] as? Bool == true, "Real unseen service must allow registration")
            shell.firstLaunch()
            try check(service.status == .enabled || service.status == .requiresApproval, "Real first launch failed to register")
            print("Registered SMAppService status: \(service.status.rawValue)")
            _ = try shell.set("startAtLogin", false, trayAvailable: true)
            try check(service.status == .notRegistered, "Real probe entry was not removed")
            print("Removed SMAppService status: \(service.status.rawValue)")
        } catch {
            if service.status == .enabled || service.status == .requiresApproval { try service.unregister() }
            throw error
        }
    }
}
