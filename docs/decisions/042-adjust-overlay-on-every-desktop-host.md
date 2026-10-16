# ADR-042: 所有桌面主機的調整模式都是遮罩

## Status

Accepted，2026-10-14。維護者在 Raspberry Pi 5 labwc 使用遮罩後，要求有桌面分層的平台行為一致；
更新 [ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md) 中只限 GNOME XWayland 與 layer-shell 的遮罩範圍，
並要求進入調整模式前已最小化的主視窗，結束後維持最小化。

## Context

ADR-039 為 GNOME XWayland 引入調整遮罩：最上層場景染暗整個工作區並接收所有點擊，上方有「堆疊、攤開、復原、完成」，
主視窗在調整期間收起。之後 layer-shell 也改用遮罩，但 GNOME Xorg、其他 X11、Windows 與 macOS 仍在原處拖曳，
主視窗不動。macOS 場景命令也不接受遮罩工具列送出的 `interaction.done` 與 `layout.arrange`。

主視窗原本在任何調整開始時都會收起、結束時都會叫回。主視窗已被使用者最小化時以全域快捷鍵進入調整模式，結束後它會跳出來。
Wayland 不告訴 App 視窗已被最小化（GTK 的 iconified 狀態不變），所以無法用視窗狀態判斷；
遮罩出現後會取得鍵盤焦點，焦點也必須在遮罩出現之前讀取。

## Decision

- 每個桌面主機都回報 `adjustOverlay`（最上層場景的 view 也回報），共用的場景與主畫面依此顯示遮罩與工具列，接受
  `interaction.done` 與 `layout.arrange`。常駐層不受影響：只有 GNOME XWayland 仍只常駐桌布層。
  - Linux：X11 與 layer-shell 都使用遮罩；X11 以工作區、layer-shell 以整個螢幕為範圍，作法沿用 ADR-039。
  - Windows：frame 解析 `operationScope`；調整中的最上層場景以整個 viewport 為輸入區域，沒有便箋也顯示，
    出現時啟用輸入視窗讓 Esc 立即有效。
  - macOS：frame 解析 `operationScope`；調整中改以一個覆蓋整個螢幕的透明 hit panel 轉送點擊，出現時讓 nonactivating
    場景 panel 成為 key window，Esc 立即有效而不把 App 帶到前景；結束時交還鍵盤。
- 主畫面在調整開始的當下（遮罩出現之前）讀取 `document.hasFocus()`。只有主畫面有焦點時才要求 `desktop.mainVisible(false)`，
  並在結束時要求 `desktop.mainVisible(true)`；已最小化、在系統匣或在其他程式後方的主視窗不動，結束後也不叫回。
  主機也只恢復自己收起的主視窗。
  - Linux X11 隱藏（有系統匣時收進系統匣）並還原位置；layer-shell 最小化並以 xdg-activation 叫回，被拒絕時重新顯示。
  - Windows 最小化，恢復時還原原本的一般或最大化狀態並啟用。
  - macOS 縮到 Dock，恢復時展開並帶到前景。

## Consequences

### Positive

- 所有桌面平台的調整模式看起來與操作方式相同，遮罩上的按鈕在 macOS 也能使用。
- 使用者已最小化的主視窗不會因為調整模式被叫出來。

### Negative

- 調整期間其他程式與工作列、選單列都無法點選；場景卡住時要等 App 結束或重新整理才恢復滑鼠。
- 主視窗顯示中但沒有焦點時，以全域快捷鍵進入調整模式，主視窗留在原位被遮罩染暗。
- 初版 Windows 與 macOS 的修改在 Raspberry Pi 上撰寫，當時沒有編譯或實機執行。2026-10-16 Windows 已補修首次握手並執行原生回歸；
  macOS 仍需建置與實機執行，不能把共用 renderer 與測試原始碼當作各平台已驗收。

### Neutral

- 不支援桌面分層的瀏覽器預覽沒有遮罩，調整仍在主畫面進行。

## Alternatives Considered

### Alternative 1: 只在 Linux 使用遮罩

- **Pros**：Windows 與 macOS 不用改，維持既有已驗收的行為。
- **Cons**：同一個產品在不同平台的調整方式不同，macOS 也無法使用遮罩工具列。
- **Why rejected**：維護者要求有桌面分層的平台行為一致。

### Alternative 2: 以視窗狀態判斷主視窗是否已最小化

- **Pros**：不依賴焦點，主視窗在其他程式後方時也能讓開。
- **Cons**：Wayland 不提供最小化狀態；各平台的判斷方式不同。
- **Why rejected**：焦點是每個主機都能可靠取得的訊號。

## 2026-10-16 Windows 首次握手修正

Windows 的 `desktop.info` 與後續 viewport 更新有 `adjustOverlay`，但首次 `scene.info` 另組回覆時漏傳此欄位，
導致剛開啟就調整時只有可移動的便箋，沒有浮動工具列。改為三者共用 `ViewInfo`；Linux 與 macOS 原本已共用各自的 view info。

三平台沿用 `src/desktop/scene.js` 的同一組「堆疊、攤開、復原、完成」，全部／此組調整皆適用；
完成先保存草稿再離開，輸入法組字時不得退出；Esc 依 SPEC-003 先取消目前拖曳或編輯，再退出調整。
主視窗是否讓開與恢復仍由調整開始時的焦點決定，原本已最小化者維持最小化。

Windows 新增真 WPF／WebView2 首次調整回歸，檢查工具列、排列／復原、完成、Esc、草稿／IME 與已最小化主視窗；
Mac layer probe 增加能力與全 viewport 輸入／釋放檢查。實際執行結果與未驗收範圍見 PROGRESS.md 及測試文件。

## References

- [ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md)、[ADR-041](041-labwc-shortcuts-through-rc-xml-keybinds.md)、
  [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)。
