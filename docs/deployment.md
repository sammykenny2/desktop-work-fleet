# 平台與散布狀態

更新：2026-10-15；各平台版號紀錄為 0.2.5，完整 1.0 仍是目標。發布前準備以 [PROGRESS](../PROGRESS.md) 為準，發布結果見 GitHub Releases。

| 平台 | 封裝入口 | 產物與前置條件 |
|---|---|---|
| Windows x64 | `scripts/windows/Build-WindowsPackage.ps1` | 自帶 .NET 8 Desktop 的 MSIX／portable ZIP；執行仍需 WebView2，封裝需 .NET SDK／Windows SDK |
| macOS | Xcode Open `src/native/apple/WorkFleet.xcodeproj`；或 `scripts/macos/build-native-app.sh --platform macos --release`、`package-native-app.sh` | xcarchive／PKG／可選 DMG；Xcode、Node 22+／npm、Apple team 與 signing identities |
| Linux | `scripts/linux/build-native-app.sh`；可選 `--release --deb`；Windows 可用 `Build-LinuxPackage.ps1` | source/runtime tar.gz／DEB；離線便箋需系統 GTK／WebKitGTK，Google／保存備份密碼另需 Secret Service |
| iOS | 同一份已提交的 Xcode 專案，選 WorkFleetIOS；或 `scripts/macos/build-native-app.sh --platform ios --release`、`package-native-app.sh` | xcarchive／IPA；Xcode、Node 22+／npm、Apple team、App／Extension 的 App Group profiles |
| Android | Android Studio Open `src/native/android`；或 `scripts/windows/Build-AndroidApp.ps1`／`scripts/linux/build-android-app.sh` | debug APK／release AAB；Node 22+、npm、JDK 17、Android SDK 36。已附 Gradle 8.13 Wrapper，自動產生資產；[開啟與建置說明](../src/native/android/README.md) |

## 版號與發佈檔名

Windows 支援範圍依 [ADR-034](decisions/034-windows-11-compatibility-and-install-floor.md)：目標涵蓋早期 Windows 11／23H2 與 24H2+，Windows 10 排除安裝。
MSIX 產生器與先前本機 0.1.1 包已驗證 `Windows.Desktop MinVersion=10.0.22000.0`、`MaxVersionTested=10.0.26200.0`。
23H2 原生探針通過；2026-10-10 使用者回報本機測試目前沒有看到特別問題，並授權 0.1.2 預覽發布。
其他 Windows 11 版本與完整互動矩陣仍未驗收，Store 身份／提交尚未開始。編譯 framework 的 Windows 10 API 基線不等於產品支援範圍。

各平台的版號分別記在 repo 的固定檔案，同一平台的所有建置入口只讀該紀錄；任何升版都須先取得使用者對具體版號的明確同意。
自 0.2.0 起五個平台共用同一版號（使用者 2026-10-14 決定），一起升版；release tag 仍以平台前綴區分（`windows-v`、`linux-v`、`macos-v`），
因為各平台的 App 內更新只找自己前綴的 release。Apple `CURRENT_PROJECT_VERSION` 與 Android `versionCode` 同步提高（0.2.0 為 200，0.2.1 為 201，0.2.2 為 202，0.2.3 為 203，0.2.4 為 204，0.2.5 為 205）。
檔名不取自建置機器的架構、憑證或環境，同一 commit 在任何開發機都產生相同檔名。
腳本產生的每個發佈檔旁另有同名 `.sha256`，可用 `sha256sum -c` 或 `shasum -a 256 -c` 檢查。

所有平台的發佈檔與 `.sha256` 都直接放在 `build/`，同一層、沒有隨機子目錄；同名舊檔直接覆蓋，不同版號並存。
中間產物放在各平台固定的工作目錄，每次建置開始時清空：Windows `build/windows/package`、
Apple `build/apple/preview-<macos|ios>`（另有 README.txt／toolchain.txt）與 `build/apple/export-<macos|ios>`、
Linux `build/linux/work-fleet-<版號>`；Android 由 Gradle 輸出後複製到 `build/`。
Windows 與 Apple 只在整個建置、簽章、公證都成功後才把檔案移到 `build/`，失敗不會留下半成品。

- Windows：`src/native/windows/Directory.Build.props` 的 `<Version>`，供組件版本、MSIX identity（補 `.0`）
  與 `WorkFleet-<版號>-x64.msix`／`WorkFleet-<版號>-x64.zip`。
- macOS／iOS：`src/native/apple/config/WorkFleet.xcconfig` 的 `MARKETING_VERSION`／`CURRENT_PROJECT_VERSION`；
  Local.xcconfig 或命令列覆蓋會讓資源準備失敗。封裝腳本讀 App 內的 Info.plist。
  - macOS 命令列建置一律含 arm64／x86_64，封裝前檢查兩種架構。
    正式匯出為 `WorkFleet-<版號>-macos-universal.pkg`／`.dmg`；
    預覽為 `WorkFleet-<版號>-macos-universal-<unsigned|development>.zip`，加 `--dmg` 改為 `.dmg`。
  - iOS 預覽為 `WorkFleet-<版號>-ios-<unsigned|development>.ipa`、`WorkFleet-<版號>-ios-simulator.zip`；
    正式匯出依 `--method` 命名為 `WorkFleet-<版號>-ios-<method>.ipa`；
    macOS 的 `app-store-connect` 匯出為 `WorkFleet-<版號>-macos-universal-app-store-connect.pkg`。
  - 預覽後綴取自 App 本身的簽章，不看建置機器有哪些憑證。
- Android：`src/native/android/app/build.gradle.kts` 的 `versionName`；
  `WorkFleet-<版號>-android-debug.apk`／`WorkFleet-<版號>-android-release.aab`。
- Linux：`src/native/linux/VERSION`；`build/work-fleet_<版號>_all.deb` 依 Debian 的
  `套件_版號_架構` 慣例，source/runtime 為 `build/work-fleet-<版號>.tar.gz`。

公開設定在 `.env.example`：各平台 Google client、app ID、Apple team／App Group、Microsoft
package identity／publisher、隱私與支援資料。私鑰／密碼由 OS Keychain 或 CI environment 提供。
`-Release`／`--release` 要求正式公開設定；preview 仍允許 Google 未配置，保留本機記錄。

Windows 封裝腳本在固定的 `build/windows/package` 建置，成功後把 MSIX／ZIP（與 `-LocalTestSign` 的公開 CER）移到 `build/`。
可提供 `-CertificateThumbprint`（CurrentUser/My）與 HTTPS `-TimestampUrl` 簽署 MSIX；
publisher 必須與既有憑證 subject 或 Partner Center identity 相符。腳本不安裝憑證或改變信任。
本機 preview 試裝使用 `-LocalTestSign`，重用與 publisher 相符、有效且已在
LocalMachine/TrustedPeople 信任的 CurrentUser/My 憑證，不使用 timestamp、不允許與 `-Release` 合用。
可用 `-CertificateThumbprint` 指定既有憑證；省略時要求只有一張合適憑證，沒有時明確失敗。
成功後以 SignTool 驗證簽章並輸出公開 CER，私鑰留憑證存放區；已信任的本機可直接安裝該 MSIX。
無需 Windows Store 開發者帳號；其他測試電腦需先信任 CER，見
[Microsoft 本機簽章說明](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide)。
Windows 預設改採 self-contained `win-x64`，MSIX／ZIP 都包含 .NET 8 Desktop runtime，接收端不用另外安裝 .NET。
目前 self-contained runtime patch 固定為 `8.0.31`，與保留的 Desktop 授權／notices 對應；更新時一併核對 runtime 來源與授權。
WebView2 仍使用系統 Evergreen Runtime。包會增大，內附 .NET 的更新需要重新建置、測試及發布 App，見 [ADR-036](decisions/036-windows-self-contained-packaging.md)。
`-SkipRestore` 只適用已完成同設定 package restore、快取中含 win-x64 runtime packs 的機器；首次封裝不要加它。
一般 `Build-WindowsApp.ps1`／IDE 建置仍為 framework-dependent，不等同上述封裝產物。
既有 GitHub `windows-v0.1.2` 是變更前發布的 framework-dependent 包，仍需另裝 .NET 8 Desktop；本輪不覆蓋它。
ZIP 包含 `WorkFleet.exe`、內附 runtime 與依賴；MSIX 與 ZIP 都保留 runtime 的完整授權／notices 與 NuGet package metadata，不包含 runtime 安裝器。
未簽章 preview MSIX 不視為可直接安裝或商店交付，ZIP 也沒有執行檔簽章。
沒有既有受信任 preview 憑證時，可用一般 `Build-WindowsPackage.ps1 -SkipRestore` 產生未簽章 MSIX／ZIP，
以 `Test-WindowsPackage.ps1 -PackagePath build/WorkFleet-VERSION-x64.msix -Unsigned` 僅驗證包內容。
使用者解壓 ZIP 後執行 `WorkFleet.exe`；ZIP／未封裝 Debug 共用 `%LOCALAPPDATA%\WorkFleet`，先關閉同資料區的舊實例。
MSIX 使用套件私有資料區；更新保留，解除安裝清除所有套件內本機資料（含 Google 帳號分區、草稿、設定、憑證及 cache）。
同版號解除安裝再重裝前請先匯出備份，匯出的 ZIP 與 Google 雲端不受影響。
舊獨立目錄不自動搬移或刪除，先以舊版／ZIP 匯出，再於 MSIX 匯入；見 [ADR-037](decisions/037-msix-data-lifetime-and-google-backup-overwrite.md)。
這條路徑不建立憑證、不改信任，也不構成 MSIX 安裝驗收。

### Windows 預覽版發布

在 GitHub Release 發布 Windows 預覽版，讓其他電腦直接下載 MSIX。只在使用者要求發布時進行；一般實作、commit、push 都不升版、不發布。
2026-10-09 使用者補充：任何升版須先同意具體版號，單純要求預覽發布不授權自行選版號；GitHub Actions dispatch 也須明確授權，當前 session 已給的同意不重問。
本 repo 自 2026-10-14 公開，GitHub hosted 標準 runner 不計費；`ci.yml` 在每次 push 到 main 與 pull request 時執行文件化的檢查。
發布 workflow 仍只在使用者授權後手動 dispatch。
2026-10-10 使用者要求發布後不得再補 commit／push，以免日後 push 型 CI 重複執行。此規則適用所有平台，也適用 agent 的文件與交接收尾。

1. 獲准具體版號後，先完成本輪程式、測試、文件、交接與 `PROGRESS.md` 的準備紀錄。發布狀態只能記為「已備妥／待發布」，不能提前記成成功。
   確認目標 tag／release 尚不存在；已發布的版號不能再用。
2. 跑適當本機檢查並記下實際結果，再把 `src/native/windows/Directory.Build.props` 的 `<Version>` 與全部相關變更納入本輪最後一筆 release commit，push main。
   dispatch 前確認 worktree 乾淨、local HEAD 與 origin/main 相同，且版號是使用者同意的目標。
3. 獲准執行 Actions 後：`gh workflow run windows-preview.yml --ref main`（或在 Actions 頁面選 main 執行 Windows preview release）。
   記下 run URL 並核對 run 的來源 SHA 與最後一筆 release commit 相同；從 dispatch 開始，本輪對 repo 只做唯讀操作。
4. [windows-preview.yml](../.github/workflows/windows-preview.yml) 先確認 `windows-v<版號>` 的 tag 與 release 都不存在，並跑 `npm test`；
   再在 Windows runner 用 preview 憑證簽章打包，全部成功後才建立 tag 與 prerelease，附 MSIX、`.sha256` 與公開 CER。失敗不會留下 release。
5. 等待結果、下載至 Git 忽略目錄並驗證產物，在對話回報 run／release URL、來源 commit、驗證結果與必要的檔案大小／雜湊。
   最終 SHA、run URL 與發布成功／失敗等事後才知道的資料，以 GitHub 與對話為紀錄，不為補填這些資料再修改 tracked files、commit 或 push。

dispatch 後禁止以更新 `PROGRESS.md`、handoff、文件、產物清單或發布結果為理由補交提交；一般文件同步與 standing commit／push 授權不構成例外。
使用者之後明確要求新的修改任務，才可針對該任務繼續改 repo；不能自行把發布收尾當成新任務。
此界線不依賴目前 workflow 是否只有手動觸發，也不以 commit message 的 CI skip 指令取代。

GitHub repository 需要的設定：
- Variables：`WORK_FLEET_GOOGLE_PROJECT_ID`、`WORK_FLEET_GOOGLE_WINDOWS_CLIENT_ID`。
- Secrets：`WORK_FLEET_GOOGLE_WINDOWS_CLIENT_SECRET`、`WORK_FLEET_WINDOWS_SIGNING_PFX_BASE64`、`WORK_FLEET_WINDOWS_SIGNING_PFX_PASSWORD`。
  缺 Google 設定或簽章憑證時 workflow 直接失敗，不發布無法登入或無法安裝的包。

CI 簽章使用上述 repository secrets 內的 preview 憑證；本機 `-LocalTestSign` 使用本機存放區的憑證，兩者不一定是同一張。
相同 package identity／publisher 且版號較高的包可升級，但安裝端仍須信任該包的簽章憑證；從本機包換成 CI 包時，先核對並信任 release 附的公開 CER。
更換 CI 憑證時更新 signing secrets，各台測試電腦重新信任新的 CER；不要匯出或上傳本機不可匯出的私鑰。
安裝端每台電腦第一次要以系統管理員把 CER 匯入 LocalMachine/TrustedPeople，之後版號較高的 MSIX 可直接安裝升級，同版號要先解除安裝。
repository 公開後，release 頁面不需登入即可下載。

App 內更新（ADR-044）：`Build-WindowsPackage.ps1` 在 MSIX 旁產生 `build/work-fleet-update.json`（版號、tag、x64 安裝檔名稱、大小與 SHA-256；
`-UpdateSummary` 可加 500 字內的摘要），`Test-WindowsPackage.ps1` 會核對它與 MSIX 相符，`windows-preview.yml` 把它和 MSIX 一起附在 release。
已安裝的 MSIX 從設定＞桌面「版本與更新」或系統匣「檢查更新…」查詢 `windows-v<版號>` 的 release，下載、核對後先保存草稿並關閉，
再由 Windows 安裝；執行滿 60 秒的 App 會在安裝後重新開啟。沒有附 `work-fleet-update.json` 的舊 release 不會被選為更新。

Linux 預覽版：手動 `linux-release.yml` 以 `src/native/linux/VERSION` 建立 `linux-v<版號>` prerelease，附 DEB、`.sha256` 與
`work-fleet-update.json`（`package-deb.sh` 產生，`--update-summary` 可加摘要）。同樣需要使用者授權升版與 dispatch；需要的 repository 設定為
variables `WORK_FLEET_GOOGLE_PROJECT_ID`、`WORK_FLEET_GOOGLE_LINUX_CLIENT_ID` 與 secret `WORK_FLEET_GOOGLE_LINUX_CLIENT_SECRET`。
以 DEB 安裝的 App 才有 App 內更新：下載、核對後以 pkexec 安裝（需要系統密碼與 polkit 驗證代理程式），成功後保存並重新啟動。

桌面更新查詢三平台都使用公開 `releases.atom`，不使用未驗證 REST API；現有 release 的 manifest／appcast 不需改寫。
目前只支援 preview；Atom 的近期列表與正式頻道限制見 [ADR-044](decisions/044-desktop-in-app-updates-from-github-releases.md)。

macOS 預覽版與更新（Sparkle）：
1. 手動 `macos-release.yml` 發布 Developer ID 簽章、公證並 staple 的 DMG 與 Sparkle 更新 ZIP，
   不產生 PKG、不需要 Installer 憑證。版本、tag 與 GitHub prerelease 規則不變；dispatch 仍需使用者明確授權。
2. 準備 Developer ID Application `.p12`（含私鑰及 Apple intermediate）、匯出密碼，以及符合 App ID、
   Team、該憑證及 Keychain access group 的 **Developer ID distribution profile**。從 Apple Developer＞Profiles＞＋＞Developer ID 建立；
   Developer 角色的 API key 可能無權建立該 profile，可由 Account Holder／Admin 在網站下載。
   App sandbox 與 Data Protection Keychain 不因 CI 簽章而移除。
3. 公證使用本專案專用的 App Store Connect Team API key；Key ID 必須與 `.p8` 配對，Issuer ID 使用同一 team。
   GitHub variables：`WORK_FLEET_APPLE_TEAM_ID`、`WORK_FLEET_APP_ID`、`WORK_FLEET_GOOGLE_PROJECT_ID`、
   `WORK_FLEET_GOOGLE_MACOS_CLIENT_ID`、`WORK_FLEET_SPARKLE_PUBLIC_KEY`、`MACOS_APPLICATION_IDENTITY`、
   `WORK_FLEET_PRIVACY_URL`、`WORK_FLEET_SUPPORT_URL`、`WORK_FLEET_SUPPORT_EMAIL`。
   Secrets：`MACOS_DEVELOPER_ID_APPLICATION_P12_BASE64`、`MACOS_CERTIFICATES_PASSWORD`、`MACOS_DEVELOPER_ID_PROFILE_BASE64`、
   `MACOS_NOTARY_KEY_P8_BASE64`、`MACOS_NOTARY_KEY_ID`、`MACOS_NOTARY_ISSUER_ID`、`SPARKLE_PRIVATE_KEY`。
   runner 使用暫時 keychain、驗證 profile 的效期／Team／App ID／Keychain group／憑證，再以 manual signing archive 與 export；
   archive 的手動 profile 僅套用 WorkFleetMac Release target，不使用會影響 SPM 資源 bundle 的全域 provisioning override。
   即使失敗也清除暫存秘密。release 公開欄位在建置前一次檢查，不等 archive 才發現缺值。
4. 只有含公鑰、Developer ID 簽章的 App 有「檢查更新」；Sparkle 以 `sparkle:version`（`CURRENT_PROJECT_VERSION`）判斷新舊，
   所以每次發布都要提高它。

一次性 Sparkle 金鑰準備：resolve／build 套件後，工具位於 `build/apple/SourcePackages/artifacts/sparkle/Sparkle/bin/`。
以 `generate_keys --account app.workfleet.preview` 建立獨立 keychain item；以相同 account 的 `-p` 取得公鑰、
`-x 私鑰檔案` 匯出到 repo 外的安全備份，將其內容設為 secret `SPARKLE_PRIVATE_KEY`。
不要每次 release 重新產生或覆蓋此金鑰；本機以該 account 產生的金鑰需透過 `SPARKLE_PRIVATE_KEY_FILE` 傳給封裝腳本。
私鑰、憑證密碼與 `.p8` 不得放入公共設定或 Git；原始檔案的 base64 設定須是單行、無多餘前綴。

本機已安裝對應 profile／identity 並配置公開欄位後，可執行相同的 archive／export：

```bash
bash scripts/macos/build-native-app.sh --platform macos --release \
  --application-identity "$APPLICATION_IDENTITY" --provisioning-profile "$PROFILE_UUID"
SPARKLE_PRIVATE_KEY_FILE="$HOME/Signing/WorkFleet-Sparkle.key" \
  bash scripts/macos/package-native-app.sh --platform macos --method developer-id \
  --application-identity "$APPLICATION_IDENTITY" --provisioning-profile "$PROFILE_UUID" \
  --notary-profile work-fleet-notary --dmg --no-pkg
```

macOS Debug／Release target 明確設定 `LD_RUNPATH_SEARCH_PATHS` 的 `@executable_path/../Frameworks`，
讓 Sparkle 隨 App 搬移後仍可載入。archive 與 export 會檢查兩種架構的實際動態依賴；
export 在公證前另以 `--check-runtime` 啟動後立即退出，不開 UI 或 workspace。
缺 framework、載入路徑或原生載入失敗時停止封裝，不送公證、不交付更新檔。詳見 [測試](testing.md)。
公證後會檢查 App／DMG 簽章、Gatekeeper 與 staple，更新 ZIP 使用 Sparkle EdDSA 簽署；
全部成功才交付 `WorkFleet-<版號>-macos-universal.dmg`／`.zip`、各自 `.sha256`、`appcast.xml` 與 `work-fleet-update.json` 到 `build/`。
一般本機封裝仍預設產生 PKG；只有 `--no-pkg` 跳過它。若要公證 PKG，仍需 `--installer-identity`。
使用非預設 notary keychain 時，設定 `WORK_FLEET_SIGNING_KEYCHAIN`。

直接 Xcode 的 app ID／App Group／Team 使用 [Apple 專案](../src/native/apple/README.md) 的本機 xcconfig；
命令列 build wrapper 可用 `.env` 中非空的 identity 覆蓋。生成資產、DerivedData、archives 保留於忽略的目錄。
Apple export 使用 `--method app-store-connect|developer-id|debugging|release-testing`；iOS 不接受
Developer ID。export destination 固定為本機，沒有自動上傳商店。macOS 開啟 hardened runtime；
Developer ID 散布可指定 installer identity 與已存在的 Keychain notary profile，公證後 staple App／PKG。
可選 DMG 使用 application identity 簽署；公證 DMG 必須提供該 identity。憑證、profiles 與帳號由維護者配置。

Apple 可在手動 `.github/workflows/apple-native-build.yml` 使用 hosted Mac 編譯原生 unsigned
Debug ZIP／iOS device IPA，包含 iOS Extension；公開 repo 的 hosted runner 不計費，仍需使用者授權才 dispatch。
workflow 上限每 target 20 分鐘，產物保存七天。未簽章 IPA 仍需有效 signing／provisioning 才能安裝。
Android `-Signed`／`--signed` 要求四個簽章環境變數並產生 release AAB，詳見
[商店準備](release/README.md)。一般 release 在沒有 signing inputs 時產生未簽章 AAB。
Linux runtime tar.gz 沒有內嵌 Python／GTK；DEB 交給支援該依賴版本的發行版。
不同 distro、CPU、X11／Wayland、桌面與 compositor 的行為仍需各自取得證據。
Linux DEB 使用 `src/native/linux/VERSION` 的版號，早期版本不另加 `~preview`。一般建置可使用 preview maintainer contact；
release 仍需正式公開設定與 email，不由版號判定散布驗收是否完成。
Linux 與 Windows 建置入口直接輸出 `build/work-fleet_<版號>_all.deb`，封裝腳本自動移除本次 staging。
Windows 的 Docker 封裝只執行 dpkg-deb，沒有在 container 安裝 GUI、App 或提供 runtime 驗收結果。

1.0 授權見 [第三方聲明](../THIRD-PARTY-NOTICES.md) 及 `src/native/licenses/`。
SPM／Android 最終 SDK 授權盤點、真實原生截圖與商店表單仍依最終散布產物準備，見
[ADR-028](decisions/028-native-package-and-signing-entry-points.md)。

歷史 0.1.0 的 `scripts/macos/build-app.sh`／Python server／HTTPS 手機瀏覽器路徑保留供舊版使用，
其測試及 [依賴清單](validation/runtime-inventory.json) 不代表 1.0 的五平台 package 已完成。
