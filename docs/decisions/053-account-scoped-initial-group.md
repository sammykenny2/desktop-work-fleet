# ADR-053: 多裝置共用的初始群組身分

## Status

Accepted，2026-10-17。修正六台桌面裝置在 Google 重設後各自建立「我的便箋」的競態；沿用 V1。

## Context

Google 分區原先不建立群組，等同步成功後由主畫面檢查是否為空，再以隨機 ID 建立「我的便箋」。
多台裝置同時讀到空來源時，各自建立不同 entity／root；同步會正確保留所有群組，造成預設群組重複。
重設雲端並在其餘裝置清除副本後，會再次遇到同一競態。

## Decision

- 初始群組由 FileSync 在完整 pull（含全掃描後補 changes）成功後、push 前建立；主畫面不再於同步後另建隨機群組。
  以 `bootstrapGroup: true` 啟用；備份覆蓋等其他同步用途維持不自動建立。
- 僅在本機沒有任何 revisions 或 groups 時初始化；pending 歷史、退役群組或既有同名群組都不算空來源。
- 初始身分取 `SHA-256(canonicalJson(['work-fleet-initial-group', sourceId, sortedResetFileIds]))`，使用完整十六進位 digest。
  group ID 為 `initial-group:<digest>`，根 revision ID 為 `initial-group-root:<digest>`；根內容固定為「我的便箋」、未刪除、無 parent。
  同帳號同重設批次的根 bytes 必須一致，不含裝置 ID、時鐘或隨機值。一般使用者建立／修改仍使用隨機 UUID。
- reset descriptor 與 cursor 同交易記入 `sync.files`，校驗 bytes，但不當成附件保存。
  完成首次來源讀取時，同交易保存 `sync.sourceResetIds`；空陣列也表示已建立初始世代，清除過期 cursor 不清除此世代。
  增量重播已知 reset ID 不再視為新重設；已建立世代的裝置在增量或全掃描看到未知 marker 時，先暫停再接收，
  即使尚未配置上傳 file ID，或 reset 尚未刪掉舊檔案，也不把舊 outbox 重新標成新世代。
  既有 V1 副本沒有此 optional 欄位時，由 cursor／已知檔案／reservation 等既有同步證據在讀取時推導；
  cursor 過期清除前保留該推導值，不增加 migration 寫入。無法確認世代的既有 marker 採暫停保留副本。
  新一輪重設使用新的 marker ID，因而建立不同初始群組；重啟保留原批次。
- 初始化核對有效 session、非空 cursor 與計算身分時的 reset 集合；版本及 outbox 先持久化才上傳。
  多台可能上傳內容相同的不同 Drive 檔案；版本圖以同 revision ID／bytes 重播，僅呈現一個群組，不假設有分散式鎖。
- 重設完成後仍可能抵達舊裝置已開始的上傳。新傳輸檔案在 V1 revision JSON 的傳輸層加上排序過的 `sourceResetIds`，
  代表建立這份傳輸檔案時已接收的 reset marker 集合；解碼時取出該欄，再以原七欄 envelope 驗證 portable revision。
  傳輸 bytes／digest 包含世代，核心版本圖與備份不保存這個傳輸欄位，revision ID 與正文不因此改寫。
- 帶世代的傳輸只在其 `sourceResetIds` 等於目前 marker 集合時進入版本圖；其他世代的 descriptor 仍留帳冊，不刪雲端檔案。
  舊裝置保留自己的群組／便箋／修改，收到新 marker 時停止同步；已有 reservation 但尚未完成任何檔案的裝置也必須停下。
  全掃描暫存帶世代的修訂，列完所有頁後才接收，避免 marker 在最後頁時先錯收舊內容；中斷保留 null cursor，重掃恢復。
- 明確備份還原沿用原 portable revision 身分與 bytes，再依目前來源世代產生新的傳輸檔案，因此同帳號全量覆蓋、merge／replace
  不會被誤認為舊在途上傳。既有沒有 `sourceResetIds` 的 V1 檔案仍完整接收；已保存的舊 reservation 沿用原 bytes／file ID 重試。
  不能只依根內容或群組名稱略過資料，因為同一根也可能是使用者明確還原的歷史。
- 全新／清除副本後的 Google 分區若尚無有效群組，新增便箋及接收分享需先完成來源讀取並建立初始群組，
  不能繞過協調者另建隨機預設群組。已有群組的 Google 離線編輯及本機工作空間不受影響；
  初始群組落盤後即使上傳失敗，也需選取該群組允許離線新增。
- 不按名稱自動刪除或合併既有重複群組；每組可能已有便箋，沿用明確的群組合併操作。

## Consequences

### Positive

六台同時初始化、重設後重連、重設中途晚到的自動根與程序重啟均收斂為同一初始群組；帳號與重設批次分離。
既有資料、離線分支及明確建立的同名群組仍完整保留。

### Negative

全新或剛清除的 Google 分區需完成首次來源讀取才能新增便箋；多台同時初始化可能保留多份相同根版本檔案。
新世代傳輸欄位需要接收端更新；舊版接收未知 envelope 欄位會暫停並保留資料，因此應更新所有同步裝置。
既有未帶世代的在途舊版傳輸無法回溯判定世代；不以猜測丟棄既有資料。
舊版 App 仍會隨機建立群組，需更新各裝置才能消除該初始化路徑。

### Neutral

不變更 App 版號、不發布、不升 schema、不增加 migration、server、listener 或套件。

## Alternatives Considered

- 再同步一次／延遲隨機時間：只能縮小競態窗口，不能保證同時裝置收斂。
- 按「我的便箋」名稱去重：名稱不代表實體身分，會誤合併使用者刻意建立的群組。
- 每個裝置使用相同 group ID、不同 revision ID：會產生多個根分支衝突，因此根版本與 bytes 也必須相同。
- 使用跨所有重設的固定 ID：舊裝置遲到的 rename／retire 會找到新根而作用於重設後的群組，因此加入來源身分與 marker 集合。
- 只略過舊批次的純自動根：與使用者明確備份還原無法區分，可能讓其他裝置的還原便箋失去群組，拒絕。

## References

- [ADR-012](012-durable-file-store-and-drive-adapter.md)
- [SPEC-004](../specs/004-revision-graph-and-file-sync.md)
- [Google 操作](../google-setup.md)

決策日期：2026-10-17；執行結果見 [PROGRESS](../../PROGRESS.md)。
