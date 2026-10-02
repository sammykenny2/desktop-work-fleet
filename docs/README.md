# 文件索引

更新：2026-10-03。先讀最新需求，再讀候選技術方案；研究不代表已完成的功能。

## 專案入口

| 文件 | 狀態 | 用途 |
|---|---|---|
| [README](../README.md) | 專案化 | 定位與目前交付內容 |
| [PROGRESS](../PROGRESS.md) | 進度權威 | 已完成與未執行工作 |
| [ROADMAP](../ROADMAP.md) | 候選路線 | 下一步驗證順序 |
| [需求](requirements.md) | 研究摘要 | 連結完整需求與待確認 UX |
| [架構](architecture.md) | 尚未選型 | 責任邊界與候選比較 |
| [Setup](setup-guide.md) | 專案化 | 本階段使用方式 |
| [Testing](testing.md) | 專案化 | 實際檢查與未驗證範圍 |
| [Deployment](deployment.md) | 尚未發佈 | 各平台目標 |
| [API](api.md) | 尚未定義 | 資料契約研究入口 |
| [Security](security-guidelines.md) | 設計原則 | 保存、配對與權限界線 |
| [Services](services.md) | 無服務 | 尚未配置 listener 或 port |
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

## 決策與規格

- [決策索引](decisions/README.md)：只有已明確接受的專案邊界列為 Accepted。
- [規格模板](specs/README.md)：尚未建立產品規格。
- [計畫模板](plans/README.md)：研究文件內的驗證批次不是已批准開發排程。

## Bootstrap 協作材料

- [AGENT-GUIDE](AGENT-GUIDE.md)：本專案任務路由。
- [SCRIPT-STANDARDS](SCRIPT-STANDARDS.md)：通用腳本慣例。
- [Skills](../skills/README.md)：minimal 未安裝額外 helper skills。
- [Terminology](terminology.md)、[A2A](a2a/README.md)、[MCP](mcp-config.md)：保留的通用參考／模板，並非本專案已採用的協定或 runtime。
- ADR／SPEC／PLAN 的 000-template.md 保留模板欄位，不算未完成產品功能。

新文件使用 Markdown 與相對路徑。研究檔名為 YYYY-MM-DD-topic.md，明確標示證據、推論、建議及未驗證限制。
