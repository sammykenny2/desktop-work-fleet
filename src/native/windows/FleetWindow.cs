using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

/// <summary>Local management/editor window. Desktop presentation is a separate platform surface.</summary>
public sealed class FleetWindow : Window
{
  private readonly WebView2 web = new();
  private LocalDatabase database;
  private NativeBackupFiles backupFiles;
  private NativeGoogle? google;
  private readonly string dataDirectory;
  private readonly CoreWebView2EnvironmentOptions? webViewOptions;
  private readonly Func<string?>? backupDirectoryPicker;
  private BridgeSession? bridge;
  private DesktopCoordinator? desktop;
  private NativeTray? tray;
  private readonly IReadOnlyList<DisplayInfo>? desktopDisplays;
  private Task messageQueue = Task.CompletedTask;
  private int queued;
  private long navigation;
  private bool shuttingDown;
  public WebView2 WebView => web;
  public DesktopCoordinator? Desktop => desktop;

  public FleetWindow(string dataDirectory, Func<string?>? backupDirectoryPicker = null, IReadOnlyList<DisplayInfo>? desktopDisplays = null)
  {
    this.dataDirectory = Path.GetFullPath(dataDirectory);
    // Reject a bad Debug port before the database takes the single-owner lock.
    webViewOptions = WebViewDiagnostics.EnvironmentOptions();
    this.backupDirectoryPicker = backupDirectoryPicker;
    this.desktopDisplays = desktopDisplays;
    var selected = Path.Combine(this.dataDirectory, "profile.txt");
    var profile = File.Exists(selected) ? File.ReadAllText(selected).Trim() : "local";
    if (profile != "local" && !System.Text.RegularExpressions.Regex.IsMatch(profile, "^google:[A-Za-z0-9_-]{1,255}$")) profile = "local";
    database = new LocalDatabase(this.dataDirectory, profile);
    backupFiles = new NativeBackupFiles(database);
    Title = "Work Fleet"; Width = 1180; Height = 800; MinWidth = 380; MinHeight = 520;
    Content = web; WindowStartupLocation = WindowStartupLocation.CenterScreen;
    Loaded += async (_, _) =>
    {
      try
      {
        tray = new NativeTray(TrayAction); tray.Changed += () => { if (!tray.Available) ShowMain(false); };
        tray.MenuActive += active => desktop?.MenuActive(active); await Initialize();
      }
      catch
      {
        Content = new TextBlock { Text = "無法開啟原生工作空間。請確認 WebView2 Runtime 已安裝，並保留原資料後重試。",
          TextWrapping = TextWrapping.Wrap, Margin = new Thickness(32) };
      }
    };
    Closing += (_, e) =>
    {
      if (shuttingDown) return;
      e.Cancel = true;
      // Ask the actual document to flush its current draft before destroying the native coordinator.
      // Defer even when no work is pending: WPF forbids a second Close inside Closing.
      Dispatcher.BeginInvoke(new Action(() => { _ = PrepareClose(); }));
    };
    Closed += (_, _) => { tray?.Dispose(); google?.Dispose(); desktop?.Dispose(); web.Dispose(); bridge?.Dispose(); backupFiles.Dispose(); database.Dispose(); };
  }
  private void ShowMain() => ShowMain(true);
  private void ShowMain(bool activate)
  {
    var previous = ShowActivated; ShowActivated = activate; Show(); ShowActivated = previous;
    if (WindowState == WindowState.Minimized)
    {
      if (activate) WindowState = WindowState.Normal;
      else _ = ShowWindow(new System.Windows.Interop.WindowInteropHelper(this).Handle, 4); // SW_SHOWNOACTIVATE
    }
    if (activate) Activate();
  }
  private void TrayAction(string action, ForegroundIntent intent)
  {
    if (shuttingDown) return;
    if (action == "show") ShowMain(intent.Current);
    else if (action == "exit") { ShowMain(intent.Current); Close(); }
    else desktop?.DispatchAction(action, intent);
  }
  private async Task Initialize()
  {
    var assets = Path.Combine(AppContext.BaseDirectory, "Assets");
    if (!File.Exists(Path.Combine(assets, "app", "index.html"))) throw new IOException("Missing packaged assets.");
    var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDirectory, "webview"), webViewOptions);
    await web.EnsureCoreWebView2Async(environment); var core = web.CoreWebView2;
    core.SetVirtualHostNameToFolderMapping(NavigationPolicy.Host, assets, CoreWebView2HostResourceAccessKind.Deny);
    core.Settings.AreHostObjectsAllowed = false; core.Settings.AreDevToolsEnabled = WebViewDiagnostics.DevToolsEnabled;
    core.Settings.IsStatusBarEnabled = false; core.Settings.AreBrowserAcceleratorKeysEnabled = false;
    core.Settings.IsBuiltInErrorPageEnabled = false;
    core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
    core.FrameNavigationStarting += (_, e) => e.Cancel = true;
    core.NewWindowRequested += (_, e) => { e.Handled = true; if (e.IsUserInitiated) OpenExternal(e.Uri); };
    core.NavigationStarting += (_, e) =>
    {
      if (!NavigationPolicy.IsDocument(e.Uri)) { e.Cancel = true; if (e.IsUserInitiated) OpenExternal(e.Uri); return; }
      navigation++; google?.Dispose(); bridge?.Dispose(); desktop?.Dispose();
      google = new NativeGoogle(dataDirectory, database.ProfileId);
      var epoch = navigation;
      desktop = new DesktopCoordinator(environment, value =>
      {
        if (epoch == navigation && !shuttingDown && NavigationPolicy.IsDocument(core.Source)) core.PostWebMessageAsJson(JsonSerializer.Serialize(value));
      }, ShowMain, OpenExternal, desktopDisplays, this, () => { if (tray?.Available != true) return false; Hide(); return true; });
      bridge = new BridgeSession(database, backupFiles, ChooseBackupDirectory, desktop.Invoke, google.Available);
    };
    core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
    core.WebResourceRequested += (_, e) =>
    {
      if (!NavigationPolicy.IsAsset(e.Request.Uri) || e.Request.Method is not ("GET" or "HEAD"))
        e.Response = environment.CreateWebResourceResponse(Stream.Null, 403, "Blocked", "Content-Type: text/plain\r\nCache-Control: no-store");
    };
    core.WebMessageReceived += (_, e) =>
    {
      if (!NavigationPolicy.IsDocument(e.Source) || !NavigationPolicy.IsDocument(core.Source) || bridge is null || queued >= 32) return;
      var json = e.WebMessageAsJson;
      if (json.Length > BridgeSession.MaxMessage) return;
      // Capture a local foreground intent at admission, never after a slow storage transaction.
      if (TryIntent(json, out var captured)) { core.PostWebMessageAsJson(captured!); return; }
      var session = bridge; var epoch = navigation; queued++;
      if (IsGoogleRequest(json)) { _ = HandleGoogle(session, epoch, json); return; }
      messageQueue = HandleMessage(messageQueue, session, epoch, json);
    };
    core.ProcessFailed += (_, _) =>
    {
      // Keep the native store alive. A new document must reopen from committed state.
      navigation++; google?.Dispose(); bridge?.Dispose(); bridge = null; desktop?.Dispose(); desktop = null;
      ShowMain(false);
      Content = new TextBlock { Text = "畫面程序已停止。已提交資料仍保留於本機；請重新開啟 Work Fleet。",
        TextWrapping = TextWrapping.Wrap, Margin = new Thickness(32) };
    };
    core.DownloadStarting += (_, e) => { e.Handled = false; };
    core.Navigate(NavigationPolicy.Document);
  }
  private bool TryIntent(string json, out string? result)
  {
    result = null;
    try
    {
      if (json.Length > 512 || desktop is null || shuttingDown) return false;
      using var document = JsonRules.Parse(Encoding.UTF8.GetBytes(json)); var value = document.RootElement;
      if (value.ValueKind != JsonValueKind.Object || JsonRules.Text(value, "method") != "desktop.intent") return false;
      var id = JsonRules.Text(value, "id");
      if (!Guid.TryParseExact(id, "D", out _) || JsonRules.Integer(value, "v") != 1
        || value.GetProperty("params").ValueKind != JsonValueKind.Object || value.GetProperty("params").EnumerateObject().Any()) return false;
      result = JsonSerializer.Serialize(new { v = 1, id, ok = true, result = new { intent = desktop.CaptureIntent(this) } }); return true;
    }
    catch (Exception error) when (error is JsonException or HostError or InvalidOperationException or KeyNotFoundException) { return false; }
  }
  private static bool IsGoogleRequest(string json)
  {
    try { using var value = JsonRules.Parse(Encoding.UTF8.GetBytes(json)); return JsonRules.Text(value.RootElement, "method").StartsWith("google.", StringComparison.Ordinal); }
    catch { return false; }
  }
  private async Task HandleGoogle(BridgeSession session, long epoch, string json)
  {
    string? id = null; string? switchTo = null; string reply;
    try
    {
      using var document = JsonRules.Parse(Encoding.UTF8.GetBytes(json)); var request = document.RootElement;
      id = JsonRules.Text(request, "id"); var method = JsonRules.Text(request, "method"); var args = request.GetProperty("params");
      HostError.Require(Guid.TryParseExact(id, "D", out _) && JsonRules.Integer(request, "v") == 1 && args.ValueKind == JsonValueKind.Object && epoch == navigation && !shuttingDown && google is not null,
        "stale-session", "Google 工作階段已結束。");
      var service = google!; object? result;
      switch (method)
      {
        case "google.status": result = service.Status(); break;
        case "google.signIn": result = await service.SignIn(); break;
        case "google.open": switchTo = service.OpenAccount(JsonRules.Text(args, "accountId")); result = new { profileId = switchTo }; break;
        case "google.signOut": await service.SignOut(); switchTo = "local"; result = new { profileId = switchTo }; break;
        case "google.local": switchTo = "local"; result = new { profileId = switchTo }; break;
        default: result = await service.Drive(method, args, session); break;
      }
      reply = JsonSerializer.Serialize(new { v = 1, id, ok = true, result });
    }
    catch (Exception error)
    {
      reply = JsonSerializer.Serialize(new { v = 1, id, ok = false, error = new { code = (error as HostError)?.Code ?? "google-unavailable",
        message = (error as HostError)?.Message ?? "Google 連線暫時無法完成，本機資料仍保留。" } });
      switchTo = null;
    }
    finally { queued--; }
    if (epoch != navigation || shuttingDown || !NavigationPolicy.IsDocument(web.CoreWebView2.Source)) return;
    web.CoreWebView2.PostWebMessageAsJson(reply);
    if (switchTo is not null)
    {
      var profile = switchTo;
      _ = Dispatcher.BeginInvoke(new Action(() => { if (epoch == navigation && !shuttingDown) SwitchProfile(profile); }));
    }
  }
  private void SwitchProfile(string profile)
  {
    google?.Dispose(); bridge?.Dispose(); desktop?.Dispose(); backupFiles.Dispose(); database.Dispose();
    try
    {
      database = new LocalDatabase(dataDirectory, profile); backupFiles = new NativeBackupFiles(database);
      var marker = Path.Combine(dataDirectory, "profile.txt"); var temporary = marker + "." + Guid.NewGuid() + ".tmp";
      using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
      { stream.Write(Encoding.UTF8.GetBytes(profile)); stream.Flush(true); }
      File.Move(temporary, marker, true); web.CoreWebView2.Navigate(NavigationPolicy.Document);
    }
    catch
    {
      Content = new TextBlock { Text = "帳號切換未完成。已保存資料仍保留，請重新開啟 Work Fleet。", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(32) };
    }
  }
  private string? ChooseBackupDirectory() => Dispatcher.Invoke(() =>
  {
    if (backupDirectoryPicker is not null) return backupDirectoryPicker();
    var picker = new Microsoft.Win32.OpenFolderDialog { Title = "選擇備份資料夾（本機 NTFS；每次建立新檔）", Multiselect = false };
    return picker.ShowDialog(this) == true ? picker.FolderName : null;
  });
  private async Task HandleMessage(Task previous, BridgeSession session, long epoch, string json)
  {
    try
    {
      await previous;
      if (epoch != navigation || shuttingDown) return;
      // Modal OS pickers run on this dispatcher. Never invoke it from a worker holding the session lock.
      var result = IsUiRequest(json) ? session.Dispatch(json) : await Task.Run(() => session.Dispatch(json));
      if (epoch == navigation && !shuttingDown && NavigationPolicy.IsDocument(web.CoreWebView2.Source)) web.CoreWebView2.PostWebMessageAsJson(result);
      if (session.CloseReady && closeRequested && epoch == navigation) { shuttingDown = true; Close(); }
    }
    catch { /* A destroyed view cannot acknowledge a durable commit. Reopen reads the transaction. */ }
    finally { queued--; }
  }
  private static bool IsUiRequest(string json)
  {
    try
    {
      using var document = JsonDocument.Parse(json);
      return document.RootElement.ValueKind == JsonValueKind.Object && document.RootElement.TryGetProperty("method", out var value)
        && value.ValueKind == JsonValueKind.String && (value.GetString() is "backup.choose" or "backup.manual.choose" || value.GetString()!.StartsWith("desktop.", StringComparison.Ordinal));
    }
    catch (JsonException) { return false; }
  }
  private bool closing;
  private bool closeRequested;
  private async Task PrepareClose()
  {
    if (closing || shuttingDown) return; closing = true;
    try
    {
      if (bridge?.Ready == true && web.CoreWebView2 is not null && NavigationPolicy.IsDocument(web.CoreWebView2.Source))
      {
        // The reply arrives through the regular authenticated bridge only after all pending saves settle.
        closeRequested = true; web.CoreWebView2.PostWebMessageAsJson("{\"v\":1,\"event\":\"host-close-requested\"}");
        return;
      }
      await messageQueue; shuttingDown = true; Close();
    }
    finally { closing = false; }
  }
  private static void OpenExternal(string uri)
  {
    if (!NavigationPolicy.IsExternal(uri)) return;
    try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch { }
  }
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
}
