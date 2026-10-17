using Microsoft.Data.Sqlite;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using WorkFleet.Windows.Core;

if (args.Length == 2 && args[0] == "--bridge")
{
  Console.InputEncoding = new UTF8Encoding(false, true); Console.OutputEncoding = new UTF8Encoding(false, true);
  using var database = new LocalDatabase(args[1], "local"); using var files = new NativeBackupFiles(database);
  var backups = Path.Combine(Path.GetFullPath(args[1]), "backups"); Directory.CreateDirectory(backups);
  using var bridge = new BridgeSession(database, files, () => backups);
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
// The escaped CJK markers check UTF-8 round trips and that no test plaintext reaches the database files.
byte[] Record(int revision, string profile = "local", string text = "native-secret-marker-\u4E2D\u6587") =>
  JsonSerializer.SerializeToUtf8Bytes(new { profileId = profile, revision, text });
void Query(string sql)
{
  using var conn = new SqliteConnection($"Data Source={Path.Combine(root, "fleet.sqlite3")};Pooling=False"); conn.Open();
  using var command = conn.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery();
}
string secretId;
var attachment = Encoding.UTF8.GetBytes("test attachment bytes-\u4E2D\u6587"); var id = LocalDatabase.Digest(attachment);
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
  Test("host.info reports the display language only for a window that stores it", () =>
  {
    JsonElement Info(BridgeSession bridge)
    {
      using var reply = JsonDocument.Parse(bridge.Dispatch(JsonSerializer.Serialize(new { v = 1, id = Guid.NewGuid(), method = "host.info", @params = new { } })));
      return reply.RootElement.GetProperty("result").Clone();
    }
    HostText.Apply("zh-TW", ["en-US"]);
    using (var plain = new BridgeSession(db))
    {
      var info = Info(plain);
      Require(!info.GetProperty("capabilities").GetProperty("languagePreference").GetBoolean() && info.GetProperty("language").ValueKind == JsonValueKind.Null);
      // The window answers host.language.set; the storage bridge alone refuses it with an English message.
      using var refused = JsonDocument.Parse(plain.Dispatch(JsonSerializer.Serialize(new { v = 1, id = Guid.NewGuid(), method = "host.language.set", @params = new { preference = "en" } })));
      Require(refused.RootElement.GetProperty("error").GetProperty("code").GetString() == "unsupported-method"
        && refused.RootElement.GetProperty("error").GetProperty("message").GetString() == "The native host doesn't support this operation.");
    }
    using (var window = new BridgeSession(db, languagePreference: true))
    {
      var info = Info(window); var language = info.GetProperty("language");
      Require(info.GetProperty("capabilities").GetProperty("languagePreference").GetBoolean() && language.GetProperty("preference").GetString() == "zh-TW"
        && language.GetProperty("system").EnumerateArray().Select(tag => tag.GetString()).SequenceEqual(["en-US"]));
    }
    HostText.Apply("en");
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
Test("full local restore atomically purges old attachments, preserves other profiles and rolls back failed replacement", () =>
{
  var folder = Path.Combine(root, "local-replace"); Directory.CreateDirectory(folder);
  var fresh = Encoding.UTF8.GetBytes("replacement attachment"); var freshId = LocalDatabase.Digest(fresh);
  using (var other = new LocalDatabase(folder, "other")) other.CommitAttachment(other.Stage("attachment", attachment, id));
  using (var local = new LocalDatabase(folder, "local"))
  {
    string Stage(string kind, byte[] bytes) => local.Stage(kind, bytes, LocalDatabase.Digest(bytes));
    local.CommitRecord("workspace", Stage("workspace", Record(0)), null, [Stage("attachment", attachment)]);
    var next = Stage("workspace", Record(1)); var file = Stage("attachment", fresh);
    using (var conn = new SqliteConnection($"Data Source={Path.Combine(folder, "fleet.sqlite3")};Pooling=False"))
    {
      conn.Open(); using var cmd = conn.CreateCommand();
      cmd.CommandText = "CREATE TRIGGER reject_replace BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT, 'injected disk failure'); END;"; cmd.ExecuteNonQuery();
      Fails(() => local.CommitRecord("workspace", next, 0, [file], replaceAttachments: true));
      Require(local.ReadRecord("workspace")!.SequenceEqual(Record(0)) && local.ReadAttachment(id)!.SequenceEqual(attachment) && local.ReadAttachment(freshId) is null);
      cmd.CommandText = "DROP TRIGGER reject_replace;"; cmd.ExecuteNonQuery();
    }
    Fails(() => local.CommitRecord("workspace", next, null, [file], replaceAttachments: true), "stale-writer");
    Require(local.ReadAttachment(id) is not null);
    local.CommitRecord("workspace", next, 0, [file], replaceAttachments: true);
    Require(local.ReadRecord("workspace")!.SequenceEqual(Record(1)) && local.ReadAttachment(id) is null && local.ReadAttachment(freshId)!.SequenceEqual(fresh));
    local.CommitRecord("workspace", Stage("workspace", Record(2)), 1, [], replaceAttachments: true);
    Require(local.ReadAttachment(freshId) is null);
    Fails(() => local.CommitRecord("journal", Stage("journal", Record(0)), null, [], replaceAttachments: true), "invalid-request");
  }
  using (var other = new LocalDatabase(folder, "other")) Require(other.ReadAttachment(id)!.SequenceEqual(attachment));
  using (var google = new LocalDatabase(folder, "google:fixture"))
    Fails(() => google.CommitRecord("workspace", "unused", null, [], replaceAttachments: true), "invalid-request");
});
Test("navigation allows only the packaged main document", () =>
{
  Require(NavigationPolicy.IsDocument(NavigationPolicy.Document) && NavigationPolicy.IsDocument(NavigationPolicy.Document + "#view"));
  foreach (var uri in new[] { "http://work-fleet.invalid/app/index.html", "https://work-fleet.invalid:123/app/index.html", "https://work-fleet.invalid.evil/app/index.html",
    "https://user@work-fleet.invalid/app/index.html", "https://work-fleet.invalid/app/index.html?profile=other", "file:///app/index.html", "javascript:alert(1)" })
    Require(!NavigationPolicy.IsDocument(uri));
});
Test("attachment bridge resolves only this profile and distinguishes missing bytes", () =>
{
  using var database = new LocalDatabase(Path.Combine(root, "attachment-protocol"), "local");
  var token = database.Stage("attachment", attachment, id); database.CommitAttachment(token);
  var calls = 0;
  using var session = new BridgeSession(database, attachmentFiles: (bytes, name, open) =>
  {
    Require(bytes.SequenceEqual(attachment) && name == "proof.txt"); calls++;
    return open ? (object)new { opened = true } : new { available = true, png = (string?)null };
  });
  JsonElement Request(string method, string key) { using var reply = JsonDocument.Parse(session.Dispatch(JsonSerializer.Serialize(new { v = 1, id = Guid.NewGuid().ToString("D"), method, @params = new { id = key, name = "proof.txt", path = "ignored" } }))); return reply.RootElement.Clone(); }
  Require(Request("attachment.preview", id).GetProperty("result").GetProperty("available").GetBoolean());
  Require(Request("attachment.open", id).GetProperty("result").GetProperty("opened").GetBoolean());
  Require(!Request("attachment.preview", new string('0', 64)).GetProperty("result").GetProperty("available").GetBoolean());
  Require(Request("attachment.open", new string('0', 64)).GetProperty("error").GetProperty("code").GetString() == "missing-attachment");
  Require(calls == 2);
});
Test("slow attachment previews do not hold the storage gate and cannot reply after close", () =>
{
  using var database = new LocalDatabase(Path.Combine(root, "attachment-preview-lane"), "local");
  var token = database.Stage("attachment", attachment, id); database.CommitAttachment(token);
  using var entered = new ManualResetEventSlim(); using var release = new ManualResetEventSlim();
  using var session = new BridgeSession(database, attachmentFiles: (_, _, _) => { entered.Set(); release.Wait(TimeSpan.FromSeconds(5)); return new { available = true, png = (string?)null }; });
  string Message(string method, object args) => JsonSerializer.Serialize(new { v = 1, id = Guid.NewGuid().ToString("D"), method, @params = args });
  var pending = Task.Run(() => session.DispatchPreview(Message("attachment.preview", new { id, name = "proof.txt" })));
  Require(entered.Wait(TimeSpan.FromSeconds(2)));
  using var state = JsonDocument.Parse(session.Dispatch(Message("host.ready", new { })));
  Require(state.RootElement.GetProperty("ok").GetBoolean());
  session.Dispose(); release.Set();
  using var result = JsonDocument.Parse(pending.GetAwaiter().GetResult());
  Require(!result.RootElement.GetProperty("ok").GetBoolean());
});
Console.WriteLine($"{count}/{count} native Windows core checks passed.");
try
{
  var files = BackupFilesProbe.Run(root);
  Console.WriteLine($"{files}/{files} native Windows backup file checks passed.");
  var coordinator = BackupCoordinatorProbe.Run(root);
  Console.WriteLine($"{coordinator}/{coordinator} native Windows backup coordinator checks passed.");
  var scenes = SceneTransfersProbe.Run(); Console.WriteLine($"{scenes}/{scenes} native Windows scene transfer checks passed.");
  var host = HostSettingsProbe.Run(root); Console.WriteLine($"{host}/{host} native Windows host settings checks passed.");
  var feed = UpdateFeedProbe.Run(); Console.WriteLine($"{feed}/{feed} native Windows update feed checks passed.");
  var callback = LoopbackCallbackProbe.Run(); Console.WriteLine($"{callback}/{callback} native Windows sign-in callback checks passed.");
}
catch (Exception error) { Console.Error.WriteLine(error); Environment.ExitCode = 1; }
