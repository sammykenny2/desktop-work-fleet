# ADR-055: 手動建置手機實機測試包

## Status

Accepted，2026-10-17。使用者要求建立 GitHub APK／指定裝置 IPA 建置流程，不升版、不發布 preview。

## Context

目前以自有手機測試，尚未導入 TestFlight 或 Google Play 測試管道。
既有 Apple workflow 只產出未簽章包，不能直接安裝。CI 每次產生新的 Android debug key
也會使既有 App 無法覆蓋更新，且不符合已登記的 Google OAuth 簽章。

## Decision

- 新增 `android-apk.yml`、`ios-ipa.yml`，僅手動在 main 建置；token 為 contents: read。
  不建立 tag／Release、不上傳商店、不修改版號；產物與 SHA-256 存 Actions artifacts 十四天。
  Artifact 名稱包含平台版號、run ID 與 attempt，隨包文字記錄來源 commit，辨識同版號不同建置。
- Android 使用固定的現有 debug keystore，只供測試。CI 從 Secret 暫存還原，建置後核對
  `WORK_FLEET_ANDROID_DEBUG_SHA1`，簽章不符不保存 APK。正式 Play 簽章／OAuth 另行準備。
- iOS 使用 Apple Development identity、主 App 與 Share Extension 兩份 development profiles。
  先檢查 Team／App ID／App Group、主 App Keychain group、效期、憑證及相同註冊裝置集合。
  編譯 unsigned Debug 後，由簽章工具依序簽 dylib／framework／Extension／App，並嵌入各自 profile。
  這也支援現有 Xcode-managed profiles，不需 CI 登入 Apple 帳號；本機 Xcode 專案設定不變。
- 私鑰／keystore／profiles 只放 GitHub Secrets，runner 使用暫時 keychain／檔案並在 always 步驟清除。
  不把秘密寫入公共配置、版本庫或 artifacts。憑證外送到 GitHub 的授權與 workflow dispatch 各自取得。
- IPA 限 profiles 註冊的裝置，透過 Mac 的 Xcode／Apple Configurator 安裝，裝置啟用 Developer Mode。
  新增裝置後需更新主 App 與 Extension 的 profiles，再重新建置。

## Consequences

### Positive

- 可持續提供自有裝置測試包，維持現有手機覆蓋更新與 Google OAuth 簽章的一致性。
- 原始碼提交、手動建置及正式測試／上架管道各自可驗證，不需要為每次建置建立公開 Release。

### Negative

- iOS 憑證／profiles 有效期與裝置名單需維護；Actions artifacts 不是永久下載站。
- GitHub workflow 完成不等於雲端已執行或手機已驗收；缺少 Secrets 時會明確失敗。

## Alternatives Considered

- 延用未簽章 IPA：不能直接安裝至指定手機，不符合此次要求。
- 每次 CI 自動建立 Android debug key：無法維持覆蓋更新與 OAuth 設定。
- 立即導入 TestFlight／Play 內部測試：保留為後續方向，本輪採用指定裝置測試包。

## References

- [散布與設定](../deployment.md#手機實機測試包)、[Setup](../setup-guide.md)、[ADR-028](028-native-package-and-signing-entry-points.md)。
- [GitHub Apple CI 簽章](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)。
- [Apple 註冊裝置散布](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices)。
- [Android 簽章與 API 指紋](https://developer.android.com/studio/publish/app-signing)。
