using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text.Json;
using WorkFleet.Windows;
using WorkFleet.Windows.Core;

/// <summary>Debug WebView inspection: opt-in, loopback-only, validated before the owner lock.</summary>
internal static class DiagnosticsProbe
{
  public static async Task Run(string directory)
  {
    if (!WebViewDiagnostics.DevToolsEnabled) throw new Exception("Release build has no WebView debugging path; run the Debug probe");
    Directory.CreateDirectory(directory);
    var previous = Environment.GetEnvironmentVariable(WebViewDiagnostics.PortVariable);
    try
    {
      Environment.SetEnvironmentVariable(WebViewDiagnostics.PortVariable, null);
      if (WebViewDiagnostics.EnvironmentOptions() is not null) throw new Exception("Debug port opened without opt-in");
      foreach (var value in new[] { "80", "1023", "65536", "abc", "+9222", " 9222", "9222 " })
      {
        Environment.SetEnvironmentVariable(WebViewDiagnostics.PortVariable, value);
        try { _ = new FleetWindow(directory); throw new Exception($"Invalid debug port accepted: '{value}'"); }
        catch (HostError error) when (error.Code == "debug-port-invalid") { }
      }
      Console.WriteLine("PASS invalid WebView debug ports rejected before the owner lock");
      var reserve = new TcpListener(IPAddress.Loopback, 0); reserve.Start();
      var port = ((IPEndPoint)reserve.LocalEndpoint).Port; reserve.Stop();
      Environment.SetEnvironmentVariable(WebViewDiagnostics.PortVariable, port.ToString(CultureInfo.InvariantCulture));
      // Same directory as the rejected constructors: a leaked owner lock would fail this open.
      var window = Program.Open(directory);
      try
      {
        await Program.Wait(window, "document.querySelector('#status')?.textContent === 'Local data opened'", "native app initialization");
        if (!window.WebView.CoreWebView2.Settings.AreDevToolsEnabled) throw new Exception("Debug DevTools disabled");
        var listeners = IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Where(e => e.Port == port).ToList();
        if (listeners.Count == 0 || listeners.Any(e => !IPAddress.IsLoopback(e.Address)))
          throw new Exception($"Debug port is not loopback-only: [{string.Join(", ", listeners)}]");
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        using var targets = JsonDocument.Parse(await http.GetStringAsync($"http://127.0.0.1:{port}/json/list"));
        var main = targets.RootElement.EnumerateArray().FirstOrDefault(t =>
          t.GetProperty("url").GetString()?.StartsWith("https://work-fleet.invalid/app/index.html", StringComparison.Ordinal) == true);
        if (main.ValueKind != JsonValueKind.Object) throw new Exception($"Main document missing from CDP targets: {targets.RootElement}");
        var status = await Evaluate(main.GetProperty("webSocketDebuggerUrl").GetString()!, "document.querySelector('#status').textContent");
        if (status != "Local data opened") throw new Exception($"CDP evaluated unexpected status: {status}");
        Console.WriteLine($"PASS Debug WebView2 CDP on 127.0.0.1:{port}: {targets.RootElement.GetArrayLength()} target(s), main document evaluated");
      }
      finally { await Program.Close(window); }
    }
    finally { Environment.SetEnvironmentVariable(WebViewDiagnostics.PortVariable, previous); }
  }
  private static async Task<string?> Evaluate(string endpoint, string expression)
  {
    using var socket = new ClientWebSocket(); using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
    await socket.ConnectAsync(new Uri(endpoint), timeout.Token);
    var request = JsonSerializer.SerializeToUtf8Bytes(new { id = 1, method = "Runtime.evaluate", @params = new { expression, returnByValue = true } });
    await socket.SendAsync(new ArraySegment<byte>(request), WebSocketMessageType.Text, true, timeout.Token);
    var buffer = new byte[64 * 1024];
    while (true)
    {
      using var message = new MemoryStream(); WebSocketReceiveResult part;
      do { part = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), timeout.Token); message.Write(buffer, 0, part.Count); }
      while (!part.EndOfMessage);
      using var reply = JsonDocument.Parse(message.ToArray());
      if (reply.RootElement.TryGetProperty("id", out var id) && id.GetInt32() == 1)
        return reply.RootElement.GetProperty("result").GetProperty("result").GetProperty("value").GetString();
    }
  }
}
