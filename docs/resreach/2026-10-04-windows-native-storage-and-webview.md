# Windows 原生儲存與 WebView 主畫面查核

日期：2026-10-04。官方能力、實作選擇與實測證據分開；決策見 [ADR-015](../decisions/015-windows-native-storage-and-editor-host.md)。

## 官方能力與設計推論

- [Microsoft 的 WebView2 security 指南](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security)
  要求檢查來源、驗證訊息、避免通用 proxy。本 host 採精確主文件、固定方法和 JSON reply，
  不把 script／檔案路徑／token 當 renderer 可指定參數。
- [Local content 文件](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/working-with-local-content)
  記錄 virtual host mapping 與 secure-context DOM API；本地資產用此方式離線載入，不啟動 listener。
- [SQLite transaction 文件](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/transactions)
  說明同一 transaction 的 rollback 與 serializable 行為；本機的 CAS、附件及 receipt 共同提交。
- [CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)
  支援使用者保護與 optional entropy。本實作不設 LOCAL_MACHINE；用途／profile 分區進 entropy。
  推論：可防止直接複製密文後跨 profile 解密，並不構成同一登入帳號內的惡意程式隔離。
- [WebView2 套件](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4258.31)、
  [Microsoft.Data.Sqlite](https://www.nuget.org/packages/Microsoft.Data.Sqlite/10.0.12)
  已實際取得，版本及 SHA-512 contentHash 固定於 NuGet lockfile；完整授權隨原生產物保留。

## 本次實測與範圍

實際執行結果、修正及獨立審閱只記在 [PROGRESS](../../PROGRESS.md)。
Core probe 使用真 SQLite／Windows DPAPI；Node probe 使用 stdio 測試程式連真 native bridge，
不是合成 FileStore。WPF probe 載入實際封裝頁面，透過真 DOM 與 WebMessage 保存及重開。
UI probe 視窗在螢幕外且不啟用，不注入使用者桌面滑鼠；不能當作穿透／分層／混合 DPI 驗收。
工具受限環境曾造成 WebView2 browser process crash，換一般 Windows 使用者執行同一探針通過；
沒有停用 WebView2 sandbox，也沒有把失敗記成成功。

沒有引入另一個便箋產品的程式、資產或 schema；以上是平台 API 與套件資料。
