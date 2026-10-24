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
      await Program.Wait(window, "document.querySelector('#status')?.textContent === 'Local data opened'", "adjust fixture");
      var main = window.WebView.CoreWebView2;
      foreach (var title in new[] { "Adjust A", "Adjust B" })
      {
        await Eval(main, "document.querySelector('#compose').click()");
        await Wait(main, "document.querySelector('#editor-dialog').open", "new note");
        await Eval(main, $"document.querySelector('#editor-text').value={JsonSerializer.Serialize("# " + title)};document.querySelector('#editor-text').dispatchEvent(new Event('input',{{bubbles:true}}));document.querySelector('#editor-form').requestSubmit()");
        await Wait(main, "!document.querySelector('#editor-dialog').open", "save note");
      }
      var floating = window.Desktop!.Surfaces[1];
      var scene = floating.WebView.CoreWebView2;
      await Wait(scene, "document.readyState === 'complete'", "initial scene navigation");
      // These clicks are admitted before activation renders; queued owner actions must not toggle it off or open dialogs.
      await Eval(main, "document.querySelector('#operate-all').click();for(const id of ['operate-all','settings-button','compose','stack','spread','add-group','drafts-button','reset-layout'])document.getElementById(id).click()");
      // No display refresh is sent: initial scene.info must carry the same capabilities as later viewport updates.
      await Wait(scene, "Boolean(document.querySelector('.adjust-tools'))", "toolbar on the first adjustment");
      await Wait(scene, "document.querySelectorAll('.card.operable').length === 2", "adjusted papers");
      if ((await Eval(main, "Boolean(document.querySelector('dialog[open]'))")).GetBoolean())
        throw new Exception("An owner dialog queued before adjustment opened under the overlay.");
      var controls = (await Eval(scene, "[...document.querySelectorAll('.adjust-tools button')].map(b=>b.textContent).join(',')")).GetString();
      if (controls != "Stack,Spread,Undo,Done") throw new Exception("Unexpected adjust controls: " + controls);
      if (!(await Eval(scene, "(()=>{const t=document.querySelector('.adjust-tools'),r=t.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&document.elementFromPoint(r.right-20,r.top+15)?.closest('.adjust-tools')===t})()")).GetBoolean())
        throw new Exception("Adjust toolbar is clipped or not hit-testable.");
      foreach (var surface in window.Desktop.Surfaces.Where(s => !ReferenceEquals(s, floating)))
        if ((await Eval(surface.WebView.CoreWebView2, "Boolean(document.querySelector('.adjust-tools'))")).GetBoolean())
          throw new Exception("A resident layer must not display the adjust toolbar.");
      // Restoring the owner from the taskbar must not create a second interaction surface under the desktop overlay.
      window.WindowState = WindowState.Minimized; window.WindowState = WindowState.Normal;
      await Program.Wait(window, "document.documentElement.inert", "restored main window stays inert while adjusting");
      var scope = (await Eval(main, "document.querySelector('#mode-label').textContent")).GetString();
      if ((await Eval(main, "document.querySelector('#operate-all').focus();document.activeElement===document.querySelector('#operate-all')")).GetBoolean())
        throw new Exception("The main window can focus an adjustment entry under the overlay.");
      await Eval(main, "for(const id of ['operate-group','operate-all','stack','spread','stop-operation','compose','settings-button','add-group','drafts-button'])document.getElementById(id).click()");
      // Direct handlers bypass event capture, exercising the command guards as well.
      await Eval(main, "document.querySelector('#operate-all').onclick();document.querySelector('#operate-group').onclick();document.querySelector('#stack').onclick();document.querySelector('#spread').onclick()");
      await Eval(main, "document.body.dispatchEvent(new KeyboardEvent('keydown',{key:',',ctrlKey:true,bubbles:true,cancelable:true}));document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))");
      // A blocked action must neither open a dialog nor change the scope in either view.
      if ((await Eval(main, "Boolean(document.querySelector('dialog[open]'))")).GetBoolean()
        || (await Eval(main, "document.querySelector('#mode-label').textContent")).GetString() != scope
        || !(await Eval(scene, "Boolean(document.querySelector('.adjust-tools'))&&document.querySelectorAll('.card.operable').length===2")).GetBoolean())
        throw new Exception("A main-window action reentered or changed the active desktop adjustment.");
      Console.WriteLine("PASS queued duplicate adjustment entry and restored main-window input are blocked");
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
      await Arrange("Stack");
      var stacked = await Geometry();
      await Arrange("Spread");
      await Arrange("Undo");
      if (await Geometry() != stacked) throw new Exception("Undo did not restore the stacked layout.");
      using (var preview = File.Create(Path.Combine(directory, "adjust-toolbar.png")))
        await scene.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, preview);
      await Eval(scene, "document.querySelector('.adjust-tools button.primary').click()");
      await Wait(scene, "!document.querySelector('.adjust-tools')&&!document.querySelector('.adjust-overlay')&&!document.querySelector('.card.operable')", "Done ends the overlay");
      await Program.Wait(window, "document.querySelector('#stop-operation').hidden", "owner leaves adjust mode");
      if ((await Eval(main, "document.documentElement.inert")).GetBoolean()) throw new Exception("Done left the main window inert.");
      await Eval(main, "document.querySelector('#stack').click()");
      await Program.Wait(window, "document.querySelector('#formation-dialog').open", "main-window arrangement is available after Done");
      await Eval(main, "document.querySelector('#cancel-formation').click()");
      Console.WriteLine("PASS initial Windows adjust toolbar, viewport hit test, stack/spread/undo and Done through the owner");
      // A group entry uses the same controls, and Esc is the common keyboard exit.
      await Eval(main, "document.querySelector('#operate-group').click()");
      await Wait(scene, "Boolean(document.querySelector('.adjust-tools'))", "group toolbar");
      await Eval(scene, "document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      await Wait(scene, "!document.querySelector('.adjust-tools')", "Esc exits group adjustment");
      await Program.Wait(window, "document.querySelector('#stop-operation').hidden", "group exit reaches the owner");
      Console.WriteLine("PASS group adjustment shares the toolbar and Esc exits");
      // Native hosts suspend global hotkeys while the restored owner has focus; its local desktop keys must still work.
      await Eval(main, "document.querySelector('#operate-all').click()");
      await Wait(scene, "Boolean(document.querySelector('.adjust-tools'))", "adjustment before owner shortcut");
      await Eval(main, "document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'0',code:'Digit0',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))");
      await Program.Wait(window, "!document.documentElement.inert&&document.querySelector('#stop-operation').hidden", "owner shortcut ends adjustment");
      await Wait(scene, "!document.querySelector('.adjust-tools')", "owner shortcut removes the overlay");
      await Eval(main, "document.querySelector('#operate-all').click()");
      await Wait(scene, "Boolean(document.querySelector('.adjust-tools'))", "adjustment before quick capture");
      await Eval(main, "document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'N',code:'KeyN',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))");
      await Program.Wait(window, "!document.documentElement.inert&&document.querySelector('#editor-dialog').open&&document.querySelector('#stop-operation').hidden", "quick capture leaves adjustment before opening the editor");
      await Eval(main, "document.querySelector('#keep-draft').click()");
      await Program.Wait(window, "!document.querySelector('#editor-dialog').open", "close blank quick capture");
      Console.WriteLine("PASS restored owner keeps desktop shortcut exit and quick capture available");
      window.WindowState = WindowState.Minimized;
      await Eval(main, "document.querySelector('#operate-all').click()");
      await Wait(scene, "Boolean(document.querySelector('.adjust-tools'))", "toolbar from a minimized main window");
      if (await Geometry() != stacked) throw new Exception("Exiting and reentering changed the stored paper positions.");
      // Adjust mode only arranges (SPEC-003, 2026-10-24): an adjusted paper offers no buttons and a double click, even with
      // Ctrl, opens nothing.
      if (!(await Eval(scene, "document.querySelectorAll('.card-actions button').length===0")).GetBoolean()) throw new Exception("An adjusted paper offers buttons.");
      await Eval(scene, "(()=>{const c=document.querySelector('.card');const t=c?.querySelector('.card-summary')||c;if(!t)return;const r=t.getBoundingClientRect();t.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,ctrlKey:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}))})()");
      await Task.Delay(150);
      if ((await Eval(scene, "Boolean(document.querySelector('textarea'))")).GetBoolean()) throw new Exception("Adjust mode opened an editor.");
      await Eval(scene, "document.querySelector('.adjust-tools button.primary').click()");
      await Wait(scene, "!document.querySelector('.adjust-tools')", "Done after composition");
      await Program.Wait(window, "document.querySelector('#stop-operation').hidden", "minimized main stays aside");
      if (window.WindowState != WindowState.Minimized) throw new Exception("Done restored a main window that was already minimized.");
      Console.WriteLine("PASS adjusted papers open no editor; an already minimized main window stays minimized after Done");
    }
    finally { await Program.Close(window); }
  }
}
