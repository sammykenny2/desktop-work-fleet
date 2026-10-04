# ADR-017: Windows 透明場景、輸入區域與平台基礎

## Status

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

## References

- [Windows 場景研究](../resreach/2026-10-04-windows-composition-and-input.md)
- [ADR-007](007-desktop-scene-and-platform-host.md)、[ADR-015](015-windows-native-storage-and-editor-host.md)
- [測試命令](../testing.md)、[執行證據](../../PROGRESS.md)
