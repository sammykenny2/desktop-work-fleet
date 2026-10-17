using System.Text;
using WorkFleet.Windows.Core;

internal static class BackupFilesProbe
{
  public static int Run(string root)
  {
    root = Path.GetFullPath(Path.Combine(root, "file-probe"));
    if (Directory.Exists(root)) throw new InvalidOperationException("File probe requires a fresh directory.");
    Directory.CreateDirectory(root); var count = 0;
    string Within(string path)
    {
      var value = Path.GetFullPath(path);
      if (!value.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("Probe path escaped isolated directory");
      return value;
    }
    void Test(string name, Action action) { action(); count++; Console.WriteLine($"PASS native backup files: {name}"); }
    void Require(bool condition) { if (!condition) throw new Exception("Native file assertion failed"); }
    void Fails(Action action, string? code = null)
    {
      try { action(); }
      catch (Exception error) { if (code is not null && !(error is HostError host && host.Code == code)) throw; return; }
      throw new Exception("Expected native file operation to fail");
    }
    string Name() => $"work-fleet-auto-{Guid.NewGuid()}.zip";
    // Escaped CJK characters: backup bytes are copied exactly, multi-byte UTF-8 included.
    var bytes = Encoding.UTF8.GetBytes("complete synthetic backup bytes-\u4E2D\u6587");
    var target = Within(Path.Combine(root, "backups")); Directory.CreateDirectory(target);
    BackupDirectoryReference reference;
    BackupFileIdentity original;
    using (var directory = WindowsBackupDirectory.Choose(target))
    {
      reference = directory.Reference; BackupFileIdentity? reserved = null;
      original = directory.Create(Name(), bytes, value => reserved = value);
      Test("create-only returns the identity reserved before write and verified bytes", () =>
      { Require(original == reserved); Require(directory.Read(original)!.SequenceEqual(bytes)); });
      Test("same-name create never overwrites an existing file", () =>
      {
        Fails(() => directory.Create(original.Name, Encoding.UTF8.GetBytes("must not replace"), _ => throw new Exception("must not reserve")));
        Require(directory.Read(original)!.SequenceEqual(bytes));
      });
      Test("write and rename racing the new file's reservation cannot alter it", () =>
      {
        var name = Name(); var path = Within(Path.Combine(target, name));
        var saved = directory.Create(name, bytes, _ =>
        {
          Fails(() => File.WriteAllText(path, "foreign bytes"));
          Fails(() => File.Move(path, Within(path + ".moved")));
        });
        Require(directory.Read(saved)!.SequenceEqual(bytes));
      });
      Test("modified owned file is retained", () =>
      {
        var saved = directory.Create(Name(), bytes, _ => {}); var path = Within(Path.Combine(target, saved.Name));
        File.AppendAllText(path, "changed"); Fails(() => directory.Remove(saved), "backup-file-changed"); Require(File.Exists(path));
      });
      Test("same bytes at a replaced filename are retained by identity", () =>
      {
        var saved = directory.Create(Name(), bytes, _ => {}); var path = Within(Path.Combine(target, saved.Name));
        File.Move(path, Within(path + ".original")); File.WriteAllBytes(path, bytes);
        Fails(() => directory.Remove(saved), "backup-file-changed"); Require(File.ReadAllBytes(path).SequenceEqual(bytes));
        Fails(() => directory.Read(saved), "backup-file-changed");
      });
      Test("hash and disposition use one locked handle, blocking a racing replacement", () =>
      {
        var saved = directory.Create(Name(), bytes, _ => {}); var path = Within(Path.Combine(target, saved.Name));
        directory.Remove(saved, () =>
        {
          Fails(() => File.Move(path, Within(path + ".moved")));
          Fails(() => File.WriteAllText(path, "foreign replacement"));
        });
        Require(!File.Exists(path)); directory.Remove(saved); // Retry of acknowledged-or-lost deletion is idempotent.
      });
      Test("pre-create cancellation writes nothing; cancelled partial file stays recoverable", () =>
      {
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel(); var name = Name();
        Fails(() => directory.Create(name, bytes, _ => {}, cancelled.Token)); Require(!File.Exists(Within(Path.Combine(target, name))));
        using var during = new CancellationTokenSource(); BackupFileIdentity? partial = null;
        Fails(() => directory.Create(Name(), bytes, value => { partial = value; during.Cancel(); }, during.Token));
        Require(partial is not null && directory.Read(partial)!.Length == 0);
        Fails(() => directory.Remove(partial!), "backup-file-changed");
      });
      Test("child path traversal and streams cannot reach filesystem", () =>
      {
        foreach (var name in new[] { "../outside.zip", "work-fleet-auto-test.zip:stream", @"sub\work-fleet-auto-test.zip", @"C:\outside.zip" })
          Fails(() => directory.Create(name, bytes, _ => {}), "backup-name");
      });
      Test("latest backup remains locked throughout old-file deletion", () =>
      {
        var latest = directory.Create(Name(), bytes, _ => {}); var old = directory.Create(Name(), bytes, _ => {});
        directory.WhileVerified(latest, () => directory.Remove(old, () =>
        {
          Fails(() => File.WriteAllText(Within(Path.Combine(target, latest.Name)), "must not change latest"));
          Fails(() => File.Move(Within(Path.Combine(target, latest.Name)), Within(Path.Combine(target, latest.Name + ".moved"))));
        }));
        Require(directory.Read(latest)!.SequenceEqual(bytes)); Require(directory.Read(old) is null);
      });
      Test("failed native identity reservation leaves a detectable new file", () =>
      {
        var name = Name(); Fails(() => directory.Create(name, bytes, _ => throw new IOException("injected reservation failure")));
        Require(directory.Contains(name)); Require(new System.IO.FileInfo(Within(Path.Combine(target, name))).Length == 0);
        Require(directory.Read(original)!.SequenceEqual(bytes));
      });
    }
    Test("reopen resolves the original volume and directory identity", () =>
    { using var reopened = WindowsBackupDirectory.Reopen(reference); Require(reopened.Read(original)!.SequenceEqual(bytes)); });
    Test("replaced directory is rejected without touching replacement", () =>
    {
      Directory.Move(target, Within(target + "-original")); Directory.CreateDirectory(target);
      Fails(() => { using var changed = WindowsBackupDirectory.Reopen(reference); }, "backup-directory-changed");
      Require(Directory.GetFileSystemEntries(target).Length == 0);
    });
    Test("ancestor renaming cannot redirect a held directory capability", () =>
    {
      var parent = Within(Path.Combine(root, "parent")); var child = Within(Path.Combine(parent, "child")); Directory.CreateDirectory(child);
      using var held = WindowsBackupDirectory.Choose(child); var replacement = Within(parent + "-moved");
      var moved = false;
      try { Directory.Move(parent, replacement); moved = true; } catch (IOException) { }
      if (moved) Directory.CreateDirectory(child);
      var saved = held.Create(Name(), bytes, _ => {});
      Require(held.Read(saved)!.SequenceEqual(bytes));
      if (moved)
      {
        Require(File.Exists(Within(Path.Combine(replacement, "child", saved.Name))));
        Require(!File.Exists(Within(Path.Combine(child, saved.Name))));
      }
    });
    return count;
  }
}
