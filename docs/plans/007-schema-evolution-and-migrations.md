# PLAN-007: Schema 演進與 migration 實作

## Metadata

| Field | Value |
|---|---|
| Status | Completed，2026-10-17；執行與未測平台證據見 PROGRESS |
| Owner | 專案維護者 |
| Assigned To | Specialist |
| Reviewer | 獨立審閱結果見 PROGRESS |

## Related Spec

[SPEC-007](../specs/007-schema-evolution-and-migrations.md)。

## Overview

依 [ADR-051](../decisions/051-schema-evolution-and-atomic-migrations.md) 分離本機遷移與不可變雲端格式演進。

## Implementation Phases

1. 共用 schema 登錄、guard、逐版純 runner；Workspace v1→v2 與啟動提交屏障。
2. IndexedDB 與四個原生 host 的原子 recovery／CAS／讀回；重設及完整還原清理。
3. 同步／備份版本 guard、歷史 fixture、故障與混版回歸，文件及獨立審閱。

## Files to Create/Modify

| 範圍 | 用途 |
|---|---|
| src/core、src/app、src/storage | 共用遷移與生產入口 |
| src/native、contracts | 原子提交與 profile 限制 |
| src/sources、src/backup | 格式版本保護 |
| tests | 歷史資料、故障、重試及跨來源備份 |
| docs、PROGRESS.md | 契約、操作與驗證界線 |

## Technical Decisions

原生重用 records 命名空間；IndexedDB 新增 recovery store。Google revision 與備份維持 v1。

## Testing Strategy

執行專案 JS／Python、build、config、文件及 diff 檢查；可用 SDK 上驗證 Windows/Linux 真儲存。
Apple/Android 缺少 SDK 時明確列為未編譯，不將靜態檢查視為原生驗收。

## Risks & Mitigations

| 風險 | 處理 |
|---|---|
| 原始副本增加容量 | 副本獨立記錄，避免 workspace 傳輸膨脹；容量不足回滾 |
| 舊 host 忽略新提交欄位 | 原生 capability 明確宣告，缺少時拒絕遷移 |
| 舊裝置收到未來雲端格式 | 同步先 pull，拒絕未知格式後不 push |
| 已清除內容留在副本 | reset／本機完整還原同交易清除 |
