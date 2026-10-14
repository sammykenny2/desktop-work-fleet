using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

/// <summary>
/// ADR-044 Windows updater. GitHub Releases of the configured public repository, no credentials, HTTPS only, a fixed host
/// allowlist with at most three redirects, size limits and a streamed SHA-256. One check or download runs at a time;
/// repeated requests join it. Installing is FleetWindow's job, after the durable close.
/// </summary>
public sealed class NativeUpdater : IDisposable
{
  public const string Platform = "windows", Architecture = "x64";
  private const long MaxFeedBytes = 2 * 1024 * 1024, MaxManifestBytes = 64 * 1024;
  private static readonly string[] FeedHosts = ["github.com"];
  private static readonly string[] DownloadHosts = ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"];
  private readonly HttpClient http = new(new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false, PooledConnectionLifetime = TimeSpan.FromMinutes(5) })
  { Timeout = Timeout.InfiniteTimeSpan };
  private readonly CancellationTokenSource lifetime = new();
  private readonly string folder, repository, channel, currentText, reason;
  private readonly Version current;
  private readonly (string Name, string Publisher, Version Version)? identity;
  private readonly string? testFeed;
  private readonly Action<object> publish;
  private readonly Action<string> recordCheck;
  private string status = "idle";
  private string? lastChecked, errorCode, errorMessage, downloaded;
  private UpdatePackage? pending;
  private long received, total;
  private Task? running;
  private DateTime lastProgress;
  public bool Capable { get; }
  /// <summary>The isolated update probe: install without asking and report failures to a file instead of a dialog.</summary>
  public bool Probe => testFeed is not null;
  public string Status => status;
  public string? PendingVersion => pending?.Version;
  public string? PendingSummary => pending?.Summary;
  public string? ErrorMessage => errorMessage;
  /// <summary>Download progress in percent while downloading, else null.</summary>
  public int? Percent => status == "downloading" && total > 0 ? (int)(received * 100 / total) : null;

  public NativeUpdater(string dataDirectory, string? lastChecked, Action<object> publish, Action<string> recordCheck)
  {
    folder = Path.Combine(dataDirectory, "updates"); this.lastChecked = lastChecked; this.publish = publish; this.recordCheck = recordCheck;
    currentText = HostIdentity.BuildVersion(); current = UpdateFeed.ParseVersion(currentText) ?? new Version(0, 0, 0);
    (repository, channel) = ReadSource();
    if (AppDataDirectory.Packaged)
    {
      var id = global::Windows.ApplicationModel.Package.Current.Id; var version = id.Version;
      identity = (id.Name, id.Publisher, new Version(version.Major, version.Minor, version.Build, version.Revision));
      // Only the isolated update probe identity (Test-WindowsUpdate.ps1) reads a local folder instead of GitHub and
      // updates itself once started; any other package ignores the probe file.
      var probe = Path.Combine(dataDirectory, "update-probe.txt");
      if (id.Name.StartsWith("app.workfleet.updateprobe.", StringComparison.Ordinal) && File.Exists(probe)
        && File.ReadAllText(probe).Trim() is { Length: > 0 } feed && Directory.Exists(feed)) testFeed = Path.GetFullPath(feed);
    }
    Capable = identity is not null && repository.Length > 0;
    reason = identity is null ? "只有安裝版（MSIX）支援 App 內更新。" : repository.Length == 0 ? "這個版本沒有設定更新來源。" : "";
    if (!Capable) status = "unavailable";
  }
  private static (string Repository, string Channel) ReadSource()
  {
    try
    {
      var path = Path.Combine(AppContext.BaseDirectory, "Config", "public.json");
      using var config = JsonRules.Parse(File.ReadAllBytes(path));
      if (!config.RootElement.TryGetProperty("update", out var update)) return ("", "preview");
      var repository = update.TryGetProperty("repository", out var value) && value.ValueKind == JsonValueKind.String ? value.GetString()! : "";
      var channel = update.TryGetProperty("channel", out var kind) && kind.ValueKind == JsonValueKind.String ? kind.GetString()! : "preview";
      return (System.Text.RegularExpressions.Regex.IsMatch(repository, "^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$") ? repository : "", channel);
    }
    catch { return ("", "preview"); }
  }

  public object Snapshot()
  {
    var next = status switch
    {
      "idle" or "up_to_date" => "check",
      "update_available" => "download",
      "downloaded" => "install",
      "failed" => pending is null ? "check" : downloaded is null ? "download" : "install",
      _ => "none"
    };
    return new
    {
      available = Capable, reason = Capable ? null : reason, currentVersion = currentText, channel, status, nextAction = next,
      version = pending?.Version, summary = pending?.Summary, pageUrl = pending?.PageUrl, lastCheckedAt = lastChecked,
      progress = status == "downloading" ? new { received, total } : null,
      error = errorCode is null ? null : new { code = errorCode, message = errorMessage }
    };
  }
  private void Set(string next) { status = next; publish(Snapshot()); }

  /// <summary>Checks GitHub now. A request while a check or download runs joins it.</summary>
  public Task Check() => Run(async token => { await CheckCore(token); });
  /// <summary>Checks again, then downloads and verifies the installer the feed names now.</summary>
  public Task Download() => Run(async token =>
  {
    await CheckCore(token);
    if (status != "update_available" || pending is null) return;
    await DownloadCore(pending, token);
  });
  private Task Run(Func<CancellationToken, Task> work)
  {
    if (!Capable) return Task.CompletedTask;
    if (running is { IsCompleted: false }) return running;
    return running = Guard(work);
  }
  private async Task Guard(Func<CancellationToken, Task> work)
  {
    errorCode = errorMessage = null;
    try { await work(lifetime.Token); }
    catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
    catch (Exception error)
    {
      (errorCode, errorMessage) = error switch
      {
        HostError host => (host.Code, host.Message),
        TaskCanceledException or OperationCanceledException or TimeoutException => ("timeout", "連線逾時，請稍後再試。"),
        HttpRequestException => ("offline", "無法連線到 GitHub，請確認網路後再試。"),
        IOException or UnauthorizedAccessException => ("install_failed", "無法保存下載的更新，請確認磁碟空間後再試。"),
        _ => ("unknown", "更新沒有完成，請稍後再試。")
      };
      Set("failed");
    }
  }
  private async Task CheckCore(CancellationToken token)
  {
    Set("checking");
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token); timeout.CancelAfter(TimeSpan.FromSeconds(30));
    var releases = testFeed is not null ? await File.ReadAllBytesAsync(Path.Combine(testFeed, "releases.atom"), timeout.Token)
      : await Fetch(new Uri($"https://github.com/{repository}/releases.atom"), MaxFeedBytes, FeedHosts, timeout.Token);
    var release = UpdateFeed.Latest(releases, repository, Platform, channel, current);
    lastChecked = DateTimeOffset.UtcNow.ToString("O"); recordCheck(lastChecked);
    if (release is null) { pending = null; Clean(null); Set("up_to_date"); return; }
    var manifest = testFeed is not null ? await File.ReadAllBytesAsync(Path.Combine(testFeed, UpdateFeed.ManifestName), timeout.Token)
      : await Fetch(Download(UpdateFeed.AssetUrl(release, UpdateFeed.ManifestName)), MaxManifestBytes, DownloadHosts, timeout.Token);
    var package = UpdateFeed.Manifest(manifest, release, Platform, Architecture);
    pending = package; var file = Path.Combine(folder, package.Name);
    // A downloaded installer counts only while the feed still names the same version and bytes.
    downloaded = File.Exists(file) && new FileInfo(file).Length == package.Size && await Digest(file, token) == package.Sha256 ? file : null;
    Clean(downloaded);
    Set(downloaded is null ? "update_available" : "downloaded");
  }
  private static Uri Download(string url) => Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri : throw new HostError("metadata_invalid", "更新資訊的下載位置無效。");
  private async Task DownloadCore(UpdatePackage package, CancellationToken token)
  {
    Directory.CreateDirectory(folder);
    var file = Path.Combine(folder, package.Name); var partial = file + ".partial";
    received = 0; total = package.Size; Set("downloading");
    try
    {
      await using (var output = new FileStream(partial, FileMode.Create, FileAccess.Write, FileShare.None, 81920, FileOptions.Asynchronous))
      {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        if (testFeed is not null)
        {
          await using var input = File.OpenRead(Path.Combine(testFeed, package.Name));
          await Copy(input, output, hash, package.Size, token);
        }
        else
        {
          using var response = await Send(Download(package.Url), DownloadHosts, "application/octet-stream", token);
          if (response.Content.Headers.ContentLength is { } length && length != package.Size) throw new HostError("checksum_mismatch", "下載的檔案大小不符，已刪除。");
          await using var input = await response.Content.ReadAsStreamAsync(token);
          await Copy(input, output, hash, package.Size, token);
        }
        if (received != package.Size || Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant() != package.Sha256)
          throw new HostError("checksum_mismatch", "下載的檔案與更新資訊不符，已刪除。");
        await output.FlushAsync(token);
      }
      CheckPackage(partial);
      File.Move(partial, file, true); downloaded = file; Set("downloaded");
    }
    finally { if (File.Exists(partial)) File.Delete(partial); }
  }
  private async Task Copy(Stream input, Stream output, IncrementalHash hash, long size, CancellationToken token)
  {
    var buffer = new byte[81920];
    while (true)
    {
      using var idle = CancellationTokenSource.CreateLinkedTokenSource(token); idle.CancelAfter(TimeSpan.FromSeconds(60));
      var read = await input.ReadAsync(buffer, idle.Token);
      if (read == 0) return;
      received += read;
      if (received > size) throw new HostError("checksum_mismatch", "下載的檔案大小不符，已刪除。");
      hash.AppendData(buffer, 0, read); await output.WriteAsync(buffer.AsMemory(0, read), token);
      if (DateTime.UtcNow - lastProgress > TimeSpan.FromMilliseconds(250)) { lastProgress = DateTime.UtcNow; publish(Snapshot()); }
    }
  }
  /// <summary>The MSIX must be this app, a higher version and x64; Windows checks the signature when installing.</summary>
  private void CheckPackage(string file)
  {
    try
    {
      using var archive = ZipFile.OpenRead(file);
      var entry = archive.GetEntry("AppxManifest.xml") ?? throw new HostError("identity_mismatch", "下載的安裝檔缺少套件身分，未安裝。");
      if (entry.Length > 1024 * 1024) throw new HostError("identity_mismatch", "下載的安裝檔套件身分無效，未安裝。");
      using var stream = entry.Open();
      UpdateFeed.CheckIdentity(stream, identity!.Value.Name, identity.Value.Publisher, Architecture, identity.Value.Version);
    }
    catch (InvalidDataException) { throw new HostError("identity_mismatch", "下載的檔案不是有效的安裝檔，未安裝。"); }
  }
  /// <summary>The verified installer, checked again right before installing.</summary>
  public async Task<string> Ready()
  {
    if (status != "downloaded" || downloaded is null || pending is null) throw new HostError("update-not-ready", "還沒有下載好的更新。");
    if (!File.Exists(downloaded) || await Digest(downloaded, lifetime.Token) != pending.Sha256)
    { downloaded = null; Set("update_available"); throw new HostError("checksum_mismatch", "下載的更新已變更，請重新下載。"); }
    CheckPackage(downloaded);
    return downloaded;
  }
  public void Installing() => Set("installing");
  public void InstallFailed(string message) { errorCode = "install_failed"; errorMessage = message; Set(downloaded is null ? "failed" : "downloaded"); }

  private async Task<byte[]> Fetch(Uri uri, long limit, string[] hosts, CancellationToken token)
  {
    using var response = await Send(uri, hosts, hosts == FeedHosts ? "application/atom+xml" : "application/octet-stream", token);
    if (response.Content.Headers.ContentLength > limit) throw new HostError("metadata_invalid", "更新資訊超過容量上限。");
    await using var stream = await response.Content.ReadAsStreamAsync(token);
    using var buffer = new MemoryStream(); var chunk = new byte[16384];
    while (true)
    {
      var read = await stream.ReadAsync(chunk, token); if (read == 0) break;
      if (buffer.Length + read > limit) throw new HostError("metadata_invalid", "更新資訊超過容量上限。");
      buffer.Write(chunk, 0, read);
    }
    return buffer.ToArray();
  }
  /// <summary>HTTPS GET to an allowlisted host, following at most three redirects to the GitHub release asset hosts.</summary>
  private async Task<HttpResponseMessage> Send(Uri uri, string[] hosts, string accept, CancellationToken token)
  {
    for (var hop = 0; hop <= 3; hop++)
    {
      if (uri.Scheme != Uri.UriSchemeHttps || !uri.IsDefaultPort || uri.UserInfo.Length > 0 || !hosts.Contains(uri.IdnHost, StringComparer.OrdinalIgnoreCase))
        throw new HostError("provider_rejected", "更新來源指向未允許的位置，已停止。");
      using var request = new HttpRequestMessage(HttpMethod.Get, uri);
      request.Headers.UserAgent.ParseAdd($"WorkFleet/{currentText}"); request.Headers.Accept.ParseAdd(accept);
      var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
      if ((int)response.StatusCode is 301 or 302 or 303 or 307 or 308 && response.Headers.Location is { } location)
      {
        response.Dispose();
        if (hosts == FeedHosts) throw new HostError("provider_rejected", "更新來源轉址，已停止。");
        uri = location.IsAbsoluteUri ? location : new Uri(uri, location);
        hosts = DownloadHosts; continue;
      }
      if (response.IsSuccessStatusCode) return response;
      var code = response.StatusCode;
      var limited = code == HttpStatusCode.TooManyRequests || code == HttpStatusCode.Forbidden && response.Headers.RetryAfter is not null;
      response.Dispose();
      throw limited
        ? new HostError("rate_limited", "GitHub 暫時限制查詢次數，請稍後再試。")
        : new HostError("provider_rejected", $"GitHub 回應錯誤（{(int)code}），請稍後再試。");
    }
    throw new HostError("provider_rejected", "更新來源轉址次數過多，已停止。");
  }
  private static async Task<string> Digest(string file, CancellationToken token)
  {
    await using var stream = File.OpenRead(file);
    return Convert.ToHexString(await SHA256.HashDataAsync(stream, token)).ToLowerInvariant();
  }
  /// <summary>Keeps only the installer still in use; partial and superseded downloads are removed.</summary>
  private void Clean(string? keep)
  {
    if (!Directory.Exists(folder)) return;
    foreach (var file in Directory.EnumerateFiles(folder))
      if (!string.Equals(file, keep, StringComparison.OrdinalIgnoreCase)) try { File.Delete(file); } catch (IOException) { } catch (UnauthorizedAccessException) { }
  }
  public void Dispose() { lifetime.Cancel(); http.Dispose(); }
}
