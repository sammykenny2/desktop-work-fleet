# ADR-039: GNOME 桌面圖示下的層級對應與 X11 場景尺寸

## Status

Accepted，2026-10-13。維護者在 Ubuntu 22.04 GNOME 實機回報後選擇此方案；更新 ADR-031 的 Linux X11 兩層描述。

## Context

Ubuntu 22.04 預設 GNOME Shell 42（Mutter）Wayland 不提供 wlr-layer-shell，`GtkLayerShell.is_supported()` 為 false，
Linux host 回報 `desktop-unsupported`；群組層級設定因沒有桌面呈現能力而不顯示。
維護者以 `GDK_BACKEND=x11` 經 XWayland 啟動後回報兩個問題：

- 場景視窗只有 200×200。`xwininfo` 顯示螢幕 1024×768、工作區起點 +70+27，最上層視窗位於 +70+27
  但維持 200×200，擷取的視窗內容只剩便箋左上角。場景視窗設為不可調整大小，GTK 3 以 size request
  決定其尺寸並忽略 `resize()`；ADR-031 只在 layer-shell 分支設定 viewport size request。
  補上 size request 後，以整個螢幕為範圍的最上層視窗變成 `1024x768+0+27`：Mutter 把一般視窗的上緣推到頂部工作列下方，
  便箋因此比應有位置低 27 像素。先前 200×200 視窗出現在 +70+27 也是同一個工作區限制，不是程式要求的位置。
- 桌面層看得到便箋但無法選字，行為像桌布層。Ubuntu 的桌面圖示由 DING 擴充以全螢幕透明的一般視窗呈現，
  每次被提升就呼叫 `lower()`（`emulateX11WindowType.js`），整個桌面範圍都接收輸入。
  X11 desktop-type 視窗在 Mutter 的 DESKTOP 層，低於一般視窗層，因此位在 DING 下方：
  DING 透明處可見便箋，點擊則由 DING 接收。這是依 Mutter 層級規則與 DING 原始碼推得，
  X11 工具看不到 Wayland 視窗，沒有直接觀察到 DING 的堆疊位置。

`keep_below` 只會進入 BOTTOM 層，仍低於 DING；一般 X11 client 也無法相對 Wayland 視窗重排。
要在 GNOME 提供可互動的桌面層，只能由 GNOME Shell 擴充等 Shell 內部機制安排堆疊。

## Decision

- 所有 X11 場景視窗與 layer-shell 一樣設定 viewport 的 size request，X11 另保留 `move()`／`resize()`。
- X11 場景的 viewport 改用螢幕工作區（GDK 讀取 `_NET_WORKAREA`），layer-shell 仍涵蓋整個螢幕，
  讓視窗落在要求的位置，不被視窗管理員移開。
- `XDG_CURRENT_DESKTOP` 以 `:` 分隔後含 `GNOME`（不分大小寫）且使用 X11 backend 時，Linux host 只提供
  `wallpaper` 與 `floating`。桌布層使用 X11 desktop-type、keep below，沿用桌布的空 input region 與拒絕輸入，
  在 DING 圖示下方且滑鼠穿透。`wallpaperPlacement` 回報 `desktop-window`，不冒稱 layer-shell 背景 band。
- 共用投影接受只有桌布層或只有桌面層的組合。常駐層缺少時改放另一個常駐層並列入 `fallbacks`；
  落在桌布層的便箋一律不可互動、拖曳或編輯。保存的群組偏好不改寫，回到支援的環境即恢復。
- 群組快捷鍵略過主機沒有的層級；群組設定停用不可用的層級（目前所在層除外），設定頁依實際回退方向說明，
  快捷鍵說明列出本機實際的循環順序。
- 操作群組時仍暫轉最上層，因此 GNOME 上可在最上層選字、編輯與拖曳。

## Consequences

### Positive

- X11 便箋不再被裁成 200×200，也不再因工作列被推離原位；所有 X11 桌面都受益。
- GNOME 上的層級名稱與實際行為一致，不再出現看得到卻無法點的「桌面層」。
- Windows、macOS 與 layer-shell 的層級組合與行為不變。

### Negative

- GNOME 沒有可選字的常駐桌面層；需要互動時要暫轉或改設最上層。
- X11 便箋超出工作區（工作列、Dock 下方）的部分會被裁掉；工作區改變（例如 Dock 自動隱藏）時，
  既有的顯示器變更流程會一併調整場景視窗大小。
- GNOME Wayland 仍需手動以 `GDK_BACKEND=x11` 啟動才有桌面便箋；預設圖示啟動維持原生 Wayland 並回報不支援。
  是否在 GNOME Wayland 自動改用 XWayland（會連帶影響主畫面的輸入法與縮放）尚待另行決定。
- GNOME 42 Wayland 沒有 GlobalShortcuts portal，XWayland 的 X11 全域快捷鍵也可能收不到按鍵，
  切換層級主要透過群組設定。

### Neutral

- 正規 GNOME Xorg 工作階段同樣套用此對應，但未實測；GNOME Flashback 等同樣宣告 `GNOME` 的工作階段也未實測。
- 拖曳陰影殘留須在尺寸修正後重新確認；若仍存在，下一步檢查 XWayland 透明視窗的重畫流程。

## Alternatives Considered

### Alternative 1: GNOME Shell 擴充

- **Pros**：可把便箋視窗排在 DING 與一般視窗之間，提供真正的桌面層。
- **Cons**：需另行開發、簽署與隨 GNOME 版本維護，安裝流程也不同於 DEB 依賴。
- **Why rejected**：超出本次修正範圍；需要時另立 ADR。

### Alternative 2: 維持桌面層名稱

- **Pros**：不需修改共用投影。
- **Cons**：便箋可見卻不可互動，與「在圖示上方，可選取文字」的說明相反。
- **Why rejected**：誤報能力，正是維護者回報的問題。

### Alternative 3: 改用 keep below 的一般視窗

- **Pros**：不使用 desktop-type。
- **Cons**：仍位於 Mutter BOTTOM 層，低於 DING；DING 也會在被提升時自行降到最底。
- **Why rejected**：無法改善輸入。

## References

- [ADR-031](031-macos-and-linux-wallpaper-scenes.md)、[SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)。
- [平台可行性研究 5.5](../resreach/2026-10-04-desktop-interaction-platform-feasibility.md)。
- [gtk-layer-shell 支援的桌面](https://github.com/wmww/gtk-layer-shell#supported-desktops)。
- [Desktop Icons NG](https://gitlab.com/rastersoft/desktop-icons-ng)。
- [GtkWindow resizable](https://docs.gtk.org/gtk3/method.Window.set_resizable.html)。

---

*Decision made: 2026-10-13*
*Decision makers: 維護者*
