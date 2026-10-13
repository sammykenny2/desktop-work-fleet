import AppKit

@main @MainActor struct SceneLayersProbe {
    static func check(_ value: @autoclosure () -> Bool, _ message: String) throws {
        if !value() { throw FleetFailure("probe", message) }
    }
    static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        do {
            try run()
            print("PASS macOS native three-layer geometry, passive input and protocol")
        } catch {
            fputs("FAIL \((error as? FleetFailure)?.message ?? String(describing: error))\n", stderr)
            exit(1)
        }
    }
    static func run() throws {
        guard let screen = NSScreen.screens.first else { throw FleetFailure("probe", "A graphical Mac session is required") }
        let assets = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("build/app")
        let coordinator = try FleetDesktop(assets: assets, send: { _, _ in }, show: {}, hide: { false })
        defer { coordinator.close() }
        let info = try coordinator.invoke("desktop.info", [:]) as! [String: Any]
        try check((info["layers"] as? [String]) == ["desktop", "floating", "wallpaper"], "Native capability must expose all three layers")
        let wallpaperLevel = FleetSceneSurface.windowLevel("wallpaper").rawValue
        let desktopLevel = FleetSceneSurface.windowLevel("desktop").rawValue
        try check(wallpaperLevel > Int(CGWindowLevelForKey(.desktopWindow)), "Wallpaper must stay above the background")
        try check(wallpaperLevel < Int(CGWindowLevelForKey(.desktopIconWindow)), "Wallpaper must stay below icons")
        try check(desktopLevel > Int(CGWindowLevelForKey(.desktopIconWindow)) && desktopLevel < NSWindow.Level.normal.rawValue, "Desktop must be above icons and below apps")
        let bounds = NSRect(x: screen.frame.minX, y: screen.frame.minY, width: 300, height: 200)
        let viewport = NSRect(x: -300, y: 50, width: 300, height: 200)
        let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
        var surfaces: [FleetSceneSurface] = []
        defer { for surface in surfaces { surface.close() } }
        for layer in ["wallpaper", "floating", "desktop", "wallpaper"] {
            let surface = FleetSceneSurface(display: "synthetic", viewport: viewport, nativeBounds: bounds, layer: layer, assets: assets)
            surfaces.append(surface)
            try check(!surface.web.isOpaque, "The full-screen scene web view must not paint an opaque background over the wallpaper")
            let card = FleetSceneFrame.Card(id: "paper", layer: layer, rect: NSRect(x: -280, y: 70, width: 120, height: 80), interactive: false, draggable: false)
            surface.apply(FleetSceneFrame(sequence: 1, topology: 0, cards: [card]))
            try check(surface.panel.isVisible && surface.panel.frame == bounds, "Showing a layer must preserve screen geometry")
            let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
            let native = windows.first { ($0[kCGWindowNumber as String] as? Int) == surface.panel.windowNumber }
            try check((native?[kCGWindowLayer as String] as? Int) == surface.panel.level.rawValue, "WindowServer must apply the requested level")
            try check(surface.panel.ignoresMouseEvents && !surface.panel.canBecomeKey, "Passive paper must not receive input")
            if layer == "wallpaper" {
                // Defense in depth even if an internal caller bypasses the JSON validator.
                surface.apply(FleetSceneFrame(sequence: 2, topology: 0, cards: [.init(id: "paper", layer: layer, rect: card.rect, interactive: true, draggable: true)]))
                surface.focus()
                try check(!surface.panel.canBecomeKey && !surface.panel.isKeyWindow, "Wallpaper must refuse focus")
                try check(!NSApplication.shared.windows.contains { $0.isVisible && $0 is FleetScenePanel && !$0.ignoresMouseEvents }, "Wallpaper must not create input panels")
            }
            surface.hide(); surface.apply(FleetSceneFrame(sequence: 3, topology: 0, cards: [card]))
            try check(surface.panel.frame == bounds, "Hide/show must preserve screen geometry")
            surface.hide()
        }
        try check(NSWorkspace.shared.frontmostApplication?.processIdentifier == front, "Passive layer operations must not activate the app")
        let session = FleetProtocol.uuid()
        var card: [String: Any] = ["id": "paper", "groupId": "group", "text": "Synthetic layer probe", "color": "#ff7799",
            "rect": ["x": -280, "y": 70, "width": 120, "height": 80], "layer": "wallpaper",
            "interactive": false, "draggable": false, "editing": false, "selected": false, "completed": false, "mine": false]
        func parse(_ card: [String: Any]) throws -> FleetSceneFrame {
            try FleetSceneFrame.parse(FleetProtocol.encode(["protocol": 1, "sessionId": session, "sequence": 1, "topology": 0,
                "workspaceRevision": 1, "layoutRevision": 1, "groups": [], "cards": [card]]), session: session, previous: -1)
        }
        _ = try parse(card)
        for flag in ["interactive", "draggable", "editing"] {
            card[flag] = true
            do { _ = try parse(card); throw FleetFailure("probe", "Interactive wallpaper was accepted") }
            catch let failure as FleetFailure { try check(failure.code == "scene-frame", "Wallpaper validation must reject every input flag") }
            card[flag] = false
        }
    }
}
