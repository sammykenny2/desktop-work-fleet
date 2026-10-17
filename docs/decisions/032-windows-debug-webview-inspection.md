# ADR-032: WebView inspection in the Windows Debug configuration

## Status

Accepted, 2026-10-05. At the user's request, only the Debug configuration can open DevTools; Release always keeps them off.
Revises ADR-015's "DevTools disabled": that restriction now applies only to Release/MSIX; the other bridge boundaries are
unchanged.

The shared-data requirement was superseded on 2026-10-10 by [ADR-037](037-msix-data-lifetime-and-google-backup-overwrite.md):
MSIX uses the package-private data area, and ZIP and unpackaged Debug builds keep a separate directory. The statements about
shared data below are only the background of the decision at that time.
The Debug inspection and the Release/MSIX protection requirements remain in force.

## Context

ADR-015 disabled DevTools in every configuration, so `Build-WindowsApp.ps1 -Configuration Debug` behaved the same as Release.
During development the UI could only be checked through OS screenshots, without the DOM, the console or the desktop scene
content.
The user needs the Debug configuration to open the real data directory directly to track down problems caused by real data,
so no separate Debug data directory is set up.
The CDP port requires no authentication. Loopback does not distinguish Windows users: any non-AppContainer process on the
machine (including other sessions and services) can connect, control the page and call the native bridge.

## Decision

- `WebViewDiagnostics` branches at compile time with `#if DEBUG`. Release has no code that opens DevTools or a debug port.
- Debug enables `AreDevToolsEnabled` in the main window and in every desktop scene WebView.
  The app does not intercept contextmenu, so the right-click menu shows "Inspect"; `AreBrowserAcceleratorKeysEnabled=false`
  still keeps F12 from working.
- The CDP port is off by default. Only when the process environment that starts the Debug app contains
  `WORK_FLEET_WEBVIEW_DEBUG_PORT` is the WebView2 environment created with `--remote-debugging-port`; that environment is shared
  by the main window and the scenes and covers every WebView.
  Chromium binds only loopback; the value must be a decimal number from 1024 to 65535, otherwise it is rejected with a
  HostError before the data directory owner lock is taken.
- Debug and MSIX/Release share `%LOCALAPPDATA%\WorkFleet`. The single owner lock keeps both from opening at the same time.
- MSIX is always built as Release; `Build-WindowsPackage.ps1` stops packaging if it finds the string `remote-debugging` in
  `WorkFleet.dll`. `Test-WindowsNative.ps1` requires the same scan to find it in the Debug `WorkFleet.dll`, so that the check
  cannot silently stop working after a refactor. No installable Debug MSIX is provided.
- The port is never enabled through user-level environment variables (setx) or registry keys; it is set only in the process
  environment that starts the Debug app.

## Consequences

### Positive

During development, DevTools or CDP can inspect the real DOM, console and desktop scenes, and the Release executable has no
such code path.
Debug can reproduce problems in real data directly, without exporting or moving SQLite.

### Negative

While a Debug app with the port open is running, any process on the machine (of any user) can read the decrypted notes, so
the port should be opened only briefly when needed.
Debug and the installed app share data and the owner lock; one of them must be closed first.
Both share the `webview` user data but with different browser arguments; after the owner lock is released, the WebView2
processes may end slightly later. Opening the other version during that time may show "The native workspace could not be
opened"; wait a moment and open it again. The port is never carried into Release.

### Neutral

"Release always off" is the app's own behavior. WebView2 still accepts `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` or the
AdditionalBrowserArguments policy registry key set by the same user; this falls within the same-account malware scope that
ADR-015 already excludes. To inspect an installed Release version, either method can be used temporarily and must be removed
afterwards.

## Alternatives Considered

- Keep it off in every configuration: development is limited to screenshots, with no way to inspect the DOM or scenes.
- A separate data directory for Debug: safer, but the Debug build could not be used to track down problems in real data.
- Debug always opens a fixed port: every Debug run would expose the bridge and could conflict with other tools.
- An installable Debug MSIX: needs another package identity and signing flow; running the Debug exe directly is enough.

## References

- [ADR-015](015-windows-native-storage-and-editor-host.md), [Services and ports](../services.md), [Security guidelines](../security-guidelines.md)
- [WebView2 environment variables and AdditionalBrowserArguments](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl#createcorewebview2environmentwithoptions)
- [AreDevToolsEnabled](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2settings.aredevtoolsenabled)
- [Testing](../testing.md), [Current status](../../PROGRESS.md)

*Decision made: 2026-10-05*
