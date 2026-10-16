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
    Require(StartupConfig.TrayWait("{\"schemaVersion\":1,\"startup\":{\"trayWaitSeconds\":30}}"u8) == TimeSpan.FromSeconds(30), "tray wait from the public config");
    Require(StartupConfig.TrayWait("{\"startup\":{\"trayWaitSeconds\":0}}"u8) == TimeSpan.Zero, "a zero tray wait");
    foreach (var invalid in new[] { "", "{", "{}", "{\"startup\":null}", "{\"startup\":{}}", "{\"startup\":{\"trayWaitSeconds\":-1}}",
      "{\"startup\":{\"trayWaitSeconds\":1.5}}", "{\"startup\":{\"trayWaitSeconds\":\"30\"}}", "{\"startup\":{\"trayWaitSeconds\":2147483648}}" })
      Require(StartupConfig.TrayWait(Encoding.UTF8.GetBytes(invalid)) == TimeSpan.Zero, $"no valid tray wait waits for nothing: {invalid}");
    Require(StartupConfig.ReadTrayWait(Path.Combine(root, "missing-app")) == TimeSpan.Zero, "an app without Config/public.json waits for nothing");
    Require(HostIdentity.BuildVersion() is { Length: > 0 } version && !version.Contains('+'), "build version without commit suffix");
    count += Recovery(Path.Combine(root, "host-recovery"));
    count += SignInHold();
    return count;
  }
  /// <summary>ADR-046: when a sign-in launch keeps its scenes out of Explorer.</summary>
  private static int SignInHold()
  {
    var count = 0;
    void Expect(SceneHold actual, string? reason, bool waiting, string message)
    { if (actual.Reason != reason || actual.Waiting != waiting) throw new Exception($"{message}: {actual}"); count++; }
    var start = TimeSpan.FromSeconds(2); var quiet = SignInDisplays.Quiet; var limit = SignInDisplays.Limit;
    Expect(SignInDisplays.Check(true, true, true, null, start), SignInDisplays.LidClosedReason, true, "the 2026-10-14 sign-in: closed lid, panel on next to the external display");
    Expect(SignInDisplays.Check(true, false, true, null, start), null, false, "panel turned off: attach");
    Expect(SignInDisplays.Check(true, false, true, TimeSpan.FromSeconds(1), start), SignInDisplays.ChangedReason, true, "just after the panel turned off: wait for quiet");
    Expect(SignInDisplays.Check(true, false, true, quiet, start + quiet), null, false, "quiet period over: attach");
    Expect(SignInDisplays.Check(false, true, true, null, start), null, false, "lid open: both displays stay");
    Expect(SignInDisplays.Check(null, true, true, null, start), null, false, "no lid reported: never wait for one");
    Expect(SignInDisplays.Check(true, true, false, null, start), null, false, "closed laptop with nothing else: its panel stays");
    Expect(SignInDisplays.Check(true, true, true, null, limit), SignInDisplays.LidClosedReason, false, "limit reached: attach although the panel is on");
    Expect(SignInDisplays.Check(false, false, true, TimeSpan.Zero, limit + start), SignInDisplays.ChangedReason, false, "limit reached during a change: attach");
    void Describe(string actual, string expected, string message) { if (actual != expected) throw new Exception($"{message}: {actual}"); count++; }
    Describe(SignInDisplays.Describe(false, true, true, null), "lid=open builtIn=on other=on changed=none", "lid open next to the panel and another display");
    Describe(SignInDisplays.Describe(true, false, true, TimeSpan.FromMilliseconds(1250)), "lid=closed builtIn=off other=on changed=1.3s ago", "panel just turned off");
    Describe(SignInDisplays.Describe(null, null, null, null), "lid=unreported builtIn=unread other=unread changed=none", "no lid, unreadable configuration");
    return count;
  }
  /// <summary>ADR-045 files: host.log entries and rotation, the HRESULT chain, and the restart marker taken once.</summary>
  private static int Recovery(string directory)
  {
    var count = 0;
    void Require(bool value, string message) { if (!value) throw new Exception(message); count++; }
    if (Directory.Exists(directory)) Directory.Delete(directory, true);
    var log = Path.Combine(directory, HostLog.FileName);
    var time = new DateTimeOffset(2026, 10, 14, 14, 12, 13, 250, TimeSpan.FromHours(8));
    HostLog.Append(directory, time, "start version=0.2.0"); HostLog.Append(directory, time, "exit\n");
    Require(File.ReadAllText(log) == "2026-10-14 14:12:13.250+08:00 start version=0.2.0\n2026-10-14 14:12:13.250+08:00 exit\n", "host.log lines carry local time and offset");
    File.WriteAllText(log, new string('x', (int)HostLog.Limit));
    HostLog.Append(directory, time, "after rotation");
    Require(new FileInfo(log + ".1").Length == HostLog.Limit && File.ReadAllText(log).EndsWith("after rotation\n") && new FileInfo(log).Length < 100, "a full log moves to host.log.1");
    using (var held = new FileStream(log, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
      HostLog.Append(directory, time, "while read");
    Require(File.ReadAllText(log).Contains("while read"), "appends while another reader has the log open");
    var render = new System.Runtime.InteropServices.COMException("UCEERR_RENDERTHREADFAILURE", HostLog.RenderThreadFailure);
    var described = HostLog.Describe(new InvalidOperationException("outer", render));
    Require(described.StartsWith("System.InvalidOperationException HRESULT=0x80131509 <- System.Runtime.InteropServices.COMException HRESULT=0x88980406\n")
      && described.Contains("UCEERR_RENDERTHREADFAILURE"), "the exception chain names each HRESULT");
    Require(HostLog.IsRenderThreadFailure(render) && HostLog.IsRenderThreadFailure(new AggregateException(render)) && !HostLog.IsRenderThreadFailure(new InvalidOperationException()),
      "render-thread failures are found in the chain");

    var now = DateTimeOffset.UtcNow;
    var marker = new RestartMarker(4242, now.AddSeconds(-5), "render-thread");
    Require(RestartMarker.Parse(marker.Serialize()) == marker with { Created = marker.Created.ToUniversalTime() }, "restart marker round trip");
    marker.Write(directory);
    Require(RestartMarker.Take(directory, now) == marker, "the reopened launch takes the marker");
    Require(RestartMarker.Take(directory, now) is null, "a marker is taken only once");
    Require(Directory.GetFiles(directory, RestartMarker.FileName + "*").Length == 0, "taking leaves no marker files");
    (marker with { Created = now - RestartMarker.Lifetime - TimeSpan.FromSeconds(1) }).Write(directory);
    Require(RestartMarker.Take(directory, now) is null && !File.Exists(Path.Combine(directory, RestartMarker.FileName)), "a stale marker is dropped");
    (marker with { Created = now.AddMinutes(5) }).Write(directory);
    Require(RestartMarker.Take(directory, now) is null, "a future-dated marker is dropped");
    foreach (var damaged in new[] { "", "{", "[]", "{\"version\":2,\"processId\":1,\"created\":\"2026-10-14T06:12:13Z\",\"reason\":\"x\"}",
      "{\"version\":1,\"processId\":0,\"created\":\"2026-10-14T06:12:13Z\",\"reason\":\"x\"}", "{\"version\":1,\"processId\":1,\"created\":\"soon\",\"reason\":\"x\"}",
      "{\"version\":1,\"processId\":1,\"created\":\"2026-10-14T06:12:13Z\"}", "{\"version\":1,\"processId\":1,\"processId\":2,\"created\":\"2026-10-14T06:12:13Z\",\"reason\":\"x\"}" })
      Require(RestartMarker.Parse(Encoding.UTF8.GetBytes(damaged)) is null, $"damaged marker rejected: {damaged}");
    Require(RestartMarker.Take(Path.Combine(directory, "missing"), now) is null, "no marker in a missing directory");
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
