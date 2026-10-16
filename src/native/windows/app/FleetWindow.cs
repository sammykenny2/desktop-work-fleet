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
  private readonly Func<BuiltInDisplays>? desktopBuiltIn;
  private readonly HostShell? shell;
  private readonly MainWindowPlacement? placement;
  private readonly NativeUpdater? updater;
  private string? installPath;
  private bool installRequested;
  /// <summary>The second-launch channel, closed before an update replaces this process.</summary>
  public SingleInstance? Instance { get; set; }
  // A sign-in launch first shows the window far off-screen so WPF loads it, then hides it once the page is loaded.
  private bool offscreen;
  private Task messageQueue = Task.CompletedTask;
  private int queued;
  private long navigation;
  private bool shuttingDown;
  public WebView2 WebView => web;
  public DesktopCoordinator? Desktop => desktop;

  public FleetWindow(string dataDirectory, Func<string?>? backupDirectoryPicker = null, IReadOnlyList<DisplayInfo>? desktopDisplays = null, HostShell? shell = null,
    Func<BuiltInDisplays>? desktopBuiltIn = null)
  {
    this.dataDirectory = Path.GetFullPath(dataDirectory);
    // Reject a bad Debug port before the database takes the single-owner lock.
    webViewOptions = WebViewDiagnostics.EnvironmentOptions();
    this.backupDirectoryPicker = backupDirectoryPicker;
    this.desktopDisplays = desktopDisplays; this.desktopBuiltIn = desktopBuiltIn;
    var selected = Path.Combine(this.dataDirectory, "profile.txt");
    var profile = File.Exists(selected) ? File.ReadAllText(selected).Trim() : "local";
    if (profile != "local" && !System.Text.RegularExpressions.Regex.IsMatch(profile, "^google:[A-Za-z0-9_-]{1,255}$")) profile = "local";
    database = new LocalDatabase(this.dataDirectory, profile);
    backupFiles = new NativeBackupFiles(database);
    Title = "Work Fleet"; Width = 1180; Height = 800; MinWidth = 380; MinHeight = 520;
    Content = web; WindowStartupLocation = WindowStartupLocation.CenterScreen;
    this.shell = shell;
    if (shell is not null)
    {
      WindowStartupLocation = WindowStartupLocation.Manual; placement = new MainWindowPlacement(this, this.dataDirectory);
      if (shell.StartHidden) { offscreen = true; Left = -20000; Top = -20000; ShowInTaskbar = false; ShowActivated = false; }
      if (Application.Current is { } application) application.SessionEnding += (_, _) => placement.Flush();
      updater = new NativeUpdater(this.dataDirectory, shell.Preferences.LastUpdateCheck, PublishUpdate, shell.RecordUpdateCheck);
    }
    Loaded += async (_, _) =>
    {
      try
      {
        // How long the tray takes at sign-in is the evidence for trayWaitSeconds in config/startup.json.
        tray = new NativeTray(TrayAction, updater?.Capable == true); Log($"tray available={tray.Available} uptime={Uptime()}");
        tray.Changed += () => { Log($"tray available={tray.Available} uptime={Uptime()}"); if (!tray.Available) ShowMain(false); };
        tray.MenuActive += active => desktop?.MenuActive(active); await Initialize();
      }
      catch
      {
        Content = new TextBlock { Text = "無法開啟原生工作空間。請確認 WebView2 Runtime 已安裝，並保留原資料後重試。",
          TextWrapping = TextWrapping.Wrap, Margin = new Thickness(32) };
      }
      finally { FinishStart(); }
    };
    Closing += (_, e) =>
    {
      if (shuttingDown) return;
      e.Cancel = true;
      // Ask the actual document to flush its current draft before destroying the native coordinator.
      // Defer even when no work is pending: WPF forbids a second Close inside Closing.
      Dispatcher.BeginInvoke(new Action(() => { _ = PrepareClose(); }));
    };
    SourceInitialized += (_, _) =>
    {
      System.Windows.Interop.HwndSource.FromHwnd(new System.Windows.Interop.WindowInteropHelper(this).Handle)?.AddHook(CloseToTray);
      // Saved bounds apply before the first paint; a maximized window maximizes as it is shown.
      if (placement is not null && !offscreen) { placement.Apply(); if (placement.PendingMaximize) { placement.PendingMaximize = false; WindowState = WindowState.Maximized; } }
    };
    Closed += (_, _) => { placement?.Flush(); updater?.Dispose(); tray?.Dispose(); google?.Dispose(); desktop?.Dispose(); web.Dispose(); bridge?.Dispose(); backupFiles.Dispose(); database.Dispose(); };
  }
  /// <summary>A second launch of Work Fleet shows the running instance's main window.</summary>
  public void ShowFromLaunch() { if (!shuttingDown) ShowMain(true); }
  private void FinishStart()
  {
    if (placement is null) return;
    if (offscreen)
    {
      offscreen = false; ShowInTaskbar = true;
      // A tray that failed to start never arrives, so the window shows at once; otherwise the tray keeps trying to add its icon.
      if (tray is null) { placement.Apply(); if (placement.PendingMaximize) { placement.PendingMaximize = false; WindowState = WindowState.Maximized; } }
      else { Hide(); placement.Apply(); if (!tray.Available) _ = ShowWithoutTray(); }
    }
    placement.Track();
    if (shell is not null) _ = shell.SyncStartup();
    if (updater?.Probe == true) _ = ProbeUpdate();
  }
  /// <summary>Without a tray the hidden window could not be reached, so a sign-in launch shows it when none arrived in time.</summary>
  private async Task ShowWithoutTray()
  {
    var wait = shell?.TrayWait ?? TimeSpan.Zero;
    await Task.Delay(wait);
    if (shuttingDown || tray?.Available == true || IsVisible) return;
    Log($"no tray within {wait.TotalSeconds:F0}s; showing the main window"); ShowMain(false);
  }
  private void Log(string text) => HostLog.Append(dataDirectory, DateTimeOffset.Now, text);
  private static string Uptime()
  {
    using var process = Process.GetCurrentProcess();
    return $"{(DateTime.Now - process.StartTime).TotalSeconds:F1}s";
  }
  private void ShowMain() => ShowMain(true);
  private void ShowMain(bool activate)
  {
    if (offscreen) { offscreen = false; ShowInTaskbar = true; placement?.Apply(); }
    else placement?.BeforeShow();
    var previous = ShowActivated; ShowActivated = activate; Show(); ShowActivated = previous;
    if (placement?.PendingMaximize == true) { placement.PendingMaximize = false; WindowState = WindowState.Maximized; }
    if (WindowState == WindowState.Minimized)
    {
      if (activate) WindowState = WindowState.Normal;
      else _ = ShowWindow(new System.Windows.Interop.WindowInteropHelper(this).Handle, 4); // SW_SHOWNOACTIVATE
    }
    if (activate) Activate();
  }
  private IntPtr CloseToTray(IntPtr window, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
  {
    // X, Alt+F4 and the taskbar close command (WM_SYSCOMMAND/SC_CLOSE) keep Work Fleet in the tray.
    // A programmatic Close(), WM_CLOSE and the tray's exit item still save and quit.
    // With 關閉主畫面時保留在系統匣 turned off, the close command saves and quits instead.
    if (message == 0x0112 && (wParam.ToInt64() & 0xfff0) == 0xF060 && tray?.Available == true && !shuttingDown && shell?.Preferences.CloseToTray != false)
    { handled = true; placement?.Flush(); Hide(); }
    return IntPtr.Zero;
  }
  private void TrayAction(string action, ForegroundIntent intent)
  {
    if (shuttingDown) return;
    if (action == "show") ShowMain(intent.Current);
    else if (action == "exit") { ShowMain(intent.Current); Close(); }
    else if (action == "update") _ = TrayUpdate();
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
      }, ShowMain, OpenExternal, desktopDisplays, this, () => { if (tray?.Available != true) return false; placement?.Flush(); Hide(); return true; },
        Log, holdAtSignIn: shell?.LaunchedAtLogin == true, builtInOverride: desktopBuiltIn);
      bridge = new BridgeSession(database, backupFiles, ChooseBackupDirectory, desktop.Invoke, google.Available, shell is null ? null : shell.Identity with { Updates = updater?.Capable == true });
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
      if (shell is not null && IsShellRequest(json)) { _ = HandleShell(epoch, json); return; }
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
  private static bool IsShellRequest(string json)
  {
    try
    {
      using var value = JsonRules.Parse(Encoding.UTF8.GetBytes(json));
      return JsonRules.Text(value.RootElement, "method") is "host.preferences.get" or "host.preferences.set" or "host.preferences.openSystem" or "host.window.resetPlacement"
        or "update.state" or "update.check" or "update.download" or "update.install";
    }
    catch { return false; }
  }
  /// <summary>Startup preferences and the main window run on the UI thread: StartupTask requests and window moves belong there.</summary>
  private async Task HandleShell(long epoch, string json)
  {
    string? id = null; string reply;
    try
    {
      using var document = JsonRules.Parse(Encoding.UTF8.GetBytes(json)); var request = document.RootElement;
      id = JsonRules.Text(request, "id"); var method = JsonRules.Text(request, "method"); var args = request.GetProperty("params");
      HostError.Require(Guid.TryParseExact(id, "D", out _) && JsonRules.Integer(request, "v") == 1 && args.ValueKind == JsonValueKind.Object && epoch == navigation && !shuttingDown,
        "stale-session", "工作階段已結束。");
      object? result = null;
      switch (method)
      {
        case "host.preferences.get": result = await shell!.Describe(tray?.Available == true); break;
        case "host.preferences.set":
          HostError.Require(args.TryGetProperty("value", out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False, "invalid-request", "設定值無效。");
          result = await shell!.Set(JsonRules.Text(args, "name", 32), value.GetBoolean(), tray?.Available == true); break;
        case "host.preferences.openSystem": HostShell.OpenSystemSettings(); break;
        case "host.window.resetPlacement": placement!.Reset(); break;
        case "update.state": result = updater!.Snapshot(); break;
        case "update.check": _ = updater!.Check(); result = updater.Snapshot(); break;
        case "update.download": _ = updater!.Download(); result = updater.Snapshot(); break;
        default: await BeginInstall(); result = updater!.Snapshot(); break;
      }
      reply = JsonSerializer.Serialize(new { v = 1, id, ok = true, result });
    }
    catch (Exception error)
    {
      reply = JsonSerializer.Serialize(new { v = 1, id, ok = false, error = new { code = (error as HostError)?.Code ?? "host-preferences",
        message = (error as HostError)?.Message ?? "無法完成這項設定，請稍後重試。" } });
    }
    finally { queued--; }
    if (epoch != navigation || shuttingDown || !NavigationPolicy.IsDocument(web.CoreWebView2.Source)) return;
    web.CoreWebView2.PostWebMessageAsJson(reply);
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
      if (session.CloseReady && closeRequested && epoch == navigation) { shuttingDown = true; if (installRequested) _ = Install(); else Close(); }
      if (session.TakeCloseCancelled() && installRequested)
      {
        // The document kept a dialog or an edit open, so nothing closed and the update waits.
        installRequested = false; updater?.InstallFailed("請先完成或關閉目前的對話框與編輯，再安裝更新。");
      }
      if (session.TakeResetDone() && epoch == navigation && !shuttingDown)
      {
        var profile = database.ProfileId;
        _ = Dispatcher.BeginInvoke(new Action(() => { if (epoch == navigation && !shuttingDown) SwitchProfile(profile); }));
      }
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
    if (closing || shuttingDown) return; closing = true; placement?.Flush();
    try
    {
      if (bridge?.Ready == true && web.CoreWebView2 is not null && NavigationPolicy.IsDocument(web.CoreWebView2.Source))
      {
        // The reply arrives through the regular authenticated bridge only after all pending saves settle.
        closeRequested = true; web.CoreWebView2.PostWebMessageAsJson("{\"v\":1,\"event\":\"host-close-requested\"}");
        return;
      }
      await messageQueue; shuttingDown = true;
      if (installRequested) await Install(); else Close();
    }
    finally { closing = false; }
  }
  private void PublishUpdate(object state) => Dispatcher.BeginInvoke(new Action(() =>
  {
    tray?.SetTip(updater?.Percent is { } percent ? $"Work Fleet · 下載更新 {percent}%" : null);
    if (shuttingDown || web.CoreWebView2 is null || !NavigationPolicy.IsDocument(web.CoreWebView2.Source)) return;
    web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { v = 1, @event = "update-state", state }));
  }));
  /// <summary>Verifies the downloaded installer, then saves drafts and closes through the usual close request.</summary>
  private async Task BeginInstall()
  {
    HostError.Require(updater is not null && !shuttingDown && !installRequested, "update-busy", "目前不能安裝更新。");
    installPath = await updater!.Ready();
    installRequested = true; updater.Installing();
    await PrepareClose();
  }
  /// <summary>
  /// After the document saved its drafts: scenes, Explorer, data and the owner lock are released first, then Windows replaces
  /// the package and ends this process. RegisterApplicationRestart reopens Work Fleet when it had run for at least 60 seconds.
  /// </summary>
  private async Task Install()
  {
    placement?.Flush();
    _ = RegisterApplicationRestart(null, 0);
    Hide();
    tray?.Dispose(); google?.Dispose(); desktop?.Dispose(); bridge?.Dispose(); backupFiles.Dispose(); database.Dispose();
    Instance?.Dispose(); Instance = null;
    try
    {
      var manager = new global::Windows.Management.Deployment.PackageManager();
      var result = await manager.AddPackageAsync(new Uri(installPath!), null, global::Windows.Management.Deployment.DeploymentOptions.ForceApplicationShutdown);
      if (result.ExtendedErrorCode is not null && result.ExtendedErrorCode.HResult != 0) throw new InvalidOperationException(result.ErrorText);
    }
    catch (Exception error)
    {
      if (updater?.Probe == true) { ProbeResult("install_failed: " + error.Message); Application.Current?.Shutdown(); return; }
      MessageBox.Show("更新沒有完成，Work Fleet 會重新開啟；已保存的資料不受影響。\n\n" + error.Message, "Work Fleet", MessageBoxButton.OK, MessageBoxImage.Warning);
      try
      {
        var family = global::Windows.ApplicationModel.Package.Current.Id.FamilyName;
        Process.Start(new ProcessStartInfo("explorer.exe", $"shell:AppsFolder\\{family}!WorkFleet") { UseShellExecute = true });
      }
      catch { }
    }
    Application.Current?.Shutdown();
  }
  /// <summary>Test-WindowsUpdate.ps1 only: once the document is ready, the probe identity downloads and installs its update.</summary>
  private async Task ProbeUpdate()
  {
    for (var i = 0; i < 600 && bridge?.Ready != true; i++) await Task.Delay(100);
    await updater!.Download();
    if (updater.Status == "downloaded") await BeginInstall();
    else ProbeResult($"{updater.Status}: {updater.ErrorMessage}");
  }
  private void ProbeResult(string text)
  {
    try { File.WriteAllText(Path.Combine(dataDirectory, "update-probe-result.txt"), text); } catch { }
  }
  /// <summary>The tray asks once: a fresh check, then a native answer; updating saves and restarts like the settings page.</summary>
  private async Task TrayUpdate()
  {
    if (updater is null || shuttingDown) return;
    await updater.Check();
    if (updater.Status is "update_available" or "downloaded")
    {
      var text = $"有新版本 {updater.PendingVersion}（目前 {HostIdentity.BuildVersion()}）。"
        + (string.IsNullOrWhiteSpace(updater.PendingSummary) ? "" : "\n\n" + updater.PendingSummary) + "\n\n要現在更新並重新啟動 Work Fleet 嗎？未保存的文字會先保存。";
      if (MessageBox.Show(text, "Work Fleet 更新", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
      if (updater.Status != "downloaded") await updater.Download();
      if (updater.Status == "downloaded")
      {
        try { await BeginInstall(); }
        catch (HostError error) { MessageBox.Show(error.Message, "Work Fleet 更新", MessageBoxButton.OK, MessageBoxImage.Warning); }
        return;
      }
    }
    var upToDate = updater.Status == "up_to_date";
    MessageBox.Show(upToDate ? $"Work Fleet {HostIdentity.BuildVersion()} 已是最新版本。" : updater.ErrorMessage ?? "更新沒有完成，請稍後再試。",
      "Work Fleet 更新", MessageBoxButton.OK, upToDate ? MessageBoxImage.Information : MessageBoxImage.Warning);
  }
  private static void OpenExternal(string uri)
  {
    if (!NavigationPolicy.IsExternal(uri)) return;
    try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch { }
  }
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern int RegisterApplicationRestart(string? commandLine, int flags);
}
