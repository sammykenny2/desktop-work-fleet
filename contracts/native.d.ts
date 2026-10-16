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
  maxBackupBytes: 142610432;
  capabilities: {
    nativeStorage: boolean;
    automaticFiles: boolean;
    backupFiles: boolean;
    secureBackup: boolean;
    google: boolean;
    desktopPresentation: boolean;
    attachmentFiles?: boolean;
  };
}
export type NativeRecordKind = 'workspace' | 'journal';
export type NativeRequest = { v: 1; id: string } & (
  | import('./desktop-scene.js').DesktopOwnerCall
  | { method: 'host.info' | 'host.ready' | 'host.closeReady'; params: Record<string, never> }
  | { method: 'transfer.begin'; params: { kind: NativeRecordKind | 'attachment' | 'backup'; size: number; sha256: string } }
  | { method: 'transfer.append'; params: { token: string; offset: number; base64: string } }
  | { method: 'transfer.finish' | 'transfer.discard' | 'storage.putAttachment'; params: { token: string } }
  | { method: 'transfer.read'; params: { token: string; offset: number } }
  | { method: 'storage.load'; params: { kind: NativeRecordKind } }
  | { method: 'storage.attachment'; params: { id: string } }
  /** Only current-profile attachment IDs; no file paths or application commands. */
  | { method: 'attachment.preview' | 'attachment.open'; params: { id: string; name: string } }
  | { method: 'storage.commit'; params: { kind: NativeRecordKind; token: string; expectedRevision: number | null; attachments: string[] } }
  | { method: 'backup.choose' | 'backup.manual.choose'; params: Record<string, never> }
  | { method: 'backup.authorize'; params: { destinationId: string } }
  | { method: 'backup.manual.save'; params: { destinationId: string; token: string } }
  | { method: 'backup.create'; params: import('./backup.js').AutomaticBackupJob & { token: string; profileId: string } }
  | { method: 'backup.read' | 'backup.remove'; params: import('./backup.js').AutomaticBackupJob & { profileId: string } }
  | { method: 'backup.key.create'; params: { password: string } }
  | { method: 'backup.encrypt'; params: { token: string; keyId: string } }
);
export type NativeReply = { v: 1; id: string } & (
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } }
);
export interface NativeDownload { token: string; size: number; sha256: string; }
export interface NativeAttachmentPreview { available: boolean; png: string | null; }
// Sealed transfer tokens belong only to the document session that created them.
// The commit stores Workspace + restore receipts + attachments atomically using revision CAS.
// No method grants arbitrary path/SQL/HTTP access or exposes OS-vault plaintext.
