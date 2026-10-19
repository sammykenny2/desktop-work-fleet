# Builds, tests and evidence

Updated: 2026-10-17. This document holds the verification procedures and the verified and unverified boundaries.
Current status is in [PROGRESS.md](../PROGRESS.md); the history and the evidence of individual runs are in the git history.
Evidence for the existing 0.1.0 prototype is in the [validation report](validation/2026-10-03-validation-report.md).

## Acceptance routing for the new interaction

The requirements for the new cards, groups and formation are in [SPEC-003 C01–C48](specs/003-desktop-cards-groups-and-formation.md);
the layered strategy is in [PLAN-003](plans/003-desktop-interaction-implementation.md).
`tests/desktop-core.test.js` verifies the grid, formation and capacity, undo, operation scope, the gesture model,
atomic save failures, safe exit from drafts and adapter replacement; the injected in-memory persist does not prove that the OS writes to disk.
C numbers in test names mark only the simulated semantic part; the native capabilities of C16, C35, C40–C43 and C46–C47 still need acceptance on a real host.
A green result from old tests must not be listed as a pass for a new feature, and document changes do not restart the old Mac probes.

`tests/schema-version.test.js` verifies the SPEC-007 testing-phase policy: every current JSON format is V1, loading and editing trigger no version-bump writes,
local and Google share the V1 ZIP, and unsupported formats are rejected with the data kept. There is no per-version migration or copy acceptance work.
For documentation work, check_docs.py, git diff --check and a scope and semantic consistency check are enough.

## Proposed desktop presentation lifecycle verification

[SPEC-009 L01-L18](specs/009-desktop-presentation-lifecycle.md#acceptance-cases) defines the proposed acceptance
matrix; [PLAN-009](plans/009-desktop-presentation-lifecycle.md) assigns the implementation and checks.
The lifecycle is not implemented, and no new native probe or passing result is claimed here.

After implementation approval, use isolated data directories and test identities. First test the policy with
injected clocks/events, then use real core/child processes to exercise startup, IPC, durable saves and child loss.
Record the core process identity and storage owner before and after each fault; keeping a database file alone
does not prove that sync, drafts or automatic backup stayed alive. Use synthetic sync/backup adapters for fault
tests; real cloud operations require a dedicated test account.

For every native run, record OS/app version, local or remote session, display backend, relevant graphics/runtime
versions, active capabilities and whether the monitor is powered off, disconnected or virtual. Collect bounded
lifecycle/fatal logs without note text, credentials or private remote-access configuration. An absent display and
a failed topology query are separate test inputs.

| Environment | Required native exercises |
|---|---|
| Windows MSIX and ZIP | Sign-in/manual activation, eligible remote sessions with unreadable physical topology, failed D3D initialization, primary-display loss, resolution/DPI changes, sleep/wake, Explorer attachment/exit and isolated graphical-child failure |
| Linux/Pi | Core startup without a display connection, actual X11/Wayland backend loss/reconnect, RustDesk and Guacamole separately, monitor off/on, supported layers/tray/shortcuts and resolution changes |
| macOS | Nonvisual core startup, display/session changes, sleep/wake, graphical-host failure, menu-bar/login-item behavior and updater/explicit exit |

Before disruptive display/server changes or fault injection, coordinate access with the maintainer, especially
when the same remote session carries the diagnostic connection. Prefer disposable sessions and synthetic native
hosts; a Docker virtual display does not validate the Pi's real compositor or monitor-power behavior.

Exercise save-before/after-commit faults, lost acknowledgements, IME-preserving geometry updates, repeated identical
events, exhausted retry budgets, unauthorized IPC, account/session changes and Quit during a pending launch.
Verify that no late callback restarts the application, no layout is cleared during display absence, and the core
retains the same writer while eligible services continue. Explicitly document the limit for unsubmitted input
lost with a renderer. Add exact native commands only when their probes exist; unavailable platforms remain unverified.

## Note formatting and attachment checks

- `node --test tests/rich-content.test.js tests/desktop-authority.test.js tests/desktop-transport.test.js`: code colouring and escaping, bounded PNG, the preview cache, ownership of the current attachments, stale versions, click-through, and slow previews not blocking save or close.
- After a build, `node scripts/testing/scene-probe.mjs --url http://127.0.0.1:PORT` verifies the actual font sizes of the six heading levels, colouring and long-content budgets, checklists staying read-only, thumbnails, retry after sync, that double-click and keyboard open do not trigger a drag or edit by mistake, and that a `zh-TW` frame switches the scene's own text to Traditional Chinese and the next English frame switches it back; it uses only a synthetic host and is not a real test of opening files with OS applications.
  `browser-probe.mjs` also verifies the download fallback of attachment tiles in the main window, that they do not open the editor by mistake, and that the list creates no hidden tiles.
- The Windows Debug UI probe adds `--attachments`: it calls the Shell Image Factory for real, checks the PNG limit and the file-name and executable policy, and starts no external program.
  The core probe also verifies the current profile's bytes, missing attachments, thumbnails released from the storage gate, and late replies being invalidated.
- Linux uses the system Python: `python3 -B -m unittest discover -s tests -p 'test_linux_attachments.py' -v`.
  It tests private copies, the open adapter, the close race and, with GdkPixbuf, real image thumbnails. Without GI the real thumbnail tests are explicitly skipped; Windows explicitly skips the POSIX tests.
  WSL Ubuntu has no GObject Introspection by default, so the real GdkPixbuf thumbnail tests are skipped there (2026-10-17).
- macOS must be built with Xcode, and Quick Look, the default app and cleanup on account switch must be verified in the sandboxed app; an environment without a Mac cannot claim these passed.
- Text fitting with "…" (`src/app/fit.js`) has been checked only in Chromium (Edge and WebView2). Check it in WebKitGTK and WKWebView before relying on it there (2026-10-17).

## Language and release-notes checks

Both run in the full JS suite (`node --test tests/*.test.js`); run one alone with `node --test tests/i18n.test.js` or `node --test tests/release-notes.test.js`.

- `tests/i18n.test.js` (see [Internationalization](i18n.md#tests-and-the-cjk-guard)) checks that:
  - every locale has the same area files, keys and placeholders, with no empty text, and every key starts with its area's prefix;
  - lookups interpolate, fall back to English and pick plural forms, system languages resolve by the documented rules, and the Display language options are named in the current UI language;
  - every literal `t('...')` and `plural('...')` key in `src/` and every `data-i18n` key in HTML exists in English;
  - every error code a native host sends has a `nativeErrors.*` entry, and every native string table has matching English and Traditional Chinese blocks;
  - no file in the checkout (tracked, or untracked and not ignored) contains Chinese text outside the zh-TW catalogs, Chinese editions of documents (`*.zh-TW.*`, `*_ZH.*`), the zh-TW blocks of the native tables and the short list of exceptions in the test (the CJK guard). Each exception says why it needs Chinese.
- `tests/release-notes.test.js` checks that every version in the per-platform version records has a `docs/release-notes.md` entry, that entries parse (platforms, a summary of 1–500 characters, change bullets), and that the notes contain no publication-status wording ("published", "prepared") or 40- or 64-digit hex hashes. A version bump without its entry therefore fails before any release starts.
- Automated UI tests run in English: browser probes open with `locale: 'en-US'`, and native probes store the language preference `en` before the app starts.

## Reproducible commands

From the checkout root. Python uses only the standard library; the full JS suite needs the lockfile dependencies installed first:

```bash
npm ci --ignore-scripts
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.js
npm run build
npm run config:check
node --check src/web/app.js
python3 scripts/testing/check_docs.py
git diff --check
```

Running the full Python discover on Windows fails a few Linux-only tests (seen: google, surface, xwayland, labwc, pcmanfm, vault), and unchanged HEAD fails the same way;
the surface `/proc` detection test needs `os.getuid`, which Windows lacks. Run the Linux tests in WSL or on Linux; do not change product code or tests to hide this.

`.github/workflows/ci.yml` runs on GitHub-hosted runners on every push to main and every pull request: the JS and Python tests and the build above,
the Linux Docker desktop-layer and host checks (`test-desktop-layers.sh`, `test-host-shell.sh`), and the Windows Debug build, core probe and unsigned-package check.
It uses no secrets; the WebView2 UI probe (`Test-WindowsNative.ps1`), signing, Apple builds and real-device acceptance stay local or in manual workflows.
The step that uploads failure evidence runs `sudo chmod -R a+rX` first, because root-owned 0700 folders from the container (such as `config/autostart`) are unreadable to the runner.
It runs only on failure, so it is unverified while CI is green (as of 2026-10-14).

The manual phone workflow is `android-apk.yml`; configuration is in [phone test builds](deployment.md#phone-test-builds).
Its build job has contents: read, explicit artifact paths and always-run cleanup of temporary signing data. The optional
publication job has contents: write and runs only with `release` enabled and the maintainer's authorization.
`apple-native-build.yml` is an unsigned macOS-only compile/package check. iOS builds and installation stay local
([ADR-057](decisions/057-local-ios-builds-and-device-privacy.md)); public Actions artifacts are not private storage for IPAs.
When actionlint is available, run `actionlint .github/workflows/android-apk.yml .github/workflows/apple-native-build.yml`.
`node --test tests/mobile-build-boundaries.test.js` guards against iOS IPA uploads and hosted iOS signing and checks that
the macOS artifact patterns exclude device IPAs, simulator ZIPs and their checksums, including stale files in `build/`.
Local checks do not establish a hosted build or real-device acceptance; signing Secrets and dispatch need authorization.

- `python3 -B -m unittest discover -s tests -p 'test_ios_*.py' -v`: the iOS profiles' validity period, Team, certificate, App ID, App Group and Keychain, the same device set,
  and, before signing, the bundle and Extension identity, version and executable scope. It uses only synthetic data and never reads a real private key.
- Real iOS signing: first run `bash scripts/macos/build-native-app.sh --platform ios --unsigned`, then provide the two profiles, the public DER certificate and the app settings as
  `python3 scripts/sign_ios_app.py --help` describes. The tool signs the nested code, the Share Extension and the main app and verifies them; finish with `bash scripts/macos/package-preview-app.sh --platform ios`.
  Installing, launching and Google sign-in on a real device are each accepted on their own; a codesign check does not replace them.
  On the maintainer's Mac, CoreSimulator reported an older service version than Xcode, so the iOS Simulator was not started; the iOS checks there were build-only (2026-10-17).
- Real Android signing: set `WORK_FLEET_ANDROID_DEBUG_KEYSTORE` to the absolute path of the existing debug keystore,
  run `testDebugUnitTest assembleDebug`, and check the APK with the SDK's `apksigner verify --verbose --print-certs`.
  The SHA-1 must match the installed build and the value registered for OAuth; the official release key does not use this debug setting.

`python3 -B -m unittest discover -s tests -p 'test_linux_package.py' -v`, where bash and dpkg-deb are available,
really packages an isolated fixture and verifies that the version and file name of both the normal and the release DEB come from the bundle's `package.json`, that a missing version is rejected,
and that release still rejects a missing maintainer email. Without the tools it skips; it installs no packages and starts no GUI.
It also verifies that success and failure both remove this run's staging and keep existing output. With Node 22+, npm and the lockfile dependencies,
it rewrites `src/native/linux/VERSION` in an isolated checkout whose path contains spaces and runs the full `--deb` build,
confirming that the DEB and tar.gz are written directly to the root of `build/`, that their file names follow that version, that each `.sha256` matches its file,
that `build/` gets no other new files, and that rebuilding the bundle removes source files that no longer exist; that the launcher prefers `/usr/bin/python3`;
and that an interpreter named by `WORK_FLEET_PYTHON` receives the host path and the original arguments.
In WSL, give this fixture a Linux esbuild binary of the same version (kept under the ignored `build/`); do not reuse the Windows `node_modules` esbuild binary (2026-10-17).
In WSL the integrated `--deb` build test is skipped when WSL has no Node; the release workflow still builds it (2026-10-16).

`tests/release-versions.test.js` verifies reading and formatting each platform's version record, that packaging scripts no longer hard-code versions,
that the Windows csproj sets no version of its own, that the MSIX identity comes from `Directory.Build.props`, the Windows.Desktop floor 22000 and MaxVersionTested 26200, that Apple Info.plist values come from xcconfig
with local overrides rejected, that the Android file-name setting references `versionName`, and that each packaging entry point uses a fixed working directory and delivers to `build/`. It needs no native SDK;
it does not mean real MakeAppx, Xcode or Gradle output has been verified.

`tests/revisions.test.js` verifies SPEC-004 S01–S07: strict JSON, canonical bytes, missing parent or pending,
out-of-order branches, tombstones and late conflicts, whole-batch failure and 12,000 entries of reverse history; it does not mean real Google is connected.
`tests/file-sync.test.js` also forces six devices that read the same empty source to upload at the same time, and verifies convergence of the initial group and root versions,
repeated resets, a marker on the last page, late initial uploads, renames, retirements and notes, reopening, account isolation, keeping an existing group with the same name, no initialization with pending history,
and retries after a save failure or a lost success response, validation of the source-generation fields, and resending the original bytes of an existing reservation without a generation.
It also covers a copy whose file ID allocation failed and that has no reservation yet, and a rescan after an expired cursor when a reset has written its marker but not yet deleted files; neither may relabel old outbox uploads.
`tests/cloud-restore.test.js` also verifies that after a full overwrite from an automatic initial-group backup of the same account, a new device still receives the complete groups, notes and original revision identities.
`tests/google-initial-group.test.js` verifies that before the first sync, new notes and the share entry create no extra random group, that existing Google groups and local capture stay usable offline,
and that once the initial group is on disk it can still be selected for new offline notes when the first upload fails.
These are isolated fixtures, not real round-trip acceptance on six Windows, macOS and Linux machines with real Google.
`tests/workspace-initialization.test.js` verifies that marker-only old raw data does not enter the graph, that reset followers do not upload,
that a new account takes over the same plan, and covers a manual group with the same name created during prepare, receipts missing a revision or attachment, a failed activation save,
reopening after ready is on disk but before the follow-up scan, a different plan or a wrong digest, an initialized empty workspace, reset journal retries that do not clear again,
an old job superseded by a newer reset, incomplete listings, and rejection of cross-account or invalid plans.
It also verifies that marker-only followers of repeated resets converge with cleanup (including an expired cursor and reopening),
but when a plan or ready exists and a revision or control file is missing, activation must still be refused, even if an activation save failed before.
A restore initiator that meets a new round of reset before its first read or in the upload stage must not follow the new generation and upload the old backup.
`tests/google-drive.test.js` also checks that the REST and native reset listings keep incompleteSearch;
`tests/google-vault-pause.test.js` verifies waiting during pending or superseded resets and restores, and the entry for clearing the local copy;
`tests/test_linux_google.py` verifies workspace control-file capacity and metadata with the real native descriptor validator.
Real acceptance with a dedicated Google test account: when the initiator loses the network while clearing, the other devices that cleared their copies should wait;
after the initiator resumes, each device has only one default group and a manual group with the same name can still be created; a backup overwrite must not show success while attachments are still uploading.
`tests/config.test.js` verifies `.env` and environment precedence, the public-field allowlist, and missing or malformed values.
`tests/android-build.test.js` verifies the Android public configuration with no previously generated assets, rereading after `.env` changes,
required release fields, and the renderer, bridge and vendor files and CSP in an isolated output path. Run `node --test tests/android-build.test.js`.
Open `src/native/android` in Android Studio; the Gradle Wrapper's `assembleDebug` installs the lockfile dependencies and generates the APK assets,
with no separate web build first. Commands and prerequisites are in the [Android README](../src/native/android/README.md).
APK build, IDE Sync, real-device operation and Google round trips are separate verification scopes; each result is recorded in the commit that verifies it.
`tests/apple-project.test.js` verifies that the Xcode project generates identical content from different checkout paths, that all source references are portable,
the main app and Share Extension dependencies, that machine configuration stays out of the project, generated assets and Info.plist, the Apple main-window and scene classic bundles,
that CSP is not loosened, missing release values, and duplicate copies of read-only dependency licence files.
`node --test tests/apple-project.test.js` needs no Apple SDK; it does not mean Xcode loading, Swift compilation or signing passed.
`tests/apple-signing.test.js` verifies the certificate and profile settings of the manual Developer ID export and invalid signing arguments;
on a Mac it also runs DMG plus update-ZIP packaging with the real PlistBuddy and fake Xcode, notary and codesign tools, confirming that no Installer is needed,
no PKG is produced, a temporary notary keychain is passed, empty-array compatibility in macOS Bash 3 for an un-notarized DMG, automatic export and a plain PKG,
and that a failed runtime load-path check or notarization does not overwrite the last delivered files; with a missing load path nothing may be sent for notarization. Other OSes skip that packaging fixture.
`tests/test_macos_profile.py` verifies rejection of expired profiles, a wrong Team, App ID, certificate or Keychain group, development profiles and invalid UUIDs.
These are process regressions and cannot count as Apple notarization or a real signed app passing; real archive, export, Gatekeeper and Sparkle updates need separate verification.
`python3 -B -m unittest discover -s tests -p 'test_macos_runtime.py' -v` compiles real universal Mach-O fixtures on a Mac,
and verifies moved paths and paths with spaces, a missing `LC_RPATH`, only the x86_64 slice broken, frameworks with missing files or architectures or available only on the build machine,
and Debug dylibs inheriting the main program's search paths; other OSes skip it.
The Mac job of `macos-release.yml` runs this regression before importing signing secrets.
The native macOS build, the preview package and the Release export all run `scripts/testing/check_macos_runtime.py`,
which checks the arm64 and x86_64 main program and its dynamic dependencies inside the bundle one by one, and accepts no framework from outside the bundle on the build machine.
Before notarization the Release export adds `--launch`, which runs the app's `--check-runtime`: the real dyld loads the app and it exits at once,
without creating NSApplication or opening the workspace, login items or Google. It proves only native loading on the build machine's architecture and cannot count as main-window or Google round-trip acceptance.
After cloning on a Mac, open the committed `src/native/apple/WorkFleet.xcodeproj`; no project generation is needed first.
Node 22+, npm and the signing settings are described in the [Apple README](../src/native/apple/README.md).

The actual compile commands for the unsigned universal macOS preview follow; they do not change the system `xcode-select` setting.
A Debug preview does not replace official signing, Keychain and Google, or product runtime acceptance.

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project src/native/apple/WorkFleet.xcodeproj -scheme WorkFleetMac \
  -configuration Debug -destination 'generic/platform=macOS' \
  -derivedDataPath build/apple/DerivedData \
  -clonedSourcePackagesDirPath build/apple/SourcePackages \
  "WORK_FLEET_PACKAGES_DIR=$PWD/build/apple/SourcePackages" \
  'ARCHS=arm64 x86_64' ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO build
lipo -archs build/apple/DerivedData/Build/Products/Debug/WorkFleetMac.app/Contents/MacOS/WorkFleetMac
python3 scripts/testing/check_macos_runtime.py build/apple/DerivedData/Build/Products/Debug/WorkFleetMac.app
```

`scripts/macos/build-native-app.sh --platform macos --unsigned` already uses the architecture settings above;
`scripts/macos/package-preview-app.sh --platform macos --dmg` checks both architectures and produces the DMG and its `.sha256`.
After packaging, check the actual app with `hdiutil verify` and a read-only mount; the Debug main program and the bundled dylibs must each contain both architectures.
The build and DMG checks above were verified on 2026-10-05, as were the Apple project tests after the licence-file regression was added.

Testing the native Keychain, encrypted SQLite and main-window startup needs an Apple Development certificate and an existing provisioning profile that allows the local device and
`app.workfleet.startupprobe.*`. First, in Xcode, open Signing & Capabilities for the WorkFleetMac target,
enable Automatically manage signing, choose the Team and complete Register Device.
A signed universal build uses the commands above without `CODE_SIGNING_ALLOWED=NO`; there is no need to change the system Keychain or delete app data.

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  python3 scripts/testing/apple_startup_probe.py --team TEAM_ID
```

This probe creates a source copy with a unique bundle ID in `build/apple/native-startup-<id>/` and uses the official FleetKeychain,
FleetDatabase, FleetWebHost and FleetDesktop with the bundled renderer; the original Xcode project and the user's workspace are not changed.
The test creates, updates and reads the Keychain, reopens the encrypted SQLite and waits for the main window to finish native initialization.
It removes only the probe's own Keychain service and temporary data; the build, results and signing evidence stay in that directory.
A signed probe run on 2026-10-05 verified Keychain, SQLite and main-window native initialization; the evidence of the as-is ESM loading failure
and the packaging fix are in [ADR-033](decisions/033-apple-local-script-bundles.md).
It creates no certificates, registers no devices, and tests neither Google sign-in nor full desktop gestures; it is not Developer ID or notarization acceptance either.

macOS login items (ADR-043): `python3 -B -m unittest discover -s tests -p 'test_macos_host_shell.py' -v`
compiles the official `FleetHostShell` and `FleetProtocol` and, with an injected login service, verifies that a never-seen `notFound` can register and the setting stays operable,
that the first launch applies the default, that an existing preference allows only a manual retry, that system approval is not overwritten, that cancel and reopen stay off, and that a failure is never reported as success.
Platforms without Swift and AppKit skip it; by default it does not change system login items. The Mac release job runs it before importing secrets.
To also verify the real ServiceManagement on a Mac, run:

```bash
WORK_FLEET_TEST_LOGIN_ITEMS=1 python3 -B -m unittest discover -s tests -p 'test_macos_host_shell.py' -k real_sandboxed -v
```

This creates an ad-hoc signed sandboxed app with a random `app.workfleet.loginprobe.*` ID, temporarily registers and then removes its own login item,
and does not touch the installed Work Fleet or the user's workspace. The test proves only registration, the system status and removal; a real sign-out and sign-in still need manual acceptance.

The desktop-layer contract for the three platforms is in [ADR-031](decisions/031-macos-and-linux-wallpaper-scenes.md).
`python3 -m unittest discover -s tests -p 'test_linux_scenes.py' -v` verifies, even without GI or a display,
the three layers of the Linux native frame, rejection of wallpaper input flags, stale sessions and sequences, and geometry; it is not UI evidence.
`python3 -m unittest discover -s tests -p 'test_linux_vault.py' -v` verifies with real AES-GCM and SQLite and a fake libsecret
[ADR-047](decisions/047-linux-local-key-without-keyring-prompts.md) and [ADR-048](decisions/048-linux-offline-workspace-and-system-secrets.md): the first start and reopening notes do not touch the keyring, the 0600 local key,
migration of old data after full cross-account verification, keeping the original data when locked, with a missing key, a wrong key, corruption or a write failure, and rejection of symlinks and unsafe permissions,
as well as profile isolation of system credentials and backup passwords, pausing when locked, rejecting the session collection, duplicate collections, reset and sign-out markers,
DB/WAL cleanup after saving the old copy is confirmed, and retry after a write failure. With a slow vault the owner bridge still completes storage commit and load, and
the host routes vault backups to the network worker. It needs neither GI nor the user's keyring; it needs python3-cryptography.

The real libsecret probe verifies, in a private D-Bus session with a synthetic keyring under `/tmp`, migration, and that after locking no password window appears,
notes stay readable and writable, and credentials and backup passwords can be neither read nor newly stored; that locking again after the precheck still runs no Prompt,
and that a provider restart recovers without directly resetting the production Vault; that the lock and secret cache cannot bypass the lock, and that after an external token change the new value is read.
Old local copies, once confirmed moved into the vault, are cleaned from the current DB/WAL.
It needs dbus-run-session, dbus-monitor, gnome-keyring-daemon and libsecret;
it does not modify the desktop keyring and does not replace real sign-in and reboot acceptance:

```bash
task_probe_dir=$(mktemp -d /tmp/work-fleet-storage-probe-XXXXXXXX)
mkdir -m 700 "$task_probe_dir/data" "$task_probe_dir/runtime"
XDG_DATA_HOME="$task_probe_dir/data" XDG_RUNTIME_DIR="$task_probe_dir/runtime" \
  timeout 30s dbus-run-session -- python3 -B tests/native/linux/storage_probe.py "$task_probe_dir"
```
`python3 -m unittest discover -s tests -p 'test_linux_google.py' -v` confirms with fake HTTP that the Linux token exchange
sends the Desktop client secret only when it is configured, and disables it when it is malformed; it does not go online and does not represent a real sign-in.
The same file also confirms that construction does not read the vault, that locking clears the cached token and the status is non-fatal, that unlocking recovers without OAuth,
that no sign-in browser starts while locked, and that a refresh forced by a 401 is kept across a vault reread and a temporary lock.
`node --test tests/google-vault-pause.test.js` runs the real account UI functions and confirms that a paused sync still has retry and sign-out controls and that unlocking resumes the same account;
it also runs the real syncGoogle function and confirms that only a manual sync calls google.unlockVault, that success continues the sync, that cancel and timeout can be retried,
that repeated clicks during the same Prompt are not resent, and that switching accounts, going local, signing out or closing discards old results without saving or syncing the old source.
Without the vaultUnlock capability (Windows and macOS) no bridge call is added, and background work never unlocks.
`python3 -B -m unittest discover -s tests -p 'test_linux_unlock.py' -v` uses real libsecret and GLib, a private D-Bus and a synthetic provider
to confirm manual cancel of Unlock and Prompt, successful retry, no prompt when already unlocked, the 90-second operation deadline (shortened in the test), cancel on close and zero Prompts in the background.
It also confirms that a slow pre-query and the credential read-back share the deadline, that a queued request that has already expired opens no Prompt, that an owner closing during preflight opens no Prompt,
and that the call still returns when the provider replies Dismiss without sending Completed.
It reads no user keyring or password, and does not mean the visibility and input of real GNOME or KWallet windows have been accepted.
The Google Python regressions also confirm that unlock_vault handles only vault-locked, that a missing service asks for no password, and that success returns the original account without OAuth.
Sign-out still deletes only local credentials and sends no network request at all.
`node --test tests/google-sign-out.test.js` checks that the Windows, Linux,
Apple and Android sources contain no call that revokes the Google grant (ADR-021 revision); Swift and Java are not compiled in every check environment, so it checks the source.
Phone authorization also has the following author-run regressions, none of which uses a real Google account:

- `node --test tests/google-vault-pause.test.js` also runs the real account-switch function and confirms that when native sign-in is cancelled or its configuration fails,
  editing, automatic backups and the original account's sync resume, and that a cancel does not use the error style.
- `python3 -B -m unittest discover -s tests -p 'test_macos_google_sign_in.py' -v` compiles the official `FleetGoogle.swift`
  and, with fake SDK, AppKit, Keychain and HTTP, verifies that cancel keeps the existing sign-in, that success opens once, insufficient Drive permission, late replies after close,
  rejection of a different sub, and classification of SDK and network errors. The real SDK interface is confirmed separately by the Xcode iOS and macOS builds; the fake SDK is not treated as a real sign-in.
- When the Android SDK and JDK are available, run `bash ./gradlew testDebugUnitTest assembleDebug` in `src/native/android`.
  JUnit uses the official `GoogleAccessToken` and `GoogleSignInErrors` with real SDK exception types
  to verify that switching accounts never uses another account's token, expiry and clearing, and that Credential Manager and Play Services errors do not leak raw messages.
  Unit tests start no Activity or Google UI; account choice, the authorization return and the device lifecycle still need manual acceptance as described in the phone sign-in acceptance section of [Google setup](google-setup.md).

`tests/test_linux_python_floor.py` reads the Python floor (3.10) from the DEB `Depends`, confirms that the tar.gz declares the same,
parses the Linux host with that version's grammar, and also checks f-string forms that `ast` accepts but Python before 3.12 does not; it does not check standard-library APIs.
`tests/test_linux_gi_versions.py` confirms with `ast` that Linux modules that pin Gtk 3.0 also pin Gdk 3.0 before importing Gdk,
which avoids a start failure from loading Gdk 4.0 first when a GTK 4 typelib is installed; it needs neither GI nor a display.
`tests/test_linux_surface.py` builds X11 scenes with fake GI and cairo and a pinned test session environment, and confirms that X11 uses the work area and layer-shell the whole screen as the viewport,
that windows set their size request from the viewport and update it when the display changes;
that on GNOME Wayland through XWayland only the wallpaper layer is resident, the wallpaper is a keep-below desktop-type window and the desktop layer is refused, and the top layer in adjust mode uses the whole work area as its
input region, shows even when that screen has no notes and presents only when it appears; that GNOME Xorg provides three layers, adjust mode is again a mask, the desktop layer is a normal window with keep-below,
and the top layer can take focus when it has notes; that layer-shell keeps three layers resident, adjust mode is again a mask that uses the whole screen as its input region and takes the keyboard with EXCLUSIVE,
returning to ON_DEMAND afterwards; that with `pcmanfm --desktop` on the same Wayland socket layer-shell offers no wallpaper layer, with detection that uses a fake `/proc` to exclude
file-manager windows, other sessions and processes without a Wayland display; that on other X11 desktops adjust mode also masks the whole work area, normally only notes receive input, and the desktop layer is desktop-type;
that a hidden main window is restored with its original position, size and maximized state, while under layer-shell it is minimized instead and recalled with activation, and shown again if that is refused,
and that a main window that was not on screen is not recalled; `tests/desktop-overlay.test.js` confirms that only a main window that had focus when adjust mode started moves aside, and that it is restored afterwards.
This does not mean GNOME or labwc have been accepted on real machines. On Windows, `SceneTransfersProbe` also checks that `operationScope` resolves to the adjust state and rejects unknown scopes;
Windows `--adjust-overlay` checks with real WPF and WebView2 that the toolbar shows on first load, Adjust all and Adjust this group, Arrange and exit, and that an already minimized main window is not recalled;
the macOS layer probe also checks the initial overlay capability, the full-viewport input panel during adjust mode on an empty screen, and its release on exit.
On a real Mac the user has used macOS adjust mode (this group, all, the toolbar, exit) and found no problems (reported 2026-10-17);
the user also confirmed that top-layer notes stay visible above maximized windows. Collapsing and restoring the main window were not reported separately;
the top layer with native full-screen apps (separate Spaces) and while switching Spaces is not yet accepted.
`tests/stages.test.js` and `tests/desktop-authority.test.js` also verify that without a desktop layer the shortcut skips that layer,
desktop notes fall back to the wallpaper layer and are not interactive, and the saved preference is not rewritten, and that projection is refused when only a top layer exists; when the top layer serves only adjust mode,
resident notes fall back to the wallpaper while notes being adjusted stay on the top layer, and the shortcut goes from the wallpaper straight into adjust mode without rewriting the resident layer;
the mask's arrange commands accept stack, spread and undo only during adjust mode, and the Done command ends adjust mode. The headless labwc probe checks the mask tint;
the Linux toolbar and hiding and restoring the main window are judged by real-machine checks.
`tests/test_linux_renderer.py` confirms with a fake file system that only a Raspberry Pi model or the V3D driver makes the DMA-BUF renderer default to shared-memory buffers,
that nothing is overridden when the user sets any renderer variable, and that the host decides before importing WebKit; it does not mean the Pi or other GPUs have been accepted on real hardware.
`tests/test_linux_shortcuts.py` confirms with a fake Keybinder that X11 turns off cooked matching before registering, that Ctrl+Shift combinations trigger actions, and that they are released while the main window has focus;
in labwc mode it does not ask the portal, an unwritten combination is `unwritten`, and once written it is available even while Work Fleet has focus; it does not mean real key presses have been accepted.
Remote desktop clients intercept Ctrl+Shift combinations. On the Raspberry Pi with labwc, send keys with `wtype` and watch `dbus-monitor` for `ActivateAction("shortcut", …)` (2026-10-14).
The path from `Desktop.shortcut` to `desktop-action` has no automated test.
`tests/test_linux_labwc.py` verifies with temporary files the labwc key syntax, replacing only the marked block while keeping other content and comments, finding or creating `<keyboard>`,
rejecting malformed files, new files in merge and non-merge mode, backing up only once, keeping permissions, status detection, and detecting the configuration directory from the labwc cmdline;
`tests/native-shortcuts.test.js` also confirms that a write waits for a setting in progress and reports the rc.xml status. It neither reads nor writes the user's rc.xml.
`tests/test_linux_xwayland.py` verifies GNOME Wayland detection, the preference file's permissions and atomic write, setting `GDK_BACKEND` from the choice before GTK starts,
user settings taking precedence, a restart removing the value it set itself, asking only once, and no restart while the data lock is still held; the dialog and the real restart are verified only on real machines.
In a real Mac graphical session, run `bash scripts/macos/test-desktop-layers.sh`, which compiles the AppKit
scenes and coordinator directly and verifies native levels, the three-layer capability, position, click-through, the wallpaper refusing focus, that the scene WKWebView draws no opaque background
(otherwise the whole scene would cover the wallpaper), and that during adjust mode the scene shows even without notes, the whole viewport receives input, and the keyboard and input panel are released on exit;
it needs no Google SDK. For interactive papers it also confirms with `NSWindow.windowNumber(at:belowWindowWithWindowNumber:)`
that WindowServer delivers real clicks to the input panel; synthetic events sent directly into the panel skip this hit test and cannot replace this check.
Global shortcuts are released only while a Work Fleet window holds the keyboard; the probe checks with `FleetShortcuts.suspends` that a minimized main window and closing to the menu bar (the app still in front but with no key window)
keep the registration. Real key delivery needs testing on a physical keyboard; remote desktops do not always pass key combinations through.
WindowServer applies window order and level asynchronously, so a window that was just shown first reports layer 0 and is not on screen; the probe flushes and waits until the window is on screen with the matching level
(at most 2 seconds) before checking.
This probe reads no user notes; it does not replace a full app build or real WKWebView, IME and Spaces acceptance.

The Linux native scene tests use a separate headless labwc, GTK and WebKit and do not touch the user's desktop or DB:

```bash
npm run build
mkdir -p build/linux-layer-checks
node tests/native/desktop-scenarios.mjs build/linux-layer-checks/scenarios.json
docker build -t work-fleet-linux-desktop-tests -f tests/native/linux/Dockerfile tests/native/linux
docker run --rm --network none \
  --mount "type=bind,source=$PWD,target=/workspace,readonly" \
  --mount "type=bind,source=$PWD/build/linux-layer-checks,target=/evidence" \
  work-fleet-linux-desktop-tests dbus-run-session -- \
  bash /workspace/scripts/linux/test-desktop-layers.sh /evidence /evidence/scenarios.json
```

The same image checks ADR-043 with a real GTK owner (it opens no workspace database and needs no Secret Service):

```bash
mkdir -p build/linux-host-checks
docker run --rm --network none \
  --mount "type=bind,source=$PWD,target=/workspace,readonly" \
  --mount "type=bind,source=$PWD/build/linux-host-checks,target=/evidence" \
  work-fleet-linux-desktop-tests dbus-run-session -- bash /workspace/scripts/linux/test-host-shell.sh /evidence
```

Xvfb with openbox (X11) verifies the default size, `window-placement.json` after move, maximize, minimize and restore, reopening at the saved position, reset,
the autostart entry for the bundle's launcher written on first launch and not re-created at later launches after it is turned off, and that with `--launch-at-login` the main window starts hidden,
shows after a wait when there is no tray (the probe uses 3 seconds through the public `startup` setting), and that a second launch brings up the main window. The `hidden-tray` mode uses Ayatana AppIndicator
(as the image and the DEB Recommends do) and registers the StatusNotifierWatcher only after the app, verifying that a late tray keeps the main window hidden
and that the window shows only when the tray disappears; it also reads back from D-Bus that the tray's `Title` is "Work Fleet", and confirms that `host.log` records this sign-in start and the tray coming and going.
Headless labwc verifies that only the size and maximized state are saved and applied on reopen.
`tests/test_linux_hostsettings.py` verifies with the shared fixture the placement rules, the files, Exec quoting, and removing only an autostart entry it wrote itself.
None of this is evidence of autostart at a real GNOME or Pi sign-in.

The projection comes from the real shared Workspace and InteractionController; the native owner publishes it in chunks, and the real WebKit renderer
receives, acknowledges and draws it. It covers wallpaper → Adjust this group floating → restore after Done, resident desktop and floating,
repeated hide and show, and topology reuse; during Adjust this group it confirms that the whole top layer receives input, that the keyboard is EXCLUSIVE, that the area outside the notes is tinted by the mask,
and that the notes and the mask remain after synthetic pointer enter and motion events are sent to the top layer. The scenes use the Pi default `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`;
with the DMA-BUF renderer disabled this check fails on the Pi but still passes in x64 Docker, so CI cannot catch this regression.
Composite screenshots wait until the expected pixels appear (at most 10 seconds) and capture once more before checking: under software GL the first frame of a newly shown scene reaches the compositor late
(about 0.4 seconds for the wallpaper layer and about 1.6 seconds for the adjust mask in x64 Docker), so a fixed 0.2-second wait fails.
The output is composite PNGs, versions and a Wayland trace; the trace check accepts both the old and the new libwayland object-number formats.
A Linux system with labwc, grim and the GTK and WebKit bindings installed (such as Raspberry Pi OS) can also run it without Docker, with the system Python:
`PATH=/usr/bin:$PATH dbus-run-session -- bash scripts/linux/test-desktop-layers.sh OUTPUT OUTPUT/scenarios.json`.
The WebKit sandbox exception of the root Docker probe exists only in the test shell and does not apply to the product launcher.
These tests are not evidence for the Pi and V3D, pcmanfm-pi, physical drags and IME, or multiple displays; X11 does not pretend to have the three-layer capability.
Platform-specific commands such as `npm run config:check -- --platform windows` should exit non-zero when public settings are missing.
`tests/workspace-sync.test.js` verifies atomic transactions between the graph and Workspace and LayoutStore, save failures, stale sessions and cursors,
runtime restarts, group cycles and recovery with ten groups, drafts, history restore, transfer intents and existing entity order.
`tests/file-sync.test.js` uses an independent in-memory FileStore and verifies paging, restarts and two-device branches, lost responses,
reservation and ack faults, attachments, source immutability, revoked access and backoff, cancellation and account sessions.
`tests/google-drive.test.js` uses scripted HTTP responses and verifies appDataFolder routing and metadata,
resumable chunks and Range, reopening after a 4xx, the same file ID, read-back verification and Location boundaries; it uses no Google credentials.
`python3 -B -m unittest discover -s tests -p 'test_macos_google_drive.py' -v` compiles the official Apple
`FleetDrive` and `FleetProtocol`, replacing only authorization and HTTP, and verifies the `fields` parameter that Google returns with raw commas or `%2C`,
that the upload bytes and URL are kept, resuming after a failure by querying progress, and opening a new session on the same file ID after the adapter is rebuilt.
It also verifies that a missing or invalid Location, an external host, HTTP, a wrong port or path, credentials, a fragment, duplicate parameters and an overlong URL
are rejected before any content is sent. Platforms without the Swift SDK skip it; the Mac release job runs it before importing secrets.
It reads no Keychain and does not connect to real Google, and it is not acceptance of reboots or account round trips with an installed build.

`tests/backup-archive.test.js` verifies ZIP paths, directories, CRC, capacity, malicious DEFLATE, cancellation and encryption,
and reads the ZIP independently through a fixed Python standard-library fixture (on Windows it supports pyenv's python.bat).
`tests/backup-payload.test.js` verifies complete history, groups, draft lineage, attachments and layout, hashes, references and counts,
profile binding, concurrent snapshots, rejection of unknown conflicts, encryption and cancellation with many images. File verification is never treated as a completed restore.
`tests/backup-capacity.test.js` fully generates and reopens 20,000 entries and verifies that one more is rejected;
it contains many individual ZIP and SHA operations, so it runs longer than ordinary small fixtures; it is not a benchmark for the lowest-end phone.
`tests/backup-restore.test.js` verifies the three restores, complete ID and draft-lineage mapping, missing parents, stale plans,
safety-backup binding, transaction failure, restart receipts and explicit duplicates, and that the queue stays usable after placing many new cards is cancelled.
It also verifies that a local complete restore needs no safety backup, clearing of the old graph, drafts and attachments, stale, cancelled and rolled-back transactions,
and same-format round trips in all four directions between local and Google. `tests/backup-export.test.js` uses MemoryFileStore to verify exporting new remote content after a sync,
the explicit copy fallback, cancel and profile switch, incomplete sync and the success time; it does not connect to real Google.
`python -m unittest discover -s tests -p 'test_linux_local_restore.py' -v` runs replacement, empty attachments, rollback, CAS and partition isolation on real SQLite;
on Windows it replaces only the fcntl import and uses an identity fixture for crypto, so it does not mean the Linux GUI or keyring has been tested.
`tests/backup-files.test.js` verifies write, close and read-back faults, size and hash, cancellation, owned bytes and the save capability.
`tests/automatic-backup.test.js` uses a synthetic atomic FileHost to verify daily, change and resume triggers, merged triggers, cancelling queued work,
pending, ack, restart and cleanup, changing the location, a missing latest file, encryption policy changes, the vault pause and the notice when the journal is lost.

The new real-browser regressions use isolated profiles and synthetic data:

```bash
python scripts/testing/serve_preview.py --port 0
# In another terminal, replace PORT with the actual port printed above
node scripts/testing/browser-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/group-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/revision-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/sync-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/backup-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/restore-ui-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/cloud-restore-ui-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/local-backup-ui-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/automatic-backup-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/scene-probe.mjs --url http://127.0.0.1:PORT
```

The browser, group, revision, backup, restore UI, cloud restore UI, local backup UI, automatic backup and scene probes
open their browser context with `locale: 'en-US'`, so "Auto-detect" resolves to English whatever the machine's
language. `sync-probe` loads no UI (it opens a stylesheet and imports the modules) and uses the default
context.

`scene-probe` loads the built desktop scene with an in-page synthetic host (`scene.info`, chunked frames with SHA-256, `scene.applied`),
sends two frames in a row, and verifies that the title band is not repeated in the body, that checklists show only checkboxes, that papers are square, and that titles and steps update when nodes are reused;
it then sends a frame with `locale: 'zh-TW'` and checks that the scene's `lang`, title, label and Edit button switch to the zh-TW catalog text, and that the next `en` frame switches them back to English;
it does not replace real checks of the Windows, macOS and Linux native scenes. The screenshot is `build/scene-probe.png`.

`local-backup-ui-probe` uses a synthetic Google FileStore and real IDB, and verifies that old backups can be chosen, that a confirmation is invalidated, and that attachments are removed while other partitions are kept,
as well as Google export with sync, the explicit choice after a failure, and cancel; it does not touch the user's notes or Google account.

Windows uses the installed Edge; Linux and macOS use Playwright Chromium, which needs
`npx playwright install chromium` the first time. Playwright and the test browser are not shipped in product artifacts.
The probe verifies create and reopen, Markdown and checklists, attachment bytes and isolation of malicious HTML, inline editing on fixed papers,
plain and Shift drag-and-drop, undo, search and filters not moving cards, the board and list views (square papers, no repeated titles, the selection kept after reopening),
multi-step draft operations, the slow-write prompt when leaving the page, the narrow-screen entry and the single writer.
It also uses real IDB to verify concurrent CAS, rejection of non-consecutive revisions, attachments and profile isolation.
Measuring a paper right after a drop can read a null box, because the redraw after the save replaces the element; the probe therefore waits until the paper is no longer dragging (2026-10-06).
Keep this wait if the probe is edited.
The group probe verifies group preview, cancel and merge, archived data and draft integrity, region swaps not moving cards,
the sidebar following the regions and reordering them by mouse drag and Alt+arrow keys without moving cards, the
toast naming the keys that changed group,
a colour swap in group settings recording no revision and repainting the sidebar dot, the My group star following the setting and a merge,
custom and duplicate shortcuts, and multiple bindings surviving a merge and being set again. It also checks that saving
group settings with the name unchanged records no revision, that "Show completed notes" hides a completed paper and
brings it back to the same place without a revision, and that Undo after "Move to Deleted" restores the note once, also
in a 390 px window.
It does not drag the touch grip; dragging the grip in the 390 px drawer was checked once with Edge touch emulation (2026-10-20).
After saving from the editor, the browser probe waits for the modal editor to close before it types into the search
box; without the wait the text is lost and a later check reads a stale title (2026-10-20). Keep this wait if the probe
is edited.
The revision probe verifies with synthetic data a two-version comparison, HTML text isolation and raw attachment bytes, delete/edit resolution,
history restore, keeping drafts and geometry, the IME boundary, the group-cycle repair entry at 390 px when no group is active,
and that moving a note whose group is missing offers the groups in the sidebar's order.
It injects versions through a core fixture and does not connect to Google; the screenshot is `build/revision-probe.png`.
The sync probe connects FileSync to a synthetic FileStore in real Edge and IndexedDB and verifies that reservations reach disk,
that reopening after a lost response reuses the same file ID, attachment verification and partition isolation, two-device branches and persistence after reopening; it is still not real Google.
The backup probe uses real Edge and IndexedDB, a 2 MiB attachment, drafts and layout to verify plaintext and encrypted round trips,
a wrong password, zero writes on cancel, restore transaction abort and attachment rollback, a lost response after commit, restart receipts and CAS.
The restore UI probe runs export, preview, import, duplicate and replace through the full window, with the safety backup saved before the confirmation unlocks,
and checks the original drafts and history and the 390 px layout. It replaces only the picker; the real save, close and SHA read-back use an OPFS handle,
and it never opens a personal file picker. The screenshot is `build/restore-ui-probe.png`; on failure a failure image with the same prefix is also saved.
It also confirms in the full main window that a local complete restore creates no backup of the old data, leaves only the backup's graph and drafts, and stays readable after a restart.
None of this means native OS pickers, power-loss durability of external disks or a minimum-capacity stress test on phones.
The automatic probe first confirms that the real app's automatic file capability is off, then uses a real IDB journal and Workspace with a synthetic FileHost
to check the full UI, turning it off while running, reservation abort, a lost ack and restart, CAS, the authorization pause and readable ZIP bytes.
It does not use native OS automatic files or the vault; the screenshot is `build/automatic-backup-probe.png`.
`automatic-backup-probe` once failed without a message (2026-10-06) and then passed three times in a row.
The output screenshot is `build/browser-probe.png`, and on failure `build/browser-probe-failure.png`.
This is not acceptance of real power loss, a Google source, iOS or Android, or OS layering; these browser probes are not in GitHub Actions CI and must run locally.
The browser probes (`browser-probe`, `restore-ui-probe`, `automatic-backup-probe` and others) sometimes time out on the first page load, stuck on the loading screen for more than 5 seconds with no page error.
It happens most when several probes start in parallel or right after a build; sequential reruns pass. It was seen repeatedly from 2026-10-05 to 2026-10-17, and the cause was never investigated.
Treat a single first-load timeout as flaky and rerun; do not claim that parallel preview loading was tested.

The existing Mac validation build is also run on macOS:

```bash
bash scripts/macos/build-app.sh
python3 scripts/testing/macos_probe.py --web
python3 scripts/testing/macos_probe.py --mode 0
python3 scripts/testing/macos_probe.py --mode 2
```

The Python tests and the Mac probe need permission for loopback listeners; some coding-agent isolation layers need this allowed explicitly.
This is different from the tested app's own App Sandbox: the tested app always keeps its signed Sandbox entitlements.
In a restricted agent sandbox, Python tests that open loopback sockets, Node subprocesses and Java archive locks can be denied;
rerun with normal local permissions rather than treating the denial as a product failure (2026-10-15 to 2026-10-17).

`macos_probe.py` uses only a TemporaryDirectory SQLite and a one-time invite, really launches the signed app,
keeps settings and caches in a separate `WorkFleet-Probe` subdirectory, and gives the web content a nonpersistent WKWebsiteDataStore.
It briefly shows and activates the editing window used for verification. The probe asserts each item, and any missing event or mismatch fails it.
Do not run the focus probe while someone else is using the keyboard. Its diagnostic output contains no note text or credentials.

The data-layer tests cover real HTTP, concurrent writers, response-loss retries, tombstones, backup/restore,
interrupted restore, restore flush failure and retry, pairing races, expiry/reuse, read-only, revoke, input limits and storage failure.
The WebKit tests go through the real DOM and server; transport disconnects and response loss are injected in a controlled way.
The Node model tests cover cross-tab drafts and recovery, and local write failures.

## Windows native main window and storage

`node --test tests/cloud-restore.test.js` uses a synthetic FileStore to verify that a full clear leaves only the backup content,
attachments, that drafts are not published, that old devices meet the reset marker, zero remote deletions without a safety backup, when stale, on the wrong account or with a disk failure,
and resuming after a restart when the clear or the upload fails, with upload retries not clearing again.
`cloud-restore-ui-probe.mjs` uses real Edge, IndexedDB and OPFS with a synthetic FileStore
to verify the double gate of the safety save and the clear checkbox, the confirmation being invalidated when the file changes, that the preview pauses ordinary sync, and the full restore.
It mounts only the backup panel and simulates neither native account switching nor resuming in the full main window; it is not real Google end to end.

The unpackaged path probe `WorkFleet.Windows.Ui.Tests.exe --app-data OUTPUT_DIRECTORY` only resolves paths and writes no official ZIP or Debug data.
With an existing Release app, UI probe and package content, run
`scripts/windows/Test-WindowsAppData.ps1 -CertificateThumbprint THUMBPRINT`:
it uses an existing trusted local certificate to create a separate `app.workfleet.storageprobe.*` identity,
really verifies the explicit private location, writes, deletion on uninstall and that an external export fixture survives, and finally removes only its own test package.
The evidence stays in `build/storage-probe-*`; there is no new certificate, UAC, real Work Fleet install or uninstall, or Google operation.
A real product update, export and import of the old external DB, and other Windows versions still need their own acceptance.

Packaging check for a locally signed preview (it does not install the app or change certificate trust):

```powershell
.\scripts\windows\Build-WindowsPackage.ps1 -LocalTestSign
.\scripts\windows\Test-WindowsPackage.ps1 -PackagePath build/WorkFleet-VERSION-x64.msix
```

Replace `VERSION` with the Windows version. The check confirms that four invalid signing-argument combinations are rejected before the build,
and uses Windows itself to verify the MSIX signature, machine trust, the publisher, the x64 manifest and the companion CER without a private key.
It needs an existing CurrentUser/My certificate that matches the package publisher and is trusted in LocalMachine/TrustedPeople.
Official signing still uses `-CertificateThumbprint` and an HTTPS `-TimestampUrl`; local mode does not accept `-Release`.
The final MSIX is also checked for x64, the current Windows version, the Windows.Desktop floor 22000 and MaxVersionTested 26200.
It also requires `includedFrameworks` for .NET 10 Core and Windows Desktop, rejects a shared `framework` or `frameworks`,
and checks the win-x64 target in deps, hostfxr, hostpolicy and coreclr, the WPF managed and native files, and the complete runtime licences and notices.
This is package-content and signature verification; it does not replace launching on a real machine without .NET installed, or MSIX install acceptance.
The Windows package check requires the .NET 10 Core and Desktop versions both to equal `WindowsRuntimeVersion` exactly, and rejects WPF 8, mixed patches and old TFMs; the fixture does not prove that the runtime DLLs run.
The first packaging restores the win-x64 self-contained runtime packs; add `-SkipRestore` only after a package restore with the same settings.
Without an existing trusted certificate, use the plain `Build-WindowsPackage.ps1` and
`Test-WindowsPackage.ps1 -PackagePath build/WorkFleet-VERSION-x64.msix -Unsigned` to check the unsigned content;
this is not signature, install or Store acceptance. Without `-Unsigned` an unsigned package is still rejected, and the option also rejects unknown or damaged signature states.
`python -m unittest discover -s tests -p 'test_windows_package.py' -v` uses the Windows SDK MakeAppx to produce isolated synthetic containers
and verifies a too-high or too-low floor, device family and MaxVersionTested, a wrong version, environment and private-key files, the explicit unsigned mode,
and rejection of missing runtime or notices, an external shared .NET requirement and a wrong deps architecture.
The fixture runs no app and changes no certificates; without Windows or the SDK it is marked skipped. Subprocesses prefer PowerShell 7, and their output is decoded explicitly as UTF-8.

```powershell
.\scripts\windows\Test-WindowsNative.ps1
# Offline regression once restored:
.\scripts\windows\Test-WindowsNative.ps1 -SkipRestore
```

The script builds the Debug app and probes and runs real SQLite and DPAPI, the JavaScript→native stdio bridge and real WPF and WebView2.
Databases and screenshots are written to separate synthetic data directories under `build/native-checks-*` and `build/native-js-*`; no personal app data is read.
The WPF probe uses an off-screen window and drives the editor, attachments, close and reopen through the DOM; the screenshot is `ui/native-ui.png`.
The first show does not activate; the explicit shortcut and tray regressions ask to activate their own window, and no system keyboard or mouse input is injected.
It also tests encrypted automatic backups, manual export and the restore preview of native files; only the interactive picker results are replaced,
while native files, DPAPI, SQLite and IPC all run for real, and no real OS picker is automated.
The core probe tests NTFS create-new, write and rename races, keeping partial files, not deleting on file change, same-handle verification and deletion,
reopening directories and rejecting replacement; the JS→native part tests Chinese and emoji passwords, cross-process keys and grants, ack-loss recovery,
keeping modified managed files, the manual save proof, and that invalidated or cross-profile keys do not downgrade.
It needs an ordinary Windows user session and the WebView2 Runtime; if a restricted tool environment makes WebView2 crash, retest in an environment where it runs;
that cannot count as a pass or as a reason to disable the WebView2 sandbox. The main-window and storage tests are not evidence for multiple displays, OS desktop integration or real power loss.
The WebView2 UI probe can fail on the first window with `0x8876086A` when WebView2 cannot create a D3D9 device in the current session; unchanged HEAD fails the same way (2026-10-14).
Rerun in an interactive desktop session that can create a D3D9 device.
The Windows UI probe only checks that the scene DOM contains a card; it cannot tell whether the scene actually painted.
A missing first paint after showing a scene (fixed on 2026-10-06 with a repaint 300 ms after show) would not be caught.
The Windows app, core and probe projects compile on Linux (for example the Raspberry Pi) with .NET SDK 10.0.402 and `EnableWindowsTargeting`, with 0 warnings.
The core probe cannot run there because its early cases use DPAPI; on 2026-10-17 the `StartupConfig` cases were run instead in a temporary console project on the Pi's .NET 10.0.13.
Compiling on Linux is not a Windows run.

The same script runs `--adjust-overlay OUTPUT_DIRECTORY`: after the first scene handshake with no display update it enters adjust mode,
and confirms that the toolbar is visible, inside the viewport and hittable, that Stack, Spread and Undo write back through the owner, and that Done removes the mask and the operation state;
Adjust this group reuses the same toolbar and can be left with Esc. A synthetic CompositionEvent blocks Done, and after Done the text can be recovered from Unfinished drafts;
an already minimized main window stays minimized, and leaving and re-entering keeps the arrangement. The screenshot is `adjust-overlay/adjust-toolbar.png`.
This is an off-screen scene with synthetic DOM input and cannot replace a real mouse, a real IME, multiple displays or acceptance in a macOS or Linux graphical session.

The same script also runs the native foundation probes `--composition` and `--platform`:

`--shell-topology` uses the same implementation of native discovery and liveness checks with synthetic window queries, covering the classic sibling, the Progman child,
icon-host moves, a wrong PID, hidden windows, the icon host and z-order, missing hosts and bounded creation retries, and Explorer and handle replacement.
It is wired into Test-WindowsNative, creates no test Explorer, and a model pass is not treated as a real test on a newer OS.
The composition probe applies the coordinator's existing click-through policy for render popups, and on an input failure reports the HWND, class and PID that were hit.
It also checks native capture, region moves, unexpected capture loss, and release on hide and topology changes with synthetic WPF MouseDown and MouseUp;
it injects no system mouse input and cannot replace user acceptance of fast drags. The capture check failed before the fix and has passed since testing resumed on 2026-10-09.
Known one-off native probe failures that passed on rerun: the composition probe's "Reopened scene lost input policy" (2026-10-14), the composition cross-process hit tests (2026-10-06 and 2026-10-09),
and `--wallpaper` desktop-layer step 4 not showing the paper on the first run (2026-10-15). Rerun the single probe before investigating.

It also runs `--wallpaper OUTPUT_DIRECTORY`, which requires a real Explorer icon and wallpaper host in the current session;
if none is available it fails and is not marked as passed. With synthetic content it confirms the parent and WS_CHILD of the two own scene HWNDs,
that both windows of the attached scene are set to software rendering while the floating scene keeps the default (only the setting value is checked, [ADR-049](decisions/049-windows-attached-scenes-render-in-software.md)),
real WebView pixels, the native empty input region, physical bounds, repeated attach, float and hide, and no activation.
The browser preview checks the paper content; the desktop crop where the test note sits is also captured, so that the old positions outside the new paper can be checked.
It does not restart Explorer or inject keyboard or mouse input.
A real-screen pixel FAIL fails the probe; external occlusion is still reported as SKIP, floating surfaces are judged by own HWNDs, and own windows are not treated as external occlusion.
Floating papers use a separate composition surface, as the coordinator does; the same windowed child is not turned into a popup.
The foreground check observes the whole run with [SetWinEventHook](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook),
including momentary activation of the own WPF window and that WebView's browser; receiving one fails the check. When an external program switches the foreground on its own,
the "completely unchanged" sub-item is explicitly SKIPped, the check that own scenes must not activate still runs, and the foreground returning to the external program at the end does not stand in for whole-run evidence.
It also checks that the original pixels return after hiding, and the Explorer-like host also checks the background after collapsing; the original-pixel check is explicitly SKIPped when occluded.
The main WPF probe also checks that attached note DOM is removed only after `scene.prepare` is confirmed.
The prepare-flow and hide-restore regressions above have been run since the user explicitly restored testing and screenshot authorization.
On 2026-10-09 the user confirmed that the white blocks from the previous package were still present, and that they need only a stack or spread after positions were adjusted, with no drag.
`--host-check OUTPUT_DIRECTORY` now uses a black background and starts two Explorer-like hosts at once, with and without redirection:
it checks that after a move, a stack-style height reduction and a spread-style region change the new paper still shows and every old position returns to black, and that the final hide and the area outside the region also restore.
It covers prepare/hide and direct replacement of the visible region, without injected mouse input. The Explorer-like host uses its own GDI BLACK_BRUSH background window as the baseline,
with the no-redirection host above the black background; it does not depend on how an empty WPF window paints or on the system theme colour, so an app behind it is not mistaken for the background.
The black-background precondition still requires the real-screen pixels to be zero; a failure saves images and HWND, style and hit-PID diagnostics, and the colour tolerance is not loosened.
These are surface-geometry operations and cannot replace the real formation owner flow.
With the screen locked, `--host-check` fails its host background check (the hit test lands on `LockScreenBackstopFrame`) and `--wallpaper` reports its pixel checks as SKIP (2026-10-15).
Run these probes with the session unlocked.
The real Explorer probe also uses a full-screen scene and repeatedly moves, shrinks and expands it; while the new paper is visible, it compares the old centre and edges.
The new host style and the native repaint order are in [ADR-035](decisions/035-windows-attached-scene-background-lifecycle.md);
the 23H2 tests withdrew NOREDIRECTIONBITMAP, which the OS rejected, and the transparent windowed WebView background that darkened real papers.
A 25H2 comparison is not verified, and there was no independent review.
`--formation OUTPUT_DIRECTORY` is wired into the same entry point. The main window creates two notes in an isolated native SQLite,
the scene's synthetic PointerEvents save the adjusted positions through the existing client, bridge and owner, and the positions must remain after adjust mode ends;
the main window's Stack and Spread buttons and the floating toolbar change the layout, covering the desktop, returning to the desktop after a floating arrangement, and the wallpaper layer.
The scene still uses the real full-screen viewport; only an unoccluded test work area is injected, and the OS work area and wallpaper are not changed.
Synthetic DOM capture does not mean real mouse capture. GDI reads the test area in one pass and compares the original desktop pixel by pixel outside the new papers;
floating adjust mode compares against the shared mask's #1c242c59 tint, excluding also the toolbar, the group labels actually shown and a 6 CSS px border band (including the 5 px rounded corners), but not the whole group work area.
It also checks that papers are visible and that passive notes do not take the foreground themselves; on an explicit entry into adjust mode only the matching floating input HWND may activate.
It saves a native screen PNG; when there is not enough unoccluded area it SKIPs explicitly.
The formation probe also confirms that `host.log` records the display list at startup; `--platform` checks the format of that line (ADR-045).
The foreground check covers all paired note HWNDs and the browser, excluding the main window and framework helpers; focus in the main window's editor
when a note is created is not a passive paper activating itself. The wallpaper-only probe does not make this exclusion.
A copy of the currently installed build also passes the isolated formation cases; the user's original afterimages have not been reproduced, so this pass cannot be taken as proof of the root cause.
From 2026-10-14 to 2026-10-16 `--formation` failed at the foreground check ("A non-activating scene received foreground"), also on older commits and with the installed app closed.
Another app that starts at sign-in (the maintainer's Cats desktop app) was running during every failure and is the first thing to try closing.
On 2026-10-16 the check was updated to accept the expected activation of the floating input window in adjust mode, and the full `Test-WindowsNative.ps1 -SkipRestore` run passed
with the formation pixel checks SKIPped because the desktop was covered. As of 2026-10-17 no fully uncovered formation run is recorded.
The main WPF probe also tests the real owner and scene flow of per-card setting → wallpaper → Adjust this group → floating → Done → wallpaper.
The full matrix of Windows 10, a real Explorer restart, Win+D, virtual desktops and mixed DPI still needs its own acceptance.
When the wallpaper layer falls back or attaches wrongly, run the read-only `scripts/windows/Get-ShellLayerInventory.ps1`,
which lists the Progman, WorkerW and SHELLDLL_DefView hosts with their DPI and PerMonitorV2 state; it sends no messages to Explorer and changes no windows.

- Real CompositionControl transparent HTML and a live VisualBrush; it loads only synthetic data, with no product bridge.
- Another own process acts as the OS `WindowFromPoint` target, checking click-through for passive papers, empty space and occlusion in front;
  native input and visual regions are mutually exclusive and cover completely; floating and normal underlying switches, paired hide and close, and 20,000 regions.
- Screen physical bounds, work area and DPI; real shortcut conflicts, release and restore, rejection of reserved keys and cleanup of stale events.
  The shortcut callback sends synthetic WM_HOTKEY only to own HWNDs; no real keyboard or mouse input is injected.

The probes and the app share the PerMonitorV2 manifest and `net10.0-windows10.0.19041.0`.
They must run through the `.exe` apphost, including the cross-process target; the entry point verifies that the thread DPI awareness really is PerMonitorV2.
Running `dotnet ...Ui.Tests.dll` directly does not apply this executable manifest and cannot serve as evidence for the same DPI setting.
This is not acceptance of user desktop gestures, WebView capture and IME, multi-display hot-plug, Win+D, virtual desktops or sleep.
The native foundation is in [ADR-017](decisions/017-windows-composition-surface-and-input.md), and the product connection in [ADR-018](decisions/018-single-owner-desktop-views.md).
The main WPF probe now also opens the real scene page: it confirms projection, that the scene cannot call storage, floating-layer operations, in-place drafts,
chunking of 1.2 MiB of Chinese input, a synthetic CompositionEvent blocking exit, and the return to the click-through policy after a transactional save.
The close test deliberately delays the last storage.commit, confirms that editing stays frozen, and that after reopening the last draft text is complete.
Display descriptions are injected as off-screen ranges only in the probe; synthetic ranges are never used to claim a real multi-display pass.
The core also tests scene-lease reads across versions and principal isolation, that half copies and bad hashes are not published, rejection of stale sessions and frames,
and that ten groups and long group names stay readable. `tests/desktop-authority.test.js` and `desktop-transport.test.js` verify replay, generations,
independent draft admission, retry of unknown acks, release of the flush when the connection is lost, and blocking of commands at close.
`desktop-frame-refresh.test.js` also covers a new frame arriving while an old frame is downloading, waiting for a drag to finish, and retry after a download failure;
`desktop-transport.test.js` adds that a drag finish or cancel must wait until the latest geometry is published before replying. These have passed since testing resumed on 2026-10-09.
The shortcut and tray probe also checks the real shell icon identity, the settings and actual registration state, native action → scope,
that in-place scope keys save the draft first, synthetic IME rejection, that a close block is not released by a settings update, collapsing and reopening the same owner,
and rebuilding the icon on its own TaskbarCreated message; Explorer is not restarted.
A positive foreground intent needs OS permission at that moment; if Windows refuses, that sub-item is explicitly SKIPped, and null and stale rejection are still tested.
WPF IsActive does not stand in for actual ownership through GetForegroundWindow, and a failed precondition cannot count as a successful focus steal.
`tests/native-shortcuts.test.js` tests settings merge, retries and close isolation; `tests/shortcuts.test.js` tests the input priority of local keys.

`npm test` explicitly skips 8 native integration tests that need the built Windows helper;
they run only with `WORK_FLEET_NATIVE_TEST=1`, and then a missing helper fails instead of reporting success.
To run them alone, first run `Build-WindowsApp.ps1 -Configuration Debug -IncludeTests`, then set the variable and run
`node --test tests/native-storage.test.js`. The OS-independent bridge close and message-capacity tests run every time.

The same script then runs `--diagnostics OUTPUT_DIRECTORY` ([ADR-032](decisions/032-windows-debug-webview-inspection.md)).
Without the variable no CDP option is created; an invalid port must be rejected with HostError before the owner lock, and the same directory can still be opened afterwards.
It opens the Debug main window on a free port assigned by the OS and confirms that DevTools is enabled, that the listener binds only to loopback,
and that `/json/list` has the main document, and it reads DOM state through a real CDP WebSocket. Release executables cannot run this probe.
`Build-WindowsPackage.ps1` scans `WorkFleet.dll` after publish and stops packaging if it finds the `remote-debugging` string;
`Test-WindowsNative.ps1` requires the same scan to hit the Debug `WorkFleet.dll`, so the check cannot silently stop working; the script also clears any port variable the shell already set.

Next it runs `--host-shell OUTPUT_DIRECTORY` ([ADR-043](decisions/043-desktop-window-placement-and-startup-behavior.md)):
the main window briefly appears on the primary display without taking focus. It checks the version and the "Startup" section in Settings > Desktop (Debug has no StartupTask, so the start-at-sign-in option is disabled with the reason shown),
that "Keep running in the tray when the main window closes" is written to `host-preferences.json`, `window-placement.json` after move, maximize, minimize and restore,
that reset returns to the default size, centred, that reopening returns to the saved position, that the default is used when the display of the saved position no longer exists, and that a second launch wakes the existing instance through the per-user,
per-data-directory pipe. The core probe verifies the placement rules shared with Linux and macOS using `tests/fixtures/window-placement.json`.
Start at sign-in, hidden start and StartupTask can be verified only with an installed MSIX, by the user signing out and in again; mixed DPI needs real multiple displays.

Then it runs `--crash-guard OUTPUT_DIRECTORY` ([ADR-045](decisions/045-windows-fatal-error-leaves-explorer-first.md)):
- The scenes hang as cross-process child windows on an Explorer-like host, then `UCEERR_RENDERTHREADFAILURE` is thrown on the dispatcher.
- It checks four things:
  - Both scene windows become hidden top-level windows.
  - `host.log` records the HRESULT and the number of detached windows first, and the reopen only after that.
  - `restart.json` points to this process.
  - Later exceptions are recorded only as nested.
- Handing over to Windows and the reopen are only recorded, not actually performed.
- It also verifies the reopen policy and waiting for the old process: when it exits, when it is force-ended after a timeout, and leaving it alone when its PID has been reused.
- This probe turns the reopen on directly to verify the mechanism; the app itself has had the reopen off since 2026-10-14 (ADR-045 revision).
- The core probe verifies the `host.log` format and rotation, and that the marker can be taken only once and is discarded when stale or damaged.

Next it runs `--sign-in-hold OUTPUT_DIRECTORY` ([ADR-046](decisions/046-windows-sign-in-scenes-wait-for-settled-displays.md)):
- It opens the main window (hidden) as a sign-in start and injects the state "lid closed, built-in display on, other displays present".
- It checks three things:
  - While it waits there is no scene window at all, and `host.log` records `scenes waiting` with the decision inputs `lid=closed builtIn=on other=on changed=none`.
  - After the built-in display is switched off, every scene creates its window.
  - `host.log` records `scenes attaching after` with the decision input `builtIn=off`, and not because the limit was reached.
- The core probe verifies the decision rules with a table: lid closed with the built-in display, no lid state, only a built-in display, 5 seconds of quiet, the 3-minute limit;
  it also verifies the record format of the decision inputs, including an unreadable display configuration and no lid state.
- `--platform` reads the connection types of this computer's active displays and the lid state, and checks only that they can be read, not their values.
- The same-version runtime test package of [ADR-050](decisions/050-windows-wpf-display-loss-runtime.md) records `runtime=10.0.13` in its startup line; check this line first so that you are not still testing the old process.
- Display switching at a real sign-in can be verified only by rebooting and reading `lid closed|open`, `scenes waiting` and `scenes attaching after` with their decision inputs in `host.log`.

Next it runs `--grid-area OUTPUT_DIRECTORY` (SPEC-003, "Display changes"):
- The main window opens twice on the same test data. The first time it gets only the top-left quarter of the primary display's work area, and a note is added; the second time it gets the full work area.
- Each time it presses "Adjust all" and reads the region frame drawn by the floating scene. There is only one group, so the region frame should equal that run's work area.
- Before the fix, the second region frame was still a quarter of the size, the same as the `Ctrl+Shift+digit` dashed frame the user reported.
- It checks only the startup path. The layout-saving rule is verified by the node test C43b; the wiring for display changes while running and the `Ctrl+Shift+digit` hint have no automated test and await a real-machine check.

MSIX end to end: first run `Build-WindowsPackage.ps1 -LocalTestSign`, then `Test-WindowsRecovery.ps1`.
- It installs the `app.workfleet.crashprobe.e2e` test identity and has it, as a sign-in start, throw the same error after the scenes enter Explorer.
- It checks four things:
  - All scene windows leave Explorer before Windows writes its report.
  - Meanwhile `Progman` and `Shell_TrayWnd` keep responding, and there is no Explorer hang report.
  - No reopen: no new instance, no `restart.json`, and no reopen record in `host.log`.
  - At the end the test removes the test package and its dump; `host.log` stays in `build/windows/crash-probe/`.
- It does not touch the installed Work Fleet.
- The reverse check, "without detaching, Explorer hangs", is not run, because it would freeze the user's Explorer.
- A render-thread failure at a real sign-in can be observed only by installing the new version, rebooting and reading `host.log`.

Display-switch end to end: first run `Build-WindowsPackage.ps1 -LocalTestSign`, then `Test-WindowsDisplaySwitch.ps1`.
- It needs two displays; a laptop must have its lid open, because with the lid closed Windows does not let DisplaySwitch extend to the built-in display.
- It first switches to "Extend", then installs and starts the `app.workfleet.displayprobe.e2e` test identity. After the scenes enter Explorer,
  it alternates between "Second screen only" and "Extend", 3 rounds by default.
- `-SwitchAfter N`: switch N seconds after start, without waiting for the scenes to settle. `-Lid`: the user closes the lid to trigger one switch instead.
- Pass conditions:
  - The test package has no fatal error.
  - Explorer is never unresponsive for 5 seconds in a row and has no hang report.
- It changes the display configuration of the current sign-in session, and other windows move with it; at the end it switches back to `-Final`, which is second screen only by default.
- It refuses to run while another Work Fleet is running, because the same display change would affect it.
- At the end it removes the test package and its dump; `host.log` stays in `build/windows/display-probe/`.
- The script cannot produce the sign-in state "lid closed but built-in display still active"; that can be observed only by rebooting and reading the display records in `host.log`.

To investigate sign-in crashes, you can turn on full Windows Error Reporting dumps locally (this needs an administrator; the app never sets it up itself):

```powershell
$k = 'HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\WorkFleet.exe'
New-Item -Path $k -Force | Out-Null
New-ItemProperty -Path $k -Name DumpFolder -PropertyType ExpandString -Value '%LOCALAPPDATA%\CrashDumps' -Force | Out-Null
New-ItemProperty -Path $k -Name DumpType -PropertyType DWord -Value 2 -Force | Out-Null
New-ItemProperty -Path $k -Name DumpCount -PropertyType DWord -Value 5 -Force | Out-Null
```

- Dumps are written to `%LOCALAPPDATA%\CrashDumps\WorkFleet.exe.<PID>.dmp`, about 1 GB each, and at most 5 are kept.
- When they are no longer needed, delete the `LocalDumps\WorkFleet.exe` key.
- The installed build's log is at `%LOCALAPPDATA%\Packages\app.workfleet.preview_<id>\LocalCache\Local\WorkFleet\host.log`.

Google sign-in callback (ADR-021): the core probe verifies `LoopbackCallback` with real loopback sockets.
- It first opens a connection that sends nothing, then sends the real redirect: the code must arrive within the single connection's 5-second deadline, and the empty connection closes with the listener.
  This is the 0.2.1 failure; a version that handles connections one at a time would be 5 seconds slow here and fail.
- A wrong state, a repeated state, another path and POST all get 400 and the wait continues; a connection that disconnects first counts only as dropped.
- A request delivered in three parts, with the blank line that ends the headers split, is parsed normally.
- With 16 empty connections open at once, the 17th is closed immediately; after the empty connections disconnect, the callback is received normally.
- `error=access_denied` carrying this run's state is handed to the caller to reject; on cancel the port and any open connections are closed.
- Browser sign-in with a real Google account still needs a manual check on an installed build.

In-app updates (ADR-044, revised 2026-10-15): the core probe uses `tests/fixtures/update-feed.atom` and `update-feed.json` to verify platform filtering of the public Atom feed,
numeric version comparison, download locations in the same repo and tag, rejection of unknown channels and unlisted platforms, rejection of DTDs and external entities, and the manifest and MSIX identity checks.
`Test-WindowsUpdate.ps1` runs after `Build-WindowsPackage.ps1 -LocalTestSign`: it turns the MSIX into two versions of `app.workfleet.updateprobe.e2e`,
signs both with the same local certificate, installs the old version and gives it a local test source, and confirms that it downloads, verifies and saves the update itself and that, after it closes, Windows replaces it with the new version; finally it removes the test package.
It does not touch the installed Work Fleet; during the run the test identity's main window and an empty desktop scene appear briefly; the local feed also uses Atom.
The public feed and manifest can be verified read-only against existing releases, with no need to publish or modify a release.
The Linux updater is verified by `tests/test_linux_updater.py` with the same fixture, and with fake HTTP and commands it verifies the redirect allowlist, size and SHA-256, the `dpkg-deb` fields,
cancelling pkexec and changes after download; it also verifies that queries do not touch the REST API, the classification of ordinary 403 and of 429 or 403 with Retry-After, that the feed does not redirect, and that file names cannot traverse.
Its timing test (install callback and worker end) can time out on its 10-second wait when the full JS suite or a build runs at the same time; it passes when run alone or rerun once the load is gone (2026-10-15 to 2026-10-17).
The updater itself was not changed for this.
`test-host-shell.sh` confirms that running from outside a DEB reports unsupported. A real pkexec and polkit install needs a real test with the DEB on Debian or the Pi.
macOS: `tests/update-feed-writer.test.js` verifies the appcast and manifest that `write-update-feed.mjs` produces; the Swift code is compiled by the manual Apple build workflow.
`python3 -B -m unittest discover -s tests -p 'test_macos_release_feed.py' -v` compiles the official `FleetReleaseFeed` with the shared fixture on a Mac,
and verifies macOS version selection, no downgrade from a newer local version, the appcast location, an empty feed, a DTD, a wrong namespace, an unknown channel, a different repo, and strict version numbers;
platforms without the Swift SDK skip it. The Mac release job runs it before signing; it does not go online or use the real app or user data.
Sparkle's sandboxed install, `feedURLString` and EdDSA key can be verified only on a Mac, by updating a Developer ID notarized old version to a new one.

Inspecting the Debug app with CDP during development (it uses the official data directory; close the installed app first):

```powershell
.\scripts\windows\Build-WindowsApp.ps1 -Configuration Debug
$env:WORK_FLEET_WEBVIEW_DEBUG_PORT = '9339'
& .\src\native\windows\app\bin\Debug\net10.0-windows10.0.19041.0\WorkFleet.exe
Remove-Item Env:WORK_FLEET_WEBVIEW_DEBUG_PORT
# http://127.0.0.1:9339/json/list lists the main window and desktop scene targets
```

The VS Code launch configuration "Windows: Work Fleet (Debug + CDP 9339)" is equivalent to the steps above; the "windows: native tests" task runs the full native regression.

Set the variable only in the current shell's process environment; do not use setx or the registry. CDP does not start when the port is already in use.

## Gesture test helper

```bash
xcrun swiftc -module-cache-path build/module-cache scripts/testing/input-probe.swift -o build/input-probe
build/input-probe
```

The helper first queries the public `CGPreflightPostEventAccess()`; without permission it reports that and exits, without changing permissions.
With permission it shows a dedicated test target, sends clicks, drags and keyup/down, and reports how many were received;
running the helper alone verifies only the test target and **cannot prove mouse click-through to another app**.
The steps and untested states for real desktop and Finder marquee selection and drag-and-drop are recorded in the [validation report](validation/2026-10-03-validation-report.md).

## Artifact checks

```bash
codesign --verify --strict 'build/Work Fleet.app'
codesign -d --entitlements - 'build/Work Fleet.app'
otool -L 'build/Work Fleet.app/Contents/MacOS/WorkFleet'
```

The final staged export rebuilt successfully in a clean directory with an empty module cache; the 13 HTTP/SQLite tests, the 8 JS tests and the document checks also passed.
This historical 0.1.0 Mac validation applied no third-party package tree; the system and external runtimes and their versions are in the
[runtime inventory](validation/runtime-inventory.json). Before a store release, these checks must be redone on the actual package.

The initial bootstrap and document-check history is kept in Git; it cannot substitute for the product tests above.
