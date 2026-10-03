# 需求與版本範圍

更新：2026-10-03。

## 1.0 MVP 的最新方向

使用者希望 App 登入 Google 帳號即可使用，以 file based 方式同步簡單便箋，
第一版不架 local server；專案管理可以延後，但異質來源與 renderer 的邊界現在就要考慮。

具體可行性與限制見 [Drive MVP 研究](resreach/2026-10-03-google-drive-notes-mvp-feasibility.md)。
研究推薦 Google Drive；Keep 官方 API 不符合普通帳號雙向便箋編輯。
最新規劃以 appDataFolder 為基線，包含手動檔案備份與匯入還原。
[備份規格](specs/002-portable-backup-and-restore.md) 定義公開 ZIP／JSON、
草稿與衝突保留、預覽、新 ID 匯入及工作續傳；首版不提供整庫覆蓋回滾。
[實作計畫](plans/002-google-drive-notes-mvp.md) 定義交付順序與驗收條件。
衝突協定／正式 runtime 與 1.0 同版平台範圍尚待定案，Google 整合尚未實作。

## 持續保留的產品目標

快速記錄、桌面唯讀／滑鼠穿透、主動解鎖編輯及跨裝置同步仍是核心。
完整需求與歷史演進保留在 [Backlog 研究](resreach/2026-10-03-backlog-first-product-requirements.md)；
Todo／In Progress／Done、Project／Item／View 不再自動列為 1.0 必做。

Apple／Google 自有 App、Windows 憑證偏好與 Linux 可測範圍保留。
Mac 探針證據不等於 Google 整合或商店核准。
[發佈研究](resreach/2026-10-03-store-distribution-and-license-analysis.md)
及 [現有驗證報告](validation/2026-10-03-validation-report.md) 各自保留原範圍。
