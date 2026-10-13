# 主視窗位置、啟動行為與 App 更新參考

更新：2026-10-14。整理 Cats 桌面版的做法與本專案現況，供 [ADR-043](../decisions/043-desktop-window-placement-and-startup-behavior.md)、
[ADR-044](../decisions/044-desktop-in-app-updates-from-github-releases.md) 與 [SPEC-006](../specs/006-desktop-window-startup-and-updates.md) 使用。

## 來源與界線

- Cats 桌面版是同一維護者的 Electron 專案（MIT）。只參考行為、限制與失敗經驗；
  本產品是 WPF／AppKit／GTK 原生 host，不搬移程式碼、UI 或資料格式。本機 checkout 位置不記錄。
- 2026-10-14 以讀碼取得，沒有建置或執行 Cats；標示「推論」者僅由程式或函式庫文件推得。

## 使用者需求（2026-10-14）

- 帶入 Cats 的主視窗位置／大小記憶、系統匣與設定頁的「檢查更新」、設定＞桌面＞「啟動行為」。
- 架構不同，先轉成本專案的 ADR／SPEC／PLAN。
- 維護者會把本 repo 改為 public，App 從其 GitHub Releases 取得新版。
- Windows、macOS、Linux 都要 App 內升級；Windows 是 MSIX，不是 Cats 的 NSIS。
- 「登入電腦時啟動」預設開啟。

## 外部證據：Cats 桌面版

### 主視窗位置與大小

- 主程序保存 `window-state.json`：`{version:1, bounds:{x,y,width,height}, maximized}`；
  bounds 為還原後的 normal bounds，不存全螢幕、最小化、顯示器 ID 或 DPI。暫存檔＋rename 原子寫入。
- 移動／縮放／最大化變更後 500 ms debounce 寫入；關閉（含收到系統匣）與結束流程各補寫一次；沒變動不寫。
  最小化時忽略平台誤報的 unmaximize，保留最大化旗標。寫入失敗只記錄。
- 還原時選與保存範圍交集最大的工作區，縮小到可容納並夾回畫面內；與所有顯示器都不相交時改用預設。
  首次為主工作區 85%，限制在 1280×800–1680×1050 並置中；工作區太小則最大化並保留較小的還原尺寸。
- 最大化延到第一次顯示才套用，避免隱藏啟動時被顯示。只在啟動時驗證，沒有顯示器變更處理。
- 「重設平台資料」後會刪檔並套用預設位置。有完整單元測試；導入原因是固定尺寸在 1080p／125% 超出工作區。

### 檢查更新

- 主程序擁有唯一狀態機：unavailable、idle、checking、up_to_date、update_available、downloading、
  downloaded、installing、failed；快照含版本、摘要、進度、錯誤碼與 nextAction（check／download／restart_install）。
- 同時只跑一個檢查或下載，重複要求加入進行中的工作。下載前重新檢查；已下載版本若仍是最新才保留。
  只持久化 lastCheckedAt；錯誤以穩定代碼呈現，原始訊息不進 UI，記錄時遮蔽 token。
- 能力由 CI 寫入安裝包的建置描述決定，不看環境變數；開發版與本機封裝只顯示版本。
- 系統匣固定一項「檢查更新…」，點擊後一律重新檢查，再以原生對話框回答；可直接下載並安裝。
  下載進度放在 tooltip。設定＞桌面最上方「App 更新」以單一主按鈕對應 nextAction，結果用 toast。
- 傳輸是 electron-updater 讀公開 GitHub Releases（Atom feed、`releases/latest` 轉址與 `latest*.yml` 的 sha512）。
  私有 repo 需把 token 帶到用戶端，Cats 明確不支援。自動檢查預設關閉、沒有略過版本或間隔設定。
- 安裝前先停止子程序，失敗則恢復；安裝 watchdog 逾時就結束程序，不猜測狀態。
  Windows NSIS 的 Authenticode 檢查只在有 publisherName 時執行；macOS 依賴 Squirrel.Mac 同團隊簽章；Linux 以 `pkexec dpkg -i`。

### 啟動行為

- 三個選項：「登入電腦時啟動」預設開啟、「關閉視窗時保留在系統匣」預設開啟、「登入後自動開啟主視窗」預設關閉。
- 只有登入啟動、未選擇開啟主視窗、而且系統匣可用時才隱藏主視窗；手動開啟一律顯示，系統匣不可用時也顯示。
- 登入啟動以 `--launch-at-login` 參數（Windows／Linux）或 macOS 的登入項目旗標判斷。
- Windows 寫 HKCU Run，macOS 用 SMAppService，Linux 寫 `~/.config/autostart`。每次啟動依偏好重新同步。
- 單一實例固定開啟；第二次啟動會顯示既有主視窗。

### 已記錄的問題（失敗證據）

- UI 只顯示儲存的偏好，不讀回作業系統狀態；推論每次啟動的同步會重新啟用使用者在工作管理員停用的項目。
- 預設開啟使第一次封裝啟動即註冊登入項目，沒有另外詢問。Linux autostart 路徑寫死，未遵守 `XDG_CONFIG_HOME`。
- 解除安裝不清除 Run 值或 autostart 檔；偏好檔非原子寫入；啟動行為 IPC 未檢查呼叫來源。
- macOS 無父視窗對話框會開在其他視窗後方；已下載的版本被拒後無法重新檢查。
- Linux `app.relaunch()` 帶入 NoNewPrivs 導致下一次 pkexec 失敗；安裝 watchdog 曾與 polkit 認證競爭。
- 未簽章 macOS 版無法自我更新成已簽章版；Windows 尚無正式憑證。

## 本專案現況（2026-10-14 讀碼）

- 主視窗固定 1180×800 置中（macOS／Windows）或預設大小（Linux），最小 380×520；不保存位置、大小或最大化。
  調整遮罩期間，主畫面在有焦點時讓開並在結束時恢復（ADR-042）：Windows 最小化、macOS 縮到 Dock、
  Linux X11 隱藏並以記憶體中的位置還原、layer-shell 最小化；這些都不寫入檔案。
- 桌面場景依顯示器重新計算，卡片位置屬於每個 profile 的 `layout`，會進入備份並隨帳號切換（SPEC-003、SPEC-002）。
- 主機層級資料只有資料目錄中的 `profile.txt` 與 Linux `display-backend.txt`；沒有 registry、UserDefaults 或其他偏好檔。
- 啟動一律顯示主畫面；關閉主畫面在系統匣可用時隱藏，否則保存並結束。沒有登入啟動或命令列選項。
- 資料目錄以 `owner.lock` 防止重複開啟。Linux 的 GtkApplication 會喚起既有視窗，macOS 走一般 reopen；
  Windows 第二個程序只顯示「已開啟」錯誤。
- 沒有版本顯示或更新功能；`host.info` 不含 App 版本，備份的 `appVersion` 一律記成預設 0.1.0。
- 各平台版號獨立。只有 Windows 以 `windows-v<版號>` prerelease 發布 MSIX、`.sha256` 與 CER；macOS／Linux 只有本機建置。
- Renderer CSP 為 `connect-src 'self'`，原生 HTTP 只允許固定 Google 端點並拒絕轉址；隱私說明只列 Google。

## 可移植與平台專屬

- 可移植：版本化主機偏好檔、交集最大的工作區＋夾回＋預設、debounce 加關閉補寫、原子寫入；
  更新狀態機、能力閘門、重新檢查後再下載、穩定錯誤碼；登入啟動判斷、手動開啟必顯示、系統匣不可用時顯示。
- Electron 專屬：`getNormalBounds`、隱藏視窗最大化會顯示、`app.exit` 不觸發 close；
  electron-updater 的 feed、`latest.yml`、NSIS／Squirrel.Mac；`setLoginItemSettings`。
- 本專案需要另行決定：WPF 在 PerMonitorV2 的座標單位、MSIX StartupTask 與使用者停用狀態、
  MSIX 自我更新、macOS 安裝替換、Linux DEB 權限與重啟、GitHub 作為新的網路目的地。

## 推論與未驗證

- 對應建議見 ADR-043／044 與 SPEC-006；都是 Proposed，不代表已實作或已驗收。
- MSIX StartupTask 的登入啟動判斷、`PackageManager` 自我更新後重新開啟、macOS 登入啟動判斷、
  GitHub release 資產轉址主機、公開 repo 的 Actions 計費都需實作時查證或實測。
