# PLAN-005: MSIX 資料生命週期與 Google 備份覆蓋

## Metadata

| Field | Value |
|---|---|
| Status | 使用者要求已確認；執行狀態只記 PROGRESS |
| Owner | 專案維護者 |
| Assigned To | 實作責任：Windows host、共用備份與介面 |
| Reviewer | 獨立審閱尚不可用 |

## Related Spec

[SPEC-002](../specs/002-portable-backup-and-restore.md)、[ADR-037](../decisions/037-msix-data-lifetime-and-google-backup-overwrite.md)。
2026-10-12 後續授權補充 [ADR-038](../decisions/038-portable-local-and-cloud-backup-flows.md) 的雙向遷移流程。

## Overview

依使用者明確選擇，固定 MSIX 的私有資料區，加入驗證／安全備份保護的全量雲端覆蓋。
沿用 0.1.2，只做本機檢查，沒有新的版本或 Actions dispatch 授權。

## Implementation Phases

### Phase 1: 資料位置

Windows host 依套件身分選擇明確私有位置；保持現在已虛擬化的 DB 路徑，不自動搬移／刪除外部舊資料。
加入資料位置探針；封裝探針只許獨立測試 identity 寫入。

### Phase 2: 全量覆蓋

在空白同帳號 Workspace 上準備已驗證的完整還原計畫，綁定 profile／revision／source。
同交易持久化 Workspace、附件及工作；清空／上傳分階段，普通同步在清空階段拒絕執行。
介面先驗證、保存安全備份及取得明確清空確認；失敗／重啟提供續行，預覽期間暫停一般同步。

### Phase 3: 驗證與交付

合成 FileStore 驗證全部舊內容清空、附件／草稿、另一裝置重設保護、保存失敗、錯帳號與重啟重試。
真瀏覽器／IDB 驗證確認與備份保存門檻；Windows build 及隔離套件資料生命周期驗證另列實際結果。
文件、需求與未來 release 說明在同一提交完成；真 Google 測試不得以使用者資料清空代替 fixture。

### Phase 4: 完整本機還原與同步後匯出

沿用公開 ZIP，新增本機清空還原的不變計畫與 Workspace graph 替換；SQLite／IndexedDB 的同 profile 附件集合原子替換。
舊資料備份可選、永久取代需明確確認；自動備份先等待閒置，其他分區及設定保留。
Google 手動匯出先同步，失敗需明確同意已知副本；來源、目標、成功同步時間與 pending 資訊清楚呈現。
四方向、回滾／取消／過期、回應遺失、真 IDB UI 及 native SQLite 回歸；沒有真 Google／跨平台 SDK 時明列未測。

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `src/native/windows/app/AppDataDirectory.cs` | Create | 套件私有資料路徑 |
| `src/backup/cloud-restore.js` | Create | 預覽、安全備份與持久 reset／upload 工作 |
| `src/backup/restore.js`、`src/backup/export.js` | Modify/Create | 本機完整替換計畫及同步後匯出／明確副本選擇 |
| `src/storage/`、各原生 Database／bridge | Modify | 同分區附件集合與 workspace 原子替換 |
| `src/app/backup.js`、`src/app/main.js` | Modify | 覆蓋入口、同步屏障與續行 |
| `src/sources/file-sync.js` | Modify | 停止／等待與未清空工作保護 |
| `tests/cloud-restore.test.js`、原生／瀏覽器探針 | Create/Modify | 合成資料回歸 |

## Technical Decisions

詳見 ADR-037／038。沒有 Drive 原子交易；雲端覆蓋失敗保留本機還原工作與使用者保存的安全 ZIP。
本機完整還原則可在同交易失敗時保留原資料，舊資料安全 ZIP 為可選。

## Testing Strategy

- 單元／整合：MemoryFileStore 清空、完整往返、CAS／過期／錯帳號、reset／upload 重啟。
- 真瀏覽器：保存安全備份及勾選確認皆必要，改檔案／模式後確認失效；既有三模式回歸。
- 雙向遷移：四方向同格式往返、本機完整還原的可選備份／CAS／回滾／附件移除、同步後匯出與明確副本選擇。
- Windows：編譯、未封裝路徑只讀探針；獨立 MSIX identity 寫入與解除安裝，不碰正式套件。
- 手動：配置 Google 後以專用測試帳號端到端；另一裝置收到標記後先匯出再清副本。

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 清空後失去網路／授權 | High | 已保存完整本機資料，續行 upload 不再清空 |
| 其他裝置上傳舊資料 | High | 重設標記、明確要求停止同步、舊副本暫停並人工清除 |
| 更新前外部舊資料 | Medium | 提示匯出／匯入；不自動刪除不確定歸屬的資料 |

## Progress Log

執行結果與剩餘驗收只記 [PROGRESS](../../PROGRESS.md)。

---

*Created: 2026-10-12*
