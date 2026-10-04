using System.Runtime.InteropServices;
using System.Windows.Interop;

namespace WorkFleet.Windows;

/// <summary>Owned shell notification icon and native keyboard-accessible menu. No external process manipulation.</summary>
public sealed class NativeTray : IDisposable
{
  private const int Callback = 0x8001;
  private readonly HwndSource receiver;
  private readonly Action<string, ForegroundIntent> invoke;
  private readonly uint taskbarCreated = RegisterWindowMessageW("TaskbarCreated");
  private bool disposed;
  public bool Available { get; private set; }
  public event Action? Changed;
  public event Action<bool>? MenuActive;
  public NativeTray(Action<string, ForegroundIntent> invoke)
  {
    this.invoke = invoke;
    // A hidden top-level window receives TaskbarCreated broadcasts; message-only windows do not.
    receiver = new HwndSource(new HwndSourceParameters("Work Fleet notification area") { Width = 0, Height = 0,
      WindowStyle = unchecked((int)0x80000000), ExtendedWindowStyle = 0x08000080 });
    receiver.AddHook(Receive); Add();
  }
  private NotifyData Data() => new() { Size = (uint)Marshal.SizeOf<NotifyData>(), Window = receiver.Handle, Id = 1,
    Flags = 1 | 2 | 4 | 0x80, Message = Callback, Icon = LoadIconW(IntPtr.Zero, new IntPtr(32512)),
    Tip = "Work Fleet · 記錄與桌面便箋", Info = "", Title = "", Version = 4 };
  private void Add()
  {
    if (disposed) return; var value = Data(); _ = Shell_NotifyIconW(2, ref value); Available = Shell_NotifyIconW(0, ref value);
    if (Available && !Shell_NotifyIconW(4, ref value)) { _ = Shell_NotifyIconW(2, ref value); Available = false; }
    Changed?.Invoke();
  }
  private IntPtr Receive(IntPtr window, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
  {
    if ((uint)message == taskbarCreated) { Available = false; Add(); return IntPtr.Zero; }
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
    var menu = CreatePopupMenu(); if (menu == IntPtr.Zero) return;
    try
    {
      MenuActive?.Invoke(true);
      var choices = new[] { ("show", "開啟主畫面"), ("@capture", "快速記錄"), ("@all", "操作所有便箋"),
        ("@stop", "結束桌面操作"), ("@toggle", "顯示／隱藏桌面便箋"), ("@hide", "收起主畫面"), ("exit", "保存並結束 Work Fleet") };
      for (var i = 0; i < choices.Length; i++) if (!AppendMenuW(menu, 0, (UIntPtr)(i + 1), choices[i].Item2)) return;
      var packed = coordinates.ToInt64(); var x = (int)(short)(packed & 0xffff); var y = (int)(short)((packed >> 16) & 0xffff);
      if (x == -1 && y == -1) { _ = GetCursorPos(out var point); x = point.X; y = point.Y; }
      _ = SetForegroundWindow(receiver.Handle);
      var selected = TrackPopupMenuEx(menu, 0x100 | 0x2, x, y, receiver.Handle, IntPtr.Zero);
      _ = PostMessageW(receiver.Handle, 0, IntPtr.Zero, IntPtr.Zero);
      if (selected > 0 && selected <= choices.Length) Schedule(choices[selected - 1].Item1);
      else { var value = Data(); _ = Shell_NotifyIconW(3, ref value); }
    }
    finally { _ = DestroyMenu(menu); MenuActive?.Invoke(false); }
  }
  public void Dispose()
  {
    if (disposed) return; disposed = true; var value = Data(); _ = Shell_NotifyIconW(2, ref value); Available = false;
    receiver.RemoveHook(Receive); receiver.Dispose();
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
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern bool Shell_NotifyIconW(uint message, ref NotifyData value);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint RegisterWindowMessageW(string name);
  [DllImport("user32.dll")] private static extern IntPtr LoadIconW(IntPtr instance, IntPtr name);
  [DllImport("user32.dll")] private static extern IntPtr CreatePopupMenu();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool AppendMenuW(IntPtr menu, uint flags, UIntPtr id, string label);
  [DllImport("user32.dll")] private static extern bool DestroyMenu(IntPtr menu);
  [DllImport("user32.dll")] private static extern uint TrackPopupMenuEx(IntPtr menu, uint flags, int x, int y, IntPtr owner, IntPtr options);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] private static extern bool PostMessageW(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
}
