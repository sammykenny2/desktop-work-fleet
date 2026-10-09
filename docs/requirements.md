# 需求與版本範圍

更新：2026-10-09。互動規範以 [SPEC-003](specs/003-desktop-cards-groups-and-formation.md) 為準。
該規格明列 U（已確認）、D（授權工作預設）、Q（待決），不能把研究候選當成已批准功能。

## 已確認產品方向

- Backlog／靈感快速記錄優先，一張 card/note/post-it 記錄一件事。
- Group 是通用邏輯集合；本機可突出「屬於我」，不要求每張卡屬於 Project 或 Agent 工作。
- Windows、macOS、Linux 是必要桌面平台；保留自有 iOS/macOS/Android 商店目標。
- 第一版 Google 帳號＋file based，沒有自家便箋 local server；異質來源／renderer 的邊界現在設計。
- 日常唯讀且滑鼠穿透。某組／全部可暫時浮到一般 App 上方進入拖拉，再進入單張文字編輯。
- 單擊選卡、雙擊編輯；普通拖曳只改位置，接收標籤／Shift 拖入群組區域或 action 才改歸屬。
- 顯式 formation 可全局或單組召回整理；堆疊露第一行、攤開排完整紙面。區域不是硬容器。
- 輪播只暫時改疊序；操作組高於其他組，選卡在組內最前，不搬動卡片。
- 平常紙張尺寸穩定；formation 必要時取得同意才調整，未同意可溢出群組區域。
- 群組最多九組；grid 列≤3、欄≤4，且乘積≤9。2列×4欄及3列×3欄合法，3列×4欄不合法。
- 新卡初始在自己的群組區域，不重排舊卡；formation 提供復原。
- 不加入 Focus／番茄鐘／回顧；不照搬外部產品 UI、架構或大量原始碼。

[ADR-006](decisions/006-card-group-and-formation-semantics.md) 接受上述語意；
[討論演進](resreach/2026-10-04-desktop-card-interaction-design.md) 保存修正原因。
「浮到一般 App 上方」及轉組手勢已在整理期間獲明確確認，後續 agent 不必重問。

## 可直接採用的工作預設

使用者授權其他細節按最佳實踐規劃。SPEC-003 的 D 包含：
新手預設一組與全組操作入口、列×欄／row-major 配置、單主要群組、
共享內容與每機 geometry 分離、可靠草稿、顯式轉組命令、取消／undo、
群組轉移不觸發 formation，以及顯示器失連只救回不可達卡片。
它們不是使用者逐字指定的 UI，但可在後續實作授權下依規格執行。

## 2026-10-04 實作範圍補充

維護者已要求逐 slice 實作、驗證並直接推送 main，直到完整 1.0 完成，並明確核准：

- Markdown、checklist、附件、完成／封存。
- 逐卡顯示與層級、唯讀選字。
- 含群組／每機版面的自動及加密備份、匯入／合併／取代還原。
- Windows、macOS、Linux，以及 iOS／Android 原生 App 與商店提交準備。
- 其他技術、容量與操作細節依最佳實踐定案；保留全部 U 要求，不照搬參考應用。

SPEC-003 的 Q01–Q07 表已記錄這些答案與工作預設。
[ADR-008](decisions/008-portable-interaction-core.md) 記錄共用語意核心與交易邊界。
商店準備不等同商店已核准；外部 OAuth、正式簽章及真實裝置驗收需保留各自證據。

## Google 與備份的現況

[Drive 研究](resreach/2026-10-03-google-drive-notes-mvp-feasibility.md) 建議 Drive 而非 Keep，
appDataFolder provider 已由 ADR-012 採納，協定見 SPEC-004；原生 OAuth／真 Google 整合仍待驗收。
[SPEC-002](specs/002-portable-backup-and-restore.md) 與 [ADR-013](decisions/013-complete-portable-backup.md)
定義完整 ZIP／JSON、群組／版面／附件、自動／加密備份及三種還原；取代 ADR-005 早期候選。
執行證據見 PROGRESS，不能把無損往返只測本文，也不能把格式模組當完整備份流程已交付。

## 2026-10-09 Windows 支援範圍補充

使用者確認原先 Windows 相容性討論的真正目標是本專案，並要求先提交文件交接。
Windows 11 21H2／22H2／23H2 與 24H2+ 均為支援目標，先用目前 23H2 電腦實測；
沒有本輪新版設備，保留既有新版顯示路徑並補回歸，不宣稱零 regression。
Windows 10 不需產品適配，但未來 Store 必須在安裝階段排除；MSIX 目標 MinVersion 為 22000。
目前產生器仍是 26100，修改與最終包驗證尚未完成。
Partner Center 尚未保留應用，Store 身份／正式提交延後；本輪不升版、發布或改 runtime。
詳細要求、驗收與施工順序見 [ADR-034](decisions/034-windows-11-compatibility-and-install-floor.md)、
[SPEC-005](specs/005-windows-11-compatibility.md)、[PLAN-004](plans/004-windows-11-compatibility.md)。
這些需求不套用到另一應用；其實作與通過紀錄不能作為本專案證據。

## 延後而保留的方向

完整 PM、Project/Item/View、自架 server 與多歸屬留作後續研究；
這不代表未來必須恢復舊 Note 容器模型。簡單 Todo／In Progress／Done 的具體 1.0 UI 尚未定案。
不引入 Queued/Running/Waiting/Succeeded/Failed/Cancelled 之類的 Agent 執行狀態作預設。

## 證據及接手

API 可行、原生基礎實測、新功能驗收與商店核准分開紀錄。
參見 [平台研究](resreach/2026-10-04-desktop-interaction-platform-feasibility.md)、
[0.1.0 驗證報告](validation/2026-10-03-validation-report.md) 及
[接手規則](handoff/2026-10-04-desktop-interaction-handoff.md)。
