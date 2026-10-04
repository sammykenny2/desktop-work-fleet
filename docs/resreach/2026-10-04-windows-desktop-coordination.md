# Windows 桌面通道與邏輯座標

查閱日期：2026-10-04。決策見 [ADR-018](../decisions/018-single-owner-desktop-views.md)，實測結果見 PROGRESS。

## 官方證據

Microsoft 說明 DPI-aware 視窗／滑鼠座標需和邏輯绘製單位明確換算；不能把 physical 像素直接當 DIP。
參見 [DPI and device-independent pixels](https://learn.microsoft.com/en-us/windows/win32/learnwin32/dpi-and-device-independent-pixels)。
多螢幕 API 取得 monitor bounds 後可用 SetWindowPos 定位；primary work area 不能取代所有顯示器工作區。
參見 [Positioning objects on multiple display monitors](https://learn.microsoft.com/en-us/windows/win32/gdi/positioning-objects-on-multiple-display-monitors)。

WPF CompositionControl 的 ZoomFactor 公開轉接 WebView controller 縮放設定。
參見 [WebView2CompositionControl.ZoomFactor](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.wpf.webview2compositioncontrol.zoomfactor)。
這證明可用 API 存在，不證明本產品混合 DPI 的文字、拖曳及原生命中已全部正確。

## 本產品推論與採用

每顯示器／每層一個 renderer 可限制單個表面大小，同層仍由 DOM 控制卡片前後次序。
使用主顯示器 DPI 作統一 reference scale，將所有原生 bounds／work area 投影到連續座標。
不同螢幕的 WebView 縮放補償其系統 DPI，避免把同一張跨邊界卡片的兩半畫成不同像素大小。
代價是不同螢幕 DPI 偏好不能各自改變同一紙面的字號；實機驗收及後續設定需明確處理。

frame／command 只在程序記憶體流轉，已完成的 frame lease 不隨新版本改寫。
草稿 flush 是非阻塞的事件握手；若 native dispatch 等到草稿保存才回覆，後面的 storage.commit
便無法通過同一 channel，造成死鎖。最後寫入需獨立 admission／execution lane。

## 驗證界線

真 WPF probe 使用合成 profile 與螢幕外顯示器描述，保留實際 WebView2／SQLite／DPAPI／IPC。
DOM CompositionEvent 驗證處理器與退出屏障，不能當成實際 Windows IME candidate window 的通過證據。
同理，合成命令／PointerEvent 不能證明實際滑鼠 capture、跨 monitor 拖曳、Win+D 或虛擬桌面。
原生跨程序 region 命中證據仍見 [前一份研究](2026-10-04-windows-composition-and-input.md)。
