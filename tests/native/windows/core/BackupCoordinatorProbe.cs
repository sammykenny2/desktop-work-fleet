using Microsoft.Data.Sqlite;
using System.Text;
using System.Text.Json;
using WorkFleet.Windows.Core;

internal static class BackupCoordinatorProbe
{
  public static int Run(string root)
  {
    root = Path.GetFullPath(Path.Combine(root, "backup-coordinator")); Directory.CreateDirectory(root);
    var target = Path.Combine(root, "backups"); Directory.CreateDirectory(target); string destinationId; string keyId;
    var bytes = Encoding.UTF8.GetBytes("synthetic file, not a production backup");
    void Require(bool value) { if (!value) throw new Exception("Backup coordinator assertion failed"); }
    void Fails(Action action, string code)
    {
      try { action(); } catch (HostError error) when (error.Code == code) { return; } throw new Exception("Expected " + code);
    }
    void Sql(string sql)
    {
      using var connection = new SqliteConnection($"Data Source={Path.Combine(root, "fleet.sqlite3")};Pooling=False"); connection.Open();
      using var command = connection.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery();
    }
    using (var db = new LocalDatabase(root, "local"))
    using (var files = new NativeBackupFiles(db))
    {
      destinationId = JsonSerializer.SerializeToElement(files.Grant(target)).GetProperty("destinationId").GetString()!;
      var id = Guid.NewGuid().ToString(); var job = new BackupJob(id, Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), destinationId,
        $"work-fleet-auto-{id}.zip", 0, 1800000000000, false, LocalDatabase.Digest(bytes), bytes.Length);
      var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
      var journal = JsonSerializer.SerializeToUtf8Bytes(new { profileId = "local", revision = 0, pending = job, inventory = Array.Empty<object>() }, options);
      db.CommitRecord("journal", db.Stage("journal", journal, LocalDatabase.Digest(journal)), null, []);
      Sql("CREATE TRIGGER fail_file_identity BEFORE INSERT ON capabilities WHEN NEW.kind='backup-file' BEGIN SELECT RAISE(ABORT, 'injected full disk'); END;");
      try { files.Create(job, bytes); throw new Exception("Expected reservation failure"); }
      catch (SqliteException) { }
      finally { Sql("DROP TRIGGER fail_file_identity;"); }
      Require(new FileInfo(Path.Combine(target, job.Name)).Length == 0);
      Fails(() => files.Read(job), "backup-file-unowned");
      Console.WriteLine("PASS native backup coordinator: failed durable identity remains unconfirmed without reading its bytes");
      keyId = db.StoreSecret("backup", BackupEncryption.Password("test-only-abcdefghijkl"));
      Sql("UPDATE vault SET data=zeroblob(48) WHERE purpose='backup';");
      using var bridge = new BridgeSession(db);
      string Call(string method, object args) => bridge.Dispatch(JsonSerializer.Serialize(new { v = 1, id = Guid.NewGuid().ToString(), method, @params = args }));
      using var begin = JsonDocument.Parse(Call("transfer.begin", new { kind = "backup", size = bytes.Length, sha256 = LocalDatabase.Digest(bytes) }));
      var token = begin.RootElement.GetProperty("result").GetProperty("token").GetString()!;
      Call("transfer.append", new { token, offset = 0, base64 = Convert.ToBase64String(bytes) });
      using var finish = JsonDocument.Parse(Call("transfer.finish", new { token })); token = finish.RootElement.GetProperty("result").GetProperty("token").GetString()!;
      using var encrypted = JsonDocument.Parse(Call("backup.encrypt", new { token, keyId }));
      Require(encrypted.RootElement.GetProperty("error").GetProperty("code").GetString() == "backup-vault-unavailable");
      Console.WriteLine("PASS native backup coordinator: damaged DPAPI key reports a pausing vault error, never plaintext");
    }
    using (var other = new LocalDatabase(root, "other"))
    using (var files = new NativeBackupFiles(other))
    {
      Fails(() => files.Authorize(destinationId), "backup-permission"); Fails(() => other.ReadSecret("backup", keyId), "vault-missing");
      Console.WriteLine("PASS native backup coordinator: another profile cannot reopen a directory grant or key");
    }
    return 3;
  }
}
