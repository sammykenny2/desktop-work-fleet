# ADR-022: Android native app host

## Status

Accepted

## Context

The full 1.0 includes a native Android app and preparation for store submission. It must reuse the card semantics and keep
the native storage and authorization boundaries.

## Decision

Use an Android SDK Activity, Java 17, AndroidX WebKit and the shared local ES modules.
minSdk 28, compile/target SDK 36; AGP 8.13.2, Gradle 8.13.
The fixed versions of WebKit, Credential Manager, Google ID and Play Services Auth are recorded in the Gradle manifest.

WebViewAssetLoader maps only packaged assets; WebMessageListener accepts only the main document of a fixed HTTPS origin.
Other network resources, frame bridges and arbitrary URL/SQL/path commands are rejected; external links go to the system.
A native file lock limits each location to one SQLite owner; the profile, record revisions and attachments are saved in one
transaction.
A non-exportable AES key in Android Keystore protects bodies, drafts, attachments, the backup password and native
authorization.
An invalidated key does not fall back to plaintext; Android system data backup is disabled so that content cannot get out of
step with the non-transferable key.

The phone uses Credential Manager for account selection and AuthorizationClient for a separate Drive authorization.
The Web client ID is the Credential Manager audience; the Android client is registered in the Google project by package and
signature.
The native service checks the sub through HTTPS userinfo, then binds the account partition. Tokens and resumable upload URLs
are not returned to the renderer.
HTTP, metadata, SHA-256, fixed file IDs and resumable uploads follow the ADR-012 contract.

Manual and automatic backups use a SAF tree grant; the native side keeps a record of the URIs it created, and the renderer
only receives opaque IDs.
Every backup creates a new file; after saving, fsync and read-back verification follow. Old files are kept when ownership is
missing, a file has changed or the latest backup is not confirmed.
Encrypted backups use the UTF-8 PBKDF2/AES-GCM ZIP format of SPEC-002, with no plaintext downgrade.
The automatic backup scheduler runs in the foreground; after the system reclaims the process, recovery follows the committed
drafts and journal.

## Consequences

- The phone has a native Activity, storage, authorization, file picking and a build manifest, with no overlay permission and
  no note server.
- The SDK, real devices, the Google project and signing still need their matching environments; delivering source code is
  not the same as passing store review.
- SAF providers differ in what they can do; when a save cannot be confirmed, cleanup stops and the new file is kept.

## Alternatives Considered

Renderer IndexedDB as the official native storage: rejected, because it has no established secure storage or file
authorization.
Desktop loopback OAuth on the phone: rejected, because Google's mobile clients do not support that flow.

## References

- [Android Authorization](https://developer.android.com/identity/authorization)
- [Credential Manager](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation)
- [Android WebKit](https://developer.android.com/jetpack/androidx/releases/webkit)
- [AGP 8.13](https://developer.android.com/build/releases/agp-8-13-0-release-notes)
- [Build instructions](../../src/native/android/README.md)

*Decision made: 2026-10-05*
