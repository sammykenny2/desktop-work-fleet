# ADR-024: Linux native main window, data and Google

## Status

Accepted, 2026-10-05; the key and credential storage policy was superseded on 2026-10-15 by
[ADR-047](047-linux-local-key-without-keyring-prompts.md)/[ADR-048](048-linux-offline-workspace-and-system-secrets.md).
When the code and packaging entry points were added, the Linux runtime had not been run; later verification is in the git
history and `docs/testing.md`, and the current status is in `PROGRESS.md`.
On 2026-10-06 the Python minimum changed to 3.10.

## Context

1.0 requires a native Linux main window, protected content and authorization, complete backups and file sources, without the
historical note server.
Desktop presentation must be reported according to the compositor's capabilities; the Windows work environment has no Linux
GTK, Secret Service or display session.
The user asked to implement first and not to invest further in verification; this slice does not treat the main window as a
complete Linux desktop delivery.

## Decision

- Python 3.10+/GTK 3/WebKitGTK 4.1 (2.40+)/PyGObject; the frameworks come from the distribution,
  and no OS runtime binaries are copied. A secure custom scheme serves only packaged assets; there is no resident HTTP listener.
  The original minimum was 3.12+; on 2026-10-06 it was lowered to 3.10 at the maintainer's instruction so that Ubuntu 22.04
  LTS can install the app. A check of the code then found no syntax or standard-library API from 3.11 or later (vermin
  reported a minimum of 3.6), so only the dependency declaration changed; since then tests block 3.11+ syntax.
  WebKitGTK on 22.04 must be updated from jammy-security to 2.40+; the 2.36 shipped with the release has no
  `evaluate_javascript`.
- The main frame injects a transport that encloses a nonce; the receiver checks the nonce and the fixed document URL.
  Other navigations and frames, network subresources and WebKit permissions get no native bridge capability.
- One Workspace for the main window; SQLite WAL/FULL, revision CAS with attachments in the same transaction, a flock owner.
  AES-GCM payloads are bound to profile/kind/id; the 32-byte key is stored by the libsecret Secret Service.
  Without a keyring or the original key, the app stops; there is no plaintext fallback.
- Google: system browser with PKCE and state, and a `127.0.0.1:0` callback limited to 110 seconds. The userinfo sub checks
  the account, and the refresh credential stays in the system keyring. Drive uses fixed appDataFolder operations, stream size
  limits, metadata and SHA-256 verification and 1 MiB resumable chunks; the renderer has no arbitrary HTTP, URL or credential
  capability.
- The native chooser grants the backup directory permission, and the device/inode identity is kept; new files use
  O_EXCL/NOFOLLOW, then fsync and read-back. The journal, the native creation identity, the latest valid backup and the
  retained count control cleanup; portable encryption keeps the SPEC-002 format.
- Build entry points for a source/runtime tar.gz and a Debian package; the desktop file, the app's own icon, dependencies and
  notices are kept with the package. No `.env`, tokens, keys, account data or host SDK paths are included.
- Linux X11/Wayland desktop surfaces, global shortcuts and the tray are integrated in later slices, keeping the full 1.0
  scope.

## Consequences

Google state is unified with the other platforms as configured/connected/profileId/accountId/email.
When the client ID or scope changes, the old authorization is disabled and the user is asked to sign in again, keeping that
account's notes; a Drive 401 makes the next request refresh the token first.

The Linux main window uses the complete editor, version graph, FileSync, backup and restore, and the native storage contract.
Real-environment results for GTK/libsecret, Google, the file system and compositors are still missing; a source archive is
not acceptance of native operation.
System runtime licenses stay with the distribution; the final package version and license inventory still need real Linux
distribution artifacts.
This does not claim that the Debian package was installed, that a store listing was obtained, or that the Linux desktop
delivery is complete.

## Alternatives Considered

The existing HTTP note server does not meet the 1.0 source boundary; writing the key back to settings or storing it as
plaintext in SQLite violates the local protection requirement.
Reusing Windows or Apple platform APIs cannot provide the Linux system chooser, keyring and real native windows.
Keeping Python 3.12+: dropped on 2026-10-06, because the code uses no 3.12 features but the requirement would exclude Ubuntu
22.04 LTS. Installing deadsnakes Python on 22.04 is not viable either, because the system python3-gi and cryptography support
only the built-in 3.10.

## References

- [Linux native entry point](../../src/native/linux/README.md), [ADR-012](012-durable-file-store-and-drive-adapter.md).
- [WebKitGTK 4.1](https://webkitgtk.org/reference/webkit2gtk/stable/index.html).
- [libsecret](https://gnome.pages.gitlab.gnome.org/libsecret/).
- [Google native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app).
- [GTK layer shell](https://wmww.github.io/gtk-layer-shell/).

*Decision made: 2026-10-05*
