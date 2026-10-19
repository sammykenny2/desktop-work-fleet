# Security boundaries

Updated: 2026-10-17.

## Public build artifacts

iOS device builds, signing and installation stay local under
[ADR-057](decisions/057-local-ios-builds-and-device-privacy.md). Embedded development and Ad Hoc profiles disclose
registered device UDIDs even when their inputs came from GitHub Secrets. A public repository's Actions artifacts
are downloadable by signed-in users with read access, so skipping Release publication is not a privacy boundary.
Do not upload device IPAs, real provisioning profiles or real-device data backups to public artifacts or Git.
Public signing certificates, OAuth Client IDs and Apple Team IDs are identifiers, not private signing keys or user tokens.

## 1.0 local renderer

- [ADR-051](decisions/051-schema-evolution-and-atomic-migrations.md): during the test phase the JSON schemas stay at
  V1 and keep their basic format checks. No schema upgrade transaction, original copies or extra bridge permissions
  are added; the existing atomic saves, encryption, account isolation and portable backups stay as they are.

- Notes, drafts, the outbox and the layout commit in one IndexedDB transaction; no new Workspace is published before
  it succeeds. Profile keys and composite attachment keys isolate the data; Web Locks plus a revision CAS stop
  independent writers from overwriting each other.
- Raw HTML in Markdown is shown as text, and the generated DOM then goes through a DOMPurify allowlist. Remote images
  are not loaded, links other than HTTP, HTTPS and mailto are removed, and links that open elsewhere use noopener and
  noreferrer.
- [ADR-052](decisions/052-rich-papers-and-native-attachments.md): code highlighting uses only the bundled Highlight.js
  with an explicit language, and the generated markup is still sanitized. Content with no language, an unsupported
  one or beyond the highlighting budget stays plain text. Raw HTML and SVG never run in the app origin.
  Desktop attachments project only the id and name; the main workspace checks the current version, visibility and
  interaction, and attachment ownership before it calls the native main document.
  The native side reads attachments for the current profile and produces private, managed, read-only copies;
  thumbnails return only a bounded PNG or blob URL. It accepts no source paths, programs or arbitrary commands. System
  thumbnails and opening in an external app need a plaintext temporary copy, which is cleaned up on a best-effort
  basis at a normal account switch, reset or exit; an abnormal exit or an OS file lock may leave temporary files
  behind. External changes are not saved back. Executables, shortcuts and some scripts are not opened directly.
- Attachments are addressed by SHA-256, up to 25 MiB per file. Downloads are wrapped as application/octet-stream, and
  user HTML and SVG never run in the app origin. The stored bytes and the original MIME metadata are not rewritten.
- All scripts are bundled locally, and the importmap is authorized by a CSP hash at build time; there are no remote
  scripts and no CDN.
- Pending and failed drafts keep their content in memory and warn when the page is left; a normal success is judged
  by transaction complete. Input that has not reached disk before the browser process is forcibly killed cannot be
  guaranteed to survive, and the local cache is not treated as a backup.
- Sync revisions use strict JSON and immutable IDs; duplicate fields, collisions, cycles or cross-entity parents
  reject the whole batch. The source session must match the profile, source and runtime, and data and cursor commit in
  the same transaction; a late response cannot write across accounts. Multiple heads and the history are all kept;
  ordinary commands cannot silently consume a conflict, and an explicit resolution also checks the complete set of
  heads. The source-independent transactions and scripted Drive REST are tested; Google OAuth and the native
  transports still need separate acceptance.
- FileSync stores a fixed file ID, digest and size before uploading; a 409 must be read back and checked, and only an
  ack can consume the outbox. The content behind a confirmed file ID cannot change; a remote deletion, an unknown
  format or an incomplete listing stops progress and never deletes local versions.
  The Google adapter limits Location to the same HTTPS API host and upload path, and errors do not echo private
  response bodies. The protected native HTTP still has to implement refusing redirects, streaming size limits and
  account revocation; this interface must not be exposed to the renderer as arbitrary requests.
  The upload URL currently lives only in adapter memory, and after a process restart a resend with the persistent
  file ID is safe; it never goes into JSON, backups or logs.
- The development listener serves only loopback static assets and has no notes or token API. The native hosts' OAuth,
  OS secure storage, encrypted backups and formal packaging each still need their own acceptance, which tests of this
  interface cannot replace.

## Linux local key and credentials

[ADR-047](decisions/047-linux-local-key-without-keyring-prompts.md) and
[ADR-048](decisions/048-linux-offline-workspace-and-system-secrets.md) separate offline notes from the features that
need system secrets.
The AES-GCM payload and AAD keep their format. The master key is `storage-key` in the app data directory, with the
directory at 0700 and the key at 0600, owned by the same user; symbolic links and permissions that are too broad are
refused. The key is published create-only after it is fully written and fsynced, under the existing single-owner lock.
Google access and refresh tokens and saved automatic backup passwords are stored in the unlocked, persistent Secret
Service default collection. They are never written as local credential or secret payloads, and there is no fallback on
failure. SQLite stores only references and the revocation and cleanup state; Google credentials never enter a
workspace reset, a ZIP or the renderer, and the backup password ID is bound to the profile. The session collection
cannot be used for persistent storage.
The Locked property is read live first, then the unlocked collection is searched and GetSecret is called again; no old
secret and no cached Locked value is used.
The provider's global SearchItems, which can trigger unlock UI on its own, is avoided; background reads, writes and
deletes never run a returned Prompt.
When the vault is locked or unavailable, only Google sync and encrypted backups that need a saved password pause; the
notes keep working.
Only the user pressing "Sync now" can open the system unlock dialog for the persistent default collection. The app
never receives the keyring password, and after a successful unlock the sync continues with the existing credentials,
with no new OAuth. Cancel or timeout keeps the pause and the retry; closing the session can cancel the Prompt.
The vault is read again before every use of a token; a previously cached token cannot be used further. A slow vault
does not hold the note storage worker or the DB and bridge locks.
Migrating from older versions reads only unlocked keyring items and never asks for an unlock; the local key is saved
only when the payloads of all existing accounts pass verification. A failure does not change the key or delete data or
the original keyring items. ADR-047's old local credentials and backup passwords are first moved into the vault and
deleted only after a confirmed read-back; ciphertext in the current SQLite database and WAL is cleaned up, with no
claim of physically wiping the disk or old backups. While the vault is locked, the copies that still await migration
are kept but not used, so protection is weaker until the migration completes. Signing out first stores a persistent
revocation mark, which stops old tokens from being imported again after the vault unlocks or the app restarts.
The local key and the DB are in the same directory. The protection boundary is the OS account and the file
permissions; once the whole data directory is copied there is no confidentiality. Root, malicious processes in the
same account and reading an unencrypted disk are outside this boundary. After the secret migration has finished,
copying this directory does not give the tokens or backup passwords in the vault.
Other platforms' storage policies are unchanged, and the protection of Linux local content is still weaker; for
sensitive backups that move between machines, choose password encryption explicitly.

## Windows native main window

[ADR-015](decisions/015-windows-native-storage-and-editor-host.md) identifies the bridge caller by a fixed packaged
origin and the main document; frames and other pages, remote assets, and arbitrary host objects, paths, SQL and HTTP
methods are blocked. The release app opens no DevTools and no debug port.
Only the Debug configuration can open DevTools, and loopback CDP opens only when the process environment explicitly
asks for it ([ADR-032](decisions/032-windows-debug-webview-inspection.md)).
The Windows profile is decided in the host; the renderer can only get the content of this partition and cannot call
vault.read.
Record, attachment, staging and vault payloads use DPAPI CurrentUser, with scope entropy bound to the profile, the
purpose and the identity.
SQLite index metadata is not encrypted; processes in the same Windows account and RAM or crash dumps are outside this
boundary.
A secure storage failure never falls back to plaintext; do not copy the native DB instead of making a cross-machine
ZIP backup.

IPC has a 1 MiB envelope and 256 KiB chunk limit with a full SHA, and a manifest of 20,000 tokens can be committed at
once.
Upload staging is isolated from the real data, and one SQLite CAS transaction saves the Workspace, the receipt and the
attachments together. There is a single native owner per directory, and a restart reclaims staging that lost its
owner. A lost reply for something already committed can only be confirmed with the full bytes; it can never be claimed
as a rollback.
The close protocol is ready before the real UI becomes interactive; a save failure or an unfinished dialog keeps the
window open.
The named pipe for a second start is named from the user's SID and a hash of the data directory. Its ACL allows only
the current user, and it accepts only the fixed `show` request, passing no data or paths; `owner.lock` is still the
last protection (ADR-043). The main window position and the startup preferences are stored in the data directory;
they contain no note content and never go into backups or Google.
In-app updates (ADR-044) connect from the native host only on a user action: with no credentials or cookies and only
over HTTPS, the check reads only the configured repo's `github.com/<repository>/releases.atom`, refuses redirects and
never calls the REST API. The XML is limited to 2 MiB with DTDs and external entities refused, and only Atom
entry/alternate links of the same repo and valid platform tags are accepted. The manifest or appcast and installer
URLs are always built from the repo, the tag and a single-level file name. Downloads are allowed only from
`github.com` and the GitHub release asset host, with at most three redirects; responses and installers have size
limits, and the installer's size and SHA-256 must match the release's `work-fleet-update.json`. The MSIX identity
(Name, Publisher, architecture) must be the same as the installed package with a higher version, and Windows checks
the signature at installation.
The manifest and the installer come from the same release, so this only protects against corruption and a single
replaced file, not against a compromised GitHub account. The renderer cannot specify any URL.
The local test source is read only by the `app.workfleet.updateprobe.*` package identity; other identities ignore it.
Linux checks the package name `work-fleet`, the architecture and a higher version with `dpkg-deb` before installing
with pkexec; a DEB has no operating-system signature check and relies only on the same release's manifest and
SHA-256.
macOS only queries the Atom feed above itself (refusing redirects). After that, Sparkle downloads by the appcast of
the same repo and tag and follows GitHub redirects itself, so the host allowlist above does not apply.
Sparkle installs only after verifying the appcast's EdDSA signature (with the public key built into the app) and the
Apple code signature (same Team ID). The private key is only in the maintainer's Mac keychain or a CI secret.
The Windows automatic backup files and the safety backup password integration are in ADR-016; OAuth and the other
platforms still need implementation and acceptance.
Native grants and file identities are protected with DPAPI and bound to the profile; the renderer has no method to
read paths or metadata.
NTFS child files are created relative to a held directory handle. Cleanup checks the entity, size and SHA through the
same handle before the disposition, and holds the lock on the latest valid backup until cleanup is done. It never
verifies a hash first and then deletes by pathname.
A swapped file, a reparse point, changed content or an access race is kept and reported; a file with the same name
whose native reservation was lost is not read or claimed.

Windows scenes use a separate `/desktop/index.html` and a fixed command allowlist, and cannot call the main bridge's
storage, backup or vault.
A frame contains only the cards that can be shown now and the edit text they need; no history, outbox, sync cursor or
attachment bytes.
Each chunk lease is bound to the owner and view that the native side assigns, and is published only after the full SHA
is verified. A different main-window session cannot reuse a view.
Scenes send only fixed interaction commands, and a single Workspace runs the durable transactions; on close they stay
frozen until host.closeReady.
Capacity and disconnect handling are in [ADR-018](decisions/018-single-owner-desktop-views.md).

## 1.0 portable backups

- `src/backup` reads the complete snapshot and SHA-256 attachments only from the captured profile; it carries no
  tokens, provider or old outbox. The reader writes nothing to the target before the whole file is verified. CRC and
  SHA are no proof that the author can be trusted; the content is still treated as external input.
- ZIP uses a fixed path allowlist and checks local and central headers, CRC and the actual output; traversal, links,
  ZIP64, and duplicate or unknown paths are refused. Large entries and graphs are processed in batches that can be
  cancelled; the limits of 20,000 entries, 128 MiB expanded and 25 MiB per attachment never truncate silently.
- Encryption is AES-256-GCM over the whole inner ZIP with PBKDF2-HMAC-SHA256 at 600,000 iterations, a random salt and
  nonce, and the header as AAD. Parsing starts only after the tag verifies; the KDF is a fixed allowlist, and the
  password never goes into settings, logs or `.env`; strings under GC are not guaranteed to be wiped.
  Windows automatic backups use the DPAPI vault, and the native PBKDF2/AES-GCM output interoperates with the shared
  reader; other platforms still need acceptance.
  The schedule only gets the encrypted result, and no bridge returns a saved password; container encryption must not
  be presented as Drive encryption.
- Restore uses a verified BackupDocument and a RestorePlan that cannot be forged, bound to the profile and the
  workspace revision. The preview writes nothing; the commit writes state, receipt and attachments with CAS in one IDB
  transaction, and after a restart the receipt removes duplicates.
  The safety backup before a replace is proven saved by a trusted file adapter's write, close and read-back check; a
  plain download or ordinary JSON is not enough to unlock the replace.
- Automatic backups and native saves must follow the owned inventory and the authorization scope in
  [SPEC-002](specs/002-portable-backup-and-restore.md); current implementation status is in
  [PROGRESS](../PROGRESS.md). A browser save probe does not show power-loss durability on external disks.
- An automatic backup first stores a pending entry with the profile, the policy and the expected hash, and records
  success and cleans up the verified inventory only after verification.
  The host must atomically avoid overwriting a replacement file of the same name and avoid deleting anything other
  than the original entity; the browser's automatic file capability is unavailable, and a race is never masked by
  checking a pathname twice. The encryption key reference is isolated per profile and never goes into the ZIP or
  `.env`.
  When the journal fails, a transient pause message must be published; the app must not look normal just because the
  failure record could not be written either.

## Existing 0.1.0 validation version

- Locking only prevents accidental touches; the server enforces viewer, editor and admin permissions separately.
- Tokens are 256-bit random values, and the DB stores only their SHA-256. One-time pairing codes are 192-bit and valid
  for 300 seconds.
- The local owner token and the server DB have permissions 0600, the data directory 0700; the app config is saved at
  0600 in the Sandbox container.
- Web tokens, drafts and caches are stored in this origin's localStorage; there is no end-to-end encryption and no
  Keychain integration. A shared OS account, browser cleanup or disk damage can cause leaks or loss; draft export is
  provided.
- The QR code contains only the origin and the one-time code, in the URL fragment; the pairing page removes the
  fragment after reading it. It never holds a permanent admin secret and does not go through a third-party QR service.
- Non-loopback services must use TLS; the app forbids remote HTTP and never disables certificate verification.
- The server limits Host, Origin, body and content type, and uses CSP, textContent and parameterized SQL.
- Diagnostics never record tokens, codes or note text. Tests use only temporary synthetic data.
- Backups contain private data and credential hashes; a restore revokes the old devices and changes the epoch, and the
  original DB is never overwritten.
- The app has only the App Sandbox and network.client entitlements; it requests no network server, full file access
  or Apple Events.
- Public network load, abuse throttling, encryption at rest, Keychain, formal signing and store review are not done
  yet. The Python standard-library HTTP service is meant for personal validation; no production security hardening is
  claimed.

See also [API](api.md) and the [validation report](validation/2026-10-03-validation-report.md).
