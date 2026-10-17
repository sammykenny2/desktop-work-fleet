# Drive appDataFolder file backup and restore design

> 2026-10-04: The official-capability research stands; additive restore is a candidate, not the only approved mode.
> The actual backup/attachment/layout/automatic-backup scope must align with
> [SPEC-003 Q01/Q02](../specs/003-desktop-cards-groups-and-formation.md), and group semantics still need to be added.

- Date / official documents consulted: 2026-10-03.
- User request: confirm whether drive.appdata lets users back up and restore as files, and plan it.
- Nature: verification of official capabilities + a 1.0 design proposal; no Google account or Drive operation has been performed.
- Detailed specification: [SPEC-002](../specs/002-portable-backup-and-restore.md);
  development order: [PLAN-002](../plans/002-google-drive-notes-mvp.md).

## Official capabilities

appDataFolder is a hidden, app-specific space that users cannot open in the normal Drive file interface.
It is not the same as the device backups folder that Drive shows.
An app can list its own files, read their content with files.get + alt=media, and create files
in appDataFolder with files.create. So "the app exports to a user file, and the app reads that file back to restore"
has a basis in the official API; it is not Google automatically providing a backup UI for this product.
[Google appDataFolder documentation](https://developers.google.com/workspace/drive/api/guides/appdata)

Files in appDataFolder cannot be moved across storage spaces, shared or put in the Drive trash.
To keep a visible backup in regular Drive, the content must be read out and written separately;
the hidden file cannot simply be moved out. The in-app Deleted area must still be maintained by the app itself.
[Official constraints](https://developers.google.com/workspace/drive/api/guides/appdata#constraints_on_the_application_data_folder)

The space parameter of Drive files.generateIds supports appDataFolder.
A pre-generated file ID can be used in a later create request, so a retry reuses the same ID; creating again after a success returns 409.
This is a capability for retrying a single-file create; it does not mean a multi-file import has atomic transactions.
[generateIds](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds),
[Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads)

## Inferences and recommendations for this project

- After reading the source through drive.appdata, the app can assemble a ZIP locally and then use the OS file-save entry point;
  this step does not require widening the Google Drive scope for backups.
- Users can later put the ZIP they saved anywhere they like.
  drive.file would be evaluated separately only if this app is to manage visible backups in regular Drive directly.
- The first version provides explicit manual export/import and does not assume the user has configured automatic backups.
- The backup format belongs to the shared data core, and the Drive adapter handles transport;
  a future API-based NoteSource can use the same backup format without pretending to be a file source.

The above are application-architecture inferences, not a turnkey backup feature provided by Google,
and not evidence that Sandbox/store file-picker integration is done.

## Why the first version uses additive restore

Suppose A imports last week's backup while B is editing today's notes.
If A overwrote the shared files directly, B's changes could be undone, or hard-to-explain concurrent versions could appear.
Importing the backup under new identities keeps the current content and brings back the old content; the user then tidies up.

The same semantics apply when the original account is lost or the source changes: a backup needs only the content and
resolvable internal references, not the original Drive file IDs or tokens. The cost is no whole-account point-in-time rollback,
no old identities and no full history.
So the UI should say "Import from backup", and the documentation should clearly define the restore scope it provides.

## Data and consistency that must be preserved

Backing up only what is on screen misses unopened notes, the Deleted area, conflict branches and unsynced drafts.
Recommendation: save all editor drafts first, then export from a local transactional snapshot;
record the sync time and data scope, so an offline cache is not packaged as a globally consistent snapshot.

Multi-file Drive downloads do not by themselves provide a transactional snapshot of all notes at one point in time.
Even right after a sync, other devices may not have sent their new content yet;
the backup promise is limited to "the content that client knew and had persisted at snapshotAt".
Unsupported schemas, missing dependencies or corrupt data must not be silently dropped while claiming a complete backup.

Restore atomicity is bounded by the local commit; the per-file sync that follows may partly succeed.
A persisted restore job and stable operation IDs are the application's responsibility to implement; it cannot rely on Drive's 409 alone.
Unsaved drafts are restored into a local pending-confirmation area, so text the user has not decided to publish is not uploaded automatically.

## Still to be verified in implementation

- A ZIP parser/writer for the chosen runtime, a transactional local store, and their licenses.
- File picking/saving on each platform, cancel/disk full, and the lifetime of temporary data.
- Resuming the same job after a crash, lost Google responses, and account switching.
- Restoring in another clean profile/account while the original source is unavailable.
- Memory and decompression limits, Unicode/line-ending round trips, conflict and draft integrity.

The earlier full product/PM research and ADR-003 remain and are not deleted because of this narrow specification.
