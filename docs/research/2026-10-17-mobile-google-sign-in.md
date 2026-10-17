# Phone Google sign-in setup and native SDK behavior

Reviewed: 2026-10-17. The following separates official contracts, implementation choices and acceptance boundaries;
run results are in the git history, and current status is in [PROGRESS](../../PROGRESS.md).

## Evidence

- [Google OAuth clients](https://support.google.com/cloud/answer/15549257?hl=en): Android registers the package +
  signing SHA-1;
  iOS registers the Bundle ID, with an optional Team ID that is required only when App Check is enabled. Store
  identities and local preview registrations are handled separately.
- [Android Credential Manager](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation):
  `GetSignInWithGoogleOption` uses the public Web Client ID as `serverClientId`.
  Signing out calls `clearCredentialState`, which clears the account selection state and does not remove the
  permissions granted to the app earlier.
- [Android authorization](https://developer.android.com/identity/authorization): Drive data permission is obtained
  through AuthorizationClient;
  it is separate from choosing the account. The app must still check the authorized account, and does not use the
  email as the workspace identity.
- [Apple SDK integration](https://developers.google.com/identity/sign-in/ios/sign-in): interactive signIn,
  restorePreviousSignIn and the URL callback each have their role.
  In `GIDSignIn.m` of the pinned GoogleSignIn 9.2.0, interactive sign-in goes through an authorization request;
  currentUser is updated only after success and saving to the Keychain.
  `signOut` clears currentUser, so calling it before starting the interactive flow means a cancel also loses the
  existing sign-in.
  Source: [GoogleSignIn 9.2.0](https://github.com/google/GoogleSignIn-iOS/blob/9.2.0/GoogleSignIn/Sources/GIDSignIn.m).

## Implementation choices this time

- Phone testing keeps using the `work-fleet` project and `app.workfleet.preview`; the public IDs go in GitHub
  Variables/the local ignored `.env`.
  The native side checks the sub against Google userinfo; the Web Client Secret is not used, and no sign-in backend
  is added.
- Android clears the local Credential Manager state when account selection starts and on sign-out.
  The access token cache is bound to the sub, with its lifetime limited by a monotonic clock; after an account switch,
  clearing or expiry, a token matching the current partition must be obtained again.
- Apple does not sign out in advance. After a cancel, the shared renderer restores input, sync and automatic backups
  for the original workspace.
- Only fixed error codes/product messages are returned to the renderer; raw SDK diagnostics, tokens and upload URLs do
  not go into messages.

## Acceptance boundaries

The Swift probe replaces only the SDK, Keychain, HTTP and the screen, and runs the production FleetGoogle; JUnit runs
the production cache/error handling.
These tests and native compilation cannot prove that the actual package/signature match the Google Cloud
registration, and cannot replace real account authorization,
returning from the system browser, SDK Keychain restore, phone process death and cross-device Drive round trips.
The Android client currently matches the local debug signature; the Play App Signing certificate will need to be
registered separately in the future.
