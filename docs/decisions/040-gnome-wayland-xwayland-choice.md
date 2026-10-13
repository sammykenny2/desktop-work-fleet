# ADR-040: GNOME Wayland 改用 XWayland 的選擇

## Status

Accepted，2026-10-13。維護者要求設定選項與首次啟動詢問；處理 [ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md) 延後的決定。

## Context

GNOME Wayland 沒有 layer-shell，原生 Wayland 啟動時沒有桌面便箋；ADR-039 的桌布層與調整遮罩只在
`GDK_BACKEND=x11` 經 XWayland 時可用。從應用程式選單點圖示會以原生 Wayland 啟動，使用者必須記得手動加環境變數。
改用 XWayland 也會讓主畫面的輸入法與縮放改走 XWayland，所以不應在使用者不知情時自動切換。
GDK 在載入時讀取 `GDK_BACKEND`，選擇必須在 GTK 啟動前生效，不能只存在網頁端。

## Decision

- 資料目錄（預設 `$XDG_DATA_HOME/WorkFleet`，或 `--data`）存放 `display-backend.txt`，值為 `x11` 或 `wayland`，
  以暫存檔、fsync 與 rename 寫入，目錄權限 0700。
- `host.py` 在載入 GTK 前讀取：GNOME Wayland 工作階段（`XDG_SESSION_TYPE=wayland`、`WAYLAND_DISPLAY` 與 `DISPLAY`
  皆存在、`XDG_CURRENT_DESKTOP` 含 GNOME）且使用者沒有設定 `GDK_BACKEND` 時，選擇 `x11` 就設定 `GDK_BACKEND=x11`，
  並以 `WORK_FLEET_GDK_BACKEND` 標記是 Work Fleet 設定的。使用者自己的 `GDK_BACKEND` 一律優先。
- 尚未選擇、目前是原生 GNOME Wayland 且沒有桌面呈現能力時，在開啟資料前以原生對話框詢問一次。
  選擇改用 XWayland 會保存後直接重新執行；選擇維持會保存，之後不再詢問；關閉對話框則本次維持、下次再問。
- 設定的「桌面」頁在 GNOME Wayland 顯示「以 XWayland 顯示桌面便箋」開關；變更後顯示「立即重新啟動」。
  重新啟動沿用一般關閉流程保存草稿並關閉資料，等資料鎖釋放後 `execve` 同一個 host，並依新選擇加上或移除自己設定的
  `GDK_BACKEND`。資料鎖仍被占用時不重新執行，改請使用者自行開啟。關閉流程進行中時忽略重新啟動要求。
- 使用者設定 `GDK_BACKEND` 時，設定列仍顯示但停用並說明由環境變數決定。
- 其他桌面與工作階段不顯示這個設定，也不詢問。

## Consequences

### Positive

- 從選單啟動也能在第一次確認後得到桌面便箋，不需記得環境變數。
- 輸入法與縮放的取捨由使用者明確決定，之後可在設定改回。

### Negative

- 偵測假設 `DISPLAY` 指向可用的 XWayland；GNOME 若停用 XWayland，選擇 XWayland 會讓 App 無法開啟顯示，
  需刪除偏好檔或設定 `GDK_BACKEND=wayland`。
- 重新啟動以 `execve` 取代目前行程，WebKit 子行程隨原 IPC 關閉而結束；`--data` 非預設路徑的重新啟動未實測。

### Neutral

- 只套用在 GNOME，因為只在 GNOME 實測；KDE 等支援 layer-shell 的桌面不需要。

## Alternatives Considered

### Alternative 1: GNOME Wayland 一律自動改用 XWayland

- **Pros**：不需詢問。
- **Cons**：輸入法與縮放在使用者不知情時改變。
- **Why rejected**：維護者要求確認。

### Alternative 2: 修改 desktop entry 加入環境變數

- **Pros**：不需程式。
- **Cons**：DEB 擁有的檔案不應由使用者修改，也無法在 App 內切換。
- **Why rejected**：維護性差，且不符合要在設定中切換的需求。

## References

- [ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md)。
- [GDK_BACKEND](https://docs.gtk.org/gtk3/running.html)。

---

*Decision made: 2026-10-13*
*Decision makers: 維護者*
