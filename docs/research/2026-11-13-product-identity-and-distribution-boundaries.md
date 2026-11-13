# Product identity and distribution boundaries

Primary documentation checked: 2026-11-13. This is evidence and its limits; accepted choices are in
[ADR-069](../decisions/069-pin-it-anywhere-product-identity.md) and
[ADR-070](../decisions/070-release-channels-and-architecture.md), with acceptance in
[SPEC-013](../specs/013-product-identity-and-distribution.md).

## Google identity and data access

- [Cloud project identifiers](https://cloud.google.com/resource-manager/docs/creating-managing-projects): the display
  name is editable; a project ID is globally unique and permanent after creation, including restrictions on reusing
  previously used IDs. No availability check or project creation was performed for the selected ID.
- [OAuth branding](https://support.google.com/cloud/answer/15549049): branding controls the name, logo and contacts
  users see; changes can involve verification. Inference: a display-name change and a client replacement are distinct
  operations, so a cosmetic rename alone is not grounds for proactively invalidating existing credentials. No live
  token-survival test or authenticated branding change was performed.
- [Drive app data](https://developers.google.com/workspace/drive/api/guides/appdata): appDataFolder is private to the
  creating app and cannot be shared or moved between Drive spaces. This supports requiring an export/restore route;
  it does not prove cross-project continuity for this app. Old/new client access must be measured with a test account.

## Installer and updater boundaries

- [Sparkle](https://sparkle-project.org/documentation/) recommends a signed, notarized DMG with an Applications
  shortcut and supports ZIP, DMG and installer-package update payloads. Inference: changing only the first-install
  container need not change the existing ZIP update path for the same app; an installed old-to-new update is still
  required evidence.
- [Apple Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
  distinguish Application signing from Installer package signing. Existing Application signing does not establish
  that a PKG can be signed without an Installer identity.
- [AppImage execution](https://docs.appimage.org/user-guide/run-appimages.html) requires an executable image and treats
  desktop integration separately. [AppImage updates](https://docs.appimage.org/packaging-guide/optional/updates.html)
  require update information and an external/bundled updater or integrated library. No AppImage was built or tested.
- [MSIX bundles](https://learn.microsoft.com/en-us/windows/msix/package/bundling-overview) group architecture-specific
  packages; they are not one Universal executable. [MSIX signing](https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview)
  requires trusted signing and matching package publisher identity. Neither source proves readiness of the pending
  Certum issuance or compatibility of its eventual signing tooling with this project.

## Beta policy

- [Google Play account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465):
  applicable new personal accounts require 12 continuously opted-in testers for 14 days before applying for production
  access. This is separate from the maintainer's larger chosen tester target; recheck the actual account when testing.
- [TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/) provides
  beta distribution and feedback, with review for external testing. No upload, invitation or store submission was made.

## Repository inspection limits

Inspection found the boundaries that PLAN-014 must change: Android's Debug workflow; the Windows CER asset contract
and x64 updater selection; Linux's DEB-only update gate and architecture-independent package; macOS's existing PKG
script branch, CI `--no-pkg` selection and separate Sparkle ZIP/appcast generation. See
[deployment](../deployment.md) for current procedure and [testing](../testing.md) for acceptance routing.
Source inspection is not evidence of a real ARM64 install, AppImage startup/update, new-identity restore or mobile beta.
