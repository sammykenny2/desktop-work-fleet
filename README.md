# desktop-work-fleet

跨裝置同步的工作便箋與輕量 backlog：一張卡片記錄一件事，快速記下靈感，持續看見未完成事項。

## Current Status

更新：2026-10-13。1.0 已開始分 slice 實作，共用卡片／群組／formation／拖放語意核心已加入。
**接手開發先讀 [桌面互動交接](docs/handoff/2026-10-04-desktop-interaction-handoff.md) 與
[SPEC-003](docs/specs/003-desktop-cards-groups-and-formation.md)**，其中區分已確認需求、工作預設、待決問題與 48 個驗收案例。

- 新的本機 UI 支援群組、固定紙面編輯、Markdown／checklist／附件、草稿與拖放；Windows 原生主畫面及加密保存已加入，[啟動方式](docs/setup-guide.md)。桌面分層及其他原生平台持續整合。
- 既有 **0.1.0 驗證版** 仍保留 macOS Sandbox App、Web 編輯器與 Python／SQLite 服務。
- 1.0 採 Google 帳號＋檔案來源，不架便箋 local server；Drive 傳輸核心已加入，原生登入與真 Google 驗收尚待整合。
- 完整 ZIP／加密、三種原子還原與手動 UI 已加入；Windows 已接本機 NTFS 自動備份／清理及 DPAPI 金鑰加密，其他平台持續整合，見 [SPEC-002](docs/specs/002-portable-backup-and-restore.md)。
- 本次包含 Windows/macOS/Linux、iOS/Android 原生 App 與商店提交準備；原生 host／Google／打包尚待整合與驗收。
- 已核准 Markdown、checklist、附件、完成／封存、逐卡設定與完整備份／還原範圍；見 SPEC-003 已答 Q 及 [ADR-008](docs/decisions/008-portable-interaction-core.md)。
- [現有驗證報告](docs/validation/2026-10-03-validation-report.md) 保留其原範圍；不能當作新桌面互動或商店通過。
- Linux 實機驗證過 Ubuntu 22.04 GNOME Wayland（經 XWayland）與 xrdp 的 GNOME Xorg；各桌面環境的限制、資料遷移與共同前提見
  [Linux 桌面支援現況](src/native/linux/README.md#桌面環境支援現況)。
- 執行狀態以 [PROGRESS](PROGRESS.md) 為準；模型測試不代替原生桌面、真實同步或商店證據。

## 產品方向

- 一事一卡，以群組整理；本機可突出「屬於我」，群組不被硬編碼為機器。
- 最多九組；formation 採列×欄，最多三列、四欄且總區塊不超過九。
- 平常唯讀且滑鼠穿透；快捷入口啟動某組或全部，暫時浮到一般 App 上方。
- 單擊選中、雙擊編輯；普通拖曳只移位，群組標籤／Shift 拖放或卡片 action 才改歸屬。
- 自由擺放之後，明確執行 formation 才召回、堆疊或攤開；輪播只改暫時疊序。
- 平常紙張尺寸不變；formation 經同意才調整尺寸，不同意可超出群組區域，並提供復原。
- 共用內容與各裝置版面分離，保留未來異質來源、renderer 與輕量 PM 檢視。
- 自有 iOS／macOS／Android App 保留 Apple／Google 商店目標；不加入 Focus／番茄鐘／回顧。

## 從這裡開始

1. [接手入口及參考資料取得規則](docs/handoff/2026-10-04-desktop-interaction-handoff.md)
2. [文件索引](docs/README.md) 與 [需求](docs/requirements.md)
3. [互動規格](docs/specs/003-desktop-cards-groups-and-formation.md)
4. [已接受語意](docs/decisions/006-card-group-and-formation-semantics.md) 與 [呈現架構提案](docs/decisions/007-desktop-scene-and-platform-host.md)
5. [實作計畫](docs/plans/003-desktop-interaction-implementation.md)
6. [平台能力研究](docs/research/2026-10-04-desktop-interaction-platform-feasibility.md) 與 [研究索引](docs/research/README.md)

本 repo 的規格不依賴另一個 checkout 的固定位置；需要輔助原生桌面實作時先向維護者詢問。

## 預覽新的本機介面

```bash
npm ci --ignore-scripts
npm run build
python scripts/testing/serve_preview.py --port 0
```

開啟終端列出的 URL。預覽只提供靜態檔案，便箋與附件存在瀏覽器 IndexedDB；
尚未連接 Google，也不是原生桌面分層版本。固定 port 可保留相同瀏覽器 origin 的資料。
不要以此預覽取代備份；詳見 [ADR-009](docs/decisions/009-local-renderer-and-persistence.md)。

## 建置 Android App

Android Studio 的 **Open** 選擇 `src/native/android`，完成 Gradle Sync 後選 `app`／`debug` 並 Run 或 Build APK。
需 Node 22+（含 npm）、JDK 17 及 Android SDK 36；專案已附 Gradle Wrapper，建置會自動安裝 npm 依賴並產生介面資產。
也可在該目錄執行 `gradlew.bat assembleDebug`；APK 位於 `app/build/outputs/apk/debug/WorkFleet-<versionName>-android-debug.apk`。
詳見 [Android 專案說明](src/native/android/README.md)。

## 在 Xcode 開啟 iOS／macOS

Mac clone 完整 repository 後直接開啟 `src/native/apple/WorkFleet.xcodeproj`，選 `WorkFleetIOS` 或 `WorkFleetMac`。
專案、schemes 與圖示已納入 Git，使用相對路徑。安裝 Node 22+／npm 後，Xcode 建置會自動準備介面資產。
個人身份與 Team 放在忽略的 `src/native/apple/config/Local.xcconfig`；詳見 [Apple 專案說明](src/native/apple/README.md)。

## 執行既有 0.1.0

在 macOS 使用：

```bash
bash scripts/macos/start-validation.sh
```

選單列 WF → 快速記錄／解鎖開啟 editor，WF → 鎖定恢復展示。
這是驗證版流程，尚未包含上述群組操作與 Google 登入。
建置／配對／備份方式見 [操作文件](docs/setup-guide.md)，檢查見 [testing](docs/testing.md)。
本版本不需安裝 pip/npm runtime 套件；正式 1.0 runtime 尚未選定。

## 專案結構

```text
docs/research/   日期與主題命名的研究
docs/decisions/  已接受／待決／延後的決策
docs/specs/      行為規格與驗收案例
docs/plans/      實作順序與交付條件
docs/handoff/    接手與參考資料取得規則
src/app/        1.0 共用本機介面
src/core/       卡片／群組／草稿／outbox 原子命令
src/layout/     各機位置、formation 及 undo
src/interaction/操作範圍與拖放
src/storage/    分區 IndexedDB 交易與附件
src/native/android/ Android Studio／Gradle 專案與 Android 原生宿主
src/macos/      現有 AppKit Sandbox 展示與 WebKit 編輯入口
src/server/     現有 Python 標準庫 HTTP + SQLite 驗證服務
src/web/        現有共用便箋編輯器
tests/          現有資料、草稿與 WebKit 測試
scripts/        建置、啟動、探針與維護腳本
```

## 來源與授權

本專案獨立設計，未搬入其他 sticky-note 應用的產品程式碼或資產。
骨架使用維護者自己的專案範本（MIT）；來源與範圍見
[THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES.md)。
初始授權為 [MIT](LICENSE)。未來加入的第三方元件須分別確認授權與各平台散布義務。
中性稱呼輔助參考資料不取代真正採用元件所需的來源與法律聲明。
