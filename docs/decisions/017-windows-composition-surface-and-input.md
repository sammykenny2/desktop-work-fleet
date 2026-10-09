# ADR-017: Windows 透明場景、輸入區域與平台基礎

## Status

2026-10-05：常駐層級由 [ADR-030](030-windows-explorer-wallpaper-layer.md) 更新為 Explorer 附著。
下方不使用 WorkerW、一般底部視窗等內容為原始切片的歷史限制；其餘 composition／輸入責任保留。
2026-10-09：附著場景的白底／backing bitmap 與撤下順序由 [ADR-035](035-windows-attached-scene-background-lifecycle.md)
更新；下方 2026-10-06 的不透明宿主描述保留為歷史，不代表已修復 23H2 殘影。

Accepted，2026-10-04，限 Windows 場景表面、原生輸入區域、快捷鍵註冊與顯示器盤點。
主畫面與共用控制器的桌面協調仍須整合；本子切片不啟用 `desktopPresentation` capability。
不以這些 primitive 的測試宣稱 C16／C35／C40–C43／C46–C47 完整通過。

## Context

同一系統層內須由 renderer 控制卡片順序，並支援可操作與穿透紙面相互遮擋。
一般 WPF WebView2 為 HWND host，透明整窗不能直接證明跨程序的逐卡命中。
需先驗證實際 WebView2 像素、OS 命中與表面生命週期，才能接入資料權威。

## Decision

- 採 `WebView2CompositionControl`；每個場景只有一個瀏覽器及兩個 WPF layered windows。
  一個包含真正的 WebView 及互動區域，一個以 `VisualBrush` 呈現同一份視覺。
  被動表面使用 `WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`。
  自身 WebView 視覺的 composition 不捕獲桌面或其他 App 畫面。
- 依 renderer 的由後到前紙面清單，建立 native region：可互動紙面加入，前方穿透紙面扣除。
  平衡分組合成 `(covered, input)`，避免逐張 union 大型 region 的平方成本。
  上限 20,000 紙面；非法幾何不改現有政策，原生區域配置失敗隱藏兩面。
- 視覺面 region 是整個場景扣掉 input region，兩者完整覆蓋且互斥。
  紙面半透明像素只畫一次；圓角／透明像素仍受 layered window alpha 命中規則約束。
  初建及退出互動時 input region 為空，不能出現全螢幕攔截的初始化間隔。
- 浮動採 `HWND_TOPMOST`；常駐採非 topmost 的底部一般視窗。
  所有排序／顯示操作使用不啟用視窗政策，不取得 foreground 權限。
  這不是 Wallpaper backend，也不保證 Win+D、虛擬桌面、獨占全螢幕的結果。
  不使用 WorkerW 私有訊息、跨程序 parent 或 `HTTRANSPARENT` 冒充跨程序穿透。
- 兩個 window 共同隱藏與釋放。直接關閉任一面延後且合併發出 `CloseRequested`，讓協調器保存草稿；
  通知發生在 WPF Closing 返回後，handler 可同步 `Dispose`，不重入關閉程序。
  無 handler 時隱藏兩面並保留瀏覽器，直到 `Dispose`。native handle 不是卡片身分。
- `NativeShortcuts` 擁有獨立 message-only HWND，使用 `RegisterHotKey`／`MOD_NOREPEAT`。
  逐鍵回報可用、衝突、暫停、保留鍵或無效；不安裝鍵盤 hook。
  F12、Win 組合、Alt+F4 與通用文字編輯鍵不註冊。
  重設先解除並清掉該 HWND 已排隊的舊熱鍵，暫停／釋放實際解除註冊。
  controller 整合須在本 App 編輯／IME 擁有輸入時暫停，不能只忽略已被 OS 吃掉的快捷鍵。
- `NativeDisplays` 用 `EnumDisplayMonitors`／`GetMonitorInfo` 取得 physical bounds／work area，
  每個螢幕以未顯示的自有 HWND＋`GetDpiForWindow` 查 DPI。
  輸出明確標示 physical，不直接冒充 LayoutStore 的 logical 座標；映射與拔插恢復另接協調器。
- App 與 UI probe 統一 `net8.0-windows10.0.19041.0` 及 PerMonitorV2 manifest，
  固定 `WindowsSdkPackageVersion=10.0.19041.56`；SQLite core 的 TFM 不變。
  SDK projection 與 WinRT runtime 按官方 redistributable list 原樣封裝，保留授權及來源。

## Consequences

### Positive

卡片疊序由共同 renderer 決定；混合穿透政策可對其他程序驗證，沒有每卡一瀏覽器的成本。
同一 WebView 在 input region 為空時仍能更新被動紙面，避免兩份 renderer 狀態分叉。

### Negative

兩個 OS 視窗的 region 分別更新，不能宣稱是 compositor 的原子交易。
CompositionControl 有額外拷貝成本；大量 region 仍需量測，不能將一次計算速度視為拖曳幀率。
共同 renderer 與主畫面間的草稿、capture、焦點和權威協調仍有整合工作。

### Neutral

單螢幕 144 DPI 的像素與命中測試不代表混合 DPI、真指標捕獲、IME、顯示器拔插或休眠已驗收。
最低 TFM 不是最低 OS 實機驗收證據；Mac／Linux／iOS／Android 不由本 ADR 決定 backend。

## Alternatives Considered

### 透明整屏 HWND WebView

無法直接滿足不同紙面的穿透政策；共用 UI 仍使用原有 WebView2，桌面改用 composition。

### 按游標位置切換整窗穿透

輪詢存在輸入競爭，且不能可靠表達前方穿透卡遮住後方互動卡，不採用。

### 每張卡一個 native window

Windows 可另行評估，但不能成為跨平台可控疊序的共同保證，且放大 native 資源成本。

## 2026-10-06 修訂：掛在 Explorer 底下的場景改用視窗式 WebView2

真實螢幕量測發現，桌面層與桌布層從未出現在螢幕上：Explorer 的 Progman 沒有 redirection surface
（`WS_EX_NOREDIRECTIONBITMAP`），透過 WPF 繪圖的子視窗內容沒有地方合成——逐像素透明的看不見，不透明的只剩黑色。
以同樣樣式建立的宿主視窗可在本機重現（`--host-window-dcomp` 與 `--host-child`）。
- 最上層（頂層視窗）維持本記錄的 composition WebView、輸入視窗加鏡像顯示視窗。
- 桌面層與桌布層改用視窗式 WebView2：瀏覽器以 DirectComposition 畫進自己的子視窗。
  它無法鏡像到第二個視窗，所以同一個不透明視窗負責顯示與輸入，region 只留便箋；
  桌布層在圖示下方收不到點擊，桌面層的便箋本來就可點選，因此不會多擋到桌面圖示。
- 視窗式 WebView2 若在場景視窗隱藏時建立，之後顯示仍是黑的；附著場景在 WebView2 建立完成前保持顯示（region 為空，不顯示也不接輸入），
  建立後才隱藏（`DesktopSurface.Start`）。`--host-check` 以仿 Progman 的宿主自動驗證這個順序。
- 原本只在螢幕外比對 WPF 像素的探針不足以驗證；桌布層探針改為讀取真實螢幕（被視窗蓋住時略過，`--wait-desktop` 可等待）。

## 2026-10-09 修訂：浮動拖曳的原生捕獲

使用者在 23H2 實測快速拖曳不順及位置回彈。浮動 WebView 原本只有 DOM pointer capture，
沒有 WPF mouse capture；修正前新增的原生探針確實在捕獲檢查失敗。
最上層收到左鍵按下時捕獲到自有 WebView，放開、收起、topology 暫停及釋放時解除。
意外失去原生捕獲通知場景取消手勢，不擴大常態輸入 region，不注入全域輸入。
修正後的捕獲／區域移動／解除回歸尚未執行，因使用者要求停止測試及截圖。

## References

- [Windows 場景研究](../resreach/2026-10-04-windows-composition-and-input.md)
- [ADR-007](007-desktop-scene-and-platform-host.md)、[ADR-015](015-windows-native-storage-and-editor-host.md)
- [測試命令](../testing.md)、[執行證據](../../PROGRESS.md)
- [WPF Mouse.Capture](https://learn.microsoft.com/en-us/dotnet/api/system.windows.input.mouse.capture?view=windowsdesktop-8.0)
