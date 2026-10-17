package app.workfleet.nativehost;

import android.util.JsonReader;
import android.util.JsonToken;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.StringReader;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.UUID;

final class Protocol {
    static final int CHUNK = 256 * 1024;
    static final int RECORD = 128 * 1024 * 1024;
    static final int ATTACHMENT = 25 * 1024 * 1024;
    static final int BACKUP = 136 * 1024 * 1024 + 4096;
    static final long SAFE_INTEGER = 9007199254740991L;
    static final class Failure extends Exception {
        final String code;
        Failure(String code, String message) { super(message); this.code = code; }
    }
    static void require(boolean condition, String code, String message) throws Failure {
        if (!condition) throw new Failure(code, message);
    }
    static String uuid() { return UUID.randomUUID().toString(); }
    static boolean uuid(String value) { return value != null && value.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"); }
    static String text(JSONObject value, String key, int max) throws Exception {
        Object field = value.opt(key);
        require(field instanceof String && !((String) field).isEmpty() && ((String) field).length() <= max, "invalid-request", "A text field is invalid."); return (String) field;
    }
    static long number(JSONObject value, String key, long max) throws Exception {
        Object field = value.opt(key);
        require(field instanceof Number, "invalid-request", "A number field is invalid.");
        double candidate = ((Number) field).doubleValue(); long result = ((Number) field).longValue();
        require(Double.isFinite(candidate) && candidate == result && result >= 0 && result <= max, "invalid-request", "A number field is out of range."); return result;
    }
    static boolean bool(JSONObject value, String key) throws Exception {
        require(value.opt(key) instanceof Boolean, "invalid-request", "A Boolean field is invalid."); return value.getBoolean(key);
    }
    static String digest(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes); StringBuilder hex = new StringBuilder();
        for (byte item : digest) hex.append(String.format(java.util.Locale.ROOT, "%02x", item & 255)); return hex.toString();
    }
    static void digest(String value) throws Failure { require(value.matches("[0-9a-f]{64}"), "invalid-digest", "The SHA-256 digest is invalid."); }
    static JSONObject object(Object... fields) throws Exception {
        JSONObject value = new JSONObject(); for (int i = 0; i < fields.length; i += 2) value.put((String) fields[i], fields[i + 1] == null ? JSONObject.NULL : fields[i + 1]); return value;
    }
    static String utf8(byte[] bytes) throws Exception { return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString(); }
    static JSONObject json(byte[] bytes) throws Exception { return json(utf8(bytes)); }
    static byte[] bytes(java.io.InputStream stream, int maximum) throws Exception {
        if (stream == null) return new byte[0];
        try (java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
            byte[] chunk = new byte[65536]; int count;
            while ((count = stream.read(chunk)) >= 0) { require(output.size() + count <= maximum, "response-size", "The data is larger than allowed."); output.write(chunk, 0, count); }
            return output.toByteArray();
        }
    }
    static JSONObject json(String input) throws Exception {
        try (JsonReader reader = new JsonReader(new StringReader(input))) {
            reader.setLenient(false); Object value = read(reader, 0);
            require(value instanceof JSONObject && reader.peek() == JsonToken.END_DOCUMENT, "invalid-json", "The JSON must be a single object."); return (JSONObject) value;
        }
    }
    private static Object read(JsonReader reader, int depth) throws Exception {
        require(depth <= 128, "invalid-json", "The JSON is nested too deeply.");
        switch (reader.peek()) {
            case BEGIN_OBJECT:
                JSONObject object = new JSONObject(); HashSet<String> names = new HashSet<>(); reader.beginObject();
                while (reader.hasNext()) { String name = reader.nextName(); require(names.add(name), "invalid-json", "The JSON has a duplicate field."); object.put(name, read(reader, depth + 1)); }
                reader.endObject(); return object;
            case BEGIN_ARRAY:
                JSONArray array = new JSONArray(); reader.beginArray(); while (reader.hasNext()) array.put(read(reader, depth + 1)); reader.endArray(); return array;
            case STRING: return reader.nextString();
            case BOOLEAN: return reader.nextBoolean();
            case NULL: reader.nextNull(); return JSONObject.NULL;
            case NUMBER:
                String number = reader.nextString(); java.math.BigDecimal decimal = new java.math.BigDecimal(number);
                try { return decimal.longValueExact(); } catch (ArithmeticException error) {
                    double floating = decimal.doubleValue(); require(Double.isFinite(floating), "invalid-json", "The JSON has an invalid number."); return floating;
                }
            default: throw new Failure("invalid-json", "The JSON is malformed.");
        }
    }
}
