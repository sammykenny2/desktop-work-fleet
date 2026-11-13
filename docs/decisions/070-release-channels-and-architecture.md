# ADR-070: Release channels, installers and architecture

## Status

Accepted policy and working defaults, 2026-11-13; implementation and installed-package acceptance are pending under
[SPEC-013](../specs/013-product-identity-and-distribution.md) and
[PLAN-014](../plans/014-product-identity-and-distribution.md).
Supersedes the public Windows ZIP/CER and Android Debug distribution choices in
[ADR-028](028-native-package-and-signing-entry-points.md) and
[ADR-055](055-mobile-device-build-workflows.md). Other packaging and updater contracts remain in force.

## Context

The maintainer wants real feedback through Google Play closed testing and iOS TestFlight before launch, and trusted
Windows signing. Current account and certificate readiness is recorded in [PROGRESS](../../PROGRESS.md).
Existing build scripts are not evidence that all delivery paths meet production distribution requirements.
In particular, the Android workflow builds Debug APKs, the Windows release
contract includes a preview CER, and Windows packaging and update selection assume x64.

## Decision

### Build and signing policy

- Every app delivered through GitHub Releases, public download links, Play test/production tracks, TestFlight or stores
  uses its platform's Release configuration. A preview or beta describes a delivery channel, not a Debug build.
  Test signing and Release configuration are separate checks; external testing uses the signing appropriate to its
  channel, not the Android debug key or Apple development-device distribution.
- Debug remains available for local development and isolated CI probes. Those outputs must not enter a distribution
  asset set. Release symbols and ordinary diagnostic logs do not turn a Release build into Debug.
- Inspect actual artifacts and resolved configuration: Android must not be debuggable, Apple distribution entitlements
  must not enable `get-task-allow`, and Windows Release must exclude development inspection features. Linux's
  Python/JavaScript host has no equivalent binary build variant; verify packaged production settings and resources.
- Future GitHub Releases must not attach `.cer` files or instruct users to install a preview certificate as a trust
  prerequisite. This does not prohibit private developer certificate management or alter historical releases.

### Distribution targets

| Platform | Primary delivery | Architecture and update policy |
|---|---|---|
| Windows direct download | Trusted, signed MSIX; use an MSIX bundle when both architectures are ready | Separate native x64 and ARM64 payloads; bundle selects the appropriate one; adapt the updater and validation together |
| macOS direct download | Signed and notarized DMG, with an Applications shortcut | Keep Universal arm64 + x86_64; retain the signed ZIP and appcast for Sparkle updates |
| Linux initial delivery | DEB for the supported Debian/Ubuntu-family environments | Keep `Architecture: all` while the package contains architecture-independent Python/assets and system-provided native dependencies; keep the existing DEB updater |
| Linux later supplement | AppImage after full integration and compatibility acceptance | Build per CPU architecture when bundling native runtimes; provide its own update and desktop/startup integration |
| Android | Signed Release AAB through Google Play testing and production | Validate actual supported ABIs and Play delivery; any separately offered APK must also be signed Release |
| iOS | Release archive through TestFlight, then App Store | Verify on supported real devices; registered-device development IPAs remain local development tooling |

Windows ARM64 is required future work, not existing support. Windows has no direct equivalent of a Universal Mach-O
executable: an MSIX bundle groups separately built packages. x64 emulation does not establish native ARM64 acceptance.
MSIX bundle installation, architecture selection and subsequent updates require their own installed-device checks.

Use the issued Certum certificate for direct Windows distribution only after verifying its intended signing use,
trusted chain, timestamping, supported signing tooling and the package Publisher match. A future Store package uses
the identity and signing required by that store. Certificate payment is not evidence of completed signing.

Pause public Windows unpackaged ZIP delivery. The current ZIP stores data in the user's app-data directory rather
than beside the executable, and its startup/update capabilities are limited; it is not a complete portable product.
Keep local packaging useful for development. NSIS is deferred: adding it would need an unpackaged install, uninstall,
startup and update lifecycle, not just another output extension.

### Linux installation and updates

Keep DEB as the initial supported installer; do not replace it with AppImage. DEB manages the app's distribution
dependencies and integrates with the desktop. The existing updater downloads a verified DEB and invokes the system
installer; a downloaded DEB does not by itself configure an APT repository.

AppImage is a later cross-distribution supplement, not a guaranteed install-free or dependency-free experience.
It needs a compatible bundled Python/GI/GTK/WebKitGTK runtime, supported distribution baselines, executable/runtime
requirements, menu integration and a stable path for startup. Never persist a temporary AppImage mount path as the
startup command. Its update action must replace the AppImage safely using a verified update mechanism, such as
AppImageUpdate, rather than invoke the DEB installer. No download option should expose a broken startup/update action.
Flatpak, RPM and an APT repository are not selected by this decision.

### macOS installation and updates

Keep DMG as the normal first-install download for this self-contained app. Do not change to PKG solely to obtain a
double-click installer: PKG opens an installation wizard and may require administrator authorization.

First-install packaging is separate from updater packaging. A PKG that installs the same signed app in Applications
could still use the existing Sparkle ZIP/appcast path; Sparkle also supports installer-package updates when configured
for them. The local script already supports PKG, while CI selects `--dmg --no-pkg`. Offering PKG would require a
Developer ID Installer certificate, package signing/notarization and asset-validation changes. Keep the ZIP update
payload when changing only the first-install container; do not substitute a PKG URL into the current feed unchanged.

### Beta feedback and store preparation

- Run a Google Play closed test targeting **20 real testers** and collect actual feedback. This is the project's
  chosen target. Google's current minimum for applicable personal accounts created after 2023-11-13 is 12 testers
  continuously opted in for 14 days before applying for production access; completing the period is not approval.
  Recheck the account's Play Console requirements when scheduling the test.
- Run iOS TestFlight testing, including the review required for external testing, and collect feedback from real use.
  Use App Store Connect distribution rather than public development IPAs containing registered device identifiers.
  This supplements [ADR-057](057-local-ios-builds-and-device-privacy.md); it does not move local development IPAs to CI.
- Before external testing, evaluate format freezing and supported backup compatibility under
  [SPEC-007](../specs/007-schema-evolution-and-migrations.md). Existing formats remain V1 until that review makes a
  specific decision; this plan does not approve schema bumps, migration jobs or automatic data deletion.
- A release, version bump, store submission, credential upload or workflow dispatch still needs the applicable
  authorization. Documentation approval alone does not perform those actions.

## Consequences

### Positive

- Installation and update capabilities match the download offered to users.
- Beta feedback exercises the same Release behavior intended for production.

### Negative

- Android distribution, certificate handling and Windows ARM64 need implementation before meeting this policy.
- AppImage introduces another runtime and update lifecycle to maintain; Universal macOS still needs Intel acceptance.

### Neutral

- Current scripts and old assets retain their existing behavior until the planned changes land; they are not newly
  certified by this record. The current procedure and gaps are identified in [deployment](../deployment.md).

## Alternatives Considered

- AppImage as the only Linux format: loses the existing native package lifecycle before its replacement is ready.
- PKG as the default macOS download: feasible, but unnecessary for the present single-app installation.
- Public Windows ZIP and NSIS immediately: deferred until their product lifecycle is explicitly supported.
- A Debug build labeled beta: rejected; build configuration and delivery channel serve different purposes.

## References

- [Dated primary-source evidence and limits](../research/2026-11-13-product-identity-and-distribution-boundaries.md).
- [ADR-044: updater contract](044-desktop-in-app-updates-from-github-releases.md).
- [Microsoft MSIX signing](https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview),
  [MSIX bundles](https://learn.microsoft.com/en-us/windows/msix/package/bundling-overview).
- [Sparkle distribution and updates](https://sparkle-project.org/documentation/),
  [Apple Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/).
- [Debian architecture fields](https://www.debian.org/doc/debian-policy/ch-controlfields.html),
  [Running AppImages](https://docs.appimage.org/user-guide/run-appimages.html),
  [AppImage updates](https://docs.appimage.org/packaging-guide/optional/updates.html).
- [Google Play test requirements](https://support.google.com/googleplay/android-developer/answer/14151465),
  [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

---

*Decision made: 2026-11-13*
*Decision maker: Project maintainer*
