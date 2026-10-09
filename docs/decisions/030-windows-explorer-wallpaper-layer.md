# ADR-030: Windows Explorer 桌布與圖示宿主分層

## Status

Accepted，2026-10-05。依使用者要求實作 Windows 桌布層。
取代 ADR-017 的一般底部視窗常駐政策，以及 ADR-018／020 的兩層場景限制。
2026-10-09 自有附著 HWND 的額外 composition／clipping styles 與背景生命週期見
[ADR-035](035-windows-attached-scene-background-lifecycle.md)；不修改 Explorer styles 或桌布設定。

## Context

原有 host 只有 desktop／floating 場景，wallpaper 偏好回退 desktop。
一般視窗 HWND_BOTTOM 無法區分圖示上下層。使用者要求真正的桌布層，
操作群組暫時置頂，結束後依目前常駐設定復原。

## Decision

- Windows 使用 desktop、floating、wallpaper 三層。每顯示器各一個場景，
  沿用單一 Workspace 與互補輸入／視覺視窗；上限 16 顯示器、48 場景。
- desktop 附著到擁有 SHELLDLL_DefView 的 Explorer 宿主，位於圖示上方。
  wallpaper 附著到該宿主下的 WorkerW 子視窗，或經典 shell 中位於圖示宿主後方的 WorkerW。
  不選任意 WorkerW，也不將圖示宿主當作桌布宿主。
- 僅在既有桌布宿主不可用時，以有界的 Explorer 0x052C 訊息要求建立宿主。
  這是非公開 Explorer 協定；本輪功能要求取代先前不使用此協定的限制。
  不修改桌布檔案、registry 或使用者桌面設定。
- 僅變更自有視窗的 WS_CHILD／WS_POPUP、parent、位置及疊序。
  compatibility manifest 啟用 Windows 10 的 layered child window 支援。
  附著前確認 parent／child DPI awareness 相同，避免跨程序 SetParent 重設 App DPI。
  physical bounds 轉換成 parent client coordinates；顯示及排序不啟用視窗。
  renderer ZoomFactor 與 input rect 使用附著後實際 HWND 的 DPI，避免沿用 monitor 描述而錯位。
- wallpaper 固定滑鼠穿透，不接受唯讀選字、拖曳或編輯；共用政策、native frame 驗證
  與輸入區域共同維持此限制。操作群組時改投影到 floating，常駐偏好與 geometry 不變。
  結束後使用目前設定，回到 wallpaper 或操作期间另選的層級。
- 宿主不可用時不回報 wallpaper capability，主畫面明示暫時回退並保留偏好。
  TaskbarCreated、顯示器／喚醒通知及低頻存活檢查接入既有 topology 更新。
  Explorer 銷毀的 resident 場景退休後重建；floating 編輯場景不附著到 Explorer。

## Consequences

### Positive

桌布及圖示宿主真正分離，切層仍沿用既有交易、位置與草稿屏障。
管理入口不因宿主失效刪除便箋。

### Negative

Explorer 私有結構可能隨 Windows 更新改變；每層增加 WebView 資源，需維持 DPI／生命週期檢查。

### Neutral

沒有新增外部依賴、listener 或參考應用程式碼。依使用者提供的位置查閱輔助參考專案的
分層行為與已知問題，本案以 C# 獨立實作。實際結果及未測 OS 範圍見 PROGRESS。

## Alternatives Considered

- 一般底部視窗／wallpaper 回退 desktop：不能滿足圖示下方的要求。
- 修改桌布圖片：不能支援 live note 更新與群組操作。
- 每卡一個 WebView：增加成本並失去共同 renderer 的穩定疊序。

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)、[PLAN-003](../plans/003-desktop-interaction-implementation.md)
- [ADR-017](017-windows-composition-surface-and-input.md)、[ADR-018](018-single-owner-desktop-views.md)
- [SetParent](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent)
- [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos)
- [Layered child windows](https://learn.microsoft.com/en-us/windows/win32/winmsg/using-windows)
- [測試](../testing.md)、[執行狀態](../../PROGRESS.md)

*Decision made: 2026-10-05*
