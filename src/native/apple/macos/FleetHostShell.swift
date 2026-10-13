import AppKit
import ServiceManagement

/// ADR-043 on macOS: startup behaviour, the main window frame and the SMAppService login item for this data directory.
/// Nothing here is part of a profile, a backup or Google. Frames are in points with AppKit's bottom-left origin.
@MainActor final class FleetHostShell {
    struct Placement: Equatable {
        var x: Int?
        var y: Int?
        var width: Int
        var height: Int
        var maximized: Bool
    }
    struct Area { let x: Int, y: Int, width: Int, height: Int }
    static let preferencesFile = "host-preferences.json", placementFile = "window-placement.json"
    let directory: URL
    let launchedAtLogin: Bool
    private(set) var startAtLogin = true, closeToTray = true, openMainAtLogin = false
    private var lastUpdateCheck: String?
    private let firstRun: Bool
    private var current: Placement?
    private var dirty = false, tracking = false
    private var pending: Task<Void, Never>?
    /// A zoomed window opens at its restore frame and zooms on its first show, so a hidden sign-in start stays hidden.
    var pendingMaximize = false
    /// Hidden at sign-in unless the user asked for the main window; opening Work Fleet yourself always shows it.
    var startHidden: Bool { launchedAtLogin && !openMainAtLogin }

    init(directory: URL, launchedAtLogin: Bool) {
        self.directory = directory; self.launchedAtLogin = launchedAtLogin
        let file = directory.appendingPathComponent(Self.preferencesFile)
        firstRun = !FileManager.default.fileExists(atPath: file.path)
        if let value = Self.object(file) {
            if let flag = Self.flag(value, "startAtLogin") { startAtLogin = flag }
            if let flag = Self.flag(value, "closeToTray") { closeToTray = flag }
            if let flag = Self.flag(value, "openMainAtLogin") { openMainAtLogin = flag }
            if let text = value["lastUpdateCheck"] as? String, text.count <= 64 { lastUpdateCheck = text }
        }
        current = Self.readPlacement(directory)
    }
    /// Read once while launching: the open-application event says whether macOS started the app as a login item.
    static func detectLoginLaunch() -> Bool {
        guard let event = NSAppleEventManager.shared().currentAppleEvent else { return false }
        return event.eventID == AEEventID(kAEOpenApplication)
            && event.paramDescriptor(forKeyword: AEKeyword(keyAEPropData))?.enumCodeValue == OSType(keyAELaunchedAsLogInItem)
    }
    /// The first launch registers the default login item once; later launches never re-register one the user removed.
    func firstLaunch() {
        guard firstRun else { return }
        if startAtLogin && SMAppService.mainApp.status == .notRegistered { try? SMAppService.mainApp.register() }
        try? writePreferences()
    }

    // MARK: Main window frame

    private static func object(_ file: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: file), data.count <= 4096, let value = try? FleetProtocol.json(data),
              let version = value["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(), version.intValue == 1, version.doubleValue == 1 else { return nil }
        return value
    }
    private static func flag(_ value: [String: Any], _ key: String) -> Bool? {
        guard let number = value[key] as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }; return number.boolValue
    }
    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue == Double(number.intValue), abs(number.intValue) <= 1_000_000 else { return nil }
        return number.intValue
    }
    static func readPlacement(_ directory: URL) -> Placement? {
        guard let value = object(directory.appendingPathComponent(placementFile)), let width = integer(value["width"]), let height = integer(value["height"]),
              width > 0, height > 0, width <= 32768, height <= 32768, let maximized = flag(value, "maximized") else { return nil }
        let x = integer(value["x"]), y = integer(value["y"])
        let xMissing = value["x"] == nil || value["x"] is NSNull, yMissing = value["y"] == nil || value["y"] is NSNull
        guard (x != nil && y != nil) || (xMissing && yMissing) else { return nil }
        return Placement(x: x, y: y, width: width, height: height, maximized: maximized)
    }
    /// The rule shared with the Windows and Linux hosts (tests/fixtures/window-placement.json); areas[0] is the primary.
    static func resolve(_ saved: Placement?, _ areas: [Area], _ defaultWidth: Int, _ defaultHeight: Int) -> Placement {
        let primary = areas[0]
        func fallback() -> Placement {
            let width = min(defaultWidth, primary.width), height = min(defaultHeight, primary.height)
            return Placement(x: primary.x + (primary.width - width) / 2, y: primary.y + (primary.height - height) / 2, width: width, height: height, maximized: false)
        }
        guard let saved, saved.width > 0, saved.height > 0 else { return fallback() }
        guard let x = saved.x, let y = saved.y else {
            return Placement(x: nil, y: nil, width: min(saved.width, primary.width), height: min(saved.height, primary.height), maximized: saved.maximized)
        }
        var best: Area?; var most = 0
        for area in areas {
            let width = min(x + saved.width, area.x + area.width) - max(x, area.x), height = min(y + saved.height, area.y + area.height) - max(y, area.y)
            if width > 0 && height > 0 && width * height > most { most = width * height; best = area }
        }
        guard let area = best else { return fallback() }
        let width = min(saved.width, area.width), height = min(saved.height, area.height)
        return Placement(x: min(max(x, area.x), area.x + area.width - width), y: min(max(y, area.y), area.y + area.height - height), width: width, height: height, maximized: saved.maximized)
    }
    private static func areas() -> [Area] {
        let screens = NSScreen.screens
        let values = screens.map { screen -> Area in
            let frame = screen.visibleFrame
            return Area(x: Int(frame.minX.rounded()), y: Int(frame.minY.rounded()), width: Int(frame.width.rounded()), height: Int(frame.height.rounded()))
        }
        return values.isEmpty ? [Area(x: 0, y: 0, width: 1180, height: 800)] : values
    }
    private func frame(_ window: NSWindow) -> Placement {
        let frame = window.frame
        return Placement(x: Int(frame.minX.rounded()), y: Int(frame.minY.rounded()), width: Int(frame.width.rounded()), height: Int(frame.height.rounded()), maximized: false)
    }
    private func move(_ window: NSWindow, _ value: Placement) {
        guard let x = value.x, let y = value.y else { return }
        let was = tracking; tracking = false
        window.setFrame(NSRect(x: x, y: y, width: value.width, height: value.height), display: window.isVisible)
        tracking = was
    }
    /// Saved, validated frame before the window first shows; nothing saved gives 1180×800 centred on the main screen.
    func apply(_ window: NSWindow) {
        let resolved = Self.resolve(current, Self.areas(), 1180, 800)
        move(window, resolved); pendingMaximize = resolved.maximized; current = resolved; tracking = true
    }
    /// A window waiting in the menu bar may come back after its screen was disconnected.
    func beforeShow(_ window: NSWindow) {
        guard !window.isVisible, !window.isZoomed, !window.isMiniaturized else { return }
        let bounds = frame(window), resolved = Self.resolve(bounds, Self.areas(), 1180, 800)
        if resolved != bounds { move(window, resolved) }
    }
    /// Called from the window delegate. Minimizing, including the adjust overlay stepping aside, and full screen change nothing.
    func observe(_ window: NSWindow) {
        guard tracking, window.isVisible, !window.isMiniaturized, !window.styleMask.contains(.fullScreen) else { return }
        if window.isZoomed {
            if var value = current, !value.maximized { value.maximized = true; current = value; schedule() }
            return
        }
        let next = frame(window)
        if next != current { current = next; schedule() }
    }
    private func schedule() {
        dirty = true; pending?.cancel()
        pending = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            if !Task.isCancelled { self?.flush() }
        }
    }
    /// Writes pending bounds now: before closing to the menu bar, quitting and installing an update.
    func flush() {
        pending?.cancel(); pending = nil
        guard dirty, let value = current else { return }
        var object: [String: Any] = ["version": 1, "width": value.width, "height": value.height, "maximized": value.maximized]
        object["x"] = value.x.map { $0 as Any } ?? NSNull(); object["y"] = value.y.map { $0 as Any } ?? NSNull()
        do { try write(Self.placementFile, object); dirty = false } catch { /* Losing the file only loses the last position. */ }
    }
    func reset(_ window: NSWindow) throws {
        pending?.cancel(); pending = nil; dirty = false; current = nil; pendingMaximize = false
        let file = directory.appendingPathComponent(Self.placementFile)
        if FileManager.default.fileExists(atPath: file.path) {
            do { try FileManager.default.removeItem(at: file) } catch { throw FleetFailure("placement-reset", "無法清除主視窗位置，請稍後重試。") }
        }
        let was = tracking; tracking = false
        if window.isZoomed { window.zoom(nil) }
        tracking = was
        apply(window); pendingMaximize = false
    }
    private func write(_ name: String, _ object: [String: Any]) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var data = try FleetProtocol.encode(object); data.append(10)
        try data.write(to: directory.appendingPathComponent(name), options: .atomic)
    }

    // MARK: Startup behaviour

    private func writePreferences() throws {
        try write(Self.preferencesFile, ["version": 1, "startAtLogin": startAtLogin, "closeToTray": closeToTray, "openMainAtLogin": openMainAtLogin,
                                         "lastUpdateCheck": lastUpdateCheck.map { $0 as Any } ?? NSNull()])
    }
    private func loginState() -> String {
        switch SMAppService.mainApp.status {
        case .enabled: return "enabled"
        case .requiresApproval: return "requires-approval"
        case .notRegistered: return "disabled"
        default: return "unavailable"
        }
    }
    func describe(trayAvailable: Bool) -> [String: Any] {
        let state = loginState(), available = state != "unavailable"
        return [
            "startAtLogin": ["available": available, "enabled": state == "enabled", "preference": startAtLogin, "state": state,
                             "reason": available ? NSNull() : "macOS 目前無法註冊登入項目，請把 Work Fleet 放在「應用程式」檔案夾後重試。", "systemSettings": available] as [String: Any],
            "closeToTray": ["available": trayAvailable, "enabled": closeToTray] as [String: Any],
            "openMainAtLogin": ["available": available, "enabled": openMainAtLogin] as [String: Any],
            "launchedAtLogin": launchedAtLogin,
        ]
    }
    func set(_ name: String, _ value: Bool, trayAvailable: Bool) throws -> [String: Any] {
        switch name {
        case "startAtLogin":
            do {
                let service = SMAppService.mainApp
                if value && service.status != .enabled && service.status != .requiresApproval { try service.register() }
                if !value && service.status != .notRegistered { try service.unregister() }
            } catch { throw FleetFailure("startup-write", "無法更新登入項目，請到系統設定的「登入項目」調整。") }
            startAtLogin = value
        case "closeToTray": closeToTray = value
        case "openMainAtLogin": openMainAtLogin = value
        default: throw FleetFailure("invalid-request", "沒有這個啟動行為設定。")
        }
        do { try writePreferences() } catch { throw FleetFailure("preferences-write", "無法保存啟動行為設定，請稍後重試。") }
        return describe(trayAvailable: trayAvailable)
    }
    static func openSystemSettings() { SMAppService.openSystemSettingsLoginItems() }
    static var appVersion: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0" }
}
