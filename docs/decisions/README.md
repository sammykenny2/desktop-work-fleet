# 決策索引

更新：2026-10-14。

| 記錄 | 狀態 | 範圍 |
|---|---|---|
| [ADR-001](001-independent-backlog-first-foundation.md) | Accepted | 名稱、獨立開發、backlog 重心與 bootstrap 範圍 |
| [ADR-002](002-validation-runtime.md) | Accepted | 驗證版 AppKit／Web／Python SQLite，保留跨平台封裝目標 |
| [ADR-003](003-product-architecture-boundaries.md) | Deferred | 保留完整 PM／自架 server 架構，非 1.0 必做 |
| [ADR-004](004-google-drive-notes-mvp.md) | 部分由 ADR-012 取代 | Google Drive 初始提案；歷史範圍候選 |
| [ADR-005](005-portable-backup-and-restore.md) | Superseded by ADR-013 | 歷史備份格式／還原候選 |
| [ADR-006](006-card-group-and-formation-semantics.md) | Accepted（產品語意） | 一事一卡、群組／formation／操作與轉組手勢 |
| [ADR-007](007-desktop-scene-and-platform-host.md) | Proposed | 場景 renderer／平台 host、可控疊序與输入責任 |
| [ADR-008](008-portable-interaction-core.md) | Accepted（共用核心） | ES modules 語意、原子本機命令、完整五平台 1.0 範圍 |
| [ADR-009](009-local-renderer-and-persistence.md) | Accepted（本機介面） | 封裝 renderer、IndexedDB 交易／草稿／附件、Markdown 清理 |
| [ADR-010](010-group-retirement-and-device-settings.md) | Accepted（本機命令） | 預覽合併群組、草稿 membership 基線與穩定裝置設定 |
| [ADR-011](011-immutable-revision-graph.md) | Accepted（同步格式） | 不可變 revision、嚴格 JSON、pending 與多 head；Google 整合另驗收 |
| [ADR-012](012-durable-file-store-and-drive-adapter.md) | Accepted（檔案傳輸） | 持久 reservation、分頁／重試、Drive appDataFolder／resumable；原生授權另驗收 |
| [ADR-013](013-complete-portable-backup.md) | Accepted（完整備份） | 全部已知版本／草稿／附件／版面、嚴格 ZIP、加密、三種還原及自動備份契約 |
| [ADR-014](014-durable-automatic-backups.md) | Accepted（自動備份） | profile journal／policy generation／重啟恢復／原生檔案能力與安全清理 |
| [ADR-015](015-windows-native-storage-and-editor-host.md) | Accepted（Windows 主画面／保存） | WPF／WebView2、SQLite／DPAPI、分塊 IPC、原子 CAS 與關閉草稿 |
| [ADR-016](016-windows-native-backup-files-and-vault.md) | Accepted（Windows 備份） | NTFS 目錄／檔案身分、create-only／同 handle 清理、原生 vault 加密與可攜封裝 |
| [ADR-017](017-windows-composition-surface-and-input.md) | Accepted（Windows 場景基礎） | CompositionControl、互補 region、層級／成對生命週期、快捷鍵及 physical display inventory |
| [ADR-018](018-single-owner-desktop-views.md) | Accepted（Windows 場景整合） | 單一 Workspace、受限投影／命令、分片、草稿 flush／接手／失聯／關閉 |
| [ADR-019](019-windows-shortcuts-and-tray.md) | Accepted（Windows 桌面入口） | 全域／本地鍵、焦點所有權、短效 activation intent、系統匣與保留 owner 的收起 |
| [ADR-028](028-native-package-and-signing-entry-points.md) | Accepted（封裝入口） | Windows MSIX／ZIP、Apple export／PKG／DMG、Android upload signing；正式帳號／原生產物另交付 |
| [ADR-029](029-portable-apple-xcode-project.md) | Accepted（Apple 專案交付） | 已提交的可攜 Xcode 專案、clone 直接開啟、本機配置與建置資產 |
| [ADR-030](030-windows-explorer-wallpaper-layer.md) | Accepted（Windows 桌布層） | Explorer 圖示／桌布宿主、三層場景、穿透與退出恢復 |
| [ADR-031](031-macos-and-linux-wallpaper-scenes.md) | Accepted（Mac／Linux 桌布層） | Mac 圖示下方、Linux BACKGROUND、穿透與重畫、參考實測接續 |
| [ADR-032](032-windows-debug-webview-inspection.md) | Accepted（Windows Debug 檢查） | 僅 Debug 開 DevTools、opt-in loopback CDP 與 Release 封裝防護；資料共用要求由 ADR-037 取代 |
| [ADR-033](033-apple-local-script-bundles.md) | Accepted（Apple 封裝） | 本機 classic script bundles、保留 CSP／bridge 與獨立開發簽章啟動測試 |
| [ADR-034](034-windows-11-compatibility-and-install-floor.md) | Accepted（Windows 支援範圍） | 早期 Windows 11／23H2／24H2+、MSIX 目標下限 22000、23H2 實測與 Store 延期；實作見 PROGRESS |
| [ADR-035](035-windows-attached-scene-background-lifecycle.md) | Accepted（附著場景修正方向） | 移位／堆疊／攤開白塊回報、宿主無 backing bitmap、舊區域撤下／不複製像素；效果未測 |
| [ADR-036](036-windows-self-contained-packaging.md) | Accepted（Windows 封裝 runtime） | 預設自帶 .NET 8 Desktop／win-x64、runtime notices 與包檢查；WebView2 仍依賴系統 |
| [ADR-037](037-msix-data-lifetime-and-google-backup-overwrite.md) | Accepted（資料生命週期與覆蓋） | MSIX 解除安裝清除本機資料；完整備份、安全備份與可續行的 Google 全量覆蓋 |
| [000-template](000-template.md) | Template | 後續決策格式 |
| [ADR-038](038-portable-local-and-cloud-backup-flows.md) | Accepted（雙向備份遷移） | 同格式 ZIP、本機原子完整還原與 Google 同步後匯出；失敗副本需明確選擇 |
| [ADR-044](044-desktop-in-app-updates-from-github-releases.md) | Accepted（App 內更新） | 公開 GitHub Releases 依平台 tag 篩選、manifest／SHA-256、MSIX／Sparkle／DEB 安裝前保存並結束 |
| [ADR-043](043-desktop-window-placement-and-startup-behavior.md) | Accepted（主視窗與啟動） | 主機層級的主視窗位置／大小記憶、登入啟動預設開啟、系統狀態優先、Windows 第二次啟動喚起 |
| [ADR-042](042-adjust-overlay-on-every-desktop-host.md) | Accepted（調整模式） | 所有桌面主機以遮罩調整，主視窗只在調整開始時有焦點才讓開並恢復 |
| [ADR-041](041-labwc-shortcuts-through-rc-xml-keybinds.md) | Accepted（labwc 快捷鍵） | 設定頁把快捷鍵寫進 rc.xml 標記區塊，keybind 經 gapplication 交給 App |
| [ADR-040](040-gnome-wayland-xwayland-choice.md) | Accepted（GNOME Wayland 顯示方式） | 首次啟動詢問並可在設定切換 XWayland，GTK 啟動前套用、重新啟動保存草稿 |
| [ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md) | Accepted（GNOME／X11 場景） | X11 場景依工作區定尺寸；GNOME XWayland 只常駐桌布層；調整遮罩起於 GNOME XWayland（現行範圍見 ADR-042）；Pi 的 DMA-BUF renderer 使用共享記憶體 buffer；pcmanfm 桌面不提供桌布層 |

驗證版 runtime 已由 ADR-002 決定；1.0 平台與封裝決策見文件總索引及 ADR-028，正式商店配置仍需維護者帳號。研究建議留在 [resreach](../resreach/README.md)，不要自動改成 Accepted。

新決策採用 000-template 的結構，以小寫連字號命名，記錄接受範圍與日期。
