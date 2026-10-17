# ADR-027: Encrypted share inbox and iOS Share Extension

## Status

Accepted, 2026-10-05; the code and project wiring are added, and the native SDKs have not yet been compiled or run.

## Context

Phone 1.0 includes receiving external shares. Shared content must not overwrite notes directly or pick a Google account
automatically, and content already received must be kept when the app closes or the SQLite save fails.

## Decision

- Android SEND/SEND_MULTIPLE and the iOS Share Extension receive text, URLs and authorized files; there are no arbitrary HTTP
  downloads.
- The receive queue is independent of the Workspace. Android uses a private no-backup directory and Keystore AES-GCM;
  iOS uses the App Group container and group Keychain AES-GCM, flock and complete file protection.
- Each item holds at most 256 KiB of text, 16 files and 25 MiB of files in total; the inbox holds at most 64 items/512 MiB.
  Encrypted metadata is published last, and files are bound to the capture ID/file ID and SHA-256.
- After the main app picks a group in the current workspace, it saves the item as a draft; only after the save succeeds is the
  original share cleared with a manifest receipt. The receipt is recorded in the content extension, so a retry can recognize a
  draft or card already saved in the same profile and avoid duplicates.
- Discarding needs explicit confirmation, and a failed receive keeps the original item. The Share Extension uses only the
  shared inbox; it does not read the main app's Workspace or Google credentials and does not open the main app by non-public
  means.
- The Xcode generator creates the app-extension target and embeds it in the iOS app; the public App Group ID is configured
  in .env, and the main app and the extension use the same group. The actual capability and signing profile are configured with
  the Apple developer account.

## Consequences

Receiving external shares has native code and a shared UI; evidence from the real SDK, file providers and the Extension
runtime is still missing.
Source URIs and provider data are limited by size and authorization; the native package does not treat source files as
executable web pages.
When the Keychain or Keystore key is lost, content is not stored as plaintext instead and old content is not decrypted again;
the inbox is not a portable cross-device backup.

## Alternatives Considered

Creating a note directly from a share would skip group and account selection. An Extension that shares the main database
would introduce multiple owners and wider permissions.
Deleting the received item before the draft is saved would lose content on a failure or when the process closes.

## References

- [ADR-026](026-native-file-export-and-sharing.md), [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md).
- [Android receive sharing](https://developer.android.com/develop/ui/compose/sharing/receive).
- [Apple file representation](https://developer.apple.com/documentation/foundation/nsitemprovider/loadfilerepresentation(fortypeidentifier:completionhandler:)).
- [Apple group keychain access](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps).

*Decision made: 2026-10-05*
