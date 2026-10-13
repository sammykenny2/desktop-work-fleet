# SPEC-006: 主視窗位置、啟動行為與 App 內更新

## Metadata

| Field | Value |
|---|---|
| Status | Approved（U 已確認；2026-10-14 指示依 D 開工；Q 未答） |
| Owner | 專案維護者 |
| Reviewer | 維護者；獨立審閱尚未安排 |
| 日期 | 2026-10-14 |
| Decision | [ADR-043](../decisions/043-desktop-window-placement-and-startup-behavior.md)、[ADR-044](../decisions/044-desktop-in-app-updates-from-github-releases.md) |
| Related Plan | [PLAN-006](../plans/006-desktop-window-startup-and-updates.md) |

## Summary

讓 Windows、macOS、Linux 的 Work Fleet 記得主視窗位置與大小，提供「啟動行為」設定，
並可從系統匣與設定頁檢查、下載及安裝新版。需求來自一個 Electron 桌面參考專案的使用經驗，但依本產品的原生 host 重新設計。
執行狀態只在 PROGRESS 記錄。

## Goals

- 主視窗在重新開啟、從系統匣喚起或換顯示器後，仍出現在可見且符合上次使用的位置與大小。
- 登入後桌面便箋自動出現，使用者可控制是否開啟主畫面與關閉後是否常駐。
- 三個桌面平台都能在 App 內看到版本並升級；資料與草稿在更新前保存。

## Non-Goals

- iOS／Android 的版本顯示與更新（由商店處理）、Microsoft Store／Mac App Store 的更新流程。
- 自動檢查、定期檢查、略過版本與背景自動安裝（見 Q01）。
- 記住桌面場景視窗或多個主視窗的位置；場景依顯示器重新計算，卡片位置仍屬於 `layout`。
- 更換 WPF／AppKit／GTK，或搬移參考專案的 Electron 程式碼、UI 與資料格式。
- 由 agent 把 repo 改為 public、升版或 dispatch 發布流程。

## User Requirements（U，2026-10-14 已確認）

| ID | 要求 |
|---|---|
| U01 | 記住主視窗位置與大小，參考既有桌面專案的行為 |
| U02 | 系統匣與設定頁提供「檢查更新」 |
| U03 | 設定＞桌面提供「啟動行為」，參考既有桌面專案的選項 |
| U04 | 維護者會把 repo 改為 public；更新從本 repo 的 GitHub Releases 取得 |
| U05 | Windows、macOS、Linux 都納入 App 內升級；Windows 是 MSIX，不是 NSIS |
| U06 | 「登入電腦時啟動 Work Fleet」預設開啟 |
| U07 | 架構不同，不直接搬參考專案的程式碼；先完成 ADR／SPEC／PLAN |

## Functional Requirements

### 主視窗位置（WP）

| ID | 要求 |
|---|---|
| WP-F01 | 保存還原狀態的位置、大小與是否最大化到主機層級 `window-placement.json`；不分 profile、不進備份或 Google |
| WP-F02 | 移動、縮放、最大化變更後 500 ms 保存；收到系統匣、保存並結束、登出／關機與更新安裝前補寫；未變不寫 |
| WP-F03 | 啟動與每次顯示主視窗前，以交集最大的工作區驗證，縮小並夾回可見範圍；完全不相交時用預設 |
| WP-F04 | 最大化在第一次顯示時才套用；登入隱藏啟動不得因此顯示主視窗 |
| WP-F05 | 預設 1180×800 置中於主要工作區，工作區較小時縮小到可容納；最小 380×520 |
| WP-F06 | Windows 以實體像素的 window placement 保存與套用；macOS 以 points；Linux X11 保存位置，Wayland 只保存大小與最大化 |
| WP-F07 | 設定＞桌面提供「重置主視窗大小與位置」，刪除保存檔並立即套用預設；桌面場景與卡片不受影響 |
| WP-F08 | 檔案損壞、版本不明或寫入失敗不阻擋啟動或關閉，只記錄並使用預設 |

### 啟動行為（SB）

| ID | 要求 |
|---|---|
| SB-F01 | 設定＞桌面新增「啟動行為」：登入電腦時啟動 Work Fleet（預設開）、關閉主畫面時保留在系統匣（預設開）、登入啟動後開啟主畫面（預設關） |
| SB-F02 | 偏好存在主機層級 `host-preferences.json`，原子寫入；renderer 經 host 方法讀寫，回傳實際生效狀態 |
| SB-F03 | Windows MSIX 以 StartupTask 註冊；`DisabledByUser`／`DisabledByPolicy` 時不覆蓋，顯示系統狀態並可開啟 Windows 啟動應用程式設定 |
| SB-F04 | Windows ZIP／Debug 不提供登入啟動，選項停用並說明原因；不寫 Run 機碼 |
| SB-F05 | macOS 以 `SMAppService.mainApp` 註冊；需要核准時顯示狀態並可開啟登入項目設定 |
| SB-F06 | Linux 寫入或移除 `$XDG_CONFIG_HOME/autostart/work-fleet.desktop`，帶 `--launch-at-login`；讀回檔案判斷實際狀態 |
| SB-F07 | 登入啟動且未選擇開啟主畫面時，主畫面隱藏、桌面便箋照常開始；手動開啟或系統匣不可用時一律顯示 |
| SB-F08 | 關閉保留在系統匣關閉時，關閉主畫面走既有保存並結束流程；系統匣不可用時仍結束 |
| SB-F09 | Windows 第二次啟動喚起既有實例的主畫面後正常結束，不顯示「已開啟」錯誤；macOS／Linux 保持既有喚起 |
| SB-F10 | 切換選項時同步作業系統；Windows 每次啟動也同步，macOS／Linux 只在第一次啟動套用預設；不靜默重新啟用使用者在系統中停用的項目 |

### App 更新（UP）

| ID | 要求 |
|---|---|
| UP-F01 | `host.info` 增加 App 版本與發行形式；設定＞桌面「App 更新」一律顯示版本與頻道 |
| UP-F02 | 只有內嵌有效 `update-source.json` 且可就地升級的安裝形式有更新能力：Windows MSIX、Developer ID 公證的 macOS App、DEB 安裝的 Linux |
| UP-F03 | 原生 host 擁有更新狀態機與單一主按鈕對應：檢查更新、下載更新、重新啟動並安裝；重複要求加入進行中的工作 |
| UP-F04 | 系統匣在有能力時顯示「檢查更新…」，由原生處理；點擊重新檢查後以原生對話框回答，可直接更新並重新啟動 |
| UP-F05 | 以未驗證身分的 GitHub REST API 列出 releases，依 `<platform>-v<版號>` 篩選，預覽頻道包含 prerelease，選最高且較新的版本 |
| UP-F06 | 讀取 release 的 `work-fleet-update.json`，核對平台、版本、tag、大小與 SHA-256；不符則拒絕 |
| UP-F07 | 下載只用 HTTPS、不送憑證；只允許轉到 GitHub release 資產主機；大小有上限並邊下載邊驗證 |
| UP-F08 | 下載前重新檢查；已下載版本不再是最新就重新下載；只持久化上次檢查時間 |
| UP-F09 | 安裝前走既有保存並結束流程，確保草稿保存、場景撤下、資料關閉 |
| UP-F10 | Windows 核對 MSIX 的 Name、Publisher、架構與版本後以 `PackageManager` 安裝並重新開啟；失敗時重新開啟並顯示錯誤 |
| UP-F11 | macOS 以 Sparkle 2 安裝已簽章公證的新版，UI 使用本專案狀態與文案 |
| UP-F12 | Linux 核對 DEB 名稱、架構與版本，以 `pkexec` 安裝後重新執行；取消授權時維持執行並顯示原因 |
| UP-F13 | 錯誤以穩定代碼與繁中文案顯示；原始回應不進 UI，記錄不含 token 或個人資料 |
| UP-F14 | 每個平台 release 附安裝檔、`.sha256` 與 `work-fleet-update.json`；tag 為 `<platform>-v<版號>` |
| UP-F15 | 隱私說明與安全規範列出 GitHub 連線，只在使用者檢查或下載時發生 |

## Delegated Defaults（D）

| ID | 預設 |
|---|---|
| D01 | 主視窗位置與啟動偏好分成兩個主機層級檔案，放在資料目錄，與 `profile.txt` 同處 |
| D02 | 不保存全螢幕、最小化與顯示器識別；全螢幕關閉後以還原狀態開啟 |
| D03 | 系統狀態與偏好不同時，設定頁以系統狀態為準顯示 |
| D04 | macOS 無法可靠判斷登入啟動時當作手動開啟，顯示主畫面 |
| D05 | 本機以相同 identity 封裝的預覽包也有更新能力，設定頁標示來源 |
| D06 | 只做手動檢查；系統匣點擊一律重新檢查，不使用記憶的結果 |
| D07 | 更新器各平台實作，以共用 JSON fixture 測試 feed 與 manifest 規則 |
| D08 | 測試 feed 只由 `app.workfleet.updateprobe.*` 套件身分讀取（資料目錄的 `update-probe.txt`），正式身分一律忽略 |
| D09 | 備份的 `appVersion` 改用 `host.info` 版本，作為同批小修 |

## Open Questions（Q）

- [ ] Q01：是否加入啟動後自動檢查與間隔，或之後的背景下載（參考專案預設關閉）。
- [ ] Q02：macOS 是否採用 Sparkle 2，或改為自寫替換程式。
- [ ] Q03：Linux 之後是否改提供簽章 APT 套件庫，交給系統更新。
- [ ] Q04：預覽之外是否要正式頻道；正式頻道是否排除 prerelease。
- [ ] Q05：本機封裝包（D05）是否應改為只顯示版本，避免開發中版本被發布版取代。

## Non-Functional Requirements

- 安全：renderer 不能發出網路請求或指定 URL；更新 URL 只由 host 依 `update-source.json` 與 manifest 決定。
- 資料：任何更新、結束或重新啟動前完成草稿保存；失敗不得遺失已保存資料。
- 隱私：只在使用者動作時連 GitHub；不送帳號、裝置識別或使用資料。
- 可用性：沒有更新能力的平台與形式清楚說明原因，不顯示無法完成的按鈕。

## Acceptance

| 案例 | 必要證據 |
|---|---|
| C01 位置往返 | 三平台移動／縮放／最大化後結束再開，位置、大小與最大化相同；Wayland 只驗大小與最大化 |
| C02 收到系統匣 | 隱藏時保存；系統匣喚起與第二次啟動回到同一位置 |
| C03 顯示器變更 | 拔除副螢幕或改解析度後喚起，主視窗完整在可見工作區；混合 DPI 需真多顯示器 |
| C04 重置與損壞 | 重置立即套用預設；損壞或未知版本的檔案不影響啟動 |
| C05 登入啟動 | 預設開啟後登出再登入，App 啟動、主畫面隱藏、桌面便箋出現；Explorer 尚未就緒時依 ADR-020／030 恢復 |
| C06 系統停用 | 在工作管理員、系統設定或 autostart 停用後，設定頁顯示系統狀態且下次啟動不重新啟用 |
| C07 關閉行為 | 關閉保留在系統匣關閉時，X 按鈕保存並結束；開啟時隱藏 |
| C08 第二次啟動 | Windows 隱藏狀態下再次啟動，既有主畫面出現且沒有錯誤；ZIP 與 MSIX 資料目錄互不干擾 |
| C09 版本與能力 | 各安裝形式顯示正確版本；無能力形式不顯示系統匣項目與主按鈕 |
| C10 檢查結果 | 已是最新、有新版、離線、rate limit、manifest 錯誤與 SHA-256 不符各自顯示正確狀態 |
| C11 Windows 更新 | 舊 MSIX 經 App 內更新到新版，草稿保存、Explorer 還原、App 重新開啟、資料保留；錯誤 Publisher 被拒 |
| C12 macOS 更新 | Developer ID 公證舊版更新到新版並重新開啟；簽章不符被拒 |
| C13 Linux 更新 | DEB 舊版更新到新版並重新執行；取消 pkexec 維持執行 |
| C14 發布資產 | 每個平台 release 的 manifest 與實際安裝檔大小、SHA-256、tag、平台一致 |

## Dependencies

- 維護者把 repo 改為 public，並在公開前確認歷史沒有秘密。
- Windows 預覽憑證維持不變；macOS 需要 Developer ID、公證與 Sparkle EdDSA 金鑰；Linux 需要 DEB 發布流程。
- 升版、發布與 Actions dispatch 依 AGENTS.md 另行授權。

## References

- [ADR-043](../decisions/043-desktop-window-placement-and-startup-behavior.md)、[ADR-044](../decisions/044-desktop-in-app-updates-from-github-releases.md)、[PLAN-006](../plans/006-desktop-window-startup-and-updates.md)、[研究](../resreach/2026-10-14-desktop-window-startup-and-update-reference.md)
- [SPEC-003](003-desktop-cards-groups-and-formation.md)（同步與裝置狀態分界）、[部署](../deployment.md)、[安全邊界](../security-guidelines.md)

---

*Created: 2026-10-14*
*Related Plan: [PLAN-006](../plans/006-desktop-window-startup-and-updates.md)*
