# 建置、測試與證據

更新：2026-10-15。新核心證據見 PROGRESS；既有 0.1.0 證據見 [驗證報告](validation/2026-10-03-validation-report.md)。

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

`.github/workflows/ci.yml` 在 push 到 main 與 pull request 時，於 GitHub hosted runner 執行上述 JS／Python 測試與 build、
Linux Docker 的桌面層與主機檢查（`test-desktop-layers.sh`、`test-host-shell.sh`），以及 Windows Debug 建置、core probe 與未簽章包檢查。
不使用 secrets；WebView2 UI probe（`Test-WindowsNative.ps1`）、簽章、Apple 建置與實機驗收仍在本機或手動 workflow。

`python3 -B -m unittest discover -s tests -p 'test_linux_package.py' -v` 在有 bash 與 dpkg-deb 的環境
實際封裝隔離 fixture，驗證一般／release DEB 的版號與檔名都取自 bundle `package.json`，缺版號時拒絕，
release 仍拒絕缺少 maintainer email。缺工具時略過，不安裝套件或啟動 GUI。
另驗證成功／失敗都清除本次 staging，保留既有輸出。有 Node 22+／npm 與 lockfile 依賴時，
在含空白路徑的隔離 checkout 改寫 `src/native/linux/VERSION` 後執行完整 `--deb` 建置，
確認 DEB 與 tar.gz 直接輸出到 `build/` 根目錄、檔名跟隨該版號、`.sha256` 與檔案相符，
`build/` 沒有其他新檔，且重建 bundle 時清除已不存在的來源檔；啟動腳本優先使用 `/usr/bin/python3`，
`WORK_FLEET_PYTHON` 指定的直譯器會收到 host 路徑與原有參數。

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
`tests/apple-signing.test.js` 驗證 manual Developer ID export 的憑證／profile 設定與不合法簽章參數；
Mac 上另以真 PlistBuddy 與假的 Xcode／notary／codesign 工具執行 DMG＋更新 ZIP 封裝，確認不需要 Installer、
不產生 PKG、傳遞暫時 notary keychain、無公證 DMG／automatic export／一般 PKG 在 macOS Bash 3 的空陣列相容性，
以及 runtime 載入路徑檢查／公證失敗時不覆蓋上次交付的檔案；缺載入路徑時不得送公證。其他 OS 略過該封裝 fixture。
`tests/test_macos_profile.py` 驗證過期、錯誤 Team／App ID／憑證／Keychain group、development profile 與不合法 UUID 的拒絕。
這些是流程回歸，不能當成 Apple 公證或真 signed app 通過；實際 archive、export、Gatekeeper 與 Sparkle 更新另需驗證。
`python3 -B -m unittest discover -s tests -p 'test_macos_runtime.py' -v` 在 Mac 編譯真正的 universal Mach-O fixture，
驗證搬移／空白路徑、缺 `LC_RPATH`、只有 x86_64 壞掉、framework 缺檔／缺架構／只在建置機器可用，
以及 Debug dylib 繼承主程式搜尋路徑；其他 OS 略過。
`macos-release.yml` 的 Mac job 在匯入簽章秘密前執行此回歸。
原生 macOS build／preview package／Release export 都執行 `scripts/testing/check_macos_runtime.py`，
逐一檢查 arm64、x86_64 主程式及其 bundle 內動態依賴，不接受建置機器外部 framework。
Release export 在公證前加 `--launch`，執行 App 的 `--check-runtime`：讓真實 dyld 載入後立即退出，
不建立 NSApplication、不開啟 workspace、登入項目或 Google。只證明建置機器架構的原生載入，不能當作主畫面或 Google 往返驗收。
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
python3 scripts/testing/check_macos_runtime.py build/apple/DerivedData/Build/Products/Debug/WorkFleetMac.app
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

macOS 登入項目（ADR-043）：`python3 -B -m unittest discover -s tests -p 'test_macos_host_shell.py' -v`
編譯正式 `FleetHostShell`／`FleetProtocol`，以注入的登入服務驗證未見過的 `notFound` 可註冊且設定可操作、
第一次啟動套用預設、既有偏好只允許手動重試、系統核准不被覆蓋、取消與重開保持關閉，以及失敗不假報成功。
沒有 Swift／AppKit 的平台略過；預設不改系統登入項目。Mac release job 在匯入秘密前執行。
要在 Mac 額外驗證實際 ServiceManagement，可執行：

```bash
WORK_FLEET_TEST_LOGIN_ITEMS=1 python3 -B -m unittest discover -s tests -p 'test_macos_host_shell.py' -k real_sandboxed -v
```

這會建立隨機 `app.workfleet.loginprobe.*` 的 ad-hoc 簽章沙盒 App，暫時註冊並取消自己的登入項目，
不碰已安裝 Work Fleet 或使用者工作區。測試只證明註冊、系統狀態與取消；實際登出再登入仍需手動驗收。

三平台桌面分層契約見 [ADR-031](decisions/031-macos-and-linux-wallpaper-scenes.md)。
`python3 -m unittest discover -s tests -p 'test_linux_scenes.py' -v` 在無 GI／display 的環境也可驗證
Linux native frame 的三層、桌布 input flags 拒絕、舊 session／sequence 與 geometry；不作 UI 證據。
`python3 -m unittest discover -s tests -p 'test_linux_vault.py' -v` 以真 AES-GCM／SQLite 與假 libsecret 驗證
[ADR-047](decisions/047-linux-local-key-without-keyring-prompts.md)／[ADR-048](decisions/048-linux-offline-workspace-and-system-secrets.md)：首次啟動／重開便箋不接觸金鑰圈、0600 本機金鑰、
舊資料跨帳號完整驗證後遷移、鎖定／缺金鑰／錯誤金鑰／損毀／寫入失敗保留原資料、拒絕 symlink／不安全權限，
以及系統憑證／備份密碼的 profile 隔離、鎖住暫停、session collection 拒絕、重複 collection、reset／登出標記、
舊副本保存確認後 DB／WAL 清理與寫入失敗重試。慢 vault 下 owner bridge 仍完成 storage commit/load，
host 將 vault 備份分流至 network worker。不需 GI 或使用者金鑰圈；需 python3-cryptography。

真 libsecret probe 在私人 D-Bus session 與 `/tmp` 合成金鑰圈驗證遷移，以及鎖住後不跳密碼視窗、
便箋仍可讀寫、憑證／備份密碼不能讀或新存；precheck 後再鎖住仍不執行 Prompt，
provider 重啟無須直接重設 production Vault 即可恢復；鎖定／secret cache 不可繞過鎖定，外部換 token 後讀到新值。
舊本機副本確認移至 vault 後從目前 DB／WAL 清理。
需要 dbus-run-session、dbus-monitor、gnome-keyring-daemon、libsecret；
不修改桌面的 keyring，不代替實際登入／重開機驗收：

```bash
task_probe_dir=$(mktemp -d /tmp/work-fleet-storage-probe-XXXXXXXX)
mkdir -m 700 "$task_probe_dir/data" "$task_probe_dir/runtime"
XDG_DATA_HOME="$task_probe_dir/data" XDG_RUNTIME_DIR="$task_probe_dir/runtime" \
  timeout 30s dbus-run-session -- python3 -B tests/native/linux/storage_probe.py "$task_probe_dir"
```
`python3 -m unittest discover -s tests -p 'test_linux_google.py' -v` 以假 HTTP 確認 Linux 換 token 時，
有設定才送 Desktop client secret、格式不對時停用；不連網，也不代表真實登入。
同一檔也確認建構不讀 vault、鎖住清除快取 token／status 非致命、解鎖恢復不需 OAuth、
鎖住時不啟動登入瀏覽器，以及 401 強制 refresh 在 vault 重讀與暫時鎖定後仍保留。
`node --test tests/google-vault-pause.test.js` 執行實際帳號 UI 函式，確認同步暫停仍有重試／登出控制、解鎖恢復同帳號，
另執行實際 syncGoogle 函式，確認只有手動同步呼叫 google.unlockVault、成功接續同步、取消／逾時可重試、
同一 Prompt 期間重複點擊不重送，以及切換帳號／本機／登出／關閉後丟棄舊結果，不保存或同步舊來源。
Windows／macOS 沒有 vaultUnlock capability 時不新增 bridge 呼叫，背景一律不解鎖。
`python3 -B -m unittest discover -s tests -p 'test_linux_unlock.py' -v` 使用真 libsecret／GLib、私人 D-Bus 與合成 provider，
確認 Unlock／Prompt 的手動取消、成功重試、已解鎖不提示、90 秒操作期限（測試縮短）、close 取消及背景零 Prompt。
另確認慢前置查詢／憑證讀回共用期限、排隊已逾期不開 Prompt、owner 在 preflight 關閉不開 Prompt，
以及 provider 回覆 Dismiss 卻不發 Completed 時仍能返回。
不讀取使用者金鑰圈或密碼，也不代表實際 GNOME／KWallet 視窗的可見性與輸入已驗收。
Google Python 回歸另確認 unlock_vault 只處理 vault-locked、服務缺失不要求密碼，成功返回原帳號且不 OAuth。
登出仍只刪除本機憑證、完全不發網路請求。
`node --test tests/google-sign-out.test.js` 檢查 Windows、Linux、
Apple、Android 的原始碼都沒有向 Google 撤銷授權的呼叫（ADR-021 修訂）；Swift 與 Java 不在每個檢查環境編譯，所以用原始碼檢查。
`tests/test_linux_python_floor.py` 從 DEB `Depends` 讀 Python 下限（3.10），確認 tar.gz 宣告相同，
並以該版本語法解析 Linux host，另檢查 `ast` 放行但 3.12 前不接受的 f-string 寫法；不檢查標準庫 API。
`tests/test_linux_gi_versions.py` 以 `ast` 確認固定 Gtk 3.0 的 Linux 模組在 import Gdk 前也固定 Gdk 3.0，
避免已安裝 GTK 4 typelib 時先載入 Gdk 4.0 而啟動失敗；不需 GI 或 display。
`tests/test_linux_surface.py` 以假 GI／cairo 建立 X11 場景並固定測試用的工作階段環境，確認 X11 以工作區、layer-shell 以整個螢幕為 viewport，
視窗依 viewport 設 size request、換顯示器時更新，
GNOME Wayland 經 XWayland 時只常駐桌布層、桌布為 keep below 的 desktop-type 視窗並拒絕桌面層，最上層在調整模式以整個工作區為
input region、即使該螢幕沒有便箋也顯示並只在出現時 present；GNOME Xorg 提供三層且沒有遮罩，桌面層為一般視窗加 keep below，
最上層有便箋時可取得焦點；layer-shell 常駐三層，調整模式同樣是遮罩，以整個螢幕為 input region 並以 EXCLUSIVE 取得鍵盤、
結束後回到 ON_DEMAND；同一 Wayland socket 上有 `pcmanfm --desktop` 時 layer-shell 不提供桌布層，偵測以假 `/proc` 排除
檔案管理員視窗、其他工作階段與沒有 Wayland 顯示的行程；其他 X11 調整時同樣以整個工作區為遮罩，平時只有便箋接收輸入且桌面層為 desktop-type；
隱藏的主視窗以原位置、大小與最大化狀態恢復，layer-shell 改為最小化並以 activation 叫回、被拒絕時重新顯示，
原本不在畫面上的主視窗不被叫回；`tests/desktop-overlay.test.js` 確認只有調整開始時有焦點的主視窗讓開並在結束後恢復。
不代表 GNOME 或 labwc 實機已驗收。Windows 的 `SceneTransfersProbe` 另檢查 `operationScope` 解析出調整狀態並拒絕未知範圍；
Windows 與 macOS 的遮罩畫面、輸入範圍與主視窗最小化沒有自動化測試，兩者的 layer probe 仍只檢查原有分層。
`tests/stages.test.js` 與 `tests/desktop-authority.test.js` 另驗證沒有桌面層時快捷鍵略過該層、
桌面便箋回退桌布層且不可互動、保存的偏好不改寫，只有最上層時拒絕投影；最上層只供調整時，
常駐便箋回退桌布、調整中的便箋仍在最上層，快捷鍵從桌布直接進入調整模式且不改寫常駐層；
遮罩的排列指令只在調整時接受 stack／spread／undo，完成指令結束調整模式。headless labwc probe 檢查遮罩染色；
工具列與主視窗隱藏／恢復只有實機驗證。
`tests/test_linux_renderer.py` 以假檔案系統確認只有 Raspberry Pi model 或 V3D 驅動才預設 DMA-BUF renderer 的共享記憶體 buffer、
使用者設定任一 renderer 變數時不覆寫，且 host 在 import WebKit 前決定；不代表 Pi 或其他 GPU 已實機驗收。
`tests/test_linux_shortcuts.py` 以假 Keybinder 確認 X11 先關閉 cooked 比對再登記，Ctrl+Shift 組合觸發動作、主視窗取得焦點時釋放；
labwc 模式不詢問 portal，未寫入的組合為 `unwritten`，寫入後即使 Work Fleet 有焦點也是可用；不代表實際按鍵已驗收。
`tests/test_linux_labwc.py` 以暫存檔驗證 labwc 按鍵語法、只取代標記區塊並保留其他內容與註解、找到或建立 `<keyboard>`、
拒絕格式錯誤的檔案、合併／非合併模式的新檔、只備份一次、保留權限、狀態判斷與從 labwc cmdline 偵測設定目錄；
`tests/native-shortcuts.test.js` 另確認寫入等待進行中的設定並回報 rc.xml 狀態。不讀寫使用者的 rc.xml。
`tests/test_linux_xwayland.py` 驗證 GNOME Wayland 偵測、偏好檔的權限與原子寫入、GTK 前依選擇設定 `GDK_BACKEND`、
使用者設定優先、重新啟動移除自己設定的值、只詢問一次、資料鎖未釋放時不重新啟動；對話框與實際重新啟動只有實機驗證。
在真正的 Mac 圖形 session 執行 `bash scripts/macos/test-desktop-layers.sh`，直接編譯 AppKit
場景／協調器，驗證原生 level、三層能力、位置、穿透、桌布拒絕焦點，以及場景 WKWebView 不畫不透明底色
（否則整片場景會蓋住桌布），不需要 Google SDK。互動紙面另以 `NSWindow.windowNumber(at:belowWindowWithWindowNumber:)`
確認 WindowServer 會把真實點擊交給輸入 panel；直接送進 panel 的合成事件會略過這個判定，無法取代此檢查。
全域快捷鍵只在 Work Fleet 視窗取得鍵盤時釋放；probe 以 `FleetShortcuts.suspends` 檢查主視窗最小化、關到選單列（App 仍在前景但沒有 key window）
仍保留註冊。實際按鍵送達需要在實體鍵盤測試；遠端桌面不一定會傳送按鍵組合。
WindowServer 非同步套用視窗排序與 level，剛顯示的視窗會先回報 layer 0、不在螢幕上；probe 會 flush 並等到視窗上螢幕且 level 相符
（最多 2 秒）再檢查。
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

同一映像以真 GTK owner 檢查 ADR-043（不開啟 workspace 資料庫，也不需要 Secret Service）：

```bash
mkdir -p build/linux-host-checks
docker run --rm --network none \
  --mount "type=bind,source=$PWD,target=/workspace,readonly" \
  --mount "type=bind,source=$PWD/build/linux-host-checks,target=/evidence" \
  work-fleet-linux-desktop-tests dbus-run-session -- bash /workspace/scripts/linux/test-host-shell.sh /evidence
```

Xvfb＋openbox（X11）驗證預設大小、移動／最大化／最小化／還原後的 `window-placement.json`、重新開啟回到保存位置、重置、
第一次啟動寫入 bundle 啟動檔的 autostart 項目、關閉後之後啟動不重新建立，以及 `--launch-at-login` 時主畫面先隱藏、
沒有系統匣時 5 秒後顯示、再次啟動叫出主畫面。headless labwc 驗證只保存大小與最大化並在重開時套用。
`tests/test_linux_hostsettings.py` 以共用 fixture 驗證位置規則、檔案、Exec 引號與只移除自己寫入的 autostart 項目。
這些不是 GNOME／Pi 實際登入時的 autostart 證據。

投影來自實際共用 Workspace／InteractionController；native owner 分片發布並由真正 WebKit renderer
接收、確認、畫出。涵蓋 wallpaper→調整此組 floating→完成後還原、常駐 desktop／floating、
反覆隱藏／顯示與 topology 重用；調整此組時確認最上層整個畫面接收輸入、鍵盤為 EXCLUSIVE，便箋外的畫面被遮罩染色，
並對最上層送出合成的指標移入／移動事件後確認便箋與遮罩仍在。場景使用 Pi 預設的 `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`；
停用 DMA-BUF renderer 時這項檢查在 Pi 會失敗，x64 Docker 則仍通過，所以 CI 擋不住這個回歸。
合成畫面截圖會等到預期像素出現（最多 10 秒）、再截一次才檢查：軟體 GL 下新顯示場景的第一個畫面較晚到達 compositor
（x64 Docker 的桌布層約 0.4 秒、調整遮罩約 1.6 秒），固定等 0.2 秒會失敗。
輸出合成畫面 PNG、版本與 Wayland trace；trace 檢查接受新舊 libwayland 的物件編號格式。
已安裝 labwc、grim 與 GTK／WebKit 繫結的 Linux（如 Raspberry Pi OS）也可不用 Docker，以系統 Python 直接執行：
`PATH=/usr/bin:$PATH dbus-run-session -- bash scripts/linux/test-desktop-layers.sh OUTPUT OUTPUT/scenarios.json`。
root Docker probe 的 WebKit sandbox 例外僅存在測試 shell，不套用到產品 launcher。
這些測試不是 Pi／V3D、pcmanfm-pi、實體拖曳／IME 或多螢幕證據；X11 不假冒三層能力。
`npm run config:check -- --platform windows` 等指定平台命令在缺公開設定時應非零退出。
`tests/workspace-sync.test.js` 驗證 graph 與 Workspace／LayoutStore 原子交易、保存失敗、過期 session／cursor、
runtime 重啟、群組循環／十組恢復、草稿、歷史恢復、轉組意圖與既有 entity 順序。
`tests/file-sync.test.js` 使用獨立記憶體 FileStore，驗證分頁／重啟／雙裝置分支、回應遺失、
reservation／ack 故障、附件、來源不可變、撤權／退避、取消與帳號 session。
`tests/google-drive.test.js` 使用 scripted HTTP 回應，驗證 appDataFolder 路由／metadata、
resumable 分段及 Range、4xx 重開、同 file ID、讀回校驗與 Location 邊界；不使用 Google 憑證。
`python3 -B -m unittest discover -s tests -p 'test_macos_google_drive.py' -v` 編譯正式 Apple
`FleetDrive`／`FleetProtocol`，只替換授權與 HTTP，驗證 Google 回傳的原始逗號／`%2C` fields 參數、
上傳 bytes 與 URL 保留、失敗後查進度續傳，以及 adapter 重建後沿同 file ID 開新 session。
另驗證缺失／不合法 Location、外部主機、HTTP、錯誤 port／路徑、帳密、fragment、重複參數與過長網址
在傳送內容前被拒絕。沒有 Swift SDK 的平台略過；Mac release job 在匯入秘密前執行。
不讀 Keychain、不連真實 Google，也不代表已安裝版本的重開機／帳號往返驗收。

`tests/backup-archive.test.js` 驗證 ZIP 路徑／目錄／CRC／容量／惡意 DEFLATE／取消及加密，
並透過固定 Python 標準庫 fixture 獨立讀取 ZIP（Windows 支援 pyenv 的 python.bat）。
`tests/backup-payload.test.js` 驗證完整歷史／群組／草稿 lineage／附件／版面、hash／引用／計數、
profile 綁定、並行快照、未知 conflict 拒絕、加密與大量圖取消。沒有把檔案驗證當已還原。
`tests/backup-capacity.test.js` 完整產生／重開 20,000 entries 並驗證多一個就拒絕；
它含大量個別 ZIP／SHA 作業，執行時間高於一般小 fixture，不是最低手機裝置 benchmark。
`tests/backup-restore.test.js` 驗證三種還原、完整 ID／草稿 lineage 映射、缺 parent、過期計畫、
安全備份綁定、交易失敗、重啟 receipt／明確重複及大量新卡定位取消後佇列仍可使用。
另驗證本機完整還原不需安全備份、舊 graph／草稿／附件清除、過期／取消／交易回滾，
以及本機／Google 四方向同格式往返。`tests/backup-export.test.js` 用 MemoryFileStore 驗證同步後匯出新遠端內容、
明確副本 fallback、取消／切 profile、不完整同步及成功時間；未連真 Google。
`python -m unittest discover -s tests -p 'test_linux_local_restore.py' -v` 執行真 SQLite 的替換／空附件／回滾／CAS／分區隔離；
在 Windows 只替換 fcntl import，crypto 使用 identity fixture，不代表 Linux GUI／金鑰圈已測。
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
node scripts/testing/cloud-restore-ui-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/local-backup-ui-probe.mjs --url http://127.0.0.1:PORT
node scripts/testing/automatic-backup-probe.mjs --url http://127.0.0.1:PORT
```

`local-backup-ui-probe` 使用合成 Google FileStore、真實 IDB，驗證舊備份可選、確認失效、附件移除／其他分區保留，
以及 Google 匯出同步、失敗明確選擇與取消；沒有存取使用者便箋或 Google 帳號。

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
另在完整主畫面確認本機完整還原不產生舊資料備份、只留下備份 graph／草稿，重啟仍可讀回。
上述不代表原生 OS picker、外部磁碟斷電耐久或最低手機容量壓測。
automatic probe 先確認真 App 的自動檔案能力停用，再以真 IDB journal／Workspace 與合成 FileHost
檢查完整 UI、執行中停用、reservation abort、ack 遺失／重啟、CAS、授權暫停及可讀取的 ZIP bytes。
它不使用原生 OS 自動檔案或 vault，截圖為 `build/automatic-backup-probe.png`。
輸出截圖在 `build/browser-probe.png`，失敗時在 `build/browser-probe-failure.png`。
這不等於真實斷電、Google 來源、iOS／Android 或 OS 分層驗收；這些瀏覽器 probe 不在 GitHub Actions CI 中，需在本機執行。

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

`node --test tests/cloud-restore.test.js` 以合成 FileStore 驗證全量清空後只留下備份內容、
附件、草稿不發布、舊裝置遇重設標記、沒有安全備份／過期／錯帳號／磁碟失敗零遠端刪除，
以及清空／上傳失敗後重啟續行、上傳重試不再次清空。
`cloud-restore-ui-probe.mjs` 使用真 Edge／IndexedDB／OPFS 與合成 FileStore，
驗證安全保存及清空勾選雙門檻、換檔案後確認失效、預覽暫停普通同步與全量還原。
只掛載備份面板，未模擬原生帳號切換／完整主畫面續行；不等於真 Google 端到端。

未封裝路徑探針 `WorkFleet.Windows.Ui.Tests.exe --app-data OUTPUT_DIRECTORY` 只解析路徑，不寫入正式 ZIP／Debug 資料。
已有 Release app／UI probe 與 package/content 時，可用
`scripts/windows/Test-WindowsAppData.ps1 -CertificateThumbprint THUMBPRINT`：
使用既有受信任本機憑證建立獨立 `app.workfleet.storageprobe.*` identity，
實際驗證明確私有位置、寫入、解除安裝刪除及外部匯出 fixture 留存，最後只移除自己的測試套件。
證據留在 `build/storage-probe-*`；沒有新憑證、UAC、真 Work Fleet 安裝／解除安裝或 Google 操作。
實際產品更新、舊外部 DB 匯出／匯入及不同 Windows 版本仍需各自驗收。

本機簽章 preview 的封裝檢查（不安裝 App、不修改憑證信任）：

```powershell
.\scripts\windows\Build-WindowsPackage.ps1 -LocalTestSign
.\scripts\windows\Test-WindowsPackage.ps1 -PackagePath build/WorkFleet-VERSION-x64.msix
```

將 `VERSION` 換成 Windows 版號。檢查四種不合法簽章參數在建置前拒絕，
並使用 Windows 實際驗證 MSIX 簽章、機器信任、publisher、x64 manifest 與不含私鑰的配套 CER。
需要與 package publisher 相符的既有 CurrentUser/My 憑證及 LocalMachine/TrustedPeople 信任。
正式簽章仍使用 `-CertificateThumbprint`／HTTPS `-TimestampUrl`；本機模式不接受 `-Release`。
最終 MSIX 另核對 x64、目前 Windows 版號、Windows.Desktop 下限 22000 與 MaxVersionTested 26200。
另要求 .NET 8 Core／Windows Desktop 的 `includedFrameworks`，拒絕 shared `framework`／`frameworks`，
核對 deps 的 win-x64 target、hostfxr／hostpolicy／coreclr、WPF managed／native files 與完整 runtime 授權／notices。
這是包內容與簽章驗證，不代替未安裝 .NET 的實機啟動／MSIX 安裝驗收。
第一次封裝會還原 win-x64 self-contained runtime packs；完成同設定 package restore 後才可加 `-SkipRestore`。
沒有既有受信任憑證時，用一般 `Build-WindowsPackage.ps1` 與
`Test-WindowsPackage.ps1 -PackagePath build/WorkFleet-VERSION-x64.msix -Unsigned` 檢查未簽章內容；
這不代表簽章、安裝或 Store 驗收。省略 `-Unsigned` 仍拒絕未簽章包，該選項也拒絕未知／損壞簽章狀態。
`python -m unittest discover -s tests -p 'test_windows_package.py' -v` 使用 Windows SDK MakeAppx 產生隔離合成容器，
驗證過高／過低下限、device family／MaxVersionTested、錯誤版號、環境／私鑰檔案、明確未簽章模式，
以及缺少 runtime／notices、外部 shared .NET 需求與錯誤 deps 架構的拒絕。
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
不注入系統滑鼠，也不能代替使用者快速拖曳驗收。修正前捕獲檢查失敗；2026-10-09 恢復測試後通過。

另執行 `--wallpaper OUTPUT_DIRECTORY`，要求目前 session 有真正的 Explorer 圖示／桌布宿主；
不可用即失敗，不標成通過。以合成內容確認兩個自有場景 HWND 的 parent／WS_CHILD、
實際 WebView 像素、原生空輸入 region、physical bounds、反覆附著／浮動／隱藏與不啟用。
瀏覽器 preview 核對紙面內容；另捕獲測試便箋所在的桌面裁切區域，才能檢查新紙面之外的舊位置。
不重啟 Explorer 或注入鍵盤／滑鼠。
真螢幕像素 FAIL 會讓 probe 失敗；外部遮擋仍回報 SKIP，浮動表面以自有 HWND 判定，不把自有視窗當外部遮擋。
浮動紙面使用另一個 composition surface，與 coordinator 一樣；不把同一個 windowed child 改成 popup。
前景檢查以 [SetWinEventHook](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook)
觀察全程，包含自有 WPF 與該 WebView browser 的瞬間啟用；收到即失敗。外部程式自行切換 foreground 時，
「完全不變」的小項明確 SKIP，仍執行自有場景不得啟用檢查，不以最後 foreground 回到外部代替全程證據。
另新增隱藏後原像素還原檢查，仿 Explorer 宿主也檢查收起後背景；原像素檢查受遮擋時明確 SKIP。
主 WPF probe 新增 `scene.prepare` 已確認後才移除附著便箋 DOM 的檢查。
使用者後續已明確恢復測試／截圖授權；上述 prepare 流程與隱藏還原回歸已執行。
2026-10-09 使用者確認上一輪包的白塊仍存在，且只需調過位置後堆疊／攤開、不需要拖曳。
`--host-check OUTPUT_DIRECTORY` 已改成黑色背景，同時啟動有／無 redirection 的兩種仿宿主：
檢查移位、堆疊式縮高及攤開式區域變更後，新紙面仍顯示、每個舊位置恢復黑色，最後 hide 與區域外也恢復。
涵蓋 prepare/hide 與可見區域直接替換，不注入滑鼠。仿宿主以自有 GDI BLACK_BRUSH 背景窗作基準，
無 redirection 宿主位於黑底上方；不依賴空白 WPF 視窗的繪製或系統主題色，避免背後應用被誤認為背景。
黑底前置條件仍要求真螢幕像素為零，失敗保存圖與 HWND／style／命中 PID 診斷，不放寬顏色容差。
這些是表面幾何操作，不能替代實際 formation owner 流程。
真 Explorer probe 另以整個螢幕尺寸的 scene，反覆移位／縮高／展開；新紙面仍可見時比對舊中心及邊緣。
新宿主 style 與原生 repaint 順序見 [ADR-035](decisions/035-windows-attached-scene-background-lifecycle.md)；
23H2 測試已撤回被 OS 拒絕的 NOREDIRECTIONBITMAP 及造成實際紙面變暗的透明 windowed WebView 背景。
25H2 對照未驗證，也沒有獨立審閱。
`--formation OUTPUT_DIRECTORY` 已接入同一入口。主畫面用隔離 native SQLite 建立兩張便箋，
scene 的合成 PointerEvent 經既有 client／bridge／owner 保存調整位置，完成調整後須保留位置；
主畫面堆疊／攤開按鈕改變 layout，涵蓋桌面、浮動排列後返回桌面及桌布層。
scene 仍使用真整個螢幕 viewport；僅注入未遮擋的測試工作區，不更動 OS 工作區或桌布。
合成 DOM capture 不代表真滑鼠 capture。GDI 一次讀取測試範圍，在新紙面之外逐像素比對原桌面；
浮動模式另排除實際顯示的群組標籤與六 CSS px 邊框帶（含五 px 圓角），不排除整個群組工作區。
另檢查紙面可見、全程無便箋場景 foreground 啟用，並保存 native 螢幕 PNG；沒足夠未遮擋區域時明確 SKIP。
formation probe 也確認 `host.log` 記下啟動時的螢幕清單；`--platform` 檢查這行的格式（ADR-045）。
foreground 判定涵蓋所有便箋成對 HWND 與 browser，排除主畫面及 framework helper；建立便箋時主畫面
編輯器的焦點不是被動紙面自行啟用。Wallpaper-only probe 不作這項排除。
目前安裝版複本也通過隔離 formation 案例，使用者原始殘影尚未重現；不能把此通過當作根因已證實。
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
`desktop-transport.test.js` 新增拖曳完成／取消必須先等最新 geometry 發布才回覆。2026-10-09 恢復測試後通過。
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

接著執行 `--host-shell OUTPUT_DIRECTORY`（[ADR-043](decisions/043-desktop-window-placement-and-startup-behavior.md)）：
主視窗會不取得焦點地短暫出現在主要螢幕。檢查設定＞桌面的版本與「啟動行為」（Debug 沒有 StartupTask，登入啟動選項停用並說明原因）、
「關閉主畫面時保留在系統匣」寫入 `host-preferences.json`、移動／最大化／最小化／還原後的 `window-placement.json`、
重置後回到預設大小並置中、重新開啟回到保存位置、保存位置所在顯示器不存在時改用預設，以及第二次啟動經每位使用者、
每個資料目錄的 pipe 喚起既有實例。核心 probe 以 `tests/fixtures/window-placement.json` 驗證與 Linux／macOS 共用的位置規則。
登入時啟動、隱藏啟動與 StartupTask 只能以安裝後的 MSIX 由使用者登出再登入驗證；混合 DPI 需要真多顯示器。

最後執行 `--crash-guard OUTPUT_DIRECTORY`（[ADR-045](decisions/045-windows-fatal-error-leaves-explorer-first.md)）：
- 場景以跨程序子視窗掛在 Explorer 式宿主上，再在 dispatcher 丟出 `UCEERR_RENDERTHREADFAILURE`。
- 檢查四件事：
  - 兩個場景視窗都變成隱藏的頂層視窗。
  - `host.log` 先記下 HRESULT 與拆離數量，之後才記錄重開。
  - `restart.json` 指向本程序。
  - 之後的例外只記成 nested。
- 交給 Windows 與重開只記錄、不實際執行。
- 另外驗證重開政策，以及等待舊程序：結束、逾時強制結束、PID 被重用時不動。
- 這個 probe 直接開啟重開來驗證機制；App 本身自 2026-10-14 起停用重開（ADR-045 修訂）。
- 核心 probe 驗證 `host.log` 格式與轉存，以及標記只能取一次、過期與損壞時丟棄。

接著執行 `--sign-in-hold OUTPUT_DIRECTORY`（[ADR-046](decisions/046-windows-sign-in-scenes-wait-for-settled-displays.md)）：
- 以登入啟動的身分開啟主畫面（隱藏），注入「上蓋合著、內建螢幕開著、還有其他螢幕」的狀態。
- 檢查三件事：
  - 等待期間沒有任何場景視窗，`host.log` 記下 `scenes waiting`。
  - 改成內建螢幕關掉後，所有場景都建立視窗。
  - `host.log` 記下 `scenes attaching after`，而且不是因為到達上限。
- 核心 probe 以表格驗證判斷規則：合蓋與內建螢幕、沒有上蓋狀態、只有內建螢幕、5 秒靜止、3 分鐘上限。
- `--platform` 讀出這台電腦作用中螢幕的連接方式與上蓋狀態，只檢查讀得到、不檢查值。
- 真實登入時的螢幕切換只能重開機驗證，看 `host.log` 的 `scenes waiting` 與 `scenes attaching after`。

MSIX 端到端：先 `Build-WindowsPackage.ps1 -LocalTestSign`，再執行 `Test-WindowsRecovery.ps1`。
- 安裝 `app.workfleet.crashprobe.e2e` 測試身分，讓它以登入啟動的身分在場景進入 Explorer 後丟出同一個錯誤。
- 檢查四件事：
  - 場景視窗在 Windows 寫報告前全部離開 Explorer。
  - 期間 `Progman` 與 `Shell_TrayWnd` 一直有回應，也沒有 Explorer hang 報告。
  - 沒有重開：沒有新實例、沒有 `restart.json`、`host.log` 沒有重開紀錄。
  - 測試最後移除測試套件與它的 dump，`host.log` 留在 `build/windows/crash-probe/`。
- 不碰已安裝的 Work Fleet。
- 沒有反向驗證「不拆離時 Explorer 會卡住」，因為那會凍結使用者的 Explorer。
- 真實登入時的 render thread 失敗，只能裝新版後重開機觀察 `host.log`。

螢幕切換端到端：先 `Build-WindowsPackage.ps1 -LocalTestSign`，再執行 `Test-WindowsDisplaySwitch.ps1`。
- 需要兩台螢幕；筆電要打開上蓋，因為上蓋合著時 Windows 不讓 DisplaySwitch 延伸到內建螢幕。
- 先切到「延伸」，安裝並啟動 `app.workfleet.displayprobe.e2e` 測試身分。等場景進入 Explorer 後，
  交替「只用第二個螢幕」與「延伸」，預設 3 輪。
- `-SwitchAfter N`：啟動後 N 秒就切換，不等場景穩定。`-Lid`：改由使用者合上上蓋觸發一次切換。
- 通過條件：
  - 測試套件沒有致命錯誤。
  - Explorer 沒有連續 5 秒不回應，也沒有 hang 報告。
- 會改變目前登入工作階段的螢幕配置，其他視窗會跟著移動；結束時切回 `-Final`，預設是只用第二個螢幕。
- 有其他 Work Fleet 執行中時拒絕執行，因為同樣的螢幕變更也會影響它。
- 結束時移除測試套件與它的 dump，`host.log` 留在 `build/windows/display-probe/`。
- 登入時「上蓋合著、內建螢幕卻仍啟用」的狀態，腳本做不出來，只能靠重開機觀察 `host.log` 的螢幕紀錄。

查登入當掉時，可在本機開啟 Windows Error Reporting 的完整 dump（需系統管理員，App 不會自己設定）：

```powershell
$k = 'HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\WorkFleet.exe'
New-Item -Path $k -Force | Out-Null
New-ItemProperty -Path $k -Name DumpFolder -PropertyType ExpandString -Value '%LOCALAPPDATA%\CrashDumps' -Force | Out-Null
New-ItemProperty -Path $k -Name DumpType -PropertyType DWord -Value 2 -Force | Out-Null
New-ItemProperty -Path $k -Name DumpCount -PropertyType DWord -Value 5 -Force | Out-Null
```

- dump 寫在 `%LOCALAPPDATA%\CrashDumps\WorkFleet.exe.<PID>.dmp`，每個約 1 GB，最多保留 5 個。
- 不需要時，刪除 `LocalDumps\WorkFleet.exe` 機碼即可。
- 安裝版的紀錄在 `%LOCALAPPDATA%\Packages\app.workfleet.preview_<id>\LocalCache\Local\WorkFleet\host.log`。

Google 登入 callback（ADR-021）：core probe 以真 loopback socket 驗證 `LoopbackCallback`。
- 先開一條不送資料的連線、再送真正的 redirect：要在單條連線的 5 秒期限內收到 code，空連線隨 listener 關閉。
  這是 0.2.1 的失敗情境；逐條處理的版本會在這裡慢 5 秒而失敗。
- 錯誤 state、重複 state、別的路徑、POST 都回 400 並繼續等；先斷線的連線只算 dropped。
- 分三次送達、header 結尾的空行被切開的請求照常解析。
- 同時 16 條空連線時，第 17 條立刻被關掉；空連線斷開後，callback 照常收到。
- 帶這次 state 的 `error=access_denied` 交給呼叫端拒絕；取消時 port 與已開的連線都關閉。
- 真 Google 帳號的瀏覽器登入仍需手動在安裝版確認。

App 內更新（ADR-044，2026-10-15 修訂）：core probe 以 `tests/fixtures/update-feed.atom`／`update-feed.json` 驗證公開 Atom 平台篩選、
數值版本比較、同 repo／tag 的下載位置、未知頻道與未列平台拒絕、DTD／外部實體拒絕、manifest 與 MSIX 身分檢查。
`Test-WindowsUpdate.ps1` 在 `Build-WindowsPackage.ps1 -LocalTestSign` 之後執行：把 MSIX 改成 `app.workfleet.updateprobe.e2e` 的兩個版本、
以同一張本機憑證簽章，安裝舊版並給它本機測試來源，確認它自行下載、核對、保存並關閉後由 Windows 換成新版，最後移除測試套件。
不碰已安裝的 Work Fleet；過程中測試身分的主視窗與空白桌面場景會短暫出現；本機 feed 同樣使用 Atom。
公開 feed／manifest 可唯讀查詢現有 release 驗證，不需發布或修改 release。
Linux 更新器由 `tests/test_linux_updater.py` 以同一份 fixture 驗證，並以假 HTTP／指令驗證轉址白名單、容量與 SHA-256、`dpkg-deb` 欄位、
取消 pkexec 與下載後被改動；另驗證查詢不碰 REST API、一般 403 與 429／帶 Retry-After 的 403 分類、feed 不轉址與檔名不可穿越。
`test-host-shell.sh` 確認非 DEB 執行時回報不支援。真 pkexec／polkit 安裝需在 Debian／Pi 以 DEB 實測。
macOS：`tests/update-feed-writer.test.js` 驗證 `write-update-feed.mjs` 產生的 appcast 與 manifest；Swift 程式由手動 Apple 建置 workflow 編譯。
`python3 -B -m unittest discover -s tests -p 'test_macos_release_feed.py' -v` 在 Mac 編譯正式 `FleetReleaseFeed` 與共用 fixture，
驗證 macOS 選版、較新本機不降版、appcast 位置、空 feed、DTD／錯誤 namespace／未知頻道／不同 repo 與嚴格版號；
沒有 Swift SDK 的平台略過。Mac release job 在簽章前執行，不連網或使用真實 App／使用者資料。
Sparkle 的沙盒安裝、`feedURLString` 與 EdDSA 金鑰只能在 Mac 上以 Developer ID 公證的舊版更新到新版驗證。

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
