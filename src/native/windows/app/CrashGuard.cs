using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Threading;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

/// <summary>
/// ADR-045 fatal-error handling. Desktop and wallpaper scenes are children of Explorer's desktop window, and while this
/// process is frozen (Windows Error Reporting suspends it to write a report or dump) Explorer can hang with it. So the
/// guard first takes every window of this process out of other processes' windows and checks that none is left. Only then
/// does it log, reopen a sign-in launch once after a render-thread failure, and hand the crash to Windows. If a window
/// stays inside Explorer it ends the process at once, without a report.
/// </summary>
public sealed class CrashGuard
{
  private const int MaxNested = 20;
  private readonly string directory;
  private readonly bool launchedAtLogin, restarted, canReopen;
  private readonly Stopwatch uptime = Stopwatch.StartNew();
  private readonly Action reopen;
  private readonly Action<string, Exception> fail;
  private readonly Action terminate;
  private Dispatcher? dispatcher;
  private int nested;
  public bool Failing { get; private set; }

  /// <param name="canReopen">Only the MSIX can reopen itself with its package identity and data.</param>
  /// <param name="reopen">Starts the next instance; the default asks the shell to launch this package's app.</param>
  /// <param name="fail">Hands the crash to Windows Error Reporting; the default is Environment.FailFast.</param>
  /// <param name="terminate">Ends the process without a report; the default is TerminateProcess.</param>
  public CrashGuard(string directory, bool launchedAtLogin, bool restarted, bool canReopen,
    Action? reopen = null, Action<string, Exception>? fail = null, Action? terminate = null)
  {
    this.directory = directory; this.launchedAtLogin = launchedAtLogin; this.restarted = restarted; this.canReopen = canReopen;
    this.reopen = reopen ?? ReopenPackage;
    this.fail = fail ?? ((message, error) => Environment.FailFast(message, error));
    this.terminate = terminate ?? (() => TerminateProcess(GetCurrentProcess(), 1));
  }

  public void Install(Application application, string distribution)
  {
    dispatcher = application.Dispatcher;
    application.DispatcherUnhandledException += OnDispatcherException;
    AppDomain.CurrentDomain.UnhandledException += OnUnhandled;
    TaskScheduler.UnobservedTaskException += (_, e) => { if (Interlocked.Increment(ref nested) <= MaxNested) Log("unobserved task " + HostLog.Describe(e.Exception)); };
    Log($"start version={HostIdentity.BuildVersion()} distribution={distribution} pid={Environment.ProcessId} launchedAtLogin={launchedAtLogin} restarted={restarted}");
  }
  public void Note(string text) => Log(text);
  private void Log(string text) => HostLog.Append(directory, DateTimeOffset.Now, text);

  /// <summary>Whether a fatal error of this launch reopens it: once, only for a sign-in launch that lost its renderer.</summary>
  public static bool ShouldReopen(Exception error, bool launchedAtLogin, bool restarted, bool canReopen) =>
    canReopen && launchedAtLogin && !restarted && HostLog.IsRenderThreadFailure(error);

  private void OnDispatcherException(object sender, DispatcherUnhandledExceptionEventArgs e)
  {
    // Detaching sends messages through WPF's window procedures, which fail again on a dead render thread and arrive here
    // nested, reusing these event arguments. Read the exception first and mark every one handled.
    var error = e.Exception; e.Handled = true;
    if (Failing) { if (Interlocked.Increment(ref nested) <= MaxNested) Log("nested " + HostLog.Describe(error)); return; }
    Failing = true;
    var (moved, left) = ReleaseExplorer();
    Log($"fatal ui uptime={uptime.Elapsed.TotalSeconds:F1}s detached={moved} attachedLeft={left}\n{HostLog.Describe(error)}");
    if (left > 0) { Log("windows stay inside Explorer; ending without an error report"); terminate(); return; }
    if (ShouldReopen(error, launchedAtLogin, restarted, canReopen))
    {
      try { new RestartMarker(Environment.ProcessId, DateTimeOffset.UtcNow, "render-thread").Write(directory); reopen(); Log("reopening hidden once"); }
      catch (Exception failure)
      {
        Log("reopen failed " + HostLog.Describe(failure));
        try { File.Delete(Path.Combine(directory, RestartMarker.FileName)); } catch (Exception cleanup) when (cleanup is IOException or UnauthorizedAccessException) { }
      }
    }
    fail("Work Fleet stopped after a fatal error; see host.log in its data directory.", error);
  }

  /// <summary>Any other thread: the process ends after this returns, so Windows may only report it with nothing left in Explorer.</summary>
  private void OnUnhandled(object sender, UnhandledExceptionEventArgs e)
  {
    if (Failing) return;
    Failing = true;
    var error = e.ExceptionObject as Exception ?? new Exception(e.ExceptionObject?.ToString());
    var (moved, left) = (0, -1);
    try
    {
      if (dispatcher is null || dispatcher.CheckAccess()) (moved, left) = ReleaseExplorer();
      else
      {
        var operation = dispatcher.InvokeAsync(ReleaseExplorer, DispatcherPriority.Send);
        if (operation.Wait(TimeSpan.FromSeconds(2)) == DispatcherOperationStatus.Completed) (moved, left) = operation.Result;
        else { operation.Abort(); left = Attached().Count; }
      }
    }
    catch { left = -1; }
    Log($"fatal thread uptime={uptime.Elapsed.TotalSeconds:F1}s detached={moved} attachedLeft={left}\n{HostLog.Describe(error)}");
    if (left != 0) { Log("windows may stay inside Explorer; ending without an error report"); terminate(); }
  }

  /// <summary>
  /// Hides each window of this process whose parent belongs to another process, makes it a top-level popup and removes the
  /// parent, using only user32 so no WPF state is needed. Returns how many it moved and how many are still attached.
  /// </summary>
  public static (int Moved, int Left) ReleaseExplorer()
  {
    var moved = 0;
    foreach (var window in Attached())
    {
      try
      {
        ShowWindow(window, 0);
        var style = GetWindowLongPtrW(window, -16).ToInt64();
        SetWindowLongPtrW(window, -16, new IntPtr((style & ~0x40000000L) | 0x80000000L)); // WS_CHILD out, WS_POPUP in
        SetParent(window, IntPtr.Zero); moved++;
      }
      catch { }
    }
    return (moved, Attached().Count);
  }

  /// <summary>Windows of this process placed directly inside a window of another process, such as Explorer's desktop.</summary>
  public static List<IntPtr> Attached()
  {
    var own = (uint)Environment.ProcessId; var found = new List<IntPtr>();
    EnumWindows((top, _) =>
    {
      GetWindowThreadProcessId(top, out var owner);
      if (owner != own) EnumChildWindows(top, (child, _) =>
      {
        GetWindowThreadProcessId(child, out var process);
        if (process == own)
        {
          GetWindowThreadProcessId(GetAncestor(child, 1), out var parent);
          if (parent != own) found.Add(child);
        }
        return true;
      }, IntPtr.Zero);
      return true;
    }, IntPtr.Zero);
    return found;
  }

  /// <summary>
  /// A reopened sign-in launch waits for the process it replaces before claiming the data directory, so it neither forwards
  /// to a frozen instance nor meets its owner lock. One that outlives the wait is ended. A reused process ID is left alone.
  /// </summary>
  public static string AwaitPrevious(RestartMarker marker, TimeSpan timeout, string name = "WorkFleet")
  {
    try
    {
      using var previous = Process.GetProcessById(marker.ProcessId);
      if (!string.Equals(previous.ProcessName, name, StringComparison.OrdinalIgnoreCase) || previous.StartTime.ToUniversalTime() > marker.Created.UtcDateTime)
        return "other";
      if (previous.WaitForExit(timeout)) return "exited";
      previous.Kill(); previous.WaitForExit(TimeSpan.FromSeconds(10)); return "ended";
    }
    catch (ArgumentException) { return "gone"; }
    catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException) { return "unknown"; }
  }

  /// <summary>Test-WindowsRecovery.ps1 only: the isolated probe identity with crash-probe.txt in its data directory.</summary>
  public static bool ProbeRequested(string directory)
  {
    if (!AppDataDirectory.Packaged) return false;
    try { return global::Windows.ApplicationModel.Package.Current.Id.Name.StartsWith("app.workfleet.crashprobe.", StringComparison.Ordinal) && File.Exists(Path.Combine(directory, "crash-probe.txt")); }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException or COMException) { return false; }
  }
  /// <summary>Once a scene is inside Explorer, the probe loses its renderer the way the 0.2.0 sign-in launch did.</summary>
  public void ArmProbe()
  {
    var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) }; var seen = 0;
    timer.Tick += (_, _) =>
    {
      seen = Attached().Count > 0 ? seen + 1 : 0;
      if (seen < 4 && uptime.Elapsed < TimeSpan.FromSeconds(90)) return;
      timer.Stop(); Log($"probe render-thread failure, attached={Attached().Count}");
      throw new COMException("UCEERR_RENDERTHREADFAILURE (crash probe)", HostLog.RenderThreadFailure);
    };
    timer.Start();
  }

  private static void ReopenPackage()
  {
    var family = global::Windows.ApplicationModel.Package.Current.Id.FamilyName;
    Process.Start(new ProcessStartInfo("explorer.exe", $"shell:AppsFolder\\{family}!WorkFleet") { UseShellExecute = true });
  }

  private delegate bool EnumCallback(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] private static extern IntPtr GetWindowLongPtrW(IntPtr window, int index);
  [DllImport("user32.dll")] private static extern IntPtr SetWindowLongPtrW(IntPtr window, int index, IntPtr value);
  [DllImport("user32.dll")] private static extern IntPtr SetParent(IntPtr window, IntPtr parent);
  [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] private static extern bool TerminateProcess(IntPtr process, uint code);
}
