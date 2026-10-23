# ADR-021: Windows Google sign-in, account partitions and sync

## Status

Accepted

Revised 2026-10-15: signing out no longer revokes the grant with Google (changed on Windows, Linux, Apple and Android together).
Google's revocation removes the grant for the whole project, so every token for the same account on other devices becomes
invalid, and within about an hour those devices ask to sign in again one after another.
The user reported that several machines in turn showed "Google authorization is incomplete or has expired. Sign in again."
and said this behavior is unacceptable.
To revoke Work Fleet's access, remove it under "Third-party apps & services" in the Google Account.

## Context

The FileSync/Drive adapter of ADR-012 already exists; it needs native authorization, secure storage and a usable account
entry point.
The Google Cloud project has not been created yet; the public client ID uses the existing `.env.example`.

## Decision

Windows uses the external system browser, authorization code with PKCE S256, and a random state.
The temporary loopback callback binds only an OS-assigned free port on 127.0.0.1 and closes on completion or timeout.
The `sub` from Google's HTTPS userinfo is the stable partition ID; the requested scopes are openid, email and drive.appdata.
Sign-in does not use an embedded WebView, and data is not partitioned by email.

NativeGoogle holds the access/refresh tokens and the resumable upload URLs. Credentials are encrypted with DPAPI and saved
atomically, and refresh happens in the native service. The renderer only calls FileStore commands with fixed semantics and
cannot supply URLs, HTTP headers or tokens.
Google HTTPS responses refuse redirects and limit stream size. Uploads first verify the local content; downloads verify
metadata and SHA-256.
1 MiB resumable chunks; resume progress is set by Google's Range response, and file IDs are kept by the existing FileSync
reservation.

Each Google sub uses a `google:<sub>` workspace; local data uses `local`.
Before switching, the app saves drafts, stops automatic backups and the old sync, blocks desktop commands, then closes the
old authority and reloads the account partition.
Existing local notes stay and can be imported through a backup; after sign-in, data of other accounts or of `local` is not
uploaded automatically.
A new account first reads the source and creates the default group only after confirming that the source is empty. An
explicit quick add by the user can also create a group.
Background sync is attempted every 20 seconds and follows FileSync's backoff, conflict and outbox rules; it is deferred
while a dialog is open or text is being composed. Since 2026-10-23 the host also sends a 20-second `host-tick`, on which
a hidden main page syncs, because WebView2 runs a hidden page's interval only once a minute (docs/testing.md).
Signing out clears only this device's credentials for that account and does not revoke the grant with Google (revised
2026-10-15, see Status); note data stays in that account's partition.

## Consequences

- No note server of our own is added; the callback listener serves a single sign-in.
- Without a client ID, local notes still work; the Google UI reports the missing configuration.
- Creating the Google project, real sign-in and Drive round trips, and authorization on other platforms still need external
  configuration and platform acceptance.

## Alternatives Considered

The renderer holding tokens, or an arbitrary HTTP bridge: rejected, because it widens the exposure of credentials and
network capability.
All accounts sharing one local workspace: rejected, because notes could easily reach the wrong account.

## 2026-10-06 revision: Desktop client secret

Confirmed before creating the real Google project: for a Desktop-type client, even with PKCE, Google's token endpoint still
returns `invalid_request: client_secret is missing` (the documentation lists the parameter as optional, but in practice it is
still required).
- The Desktop client secret on Windows/Linux becomes an optional setting; when it has a value, it is sent with the
  authorization code exchange and with refresh.
- Google treats an installed app's client secret as not confidential; it cannot protect tokens. The security boundary is
  still PKCE, state and the callback bound only to 127.0.0.1.
- The secret is written only to the configuration file next to that platform's app; it goes neither into renderer assets nor
  into the Android/Apple packages. The Web client secret is still not used.
- Without a secret, nothing is sent, as before; if Google later accepts pure PKCE, no code change is needed.

## References

- [ADR-012](012-durable-file-store-and-drive-adapter.md)
- [Google native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google userinfo](https://developers.google.com/identity/openid-connect/reference)
- [Services and ports](../services.md)
- [Desktop PKCE token exchange still requires a client secret](https://discuss.google.dev/t/desktop-oauth-pkce-exchange-returns-invalid-request-after-successful-loopback-callback-with-no-client-secret/390526)

*Decision made: 2026-10-05*

## 2026-10-17 revision: Phone account choice and cancellation

The iOS, Android and Web OAuth clients have been created. Native authorization and partitioning follow ADR-022/023, and no
sign-in server of our own is added.
Android clears Credential Manager's local selection state on sign-in and sign-out without revoking the Google grant;
the access token cache is bound to the confirmed sub, so a token obtained by choosing another account cannot be used for the
pending content of the current partition.
The account choice at sign-in, the Drive authorization and userinfo share a 110-second deadline, which leaves time for the
bridge reply; after a timeout or close, a late authorization window is not opened.
Apple interactive sign-in does not call signOut first; when the user cancels, the existing SDK session and note partition are
kept.
Both turn cancellation and network, configuration and credential failures into fixed product messages, and return neither
raw SDK errors nor tokens to the renderer.
The SDK sources and the unverified boundaries are in the [mobile sign-in research](../research/2026-10-17-mobile-google-sign-in.md).
