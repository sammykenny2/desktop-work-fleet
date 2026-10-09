# 2026-10-09 Windows 11 相容性接手

## 使用者需求與本輪授權

2026-10-08 使用者要求 Windows 11 23H2 及之前、24H2 及之後同時支援；
Windows 10 不重要，但未來 Store 上架後不能被它安裝。
使用者會以這台 23H2 共同測試，沒有 24H2+ 設備，希望盡量避免新版 regression。
Partner Center 尚未保留應用，尚未進入 Store 階段。

2026-10-09 使用者指出先前 session 選錯專案，真正目標是本專案。
本輪要求先整理相關 ADR／SPEC／PLAN、直接 commit／push main，之後在本專案開新 session 接續。
目前移交的是需求與實作路線，不是另一應用的實作或通過結果。
同日新 session 已獲實作授權並接續原生／封裝工作；目前使用者互動與安裝驗收入口見下方，完成證據只在 PROGRESS。

## 先讀

1. 根目錄 AGENTS 與自己的 agent 檔、docs/AGENT-GUIDE。
2. [PROGRESS](../../PROGRESS.md) 的最新 2026-10-09 Windows 11 實作紀錄與原始需求交接。
3. [ADR-034](../decisions/034-windows-11-compatibility-and-install-floor.md)、[SPEC-005](../specs/005-windows-11-compatibility.md)、[PLAN-004](../plans/004-windows-11-compatibility.md)。
4. [ADR-030](../decisions/030-windows-explorer-wallpaper-layer.md)、[SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)、PROGRESS 的 2026-10-06 顯示／啟動黑塊修正。
5. [測試](../testing.md)、[封裝](../deployment.md)。不重新探索 WPF 或重問已確認的支援範圍。

## 現況

- Windows host 是 .NET 8 WPF／WebView2。附著場景用 windowed WebView2／不透明紙面 region；floating 用 composition。已有現代 Windows manifest／PerMonitorV2。
- `NativeShellLayers.cs` 已同時找 Progman-child 與 classic sibling，限定 Explorer PID／可見性／圖示下方。
- `DesktopSurface.cs` 用 GetAncestor 讀真正 parent、檢查 DPI awareness、ScreenToClient 轉座標；Start 保持空 region 的附著視窗可見直到 WebView2 建立，避免黑塊。
- 已有 TaskbarCreated、顯示器／喚醒與低頻存活檢查，不需要先增加另一套恢復機制。
- MSIX 產生器最低版本已改為 `10.0.22000.0`，保留 26200 MaxVersionTested；最終未簽章包內容已核對，安裝仍待驗收。
- 原生歷史證據是 build 26200／25H2、單螢幕 144 DPI；不能視為 26100／24H2 或本次 23H2 的通過證據。
- 2026-10-09 唯讀盤點：本機 23H2 build 22631.6199、圖示宿主 Progman／DefView 為 144 DPI／PMv2。
  Progman 下沒有新版 child WorkerW；後續已完成隔離 native probes，真 Explorer 三層像素、座標／附著與切層皆通過，其他手動項目見 PROGRESS。
- Windows 版號紀錄目前 `0.1.1`；任何升版須先取得使用者對具體版號的同意，Actions dispatch 也須明確授權。private repo 本月 Actions 額度接近用完，優先本機封裝；這次沒有升版或啟動 CI release。

## 接續入口

原生與未簽章包內容已驗證；目前先接續 PLAN-004 Phase 3 的使用者正常互動。
沒有本機 preview 憑證，解壓 `build/WorkFleet-0.1.1-x64.zip` 後執行 `WorkFleet.exe`；MSIX 安裝需另有合適簽章。
新增原生改動需要回歸時，核對工作區與既有 App，再使用現有隔離入口、保留失敗證據：

```powershell
./scripts/windows/Get-ShellLayerInventory.ps1
./scripts/windows/Test-WindowsNative.ps1
# 已還原依賴時可改為：
./scripts/windows/Test-WindowsNative.ps1 -SkipRestore
```

不要把這兩個 Test 命令連跑；後者是同一入口的離線選項。
分析 classic host 建立／選擇、SetParent／DPI 與 WebView2 顯示；只改實際失敗。
原生成功後才改 MSIX 下限並驗證最終包，補舊新分支與包版本回歸。

正常 Debug 與安裝版共用 `%LOCALAPPDATA%\WorkFleet`，先備份再進互動測試；
不要刪資料、移除安裝或改憑證信任。Win+D 由使用者手動操作；Explorer 重啟／混合 DPI 另安排。
Store 身份與提交延期；23H2 先完成，缺新版設備與獨立審閱明確記在 PROGRESS。

## 交付界線

最初 c53494a 只有文件與唯讀盤點；同日後續實作已接續本 repo 的原生回歸與安裝下限修改，精確完成／未測狀態見 PROGRESS。
前一輪另一專案的提交保留與否由使用者另決定；本 repo 不依賴它，也不進行其 revert／cherry-pick。
詳細完成狀態只在 PROGRESS 維護；本文件是接續入口。
