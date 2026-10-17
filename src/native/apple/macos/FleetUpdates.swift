import AppKit
import Security
import Sparkle

/// ADR-044 on macOS. Work Fleet picks the newest `macos-vX.Y.Z` release with the same rules as Windows and Linux, then
/// hands that release's appcast.xml to Sparkle, whose standard dialogs download, verify (EdDSA and Apple code signing),
/// install and relaunch. Installing quits through applicationShouldTerminate, which saves drafts first.
@MainActor final class FleetUpdates: NSObject, SPUUpdaterDelegate {
    private var controller: SPUStandardUpdaterController?
    // Read by Sparkle's delegate callback on the main thread right after check() sets it.
    nonisolated(unsafe) private var feed: String?
    private let repository: String, channel: String
    private let current: [Int]
    let currentText: String
    /// The table key of why in-app updates are unavailable, empty when they work; the text follows the current language.
    private let reasonKey: String
    var reason: String { reasonKey.isEmpty ? "" : FleetText.text(reasonKey) }
    var capable: Bool { reasonKey.isEmpty }
    private(set) var status: String
    private(set) var lastChecked: String?
    private(set) var error: FleetFailure?
    var publish: (([String: Any]) -> Void)?
    var recordCheck: ((String) -> Void)?

    init(config: [String: Any], lastChecked: String?) {
        let update = config["update"] as? [String: Any] ?? [:]
        let repository = update["repository"] as? String ?? ""
        self.repository = repository.range(of: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$", options: .regularExpression) != nil ? repository : ""
        channel = update["channel"] as? String ?? "preview"
        currentText = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
        current = Self.version(currentText) ?? [0, 0, 0]
        let key = Bundle.main.infoDictionary?["SUPublicEDKey"] as? String ?? ""
        reasonKey = self.repository.isEmpty ? "reason.updateNoSource"
            : key.isEmpty ? "reason.updateNoKey"
            : Self.teamIdentifier() == nil ? "reason.updateNeedsDeveloperId" : ""
        status = reasonKey.isEmpty ? "idle" : "unavailable"
        self.lastChecked = lastChecked
        super.init()
        if reasonKey.isEmpty { controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: nil) }
    }
    /// The signing team of the running app; an ad-hoc or unsigned build has none and cannot update itself.
    nonisolated private static func teamIdentifier() -> String? {
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return nil }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
              let values = information as? [String: Any] else { return nil }
        return values[kSecCodeInfoTeamIdentifier as String] as? String
    }
    /// A strict x.y.z version without leading zeros, as in tests/fixtures/update-feed.json.
    nonisolated static func version(_ text: String) -> [Int]? {
        FleetReleaseFeed.version(text)
    }

    func snapshot() -> [String: Any] {
        var value: [String: Any] = ["available": capable, "currentVersion": currentText, "channel": channel, "status": status,
                                    "nextAction": ["idle", "up_to_date", "update_available", "failed"].contains(status) ? "check" : "none"]
        value["reason"] = capable ? NSNull() : reason
        value["lastCheckedAt"] = lastChecked ?? NSNull()
        value["error"] = error.map { ["code": $0.code, "message": $0.message] as [String: Any] } ?? NSNull()
        return value
    }
    private func set(_ next: String) { status = next; publish?(snapshot()) }

    /// Resolves the release on GitHub, then lets Sparkle show the update; no newer release means up to date.
    func check() async {
        guard capable, let controller, status != "checking" else { return }
        error = nil; set("checking")
        do {
            var request = URLRequest(url: URL(string: "https://github.com/\(repository)/releases.atom")!)
            request.setValue("application/atom+xml", forHTTPHeaderField: "Accept")
            request.setValue("WorkFleet/\(currentText)", forHTTPHeaderField: "User-Agent")
            let (data, response) = try await BoundedHTTP(maximum: 2 * 1024 * 1024).send(request)
            if response.statusCode == 429 || (response.statusCode == 403 && response.value(forHTTPHeaderField: "Retry-After") != nil) {
                throw FleetFailure("rate_limited", FleetText.text("update.rateLimited"))
            }
            guard (200..<300).contains(response.statusCode) else { throw FleetFailure("provider_rejected", FleetText.text("update.providerRejected", ["status": String(response.statusCode)])) }
            let release = try FleetReleaseFeed.latest(data, repository: repository, channel: channel, current: current)
            let now = ISO8601DateFormatter().string(from: Date()); lastChecked = now; recordCheck?(now)
            guard let release else { set("up_to_date"); return }
            feed = release.appcast
            set("update_available")
            controller.checkForUpdates(nil)
        } catch let failure as FleetFailure { error = failure; set("failed") }
        catch { self.error = FleetFailure("offline", FleetText.text("update.offline")); set("failed") }
    }
    nonisolated func feedURLString(for updater: SPUUpdater) -> String? { feed }
    nonisolated func updaterDidNotFindUpdate(_ updater: SPUUpdater) { Task { @MainActor in self.set("up_to_date") } }
    nonisolated func updater(_ updater: SPUUpdater, didAbortWithError error: Error) {
        let nsError = error as NSError
        // Sparkle also reports "no update" this way; only real failures show as errors.
        guard nsError.domain != SUSparkleErrorDomain || nsError.code != Int(SUError.noUpdateError.rawValue) else { return }
        let message = nsError.localizedDescription
        Task { @MainActor in self.error = FleetFailure("install_failed", FleetText.text("update.installFailed", ["detail": message])); self.set("failed") }
    }
}
