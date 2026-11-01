using System.IO;
using System.Text.Json;
using System.Runtime.InteropServices;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using WorkFleet.Windows;
using WorkFleet.Windows.Core;

internal static class Program
{
  [STAThread]
  private static void Main(string[] args)
  {
    if (!AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), new IntPtr(-4)))
      throw new InvalidOperationException("Run the probe .exe apphost so the shared PerMonitorV2 manifest is active.");
    if (args.Length == 1 && args[0] == "--hit-target") { CompositionProbe.RunHitTarget(); return; }
    if (args.Length == 1 && args[0] == "--shell-topology") { ShellTopologyProbe.Run(); return; }
    if (args.Length == 1 && args[0] == "--attachments") { AttachmentFilesProbe.Run(); return; }
    if (args.Length == 2 && args[0] == "--app-data") { AppDataProbe.Run(Path.GetFullPath(args[1])); return; }
    // --host-window[-dcomp] stays open as a topmost cross-process host; --host-child HOST DIR VARIANT attaches a scene to
    // it; --host-check DIR starts an Explorer-style host itself and checks a scene attached the way the app does.
    var hostWindow = args.Length == 1 && args[0] is "--host-window" or "--host-window-dcomp";
    var hostChild = args.Length == 4 && args[0] == "--host-child";
    var hostCheck = args.Length == 2 && args[0] == "--host-check";
    var composition = args.Length == 2 && args[0] == "--composition";
    var wallpaper = args.Length == 2 && args[0] == "--wallpaper" || args.Length == 3 && args[0] == "--wallpaper" && args[2] == "--wait-desktop";
    var diagnostics = args.Length == 2 && args[0] == "--diagnostics";
    var formation = args.Length == 2 && args[0] == "--formation";
    var platform = args.Length == 1 && args[0] == "--platform";
    var sceneGrowth = args.Length == 1 && args[0] == "--scene-growth";
    var hostShell = args.Length == 2 && args[0] == "--host-shell";
    var crashGuard = args.Length == 2 && args[0] == "--crash-guard";
    var signInHold = args.Length == 2 && args[0] == "--sign-in-hold";
    var gridArea = args.Length == 2 && args[0] == "--grid-area";
    var adjustOverlay = args.Length == 2 && args[0] == "--adjust-overlay";
    var referenceDpi = args.Length == 2 && args[0] == "--reference-dpi";
    var hiddenSync = args.Length == 2 && args[0] == "--hidden-sync";
    var dataFailure = args.Length == 2 && args[0] == "--data-failure";
    var trayMenu = args.Length == 2 && args[0] == "--tray-menu";
    if (!composition && !wallpaper && !diagnostics && !formation && !hostChild && !hostCheck && !hostShell && !crashGuard && !signInHold && !gridArea && !adjustOverlay && !referenceDpi && !hiddenSync && !dataFailure && !trayMenu && args.Length != 1)
      throw new ArgumentException("Usage: WorkFleet.Windows.Ui.Tests [--composition|--wallpaper|--diagnostics|--host-check|--formation|--host-shell|--crash-guard|--sign-in-hold|--grid-area|--adjust-overlay|--reference-dpi|--hidden-sync|--data-failure|--tray-menu] OUTPUT_DIRECTORY [--wait-desktop] | --platform | --scene-growth");
    var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
    app.Startup += async (_, _) =>
    {
      try
      {
        if (hostWindow) { HostChildProbe.Host(redirection: args[0] == "--host-window"); return; }
        if (hostChild) await HostChildProbe.Run(new IntPtr(Convert.ToInt64(args[1], 16)), Path.GetFullPath(args[2]), args[3]);
        else if (hostCheck) await HostChildProbe.Check(Path.GetFullPath(args[1]));
        else if (platform) await PlatformProbe.Run();
        else if (sceneGrowth) SceneGrowthProbe.Run();
        else if (wallpaper) await WallpaperProbe.Run(Path.GetFullPath(args[1]));
        else if (composition) await CompositionProbe.Run(Path.GetFullPath(args[1]));
        else if (diagnostics) await DiagnosticsProbe.Run(Path.GetFullPath(args[1]));
        else if (formation) await DesktopFormationProbe.Run(Path.GetFullPath(args[1]));
        else if (hostShell) await HostShellProbe.Run(Path.GetFullPath(args[1]));
        else if (crashGuard) await CrashGuardProbe.Run(Path.GetFullPath(args[1]));
        else if (signInHold) await SignInHoldProbe.Run(Path.GetFullPath(args[1]));
        else if (gridArea) await GridAreaProbe.Run(Path.GetFullPath(args[1]));
        else if (adjustOverlay) await AdjustOverlayProbe.Run(Path.GetFullPath(args[1]));
        else if (referenceDpi) await ReferenceDpiProbe.Run(Path.GetFullPath(args[1]));
        else if (hiddenSync) await HiddenSyncProbe.Run(Path.GetFullPath(args[1]));
        else if (dataFailure) await DataFailureUiProbe.Run(Path.GetFullPath(args[1]));
        else if (trayMenu) await TrayMenuProbe.Run(Path.GetFullPath(args[1]));
        else { await Probe(Path.GetFullPath(args[0])); Console.WriteLine("PASS real Windows WPF/WebView2/native SQLite UI probe"); }
        app.Shutdown(0);
      }
      catch (Exception error) { Console.Error.WriteLine(error); app.Shutdown(1); }
    };
    app.Run();
  }
  [DllImport("user32.dll")] private static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] private static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);
  /// <summary>
  /// UI probes run in English whatever the Windows display language (docs/i18n.md): the isolated data folder stores the
  /// display language "en" before a window opens, as the Settings select would.
  /// </summary>
  internal static string English(string directory)
  {
    Directory.CreateDirectory(directory);
    HostPreferences.Read(directory).WithLanguage("en").Write(directory); return directory;
  }
  internal static FleetWindow Open(string directory)
  {
    English(directory);
    var backups = Path.Combine(directory, "backups"); Directory.CreateDirectory(backups);
    // Replace only the interactive picker in this offscreen probe. Bridge, encryption, SQLite and file I/O are real.
    var window = new FleetWindow(directory, () => backups,
      [new("probe", true, new(-20000, -20000, 1800, 1200), new(-20000, -20000, 1800, 1200), 144)]) { WindowStartupLocation = WindowStartupLocation.Manual, Left = -20000, Top = -20000,
      ShowActivated = false, ShowInTaskbar = false, Width = 1180, Height = 800 };
    window.Show(); return window;
  }
  private static async Task<JsonElement> Eval(FleetWindow window, string source)
  {
    var json = await window.WebView.CoreWebView2.ExecuteScriptAsync(source);
    using var value = JsonDocument.Parse(json); return value.RootElement.Clone();
  }
  internal static async Task Wait(FleetWindow window, string expression, string description)
  {
    var until = DateTime.UtcNow.AddSeconds(30); string? last = null;
    while (DateTime.UtcNow < until)
    {
      if (window.WebView.CoreWebView2 is not null)
      {
        try { if ((await Eval(window, expression)).ValueKind == JsonValueKind.True) return; }
        catch (Exception error) { last = error.Message; }
      }
      await Task.Delay(100);
    }
    var state = window.WebView.CoreWebView2 is null ? "no WebView2" : (await Eval(window,
      "({url:location.href,ready:document.readyState,status:document.querySelector('#status')?.textContent,body:document.body?.innerText.slice(0,1500)})")).ToString();
    throw new Exception($"Timed out: {description}; {last}; {state}");
  }
  internal static async Task Close(FleetWindow window)
  {
    var ended = new TaskCompletionSource(); window.Closed += (_, _) => ended.TrySetResult(); window.Close();
    await ended.Task.WaitAsync(TimeSpan.FromSeconds(30));
  }
  private static async Task Probe(string directory)
  {
    Directory.CreateDirectory(directory); var window = Open(directory);
    await Wait(window, "document.querySelector('#status')?.textContent === 'Local data opened'", "native app initialization");
    await Wait(window, "document.querySelector('#storage-note')?.textContent.includes('Encrypted on this device')", "native adapter selection");
    Console.WriteLine($"WebView2 {window.WebView.CoreWebView2.Environment.BrowserVersionString}");
    await Eval(window, "document.querySelector('#compose').click()");
    await Wait(window, "document.querySelector('#editor-dialog').open", "open editor");
    await Eval(window, "document.querySelector('#editor-text').value='# Native note\\n\\n- [ ] Saved across processes';document.querySelector('#editor-text').dispatchEvent(new Event('input',{bubbles:true}))");
    await Wait(window, "document.querySelector('#draft-status').textContent === 'Kept on this device, not saved yet'", "durable unsaved changes");
    // The attachment text carries escaped CJK characters, so the native attachment path keeps multi-byte UTF-8 exactly.
    await Eval(window, "const files=new DataTransfer();files.items.add(new File(['native attachment \u4E2D\u6587'],'proof.txt',{type:'text/plain'}));document.querySelector('#attachment-input').files=files.files;document.querySelector('#attachment-input').dispatchEvent(new Event('change',{bubbles:true}))");
    await Wait(window, "document.querySelector('#attachments a')?.textContent === 'proof.txt'", "native attachment");
    await Eval(window, "document.querySelector('#editor-form').requestSubmit()");
    await Wait(window, "!document.querySelector('#editor-dialog').open && document.querySelector('.note-title')?.textContent === 'Native note'", "save native card");
    // Turning daily display off must explain the hidden papers above the list, and its action must restore them.
    await Eval(window, "document.querySelector('#settings-button').click()");
    await Wait(window, "document.querySelector('#settings-dialog').open", "settings before hiding desktop notes");
    await Eval(window, "const visible=document.querySelector('#desktop-visible');visible.checked=false;visible.dispatchEvent(new Event('change'));document.querySelector('#close-settings').click()");
    await Wait(window, "!document.querySelector('#settings-dialog').open && !document.querySelector('#desktop-hidden').hidden && document.querySelector('#desktop-hidden-text').textContent.startsWith('1 note ')", "hidden desktop notes explained");
    await Eval(window, "document.querySelector('#show-desktop').click()");
    await Wait(window, "document.querySelector('#desktop-hidden').hidden && document.querySelector('#status').textContent === 'Desktop notes are showing'", "hidden desktop notes shown again");
    await DesktopIntegrationProbe.Run(window, directory);
    await ShortcutIntegrationProbe.Run(window);
    // The main host refuses navigations away from the exact packaged document and prevents frames.
    window.WebView.CoreWebView2.Navigate("https://work-fleet.invalid/other.html"); await Task.Delay(150);
    if (window.WebView.CoreWebView2.Source != NavigationPolicy.Document) throw new Exception("Unexpected navigation");
    await Eval(window, "const frame=document.createElement('iframe');frame.src='/app/index.html';document.body.append(frame)");
    await Task.Delay(200);
    await Wait(window, "document.querySelector('iframe').contentDocument?.querySelector('#compose') === null", "frame navigation blocked");
    await Eval(window, "document.querySelector('iframe').remove();document.querySelector('#settings-button').click()");
    await Wait(window, "document.querySelector('dialog[open]') !== null", "settings dialog");
    window.Close(); await Task.Delay(200);
    await Wait(window, "document.querySelector('#status').textContent.includes('Finish or close the current dialog')", "close refuses open work dialog");
    await Eval(window, "document.querySelector('dialog[open]').close()");
    await BackupProbe(window, directory);
    using (var screenshot = File.Create(Path.Combine(directory, "native-ui.png")))
      await window.WebView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, screenshot);
    await Eval(window, "document.querySelector('#compose').click()");
    await Wait(window, "document.querySelector('#editor-dialog').open", "second editor");
    await Eval(window, "document.querySelector('#editor-text').value='Still unsaved at the moment of closing';document.querySelector('#editor-text').dispatchEvent(new Event('input',{bubbles:true}))");
    await Close(window); window = Open(directory);
    await Wait(window, "document.querySelector('#status')?.textContent === 'Local data opened'", "native restart");
    // A new note left unsaved at close is a note with a dot after reopening (ADR-061).
    await Wait(window, "document.querySelector('.note-title')?.textContent === 'Native note' && [...document.querySelectorAll('#list article')].some(note => note.textContent.includes('Still unsaved at the moment of closing') && note.querySelector('.unsaved-dot'))", "card and exact unsaved note retained after native reopen");
    await DesktopIntegrationProbe.CloseWithDraft(window); window = Open(directory);
    await Wait(window, "document.querySelector('#status')?.textContent === 'Local data opened'", "reopen after scene close");
    await Wait(window, "[...document.querySelectorAll('#list article')].some(note => note.textContent.includes('Desktop text that must reach the disk at close') && note.querySelector('.unsaved-dot'))", "exact desktop final text survived close as unsaved changes");
    // Hold the real host.ready request on the next document. Resizing must not install
    // a live group menu or card action before the native close handshake is ready.
    await window.WebView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("""
      const sendNative = chrome.webview.postMessage.bind(chrome.webview);
      chrome.webview.postMessage = request => {
        if (request.method === 'host.ready') { window.nativeReadyHeld = true; return; }
        sendNative(request);
      };
      """);
    window.WebView.CoreWebView2.Reload();
    await Wait(window, "window.nativeReadyHeld === true", "hold native readiness");
    window.Width = 980; await Task.Delay(300);
    await Wait(window, "document.querySelectorAll('.card,.group-menu').length === 0 && document.querySelector('#status').textContent === 'Loading…'", "resize cannot bypass native readiness");
    await Eval(window, "document.querySelector('#compose').click()");
    await Wait(window, "!document.querySelector('#editor-dialog').open", "editor remains unavailable before readiness");
    await Close(window);
    using var db = new LocalDatabase(directory, "local");
    using var state = JsonRules.Parse(db.ReadRecord("workspace")!);
    var card = state.RootElement.GetProperty("cards")[0]; var attachment = card.GetProperty("content").GetProperty("attachments")[0];
    if (db.ReadAttachment(attachment.GetProperty("id").GetString()!) is null) throw new Exception("Attachment missing after native reopen");
  }
  private static async Task BackupProbe(FleetWindow window, string directory)
  {
    await Eval(window, "document.querySelector('#settings-button').click()");
    await Wait(window, "document.querySelector('#settings-dialog').open", "settings for backup");
    await Eval(window, "document.querySelector('[data-page=\"data\"]').click()");
    await Wait(window, "document.querySelector('#backup-panel') !== null", "native backup page");
    await Eval(window, "document.querySelector('#auto-backup-location').click()");
    await Wait(window, "document.querySelector('#auto-backup-destination').textContent.includes('backups')", "native directory grant");
    await Eval(window, "document.querySelector('#auto-backup-password').value='native-window-backup-password-abcdefghijkl';document.querySelector('#auto-backup-enable').click()");
    await Wait(window, "document.querySelector('#auto-backup-message').textContent === 'Backed up and verified.'", "native automatic encrypted file");
    if (Directory.GetFiles(Path.Combine(directory, "backups"), "work-fleet-auto-*.zip").Length != 1) throw new Exception("Missing automatic file");
    await Eval(window, "document.querySelector('#backup-password').value='manual-window-backup-password-abcdefghijkl';document.querySelector('#export-backup').click()");
    await Wait(window, "document.querySelector('#backup-status').textContent.startsWith('Backup saved and verified.')", "native manual verified file");
    var file = Directory.GetFiles(Path.Combine(directory, "backups"), "work-fleet-backup-*.zip").Single();
    var base64 = Convert.ToBase64String(File.ReadAllBytes(file));
    await Eval(window, """
      const restoreBytes = Uint8Array.from(atob(BASE64), value => value.charCodeAt(0));
      const restoreInput = new DataTransfer(); restoreInput.items.add(new File([restoreBytes], 'native.zip', {type:'application/zip'}));
      document.querySelector('#restore-file').files=restoreInput.files;
      document.querySelector('#restore-file').dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('#restore-password').value='manual-window-backup-password-abcdefghijkl';
      document.querySelector('#preview-restore').click();
      """.Replace("BASE64", JsonSerializer.Serialize(base64)));
    await Wait(window, "document.querySelector('#backup-status').textContent === 'The file can be restored. Check the details, then select Confirm restore.'", "native file portable restore preview");
    await Wait(window, "document.querySelector('#restore-preview').textContent.includes('1 attachment')", "backup retains attachment");
    await Eval(window, "document.querySelector('#close-settings').click()");
  }
}
