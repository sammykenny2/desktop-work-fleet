using System.Text.Json;
using WorkFleet.Windows;

/// <summary>
/// A hidden main page runs its own 20-second interval only once a minute after one to two minutes in the tray (measured
/// in WebView2 155 on 2026-10-23), so sync follows the host's tick instead. This keeps the main window hidden for 270
/// seconds, past that slowdown, and requires the tick to reach the hidden page every 20 seconds; it prints the page's own
/// interval for comparison without asserting it, since throttling is the browser's choice.
/// </summary>
internal static class HiddenSyncProbe
{
  public static async Task Run(string directory)
  {
    var window = Program.Open(directory);
    await Program.Wait(window, "document.querySelector('#status')?.textContent === 'Local data opened'", "native app initialization");
    var web = window.WebView.CoreWebView2;
    await web.ExecuteScriptAsync("window.probeStart=Date.now();window.probeTicks=[];window.probeInterval=[];" +
      "const at=()=>Math.round((Date.now()-window.probeStart)/1000);" +
      "chrome.webview.addEventListener('message',event=>{if(event.data?.event==='host-tick')window.probeTicks.push([at(),document.visibilityState])});" +
      "setInterval(()=>window.probeInterval.push([at(),document.visibilityState]),20000)");
    window.Hide();
    await Task.Delay(TimeSpan.FromSeconds(270));
    var ticks = JsonSerializer.Deserialize<int[][]>(JsonSerializer.Deserialize<string>(await web.ExecuteScriptAsync(
      "JSON.stringify(window.probeTicks.filter(tick=>tick[1]==='hidden').map(tick=>[tick[0]]))"))!)!.Select(tick => tick[0]).ToArray();
    var interval = JsonSerializer.Deserialize<string>(await web.ExecuteScriptAsync("JSON.stringify(window.probeInterval)"));
    Console.WriteLine($"host ticks while hidden at {string.Join(", ", ticks)} s; the page's own interval: {interval}");
    if (ticks.Length < 12 || ticks[0] > 25 || ticks.Zip(ticks.Skip(1), (a, b) => b - a).Any(gap => gap > 25))
      throw new Exception("The host tick did not reach the hidden page every 20 seconds.");
    window.Show();
    await Program.Close(window);
    Console.WriteLine("PASS the host's 20-second tick reaches the main page while the main window is hidden");
  }
}
