# ADR-002: 驗證版的原生 macOS 展示與單一 SQLite 來源

## Status

Accepted，2026-10-03；範圍為本次使用者授權的可操作驗證版。

## Context

需要先取得真實 Mac 的 Sandbox／公開 API 證據，再驗證寫入競爭與恢復。
本機有 Swift 6.3.3、Python 3.14.7，沒有正式簽章身分。尚無既有產品程式。

## Decision

- macOS 使用 Swift AppKit、Foundation、WebKit、CoreImage 公開系統框架。
  ad-hoc 簽署的 App Sandbox app，僅主動連線；三種層級可比較。
- Python 3.12+ 標準庫 HTTP 服務與 SQLite 為驗證版權威來源；無 pip/npm runtime 依賴。
- 原生桌面讀取 JSON；解鎖在同一視窗開啟 WebKit 編輯器。
  同份原生 HTML/CSS/JavaScript 編輯器也供桌面／手機瀏覽器使用。
- 每筆資料 revision、全庫 epoch、每裝置 operation ID 與 SQLite transaction
  處理競爭、重試、刪除 tombstone。草稿先落地，離線閱讀與手動重送。
- 配對使用 5 分鐘一次性邀請，交換可撤銷且有角色的 token；QR 由 CoreImage 產生。
- 備份使用 SQLite online backup；還原到新路徑，換 epoch 並撤銷全部舊裝置。
- 預設只監聽 loopback；非 loopback 必須設定 TLS 憑證與精確 public origin。

## Consequences

### Positive

不用安裝 runtime 套件即可重現；減少授權面積，讓平台與資料可靠性可獨立驗證。

### Negative

Python 標準庫服務只定位為個人驗證用途，尚未做公開網路負載／安全稽核。
WebKit 與 Safari 儲存空間分開。沒有離線自動合併，衝突需使用者選擇保留副本。

### Neutral

React／Rust Axum／Tauri 保持候選；本決策不宣稱完成 Windows、Linux、手機封裝或商店核准。
系統 SDK 不搬入 repo；Python／SQLite 是外部執行需求，未隨 app 散布。

## Alternatives Considered

React + Axum + Tauri：可用，但增加初次驗證的工具與授權樹；先保留 HTTP 契約以便更換。
純 localStorage：不能驗證共同權威資料與多裝置競爭，故不採用。

## References

- [接手計畫](../plans/001-validation-version-macos-handoff.md)
- [Apple window API](https://developer.apple.com/documentation/appkit/nswindow)
- [Python license](https://docs.python.org/3/license.html)
- [SQLite public domain](https://www.sqlite.org/copyright.html)
- [Swift license / runtime exception](https://www.swift.org/LICENSE.txt)
