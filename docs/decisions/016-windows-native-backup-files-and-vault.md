# ADR-016: Windows 原生備份檔案與金鑰

## Status

Accepted，2026-10-04。實作 SPEC-002／ADR-014 的 Windows backend；其他四平台分別驗收。

## Context

自動備份需要在 App 重開後辨認自己建立的檔案；只保存路徑與 hash 無法防止同名替換。
自動排程需要持續加密，但 renderer 不應取回 OS vault 中的密碼。

## Decision

- Windows 以原生資料夾選擇器授權本機 NTFS 位置。首次開啟拒絕 filesystem reparse points，
  保存 Volume GUID 路徑、volume／128-bit file ID／建立時間；重開再次核對資料夾身分。
  目錄及檔案原生身分只在 C# 保存，不能經 JavaScript number 往返。
- 後續子檔用 Windows SDK `NtCreateFile` 的 `RootDirectory`，相對已持有的 directory handle 開啟。
  不重新解析可被改名的祖先路徑。建立使用 `FILE_CREATE`，不覆寫既有檔。
- 自動工作先有共用 journal pending；native 在新檔 handle 被鎖定時先持久保存檔案身分，再寫入。
  寫入後 `Flush(true)`，同 handle 核對完整 size／SHA。中斷留下的檔案不假裝已回滾；
  重啟可確認完整原檔，或保留未完成檔供檢查。
  若建立後 native 身分保存失敗，只檢查同名檔是否存在，列為 unconfirmed；不讀取或認領其內容。
- 清理需有相同 profile 的 verified journal 及 native 建立紀錄、相同排程／位置，不能清理最新檔。
  先核對最新備份仍完整，且持有其拒絕 write/delete 的 handle 至舊檔清理完成；舊檔另以受鎖定的 handle 核對身分／size／SHA，
  用同一 handle 的 `FileDispositionInfo` 刪除。遺失可重試；被替換或修改則保留。
- 手動匯出也選資料夾，由 host 產生 `work-fleet-backup-UUID.zip`；每次新建，picker grant 使用一次。
  失去保存回應不解鎖取代還原，使用者可重新選擇、產生另一份安全備份。
- schema version 2 新增 profile-bound `capabilities`，metadata 同樣 DPAPI CurrentUser 加密；
  version 1 原 records／attachments／vault 保留。密碼仍用 immutable vault key ID。
- 共用排程改呼叫 vault `encrypt`，不再呼叫 password `read`。原生用 .NET PBKDF2-SHA256
  600,000／AES-256-GCM，random 16-byte salt／12-byte nonce，canonical header 作 AAD，
  產生同一 SPEC-002 ZIP envelope；共用 reader 可以原密碼還原。key 失效不改存明文。
  DPAPI 無法解密或資料夾被替換時暫停排程，等待明確處理與重試。
- 受限 bridge 僅新增 backup grant／建立／讀回／清理／金鑰建立／加密方法。
  不接受 renderer 路徑、不提供 vault read；密碼只在使用者設定時輸入，原生加密後不再回傳。
  原生提交開始後遵循實際結果；正常關閉先取消準備工作並等待排程 journal 收尾。

## Consequences

### Positive

保存證明、重啟恢復及保留清理有真實檔案身分；加密排程不需要把已保存密碼交回 renderer。

### Negative

目前只開放本機 NTFS（含符合條件的 removable drive）；網路磁碟、FAT／exFAT、連結／junction 位置拒絕。
不宣稱所有外部磁碟、雲端 placeholder 或斷電情境已通過。使用者可自行搬運已完成 ZIP；
搬動後不把新位置當成原排程的受管檔案。

### Neutral

原生 grants／密碼／排程 journal 不在可攜 ZIP 中；換裝置需重新選位置及輸入原密碼。
持有目錄／檔案 handle 期間 OS 可能拒絕外部改名或寫入；失敗保留資料並明示重試。
清除暫時 byte buffers 不等於保證 GC 字串或作業系統記憶體已清零。

## Alternatives Considered

### Pathname 檢查後刪除

實作簡單，但 hash 查驗與刪除之間可換檔；未採用。

### 將 vault 密碼回傳共用 JavaScript

可沿用 WebCrypto，但會多暴露已保存密碼；改由 native 封裝可攜加密結果。

## References

- [原生檔案／加密研究](../resreach/2026-10-04-windows-native-backup-files.md)
- [SPEC-002](../specs/002-portable-backup-and-restore.md)、[ADR-014](014-durable-automatic-backups.md)
- [ADR-015](015-windows-native-storage-and-editor-host.md)、[驗證命令](../testing.md)
