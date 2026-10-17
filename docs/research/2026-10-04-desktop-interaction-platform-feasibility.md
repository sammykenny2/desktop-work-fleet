# Group floating, drag to change group and region hints: platform capability review

- Date/external documents reviewed: 2026-10-04.
- Scope: Windows, macOS, and Raspberry Pi OS + labwc/Wayland, for which reports already exist.
- Nature: review of public capabilities + source code/existing reports; this round ran no new desktop interaction and
  installed no dependencies.
- Requirements entry point: [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md).
- Presentation proposal: [ADR-007](../decisions/007-desktop-scene-and-platform-host.md).

## 1. Conclusions and evidence levels

Dragging a card, determining the group region, drawing the highlight and updating membership on drop can be shared
semantics for the three target environments above.
This is a feasibility judgment backed by APIs/protocols and existing implementations, not acceptance of the new
feature on three platforms.
Linux support must be stated per compositor and feature capability; "has Wayland" is not a sufficient condition.

| Level | Use in this document |
|---|---|
| Public capability | Interfaces or limits provided by official documentation/protocols |
| Existing code | Implementations readable in the current checkout; does not mean every branch was tested |
| External report | Test records already in the auxiliary reference project; this repo did not rerun them and does not count them as this product passing |
| Design inference | A renderer/host approach proposed from the capabilities; needs acceptance after implementation and packaging |

## 2. Platform matrix

| Feature | Windows | macOS | Recorded labwc/Wayland |
|---|---|---|---|
| App tracks its own drags | Win32 capture/events | AppKit mouseDown/Dragged/Up | surface-local pointer; existing report has drag tests |
| Self-drawn target highlight | App drawing | App drawing | App buffer/renderer drawing |
| Temporarily float above ordinary apps | Native floating layer available; final product needs acceptance | Public window level path; new group floating still needs acceptance | Reported Top layer is above ordinary windows |
| Mouse pass-through in the normal state | Host must handle window input correctly | Public ignoresMouseEvents available | input region; report has a fix after layer switching |
| Arbitrary relative card stacking | Native or renderer can handle | Native or renderer can handle | Order of independent surfaces in one layer is undefined; prefer renderer control |
| Global group shortcuts | Configurable/registration result can be checked | Needs a public shortcut approach and packaging verification | Compositor bindings/supported portal; X11 key grabs cannot be reused |
| Complete new group-change gesture | Not implemented/not accepted | Not implemented/not accepted | Not implemented/not accepted |
| Across displays and mixed scaling | Needs separate tests | Needs separate tests | External report did not verify a dual-display Pi |

The highlight is color blocks/outlines and text; it needs no native frosted effect or background capture.
The reference app's existing drag does not mean nine groups, formation, Shift group changes and transactional undo
already exist.

## 3. Windows

Microsoft documents mouse capture: after a press, tracking continues, drag events still arrive outside the window,
and release ends it.
Capture is limited to the foreground window and a single capturer; a background pass-through window cannot be assumed
to receive every event at will.
A group operation must first enter a valid interaction state; lost capture must also have a cancel path.
Sources: [Mouse movement](https://learn.microsoft.com/en-us/windows/win32/learnwin32/mouse-movement),
[SetCapture](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setcapture).

SetWindowPos can change native window order/topmost; it is one of the capabilities for temporary floating,
not a full guarantee of desktop embedding, ordering relative to icons, or packaging.
Source: [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos).

Design inference: a drag controller can convert events to device logical coordinates, decide the target from its own
region table, and let the renderer show the hint. Global shortcuts and Shift during a drag are different event paths
and must not be mixed.
Older experience with Windows desktop attachment, styles rewritten by the framework, DPI and focus only gives
directions to check; Win32 having SetWindowPos is no ground to claim every desktop layer or Store packaging is done.

## 4. macOS

AppKit's public mouseDown, mouseDragged, mouseUp and coordinate conversion can handle the app's own drags;
the events can also tell whether a region was entered and request a redraw.
Source: [Handling Mouse Events](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/EventOverview/HandlingMouseEvents/HandlingMouseEvents.html).

NSWindow.ignoresMouseEvents is a public whole-window mouse pass-through property.
That does not prove that parts of an arbitrary full-screen transparent window can pass clicks through; the partial
hit-testing strategy must be verified by the chosen host.
Source: [ignoresMouseEvents](https://developer.apple.com/documentation/appkit/nswindow/ignoresmouseevents).

This repo's [0.1.0 report](../validation/2026-10-03-validation-report.md) has evidence for public AppKit, Sandbox,
real data updates and the locked/unlocked flag; the report also lists untested scope such as real desktop gestures and
displays.
A historical probe passing does not imply that new interactions, Google OAuth or App Store approval pass too.

Design inference: this group change + highlight needs no new private API, screen recording or watching other apps'
content.
The real keyboard shortcut/focus/window layer strategy must still be confirmed item by item against the chosen public
APIs, Sandbox and packaging.
Broad permissions such as Accessibility must not be added just to make shortcuts convenient.

## 5. labwc/Wayland: concrete experience and limits

### 5.1 Environment of the existing reports

The external reports describe a Raspberry Pi 5, Raspberry Pi OS (Debian 13 trixie, arm64),
labwc 0.20.2/wlroots 0.20, pcmanfm-pi, WebKitGTK 2.54 and gtk-layer-shell 0.9.0.
The data comes from the auxiliary reference checkout read in this round; its location is not hardcoded in this repo,
and how to obtain it is in section 8.

The reports record:

- The Bottom layer is above the icons and below ordinary windows; after ending an operation, clicks pass through to
  the desktop.
- On the Top layer, dragging above a terminal, entering editing and saving work.
- The logical position must be tracked by the app; the real coordinates cannot be obtained from an ordinary
  toplevel's outer_position.
- In that environment WebKit's screenX/screenY are surface-relative; dragging needs a fixed grab point and handling of
  configure timing.
- An input region set directly on a lower-level window can be overwritten when GTK reconfigures; a durable
  widget/input-region path and redraws are needed.
- There are transparent redraw/GPU buffer problems; after the fixes, fast and slow drag results are recorded; a new
  renderer still needs its own evidence.
- When the wallpaper and icons are on the same surface, nothing can be inserted below the icons; a Wallpaper
  capability must not be falsely reported.
- Multiple displays were not tested on a dual-display Pi.

This is external evidence of basic behavior; no code is copied, and its successes do not count as this repo's
acceptance.

### 5.2 Surface order within a layer is not guaranteed

wlr-layer-shell provides layers such as background, bottom, top and overlay,
but the relative order of several surfaces within one layer is explicitly undefined.
So the creation order of independent native windows, hide/show or re-mapping cannot serve as a stable cycling
contract.
Source: [protocol text](https://github.com/swaywm/sway/blob/master/protocols/wlr-layer-shell-unstable-v1.xml).

Design inference: especially on Wayland, the cards on one output and one system layer should be controlled by a shared
drawing surface or equivalent subsurfaces with an explicit order; card z-order becomes the app's data and drawing
order instead of a guess at the OS surface order.
The active group can move to a floating presentation layer while the other groups stay on their layer; moving the
presentation does not change card identity or logical geometry.

### 5.3 Hit-testing and input

Wayland's surface-local coordinates and input regions are enough for our own target detection.
Events outside the input region go to the next surface; this supports a design in which a transparent hint layer does
not block the whole desktop.
Highlight drawing should be kept apart from the interactive hit area; not every visible color block may be set to
capture events.
Source: [Wayland protocol: set_input_region](https://wayland.freedesktop.org/docs/html/apa.html).

GTK layer-shell also provides keyboard interactivity settings; take the needed keyboard capability only during
suitable operations/editing, and never take other apps' input with an exclusive keyboard while resident in the
background.
Source: [GTK Layer Shell API](https://wmww.github.io/gtk-layer-shell/).

### 5.4 Global shortcuts are not "registered, so done"

In the external report, an X11 grab received no keys while a Wayland app had focus, even though the registration call
succeeded.
That environment binds program commands in the labwc configuration; this can be a reachable alternative entry for the
new product, with command names designed independently.
If the runtime/desktop provides the GlobalShortcuts portal, its session/actions and user configuration can be used.
We do not claim every compositor has the same portal backend, and we do not change the user's desktop settings on our
own.
Source: [Global Shortcuts portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html).

### 5.5 Linux support scope

GTK layer-shell officially lists the kinds of Wayland compositors it supports, and states that GNOME-on-Wayland and
X11 do not use this library path. Other environments need their own backend or a clear ordinary-window alternative;
the labwc results must not be labeled "native desktop notes supported on all Linux".
Source: [official support scope](https://github.com/wmww/gtk-layer-shell#supported-desktops).

The same source lists the library as LGPL-3.0-or-later; this is only license information for a candidate Linux
component, not a requirement that the whole project change to that license, and not a completed adoption review.
Before adoption, confirm the version, the actual linking/distribution method, notices and source obligations;
the reference app or this repo being labeled MIT is no reason to skip the inventory of transitive dependencies.

## 6. Minimum responsibilities of a platform host

| Responsibility | Acceptable result |
|---|---|
| Coordinates | Converts to unified logical coordinates, clearly distinguishing screen/surface/client/pixel/point |
| Drag tracking | Normal end, cancel and capture lost all clean up; at most one command per drop |
| Layer policy | Group operations float temporarily; on exit, restore by the persisted layer; never persist the temporary topmost |
| Input regions | Cards not being operated and the empty desktop still pass clicks through; hints do not intercept drag events |
| Focus | Starting to edit accepts input; background sync takes no focus; exit leaves no ghost keyboard grab |
| Shortcuts | Reports available, conflicting or unsupported for the actual backend; has an alternative entry |
| Displays | Output choice, scaling and recovery from disconnection are recorded; untested is stated as untested |
| Capability report | Concrete backend/version/features; never fills in true from the OS name |

## 7. The next acceptance is not a rerun of old probes

First freeze the shared semantics and the candidate renderer/host contract, then build a real vertical slice with the
same card fixture.
Prove on the three platforms, step by step: float the chosen group → select a card/cycle → drag → highlight → change
group → edit → exit to pass-through.
The matrix, expected results and failure scenarios for this are already defined in SPEC-003's C01–C48.
An ordinary browser demo can prove the gesture and ordering model; it does not prove native desktop
layering/pass-through or store compliance.
Use the existing experience with public Mac APIs, and avoid restarting the previously paused exploratory goal.

## 8. Obtaining and recording the auxiliary source

This document does not hardcode the external reference repo's name, remote URL or checkout path.
When the original implementation is needed, ask the maintainer "where is the auxiliary desktop-interaction reference
project now?"
After obtaining it, read its license and index first, then review these topics:

- the 2026-10-02/03 Linux records on layer-shell, pointer coordinates, redraws, input regions and shortcuts;
- the override precedence of display/global operation/read-only text selection/per-card layering;
- Windows native attachment, style resets and DPI problems;
- Mac layer/focus timing and the boundaries of the existing private API dependencies.

Record only the conclusions and reproducible scenarios this product needs; do not import its source tree, UI, data
format or tests as our implementation.
If any actual third-party code is adopted, record its real provenance/license separately;
a neutral reference name cannot be used to omit legal notices that must be kept.
