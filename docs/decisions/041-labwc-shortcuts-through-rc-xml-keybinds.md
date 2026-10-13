# ADR-041: labwc 全域快捷鍵以 rc.xml keybind 轉交 App

## Status

Accepted，2026-10-14。維護者在 Raspberry Pi 5 labwc 回報焦點不在主視窗或主視窗最小化時，快捷鍵無法切換層級；
比較「App 寫入 rc.xml」「只提供設定片段」「暫不處理」後選擇由 App 寫入。

## Context

Linux X11 以 Keybinder 登記全域快捷鍵，其他環境使用 XDG GlobalShortcuts portal（ADR-039 前後的 Linux README）。
labwc 不提供 client 註冊全域快捷鍵的協定；這台 Pi 的 `xdg-desktop-portal` 1.20 搭配 `-wlr` 0.7.1 與 `-gtk` 1.15，
session bus 上的 portal 沒有 `org.freedesktop.portal.GlobalShortcuts`。所以 labwc 上快捷鍵只在 Work Fleet 視窗有焦點時有效。

labwc 自己的 keybind 可以執行指令。headless labwc 0.20.2 以虛擬鍵盤驗證：`C-S-1`、`C-S-d`、`C-S-F5`、`C-A-0` 都會觸發，
字母以未按 Shift 的 keysym 比對；keybind 執行
`gapplication action <app id> shortcut "'Ctrl+Shift+1'"` 時，同一個 session bus 上的 GTK Application 收到字串參數 `'Ctrl+Shift+1'`。
Raspberry Pi OS 以 `labwc -m` 啟動，合併系統 `/etc/xdg/labwc/rc.xml` 與使用者設定；這台沒有使用者 rc.xml。
沒有 `-m` 時，使用者 rc.xml 會取代系統設定。

## Decision

- Linux host 在 layer-shell 下由 `LABWC_PID` 找到執行中的 labwc，從它的 cmdline 判斷合併模式與 `--config-dir`；
  預設使用 `$XDG_CONFIG_HOME/labwc/rc.xml`。App ID 須是合法的 D-Bus 名稱才啟用。這時不使用 portal。
- App 在 D-Bus 匯出 `shortcut` action（字串參數為 Work Fleet 的按鍵，例如 `Ctrl+Shift+1`）。收到時依目前設定找到目標，
  沿用全域快捷鍵的 `desktop-action` 路徑；設定中正在錄製或原生選單開啟時忽略。labwc 不論焦點都會執行 keybind，
  所以 Work Fleet 自己有焦點時同樣經這條路徑，並由有焦點的視窗提供 intent。
- rc.xml 只放按鍵，不放群組；區域快捷鍵改指向其他群組時不用重寫。
- 設定的「快捷鍵」頁在 labwc 上顯示 rc.xml 狀態（未寫入、需要更新、已是目前組合）與寫入按鈕；只在使用者按下時寫入。
  寫入只取代 `Work Fleet shortcuts: begin` 與 `end` 註解之間的區塊，沒有區塊時放在 `<keyboard>` 開頭，必要時建立 `<keyboard>`。
  原檔與結果都必須是 well-formed XML，否則不修改；原檔不是 UTF-8 也不修改。第一次修改既有檔案前複製為
  `rc.xml.work-fleet-backup`，之後不覆蓋備份。以同目錄暫存檔、fsync 與原子替換寫入並保留權限，完成後執行 `labwc --reconfigure`。
- 新建 rc.xml 時，合併模式只放區塊；非合併模式先複製第一個 `XDG_CONFIG_DIRS` 中的 `labwc/rc.xml`，避免失去系統 keybind。
- 寫進 labwc 的組合是可登記的按鍵（Keybinder 同樣規則）；保留給文字編輯、`Ctrl+Alt` 字母等組合不寫入。
  未寫入的組合顯示「尚未寫入 labwc 設定」，不再顯示 portal 的重新註冊按鈕。DEB 推薦 `libglib2.0-bin`（`gapplication`）。

## Consequences

### Positive

- labwc 上快捷鍵在任何程式中都能切換層級、調整群組或顯示桌面便箋，不需要 portal 支援。
- 使用者原本的 rc.xml 內容、註解與 keybind 不變；格式錯誤時不會被覆寫，備份保留第一次修改前的版本。

### Negative

- 變更快捷鍵組合後要再按一次寫入；App 移除後區塊仍留在 rc.xml，按鍵會執行找不到 App 的 `gapplication`。
- labwc 在任何焦點下都攔截這些組合，其他程式收不到；文字輸入中按到也會觸發。設定頁錄製新組合時，已寫入的組合會被 labwc 攔截。
- 同一使用者的其他程式可經 session bus 觸發 `shortcut` action；只接受目前設定中的按鍵，效果與按下快捷鍵相同。
- labwc 執行指令時不一定附 activation token，需要把主畫面帶到前景的動作（例如快速記錄）在其他程式有焦點時可能無法取得焦點。

### Neutral

- 只在一台 Pi 5 labwc 0.20.2 實測；`--config-dir`、非合併模式與 `openbox_config` 根元素只有單元測試。
- 其他 wlroots compositor（sway、Hyprland、wayfire）仍沒有全域快捷鍵。

## Alternatives Considered

### Alternative 1: 只提供設定片段

- **Pros**：App 不修改使用者的 compositor 設定。
- **Cons**：使用者要自己編輯 XML、轉換按鍵語法，並在每次變更組合時手動同步。
- **Why rejected**：維護者選擇由 App 寫入。

### Alternative 2: 暫不處理

- **Pros**：沒有修改使用者設定的風險。
- **Cons**：labwc 上快捷鍵只在 Work Fleet 視窗有焦點時有效，主視窗最小化後無法切換層級。
- **Why rejected**：Pi 是原定主要目標，這正是維護者回報的問題。

### Alternative 3: 等待 portal 或自行實作輸入監聽

- **Pros**：與其他桌面一致，或不依賴 labwc。
- **Cons**：wlroots portal 沒有 GlobalShortcuts；讀取輸入裝置需要額外權限，違反不做鍵盤 hook 的原則。
- **Why rejected**：前者沒有時程，後者不可接受。

## References

- [ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md)、[ADR-040](040-gnome-wayland-xwayland-choice.md)、
  [Linux README](../../src/native/linux/README.md)。
