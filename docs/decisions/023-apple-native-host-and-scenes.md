# ADR-023: Apple 原生資料、授權與桌面場景

## Status

Accepted，2026-10-05。實作加入；Apple SDK／裝置結果未取得。

## Context

完整 1.0 包含 macOS 與 iOS 原生 App。共用 renderer 已有便箋、附件、備份還原與 FileSync，
需要接 Apple 安全儲存、原生 Google 授權、受保護檔案流程及 macOS 的單一 owner 桌面互動。
使用者要求優先實作、停止追加測試與審閱；不能把本機缺 SDK 當成縮小交付範圍。

## Decision

- Swift／AppKit／UIKit／WKWebView；共用 SQLite、Keychain AES-GCM、唯一 owner lock、
  staged transfers 與 revision CAS。封裝 document 之外無 bridge 權限；網路走原生受限 HTTPS。
- GoogleSignIn 9.2.0 SPM；macOS／iOS 均建立符合 bundle ID 的 iOS 類型 client。
  SDK 處理系統授權與 Keychain credential，native 以 HTTPS userinfo sub 核對穩定身分。
  renderer 只得到公開 account metadata 與固定 FileStore 操作，續傳 URL／token 留 native。
- 原生備份使用 user-selected folder bookmark／security scope、目錄與檔案身分、建立新檔／
  fsync／讀回校驗及 journal 安全清理；可攜加密保持 SPEC-002 PBKDF2／AES-GCM 格式。
- macOS 每螢幕共用 desktop／floating visual surface，只有主畫面保存内容。
  visual panel 始終穿透；已核准紙面输入區域用透明 NSPanel 轉送原生滑鼠至相同 WKWebView，
  依前方紙面遮蓋裁切。日常穿透卡不建立输入區域；唯讀選字不開放內容修改。
- 公開 CGWindowLevelKey／NSWindow level；desktop 與 floating 兩層，wallpaper 設定保留並
  明示 desktop fallback。背景 frame 不呼叫 activate；快捷鍵／本機輸入 intent 有期限及前景身分檢查。
- Carbon RegisterEventHotKey；App 或 editor 有焦點時釋放全域註冊，由 renderer 處理本地鍵。
  選單列與關閉流程保存草稿、等待 owner 確認；取消關閉可重試。
- 螢幕／Space／休眠通知先暫停輸入與撤銷 intent；owner 保存救援版面後套用新 topology，
  保留編輯 WKWebView，最多 16 螢幕／32 活躍或保留場景。
- Node 產生 Xcode 專案／兩個 shared scheme／自有 icon asset catalog。Xcode 建置及 archive
  沿用 `.env.example` 公開配置；簽章秘密留 Keychain，依賴授權於 bundle 簽章前複製。

## Consequences

共用內容與備份跨平台保持同一契約；Apple Keychain／SQLite 不借助 Python server。
Google Apple SDK 與 Keychain 需要 Apple 簽章配置，未配置的 simulator 不宣稱登入可用。
目前 Windows 工作環境沒有 Xcode；未編譯 Swift、未建立 app/archive、未真登入、未做原生手勢驗收。
輸入轉送、IME、視覺透明、全螢幕／Spaces／Stage Manager 的實際行為仍需 Apple 環境證據。
商店 privacy 表單、簽章 export 與上傳保持待帳號／設定完成，不以文案或 manifest 冒充提交完成。

## Alternatives Considered

沿用驗證 server 不符合 1.0 檔案來源／安全授權需求。private WKWebView 背景屬性不採用；
透明設定使用公開 underPageBackgroundColor。逐卡新增獨立資料 owner 會破壞原子保存與草稿邊界。

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)、[ADR-018](018-single-owner-desktop-views.md)。
- [原生建置與狀態](../../src/native/apple/README.md)。
- [Google Apple SDK 整合](https://developers.google.com/identity/sign-in/ios/start-integrating)。
- [Google 9.2.0](https://github.com/google/GoogleSignIn-iOS/releases/tag/9.2.0)。
- [WKWebView public background](https://developer.apple.com/documentation/webkit/wkwebview/underpagebackgroundcolor)。
- [AppKit mouse transparency](https://developer.apple.com/documentation/appkit/nswindow/ignoresmouseevents)。

*Decision made: 2026-10-05*
