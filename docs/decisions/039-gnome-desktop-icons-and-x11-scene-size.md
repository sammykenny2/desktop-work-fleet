# ADR-039: GNOME 桌面圖示下的層級對應與 X11 場景尺寸

## Status

Accepted，2026-10-13。維護者在 Ubuntu 22.04 GNOME 實機回報後選擇此方案；更新 ADR-031 的 Linux X11 兩層描述。
同日另更新 ADR-031 的 DMA-BUF 預設：只在 Raspberry Pi／V3D 停用。
同日修訂：最上層在 GNOME 會鎖住其他視窗，維護者選擇群組只常駐桌布層，調整模式改為覆蓋工作區的遮罩並隱藏主視窗。
同日再修訂：GNOME Xorg 實測沒有這些限制，改用三層；只常駐桌布層與遮罩只用於 GNOME Wayland 工作階段（XWayland）。
2026-10-14 修訂：維護者在 Raspberry Pi OS labwc 選擇所有 layer-shell 桌面也以遮罩調整，常駐層維持三層，主視窗同樣隱藏。
同日再修訂：Pi 停用 DMA-BUF renderer 時，滑鼠移過場景就整片消失；Pi 改為保留 DMA-BUF renderer 並使用共享記憶體 buffer。

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

拖曳或堆疊、攤開、復原移動便箋後，原處留下殘影；擷取場景視窗本身可見殘影，強制整窗重畫後消失。
獨立的透明 WebKit 視窗移動一張便箋即可重現：`WEBKIT_DISABLE_DMABUF_RENDERER=1`（ADR-031 的 Linux 預設）時舊位置留下殘影，
在視窗或 WebView 的 draw 先清成透明也無效；不設定或設為 `0` 改用 DMA-BUF renderer 時沒有殘影。
維護者以 `WEBKIT_DISABLE_DMABUF_RENDERER=0` 啟動 App 後確認殘影消失。這台 x86 VM 沒有 Pi 的 device-tree model 或 V3D 驅動。

Pi 5 labwc 改用調整遮罩後，維護者回報遮罩出現後只要移動滑鼠，工具列、校準線與便箋就整片消失，但滑鼠仍被擋住、Esc 仍有效。
headless labwc 以合成的 GTK 指標事件重現：只有移入不會消失，移動才會；GTK 重畫救不回，強制 WebKit 整頁重畫可恢復。
鍵盤改回 ON_DEMAND 同樣消失，沒有遮罩時滑過常駐最上層便箋也會消失，所以是停用 DMA-BUF renderer 時 WebKit 原有的問題；
常駐合成圖層、固定游標與停用硬體加速都無效。保留 DMA-BUF renderer 並設 `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` 時，
headless 移動滑鼠後畫面完整、移走的便箋沒有殘影；維護者在 Pi 5 實機確認調整模式恢復正常，未回報黑塊、花屏或殘影。

最上層同樣受限。群組設為最上層或進入調整模式後，使用者無法點選其他程式，也無法拖曳或縮放主視窗；
最上層視窗隱藏或 App 結束後恢復，期間鍵盤仍可輸入其他程式。持續記錄顯示 input shape 只有便箋範圍，沒有 X 獨占或 XDND。
以獨立的 keep-above XWayland 視窗（只有中央方框接收輸入）對照：

- 不接受焦點時正常，點住、拖曳方框或讓主視窗持有焦點後也正常。
- 取得焦點後鎖住；只留方框的 bounding shape、NORMAL 類型都一樣，改把焦點交給主視窗也不能解除。
- App 把最上層改為永不接受焦點後，進入調整模式（主視窗持有焦點、尚未拖曳）仍會鎖住；改用 DMA-BUF 也一樣。
  與獨立視窗的差異只剩同一 client 與 WebKit 內容，原因未判定。

維護者定義的桌面層與最上層都包含焦點，以便用鍵盤快速複製文字，所以不提供沒有焦點的常駐最上層。
調整模式既然會讓其他視窗無法點選，就改成明確的模式：遮罩覆蓋工作區、主視窗隱藏、遮罩上提供操作按鈕。

之後在同一台 VM 以 xrdp 的 GNOME Xorg 工作階段（`XDG_SESSION_TYPE=x11`、沒有 `WAYLAND_DISPLAY`）以獨立視窗對照：

- keep-above 視窗取得焦點後，終端機與主視窗仍可點選、拖曳；XWayland 的鎖住不會發生。
- DING 在 Xorg 是 X11 desktop-type 視窗。desktop-type 測試視窗一開始在 DING 上方可點，但使用者點過桌面後
  DING 升到它上方，之後點擊都由 DING 接收。
- 一般視窗加 keep below 位於 Mutter 的 BOTTOM 層，始終在所有 desktop-type 視窗（含 DING）上方、一般視窗下方；
  點過桌面後仍可點，方框外的桌面圖示照常可用。
- 對 desktop-type 視窗呼叫 lower 被 Mutter 忽略，啟動時仍在 DING 上方，要等 DING 被點而升起後才在圖示下方。

## Decision

- 所有 X11 場景視窗與 layer-shell 一樣設定 viewport 的 size request，X11 另保留 `move()`／`resize()`。
- X11 場景的 viewport 改用螢幕工作區（GDK 讀取 `_NET_WORKAREA`），layer-shell 仍涵蓋整個螢幕，
  讓視窗落在要求的位置，不被視窗管理員移開。
- `XDG_CURRENT_DESKTOP` 以 `:` 分隔後含 `GNOME`（不分大小寫），且是 GNOME Wayland 工作階段（`XDG_SESSION_TYPE=wayland`
  或有 `WAYLAND_DISPLAY`）經 X11 backend 時，Linux host 建立 `wallpaper` 與 `floating` 場景，但 `residentLayers` 只有 `wallpaper`。桌布層使用 X11 desktop-type、keep below，
  沿用桌布的空 input region 與拒絕輸入，在 DING 圖示下方且滑鼠穿透。`wallpaperPlacement` 回報 `desktop-window`，
  不冒稱 layer-shell 背景 band。
- 同一環境回報 `adjustOverlay`。調整模式時每個螢幕的最上層場景都顯示並以整個工作區為 input region，
  畫上約 35% 不透明的深灰遮罩，調整中的便箋在遮罩上方可拖曳；出現時 present 取得焦點，鍵盤可用。
  遮罩上方提供「堆疊、攤開、復原、完成」：堆疊與攤開直接套用到調整中的範圍並保持尺寸，復原同主畫面，完成結束調整模式。
- layer-shell 桌面同樣回報 `adjustOverlay`，但這是維護者選擇的操作方式而非限制，`residentLayers` 維持桌布、桌面、最上層三層。
  遮罩涵蓋整個螢幕，包括面板。on-demand 的 layer surface 要被點過才取得鍵盤，`present()` 對它無效，所以調整期間最上層
  改用 EXCLUSIVE 鍵盤模式讓 Esc 立即可用，結束後回到 ON_DEMAND。不在調整範圍的最上層常駐便箋畫在遮罩下方，與其他層一致。
- GNOME Xorg 工作階段提供桌布、桌面、最上層三層且都可常駐，沒有遮罩，調整模式與其他 X11 相同。
  桌面層使用一般視窗加 keep below，穩定位於 DING 上方且可選字、取得焦點；桌布層仍是 desktop-type 視窗並滑鼠穿透，
  啟動後到使用者點過桌面前可能顯示在圖示上方；最上層 keep above 並可取得焦點。其他 X11 桌面維持 desktop-type 桌面層。
- 調整模式開始後隱藏主視窗，任何方式結束後恢復；隱藏等遮罩畫面發布、恢復等去掉遮罩的畫面發布。
  視窗管理員會重新安排再次顯示的視窗，所以隱藏前記下位置、大小與最大化狀態並在顯示前還原。
  Wayland 不讓 App 指定視窗位置，layer-shell 桌面只還原大小與最大化狀態，位置由 compositor 決定。
  詳細資料、完整編輯器與快速記錄需要主視窗，先結束調整模式。
- 共用投影區分場景層 `layers` 與常駐層 `residentLayers`（預設相同）。常駐便箋要求的層不能常駐時，
  改放桌面層或桌布層並列入 `fallbacks`；調整中的便箋可用任何場景。落在桌布層的便箋一律不可互動、拖曳或編輯。
  保存的群組偏好不改寫，回到支援的環境即恢復。
- 只有 `/proc/device-tree/model` 含 Raspberry Pi 或存在 `/sys/module/v3d` 時，使用者沒有設定 `WEBKIT_DISABLE_DMABUF_RENDERER`
  或 `WEBKIT_DMABUF_RENDERER_FORCE_SHM` 才預設 `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`：保留 DMA-BUF renderer，不使用 V3D 的
  DMA-BUF buffer；其他機器沿用 WebKit 預設，使用者的明確設定仍優先。
- 群組快捷鍵略過不能常駐的層級，進入調整模式時不改寫常駐層；群組設定停用不能常駐的層級（目前所在層除外），
  設定頁依實際回退方向說明，快捷鍵說明列出本機實際的循環順序。

## Consequences

### Positive

- X11 便箋不再被裁成 200×200，也不再因工作列被推離原位；所有 X11 桌面都受益。
- GNOME 上的層級名稱與實際行為一致，不再出現看得到卻無法點的「桌面層」。
- GNOME 的調整模式看得出來、可完整操作，不會在一般使用時意外鎖住其他視窗。
- Windows、macOS 與 layer-shell 的層級組合不變；layer-shell 的調整模式和 GNOME 一樣明確，主視窗不會遮住調整中的便箋。

### Negative

- GNOME 沒有常駐的桌面層與最上層；選字、複製與編輯在調整模式或主畫面進行。
- 調整模式中其他程式依設計無法點選；若場景卡住，滑鼠會一直被擋到 App 結束，鍵盤仍可操作其他程式。
  layer-shell 調整期間面板也無法點選，鍵盤由遮罩獨占；場景卡住時滑鼠與鍵盤都要等 App 結束才恢復。
- 遮罩上的堆疊與攤開不提供調整尺寸選項；需要時從主畫面的對話框操作。
- X11 便箋超出工作區（工作列、Dock 下方）的部分會被裁掉；工作區改變（例如 Dock 自動隱藏）時，
  既有的顯示器變更流程會一併調整場景視窗大小。
- GNOME Wayland 要經 XWayland 才有桌面便箋；改用 XWayland 會連帶影響主畫面的輸入法與縮放，
  由使用者在首次啟動或設定中選擇，見 [ADR-040](040-gnome-wayland-xwayland-choice.md)。
- GNOME 42 Wayland 沒有 GlobalShortcuts portal，XWayland 的 X11 全域快捷鍵也可能收不到按鍵，
  切換層級主要透過群組設定。

### Neutral

- GNOME Xorg 只在 xrdp 遠端工作階段驗證；本機 Xorg 登入、GNOME Flashback 等同樣宣告 `GNOME` 的工作階段未實測。
- 其他 X11 桌面的檔案管理員也以 desktop-type 視窗畫圖示，桌面層可能同樣在點過桌面後被蓋住；未實測，暫不改變。
- GNOME 上最上層鎖住其他視窗的根本原因仍未判定，遮罩是以此行為為前提的設計。
- 殘影來自共享記憶體 renderer，改用 DMA-BUF 後消失。
- layer-shell 遮罩只在 Raspberry Pi 5 的 labwc 實機確認；wayfire、sway、KDE Plasma Wayland 等其他 compositor 未實測。
- 非 Pi 的 Linux 改用 DMA-BUF renderer，GPU／驅動相容性只在這台 x86 VM 確認；Pi 以外有相同錯亂的機器可自行設定環境變數。
- Pi 的共享記憶體 buffer 只在一台 Pi 5（WebKitGTK 2.54）短時間使用確認；Pi 4、wayfire 與長時間使用未實測。
  原本停用 DMA-BUF 所依據的 V3D 錯亂來自參考專案的回報，這次沒有以完整 DMA-BUF 重新驗證。

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

### Alternative 4: 不取得焦點的常駐最上層或調整模式

- **Pros**：保留在所有視窗上方的便箋或桌面拖曳，不必遮住整個桌面。
- **Cons**：沒有焦點就不能用鍵盤複製；實測不取得焦點的調整模式仍會鎖住其他視窗。
- **Why rejected**：不符合維護者對最上層的定義，也無法避免鎖住。

### Alternative 5: GNOME 只留桌布層，以主畫面堆疊、攤開、復原

- **Pros**：完全不使用最上層，不會鎖住任何視窗。
- **Cons**：無法在桌面上拖曳單張便箋，也看不出正在整理。
- **Why rejected**：維護者實測後希望保留調整模式，改以遮罩明示。

## References

- [ADR-031](031-macos-and-linux-wallpaper-scenes.md)、[SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)。
- [平台可行性研究 5.5](../resreach/2026-10-04-desktop-interaction-platform-feasibility.md)。
- [gtk-layer-shell 支援的桌面](https://github.com/wmww/gtk-layer-shell#supported-desktops)。
- [Desktop Icons NG](https://gitlab.com/rastersoft/desktop-icons-ng)。
- [GtkWindow resizable](https://docs.gtk.org/gtk3/method.Window.set_resizable.html)。

---

*Decision made: 2026-10-13*
*Decision makers: 維護者*
