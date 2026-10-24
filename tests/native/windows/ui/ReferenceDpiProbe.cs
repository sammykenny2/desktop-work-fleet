using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using WorkFleet.Windows;

/// <summary>
/// ADR-018 on real windows: once a display change is applied, the scenes use the new primary display's DPI, as a restart
/// on those displays would. A machine started at 3840x2160 and 150% kept that reference after it switched to 2560x1306 at
/// 100%, so its papers stayed half as large again until Work Fleet restarted. Here an offscreen primary display reported
/// at 192 DPI is replaced by one at 96 DPI while the app runs; the real monitor's DPI cancels out of every ratio checked.
/// The replacement display also has another device name, as after a switch from a remote session to the local display:
/// the Top layer must get a new scene there, which still carries adjust mode, while the attached scenes are reused.
/// </summary>
internal static class ReferenceDpiProbe
{
  // The paper's rectangle and the scene's size, in scene units, from whichever scene draws it.
  private sealed record Paper(DesktopSurface Surface, double Left, double Top, double Right, double Bottom, double Width, double Height)
  {
    public bool Inside => Left >= 0 && Top >= 0 && Right <= Width + 1 && Bottom <= Height + 1;
  }
  private static async Task<JsonElement> Eval(CoreWebView2 core, string script)
  {
    using var json = JsonDocument.Parse(await core.ExecuteScriptAsync(script)); return json.RootElement.Clone();
  }
  private static JsonElement Info(FleetWindow window) => JsonSerializer.SerializeToElement(window.Desktop!.Invoke("desktop.info", default));
  private static string[] ViewIds(JsonElement info, Func<string, bool> layer) => info.GetProperty("views").EnumerateArray()
    .Where(v => layer(v.GetProperty("layer").GetString()!)).Select(v => v.GetProperty("viewId").GetString()!).Order().ToArray();
  // Only the Top layer composes its browser into a layered window.
  private static DesktopSurface? Floating(FleetWindow window) => window.Desktop!.Surfaces.SingleOrDefault(s => s.WebView is WebView2CompositionControl);
  private static async Task Wait(CoreWebView2 core, string script, string description)
  {
    var until = DateTime.UtcNow.AddSeconds(15);
    while (DateTime.UtcNow < until)
    {
      try { if ((await Eval(core, script)).ValueKind == JsonValueKind.True) return; }
      catch (Exception error) when (error is InvalidOperationException or COMException) { }
      await Task.Delay(80);
    }
    throw new Exception("Reference DPI: timed out waiting for " + description);
  }
  private static void Check(bool condition, string description)
  {
    if (!condition) throw new Exception("Reference DPI: " + description);
  }
  private static async Task<Paper?> Find(FleetWindow window)
  {
    foreach (var surface in window.Desktop!.Surfaces)
    {
      // Scenes start one by one; one still loading is asked again on the next pass.
      if (surface.WebView.CoreWebView2 is not { } scene) continue;
      JsonElement value;
      try { value = await Eval(scene, "(()=>{const r=document.querySelector('article[data-card-id]')?.getBoundingClientRect();return r?[r.left,r.top,r.right,r.bottom,innerWidth,innerHeight]:null})()"); }
      catch (Exception error) when (error is InvalidOperationException or COMException) { continue; }
      if (value.ValueKind == JsonValueKind.Array) return new(surface, value[0].GetDouble(), value[1].GetDouble(), value[2].GetDouble(),
        value[3].GetDouble(), value[4].GetDouble(), value[5].GetDouble());
    }
    return null;
  }
  // Zoom reaches the browser asynchronously and the owner redraws after it applies, so each state is polled.
  private static async Task<Paper> Until(FleetWindow window, Func<Paper, bool> done, string description)
  {
    var until = DateTime.UtcNow.AddSeconds(30); Paper? last = null;
    while (DateTime.UtcNow < until)
    {
      if ((last = await Find(window)) is not null && done(last)) return last;
      await Task.Delay(100);
    }
    throw new Exception($"Reference DPI: {description}; last seen {last?.ToString() ?? "no paper in any scene"}");
  }
  internal static async Task Run(string directory)
  {
    var bounds = new PhysicalBounds(-20000, -20000, 1800, 1200);
    // The coordinator reads this list again on every display refresh, and Validate copies it.
    var displays = new List<DisplayInfo> { new("before", true, bounds, bounds, 192) };
    var window = new FleetWindow(Program.English(Path.Combine(directory, "data")), desktopDisplays: displays)
      { WindowStartupLocation = WindowStartupLocation.Manual, Left = -20000, Top = -20000, ShowActivated = false, ShowInTaskbar = false, Width = 1180, Height = 800 };
    window.Show();
    try
    {
      await Program.Wait(window, "document.querySelector('#status')?.textContent === 'Local data opened'", "reference DPI fixture");
      var main = window.WebView.CoreWebView2;
      await main.ExecuteScriptAsync("document.querySelector('#compose').click()");
      await Program.Wait(window, "document.querySelector('#editor-dialog').open", "new note");
      await main.ExecuteScriptAsync("document.querySelector('#editor-text').value='# Reference DPI';document.querySelector('#editor-text').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#editor-form').requestSubmit()");
      await Program.Wait(window, "!document.querySelector('#editor-dialog').open", "save note");
      var before = await Until(window, p => Math.Abs(p.Width - 900) <= 1, "scene not 900 units wide for 1800 pixels at 192 DPI");
      var zoom = before.Surface.WebView.ZoomFactor;
      Check(Info(window).GetProperty("referenceDpi").GetDouble() == 192, $"started at {Info(window).GetProperty("referenceDpi")} instead of 192");
      var oldFloating = Floating(window) ?? throw new Exception("Reference DPI: no Top-layer scene before the change");
      var oldTop = ViewIds(Info(window), layer => layer == "floating"); var oldAttached = ViewIds(Info(window), layer => layer != "floating");

      // The reported switch also changed the primary display's device name.
      displays[0] = new("after", true, bounds, bounds, 96);
      window.Desktop!.Invoke("desktop.displays.retry", default);
      var until = DateTime.UtcNow.AddSeconds(30); var info = Info(window);
      // A refresh already under way may apply the old list first; wait for the one that reads the new display.
      while (info.GetProperty("referenceDpi").GetDouble() != 96)
      {
        if (DateTime.UtcNow > until)
          throw new Exception($"Reference DPI: still {info.GetProperty("referenceDpi")} at topology {info.GetProperty("topology")} after the primary display changed to 96 DPI");
        await Task.Delay(100); info = Info(window);
      }
      var area = info.GetProperty("workAreas")[0].GetProperty("width").GetDouble();
      Check(area == 1800, $"the owner was given a {area} wide work area instead of 1800 at 96 DPI");
      var after = await Until(window, p => Math.Abs(p.Width - 1800) <= 1, "scene not 1800 units wide for 1800 pixels at 96 DPI");
      Check(Math.Abs(after.Surface.WebView.ZoomFactor * 2 - zoom) < 0.001, $"zoom {after.Surface.WebView.ZoomFactor:0.###} instead of half of {zoom:0.###}");
      // The offscreen origin moves in scene units, so the owner rescues the paper; the work areas it rescued into must be
      // in the units the scene now draws, or the paper would land outside it.
      after = await Until(window, p => Math.Abs(p.Width - 1800) <= 1 && p.Inside, "paper not inside the scene after the change");
      Console.WriteLine($"PASS reference DPI follows the primary display: 192 -> 96, zoom {zoom:0.###} -> {after.Surface.WebView.ZoomFactor:0.###}, scene {before.Width:0} -> {after.Width:0} units");

      var newTop = ViewIds(info, layer => layer == "floating");
      Check(newTop.Length == 1 && !oldTop.Contains(newTop[0]), $"Top-layer views {string.Join(",", oldTop)} -> {string.Join(",", newTop)} instead of one new view");
      Check(ViewIds(info, layer => layer != "floating").SequenceEqual(oldAttached), "the attached scenes were not reused on the new display");
      Check(!window.Desktop!.Surfaces.Contains(oldFloating), "the old Top-layer scene is still in use");
      var floating = Floating(window) ?? throw new Exception("Reference DPI: no Top-layer scene after the change");
      // The new scene creates its browser after the change is applied.
      var ready = DateTime.UtcNow.AddSeconds(30);
      while (floating.WebView.CoreWebView2 is null && DateTime.UtcNow < ready) await Task.Delay(100);
      var top = floating.WebView.CoreWebView2 ?? throw new Exception("Reference DPI: the new Top-layer scene has no browser");
      await Wait(top, "document.readyState === 'complete'", "the new Top-layer scene to load");
      await main.ExecuteScriptAsync("document.querySelector('#operate-all').click()");
      await Wait(top, "Boolean(document.querySelector('.adjust-overlay'))&&Boolean(document.querySelector('.adjust-tools'))&&document.querySelectorAll('.card.operable').length===1",
        "adjust mode in the new Top-layer scene");
      // The page draws the overlay before the host applies its frame and shows the scene; the old one closes after the apply.
      var shown = DateTime.UtcNow.AddSeconds(15);
      while ((!floating.Shown || oldFloating.NativeAlive) && DateTime.UtcNow < shown) await Task.Delay(80);
      Check(floating.Shown && floating.InputWindow.IsVisible, "the new Top-layer scene is not shown while adjusting");
      Check(!oldFloating.NativeAlive, "the old Top-layer scene's windows were not closed");
      await top.ExecuteScriptAsync("document.querySelector('.adjust-tools button.primary').click()");
      await Program.Wait(window, "document.querySelector('#stop-operation').hidden", "Done in the new Top-layer scene");
      Console.WriteLine("PASS a new display device gets a new Top-layer scene that carries adjust mode; attached scenes are reused");
    }
    finally { await Program.Close(window); }
  }
}
