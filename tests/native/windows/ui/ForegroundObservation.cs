using System.Runtime.InteropServices;
using System.Text;

internal sealed class ForegroundObservation : IDisposable
{
  private delegate void WinEvent(IntPtr hook, uint eventType, IntPtr window, int objectId, int childId, uint thread, uint time);
  private readonly WinEvent callback;
  private readonly GCHandle callbackRoot;
  private readonly IntPtr hook;
  private readonly List<(IntPtr Window, IntPtr Root, uint Process, string Class, string Phase)> events = [];
  public uint BrowserProcess { get; set; }
  public IntPtr AllowedWindow { get; set; }
  public HashSet<IntPtr>? SceneWindows { get; set; }
  public string Phase { get; set; } = "initialization";
  public ForegroundObservation()
  {
    callback = (_, _, window, _, _, _, _) =>
    {
      GetWindowThreadProcessId(window, out var process);
      var name = new StringBuilder(128); GetClassNameW(window, name, name.Capacity);
      events.Add((window, GetAncestor(window, 2), process, name.ToString(), Phase));
    };
    callbackRoot = GCHandle.Alloc(callback);
    // OUTOFCONTEXT, without SKIPOWNPROCESS: WPF's message loop delivers owned and external activations on this thread.
    hook = SetWinEventHook(3, 3, IntPtr.Zero, callback, 0, 0, 0);
    if (hook == IntPtr.Zero) { callbackRoot.Free(); throw new Exception("Unable to observe foreground events."); }
  }
  public void Check()
  {
    bool Scene(IntPtr window, uint process) => SceneWindows is null ? process == Environment.ProcessId : SceneWindows.Contains(window);
    var owned = events.Where(e => (AllowedWindow == IntPtr.Zero || e.Root != AllowedWindow)
      && (Scene(e.Window, e.Process) || BrowserProcess != 0 && e.Process == BrowserProcess)).ToArray();
    if (owned.Length != 0) throw new Exception($"A non-activating scene received foreground (allowed={AllowedWindow:X}): " + string.Join(",", owned.Select(e => $"{e.Window:X}/root:{e.Root:X}/{e.Class}/PID:{e.Process}/phase:{e.Phase}")));
    var foreground = GetForegroundWindow(); GetWindowThreadProcessId(foreground, out var current);
    if ((AllowedWindow == IntPtr.Zero || GetAncestor(foreground, 2) != AllowedWindow)
      && (Scene(foreground, current) || BrowserProcess != 0 && current == BrowserProcess)) throw new Exception("Scene currently owns foreground.");
  }
  public void Dispose() { UnhookWinEvent(hook); callbackRoot.Free(); }
  [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint first, uint last, IntPtr module, WinEvent callback, uint process, uint thread, uint flags);
  [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassNameW(IntPtr window, StringBuilder name, int maximum);
}
