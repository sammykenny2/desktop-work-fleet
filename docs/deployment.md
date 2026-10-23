# Platforms and distribution

Updated: 2026-10-17. Full 1.0 is still the target; every build so far is a preview. This document holds the packaging
and release procedure. Current status is in [PROGRESS](../PROGRESS.md), version history in the
[release notes](release-notes.md), and release outcomes in the GitHub Releases and their workflow runs.

| Platform | Packaging entry point | Output and prerequisites |
|---|---|---|
| Windows x64 | `scripts/windows/Build-WindowsPackage.ps1` | MSIX/portable ZIP with a bundled .NET 10 Desktop runtime; running it still needs WebView2, packaging needs the .NET SDK/Windows SDK |
| macOS | Xcode: open `src/native/apple/WorkFleet.xcodeproj`; or `scripts/macos/build-native-app.sh --platform macos --release`, `package-native-app.sh` | xcarchive/PKG/optional DMG; Xcode, Node 22+/npm, an Apple team and signing identities |
| Linux | `scripts/linux/build-native-app.sh`; optional `--release --deb`; on Windows, `Build-LinuxPackage.ps1` | source/runtime tar.gz/DEB; offline notes need the system GTK/WebKitGTK, Google and saved backup passwords also need a Secret Service |
| iOS | The same committed Xcode project, scheme WorkFleetIOS; or `scripts/macos/build-native-app.sh --platform ios --release`, `package-native-app.sh` | xcarchive/IPA; Xcode, Node 22+/npm, an Apple team, App Group profiles for the app and the extension |
| Android | Android Studio: open `src/native/android`; or `scripts/windows/Build-AndroidApp.ps1`/`scripts/linux/build-android-app.sh` | debug APK/release AAB; Node 22+, npm, JDK 17, Android SDK 36. The Gradle 9.6.0 Wrapper is included and assets are generated automatically; see [opening and building](../src/native/android/README.md) |

## Versions and release file names

Windows support follows [ADR-034](decisions/034-windows-11-compatibility-and-install-floor.md): the target covers early
Windows 11/23H2 and 24H2+, and Windows 10 is excluded from installation.
The MSIX generator and the earlier local 0.1.1 package were verified with `Windows.Desktop MinVersion=10.0.22000.0` and
`MaxVersionTested=10.0.26200.0`.
The 23H2 native probes passed; on 2026-10-10 the user reported no particular problems in local testing and approved the
0.1.2 preview release.
Other Windows 11 versions and the full interaction matrix are not yet accepted, and the Store identity and submission
have not started. The Windows 10 API baseline the framework compiles against is not the product's support range.

Each platform records its version in a fixed file in the repository, and every build entry point for that platform
reads only that record (`node scripts/platform-version.mjs --platform linux|windows|apple|android` prints it).
Any version bump needs the user's explicit approval of the specific version number.
Since 0.2.0 the five platforms share one version number (the user's decision on 2026-10-14) and are bumped together.
Since 0.3.7 one GitHub prerelease tagged `v<version>` carries Windows, macOS, Linux and Android together (the
maintainer's decision on 2026-10-23), so a release needs all four records to hold the same version
(`node scripts/platform-version.mjs --release` prints it and fails when they differ), and no platform is released alone.
The version's entry in [release notes](release-notes.md) lists the platforms under `Platforms`.
Releases up to 0.3.6 had one tag per platform (`windows-v`, `linux-v`, `macos-v`, `android-v`). Desktop installs of 0.3.6
or earlier look only for those: they keep reporting that they are up to date, or an error once those releases are deleted
or leave the feed, and never offer a `v<version>` release. Each needs one manual install of 0.3.7 or later; after that,
in-app updates find the shared releases.
The shared Apple configuration raises the iOS record together with macOS, also when iOS is not released.
The data schema stays at V1 and does not follow the app version.
Apple `CURRENT_PROJECT_VERSION` and Android `versionCode` are raised with each bump of that platform. The build number is
minor × 100 + patch while the major version is 0 (0.2.7 is 207, 0.3.0 is 300).
File names never come from the build machine's architecture, certificates or environment: the same commit produces the
same file names on every development machine.
Every release file a script produces has a `.sha256` file of the same name next to it, checkable with `sha256sum -c` or
`shasum -a 256 -c`.

All platforms put their release files and `.sha256` files directly in `build/`, at the same level and without random
subdirectories; an old file with the same name is overwritten, and different versions coexist.
Intermediate output goes to a fixed work directory per platform, emptied at the start of every build: Windows
`build/windows/package`, Apple `build/apple/preview-<macos|ios>` (with README.txt/toolchain.txt) and
`build/apple/export-<macos|ios>`, Linux `build/linux/work-fleet-<version>`; Android output from Gradle is copied to
`build/`.
Windows and Apple move files to `build/` only after the whole build, signing and notarization have succeeded, so a
failure leaves no partial output.

- Windows: `<Version>` in `src/native/windows/Directory.Build.props`, used for the assembly version, the MSIX identity
  (with `.0` appended) and `WorkFleet-<version>-x64.msix`/`WorkFleet-<version>-x64.zip`.
- macOS/iOS: `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` in `src/native/apple/config/WorkFleet.xcconfig`;
  an override in Local.xcconfig or on the command line makes resource preparation fail. The packaging scripts read the
  app's Info.plist.
  - macOS command-line builds always include arm64/x86_64, and both architectures are checked before packaging.
    Release exports are `WorkFleet-<version>-macos-universal.pkg`/`.dmg`;
    previews are `WorkFleet-<version>-macos-universal-<unsigned|development>.zip`, or `.dmg` with `--dmg`.
  - iOS previews are `WorkFleet-<version>-ios-<unsigned|development>.ipa` and `WorkFleet-<version>-ios-simulator.zip`;
    release exports are named by `--method` as `WorkFleet-<version>-ios-<method>.ipa`;
    the macOS `app-store-connect` export is `WorkFleet-<version>-macos-universal-app-store-connect.pkg`.
  - The preview suffix comes from the app's own signature, not from the certificates on the build machine.
- Android: `versionName` in `src/native/android/app/build.gradle.kts`;
  `WorkFleet-<version>-android-debug.apk`/`WorkFleet-<version>-android-release.aab`.
- Linux: `src/native/linux/VERSION`; `build/work-fleet_<version>_all.deb` follows the Debian
  `package_version_architecture` convention, and the source/runtime archive is `build/work-fleet-<version>.tar.gz`.

Public settings are in `.env.example`: each platform's Google client, the app ID, the Apple team/App Group, the
Microsoft package identity/publisher, and privacy and support data. Private keys and passwords come from the OS
Keychain or the CI environment.
`-Release`/`--release` requires the final public settings; a preview still allows Google to be unconfigured and keeps
local note-taking.

The Windows packaging script builds in the fixed `build/windows/package` and, on success, moves the MSIX/ZIP (and the
public CER for `-LocalTestSign`) to `build/`.
`-CertificateThumbprint` (CurrentUser/My) with an HTTPS `-TimestampUrl` signs the MSIX;
the publisher must match the existing certificate's subject or the Partner Center identity. The script does not install
certificates or change trust.
Local preview test installs use `-LocalTestSign`, which reuses a valid CurrentUser/My certificate that matches the
publisher and is already trusted in LocalMachine/TrustedPeople; it uses no timestamp and cannot be combined with
`-Release`.
`-CertificateThumbprint` selects an existing certificate; without it, exactly one suitable certificate must exist, and
the script fails clearly when there is none.
On success SignTool verifies the signature and the public CER is written out, while the private key stays in the
certificate store; a local machine that already trusts it can install that MSIX directly.
No Windows Store developer account is needed; other test computers must trust the CER first, see
[Microsoft's local signing guide](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide).
Windows packaging is self-contained `win-x64` by default: the MSIX and the ZIP both include the .NET 10 Desktop runtime,
so the receiving computer does not need to install .NET.
The self-contained runtime patch is pinned to `10.0.13` (`WindowsRuntimeVersion` in `Directory.Build.props`), matching
the Desktop licences and notices kept with it; when updating it, check the runtime source and licences as well.
[ADR-050](decisions/050-windows-wpf-display-loss-runtime.md) adopts the WPF display-loss fix; three local reboots did not
crash again, and early removal of the primary display and other OS versions are still to be compared.
WebView2 still uses the system Evergreen Runtime. The package is larger, and an update of the bundled .NET requires
rebuilding, testing and releasing the app, see [ADR-036](decisions/036-windows-self-contained-packaging.md).
`-SkipRestore` is only for machines that have completed a package restore with the same settings and have the win-x64
runtime packs in the cache; do not use it for a first package build.
Ordinary `Build-WindowsApp.ps1`/IDE builds remain framework-dependent and are not the same as the packaging output above.
The existing GitHub `windows-v0.1.2` is a framework-dependent package released before this change and still needs the
matching .NET 8 Desktop runtime installed separately; it is not replaced.
`windows-v0.1.0` and `windows-v0.1.1` require Windows 11 24H2 or later; `windows-v0.1.2` lowered the floor to build
22000. An installed 0.1.2 has no in-app updater, so moving to 0.2.0 or later needs a manual install.
The ZIP contains `WorkFleet.exe`, the bundled runtime and dependencies; the MSIX and the ZIP both keep the runtime's full
licences/notices and NuGet package metadata, and neither contains a runtime installer.
An unsigned preview MSIX is not treated as directly installable or as a store deliverable, and the ZIP has no
executable signature either.
Without an existing trusted preview certificate, a plain `Build-WindowsPackage.ps1 -SkipRestore` produces an unsigned
MSIX/ZIP, and `Test-WindowsPackage.ps1 -PackagePath build/WorkFleet-VERSION-x64.msix -Unsigned` checks only the package
contents.
Users unpack the ZIP and run `WorkFleet.exe`; the ZIP and the unpackaged Debug build share `%LOCALAPPDATA%\WorkFleet`,
so close an older instance that uses the same data folder first.
The MSIX uses the package's private data folder; updates keep it, and uninstalling removes all local data inside the
package (including Google account workspaces, drafts, settings, credentials and caches).
Before uninstalling and reinstalling the same version, export a backup first; exported ZIPs and Google cloud data are
not affected.
An old standalone folder is neither moved nor deleted automatically: export with the old version/ZIP first, then import
into the MSIX; see [ADR-037](decisions/037-msix-data-lifetime-and-google-backup-overwrite.md).
This path creates no certificate, changes no trust and is not an MSIX installation acceptance.

### Preview releases

Previews are published as one GitHub Release per version, so other computers and phones can download the MSIX, DMG, DEB
and APK directly. Release only when the user asks for it; ordinary implementation, commits and pushes do not bump the version or release.
The user's rule from 2026-10-09: any version bump needs approval of the specific version number, and a plain request for
a preview release does not authorize choosing the number; dispatching GitHub Actions also needs explicit authorization,
and consent already given in the current session is not asked for again.
The repository has been public since 2026-10-14, so standard GitHub-hosted runners are free; `ci.yml` runs the
documented checks on every push to main and every pull request.
Release workflows are still dispatched manually, and only after the user authorizes it.
The user's rule from 2026-10-10: no commit or push after a release, so that push-triggered CI does not run again. The rule
applies to all platforms, and also to an agent's documentation and handoff wrap-up.

1. Once the specific version number is approved, finish the round's code, tests and documentation. The last commit of
   the round is the version-bump commit: it changes the approved version records (for Windows, `<Version>` in
   `src/native/windows/Directory.Build.props`) and adds the version's entry to [release notes](release-notes.md),
   following the entry format at the top of that file: a `Platforms` line, a one-line `Summary` for the in-app update
   prompt, and change bullets that summarize the commits since the previous version.
   The entry must stay true after publication: no "prepared", "published" or "released" wording, run IDs, hashes, or the
   bump commit's own SHA. `tests/release-notes.test.js` fails while a recorded version has no entry.
   PROGRESS.md records no release or publication status.
   Confirm that the target tag and release do not exist yet; a version that was published cannot be used again.
   Before the bump commit, a read-only `gh` check confirms that the target tags and releases do not exist, that Actions
   is enabled and that the required Secret and variable names exist (never reading their values); this routine was used
   for 0.2.4 to 0.3.0.
2. Run the appropriate local checks and state their actual results in the bump commit's body, then push main.
   Before dispatching, confirm that the worktree is clean, that the local HEAD equals origin/main and that the version
   is the target the user approved.
3. Once Actions is authorized: `gh workflow run preview-release.yml --ref main` (or run Preview release from the
   Actions page with main selected).
   Note the run URL and check that the run's source SHA is the version-bump commit; from dispatch on, the repository
   gets no release bookkeeping (see below).
4. [preview-release.yml](../.github/workflows/preview-release.yml) first confirms that it runs on main, that the four
   version records agree, that neither the `v<version>` tag nor the release exists, reads the version's entry with
   `scripts/release-notes.mjs` (which fails when the entry is missing or malformed) and runs `npm test`.
   It then builds the four platforms side by side through `windows-package.yml`, `macos-package.yml`,
   `linux-package.yml` and `android-apk.yml`, passing the entry's `Summary` as the in-app update summary. Each saves
   its share of the release as an artifact. The publish job checks all of them with
   `scripts/validate-release-assets.mjs`: exactly the expected files, each `.sha256` and each desktop manifest matching
   its files, and the appcast pointing at the macOS ZIP in this release. Only then does it create the tag and the
   prerelease in one step, whose text is the entry's change bullets followed by each platform's installation steps.
   The release carries the MSIX, the public CER and `work-fleet-update-windows.json`; the DMG, the Sparkle ZIP,
   `appcast.xml` and `work-fleet-update-macos.json`; the DEB and `work-fleet-update-linux.json`; the APK; and a
   `.sha256` for each installer. A failure leaves no release.
   The workflow takes no dispatch inputs (there is no `summary` input): the release text and the update summary come
   only from the entry.
   Release text is English: the release-notes entry is written in English, and the installation steps that
   `preview-release.yml` appends are English text in the workflow. Where an in-app update prompt shows the entry's
   `Summary`, it stays English whatever the app's display language.
5. Wait for the result, download the output into a Git-ignored directory and verify it, then report in the conversation
   the run and release URLs, the source commit, the verification results and any needed file sizes and hashes.
   The final SHA, the run URL and the success or failure of the release, which are known only afterwards, are recorded by
   GitHub and in the conversation; do not edit tracked files, commit or push to fill them in.

After dispatch, no commit may be made to update `PROGRESS.md`, handoffs, documents, output lists or release results;
ordinary documentation sync and standing commit/push authorization are not exceptions, and such commits are not
offered either. They add nothing and make everyone pushing at the same time merge and re-run CI.
Fixes are different: when a run fails because of a defect in code, scripts or workflows, fix it in an ordinary commit
with the usual checks, then dispatch `preview-release.yml` again under the same authorization; a transient outside
failure, such as a dropped connection to Apple's notary or ticket service, is re-run with "Re-run failed jobs", which
keeps the platforms already built. Nothing is published until every platform succeeds. Re-dispatching builds the
latest main, so first confirm that main holds no unrelated commits since the version bump, or ask the maintainer. A
version that already published needs a new version for a fix.
Old releases are removed only by the maintainer; with one release per version that is one
`gh release delete v<version> --cleanup-tag` each.
This boundary does not depend on whether the workflows can currently only be dispatched manually, and a CI-skip
directive in a commit message does not replace it.

Settings the GitHub repository needs:
- Variables: `WORK_FLEET_GOOGLE_PROJECT_ID`, `WORK_FLEET_GOOGLE_WINDOWS_CLIENT_ID`.
- Secrets: `WORK_FLEET_GOOGLE_WINDOWS_CLIENT_SECRET`, `WORK_FLEET_WINDOWS_SIGNING_PFX_BASE64`,
  `WORK_FLEET_WINDOWS_SIGNING_PFX_PASSWORD`.
  Without the Google settings or the signing certificate the workflow fails, and no package that cannot sign in or
  cannot be installed is published.

CI signs with the preview certificate in the repository secrets above; the local `-LocalTestSign` uses a certificate
from the local store, and the two need not be the same certificate.
The CI preview certificate is the same `CN=Work Fleet Preview` certificate used locally: on 2026-10-06 its PFX was
exported with a random password, reloaded locally to confirm it, and stored as a Secret together with the Google client
secret.
A package with the same package identity/publisher and a higher version installs as an upgrade, but the installing
computer must still trust the package's signing certificate; when moving from a local package to a CI package, check and
trust the public CER attached to the release first.
When the CI certificate changes, update the signing secrets and trust the new CER again on every test computer; do not
export or upload a local private key that is marked non-exportable.
On each computer, the CER must first be imported into LocalMachine/TrustedPeople as an administrator; after that, an MSIX
with a higher version installs directly as an upgrade, and the same version must be uninstalled first.
Since the repository is public, the release page can be downloaded without signing in.

In-app updates (ADR-044): `Build-WindowsPackage.ps1` writes `build/work-fleet-update-windows.json` next to the MSIX
(version, the `v<version>` tag, x64 installer name, size and SHA-256; `-UpdateSummary` adds a summary of at most 500
characters, which `preview-release.yml` takes from the release-notes entry). `Test-WindowsPackage.ps1` checks that it
matches the MSIX, and the release carries it together with the MSIX.
An installed MSIX checks the `v<version>` releases from Settings > General > Version and updates or from the tray item
"Check for updates…"; it downloads and verifies the package, saves drafts and closes, and then Windows installs it.
An app that had been running for at least 60 seconds is reopened after the installation.

Linux previews: `linux-package.yml` builds the DEB from `src/native/linux/VERSION` with its `.sha256` and
`work-fleet-update-linux.json` (written by `package-deb.sh`; `--update-summary` adds the summary, which the release
takes from the release-notes entry, as it does the release text). Bumping and dispatch need the user's authorization
in the same way; the repository settings it needs are the variables
`WORK_FLEET_GOOGLE_PROJECT_ID`, `WORK_FLEET_GOOGLE_LINUX_CLIENT_ID` and the secret
`WORK_FLEET_GOOGLE_LINUX_CLIENT_SECRET`.
`WORK_FLEET_GOOGLE_LINUX_CLIENT_ID` and `WORK_FLEET_GOOGLE_LINUX_CLIENT_SECRET` were set from the local `.env` with `gh`
on 2026-10-14; they use the same Desktop OAuth client as Windows.
Only an app installed from the DEB has in-app updates: it downloads and verifies the package and installs it with
pkexec (which needs the system password and a polkit authentication agent), then saves and restarts on success.

Desktop update checks on all three platforms use the public `releases.atom`, not the unauthenticated REST API; the
manifests and appcasts of existing releases need no rewrite.
Only the preview channel is supported; the limits of the Atom feed's recent-entries list and of a release channel are
in [ADR-044](decisions/044-desktop-in-app-updates-from-github-releases.md).

macOS previews and updates (Sparkle):
1. `macos-package.yml` builds a DMG and a Sparkle update ZIP that are Developer ID signed, notarized and stapled,
   with `appcast.xml` and `work-fleet-update-macos.json`; it produces no PKG and needs no Installer certificate. They go
   into the same `v<version>` release, the update summary comes from the release-notes entry, and dispatch still needs
   the user's explicit authorization.
2. Prepare a Developer ID Application `.p12` (with the private key and the Apple intermediate), its export password, and a
   **Developer ID distribution profile** that matches the App ID, the Team, that certificate and the Keychain access
   group. Create it under Apple Developer > Profiles > + > Developer ID;
   an API key with the Developer role may not be allowed to create that profile, and the Account Holder or an Admin can
   download it from the website.
   The App Sandbox and the Data Protection Keychain are not removed for CI signing.
3. Notarization uses an App Store Connect Team API key dedicated to this project; the Key ID must pair with the `.p8`,
   and the Issuer ID belongs to the same team.
   GitHub variables: `WORK_FLEET_APPLE_TEAM_ID`, `WORK_FLEET_APP_ID`, `WORK_FLEET_GOOGLE_PROJECT_ID`,
   `WORK_FLEET_GOOGLE_MACOS_CLIENT_ID`, `WORK_FLEET_SPARKLE_PUBLIC_KEY`, `MACOS_APPLICATION_IDENTITY`,
   `WORK_FLEET_PRIVACY_URL`, `WORK_FLEET_SUPPORT_URL`, `WORK_FLEET_SUPPORT_EMAIL`.
   Secrets: `MACOS_DEVELOPER_ID_APPLICATION_P12_BASE64`, `MACOS_CERTIFICATES_PASSWORD`, `MACOS_DEVELOPER_ID_PROFILE_BASE64`,
   `MACOS_NOTARY_KEY_P8_BASE64`, `MACOS_NOTARY_KEY_ID`, `MACOS_NOTARY_ISSUER_ID`, `SPARKLE_PRIVATE_KEY`.
   The runner uses a temporary keychain, checks the profile's validity period, Team, App ID, Keychain group and
   certificate, and then archives and exports with manual signing;
   the archive's manual profile applies only to the WorkFleetMac Release target, without a global provisioning override
   that would affect the SPM resource bundles.
   Temporary secrets are removed even when the run fails. The public release fields are checked once before the build,
   instead of discovering a missing value only at archive time.
   As of 2026-10-14 the seven signing, profile, notarization and Sparkle Secrets are set and their names were read back,
   and the macOS OAuth client ID, App ID, Team, identity, Sparkle public key and public support data are set as
   variables. The notary account was checked with `notarytool history`, and the Developer ID distribution profile came
   from the Apple Developer website.
   The signing certificate was re-exported as Apple Keychain compatible PKCS#12; with that file, the import into an
   isolated temporary keychain, identity trust and a timestamped hardened-runtime test signature passed (2026-10-14).
4. Only an app with the public key and a Developer ID signature offers "Check for updates"; Sparkle compares versions by
   `sparkle:version` (`CURRENT_PROJECT_VERSION`), so every release must raise it.
   An installed macOS 0.2.2 exits at launch and cannot update itself through Sparkle; it needs a manual install of a later
   DMG.

One-time Sparkle key setup: after the packages are resolved or built, the tools are in
`build/apple/SourcePackages/artifacts/sparkle/Sparkle/bin/`.
`generate_keys --account app.workfleet.preview` creates a separate keychain item; with the same account, `-p` prints the
public key and `-x <private key file>` exports it to a secure backup outside the repository, whose content becomes the
secret `SPARKLE_PRIVATE_KEY`.
Do not regenerate or overwrite this key for each release; locally, the key generated for that account is passed to the
packaging script through `SPARKLE_PRIVATE_KEY_FILE`.
Private keys, certificate passwords and the `.p8` must never go into the public settings or Git; the base64 value of each
original file must be a single line without extra prefixes.

With the matching profile and identity installed locally and the public fields configured, the same archive and export
can run locally:

```bash
bash scripts/macos/build-native-app.sh --platform macos --release \
  --application-identity "$APPLICATION_IDENTITY" --provisioning-profile "$PROFILE_UUID"
SPARKLE_PRIVATE_KEY_FILE="$HOME/Signing/WorkFleet-Sparkle.key" \
  bash scripts/macos/package-native-app.sh --platform macos --method developer-id \
  --application-identity "$APPLICATION_IDENTITY" --provisioning-profile "$PROFILE_UUID" \
  --notary-profile work-fleet-notary --dmg --no-pkg
```

The macOS Debug and Release targets set `@executable_path/../Frameworks` in `LD_RUNPATH_SEARCH_PATHS` explicitly, so
Sparkle still loads after the app is moved. Archive and export check the actual dynamic dependencies of both
architectures;
before notarization, export also launches the app with `--check-runtime`, which exits immediately without opening the UI
or a workspace.
A missing framework, load path or native load failure stops packaging: nothing is sent for notarization and no update file
is delivered. Details are in [testing](testing.md).
After notarization the app and DMG signatures, Gatekeeper and the staple are checked, and the update ZIP is signed with
Sparkle EdDSA. `stapler` calls reach Apple's ticket service over HTTP/3 (UDP 443), which GitHub-hosted runners have
dropped since 2026-10-12 ("The network connection was lost", error 68; four runs in a row on 2026-10-17, six tries over
15 minutes on 2026-10-23) while HTTPS over TCP works ([actions/runner-images#14924](https://github.com/actions/runner-images/issues/14924)).
The job therefore blocks outbound UDP 443 before packaging, GitHub's workaround, so stapler falls back to TCP; on
`macos-15` on 2026-10-23, 6 of 10 staple-and-validate rounds failed with UDP 443 open and 10 of 10 passed with it
blocked. Remove that step once the issue is fixed. Each staple and validate is still retried up to six times with pauses growing from
one minute (`WORK_FLEET_STAPLER_PAUSE` sets the first pause in seconds);
only when everything succeeds are `WorkFleet-<version>-macos-universal.dmg`/`.zip`, their `.sha256` files,
`appcast.xml` and `work-fleet-update-macos.json` delivered to `build/`.
Ordinary local packaging still produces a PKG by default; only `--no-pkg` skips it. Notarizing a PKG still needs
`--installer-identity`.
When using a notary keychain other than the default, set `WORK_FLEET_SIGNING_KEYCHAIN`.

The app ID, App Group and Team for direct Xcode builds come from the local xcconfig described in the
[Apple project](../src/native/apple/README.md);
the command-line build wrapper can override them with non-empty identities from `.env`. Generated assets, DerivedData and
archives stay in ignored directories.
Apple export uses `--method app-store-connect|developer-id|debugging|release-testing`; iOS does not accept
Developer ID. The export destination is always local, with no automatic store upload. macOS enables the hardened runtime;
Developer ID distribution can name an installer identity and an existing Keychain notary profile, and the app/PKG are
stapled after notarization.
The optional DMG is signed with the application identity, which a notarized DMG requires. Certificates, profiles and
accounts are configured by the maintainer.

### Phone test builds

#### Android on GitHub

In GitHub Actions, choose **Android device APK** (`android-apk.yml`), select main and press Run workflow. It is manual
only and needs the user's authorization to run; it changes no version, publishes no release and sends nothing to Google
Play. After a successful run, download the APK, its SHA-256 and the source-commit record from Artifacts, kept for
fourteen days. Artifact names carry the version, run ID and attempt so different builds of the same version cannot be
confused.

Releases publish the APK through [preview releases](#preview-releases): `preview-release.yml` calls `android-apk.yml`
with the release commit, and the verified APK goes into the `v<version>` release with the other platforms
([ADR-055](decisions/055-mobile-device-build-workflows.md)).

Repository Variables: `WORK_FLEET_APP_ID`, `WORK_FLEET_GOOGLE_PROJECT_ID`, `WORK_FLEET_GOOGLE_ANDROID_CLIENT_ID`,
`WORK_FLEET_GOOGLE_WEB_CLIENT_ID` and `WORK_FLEET_ANDROID_DEBUG_SHA1` (the signing SHA-1, colon-separated).
It reuses the existing Google Cloud project and needs no Web client secret.
`WORK_FLEET_ANDROID_DEBUG_SHA1` holds the fingerprint of the existing local test signer, which is also the SHA-1
registered for the Android OAuth client (2026-10-17).

| Repository Secret | Purpose |
|---|---|
| `ANDROID_DEBUG_KEYSTORE_BASE64` | base64 of the fixed test debug keystore; alias `androiddebugkey`, and the key and store passwords are the Android standard test value `android` |

First get the maintainer's explicit authorization to upload signing data to this repository's Secrets; never commit a
private key or put the values in public Variables.
The fixed Android key must be the same as the installed version's and must match the SHA-1 registered with OAuth; CI
checks this after packaging and fails on a mismatch.
This is a debug test build; the release Play App Signing key and upload key are prepared separately.

#### iOS local builds

iOS is built, signed and installed locally; GitHub workflows do not compile, sign, upload or publish iOS packages
([ADR-057](decisions/057-local-ios-builds-and-device-privacy.md)). A development or Ad Hoc IPA embeds profiles listing
registered device UDIDs. Skipping a Release does not hide those identifiers when the IPA is still uploaded as an
artifact of this public repository. Do not upload device IPAs, profiles or real-device data backups to public storage.

On a Mac with Xcode and a configured Apple Development identity, open `src/native/apple/WorkFleet.xcodeproj`, choose
`WorkFleetIOS` and the connected device, then Run. The local CLI equivalent is:

```bash
bash scripts/macos/build-native-app.sh --platform ios
codesign --verify --deep --strict build/apple/DerivedData/Build/Products/Debug-iphoneos/WorkFleetIOS.app
bash scripts/macos/package-preview-app.sh --platform ios
```

Local `.env` settings: `WORK_FLEET_APP_ID`, `WORK_FLEET_APPLE_TEAM_ID`, `WORK_FLEET_GOOGLE_PROJECT_ID`,
`WORK_FLEET_GOOGLE_IOS_CLIENT_ID` and optionally `WORK_FLEET_APP_GROUP_ID` (default `group.<APP_ID>`).
The private signing identity stays in the Mac's Keychain; the main app and Share Extension each need a local profile.
For existing Xcode-managed profiles that cannot use manual Xcode signing, first build with `--unsigned`, then use
`python3 scripts/sign_ios_app.py --help` to sign locally with both profiles and the matching public DER certificate.
The tool validates the Team, bundle IDs, App Group, main app's Keychain group, validity, certificate and matching device
sets; it signs the nested code, extension and app, embeds the matching profiles, and verifies the result.

Packaging produces `build/WorkFleet-<version>-ios-development.ipa` and its SHA-256 without changing the version.
Install the signed `.app` using Xcode or `xcrun devicectl device install app --device <DEVICE_ID> <APP_PATH>`, or use
Apple Configurator with the IPA. Keep the bundle ID and Team unchanged when updating an installed copy. Only devices
registered in both profiles can install it, with Developer Mode enabled. After adding a device, update both local
profiles and build again. No GitHub iOS signing Secrets or workflow dispatch are required.

The manual `.github/workflows/apple-native-build.yml` now targets only an unsigned macOS Debug ZIP. Hosted runners
are free for a public repository, dispatch needs authorization, the limit is 20 minutes and artifacts last seven days.

Android `-Signed`/`--signed` requires the four signing environment variables and produces a release AAB, see
[store preparation](release/README.md). An ordinary release build without signing inputs produces an unsigned AAB.
The Linux runtime tar.gz embeds no Python or GTK; the DEB is for distributions that provide the supported dependency
versions.
Behaviour on different distributions, CPUs, X11/Wayland sessions, desktops and compositors still needs its own evidence.
The Linux DEB uses the version in `src/native/linux/VERSION`, and early versions get no extra `~preview`. Ordinary
builds may use the preview maintainer contact;
a release still needs the final public settings and email, and the version number does not decide whether distribution
acceptance is complete.
The Linux and Windows build entry points write `build/work-fleet_<version>_all.deb` directly, and the packaging script
removes its staging automatically.
WSL cannot apply the Unix permissions `dpkg-deb` needs on a Windows-mounted checkout: build the DEB in a private Linux
temporary directory and copy it back into the ignored `build/` (2026-10-17).
The Docker packaging on Windows only runs dpkg-deb; it installs no GUI or app in the container and gives no runtime
acceptance result.

The 1.0 licences are in the [third-party notices](../THIRD-PARTY-NOTICES.md) and `src/native/licenses/`.
The final SPM/Android SDK licence inventory, real native screenshots and the store forms are still prepared from the
final distribution output, see [ADR-028](decisions/028-native-package-and-signing-entry-points.md).

The historical 0.1.0 `scripts/macos/build-app.sh`, Python server and HTTPS phone-browser path are kept for the old
version; their tests and [dependency inventory](validation/runtime-inventory.json) do not mean the 1.0 packages for the
five platforms are complete.
