# ADR-003: 正式產品的工作資料、同步與平台邊界

> 2026-10-04：本 ADR 繼續 Deferred。下文 Note 容器／Item 拆分是歷史提案，
> 不規範已確認的一事一卡；新的產品語意見
> [ADR-006](006-card-group-and-formation-semantics.md)。未來採用舊提案前也需重新對齊。

## Status

Deferred，2026-10-03。原 Proposed 內容保留為完整 PM／自架 server 的後續設計。
使用者改以 Google 帳號＋file based 便箋作為 1.0 MVP，詳見 [ADR-004](004-google-drive-notes-mvp.md)。
本文件不再是 1.0 的必做架構，也不取代 ADR-002 對 0.1.0 驗證版的歷史記錄。

## Context

原型已有收資料、編輯、競爭與恢復的基本流程。
目前 Note 兼具全文、狀態與待辦，平台視窗也直接負責網路；
繼續直接擴充多便箋會把驗證版模型帶入正式產品。
使用者希望先做好架構，保持 backlog／快速記錄優先。

## Decision

提議：

- Note 是容器；Item 是有穩定 ID 的文字或工作項目，task 才有三種工作狀態。
- Project／Environment 可選，View 引用相同資料；DeviceLayout 與共同內容分開。
- 模組化單體 server 保存已提交權威資料；每個 client 以本機 store/outbox 保存未同步操作。
- Server 本機 SQLite + 版本化 API 起步，檔案為匯入／匯出用途。
- 每筆條件式更新、原子操作收據、cursor 與 epoch 支援同步和恢復。
- App 自帶 UI／client 功能；平台 adapter 處理 OS 能力，所有桌面視窗共用一份 client 狀態。
- 先完成 schema／同步／技術選型，再接多視窗與平台整合驗收。

完整不變量、取捨與原型遷移策略見 [正式架構草案](../resreach/2026-10-03-product-architecture-blueprint.md)。

## Consequences

### Positive

任務可跨便箋、清單與看板一致呈現；特殊桌面能力不影響資料正確性；
手機與 Web 有獨立可用的編輯／同步入口。

### Negative

比原型需要更多契約與本機交易設計；必須設計 v0.1 資料及草稿遷移。
多端共用程式碼的範圍與維護成本仍需技術選型。

### Neutral

保持 Todo／In Progress／Done 的簡單 UX；不新增 Agent 執行工作流程。
Framework、server 語言、wire format、最低 OS 版本尚未因本提案而定案。

## Alternatives Considered

### 直接擴充現有整張 note 模型

改動較少，但無法乾淨地支援獨立待辦狀態、不同檢視與項目級衝突，故不建議作為正式模型。

### 多機直接同步檔案作為權威

具可攜優點，但需要額外設計多 writer、刪除、排序與語意衝突；
本案建議先採單一 server，保留匯出資料的可攜性。

### 微服務或完整即時 CRDT 編輯

增加部署與資料協調工作；目前個人 backlog 沒有足夠需求支持此成本，延後。

## References

- [ADR-001](001-independent-backlog-first-foundation.md)
- [ADR-002](002-validation-runtime.md)
- [正式架構草案](../resreach/2026-10-03-product-architecture-blueprint.md)
