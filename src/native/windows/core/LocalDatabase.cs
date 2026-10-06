using Microsoft.Data.Sqlite;
using System.Security.Cryptography;
using System.Text;

namespace WorkFleet.Windows.Core;

/// <summary>One native coordinator owns a database. Staging never appears in public reads.</summary>
public sealed class LocalDatabase : IDisposable
{
  public const int MaxRecord = 128 * 1024 * 1024;
  public const int MaxAttachment = 25 * 1024 * 1024;
  private readonly SqliteConnection connection;
  private readonly FileStream owner;
  private readonly object gate = new();
  private bool disposed;
  public string ProfileId { get; }
  public LocalDatabase(string directory, string profileId)
  {
    HostError.Require(profileId.Length is > 0 and <= 256 && !profileId.Contains('\0'), "invalid-profile", "帳號分區無效。");
    ProfileId = profileId; Directory.CreateDirectory(directory);
    try { owner = new FileStream(Path.Combine(directory, "owner.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
    catch (IOException) { throw new HostError("native-already-open", "此資料位置已在另一個 Work Fleet 視窗開啟。請使用原視窗。"); }
    connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(directory, "fleet.sqlite3"),
      Mode = SqliteOpenMode.ReadWriteCreate, Pooling = false }.ToString());
    try
    {
      connection.Open(); Execute("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
      var version = Convert.ToInt64(Scalar("PRAGMA user_version;"));
      HostError.Require(version is 0 or 1 or 2, "storage-version", "資料庫版本較新，請更新 Work Fleet。");
      using var tx = connection.BeginTransaction();
      Execute("CREATE TABLE IF NOT EXISTS records (profile TEXT NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(profile,kind));", tx);
      Execute("CREATE TABLE IF NOT EXISTS attachments (profile TEXT NOT NULL, id TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(profile,id));", tx);
      Execute("CREATE TABLE IF NOT EXISTS staging (profile TEXT NOT NULL, token TEXT PRIMARY KEY, kind TEXT NOT NULL, digest TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL);", tx);
      Execute("CREATE TABLE IF NOT EXISTS vault (profile TEXT NOT NULL, purpose TEXT NOT NULL, id TEXT PRIMARY KEY, data BLOB NOT NULL);", tx);
      Execute("CREATE TABLE IF NOT EXISTS capabilities (profile TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(profile,kind,id));", tx);
      // Exclusive owner proves no live transfer survives a process restart.
      Execute("DELETE FROM staging; PRAGMA user_version=2;", tx); tx.Commit();
    }
    catch { connection.Dispose(); owner.Dispose(); throw; }
  }
  private SqliteCommand Command(string sql, SqliteTransaction? tx = null, params (string, object?)[] parameters)
  {
    ObjectDisposedException.ThrowIf(disposed, this);
    var command = connection.CreateCommand(); command.CommandText = sql; command.Transaction = tx;
    foreach (var (key, value) in parameters) command.Parameters.AddWithValue(key, value ?? DBNull.Value);
    return command;
  }
  private void Execute(string sql, SqliteTransaction? tx = null, params (string, object?)[] parameters)
  { using var command = Command(sql, tx, parameters); command.ExecuteNonQuery(); }
  private object? Scalar(string sql, SqliteTransaction? tx = null, params (string, object?)[] parameters)
  { using var command = Command(sql, tx, parameters); return command.ExecuteScalar(); }
  private string Scope(string kind, string id) => $"{ProfileId.Length}:{ProfileId}|{kind}|{id}";
  public static string Digest(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
  private static void Kind(string kind) => HostError.Require(kind is "workspace" or "journal", "invalid-record", "不支援的本機資料種類。");

  public byte[]? ReadRecord(string kind)
  {
    Kind(kind);
    lock (gate)
    {
      var data = Scalar("SELECT data FROM records WHERE profile=$p AND kind=$k;", null, ("$p", ProfileId), ("$k", kind)) as byte[];
      return data is null ? null : UserProtection.Unprotect(data, Scope(kind, "record"));
    }
  }
  public byte[]? ReadAttachment(string id)
  {
    CheckDigest(id);
    lock (gate)
    {
      var data = Scalar("SELECT data FROM attachments WHERE profile=$p AND id=$id;", null, ("$p", ProfileId), ("$id", id)) as byte[];
      if (data is null) return null;
      var bytes = UserProtection.Unprotect(data, Scope("attachment", id));
      if (Digest(bytes) == id) return bytes;
      CryptographicOperations.ZeroMemory(bytes); throw new HostError("attachment-integrity", "附件校驗失敗。");
    }
  }
  public string Stage(string kind, byte[] bytes, string digest)
  {
    HostError.Require(kind is "workspace" or "journal" or "attachment" or "backup", "invalid-transfer", "不支援的上傳種類。");
    CheckDigest(digest);
    HostError.Require(bytes.Length <= (kind == "attachment" ? MaxAttachment : kind == "backup" ? WindowsBackupDirectory.MaxBackupBytes : MaxRecord) && Digest(bytes) == digest,
      "transfer-integrity", "傳輸容量或 SHA-256 校驗失敗。");
    if (kind is "workspace" or "journal") ValidateRecord(bytes);
    lock (gate)
    {
      var total = Convert.ToInt64(Scalar("SELECT COALESCE(SUM(size),0) FROM staging;"));
      var count = Convert.ToInt64(Scalar("SELECT COUNT(*) FROM staging;"));
      HostError.Require(total + bytes.Length <= 512L * 1024 * 1024 && count < 20008, "transfer-capacity", "暫存資料容量已滿；請完成或取消目前工作。");
      var token = Guid.NewGuid().ToString(); var data = UserProtection.Protect(bytes, Scope("staging", token));
      Execute("INSERT INTO staging VALUES($p,$t,$k,$d,$s,$data);", null, ("$p", ProfileId), ("$t", token), ("$k", kind),
        ("$d", digest), ("$s", bytes.Length), ("$data", data));
      return token;
    }
  }
  private long ValidateRecord(byte[] bytes)
  {
    using var document = JsonRules.Parse(bytes); var root = document.RootElement;
    HostError.Require(root.ValueKind == System.Text.Json.JsonValueKind.Object && JsonRules.Text(root, "profileId") == ProfileId,
      "invalid-profile", "本機資料不屬於目前帳號。");
    return JsonRules.Integer(root, "revision");
  }
  private (byte[] Bytes, string Digest) Staged(string token, string kind, SqliteTransaction tx)
  {
    using var command = Command("SELECT data,digest FROM staging WHERE profile=$p AND token=$t AND kind=$k;", tx,
      ("$p", ProfileId), ("$t", token), ("$k", kind));
    using var reader = command.ExecuteReader();
    HostError.Require(reader.Read(), "transfer-missing", "原生傳輸已失效，請重試。");
    return (UserProtection.Unprotect((byte[])reader[0], Scope("staging", token)), reader.GetString(1));
  }
  public void Discard(string token)
  {
    lock (gate) Execute("DELETE FROM staging WHERE profile=$p AND token=$t;", null, ("$p", ProfileId), ("$t", token));
  }
  public byte[] ReadBackupStage(string token)
    => ReadStage(token, "backup");
  public byte[] ReadAttachmentStage(string token)
    => ReadStage(token, "attachment");
  private byte[] ReadStage(string token, string kind)
  {
    lock (gate)
    {
      using var tx = connection.BeginTransaction(); var (bytes, digest) = Staged(token, kind, tx);
      if (Digest(bytes) == digest) return bytes;
      CryptographicOperations.ZeroMemory(bytes); throw new HostError("transfer-integrity", "備份傳輸校驗失敗。");
    }
  }
  // Only the native backup coordinator calls these methods. No renderer read/write metadata endpoint exists.
  public void SaveCapability(string kind, string id, byte[] bytes)
  {
    HostError.Require(kind is "backup-directory" or "backup-file" && Guid.TryParseExact(id, "D", out _) && bytes.Length <= 65536,
      "backup-capability", "備份原生身分無效。");
    lock (gate)
    {
      var data = UserProtection.Protect(bytes, Scope(kind, id));
      Execute("INSERT INTO capabilities VALUES($p,$k,$id,$data);", null, ("$p", ProfileId), ("$k", kind), ("$id", id), ("$data", data));
    }
  }
  public byte[]? ReadCapability(string kind, string id)
  {
    lock (gate)
    {
      var data = Scalar("SELECT data FROM capabilities WHERE profile=$p AND kind=$k AND id=$id;", null,
        ("$p", ProfileId), ("$k", kind), ("$id", id)) as byte[];
      return data is null ? null : UserProtection.Unprotect(data, Scope(kind, id));
    }
  }
  public void CommitRecord(string kind, string token, long? expectedRevision, IReadOnlyList<string> attachmentTokens)
  {
    Kind(kind);
    HostError.Require(kind == "workspace" || attachmentTokens.Count == 0, "invalid-request", "備份紀錄不可夾帶附件。");
    HostError.Require(attachmentTokens.Count <= 20000 && attachmentTokens.Distinct(StringComparer.Ordinal).Count() == attachmentTokens.Count,
      "invalid-request", "附件傳輸清單無效。");
    lock (gate)
    {
      using var tx = connection.BeginTransaction(); var (bytes, _) = Staged(token, kind, tx);
      try
      {
        var revision = ValidateRecord(bytes);
        var current = Scalar("SELECT revision FROM records WHERE profile=$p AND kind=$k;", tx, ("$p", ProfileId), ("$k", kind));
        HostError.Require((current is null ? null : (long?)Convert.ToInt64(current)) == expectedRevision,
          kind == "workspace" ? "stale-writer" : "stale-backup-writer", "本機資料已變更；保留草稿，重新載入後再保存。");
        HostError.Require(revision == (expectedRevision is null ? 0 : expectedRevision + 1) && revision <= JsonRules.MaxRevision,
          "invalid-revision", "本機保存版本不連續。");
        foreach (var attachment in attachmentTokens) CommitAttachment(attachment, tx);
        var encrypted = UserProtection.Protect(bytes, Scope(kind, "record"));
        Execute("INSERT INTO records VALUES($p,$k,$r,$d) ON CONFLICT(profile,kind) DO UPDATE SET revision=excluded.revision,data=excluded.data;",
          tx, ("$p", ProfileId), ("$k", kind), ("$r", revision), ("$d", encrypted));
        Execute("DELETE FROM staging WHERE profile=$p AND token=$t;", tx, ("$p", ProfileId), ("$t", token));
        tx.Commit();
      }
      finally { CryptographicOperations.ZeroMemory(bytes); }
    }
  }
  public string CommitAttachment(string token)
  {
    lock (gate) { using var tx = connection.BeginTransaction(); var id = CommitAttachment(token, tx); tx.Commit(); return id; }
  }
  private string CommitAttachment(string token, SqliteTransaction tx)
  {
    var (bytes, id) = Staged(token, "attachment", tx);
    try
    {
      HostError.Require(Digest(bytes) == id, "attachment-integrity", "附件校驗失敗，尚未保存。");
      var encrypted = UserProtection.Protect(bytes, Scope("attachment", id));
      Execute("INSERT INTO attachments VALUES($p,$id,$d) ON CONFLICT(profile,id) DO UPDATE SET data=excluded.data;", tx,
        ("$p", ProfileId), ("$id", id), ("$d", encrypted));
      Execute("DELETE FROM staging WHERE profile=$p AND token=$t;", tx, ("$p", ProfileId), ("$t", token)); return id;
    }
    finally { CryptographicOperations.ZeroMemory(bytes); }
  }
  public string StoreSecret(string purpose, byte[] bytes)
  {
    HostError.Require(purpose is "backup" or "google" && bytes.Length is > 0 and <= 65536, "invalid-secret", "安全儲存內容無效。");
    lock (gate)
    {
      var id = Guid.NewGuid().ToString(); var encrypted = UserProtection.Protect(bytes, Scope("vault:" + purpose, id));
      Execute("INSERT INTO vault VALUES($p,$kind,$id,$d);", null, ("$p", ProfileId), ("$kind", purpose), ("$id", id), ("$d", encrypted)); return id;
    }
  }
  // Native callers only. Neither this method nor an arbitrary SQL/path API is exposed to the WebView.
  public byte[] ReadSecret(string purpose, string id)
  {
    lock (gate)
    {
      var data = Scalar("SELECT data FROM vault WHERE profile=$p AND purpose=$kind AND id=$id;", null,
        ("$p", ProfileId), ("$kind", purpose), ("$id", id)) as byte[];
      HostError.Require(data is not null, "vault-missing", "安全儲存項目不存在或不屬於目前帳號。");
      return UserProtection.Unprotect(data!, Scope("vault:" + purpose, id));
    }
  }
  /// <summary>
  /// Deletes everything this profile keeps on the device: workspace and backup journal, attachments, staged
  /// transfers, backup keys and backup folder grants. Google credentials are stored outside the database and stay.
  /// </summary>
  public void Reset()
  {
    lock (gate)
    {
      using (var tx = connection.BeginTransaction())
      {
        foreach (var table in new[] { "records", "attachments", "staging", "vault", "capabilities" })
          Execute($"DELETE FROM {table} WHERE profile=$p;", tx, ("$p", ProfileId));
        tx.Commit();
      }
      // Return the freed pages so the deleted notes do not stay behind in the database file.
      Execute("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
    }
  }
  public static void CheckDigest(string digest) => HostError.Require(digest.Length == 64 && digest.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f'),
    "invalid-digest", "無效的 SHA-256。");
  public void Dispose()
  {
    lock (gate) { if (disposed) return; connection.Dispose(); owner.Dispose(); disposed = true; }
  }
}
