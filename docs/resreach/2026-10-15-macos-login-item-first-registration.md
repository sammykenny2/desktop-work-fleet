# macOS 登入項目的首次註冊狀態

查閱：2026-10-15。對應 0.2.3 設定＞桌面的登入啟動選項停用與錯誤「應用程式」提示；執行結果見 [PROGRESS](../../PROGRESS.md)。

## 本機證據

- 安裝的 0.2.3 位於 `/Applications/Work Fleet.app`，執行中的主程式也位於該 App。
- Developer ID 簽章、Team、沙盒 entitlement 與公證 ticket 存在。
- 正式程式只在 `notRegistered` 時執行首次預設註冊，將 `notFound` 轉成不可用，停用開關並顯示移到「應用程式」的提示。
  這個提示沒有檢查實際位置，也沒有收到註冊失敗的錯誤。
- 獨立 ad-hoc 簽章沙盒 App 的真實 `SMAppService.mainApp` 首次狀態為 3（`notFound`），
  修正後正式 host 可將其註冊為 1（`enabled`），取消後為 0（`notRegistered`）。
  使用隨機 `app.workfleet.loginprobe.*` 身分，只修改並取消自身登入項目，不碰使用者 workspace。

## 官方證據與推論

[Apple 的狀態說明](https://developer.apple.com/documentation/servicemanagement/smappservice/status-swift.enum/notfound)
將 `notFound` 描述為 framework 找不到服務的狀態，沒有說明它等同 App 不在 Applications。
[Apple DTS 回覆](https://developer.apple.com/forums/thread/719862) 解釋，系統從未見過的服務也可回傳 `notFound`，
註冊再取消後才變成 `notRegistered`；該討論使用 helper login item，是否適用主 App 需以實際 `mainApp` 驗證。
[register API](https://developer.apple.com/documentation/servicemanagement/smappservice/register%28%29)
允許主 App 註冊後於後續登入啟動，並可能因使用者核准狀態失敗。

根據上述證據，本專案不應以 `notFound` 阻止註冊。修正接受這個首次狀態，實際註冊若失敗仍回報錯誤；
已存在的偏好不自動重新啟用使用者在系統中移除的項目，仍提供手動開啟。
不重設系統的背景項目資料庫或修改其他 App 的登入項目。

## 決策與驗證界線

[ADR-043](../decisions/043-desktop-window-placement-and-startup-behavior.md) 補充狀態處理。
正式 Swift host 以注入服務回歸，另提供唯一沙盒測試 App 的 opt-in 真實註冊／取消測試；
命令與隔離方式見 [testing](../testing.md)。這些檢查不能當作真實登出、重新登入或正式安裝包已驗收。
