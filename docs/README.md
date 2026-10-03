# 文件索引

更新：2026-10-03。先讀最新需求，再讀候選技術方案；研究不代表已完成的功能。

## 專案入口

| 文件 | 狀態 | 用途 |
|---|---|---|
| [README](../README.md) | 專案化 | 定位與目前交付內容 |
| [PROGRESS](../PROGRESS.md) | 進度權威 | 已完成與未執行工作 |
| [ROADMAP](../ROADMAP.md) | 候選路線 | 下一步驗證順序 |
| [需求](requirements.md) | 研究摘要 | 連結完整需求與待確認 UX |
| [架構](architecture.md) | 驗證版現況＋1.0 MVP 提案 | Drive 便箋／來源與 renderer 邊界 |
| [Setup](setup-guide.md) | 專案化 | 本階段使用方式 |
| [Testing](testing.md) | 專案化 | 實際檢查與未驗證範圍 |
| [Deployment](deployment.md) | 本機驗證版 | 各平台與商店未測範圍 |
| [API](api.md) | 已實作 | 条件式操作、配對與權限 |
| [Security](security-guidelines.md) | 設計原則 | 保存、配對與權限界線 |
| [Services](services.md) | loopback 9847 | 可配置 HTTP／HTTPS 服務 |
| [第三方聲明](../THIRD-PARTY-NOTICES.md) | 來源記錄 | Bootstrap 範圍與 MIT notice |

## 研究

完整索引：[docs/resreach](resreach/README.md)。此目錄拼字依使用者指定。

| 文件 | 性質 |
|---|---|
| [Backlog 優先需求](resreach/2026-10-03-backlog-first-product-requirements.md) | 使用者需求、討論演進與候選 UX |
| [輕量 PM 與檢視模型](resreach/2026-10-03-lightweight-project-management-and-view-model.md) | 官方產品參考與模型建議 |
| [資料來源與衝突](resreach/2026-10-03-source-of-truth-sync-and-conflict-analysis.md) | Server／file based 候選與可靠性案例 |
| [macOS 公開 API](resreach/2026-10-03-macos-public-api-desktop-feasibility.md) | 公開 API 證據、推論與未執行測試 |
| [上架與授權](resreach/2026-10-03-store-distribution-and-license-analysis.md) | 商店條件、Linux 範圍與授權邊界 |
| [獨立架構與驗證](resreach/2026-10-03-independent-architecture-and-validation-plan.md) | 候選責任分界、分階段工作及 bootstrap 來源 |

- [Google Drive 便箋 MVP](resreach/2026-10-03-google-drive-notes-mvp-feasibility.md)：最新 1.0 方向、Keep／Drive 可行性、檔案衝突、Google 登入及商店差距。
- [完整產品架構草案](resreach/2026-10-03-product-architecture-blueprint.md)：Deferred，保留未來 PM／自架 server 設計。
- [AppData 備份還原](resreach/2026-10-03-appdata-backup-and-restore-design.md)：官方能力、快照範圍與還原取捨。

## 決策與規格

- [決策索引](decisions/README.md)：只有已明確接受的專案邊界列為 Accepted。
- [驗證版規格](specs/001-validation-version.md)：實作範圍與限制。
- [ADR-002](decisions/002-validation-runtime.md)：驗證版 runtime 與資料來源決策。
- [ADR-003](decisions/003-product-architecture-boundaries.md)：Deferred，保留完整產品的資料／模組邊界。
- [ADR-004](decisions/004-google-drive-notes-mvp.md)：Proposed，Google Drive 檔案便箋 1.0。
- [ADR-005](decisions/005-portable-backup-and-restore.md)：Proposed，來源無關的備份格式與新增式還原。
- [SPEC-002](specs/002-portable-backup-and-restore.md)：Draft，備份內容、格式、還原語意與驗收案例。
- [PLAN-002](plans/002-google-drive-notes-mvp.md)：Draft，1.0 契約／核心／Google／UI／發佈順序。
- [驗證報告](validation/2026-10-03-validation-report.md)：實機與資料測試證據、失敗／未測矩陣。
- [macOS 驗證版接手計畫](plans/001-validation-version-macos-handoff.md)：已授權目標、Mac 上的接手順序、驗收證據與可直接使用的 goal 描述；現已接續實作；原始接手基線保留，最新進度見 PROGRESS。
- [計畫索引與模板](plans/README.md)：後續技術選型與規格仍需依實作證據記錄。

## Bootstrap 協作材料

- [AGENT-GUIDE](AGENT-GUIDE.md)：本專案任務路由。
- [SCRIPT-STANDARDS](SCRIPT-STANDARDS.md)：通用腳本慣例。
- [Skills](../skills/README.md)：minimal 未安裝額外 helper skills。
- [Terminology](terminology.md)、[A2A](a2a/README.md)、[MCP](mcp-config.md)：保留的通用參考／模板，並非本專案已採用的協定或 runtime。
- ADR／SPEC／PLAN 的 000-template.md 保留模板欄位，不算未完成產品功能。

新文件使用 Markdown 與相對路徑。研究檔名為 YYYY-MM-DD-topic.md，明確標示證據、推論、建議及未驗證限制。
