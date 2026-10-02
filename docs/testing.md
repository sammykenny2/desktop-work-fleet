# 驗證與限制

更新：2026-10-03。

## 本階段範圍

本 repo 只有研究與 bootstrap 骨架，沒有應用測試 runner、產品 build、UI 或 API。以下檢查只針對文件與 scaffold，不代表同步、平台功能或商店合規已通過。

## 可重現檢查

在 project-bootstrap checkout：

```powershell
.\scripts\windows\Test-Templates.ps1 -FailOnWarning
```

在此 repo 有已追蹤修改時：

```powershell
git diff --check
git diff --cached --check
```

初次提交前需先暫存指定交付檔案，因為一般 git diff 不包含 untracked 檔案。

另外做文件機械檢查：

- 確認 minimal base 的檔案與隱藏檔完整存在。
- 未專案化的模板／腳本與 bootstrap 來源逐檔比對。
- 檢查專案文件的相對 Markdown 連結，排除範例 code block 與外部 URL。
- 確認研究使用 YYYY-MM-DD-topic.md、UTF-8 與 LF。
- 確認研究沒有個人機器絕對路徑或舊應用來源路徑。
- 檢查暫存差異、credential 樣式與未預期檔案。

## 本次結果

- Canonical Initialize-Project.ps1，Preset minimal：成功。
- Test-Templates.ps1 -FailOnWarning：Errors 0，Warnings 0。
- Scaffold 完整性：48 個基礎檔案完整；28 個未專案化檔案與來源 SHA-256 一致。
- Markdown 檢查：41 個文件、86 個相對連結通過；兩個 SPEC-XXX／PLAN-XXX 模板示例連結明確排除。
- 六份日期命名研究文件：檔名、UTF-8、LF 與可攜路徑檢查通過。
- Credential-pattern 掃描：未發現匹配；此為基本模式檢查，非完整安全稽核。
- git diff --cached --check：通過。

## 尚未執行

- 應用單元、整合、瀏覽器或端對端測試：沒有產品實作。
- macOS、Windows、Linux 桌面層與穿透測試。
- 多裝置競爭、離線、草稿、備份與恢復測試。
- 商店送審、安裝包驗證與 runtime dependency 授權稽核。
- 獨立程式碼 review：本次沒有新增產品程式碼；作者的文件機械檢查不算獨立 review。
