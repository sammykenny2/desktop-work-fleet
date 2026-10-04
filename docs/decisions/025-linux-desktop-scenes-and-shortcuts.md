# ADR-025: Linux 桌面場景、快捷鍵與系統匣

## Status

Accepted，2026-10-05；程式已接入，Linux 原生 runtime 尚未執行。

## Context

SPEC-003 要求桌面層級、空白穿透、指定群組／All、快捷鍵與顯示器生命週期。
ADR-024 的 GTK owner 保有唯一 Workspace；場景沿用共用 renderer，不新增另一份卡片權威。

## Decision

- 每螢幕 desktop／floating 各一個透明 GTK／WebKit 視窗；X11 使用窗口層級提示，
  Wayland 使用 GtkLayerShell 的 BOTTOM／TOP。缺少可用 backend 時回報原因並保留主畫面。
- 固定場景 document 與 owner mailbox；場景只取得投影、草稿命令與短效輸入意圖，
  沒有資料庫、Google 或備份能力。傳輸綁定來源、容量與 SHA-256，舊場景／帳號操作失效。
- 原生 input region 依紙面順序裁切，非互動紙面遮蓋下層互動範圍；空白不攔截桌面事件。
  frame 確認後才套用輸入；顯示器變更先撤銷輸入並通知 owner 保存草稿、套用 topology。
- 保留 editor 所在 WebView，工作區／monitor／休眠喚醒均走相同 topology 流程。
  焦點要求需近期原生輸入／shortcut intent；Wayland 使用 portal 提供的 activation token。
- X11 優先 Keybinder 3；其他情況使用 GlobalShortcuts portal。實際 trigger description 顯示於設定。
  App 焦點、組字／editor blocking 與原生對話框釋放全域註冊；恢復時重新建立註冊。
- 系統匣使用 Ayatana／AppIndicator 或 Gtk.StatusIcon，確認可達性後才隱藏主畫面。
  斷線恢復主畫面；退出沿用共用保存流程。原生 menu／file chooser 阻擋全域快捷鍵。

## Consequences

Linux host 已接上共用桌面協定；distribution 提供相關 GI runtime 與 portal backend。
compositor 可以拒絕層級／焦點，缺 backend 時不宣稱已支援桌面功能。
portal session 重建可能再次顯示系統授權對話框；此行為與 X11／Wayland 真實輸入尚未執行。
source tar.gz 不代表原生操作、Debian 安裝或完整五平台發布已完成。

## Alternatives Considered

一卡一窗口會改變共用疊序與編輯生命週期。常駐攔截整個桌面違反空白穿透。
繼續註冊全域快捷鍵而只忽略 callback 無法釋放文字輸入按鍵，因此採用真實解除註冊。

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)、[ADR-024](024-linux-native-owner-and-storage.md)。
- [Linux host](../../src/native/linux/README.md)。
- [GtkLayerShell](https://wmww.github.io/gtk-layer-shell/)。
- [GlobalShortcuts portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html)。

*Decision made: 2026-10-05*
