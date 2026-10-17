# Work Fleet Privacy and Data Notice

Traditional Chinese: [privacy.zh-TW.md](privacy.zh-TW.md)

Maintainer: sammykenny2. Contact: [sammykenny2@gmail.com](mailto:sammykenny2@gmail.com). Effective date: 2026-10-14.
This document is the public privacy notice for the GitHub preview builds; store submissions still require each store's
forms to be checked against the actual SDKs and distributed artifacts.

Work Fleet is for recording notes, to-dos, drafts and attachments. Users can use only a local workspace, or choose to
sign in to Google to sync their data.

## Local data

Note content, groups, drafts, attachments, version history, pending sync operations and the local layout are stored on
the device. The native apps protect local data and credentials with the operating system's secure storage.
Uninstalling the app or clearing its data may delete this content; if the operating system account, the device key or
the secure storage becomes unavailable, content that was encrypted may become unreadable.
Use portable backups to keep important content, and keep backup passwords safe.

## Google sync

Sign-in and Drive authorization are handled by the native flows of Google and the operating system.
The app uses the Google account's stable identifier to keep workspaces apart, and shows the email address to indicate
which account is in use. Sign-in data is not stored as note text and is not included in note backups.

When sync is on, notes, groups, attachments and version data are sent to that account's Google Drive app data space.
Google receives the account and network information that OAuth and Drive requests need; its handling of that data is
governed by Google's privacy policy.
Work Fleet has no note-content server of its own and does not ask for access to ordinary Drive folders.
Signing out stops sync on this device and removes the sign-in data the app stored; notes already saved remain in that
account's partition.

## App updates

When the user checks for updates in Settings or the tray, the app queries GitHub for this product's public release
information and downloads the new installer.
GitHub receives ordinary HTTP request information (such as the IP address and a User-Agent containing the app name and
version); its handling of that data is governed by GitHub's privacy policy.
A check sends no note, account or device-identifying data, and the app does not connect on its own without a user
action.

## Backups and version retention

Users choose the backup location and whether to encrypt backups with a password. A complete backup contains the text,
attachments, drafts and history, and should be treated as a private file.
A plain backup can be read by anyone who obtains the file; a password-encrypted backup needs the password to open, and
the maintainer cannot recover the password for users.
The file provider or cloud location the user chooses may receive backup files.
Completing, archiving and the operations in Deleted keep the version history needed to support sync and conflict
handling. Deleting a note does not mean all its history is removed at once from the device, Drive or existing backups.

## Permissions and contact

The app asks for access to a file or folder only when the user chooses an attachment or a backup location.
It includes no advertising SDK and no location, contacts, microphone or camera features, and adds no tracking or
analytics SDK of its own.
Google and platform SDKs handle data under their own terms; store disclosures must match the dependencies and behaviour
of the actual distributed packages.

For support, use the product's public support URL or contact email. The maintainer should ask only for the information
needed for diagnosis; do not share OAuth tokens, signing keys, passwords, or notes or backups you do not want others to
read in support messages.
