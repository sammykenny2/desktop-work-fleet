/** SPEC-010 local record store. Public JSON remains V1; no old workspace conversion is implied. */
export type RecordCollection = 'meta' | 'current' | 'history' | 'draft' | 'outbox' | 'control' | 'job';
export interface LocalRecord {
  collection: RecordCollection;
  /** ASCII identity, 1..256 characters; never a path or a table name. */
  key: string;
  entity: string;
  /** Local commit revision when first recorded; immutable history replay keeps the original position. */
  ordinal: number;
  /** The complete encoded row is at most 8 MiB minus 1 KiB, reserving page framing. */
  value: unknown;
}
export interface RecordTransaction {
  format: 'work-fleet-record-transaction';
  schemaVersion: 1;
  profileId: string;
  revision: number;
  commitId: string;
  /** At most 512 total puts/deletes and 8 MiB encoded JSON. */
  puts: LocalRecord[];
  deletes: Pick<LocalRecord, 'collection' | 'key'>[];
  /** Exact content IDs, counted in the 512-mutation ceiling. Deletion precedes any verified replacement bytes. */
  attachmentDeletes?: string[];
}
export interface RecordReceipt {
  format: 'work-fleet-local-records';
  schemaVersion: 1;
  profileId: string;
  revision: number;
  commitId: string;
  /** Digest of the exact submitted transaction; a matching revision alone is not an acknowledgement. */
  digest: string;
}
export interface RecordQuery {
  order?: 'asc' | 'desc';
  /** Return only collection/key/ordinal through the index, without reading/decrypting values. */
  keysOnly?: boolean;
  collection: RecordCollection;
  entity: string | null;
  after: { ordinal: number; key: string } | null;
  limit: number; // 1..100; response is also bounded by 8 MiB.
  expectedRevision: number | null;
}
export interface RecordPage {
  revision: number | null;
  rows: (LocalRecord | Pick<LocalRecord, 'collection' | 'key' | 'ordinal'>)[];
  next: RecordQuery['after'];
}
export type RecordStatus = RecordReceipt | { format: 'legacy-workspace'; profileId: string } | null;

export interface RecordCommitOptions {
  /** Up to 512 verified attachments, each at most 25 MiB, 128 MiB total. Committed atomically with the rows. */
  attachments?: { id: string; bytes: Uint8Array }[];
}

export interface RecordStore {
  status(profileId: string): Promise<RecordStatus>;
  get(profileId: string, collection: RecordCollection, key: string): Promise<LocalRecord | null>;
  page(profileId: string, query: RecordQuery): Promise<RecordPage>;
  commit(transaction: RecordTransaction, expectedRevision: number | null, options?: RecordCommitOptions): Promise<RecordReceipt>;
  getAttachment(profileId: string, id: string): Promise<Blob | null>;
}

/** WorkspaceRecordStorage layout within a profile. A logical Workspace revision is distinct from a store receipt. */
export interface ActiveWorkspaceGeneration { generation: string; historyGeneration?: string; revision: number; }
// meta/active atomically selects a generation. Other keys start with `<generation>:`.
// meta: one row per non-derived Workspace field; current: full current revision envelopes only;
// draft: one self-contained unsaved baseline/content per draft; outbox: one pending operation per revision;
// history: immutable revision envelopes, indexed by `<generation>:<kind>:<entityId>`.
// Bulk import stages rows in bounded transactions, then switches meta/active. Interrupted staging is not active.
// Loading reads only the selected generation's meta/current/draft indexes. Outbox and history are paged on demand.
export interface CurrentUnsavedBaseline {
  baseRevision: string | null;
  baseContent: { format: string; text: string; [extension: string]: unknown } | null;
}
