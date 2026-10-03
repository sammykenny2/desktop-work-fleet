# ADR-004: Google Drive 檔案便箋的 1.0 MVP

## Status

Proposed，2026-10-03。
使用者已確定先做 Google 帳號／file based 的簡單便箋，第一版不架 local server；
Drive provider、資料空間與衝突格式是本提案的建議。
1.0 同時發佈的平台範圍尚待確認。

## Context

使用者希望一般人登入 Google 即可使用，先不引入完整專案管理。
仍需在現在設計異質資料來源及 renderer 的邊界。
Keep 的官方 API 是企業管理用途且缺少更新既有便箋內容的介面；
Drive 可儲存本 App 的資料檔案。

## Decision

提議：

- 第一個來源使用 Google Drive API，以使用者自己的帳號授權。
- 本次規劃基線為 appDataFolder + drive.appdata；使用者透過 App 匯出／匯入備份檔。
  若未來要求直接在 Drive 管理工作檔案，再評估獨立 drive.file 模式，不同時維護兩份真相。
- 1.0 提供基本便箋、桌面鎖定／解鎖、跨裝置同步、草稿與衝突保留。
- 用 NoteSource 區分資料來源；檔案來源由 FileNoteSource + FileStore adapter 實作。
  Renderer 只用 NoteViewModel／編輯命令，不直接使用 Google token 或 API。
- 一台機器的便箋視窗共用本機 store／同步協調；每機版面與共享本文分離。
- 檔案同步先比較不可變版本記錄與可證實的條件式寫入，禁止靜默最後寫入者覆蓋。
- Google 授權與內容同步都由 App 直接對 Google；不新增自家常駐 backend。
- 手動備份使用來源無關的 ZIP／JSON，首版還原採預覽後匯入為新便箋；
  草稿、衝突與中斷續傳見 [ADR-005](005-portable-backup-and-restore.md)。
- ADR-003 的 PM／自架 server 路線延後，保留全文與未來適用性。

詳細證據與待決問題見 [Drive MVP 可行性](../resreach/2026-10-03-google-drive-notes-mvp-feasibility.md)。

## Consequences

### Positive

使用者不用部署服務；產品功能可先收斂為便箋。
資料來源與呈現分界可供未來擴充，不必現在實作所有 provider。

### Negative

Drive 不提供本 App 的便箋 editor 或自動衝突 UX。
appDataFolder 不能讓使用者直接在 Drive UI 編輯，也不支持跨帳號分享。
登入、同步格式、OAuth 設定與商店配置仍需實作。

### Neutral

沒有新增 SDK 或變更產品 runtime。
既有平台目標保留；本提案沒有把未知平台範圍自動縮成 Mac-only 1.0。

## Alternatives Considered

- Keep 官方 API：不符合普通帳號雙向便箋編輯，排除於本 MVP。
- Keep 非官方抓取：不作穩定發佈基礎。
- 自架權威 server：留在 ADR-003 的後續路線。
- 全量可覆寫 notes.json：覆蓋與競爭範圍過大，不作同步保證。

## References

- [Drive MVP 研究](../resreach/2026-10-03-google-drive-notes-mvp-feasibility.md)
- [ADR-003（Deferred）](003-product-architecture-boundaries.md)
- [既有驗證報告](../validation/2026-10-03-validation-report.md)
