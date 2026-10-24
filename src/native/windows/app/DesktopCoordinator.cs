using Microsoft.Web.WebView2.Core;
using System.IO;
using System.Runtime.InteropServices;
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
  private readonly Func<bool> showMain;
  private readonly Action<string> openExternal;
  private readonly Func<bool>? hideMain;
  private readonly Window? mainWindow;
  // The state a focused main window had when the adjust overlay minimized it; null when the overlay did not move it.
  private WindowState? mainAside;
  private readonly NativeShortcuts shortcuts;
  private readonly NativeActivity activity;
  private ShortcutBinding[] bindings = [];
  private ForegroundIntent? activation;
  private long? focusSequence;
  // A quick edit's keyboard request, honoured once its view shows the frame and only shortly after a scene asked to edit;
  // the window that had the keyboard gets it back when the edit closes.
  private DateTime editRequested = DateTime.MinValue;
  private (string View, long Sequence)? editorFocus;
  private IntPtr editorReturn;
  private readonly Dictionary<string, (string View, ForegroundIntent Intent)> sceneIntents = new(StringComparer.Ordinal);
  private bool shortcutsBlocked;
  private bool nativeMenu;
  // ADR-018: one logical unit is this many physical pixels, the applied primary display's DPI over 96; only ApplyDisplays changes it.
  private double scale;
  private IReadOnlyList<DisplayInfo> displays;
  // ADR-045: host.log times display changes against fatal errors; a sign-in topology change killed the renderer.
  private readonly Action<string>? note;
  private string? notedDisplays;
  // ADR-046: a sign-in launch keeps its scenes out of Explorer until the displays settle.
  private bool holding;
  private readonly Func<BuiltInDisplays>? builtInOverride;
  private readonly DateTime created = DateTime.UtcNow;
  private DateTime? displaysChangedAt;
  private string? holdReason;
  private DispatcherTimer? holdTimer;
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
  /// <summary>Each key as Windows last answered it, also while an open menu or this app's focus suspends them.</summary>
  public IReadOnlyList<ShortcutRegistration> ShortcutAnswers => shortcuts.LastAnswers;
  /// <summary>Whether the topmost scene shows the adjust overlay, so the tray offers finishing instead of adjusting.</summary>
  public bool Adjusting => views.Any(v => v.Active && !v.Retired && v.Adjusting);
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
    public PresentedCard[] Presented = [];
    public bool Adjusting, Editing;
    // The scene holds the pointer of a quick move (from pointer.down until pointer.up or pointer.cancel).
    public bool QuickHeld;
  }

  public DesktopCoordinator(CoreWebView2Environment environment, Action<object> sendOwner, Func<bool> showMain, Action<string> openExternal,
    IReadOnlyList<DisplayInfo>? displayOverride = null, Window? mainWindow = null, Func<bool>? hideMain = null, Action<string>? note = null,
    bool holdAtSignIn = false, Func<BuiltInDisplays>? builtInOverride = null)
  {
    this.environment = environment; this.sendOwner = sendOwner; this.showMain = showMain; this.openExternal = openExternal;
    this.hideMain = hideMain; this.mainWindow = mainWindow; this.note = note; holding = holdAtSignIn; this.builtInOverride = builtInOverride;
    displays = NativeDisplays.Validate(displayOverride ?? NativeDisplays.Read()); scale = Unit(displays);
    NoteDisplays("displays at start", displays);
    shell = NativeShellLayers.Discover();
    foreach (var display in displays) foreach (var layer in Layers) views.Add(new(display, layer, scale));
    shortcuts = new NativeShortcuts(DispatchAction); activity = new NativeActivity(shortcuts);
    displayWatcher = new NativeDisplayWatcher(() => { shell = NativeShellLayers.Discover(); return displayOverride ?? NativeDisplays.Read(); }, InvalidateDisplays, ProposeDisplays, () =>
    {
      if (displayError) return; displayError = true; note?.Invoke("displays unreadable; retrying");
      sendOwner(new { v = 1, @event = "desktop-error", message = HostText.Get("desktop.displaysUnreadable") });
    });
    displayWatcher.LidChanged += NoteLid; displayWatcher.LidChanged += Release;
    shellWatcher = new DispatcherTimer(DispatcherPriority.Background) { Interval = TimeSpan.FromSeconds(3) };
    shellWatcher.Tick += CheckShell; shellWatcher.Start();
    if (mainWindow is not null) activity.Watch(mainWindow);
    foreach (var view in views) Watch(view);
    shortcuts.Changed += () => sendOwner(new { v = 1, @event = "desktop-shortcut-status", registrations = Registrations() });
  }
  private void Watch(SceneView view)
  {
    activity.Watch(view.Surface.InputWindow);
    view.Surface.PointerCaptureLost += () => Post(view, new { v = 1, @event = "desktop-pointer-cancel" });
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
  private static double Unit(IReadOnlyList<DisplayInfo> values) => values.First(d => d.Primary).Dpi / 96d;
  // A proposal is laid out in the unit its own displays will apply, so the owner rescues papers in the coordinates they get.
  private static object WorkAreas(IReadOnlyList<DisplayInfo> values)
  {
    var unit = Unit(values);
    return values.Select(d => new { id = d.Id, primary = d.Primary,
      x = d.WorkArea.X / unit, y = d.WorkArea.Y / unit, width = d.WorkArea.Width / unit, height = d.WorkArea.Height / unit }).ToArray();
  }
  private Dictionary<string, object> ViewInfo(SceneView v) => new()
  {
    ["viewId"] = v.Id, ["layer"] = v.Layer, ["active"] = v.Active,
    ["viewport"] = new { x = v.Viewport.X, y = v.Viewport.Y, width = v.Viewport.Width, height = v.Viewport.Height },
    ["adjustOverlay"] = v.Layer == "floating", ["liftQuickMove"] = true,
  };
  // Adjust mode is a modal overlay on every host: the topmost scene tints the screen and carries the adjust controls.
  // A quick move rides the Top layer while it drags: an attached scene cannot show a paper moving inside it.
  private object Info() => new { sessionId = SessionId, referenceDpi = scale * 96, topology,
    layers = Layers, residentLayers = Layers, adjustOverlay = true, liftQuickMove = true,
    workAreas = WorkAreas(displays), views = views.Where(v => !v.Retired).Select(ViewInfo).ToArray() };

  private void InvalidateDisplays()
  {
    if (disposed) return; displayPending = true; activation = null; focusSequence = null; editorFocus = null; sceneIntents.Clear();
    foreach (var view in views.Where(v => !v.Retired).ToArray())
    {
      if (view.Initialized && !view.Surface.NativeAlive)
      {
        Retire(view, HostText.Get("desktop.shellRestarted"));
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
  private bool NoteDisplays(string label, IReadOnlyList<DisplayInfo> values)
  {
    var text = NativeDisplays.Describe(values);
    if (text == notedDisplays) return false;
    notedDisplays = text; note?.Invoke($"{label} {text}"); return true;
  }
  private void ProposeDisplays(IReadOnlyList<DisplayInfo> next)
  {
    if (disposed) return; proposedDisplays = next; proposedTopology++; displayError = false;
    if (NoteDisplays($"displays changed topology={proposedTopology}", next)) displaysChangedAt = DateTime.UtcNow;
    if (started) sendOwner(new { v = 1, @event = "desktop-displays", topology = proposedTopology, workAreas = WorkAreas(next) });
  }
  private object ApplyDisplays(JsonElement args)
  {
    var requested = JsonRules.Integer(args, "topology");
    if (requested == topology && !displayPending) return Info();
    HostError.Require(requested == proposedTopology && proposedDisplays is not null, "desktop-topology", "The displays changed again. Reapplying the layout.");
    var editorId = args.GetProperty("editorViewId");
    var editing = editorId.ValueKind == JsonValueKind.Null ? null : views.FirstOrDefault(v => !v.Retired && v.Id == editorId.GetString());
    HostError.Require(editorId.ValueKind == JsonValueKind.Null || editing is not null, "desktop-view", "The editing window was disconnected. Keep your last input.");
    var editorRect = editing is null ? null : DesktopFrame.Rect(args.GetProperty("editorRect"));
    var next = proposedDisplays!; var unit = Unit(next); var assignments = new List<(SceneView View, DisplayInfo Display)>();
    if (NativeDisplays.Describe(next) != NativeDisplays.Describe(displays)) note?.Invoke($"displays applying topology={requested}");
    if (editing is not null)
    {
      static double Overlap(LogicalRect a, LogicalRect b) => Math.Max(0, Math.Min(a.X + a.Width, b.X + b.Width) - Math.Max(a.X, b.X))
        * Math.Max(0, Math.Min(a.Y + a.Height, b.Y + b.Height) - Math.Max(a.Y, b.Y));
      var destination = next.OrderByDescending(d => Overlap(editorRect!, new(d.Bounds.X / unit, d.Bounds.Y / unit, d.Bounds.Width / unit, d.Bounds.Height / unit)))
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
        HostError.Require(views.Count(v => !v.Retired) < 48, "desktop-capacity", "Too many desktop windows are open. Restart Work Fleet to show them again; your data is kept.");
        match = new(slot.Display, slot.Layer, unit); views.Add(match); Watch(match);
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
        view.Viewport = new(view.Display.Bounds.X / unit, view.Display.Bounds.Y / unit, view.Display.Bounds.Width / unit, view.Display.Bounds.Height / unit);
        if (view.Initialized)
        {
          view.Surface.SetShellParent(view.Layer == "wallpaper" ? shell.Wallpaper : view.Layer == "desktop" ? shell.Desktop : IntPtr.Zero);
          view.Surface.Show(view.Layer == "floating"); view.Surface.Hide();
          view.Surface.SetPhysicalBounds(view.Display.Bounds);
          if (view.Surface.WebView.CoreWebView2 is not null) view.Surface.WebView.ZoomFactor = unit / (view.Surface.Dpi / 96d);
        }
      }
    }
    // Scale follows the primary display, as a restart on these displays would set it; placements keep their logical values.
    displays = next; scale = unit; topology = requested; displayPending = false;
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
        HostError.Require(values.ValueKind == JsonValueKind.Array && values.GetArrayLength() <= 32, "shortcut-settings", "This device allows at most 32 shortcuts.");
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
      case "desktop.focusEditor":
      {
        var id = JsonRules.Text(args, "viewId", 64); var sequence = JsonRules.Integer(args, "sequence");
        if (DateTime.UtcNow - editRequested > TimeSpan.FromSeconds(5) || !views.Any(v => v.Id == id && v.Layer == "floating" && !v.Retired)) return new { accepted = false };
        editorFocus = (id, sequence);
        foreach (var view in views.Where(v => v.Id == id)) TryFocusEditor(view);
        return new { accepted = true };
      }
      case "desktop.hideMain":
        HostError.Require(hideMain?.Invoke() == true, "tray-unavailable", "The tray isn't available right now, so the main window stays open."); return null;
      case "desktop.mainVisible":
      {
        // The owner asks only for a main window that had the focus as adjust mode began. Minimized, it keeps its place;
        // only the window minimized here comes back, in the state it had.
        var visible = args.GetProperty("visible").GetBoolean();
        if (mainWindow is null) return null;
        if (visible) { if (mainAside is { } state) { mainAside = null; mainWindow.WindowState = state; mainWindow.Activate(); } }
        else if (mainAside is null && mainWindow.IsVisible && mainWindow.WindowState != WindowState.Minimized)
        {
          mainAside = mainWindow.WindowState; mainWindow.WindowState = WindowState.Minimized;
        }
        return null;
      }
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
        var pending = Pending(args); HostError.Require(pending.Upload is not null, "scene-missing", "This command has no large input.");
        return transfers.Read(pending.View.Id, pending.Upload!, Size(args, SceneTransfers.MaxCommand, "offset"));
      }
      case "desktop.reply":
      {
        var ticket = JsonRules.Text(args, "ticket"); var pending = Pending(args);
        HostError.Require(args.GetProperty("ok").ValueKind is JsonValueKind.True or JsonValueKind.False, "scene-command", "The desktop reply is malformed.");
        var ok = args.GetProperty("ok").GetBoolean();
        var result = args.TryGetProperty("result", out var value) ? value.Clone() : (JsonElement?)null;
        var error = args.TryGetProperty("error", out value) ? value.Clone() : (JsonElement?)null;
        HostError.Require(args.GetRawText().Length <= 64 * 1024, "scene-size", "The desktop reply is too large.");
        Post(pending.View, new { v = 1, @event = "desktop-command-result", commandId = pending.Id, ok, result, error });
        Release(ticket, pending); return null;
      }
      case "desktop.flush":
      {
        var view = View(JsonRules.Text(args, "viewId")); var id = JsonRules.Text(args, "id"); var draft = JsonRules.Text(args, "draftId");
        HostError.Require(id.Length == 36 && Guid.TryParseExact(id, "D", out _) && flushes.Count < 4 && !flushes.ContainsKey(id), "scene-busy", "A desktop draft is still being saved.");
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
        // `hidden` tells quick capture that the window was in the tray, so closing the editor puts it back there.
        var hidden = false;
        if (accepted) { activation = null; focusSequence = null; hidden = showMain(); }
        return new { activated = accepted, hidden };
      }
      default: throw new HostError("unsupported-method", "The desktop host doesn't support this operation.");
    }
  }

  private async Task Start()
  {
    if (Held()) return;
    foreach (var view in views.Where(v => v.Active && !v.Retired && !v.Initialized).ToArray())
    {
      if (disposed) return;
      try { await Initialize(view); }
      catch { Retire(view, HostText.Get("desktop.sceneStartFailed")); }
    }
  }
  // ADR-046: no scene window exists while held, so a display change cannot reach one inside Explorer.
  private bool Held()
  {
    if (!holding || disposed) return false;
    BuiltInDisplays state; var readable = true;
    try { state = builtInOverride?.Invoke() ?? NativeDisplays.ReadBuiltIn(displayWatcher.LidClosed); }
    catch (InvalidOperationException) { state = new(displayWatcher.LidClosed, false, false); readable = false; }
    var now = DateTime.UtcNow; var sinceChange = now - displaysChangedAt;
    var hold = SignInDisplays.Check(state.LidClosed, state.BuiltInOn, state.OtherOn, sinceChange, now - created);
    // On 2026-10-15 the hold let the scenes in at once and host.log could not say why; record what it saw.
    var inputs = SignInDisplays.Describe(state.LidClosed, readable ? state.BuiltInOn : null, readable ? state.OtherOn : null, sinceChange);
    if (hold.Waiting)
    {
      if (hold.Reason != holdReason) { holdReason = hold.Reason; note?.Invoke($"scenes waiting: {hold.Reason}; {inputs}"); }
      if (holdTimer is null)
      {
        holdTimer = new DispatcherTimer(DispatcherPriority.Background) { Interval = TimeSpan.FromSeconds(1) };
        holdTimer.Tick += (_, _) => Release(); holdTimer.Start();
      }
      return true;
    }
    holding = false; holdTimer?.Stop();
    note?.Invoke(FormattableString.Invariant($"scenes attaching after {(now - created).TotalSeconds:0.0}s") + (hold.Expired ? $" although {hold.Reason}" : "") + $"; {inputs}");
    return false;
  }
  /// <summary>Each lid state Windows reports, starting with the one it sends at registration.</summary>
  private void NoteLid() => note?.Invoke($"lid {(displayWatcher.LidClosed == true ? "closed" : "open")}");
  private void Release()
  {
    if (holding && started && !disposed && !Held()) _ = Start();
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
    // Two fingers on a paper must not zoom the whole scene.
    core.Settings.IsPinchZoomEnabled = false;
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
    core.ProcessFailed += (_, _) => Retire(view, HostText.Get("desktop.sceneStopped"));
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
      HostError.Require(id.Length == 36 && Guid.TryParseExact(id, "D", out _) && JsonRules.Integer(request, "v") == 1, "scene-command", "The desktop protocol is invalid.");
      var method = JsonRules.Text(request, "method"); var args = request.GetProperty("params");
      HostError.Require(args.ValueKind == JsonValueKind.Object, "scene-command", "The desktop parameters are invalid.");
      return JsonSerializer.Serialize(new { v = 1, id, ok = true, result = InvokeScene(view, method, args) });
    }
    catch (Exception error)
    {
      return JsonSerializer.Serialize(new { v = 1, id, ok = false,
        error = new { code = (error as HostError)?.Code ?? "scene-command", message = (error as HostError)?.Message ?? "The desktop operation didn't finish. Keep your unsaved text." } });
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
      {
        view.Ready = true;
        // Initial navigation and display updates must advertise the same per-view capabilities.
        var info = ViewInfo(view);
        info["sessionId"] = SessionId; info["topology"] = topology; info["prepareFrames"] = true; info["bindings"] = BindingMap();
        return info;
      }
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
      case "scene.prepare":
      {
        if (displayPending || !view.Active || view.Downloading?.Topology != topology || JsonRules.Integer(args, "topology") != topology) return new { accepted = false };
        HostError.Require(view.Downloading?.Sequence == JsonRules.Integer(args, "sequence"), "scene-order", "The desktop frame isn't ready to update.");
        var next = view.Downloading!.Cards.Where(c => c.Layer == view.Layer && Intersects(c.Rect, view.Viewport)).ToArray();
        // An Explorer-attached surface paints the WebView's white background wherever its browser erases a paper inside
        // the old opaque region, and that white can remain in the shell surface. A paper that moves or resizes there
        // hides the surface first. A paper that only leaves or arrives, as one riding the Top layer for a quick move or
        // edit does, keeps the others shown and the pointer held: the region drops what leaves now, and scene.applied
        // adds what arrives once the browser has drawn it.
        if (view.Layer != "floating" && view.Surface.Shown && !view.Presented.Select(c => c.Rect).SequenceEqual(next.Select(c => c.Rect)))
        {
          var before = new Dictionary<string, LogicalRect>(StringComparer.Ordinal);
          foreach (var card in view.Presented) before[card.Id] = card.Rect;
          if (next.Any(c => before.TryGetValue(c.Id, out var rect) && rect != c.Rect)) view.Surface.Hide();
          else view.Surface.SetInput(HitRects(view, next.Where(c => before.ContainsKey(c.Id))));
        }
        return new { accepted = true };
      }
      case "scene.applied":
      {
        var sequence = JsonRules.Integer(args, "sequence");
        if (displayPending || !view.Active || view.Downloading?.Topology != topology || JsonRules.Integer(args, "topology") != topology) return new { accepted = false };
        HostError.Require(view.Downloading?.Sequence == sequence && sequence >= view.Applied, "scene-order", "The desktop input regions don't match the frame on screen yet.");
        var cards = view.Downloading!.Cards.Where(c => c.Layer == view.Layer).ToArray();
        var zoom = Zoom(view);
        // The adjust overlay takes the clicks on its whole screen, so nothing below reacts while adjusting.
        var adjusting = view.Layer == "floating" && view.Downloading.Adjusting;
        view.Surface.SetInput(adjusting ? new[] { new SceneHitRect(0, 0, view.Viewport.Width * zoom, view.Viewport.Height * zoom, true) }
          : HitRects(view, cards.Where(c => Intersects(c.Rect, view.Viewport))));
        var wasShown = view.Surface.Shown;
        // A quick edit that closed here gives the foreground back before an emptied scene hides.
        var editingHere = view.Layer == "floating" && !adjusting && view.Downloading.EditorView == view.Id;
        if (view.Editing && !editingHere) ReturnEditorFocus(view);
        view.Editing = editingHere;
        var notice = view.Layer == "floating" && view.Downloading.Notice is { } rect && Intersects(rect, view.Viewport);
        // An attached scene whose only paper rides the Top layer for a quick move keeps the pointer, so it stays shown,
        // with an empty region, until the release.
        var holding = view.Layer != "floating" && view.QuickHeld && view.Surface.Shown;
        if (adjusting || notice || holding || cards.Any(c => Intersects(c.Rect, view.Viewport))) view.Surface.Show(view.Layer == "floating"); else view.Surface.Hide();
        view.Presented = cards.Where(c => Intersects(c.Rect, view.Viewport)).ToArray();
        view.Applied = sequence; TryFocus(view); TryFocusEditor(view);
        if (!wasShown && view.Surface.Shown) { view.Surface.PassBrowserClicksThrough(); Repaint(view); }
        // Keys such as Esc reach the overlay as it appears.
        if (adjusting && !view.Adjusting && view.Surface.InputWindow.Activate()) { view.Surface.WebView.Focus(); Post(view, new { v = 1, @event = "desktop-focus" }); }
        view.Adjusting = adjusting;
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
          "scene-command", "The desktop command session is invalid.");
        HostError.Require(commandMethod is "pointer.down" or "pointer.move" or "pointer.up" or "pointer.cancel" or "card.select" or "card.edit"
          or "card.transfer" or "card.check" or "editor.change" or "editor.save" or "editor.end" or "editor.full" or "editor.cancel" or "interaction.escape" or "interaction.shortcut"
          or "interaction.done" or "layout.arrange" or "attachment.preview" or "attachment.open",
          "unsupported-method", "The desktop host doesn't support this operation.");
        var draft = commandMethod == "editor.change";
        if (commandMethod == "card.edit") editRequested = DateTime.UtcNow;
        if (commandMethod == "pointer.down") view.QuickHeld = command.TryGetProperty("args", out var down) && down.ValueKind == JsonValueKind.Object
          && down.TryGetProperty("quick", out var quick) && quick.ValueKind == JsonValueKind.True;
        else if (commandMethod is "pointer.up" or "pointer.cancel") view.QuickHeld = false;
        var commandTopology = JsonRules.Integer(args, "topology");
        HostError.Require(draft || !displayPending && view.Active && commandTopology == topology, "desktop-topology", "Desktop positions are updating. Wait a moment and try again; your text is kept.");
        HostError.Require(commands.Values.Count(c => c.Draft == draft) < (draft ? 4 : 24), "scene-busy", "A desktop operation is still in progress.");
        HostError.Require(!commands.Values.Any(c => c.View == view && c.Id == id), "scene-busy", "This desktop operation was already sent.");
        var ticket = Guid.NewGuid().ToString(); commands.Add(ticket, new(view, id, upload, draft, DateTime.UtcNow));
        string? intent = null;
        if (commandMethod is "editor.full" or "interaction.shortcut" && args.TryGetProperty("intent", out var tokenIntent)
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
        HostError.Require(flushes.TryGetValue(id, out var pending) && pending.View == view && pending.Draft == JsonRules.Text(args, "draftId"), "scene-flush", "The draft save request has expired.");
        var ok = args.GetProperty("ok").GetBoolean(); var sequence = JsonRules.Integer(args, "sequence");
        flushes.Remove(id); sendOwner(new { v = 1, @event = "desktop-flushed", id, viewId = view.Id, draftId = pending.Draft, ok, sequence }); return null;
      }
      default: throw new HostError("unsupported-method", "Desktop surfaces can't use storage or system operations.");
    }
  }
  private double Zoom(SceneView view) => scale / (view.Surface.Dpi / 96d);
  // Back to front, in the view's physical pixels.
  private IEnumerable<SceneHitRect> HitRects(SceneView view, IEnumerable<PresentedCard> cards)
  {
    var zoom = Zoom(view);
    return cards.Select(c =>
    {
      // Native region limits apply to the clipped viewport, not to persisted paper geometry.
      var x = Math.Max(c.Rect.X, view.Viewport.X); var y = Math.Max(c.Rect.Y, view.Viewport.Y);
      var right = Math.Min(c.Rect.X + c.Rect.Width, view.Viewport.X + view.Viewport.Width);
      var bottom = Math.Min(c.Rect.Y + c.Rect.Height, view.Viewport.Y + view.Viewport.Height);
      return new SceneHitRect((x - view.Viewport.X) * zoom, (y - view.Viewport.Y) * zoom, (right - x) * zoom, (bottom - y) * zoom, view.Layer != "wallpaper" && c.Interactive);
    }).ToArray();
  }
  private static bool Intersects(LogicalRect a, LogicalRect b) => a.X < b.X + b.Width && a.X + a.Width > b.X && a.Y < b.Y + b.Height && a.Y + a.Height > b.Y;
  private void TryFocusEditor(SceneView view)
  {
    if (editorFocus is not { } focus || focus.View != view.Id || displayPending || !view.Active || view.Retired || !view.Ready
      || view.Applied < focus.Sequence || !view.Surface.Shown) return;
    // Opening another paper in a scene that already has the keyboard keeps the window to give it back to.
    var foreground = GetForegroundWindow(); editorFocus = null;
    if (foreground != new System.Windows.Interop.WindowInteropHelper(view.Surface.InputWindow).Handle) editorReturn = foreground;
    if (view.Surface.InputWindow.Activate()) { view.Surface.WebView.Focus(); Post(view, new { v = 1, @event = "desktop-focus" }); }
  }
  // Only while the closed editor's scene still has the keyboard, so a window the user chose meanwhile keeps it.
  private void ReturnEditorFocus(SceneView view)
  {
    var target = editorReturn; editorReturn = IntPtr.Zero;
    if (target != IntPtr.Zero && IsWindow(target) && GetForegroundWindow() == new System.Windows.Interop.WindowInteropHelper(view.Surface.InputWindow).Handle) SetForegroundWindow(target);
  }
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
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
  private SceneView View(string id) => views.FirstOrDefault(v => v.Id == id && v.Ready && !v.Retired) ?? throw new HostError("desktop-view", "The desktop window is closed or not ready yet.");
  private PendingCommand Pending(JsonElement args) => commands.TryGetValue(JsonRules.Text(args, "ticket"), out var value) ? value : throw new HostError("scene-command", "The desktop operation has expired.");
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
    holdTimer?.Stop(); displayWatcher.LidChanged -= NoteLid; displayWatcher.LidChanged -= Release; displayWatcher.Dispose(); activity.Dispose(); shortcuts.Dispose();
    shellWatcher.Stop(); shellWatcher.Tick -= CheckShell;
    foreach (var view in views) view.Surface.Dispose(); transfers.Dispose(); commands.Clear(); flushes.Clear(); frozen.Clear(); sceneIntents.Clear();
  }
}
