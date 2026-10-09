# PLAN-004: Windows 11 相容性實作與驗收交接

## Metadata

| Field | Value |
|---|---|
| Status | 需求已確認；本輪完成文件交接，實作由後續 session 接續 |
| Owner | 專案維護者 |
| Assigned To | 後續 Windows 相容性實作 session |
| Reviewer | 重要原生改動另安排獨立審閱；目前沒有 |
| 日期 | 2026-10-09 |

## Related Spec

[SPEC-005](../specs/005-windows-11-compatibility.md)、[ADR-034](../decisions/034-windows-11-compatibility-and-install-floor.md)。
產品互動仍按 SPEC-003；本計畫只描述施工順序，完成狀態以 [PROGRESS](../../PROGRESS.md) 為準。

## Overview

本專案已有 WPF／WebView2 三層場景、classic／modern Explorer 發現與 MSIX。
先取得 23H2 的實際失敗及新版既有基線，再小幅修正相容性，之後調整安裝下限與驗證包。
不把另一個 Tauri 專案的修改 cherry-pick 過來，不借其測試結果作本專案證據。

## Implementation Phases

### Phase 1: 23H2 原生基線與故障定位

- 核對本機 build、WebView2、DPI、既有實例與工作區；先看 PROGRESS 的黑塊／初始化順序及穿透修正。
- 用 `Get-ShellLayerInventory.ps1` 唯讀盤點。現有盤點是 22631.6199／144 DPI，Progman 下有 DefView、沒有新版 child WorkerW；它不證明 host 建立／附著成功。
- 用現有隔離資料探針測 core、UI、composition、platform、wallpaper 與 host-check；先保留每項 PASS／FAIL／SKIP 與輸出。
- 比對 `NativeShellLayers.Discover` 的有界 0x052C 请求、classic sibling 疊序與 DPI／SetParent；不以直接降低 MSIX 門檻當作原生成功。

交付：本專案的 23H2 基線、具體失敗與最小修改位置；不是新一輪框架重建。

### Phase 2: 最小修正與舊新結構回歸

- 優先修正有證據的失敗；保留同 Explorer PID、真正 parent、DPI awareness 與座標檢查。
- 適當抽出可測的宿主選擇／存活判斷，覆蓋 classic sibling、Progman child、錯誤 PID／圖示宿主／缺失、重建與句柄失效。
- 不無故更改 windowed attached／composition floating 的選擇、Start 建立順序、紙面 region／輸入、焦點与草稿交易。
- 驗證 W11-C02–C07；已有 Explorer／display watchdog 先修補，不另加每秒重新附著的平行機制。

交付：必要原生修正、對應回歸與證據；未能驗證的較新 OS 保持未測。

### Phase 3: MSIX 安裝下限與正常應用驗收

- 將產生器的 MinVersion 由 26100 改為 22000；保留 26200 MaxVersionTested 与編譯 framework 基線。
- 在產生 manifest／最終 package 的測試核對 Windows.Desktop、最低版本、版號及 preview 身份；避免測試只檢查 identity version。
- 使用既有 Build-WindowsPackage／Test-WindowsPackage，不建立另一套封裝；不修改憑證信任。
- 正常 Debug 與安裝版共用資料；先備份既有資料並關閉舊實例，再與使用者測第一次啟動、層級、群組／All、文字、拖動、圖示、Win+D。
- 安裝或發布新版本必須明確區分。沒有 Windows preview release 指令就不升版、不 dispatch CI、不建立 tag／GitHub Release。

交付：W11-C01、C03–C06 的 23H2 證據及包內容；較新版本／Windows 10 部署矩陣如缺設備留待補驗。

### Phase 4: 後續 Store 上架門禁

Partner Center 保留身份後再配置正式 package identity／publisher、簽章及支援文案。
確認 Windows 10 在 Store 取得／安裝階段被拒，以及支援的 Windows 11 可正常取得。
目前沒有上架指令，本階段不啟動，不能以 preview MSIX 驗證取代 Store 驗收。

## Files to Inspect or Modify

| 位置 | 用途 |
|---|---|
| `src/native/windows/app/NativeShellLayers.cs` | 新舊宿主發現、PID／可見性／疊序与存活；必要才修改 |
| `src/native/windows/app/DesktopSurface.cs` | 附著、實際 parent、DPI、座標、顯示／region；保留已測顯示路徑 |
| `src/native/windows/app/DesktopCoordinator.cs`、`NativeDisplayWatcher.cs` | 現有宿主／display 恢復及草稿屏障 |
| `tests/native/windows/ui/WallpaperProbe.cs`、`HostChildProbe.cs` | 真 Explorer 與仿宿主顯示／輸入／座標驗證 |
| `scripts/generate-windows-manifest.mjs`、`tests/release-versions.test.js` | 封裝最低版本與產生 manifest 回歸 |
| `scripts/windows/Test-WindowsPackage.ps1`、`Test-WindowsNative.ps1` | 最終包與原生門禁；必要才擴充 |
| `docs/setup-guide.md`、`docs/deployment.md`、`docs/testing.md`、`PROGRESS.md` | 實作後同步當前限制与實測狀態 |

## Testing Strategy

先執行唯讀盤點，再執行 `scripts/windows/Test-WindowsNative.ps1`（已 restore 時可加 `-SkipRestore`）。
共用 JS／Python 與建置命令按 [testing.md](../testing.md)。
`--wallpaper` 的 WebView capture 只能證明頁面繪製；真螢幕檢查若因其他視窗遮住而 SKIP，不得當作呈現通過。
必要時由使用者手動 Win+D 露出測試點；不自動注入 Windows 系統快捷鍵或重啟 Explorer。
保留已有 build 26200 的歷史證據，追加本次 23H2 紀錄；新舊設備結果分開寫。

## Risks and Mitigations

| 風險 | 處理 |
|---|---|
| 放寬安裝資格後才發現原生失敗 | 先跑原生探針，再調整包与驗收安裝 |
| 新版無本輪設備 | 減少改動、保留已有 renderer／host 路徑、補分支回歸並揭露未測 |
| 跨 DPI SetParent／黑塊 regression | 保留 awareness guard、physical bounds 與空 region 的可見初始化；真像素驗證 |
| 測試讀寫正常資料 | 先用合成 probe；正常應用先備份，保持原子保存与草稿屏障 |
| 把另一專案的需求／證據混入 | 只移交本需求；本 repo 的 PROGRESS 才是執行證據 |

## Handoff

下一個 session 從 Phase 1 開始。現有 MinVersion 仍是 26100，沒有本次 23H2 runtime PASS，沒有新 preview release。
這次文件移交由使用者要求直接 commit／push main；未做原生實作、打包、升版或 Store 提交。

*Created: 2026-10-09*
