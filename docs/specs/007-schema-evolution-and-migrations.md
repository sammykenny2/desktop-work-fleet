# SPEC-007: Schema 演進與 migration

## Metadata

| Field | Value |
|---|---|
| Status | Implemented，2026-10-17；平台驗證界線見 PROGRESS |
| Owner | 專案維護者 |
| Reviewer | 獨立審閱結果見 PROGRESS |

## Summary

既有本機 v1 資料在同步及編輯前自動、安全升級至 v2；同步與備份格式獨立演進。
只有持久交易成功後才可啟用工作空間，原始副本保留供復原。

## Goals

- 版本偵測、逐版遷移、跳版、安全重試、未知版本拒絕及可驗證的相容規則。
- 本機與 Google 分區使用同一遷移入口，跨平台共用資料轉換。

## Non-Goals

- 不改寫 Google 既有 revision、不推出虛構的同步／備份 v2、不升 App 版號或發布。
- 不自動降版，不把 migration 副本當完整可攜備份。

## Requirements

| ID | 驗收要求 |
|---|---|
| M01 | 各格式有獨立版本常數；缺少、無效、未知新版拒絕且不改寫工作空間內容 |
| M02 | migration runner 逐版執行並驗證；缺步驟拒絕；不改輸入或執行網路／檔案副作用 |
| M03 | v1→v2 集中既有相容處理，保留完整歷史、pending、衝突、草稿、附件引用、擴充與 outbox；缺歷史拒絕 |
| M04 | 啟動先完成 migration；原始副本與新資料以單一 CAS 交易保存，失敗不發布工作空間 |
| M05 | 原生回應遺失核對完整持久 bytes；重開不再增加 CAS revision 或重複建立副本 |
| M06 | 副本帳號隔離、原生加密；只能讀取固定種類／來源版本，不接受任意路徑或 SQL |
| M07 | reset／本機完整還原原子清除副本；其他帳號不受影響；一般備份不含副本 |
| M08 | 新版 revision／Drive 檔案停止失敗頁與 upload，舊資料／游標／outbox 保留 |
| M09 | 舊 v1 ZIP 仍可往返還原至 v2；新版備份明確回報版本不支援，不寫目標 |
| M10 | 歷史 fixture、跳版、交易故障、重試、CAS 競爭、未知欄位與混版裝置均有回歸 |

## Design Overview

`core/schema.js` 管版本與純 runner；Workspace 的 v1→v2 轉換及非同步 open 為唯一生產入口。
storage adapter 原子建立受限 recovery 記錄並提交；原生端自行讀取舊記錄驗證來源版本。
詳細決策及相容矩陣見 [ADR-051](../decisions/051-schema-evolution-and-atomic-migrations.md)。

### 相容矩陣與後續修改流程

| 格式 | 可讀版本 | 寫入版本 | 遇未來版本 |
|---|---|---|---|
| Workspace | 1、2 | 2 | 拒絕開啟與寫入 |
| Layout | 1 | 1 | 拒絕載入／還原 |
| revision／Drive metadata | 1 | 1 | 停止失敗頁與後續 push |
| ZIP manifest／加密 envelope | 1 | 1 | 拒絕匯入，不嘗試有損轉換 |
| 自動備份 journal | 1 | 1 | 暫停自動備份，不操作或清理檔案 |

後續改動先判斷是 SQLite/IndexedDB 結構、Workspace、共享 revision 還是備份格式。
更改該層常數，補上每個來源版本到下一版的純步驟與各目的版本驗證；不可刪除已交付的舊步驟。
若僅是可選擴充，先證明舊 reader 再編輯後仍保留新欄位；影響寫入語意則升 schema 以阻止舊 writer。
以固定舊版 fixture 驗證一步、跳版、失敗重試、重開、未知欄位及原始 revision bytes。
原生結構變更另依各平台版本執行交易式 SQL migration，不能只修改 user_version 或刪庫重建。
未來同步／備份的新格式須定義自己的 reader／轉換及混版政策，不自動套用本機 Workspace migration。

早期 saveDraft API 允許缺少 groupId／baseRevision；遷移保留這些缺席欄位及正文，不猜測群組或編輯基線。
若尚未補齊群組，維持原提交限制並保留草稿；不把草稿發布為新的雲端 revision。

診斷 recovery 時先保存整個 App 資料區與原使用者金鑰；以目前 profile 的
`storage.recovery({kind: 'workspace', fromVersion: 1})` 讀取舊記錄，或 browser adapter 的 `recovery(profileId, 1)`。
可以對其建立唯讀 Workspace 投影並以現有附件匯出 ZIP；未持久遷移的投影禁止普通編輯。
不直接改 schemaVersion、覆寫原生資料庫或自動降版。原始副本不含單獨的附件 bytes，完整還原以 ZIP 為入口。

## Dependencies

[SPEC-004](004-revision-graph-and-file-sync.md)、[SPEC-002](002-portable-backup-and-restore.md)。

## Open Questions

無阻擋本輪的未決項目；未來實際新格式必須隨功能定義相容政策及 migration。

## References

[PLAN-007](../plans/007-schema-evolution-and-migrations.md)、[PROGRESS](../../PROGRESS.md)。
