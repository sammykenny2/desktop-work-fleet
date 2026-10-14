# 群組浮動、拖曳轉組與區域提示：平台能力查核

- 日期／外部文件查閱日：2026-10-04。
- 範圍：Windows、macOS，以及已有報告的 Raspberry Pi OS＋labwc／Wayland。
- 性質：公開能力＋來源程式／既有報告查核；本輪未執行新桌面互動或安裝任何依賴。
- 需求入口：[SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)。
- 呈現提案：[ADR-007](../decisions/007-desktop-scene-and-platform-host.md)。

## 1. 結論及證據等級

拖曳卡片、判定群組區域、畫出微亮、放下後更新歸屬，可以作為上述三個目標環境的共同語意。
這是有 API／協定與既有實作支撐的可行性判斷，不是新功能已通過三平台驗收。
Linux 需按 compositor 與功能能力說明支援，不以「有 Wayland」作充分條件。

| 等級 | 本文用法 |
|---|---|
| 公開能力 | 官方文件／協定提供的介面或限制 |
| 既有程式 | 目前 checkout 可讀到的實作，不代表每個分支已測 |
| 外部報告 | 輔助參考專案已有的實測記錄；本 repo 未親自重跑，不移作本產品通過 |
| 設計推論 | 依能力提出的 renderer／host 方案，需在實作與封裝後驗收 |

## 2. 平台矩陣

| 功能 | Windows | macOS | 已記錄的 labwc／Wayland |
|---|---|---|---|
| App 自己追蹤拖曳 | Win32 capture／事件 | AppKit mouseDown/Dragged/Up | surface-local pointer；既有報告有拖曳實測 |
| 自繪目標微亮 | App 繪圖 | App 繪圖 | App buffer／renderer 繪圖 |
| 暫時浮到一般 App 上方 | 原生浮動層可用；最終產品需驗收 | 公開 window level 路徑；新群組浮動仍需驗收 | 報告的 Top layer 在普通視窗之上 |
| 正常狀態滑鼠穿透 | 需 host 正確處理窗口輸入 | 公開 ignoresMouseEvents 可用 | input region；報告已有切層後修正 |
| 任意卡片相對疊序 | 可原生或 renderer 處理 | 可原生或 renderer 處理 | 同層獨立 surface 排序未定義，優先由 renderer 控制 |
| 全域群組快捷鍵 | 可配置／檢查註冊結果 | 需公開快捷鍵方案與封裝驗證 | compositor 綁定／支援的 portal；不能照用 X11 抓鍵 |
| 完整新轉組手勢 | 未實作／未驗收 | 未實作／未驗收 | 未實作／未驗收 |
| 跨螢幕與混合縮放 | 需獨立測試 | 需獨立測試 | 外部報告未做雙螢幕 Pi 驗證 |

微亮是色塊／框線與文字，不需要原生磨砂或背景截圖。
參考應用的既有拖曳不等於已具備九群組、formation、Shift 轉組及 transactional undo。

## 3. Windows

Microsoft 記錄了 mouse capture：按下後持續追蹤，超出視窗仍可收到拖曳事件，放開釋放。
Capture 有前景視窗與單一捕捉者的限制，不能假設背景穿透視窗可同時任意接收全部事件。
群組操作要先進入合法互動狀態；capture 遺失也必須有取消路徑。
來源：[Mouse movement](https://learn.microsoft.com/en-us/windows/win32/learnwin32/mouse-movement)、
[SetCapture](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setcapture)。

SetWindowPos 可調整原生視窗順序／topmost；它是暫時浮動的能力之一，
不是桌面嵌入、圖示上下層及封裝的全部保證。
來源：[SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos)。

設計推論：drag controller 可以把事件轉成裝置邏輯座標，用自己的區域表判定目標，
並讓 renderer 顯示提示。全域快捷鍵與拖曳中的 Shift 是不同事件路徑，不能混用。
Windows 桌面附著、style 被 framework 重寫、DPI 與焦點等舊經驗只作查核方向；
不能因 Win32 有 SetWindowPos 就宣稱所有桌面層或 Store 封裝已完成。

## 4. macOS

AppKit 公開的 mouseDown、mouseDragged、mouseUp 與座標轉換可處理 App 自己的拖曳；
也可在事件中判斷是否進入某區域並要求重畫。
來源：[Handling Mouse Events](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/EventOverview/HandlingMouseEvents/HandlingMouseEvents.html)。

NSWindow.ignoresMouseEvents 是公開的整窗滑鼠穿透屬性。
這不等於已證明任意整屏透明視窗的部分區域能穿透；局部命中策略需由所選 host 驗證。
來源：[ignoresMouseEvents](https://developer.apple.com/documentation/appkit/nswindow/ignoresmouseevents)。

本 repo 的 [0.1.0 報告](../validation/2026-10-03-validation-report.md) 有公開 AppKit、Sandbox、
實際資料更新與鎖定／解鎖旗標的證據；報告同時明列真實桌面手勢與顯示器等未測範圍。
不能因某個歷史 probe 通過就推導新互動、Google OAuth 或 App Store 核准也通過。

設計推論：此次轉組＋微亮不需新增 private API、螢幕錄製或監看其他 App 的內容。
正式 keyboard shortcut／焦點／視窗層策略仍需對所選公開 API、Sandbox 與包裝逐一確認。
不得為取得快捷鍵方便而自行增添 Accessibility 等廣泛權限。

## 5. labwc／Wayland：具體經驗與限制

### 5.1 既有報告的環境

外部報告所載為 Raspberry Pi 5、Raspberry Pi OS（Debian 13 trixie、arm64）、
labwc 0.20.2／wlroots 0.20、pcmanfm-pi、WebKitGTK 2.54、gtk-layer-shell 0.9.0。
資料來自本輪已讀的輔助參考 checkout；其位置不寫死在本 repo，取得方式見第 8 節。

報告記錄：

- Bottom layer 在圖示上、一般視窗下；關閉操作後可點穿到桌面。
- Top layer 可在終端上方拖曳、進入編輯並保存。
- 邏輯位置需自行記錄；不能以 ordinary toplevel 的 outer_position 取得真實座標。
- WebKit 的 screenX/screenY 在該環境為 surface-relative，拖曳需固定抓取點與處理 configure 時序。
- 輸入區域直接設在較低層窗口時，可能被 GTK 重新配置覆蓋；需要可維持的 widget/input-region 路徑及重畫。
- 存在透明重繪／GPU buffer 問題，修正後記錄有快慢拖曳結果；新 renderer 仍需自己的證據。
- 壁紙和圖示在同一 surface 時，無法插到圖示下方；Wallpaper 能力不能冒報。
- 多顯示器未在雙屏 Pi 實測。

這些是外部基礎行為證據，不複製程式碼，也不把其成功歸入本 repo 的驗收。

### 5.2 同層 surface 次序沒有保證

wlr-layer-shell 提供 background、bottom、top、overlay 等層，
但同一層內多個 surface 的相對順序明列為未定義。
因此獨立 native window 的建立順序、hide/show 或重新 map 都不能作穩定輪播契約。
來源：[協定原文](https://github.com/swaywm/sway/blob/master/protocols/wlr-layer-shell-unstable-v1.xml)。

設計推論：尤其在 Wayland，同一輸出、同一系統層的卡片應由共同繪製表面或可明確排序的
等效子表面組織控制；卡片 z-order 成為 app 的資料與繪製順序，而非猜 OS 的 surface 次序。
活動組可轉到浮動呈現層，其餘組留原層；呈現移動不改卡片身份與邏輯 geometry。

### 5.3 命中與輸入

Wayland 的 surface-local 座標與 input region 足以支持自己的目標判定。
Input region 外的事件會交給下一個 surface；這支持不讓透明提示層擋住整個桌面的設計。
應將高亮繪製與可互動命中範圍分開，不能把所有可見色塊都設成截取事件。
來源：[Wayland protocol：set_input_region](https://wayland.freedesktop.org/docs/html/apa.html)。

同時，GTK layer-shell 提供鍵盤互動設定；只在適當操作／編輯時取得需要的鍵盤能力，
不能在背景常駐時以 exclusive keyboard 搶走其他 App 的輸入。
來源：[GTK Layer Shell API](https://wmww.github.io/gtk-layer-shell/)。

### 5.4 全域快捷鍵不是「註冊成功即可」

外部報告的 X11 grab 在 Wayland App 聚焦時收不到按鍵，即使註冊呼叫成功。
該環境採 labwc 設定綁定程式命令的方式；可作新產品的可達替代入口，命令名稱需獨立設計。
若 runtime／桌面提供 GlobalShortcuts portal，可用 session/actions 與 user configuration。
不宣稱每個 compositor 都有相同 portal backend，也不擅自改使用者桌面設定。
來源：[Global Shortcuts portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html)。

### 5.5 Linux 支援範圍

GTK layer-shell 官方列出支援的 Wayland compositor 類型，並明列 GNOME-on-Wayland 與 X11
不使用這條 library 路徑。其他環境需自己的 backend 或清楚的普通視窗替代，
不能把 labwc 的結果標為「所有 Linux 原生桌面便箋皆支援」。
來源：[官方支援範圍](https://github.com/wmww/gtk-layer-shell#supported-desktops)。

同一來源列出的 library 為 LGPL-3.0-or-later；這只是候選 Linux 元件的授權資訊，
不是整個專案必須改成該授權，也不是已完成採用審核。
採用前需確認版本、實際連結／散布方式、notice 與 source obligations；
不能因參考應用或本 repo 標 MIT 就略過轉遞依賴盤點。

## 6. 平台 host 的最低責任

| 責任 | 可驗收結果 |
|---|---|
| Coordinates | 轉換到統一邏輯座標，清楚區分 screen／surface／client／pixel／point |
| Drag tracking | 正常結束、cancel、capture lost 都可清理；一次放下最多一個命令 |
| Layer policy | 群組操作暫時浮起；退出依持久化層級恢復，不持久化暫時 topmost |
| Input regions | 不操作卡與空白桌面仍可點穿；提示不攔住拖曳事件 |
| Focus | 開始編輯可輸入；背景同步不拿焦點；退出不留下幽靈 keyboard grab |
| Shortcuts | 對實際 backend 回報可用、衝突、不支援；有替代入口 |
| Displays | 輸出選擇、縮放、斷線恢復有記錄；未測就明示未測 |
| Capability report | 具體 backend／版本／功能，不以 OS 名稱填滿 true |

## 7. 接下來的驗收不是重做舊 probe

先凍結共用語意與候選 renderer/host 契約，再做相同卡片 fixture 的正式垂直切片。
三平台逐項證明：浮起指定組 → 選卡／輪播 → 拖曳 → 微亮 → 轉組 → 編輯 → 退出穿透。
其中矩陣、期待結果與故障情境已在 SPEC-003 的 C01–C48 定義。
普通 browser demo 可以證明手勢與排序模型，不證明 native 桌面分層／穿透或商店合規。
用現有 Mac 公開 API 經驗，避免另外重啟先前暫停的探索 goal。

## 8. 輔助來源取得與記錄

本文件不寫死外部參考 repo 名稱、remote URL 或 checkout 路徑。
需要原始實作時，請詢問維護者「輔助桌面互動參考專案目前在哪裡」。
取得後先讀其授權及索引，再針對以下主題查核：

- 2026-10-02／03 的 Linux layer-shell、指標座標、重畫、input region 與快捷鍵記錄；
- 顯示／全局操作／唯讀選字／逐卡分層的覆蓋優先序；
- Windows 原生附著、樣式重設與 DPI 問題；
- Mac 層級／焦點時序與既有 private API 依賴邊界。

只記錄本產品需要的結論與可重現情境；不導入其 source tree、UI、資料格式或測試為自己的實作。
若有任何實際第三方程式碼採用，另行記錄真實 provenance／license，
中性參考名稱不能用來省略應保留的法律聲明。
