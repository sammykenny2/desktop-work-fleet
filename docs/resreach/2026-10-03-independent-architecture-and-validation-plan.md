# 獨立架構方向與分階段驗證研究

- 日期：2026-10-03
- 狀態：候選架構與後續工作建議；本次授權範圍只有新 repo bootstrap 與研究文件。
- 已確定：名稱 desktop-work-fleet、獨立開發、backlog／快速記錄優先。
- 未確定：程式語言、UI framework、資料服務、同步方式、正式 repository 子目錄與平台最低版本。

## 1. 新專案的邊界

建立新 repo 的目的，是讓產品概念與架構從目前需求出發。歷史專案的視窗 label、事件名稱、插件機制、筆記 JSON、排程器及 UI 結構都不是本專案的相容性要求。

本次唯一 scaffold 來源為 project-bootstrap minimal。它提供協作與文件慣例，不提供產品 runtime，也不代表採用了 A2A、MCP 或多 Agent 排程。

「獨立實作」不是宣稱已進行法律意義的 clean-room 隔離；本次有參考公開文件與前期技術觀察，沒有大量搬入其他應用的來源內容。

## 2. 候選責任分界

| 部分 | 負責 | 不必綁定的選擇 |
|---|---|---|
| 工作內容 | 便箋、文字、待辦與完成狀態 | 桌面視窗 API |
| 保存與同步 | 修訂、草稿、衝突、備份、裝置授權 | 特定便箋排版 |
| 檢視 | 篩選、分組、排序與收合 | 每個畫面一份資料 |
| 客戶端 | 快速捕捉、編輯、讀取與同步提示 | 統一採單一 UI framework |
| 平台展示 | 桌面層、輸入穿透、焦點與裝置版面 | Project 或 Agent 生命週期 |
| 選用整合 | 外部 PM、程式碼連結或 Agent 回報 | 第一版必須存在 |

這種分界是研究建議。初期可以在一個簡單程式中完成，不需要立刻拆成多服務或套件。

## 3. 框架選擇的順序

先確認必要體驗及平台限制，再選框架：

1. 使用者是否能順手記錄並回顧 backlog。
2. 資料能否在失敗與多裝置競爭時被可靠保存。
3. macOS 公開 API／sandbox 的最低桌面展示能力。
4. Windows 封裝與桌面互動，以及 Linux 可測範圍。
5. 手機原生商店客戶端的編輯與配對體驗。
6. 再比較 Tauri、原生 AppKit／SwiftUI、其他跨平台框架或混合方案。

AppKit 探針不等於決定全部平台用原生 UI；瀏覽器原型也不等於決定正式 App 只是網站容器。

## 4. 建議的驗證批次

### V-01：記錄與回顧原型

用簡單 Web 或其他低成本原型，測幾張真實便箋、快速新增、完成、還原與可選的進行中標記。

驗收焦點：不分類也能先記、知道歸屬時能直接記、隔天能找到未完成事項。先不加入 Agent session、排程或大量 PM 欄位。

### V-02：資料與衝突 spike

使用同一份原型資料測兩個 client，涵蓋同改、離線、刪除、重試與儲存失敗。至少比較一個服務式候選；若檔案式仍有吸引力，以同一測試集比較。

產出是選型證據與失敗行為，不是只證明「資料有同步過一次」。

### V-03：macOS 公開 API spike

在此 repo 的獨立實驗範圍實作最小 AppKit／sandbox 展示。使用實色卡片，測接收更新、唯讀、滑鼠穿透與焦點保持。

桌面圖示上方與圖示下方分別記錄。完整場景見 [macOS 研究](2026-10-03-macos-public-api-desktop-feasibility.md)。

V-01 與 V-03 可分別推進；哪一項先實作由下一個開發任務決定。本次沒有代替使用者啟動任何實作。

### V-04：選定棧的垂直切片

在選型後串起：手機或 Web 新增一項 → 寫入權威資料 → 桌面接收 → 使用者勾選完成 → 其他裝置更新。

同時驗證儲存失敗與草稿保留，再擴充外觀與進階整理功能。

### V-05：發佈途徑驗證

分別準備 Apple sandbox／簽章、Android AAB／測試條件、Windows MSIX 與 Linux 一個具體組合。

要記錄安裝、更新與移除；商店接受套件和特殊桌面能力通過是兩項結果。

## 5. 本階段明確延後

- Agent 自動派工、遠端 shell、執行管理與儀表板狀態機。
- 即時多人游標、完整富文字共同編輯。
- 任意下載外掛或腳本。
- 多個 PM provider 的全面雙向同步。
- 完整 Jira／ClickUp 類型的流程設定與報表。
- 所有 Linux distro／compositor 一次支援。
- 未確認來源的 UI／程式碼／資產搬移。

延後不等於永久禁止；加入前應有明確使用情境與獨立評估。

## 6. 主要未決問題

| 問題 | 建議由哪項證據解答 |
|---|---|
| 自由筆記與待辦的關係 | V-01 的輸入與整理操作 |
| 固定便箋與篩選便箋是否共存 | V-01 的可理解性 |
| 自架或檔案式權威來源 | V-02 的成本與可靠性 |
| 是否要求完整離線編輯 | 實際移動情境與 V-02 |
| 是否採特定跨平台框架 | V-03 與各平台切片 |
| Windows 不買憑證能否達成目標 | V-05 的 MSIX 與桌面測試 |
| Linux 初期支援範圍 | 可取得硬體與 compositor 的實測 |
| 是否需要外部 PM 服務 | 用 backlog UX 評估，而非先預設必須有 |

## 7. 文件與證據維護

- 使用者需求：[Backlog 研究](2026-10-03-backlog-first-product-requirements.md)。
- 已接受的專案邊界：[ADR-001](../decisions/001-independent-backlog-first-foundation.md)。
- 執行狀態：根目錄 [PROGRESS.md](../../PROGRESS.md)。
- 後續研究：繼續放 docs/resreach，採 YYYY-MM-DD-topic.md。
- 研究標示來源日期、事實／推論／候選／已驗證，不能把候選建議升格為使用者決策。
- 平台與同步探針完成後，要新增結果與限制，不覆寫過去未驗證的歷史成已驗證。

## 8. 本次 bootstrap 來源

- 來源：sammykenny2/project-bootstrap。
- 來源版本：a7438cf81d44519db89d2783dc14b7cfc9e0e851。
- 技能：skills/bootstrap-project/SKILL.md。
- 生成器：scripts/windows/Initialize-Project.ps1。
- 選擇：Preset minimal，base only，沒有附加 flavor。
- 沒有安裝 application dependencies、啟動服務或發布商店。
- GitHub remote 與遠端 repo 建立不包含在本次本機 bootstrap。
- docs/resreach 使用使用者指定拼字；bootstrap 的 docs/research 僅作轉址索引。

來源見 [第三方聲明](../../THIRD-PARTY-NOTICES.md)。本次驗證範圍與實際命令以 [testing.md](../testing.md) 為準。
