# SPEC-001: Backlog 驗證版

## Metadata

| Field | Value |
|---|---|
| Status | Implemented with validation limits |
| Owner | Project maintainer |
| Reviewer | Independent review recorded in validation report |

## Summary

以快速文字記錄、Todo／In Progress／Done 驗證持久化與共同資料，
並以真實 macOS Sandbox App 驗證公開 API 桌面展示。

## Goals

- 只輸入文字即可保存；預設 Inbox，支援待辦勾選、完成／還原與刪除／還原。
- 手機或第二個瀏覽器與原生 Mac 使用同一 SQLite 權威服務。
- revision、operation、epoch 保護競爭、重試與恢復；無靜默自動覆蓋。
- 草稿先本機保存，再傳送；409／網路失敗可取回或另存。
- 桌面展示鎖定時不接受輸入，仍持續更新；選單列入口隨時解鎖／重鎖。
- 短效一次性配對、唯讀權限、裝置撤銷、可重現備份／恢復。

## Non-Goals

本次不引入 Agent 排程、估點與分派，不宣稱跨平台桌面或商店核准。

## Requirements

接手計畫的每項疑慮都須在驗證報告保留結果列，標明通過、失敗／阻礙或尚未測。
資料與簽章祕密在 repo 外；不以真實私人筆記做測試。

## Design Overview

原生 AppKit 展示 + WebKit 編輯，HTML/ES modules 共用 editor，Python/SQLite 權威 API。

## Dependencies

系統 AppKit/Foundation/WebKit/CoreImage、Python 標準庫 SQLite；無新增第三方 runtime 套件。

## Open Questions

- 真實手機與 LAN TLS 的 UX、可達性及 iOS local network 行為。
- Spaces／Show Desktop／多螢幕與手勢穿透的人工觀察。
- 每機內容突出、多個獨立桌面便箋視窗及更大資料量的呈現。

## References

- [Plan](../plans/001-validation-version-macos-handoff.md)
- [ADR-002](../decisions/002-validation-runtime.md)
- [驗證報告](../validation/2026-10-03-validation-report.md)
