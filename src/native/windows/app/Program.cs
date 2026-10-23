using System.Windows;
using System.IO;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

public static class Program
{
  [STAThread]
  public static void Main()
  {
    // Packaged activation arguments are only returned by the first call, so the sign-in check comes before anything else.
    var launchedAtLogin = HostShell.DetectLoginLaunch();
    var application = new Application();
    SingleInstance? instance = null;
    CrashGuard? guard = null;
    try
    {
      var directory = AppDataDirectory.Resolve();
      // The host text follows the stored display language before any dialog, tray or window appears (docs/i18n.md).
      HostText.Apply(HostPreferences.Read(directory).Language);
      // ADR-045: a sign-in launch that lost its renderer reopened itself once. It stays hidden and waits for the old process.
      var restart = RestartMarker.Take(directory, DateTimeOffset.UtcNow);
      var previous = restart is null ? null : CrashGuard.AwaitPrevious(restart, TimeSpan.FromSeconds(60));
      var probe = restart is null && CrashGuard.ProbeRequested(directory);
      var signIn = launchedAtLogin || restart is not null || probe;
      // ADR-045 amended 2026-10-14: the user turned the sign-in reopen off for now, so a failed sign-in launch stays visible
      // as a missing Work Fleet. A marker left by an earlier version is still taken above.
      guard = new CrashGuard(directory, signIn, restart is not null, canReopen: false);
      guard.Install(application, HostShell.Distribution());
      if (restart is not null) guard.Note($"reopened after {restart.Reason}; previous instance {previous}");
      // A running Work Fleet on the same data shows its main window instead of this one failing on the owner lock.
      instance = SingleInstance.Claim(directory);
      if (instance is null) { guard.Note("handed to the running instance"); return; }
      if (directory != AppDataDirectory.Unpackaged && !File.Exists(Path.Combine(directory, "fleet.sqlite3"))
        && File.Exists(Path.Combine(AppDataDirectory.Unpackaged, "fleet.sqlite3")))
        MessageBox.Show(HostText.Get("dialog.separateData"), "Work Fleet", MessageBoxButton.OK, MessageBoxImage.Information);
      var window = OpenWindow(directory, () => new FleetWindow(directory, shell: new HostShell(directory, signIn, HostShell.Distribution())), cause =>
      {
        var explanation = new DataFailureWindow(directory, cause); explanation.ShowDialog(); return explanation.SetAsideDone;
      }, guard.Note);
      if (window is null) return;
      instance.Listen(() => window.Dispatcher.BeginInvoke(new Action(window.ShowFromLaunch)));
      window.Instance = instance;
      if (probe) guard.ArmProbe();
      application.Run(window);
    }
    catch (Exception error)
    {
      guard?.Note("startup failed " + HostLog.Describe(error));
      MessageBox.Show(Describe(error), "Work Fleet", MessageBoxButton.OK, MessageBoxImage.Error);
    }
    finally { guard?.Note("exit"); instance?.Dispose(); }
  }
  /// <summary>
  /// SPEC-006 DO: when the local data cannot be opened, say why and show its folder; once the user set the data aside, open
  /// again on empty data. Null when the user closed the explanation instead. The data is opened once before the window
  /// exists: a window whose constructor throws stays registered with WPF, so the application would never shut down.
  /// </summary>
  /// <param name="explain">Shows the explanation for a cause and returns whether the user set the data aside.</param>
  public static FleetWindow? OpenWindow(string directory, Func<FleetWindow> create, Func<string, bool> explain, Action<string>? note = null)
  {
    while (true)
    {
      string? cause = null;
      try { using var check = new LocalDatabase(directory, "local"); }
      catch (HostError error) when (DataFailure.Classify(error) is { } found) { cause = found; }
      if (cause is null) return create();
      note?.Invoke("data failed " + cause);
      if (!explain(cause)) return null;
      note?.Invoke("data set aside");
    }
  }
  /// <summary>Startup refusals are English HostErrors; the dialog shows the ones a user can act on in the host language.</summary>
  private static string Describe(Exception error) => error switch
  {
    HostError { Code: "native-already-open" } => HostText.Get("dialog.alreadyOpen"),
    HostError { Code: "storage-version" } => HostText.Get("dialog.newerDatabase"),
    HostError { Code: "storage-identity" } => HostText.Get("dialog.packageDataUnknown"),
    HostError host => host.Message,
    _ => HostText.Get("dialog.startFailed")
  };
}
