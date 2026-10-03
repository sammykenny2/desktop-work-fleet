# 專案進度

更新：2026-10-03。本檔是本 repo 的執行狀態權威；ROADMAP 與研究文件提供方向，不維護另一份完成清單。

## 目前工作

使用者將切到 macOS 延續「交付可以驗證先前擔心項目的版本」。接手依據為 [macOS 驗證版計畫](docs/plans/001-validation-version-macos-handoff.md)，包含可直接使用的 goal 描述、實作順序與驗收證據。

目前只完成接手準備；產品程式、AppKit 探針、依賴安裝與 upgrade-project updater 均尚未開始。先在真實 Mac 上驗證公開 API／Sandbox／唯讀／滑鼠穿透，再串接持久化與同步。整體驗證版目標尚未完成。

## 已完成

- 使用 project-bootstrap 的 bootstrap-project 技能與 minimal preset 建立獨立骨架。
- 初始化本機 Git main，並建立 private GitHub repo [sammykenny2/desktop-work-fleet](https://github.com/sammykenny2/desktop-work-fleet)，設定為 origin。
- 依最新澄清整理 backlog／快速記錄需求。
- 建立 docs/resreach 研究索引與六份日期命名文件。
- 補充資料來源、衝突、macOS 公開 API、上架與授權、檢視模型與驗證方案。
- 將 README、核心文件與協作入口專案化；記錄 bootstrap 來源。
- 保留其他 Agent 的專用指令檔與通用模板。
- 整理 macOS 接手計畫、平台驗證矩陣與可直接使用的 goal 描述。
- 沒有搬入其他 sticky-note 應用的產品程式碼、資料或資產。

## 未執行／尚未定案

- 產品 UX 原型與使用者評估。
- Backend、framework、同步與離線模式選型。
- macOS 公開 API／sandbox 實機探針。
- Windows MSIX 與 Linux 桌面相容性驗證。
- iOS／Android App、QR 配對與任何商店提交。
- Runtime dependencies、SBOM 與最終產物授權檢查。

## 驗證

本次是文件與 scaffold 交付。已執行的機械檢查、限制與未執行測試以 [docs/testing.md](docs/testing.md) 為準；不可將 scaffold 成功當成應用功能通過。
