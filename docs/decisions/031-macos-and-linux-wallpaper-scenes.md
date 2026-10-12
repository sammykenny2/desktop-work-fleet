# ADR-031: macOS 與 Linux 桌布場景及切層回復

## Status

Accepted，2026-10-05。更新 ADR-023／025 的兩層限制；實測結果記於 PROGRESS。
Linux X11 場景尺寸、GNOME 的層級對應與 DMA-BUF 預設由 [ADR-039](039-gnome-desktop-icons-and-x11-scene-size.md) 更新。

## Context

Windows 已提供三層；macOS 與 Linux 仍只建立 desktop／floating，桌布偏好回退。
維護者要求三平台补齊，並要求接續輔助參考專案已有的原生實測成果。
Pi／labwc 的紀錄已確認三層切換、拖曳、保存、重畫及 input shape 的問題，不能重新把環境當未知。

## Decision

- macOS 每螢幕增加 wallpaper visual panel，使用公開 `desktopWindow + 1`，位於桌布上、
  `desktopIconWindow` 下。desktop 維持 `desktopIconWindow + 1`，floating 維持 `.floating`。
  三層共享同一 owner 投影，最多 16 螢幕／48 場景；topology 重用時納入第三層。
- Linux layer-shell 增加 BACKGROUND；desktop 使用 BOTTOM，floating 使用 TOP。
  `wallpaperPlacement: background` 明示這是背景 band。pcmanfm 將桌布與圖示畫在同一 surface 時，
  BACKGROUND 便箋仍可能位於圖示上方；不宣稱協定提供可插入該 surface 內的能力。
  X11 保留 desktop／floating，桌布偏好明示回退，不新增假的第三層。
- 桌布 frame 禁止 interactive／draggable／editing；兩個 native surface 另拒絕輸入及 focus，
  共用 controller 在操作指定組／All 時暫轉 floating，退出按當下常駐偏好還原，geometry 不變。
- GTK input shape 存在 widget 上，避免 allocation 覆蓋；每次更新 queue draw，並在暫停時清空
  region 與鍵盤需求。layer-shell 明確使用 viewport 的 size request，不靠 ordinary window resize。
- Linux 在使用者未指定時停用 DMA-BUF renderer。map／configure／frame 套用後合併發出重畫事件，
  renderer 暫變 root opacity 並在兩個 animation frames 後復原，處理透明 WebKit 殘留畫面。
- 新增使用實際來源的 Mac 原生 probe 與隔離 Linux／labwc probe；合成投影由共用 Workspace／
  InteractionController 產生，沒有複製參考產品的 UI、程式、資產或資料格式。

## Consequences

Windows、macOS、Linux layer-shell 均有原生三層的程式連接；Linux 的背景 band 不等同所有桌面
都有圖示下方能力。維持參考實測的範圍與已知限制，不改使用者桌布檔案或桌面設定。
Mac source probe 可在圖形 session 用 Xcode command-line tools 編譯，無須 Google SDK；
本機 Windows 無 Apple SDK，不能把未執行的 Swift／WindowServer 測試記為通過。
Linux headless compositor 測試不取代 Pi／V3D、pcmanfm-pi、實體中文輸入法或多顯示器驗收。

## Alternatives Considered

繼續兩層回退不符合功能補齊要求。只把 layer-shell BACKGROUND 稱為「圖示下方」會誤報。
將便箋合成到使用者桌布檔案會引入不同的保存與桌布還原流程，超出本次依既有原生成果接續的範圍。
不採用一張卡一個資料 owner 或改用參考產品的 Tauri／Rust 架構。

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)、[ADR-030](030-windows-explorer-wallpaper-layer.md)。
- [本次參考核對](../resreach/2026-10-05-desktop-layer-reference-follow-through.md)。
- [CGWindowLevelKey](https://developer.apple.com/documentation/coregraphics/cgwindowlevelkey)。
- [wlr-layer-shell 原始協定](https://github.com/swaywm/wlr-protocols/blob/master/unstable/wlr-layer-shell-unstable-v1.xml)。
- [GtkLayerShell](https://wmww.github.io/gtk-layer-shell/)、[Gtk widget input shape](https://docs.gtk.org/gtk3/method.Widget.input_shape_combine_region.html)。

*Decision made: 2026-10-05*
