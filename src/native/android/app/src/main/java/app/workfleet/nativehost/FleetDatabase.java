package app.workfleet.nativehost;

import android.content.Context;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.CursorWindow;
import android.database.sqlite.SQLiteCursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;

final class FleetDatabase implements AutoCloseable {
    private final SQLiteOpenHelper helper;
    private final SQLiteDatabase db;
    private final SecretKey key;
    private final RandomAccessFile owner;
    private final FileLock lock;
    private final RecordStore records;
    final String profile;
    FleetDatabase(Context context, String profile) throws Exception {
        this.profile = profile;
        Protocol.require(profile.equals("local") || profile.matches("google:[A-Za-z0-9_-]{1,255}"), "invalid-profile", "The workspace ID is invalid.");
        owner = new RandomAccessFile(new File(context.getFilesDir(), "owner.lock"), "rw"); lock = owner.getChannel().tryLock();
        Protocol.require(lock != null, "native-already-open", "The workspace is already open in another window.");
        KeyStore vault = KeyStore.getInstance("AndroidKeyStore"); vault.load(null); String alias = "work-fleet-storage-v1";
        if (!vault.containsAlias(alias)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
            generator.generateKey();
        }
        key = (SecretKey) vault.getKey(alias, null);
        helper = new SQLiteOpenHelper(context, "fleet.sqlite3", null, 1) {
            @Override public void onConfigure(SQLiteDatabase database) { database.enableWriteAheadLogging(); database.execSQL("PRAGMA synchronous=FULL"); }
            @Override public void onCreate(SQLiteDatabase database) {
                database.execSQL("CREATE TABLE records(profile TEXT,kind TEXT,revision INTEGER,data BLOB,PRIMARY KEY(profile,kind))");
                database.execSQL("CREATE TABLE attachments(profile TEXT,id TEXT,data BLOB,PRIMARY KEY(profile,id))");
                database.execSQL("CREATE TABLE staging(profile TEXT,token TEXT PRIMARY KEY,kind TEXT,digest TEXT,size INTEGER,data BLOB)");
                database.execSQL("CREATE TABLE secrets(profile TEXT,kind TEXT,id TEXT,data BLOB,PRIMARY KEY(profile,kind,id))");
            }
            @Override public void onUpgrade(SQLiteDatabase database, int oldVersion, int newVersion) { throw new IllegalStateException("Unsupported schema"); }
        };
        db = helper.getWritableDatabase(); db.delete("staging", null, null); records = new RecordStore(this, db, profile);
    }
    String scope(String kind, String id) { return profile.length() + ":" + profile + "|" + kind + "|" + id; }
    byte[] protect(byte[] bytes, String scope) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key); cipher.updateAAD(scope.getBytes(StandardCharsets.UTF_8));
        byte[] sealed = cipher.doFinal(bytes); byte[] result = new byte[12 + sealed.length]; System.arraycopy(cipher.getIV(), 0, result, 0, 12); System.arraycopy(sealed, 0, result, 12, sealed.length); return result;
    }
    byte[] unprotect(byte[] bytes, String scope) throws Exception {
        Protocol.require(bytes.length >= 28, "vault-unavailable", "The secure storage contents are damaged.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, bytes, 0, 12)); cipher.updateAAD(scope.getBytes(StandardCharsets.UTF_8));
        return cipher.doFinal(bytes, 12, bytes.length - 12);
    }
    private byte[] read(String table, String field, String kind, String id) throws Exception {
        String where = "profile=? AND " + field + "=?"; String[] args = { profile, id };
        if (kind != null) { where += " AND kind=?"; args = new String[] { profile, id, kind }; }
        try (Cursor cursor = db.query(table, new String[] { "data" }, where, args, null, null, null)) {
            return cursor.moveToFirst() ? unprotect(cursor.getBlob(0), scope(table.equals("records") ? id : table.equals("attachments") ? "attachment" : "secret:" + kind, table.equals("records") ? "record" : id)) : null;
        }
    }
    synchronized byte[] record(String kind) throws Exception { kind(kind); return read("records", "kind", null, kind); }
    synchronized byte[] attachment(String id) throws Exception { Protocol.digest(id); byte[] bytes = read("attachments", "id", null, id); if (bytes != null) Protocol.require(Protocol.digest(bytes).equals(id), "attachment-integrity", "The attachment failed verification."); return bytes; }
    synchronized byte[] secret(String kind, String id) throws Exception { return read("secrets", "id", kind, id); }
    synchronized void secret(String kind, String id, byte[] bytes) throws Exception {
        Protocol.require(bytes.length <= 65536, "invalid-secret", "The secure storage item is too large.");
        ContentValues row = new ContentValues(); row.put("profile", profile); row.put("kind", kind); row.put("id", id); row.put("data", protect(bytes, scope("secret:" + kind, id)));
        db.insertWithOnConflict("secrets", null, row, SQLiteDatabase.CONFLICT_REPLACE);
    }
    synchronized void forget(String kind, String id) { db.delete("secrets", "profile=? AND kind=? AND id=?", new String[] { profile, kind, id }); }
    private static void kind(String kind) throws Exception { Protocol.require(kind.equals("workspace") || kind.equals("journal"), "invalid-record", "The storage kind is invalid."); }
    synchronized String stage(String kind, byte[] bytes, String digest) throws Exception {
        Protocol.require(kind.equals("workspace") || kind.equals("journal") || kind.equals("attachment") || kind.equals("backup"), "invalid-transfer", "The transfer kind is invalid.");
        Protocol.digest(digest); int max = kind.equals("attachment") ? Protocol.ATTACHMENT : kind.equals("backup") ? Protocol.BACKUP : Protocol.RECORD;
        Protocol.require(bytes.length <= max && Protocol.digest(bytes).equals(digest), "transfer-integrity", "The transfer failed verification.");
        if (kind.equals("workspace") || kind.equals("journal")) validate(bytes);
        try (Cursor capacity = db.rawQuery("SELECT COUNT(*),COALESCE(SUM(size),0) FROM staging", null)) {
            capacity.moveToFirst(); Protocol.require(capacity.getInt(0) < 20008 && capacity.getLong(1) + bytes.length <= 512L * 1024 * 1024, "transfer-capacity", "Temporary storage is full.");
        }
        String token = Protocol.uuid(); ContentValues row = new ContentValues(); row.put("profile", profile); row.put("token", token); row.put("kind", kind); row.put("digest", digest); row.put("size", bytes.length); row.put("data", protect(bytes, scope("staging", token)));
        db.insertOrThrow("staging", null, row); return token;
    }
    private long validate(byte[] bytes) throws Exception {
        JSONObject value = Protocol.json(bytes); Protocol.require(Protocol.text(value, "profileId", 256).equals(profile), "invalid-profile", "The data doesn't belong to the current account."); return Protocol.number(value, "revision", Protocol.SAFE_INTEGER);
    }
    synchronized byte[] staged(String token, String kind) throws Exception {
        long size;
        try (Cursor metadata = db.query("staging", new String[] { "size" }, "profile=? AND token=? AND kind=?", new String[] { profile, token, kind }, null, null, null)) {
            Protocol.require(metadata.moveToFirst(), "transfer-missing", "The native transfer has expired."); size = metadata.getLong(0);
            Protocol.require(size >= 0 && size <= Protocol.BACKUP, "transfer-capacity", "Temporary storage is full.");
        }
        try (Cursor cursor = db.query("staging", new String[] { "data", "digest" }, "profile=? AND token=? AND kind=?", new String[] { profile, token, kind }, null, null, null)) {
            Protocol.require(cursor instanceof SQLiteCursor, "native-storage", "The local record read did not finish.");
            ((SQLiteCursor) cursor).setWindow(new CursorWindow("work-fleet-staging", size + 4096));
            Protocol.require(cursor.moveToFirst(), "transfer-missing", "The native transfer has expired."); byte[] bytes = unprotect(cursor.getBlob(0), scope("staging", token));
            Protocol.require(bytes.length == size && Protocol.digest(bytes).equals(cursor.getString(1)), "transfer-integrity", "The transfer failed verification."); return bytes;
        }
    }
    synchronized void discard(String token) { db.delete("staging", "profile=? AND token=?", new String[] { profile, token }); }
    String commitAttachment(String token) throws Exception {
        byte[] bytes = staged(token, "attachment");
        try {
            String id = Protocol.digest(bytes); ContentValues row = new ContentValues(); row.put("profile", profile); row.put("id", id); row.put("data", protect(bytes, scope("attachment", id)));
            if (db.insertWithOnConflict("attachments", null, row, SQLiteDatabase.CONFLICT_IGNORE) == -1) {
                try (Cursor existing = db.query("attachments", new String[] { "id" }, "profile=? AND id=?", new String[] { profile, id }, null, null, null)) {
                    Protocol.require(existing.moveToFirst(), "native-storage", "The local attachment write did not finish.");
                }
            }
            discard(token); return id;
        } finally { Arrays.fill(bytes, (byte) 0); }
    }
    synchronized String putAttachment(String token) throws Exception {
        db.beginTransaction(); try { String id = commitAttachment(token); db.setTransactionSuccessful(); return id; } finally { db.endTransaction(); }
    }
    synchronized void commit(String kind, String token, Long expected, JSONArray attachments, boolean replaceAttachments) throws Exception {
        Protocol.require(!replaceAttachments || (kind.equals("workspace") && !profile.startsWith("google:")), "invalid-request", "Only the local workspace can clear its attachments when restoring.");
        kind(kind); byte[] bytes = staged(token, kind);
        try {
            long revision = validate(bytes); Protocol.require(revision == (expected == null ? 0 : expected + 1), "stale-workspace", "The data revision doesn't match.");
            db.beginTransaction();
            try {
                try (Cursor cursor = db.query("records", new String[] { "revision" }, "profile=? AND kind=?", new String[] { profile, kind }, null, null, null)) {
                    boolean present = cursor.moveToFirst(); Protocol.require(expected == null ? !present : present && cursor.getLong(0) == expected, "stale-workspace", "Another writer has changed the workspace.");
                }
                Protocol.require(attachments.length() <= 20000, "invalid-attachment", "There are too many attachments.");
                java.util.HashSet<String> unique = new java.util.HashSet<>();
                if (replaceAttachments) db.delete("attachments", "profile=?", new String[] { profile });
                for (int i = 0; i < attachments.length(); i++) { String attachment = attachments.getString(i); Protocol.require(unique.add(attachment), "invalid-attachment", "An attachment ID is repeated."); commitAttachment(attachment); }
                ContentValues row = new ContentValues(); row.put("profile", profile); row.put("kind", kind); row.put("revision", revision); row.put("data", protect(bytes, scope(kind, "record")));
                db.insertWithOnConflict("records", null, row, SQLiteDatabase.CONFLICT_REPLACE); discard(token); db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
        } finally { Arrays.fill(bytes, (byte) 0); }
    }
    /** Deletes everything this profile keeps on the device; Google authorization is held by the system and stays. */
    synchronized void reset() {
        db.beginTransaction();
        try { for (String table : new String[] { "records", "record_entries", "record_heads", "attachments", "staging", "secrets" }) db.delete(table, "profile=?", new String[] { profile }); db.setTransactionSuccessful(); }
        finally { db.endTransaction(); }
        // Return the freed pages so the deleted notes do not stay behind in the database file.
        db.execSQL("VACUUM");
    }
    @Override public synchronized void close() throws Exception { helper.close(); lock.release(); owner.close(); }
    synchronized JSONObject recordStatus() throws Exception { return records.status(); }
    synchronized byte[] recordEntry(String collection, String id) throws Exception { return records.entry(collection, id); }
    synchronized byte[] recordPage(JSONObject query) throws Exception { return records.page(query); }
    synchronized JSONObject commitRecords(String token, Long expected, JSONArray attachments) throws Exception { return records.commit(token, expected, attachments); }
}
