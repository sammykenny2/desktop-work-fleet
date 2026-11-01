package app.workfleet.nativehost;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.CursorWindow;
import android.database.sqlite.SQLiteCursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Called only while FleetDatabase holds its account-scoped owner lock. */
final class RecordStore {
    static final String FORMAT = "work-fleet-local-records";
    static final int MAX_BYTES = 8 * 1024 * 1024;
    static final Set<String> COLLECTIONS = new HashSet<>(Arrays.asList("meta", "current", "history", "draft", "outbox", "control", "job"));
    private final FleetDatabase owner;
    private final SQLiteDatabase db;
    private final String profile;
    RecordStore(FleetDatabase owner, SQLiteDatabase db, String profile) {
        this.owner = owner; this.db = db; this.profile = profile;
        db.execSQL("CREATE TABLE IF NOT EXISTS record_heads(profile TEXT PRIMARY KEY,revision INTEGER NOT NULL,commit_id TEXT NOT NULL,digest TEXT NOT NULL)");
        db.execSQL("CREATE TABLE IF NOT EXISTS record_entries(profile TEXT NOT NULL,collection TEXT NOT NULL,id TEXT NOT NULL,entity TEXT NOT NULL,ordinal INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(profile,collection,id))");
        db.execSQL("CREATE INDEX IF NOT EXISTS record_order ON record_entries(profile,collection,ordinal DESC,id DESC)");
        db.execSQL("CREATE INDEX IF NOT EXISTS record_entity ON record_entries(profile,collection,entity,ordinal DESC,id DESC)");
    }
    static void require(boolean value) throws Exception { Protocol.require(value, "invalid-record-transaction", "The local record transaction is invalid. Saved data is unchanged."); }
    static boolean key(String value) { return value != null && value.matches("[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}") && !Arrays.asList("__proto__", "prototype", "constructor").contains(value); }
    private Cursor queryRows(String sql, String[] args) throws Exception {
        Cursor cursor = db.rawQuery(sql, args);
        try {
            // An allowed record can exceed Android's default cursor window; include ciphertext and column framing.
            require(cursor instanceof SQLiteCursor);
            ((SQLiteCursor) cursor).setWindow(new CursorWindow("work-fleet-records", MAX_BYTES + 4096L));
            ((SQLiteCursor) cursor).setFillWindowForwardOnly(true);
            return cursor;
        } catch (Exception error) { cursor.close(); throw error; }
    }
    static Set<String> keys(JSONObject value) { Set<String> result = new HashSet<>(); value.keys().forEachRemaining(result::add); return result; }
    static void exact(JSONObject value, String... names) throws Exception { require(keys(value).equals(new HashSet<>(Arrays.asList(names)))); }
    static byte[] bytes(JSONObject value) { return value.toString().getBytes(StandardCharsets.UTF_8); }
    static boolean equal(Object a, Object b) throws Exception {
        if (a instanceof JSONObject && b instanceof JSONObject) {
            JSONObject left = (JSONObject) a, right = (JSONObject) b;
            if (!keys(left).equals(keys(right))) return false;
            for (String key : keys(left)) if (!equal(left.get(key), right.get(key))) return false;
            return true;
        }
        if (a instanceof JSONArray && b instanceof JSONArray) {
            JSONArray left = (JSONArray) a, right = (JSONArray) b;
            if (left.length() != right.length()) return false;
            for (int i = 0; i < left.length(); i++) if (!equal(left.get(i), right.get(i))) return false;
            return true;
        }
        if (a instanceof Number && b instanceof Number) return new BigDecimal(a.toString()).compareTo(new BigDecimal(b.toString())) == 0;
        return a.equals(b);
    }
    JSONObject status() throws Exception {
        try (Cursor row = db.rawQuery("SELECT revision,commit_id,digest FROM record_heads WHERE profile=?", new String[] { profile })) {
            if (row.moveToFirst()) return Protocol.object("format", FORMAT, "schemaVersion", 1, "profileId", profile, "revision", row.getLong(0), "commitId", row.getString(1), "digest", row.getString(2));
        }
        try (Cursor row = db.rawQuery("SELECT 1 FROM records WHERE profile=? AND kind='workspace'", new String[] { profile })) {
            return row.moveToFirst() ? Protocol.object("format", "legacy-workspace", "profileId", profile) : null;
        }
    }
    byte[] entry(String collection, String id) throws Exception {
        require(COLLECTIONS.contains(collection) && key(id));
        try (Cursor row = queryRows("SELECT data FROM record_entries WHERE profile=? AND collection=? AND id=?", new String[] { profile, collection, id })) {
            if (!row.moveToFirst()) return null;
            byte[] data = owner.unprotect(row.getBlob(0), owner.scope("entry:" + collection, id)); JSONObject value = Protocol.json(data);
            require(collection.equals(value.getString("collection")) && id.equals(value.getString("key"))); return data;
        }
    }
    byte[] page(JSONObject query) throws Exception {
        require(new HashSet<>(Arrays.asList("collection", "entity", "after", "limit", "expectedRevision", "order", "keysOnly")).containsAll(keys(query)) && query.has("expectedRevision"));
        require(!query.has("keysOnly") || query.get("keysOnly") instanceof Boolean); boolean keysOnly = query.optBoolean("keysOnly", false);
        String order = query.has("order") ? query.getString("order") : "desc"; require(Arrays.asList("asc", "desc").contains(order));
        String collection = Protocol.text(query, "collection", 32); require(COLLECTIONS.contains(collection));
        String entity = query.isNull("entity") ? null : query.getString("entity"); require(entity == null || entity.isEmpty() || key(entity));
        int limit = query.has("limit") ? (int) Protocol.number(query, "limit", 100) : 100; require(limit > 0);
        Long expected = query.isNull("expectedRevision") ? null : Protocol.number(query, "expectedRevision", Protocol.SAFE_INTEGER);
        JSONObject status = status();
        Protocol.require(status == null || FORMAT.equals(status.getString("format")), "incompatible-local-data", "This profile uses an older format. Keep it or explicitly reset it before continuing.");
        Protocol.require(expected == null ? status == null : status != null && status.getLong("revision") == expected, "stale-writer", "Local data changed while reading its records. Reload before continuing.");
        String where = "profile=? AND collection=?"; ArrayList<String> args = new ArrayList<>(Arrays.asList(profile, collection));
        if (entity != null) { where += " AND entity=?"; args.add(entity); }
        if (!query.isNull("after")) {
            JSONObject after = query.getJSONObject("after"); exact(after, "ordinal", "key"); String id = Protocol.text(after, "key", 256); require(key(id));
            String ordinal = Long.toString(Protocol.number(after, "ordinal", Protocol.SAFE_INTEGER));
            where += " AND (ordinal,id)" + (order.equals("asc") ? ">" : "<") + "(?,?)"; args.add(ordinal); args.add(id);
        }
        args.add(Integer.toString(limit + 1)); JSONArray rows = new JSONArray(); int size = 512; boolean more = false;
        String sorting = order.equals("asc") ? "ASC" : "DESC";
        try (Cursor cursor = queryRows("SELECT id,entity,ordinal," + (keysOnly ? "NULL" : "data") + " FROM record_entries WHERE " + where + " ORDER BY ordinal " + sorting + ",id " + sorting + " LIMIT ?", args.toArray(new String[0]))) {
            while (cursor.moveToNext()) {
                String id = cursor.getString(0); byte[] data = keysOnly ? bytes(Protocol.object("collection", collection, "key", id, "ordinal", cursor.getLong(2)))
                    : owner.unprotect(cursor.getBlob(3), owner.scope("entry:" + collection, id));
                JSONObject row = Protocol.json(data);
                require(collection.equals(row.getString("collection")) && id.equals(row.getString("key")) && (keysOnly || cursor.getString(1).equals(row.getString("entity"))) && cursor.getLong(2) == row.getLong("ordinal"));
                if (rows.length() >= limit || (rows.length() > 0 && size + data.length > MAX_BYTES)) { more = true; break; }
                require(size + data.length <= MAX_BYTES); rows.put(row); size += data.length + 1;
            }
        }
        JSONObject last = rows.length() > 0 ? rows.getJSONObject(rows.length() - 1) : null;
        Object next = more && last != null ? Protocol.object("ordinal", last.getLong("ordinal"), "key", last.getString("key")) : JSONObject.NULL;
        return bytes(Protocol.object("revision", expected == null ? JSONObject.NULL : expected, "rows", rows, "next", next));
    }
    JSONObject commit(String token, Long expected, JSONArray attachments) throws Exception {
        require(expected == null || expected >= 0 && expected <= Protocol.SAFE_INTEGER);
        require(attachments.length() <= 512); Set<String> attachmentIds = new HashSet<>();
        for (int i = 0; i < attachments.length(); i++) require(attachmentIds.add(attachments.getString(i)));
        byte[] data = owner.staged(token, "workspace");
        try {
            require(data.length <= MAX_BYTES); JSONObject value = Protocol.json(data); String digest = Protocol.digest(data);
            if (value.has("attachmentDeletes")) exact(value, "format", "schemaVersion", "profileId", "revision", "commitId", "puts", "deletes", "attachmentDeletes");
            else exact(value, "format", "schemaVersion", "profileId", "revision", "commitId", "puts", "deletes");
            JSONArray attachmentDeletes = value.has("attachmentDeletes") ? value.getJSONArray("attachmentDeletes") : new JSONArray();
            Set<String> removeIds = new HashSet<>();
            for (int i = 0; i < attachmentDeletes.length(); i++) { String identity = attachmentDeletes.getString(i); require(identity.matches("[0-9a-f]{64}") && removeIds.add(identity)); }
            require("work-fleet-record-transaction".equals(value.getString("format")) && Protocol.number(value, "schemaVersion", 1) == 1 && profile.equals(value.getString("profileId")));
            long revision = Protocol.number(value, "revision", Protocol.SAFE_INTEGER); String id = Protocol.text(value, "commitId", 36);
            require(id.matches("[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}"));
            JSONArray puts = value.getJSONArray("puts"), deletes = value.getJSONArray("deletes"); require(puts.length() + deletes.length() + removeIds.size() <= 512);
            Set<String> seen = new HashSet<>();
            for (JSONArray changes : new JSONArray[] { puts, deletes }) for (int i = 0; i < changes.length(); i++) {
                JSONObject row = changes.getJSONObject(i); String c = Protocol.text(row, "collection", 32), key = Protocol.text(row, "key", 256);
                require(COLLECTIONS.contains(c) && key(key) && seen.add(c + "|" + key));
            }
            db.beginTransaction();
            try {
                long attachmentBytes = 0;
                for (String staged : attachmentIds) try (Cursor row = db.rawQuery("SELECT size FROM staging WHERE profile=? AND token=? AND kind='attachment'", new String[] { profile, staged })) {
                    Protocol.require(row.moveToFirst(), "transfer-missing", "The native attachment transfer has expired.");
                    long size = row.getLong(0); require(size >= 0 && size <= Protocol.ATTACHMENT);
                    attachmentBytes += size; require(attachmentBytes <= 128 * 1024 * 1024);
                }
                JSONObject status = status();
                if (status != null && status.optLong("revision", -1) == revision && id.equals(status.optString("commitId")) && digest.equals(status.optString("digest"))) {
                    owner.discard(token); for (String staged : attachmentIds) owner.discard(staged);
                    db.setTransactionSuccessful(); return status;
                }
                Protocol.require(status == null || FORMAT.equals(status.getString("format")), "incompatible-local-data", "This profile uses an older format. Keep it or explicitly reset it before continuing.");
                Protocol.require(expected == null ? status == null : status != null && status.getLong("revision") == expected, "stale-writer", "Another writer changed the local records. Keep your changes and reload.");
                require(revision == (expected == null ? 0 : expected + 1));
                for (int i = 0; i < puts.length(); i++) {
                    JSONObject row = puts.getJSONObject(i); exact(row, "collection", "key", "entity", "ordinal", "value");
                    require(bytes(row).length <= MAX_BYTES - 1024);
                    String c = row.getString("collection"), key = row.getString("key"), entity = row.getString("entity"); require(entity.isEmpty() || key(entity));
                    long ordinal = Protocol.number(row, "ordinal", revision);
                    byte[] old = c.equals("history") ? entry(c, key) : null;
                    if (old != null) {
                        JSONObject previous = Protocol.json(old);
                        Protocol.require(entity.equals(previous.getString("entity")) && equal(previous.get("value"), row.get("value")), "revision-collision", "A revision ID has different content. Saved data is unchanged.");
                        continue;
                    }
                    ContentValues record = new ContentValues(); record.put("profile", profile); record.put("collection", c); record.put("id", key); record.put("entity", entity); record.put("ordinal", ordinal);
                    record.put("data", owner.protect(bytes(row), owner.scope("entry:" + c, key)));
                    Protocol.require(db.insertWithOnConflict("record_entries", null, record, SQLiteDatabase.CONFLICT_REPLACE) != -1,
                        "native-storage", "The local record write did not finish.");
                }
                for (int i = 0; i < deletes.length(); i++) {
                    JSONObject row = deletes.getJSONObject(i); exact(row, "collection", "key");
                    db.delete("record_entries", "profile=? AND collection=? AND id=?", new String[] { profile, row.getString("collection"), row.getString("key") });
                }
                for (String identity : removeIds) db.delete("attachments", "profile=? AND id=?", new String[] { profile, identity });
                for (String attachment : attachmentIds) owner.commitAttachment(attachment);
                ContentValues head = new ContentValues(); head.put("profile", profile); head.put("revision", revision); head.put("commit_id", id); head.put("digest", digest);
                Protocol.require(db.insertWithOnConflict("record_heads", null, head, SQLiteDatabase.CONFLICT_REPLACE) != -1,
                    "native-storage", "The local record write did not finish.");
                owner.discard(token);
                JSONObject result = status(); db.setTransactionSuccessful(); return result;
            } finally { db.endTransaction(); }
        } finally { Arrays.fill(data, (byte) 0); }
    }
}
