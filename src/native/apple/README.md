# Apple native App

macOS 13+/iOS 16+; needs a full Xcode (Swift 5.10+) and Node 22+. This directory is the 1.0 native host and does not
use the historical Python server. The main window and the phone editor share the packaged assets; macOS also connects the
desktop and floating scenes.

## Open directly after cloning on a Mac

`WorkFleet.xcodeproj`, the workspace, two shared schemes, the default xcconfig and the icons are all in Git.
All source and entitlements references use relative paths; there is no need to generate the project first, and nothing
depends on another computer's `build/`.
In the root of a full repository checkout, run:

```bash
open src/native/apple/WorkFleet.xcodeproj
```

Choose `WorkFleetIOS` and an iPhone/iPad Simulator, then press Run; for macOS use `WorkFleetMac`.
Node 22+ (with npm) must be installed. Xcode's Prepare local resources phase installs the lockfile dependencies and
generates the shared UI, the public configuration and Info.plist automatically; the first run needs to download the
npm/SPM dependencies, and there is no need to run `npm run build` first.
The assets are in this directory's `.generated/<target>/`, which Git ignores.

The default Debug app ID is `app.workfleet.preview`, and a local preview builds without Google settings.
For devices or the final identity, copy `config/Local.xcconfig.example` to the Git-ignored `config/Local.xcconfig`
and fill in WORK_FLEET_APP_ID, WORK_FLEET_APP_GROUP_ID and DEVELOPMENT_TEAM; the main app and the extension use the same
settings.
The Signing Team can also be set in Xcode. Google clients and public store data are still read from `.env` at the
repository root.
For direct Xcode builds the app ID and App Group follow the Xcode build settings, so that signing, entitlements and the
bundled configuration stay consistent.

Local macOS trials also need a valid signature to use the Data Protection Keychain. In the WorkFleetMac target's
Signing & Capabilities, turn on Automatically manage signing, choose a Team, and complete Register Device.
Xcode Accounts/Manage Certificates can create an Apple Development certificate; do not disable entitlements or reset the
Keychain.
Apple Development is only for devices the profile allows; distribution to other machines still uses Developer ID and
notarization.

The Prepare phase adds `/opt/homebrew/bin` and `/usr/local/bin` to the tool search path;
custom Node/npm paths can be set as WORK_FLEET_NODE/WORK_FLEET_NPM in Local.xcconfig.
This phase needs to read the local configuration and download and install tool dependencies, so Xcode user-script
sandboxing is off;
the app's Sandbox, Keychain and entitlements settings keep their existing contract.
The AppIntents metadata extraction warning in Xcode builds is expected and harmless (2026-10-05).

## Command-line builds

```bash
bash scripts/macos/build-native-app.sh --platform macos
bash scripts/macos/build-native-app.sh --platform ios --simulator
bash scripts/macos/build-native-app.sh --platform ios --release
```

The scripts use the same committed `src/native/apple/WorkFleet.xcodeproj` and never regenerate or overwrite the IDE
project.
A non-empty app ID or team in `.env` becomes a command-line build setting; otherwise the xcconfig settings apply.
DerivedData, archives and export intermediates are in the ignored `build/apple/`; the packaged PKG/DMG/ZIP/IPA files go
directly to `build/`. Xcode builds must run on a Mac.
The SDK is pinned to GoogleSignIn 9.2.0; the licence texts at the SPM checkout roots are copied into the bundle's
Licenses before signing.
The ES modules of the Apple main window and desktop scenes are bundled at build time by a pinned esbuild into classic
deferred scripts,
so WKWebView can run them from local packaged files; the sources stay shared, and the CSP, native bridge and Sandbox
are kept. See [ADR-033](../../../docs/decisions/033-apple-local-script-bundles.md).
Release asset preparation checks for valid public settings before archiving; signing and provisioning are configured in
Xcode and the Keychain.
`scripts/macos/package-native-app.sh` exports an existing archive; iOS can produce an IPA, and macOS a PKG and an
optional DMG.
The Apple version is recorded as `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` in `config/WorkFleet.xcconfig` and cannot
be overridden in Local.xcconfig;
macOS command-line builds always include arm64/x86_64, and the PKG/DMG file names are
`WorkFleet-<version>-macos-universal`.
`--method app-store-connect` keeps the export local, with no automatic upload; Developer ID can notarize and staple with
an existing installer identity
and a Keychain notary profile. Notarizing a DMG also requires the application identity; the scripts contain no private
keys.
The macOS target enables the hardened runtime. Commands and platform limits are in the
[distribution document](../../../docs/deployment.md).

Without a signing identity, Debug can use `--unsigned` to compile the native macOS/iOS device app;
`scripts/macos/package-preview-app.sh --platform macos|ios` saves a ZIP/IPA, or a DMG on macOS with `--dmg`;
the file name carries `-unsigned` or `-development` according to the app's version and actual signature. The file names
per platform are in the [distribution document](../../../docs/deployment.md#versions-and-release-file-names).
This is a natively compiled preview; protected storage, Google and iOS installation still need a suitable signature and
profile.

Build and install iOS locally with Xcode or the local build, signing and packaging scripts. Development and Ad Hoc
IPAs embed profiles that disclose registered device UDIDs, so iOS packages are not built or uploaded by GitHub Actions
([ADR-057](../../../docs/decisions/057-local-ios-builds-and-device-privacy.md)). Public Actions artifacts are not private
downloads, even when no Release is created. Keep both the main app's and Share Extension's profiles on the Mac;
after adding a device, update both local profiles. Local signing with existing Xcode-managed profiles is also supported
by `scripts/sign_ios_app.py`. Commands and installation are in
[phone test builds](../../../docs/deployment.md#phone-test-builds).
`--unsigned` does not allow Release and does not skip the configuration requirements of a release archive.
`.github/workflows/apple-native-build.yml` provides only a manual unsigned macOS build with seven-day artifact retention,
a limit of 20 minutes, and no tests or store upload; runner billing for a private repository needs the
maintainer's consent first.

GoogleSignIn's Apple SDK uses an **iOS-type OAuth client** for both macOS and iOS, each matching
the actual bundle ID, entered as the MACOS and IOS client IDs in `.env`. The generator adds the reversed client URL
scheme.
Apple signing certificates and the Keychain access group are required for sign-in and secure storage; an unsigned
simulator build does not show that real sign-in works.

SQLite is in the App Sandbox's Application Support/WorkFleet; content, attachments and native metadata are encrypted
with a Keychain AES-256-GCM key. The database's same-revision CAS and the attachment writes are one transaction, and
flock keeps a single owner.
In WKWebView only the packaged document in the main frame can call the bridge; desktop windows have no database, file or
credential capabilities.
On iOS the page fixes its scale (`maximum-scale=1, user-scalable=no`), which WKWebView honours while
`ignoresViewportScaleLimits` stays off, so two fingers, a double tap or a focused field do not zoom the app
(2026-10-24). On macOS WKWebView's `allowsMagnification` stays off, so a trackpad pinch does not zoom either.
Folder selection keeps a bookmark and the file system identity; the automatic backup journal and password are natively
protected, and the password is never returned to the renderer.
Portable backups stay in the SPEC-002 PBKDF2/AES-GCM ZIP format; restoring on another device needs the original
password, which the user must keep.

The macOS desktop visual panel always has ignoresMouseEvents; only papers that can be operated, or that have read-only
text selection open, get a transparent input region, clipped by the renderer's stacking order where covered. The
in-place editor stays in the same WKWebView; the main window is the only content owner.
The hit panels pass only presses, drags and scrolls to that WKWebView, never mouse movement, so the scene has no hover:
CSS `:hover` and `title` tooltips do not appear there. A quick edit also leaves the app inactive, where AppKit shows no
tooltips by default. The in-place editor's buttons are therefore icons with accessible names and no tooltip.
The Desktop layer uses the public `desktopIconWindow + 1`, the Top layer uses floating; the Wallpaper layer uses
`desktopWindow + 1`,
above the wallpaper and below the icons, with fixed mouse click-through. Adjust this group temporarily moves the group to
the floating level, and ending it restores the current persistent setting and the original position.
There are three scenes per display; display reconnection, Space changes and sleep keep the editing WebView.
The native three-layer check on a Mac is `bash scripts/macos/test-desktop-layers.sh`; it needs a graphical session and
the Xcode CLI tools.
Shortcuts are registered with Carbon RegisterEventHotKey, and the global keys are released while the app or the editor
is in use; conflicts are shown in settings.
The menu bar has "Open Work Fleet", "Quick capture", "Adjust all groups", "Show or hide desktop notes", "Check for
updates…" (only when in-app updates are available) and "Save and quit"; the application menu has "Save and quit Work
Fleet". Display, Space and sleep
notifications pause input,
keep the editor surface, and apply the new topology after the owner saves the rescue position; background updates never
take keyboard focus.

On 2026-10-05 a macOS Debug universal build (arm64/x86_64) was compiled with Xcode 27.0 on an Apple Silicon Mac,
and a 0.1.0 Apple Development signed DMG was produced; the signing and mount checks are recorded in the git history and
[Testing](../../../docs/testing.md).
Keychain create/update/read with an isolated signing fixture, reopening the encrypted SQLite and the main window's
native initialization passed;
the commands to reproduce them are in [Testing](../../../docs/testing.md). The tests do not read the user's workspace and
are not a full product acceptance.
At that time no Developer ID/notarized build or release archive/export had been produced, and results were missing for
full screen/Spaces, transparent input forwarding,
IME, multiple displays, Intel hardware and a real Google sign-in.
As of 2026-10-17 these are not verified on macOS: Quick Look thumbnails and default-app opening inside the sandboxed app,
main-window placement, Intel Macs and IME. The macOS layer-probe additions from 2026-10-16 and the
`config/startup.json` fixture updates to `apple-signing.test.js` and `apple_startup_probe.py` (2026-10-17) have not been
run on a Mac. On 2026-10-24 `scripts/macos/test-desktop-layers.sh` ran on the maintainer's Mac over Screen Sharing and
stopped at "Adjustment must receive input across the whole viewport", with and without that day's quick move change,
so its later checks did not run there.
Quick move (SPEC-003, 2026-10-24) reads ⌘ from the event each paper's hit panel forwards; the hit panel that took the
press keeps its frame and stays shown until the release, also when the paper moves off the piece it covered or off its
screen, so the drag events it converts keep one origin and the release is not lost. A real ⌘-drag on a Mac has not been done, and over Screen Sharing the key may not arrive at all.
Quick edit (SPEC-003, 2026-10-24) opens the paper in the screen's Top-layer scene; on the owner's `desktop.focusEditor`,
shortly after a scene sent `card.edit`, that nonactivating panel becomes the key window without bringing the app to the
front, and it resigns the keyboard when the frame no longer shows the editor there. Not tried on a real Mac yet.
Data that can't be opened (SPEC-006 DO, 2026-10-23): `FleetDatabase` names a generic open failure from SQLite's last
result code, and the macOS `FleetWebHost` shows an alert with the cause, the folder ("Show in Finder") and, for
damaged data, the confirmed set-aside, which moves `fleet.sqlite3` and its journals into a dated set-aside folder; the
storage key stays in the Keychain, so the set-aside copy stays readable. A Keychain failure keeps its own message. The
page's explanation uses `data.location`, `data.reveal` and `data.setAside`. None of this has been compiled or run on
a Mac; iOS gets the named causes in its existing alert only.

The iOS 27 SDK terminates apps that do not adopt the UIScene life cycle, so the iOS main app uses `FleetSceneDelegate`
to create the window and handle the Google callback and foreground/background events; the generated Info.plist contains a
single-scene `UIApplicationSceneManifest`.
On 2026-10-06 a development-signed Debug build made with Xcode 27.0 was installed on an iPhone with iOS 27.0.1, and the
main window showed correctly;
full operation, iPad, Share Extension and Google acceptance were not done.
Device used for iOS checks: an iPhone 16 Plus on iOS 27.0.1 (2026-10-06), built with Xcode 27.0 (27A266a) and
Node 24.21.0 on an Apple Silicon Mac running macOS 27.0.1.
As of 2026-10-17 these are not verified on iOS: full editing, attachments and backups, iPad, real sharing through the
Share Extension, background save, scene reconnection and Google sign-in.
Low-severity iOS issues from the 2026-10-06 review, not fixed: if the WebContent process is killed while the scene is
also disconnected, the reconnected scene reuses a stopped host and stays blank without an error until the app restarts;
if the scene is torn down while the folder picker is open, `directoryContinuation` never times out and later folder
picks fail with `backup-permission` ("The backup location can't be used right now. …") until the app restarts.

Attachment and draft downloads use native export: NSSavePanel on macOS and UIDocumentPicker on iOS, keeping the
cancelled result.
The iOS editor shares Markdown text and a single attachment through UIActivityViewController/an iPad popover.
The transfer reuses the owner staging with capacity and SHA-256 checks; share staging uses complete file protection and
is removed after completion or cancellation.
A native dialog timeout or an account switch ends a pending iOS export. Sharing to another app does not mean the
recipient received it.
The committed Xcode project also builds and embeds WorkFleetShare.appex; the Share Extension receives text, URLs and
files.
The App Group of the app and the extension is set by `WORK_FLEET_APP_GROUP_ID`, by default `group.<APP_ID>`;
the App Group must be registered in the same Apple team and added to the signing profiles of the main app and
`<APP_ID>.share`.
The Share inbox uses the App Group shared container and a Keychain key for AES-GCM protection, flock exclusion and
complete file protection.
The extension only saves received items; it never reads the main app's workspace or Google credentials and never forces
the main app to open.
The main app refreshes the Share inbox when it comes to the foreground or restarts, and removes the original item only
after the user chooses a group and the draft is saved; failures and retries keep the receipt.
At most 256 KiB of text, 16 files and 25 MiB of files in total per share; the Share inbox holds at most 64 items/512 MiB.
Without configured App Groups the main app can still edit notes, but the Share inbox is unavailable; the native extension
and file providers have not yet been run.

`scripts/generate-apple-project.mjs` is only for maintaining the project structure or after adding Swift files; it
rewrites the committed project and icons.
Ordinary opening or building does not need it. The portable project decision is in
[ADR-029](../../../docs/decisions/029-portable-apple-xcode-project.md).

## Localization

- The host's own text (menu bar and application menus, alerts, the Share Extension sheet and the reasons it returns for
  the page) is in `Shared/FleetText.swift`, with an `i18n:en` and an `i18n:zh-TW` block.
- macOS keeps the Settings > General > Display language choice (`auto`, `en` or `zh-TW`) in the `language` field of
  `host-preferences.json` in the app's data directory, with the startup settings; the host applies it before it builds
  the menus. `host.language.set` saves it first (a failed write keeps the previous language), then re-resolves the
  locale and rebuilds the menu bar and application menus.
- iOS keeps it in the app's user defaults (key `language`) and copies it into the App Group's defaults, which the Share
  Extension reads so that its sheet uses the same language; without an App Group the extension follows the system
  languages. `host.language.set` stores it in both places and re-resolves the locale.
- The preference is never part of a profile, a backup or Google data; `auto` follows the system's preferred languages.
  The rules are in [Internationalization](../../../docs/i18n.md).
