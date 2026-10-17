# ADR-037: MSIX local data lifetime and Google backup overwrite

## Status

Accepted, 2026-10-10; implementation continued on 2026-10-12. The maintainer confirmed that uninstalling clears local data
and chose "first clear all Work Fleet data in Google, then restore the backup".
This decision supersedes ADR-032's requirement that Debug and MSIX share data; its Debug inspection and Release protection are
unchanged.
[ADR-038](038-portable-local-and-cloud-backup-flows.md) later adds a complete local restore (with an optional backup of the old
data) and export after a Google sync; the cloud safety backup rules of this decision are unchanged.

## Context

MSIX AppData virtualization can be affected by ZIP or Debug files that existed before installation, so uninstalling gives
different results on different machines.
All three current restore modes keep the existing history; "Replace current notes" cannot do the full Google overwrite the
user asked for.

## Decision

- MSIX explicitly uses `ApplicationData.Current.LocalCacheFolder/Local/WorkFleet`, which keeps the currently virtualized data location.
  All local and Google account partitions, SQLite/WAL, settings, the DPAPI vault and the WebView2 cache stay in the package
  data area. Updates keep the data, and Windows clears it on uninstall. Neither unvirtualizedResources nor an external retained
  directory is used.
- ZIP and unpackaged Debug builds still use `%LOCALAPPDATA%\WorkFleet`. Old separate data is not moved or deleted
  automatically; when a blank MSIX workspace finds an old DB on first open, it asks the user to export with the old version or
  the ZIP build first and then import.
  ZIP files saved by the user at a chosen location and the data in Google are not deleted by a Windows uninstall.
- A new mode, "Clear Google, then restore from the backup", is offered only in a signed-in Google workspace that can connect.
  The semantics of the existing import, merge and replace-visible-state modes are unchanged. The new mode keeps only the data
  and history in the imported backup and does not keep the drafts of the overwritten workspace; earlier drafts are still in the
  safety backup saved before the replacement.
- The flow first completes a sync and verifies the backup file, previews the target account, successfully saves a safety
  backup of the current data with the same profile and revision, and then asks for the permanent clear confirmation to be
  ticked. Other devices must stop syncing; old copies pause when they meet the reset marker and leave clearing them to the user.
- Remote deletion runs only after the complete new Workspace, the attachments and the `cloudRestore` job are saved in one local
  transaction. The job has two persistent stages, `reset` and `upload`. Upload starts only after clearing completes and the
  stage is saved; an upload retry does not clear again. After a restart or failure, the app offers "Continue overwriting
  Google" and must not silently resume normal sync.
- The clear covers the Work Fleet appDataFolder of the current account in the current Google project; ordinary Drive files are
  not touched. The reset control marker is kept so that old devices recognize the clear. Drafts from the backup are restored
  only on the device that runs the restore and are not published automatically; per-device geometry is not shared content, and
  sign-in credentials do not go into backups.

## Consequences

### Positive

- MSIX uninstall behavior no longer depends on whether a ZIP or Debug build ever ran; recovery after a reinstall goes through
  an explicit export and import.
- Before anything is deleted in the cloud, there is a safety backup and the complete local restore data; a failed upload can
  resume without clearing again.

### Negative

- Local drafts and unsynced content that were not exported before uninstalling are lost. Same-version reinstall tests also
  need a backup first.
- Deleting and uploading many Drive files is not an atomic transaction; during an interruption the cloud may be empty or
  partially restored, and resuming needs the network and authorization back.
- Data that old versions kept in an external directory is not cleaned up automatically; the user must export it first and
  decide what to do with the old data.

### Neutral

- Normal version updates keep the package data; an exported ZIP is a file the user owns.
- Real Google, updates and uninstalls on different OS versions, and several devices operating at the same time need real-device
  acceptance; synthetic FileStore tests do not replace them.

## Alternatives Considered

### Keep external data permanently

It would let a reinstall read the data back, but it conflicts with the uninstall policy the maintainer confirmed, so it is not
adopted.

### Keep using replace visible state

It keeps the old history and Deleted, which makes recovery easier, but it cannot clear all Work Fleet data in Google, so it
stays as a separate mode.

## References

- [SPEC-002](../specs/002-portable-backup-and-restore.md), [PLAN-005](../plans/005-msix-data-and-cloud-overwrite.md)
- [ADR-013](013-complete-portable-backup.md), [ADR-032](032-windows-debug-webview-inspection.md)
- [Microsoft MSIX virtualization](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)
- [Microsoft AppData life cycle](https://learn.microsoft.com/en-us/windows/apps/develop/data/store-and-retrieve-app-data)
- [Google appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)

---

*Decision made: 2026-10-10*
*Decision makers: Project maintainer*
