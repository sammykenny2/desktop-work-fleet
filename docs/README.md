# Document Index

Updated: 2026-10-17. Read the latest specifications first; research, working defaults, completed implementation and
passed real-world tests are kept apart.

During testing, the note, sync and backup JSON schemas all stay at V1; fields change V1 directly, and version bumps and
migrations are evaluated only when store launch is planned.
The policy is in [SPEC-007](specs/007-schema-evolution-and-migrations.md) and [ADR-051](decisions/051-schema-evolution-and-atomic-migrations.md).

## Current development handoff: read first

| Document | Authority and purpose |
|---|---|
| [Windows 11 compatibility handoff](handoff/2026-10-09-windows-11-compatibility-handoff.md) | The correct project for this round, 23H2 native and package-content verification; the entry point for continuing user-interaction and install acceptance |
| [ADR-034](decisions/034-windows-11-compatibility-and-install-floor.md)/[SPEC-005](specs/005-windows-11-compatibility.md)/[PLAN-004](plans/004-windows-11-compatibility.md) | Confirmed targets for older and newer Windows 11 versions, Windows 10 install exclusion and the order of work; the MSIX floor is currently 22000, and other versions need their own real-device checks |
| [Handoff entry](handoff/2026-10-04-desktop-interaction-handoff.md) | Reading order, behaviour that must not change, and the rule for asking where the external reference is |
| [Requirements](requirements.md) | Latest product scope and open items |
| [SPEC-003](specs/003-desktop-cards-groups-and-formation.md) | U, D and answered Q, the complete interaction, C01–C48; the current implementation status is in PROGRESS |
| [ADR-006](decisions/006-card-group-and-formation-semantics.md) | Accepted: one card per thing, groups, formation, operation semantics |
| [ADR-007](decisions/007-desktop-scene-and-platform-host.md) | Proposed: renderer / native host boundary and controllable stacking order |
| [ADR-008](decisions/008-portable-interaction-core.md) | Accepted: shared semantic core, atomic saves and the complete 1.0 scope of this round |
| [ADR-052](decisions/052-rich-papers-and-native-attachments.md) | Accepted: six heading levels, code colouring, native attachment thumbnails and opening a copy; no migration and no desktop checklist operation |
| [ADR-056](decisions/056-english-first-ui-and-locale-catalogs.md) | Accepted: English-first UI with English and Traditional Chinese locale catalogs, a per-device Display language setting that follows the system language by default, and native host string tables; details in [i18n](i18n.md) |
| [ADR-009](decisions/009-local-renderer-and-persistence.md) | Accepted: local renderer, IndexedDB / drafts / attachments, safe Markdown |
| [ADR-010](decisions/010-group-retirement-and-device-settings.md) | Accepted: group merge / draft baseline, region and shortcut settings |
| [SPEC-004](specs/004-revision-graph-and-file-sync.md)/[ADR-011](decisions/011-immutable-revision-graph.md) | Accepted: immutable revisions, strict JSON, rules for missing parents and multiple branches; the current status is in PROGRESS and verification procedures in [testing](testing.md) |
| [ADR-012](decisions/012-durable-file-store-and-drive-adapter.md) | Accepted: resumable FileStore, Drive appDataFolder and resumable uploads; native authorization is accepted separately |
| [ADR-053](decisions/053-account-scoped-initial-group.md) | Accepted: an initial group and root revision shared by the devices of one account / reset batch, so devices that reconnect at the same time do not create duplicate "My notes" groups |
| [SPEC-008](specs/008-workspace-initialization.md)/[ADR-054](decisions/054-explicit-workspace-initialization.md)/[PLAN-008](plans/008-workspace-initialization.md) | Accepted: explicit prepare / ready, initialization by the device that started the reset, followers wait, durable journal and activation after an integrity check |
| [SPEC-002](specs/002-portable-backup-and-restore.md)/[ADR-013](decisions/013-complete-portable-backup.md) | Accepted: complete portable data, strict ZIP / encryption, three restores and the automatic backup contract; the current status is in PROGRESS |
| [ADR-014](decisions/014-durable-automatic-backups.md) | Accepted: automatic backup journal / restart / policy, native secure file capabilities; the browser does not fake native capabilities |
| [ADR-015](decisions/015-windows-native-storage-and-editor-host.md) | Accepted: Windows WPF / WebView2 main window, encrypted SQLite / DPAPI, restricted bridge; desktop presentation is accepted separately |
| [ADR-016](decisions/016-windows-native-backup-files-and-vault.md) | Accepted: Windows NTFS saving / cleanup, native grants, vault encryption that never returns the password; other platforms are accepted separately |
| [ADR-017](decisions/017-windows-composition-surface-and-input.md) | Accepted: Windows composition / complementary input regions, shortcut and display foundations; product coordination is still being integrated |
| [ADR-018](decisions/018-single-owner-desktop-views.md) | Accepted: Windows scenes connect to a single workspace, sharded / restricted commands and the draft-save barrier |
| [ADR-019](decisions/019-windows-shortcuts-and-tray.md) | Accepted: Windows shortcuts / focus, tray and hiding the main window, still using the single workspace |
| [ADR-020](decisions/020-windows-display-lifecycle.md) | Accepted: display / DPI / sleep notifications, rescue after save and scene reuse |
| [ADR-021](decisions/021-windows-google-account-and-sync.md) | Accepted: Windows native Google OAuth, account partitions and sync entry points |
| [ADR-022](decisions/022-android-native-host.md) | Accepted: Android host, Keystore, SAF and Google authorization |
| [ADR-023](decisions/023-apple-native-host-and-scenes.md) | Accepted: Apple host, Keychain, Google and macOS scenes |
| [ADR-024](decisions/024-linux-native-owner-and-storage.md)/[ADR-047](decisions/047-linux-local-key-without-keyring-prompts.md)/[ADR-048](decisions/048-linux-offline-workspace-and-system-secrets.md) | Accepted: Linux GTK owner; the local notes key needs no prompt, tokens and saved backup passwords are protected by the system vault, and a locked vault pauses only the related features |
| [ADR-025](decisions/025-linux-desktop-scenes-and-shortcuts.md) | Accepted: Linux layered scenes, input regions, shortcuts and tray |
| [ADR-026](decisions/026-native-file-export-and-sharing.md) | Accepted: native file export, text and attachment sharing on phones |
| [ADR-027](decisions/027-native-share-inbox-and-extension.md) | Accepted: encrypted share inbox, group choice and the iOS extension |
| [ADR-028](decisions/028-native-package-and-signing-entry-points.md) | Accepted: Windows MSIX / ZIP, Apple export / PKG / DMG, Android upload signing |
| [ADR-055](decisions/055-mobile-device-build-workflows.md) | Accepted: manual APK / registered-device IPA builds, fixed signing and Actions artifacts; no version bump or publication |
| [ADR-029](decisions/029-portable-apple-xcode-project.md) | Accepted: a committed Xcode project that opens directly, relative paths and automatic asset preparation |
| [ADR-030](decisions/030-windows-explorer-wallpaper-layer.md) | Accepted: Explorer icon / wallpaper hosts, three-layer scenes and click-through |
| [ADR-031](decisions/031-macos-and-linux-wallpaper-scenes.md) | Accepted: the third layer on Mac / Linux, click-through / redraw and continued reference measurements |
| [ADR-032](decisions/032-windows-debug-webview-inspection.md) | Accepted: Windows opens DevTools / opt-in CDP only in Debug, with protection in Release packages |
| [ADR-033](decisions/033-apple-local-script-bundles.md) | Accepted: Apple local script bundling, the preserved asset security boundary and development-signed launch tests |
| [ADR-035](decisions/035-windows-attached-scene-background-lifecycle.md) | Accepted: a fix to the attached host and background lifecycle for afterimages after stacking / spreading on 23H2; its effect awaits real-world testing |
| [ADR-036](decisions/036-windows-self-contained-packaging.md) | Accepted: Windows MSIX / ZIP bundle the Desktop runtime by default (updated to .NET 10 by ADR-050); receivers still need WebView2 |
| [ADR-037](decisions/037-msix-data-lifetime-and-google-backup-overwrite.md)/[PLAN-005](plans/005-msix-data-and-cloud-overwrite.md) | Accepted: MSIX private data and uninstall policy, resumable full overwrite of Google from a backup |
| [ADR-038](decisions/038-portable-local-and-cloud-backup-flows.md) | Accepted: two-way migration in the same format, export after Google sync, atomic complete local restore with an optional backup of the old data |
| [SPEC-006](specs/006-desktop-window-startup-and-updates.md)/[ADR-043](decisions/043-desktop-window-placement-and-startup-behavior.md)/[ADR-044](decisions/044-desktop-in-app-updates-from-github-releases.md)/[PLAN-006](plans/006-desktop-window-startup-and-updates.md) | Accepted: main-window position memory, startup behaviour and in-app updates on three platforms; revised 2026-10-17 to wait for the tray at sign-in; Q items open; the current implementation status is in PROGRESS |
| [ADR-045](decisions/045-windows-fatal-error-leaves-explorer-first.md) | Accepted: on a Windows crash, scenes leave Explorer before the crash goes to WER; `host.log`; a sign-in start whose render thread fails reopens hidden once (disabled since 2026-10-14) |
| [ADR-046](decisions/046-windows-sign-in-scenes-wait-for-settled-displays.md) | Accepted: a Windows sign-in start attaches scenes only after the displays settle (a closed laptop's built-in display turned off and the list unchanged for 5 seconds), for at most 3 minutes; the inputs to that decision are logged since 2026-10-15 |
| [ADR-049](decisions/049-windows-attached-scenes-render-in-software.md) | Accepted: Windows scene windows attached to Explorer render WPF in software; the floating layer and the main window are unchanged (a real-world test on 2026-10-16 showed it did not prevent crashes) |
| [ADR-050](decisions/050-windows-wpf-display-loss-runtime.md) | Accepted: Windows moves to .NET 10.0.13 for the WPF display-loss protection; three sign-in starts did not crash again and the maintainer authorized the integration; early removal of the primary display and other OS versions still need verification |
| [ADR-042](decisions/042-adjust-overlay-on-every-desktop-host.md) | Accepted: every desktop host adjusts through an overlay; the main window steps aside only if it had focus when adjusting started, and comes back afterwards |
| [ADR-041](decisions/041-labwc-shortcuts-through-rc-xml-keybinds.md) | Accepted: the settings page writes labwc shortcuts into a marked block in rc.xml, and the keybind hands them to the app through gapplication |
| [ADR-040](decisions/040-gnome-wayland-xwayland-choice.md) | Accepted: on GNOME Wayland the app asks at first start and XWayland can be switched in Settings, applied before GTK starts |
| [ADR-039](decisions/039-gnome-desktop-icons-and-x11-scene-size.md) | Accepted: X11 scenes are sized by the work area; GNOME XWayland keeps only the wallpaper layer resident; the adjust overlay started on GNOME XWayland (the current scope is in ADR-042) |
| [PLAN-003](plans/003-desktop-interaction-implementation.md) | Development handoff from contracts to platform / source integration |
| [Discussion history](research/2026-10-04-desktop-card-interaction-design.md) | Decision sources, additions and superseded proposals |
| [Platform research](research/2026-10-04-desktop-interaction-platform-feasibility.md) | Evidence and limits for Windows / public AppKit / labwc-Wayland |

## Project and current code

| Document | Purpose |
|---|---|
| [README](../README.md) | Positioning and where to start; Traditional Chinese edition: [README.zh-TW.md](../README.zh-TW.md) |
| [PROGRESS](../PROGRESS.md) | Current-state snapshot: status by area, verified and unverified boundaries, open items |
| [Release notes](release-notes.md) | One entry per version, written in the version-bump commit |
| Git history | The change log: each commit body states what changed and why, and the checks that ran |
| [ROADMAP](../ROADMAP.md) | Direction and order of future work; not a status record |
| [Architecture](architecture.md) | The formal design, kept apart from the existing 0.1.0 |
| [Setup](setup-guide.md) | Build and setup commands, including the existing validation version |
| [User guide](user-guide.md) | How to use the app; Traditional Chinese edition: [user-guide.zh-TW.md](user-guide.zh-TW.md) |
| [Internationalization](i18n.md) | Locales and the Display language setting, renderer catalogs, native string tables, writing style and terminology |
| [Google setup](google-setup.md) | OAuth clients for five platforms, public settings and account operations |
| [Testing](testing.md) | Runnable checks, verification procedures and untested boundaries |
| [Deployment](deployment.md) | Native packaging and the untested store scope |
| [Store submission materials](release/README.md) | Traditional Chinese / English listings, privacy policy ([English](release/privacy.md), [Traditional Chinese](release/privacy.zh-TW.md)) and public submission configuration |
| [API](api.md) | 0.1.0 HTTP / SQLite contract, not an established format for Drive 1.0 |
| [Security](security-guidelines.md) | Storage, permissions and isolation |
| [Services](services.md) | Listeners / ports of the existing validation version |
| [Third-party notices](../THIRD-PARTY-NOTICES.md) | Actual bootstrap sources and notices |

## Google, backup and historical research

- [Public release feed and company egress IP quota](research/2026-10-15-public-release-feed-without-api-quota.md): why ADR-044 removed the unverified REST API queries on three platforms and reads the Atom feed instead; official rules, measurements and limits.
The full research index is in [docs/research](research/README.md).

- [Drive research](research/2026-10-03-google-drive-notes-mvp-feasibility.md) and
  [ADR-004](decisions/004-google-drive-notes-mvp.md): the initial proposal; the provider was adopted by ADR-012, and the protocol is in SPEC-004.
- [Drive transport research](research/2026-10-04-drive-file-transport.md): API, paging, pre-generated IDs, resumable uploads and unverified boundaries.
- [Backup history research](research/2026-10-03-appdata-backup-and-restore-design.md)/[ADR-005](decisions/005-portable-backup-and-restore.md)
  keep the candidate background; the latest complete contract is in SPEC-002/ADR-013, and the
  [container and encryption research](research/2026-10-04-backup-container-and-encryption.md) records official sources and verification boundaries.
- [PLAN-002](plans/002-google-drive-notes-mvp.md): the order of source / Google / backup work, carried out together with PLAN-003.
- [Original backlog research](research/2026-10-03-backlog-first-product-requirements.md) and
  [lightweight PM model](research/2026-10-03-lightweight-project-management-and-view-model.md): historical discussion; the latest corrections take priority.
- [Sync and conflicts](research/2026-10-03-source-of-truth-sync-and-conflict-analysis.md),
  [macOS public API](research/2026-10-03-macos-public-api-desktop-feasibility.md),
  [distribution and licensing](research/2026-10-03-store-distribution-and-license-analysis.md),
  [independent development](research/2026-10-03-independent-architecture-and-validation-plan.md): kept evidence and research dates.
- [Full PM/server architecture](research/2026-10-03-product-architecture-blueprint.md)/
  [ADR-003](decisions/003-product-architecture-boundaries.md): Deferred; its Note container model must not override the latest specification.

## Existing validation evidence

- [SPEC-001](specs/001-validation-version.md)/[ADR-002](decisions/002-validation-runtime.md): scope of the implemented prototype.
- [2026-10-03 report](validation/2026-10-03-validation-report.md): the original pass, fail and untested matrix.
- [Mac historical handoff](plans/001-validation-version-macos-handoff.md): the earlier implementation route, not an instruction to restart exploration now.

## Collaboration and documentation conventions

- [AGENT-GUIDE](AGENT-GUIDE.md), [SCRIPT-STANDARDS](SCRIPT-STANDARDS.md), [Skills](../skills/README.md).
- [Decisions](decisions/README.md), [specifications](specs/README.md) and [plans](plans/README.md) each have an index and a template.
- [Terminology](terminology.md), [A2A](a2a/README.md) and [MCP](mcp-config.md) are generic material and do not mean the protocol is adopted.
- Documents use relative links; research uses YYYY-MM-DD-topic.md. Ask the maintainer for the location of the external reference checkout.
- English is the repository language. Only user-facing guides keep a Traditional Chinese edition (`*.zh-TW.md`), changed
  in the same commit as the English document; see "Language" in [AGENTS.md](../AGENTS.md).
- The current state is in PROGRESS, the history of each version in the release notes and the change log in the git
  history; see "Status, History and Release Notes" in [AGENTS.md](../AGENTS.md).
- Do not add a task completion table that competes with PROGRESS; acceptance-case tables are requirements, not completion status.
