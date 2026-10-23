# ADR-044: Desktop in-app updates from public GitHub Releases

## Status

Accepted, 2026-10-14. The user confirmed that the maintainer will make the repo public, that Windows, macOS and Linux
all get in-app upgrades, and that Windows uses MSIX; work started on the same day by the user's instruction. The macOS
installation method (SPEC-006 Q02) and the other questions are still open. Reference and evidence:
[research](../research/2026-10-14-desktop-window-startup-and-update-reference.md).

Revised 2026-10-15: the user reported that Work Fleet's update check was rate-limited while the public release feed
worked from the same machine, and asked for the ADR and the code to change. All three platforms dropped the
unauthenticated GitHub REST API query and use the public Atom feed instead. The API quota of a shared NAT egress cannot
be a precondition for desktop updates; the official rules and measurements are in the
[update-check rate-limit research](../research/2026-10-15-public-release-feed-without-api-quota.md).

Revised 2026-10-23: deleting four releases and tags for every version was too much work, so the maintainer asked for one
release per version carrying every platform, as Cats Desktop does, without breaking the desktop updates. From 0.3.7 the
tag is `v<major>.<minor>.<patch>`; Windows and Linux read their own manifest in that release and macOS its appcast; see
"Feed and downloads" and "Publishing". A release has one tag, so installs of 0.3.6 or earlier, which look only for
`<platform>-v` tags, can never see the new releases: they report up to date until the old releases are deleted or leave
the feed, and an error after that. A last per-platform release built with the new updaters was
offered; the maintainer chose instead to install 0.3.7 by hand once on each desktop machine. The Atom feed lists only the
ten newest releases: four per version showed two or three versions, one per version shows ten.

## Context

The app showed no version and had no update check; users downloaded the MSIX from GitHub themselves and, for the same
version number, had to uninstall first. `host.info` carried no version, and backups always recorded `appVersion` as
0.1.0. Each platform has its own version number (ADR-028); only Windows publishes the MSIX, `.sha256` and CER as
`windows-v<version>` prereleases, while macOS and Linux had only local builds.

The renderer is sealed by the CSP and the native policy and cannot reach the network; native HTTP allows only fixed
Google endpoints and refuses redirects. GitHub becomes a new network destination, so the privacy text needs an update.
The reference project's electron-updater, `latest.yml`, NSIS and Squirrel.Mac cannot be used with WPF/AppKit/GTK, but
its state machine, capability gates and lessons from failures can be reused.
GitHub's `releases/latest` is the newest release of the whole repo, cannot tell platforms apart, and excludes
prereleases. The public `releases.atom` can include each platform's published preview tags, and the host picks by tag
prefix and numeric version, with no REST API.

## Decision

### States and interface

- Each native host owns its own updater and follows the same states and bridge contract:
  unavailable, idle, checking, up_to_date, update_available, downloading, downloaded, installing, failed.
  The snapshot holds the current version, the available version, a plain-text summary (at most 500 characters), the
  last check time, download progress, an error code and nextAction.
- Only one check or download runs at a time; repeated requests join the running job. A download re-checks first; a
  downloaded version is kept only if it is still the newest, otherwise it is downloaded again.
  Only lastCheckedAt is persisted (`host-preferences.json`, ADR-043); every other state returns to idle on each start.
- Errors use stable codes with user-facing text (offline, timeout, rate_limited, provider_rejected,
  metadata_invalid, checksum_mismatch, signature_rejected, identity_mismatch, authorization_cancelled, install_failed,
  unknown); raw responses never reach the UI. Since [ADR-056](056-english-first-ui-and-locale-catalogs.md) that text
  follows the display language (it was Traditional Chinese only before).
- Settings > Desktop, "Version and updates" (on Settings > General since 2026-10-24,
  [ADR-059](059-settings-pages-and-entry-points.md)), shows the version, channel (preview), state, summary, last check and a
  single primary button chosen by nextAction: Check for updates, Download update, Restart and install. Without update
  capability it shows only the version and the reason.
- On Windows, macOS and Linux, the tray gains "Check for updates…" when updates are possible. The native host handles
  it directly, not through `desktop-action`.
  A click always checks again, then answers in a native dialog: up to date, a new version (version, summary, "Update
  and restart"/"Later") or an error. On macOS the dialog activates the app first so it does not open behind other
  windows. Download progress shows in the tray tooltip. The tray update dialog is untested (2026-10-14).
- This batch has no automatic check, periodic check or skip-this-version; whether to add them is a SPEC-006 question.

### Capability gates

- The update source is in the `update` section of `Config/public.json`, which every platform ships: `repository`
  (`owner/repo`, `WORK_FLEET_UPDATE_REPOSITORY`, default this repo) and `channel` (currently only `preview`). When
  invalid, only the version is shown.
- Only installation forms that can upgrade in place have update capability: Windows MSIX, a macOS app signed with
  Developer ID and notarized, and Linux installed from the DEB. Windows ZIP/Debug, unsigned macOS, tar.gz and running
  from source show only the version and a link to the Releases page.
- A local preview package built with the same identity can also check and update; the settings page shows the source.
- Test source: only when the package identity starts with `app.workfleet.updateprobe.` can `update-probe.txt` in the
  data directory point to a local folder instead of GitHub, and then the app downloads and installs automatically after
  start. Release code contains this check, but production identities always ignore it. The Debug configuration is not
  used because the install must be a signed MSIX.

### Feed and downloads

- Query `https://github.com/<repository>/releases.atom` without credentials or cookies, never falling back to the REST
  API; the query refuses redirects.
  Atom lists only published releases (no drafts), and the preview channel includes prereleases. Only direct
  entry/alternate links in the Atom namespace are read; a link must be an HTTPS release page of the configured repo,
  and the tag must match `v<major>.<minor>.<patch>` (until 2026-10-23 `<platform>-v<major>.<minor>.<patch>`; those older
  tags are ignored).
  The highest version in the feed that is greater than the current version wins, regardless of publication order. The
  XML is capped at 2 MiB, and DTDs/external entities are refused.
  Atom has no reliable prerelease field, so only the approved preview channel is supported; other channels are refused,
  and there is no claim that preview versions can be excluded.
  The feed is a limited list of recent releases; a non-empty feed without any `v<version>` release reports insufficient
  source information and must not falsely report up to date.
- The update metadata URL is built from the configured repo and the verified tag:
  `https://github.com/<repository>/releases/download/<tag>/work-fleet-update-<platform>.json`, and `appcast.xml` for
  macOS. The repo-wide `releases/latest` is not used, and assets of old releases never need updating.
- 429, or 403 with `Retry-After`, maps to rate_limited; a plain 403 is provider_rejected, so not every source refusal
  is misreported as an exhausted quota.
- Each release carries `work-fleet-update-windows.json`, `work-fleet-update-linux.json` and
  `work-fleet-update-macos.json` (one `work-fleet-update.json` per platform release until 2026-10-23): `schemaVersion`,
  `platform`, `version`, `tag`, `summary`,
  and for each installer its `arch`, `name`, `size` and `sha256`. A mismatch with the tag or platform rejects the whole
  version.
  Installer URLs are likewise built from repo/tag/manifest file name; the file name must be a single-level ASCII file
  name, with no path, URL, query or fragment.
  Atom does not carry the API's asset size; the manifest records the expected size, the downloaded bytes must match it,
  and then SHA-256 and the package identity are verified.
- Downloads use HTTPS only and send no credentials or cookies. Only a limited number of redirects to the GitHub release
  asset host are allowed (the host list to be confirmed by measurement during implementation); this is a narrow
  exception for update downloads, and the Google HTTP rules are unchanged. The size must equal the manifest and is
  capped; SHA-256 is computed while downloading, and a mismatch deletes the file.
- Downloads go to `updates/` in the data directory and are removed after a successful install, when the version is
  superseded, or when a check finds the app up to date.
- A real read-only check on 2026-10-15: the Python updater found `windows-v0.2.3` and its manifest with two requests
  and zero REST API calls, and the C# `UpdateFeed` parsed the same responses; the MSIX itself was not downloaded.

### Installation per platform

- **Windows (MSIX)**: first read the AppxManifest from the MSIX and check Name, Publisher, architecture and a higher
  version. After the user presses "Restart and install", the app takes the existing save-and-exit path: save drafts,
  take down the scenes and restore Explorer, close the data and release `owner.lock`.
  It then installs with `PackageManager.AddPackageAsync` and `ForceApplicationShutdown`, and uses
  `RegisterApplicationRestart` to reopen after the update. Updating its own package does not need the restricted
  `packageManagement` capability (measured with a test identity on 2026-10-14). Windows reopens only a process that
  has run for at least 60 seconds. `Test-WindowsUpdate.ps1` finishes within 60 s, so that reopen is unverified
  (2026-10-14).
  Windows checks the signature and trust, using the same certificate as the existing preview packages. If the install
  fails, the app reopens and shows the error; drafts were saved first.
  The `ms-appinstaller` protocol, disabled by default, is not used. A changed Publisher (a production certificate or the
  Store) cannot update in place and is handled separately.
  No in-app update on Windows from one real GitHub release to the next is recorded; `Test-WindowsUpdate.ps1` covers the
  path with test identities only (as of 2026-10-17).
- **macOS**: Sparkle 2.10.0 (MIT, chosen by the user on 2026-10-14) downloads, verifies, replaces and reopens, using
  Sparkle's standard dialogs (`SPUStandardUpdaterController`, including Traditional Chinese). A custom user driver was
  considered, but its roughly 15 protocol methods could not be verified without a Mac, and the standard interface is
  also what users of the reference project know. "Check for updates" in Settings and the menu bar first finds the
  newest `v<version>` release by the same rules, then hands that release's `appcast.xml` to Sparkle
  (`feedURLString(for:)`) and checks; when no release is newer it answers up to date directly.
  Sparkle compares the appcast's `sparkle:version` with `CFBundleVersion` (`CURRENT_PROJECT_VERSION`), and the
  packaging script writes both version numbers.
  Updates need a Sparkle EdDSA signature (public key `WORK_FLEET_SPARKLE_PUBLIC_KEY` in Info.plist `SUPublicEDKey`) and
  a Developer ID notarized build with the same Team ID; without the public key or a Developer ID signature, only the
  version is shown. The app keeps the sandbox (the user's choice on 2026-10-14), and following Sparkle's sandbox notes
  adds `SUEnableInstallerLauncherService` and `-spks`/`-spki` mach-lookup temporary exceptions; it already has
  network.client, so the downloader service is not enabled.
  Automatic checks and automatic updates are off (Q01). During install Sparkle quits the app through the existing
  save-and-exit path. A future Mac App Store build must not contain Sparkle; a build without Sparkle will be split off
  at store submission (the user agreed). Third-party licenses go into THIRD-PARTY-NOTICES.
  A Sparkle update between two Developer ID notarized macOS versions is not recorded (as of 2026-10-17).
- **Linux (DEB)**: read the package with `dpkg-deb` and check the package name, architecture (`all` or the local
  architecture) and a higher version, then install while the app runs with `pkexec apt-get install -y <local DEB>`, so
  apt adds any new system dependencies; without apt-get, use `pkexec dpkg -i`.
  On success it saves and closes the data, then uses ADR-040's `host.restart` to run the new version. If authorization
  is cancelled, the app keeps running and shows authorization_cancelled.
  It does not restart in a way that brings in NoNewPrivs.
  On the Raspberry Pi, the in-app DEB update to 0.2.7 installed through pkexec and restarted the app (observed
  2026-10-17).

### Publishing

- One GitHub Release per version, tagged `v<version>`, carries every platform: each desktop installer with its
  `.sha256` and manifest, the macOS `appcast.xml`, and the Android APK. `preview-release.yml` builds the four platforms
  side by side and publishes only after `scripts/validate-release-assets.mjs` has checked every file, so a desktop
  client that finds a release always finds its manifest or appcast in it. A release needs all four version records to
  agree, so no platform is released alone.
  Until 2026-10-23 each platform had its own release tagged `<platform>-v<version>` from its own workflow.
- Version bumps and Actions dispatches still need the user's explicit authorization, and no commits may follow a
  publication (AGENTS.md).

### Privacy and security documents

- The GitHub public Atom feed and the release asset host are listed as network destinations, contacted only when the
  user checks or downloads; the User-Agent carries only the app name and version.
- Update `docs/release/privacy.zh-TW.md`, `docs/release/submission-data.json` and `docs/security-guidelines.md`;
  GitHub is not used for tracking, so no tracking domains need adding to `PrivacyInfo.xcprivacy`.

## Consequences

### Positive

- On all three desktop platforms the app shows its version, checks and upgrades in place, and Windows keeps the MSIX
  data and signing model.
- No token is involved; every decision is made in the native host, and the renderer still cannot reach the network.
- States and errors are consistent, so the tray and the settings page never give contradicting results.
- The unauthenticated REST API allowance of 60 requests per hour per egress IP is not consumed, so a company's shared
  NAT cannot block update checks.

### Negative

- The updater is implemented in three languages, which need shared fixtures to test the same feed/manifest rules.
- macOS depends on Developer ID, notarization, Sparkle keys and a new publishing workflow; Linux needs the user to
  authorize the install.
- Atom is a list of recent releases and has no reliable prerelease field. A stable channel (Q04) and long-term
  per-platform updates beyond the feed's range need a separate index; for now unsupported channels are refused, and an
  unlisted platform keeps the insufficient-source error. The public web page can still be refused or rate-limited by
  GitHub for a while, so there is no claim of unlimited access.
- SHA-256 and the manifest come from the same release, so they only protect against corruption and replacement of a
  single file, not against a compromised GitHub account; Windows and macOS add operating system signature checks, and
  the Linux DEB has none.

### Neutral

- Once the repo is public, anyone can download the installers and the CER. Store builds are updated by the store, and
  this updater is disabled there.

## Alternatives Considered

### Alternative 1: Windows App Installer (`.appinstaller`)

- **Pros**: Native to Windows, and can be set to check automatically on launch.
- **Cons**: Needs a fixed public `.appinstaller` location; App Installer handles the update, so drafts cannot be saved
  and Explorer restored first, and the flow cannot be shared with the other platforms.
- **Why rejected**: The in-app flow keeps data safe; background updates can be evaluated later if needed.

### Alternative 2: Use `releases/latest` or the Atom feed (revised 2026-10-15)

- **Pros**: No API quota is used.
- **Cons**: `releases/latest` is shared across platforms and excludes previews; Atom is a recent list without a
  reliable prerelease field, and needs strict XML and source validation.
- **Decision**: Use Atom, not `releases/latest`. The earlier reason for rejecting Atom, independent per-platform
  version numbers, does not hold, because the host can filter tags itself.
  The unauthenticated REST API shares 60 requests per hour per source IP, and limiting it to manual checks cannot solve
  the company NAT problem, so the API approach was removed.

### Alternative 3: Private repo with a user token

- **Pros**: The repo can stay private.
- **Cons**: A GitHub token must be stored on the client, and API limits apply.
- **Why rejected**: The maintainer chose to make the repo public.

### Alternative 4: A signed Linux APT repository

- **Pros**: The system updater handles it, and packages carry GPG signatures.
- **Cons**: Needs a separately maintained repository and keys.
- **Why rejected**: This batch does in-app DEB updates first; a repository stays a later option.

### Alternative 5: A home-made replacement program on macOS

- **Pros**: No third-party dependency.
- **Cons**: Replacing a running app, permissions, quarantine attributes and signature verification would all be
  handled by hand, with high risk.
- **Why rejected**: Sparkle 2 is the mature approach; the user chose Sparkle on 2026-10-14 (SPEC-006 Q02).

## References

- [SPEC-006](../specs/006-desktop-window-startup-and-updates.md), [PLAN-006](../plans/006-desktop-window-startup-and-updates.md), [research](../research/2026-10-14-desktop-window-startup-and-update-reference.md)
- [ADR-028](028-native-package-and-signing-entry-points.md), [ADR-032](032-windows-debug-webview-inspection.md), [ADR-037](037-msix-data-lifetime-and-google-backup-overwrite.md), [ADR-040](040-gnome-wayland-xwayland-choice.md), [ADR-043](043-desktop-window-placement-and-startup-behavior.md)
- [GitHub REST releases](https://docs.github.com/en/rest/releases/releases), [PackageManager.AddPackageAsync](https://learn.microsoft.com/en-us/uwp/api/windows.management.deployment.packagemanager.addpackageasync), [Sparkle](https://sparkle-project.org/documentation/)

---

*Decision made: 2026-10-14*
*Decision makers: Maintainer*
