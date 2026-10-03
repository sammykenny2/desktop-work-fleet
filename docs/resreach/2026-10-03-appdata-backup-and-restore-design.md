# Drive appDataFolder 檔案備份與還原設計

- 日期／官方文件查閱日：2026-10-03。
- 使用者要求：確認 drive.appdata 能否讓使用者以檔案形式備份／還原，並要求規劃。
- 性質：官方能力查證＋1.0 設計提案；尚未執行 Google 帳號／Drive 操作。
- 詳細規格：[SPEC-002](../specs/002-portable-backup-and-restore.md)；
  開發順序：[PLAN-002](../plans/002-google-drive-notes-mvp.md)。

## 官方能力

appDataFolder 是 App 專屬隱藏空間，使用者不能在一般 Drive 檔案介面中開啟。
它和 Drive 顯示的裝置備份資料夾不同。
App 可以列出自己的檔案，以 files.get + alt=media 讀取內容，並用 files.create
在 appDataFolder 建立檔案。因此「由 App 匯出至使用者檔案，再由 App 讀檔還原」
有官方 API 基礎；不是 Google 自動替本產品提供備份 UI。
[Google appDataFolder 文件](https://developers.google.com/workspace/drive/api/guides/appdata)

appDataFolder 內的檔案不能跨 storage space 移動、分享或放進 Drive trash。
若要在一般 Drive 留一份可見備份，需讀出內容後另行寫出，
不能直接把隱藏檔案移出。App 內的刪除區仍需自行維護。
[官方限制](https://developers.google.com/workspace/drive/api/guides/appdata#constraints_on_the_application_data_folder)

Drive files.generateIds 的 space 支援 appDataFolder。
預產生檔案 ID 可用於後續建立請求，讓重試重用同一 ID；成功後再建立會返回 409。
這是單檔建立重試的能力，不代表多檔匯入具備原子交易。
[generateIds](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds)、
[Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads)

## 本案推論與建議

- 以 drive.appdata 讀取來源後，App 可在本機自行組成 ZIP，再使用 OS 檔案儲存入口；
  此步驟不需要因備份而擴大 Google Drive scope。
- 使用者日後可以把自己保存的 ZIP 放到任何位置。
  如果要讓本 App 直接管理一般 Drive 中的可見備份，才另行評估 drive.file。
- 首版提供明確的手動匯出／匯入，不預設使用者已配置自動備份。
- 備份格式屬於共用資料核心，Drive adapter 處理傳輸；
  未來 API 型 NoteSource 不必假裝成檔案來源也能使用相同備份格式。

以上是應用架構推論，不是 Google 提供的 turnkey backup 功能，
也不是已完成 Sandbox／商店檔案選取整合的證據。

## 為什麼首版採新增式還原

假設 A 匯入上週的備份，同時 B 正在編輯今天的便箋。
若 A 直接覆寫共享檔案，可能撤銷 B 的修改或造成難以解釋的並行版本。
將備份匯入為新身份，能保留目前內容並恢復舊內容，使用者再自行整理。

此語意也適用原帳號遺失或更換來源：備份只需內容與可解析的內部引用，
不需要原 Drive file ID／token。代價是沒有全帳號時間點回滾、舊 identity 或完整歷史。
因此 UI 應稱「從備份匯入」，文件中清楚界定它提供的還原範圍。

## 必須保留的資料與一致性

只備份目前畫面會漏掉未開啟便箋、刪除區、衝突分支及未同步草稿。
建議先保存所有 editor 草稿，再以本機交易快照輸出；
保存同步時間與資料範圍，避免將離線快取包裝成全球一致快照。

多檔 Drive 下載本身沒有提供全體便箋同一時間點的交易快照。
即使同步剛完成，其他裝置可能尚未送出新內容；
備份承諾限於「該 client 在 snapshotAt 已知並持久化的內容」。
遇到不支援的 schema、缺失依賴或損壞資料，不能悄悄丟掉後宣稱完整備份。

還原的原子性以本機提交為界；其後逐檔同步可能部分成功。
持久化 restore job 與穩定操作 ID 是應用需要實作的責任，不能只仰賴 Drive 的 409。
未保存草稿還原到本機待確認區，避免使用者未決定公開的文字自動上傳。

## 尚待實作驗證

- 選定 runtime 的 ZIP parser／writer、交易式 local store 與其授權。
- 各平台檔案選取／儲存、取消／磁碟滿／暫存資料生命週期。
- 同一工作崩潰續傳、Google 回應遺失及帳號切換。
- 另一個乾淨 profile／帳號在原來源不可用時仍能還原。
- 記憶體與解壓限制、Unicode／換行往返、衝突與草稿完整性。

原有完整產品／PM 研究與 ADR-003 繼續保留，並不因這份小範圍規格被刪除。
