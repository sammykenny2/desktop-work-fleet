# ADR-051: 上架前測試階段維持 V1

## Status

Accepted，2026-10-17 修訂。維護者要求撤回本輪 V1→V2 與自動 migration；本修訂取代同日先前的升版決策。

## Context

目前尚未提供他人測試，為尚未交付的測試格式建立逐版升級、副本與相容維護會增加開發負擔。
維護者確認先直接調整 V1，等規劃 Windows Store、Apple App Store、Google Play 上架時再評估升版。

## Decision

- 現行 Workspace、Layout、共享 revision、Drive metadata、備份／加密封裝與自動備份 journal 的 JSON schema 全部維持 V1。
- 共用版本常數與基本格式驗證保留；新增或修改欄位直接更新目前的 V1 契約與相關測試。
- 撤回本輪逐版 runner、Workspace.open 升級屏障、migration 副本、IndexedDB 額外 store、原生 migration capability／API 與專用驗收腳本。
- 維持一般 CAS 交易、草稿、不可變歷史、附件、帳號隔離與既有 ZIP 備份；不重設或清理使用者資料。
- 既有載入預設與版面正規化留在 V1，不產生獨立升級交易。SQLite 既有內部結構版本不因公開 JSON schema 名稱改變而重設。
- 正式上架規劃開始時再決定資料契約凍結、相容範圍及 migration；測試階段不先做這項工程。

## Consequences

### Positive

- 測試期間沒有額外 schema 升級、快照容量或跨測試版本相容維護。
- 基本格式辨識與正常資料保存仍有驗證。

### Negative

- 不承諾尚未交付測試格式間的長期相容。

### Neutral

- App 套件版本與資料 schema 分開；本次不變更套件版號、既有 tag 或 release。

## Alternatives Considered

先前的 V1→V2 與完整 migration 機制：依維護者明確要求撤回，延至正式上架規劃再評估。

## References

- [SPEC-007](../specs/007-schema-evolution-and-migrations.md)、[PLAN-007](../plans/007-schema-evolution-and-migrations.md)
- [需求](../requirements.md)、[AGENTS](../../AGENTS.md)、[PROGRESS](../../PROGRESS.md)
