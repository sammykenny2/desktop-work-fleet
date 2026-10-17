# ADR-028: Native packaging and signing entry points

## Status

Accepted, 2026-10-05; on 2026-10-06 per-platform version records and release file names were added.
On 2026-10-10 the Windows framework-dependent packaging choice was superseded by [ADR-036](036-windows-self-contained-packaging.md); the text below keeps the decision as it was then, and the other platforms and the signing contract are unchanged.

## Context

The full 1.0 covers five platforms and preparation for store submission; there are currently no maintainer Google, Apple or
store accounts and no signing private keys.
Public settings should be configurable from `.env.example`; missing credentials must not let a placeholder claim that official
distribution is complete.

## Decision

Windows uses Windows SDK MakeAppx to produce an x64 MSIX and also a portable ZIP; framework-dependent
execution needs .NET 8 Desktop and WebView2. The MSIX uses the public package identity and publisher and can optionally be
signed with an existing CurrentUser/My certificate and an HTTPS timestamp; the entry point does not install certificates or
change trust on its own.
Local preview uses `-LocalTestSign` to reuse an existing certificate that is already trusted in LocalMachine/TrustedPeople,
valid and matching the publisher, without a timestamp; it is mutually exclusive with `-Release`. Signature verification must
succeed, and a CER with only the public key is also output.
This entry point creates no new certificate and does not change trust, so later trial builds do not miss the existing local
signing.
Originally every packaging run used a new workspace build directory; on 2026-10-06 this changed to a fixed work directory,
see the release location below.

Apple builds an archive from the committed portable Xcode project of [ADR-029](029-portable-apple-xcode-project.md),
then exports it with local export options; generated assets and the archive/export stay in Git-ignored directories.
macOS enables the hardened runtime; with existing identities, Developer ID can produce a signed PKG/DMG, which can optionally
be notarized with a Keychain notary profile and stapled. The iOS export includes the embedded Share Extension;
the signing profiles still need the maintainer to configure the same team and App Group. The scripts do not sign in to or
upload to a store.

Android upload signing reads the keystore, alias, and store and key passwords only from the process or CI environment;
all four must be configured together. `-Signed`/`--signed` forces a signed release AAB; a normal release without configured
inputs can output an unsigned AAB for an external pipeline. Secrets go neither into public settings, nor into command-line
arguments, nor into the repo.
Linux keeps the system-runtime tar.gz and DEB build entry points and does not assume that Windows can complete Linux GUI
distribution acceptance.

On Windows, an optional workspace Android toolchain installer uses the official pinned SDK tools and Gradle downloads
with SHA-256 and, after the required SDK terms are accepted, installs API 36 and Build Tools 35.0.0. Tools, SDK, caches and the
path JSON are in the ignored `build/`; the system PATH is not changed. The public SDK path can be overridden by `.env` or the
process environment.

The Linux DEB is delegated to a separate dpkg-deb script; Windows can use an existing Docker Linux engine and run it in a
pinned Ubuntu image. The container mounts only the ignored `build/` artifact directory and the packaging script, runs with
network none, and installs neither the app nor a GUI runtime. On 2026-10-05, at the maintainer's instruction, the DEB uses the
product version `0.1.0` with no `~preview` suffix; a release still needs the official public configuration and maintainer
email. The version is later recorded in `src/native/linux/VERSION`.
The Linux and Windows entry points write the DEB and tar.gz directly to the root of `build/`; the bundle stays in `build/linux/`.
Each run creates a new staging directory and removes it automatically when the script ends, keeping the artifacts;
the package installs the launcher and license documents and uses root archive ownership.

On 2026-10-06, at the maintainer's instruction, release file names must be determined only by repository content: the same
commit, built with the same command on any development machine, produces the same file name, and different build entry points
of the same platform must not hard-code their own version. Each platform records its version separately, not in one shared file:
Windows in `src/native/windows/Directory.Build.props`, Apple in `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` of
`src/native/apple/config/WorkFleet.xcconfig`, Android in `versionName` of `build.gradle.kts`, and Linux in
`src/native/linux/VERSION`. Packaging scripts get the version through `scripts/platform-version.mjs` or the artifact's own metadata.
Apple resource preparation rejects Local.xcconfig and command-line overrides; macOS command-line builds are fixed to
arm64 + x86_64, which is checked before packaging.
The preview signing suffix comes from the app's actual signature, not from the identities on the build machine. File name
formats: Windows `WorkFleet-<version>-x64.msix|zip`; macOS `WorkFleet-<version>-macos-universal[-unsigned|-development]`;
iOS preview `WorkFleet-<version>-ios-<unsigned|development|simulator>`; Android `WorkFleet-<version>-android-<variant>`;
Linux keeps the Debian `work-fleet_<version>_all.deb` and `work-fleet-<version>.tar.gz`. Every release file gets a `.sha256`
with the same name next to it.

The same day, the maintainer required the installers of all platforms to sit in one directory level and not be scattered over
random directories. The release location is therefore the root of `build/`: the release files and `.sha256` files of Windows,
Apple, Android and Linux go directly into `build/` and overwrite files with the same name.
Intermediate artifacts use fixed work directories that are emptied on every run (`build/windows/package`,
`build/apple/preview-<platform>`, `build/apple/export-<platform>`, `build/linux/work-fleet-<version>`), replacing the random
directories created on every run before.
Windows and Apple move files into `build/` only after build, signing and notarization have all succeeded. Apple's official
exported IPA and Mac App Store PKG are named by `--method`; after Gradle completes, the Android entry point finds the expected
file name from `versionName` and copies it, and fails if it is not found.

Apple adds a manual GitHub workflow, with official actions pinned to commits, that uses GitHub macOS runners to compile
an unsigned Debug macOS app and the iOS device app and extension, keeping the ZIP/IPA and the builder version.
Jobs are limited to 20 minutes per target and are triggered only manually; no tests run on push. Hosted runners for a private
repository may use billed minutes, so actually starting them needs the maintainer's consent; without a developer account and
signing, the result is only a native preview.

Android packages, from each variant's resolved runtime graph, a dependency inventory with artifact SHA-256 values, the upstream
Maven POMs and the notices inside AARs and JARs, keeping the full Apache-2.0 text. Generated assets use a new
dedicated directory on every run, so outputs of an old variant are not mixed in; a missing POM or license declaration is
recorded as a status, and no license is assumed.
The output contains no local paths of the SDK cache and no credentials; for the final release, the Google SDK terms are still
confirmed against that package's inventory.

## Consequences

### Positive

- Every platform has configurable packaging and signing entry points; public app, Google and publisher settings are kept
  apart from secrets.
- Environments with the SDK can produce previews first, while the official certificates and store accounts stay under the
  maintainer's control.

### Negative

- The Windows runtime is not embedded; the receiving machine needs .NET 8 Desktop and WebView2.
- Having scripts does not mean that platform binaries, signing, Google round trips or store forms are complete; licenses and
  screenshots are completed from the final artifacts.

## 2026-10-06 revision: CI publishes the Windows preview to a GitHub Release

The user wants to download and install directly on another Windows machine, so a manually triggered `windows-preview.yml` is
added: only after build and signing succeed does it create the `windows-v<version>` tag and prerelease. An existing tag is not
overwritten; publishing again requires bumping the version in `Directory.Build.props` first.
- Signing reuses the local preview certificate, whose private key is stored as a PFX in a repository secret. Local and CI
  packages have the same publisher and certificate and can upgrade each other; the installing machine only needs to trust one CER.
- In that job, the runner adds the certificate to its own TrustedPeople so that the existing `-LocalTestSign` verification works
  as before; this changes only the temporary runner, not the user's computer.
- The preview still has no timestamp; when the certificate expires, the signature becomes invalid, and the certificate must be
  replaced and trusted again.
- Official store or Developer signing still goes through `-CertificateThumbprint`/`-TimestampUrl` and Partner Center and is not
  affected by this revision.

## 2026-10-14 revision: macOS GitHub preview uses a DMG and an update ZIP

The maintainer chose to keep using the Developer ID Application certificate and to publish only a DMG + Sparkle update ZIP,
without requiring an extra Developer ID Installer certificate. The packaging entry point adds `--no-pkg`; normal local and store
packaging keep the existing PKG path.
CI imports this project's Developer ID provisioning profile and verifies its Team, App ID, Keychain entitlement, validity and
signing certificate; archive and export both use manual signing with that identity and profile, without relying on the runner
being signed in to Xcode or holding a development certificate.
The archive maps the signing and profile only onto the macOS Release app target, through WorkFleet-specific build settings;
`PROVISIONING_PROFILE_SPECIFIER` is not passed as a command-line override for all targets, which would require the SPM resource
bundles to use the profile.
Notarization uses this project's own Team API key, and Sparkle uses its own update key; the secrets exist only in the OS
keychain, in backups outside the repo and in GitHub secrets.
The App Sandbox and the Keychain data contract are kept; delivery happens only after signing, notarization, stapling and the
Gatekeeper checks have all succeeded.
Completed configuration, flow tests, verification of a real signed app and the GitHub release dispatch are recorded separately;
none of them stands in for the acceptance of another.

The same day, the error where 0.2.2 could not find Sparkle at startup was fixed: the portable project generator explicitly
sets the `@executable_path/../Frameworks` runpath for the macOS Debug and Release app targets. Build and packaging check the
Mach-O dependencies of both architectures; the direct distribution export runs `--check-runtime` before notarization, where
the app reports from its main entry point and exits without creating UI, storage or a login item. Signing and notarization
checks do not replace this load check, and it is not treated as acceptance of Google or the main window.

## Alternatives Considered

Putting signing passwords in `.env` or public JSON: rejected, because public settings are packaged into the app.
Creating and installing trusted certificates ourselves: rejected, because it changes the user's environment and cannot replace
an official signing identity.
Treating the framework-dependent preview as an official five-platform release: rejected, because native environments and
evidence from external accounts are missing.
One shared version file for all platforms: rejected, because each platform must be able to bump its version independently.
Choosing file names by the build machine's architecture or installed certificates: rejected, because the same commit would
produce different file names on different development machines.
Changing the Linux DEB to the `WorkFleet-<version>` format: rejected, because Debian tools and repositories expect
`package_version_arch.deb`.
A new random directory for every packaging run: withdrawn on 2026-10-06, because installers were scattered at different depths
and their paths were unpredictable.
Release files in `build/<platform>/`: not adopted; the DEB had already been placed in the `build/` root, and putting everything
in the root avoids moving it again.

## References

- [Packaging and distribution](../deployment.md), [Store materials](../release/README.md), [Current status](../../PROGRESS.md).
- [Microsoft MakeAppx](https://learn.microsoft.com/en-us/windows/msix/package/create-app-package-with-makeappx-tool).
- [Microsoft packaged desktop manifest](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-manual-conversion).
- [Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).
- [Sparkle framework and runpath settings](https://sparkle-project.org/documentation/).
- [Debian binary package format](https://manpages.debian.org/bookworm/dpkg-dev/deb.5.en.html).
- [Debian control fields](https://www.debian.org/doc/debian-policy/ch-controlfields.html).
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
