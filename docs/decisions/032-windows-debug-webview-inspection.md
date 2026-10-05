# ADR-032: Windows Debug 組態的 WebView 檢查

## Status

Accepted，2026-10-05。依使用者要求，只有 Debug 組態可開 DevTools，Release 一律關閉。
修訂 ADR-015 的「停用 DevTools」：該限制改為只適用 Release／MSIX；其餘 bridge 邊界不變。

## Context

ADR-015 在所有組態都停用 DevTools，`Build-WindowsApp.ps1 -Configuration Debug` 與 Release 行為相同。
開發時只能以 OS 截圖查看畫面，看不到 DOM、console 或桌面場景內容。
使用者需要以 Debug 組態直接開啟正式資料目錄，追查正式資料引起的問題，所以不另設 Debug 資料目錄。
CDP port 不需驗證。loopback 不分 Windows 使用者，本機任何非 AppContainer 程序（含其他 session 與服務）
都能連線、操控頁面並呼叫原生 bridge。

## Decision

- `WebViewDiagnostics` 以 `#if DEBUG` 在編譯期分流。Release 沒有開啟 DevTools 或 debug port 的程式碼。
- Debug 在主畫面與所有桌面場景 WebView 啟用 `AreDevToolsEnabled`。
  App 沒有攔截 contextmenu，右鍵選單會出現「檢查」；`AreBrowserAcceleratorKeysEnabled=false` 仍使 F12 無效。
- CDP port 預設關閉。只有啟動 Debug App 時程序環境帶有 `WORK_FLEET_WEBVIEW_DEBUG_PORT`，
  才以 `--remote-debugging-port` 建立 WebView2 environment；它由主畫面與場景共用，涵蓋所有 WebView。
  Chromium 只綁定 loopback；值必須是 1024–65535 的十進位數字，否則在取得資料目錄 owner 鎖前以 HostError 拒絕。
- Debug 與 MSIX／Release 共用 `%LOCALAPPDATA%\WorkFleet`。單一 owner 鎖使兩者不能同時開啟。
- MSIX 一律以 Release 建置；`Build-WindowsPackage.ps1` 若在 `WorkFleet.dll` 找到 `remote-debugging` 字串即停止封裝。
  `Test-WindowsNative.ps1` 要求同一掃描命中 Debug `WorkFleet.dll`，避免重構後檢查失效。不提供可安裝的 Debug MSIX。
- 不使用使用者層級的環境變數（setx）或機碼開啟 port；只在啟動 Debug App 的程序環境設定。

## Consequences

### Positive

開發時可用 DevTools 或 CDP 檢查實際 DOM、console 與桌面場景，Release 執行檔沒有這條程式路徑。
Debug 可直接重現正式資料的問題，不需要匯出或搬移 SQLite。

### Negative

開啟 port 的 Debug App 在執行期間，本機任何程序（不限使用者）都能讀取解密後的便箋，只應在需要時短暫開啟。
Debug 與已安裝 App 共用資料與 owner 鎖，需先關閉其中一個。
兩者共用 `webview` user data 但瀏覽器參數不同；owner 鎖釋放後 WebView2 程序可能稍晚才結束，
若在這段期間開啟另一版本，可能出現「無法開啟原生工作空間」，稍候重開即可，port 不會帶入 Release。

### Neutral

「Release 一律不開」是 App 自身行為。WebView2 仍接受同使用者設定的
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 或 AdditionalBrowserArguments 原則機碼；
這屬於 ADR-015 已排除的同帳號惡意程式範圍。檢查已安裝的 Release 版本時，可以暫時使用這兩種方式，用完需移除。

## Alternatives Considered

- 所有組態維持關閉：開發只能截圖，無法檢查 DOM 或場景。
- Debug 使用獨立資料目錄：較安全，但無法以 Debug 版追查正式資料。
- Debug 一律開啟固定 port：任何 Debug 執行都會暴露 bridge，並可能與其他工具衝突。
- 可安裝的 Debug MSIX：需另一個 package identity 與簽章流程；直接執行 Debug exe 已足夠。

## References

- [ADR-015](015-windows-native-storage-and-editor-host.md)、[服務與連接埠](../services.md)、[安全準則](../security-guidelines.md)
- [WebView2 環境變數與 AdditionalBrowserArguments](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl#createcorewebview2environmentwithoptions)
- [AreDevToolsEnabled](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2settings.aredevtoolsenabled)
- [測試](../testing.md)、[執行狀態](../../PROGRESS.md)

*Decision made: 2026-10-05*
