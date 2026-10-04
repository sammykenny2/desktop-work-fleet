using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

/// <summary>Local management/editor window. Desktop presentation is a separate platform surface.</summary>
public sealed class FleetWindow : Window
{
  private readonly WebView2 web = new();
  private readonly LocalDatabase database;
  private readonly NativeBackupFiles backupFiles;
  private readonly string dataDirectory;
  private readonly Func<string?>? backupDirectoryPicker;
  private BridgeSession? bridge;
  private DesktopCoordinator? desktop;
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
    this.backupDirectoryPicker = backupDirectoryPicker;
    this.desktopDisplays = desktopDisplays;
    database = new LocalDatabase(this.dataDirectory, "local");
    backupFiles = new NativeBackupFiles(database);
    Title = "Work Fleet"; Width = 1180; Height = 800; MinWidth = 380; MinHeight = 520;
    Content = web; WindowStartupLocation = WindowStartupLocation.CenterScreen;
    Loaded += async (_, _) =>
    {
      try { await Initialize(); }
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
    Closed += (_, _) => { desktop?.Dispose(); web.Dispose(); bridge?.Dispose(); backupFiles.Dispose(); database.Dispose(); };
  }
  private async Task Initialize()
  {
    var assets = Path.Combine(AppContext.BaseDirectory, "Assets");
    if (!File.Exists(Path.Combine(assets, "app", "index.html"))) throw new IOException("Missing packaged assets.");
    var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDirectory, "webview"));
    await web.EnsureCoreWebView2Async(environment); var core = web.CoreWebView2;
    core.SetVirtualHostNameToFolderMapping(NavigationPolicy.Host, assets, CoreWebView2HostResourceAccessKind.Deny);
    core.Settings.AreHostObjectsAllowed = false; core.Settings.AreDevToolsEnabled = false;
    core.Settings.IsStatusBarEnabled = false; core.Settings.AreBrowserAcceleratorKeysEnabled = false;
    core.Settings.IsBuiltInErrorPageEnabled = false;
    core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
    core.FrameNavigationStarting += (_, e) => e.Cancel = true;
    core.NewWindowRequested += (_, e) => { e.Handled = true; if (e.IsUserInitiated) OpenExternal(e.Uri); };
    core.NavigationStarting += (_, e) =>
    {
      if (!NavigationPolicy.IsDocument(e.Uri)) { e.Cancel = true; if (e.IsUserInitiated) OpenExternal(e.Uri); return; }
      navigation++; bridge?.Dispose(); desktop?.Dispose();
      var epoch = navigation;
      desktop = new DesktopCoordinator(environment, value =>
      {
        if (epoch == navigation && !shuttingDown && NavigationPolicy.IsDocument(core.Source)) core.PostWebMessageAsJson(JsonSerializer.Serialize(value));
      }, () => { Show(); if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal; Activate(); }, OpenExternal, desktopDisplays);
      bridge = new BridgeSession(database, backupFiles, ChooseBackupDirectory, desktop.Invoke);
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
      var session = bridge; var epoch = navigation; queued++;
      messageQueue = HandleMessage(messageQueue, session, epoch, json);
    };
    core.ProcessFailed += (_, _) =>
    {
      // Keep the native store alive. A new document must reopen from committed state.
      navigation++; bridge?.Dispose(); bridge = null; desktop?.Dispose(); desktop = null;
      Content = new TextBlock { Text = "畫面程序已停止。已提交資料仍保留於本機；請重新開啟 Work Fleet。",
        TextWrapping = TextWrapping.Wrap, Margin = new Thickness(32) };
    };
    core.DownloadStarting += (_, e) => { e.Handled = false; };
    core.Navigate(NavigationPolicy.Document);
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
}
