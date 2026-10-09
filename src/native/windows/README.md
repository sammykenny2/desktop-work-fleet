# Windows 原生 App

建置 API 基線為 Windows 10 build 19041+／11，需要 .NET 8 SDK、Evergreen WebView2 Runtime 與 Node 22+。
產品支援目標為早期 Windows 11／23H2 與 24H2+，不適配 Windows 10；MSIX 下限為 22000，MaxVersionTested 保留 26200。23H2 隔離原生探針通過，其他版本與安裝／正常互動未測範圍見 [ADR-034](../../../docs/decisions/034-windows-11-compatibility-and-install-floor.md)、[接手](../../../docs/handoff/2026-10-09-windows-11-compatibility-handoff.md) 與 PROGRESS。
此目錄為 1.0 原生 host：.NET WPF + WebView2 主畫面、桌面場景與 SQLite／DPAPI 保存。

## 結構

- `WorkFleet.sln`：Windows 解決方案，對應 Apple 的 `WorkFleet.xcodeproj` 與 Android 的 Gradle 根目錄。
- `app/`：`WorkFleet.Windows.csproj`，WPF 主程式、桌面場景、快捷鍵、系統匣與 Google 登入。
- `core/`：`WorkFleet.Windows.Core.csproj`，SQLite／DPAPI、bridge、備份檔案與場景傳輸。
- 測試專案在 `tests/native/windows/core` 與 `tests/native/windows/ui`，在解決方案的 `tests` 資料夾下。

## 開啟

- VS Code：開啟 repository 根目錄，安裝建議的 C# Dev Kit；`.vscode/settings.json` 已指定此解決方案。
  F5 選「Windows: Work Fleet (Debug)」會先執行 `Build-WindowsApp.ps1 -Configuration Debug`，再啟動 `WorkFleet.exe`。
  「Debug + CDP 9339」另開 loopback CDP，見 [ADR-032](../../../docs/decisions/032-windows-debug-webview-inspection.md)。
- Visual Studio 2022：開啟 `WorkFleet.sln`。直接建置前先在根目錄執行 `npm run build`，否則缺少封裝資產。

Debug 與安裝版共用 `%LOCALAPPDATA%\WorkFleet`，同一時間只能開一個；啟動 Debug 前先關閉已安裝的 App。

## 命令列

```powershell
.\scripts\windows\Build-WindowsApp.ps1 -Configuration Debug
.\scripts\windows\Test-WindowsNative.ps1
.\scripts\windows\Build-WindowsPackage.ps1 -LocalTestSign
```

腳本先建置共用網頁資產，NuGet 依賴以 lockfile 還原到 Git 忽略的 `build/nuget-packages`。
IDE 自行還原會使用預設 NuGet 快取，版本仍由 lockfile 固定。
`Build-WindowsPackage.ps1` 預設 self-contained win-x64，MSIX／ZIP 自帶 .NET 8 Desktop runtime，接收端仍需 Evergreen WebView2。
首次 package build 不加 `-SkipRestore`；該選項要求已快取對應的 win-x64 runtime packs。
一般 `Build-WindowsApp.ps1`／IDE 產物仍依賴系統 .NET；`-SelfContained` 是封裝入口使用的 x64 restore／build 選項。
內附 runtime patch 與授權紀錄見 [ADR-036](../../../docs/decisions/036-windows-self-contained-packaging.md)，更新需重新發布 App。
完整說明見 [設定](../../../docs/setup-guide.md)、[測試](../../../docs/testing.md) 與 [部署](../../../docs/deployment.md)。
