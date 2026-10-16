# PLAN-008: 工作空間初始化與可續行重設

## Metadata

| Field | Value |
|---|---|
| Status | 核准範圍；完成紀錄見 PROGRESS |
| Owner | 專案維護者 |
| Assigned To | 實作工作階段 |
| Reviewer | 獨立唯讀審閱，結果見 PROGRESS |

## Related Spec

[SPEC-008](../specs/008-workspace-initialization.md)

## Overview

在現有 V1 FileStore 新增 immutable prepare／ready，Workspace 原子暫存與啟用，重設以 durable journal 續行。
本文件記錄實作分界，執行狀態只記在 PROGRESS。

## Implementation Phases

### Phase 1: 控制檔與接收啟用

嚴格定義 workspaceId、世代、需求 digest 與 receipt；完整列舉控制檔後再接資料，接收端核對後原子啟用。
**Deliverables**：來源控制模組、Workspace 與 FileSync、TypeScript 契約。

### Phase 2: 重設／覆蓋與 UI

先持久 journal 再清除，初始化階段只上傳；reset starter 與 restore manifest 分別完成，followers 等待。
恢復被取代 job 的本機副本入口，save ack 遺失時重開 durable writer。
**Deliverables**：reset helper、cloud restore、主畫面等待／續行、五平台 descriptor 支援。

### Phase 3: 回歸、文件與審閱

驗證六台重連、manual 同名、marker-only、missing bytes、存檔／上傳故障、被取代 job、不完整列舉與 restore。
**Deliverables**：相關與完整測試、ADR／操作文件、獨立唯讀審閱紀錄。

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `src/sources/workspace-initialization.js`、`source-reset.js` | Create | 控制檔與 durable reset |
| `src/sources/file-sync.js`、`src/core/workspace.js` | Modify | 準備／等待／啟用交易 |
| `src/backup/cloud-restore.js`、`src/app/main.js` | Modify | 覆蓋 owner、續行與恢復入口 |
| `src/native/`、`contracts/sync.d.ts` | Modify | workspace descriptor、列舉完整性與狀態 |
| `tests/workspace-initialization.test.js` 與同步／原生測試 | Create/Modify | 可觀察行為與故障回歸 |

## Technical Decisions

[ADR-054](../decisions/054-explicit-workspace-initialization.md)：確定性的 bootstrap，可續行的 reset owner，ready 需驗證資料。
保留 ADR-053 身分、來源世代及 V1，不引入鎖、server 或 format migration。

## Testing Strategy

- **Unit / Integration**：MemoryFileStore 的真實頁面、create／save 邊界與重開，使用六個獨立 Workspace。
- **Full checks**：文件記錄的 Node／Python tests、web build、config、docs、diff。
- **Manual**：更新各裝置後，在專用測試帳號重設、另台等待、發起端中斷續行，確認同名手動群組與附件保留。

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 清除中讀到舊資料 | High | 控制檔先讀、marker-only 等待、ready 前不投影 |
| 舊 job 清掉後來資料 | High | marker 世代 guard、initialize 不再清除、被取代 job 本機恢復入口 |
| 半份還原被當完整 | High | 全部 revisions／附件需求與原子啟用 |
| 同時不同意圖 | Medium | planId 衝突停止，保留內容，不選任意第一份 |

## Progress Log

執行結果、限制及獨立審閱統一記於 [PROGRESS](../../PROGRESS.md)，不在此複製任務狀態。

建立：2026-10-17。
