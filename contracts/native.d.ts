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
    /** The host stores the display language and reports it in `language`; see docs/i18n.md. */
    languagePreference?: boolean;
    /** The host answers data.location, data.reveal and data.setAside (SPEC-006 DO). */
    dataRecovery?: boolean;
  };
  language?: NativeLanguage;
}
/** The device's display-language setting. 'auto' resolves against `system` with the rules in docs/i18n.md. */
export interface NativeLanguage {
  preference: 'auto' | 'en' | 'zh-TW';
  /** The system's preferred UI languages, most preferred first, as BCP 47 tags. */
  system: string[];
}
export type NativeRecordKind = 'workspace' | 'journal';
export type NativeRequest = { v: 1; id: string } & (
  | import('./desktop-scene.js').DesktopOwnerCall
  | { method: 'host.info' | 'host.ready' | 'host.closeReady'; params: Record<string, never> }
  /** Stores the preference, redraws the host's own menus and dialogs, and replies with the new NativeLanguage. */
  | { method: 'host.language.set'; params: { preference: NativeLanguage['preference'] } }
  | { method: 'transfer.begin'; params: { kind: NativeRecordKind | 'attachment' | 'backup'; size: number; sha256: string } }
  | { method: 'transfer.append'; params: { token: string; offset: number; base64: string } }
  | { method: 'transfer.finish' | 'transfer.discard' | 'storage.putAttachment'; params: { token: string } }
  | { method: 'transfer.read'; params: { token: string; offset: number } }
  | { method: 'storage.load'; params: { kind: NativeRecordKind } }
  /**
   * SPEC-006 DO, after a load the page cannot use: data.location answers { path }, data.reveal opens that folder, and
   * data.setAside moves the database into a dated set-aside folder there and reopens the page on empty data.
   */
  | { method: 'data.location' | 'data.reveal' | 'data.setAside'; params: Record<string, never> }
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
  /** `message` is English; the page shows the catalog text for `code` when it has one (docs/i18n.md). */
  | { ok: false; error: { code: string; message: string } }
);
export interface NativeDownload { token: string; size: number; sha256: string; }
export interface NativeAttachmentPreview { available: boolean; png: string | null; }
// Sealed transfer tokens belong only to the document session that created them.
// The commit stores Workspace + restore receipts + attachments atomically using revision CAS.
// No method grants arbitrary path/SQL/HTTP access or exposes OS-vault plaintext.
