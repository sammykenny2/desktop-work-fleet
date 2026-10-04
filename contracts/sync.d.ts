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

export interface SyncState { sourceId: string | null; sessionId: Id | null; cursor: string | null }
export interface SyncSession { profileId: Id; sourceId: string; sessionId: Id; runtimeId: Id }
export interface ReceiveRevisions {
  session: SyncSession;
  expectedCursor: string | null;
  cursor: string | null;
}
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
