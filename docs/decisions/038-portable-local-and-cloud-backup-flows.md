# ADR-038: 本機與 Google 的可攜備份與完整還原流程

## Status

Accepted，2026-10-12。維護者要求本機／Google 備份格式相容、可雙向遷移，並授權按最佳實踐處理。
本決策補充 ADR-013／037；原三種還原及全量 Google 覆蓋的安全備份要求不變。

## Context

本機與 Google 已共用 `work-fleet-backup` v1 ZIP，但手動 Google 匯出只保存本機已知副本，沒有先同步。
本機原「取代」保留舊歷史與草稿；先重設再匯入則分兩次操作，匯入失敗可能留下空白工作空間。
使用者要直接洗掉舊本機內容時，匯出舊資料不應成為強制步驟。

## Decision

- 繼續使用同一公開 v1 格式及可選加密 envelope，不加入帳號／provider／憑證。
  本機→本機、Google→Google、本機→Google、Google→本機皆使用同一驗證／還原核心。
- 手動 Google 匯出先 flush 草稿並同步；完整 pull／push／pull 後且 outbox 為空才記錄最後成功同步時間。
  同步失敗／登入不可用／仍有待同步內容時，預設不保存；使用者可明確選擇「只備份這台已知資料」。
  取消不保存，失敗不更新成功時間；格式仍標示 `known-local-data`，不宣稱其他裝置未上傳內容已收到。
- 備份頁與還原預覽顯示來源／目標工作空間、備份時間、最後成功同步時間、待同步／草稿／衝突／待補版本數量。
  手動安全備份與自動備份仍以一致本機快照為範圍，沒有偷偷增加網路依賴。
- 新增僅供本機工作空間的「清空本機後，從備份還原」。先驗證 ZIP、預覽清除數量，再勾選永久取代確認。
  備份舊內容可選；不要求先重設，不要求成功保存安全備份，也能在僅支援下載的環境使用。
- 以空白同 profile／目標 deviceId 準備計畫，保留備份的完整身分、歷史、狀態、草稿與附件，
  套用備份版面並救回不可達位置。計畫綁目前 revision；同一 CAS 交易替換工作空間、receipt 與附件集合。
  舊便箋、歷史、草稿與未引用附件一併移除，不留在刪除區；空附件備份也須清除舊附件。
- Workspace 的 graph 與 LayoutStore 僅在持久交易成功後替換；取消、過期預覽、錯 profile 或交易失敗保留原資料。
  原生回應遺失以完整持久 bytes 讀回確認；同 receipt 重試不再還原。Google 分區與 journal 禁止附件全量替換。
- 本機完整還原前停止自動備份並等待閒置，完成或失敗後恢復排程。
  自動備份設定／歷來已匯出 ZIP、Google 雲端／其他帳號分區、登入狀態與分享收件匣不屬於此操作。
  Google→本機使用「切換到本機便箋」後還原；後續本機編輯保持離線，不回寫來源 Google。

## Consequences

### Positive

- 同一 ZIP 可下載、離線持有及跨來源還原；本機洗掉舊資料是完整、可失敗回復的一步。
- 雲端匯出不默默把未同步副本標成最新雲端備份；使用者仍可在離線時救出已知資料。

### Negative

- 未保存舊備份就確認本機完整還原後，舊內容無法從 App 復原。
- Google 不是跨多檔案原子快照；其他裝置未上傳的修改與草稿仍無法包含。
- 手動 Google 匯出需要等同步；安全備份／自動備份仍可能只含目前已知副本。

### Neutral

- 不改 MSIX 更新／解除安裝政策，不改已發布 0.1.2 產物，也不升版或 dispatch Actions。
- 共用格式／流程可合成驗證；Apple／Android 原生編譯及真 Google 往返須另列實機證據。

## Alternatives Considered

### 先重設再匯入

步驟少但清除與還原分開，失敗時舊資料已不在，故改用同一交易。

### 所有清空都強制先備份

可多一道回復手段，但本機原子取代可在失敗時保留原資料，且維護者明確不需要保留舊資料，故本機改為可選。
Google 全量覆蓋涉及多裝置與非原子遠端刪除，維持原安全備份規則。

## References

- [SPEC-002](../specs/002-portable-backup-and-restore.md)、[PLAN-005](../plans/005-msix-data-and-cloud-overwrite.md)
- [ADR-013](013-complete-portable-backup.md)、[ADR-037](037-msix-data-lifetime-and-google-backup-overwrite.md)
- [Google 使用流程](../google-setup.md)、[測試界線](../testing.md)

---

*Decision made: 2026-10-12*
*Decision makers: 專案維護者*
