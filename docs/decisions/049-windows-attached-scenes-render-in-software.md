# ADR-049: Windows 掛在 Explorer 的場景以軟體繪製 WPF

## Status

Accepted，2026-10-15。使用者看過 0.2.5 登入後當掉的 `host.log` 與分析後指示：「先做 1 和 2」。
1 是把等待的判斷依據寫進 `host.log`（[ADR-046](046-windows-sign-in-scenes-wait-for-settled-displays.md) 修訂），2 是本決策。

## Context

- 2026-10-15 15:09 開機，0.2.5 登入啟動後當掉，`host.log` 記錄如下：
  - 啟動時有兩台螢幕：合著的內建螢幕（1920×1080）是主螢幕，外接 4K 在右側。
  - ADR-046 的等待沒有生效，場景 2.8 秒後就掛進 Explorer；當時判斷用的輸入沒有記錄。
  - 啟動後約 100 秒，Windows 關掉內建螢幕（topology=1），這次沒事。
  - 再過 30 秒，同一台外接螢幕從 `\\.\DISPLAY2` 改為 `\\.\DISPLAY1`（topology=3）。
  - 140 ms 後 render thread 失敗（`UCEERR_RENDERTHREADFAILURE`，在 `HwndTarget.UpdateWindowPos` 拋出）。
    8 個 Explorer 子視窗先移出，程式才結束；沒有自動重開（ADR-045 修訂）。
  - 同一時間沒有驅動逾時或顯示相關的系統事件。
- 0.2.3 在 2026-10-15 00:13 遇過同樣的 DISPLAY2→DISPLAY1 改編，當時沒事。
  所以失敗取決於時機，不是遇到某種變動就一定會發生。
- ADR-046 的等待最多只延到第一次變動之後 5 秒；這次致命的是 30 秒後的第二次變動。
- 微軟說明（[WPF render thread failures](https://learn.microsoft.com/en-us/troubleshoot/developer/dotnet/framework/general/wpf-render-thread-failures)）：
  - 每個 WPF 程序只有一條 render thread。
  - UI 執行緒上的例外與堆疊只是症狀，真正的原因留在 render thread，已經遺失。
  - 最常見的原因是顯示驅動與 WPF 硬體繪圖。建議先停用硬體加速；可以逐視窗設定（`HwndTarget.RenderMode`），也可以整個程序。
- 掛在 Explorer 的場景是桌面層和桌布層，每個場景有兩個 WPF 視窗：
  - InputWindow 承載 windowed WebView2；VisualWindow 沒有內容。
  - Explorer 的桌面視窗沒有重導表面，WPF 在這兩個視窗畫的東西不會出現在螢幕上（見 `DesktopSurface` 建構子說明）。便箋由瀏覽器自己的子視窗畫。
  - 但這兩個視窗各自持有一個 Direct3D render target。
- 那 8 個視窗是：開機時 2 台螢幕 × 桌面層、桌布層 × 每個場景 2 個視窗。內建螢幕關掉後，它的場景只是隱藏，仍掛在 Explorer。

## Decision

- 非分層場景（掛在 Explorer 的那種）的兩個 WPF 視窗，在 HWND 建立時就把 `HwndTarget.RenderMode` 設為 `SoftwareOnly`，早於掛進 Explorer。
- 浮動層維持預設繪圖：它是分層視窗，`WebView2CompositionControl` 的畫面由 WPF 合成。主視窗也維持預設。
- 判斷依據寫進 `host.log` 的部分見 ADR-046 的 2026-10-15 修訂。

## Consequences

### Positive

- Explorer 裡的 Work Fleet 視窗不再持有 Direct3D 狀態，顯示變動時 WPF 不必為它們重建 GPU 資源。
- 畫面不變。改前與改後各跑一次，真 Explorer 桌布層與桌面層的像素檢查（`--wallpaper`）、Explorer-style 宿主的檢查（`--host-check`）結果相同。

### Negative

- 不保證有效，render thread 失敗的原因仍然未知。如果失敗的是浮動層或主視窗的 GPU 繪圖，這次修正幫不上忙。
  下一步可以考慮兩件事：整個程序改用軟體繪圖（要先驗證浮動層），或為 WorkFleet.exe 開啟 LocalDumps（要使用者同意）。
- 軟體繪圖的緩衝放在程序記憶體裡。`--wallpaper` probe 有一個 4K 全螢幕的附著場景，兩個視窗都顯示時：
  - working set 峰值從 150 MB 增加到 215 MB，約等於兩個 3840×2160 的 32 位元緩衝。
  - private bytes 峰值反而從 181 MB 降到 174 MB，大致相同。
    硬體 render target 的緩衝原本就配置在 GPU 記憶體（這台內顯是共享的系統記憶體），所以沒有算進 working set。
  - App 裡每台螢幕有桌面層、桌布層兩個附著場景，啟動時都會先顯示一次。一台 4K 螢幕約多 130 MB working set，螢幕越多越多。
    隱藏後緩衝會不會釋放，沒有量測。
- 只能靠重開機實測來驗證；登入時的這種顯示切換，目前在測試裡重現不出來。

### Neutral

- 手動啟動與登入啟動都套用。
- ADR-046 的等待保留不變。

## Alternatives Considered

### Alternative 1: 整個程序軟體繪圖（`RenderOptions.ProcessRenderMode`）

- **Pros**: 涵蓋所有視窗。
- **Cons**: 浮動層要由 WPF 合成 WebView2 的 GPU 擷取畫面，軟體模式下的效能與顯示都還沒驗證。
- **Why rejected**: 先處理畫面不會受影響的那一批；如果還是當掉，再評估這個方案。

### Alternative 2: 加長或加強 ADR-046 的等待

- **Pros**: 不必改繪圖方式。
- **Cons**: 第二次變動發生在 30 秒後，等待只是在跟時間賽跑；而且這次等待根本沒有生效。
- **Why rejected**: 預測不到 Windows 什麼時候會再變動。

### Alternative 3: 恢復當機後重開一次（ADR-045）

- **Pros**: 使用者比較不會看到 App 消失。
- **Cons**: 使用者是為了確認到底有沒有當機才停用它的。
- **Why rejected**: 不在本次範圍，由使用者決定。

## References

- [ADR-045](045-windows-fatal-error-leaves-explorer-first.md)：當掉時先離開 Explorer、`host.log`
- [ADR-046](046-windows-sign-in-scenes-wait-for-settled-displays.md)：登入啟動等螢幕穩定，以及 2026-10-15 修訂
- [docs/testing.md](../testing.md)：`--wallpaper`、`--host-check`、`--sign-in-hold`

---

*Decision made: 2026-10-15*
*Decision makers: 使用者、Claude*
