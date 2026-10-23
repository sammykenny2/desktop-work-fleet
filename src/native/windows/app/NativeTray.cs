using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Markup;
using System.Windows.Threading;
using Microsoft.Win32;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

/// <summary>
/// Owned shell notification icon and its keyboard-accessible menu. No external process manipulation. The menu is a WPF
/// context menu in WPF's Fluent (Windows 11) theme, light, dark or high contrast as Windows is when it opens (ADR-019).
/// Labels and the tooltip come from HostText, so the menu follows the display language each time it opens.
/// </summary>
public sealed class NativeTray : IDisposable
{
  private static readonly Dictionary<string, ResourceDictionary> themes = [];
  private static ControlTemplate? still;
  private const int Callback = 0x8001;
  private const int Retries = 30;
  private readonly HwndSource receiver;
  private readonly Action<string, ForegroundIntent> invoke;
  private readonly Func<IReadOnlyList<TrayEntry>> entries;
  private readonly uint taskbarCreated = RegisterWindowMessageW("TaskbarCreated");
  private readonly IntPtr icon;
  private readonly bool ownsIcon;
  // At sign-in the notification area can time out or not exist yet, so a failed add is retried every 2 s for a minute (ADR-043).
  private readonly DispatcherTimer retry = new(DispatcherPriority.Background) { Interval = TimeSpan.FromSeconds(2) };
  private int attempts;
  private string tip = HostText.Get("tray.tip");
  private bool disposed;
  private ContextMenu? menu;
  private string? chosen;
  private bool escaped;
  private int opened;
  public bool Available { get; private set; }
  /// <summary>Raised when the icon appears or goes away; a failed retry of an icon that was never there is not a change.</summary>
  public event Action? Changed;
  public event Action<bool>? MenuActive;
  /// <param name="entries">The menu rows for the state the menu opens in (TrayMenu.Entries).</param>
  public NativeTray(Action<string, ForegroundIntent> invoke, Func<IReadOnlyList<TrayEntry>> entries)
  {
    this.invoke = invoke; this.entries = entries;
    // The executable's embedded icon at notification-area size; the stock application icon only if none is embedded.
    var small = new IntPtr[1];
    ownsIcon = Environment.ProcessPath is { } path && ExtractIconExW(path, 0, null, small, 1) > 0 && small[0] != IntPtr.Zero;
    icon = ownsIcon ? small[0] : LoadIconW(IntPtr.Zero, new IntPtr(32512));
    // A hidden top-level window receives TaskbarCreated broadcasts; message-only windows do not.
    receiver = new HwndSource(new HwndSourceParameters("Work Fleet notification area") { Width = 0, Height = 0,
      WindowStyle = unchecked((int)0x80000000), ExtendedWindowStyle = 0x08000080 });
    receiver.AddHook(Receive); retry.Tick += (_, _) => Retry(); Add();
    receiver.Dispatcher.BeginInvoke(new Action(Prepare), DispatcherPriority.ApplicationIdle);
  }
  private NotifyData Data() => new() { Size = (uint)Marshal.SizeOf<NotifyData>(), Window = receiver.Handle, Id = 1,
    Flags = 1 | 2 | 4 | 0x80, Message = Callback, Icon = icon,
    Tip = tip, Info = "", Title = "", Version = 4 };
  /// <summary>An open menu does not repaint, so update progress shows in the tooltip instead; null shows the usual tooltip.</summary>
  public void SetTip(string? text)
  {
    tip = string.IsNullOrEmpty(text) ? HostText.Get("tray.tip") : text.Length > 120 ? text[..120] : text;
    if (disposed || !Available) return; var value = Data(); _ = Shell_NotifyIconW(1, ref value);
  }
  private void Add()
  {
    if (disposed) return; var was = Available; var value = Data(); _ = Shell_NotifyIconW(2, ref value); Available = Shell_NotifyIconW(0, ref value);
    if (Available && !Shell_NotifyIconW(4, ref value)) { _ = Shell_NotifyIconW(2, ref value); Available = false; }
    if (Available) retry.Stop();
    else if (!retry.IsEnabled) { attempts = 0; retry.Start(); }
    if (Available != was) Changed?.Invoke();
  }
  /// <summary>TaskbarCreated still adds the icon when Explorer starts or restarts after the retries ended.</summary>
  private void Retry()
  {
    if (disposed || Available || ++attempts > Retries) { retry.Stop(); return; }
    Add();
  }
  private IntPtr Receive(IntPtr window, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
  {
    if ((uint)message == taskbarCreated) { Add(); return IntPtr.Zero; }
    if (disposed || message != Callback || ((lParam.ToInt64() >> 16) & 0xffff) != 1) return IntPtr.Zero;
    handled = true; var code = (int)(lParam.ToInt64() & 0xffff);
    if (code is 0x400 or 0x401) Schedule("show"); // NIN_SELECT / NIN_KEYSELECT
    if (code == 0x007B) Menu(wParam);
    return IntPtr.Zero;
  }
  private void Schedule(string action)
  {
    var intent = new ForegroundIntent();
    receiver.Dispatcher.BeginInvoke(new Action(() => { if (!disposed) invoke(action, intent); }));
  }
  private void Menu(IntPtr coordinates)
  {
    // Right-clicking the icon while the menu is open closes it.
    if (menu?.IsOpen == true) { menu.IsOpen = false; return; }
    var packed = coordinates.ToInt64(); var x = (int)(short)(packed & 0xffff); var y = (int)(short)((packed >> 16) & 0xffff);
    if (x == -1 && y == -1) { _ = GetCursorPos(out var point); x = point.X; y = point.Y; }
    MenuActive?.Invoke(true); var generation = ++opened; chosen = null; escaped = false;
    try
    {
      var next = Build(generation);
      // The menu opens beside the taskbar, at the anchor's display DPI; the offsets are device-independent units.
      var monitor = MonitorFromPoint(new Point { X = x, Y = y }, 2); var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
      if (GetMonitorInfoW(monitor, ref info)) (x, y) = TrayMenu.Anchor(x, y, info.Work.Left, info.Work.Top, info.Work.Right, info.Work.Bottom);
      var scale = GetDpiForMonitor(monitor, 0, out var dpi, out _) == 0 ? dpi / 96d : 1;
      next.HorizontalOffset = x / scale; next.VerticalOffset = y / scale;
      // With Work Fleet in front, as the shell allows for the icon's owner, the opening menu takes the keyboard and closes
      // on a click anywhere else. Bringing the menu's own window forward after it opens moves WPF's focus and closes it.
      _ = SetForegroundWindow(receiver.Handle);
      menu = next; next.IsOpen = true;
      // The popup window can start on another display; its own scale is the one the offsets are read in.
      var actual = PresentationSource.FromVisual(next) is HwndSource popup ? popup.CompositionTarget.TransformToDevice.M11 : scale;
      if (Math.Abs(actual - scale) > 0.001) { next.HorizontalOffset = x / actual; next.VerticalOffset = y / actual; }
    }
    catch { opened++; MenuActive?.Invoke(false); throw; }
  }
  private ContextMenu Build(int generation)
  {
    var next = new ContextMenu { Placement = PlacementMode.AbsolutePoint, Language = XmlLanguage.GetLanguage(HostText.Locale), Template = Still() };
    next.Resources.MergedDictionaries.Add(Theme());
    foreach (var entry in entries())
    {
      if (entry.IsSeparator) { next.Items.Add(new Separator()); continue; }
      // WPF reads one underscore as an access-key mark; two keep it as text. The shortcut is drawn right-aligned.
      var item = new MenuItem { Header = HostText.Get(entry.Text).Replace("_", "__"), InputGestureText = entry.Shortcut ?? "" };
      // The default item is the one the icon's click runs.
      if (entry.Default) item.FontWeight = FontWeights.SemiBold;
      item.Click += (_, _) => { if (generation == opened) chosen = entry.Action; };
      next.Items.Add(item);
    }
    next.PreviewKeyDown += (_, e) => { if (generation == opened && e.Key == Key.Escape) escaped = true; };
    next.Closed += (_, _) => Closed(generation);
    return next;
  }
  /// <summary>
  /// The first menu loads WPF's Fluent theme and templates, about a second; laying out one that never opens while Work
  /// Fleet is idle keeps the first right-click quick.
  /// </summary>
  private void Prepare()
  {
    if (disposed || opened > 0) return;
    // A menu that cannot be prepared now is built when it opens; an idle failure must not end Work Fleet.
    try { Build(0).Measure(new Size(double.PositiveInfinity, double.PositiveInfinity)); } catch (Exception) { }
  }
  private void Closed(int generation)
  {
    // A chosen item raises Click after the menu has hidden, at render priority, and Closed follows when its window is
    // destroyed; this runs after both.
    receiver.Dispatcher.BeginInvoke(new Action(() =>
    {
      if (disposed || generation != opened) return;
      // The intent the action captures names the notification window. A click on the menu lets Work Fleet come to the
      // front even when Windows refused it as the menu opened.
      if (chosen is { } action) { _ = SetForegroundWindow(receiver.Handle); Schedule(action); }
      // Esc, or any close that leaves the hidden notification window in front, returns the keyboard to the notification
      // area; a click on another app leaves it there.
      else if (escaped || GetForegroundWindow() == receiver.Handle) { var value = Data(); _ = Shell_NotifyIconW(3, ref value); }
      MenuActive?.Invoke(false);
    }), DispatcherPriority.Background);
  }
  /// <summary>
  /// Fluent's ContextMenu template (dotnet/wpf release/10.0, Styles/ContextMenu.xaml) without its trigger that slides the
  /// frame down as the menu opens, so the tray menu shows whole at once; the style still gives its colors and border.
  /// </summary>
  private static ControlTemplate Still() => still ??= (ControlTemplate)XamlReader.Parse("""
    <ControlTemplate TargetType="ContextMenu" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
      <Border x:Name="Border" Padding="0,3,0,3" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}"
              BorderThickness="{TemplateBinding BorderThickness}" CornerRadius="8">
        <ScrollViewer CanContentScroll="True" HorizontalScrollBarVisibility="Disabled" VerticalScrollBarVisibility="Auto">
          <StackPanel ClipToBounds="True" IsItemsHost="True" KeyboardNavigation.DirectionalNavigation="Cycle" Orientation="Vertical" />
        </ScrollViewer>
      </Border>
    </ControlTemplate>
    """);
  /// <summary>Fluent.Light, Fluent.Dark or Fluent.HC from WPF's Fluent assembly, loaded once each.</summary>
  private static ResourceDictionary Theme()
  {
    using var personalize = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
    var name = TrayMenu.Theme(SystemParameters.HighContrast, personalize?.GetValue("SystemUsesLightTheme"));
    if (!themes.TryGetValue(name, out var theme))
      themes[name] = theme = new ResourceDictionary { Source = new Uri($"pack://application:,,,/PresentationFramework.Fluent;component/Themes/Fluent.{name}.xaml") };
    return theme;
  }
  public void Dispose()
  {
    if (disposed) return; disposed = true; retry.Stop(); var value = Data(); _ = Shell_NotifyIconW(2, ref value); Available = false;
    if (menu is not null) menu.IsOpen = false;
    receiver.RemoveHook(Receive); receiver.Dispose();
    if (ownsIcon) _ = DestroyIcon(icon);
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct NotifyData
  {
    public uint Size; public IntPtr Window; public uint Id, Flags, Message; public IntPtr Icon;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Tip;
    public uint State, StateMask;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Info;
    public uint Version;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string Title;
    public uint InfoFlags; public Guid Guid; public IntPtr BalloonIcon;
  }
  [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern bool Shell_NotifyIconW(uint message, ref NotifyData value);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint RegisterWindowMessageW(string name);
  [DllImport("user32.dll")] private static extern IntPtr LoadIconW(IntPtr instance, IntPtr name);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern uint ExtractIconExW(string file, int index, IntPtr[]? large, IntPtr[]? small, uint count);
  [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
  [DllImport("user32.dll")] private static extern IntPtr MonitorFromPoint(Point point, uint flags);
  [DllImport("user32.dll")] private static extern bool GetMonitorInfoW(IntPtr monitor, ref MonitorInfo info);
  [DllImport("shcore.dll")] private static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint x, out uint y);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
}
