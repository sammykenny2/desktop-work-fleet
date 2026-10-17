using System.IO;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

/// <summary>
/// ADR-043 host behaviour around the main window: startup preferences, sign-in launch and the MSIX StartupTask.
/// Probes construct FleetWindow without a shell and keep the earlier fixed behaviour.
/// </summary>
public sealed class HostShell(string directory, bool launchedAtLogin, string distribution)
{
  private const string TaskId = "WorkFleetStartup";
  public string Directory { get; } = Path.GetFullPath(directory);
  public bool LaunchedAtLogin { get; } = launchedAtLogin;
  public HostIdentity Identity { get; } = new(HostIdentity.BuildVersion(), distribution, true);
  public HostPreferences Preferences { get; private set; } = HostPreferences.Read(directory);
  /// <summary>Only the MSIX has a StartupTask; ZIP and Debug never write a Run key.</summary>
  public static bool StartupSupported => AppDataDirectory.Packaged;
  /// <summary>Hidden at sign-in unless the user asked for the main window; a manual launch always shows it.</summary>
  public bool StartHidden => LaunchedAtLogin && !Preferences.OpenMainAtLogin;
  /// <summary>
  /// How long a hidden sign-in start waits for the tray: at sign-in the notification area can be busy or not created yet.
  /// From config/startup.json through Config/public.json.
  /// </summary>
  public TimeSpan TrayWait { get; } = StartupConfig.ReadTrayWait(AppContext.BaseDirectory);

  /// <summary>Must run first in Main: packaged activation arguments are only returned on the first call.</summary>
  public static bool DetectLoginLaunch()
  {
    if (!AppDataDirectory.Packaged) return false;
    try { return global::Windows.ApplicationModel.AppInstance.GetActivatedEventArgs()?.Kind == global::Windows.ApplicationModel.Activation.ActivationKind.StartupTask; }
    catch { return false; }
  }
  public static string Distribution()
  {
    if (AppDataDirectory.Packaged) return "msix";
#if DEBUG
    return "debug";
#else
    return "zip";
#endif
  }

  /// <summary>
  /// Brings the StartupTask in line with the preference. A task the user or policy disabled stays as Windows has it;
  /// RequestEnableAsync never overrides that choice and shows no prompt for packaged desktop apps.
  /// </summary>
  public async Task<string> SyncStartup()
  {
    if (!StartupSupported) return "unavailable";
    try
    {
      var task = await global::Windows.ApplicationModel.StartupTask.GetAsync(TaskId);
      if (Preferences.StartAtLogin && task.State == global::Windows.ApplicationModel.StartupTaskState.Disabled) return Name(await task.RequestEnableAsync());
      if (!Preferences.StartAtLogin && task.State == global::Windows.ApplicationModel.StartupTaskState.Enabled) task.Disable();
      return Name(task.State);
    }
    catch { return "unavailable"; }
  }
  private static async Task<string> ReadStartup()
  {
    if (!StartupSupported) return "unavailable";
    try { return Name((await global::Windows.ApplicationModel.StartupTask.GetAsync(TaskId)).State); }
    catch { return "unavailable"; }
  }
  private static string Name(global::Windows.ApplicationModel.StartupTaskState state) => state switch
  {
    global::Windows.ApplicationModel.StartupTaskState.Enabled => "enabled",
    global::Windows.ApplicationModel.StartupTaskState.EnabledByPolicy => "enabled-by-policy",
    global::Windows.ApplicationModel.StartupTaskState.DisabledByUser => "disabled-by-user",
    global::Windows.ApplicationModel.StartupTaskState.DisabledByPolicy => "disabled-by-policy",
    _ => "disabled"
  };
  public async Task<object> Describe(bool trayAvailable)
  {
    var state = await ReadStartup(); var available = state != "unavailable";
    return new
    {
      startAtLogin = new
      {
        available, enabled = state is "enabled" or "enabled-by-policy", preference = Preferences.StartAtLogin, state,
        reason = available ? null : HostText.Get(StartupSupported ? "reason.startupUnreadable" : "reason.startupNeedsMsix"),
        systemSettings = available
      },
      closeToTray = new { available = trayAvailable, enabled = Preferences.CloseToTray },
      openMainAtLogin = new { available, enabled = Preferences.OpenMainAtLogin },
      launchedAtLogin = LaunchedAtLogin
    };
  }
  public async Task<object> Set(string name, bool value, bool trayAvailable)
  {
    var next = Preferences.With(name, value);
    try { next.Write(Directory); }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { throw new HostError("preferences-write", "Couldn't save the startup setting. Try again later."); }
    Preferences = next;
    if (name == "startAtLogin") await SyncStartup();
    return await Describe(trayAvailable);
  }
  /// <summary>Stores the display language with the other preferences; HostText applies it.</summary>
  public void SetLanguage(string preference)
  {
    var next = Preferences.WithLanguage(preference);
    try { next.Write(Directory); }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { throw new HostError("preferences-write", "Couldn't save the display language. Try again later."); }
    Preferences = next;
  }
  /// <summary>Remembers the last update check; losing it only changes the "Last checked" time shown.</summary>
  public void RecordUpdateCheck(string time)
  {
    var next = Preferences with { LastUpdateCheck = time };
    try { next.Write(Directory); Preferences = next; } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
  }
  public static void OpenSystemSettings()
  {
    HostError.Require(StartupSupported, "startup-unavailable", "Only the installed version (MSIX) can start at sign-in.");
    try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("ms-settings:startupapps") { UseShellExecute = true }); }
    catch { throw new HostError("startup-settings", "Couldn't open the Windows startup apps settings."); }
  }
}
