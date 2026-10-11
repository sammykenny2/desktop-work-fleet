using System.Windows;
using System.IO;

namespace WorkFleet.Windows;

public static class Program
{
  [STAThread]
  public static void Main()
  {
    var application = new Application();
    try
    {
      var directory = AppDataDirectory.Resolve();
      if (directory != AppDataDirectory.Unpackaged && !File.Exists(Path.Combine(directory, "fleet.sqlite3"))
        && File.Exists(Path.Combine(AppDataDirectory.Unpackaged, "fleet.sqlite3")))
        MessageBox.Show("找到舊版或 ZIP／Debug 版的獨立本機資料。本次 MSIX 使用自己的資料區；請先以舊版或 ZIP 版匯出備份，再於此版本匯入。原資料不會被刪除。",
          "Work Fleet", MessageBoxButton.OK, MessageBoxImage.Information);
      application.Run(new FleetWindow(directory));
    }
    catch (Exception error)
    {
      MessageBox.Show(error is Core.HostError ? error.Message : "Work Fleet 無法開啟本機工作空間。請確認 WebView2 Runtime 已安裝，並保留原資料後重試。",
        "Work Fleet", MessageBoxButton.OK, MessageBoxImage.Error);
    }
  }
}
