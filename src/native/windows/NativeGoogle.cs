using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

/// <summary>Account-bound OAuth and semantic Drive operations. No credential or upload URI leaves this service.</summary>
public sealed class NativeGoogle : IDisposable
{
  private const string Fields = "id,size,spaces,trashed,appProperties,sha256Checksum";
  private const string DriveScope = "https://www.googleapis.com/auth/drive.appdata";
  private readonly HttpClient http = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(90) };
  private readonly SemaphoreSlim gate = new(1);
  private readonly CancellationTokenSource lifetime = new();
  private readonly string directory, profile, clientId;
  private Credentials? credentials;
  private readonly Dictionary<string, (string Path, string Digest, int Size)> uploads = new(StringComparer.Ordinal);
  private string? preparedAccount;
  private sealed record Credentials(string AccountId, string Email, string ClientId, string RefreshToken, string AccessToken, long ExpiresAt);
  public bool Available => !string.IsNullOrEmpty(clientId);
  public NativeGoogle(string directory, string profile)
  {
    this.directory = directory; this.profile = profile;
    var path = Path.Combine(AppContext.BaseDirectory, "Config", "public.json");
    if (File.Exists(path))
    {
      using var config = JsonRules.Parse(File.ReadAllBytes(path));
      clientId = config.RootElement.GetProperty("google").GetProperty("clients").GetProperty("windows").GetString() ?? "";
    }
    else clientId = "";
    HostError.Require(clientId.Length == 0 || Regex.IsMatch(clientId, "^[a-zA-Z0-9-]+\\.apps\\.googleusercontent\\.com$"), "google-config", "Google client ID 設定無效。");
    if (profile.StartsWith("google:", StringComparison.Ordinal)) credentials = Load(profile[7..]);
  }
  private static string RandomToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
  private static bool Account(string id) => Regex.IsMatch(id, "^[A-Za-z0-9_-]{1,255}$");
  private string CredentialPath(string account)
  {
    HostError.Require(Account(account), "google-account", "Google 帳號身分無效。");
    return Path.Combine(directory, "google-" + account + ".vault");
  }
  private Credentials? Load(string account)
  {
    var path = CredentialPath(account); if (!File.Exists(path)) return null;
    var bytes = UserProtection.Unprotect(File.ReadAllBytes(path), "google:" + account);
    try
    {
      var value = JsonSerializer.Deserialize<Credentials>(bytes);
      return value is not null && value.AccountId == account && value.ClientId == clientId ? value : null;
    }
    finally { CryptographicOperations.ZeroMemory(bytes); }
  }
  private void Save(Credentials value)
  {
    var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
    try
    {
      var encrypted = UserProtection.Protect(bytes, "google:" + value.AccountId);
      var path = CredentialPath(value.AccountId); var temporary = path + "." + Guid.NewGuid() + ".tmp";
      using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { file.Write(encrypted); file.Flush(true); }
      File.Move(temporary, path, true);
    }
    finally { CryptographicOperations.ZeroMemory(bytes); }
  }
  public object Status() => new { configured = Available, accountId = credentials?.AccountId, email = credentials?.Email,
    connected = credentials is not null, profileId = profile };
  private static string Query(IEnumerable<KeyValuePair<string, string>> fields)
    => string.Join("&", fields.Select(pair => Uri.EscapeDataString(pair.Key) + "=" + Uri.EscapeDataString(pair.Value)));
  private static string PathQuery(string path, params (string Key, string Value)[] fields)
    => path + "?" + Query(fields.Select(p => new KeyValuePair<string, string>(p.Key, p.Value)));
  private async Task<byte[]> Bounded(HttpResponseMessage response, int maximum, CancellationToken cancellation)
  {
    HostError.Require(response.Content.Headers.ContentLength is null || response.Content.Headers.ContentLength <= maximum, "response-size", "Google 回應超過容量上限。");
    await using var stream = await response.Content.ReadAsStreamAsync(cancellation); using var result = new MemoryStream();
    var chunk = new byte[65536]; int length;
    while ((length = await stream.ReadAsync(chunk, cancellation)) > 0)
    {
      HostError.Require(result.Length + length <= maximum, "response-size", "Google 回應超過容量上限。"); result.Write(chunk, 0, length);
    }
    return result.ToArray();
  }
  private async Task<JsonElement> Token(Dictionary<string, string> form, CancellationToken cancellation)
  {
    using var request = new HttpRequestMessage(HttpMethod.Post, "https://oauth2.googleapis.com/token") { Content = new FormUrlEncodedContent(form) };
    using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation);
    var bytes = await Bounded(response, 65536, cancellation);
    try
    {
      HostError.Require(response.IsSuccessStatusCode, "unauthorized", "Google 授權未完成或已失效，請重新登入。");
      using var document = JsonRules.Parse(bytes); var value = document.RootElement;
      HostError.Require(JsonRules.Text(value, "token_type", 32).Equals("Bearer", StringComparison.OrdinalIgnoreCase), "unauthorized", "Google 授權類型無效。");
      _ = JsonRules.Text(value, "access_token", 8192); _ = JsonRules.Integer(value, "expires_in", 86400);
      return value.Clone();
    }
    finally { CryptographicOperations.ZeroMemory(bytes); }
  }
  public async Task<object> SignIn()
  {
    HostError.Require(Available, "google-config", "請先在 .env 設定 Windows Google client ID 並重新建置。");
    await gate.WaitAsync(lifetime.Token);
    try
    {
      using var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token); timeout.CancelAfter(TimeSpan.FromSeconds(110));
      var cancel = timeout.Token; var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start(4);
      try
      {
        var port = ((IPEndPoint)listener.LocalEndpoint).Port; var redirect = $"http://127.0.0.1:{port}/oauth2/callback";
        var state = RandomToken(); var verifier = RandomToken();
        var challenge = Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var auth = "https://accounts.google.com/o/oauth2/v2/auth?" + Query(new Dictionary<string, string> {
          ["client_id"] = clientId, ["redirect_uri"] = redirect, ["response_type"] = "code", ["scope"] = "openid email " + DriveScope,
          ["state"] = state, ["code_challenge"] = challenge, ["code_challenge_method"] = "S256", ["access_type"] = "offline", ["prompt"] = "consent select_account" });
        Process.Start(new ProcessStartInfo(auth) { UseShellExecute = true }); string? code = null;
        while (code is null)
        {
          using var connection = await listener.AcceptTcpClientAsync(cancel); using var stream = connection.GetStream();
          using var readTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancel); readTimeout.CancelAfter(TimeSpan.FromSeconds(5));
          var header = new List<byte>(); var one = new byte[1];
          while (header.Count < 8192 && await stream.ReadAsync(one, readTimeout.Token) == 1)
          { header.Add(one[0]); if (header.Count >= 4 && header.TakeLast(4).SequenceEqual(new byte[] { 13, 10, 13, 10 })) break; }
          var line = Encoding.ASCII.GetString(header.ToArray()).Split("\r\n")[0].Split(' ');
          Uri? callback = null;
          if (line.Length == 3 && line[0] == "GET" && line[1].StartsWith("/oauth2/callback?", StringComparison.Ordinal)) Uri.TryCreate("http://127.0.0.1:" + port + line[1], UriKind.Absolute, out callback);
          var query = callback is null ? new Dictionary<string, string[]>() : callback.Query.TrimStart('?').Split('&').Select(part => part.Split('=', 2))
            .GroupBy(part => Uri.UnescapeDataString(part[0])).ToDictionary(group => group.Key, group => group.Select(part => part.Length == 2 ? Uri.UnescapeDataString(part[1].Replace('+', ' ')) : "").ToArray());
          var valid = callback?.AbsolutePath == "/oauth2/callback" && query.TryGetValue("state", out var states) && states.Length == 1 && states[0] == state;
          var body = Encoding.UTF8.GetBytes(valid ? "Work Fleet: You may close this browser tab." : "Invalid callback.");
          var response = Encoding.ASCII.GetBytes($"HTTP/1.1 {(valid ? "200 OK" : "400 Bad Request")}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {body.Length}\r\n\r\n");
          await stream.WriteAsync(response, cancel); await stream.WriteAsync(body, cancel);
          if (!valid) continue;
          HostError.Require(!query.ContainsKey("error") && query.TryGetValue("code", out var codes) && codes.Length == 1 && codes[0].Length is > 0 and <= 8192, "google-cancelled", "Google 登入已取消或未授權。");
          code = query["code"][0];
        }
        var tokens = await Token(new() { ["client_id"] = clientId, ["code"] = code, ["code_verifier"] = verifier,
          ["redirect_uri"] = redirect, ["grant_type"] = "authorization_code" }, cancel);
        var access = JsonRules.Text(tokens, "access_token", 8192);
        var scopes = JsonRules.Text(tokens, "scope", 4096).Split(' ');
        HostError.Require(scopes.Contains(DriveScope) && scopes.Contains("openid"), "source-permission", "請授權 Work Fleet 的 Google 身分及 App 資料同步。");
        using var identityRequest = new HttpRequestMessage(HttpMethod.Get, "https://openidconnect.googleapis.com/v1/userinfo");
        identityRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", access);
        using var identityResponse = await http.SendAsync(identityRequest, HttpCompletionOption.ResponseHeadersRead, cancel);
        HostError.Require(identityResponse.IsSuccessStatusCode, "unauthorized", "無法確認 Google 帳號。");
        using var identity = JsonRules.Parse(await Bounded(identityResponse, 65536, cancel));
        var account = JsonRules.Text(identity.RootElement, "sub", 255); HostError.Require(Account(account), "google-account", "Google 帳號身分無效。");
        var email = identity.RootElement.TryGetProperty("email", out var emailValue) ? emailValue.GetString() ?? "" : "";
        var saved = new Credentials(account, email, clientId, JsonRules.Text(tokens, "refresh_token", 8192), access,
          DateTimeOffset.UtcNow.ToUnixTimeSeconds() + JsonRules.Integer(tokens, "expires_in", 86400));
        Save(saved); preparedAccount = account;
        return new { accountId = account, email, profileId = "google:" + account };
      }
      finally { listener.Stop(); }
    }
    catch (OperationCanceledException) { throw new HostError("google-cancelled", "Google 登入逾時或已取消，請重試。"); }
    finally { gate.Release(); }
  }
  public string OpenAccount(string account)
  {
    HostError.Require(account == preparedAccount && Load(account) is not null, "google-account", "請先完成此帳號登入。");
    preparedAccount = null; return "google:" + account;
  }
  public async Task SignOut()
  {
    await gate.WaitAsync(lifetime.Token);
    try
    {
      if (credentials is null) return;
      // Disconnect locally even if the remote revocation is temporarily unreachable.
      var token = credentials.RefreshToken; var path = CredentialPath(credentials.AccountId); credentials = null; uploads.Clear(); File.Delete(path);
      try
      {
        using var response = await http.PostAsync("https://oauth2.googleapis.com/revoke", new FormUrlEncodedContent(new Dictionary<string, string> { ["token"] = token }), lifetime.Token);
      }
      catch (HttpRequestException) { }
    }
    finally { gate.Release(); }
  }
  private async Task Refresh(CancellationToken cancellation)
  {
    HostError.Require(credentials is not null && profile == "google:" + credentials.AccountId, "unauthorized", "請先登入 Google。");
    if (credentials!.ExpiresAt > DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 60) return;
    var tokens = await Token(new() { ["client_id"] = clientId, ["refresh_token"] = credentials.RefreshToken, ["grant_type"] = "refresh_token" }, cancellation);
    credentials = credentials with { AccessToken = JsonRules.Text(tokens, "access_token", 8192), ExpiresAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + JsonRules.Integer(tokens, "expires_in", 86400) };
    Save(credentials);
  }
  private async Task<(int Status, byte[] Body, string? Location, string? Range)> Request(string path, HttpMethod? method = null, byte[]? body = null,
    Dictionary<string, string>? headers = null, int maximum = 2 * 1024 * 1024, bool allow308 = false, string context = "")
  {
    var cancel = lifetime.Token; await Refresh(cancel);
    var uri = new Uri("https://www.googleapis.com" + path);
    HostError.Require(uri.Scheme == "https" && uri.Host == "www.googleapis.com" && uri.Port == 443 && string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Fragment), "invalid-source", "Google 傳輸位置無效。");
    using var request = new HttpRequestMessage(method ?? HttpMethod.Get, uri);
    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credentials!.AccessToken);
    if (body is not null) request.Content = new ByteArrayContent(body);
    foreach (var pair in headers ?? [])
    {
      if (!request.Headers.TryAddWithoutValidation(pair.Key, pair.Value)) request.Content?.Headers.TryAddWithoutValidation(pair.Key, pair.Value);
    }
    using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancel);
    var bytes = await Bounded(response, maximum, cancel); var status = (int)response.StatusCode;
    if (!response.IsSuccessStatusCode && !(allow308 && status == 308))
    {
      string? reason = null;
      try { using var error = JsonRules.Parse(bytes); reason = error.RootElement.GetProperty("error").GetProperty("errors")[0].GetProperty("reason").GetString(); } catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException or IndexOutOfRangeException) { }
      if (status == 401) { credentials = credentials with { ExpiresAt = 0 }; }
      var code = status == 401 ? "unauthorized" : status == 409 ? "file-exists" : status == 429 || reason is "rateLimitExceeded" or "userRateLimitExceeded" ? "rate-limit"
        : status >= 500 ? "service-unavailable" : status == 410 && context == "changes" ? "cursor-expired" : status is 400 or 410 && context == "listing" ? "page-expired"
        : status == 404 && context == "upload" ? "upload-session-expired" : reason == "storageQuotaExceeded" ? "storage-quota" : status == 403 ? "source-permission" : "source-error";
      throw new HostError(code, "Google Drive 未完成同步（" + code + "），本機資料與待送內容仍保留。");
    }
    return (status, bytes, response.Headers.Location?.AbsoluteUri,
      response.Headers.TryGetValues("Range", out var range) ? range.Single() : null);
  }
  private async Task<JsonElement> Json(string path, string context = "")
  { var response = await Request(path, context: context); using var value = JsonRules.Parse(response.Body); return value.RootElement.Clone(); }
  private static (string Id, string Kind, string Digest, int Size) FileInfo(JsonElement file)
  {
    var id = JsonRules.Text(file, "id"); var kind = JsonRules.Text(file, "kind"); var digest = JsonRules.Text(file, "sha256");
    HostError.Require(Regex.IsMatch(id, "^[A-Za-z0-9_-]{1,256}$") && kind is "revision" or "attachment", "invalid-source-file", "同步檔案身分無效。");
    LocalDatabase.CheckDigest(digest); var size = (int)JsonRules.Integer(file, "size", kind == "revision" ? 8 * 1024 * 1024 : LocalDatabase.MaxAttachment);
    return (id, kind, digest, size);
  }
  public async Task<object?> Drive(string method, JsonElement args, BridgeSession bridge)
  {
    await gate.WaitAsync(lifetime.Token);
    try
    {
      HostError.Require(credentials is not null && JsonRules.Text(args, "accountId") == credentials.AccountId && profile == "google:" + credentials.AccountId, "stale-session", "Google 帳號已切換。");
      switch (method)
      {
        case "google.cursor": return await Json(PathQuery("/drive/v3/changes/startPageToken", ("fields", "startPageToken")));
        case "google.list":
        {
          var path = PathQuery("/drive/v3/files", ("spaces", "appDataFolder"), ("q", "trashed = false"), ("pageSize", "100"), ("fields", $"nextPageToken,incompleteSearch,files({Fields})"));
          if (args.TryGetProperty("pageToken", out var page) && page.ValueKind != JsonValueKind.Null) path += "&pageToken=" + Uri.EscapeDataString(JsonRules.Text(args, "pageToken", 8192));
          return await Json(path, "listing");
        }
        case "google.changes": return await Json(PathQuery("/drive/v3/changes", ("pageToken", JsonRules.Text(args, "cursor", 8192)), ("spaces", "appDataFolder"), ("pageSize", "100"), ("includeRemoved", "true"), ("fields", $"nextPageToken,newStartPageToken,changes(fileId,removed,file({Fields}))")), "changes");
        case "google.allocate": return await Json(PathQuery("/drive/v3/files/generateIds", ("count", "1"), ("space", "appDataFolder"), ("type", "files"), ("fields", "ids")));
        case "google.read":
        {
          var file = FileInfo(args.GetProperty("file"));
          // Verify metadata before reading: appdata authorization alone does not validate the supplied descriptor.
          var metadata = await Json(PathQuery("/drive/v3/files/" + file.Id, ("fields", Fields)));
          ValidateMetadata(metadata, file);
          var response = await Request(PathQuery("/drive/v3/files/" + file.Id, ("alt", "media")), maximum: Math.Max(file.Size, 65536));
          HostError.Require(response.Body.Length == file.Size && LocalDatabase.Digest(response.Body) == file.Digest, "file-integrity", "Google 檔案校驗失敗。");
          return bridge.DownloadBytes(response.Body);
        }
        case "google.create":
        {
          var file = FileInfo(args.GetProperty("file")); var bytes = bridge.UploadBytes(JsonRules.Text(args, "token"));
          try
          {
            HostError.Require(bytes.Length == file.Size && LocalDatabase.Digest(bytes) == file.Digest, "file-integrity", "待送內容校驗失敗。");
            return await Create(file, bytes);
          }
          finally { CryptographicOperations.ZeroMemory(bytes); }
        }
        default: throw new HostError("unsupported-method", "Google 主機沒有此操作。");
      }
    }
    catch (HttpRequestException) { throw new HostError("network", "無法連接 Google Drive，本機資料與待送內容仍保留。"); }
    finally { gate.Release(); }
  }
  private static void ValidateMetadata(JsonElement metadata, (string Id, string Kind, string Digest, int Size) file)
  {
    var properties = metadata.GetProperty("appProperties");
    HostError.Require(JsonRules.Text(metadata, "id") == file.Id && JsonRules.Text(metadata, "size") == file.Size.ToString(System.Globalization.CultureInfo.InvariantCulture)
      && metadata.GetProperty("spaces").EnumerateArray().Any(v => v.GetString() == "appDataFolder")
      && (!metadata.TryGetProperty("trashed", out var trashed) || !trashed.GetBoolean())
      && JsonRules.Text(properties, "wfFormat") == "work-fleet-file" && JsonRules.Text(properties, "wfSchema") == "1"
      && JsonRules.Text(properties, "wfKind") == file.Kind && JsonRules.Text(properties, "wfSha256") == file.Digest
      && (!metadata.TryGetProperty("sha256Checksum", out var sha) || sha.GetString() == file.Digest), "upload-mismatch", "Google 檔案 metadata 與內容身分不同。");
  }
  private async Task<JsonElement> Create((string Id, string Kind, string Digest, int Size) file, byte[] bytes)
  {
    var metadata = JsonSerializer.SerializeToUtf8Bytes(new { id = file.Id, name = $"work-fleet-v1-{file.Kind}-{file.Digest}.bin", mimeType = "application/octet-stream", parents = new[] { "appDataFolder" },
      appProperties = new { wfFormat = "work-fleet-file", wfSchema = "1", wfKind = file.Kind, wfSha256 = file.Digest } });
    (int Status, byte[] Body, string? Location, string? Range) response;
    try
    {
      if (file.Size == 0)
      {
        var boundary = "wf_" + Guid.NewGuid().ToString("N");
        var multipart = Encoding.UTF8.GetBytes($"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{Encoding.UTF8.GetString(metadata)}\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n\r\n--{boundary}--\r\n");
        response = await Request(PathQuery("/upload/drive/v3/files", ("uploadType", "multipart"), ("fields", Fields)), HttpMethod.Post, multipart, new() { ["Content-Type"] = "multipart/related; boundary=" + boundary });
      }
      else
      {
        var offset = 0;
        if (uploads.TryGetValue(file.Id, out var session))
        {
          HostError.Require(session.Digest == file.Digest && session.Size == file.Size, "upload-mismatch", "續傳內容已變更。");
          response = await Request(session.Path, HttpMethod.Put, [], new() { ["Content-Range"] = $"bytes */{file.Size}" }, allow308: true, context: "upload");
          if (response.Status != 308) return await Completed(response.Body, file);
          offset = Offset(response.Range, file.Size, -1);
        }
        else
        {
          response = await Request(PathQuery("/upload/drive/v3/files", ("uploadType", "resumable"), ("fields", Fields)), HttpMethod.Post, metadata,
            new() { ["Content-Type"] = "application/json; charset=UTF-8", ["X-Upload-Content-Type"] = "application/octet-stream", ["X-Upload-Content-Length"] = file.Size.ToString(System.Globalization.CultureInfo.InvariantCulture) });
          HostError.Require(Uri.TryCreate(response.Location, UriKind.Absolute, out var location) && location.Scheme == "https" && location.Host == "www.googleapis.com" && location.Port == 443 && location.AbsolutePath == "/upload/drive/v3/files" && string.IsNullOrEmpty(location.UserInfo) && string.IsNullOrEmpty(location.Fragment)
            && Regex.IsMatch(location.Query, "^\\?(?:uploadType=resumable&upload_id=[A-Za-z0-9_%.-]+|upload_id=[A-Za-z0-9_%.-]+&uploadType=resumable)$"), "invalid-upload-session", "Google 續傳位置無效。");
          session = (location!.PathAndQuery, file.Digest, file.Size); uploads[file.Id] = session;
        }
        while (offset < file.Size)
        {
          var end = Math.Min(offset + 1024 * 1024, file.Size);
          response = await Request(session.Path, HttpMethod.Put, bytes[offset..end], new() { ["Content-Type"] = "application/octet-stream", ["Content-Range"] = $"bytes {offset}-{end - 1}/{file.Size}" }, allow308: true, context: "upload");
          if (response.Status != 308) return await Completed(response.Body, file);
          offset = Offset(response.Range, end, offset);
        }
        throw new HostError("service-unavailable", "Google 尚未確認上傳完成，待送内容仍保留。");
      }
      return await Completed(response.Body, file);
    }
    catch (HostError error)
    {
      if (error.Code is "unauthorized" or "file-exists" or "upload-session-expired" or "source-error" or "source-permission" or "storage-quota") uploads.Remove(file.Id);
      throw;
    }
  }
  private static int Offset(string? range, int maximum, int previous)
  {
    var match = Regex.Match(range ?? "", "^bytes=0-([0-9]+)$");
    var offset = range is null ? 0 : match.Success && int.TryParse(match.Groups[1].Value, out var last) && last < int.MaxValue ? last + 1 : -1;
    HostError.Require(offset >= 0 && offset <= maximum && offset > previous, "service-unavailable", "Google 續傳進度無效，待送内容仍保留。"); return offset;
  }
  private async Task<JsonElement> Completed(byte[] body, (string Id, string Kind, string Digest, int Size) file)
  {
    using var document = JsonRules.Parse(body); ValidateMetadata(document.RootElement, file);
    if (!document.RootElement.TryGetProperty("sha256Checksum", out _))
    {
      var content = await Request(PathQuery("/drive/v3/files/" + file.Id, ("alt", "media")), maximum: Math.Max(file.Size, 65536));
      HostError.Require(content.Body.Length == file.Size && LocalDatabase.Digest(content.Body) == file.Digest, "upload-mismatch", "Google 上傳內容校驗失敗。");
    }
    uploads.Remove(file.Id); return document.RootElement.Clone();
  }
  public void Dispose() { lifetime.Cancel(); http.Dispose(); }
}
