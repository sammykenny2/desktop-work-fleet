# ADR-011: 不可變版本圖與嚴格 JSON 契約

## Status

Accepted，2026-10-04。依維護者完整 1.0 實作與技術細節授權定案。
接受來源無關格式及版本图規則；實作／整合程度見 PROGRESS，不能推論已通過 Google／五平台驗收。
補足 ADR-004 的版本候選；其原生 OAuth 與 provider 整合仍需實際證據。

## Context

Drive 檔案列舉可亂序、重複或缺依賴；兩個離線裝置不能靠時鐘或單一可覆寫檔保住雙方輸入。
既有本機 outbox 已記錄完整 value 與 parent，但尚未定義嚴格 wire 格式、遠端完整性與 pending 行為。
備份需要保留分支、刪除、群組、附件與未知擴充欄位，不能只匯出投影後的文字。

## Decision

- 採 [SPEC-004](../specs/004-revision-graph-and-file-sync.md) 的 schema 1 envelope。
  一個 revision 是一個不可變卡片／群組完整值；父版本集合表達因果，不使用 updatedAt 選贏家。
- 同版本正規 bytes 相同才接受 replay；不同則停止該批。未知 envelope schema 拒絕，value 擴充保留。
- 嚴格 JSON 拒絕重複欄位、無效 Unicode／不安全數值／非 JSON 資料；固定 8 MiB、64 層及
  200,000 值節點限制。parents 至多 1,024；超限保留原資料並回報，不暗中截斷。
- 迭代拓撲分析先檢查全部已知 parent 與 cycle，只有祖先完整的節點參與 heads。
  缺 parent 及後代全部保留 pending，不用猜根版本或把舊 head 隱藏。
- 明確多 head 決議建立包含全部已見 head 的新版本；晚到分支仍可成為衝突。
  所有 revision 保留，首版不自行執行遠端垃圾收集。
- Workspace 將 revision／outbox／投影／cursor 與必要裝置參照在同一交易提交；
  session 同時受 profile、source 及不落盤的 runtime nonce 限制，重啟須重新建立 session。
  既有完整 outbox 可遷入版本圖；缺歷史則保留資料並停止遷移，不補造根版本。
- 投影跟隨 group redirect 但不修改原 wire value；保留本機 entity 順序及所有既有 geometry。
  多 head 阻止普通內容覆寫，明確採用／歷史恢復才建立包含目前全部 head 的新版本。
  群組循環保留資料，透過恢復群組或明確重選目的解開；草稿保存不受循環阻擋。
- wire 不放裝置版面、OAuth 憑證或草稿。公開 OAuth／建置設定透過 `.env.example`，
  建置只輸出 allowlist 至 `build/config/public.json`；真正憑證由原生安全儲存負責。

## Consequences

### Positive

重播與亂序結果可驗證，舊內容及未知格式不因解析或自動決策遺失。
純 ES modules 讓五平台共用同一規則，備份可保留完整因果資訊。

### Negative

完整歷史增加 storage／掃描成本，需要後續容量量測；8 MiB 是每筆上限，不是所有資料的容量承諾。
多 head 與 group redirect 仍需可用的 UI／恢復流程；只有版本圖測試不構成使用者交付完成。

### Neutral

不新增第三方 runtime 依賴、不改 prototype Python server。
目前 Google 公開 ID 及原生驗收環境尚未建立，先完成不依賴它們的規則與故障驗證。

## Alternatives Considered

- 最後寫入者覆蓋：實作簡單，但錯誤時鐘與離線同改会吃掉內容，拒絕。
- 單一可改 notes.json：會放大全帳號競爭範圍，不能當多機原子性保證。
- 缺 parent 當根：掃描到檔案的順序就能改變結果與衝突，拒絕。
- JSON.parse 後直接信任：重複欄位已被丟掉、unsafe integer 已被四捨五入，無法檢測損失。

## References

- [SPEC-004](../specs/004-revision-graph-and-file-sync.md)
- [ADR-004](004-google-drive-notes-mvp.md)
- [ADR-009](009-local-renderer-and-persistence.md)
- [PLAN-002](../plans/002-google-drive-notes-mvp.md)
