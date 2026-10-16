# SPEC-004: 不可變版本與檔案同步

## Metadata

| Field | Value |
|---|---|
| Status | Approved technical contract；依完整 1.0 實作及細節授權定案 |
| Owner | 專案維護者 |
| 日期 | 2026-10-04 |

## Summary

卡片與群組各自保存完整、不可變版本及父版本身分。不同裝置的離線修改形成分支；
只有明確涵蓋所有已見分支的新版本能解決衝突。資料保留、同步游標、outbox、
帳號隔離與實際 Google 驗收分別有明確邊界。執行狀態只記於 [PROGRESS](../../PROGRESS.md)。

## Goals

- Markdown／checklist、附件引用、群組退役與未知 JSON 擴充資料無損保留。
- 亂序、重複、斷線、回應遺失與 crash replay 不導致靜默覆寫。
- 版面、草稿與本機憑證不混入共享卡片；完整備份可引用相同版本圖。
- 以來源無關的規則供 Windows／macOS／Linux／iOS／Android 共用。

## Non-Goals

不由修改時間選贏家、不以缺少遠端檔案推論刪除、不在第一版自動剪除歷史版本。
這些限制不刪減 SPEC-003 已批准的 editor、平台或完整備份範圍。

## Requirements

### 版本格式

```json
{
  "format": "work-fleet-revision",
  "schemaVersion": 1,
  "kind": "card",
  "entityId": "card-id",
  "revisionId": "revision-id",
  "parents": ["previous-revision-id"],
  "value": {
    "id": "card-id",
    "revision": "revision-id",
    "groupId": "group-id",
    "content": {"format": "markdown", "text": "- [ ] 記下想法", "attachments": []},
    "deleted": false,
    "archived": false,
    "completed": false
  }
}
```

- envelope 只接受上述七個欄位；未知格式／schema 拒絕，不能略過後繼續推進游標。
- ID 為 1–128 碼 ASCII 英數開頭，後續英數、`.`、`_`、`:`、`-`；
  拒絕 `__proto__`、`prototype`、`constructor`。一般建立使用隨機 UUID；
  初始群組與其根版本使用 [ADR-053](../decisions/053-account-scoped-initial-group.md) 的帳號／重設批次共用身分。
- 全圖 revision ID 唯一；value.id／revision 必須與 envelope 相同。
  kind 為 card 或 group；已知 parent 必須指向同 kind／entity。
- parents 是無重複 ID 集合，正規編碼時排序。零 parent 代表根版本；最多 1,024 個 parent。
  同 entity 多個根也形成衝突，不能合併成單一值。
- card 必須包含 groupId、content、deleted／archived／completed 布林值。
- card 可帶 `createdAt`：建立時的裝置時間，UTC ISO 8601 毫秒格式（`2026-10-06T12:00:00.000Z`）。之後的版本沿用不改，只決定閱讀順序。
  content 必須包含非空 format 與 text 字串；未知格式與 JSON 擴充欄位原樣保留。
- 附件是引用而非內嵌 bytes；id、name 必填，mediaType／size 可選。
  size 若提供為非負整數且 ≤25 MiB；正式附件傳輸以 SHA-256 校驗 bytes。
- group 包含 name、deleted；退役 group 必須有不同於自己的 redirectGroupId。
  redirect 的跨群組循環由投影／衝突層處理，不混入 revision ancestry。

### JSON 與容量

單一 JSON／版本記錄最多 8 MiB UTF-8，巢狀深度最多 64，值節點最多 200,000。
拒絕重複欄位（包括跳脫後同名）、不合法 UTF-8／Unicode surrogate、BOM、非有限數值及不安全整數。
所有 object key 必須非空，並拒絕上面的三個危險名稱；不接收 prototype／getter／Map／Date／
BigInt／undefined／稀疏 array 等非 JSON 資料，不靠 JSON.stringify 默默省略。

正規形式：object key 按 UTF-16 code unit 排序，array 保留順序，string 及有限數值採
ECMAScript JSON 編码（-0 正規為 0）。這是本協定的格式，不宣称 RFC 8785 完整實作。
正文與 attachment metadata 的未知欄位列入正規 bytes，因此不能忽略擴充欄位來判定同版本重試。

### 版本圖與衝突

- 每一批先完整驗證，再發布新圖；任何 collision／cycle／parent 身分錯誤使整批失敗。
- 相同 ID、相同正規 bytes 是重播；相同 ID、不同 bytes 是完整性錯誤。
- 缺 parent 的版本及所有後代屬 pending，保留完整資料及待補 parent ID。
  pending 版本不移除先前完整的 head；不能創造不存在的根或填補父版本。
- 只有所有祖先都存在的版本參與 head 計算；head 是没有完整後繼版本的已知版本。
  使用迭代拓撲走訪，長歷史不依賴遞迴 call stack。
- 多 head 顯示衝突且保留所有內容，包括 delete/edit 與群組 rename/merge。
  明確決議的 parents 包含當時全部已見 head；晚到的未知分支重新出現為衝突。
- 投影可保留目前檢視的分支，但不可冒稱它已勝出；草稿不被同步覆寫。
  group redirect 缺依賴／循環，以及超過九個 active group，均保留資料並提供整理入口。

### 本機與 FileStore 交易

Workspace 保存 append-only revisions；舊本機預覽從完整 outbox 遷入同一圖，缺歷史則拒絕杜撰根版本。
普通內容命令在同一提交追加 revision／outbox；圖的候選 fork 驗證成功及 persistence complete 後才發布。
beginSync 綁定 profile／source／session，runtime nonce 不落盤；重啟重新開 session，保留 cursor。
receiveRevisions 同時核對 session 及 expectedCursor，原子保存版本、投影、群組版面參照與新 cursor。
不同 source 不能重用同一 profile；舊 session、錯 profile 或過期 cursor 均零寫入。

投影保留目前仍是 head 的分支供閱讀；否則优先顯示未刪除分支，再以 ID 穩定選取。
多 head 仍明示衝突且禁止普通命令覆寫。群組既有本機顯示順序保留，新群組追加。
卡片在每台裝置都依 `createdAt` 由舊到新排列，相同時依 ID；沒有或格式不符的舊卡片排在最前、依 ID。
因此第一次同步一次收到全部卡片的裝置，與建立它們的裝置順序相同（2026-10-06 使用者決定：建立時間，舊的在上）。
卡片投影可依完整 group redirect 鏈顯示在接收組，原 revision.value.groupId 不變。
每機「屬於我」與快捷鍵跟隨有效 redirect；區域簿記可調整，既有卡片的 geometry／顯示政策不變。
超過九組整理回九組時同交易恢復有效格局。循環或缺依賴時草稿仍能保存，不能因 rebase 失敗丟失输入。

### 比較、決議與歷史恢復

「版本與衝突」提供待處理、歷史、附件下載、群組恢復／另選卡片群組、未完成轉組重試／取消。
採用版本與歷史恢復都核對預覽時全部 head；過期決定拒絕，不能消耗未看過的新分支。
恢復歷史建立新 revision，以全部目前 head 為 parent，保留後來的內容與草稿。
歷史是沿因果從目前往較早版本的走訪，不把 UUID 或裝置時鐘冒充修改日期。
轉組重試把 membership、revision、outbox、layout undo 與原意圖消耗一起提交。
保存失敗不出現半套成功，也不因重試另外增加一份意圖。

### FileStore 協調者整合

內容新版本與 outbox 在同一 transaction；開始傳送後 operation ID 與 bytes 不變。
版本資料、pending、衝突與遠端游標在同一 transaction 保存，transaction complete 前不發布成功。
每個帳號只有一個協調者；登出／切換來源取消舊工作並拒絕晚到結果寫入另一 profile。

初次全掃描先取得 changes 起點，再列完所有 file pages，最後補掃該起點之後的 changes。
重複回傳可重播；最後頁成功保存才更新完成游標。cursor 失效時完整重掃，不清空本機版本。
檔案不可讀／被清除／格式過新停止相應有損同步，保留本機內容；只有版本內 tombstone 表示刪除。

Drive appDataFolder adapter 使用 drive.appdata，upload 使用預產生且已持久化的 file ID。
成功回應遺失後重試相同 ID；409 必須取回 bytes 核對，不直接當成功。
附件先完成可校驗傳輸才上傳引用它的新版本；下載缺附件時保留文字及明確待補狀態。
配額與暫時網路錯誤退避可重試，撤權需重新登入，不能以新 operation ID 無限重送。

具體傳輸採 [ADR-012](../decisions/012-durable-file-store-and-drive-adapter.md)：FileDescriptor 包含
id／kind／sha256／size；provider file ID 為 1–256 個 ASCII 英數、`_`、`-`，拒絕危險 object key。
Workspace.sync.files 記錄已確認 descriptor（含 `kind: reset` 的重設標記），sync.uploads 按 revision ID／附件 hash 保存 reservation。
首次預設群組只在完整 pull 成功且完全沒有群組／版本歷史時建立；同 source 與相同 reset ID 集合必須產生相同 entity、revision 及根 bytes。
新 reset ID 通知既有裝置停止同步；已知 marker 重播不重複通知，也不當附件保存。
`sync.sourceResetIds` 在完成來源讀取的 cursor 交易建立；空陣列代表 reset 前初始世代，cursor 過期不清除它。
增量與全掃描均先擋住已建立世代以外的新 marker，不能等已知檔案消失或 upload reservation 存在才停止。
新 V1 來源檔案在上述七欄 revision 的傳輸 JSON 加上 `sourceResetIds`（排序且不重複的 marker file IDs）；
接收端先取出此傳輸欄位，再嚴格驗證原七欄 revision。核心圖、便箋與可攜備份不含該欄，原 revision bytes／ID 不變。
全掃描延後接收帶世代的傳輸直到所有頁的 marker 已知；只有同世代的傳輸進圖，其他世代 descriptor 留帳冊且不刪雲端檔案。
明確備份還原以目前來源世代重新傳送原 revision，因此同帳號全量覆蓋與 merge／replace 保留歷史身分且不會失去群組。
既有沒有此欄的 V1 檔案仍完整接收，既有 reservation 保留原 bytes／file ID。需要各裝置更新，舊版接收未知欄位會暫停並保留資料。
相同檔案 ID 的 kind／digest／size 不可變，不能在之後的分頁或 upload ack 改寫。
每頁最多 1,000 descriptors；Drive adapter 實際請求 100，服務回應 JSON 上限 2 MiB。

全掃描的資料逐頁提交但 cursor 保持 null；全部完成後才提交掃描前起點，再追 changes。
本機 ack 失敗仍保留 reservation／outbox；重啟經讀回核對才清除，完整 revision 歷史始終保留。
已驗證附件可先落盤而 metadata 提交失敗；這只留下未引用 bytes，不構成已成功同步。
一個 coordinator 的並行 sync 呼叫合併成同一工作；stop abort 及 session 核對拒絕晚到回覆。
退避為 1–60 秒指數上限加 jitter，並尊重服務 Retry-After；force 只略過等待，不略過完整性驗證。

Drive 非空檔以 1 MiB chunks 傳送，檢查 Range 而不猜已收長度。所有 resumable 4xx 重開 session，
仍沿用原 file ID。Google server checksum 缺少時讀回 bytes；私密上傳 URL 只放 adapter 記憶體。
程序重啟可能重送附件前段，不能宣稱跨程序保留 byte offset。
原生 HTTP 需在串流中限制回應大小、拒絕 redirect，renderer 不可取得 token 或任意 HTTP bridge。
登入既有帳號建立空 profile 後先拉來源，不能每裝置自行增加 starter group。

## Design Overview

`src/sources/json.js` 提供嚴格解析／正規編碼，`revisions.js` 提供版本驗證與純版本圖。
Workspace 再負責原子保存、投影、草稿及明確決議；FileStore 協調者負責分頁／游標／重試。
`src/sources/file-sync.js` 實作協調，`google-drive.js` 實作 REST 格式及 resumable，
原生 account-bound AuthorizedDriveRequest 與 OAuth 授權仍由 host 整合。
Renderer 不取得 Google token；原生 host 的授權／憑證儲存與公開設定分離。
`.env.example` 與 `npm run config:check` 提供公開設定入口；帳號與正式簽章由維護者建立。

## Acceptance Cases

| ID | 要求 |
|---|---|
| S01 | 中文、emoji、checklist、附件及未知 JSON 欄位正規編碼往返 |
| S02 | 重複／跳脫同名欄位、非法 UTF-8、數值及容量拒絕，不截斷 |
| S03 | 兩裝置離線分支亂序／重播後得到相同 head 集合 |
| S04 | delete/edit 保留兩者；明確決議後晚到第三分支仍顯示衝突 |
| S05 | 未知 parent 及後代 pending；補齊前不吃掉完整舊 head |
| S06 | 相同版本不同 bytes、跨 entity parent、cycle 整批拒絕 |
| S07 | 12,000 次修改反向輸入無遞迴溢位；呼叫者不能改寫 graph 內部 |
| S08 | Workspace 保存故障保留舊投影、草稿、outbox 和 cursor |
| S09 | 群組跨裝置 rename／retire／循環與第十組都有可達恢復入口 |
| S10 | 回應遺失、409 驗證、全掃描／changes 分頁／crash replay 不重複或漏項 |
| S11 | 舊 session 晚到回覆、撤權、換帳號不串資料／憑證 |
| S12 | 真 Google、五平台 client IDs 及各自憑證環境的整合驗收 |

## Dependencies

[SPEC-003](003-desktop-cards-groups-and-formation.md)、[ADR-008](../decisions/008-portable-interaction-core.md)、
[ADR-011](../decisions/011-immutable-revision-graph.md)、[PLAN-002](../plans/002-google-drive-notes-mvp.md)。
嚴格格式／版本圖不新增 runtime 套件或服務。

## Open Questions

公開 Google project／client IDs、正式簽章及平台環境尚未建立；使用者已要求以 `.env.example` 設定。
這是外部整合依賴，不重開已批准的五平台與完整 1.0 範圍。

## References

- [Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)
- [預產生 file ID](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds)
- [上傳與重試](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [changes 分頁與游標](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list)

建立：2026-10-04。驗收是要求，不代表全部已通過；結果見 PROGRESS。
