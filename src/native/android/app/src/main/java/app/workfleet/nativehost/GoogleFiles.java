package app.workfleet.nativehost;

import android.accounts.Account;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.util.Base64;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

final class GoogleFiles implements AutoCloseable {
    private static final String FIELDS = "id,size,spaces,trashed,appProperties,sha256Checksum";
    private static final List<Scope> SCOPES = Arrays.asList(new Scope("openid"), new Scope("email"), new Scope("https://www.googleapis.com/auth/drive.appdata"));
    private final FleetActivity activity;
    private final FleetDatabase database;
    private final SharedPreferences preferences;
    private final String clientId;
    private final HashMap<String, Upload> uploads = new HashMap<>();
    private JSONObject account;
    private String preparedAccount;
    private final GoogleAccessToken tokens = new GoogleAccessToken();
    private static final long SIGN_IN_TIMEOUT_MILLIS = TimeUnit.SECONDS.toMillis(110);
    private long signInDeadline;
    private volatile boolean closed;
    private static final class Upload { final String path, digest; final int size; Upload(String path, String digest, int size) { this.path = path; this.digest = digest; this.size = size; } }
    private static final class Response {
        final int status; final byte[] bytes; final String location, range;
        Response(int status, byte[] bytes, String location, String range) { this.status = status; this.bytes = bytes; this.location = location; this.range = range; }
    }
    GoogleFiles(FleetActivity activity, FleetDatabase database, JSONObject config) throws Exception {
        this.activity = activity; this.database = database; preferences = activity.getSharedPreferences("google-native", android.content.Context.MODE_PRIVATE);
        clientId = config.getJSONObject("google").getJSONObject("clients").optString("android");
        if (database.profile.startsWith("google:")) account = load(database.profile.substring(7));
    }
    private JSONObject load(String id) throws Exception {
        Protocol.require(id.matches("[A-Za-z0-9_-]{1,255}"), "google-account", "The Google account ID is invalid.");
        String value = preferences.getString(id, null); if (value == null) return null;
        byte[] bytes = database.unprotect(Base64.decode(value, Base64.DEFAULT), "google-account:" + id);
        try { JSONObject account = Protocol.json(bytes); return account.getString("accountId").equals(id) && account.getString("clientId").equals(clientId) ? account : null; }
        finally { Arrays.fill(bytes, (byte) 0); }
    }
    private void save(JSONObject value) throws Exception {
        String id = value.getString("accountId"); byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
        try { Protocol.require(preferences.edit().putString(id, Base64.encodeToString(database.protect(bytes, "google-account:" + id), Base64.NO_WRAP)).commit(), "native-storage", "The Google account choice wasn't saved."); }
        finally { Arrays.fill(bytes, (byte) 0); }
    }
    Object status() throws Exception { return Protocol.object("configured", activity.googleConfigured(), "connected", account != null, "accountId", account == null ? null : account.getString("accountId"), "email", account == null ? null : account.getString("email"), "profileId", database.profile); }
    private static String encode(String value) throws Exception { return URLEncoder.encode(value, "UTF-8"); }
    private long remainingGoogleMillis() throws TimeoutException {
        long remaining = signInDeadline == 0 ? SIGN_IN_TIMEOUT_MILLIS : signInDeadline - SystemClock.elapsedRealtime();
        if (remaining <= 0) throw new TimeoutException(); return remaining;
    }
    private static String path(String base, String... fields) throws Exception { StringBuilder query = new StringBuilder(base).append('?'); for (int i = 0; i < fields.length; i += 2) { if (i != 0) query.append('&'); query.append(encode(fields[i])).append('=').append(encode(fields[i + 1])); } return query.toString(); }
    private Response http(String uri, String method, String token, byte[] body, Map<String, String> headers, int maximum) throws Exception {
        Protocol.require(!closed, "stale-session", "The Google session has ended."); URL url = new URL(uri);
        Protocol.require(url.getProtocol().equals("https") && (url.getHost().equals("www.googleapis.com") || url.getHost().equals("openidconnect.googleapis.com")) && url.getUserInfo() == null && url.getRef() == null && (url.getPort() == -1 || url.getPort() == 443), "invalid-source", "The Google HTTPS address is invalid.");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection(); connection.setInstanceFollowRedirects(false); connection.setConnectTimeout((int) Math.min(20000, remainingGoogleMillis())); connection.setReadTimeout((int) Math.min(90000, remainingGoogleMillis())); connection.setRequestMethod(method);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        for (Map.Entry<String, String> header : headers.entrySet()) connection.setRequestProperty(header.getKey(), header.getValue());
        try {
            if (body != null) { connection.setDoOutput(true); connection.setFixedLengthStreamingMode(body.length); try (OutputStream output = connection.getOutputStream()) { output.write(body); } }
            int status = connection.getResponseCode(); long length = connection.getContentLengthLong(); Protocol.require(length < 0 || length <= maximum, "response-size", "The Google response is larger than allowed.");
            byte[] bytes; try (InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) { bytes = Protocol.bytes(input, maximum); }
            Protocol.require(!closed, "stale-session", "The Google session has ended."); return new Response(status, bytes, connection.getHeaderField("Location"), connection.getHeaderField("Range"));
        } finally { connection.disconnect(); }
    }
    private JSONObject authorize(String email, boolean interactive, String expected) throws Exception {
        AuthorizationRequest request = AuthorizationRequest.builder().setAccount(new Account(email, "com.google")).setRequestedScopes(SCOPES).build();
        AuthorizationResult result = activity.authorize(request, interactive, remainingGoogleMillis());
        Protocol.require(result.getAccessToken() != null && !result.getAccessToken().isEmpty(), "unauthorized", "Google didn't grant access to Drive app data.");
        String token = result.getAccessToken(); Response identity = http("https://openidconnect.googleapis.com/v1/userinfo", "GET", token, null, Collections.emptyMap(), 65536);
        Protocol.require(identity.status == 200, "unauthorized", "Couldn't confirm the Google account."); JSONObject info = Protocol.json(identity.bytes); String id = Protocol.text(info, "sub", 255);
        Protocol.require(id.matches("[A-Za-z0-9_-]{1,255}") && (expected == null || expected.equals(id)), "stale-session", "The Google account doesn't match this workspace; no notes were sent.");
        tokens.save(id, token, SystemClock.elapsedRealtime()); return Protocol.object("accountId", id, "email", email, "clientId", clientId);
    }
    synchronized Object signIn() throws Exception {
        preparedAccount = null; signInDeadline = SystemClock.elapsedRealtime() + SIGN_IN_TIMEOUT_MILLIS;
        try {
            activity.clearGoogleCredentialState(remainingGoogleMillis());
            String email = activity.selectGoogleEmail(remainingGoogleMillis()); JSONObject value = authorize(email, true, null);
            remainingGoogleMillis(); save(value); preparedAccount = value.getString("accountId");
            return Protocol.object("accountId", preparedAccount, "email", email, "profileId", "google:" + preparedAccount);
        } catch (Exception error) { throw GoogleSignInErrors.failure(error); }
        finally { signInDeadline = 0; }
    }
    synchronized String open(String id) throws Exception { Protocol.require(id.equals(preparedAccount) && load(id) != null, "google-account", "Finish signing in to this Google account first."); preparedAccount = null; return "google:" + id; }
    // Only this device signs out: revoking access removes the project's grant for every client, so every other device
    // signed in to this account would lose sync within the hour (ADR-021, amended 2026-10-15).
    synchronized void signOut() throws Exception {
        if (account == null) return;
        try { activity.clearGoogleCredentialState(remainingGoogleMillis()); } catch (Exception error) { throw GoogleSignInErrors.failure(error); }
        Protocol.require(preferences.edit().remove(account.getString("accountId")).commit(), "native-storage", "The sign-in credential wasn't removed.");
        account = null; preparedAccount = null; tokens.clear(); uploads.clear();
    }
    private String token() throws Exception {
        Protocol.require(account != null && database.profile.equals("google:" + account.getString("accountId")), "unauthorized", "Sign in to Google first.");
        String id = account.getString("accountId"), cached = tokens.get(id, SystemClock.elapsedRealtime());
        if (cached == null) {
            try { authorize(account.getString("email"), false, id); } catch (Exception error) { throw GoogleSignInErrors.failure(error); }
            cached = tokens.get(id, SystemClock.elapsedRealtime());
        }
        return cached;
    }
    private Response request(String path, String method, byte[] body, Map<String, String> headers, int maximum, boolean allow308, String context) throws Exception {
        Response response;
        try { response = http("https://www.googleapis.com" + path, method, token(), body, headers, maximum); }
        catch (java.io.IOException error) { throw new Protocol.Failure("network", "Couldn't reach Google Drive. Pending changes are kept."); }
        if (response.status >= 200 && response.status < 300 || allow308 && response.status == 308) return response;
        String reason = "";
        try { reason = Protocol.json(response.bytes).getJSONObject("error").getJSONArray("errors").getJSONObject(0).getString("reason"); } catch (Exception ignored) { }
        if (response.status == 401) { String expired = tokens.clear(); if (expired != null) Identity.getAuthorizationClient(activity).clearToken(ClearTokenRequest.builder().setToken(expired).build()); }
        String code = response.status == 401 ? "unauthorized" : response.status == 409 ? "file-exists"
            : response.status == 429 || reason.equals("rateLimitExceeded") || reason.equals("userRateLimitExceeded") ? "rate-limit"
            : response.status >= 500 ? "service-unavailable" : response.status == 410 && context.equals("changes") ? "cursor-expired"
            : (response.status == 400 || response.status == 410) && context.equals("listing") ? "page-expired"
            : response.status == 404 && context.equals("upload") ? "upload-session-expired" : response.status == 404 && context.equals("delete") ? "file-missing"
            : reason.equals("storageQuotaExceeded") ? "storage-quota"
            : response.status == 403 ? "source-permission" : "source-error";
        throw new Protocol.Failure(code, "Google Drive didn't finish syncing (" + code + "). Local data and pending changes are kept.");
    }
    private Response request(String path) throws Exception { return request(path, "GET", null, Collections.emptyMap(), 2 * 1024 * 1024, false, ""); }
    // The account chip's name and photo: Drive's about.user needs no scope beyond app data. The photo is a public
    // googleusercontent address, fetched without the access token; an unusable photo leaves only the name.
    private JSONObject profile() throws Exception {
        JSONObject user = Protocol.json(request(path("/drive/v3/about", "fields", "user(displayName,photoLink)")).bytes).optJSONObject("user");
        String name = user != null && user.opt("displayName") instanceof String ? user.getString("displayName").trim() : "";
        Object link = user == null ? null : user.opt("photoLink");
        return Protocol.object("name", name.isEmpty() || name.length() > 256 ? null : name, "photo", link instanceof String ? photo(((String) link).trim()) : null);
    }
    private JSONObject photo(String link) {
        try {
            URL url = new URL(link);
            if (link.length() > 2048 || !url.getProtocol().equals("https") || !url.getHost().matches("lh[3-6]\\.googleusercontent\\.com") || url.getUserInfo() != null || url.getRef() != null || url.getPort() != -1 && url.getPort() != 443) return null;
            HttpURLConnection connection = (HttpURLConnection) url.openConnection(); connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(20000);
            try {
                if (connection.getResponseCode() != 200 || connection.getContentLengthLong() > 128 * 1024) return null;
                byte[] bytes; try (InputStream input = connection.getInputStream()) { bytes = Protocol.bytes(input, 128 * 1024); }
                String type = imageType(bytes); return type == null || closed ? null : Protocol.object("type", type, "data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            } finally { connection.disconnect(); }
        } catch (Exception error) { return null; }
    }
    private static String imageType(byte[] b) {
        String head = new String(b, 0, Math.min(b.length, 12), StandardCharsets.ISO_8859_1);
        if (head.startsWith("\u0089PNG\r\n\u001a\n")) return "image/png";
        if (head.startsWith("ÿØÿ")) return "image/jpeg";
        if (head.startsWith("GIF87a") || head.startsWith("GIF89a")) return "image/gif";
        if (head.length() == 12 && head.startsWith("RIFF") && head.substring(8).equals("WEBP")) return "image/webp";
        return null;
    }
    private static JSONObject file(JSONObject value) throws Exception {
        String id = Protocol.text(value, "id", 256), kind = Protocol.text(value, "kind", 16), sha = Protocol.text(value, "sha256", 64); Protocol.digest(sha);
        Protocol.require(id.matches("[A-Za-z0-9_-]{1,256}") && (kind.equals("revision") || kind.equals("attachment") || kind.equals("reset") || kind.equals("workspace")), "invalid-source-file", "The Google file ID is invalid.");
        long size = Protocol.number(value, "size", (kind.equals("revision") || kind.equals("workspace")) ? 8 * 1024 * 1024 : kind.equals("reset") ? 4096 : Protocol.ATTACHMENT); return Protocol.object("id", id, "kind", kind, "sha256", sha, "size", size);
    }
    private static void metadata(JSONObject metadata, JSONObject file) throws Exception {
        JSONObject properties = metadata.getJSONObject("appProperties"); boolean appdata = false; JSONArray spaces = metadata.getJSONArray("spaces"); for (int i = 0; i < spaces.length(); i++) if (spaces.getString(i).equals("appDataFolder")) appdata = true;
        Protocol.require(metadata.getString("id").equals(file.getString("id")) && metadata.getString("size").equals(Long.toString(file.getLong("size"))) && appdata && !metadata.optBoolean("trashed", false)
            && properties.getString("wfFormat").equals("work-fleet-file") && properties.getString("wfSchema").equals("1") && properties.getString("wfKind").equals(file.getString("kind")) && properties.getString("wfSha256").equals(file.getString("sha256"))
            && (!metadata.has("sha256Checksum") || metadata.getString("sha256Checksum").equals(file.getString("sha256"))), "upload-mismatch", "The Google file's metadata doesn't match its contents.");
    }
    synchronized Object invoke(String method, JSONObject args, FleetBridge bridge) throws Exception {
        Protocol.require(!closed && account != null && Protocol.text(args, "accountId", 255).equals(account.getString("accountId")), "stale-session", "The Google account has changed.");
        switch (method) {
            case "google.cursor": return Protocol.json(request(path("/drive/v3/changes/startPageToken", "fields", "startPageToken")).bytes);
            case "google.list": {
                String path = path("/drive/v3/files", "spaces", "appDataFolder", "q", "trashed = false", "pageSize", "100", "fields", "nextPageToken,incompleteSearch,files(" + FIELDS + ")");
                if (!args.isNull("pageToken")) path += "&pageToken=" + encode(Protocol.text(args, "pageToken", 8192));
                return Protocol.json(request(path, "GET", null, Collections.emptyMap(), 2 * 1024 * 1024, false, "listing").bytes);
            }
            case "google.changes": return Protocol.json(request(path("/drive/v3/changes", "pageToken", Protocol.text(args, "cursor", 8192), "spaces", "appDataFolder", "includeRemoved", "true", "pageSize", "100", "fields", "nextPageToken,newStartPageToken,changes(fileId,removed,file(" + FIELDS + ",mimeType))"), "GET", null, Collections.emptyMap(), 2 * 1024 * 1024, false, "changes").bytes);
            case "google.allocate": return Protocol.json(request(path("/drive/v3/files/generateIds", "count", "1", "space", "appDataFolder", "type", "files", "fields", "ids")).bytes);
            case "google.profile": return profile();
            case "google.read": {
                JSONObject file = file(args.getJSONObject("file")); metadata(Protocol.json(request(path("/drive/v3/files/" + file.getString("id"), "fields", FIELDS)).bytes), file);
                Response response = request(path("/drive/v3/files/" + file.getString("id"), "alt", "media"), "GET", null, Collections.emptyMap(), Math.max(file.getInt("size"), 65536), false, "");
                Protocol.require(response.bytes.length == file.getInt("size") && Protocol.digest(response.bytes).equals(file.getString("sha256")), "file-integrity", "The Google file's contents failed verification."); return bridge.download(response.bytes);
            }
            case "google.delete": {
                // Reset only: files in the app data folder are removed one by one; one that is already gone counts as deleted.
                String id = Protocol.text(args, "fileId", 256); Protocol.require(id.matches("[A-Za-z0-9_-]{1,256}"), "invalid-source-file", "The Google file ID is invalid.");
                try { request("/drive/v3/files/" + id, "DELETE", null, Collections.emptyMap(), 65536, false, "delete"); }
                catch (Protocol.Failure failure) { if (!failure.code.equals("file-missing")) throw failure; }
                return null;
            }
            case "google.create": {
                JSONObject file = file(args.getJSONObject("file")); byte[] bytes = bridge.upload(args, "attachment");
                try { Protocol.require(bytes.length == file.getInt("size") && Protocol.digest(bytes).equals(file.getString("sha256")), "file-integrity", "The pending file's contents failed verification."); return create(file, bytes); }
                finally { Arrays.fill(bytes, (byte) 0); }
            }
            default: throw new Protocol.Failure("unsupported-method", "The Google host doesn't support this operation.");
        }
    }
    private static Map<String, String> headers(String... fields) { HashMap<String, String> result = new HashMap<>(); for (int i = 0; i < fields.length; i += 2) result.put(fields[i], fields[i + 1]); return result; }
    private static int offset(String range, int maximum, int previous) throws Exception {
        int offset = 0;
        if (range != null) { Protocol.require(range.matches("bytes=0-[0-9]+"), "invalid-upload-range", "The Google resumable upload progress is invalid."); long value = Long.parseLong(range.substring(8)); Protocol.require(value < Integer.MAX_VALUE, "invalid-upload-range", "The Google resumable upload progress is out of range."); offset = (int) value + 1; }
        Protocol.require(offset <= maximum && offset > previous, "service-unavailable", "Google hasn't confirmed new upload progress."); return offset;
    }
    private JSONObject completed(Response response, JSONObject file) throws Exception {
        JSONObject value = Protocol.json(response.bytes); metadata(value, file);
        if (!value.has("sha256Checksum")) {
            Response bytes = request(path("/drive/v3/files/" + file.getString("id"), "alt", "media"), "GET", null, Collections.emptyMap(), Math.max(65536, file.getInt("size")), false, "");
            Protocol.require(bytes.bytes.length == file.getInt("size") && Protocol.digest(bytes.bytes).equals(file.getString("sha256")), "upload-mismatch", "The Google upload failed verification.");
        }
        uploads.remove(file.getString("id")); return value;
    }
    private JSONObject create(JSONObject file, byte[] bytes) throws Exception {
        String id = file.getString("id"), digest = file.getString("sha256"), kind = file.getString("kind"); int size = file.getInt("size");
        JSONObject metadata = Protocol.object("id", id, "name", "work-fleet-v1-" + kind + "-" + digest + ".bin", "mimeType", "application/octet-stream", "parents", new JSONArray().put("appDataFolder"),
            "appProperties", Protocol.object("wfFormat", "work-fleet-file", "wfSchema", "1", "wfKind", kind, "wfSha256", digest));
        byte[] json = metadata.toString().getBytes(StandardCharsets.UTF_8);
        try {
            if (size == 0) {
                String boundary = "wf_" + Protocol.uuid(); byte[] body = ("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + metadata + "\r\n--" + boundary + "\r\nContent-Type: application/octet-stream\r\n\r\n\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
                return completed(request(path("/upload/drive/v3/files", "uploadType", "multipart", "fields", FIELDS), "POST", body, headers("Content-Type", "multipart/related; boundary=" + boundary), 2 * 1024 * 1024, false, "upload"), file);
            }
            int offset = 0; Upload upload = uploads.get(id);
            if (upload != null) {
                Protocol.require(upload.digest.equals(digest) && upload.size == size, "upload-mismatch", "The resumed upload differs from the original.");
                Response status = request(upload.path, "PUT", new byte[0], headers("Content-Range", "bytes */" + size), 2 * 1024 * 1024, true, "upload");
                if (status.status != 308) return completed(status, file); offset = offset(status.range, size, -1);
            } else {
                Response start = request(path("/upload/drive/v3/files", "uploadType", "resumable", "fields", FIELDS), "POST", json, headers("Content-Type", "application/json; charset=UTF-8", "X-Upload-Content-Type", "application/octet-stream", "X-Upload-Content-Length", Integer.toString(size)), 2 * 1024 * 1024, false, "upload");
                Protocol.require(start.location != null && start.location.length() <= 8192, "invalid-upload-session", "The Google resumable upload address is invalid."); URI uri = new URI(start.location);
                // Google echoes the request's own parameters (fields) and adds its own (session_crd) beside upload_id, so any
                // distinct plain parameters are accepted; where the contents and the token go is what stays fixed.
                String[] pairs = uri.getRawQuery() == null ? new String[0] : uri.getRawQuery().split("&", -1);
                Protocol.require("https".equals(uri.getScheme()) && "www.googleapis.com".equals(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443) && "/upload/drive/v3/files".equals(uri.getPath()) && uri.getUserInfo() == null && uri.getFragment() == null
                    && pairs.length > 0 && Arrays.stream(pairs).allMatch(pair -> pair.matches("[A-Za-z_]+=[A-Za-z0-9_%.-]*")) && Arrays.stream(pairs).map(pair -> pair.split("=", 2)[0]).distinct().count() == pairs.length
                    && Arrays.asList(pairs).contains("uploadType=resumable") && Arrays.stream(pairs).anyMatch(pair -> pair.startsWith("upload_id=") && pair.length() > 10), "invalid-upload-session", "The Google resumable upload address is invalid.");
                upload = new Upload(uri.getRawPath() + "?" + uri.getRawQuery(), digest, size); uploads.put(id, upload);
            }
            while (offset < size) {
                int end = Math.min(offset + 1024 * 1024, size); Response chunk = request(upload.path, "PUT", Arrays.copyOfRange(bytes, offset, end), headers("Content-Type", "application/octet-stream", "Content-Range", "bytes " + offset + "-" + (end - 1) + "/" + size), 2 * 1024 * 1024, true, "upload");
                if (chunk.status != 308) return completed(chunk, file); offset = offset(chunk.range, end, offset);
            }
            throw new Protocol.Failure("service-unavailable", "Google hasn't confirmed the upload. Pending changes are kept.");
        } catch (Protocol.Failure error) {
            if (Arrays.asList("file-exists", "unauthorized", "source-permission", "source-error", "upload-session-expired", "storage-quota").contains(error.code)) uploads.remove(id); throw error;
        }
    }
    @Override public void close() { closed = true; preparedAccount = null; tokens.clear(); uploads.clear(); }
}
