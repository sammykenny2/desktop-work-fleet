# 開發方向

更新：2026-10-03。使用者將 1.0 收斂為 Google 帳號＋file based 簡單便箋。
以下為工作順序；完成狀態只記在 PROGRESS.md，不承諾發佈日期。

1. **MVP 契約**：普通便箋、NoteSource／FileStore／renderer 邊界；選定 Drive 空間、資料格式與衝突策略。
2. **Google 整合**：應用端 OAuth、最小 scope、帳號與憑證隔離、跨裝置讀寫；不架自家便箋 server。
3. **可用便箋流程**：新增／編輯／刪除／還原、可靠草稿、同步、匯出、桌面鎖定與解鎖。
4. **1.0 平台與發佈**：先確認同版平台範圍，再完成其正式簽章、登入、商店配置與發佈驗收。
5. **後續擴充**：其他 source／renderer、PM、完整 Item/View 與自架 server。

[Drive MVP 研究](docs/resreach/2026-10-03-google-drive-notes-mvp-feasibility.md) 與
[ADR-004](docs/decisions/004-google-drive-notes-mvp.md) 為 Proposed 具體方案。
[原完整架構](docs/resreach/2026-10-03-product-architecture-blueprint.md) 與 ADR-003 保留為 Deferred。
Windows/macOS/Linux、Apple/Google 商店的原始平台目標保留；
本輪沒有默認縮小為只有 macOS，也沒有要求所有平台必須同版完成。
