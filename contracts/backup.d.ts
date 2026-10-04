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

export interface AutomaticBackupJob {
  id: Id; scheduleId: Id; policyId: Id; destinationId: string; name: string;
  sourceRevision: number; createdAt: number; encrypted: boolean; sha256: string; size: number;
}
export interface AutomaticBackupState {
  schemaVersion: 1; profileId: Id; revision: number; enabled: boolean; paused: boolean;
  settings: null | { scheduleId: Id; policyId: Id; destinationId: string; destinationName: string; encrypted: boolean; keyId: string | null; keep: number };
  inventory: (AutomaticBackupJob & { status: 'verified' | 'unconfirmed' })[];
  pending: AutomaticBackupJob | null;
  lastSuccess: (AutomaticBackupJob & { savedAt: number }) | null;
  lastFailure: { code: string; message: string; failedAt: number } | null;
  failures: number; nextAttemptAt: number;
}
export interface AutomaticBackupJournal {
  load(profileId: Id): Promise<AutomaticBackupState | null>;
  /** One durable CAS; an acknowledgement loss may be reconciled by exact complete readback. */
  save(state: AutomaticBackupState, expectedRevision: number | null): Promise<void>;
}
export type AutomaticFileRequest = AutomaticBackupJob & { profileId: Id; signal?: AbortSignal };
/** Trusted account-bound host. Capability false means operations must not be attempted.
 * No general path/delete endpoint is exposed to the renderer. The destination is a prior OS grant.
 */
export type AutomaticBackupFiles = { canCreate: false; canPrune: false } | ({
  canCreate: true;
  read(job: AutomaticFileRequest): Promise<Uint8Array | null>;
  /** Create-only atomic publication: an existing or racing replacement must never be overwritten.
   * Verify complete bytes before reporting saved; late cancellation follows the actual commit outcome.
   */
  create(job: AutomaticFileRequest & { bytes: Uint8Array }): Promise<{ saved: true; receipt: string }>;
} & ({ canPrune: false } | {
  canPrune: true;
  /** Atomically bind deletion to owned identity and expected bytes; a pathname check followed by unlink is insufficient.
   * An already absent owned file succeeds; changed or unowned files survive. Reject when this cannot be guaranteed.
   */
  remove(job: AutomaticFileRequest): Promise<{ removed: true }>;
}));
export interface BackupVault {
  available: boolean;
  /** Immutable, profile-bound references. Changing the password creates a new key ID and policy generation. */
  /** Native encryptor returns a portable envelope, never the stored password or key bytes. */
  encrypt(input: { profileId: Id; keyId: string; bytes: Uint8Array; signal?: AbortSignal }): Promise<Uint8Array>;
}
