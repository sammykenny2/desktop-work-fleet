# ADR-058: Desktop presentation lifecycle and an independent resident core

## Status

Proposed, 2026-10-20. The maintainer requested an ADR, SPEC and PLAN before implementation.
The requested direction is to remove the whole-app crash reopen permanently and wait for a usable display
environment before starting or resuming presentation. Process isolation and the implementation choices below are
proposals for review. This document authorizes no runtime change.

The contract is [SPEC-009](../specs/009-desktop-presentation-lifecycle.md); execution is tracked only by
[PLAN-009](../plans/009-desktop-presentation-lifecycle.md).

## Context

### Evidence and its limits

- The Windows installed 0.3.3 log on 2026-10-20 records a sign-in start on runtime 10.0.13 at 05:22:57 +08:00.
  It enumerates `WinDisc`, 2560 by 1306 at 96 DPI; physical display configuration is unreadable. Scenes begin
  attaching at 05:23:05, followed by `0x8876086A` in WebView2's `Direct3DHelper.CreateD3D9Device` at 05:23:06.
  Windows Application Error and .NET Runtime events corroborate the failure. CrashGuard detached the scene windows
  from Explorer before terminating. This is a device-initialization failure, distinct from the earlier
  `0x88980406` render-thread failure investigated in ADR-050.
- Separately, the maintainer reports using RustDesk to reach a Pi whose attached monitor is powered off; earlier
  successful sessions used Guacamole. No Pi log was obtained in this investigation. The Pi's backend, Guacamole
  protocol and RustDesk virtual-display configuration have not been verified. These observations do not establish
  that the Pi has the Windows failure or that either remote-access product always provides or lacks a display.
- A listed desktop does not prove that the chosen renderer can create its graphics resources. Conversely, a failed
  physical-topology query does not prove that rendering is unavailable. Microsoft's `QueryDisplayConfig` contract
  explicitly allows access failure in a remote session. A powered-off monitor is not itself a readiness test.
- Environment notifications describe changes; they cannot guarantee delivery before device loss. Initialization
  and rendering may fail even after a successful readiness check. WPF render partitions can become unusable, so
  adding an observer inside the same WPF process does not provide failure isolation.

### Existing implementation

The shared Workspace, InteractionController, FileSync scheduling and automatic-backup coordination are assembled
in `src/app/main.js`. The Windows native database survives some browser failures, but keeping SQLite open alone
does not keep those services running. A hidden main WebView is still a graphical dependency.

`NativeDisplayWatcher` already watches display, work-area, power and lid changes; `DesktopCoordinator` coalesces
topology updates and preserves views. Its sign-in hold treats an unreadable physical configuration as no reason
to wait, and its time limit eventually permits attachment. Linux's GTK host and macOS's AppKit host likewise
assemble presentation and service lifetime together. Their actual failure modes require separate evidence.

ADR-045's reopen is disabled in `Program.cs`, but marker handling, relaunch logic and tests remain. Its
detach-before-report protection addresses Explorer safety and is independent of the reopen mechanism.

## Decision

### 1. Give one resident core authority over work

Run one core per user and data directory, within the user's session and existing application lifetime.
It owns the exclusive storage lock, Workspace and command ordering, drafts, sync/outbox, automatic-backup
coordination, credentials and child-process lifetime. Display absence must not initialize, clear or replace data.

The core starts before graphical toolkit or WebView initialization and uses no WPF render thread, GTK display
connection, AppKit window or hidden WebView to execute service logic. Extract the existing ES module services
behind explicit clock, crypto, persistence, transport and notification adapters; do not create a second semantic
implementation in a native language. Select the nonvisual JavaScript host through PLAN-009 Phase 0, with API,
packaging, license and supported-platform evidence, before approving that implementation dependency.

This is a user-session application component, not a privileged system daemon. Existing start-at-sign-in,
close-to-tray and explicit Quit preferences continue to govern its lifetime. Credentials or backup permissions
that require interaction pause only their own operation while no UI is available.

### 2. Make presentation disposable and separate from the core

Main-window and desktop-scene presentation run in child processes. No process with a graphical dependency may
also be the sole data or sync authority. PLAN-009 Phase 0 specifies whether the main window and scenes use one
presentation process or separate ones; either arrangement must contain a fatal graphical failure outside the core.
Native observers that themselves require a live display connection belong in disposable presentation or probe
processes, not in the core's failure boundary.

Use private, authenticated local IPC, restricted to the current user, data directory and intended session.
Preserve ADR-018's single authority: scenes receive projections and fixed commands, not database access,
credentials, arbitrary paths, network requests or code execution. The main-window client gets only its existing
management capabilities. Keep transfer limits, source/profile checks, durable acknowledgements and stale-reply
rejection across the new process boundary. No note server or network listener is introduced.

Only the core can launch its presentation children. Process identity, ownership and an environment generation
prevent duplicate children, stale launches and commands from an obsolete session. A second application launch
forwards user intent to the existing core; another interactive session cannot claim a second writer or receive
that session's private UI data implicitly. Session handover needs an explicit, verified policy before shipping.

### 3. Coordinate readiness continuously

A lifecycle coordinator observes session access, display/backend availability, geometry, graphics capability and
desktop-host availability through platform adapters. Readiness is per presentation capability: a usable main
window does not imply an available wallpaper layer, and unavailable desktop integration must not disable a usable
main window. Virtual displays are eligible. Monitor names, remote-tool names and physical EDID are not allowlists.

Each observation distinguishes available, unavailable and unknown, retaining the API error code. A missing
optional observation can be resolved through another supported observation or an isolated initialization attempt;
it is neither unconditional permission nor a permanent prohibition. Rendering is usable only after the actual
presentation host completes initialization for the current generation.

Follow the lifecycle and bounded recovery policy in SPEC-009. Keep watching while presentation is absent.
Coalesce event bursts, cancel obsolete work and retry transient failures with backoff. Elapsed time never
overrides an unavailable prerequisite. Repeated fatal failures in the same environment latch presentation off
until a material environment change or explicit user retry; successful polling alone cannot reset that budget.

### 4. Preserve work across changes

Geometry-only changes normally suspend pointer input, update layout and reuse the editor. Follow SPEC-003's
reachability and region rules; never run a global formation because a monitor changed. Preserve draft identity,
selection and IME composition wherever the existing view remains valid.

For a planned replacement, drain accepted commands and durably checkpoint drafts before releasing the view.
When a device or child disappears abruptly, recover only data already acknowledged by the core. Input still
inside a failed renderer, including uncommitted IME composition, cannot be promised to survive. Do not report it
as saved or fabricate a successful flush. Headless intervals do not write an empty desktop layout.

### 5. Remove whole-app crash reopen; keep containment and diagnostics

Remove ADR-045's reopen policy, package relaunch, restart-marker production and consumption, previous-process
termination helper, and tests that depend on those paths. A legacy `restart.json` has no activation semantics;
leave it inert rather than introducing a data cleanup or migration. Normal single-instance activation remains.

The core never automatically relaunches itself after its own fatal error. A presentation child can be created
again only through the readiness/retry policy; it cannot reopen the whole application. Explicit Quit, updates
and shutdown cancel pending launches first and prevent recovery from undoing the user's exit.

Retain Windows detach-before-report handling in every child that places windows inside Explorer. Preserve
fatal and lifecycle logs with stable codes, bounded rotation and no note text, account identifiers or secrets.
Removing reopen is not permission to remove crash containment or to swallow unknown exceptions.

### Scope of changes to existing decisions

On approval and implementation, this proposal replaces only these parts of the earlier decisions:

| Record | Intended refinement | Retained contract |
|---|---|---|
| ADR-018 | Move authority out of the main window into the resident core | One Workspace, restricted scenes, durable drafts and command ordering |
| ADR-020 | Distinguish geometry updates from unavailable presentation and device loss | Reachability, topology generations, input suspension and editor reuse |
| ADR-043 / SPEC-006 | Route activation and application lifetime through the core | User preferences, window placement, focus rules and explicit exit |
| ADR-045 | Permanently remove whole-app reopen and restart markers | Detach from Explorer before fatal reporting and diagnostic logging |
| ADR-046 | Replace sign-in-only, time-limited permission with continuous readiness | Observe real environment changes and explain waiting |
| ADR-049 / ADR-050 | Contain failures beyond a rendering-mode/runtime workaround | Current rendering mode and runtime pins until separately changed |

The lifecycle contract covers Windows, macOS and Linux. Platform work is accepted independently; a working
Windows probe does not validate the Pi or macOS. Mobile lifecycle and data formats are unchanged; note, sync and
backup formats remain V1. No version bump, installed-app change or release is part of this document task.

## Consequences

### Positive

- Presentation can wait for a working environment while work services remain available.
- Graphical failures have a process boundary, and recovery is controlled by current capabilities.
- One lifecycle covers startup, remote reconnect, monitor changes, sleep/wake and renderer loss.

### Negative

- Extracting services from the DOM is substantial work; keeping an invisible WebView is insufficient.
- A nonvisual ES module host and authenticated IPC add dependencies, packaging work and native acceptance tests.
- Abrupt loss still cannot preserve text that never reached the core, and native failures require field testing.

### Neutral

- The renderer frameworks and the portable work data model remain; this is a lifetime/ownership change.
- Remote-access tools, drivers, compositor settings and display configurations are not modified by the app.

## Alternatives Considered

### Reopen the whole app once after a crash

Easy to implement, but unchanged prerequisites can fail again, the core stops with the UI and the missing
readiness boundary remains. Rejected by the maintainer's requested direction.

### Add a longer sign-in timer or a physical-monitor check

Small change, but delays cannot prove graphics availability and physical-monitor checks reject legitimate
remote desktops. They also do not cover environment loss after startup. Not the proposed recovery contract.

### Keep the monitor and a hidden owner WebView in the WPF/GTK/AppKit process

Preserves existing wiring, but a toolkit/display failure can still take away both monitoring and services.
Useful only as an explicitly limited intermediate step, never acceptance of core isolation.

### Rebuild every view on every display event

Simple lifecycle, but interrupts editing/IME unnecessarily. Reuse valid views for geometry changes and replace
resources only when their capability or backend is lost.

## References

Primary sources checked 2026-10-20; these establish platform constraints, not the cause of the uninspected Pi incident.

- [SPEC-009](../specs/009-desktop-presentation-lifecycle.md), [PLAN-009](../plans/009-desktop-presentation-lifecycle.md)
- [ADR-018](018-single-owner-desktop-views.md), [ADR-020](020-windows-display-lifecycle.md)
- [ADR-045](045-windows-fatal-error-leaves-explorer-first.md), [ADR-046](046-windows-sign-in-scenes-wait-for-settled-displays.md)
- [ADR-050](050-windows-wpf-display-loss-runtime.md), [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [Microsoft: QueryDisplayConfig and remote-session access](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-querydisplayconfig)
- [Microsoft: WPF render-thread failures](https://learn.microsoft.com/en-us/troubleshoot/developer/dotnet/framework/general/wpf-render-thread-failures)
- [Microsoft: WPF/Direct3D9 device state and recreation](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/wpf-and-direct3d9-interoperation)
- [Microsoft: services and interactive sessions](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services)
- [GTK: initialization without an available window system](https://docs.gtk.org/gtk3/func.init_check.html)
- [GDK: the default display can be absent](https://docs.gtk.org/gdk3/type_func.Display.get_default.html)

Created: 2026-10-20. Decision owner: project maintainer.
