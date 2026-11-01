using System.Reflection;
using System.Text.Json;
using WorkFleet.Windows.Core;

static class DatasetProbe
{
  public static int Run()
  {
    using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("DatasetWire.json") ?? throw new Exception("Missing dataset wire fixture");
    using var fixture = JsonDocument.Parse(stream); var root = fixture.RootElement; var count = 0;
    foreach (var item in root.GetProperty("queries").EnumerateArray())
    {
      if (DatasetFiles.Query(item.GetProperty("input")) != item.GetProperty("expected").GetString()) throw new Exception("Dataset query differs from shared fixture"); count++;
    }
    foreach (var item in root.GetProperty("files").EnumerateArray()) { DatasetFiles.Verify(item.GetProperty("metadata"), DatasetFiles.File(item.GetProperty("input"))); count++; }
    foreach (var key in new[] { "badQueries", "badFiles" }) foreach (var item in root.GetProperty(key).EnumerateArray())
    {
      var rejected = false;
      try { if (key == "badQueries") _ = DatasetFiles.Query(item); else _ = DatasetFiles.File(item); }
      catch { rejected = true; }
      if (!rejected) throw new Exception("Invalid dataset fixture was accepted"); count++;
    }
    Console.WriteLine("PASS dataset wire"); return count;
  }
}
