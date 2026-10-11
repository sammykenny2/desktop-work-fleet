# ADR-037: MSIX 本機資料生命週期與 Google 備份覆蓋

## Status

Accepted，2026-10-10；2026-10-12 續行實作。維護者確認解除安裝清除本地資料，
並選擇「先清空 Google 的所有 Work Fleet 資料，再還原備份」。
本決策取代 ADR-032 中 Debug 與 MSIX 必須共用資料的要求；其 Debug 檢查與 Release 防護不變。
[ADR-038](038-portable-local-and-cloud-backup-flows.md) 後續補充本機完整還原（舊備份可選）與 Google 同步後匯出；本決策的雲端安全備份規則不變。

## Context

MSIX 的 AppData 虛擬化可能受安裝前既有 ZIP／Debug 檔案影響，造成不同機器解除安裝後的結果不同。
目前三種還原都保留既有歷史；「取代目前便箋」不能完成使用者要求的 Google 全量覆蓋。

## Decision

- MSIX 明確使用 `ApplicationData.Current.LocalCacheFolder/Local/WorkFleet`，保留目前已虛擬化的資料位置。
  所有本機與 Google 帳號分區、SQLite／WAL、設定、DPAPI vault 與 WebView2 cache 都留在套件資料區。
  更新保留資料；解除安裝由 Windows 清除。不使用 unvirtualizedResources 或外部保留目錄。
- ZIP／未封裝 Debug 仍用 `%LOCALAPPDATA%\WorkFleet`。不自動搬移或刪除舊獨立資料，
  首次開啟空白 MSIX 工作區若找到舊 DB，提示先用舊版／ZIP 匯出，再匯入。
  使用者選定位置保存的 ZIP 與 Google 雲端資料不由 Windows 解除安裝刪除。
- 新增「清空 Google 後，從備份還原」，只在已登入且可連線的 Google 工作空間提供。
  既有匯入、合併及取代可見狀態的語意不變。新模式只保留匯入備份中的資料與歷史，
  不保留被覆蓋工作區的草稿；先前草稿仍在取代前保存的安全備份。
- 先完成同步及備份檔驗證，預覽目標帳號，成功保存同 profile／revision 的目前資料安全備份，
  再勾選永久清空確認。其他裝置須停止同步；舊副本遇重設標記會暫停，交由使用者決定清除。
- 完整新 Workspace、附件與 `cloudRestore` 工作同一本機交易保存後才執行遠端刪除。
  工作分 `reset` 與 `upload` 兩個持久階段。清空完成且階段保存成功後才上傳；
  上傳重試不再清空。重啟或失敗後提供「繼續覆蓋 Google」，不得默默恢復普通同步。
- 清空範圍是目前帳號、目前 Google 專案的 Work Fleet appDataFolder；不接觸一般 Drive 檔案。
  保留重設控制標記，讓舊裝置辨識清空。備份草稿只在執行裝置還原，不自動發布；
  每機 geometry 不作共享內容，登入憑證不進備份。

## Consequences

### Positive

- MSIX 解除安裝行為不再取決於曾否執行 ZIP／Debug；重裝恢復走明確的匯出／匯入流程。
- 雲端刪除前已有安全備份及完整本機還原資料；上傳失敗可續行，不重複清空。

### Negative

- 解除安裝前未匯出的本機草稿與未同步內容會遺失。同版號重裝測試也需先備份。
- Drive 多檔案刪除／上傳不是原子交易，中斷期間雲端可能是空白或部分還原；需要恢復網路與授權後續行。
- 舊版使用外部目錄的資料不自動清理；使用者需先匯出並自行決定舊版資料的後續處理。

### Neutral

- 正常版本更新保持套件資料；匯出 ZIP 是使用者持有的檔案。
- 真 Google、跨 OS 更新／解除安裝與多人裝置同時操作需要實機驗收，合成 FileStore 測試不取代它們。

## Alternatives Considered

### 外部資料永久保留

可讓重裝讀回資料，但與維護者確認的解除安裝清除政策衝突，故不採用。

### 沿用取代可見狀態

保留舊歷史及刪除區，較容易回復，但不能清空 Google 的全部 Work Fleet 資料，故保留為另一模式。

## References

- [SPEC-002](../specs/002-portable-backup-and-restore.md)、[PLAN-005](../plans/005-msix-data-and-cloud-overwrite.md)
- [ADR-013](013-complete-portable-backup.md)、[ADR-032](032-windows-debug-webview-inspection.md)
- [Microsoft MSIX 虛擬化](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)
- [Microsoft AppData 生命週期](https://learn.microsoft.com/en-us/windows/apps/develop/data/store-and-retrieve-app-data)
- [Google appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)

---

*Decision made: 2026-10-10*
*Decision makers: 專案維護者*
