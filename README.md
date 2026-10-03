# desktop-work-fleet

跨裝置同步的工作便箋與輕量 backlog：隨手記錄想法，持續看見尚未完成的事情。

## Current Status

已提供 0.1.0 可操作驗證版：macOS Sandbox App、共用 Web 編輯器與 Python／SQLite 同步服務。
便箋支援快速記錄、Todo／In Progress／Done、待辦勾選、草稿、衝突、刪除與還原。

- Mac 已實際建置／啟動，驗證真實資料更新、鎖定政策、背景焦點、解鎖／重鎖。
- HTTP／SQLite、草稿與真實 WebKit 操作有可重現測試。
- 下一階段優先 [正式架構設計](docs/resreach/2026-10-03-product-architecture-blueprint.md)；多便箋視窗與平台實測留在後續整合。
- 真實桌面滑鼠點擊／框選／拖拉、完整 Spaces 矩陣、其他平台與商店仍未驗證。
- [驗證報告](docs/validation/2026-10-03-validation-report.md) 明列通過、失敗／阻礙及未測；執行進度以 [PROGRESS.md](PROGRESS.md) 為準。

在這台 Mac 啟動：

```bash
bash scripts/macos/start-validation.sh
```

選單列 **WF → 快速記錄／解鎖** 開始編輯，**WF → 鎖定** 恢復桌面展示。
建置需求、配對、第二 client 與備份恢復見 [操作文件](docs/setup-guide.md)。

## 產品方向

- 用便箋記錄尚未處理的事情與靈感，保留簡單的 Todo／In Progress／Done。
- Windows、macOS、Linux 桌面展示共享內容，預設唯讀且滑鼠穿透。
- Mac／Web 共用 SQLite 權威來源；手機可透過 HTTPS 瀏覽器配對，實機尚未測。
- iOS、macOS、Android App 以 Apple／Google 商店為目標。
- 保留清單、看板與不同分組方式的可能性，不強迫使用者操作複雜工作流程。

上述包含產品目標，尚未全部實作或驗證。候選 UX 與使用者已確認需求有分別標示。

## 從這裡開始

1. [文件索引](docs/README.md)
2. [研究索引](docs/resreach/README.md)
3. [Backlog 優先需求](docs/resreach/2026-10-03-backlog-first-product-requirements.md)
4. [架構現況](docs/architecture.md)
5. [已接受的專案邊界](docs/decisions/001-independent-backlog-first-foundation.md)
6. [驗證與限制](docs/testing.md)

研究目錄依使用者指定命名為 `docs/resreach/`。保留此拼字；`docs/research/` 只有導引文件。

## 開始開發前

閱讀 [setup-guide.md](docs/setup-guide.md)、[testing.md](docs/testing.md) 與
[ADR-002](docs/decisions/002-validation-runtime.md)。不需安裝 pip/npm runtime 套件。

## 專案結構

```text
docs/resreach/    日期與主題命名的研究
docs/decisions/  已接受的決策
docs/specs/      後續規格與模板
docs/plans/      後續計畫與模板
src/macos/      AppKit Sandbox 展示與 WebKit 編輯入口
src/server/     Python 標準庫 HTTP + SQLite
src/web/        共用便箋編輯器
tests/          資料、草稿與 WebKit 操作測試
scripts/        建置、啟動、探針與維護腳本
```

## 來源與授權

本專案重新設計，未搬入其他 sticky-note 應用的產品程式碼或資產。骨架使用 [project-bootstrap](https://github.com/sammykenny2/project-bootstrap)；來源與範圍見 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

初始授權為 [MIT](LICENSE)。未來加入的第三方元件須另外確認授權與各平台散布義務。
