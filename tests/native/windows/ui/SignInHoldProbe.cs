using System.IO;
using System.Text.RegularExpressions;
using WorkFleet.Windows;
using WorkFleet.Windows.Core;

/// <summary>
/// ADR-046 on a real window: a sign-in launch keeps its scenes out of Explorer while the injected state says a closed
/// laptop still drives its built-in panel next to another display, and attaches them once that panel is off. The main
/// window stays hidden as at sign-in; the empty scenes exist briefly on the primary display.
/// </summary>
internal static class SignInHoldProbe
{
  private static string directoryForErrors = "";
  internal static async Task Run(string directory)
  {
    Directory.CreateDirectory(directory); directoryForErrors = directory;
    var state = new BuiltInDisplays(true, true, true);
    var window = new FleetWindow(directory, desktopDisplays: [NativeDisplays.Read().First(d => d.Primary)],
      shell: new HostShell(directory, true, "debug"), desktopBuiltIn: () => state) { ShowActivated = false };
    window.Show();
    try
    {
      await Program.Wait(window, "document.querySelector('#status')?.textContent === '已開啟本機資料'", "sign-in launch initialization");
      await Until(() => Log(directory).Contains($"scenes waiting: {SignInDisplays.LidClosedReason}; lid=closed builtIn=on other=on changed=none\n"),
        "scenes wait while the closed lid's panel is on");
      await Task.Delay(2500);
      var surfaces = window.Desktop!.Surfaces;
      if (surfaces.Count == 0 || surfaces.Any(s => s.NativeAlive)) throw new Exception($"Scene windows exist while held: {surfaces.Count(s => s.NativeAlive)} of {surfaces.Count}.");
      Console.WriteLine($"PASS sign-in hold: no scene window for {surfaces.Count} scene(s) while the closed lid's panel is on");

      state = state with { BuiltInOn = false };
      await Until(() => window.Desktop!.Surfaces.Count > 0 && window.Desktop.Surfaces.All(s => s.NativeAlive), "scenes start once the panel is off");
      if (!Regex.IsMatch(Log(directory), @" scenes attaching after \d+\.\ds; lid=closed builtIn=off other=on changed=none\n"))
        throw new Exception("host.log did not record the release with its inputs: " + Log(directory));
      if (Log(directory).Contains(" although ")) throw new Exception("The release was logged as the time limit: " + Log(directory));
      Console.WriteLine($"PASS sign-in hold: {window.Desktop!.Surfaces.Count} scene(s) started after the panel turned off");
    }
    finally { await Program.Close(window); }
  }
  private static string Log(string directory)
  {
    var path = Path.Combine(directory, HostLog.FileName);
    if (!File.Exists(path)) return "";
    using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
    return new StreamReader(stream).ReadToEnd();
  }
  private static async Task Until(Func<bool> condition, string description)
  {
    var until = DateTime.UtcNow.AddSeconds(30);
    while (DateTime.UtcNow < until) { if (condition()) return; await Task.Delay(100); }
    throw new Exception($"Timed out: {description}; host.log:\n{Log(directoryForErrors)}");
  }
}
