# ADR-019: Windows shortcuts, focus and tray entry

## Status

Accepted, 2026-10-04. Integrates the Windows desktop entry points; the verification status of OS IME
composition, physical input and the full platform matrix is in [PROGRESS.md](../../PROGRESS.md) and
[docs/testing.md](../testing.md).

## Context

The desktop scenes already have a single Workspace, but the entry points still depend on the main window. Global
shortcuts and a resident entry need to be connected,
while avoiding global registration swallowing this app's IME composition or text keys, and avoiding a delayed
save taking focus that no longer belongs to the operation.

## Decision

- Shortcuts are stored in the local LayoutStore, and group targets keep stable IDs; at most 32 bindings.
  The main window coalesces identical and consecutive settings updates, and native reports per-key state from the
  actual RegisterHotKey results.
  Conflicting, reserved and unavailable keys keep their settings; they can be changed or retried, and global
  registration is never claimed as successful.
  Ctrl+Alt (with or without Shift) plus a letter or digit is marked typing and not registered, to keep AltGr
  character input;
  new workspaces default capture/toggle to Ctrl+Shift+N / D, and existing settings are not rewritten. Local
  AltGraph events are let through first.
- When one of this app's native windows is Activated, all OS registrations are removed synchronously; Deactivated
  checks the foreground process after a delay,
  the tray menu blocks synchronously before it opens, and a low-frequency dispatcher timer also checks the
  foreground. Only after the app loses focus does it register again and show new conflict results.
  The initialization and closing blocks are independent of settings updates and cannot be released early by
  reapplying bindings.
- The focused main window or scene handles local shortcuts; ordinary text editing keys, IME, repeats, consumed
  events and modals come first.
  In-place editing allows group scope shortcuts, which first save the last text reliably and then switch. Other
  input fields do not run workspace shortcuts.
  A scene only passes the key; the owner resolves the target from the settings at that moment, and an expired or
  removed binding does not run.
- Native shortcuts and tray commands share the existing operation sequence and do not open another Workspace.
  When focus is needed, they wait until the matching full projection is published and the scene has applied its
  input region, and only then activate a floating surface that has operable cards.
  A native intent is valid for five seconds and must still have the original foreground HWND and last input time;
  a late action cannot steal the user's later focus.
  A local shortcut in the main window requests the intent before queuing, and the host captures it at message
  admission; a scene requests it before its first save await,
  and the token is bound to the view, single-use, and put into the owner metadata only after native validation.
  Without a valid intent there is no Activate.
  The tray captures the same intent before queuing onto the dispatcher, and cannot authorize again when the delayed
  callback runs.
  When Windows refuses activation, clickable papers are kept; no keystrokes are simulated and the system
  foreground-lock setting is not changed.
- The tray uses the public Shell_NotifyIcon / version 4, an owned hidden top-level HWND and a native menu,
  supporting keyboard selection, the main window, Quick capture, Adjust all, ending the scope, the desktop display
  toggle, hiding, and save and exit.
  TaskbarCreated only rebuilds its own icon; removal and exit release its own resources, without changing Explorer
  or other apps' settings.
- Hiding the main window first saves drafts and then calls Hide, keeping the WebView, Workspace, SQLite and the
  desktop surfaces.
  Without a valid tray icon it does not hide; if rebuilding fails, the main window is shown again but not
  activated.
  2026-10-06, a later decision by the user: when the tray is available, the window's X, Alt+F4 and the taskbar
  close (SC_CLOSE) hide it to the tray directly,
  and the page and its drafts stay in the running WebView; when the tray is not available, X still saves and exits.
  The tray's save-and-exit item, in-app Close and WM_CLOSE keep the existing durable close protocol.

## Consequences

### Positive

The main window can be hidden and still has a reachable entry; global and local keys are divided by focus
ownership, and saving and exiting still have only the existing transaction path.

### Negative

IME composition, physical keyboard layouts and Windows shell behaviour still need acceptance on real hardware; the
conservative focus conditions may require the user to click a card that is already shown.
The tray currently uses a Windows system app icon; the brand icon comes with the production packaging.

### Neutral

No runtime package, listener, resident keyboard hook or system setting change is added. The browser preview still
has only local shortcuts.

## Alternatives Considered

### Keep global keys registered and only ignore composition in the callback

The key has already been intercepted by the OS registration, and ignoring the callback cannot give it back to the
editor; rejected.

### Activate unconditionally after saving

The user may already have moved to another window or kept typing, so a short-lived native intent and the frame
applied condition are used instead.

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [ADR-017](017-windows-composition-surface-and-input.md), [ADR-018](018-single-owner-desktop-views.md)
- [Windows shortcut and shell research](../research/2026-10-04-windows-shortcuts-and-tray.md)
- [Desktop IPC contract](../../contracts/desktop-scene.d.ts)

Decision made: 2026-10-04.
