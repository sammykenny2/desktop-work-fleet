# ADR-015: Windows native main window and encrypted storage

## Status

2026-10-05: [ADR-032](032-windows-debug-webview-inspection.md) now limits disabling DevTools to Release/MSIX;
the Debug configuration can open DevTools and an opt-in loopback CDP. The rest of the bridge boundary stays.

Accepted, 2026-10-04, limited to the Windows management/editing main window, native storage and the restricted
bridge.
Desktop presentation is still built capability by capability under ADR-007 / SPEC-003; this decision does not
reduce the five platforms to ordinary windows.

## Context

The shared renderer, Workspace and complete backup already have a working core. The native host must drop the
preview listener,
so that atomic transactions, attachments and the automatic journal live in storage the host controls; OS secrets
must not leak through a general proxy.
Windows and the .NET 8 SDK are available now; the Google project and other native build environments are not set
up yet.

## Decision

- The Windows management/editing window uses .NET WPF + WebView2 1.0.4258.31 and loads the packaged ES modules.
  `https://work-fleet.invalid` is only a WebView2 virtual host mapping; there is no DNS or HTTP listener.
  The runtime uses the system Evergreen WebView2; it currently depends on the .NET 8 Desktop Runtime, and the SDK
  is not bundled.
- SQLite uses Microsoft.Data.Sqlite 10.0.12 / SQLitePCLRaw 2.1.12, with versions and content hashes in the lockfile.
  A single native owner lock, WAL + FULL synchronous; the workspace and the journal each have their own CAS
  revision.
  Restore commits Workspace, receipt and attachments in the same transaction; unfinished transfers go only into an
  isolated staging area.
- DPAPI CurrentUser encrypts records, attachments, staging and vault payloads, with entropy bound to the
  profile, purpose and identity.
  A decryption failure stops that operation, without creating blank data or falling back to plaintext; SQL table
  names and indexes such as profile, revision and hash are not encrypted.
  The vault is only for native callers; there is currently no renderer method to read passwords or tokens, and it
  is not yet connected to OAuth or automatic backup encryption.
- IPC accepts only fixed methods and data, and the host pins the current profile; there is no path, arbitrary HTTP,
  SQL or code interface.
  Exact main document validation, no frames or other pages, cross-origin mapping denied, host objects and DevTools
  disabled.
  External HTTP(S)/mailto links are sent to the system handler only for user-initiated navigation, never loaded in
  a privileged WebView.
- 256 KiB chunks with full SHA/offset; a 1 MiB message can hold a list of 20,000 UUID attachments.
  128 MiB per record, 25 MiB per attachment, 8 active transfers / 256 MiB declared in total,
  encrypted staging at most 512 MiB / 20,008 entries; anything beyond is clearly rejected, never truncated.
- Success is reported only after the SQLite commit; a lost response is checked by reading back the full bytes.
  A document change invalidates old replies; a new process cleans up staging that its exclusive lock proves has no
  owner anymore.
  Before closing, it waits for UI commands and draft saves; open dialogs and IME prompts finish first, and a failed
  save keeps the window open.
- `.env.example` still only provides public build settings; the native main window can work offline without a
  Google ID.
  The old browser preview and the native profile are separate data; there is no implicit migration or overwrite.

## Consequences

### Positive

The shared semantics and the complete data structures plug into the native CAS unchanged, and real Windows can test
commit, rollback and restart.
Content never enters SQLite or the WAL as plaintext, and the privileged bridge offers no general entry for reading
operating system secrets.

### Negative

DPAPI data needs the original Windows user's key; moving across machines or accounts uses a portable backup, and
copying the DB directly is not a restore.
Whole-record writes, DPAPI and copies across languages have a memory cost; capacity limits need measuring in the
later minimum-hardware acceptance.

### Neutral

This encryption boundary is not claimed to protect against malware running as the same account, RAM, the pagefile,
crash dumps or hardware power loss.
Windows desktop layer/pass-through, global shortcuts, monitor mapping, the native file picker / automatic files,
OAuth, signing and the store are implemented separately; their capabilities are currently false. This ADR does not
choose SDKs for macOS/Linux/iOS/Android.

## Alternatives Considered

### Keep all content in WebView IndexedDB

The preview has real tests, but that is not enough to build the host's OS secure storage and the cross-surface
authority boundary; it stays as the browser adapter.

### Wrap the Python prototype API as a local server

This does not match the 1.0 direction of no note server of our own, so the native host handles transactions and
messages directly.

### Connect the renderer quickly through a general filesystem/eval proxy

This would turn data input into OS permissions; an explicit method contract with size limits and partitions is
used instead.

## References

- [Windows host research](../research/2026-10-04-windows-native-storage-and-webview.md)
- [Native contract](../../contracts/native.d.ts), [ADR-009](009-local-renderer-and-persistence.md), [ADR-014](014-durable-automatic-backups.md)
- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md), [PROGRESS](../../PROGRESS.md)
