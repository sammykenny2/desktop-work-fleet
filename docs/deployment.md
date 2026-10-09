# 平台與散布狀態

更新：2026-10-09；Windows 版號為 0.1.1，完整 1.0 仍是目標。實際完成狀態以 [PROGRESS](../PROGRESS.md) 為準。

| 平台 | 封裝入口 | 產物與前置條件 |
|---|---|---|
| Windows x64 | `scripts/windows/Build-WindowsPackage.ps1` | MSIX／portable ZIP；.NET 8 Desktop、WebView2 runtime，封裝需 Windows SDK |
| macOS | Xcode Open `src/native/apple/WorkFleet.xcodeproj`；或 `scripts/macos/build-native-app.sh --platform macos --release`、`package-native-app.sh` | xcarchive／PKG／可選 DMG；Xcode、Node 22+／npm、Apple team 與 signing identities |
| Linux | `scripts/linux/build-native-app.sh`；可選 `--release --deb`；Windows 可用 `Build-LinuxPackage.ps1` | source/runtime tar.gz／DEB；系統 GTK／WebKitGTK／Secret Service |
| iOS | 同一份已提交的 Xcode 專案，選 WorkFleetIOS；或 `scripts/macos/build-native-app.sh --platform ios --release`、`package-native-app.sh` | xcarchive／IPA；Xcode、Node 22+／npm、Apple team、App／Extension 的 App Group profiles |
| Android | Android Studio Open `src/native/android`；或 `scripts/windows/Build-AndroidApp.ps1`／`scripts/linux/build-android-app.sh` | debug APK／release AAB；Node 22+、npm、JDK 17、Android SDK 36。已附 Gradle 8.13 Wrapper，自動產生資產；[開啟與建置說明](../src/native/android/README.md) |

## 版號與發佈檔名

Windows 支援範圍依 [ADR-034](decisions/034-windows-11-compatibility-and-install-floor.md)：目標涵蓋早期 Windows 11／23H2 與 24H2+，Windows 10 排除安裝。
MSIX 產生器與本次最終未簽章包已驗證 `Windows.Desktop MinVersion=10.0.22000.0`、`MaxVersionTested=10.0.26200.0`。
本次 23H2 原生探針通過；正常互動與安裝仍待驗收，Store 身份／提交尚未開始。編譯 framework 的 Windows 10 API 基線不等於產品支援範圍。

各平台的版號分別記在 repo 的固定檔案，同一平台的所有建置入口只讀該紀錄；不同平台可各自升版。
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
ZIP 包含 `WorkFleet.exe` 與依賴，兩種產物皆需系統 .NET 8 Desktop／WebView2，不含 runtime 安裝器。
未簽章 preview MSIX 不視為可直接安裝或商店交付，ZIP 也沒有執行檔簽章。
沒有既有受信任 preview 憑證時，可用一般 `Build-WindowsPackage.ps1 -SkipRestore` 產生未簽章 MSIX／ZIP，
以 `Test-WindowsPackage.ps1 -PackagePath build/WorkFleet-VERSION-x64.msix -Unsigned` 僅驗證包內容。
使用者解壓 ZIP 後執行 `WorkFleet.exe`；正常版本共用 `%LOCALAPPDATA%\WorkFleet`，先關閉舊實例並備份已有資料。
這條路徑不建立憑證、不改信任，也不構成 MSIX 安裝驗收。

### Windows 預覽版發布

在 GitHub Release 發布 Windows 預覽版，讓其他電腦直接下載 MSIX。只在使用者要求發布時進行；一般實作、commit、push 都不升版、不發布。
1. 升版：改 `src/native/windows/Directory.Build.props` 的 `<Version>`，commit 並 push。已發布的版號不能再用。
2. 觸發：`gh workflow run windows-preview.yml`（或在 Actions 頁面手動執行 Windows preview release），從 main 目前的 commit 建置。
3. [windows-preview.yml](../.github/workflows/windows-preview.yml) 先確認 `windows-v<版號>` 的 tag 與 release 都不存在，並跑 `npm test`；
   再在 Windows runner 用 preview 憑證簽章打包，全部成功後才建立 tag 與 prerelease，附 MSIX、`.sha256` 與公開 CER。失敗不會留下 release。

GitHub repository 需要的設定：
- Variables：`WORK_FLEET_GOOGLE_PROJECT_ID`、`WORK_FLEET_GOOGLE_WINDOWS_CLIENT_ID`。
- Secrets：`WORK_FLEET_GOOGLE_WINDOWS_CLIENT_SECRET`、`WORK_FLEET_WINDOWS_SIGNING_PFX_BASE64`、`WORK_FLEET_WINDOWS_SIGNING_PFX_PASSWORD`。
  缺 Google 設定或簽章憑證時 workflow 直接失敗，不發布無法登入或無法安裝的包。

簽章用的是本機 `-LocalTestSign` 那張 `CN=Work Fleet Preview` 自簽憑證（2027-10-05 到期），所以本機包與 CI 包同一個 publisher、可以互相升級。
換憑證時本機與 secret 要一起換，各台電腦重新信任新的 CER。
安裝端每台電腦第一次要以系統管理員把 CER 匯入 LocalMachine/TrustedPeople，之後版號較高的 MSIX 可直接安裝升級，同版號要先解除安裝。
repository 是私有的，下載 release 需要登入有權限的 GitHub 帳號。

直接 Xcode 的 app ID／App Group／Team 使用 [Apple 專案](../src/native/apple/README.md) 的本機 xcconfig；
命令列 build wrapper 可用 `.env` 中非空的 identity 覆蓋。生成資產、DerivedData、archives 保留於忽略的目錄。
Apple export 使用 `--method app-store-connect|developer-id|debugging|release-testing`；iOS 不接受
Developer ID。export destination 固定為本機，沒有自動上傳商店。macOS 開啟 hardened runtime；
Developer ID 散布可指定 installer identity 與已存在的 Keychain notary profile，公證後 staple App／PKG。
可選 DMG 使用 application identity 簽署；公證 DMG 必須提供該 identity。憑證、profiles 與帳號由維護者配置。

Apple 可在手動 `.github/workflows/apple-native-build.yml` 使用 hosted Mac 編譯原生 unsigned
Debug ZIP／iOS device IPA，包含 iOS Extension。Private repo hosted runner 可能占用計費額度；
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
