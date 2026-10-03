# 研究索引

更新：2026-10-03。目錄拼字 `resreach` 依使用者指定保留。

## 建議閱讀順序

1. [Backlog 優先的需求與演進](2026-10-03-backlog-first-product-requirements.md)
2. [主流輕量 PM 與檢視模型](2026-10-03-lightweight-project-management-and-view-model.md)
3. [Source of truth、同步與衝突](2026-10-03-source-of-truth-sync-and-conflict-analysis.md)
4. [macOS 公開 API 桌面展示](2026-10-03-macos-public-api-desktop-feasibility.md)
5. [商店發佈、Linux 範圍與授權](2026-10-03-store-distribution-and-license-analysis.md)
6. [獨立架構與驗證計畫](2026-10-03-independent-architecture-and-validation-plan.md)

## 驗證版之後的設計

最新方向是 [Google Drive 便箋 MVP](2026-10-03-google-drive-notes-mvp-feasibility.md)：
1.0 以 Google 帳號＋file based 便箋起步，不架 local server，保留來源與 renderer 抽象。
Keep 的官方 API 限制、Drive 儲存選擇、衝突及登入／上架工作均有來源依據。

[完整產品架構草案](2026-10-03-product-architecture-blueprint.md) 與 ADR-003 已標為 Deferred，
保留未來 PM／自架 server 的設計。0.1.0 現況另見架構入口與驗證報告。

[AppData 備份與還原設計](2026-10-03-appdata-backup-and-restore-design.md) 補上官方檔案能力、
來源無關格式、離線快照界線與安全匯入語意，並連到 SPEC-002／PLAN-002。

## 如何解讀

- **使用者需求**：對話中已明確表達的意圖與限制。
- **外部證據**：官方文件或本機來源的可核實資訊，附查閱日期。
- **推論／候選**：研究建議；不代表使用者已採納或已選型。
- **未驗證**：尚未做實機、整合、同步或商店驗證。
- **已完成**：只用於實際執行並有結果的工作，詳見 [PROGRESS](../../PROGRESS.md)。

最新產品重心是快速記錄與看未完成事項。Agent 執行管理、更多狀態與 GitHub Projects 作權威來源都只是曾討論的候選，不得當作已決定需求。

## 文件慣例

- 檔名：YYYY-MM-DD-topic-in-kebab-case.md。
- 日期是實際研究／整理日期，不沿用使用者舉例的日期。
- 來源連結放在支持的結論附近；重新查閱時註明日期與變更。
- 不複製其他產品的大量文件、程式碼或資產。
- 使用相對路徑，避免寫入個人機器的絕對路徑。
- 研究與決策分開；Accepted 決策放 [decisions](../decisions/README.md)。
