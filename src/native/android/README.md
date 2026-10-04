# Android native App

Native Activity／WebView、SQLite 交易、Android Keystore AES-256-GCM、Storage Access Framework 備份，
Credential Manager 帳號選擇及 Google AuthorizationClient Drive 授權。手機不要求桌面 overlay 權限。
原生 WebView 只讀封裝資產；Google／檔案操作透過固定 bridge，沒有 local note server。

建置前在 repo 根目錄 `npm ci`，填寫 `.env`。JDK 17、Gradle 8.13、Android SDK platform 36。

```powershell
.\scripts\windows\Build-AndroidApp.ps1
.\scripts\windows\Build-AndroidApp.ps1 -Release
```

```bash
bash scripts/linux/build-android-app.sh
bash scripts/linux/build-android-app.sh --release
```

Debug 預設 application ID 為 `app.workfleet.preview`。Release 必須設定 `WORK_FLEET_APP_ID`；
不在 repo 保存 keystore 或密碼，release AAB 交給外部簽章 pipeline。
Google 需同一專案的 Android client（package＋簽章 SHA-1）及 Web client（Credential Manager audience）。
設 `WORK_FLEET_GOOGLE_ANDROID_CLIENT_ID`／`WORK_FLEET_GOOGLE_WEB_CLIENT_ID` 後重新建置。
不需要 Web client secret，也不建立自家登入 server。

系統生命週期不保證關閉回呼，因此本文輸入即保存草稿。返回鍵先要求 renderer 保存再關閉。
Android 強制終止或背景回收只靠最後已提交的 SQLite 交易恢復。
自動備份依共用 journal 在 App 執行時排程，沒有宣稱任意背景時段一定執行。
外部文件提供者若不能 fsync／讀回確認，備份報失敗並保留新檔，不能回報成功或自動改存明文。

原生建置、真裝置、Google 往返及簽章／商店驗收狀態只見根目錄 PROGRESS。

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
