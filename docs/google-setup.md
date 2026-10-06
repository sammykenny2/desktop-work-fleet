# Google 登入與 Drive 設定

五平台原生 host 已接登入、帳號工作空間及 Drive appDataFolder 同步程式。
瀏覽器開發預覽只有本機資料，不提供 Google 登入。
Google Cloud 專案尚未建立；以下是啟用程式所需的配置，不代表真實登入已驗收。

## 建立 Google Cloud 設定

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 建立一個專案，五平台全部使用這個專案。
2. 啟用 **Google Drive API**。
3. 在 Google Auth Platform 設定應用名稱、支援信箱、Audience 與公開隱私權網址。
   開發期間使用 Testing，加入會登入的 Google 帳號為測試使用者。
4. Data Access 使用 `openid`、`email`、`https://www.googleapis.com/auth/drive.appdata`。
   不需要取得整個 Drive 的讀寫權限。
5. 依下表建立 OAuth clients；把 client ID 放入根目錄 `.env`，再重新建置 App。
   不同平台要使用同一專案，才能連接同一應用資料空間。

| 平台 | OAuth client 類型／註冊內容 | `.env` 欄位 |
|---|---|---|
| Windows | Desktop app；MSIX 裡的程式也是桌面 App，使用系統瀏覽器與 loopback callback | `WORK_FLEET_GOOGLE_WINDOWS_CLIENT_ID` |
| Linux | Desktop app；可與 Windows 共用同一個 Desktop client ID | `WORK_FLEET_GOOGLE_LINUX_CLIENT_ID` |
| macOS | iOS 類型 client，bundle ID 使用最終 `WORK_FLEET_APP_ID` | `WORK_FLEET_GOOGLE_MACOS_CLIENT_ID` |
| iOS | iOS 類型 client，bundle ID 使用最終 `WORK_FLEET_APP_ID` | `WORK_FLEET_GOOGLE_IOS_CLIENT_ID` |
| Android | Android client，package 使用最終 `WORK_FLEET_APP_ID`，註冊實際簽章憑證 SHA-1 | `WORK_FLEET_GOOGLE_ANDROID_CLIENT_ID` |
| Android 登入 audience | 同一專案另建 Web application client；只用公開 ID，沒有自家登入 server | `WORK_FLEET_GOOGLE_WEB_CLIENT_ID` |

Android 本機 debug、upload key 與 Google Play App Signing 的憑證可能不同，
應為實際使用的 package／SHA-1 組合各自註冊 Android client。
從 Play 安裝的版本使用 Play Console 的 **app signing certificate**，不能只註冊 upload key。
尚未指定正式 App ID 時，預覽 package／bundle ID 是 `app.workfleet.preview`。
Apple callback scheme 由生成腳本從 client ID 產生，不須手寫 Info.plist。

授權流程依 [Google installed-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、
[Apple Google 登入設定](https://developers.google.com/identity/sign-in/ios/start-integrating)
及 [Android Google 登入設定](https://developer.android.com/identity/sign-in/credential-manager-siwg)。
Windows／Linux 使用 PKCE；Apple 使用 Google Sign-In SDK；Android 使用 Credential Manager
選帳號，再由 AuthorizationClient 取得 Drive 授權。

## 填入設定與建置

把 [.env.example](../.env.example) 複製成 `.env`，填寫 `WORK_FLEET_GOOGLE_PROJECT_ID`
及要建置的平台 client。`.env` 已被 Git 忽略；shell／CI 同名值優先。
只需 Windows／Linux 登入時不用為其他平台建立 client。
正式 Apple／Android 註冊前先決定 `WORK_FLEET_APP_ID`，使它與 Cloud 註冊一致。

```bash
# 列出各平台 Google 公開設定缺項，與商店／簽章設定分開。
npm run config:check -- --google
# 單一平台缺項時回傳非零狀態，適合建置前使用。
npm run config:check -- --google --platform windows
```

Client ID 是公開識別；程式不要求填入 Web client secret、service-account JSON 或登入 token。
access／refresh token 由原生安全儲存或 Google SDK 管理，不會寫入 `.env` 或交給 renderer。
空值建置會停用 Google 登入按鈕，仍能記錄與備份。
`config:check` 只能判斷公開欄位是否已填，不能證明 API 已啟用、簽章吻合或帳號已授權。

重新建置入口見 [Setup](setup-guide.md)。在真正的 Mac 上可執行：

```bash
npm ci --ignore-scripts
bash scripts/macos/build-native-app.sh --platform macos
bash scripts/macos/build-native-app.sh --platform ios --simulator
```

Apple 編譯由維護者在 Mac 處理，不需啟動 hosted Actions。

## 帳號與資料操作

- 帳號與同步在側欄左下角的帳號區：顯示目前帳號及同步狀態，點一下開啟選單。
- 按選單中的「登入 Google」，完成身分與 App 資料授權後，開啟該 Google 帳號自己的工作空間。
  既有本機便箋不會自動上傳；要搬過去可先匯出備份，再在 Google 工作空間匯入。
- App 資料位於隱藏的 appDataFolder，不會出現在一般 Drive 檔案清單。
- 已登入工作空間每 20 秒嘗試同步，也可按帳號選單的「立即同步」。離線／失敗保留本機資料及待送內容。
- 出現「重新登入 Google」時，用原帳號重新授權；若選另一帳號，就開啟另一份工作空間。
- 「切換到本機便箋」回到 local；「登出 Google」移除目前帳號憑證並嘗試撤銷授權。
  兩者都保留原帳號的本機便箋、草稿及待送內容。
- 跨裝置共用內容、群組與附件；每台裝置的版面保持獨立。

## 設定問題

| 現象 | 處理 |
|---|---|
| 登入按鈕停用 | 填該平台 client ID，Android 另填 Web client ID，重新建置原生 App |
| `redirect_uri_mismatch` | Windows／Linux 用 Desktop client；Apple 用符合 bundle ID 的 iOS client，重新生成工程 |
| Android 開發者設定錯誤／無法選帳號 | 核對 package、實際簽章 SHA-1 與同專案的 Web client |
| 未授權 App 資料／403 | 啟用 Drive API，允許 appdata scope，核對測試使用者或 Workspace 管理員政策 |
| 授權失效／401 | 重新登入原帳號；Testing 的授權可能到期，本機待送資料仍保留 |
| 另一台裝置看不到資料 | 確認帳號相同、clients 屬於同一專案，以及兩邊同步成功 |

完整實作及未執行項目以 [PROGRESS](../PROGRESS.md) 為準。
