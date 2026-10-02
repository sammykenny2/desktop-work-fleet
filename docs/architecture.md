# 架構現況

更新：2026-10-03。尚未選擇程式語言、UI framework、backend、資料庫或同步協定。

本 repo 由 project-bootstrap minimal 產生，只有文件、協作慣例與維護輔助腳本；src 與 tests 尚無產品內容。

已接受的邊界見 [ADR-001](decisions/001-independent-backlog-first-foundation.md)。候選責任分界見 [獨立架構研究](resreach/2026-10-03-independent-architecture-and-validation-plan.md)。

選型需同時滿足：

- 快速捕捉與簡單 backlog 回顧。
- 多裝置更新的衝突、草稿與恢復能力。
- Apple 商店目標與 macOS 公開 API／sandbox。
- Windows MSIX 候選與可驗證的 Linux 支援範圍。

目前沒有義務維持其他應用的 UI、資料格式、外掛或平台模組相容性。可使用合適元件，但引入前須記錄版本、來源與授權。
