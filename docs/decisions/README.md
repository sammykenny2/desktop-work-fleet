# Decision index

Updated: 2026-10-31.

| Record | Status | Scope |
|---|---|---|
| [ADR-060](060-explorer-redraws-the-wallpaper-a-scene-leaves.md) | Accepted (wallpaper remnants, 2026-10-31) | The wallpaper host keeps a scene's old pixels and ignores invalidation; wallpaper scenes ask Explorer to redraw with 0x052C (13, 1); a host-pixel probe catches black remnants on black wallpapers |
| [ADR-059](059-settings-pages-and-entry-points.md) | Accepted (settings layout, 2026-10-24) | The account chip opens Account and sync, the gear General; Settings pages in two groups under an account card |
| [ADR-058](058-desktop-presentation-lifecycle-and-core-isolation.md) | Proposed | Nonvisual resident core, disposable graphical clients, continuous presentation readiness/recovery and permanent removal of whole-app crash reopen |
| [ADR-057](057-local-ios-builds-and-device-privacy.md) | Accepted (local iOS builds, 2026-10-20) | iOS builds and device signing stay on the maintainer's Mac; no iOS packages in public Actions artifacts or Releases |
| [ADR-056](056-english-first-ui-and-locale-catalogs.md) | Accepted (UI language, 2026-10-17) | English-first UI with en and zh-TW locale catalogs and a Display language setting |
| [ADR-055](055-mobile-device-build-workflows.md) | Accepted for Android; iOS superseded by ADR-057 | Fixed-key manual APK builds with fourteen-day artifacts and optional Android prereleases |
| [ADR-052](052-rich-papers-and-native-attachments.md) | Accepted (note formatting and attachments) | Six heading levels, code coloring, native attachment thumbnails and opening a copy; V1 and checklists unchanged |
| [ADR-051](051-schema-evolution-and-atomic-migrations.md) | Accepted (testing-phase V1 policy) | Current JSON schemas stay at V1; version bumps, migrations and copies are evaluated when store launch is planned |
| [ADR-001](001-independent-backlog-first-foundation.md) | Accepted | Name, independent development, backlog focus and bootstrap scope |
| [ADR-002](002-validation-runtime.md) | Accepted | Validation build on AppKit/Web/Python SQLite, keeping the cross-platform packaging goal |
| [ADR-003](003-product-architecture-boundaries.md) | Deferred | Keeps the full PM / self-hosted server architecture; not required for 1.0 |
| [ADR-004](004-google-drive-notes-mvp.md) | Partly superseded by ADR-012 | Initial Google Drive proposal; historical scope candidate |
| [ADR-005](005-portable-backup-and-restore.md) | Superseded by ADR-013 | Historical backup format / restore candidate |
| [ADR-006](006-card-group-and-formation-semantics.md) | Accepted (product semantics) | One card per thing, groups/formation/operations and the gestures for moving between groups |
| [ADR-007](007-desktop-scene-and-platform-host.md) | Proposed | Scene renderer / platform host, controllable stacking order and input responsibility |
| [ADR-008](008-portable-interaction-core.md) | Accepted (shared core) | ES module semantics, atomic local commands, full five-platform 1.0 scope |
| [ADR-009](009-local-renderer-and-persistence.md) | Accepted (local UI) | Packaged renderer, IndexedDB transactions/drafts/attachments, Markdown sanitizing |
| [ADR-010](010-group-retirement-and-device-settings.md) | Accepted (local commands) | Previewed group merge, draft membership baseline and stable device settings |
| [ADR-011](011-immutable-revision-graph.md) | Accepted (sync format) | Immutable revisions, strict JSON, pending and multiple heads; Google integration accepted separately |
| [ADR-012](012-durable-file-store-and-drive-adapter.md) | Accepted (file transfer) | Durable reservations, paging/retries, Drive appDataFolder/resumable; native authorization accepted separately |
| [ADR-013](013-complete-portable-backup.md) | Accepted (complete backup) | All known revisions/drafts/attachments/layout, strict ZIP, encryption, three restore modes and the automatic backup contract |
| [ADR-014](014-durable-automatic-backups.md) | Accepted (automatic backups) | Profile journal / policy generation / restart recovery / native file capabilities and safe cleanup |
| [ADR-015](015-windows-native-storage-and-editor-host.md) | Accepted (Windows main window/storage) | WPF/WebView2, SQLite/DPAPI, chunked IPC, atomic CAS and drafts on close |
| [ADR-016](016-windows-native-backup-files-and-vault.md) | Accepted (Windows backup) | NTFS directory/file identity, create-only / same-handle cleanup, native vault encryption and portable envelopes |
| [ADR-017](017-windows-composition-surface-and-input.md) | Accepted (Windows scene foundation) | CompositionControl, complementary regions, layers / paired lifecycle, shortcuts and physical display inventory |
| [ADR-018](018-single-owner-desktop-views.md) | Accepted (Windows scene integration) | Single Workspace, restricted projections/commands, sharding, draft flush/takeover/disconnect/close |
| [ADR-019](019-windows-shortcuts-and-tray.md) | Accepted (Windows desktop entry points) | Global/local keys, focus ownership, short-lived activation intents, tray and hiding that keeps the owner |
| [ADR-020](020-windows-display-lifecycle.md) | Accepted (Windows displays) | Display, DPI and sleep notifications, rescue after save and scene reuse; ADR-030 later raised the scene pool |
| [ADR-021](021-windows-google-account-and-sync.md) | Accepted (Windows Google) | Native Google OAuth, account partitions and the sync entry point; sign-out no longer revokes the grant (2026-10-15) |
| [ADR-022](022-android-native-host.md) | Accepted (Android host) | Android host, Keystore, SAF and Google authorization |
| [ADR-023](023-apple-native-host-and-scenes.md) | Accepted (Apple host) | Apple host, Keychain, Google and the macOS scenes |
| [ADR-024](024-linux-native-owner-and-storage.md) | Accepted (Linux host); key policy superseded by ADR-047/048 | GTK owner, data and Google on Linux |
| [ADR-025](025-linux-desktop-scenes-and-shortcuts.md) | Accepted (Linux desktop) | Layered scenes, input regions, shortcuts and the tray on Linux |
| [ADR-026](026-native-file-export-and-sharing.md) | Accepted (native export) | Native file export and phone text/attachment sharing |
| [ADR-027](027-native-share-inbox-and-extension.md) | Accepted (share inbox) | Encrypted share inbox, group choice and the iOS Share Extension |
| [ADR-028](028-native-package-and-signing-entry-points.md) | Accepted (packaging entry points) | Windows MSIX/ZIP, Apple export/PKG/DMG, Android upload signing; production accounts / native artifacts delivered separately |
| [ADR-029](029-portable-apple-xcode-project.md) | Accepted (Apple project delivery) | Committed portable Xcode project that opens straight after clone, local configuration and build assets |
| [ADR-030](030-windows-explorer-wallpaper-layer.md) | Accepted (Windows wallpaper layer) | Explorer icon/wallpaper host, three-layer scenes, click-through and restore on exit |
| [ADR-031](031-macos-and-linux-wallpaper-scenes.md) | Accepted (Mac/Linux wallpaper layer) | Mac below the icons, Linux BACKGROUND, click-through and redraw, follow-up measurements against the reference |
| [ADR-032](032-windows-debug-webview-inspection.md) | Accepted (Windows Debug inspection) | DevTools only in Debug, opt-in loopback CDP and Release packaging guards; the data-sharing requirement is superseded by ADR-037 |
| [ADR-033](033-apple-local-script-bundles.md) | Accepted (Apple packaging) | Local classic script bundles, keeping CSP/bridge, and a separate development-signed launch test |
| [ADR-034](034-windows-11-compatibility-and-install-floor.md) | Accepted (Windows support range) | Early Windows 11 / 23H2 / 24H2+, MSIX target floor 22000, 23H2 tested on a real device and Store deferred; current status in PROGRESS.md |
| [ADR-035](035-windows-attached-scene-background-lifecycle.md) | Accepted (attached scene fix direction) | Reports of white blocks on move/stack/spread; clipped hosts, no pixel copying and withdrawn old regions (the no-backing-bitmap style was withdrawn); the wallpaper-layer cause and fix are in ADR-060 |
| [ADR-036](036-windows-self-contained-packaging.md) | Accepted (Windows packaged runtime) | Self-contained Desktop/win-x64 by default, version updated by ADR-050, runtime notices and package checks; WebView2 still depends on the system |
| [ADR-037](037-msix-data-lifetime-and-google-backup-overwrite.md) | Accepted (data lifetime and overwrite) | MSIX uninstall removes local data; complete backups, safety backups and a resumable full Google overwrite |
| [ADR-047](047-linux-local-key-without-keyring-prompts.md) | Accepted (local note key) | 0600 local key, migrated after verifying old data; the credential and backup password policy is superseded by ADR-048 |
| [ADR-048](048-linux-offline-workspace-and-system-secrets.md) | Accepted (Linux system secrets) | Tokens / saved backup passwords in a persistent vault; when it is locked only sync and encrypted backups pause, and offline notes need no prompt |
| [000-template](000-template.md) | Template | Format for later decisions |
| [ADR-038](038-portable-local-and-cloud-backup-flows.md) | Accepted (backup migration in both directions) | Same-format ZIP, atomic complete local restore and export after a Google sync; failure copies need an explicit choice |
| [ADR-045](045-windows-fatal-error-leaves-explorer-first.md) | Accepted (Windows fatal errors) | On a crash, move the scene windows out of Explorer before handing over to WER; `host.log` logging; one hidden reopen when a sign-in start's render thread fails (disabled since 2026-10-14) |
| [ADR-046](046-windows-sign-in-scenes-wait-for-settled-displays.md) | Accepted (Windows sign-in start) | While a closed laptop's built-in display is still on, or right after a display change, scenes wait before attaching to Explorer; at most 3 minutes; since 2026-10-15 `host.log` records lid reports and decision inputs |
| [ADR-049](049-windows-attached-scenes-render-in-software.md) | Accepted (Windows scene rendering) | Scene windows attached to Explorer render WPF in software and hold no Direct3D state; the floating layer and main window are unchanged |
| [ADR-050](050-windows-wpf-display-loss-runtime.md) | Accepted (Windows runtime) | .NET 10.0.13, WPF display-loss protection, exact runtime package check; three sign-in starts without another crash, early primary-display removal and other OS versions still to be verified |
| [ADR-044](044-desktop-in-app-updates-from-github-releases.md) | Accepted (in-app updates, revised 2026-10-15) | Public Atom feed filtered by platform tag, no REST API quota, manifest/SHA-256, MSIX/Sparkle/DEB save and exit before installing |
| [ADR-043](043-desktop-window-placement-and-startup-behavior.md) | Accepted (main window and startup) | Host-level memory of the main window position/size, start at sign-in on by default, system state first, a second launch on Windows brings up the app; revised 2026-10-17 to wait for the tray at sign-in |
| [ADR-042](042-adjust-overlay-on-every-desktop-host.md) | Accepted (adjust mode) | Every desktop host adjusts in an overlay; the main window steps aside and comes back only if it had focus when adjustment started |
| [ADR-041](041-labwc-shortcuts-through-rc-xml-keybinds.md) | Accepted (labwc shortcuts) | Settings writes the shortcuts into a marked block of rc.xml, and keybinds reach the app through gapplication |
| [ADR-040](040-gnome-wayland-xwayland-choice.md) | Accepted (GNOME Wayland display mode) | Asks on first launch and can switch XWayland in Settings, applied before GTK starts; the restart saves drafts |
| [ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md) | Accepted (GNOME/X11 scenes) | X11 scenes are sized to the work area; GNOME XWayland keeps only the wallpaper layer always on; the adjust overlay started on GNOME XWayland (current scope in ADR-042); the Pi's DMA-BUF renderer uses shared-memory buffers; the pcmanfm desktop has no wallpaper layer |
| [ADR-053](053-account-scoped-initial-group.md) | Accepted (sync initialization) | The same account / reset batch shares the initial group and root revision, so six devices reconnecting at once create no duplicate groups |
| [ADR-054](054-explicit-workspace-initialization.md) | Accepted (workspace initialization) | Explicit prepare/ready workspace initialization, initializing reset device, waiting followers, durable reset journal |

The validation build's runtime was decided in ADR-002; for the 1.0 platform and packaging decisions see the main
documentation index and ADR-028; production store configuration still needs the maintainer's accounts. Research
recommendations stay in [research](../research/README.md) and are never turned into Accepted automatically.

New decisions use the 000-template structure, are named in lowercase with hyphens, and record the accepted scope and
date.
