using System.Text;
using System.Text.Json;
using WorkFleet.Windows.Core;

internal static class SceneTransfersProbe
{
  public static int Run()
  {
    var count = 0;
    void Check(bool value) { if (!value) throw new Exception("Scene transfer assertion failed."); }
    void Reject(Action action, string code)
    {
      try { action(); } catch (HostError error) when (error.Code == code) { return; }
      throw new Exception($"Expected scene rejection: {code}");
    }
    void Test(string name, Action action) { action(); count++; Console.WriteLine($"PASS {name}"); }
    using var pipe = new SceneTransfers(); var bytes = Encoding.UTF8.GetBytes(new string('中', 150000));
    string Upload(string owner, byte[] data)
    {
      var token = pipe.Begin(owner, data.Length, LocalDatabase.Digest(data), SceneTransfers.MaxFrame);
      for (var offset = 0; offset < data.Length; offset += BridgeSession.ChunkSize)
        pipe.Append(owner, token, offset, Convert.ToBase64String(data, offset, Math.Min(BridgeSession.ChunkSize, data.Length - offset)));
      pipe.Seal(owner, token); return token;
    }
    Test("scene bytes stay principal-bound, immutable after seal, and leased downloads survive owner replacement", () =>
    {
      var token = Upload("owner", bytes);
      Reject(() => pipe.Seal("foreign", token), "scene-missing");
      Reject(() => pipe.Append("owner", token, 0, "YQ=="), "scene-offset");
      var descriptor = JsonSerializer.SerializeToElement(pipe.Lease("owner", token, "view")); var lease = descriptor.GetProperty("token").GetString()!;
      pipe.Drop("view", token); Check(pipe.Seal("owner", token).Span.SequenceEqual(bytes));
      pipe.Drop("owner", token); Check(pipe.Seal("view", lease).Span.SequenceEqual(bytes));
      var part = JsonSerializer.SerializeToElement(pipe.Read("view", lease, BridgeSession.ChunkSize));
      Check(Convert.FromBase64String(part.GetProperty("base64").GetString()!).SequenceEqual(bytes[BridgeSession.ChunkSize..]));
      pipe.DropOwner("view"); Reject(() => pipe.Read("view", lease, 0), "scene-missing");
    });
    Test("incomplete and corrupt scene uploads never become readable frames", () =>
    {
      var token = pipe.Begin("owner", 2, LocalDatabase.Digest([1,2]), SceneTransfers.MaxFrame);
      pipe.Append("owner", token, 0, "AQ=="); Reject(() => pipe.Seal("owner", token), "scene-incomplete");
      Reject(() => pipe.Read("owner", token, 0), "scene-offset"); Reject(() => pipe.Append("owner", token, 0, "Ag=="), "scene-offset");
      pipe.Append("owner", token, 1, "Aw=="); Reject(() => pipe.Seal("owner", token), "scene-integrity"); pipe.Drop("owner", token);
      Reject(() => pipe.Begin("view", SceneTransfers.MaxCommand + 1, LocalDatabase.Digest(bytes), SceneTransfers.MaxCommand), "scene-size");
    });
    Test("native projection rejects stale sessions, repeated frames, invalid geometry and accidental authority fields", () =>
    {
      var session = Guid.NewGuid().ToString();
      Dictionary<string, object?> Frame() => new() { ["protocol"] = 1, ["sessionId"] = session, ["sequence"] = 5, ["workspaceRevision"] = 3, ["layoutRevision"] = 2,
        ["groups"] = Array.Empty<object>(), ["operationScope"] = new { kind = "none" }, ["activeGroupId"] = null, ["cards"] = Array.Empty<object>(), ["editor"] = null,
        ["dropTarget"] = null, ["fallbacks"] = Array.Empty<object>() };
      var frame = Frame(); Check(DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 4).Sequence == 5);
      Reject(() => DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 5), "scene-order");
      Reject(() => DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), "other", 0), "scene-session");
      frame["groups"] = Enumerable.Range(0, 10).Select(i => new { id = $"group-{i}", name = new string('組', 81), color = "#fff6cc", region = (object?)null }).ToArray();
      Check(DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 0).Sequence == 5);
      frame["outbox"] = new[] { "private" }; Reject(() => DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 0), "scene-frame");
      using var rect = JsonDocument.Parse("{\"x\":0,\"y\":0,\"width\":-1,\"height\":1}"); Reject(() => DesktopFrame.Rect(rect.RootElement), "scene-frame");
      using var overflow = JsonDocument.Parse("{\"x\":-1500000,\"y\":0,\"width\":2000000,\"height\":50000}");
      Check(DesktopFrame.Rect(overflow.RootElement).Width == 2000000);
      Check(NavigationPolicy.IsDesktopDocument(NavigationPolicy.DesktopDocument)); Check(!NavigationPolicy.IsDocument(NavigationPolicy.DesktopDocument));
      Check(!NavigationPolicy.IsDesktopDocument(NavigationPolicy.Document)); Check(!NavigationPolicy.IsDesktopDocument(NavigationPolicy.DesktopDocument + "?source=other"));
    });
    return count;
  }
}
