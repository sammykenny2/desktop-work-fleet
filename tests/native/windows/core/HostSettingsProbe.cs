using System.Text;
using System.Text.Json;
using WorkFleet.Windows.Core;

/// <summary>ADR-043 host-level files: the shared placement rule fixture, file round trips and damaged-file fallbacks.</summary>
internal static class HostSettingsProbe
{
  public static int Run(string root)
  {
    var count = 0;
    void Require(bool value, string message) { if (!value) throw new Exception(message); count++; }
    var fixture = FindFixture();
    using var document = JsonDocument.Parse(File.ReadAllBytes(fixture));
    var size = document.RootElement.GetProperty("defaultSize");
    static int? Number(JsonElement value, string key) => value.GetProperty(key).ValueKind == JsonValueKind.Null ? null : value.GetProperty(key).GetInt32();
    foreach (var item in document.RootElement.GetProperty("cases").EnumerateArray())
    {
      var saved = item.GetProperty("saved");
      var input = saved.ValueKind == JsonValueKind.Null ? null
        : new SavedPlacement(Number(saved, "x"), Number(saved, "y"), saved.GetProperty("width").GetInt32(), saved.GetProperty("height").GetInt32(), saved.GetProperty("maximized").GetBoolean());
      var areas = item.GetProperty("areas").EnumerateArray()
        .Select(area => new PlacementArea(area.GetProperty("x").GetInt32(), area.GetProperty("y").GetInt32(), area.GetProperty("width").GetInt32(), area.GetProperty("height").GetInt32())).ToArray();
      var expected = item.GetProperty("expected");
      var want = new SavedPlacement(Number(expected, "x"), Number(expected, "y"), expected.GetProperty("width").GetInt32(), expected.GetProperty("height").GetInt32(), expected.GetProperty("maximized").GetBoolean());
      var actual = WindowPlacement.Resolve(input, areas, size.GetProperty("width").GetInt32(), size.GetProperty("height").GetInt32());
      Require(actual == want, $"{item.GetProperty("name").GetString()}: {actual} != {want}");
    }
    var directory = Path.Combine(root, "host-settings"); Directory.CreateDirectory(directory);
    var placement = new SavedPlacement(-1200, 40, 900, 700, true);
    WindowPlacement.Write(directory, placement);
    Require(WindowPlacement.Read(directory) == placement, "placement round trip");
    Require(Directory.GetFiles(directory, "*.tmp").Length == 0, "placement leaves no temporary file");
    var wayland = new SavedPlacement(null, null, 800, 600, false);
    Require(WindowPlacement.Parse(WindowPlacement.Serialize(wayland)) == wayland, "compositor-placed round trip");
    foreach (var damaged in new[] { "", "{", "[]", "{\"version\":2,\"x\":0,\"y\":0,\"width\":10,\"height\":10,\"maximized\":false}",
      "{\"version\":1,\"x\":0,\"y\":0,\"width\":-1,\"height\":10,\"maximized\":false}", "{\"version\":1,\"x\":0,\"width\":10,\"height\":10,\"maximized\":false}",
      "{\"version\":1,\"x\":0,\"y\":0,\"width\":10,\"height\":10}", "{\"version\":1,\"version\":1,\"x\":0,\"y\":0,\"width\":10,\"height\":10,\"maximized\":false}" })
      Require(WindowPlacement.Parse(Encoding.UTF8.GetBytes(damaged)) is null, $"damaged placement rejected: {damaged}");
    WindowPlacement.Remove(directory); Require(WindowPlacement.Read(directory) is null, "removed placement reads as none");

    Require(HostPreferences.Read(directory) == new HostPreferences(), "missing preferences use defaults");
    Require(new HostPreferences() is { StartAtLogin: true, CloseToTray: true, OpenMainAtLogin: false }, "SPEC-006 defaults");
    var changed = new HostPreferences().With("startAtLogin", false).With("openMainAtLogin", true) with { LastUpdateCheck = "2026-10-14T00:00:00.0000000+00:00" };
    changed.Write(directory); Require(HostPreferences.Read(directory) == changed, "preferences round trip");
    try { new HostPreferences().With("unknown", true); throw new Exception("unknown preference accepted"); }
    catch (HostError error) { Require(error.Code == "invalid-request", "unknown preference code"); }
    foreach (var damaged in new[] { "", "{", "{\"version\":9,\"startAtLogin\":false}", "{\"version\":1,\"startAtLogin\":\"no\"}" })
      Require(HostPreferences.Parse(Encoding.UTF8.GetBytes(damaged)).StartAtLogin, $"damaged preferences keep defaults: {damaged}");
    Require(HostIdentity.BuildVersion() is { Length: > 0 } version && !version.Contains('+'), "build version without commit suffix");
    return count;
  }
  private static string FindFixture()
  {
    for (var folder = new DirectoryInfo(AppContext.BaseDirectory); folder is not null; folder = folder.Parent)
    {
      var candidate = Path.Combine(folder.FullName, "tests", "fixtures", "window-placement.json");
      if (File.Exists(candidate)) return candidate;
    }
    throw new FileNotFoundException("tests/fixtures/window-placement.json");
  }
}
