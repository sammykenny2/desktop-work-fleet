# 驗證版 macOS 接手計畫

更新：2026-10-03。
狀態：Ready for macOS execution；尚未開始產品程式實作。
目標：交付可以驗證先前擔心項目的版本。

本文件安排同一個目標在 macOS 上繼續工作的順序，不把文件交接當作產品交付完成。

## 1. 接手時的權威現況

- Repository：sammykenny2/desktop-work-fleet，GitHub private repo，預設分支 main。
- 已完成：minimal bootstrap、六份研究、需求演進、初始決策、來源及授權聲明。
- 原始基線：12acae6；本文件及索引更新會有後續提交，以實際 HEAD 為準。
- 尚無產品 App、server、dependency lockfile、正式技術選型或平台探針。
- Windows 端確認可用 Node 24.21.0、pnpm 12.4.2、Rust 1.99.0。這些是當時環境資料，不是對 Mac 的版本要求。
- Windows 端讀取了 upgrade-project 技能與 vite-react flavor，尚未執行 updater，也未安裝依賴。
- 未修改 bootstrap 來源、未複製其他 sticky-note 應用內容。
- 使用者已同意切到 Mac 繼續，要求提供可直接使用的 goal 描述。
- 使用者已明確授權目前工作直接 commit/push main；不要另建 PR 或 feature branch。
- 執行進度以根目錄 PROGRESS.md 為準。

## 2. 開始前讀取

1. AGENTS.md、目前 Agent 自己的指引檔、docs/AGENT-GUIDE.md。
2. docs/README.md、PROGRESS.md、docs/decisions/001-independent-backlog-first-foundation.md。
3. docs/resreach/2026-10-03-backlog-first-product-requirements.md。
4. docs/resreach/2026-10-03-source-of-truth-sync-and-conflict-analysis.md。
5. docs/resreach/2026-10-03-macos-public-api-desktop-feasibility.md。
6. docs/resreach/2026-10-03-store-distribution-and-license-analysis.md。
7. 其他研究與架構候選依當前工作再讀。

先確認本機與遠端 HEAD、工作目錄變更、Xcode／Command Line Tools、可用 SDK 與簽章方式。保留使用者已有工作，不假設可以覆寫。

不需要再次詢問是否可以開始實作；目前目標已要求交付驗證版。

## 3. 產品重心

使用者把便箋當 backlog，主要看未完成事項，並希望有靈感時快速記錄。預設操作保持簡單：文字、待辦與 Todo／In Progress／Done。不要把 Agent 執行狀態、分派、排程、估點或負責人變成必填流程。

每台機器可顯示共同的多張便箋，突出本機相關內容。桌面平常唯讀且滑鼠穿透，必要時能主動解鎖、就地編輯與重新鎖定。Web／手機另有編輯入口。

機器與 Agent 是使用情境，不應支配第一版資訊架構。

## 4. 建議實作順序

### A. 先排除 macOS 平台風險

在新 repo 建立小型獨立 AppKit 探針，先使用實色卡片，只使用公開 API，啟用 App Sandbox。

需要有：
- 一個始終可達的控制／解鎖入口。
- 桌面附近的展示視窗，忽略滑鼠且鎖定時不成為 key window。
- 普通視窗、圖示上方、圖示下方的可比較展示模式。
- 可更新的資料，不只是一張固定文字圖片。
- Unlock／edit／lock 後恢復輸入與焦點政策。
- 可記錄設定與結果的診斷輸出，不洩漏 token 或私人筆記。

先建置、實際啟動、驗證至少「收資料、唯讀呈現、滑鼠穿透、不搶焦點」。再測完整的 Spaces／Show Desktop／多螢幕／休眠矩陣。

桌布層若失敗，記錄具體失敗與可行的桌面層；不要為求成功而加入 private API。單獨 AppKit 成功不等於 Tauri 整合成功。

### B. 交付可保存與同步的 backlog

採最小可運作設計，支援便箋、文字／待辦、快速新增、編輯、簡單狀態、完成／還原及共同資料呈現。

先前提出的實作首選為 React＋TypeScript、Rust＋Axum、server 本機 SQLite；Tauri 2 是共用 App 外殼的候選。這些還沒有寫成 Accepted 技術決策。可基於現場證據採用，並把理由、版本與授權記進 ADR。

使用一份權威資料來源。實作跨裝置條件式更新、持久化、重試去重、刪除語意、可靠草稿、離線閱讀與可重現的備份／恢復。不能只做瀏覽器 localStorage 的互不相通 demo。

若使用 local server，加入可撤銷的裝置存取與短效一次性 QR 配對；QR 不能包含永久管理員密鑰。區域網路與外網可達性分別說明。

### C. 串成真的垂直流程

手機或第二個瀏覽器記錄 → server 保存 → macOS 卡片更新 → 解鎖編輯 → 其他 client 更新。

桌面收到資料不能搶走正在使用的 App 的焦點；lock 是防誤觸模式，不是跨裝置資料鎖。

### D. 補足其餘疑慮的驗證途徑

Windows、Linux、iOS、Android 的原始平台目標仍保留。提供對應的建置／封裝檢查、測試步驟與結果欄位；依能取得的環境執行，不能把 Mac 的結果推廣到其他 OS。

Windows 優先評估 Store MSIX，使用者未計畫購買商業簽章憑證。Linux 明列 distro／CPU／桌面或 compositor，不宣稱全面相容。Apple／Google 商店目標保留；試驗版與正式送審分開。

## 5. 完成審查需要的證據

| 疑慮 | 要取得的證據 |
|---|---|
| 快速記錄會不會變繁瑣 | 可操作的新增、整理與回顧流程；沒有多餘必填欄位 |
| 是否只是假展示 | 真實資料來源更新到展示端的完整操作結果 |
| 兩台同改會不會覆蓋 | 可重現的競爭寫入測試，敗方草稿可取回 |
| 回應遺失後重試是否重複建立 | 相同操作重試後只存在一筆資料 |
| 刪除／離線裝置重連是否復活 | Tombstone／衝突或等效設計的行為測試 |
| 持久化與恢復是否可靠 | 重啟保留內容，備份還原後不讓舊 client 靜默蓋回 |
| 權限與配對是否有效 | 短效／一次性邀請、唯讀限制、撤銷後拒絕存取 |
| macOS 是否真的滑鼠穿透 | 真實桌面上的點擊、框選、拖拉與焦點觀察 |
| 更新是否搶焦點 | 在其他 App 輸入時更新卡片的測試 |
| 是否不用 private API | 原始碼、依賴 feature、發佈設定與建置產物的檢查 |
| Sandbox 是否有效 | 實際 entitlements、sandbox 啟動與網路測試 |
| 平台差異是否被掩蓋 | OS／版本／硬體／桌面環境與每項結果明列 |
| 授權是否可交付 | 固定依賴版本、完整授權盤點、必要 notices 與來源 |
| 其他人能否重現 | 乾淨 checkout 的命令、可啟動產物、測試步驟與結果記錄 |

「尚未測」「失敗」「不支援」都要明列，不得自動改成 pass。建置成功不能證明桌面層、手勢穿透或商店核准。

目標是交付能驗證疑慮的版本，不是承諾所有實驗結果必定成功。必要能力若做不到，要交付可重現證據與可行替代，不能以刪除驗收項目宣稱完成。

## 6. 授權與工作邊界

- 不大量複製其他應用的程式碼、UI 或資產；沿用一般技術概念不等於沿用實作。
- 新增依賴先確認 license，並檢查最終實際依賴樹，不只 root LICENSE。
- 不使用 macOS private API 來避開平台驗證失敗。
- 不自動購買憑證、建立商店帳號或提交正式商店審查。
- App 的本機資料與簽章祕密放 repo 外；不要讀寫其他應用的真實資料。
- 適當測試與獨立 review 後，依已授權流程直接 commit/push main。
- 不把文件交接、單一綠燈或無法涵蓋需求的測試當作整個目標完成。

## 7. 可直接貼上的 goal 描述

> 在 private repo sammykenny2/desktop-work-fleet 中，延續目標「交付可以驗證先前擔心項目的版本」。先讀 AGENTS.md、docs/README.md、PROGRESS.md 與 docs/plans/001-validation-version-macos-handoff.md，依當前 Git 狀態開始實作，不停留在規劃。
>
> 產品以便箋式 backlog 與快速記錄為核心，保持 Todo／In Progress／Done 的簡單體驗。先在這台 Mac 建置並實際執行只用公開 API、啟用 App Sandbox 的桌面展示探針，驗證接收資料、唯讀、滑鼠穿透、不搶焦點與解鎖編輯；再串接可保存的便箋編輯介面及真實同步來源，驗證多裝置同改、斷線／重試、草稿保留、刪除、備份恢復與裝置權限／QR 配對。
>
> 保留 Windows／Linux 桌面與 Apple／Google 自有 App 上架方向，逐項提供可執行的驗證方式與平台結果；不可把單一平台的建置成功當成全部功能通過。依賴須先確認授權，不搬入舊應用大量程式碼或資產，不使用 private API，不引入 Agent 排程或複雜狀態作為預設 UI。
>
> 持續做到可重現建置、可操作驗證、具備測試與結果報告的版本，將已驗證、失敗、尚未測與剩餘工作分開記錄。直接 commit/push 到 main，不建立 feature branch 或 PR。尚未有實際證據支持的項目，不得宣稱目標完成。

## References

- [研究索引](../resreach/README.md)
- [最新需求](../resreach/2026-10-03-backlog-first-product-requirements.md)
- [專案進度](../../PROGRESS.md)
