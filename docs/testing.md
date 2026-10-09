# 建置、測試與證據

更新：2026-10-09。新核心證據見 PROGRESS；既有 0.1.0 證據見 [驗證報告](validation/2026-10-03-validation-report.md)。

## 新互動驗收路由

新卡片／群組／formation 的要求見 [SPEC-003 C01–C48](specs/003-desktop-cards-groups-and-formation.md)，
分層策略見 [PLAN-003](plans/003-desktop-interaction-implementation.md)。
`tests/desktop-core.test.js` 驗證 grid、formation／容量、undo、操作 scope、手勢模型、
原子保存失敗、草稿安全退出與 adapter 替換；注入的記憶體 persist 不證明 OS 實際落盤。
測試名稱中的 C 編號只標示模擬語意部分；C16／C35／C40–C43／C46–C47 的原生能力仍需實際 host 驗收。
不能把舊測試綠燈列為新功能通過，也不為文件變更重新啟動舊 Mac probe。
文件工作執行 check_docs.py、git diff --check 與範圍／語意一致性檢查即可。

## 可重現命令

從 checkout 根目錄；Python 使用標準庫，完整 JS 測試需先安裝 lockfile 依賴：

```bash
npm ci --ignore-scripts
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.js
npm run build
npm run config:check
node --check src/web/app.js
python3 scripts/testing/check_docs.py
git diff --check
```

`python3 -B -m unittest discover -s tests -p 'test_linux_package.py' -v` 在有 bash 與 dpkg-deb 的環境
實際封裝隔離 fixture，驗證一般／release DEB 的版號與檔名都取自 bundle `package.json`，缺版號時拒絕，
release 仍拒絕缺少 maintainer email。缺工具時略過，不安裝套件或啟動 GUI。
另驗證成功／失敗都清除本次 staging，保留既有輸出。有 Node 22+／npm 與 lockfile 依賴時，
在含空白路徑的隔離 checkout 改寫 `src/native/linux/VERSION` 後執行完整 `--deb` 建置，
確認 DEB 與 tar.gz 直接輸出到 `build/` 根目錄、檔名跟隨該版號、`.sha256` 與檔案相符，
`build/` 沒有其他新檔，且重建 bundle 時清除已不存在的來源檔。

`tests/release-versions.test.js` 驗證各平台版號紀錄的讀取與格式、封裝腳本不再寫死版號、
Windows csproj 不自訂版號、MSIX identity 取自 `Directory.Build.props`、Windows.Desktop 下限 22000／MaxVersionTested 26200、Apple Info.plist 取自 xcconfig
且拒絕本機覆蓋、Android 檔名設定引用 `versionName`，以及各封裝入口使用固定工作目錄並交付到 `build/`。不需原生 SDK；
不代表 MakeAppx、Xcode 或 Gradle 實際產物已驗證。

`tests/revisions.test.js` 驗證 SPEC-004 S01–S07：嚴格 JSON、正規 bytes、缺 parent／pending、
亂序分支／tombstone／晚到衝突、整批失敗及 12,000 筆反向歷史；不代表真 Google 已接入。
`tests/config.test.js` 驗證 `.env`／環境優先序、公開欄位 allowlist 及缺值／錯誤格式。
`tests/android-build.test.js` 驗證無既有生成資產時的 Android 公開配置、修改 `.env` 後重新讀取、
release 必填欄位、隔離輸出路徑中的 renderer／bridge／vendor 及 CSP。執行 `node --test tests/android-build.test.js`。
Android Studio 開啟 `src/native/android`；Gradle Wrapper 的 `assembleDebug` 會安裝 lockfile 依賴並產生 APK 資產，
無須先執行外部 web build。命令與前置條件見 [Android README](../src/native/android/README.md)。
APK 建置、IDE Sync、實機操作與 Google 往返是不同驗證範圍，結果記於 PROGRESS。
`tests/apple-project.test.js` 驗證 Xcode 專案在不同 checkout 路徑產生一致內容、所有 source 參照可攜、
主 App／Share Extension 依賴、機器配置不進專案、生成資產／Info.plist、Apple 主畫面／場景 classic bundles、
CSP 不放寬、release 缺值與唯讀依賴授權檔的重複複製。
`node --test tests/apple-project.test.js` 不需要 Apple SDK；不代表 Xcode 載入、Swift 編譯或簽章通過。
Mac clone 後開啟已提交的 `src/native/apple/WorkFleet.xcodeproj`，無須先產生專案；
Node 22+／npm 與簽章設定見 [Apple README](../src/native/apple/README.md)。

macOS 未簽章 universal preview 的實際編譯命令如下；不變更系統 `xcode-select` 設定。
Debug preview 不替代正式簽章、Keychain／Google 或產品 runtime 驗收。

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project src/native/apple/WorkFleet.xcodeproj -scheme WorkFleetMac \
  -configuration Debug -destination 'generic/platform=macOS' \
  -derivedDataPath build/apple/DerivedData \
  -clonedSourcePackagesDirPath build/apple/SourcePackages \
  "WORK_FLEET_PACKAGES_DIR=$PWD/build/apple/SourcePackages" \
  'ARCHS=arm64 x86_64' ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO build
lipo -archs build/apple/DerivedData/Build/Products/Debug/WorkFleetMac.app/Contents/MacOS/WorkFleetMac
```

`scripts/macos/build-native-app.sh --platform macos --unsigned` 已固定使用上述架構設定；
`scripts/macos/package-preview-app.sh --platform macos --dmg` 檢查兩種架構後產生 DMG 與 `.sha256`。
封裝後需以 `hdiutil verify` 及唯讀掛載核對實際 App；Debug 的主程式與隨附 dylib 均須含兩種架構。
2026-10-05 已完成上述建置／DMG 檢查，新增授權檔回歸後 Apple 專案測試 4／4；產物、hash、限制及紀錄見 PROGRESS。

測試原生 Keychain／加密 SQLite／主畫面啟動需要 Apple Development 憑證，以及允許本機裝置與
`app.workfleet.startupprobe.*` 的既有 provisioning profile。先在 Xcode 的 WorkFleetMac target
選 Signing & Capabilities，啟用 Automatically manage signing、選 Team 並完成 Register Device。
簽章 universal 建置使用上述命令，移除 `CODE_SIGNING_ALLOWED=NO`；不需更改系統 Keychain 或刪除 App 資料。

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  python3 scripts/testing/apple_startup_probe.py --team TEAM_ID
```

此 probe 在 `build/apple/native-startup-<id>/` 建立來源副本與唯一 bundle ID，使用正式 FleetKeychain、
FleetDatabase、FleetWebHost／FleetDesktop 和隨包 renderer；原始 Xcode 專案與使用者 workspace 不受改動。
測試建立／更新／讀取 Keychain、重開加密 SQLite，並等待主畫面完成 native 初始化。
只清除 probe 自己的 Keychain service 與暫存資料；建置、結果及簽章證據保留於該目錄。
2026-10-05 簽章 probe 通過 Keychain、SQLite 與主畫面 native 初始化；原樣 ESM 載入失敗的
證據與封裝修正見 [ADR-033](decisions/033-apple-local-script-bundles.md)。
它不建立憑證、不登記裝置、不測試 Google 登入或完整桌面手勢，也不代表 Developer ID／公證驗收。

三平台桌面分層契約見 [ADR-031](decisions/031-macos-and-linux-wallpaper-scenes.md)。
`python3 -m unittest discover -s tests -p 'test_linux_scenes.py' -v` 在無 GI／display 的環境也可驗證
Linux native frame 的三層、桌布 input flags 拒絕、舊 session／sequence 與 geometry；不作 UI 證據。
`python3 -m unittest discover -s tests -p 'test_linux_vault.py' -v` 以假 libsecret 驗證 Linux 儲存金鑰：
鎖住／解鎖取消回報已鎖定且不建第二把金鑰、真正缺少才回報缺少、已解鎖金鑰優先；不需 GI 或金鑰圈。
`python3 -m unittest discover -s tests -p 'test_linux_google.py' -v` 以假 HTTP 確認 Linux 換 token 時，
有設定才送 Desktop client secret、格式不對時停用；不連網，也不代表真實登入。
`tests/test_linux_python_floor.py` 從 DEB `Depends` 讀 Python 下限（3.10），確認 tar.gz 宣告相同，
並以該版本語法解析 Linux host，另檢查 `ast` 放行但 3.12 前不接受的 f-string 寫法；不檢查標準庫 API。
在真正的 Mac 圖形 session 執行 `bash scripts/macos/test-desktop-layers.sh`，直接編譯 AppKit
場景／協調器，驗證原生 level、三層能力、位置、穿透及桌布拒絕焦點，不需要 Google SDK。
這個 probe 不會讀取使用者便箋；不替代完整 App build、WKWebView／IME／Spaces 實機驗收。

Linux 原生場景測試使用單獨的 headless labwc／GTK／WebKit，不存取使用者 desktop／DB：

```bash
npm run build
mkdir -p build/linux-layer-checks
node tests/native/desktop-scenarios.mjs build/linux-layer-checks/scenarios.json
docker build -t work-fleet-linux-desktop-tests -f tests/native/linux/Dockerfile tests/native/linux
docker run --rm --network none \
  --mount "type=bind,source=$PWD,target=/workspace,readonly" \
  --mount "type=bind,source=$PWD/build/linux-layer-checks,target=/evidence" \
  work-fleet-linux-desktop-tests dbus-run-session -- \
  bash /workspace/scripts/linux/test-desktop-layers.sh /evidence /evidence/scenarios.json
```

投影來自實際共用 Workspace／InteractionController；native owner 分片發布並由真正 WebKit renderer
接收、確認、畫出。涵蓋 wallpaper→調整此組 floating→完成後還原、常駐 desktop／floating、
反覆隱藏／顯示與 topology 重用；輸出合成畫面 PNG、版本與 Wayland trace。
root Docker probe 的 WebKit sandbox 例外僅存在測試 shell，不套用到產品 launcher。
這些測試不是 Pi／V3D、pcmanfm-pi、實體拖曳／IME 或多螢幕證據；X11 不假冒三層能力。
`npm run config:check -- --platform windows` 等指定平台命令在缺公開設定時應非零退出。
`tests/workspace-sync.test.js` 驗證 graph 與 Workspace／LayoutStore 原子交易、保存失敗、過期 session／cursor、
runtime 重啟、群組循環／十組恢復、草稿、歷史恢復、轉組意圖與既有 entity 順序。
`tests/file-sync.test.js` 使用獨立記憶體 FileStore，驗證分頁／重啟／雙裝置分支、回應遺失、
reservation／ack 故障、附件、來源不可變、撤權／退避、取消與帳號 session。
`tests/google-drive.test.js` 使用 scripted HTTP 回應，驗證 appDataFolder 路由／metadata、
resumable 分段及 Range、4xx 重開、同 file ID、讀回校驗與 Location 邊界；不使用 Google 憑證。

`tests/backup-archive.test.js` 驗證 ZIP 路徑／目錄／CRC／容量／惡意 DEFLATE／取消及加密，
並透過固定 Python 標準庫 fixture 獨立讀取 ZIP（Windows 支援 pyenv 的 python.bat）。
`tests/backup-payload.test.js` 驗證完整歷史／群組／草稿 lineage／附件／版面、hash／引用／計數、
profile 綁定、並行快照、未知 conflict 拒絕、加密與大量圖取消。沒有把檔案驗證當已還原。
`tests/backup-capacity.test.js` 完整產生／重開 20,000 entries 並驗證多一個就拒絕；
它含大量個別 ZIP／SHA 作業，執行時間高於一般小 fixture，不是最低手機裝置 benchmark。
`tests/backup-restore.test.js` 驗證三種還原、完整 ID／草稿 lineage 映射、缺 parent、過期計畫、
安全備份綁定、交易失敗、重啟 receipt／明確重複及大量新卡定位取消後佇列仍可使用。
`tests/backup-files.test.js` 驗證 write／close／讀回故障、大小／hash、取消、owned bytes 及保存能力。
`tests/automatic-backup.test.js` 使用合成原子 FileHost 驗證每日／變更／resume、合併觸發、排隊取消、
pending／ack／重啟／清理、換位置、最新檔遺失、加密 policy 變更、vault 暫停及 journal 失聯通知。

新的真實瀏覽器回歸使用隔離 profile 與合成資料：

```bash
python scripts/testing/serve_preview.py --port 0
# 另一終端，把 PORT 換成上面印出的實際 port
node scripts/testing/browser-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/group-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/revision-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/sync-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/backup-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/restore-ui-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/automatic-backup-probe.mjs --url http://127.0.0.1:PORT
```

Windows 使用已安裝的 Edge；Linux／macOS 使用 Playwright Chromium，首次需
`npx playwright install chromium`。Playwright 與測試 browser 不放進產品產物。
probe 驗證新增／重開、Markdown／checklist、附件 bytes 與惡意 HTML 隔離、固定紙面 inline 編輯、
普通／Shift 拖放、undo、搜尋／filter 不搬卡、多步草稿操作、離頁慢寫提示、窄螢幕入口與單 writer。
另用真實 IDB 驗證並行 CAS、非連續 revision 拒絕、附件及 profile 隔離。
group probe 驗證群組預覽／取消／合併、封存資料／草稿完整性、區域交換不搬卡、
自訂與重複快捷鍵、多綁定在合併及再次設定後仍保留。
revision probe 以合成資料驗證兩版本比較、HTML 文字隔離／附件原始 bytes、delete/edit 決議、
歷史恢復、草稿／geometry 保留、IME 邊界及 390px 下零活動群組的循環恢復入口。
它透過核心 fixture 注入版本，沒有連 Google；截圖在 `build/revision-probe.png`。
sync probe 在真 Edge／IndexedDB 接 FileSync 與合成 FileStore，驗證 reservation 落盤、
回應遺失後重開同 file ID、附件校驗／分區隔離、雙裝置分支及重開保留；仍不等於真 Google。
backup probe 使用真 Edge／IndexedDB、2 MiB 附件及草稿／版面，驗證明文／加密往返、
錯密碼、取消零寫入、還原 transaction abort／附件回滾、commit 後回應遺失／重啟 receipt 及 CAS。
restore UI probe 經完整畫面執行匯出／預覽／匯入／重複與取代，安全備份先保存才解鎖確認，
檢查原草稿／歷史及 390px 畫面。它只替換 picker，真實保存／close／SHA 讀回使用 OPFS handle，
沒有開啟個人檔案選擇器。截圖在 `build/restore-ui-probe.png`，失敗另存同名前綴 failure 圖。
上述不代表原生 OS picker、外部磁碟斷電耐久或最低手機容量壓測。
automatic probe 先確認真 App 的自動檔案能力停用，再以真 IDB journal／Workspace 與合成 FileHost
檢查完整 UI、執行中停用、reservation abort、ack 遺失／重啟、CAS、授權暫停及可讀取的 ZIP bytes。
它不使用原生 OS 自動檔案或 vault，截圖為 `build/automatic-backup-probe.png`。
輸出截圖在 `build/browser-probe.png`，失敗時在 `build/browser-probe-failure.png`。
這不等於真實斷電、Google 來源、iOS／Android 或 OS 分層驗收；尚未配置 GitHub Actions CI。

既有 Mac 驗證版另在 macOS 執行：

```bash
bash scripts/macos/build-app.sh
python3 scripts/testing/macos_probe.py --web
python3 scripts/testing/macos_probe.py --mode 0
python3 scripts/testing/macos_probe.py --mode 2
```

Python 測試與 Mac probe 需允許 loopback listener；某些 coding-agent 執行隔離層需額外允許。
這與被測 App 自身的 App Sandbox 不同：被測 app 一直保留簽署的 Sandbox entitlements。

`macos_probe.py` 只使用 TemporaryDirectory SQLite 與一次性邀請，實際啟動已簽署 App，
設定／快取使用獨立 `WorkFleet-Probe` 子目錄，網頁使用 nonpersistent WKWebsiteDataStore。
會短暫顯示／啟用驗證用編輯視窗。probe 逐項斷言，缺少事件或任一不符即失敗。
不要在其他人正使用鍵盤時執行焦點探針。輸出診斷不含筆記本文或憑證。

資料層測試涵蓋真實 HTTP、並行 writer、response-loss 重試、tombstone、backup/restore、
interrupted restore、restore flush 失敗與重試、配對 race、expiry/reuse、read-only、revoke、輸入限制與 storage failure。
WebKit 測試透過真實 DOM 與 server，傳輸斷線／回應遺失採可控注入。
Node 模型測試涵蓋跨分頁草稿／恢復與本機寫入失敗。

## Windows 原生主畫面與保存

本機簽章 preview 的封裝檢查（不安裝 App、不修改憑證信任）：

```powershell
.\scripts\windows\Build-WindowsPackage.ps1 -SkipRestore -LocalTestSign
.\scripts\windows\Test-WindowsPackage.ps1 -PackagePath build/WorkFleet-VERSION-x64.msix
```

將 `VERSION` 換成 Windows 版號。檢查四種不合法簽章參數在建置前拒絕，
並使用 Windows 實際驗證 MSIX 簽章、機器信任、publisher、x64 manifest 與不含私鑰的配套 CER。
需要與 package publisher 相符的既有 CurrentUser/My 憑證及 LocalMachine/TrustedPeople 信任。
正式簽章仍使用 `-CertificateThumbprint`／HTTPS `-TimestampUrl`；本機模式不接受 `-Release`。
最終 MSIX 另核對 x64、目前 Windows 版號、Windows.Desktop 下限 22000 與 MaxVersionTested 26200。
沒有既有受信任憑證時，用一般 `Build-WindowsPackage.ps1 -SkipRestore` 與
`Test-WindowsPackage.ps1 -PackagePath build/WorkFleet-VERSION-x64.msix -Unsigned` 檢查未簽章內容；
這不代表簽章、安裝或 Store 驗收。省略 `-Unsigned` 仍拒絕未簽章包，該選項也拒絕未知／損壞簽章狀態。
`python -m unittest discover -s tests -p 'test_windows_package.py' -v` 使用 Windows SDK MakeAppx 產生隔離合成容器，
驗證過高／過低下限、device family／MaxVersionTested、錯誤版號、環境／私鑰檔案與明確未簽章模式。
fixture 不執行 App，不改憑證；缺 Windows／SDK 時標為略過。子程序優先用 PowerShell 7，輸出明確以 UTF-8 解碼。

```powershell
.\scripts\windows\Test-WindowsNative.ps1
# 已 restore 可離線回歸：
.\scripts\windows\Test-WindowsNative.ps1 -SkipRestore
```

腳本建置 Debug app／probes，執行真 SQLite／DPAPI、JavaScript→native stdio bridge 及實際 WPF／WebView2。
資料庫、截圖皆寫入 `build/native-checks-*`／`build/native-js-*` 的獨立合成資料目錄；不讀取個人 App 資料。
WPF probe 使用螢幕外視窗，以 DOM 操作 editor、附件、關閉及重新開啟，截圖為 `ui/native-ui.png`。
初次顯示不啟用；明確快捷鍵／tray 回歸會要求啟用自有視窗，未注入系統鍵盤／滑鼠。
另測加密自動備份、手動匯出與原生檔案的還原預覽；只替換互動 picker 結果，
原生檔案／DPAPI／SQLite／IPC 皆實際執行，沒有自動操作真 OS picker。
core probe 測 NTFS create-new、寫入／rename 競爭、部分檔保留、換檔不刪、同 handle 校驗／刪除、
目錄重開及替換拒絕；JS→native 測中文／emoji 密碼、跨程序 key／grant、ack 遺失恢復、
受管檔修改保留、manual 保存證明與失效／跨 profile key 不降級。
需要一般 Windows 使用者 session 與 WebView2 Runtime；受限工具環境若造成 WebView2 crash，需在可運行環境重測，
不能當作通過或停用 WebView2 sandbox。主畫面／保存測試不代表多螢幕、OS 桌面整合或真實斷電證據。

同一腳本另執行 `--composition` 與 `--platform` 原生基礎探針：

`--shell-topology` 使用原生發現／存活判斷的同一實作與合成視窗查詢，覆蓋 classic sibling、Progman child、
圖示宿主搬移、錯誤 PID／隱藏／圖示宿主／疊序、缺失／有界建立重試與 Explorer／句柄替換。
它已接入 Test-WindowsNative，不建立測試 Explorer，也不把模型通過當成新版 OS 實測。
composition probe 套用 coordinator 既有的 render popup 穿透政策，輸入失敗時回報命中的 HWND／class／PID。
另以合成 WPF MouseDown／MouseUp 檢查原生 capture、region 移動、意外失去捕獲、hide／topology 解除；
不注入系統滑鼠，也不能代替使用者快速拖曳驗收。修正前捕獲檢查失敗；2026-10-09 修正後尚未執行。

另執行 `--wallpaper OUTPUT_DIRECTORY`，要求目前 session 有真正的 Explorer 圖示／桌布宿主；
不可用即失敗，不標成通過。以合成內容確認兩個自有場景 HWND 的 parent／WS_CHILD、
實際 WebView 像素、原生空輸入 region、physical bounds、反覆附著／浮動／隱藏與不啟用。
圖片只捕獲測試表面，不截取使用者桌面；不重啟 Explorer 或注入鍵盤／滑鼠。
真螢幕像素 FAIL 會讓 probe 失敗；外部遮擋仍回報 SKIP，浮動表面以自有 HWND 判定，不把自有視窗當外部遮擋。
另新增隱藏後原像素還原檢查，仿 Explorer 宿主也檢查收起後背景；原像素檢查受遮擋時明確 SKIP。
主 WPF probe 新增 `scene.prepare` 已確認後才移除附著便箋 DOM 的檢查。
上述殘影與 prepare 流程的新回歸尚未執行；使用者在本輪要求停止測試及截圖，待有空再驗收。
主 WPF probe 另測實際逐卡設定→wallpaper→調整此組→floating→完成→wallpaper 的 owner／scene 流程。
Windows 10、Explorer 實際重啟、Win+D、虛擬桌面及混合 DPI 完整矩陣仍需各自驗收。
桌布層回退或附著錯誤時，可執行唯讀的 `scripts/windows/Get-ShellLayerInventory.ps1`，
列出 Progman／WorkerW／SHELLDLL_DefView 宿主及各自的 DPI／PerMonitorV2 狀態；不送 Explorer 訊息，也不改視窗。

- 真 CompositionControl 透明 HTML／live VisualBrush；只載合成資料，沒有 product bridge。
- 另一個自有程序作 OS `WindowFromPoint` 目標，檢查被動紙面、空白及前方遮擋穿透；
  native input／visual region 互斥且完整覆蓋，浮動／一般底層切換、成對隱藏／關閉與 20,000 區域。
- 螢幕 physical bounds／work area／DPI；真實快捷鍵衝突、解除／恢復、保留鍵拒絕與舊事件清理。
  快捷鍵 callback 只向自有 HWND 發合成 WM_HOTKEY，未注入真鍵盤或滑鼠。

probe 與 App 共用 PerMonitorV2 manifest 及 `net8.0-windows10.0.19041.0`。
必須透過 `.exe` apphost 執行，包含跨程序目標；入口驗證 thread DPI awareness 確實為 PerMonitorV2。
直接 `dotnet ...Ui.Tests.dll` 未套用這份 executable manifest，不能作相同 DPI 設定的證據。
這不是使用者桌面手勢、WebView capture／IME、多螢幕拔插、Win+D、虛擬桌面或休眠驗收。
原生基礎見 [ADR-017](decisions/017-windows-composition-surface-and-input.md)，產品連接見 [ADR-018](decisions/018-single-owner-desktop-views.md)。
WPF 主 probe 現另開真正場景頁：確認 projection、scene 不可呼叫 storage、浮層操作、就地草稿、
1.2 MiB 中文輸入分片、合成 CompositionEvent 阻止退出、交易保存後回到穿透政策。
關閉測試故意延後最後 storage.commit，確認編輯保持凍結，重開後最後草稿文字完整。
顯示器描述只在 probe 注入螢幕外範圍；沒有以合成範圍聲稱真多螢幕通過。
core 另測 scene lease 跨版本讀取／principal 隔離、半份與壞 hash 不發布、過期 session／frame 拒絕，
以及十組／長組名仍可讀。`tests/desktop-authority.test.js`／`desktop-transport.test.js` 驗證重播、世代、
獨立草稿 admission、未知 ack 重試、失聯 flush 解除與關閉命令封鎖。
`desktop-frame-refresh.test.js` 另涵蓋舊 frame 下載中收到新 frame、拖曳完成等待及下載失敗後重試；
`desktop-transport.test.js` 新增拖曳完成／取消必須先等最新 geometry 發布才回覆。這些新增 JS 回歸尚未執行。
快捷鍵／系統匣 probe 另核對真 shell icon 身分、設定與實際註冊狀態、原生動作→scope、
就地 scope 鍵先保存草稿、合成 IME 拒絕、關閉 block 不被設定更新解除、收起／重開同一 owner，
以及自有 TaskbarCreated 訊息重建 icon；沒有重啟 Explorer。
正向 foreground intent 需要當下 OS 授權；若 Windows 拒絕，該小項明確 SKIP，仍測 null／失效拒絕。
WPF IsActive 不代替 GetForegroundWindow 的實際所有權，不能把前置條件失敗算成搶焦點成功。
`tests/native-shortcuts.test.js` 測設定合併、重試與關閉隔離，`tests/shortcuts.test.js` 測本地鍵的輸入優先序。

`npm test` 會明確 skip 8 個需要已建置 Windows helper 的 native integration tests；
`WORK_FLEET_NATIVE_TEST=1` 才執行它們，缺少 helper 即失敗，不假報成功。
若單獨執行，先用 `Build-WindowsApp.ps1 -Configuration Debug -IncludeTests`，再設變數並執行
`node --test tests/native-storage.test.js`。無 OS 依賴的 bridge 關閉／訊息容量測試每次都跑。

同一腳本最後執行 `--diagnostics OUTPUT_DIRECTORY`（[ADR-032](decisions/032-windows-debug-webview-inspection.md)）。
未設變數不建立 CDP 選項；不合法 port 須在 owner 鎖前以 HostError 拒絕，之後同一目錄仍可開啟。
以 OS 分配的空閒 port 開 Debug 主畫面，確認 DevTools 已啟用、listener 只綁 loopback，
`/json/list` 有主文件，並以 CDP WebSocket 實際讀取 DOM 狀態。Release 執行檔不能跑此 probe。
`Build-WindowsPackage.ps1` 在 publish 後掃描 `WorkFleet.dll`，找到 `remote-debugging` 字串即停止封裝；
`Test-WindowsNative.ps1` 要求同一掃描命中 Debug `WorkFleet.dll`，避免檢查失效；腳本也會先清除 shell 已設的 port 變數。

開發時以 CDP 檢查 Debug App（使用正式資料目錄；需先關閉已安裝的 App）：

```powershell
.\scripts\windows\Build-WindowsApp.ps1 -Configuration Debug
$env:WORK_FLEET_WEBVIEW_DEBUG_PORT = '9339'
& .\src\native\windows\app\bin\Debug\net8.0-windows10.0.19041.0\WorkFleet.exe
Remove-Item Env:WORK_FLEET_WEBVIEW_DEBUG_PORT
# http://127.0.0.1:9339/json/list 列出主畫面與桌面場景 target
```

VS Code 的「Windows: Work Fleet (Debug + CDP 9339)」啟動設定等同上述步驟；「windows: native tests」task 執行完整原生回歸。

變數只設在目前 shell 的程序環境，不要用 setx 或機碼設定。port 已被占用時 CDP 不會啟動。

## 手勢測試 helper

```bash
xcrun swiftc -module-cache-path build/module-cache scripts/testing/input-probe.swift -o build/input-probe
build/input-probe
```

helper 先查公開 `CGPreflightPostEventAccess()`，無權限即回報並退出，不修改權限。
有權限時顯示專用測試目標，送出點擊／drag／keyup/down 並回報收到数量；
單獨跑 helper 只驗證測試目標，**不能證明另一個 App 的滑鼠穿透**。
真正桌面／Finder 框選與拖放的步驟及未測狀態記在報告。

## 產物檢查

```bash
codesign --verify --strict 'build/Work Fleet.app'
codesign -d --entitlements - 'build/Work Fleet.app'
otool -L 'build/Work Fleet.app/Contents/MacOS/WorkFleet'
```

最終 staged export 在乾淨目錄以空 module cache 重建成功；13 個 HTTP/SQLite、8 個 JS 與文件檢查也通過。
這段歷史 0.1.0 Mac 驗證沒有應用第三方 package tree；系統／外部 runtime 與版本見
[runtime inventory](validation/runtime-inventory.json)。正式上架前需對實際封裝重做檢查。

最初 bootstrap／文件檢查歷史已保留於 Git；不能當成上述產品測試的替代證據。
