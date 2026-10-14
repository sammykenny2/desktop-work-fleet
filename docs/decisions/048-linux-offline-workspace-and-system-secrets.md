# ADR-048: Linux 離線便箋與系統秘密分開保存

## Status

Accepted，2026-10-15。取代 ADR-047 的 Google 憑證與備份密碼政策；保留其本機便箋金鑰及舊工作空間遷移方式。
同日補充：使用者回報 0.2.4 按「立即同步」仍無法解除暫停，新增明確手動操作的系統互動解鎖，背景政策維持。

## Context

使用者要求啟動不能強制輸入 keyring 或使用者密碼，也指出 Linux 不應因此降低 Google 權杖與備份密碼的保護。
ADR-047 把工作空間主金鑰放入同目錄，解決啟動依賴，但連登入權杖與自動備份密碼也能被整個資料目錄的持有人解密。
需要將離線工作與可暫停的敏感操作分開。此次授權是修正程式，不包含升版、安裝或發布。

## Decision

- 便箋、草稿、歷史、附件、待同步內容與非秘密備份 metadata 繼續使用 0700 資料目錄及 0600 `storage-key` 的 AES-GCM。
  新資料及完成主金鑰遷移的資料直接開啟；OS 帳號／檔案權限仍是本機內容的保護邊界。
- Google access／refresh token、帳號登入資料及保存的自動備份密碼改由 Secret Service 的持久 default collection 保存。
  Google 憑證以帳號隔離；備份密碼的 vault ID 含 profile 與 key ID。SQLite `secret_refs` 只保存身分、啟用／撤銷與清理狀態。
  新秘密不保存於 SQLite、備份 ZIP、renderer 或本機金鑰檔，也不在 vault 故障時退回本機保存。
- libsecret lazy import 保留；本機便箋不需要它，Google、保存備份密碼與舊資料遷移需要可用的 Secret Service。
  只接受已存在且已解鎖的持久 default collection；拒絕 session collection，不建立 collection、不改金鑰圈密碼。
- 先透過 D-Bus 即時讀取 collection 的 Locked 屬性，只在已解鎖 collection 上搜尋 `ALL`，不使用全域 SearchItems 或 `UNLOCK`。
  canonical 讀取只搜尋持久 default；透過 GetSecret／libsecret session decode 取得新值，不使用 proxy 的舊鎖定／secret 快取。
  舊跨 collection 憑證只有 default 沒有憑證且可用時才遷入，不能覆寫已有 default 憑證。
  儲存使用 libsecret 協商的 session 編碼後直接呼叫 `CreateItem`，刪除直接呼叫 Item `Delete`；
  讀取／寫入／刪除遇到 prompt object 時回報暫停，不自動呼叫 `Prompt.Prompt`。避免便利 store／clear API 自動解鎖或顯示提示。
- Google 建構不讀 vault；頁面先開啟離線內容。`google.status` 回傳可暫停狀態而非讓工作空間開啟失敗。
  每次使用 token 前重新檢查 vault；後來鎖定也不能繼續使用快取 token。
  UI 顯示「同步暫停」並指向立即同步；定期與開機重試不要求解鎖。
  Linux 宣告 `vaultUnlock` capability；使用者按「立即同步」時才呼叫固定 `google.unlockVault`，
  確認為 vault-locked 後呼叫 D-Bus `Service.Unlock`／`Prompt.Prompt`，僅解鎖持久 default collection。
  系統負責密碼輸入，App 不接收密碼；解鎖後重讀原憑證並接續原帳號同步，不需要重新 OAuth。
  已解鎖時不重複 Prompt；服務缺失等其他問題不要求無關密碼。取消／90 秒逾時回到暫停並保留重試；
  deadline 自 host 收到請求起算，涵蓋排隊、前置查詢、Prompt 及憑證讀回，逾期請求不開啟延遲視窗。
  關閉或切換帳號取消待完成操作；UI 丟棄舊來源結果。Completed 等待有期限，Dismiss 不阻擋返回，
  不依賴 provider 在取消後仍發出 Completed。互動操作在 network worker，不持有筆記 DB 或 bridge lock 等待 Prompt。
  HTTP 401 的強制 refresh 狀態不被 vault 重讀覆蓋。
- 加密備份的 vault 故障回報 `backup-vault-unavailable`，既有排程暫停機制保留待辦及上次成功備份，不改存明文。
  Google 與涉及 vault 的備份操作使用 network worker，在等待 vault 時不持有 DB 或 storage bridge 的鎖。
  Secret Service owner 改變後重新建立綁定新 owner 的 proxy／session，允許後續重試恢復。
- ADR-047 的本機 credential／backup-key 只供升級遷移，鎖定時不能當執行期 fallback。
  頁面 ready 後背景嘗試遷移；使用相關秘密時也會重試。先完成 vault 寫入及讀回，再交易式移除本機副本並保存 reference。
  `secure_delete`、WAL checkpoint／truncate 與 VACUUM 清理目前 DB／WAL 的舊 ciphertext；清理失敗留下可重試標記。
  vault 不可用或未確認保存時保留舊副本，避免失去登入／備份密碼；此過渡期間仍有 ADR-047 的較弱保護。
- 登出先保存持久 revoked reference 並清理本機舊副本，vault 刪除為 best effort；解鎖、重啟或清空便箋後也不能重新匯入舊 token。
  保留 ADR-021 的只登出這台裝置政策，不向 Google 撤銷整個專案授權。
  清空工作空間只撤銷該 profile 的備份密碼 references，Google 憑證與其他 profile 保留。
- SQLite `user_version=2` 防止舊 schema 1 程式降版開啟後重新把秘密保存於本機；產品版本沒有在本次變更中調整。

## Consequences

### Positive

- 日常便箋與自動啟動不被系統 vault 密碼對話框阻擋；手動同步有直接解鎖及接續同步的出口。
- 完成遷移後，僅複製 App 資料目錄不能取得 Google 權杖或保存的備份密碼。
- 重複 collection、暫存 vault、服務重啟與遷移中斷有失敗保留／重試行為。

### Negative

- Linux 的本機便箋金鑰仍與資料同目錄；其離線機密性弱於另由 OS vault 保護主金鑰的方案。
- 自動登入可能讓金鑰圈持續鎖住，因此不能承諾同時做到零密碼輸入與無條件自動同步／加密備份。
  使用者可按「立即同步」透過系統視窗解鎖，或自行設定可自動解鎖的系統安全儲存。
- 清理目前 SQLite 檔案不等於儲存裝置、快照或舊備份的實體安全抹除；同帳號惡意程式、root 與記憶體讀取不在保護邊界。
- default alias 改配其他持久 collection 後，已記錄的秘密可能暫時找不到；還原原 default 或重新登入／設定備份密碼。

### Neutral

- Windows／macOS 的原生安全儲存實作維持。共用 UI 只在 host 明確回傳 paused 時呈現 vault 暫停。
- 舊工作空間主金鑰未遷移且原 vault 鎖定時，仍須一次性解鎖才能取得原資料，不建立替代金鑰。

## Alternatives Considered

### 全部保存本機，繼續 ADR-047

- 零 vault 依賴，但整個資料目錄可解出登入權杖與備份密碼；使用者已要求修正，故不採用。

### 全部恢復系統 vault

- 工作空間的主金鑰也依賴解鎖，重新引入只寫便箋也被阻擋的啟動行為，故不採用。

## References

- [ADR-047](047-linux-local-key-without-keyring-prompts.md)、[ADR-021](021-windows-google-account-and-sync.md)。
- [Secret Service 行為研究](../research/2026-10-15-linux-secret-service-without-prompts.md)。
- [安全邊界](../security-guidelines.md)、[測試](../testing.md)、[Linux README](../../src/native/linux/README.md)。

---

*Decision made: 2026-10-15*
