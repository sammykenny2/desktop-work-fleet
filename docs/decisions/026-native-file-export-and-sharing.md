# ADR-026: 原生檔案匯出與手機分享

## Status

Accepted，2026-10-05；程式已加入，Android／Apple 原生 SDK 尚未編譯或執行。

## Context

手機 WebView 不保證提供瀏覽器 blob 下載；1.0 的附件、草稿與手機分享需使用平台能力。
主畫面仍是唯一資料 owner，分享不改動卡片、群組或同步版本。

## Decision

- 具備 fileExport 的 host 攔截共用 blob 下載，以 bounded transfer／SHA-256 與加密 staging
  傳遞 bytes，再由原生選檔器保存。renderer 只傳檔名與操作，不能指定原生路徑或 URI。
- Android 使用 ACTION_CREATE_DOCUMENT；iOS 使用 UIDocumentPicker；macOS 使用 NSSavePanel。
  取消保存回傳未完成，匯出並不取代 SPEC-002 的已確認備份流程。
- 手機編輯器先保存草稿再分享。128 KiB 內的文字以系統文字分享處理，較大文字以 Markdown
  檔案分享；附件只分享檔案 bytes，HTML／SVG 不在主 document 執行。
- Android FileProvider 只提供 cache exports，授予接收 App 暫時只讀 URI 權限。
  32 份／256 MiB 上限，下次分享清理超過 24 小時的自有暫存。
- iOS 系統 activity sheet 支援 iPad popover，檔案暫存使用完整檔案保護，
  完成／取消／逾時／帳號切換清理。分享面板開啟不代表已送達收件人。

## Consequences

手機與 Apple 桌面的附件／草稿匯出已有原生路徑；Android／iOS 有文字與單附件分享入口。
原生 runtime、提供者差異及實機分享仍未執行。外部分享接收／iOS Share Extension 仍待實作，
本切片不代表完整手機或商店交付完成。

## Alternatives Considered

把 blob URL 交給外部瀏覽器無法提供 App 內 bytes。公開 filesystem path 或整個 cache 目錄
超出單檔分享所需權限。以匯出成功代替安全備份確認會混淆兩種操作的保存保證。

## References

- [ADR-022](022-android-native-host.md)、[ADR-023](023-apple-native-host-and-scenes.md)。
- [Android file sharing](https://developer.android.com/training/secure-file-sharing)。
- [Apple document export](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller/init(forexporting:ascopy:))。

*Decision made: 2026-10-05*
