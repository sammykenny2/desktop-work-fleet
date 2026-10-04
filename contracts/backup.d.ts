import type { Id, Revision, WorkspaceState } from './desktop.js';

/** SPEC-002. Validators must also verify hashes, graph references and counts. */
export interface BackupManifest {
  format: 'work-fleet-backup'; schemaVersion: 1;
  backupId: Id; createdAt: string; appVersion: string; scope: 'known-local-data';
  pendingOperations: number; lastSuccessfulSyncAt: string | null;
  counts: { cards: number; groups: number; revisions: number; drafts: number; attachments: number; conflicts: number; pendingRevisions: number };
  files: { name: string; size: number; sha256: string }[];
}
export type RestoreMode = 'import' | 'merge' | 'replace';
export type RestoreLayout = 'preserve' | 'backup';
export interface RestoreReceipt {
  jobId: Id; fingerprint: string; mode: RestoreMode; layout: RestoreLayout; profileId: Id;
  baseRevision: number; committedRevision: number;
  mappings: Partial<Record<'card' | 'group' | 'revision' | 'draft', Record<Id, Id>>> & { restoredDrafts: Record<Id, Id> };
  addedRevisions: number; addedDrafts: number; extraCards: number; retiredGroups: number; ambiguousRebases: Revision[];
}
export interface RestorePreview {
  jobId: Id; profileId: Id; revision: number; mode: RestoreMode; layout: RestoreLayout; fingerprint: string;
  backup: BackupManifest; addedRevisions: number; addedDrafts: number; extraCards: number; retiredGroups: number;
  recoveryGroup: string | null; ambiguousRebases: number; deferredPlacements: number; requiresSafetyBackup: boolean;
  result: { cards: number; groups: number; conflicts: number; pendingRevisions: number };
}
export type BackupProgress = (value: { phase: string; completed: number; total: number }) => void;
export interface BackupSaveInput { bytes: Uint8Array; signal?: AbortSignal; progress?: BackupProgress }
export type BackupSaveResult = { saved: true; receipt: string } | { saved: false; downloaded: true };
/** Trusted file adapter, never renderer proof from arbitrary JSON. Picker must run in the user gesture.
 * Emit save-commit before irreversible publication; finish readback despite late cancellation.
 * Errors after that boundary must state that the destination may already have been written.
 */
export interface BackupFiles {
  canConfirmSave: boolean;
  chooseDestination(input?: { suggestedName?: string; requireConfirmed?: boolean }): Promise<{
    save(input: BackupSaveInput): Promise<BackupSaveResult>;
  }>;
}
/** One CAS transaction for Workspace, receipt and all attachment bytes; reject means no partial publication. */
export type PersistRestoredWorkspace = (state: WorkspaceState, expectedRevision: number,
  attachments: { id: string; bytes: Uint8Array }[]) => Promise<void>;
