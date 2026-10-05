using Microsoft.Web.WebView2.Core;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Interop;
using WorkFleet.Windows;

internal static class ShortcutIntegrationProbe
{
  private static async Task<bool> Check(CoreWebView2 web, string script) => (await web.ExecuteScriptAsync(script)) == "true";
  private static async Task Wait(Func<Task<bool>> predicate, string message)
  {
    var until = DateTime.UtcNow.AddSeconds(30);
    while (DateTime.UtcNow < until) { if (await predicate()) return; await Task.Delay(50); }
    throw new Exception("Shortcut probe timeout: " + message);
  }
  private static T Field<T>(object value, string name) => (T)value.GetType().GetField(name, BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(value)!;
  public static async Task Run(FleetWindow main)
  {
    var web = main.WebView.CoreWebView2; var coordinator = main.Desktop!;
    var scene = coordinator.Surfaces[1].WebView.CoreWebView2;
    var native = Field<NativeShortcuts>(coordinator, "shortcuts");
    var tray = Field<NativeTray>(main, "tray");
    if (!tray.Available) throw new Exception("No shell notification icon; tray assertions cannot run in this session.");
    var trayWindow = Field<HwndSource>(tray, "receiver").Handle;
    var identifier = new IconIdentifier { Size = (uint)Marshal.SizeOf<IconIdentifier>(), Window = trayWindow, Id = 1 };
    if (Shell_NotifyIconGetRect(ref identifier, out _) != 0) throw new Exception("Shell cannot locate the actual owned notification icon.");
    // Configure the real owner through the settings UI. No synthetic Workspace replaces SQLite.
    await web.ExecuteScriptAsync("document.querySelector('#settings-button').click()");
    await Wait(() => Check(web, "document.querySelector('#settings-dialog').open"), "settings opened");
    await web.ExecuteScriptAsync("document.querySelector('[data-shortcut-target=\"@all\"]').value='Ctrl+Alt+Shift+F24';document.querySelector('#save-settings').click()");
    await Wait(() => Task.FromResult(coordinator.ShortcutStatus.Any(r => r.Key == "Ctrl+Alt+Shift+F24" && r.Target == "@all")), "durable settings reached native registration");
    await Wait(() => Check(web, "document.querySelector('#shortcut-status').textContent.includes('Ctrl+Alt+Shift+F24')"), "real registration status displayed");
    // A real WM_HOTKEY message to our own receiver routes the registered target. No system key input is injected.
    var registration = coordinator.ShortcutStatus.Single(r => r.Target == "@all");
    if (registration.Status == "available")
    {
      var index = native.Registrations.ToList().FindIndex(r => r.Target == "@all") + 1;
      NativeShortcuts.Parse(registration.Key, out var mods, out var key);
      if (!PostMessageW(Field<HwndSource>(native, "receiver").Handle, 0x312, new IntPtr(index), new IntPtr((long)((key << 16) | mods)))) throw new Exception("Owned hotkey post failed");
    }
    else coordinator.DispatchAction("@all"); // The OS may already have focused this owned probe window.
    await Wait(() => Check(scene, "Boolean(document.querySelector('.card.operable'))"), "native action opened floating scope");
    await scene.ExecuteScriptAsync("[...document.querySelectorAll('.card-actions button')].find(b=>b.textContent==='編輯').click()");
    await Wait(() => Check(scene, "Boolean(document.querySelector('textarea'))"), "inline editor");
    await scene.ExecuteScriptAsync("document.querySelector('textarea').value='快捷鍵退出前的草稿';document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'F24',code:'F24',ctrlKey:true,altKey:true,shiftKey:true,bubbles:true,cancelable:true}))");
    await Task.Delay(200);
    if (!await Check(scene, "Boolean(document.querySelector('textarea'))")) throw new Exception("Composing shortcut closed the editor.");
    await scene.ExecuteScriptAsync("document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'F24',code:'F24',ctrlKey:true,altKey:true,shiftKey:true,bubbles:true,cancelable:true}))");
    await Wait(() => Check(web, "document.querySelector('#stop-operation').hidden"), "local scene scope chord safely toggles off");
    await web.ExecuteScriptAsync("document.querySelector('#drafts-button').click()");
    await Wait(() => Check(web, "document.querySelector('#draft-list').textContent.includes('快捷鍵退出前的草稿')"), "scope chord kept exact durable draft");
    await web.ExecuteScriptAsync("document.querySelector('#close-drafts').click()");
    // Blocked close / initialization cannot be undone by a concurrent settings refresh.
    using (var block = JsonDocument.Parse("{\"blocked\":true}")) coordinator.Invoke("desktop.shortcuts.block", block.RootElement);
    using (var config = JsonDocument.Parse(JsonSerializer.Serialize(new { bindings = native.Registrations.Select(r => new { key = r.Key, target = r.Target }).ToArray() })))
      coordinator.Invoke("desktop.shortcuts.configure", config.RootElement);
    if (native.Registrations.Any(r => r.Status == "available")) throw new Exception("Configuration bypassed the close registration block.");
    using (var block = JsonDocument.Parse("{\"blocked\":false}")) coordinator.Invoke("desktop.shortcuts.block", block.RootElement);
    coordinator.MenuActive(true);
    using (var config = JsonDocument.Parse(JsonSerializer.Serialize(new { bindings = native.Registrations.Select(r => new { key = r.Key, target = r.Target }).ToArray() })))
      coordinator.Invoke("desktop.shortcuts.configure", config.RootElement);
    if (native.Registrations.Any(r => r.Status == "available")) throw new Exception("Configuration bypassed the native menu registration block.");
    using (var other = new NativeShortcuts(_ => throw new Exception("Unexpected probe hotkey")))
    {
      other.Configure([new("Ctrl+Alt+Shift+F24", "@all")]);
      if (other.Registrations.Single().Status != "available") throw new Exception("Native menu block did not actually release the OS chord.");
    }
    coordinator.MenuActive(false);
    coordinator.DispatchAction("@hide");
    await Wait(() => Task.FromResult(!main.IsVisible), "hide owner while keeping desktop and database alive");
    if (!ReferenceEquals(main.Desktop, coordinator)) throw new Exception("Hide replaced the workspace owner.");
    if (!PostMessageW(trayWindow, 0x8001, IntPtr.Zero, new IntPtr((1 << 16) | 0x401))) throw new Exception("Tray keyboard selection post failed");
    await Wait(() => Task.FromResult(main.IsVisible), "tray keyboard entry reopens owner");
    // IsActive is a WPF/thread state; Windows may refuse foreground permission. Check native ownership itself.
    Field<NativeActivity>(coordinator, "activity").Refresh();
    _ = GetWindowThreadProcessId(GetForegroundWindow(), out var foregroundProcess);
    var captured = coordinator.CaptureIntent(main);
    if (foregroundProcess == (uint)Environment.ProcessId && native.Registrations.Any(r => r.Status == "available")) throw new Exception("Owned foreground retained global keyboard registrations.");
    if (foregroundProcess != (uint)Environment.ProcessId && native.Registrations.Single(r => r.Target == "@all").Status == "suspended")
      throw new Exception("Thread activation left global shortcuts suspended after foreground was refused.");
    main.Hide();
    using (var args = JsonDocument.Parse(JsonSerializer.Serialize(new { intent = captured })))
      if (JsonSerializer.SerializeToElement(coordinator.Invoke("desktop.showMain", args.RootElement)).GetProperty("activated").GetBoolean())
        throw new Exception("An intent from a no-longer-foreground view was accepted.");
    if (main.IsVisible) throw new Exception("Rejected late intent showed the main window.");
    Console.WriteLine(captured is null ? "SKIP positive native foreground grant: OS did not grant the probe foreground; null intent rejection passed"
      : "PASS native foreground grant captured before yielding; later foreground loss rejects activation");
    if (!PostMessageW(trayWindow, 0x8001, IntPtr.Zero, new IntPtr((1 << 16) | 0x401))) throw new Exception("Tray selection post failed");
    await Wait(() => Task.FromResult(main.IsVisible), "tray remains reachable after rejected late activation");
    var recreated = RegisterWindowMessageW("TaskbarCreated");
    if (!PostMessageW(trayWindow, (int)recreated, IntPtr.Zero, IntPtr.Zero)) throw new Exception("Owned shell lifecycle post failed");
    await Task.Delay(150);
    if (!tray.Available || Shell_NotifyIconGetRect(ref identifier, out _) != 0) throw new Exception("Notification icon was not recreated.");
    // Keep the normal default chord for the remaining fixture and next native reopen.
    await web.ExecuteScriptAsync("document.querySelector('#settings-button').click()");
    await Wait(() => Check(web, "document.querySelector('#settings-dialog').open"), "restore shortcut settings");
    await web.ExecuteScriptAsync("document.querySelector('[data-shortcut-target=\"@all\"]').value='Ctrl+Shift+0';document.querySelector('#save-settings').click()");
    await Wait(() => Check(web, "!document.querySelector('#settings-dialog').open"), "restored shortcut settings saved");
    Console.WriteLine($"PASS actual shell icon, native action ({registration.Status}), shortcut settings/status, synthetic IME/local key draft exit, hide/reopen and owned shell recreation");
  }
  [StructLayout(LayoutKind.Sequential)] private struct IconIdentifier { public uint Size; public IntPtr Window; public uint Id; public Guid Guid; }
  [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("shell32.dll")] private static extern int Shell_NotifyIconGetRect(ref IconIdentifier identifier, out Rect bounds);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint RegisterWindowMessageW(string name);
  [DllImport("user32.dll")] private static extern bool PostMessageW(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
}
