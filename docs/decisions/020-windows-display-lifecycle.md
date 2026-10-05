# ADR-020: Windows 顯示器與休眠生命週期

## Status

[ADR-030](030-windows-explorer-wallpaper-layer.md) 將池上限更新為三層合計 48 場景，
並加入 Explorer 宿主重啟恢復；下方兩層 32 場景為原始切片限制。

Accepted

## Context

顯示器拔插、DPI、工作區域及喚醒會改變桌面座標。重新建立 renderer 可能丟失正在組字的文字。

## Decision

使用自有頂層通知 HWND 接收公開 WM_DISPLAYCHANGE、WM_SETTINGCHANGE、WM_POWERBROADCAST。
WM_DPICHANGED 由既有 surface 通知協調器。350 ms 合併通知後重新列舉；讀取失敗每 3 秒重試。
收到通知立即清空輸入區域及焦點授權。owner 取消拖曳，透過既有 LayoutStore 救回不可達便箋並原子保存，
之後才套用原生視窗位置及新的 topology generation。命令與已呈現畫面均綁定 generation，舊座標不得重新開啟輸入。
草稿寫入獨立通道繼續保存；不以顯示器變更觸發文字 flush 或重建 DOM。

每層保留可重用的場景池，未使用的視窗收起；兩層合計最多 32 個存活場景。
正在編輯的場景优先分配至救回後紙張所在顯示器，保留 view ID、草稿及 WebView。
喚醒不產生 foreground intent，不搶焦點。owner/native 套用失敗保留已保存資料並重新列舉。

## Consequences

- 同一工作區仍是唯一儲存權威，沒有顯示器專屬資料副本。
- 環境變更期間桌面暫停指標操作，編輯文字保留。
- 實體拔插、混合 DPI、休眠及真實 IME 的平台驗收另記於 PROGRESS。

## Alternatives Considered

每次通知重建全部 WebView：捨棄，因為會破壞未完成輸入與組字。

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [WM_DISPLAYCHANGE](https://learn.microsoft.com/en-us/windows/win32/gdi/wm-displaychange)
- [WM_DPICHANGED](https://learn.microsoft.com/en-us/windows/win32/hidpi/wm-dpichanged)
- [WM_POWERBROADCAST](https://learn.microsoft.com/en-us/windows/win32/power/wm-powerbroadcast-messages)

*Decision made: 2026-10-05*
