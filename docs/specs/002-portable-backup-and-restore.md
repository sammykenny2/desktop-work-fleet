# SPEC-002: 1.0 可攜備份與安全還原

## Metadata

| Field | Value |
|---|---|
| Status | Accepted 技術契約；實作及驗收狀態只記 PROGRESS |
| Owner | 專案維護者 |
| 日期 | 2026-10-04 |
| 範圍依據 | SPEC-003 Q01–Q07：完整內容、群組／版面、自動／加密備份、三種還原、五平台 |

## Summary

備份是使用者持有的檔案，不依賴原 Google 帳號、Drive file ID 或雲端仍有原檔。
共用核心保存一次已提交的本機快照，含全部已知版本、草稿、群組、每機版面及附件。
還原前驗證整份檔案、預覽目標分區與影響，確認後原子提交；不把備份當可執行內容。
[ADR-013](../decisions/013-complete-portable-backup.md) 取代 ADR-005 的候選設計。
手動、自動、加密及三種還原都屬 1.0；容器模組完成不代表全部功能已完成。

## Goals

- 換裝置、重裝或換帳號仍能取回完整已知資料，保留未完成工作與未保存草稿。
- Markdown/checklist、附件、完成／封存／刪除狀態及未知 JSON value 擴充無損往返。
- 提供新增式匯入、按身分合併及取代可見狀態；所有模式保留歷史及並行版本。
- 區分已產生 bytes、OS 已保存、本機已還原與遠端已同步。

## Non-Goals

不備份 OAuth／OS 憑證，不增加 Drive 權限；不承諾收到其他裝置尚未上傳的內容。
0.1.0 SQLite 備份不是此格式。不執行封存中的 URL、HTML、script 或外部路徑。
不承諾跨裝置的主動重複匯入只產生一份，或 Drive 多檔案原子交易。

## Requirements

| ID | 需求 |
|---|---|
| B01 | 設定的「資料與備份」提供匯出、驗證／預覽、還原及自動備份；桌面不加常駐工具列 |
| B02 | 匯出單一 ZIP；可選完整 payload 加密，使用 OS 儲存／分享介面 |
| B03 | 顯示快照時間、最後成功同步時間（未知就是未知）、待同步／草稿／衝突／pending 數量 |
| B04 | 匯出始終綁定捕獲的 profile，不能在切換後改用另一分區附件 |
| B05 | 完整驗證之前不寫目標；預覽顯示目標帳號／本機分區、模式及所有受影響數量 |
| B06 | 三種模式都有明確確認；取代另需已保存的還原前安全備份 |
| B07 | 工作、備份指紋、ID 對照、內容／附件／草稿／版面及新 outbox 同一本機原子交易 |
| B08 | 重啟／重試同一工作不重複新增；完成後再匯入一份必須明確建立新工作 |
| B09 | 損壞、錯密碼、不支援、容量超限、取消或保存失敗不得留下半套成功 |
| B10 | 不丟失未知 value／衝突／草稿，不自動挑選並行版本勝者 |
| B11 | 自動備份有位置授權、保留份數、上次成功／失敗與補跑；只管理自己建立的檔案 |

## Design Overview

### 一致快照及資料邊界

匯出前 UI 必須 flush 所有 editor 草稿並等候提交；失敗保留輸入並中止。
可先同步，失敗仍能明確選擇備份本機已知資料。Workspace.state 一次複製取得一致快照，
之後只從這個 profile 讀取不可變 SHA-256 附件並驗證 bytes。後續編輯留待下一份備份。

| 內容 | 保存方式 |
|---|---|
| 卡片／群組 | 全部 immutable revisions，包括完整 ancestors、並行 heads、retired redirects 及全部狀態 |
| 尚缺 parent | 原樣保留 pending 記錄及缺失 ID，不杜撰 parent；manifest 計數並明示已知本機範圍 |
| 草稿 | 全部 draft、未提交卡片、recoveredFrom 基線及其附件；還原後仍是本機草稿 |
| 本機閱讀偏好 | 當前完整 head 選擇及 entity 順序、純 membership rebase 證明、未完成轉組意圖 |
| 每機版面 | deviceId、grid／區域、placement／尺寸／order、顯示／層級／選字、快捷鍵、myGroup、undo |
| 附件 | 所有歷史、草稿及其基線引用的 bytes；缺檔、尺寸不符或 hash 錯即拒絕完整匯出 |
| 排除 | profile／帳號、token、client secret、Drive file ID、source/session、cursor、upload URL、outbox 封包及 restore receipt |

未知 content format 及 value/draft/layout 的 JSON 擴充可保存；固定 envelope、manifest、local
欄位不可任意增添。未支援的非投影 conflict 不可默默省略。備份不清空 outbox 或草稿。
scope 固定 known-local-data；未收到的遠端資料不可能包含。pending 不等於備份損壞。
草稿 lineage 以嚴格解析後的 canonical JSON 值比對，不依賴序列化 key 順序。

### 公開容器 v1

建議檔名 `work-fleet-backup-YYYY-MM-DD-HHMMSS-<short-id>.zip`。
明文 ZIP 使用 store（0）或 deflate（8）；UTF-8 JSON、ASCII 固定路徑，序號與實際資料 ID 無關：

```text
manifest.json
local.json
layout.json
revisions/00000000.json
drafts/00000000.json
attachments/<64 lowercase SHA-256 hex>.bin
```

不存在的項目不建立空目錄 entry。Ordinal 不要求連續，不得重複路徑或 revision ID。
reader 不解壓到檔案系統；只接受單卷、非 ZIP64、普通檔案。拒絕連結、目錄、路徑穿越、
其他加密 ZIP、SFX 前綴、尾隨垃圾、local/central 差異及重疊／不連續範圍。
data descriptor 可帶或不帶 signature，CRC 等於 signature 仍以邊界辨識。
僅接受時間戳／NTFS 時間／UID/GID extra fields。先驗證目錄及上限，
再以原生 DecompressionStream('deflate-raw') 串流解壓，按實際 bytes、CRC、完整結尾及 SHA-256 核對。
缺能力的 runtime 明確拒絕，不回退寬鬆 parser。

manifest 僅以下欄位，未知 schema 拒絕：

| 欄位 | v1 定義 |
|---|---|
| format / schemaVersion | work-fleet-backup / 1 |
| backupId | SPEC-004 的 valid ID，建立一次備份時產生 |
| createdAt | 真實 UTC ISO 日期，固定毫秒 YYYY-MM-DDTHH:mm:ss.sssZ |
| appVersion | 1–64 UTF-16 code units 的版本說明 |
| scope | known-local-data |
| pendingOperations | 非負安全整數，捕獲時 outbox 數量；不攜帶封包 |
| lastSuccessfulSyncAt | 同 createdAt 日期格式或 null；沒有紀錄不能冒充剛同步 |
| counts | cards、groups、revisions、drafts、attachments、conflicts、pendingRevisions，均非負安全整數 |
| files | 除 manifest 自身每個 entry 且僅一次：{name,size,sha256}；size 是解壓後 bytes |

cards/groups 包含刪除及退役；pending-only entity 無完整 head，不算可投影卡片，
但記錄包含在 revisions/pendingRevisions。conflicts 由 graph、group refs、overflow 和轉組意圖重建。
fingerprint 為 canonical manifest 的 SHA-256；所有 payload hashes 都在 manifest 內。
SHA 偵測完整性，不證明作者可信；驗證通過的使用者內容仍視為外部資料。

local.json 固定 cards、groups、membershipRebases、transferIntents。
cards/groups 是 {id,revision} 陣列，覆蓋全部可投影 entity 並選有效完整 head。
membershipRebases 是 old revision → {cardId,revision}；須為同卡片直接 parent 邊，
去除 groupId/revision 後其餘 value 相同。transfer intent 固定 kind/cardId/groupId/expectedRevision。
layout.json 保存 schema 1 LayoutStore；card/group/undo 引用需合法。
group cycle、retired target 及 >9 群組仍保留並明示待修復，不為備份刪資料。
revisions 採 [SPEC-004](004-revision-graph-and-file-sync.md)；draft 保存 Workspace 格式，
含可空 baseRevision 與線性 recoveredFrom，baseline 不得再嵌 recoveredFrom。
已知 draft base 須為同卡片版本；未知 base 保留為未完成意圖。

可執行 validator 是 src/backup/payload.js、archive.js 及 src/sources/revisions.js。
欄位形狀以外必須核對 graph、引用、hash 及計數，不能只通過 JSON 解析就匯入。

### 加密 envelope v1

外層 ZIP 只有 encryption.json 與 payload.bin；payload 為整個明文 ZIP 的 AES-256-GCM
ciphertext 及 128-bit tag，內部檔名／manifest／內容均加密。一般解壓工具只能取出外層兩個 entry；
此格式不是傳統 ZIP 密碼或 WinZip AES。

header 僅 format=work-fleet-encrypted-backup、schemaVersion=1、cipher=AES-256-GCM、
kdf=PBKDF2-HMAC-SHA256、iterations=600000、16-byte salt、12-byte nonce（小寫 hex）、tagBits=128。
每次 salt/nonce 隨機產生，canonical header 作 additional authenticated data。
密碼 UTF-8、不做 Unicode normalization；匯出至少 12 Unicode code points、最多 1024 UTF-16 units。
不能恢復密碼，不寫入 manifest、設定 JSON、log 或 .env。
KDF 值固定白名單；tag 成功後才解析內層，不接受嵌套加密。
清除能控制的暫時 byte buffers，不承諾 JavaScript 字串／GC 記憶體可確定清除。

### 容量及取消

| 邊界 | v1 上限 |
|---|---|
| ZIP entries（包括 manifest） | 20,000 |
| 明文解壓總量 | 128 MiB |
| 明文 ZIP | 136 MiB |
| 加密 ZIP | 136 MiB + 4096 bytes |
| 單一 JSON | 8 MiB，深度 64／200,000 nodes，依 SPEC-004 strict JSON |
| 單一附件 | 25 MiB |
| 加密 header | 4096 bytes |

匯出／匯入同上限，不截斷內容。大型 stored entry 以 64 KiB 複製／CRC 並讓出事件迴圈，
解壓串流核對實際輸出；取消後不回傳成功或寫目標。原生 KDF/AEAD 開始後須等完成再拒絕。
這是工程限制，最低五平台裝置壓測須另列證據；記憶體不足明確失敗，不省略資料。

### 匯出及三種還原

ZIP 產生後用相同 reader 重開檢驗，再交 OS 儲存。host 確認完整保存才顯示成功；
瀏覽器下載只能回報已交給瀏覽器，不能宣稱磁碟完成。取消／失敗不發布成功檔名。
還原先在記憶體／隔離暫存區完整驗證，顯示數量、pending／衝突、目標與模式：

| 模式 | 身分／內容 | 本機版面 |
|---|---|---|
| 匯入為新資料 | 映射全部 entity、revision、draft 及尚缺引用 ID；保留圖／分支，附件按 hash 去重 | 既有卡不移；新卡可選備份 geometry，否則給初始位置 |
| 合併 | 同 immutable ID／內容去重；同 ID 異內容整批拒絕；保留新分支／歷史，不以時間選勝者 | 預設保留目前版面，明確選擇才套用備份配置 |
| 取代可見狀態 | 先保存安全備份；以追加版本恢復備份 heads，額外卡片進刪除區；不刪歷史或 Drive 檔 | 明確套用備份版面，使用目標 deviceId；不可達位置只救回標題 |

取代新版本包含預覽觀測的全部相關 heads 作 parents；備份多分支仍維持多分支。
額外群組退休與草稿去向納入預覽；原草稿及還原草稿都保留，不自動發布。
無活動群組、循環或超過九組不能丟資料解決，需明示恢復／合併方法。
暫時 scope/focus/拖曳不還原；geometry 不作共享內容送其他裝置。

計畫綁 profile、workspace revision、fingerprint、restoreJobId；提交前資料變更需重做預覽。
附件、映射、新 revision/outbox、草稿、layout、receipt 同一本機原子交易。
傳輸重用持久 operation/file ID，回應遺失不重複新增；未觀測的新遠端分支仍能形成衝突。
取消未提交計畫是零寫入；提交後取消只停傳輸，不以刪除補償已發布資料。

### 自動備份

預設關閉；啟用時選 OS 授權位置、加密及保留份數（預設 7，1–90）。
有資料變化且距成功備份滿 24 小時才執行；合併重複觸發，失敗退避。
App 啟動／resume 逾期補跑一次，不宣稱 App 關閉或手機暫停時一定準時。
加密排程需 OS 安全儲存的密碼或 key handle；能力／授權不可用時暫停，不回退明文。
新檔寫入並驗證成功後才依 durable inventory 修剪此排程自身的舊檔；
不能按檔名掃目錄刪其他備份、跨 profile 或跨授權位置，失敗保留既有成功檔。

## Acceptance Cases

| ID | 情境與預期 |
|---|---|
| T01 | 中文／emoji／Markdown／checklist／未知格式／附件 bytes 及全部狀態完整往返 |
| T02 | 全歷史、edit/edit、delete/edit、缺 parent 與群組循環保留，不杜撰或選勝者 |
| T03 | 草稿、多代 lineage、附件及 membership 基線保留，還原不自動提交 |
| T04 | 跨分區／裝置及原 Drive 消失仍可讀取；不攜帶憑證與 provider 資訊 |
| T05 | 新匯入完整映射；合併核對同 ID；取代保留新舊歷史及草稿 |
| T06 | transaction abort／quota／response-loss／重啟不造成半套或重複還原 |
| T07 | 本機／同步修改後拒絕過期預覽；未觀測遠端修改仍可形成新衝突 |
| T08 | 離線／缺 parent／首次同步未完成明示已知本機範圍 |
| T09 | 路徑／ZIP bomb／壞 DEFLATE／重複 key／hash／引用／版本錯均零目標寫入 |
| T10 | 取消、切帳號、撤權及磁碟滿保留原資料，不誤報成功 |
| T11 | 同工作續行或顯示已完成；只有明確再匯入才新增第二份 |
| T12 | 不需 Google；標準 ZIP 工具讀明文，加密與獨立 crypto 互通 |
| T13 | salt/nonce 獨立；錯密碼／tag／header 拒絕，內部 metadata 加密 |
| T14 | 跨螢幕只救不可達位置，不搬未選擇套用版面的既有卡 |
| T15 | 自動補跑、失敗不刪舊檔、只修剪自身 inventory、加密不回退明文 |

## Dependencies and References

- [PLAN-002](../plans/002-google-drive-notes-mvp.md)、[SPEC-003](003-desktop-cards-groups-and-formation.md)、[SPEC-004](004-revision-graph-and-file-sync.md)。
- [ADR-013](../decisions/013-complete-portable-backup.md)、[容器與加密研究](../resreach/2026-10-04-backup-container-and-encryption.md)。
- 一致 Workspace、完整附件、原子 persistence、原生檔案授權／安全儲存／生命週期。
- 原生環境、最低裝置容量及 OS 保存確認逐平台驗收；狀態見 [PROGRESS](../../PROGRESS.md)。
