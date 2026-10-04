# Android native App

Native Activity／WebView、SQLite 交易、Android Keystore AES-256-GCM、Storage Access Framework 備份，
Credential Manager 帳號選擇及 Google AuthorizationClient Drive 授權。手機不要求桌面 overlay 權限。
原生 WebView 只讀封裝資產；Google／檔案操作透過固定 bridge，沒有 local note server。

建置前在 repo 根目錄 `npm ci`，填寫 `.env`。JDK 17、Gradle 8.13、Android SDK platform 36。
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
沒有 inputs 的 release AAB 未簽章，須交給外部簽章 pipeline；Gradle cache 預設在 `build/gradle-home`。
Google 需同一專案的 Android client（package＋簽章 SHA-1）及 Web client（Credential Manager audience）。
設 `WORK_FLEET_GOOGLE_ANDROID_CLIENT_ID`／`WORK_FLEET_GOOGLE_WEB_CLIENT_ID` 後重新建置。
不需要 Web client secret，也不建立自家登入 server。

系統生命週期不保證關閉回呼，因此本文輸入即保存草稿。返回鍵先要求 renderer 保存再關閉。
Android 強制終止或背景回收只靠最後已提交的 SQLite 交易恢復。
自動備份依共用 journal 在 App 執行時排程，沒有宣稱任意背景時段一定執行。
外部文件提供者若不能 fsync／讀回確認，備份報失敗並保留新檔，不能回報成功或自動改存明文。

原生建置、真裝置、Google 往返及簽章／商店驗收狀態只見根目錄 PROGRESS。
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
