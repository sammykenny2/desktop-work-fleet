package app.workfleet.nativehost;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;

final class CaptureInbox {
    private final Context context;
    private final File root;
    private final SecretKey key;
    private static final int TEXT = 256 * 1024, META = 2 * 1024 * 1024;
    CaptureInbox(Context context) throws Exception {
        this.context = context; root = new File(context.getNoBackupFilesDir(), "captures");
        Protocol.require(root.isDirectory() || root.mkdirs(), "capture-unavailable", "無法開啟分享收件匣。");
        KeyStore vault = KeyStore.getInstance("AndroidKeyStore"); vault.load(null); String alias = "work-fleet-capture-v1";
        if (!vault.containsAlias(alias)) {
            File[] previous = root.listFiles(); Protocol.require(previous != null && previous.length == 0, "capture-unavailable", "分享收件匣金鑰遺失，原內容仍保留。");
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build()); generator.generateKey();
        }
        key = (SecretKey) vault.getKey(alias, null);
    }
    private byte[] crypt(byte[] bytes, String scope, boolean encrypt) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        if (encrypt) cipher.init(Cipher.ENCRYPT_MODE, key);
        else { Protocol.require(bytes.length >= 28, "capture-damaged", "分享內容無法讀取，原檔仍保留。"); cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, bytes, 0, 12)); }
        cipher.updateAAD((context.getPackageName() + ":capture:" + scope).getBytes(StandardCharsets.UTF_8));
        if (!encrypt) return cipher.doFinal(bytes, 12, bytes.length - 12);
        byte[] sealed = cipher.doFinal(bytes), result = new byte[12 + sealed.length];
        System.arraycopy(cipher.getIV(), 0, result, 0, 12); System.arraycopy(sealed, 0, result, 12, sealed.length); return result;
    }
    private File folder(String id) throws Exception {
        Protocol.require(Protocol.uuid(id), "capture-id", "分享項目身分無效。"); File folder = new File(root, id);
        Protocol.require(folder.getCanonicalFile().getParentFile().equals(root.getCanonicalFile()), "capture-id", "分享項目位置無效。"); return folder;
    }
    private byte[] read(File file, int maximum) throws Exception {
        Protocol.require(file.isFile() && file.length() <= maximum, "capture-damaged", "分享內容容量或格式無效。");
        try (FileInputStream stream = new FileInputStream(file)) { return Protocol.bytes(stream, maximum); }
    }
    private void write(File file, byte[] bytes) throws Exception {
        AtomicFile destination = new AtomicFile(file); FileOutputStream stream = destination.startWrite();
        try { stream.write(bytes); destination.finishWrite(stream); }
        catch (Exception error) { destination.failWrite(stream); throw error; }
    }
    private JSONObject item(String id) throws Exception {
        byte[] encoded = read(new File(folder(id), "item"), META + 28), bytes = crypt(encoded, id + ":item", false);
        try { JSONObject value = Protocol.json(bytes); Protocol.require(value.optInt("v") == 1 && id.equals(value.optString("id")), "capture-damaged", "分享內容版本或身分無效。"); value.put("receipt", Protocol.digest(encoded)); return value; }
        finally { Arrays.fill(bytes, (byte) 0); }
    }
    synchronized boolean offer(Intent intent, String id) throws Exception {
        String action = intent.getAction(); if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return false;
        File destination = folder(id); if (new File(destination, "item").isFile()) return true;
        long existing = 0; int count = 0; File[] folders = root.listFiles();
        if (folders != null) for (File entry : folders) {
            if (!entry.isDirectory() || !Protocol.uuid(entry.getName())) continue; count++;
            File[] files = entry.listFiles(); if (files != null) for (File file : files) existing += file.length();
        }
        Protocol.require(count < 64 && existing < 512L * 1024 * 1024 - Protocol.ATTACHMENT - META, "capture-capacity", "分享收件匣已滿，請先接收或捨棄既有項目。");
        CharSequence shared = Intent.ACTION_SEND_MULTIPLE.equals(action) ? null : intent.getCharSequenceExtra(Intent.EXTRA_TEXT); String text = shared == null ? "" : shared.toString();
        if (Intent.ACTION_SEND_MULTIPLE.equals(action) && text.isEmpty()) {
            ArrayList<CharSequence> texts = intent.getCharSequenceArrayListExtra(Intent.EXTRA_TEXT);
            if (texts != null) { Protocol.require(texts.size() <= 16, "capture-capacity", "分享文字項目過多。"); StringBuilder joined = new StringBuilder(); for (CharSequence part : texts) if (part != null) { Protocol.require(joined.length() + part.length() <= TEXT, "capture-capacity", "分享文字容量超限。"); if (joined.length() > 0) joined.append('\n'); joined.append(part); } text = joined.toString(); }
        }
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (subject != null && !subject.isEmpty() && !subject.equals(text)) text = subject + (text.isEmpty() ? "" : "\n\n" + text);
        Protocol.require(text.getBytes(StandardCharsets.UTF_8).length <= TEXT, "capture-capacity", "分享文字容量超限。");
        LinkedHashSet<Uri> uris = new LinkedHashSet<>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(action)) { ArrayList<Uri> values = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM); if (values != null) uris.addAll(values); }
        else { Uri value = intent.getParcelableExtra(Intent.EXTRA_STREAM); if (value != null) uris.add(value); }
        if (intent.getClipData() != null) for (int index = 0; index < intent.getClipData().getItemCount(); index++) { Uri value = intent.getClipData().getItemAt(index).getUri(); if (value != null) uris.add(value); }
        Protocol.require(uris.size() <= 16 && (!text.isEmpty() || !uris.isEmpty()), "capture-capacity", "分享內容為空或檔案數量超限。");
        Protocol.require(destination.isDirectory() || destination.mkdir(), "capture-unavailable", "無法保存分享內容。");
        JSONArray attachments = new JSONArray(); int total = 0;
        try {
            for (Uri uri : uris) {
                Protocol.require(uri != null && "content".equals(uri.getScheme()), "capture-source", "分享檔案必須由系統文件提供者授權。");
                String name = "shared-file";
                try (Cursor cursor = context.getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) { if (cursor != null && cursor.moveToFirst()) { String display = cursor.getString(0); if (display != null) name = FleetExports.filename(display); } }
                byte[] bytes;
                try (java.io.InputStream stream = context.getContentResolver().openInputStream(uri)) { Protocol.require(stream != null, "capture-source", "無法讀取分享檔案。"); bytes = Protocol.bytes(stream, Protocol.ATTACHMENT - total); }
                try {
                    total += bytes.length; String fileId = Protocol.uuid(), digest = Protocol.digest(bytes);
                    write(new File(destination, fileId), crypt(bytes, id + ":file:" + fileId, true));
                    String type = context.getContentResolver().getType(uri); if (type == null || type.length() > 160) type = "application/octet-stream";
                    attachments.put(Protocol.object("fileId", fileId, "id", digest, "name", name, "type", type, "size", bytes.length));
                } finally { Arrays.fill(bytes, (byte) 0); }
            }
            JSONObject metadata = Protocol.object("v", 1, "id", id, "text", text, "receivedAt", System.currentTimeMillis(), "attachments", attachments);
            byte[] bytes = metadata.toString().getBytes(StandardCharsets.UTF_8); Protocol.require(bytes.length <= META, "capture-capacity", "分享內容容量超限。");
            try { write(new File(destination, "item"), crypt(bytes, id + ":item", true)); } finally { Arrays.fill(bytes, (byte) 0); }
            return true;
        } catch (Exception error) { File[] files = destination.listFiles(); if (files != null) for (File file : files) file.delete(); destination.delete(); throw error; }
    }
    synchronized Object invoke(String method, JSONObject args, FleetBridge bridge) throws Exception {
        if (method.equals("capture.list")) {
            JSONArray values = new JSONArray(); File[] folders = root.listFiles();
            if (folders != null) for (File folder : folders) {
                if (!Protocol.uuid(folder.getName()) || !new File(folder, "item").isFile()) continue;
                Protocol.require(values.length() < 64, "capture-capacity", "分享收件匣超過支援數量。");
                try { JSONObject value = item(folder.getName()); String preview = value.optString("text"); values.put(Protocol.object("id", value.getString("id"), "receipt", value.getString("receipt"), "preview", preview.substring(0, Math.min(110, preview.length())), "fileCount", value.getJSONArray("attachments").length(), "receivedAt", value.getLong("receivedAt"))); }
                catch (Exception error) { values.put(Protocol.object("id", folder.getName(), "receipt", Protocol.digest(read(new File(folder, "item"), META + 28)), "preview", "分享內容無法讀取", "fileCount", 0, "receivedAt", folder.lastModified(), "damaged", true)); }
            }
            return values;
        }
        String id = Protocol.text(args, "id", 36);
        if (method.equals("capture.item")) return bridge.download(item(id).toString().getBytes(StandardCharsets.UTF_8));
        if (method.equals("capture.attachment")) {
            String fileId = Protocol.text(args, "fileId", 36); Protocol.require(Protocol.uuid(fileId), "capture-id", "分享檔案身分無效。");
            JSONArray attachments = item(id).getJSONArray("attachments"); JSONObject expected = null;
            for (int index = 0; index < attachments.length(); index++) if (fileId.equals(attachments.getJSONObject(index).optString("fileId"))) expected = attachments.getJSONObject(index);
            Protocol.require(expected != null, "capture-source", "分享檔案不屬於此項目。");
            byte[] bytes = crypt(read(new File(folder(id), fileId), Protocol.ATTACHMENT + 28), id + ":file:" + fileId, false);
            try { Protocol.require(bytes.length == expected.getInt("size") && Protocol.digest(bytes).equals(expected.getString("id")), "capture-damaged", "分享檔案校驗失敗。"); return bridge.download(bytes); }
            finally { Arrays.fill(bytes, (byte) 0); }
        }
        if (method.equals("capture.ack")) {
            File folder = folder(id), manifest = new File(folder, "item"); if (!manifest.exists()) return null;
            Protocol.require(Protocol.digest(read(manifest, META + 28)).equals(Protocol.text(args, "receipt", 64)), "capture-stale", "分享內容已變更，請重新開啟收件匣。");
            File[] files = folder.listFiles(); if (files != null) for (File file : files) { if (file.equals(manifest)) continue; Protocol.require(file.getCanonicalFile().getParentFile().equals(folder.getCanonicalFile()) && file.isFile() && file.delete(), "capture-unavailable", "分享內容尚未完整清除，已存草稿仍保留。"); }
            Protocol.require(manifest.delete(), "capture-unavailable", "分享內容尚未清除，已存草稿仍保留。");
            Protocol.require(folder.delete(), "capture-unavailable", "分享項目尚未清除，已存草稿仍保留。"); return null;
        }
        throw new Protocol.Failure("unsupported-method", "分享收件匣沒有此操作。");
    }
}
