package app.workfleet.nativehost;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.HashMap;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

final class BackupFiles {
    private final FleetActivity activity;
    private final FleetDatabase database;
    private final ContentResolver resolver;
    private final HashMap<String, String> manual = new HashMap<>();
    private static final String[] JOB_FIELDS = { "id", "scheduleId", "policyId", "destinationId", "name", "sourceRevision", "createdAt", "encrypted", "sha256", "size" };
    BackupFiles(FleetActivity activity, FleetDatabase database) { this.activity = activity; this.database = database; resolver = activity.getContentResolver(); }
    private JSONObject load(String kind, String id) throws Exception { byte[] bytes = database.secret(kind, id); Protocol.require(bytes != null, "backup-permission", "備份原生授權不存在，請重新選擇位置。"); try { return Protocol.json(bytes); } finally { Arrays.fill(bytes, (byte) 0); } }
    private void save(String kind, String id, JSONObject value) throws Exception { database.secret(kind, id, value.toString().getBytes(StandardCharsets.UTF_8)); }
    private Uri directory(String id) throws Exception {
        Uri tree = Uri.parse(Protocol.text(load("backup-directory", id), "uri", 8192));
        Protocol.require(tree.getScheme().equals("content"), "backup-permission", "備份位置無效。");
        Uri root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor cursor = resolver.query(root, new String[] { DocumentsContract.Document.COLUMN_MIME_TYPE }, null, null, null)) {
            Protocol.require(cursor != null && cursor.moveToFirst() && cursor.getString(0).equals(DocumentsContract.Document.MIME_TYPE_DIR), "backup-permission", "備份資料夾已失效。");
        }
        return tree;
    }
    private boolean contains(Uri tree, String name) throws Exception {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor cursor = resolver.query(children, new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            Protocol.require(cursor != null, "backup-permission", "無法讀取備份資料夾。"); while (cursor.moveToNext()) if (name.equals(cursor.getString(0))) return true;
        }
        return false;
    }
    private Uri create(Uri tree, String name) throws Exception {
        Protocol.require(!contains(tree, name), "backup-file-unowned", "同名檔案已存在，未覆寫。");
        Uri root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        Uri file = DocumentsContract.createDocument(resolver, root, "application/zip", name);
        Protocol.require(file != null && file.getAuthority().equals(tree.getAuthority()), "backup-create-unavailable", "無法建立備份檔案。");
        try (Cursor cursor = resolver.query(file, new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            Protocol.require(cursor != null && cursor.moveToFirst() && cursor.getString(0).equals(name), "backup-unconfirmed", "文件提供者變更了檔名，保留新檔供檢查。");
        }
        return file;
    }
    private byte[] read(Uri file) throws Exception {
        try (InputStream stream = resolver.openInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            Protocol.require(stream != null, "backup-permission", "無法讀取備份。"); byte[] chunk = new byte[65536]; int count;
            while ((count = stream.read(chunk)) >= 0) { Protocol.require(output.size() + count <= Protocol.BACKUP, "backup-limit", "備份容量超限。"); output.write(chunk, 0, count); }
            return output.toByteArray();
        }
    }
    private void write(Uri file, byte[] bytes) throws Exception {
        try (ParcelFileDescriptor descriptor = resolver.openFileDescriptor(file, "w")) {
            Protocol.require(descriptor != null, "backup-create-unavailable", "無法寫入新備份檔案。");
            try (FileOutputStream stream = new FileOutputStream(descriptor.getFileDescriptor())) { stream.write(bytes); stream.flush(); stream.getFD().sync(); }
        }
        byte[] saved = read(file); try { Protocol.require(Arrays.equals(bytes, saved), "backup-unconfirmed", "備份內容尚未確認，保留檔案供檢查。"); } finally { Arrays.fill(saved, (byte) 0); }
    }
    private static JSONObject job(JSONObject value) throws Exception {
        JSONObject job = new JSONObject(); for (String field : JOB_FIELDS) job.put(field, value.get(field));
        for (String field : new String[] { "id", "scheduleId", "policyId", "destinationId" }) Protocol.require(Protocol.uuid(Protocol.text(job, field, 36)), "invalid-backup-job", "備份工作身分無效。");
        Protocol.require(Protocol.text(job, "name", 100).equals("work-fleet-auto-" + job.getString("id") + ".zip"), "invalid-backup-job", "備份檔名無效。");
        Protocol.number(job, "sourceRevision", Protocol.SAFE_INTEGER); Protocol.number(job, "createdAt", Protocol.SAFE_INTEGER); Protocol.bool(job, "encrypted");
        Protocol.digest(Protocol.text(job, "sha256", 64)); Protocol.require(Protocol.number(job, "size", Protocol.BACKUP) > 0, "invalid-backup-job", "備份容量無效。"); return job;
    }
    private static boolean same(JSONObject a, JSONObject b) throws Exception { for (String field : JOB_FIELDS) if (!a.get(field).equals(b.get(field))) return false; return true; }
    private JSONObject journal(JSONObject job, String operation) throws Exception {
        byte[] bytes = database.record("journal"); Protocol.require(bytes != null, "backup-job-unowned", "備份排程尚未保存。"); JSONObject journal;
        try { journal = Protocol.json(bytes); } finally { Arrays.fill(bytes, (byte) 0); }
        Protocol.require(journal.getString("profileId").equals(database.profile), "backup-profile", "備份帳號已切換。");
        JSONObject pending = journal.optJSONObject("pending"); boolean isPending = pending != null && same(job(pending), job); JSONObject matching = null; int matches = 0;
        JSONArray inventory = journal.getJSONArray("inventory"); Protocol.require(inventory.length() <= 10000, "invalid-backup-journal", "備份紀錄數量超限。");
        for (int i = 0; i < inventory.length(); i++) if (same(job(inventory.getJSONObject(i)), job)) { matching = inventory.getJSONObject(i); matches++; }
        Protocol.require(operation.equals("create") ? isPending : isPending || matches == 1, "backup-job-unowned", "備份工作不在目前排程中。");
        if (!operation.equals("remove")) return null;
        JSONObject latest = job(journal.getJSONObject("lastSuccess")), settings = journal.getJSONObject("settings");
        Protocol.require(matches == 1 && matching.getString("status").equals("verified") && !isPending && !latest.getString("id").equals(job.getString("id"))
            && latest.getString("scheduleId").equals(job.getString("scheduleId")) && latest.getString("destinationId").equals(job.getString("destinationId"))
            && settings.getString("scheduleId").equals(job.getString("scheduleId")) && settings.getString("destinationId").equals(job.getString("destinationId")), "backup-retention", "備份不符合清理條件，已保留。"); return latest;
    }
    private JSONObject owned(JSONObject job) throws Exception {
        byte[] bytes = database.secret("backup-file", job.getString("id")); if (bytes == null) return null;
        try { JSONObject metadata = Protocol.json(bytes); Protocol.require(same(job(metadata.getJSONObject("job")), job), "backup-file-unowned", "原生檔案身分不符。"); return metadata; }
        finally { Arrays.fill(bytes, (byte) 0); }
    }
    private byte[] verified(JSONObject job, JSONObject metadata) throws Exception {
        Protocol.require(metadata != null, "backup-file-unowned", "備份缺少原生建立紀錄。"); byte[] bytes = read(Uri.parse(metadata.getString("uri")));
        Protocol.require(bytes.length == job.getInt("size") && Protocol.digest(bytes).equals(job.getString("sha256")), "backup-unconfirmed", "備份檔案內容已改變，未清理。"); return bytes;
    }
    Object invoke(String method, JSONObject args, FleetBridge bridge) throws Exception {
        if (args.has("profileId")) Protocol.require(args.getString("profileId").equals(database.profile), "backup-profile", "備份帳號已切換。");
        switch (method) {
            case "backup.choose": case "backup.manual.choose": {
                Uri tree = activity.chooseDirectory(); String id = Protocol.uuid(); String name = "已授權的備份資料夾";
                save("backup-directory", id, Protocol.object("uri", tree.toString())); directory(id);
                if (method.equals("backup.choose")) return Protocol.object("destinationId", id, "destinationName", name);
                String grant = Protocol.uuid(); manual.put(grant, id); return Protocol.object("destinationId", grant, "name", "work-fleet-backup-" + grant + ".zip");
            }
            case "backup.authorize": directory(Protocol.text(args, "destinationId", 36)); return null;
            case "backup.manual.save": {
                String grant = Protocol.text(args, "destinationId", 36), destination = manual.remove(grant);
                Protocol.require(destination != null, "backup-permission", "請重新選擇備份位置。"); byte[] bytes = bridge.upload(args, "backup");
                try { Uri file = create(directory(destination), "work-fleet-backup-" + grant + ".zip"); write(file, bytes); return Protocol.object("saved", true, "receipt", Protocol.uuid()); }
                finally { Arrays.fill(bytes, (byte) 0); }
            }
            case "backup.create": {
                JSONObject job = job(args); journal(job, "create"); Uri tree = directory(job.getString("destinationId")); byte[] bytes = bridge.upload(args, "backup");
                try {
                    Protocol.require(bytes.length == job.getInt("size") && Protocol.digest(bytes).equals(job.getString("sha256")), "backup-integrity", "备份內容與工作不符。");
                    JSONObject previous = owned(job);
                    if (previous != null) { byte[] existing = verified(job, previous); Arrays.fill(existing, (byte) 0); }
                    else { Uri file = create(tree, job.getString("name")); save("backup-file", job.getString("id"), Protocol.object("job", job, "uri", file.toString())); write(file, bytes); }
                    return Protocol.object("saved", true, "receipt", job.getString("id"));
                } finally { Arrays.fill(bytes, (byte) 0); }
            }
            case "backup.read": {
                JSONObject job = job(args); journal(job, "read"); Uri tree = directory(job.getString("destinationId")); JSONObject metadata = owned(job);
                if (metadata == null) { Protocol.require(!contains(tree, job.getString("name")), "backup-file-unowned", "同名檔案未確認，已保留。"); return null; }
                return bridge.download(verified(job, metadata));
            }
            case "backup.remove": {
                JSONObject job = job(args), latest = journal(job, "remove"); directory(job.getString("destinationId")); JSONObject metadata = owned(job);
                byte[] newest = verified(latest, owned(latest)); Arrays.fill(newest, (byte) 0); byte[] old = verified(job, metadata); Arrays.fill(old, (byte) 0);
                Protocol.require(DocumentsContract.deleteDocument(resolver, Uri.parse(metadata.getString("uri"))), "backup-permission", "備份尚未刪除。"); database.forget("backup-file", job.getString("id")); return Protocol.object("removed", true);
            }
            case "backup.key.create": {
                String password = Protocol.text(args, "password", 1024); Protocol.require(password.codePointCount(0, password.length()) >= 12, "backup-password", "備份密碼至少 12 個字元。");
                String id = Protocol.uuid(); byte[] bytes = password.getBytes(StandardCharsets.UTF_8); try { database.secret("backup-key", id, bytes); } finally { Arrays.fill(bytes, (byte) 0); } return Protocol.object("keyId", id);
            }
            case "backup.encrypt": {
                byte[] bytes = bridge.upload(args, "backup"), password = database.secret("backup-key", Protocol.text(args, "keyId", 36));
                try { Protocol.require(password != null, "backup-key-unavailable", "加密金鑰不存在，未改存明文。"); return bridge.download(encrypt(bytes, password)); }
                finally { Arrays.fill(bytes, (byte) 0); if (password != null) Arrays.fill(password, (byte) 0); }
            }
            default: throw new Protocol.Failure("unsupported-method", "備份主機沒有此操作。");
        }
    }
    private static String hex(byte[] bytes) { StringBuilder value = new StringBuilder(); for (byte item : bytes) value.append(String.format(java.util.Locale.ROOT, "%02x", item & 255)); return value.toString(); }
    private static byte[] encrypt(byte[] plaintext, byte[] password) throws Exception {
        Protocol.require(plaintext.length > 0 && plaintext.length <= 136 * 1024 * 1024, "backup-limit", "待加密備份容量超限。");
        byte[] salt = new byte[16], nonce = new byte[12]; SecureRandom random = new SecureRandom(); random.nextBytes(salt); random.nextBytes(nonce);
        byte[] aad = ("{\"cipher\":\"AES-256-GCM\",\"format\":\"work-fleet-encrypted-backup\",\"iterations\":600000,\"kdf\":\"PBKDF2-HMAC-SHA256\",\"nonce\":\"" + hex(nonce) + "\",\"salt\":\"" + hex(salt) + "\",\"schemaVersion\":1,\"tagBits\":128}").getBytes(StandardCharsets.UTF_8);
        Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(password, "HmacSHA256")); byte[] first = Arrays.copyOf(salt, salt.length + 4); first[first.length - 1] = 1;
        byte[] u = mac.doFinal(first), key = u.clone();
        try {
            for (int i = 1; i < 600000; i++) { byte[] next = mac.doFinal(u); Arrays.fill(u, (byte) 0); u = next; for (int j = 0; j < key.length; j++) key[j] ^= u[j]; }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce)); cipher.updateAAD(aad);
            byte[] ciphertext = cipher.doFinal(plaintext);
            try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                try (ZipOutputStream zip = new ZipOutputStream(output)) { entry(zip, "encryption.json", aad); entry(zip, "payload.bin", ciphertext); }
                Protocol.require(output.size() <= Protocol.BACKUP, "backup-limit", "加密備份容量超限。"); return output.toByteArray();
            } finally { Arrays.fill(ciphertext, (byte) 0); }
        } finally { Arrays.fill(key, (byte) 0); Arrays.fill(u, (byte) 0); }
    }
    private static void entry(ZipOutputStream zip, String name, byte[] bytes) throws Exception {
        ZipEntry entry = new ZipEntry(name); entry.setMethod(ZipEntry.STORED); entry.setTime(315532800000L); entry.setSize(bytes.length); entry.setCompressedSize(bytes.length);
        CRC32 crc = new CRC32(); crc.update(bytes); entry.setCrc(crc.getValue()); zip.putNextEntry(entry); zip.write(bytes); zip.closeEntry();
    }
}
