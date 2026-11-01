import type { Card, Group, Id, Revision } from './desktop.js';

/** SPEC-004. The envelope is closed; unknown JSON fields inside value are preserved. */
export type RevisionRecord = {
  format: 'work-fleet-revision';
  schemaVersion: 1;
  entityId: Id;
  revisionId: Revision;
  parents: Revision[];
} & ({ kind: 'card'; value: Card } | { kind: 'group'; value: Group });

/** V1 source file only; stripped before graph ingestion and excluded from portable backup revisions. */
export type SourceRevisionRecord = RevisionRecord & { sourceResetIds?: string[] };

export interface GraphIngestResult { added: number; pending: Revision[]; missing: Revision[] }
export interface EntityHeads { kind: 'card' | 'group'; entityId: Id; heads: RevisionRecord[] }

export interface FileDescriptor { id: string; kind: 'revision' | 'attachment' | 'reset' | 'workspace'; sha256: string; size: number }
export interface InitializationIdentity {
  format: 'work-fleet-workspace'; schemaVersion: 1; workspaceId: string; sourceResetIds: string[];
}
export interface InitializationPlan extends InitializationIdentity {
  phase: 'prepare'; mode: 'starter' | 'existing' | 'restore'; origin: 'bootstrap' | 'reset';
  revisions: { id: Revision; sha256: string }[]; attachments: string[];
}
export interface InitializationReceipt extends InitializationIdentity { phase: 'ready'; planId: string }
export interface InitializationState {
  plans: Record<string, InitializationPlan>; receipts: Record<string, InitializationReceipt>;
  incoming: Record<Revision, RevisionRecord>; activePlan: string | null; expected?: boolean;
  /** Committed with a new receipt/cursor; cleared only after a complete rescan and staged data commit. */
  refreshNeeded?: boolean;
}
/** Stored before the marker or any deletion; survives process restart and lost responses. */
export interface SourceResetJob {
  sourceId: string; marker: FileDescriptor;
  markerValue: { format: 'work-fleet-reset'; schema: 1; resetAt: string; initialization: 'workspace-init-v1' };
  previousResetIds: string[]; plan: InitializationPlan; planId: string;
  phase: 'reset' | 'initialize' | 'upload' | 'complete'; markerPublished: boolean;
  uploads: Record<string, FileDescriptor>; deleted: number; superseded?: boolean;
}
export interface UploadReservation { file: FileDescriptor; complete: boolean }
export interface SyncState {
  sourceId: string | null;
  sessionId: Id | null;
  cursor: string | null;
  /** The established source generation; an empty array still means the initial scan completed before any reset. */
  sourceResetIds?: string[];
  /** Persisted only after both pulls and all queued uploads complete; absent means unknown. */
  lastSuccessfulSyncAt?: string;
  files?: Record<string, FileDescriptor>;
  initialization?: InitializationState;
  /** Keys are revision:<revisionId>, attachment:<sha256> or workspace:<sha256>. Persist before createFile. */
  uploads?: Record<string, UploadReservation>;
}
export interface SyncSession { profileId: Id; sourceId: string; sessionId: Id; runtimeId: Id }
export interface ReceiveRevisions {
  session: SyncSession;
  expectedCursor: string | null;
  cursor: string | null;
  files?: FileDescriptor[];
  workspaceRecords?: (InitializationPlan | InitializationReceipt)[];
  initializationExpected?: boolean; stage?: boolean;
  initializationScanned?: boolean;
  /** Only a marker-only reset follower, without a current plan/receipt or restore job, may forget cleanup descriptors. */
  removedFiles?: string[];
  activatePlan?: string | null; expectedInitialization?: string | null;
}
export interface FileStore {
  /** Immutable account + collection binding, derived from verified native identity. */
  readonly sourceId: string;
  getStartCursor(input: { signal: AbortSignal }): Promise<string>;
  listFiles(input: { pageToken: string | null; signal: AbortSignal }): Promise<{
    files: FileDescriptor[]; nextPageToken?: string | null; incomplete?: boolean;
  }>;
  listChanges(input: { cursor: string; signal: AbortSignal }): Promise<{
    changes: ({ id: string; removed: true } | { id: string; removed: false; file: FileDescriptor })[];
    nextCursor?: string | null; cursor?: string;
  }>;
  allocateFileId(input: { signal: AbortSignal }): Promise<string>;
  listFileIds(input: { pageToken?: string | null; signal?: AbortSignal }): Promise<{
    ids: string[]; resetIds: string[]; nextPageToken?: string | null; incomplete?: boolean;
  }>;
  deleteFile(input: { id: string; signal?: AbortSignal }): Promise<void>;
  readFile(input: { file: FileDescriptor; signal: AbortSignal }): Promise<Uint8Array>;
  /** Must create only; never replace. Existing ID throws file-exists, not implicit success. */
  createFile(input: { file: FileDescriptor; bytes: Uint8Array; signal: AbortSignal }): Promise<FileDescriptor>;
}
export interface SyncStatus {
  phase: 'idle' | 'syncing' | 'waiting-initialization' | 'backoff' | 'needs-login' | 'needs-attention' | 'stopped';
  pending: number;
  nextAttemptAt: number;
  error: { code: string; message: string } | null;
}
/** Trusted service only, not a WebView bridge for arbitrary renderer requests.
 * The account-bound native implementation fixes HTTPS www.googleapis.com, rejects redirects,
 * bounds response bytes while streaming, honors abort and keeps credentials/session URLs private.
 * Content-Length is computed from body bytes by the native HTTP stack. No caller supplies tokens.
 */
export type AuthorizedDriveRequest = (input: {
  path: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  body?: Uint8Array;
  signal?: AbortSignal;
  maxResponseBytes: number;
}) => Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>;
export type ResolveRevisions = {
  entityId: Id;
  heads: Revision[];
  selectedRevision: Revision;
  fromHistory?: boolean;
} & ({ kind: 'card'; patch?: Partial<Pick<Card, 'content' | 'groupId' | 'deleted' | 'archived' | 'completed'>> }
  | { kind: 'group'; patch?: Partial<Pick<Group, 'name' | 'deleted' | 'redirectGroupId'>> });

/** No timestamp winner. All heads remain recoverable until explicitly resolved. */
export interface RevisionConflict {
  kind: 'revision';
  entityKind: 'card' | 'group';
  entityId: Id;
  heads: Revision[];
}

/** SPEC-010: metadata routes bounded reads; checksummed immutable records establish usable content. */
export interface DatasetFile {
  id: string; datasetId: string; parentId: string;
  kind: 'dataset' | 'ready' | 'revision' | 'attachment' | 'change' | 'checkpoint' | 'purge';
  sha256: string; size: number;
  entityId?: string; revisionId?: string; shard?: string;
}
export interface DatasetFolder {
  id: string; datasetId: string; parentId: string; kind: 'dataset-root' | 'folder'; role: string; entityId?: string;
}
export interface DatasetHead { record: RevisionRecord; file: DatasetFile; attachments: DatasetFile[]; }
export type DatasetQuery = { scope: 'datasets' | 'fences' | 'legacy' }
  | { scope: 'ready' | 'roots'; datasetId: string }
  | { scope: 'current'; datasetId: string; shard: string }
  | { scope: 'history' | 'children'; datasetId: string; parentId: string }
  | { scope: 'purges' | 'entity-folders'; datasetId: string; entities: string[] };
export interface DatasetProvider {
  readonly sourceId: string;
  getStartCursor(input?: { signal?: AbortSignal }): Promise<string>;
  allocateFileId(input?: { signal?: AbortSignal }): Promise<string>;
  listObjects(input: { query: DatasetQuery; pageToken?: string | null; signal?: AbortSignal }): Promise<{
    files: (DatasetFile | DatasetFolder | { id: string; kind: string | null })[]; incomplete: boolean; nextPageToken: string | null;
  }>;
  getObject(input: { id: string; signal?: AbortSignal }): Promise<DatasetFile | DatasetFolder>;
  readObject(input: { file: DatasetFile; signal?: AbortSignal }): Promise<Uint8Array>;
  createObject(input: { file: DatasetFile; bytes: Uint8Array; signal?: AbortSignal }): Promise<DatasetFile>;
  createFolder(input: { file: DatasetFolder; signal?: AbortSignal }): Promise<DatasetFolder>;
  deleteFile(input: { id: string; signal?: AbortSignal }): Promise<void>;
  listDatasetChanges(input: { cursor: string; signal?: AbortSignal }): Promise<{
    changes: { id: string; removed: boolean; file?: DatasetFile | DatasetFolder; legacyReset?: boolean }[];
    nextCursor?: string; cursor?: string;
  }>;
}
