# ADR-045: On a fatal error Windows leaves Explorer first, then logs, and reopens once after a sign-in start

## Status

Accepted, 2026-10-14. The user reported that 0.2.0 did not start by itself after a reboot. Once it turned out that it
had crashed at sign-in and held up Explorer, the user said: "If it makes Explorer crash, there's no point going on with
this project. Do all three things, and then we'll track down the problem."
The three things are an error log, one reopen when a sign-in start crashes, and full local Windows Error Reporting
dumps.

Revised 2026-10-14: the user asked "first turn off the automatic restart-once feature for me, so I can tell whether it
really crashed". The reopen mechanism stays but is disabled: `Program` always passes `canReopen: false`, so a crashed
sign-in start is no longer reopened, which makes the crash visible in the tray and on the desktop.
At the same time, [ADR-046](046-windows-sign-in-scenes-wait-for-settled-displays.md) makes a sign-in start wait for
settled displays before attaching scenes.

## Context

- Rebooted at 2026-10-14 14:09. The `WorkFleetStartup` StartupTask was enabled; at 14:11:29 Windows started 0.2.0
  through the StartupTask (Shell-Core 62408, AppModel-Runtime 201).
- The process ended at 14:12:13: the WPF render thread failed first, and while handling a window message,
  `SyncFlush` in `HwndTarget.UpdateWindowSettings` threw `UCEERR_RENDERTHREADFAILURE` (0x88980406). The exception was
  inside a user32 callback, so it was fatal (followed by 0xc000041d).
- The desktop-layer and wallpaper-layer scenes are cross-process child windows of Explorer's desktop window (ADR-030,
  ADR-035). While Windows Error Reporting suspended the process to write the report, Explorer hung with it
  (AppHangXProcB1: P1 explorer.exe, P6 WorkFleet.exe), and at 14:12:39 Explorer was restarted.
- On the same computer, 0.2.0 started by hand ran normally for 150 seconds. A Debug simulation of a sign-in start
  (hidden to the tray, plus one desktop note) also ran normally for 65 seconds.
  There was no dump and the app kept no log, so the cause of the render thread failure was unknown.
- The app did not handle unhandled exceptions; the only evidence was in the Windows event log.
- At sign-in the user saw a wrong resolution or scale for a moment before it recovered. The 0.2.1 dump shows this is the
  period when Windows still treats the closed built-in display as primary, which starts before Work Fleet runs; Work
  Fleet has no code that changes display settings (2026-10-14). The comparison (turn off Work Fleet's start at sign-in
  and reboot once) has not been done.
- The NVIDIA driver was updated on 2026-10-12 18:02, and both later boots also had Work Fleet starting at sign-in, so
  the new symptom cannot be attributed to either alone.
- WER `LiveKernelEvent` and `BlueScreen` entries seen after boot are old reports (2025-10 to 2026-09) re-sent at
  startup, not new crashes; `crashpad_log` belongs to Microsoft Edge Update.

## Decision

### Leave Explorer first

- The Windows host installs `CrashGuard` in `Program.Main`. On an unhandled exception on the UI thread, it first finds
  every window of this process whose parent belongs to another process.
  It uses only user32: hide, replace `WS_CHILD` with `WS_POPUP`, `SetParent(NULL)`. Afterwards it searches again to
  confirm none is left.
- While detaching, WPF's window procedure throws again on the failed render thread. These nested exceptions are only
  logged (at most 20) and marked handled.
- Only after confirming that every window has left does it log and hand over to Windows (`Environment.FailFast`, which
  produces a WER report, plus a dump when LocalDumps is configured).
  If a window is still inside Explorer, it logs and calls `TerminateProcess` directly, without a report, so Explorer is
  not held up during reporting.
- Unhandled exceptions on other threads: the same detaching runs on the UI thread, limited to 2 seconds. When the UI
  thread does not respond and a window is still inside Explorer, the process ends directly.

### Logging

- Written to `host.log` in the data directory (for MSIX, the package's `LocalCache\Local\WorkFleet`); each line carries
  the local time and time zone.
- Events logged:
  - Each start: version, distribution type, PID, whether it is a sign-in start, whether it is a reopen.
  - Handing over to an already running instance, start failures, exit.
  - Fatal errors: how long the process ran, how many windows were detached, how many remained, and the HRESULT and full
    text of each level of the exception chain.
  - Unobserved Task exceptions.
  - The display list: at start, when the list changes, when a new layout starts applying, and when displays cannot be
    read. For each display: device name, whether it is primary, physical position and size, DPI; not the display model
    or work area. This is used to match display changes against the times of fatal errors.
- Note content is never logged. At 256 KiB the file is rotated to `host.log.1`. A failed write does not affect the app.

### Reopen once after a sign-in start (disabled since 2026-10-14)

- Reopen only when all four conditions hold: MSIX, a sign-in start, this instance is not itself a reopen, and the error
  chain contains 0x88980406.
  It writes `restart.json` (PID, time, reason), starts a new instance with
  `explorer.exe shell:AppsFolder\<PFN>!WorkFleet`, then hands over to Windows.
- The new instance takes the marker before claiming the data directory: rename first, then read, so only one instance
  can get it; a marker older than 2 minutes or dated in the future is discarded.
- The new instance waits up to 60 seconds for the old process to end and then ends it; if the PID has been reused by
  another process, it is left alone.
- The new instance opens hidden as a sign-in start and never reopens again. If reopening fails, the marker is deleted so
  the next manual launch is not taken for a sign-in start.

### Verification and local diagnostics

- Only with an `app.workfleet.crashprobe.` identity and a `crash-probe.txt` in the data directory does the app treat
  itself as a sign-in start. After the scenes enter Explorer, it throws 0x88980406 on the dispatcher, for use by
  `Test-WindowsRecovery.ps1`. Other identities never read this file.
- LocalDumps (`HKLM\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\WorkFleet.exe`) is a local
  diagnostic setting; neither the app nor the installer writes it. How to set it up: [docs/testing.md](../testing.md).

## Consequences

### Positive

- A crash no longer holds up Explorer. In the MSIX end-to-end test, 4 scene windows left Explorer before Windows wrote
  the dump, Explorer stayed responsive throughout, and there was no hang report.
- If the next sign-in crashes again, it leaves `host.log`, and a dump when LocalDumps is configured.
- With the reopen enabled, a sign-in start that hits a render thread failure still leaves the user with a Work Fleet
  hidden in the tray. With it disabled (current), a failed sign-in start leaves no Work Fleet, so the user can tell it
  crashed.

### Negative

- Only crashes are handled. When the UI thread stalls for a long time (synchronous I/O, a dialog, a deadlock), the
  cross-process child windows can still hold up Explorer. This is an architectural risk of attaching scenes to
  Explorer and needs a separate evaluation.
- The reverse check ("without detaching, Explorer hangs") was never run, because it would freeze the user's Explorer.
- The reopen goes through a shell launch and depends on Explorer responding; after detaching, Explorer should respond.
- The cause of 0x88980406 is still unknown; the reopen is only a fallback, not a fix.
  - The dump of the 0.2.1 sign-in crash shows: Windows first used the closed laptop's built-in display as primary,
    then turned it off; the app found the render thread already failed when it applied the new layout.
  - The same switch with DisplaySwitch (including 6 to 14 seconds after the app started) and closing the lid after the
    app started both failed to reproduce it (`Test-WindowsDisplaySwitch.ps1`).
- A full dump is about 1 GB (1016 MB measured with the 0.2.0 test identity).

### Neutral

- A render thread failure after a manual launch is not reopened; it is only logged and handed to Windows.

## Alternatives Considered

### Alternative 1: Call TerminateProcess directly, without WER

- **Pros**: Explorer recovers fastest.
- **Cons**: No dump, so the cause cannot be found.
- **Why rejected**: Detaching first gives both; this is done only when detaching fails.

### Alternative 2: RegisterApplicationRestart

- **Pros**: Windows takes care of reopening.
- **Cons**: The process must have run for 60 seconds before it is reopened (this one ran only 44 seconds); it cannot
  ask to stay hidden and does not wait for the old process to end.
- **Why rejected**: Unsuitable for a failure right at sign-in.

### Alternative 3: Switch to software rendering (RenderMode.SoftwareOnly)

- **Pros**: May avoid GPU-related render thread failures.
- **Cons**: The cause is unknown; 4K full-screen scenes would perform worse.
- **Why rejected**: Collect evidence before deciding.

### Alternative 4: Mark the exception handled and keep running

- **Pros**: No reopen needed.
- **Cons**: After a render thread failure, the same process can no longer draw.
- **Why rejected**: It cannot recover.

## References

- [ADR-030](030-windows-explorer-wallpaper-layer.md), [ADR-035](035-windows-attached-scene-background-lifecycle.md): scenes attached to Explorer
- [ADR-043](043-desktop-window-placement-and-startup-behavior.md): start at sign-in and hidden start
- [docs/testing.md](../testing.md): the `--crash-guard` probe, `Test-WindowsRecovery.ps1`, `Test-WindowsDisplaySwitch.ps1`, LocalDumps

---

*Decision made: 2026-10-14*
*Decision makers: User, Claude*
