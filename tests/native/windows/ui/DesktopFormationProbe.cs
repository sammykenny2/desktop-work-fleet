using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using WorkFleet.Windows;

internal static class DesktopFormationProbe
{
  private sealed record Paper(string Id, double X, double Y, double Width, double Height);
  private static async Task<JsonElement> Eval(CoreWebView2 core, string script)
  {
    using var json = JsonDocument.Parse(await core.ExecuteScriptAsync(script)); return json.RootElement.Clone();
  }
  private static async Task Wait(CoreWebView2 core, string script, string description)
  {
    var until = DateTime.UtcNow.AddSeconds(30);
    while (DateTime.UtcNow < until)
    {
      if ((await Eval(core, script)).ValueKind == JsonValueKind.True) return;
      await Task.Delay(100);
    }
    throw new Exception($"Formation timed out: {description}; {await Eval(core, "document.body.innerText.slice(0,1000)")}");
  }
  private static async Task<Paper[]> Papers(CoreWebView2 core)
  {
    var result = await Eval(core, "[...document.querySelectorAll('.card')].map(c=>{const r=c.getBoundingClientRect();return {Id:c.dataset.cardId,X:r.x,Y:r.y,Width:r.width,Height:r.height}})");
    return JsonSerializer.Deserialize<Paper[]>(result.GetRawText())!;
  }
  public static async Task Run(string directory)
  {
    Directory.CreateDirectory(directory);
    var shell = NativeShellLayers.Discover(); var display = NativeDisplays.Read().First(d => d.Primary);
    var scale = display.Dpi / 96d; var width = (int)Math.Ceiling(620 * scale); var height = (int)Math.Ceiling(380 * scale);
    PhysicalBounds? footprint = null;
    // Use only uncovered Explorer pixels. Never minimize someone else's application or replace the wallpaper.
    for (var y = display.WorkArea.Y + 20; footprint is null && y + height <= display.WorkArea.Y + display.WorkArea.Height; y += 60)
      for (var x = display.WorkArea.X + 20; footprint is null && x + width <= display.WorkArea.X + display.WorkArea.Width; x += 60)
        if ((from dx in Enumerable.Range(0, width / 30 + 1)
             from dy in Enumerable.Range(0, height / 30 + 1)
             select ShellAt(x + Math.Min(dx * 30, width - 1), y + Math.Min(dy * 30, height - 1), shell)).All(value => value))
          footprint = new(x, y, width, height);
    if (footprint is null) { Console.WriteLine("SKIP actual owner formation pixels: no uncovered desktop area large enough for two papers"); return; }
    var bounds = footprint;
    var samples = (from dx in Enumerable.Range(0, width)
                   from dy in Enumerable.Range(0, height)
                   select (X: bounds.X + dx, Y: bounds.Y + dy)).ToArray();
    bool adjusting = false;
    int Pixel(byte[] pixels, (int X, int Y) point)
    {
      var offset = ((point.Y - bounds.Y) * bounds.Width + point.X - bounds.X) * 4;
      return pixels[offset + 2] | pixels[offset + 1] << 8 | pixels[offset] << 16;
    }
    var original = NativeScreenCapture.Read(bounds);
    NativeScreenCapture.Save(bounds, Path.Combine(directory, "before.png"));
    using var focus = new ForegroundObservation();
    var window = new FleetWindow(Program.English(Path.Combine(directory, "data")), desktopDisplays: [display with { WorkArea = bounds }])
    { WindowStartupLocation = WindowStartupLocation.Manual, Left = -20000, Top = -20000,
      ShowActivated = false, ShowInTaskbar = false, Width = 1180, Height = 800 };
    window.Show();
    // Creating notes deliberately focuses the management editor; only the passive presentation scenes may not activate.
    focus.AllowedWindow = new WindowInteropHelper(window).Handle;
    try
    {
      await Program.Wait(window, "document.querySelector('#status')?.textContent==='Local data opened'", "formation fixture initialized");
      var log = File.ReadAllText(Path.Combine(directory, "data", "host.log"));
      if (!log.Contains(" displays at start " + NativeDisplays.Describe([display with { WorkArea = bounds }]) + "\n", StringComparison.Ordinal))
        throw new Exception("host.log did not record the display inventory at start: " + log);
      var main = window.WebView.CoreWebView2;
      focus.BrowserProcess = main.BrowserProcessId;
      foreach (var title in new[] { "Formation A", "Formation B" })
      {
        await Eval(main, "document.querySelector('#new-card').click()");
        await Wait(main, "document.querySelector('#editor-dialog').open", "new synthetic note");
        await Eval(main, $"document.querySelector('#editor-text').value={JsonSerializer.Serialize("# " + title + "\n\nPixel regression")};document.querySelector('#editor-text').dispatchEvent(new Event('input',{{bubbles:true}}));document.querySelector('#editor-form').requestSubmit()");
        await Wait(main, "!document.querySelector('#editor-dialog').open", "save synthetic note");
      }
      var resident = window.Desktop!.Surfaces[0]; var floating = window.Desktop.Surfaces[1];
      // Main/editor and framework helper windows are outside the presentation-layer activation contract.
      // Match every real scene HWND; the observer already retained any activation during startup.
      focus.SceneWindows = window.Desktop.Surfaces.SelectMany(s => new[] { new WindowInteropHelper(s.InputWindow).Handle, new WindowInteropHelper(s.VisualWindow).Handle }).ToHashSet();
      Console.WriteLine($"Formation handles: owner={focus.AllowedWindow:X}; " + string.Join(";", window.Desktop.Surfaces.Select((s, index) => $"scene{index}:input={new WindowInteropHelper(s.InputWindow).Handle:X},visual={new WindowInteropHelper(s.VisualWindow).Handle:X}")));
      await Wait(resident.WebView.CoreWebView2, "document.querySelectorAll('.card').length===2", "two resident papers");
      async Task Check(DesktopSurface surface, string name)
      {
        await Wait(surface.WebView.CoreWebView2, "document.querySelectorAll('.card').length===2", name);
        await Wait(surface.WebView.CoreWebView2, "!document.querySelector('.stage-notice')", name + " transient notice ended");
        await Task.Delay(800);
        focus.Phase = name; focus.Check();
        var papers = await Papers(surface.WebView.CoreWebView2);
        var decorationJson = await Eval(surface.WebView.CoreWebView2, "[...document.querySelectorAll('.region,.region-label,.adjust-tools')].map(c=>{const r=c.getBoundingClientRect();return {Id:c.classList.contains('region')?'border':'label',X:r.x,Y:r.y,Width:r.width,Height:r.height}})");
        var decorations = JsonSerializer.Deserialize<Paper[]>(decorationJson.GetRawText())!;
        var current = NativeScreenCapture.Read(bounds);
        if (!surface.Shown) throw new Exception($"{name}: scene is not visible");
        NativeScreenCapture.Save(bounds, Path.Combine(directory, name + ".png"));
        bool Inside((int X, int Y) p, Paper c, double margin) =>
          p.X >= display.Bounds.X + (c.X - margin) * scale && p.X <= display.Bounds.X + (c.X + c.Width + margin) * scale &&
          p.Y >= display.Bounds.Y + (c.Y - margin) * scale && p.Y <= display.Bounds.Y + (c.Y + c.Height + margin) * scale;
        // Floating mode intentionally draws group labels and a thin boundary. Exclude only those visible pixels;
        // excluding the whole region rectangle would hide every stale paper pixel within the working area.
        var backgroundSamples = samples.Where(p => !papers.Any(c => Inside(p, c, 4))
          && !decorations.Any(c => c.Id == "label" ? Inside(p, c, 4) : Inside(p, c, 6) && !Inside(p, c, -6))).ToArray();
        foreach (var p in backgroundSamples)
        {
          var originalPixel = Pixel(original, p); var currentPixel = Pixel(current, p);
          // The shared adjust overlay intentionally tints the desktop with #1c242c59.
          int Expected(int shift, int tint) => adjusting ? (int)Math.Round(((originalPixel >> shift & 255) * 166 + tint * 89) / 255d) : originalPixel >> shift & 255;
          if (Math.Abs((currentPixel & 255) - Expected(0, 28)) > (adjusting ? 2 : 0)
            || Math.Abs((currentPixel >> 8 & 255) - Expected(8, 36)) > (adjusting ? 2 : 0)
            || Math.Abs((currentPixel >> 16 & 255) - Expected(16, 44)) > (adjusting ? 2 : 0))
            throw new Exception($"{name}: stale background at {p}, before={originalPixel}, after={currentPixel}, overlay={adjusting}");
        }
        var paperPixels = samples.Where(p => papers.Any(c =>
          p.X > display.Bounds.X + (c.X + 10) * scale && p.X < display.Bounds.X + (c.X + c.Width - 10) * scale &&
          p.Y > display.Bounds.Y + (c.Y + 10) * scale && p.Y < display.Bounds.Y + (c.Y + c.Height - 10) * scale));
        if (paperPixels.Count(p => Pixel(current, p) != Pixel(original, p)) < 100)
          throw new Exception($"{name}: papers did not appear on screen");
        Console.WriteLine($"PASS actual owner {name}: new paper shown and {backgroundSamples.Length} background samples checked");
      }
      await Check(resident, "desktop-initial");
      adjusting = true; focus.AllowedSceneWindows.Add(new WindowInteropHelper(floating.InputWindow).Handle);
      await Eval(main, "document.querySelector('#operate-all').click()");
      var core = floating.WebView.CoreWebView2;
      await Wait(core, "document.querySelectorAll('.card.operable').length===2", "floating operation scope");
      var origin = (await Papers(core))[0];
      // Exercise the real scene's client, native bridge, owner and durable layout. Synthetic DOM pointer capture is
      // confined to this fixture; real WPF capture outside a paper is covered separately by CompositionProbe.
      await Eval(core, """
        const root=document.querySelector('#scene'); const captures=new Set();
        root.setPointerCapture=id=>captures.add(id);root.hasPointerCapture=id=>captures.has(id);root.releasePointerCapture=id=>captures.delete(id);
        const paper=document.querySelector('.card.operable'),r=paper.getBoundingClientRect();
        const fire=(type,x,y)=>paper.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:81,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y}));
        fire('pointerdown',r.x+100,r.y+20);fire('pointermove',r.x+120,r.y+60);fire('pointermove',r.x+140,r.y+110);fire('pointerup',r.x+140,r.y+110);
        """);
      await Wait(core, FormattableString.Invariant($"(()=>{{const c=document.querySelector('.card');return Math.abs(parseFloat(c.style.left)-{origin.X + 40})<1&&Math.abs(parseFloat(c.style.top)-{origin.Y + 90})<1}})()"), "adjusted geometry");
      await Task.Delay(800);
      await Eval(main, "document.querySelector('#stop-operation').click()");
      await Wait(core, "document.querySelectorAll('.card').length===0", "leave adjustment scope");
      adjusting = false; focus.AllowedSceneWindows.Clear();
      await Check(resident, "desktop-adjusted");
      var adjusted = (await Papers(resident.WebView.CoreWebView2)).Single(c => c.Id == origin.Id);
      if (Math.Abs(adjusted.X - origin.X - 40) > 1 || Math.Abs(adjusted.Y - origin.Y - 90) > 1)
        throw new Exception("Adjusted position was not retained after leaving operation scope.");
      async Task Formation(string mode, DesktopSurface surface, string name)
      {
        var previous = await Papers(surface.WebView.CoreWebView2);
        if (ReferenceEquals(surface, floating))
          await Eval(surface.WebView.CoreWebView2, $"[...document.querySelectorAll('.adjust-tools button')].find(b=>b.textContent==='{(mode == "stack" ? "Stack" : "Spread")}').click()");
        else
        {
          await Eval(main, $"document.querySelector('#{mode}').click()");
          await Wait(main, "document.querySelector('#formation-dialog').open&&!document.querySelector('#apply-formation').disabled", name + " preview");
          await Eval(main, "document.querySelector('#apply-formation').click()");
          await Wait(main, "!document.querySelector('#formation-dialog').open&&document.querySelector('#status').textContent.includes('Arranged.')", name + " durable formation");
        }
        var until = DateTime.UtcNow.AddSeconds(10);
        while ((await Papers(surface.WebView.CoreWebView2)).SequenceEqual(previous) && DateTime.UtcNow < until) await Task.Delay(100);
        if ((await Papers(surface.WebView.CoreWebView2)).SequenceEqual(previous)) throw new Exception(name + ": geometry did not change");
        await Check(surface, name);
      }
      foreach (var pass in Enumerable.Range(0, 2))
      {
        await Formation("stack", resident, $"desktop-stack-{pass}");
        await Formation("spread", resident, $"desktop-spread-{pass}");
      }
      adjusting = true; focus.AllowedSceneWindows.Add(new WindowInteropHelper(floating.InputWindow).Handle);
      await Eval(main, "document.querySelector('#operate-all').click()");
      await Wait(core, "document.querySelectorAll('.card.operable').length===2", "formation in floating scope");
      await Formation("stack", floating, "floating-stack");
      await Formation("spread", floating, "floating-spread");
      await Eval(main, "document.querySelector('#stop-operation').click()");
      await Wait(core, "document.querySelectorAll('.card').length===0", "return after floating formation");
      adjusting = false; focus.AllowedSceneWindows.Clear();
      await Check(resident, "desktop-after-floating-formation");
      if (window.Desktop.Surfaces.Count > 2)
      {
        await Eval(main, "document.querySelector('#groups .group-row .group-menu').click()");
        await Wait(main, "Boolean(document.querySelector('dialog[open]'))", "group layer dialog");
        await Eval(main, "(()=>{const d=document.querySelector('dialog[open]');const s=[...d.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='wallpaper'));s.value='wallpaper';[...d.querySelectorAll('button')].find(b=>b.textContent==='Save').click()})()");
        await Wait(main, "!document.querySelector('dialog[open]')", "save wallpaper policy");
        var wallpaper = window.Desktop.Surfaces[2];
        await Check(wallpaper, "wallpaper-return");
        await Formation("stack", wallpaper, "wallpaper-stack");
        await Formation("spread", wallpaper, "wallpaper-spread");
      }
    }
    finally { await Program.Close(window); }
    await Task.Delay(800);
    NativeScreenCapture.Save(bounds, Path.Combine(directory, "closed.png"));
    var closed = NativeScreenCapture.Read(bounds);
    focus.Check();
    foreach (var p in samples) if (Pixel(closed, p) != Pixel(original, p)) throw new Exception($"Closed formation fixture left pixels at {p}");
    Console.WriteLine("PASS closing actual formation fixture restores its original desktop background");
  }
  private static bool ShellAt(int x, int y, NativeShellLayers shell)
  {
    var root = GetAncestor(WindowFromPoint(new PointNative { X = x, Y = y }), 2);
    return root == shell.Desktop || root == shell.Wallpaper || root == GetAncestor(shell.Wallpaper, 2);
  }
  [StructLayout(LayoutKind.Sequential)] private struct PointNative { public int X, Y; }
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(PointNative point);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
}
