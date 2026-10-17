# Build and run

Updated: 2026-10-04. The new UI and the existing 0.1.0 start separately; current status is in
[PROGRESS](../PROGRESS.md).

This guide is for developers and maintainers: prerequisites, builds per platform, previews, native setup, Google build
settings, packaging and signing entry points, and the 0.1.0 validation prototype. How to use the 1.0 app (notes,
groups, adjust mode, layers, shortcuts, settings, backups, Google sign-in, the tray and updates) is in the
[user guide](user-guide.md).

## 1.0 local UI development preview

Needs Node 22+, Python 3.12+ and a browser that supports IndexedDB and Web Locks.
This round was tested on Windows with Node 24.21.0, Python 3.13.7 and the installed Edge; other browsers and native
hosts are accepted separately.

```bash
npm ci --ignore-scripts
npm run build
python scripts/testing/serve_preview.py --port 0
```

Open the printed `/app/index.html` URL; Ctrl-C ends the development preview.
`--port 0` uses a free port. To reuse the earlier browser data, pass the same available port, because IndexedDB is
isolated by origin. This is a development listener for static assets; it has no notes API.

How to use the app is in the [user guide](user-guide.md). What the browser preview does not do compared with the native
apps (desktop layering, global shortcuts, Google sync, automatic backups) is listed in its
[Browser preview](user-guide.md#browser-preview) section.

## Windows native main window

Building needs Windows 10 build 19041+ or Windows 11, the .NET 10 SDK, the Evergreen WebView2 Runtime and Node 22+;
run `npm ci --ignore-scripts` first.
The MSIX minimum version is 22000, which covers early Windows 11, 23H2 and 24H2+ and excludes Windows 10 from
installing; MaxVersionTested stays at 26200.
On 2026-10-09 the isolated native probes and the three-layer real-screen pixel checks passed on 23H2 build 22631 at
144 DPI, and the contents of the unsigned MSIX were verified; normal interaction and MSIX installation still await the
user's acceptance.
There was no device with another version this round, and the existing 26200/25H2 records are not a real test on
26100/24H2. The supported and untested ranges are in
[ADR-034](decisions/034-windows-11-compatibility-and-install-floor.md) and the
[handoff entry](handoff/2026-10-09-windows-11-compatibility-handoff.md); current status is in
[PROGRESS](../PROGRESS.md). The app has not been formally submitted to the Store yet.
Build output run directly from `Build-WindowsApp.ps1` or the IDE needs the .NET 10 Desktop Runtime; the MSIX and ZIP
from `Build-WindowsPackage.ps1` bundle the runtime by default.
Both still need the Evergreen WebView2 Runtime. The main window, encrypted storage and the desktop and floating scenes
are connected.

```powershell
.\scripts\windows\Build-WindowsApp.ps1
& .\src\native\windows\app\bin\Release\net10.0-windows10.0.19041.0\WorkFleet.exe
```

Assets, native libraries and Licenses stay with the output directory; do not move the exe on its own.
In an IDE use `src/native/windows/WorkFleet.sln`; opening the root folder in VS Code gives the C# Dev Kit
recommendations and an F5 configuration. The folder layout and how to open it are in the
[Windows README](../src/native/windows/README.md).
An app built with `-Configuration Debug` has "Inspect" (DevTools) in its context menu. Only setting
`WORK_FLEET_WEBVIEW_DEBUG_PORT` opens loopback CDP.
Release builds and the MSIX open neither; usage is in [Testing](testing.md), the decision in
[ADR-032](decisions/032-windows-debug-webview-inspection.md).
The Windows SDK targeting pack is pinned at 10.0.19041.56; the UI probe also uses the app's PerMonitorV2 manifest.
This TFM is the build floor, not the minimum supported OS; the current status of real-device mixed-DPI acceptance is
in [PROGRESS](../PROGRESS.md).
Where the app stores its data, what an MSIX update or uninstall keeps, single-instance and close behaviour, and how to
use the main window, desktop notes, shortcuts, the tray and backups are in the [user guide](user-guide.md#windows).

That these features are connected does not mean that real mouse and IME use, mixed DPI, Show Desktop and the virtual
desktop matrix have all been accepted. Automatic backups have not been checked by driving the real OS picker
automatically, and power-loss durability on external disks has not been tested.
Native test commands are in [Testing](testing.md); the technical boundaries are in
[ADR-015](decisions/015-windows-native-storage-and-editor-host.md),
[ADR-016](decisions/016-windows-native-backup-files-and-vault.md), [ADR-018](decisions/018-single-owner-desktop-views.md)
and [ADR-019](decisions/019-windows-shortcuts-and-tray.md).

## Google and native build settings

Copy the root [.env.example](../.env.example) to `.env` and fill in, per platform, the public client ID, the Google
Cloud project ID and the native bundle or package ID, plus the team ID for Apple platforms.
Leave values empty until they exist; the local preview builds as usual. `.env` is ignored by Git, and values of the
same name in the shell or CI take precedence.
`ANDROID_HOME`, `JAVA_HOME` and `DEVELOPER_DIR` are SDK toolchain locations, kept as comments in the example.
Native builds still need the matching OS and SDK; setting a path is no evidence of device acceptance.

```bash
npm run config:check
npm run config:check -- --google --platform windows
npm run config:check -- --platform windows
```

The first command lists which settings each of the five platforms is missing; `--google` lists only Google settings
and does not require store or signing fields.
With a platform, it exits with a non-zero status when public settings that mode needs are missing.
`npm run build` reads the settings and generates `build/config/public.json` for native packaging, writing only the
allowed public fields.
Product behaviour shared by all platforms (for example how many seconds a sign-in start waits for the tray) is not in
`.env`; it comes from the repo's `config/startup.json` and is written into the same file.
The Windows build script uses `node scripts/build-web.mjs --platform windows` instead, which also writes the Windows
Desktop client secret into that file. Linux packaging likewise writes only the Linux secret; no other platform and no
UI asset contains a secret.
Android Gradle reads the current settings directly and generates the configuration in its generated-assets directory,
without depending on this pre-generated file.
The native hosts of all five platforms have Google sign-in, protected tokens and Drive appDataFolder sync code.
Which clients exist and which platforms have signed in to a real account is in [Google setup](google-setup.md) and
[PROGRESS](../PROGRESS.md).
After filling in the client ID and rebuilding, sign in from the native main window; the browser development preview
still has only local data. How to create the clients and move data is in [Google setup](google-setup.md); how to use
sign-in is in the [user guide](user-guide.md#google-sign-in-and-sync).

Google setup steps: in one Cloud project, enable the Drive API and configure the OAuth consent screen and test users.
Create a Desktop app client for Windows and Linux. For the Google Apple SDK, macOS and iOS each get an iOS-type client
that matches their bundle ID; Android gets a client that matches the package and the signing certificate. All five
platforms must be tested to read the same app data space.
Sign-in goes through the OAuth interface the system allows; the desktop loopback callback cannot be reused on iOS or
Android. This follows the [Google native-app OAuth documentation](https://developers.google.com/identity/protocols/oauth2/native-app)
and the [loopback platform restrictions](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration).

Do not put access or refresh tokens, signing private keys or service-account JSON in `.env`. Sign-in credentials are
managed by native secure storage, and CI signing secrets come from CI secrets or a keychain. The client ID is a public
application identifier and cannot replace OAuth verification.

## Android 1.0 build

In Android Studio use **Open** to choose `src/native/android`, finish Gradle Sync, then choose `app` / `debug` and Run
or Build APK.
Needs Node 22+ with npm reachable on the IDE's PATH, JDK 17 or a compatible newer version, Android SDK Platform 36 and
Build Tools 35.0.0.
The project includes the Gradle 8.13 Wrapper; Gradle installs the lockfile dependencies and generates the UI and the
public configuration automatically, so `npm run build` is not needed first.
Without `.env` you can use the local preview; Google and the release configuration are in the
[Android README](../src/native/android/README.md).

```powershell
# In the src/native/android directory
.\gradlew.bat assembleDebug
```

The APK is at `src/native/android/app/build/outputs/apk/debug/WorkFleet-<versionName>-android-debug.apk`;
`Build-AndroidApp.ps1` and `build-android-app.sh` also copy it to `build/`.
Version numbers and file names per platform are in [Deployment](deployment.md).
After changing the application ID in `.env`, sync again. `local.properties` is the local SDK path that the IDE
generates; it is not committed.

## macOS and iOS 1.0 native build

Needs full Xcode and Node 22+ with npm; macOS 13+ or iOS 16+.
After cloning, open `src/native/apple/WorkFleet.xcodeproj` directly and choose WorkFleetIOS with a Simulator, or
WorkFleetMac.
The project is committed and uses relative paths; Xcode installs dependencies and generates assets automatically, so
no generator or web build has to run first.
Google and store public settings go in `.env`. For direct Xcode use, the app ID, App Group and Team go in the ignored
`src/native/apple/config/Local.xcconfig`, with an example in the same directory. Signing certificates and provisioning
are configured in Xcode; private keys never go in settings files.

```bash
open src/native/apple/WorkFleet.xcodeproj
# or the command-line entry point for the same project:
bash scripts/macos/build-native-app.sh --platform macos
bash scripts/macos/build-native-app.sh --platform ios --simulator
bash scripts/macos/build-native-app.sh --platform ios --release
bash scripts/macos/package-preview-app.sh --platform macos --dmg
```

The scripts use the committed project; DerivedData, the Release xcarchive and exports stay in the ignored
`build/apple/`.
macOS command-line builds always include arm64 and x86_64. The preview package is named after the app's version and
signature, `--dmg` produces a DMG, and the installers go into `build/`.
The native main window connects SQLite and Keychain, native folder backups and Google authorization and Drive; macOS
also connects the desktop scenes, global keys, the menu bar and the screen lifecycle. A macOS Debug universal build
has been compiled in Xcode and produced an Apple Development signed DMG, and Keychain, SQLite and main-window
initialization passed with an isolated fixture; iOS, Developer ID and notarization, and full operation have not been
accepted yet.
On a local Mac, choose a Team in the WorkFleetMac target's Signing & Capabilities, enable automatic signing and
complete Register Device.
Operating details and the remaining deliverables are in the [Apple README](../src/native/apple/README.md); current
status is in [PROGRESS](../PROGRESS.md).

iOS share receiving also embeds the `<APP_ID>.share` Extension; enable App Groups for the app and the Extension in the
same Apple team. Direct IDE use takes WORK_FLEET_APP_GROUP_ID from Local.xcconfig; the CLI can override it with
`.env`, and the default is `group.<WORK_FLEET_APP_ID>`. The actual signing profiles must include this group;
certificates stay in Xcode and the Keychain.

## Native packages and signing entry points

Windows x64 packaging uses a self-contained .NET 10 Desktop by default, so MSIX and ZIP recipients do not install .NET
separately; WebView2 is still a runtime prerequisite.
The build machine needs the .NET SDK, and the Windows SDK provides MakeAppx and SignTool. The first packaging run
restores the win-x64 runtime packs; only after that can `-SkipRestore` be used.
The public identity and publisher are configured from `.env.example`; a preview can do without a formal Google
account for now.

```powershell
.\scripts\windows\Build-WindowsPackage.ps1
.\scripts\windows\Build-WindowsPackage.ps1 -LocalTestSign
.\scripts\windows\Build-WindowsPackage.ps1 -Release -CertificateThumbprint <thumbprint> -TimestampUrl <https-url>
.\scripts\windows\Build-AndroidApp.ps1 -Signed
.\scripts\windows\Build-LinuxPackage.ps1
```

The Windows MSIX and ZIP are written to `build/` (the working directory `build/windows/package` is rebuilt every
time); without a certificate the MSIX is unsigned.
For local trial installs use `-LocalTestSign`. It reuses a code-signing certificate in CurrentUser/My that matches the
manifest publisher exactly, is valid and is trusted in LocalMachine/TrustedPeople; when there are several, choose one
with `-CertificateThumbprint`.
This mode delivers only after signing succeeds and local trust verification passes, and it also outputs
`WorkFleet-preview.cer` without the private key.
A computer that already trusts that certificate can open the MSIX to install it, with no Windows Store developer
account.
Other test computers must trust the public CER first; see the
[Microsoft guide to signing locally](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide).
The script does not create certificates, change trust or install the app; `-LocalTestSign` uses no timestamp and
cannot be combined with `-Release`.
If Windows has JDK 17 but no Android SDK, run
`scripts/windows/Install-AndroidToolchain.ps1 -AcceptSdkLicenses` first, after reading and accepting the
[SDK terms](https://developer.android.com/studio#terms-and-conditions). The tools, API 36, Build Tools 35.0.0
and a paths JSON go into `build/toolchain`, without changing the machine's PATH. `Build-AndroidApp.ps1` then reads the
paths directly.
The four process or CI environment inputs for Android signing are in [Store preparation](release/README.md); they are
not written to `.env`.

For Apple, first produce an archive with the Release entry point from the previous section, then export it on a Mac
with Xcode:

```bash
bash scripts/macos/package-native-app.sh --platform ios --method app-store-connect
bash scripts/macos/package-native-app.sh --platform macos --method developer-id --dmg
bash scripts/linux/build-android-app.sh --signed
```

Apple can use `--archive` to pass an existing archive. Formal macOS signing and notarization also need the installer
and application identities and a Keychain notary profile; see [Deployment](deployment.md). These entry points do not
create store accounts or submit for review automatically.

## Linux 1.0 native build

Needs Python 3.10+, GTK 3, WebKitGTK 4.1, PyGObject and cairo, and cryptography on Linux. New workspaces and offline
notes whose master key migration has finished do not need a keyring.
Google tokens, saved automatic backup passwords and the first migration of old data need libsecret and an unlocked,
persistent Secret Service ([ADR-048](decisions/048-linux-offline-workspace-and-system-secrets.md)); how the app
behaves while it is locked is in the [user guide](user-guide.md#linux).
The native main window, SQLite, encryption, Google, backups and desktop scenes are connected.
X11 global keys can use Keybinder 3. Wayland desktops need GtkLayerShell support, and shortcuts there need a
GlobalShortcuts portal backend. The tray is enabled when Ayatana/AppIndicator or Gtk.StatusIcon is available; without
these capabilities the main window can still record.

```bash
npm ci --ignore-scripts
bash scripts/linux/build-native-app.sh
bash "build/linux/work-fleet-$(cat src/native/linux/VERSION)/run-work-fleet.sh"
bash scripts/linux/build-native-app.sh --deb
bash scripts/linux/build-native-app.sh --release --deb
```

GNOME Wayland (for example the Ubuntu 22.04 default) has no layer-shell, so desktop notes go through XWayland. The
first-start question and the setting are described in the [user guide](user-guide.md#linux); to start under XWayland
directly, run `GDK_BACKEND=x11 work-fleet` ([ADR-040](decisions/040-gnome-wayland-xwayland-choice.md),
[ADR-039](decisions/039-gnome-desktop-icons-and-x11-scene-size.md)).
The build produces source and runtime tar.gz files; `--deb` needs the Debian tools, and `--release` also needs the
formal public settings. The native-scene checks in an isolated headless Linux compositor and the private synthetic
keyring checks are in [Testing](testing.md), with current status in [PROGRESS](../PROGRESS.md); they do not replace
a user's reboot or install acceptance. Details are in the [Linux README](../src/native/linux/README.md).

Windows can run `Build-LinuxPackage.ps1` with an existing Docker Linux engine; it produces a preview DEB with the
dpkg-deb of a pinned Ubuntu image. It needs no local Linux GUI and does not run the app. `-Release` requires the
formal public settings.
The Linux and Windows build entry points both produce `build/work-fleet_<version>_all.deb` directly, with no manual
file moves.
The tar.gz and the DEB are both in `build/`, the source and runtime copies in `build/linux/`; the DEB staging is
removed automatically when packaging ends.
The DEB suits distributions that provide the system dependencies above.
The version number is in `src/native/linux/VERSION`; normal and release builds both use it, and early versions get
no extra `~preview`.

The GitHub build workflows for phone-installable builds are **Android device APK**
(`.github/workflows/android-apk.yml`) and **iOS registered-device IPA** (`.github/workflows/ios-ipa.yml`). After the
public Variables and the explicitly authorized signing Secrets are configured, run them manually from Actions on main,
and download the APK or IPA, its checksum and the source commit from Artifacts, which are kept for fourteen days.
They keep each platform's existing version number, create no Release or tag and submit nothing to stores. The signing
settings and how to install on specific devices are in the phone device test builds section of
[Deployment](deployment.md). After adding an iOS device, update both profiles, for the main app and the Extension.

The unsigned Apple build workflow is `.github/workflows/apple-native-build.yml`. Choose macOS, iOS or both; it
compiles the native Debug app on a hosted Mac and outputs an unsigned ZIP or device IPA. Public settings use GitHub
repository variables with the same names; without values it uses the preview IDs and the local mode without Google.
Hosted runners for a public repository are free; a manual workflow still needs the user's authorization to start.
After a developer account and signing are in place, the formal archive and export above are still needed; an unsigned
device IPA has to be re-signed before it can be installed.

## 0.1.0 requirements

- macOS 13+ and the Command Line Tools (`xcode-select --install`); tested on macOS 26.7.1 x86_64 with Swift 6.3.3.
- Python 3.12+ with the standard-library sqlite3; tested with Python 3.14.7 and SQLite 3.51.0.
- Node 22+ only for the JavaScript tests; tested with Node 24.21.0.
- No pip or npm runtime packages, no `npm install` and no formal signing certificate are needed.
- Local ad-hoc signing is enough for validation; distribution to other machines and stores still needs formal signing
  and package verification.

## 0.1.0 one-step start on macOS

From the root of the checkout:

```bash
bash scripts/macos/start-validation.sh
```

The command builds `build/Work Fleet.app`, starts the loopback service and pairs the Mac with a one-time admin invite.
Data is in `~/.work-fleet/` by default; the app's settings and offline cache are in its own Sandbox container.
Ctrl-C in the terminal stops the server this run started; WF → Quit in the menu bar closes the app.
`WORK_FLEET_DATA` sets a data directory outside the repo, and `--port 9848` changes the port.
A port that is already in use fails at once; other services are not stopped.

## 0.1.0 separate start and a second client

```bash
bash scripts/macos/build-app.sh
python3 src/server/work_fleet.py serve
```

In another terminal, create an admin invite (the invite output is a short-lived secret; never commit or share a
permanent token):

```bash
python3 src/server/work_fleet.py invite --role admin
open 'build/Work Fleet.app'
```

In the menu bar choose WF → Connection and display…, and enter `http://127.0.0.1:9847` and the printed `code`.
Once the Mac is paired, its control window can create an editor QR code; the web admin page can choose read-only or
editing access and revoke devices.

Open `http://127.0.0.1:9847` and pair the browser with a separate editor invite:

```bash
python3 src/server/work_fleet.py invite --role editor
```

The browser and the app use the same server data. Safari/WebKit each keep their own local drafts and share no
storage.

## 0.1.0 operation

- Quick capture: WF → Quick capture / Unlock, type the text and save; the group defaults to Inbox.
- Supports Todo, In Progress and Done; Done and deleted notes are viewed separately and can be restored.
- `- [ ]` and `- [x]` in the text show as checkable to-dos.
- WF → Lock shows read-only notes; they still receive data every 2 seconds and sit above the desktop icons by default.
- The control window switches between Normal window, Above desktop icons and Below desktop icons. Below desktop icons
  is an experimental mode.
- The web page polls every 2.5 seconds; offline it shows the last content, and drafts are saved on every input.
- A network error keeps the original operation and shows "Retry the same send"; a conflict shows the current content
  and offers "Save draft as a new note".
- "Kept drafts" can be recovered; recovering creates an independent draft so that tabs do not delete each other's
  drafts. The original has to be discarded explicitly.
- Connection and devices → Export local drafts downloads JSON; there is no automatic import or merge yet.

## 0.1.0 LAN and phone QR

A loopback QR code is only for the same Mac; scanning it with a phone does not give the phone a network path.
For the LAN, use a TLS certificate the phone trusts and set the exact hostname and origin, for example:

```bash
python3 src/server/work_fleet.py serve --host 0.0.0.0 --port 9847 \
  --origin https://fleet.example.test:9847 --cert /secure/path/cert.pem --key /secure/path/key.pem
```

First pair the Mac with that HTTPS URL, then create the QR code; the phone confirms the address and the name before it
submits the one-time invite.
Certificates, DNS and hostname resolution, and LAN reachability have to be configured by you. There is no option to
ignore TLS verification or trust certificates automatically.
Access from the internet needs a trusted HTTPS deployment or a VPN; real phones, the internet and store packages have
not been tested.

## 0.1.0 backup and restore

A backup can run while the server is running; the destination file must not exist:

```bash
python3 src/server/work_fleet.py backup /secure/path/fleet-backup.sqlite3
```

Stop the server first, then restore to a **new data path** (the current DB is not overwritten):

```bash
python3 src/server/work_fleet.py --db /secure/path/restored.sqlite3 restore /secure/path/fleet-backup.sqlite3
python3 src/server/work_fleet.py --db /secure/path/restored.sqlite3 serve
python3 src/server/work_fleet.py --db /secure/path/restored.sqlite3 invite --role admin
```

Restoring changes the epoch, revokes every device and clears invites and operation retry records. After pairing again,
devices read the restored snapshot. Old drafts are kept but cannot directly overwrite the new data generation. Keep the
original DB, the backup and the unsynced drafts on devices separately.
A backup contains private content and token hashes; store it in a protected location, encrypted where needed.
