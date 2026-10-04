using Microsoft.Data.Sqlite;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using WorkFleet.Windows.Core;

if (args.Length == 2 && args[0] == "--bridge")
{
  using var database = new LocalDatabase(args[1], "local"); using var bridge = new BridgeSession(database);
  string? line; while ((line = Console.ReadLine()) is not null) Console.WriteLine(bridge.Dispatch(line));
  return;
}
if (args.Length != 1) throw new ArgumentException("Usage: WorkFleet.Windows.Core.Tests OUTPUT_DIRECTORY | --bridge OUTPUT_DIRECTORY");
var root = Path.GetFullPath(args[0]); Directory.CreateDirectory(root);
var count = 0;
void Test(string name, Action action) { action(); count++; Console.WriteLine($"PASS {name}"); }
void Require(bool value, string message = "Assertion failed") { if (!value) throw new Exception(message); }
void Fails(Action action, string? code = null)
{
  try { action(); } catch (Exception error) { if (code is not null) Require(error is HostError host && host.Code == code, error.ToString()); return; }
  throw new Exception("Expected rejection");
}
byte[] Record(int revision, string profile = "local", string text = "native-secret-marker-中文") =>
  JsonSerializer.SerializeToUtf8Bytes(new { profileId = profile, revision, text });
void Query(string sql)
{
  using var conn = new SqliteConnection($"Data Source={Path.Combine(root, "fleet.sqlite3")};Pooling=False"); conn.Open();
  using var command = conn.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery();
}
string secretId;
var attachment = Encoding.UTF8.GetBytes("test attachment bytes-中文"); var id = LocalDatabase.Digest(attachment);
string abandoned;
using (var db = new LocalDatabase(root, "local"))
{
  string Stage(string kind, byte[] bytes) => db.Stage(kind, bytes, LocalDatabase.Digest(bytes));
  Test("exclusive owner rejects a second coordinator", () => Fails(() => { using var second = new LocalDatabase(root, "local"); }, "native-already-open"));
  Test("staged records and attachments remain invisible", () =>
  {
    var state = Stage("workspace", Record(0)); var file = Stage("attachment", attachment);
    Require(db.ReadRecord("workspace") is null && db.ReadAttachment(id) is null);
    db.CommitRecord("workspace", state, null, [file]); Require(db.ReadRecord("workspace")!.SequenceEqual(Record(0)) && db.ReadAttachment(id)!.SequenceEqual(attachment));
  });
  Test("CAS rejects stale state without replacing committed bytes", () =>
  { Fails(() => db.CommitRecord("workspace", Stage("workspace", Record(1)), null, []), "stale-writer"); Require(db.ReadRecord("workspace")!.SequenceEqual(Record(0))); });
  Test("revision continuity rejects gaps", () => Fails(() => db.CommitRecord("workspace", Stage("workspace", Record(2)), 0, []), "invalid-revision"));
  Test("record profile and duplicate JSON keys rejected", () =>
  {
    Fails(() => Stage("workspace", Record(1, "other")), "invalid-profile");
    Fails(() => Stage("workspace", Encoding.UTF8.GetBytes("{\"profileId\":\"local\",\"revision\":0,\"revision\":1}")), "invalid-json");
  });
  Test("attachment digest must match complete bytes", () => Fails(() => db.Stage("attachment", attachment, new string('0', 64)), "transfer-integrity"));
  Test("SQLite abort rolls back record, receipt and all new attachments", () =>
  {
    var fresh = Encoding.UTF8.GetBytes("rollback-attachment"); var freshId = LocalDatabase.Digest(fresh);
    var state = Stage("workspace", Record(1)); var file = Stage("attachment", fresh);
    Query("CREATE TRIGGER reject_record BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT, 'injected full-disk-like failure'); END;");
    try { Fails(() => db.CommitRecord("workspace", state, 0, [file])); }
    finally { Query("DROP TRIGGER reject_record;"); }
    Require(db.ReadRecord("workspace")!.SequenceEqual(Record(0)) && db.ReadAttachment(freshId) is null);
    // The same sealed inputs are retryable after rollback.
    db.CommitRecord("workspace", state, 0, [file]); Require(db.ReadAttachment(freshId)!.SequenceEqual(fresh));
  });
  Test("journal CAS is independent from workspace revision", () =>
  {
    db.CommitRecord("journal", Stage("journal", Record(0)), null, []);
    Fails(() => db.CommitRecord("journal", Stage("journal", Record(1)), null, []), "stale-backup-writer");
    Require(db.ReadRecord("workspace")!.SequenceEqual(Record(1)));
  });
  secretId = db.StoreSecret("backup", Encoding.UTF8.GetBytes("unique-backup-password-marker"));
  Test("vault is bound to profile, purpose and immutable identifier", () =>
  {
    Require(Encoding.UTF8.GetString(db.ReadSecret("backup", secretId)) == "unique-backup-password-marker");
    Fails(() => db.ReadSecret("google", secretId), "vault-missing");
    Require(db.StoreSecret("backup", attachment) != secretId);
    var protectedValue = UserProtection.Protect(attachment, "one");
    Fails(() => UserProtection.Unprotect(protectedValue, "two")); protectedValue[^1] ^= 1;
    Fails(() => UserProtection.Unprotect(protectedValue, "one"));
  });
  Test("protocol rejects unscoped SQL, paths, vault reads and malformed envelopes", () =>
  {
    using var bridge = new BridgeSession(db);
    foreach (var method in new[] { "sql.execute", "file.read", "vault.read", "storage.delete" })
    {
      using var reply = JsonDocument.Parse(bridge.Dispatch(JsonSerializer.Serialize(new { v = 1, id = Guid.NewGuid(), method, @params = new { } })));
      Require(!reply.RootElement.GetProperty("ok").GetBoolean());
    }
    foreach (var message in new[] { "[]", "{}", new string('a', BridgeSession.MaxMessage + 1) })
      Require(!JsonDocument.Parse(bridge.Dispatch(message)).RootElement.GetProperty("ok").GetBoolean());
  });
  Test("complete 20000 attachment token manifest fits bounded IPC", () =>
  {
    using var bridge = new BridgeSession(db);
    var token = Stage("workspace", Record(2));
    var requestId = Guid.NewGuid().ToString();
    var message = JsonSerializer.Serialize(new { v = 1, id = requestId, method = "storage.commit",
      @params = new { kind = "workspace", token, expectedRevision = 1, attachments = Enumerable.Range(0, 20000).Select(_ => Guid.NewGuid().ToString()).ToArray() } });
    Require(Encoding.UTF8.GetByteCount(message) < BridgeSession.MaxMessage);
    using var response = JsonDocument.Parse(bridge.Dispatch(message));
    Require(response.RootElement.GetProperty("id").GetString() == requestId);
    Require(response.RootElement.GetProperty("error").GetProperty("code").GetString() == "transfer-missing");
  });
  abandoned = Stage("attachment", Encoding.UTF8.GetBytes("abandoned staging"));
}
Test("reopen confirms durable commit, attachments and vault", () =>
{
  using var db = new LocalDatabase(root, "local");
  Require(db.ReadRecord("workspace")!.SequenceEqual(Record(1)) && db.ReadAttachment(id)!.SequenceEqual(attachment));
  Require(Encoding.UTF8.GetString(db.ReadSecret("backup", secretId)) == "unique-backup-password-marker");
  Fails(() => db.CommitAttachment(abandoned), "transfer-missing");
});
Test("different profile cannot read records, attachments or vault", () =>
{
  using var other = new LocalDatabase(root, "other"); Require(other.ReadRecord("workspace") is null && other.ReadAttachment(id) is null);
  Fails(() => other.ReadSecret("backup", secretId), "vault-missing");
});
Test("database files do not contain test plaintext", () =>
{
  foreach (var file in Directory.GetFiles(root, "fleet.sqlite3*"))
  {
    var text = Encoding.UTF8.GetString(File.ReadAllBytes(file));
    Require(!text.Contains("native-secret-marker") && !text.Contains("unique-backup-password-marker") && !text.Contains("test attachment bytes"));
  }
});
Test("navigation allows only the packaged main document", () =>
{
  Require(NavigationPolicy.IsDocument(NavigationPolicy.Document) && NavigationPolicy.IsDocument(NavigationPolicy.Document + "#view"));
  foreach (var uri in new[] { "http://work-fleet.invalid/app/index.html", "https://work-fleet.invalid:123/app/index.html", "https://work-fleet.invalid.evil/app/index.html",
    "https://user@work-fleet.invalid/app/index.html", "https://work-fleet.invalid/app/index.html?profile=other", "file:///app/index.html", "javascript:alert(1)" })
    Require(!NavigationPolicy.IsDocument(uri));
});
Console.WriteLine($"{count}/{count} native Windows core checks passed.");
