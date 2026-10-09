# 文件索引

更新：2026-10-09。先讀最新規格；研究、工作預設、實作完成與實測通過各自區分。

## 本次開發接手：優先閱讀

| 文件 | 效力與用途 |
|---|---|
| [Windows 11 相容性接手](handoff/2026-10-09-windows-11-compatibility-handoff.md) | 本輪正確專案、23H2 原生與包內容驗證；使用者互動與安裝驗收接續入口 |
| [ADR-034](decisions/034-windows-11-compatibility-and-install-floor.md)／[SPEC-005](specs/005-windows-11-compatibility.md)／[PLAN-004](plans/004-windows-11-compatibility.md) | 已確認 Windows 11 新舊版目標、Windows 10 安裝排除與施工順序；目前 MSIX 下限 22000，其他版本實機另驗 |
| [接手入口](handoff/2026-10-04-desktop-interaction-handoff.md) | 閱讀順序、不可偏離行為、外部參考位置詢問規則 |
| [需求](requirements.md) | 最新產品範圍與未決項目 |
| [SPEC-003](specs/003-desktop-cards-groups-and-formation.md) | U／D／已答 Q、完整互動、C01–C48；實作狀態見 PROGRESS |
| [ADR-006](decisions/006-card-group-and-formation-semantics.md) | Accepted：一事一卡、群組、formation、操作語意 |
| [ADR-007](decisions/007-desktop-scene-and-platform-host.md) | Proposed：renderer／原生 host 分界及可控疊序 |
| [ADR-008](decisions/008-portable-interaction-core.md) | Accepted：共用語意核心、原子保存與本輪完整 1.0 範圍 |
| [ADR-009](decisions/009-local-renderer-and-persistence.md) | Accepted：本機 renderer、IndexedDB／草稿／附件、安全 Markdown |
| [ADR-010](decisions/010-group-retirement-and-device-settings.md) | Accepted：群組合併／草稿基線、區域及快捷鍵設定 |
| [SPEC-004](specs/004-revision-graph-and-file-sync.md)／[ADR-011](decisions/011-immutable-revision-graph.md) | Accepted：不可變版本、嚴格 JSON、缺 parent／多分支規則；整合證據見 PROGRESS |
| [ADR-012](decisions/012-durable-file-store-and-drive-adapter.md) | Accepted：可恢復 FileStore、Drive appDataFolder 與續傳；原生授權另驗收 |
| [SPEC-002](specs/002-portable-backup-and-restore.md)／[ADR-013](decisions/013-complete-portable-backup.md) | Accepted：完整可攜資料、嚴格 ZIP／加密、三種還原與自動備份契約；執行見 PROGRESS |
| [ADR-014](decisions/014-durable-automatic-backups.md) | Accepted：自動備份 journal／重啟／policy、原生安全檔案能力；瀏覽器不假冒原生能力 |
| [ADR-015](decisions/015-windows-native-storage-and-editor-host.md) | Accepted：Windows WPF／WebView2 主畫面、加密 SQLite／DPAPI、受限 bridge；桌面呈現另驗收 |
| [ADR-016](decisions/016-windows-native-backup-files-and-vault.md) | Accepted：Windows NTFS 保存／清理、native grants、密碼不回傳的 vault 加密；其他平台另驗收 |
| [ADR-017](decisions/017-windows-composition-surface-and-input.md) | Accepted：Windows composition／互補輸入區域、快捷鍵與顯示器基礎；產品協調仍整合中 |
| [ADR-018](decisions/018-single-owner-desktop-views.md) | Accepted：Windows 場景連接單一工作區、分片／受限命令與草稿保存屏障 |
| [ADR-019](decisions/019-windows-shortcuts-and-tray.md) | Accepted：Windows 快捷鍵／焦點、系統匣與主畫面收起，仍使用唯一工作区 |
| [ADR-020](decisions/020-windows-display-lifecycle.md) | Accepted：顯示器／DPI／休眠通知、保存後救援與場景重用 |
| [ADR-021](decisions/021-windows-google-account-and-sync.md) | Accepted：Windows 原生 Google OAuth、帳號分區及同步入口 |
| [ADR-022](decisions/022-android-native-host.md) | Accepted：Android host、Keystore、SAF 與 Google 授權 |
| [ADR-023](decisions/023-apple-native-host-and-scenes.md) | Accepted：Apple host、Keychain、Google 與 macOS 場景 |
| [ADR-024](decisions/024-linux-native-owner-and-storage.md) | Accepted：Linux GTK owner、Secret Service、備份與 Google |
| [ADR-025](decisions/025-linux-desktop-scenes-and-shortcuts.md) | Accepted：Linux 分層場景、輸入區域、快捷鍵與系統匣 |
| [ADR-026](decisions/026-native-file-export-and-sharing.md) | Accepted：原生檔案匯出、手機文字與附件分享 |
| [ADR-027](decisions/027-native-share-inbox-and-extension.md) | Accepted：加密分享收件匣、群組選擇與 iOS Extension |
| [ADR-028](decisions/028-native-package-and-signing-entry-points.md) | Accepted：Windows MSIX／ZIP、Apple export／PKG／DMG、Android upload signing |
| [ADR-029](decisions/029-portable-apple-xcode-project.md) | Accepted：可直接開啟的已提交 Xcode 專案、相對路徑與自動資產準備 |
| [ADR-030](decisions/030-windows-explorer-wallpaper-layer.md) | Accepted：Explorer 圖示／桌布宿主、三層場景與穿透 |
| [ADR-031](decisions/031-macos-and-linux-wallpaper-scenes.md) | Accepted：Mac／Linux 第三層、穿透／重畫及參考實測接續 |
| [ADR-032](decisions/032-windows-debug-webview-inspection.md) | Accepted：Windows 僅 Debug 開 DevTools／opt-in CDP，Release 封裝防護 |
| [ADR-033](decisions/033-apple-local-script-bundles.md) | Accepted：Apple 本機腳本合併、保留資產安全邊界與開發簽章啟動測試 |
| [ADR-035](decisions/035-windows-attached-scene-background-lifecycle.md) | Accepted：23H2 堆疊／攤開殘影的附著宿主與背景生命週期修正；效果待實測 |
| [ADR-036](decisions/036-windows-self-contained-packaging.md) | Accepted：Windows MSIX／ZIP 預設自帶 .NET 8 Desktop runtime，接收端仍需 WebView2 |
| [PLAN-003](plans/003-desktop-interaction-implementation.md) | 從契約到平台／來源整合的開發交接 |
| [討論演進](resreach/2026-10-04-desktop-card-interaction-design.md) | 決策來源、補充及已被取代的方案 |
| [平台研究](resreach/2026-10-04-desktop-interaction-platform-feasibility.md) | Windows／公開 AppKit／labwc-Wayland 的證據與限制 |

## 專案與現有程式

| 文件 | 用途 |
|---|---|
| [README](../README.md) | 定位與目前交付 |
| [PROGRESS](../PROGRESS.md) | 唯一執行狀態 |
| [ROADMAP](../ROADMAP.md) | 方向及先後順序 |
| [架構](architecture.md) | 正式設計與現有 0.1.0 分開 |
| [Setup](setup-guide.md) | 現有驗證版使用方式 |
| [Google 設定](google-setup.md) | 五平台 OAuth clients、公開設定與帳號操作 |
| [Testing](testing.md) | 可執行檢查及未測界線 |
| [Deployment](deployment.md) | 原生封裝與商店未測範圍 |
| [商店提交素材](release/README.md) | 繁中／英文文案、隱私資料及公開提交配置 |
| [API](api.md) | 0.1.0 HTTP／SQLite 契約，非 Drive 1.0 既成格式 |
| [Security](security-guidelines.md) | 保存、權限與隔離 |
| [Services](services.md) | 現有驗證版 listener／port |
| [第三方聲明](../THIRD-PARTY-NOTICES.md) | 實際 bootstrap 來源與 notice |

## Google、備份及歷史研究

完整研究索引在 [docs/resreach](resreach/README.md)，保留使用者指定拼字。

- [Drive 研究](resreach/2026-10-03-google-drive-notes-mvp-feasibility.md) 與
  [ADR-004](decisions/004-google-drive-notes-mvp.md)：初始提案；provider 已由 ADR-012 採納，協定見 SPEC-004。
- [Drive 傳輸研究](resreach/2026-10-04-drive-file-transport.md)：API、分頁、預產生 ID、續傳與未驗證界線。
- [備份歷史研究](resreach/2026-10-03-appdata-backup-and-restore-design.md)／[ADR-005](decisions/005-portable-backup-and-restore.md)
  保留候選背景；最新完整契約見 SPEC-002／ADR-013，
  [容器與加密研究](resreach/2026-10-04-backup-container-and-encryption.md) 記錄官方來源及驗證界線。
- [PLAN-002](plans/002-google-drive-notes-mvp.md)：來源／Google／backup 的工作順序，與 PLAN-003 合併執行。
- [Backlog 原始研究](resreach/2026-10-03-backlog-first-product-requirements.md) 與
  [輕量 PM 模型](resreach/2026-10-03-lightweight-project-management-and-view-model.md)：歷史討論，最新修正優先。
- [同步與衝突](resreach/2026-10-03-source-of-truth-sync-and-conflict-analysis.md)、
  [macOS 公開 API](resreach/2026-10-03-macos-public-api-desktop-feasibility.md)、
  [散布與授權](resreach/2026-10-03-store-distribution-and-license-analysis.md)、
  [獨立開發](resreach/2026-10-03-independent-architecture-and-validation-plan.md)：保留證據及研究日期。
- [完整 PM/server 架構](resreach/2026-10-03-product-architecture-blueprint.md)／
  [ADR-003](decisions/003-product-architecture-boundaries.md)：Deferred；其 Note 容器模型不得覆蓋最新規格。

## 既有驗證證據

- [SPEC-001](specs/001-validation-version.md)／[ADR-002](decisions/002-validation-runtime.md)：已實作 prototype 的範圍。
- [2026-10-03 報告](validation/2026-10-03-validation-report.md)：原有通過、失敗及未測矩陣。
- [Mac 歷史接手](plans/001-validation-version-macos-handoff.md)：先前實作路線，不是現在重啟探索的指令。

## 協作與文件慣例

- [AGENT-GUIDE](AGENT-GUIDE.md)、[SCRIPT-STANDARDS](SCRIPT-STANDARDS.md)、[Skills](../skills/README.md)。
- [決策](decisions/README.md)、[規格](specs/README.md)、[計畫](plans/README.md) 各有索引與模板。
- [Terminology](terminology.md)、[A2A](a2a/README.md)、[MCP](mcp-config.md) 是通用材料，不代表已採用該協定。
- 文件使用相對連結；研究採 YYYY-MM-DD-topic.md。外部參考 checkout 位置向維護者取得。
- 不新增與 PROGRESS 競爭的任務完成表；驗收案例表是要求，不是完成狀態。
