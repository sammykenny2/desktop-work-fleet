using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using WorkFleet.Windows;
using WorkFleet.Windows.Core;

/// <summary>
/// SPEC-003 D on a real window: group regions laid while the primary work area was small follow it once it is larger.
/// The first launch sees a quarter of the primary work area, the second the whole of it, with the same data. The
/// floating scene draws the region frames that Ctrl+Shift+number shows; nothing is attached to Explorer for long.
/// </summary>
internal static class GridAreaProbe
{
  private sealed record Frame(double X, double Y, double Width, double Height);
  internal static async Task Run(string directory)
  {
    var data = Program.English(Path.Combine(directory, "data"));
    var display = NativeDisplays.Read().First(d => d.Primary); var scale = display.Dpi / 96d; var work = display.WorkArea;
    var small = work with { Width = work.Width / 2, Height = work.Height / 2 };
    async Task Check(PhysicalBounds area, string name)
    {
      var window = new FleetWindow(data, desktopDisplays: [display with { WorkArea = area }]) { ShowActivated = false };
      window.Show();
      try
      {
        await Program.Wait(window, "document.querySelector('#status')?.textContent === 'Local data opened'", name + " initialization");
        var main = window.WebView.CoreWebView2;
        if (name == "small")
        {
          // Adjusting needs a paper on the desktop.
          await main.ExecuteScriptAsync("document.querySelector('#new-card').click()");
          await Program.Wait(window, "document.querySelector('#editor-dialog').open", "new note");
          await main.ExecuteScriptAsync("document.querySelector('#editor-text').value='# Grid area';document.querySelector('#editor-text').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#editor-form').requestSubmit()");
          await Program.Wait(window, "!document.querySelector('#editor-dialog').open", "save note");
        }
        await main.ExecuteScriptAsync("document.querySelector('#operate-all').click()");
        await Program.Wait(window, "!document.querySelector('#stop-operation').hidden", name + " adjust all");
        Frame? frame = null; var until = DateTime.UtcNow.AddSeconds(30);
        while (frame is null && DateTime.UtcNow < until)
        {
          foreach (var surface in window.Desktop?.Surfaces ?? throw new Exception(name + ": the window has no desktop scenes"))
          {
            // Scenes start one by one; one still loading is asked again on the next pass.
            if (surface.WebView.CoreWebView2 is not { } scene) continue;
            string value;
            try { value = await scene.ExecuteScriptAsync("(()=>{const r=document.querySelector('.region')?.getBoundingClientRect();return r?{X:r.x,Y:r.y,Width:r.width,Height:r.height}:null})()"); }
            catch (Exception error) when (error is InvalidOperationException or COMException) { continue; }
            if (value != "null") { frame = JsonSerializer.Deserialize<Frame>(value); break; }
          }
          if (frame is null) await Task.Delay(100);
        }
        if (frame is null) throw new Exception(name + ": no region frame in any scene");
        // One group fills the grid, so its frame is the whole work area, in scene units from the display's corner.
        var expected = new Frame((area.X - display.Bounds.X) / scale, (area.Y - display.Bounds.Y) / scale, area.Width / scale, area.Height / scale);
        if (Math.Abs(frame.X - expected.X) > 2 || Math.Abs(frame.Y - expected.Y) > 2 || Math.Abs(frame.Width - expected.Width) > 2 || Math.Abs(frame.Height - expected.Height) > 2)
          throw new Exception($"{name}: region frame {frame} instead of the work area {expected}");
        Console.WriteLine($"PASS grid area {name}: region frame {frame.Width:0}x{frame.Height:0} matches the primary work area");
        await main.ExecuteScriptAsync("document.querySelector('#stop-operation').click()");
        await Program.Wait(window, "document.querySelector('#stop-operation').hidden", name + " finish adjusting");
      }
      finally { await Program.Close(window); }
    }
    await Check(small, "small");
    await Check(work, "grown");
  }
}
