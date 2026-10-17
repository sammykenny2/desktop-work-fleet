# Android native App

A native Activity/WebView, SQLite transactions, Android Keystore AES-256-GCM, Storage Access Framework backups,
Credential Manager account selection and Google AuthorizationClient Drive authorization. The phone app needs no desktop
overlay permission.
The native WebView reads only packaged assets; Google and file operations go through a fixed bridge, and there is no
local note server.

## Open and build in Android Studio

Keep a full repository checkout and, in Android Studio, choose **Open** on this directory,
`src/native/android` (which contains `settings.gradle.kts`), not the repository root and not the `app` subdirectory.
The project includes `gradlew`, `gradlew.bat` and `gradle/wrapper/`; Gradle does not need a separate installation.

1. Install Node 22+ (with npm). Gradle finds the absolute paths of `node`/`npm` from the PATH the IDE passes to the
   build, so an Android Studio started from the macOS Dock that loads the login shell PATH can also use a Node installed
   with nvm or Homebrew.
2. Use the SDK Manager to install Android SDK Platform 36 and Build Tools 35.0.0; use JDK 17 or a compatible newer
   version as the Gradle JDK. Android Studio must support AGP 9.4.1; for version compatibility see the
   [official notes](https://developer.android.com/build/releases/agp-8-13-0-release-notes).
3. Open this directory, finish Gradle Sync, select the `debug` variant of `app`, then use Run or Build APK.
   The first build downloads Gradle 9.6.0 and the Maven dependencies, and runs `npm ci --ignore-scripts` and generates
   the shared UI and public configuration automatically.
   There is no need to run `npm run build` first; a local preview builds without `.env`, and Google features need their
   own configuration.
   If the first Gradle Sync fails, the `app` Run configuration is not created; add it under Edit Configurations.

The `local.properties` that Android Studio creates holds only the local SDK path and is excluded from version control.
If the IDE does not load the shell environment and cannot find Node/npm, set `workFleetNode`/`workFleetNpm` to the
executable paths in the local Gradle user properties (use `/` in Windows paths); the environment variables
`WORK_FLEET_NODE`/`WORK_FLEET_NPM` are also supported. Do not commit personal paths to the project settings.

The command line in this directory also builds; set `JAVA_HOME` and `ANDROID_HOME`, or use the SDK path the IDE created:

```powershell
.\gradlew.bat assembleDebug
```

```bash
bash ./gradlew assembleDebug
```

The APK is at `app/build/outputs/apk/debug/WorkFleet-<versionName>-android-debug.apk`; the release AAB is
`app/build/outputs/bundle/release/WorkFleet-<versionName>-android-release.aab`. The version is recorded only in
`versionName` in `app/build.gradle.kts`.
`scripts/windows/Build-AndroidApp.ps1`/`scripts/linux/build-android-app.sh` also copy the build output to the repository's
`build/`, with a `.sha256`.
Gradle generates the UI and `config/public.json` into `app/build/generated/web-assets/` and packs them into the APK in the
same build;
it never reads a possibly stale `build/app` or `build/config/public.json` from the repository root.
After changing the application ID in `.env`, run Gradle Sync again; the other public settings are also refreshed at
build time.

An APK with a different debug signature (or a lower versionCode) cannot install over the existing app; on 2026-10-06
the old app had to be uninstalled. Build with the shared debug keystore (`WORK_FLEET_ANDROID_DEBUG_KEYSTORE`) so updates
keep the data.
Android Studio and a terminal `adb` compete for port 5037, which shows `ADB server didn't ACK`; it does not affect the
app, but some `adb` commands need a retry.

## Repository build scripts

The following entry points also work from the repository root. Node 22+, npm, JDK 17 and Android SDK platform 36 are
prerequisites;
the scripts also use the Gradle Wrapper and generate the assets automatically.
On Windows with a JDK already installed, `scripts/windows/Install-AndroidToolchain.ps1 -AcceptSdkLicenses`
downloads pinned SDK command-line tools and Gradle from the official sources, compares them with the official SHA-256,
and installs API 36 and Build Tools 35.0.0.
Read and accept the [Google SDK terms](https://developer.android.com/studio#terms-and-conditions) first.
Tools and the SDK are written only to `build/toolchain`; a local paths JSON is generated automatically and read by the
build entry points, and the system PATH is not changed.
`ANDROID_HOME`, `JAVA_HOME` and `GRADLE_HOME` from `.env` or the process environment override the generated paths.

```powershell
.\scripts\windows\Build-AndroidApp.ps1
.\scripts\windows\Build-AndroidApp.ps1 -Release
.\scripts\windows\Build-AndroidApp.ps1 -Signed
```

```bash
bash scripts/linux/build-android-app.sh
bash scripts/linux/build-android-app.sh --release
bash scripts/linux/build-android-app.sh --signed
```

The default Debug application ID is `app.workfleet.preview`. Release requires the final public settings.
Signing comes from four process/CI variables, `WORK_FLEET_ANDROID_KEYSTORE` (absolute path),
`WORK_FLEET_ANDROID_KEY_ALIAS`, `WORK_FLEET_ANDROID_STORE_PASSWORD` and `WORK_FLEET_ANDROID_KEY_PASSWORD`,
which are never written to the repository, `.env` or the public JSON. `-Signed`/`--signed` requires all inputs and stops
when one is missing.
Using the release variant in Android Studio or running `gradlew bundleRelease` directly checks the final public settings
in the same way.
A release AAB without the inputs is unsigned and must go to an external signing pipeline; the Gradle cache defaults to
`build/gradle-home`.
Google needs an Android client (package + signing SHA-1) and a Web client (the Credential Manager audience) in the same
project.
Set `WORK_FLEET_GOOGLE_ANDROID_CLIENT_ID`/`WORK_FLEET_GOOGLE_WEB_CLIENT_ID` and rebuild.
No Web client secret is needed, and no own sign-in server is built.

The GitHub **Android device APK** workflow builds manually from main with the fixed test keystore and checks
`WORK_FLEET_ANDROID_DEBUG_SHA1`; it does not bump the version or publish a Release, and the artifact is kept for
fourteen days.
The Secret settings are in [phone test builds](../../../docs/deployment.md#phone-test-builds).
`WORK_FLEET_ANDROID_DEBUG_KEYSTORE` can point locally or in CI to the absolute path of an existing debug keystore,
with the standard Android debug alias and passwords; when it is not set, Android Studio's default behaviour is kept.

The system life cycle does not guarantee a close callback, so body input saves the draft immediately. The back key first
asks the renderer to save, then closes.
After a forced stop or background reclaim, Android recovers only from the last committed SQLite transaction.
Automatic backups are scheduled from the shared journal while the app runs; there is no claim that they run at any
background time.
If an external document provider cannot fsync or confirm a read-back, the backup reports a failure and keeps the new
file; it never reports success or falls back to plaintext.

Device used for Android checks: a Pixel 9 Pro on Android 17 (2026-10-06).
After the keyboard closes, the page stays scrolled; pull down to see the title again (2026-10-06).
As of 2026-10-17, these are not verified on devices: real Google sign-in, full editing, attachments and backups, the
Share inbox, the back-key paths and process death.
Current status, including native builds, real devices, Google round trips and signing/store acceptance, is in the root
[PROGRESS](../../../PROGRESS.md); verification evidence is in [testing](../../../docs/testing.md) and the git history.
The Gradle Wrapper was generated by the official Gradle 9.6.0 tooling, and the distribution SHA-256 is pinned in the
wrapper properties;
the source and the Apache-2.0 licence are in the root THIRD-PARTY-NOTICES and in this directory's
`gradle/LICENSE.txt`/`NOTICE.txt`.
Gradle generates per-variant bundled licence data from the Debug/Release runtime graph, keeping the artifact SHA-256,
the upstream POM and the LICENSE/NOTICE/COPYING files inside AARs/JARs, plus the full Apache-2.0 text.
The APK/AAB assets contain `licenses/native/inventory.json`; a missing POM or licence declaration is marked explicitly,
and no licence is inferred automatically. The generated data holds only versions and upstream texts, with no
certificates or local artifact paths.
Each round uses a new generated directory and keeps the existing build outputs, so old generated notices are never mixed
into the current variant.

Attachment and draft downloads are saved with ACTION_CREATE_DOCUMENT; blob URLs are never handed to an external browser.
The editor can share Markdown text and a single attachment; the content first passes a bounded transfer and SHA-256
check,
then the system share sheet opens with a FileProvider content URI and a temporary read-only grant, with no public
filesystem path.
Share staging is limited to 32 items/256 MiB, and the next share removes the app's own staging older than 24 hours; the
original data stays in the encrypted SQLite.
Cancelling file selection does not consume the draft; an open share sheet does not mean the receiving app received it.

ACTION_SEND/SEND_MULTIPLE receive text and content URI files; the title and body are kept together, and no arbitrary URL
is downloaded.
The content is first saved to the Keystore/AES-GCM encrypted Share inbox; it can be read after a restart, and the native
intent keeps the same identity to avoid replays.
It is received as a draft only after a group of the current account is chosen in the main window's "Share inbox" and
"Accept as draft" is pressed, and the Share inbox item is removed only after the draft is saved.
At most 256 KiB of text, 16 files and 25 MiB of files in total per share; the Share inbox holds at most 64 items/512 MiB.
Capacity, permission or save failures keep the original source; a retry recognizes the capture receipt in drafts and
cards and avoids creating duplicates.
Discarding a share ("Discard this share") needs confirmation in the main window; the Share inbox is in a no-backup private directory, and
removing the app or the key loses the ability to decrypt it.

## Localization

- The Settings > General > Display language choice (`auto`, `en` or `zh-TW`) is stored in the activity's private
  preferences under the key `language`; it is never part of a profile, a backup or Google data. A missing or damaged
  value reads as `auto`, which follows the system's locale list.
- The host's own text (dialogs, chooser titles and the values it returns for the page to show) is in
  `app/src/main/java/app/workfleet/nativehost/HostText.java`, with an `i18n:en` and an `i18n:zh-TW` block.
- `host.language.set` saves the preference, re-resolves the locale, redraws any open host dialog and replies with
  `{ preference, system }`. Android has no tray or menus to redraw. The rules are in
  [Internationalization](../../../docs/i18n.md).
