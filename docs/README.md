# 文件索引

更新：2026-10-04。先讀最新規格；研究、工作預設、實作完成與實測通過各自區分。

## 本次開發接手：優先閱讀

| 文件 | 效力與用途 |
|---|---|
| [接手入口](handoff/2026-10-04-desktop-interaction-handoff.md) | 閱讀順序、不可偏離行為、外部參考位置詢問規則 |
| [需求](requirements.md) | 最新產品範圍與未決項目 |
| [SPEC-003](specs/003-desktop-cards-groups-and-formation.md) | U／D／Q、完整互動、C01–C48；尚未實作 |
| [ADR-006](decisions/006-card-group-and-formation-semantics.md) | Accepted：一事一卡、群組、formation、操作語意 |
| [ADR-007](decisions/007-desktop-scene-and-platform-host.md) | Proposed：renderer／原生 host 分界及可控疊序 |
| [PLAN-003](plans/003-desktop-interaction-implementation.md) | 從契約到平台／來源整合的開發交接 |
| [討論演進](resreach/2026-10-04-desktop-card-interaction-design.md) | 決策來源、補充及已被取代的方案 |
| [平台研究](resreach/2026-10-04-desktop-interaction-platform-feasibility.md) | Windows／公開 AppKit／labwc-Wayland 的證據與限制 |

## 專案與現有程式

| 文件 | 用途 |
|---|---|
| [README](../README.md) | 定位與目前交付 |
| [PROGRESS](../PROGRESS.md) | 唯一執行狀態 |
| [ROADMAP](../ROADMAP.md) | 方向及先後順序 |
| [架構](architecture.md) | 正式設計與現有 0.1.0 分開 |
| [Setup](setup-guide.md) | 現有驗證版使用方式 |
| [Testing](testing.md) | 可執行檢查及未測界線 |
| [Deployment](deployment.md) | 原生封裝與商店未測範圍 |
| [API](api.md) | 0.1.0 HTTP／SQLite 契約，非 Drive 1.0 既成格式 |
| [Security](security-guidelines.md) | 保存、權限與隔離 |
| [Services](services.md) | 現有驗證版 listener／port |
| [第三方聲明](../THIRD-PARTY-NOTICES.md) | 實際 bootstrap 來源與 notice |

## Google、備份及歷史研究

完整研究索引在 [docs/resreach](resreach/README.md)，保留使用者指定拼字。

- [Drive 研究](resreach/2026-10-03-google-drive-notes-mvp-feasibility.md) 與
  [ADR-004](decisions/004-google-drive-notes-mvp.md)：provider／協定仍 Proposed。
- [備份研究](resreach/2026-10-03-appdata-backup-and-restore-design.md)、
  [SPEC-002](specs/002-portable-backup-and-restore.md)、[ADR-005](decisions/005-portable-backup-and-restore.md)：
  保留格式／恢復候選，需按群組與內容範圍修訂，不把舊排除清單当定案。
- [PLAN-002](plans/002-google-drive-notes-mvp.md)：來源／Google／backup 的工作順序，與 PLAN-003 合併執行。
- [Backlog 原始研究](resreach/2026-10-03-backlog-first-product-requirements.md) 與
  [輕量 PM 模型](resreach/2026-10-03-lightweight-project-management-and-view-model.md)：歷史討論，最新修正優先。
- [同步與衝突](resreach/2026-10-03-source-of-truth-sync-and-conflict-analysis.md)、
  [macOS 公開 API](resreach/2026-10-03-macos-public-api-desktop-feasibility.md)、
  [散布與授權](resreach/2026-10-03-store-distribution-and-license-analysis.md)、
  [獨立開發](resreach/2026-10-03-independent-architecture-and-validation-plan.md)：保留證據及研究日期。
- [完整 PM/server 架構](resreach/2026-10-03-product-architecture-blueprint.md)／
  [ADR-003](decisions/003-product-architecture-boundaries.md)：Deferred；其 Note 容器模型不得覆蓋最新規格。

## 既有驗證證據

- [SPEC-001](specs/001-validation-version.md)／[ADR-002](decisions/002-validation-runtime.md)：已實作 prototype 的範圍。
- [2026-10-03 報告](validation/2026-10-03-validation-report.md)：原有通過、失敗及未測矩陣。
- [Mac 歷史接手](plans/001-validation-version-macos-handoff.md)：先前實作路線，不是現在重啟探索的指令。

## 協作與文件慣例

- [AGENT-GUIDE](AGENT-GUIDE.md)、[SCRIPT-STANDARDS](SCRIPT-STANDARDS.md)、[Skills](../skills/README.md)。
- [決策](decisions/README.md)、[規格](specs/README.md)、[計畫](plans/README.md) 各有索引與模板。
- [Terminology](terminology.md)、[A2A](a2a/README.md)、[MCP](mcp-config.md) 是通用材料，不代表已採用該協定。
- 文件使用相對連結；研究採 YYYY-MM-DD-topic.md。外部參考 checkout 位置向維護者取得。
- 不新增與 PROGRESS 競爭的任務完成表；驗收案例表是要求，不是完成狀態。
