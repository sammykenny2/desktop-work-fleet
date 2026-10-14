# ADR-014: 自動備份工作紀錄與原生檔案能力

## Status

Accepted，2026-10-04。細化 SPEC-002／ADR-013，不縮減五平台自動／加密備份要求。
原生 host／安全儲存仍需實作及驗收，執行狀態只記 PROGRESS。

## Context

App 可能在備份寫入、成功回報或清理舊檔之間結束。單純 timer 或按檔名掃描無法辨識
已保存但尚未收到回應的工作，也可能刪除使用者改過或替換的檔案。
備份狀態若寫回 Workspace，會把自己當成內容變化而再次觸發備份。

## Decision

- 每個 profile 的單 writer lease 下設獨立 CAS journal，保存設定、pending、inventory、成功／失敗。
  不放進 Workspace、同步或可攜 ZIP；密碼只經 account-bound OS vault，journal 僅記 opaque key ID。
- 預設關閉；啟用後有變化且距成功滿 24 小時才執行，啟動／可見／resume 補跑一次。
  觸發合併，取消 controller 在排隊時即建立。錯誤一分鐘起退避至一小時；授權／key 失效暫停。
- 位置對應 scheduleId；每次設定保存產生 policyId，確保加密／key 改變後即使內容不變仍需新備份。
  vault key 參照不可原地換密碼而沿用相同身分。停用及換位置保留原檔。
- 先產生並驗證完整 ZIP，持久保存工作 ID、指定位置、固定 UUID 檔名、SHA／size，再要求 host 建檔。
  成功後更新 inventory／lastSuccess；ack 遺失可完整讀回 journal，或重啟比對 pending 的檔案 bytes。
  不完整檔記為 unconfirmed 並保留，再建另一個工作；不覆寫或清理未確認檔。
- 只有可信 host 宣告 create-new 能力才能啟用。建立／清理必須處理檔案替換競爭，
  不把「先查不存在／先驗 hash，稍後按 pathname 操作」當原子保證。
  瀏覽器 File System Access 沒有採用所需保證，因此預覽的自動檔案能力為 unavailable，保留手動匯出。
- 具原子身分刪除能力時，僅清理同 profile／schedule／位置的 verified inventory，預設七份、1–90。
  先確認最新成功檔仍完整；失蹤或被改則先保留舊檔、另建新份。刪除 ack 遺失可重試已不存在的原檔。
  清理能力缺失時保留全部並明示，不能默默用不安全的 pathname 刪除。
- journal 本身失效時不覆寫壞紀錄，仍要在 UI 發佈 transient paused／error；重新讀取成功才可恢復。
  inventory 上限 10,000 筆，不藉超限刪除其他位置或未知檔案。

## Consequences

### Positive

排程不會因自身紀錄反覆觸發；程序結束／回應遺失後能核對已完成工作。
加密設定、實際檔案能力與保存結果分開，失敗不降級明文或刪除舊檔。

### Negative

可靠檔案與 vault adapter 需逐平台實作；瀏覽器預覽不能替代原生自動備份交付。
換位置／未確認檔會增加保留空間；自動清理不以犧牲檔案身分保證換取整齊目錄。

### Neutral

App 關閉或 OS 暫停期間不保證準時，resume 檢查補跑。公開設定 `.env.example` 不保存這些
執行中工作、檔案授權或備份密碼。

## Alternatives Considered

- 每日 timer 直接寫相同檔名：覆寫競爭、崩潰狀態不明，拒絕。
- 掃資料夾按日期／prefix 清理：無法證明所有權，拒絕。
- FSA handle + size/hash + removeEntry：真 OPFS 可重現中途換檔後仍覆寫／刪除新檔，拒絕。
- 瀏覽器持久保存密碼：缺少要求的 OS 安全儲存，不採用明文或一般 IndexedDB 替代。

## References

- [SPEC-002](../specs/002-portable-backup-and-restore.md)、[ADR-013](013-complete-portable-backup.md)
- [檔案能力研究](../research/2026-10-04-automatic-backup-file-safety.md)
- [契約](../../contracts/backup.d.ts)、[PROGRESS](../../PROGRESS.md)

Decision made: 2026-10-04.
