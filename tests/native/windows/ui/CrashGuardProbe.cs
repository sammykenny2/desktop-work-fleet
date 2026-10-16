using Microsoft.Web.WebView2.Core;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using WorkFleet.Windows;
using WorkFleet.Windows.Core;

/// <summary>
/// ADR-045 on real windows: a scene attached as a cross-process child of an Explorer-style host, then a render-thread
/// failure raised on the dispatcher. The guard must take the scene out of the host before anything else, log, leave the
/// restart marker and ask to reopen; later failures only log. Reopening and the Windows report are recorded, not run.
/// </summary>
internal static class CrashGuardProbe
{
  internal static async Task Run(string directory)
  {
    Directory.CreateDirectory(directory);
    foreach (var name in new[] { HostLog.FileName, RestartMarker.FileName }) File.Delete(Path.Combine(directory, name));
    Policy(); await Previous();
    var start = new ProcessStartInfo(Environment.ProcessPath!, "--host-window-dcomp") { RedirectStandardOutput = true, UseShellExecute = false };
    using var host = Process.Start(start) ?? throw new Exception("Unable to start the host process.");
    try
    {
      var line = await host.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(20));
      if (line is null || !line.StartsWith("HOST ")) throw new Exception("Host process did not report its window.");
      var handle = new IntPtr(Convert.ToInt64(line[5..], 16));
      if (!GetWindowRect(handle, out var rect)) throw new Exception("Host window is gone.");
      var bounds = new PhysicalBounds(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
      var scale = GetDpiForWindow(handle) / 96d;
      using var surface = new DesktopSurface(bounds.X / scale, bounds.Y / scale, bounds.Width / scale, bounds.Height / scale, layered: false);
      surface.SetShellParent(handle);
      await surface.Start(false, bounds, await CoreWebView2Environment.CreateAsync(null, Path.Combine(directory, "webview")));
      surface.SetInput([new(20, 20, 160, 100, false)]); surface.Show(false);
      var scene = new[] { new WindowInteropHelper(surface.InputWindow).Handle, new WindowInteropHelper(surface.VisualWindow).Handle };
      var attached = CrashGuard.Attached();
      Require(scene.All(attached.Contains) && attached.Count == scene.Length, $"both scene windows are found inside the host: {attached.Count}");

      var failures = new List<Exception>(); var reopened = 0; var terminated = 0;
      var guard = new CrashGuard(directory, launchedAtLogin: true, restarted: false, canReopen: true,
        reopen: () => reopened++, fail: (_, error) => failures.Add(error), terminate: () => terminated++);
      guard.Install(Application.Current, "debug");
      _ = Application.Current.Dispatcher.BeginInvoke(new Action(() => throw new COMException("UCEERR_RENDERTHREADFAILURE (probe)", HostLog.RenderThreadFailure)));
      await Until(() => failures.Count > 0, "the failure handed to Windows");
      Require(guard.Failing && HostLog.IsRenderThreadFailure(failures[0]), "the render-thread failure is the one reported");
      Require(CrashGuard.Attached().Count == 0, "no window of this process is left inside the host");
      foreach (var window in scene)
        Require(GetAncestor(window, 1) == GetDesktopWindow() && !IsWindowVisible(window), $"scene window {window:X} is a hidden top-level window");
      Require(reopened == 1 && terminated == 0, $"reopens once and is not terminated: reopened={reopened}, terminated={terminated}");
      var marker = RestartMarker.Parse(File.ReadAllBytes(Path.Combine(directory, RestartMarker.FileName)));
      Require(marker is { Reason: "render-thread" } && marker.ProcessId == Environment.ProcessId, "restart marker names this process");
      var log = File.ReadAllText(Path.Combine(directory, HostLog.FileName));
      foreach (var text in new[] { "start version=", "launchedAtLogin=True restarted=False", $"runtime={Environment.Version}", "fatal ui", $"detached={scene.Length} attachedLeft=0",
        "System.Runtime.InteropServices.COMException HRESULT=0x88980406", "reopening hidden once" })
        Require(log.Contains(text), $"host.log has '{text}'");
      Require(log.IndexOf("fatal ui", StringComparison.Ordinal) < log.IndexOf("reopening hidden once", StringComparison.Ordinal), "the failure is logged before reopening");

      _ = Application.Current.Dispatcher.BeginInvoke(new Action(() => throw new InvalidOperationException("nested probe failure")));
      await Until(() => File.ReadAllText(Path.Combine(directory, HostLog.FileName)).Contains("nested System.InvalidOperationException"), "a later failure logged as nested");
      Require(failures.Count == 1 && reopened == 1, "a later failure neither reports nor reopens again");
      Console.WriteLine("PASS crash guard detaches scenes from the host, logs, marks and reopens once before reporting");
    }
    finally { if (!host.HasExited) host.Kill(); }
  }

  private static void Policy()
  {
    var render = new COMException("render", HostLog.RenderThreadFailure);
    Require(CrashGuard.ShouldReopen(render, true, false, true), "a sign-in launch reopens after a render-thread failure");
    Require(CrashGuard.ShouldReopen(new InvalidOperationException("wrapped", render), true, false, true), "an inner render-thread failure counts");
    Require(!CrashGuard.ShouldReopen(render, false, false, true), "a manual launch does not reopen");
    Require(!CrashGuard.ShouldReopen(render, true, true, true), "a reopened launch does not reopen again");
    Require(!CrashGuard.ShouldReopen(render, true, false, false), "only the MSIX reopens");
    Require(!CrashGuard.ShouldReopen(new InvalidOperationException("other"), true, false, true), "other failures do not reopen");
  }

  private static async Task Previous()
  {
    static Process Ping(int count) => Process.Start(new ProcessStartInfo("ping", $"-n {count} 127.0.0.1") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true })!;
    using (var running = Ping(30))
    {
      var after = DateTimeOffset.UtcNow.AddSeconds(1);
      Require(CrashGuard.AwaitPrevious(new(running.Id, after, "probe"), TimeSpan.FromMilliseconds(300), "WorkFleet") == "other" && !running.HasExited, "another program with that ID is left alone");
      Require(CrashGuard.AwaitPrevious(new(running.Id, running.StartTime.ToUniversalTime().AddSeconds(-5), "probe"), TimeSpan.FromMilliseconds(300), "PING") == "other" && !running.HasExited,
        "a process started after the marker is a reused ID");
      Require(CrashGuard.AwaitPrevious(new(running.Id, after, "probe"), TimeSpan.FromMilliseconds(300), "PING") == "ended" && running.HasExited, "an instance that outlives the wait is ended");
    }
    using (var brief = Ping(2))
      Require(CrashGuard.AwaitPrevious(new(brief.Id, DateTimeOffset.UtcNow.AddSeconds(1), "probe"), TimeSpan.FromSeconds(15), "PING") == "exited", "an instance that ends in time is waited for");
    int id;
    using (var gone = Ping(1)) { id = gone.Id; await gone.WaitForExitAsync(); }
    Require(CrashGuard.AwaitPrevious(new(id, DateTimeOffset.UtcNow, "probe"), TimeSpan.FromSeconds(1), "PING") == "gone", "an instance already gone needs no wait");
  }

  private static async Task Until(Func<bool> condition, string description)
  {
    var until = DateTime.UtcNow.AddSeconds(10);
    while (DateTime.UtcNow < until) { if (condition()) return; await Task.Delay(50); }
    throw new Exception($"Timed out: {description}");
  }
  private static void Require(bool value, string description) { if (!value) throw new Exception($"Failed: {description}"); }
  [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
  [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
}
