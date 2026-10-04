# PLAN-002: Google Drive 便箋 1.0.0 與可攜備份

> 2026-10-04：已獲完整五平台 1.0 實作授權；SPEC-003 Q01–Q07 已答覆。
> 同步格式採 SPEC-004／ADR-011，FileStore／Drive provider 採 ADR-012；
> 備份必須包含 checklist、附件、版面、自動與加密備份及三種還原。

## Metadata

| Field | Value |
|---|---|
| Status | 依完整 1.0 授權執行；實際進度只記 PROGRESS |
| Owner | 專案維護者 |
| Assigned To | 未指定 |
| Reviewer | 待獨立審閱 |
| 日期 | 2026-10-03 |

## Related Spec

[SPEC-002：可攜備份與安全還原](../specs/002-portable-backup-and-restore.md)。
普通便箋、Google 登入與 renderer 範圍承接 [MVP 研究](../resreach/2026-10-03-google-drive-notes-mvp-feasibility.md)
及 [ADR-004](../decisions/004-google-drive-notes-mvp.md)，來源傳輸決策採
[ADR-012](../decisions/012-durable-file-store-and-drive-adapter.md)。
本計畫列工作順序和驗收條件；執行狀態只更新 [PROGRESS](../../PROGRESS.md)，不另建完成清單。

## Overview

1.0 的日常流程：登入 Google → 快速新增／編輯便箋 → 在支援的桌面鎖定展示 →
另一裝置同步 → 必要時匯出或匯入備份。
最新產品必須包含 [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md) 的卡片／群組／formation／拖放語意，
互動開發依 [PLAN-003](003-desktop-interaction-implementation.md)。
Editor／checklist／附件及完成／封存已核准；先前純文字與 no-checklist 的裁切不適用。

已採用 appDataFolder + drive.appdata；備份存到使用者指定的本機／OS 文件位置。
首版不為備份額外要求 drive.file 或全 Drive scope，也不加自家便箋 server。
這不會自動提供 Keep／Drive App 編輯器；手機編輯需交付本 App 的手機入口。
目前只規劃一個啟用來源／帳號，不做多 provider 聚合或跨帳號分享。

開發整合先利用已有 AppKit host，便於沿用公開 API／Sandbox 的已有工作；
這是施工順序，**不代表已決定 Mac-only 發佈**。
macOS／iOS／Android 商店、Windows Store 候選、Linux 可測範圍保留；
Windows/macOS/Linux 及 iOS／Android 原生 App 均納入本次 1.0，包含商店提交準備。

## Implementation Phases

### Phase 1：凍結契約與選擇可交付的實作邊界

交付物：

- 發佈平台與最低 OS 清單，對應普通 editor、桌面展示、檔案備份三種能力。
- Card／Group、SourceRef、NoteSource／FileStore、CardViewModel、DeviceLayout／InteractionState、
  LocalStore、BackupService／RestoreJob 的最小公開契約。
- 對 append-only revision file 方案寫出可執行的同步規則：
  noteId、revisionId、operationId、parents、deleted、完整本文；時間戳只供顯示。
- 先確認 SPEC-003 Q02，再凍結備份 v1 Schema、群組引用、golden fixtures、錯誤分類及容量上限。
  舊 SPEC-002 未含完整群組語意，不可直接當成完整格式。
- 記錄 runtime 選型 ADR：目前仍是 prototype 的 Swift／ES modules／Python，
  不能默認 Python server 隨 1.0 發佈。

選型收斂方式：以已確認平台的「商店封裝、原生 OAuth／憑證、可靠本機交易、
背景生命週期、公開桌面 API、程式碼授權」比較原生 host＋共用核心與跨平台框架。
可利用本 repo 可隔離的公開 API host 經驗；不移植外部 UI。
擴充能力／plugin 的 1.0 範圍仍需確認，不因抽象介面就自行加入或排除動態外掛。
框架定案前只凍結格式／契約／測試樣本，避免先造一套之後全部重寫的 bridge。

同步規則需明確處理：

- 初始 cursor／全量分頁／補 changes 的順序，重複回傳及崩潰後 replay；
  本機資料與游標一起提交。
- 單一 parent 的分支、未知 parent、刪除對編輯、衝突決議後晚到的另一分支。
- 新操作內容在送出前持久化；開始傳送後不可修改同一操作的 payload。
- Drive 預產生 file ID 在請求前落盤；成功回應遺失後重試同 ID，
  409 需讀回並核對，不能直接視為成功。
- 遠端檔案不可讀、被清除或格式過新時保留本機資料並停止有損同步；
  不由檔案缺席推論使用者刪除。
- 初版不自動清理版本檔；保存節流、配額退避及成長量列入效能預算。

**出口條件**：可用固定輸入／亂序／重複／中斷測試明確判斷結果；
選型及範圍有紀錄。若跨 client ID 無法共用預期 Drive 空間，先解決產品身分設定，
不偷偷轉成另一套來源。

### Phase 2：本機資料核心與無 Google 的備份往返

交付物：

- 本機交易式 store、每帳號分區、草稿、outbox、單一同步協調者。
- 便箋新增／編輯／軟刪除／恢復及多 head 顯示模型。
- BackupService：快照、ZIP 匯出、完整驗證、預覽、原子本機匯入、RestoreJob 續傳。
- in-memory NoteSource／fake FileStore 及平台無關 fixtures。

**出口條件**：SPEC-002 T01–T03、T05–T06 的本機部分、T08–T12 的可模擬部分通過。
先完成無帳號環境的內容往返，證明備份格式不依賴 Drive；
此開發測試模式不額外承諾 1.0 提供可切換的 Local-only provider。

### Phase 3：Google 登入與兩個 client 的可靠同步

交付物：

- Google OAuth／SDK 設定，系統允許的登入介面，憑證儲存、重連及登出。
- 最小 scope 的 appDataFolder adapter；Google API 直接由 App 呼叫。
- FileNoteSource：版本掃描、增量同步、持久化 ID／重試、衝突及 quota/backoff。
- 兩個獨立 profile／憑證的真實整合證據；跨平台時使用實際平台 client ID。
- 主動刷新、前景同步與適度輪詢；不承諾 mobile background 秒級同步。

**出口條件**：兩邊同時離線改同一便箋後，本文都留下；
回應遺失重試不重複；刪除與編輯衝突保留；撤權／帳號切換不串資料。
使用乾淨測試資料驗證，未取得測試帳號／OAuth 設定時明列外部依賴，
不以 mock 通過冒充 Google 整合完成。

### Phase 4：按 SPEC-003 完成 UI 與平台整合

交付物：

- App 內附帶的 editor 依確認後的內容範圍實作；卡片／群組／formation 與手勢按 SPEC-003，
  不以文字 CRUD 代替完整桌面互動。
- 同步只顯示有用的資訊：已存本機／同步中／需處理；
  詳情才呈現網路錯誤與衝突，不增加 PM／Agent 工作狀態。
- 桌面呈現使用相同 NoteViewModel：共享內容、每機位置／尺寸／顯示集合／突出設定分離，
  預設鎖定，主動解鎖編輯；每個平台用能力回報能提供的桌面層。
- 「資料與備份」完整接上 OS 檔案介面、預覽、匯入進度與恢復工作。
- renderer 不直接連 Drive；host 只暴露有型別的允許命令，
  不允許任意檔案讀寫、遠端 script 或 token 取得。

**出口條件**：一般使用者可完成登入、新增、跨 client 看見、解鎖改字、重新鎖定、
匯出、另一乾淨 profile 匯入的完整流程。
既有 Mac 證據用作設計基礎；本階段不重做原來的探索性 probe 專案。
正式產品變更後，在發佈階段才跑對應實際功能的必要回歸。

### Phase 5：已選平台的 1.0 發佈準備

交付物：

- 確認平台的安裝包、正式身分／簽章、更新與實際檔案選擇流程。
- macOS／iOS／Android 的商店材料與隱私說明；Windows 按 Store 方案可行性處理；
  Linux 發佈僅承諾實測 distro／compositor，其他環境提供明確的普通視窗降級。
- 最終依賴／轉遞依賴 license inventory、notices、Google 設定與審查所需操作說明。
- 對最終封裝執行資料往返、真實登入、跨裝置與桌面行為的發佈回歸。
- 文件依最終核准的備份／還原範圍說明，未批准的排除清單不能當作產品定案。

**出口條件**：選定平台各自有可重現產物與驗收證據；
未選／未完成平台沒有宣稱支援。實際上架核准仍以商店結果為準。
本計畫本身不執行提交、購買憑證、建立帳號或發佈 release。

## Files to Create/Modify

以下為實作階段預計的邏輯位置，副檔名依 Phase 1 runtime 決策；
不是本輪已建立的模組。

| 位置 | 變更 | 用途 |
|---|---|---|
| contracts/notes/、contracts/backup/ | 新增 | Schema、版本規則與測試樣本 |
| src/core/ | 新增 | 便箋、草稿、快照、還原計畫、同步協調 |
| src/sources/ | 新增 | NoteSource、FileNoteSource、Drive adapter |
| src/macos/ | 調整 | 改接核心／Google 登入／原生檔案操作 |
| src/web/ | 調整或逐步替換 | bundled editor 與 ViewModel／命令邊界 |
| tests/backup/、tests/sync/ | 新增 | 格式往返、故障注入、跨帳號與同步契約 |
| scripts/testing/ | 增補 | 隔離資料的整合與封裝驗收入口 |
| docs/ | 更新 | 最終格式、操作、測試、隱私與發佈說明 |

src/server 的 0.1.0 驗證用途保留；不把其 token／epoch／Python 服務沿用為 Drive 正式架構。
新版本未通過替代驗收前，不刪除舊驗證紀錄或抹掉已知問題。
舊 SQLite 的直接遷移不默認包含在 1.0；需要遷移時另寫轉換器，不能直接換副檔名冒充 ZIP 備份。

## Technical Decisions

- appDataFolder 為本次規劃基線；一般 Drive 資料夾由未來獨立 provider 模式處理。
- ZIP＋公開 JSON、來源無關 BackupService、增量匯入模式見 [ADR-005](../decisions/005-portable-backup-and-restore.md)。
- append-only revision 的格式與 pending／heads 規則採 [SPEC-004](../specs/004-revision-graph-and-file-sync.md)／
  [ADR-011](../decisions/011-immutable-revision-graph.md)；真實 Google 與 transaction 整合另驗收。
- 結構化 PM、團隊權限、QR 配對、自架 server、跨來源聚合保留未來路線。
- 不以一個共用備份 ZIP 作為多機即時同步檔案；備份與同步各有自己的契約。

## Testing Strategy

依 SPEC-002 的 T01–T12 建立真正驗證使用者資料不遺失的測試：
schema fixtures／內容 round-trip → 交易與當機點 → fake transport 亂序和回應遺失 →
真實 Drive 雙 client → 各發佈平台檔案操作與已封裝 App。
另測跨帳號切換、兩裝置同時匯入的明確界線、quota／撤權及新 schema 保護。

原 prototype 測試保留其適用範圍；Windows 舊 restore 的 fsync 失敗仍見 PROGRESS。
新備份規格不沿用該失敗路徑當作已驗證實作。
本輪為文件變更，只執行 Markdown／連結／格式檢查，不宣稱上述產品測試已執行。
作者檢查不算獨立審閱；實作交付時依 repo 規則安排獨立審閱。

## Risks & Mitigations

| 風險 | 處理 |
|---|---|
| 未確認平台就綁死框架 | Phase 1 先確認 release set／選型；檔案與語意契約先獨立 |
| 備份被誤認成所有裝置的最新狀態 | UI／manifest 保留 snapshotAt 與同步範圍 |
| 還原中斷、其他裝置繼續修改 | 新 ID、持久化 job、正常 outbox、不覆蓋既有 note |
| 備份漏掉使用者尚未保存文字 | 匯出前 flush drafts，多 editor 失敗即中止 |
| Drive 版本檔無限成長 | 本機合併未送草稿、明確保存節流、量測成長；壓縮協定另案 |
| 誤以為 AppData 隱藏就不用檔案防護 | ZIP 白名單、容量限制、完整驗證後才交易寫入 |
| 商店／SDK 授權晚發現阻礙 | Phase 1 選型查證，Phase 3 真實身分整合，Phase 5 稽核產物 |

## Progress Log

規劃建立於 2026-10-03，2026-10-04 對齊 SPEC-003／PLAN-003。
下文仍保留新增式匯入等技術提案，並不表示已批准唯一還原模式。
後續狀態與實際檢查結果統一記錄於根目錄 PROGRESS.md。
