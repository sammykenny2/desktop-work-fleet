using System.IO;
using System.Runtime.InteropServices;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

/// <summary>MSIX uses its explicit private data store; ZIP and Debug keep the unpackaged workspace.</summary>
internal static class AppDataDirectory
{
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetCurrentPackageFullName(ref uint length, IntPtr packageFullName);

  internal static string Resolve()
  {
    uint length = 0;
    var result = GetCurrentPackageFullName(ref length, IntPtr.Zero);
    if (result == 15700) return Unpackaged;
    HostError.Require(result == 122 && length > 0, "storage-identity", "無法確認 Windows 套件資料位置，請保留原資料後重試。");
    // Keep the existing MSIX redirected location, including SQLite/WAL, vaults, profile and WebView2 data.
    // An existing ZIP/Debug directory must not change the package's storage or uninstall lifecycle.
    return Path.Combine(global::Windows.Storage.ApplicationData.Current.LocalCacheFolder.Path, "Local", "WorkFleet");
  }

  internal static string Unpackaged => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WorkFleet");
}
