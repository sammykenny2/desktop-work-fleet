using Microsoft.Web.WebView2.Core;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Threading;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

/// <summary>Display-only surfaces route fixed commands to the single management document. No second database owner.</summary>
public sealed class DesktopCoordinator : IDisposable
{
  private const string Owner = "owner";
  private readonly SceneTransfers transfers = new();
  private readonly List<SceneView> views = [];
  private readonly Dictionary<string, PendingCommand> commands = new(StringComparer.Ordinal);
  private readonly Dictionary<string, (SceneView View, string Draft)> flushes = new(StringComparer.Ordinal);
  private readonly Dictionary<string, SceneView> frozen = new(StringComparer.Ordinal);
  private readonly CoreWebView2Environment environment;
  private readonly Action<object> sendOwner;
  private readonly Action showMain;
  private readonly Action<string> openExternal;
  private readonly Func<bool>? hideMain;
  private readonly NativeShortcuts shortcuts;
  private readonly NativeActivity activity;
  private ShortcutBinding[] bindings = [];
  private ForegroundIntent? activation;
  private long? focusSequence;
  private readonly Dictionary<string, (string View, ForegroundIntent Intent)> sceneIntents = new(StringComparer.Ordinal);
  private bool shortcutsBlocked;
  private bool nativeMenu;
  private readonly double scale;
  private IReadOnlyList<DisplayInfo> displays;
  private readonly NativeDisplayWatcher displayWatcher;
  private readonly DispatcherTimer shellWatcher;
  private NativeShellLayers shell;
  private string[] Layers => shell.Wallpaper != IntPtr.Zero ? ["desktop", "floating", "wallpaper"] : ["desktop", "floating"];
  private IReadOnlyList<DisplayInfo>? proposedDisplays;
  private long topology, proposedTopology;
  private bool displayPending, displayError;
  private string? frameToken;
  private DesktopFrame? frame;
  private bool started, disposed;
  public string SessionId { get; } = Guid.NewGuid().ToString();
  public IReadOnlyList<DesktopSurface> Surfaces => views.Where(v => v.Active && !v.Retired).Select(v => v.Surface).ToArray();
  public IReadOnlyList<ShortcutRegistration> ShortcutStatus => shortcuts.Registrations;
  private sealed record PendingCommand(SceneView View, string Id, string? Upload, bool Draft, DateTime Created);
  private sealed class SceneView(DisplayInfo display, string layer, double scale)
  {
    public string Id = Guid.NewGuid().ToString();
    public DisplayInfo Display = display;
    public string Layer = layer;
    public LogicalRect Viewport = new(display.Bounds.X / scale, display.Bounds.Y / scale, display.Bounds.Width / scale, display.Bounds.Height / scale);
    // Only the topmost scene is a top-level window; scenes attached to Explorer must be opaque to reach the screen.
    public DesktopSurface Surface = new(display.Bounds.X / (display.Dpi / 96d), display.Bounds.Y / (display.Dpi / 96d),
      display.Bounds.Width / (display.Dpi / 96d), display.Bounds.Height / (display.Dpi / 96d), layered: layer == "floating");
    public bool Ready, Retired, Initialized, Active = true;
    public DesktopFrame? Downloading;
    public string? Download;
    public long Applied = -1;
  }

  public DesktopCoordinator(CoreWebView2Environment environment, Action<object> sendOwner, Action showMain, Action<string> openExternal,
    IReadOnlyList<DisplayInfo>? displayOverride = null, Window? mainWindow = null, Func<bool>? hideMain = null)
  {
    this.environment = environment; this.sendOwner = sendOwner; this.showMain = showMain; this.openExternal = openExternal;
    this.hideMain = hideMain;
    displays = NativeDisplays.Validate(displayOverride ?? NativeDisplays.Read()); scale = displays.First(d => d.Primary).Dpi / 96d;
    shell = NativeShellLayers.Discover();
    foreach (var display in displays) foreach (var layer in Layers) views.Add(new(display, layer, scale));
    shortcuts = new NativeShortcuts(DispatchAction); activity = new NativeActivity(shortcuts);
    displayWatcher = new NativeDisplayWatcher(() => { shell = NativeShellLayers.Discover(); return displayOverride ?? NativeDisplays.Read(); }, InvalidateDisplays, ProposeDisplays, () =>
    {
      if (displayError) return; displayError = true;
      sendOwner(new { v = 1, @event = "desktop-error", message = "目前無法讀取顯示器，已保留資料及編輯文字；正在重試。" });
    });
    shellWatcher = new DispatcherTimer(DispatcherPriority.Background) { Interval = TimeSpan.FromSeconds(3) };
    shellWatcher.Tick += CheckShell; shellWatcher.Start();
    if (mainWindow is not null) activity.Watch(mainWindow);
    foreach (var view in views) Watch(view);
    shortcuts.Changed += () => sendOwner(new { v = 1, @event = "desktop-shortcut-status", registrations = Registrations() });
  }
  private void Watch(SceneView view)
  {
    activity.Watch(view.Surface.InputWindow);
    view.Surface.DpiChanged += () => { if (started && view.Ready && view.Active && !view.Retired) displayWatcher.Refresh(); };
  }
  private object[] Registrations() => shortcuts.Registrations.Select(r => (object)new { key = r.Key, target = r.Target, status = r.Status }).ToArray();
  private Dictionary<string, string> BindingMap() => bindings.ToDictionary(b => b.Key, b => b.Target, StringComparer.Ordinal);
  public void DispatchAction(string target)
    => DispatchAction(target, new ForegroundIntent());
  public void DispatchAction(string target, ForegroundIntent intent)
  {
    if (disposed || !started) return;
    activation = intent; focusSequence = null;
    sendOwner(new { v = 1, @event = "desktop-action", target, intent = activation.Id });
  }
  public string? CaptureIntent(Window source)
  {
    if (disposed || !started || shortcutsBlocked) return null;
    var value = ForegroundIntent.ForWindow(source);
    if (value is null) return null;
    activation = value; focusSequence = null; return value.Id;
  }
  public void MenuActive(bool value)
  {
    if (disposed) return; nativeMenu = value; activity.Block(shortcutsBlocked || nativeMenu);
  }
  private object WorkAreas(IReadOnlyList<DisplayInfo> values) => values.Select(d => new { id = d.Id, primary = d.Primary,
    x = d.WorkArea.X / scale, y = d.WorkArea.Y / scale, width = d.WorkArea.Width / scale, height = d.WorkArea.Height / scale }).ToArray();
  private object ViewInfo(SceneView v) => new { viewId = v.Id, layer = v.Layer, active = v.Active,
    viewport = new { x = v.Viewport.X, y = v.Viewport.Y, width = v.Viewport.Width, height = v.Viewport.Height } };
  private object Info() => new { sessionId = SessionId, referenceDpi = scale * 96, topology,
    layers = Layers,
    workAreas = WorkAreas(displays), views = views.Where(v => !v.Retired).Select(ViewInfo).ToArray() };

  private void InvalidateDisplays()
  {
    if (disposed) return; displayPending = true; activation = null; focusSequence = null; sceneIntents.Clear();
    foreach (var view in views.Where(v => !v.Retired).ToArray())
    {
      if (view.Initialized && !view.Surface.NativeAlive)
      {
        Retire(view, "桌面宿主已重新啟動，正在重新建立便箋畫面；資料保留。");
        view.Surface.Dispose();
      }
      else view.Surface.SuspendInput();
    }
    foreach (var view in views.Where(v => v.Ready && !v.Retired)) Post(view, new { v = 1, @event = "desktop-displays-changing" });
    if (started) sendOwner(new { v = 1, @event = "desktop-displays-changing" });
  }
  private void CheckShell(object? sender, EventArgs args)
  {
    if (!disposed && started && !displayPending && (shell.Changed
      || views.Any(v => !v.Retired && v.Initialized && !v.Surface.NativeAlive))) displayWatcher.Refresh();
  }
  private void ProposeDisplays(IReadOnlyList<DisplayInfo> next)
  {
    if (disposed) return; proposedDisplays = next; proposedTopology++; displayError = false;
    if (started) sendOwner(new { v = 1, @event = "desktop-displays", topology = proposedTopology, workAreas = WorkAreas(next) });
  }
  private object ApplyDisplays(JsonElement args)
  {
    var requested = JsonRules.Integer(args, "topology");
    if (requested == topology && !displayPending) return Info();
    HostError.Require(requested == proposedTopology && proposedDisplays is not null, "desktop-topology", "顯示器已再次變更，正在重新套用版面。");
    var editorId = args.GetProperty("editorViewId");
    var editing = editorId.ValueKind == JsonValueKind.Null ? null : views.FirstOrDefault(v => !v.Retired && v.Id == editorId.GetString());
    HostError.Require(editorId.ValueKind == JsonValueKind.Null || editing is not null, "desktop-view", "編輯視窗已失聯，請保留最後輸入。");
    var editorRect = editing is null ? null : DesktopFrame.Rect(args.GetProperty("editorRect"));
    var next = proposedDisplays!; var assignments = new List<(SceneView View, DisplayInfo Display)>();
    if (editing is not null)
    {
      static double Overlap(LogicalRect a, LogicalRect b) => Math.Max(0, Math.Min(a.X + a.Width, b.X + b.Width) - Math.Max(a.X, b.X))
        * Math.Max(0, Math.Min(a.Y + a.Height, b.Y + b.Height) - Math.Max(a.Y, b.Y));
      var destination = next.OrderByDescending(d => Overlap(editorRect!, new(d.Bounds.X / scale, d.Bounds.Y / scale, d.Bounds.Width / scale, d.Bounds.Height / scale)))
        .ThenByDescending(d => d.Id == editing.Display.Id).First();
      assignments.Add((editing, destination));
    }
    // Preserve stable monitor matches before assigning displaced/parked views to newly available slots.
    var slots = next.SelectMany(d => Layers.Select(layer => (Display: d, Layer: layer))).ToArray();
    foreach (var slot in slots)
    {
      if (assignments.Any(a => a.Display.Id == slot.Display.Id && a.View.Layer == slot.Layer)) continue;
      var match = views.FirstOrDefault(v => !v.Retired && v.Layer == slot.Layer && v.Display.Id == slot.Display.Id && assignments.All(a => a.View != v));
      if (match is not null) assignments.Add((match, slot.Display));
    }
    foreach (var slot in slots)
    {
      if (assignments.Any(a => a.Display.Id == slot.Display.Id && a.View.Layer == slot.Layer)) continue;
      var match = views.FirstOrDefault(v => !v.Retired && v.Layer == slot.Layer && assignments.All(a => a.View != v));
      if (match is null)
      {
        HostError.Require(views.Count(v => !v.Retired) < 48, "desktop-capacity", "桌面視窗容量已滿，請重新啟動以恢復呈現；資料仍保留。");
        match = new(slot.Display, slot.Layer, scale); views.Add(match); Watch(match);
      }
      assignments.Add((match, slot.Display));
    }
    foreach (var view in views.Where(v => !v.Retired))
    {
      var assignment = assignments.FirstOrDefault(a => a.View == view); view.Surface.SuspendInput(); view.Applied = -1;
      view.Active = assignment.View is not null;
      if (!view.Active) view.Surface.Hide();
      else
      {
        view.Display = assignment.Display!;
        view.Viewport = new(view.Display.Bounds.X / scale, view.Display.Bounds.Y / scale, view.Display.Bounds.Width / scale, view.Display.Bounds.Height / scale);
        if (view.Initialized)
        {
          view.Surface.SetShellParent(view.Layer == "wallpaper" ? shell.Wallpaper : view.Layer == "desktop" ? shell.Desktop : IntPtr.Zero);
          view.Surface.Show(view.Layer == "floating"); view.Surface.Hide();
          view.Surface.SetPhysicalBounds(view.Display.Bounds);
          if (view.Surface.WebView.CoreWebView2 is not null) view.Surface.WebView.ZoomFactor = scale / (view.Surface.Dpi / 96d);
        }
      }
    }
    displays = next; topology = requested; displayPending = false;
    foreach (var view in views.Where(v => v.Ready && !v.Retired)) Post(view, new { v = 1, @event = "desktop-viewport", topology, view = ViewInfo(view) });
    // Owner receives IDs before new scenes can submit commands; initialization yields through the dispatcher.
    Application.Current.Dispatcher.BeginInvoke(new Action(() => { if (!disposed) _ = Start(); }));
    return Info();
  }

  public object? Invoke(string method, JsonElement args)
  {
    Application.Current.Dispatcher.VerifyAccess(); ObjectDisposedException.ThrowIf(disposed, this); SweepCommands();
    if (frameToken is not null) transfers.Touch(Owner, frameToken);
    switch (method)
    {
      case "desktop.info": return Info();
      case "desktop.start":
        if (!started) { started = true; _ = Start(); if (displayPending) displayWatcher.Refresh(); }
        return Info();
      case "desktop.displays.retry": displayWatcher.Refresh(); return null;
      case "desktop.displays.apply": return ApplyDisplays(args);
      case "desktop.shortcuts.configure":
      {
        var values = args.GetProperty("bindings");
        HostError.Require(values.ValueKind == JsonValueKind.Array && values.GetArrayLength() <= 32, "shortcut-settings", "此裝置最多設定 32 組快捷鍵。");
        var next = values.EnumerateArray().Select(b => new ShortcutBinding(JsonRules.Text(b, "key", 80), JsonRules.Text(b, "target", 128))).ToArray();
        shortcuts.Configure(next); bindings = next; activity.Block(shortcutsBlocked || nativeMenu);
        foreach (var view in views.Where(v => v.Ready && !v.Retired)) Post(view, new { v = 1, @event = "desktop-shortcuts", bindings = BindingMap() });
        return new { registrations = Registrations() };
      }
      case "desktop.shortcuts.block": shortcutsBlocked = args.GetProperty("blocked").GetBoolean(); activity.Block(shortcutsBlocked || nativeMenu); return null;
      case "desktop.focus":
      {
        if (activation?.Id != JsonRules.Text(args, "intent") || !activation.Current) return new { accepted = false };
        focusSequence = JsonRules.Integer(args, "sequence");
        foreach (var view in views) if (TryFocus(view)) break;
        return new { accepted = true };
      }
      case "desktop.hideMain":
        HostError.Require(hideMain?.Invoke() == true, "tray-unavailable", "系統匣目前不可用，主畫面保持開啟。"); return null;
      case "desktop.frame.begin": return new { token = transfers.Begin(Owner, Size(args, SceneTransfers.MaxFrame), JsonRules.Text(args, "sha256"), SceneTransfers.MaxFrame) };
      case "desktop.frame.append": return new { offset = transfers.Append(Owner, JsonRules.Text(args, "token"), Size(args, SceneTransfers.MaxFrame, "offset"), JsonRules.Text(args, "base64", BridgeSession.MaxMessage)) };
      case "desktop.frame.publish":
      {
        var token = JsonRules.Text(args, "token");
        var next = DesktopFrame.Parse(transfers.Seal(Owner, token), SessionId, frame?.Sequence ?? -1);
        transfers.Retain(Owner, token); var previous = frameToken; frame = next; frameToken = token;
        if (previous is not null) transfers.Drop(Owner, previous);
        foreach (var view in views.Where(v => v.Ready && !v.Retired)) Post(view, new { v = 1, @event = "desktop-frame", sequence = next.Sequence });
        return new { sequence = next.Sequence };
      }
      case "desktop.frame.discard":
      {
        var token = JsonRules.Text(args, "token"); if (token != frameToken) transfers.Drop(Owner, token); return null;
      }
      case "desktop.command.read":
      {
        var pending = Pending(args); HostError.Require(pending.Upload is not null, "scene-missing", "此命令沒有大型輸入。");
        return transfers.Read(pending.View.Id, pending.Upload!, Size(args, SceneTransfers.MaxCommand, "offset"));
      }
      case "desktop.reply":
      {
        var ticket = JsonRules.Text(args, "ticket"); var pending = Pending(args);
        HostError.Require(args.GetProperty("ok").ValueKind is JsonValueKind.True or JsonValueKind.False, "scene-command", "桌面回覆格式無效。");
        var ok = args.GetProperty("ok").GetBoolean();
        var result = args.TryGetProperty("result", out var value) ? value.Clone() : (JsonElement?)null;
        var error = args.TryGetProperty("error", out value) ? value.Clone() : (JsonElement?)null;
        HostError.Require(args.GetRawText().Length <= 64 * 1024, "scene-size", "桌面操作回覆過大。");
        Post(pending.View, new { v = 1, @event = "desktop-command-result", commandId = pending.Id, ok, result, error });
        Release(ticket, pending); return null;
      }
      case "desktop.flush":
      {
        var view = View(JsonRules.Text(args, "viewId")); var id = JsonRules.Text(args, "id"); var draft = JsonRules.Text(args, "draftId");
        HostError.Require(id.Length == 36 && Guid.TryParseExact(id, "D", out _) && flushes.Count < 4 && !flushes.ContainsKey(id), "scene-busy", "桌面草稿仍在保存。");
        flushes.Add(id, (view, draft)); frozen.Add(id, view); Post(view, new { v = 1, @event = "desktop-flush", id, draftId = draft }); return null;
      }
      case "desktop.flush.cancel": flushes.Remove(JsonRules.Text(args, "id")); return null;
      case "desktop.flush.release":
      {
        var id = JsonRules.Text(args, "id"); flushes.Remove(id);
        if (frozen.Remove(id, out var view)) Post(view, new { v = 1, @event = "desktop-unfreeze", id,
          resume = args.TryGetProperty("viewId", out var activeView) && activeView.ValueKind == JsonValueKind.String && activeView.GetString() == view.Id,
          draftId = args.TryGetProperty("draftId", out var draft) ? draft.Clone() : (JsonElement?)null }); return null;
      }
      case "desktop.showMain":
      {
        var intent = args.GetProperty("intent");
        var accepted = intent.ValueKind == JsonValueKind.String && activation is not null && activation.Id == intent.GetString() && activation.Current;
        if (accepted) { activation = null; focusSequence = null; showMain(); }
        return new { activated = accepted };
      }
      default: throw new HostError("unsupported-method", "桌面主機沒有此操作。");
    }
  }

  private async Task Start()
  {
    foreach (var view in views.Where(v => v.Active && !v.Retired && !v.Initialized).ToArray())
    {
      if (disposed) return;
      try { await Initialize(view); }
      catch { Retire(view, "桌面視窗未能啟動，已保存資料仍保留於主畫面。"); }
    }
  }
  private async Task Initialize(SceneView view)
  {
    view.Initialized = true;
    view.Surface.SetShellParent(view.Layer == "wallpaper" ? shell.Wallpaper : view.Layer == "desktop" ? shell.Desktop : IntPtr.Zero);
    await view.Surface.Start(view.Layer == "floating", view.Display.Bounds, environment);
    if (disposed || view.Retired) return;
    var core = view.Surface.WebView.CoreWebView2; view.Surface.PassBrowserClicksThrough();
    core.SetVirtualHostNameToFolderMapping(NavigationPolicy.Host, Path.Combine(AppContext.BaseDirectory, "Assets"), CoreWebView2HostResourceAccessKind.Deny);
    core.Settings.AreHostObjectsAllowed = false; core.Settings.AreDevToolsEnabled = WebViewDiagnostics.DevToolsEnabled; core.Settings.IsStatusBarEnabled = false;
    core.Settings.AreBrowserAcceleratorKeysEnabled = false; core.Settings.IsBuiltInErrorPageEnabled = false; core.Settings.IsZoomControlEnabled = false;
    view.Surface.WebView.ZoomFactor = scale / (view.Surface.Dpi / 96d);
    core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
    core.FrameNavigationStarting += (_, e) => e.Cancel = true;
    core.NewWindowRequested += (_, e) => { e.Handled = true; if (e.IsUserInitiated) openExternal(e.Uri); };
    var navigated = false;
    core.NavigationStarting += (_, e) =>
    {
      if (!NavigationPolicy.IsDesktopDocument(e.Uri) || navigated) { e.Cancel = true; if (e.IsUserInitiated) openExternal(e.Uri); return; }
      navigated = true;
    };
    core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
    core.WebResourceRequested += (_, e) =>
    {
      if (!NavigationPolicy.IsAsset(e.Request.Uri) || e.Request.Method is not ("GET" or "HEAD"))
        e.Response = environment.CreateWebResourceResponse(Stream.Null, 403, "Blocked", "Content-Type: text/plain\r\nCache-Control: no-store");
    };
    core.WebMessageReceived += (_, e) =>
    {
      if (disposed || view.Retired || !NavigationPolicy.IsDesktopDocument(e.Source) || !NavigationPolicy.IsDesktopDocument(core.Source)) return;
      var message = e.WebMessageAsJson;
      if (Encoding.UTF8.GetByteCount(message) > BridgeSession.MaxMessage) return;
      PostRaw(view, Dispatch(view, message));
    };
    core.DownloadStarting += (_, e) => e.Cancel = true;
    core.ProcessFailed += (_, _) => Retire(view, "桌面畫面程序已停止。最後確認的草稿仍保留，請在主畫面繼續。");
    view.Surface.CloseRequested += () => sendOwner(new { v = 1, @event = "desktop-dismiss", viewId = view.Id });
    core.Navigate(NavigationPolicy.DesktopDocument);
  }
  private string Dispatch(SceneView view, string message)
  {
    string? id = null;
    try
    {
      using var document = JsonRules.Parse(Encoding.UTF8.GetBytes(message)); var request = document.RootElement;
      id = JsonRules.Text(request, "id");
      HostError.Require(id.Length == 36 && Guid.TryParseExact(id, "D", out _) && JsonRules.Integer(request, "v") == 1, "scene-command", "桌面協定無效。");
      var method = JsonRules.Text(request, "method"); var args = request.GetProperty("params");
      HostError.Require(args.ValueKind == JsonValueKind.Object, "scene-command", "桌面參數無效。");
      return JsonSerializer.Serialize(new { v = 1, id, ok = true, result = InvokeScene(view, method, args) });
    }
    catch (Exception error)
    {
      return JsonSerializer.Serialize(new { v = 1, id, ok = false,
        error = new { code = (error as HostError)?.Code ?? "scene-command", message = (error as HostError)?.Message ?? "桌面操作未完成，請保留未保存文字。" } });
    }
  }
  private object? InvokeScene(SceneView view, string method, JsonElement args)
  {
    SweepCommands();
    switch (method)
    {
      case "scene.intent":
      {
        foreach (var key in sceneIntents.Where(pair => !pair.Value.Intent.Current).Select(pair => pair.Key).ToArray()) sceneIntents.Remove(key);
        var captured = sceneIntents.Count < 32 && !shortcutsBlocked ? ForegroundIntent.ForWindow(view.Surface.InputWindow) : null;
        if (captured is not null) sceneIntents.Add(captured.Id, (view.Id, captured));
        return new { intent = captured?.Id };
      }
      case "scene.info":
        view.Ready = true;
        return new { sessionId = SessionId, viewId = view.Id, layer = view.Layer, active = view.Active, topology, bindings = BindingMap(), viewport = new { x = view.Viewport.X, y = view.Viewport.Y, width = view.Viewport.Width, height = view.Viewport.Height } };
      case "scene.report": sendOwner(new { v = 1, @event = "desktop-error", viewId = view.Id, message = JsonRules.Text(args, "message", 2000) }); return null;
      case "scene.frame":
      {
        if (frameToken is null || frame is null || displayPending || frame.Topology != topology) return null;
        if (view.Download is not null) transfers.Drop(view.Id, view.Download);
        var result = transfers.Lease(Owner, frameToken, view.Id);
        view.Download = JsonSerializer.SerializeToElement(result).GetProperty("token").GetString(); view.Downloading = frame; return result;
      }
      case "scene.read": return transfers.Read(view.Id, JsonRules.Text(args, "token"), Size(args, SceneTransfers.MaxFrame, "offset"));
      case "scene.discard": transfers.Drop(view.Id, JsonRules.Text(args, "token")); return null;
      case "scene.applied":
      {
        var sequence = JsonRules.Integer(args, "sequence");
        if (displayPending || !view.Active || view.Downloading?.Topology != topology || JsonRules.Integer(args, "topology") != topology) return new { accepted = false };
        HostError.Require(view.Downloading?.Sequence == sequence && sequence >= view.Applied, "scene-order", "桌面輸入區域尚未對應已顯示畫面。");
        var cards = view.Downloading!.Cards.Where(c => c.Layer == view.Layer).ToArray();
        var zoom = scale / (view.Surface.Dpi / 96d);
        view.Surface.SetInput(cards.Where(c => Intersects(c.Rect, view.Viewport)).Select(c =>
        {
          // Native region limits apply to the clipped viewport, not to persisted paper geometry.
          var x = Math.Max(c.Rect.X, view.Viewport.X); var y = Math.Max(c.Rect.Y, view.Viewport.Y);
          var right = Math.Min(c.Rect.X + c.Rect.Width, view.Viewport.X + view.Viewport.Width);
          var bottom = Math.Min(c.Rect.Y + c.Rect.Height, view.Viewport.Y + view.Viewport.Height);
          return new SceneHitRect((x - view.Viewport.X) * zoom, (y - view.Viewport.Y) * zoom, (right - x) * zoom, (bottom - y) * zoom, view.Layer != "wallpaper" && c.Interactive);
        }));
        var wasShown = view.Surface.Shown;
        var notice = view.Layer == "floating" && view.Downloading.Notice is { } rect && Intersects(rect, view.Viewport);
        if (notice || cards.Any(c => Intersects(c.Rect, view.Viewport))) view.Surface.Show(view.Layer == "floating"); else view.Surface.Hide();
        view.Applied = sequence; TryFocus(view);
        if (!wasShown && view.Surface.Shown) { view.Surface.PassBrowserClicksThrough(); Repaint(view); }
        return new { accepted = true };
      }
      case "scene.command.begin": return new { token = transfers.Begin(view.Id, Size(args, SceneTransfers.MaxCommand), JsonRules.Text(args, "sha256"), SceneTransfers.MaxCommand) };
      case "scene.command.append": return new { offset = transfers.Append(view.Id, JsonRules.Text(args, "token"), Size(args, SceneTransfers.MaxCommand, "offset"), JsonRules.Text(args, "base64", BridgeSession.MaxMessage)) };
      case "scene.command":
      {
        string? upload = null; JsonElement command;
        if (args.TryGetProperty("token", out var token))
        {
          upload = token.GetString()!; using var document = JsonRules.Parse(transfers.Seal(view.Id, upload)); command = document.RootElement.Clone();
        }
        else command = args.GetProperty("command").Clone();
        var id = JsonRules.Text(command, "id"); var commandMethod = JsonRules.Text(command, "method");
        HostError.Require(JsonRules.Text(command, "sessionId") == SessionId && id.Length == 36 && Guid.TryParseExact(id, "D", out _) && JsonRules.Integer(command, "serial") > 0,
          "scene-command", "桌面命令工作階段無效。");
        HostError.Require(commandMethod is "pointer.down" or "pointer.move" or "pointer.up" or "pointer.cancel" or "card.select" or "card.edit"
          or "card.details" or "card.transfer" or "editor.change" or "editor.save" or "editor.end" or "editor.full" or "interaction.escape" or "interaction.shortcut",
          "unsupported-method", "桌面主機沒有此操作。");
        var draft = commandMethod == "editor.change";
        var commandTopology = JsonRules.Integer(args, "topology");
        HostError.Require(draft || !displayPending && view.Active && commandTopology == topology, "desktop-topology", "桌面座標正在更新，請稍候再操作；目前文字仍保留。");
        HostError.Require(commands.Values.Count(c => c.Draft == draft) < (draft ? 4 : 24), "scene-busy", "桌面操作仍在處理。");
        HostError.Require(!commands.Values.Any(c => c.View == view && c.Id == id), "scene-busy", "這個桌面操作已送出。");
        var ticket = Guid.NewGuid().ToString(); commands.Add(ticket, new(view, id, upload, draft, DateTime.UtcNow));
        string? intent = null;
        if (commandMethod is "card.details" or "editor.full" or "interaction.shortcut" && args.TryGetProperty("intent", out var tokenIntent)
          && tokenIntent.ValueKind == JsonValueKind.String && sceneIntents.TryGetValue(tokenIntent.GetString()!, out var captured) && captured.View == view.Id)
        {
          sceneIntents.Remove(captured.Intent.Id);
          if (captured.Intent.Current) { activation = captured.Intent; focusSequence = null; intent = captured.Intent.Id; }
        }
        if (upload is null) sendOwner(new { v = 1, @event = "desktop-command", ticket, viewId = view.Id, command, intent, topology = commandTopology });
        else
        {
          var bytes = transfers.Seal(view.Id, upload);
          sendOwner(new { v = 1, @event = "desktop-command", ticket, viewId = view.Id, intent, topology = commandTopology,
            transfer = new { size = bytes.Length, sha256 = Convert.ToHexString(SHA256.HashData(bytes.Span)).ToLowerInvariant() } });
        }
        return new { accepted = true };
      }
      case "scene.flushed":
      {
        var id = JsonRules.Text(args, "id");
        HostError.Require(flushes.TryGetValue(id, out var pending) && pending.View == view && pending.Draft == JsonRules.Text(args, "draftId"), "scene-flush", "草稿保存請求已失效。");
        var ok = args.GetProperty("ok").GetBoolean(); var sequence = JsonRules.Integer(args, "sequence");
        flushes.Remove(id); sendOwner(new { v = 1, @event = "desktop-flushed", id, viewId = view.Id, draftId = pending.Draft, ok, sequence }); return null;
      }
      default: throw new HostError("unsupported-method", "桌面表面沒有儲存或系統操作權限。");
    }
  }
  private static bool Intersects(LogicalRect a, LogicalRect b) => a.X < b.X + b.Width && a.X + a.Width > b.X && a.Y < b.Y + b.Height && a.Y + a.Height > b.Y;
  private bool TryFocus(SceneView view)
  {
    if (focusSequence is null || activation is null) return false;
    if (!activation.Current) { activation = null; focusSequence = null; return false; }
    if (displayPending || !view.Active || view.Retired || !view.Ready || view.Layer != "floating" || view.Applied < focusSequence
      || view.Downloading is null || !view.Downloading.Cards.Any(c => c.Layer == view.Layer && c.Operable && Intersects(c.Rect, view.Viewport))) return false;
    focusSequence = null; activation = null;
    if (view.Surface.InputWindow.Activate()) { view.Surface.WebView.Focus(); Post(view, new { v = 1, @event = "desktop-focus" }); }
    return true;
  }
  private static int Size(JsonElement args, int max, string key = "size") => (int)JsonRules.Integer(args, key, max);
  private SceneView View(string id) => views.FirstOrDefault(v => v.Id == id && v.Ready && !v.Retired) ?? throw new HostError("desktop-view", "桌面視窗已關閉或尚未就緒。");
  private PendingCommand Pending(JsonElement args) => commands.TryGetValue(JsonRules.Text(args, "ticket"), out var value) ? value : throw new HostError("scene-command", "桌面操作已失效。");
  private void Release(string ticket, PendingCommand command)
  {
    commands.Remove(ticket); if (command.Upload is not null) transfers.Drop(command.View.Id, command.Upload);
  }
  private void SweepCommands()
  {
    foreach (var pair in commands.Where(c => DateTime.UtcNow - c.Value.Created > TimeSpan.FromMinutes(2)).ToArray()) Release(pair.Key, pair.Value);
  }
  private void Repaint(SceneView view)
  {
    // A frame rendered while the surface was hidden stays blank until the page paints again. Composition resumes
    // asynchronously after Show, so a repaint posted immediately is lost; wait before nudging one.
    var timer = new DispatcherTimer(DispatcherPriority.Background) { Interval = TimeSpan.FromMilliseconds(300) };
    timer.Tick += (_, _) =>
    {
      timer.Stop(); if (disposed || view.Retired || !view.Surface.Shown) return;
      // The browser may recreate its render popup while the scene comes back; keep it click-through.
      view.Surface.PassBrowserClicksThrough(); Post(view, new { v = 1, @event = "desktop-repaint" });
    };
    timer.Start();
  }
  private void Post(SceneView view, object value) => PostRaw(view, JsonSerializer.Serialize(value));
  private void PostRaw(SceneView view, string json)
  {
    var core = view.Surface.WebView.CoreWebView2;
    if (!disposed && !view.Retired && core is not null && NavigationPolicy.IsDesktopDocument(core.Source)) core.PostWebMessageAsJson(json);
  }
  private void Retire(SceneView view, string message)
  {
    if (disposed || view.Retired) return; view.Retired = true; view.Surface.Hide();
    foreach (var key in sceneIntents.Where(pair => pair.Value.View == view.Id).Select(pair => pair.Key).ToArray()) sceneIntents.Remove(key);
    foreach (var pair in commands.Where(c => c.Value.View == view).ToArray()) Release(pair.Key, pair.Value);
    foreach (var pair in flushes.Where(c => c.Value.View == view).ToArray()) flushes.Remove(pair.Key);
    foreach (var pair in frozen.Where(c => c.Value == view).ToArray()) frozen.Remove(pair.Key);
    transfers.DropOwner(view.Id); sendOwner(new { v = 1, @event = "desktop-view-lost", viewId = view.Id, message });
  }
  public void Dispose()
  {
    if (disposed) return; disposed = true;
    displayWatcher.Dispose(); activity.Dispose(); shortcuts.Dispose();
    shellWatcher.Stop(); shellWatcher.Tick -= CheckShell;
    foreach (var view in views) view.Surface.Dispose(); transfers.Dispose(); commands.Clear(); flushes.Clear(); frozen.Clear(); sceneIntents.Clear();
  }
}
