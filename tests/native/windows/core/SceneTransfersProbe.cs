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
    // Three-byte UTF-8 characters, so one frame spans several chunks.
    using var pipe = new SceneTransfers(); var bytes = Encoding.UTF8.GetBytes(new string((char)0x4E2D, 150000));
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
      // Adjusting makes the topmost scene the modal adjust overlay; an unknown scope is refused.
      Check(!DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 4).Adjusting);
      frame["operationScope"] = new { kind = "group", groupId = "group-1" }; Check(DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 4).Adjusting);
      frame["operationScope"] = new { kind = "drag" }; Reject(() => DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 4), "scene-frame");
      frame["operationScope"] = new { kind = "none" };
      Reject(() => DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 5), "scene-order");
      Reject(() => DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), "other", 0), "scene-session");
      frame["groups"] = Enumerable.Range(0, 10).Select(i => new { id = $"group-{i}", name = new string((char)0x7D44, 81), color = "#fff6cc", region = (object?)null }).ToArray();
      Check(DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 0).Sequence == 5);
      // A stage notice is presentation only: its rectangle is carried for scene visibility, anything else is refused.
      frame["notice"] = new { id = 1, rect = new { x = 10, y = 20, width = 300, height = 200 }, title = "Research", text = "Top layer", step = 3, steps = 4 };
      Check(DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 0).Notice == new LogicalRect(10, 20, 300, 200));
      frame["notice"] = new { id = 1, rect = new { x = 10, y = 20, width = 300, height = 200 }, title = "Research", text = "Top layer", step = 3, steps = 4, cards = 1 };
      Reject(() => DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 0), "scene-frame");
      frame["notice"] = new { id = 1, rect = new { x = 10, y = 20, width = 0, height = 200 }, title = "Research", text = "Top layer", step = 3, steps = 4 };
      Reject(() => DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 0), "scene-frame");
      frame["notice"] = null; Check(DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 0).Notice is null);
      // Frames carry the main window's UI locale for the scene; only a short language tag is accepted.
      foreach (var locale in new[] { "en", "zh-TW", "zh-Hant-TW" })
      { frame["locale"] = locale; Check(DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 0).Sequence == 5); }
      foreach (var locale in new object?[] { 1, null, "", "e", "en_US", "en-US;x", "en-toolongtag", new string('a', 64) })
      { frame["locale"] = locale; Reject(() => DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 0), "scene-frame"); }
      frame.Remove("locale");
      // Frames carry the key that starts a quick move in the scene, or null; nothing else is accepted.
      foreach (var key in new object?[] { "meta", "ctrl", null })
      { frame["quickMove"] = key; Check(DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 0).Sequence == 5); }
      foreach (var key in new object?[] { "alt", "", 1, true })
      { frame["quickMove"] = key; Reject(() => DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 0), "scene-frame"); }
      frame.Remove("quickMove");
      frame["outbox"] = new[] { "private" }; Reject(() => DesktopFrame.Parse(JsonSerializer.SerializeToUtf8Bytes(frame), session, 0), "scene-frame");
      using var rect = JsonDocument.Parse("{\"x\":0,\"y\":0,\"width\":-1,\"height\":1}"); Reject(() => DesktopFrame.Rect(rect.RootElement), "scene-frame");
      using var overflow = JsonDocument.Parse("{\"x\":-1500000,\"y\":0,\"width\":2000000,\"height\":50000}");
      Check(DesktopFrame.Rect(overflow.RootElement).Width == 2000000);
      Check(NavigationPolicy.IsDesktopDocument(NavigationPolicy.DesktopDocument)); Check(!NavigationPolicy.IsDocument(NavigationPolicy.DesktopDocument));
      Check(!NavigationPolicy.IsDesktopDocument(NavigationPolicy.Document)); Check(!NavigationPolicy.IsDesktopDocument(NavigationPolicy.DesktopDocument + "?source=other"));
    });
    Test("native wallpaper frames allow passive notes and reject interactive, draggable or editing wallpaper", () =>
    {
      var session = Guid.NewGuid().ToString();
      byte[] Frame(string layer, bool interactive = false, bool draggable = false, bool editing = false) => JsonSerializer.SerializeToUtf8Bytes(new {
        protocol = 1, sessionId = session, sequence = 1, workspaceRevision = 1, layoutRevision = 1,
        groups = Array.Empty<object>(), operationScope = new { kind = "none" }, activeGroupId = (string?)null,
        cards = new[] { new { id = "card", groupId = "group", revision = "revision", summary = "note", text = "text", format = "markdown",
          attachmentCount = 0, rect = new { x = -100, y = 20, width = 300, height = 200 }, layer, interactive, draggable, editing,
          selected = false, completed = false, mine = true, color = "#fff6cc" } }, editor = (object?)null, dropTarget = (object?)null,
        fallbacks = Array.Empty<object>() });
      Check(DesktopFrame.Parse(Frame("wallpaper"), session, 0).Cards.Single().Layer == "wallpaper");
      Reject(() => DesktopFrame.Parse(Frame("wallpaper", interactive: true), session, 0), "scene-frame");
      Reject(() => DesktopFrame.Parse(Frame("wallpaper", draggable: true), session, 0), "scene-frame");
      Reject(() => DesktopFrame.Parse(Frame("wallpaper", editing: true), session, 0), "scene-frame");
      Check(DesktopFrame.Parse(Frame("floating", true, true, true), session, 0).Cards.Single().Operable);
      Reject(() => DesktopFrame.Parse(Frame("unknown"), session, 0), "scene-frame");
    });
    Test("native frames let only Top-layer papers be see-through, from 30%", () =>
    {
      var session = Guid.NewGuid().ToString();
      byte[] Frame(string layer, double opacity) => JsonSerializer.SerializeToUtf8Bytes(new {
        protocol = 1, sessionId = session, sequence = 1, workspaceRevision = 1, layoutRevision = 1,
        groups = Array.Empty<object>(), operationScope = new { kind = "none" }, activeGroupId = (string?)null,
        cards = new[] { new { id = "card", groupId = "group", revision = "revision", summary = "note", text = "text", format = "markdown",
          attachmentCount = 0, rect = new { x = 20, y = 20, width = 300, height = 200 }, layer, interactive = layer != "wallpaper", draggable = false, editing = false,
          selected = false, completed = false, mine = false, color = "#fff6cc", opacity } }, editor = (object?)null, dropTarget = (object?)null,
        fallbacks = Array.Empty<object>() });
      Check(DesktopFrame.Parse(Frame("floating", 0.3), session, 0).Cards.Single().Layer == "floating");
      Check(DesktopFrame.Parse(Frame("desktop", 1), session, 0).Cards.Single().Layer == "desktop");
      Reject(() => DesktopFrame.Parse(Frame("floating", 0.2), session, 0), "scene-frame");
      Reject(() => DesktopFrame.Parse(Frame("desktop", 0.5), session, 0), "scene-frame");
      Reject(() => DesktopFrame.Parse(Frame("wallpaper", 0.5), session, 0), "scene-frame");
    });
    return count;
  }
}
