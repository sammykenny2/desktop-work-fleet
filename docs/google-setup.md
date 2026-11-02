# Google sign-in and Drive setup

The native hosts on all five platforms contain the sign-in, account workspace and Drive appDataFolder sync code.
The browser development preview has local data only and offers no Google sign-in.
On 2026-10-06 the Google Cloud project (consent screen in Testing) and the Desktop client shared by Windows and Linux
were created;
real Windows sign-in and Drive upload (including a resumable chunked upload of a 1.9 MB attachment) were accepted.
On 2026-10-17 the iOS, Android and Web clients were created and stored, together with the existing macOS client, in the
GitHub repository variables.
Phone previews currently use `app.workfleet.preview`; the Android client matches the debug signature of the maintainer's
Mac, and other signatures must be registered separately.
As of 2026-10-17, phone sign-in is verified only by native compilation and mock-SDK authorization probes, which do not
mean real sign-in or cross-device download is accepted: real accounts, Drive round trips, process death and
cross-device sync on phones are not verified. Current status is in [PROGRESS](../PROGRESS.md),
and verification procedures and evidence are in [testing](testing.md) and the git history.

## Create the Google Cloud configuration

1. Create one project in the [Google Cloud Console](https://console.cloud.google.com/); all five platforms use this
   project.
2. Enable the **Google Drive API**.
3. In Google Auth Platform, set the app name, support email, Audience and public privacy policy URL.
   During development use Testing, and add the Google accounts that will sign in as test users.
   As of 2026-10-17 the consent screen is still in Testing. According to Google's documentation, refresh tokens issued in
   Testing expire after 7 days; publishing the app to production removes that limit.
4. Data Access uses `openid`, `email` and `https://www.googleapis.com/auth/drive.appdata`.
   Read and write access to the whole Drive is not needed. The name and photo in the sidebar come from Drive's
   account information under the app data scope, so no `profile` scope is needed.
5. Create the OAuth clients from the table below; put the client IDs in the root `.env`, then rebuild the app.
   All platforms must use the same project to reach the same app data space.

| Platform | OAuth client type and registration | `.env` field |
|---|---|---|
| Windows | Desktop app; the program inside the MSIX is also a desktop app and uses the system browser with a loopback callback | `WORK_FLEET_GOOGLE_WINDOWS_CLIENT_ID`, `WORK_FLEET_GOOGLE_WINDOWS_CLIENT_SECRET` |
| Linux | Desktop app; it can share the Windows Desktop client (enter the same ID and secret) | `WORK_FLEET_GOOGLE_LINUX_CLIENT_ID`, `WORK_FLEET_GOOGLE_LINUX_CLIENT_SECRET` |
| macOS | iOS-type client; the bundle ID is the `WORK_FLEET_APP_ID` of the current build | `WORK_FLEET_GOOGLE_MACOS_CLIENT_ID` |
| iOS | iOS-type client; the bundle ID is the `WORK_FLEET_APP_ID` of the current build | `WORK_FLEET_GOOGLE_IOS_CLIENT_ID` |
| Android | Android client; the package is the `WORK_FLEET_APP_ID` of the current build, registered with the actual signing certificate's SHA-1 | `WORK_FLEET_GOOGLE_ANDROID_CLIENT_ID` |
| Android sign-in audience | A separate Web application client in the same project; only its public ID is used, and there is no own sign-in server | `WORK_FLEET_GOOGLE_WEB_CLIENT_ID` |

The certificates for the local Android debug build, the upload key and Google Play App Signing can differ,
so register an Android client for each package/SHA-1 combination actually in use.
A version installed from Play uses the Play Console **app signing certificate**; registering only the upload key is not
enough.
Until the final App ID is chosen, the preview package/bundle ID is `app.workfleet.preview`.
The Apple callback scheme is generated from the client ID by the generator script; Info.plist needs no manual edit.
Sign-in can be verified with the current preview identity first, without waiting for the Play Console or a store
listing.
When the final package/bundle ID replaces it, create the matching clients in the same Google Cloud project and rebuild;
the OS treats the new identifier as a different app, so local data must be moved separately with a backup.

The Android Web client is Credential Manager's `serverClientId` and the ID token audience:
account selection uses the public Web Client ID, then AuthorizationClient obtains Drive access and the stable sub is
checked against Google userinfo.
This flow has no own sign-in backend; the Web client's JavaScript origins and redirect URIs can stay empty, and its
Client Secret is not used.

macOS fields in Google Auth Platform > Clients > Create client:

| Field | Setting |
|---|---|
| Application type | iOS, for Google's Apple SDK |
| Name | for example `Work Fleet macOS`, only for identification in the console |
| Bundle ID | the same as `WORK_FLEET_APP_ID`; currently `app.workfleet.preview` for previews |
| App Store ID | leave empty for GitHub previews; after a store listing, enter the numeric ID from the App Store URL |
| Apple Team ID | optional; with an Apple team, enter the value of `WORK_FLEET_APPLE_TEAM_ID`, and use the same value when iOS and macOS share the team |
| Firebase App Check | this project has not configured that check, so keep it off when creating the client; turning it on requires a Team ID |
| Use this client for an AI-powered agent | leave unchecked; this client is for the app's Google sign-in and Drive sync |

After creating it, set the public Client ID as `WORK_FLEET_GOOGLE_MACOS_CLIENT_ID`; GitHub Actions uses the repository
variable of the same name.
The field definitions are in [Google native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app),
and the AI client declaration in [Manage OAuth Clients](https://support.google.com/cloud/answer/15549257?hl=en).

The authorization flow follows [Google installed-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app),
[Google Sign-In setup for Apple](https://developers.google.com/identity/sign-in/ios/start-integrating)
and [Google sign-in setup for Android](https://developer.android.com/identity/sign-in/credential-manager-siwg).
Windows and Linux use PKCE; Apple uses the Google Sign-In SDK; Android uses Credential Manager
for account selection, then AuthorizationClient for Drive authorization.

## Fill in the settings and build

Copy [.env.example](../.env.example) to `.env` and fill in `WORK_FLEET_GOOGLE_PROJECT_ID`
and the clients of the platforms to build. `.env` is ignored by Git; values of the same name from the shell or CI take
precedence.
If only Windows and Linux sign-in is needed, no client is needed for the other platforms.
The Apple and Android `WORK_FLEET_APP_ID` must match that Cloud registration; for now the preview identity is used.
GitHub Variables reach only the Actions that reference them; local Xcode and Gradle do not download them,
so the public client IDs and the project ID must still be entered in the Git-ignored `.env` locally. The Web Client
Secret does not go into `.env`.

```bash
# List missing public Google settings per platform, separately from store and signing settings.
npm run config:check -- --google
# Returns a non-zero status when a single platform has missing fields; suitable before a build.
npm run config:check -- --google --platform windows
```

A Client ID is a public identifier. A Desktop client also needs a client secret: Google's token endpoint returns
`client_secret is missing` even with PKCE, and Google treats an installed app's secret as non-confidential, so it ships
with the Windows and Linux apps. Windows and Linux send this optional client secret for both the code exchange and the
token refresh (2026-10-06).
The build writes it only into that platform's `Config/public.json` next to the app, not into the UI assets and not into
the Android or Apple packages.
Google does not show the full secret again later, so download the JSON when creating the Desktop client and keep it.
The program asks for no Web client secret, service-account JSON or sign-in token.
Access and refresh tokens are managed by native secure storage or the Google SDK; they are never written to `.env` or
handed to the renderer.
A build with empty values shows no sign-in button (the "Google account" row reads "This version can't sign in yet") and
still supports note-taking and backups.
`config:check` can only tell whether the public fields are filled in; it cannot prove that the API is enabled, that the
signature matches or that the account is authorized.

Rebuild entry points are in [Setup](setup-guide.md). On a real Mac:

```bash
npm ci --ignore-scripts
bash scripts/macos/build-native-app.sh --platform macos
bash scripts/macos/build-native-app.sh --platform ios --simulator
```

The maintainer handles Apple builds on a Mac; no hosted Actions run is needed.

## Account and data operations

- Account settings are in Settings → Account and sync; clicking the account area at the bottom left of the sidebar, or the
  account card at the top of the Settings pages, opens that page directly. It shows the current account, the "Sync" row, and the "Google account" row with "Sign in",
  "Switch account" and "Sign out".
- Press "Sign in" in the "Google account" row; after granting identity and app data access, that Google account's own
  workspace opens.
  Existing local notes are not uploaded automatically; to move them, export a backup first, then import it in the Google
  workspace.
- App data is in the hidden appDataFolder and does not appear in the normal Drive file list.
- A signed-in workspace tries to sync every 20 seconds, also while the main window is in the tray or menu bar, and
  again as soon as the main window shows. "Sync now" in Account and sync syncs immediately. Offline or after a failure,
  local data and pending changes are kept.
- When "Sign in to Google again" appears, re-authorize with the original account; choosing another account opens a
  different workspace.
- "Switch" in the "Local notes" row returns to the local workspace; "Sign out" removes only this device's account
  credentials, and other devices stay signed in.
  Both keep the original account's local notes, drafts and pending changes.
  To remove access from every device, remove Work Fleet under "Third-party apps & services" in the Google Account.
  Versions up to and including 0.2.3 revoke the grant on sign-out, and the account's other devices then ask to sign in
  again within about an hour, because their tokens become invalid. Do not sign out on such builds; a device that lost
  access only needs to sign in again ("Sign in to Google again"), which does not affect other devices (2026-10-15).
- Content, groups and attachments are shared across devices; each device keeps its own layout.
- "Reset all data" in a Google workspace needs explicit confirmation and a working Google sign-in. Update or stop
  every older device first: older destructive commands can still delete the new data. The app captures old leaf IDs
  from metadata, publishes a legacy-compatible fence, and prepares a new dataset. Once the new current checkpoints
  are ready, ordinary work resumes while captured old files are removed in bounded background steps. Old folder
  containers and late uncaptured files are retained; late legacy writes are reported without expanding deletion.
- On first use, new-format clients discover a verified dataset/ready descriptor and current checkpoints. They do not
  download retained history. Conflicting initializers pause for an explicit choice instead of selecting a timestamp
  winner. An initialized empty workspace never gets a default group added again.
- Old local data is preserved until you explicitly discard this device's incompatible copy. Old Google data requires
  a separate cloud-reset confirmation; local discard does not clear Google. No migration runs. Use a compatible app
  to preserve earlier data and backups before changing formats.
- Missing or replaced cloud data pauses sync and preserves the local copy. Recovery offers export, a preview of
  replacing this device's copy with the verified cloud, or explicitly replacing Google with current local data under
  new identities after saving a safety backup. Uncached history cannot be recovered from a current-only copy.
  No cloud-loss handler automatically republishes old note identities.

## Overwrite Google completely from a local backup

1. In Local notes, export a ZIP from Settings → Data and backup and confirm it was saved; also back up before
   uninstalling the MSIX.
2. Sign in to the Google account to restore, and stop sync on other devices first. In the Google workspace open Data and
   backup,
   choose that ZIP and the restore method "Clear Google, then restore from the backup", enter the backup password and
   press "Check file".
3. Check the target account and the counts, press "Back up current data first", choose a safe place for the ZIP and wait
   until the check succeeds.
   Then tick "I understand this permanently clears the Work Fleet data in Google" and press "Confirm restore".
4. The app stages the restore locally, records exact old cloud targets, publishes the reset fence and uploads a
   new dataset. Receiving devices activate it only after the archive's declared history and attachments have been
   seeded and current checkpoints are ready. Captured old files are cleaned in the background. Drafts stay on the
   restoring device and are not published. Layout stays per device unless "Also restore desktop positions" is chosen.
5. After interruption, reopen the app with the same account and let the durable job continue. Network and sign-in
   failures pause it with a retry action. On other devices, preserve unpublished work before choosing to replace
   the local copy with the new verified cloud. Update older devices before reconnecting them.

This is a permanent full overwrite. Google cannot perform multi-file operations atomically, so after an interruption the
cloud may hold some of the files. New receiving devices activate the workspace only after the whole restore request and
its attachments are verified,
and never show a partial workspace as a successful sync; all syncing devices must be updated.
The safe ZIP saved before clearing can be restored separately. The reset control marker is kept to notify old devices;
ordinary Drive files are not affected.
The existing "Add as new notes", "Merge with current notes" and "Replace current notes" keep their original history
semantics; the last one does not clear retained history or Trash. Purged note identities recover as explicitly
previewed new notes. Only new-format archives are accepted; earlier ZIPs require a compatible app.
A local package without a configured Google client offers no sign-in or cloud overwrite; fill in `.env` and rebuild.
Backups carry no sign-in credentials.

## Download a Google backup into offline Local notes

Local and Google workspaces use the same optionally encrypted ZIP format, which can be imported in either direction and
is not bound to a source account or Drive file ID.

1. In the Google workspace, press "Export backup" in Settings → Data and backup and choose where to save it.
   Choose Complete retained history (the default) or Current state only. Complete coverage syncs first and
   downloads uncached retained history and attachments, while current-only coverage captures this device without requiring sync and excludes old versions. Both
   include this device's drafts. Complete export fails intact above the initial 20,000-entry / 128 MiB expanded ZIP
   limit; the app never silently switches coverage. Earlier-format archives cannot be imported into this format.
   If the sync fails, nothing is saved by default; you can explicitly choose "Back up only what this device knows" after
   checking the last successful sync time and the number of pending changes in the message.
2. Confirm the ZIP was saved. Content and drafts that other devices have not uploaded are not in this backup; if needed,
   sync on those devices first or export on each of them.
3. In Settings → Account and sync, press "Switch" in the "Local notes" row, then open Data and backup and choose the
   ZIP.
   To keep the existing local content, choose "Add as new notes" or "Merge with current notes"; to replace it entirely
   with the backup, choose "Clear this device, then restore from the backup".
4. Press "Check file", check the clearing scope and the restore counts, tick "I understand the current local content
   will be permanently replaced by the backup", then press "Confirm restore".
   A backup of the old local data is optional, and no reset is needed first; a failed restore keeps the original data.
   After success, old local history, drafts and attachments are scheduled for background collection and are not kept in Trash.

From then on the local workspace can be used for offline-only editing and never writes back to the original Google
workspace; the cloud notes and other account workspaces are kept.
Drafts still need to be saved manually by the user and are not published by the restore. The local automatic backup
settings and saved ZIPs are not cleared by a full restore.
The same ZIP can also be restored into another Google workspace; for a complete overwrite, use the full Google mode above,
which still needs a safe backup.

## Setup problems

| Symptom | Fix |
|---|---|
| There is no "Sign in" button, and the "Google account" row reads "This version can't sign in yet" | Fill in that platform's client ID (Android also needs the Web client ID) and rebuild the native app |
| `redirect_uri_mismatch` | Windows and Linux use a Desktop client; Apple uses an iOS client that matches the bundle ID; regenerate the project |
| Android developer configuration error, or no account can be chosen | Check the package, the actual signing SHA-1 and the Web client in the same project |
| App data not authorized / 403 | Enable the Drive API, allow the appdata scope, check the test users or the Workspace admin policy |
| Authorization expired / 401 | Sign in again with the original account; authorization in Testing can expire (refresh tokens after 7 days), and local pending data is kept |
| Another device does not see the data | Check that the account is the same, that the clients belong to the same project, and that both sides synced successfully |

Current status, including what has not been run, is in [PROGRESS](../PROGRESS.md); verification procedures and
unverified boundaries are in [testing](testing.md).

## Phone sign-in acceptance

On the device, use a build with the same bundle/package and actual signature as the OAuth registration, and add the
account as a test user in Google Auth Platform:

1. First leave a note and a draft in the local workspace, then sign in to Google from Account and sync and allow app data
   access.
   On success that account's workspace opens; the original local notes are kept and not moved to Google automatically.
2. Cancel during account selection or authorization: the app returns to the original workspace, which can still edit,
   sync and retry; cancelling is not shown as a sync failure.
3. Sync manually, add notes and attachments, and confirm that another device on the same account syncs them; force-quit
   and reopen, then check that sign-in is restored.
4. Switch to another account and confirm that notes and pending changes are kept apart; sign-out affects only this
   device, and other devices stay signed in.
5. Turn off the network or deny Drive access: an understandable message appears and the original data is kept; after
   the condition is restored, signing in and syncing work again.

Android clears this device's Credential Manager account selection state so the next sign-in can choose an account again;
it does not revoke the Google cloud authorization.
Apple keeps the existing SDK session before opening account selection, so cancelling still leaves the original account
usable.
Sources and the limits of the mock tests are in the [phone authorization research](research/2026-10-17-mobile-google-sign-in.md).
