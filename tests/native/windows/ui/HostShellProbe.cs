using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using WorkFleet.Windows;
using WorkFleet.Windows.Core;

/// <summary>
/// ADR-043 on a real window: startup settings in the Desktop page, saved and restored bounds, reset and the second-launch
/// channel. The window appears briefly on the primary display without taking focus; data stays in the output folder.
/// </summary>
internal static class HostShellProbe
{
  private static string? directoryForErrors;
  internal static async Task Run(string directory)
  {
    Directory.CreateDirectory(directory); directoryForErrors = directory;
    await SecondLaunch(directory);
    var window = Open(directory);
    await Program.Wait(window, "document.querySelector('#status')?.textContent === 'Local data opened'", "host shell initialization");
    await Eval(window, "document.querySelector('#settings-button').click()");
    await Program.Wait(window, "document.querySelector('#settings-dialog').open", "settings");
    await Eval(window, "document.querySelector('[data-page=desktop]').click()");
    var version = HostIdentity.BuildVersion();
    await Program.Wait(window, $"!document.querySelector('#host-settings').hidden && document.querySelector('#app-version').textContent === 'Work Fleet {version} (preview)' && document.querySelector('#app-distribution').textContent === 'Development build'", "version shown");
    // Only the MSIX has a StartupTask, so a Debug build explains why the sign-in switches are unavailable.
    await Program.Wait(window, $"document.querySelector('#start-login').disabled && document.querySelector('#start-login-detail').textContent === '{HostText.Format("en", "reason.startupNeedsMsix")}' && document.querySelector('#open-main').disabled", "sign-in switches unavailable outside the MSIX");
    await Program.Wait(window, "!document.querySelector('#close-tray').disabled && document.querySelector('#close-tray').checked", "close keeps Work Fleet in the tray by default");
    await Eval(window, "const tray=document.querySelector('#close-tray');tray.checked=false;tray.dispatchEvent(new Event('change'))");
    await Until(() => HostPreferences.Read(directory) is { CloseToTray: false }, "close-to-tray preference saved");
    await Program.Wait(window, "!document.querySelector('#close-tray').checked", "close-to-tray switch shows the saved value");
    // Settings > General > Display language: host.language.set stores the choice beside the other preferences, the host
    // text follows it at once, and the window switches without reloading.
    static string Choose(string value) => $"(()=>{{const language=document.querySelector('#language');language.value='{value}';language.dispatchEvent(new Event('change'))}})()";
    await Eval(window, Choose("zh-TW"));
    await Until(() => HostPreferences.Read(directory) is { Language: "zh-TW", CloseToTray: false } && HostText.Locale == "zh-TW", "display language stored and applied by the host");
    await Program.Wait(window, "document.documentElement.lang === 'zh-TW' && document.querySelector('#language').value === 'zh-TW'", "the window follows the stored language");
    await Eval(window, Choose("en"));
    await Program.Wait(window, "document.documentElement.lang === 'en' && document.querySelector('#language').value === 'en'", "the window is English again");
    await Until(() => HostPreferences.Read(directory).Language == "en" && HostText.Locale == "en", "display language back to English");

    var area = NativeDisplays.Read()[0].WorkArea; var dpi = (int)NativeDisplays.Read()[0].Dpi;
    // Larger than the window's 380×520 DIP minimum at this display's DPI, so Windows keeps the exact size.
    var moved = new SavedPlacement(area.X + 40, area.Y + 30, Math.Min(Math.Max(900, 400 * dpi / 96), area.Width - 80), Math.Min(Math.Max(640, 560 * dpi / 96), area.Height - 60), false);
    Move(window, moved);
    await Until(() => WindowPlacement.Read(directory) == moved, "moved bounds saved");
    window.WindowState = WindowState.Maximized;
    await Until(() => WindowPlacement.Read(directory) == moved with { Maximized = true }, "maximized flag saved with restore bounds");
    window.WindowState = WindowState.Minimized; await Task.Delay(800);
    if (WindowPlacement.Read(directory) != moved with { Maximized = true }) throw new Exception("Minimizing changed the saved bounds.");
    // A window minimized from maximized comes back maximized; leaving maximized then clears the flag.
    window.WindowState = WindowState.Maximized; await Task.Delay(300); window.WindowState = WindowState.Normal;
    await Until(() => WindowPlacement.Read(directory) == moved, "restore clears the maximized flag");

    await Eval(window, "document.querySelector('#reset-window').click()");
    await Until(() => WindowPlacement.Read(directory) is null && Bounds(window) == Default(area, dpi), "reset removes the file and centres the default size");
    Move(window, moved);
    await Until(() => WindowPlacement.Read(directory) == moved, "bounds saved again after reset");
    await Eval(window, "document.querySelector('#settings-dialog').close()");
    await Program.Close(window);

    window = Open(directory);
    await Program.Wait(window, "document.querySelector('#status')?.textContent === 'Local data opened'", "reopen");
    if (Bounds(window) != moved) throw new Exception($"Reopened at {Bounds(window)} instead of {moved}.");
    await Program.Close(window);
    WindowPlacement.Write(directory, moved with { X = area.X + area.Width + 50_000 });
    window = Open(directory);
    await Program.Wait(window, "document.querySelector('#status')?.textContent === 'Local data opened'", "reopen after display loss");
    if (Bounds(window) != Default(area, dpi)) throw new Exception($"Bounds on a missing display were not replaced: {Bounds(window)}.");
    await Program.Close(window);
    Console.WriteLine("PASS Windows startup settings, main window placement and second launch");
  }
  private static async Task SecondLaunch(string directory)
  {
    var shown = new TaskCompletionSource();
    using var first = SingleInstance.Claim(directory) ?? throw new Exception("No running instance should own a new data directory.");
    first.Listen(() => shown.TrySetResult());
    var second = await Task.Run(() => SingleInstance.Claim(directory));
    if (second is not null) { second.Dispose(); throw new Exception("A second launch did not reach the running instance."); }
    await shown.Task.WaitAsync(TimeSpan.FromSeconds(5));
    using var other = await Task.Run(() => SingleInstance.Claim(Path.Combine(directory, "other-data")));
    if (other is null) throw new Exception("A different data directory reached the wrong instance.");
  }
  private static FleetWindow Open(string directory)
  {
    var window = new FleetWindow(Program.English(directory), shell: new HostShell(directory, false, "debug")) { ShowActivated = false };
    window.Show(); return window;
  }
  private static SavedPlacement Default(PhysicalBounds area, int dpi)
  {
    int width = Math.Min(1180 * dpi / 96, area.Width), height = Math.Min(800 * dpi / 96, area.Height);
    return new(area.X + (area.Width - width) / 2, area.Y + (area.Height - height) / 2, width, height, false);
  }
  private static SavedPlacement Bounds(Window window)
  {
    GetWindowRect(new WindowInteropHelper(window).Handle, out var rect);
    return new(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top, false);
  }
  private static void Move(Window window, SavedPlacement value) =>
    SetWindowPos(new WindowInteropHelper(window).Handle, IntPtr.Zero, value.X!.Value, value.Y!.Value, value.Width, value.Height, 0x0004 | 0x0010);
  private static async Task Until(Func<bool> condition, string description)
  {
    var until = DateTime.UtcNow.AddSeconds(10);
    while (DateTime.UtcNow < until) { if (condition()) return; await Task.Delay(100); }
    throw new Exception($"Timed out: {description}; saved {WindowPlacement.Read(directoryForErrors ?? "")}");
  }
  private static async Task<JsonElement> Eval(FleetWindow window, string source)
  {
    var json = await window.WebView.CoreWebView2.ExecuteScriptAsync(source);
    using var value = JsonDocument.Parse(json); return value.RootElement.Clone();
  }
  [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
}
