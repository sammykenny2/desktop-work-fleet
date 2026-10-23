# Store Submission Preparation

This folder holds the submission copy and data lists. The project-level state of accounts, signing and store
preparation is in the root [PROGRESS.md](../../PROGRESS.md); packaging and release procedure is in
[deployment](../deployment.md); build and dispatch results are in the GitHub Releases and workflow runs, not here.

- [Traditional Chinese listing](store-listing.zh-TW.json), [English listing](store-listing.en-US.json): name, short
  description and full description.
- Privacy policy, [English](privacy.md) and [Traditional Chinese](privacy.zh-TW.md): published with the maintainer's
  actual details; the public URL is set in `.env`.
- [Submission data list](submission-data.json): data uses, external settings and screenshot scenes.

Store listings and the privacy policy keep an English and a Traditional Chinese edition. GitHub release text is English
only: the version's entry in [release notes](../release-notes.md) plus the installation steps that the release
workflow adds, as described in [deployment](../deployment.md#preview-releases).

The app ID, Google clients, Apple team, privacy and support URLs and contact email in `.env.example` are public
settings. Signing keystores, certificates, store API keys, OAuth tokens and passwords never go into the repo or a public
configuration file.
`node scripts/check-config.mjs --platform <platform>` prints `<platform>: missing A, B` with the missing public settings
and exits with status 1; when nothing is missing it prints
`<platform>: public settings complete; a real sign-in, signing and platform acceptance still needed`.

Without signing inputs, the Android `bundleRelease` produces an unsigned AAB.
`Build-AndroidApp.ps1 -Signed` or `build-android-app.sh --signed` requires the following process or CI environment
variables and signs the release AAB with the upload key, for Play App Signing to receive:

- `WORK_FLEET_ANDROID_KEYSTORE`: absolute path of the existing keystore.
- `WORK_FLEET_ANDROID_KEY_ALIAS`: upload key alias.
- `WORK_FLEET_ANDROID_STORE_PASSWORD`, `WORK_FLEET_ANDROID_KEY_PASSWORD`: provided by the CI secret environment.

All four must be provided together; they must not be written into `.env`, public JSON or command-line arguments. The
script does not create keys, sign in to a store or upload anything.
The SHA-1 of the Google Android OAuth client must match the actual distribution signature; debug and Play signing are
configured separately. The Google Web client is used as the Credential Manager audience and belongs to the same Google
Cloud project.
Formal submissions use screenshots of the actual native packages; browser screenshots or design drafts do not stand in
as native evidence.

The Windows package identity and publisher are set in `.env.example`; signing uses an existing CurrentUser/My
certificate. The Apple export / PKG / DMG and Keychain-profile notarization entry points are in the
[distribution document](../deployment.md).
Accounts, certificates and real native screenshots for each platform are not done just because the scripts exist; their
current state is in [PROGRESS](../../PROGRESS.md). As of 2026-10-17, no store developer accounts are set up, the privacy
page is not published, there are no native screenshots, Partner Center has no reserved app and nothing has been
submitted; the store listings and privacy text are drafts.

For each Android variant, the actual resolved runtime versions, hashes and POMs and the SDK notices are saved with the
package in `assets/licenses/native/inventory.json` and the files in the same folder. An item without a notice keeps its
metadata status; no licence is inferred automatically. The formal release AAB uses its own inventory; the debug
inventory describes only debug artifacts.

Fill in the store forms from the final native packages and the SDK data list; this folder does not claim that any form
was submitted or approved.
