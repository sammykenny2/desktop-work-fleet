import AppKit

@main @MainActor struct UpdatePresentationProbe {
    static func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        if !condition() { throw NSError(domain: "UpdatePresentationProbe", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    static func main() async {
        let name = CommandLine.arguments.dropFirst().first ?? ""
        do {
            switch name {
            case "placement": try placement()
            case "activation": try await activation()
            case "windows": try windows()
            default: throw NSError(domain: "UpdatePresentationProbe", code: 2)
            }
            print("PASS " + name)
        } catch { fputs("FAIL \(error.localizedDescription)\n", stderr); exit(1) }
    }

    static func placement() throws {
        let primary = NSRect(x: 0, y: 60, width: 1440, height: 815)
        let left = NSRect(x: -1920, y: 25, width: 1920, height: 1055)
        let above = NSRect(x: 100, y: 1000, width: 1200, height: 900)
        let alert = NSRect(x: 0, y: 0, width: 520, height: 310)
        let areas = [primary, left, above]
        for area in areas {
            let frame = PinItAnywhereUpdatePresentation.position(alert, preferred: area, center: nil, areas: areas)
            try require(frame.midX == area.midX && frame.midY == area.midY, "Center on the invoking display, including negative origins")
            try require(area.contains(frame), "The alert must stay outside the menu bar and Dock")
        }
        let moved = NSPoint(x: -400, y: 700)
        let progress = PinItAnywhereUpdatePresentation.position(NSRect(x: 0, y: 0, width: 400, height: 130), preferred: primary, center: moved, areas: areas)
        try require(progress.midX == moved.x && progress.midY == moved.y, "A later stage preserves the center after a user moves the offer")
        let edge = PinItAnywhereUpdatePresentation.position(alert, preferred: left, center: NSPoint(x: -1900, y: 1050), areas: areas)
        try require(left.contains(edge), "Clamp all edges to the chosen work area")
        let unplugged = PinItAnywhereUpdatePresentation.position(alert, preferred: left, center: moved, areas: [primary])
        try require(primary.contains(unplugged), "Unplugging the invoking display cannot strand the dialog")
        let unchanged = PinItAnywhereUpdatePresentation.position(alert, preferred: nil, center: nil, areas: [])
        try require(unchanged == alert, "No display must not invent coordinates")
        let oversized = PinItAnywhereUpdatePresentation.position(NSRect(x: 0, y: 0, width: 2000, height: 1500), preferred: primary, center: nil, areas: [primary])
        try require(oversized.minX == primary.minX && oversized.maxY == primary.maxY, "Oversized native alerts keep their title bar reachable")
    }

    static func activation() async throws {
        var events: [String] = []
        let immediate = PinItAnywhereUpdateActivation()
        let ready = await immediate.wait { focused in
            events.append("create"); focused(); events.append("requested")
            return { events.append("destroy") }
        }
        events.append("dialog")
        try require(ready && events == ["create", "requested", "destroy", "dialog"], "Even synchronous focus releases the helper before the alert")

        events = []
        let delayed = PinItAnywhereUpdateActivation()
        let activated = await delayed.wait(nanoseconds: 500_000_000) { focused in
            events.append("create")
            Task { try? await Task.sleep(nanoseconds: 5_000_000); events.append("focus"); focused() }
            return { events.append("destroy") }
        }
        events.append("dialog")
        try require(activated && events == ["create", "focus", "destroy", "dialog"], "The dialog must wait for activation")

        var released = 0
        let timeout = PinItAnywhereUpdateActivation()
        let timedOut = await timeout.wait(nanoseconds: 1_000_000) { _ in { released += 1 } }
        try require(!timedOut && released == 1, "Activation timeout must release its window and permit a fallback")
        timeout.finish(true)
        try require(released == 1, "A late focus cannot resume a completed request twice")

        let cancelled = PinItAnywhereUpdateActivation()
        let cancelledResult = await cancelled.wait { focused in
            Task { cancelled.finish(false); focused() }
            return { released += 1 }
        }
        try require(!cancelledResult && released == 2, "Quitting cancels activation and cleans up once")
        let alreadyCancelled = PinItAnywhereUpdateActivation(); alreadyCancelled.finish(false)
        let neverStarted = await alreadyCancelled.wait { _ in fatalError("A cancelled request created a window") }
        try require(!neverStarted, "Cancellation before activation cannot open a helper")
    }

    /// These are real, never-ordered AppKit windows in a separate process. No app, data or desktop is controlled.
    static func windows() throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        let notifications = NotificationCenter()
        var active = true
        var areas = [NSRect(x: 0, y: 40, width: 1200, height: 760)]
        let presenter = PinItAnywhereUpdatePresentation(notifications: notifications, isActive: { active }, areas: { areas })
        let main = NSWindow(contentRect: NSRect(x: 23, y: 81, width: 900, height: 600), styleMask: .titled, backing: .buffered, defer: false)
        let mainFrame = main.frame
        let offer = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 500, height: 300), styleMask: .titled, backing: .buffered, defer: false)
        let behavior = offer.collectionBehavior
        presenter.track(offer)
        try require(offer.parent == nil, "Update prompts must remain independent, never sheets on an activation window")
        try require(offer.level.rawValue > NSWindow.Level.floating.rawValue, "Active update UI must be above floating notes")
        try require(areas[0].contains(offer.frame), "Initial placement must be reachable")
        try require(!main.isVisible && main.frame == mainFrame && !offer.isVisible, "Presentation configuration must not reveal or move the main window")
        active = false
        notifications.post(name: NSApplication.didResignActiveNotification, object: nil)
        try require(offer.level == .normal, "Updates must not stay above another app after focus leaves")
        active = true
        notifications.post(name: NSApplication.didBecomeActiveNotification, object: nil)
        try require(offer.level.rawValue > NSWindow.Level.floating.rawValue && !offer.isVisible, "Restoring levels must not show or focus a window")

        offer.setFrameOrigin(NSPoint(x: 300, y: 300))
        notifications.post(name: NSWindow.didMoveNotification, object: offer)
        let progress = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 100), styleMask: .titled, backing: .buffered, defer: false)
        presenter.track(progress)
        try require(progress.frame.midX == offer.frame.midX && progress.frame.midY == offer.frame.midY, "Progress follows the user's chosen center")
        progress.setFrame(NSRect(x: 1100, y: 720, width: 600, height: 200), display: false)
        notifications.post(name: NSWindow.didResizeNotification, object: progress)
        try require(areas[0].contains(progress.frame), "Resizing native update content must not put its buttons off-screen")
        areas = [NSRect(x: -900, y: -800, width: 900, height: 700)]
        notifications.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
        try require(areas[0].contains(offer.frame) && areas[0].contains(progress.frame), "Display removal must clamp each managed window without activation")
        let ready = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 80), styleMask: .titled, backing: .buffered, defer: false)
        presenter.track(ready)
        try require(ready.frame.midX == progress.frame.midX && ready.frame.midY == progress.frame.midY, "The next stage retains the corrected center after display removal")
        ready.setFrameOrigin(NSPoint(x: 4000, y: 4000))
        notifications.post(name: NSWindow.didDeminiaturizeNotification, object: ready)
        try require(areas[0].contains(ready.frame) && !ready.isVisible, "A restored updater is clamped without showing any window itself")
        presenter.endSession()
        try require(offer.level == .normal && progress.level == .normal && offer.collectionBehavior == behavior, "Finishing restores original window properties")
        try require(!main.isVisible && main.frame == mainFrame, "The main window stays untouched for the entire update session")
        presenter.suspend(); try require(presenter.stopping, "Quit prevents later presentation")
        presenter.resume(); try require(!presenter.stopping, "A refused quit permits a later explicit check")
    }
}
