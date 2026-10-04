/** Host authenticates exact main document and owns profile, paths, database and secret keys. */
export interface NativeHostInfo {
  protocol: 1;
  platform: 'windows';
  profileId: string;
  storage: 'sqlite-dpapi';
  maxChunkBytes: 262144;
  maxMessageBytes: 1048576;
  maxRecordBytes: 134217728;
  maxAttachmentBytes: 26214400;
  capabilities: {
    nativeStorage: boolean;
    automaticFiles: boolean;
    secureBackup: boolean;
    google: boolean;
    desktopPresentation: boolean;
  };
}
export type NativeRecordKind = 'workspace' | 'journal';
export type NativeRequest = { v: 1; id: string } & (
  | { method: 'host.info' | 'host.ready' | 'host.closeReady'; params: Record<string, never> }
  | { method: 'transfer.begin'; params: { kind: NativeRecordKind | 'attachment'; size: number; sha256: string } }
  | { method: 'transfer.append'; params: { token: string; offset: number; base64: string } }
  | { method: 'transfer.finish' | 'transfer.discard' | 'storage.putAttachment'; params: { token: string } }
  | { method: 'transfer.read'; params: { token: string; offset: number } }
  | { method: 'storage.load'; params: { kind: NativeRecordKind } }
  | { method: 'storage.attachment'; params: { id: string } }
  | { method: 'storage.commit'; params: { kind: NativeRecordKind; token: string; expectedRevision: number | null; attachments: string[] } }
);
export type NativeReply = { v: 1; id: string } & (
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } }
);
export interface NativeDownload { token: string; size: number; sha256: string; }
// Sealed transfer tokens belong only to the document session that created them.
// The commit stores Workspace + restore receipts + attachments atomically using revision CAS.
// No method grants arbitrary path/SQL/HTTP access or exposes OS-vault plaintext.
