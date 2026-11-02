# Progress

Snapshot rewritten 2026-11-01.

This file is a short snapshot of the current state: what works, where it was verified, and what is still open.
It is not a log. History lives in the git log (Conventional Commits with descriptive bodies),
in the [release notes](docs/release-notes.md) (one entry per version) and in the GitHub Releases and Actions runs.
Durable facts belong in the relevant ADR, SPEC, PLAN, testing, deployment or platform README.
When and how to update this file is defined in [AGENTS.md](AGENTS.md).

## Product scope

- The target is 1.0: one card per thing, up to nine groups, a per-device desktop layout, desktop presentation on
  Windows, macOS and Linux, native iOS and Android apps, Google Drive app-data sync and portable backups.
  The behaviour contract is [SPEC-003](docs/specs/003-desktop-cards-groups-and-formation.md); the order of work is in [ROADMAP](ROADMAP.md).
- Every build so far is a preview. 1.0 is not reached and no store submission has started.
- All note, sync and backup JSON formats stay at V1 until store-launch planning starts
  ([SPEC-007](docs/specs/007-schema-evolution-and-migrations.md)); the earlier schema-migration work was withdrawn.
- Current version numbers are in the per-platform version files listed in [deployment](docs/deployment.md).

## Status by area

### Shared core and interaction

- Implemented: cards, groups, formation (stack, spread, undo), adjust mode, unsaved changes per note shown with a dot
  (ADR-061), Markdown with checklists and attachments,
  complete/archive/delete, group merge, region shortcuts that step a group through its desktop layers, one settings window;
  checklist steps ticked on desktop papers that take clicks, a per-device Top-layer opacity per group, ranked search,
  an opt-in quick move and quick edit of one resting paper with ⌘ or Ctrl held, adjust mode only arranging (not yet
  used on a real machine),
  attachments pasted or dropped into the editor, and an explanation with a confirmed set-aside when local data cannot be
  opened.
- Papers: new papers are 240×240 squares that shrink to fit a short group region (minimum 160×160); placed papers keep their
  size until "reset desktop layout". One group palette serves desktop and main window; group regions follow the primary display.
- Main window: a board of paper tiles or a list, remembered per device; an optional title that search and sharing include;
  papers that cannot scroll end with "…"; attachments sit in a thumbnail strip under the text; H1–H6 sizes and code colouring.
- Verified with model tests, Edge/Chromium browser and scene probes, and the Windows native UI probes.
- The application uses record-level IndexedDB/native SQLite persistence, bounded current heads, draft deltas and
  paged history/outbox. Older local formats require an explicit local discard; no migration runs. Versions loads
  remote bodies on selection. Trash offers Delete forever and Empty Trash with resumable cleanup; unpublished
  edits from a purged identity are kept in Versions for Save as copy. Local latency and installed-host acceptance
  remain open under [PLAN-011](docs/plans/011-dataset-checkpoints-and-deletable-history.md).
- Languages: the UI is English-first with a Traditional Chinese catalog; Settings > General > Display language offers
  Auto-detect, English and Traditional Chinese and switches without a reload. Every host stores the choice per device and
  draws its tray, menus and dialogs in it; host errors arrive in English and are shown through the catalogs
  ([ADR-056](docs/decisions/056-english-first-ui-and-locale-catalogs.md), [i18n guide](docs/i18n.md)).
  Verified with model tests, Edge probes, the Windows core and WebView2 UI probes, the Linux Docker host-shell checks
  (including a zh-TW tray) and Android JUnit tests; the macOS, iOS and Share Extension sources compile in
  `apple-native-build.yml`. Not verified: no switch was tried on a real Mac, Linux desktop, phone or installed Windows package.
- Not verified: text fitting only in Chromium (Edge, WebView2), not in WebKitGTK or WKWebView; the shared palette and shrunk
  new papers on a native desktop. Group regions after a display change while running and the Ctrl+Shift+digit hint
  have no automated test.

### Sync and Google

- The production entry point uses DatasetSync and account-bound native Drive adapters. Fixed current checkpoints,
  bounded receipts and relevant purge barriers replace history-wide bootstrap. Reset captures exact old leaf IDs,
  publishes a legacy-compatible fence and initializes an isolated dataset; obsolete folder containers are retained.
  Current readiness and background old-data cleanup are separate. The older FileSync remains in compatibility fixtures.
- Sign-out removes only this device's credentials and no longer revokes the grant
  ([ADR-021](docs/decisions/021-windows-google-account-and-sync.md)). Installed builds up to 0.2.3 still revoke on sign-out.
- Verified: real Windows sign-in, upload, resumable upload and changes feed on Drive. User reports show real sign-in and sync
  in use on Windows, macOS and Linux installs, six devices on one account. Phones: see their sections.
- Initialization, reset fencing and shared initial groups are verified only with isolated fixtures and Chromium IndexedDB probes,
  not with real Google or the native apps. Builds without the source-generation fields must be updated before a reset.
- Dataset/reset/recovery UI is connected: loss of the expected cloud generation pauses sync and keeps local notes;
  explicit choices rejoin a verified dataset, export, or recover current local data under fresh identities with a
  confirmed safety backup. Seeded cloud replacement uploads retained history before readiness in bounded background
  units; new edits follow afterwards. Portable backups declare complete or current-only coverage. Protocol and
  Chromium/WebKit UI fixtures pass; independent assessment and real-provider verification remain open in PLAN-011.
- The OAuth consent screen is still in Testing: only listed test users can sign in, and refresh tokens expire after 7 days.

### Backup and restore

- Implemented: complete ZIP backups (plain or encrypted), import/merge/replace restores, "clear local data, then restore",
  "clear Google, then restore" with resumable stages, export that syncs first, and automatic backups with a journal
  ([SPEC-002](docs/specs/002-portable-backup-and-restore.md)).
- Windows: native NTFS backup folders and a DPAPI-protected backup password; MSIX keeps data inside the package,
  and uninstalling deletes it ([ADR-037](docs/decisions/037-msix-data-lifetime-and-google-backup-overwrite.md)).
- Verified with model tests, Edge probes over synthetic stores, Windows native probes, Linux real-SQLite and D-Bus vault probes.
- Not verified: a real Google overwrite; native OS folder pickers; Android SAF, Apple bookmark and Linux native backup folders
  on real devices; power loss on external disks.

### Windows

- Implemented: WPF + WebView2 host with a bundled .NET 10 runtime and SQLite/DPAPI storage; three layers attached to Explorer,
  with software rendering for the attached scenes ([ADR-049](docs/decisions/049-windows-attached-scenes-render-in-software.md));
  CrashGuard leaves Explorer before a fatal error and the automatic reopen is off
  ([ADR-045](docs/decisions/045-windows-fatal-error-leaves-explorer-first.md)); sign-in scenes wait for settled displays
  ([ADR-046](docs/decisions/046-windows-sign-in-scenes-wait-for-settled-displays.md)); tray, window placement, StartupTask,
  Atom-based in-app updates, Shell attachment thumbnails and the adjust toolbar on first use.
- Verified: native probes and daily use on Windows 11 build 26200; native probes and a user check on 23H2 (build 22631);
  the local MSIX update probe; three reboots on 26200 with the .NET 10 build and no crash.
- Sign-in reliability remains open: the .NET 10 display-loss fix passed earlier field checks
  ([ADR-050](docs/decisions/050-windows-wpf-display-loss-runtime.md)), but a separate D3D9 device-initialization failure
  is observed. Continuous presentation recovery and a nonvisual core are proposed, not implemented
  ([ADR-058](docs/decisions/058-desktop-presentation-lifecycle-and-core-isolation.md),
  [SPEC-009](docs/specs/009-desktop-presentation-lifecycle.md)); early primary-display removal and .NET 10 on 23H2 remain unverified.
- Not verified: 21H2, 22H2, 24H2 and 25H2+ after the install-floor change; Windows 10 install rejection; mixed DPI and hot-plug;
  a real Explorer restart; sleep/wake; virtual desktops; Win+D; real fast mouse drags and IME; a real `Shell_NotifyIcon`
  failure at sign-in; an in-app update from one real GitHub release to the next (no record).
- The `--formation` probe and some real-desktop pixel checks SKIP when the desktop is covered; no fully uncovered run is recorded.

### macOS

- Implemented: AppKit + WKWebView host, three layers, adjust overlay, Carbon global shortcuts, menu bar, window placement,
  SMAppService login item, Sparkle updates, Quick Look attachment thumbnails, and Developer ID signing and notarization
  in `macos-package.yml`.
- Verified by the user on a Mac: dragging papers; shortcuts with the main window focused, another app focused
  and the main window minimized (physical keyboard); no wallpaper tint; adjust mode (this group, all, toolbar, exit); topmost
  papers above a maximized window; Google sign-in and sync. Login-item registration passed with the real SMAppService in a probe.
- Not verified: native full-screen apps (separate Space) and Spaces switching; login-launch detection through the Apple event;
  main-window placement and multiple displays; a Sparkle update between two notarized versions; Quick Look and default-app
  opening in the sandboxed app; Intel Macs; IME. The latest layer-probe additions have not been run on a Mac.

### Linux

- Implemented: GTK 3 + WebKitGTK 4.1 host on the system Python (3.10+); local storage key in the data directory
  ([ADR-047](docs/decisions/047-linux-local-key-without-keyring-prompts.md)); Google tokens and saved backup passwords in the
  Secret Service, with an unlock prompt on manual sync ([ADR-048](docs/decisions/048-linux-offline-workspace-and-system-secrets.md));
  layer-shell, X11 and GNOME layer mappings; the XWayland choice on GNOME Wayland; labwc shortcuts written to rc.xml; the Pi
  shared-memory renderer default; a tray with a sign-in wait from `config/startup.json`; `host.log`; DEB in-app updates through
  pkexec; GdkPixbuf/thumbnailer attachment previews.
- Verified on real machines: Ubuntu 22.04 GNOME Wayland via XWayland (full use); GNOME Xorg over xrdp (layering and shortcuts);
  Raspberry Pi 5 with labwc (adjust overlay with mouse movement, shortcuts sent with `wtype`, close to tray,
  XDG autostart at login, in-app DEB update). CI runs headless X11 and labwc checks in Docker.
- Not verified: a Pi reboot with the late-tray fix; the real keyring unlock dialog and password entry; real thumbnailers and
  default apps; text fitting in WebKitGTK; multiple displays, HiDPI and IME; KDE, Xfce and other X11 desktops; wayfire;
  a local (non-xrdp) Xorg login. Per-desktop limits are in the [Linux README](src/native/linux/README.md).

### Android

- Implemented: native host with SQLite and Keystore encryption, SAF backups, file export, share inbox,
  Credential Manager and AuthorizationClient sign-in with a token cache bound to the verified account, and a fixed debug keystore.
- Verified: on a Pixel 9 Pro (Android 17) the app starts, keeps clear of system bars and the keyboard, and drops blank drafts;
  JUnit tests and debug APK builds pass; the APK signer matches the registered OAuth SHA-1.
- Not verified: real Google sign-in, Drive round trips and process death on a device; full editing, backups, share inbox, back key.

### iOS

- Implemented: UIKit + WKWebView host on the UIScene life cycle, Share Extension, folder picker, export, sharing, Google Sign-In.
- Verified: a development-signed Debug build starts and shows the main screen on an iPhone 16 Plus (iOS 27.0.1);
  simulator builds; a local unsigned build, development signing, `codesign` verification and IPA packaging.
- Not verified: real Google sign-in and Drive round trips; full editing, attachments and backups; iPad; real sharing through
  the extension; background save; scene reconnection.

### Build, CI and release tooling

- `ci.yml` runs on every push to main and every pull request: JS and Python tests and build, Linux Docker desktop-layer and host
  checks, and the Windows build, core probe and unsigned package check. Browser probes and the WebView2 UI probe run only locally.
- `preview-release.yml` runs only on manual dispatch, refuses an existing tag and publishes one `v<version>` prerelease with
  Windows, macOS, Linux and Android, built by `windows-package.yml`, `macos-package.yml`, `linux-package.yml` and
  `android-apk.yml`; it needs the four version records to agree. Desktop installs of 0.3.6 or earlier need one manual install
  to reach these releases. `apple-native-build.yml` is an unsigned macOS compile check. Version files are in
  [deployment](docs/deployment.md).
- `android-apk.yml` also builds a test-signed device APK on its own, from the fixed signing Secret, and publishes nothing then.
  iOS builds, signing and installation stay local; no GitHub workflow builds or uploads
  iOS packages because embedded provisioning profiles disclose registered device identifiers
  ([ADR-057](docs/decisions/057-local-ios-builds-and-device-privacy.md)).
- Store listings and privacy text are drafted in [docs/release](docs/release/README.md). Developer accounts, a Partner Center
  reservation, native screenshots, store signing and the final SDK licence inventory are missing.

## Open items

Pending decisions:

- Paper shape: keep squares or move to portrait, after the user reviews the measured line counts.
- Whether to keep the ADR-049 software rendering (about 130 MB more per 4K display) now that the .NET 10 WPF fix is in.
- Whether to re-enable the ADR-045 one-time reopen after a sign-in crash, turn on LocalDumps or update the GPU driver (the user decides).
- A release channel beyond preview and a long-term update index beyond the ten-entry Atom feed
  ([ADR-044](docs/decisions/044-desktop-in-app-updates-from-github-releases.md)); moving the OAuth consent screen out of Testing.
- The unanswered questions in [SPEC-006](docs/specs/006-desktop-window-startup-and-updates.md).

Pending verification on real devices:

- Windows: a sign-in start where the built-in primary display is removed within the first minute.
- Linux: a Pi reboot with a hidden start and the tray wait; the keyring unlock dialog from "Sync now".
- macOS: full-screen Spaces, Spaces switching and login-launch detection.
- macOS and iOS: a Display language switch after the localization change.
- Google: a multi-device reset and initialization with a test account (steps in [testing](docs/testing.md)).
- Phones: Google sign-in on an iPhone and an Android device; installing a hosted APK and IPA.

Known issues not yet fixed:

- Restoring a backup's layout keeps the backup's grid area until the next start or display change, and uses the first
  work area, which is not always the primary display.
- iOS: a WebContent crash during scene disconnection leaves a blank screen; a folder picker that is open when its scene
  goes away blocks later folder picks until restart. Android: the page stays scrolled after the keyboard closes.

Planned features are in [ROADMAP](ROADMAP.md).
