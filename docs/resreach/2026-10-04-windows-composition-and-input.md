# 2026-10-04 Windows 透明場景與原生输入

查閱日：2026-10-04。本文件分開官方能力、採用推論與實測範圍；決策見
[ADR-017](../decisions/017-windows-composition-surface-and-input.md)，執行狀態只記 PROGRESS。

## 官方證據

- Microsoft 的 [WPF 整合文件](https://learn.microsoft.com/en-us/microsoft-edge/webview2/platforms/wpf)
  將 `WebView2CompositionControl` 作為可合成 WPF 控制項，解決 HWND airspace。
  [官方設計](https://github.com/MicrosoftEdge/WebView2Feedback/blob/main/specs/WPF_WebView2CompositionControl.md)
  說明它捕獲自己的 browser visual 供 WPF 顯示，轉送指標並保留鍵盤 controller。
  文件也列出較低幀率／受保護媒體等限制；本產品不播放 DRM 內容。
- [Layered windows](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features#layered-windows)
  依 alpha／shape 命中；零 alpha 會讓指標穿過，搭配 `WS_EX_TRANSPARENT` 則整面穿過。
  這與 [WM_NCHITTEST](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest)
  的 `HTTRANSPARENT` 只向同一 thread 底下視窗繼續判定不同。
- [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos)
  分開 topmost、一般 z-order 與 activation；本機跨程序 probe 顯示 `HWND_TOP` 不足以提供浮動保證。
  採公開的 topmost／bottom 與 `SWP_NOACTIVATE`，沒有借用 Explorer 私有 WorkerW 拓撲。
- [SetWindowRgn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowrgn)
  成功後由 OS 擁有 region；失敗須由呼叫者釋放。
  [CombineRgn](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-combinergn)
  提供 OR／DIFF 等布林運算，可表達前方被動紙面的遮擋。
- [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey)
  回報註冊失敗、要求明確解除舊註冊，提供 `MOD_NOREPEAT`；F12 與 Win 組合屬保留鍵。
  本產品另排除通用編輯鍵，暫停时實際解除，讓輸入繼續由 editor／IME 處理。
- [EnumDisplayMonitors](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumdisplaymonitors)
  與 [GetMonitorInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getmonitorinfow)
  用於 monitor／work-area 盤點；[GetDpiForWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdpiforwindow)
  依視窗 awareness 回傳該視窗 DPI。App 與 probe 使用相同 PerMonitorV2 manifest。

## 採用與失敗修正

使用一個 composition browser 加上同 visual 的被動 WPF 鏡像，讓原生 input region 只包含可操作紙面。
若兩面重疊繪製，半透明像素會累加；因此鏡像只繪 input region 的補集。
region 先在 logical bounds 裁切，再依 HWND DPI 轉 physical pixels，左上 floor／右下 ceil。
由後到前的平衡區塊組合為：

```text
covered(A behind B) = covered(A) ∪ covered(B)
input(A behind B) = (input(A) − covered(B)) ∪ input(B)
```

逐張對越來越複雜的 region 做 OR 曾在 20,000 格耗時數秒；平衡合成保留相同最後覆蓋語意。
單邊 window 關閉曾留下另一面；現由 paired lifecycle 統一隱藏／最終釋放。
不使用自身捕獲的 WebView 圖像去取得其他應用畫面，也不需要 desktop capture 權限。

## 依賴及再散布

WebView2 composition 需要 Windows .NET projection；普通 `net8.0-windows` 缺該 assembly 時實測失敗。
改用明確的 `net8.0-windows10.0.19041.0`，依
[WindowsSdkPackageVersion](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props#windowsdkpackageversion)
固定 targeting pack `10.0.19041.56`，不是將不明 DLL 手動塞入 build。

該包 SHA-512：
`s3ZqfV9sY1k+SsFuEzJ9c20deuLVKW60BhU4I/jHktb9CRlCq37EwmvqYf68OeNiUW+tQdSpSxYVhM7CDbzl4A==`。
這是 SDK targeting-pack pin；一般 NuGet runtime 依賴另由 `packages.lock.json` 保存 hash。
輸出原樣保留 `Microsoft.Windows.SDK.NET.dll` 與 `WinRT.Runtime.dll`。
官方 [redistributable list](https://learn.microsoft.com/en-us/legal/windows-sdk/redist#microsoftwindowssdknetref)
明列可將這些檔案隨呼叫 WinRT 的程式再散布。
[SDK 授權](https://aka.ms/WinSDKLicenseURL) 的原始 RTF 及
[C#/WinRT 對應 revision 的 MIT license](https://github.com/microsoft/CsWinRT/blob/8649ee3eeb2445ca2a36d80d878ef60b96a6c65d/LICENSE)
保留在 `src/native/licenses`。授權盤點不是商店批准。

## 驗證界線

`CompositionProbe` 載入合成 HTML，不載入便箋或 product bridge；使用真 WebView2／WPF／Win32。
另一個自有程序作 OS hit-test 目標，避免同 thread `HTTRANSPARENT` 造成假通過。
檢查 alpha、live mirror、input／mirror 的 region 互補、混合遮擋、浮層切換、關閉及大量區域。
`PlatformProbe` 使用真實快捷鍵註冊衝突與解除；callback 由自有 HWND 的合成 `WM_HOTKEY` 驗證。
兩者都不注入真鍵盤／滑鼠、不搶 foreground、不讀取其他 App 內容。

這些探針不證明實際 WebView pointer capture、IME、混合 DPI、拔插、Show Desktop、虛擬桌面、
休眠喚醒或多 renderer 草稿一致性。後續資料協調須保留單一 Workspace owner，不能讓場景各自提交副本。
