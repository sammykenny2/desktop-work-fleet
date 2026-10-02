# 本階段使用方式

更新：2026-10-03。

目前是文件與研究 repo，沒有 application dependencies、開發服務或可執行 App。

1. 從根目錄 README 與 [文件索引](README.md) 閱讀。
2. 確認 [最新需求](resreach/2026-10-03-backlog-first-product-requirements.md)。
3. 依下一個獲授權任務選擇原型或研究，不預設全部驗證批次都要立即開工。

## Bootstrap 來源

- project-bootstrap commit：a7438cf81d44519db89d2783dc14b7cfc9e0e851。
- Preset：minimal，base only。
- Canonical generator：scripts/windows/Initialize-Project.ps1。
- 技能：[bootstrap-project](https://github.com/sammykenny2/project-bootstrap/blob/a7438cf81d44519db89d2783dc14b7cfc9e0e851/skills/bootstrap-project/SKILL.md)。

從 bootstrap checkout 使用明確目標路徑執行 generator。已存在且非空的本 repo 不應再次初始化；未來升級使用 bootstrap updater，逐項檢查 review copy。

目前未安裝額外 agent-skills flavor，也不需執行 skill discovery sync。
