using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace WorkFleet.Windows.Core;

/// <summary>
/// Per-document bounded protocol. The UI host authenticates source and navigation before dispatch. With
/// languagePreference, host.info reports the display language from HostText; the window answers host.language.set.
/// </summary>
public sealed class BridgeSession(LocalDatabase database, NativeBackupFiles? backupFiles = null, Func<string?>? chooseBackupDirectory = null,
  Func<string, JsonElement, object?>? desktop = null, bool googleAvailable = false, HostIdentity? identity = null,
  Func<byte[], string, bool, object?>? attachmentFiles = null, bool languagePreference = false) : IDisposable
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
  private bool resetDone, closeCancelled;
  /// <summary>True once after the document refused a close request, for example because a dialog was open.</summary>
  public bool TakeCloseCancelled() { lock (gate) { var value = closeCancelled; closeCancelled = false; return value; } }
  /// <summary>True once after the profile's data was deleted; the host then reopens the document on the empty profile.</summary>
  public bool TakeResetDone() { lock (gate) { var value = resetDone; resetDone = false; return value; } }
  public bool Ready { get; private set; }
  private object Info() => new { protocol = 1, platform = "windows", profileId = database.ProfileId,
    appVersion = (identity ?? HostIdentity.Default).AppVersion, distribution = (identity ?? HostIdentity.Default).Distribution, storage = "sqlite-dpapi", maxChunkBytes = ChunkSize, maxMessageBytes = MaxMessage,
    maxRecordBytes = LocalDatabase.MaxRecord, maxAttachmentBytes = LocalDatabase.MaxAttachment, maxBackupBytes = WindowsBackupDirectory.MaxBackupBytes,
    capabilities = new { nativeStorage = true, automaticFiles = backupFiles is not null && chooseBackupDirectory is not null,
      backupFiles = backupFiles is not null && chooseBackupDirectory is not null, secureBackup = true, google = googleAvailable, desktopPresentation = desktop is not null,
      hostPreferences = identity?.HostPreferences == true, updates = identity?.Updates == true, attachmentFiles = attachmentFiles is not null, languagePreference },
    language = languagePreference ? HostText.Describe() : null };

  /// <summary>The host runs this on its preview lane. Shell thumbnail handlers never hold the storage bridge gate.</summary>
  public string DispatchPreview(string message)
  {
    string? id = null;
    try
    {
      byte[]? bytes; string name;
      lock (gate)
      {
        ObjectDisposedException.ThrowIf(disposed, this);
        HostError.Require(Encoding.UTF8.GetByteCount(message) <= MaxMessage, "message-size", "The native message is too large.");
        using var document = JsonRules.Parse(Encoding.UTF8.GetBytes(message)); var request = document.RootElement;
        id = JsonRules.Text(request, "id");
        HostError.Require(Guid.TryParseExact(id, "D", out _) && JsonRules.Integer(request, "v") == 1
          && JsonRules.Text(request, "method") == "attachment.preview" && request.GetProperty("params").ValueKind == JsonValueKind.Object && attachmentFiles is not null,
          "invalid-request", "The attachment preview request is invalid.");
        var args = request.GetProperty("params"); name = JsonRules.Text(args, "name", 240); bytes = database.ReadAttachment(JsonRules.Text(args, "id"));
      }
      var result = bytes is null ? (object)new { available = false, png = (string?)null } : attachmentFiles!(bytes, name, false);
      lock (gate) { ObjectDisposedException.ThrowIf(disposed, this); }
      return JsonSerializer.Serialize(new { v = 1, id, ok = true, result });
    }
    catch (Exception error)
    {
      return JsonSerializer.Serialize(new { v = 1, id, ok = false, error = new { code = (error as HostError)?.Code ?? "attachment-preview", message = (error as HostError)?.Message ?? "Couldn't create the attachment thumbnail." } });
    }
  }

  public string Dispatch(string message)
  {
    lock (gate)
    {
      string? id = null; string? method = null;
      try
      {
        ObjectDisposedException.ThrowIf(disposed, this); Sweep();
        HostError.Require(Encoding.UTF8.GetByteCount(message) <= MaxMessage, "message-size", "The native message is too large.");
        using var document = JsonRules.Parse(Encoding.UTF8.GetBytes(message)); var request = document.RootElement;
        HostError.Require(request.ValueKind == JsonValueKind.Object, "invalid-request", "The native request is malformed.");
        id = JsonRules.Text(request, "id");
        HostError.Require(Guid.TryParseExact(id, "D", out _) && JsonRules.Integer(request, "v") == 1,
          "invalid-request", "The native protocol version or request ID is invalid.");
        method = JsonRules.Text(request, "method");
        HostError.Require(request.TryGetProperty("params", out var args) && args.ValueKind == JsonValueKind.Object,
          "invalid-request", "The native request parameters are invalid.");
        return JsonSerializer.Serialize(new { v = 1, id, ok = true, result = Invoke(method, args) });
      }
      catch (Exception error)
      {
        var (code, text) = error switch
        {
          HostError specific => (specific.Code, specific.Message),
          CryptographicException => (method?.StartsWith("backup.", StringComparison.Ordinal) == true ? "backup-vault-unavailable" : "vault-unavailable",
            "Windows secure storage couldn't decrypt this. Try again with the original Windows account."),
          ObjectDisposedException => ("native-closed", "The native workspace is closed. Reopen it."),
          System.ComponentModel.Win32Exception => ("backup-permission", "The backup location can't be accessed, was replaced, or a file is in use. An unfinished new file may be left; existing files were not overwritten. Check the location and try again."),
          JsonException or FormatException or InvalidOperationException or OverflowException => ("invalid-request", "The native request is malformed."),
          _ => ("native-storage", "Native storage couldn't finish. Keep your draft and try again; if this happened while saving, reopen to check what was saved.")
        };
        return JsonSerializer.Serialize(new { v = 1, id, ok = false, error = new { code, message = text } });
      }
    }
  }
  private object? Invoke(string method, JsonElement args)
  {
    if (method.StartsWith("desktop.", StringComparison.Ordinal) && desktop is not null) return desktop(method, args);
    if (method.StartsWith("backup.", StringComparison.Ordinal) && args.TryGetProperty("profileId", out var profile))
      HostError.Require(profile.ValueKind == JsonValueKind.String && profile.GetString() == database.ProfileId, "backup-profile", "The backup account has changed.");
    switch (method)
    {
      case "host.info": return Info();
      case "attachment.preview": case "attachment.open":
      {
        HostError.Require(attachmentFiles is not null, "unsupported-method", "This platform can't open attachments yet.");
        var bytes = database.ReadAttachment(JsonRules.Text(args, "id"));
        if (bytes is null) { HostError.Require(method != "attachment.open", "missing-attachment", "The attachment hasn't been downloaded yet. Finish syncing first."); return new { available = false, png = (string?)null }; }
        return attachmentFiles!(bytes, JsonRules.Text(args, "name", 240), method == "attachment.open");
      }
      case "host.ready": Ready = true; return null;
      case "host.closeReady": CloseReady = true; return null;
      case "host.closeCancel": CloseReady = false; closeCancelled = true; return null;
      case "transfer.begin":
      {
        var kind = JsonRules.Text(args, "kind"); var size = (int)JsonRules.Integer(args, "size", WindowsBackupDirectory.MaxBackupBytes);
        var digest = JsonRules.Text(args, "sha256"); LocalDatabase.CheckDigest(digest);
        HostError.Require(kind is "workspace" or "journal" or "attachment" or "backup"
          && size <= (kind == "backup" ? WindowsBackupDirectory.MaxBackupBytes : kind == "attachment" ? LocalDatabase.MaxAttachment : LocalDatabase.MaxRecord),
          "invalid-transfer", "The transfer kind or size is invalid.");
        return new { token = Add(new Transfer(kind, size, digest)) };
      }
      case "transfer.append":
      {
        var transfer = Get(JsonRules.Text(args, "token"));
        HostError.Require(transfer.Kind != "download" && transfer.Stream.Length == JsonRules.Integer(args, "offset", WindowsBackupDirectory.MaxBackupBytes),
          "transfer-offset", "The transfer arrived out of order and was not saved.");
        var chunk = Convert.FromBase64String(JsonRules.Text(args, "base64", ChunkSize * 4 / 3 + 4));
        try
        {
          HostError.Require(chunk.Length is > 0 and <= ChunkSize && transfer.Stream.Length + chunk.Length <= transfer.Size,
            "transfer-size", "The transfer is larger than declared.");
          transfer.Stream.Write(chunk); return new { offset = transfer.Stream.Length };
        }
        finally { CryptographicOperations.ZeroMemory(chunk); }
      }
      case "transfer.finish":
      {
        var token = JsonRules.Text(args, "token"); var transfer = Get(token);
        HostError.Require(transfer.Kind != "download" && transfer.Stream.Length == transfer.Size, "transfer-incomplete", "The transfer is incomplete.");
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
        HostError.Require(transfer.Kind == "download" && offset <= transfer.Size, "invalid-transfer", "The download position is invalid.");
        var bytes = transfer.Stream.GetBuffer(); var length = Math.Min(ChunkSize, transfer.Size - offset);
        return new { base64 = Convert.ToBase64String(bytes, offset, length), offset, done = offset + length == transfer.Size };
      }
      case "storage.commit":
      {
        var token = Owned(args); var tokens = new List<string>();
        if (args.TryGetProperty("attachments", out var attachments))
        {
          HostError.Require(attachments.ValueKind == JsonValueKind.Array, "invalid-request", "The attachment list is malformed.");
          foreach (var item in attachments.EnumerateArray())
          {
            var value = item.GetString(); HostError.Require(value is not null && staged.Contains(value), "transfer-missing", "The attachment transfer doesn't belong to this window.");
            tokens.Add(value!);
          }
        }
        var replaceAttachments = args.TryGetProperty("replaceAttachments", out var replace) && replace.GetBoolean();
        database.CommitRecord(JsonRules.Text(args, "kind"), token, JsonRules.ExpectedRevision(args), tokens, replaceAttachments);
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
          catch (HostError) { throw new HostError("backup-key-unavailable", "The encryption key is missing or belongs to another account; nothing was saved unencrypted."); }
          return Download(BackupEncryption.Encrypt(bytes, password));
        }
        finally { CryptographicOperations.ZeroMemory(bytes); if (password is not null) CryptographicOperations.ZeroMemory(password); }
      }
      case "backup.choose":
      case "backup.manual.choose":
      {
        HostError.Require(backupFiles is not null && chooseBackupDirectory is not null, "backup-create-unavailable", "This host can't create backup files.");
        HostError.Require(manualDestinations.Count < 32, "backup-busy", "Too many backup locations are open. Reopen the window.");
        var path = chooseBackupDirectory!();
        ObjectDisposedException.ThrowIf(disposed, this);
        HostError.Require(path is not null, "backup-cancelled", "The selection was canceled.");
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
          HostError.Require(manualDestinations.TryGetValue(id, out var destination), "backup-permission", "Choose the manual backup location again.");
          // Consume the picker once, including uncertain outcomes. Retrying requires another explicit selection.
          manualDestinations.Remove(id); return RequireFiles().SaveManual(destination.DestinationId, destination.Name, bytes);
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
      }
      default: throw new HostError("unsupported-method", "The native host doesn't support this operation.");
    }
  }
  private NativeBackupFiles RequireFiles() => backupFiles ?? throw new HostError("backup-create-unavailable", "This host can't create backup files.");
  private string Owned(JsonElement args)
  {
    var token = JsonRules.Text(args, "token"); HostError.Require(staged.Contains(token), "transfer-missing", "The transfer doesn't belong to this window."); return token;
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
      HostError.Require(staged.Contains(token), "transfer-missing", "The upload doesn't belong to this workspace.");
      return database.ReadAttachmentStage(token);
    }
  }
  private string Add(Transfer transfer)
  {
    HostError.Require(transfers.Count < 8 && transfers.Values.Sum(value => (long)value.Size) + transfer.Size <= 256L * 1024 * 1024,
      "transfer-busy", "Native transfers are busy. Finish the current operation and try again.");
    var token = Guid.NewGuid().ToString(); transfers.Add(token, transfer); return token;
  }
  private Transfer Get(string token)
  {
    HostError.Require(transfers.TryGetValue(token, out var transfer), "transfer-missing", "The native transfer expired. Try again.");
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
