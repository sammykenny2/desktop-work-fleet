using Microsoft.Data.Sqlite;
using System.Globalization;
using System.Security.Cryptography;

namespace WorkFleet.Windows.Core;

/// <summary>
/// SPEC-006 DO: why the local data could not be opened, and setting a damaged database aside. Setting aside moves the
/// database files into a dated folder inside the data folder and never deletes anything; a failed move puts back what it
/// moved. Preferences, window placement, the WebView profile and logs stay where they are.
/// </summary>
public static class DataFailure
{
  public const string Damaged = "data-damaged", Full = "data-full", InUse = "data-in-use", Denied = "data-denied", Key = "data-key",
    Unreadable = "data-unreadable";
  public static readonly string[] DatabaseFiles = ["fleet.sqlite3", "fleet.sqlite3-wal", "fleet.sqlite3-shm", "fleet.sqlite3-journal"];
  public const string SetAsidePrefix = "set-aside-";

  /// <summary>The cause of an exception thrown while opening or reading the local data, or null when it is no data failure.</summary>
  public static string? Classify(Exception error) => error switch
  {
    HostError { Code: Damaged or Full or InUse or Denied or Key or Unreadable } host => host.Code,
    HostError => null,
    // Primary result codes: CORRUPT and NOTADB, FULL, BUSY and LOCKED, then PERM, READONLY, CANTOPEN and AUTH.
    SqliteException sqlite => (sqlite.SqliteErrorCode & 0xff) switch
    {
      11 or 26 => Damaged, 13 => Full, 5 or 6 => InUse, 3 or 8 or 14 or 23 => Denied, _ => Unreadable,
    },
    CryptographicException => Key,
    UnauthorizedAccessException => Denied,
    // Win32 errors in the HRESULT: HANDLE_DISK_FULL and DISK_FULL, SHARING_VIOLATION and LOCK_VIOLATION, ACCESS_DENIED.
    IOException io => (io.HResult & 0xffff) switch { 39 or 112 => Full, 32 or 33 => InUse, 5 => Denied, _ => Unreadable },
    _ => null,
  };

  /// <summary>The English HostError the bridge and the start-up dialog report for a cause; the host text says it in the UI.</summary>
  public static HostError Describe(string cause) => new(cause, cause switch
  {
    Damaged => "The local data is damaged and can't be opened.",
    Full => "The disk is full, so the local data can't be opened. Free some space and start Work Fleet again.",
    InUse => "Another program is using the local data. Close it and start Work Fleet again.",
    Denied => "Work Fleet isn't allowed to open its local data folder.",
    Key => "The local data can't be decrypted under this Windows account.",
    _ => "The local data can't be opened.",
  });

  /// <summary>
  /// Starting with empty data can help only with data shown to be damaged or undecryptable: never with a full disk, held
  /// files or a closed folder, and not with a cause it cannot tell, which could be healthy data from a newer version.
  /// </summary>
  public static bool CanSetAside(string cause) => cause is Damaged or Key;

  /// <summary>
  /// Moves the database files into a new dated folder beside them and returns that folder. Every file is first opened
  /// exclusively, so one another program holds stops the move before anything moved. If a put-back after a failed move
  /// fails too, the error says so (data-set-aside-incomplete) and the caller must not open the data folder again.
  /// </summary>
  public static string SetAside(string directory, DateTimeOffset now)
  {
    var present = DatabaseFiles.Select(name => Path.Combine(directory, name)).Where(File.Exists).ToArray();
    HostError.Require(present.Length > 0, "data-set-aside", "There is no local data to set aside.");
    var folder = Path.Combine(directory, SetAsidePrefix + now.ToLocalTime().ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture));
    HostError.Require(!Directory.Exists(folder) && !File.Exists(folder), "data-set-aside", "The local data was just set aside. Wait a moment and try again.");
    var held = "The local data couldn't be set aside, and nothing was moved. Close other programs that use it and try again.";
    try { foreach (var file in present) using (new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { } }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { throw new HostError("data-set-aside", held); }
    var moved = new List<(string From, string To)>();
    try
    {
      Directory.CreateDirectory(folder);
      foreach (var from in present) { var to = Path.Combine(folder, Path.GetFileName(from)); File.Move(from, to); moved.Add((from, to)); }
      return folder;
    }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException)
    {
      moved.Reverse(); var restored = true;
      foreach (var (from, to) in moved) try { File.Move(to, from); } catch (Exception again) when (again is IOException or UnauthorizedAccessException) { restored = false; }
      try { if (Directory.Exists(folder) && !Directory.EnumerateFileSystemEntries(folder).Any()) Directory.Delete(folder); }
      catch (Exception again) when (again is IOException or UnauthorizedAccessException) { }
      if (!restored) throw new HostError("data-set-aside-incomplete", $"Part of the local data is in {folder}. Nothing was deleted; move those files back before starting Work Fleet again.");
      throw new HostError("data-set-aside", held);
    }
  }
}
