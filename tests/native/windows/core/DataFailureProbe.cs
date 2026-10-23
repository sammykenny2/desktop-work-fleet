using Microsoft.Data.Sqlite;
using System.Security.Cryptography;
using WorkFleet.Windows.Core;

/// <summary>
/// SPEC-006 DO on real files: a database that is not SQLite opens as damaged, the classifier names the other causes,
/// and setting aside moves every database file into one dated folder or, when a file is held, puts back what it moved.
/// </summary>
internal static class DataFailureProbe
{
  public static int Run(string root)
  {
    var count = 0;
    void Require(bool value, string message) { if (!value) throw new Exception(message); count++; }
    var directory = Path.Combine(root, "data-failure"); Directory.CreateDirectory(directory);
    File.WriteAllText(Path.Combine(directory, "fleet.sqlite3"), "these bytes are not a SQLite database");
    try { using var damaged = new LocalDatabase(directory, "local"); Require(false, "A file that is not SQLite opened."); }
    catch (HostError error) { Require(error.Code == DataFailure.Damaged, $"A file that is not SQLite reported {error.Code}."); }
    Require(DataFailure.Classify(new SqliteException("full", 13)) == DataFailure.Full, "SQLITE_FULL is a full disk.");
    Require(DataFailure.Classify(new SqliteException("busy", 5)) == DataFailure.InUse, "SQLITE_BUSY is data in use.");
    Require(DataFailure.Classify(new SqliteException("readonly", 8)) == DataFailure.Denied, "SQLITE_READONLY is not permitted.");
    Require(DataFailure.Classify(new IOException("full", unchecked((int)0x80070070))) == DataFailure.Full, "ERROR_DISK_FULL is a full disk.");
    Require(DataFailure.Classify(new CryptographicException()) == DataFailure.Key, "A DPAPI failure is a key failure.");
    Require(DataFailure.Classify(new HostError("storage-version", "newer")) is null, "A newer database keeps its own message.");
    Require(DataFailure.CanSetAside(DataFailure.Damaged) && DataFailure.CanSetAside(DataFailure.Key)
      && new[] { DataFailure.Full, DataFailure.InUse, DataFailure.Denied, DataFailure.Unreadable }.All(cause => !DataFailure.CanSetAside(cause)),
      "Only damaged or undecryptable data can be set aside.");
    Require(DataFailure.Classify(new SqliteException("io", 10)) == DataFailure.Unreadable, "An unlisted SQLite error is unexplained.");

    File.WriteAllText(Path.Combine(directory, "fleet.sqlite3-wal"), "write-ahead log");
    File.WriteAllText(Path.Combine(directory, "profile.txt"), "local");
    var now = new DateTimeOffset(2026, 10, 23, 9, 30, 0, TimeSpan.Zero);
    // A log another program holds stops the move before anything moved.
    using (var held = new FileStream(Path.Combine(directory, "fleet.sqlite3-wal"), FileMode.Open, FileAccess.Read, FileShare.None))
    {
      try { DataFailure.SetAside(directory, now); Require(false, "Setting aside moved a held file."); }
      catch (HostError error) { Require(error.Code == "data-set-aside" && error.Message.Contains("nothing was moved"), $"A held file reported {error.Code}: {error.Message}"); }
    }
    Require(File.Exists(Path.Combine(directory, "fleet.sqlite3")) && !Directory.EnumerateDirectories(directory, DataFailure.SetAsidePrefix + "*").Any(),
      "A failed set-aside left the data where it was and no empty folder.");
    var folder = DataFailure.SetAside(directory, now);
    Require(File.ReadAllText(Path.Combine(folder, "fleet.sqlite3")) == "these bytes are not a SQLite database"
      && File.Exists(Path.Combine(folder, "fleet.sqlite3-wal")) && !File.Exists(Path.Combine(directory, "fleet.sqlite3")),
      "The database and its log moved into the set-aside folder.");
    Require(File.Exists(Path.Combine(directory, "profile.txt")) && Path.GetDirectoryName(folder) == directory, "Other files stay; the folder sits inside.");
    using (var fresh = new LocalDatabase(directory, "local")) Require(fresh.ReadRecord("workspace") is null, "Empty data opens after setting aside.");
    try { DataFailure.SetAside(directory, now); Require(false, "A second set-aside in the same second replaced the first folder."); }
    catch (HostError error) { Require(error.Code == "data-set-aside", "The same folder name is refused."); }
    return count;
  }
}
