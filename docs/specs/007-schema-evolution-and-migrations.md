# SPEC-007: 測試階段 V1 資料政策

## Metadata

| Field | Value |
|---|---|
| Status | Implemented，2026-10-17 修訂 |
| Owner | 專案維護者 |
| Reviewer | 獨立審閱結果見 PROGRESS |

## Summary

正式商店上架規劃前，現行便箋、同步與備份 JSON schema 全部維持 V1，欄位直接調整 V1。

## Requirements

- Workspace、Layout、revision、Drive metadata、ZIP manifest、加密 envelope 與自動備份 journal 都標示 V1。
- 保留版本常數、基本格式辨識與未知格式拒絕；不把目前的欄位變更視為開始升版。
- 載入與日常編輯不增加 schema 升級提交、migration 副本或額外原生 API。
- 保留正常 CAS、草稿、歷史、附件、帳號隔離與既有備份／還原；不自動刪除使用者資料。
- 正式規劃 Windows Store、Apple App Store 或 Google Play 上架時，再評估格式凍結與 migration。

## Design Overview

`core/schema.js` 只集中目前 V1 常數與基本版本驗證；現有 Workspace 直接載入、以一般交易保存。
本機與 Google 仍使用相同 V1 備份格式。SQLite 內部表版本與 App 套件版號不屬於這次公開 schema 政策調整。

## References

[ADR-051](../decisions/051-schema-evolution-and-atomic-migrations.md)、[PLAN-007](../plans/007-schema-evolution-and-migrations.md)、[PROGRESS](../../PROGRESS.md)。
