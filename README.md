# desktop-work-fleet

跨裝置同步的工作便箋與輕量 backlog：隨手記錄想法，持續看見尚未完成的事情。

## Current Status

目前只有獨立專案骨架與研究文件，沒有可執行的產品、已選定的技術棧或已驗證的跨平台能力。

- 已以 project-bootstrap 的 minimal preset 初始化。
- 已整理需求、檢視模型、同步、macOS 公開 API、商店發佈與授權研究。
- 使用者需求以 backlog／快速記錄為中心；Agent 執行管理不是第一版重心。
- 詳細進度以 [PROGRESS.md](PROGRESS.md) 為準。

## 產品方向

- 用便箋記錄尚未處理的事情與靈感，保留簡單的 Todo／In Progress／Done。
- Windows、macOS、Linux 桌面展示共享內容，預設唯讀且滑鼠穿透。
- 可由桌面、Web 或手機編輯；同步來源尚未選定。
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

目前不需要安裝 application dependencies，也沒有 dev server 指令。先閱讀 [setup-guide.md](docs/setup-guide.md)，再依下一個獲授權任務決定要實作哪個原型。

## 專案結構

```text
docs/resreach/    日期與主題命名的研究
docs/decisions/  已接受的決策
docs/specs/      後續規格與模板
docs/plans/      後續計畫與模板
src/            尚未實作
tests/          尚未配置應用測試
scripts/        Bootstrap 的維護輔助腳本
```

## 來源與授權

本專案重新設計，未搬入其他 sticky-note 應用的產品程式碼或資產。骨架使用 [project-bootstrap](https://github.com/sammykenny2/project-bootstrap)；來源與範圍見 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

初始授權為 [MIT](LICENSE)。未來加入的第三方元件須另外確認授權與各平台散布義務。
