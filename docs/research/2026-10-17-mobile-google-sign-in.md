# 手機 Google 登入設定與原生 SDK 行為

查證日期：2026-10-17。以下區分官方契約、實作選擇與驗收界線；執行結果記於 PROGRESS。

## 證據

- [Google OAuth clients](https://support.google.com/cloud/answer/15549257?hl=en)：Android 註冊 package＋簽章 SHA-1；
  iOS 註冊 Bundle ID，Team ID 選填，啟用 App Check 才要求 Team ID。商店識別與本機預覽註冊各自處理。
- [Android Credential Manager](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation)：
  `GetSignInWithGoogleOption` 使用公開 Web Client ID 作 `serverClientId`。
  登出呼叫 `clearCredentialState` 清除帳號選擇狀態，不移除先前授予 App 的權限。
- [Android 授權](https://developer.android.com/identity/authorization)：Drive 資料權限由 AuthorizationClient 取得；
  它與選帳號分開。App 仍須核對獲授權帳號，不以 email 作工作空間身分。
- [Apple SDK 整合](https://developers.google.com/identity/sign-in/ios/sign-in)：互動 signIn、restorePreviousSignIn 與 URL callback 各有角色。
  已固定版本 GoogleSignIn 9.2.0 的 `GIDSignIn.m` 中，互動登入走 authorization request；只有成功且保存 Keychain 後才更新 currentUser。
  `signOut` 會清除 currentUser，因此在開始互動流程前呼叫它，會使取消也失去原本登入。
  源碼：[GoogleSignIn 9.2.0](https://github.com/google/GoogleSignIn-iOS/blob/9.2.0/GoogleSignIn/Sources/GIDSignIn.m)。

## 本次實作選擇

- 沿用 `work-fleet` 專案與 `app.workfleet.preview` 進行手機測試，公開 IDs 放 GitHub Variables／本機 ignored `.env`。
  原生端向 Google userinfo 核對 sub；Web Client Secret 不使用，不新增登入後端。
- Android 在開始選帳號及登出時清除本機 Credential Manager 狀態。
  access token 快取綁 sub，以單調時鐘限制存活；換帳號、清除或過期後需重新取得符合目前分區的 token。
- Apple 不預先 signOut。共用 renderer 在取消後恢復原工作空間的輸入、同步與自動備份。
- 對 renderer 只回傳固定錯誤代碼／產品提示；SDK 原始診斷、token、upload URL 不進提示。

## 驗收界線

Swift probe 只替換 SDK、Keychain、HTTP 與畫面，執行正式 FleetGoogle；JUnit 執行正式快取／錯誤處理。
這些測試及原生編譯不能證明 Google Cloud 註冊的實際 package／簽章一致，也不能代替真實帳號授權、
系統瀏覽器返回、SDK Keychain 恢復、手機程序回收及跨裝置 Drive 往返。
Android client 目前對應本機 debug 簽章，Play App Signing 的憑證將來需另外註冊。
