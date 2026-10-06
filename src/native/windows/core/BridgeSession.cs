using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace WorkFleet.Windows.Core;

/// <summary>Per-document bounded protocol. The UI host authenticates source and navigation before dispatch.</summary>
public sealed class BridgeSession(LocalDatabase database, NativeBackupFiles? backupFiles = null, Func<string?>? chooseBackupDirectory = null,
  Func<string, JsonElement, object?>? desktop = null, bool googleAvailable = false) : IDisposable
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
  private readonly Dictionary<string, (string DestinationId, string Name)> manualDestinations = new(StringComparer.Ordinal);
  private readonly object gate = new();
  private bool disposed;
  public bool CloseReady { get; private set; }
  private bool resetDone;
  /// <summary>True once after the profile's data was deleted; the host then reopens the document on the empty profile.</summary>
  public bool TakeResetDone() { lock (gate) { var value = resetDone; resetDone = false; return value; } }
  public bool Ready { get; private set; }
  private object Info() => new { protocol = 1, platform = "windows", profileId = database.ProfileId,
    storage = "sqlite-dpapi", maxChunkBytes = ChunkSize, maxMessageBytes = MaxMessage,
    maxRecordBytes = LocalDatabase.MaxRecord, maxAttachmentBytes = LocalDatabase.MaxAttachment, maxBackupBytes = WindowsBackupDirectory.MaxBackupBytes,
    capabilities = new { nativeStorage = true, automaticFiles = backupFiles is not null && chooseBackupDirectory is not null,
      backupFiles = backupFiles is not null && chooseBackupDirectory is not null, secureBackup = true, google = googleAvailable, desktopPresentation = desktop is not null } };

  public string Dispatch(string message)
  {
    lock (gate)
    {
      string? id = null; string? method = null;
      try
      {
        ObjectDisposedException.ThrowIf(disposed, this); Sweep();
        HostError.Require(Encoding.UTF8.GetByteCount(message) <= MaxMessage, "message-size", "原生訊息超過容量上限。");
        using var document = JsonRules.Parse(Encoding.UTF8.GetBytes(message)); var request = document.RootElement;
        HostError.Require(request.ValueKind == JsonValueKind.Object, "invalid-request", "原生請求格式無效。");
        id = JsonRules.Text(request, "id");
        HostError.Require(Guid.TryParseExact(id, "D", out _) && JsonRules.Integer(request, "v") == 1,
          "invalid-request", "原生協定版本或請求身分無效。");
        method = JsonRules.Text(request, "method");
        HostError.Require(request.TryGetProperty("params", out var args) && args.ValueKind == JsonValueKind.Object,
          "invalid-request", "原生請求參數無效。");
        return JsonSerializer.Serialize(new { v = 1, id, ok = true, result = Invoke(method, args) });
      }
      catch (Exception error)
      {
        var (code, text) = error switch
        {
          HostError specific => (specific.Code, specific.Message),
          CryptographicException => (method?.StartsWith("backup.", StringComparison.Ordinal) == true ? "backup-vault-unavailable" : "vault-unavailable",
            "Windows 安全儲存無法解密；請使用原 Windows 帳號重試。"),
          ObjectDisposedException => ("native-closed", "原生工作空間已關閉，請重新開啟。"),
          System.ComponentModel.Win32Exception => ("backup-permission", "備份位置無法存取、已被替換或檔案正被使用。可能留下未完成的新檔；現有檔案未覆寫，請檢查位置後重試。"),
          JsonException or FormatException or InvalidOperationException or OverflowException => ("invalid-request", "原生請求格式無效。"),
          _ => ("native-storage", "原生儲存暫時無法完成。請保留草稿後重試；若在提交時中斷，重新開啟可確認保存結果。")
        };
        return JsonSerializer.Serialize(new { v = 1, id, ok = false, error = new { code, message = text } });
      }
    }
  }
  private object? Invoke(string method, JsonElement args)
  {
    if (method.StartsWith("desktop.", StringComparison.Ordinal) && desktop is not null) return desktop(method, args);
    if (method.StartsWith("backup.", StringComparison.Ordinal) && args.TryGetProperty("profileId", out var profile))
      HostError.Require(profile.ValueKind == JsonValueKind.String && profile.GetString() == database.ProfileId, "backup-profile", "備份帳號已切換。");
    switch (method)
    {
      case "host.info": return Info();
      case "host.ready": Ready = true; return null;
      case "host.closeReady": CloseReady = true; return null;
      case "host.closeCancel": CloseReady = false; return null;
      case "transfer.begin":
      {
        var kind = JsonRules.Text(args, "kind"); var size = (int)JsonRules.Integer(args, "size", WindowsBackupDirectory.MaxBackupBytes);
        var digest = JsonRules.Text(args, "sha256"); LocalDatabase.CheckDigest(digest);
        HostError.Require(kind is "workspace" or "journal" or "attachment" or "backup"
          && size <= (kind == "backup" ? WindowsBackupDirectory.MaxBackupBytes : kind == "attachment" ? LocalDatabase.MaxAttachment : LocalDatabase.MaxRecord),
          "invalid-transfer", "傳輸種類或容量無效。");
        return new { token = Add(new Transfer(kind, size, digest)) };
      }
      case "transfer.append":
      {
        var transfer = Get(JsonRules.Text(args, "token"));
        HostError.Require(transfer.Kind != "download" && transfer.Stream.Length == JsonRules.Integer(args, "offset", WindowsBackupDirectory.MaxBackupBytes),
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
      case "storage.reset":
      {
        foreach (var token in transfers.Keys.ToArray()) Drop(token);
        staged.Clear(); database.Reset(); resetDone = true; return new { profileId = database.ProfileId };
      }
      case "storage.load": return Download(database.ReadRecord(JsonRules.Text(args, "kind")));
      case "storage.attachment": return Download(database.ReadAttachment(JsonRules.Text(args, "id")));
      case "transfer.read":
      {
        var transfer = Get(JsonRules.Text(args, "token")); var offset = (int)JsonRules.Integer(args, "offset", WindowsBackupDirectory.MaxBackupBytes);
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
      case "backup.key.create":
      {
        var bytes = BackupEncryption.Password(JsonRules.Text(args, "password", 1024));
        try { return new { keyId = database.StoreSecret("backup", bytes) }; }
        finally { CryptographicOperations.ZeroMemory(bytes); }
      }
      case "backup.encrypt":
      {
        var bytes = database.ReadBackupStage(Owned(args)); byte[]? password = null;
        try
        {
          try { password = database.ReadSecret("backup", JsonRules.Text(args, "keyId")); }
          catch (HostError) { throw new HostError("backup-key-unavailable", "加密金鑰不存在或不屬於目前帳號，未改存明文。"); }
          return Download(BackupEncryption.Encrypt(bytes, password));
        }
        finally { CryptographicOperations.ZeroMemory(bytes); if (password is not null) CryptographicOperations.ZeroMemory(password); }
      }
      case "backup.choose":
      case "backup.manual.choose":
      {
        HostError.Require(backupFiles is not null && chooseBackupDirectory is not null, "backup-create-unavailable", "此主機尚無備份檔案能力。");
        HostError.Require(manualDestinations.Count < 32, "backup-busy", "備份位置過多，請重新開啟視窗。");
        var path = chooseBackupDirectory!();
        ObjectDisposedException.ThrowIf(disposed, this);
        HostError.Require(path is not null, "backup-cancelled", "已取消選擇。");
        var grant = backupFiles!.Grant(path!);
        if (method == "backup.choose") return grant;
        var destination = JsonSerializer.SerializeToElement(grant).GetProperty("destinationId").GetString()!;
        var id = Guid.NewGuid().ToString(); var name = $"work-fleet-backup-{Guid.NewGuid()}.zip";
        manualDestinations.Add(id, (destination, name)); return new { destinationId = id, name };
      }
      case "backup.authorize": RequireFiles().Authorize(JsonRules.Text(args, "destinationId")); return null;
      case "backup.read": return Download(RequireFiles().Read(BackupJob.Parse(args)));
      case "backup.remove": return RequireFiles().Remove(BackupJob.Parse(args));
      case "backup.create":
      case "backup.manual.save":
      {
        var bytes = database.ReadBackupStage(Owned(args));
        try
        {
          if (method == "backup.create") return RequireFiles().Create(BackupJob.Parse(args), bytes);
          var id = JsonRules.Text(args, "destinationId");
          HostError.Require(manualDestinations.TryGetValue(id, out var destination), "backup-permission", "請重新選擇手動備份位置。");
          // Consume the picker once, including uncertain outcomes. Retrying requires another explicit selection.
          manualDestinations.Remove(id); return RequireFiles().SaveManual(destination.DestinationId, destination.Name, bytes);
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
      }
      default: throw new HostError("unsupported-method", "原生主機未提供此操作。");
    }
  }
  private NativeBackupFiles RequireFiles() => backupFiles ?? throw new HostError("backup-create-unavailable", "此主機尚無備份檔案能力。");
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
  public object? DownloadBytes(byte[] bytes) { lock (gate) { ObjectDisposedException.ThrowIf(disposed, this); return Download(bytes); } }
  public byte[] UploadBytes(string token)
  {
    lock (gate)
    {
      ObjectDisposedException.ThrowIf(disposed, this);
      HostError.Require(staged.Contains(token), "transfer-missing", "上傳不屬於此工作空間。");
      return database.ReadAttachmentStage(token);
    }
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
