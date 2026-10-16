# ADR-012: 可恢復 FileStore 與 Drive appDataFolder adapter

## Status

Accepted，2026-10-04。依完整 1.0 與技術細節授權定案；接續 ADR-011，
採納並取代 ADR-004 尚待決的 provider／資料空間選擇。原生授權與五平台實測仍各自驗收。

## Context

來源可能已收到檔案，但成功回應未抵達；若重試另建 ID，會產生重複檔案。
全掃描期間也可能收到其他裝置的修改。圖、游標、待送操作和附件需能分別恢復，
不能把同步失敗當成內容刪除。Google 專案與平台 OAuth client IDs 尚未建立。

## Decision

- 首個 provider 採 Google Drive appDataFolder，唯一 Drive scope 為 drive.appdata；
  不增加使用者 Drive 可見資料夾、分享或自家便箋 server。五平台公開 ID 由 `.env.example` 設定。
- FileSync 與 FileStore 分離。前者持有 Workspace session、outbox、掃描及重試政策；
  後者綁定已驗證帳號，只允許建立不可變檔案、列舉與讀取。介面見 `contracts/sync.d.ts`。
- Google 預產生 file ID，先同本機操作保存 reservation 才上傳。重試固定 ID、kind、SHA-256、size。
  成功後再同交易記錄已確認檔案並移除對應 outbox；歷史不刪除。
  409 必須讀回並核對 bytes，不能單靠 HTTP status 承認成功。
- 全掃描先保存記憶體中的 changes 起點；逐頁資料可落盤，但完成 cursor 保持 null。
  列完並確認既有檔案未消失後，提交起點並補 changes。中斷重新全掃描，重播安全。
  增量每頁將資料／檔案帳冊／cursor 原子保存；已完成前頁不因後頁失敗回滾。
- 附件以 SHA-256 定址，先完成傳輸再送引用版本。下載校驗後以 octet-stream 保存 bytes；
  分區固定為 session.profileId。失敗交易可能留下未引用附件 bytes，不會提前更新版本或 cursor。
- 遠端移除、檔案內容或 metadata 改變、未知格式、校驗失敗、列舉不完整均保留本機資料並停下回報。
  不把檔案缺席當成 card tombstone，不自動清除歷史，也不自動修補來源資料。
- Drive 檔案使用 wfFormat／wfSchema／wfKind／wfSha256 私有 metadata，正文不放檔名。
  單筆 revision 上限 8 MiB，附件 25 MiB；Google server checksum 若缺少，成功上傳仍需讀回核對。
- 非空檔採 1 MiB resumable chunks，依服務端 Range 判定已收 bytes。暫時錯誤退避後查進度；
  任何 resumable 4xx 清除 session，下次沿相同 file ID 建新 session。空附件用 multipart。
  上傳 URL 只留在 account-bound adapter 記憶體，不進 Workspace、backup、renderer 或 log。
  程序重啟可從原 file ID 重送；尚未承諾跨程序保存 byte offset。
- 受保護 HTTP transport 固定 Google HTTPS host、拒絕 redirect、串流限制回應容量並支援 abort。
  Google adapter 不收 token；授權與 refresh／OS 安全儲存由原生服務負責。
  `AuthorizedDriveRequest` 是服務內介面，禁止將任意請求 bridge 公開給 WebView renderer。
- 新帳號分區先以 bootstrapGroup=false 接收來源，避免新裝置自行增加另一個「我的便箋」。
  空帳號的首次建立依 [ADR-053](053-account-scoped-initial-group.md)，由 FileSync 在完整 pull 後使用帳號／重設批次共用的群組與根版本身分；
  不移除使用者既有本機便箋。

## Consequences

### Positive

回應遺失、重啟、分頁中斷及離線分支皆可重播；來源不具有默默覆寫正文的路徑。
Google 傳輸細節不進版本圖，其他 FileStore 可使用同一組故障測試。

### Negative

不可變歷史及每個操作的 reservation 增加儲存與 API 次數；容量需量測，不能以单檔上限當總量保證。
resumable URI 未跨程序保存，因此程序重啟可能重送未完成附件的前段 bytes。
各平台 client ID 的同帳號可見性、正式 OAuth 與 native transport 還須真 Google 驗收。

### Neutral

不新增套件或 listener；本機 renderer 仍不連 Google。fixture 與真 IndexedDB 探針分開記錄。
Drive 檔案不等於完整備份，SPEC-003 核准的自動／加密／匯入／合併／取代備份範圍保留。

## Alternatives Considered

- 重試新 file ID：容易留下多份相同操作，拒絕。
- 409 一律成功：可能承認碰撞或不同內容，拒絕。
- 每次覆写共享大 JSON：擴大競爭範圍且破壞不可變分支，拒絕。
- 將 token／upload URL 寫入一般 Workspace：增加 renderer、backup 與 log 的機密暴露，拒絕。

## References

- [SPEC-004](../specs/004-revision-graph-and-file-sync.md)
- [Drive 傳輸研究](../research/2026-10-04-drive-file-transport.md)
- [ADR-004](004-google-drive-notes-mvp.md)、[ADR-011](011-immutable-revision-graph.md)

決策日期：2026-10-04；執行與實測結果只記在 [PROGRESS](../../PROGRESS.md)。
