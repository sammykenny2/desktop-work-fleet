# ADR-028: 原生封裝與簽章入口

## Status

Accepted，2026-10-05；2026-10-06 補充各平台版號紀錄與發佈檔名。
2026-10-10 Windows 的 framework-dependent 封裝選擇由 [ADR-036](036-windows-self-contained-packaging.md) supersede；下列保留當時決策，其他平台與簽章契約不變。

## Context

完整 1.0 含五平台及商店提交準備；目前沒有維護者 Google／Apple／商店帳號與簽章私鑰。
公開設定應能從 `.env.example` 配置，缺憑證不能以 placeholder 宣稱正式散布已完成。

## Decision

Windows 以 Windows SDK MakeAppx 產生 x64 MSIX，另產生 portable ZIP；framework-dependent
執行需 .NET 8 Desktop 與 WebView2。MSIX 使用公開 package identity／publisher，可選既有
CurrentUser/My certificate 與 HTTPS timestamp 簽署；不自行安裝憑證或修改信任。
本機 preview 使用 `-LocalTestSign` 重用已在 LocalMachine/TrustedPeople 信任、有效且與 publisher
相符的既有憑證，無 timestamp；與 `-Release` 互斥。要求簽章驗證成功，另輸出僅有公鑰的 CER。
此入口不建立新憑證，不改信任，避免後續試用建置遺漏已有的本機簽章。
原本每次封裝使用新的 workspace build 目錄；2026-10-06 改為固定工作目錄，見下方發佈位置。

Apple 由 [ADR-029](029-portable-apple-xcode-project.md) 已提交的可攜 Xcode project 建立 archive，
再以本機 export options 匯出；生成資產與 archive／export 仍保留在 Git 忽略的目錄。
macOS 啟用 hardened runtime；Developer ID 可用已有 identities 產生 signed PKG／DMG，
可選 Keychain notary profile 公證並 staple。iOS 匯出包含已嵌入的 Share Extension；
signing profiles 仍需維護者配置同一 team／App Group。腳本不登入或上傳商店。

Android upload signing 僅讀取 process／CI environment 的 keystore、alias、store／key passwords；
四項必須同時配置。`-Signed`／`--signed` 強制簽章 release AAB，未配置 inputs 的一般 release
可輸出未簽章 AAB 交給外部 pipeline。秘密不進公共設定、命令列參數或 repo。
Linux 保留系統 runtime tar.gz 與 DEB 建置入口，不假設 Windows 可完成 Linux GUI 散布驗收。

Windows 可選 workspace Android toolchain installer，使用官方固定 SDK tools／Gradle download
及 SHA-256，接受所需 SDK 條款後安裝 API 36／Build Tools 35.0.0。工具、SDK、快取與路徑 JSON
位於忽略的 `build/`；不修改系統 PATH。公開 SDK 路徑可由 `.env`／process environment 覆蓋。

Linux DEB 委派給獨立 dpkg-deb script；Windows 可使用既有 Docker Linux engine，在固定 Ubuntu
image 中執行。容器只掛載忽略的 `build/` 產物目錄與封裝 script，執行時 network none，
不安装 App 或 GUI runtime。2026-10-05 依維護者指示，DEB 統一使用產品版號 `0.1.0`，
不附加 `~preview`；release 仍需正式公開配置與 maintainer email。版號後續記在 `src/native/linux/VERSION`。
Linux 與 Windows 入口直接將 DEB 與 tar.gz 輸出到 `build/` 根目錄；bundle 保留於 `build/linux/`。
每次建立新的 staging 目錄並於腳本結束時自動移除，保留產物；
安裝 launcher 與 license documents，使用 root archive ownership。

2026-10-06 依維護者指示，發佈檔名必須只由 repo 內容決定：同一 commit 在任何開發機以同一指令
產生相同檔名，同一平台的不同建置入口也不得各自寫死版號。各平台分別記錄版號，不共用一份：
Windows 為 `src/native/windows/Directory.Build.props`，Apple 為 `src/native/apple/config/WorkFleet.xcconfig`
的 `MARKETING_VERSION`／`CURRENT_PROJECT_VERSION`，Android 為 `build.gradle.kts` 的 `versionName`，
Linux 為 `src/native/linux/VERSION`。封裝腳本經 `scripts/platform-version.mjs` 或產物本身的 metadata 取得版號。
Apple 資源準備拒絕 Local.xcconfig／命令列覆蓋；macOS 命令列建置固定 arm64＋x86_64，封裝前檢查。
預覽簽章後綴取自 App 的實際簽章而非建置機器的 identities。檔名格式：Windows
`WorkFleet-<版號>-x64.msix|zip`；macOS `WorkFleet-<版號>-macos-universal[-unsigned|-development]`；
iOS 預覽 `WorkFleet-<版號>-ios-<unsigned|development|simulator>`；Android `WorkFleet-<版號>-android-<variant>`；
Linux 沿用 Debian `work-fleet_<版號>_all.deb` 與 `work-fleet-<版號>.tar.gz`。每個發佈檔旁輸出同名 `.sha256`。

同日維護者要求所有平台的安裝檔放在同一層、不得散落在隨機目錄。發佈位置因此統一為 `build/` 根目錄：
Windows、Apple、Android、Linux 的發佈檔與 `.sha256` 都直接放在 `build/`，同名覆蓋。
中間產物改用固定、每次清空的工作目錄（`build/windows/package`、`build/apple/preview-<平台>`、
`build/apple/export-<平台>`、`build/linux/work-fleet-<版號>`），取代先前每次新建的隨機目錄。
Windows 與 Apple 在建置、簽章與公證全部成功後才移入 `build/`。Apple 正式匯出的 IPA 與 Mac App Store PKG
依 `--method` 命名；Android 入口在 Gradle 完成後依 `versionName` 找到預期檔名並複製，找不到即失敗。

Apple 加入手動 GitHub workflow，固定官方 actions commit，使用 GitHub macOS runner 編譯
未簽章 Debug 的 macOS App 與 iOS device App／Extension，保留 ZIP／IPA 與 builder version。
工作上限每 target 20 分鐘，僅手動觸發，不在 push 執行測試。Private repository 的 hosted runner
可能使用計費額度，實際啟動需維護者同意；沒有 developer account／簽章時僅為 native preview。

Android 依 variant 的 resolved runtime graph 打包 dependency inventory／artifact SHA-256、上游
Maven POM 與 AAR／JAR 內的 notices，保留 Apache-2.0 全文。Generated assets 使用每輪新的
專用目錄，避免混入舊 variant 的輸出；缺少 POM／license declaration 以 status 記錄，不推定授權。
輸出不含 SDK cache 的本機路径或憑證；最終 release 的 Google SDK 條款仍依該包 inventory 確認。

## Consequences

### Positive

- 各平台有可配置的封裝與簽章入口，公開 app／Google／publisher 設定與 secrets 分離。
- 有 SDK 的環境可先產出 preview，保留正式憑證及商店帳號由維護者控制。

### Negative

- Windows runtime 不內嵌，接收端須有 .NET 8 Desktop／WebView2。
- 有腳本不等於平台 binary、簽章、Google 往返或商店表單已完成；依最終產物補授權与截圖。

## 2026-10-06 修訂：Windows 預覽版由 CI 發布到 GitHub Release

使用者要在另一台 Windows 直接下載安裝，因此新增手動觸發的 `windows-preview.yml`：建置、簽章成功後才建立 `windows-v<版號>` tag 與 prerelease，
已存在的 tag 不覆蓋，再發布要先升 `Directory.Build.props` 的版號。
- 簽章沿用本機 preview 憑證，私鑰以 PFX 存在 repository secret。本機包與 CI 包同 publisher、同憑證，可互相升級，安裝端只需信任一張 CER。
- runner 在該 job 內把憑證加入自己的 TrustedPeople，讓 `-LocalTestSign` 的既有驗證照常運作；這只改變暫時的 runner，不改變使用者電腦。
- 預覽版仍不加 timestamp；憑證到期後簽章失效，要換憑證並重新信任。
- 正式商店或 Developer 簽章仍走 `-CertificateThumbprint`／`-TimestampUrl` 與 Partner Center，不受此修訂影響。

## 2026-10-14 修訂：macOS GitHub 預覽採 DMG 與更新 ZIP

維護者選擇沿用 Developer ID Application 憑證，只發布 DMG＋Sparkle 更新 ZIP，
不要求額外的 Developer ID Installer 憑證。封裝入口新增 `--no-pkg`；一般本機／商店封裝保留原有 PKG 路徑。
CI 匯入本專案 Developer ID provisioning profile，驗證其 Team、App ID、Keychain entitlement、效期與簽章憑證，
archive／export 都使用該 identity 與 profile 的 manual signing，不依賴 runner 登入 Xcode 或持有 development 憑證。
公證使用本專案獨立的 Team API key；Sparkle 使用獨立更新金鑰，秘密僅存 OS keychain／repo 外備份／GitHub secrets。
App Sandbox 與 Keychain 資料契約保留；簽章、公證、staple 與 Gatekeeper 檢查全數成功才交付。
配置完成、流程測試、真實 signed app 驗證與 GitHub release dispatch 分開記錄，不以其中一項代替其他驗收。

## Alternatives Considered

將簽章密碼放入 `.env` 或公共 JSON：拒絕，公共設定會封裝進 App。
自行建立及安裝受信任憑證：拒絕，會改變使用者環境且不能替代正式簽章 identity。
將 framework-dependent preview 視為五平台正式發行：拒絕，缺少原生環境及外部帳號證據。
所有平台共用一份版號檔：拒絕，各平台需能獨立升版。
依建置機器架構或已安裝憑證決定檔名：拒絕，同一 commit 會在不同開發機產生不同檔名。
Linux DEB 改用 `WorkFleet-<版號>` 格式：拒絕，Debian 工具與套件庫預期 `套件_版號_架構.deb`。
每次封裝使用新的隨機目錄：2026-10-06 撤回，安裝檔散落在不同深度、路徑無法預期。
發佈檔放在 `build/<平台>/`：未採用；DEB 先前已決定放在 `build/` 根目錄，統一放根目錄不需再搬。

## References

- [封裝與散布](../deployment.md)、[商店資料](../release/README.md)、[執行狀態](../../PROGRESS.md)。
- [Microsoft MakeAppx](https://learn.microsoft.com/en-us/windows/msix/package/create-app-package-with-makeappx-tool)。
- [Microsoft packaged desktop manifest](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-manual-conversion)。
- [Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)。
- [Debian binary package format](https://manpages.debian.org/bookworm/dpkg-dev/deb.5.en.html)。
- [Debian control fields](https://www.debian.org/doc/debian-policy/ch-controlfields.html)。
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。
