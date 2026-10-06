# Android native App

Native Activity／WebView、SQLite 交易、Android Keystore AES-256-GCM、Storage Access Framework 備份，
Credential Manager 帳號選擇及 Google AuthorizationClient Drive 授權。手機不要求桌面 overlay 權限。
原生 WebView 只讀封裝資產；Google／檔案操作透過固定 bridge，沒有 local note server。

## Android Studio 開啟與建置

保留完整 repository checkout，在 Android Studio 的 **Open** 選擇本目錄
`src/native/android`（含 `settings.gradle.kts`），不是 repository 根目錄，也不是 `app` 子目錄。
專案已附 `gradlew`、`gradlew.bat` 與 `gradle/wrapper/`；不需要另外安裝 Gradle。

1. 安裝 Node 22+（含 npm）。Gradle 會依 IDE 傳給建置的 PATH 找出 `node`／`npm` 的絕對路徑，
   因此 macOS 從 Dock 開啟、會載入登入 shell PATH 的 Android Studio，也能使用 nvm／Homebrew 安裝的 Node。
2. 用 SDK Manager 安裝 Android SDK Platform 36、Build Tools 35.0.0；Gradle JDK 使用 JDK 17
   或相容的新版本。Android Studio 需支援 AGP 9.4.1；版本相容性見
   [官方說明](https://developer.android.com/build/releases/agp-8-13-0-release-notes)。
3. Open 本目錄，完成 Gradle Sync，選擇 `app` 的 `debug` variant，再使用 Run 或 Build APK。
   初次建置會下載 Gradle 9.6.0／Maven 依賴，並自動執行 `npm ci --ignore-scripts`、產生共用介面與公開配置。
   不需要先執行 `npm run build`；沒有 `.env` 也能建置本機 preview，Google 功能需另行配置。

Android Studio 自行產生的 `local.properties` 只保存本機 SDK 路徑，已排除版本控制。
若 IDE 沒有載入 shell 環境而找不到 Node／npm，在本機 Gradle user properties 設定
`workFleetNode`／`workFleetNpm` 為執行檔路徑（Windows 路徑用 `/`）；也支援
`WORK_FLEET_NODE`／`WORK_FLEET_NPM` 環境變數。請勿把個人路徑提交至專案設定。

在本目錄直接使用命令列也可建置；需設定 `JAVA_HOME` 及 `ANDROID_HOME`，或使用 IDE 產生的 SDK 路徑：

```powershell
.\gradlew.bat assembleDebug
```

```bash
bash ./gradlew assembleDebug
```

APK 位於 `app/build/outputs/apk/debug/app-debug.apk`。
Gradle 將介面與 `config/public.json` 產生到 `app/build/generated/web-assets/`，同一建置納入 APK；
不讀取 repository 根目錄可能過期的 `build/app` 或 `build/config/public.json`。
修改 `.env` 的 application ID 後重新 Gradle Sync；其他公開設定也在建置時更新。

## Repository 建置腳本

也可從 repository 根目錄使用以下入口。Node 22+、npm、JDK 17、Android SDK platform 36 為前置條件；
腳本同樣使用 Gradle Wrapper，自動產生資產。
Windows 已有 JDK 時，可執行 `scripts/windows/Install-AndroidToolchain.ps1 -AcceptSdkLicenses`，
從官方下載固定 SDK command-line tools／Gradle 並比對官方 SHA-256，安裝 API 36／Build Tools 35.0.0。
需先閱讀並接受 [Google SDK 條款](https://developer.android.com/studio#terms-and-conditions)。
工具與 SDK 只寫入 `build/toolchain`；自動產生本機 paths JSON，建置入口讀取它，不更動系統 PATH。
`.env`／process environment 的 `ANDROID_HOME`、`JAVA_HOME`、`GRADLE_HOME` 可覆蓋產生的路徑。

```powershell
.\scripts\windows\Build-AndroidApp.ps1
.\scripts\windows\Build-AndroidApp.ps1 -Release
.\scripts\windows\Build-AndroidApp.ps1 -Signed
```

```bash
bash scripts/linux/build-android-app.sh
bash scripts/linux/build-android-app.sh --release
bash scripts/linux/build-android-app.sh --signed
```

Debug 預設 application ID 為 `app.workfleet.preview`。Release 要求正式公開設定。
簽章由 `WORK_FLEET_ANDROID_KEYSTORE`（絕對路徑）、`WORK_FLEET_ANDROID_KEY_ALIAS`、
`WORK_FLEET_ANDROID_STORE_PASSWORD`、`WORK_FLEET_ANDROID_KEY_PASSWORD` 四個 process／CI 變數提供，
不寫入 repo／`.env`／公共 JSON。`-Signed`／`--signed` 要求完整 inputs，缺少時停止。
在 Android Studio 使用 release variant 或直接 `gradlew bundleRelease` 時，同樣檢查正式公開設定。
沒有 inputs 的 release AAB 未簽章，須交給外部簽章 pipeline；Gradle cache 預設在 `build/gradle-home`。
Google 需同一專案的 Android client（package＋簽章 SHA-1）及 Web client（Credential Manager audience）。
設 `WORK_FLEET_GOOGLE_ANDROID_CLIENT_ID`／`WORK_FLEET_GOOGLE_WEB_CLIENT_ID` 後重新建置。
不需要 Web client secret，也不建立自家登入 server。

系統生命週期不保證關閉回呼，因此本文輸入即保存草稿。返回鍵先要求 renderer 保存再關閉。
Android 強制終止或背景回收只靠最後已提交的 SQLite 交易恢復。
自動備份依共用 journal 在 App 執行時排程，沒有宣稱任意背景時段一定執行。
外部文件提供者若不能 fsync／讀回確認，備份報失敗並保留新檔，不能回報成功或自動改存明文。

原生建置、真裝置、Google 往返及簽章／商店驗收狀態只見根目錄 PROGRESS。
Gradle Wrapper 為 Gradle 9.6.0 官方工具產生，distribution SHA-256 固定於 wrapper properties；
來源與 Apache-2.0 授權見根目錄 THIRD-PARTY-NOTICES 及本目錄 `gradle/LICENSE.txt`／`NOTICE.txt`。
Gradle 依 Debug／Release runtime graph 產生每 variant 的隨包授權資料，保存 artifact SHA-256、
上游 POM、AAR／JAR 中的 LICENSE／NOTICE／COPYING，另保留 Apache-2.0 全文。
APK／AAB 的 assets 內含 `licenses/native/inventory.json`；缺少 POM 或 license declaration 明確標示，
不自動推定授權。生成資料只含版本／upstream 文本，沒有憑證或本機 artifact 路徑。
每輪使用新的生成目錄，保留既有 build outputs，不將舊版 generated notices 混入本輪 variant。

附件與草稿下載使用 ACTION_CREATE_DOCUMENT 保存，不把 blob URL 交給外部瀏覽器。
編輯器可分享 Markdown 文字及單一附件；內容先通過 bounded transfer／SHA-256，
以 FileProvider 的 content URI 與只讀暫時權限開啟系統分享面板，無公開 filesystem path。
分享暫存限制 32 份／256 MiB，下次分享清除超過 24 小時的自有暫存；原資料保持在加密 SQLite。
取消選檔不消耗草稿；分享面板開啟不代表收件 App 已成功接收。

ACTION_SEND／SEND_MULTIPLE 接收文字與 content URI 檔案，標題及本文合併保留，無任意 URL 下載。
內容先保存至 Keystore／AES-GCM 加密的分享收件匣；重啟可讀取，原生 intent 保存同一識別避免重播。
主畫面選擇目前帳號的群組後才接收為草稿，保存草稿成功才移除收件匣項目。
一次最多 256 KiB 文字、16 份檔案、25 MiB 檔案總量；收件匣最多 64 份／512 MiB。
容量／授權／保存失敗保留原來源；重試辨識草稿與卡片中的 capture receipt，避免重複建立。
捨棄分享需在主畫面確認；收件匣位於 no-backup 私有目錄，移除 App 或金鑰會失去解密能力。
