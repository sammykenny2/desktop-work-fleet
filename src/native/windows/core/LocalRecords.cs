using Microsoft.Data.Sqlite;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;

namespace WorkFleet.Windows.Core;

public sealed partial class LocalDatabase
{
  private const string RecordFormat = "work-fleet-local-records";
  private const int RecordBatchBytes = 8 * 1024 * 1024;
  private static readonly HashSet<string> RecordCollections = new(StringComparer.Ordinal)
    { "meta", "current", "history", "draft", "outbox", "control", "job" };
  private static void RecordRequire(bool condition) => HostError.Require(condition, "invalid-record-transaction",
    "The local record transaction is invalid. Saved data is unchanged.");
  private static bool RecordKey(string key) => Regex.IsMatch(key, @"\A[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}\z")
    && key is not "__proto__" and not "prototype" and not "constructor";
  private static void ExactKeys(JsonElement value, params string[] keys) => RecordRequire(value.ValueKind == JsonValueKind.Object
    && value.EnumerateObject().Select(item => item.Name).ToHashSet(StringComparer.Ordinal).SetEquals(keys));
  private void InitializeRecordStore(SqliteTransaction tx)
  {
    Execute("CREATE TABLE IF NOT EXISTS record_heads(profile TEXT PRIMARY KEY,revision INTEGER NOT NULL,commit_id TEXT NOT NULL,digest TEXT NOT NULL);", tx);
    Execute("CREATE TABLE IF NOT EXISTS record_entries(profile TEXT NOT NULL,collection TEXT NOT NULL,id TEXT NOT NULL,entity TEXT NOT NULL,ordinal INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(profile,collection,id));", tx);
    Execute("CREATE INDEX IF NOT EXISTS record_order ON record_entries(profile,collection,ordinal DESC,id DESC); CREATE INDEX IF NOT EXISTS record_entity ON record_entries(profile,collection,entity,ordinal DESC,id DESC);", tx);
  }
  private (long Revision, string CommitId, string Digest)? RecordHead(SqliteTransaction? tx = null)
  {
    using var command = Command("SELECT revision,commit_id,digest FROM record_heads WHERE profile=$p;", tx, ("$p", ProfileId));
    using var reader = command.ExecuteReader();
    return reader.Read() ? (reader.GetInt64(0), reader.GetString(1), reader.GetString(2)) : null;
  }
  private object RecordReceipt((long Revision, string CommitId, string Digest) head) => new
    { format = RecordFormat, schemaVersion = 1, profileId = ProfileId, revision = head.Revision, commitId = head.CommitId, digest = head.Digest };
  private bool LegacyRecords(SqliteTransaction? tx = null) => Scalar("SELECT 1 FROM records WHERE profile=$p AND kind='workspace';", tx, ("$p", ProfileId)) is not null;
  public object? RecordStatus()
  {
    lock (gate)
    {
      var head = RecordHead();
      return head is not null ? RecordReceipt(head.Value) : LegacyRecords() ? new { format = "legacy-workspace", profileId = ProfileId } : null;
    }
  }
  public byte[]? ReadEntry(string collection, string id)
  {
    RecordRequire(RecordCollections.Contains(collection) && RecordKey(id));
    lock (gate) return ReadEntry(collection, id, null);
  }
  private byte[]? ReadEntry(string collection, string id, SqliteTransaction? tx)
  {
    var stored = Scalar("SELECT data FROM record_entries WHERE profile=$p AND collection=$c AND id=$id;", tx,
      ("$p", ProfileId), ("$c", collection), ("$id", id)) as byte[];
    if (stored is null) return null;
    var bytes = UserProtection.Unprotect(stored, Scope("entry:" + collection, id));
    using var parsed = JsonRules.Parse(bytes); var row = parsed.RootElement;
    RecordRequire(JsonRules.Text(row, "collection") == collection && JsonRules.Text(row, "key") == id);
    return bytes;
  }
  public byte[] ReadEntryPage(JsonElement query)
  {
    RecordRequire(query.EnumerateObject().All(field => new[] { "collection", "entity", "after", "limit", "expectedRevision", "order", "keysOnly" }.Contains(field.Name)));
    var keysOnly = query.TryGetProperty("keysOnly", out var flag) && flag.GetBoolean();
    var order = query.TryGetProperty("order", out _) ? JsonRules.Text(query, "order") : "desc"; RecordRequire(order is "asc" or "desc");
    var collection = JsonRules.Text(query, "collection"); RecordRequire(RecordCollections.Contains(collection));
    var entity = query.TryGetProperty("entity", out var e) && e.ValueKind != JsonValueKind.Null ? e.GetString() : null;
    RecordRequire(entity is null || entity == "" || RecordKey(entity));
    var limit = query.TryGetProperty("limit", out _) ? (int)JsonRules.Integer(query, "limit", 100) : 100; RecordRequire(limit > 0);
    var expected = JsonRules.ExpectedRevision(query);
    var parameters = new List<(string, object?)> { ("$p", ProfileId), ("$c", collection), ("$limit", limit + 1) };
    var where = "profile=$p AND collection=$c";
    if (entity is not null) { where += " AND entity=$e"; parameters.Add(("$e", entity)); }
    if (query.TryGetProperty("after", out var after) && after.ValueKind != JsonValueKind.Null)
    {
      ExactKeys(after, "ordinal", "key"); var key = JsonRules.Text(after, "key"); RecordRequire(RecordKey(key));
      where += " AND (ordinal,id)" + (order == "asc" ? ">" : "<") + "($o,$id)";
      parameters.Add(("$o", JsonRules.Integer(after, "ordinal"))); parameters.Add(("$id", key));
    }
    lock (gate)
    {
      var head = RecordHead();
      HostError.Require(head is not null || !LegacyRecords(), "incompatible-local-data", "This profile uses an older format. Keep it or explicitly reset it before continuing.");
      HostError.Require(head?.Revision == expected, "stale-writer", "Local data changed while reading its records. Reload before continuing.");
      var sorting = order == "asc" ? "ASC" : "DESC";
      using var command = Command("SELECT id,entity,ordinal," + (keysOnly ? "NULL" : "data") + " FROM record_entries WHERE " + where + " ORDER BY ordinal " + sorting + ",id " + sorting + " LIMIT $limit;", null, parameters.ToArray());
      using var reader = command.ExecuteReader(); var rows = new List<JsonElement>(); var size = 512; var more = false;
      while (reader.Read())
      {
        var key = reader.GetString(0); var bytes = keysOnly ? JsonSerializer.SerializeToUtf8Bytes(new { collection, key, ordinal = reader.GetInt64(2) })
          : UserProtection.Unprotect((byte[])reader[3], Scope("entry:" + collection, key));
        try
        {
          using var parsed = JsonRules.Parse(bytes); var row = parsed.RootElement;
          RecordRequire(JsonRules.Text(row, "collection") == collection && JsonRules.Text(row, "key") == key
            && (keysOnly || row.GetProperty("entity").GetString() == reader.GetString(1)) && JsonRules.Integer(row, "ordinal") == reader.GetInt64(2));
          var rowSize = JsonSerializer.SerializeToUtf8Bytes(row, new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }).Length;
          if (rows.Count >= limit || (rows.Count > 0 && size + rowSize > RecordBatchBytes)) { more = true; break; }
          RecordRequire(size + rowSize <= RecordBatchBytes); size += rowSize + 1; rows.Add(row.Clone());
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
      }
      object? next = more && rows.Count > 0 ? new { ordinal = JsonRules.Integer(rows[^1], "ordinal"), key = JsonRules.Text(rows[^1], "key") } : null;
      return JsonSerializer.SerializeToUtf8Bytes(new { revision = expected, rows, next }, new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
    }
  }
  public object CommitEntries(string token, long? expected, IReadOnlyList<string> attachments)
  {
    RecordRequire(expected is null || expected >= 0 && expected <= JsonRules.MaxRevision);
    RecordRequire(attachments.Count <= 512 && attachments.Distinct(StringComparer.Ordinal).Count() == attachments.Count);
    lock (gate)
    {
      using var tx = connection.BeginTransaction(); var (bytes, digest) = Staged(token, "workspace", tx);
      try
      {
        RecordRequire(bytes.Length <= RecordBatchBytes && Digest(bytes) == digest);
        using var parsed = JsonRules.Parse(bytes); var value = parsed.RootElement;
        ExactKeys(value, value.TryGetProperty("attachmentDeletes", out var removedAttachments)
          ? ["format", "schemaVersion", "profileId", "revision", "commitId", "puts", "deletes", "attachmentDeletes"]
          : ["format", "schemaVersion", "profileId", "revision", "commitId", "puts", "deletes"]);
        var attachmentDeletes = removedAttachments.ValueKind == JsonValueKind.Undefined ? Array.Empty<string>() : removedAttachments.EnumerateArray().Select(item => item.GetString()!).ToArray();
        RecordRequire(attachmentDeletes.All(id => id is not null && id.Length == 64 && System.Text.RegularExpressions.Regex.IsMatch(id, "^[0-9a-f]{64}$"))
          && attachmentDeletes.Distinct(StringComparer.Ordinal).Count() == attachmentDeletes.Length);
        RecordRequire(JsonRules.Text(value, "format") == "work-fleet-record-transaction" && JsonRules.Integer(value, "schemaVersion") == 1
          && JsonRules.Text(value, "profileId") == ProfileId);
        var revision = JsonRules.Integer(value, "revision"); var commitId = JsonRules.Text(value, "commitId");
        RecordRequire(Guid.TryParseExact(commitId, "D", out _) && commitId == commitId.ToLowerInvariant());
        var puts = value.GetProperty("puts"); var deletes = value.GetProperty("deletes");
        RecordRequire(puts.ValueKind == JsonValueKind.Array && deletes.ValueKind == JsonValueKind.Array && puts.GetArrayLength() + deletes.GetArrayLength() + attachmentDeletes.Length <= 512);
        var seen = new HashSet<(string, string)>();
        foreach (var row in puts.EnumerateArray().Concat(deletes.EnumerateArray()))
        {
          var c = JsonRules.Text(row, "collection"); var key = JsonRules.Text(row, "key");
          RecordRequire(RecordCollections.Contains(c) && RecordKey(key) && seen.Add((c, key)));
        }
        long attachmentBytes = 0;
        foreach (var staged in attachments)
        {
          var size = Scalar("SELECT size FROM staging WHERE profile=$p AND token=$t AND kind='attachment';", tx, ("$p", ProfileId), ("$t", staged));
          HostError.Require(size is long, "transfer-missing", "The native attachment transfer has expired.");
          RecordRequire((long)size! >= 0 && (long)size! <= MaxAttachment);
          attachmentBytes += (long)size!; RecordRequire(attachmentBytes <= 128 * 1024 * 1024);
        }
        var head = RecordHead(tx);
        if (head is { } replay && replay == (revision, commitId, digest))
        {
          foreach (var staged in attachments.Prepend(token))
            Execute("DELETE FROM staging WHERE profile=$p AND token=$t;", tx, ("$p", ProfileId), ("$t", staged));
          tx.Commit(); return RecordReceipt(replay);
        }
        HostError.Require(head is not null || !LegacyRecords(tx), "incompatible-local-data", "This profile uses an older format. Keep it or explicitly reset it before continuing.");
        HostError.Require(head?.Revision == expected, "stale-writer", "Another writer changed the local records. Keep your changes and reload.");
        RecordRequire(revision == (expected is null ? 0 : expected + 1));
        foreach (var row in puts.EnumerateArray())
        {
          ExactKeys(row, "collection", "key", "entity", "ordinal", "value");
          RecordRequire(Encoding.UTF8.GetByteCount(row.GetRawText()) <= RecordBatchBytes - 1024);
          var c = JsonRules.Text(row, "collection"); var key = JsonRules.Text(row, "key"); var entity = row.GetProperty("entity").GetString();
          RecordRequire(entity is not null && (entity == "" || RecordKey(entity))); var ordinal = JsonRules.Integer(row, "ordinal", revision);
          if (c == "history" && ReadEntry(c, key, tx) is { } old)
          {
            try
            {
              using var previous = JsonRules.Parse(old);
              HostError.Require(previous.RootElement.GetProperty("entity").GetString() == entity
                && JsonElement.DeepEquals(previous.RootElement.GetProperty("value"), row.GetProperty("value")),
                "revision-collision", "A revision ID has different content. Saved data is unchanged.");
            }
            finally { CryptographicOperations.ZeroMemory(old); }
            continue;
          }
          var raw = Encoding.UTF8.GetBytes(row.GetRawText());
          try
          {
            var data = UserProtection.Protect(raw, Scope("entry:" + c, key));
            Execute("INSERT INTO record_entries VALUES($p,$c,$id,$e,$o,$d) ON CONFLICT(profile,collection,id) DO UPDATE SET entity=excluded.entity,ordinal=excluded.ordinal,data=excluded.data;", tx,
              ("$p", ProfileId), ("$c", c), ("$id", key), ("$e", entity), ("$o", ordinal), ("$d", data));
          }
          finally { CryptographicOperations.ZeroMemory(raw); }
        }
        foreach (var row in deletes.EnumerateArray())
        {
          ExactKeys(row, "collection", "key");
          Execute("DELETE FROM record_entries WHERE profile=$p AND collection=$c AND id=$id;", tx,
            ("$p", ProfileId), ("$c", JsonRules.Text(row, "collection")), ("$id", JsonRules.Text(row, "key")));
        }
        foreach (var identity in attachmentDeletes) Execute("DELETE FROM attachments WHERE profile=$p AND id=$id;", tx, ("$p", ProfileId), ("$id", identity));
        foreach (var attachment in attachments) CommitAttachment(attachment, tx);
        Execute("INSERT INTO record_heads VALUES($p,$r,$id,$d) ON CONFLICT(profile) DO UPDATE SET revision=excluded.revision,commit_id=excluded.commit_id,digest=excluded.digest;", tx,
          ("$p", ProfileId), ("$r", revision), ("$id", commitId), ("$d", digest));
        Execute("DELETE FROM staging WHERE profile=$p AND token=$t;", tx, ("$p", ProfileId), ("$t", token));
        tx.Commit(); return RecordReceipt((revision, commitId, digest));
      }
      finally { CryptographicOperations.ZeroMemory(bytes); }
    }
  }
}
