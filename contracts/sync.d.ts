import type { Card, Group, Id, Revision } from './desktop.js';

/** SPEC-004. The envelope is closed; unknown JSON fields inside value are preserved. */
export type RevisionRecord = {
  format: 'work-fleet-revision';
  schemaVersion: 1;
  entityId: Id;
  revisionId: Revision;
  parents: Revision[];
} & ({ kind: 'card'; value: Card } | { kind: 'group'; value: Group });

export interface GraphIngestResult { added: number; pending: Revision[]; missing: Revision[] }
export interface EntityHeads { kind: 'card' | 'group'; entityId: Id; heads: RevisionRecord[] }

export interface FileDescriptor { id: string; kind: 'revision' | 'attachment'; sha256: string; size: number }
export interface UploadReservation { file: FileDescriptor; complete: boolean }
export interface SyncState {
  sourceId: string | null;
  sessionId: Id | null;
  cursor: string | null;
  /** Persisted only after both pulls and all queued uploads complete; absent means unknown. */
  lastSuccessfulSyncAt?: string;
  files?: Record<string, FileDescriptor>;
  /** Keys are revision:<revisionId> or attachment:<sha256>. Persist before createFile. */
  uploads?: Record<string, UploadReservation>;
}
export interface SyncSession { profileId: Id; sourceId: string; sessionId: Id; runtimeId: Id }
export interface ReceiveRevisions {
  session: SyncSession;
  expectedCursor: string | null;
  cursor: string | null;
  files?: FileDescriptor[];
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
  readFile(input: { file: FileDescriptor; signal: AbortSignal }): Promise<Uint8Array>;
  /** Must create only; never replace. Existing ID throws file-exists, not implicit success. */
  createFile(input: { file: FileDescriptor; bytes: Uint8Array; signal: AbortSignal }): Promise<FileDescriptor>;
}
export interface SyncStatus {
  phase: 'idle' | 'syncing' | 'backoff' | 'needs-login' | 'needs-attention' | 'stopped';
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
