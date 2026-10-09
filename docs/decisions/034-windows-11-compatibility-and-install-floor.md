# ADR-034: Windows 11 相容範圍與 MSIX 安裝下限

## Status

Accepted（支援範圍與實作邊界），2026-10-09。23H2 原生與 MSIX 內容驗證已接續，正常互動、安裝與其他版本實機仍待驗收；執行狀態見 PROGRESS。
補充 ADR-028／030；取代原本「只支援 24H2 以後」產品範圍。

## Context

使用者在 2026-10-08 要求支援 Windows 11 23H2 及更早版本，也保留 24H2 及以後版本；
Windows 10 不需適配，但未來上架 Microsoft Store 時必須在安裝階段排除。
使用者提供 23H2 電腦共同測試，目前沒有 24H2+ 電腦可驗證，希望盡量避免 regression。
尚未保留 Partner Center 應用身份，也尚未進入 Store 上架階段。

2026-10-09 使用者確認需求真正屬於本專案，要求先提交 ADR／SPEC／PLAN，交給新 session 接續。
前一輪誤套到另一個 Tauri 專案的程式與通過紀錄不構成本專案的實作或驗收證據。

本專案使用 WPF／WebView2，已有 MSIX／ZIP 封裝與新舊 Explorer 宿主發現路徑。
最初文件交接時 `scripts/generate-windows-manifest.mjs` 設定 `MinVersion=10.0.26100.0`，排除了 23H2；同日後續實作改為 22000。
既有原生紀錄在 build 26200；它對應 25H2，不能當作 build 26100／24H2 的實測。

## Decision

- Windows 支援目標為 Windows 11 21H2／22H2／23H2 及 24H2+。版本是驗收維度，不以 OS build 硬切 Explorer 私有結構。
- MSIX 的目標安裝下限為 `Windows.Desktop MinVersion=10.0.22000.0`，涵蓋早期 Windows 11 並排除 Windows 10。
  先完成 23H2 原生驗證，再改封裝並驗證最終包；不得只改商品說明或讓 Windows 10 安裝後才啟動失敗。
- 保留現有 `MaxVersionTested=10.0.26200.0` 及其歷史證據；沒有新版本證據時不無故調整相容性行為。
  `net8.0-windows10.0.19041.0` 是編譯 API 基線，不是產品支援或 Store 安裝下限，無需為本任務直接更換 framework。
- 延續 ADR-030 的同 Explorer PID、真正圖示／桌布宿主與疊序校驗、必要時的有界宿主建立請求、DPI awareness 檢查與 physical/client 座標轉換。
  優先驗證已存在的 classic sibling 路徑，按實際失敗做最小修正。
- 保留已驗證的 windowed WebView2 附著場景、floating composition 場景、空 region 下的啟動順序與紙面圓角。
  不導入 Tauri 的視窗管理、fallback 或輸入政策，不複製另一產品的程式／資料模型。
- 群組操作、唯讀選字、穿透、formation、單一 Workspace 與草稿交易繼續遵循 SPEC-003／ADR-018／020／030。
  系統宿主失效時保留偏好與資料，按既有能力回報與恢復契約處理，不假報附著成功。
- Store 身份保留、正式簽章、提交與 Windows 10 Store 安裝入口驗收留至上架階段。
  本任務可驗證 preview MSIX 的版本限制；不能把它當成 Store 上架完成。既有 preview 身份與憑證保持獨立。

## Consequences

### Positive

- 23H2 可進入支援與測試範圍；未來 Windows 10 安裝限制有明確封裝契約。
- 復用本專案現有架構與探針，降低對 build 26200 已驗證路徑的改動。

### Negative

- Explorer 是私有結構；21H2／22H2／24H2+ 缺少本輪設備，跨版本完成聲明受證據限制。
- 23H2 通過與純邏輯回歸不能保證較新系統沒有 regression；需要後續實機補驗。

### Neutral

- 不改便箋格式、同步、帳號、備份或其他平台；相容性實作沿用現有原生呈現路徑，不自動升版或發布。

## Alternatives Considered

- 保持最低 26100：會排除使用者指定的 23H2 與早期 Windows 11，拒絕。
- 僅降低最低版本、跳過原生驗證：只能證明安裝資格，不能證明畫面／輸入可用，拒絕。
- 複製另一專案的相容層：runtime、renderer、場景與資料權威不同，拒絕。
- 為測試通過移除 DPI 檢查或回退任意 WorkerW：違反 ADR-030，拒絕。

## References

- [SPEC-005](../specs/005-windows-11-compatibility.md)、[PLAN-004](../plans/004-windows-11-compatibility.md)、[接手入口](../handoff/2026-10-09-windows-11-compatibility-handoff.md)
- [ADR-028](028-native-package-and-signing-entry-points.md)、[ADR-030](030-windows-explorer-wallpaper-layer.md)、[PROGRESS](../../PROGRESS.md)
- [Windows 11 release information](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information)：21H2／23H2／24H2／25H2 的 build 基線。
- [TargetDeviceFamily](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-f-targetdevicefamily)：MinVersion 部署適用性與 MaxVersionTested 相容性行為。
- [SetParent](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent)：WS_CHILD／WS_POPUP 與跨程序 DPI 風險。

*Decision made: 2026-10-09*
