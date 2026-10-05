# Apple 原生 App

macOS 13+／iOS 16+，需要完整 Xcode（Swift 5.10+）、Node 22+。此目錄為 1.0 原生 host，
不使用歷史 Python server。主畫面與手機 editor 共用封裝資產；macOS 另接桌面／浮動場景。

## 在 Mac clone 後直接開啟

`WorkFleet.xcodeproj`、workspace、兩個 shared schemes、預設 xcconfig 與圖示均已納入 Git。
所有 source／entitlements 參照使用相對路徑；不需先產生專案，也不依賴另一台電腦的 `build/`。
在完整 repository checkout 的根目錄執行：

```bash
open src/native/apple/WorkFleet.xcodeproj
```

選擇 `WorkFleetIOS` 與 iPhone／iPad Simulator，再按 Run；macOS 使用 `WorkFleetMac`。
需安裝 Node 22+（含 npm）。Xcode 的 Prepare local resources phase 自動安裝 lockfile 依賴、
產生共用介面、公開配置及 Info.plist，第一次需要下載 npm／SPM 依賴；不需預先 `npm run build`。
資產位於此目錄的 `.generated/<target>/`，已由 Git 忽略。

Debug 預設 app ID 是 `app.workfleet.preview`，未填 Google 設定也可建置本機 preview。
實機／正式身份可把 `config/Local.xcconfig.example` 複製為 Git 忽略的 `config/Local.xcconfig`，
填寫 WORK_FLEET_APP_ID、WORK_FLEET_APP_GROUP_ID、DEVELOPMENT_TEAM；主 App 與 Extension 使用同一份設定。
也可在 Xcode 設定 Signing Team。Google clients／商店公開資料仍從 repository 根目錄 `.env` 讀取。
直接 Xcode 建置的 app ID／App Group 以 Xcode build settings 為準，避免簽章、entitlements 與隨包配置不一致。

macOS 本機試用也需要有效簽章才能使用 Data Protection Keychain。在 WorkFleetMac target 的
Signing & Capabilities 啟用 Automatically manage signing、選擇 Team，並完成 Register Device。
Xcode Accounts／Manage Certificates 可建立 Apple Development 憑證；不要停用 entitlements 或重設 Keychain。
Apple Development 只供 profile 允許的裝置使用，跨機正式散布仍使用 Developer ID／公證。

Prepare phase 會將 `/opt/homebrew/bin`／`/usr/local/bin` 加入工具搜尋路徑；
自訂 Node/npm 路徑可在 Local.xcconfig 設定 WORK_FLEET_NODE／WORK_FLEET_NPM。
此 phase 需要讀取本機配置並下載／安裝工具依賴，因此 Xcode user-script sandboxing 關閉；
App 的 Sandbox／Keychain／entitlements 設定維持原有契約。

## 命令列建置

```bash
bash scripts/macos/build-native-app.sh --platform macos
bash scripts/macos/build-native-app.sh --platform ios --simulator
bash scripts/macos/build-native-app.sh --platform ios --release
```

腳本使用同一份已提交的 `src/native/apple/WorkFleet.xcodeproj`，不重新產生或覆寫 IDE 專案。
`.env` 中非空的 app ID／team 會作為命令列 build settings；未填時採用 xcconfig 設定。
DerivedData／archive／export 產物仍在忽略的 `build/apple/`；Xcode 建置需在 Mac 執行。
SDK 固定 GoogleSignIn 9.2.0；SPM checkout 根目錄授權文本於簽章前複製到 bundle Licenses。
Apple 主畫面與桌面場景的 ES modules 在建置時由固定版本 esbuild 合併成 classic deferred scripts，
供 WKWebView 從本機封裝檔案執行；來源仍共用，CSP、native bridge 與 Sandbox 保留。見 [ADR-033](../../../docs/decisions/033-apple-local-script-bundles.md)。
Release 的資產準備檢查有效公開設定，再 archive；簽章／provisioning 在 Xcode／Keychain 配置。
`scripts/macos/package-native-app.sh` 匯出既有 archive；iOS 可產生 IPA，macOS 可產生 PKG／可選 DMG。
`--method app-store-connect` 保持本機 export，不自動上傳；Developer ID 可使用既有 installer identity
與 Keychain notary profile 公證並 staple。DMG 公證另要求 application identity；腳本不含私鑰。
macOS target 啟用 hardened runtime。命令與平台限制見 [散布文件](../../../docs/deployment.md)。

沒有 signing identity 時，Debug 可使用 `--unsigned` 編譯原生 macOS／iOS device App；
`scripts/macos/package-preview-app.sh --platform macos|ios` 保存 ZIP／未簽章 IPA。
這是 native compiled preview；protected storage／Google 或 iOS 安裝仍需合適的簽章／profile。
`--unsigned` 不允許 Release，也不跳過正式 archive 的配置要求。
`.github/workflows/apple-native-build.yml` 提供手動 hosted Mac 建置與七天 artifact 保存，
每 target 上限 20 分鐘，沒有測試／store upload；private repo 的 runner 計費需維護者先同意。

GoogleSignIn Apple SDK 的 macOS、iOS client 都使用 **iOS 類型 OAuth client**，各自符合
實際 bundle ID，分別填 `.env` 的 MACOS／IOS client ID。產生器加入 reversed client URL scheme。
Apple 簽章憑證與 Keychain access group 是登入及安全保存的必要條件；未簽章 simulator 不代表真登入可用。

SQLite 位於 App Sandbox 的 Application Support/WorkFleet，內容、附件與原生 metadata 用
Keychain AES-256-GCM 加密。DB 同 revision CAS 與附件寫入為單一交易，flock 保持單一 owner。
WKWebView 僅主 frame 的封裝 document 可呼叫 bridge；桌面視窗沒有 DB／檔案／憑證能力。
資料夾選擇保留 bookmark 與檔案系統身分；自動備份 journal 及密碼受原生保護，密碼不回傳 renderer。
可攜備份保持 SPEC-002 PBKDF2／AES-GCM ZIP，換裝置還原須自行保存原密碼。

macOS 桌面 visual panel 始終 ignoresMouseEvents；只有可操作或已開啟唯讀選字的紙面建立
透明輸入區域，遮蓋部分依 renderer 疊序裁切。就地 editor 留在相同 WKWebView；主畫面是唯一內容 owner。
桌面層用公開 `desktopIconWindow + 1`，浮動層用 floating；桌布層用 `desktopWindow + 1`，
位於桌布上、圖示下，固定滑鼠穿透。操作此組暫時轉浮動層，結束還原當下常駐設定與原位置。
每螢幕三個場景，顯示器重接／Space／休眠仍保留編輯 WebView。
Mac 原生三層檢查可執行 `bash scripts/macos/test-desktop-layers.sh`；需要圖形 session 與 Xcode CLI tools。
快捷鍵以 Carbon RegisterEventHotKey 註冊，App 或 editor 使用中釋放全域鍵；衝突在設定顯示。
選單列支援重新開啟、快速記錄、操作、顯示與保存退出。螢幕／Space／休眠通知會暫停輸入，
保留 editor surface，待 owner 保存救援位置後套用新 topology；背景更新不主動取得鍵盤焦點。

2026-10-05 已在 Apple Silicon Mac 使用 Xcode 27.0 編譯 macOS Debug universal（arm64／x86_64），
並產生 0.1.0 Apple Development 簽章 DMG；簽章及掛載檢查證據見 [PROGRESS](../../../PROGRESS.md)。
獨立簽章 fixture 的 Keychain 建立／更新／讀取、加密 SQLite 重開與主畫面 native 初始化通過，
重現命令見 [Testing](../../../docs/testing.md)。測試不讀取使用者 workspace；不是完整產品操作驗收。
尚未產生 Developer ID／公證、正式 archive／export；全螢幕／Spaces、透明輸入轉送、
IME、多螢幕、Intel 實機與正式 Google 登入的結果仍缺。

iOS 27 SDK 會終止未採用 UIScene 生命週期的 App，因此 iOS 主 App 以 `FleetSceneDelegate`
建立視窗、處理 Google 回呼及前背景事件，產生的 Info.plist 含單一場景 `UIApplicationSceneManifest`。
2026-10-06 以 Xcode 27.0 建置 Debug 開發簽章版，安裝至 iOS 27.0.1 iPhone 後主畫面可正常顯示；
尚未做完整操作、iPad、Share Extension 或 Google 驗收。

附件／草稿下載走原生匯出：macOS NSSavePanel、iOS UIDocumentPicker，保留取消結果。
iOS 編輯器提供 Markdown 文字與單附件分享，使用 UIActivityViewController／iPad popover。
傳輸沿用有容量與 SHA-256 核對的 owner staging；分享暫存使用完整檔案保護，完成／取消後清除。
原生對話框逾時或帳號切換終止待處理的 iOS 匯出。分享至其他 App 不表示已送達收件人。
已提交的 Xcode 專案另建立並嵌入 WorkFleetShare.appex；Share Extension 接收文字、網址與檔案。
App 與 Extension 的 App Group 由 `WORK_FLEET_APP_GROUP_ID` 設定，預設採 `group.<APP_ID>`；
須在同一 Apple team 登記 App Group，並加入主 App 與 `<APP_ID>.share` 的 signing profile。
收件匣以 App Group 共享 container 與 Keychain key 做 AES-GCM 保護、flock 排他與完整檔案保護。
Extension 只保存接收項目，不讀取主 App 的 Workspace／Google 憑證，不強制開啟主 App。
主 App 前景／重啟更新收件匣，使用者選群組保存草稿後才移除原項目；失敗與重試保留 receipt。
一次最多 256 KiB 文字、16 個檔案、25 MiB 檔案總量；收件匣最多 64 份／512 MiB。
App Groups 未配置時主 App 仍可編輯便箋，但收件匣不可用；原生 Extension／檔案提供者仍未執行。

`scripts/generate-apple-project.mjs` 僅供維護專案結構／新增 Swift 檔案後使用；會重寫已提交的專案與圖示。
一般開啟或建置不需執行它。可攜專案決策見 [ADR-029](../../../docs/decisions/029-portable-apple-xcode-project.md)。
