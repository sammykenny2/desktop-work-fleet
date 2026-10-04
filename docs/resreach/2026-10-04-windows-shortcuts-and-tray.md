# Windows 快捷鍵、foreground 與系統匣

查核日期：2026-10-04。公開 API 證據、專案採納及未測界線分開。

## 官方證據

- [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)
  列出 desktop caller 與最後輸入／foreground 授權條件，且系統仍可能拒絕；不能將 Activate 當作保證。
- [ShowWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow)
  定義 SW_SHOWNOACTIVATE；失效 intent 的主畫面恢复使用不啟用路徑，不以普通 restore 重新取焦點。
- [Shell_NotifyIconW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shell_notifyiconw)
  提供新增、修改、刪除、set-version／focus；每次新增後須再次設定 version。
  version 4 可使用 WM_CONTEXTMENU 與 NIN_KEYSELECT 等鍵盤入口。
- [NOTIFYICONDATAW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-notifyicondataw)
  定義 HWND＋uID 或 GUID 身分、icon、提示與 callback；本實作採自有 HWND＋uID。
- [Taskbar](https://learn.microsoft.com/en-us/windows/win32/shell/taskbar)
  說明 TaskbarCreated 通知及系統匣生命週期，重啟後須重新建立圖示。
- [Microsoft Keyboard 指引](https://learn.microsoft.com/en-us/windows/win32/uxguide/inter-keyboard)
  指出 Ctrl+Alt 可能與 AltGr 產生字元衝突；這份設計指引源於 Windows 7，不能當成新版 UI 驗收。
- [W3C UI Events](https://www.w3.org/TR/uievents/#keys-modifiers)
  定義 modifier state／AltGraph；本地 handler 依事件狀態保留正常文字輸入。

## 本專案決策與推論

[ADR-019](../decisions/019-windows-shortcuts-and-tray.md) 採焦點中實際解除 RegisterHotKey，
由 HTML 本地 handler 處理 scope／editor 優先序。這是專案的保守輸入政策，非 Windows 自動替本 App 仲裁。
非同步 focus 要求 native snapshot、五秒期限與沒有後續輸入；這是額外限制，不延長 OS 授權。
tray 使用公開 API 與自有隱藏 window，沒有搬入範例原始碼或依賴其他應用資產。

## 驗證界線

自有 HWND 的 WM_HOTKEY／tray callback／TaskbarCreated 是合成訊息；實際 OS 註冊、
Shell_NotifyIconGetRect、WPF／WebView2／SQLite 及主資料流程另提供真執行證據。
CompositionEvent／KeyboardEvent 不等於真 IME 候選或實體按鍵。未以終止 Explorer 測重啟，
也未向使用者桌面注入鍵盤或滑鼠。各次結果只在 PROGRESS 記錄。
