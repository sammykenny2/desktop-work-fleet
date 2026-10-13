# ADR-043: 主視窗位置記憶與啟動行為

## Status

Accepted，2026-10-14。使用者要求參考一個 Electron 桌面專案，帶入主視窗位置記憶與「啟動行為」，確認「登入電腦時啟動」預設開啟，
並在同日指示依此開工；SPEC-006 的 Q 仍待回答。參考與證據見 [研究](../resreach/2026-10-14-desktop-window-startup-and-update-reference.md)。

## Context

Windows、macOS、Linux 的主視窗每次都以固定大小置中開啟，不記得使用者調整過的位置、大小或最大化。
App 平常收在系統匣，主畫面可能隱藏數天；期間顯示器可能拔除或改變 DPI，只在啟動時驗證位置不夠。
桌面便箋要在登入後出現，但目前沒有登入啟動；關閉主畫面固定收到系統匣，無法改成結束。

卡片位置等裝置設定存在每個 profile 的 `layout`，會進入完整備份並隨帳號切換（SPEC-002／003）。
主視窗位置屬於這台電腦的視窗外觀，不應因匯入備份或切換 Google 帳號而移動。
主機層級的偏好已有先例：資料目錄的 `profile.txt` 與 Linux `display-backend.txt`（ADR-040）。

MSIX 的登入啟動以 StartupTask 宣告，使用者可在工作管理員或設定停用，App 不能改回；
每次啟動重新註冊、只顯示儲存值，會與使用者在系統中的選擇不一致（參考專案的做法）。

## Decision

### 主機偏好檔

- 資料目錄新增 `host-preferences.json`（啟動行為與更新的 lastCheckedAt）及 `window-placement.json`。
  兩者屬於主機層級：不分 profile、不進入備份或 Google，切換帳號不變。
- 格式含 `version: 1`；無法解析、版本不明或數值無效時視為未設定並使用預設，不阻擋啟動。
  以暫存檔、flush 與 rename 原子寫入。MSIX 解除安裝時隨套件資料清除（ADR-037）。
- Renderer 只透過新增的 `host.*` bridge 方法讀寫，host 驗證內容並回傳實際生效的狀態；bridge protocol 仍為 1。

### 主視窗位置與大小

- 保存還原狀態（normal）的位置與大小，以及是否最大化；不保存全螢幕、最小化或顯示器識別。
- 座標：Windows 以 `GetWindowRect`／`SetWindowPos` 的實體螢幕像素保存與套用，避免 WPF DIP 在混合 DPI 下換算錯誤；
  `WINDOWPLACEMENT` 使用 workspace 座標，不適合拿來對照顯示器工作區。移到不同 DPI 的顯示器會先被縮放一次，所以套用兩次。
  以 `IsZoomed`／`IsIconic` 判斷實際狀態；
  macOS 以 points 的視窗 frame；Linux X11 保存位置與大小，Wayland 只保存大小與最大化（合成器決定位置）。
- 還原：選與保存範圍交集最大的顯示器工作區，必要時縮小並夾回工作區內，再套用最小尺寸；
  與所有顯示器都不相交時使用預設。最大化在主視窗第一次顯示時才套用，登入隱藏啟動不因此顯示。
- 每次從系統匣、第二次啟動或快捷鍵顯示主視窗前都重新驗證，不只在程序啟動時檢查。
- 保存：移動、縮放、最大化變更後 500 ms debounce；收到系統匣、保存並結束、系統登出／關機與更新安裝前補寫一次。
  內容未變不寫；寫入失敗只記錄，不阻擋關閉。
- 最小化與 [ADR-042](042-adjust-overlay-on-every-desktop-host.md) 調整遮罩的讓開／恢復不改變保存的位置；
  恢復仍由主機以自己記住的狀態處理。
- 預設維持 1180×800 置中於主要工作區；工作區較小時縮小到可容納，最小 380×520 不變。
- 設定＞桌面提供「重置主視窗大小與位置」：刪除保存檔並立即套用預設。桌面場景與卡片位置不受影響。

### 啟動行為

設定＞桌面新增「啟動行為」三個選項：

1. 「登入電腦時啟動 Work Fleet」，預設開啟。
2. 「關閉主畫面時保留在系統匣」，預設開啟，即目前行為；關閉時改走既有「保存並結束」流程。
   系統匣不可用時仍一律結束。
3. 「登入啟動後開啟主畫面」，預設關閉：登入啟動時主畫面保持隱藏，桌面便箋照常開始，由系統匣或再次啟動開啟。
   手動開啟一律顯示主畫面；系統匣不可用時也顯示。

作業系統註冊：

- Windows MSIX：manifest 加入 `uap5:StartupTask`（`windows.startupTask` extension），由 App 依偏好
  `RequestEnableAsync` 或 `Disable`。狀態為 `DisabledByUser`／`DisabledByPolicy` 時不嘗試覆蓋，
  設定頁顯示系統狀態並提供開啟 Windows「啟動應用程式」設定（`ms-settings:startupapps`）。
  登入啟動以 StartupTask activation 判斷。ZIP／Debug 不支援登入啟動，選項停用並說明只有安裝版支援；不寫 Run 機碼。
- macOS：`SMAppService.mainApp` 註冊與取消（部署目標 13.0）。`requiresApproval` 時顯示需要在系統設定核准，
  並提供開啟登入項目設定。無法可靠判斷登入啟動時當作手動開啟，顯示主畫面。
- Linux：寫入或移除 `$XDG_CONFIG_HOME/autostart/work-fleet.desktop`（未設定時為 `~/.config`），
  啟動命令加 `--launch-at-login`。讀回時，檔案不存在、`Hidden=true` 或 `X-GNOME-Autostart-enabled=false` 視為關閉。
  只寫或移除自己的檔案。
- Windows 每次啟動與切換選項時同步：`RequestEnableAsync` 對套件桌面 App 不顯示詢問，也不會覆蓋使用者停用。
  macOS 與 Linux 沒有這種保護，只在第一次啟動（尚無 `host-preferences.json`）套用預設，以及使用者切換選項時寫入；
  之後啟動不重新建立使用者移除的項目。讀回的系統狀態與偏好不同時，以系統狀態為準顯示。

### 第二次啟動

Windows 加入每位使用者、每個資料目錄的單一實例通道：第二個程序請既有實例顯示主畫面後正常結束，
不再顯示「已開啟」錯誤。`owner.lock` 仍是最後保護。macOS 沿用 reopen，Linux 沿用 GtkApplication 喚起。

## Consequences

### Positive

- 主視窗回到使用者習慣的位置與大小，換顯示器後也不會開在畫面外。
- 登入後桌面便箋自動出現；尊重使用者在作業系統中停用登入啟動的選擇。
- 隱藏啟動後再次開啟 App 會喚起既有視窗，不再出現錯誤。

### Negative

- 三個平台各自實作座標、註冊與單一實例；混合 DPI 與多顯示器需真硬體驗收。
- 預設開啟使第一次啟動就註冊登入項目；macOS 會出現系統通知。
- Linux DEB 移除時無法清除各使用者的 autostart 檔，需先在設定關閉；留下的檔案指向不存在的命令。

### Neutral

- 解除安裝 MSIX 會同時移除位置、偏好與 StartupTask。

## Alternatives Considered

### Alternative 1: 存在每個 profile 的 `layout`

- **Pros**：沿用既有設定存取與 bridge。
- **Cons**：會進入備份、匯入另一台電腦，切換帳號時主視窗移動。
- **Why rejected**：違反 SPEC-003 共享內容與單機外觀的分界。

### Alternative 2: 依偏好每次重新註冊登入啟動（參考專案的做法）

- **Pros**：實作簡單。
- **Cons**：可能覆蓋使用者在系統中的停用，設定頁顯示與實際不一致。
- **Why rejected**：系統狀態應優先，App 只顯示並引導。

### Alternative 3: Windows 使用 HKCU Run 機碼

- **Pros**：ZIP 也能使用。
- **Cons**：MSIX 解除安裝不會清除，與套件生命週期脫節。
- **Why rejected**：安裝版使用 StartupTask；ZIP 是測試與攜帶用途，不提供登入啟動。

### Alternative 4: macOS 使用 `setFrameAutosaveName`

- **Pros**：系統內建，程式最少。
- **Cons**：格式與驗證規則和其他平台不同，無法共用測試與重置行為。
- **Why rejected**：三平台使用同一份規則與檔案格式。

## References

- [SPEC-006](../specs/006-desktop-window-startup-and-updates.md)、[PLAN-006](../plans/006-desktop-window-startup-and-updates.md)、[研究](../resreach/2026-10-14-desktop-window-startup-and-update-reference.md)
- [ADR-019](019-windows-shortcuts-and-tray.md)、[ADR-020](020-windows-display-lifecycle.md)、[ADR-037](037-msix-data-lifetime-and-google-backup-overwrite.md)、[ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md)、[ADR-040](040-gnome-wayland-xwayland-choice.md)、[ADR-042](042-adjust-overlay-on-every-desktop-host.md)
- [StartupTask](https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.startuptask)、[SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice)、[XDG Autostart](https://specifications.freedesktop.org/autostart-spec/latest/)

---

*Decision made: 2026-10-14*
*Decision makers: 維護者*
