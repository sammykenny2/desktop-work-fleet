using Microsoft.Web.WebView2.Core;
using System.Globalization;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

/// <summary>Renderer inspection for Debug builds. Release compiles no DevTools or debugging-port path.</summary>
public static class WebViewDiagnostics
{
  public const string PortVariable = "WORK_FLEET_WEBVIEW_DEBUG_PORT";
#if DEBUG
  public static bool DevToolsEnabled => true;
  /// <summary>Opt-in loopback CDP listener; unset leaves WebView2 without a debugging port.</summary>
  public static CoreWebView2EnvironmentOptions? EnvironmentOptions()
  {
    var value = Environment.GetEnvironmentVariable(PortVariable);
    if (string.IsNullOrEmpty(value)) return null;
    HostError.Require(int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var port) && port is >= 1024 and <= 65535,
      "debug-port-invalid", $"{PortVariable} 必須是 1024–65535 的連接埠。");
    return new CoreWebView2EnvironmentOptions($"--remote-debugging-port={port}");
  }
#else
  public static bool DevToolsEnabled => false;
  public static CoreWebView2EnvironmentOptions? EnvironmentOptions() => null;
#endif
}
