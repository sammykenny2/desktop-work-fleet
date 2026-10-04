# ADR-008: 可攜互動核心與原子本機命令

## Status

Accepted，2026-10-04，限本機語意核心與本輪明確核准的 1.0 範圍。
原生 host、OAuth SDK 與正式 Drive wire format 在後續 slice 另行落實，不以本 ADR 宣稱已完成。

## Context

維護者已要求逐 slice 實作並直接推送 main，直到完整 1.0 完成。
同輪答覆納入 Markdown、checklist、附件、完成／封存、逐卡顯示／層級、唯讀選字、
群組／版面備份、自動及加密備份、匯入／合併／取代還原；其餘細節委託最佳實踐定案。
交付包含 Windows、macOS、Linux、iOS、Android 原生 App 與商店提交準備。
實際商店送審、購買憑證或建立帳號仍不是本輪的隱含外部操作。

## Decision

- 卡片、群組、formation、geometry undo 與互動控制器使用無 runtime 套件依賴的 ES modules。
  [型別契約](../../contracts/desktop.d.ts) 定義邊界，Node 可直接執行語意回歸；
  不將 Node、Python HTTP 服務或桌面視窗 handle 放進產品資料模型。
- Workspace 以 profile 分區，命令先在副本運算；persist 成功後才發佈新狀態。
  原生儲存 adapter 必須原子保存整份交易並比對版本；不以記憶體測試冒充落盤證據。
- 一個 profile/device 只有一個本機寫入協調者。版面、共享內容、草稿、outbox 有各自欄位，
  轉組同時提交卡片歸屬、此機位置、undo 及待傳操作。
- 內容 revision、layout revision、pointer session 身分分離。转組只改歸屬，不用舊卡片快照覆蓋本文。
  發現版本競爭時保留轉組意圖；復原是新的條件式操作。
- Formation 純計算、明確提交，使用 renderer 提供的摘要帶量測；尺寸同意限當次預覽。
  過期預覽拒絕提交。容量不足保持原狀，提示使用主畫面管理或調整本次排列；不自動隱藏、分頁或縮字。
- 群組刪除／合併須在後續 UI 明確指定卡片目的群組並顯示預覽；不得連帶隱含刪卡。
  群組超限的已同步資料全部保留；新建與無法容納的 formation 會回報明確錯誤。
- 文字、附件與未識別內容欄位完整保存；正式匯入驗證遇到無法理解的必要格式必須拒絕有損轉換。

## Consequences

### Positive

同一組 C 案例可以先測模型，再由桌面及手機 adapter 重用，不需要複製五套互動規則。
來源替換不影響群組／位置語意；版面 undo 不回退文字、顯示政策或其他裝置的操作。

### Negative

本機單一協調者與原子 persistence 是必要條件；每個 renderer 不可各自載入並覆寫同一 profile。
目前整份 snapshot 交易尚須以大資料效能量測決定分頁式本機儲存策略。

### Neutral

本機 outbox 尚未等同 Drive 同步協定，原生分層與輸入區域仍須各平台實測。
本 ADR 不採用 Tauri／Electron 或新增第三方依賴，也不將普通瀏覽器視為原生桌面驗收。

## Alternatives Considered

- 在五個 host 分別實作手勢與 formation：容易產生資料語意差異，先抽出共同核心。
- 直接改造 0.1.0 Python server 作正式權威：不符合無自家便箋 server 的已確認方向。
- 移位與轉組分兩筆保存：中斷可留下部分成功；改為同一本機交易。

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [ADR-006](006-card-group-and-formation-semantics.md)
- [PLAN-003](../plans/003-desktop-interaction-implementation.md)
