# SPEC-008: 工作空間初始化與重設完成證明

## Metadata

| Field | Value |
|---|---|
| Status | Approved；實作與驗證見 PROGRESS |
| Owner | 專案維護者 |
| Reviewer | 獨立唯讀審閱，結果見 PROGRESS |

## Summary

Google appData 明確記錄本輪工作空間準備與完成狀態，區分全新帳號、清除中、已初始化空白及備份覆蓋；
同名群組的使用者意圖以實體 ID 保留。使用者已核准實作，沿用 V1。

## Goals

- 六台重設後重連只收到發起端準備的一份邏輯初始群組。
- 全新帳號多台同時登入仍可重播，初始化者中斷後可由另一台完成相同計畫。
- 重設與覆蓋安全續行；完成前不發布部分遠端圖或誤報同步成功。

## Non-Goals

自動合併既有同名群組、版本升級／migration、自家協調 server、跨裝置全域鎖及舊版 App 遠端強制更新。

## User Stories

使用者重設後，其餘裝置只需清除本機副本並同步；刻意另建「我的便箋」仍是一個獨立群組。
網路或程序中斷後，發起端可續行原工作，而不把已還原內容再次清空。

## Requirements

### Functional Requirements

1. I01：prepare／ready 綁定來源與 reset 世代，ready 引用精確 planId；不同 plan 保留資料並停止。
2. I02：新帳號 starter 計畫確定且可由任一新版裝置完成，手動群組與預設組身分獨立。
3. I03：新重設由原發起端清空並完成初始化；followers 在 marker-only／prepare 狀態等待，不上傳、不建立預設組。
4. I04：接收完整 required bytes／附件並驗證後，才原子啟用圖與版面；ready 本身不代表已收齊資料。
5. I05：journal 先於 marker、刪除與上傳持久保存；同 ID 重試驗證 bytes，不於 initialize／upload 階段再次清除。
6. I06：新一輪重設取代舊 job 時，舊 job 不建立 marker 或刪除後來資料；提供匯出及清除本機副本入口。
7. I07：restore manifest 含全部 portable revisions 與歷史附件，可保留合法 pending 歷史；完整上傳前不得 ready。
8. I08：existing 宣告保留既有資料；已初始化且空白不補建群組。無 control 的既有 V1 資料先完整掃描再宣告。
9. I09：列舉 incomplete／跨帳號／無效 manifest 在刪除或發布完成前停止；等待不更新成功同步時間。

### Non-Functional Requirements

- **Integrity**：控制檔 8 MiB 上限、嚴格欄位、排序唯一需求；現行格式皆 V1。
- **Security**：憑證留在原生服務；無新 bridge 任意 HTTP 權限。
- **Recovery**：失去 save／upload 回應及重開均可續行；保留未上傳內容與舊裝置副本。

## Design Overview

流程為 journal → reset marker → 完整清空 → prepare → required bytes → ready → 接收端核對並啟用。
全新帳號省略破壞性清空；existing 使用空需求宣告。細節見 ADR-054 與 contracts/sync.d.ts。

## Dependencies

SPEC-004 FileStore／版本圖、SPEC-002 備份、ADR-053 來源世代、各平台現有原生 Google 服務。

## Open Questions

無本輪實作所需的待決問題；真 Google／六台原生實機驗收另依環境執行。

## References

- [ADR-054](../decisions/054-explicit-workspace-initialization.md)
- [PLAN-008](../plans/008-workspace-initialization.md)
- [SPEC-004](004-revision-graph-and-file-sync.md)

建立：2026-10-17。執行狀態以 [PROGRESS](../../PROGRESS.md) 為準。
