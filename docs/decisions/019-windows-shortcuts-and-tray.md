# ADR-019: Windows 快捷鍵、焦點與系統匣入口

## Status

Accepted，2026-10-04。Windows 桌面入口整合；OS 組字、實體輸入及完整平台矩陣依 PROGRESS 記錄。

## Context

桌面場景已有單一 Workspace，但操作入口仍依賴主畫面。需接全域快捷鍵與常駐入口，
同時避免全域註冊吃掉本 App 的組字／文字按鍵，或保存延遲後取得已不再屬於本操作的焦點。

## Decision

- 快捷鍵保存於本機 LayoutStore，群組目標保持穩定 ID；最多 32 組。
  主畫面合併相同／連續設定更新，原生依實際 RegisterHotKey 結果回報逐鍵狀態。
  衝突、保留鍵及不可用仍保留設定；可改鍵或重試，不宣稱已成功全域註冊。
  Ctrl+Alt（含 Shift）加字母／數字標示為 typing 並不註冊，以保留 AltGr 產字；
  新工作區 capture／toggle 預設 Ctrl+Shift+N／D，既有設定不改寫。本地 AltGraph 事件優先放行。
- 本 App 原生視窗 Activated 同步解除全部 OS 註冊；Deactivated 延後核對 foreground process，
  tray 選單開啟前同步 block，另以低頻 dispatcher timer 核對 foreground。失去 App 焦點才重新註冊並顯示新的衝突結果。
  初始化及關閉 block 獨立於設定更新，不能因重新套用 bindings 提前解除。
- 焦點所在主畫面／scene 處理本地快捷鍵；普通文字編輯鍵、IME、repeat、已消耗事件與 modal 優先。
  就地編輯允許群組 scope 快捷鍵，先可靠保存最後文字再轉換。其他輸入欄位不執行工作區快捷鍵。
  scene 只傳按鍵，owner 以當時設定解出 target，過期或移除的 binding 不執行。
- 原生快捷鍵與 tray 命令共用既有操作序列，不另開 Workspace。
  需要焦點時等待對應完整 projection 已發布且 scene 已套用輸入區域，再啟用有可操作卡片的浮動表面。
  native intent 有效期五秒，必須仍是原 foreground HWND 及最後輸入時間；晚到的動作不能搶走後續使用者焦點。
  主畫面本地快捷鍵在排隊前即請求 intent，host 在 message admission 擷取；scene 在第一個保存 await 前請求，
  token 綁 view、一次性，經 native 驗證後才放入 owner metadata。缺少有效 intent 不 Activate。
  tray 在排入 dispatcher 前擷取相同 intent，不能在延遲 callback 執行時重新授權。
  Windows 拒絕 activation 時保留可點擊紙面，不模擬按鍵、不改系統 foreground-lock 設定。
- 系統匣使用公開 Shell_NotifyIcon／version 4、自有隱藏 top-level HWND 與原生選單，
  支援鍵盤選取、主畫面、快速記錄、全部操作、結束 scope、桌面顯示切換、收起及保存退出。
  TaskbarCreated 僅重建自有 icon；移除／退出釋放自有資源，不修改 Explorer 或其他應用設定。
- 「收起主畫面」先保存草稿再 Hide，保留 WebView／Workspace／SQLite／桌面表面。
  缺少有效 tray icon 時不收起；重建失敗會重新顯示主畫面但不主動啟用。
  2026-10-06 使用者改決定：tray 可用時，視窗 X、Alt+F4 與工作列關閉（SC_CLOSE）直接收起到系統匣，
  頁面及其草稿留在執行中的 WebView；tray 不可用時 X 仍保存並退出。
  系統匣「保存並結束」、程式內 Close 與 WM_CLOSE 沿用既有 durable close 協定。

## Consequences

### Positive

主畫面可收起且有可達入口；全域與本地按鍵由焦點所有權分工，保存及退出仍只有既有交易路徑。

### Negative

IME 組合、實體键盤配置及 Windows shell 行為仍需實機驗收；保守焦點條件可能要求使用者點一下已呈現卡片。
目前系統匣使用 Windows 系統應用 icon，品牌圖示隨正式封裝整合。

### Neutral

未新增 runtime 套件、listener、常驻鍵盤 hook 或系統設定變更。瀏覽器預覽仍只有本地快捷鍵。

## Alternatives Considered

### 全域鍵保持註冊，只在 callback 忽略組字

按鍵已被 OS 註冊攔截，忽略 callback 無法還給 editor，因此拒絕。

### 等待保存後無條件 Activate

使用者可能已轉到另一個視窗或繼續輸入，因此改用短效 native intent 與畫面套用條件。

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [ADR-017](017-windows-composition-surface-and-input.md)、[ADR-018](018-single-owner-desktop-views.md)
- [Windows 快捷鍵與 shell 研究](../research/2026-10-04-windows-shortcuts-and-tray.md)
- [桌面 IPC 契約](../../contracts/desktop-scene.d.ts)

Decision made: 2026-10-04.
