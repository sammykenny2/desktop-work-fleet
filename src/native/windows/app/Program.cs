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
      var window = new FleetWindow(directory, shell: new HostShell(directory, signIn, HostShell.Distribution()));
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
