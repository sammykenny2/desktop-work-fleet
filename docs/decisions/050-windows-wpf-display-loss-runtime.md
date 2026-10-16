# ADR-050: Windows 使用含顯示器失效保護的 WPF 10

## Status

Accepted，2026-10-16。使用者先要求 worktree 實作與建置，安裝後三次重新開機未再當掉，隨後授權整合 main 並清理。
沿用應用版本 0.2.7，不發布；實測支持採用此修正，但不代表所有登入時序的 crash 已排除。
本決策更新 ADR-015 的 Windows .NET target 與 ADR-036 的 bundled runtime 版本。

## Context

- 最新交接 commit 5465296 記錄 ADR-049 未能防止 0.2.7 登入 crash。實際 host.log 顯示：
  內建主螢幕關閉，套用新配置後 339 ms 發生 0x88980406 UCEERR_RENDERTHREADFAILURE。
- 當次 minidump 的模組資訊確認載入 WPF 8.0.31、WebView2 SDK 1.0.4258.31。
- 實際 WebView2 WPF 組件的 IL 確認 GraphicsItemD3DImage 繼承 D3DImage，建立 D3D9 device 時使用 adapter 0。
  SDK 也已包含顯示器變更時的 back-buffer 清除與裝置重建；不能只憑既有 issue 宣稱升級 WebView2 即可修復。
- 對應 WPF 8.0.31 source commit 27c84022a86fcaa600315f4686cde97874615a24 的
  CInteropDeviceBitmap::GetDisplayFromUserDevice 未處理 GetAdapterMonitor 回傳 NULL。
  WPF #10394 在這種情況改找目前主螢幕；本輪核對 v10.0.13 已包含修正，release/8.0、release/9.0 沒有。
- 這是強根因候選，並未從 dump 還原 WPF 原始失敗紀錄；仍須用相同登入／螢幕切換流程對照。

## Decision

- Windows App、core、core/UI probes 一起 target .NET 10，WPF App 保留既有 Windows SDK target 與安裝下限。
- self-contained Core／Desktop runtime 固定 10.0.13，從 Windows Directory.Build.props 的 WindowsRuntimeVersion 讀取。
  App 的 Version 維持 0.2.7；不改 WebView2、SQLite 直接套件版本或桌面呈現方式。
- 同步 scripts、CI、IDE 路徑、lockfiles、實際套件授權／notices；封裝檢查要求精確 runtime pin，拒絕舊版與混合版本。
- 一般開發需要 .NET 10 SDK／Desktop runtime；MSIX／ZIP 自帶 runtime，接收端不用另外安裝 .NET。
- 登入等待、CrashGuard 與 ADR-049 暫時保留，讓這次實驗集中在 WPF runtime。
  host.log 啟動行加上實際 Environment.Version，辨識同為 0.2.7 的測試包。
- Build-WindowsApp 明確停用 SDK 的 ASP.NET 開發憑證初始化；此桌面 App 不使用該憑證。

## Consequences

### Positive

- 採用官方已修正的顯示器失效處理，無需替換浮動層或加入 private API hook。
- 核對真正封入的 runtime，避免只換 SDK 而仍交付 WPF 8。

### Negative

- .NET major 升級仍需完整原生回歸及支援 Windows 版本的實機驗收。
- 本機 probe 通過不代表重開機登入 crash 已消失。

### Neutral

- 不升應用版本、不安裝產品、不改登入項目或顯示器配置、不 dispatch release。
- 套件使用 worktree 的本機預設配置；未複製原工作區 .env，Google 登入不屬此包驗證範圍。
- NuGet 重新選擇相容的 framework assets，System.Memory 4.5.3 不再是 Windows lockfile 依賴；直接套件版號不變。

## Alternatives Considered

### 只更新系統 .NET 或 .NET 8 patch

- Self-contained App 不使用系統安裝的 .NET；所核對的 WPF 8 分支也沒有該修正。

### 改寫浮動層／全面停用 GPU

- 架構變更較大；既有全面軟體繪圖實驗讓浮動層空白（ADR-049），先驗證官方修正。

## 2026-10-16 實機觀察

維護者自行安裝已簽章測試包並重開機三次。Windows 11 build 26200 的啟動事件與安裝版 `host.log` 相符，
三次皆為登入啟動、未自動重啟、runtime 10.0.13；截至 23:20，22:10 後沒有新的 WorkFleet 錯誤事件，最後程序仍存活。
第一次由內建主螢幕加外接螢幕啟動，約十分鐘後合蓋移除內建螢幕、套用新顯示配置，沒有再出現 render-thread failure；
另兩次登入時已只有外接螢幕。已安裝 App assembly 與本輪簽章包的 SHA-256 相同。

這是有限次數的成功觀察；尚未再次覆蓋啟動後 13～43 秒內移除內建主螢幕的原始失敗條件，也未在 23H2 驗證 .NET 10。
完整時間與檢查結果見 PROGRESS.md。維護者據此授權整合，原始 WPF 失敗內部狀態仍未由 dump 證實。

## References

- [WPF #10394](https://github.com/dotnet/wpf/pull/10394)、[問題與重現 #9042](https://github.com/dotnet/wpf/issues/9042)
- [WPF 8.0.31 對應原始碼](https://github.com/dotnet/wpf/blob/27c84022a86fcaa600315f4686cde97874615a24/src/Microsoft.DotNet.Wpf/src/WpfGfx/core/hw/InteropDeviceBitmap.cpp)
- [包內 WPF 對應的精確 source commit](https://github.com/dotnet/dotnet/blob/4099f83977f4d29604a9aeb971fb0a7bc1d5f699/src/wpf/src/Microsoft.DotNet.Wpf/src/WpfGfx/core/hw/InteropDeviceBitmap.cpp)
- [WPF v10.0.13 原始碼](https://github.com/dotnet/wpf/blob/v10.0.13/src/Microsoft.DotNet.Wpf/src/WpfGfx/core/hw/InteropDeviceBitmap.cpp)
- [WebView2 #5437](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5437)
- [官方 .NET 10 release metadata](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json)
- [ADR-036](036-windows-self-contained-packaging.md)、[ADR-049](049-windows-attached-scenes-render-in-software.md)

*Decision made: 2026-10-16*
