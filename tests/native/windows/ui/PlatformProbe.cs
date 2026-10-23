using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Interop;
using WorkFleet.Windows;

internal static class PlatformProbe
{
  public static async Task Run()
  {
    var displays = NativeDisplays.Read();
    if (displays.Count is < 1 or > 64 || displays.Count(d => d.Primary) != 1 || displays.Select(d => d.Id).Distinct().Count() != displays.Count)
      throw new Exception("Invalid native monitor identity inventory");
    foreach (var display in displays)
    {
      var b = display.Bounds; var w = display.WorkArea;
      if (w.X < b.X || w.Y < b.Y || w.X + w.Width > b.X + b.Width || w.Y + w.Height > b.Y + b.Height
        || display.Dpi is < 48 or > 960) throw new Exception("Invalid physical work area or DPI");
    }
    Console.WriteLine($"PASS native physical display inventory: {displays.Count} monitor(s), DPI {string.Join(", ", displays.Select(d => d.Dpi))}");
    // ADR-045: the sign-in topology change that preceded the render-thread failure, as host.log records it.
    var described = NativeDisplays.Describe(NativeDisplays.Validate([
      new(@"\\.\DISPLAY2", false, new(-3840, -120, 3840, 2160), new(-3840, -120, 3840, 2100), 144),
      new(@"\\.\DISPLAY1", true, new(0, 0, 1920, 1080), new(0, 0, 1920, 1032), 120)]));
    if (described != @"2 display(s): \\.\DISPLAY1 primary 0,0 1920x1080 dpi=120; \\.\DISPLAY2 -3840,-120 3840x2160 dpi=144")
      throw new Exception("Display inventory log line changed: " + described);
    Console.WriteLine("PASS display inventory log line");
    // ADR-046: connections of the active targets. The values depend on the machine; a clone shows several targets as one monitor.
    var builtIn = NativeDisplays.ReadBuiltIn(null);
    if (!builtIn.BuiltInOn && !builtIn.OtherOn) throw new Exception("No active display target found.");
    Console.WriteLine($"PASS display connections: built-in panel {(builtIn.BuiltInOn ? "on" : "off")}, other display {(builtIn.OtherOn ? "on" : "off")}");
    // Windows answers the lid registration with the current state; a machine without a lid answers nothing.
    using (var watcher = new NativeDisplayWatcher(NativeDisplays.Read, () => { }, _ => { }, () => { }))
    {
      for (var waited = 0; watcher.LidClosed is null && waited < 20; waited++) await Task.Delay(100);
      Console.WriteLine($"PASS lid state read: {watcher.LidClosed switch { true => "closed", false => "open", null => "not reported" }}");
    }
    foreach (var key in new[] { "Meta+1", "Ctrl+F12", "Alt+F4" })
      if (NativeShortcuts.Parse(key, out _, out _) != "reserved") throw new Exception("Reserved key accepted");
    foreach (var key in new[] { "Ctrl+C", "Ctrl+Shift+Z", "Ctrl+A" })
      if (NativeShortcuts.Parse(key, out _, out _) != "editing") throw new Exception("Editing key accepted");
    foreach (var key in new[] { "Ctrl+Alt+N", "Ctrl+Alt+Q", "Ctrl+Alt+Shift+D", "Ctrl+Alt+2" })
      if (NativeShortcuts.Parse(key, out _, out _) != "typing") throw new Exception("AltGr character chord accepted");
    foreach (var key in new[] { "Shift+A", "Ctrl+Ctrl+1", "Bogus+1", "Alt+Ctrl+1", "Ctrl+F25", "Ctrl++", "Ctrl+C\n", "Ctrl+F12\n", "Alt+F4\n", "Ctrl+Alt+N\r\n" })
      if (NativeShortcuts.Parse(key, out _, out _) != "invalid") throw new Exception("Malformed key accepted");
    var invoked = new List<string>(); using var first = new NativeShortcuts(invoked.Add);
    var chord = ""; uint mods = 0, vk = 0;
    for (var number = 24; number >= 13; number--)
    {
      var candidate = $"Ctrl+Alt+Shift+F{number}";
      first.Configure([new(candidate, "@all")]);
      if (first.Registrations.Single().Status != "available") continue;
      chord = candidate; NativeShortcuts.Parse(chord, out mods, out vk); break;
    }
    if (chord.Length == 0) throw new Exception("All owned-probe shortcut candidates conflict; no registration result can be asserted");
    using var second = new NativeShortcuts(_ => throw new Exception("Unrequested shortcut action"));
    second.Configure([new(chord, "@capture")]);
    if (second.Registrations.Single().Status != "conflict") throw new Exception("Native shortcut collision was not reported");
    // The tray shows a key only when Windows registered it; suspending (an open menu, this app in front) keeps that answer.
    second.Suspend(true);
    if (second.Registrations.Single().Status != "suspended" || second.LastAnswers.Single().Status != "conflict")
      throw new Exception("A suspended key lost Windows' last answer");
    second.Suspend(false);
    if (second.Registrations.Single().Status != "conflict") throw new Exception("Resuming a refused key hid its conflict");
    var field = typeof(NativeShortcuts).GetField("receiver", BindingFlags.NonPublic | BindingFlags.Instance)!;
    var handle = ((HwndSource)field.GetValue(first)!).Handle;
    void Post(uint key) { if (!PostMessageW(handle, 0x0312, new IntPtr(1), new IntPtr((long)((key << 16) | mods)))) throw new Exception("Owned message post failed"); }
    Post(vk); first.Configure([new(chord, "@toggle")]); await Task.Delay(100);
    if (invoked.Count != 0) throw new Exception("Queued stale hotkey invoked a replacement target");
    Post(vk + 1); await Task.Delay(50);
    if (invoked.Count != 0) throw new Exception("Mismatched hotkey payload invoked action");
    Post(vk); await Task.Delay(100);
    if (!invoked.SequenceEqual(new[] { "@toggle" })) throw new Exception("Registered hotkey route failed");
    first.Suspend(true); Post(vk); await Task.Delay(50);
    if (invoked.Count != 1 || first.Registrations.Single().Status != "suspended") throw new Exception("Suspended shortcut fired");
    second.Configure([new(chord, "@capture")]);
    if (second.Registrations.Single().Status != "available") throw new Exception("Suspension retained native key registration");
    first.Suspend(false);
    if (first.Registrations.Single().Status != "conflict") throw new Exception("Resume hid native conflict");
    second.Dispose(); first.Configure([new(chord, "@all")]);
    if (first.Registrations.Single().Status != "available") throw new Exception("Disposal retained native key registration");
    first.Configure([new(chord, "source:group.1")]);
    if (first.Registrations.Single().Target != "source:group.1") throw new Exception("Valid imported group identity rejected");
    first.Configure([new(chord, "@all")]);
    try { first.Configure([new(chord, "bad target!")]); throw new Exception("Invalid shortcut settings accepted"); }
    catch (ArgumentException) { }
    try { first.Configure([new(chord, "@all\n")]); throw new Exception("Trailing-newline shortcut target accepted"); }
    catch (ArgumentException) { }
    if (first.Registrations.Single().Target != "@all") throw new Exception("Rejected settings changed registrations");
    Console.WriteLine("PASS native hotkey registration/conflict/suspend/resume/dispose and stale-message isolation; callback messages are synthetic, no keyboard input injected");
    // The shared manifest selects Common Controls 6, so the update, data and startup message boxes draw themed buttons
    // instead of the classic ones. The probe shows one, reads its button's theme, and closes it.
    var caption = "Work Fleet probe " + Guid.NewGuid().ToString("N"); bool? themed = null;
    var reader = Task.Run(async () =>
    {
      for (var waited = 0; waited < 200; waited++, await Task.Delay(50))
      {
        var dialog = FindWindowW("#32770", caption); if (dialog == IntPtr.Zero) continue;
        var button = FindWindowExW(dialog, IntPtr.Zero, "Button", null);
        themed = button != IntPtr.Zero && GetWindowTheme(button) != IntPtr.Zero;
        PostMessageW(dialog, 0x0111, new IntPtr(7), IntPtr.Zero); return; // WM_COMMAND IDNO

      }
    });
    System.Windows.MessageBox.Show("Version 0.3.9 is available (you have 0.3.8).\n\nUpdate and restart Work Fleet now? Unsaved text is saved first.", caption, System.Windows.MessageBoxButton.YesNo, System.Windows.MessageBoxImage.Question);
    await reader;
    if (themed != true) throw new Exception(themed is null ? "The probe message box did not appear." : "Message boxes draw classic, unthemed buttons.");
    Console.WriteLine("PASS native message boxes draw themed buttons");
  }
  [DllImport("user32.dll")] private static extern bool PostMessageW(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowW(string className, string windowName);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string className, string? windowName);
  [DllImport("uxtheme.dll")] private static extern IntPtr GetWindowTheme(IntPtr window);
}
