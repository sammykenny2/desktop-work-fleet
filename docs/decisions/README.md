# 決策索引

更新：2026-10-04。

| 記錄 | 狀態 | 範圍 |
|---|---|---|
| [ADR-001](001-independent-backlog-first-foundation.md) | Accepted | 名稱、獨立開發、backlog 重心與 bootstrap 範圍 |
| [ADR-002](002-validation-runtime.md) | Accepted | 驗證版 AppKit／Web／Python SQLite，保留跨平台封裝目標 |
| [ADR-003](003-product-architecture-boundaries.md) | Deferred | 保留完整 PM／自架 server 架構，非 1.0 必做 |
| [ADR-004](004-google-drive-notes-mvp.md) | Proposed | Google Drive 檔案便箋 MVP；來源與 renderer 邊界 |
| [ADR-005](005-portable-backup-and-restore.md) | Proposed／範圍待修訂 | 備份格式與還原候選，不是唯一模式已定案 |
| [ADR-006](006-card-group-and-formation-semantics.md) | Accepted（產品語意） | 一事一卡、群組／formation／操作與轉組手勢 |
| [ADR-007](007-desktop-scene-and-platform-host.md) | Proposed | 場景 renderer／平台 host、可控疊序與输入責任 |
| [ADR-008](008-portable-interaction-core.md) | Accepted（共用核心） | ES modules 語意、原子本機命令、完整五平台 1.0 範圍 |
| [ADR-009](009-local-renderer-and-persistence.md) | Accepted（本機介面） | 封裝 renderer、IndexedDB 交易／草稿／附件、Markdown 清理 |
| [000-template](000-template.md) | Template | 後續決策格式 |

驗證版 runtime 已由 ADR-002 決定；其他平台封裝與正式商店配置尚未決定。研究建議留在 [resreach](../resreach/README.md)，不要自動改成 Accepted。

新決策採用 000-template 的結構，以小寫連字號命名，記錄接受範圍與日期。
