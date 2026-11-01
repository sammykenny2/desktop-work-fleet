using Microsoft.Data.Sqlite;
using System.Text;
using System.Text.Json;
using WorkFleet.Windows.Core;

static class RecordStoreProbe
{
  public static int Run(string parent)
  {
    var root = Path.Combine(parent, "record-store"); var count = 0;
    void Require(bool condition) { if (!condition) throw new Exception("Record storage assertion failed"); }
    void Fails(Action action, string code)
    {
      try { action(); } catch (HostError error) { Require(error.Code == code); return; }
      throw new Exception($"Expected {code}");
    }
    object Row(string collection, string key, int ordinal, string text = "saved") =>
      new { collection, key, entity = "card:one", ordinal, value = new { text } };
    byte[] Batch(int revision, params object[] puts) => JsonSerializer.SerializeToUtf8Bytes(new
    {
      format = "work-fleet-record-transaction", schemaVersion = 1, profileId = "local", revision,
      commitId = Guid.NewGuid().ToString("D"), puts, deletes = Array.Empty<object>()
    });
    JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);
    void Test(string name, Action action) { action(); count++; Console.WriteLine($"PASS {name}"); }
    using (var db = new LocalDatabase(root, "local"))
    {
      string Stage(byte[] bytes) => db.Stage("workspace", bytes, LocalDatabase.Digest(bytes));
      object Commit(byte[] bytes, long? expected) => db.CommitEntries(Stage(bytes), expected, []);
      var first = Batch(0, Row("history", "r0", 0), Row("current", "one", 0));
      var receipt = Json(Commit(first, null));
      Test("record exact replay consumes new staging without a second write", () =>
      {
        var token = Stage(first);
        Require(Json(db.CommitEntries(token, null, [])).GetProperty("digest").GetString() == receipt.GetProperty("digest").GetString());
        Fails(() => db.CommitEntries(token, null, []), "transfer-missing");
      });
      Test("record collision rolls back current value and receipt", () =>
      {
        Fails(() => Commit(Batch(1, Row("current", "one", 1, "must roll back"), Row("history", "r0", 1, "collision")), 0), "revision-collision");
        Require(JsonDocument.Parse(db.ReadEntry("current", "one")!).RootElement.GetProperty("value").GetProperty("text").GetString() == "saved");
        Require(Json(db.RecordStatus()!).GetProperty("revision").GetInt64() == 0);
      });
      Test("record CAS and pages preserve descending tie order", () =>
      {
        Commit(Batch(1, Row("history", "r1", 1), Row("history", "r2", 1)), 0);
        Fails(() => Commit(Batch(1), 0), "stale-writer");
        var query = new { collection = "history", entity = "card:one", after = (object?)null, limit = 1, expectedRevision = 1 };
        using var a = JsonDocument.Parse(db.ReadEntryPage(Json(query)));
        using var b = JsonDocument.Parse(db.ReadEntryPage(Json(query with { after = a.RootElement.GetProperty("next") })));
        Require(a.RootElement.GetProperty("rows")[0].GetProperty("key").GetString() == "r2");
        Require(b.RootElement.GetProperty("rows")[0].GetProperty("key").GetString() == "r1");
        var oldest = new { collection = "history", entity = "card:one", order = "asc", after = (object?)null, limit = 1, expectedRevision = 1 };
        using var c = JsonDocument.Parse(db.ReadEntryPage(Json(oldest)));
        using var d = JsonDocument.Parse(db.ReadEntryPage(Json(oldest with { after = c.RootElement.GetProperty("next") })));
        Require(c.RootElement.GetProperty("rows")[0].GetProperty("key").GetString() == "r0");
        Require(d.RootElement.GetProperty("rows")[0].GetProperty("key").GetString() == "r1");
        using var keys = JsonDocument.Parse(db.ReadEntryPage(Json(new { collection = "history", keysOnly = true, expectedRevision = 1 })));
        Require(keys.RootElement.GetProperty("rows").EnumerateArray().All(row => !row.TryGetProperty("value", out _) && !row.TryGetProperty("entity", out _)));
      });
      Test("record receipt failure rolls back both rows and attachment bytes", () =>
      {
        using var connection = new SqliteConnection($"Data Source={Path.Combine(root, "fleet.sqlite3")};Pooling=False"); connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "CREATE TRIGGER reject_receipt BEFORE UPDATE ON record_heads BEGIN SELECT RAISE(ABORT, 'injected disk failure'); END;"; command.ExecuteNonQuery();
        var bytes = Encoding.UTF8.GetBytes("record-rollback-attachment"); var digest = LocalDatabase.Digest(bytes);
        var attachment = db.Stage("attachment", bytes, digest); var transaction = Stage(Batch(2, Row("draft", "one", 2)));
        var failed = false;
        try { db.CommitEntries(transaction, 1, [attachment]); } catch (SqliteException) { failed = true; }
        finally { command.CommandText = "DROP TRIGGER reject_receipt;"; command.ExecuteNonQuery(); }
        Require(failed && db.ReadEntry("draft", "one") is null && db.ReadAttachment(digest) is null);
        Require(Json(db.RecordStatus()!).GetProperty("revision").GetInt64() == 1);
        db.CommitEntries(transaction, 1, [attachment]);
        Require(db.ReadAttachment(digest)!.SequenceEqual(bytes));
      });
      Test("attachment deletion replays without applying extra staged bytes", () =>
      {
        var bytes = Encoding.UTF8.GetBytes("record-rollback-attachment"); var digest = LocalDatabase.Digest(bytes);
        using var parsed = JsonDocument.Parse(Batch(3));
        var fields = parsed.RootElement.EnumerateObject().ToDictionary(field => field.Name, field => (object)field.Value.Clone());
        fields["attachmentDeletes"] = new[] { digest }; var deletion = JsonSerializer.SerializeToUtf8Bytes(fields);
        Commit(deletion, 2); Require(db.ReadAttachment(digest) is null);
        db.CommitEntries(Stage(deletion), 2, [db.Stage("attachment", bytes, digest)]);
        Require(db.ReadAttachment(digest) is null);
      });
    }
    Test("record reopen and reset retain account isolation", () =>
    {
      using (var other = new LocalDatabase(root, "google:other"))
        Require(other.RecordStatus() is null && other.ReadEntry("history", "r0") is null);
      using var db = new LocalDatabase(root, "local");
      Require(Json(db.RecordStatus()!).GetProperty("revision").GetInt64() == 3 && db.ReadEntry("draft", "one") is not null);
      db.Reset(); Require(db.RecordStatus() is null && db.ReadEntry("history", "r0") is null);
    });
    Test("record format detection preserves legacy bytes and refuses conversion", () =>
    {
      using var db = new LocalDatabase(root, "local");
      var bytes = JsonSerializer.SerializeToUtf8Bytes(new { profileId = "local", revision = 0, text = "old data retained" });
      db.CommitRecord("workspace", db.Stage("workspace", bytes, LocalDatabase.Digest(bytes)), null, []);
      Require(Json(db.RecordStatus()!).GetProperty("format").GetString() == "legacy-workspace");
      var transaction = Batch(0);
      Fails(() => db.CommitEntries(db.Stage("workspace", transaction, LocalDatabase.Digest(transaction)), null, []), "incompatible-local-data");
      Require(db.ReadRecord("workspace")!.SequenceEqual(bytes));
    });
    return count;
  }
}
