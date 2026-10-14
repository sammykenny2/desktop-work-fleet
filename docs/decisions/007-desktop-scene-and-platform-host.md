# ADR-007: 共用卡片場景與平台 host 邊界

## Status

Proposed，2026-10-04。產品語意以已接受的 [ADR-006](006-card-group-and-formation-semantics.md) 為準。
本提案提供實作方向；未選 renderer framework、核心語言或原生視窗拓撲。
協定限制與資料不遺失等必要條件，不因本 ADR 尚在 Proposed 而可被忽略。

## Context

群組操作需要整組提高、選中卡最前面、自由移位、formation 與轉組目標提示。
來源還需能從 Drive 擴充到 API 來源，renderer 也不只有桌面。
Wayland layer-shell 不定義同一層內多個獨立 surface 的排序，
因此不能依賴「每卡一個 native window」作跨平台的任意卡片 z-order 保證。
詳見 [平台研究](../research/2026-10-04-desktop-interaction-platform-feasibility.md)。

## Decision

提議採以下邏輯責任，名稱不是預先指定語言、library 或必須新增的服務：

| 邊界 | 責任 | 不得承擔 |
|---|---|---|
| Content / Group core | 卡片身分、內容、歸屬、條件式命令、草稿 | OS 視窗 handle、裝置座標 |
| Source coordinator | 本機一致狀態、outbox、provider session、衝突保留 | 決定點擊手勢或自動排版 |
| NoteSource / FileStore | 來源語意與能力；檔案型來源另接傳輸 | 用 Drive 檔案順序決定卡片疊序 |
| DeviceLayoutStore | 群組區域、位置／尺寸、基本疊序、undo | 全域共同位置或來源 token |
| FormationPlanner | 固定輸入產生排列計畫、溢出／尺寸同意資訊 | 在計算中直接搬動 native window |
| InteractionController | scope、focus、選卡、編輯、拖曳、候選轉組 | 保存整張舊 note 覆蓋較新內容 |
| Scene / Renderer | 繪製卡片、微亮、目標命中、可控卡片排序 | 自行連 Google 或將顯示順序持久化為歸屬 |
| PlatformHost | OS 層級、顯示器、輸入區域、焦點、快捷鍵、生命週期 | 強迫 cardId = windowId |

### 呈現表面建議

- 尤其 Wayland，優先按「輸出螢幕×有效系統層」建立少量共同繪製表面，
  同層卡片順序由 renderer 控制。也可評估能明確控制子表面的等效設計。
- 指定群組操作可將該組的呈現暫時切到浮動表面，其餘卡片仍在原層；
  轉移呈現不複製卡片資料、不換 cardId、不改本機邏輯位置。
- 不要求 Windows/macOS 的原生表面數與 Wayland 完全相同；共用的是行為契約。
- 提示表面只畫視覺，不搶 pointer capture 或鍵盤焦點；實際輸入區域只覆蓋允許操作的位置。
- 正常觀看時保持滑鼠穿透；不能因使用全螢幕透明視窗，就讓整個桌面無法點擊。
- Native surface 的 alpha、input region、重繪及部分區域穿透需按 backend 證明；
  不把某平台的忽略整窗滑鼠 API 當成三平台的逐區域命中能力。

### 契約必要資訊

平台能力至少區分：desktop-layer、wallpaper-layer、temporary-floating、
input-regions、keyboard-on-demand、global-shortcut backend、monitor mapping。
這是 typed capability 報告，不是開發者臆測 OS 名稱就一律回 true。
未支援能力需有可達替代入口與正確產品說明；不能自動刪掉另一平台或偷偷改成普通視窗。

Group 類型需有穩定 ID；FileNoteSource 除卡片還要定義共享群組 metadata 的版本及引用。
未來來源若沒有原生群組，需明確設計附屬 metadata 的權威位置，不可在各 renderer 各存一套。
手機與主畫面可直接送 MoveCardToGroup，不依賴桌面 grid 或 Shift 鍵。
動態 plugin 是否進 1.0 仍需產品範圍確認，抽象介面本身不代表要執行外部程式。

## Consequences

### Positive

卡片排序、formation、轉組可用平台無關情境驗證；本機版面不污染同步資料。
Linux 協定限制明確進入選型，不在最後發佈才發現無法任意輪播。

### Negative

共同表面需要區域輸入控制、螢幕座標映射及重繪策略。
跨螢幕拖曳與不同系統層之間的視覺交接需整合驗收，不能只測純模型。

### Neutral

這不指定 Tauri、Swift、WebView 或 canvas library；也不保證共享一套 native window 程式。
既有 0.1.0 host 可作局部經驗，但其 HTTP／SQLite server 不是 Drive 1.0 的必要依賴。
採用任何第三方 backend 前，都需確認實際授權、連結方式、散布及商店相容性。

## Alternatives Considered

| 方案 | 評估 |
|---|---|
| 每張卡各一個 native window，完全依賴 OS 排序 | 不可作通用保證；Wayland 同層排序未定義 |
| 每次輪播重建 native windows 來碰排序 | 易閃爍、失去焦點／capture，不是明確協定保證 |
| 所有卡始終在單一最上層整屏視窗 | 無法直接滿足非操作組留在桌面與空白處穿透 |
| 只做一般 App 視窗來避免桌面整合 | 可作測試 renderer／特定環境替代，但不能取消桌面產品目標 |
| 所有來源強制變成檔案／所有平台強制同一 backend | 把異質性藏到錯誤抽象，不採為前提 |

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [平台能力與證據](../research/2026-10-04-desktop-interaction-platform-feasibility.md)
- [PLAN-003](../plans/003-desktop-interaction-implementation.md)
- [來源與 renderer 的先前提案](004-google-drive-notes-mvp.md)
