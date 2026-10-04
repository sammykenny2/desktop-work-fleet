# ADR-027: 加密分享收件匣與 iOS Share Extension

## Status

Accepted，2026-10-05；程式／專案接線已加入，原生 SDK 尚未編譯或執行。

## Context

手機 1.0 包含外部分享接收。來源內容不能直接覆寫便箋或自動選 Google 帳號；
App 關閉或 SQLite 保存失敗時仍須保留已接收內容。

## Decision

- Android SEND／SEND_MULTIPLE、iOS Share Extension 接收文字／網址／授權檔案，無任意 HTTP 下載。
- 接收佇列獨立於 Workspace。Android 私有 no-backup 目錄與 Keystore AES-GCM；
  iOS App Group container 與 group Keychain AES-GCM、flock 及完整檔案保護。
- 每筆最多 256 KiB 文字、16 個檔案與 25 MiB 檔案總量；收件匣上限 64 份／512 MiB。
  加密 metadata 最後發布，檔案綁定 capture ID／file ID 與 SHA-256。
- 主 App 選定目前工作空間的群組後保存成草稿；保存成功才以 manifest receipt 清除原分享。
  receipt 記入內容擴充，重試可辨识同一 profile 已保存的草稿／卡片，避免重複。
- 捨棄須明確確認，接收失敗保留原項目。Share Extension 只使用共享收件匣，
  不讀取主 App Workspace／Google 憑證，不透過非公開手段開啟主 App。
- Xcode 產生器建立 app-extension target 並嵌入 iOS App；公開 App Group ID 由 .env 配置，
  主 App 與 Extension 使用相同 group，實際 capability／signing profile 由 Apple 開發者帳號配置。

## Consequences

外部分享接收已有原生程式及共用 UI；真實 SDK、檔案提供者與 Extension runtime 證據仍缺。
來源 URI／提供者資料受容量與授權約束，原生封裝不把來源檔案當成可執行網頁。
Keychain／Keystore 遺失時不改存明文或重新解密舊內容；收件匣不是跨機可攜備份。

## Alternatives Considered

分享直接建立便箋會跳過群組與帳號選擇。Extension 共用主資料庫會引入多 owner 與權限擴大。
未保存草稿先刪除接收項目會在失敗／程序關閉時丟失內容。

## References

- [ADR-026](026-native-file-export-and-sharing.md)、[SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)。
- [Android receive sharing](https://developer.android.com/develop/ui/compose/sharing/receive)。
- [Apple file representation](https://developer.apple.com/documentation/foundation/nsitemprovider/loadfilerepresentation(fortypeidentifier:completionhandler:))。
- [Apple group keychain access](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps)。

*Decision made: 2026-10-05*
