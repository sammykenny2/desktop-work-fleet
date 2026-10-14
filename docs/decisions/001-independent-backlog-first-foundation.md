# ADR-001: 獨立專案與 backlog 優先的研究基礎

## Status

Accepted，2026-10-03。接受範圍限於使用者已表達的方向及本次 bootstrap，不包含候選技術選型。

## Context

使用者需要多裝置同步的工作便箋，主要作為 backlog 與快速記錄靈感的位置。先前討論擴展到多 Agent 執行管理，使用者澄清那會增加主要操作的負擔。

使用者要求建立獨立新 repo，使用專案骨架範本技能，將研究詳細記錄到 docs/research，並避免大量複製既有應用內容。

## Decision

- Repo 命名 desktop-work-fleet，採小寫與連字號。
- 以獨立架構開始，沒有既有應用格式、UI 或平台模組的移植要求。
- 以 backlog／快速記錄作為產品重心，保留簡單預設與未來檢視彈性。
- 保留 Apple／Google 自有 App 上架目標與跨裝置同步需求。
- 本次採專案骨架範本的 minimal 骨架；研究文件位於 docs/research。
- 不在本次選定 framework、backend、同步協定或實作產品原型。

## Consequences

### Positive

需求有可交接的文字基礎；早期建議與使用者定案明確區隔；可各自驗證 UX、資料可靠性與平台限制。

### Negative

從零建立產品需重新驗證平台、同步與發佈能力，不能引用其他應用的成功結果當作本專案的測試。

### Neutral

Minimal 提供文件與協作模板，沒有應用 runtime。MIT skeleton notices 保留，但未來第三方依賴仍需個別確認。

## Alternatives Considered

### 延續既有應用架構

使用者偏好從新架構開始，故未採用。

### 第一版即建立 Agent 執行工作台

偏離使用者主要的 backlog 與快速記錄用途，延後評估。

### 立即綁定某個 PM backend 或跨平台 framework

缺少 UX、資料可靠性與商店相容性的驗證證據，維持未決。

## References

- [Backlog 需求](../research/2026-10-03-backlog-first-product-requirements.md)
- [獨立架構與驗證](../research/2026-10-03-independent-architecture-and-validation-plan.md)
- [第三方來源](../../THIRD-PARTY-NOTICES.md)
