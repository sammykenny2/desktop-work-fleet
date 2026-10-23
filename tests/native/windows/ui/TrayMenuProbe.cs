using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Automation.Peers;
using System.Windows.Automation.Provider;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Win32;
using WorkFleet.Windows;
using WorkFleet.Windows.Core;

/// <summary>
/// ADR-019: the tray menu as the notification icon's own callback opens it, with the rows, the Fluent theme Windows is in
/// shown whole at once and a place beside the taskbar; an item chosen with the keyboard or UI Automation runs once after the menu has closed;
/// Esc, another app coming to the front and a second right-click run nothing; and shortcuts are released each time. The
/// callback, the keys and the deactivation are messages posted to the probe's own windows; no input is injected.
/// </summary>
internal static class TrayMenuProbe
{
  private static void Require(bool value, string message) { if (!value) throw new Exception(message); }
  private static async Task Wait(Func<bool> predicate, string message)
  {
    for (var until = DateTime.UtcNow.AddSeconds(10); DateTime.UtcNow < until; await Task.Delay(25)) if (predicate()) return;
    throw new Exception("Tray menu probe timeout: " + message);
  }
  private static T? Field<T>(object value, string name) => (T?)value.GetType().GetField(name, BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(value);
  private static IEnumerable<T> Below<T>(DependencyObject root) where T : DependencyObject
  {
    for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
    {
      var child = VisualTreeHelper.GetChild(root, i);
      if (child is T match) yield return match;
      foreach (var nested in Below<T>(child)) yield return nested;
    }
  }

  public static async Task Run(string output)
  {
    Directory.CreateDirectory(output); HostText.Apply("en");
    var invoked = new List<(string Action, bool MenuOpen)>(); var active = new List<bool>();
    var rows = TrayMenu.Entries(true, false, true, [("Ctrl+Shift+N", "@capture", "available"), ("Ctrl+Shift+D", "@toggle", "conflict")]);
    NativeTray? owner = null;
    using var tray = owner = new NativeTray((action, _) => invoked.Add((action, Field<ContextMenu>(owner!, "menu")?.IsOpen == true)), () => rows);
    tray.MenuActive += active.Add;
    var receiver = Field<HwndSource>(tray, "receiver")!.Handle;
    // A right-click near the right end of the primary display's taskbar edge, as the shell reports it with NOTIFYICON_VERSION_4.
    var display = NativeDisplays.Read().Single(d => d.Primary); var work = display.WorkArea; var bounds = display.Bounds;
    var x = work.X + work.Width - 120; var y = bounds.Y + bounds.Height - 4;
    var anchor = TrayMenu.Anchor(x, y, work.X, work.Y, work.X + work.Width, work.Y + work.Height);
    void Post(int message, int wParam, long lParam) { if (!PostMessageW(receiver, message, new IntPtr(wParam), new IntPtr(lParam))) throw new Exception("Owned message post failed"); }
    // Keys reach WPF through the notification window, which has the keyboard while the menu is open; WPF routes them to the menu.
    void Press(int key) { Post(0x0100, key, 1); Post(0x0101, key, 1L | (3L << 30)); }
    void RightClick() => Post(0x8001, (y << 16) | (x & 0xffff), (1 << 16) | 0x007B);
    ContextMenu? Current() => Field<ContextMenu>(tray, "menu");
    async Task<ContextMenu> Open(ContextMenu? previous)
    {
      RightClick(); await Wait(() => Current() is { IsOpen: true, IsLoaded: true, ActualHeight: > 0 } m && !ReferenceEquals(m, previous), "menu opens on the icon's context-menu callback");
      await Task.Delay(200);
      return Current() is { IsOpen: true } open ? open : throw new Exception("The tray menu closed by itself after opening.");
    }

    var menu = await Open(null);
    Require(active.SequenceEqual([true]), "Shortcuts were not held while the menu is open.");
    // Rows: labels in the display language, separators where TrayMenu puts them, the shortcut Windows registered, the default in bold.
    var items = menu.Items.Cast<object>().ToArray();
    Require(items.Length == rows.Count, "The menu does not show one row per entry.");
    for (var i = 0; i < rows.Count; i++)
    {
      var row = rows[i];
      if (row.IsSeparator) { Require(items[i] is Separator, $"Row {i} is not a separator."); continue; }
      var item = items[i] as MenuItem ?? throw new Exception($"Row {i} is not a menu item.");
      Require((string)item.Header == HostText.Get(row.Text), $"Row {i} reads '{item.Header}'.");
      Require(item.InputGestureText == (row.Shortcut ?? ""), $"Row {i} shows the shortcut '{item.InputGestureText}'.");
      Require(item.FontWeight == (row.Default ? FontWeights.SemiBold : FontWeights.Normal), $"Row {i} has the wrong weight.");
    }
    Require(((MenuItem)items[3]).InputGestureText == "Ctrl+Shift+N" && ((MenuItem)items[4]).InputGestureText == "", "A refused shortcut is shown or a registered one is missing.");
    // The Fluent theme for the mode Windows is in, drawn: Windows 11 menus have rounded corners, the classic theme none.
    using (var personalize = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
    {
      var theme = TrayMenu.Theme(SystemParameters.HighContrast, personalize?.GetValue("SystemUsesLightTheme"));
      Require(menu.Resources.MergedDictionaries.Single().Source.OriginalString.EndsWith($"/Themes/Fluent.{theme}.xaml", StringComparison.Ordinal), "The menu does not use the Fluent theme Windows is in.");
      Require(Below<Border>(menu).Any(b => b.CornerRadius.TopLeft >= 4), "The menu is not drawn by the Fluent template.");
      // Shown whole at once: nothing in the menu moves as it opens, unlike Fluent's own slide-down.
      Require(!Below<UIElement>(menu).Prepend(menu).Any(e => e.HasAnimatedProperties || e.RenderTransform.HasAnimatedProperties), "The menu slides down as it opens.");
      Console.WriteLine($"PASS tray menu rows, shortcut and default item in the Fluent {theme} theme, shown without sliding");
    }
    // Placement: inside the work area, at the anchor moved off the taskbar.
    var popup = ((HwndSource)PresentationSource.FromVisual(menu)!).Handle;
    Require(GetWindowRect(popup, out var r), "No menu window.");
    Require(r.Left >= work.X && r.Top >= work.Y && r.Right <= work.X + work.Width && r.Bottom <= work.Y + work.Height, $"The menu ({r.Left},{r.Top})-({r.Right},{r.Bottom}) leaves the work area.");
    Require(Math.Abs(r.Bottom - anchor.Y) <= 2 || Math.Abs(r.Top - anchor.Y) <= 2, $"The menu ({r.Top}-{r.Bottom}) is not at the anchor {anchor.Y}.");
    Console.WriteLine($"PASS tray menu opens inside the work area at {anchor.X},{anchor.Y} (window {r.Left},{r.Top} {r.Right - r.Left}x{r.Bottom - r.Top})");
    NativeScreenCapture.Save(new PhysicalBounds(Math.Max(r.Left - 24, bounds.X), Math.Max(r.Top - 24, bounds.Y),
      Math.Min(r.Right - r.Left + 48, bounds.Width), Math.Min(r.Bottom - r.Top + 48, bounds.Height)), Path.Combine(output, "tray-menu.png"));
    // The shell lets the icon's owner come to the front; a probe started from a console usually may not.
    Console.WriteLine(GetForegroundWindow() == receiver
      ? "PASS Work Fleet is in front while its tray menu is open, so a click anywhere else closes the menu"
      : "SKIP tray menu foreground: Windows did not let this probe come to the front; the shell allows it for the icon's owner");

    // The keyboard: Down three times passes the separator to "Quick capture"; Enter closes the menu, then runs it once.
    Require(menu.IsKeyboardFocusWithin, "The open menu does not have the keyboard focus.");
    foreach (var next in new[] { 0, 1, 3 }) { Press(0x28); await Wait(() => Keyboard.FocusedElement == items[next], $"Down reaches row {next}"); }
    Press(0x0D);
    await Wait(() => active.Count == 2, "menu finished after a keyboard choice");
    Require(invoked.SequenceEqual([("@capture", false)]), $"The keyboard choice ran {string.Join(", ", invoked)}.");
    Require(active.SequenceEqual([true, false]), "Shortcuts were not released after a choice.");
    // UI Automation, as screen readers choose an item, takes the same path.
    menu = await Open(menu);
    ((IInvokeProvider)new MenuItemAutomationPeer((MenuItem)menu.Items[0]).GetPattern(PatternInterface.Invoke)).Invoke();
    await Wait(() => active.Count == 4, "menu finished after an automation choice");
    Require(invoked.Skip(1).SequenceEqual([("show", false)]), $"The automation choice ran {string.Join(", ", invoked)}.");
    Console.WriteLine("PASS a tray item chosen with the keyboard or UI Automation runs once, after the menu has closed, and shortcuts are released");

    // Esc closes the menu and runs nothing; focus goes back to the notification area.
    menu = await Open(menu); Press(0x1B);
    await Wait(() => active.Count == 6, "menu finished after Esc");
    Require(!menu.IsOpen && invoked.Count == 2 && Field<bool>(tray, "escaped"), "Esc ran an item or did not close the menu.");
    // Another app coming to the front, as after a click anywhere else, closes the menu the same way, leaving focus there.
    menu = await Open(menu);
    if (!PostMessageW(((HwndSource)PresentationSource.FromVisual(menu)!).Handle, 0x001C, IntPtr.Zero, IntPtr.Zero)) throw new Exception("Deactivation post failed");
    await Wait(() => active.Count == 8, "menu finished after Work Fleet left the front");
    Require(!menu.IsOpen && invoked.Count == 2 && !Field<bool>(tray, "escaped"), "Leaving the front ran an item, kept the menu open or counted as Esc.");
    // A second right-click on the icon closes the open menu and runs nothing.
    menu = await Open(menu); RightClick();
    await Wait(() => active.Count == 10, "menu finished after a second right-click");
    Require(!menu.IsOpen && invoked.Count == 2 && active.SequenceEqual([true, false, true, false, true, false, true, false, true, false]), "A second right-click left the menu open, ran an item or kept shortcuts held.");
    Console.WriteLine("PASS Esc, a click elsewhere and a second right-click close the tray menu without running anything and release shortcuts");
  }
  [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] private static extern bool PostMessageW(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
}
