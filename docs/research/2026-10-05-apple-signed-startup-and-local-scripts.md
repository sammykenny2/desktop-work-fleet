# Apple 開發簽章與本機腳本啟動

查閱與實測：2026-10-05。這是針對 0.1.0 試裝失敗的證據；執行狀態見 [PROGRESS](../../PROGRESS.md)。

## 本機證據

先前 `CODE_SIGNING_ALLOWED=NO` 產物未帶有效 entitlement，使用 Data Protection Keychain
更新不存在項目回傳 `-34018`（missing entitlement），與使用者看到的「Apple Keychain 無法更新」相符。
維護者在 Xcode 建立 Apple Development 憑證與登記 Mac 後，簽章含 application identifier、
team identifier、Sandbox 與 Keychain access group，profile 允許已登記裝置。

唯一 `app.workfleet.startupprobe.*` bundle 的真 FleetKeychain 建立／讀取／更新、FleetDatabase
加密 SQLite 重開通過。隨包 HTML 完成載入，但 module resource error 指向 `app/main.js`，
畫面停在正在載入、原生 bridge 尚未建立。這是第二個問題，與 Keychain 簽章分開。
合併為 classic deferred scripts 後，同一原生 host／desktop／renderer 完成初始化。
最後的 probe 未替換正式 bridge handler；未讀取使用者資料，只清除 probe 自己的 service。

## 外部證據與推論

[Apple API](https://developer.apple.com/documentation/webkit/wkwebview/loadfileurl(_:allowingreadaccessto:))
提供指定本機資產 read-access 範圍的載入方式。
[WebKit issue 154916](https://bugs.webkit.org/show_bug.cgi?id=154916) 記錄 file origin 的跨來源限制。
本機 resource error 支持原樣 module 載入不相容；沒有進一步將此歸因為特定 WebKit 版本的回歸。
[esbuild API](https://esbuild.github.io/api/#bundle) 支援將模組依賴合併為 browser script；
選定固定版本並保留 legal comments／完整 LICENSE，結果由真 WKWebView 驗證。

## 決策與限制

[ADR-033](../decisions/033-apple-local-script-bundles.md) 僅調整 Apple 封裝；不放寬 CSP、
bridge 或 Sandbox，不引入本機 HTTP server。Apple Development profile 不等於
Developer ID／公證的跨機散布。Intel 實機、iOS、Google 登入、IME／Spaces 與完整桌面操作仍未驗收。
