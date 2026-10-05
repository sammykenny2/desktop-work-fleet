using Microsoft.Web.WebView2.Core;
using System.Text.Json;
using System.IO;
using WorkFleet.Windows;

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
    await Wait(async () =>
    {
      var surfaces = main.Desktop?.Surfaces;
      return surfaces?.Count >= 2 && surfaces.All(s => s.WebView.CoreWebView2 is not null)
        && (await Eval(surfaces[0].WebView.CoreWebView2, "Boolean(document.querySelector('.card'))")).ValueKind == JsonValueKind.True;
    }, "resident scene received the real workspace projection", main);
    var resident = main.Desktop!.Surfaces[0].WebView.CoreWebView2;
    var floating = main.Desktop.Surfaces[1].WebView.CoreWebView2;
    if ((await Eval(resident, "document.querySelector('.card').classList.contains('interactive')")).GetBoolean()) throw new Exception("Idle paper intercepted input.");
    await Eval(resident, "window.denied=null;chrome.webview.addEventListener('message', e=>{if(e.data.id==='22222222-2222-4222-8222-222222222222')window.denied=e.data});chrome.webview.postMessage({v:1,id:'22222222-2222-4222-8222-222222222222',method:'storage.load',params:{kind:'workspace'}})");
    await Wait(async () => (await Eval(resident, "window.denied?.error?.code==='unsupported-method'")).ValueKind == JsonValueKind.True,
      "display view cannot access storage", main);
    await Eval(main.WebView.CoreWebView2, "document.querySelector('#operate-all').click()");
    await Wait(async () => (await Eval(floating, "Boolean(document.querySelector('.card.operable'))")).ValueKind == JsonValueKind.True,
      "all scope appears on floating surface", main);
    await Eval(floating, "[...document.querySelectorAll('.card-actions button')].find(b=>b.textContent==='編輯').click()");
    await Wait(async () => (await Eval(floating, "Boolean(document.querySelector('textarea'))")).ValueKind == JsonValueKind.True,
      "scene inline editor", main);
    await Eval(floating, "document.querySelector('textarea').value='桌面草稿 中文測試';document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
    await Wait(async () => (await Eval(floating, "document.querySelector('.draft-state')?.textContent==='草稿已存本機'")).ValueKind == JsonValueKind.True,
      "scene draft acknowledged by native owner", main);
    using (var preview = File.Create(Path.Combine(directory, "native-desktop.png")))
      await floating.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, preview);
    // Repeating edit on the same card must preserve its in-progress content and draft identity.
    await Eval(floating, "document.querySelector('.card').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
    await Task.Delay(150);
    if ((await Eval(floating, "document.querySelector('textarea').value")).GetString() != "桌面草稿 中文測試") throw new Exception("Repeated edit replaced draft text.");
    // Larger than the 1 MiB message ceiling: exercises chunked view -> owner command and owner -> view projection.
    await Eval(floating, "document.querySelector('textarea').value='長'.repeat(400000);document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
    await Wait(async () => (await Eval(floating, "document.querySelector('.draft-state')?.textContent==='草稿已存本機'")).ValueKind == JsonValueKind.True,
      "large scene draft chunk transport", main);
    await Eval(floating, "document.querySelector('textarea').value='桌面關閉前最後文字';document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))");
    await Eval(main.WebView.CoreWebView2, "document.querySelector('#stop-operation').click()");
    await Wait(async () => (await Eval(main.WebView.CoreWebView2, "document.querySelector('#status').textContent.includes('請先完成')")).ValueKind == JsonValueKind.True,
      "IME prevents scope exit through the owner flush barrier", main);
    if ((await Eval(floating, "Boolean(document.querySelector('textarea'))")).ValueKind != JsonValueKind.True) throw new Exception("IME editor was destroyed.");
    await Eval(floating, "document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))");
    await Wait(async () => (await Eval(floating, "document.querySelector('.draft-state')?.textContent==='草稿已存本機' && !document.querySelector('textarea').readOnly")).ValueKind == JsonValueKind.True,
      "failed exit resumes editing after composition", main);
    await Eval(floating, "[...document.querySelectorAll('.card-actions button')].find(b=>b.textContent==='保存').click()");
    await Wait(async () => (await Eval(floating, "!document.querySelector('textarea') && document.querySelector('.card-body')?.textContent.includes('桌面關閉前最後文字')")).ValueKind == JsonValueKind.True,
      "scene commits through existing owner transaction", main);
    // Restore the fixture's original title, preserving its attachment and the subsequent existing regression assertions.
    await Eval(floating, "[...document.querySelectorAll('.card-actions button')].find(b=>b.textContent==='編輯').click()");
    await Wait(async () => (await Eval(floating, "Boolean(document.querySelector('textarea'))")).ValueKind == JsonValueKind.True, "reopen desktop editor", main);
    await Eval(floating, "document.querySelector('textarea').value='# 原生便箋\\n\\n- [ ] 跨程序保存';document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
    await Wait(async () => (await Eval(floating, "document.querySelector('.draft-state')?.textContent==='草稿已存本機'")).ValueKind == JsonValueKind.True, "restore fixture text", main);
    await Eval(floating, "[...document.querySelectorAll('.card-actions button')].find(b=>b.textContent==='保存').click()");
    await Wait(async () => (await Eval(floating, "!document.querySelector('textarea') && document.querySelector('.card-summary')?.textContent==='原生便箋'")).ValueKind == JsonValueKind.True,
      "fixture restored", main);
    await Eval(main.WebView.CoreWebView2, "document.querySelector('#stop-operation').click()");
    await Wait(async () => (await Eval(resident, "Boolean(document.querySelector('.card')) && !document.querySelector('.card.interactive')")).ValueKind == JsonValueKind.True,
      "exit restores resident pass-through policy", main);
    Console.WriteLine("PASS real display-only WebView2 scene, storage isolation, draft chunks, IME barrier and owner commit");
    if (main.Desktop.Surfaces.Count == 3)
    {
      var wallpaper = main.Desktop.Surfaces[2].WebView.CoreWebView2;
      async Task Layer(string value)
      {
        await Eval(main.WebView.CoreWebView2, "[...document.querySelectorAll('.list-actions button')].find(b=>b.textContent==='更多操作').click()");
        await Eval(main.WebView.CoreWebView2, $"(()=>{{const d=document.querySelector('dialog[open]');const s=[...d.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='wallpaper'));s.value='{value}';s.dispatchEvent(new Event('change'));[...d.querySelectorAll('button')].find(b=>b.textContent==='套用').click()}})()");
        await Wait(async () => (await Eval(main.WebView.CoreWebView2, "!document.querySelector('dialog[open]')")).GetBoolean(), "save resident layer", main);
      }
      await Eval(main.WebView.CoreWebView2, "document.querySelector('#view-toggle').click()");
      await Layer("wallpaper");
      await Wait(async () => (await Eval(wallpaper, "Boolean(document.querySelector('.card')) && !document.querySelector('.card.interactive')")).GetBoolean(), "wallpaper receives note", main);
      await Wait(async () => (await Eval(resident, "!document.querySelector('.card')")).GetBoolean(), "desktop copy removed", main);
      await Eval(main.WebView.CoreWebView2, "document.querySelector('#operate-group').click()");
      await Wait(async () => (await Eval(floating, "Boolean(document.querySelector('.card.operable'))")).GetBoolean()
        && (await Eval(wallpaper, "!document.querySelector('.card')")).GetBoolean(), "wallpaper group floats", main);
      await Eval(main.WebView.CoreWebView2, "document.querySelector('#stop-operation').click()");
      await Wait(async () => (await Eval(wallpaper, "Boolean(document.querySelector('.card')) && !document.querySelector('.card.interactive')")).GetBoolean()
        && (await Eval(floating, "!document.querySelector('.card')")).GetBoolean(), "group returns to wallpaper", main);
      await Layer("desktop");
      await Wait(async () => (await Eval(resident, "Boolean(document.querySelector('.card'))")).GetBoolean(), "restore fixture desktop layer", main);
      await Eval(main.WebView.CoreWebView2, "document.querySelector('#view-toggle').click()");
      Console.WriteLine("PASS real owner settings -> wallpaper -> operate group -> floating -> stop -> wallpaper -> desktop");
    }
  }
  public static async Task CloseWithDraft(FleetWindow main)
  {
    await Eval(main.WebView.CoreWebView2, "document.querySelector('#operate-all').click()");
    await Wait(async () => main.Desktop?.Surfaces.Count >= 2 && main.Desktop.Surfaces[1].WebView.CoreWebView2 is not null
      && (await Eval(main.Desktop.Surfaces[1].WebView.CoreWebView2, "Boolean(document.querySelector('.card.operable'))")).ValueKind == JsonValueKind.True,
      "desktop ready for close probe", main);
    var scene = main.Desktop!.Surfaces[1].WebView.CoreWebView2;
    await Eval(scene, "[...document.querySelectorAll('.card-actions button')].find(b=>b.textContent==='編輯').click()");
    await Wait(async () => (await Eval(scene, "Boolean(document.querySelector('textarea'))")).ValueKind == JsonValueKind.True, "close probe editor", main);
    await Task.Delay(200);
    var released = false;
    scene.WebMessageReceived += (_, e) => { if (e.WebMessageAsJson.Contains("probe-unfreeze")) released = true; };
    await Eval(scene, "chrome.webview.addEventListener('message',e=>{if(e.data.event==='desktop-unfreeze')chrome.webview.postMessage({v:1,id:crypto.randomUUID(),method:'probe-unfreeze',params:{}})})");
    await Eval(main.WebView.CoreWebView2, "window.realNativePost=chrome.webview.postMessage.bind(chrome.webview);chrome.webview.postMessage=m=>{if(m.method==='storage.commit')setTimeout(()=>window.realNativePost(m),150);else window.realNativePost(m)}");
    await Eval(scene, "document.querySelector('textarea').value='桌面關閉瞬間仍須落盤';document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))");
    var closed = new TaskCompletionSource(); main.Closed += (_, _) => closed.TrySetResult(); main.Close();
    await closed.Task.WaitAsync(TimeSpan.FromSeconds(45));
    if (released) throw new Exception("Close released the scene editor before destroying the view.");
    Console.WriteLine("PASS native close holds scene freeze while delayed final storage commits settle");
  }
}
