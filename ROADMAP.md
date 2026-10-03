# 開發方向

更新：2026-10-03。1.0 為 Google 帳號＋file based 簡單便箋，
包含使用者可持有的備份檔與預覽後匯入。
以下為工作順序；完成狀態只記在 PROGRESS.md，不承諾發佈日期。

1. **契約與選型**：以 appDataFolder 為基線，凍結便箋／來源／renderer、
   同步及備份 v1 契約；確認同版平台與正式 runtime。
2. **本機核心與備份**：交易式資料、可靠草稿／outbox、ZIP／JSON 往返、
   快照範圍標示及新增式匯入；先用 fake source 驗證。
3. **Google 整合**：OAuth、帳號與憑證隔離、跨 client ID 的讀寫、
   衝突與重試；不架自家便箋 server。
4. **便箋介面**：快速記錄、桌面鎖定／解鎖、每機版面、備份預覽與匯入進度。
5. **1.0 發佈**：對選定平台完成封裝、正式身分／簽章、商店材料、
   第三方授權盤點及對應功能回歸。
6. **後續擴充**：其他 source／renderer、PM、完整 Item/View、自架 server、
   有獨立復原語意的整庫回滾與自動備份。

具體交付物與出口條件見 [PLAN-002](docs/plans/002-google-drive-notes-mvp.md)，
備份格式／行為與 T01–T12 驗收見 [SPEC-002](docs/specs/002-portable-backup-and-restore.md)。
[ADR-004](docs/decisions/004-google-drive-notes-mvp.md)、
[ADR-005](docs/decisions/005-portable-backup-and-restore.md) 均為 Proposed。
[原完整架構](docs/resreach/2026-10-03-product-architecture-blueprint.md) 與 ADR-003 保留為 Deferred。

Windows/macOS/Linux、Apple/Google 商店的原始平台目標保留；
使用既有 Mac host 作為第一個整合入口，不代表縮成 Mac-only 1.0，
也不代表所有平台必須同版推出。不重新啟動已暫停的驗證 goal。
