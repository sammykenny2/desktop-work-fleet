package app.workfleet.nativehost;

import android.accounts.Account;
import android.content.SharedPreferences;
import android.util.Base64;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.auth.api.identity.RevokeAccessRequest;
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

final class GoogleFiles implements AutoCloseable {
    private static final String FIELDS = "id,size,spaces,trashed,appProperties,sha256Checksum";
    private static final List<Scope> SCOPES = Arrays.asList(new Scope("openid"), new Scope("email"), new Scope("https://www.googleapis.com/auth/drive.appdata"));
    private final FleetActivity activity;
    private final FleetDatabase database;
    private final SharedPreferences preferences;
    private final String clientId;
    private final HashMap<String, Upload> uploads = new HashMap<>();
    private JSONObject account;
    private String preparedAccount, accessToken;
    private long tokenAt;
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
        Protocol.require(id.matches("[A-Za-z0-9_-]{1,255}"), "google-account", "Google 帳號身分無效。");
        String value = preferences.getString(id, null); if (value == null) return null;
        byte[] bytes = database.unprotect(Base64.decode(value, Base64.DEFAULT), "google-account:" + id);
        try { JSONObject account = Protocol.json(bytes); return account.getString("accountId").equals(id) && account.getString("clientId").equals(clientId) ? account : null; }
        finally { Arrays.fill(bytes, (byte) 0); }
    }
    private void save(JSONObject value) throws Exception {
        String id = value.getString("accountId"); byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
        try { Protocol.require(preferences.edit().putString(id, Base64.encodeToString(database.protect(bytes, "google-account:" + id), Base64.NO_WRAP)).commit(), "native-storage", "Google 帳號選擇尚未保存。"); }
        finally { Arrays.fill(bytes, (byte) 0); }
    }
    Object status() throws Exception { return Protocol.object("configured", activity.googleConfigured(), "connected", account != null, "accountId", account == null ? null : account.getString("accountId"), "email", account == null ? null : account.getString("email"), "profileId", database.profile); }
    private static String encode(String value) throws Exception { return URLEncoder.encode(value, "UTF-8"); }
    private static String path(String base, String... fields) throws Exception { StringBuilder query = new StringBuilder(base).append('?'); for (int i = 0; i < fields.length; i += 2) { if (i != 0) query.append('&'); query.append(encode(fields[i])).append('=').append(encode(fields[i + 1])); } return query.toString(); }
    private Response http(String uri, String method, String token, byte[] body, Map<String, String> headers, int maximum) throws Exception {
        Protocol.require(!closed, "stale-session", "Google 工作階段已結束。"); URL url = new URL(uri);
        Protocol.require(url.getProtocol().equals("https") && (url.getHost().equals("www.googleapis.com") || url.getHost().equals("openidconnect.googleapis.com")) && url.getUserInfo() == null && url.getRef() == null && (url.getPort() == -1 || url.getPort() == 443), "invalid-source", "Google HTTPS 位置無效。");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection(); connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(90000); connection.setRequestMethod(method);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        for (Map.Entry<String, String> header : headers.entrySet()) connection.setRequestProperty(header.getKey(), header.getValue());
        try {
            if (body != null) { connection.setDoOutput(true); connection.setFixedLengthStreamingMode(body.length); try (OutputStream output = connection.getOutputStream()) { output.write(body); } }
            int status = connection.getResponseCode(); long length = connection.getContentLengthLong(); Protocol.require(length < 0 || length <= maximum, "response-size", "Google 回應容量超限。");
            byte[] bytes; try (InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) { bytes = Protocol.bytes(input, maximum); }
            Protocol.require(!closed, "stale-session", "Google 工作階段已結束。"); return new Response(status, bytes, connection.getHeaderField("Location"), connection.getHeaderField("Range"));
        } finally { connection.disconnect(); }
    }
    private JSONObject authorize(String email, boolean interactive, String expected) throws Exception {
        AuthorizationRequest request = AuthorizationRequest.builder().setAccount(new Account(email, "com.google")).setRequestedScopes(SCOPES).build();
        AuthorizationResult result = activity.authorize(request, interactive);
        Protocol.require(result.getAccessToken() != null && !result.getAccessToken().isEmpty(), "unauthorized", "Google 未授權 Drive App 資料。");
        String token = result.getAccessToken(); Response identity = http("https://openidconnect.googleapis.com/v1/userinfo", "GET", token, null, Collections.emptyMap(), 65536);
        Protocol.require(identity.status == 200, "unauthorized", "無法確認 Google 帳號。"); JSONObject info = Protocol.json(identity.bytes); String id = Protocol.text(info, "sub", 255);
        Protocol.require(id.matches("[A-Za-z0-9_-]{1,255}") && (expected == null || expected.equals(id)), "stale-session", "Google 帳號與工作空間不同，未傳送便箋。");
        accessToken = token; tokenAt = System.currentTimeMillis(); return Protocol.object("accountId", id, "email", email, "clientId", clientId);
    }
    synchronized Object signIn() throws Exception {
        String email = activity.selectGoogleEmail(); JSONObject value = authorize(email, true, null); save(value); preparedAccount = value.getString("accountId");
        return Protocol.object("accountId", preparedAccount, "email", email, "profileId", "google:" + preparedAccount);
    }
    synchronized String open(String id) throws Exception { Protocol.require(id.equals(preparedAccount) && load(id) != null, "google-account", "請先完成此 Google 帳號登入。"); preparedAccount = null; return "google:" + id; }
    synchronized void signOut() throws Exception {
        if (account == null) return;
        JSONObject previous = account; account = null; accessToken = null; uploads.clear();
        Protocol.require(preferences.edit().remove(previous.getString("accountId")).commit(), "native-storage", "登入憑證尚未移除。");
        try { com.google.android.gms.tasks.Tasks.await(Identity.getAuthorizationClient(activity).revokeAccess(RevokeAccessRequest.builder().setAccount(new Account(previous.getString("email"), "com.google")).setScopes(SCOPES).build()), 20, TimeUnit.SECONDS); } catch (Exception ignored) { }
    }
    private String token() throws Exception {
        Protocol.require(account != null && database.profile.equals("google:" + account.getString("accountId")), "unauthorized", "請先登入 Google。");
        if (accessToken == null || System.currentTimeMillis() - tokenAt > 45 * 60000L) authorize(account.getString("email"), false, account.getString("accountId")); return accessToken;
    }
    private Response request(String path, String method, byte[] body, Map<String, String> headers, int maximum, boolean allow308, String context) throws Exception {
        Response response;
        try { response = http("https://www.googleapis.com" + path, method, token(), body, headers, maximum); }
        catch (java.io.IOException error) { throw new Protocol.Failure("network", "無法連接 Google Drive，待送內容保留。"); }
        if (response.status >= 200 && response.status < 300 || allow308 && response.status == 308) return response;
        String reason = "";
        try { reason = Protocol.json(response.bytes).getJSONObject("error").getJSONArray("errors").getJSONObject(0).getString("reason"); } catch (Exception ignored) { }
        if (response.status == 401) { String expired = accessToken; accessToken = null; if (expired != null) Identity.getAuthorizationClient(activity).clearToken(ClearTokenRequest.builder().setToken(expired).build()); }
        String code = response.status == 401 ? "unauthorized" : response.status == 409 ? "file-exists"
            : response.status == 429 || reason.equals("rateLimitExceeded") || reason.equals("userRateLimitExceeded") ? "rate-limit"
            : response.status >= 500 ? "service-unavailable" : response.status == 410 && context.equals("changes") ? "cursor-expired"
            : (response.status == 400 || response.status == 410) && context.equals("listing") ? "page-expired"
            : response.status == 404 && context.equals("upload") ? "upload-session-expired" : response.status == 404 && context.equals("delete") ? "file-missing"
            : reason.equals("storageQuotaExceeded") ? "storage-quota"
            : response.status == 403 ? "source-permission" : "source-error";
        throw new Protocol.Failure(code, "Google Drive 未完成同步（" + code + "），本機資料與待送內容保留。");
    }
    private Response request(String path) throws Exception { return request(path, "GET", null, Collections.emptyMap(), 2 * 1024 * 1024, false, ""); }
    private static JSONObject file(JSONObject value) throws Exception {
        String id = Protocol.text(value, "id", 256), kind = Protocol.text(value, "kind", 16), sha = Protocol.text(value, "sha256", 64); Protocol.digest(sha);
        Protocol.require(id.matches("[A-Za-z0-9_-]{1,256}") && (kind.equals("revision") || kind.equals("attachment") || kind.equals("reset")), "invalid-source-file", "Google 檔案身分無效。");
        long size = Protocol.number(value, "size", kind.equals("revision") ? 8 * 1024 * 1024 : kind.equals("reset") ? 4096 : Protocol.ATTACHMENT); return Protocol.object("id", id, "kind", kind, "sha256", sha, "size", size);
    }
    private static void metadata(JSONObject metadata, JSONObject file) throws Exception {
        JSONObject properties = metadata.getJSONObject("appProperties"); boolean appdata = false; JSONArray spaces = metadata.getJSONArray("spaces"); for (int i = 0; i < spaces.length(); i++) if (spaces.getString(i).equals("appDataFolder")) appdata = true;
        Protocol.require(metadata.getString("id").equals(file.getString("id")) && metadata.getString("size").equals(Long.toString(file.getLong("size"))) && appdata && !metadata.optBoolean("trashed", false)
            && properties.getString("wfFormat").equals("work-fleet-file") && properties.getString("wfSchema").equals("1") && properties.getString("wfKind").equals(file.getString("kind")) && properties.getString("wfSha256").equals(file.getString("sha256"))
            && (!metadata.has("sha256Checksum") || metadata.getString("sha256Checksum").equals(file.getString("sha256"))), "upload-mismatch", "Google 檔案 metadata 與內容不同。");
    }
    synchronized Object invoke(String method, JSONObject args, FleetBridge bridge) throws Exception {
        Protocol.require(!closed && account != null && Protocol.text(args, "accountId", 255).equals(account.getString("accountId")), "stale-session", "Google 帳號已切換。");
        switch (method) {
            case "google.cursor": return Protocol.json(request(path("/drive/v3/changes/startPageToken", "fields", "startPageToken")).bytes);
            case "google.list": {
                String path = path("/drive/v3/files", "spaces", "appDataFolder", "q", "trashed = false", "pageSize", "100", "fields", "nextPageToken,incompleteSearch,files(" + FIELDS + ")");
                if (!args.isNull("pageToken")) path += "&pageToken=" + encode(Protocol.text(args, "pageToken", 8192));
                return Protocol.json(request(path, "GET", null, Collections.emptyMap(), 2 * 1024 * 1024, false, "listing").bytes);
            }
            case "google.changes": return Protocol.json(request(path("/drive/v3/changes", "pageToken", Protocol.text(args, "cursor", 8192), "spaces", "appDataFolder", "includeRemoved", "true", "pageSize", "100", "fields", "nextPageToken,newStartPageToken,changes(fileId,removed,file(" + FIELDS + ",mimeType))"), "GET", null, Collections.emptyMap(), 2 * 1024 * 1024, false, "changes").bytes);
            case "google.allocate": return Protocol.json(request(path("/drive/v3/files/generateIds", "count", "1", "space", "appDataFolder", "type", "files", "fields", "ids")).bytes);
            case "google.read": {
                JSONObject file = file(args.getJSONObject("file")); metadata(Protocol.json(request(path("/drive/v3/files/" + file.getString("id"), "fields", FIELDS)).bytes), file);
                Response response = request(path("/drive/v3/files/" + file.getString("id"), "alt", "media"), "GET", null, Collections.emptyMap(), Math.max(file.getInt("size"), 65536), false, "");
                Protocol.require(response.bytes.length == file.getInt("size") && Protocol.digest(response.bytes).equals(file.getString("sha256")), "file-integrity", "Google 檔案內容校驗失敗。"); return bridge.download(response.bytes);
            }
            case "google.delete": {
                // Reset only: files in the app data folder are removed one by one; one that is already gone counts as deleted.
                String id = Protocol.text(args, "fileId", 256); Protocol.require(id.matches("[A-Za-z0-9_-]{1,256}"), "invalid-source-file", "Google 檔案身分無效。");
                try { request("/drive/v3/files/" + id, "DELETE", null, Collections.emptyMap(), 65536, false, "delete"); }
                catch (Protocol.Failure failure) { if (!failure.code.equals("file-missing")) throw failure; }
                return null;
            }
            case "google.create": {
                JSONObject file = file(args.getJSONObject("file")); byte[] bytes = bridge.upload(args, "attachment");
                try { Protocol.require(bytes.length == file.getInt("size") && Protocol.digest(bytes).equals(file.getString("sha256")), "file-integrity", "待送檔案內容校驗失敗。"); return create(file, bytes); }
                finally { Arrays.fill(bytes, (byte) 0); }
            }
            default: throw new Protocol.Failure("unsupported-method", "Google 主機沒有此操作。");
        }
    }
    private static Map<String, String> headers(String... fields) { HashMap<String, String> result = new HashMap<>(); for (int i = 0; i < fields.length; i += 2) result.put(fields[i], fields[i + 1]); return result; }
    private static int offset(String range, int maximum, int previous) throws Exception {
        int offset = 0;
        if (range != null) { Protocol.require(range.matches("bytes=0-[0-9]+"), "invalid-upload-range", "Google 續傳進度無效。"); long value = Long.parseLong(range.substring(8)); Protocol.require(value < Integer.MAX_VALUE, "invalid-upload-range", "Google 續傳進度超限。"); offset = (int) value + 1; }
        Protocol.require(offset <= maximum && offset > previous, "service-unavailable", "Google 尚未確認新的續傳進度。"); return offset;
    }
    private JSONObject completed(Response response, JSONObject file) throws Exception {
        JSONObject value = Protocol.json(response.bytes); metadata(value, file);
        if (!value.has("sha256Checksum")) {
            Response bytes = request(path("/drive/v3/files/" + file.getString("id"), "alt", "media"), "GET", null, Collections.emptyMap(), Math.max(65536, file.getInt("size")), false, "");
            Protocol.require(bytes.bytes.length == file.getInt("size") && Protocol.digest(bytes.bytes).equals(file.getString("sha256")), "upload-mismatch", "Google 上傳內容校驗失敗。");
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
                Protocol.require(upload.digest.equals(digest) && upload.size == size, "upload-mismatch", "續傳內容與原上傳不同。");
                Response status = request(upload.path, "PUT", new byte[0], headers("Content-Range", "bytes */" + size), 2 * 1024 * 1024, true, "upload");
                if (status.status != 308) return completed(status, file); offset = offset(status.range, size, -1);
            } else {
                Response start = request(path("/upload/drive/v3/files", "uploadType", "resumable", "fields", FIELDS), "POST", json, headers("Content-Type", "application/json; charset=UTF-8", "X-Upload-Content-Type", "application/octet-stream", "X-Upload-Content-Length", Integer.toString(size)), 2 * 1024 * 1024, false, "upload");
                Protocol.require(start.location != null && start.location.length() <= 8192, "invalid-upload-session", "Google 續傳位置無效。"); URI uri = new URI(start.location);
                // Google echoes the request's own parameters (fields) and adds its own (session_crd) beside upload_id, so any
                // distinct plain parameters are accepted; where the contents and the token go is what stays fixed.
                String[] pairs = uri.getRawQuery() == null ? new String[0] : uri.getRawQuery().split("&", -1);
                Protocol.require("https".equals(uri.getScheme()) && "www.googleapis.com".equals(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443) && "/upload/drive/v3/files".equals(uri.getPath()) && uri.getUserInfo() == null && uri.getFragment() == null
                    && pairs.length > 0 && Arrays.stream(pairs).allMatch(pair -> pair.matches("[A-Za-z_]+=[A-Za-z0-9_%.-]*")) && Arrays.stream(pairs).map(pair -> pair.split("=", 2)[0]).distinct().count() == pairs.length
                    && Arrays.asList(pairs).contains("uploadType=resumable") && Arrays.stream(pairs).anyMatch(pair -> pair.startsWith("upload_id=") && pair.length() > 10), "invalid-upload-session", "Google 續傳位置無效。");
                upload = new Upload(uri.getRawPath() + "?" + uri.getRawQuery(), digest, size); uploads.put(id, upload);
            }
            while (offset < size) {
                int end = Math.min(offset + 1024 * 1024, size); Response chunk = request(upload.path, "PUT", Arrays.copyOfRange(bytes, offset, end), headers("Content-Type", "application/octet-stream", "Content-Range", "bytes " + offset + "-" + (end - 1) + "/" + size), 2 * 1024 * 1024, true, "upload");
                if (chunk.status != 308) return completed(chunk, file); offset = offset(chunk.range, end, offset);
            }
            throw new Protocol.Failure("service-unavailable", "Google 尚未確認上傳完成，待送內容保留。");
        } catch (Protocol.Failure error) {
            if (Arrays.asList("file-exists", "unauthorized", "source-permission", "source-error", "upload-session-expired", "storage-quota").contains(error.code)) uploads.remove(id); throw error;
        }
    }
    @Override public void close() { closed = true; accessToken = null; uploads.clear(); }
}
