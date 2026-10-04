# ADR-022: Android 原生 App host

## Status

Accepted

## Context

完整 1.0 已包含 Android 原生 App 及商店提交準備，需重用卡片語意並保留原生儲存與授權邊界。

## Decision

採 Android SDK Activity、Java 17、AndroidX WebKit 及共用本機 ES modules。
minSdk 28、compile／target SDK 36；AGP 8.13.2、Gradle 8.13。
WebKit、Credential Manager、Google ID 及 Play Services Auth 固定版本記錄於 Gradle manifest。

WebViewAssetLoader 只映射封裝資產，WebMessageListener 只接受固定 HTTPS origin 的主文件。
拒絕其他網路資源、frame bridge、任意 URL／SQL／路徑命令；外部連結交给系統。
同一位置以 native file lock 限制一個 SQLite owner；profile、record revision 及附件在一筆交易保存。
Android Keystore 的不可匯出 AES 金鑰保護本文、草稿、附件、備份密碼與原生授權。
金鑰失效不回退明文；停用 Android 系統資料備份，避免內容與不可搬移金鑰失配。

手機使用 Credential Manager 帳號選擇與 AuthorizationClient 個別 Drive 授權。
Web client ID 是 Credential Manager audience；Android client 以 package／簽章在 Google 專案註冊。
原生服務透過 HTTPS userinfo 核對 sub，再綁定帳號分區。token 與續傳 URL 不回傳 renderer。
HTTP、metadata、SHA-256、固定檔案 ID 與續傳沿用 ADR-012 的契約。

手動與自動備份使用 SAF tree grant，原生端保留 URI 建立紀錄，renderer 只收到 opaque ID。
每次建立新檔；保存後 fsync 及讀回校驗。缺 ownership、檔案變更或最新備份未確認時保留舊檔。
加密備份使用 SPEC-002 的 UTF-8 PBKDF2／AES-GCM ZIP 格式，沒有明文降級。
自動備份 scheduler 在前景執行；系統回收依已提交草稿／journal 恢復。

## Consequences

- 手機具原生 Activity、儲存、授權、檔案挑選及 build manifest，無 overlay 權限或便箋 server。
- SDK／真裝置／Google 專案／簽章仍需對應環境，原始碼交付不等同商店通過。
- SAF 提供者能力不同，不能確認保存時停止清理並保留新檔。

## Alternatives Considered

renderer IndexedDB 作正式原生儲存：拒絕，無既定安全儲存及檔案授權。
手機採桌面 loopback OAuth：拒絕，Google 手機 client 不支援該流程。

## References

- [Android Authorization](https://developer.android.com/identity/authorization)
- [Credential Manager](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation)
- [Android WebKit](https://developer.android.com/jetpack/androidx/releases/webkit)
- [AGP 8.13](https://developer.android.com/build/releases/agp-8-13-0-release-notes)
- [建置說明](../../src/native/android/README.md)

*Decision made: 2026-10-05*
