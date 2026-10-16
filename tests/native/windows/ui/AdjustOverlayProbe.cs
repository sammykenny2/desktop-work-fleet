using System.IO;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using WorkFleet.Windows;

internal static class AdjustOverlayProbe
{
  private static async Task<JsonElement> Eval(CoreWebView2 core, string script)
  {
    using var json = JsonDocument.Parse(await core.ExecuteScriptAsync(script)); return json.RootElement.Clone();
  }
  private static async Task Wait(CoreWebView2 core, string script, string description)
  {
    var until = DateTime.UtcNow.AddSeconds(15);
    while (DateTime.UtcNow < until)
    {
      if ((await Eval(core, script)).ValueKind == JsonValueKind.True) return;
      await Task.Delay(80);
    }
    throw new Exception($"Adjust overlay timed out: {description}; {await Eval(core, "document.body.innerText.slice(0,1000)")}");
  }
  internal static async Task Run(string directory)
  {
    Directory.CreateDirectory(directory);
    var window = Program.Open(Path.Combine(directory, "data"));
    try
    {
      await Program.Wait(window, "document.querySelector('#status')?.textContent === '已開啟本機資料'", "adjust fixture");
      var main = window.WebView.CoreWebView2;
      foreach (var title in new[] { "Adjust A", "Adjust B" })
      {
        await Eval(main, "document.querySelector('#new-card').click()");
        await Wait(main, "document.querySelector('#editor-dialog').open", "new note");
        await Eval(main, $"document.querySelector('#editor-text').value={JsonSerializer.Serialize("# " + title)};document.querySelector('#editor-text').dispatchEvent(new Event('input',{{bubbles:true}}));document.querySelector('#editor-form').requestSubmit()");
        await Wait(main, "!document.querySelector('#editor-dialog').open", "save note");
      }
      var floating = window.Desktop!.Surfaces[1];
      var scene = floating.WebView.CoreWebView2;
      await Wait(scene, "document.readyState === 'complete'", "initial scene navigation");
      await Eval(main, "document.querySelector('#operate-all').click()");
      // No display refresh is sent: initial scene.info must carry the same capabilities as later viewport updates.
      await Wait(scene, "Boolean(document.querySelector('.adjust-tools'))", "toolbar on the first adjustment");
      await Wait(scene, "document.querySelectorAll('.card.operable').length === 2", "adjusted papers");
      var controls = (await Eval(scene, "[...document.querySelectorAll('.adjust-tools button')].map(b=>b.textContent).join(',')")).GetString();
      if (controls != "堆疊,攤開,復原,完成") throw new Exception("Unexpected adjust controls: " + controls);
      if (!(await Eval(scene, "(()=>{const t=document.querySelector('.adjust-tools'),r=t.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&document.elementFromPoint(r.right-20,r.top+15)?.closest('.adjust-tools')===t})()")).GetBoolean())
        throw new Exception("Adjust toolbar is clipped or not hit-testable.");
      foreach (var surface in window.Desktop.Surfaces.Where(s => !ReferenceEquals(s, floating)))
        if ((await Eval(surface.WebView.CoreWebView2, "Boolean(document.querySelector('.adjust-tools'))")).GetBoolean())
          throw new Exception("A resident layer must not display the adjust toolbar.");
      async Task<string> Geometry() => (await Eval(scene, "JSON.stringify([...document.querySelectorAll('.card.operable')].map(c=>[c.dataset.cardId,c.style.left,c.style.top,c.style.width,c.style.height]))")).GetString()!;
      async Task Arrange(string name)
      {
        var before = await Geometry();
        await Eval(scene, $"[...document.querySelectorAll('.adjust-tools button')].find(b=>b.textContent==={JsonSerializer.Serialize(name)}).click()");
        var until = DateTime.UtcNow.AddSeconds(15);
        while (await Geometry() == before && DateTime.UtcNow < until) await Task.Delay(80);
        if (await Geometry() == before) throw new Exception(name + " did not change the papers through the owner.");
        if (!(await Eval(scene, "Boolean(document.querySelector('.adjust-tools'))")).GetBoolean()) throw new Exception(name + " ended adjustment.");
      }
      await Arrange("堆疊");
      var stacked = await Geometry();
      await Arrange("攤開");
      await Arrange("復原");
      if (await Geometry() != stacked) throw new Exception("Undo did not restore the stacked layout.");
      using (var preview = File.Create(Path.Combine(directory, "adjust-toolbar.png")))
        await scene.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, preview);
      await Eval(scene, "document.querySelector('.adjust-tools button.primary').click()");
      await Wait(scene, "!document.querySelector('.adjust-tools')&&!document.querySelector('.adjust-overlay')&&!document.querySelector('.card.operable')", "Done ends the overlay");
      await Program.Wait(window, "document.querySelector('#stop-operation').hidden", "owner leaves adjust mode");
      Console.WriteLine("PASS initial Windows adjust toolbar, viewport hit test, stack/spread/undo and Done through the owner");
      // A group entry uses the same controls, and Esc is the common keyboard exit.
      await Eval(main, "document.querySelector('#operate-group').click()");
      await Wait(scene, "Boolean(document.querySelector('.adjust-tools'))", "group toolbar");
      await Eval(scene, "document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      await Wait(scene, "!document.querySelector('.adjust-tools')", "Esc exits group adjustment");
      await Program.Wait(window, "document.querySelector('#stop-operation').hidden", "group exit reaches the owner");
      Console.WriteLine("PASS group adjustment shares the toolbar and Esc exits");
      window.WindowState = WindowState.Minimized;
      await Eval(main, "document.querySelector('#operate-all').click()");
      await Wait(scene, "Boolean(document.querySelector('.adjust-tools'))", "toolbar from a minimized main window");
      if (await Geometry() != stacked) throw new Exception("Exiting and reentering changed the stored paper positions.");
      await Eval(scene, "[...document.querySelectorAll('.card-actions button')].find(b=>b.textContent==='編輯').click()");
      await Wait(scene, "Boolean(document.querySelector('textarea'))", "inline editor");
      await Eval(scene, "document.querySelector('textarea').value='Toolbar draft preserved';document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
      await Wait(scene, "document.querySelector('.draft-state')?.textContent==='草稿已存本機'", "durable toolbar draft");
      await Eval(scene, "document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));document.querySelector('.adjust-tools button.primary').click()");
      await Program.Wait(window, "document.querySelector('#status').textContent.includes('請先完成')", "IME blocks Done");
      if (!(await Eval(scene, "Boolean(document.querySelector('.adjust-tools'))&&document.querySelector('textarea')?.value==='Toolbar draft preserved'")).GetBoolean())
        throw new Exception("Done discarded the active IME editor.");
      await Eval(scene, "document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))");
      await Wait(scene, "!document.querySelector('textarea').readOnly&&document.querySelector('.draft-state')?.textContent==='草稿已存本機'", "composition ended");
      await Eval(scene, "document.querySelector('.adjust-tools button.primary').click()");
      await Wait(scene, "!document.querySelector('.adjust-tools')", "Done after composition");
      await Program.Wait(window, "document.querySelector('#stop-operation').hidden", "minimized main stays aside");
      if (window.WindowState != WindowState.Minimized) throw new Exception("Done restored a main window that was already minimized.");
      // Changed work is retained in unfinished drafts; beginning a fresh edit must not auto-publish it.
      await Eval(main, "document.querySelector('#drafts-button').click()");
      await Program.Wait(window, "document.querySelector('#drafts-dialog').open&&document.querySelector('#draft-list').textContent.includes('Toolbar draft preserved')", "Done retained the unfinished draft");
      await Eval(main, "[...document.querySelectorAll('#draft-list .draft-row')].find(r=>r.textContent.includes('Toolbar draft preserved')).querySelector('button').click()");
      await Program.Wait(window, "document.querySelector('#editor-dialog').open&&document.querySelector('#editor-text').value==='Toolbar draft preserved'", "recover the retained draft");
      await Eval(main, "document.querySelector('#keep-draft').click()");
      await Program.Wait(window, "!document.querySelector('#editor-dialog').open", "close recovered draft");
      Console.WriteLine("PASS Done preserves IME and durable drafts; an already minimized main window stays minimized");
    }
    finally { await Program.Close(window); }
  }
}
