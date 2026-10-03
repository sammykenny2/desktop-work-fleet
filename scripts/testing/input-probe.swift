// Public-API test helper. Requires macOS Input Monitoring/Accessibility authorization
// for this process to post events; it never requests or changes TCC permissions.
import AppKit
import ApplicationServices
final class Target: NSView {
  var downs = 0, drags = 0, ups = 0, keys = 0
  override var acceptsFirstResponder: Bool { true }
  override func mouseDown(with event: NSEvent) { downs += 1 }
  override func mouseDragged(with event: NSEvent) { drags += 1 }
  override func mouseUp(with event: NSEvent) { ups += 1 }
  override func keyDown(with event: NSEvent) { keys += 1 }
  override func draw(_ rect: NSRect) {
    NSColor(calibratedRed: 0.82, green: 0.91, blue: 0.97, alpha: 1).setFill(); bounds.fill()
    ("Work Fleet input target\nSynthetic test data only" as NSString).draw(at: NSPoint(x: 20, y: 30),
      withAttributes: [.font: NSFont.systemFont(ofSize: 20), .foregroundColor: NSColor.black])
  }
}
final class Probe: NSObject, NSApplicationDelegate {
  var window: NSWindow!
  let target = Target()
  func applicationDidFinishLaunching(_ note: Notification) {
    let allowed = CGPreflightPostEventAccess()
    print("{\"event\":\"input_permission\",\"allowed\":\(allowed)}"); fflush(stdout)
    guard allowed else { NSApp.terminate(nil); return }
    let screen = NSScreen.main!.visibleFrame
    window = NSWindow(contentRect: NSRect(x: screen.maxX - 470, y: screen.maxY - 540, width: 440, height: 500),
      styleMask: [.titled], backing: .buffered, defer: false)
    window.title = "Work Fleet validation input target"
    window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)))
    window.contentView = target
    window.makeKeyAndOrderFront(nil); window.makeFirstResponder(target); NSApp.activate(ignoringOtherApps: true)
    let y = NSScreen.screens[0].frame.maxY - (screen.maxY - 330)
    let point = CGPoint(x: screen.maxX - 280, y: y)
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
      let source = CGEventSource(stateID: .hidSystemState)
      for type in [CGEventType.leftMouseDown, .leftMouseDragged, .leftMouseUp] {
        CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
      }
      CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)?.post(tap: .cghidEventTap)
      CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)?.post(tap: .cghidEventTap)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
      print("{\"event\":\"underlay_input\",\"downs\":\(self.target.downs),\"drags\":\(self.target.drags),\"ups\":\(self.target.ups),\"keys\":\(self.target.keys)}"); fflush(stdout)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 13) { NSApp.terminate(nil) }
  }
}
let app = NSApplication.shared
let delegate = Probe()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
