# ADR-035: Windows 附著場景的背景與區域生命週期

## Status

Accepted，2026-10-09；同日恢復測試後修訂。隔離回歸已驗證，使用者原始殘影尚未重現。
補充 [ADR-017](017-windows-composition-surface-and-input.md) 與 [ADR-030](030-windows-explorer-wallpaper-layer.md)。

## Context

使用者在 Windows 11 23H2 安裝修正版後，仍能重現白色殘影：調過位置的便箋經堆疊／攤開移動，
原位置在黑色桌布上留下白塊，不需要拖曳。上一輪提前 hide 與非同步 Explorer invalidation 未解決。
先前仿宿主的背景是白色，hide 後回到白色不能區分原背景與殘留的 WebView 白底。
使用者回憶先前 1.0.1 在 25H2 沒有問題；尚未核對該歷史包或建立同條件對照，不能據此確定根因。

修正前附著場景由 windowed WebView2 的子視窗提供畫面，WPF 宿主與 WebView 預設底色為白色。
`SetWindowRgn` 會發出位置變更訊息；未停用 valid client bits 保存。原 hide 先清空 region 才隱藏，
撤下視窗時已無舊紙面區域，而非同步背景重畫可能等到新紙面出現才處理。
這些是原始碼與 API 可核對的路徑；23H2 持續殘影的具體 compositor 根因仍未證實。

## Decision

- 附著場景仍用 windowed WebView2 子視窗的 DirectComposition 提供畫面；WPF 背景透明，
  windowed WebView 恢復原白色 DefaultBackgroundColor，紙面底色仍由頁面繪製。
  不設定透明色鍵或把背景填成黑色，不能以黑桌布掩蓋一般桌布錯誤。
- 撤回先前新增的 `WS_EX_NOREDIRECTIONBITMAP`：23H2 在 WPF SourceInitialized 以 SetWindowLongPtr
  設為 `0x200080` 回報 Win32 error 87，視窗無法建立。錯誤診斷保留原／目標／實際 style，沒有吞掉錯誤。
  透明 windowed WebView 也撤回：browser preview 雖正常，真螢幕粉紅像素從 `(224,80,160)`
  變成 `(206,73,147)`／`(196,70,140)`；恢復白色背景後實際顏色正確。
- 自有宿主採 `WS_CLIPCHILDREN | WS_CLIPSIBLINGS`；附著 input HWND 的 `WM_WINDOWPOSCHANGING`
  加入 `SWP_NOCOPYBITS`，涵蓋 `SetWindowRgn` 隱含位置更新，不複製上一區域的 client pixels。
  原本 layered 浮動場景仍保留 WPF composition 與原生捕獲。
- Hide 先保留舊 region 隱藏兩面，再要求原 parent invalidation，最後才設空 region。
  隱藏時設 region 不要求 redraw，Dispose 也先走 hide。背景 repaint 仍是非同步請求，
  不把它當作白塊已清除的屏障；本輪重點是停用宿主白底與舊像素保存。
- 只改自有 HWND；沒有修改 Explorer styles、registry、桌布檔案、桌布設定或重啟 Explorer。
  保留上一輪 `scene.prepare`：geometry 改變時先撤下附著場景，再修改 DOM。
- 仿宿主回歸改為黑色背景，同時涵蓋有／無 redirection 的宿主、無 pointer input 的移位／縮高／攤開式
  區域更新、prepare/hide 與直接可見區域替換；逐次確認新紙面與舊位置恢復背景，而非只檢查最後 hide。
  無 redirection 宿主用自有黑色 backdrop 作基準，避免把背後應用當背景。
- 新增實際 owner formation probe：隔離資料建立兩張便箋，scene 合成事件經既有 client／bridge 保存
  調整位置；實際主畫面堆疊／攤開、返回桌面及桌布層，逐像素比對新紙面之外的原螢幕並捕獲測試範圍。
  合成 DOM 事件不代表實體滑鼠驗收。安裝版複本也通過隔離案例，尚未證實使用者白塊的觸發條件。
- 使用者已明確恢復測試／截圖授權；沿用 0.1.1、既有本機憑證與封裝 SOP。實際證據見 PROGRESS。

## Consequences

### Positive

移除會阻止場景建立的 style，保留正確 windowed WebView 色彩；撤下與區域替換明確處理舊像素生命週期。
黑色背景與原桌面像素比對能區分白塊與背景，並檢查新紙面顯示時的舊位置。

### Negative

使用者原始殘影尚未在隔離案例重現，通過不代表根因已解；新版 Explorer 尚缺設備對照。
背景 repaint 仍受 Explorer／compositor 排程影響，實體快速拖曳與實際工作空間仍需驗收。

### Neutral

不改 formation／geometry 保存契約，不新增瀏覽器、依賴、listener 或版本。
目前沒有獨立審閱；作者測試不視為獨立審閱。

## Alternatives Considered

### 維持非同步整個 parent 重畫

已由使用者證實不足，不能重複交付同一做法或把 API 成功當作殘影已消失。

### 在每次 formation 重新套用桌布

早先人工恢復曾清掉殘影，但改使用者桌面全域狀態不適合作為產品更新路徑，也違反 ADR-030 的邊界。

### 單純把白底換成黑底

只能掩蓋黑色桌布的症狀，其他桌布仍會留下錯誤區塊。

### 以同步 WM_PAINT 等待 Explorer

跨程序 SetParent 的視窗可能共用 input queue，`SendMessageTimeout` 在同 queue 不保證 timeout。
不在 WPF dispatcher 加入這種同步 paint 等待，避免形成沒有界限的阻塞。

## References

- [SetWindowRgn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowrgn)
- [SetWindowPos / SWP_NOCOPYBITS](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos)
- [WM_WINDOWPOSCHANGING](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-windowposchanging)
- [Extended Window Styles / WS_EX_NOREDIRECTIONBITMAP](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles)
- [RedrawWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-redrawwindow)
- [SendMessageTimeout](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw)
- [Testing](../testing.md)、[PROGRESS](../../PROGRESS.md)

*Decision made: 2026-10-09*
