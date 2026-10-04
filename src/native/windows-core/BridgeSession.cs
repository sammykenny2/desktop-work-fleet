using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace WorkFleet.Windows.Core;

/// <summary>Per-document bounded protocol. The UI host authenticates source and navigation before dispatch.</summary>
public sealed class BridgeSession(LocalDatabase database) : IDisposable
{
  public const int ChunkSize = 256 * 1024;
  // Includes a complete manifest of 20,000 UUID attachment tokens plus the fixed envelope.
  public const int MaxMessage = 1024 * 1024;
  private sealed class Transfer(string kind, int size, string digest, byte[]? bytes = null)
  {
    public string Kind = kind;
    public int Size = size;
    public string Digest = digest;
    public MemoryStream Stream = bytes is null ? new MemoryStream() : new MemoryStream(bytes, 0, bytes.Length, writable: false, publiclyVisible: true);
    public DateTime Used = DateTime.UtcNow;
  }
  private readonly Dictionary<string, Transfer> transfers = new(StringComparer.Ordinal);
  private readonly HashSet<string> staged = new(StringComparer.Ordinal);
  private readonly object gate = new();
  private bool disposed;
  public bool CloseReady { get; private set; }
  public bool Ready { get; private set; }
  private static object Info(LocalDatabase database) => new { protocol = 1, platform = "windows", profileId = database.ProfileId,
    storage = "sqlite-dpapi", maxChunkBytes = ChunkSize, maxMessageBytes = MaxMessage,
    maxRecordBytes = LocalDatabase.MaxRecord, maxAttachmentBytes = LocalDatabase.MaxAttachment,
    capabilities = new { nativeStorage = true, automaticFiles = false, secureBackup = false, google = false, desktopPresentation = false } };

  public string Dispatch(string message)
  {
    lock (gate)
    {
      string? id = null;
      try
      {
        ObjectDisposedException.ThrowIf(disposed, this); Sweep();
        HostError.Require(Encoding.UTF8.GetByteCount(message) <= MaxMessage, "message-size", "原生訊息超過容量上限。");
        using var document = JsonRules.Parse(Encoding.UTF8.GetBytes(message)); var request = document.RootElement;
        HostError.Require(request.ValueKind == JsonValueKind.Object, "invalid-request", "原生請求格式無效。");
        id = JsonRules.Text(request, "id");
        HostError.Require(Guid.TryParseExact(id, "D", out _) && JsonRules.Integer(request, "v") == 1,
          "invalid-request", "原生協定版本或請求身分無效。");
        var method = JsonRules.Text(request, "method");
        HostError.Require(request.TryGetProperty("params", out var args) && args.ValueKind == JsonValueKind.Object,
          "invalid-request", "原生請求參數無效。");
        return JsonSerializer.Serialize(new { v = 1, id, ok = true, result = Invoke(method, args) });
      }
      catch (Exception error)
      {
        var (code, text) = error switch
        {
          HostError specific => (specific.Code, specific.Message),
          CryptographicException => ("vault-unavailable", "Windows 安全儲存無法解密；請使用原 Windows 帳號重試。"),
          ObjectDisposedException => ("native-closed", "原生工作空間已關閉，請重新開啟。"),
          JsonException or FormatException or InvalidOperationException or OverflowException => ("invalid-request", "原生請求格式無效。"),
          _ => ("native-storage", "原生儲存暫時無法完成。請保留草稿後重試；若在提交時中斷，重新開啟可確認保存結果。")
        };
        return JsonSerializer.Serialize(new { v = 1, id, ok = false, error = new { code, message = text } });
      }
    }
  }
  private object? Invoke(string method, JsonElement args)
  {
    switch (method)
    {
      case "host.info": return Info(database);
      case "host.ready": Ready = true; return null;
      case "host.closeReady": CloseReady = true; return null;
      case "transfer.begin":
      {
        var kind = JsonRules.Text(args, "kind"); var size = (int)JsonRules.Integer(args, "size", LocalDatabase.MaxRecord);
        var digest = JsonRules.Text(args, "sha256"); LocalDatabase.CheckDigest(digest);
        HostError.Require(kind is "workspace" or "journal" or "attachment" && (kind != "attachment" || size <= LocalDatabase.MaxAttachment),
          "invalid-transfer", "傳輸種類或容量無效。");
        return new { token = Add(new Transfer(kind, size, digest)) };
      }
      case "transfer.append":
      {
        var transfer = Get(JsonRules.Text(args, "token"));
        HostError.Require(transfer.Kind != "download" && transfer.Stream.Length == JsonRules.Integer(args, "offset", LocalDatabase.MaxRecord),
          "transfer-offset", "傳輸順序不符，尚未保存。");
        var chunk = Convert.FromBase64String(JsonRules.Text(args, "base64", ChunkSize * 4 / 3 + 4));
        try
        {
          HostError.Require(chunk.Length is > 0 and <= ChunkSize && transfer.Stream.Length + chunk.Length <= transfer.Size,
            "transfer-size", "傳輸資料超過聲明容量。");
          transfer.Stream.Write(chunk); return new { offset = transfer.Stream.Length };
        }
        finally { CryptographicOperations.ZeroMemory(chunk); }
      }
      case "transfer.finish":
      {
        var token = JsonRules.Text(args, "token"); var transfer = Get(token);
        HostError.Require(transfer.Kind != "download" && transfer.Stream.Length == transfer.Size, "transfer-incomplete", "傳輸尚未完整。");
        var bytes = transfer.Stream.ToArray();
        try { var sealedToken = database.Stage(transfer.Kind, bytes, transfer.Digest); staged.Add(sealedToken); Drop(token); return new { token = sealedToken }; }
        finally { CryptographicOperations.ZeroMemory(bytes); }
      }
      case "transfer.discard":
      {
        var token = JsonRules.Text(args, "token"); Drop(token);
        if (staged.Remove(token)) database.Discard(token); return null;
      }
      case "storage.load": return Download(database.ReadRecord(JsonRules.Text(args, "kind")));
      case "storage.attachment": return Download(database.ReadAttachment(JsonRules.Text(args, "id")));
      case "transfer.read":
      {
        var transfer = Get(JsonRules.Text(args, "token")); var offset = (int)JsonRules.Integer(args, "offset", LocalDatabase.MaxRecord);
        HostError.Require(transfer.Kind == "download" && offset <= transfer.Size, "invalid-transfer", "無效的下載位置。");
        var bytes = transfer.Stream.GetBuffer(); var length = Math.Min(ChunkSize, transfer.Size - offset);
        return new { base64 = Convert.ToBase64String(bytes, offset, length), offset, done = offset + length == transfer.Size };
      }
      case "storage.commit":
      {
        var token = Owned(args); var tokens = new List<string>();
        if (args.TryGetProperty("attachments", out var attachments))
        {
          HostError.Require(attachments.ValueKind == JsonValueKind.Array, "invalid-request", "附件清單格式無效。");
          foreach (var item in attachments.EnumerateArray())
          {
            var value = item.GetString(); HostError.Require(value is not null && staged.Contains(value), "transfer-missing", "附件傳輸不屬於此視窗。");
            tokens.Add(value!);
          }
        }
        database.CommitRecord(JsonRules.Text(args, "kind"), token, JsonRules.ExpectedRevision(args), tokens);
        staged.Remove(token); foreach (var value in tokens) staged.Remove(value); return null;
      }
      case "storage.putAttachment":
      {
        var token = Owned(args); var id = database.CommitAttachment(token); staged.Remove(token); return new { id };
      }
      default: throw new HostError("unsupported-method", "原生主機未提供此操作。");
    }
  }
  private string Owned(JsonElement args)
  {
    var token = JsonRules.Text(args, "token"); HostError.Require(staged.Contains(token), "transfer-missing", "傳輸不屬於此視窗。"); return token;
  }
  private object? Download(byte[]? bytes)
  {
    if (bytes is null) return null;
    try
    {
      var digest = LocalDatabase.Digest(bytes);
      var token = Add(new Transfer("download", bytes.Length, digest, bytes)); return new { token, size = bytes.Length, sha256 = digest };
    }
    catch { CryptographicOperations.ZeroMemory(bytes); throw; }
  }
  private string Add(Transfer transfer)
  {
    HostError.Require(transfers.Count < 8 && transfers.Values.Sum(value => (long)value.Size) + transfer.Size <= 256L * 1024 * 1024,
      "transfer-busy", "原生傳輸忙碌，請完成目前操作後重試。");
    var token = Guid.NewGuid().ToString(); transfers.Add(token, transfer); return token;
  }
  private Transfer Get(string token)
  {
    HostError.Require(transfers.TryGetValue(token, out var transfer), "transfer-missing", "原生傳輸已失效，請重試。");
    transfer!.Used = DateTime.UtcNow; return transfer;
  }
  private void Drop(string token)
  {
    if (!transfers.Remove(token, out var transfer)) return;
    if (transfer.Stream.TryGetBuffer(out var buffer)) CryptographicOperations.ZeroMemory(buffer.AsSpan());
    transfer.Stream.Dispose();
  }
  private void Sweep()
  {
    foreach (var key in transfers.Where(pair => DateTime.UtcNow - pair.Value.Used > TimeSpan.FromMinutes(5)).Select(pair => pair.Key).ToArray()) Drop(key);
  }
  public void Dispose()
  {
    lock (gate)
    {
      if (disposed) return;
      foreach (var token in transfers.Keys.ToArray()) Drop(token);
      foreach (var token in staged) database.Discard(token);
      staged.Clear(); disposed = true;
    }
  }
}
