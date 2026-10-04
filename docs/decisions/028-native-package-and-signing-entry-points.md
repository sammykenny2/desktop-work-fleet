# ADR-028: 原生封裝與簽章入口

## Status

Accepted，2026-10-05。

## Context

完整 1.0 含五平台及商店提交準備；目前沒有維護者 Google／Apple／商店帳號與簽章私鑰。
公開設定應能從 `.env.example` 配置，缺憑證不能以 placeholder 宣稱正式散布已完成。

## Decision

Windows 以 Windows SDK MakeAppx 產生 x64 MSIX，另產生 portable ZIP；framework-dependent
執行需 .NET 8 Desktop 與 WebView2。MSIX 使用公開 package identity／publisher，可選既有
CurrentUser/My certificate 與 HTTPS timestamp 簽署；不自行安裝憑證或修改信任。
每次封裝使用新的 workspace build 目錄，保留既有產物與 SDK packaging log。

Apple 由產生的 Xcode project 建立 archive，再以本機 export options 匯出。
macOS 啟用 hardened runtime；Developer ID 可用已有 identities 產生 signed PKG／DMG，
可選 Keychain notary profile 公證並 staple。iOS 匯出包含已嵌入的 Share Extension；
signing profiles 仍需維護者配置同一 team／App Group。腳本不登入或上傳商店。

Android upload signing 僅讀取 process／CI environment 的 keystore、alias、store／key passwords；
四項必須同時配置。`-Signed`／`--signed` 強制簽章 release AAB，未配置 inputs 的一般 release
可輸出未簽章 AAB 交給外部 pipeline。秘密不進公共設定、命令列參數或 repo。
Linux 保留系統 runtime tar.gz 與 DEB 建置入口，不假設 Windows 可完成 Linux GUI 散布驗收。

Windows 可選 workspace Android toolchain installer，使用官方固定 SDK tools／Gradle download
及 SHA-256，接受所需 SDK 條款後安裝 API 36／Build Tools 35.0.0。工具、SDK、快取與路徑 JSON
位於忽略的 `build/`；不修改系統 PATH。公開 SDK 路徑可由 `.env`／process environment 覆蓋。

## Consequences

### Positive

- 各平台有可配置的封裝與簽章入口，公開 app／Google／publisher 設定與 secrets 分離。
- 有 SDK 的環境可先產出 preview，保留正式憑證及商店帳號由維護者控制。

### Negative

- Windows runtime 不內嵌，接收端須有 .NET 8 Desktop／WebView2。
- 有腳本不等於平台 binary、簽章、Google 往返或商店表單已完成；依最終產物補授權与截圖。

## Alternatives Considered

將簽章密碼放入 `.env` 或公共 JSON：拒絕，公共設定會封裝進 App。
自行建立及安裝受信任憑證：拒絕，會改變使用者環境且不能替代正式簽章 identity。
將 framework-dependent preview 視為五平台正式發行：拒絕，缺少原生環境及外部帳號證據。

## References

- [封裝與散布](../deployment.md)、[商店資料](../release/README.md)、[執行狀態](../../PROGRESS.md)。
- [Microsoft MakeAppx](https://learn.microsoft.com/en-us/windows/msix/package/create-app-package-with-makeappx-tool)。
- [Microsoft packaged desktop manifest](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-manual-conversion)。
- [Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)。
