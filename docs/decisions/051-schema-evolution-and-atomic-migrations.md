# ADR-051: 資料格式演進與原子本機遷移

## Status

Accepted，2026-10-17。維護者授權規劃並實作 schema version、相容偵測及 migration；不升 App 版號或發布。

## Context

工作空間、同步 revision、備份及原生資料庫已有獨立版本，但舊工作空間轉換散在載入流程。
需要可逐版驗證、跳版升級、失敗重試及原始副本，並避免舊裝置改寫不理解的雲端資料。

## Decision

- App 版本、Workspace CAS revision、JSON schema 及 SQLite/IndexedDB 結構版本分開管理。
  共用版本登錄與純 migration runner；未知、缺少、無效或高於支援範圍的版本均拒絕。
- 本機 Workspace 由 v1 升 v2：集中既有完整 outbox→版本圖、舊版面層級及快捷鍵轉換，
  明確保存 revisions、sync、membershipRebases。保留未知 JSON 擴充、歷史、草稿及待送操作。
  不杜撰缺失 parent，不更改不可變 revision 的內容、ID 或雜湊。
- 生產入口先在隔離副本完成全部步驟與驗證，再以原 CAS revision 原子保存原始 v1 與 v2，
  成功後才發布 Workspace、啟動同步或自動備份。資料版本與 CAS revision 同交易更新。
  保存失敗保留舊資料；回應遺失讀回完整 bytes，重開不重複升級。
- 原生主機重用 records 表內保留的 migration 命名空間，副本沿用原生加密與 profile 邊界；
  不新增 SQL 表，因此不變更 SQLite user_version。IndexedDB 結構 v2 新增 migrations store。
  原始副本可由受限 storage.recovery 讀回，禁止任意路徑、SQL、跨帳號及覆寫副本。
  副本只含 workspace 記錄，附件繼續按 hash 保存；它不是獨立可攜備份。
- 原始副本保留至該工作空間重設或本機完整還原；兩者同交易清除副本，避免已清除的便箋留下隱藏歷史。
  一般備份不攜帶 migration 副本、帳號、憑證或同步傳輸狀態。
- 同步 revision／Drive metadata、備份／加密封裝、版面與自動備份 journal 目前仍為 v1。
  不為尚未存在的格式杜撰轉換。共用 guard 明確回報不支援版本；備份先完整驗證再還原。
- 可選且語意相容的 value/content 擴充可沿用原 schema，但必須驗證舊 reader 的讀寫保留能力。
  固定 envelope 新欄位、型別／必填／刪除／衝突語意改動須升相關 schema，並提供舊→新轉換及 fixture。
  未知欄位保留不等於舊 App 理解新功能；影響安全寫入的功能須用新 schema 阻止舊 writer。
- 雲端歷史永不就地 migration。未來 reader 可將舊格式投影為目前模型，仍保留原始 bytes／ID；
  需保存新語意時建立新 revision。新版雲端格式出現時，舊版停止相關同步，不推進失敗頁游標或送出 outbox。
- 每次格式改動要有逐版步驟、歷史 fixture、跳版／重試／失敗／新版拒絕／未知欄位／混版裝置測試。
  migration 必須確定、無網路與其他外部副作用；持久化使用單一 owner 與 CAS。

## Consequences

### Positive

- 本機升級失敗不會把舊資料改成半套新資料；共享格式維持目前跨裝置相容。
- 後續版本沿同一入口增補遷移與相容矩陣，原始資料可供人工復原。

### Negative

- 原始 workspace 副本增加本機容量；不能以複製 SQLite 取代跨機可攜備份。
- Workspace v2 無法用舊 App 開啟；降版需使用升級前備份，不能直接把版本號改回 1。

### Neutral

- Windows/Linux 可在本輪驗證原生保存；Apple/Android 編譯與實機結果分別記在 PROGRESS。

## Alternatives Considered

### 每次載入補欄位，直到下次編輯才保存

無獨立提交點與復原副本，難以驗證中斷恢復，改由明確遷移入口處理。

### 直接改寫 Google 歷史檔案

破壞不可變 ID／雜湊及其他裝置的既有帳冊，拒絕。

## References

- [SPEC-007](../specs/007-schema-evolution-and-migrations.md)、[PLAN-007](../plans/007-schema-evolution-and-migrations.md)
- [ADR-011](011-immutable-revision-graph.md)、[ADR-012](012-durable-file-store-and-drive-adapter.md)、[ADR-038](038-portable-local-and-cloud-backup-flows.md)
- [SQLite user_version](https://www.sqlite.org/pragma.html#pragma_user_version)：由應用程式管理，不自動執行 migration。
- [SQLite 結構變更](https://www.sqlite.org/lang_altertable.html#otheralter)：交易、驗證及提交的順序。

---

*Decision made: 2026-10-17*
*Decision makers: 專案維護者*
