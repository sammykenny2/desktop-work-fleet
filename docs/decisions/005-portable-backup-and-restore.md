# ADR-005: 來源無關的備份格式與新增式還原

## Status

Proposed，2026-10-03。使用者已要求規劃 drive.appdata 的檔案備份／還原；
以下為具體設計提案，尚未實作，未把規劃授權視為格式已核准。

## Context

appDataFolder 支援 App 讀取及建立檔案，但使用者無法在 Drive 網頁直接整理這些內容。
1.0 應提供使用者可持有的備份，同時保持未來來源與 renderer 的可替換性。
多裝置持續同步時，直接用舊備份覆寫現有檔案會與其他裝置的修改競爭。

## Decision

- 備份採標準 ZIP＋公開、帶版本的 JSON；BackupService 位於共用資料核心，
  不依賴 Drive token／檔案 ID／同步游標，也不由 renderer 自己序列化資料。
- 1.0 備份保存便箋、刪除區可恢復內容、所有衝突 heads 及本機草稿；
  不封存全部歷史、每機座標、憑證與原 outbox。
- 匯出使用一致本機快照，明示同步新鮮度；離線不冒充全雲端最新版本。
- 還原預設且首版只提供「匯入為新便箋」。新 ID、完整預覽、
  持久化 RestoreJob 與原子本機提交防止覆蓋和重試重複。
- 恢復草稿先留本機，使用者保存才提交；已保存便箋經正常同步流程送出。
- 本機交易成功與遠端全數同步分開回報；不承諾 Drive 多檔交易。
- 1.0 提供手動備份到 OS 選取位置，不增加 drive.file／全 Drive 權限。
- 整庫替換、完整歷史、加密與自動備份留待有獨立語意和復原方案時擴充。

## Consequences

### Positive

使用者能跨安裝／帳號攜帶資料；後續 provider 可共用格式。
還原不會抹掉另一裝置剛完成的工作，且資料核心可在無 Google 環境測試。

### Negative

匯入會產生新的便箋身份；不會回復舊連結、完整歷史或全帳號狀態。
不同裝置各自啟動匯入仍可能新增兩套便箋。
ZIP 明文需清楚標示，未同步／未下載的其他裝置內容不可能自動包含。

### Neutral

1.0 同版平台與實作框架仍待定。
ADR-004 保持 Proposed；ADR-003 的 PM／server 設計保持 Deferred。
0.1.0 的 SQLite backup/restore 與本提案是不同格式，沒有隱含相容承諾。

## Alternatives Considered

- 原樣備份 Drive 檔案：保留 transport 細節，但綁定 provider／版本關係，
  不適合作為來源無關的使用者備份。
- 直接複製本機 SQLite：暴露快取／憑證混入風險，依 runtime schema 綁定；
  可以作內部診斷技術，但不作本版使用者格式。
- 只匯出純文字：可閱讀，但丟失刪除、顏色、衝突及草稿關係。
- 整庫覆蓋還原：符合某些管理用途，但需定義其他裝置／outbox／版本世代處置；
  不適合這次最小版本。
- 在一般 Drive 資料夾自動另存 ZIP：可後續新增；本版先用 OS 儲存入口完成手動備份。

## References

- [SPEC-002](../specs/002-portable-backup-and-restore.md)
- [PLAN-002](../plans/002-google-drive-notes-mvp.md)
- [備份官方能力與設計](../resreach/2026-10-03-appdata-backup-and-restore-design.md)
- [ADR-004](004-google-drive-notes-mvp.md)
