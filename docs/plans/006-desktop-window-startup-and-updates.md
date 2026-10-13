# PLAN-006: 主視窗位置、啟動行為與 App 內更新

## Metadata

| Field | Value |
|---|---|
| Status | Draft（等待維護者審閱 ADR-043／044 與 SPEC-006 的 D／Q） |
| Owner | 專案維護者 |
| Assigned To | 實作責任：Windows、macOS、Linux host、共用介面與發布腳本 |
| Reviewer | 獨立審閱尚不可用 |

## Related Spec

[SPEC-006](../specs/006-desktop-window-startup-and-updates.md)、[ADR-043](../decisions/043-desktop-window-placement-and-startup-behavior.md)、
[ADR-044](../decisions/044-desktop-in-app-updates-from-github-releases.md)。

## Overview

先做三平台都不需要外部帳號的部分：版本顯示、主機偏好、主視窗位置與啟動行為。
更新器先完成 Windows MSIX，再接 Linux DEB；macOS 等 Developer ID、公證與 Sparkle 金鑰就緒後進行。
每個階段可獨立提交；升版、發布與 Actions dispatch 依 AGENTS.md 另行授權。

## Implementation Phases

### Phase 0: 前置條件（維護者）

- [ ] 0.1 公開前確認 git 歷史與 workflow 沒有秘密或私人資料，再把 repo 改為 public。
- [ ] 0.2 公開後更新 AGENTS.md 與 `docs/deployment.md` 的私有 repo 與 Actions 額度描述（commit 需說明理由）。
- [ ] 0.3 回答 SPEC-006 的 Q02（macOS 安裝方式）；其他 Q 不阻擋 Phase 1–4。
- [ ] 0.4 macOS 更新前準備 Developer ID、公證憑證與 Sparkle EdDSA 金鑰，存在 CI secrets。

### Phase 1: 版本與主機偏好基礎

- [ ] 1.1 三平台 `host.info` 增加 App 版本與發行形式（MSIX／ZIP／Debug、Developer ID／未簽章、DEB／tar.gz／原始碼）。
- [ ] 1.2 主機偏好檔讀寫：`host-preferences.json`、`window-placement.json` 的版本化格式、預設值、原子寫入與損壞處理。
- [ ] 1.3 新增 `host.preferences.get`／`host.preferences.set` 與 `host.window.resetPlacement` bridge 方法；protocol 仍為 1。
- [ ] 1.4 設定＞桌面新增「啟動行為」與「App 更新」區塊骨架，顯示版本；瀏覽器開發模式不顯示原生選項。
- [ ] 1.5 備份 `appVersion` 改用 `host.info` 版本（SPEC-006 D09）。

**Deliverables**：三平台顯示正確版本；偏好檔可讀寫並有單元測試。

### Phase 2: 主視窗位置

- [ ] 2.1 共用規則（交集最大工作區、縮小與夾回、最小尺寸、預設）寫成可測的純函式，三平台以相同 fixture 測試。
- [ ] 2.2 Windows：Win32 window placement 保存與套用；顯示前驗證；收到系統匣、結束、登出關機時補寫。
- [ ] 2.3 macOS：視窗 frame 與最大化保存；`NSScreen.visibleFrame` 驗證；隱藏與結束時補寫。
- [ ] 2.4 Linux：X11 位置與大小、Wayland 大小與最大化；與 ADR-042 調整遮罩的讓開／恢復協調（三平台）。
- [ ] 2.5 設定頁「重置主視窗大小與位置」。

**Deliverables**：C01–C04 在可用硬體上通過；混合 DPI 與多顯示器缺設備時明列未測。

### Phase 3: 啟動行為與第二次啟動

- [ ] 3.1 Windows：`generate-windows-manifest.mjs` 加入 `uap5` namespace 與 `windows.startupTask`；
  StartupTask 狀態讀取、啟用與停用；以 activation 判斷登入啟動；ZIP／Debug 停用選項。
- [ ] 3.2 Windows：每位使用者、每個資料目錄的單一實例通道，第二次啟動喚起既有主畫面。
- [ ] 3.3 macOS：`SMAppService.mainApp` 註冊、狀態讀取與開啟登入項目設定。
- [ ] 3.4 Linux：autostart 檔寫入、移除與讀回，遵守 `XDG_CONFIG_HOME`；`--launch-at-login` 參數。
- [ ] 3.5 三平台：登入隱藏啟動、關閉保留在系統匣的開關、系統匣不可用時顯示主畫面。

**Deliverables**：C05–C08；Windows 登入啟動在 23H2 與 26200 實機驗證。

### Phase 4: 更新器共用規則與 Windows MSIX

- [ ] 4.1 共用 fixture：release 列表篩選、版本比較、manifest 驗證、錯誤代碼對應。
- [ ] 4.2 `update-source.json` 由封裝腳本產生；公開設定新增更新來源 repo。
- [ ] 4.3 Windows 更新器：GitHub API 查詢、限定轉址與大小的下載、SHA-256、MSIX identity 核對。
- [ ] 4.4 Windows 安裝：既有保存並結束流程後以 `PackageManager` 安裝、`RegisterApplicationRestart` 重新開啟；失敗恢復。
- [ ] 4.5 Windows 系統匣「檢查更新…」與原生對話框；下載進度提示文字。
- [ ] 4.6 `windows-preview.yml` 與本機封裝產生 `work-fleet-update.json` 並上傳。

**Deliverables**：C09–C11、C14（Windows）；以本機測試 feed 完成舊版到新版的實際更新。

### Phase 5: Linux DEB 更新

- [ ] 5.1 Linux 更新器（Python）：同一規則與 fixture；`dpkg-deb` 核對。
- [ ] 5.2 `pkexec` 安裝與 `host.restart` 重新執行；取消與失敗處理。
- [ ] 5.3 Linux 系統匣項目與 GTK 對話框；DEB release 流程與 manifest（x64／arm64 依實際套件架構）。

**Deliverables**：C13、C14（Linux）。

### Phase 6: macOS 更新

- [ ] 6.1 依 Q02 加入 Sparkle 2（Swift Package）與自訂 user driver；更新 `generate-apple-project.mjs` 與 THIRD-PARTY-NOTICES。
- [ ] 6.2 macOS 更新器、狀態列項目與 NSAlert；Developer ID 公證的發布流程與 manifest。

**Deliverables**：C12、C14（macOS）。

### Phase 7: 文件與驗收

- [ ] 7.1 更新 `docs/release/privacy.zh-TW.md`、`docs/release/submission-data.json`、`docs/security-guidelines.md`。
- [ ] 7.2 更新 `docs/deployment.md`（更新流程、manifest、資產）、`docs/testing.md`、`docs/setup-guide.md`。
- [ ] 7.3 PROGRESS 記錄實際結果與未測範圍。

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `src/native/windows/app/FleetWindow.cs`、`Program.cs`、`NativeTray.cs` | Modify | 位置保存、啟動行為、單一實例、系統匣更新項目 |
| `src/native/windows/app/` 新檔 | Create | 主機偏好、視窗位置、StartupTask、更新器與安裝 |
| `src/native/windows/core/BridgeSession.cs` | Modify | `host.info` 版本與新增方法 |
| `src/native/apple/macos/Main.swift`、`FleetDesktop.swift`、`src/native/apple/Shared/` | Modify/Create | 位置、SMAppService、更新器、狀態列 |
| `src/native/linux/host.py`、`tray.py`、`service.py` 及新模組 | Modify/Create | 位置、autostart、更新器、系統匣 |
| `src/app/index.html`、`src/app/main.js`、`src/native/bridge.js` | Modify | 設定＞桌面兩個區塊、版本與更新狀態 |
| `src/backup/payload.js` 與呼叫端 | Modify | 備份 `appVersion` |
| `scripts/generate-windows-manifest.mjs`、`scripts/windows/Build-WindowsPackage.ps1` | Modify | StartupTask、`update-source.json`、manifest 產生 |
| `scripts/config.mjs`、`.env.example` | Modify | 更新來源 repo 的公開設定 |
| `scripts/generate-linux-package.mjs`、`scripts/linux/` | Modify | autostart 啟動參數、DEB 更新 manifest |
| `scripts/generate-apple-project.mjs` | Modify | Sparkle 依賴（Phase 6） |
| `.github/workflows/windows-preview.yml` 及新 workflow | Modify/Create | 上傳 manifest；macOS／Linux 發布 |
| `tests/` 與 `tests/native/` | Create/Modify | 位置規則、偏好檔、feed／manifest fixture、原生探針 |
| 文件（Phase 7） | Modify | 隱私、安全、部署、測試、設定說明 |

## Technical Decisions

詳見 ADR-043／044。主機層級檔案不分 profile；系統狀態優先於偏好；更新只在使用者動作時連線；
安裝前一律走既有保存並結束流程；Windows 不使用 App Installer 或 Run 機碼。

## Testing Strategy

- **Unit Tests**：位置規則的 fixture（多顯示器、負座標、斷線、太小工作區）；偏好檔損壞與預設；
  feed 篩選、版本比較、manifest 驗證、錯誤代碼；三平台以同一份 fixture 執行。
- **Integration Tests**：Debug 專用測試 feed 提供合成 release 與安裝檔；Windows 獨立測試 identity 的 MSIX 實際更新；
  Linux 測試 VM 的 DEB 更新；Release 包確認不含測試 feed 設定。
- **Manual Testing**：登出／登入的登入啟動、工作管理員停用、顯示器拔除與 DPI 變更、第二次啟動、
  真 GitHub prerelease 的檢查（不得以使用者正式資料測試清除或覆蓋）。

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| MSIX 自我更新後未重新開啟或登入啟動判斷不如預期 | Medium | Phase 4 先以測試 identity 實測；不可行時改為安裝後提示手動開啟 |
| 登入時 Explorer 尚未就緒，場景附著失敗 | Medium | 沿用 ADR-020／030 的重建恢復；C05 實機驗證 |
| GitHub API rate limit | Low | 只做手動檢查；rate_limited 顯示稍後再試 |
| GitHub 轉址主機變更 | Medium | 主機清單集中設定；失敗顯示錯誤並提供 Releases 頁面連結 |
| macOS 簽章與公證條件未就緒 | High | 更新能力保持關閉，只顯示版本；不阻擋其他階段 |
| Linux 安裝中檔案被替換 | Medium | 安裝成功後立即保存並重新執行；失敗時不重新啟動 |
| 預設開啟登入啟動被視為未經同意 | Low | 設定頁清楚呈現並可一鍵關閉；系統停用優先 |

## Progress Log

執行結果與剩餘驗收只記 [PROGRESS](../../PROGRESS.md)。

---

*Created: 2026-10-14*
