# ADR-054: 明確的工作空間初始化與可續行重設

## Status

Accepted，2026-10-17。使用者核准實作。取代 ADR-053 的「只由空版本圖判斷是否初始化」流程；保留其帳號／世代身分與傳輸隔離。

## Context

同一 Google 帳號的六台裝置不能各自建立不同預設群組。僅用固定根版本雖可收斂，仍無法明確區分新帳號、
重設尚未清完、刻意空白或備份覆蓋尚未傳完。名稱不能代表初始化身分；使用者手動建立的「我的便箋」必須保留。
Drive 檔名不是唯一鍵；預產生 ID 解決相同已知 ID 的重試，不能替六台各自配置的 ID 提供跨裝置鎖。

## Decision

- 沿用 V1，新增 `kind: workspace` 不可變控制檔，容量上限 8 MiB；各原生 host 使用同一 allowlist。
  `workspaceId` 為帳號來源身分的 SHA-256，`sourceResetIds` 綁定目前世代。
- `prepare` 描述 mode、origin、排序且唯一的 revision ID／portable bytes SHA-256 與附件 hash。
  `ready` 引用整份正規 prepare bytes 的 SHA-256（planId）。重複相同 plan／receipt 是重播；不同 planId 同世代停止，保留資料。
- 全新帳號：完成列舉與補 changes 才提出確定性的 `starter` 計畫；任一裝置可完成同一計畫。
  同時計畫、根與 receipt 可能各有數份實體 Drive 檔，但只有一個邏輯初始化；沒有任意挑第一份、租約或永久 leader。
  已選定 starter 後使用者另建群組不取消所需根版本；一般 createGroup 仍使用獨立 UUID。
- 既有來源：完整讀取發現任何 revision（含 pending／退役群組），以 `existing` 計畫宣告已初始化。
  該宣告不列 revision／附件需求，避免不同完整掃描窗口替同一既有來源產生不同 manifest；既有同步完整性規則仍適用。
  explicit ready 的空工作空間保持空白，不因沒有群組再次補預設組。
- 重設發起端先持久保存 account-bound journal、配置的 marker ID、原世代 marker 集合與完整計畫，再發布帶
  `initialization: workspace-init-v1` 的 marker。完整列舉並清除後，先保存 `initialize` 階段，再寫 prepare、根與 ready。
  其他裝置看見 pending marker 只等待，不建立預設組、不上傳 outbox、不宣告同步成功。
- 備份覆蓋使用 `restore` 計畫，列出整份備份的 revisions（包括 pending 歷史）及所有歷史附件。
  發起端傳完並驗證需求才發布 ready；不以 missing parents 清單為空當完成條件，因為備份可合法保存待補歷史。
- 接收端先完整列舉 descriptors，再讀全部 reset、workspace 控制檔，才讀資料；避免 marker 出現在最後頁時先發布舊內容。
  ready 前資料存入 `sync.initialization.incoming`，不投影到群組、便箋或版面。
  收到 receipt 仍須核對實際 bytes、required revision digest 與已驗證附件，再把 activePlan、圖與版面原子提交。
  receipt 到來時重新列舉，補回先前等待期間略過的資料。等待狀態不更新最後成功同步時間。
  補掃需求與 receipt／cursor 同交易保存，完成整輪掃描並保存 staged 資料才清除，重開不會永久等待。
- fresh follower 在 marker-only cleanup 期間可隨正常移除收斂舊控制檔與世代；這個寬限只適用沒有本輪 plan／receipt、
  沒有 activePlan、沒有 restore 工作的接收端。已收到本輪 plan 後恢復嚴格缺檔檢查，避免用 staged bytes 掩蓋遠端刪除。
  restore 發起端另核對 journal 的世代與 owner planId，不能把舊備份 outbox 標成後一輪世代。
- reset journal 在每個階段及上傳 ID 配置後先保存；回應遺失重用同 ID，409 必須讀回校驗。
  進入 initialize／upload 後續行不再清空。列舉 incomplete、來源身分錯誤、計畫無效時停止，不能發布 ready。
  發現後來的 reset marker 或已發布的自身 marker 消失時，舊 job 永久停止清除。
  UI 提供先匯出備份及清除本機副本、重取目前雲端的入口；不重跑失效的雲端重設。
  儲存成功回應遺失時重開 durable journal，不啟動舊記憶體 writer。

## Consequences

### Positive

重設由發起端初始化，其餘裝置下載；新帳號仍能在某裝置中斷後完成初始化。同名手動群組不被吞掉，空白工作空間不被誤判。
重設、還原與接收啟用都有明確完成依據，斷線不會把半份工作空間當成成功。

### Negative

多幾份小控制檔與 journal；收到 ready 時可能多一次全掃描。發起端重設中斷時，其餘裝置等待它續行，沒有自動接管破壞性清除。
這是 client 協定，無法強制舊版 App 遵守；所有同步裝置應更新。既有 unscoped V1 傳輸仍無法回溯判定來源世代。
不同計畫衝突保留資料並停止，不自動猜測使用者意圖。沒有實作 Drive 無法提供的 compare-and-swap／全域分散式鎖。

### Neutral

不改 App 版號、不發布、不升 schema，不新增 backend、listener 或 runtime 套件；既有重複群組仍由使用者明確合併。

## Alternatives Considered

- **按名稱去重**：會吞掉使用者刻意建立的同名群組，拒絕。
- **第一份上傳獲勝或固定一台 leader**：前者不能表達不同意圖，後者會永久依賴某台在線；新帳號採可重播的同一計畫。
- **單一 initialized boolean**：無法證明資料／附件已傳完，也無法安全續行 reset，因此使用 prepare + ready + 驗證實際需求。
- **重設 followers 自動接手清除**：可能重複刪除後來資料，保留發起端 journal 作明確續行。

## References

- [SPEC-008](../specs/008-workspace-initialization.md)、[PLAN-008](../plans/008-workspace-initialization.md)
- [ADR-053](053-account-scoped-initial-group.md)、[ADR-012](012-durable-file-store-and-drive-adapter.md)
- [Drive files.name](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
- [預產生 ID 與重試](https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files)

決策日期：2026-10-17；執行結果見 [PROGRESS](../../PROGRESS.md)。
