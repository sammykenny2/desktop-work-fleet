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
    // Shortcut fields apply on change; closing settings lets the window take desktop actions again.
    await web.ExecuteScriptAsync("{const all=document.querySelector('[data-shortcut-target=\"@all\"]');all.value='Ctrl+Alt+Shift+F24';all.dispatchEvent(new Event('change'));document.querySelector('#close-settings').click()}");
    await Wait(() => Task.FromResult(coordinator.ShortcutStatus.Any(r => r.Key == "Ctrl+Alt+Shift+F24" && r.Target == "@all")), "durable settings reached native registration");
    await Wait(() => Check(web, "document.querySelector('[data-shortcut-status=\"@all\"]').dataset.state.length > 0"), "real registration status displayed");
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
    // Adjust mode only arranges (SPEC-003, 2026-10-24): leave it, then open the resting paper with a quick edit.
    await scene.ExecuteScriptAsync("document.querySelector('.adjust-tools button.primary').click()");
    await Wait(() => Check(web, "document.querySelector('#stop-operation').hidden"), "adjust mode ended before the quick edit");
    await web.ExecuteScriptAsync("if(!document.querySelector('#desktop-quick-move').checked)document.querySelector('#desktop-quick-move').click()");
    var resident = coordinator.Surfaces[0].WebView.CoreWebView2;
    await Wait(async () =>
    {
      await resident.ExecuteScriptAsync("document.querySelector('.card')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,ctrlKey:true}))");
      return await Check(scene, "Boolean(document.querySelector('textarea'))");
    }, "inline editor");
    await scene.ExecuteScriptAsync("document.querySelector('textarea').value='Draft before the shortcut exit';document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'F24',code:'F24',ctrlKey:true,altKey:true,shiftKey:true,bubbles:true,cancelable:true}))");
    await Task.Delay(200);
    if (!await Check(scene, "Boolean(document.querySelector('textarea'))")) throw new Exception("Composing shortcut closed the editor.");
    await scene.ExecuteScriptAsync("document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'F24',code:'F24',ctrlKey:true,altKey:true,shiftKey:true,bubbles:true,cancelable:true}))");
    // The all-groups chord closes the quick edit, keeping its draft, and starts adjusting; Done ends that again.
    await Wait(() => Check(web, "!document.querySelector('#stop-operation').hidden"), "local scene scope chord closes the quick edit and adjusts");
    await Wait(() => Check(scene, "!document.querySelector('textarea') && Boolean(document.querySelector('.adjust-tools'))"), "adjust overlay after the chord");
    await scene.ExecuteScriptAsync("document.querySelector('.adjust-tools button.primary').click()");
    await Wait(() => Check(web, "document.querySelector('#stop-operation').hidden"), "Done after the chord");
    await web.ExecuteScriptAsync("document.querySelector('#drafts-button').click()");
    await Wait(() => Check(web, "document.querySelector('#draft-list').textContent.includes('Draft before the shortcut exit')"), "scope chord kept exact durable draft");
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
    // Quick capture returns a main window it brought out of the tray when its editor closes, and leaves an open one open.
    const string closeEditor = "document.querySelector('#editor-dialog').dispatchEvent(new Event('cancel',{cancelable:true}))";
    main.Hide(); coordinator.DispatchAction("@capture");
    await Wait(() => Check(web, "document.querySelector('#editor-dialog').open"), "quick capture editor from the tray");
    var shownForCapture = main.IsVisible;
    await web.ExecuteScriptAsync(closeEditor);
    await Wait(() => Check(web, "!document.querySelector('#editor-dialog').open"), "quick capture editor closed with Esc");
    if (shownForCapture)
    {
      await Wait(() => Task.FromResult(!main.IsVisible), "closing quick capture returns the main window to the tray");
      Console.WriteLine("PASS quick capture from the tray hides the main window again when its editor closes");
    }
    else Console.WriteLine("SKIP quick capture re-hide: Windows did not keep the foreground the dispatch captured");
    if (!PostMessageW(trayWindow, 0x8001, IntPtr.Zero, new IntPtr((1 << 16) | 0x401))) throw new Exception("Tray selection post failed");
    await Wait(() => Task.FromResult(main.IsVisible), "tray reopens the owner after quick capture");
    coordinator.DispatchAction("@capture");
    await Wait(() => Check(web, "document.querySelector('#editor-dialog').open"), "quick capture editor over the open main window");
    await web.ExecuteScriptAsync(closeEditor);
    await Wait(() => Check(web, "!document.querySelector('#editor-dialog').open"), "quick capture over the open window closed");
    await Task.Delay(300);
    if (!main.IsVisible) throw new Exception("Closing quick capture hid a main window that was already open.");
    var recreated = RegisterWindowMessageW("TaskbarCreated");
    if (!PostMessageW(trayWindow, (int)recreated, IntPtr.Zero, IntPtr.Zero)) throw new Exception("Owned shell lifecycle post failed");
    await Task.Delay(150);
    if (!tray.Available || Shell_NotifyIconGetRect(ref identifier, out _) != 0) throw new Exception("Notification icon was not recreated.");
    // Keep the normal default chord for the remaining fixture and next native reopen.
    await web.ExecuteScriptAsync("document.querySelector('#settings-button').click()");
    await Wait(() => Check(web, "document.querySelector('#settings-dialog').open"), "restore shortcut settings");
    await web.ExecuteScriptAsync("{const all=document.querySelector('[data-shortcut-target=\"@all\"]');all.value='Ctrl+Shift+0';all.dispatchEvent(new Event('change'));document.querySelector('#close-settings').click()}");
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
