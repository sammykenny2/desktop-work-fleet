# 研究索引

更新：2026-10-15。目錄拼字 `resreach` 依使用者指定保留。

## 最新設計：優先閱讀

- [公開 Release feed 與公司出口 IP 配額](2026-10-15-public-release-feed-without-api-quota.md)：官方未驗證 REST API 配額、同機實測與三平台改讀 Atom 的決策界線。
- [主視窗位置、啟動行為與 App 更新參考](2026-10-14-desktop-window-startup-and-update-reference.md)：Electron 參考專案的行為與設計教訓、本專案現況；建議見 ADR-043／044。
- [macOS 登入項目首次註冊](2026-10-15-macos-login-item-first-registration.md)：`notFound` 不能作為停用註冊或判斷 App 安裝位置的依據，正式 host 回歸與沙盒實測界線。
- [桌面卡片需求演進](2026-10-04-desktop-card-interaction-design.md)：使用者確認、補充與失效方案。
- [跨平台互動可行性](2026-10-04-desktop-interaction-platform-feasibility.md)：Win／Mac／labwc 的能力、證據及 renderer 限制。
- [桌面分層成果接續](2026-10-05-desktop-layer-reference-follow-through.md)：已核對的參考原生成果、Pi 修正與本產品驗證分界。
- [Apple 簽章與本機腳本啟動](2026-10-05-apple-signed-startup-and-local-scripts.md)：Keychain entitlement、module 載入失敗與真原生 host 啟動驗證。
- [Windows 原生保存與 WebView](2026-10-04-windows-native-storage-and-webview.md)：官方安全邊界、SQLite／DPAPI 與真 UI probe 範圍。
- [Windows 透明場景與輸入](2026-10-04-windows-composition-and-input.md)：composition、跨程序命中、region 遮擋、快捷鍵／DPI 及 targeting-pack 授權。
- [Windows 快捷鍵與系統匣](2026-10-04-windows-shortcuts-and-tray.md)：foreground 條件、公開 shell icon API 與實體輸入驗收界線。
- 開發規範見 [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)，
  入口見 [交接文件](../handoff/2026-10-04-desktop-interaction-handoff.md)。

## 2026-10-03 歷史研究閱讀順序

1. [Backlog 優先的需求與演進](2026-10-03-backlog-first-product-requirements.md)
2. [主流輕量 PM 與檢視模型](2026-10-03-lightweight-project-management-and-view-model.md)
3. [Source of truth、同步與衝突](2026-10-03-source-of-truth-sync-and-conflict-analysis.md)
4. [macOS 公開 API 桌面展示](2026-10-03-macos-public-api-desktop-feasibility.md)
5. [商店發佈、Linux 範圍與授權](2026-10-03-store-distribution-and-license-analysis.md)
6. [獨立架構與驗證計畫](2026-10-03-independent-architecture-and-validation-plan.md)

## 驗證版之後的設計

來源方向保留 [Google Drive 便箋 MVP](2026-10-03-google-drive-notes-mvp-feasibility.md)：
1.0 以 Google 帳號＋file based 便箋起步，不架 local server，保留來源與 renderer 抽象。
Keep 的官方 API 限制、Drive 儲存選擇、衝突及登入／上架工作均有來源依據。

[完整產品架構草案](2026-10-03-product-architecture-blueprint.md) 與 ADR-003 已標為 Deferred，
保留未來 PM／自架 server 的設計。0.1.0 現況另見架構入口與驗證報告。

[AppData 備份與還原設計](2026-10-03-appdata-backup-and-restore-design.md) 補上官方檔案能力、
來源無關格式、離線快照界線與安全匯入語意，並連到 SPEC-002／PLAN-002。

[Drive 檔案傳輸](2026-10-04-drive-file-transport.md) 核對 appDataFolder、分頁、預產生 ID、
resumable 與完整性；決策見 ADR-012，沒有以 scripted transport 當成真 Google 證據。

[備份容器與加密](2026-10-04-backup-container-and-encryption.md) 核對 ZIP、DEFLATE、WebCrypto、
KDF 及依賴；完整範圍及三種還原見 SPEC-002／ADR-013，不再沿用早期格式排除。

[自動備份檔案安全](2026-10-04-automatic-backup-file-safety.md) 記錄 FSA locator／換檔競爭，
區分 scheduler／真 IDB 證據與待實作的原生檔案能力；決策見 ADR-014。

## 如何解讀

[Windows 場景協調](2026-10-04-windows-desktop-coordination.md) 區分 physical／邏輯座標、
公開 ZoomFactor 與受限多視窗傳輸、實際 DOM／原生輸入的驗證界線；決策見 ADR-018。

[Windows 原生備份](2026-10-04-windows-native-backup-files.md) 記錄 RootDirectory／reparse／
檔案身分清理及 .NET 可攜加密的官方來源與驗證界線；決策見 ADR-016。

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
