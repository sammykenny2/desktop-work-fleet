using System.Windows;
using System.IO;

namespace WorkFleet.Windows;

public static class Program
{
  [STAThread]
  public static void Main()
  {
    var application = new Application();
    try { application.Run(new FleetWindow(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WorkFleet"))); }
    catch (Exception error)
    {
      MessageBox.Show(error is Core.HostError ? error.Message : "Work Fleet 無法開啟本機工作空間。請確認 WebView2 Runtime 已安裝，並保留原資料後重試。",
        "Work Fleet", MessageBoxButton.OK, MessageBoxImage.Error);
    }
  }
}
