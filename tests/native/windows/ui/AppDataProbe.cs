using System.IO;
using System.Text.Json;
using WorkFleet.Windows;

internal static class AppDataProbe
{
  internal static void Run(string output)
  {
    var directory = AppDataDirectory.Resolve();
    var packaged = directory != AppDataDirectory.Unpackaged;
    if (packaged)
    {
      if (!global::Windows.ApplicationModel.Package.Current.Id.Name.StartsWith("app.workfleet.storageprobe.", StringComparison.Ordinal))
        throw new Exception("Packaged writes are allowed only in an isolated storage probe package.");
      var root = global::Windows.Storage.ApplicationData.Current.LocalCacheFolder.Path;
      if (!directory.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        throw new Exception("Packaged data escaped its private package store.");
      Directory.CreateDirectory(directory);
      File.WriteAllText(Path.Combine(directory, "storage-probe.txt"), "isolated package data");
    }
    // The unpackaged check resolves the path only; it must never write to the real ZIP/Debug workspace.
    Directory.CreateDirectory(output);
    File.WriteAllText(Path.Combine(output, "app-data.json"), JsonSerializer.Serialize(new { packaged, directory }));
    Console.WriteLine("PASS Windows app data directory");
  }
}
