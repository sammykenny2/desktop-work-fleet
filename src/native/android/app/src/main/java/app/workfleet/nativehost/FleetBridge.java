package app.workfleet.nativehost;

import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;

final class FleetBridge implements AutoCloseable {
    private static final class Transfer {
        final String kind, digest; final int size; final WipingBuffer bytes = new WipingBuffer(); final byte[] download; long used = System.currentTimeMillis();
        Transfer(String kind, int size, String digest, byte[] data) { this.kind = kind; this.size = size; this.digest = digest; download = data == null ? null : data.clone(); }
    }
    private static final class WipingBuffer extends ByteArrayOutputStream { @Override public synchronized void reset() { Arrays.fill(buf, (byte) 0); super.reset(); } }
    private final FleetDatabase database;
    private final FleetActivity activity;
    private final BackupFiles backups;
    private final HashMap<String, Transfer> transfers = new HashMap<>();
    private final HashSet<String> staged = new HashSet<>();
    private boolean closed;
    boolean ready, closeReady;
    FleetBridge(FleetDatabase database, FleetActivity activity) throws Exception { this.database = database; this.activity = activity; backups = new BackupFiles(activity, database); }
    synchronized Object invoke(String method, JSONObject args) throws Exception {
        Protocol.require(!closed, "native-closed", "原生工作空間已關閉。"); sweep();
        if (method.startsWith("backup.")) return backups.invoke(method, args, this);
        switch (method) {
            case "host.info": return Protocol.object("protocol", 1, "platform", "android", "profileId", database.profile, "storage", "sqlite-keystore",
                "maxChunkBytes", Protocol.CHUNK, "maxMessageBytes", 1024 * 1024, "maxRecordBytes", Protocol.RECORD, "maxAttachmentBytes", Protocol.ATTACHMENT, "maxBackupBytes", Protocol.BACKUP,
                "capabilities", Protocol.object("nativeStorage", true, "automaticFiles", true, "backupFiles", true, "secureBackup", true, "google", activity.googleConfigured(), "desktopPresentation", false, "fileExport", true, "fileShare", true, "shareInbox", activity.capturesAvailable()));
            case "host.ready": ready = true; return null;
            case "host.closeReady": closeReady = true; return null;
            case "host.closeCancel": closeReady = false; return null;
            case "transfer.begin": {
                String kind = Protocol.text(args, "kind", 32), digest = Protocol.text(args, "sha256", 64); Protocol.digest(digest);
                Protocol.require(kind.equals("workspace") || kind.equals("journal") || kind.equals("attachment") || kind.equals("backup"), "invalid-transfer", "傳輸種類無效。");
                int maximum = kind.equals("backup") ? Protocol.BACKUP : kind.equals("attachment") ? Protocol.ATTACHMENT : Protocol.RECORD;
                return Protocol.object("token", add(new Transfer(kind, (int) Protocol.number(args, "size", maximum), digest, null)));
            }
            case "transfer.append": {
                Transfer value = transfer(Protocol.text(args, "token", 36)); long offset = Protocol.number(args, "offset", Protocol.BACKUP);
                Protocol.require(!value.kind.equals("download") && offset == value.bytes.size(), "transfer-offset", "傳輸順序不符。");
                byte[] chunk = Base64.decode(Protocol.text(args, "base64", Protocol.CHUNK * 4 / 3 + 4), Base64.DEFAULT);
                try { Protocol.require(chunk.length > 0 && chunk.length <= Protocol.CHUNK && value.bytes.size() + chunk.length <= value.size, "transfer-size", "傳輸容量超限。"); value.bytes.write(chunk); return Protocol.object("offset", value.bytes.size()); }
                finally { Arrays.fill(chunk, (byte) 0); }
            }
            case "transfer.finish": {
                String token = Protocol.text(args, "token", 36); Transfer value = transfer(token);
                Protocol.require(!value.kind.equals("download") && value.bytes.size() == value.size, "transfer-incomplete", "傳輸尚未完整。"); byte[] bytes = value.bytes.toByteArray();
                try { String sealed = database.stage(value.kind, bytes, value.digest); staged.add(sealed); drop(token); return Protocol.object("token", sealed); }
                finally { Arrays.fill(bytes, (byte) 0); }
            }
            case "transfer.discard": { String token = Protocol.text(args, "token", 36); drop(token); if (staged.remove(token)) database.discard(token); return null; }
            case "transfer.read": {
                Transfer value = transfer(Protocol.text(args, "token", 36)); int offset = (int) Protocol.number(args, "offset", Protocol.BACKUP);
                Protocol.require(value.kind.equals("download") && offset <= value.size, "invalid-transfer", "下載位置無效。");
                int count = Math.min(Protocol.CHUNK, value.size - offset);
                return Protocol.object("offset", offset, "base64", Base64.encodeToString(value.download, offset, count, Base64.NO_WRAP), "done", offset + count == value.size);
            }
            case "storage.reset": {
                for (String token : new HashSet<>(transfers.keySet())) drop(token);
                staged.clear(); database.reset(); return Protocol.object("profileId", database.profile);
            }
            case "storage.load": return download(database.record(Protocol.text(args, "kind", 32)));
            case "storage.attachment": return download(database.attachment(Protocol.text(args, "id", 64)));
            case "storage.putAttachment": { String token = owned(args); String id = database.putAttachment(token); staged.remove(token); return Protocol.object("id", id); }
            case "storage.commit": {
                String token = owned(args); JSONArray attachments = args.optJSONArray("attachments"); if (attachments == null) attachments = new JSONArray();
                for (int i = 0; i < attachments.length(); i++) Protocol.require(staged.contains(attachments.getString(i)), "transfer-missing", "附件傳輸不屬於此視窗。");
                Protocol.require(args.has("expectedRevision"), "invalid-request", "缺少版本條件。");
                Long expected = args.isNull("expectedRevision") ? null : Protocol.number(args, "expectedRevision", Protocol.SAFE_INTEGER);
                Protocol.require(!args.has("replaceAttachments") || args.get("replaceAttachments") instanceof Boolean, "invalid-request", "布林欄位無效。");
                database.commit(Protocol.text(args, "kind", 32), token, expected, attachments, args.optBoolean("replaceAttachments", false)); staged.remove(token);
                for (int i = 0; i < attachments.length(); i++) staged.remove(attachments.getString(i)); return null;
            }
            default: throw new Protocol.Failure("unsupported-method", "原生主機沒有此操作。");
        }
    }
    synchronized byte[] upload(JSONObject args, String kind) throws Exception { return database.staged(owned(args), kind); }
    private String owned(JSONObject args) throws Exception { String token = Protocol.text(args, "token", 36); Protocol.require(staged.contains(token), "transfer-missing", "原生傳輸不屬於此視窗。"); return token; }
    synchronized Object download(byte[] bytes) throws Exception {
        if (bytes == null) return null;
        try { String digest = Protocol.digest(bytes); return Protocol.object("token", add(new Transfer("download", bytes.length, digest, bytes)), "size", bytes.length, "sha256", digest); }
        finally { Arrays.fill(bytes, (byte) 0); }
    }
    private String add(Transfer value) throws Exception {
        long total = value.size; for (Transfer item : transfers.values()) total += item.size;
        Protocol.require(transfers.size() < 8 && total <= 256L * 1024 * 1024, "transfer-busy", "原生傳輸忙碌。"); String id = Protocol.uuid(); transfers.put(id, value); return id;
    }
    private Transfer transfer(String token) throws Exception { Transfer value = transfers.get(token); Protocol.require(value != null, "transfer-missing", "原生傳輸已失效。"); value.used = System.currentTimeMillis(); return value; }
    private void drop(String token) { Transfer value = transfers.remove(token); if (value != null) { value.bytes.reset(); if (value.download != null) Arrays.fill(value.download, (byte) 0); } }
    private void sweep() { for (String id : new HashSet<>(transfers.keySet())) if (System.currentTimeMillis() - transfers.get(id).used > 300000) drop(id); }
    @Override public synchronized void close() { closed = true; for (String token : staged) database.discard(token); staged.clear(); for (String token : new HashSet<>(transfers.keySet())) drop(token); }
}
