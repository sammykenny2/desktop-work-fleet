# 資料保存與存取設計原則

更新：2026-10-03；以下是未來設計約束，沒有已實作的安全機制聲明。

- 桌面 lock 是防誤操作模式，與 server 權限／跨裝置寫入衝突分開。
- 保存失敗或衝突時保留草稿，不能靜默覆蓋工作內容。
- QR 若用於配對，採短效一次性邀請；裝置授權需可撤銷。
- 不把長效 token、簽章私鑰或真實筆記提交到 Git。
- 外部連線與平台權限依實際需要配置。
- 任意遠端程式碼／外掛不是第一版候選範圍。
- 新依賴先確認來源、版本、license 與平台散布要求。

進一步研究見 [同步](resreach/2026-10-03-source-of-truth-sync-and-conflict-analysis.md) 與 [授權／上架](resreach/2026-10-03-store-distribution-and-license-analysis.md)。
