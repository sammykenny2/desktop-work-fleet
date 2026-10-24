using Microsoft.Web.WebView2.Core;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.IO;
using WorkFleet.Windows;
using WorkFleet.Windows.Core;

internal static class DesktopIntegrationProbe
{
  private static async Task<JsonElement> Eval(CoreWebView2 core, string script)
  {
    using var value = JsonDocument.Parse(await core.ExecuteScriptAsync(script)); return value.RootElement.Clone();
  }
  private static async Task Wait(Func<Task<bool>> check, string description, FleetWindow main)
  {
    var until = DateTime.UtcNow.AddSeconds(45);
    while (DateTime.UtcNow < until) { if (await check()) return; await Task.Delay(60); }
    var state = await Eval(main.WebView.CoreWebView2, "document.querySelector('#status')?.textContent");
    var scenes = new List<string>();
    foreach (var surface in main.Desktop!.Surfaces)
      scenes.Add(surface.WebView.CoreWebView2 is null ? "uninitialized" : (await Eval(surface.WebView.CoreWebView2, "({url:location.href,visibility:document.visibilityState,text:document.body?.innerText.slice(0,300)})")).ToString());
    throw new Exception($"Desktop probe timed out: {description}; owner={state}; scenes={string.Join(";", scenes)}");
  }
  public static async Task Run(FleetWindow main, string directory)
  {
    async Task Layer(string value)
    {
      await Eval(main.WebView.CoreWebView2, "document.querySelector('#groups .group-row .group-menu').click()");
      await Wait(async () => (await Eval(main.WebView.CoreWebView2, "Boolean(document.querySelector('dialog[open]'))")).GetBoolean(), "group layer dialog", main);
      await Eval(main.WebView.CoreWebView2, $"(()=>{{const d=document.querySelector('dialog[open]');const s=[...d.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='wallpaper'));s.value='{value}';[...d.querySelectorAll('button')].find(b=>b.textContent==='Save').click()}})()");
      await Wait(async () => (await Eval(main.WebView.CoreWebView2, "!document.querySelector('dialog[open]')")).GetBoolean(), "save group layer", main);
    }
    // This probe exercises the interactive Desktop layer; newly created groups start on the Wallpaper layer.
    await Layer("desktop");
    await Wait(async () =>
    {
      var surfaces = main.Desktop?.Surfaces;
      return surfaces?.Count >= 2 && surfaces.All(s => s.WebView.CoreWebView2 is not null)
        && (await Eval(surfaces[0].WebView.CoreWebView2, "Boolean(document.querySelector('.card'))")).ValueKind == JsonValueKind.True;
    }, "resident scene received the real workspace projection", main);
    var resident = main.Desktop!.Surfaces[0].WebView.CoreWebView2;
    var floating = main.Desktop.Surfaces[1].WebView.CoreWebView2;
    // Two fingers zoom neither the main window nor a scene.
    if (main.WebView.CoreWebView2.Settings.IsPinchZoomEnabled || main.Desktop.Surfaces.Any(s => s.WebView.CoreWebView2.Settings.IsPinchZoomEnabled))
      throw new Exception("Pinch zoom is enabled in the main window or a desktop scene.");
    // The topmost scene's composition WebView renders through a transparent browser popup just above Explorer's desktop;
    // one that takes clicks blocks every desktop icon whenever no application window covers it. Scenes attached to
    // Explorer use windowed WebViews and have no such popup.
    await Wait(() => Task.FromResult(RenderPopups(resident.BrowserProcessId) is { Blocking: 0 }), "scene render popups pass clicks through", main);
    Console.WriteLine($"PASS {RenderPopups(resident.BrowserProcessId).Visible} visible scene render popup(s) are click-through");
    // Locked desktop-layer papers take clicks and text selection but are never dragged.
    if (!(await Eval(resident, "document.querySelector('.card').classList.contains('interactive') && !document.querySelector('.card').classList.contains('operable')")).GetBoolean())
      throw new Exception("Idle desktop paper must take clicks without becoming draggable.");
    await Eval(resident, "window.denied=null;chrome.webview.addEventListener('message', e=>{if(e.data.id==='22222222-2222-4222-8222-222222222222')window.denied=e.data});chrome.webview.postMessage({v:1,id:'22222222-2222-4222-8222-222222222222',method:'storage.load',params:{kind:'workspace'}})");
    await Wait(async () => (await Eval(resident, "window.denied?.error?.code==='unsupported-method'")).ValueKind == JsonValueKind.True,
      "display view cannot access storage", main);
    await Eval(resident, """
      window.preparedPaperRemoval = null;
      let prepareId = null, appliedId = null, regionPrepared = false;
      const originalScenePost = chrome.webview.postMessage.bind(chrome.webview);
      chrome.webview.postMessage = request => {
        if (request.method === 'scene.prepare') prepareId = request.id;
        if (request.method === 'scene.applied') appliedId = request.id;
        originalScenePost(request);
      };
      chrome.webview.addEventListener('message', event => {
        if (event.data.id === prepareId) regionPrepared = event.data.ok && event.data.result?.accepted === true;
        if (event.data.id === appliedId) regionPrepared = false;
      });
      new MutationObserver(records => {
        if (records.some(record => [...record.removedNodes].some(node => node.matches?.('.card'))))
          window.preparedPaperRemoval = regionPrepared;
      }).observe(document.querySelector('#scene'), {childList:true});
      """);
    await Eval(main.WebView.CoreWebView2, "document.querySelector('#operate-all').click()");
    await Wait(async () => (await Eval(floating, "Boolean(document.querySelector('.card.operable'))")).ValueKind == JsonValueKind.True,
      "all scope appears on floating surface", main);
    await Wait(async () => (await Eval(resident, "window.preparedPaperRemoval === true")).ValueKind == JsonValueKind.True,
      "native frame preparation acknowledged before removing the resident paper", main);
    Console.WriteLine("PASS attached paper removal waits for native frame preparation before erasing its DOM");
    // Adjust mode only arranges (SPEC-003, 2026-10-24): an adjusted paper offers no buttons and a double click, even with
    // Ctrl, opens nothing.
    if ((await Eval(floating, "document.querySelectorAll('.card-actions button').length")).GetInt32() != 0) throw new Exception("An adjusted paper offers buttons.");
    await Eval(floating, "(()=>{const c=document.querySelector('.card');const t=c?.querySelector('.card-summary')||c;if(!t)return;const r=t.getBoundingClientRect();t.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,ctrlKey:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}))})()");
    await Task.Delay(150);
    if ((await Eval(floating, "Boolean(document.querySelector('textarea'))")).ValueKind == JsonValueKind.True) throw new Exception("Adjust mode opened an editor.");
    await Eval(floating, "document.querySelector('.adjust-tools button.primary').click()");
    await Wait(async () => (await Eval(resident, "Boolean(document.querySelector('.card')) && !document.querySelector('.card.operable')")).ValueKind == JsonValueKind.True,
      "exit returns the paper to its group's desktop layer", main);
    // Quick edit: with the switch on, Ctrl and a double click open the resting paper in place on the Top layer. The scene
    // learns the key from the next frame, so the double click repeats until the editor shows.
    await Eval(main.WebView.CoreWebView2, "document.querySelector('#desktop-quick-move').click()");
    await QuickEdit(resident, floating, main, "scene inline editor");
    // The draft carries escaped CJK characters: a repeated edit must keep non-ASCII text exactly.
    await Eval(floating, "document.querySelector('textarea').value='Desktop draft \u4E2D\u6587 text';document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
    await Wait(async () => (await Eval(floating, "document.querySelector('.draft-state')?.textContent==='Draft saved locally'")).ValueKind == JsonValueKind.True,
      "scene draft acknowledged by native owner", main);
    using (var preview = File.Create(Path.Combine(directory, "native-desktop.png")))
      await floating.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, preview);
    // Repeating the gesture on the paper being edited must preserve its in-progress content and draft identity.
    await Eval(floating, "(()=>{const c=document.querySelector('.card');const t=c?.querySelector('.card-summary')||c;if(!t)return;const r=t.getBoundingClientRect();t.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,ctrlKey:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}))})()");
    await Task.Delay(150);
    if ((await Eval(floating, "document.querySelector('textarea').value")).GetString() != "Desktop draft \u4E2D\u6587 text") throw new Exception("Repeated edit replaced draft text.");
    // Larger than the 1 MiB message ceiling (an escaped three-byte CJK character): exercises chunked view -> owner command
    // and owner -> view projection.
    await Eval(floating, "document.querySelector('textarea').value='\u9577'.repeat(400000);document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
    await Wait(async () => (await Eval(floating, "document.querySelector('.draft-state')?.textContent==='Draft saved locally'")).ValueKind == JsonValueKind.True,
      "large scene draft chunk transport", main);
    // Entering adjust mode closes a quick edit, so the owner's flush barrier waits for the input method first.
    await Eval(floating, "document.querySelector('textarea').value='Last desktop text before closing';document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))");
    await Eval(main.WebView.CoreWebView2, "document.querySelector('#operate-all').click()");
    await Wait(async () => (await Eval(main.WebView.CoreWebView2, "document.querySelector('#status').textContent.startsWith('Finish ')")).ValueKind == JsonValueKind.True,
      "IME prevents entering adjust mode through the owner flush barrier", main);
    if ((await Eval(floating, "Boolean(document.querySelector('textarea'))")).ValueKind != JsonValueKind.True) throw new Exception("IME editor was destroyed.");
    await Eval(floating, "document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))");
    await Wait(async () => (await Eval(floating, "document.querySelector('.draft-state')?.textContent==='Draft saved locally' && !document.querySelector('textarea').readOnly")).ValueKind == JsonValueKind.True,
      "failed exit resumes editing after composition", main);
    await Eval(floating, "[...document.querySelectorAll('.card-actions button')].find(b=>b.textContent==='Save').click()");
    // A one-line note shows in the title band and again in the body, which always starts from the first line; saved, the
    // paper rests on its desktop layer again.
    await Wait(async () => (await Eval(floating, "!document.querySelector('textarea')")).ValueKind == JsonValueKind.True
      && (await Eval(resident, "document.querySelector('.card-summary')?.textContent === 'Last desktop text before closing' && document.querySelector('.card-body p')?.textContent === 'Last desktop text before closing'")).ValueKind == JsonValueKind.True,
      "scene commits through existing owner transaction", main);
    // Restore the fixture's original title, preserving its attachment and the subsequent existing regression assertions.
    await QuickEdit(resident, floating, main, "reopen desktop editor");
    await Eval(floating, "document.querySelector('textarea').value='# Native note\\n\\n- [ ] Saved across processes';document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
    await Wait(async () => (await Eval(floating, "document.querySelector('.draft-state')?.textContent==='Draft saved locally'")).ValueKind == JsonValueKind.True, "restore fixture text", main);
    await Eval(floating, "[...document.querySelectorAll('.card-actions button')].find(b=>b.textContent==='Save').click()");
    await Wait(async () => (await Eval(floating, "!document.querySelector('textarea')")).ValueKind == JsonValueKind.True
      && (await Eval(resident, "document.querySelector('.card-summary')?.textContent==='Native note' && !document.querySelector('.card.operable')")).ValueKind == JsonValueKind.True,
      "fixture restored on its desktop layer", main);
    await QuickMove(main, resident, floating);
    await Eval(main.WebView.CoreWebView2, "document.querySelector('#desktop-quick-move').click()");
    // A desktop paper takes clicks while locked, so its checkbox ticks the step through the native owner and the next
    // frame draws it; a second click unticks it again. The paper never turns draggable or opens an editor. The clicks
    // are DOM clicks: the probe injects no system input, so native hit-testing of a real click is not covered here.
    foreach (var (state, check) in new[] { ("ticked", "true"), ("unticked", "false") })
    {
      await Eval(resident, "document.querySelector('.card-body input[type=checkbox]').click()");
      await Wait(async () => (await Eval(resident, $"(box => box?.checked === {check} && !box.disabled)(document.querySelector('.card-body input[type=checkbox]')) && !document.querySelector('.card.operable, textarea')")).GetBoolean(),
        $"desktop step {state} through the native owner", main);
    }
    Console.WriteLine("PASS a desktop paper ticks and unticks its checklist step through the native owner (DOM clicks)");
    // The paper's attachment tile asks the native owner for its thumbnail; the Shell gives even a text file an icon.
    await Wait(async () => (await Eval(resident, "Boolean(document.querySelector('.attachment-tile img'))")).GetBoolean(),
      "desktop attachment thumbnail through the native owner", main);
    Console.WriteLine("PASS a desktop paper shows its attachment thumbnail through the native owner");
    Console.WriteLine("PASS real display-only WebView2 scene, storage isolation, draft chunks, IME barrier and owner commit");
    if (main.Desktop.Surfaces.Count == 3)
    {
      var wallpaper = main.Desktop.Surfaces[2].WebView.CoreWebView2;
      await Layer("wallpaper");
      await Wait(async () => (await Eval(wallpaper, "Boolean(document.querySelector('.card')) && !document.querySelector('.card.interactive')")).GetBoolean(), "wallpaper receives note", main);
      await Wait(async () => (await Eval(resident, "!document.querySelector('.card')")).GetBoolean(), "desktop copy removed", main);
      await Eval(main.WebView.CoreWebView2, "document.querySelector('#operate-group').click()");
      await Wait(async () => (await Eval(floating, "Boolean(document.querySelector('.card.operable'))")).GetBoolean()
        && (await Eval(wallpaper, "!document.querySelector('.card')")).GetBoolean(), "wallpaper group floats", main);
      await Eval(floating, "document.querySelector('.adjust-tools button.primary').click()");
      await Wait(async () => (await Eval(wallpaper, "Boolean(document.querySelector('.card')) && !document.querySelector('.card.interactive')")).GetBoolean()
        && (await Eval(floating, "!document.querySelector('.card')")).GetBoolean(), "group returns to wallpaper", main);
      await Layer("desktop");
      await Wait(async () => (await Eval(resident, "Boolean(document.querySelector('.card'))")).GetBoolean(), "restore fixture desktop layer", main);
      Console.WriteLine("PASS real owner settings -> wallpaper -> operate group -> floating -> stop -> wallpaper -> desktop");
    }
    // A group resting on the Top layer at 50% draws its paper see-through in the topmost scene; back on the Desktop layer
    // the paper is opaque again.
    await Eval(main.WebView.CoreWebView2, "document.querySelector('#groups .group-row .group-menu').click()");
    await Wait(async () => (await Eval(main.WebView.CoreWebView2, "Boolean(document.querySelector('dialog[open] input[name=group-opacity]'))")).GetBoolean(), "group opacity control", main);
    await Eval(main.WebView.CoreWebView2, "(()=>{const d=document.querySelector('dialog[open]');const s=[...d.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='floating'));s.value='floating';"
      + "const r=d.querySelector('input[name=group-opacity]');r.value='50';r.dispatchEvent(new Event('input'));[...d.querySelectorAll('button')].find(b=>b.textContent==='Save').click()})()");
    await Wait(async () => (await Eval(floating, "(c => Boolean(c) && getComputedStyle(c).backgroundColor.endsWith(', 0.5)'))(document.querySelector('.card'))")).GetBoolean()
      && (await Eval(resident, "!document.querySelector('.card')")).GetBoolean(), "see-through paper on the Top layer", main);
    await Layer("desktop");
    await Wait(async () => (await Eval(resident, "(c => Boolean(c) && getComputedStyle(c).backgroundColor.startsWith('rgb('))(document.querySelector('.card'))")).GetBoolean(),
      "opaque paper back on the Desktop layer", main);
    Console.WriteLine("PASS a group at 50% draws see-through papers on the Top layer only");
  }
  private static (int Visible, int Blocking) RenderPopups(uint browser)
  {
    int visible = 0, blocking = 0; var text = new StringBuilder(64);
    EnumWindows((window, _) =>
    {
      GetWindowThreadProcessId(window, out var process); if (process != browser) return true;
      text.Clear(); GetClassNameW(window, text, text.Capacity); if (text.ToString() != "Chrome_WidgetWin_1") return true;
      text.Clear(); GetWindowTextW(window, text, text.Capacity); if (text.ToString() != HostText.Get("desktop.windowTitle")) return true;
      var style = GetWindowLongPtrW(window, -20).ToInt64();
      if ((style & 0x08080000L) != 0x08080000L || !IsWindowVisible(window)) return true;
      visible++; if ((style & 0x20) == 0) blocking++;
      return true;
    }, IntPtr.Zero);
    return (visible, blocking);
  }
  private delegate bool EnumCallback(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassNameW(IntPtr window, StringBuilder name, int capacity);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr window, StringBuilder text, int capacity);
  [DllImport("user32.dll")] private static extern IntPtr GetWindowLongPtrW(IntPtr window, int index);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);

  // Ctrl and a double click on the resting paper open a quick edit on the Top layer (SPEC-003, 2026-10-24); the scene
  // takes the key from the frame after the switch changes, so the gesture repeats until the editor shows. The scene finds
  // the paper under the pointer, so the double click lands on the title band.
  public static Task QuickEdit(CoreWebView2 resident, CoreWebView2 floating, FleetWindow main, string message) => Wait(async () =>
  {
    await Eval(resident, "(()=>{const t=document.querySelector('.card-summary');if(!t)return;const r=t.getBoundingClientRect();t.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,ctrlKey:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}))})()");
    return (await Eval(floating, "Boolean(document.querySelector('textarea'))")).ValueKind == JsonValueKind.True;
  }, message, main);

  // Ctrl and a drag move the resting Desktop-layer paper (SPEC-003, 2026-10-24). DevTools mouse input goes through the
  // browser like a real press with Ctrl held, without system input; it does not exercise native capture or hit-testing.
  // While it drags, the paper rides the Top layer and the attached scene stays shown; at the drop it rests there again.
  private static async Task QuickMove(FleetWindow main, CoreWebView2 resident, CoreWebView2 floating)
  {
    var point = await Eval(resident, "(()=>{const r=document.querySelector('.card-summary').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,left:parseFloat(document.querySelector('.card').style.left)}})()");
    double x = point.GetProperty("x").GetDouble(), y = point.GetProperty("y").GetDouble(), left = point.GetProperty("left").GetDouble();
    Task Mouse(string type, double atX, double atY, int buttons) => resident.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent",
      JsonSerializer.Serialize(new { type, x = atX, y = atY, button = "left", buttons, clickCount = type == "mouseMoved" ? 0 : 1, modifiers = 2 }));
    await Mouse("mouseMoved", x, y, 0); await Mouse("mousePressed", x, y, 1);
    for (var step = 1; step <= 6; step++) await Mouse("mouseMoved", x + step * 10, y + step * 5, 1);
    await Wait(async () => (await Eval(floating, "[...document.querySelectorAll('.card')].some(c=>c.querySelector('.card-summary')?.textContent==='Native note'&&!c.classList.contains('interactive'))")).ValueKind == JsonValueKind.True
      && (await Eval(resident, "!document.querySelector('.card')")).ValueKind == JsonValueKind.True, "quick move rides the Top layer while it drags", main);
    if (!main.Desktop!.Surfaces[0].Shown) throw new Exception("The attached scene hid while its quick move held the pointer.");
    await Mouse("mouseReleased", x + 60, y + 30, 0);
    var dropped = (left + 60).ToString(System.Globalization.CultureInfo.InvariantCulture);
    await Wait(async () => (await Eval(resident, $"Math.abs(parseFloat(document.querySelector('.card')?.style.left)-({dropped}))<2")).ValueKind == JsonValueKind.True
      && (await Eval(floating, "!document.querySelector('.card')")).ValueKind == JsonValueKind.True, "quick move rests on the desktop layer at the drop", main);
    if (!main.Desktop.Surfaces[0].Shown) throw new Exception("The attached scene is not shown after the quick move.");
    Console.WriteLine("PASS Ctrl and a drag move a resting desktop paper on the Top layer and leave it on its own layer");
  }

  public static async Task CloseWithDraft(FleetWindow main)
  {
    await Wait(async () => main.Desktop?.Surfaces.Count >= 2 && main.Desktop.Surfaces.Take(2).All(s => s.WebView.CoreWebView2 is not null)
      && (await Eval(main.Desktop.Surfaces[0].WebView.CoreWebView2, "Boolean(document.querySelector('.card'))")).ValueKind == JsonValueKind.True,
      "desktop ready for close probe", main);
    var resident = main.Desktop!.Surfaces[0].WebView.CoreWebView2; var scene = main.Desktop.Surfaces[1].WebView.CoreWebView2;
    await Eval(main.WebView.CoreWebView2, "if(!document.querySelector('#desktop-quick-move').checked)document.querySelector('#desktop-quick-move').click()");
    await QuickEdit(resident, scene, main, "close probe editor");
    await Task.Delay(200);
    var released = false;
    scene.WebMessageReceived += (_, e) => { if (e.WebMessageAsJson.Contains("probe-unfreeze")) released = true; };
    await Eval(scene, "chrome.webview.addEventListener('message',e=>{if(e.data.event==='desktop-unfreeze')chrome.webview.postMessage({v:1,id:crypto.randomUUID(),method:'probe-unfreeze',params:{}})})");
    await Eval(main.WebView.CoreWebView2, "window.realNativePost=chrome.webview.postMessage.bind(chrome.webview);chrome.webview.postMessage=m=>{if(m.method==='storage.commit')setTimeout(()=>window.realNativePost(m),150);else window.realNativePost(m)}");
    await Eval(scene, "document.querySelector('textarea').value='Desktop draft that must reach the disk at close';document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
    var closed = new TaskCompletionSource(); main.Closed += (_, _) => closed.TrySetResult(); main.Close();
    await closed.Task.WaitAsync(TimeSpan.FromSeconds(45));
    if (released) throw new Exception("Close released the scene editor before destroying the view.");
    Console.WriteLine("PASS native close holds scene freeze while delayed final storage commits settle");
  }
}
