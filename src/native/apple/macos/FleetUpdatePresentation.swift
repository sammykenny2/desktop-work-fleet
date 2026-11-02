import AppKit
import ObjectiveC

/// A bounded activation attempt. Cleanup happens before the caller can show its actual dialog.
@MainActor final class FleetUpdateActivation {
    private var continuation: CheckedContinuation<Bool, Never>?
    private var cleanup: (() -> Void)?
    private var timeout: Task<Void, Never>?
    private var installing = false
    private var result: Bool?

    func wait(nanoseconds: UInt64 = 1_000_000_000, install: (@escaping () -> Void) -> (() -> Void)) async -> Bool {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            if result != nil { complete(); return }
            installing = true
            cleanup = install { [weak self] in self?.finish(true) }
            installing = false
            if result != nil { complete() }
            else {
                timeout = Task { [weak self] in
                    do { try await Task.sleep(nanoseconds: nanoseconds) } catch { return }
                    self?.finish(false)
                }
            }
        }
    }
    func finish(_ activated: Bool) {
        guard result == nil else { return }
        result = activated
        if !installing { complete() }
    }
    private func complete() {
        guard let result, let continuation else { return }
        self.continuation = nil
        timeout?.cancel(); timeout = nil
        let release = cleanup; cleanup = nil; release?()
        continuation.resume(returning: result)
    }
}

/// Owns only update UI. It never shows, restores, moves or reparents the main window.
@MainActor final class FleetUpdatePresentation {
    private final class ActivationWindow: NSWindow {
        override var canBecomeKey: Bool { true }
        override var canBecomeMain: Bool { false }
    }
    @MainActor private final class Entry {
        weak var window: NSWindow?
        let level: NSWindow.Level
        let behavior: NSWindow.CollectionBehavior
        var receivedKey = false
        init(_ window: NSWindow) { self.window = window; level = window.level; behavior = window.collectionBehavior }
    }
    private let notifications: NotificationCenter
    private let isActive: @MainActor () -> Bool
    private let areas: @MainActor () -> [NSRect]
    private var observers: [NSObjectProtocol] = []
    private var windows: [ObjectIdentifier: Entry] = [:]
    private weak var latestWindow: NSWindow?
    private var activation: FleetUpdateActivation?
    private var generation = 0
    private var tracking = false
    private var modalDepth = 0
    private var placing = false
    private var preferredArea: NSRect?
    private var center: NSPoint?
    private(set) var stopping = false

    init(notifications: NotificationCenter = .default, isActive: @escaping @MainActor () -> Bool = { NSApp.isActive },
         areas: @escaping @MainActor () -> [NSRect] = { NSScreen.screens.map(\.visibleFrame) }) {
        self.notifications = notifications; self.isActive = isActive; self.areas = areas
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didChangeOcclusionStateNotification] {
            observe(name) { [weak self] note in self?.shown(note) }
        }
        observe(NSWindow.didMoveNotification) { [weak self] note in self?.moved(note) }
        for name in [NSWindow.didResizeNotification, NSWindow.didDeminiaturizeNotification] {
            observe(name) { [weak self] note in
                guard let self, !self.placing, let window = note.object as? NSWindow, self.windows[ObjectIdentifier(window)] != nil else { return }
                self.clamp(window)
            }
        }
        observe(NSWindow.willCloseNotification) { [weak self] note in self?.closed(note) }
        for name in [NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification] {
            observe(name) { [weak self] _ in self?.updateLevels() }
        }
        observe(NSApplication.didChangeScreenParametersNotification) { [weak self] _ in self?.displaysChanged() }
    }
    deinit { for observer in observers { notifications.removeObserver(observer) } }
    private func observe(_ name: Notification.Name, _ action: @escaping @MainActor (Notification) -> Void) {
        observers.append(notifications.addObserver(forName: name, object: nil, queue: .main) { note in
            MainActor.assumeIsolated { action(note) }
        })
    }

    /// Capture the invoking display before the network request. A menu-bar request follows the pointer;
    /// a Settings request follows its visible owner. No global main-window activation is used as an anchor.
    static func requestedArea(owner: NSWindow? = nil) -> NSRect? {
        if let owner, owner.isVisible, !owner.isMiniaturized, let screen = owner.screen { return screen.visibleFrame }
        return NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) }?.visibleFrame
            ?? NSScreen.main?.visibleFrame
    }

    func prepare(on area: NSRect?) async -> Bool {
        guard !stopping else { return false }
        generation += 1; let request = generation
        activation?.finish(false)
        if !tracking { center = nil }
        preferredArea = area; tracking = true
        let attempt = FleetUpdateActivation(); activation = attempt
        _ = await attempt.wait { ready in
            let frame = Self.position(NSRect(x: 0, y: 0, width: 1, height: 1), preferred: area, center: nil, areas: self.areas())
            let window = ActivationWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false; window.isOpaque = false; window.backgroundColor = .clear
            window.hasShadow = false; window.ignoresMouseEvents = true; window.isExcludedFromWindowsMenu = true
            window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
            let check = { if NSApp.isActive && window.isKeyWindow { ready() } }
            let active = self.notifications.addObserver(forName: NSApplication.didBecomeActiveNotification, object: NSApp, queue: .main) { _ in
                MainActor.assumeIsolated { check() }
            }
            let key = self.notifications.addObserver(forName: NSWindow.didBecomeKeyNotification, object: window, queue: .main) { _ in
                MainActor.assumeIsolated { check() }
            }
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            check()
            return {
                self.notifications.removeObserver(active); self.notifications.removeObserver(key)
                window.orderOut(nil); window.close()
            }
        }
        guard request == generation, !stopping else { return false }
        activation = nil
        // Activation is best effort after the bounded wait; an explicit request must not hang forever.
        return true
    }

    func track(_ window: NSWindow) {
        let id = ObjectIdentifier(window)
        guard windows[id] == nil else { return }
        windows[id] = Entry(window)
        latestWindow = window
        window.collectionBehavior.remove(.canJoinAllSpaces)
        window.collectionBehavior.formUnion([.moveToActiveSpace, .fullScreenAuxiliary])
        place(window); updateLevels()
    }
    func show(_ alert: NSAlert) {
        guard !stopping else { return }
        alert.layout(); track(alert.window)
        alert.runModal()
        release(alert.window)
    }
    func beginModal() { modalDepth += 1 }
    func endModal() { modalDepth = max(0, modalDepth - 1) }
    func endSession() {
        tracking = false; modalDepth = 0; center = nil
        for entry in windows.values { if let window = entry.window { restore(window, entry) } }
        windows.removeAll(); latestWindow = nil
    }
    func suspend() {
        stopping = true; generation += 1
        activation?.finish(false); activation = nil
    }
    func resume() { stopping = false }

    private func shown(_ note: Notification) {
        guard tracking, !stopping, let window = note.object as? NSWindow, window.isVisible, !window.isMiniaturized else { return }
        let updater = window.windowController.map(Self.isUpdaterController) ?? false
        guard windows[ObjectIdentifier(window)] != nil || updater || (modalDepth > 0 && NSApp.modalWindow === window) else { return }
        track(window)
        if note.name == NSWindow.didBecomeKeyNotification, let entry = windows[ObjectIdentifier(window)], !entry.receivedKey {
            // NSAlert may choose its default frame inside runModal. Correct that first placement once,
            // not on every later focus, which would undo a user's drag or restore a minimized window.
            entry.receivedKey = true; latestWindow = window; place(window)
        }
    }
    private static func isUpdaterController(_ controller: NSWindowController) -> Bool {
        // Cocoa bindings can install a runtime KVO subclass whose own bundle is not Sparkle.
        // Walk public class metadata instead of depending on Sparkle's private controller names.
        var type: AnyClass? = Swift.type(of: controller)
        while let current = type {
            if Bundle(for: current).bundleIdentifier == "org.sparkle-project.Sparkle" { return true }
            type = class_getSuperclass(current)
        }
        return false
    }
    private func moved(_ note: Notification) {
        guard !placing, let window = note.object as? NSWindow, windows[ObjectIdentifier(window)] != nil else { return }
        latestWindow = window
        center = NSPoint(x: window.frame.midX, y: window.frame.midY)
    }
    private func closed(_ note: Notification) {
        guard let window = note.object as? NSWindow else { return }
        release(window)
    }
    private func release(_ window: NSWindow) {
        guard let entry = windows.removeValue(forKey: ObjectIdentifier(window)) else { return }
        center = NSPoint(x: window.frame.midX, y: window.frame.midY)
        restore(window, entry)
    }
    private func restore(_ window: NSWindow, _ entry: Entry) { window.level = entry.level; window.collectionBehavior = entry.behavior }
    private func updateLevels() {
        for entry in windows.values {
            guard let window = entry.window else { continue }
            // Above this app's floating notes while active; no always-on-top update window over other apps.
            window.level = isActive() ? NSWindow.Level(rawValue: max(entry.level.rawValue, NSWindow.Level.floating.rawValue + 1)) : entry.level
        }
    }
    private func place(_ window: NSWindow) {
        placing = true; defer { placing = false }
        window.setFrameOrigin(Self.position(window.frame, preferred: preferredArea, center: center, areas: areas()).origin)
    }
    private func displaysChanged() {
        for entry in windows.values {
            guard let window = entry.window, !window.isMiniaturized else { continue }
            clamp(window)
        }
    }
    private func clamp(_ window: NSWindow) {
        placing = true; defer { placing = false }
        let point = NSPoint(x: window.frame.midX, y: window.frame.midY)
        window.setFrameOrigin(Self.position(window.frame, preferred: preferredArea, center: point, areas: areas()).origin)
        if window === latestWindow { center = NSPoint(x: window.frame.midX, y: window.frame.midY) }
    }
    /// AppKit coordinates may be negative. Keep the native size and clamp into the display's usable area.
    /// An oversized fixed-size alert keeps its title bar on screen rather than clipping its native layout.
    static func position(_ frame: NSRect, preferred: NSRect?, center: NSPoint?, areas: [NSRect]) -> NSRect {
        guard !areas.isEmpty else { return frame }
        let point = center ?? preferred.map { NSPoint(x: $0.midX, y: $0.midY) }
        let area = point.flatMap { point in areas.first { NSMouseInRect(point, $0, false) } }
            ?? preferred.flatMap { wanted in areas.first { $0.intersects(wanted) } } ?? areas[0]
        let target = center ?? NSPoint(x: area.midX, y: area.midY)
        let x = max(area.minX, min(target.x - frame.width / 2, area.maxX - frame.width))
        let y = frame.height > area.height ? area.maxY - frame.height : max(area.minY, min(target.y - frame.height / 2, area.maxY - frame.height))
        return NSRect(origin: NSPoint(x: x, y: y), size: frame.size)
    }
}
