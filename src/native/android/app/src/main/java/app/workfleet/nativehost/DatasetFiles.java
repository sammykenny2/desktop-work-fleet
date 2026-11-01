package app.workfleet.nativehost;

import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Closed descriptors and typed selectors; the renderer cannot send HTTP or query text. */
final class DatasetFiles {
    static final String FORMAT = "work-fleet-dataset";
    static final String FIELDS = "id,name,mimeType,parents,spaces,trashed,size,createdTime,appProperties,sha256Checksum";
    static final List<String> SHARDS = Arrays.asList("0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f", "groups");
    static void check(boolean condition) throws Exception { Protocol.require(condition, "invalid-source-file", "The dataset descriptor or query isn't valid."); }
    static boolean matches(Object value, String pattern) { return value instanceof String && !Arrays.asList("__proto__", "prototype", "constructor").contains(value) && ((String) value).matches(pattern); }
    static boolean fileId(Object value) { return matches(value, "[A-Za-z0-9_-]{1,256}"); }
    static boolean entityId(Object value) { return matches(value, "[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"); }
    static boolean datasetId(Object value) { return matches(value, "[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}"); }
    static Set<String> keys(JSONObject value) { Set<String> result = new HashSet<>(); value.keys().forEachRemaining(result::add); return result; }
    static JSONObject properties(JSONObject file) throws Exception {
        JSONObject result = Protocol.object("wfFormat", FORMAT, "wfSchema", "1", "wfDataset", file.getString("datasetId"), "wfKind", file.getString("kind"));
        String[][] pairs = {{"sha256", "wfSha256"}, {"role", "wfRole"}, {"entityId", "wfEntity"}, {"revisionId", "wfRevision"}, {"shard", "wfShard"}};
        for (String[] pair : pairs) if (file.has(pair[0])) result.put(pair[1], Protocol.text(file, pair[0], 256));
        for (String key : keys(result)) check((key + result.getString(key)).getBytes(StandardCharsets.UTF_8).length <= 124);
        return result;
    }
    static JSONObject file(JSONObject value) throws Exception {
        String kind = Protocol.text(value, "kind", 16);
        check(fileId(value.opt("id")) && fileId(value.opt("parentId")) && datasetId(value.opt("datasetId"))
            && Arrays.asList("dataset-root", "folder", "dataset", "ready", "revision", "attachment", "change", "checkpoint", "purge").contains(kind));
        Set<String> keys = new HashSet<>(Arrays.asList("id", "parentId", "datasetId", "kind"));
        if (kind.equals("folder") || kind.equals("dataset-root")) {
            keys.add("role"); check(matches(value.opt("role"), "[a-z][a-z0-9-]{0,31}"));
            if (value.has("entityId")) { keys.add("entityId"); check(entityId(value.opt("entityId"))); }
            check(!kind.equals("dataset-root") || value.getString("parentId").equals("appDataFolder") && value.getString("role").equals("root"));
        } else {
            keys.addAll(Arrays.asList("sha256", "size")); Protocol.digest(Protocol.text(value, "sha256", 64));
            Protocol.number(value, "size", kind.equals("attachment") ? Protocol.ATTACHMENT : Arrays.asList("change", "purge", "dataset", "ready").contains(kind) ? 65536 : 8 * 1024 * 1024);
            if (Arrays.asList("revision", "attachment", "change", "purge").contains(kind)) { keys.add("entityId"); check(entityId(value.opt("entityId"))); }
            if (Arrays.asList("revision", "change").contains(kind)) { keys.add("revisionId"); check(entityId(value.opt("revisionId"))); }
            if (Arrays.asList("revision", "change", "checkpoint", "purge").contains(kind)) { keys.add("shard"); check(SHARDS.contains(value.optString("shard"))); }
        }
        check(keys(value).equals(keys)); properties(value); return value;
    }
    static JSONObject metadata(JSONObject input) throws Exception {
        JSONObject value = file(input); String kind = value.getString("kind"), id = value.getString("id");
        boolean folder = kind.equals("folder") || kind.equals("dataset-root");
        String suffix = folder ? "" : kind.equals("attachment") ? ".bin" : ".json";
        return Protocol.object("id", id, "name", kind + "-" + value.optString("revisionId", value.optString("entityId", id)) + suffix,
            "mimeType", folder ? "application/vnd.google-apps.folder" : "application/octet-stream", "parents", new JSONArray().put(value.getString("parentId")), "appProperties", properties(value));
    }
    static void verify(JSONObject value, JSONObject expected) throws Exception {
        JSONObject desired = metadata(expected); JSONArray parents = value.optJSONArray("parents"), spaces = value.optJSONArray("spaces"); boolean appdata = false;
        if (spaces != null) for (int i = 0; i < spaces.length(); i++) if (spaces.getString(i).equals("appDataFolder")) appdata = true;
        boolean parent = parents != null && parents.length() == 1 && (parents.getString(0).equals(expected.getString("parentId")) || expected.getString("kind").equals("dataset-root") && fileId(parents.getString(0)));
        JSONObject properties = value.optJSONObject("appProperties"), desiredProperties = desired.getJSONObject("appProperties");
        check(properties != null && keys(properties).equals(keys(desiredProperties)));
        for (String key : keys(desiredProperties)) check(properties.getString(key).equals(desiredProperties.getString(key)));
        check(value.getString("id").equals(expected.getString("id")) && value.getString("mimeType").equals(desired.getString("mimeType")) && parent && appdata && (!value.has("trashed") || Boolean.FALSE.equals(value.opt("trashed"))));
        if (expected.has("sha256")) check(value.getString("size").equals(Long.toString(expected.getLong("size"))) && value.optString("sha256Checksum", expected.getString("sha256")).equals(expected.getString("sha256")));
    }
    private static String prop(String key, String value) { return "appProperties has { key='" + key + "' and value='" + value + "' }"; }
    static String query(JSONObject value) throws Exception {
        String scope = Protocol.text(value, "scope", 32); Set<String> keys = new HashSet<>(Arrays.asList("scope"));
        List<String> clauses = new ArrayList<>(Arrays.asList("trashed = false"));
        if (scope.equals("fences")) clauses.add(prop("wfKind", "reset"));
        else if (!scope.equals("legacy")) {
            clauses.add(prop("wfFormat", FORMAT));
            if (!scope.equals("datasets")) { keys.add("datasetId"); check(datasetId(value.opt("datasetId"))); clauses.add(prop("wfDataset", value.getString("datasetId"))); }
            if (Arrays.asList("datasets", "ready", "roots").contains(scope)) {
                clauses.add(prop("wfKind", scope.equals("datasets") ? "dataset" : scope.equals("roots") ? "dataset-root" : "ready"));
                if (scope.equals("roots")) clauses.add("'appDataFolder' in parents");
            } else if (Arrays.asList("current", "current-all").contains(scope)) {
                if (scope.equals("current")) { keys.add("shard"); check(SHARDS.contains(value.optString("shard"))); clauses.add(prop("wfShard", value.getString("shard"))); }
                clauses.add("(" + prop("wfKind", "checkpoint") + " or " + prop("wfKind", "change") + ")");
            } else if (Arrays.asList("history", "children").contains(scope)) {
                keys.add("parentId"); check(fileId(value.opt("parentId"))); clauses.add("'" + value.getString("parentId") + "' in parents");
                if (scope.equals("history")) clauses.add(prop("wfKind", "revision"));
            } else if (Arrays.asList("purges", "entity-folders", "entity-data").contains(scope)) {
                keys.add("entities"); JSONArray ids = value.getJSONArray("entities"); check(ids.length() > 0 && ids.length() <= 20);
                Set<String> seen = new HashSet<>(); List<String> terms = new ArrayList<>();
                for (int i = 0; i < ids.length(); i++) { String id = ids.getString(i); check(entityId(id) && seen.add(id)); terms.add(prop("wfEntity", id)); }
                clauses.add(scope.equals("entity-data") ? "(" + prop("wfKind", "revision") + " or " + prop("wfKind", "attachment") + " or " + prop("wfKind", "folder") + ")"
                    : prop("wfKind", scope.equals("purges") ? "purge" : "folder")); clauses.add("(" + String.join(" or ", terms) + ")");
            } else check(false);
        }
        check(keys(value).equals(keys)); return String.join(" and ", clauses);
    }
}
