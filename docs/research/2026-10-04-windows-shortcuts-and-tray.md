# Windows shortcuts, foreground and tray

Reviewed: 2026-10-04. Public API evidence, project adoption and untested boundaries are kept apart.

## Official evidence

- [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)
  lists the desktop-caller and last-input/foreground permission conditions, and the system may still refuse; Activate
  cannot be treated as a guarantee.
- [ShowWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow)
  defines SW_SHOWNOACTIVATE; restoring the main window for an expired intent uses the non-activating path and does not
  take focus back with an ordinary restore.
- [Shell_NotifyIconW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shell_notifyiconw)
  provides add, modify, delete and set-version/focus; the version must be set again after every add.
  Version 4 enables keyboard entries such as WM_CONTEXTMENU and NIN_KEYSELECT.
- [NOTIFYICONDATAW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-notifyicondataw)
  defines an HWND + uID or GUID identity, the icon, the tooltip and the callback; this implementation uses its own
  HWND + uID.
- [Taskbar](https://learn.microsoft.com/en-us/windows/win32/shell/taskbar)
  describes the TaskbarCreated notification and the tray lifecycle; the icon must be recreated after a restart.
- The [Microsoft keyboard guidelines](https://learn.microsoft.com/en-us/windows/win32/uxguide/inter-keyboard)
  note that Ctrl+Alt can conflict with AltGr character input; these design guidelines date from Windows 7 and cannot
  serve as UI acceptance for newer versions.
- [W3C UI Events](https://www.w3.org/TR/uievents/#keys-modifiers)
  defines the modifier state/AltGraph; the local handler uses the event state to keep normal text input.

## This project's decisions and inferences

[ADR-019](../decisions/019-windows-shortcuts-and-tray.md) actually unregisters RegisterHotKey while focused,
and lets the local HTML handler resolve the scope/editor precedence. This is the project's conservative input policy;
Windows does not arbitrate for this app automatically.
An asynchronous focus request requires a native snapshot, a five-second deadline and no later input; this is an extra
restriction and does not extend the OS permission.
The tray uses public APIs and its own hidden window; no sample source code was brought in, and no other app's assets
are relied on.

## Verification boundaries

WM_HOTKEY/tray callbacks/TaskbarCreated to our own HWND are synthetic messages; real OS registration,
Shell_NotifyIconGetRect, WPF/WebView2/SQLite and the main data flow have separate real-run evidence.
CompositionEvent/KeyboardEvent are not equal to real IME candidates or physical keys. A restart was not tested by
terminating Explorer, and no keyboard or mouse input was injected on the user's desktop. The results of each run are
in the git history; current status is in [PROGRESS](../../PROGRESS.md).
