# Google 登入與 Drive 設定

五平台原生 host 已接登入、帳號工作空間及 Drive appDataFolder 同步程式。
瀏覽器開發預覽只有本機資料，不提供 Google 登入。
2026-10-06 已建立 Google Cloud 專案（同意畫面測試中）與 Windows／Linux 共用的 Desktop client；
Windows 真實登入與 Drive 上傳（含 1.9 MB 附件分段續傳）已驗收。
2026-10-17 iOS／Android／Web clients 已建立，與既有 macOS client 一起保存於 GitHub repository variables。
目前手機 preview 使用 `app.workfleet.preview`；Android client 對應這台 Mac 的 debug 簽章，其他簽章需另行註冊。
手機原生建置及模擬授權回歸不代表真實登入／跨裝置下載已驗收，實際證據見 PROGRESS。

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
| Windows | Desktop app；MSIX 裡的程式也是桌面 App，使用系統瀏覽器與 loopback callback | `WORK_FLEET_GOOGLE_WINDOWS_CLIENT_ID`、`WORK_FLEET_GOOGLE_WINDOWS_CLIENT_SECRET` |
| Linux | Desktop app；可與 Windows 共用同一個 Desktop client（ID 與 secret 都填同一組） | `WORK_FLEET_GOOGLE_LINUX_CLIENT_ID`、`WORK_FLEET_GOOGLE_LINUX_CLIENT_SECRET` |
| macOS | iOS 類型 client，bundle ID 使用目前建置的 `WORK_FLEET_APP_ID` | `WORK_FLEET_GOOGLE_MACOS_CLIENT_ID` |
| iOS | iOS 類型 client，bundle ID 使用目前建置的 `WORK_FLEET_APP_ID` | `WORK_FLEET_GOOGLE_IOS_CLIENT_ID` |
| Android | Android client，package 使用目前建置的 `WORK_FLEET_APP_ID`，註冊實際簽章憑證 SHA-1 | `WORK_FLEET_GOOGLE_ANDROID_CLIENT_ID` |
| Android 登入 audience | 同一專案另建 Web application client；只用公開 ID，沒有自家登入 server | `WORK_FLEET_GOOGLE_WEB_CLIENT_ID` |

Android 本機 debug、upload key 與 Google Play App Signing 的憑證可能不同，
應為實際使用的 package／SHA-1 組合各自註冊 Android client。
從 Play 安裝的版本使用 Play Console 的 **app signing certificate**，不能只註冊 upload key。
尚未指定正式 App ID 時，預覽 package／bundle ID 是 `app.workfleet.preview`。
Apple callback scheme 由生成腳本從 client ID 產生，不須手寫 Info.plist。
可先以目前 preview 身分驗證登入，不需等待 Play Console 或商店上架。
未來更換正式 package／bundle ID 時，在同一 Google Cloud 專案建立對應 clients 並重建；
OS 會把新識別視為另一個 App，本機資料須另行以備份搬移。

Android 的 Web client 是 Credential Manager 的 `serverClientId`／ID token audience：
選帳號時使用公開 Web Client ID，接著由 AuthorizationClient 取得 Drive 權限並向 Google userinfo 核對穩定 sub。
這個流程沒有自家登入後端，Web client 的 JavaScript origins／redirect URIs 可留空，不使用其 Client Secret。

macOS 在 Google Auth Platform＞Clients＞Create client 的欄位：

| 欄位 | 設定 |
|---|---|
| Application type | iOS，供 Google 的 Apple SDK 使用 |
| Name | 例如 `Work Fleet macOS`，僅供管理識別 |
| Bundle ID | 與 `WORK_FLEET_APP_ID` 相同；目前預覽為 `app.workfleet.preview` |
| App Store ID | GitHub 預覽版留空；上架後才填 App Store 網址中的數字 ID |
| Apple Team ID | 選填；已有 Apple team 時填 `WORK_FLEET_APPLE_TEAM_ID` 的值，iOS／macOS 使用同一團隊時填同一組 |
| Firebase App Check | 本專案尚未配置該驗證，建立時維持關閉；啟用它會要求 Team ID |
| Use this client for an AI-powered agent | 維持未勾選；本 client 用於 App 的 Google 登入與 Drive 同步 |

建立後，把公開的 Client ID 設為 `WORK_FLEET_GOOGLE_MACOS_CLIENT_ID`，GitHub Actions 使用同名 repository variable。
欄位定義見 [Google native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)，
AI client 宣告見 [Manage OAuth Clients](https://support.google.com/cloud/answer/15549257?hl=en)。

授權流程依 [Google installed-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、
[Apple Google 登入設定](https://developers.google.com/identity/sign-in/ios/start-integrating)
及 [Android Google 登入設定](https://developer.android.com/identity/sign-in/credential-manager-siwg)。
Windows／Linux 使用 PKCE；Apple 使用 Google Sign-In SDK；Android 使用 Credential Manager
選帳號，再由 AuthorizationClient 取得 Drive 授權。

## 填入設定與建置

把 [.env.example](../.env.example) 複製成 `.env`，填寫 `WORK_FLEET_GOOGLE_PROJECT_ID`
及要建置的平台 client。`.env` 已被 Git 忽略；shell／CI 同名值優先。
只需 Windows／Linux 登入時不用為其他平台建立 client。
Apple／Android 的 `WORK_FLEET_APP_ID` 必須與該次 Cloud 註冊一致；目前先用 preview 身分。
GitHub Variables 只會傳給有引用它們的 Actions，本機 Xcode／Gradle 不會自動下載；
本機仍需把公開 client IDs 與 project ID 填入 Git 忽略的 `.env`。Web Client Secret 不放進 `.env`。

```bash
# 列出各平台 Google 公開設定缺項，與商店／簽章設定分開。
npm run config:check -- --google
# 單一平台缺項時回傳非零狀態，適合建置前使用。
npm run config:check -- --google --platform windows
```

Client ID 是公開識別。Desktop client 另需 client secret：Google 的換 token 端點即使用 PKCE 仍會回
`client_secret is missing`，而 Google 把安裝型 App 的 secret 視為不保密，所以它隨 Windows／Linux App 發佈。
建置時只寫進該平台 App 旁的 `Config/public.json`，不進介面資產，也不進 Android／Apple 包。
Google 之後不會再顯示完整 secret，建立 Desktop client 時請下載 JSON 保存。
程式不要求填入 Web client secret、service-account JSON 或登入 token。
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

- 帳號與同步在「設定 → 帳號與同步」：點側欄左下角的帳號區直接開啟，顯示目前帳號、同步狀態與登入、切換、登出。
- 按選單中的「登入 Google」，完成身分與 App 資料授權後，開啟該 Google 帳號自己的工作空間。
  既有本機便箋不會自動上傳；要搬過去可先匯出備份，再在 Google 工作空間匯入。
- App 資料位於隱藏的 appDataFolder，不會出現在一般 Drive 檔案清單。
- 已登入工作空間每 20 秒嘗試同步，也可在「帳號與同步」按「立即同步」。離線／失敗保留本機資料及待送內容。
- 出現「重新登入 Google」時，用原帳號重新授權；若選另一帳號，就開啟另一份工作空間。
- 「切換到本機便箋」回到 local；「登出 Google」只移除這台裝置上的帳號憑證，其他裝置維持登入。
  兩者都保留原帳號的本機便箋、草稿及待送內容。
  要讓所有裝置都失去存取，請到 Google 帳戶的「第三方應用程式」移除 Work Fleet。
  0.2.3（含）以前的版本登出時會撤銷授權，同一帳號的其他裝置會在一小時內陸續要求重新登入。
- 跨裝置共用內容、群組與附件；每台裝置的版面保持獨立。
- Google 工作空間的「重設所有資料」會一起清除 Drive 的 App 資料：先寫入重設標記，再逐一刪除其他檔案，最後清掉這台裝置的副本。
  其他裝置下次同步看到標記會停止同步並詢問：清除這台裝置的副本後重新同步、先匯出備份，或稍後再處理；不會自動刪除它們的資料。
  需要能用的 Google 登入；刪除中途失敗時本機資料仍在，可再按一次重設。
- 全新帳號或清除副本後，先完成雲端資料讀取才建立「我的便箋」並可新增便箋／接收分享；多台同時連接共用同一初始群組。
  已有群組時仍可離線編輯。此修正需各裝置更新；舊版可能繼續建立不同的預設群組。
  已產生的同名群組保留原資料，可在群組設定明確合併，不會按名稱自動清除。

## 從本機備份完整覆蓋 Google

1. 在本機便箋的「設定 → 資料與備份」匯出 ZIP，確認保存成功；解除安裝 MSIX 前也要先備份。
2. 登入要還原的 Google 帳號，先停止其他裝置同步。在 Google 工作空間開啟「資料與備份」，
   選擇該 ZIP 與「清空 Google 後，從備份還原」，填入備份密碼後按「檢查檔案」。
3. 核對目標帳號及數量，按「先備份目前資料」，選定安全 ZIP 保存位置並等待檢查成功。
   再勾選永久清空確認，按「確認還原」。
4. App 先保存完整還原資料，再清空目前 Google 專案的所有 Work Fleet appDataFolder 資料，
   然後上傳備份的便箋、群組、全部歷史與附件。備份草稿只回到這台裝置，不自動發布；桌面位置仍是每機設定。
5. 若中斷或失敗，重新開啟後到「帳號與同步」按「繼續覆蓋 Google」。上傳階段重試不會再清空；
   需要恢復網路／登入權限。其他舊裝置遇到雲端重設提示時，先備份尚未同步的內容，再清除副本並重新同步。

這是永久全量覆蓋；Google 多檔案操作無法原子完成，中斷時可能有空白或部分還原狀態。
清空前已保存的安全 ZIP 可另行還原。重設控制標記保留用於通知舊裝置；一般 Drive 檔案不受影響。
原有「加入成新的便箋」「與目前的便箋合併」「取代目前的便箋」保留原本歷史語意，最後一項不會清空舊歷史及刪除區。
沒有配置 Google client 的本機包不提供登入或雲端覆蓋；填 `.env` 後重新建置，備份不攜帶登入憑證。

## 下載 Google 備份，轉為離線本機便箋

本機與 Google 使用同一個可選加密 ZIP 格式，可互相匯入，沒有來源帳號或 Drive file ID 綁定。

1. 在 Google 工作空間的「設定 → 資料與備份」按「匯出備份」，選擇儲存位置。
   App 先同步，再匯出本次同步取得的便箋、群組、歷史、附件與這台的草稿。
   同步失敗預設不保存；可明確選擇「只備份這台已知資料」，並確認訊息中的最後成功同步時間與待同步數量。
2. 確認 ZIP 已保存。其他裝置尚未上傳的內容與草稿不在這份備份，必要時先在那些裝置同步或各自匯出。
3. 從帳號選單選「切換到本機便箋」，再開啟「資料與備份」並選該 ZIP。
   要保留既有本機內容選匯入／合併；要完全換成備份選「清空本機後，從備份還原」。
4. 按「檢查檔案」，核對清除範圍與還原數量，勾選永久取代確認，再按「確認還原」。
   舊本機資料備份是可選的，不需先重設；還原失敗會保留原資料。成功後舊歷史／草稿／附件不留在刪除區。

此後使用本機工作空間即可專門離線編輯，不會回寫原 Google；雲端便箋及其他帳號分區保留。
草稿仍需使用者手動保存，不會因還原自動發布。本機自動備份設定與已保存的 ZIP 不因完整還原清除。
同一 ZIP 也能還原至另一個 Google 工作空間；需要完整覆蓋時使用上面的 Google 全量模式，仍需安全備份。

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

## 手機登入驗收

在裝置上使用與 OAuth 註冊相同 bundle／package、實際簽章的建置，並加入 Google Auth Platform 的測試使用者：

1. 先在本機工作空間留下便箋與草稿，再從「帳號與同步」登入 Google 並允許 App 資料存取。
   成功後開啟該帳號分區；原本本機便箋保留，不自動搬至 Google。
2. 在選帳號或授權時取消：回到原工作空間，仍可編輯、同步與重試；取消不顯示為同步故障。
3. 手動同步、新增便箋及附件，確認另一台同帳號裝置能同步；強制結束再重開後驗證登入恢復。
4. 切換另一個帳號，確認便箋與待送內容分區；登出只影響這台裝置，其他裝置維持登入。
5. 關閉網路或拒絕 Drive 權限：顯示可理解的提示並保留原資料；恢復條件後可重新登入／同步。

Android 會清除這台的 Credential Manager 帳號選擇狀態，使下次登入可重新選帳號；不撤銷 Google 雲端授權。
Apple 開啟選帳號前保留既有 SDK session，取消時仍能使用原帳號。
來源與模擬測試界線見 [手機授權研究](research/2026-10-17-mobile-google-sign-in.md)。
