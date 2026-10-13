using System.Windows;
using System.IO;

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
    try
    {
      var directory = AppDataDirectory.Resolve();
      // A running Work Fleet on the same data shows its main window instead of this one failing on the owner lock.
      instance = SingleInstance.Claim(directory);
      if (instance is null) return;
      if (directory != AppDataDirectory.Unpackaged && !File.Exists(Path.Combine(directory, "fleet.sqlite3"))
        && File.Exists(Path.Combine(AppDataDirectory.Unpackaged, "fleet.sqlite3")))
        MessageBox.Show("找到舊版或 ZIP／Debug 版的獨立本機資料。本次 MSIX 使用自己的資料區；請先以舊版或 ZIP 版匯出備份，再於此版本匯入。原資料不會被刪除。",
          "Work Fleet", MessageBoxButton.OK, MessageBoxImage.Information);
      var window = new FleetWindow(directory, shell: new HostShell(directory, launchedAtLogin, HostShell.Distribution()));
      instance.Listen(() => window.Dispatcher.BeginInvoke(new Action(window.ShowFromLaunch)));
      application.Run(window);
    }
    catch (Exception error)
    {
      MessageBox.Show(error is Core.HostError ? error.Message : "Work Fleet 無法開啟本機工作空間。請確認 WebView2 Runtime 已安裝，並保留原資料後重試。",
        "Work Fleet", MessageBoxButton.OK, MessageBoxImage.Error);
    }
    finally { instance?.Dispose(); }
  }
}
