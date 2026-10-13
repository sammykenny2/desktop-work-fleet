# 專案進度

更新：2026-10-14。本檔是本 repo 的執行狀態權威。

## 2026-10-14 repo 公開與 CI

使用者確認 OAuth client 為「電腦」類型、要求先回報參考專案的問題並移除其名稱與私有骨架 repo 的提及後，以 `gh` 改為 public；
加入 `ci.yml`（push 到 main 與 pull request），並授權手動跑一次 Apple 建置。

- 第一次 CI：JS／Python 測試與 build、Windows 建置／core probe／未簽章包檢查通過；Linux 的 `test-host-shell.sh` 在 X11 與 labwc 全部通過。
- `test-desktop-layers.sh` 在 x64 Docker 失敗於 `operate-group`：便箋位置只看到遮罩底色 `(21, 75, 168)`，最上層便箋沒有畫出。
  以本機 Docker 重跑 `000ea8b`（本批改動之前）同樣失敗，屬於 `11313e9` 之後就存在、只在 Pi 驗證過的問題，原因未查；CI 因此仍為紅燈。
- Apple 建置：iOS 第一次即通過，macOS 修正後通過（見下一節）。

## 2026-10-14 主視窗位置記憶與啟動行為：macOS（未編譯）

PLAN-006 Phase 1–3 的 macOS 部分，沿用同一 bridge 與設定頁；不升版。

- 新 `macos/FleetHostShell.swift`：資料目錄的 `host-preferences.json`／`window-placement.json`，與 Windows／Linux 相同的位置規則
  （points、左下原點、`NSScreen.visibleFrame`，主螢幕在前）；縮放（zoom）視為最大化，最小化與全螢幕不改寫；
  `SMAppService.mainApp` 登入項目只在第一次啟動套用預設與使用者切換時註冊／取消，需要核准時可開啟系統設定的登入項目。
- `Main.swift`：主視窗在顯示前套用保存的 frame；以 open-application Apple event 的 login item 標記判斷登入啟動，
  登入啟動且未選開啟主畫面時留在選單列；顯示前重新驗證、縮放延到第一次顯示；關到選單列、選單列消失時與結束前補寫；
  「關閉主畫面時保留在選單列」關閉後關閉按鈕會保存並結束。`FleetService` 的 `host.info` 加入版本與 `hostPreferences`。
  重新產生 Xcode 專案，`tests/apple-project.test.js` 通過。
- 在 Windows 撰寫。repo 公開後以 `apple-native-build.yml`（hosted Xcode 16.4、Debug、未簽章）編譯：第一次只有 `Placement`
  單行宣告的錯誤，`723e126` 修正後 macOS 與 iOS 都編譯通過。**沒有執行、沒有實機驗證**；需在 Mac 驗證位置往返、多螢幕、登入項目註冊與
  登入啟動判斷（SMAppService 下 Apple event 標記是否可靠未證實；判斷不到時會顯示主畫面），以及從未顯示的主畫面是否照常載入。
  沒有獨立審閱。

## 2026-10-14 主視窗位置記憶與啟動行為：Linux

PLAN-006 Phase 1–3 的 Linux 部分，沿用上一節的 bridge 與設定頁；不升版。

- `hostsettings.py`：主機層級偏好與位置檔、與 Windows 共用 fixture 的位置規則、版本與發行形式（DEB／bundle／原始碼）、
  `$XDG_CONFIG_HOME/autostart/work-fleet.desktop` 的寫入／讀回／只移除自己寫入的項目。
- `host.py`：X11 保存位置與大小、Wayland 只保存大小與最大化；最小化（含調整遮罩讓開）不改寫；顯示前重新驗證；
  收到系統匣、結束與關閉前補寫。`--launch-at-login` 時主畫面只 realize 不顯示，系統匣 5 秒內沒有就緒則顯示；
  再次啟動（GtkApplication activate）叫出主畫面；重新啟動會移除這個參數。登入啟動只在第一次啟動套用預設與使用者切換時寫入。
  `tray.py` 不再於 StatusIcon 尚未嵌入時立即顯示主畫面，改由上述等待處理。
- 測試：WSL Ubuntu 的 Linux discover 76 tests，1 skip／0 fail（含新增的 `test_linux_hostsettings.py` 5 項）；
  新 `scripts/linux/test-host-shell.sh` 在 Docker 的 Xvfb＋openbox 與 headless labwc 以真 GTK owner 全部通過。
  上一個提交在 `Test-WindowsPackage.ps1` 加入 StartupTask 檢查時漏改 `tests/test_windows_package.py` 的 fixture，
  這次補上並加入拒絕案例，10 tests 通過；新包 `Test-WindowsPackage.ps1` 通過。
- 未驗證：Docker probe 不開啟資料（避開 Secret Service），只證明隱藏啟動時主視窗 realize 但不顯示、之後會出現，
  沒有證明隱藏期間 WebKit 頁面照常載入並啟動桌面便箋。Debian GNOME／Xorg 與 Pi labwc 實際登入時的 autostart。Pi 上需確認 labwc session 會處理 XDG autostart：
  `cat /etc/xdg/labwc/autostart ~/.config/labwc/autostart`、`pgrep -a 'lxsession|xdg-autostart|dex'`；若不處理，需改寫 labwc autostart。
  沒有獨立審閱。

## 2026-10-14 主視窗位置記憶與啟動行為：Windows 與共用介面

使用者指示依 ADR-043／044、SPEC-006 開工，兼顧 Windows、macOS、Linux（含 Debian GNOME／Xorg 與 Pi labwc）；不升版。
本節是 PLAN-006 Phase 1–3 的 Windows 與共用部分，Linux、macOS 另記。

- 共用：`host.info` 增加 `appVersion`、`distribution` 與 `capabilities.hostPreferences`／`updates`（目前 false）；
  新增 `host.preferences.get`／`set`／`openSystem` 與 `host.window.resetPlacement`，protocol 仍為 1。
  設定＞桌面新增「啟動行為」、「版本與更新」與「重置主視窗大小與位置」，只在主機支援時顯示。
  備份的 `appVersion` 改用 `host.info` 版本，原本一律記成 0.1.0。
- Windows：資料目錄的 `host-preferences.json`／`window-placement.json`（主機層級、原子寫入，損壞時用預設）。
  以 `GetWindowRect`／`SetWindowPos` 的實體像素保存與套用、兩次套用處理跨 DPI、以 `IsZoomed`／`IsIconic` 判斷狀態；
  從系統匣顯示前重新驗證；收到系統匣、結束、登出／關機時補寫。MSIX 宣告停用的 `WorkFleetStartup` StartupTask，
  App 依偏好 `RequestEnableAsync`／`Disable`，使用者或原則停用時不覆蓋並可開啟 `ms-settings:startupapps`；
  以 `AppInstance.GetActivatedEventArgs` 判斷登入啟動，登入啟動且未選開啟主畫面時先在畫面外載入、系統匣就緒後收起，
  系統匣不可用時顯示。「關閉主畫面時保留在系統匣」關閉後 X 會保存並結束。第二次啟動經每位使用者、每個資料目錄的
  named pipe 喚起既有實例，不再顯示「已開啟」錯誤。
- 測試：core probe 新增 31 項 host settings（含 `tests/fixtures/window-placement.json` 共用規則）；新 `--host-shell` UI probe 通過。
  `Test-WindowsNative.ps1 -SkipRestore` 完整通過，7 項 SKIP 是桌面測試區被其他視窗遮住或系統未授與前景。
  UI probe 的手動備份完成訊息在 `7a00fdd` 加入來源說明後就已不符，改為比對開頭；`npm test` 270 pass／12 skip／0 fail。
  `Test-WindowsPackage.ps1` 新增 StartupTask 檢查。
- 未驗證：登入啟動、隱藏啟動與 StartupTask 需安裝 MSIX 後由使用者登出再登入；混合 DPI 與多顯示器；沒有獨立審閱。

## 2026-10-14 所有桌面主機以遮罩調整

使用者要求進入調整模式前已最小化的主視窗結束後維持最小化，並要求有桌面分層的平台行為一致（ADR-042）；不升版。

- 主畫面在調整開始、遮罩出現前讀取 `document.hasFocus()`，只有有焦點時才要求 `desktop.mainVisible`，結束時只叫回它收起的主視窗；
  抽成 `src/desktop/overlay.js` 並新增 `tests/desktop-overlay.test.js`。Wayland 不提供最小化狀態，所以以焦點判斷。
- Linux X11（GNOME Xorg 與其他 X11）也使用遮罩；常駐層不變，只有 GNOME XWayland 仍只常駐桌布層。`tests/test_linux_surface.py` 改為新規則。
- Windows：`DesktopFrame` 解析 `operationScope`，調整中的最上層場景以整個 viewport 為輸入區域並在出現時啟用輸入視窗；
  回報 `adjustOverlay`／`residentLayers`，接受 `interaction.done`／`layout.arrange`；`desktop.mainVisible` 以 WPF 最小化並還原原本狀態。
  `SceneTransfersProbe` 加入調整範圍解析檢查。
- macOS：frame 解析 `operationScope`，調整中以覆蓋整個螢幕的 hit panel 轉送點擊，nonactivating 場景 panel 出現時成為 key window；
  回報 `adjustOverlay`／`residentLayers`，允許清單補上原本缺少的 `interaction.done`／`layout.arrange`；`desktop.mainVisible` 縮到 Dock 並展開；
  兩個 probe 補上新參數與 `operationScope`。
- Python documented discover 94 tests，9 skip／0 fail；`npm test` 272 pass／10 skip／0 fail；headless labwc probe 通過；文件檢查通過。
  Windows 與 macOS 的修改在 Raspberry Pi 上撰寫，這台沒有 .NET SDK 與 Xcode，**沒有編譯、沒有執行 probe、沒有實機驗證**。
  重裝 `7e5611e` 後在 Pi 5 labwc 以 `wtype` 送 Ctrl+Shift+1 經最上層、調整模式（停 5 秒）回到桌面層，主視窗先最小化到工作列、
  再收進系統匣各測一次，使用者確認兩次都沒有跳出來。X11 遮罩尚未實機確認；沒有獨立審閱。

## 2026-10-14 labwc 全域快捷鍵與 layer-shell 主視窗最小化

使用者在 Pi 5 labwc（經遠端桌面）回報：調整模式收起主視窗後位置與大小改變；焦點不在主視窗或主視窗最小化時快捷鍵無法切換層級。
選擇最小化並在叫不回時重新顯示，以及由 App 寫入 rc.xml（ADR-041）；不升版。

- headless labwc 實測：隱藏後再顯示的視窗被重新置中（290,148 → 230,124），大小保留；最小化後沒有輸入序號的 activation 叫不回。
  `surface.py` 新增 `step_aside`／`come_back`／`remap`：layer-shell 最小化並以 `present()` 經 xdg-activation 叫回，600 ms 未取得焦點則重新顯示。
- 這台的 portal（`xdg-desktop-portal-wlr` 0.7.1、`-gtk` 1.15）沒有 GlobalShortcuts。新增 `labwc.py`：從 `LABWC_PID` 的 cmdline 判斷 `-m` 與
  `--config-dir`，只改寫 rc.xml 中標記的區塊、寫入前後檢查 XML、第一次修改既有檔案前備份、原子替換後 `labwc --reconfigure`；
  非合併模式新建時複製系統 rc.xml。App 匯出 `shortcut` GAction，keybind 執行 `gapplication action <app id> shortcut "'<key>'"`。
  設定頁顯示 rc.xml 狀態與寫入按鈕；DEB 推薦 `libglib2.0-bin`。
- headless 驗證 `C-S-1`／`C-S-d`／`C-S-F5`／`C-A-0` 觸發、keybind 經 gapplication 把 `'Ctrl+Shift+1'` 交給 GTK Application，
  以及 `labwc -m` 下只含區塊的使用者 rc.xml 不影響系統 keybind。新增 `tests/test_linux_labwc.py`，並擴充 shortcuts、surface 與 JS 測試。
- 使用者在設定頁寫入後，這台的 rc.xml 新建並含 Ctrl+Shift+0／1／D／N（原本沒有檔案，沒有備份）。遠端桌面的連線端會攔截 Ctrl+Shift 組合，
  所以以 `wtype` 直接送進 labwc：Ctrl+Shift+D 兩次、Ctrl+Shift+1 三次（主視窗最小化、焦點在其他程式），`dbus-monitor` 記錄到對應的
  `ActivateAction("shortcut", …)`；使用者確認層級切換到最上層、進入調整模式並在 5 秒後切到桌面層，調整模式下 labwc keybind 仍有效。
  `Desktop.shortcut` 到 `desktop-action` 的路徑沒有自動化測試；快速記錄在其他程式有焦點時能否帶出主視窗未測；沒有獨立審閱。

## 2026-10-14 macOS 主視窗最小化時快捷鍵失效

使用者回報這台 macOS 27.0.1 的快捷鍵組合不論焦點在不在主視窗、或主視窗最小化都沒作用；在實體鍵盤重裝修正版後確認三種狀態都可以，要求 commit／push。不升版。

- 使用者原本經遠端桌面操作。合成資料測試工具顯示：測試視窗在前景時 WKWebView 收不到 `Control+Shift+D`，切到其他 App 時
  三組 Carbon 快捷鍵都註冊成功（OSStatus 0）卻沒有觸發，代表按鍵組合沒有經遠端桌面送到 Mac；這兩種狀態不是 App 的錯誤。
- 最小化與關到選單列是 App 的錯誤：`FleetShortcuts` 在 `NSApp.isActive` 或有 key window 時就釋放註冊，主視窗最小化或 orderOut 後
  App 仍在前景但沒有 key window，Carbon 已釋放、也沒有網頁接收按鍵。改為只在 App 在前景且有 key window 時釋放（`FleetShortcuts.suspends`）；
  App 不在前景時即使非啟用的桌面 panel 仍是 key 也保留註冊，文字編輯組合本來就不註冊。
- `SceneLayersProbe` 檢查五種狀態，修正後通過，換回舊條件失敗於最小化；以真實 AppKit 視窗程式化最小化、還原、orderOut，
  註冊依序為暫停、可用、暫停、可用。`docs/testing.md` 註明實際按鍵需在實體鍵盤測試。
- 作者檢查：`scripts/macos/test-desktop-layers.sh` 通過；`npm test` 269 pass／10 skip／0 fail；Python documented discover 84 tests，
  14 skip／0 fail；文件檢查與 `git diff --check` 通過。重建 DMG 後 `hdiutil verify`、唯讀掛載的 `codesign --verify --deep --strict`、
  主程式與 dylib 雙架構檢查通過。使用者在實體鍵盤確認主視窗在前景、其他 App 在前景、主視窗最小化三種狀態都可用；
  關到選單列只有自動狀態測試。沒有獨立審閱。

## 2026-10-14 macOS 桌面便箋無法拖曳

使用者回報這台 macOS 27.0.1 在「調整此組」等狀態拖不動便箋，游標有變化；正式 App 與合成資料測試工具都沒有移動跡象。
重裝修正版後確認正式 App 可以拖動，要求 commit／push。不升版。

- 可操作的紙面上各有一個透明輸入 panel，收到滑鼠後轉給場景 WKWebView。直接對 panel `sendEvent` 的合成拖曳完整通過
  （pointerdown／move／up 與 `pointer.*` 命令都送出），但使用者用真實滑鼠拖同一張合成紙面時，輸入 panel 一個事件都沒收到。
- 原因：透明 panel 的 `ignoresMouseEvents` 停在預設值時讀取為 false，WindowServer 卻讓點擊穿過完全透明的像素；
  `NSWindow.windowNumber(at:belowWindowWithWindowNumber:)` 只在明確設為 false 時回傳該視窗。macOS 桌面紙面的拖曳、按鈕與雙擊因此都落到下層。
- `FleetSceneSurface` 建立輸入 panel 時明確設定 `ignoresMouseEvents = false`。`SceneLayersProbe` 新增互動紙面的 WindowServer 點擊判定檢查，
  修正前失敗、修正後連續三次通過；`docs/testing.md` 註明合成事件不能取代此檢查。
- 作者檢查：`scripts/macos/test-desktop-layers.sh` 通過；`npm test` 269 pass／10 skip／0 fail；Python documented discover 84 tests，
  14 skip／0 fail；文件檢查與 `git diff --check` 通過。重建 DMG 後 `hdiutil verify`、唯讀掛載的 `codesign --verify --deep --strict`、
  主程式與 dylib 雙架構檢查通過。使用者只確認拖動；便箋按鈕、雙擊編輯與多螢幕未個別確認。沒有獨立審閱。

## 2026-10-14 pcmanfm 桌面不提供桌布層

使用者在 Pi 5 labwc 回報桌布層便箋蓋住桌面捷徑，要求修正或在此環境停用該層；比較把便箋畫進桌布圖片與停用後選擇停用，
也不仿照 GNOME 的 XWayland 設定開關。實機大致確認後要求提交；不升版。

- `pcmanfm-pi` 預設執行 `pcmanfm --desktop`，把桌布與捷徑畫在同一個背景 surface；`use_swaybg=1` 時改由 swaybg 只畫桌布、沒有捷徑。
  畫進桌布圖片需改寫使用者桌布設定、處理當機與重開機還原、桌布模式與多螢幕，且會把便箋內容寫成明文圖片，所以不做。
- `surface.py` 在 layer-shell 啟動時檢查同一使用者、同一 Wayland socket 的 `pcmanfm --desktop`，有則只建立桌面層與最上層，
  `wallpaperPlacement` 為 `unavailable`；只在啟動時偵測。群組設定的不支援層級寫明「這台電腦目前不支援，會顯示在…」。
  ADR-039 修訂，ADR-031、Linux README、setup、testing 與契約註解同步。
- `tests/test_linux_surface.py` 以假 `/proc` 測偵測（排除檔案管理員視窗、其他工作階段、沒有 Wayland 顯示的行程），
  並測 pcmanfm 桌面下沒有桌布層；各測試固定偵測結果，不受執行機器影響。Python documented discover 84 tests，9 skip／0 fail；
  `npm test` 269 pass／10 skip／0 fail；headless labwc probe 仍為三層並全部通過；文件檢查通過。
- 重裝後 App 的 WebKit 子行程由 4 個變為 3 個，沒有建立桌布層場景。使用者大致確認回退行為，另有待處理的問題；
  桌布偏好的便箋改在桌面層，仍位於捷徑上方。群組設定文字未在實機截圖確認；沒有獨立審閱。

## 2026-10-14 Pi 調整遮罩移動滑鼠後消失

裝上 layer-shell 調整遮罩後，使用者在 Pi 5 labwc 回報：遮罩出現後只要移動滑鼠，工具列、校準線與便箋就整片消失，
滑鼠仍被擋住，只能按 Esc 離開。上一筆的實機合成檢查沒有移動指標，所以沒有發現。實機確認修正後要求提交；不升版。

- headless labwc 以合成 GTK 指標事件重現：移入不會消失、移動才會；GTK 重畫救不回，強制 WebKit 整頁重畫可恢復。
  鍵盤改回 ON_DEMAND 仍消失，沒有遮罩時滑過常駐最上層便箋也消失，所以是 Pi 預設停用 DMA-BUF renderer 時 WebKit 原有的問題，
  遮罩讓整個螢幕都會觸發。常駐合成圖層、固定游標、停用硬體加速都無效；`WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`
  及完整 DMA-BUF 在 headless 移動滑鼠後畫面完整，移走的便箋也沒有殘影。
- `renderer.py` 改為 Pi／V3D 在使用者沒有設定任一 renderer 變數時預設 `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`，不再停用 DMA-BUF renderer。
  重裝後 App 的 WebKit 子行程確認帶此變數；使用者確認調整模式移動滑鼠後恢復正常，未回報黑塊、花屏或殘影。完整 DMA-BUF 未在實機重新驗證。
- `scripts/linux/test-desktop-layers.sh` 改用 Pi 預設的 renderer；probe 在調整此組後送出合成指標移入／移動並確認便箋與遮罩仍在，
  這項檢查在停用 DMA-BUF renderer 時失敗。`tests/test_linux_renderer.py` 改測新預設與使用者設定優先。
  Pi 上以系統 Python 執行 headless probe 四次：建置後第一次在調整此組時便箋尚未畫出就截圖而失敗，其後三次全部通過。
  Python documented discover 82 tests，9 skip／0 fail；`npm test` 269 pass／10 skip／0 fail；文件檢查通過。ADR-039 與 Linux README、testing 同步。
- 使用者另回報桌布層便箋蓋住桌面捷徑；這是 ADR-031 已記錄的 pcmanfm 限制（桌布與圖示同一 surface），本次未變更。沒有獨立審閱。

## 2026-10-14 macOS 上兩項既有測試失敗

使用者要求處理上一節記錄的兩項既有失敗。只改測試與文件，不改產品程式，不升版。

- macOS 圖層 probe：2026-10-05 撰寫時沒有 Apple SDK，從未在 Mac 執行。本機實驗顯示 WindowServer 非同步排序視窗，
  `orderFrontRegardless` 後立即讀取為 layer 0、不在螢幕上，`CATransaction.flush()` 後才是要求的 level；之後變更 level 要等 run loop 轉一圈。
  `SceneLayersProbe` 改為 flush 並等到視窗上螢幕且 level 相符（最多 2 秒）再檢查；macOS 27.0.1 連續三次通過，
  改成比對錯誤 level 的副本仍失敗於同一檢查。
- MSIX 版號測試：Node 以腳本的實際路徑（`/private/var/...`）推算 repo，而 macOS 的 `tmpdir()` 是 `/var` symlink，
  stage 因而被判定不在 `build/windows`。測試改在 `realpath(tmpdir())` 下建立暫存 checkout；腳本的路徑檢查不變。
- 作者檢查（macOS 27.0.1）：`scripts/macos/test-desktop-layers.sh` 通過；`npm test` 269 pass／10 skip／0 fail；
  Python documented discover 81 tests，14 skip／0 fail；文件檢查與 `git diff --check` 通過。沒有獨立審閱。

## 2026-10-14 macOS 加便箋後桌布整片變色

使用者在本機 macOS 27.0.1 安裝 universal 開發簽章 DMG 後回報加一張便箋整個桌布就變色；重裝修正版後確認看似正常，要求 commit／push。不升版。

- 桌面場景是覆蓋整個螢幕的透明 NSPanel，內含 WKWebView；macOS 的 WKWebView 預設在透明頁面下仍畫不透明底色，`underPageBackgroundColor` 不影響。
  沒有便箋時場景隱藏，出現便箋後整片底色蓋住桌布，圖示在更上層，看起來像桌布變色。Windows 已設 `DefaultBackgroundColor = Transparent`；
  調整遮罩只在主機回報 `adjustOverlay` 時出現，macOS 不回報，已排除。
- `FleetSceneSurface` 建立 web view 時關閉 `drawsBackground`；本機 WebKit 只有 `_setDrawsBackground:`，以 `responds(to:)` 保護，缺少時不拋例外。
  `SceneLayersProbe` 新增 `!web.isOpaque` 檢查，修正前失敗、修正後通過。
- `scripts/macos/test-desktop-layers.sh` 在本機（修正前的 HEAD 亦同）失敗於「WindowServer must apply the requested level」：probe 的視窗沒有上螢幕，
  回報 layer 0；暫時移除該項後其餘檢查含新檢查通過。這是既有 probe 問題，尚未修正。`node --test tests/apple-project.test.js` 5／5 通過；
  `npm test` 268 pass／10 skip／1 fail，失敗的 MSIX 版號測試在 macOS 暫存路徑（`/var` 與 `/private/var`）判定 stage 不在 `build/windows`，
  修正前的 HEAD 同樣失敗，尚未修正；文件檢查通過。
- 重建 DMG 後 `hdiutil verify`、唯讀掛載的 `codesign --verify --deep --strict`、主程式與 dylib 雙架構檢查通過；使用者重裝後確認看似正常。沒有獨立審閱。

## 2026-10-14 layer-shell 調整模式改為遮罩

使用者在 Raspberry Pi 5 的 labwc 要求把 GNOME 的調整遮罩（主視窗隱藏、浮動按鈕）也用於目前桌面；
選擇套用到所有 layer-shell 桌面，主視窗沿用隱藏而非最小化。不升版。

- `adjust_overlay` 對 `wayland-layer-shell` 也回報 true；`resident_layers` 改為只在 GNOME XWayland 限制為桌布層，layer-shell 維持三層。
  調整期間最上層 layer surface 改用 EXCLUSIVE 鍵盤模式（on-demand 要被點過才有鍵盤，`present()` 無效），結束後回到 ON_DEMAND。
  遮罩模式下不在調整範圍的最上層常駐便箋畫在遮罩下方。ADR-039 修訂，Linux README、setup、testing 與契約註解同步。
- `tests/test_linux_surface.py` 新增 layer-shell 遮罩、三層常駐、整個螢幕 input region 與鍵盤模式測試，新測試在舊程式失敗。
  headless labwc probe 在調整此組時另檢查 input region、EXCLUSIVE 鍵盤與遮罩染色；`check_trace.py` 接受 libwayland 1.24 的
  `wl_region#44` 格式，在 Pi 上以系統 Python 直接執行 10 個情境與 trace 檢查全數通過。
  Python documented discover 81 tests，9 skip／0 fail；`npm test` 269 pass／10 skip／0 fail；文件檢查通過。
- 在 Pi 5 labwc 實際桌面以合成 frame（不讀使用者資料）進入調整此組：最上層為 TOP 且鍵盤 EXCLUSIVE，工具列畫在 wf-panel-pi 上方，
  面板與桌布被約 35% 深灰染色，`wtype` 送出 Esc 不需先點即產生 `interaction.escape`；結束後鍵盤為 NONE、場景隱藏。
  完整 App 的主視窗隱藏／恢復、系統匣、堆疊／攤開／復原與範圍外最上層便箋的顯示尚待使用者實機確認；wayfire、多螢幕未測；沒有獨立審閱。

## 2026-10-13 X11 全域快捷鍵無法觸發

使用者在 GNOME Xorg（xrdp）回報主視窗縮到系統匣後 `Ctrl+Shift+D／N` 沒有反應；確認修正後要求 commit／push。不升版。

- Work Fleet 是唯一載入 Keybinder 的行程，焦點在其他視窗時預設組合都已全域登記；XTEST 送出 `Ctrl+Shift+D` 時測試視窗收不到 `D`，
  但桌面便箋不變。診斷紀錄顯示 Keybinder handler 從未被呼叫；`GDK_CORE_DEVICE_EVENTS=1`、關閉 NumLock 都無效，
  純 Xlib 抓取可收到 KeyPress。最小 Keybinder 程式在預設 cooked 比對下同樣不觸發，`set_use_cooked_accelerators(False)` 後立即觸發。
  cooked 比對把 Shift+字母轉成大寫並視 Shift 為已用，所以 Ctrl+Shift 加字母／數字只被攔截而不觸發；這是 X11 路徑原有的錯誤。
- `shortcuts.py` 在 `Keybinder.init()` 後改用 raw 比對。新增 `tests/test_linux_shortcuts.py`（假 Keybinder：先關 cooked 再登記、
  Ctrl+Shift 組合觸發動作、取得焦點時釋放），新測試在修正前失敗。Python documented discover 79 tests，10 skip／0 fail；
  `npm test` 269 pass／10 skip／0 fail；文件檢查通過。
- 重裝後以測試視窗取得焦點、XTEST 送出 `Ctrl+Shift+D` 兩次，桌布層場景依序隱藏與恢復；使用者確認焦點在終端機時 `Ctrl+Shift+D`、
  主視窗在系統匣時 `Ctrl+Shift+N` 都正常。XWayland 下 X11 鍵盤抓取仍收不到原生 Wayland 視窗的按鍵；沒有獨立審閱。

## 2026-10-13 GNOME Xorg 改用三層

使用者把 VM 改用 Xorg 登入（xrdp，`DISPLAY=:10.0`、`XDG_SESSION_TYPE=x11`）後同意實測；確認結果後選擇只改 GNOME Xorg，
其他 X11 桌面不變，並要求先 commit／push。不升版。

- 獨立視窗對照：keep-above 視窗取得焦點後終端機與主視窗仍可操作（XWayland 會鎖住）；DING 在 Xorg 是 X11 desktop-type 視窗，
  desktop-type 測試視窗在使用者點過桌面後被 DING 蓋住；一般視窗加 keep below 位於 Mutter BOTTOM 層，點過桌面後仍在 DING 上方且可點；
  對 desktop-type 視窗呼叫 lower 被忽略，啟動時仍在 DING 上方。
- GNOME 限制（只常駐桌布層、調整遮罩）改為只在 GNOME Wayland 工作階段（`XDG_SESSION_TYPE=wayland` 或有 `WAYLAND_DISPLAY`）套用。
  GNOME Xorg 提供桌布、桌面、最上層並可常駐：桌面層為一般視窗加 keep below，桌布層為 desktop-type（點過桌面前可能在圖示上方），
  最上層可取得焦點，調整模式不使用遮罩。ADR-039 再修訂，Linux README 與測試說明同步。
- `tests/test_linux_surface.py` 改為固定測試的工作階段環境，新增 GNOME Xorg 三層、視窗類型與焦點測試；新測試在舊程式失敗、修正後通過。
  Python documented discover 77 tests，10 skip／0 fail；`npm test` 269 pass／10 skip／0 fail；文件檢查通過。
- 重裝後在 Xorg 啟動，行程沒有 `GDK_BACKEND`，建立 UTILITY 最上層、NORMAL 桌面層與 DESKTOP 桌布層視窗；焦點在終端機時
  `Ctrl+Shift+N／D／0／1` 已被全域登記（未占用的對照鍵為空閒），未實際觸發。各層互動、調整模式、殘影與系統匣由使用者暫緩測試，尚未驗證；
  xrdp 啟動時 WebKit 有 `libEGL warning: DRI2: failed to authenticate`。本機 Xorg 登入未實測；沒有獨立審閱。

## 2026-10-13 GNOME Wayland 的 XWayland 選擇

從應用程式選單啟動時以原生 Wayland 執行，沒有桌面便箋；使用者要求設定選項，並在首次啟動偵測環境後以確認對話框建議改用 XWayland。
實機確認後要求 commit／push，不升版。

- 新增 `xwayland.py`：GNOME Wayland（session、`WAYLAND_DISPLAY`、`DISPLAY`、GNOME）偵測，資料目錄 `display-backend.txt`
  以暫存檔、fsync、rename 寫入；`host.py` 在載入 GTK 前依選擇設定 `GDK_BACKEND=x11` 並以 `WORK_FLEET_GDK_BACKEND` 標記，使用者自己的值優先。
- 尚未選擇且為原生 GNOME Wayland、沒有桌面呈現能力時，在開啟資料前以原生對話框詢問一次；選 XWayland 保存後直接 `execve`。
  設定「桌面」頁的開關與「立即重新啟動」先關閉設定，走一般關閉流程保存草稿、等資料鎖釋放後 `execve`；
  使用者設定 `GDK_BACKEND` 時顯示停用與原因；關閉流程進行中時忽略重新啟動。ADR-040 記錄，ADR-039 改為引用。
- 新增 `tests/test_linux_xwayland.py`（偵測、偏好權限與原子寫入、GTK 前套用、使用者優先、重新啟動移除自己的值、只問一次、資料鎖）；
  Python documented discover 74 tests，10 skip／0 fail；`npm test` 269 pass／10 skip／0 fail；文件檢查通過。
- 實機：刪除偏好後從圖示啟動，對話框選 XWayland，同一 PID 重新執行並帶 `GDK_BACKEND=x11`、標記，偏好檔 0600、目錄 0700。
  第一版設定頁的重新啟動被開著的設定對話框擋下（關閉流程拒絕開啟中的對話框），改為先關閉設定後，
  使用者確認 Wayland → XWayland → Wayland 切換正常，最後行程沒有 `GDK_BACKEND`。對話框、重新啟動與設定列沒有自動化測試；
  `--data` 非預設路徑、未儲存草稿時取消重新啟動、GNOME 停用 XWayland 未實測；沒有獨立審閱。

## 2026-10-13 Linux 啟動腳本優先使用系統 Python

使用者的終端機 PATH 上 `python3` 是 pyenv 3.15（沒有 GI 繫結），直接執行 `work-fleet` 會失敗；詢問靜態連結後同意改啟動腳本。不升版。

- Linux host 透過 PyGObject 使用發行版的 GTK／WebKitGTK／libsecret，沒有可靜態連結的編譯產物；
  改為自帶 Python 與 GTK／WebKit runtime 會大幅增加體積並需自行追 WebKit 安全更新，也違背 DEB 使用系統 runtime 的設計。
- `run-work-fleet.sh` 優先使用 `/usr/bin/python3`（DEB 依賴的直譯器），`WORK_FLEET_PYTHON` 可指定其他直譯器，
  沒有 `/usr/bin/python3` 的環境才使用 PATH 上的 `python3`。
- 完整 `--deb` 整合測試執行產生的啟動腳本，確認優先順序與參數傳遞；未修正版本失敗、修正後通過。
  Python documented discover 66 tests，10 skip／0 fail；`npm test` 269 pass／10 skip／0 fail；文件檢查通過。
- 重裝後在 PATH 為 pyenv 3.15、未設定 `PYENV_VERSION` 的環境以 `GDK_BACKEND=x11 work-fleet` 啟動，行程為 `/usr/bin/python3.10` 並正常開啟。沒有獨立審閱。

## 2026-10-13 GNOME 調整模式改為遮罩

GNOME 最上層實測會鎖住其他視窗；使用者定義桌面層與最上層都包含焦點，選擇群組只常駐桌布層，
並要求保留調整模式：遮罩覆蓋桌面、主視窗隱藏、浮動「完成、堆疊、攤開、復原」。實機確認後要求 commit／push，不升版。

- 證據：群組設為最上層或進入調整模式後，終端機與主視窗無法操作，最上層隱藏或 App 結束後恢復，鍵盤仍可輸入其他程式；
  input shape 只有便箋範圍，沒有 X 獨占或 XDND。獨立 keep-above XWayland 視窗不取得焦點時正常，取得焦點即鎖住
  （bounding shape、NORMAL 類型、把焦點交給主視窗皆無效）；App 的最上層永不接受焦點時調整模式仍鎖住，改用 DMA-BUF 亦同，原因未判定。
- GNOME X11 建立桌布與最上層場景，`residentLayers` 只有桌布；`adjustOverlay` 時最上層在調整模式顯示於每個螢幕、
  以整個工作區為 input region、約 35% 深灰遮罩並 present 取得焦點。遮罩工具列送出 `interaction.done` 與
  `layout.arrange`（stack／spread／undo，保持尺寸套用到調整範圍）。主視窗在遮罩畫面發布後隱藏、去掉遮罩後恢復，
  並還原位置、大小與最大化；詳細資料、完整編輯器與快速記錄先結束調整模式。快捷鍵略過不能常駐的層且進入調整時不改寫常駐層。
  frame 欄位不變，Windows／macOS 不受影響；ADR-039 第三次修訂。
- 新增 Linux 遮罩 input region／present／info、視窗位置還原，共用投影常駐層回退、遮罩指令與快捷鍵測試；
  新測試在 HEAD 失敗、修正後通過。Python documented discover 66 tests，10 skip／0 fail；`npm test` 269 pass／10 skip／0 fail；文件檢查通過。
- 實機（Ubuntu 22.04 GNOME Wayland、`GDK_BACKEND=x11`）：記錄顯示調整時主視窗 unmapped、最上層 input `(0,0,954,741)` 且 FOCUSED，
  完成後主視窗恢復並保留最大化。使用者確認遮罩、工具列、堆疊／攤開／復原無殘影、Esc 與「⋯」路徑；
  位置還原修正後重裝並要求 commit。工具列、遮罩與主視窗隱藏沒有自動化測試；多螢幕、Xorg 工作階段與 App 卡住時的行為未實測；沒有獨立審閱。

## 2026-10-13 Linux 透明場景殘影與 DMA-BUF 預設

使用者回報經 XWayland 拖曳或堆疊、攤開、復原後，移走的便箋在原處留下殘影；確認修正後要求先單獨 commit／push。不升版。

- 擷取場景視窗本身即可見殘影，強制整窗重畫後消失，屬 App 端重畫。獨立透明 WebKit 視窗移動一張便箋可重現：
  `WEBKIT_DISABLE_DMABUF_RENDERER=1`（ADR-031 的 Linux 預設）留下殘影，在視窗或 WebView draw 先清成透明無效；
  不設定或設為 `0` 改用 DMA-BUF 時沒有殘影。使用者以 `=0` 啟動 App 確認堆疊／攤開／復原及調整模式拖曳都沒有殘影。
- 新增 `renderer.py`：只有 device-tree model 含 Raspberry Pi 或存在 `/sys/module/v3d` 時才預設停用 DMA-BUF，
  host 在 import WebKit 前決定，使用者的明確設定仍優先。ADR-039 記錄並更新 ADR-031 的預設。
- 新增 `tests/test_linux_renderer.py`（假檔案系統）；host 判斷順序的測試在舊 host 失敗、修正後通過。
  此 commit 的獨立 worktree：Python documented discover 62 tests，10 skip／0 fail；`npm test` 266 pass／10 skip／0 fail；文件檢查通過。
- 重裝含新預設的 DEB 並以未設定該變數的環境啟動，確認行程環境沒有覆寫；新預設下的畫面由使用者另行確認前，以 `=0` 的實測為證據。
  Pi、其他 GPU／驅動與非 GNOME X11 未實測；沒有獨立審閱。

## 2026-10-13 GNOME 桌面圖示下的層級對應

使用者回報經 XWayland 時桌面層看得到但無法選字、原生 Wayland 沒有群組層級設定，並在無法解決時選擇當作桌布層；同意 ADR-039 計畫。

- GNOME Shell 42.9 沒有 layer-shell（`GtkLayerShell.is_supported()` false），原生 Wayland 回報 `desktop-unsupported`，
  所以沒有桌面便箋與層級選單。XWayland 下 DING 以透明一般視窗覆蓋桌面並在被提升時降到最底，desktop-type 視窗位於其下，
  便箋可見但點擊由 DING 接收；依 Mutter 層級與 DING 原始碼推得，X11 工具看不到 Wayland 視窗。
- `XDG_CURRENT_DESKTOP` 含 GNOME 的 X11 只提供桌布層與最上層；桌布為 keep below 的 desktop-type 視窗，`wallpaperPlacement: desktop-window`。
  共用投影接受沒有桌面層，桌面偏好回退桌布且不可互動、拖曳或編輯，保存的偏好不改寫；快捷鍵略過缺少的層，
  群組設定停用不可用層，回退說明依方向，快捷鍵說明顯示本機循環。ADR-039 記錄決策並更新 ADR-031。
- 新增 GNOME 層級、desktop-type keep below、拒絕桌面層的 Linux 測試，以及無桌面層的投影回退與快捷鍵測試；未修正版本失敗、修正後通過。
  Python documented discover 58 tests，10 skip／0 fail；`npm test` 266 pass／10 skip／0 fail；文件檢查通過。
- 重裝後預設桌面層的群組顯示於 desktop-type 視窗 `954x741+70+27`，便箋位置正確，啟動紀錄無錯誤。
  桌布點擊穿透、設定提示、選項停用與最上層選字尚未由使用者逐項確認。
- 未解決：群組在最上層時使用者無法點選其他程式、主視窗無法拖曳／縮放，結束 App 後恢復；當時最上層視窗已隱藏、桌布 input shape 為空。
  獨立 XWayland probe 顯示 GNOME 遵守 X11 input shape，原因仍在調查。調整模式拖曳殘影仍存在。
  GNOME Wayland 圖示啟動仍需手動 `GDK_BACKEND=x11`；Xorg 工作階段未實測。沒有獨立審閱。

## 2026-10-13 Linux X11 場景尺寸與工作區位置

使用者在 Ubuntu 22.04 GNOME Wayland 以 `GDK_BACKEND=x11` 經 XWayland 啟動後，桌面便箋被裁切；不升版，修正後 commit／push。

- `xwininfo` 顯示螢幕 1024×768 時兩個場景視窗都是 200×200，擷取最上層只剩便箋左上角。場景視窗不可調整大小，
  GTK 3 依 size request 定尺寸而忽略 `resize()`；ADR-031 只在 layer-shell 設 size request，X11 現在也設定。
- 補上後最上層成為 `1024x768+0+27`：Mutter 把一般視窗上緣推到頂部工作列下，便箋低 27 像素。
  X11 場景 viewport 改用 GDK 工作區（`_NET_WORKAREA` 70,27 954×741），layer-shell 仍涵蓋整個螢幕。
- 重裝後兩個場景視窗都是 `954x741+70+27`，desktop-type 視窗也落在要求位置；擷取的便箋位於螢幕 (70,76)，與保存位置一致。
- 新增 `tests/test_linux_surface.py` 以假 GI／cairo 驗證 X11 size request、換顯示器更新及工作區 viewport；未修正版本失敗、修正後通過。
  此 commit 的獨立 worktree：Python documented discover 54 tests，10 skip／0 fail；`npm test` 264 pass／10 skip／0 fail。
  多螢幕、Dock 自動隱藏與非 GNOME X11 桌面未實測；沒有獨立審閱。

## 2026-10-13 Linux 安裝 GTK 4 typelib 時無法啟動

使用者在 Ubuntu 22.04 x64（GNOME Wayland）以既有 `build-native-app.sh --deb` 建置並安裝 0.1.0 DEB，點選圖示後沒有視窗。
不升版；本輪只修正啟動並 commit／push。

- `journalctl --user` 顯示 host 一啟動即 `Requiring namespace 'Gdk' version '3.0', but '4.0' is already loaded`：
  系統另裝 `gir1.2-gtk-4.0`，host 只固定 Gtk 3.0，先 import 的 Gdk 解析成 4.0。沒有 GTK 4 typelib 的機器不受影響。
- host.py 與同樣寫法的 surface.py 在 import 前固定 Gdk 3.0；系統 Python 3.10 匯入整條 host 模組鏈成功，Gdk／Gtk 皆 3.0，GtkLayerShell 可用。
- 新增 `tests/test_linux_gi_versions.py` 以 `ast` 檢查固定 Gtk 3.0 的模組先固定 Gdk 3.0；未修正版本確認失敗、修正後通過。
  Python documented discover：52 tests，10 skip／0 fail；`npm test` 264 pass／10 skip／0 fail；文件檢查通過。
- 重建 DEB 後以 `dpkg -i` 覆蓋安裝，桌面圖示啟動的 host 程序持續執行、未再出現 traceback。
  GNOME AppIndicator 記錄一次 `unable to update icon`，系統匣、金鑰圈、Google 與桌面場景未逐項驗收；
  `run-work-fleet.sh` 以 PATH 的 `python3` 啟動，pyenv 終端機會選到無 GI 的直譯器，尚未處理。沒有獨立審閱。

## 2026-10-12 本機完整還原與 Google 同步後匯出

使用者確認本機與 Google 都需備份／還原，格式相容並可雙向遷移；本機洗掉舊內容時不強制先備份，授權按最佳實踐實作。
沿用 Windows 0.1.2，完成本輪後直接 commit／push；不升版、dispatch Actions 或修改既有 release。

- 新增「清空本機後，從備份還原」：完整驗證、綁 profile／revision、預覽清除範圍及永久取代確認。
  舊資料備份可選，不需先重設；相同 ZIP 保留原身分、全部歷史、草稿、附件與備份版面，deviceId 留在目標裝置。
  工作空間、receipt 與完整附件集合同一 CAS 交易取代，成功後切換 graph／LayoutStore；舊內容不留在刪除區。
  空附件備份也清除舊附件；交易中止、過期／錯分區／取消保留原資料，原生失去回應以完整持久 bytes 讀回確認。
- SQLite／IndexedDB 附件替換限定目前本機分區，禁止 Google／journal 全量替換；其他分區與自動備份設定保留。
  完整還原前停止自動備份並等待閒置，成功／失敗恢復排程；僅有瀏覽器下載能力也可選擇備份舊內容。
  原有三種模式及 Google 全量覆蓋的安全備份規則維持；MSIX 更新／解除安裝政策不變。
- 手動 Google 匯出先同步；失敗／尚有待同步內容時不保存，使用者可明確選擇只備份本機已知副本。
  取消不保存；備份頁顯示來源／目標、最後同步及 pending／草稿／衝突資訊。
  FileSync 原先未寫入成功時間，補上完整 pull／push／pull 且 outbox 空時持久記錄，失敗保留上次時間。
  本機／Google 同格式 ZIP 四方向回歸通過；下載 Google ZIP、切換本機後還原可專門離線使用，不回寫來源 Google。
- `npm test` 262 pass／12 skip／0 fail；備份／同步集中回歸 48／48。
  Python documented discover：50 tests，11 skip／0 fail；新增 Linux 儲存測試在真 SQLite 驗證替換／空附件／回滾／CAS／分區隔離，
  Windows 只替換 fcntl import 與 crypto fixture，不作 Linux GUI／金鑰圈證據。
- Release app／core／UI probe 建置 0 警告／0 錯誤；原生 core／檔案／coordinator／場景 36／36。
  `WORK_FLEET_NATIVE_TEST=1`、`WORK_FLEET_NATIVE_TEST_CONFIGURATION=Release` 的真 native bridge 回歸 12／12，
  含本機完整還原後附件清除、草稿／新 graph、遺失 commit 回應及 receipt 重試。
- 真 Edge 的完整主畫面 restore-ui、local-backup-ui 及 cloud-restore-ui 三個隔離探針通過；
  OPFS／IndexedDB 實際保存、完整還原與重啟、舊備份可選、確認失效、Google 同步匯出／明確副本選擇／取消皆驗證。
  Google transport 為合成 FileStore，沒有啟動或修改真 Work Fleet 資料／套件；沒有新增憑證或信任操作。
- ADR-038、SPEC-002、PLAN-005、型別契約、需求／架構／Google／設定／測試說明同步；文件、UTF-8／LF、secret／scope 與 diff 檢查通過。
  本機 Google project／Windows client 尚缺，真 Google／原生場景完整操作、Apple／Android SDK 編譯與 Linux GUI 未驗收；沒有獨立審閱。
  提交後以既有本機憑證重新打包；產物資訊僅回報對話，不再補打包紀錄提交。

## 2026-10-12 MSIX 本機資料政策與 Google 全量備份覆蓋

使用者確認解除安裝清除全部本機資料，並明確選擇「先清空 Google 的所有 Work Fleet 資料，再還原備份」。
本輪完成程式、回歸與文件，沿用 0.1.2，不升版、dispatch Actions 或修改既有 release。

- MSIX 明確使用套件的 LocalCache/Local/WorkFleet，保持目前私有 SQLite／WAL 位置；所有帳號、設定、憑證與 WebView2 cache 在同資料區。
  ZIP／未封裝 Debug 保留原獨立目錄；不自動搬移或刪除舊資料，空白 MSIX 找到外部舊 DB 時提示匯出／匯入。
  更新保留，解除安裝清除套件資料，已匯出 ZIP 與 Google 雲端保留；備份頁加入 Windows MSIX 提醒。
- 新增「清空 Google 後，從備份還原」：先同步及驗證輸入，預覽綁定帳號／revision，成功保存目前資料安全 ZIP 並勾選清空確認後才能執行。
  完整新 Workspace／附件與工作同交易落盤，再寫雲端重設標記並清空 appDataFolder，最後上傳備份。
  reset／upload 階段持久保存，失敗／重啟提供續行；上傳重試不再次清空、回應遺失重用 file ID。
  備份草稿只在本機還原；舊工作區草稿留在安全 ZIP。原有三種模式保持歷史與草稿語意。
- 清空階段拒絕普通同步，預覽期間暫停背景同步；換檔案／模式後清空確認失效。
  既有瀏覽器探針暴露舊成功訊息被當成新保存完成的時序問題，作業開始即更新狀態後回歸通過。
- `npm test` 254 pass／11 skip／0 fail；雲端覆蓋、備份還原及同步集中回歸 40／40。
  Python documented discover：47 tests，11 skip、0 fail（含 Windows MakeAppx 包回歸 9／9）。
  真 Edge／IndexedDB／OPFS 的原有 restore-ui 與新增 cloud-restore-ui 探針通過；使用合成 FileStore，不連 Google。
- Release app／core／UI probe 建置均 0 警告／0 錯誤；原生 core／備份檔案／coordinator／場景傳輸 35／35。
  未封裝資料路徑只讀探針通過；23H2 上獨立 `app.workfleet.storageprobe.*` MSIX 實際寫入私有區、解除安裝刪除及外部匯出留存通過，測試套件已移除。
  沒有啟動／解除安裝／修改真 Work Fleet 套件或其資料，也沒有變更憑證信任。
- ADR-037、PLAN-005、SPEC-002、需求、設定／Google／封裝／測試說明及未來 workflow 安裝文案同步；ADR-032 資料共用要求改由新政策取代。
  本機 Google 設定仍缺，真 Google、完整原生主畫面失敗續行、實際產品更新及其他 Windows 版本未驗收；沒有獨立審閱。
  提交後使用既有本機憑證重新打包，產物資訊僅回報對話，不另補打包紀錄提交。

## 2026-10-10 Windows 預設 self-contained 封裝

使用者明確授權先修改文件及預設打包腳本、commit／push，再以既有本機憑證打包。
沿用 Windows 0.1.2，不升版或觸發 GitHub release；既有 windows-v0.1.2 產物保留原 framework-dependent 內容。

- 打包入口改成 win-x64／self-contained，App build 入口新增對應的 restore／build 選項。
  app／core 的 RID restore targets 與 lockfiles 同步；一般 Debug／IDE 及 probe 建置仍 framework-dependent。
- .NET Core／Desktop runtime patch 固定 8.0.31，採分別設定 FrameworkReference metadata。
  最初全域版本設定使 Windows SDK targeting pack 出現 NU1505，已修正；兩種 app 建置最後均為 0 警告／0 錯誤。
- 包檢查補內附 runtime／WPF files、runtimeconfig 的 includedFrameworks、拒絕 shared runtime 需求、win-x64 deps 與 notices。
  Windows 合成 MakeAppx 回歸 9／9、版號與封裝 JS 5／5 通過；合成 DLL 不執行，不作未裝 .NET 實機證據。
- 保留 Core runtime 完整 license／第三方 notices、Core／Desktop runtime pack nuspec 及官方 Desktop／WPF／WinForms notices。
  ADR-036 與 setup／deployment／testing／Windows README／未來 release 安裝說明同步。
- 一般 app 與兩個 probe 專案的 locked restore 通過；self-contained restore 及 Release metadata 核對 Core／Desktop 8.0.31。
  文件檢查 110 份 Markdown／648 相對連結、UTF-8／LF、PowerShell 語法與 diff 檢查通過。
  未執行 GUI probes 或安裝 App；沒有獨立審閱。commit／push 後本機包結果只回報於對話，不補發布紀錄提交。

## 2026-10-10 發布流程收尾界線調整

使用者在 0.1.2 發布後要求調整流程，避免 agent 再補 commit／push 而於未來觸發 push 型 CI。
此為新的流程修改任務，不延續前一輪發布收尾授權。

- AGENTS、Agent Guide 與 deployment 統一要求：程式、測試與文件紀錄先完成，再做最後一筆升版 commit／push。
  dispatch 後本輪不得再修改 tracked files、commit 或 push；GitHub 與對話保存事後發布結果。
- 明確處理 PROGRESS／handoff 更新與 standing commit／push 授權的例外，避免被誤用為事後補交的理由；後續 repo 修改需新的使用者任務。
- 核對現有兩個 workflow 皆只有 workflow_dispatch；0.1.2 發布後的 `c3daddc` 沒有對應 Actions run。
  文件檢查 109 份 Markdown／639 相對連結、UTF-8／LF 與 diff 檢查通過。
  本輪只改流程文件，沒有升版、改 workflow 或 dispatch Actions；沒有獨立審閱。

## 2026-10-10 Windows 23H2 使用者測試回報與 0.1.2 預覽發布

使用者回報「23H2 似乎可以，目前沒看到特別問題」，並明確同意升到 0.1.2、觸發 GitHub preview release。
此回報只記錄本機使用者測試結果，不代表其他 Windows 11 版本或完整手動矩陣通過。

- Windows 單一版號紀錄升到 0.1.2，MSIX identity／產物檔名沿用既有衍生機制；不改其他平台版號。
- 發布 workflow 說明更正為 Windows 11 最低 build 22000，與既有包 manifest 一致。
  交付包含先前拖曳／frame transition 與附著場景相容性修正；原始白塊根因未在隔離案例重現。
- 0.1.2 的 tag／release 在發布準備時尚不存在；升版 commit `9b421b7` 已 push main，
  只 dispatch 一次 `windows-preview.yml`。[run 37970102714](https://github.com/sammykenny2/desktop-work-fleet/actions/runs/37970102714)
  的測試、建置／簽章與發布三個 job 均成功，已建立 [windows-v0.1.2 prerelease](https://github.com/sammykenny2/desktop-work-fleet/releases/tag/windows-v0.1.2)，
  tag 指向相同 commit，附 MSIX、SHA256 與公開 CER；下載後雜湊與最終包 identity／安裝下限核對通過。
- 本機 `npm test`：247 pass、11 skip、0 fail；版號讀取與 MSIX manifest 核對為 0.1.2／0.1.2.0、
  x64、Windows.Desktop 下限 22000／MaxVersionTested 26200。文件檢查 109 份 Markdown／638 相對連結、UTF-8／LF 與 diff 檢查通過。
- 沒有獨立審閱；先前原生回歸證據見下節，本輪沒有修改 runtime 或重跑 GUI probes。

## 2026-10-09 恢復實機測試與附著場景相容性修正

使用者明確表示「我沒使用電腦了，你可以測試或截圖」，解除先前限制。
只以隔離資料與自有測試便箋驗證，沒有操作或修改正在執行的安裝版與其資料。

- `8ec8413` 的 NOREDIRECTIONBITMAP 在 23H2 WPF 視窗初始化被拒絕，Win32 error 87，已撤回；
  保留 HWND／原、目標及實際 style 診斷，不吞掉 OS 錯誤。透明 windowed WebView 的真螢幕顏色
  也變暗，恢復原白色背景；floating composition 仍透明，WPF 背景／NOCOPYBITS／hide 順序保留。
- 兩種仿 Explorer 宿主的移位、縮高、展開與新紙面仍可見時的舊位置／邊緣還原已通過。
  仿宿主另以自有 GDI BLACK_BRUSH backdrop 作基準，避免把背後應用誤作黑色背景。
  空白 WPF 背景窗曾有命中但未繪製，讀到終端 `(12,12,12)`；系統 Static 黑矩形實際為主題色 `(105,105,105)`，
  都被原零像素前置條件拒絕。固定 black brush 後兩種宿主通過，沒有放寬判斷或改使用者主題。
- 真 Explorer 桌面／桌布層以整個 monitor scene 尺寸反覆移位與縮高；紙面顏色、舊中心／邊緣與 hide
  還原通過。新增 composed-screen 裁切圖，而非只用 browser preview 判定背景正確。
- 新增實際 owner formation probe，接入 `Test-WindowsNative.ps1`：兩張隔離便箋經真 client／bridge／owner
  保存合成 PointerEvent 調整位置，再按主畫面堆疊／攤開。桌面、浮動排列後返回桌面及桌布層案例通過；
  每步逐像素核對原背景，非取樣點間隔，PNG 確認還原。浮動模式只排除實際標籤／圓角邊框帶，保留區域內背景檢查。
  前景判定鎖定六個便箋 HWND 與 browser，排除主畫面／framework helper；後者初始化也曾產生 foreground 事件，
  不把 presentation 檢查擴張成整個 owner 程序永不得啟用。測試工作區僅注入 fixture，native scene 仍是實際整個螢幕尺寸。
- 安裝版 assembly 與 Assets 複本在隔離案例也通過：表面幾何及實際 owner 案例均不能重現原白塊。
  因此不能宣稱使用者問題根因已證實或已完全修復；原始工作空間與實體快速滑鼠仍待使用者驗收。
- JS 相關回歸 78／78 通過。完整原生回歸第一次在 wallpaper 最後 foreground 比對失敗：
  before TeamViewer HWND 仍存活、after 是 Windows Terminal。補全程前景事件後抓到短暫自有啟用，
  發生於探針將同一 windowed child 改成浮動 popup 的人工路徑，安裝版複本同樣失敗。
  探針改用產品實際的獨立 composition floating surface 後，切層與全程不啟用檢查通過；保留失敗證據。
  同次此前的 core、11 項 JS→native、UI／prepare／IME／close、composition capture／region、platform 全通過。
- 最後 `Test-WindowsNative.ps1 -SkipRestore` 完整通過：core、11 項 JS→native、UI／prepare／IME／close、
  composition capture／region、platform、真 Explorer、兩種黑底仿宿主、實際 formation 及 Debug diagnostics。
  正向 foreground grant 小項因 OS 未授權而 SKIP，null intent 拒絕通過；此前同輪有授權時也通過。
  Native foreground observer 與實際 formation 背景檢查沒有 SKIP。文件、PowerShell 語法與 diff 檢查通過。
- 電腦操作工具因 native pipe 無法連線而未使用；沒有送真滑鼠／鍵盤。合成 DOM／WPF 回歸不代替實體快速拖曳。
  沒有獨立審閱，作者測試不是獨立審閱。沿用 0.1.1，以既有本機憑證與打包 SOP 交付；
  最終產物路徑、大小、hash 與包檢查結果回報於對話。沒有升版、Actions dispatch、tag 或 release。

## 2026-10-09 堆疊／攤開後舊位置白塊再修正（恢復測試前紀錄）

下列保留 `8ec8413` 編譯／未測的歷史狀態；目前修訂與恢復測試證據以上節為準。

使用者安裝上一輪 `9dbd201` 的本機包後確認殘影仍在，新的最小重現不需要拖曳：
調過位置的 note 經堆疊／攤開移動，黑色桌布在舊位置留下白塊。上一輪提前 hide／非同步重畫未解決。
使用者回憶先前 1.0.1／25H2 不會發生；該歷史包未核對，不宣稱 OS 差異根因已證實。

- 附著宿主改採自有 HWND `NOREDIRECTIONBITMAP` 與 child/sibling clipping，WebView／WPF 底色透明；
  便箋仍由頁面繪製，不填黑色、改桌布或變更 Explorer styles。浮動 composition 路徑保留。
- 附著 input HWND 的位置／region 更新停用舊 client pixels 複製。Hide 先保留 region 撤下兩面，
  再要求 parent invalidation，最後清空 region；dispose 也先 hide。不加入同步 Explorer paint 等待。
- 仿宿主回歸從白底改黑底，補有／無 redirection、無拖曳的移位／縮高／攤開式變更，
  逐次比對新紙面、舊位置與收起後背景，避免原白底的假陽性。回歸是表面幾何檢查，實際 formation 待驗收。
- [ADR-035](docs/decisions/035-windows-attached-scene-background-lifecycle.md) 記錄方向與限制。
  使用者「不要測試及截圖」仍有效：沒有執行任何測試、probe、截圖或操作安裝版；沒有獨立審閱。
- `Build-WindowsPackage.ps1 -SkipRestore -LocalTestSign` 已完成本機 0.1.1 Release 編譯與封裝，
  0 警告／0 錯誤，腳本內建 SignTool 簽署／本機信任驗證成功。產物路徑、大小與 SHA256 回報於對話。
  沒有執行 Test-WindowsPackage／runtime 測試、升版、dispatch Actions 或發布 release；殘影效果待使用者實測。

## 2026-10-09 Windows 拖曳回彈與附著白色殘影修正

使用者已安裝本機簽署的 0.1.1，回報最上層快速拖曳被拉回原位，左上角舊位置留下白色便箋形狀。
授權直接修正及本機打包，隨後明確要求要使用電腦，繼續改 code 但不要測試及截圖。

- 停止要求之前：唯讀畫面確認白塊；新增捕獲檢查後執行修正前 composition probe，
  在缺少 native mouse capture 處 FAIL。仿 Explorer 宿主 hide／背景檢查 PASS，不能作真 Explorer 殘影通過證據。
- 浮動 WebView 補 WPF mouse capture，左鍵放開／hide／topology 暫停／dispose 解除，意外失去捕獲向場景發出取消。
- `pointer.up`／`pointer.cancel` 先等最新 geometry 發布才回覆；refresh 等待進行中的讀取與後續新 frame，
  放開後保留最後位置預覽，直到新畫面 applied，避免過期投影先復原舊位置。
- Windows 以選填 `prepareFrames`／`scene.prepare` 在附著紙面 geometry 改變時先隱藏舊表面，
  再移除／搬動 DOM；hide／dispose 請原 Explorer parent 重繪，不改桌布設定。白塊根因及修正效果仍待實機確認。
- 已補 JS 發布屏障／refresh 排程，以及 native 捕獲／解除／prepare 順序／背景還原回歸。
  依使用者停止要求，修改後所有新增與既有測試、截圖、使用者安裝版操作均未執行；沒有獨立審閱。
- 本輪交付沿用 Windows 0.1.1、既有本機憑證及打包 SOP，不升版、不 dispatch Actions、不發布 release。
  `Build-WindowsPackage.ps1 -SkipRestore -LocalTestSign` 已完成，Release 編譯 0 警告／0 錯誤，
  腳本內建 SignTool 簽署與信任驗證成功；沒有執行 Test-WindowsPackage 或 runtime 測試。
  產物路徑、大小及 hash 回報於對話；同版號安裝與上述互動修正效果待使用者有空驗收。

## 2026-10-09 Windows 11 23H2 原生驗證與安裝下限實作

使用者在本專案授權開工，確認本機是 23H2，完成後可共同手動測試。沿 PLAN-004 先驗證原生，再修改封裝。

- 23H2 build 22631.6199、單顯示器 144 DPI、WebView2 154.0.4258.62；Node 24.21.0、Python 3.13.7、.NET SDK 9.0.318，App target 仍 .NET 8。
  開始時沒有 WorkFleet 實例；隔離 probes 不讀寫 `%LOCALAPPDATA%\WorkFleet`。唯讀 Explorer 盤點、完整原生基線均通過，無需重寫 renderer／SetParent／DPI 路徑。
- MSIX `Windows.Desktop MinVersion` 從 26100 改為 22000，保留 MaxVersionTested 26200、framework API 基線與版號 0.1.1。
  manifest 產生回歸與最終包檢查都核對 device family、下限、MaxVersionTested、x64 與版號。
- 原生宿主查詢抽成內部測試介面，發現／選擇／有界建立與存活語意不變；新增同一演算法的 classic／modern、
  圖示搬移、PID／隱藏／錯誤宿主／疊序、缺失、建立後重查、健康不重掛與失效重建回歸。
- 探針修正：真螢幕 FAIL 現在傳播成非零退出；浮動視窗以自有 HWND 識別，避免把自己誤判為外部遮擋。
  第一次修改後完整回歸曾在 composition passive hit 失敗，當時未捕獲命中 HWND，原因未確證；單獨重跑通過。
  composition probe 補 coordinator 已有的 render popup 穿透政策與失敗 HWND／class／PID 診斷後，最後完整回歸通過；未據此改產品輸入政策。
- `Test-WindowsNative.ps1 -SkipRestore` 最後完整通過：35 項 core／備份／scene checks、11 項 JS→native、UI／composition／platform／wallpaper／host-check／diagnostics。
  真 Explorer 的桌布→桌面→浮動→桌布螢幕像素均 PASS；parent／WS_CHILD／非 topmost、region、physical bounds、切層及仿宿主初次啟動通過。
  OS 未授予最後一次 UI probe foreground，正向授權該項 SKIP，拒絕檢查通過；前一次 UI probe 有授權通過。這不是實體滑鼠／IME 驗收。
- 共用檢查：`npm test` 243 pass、11 skip；原有 Python discovery 38 項，27 pass、11 skip（Windows 缺 Linux 工具／fcntl）；
  新增 `test_windows_package.py` 5／5 pass。後者以真正 MakeAppx 容器測拒絕錯誤下限、family／tested version、版號、環境／私鑰檔及未簽章模式；不執行 fixture。
- `Build-WindowsPackage.ps1 -SkipRestore` 成功，Release 無警告／錯誤，既有 Debug-only CDP 字串門禁通過。
  `Test-WindowsPackage.ps1 -PackagePath build/WorkFleet-0.1.1-x64.msix -Unsigned` 通過實際內容與簽章參數拒絕檢查。
  本機沒有既有 preview code-signing 憑證，MSIX 未簽章；新增明確 `-Unsigned` 內容檢查，預設仍要求可信簽章。
  交付 `build/WorkFleet-0.1.1-x64.zip` 供解壓執行；沒有安裝 App、修改信任、升版、dispatch／tag／release 或 Store 提交。
- 文件檢查通過：108 份 Markdown、627 個相對連結、UTF-8／LF、`git diff --check` 與變更腳本語法檢查；setup／deployment／Windows README、需求及接手入口已同步。

待使用者驗收：正常資料先備份並關閉舊實例，再測第一次顯示／黑塊／圓角、群組／All 浮動／退出、
拖動／編輯／唯讀選字、圖示及空白／桌布穿透、關閉重開與 Win+D。23H2 MSIX 安裝因缺簽章未測。
21H2／22H2／24H2／25H2+ 改動後實機、Windows 10 安裝拒絕、混合 DPI、Explorer 真重啟、休眠／喚醒與虛擬桌面仍未測；Store 未開始。
新版模型回歸與既有 26200 歷史紀錄不代替這些驗收。沒有獨立審閱，作者執行的測試只作機械驗證。

## 2026-10-09 Windows 11 相容性需求交接

本節保留最初 c53494a 文件交接時的狀態；同日後續實作與目前待驗事項以上節為準。

使用者確認先前相容性討論選錯專案，真正目標是本 repo；本輪指示先提交相關 ADR／SPEC／PLAN，
直接 commit／push main，再於本專案開新 session 接續。這次只有文件交接與唯讀盤點，沒有 runtime／包／版號／release 變更。

- 需求已確認：Windows 11 23H2 及之前、24H2 及之後；Windows 10 不需適配，但未來 Store 必須拒絕安裝。
  使用者提供 23H2 測試，沒有本輪新版設備，希望盡量避免 regression。
- [ADR-034](docs/decisions/034-windows-11-compatibility-and-install-floor.md)、[SPEC-005](docs/specs/005-windows-11-compatibility.md)、
  [PLAN-004](docs/plans/004-windows-11-compatibility.md) 與 [新 session 接手](docs/handoff/2026-10-09-windows-11-compatibility-handoff.md) 已整理；
  requirements、文件索引、setup／deployment／Windows README 同步區分目前實作與目標。
- 目前仍有 MSIX 下限 26100；目標為 22000，保留 26200 MaxVersionTested。原生層已有 classic sibling／Progman child、現代 manifest、DPI／座標、Start 顯示與 Explorer 恢復機制。
- 本輪唯讀盤點確認本機 23H2 build 22631.6199、144 DPI，Progman／DefView 為 PMv2，沒有新版 child WorkerW。
  沒有呼叫宿主建立訊息、啟動正常 App、跑本專案 native probes 或修改使用者資料。
- 另一個 Tauri 專案的提交／75 Rust／54 前端／隔離 native PASS 不算本 repo 證據。既有本 repo 的 build 26200 紀錄仍保留，不能當作 26100 或本次 23H2 通過。
- 文件檢查通過：108 份 Markdown、627 個相對連結、UTF-8／LF 與 `git diff --check`；來源路徑與目前 MinVersion／manifest／版號核對一致。
  本輪只有文件，依 testing.md 沒有重跑 runtime／GUI 測試；沒有獨立審閱。

下一個 session 從 PLAN-004 Phase 1 開始：先跑現有隔離 native probes，根據 23H2 失敗最小修正並補舊新分支回歸，
原生通過後改 MSIX 下限與驗證最終包，再與使用者做正常互動驗收。Win+D 手動配合、Explorer 重啟与混合 DPI 另安排。
Partner Center 尚未保留應用，Store 提交延期。這次沒有發布指令，不自動升版／dispatch 預覽 workflow。

## 目前優先方向

2026-10-05 使用者將目前試用版本降為 **0.1.0**；完整 1.0 是目標，不是目前品質或驗收結果。
本機重裝由使用者先解除安裝舊版再安裝新包，不自動移除 App 或使用者資料。

2026-10-05 本輪要求補齊 Windows／macOS／Linux 桌面分層，接續參考專案已有的實測成果；結果見下方專節。

使用者已授權逐 slice 實作並直接 commit/push origin/main，直到完整 1.0 完成。
先前收尾階段要求先完成實作；本輪分層補齊已執行相關原生回歸，未執行的檢查仍不視為通過。
本次還明確納入 iOS／Android 原生 App 與商店提交準備，並核准完整 editor／逐卡設定／備份範圍。
核心測試通過不代表五平台或 Google 驗收已完成。

先前收尾指示保留 Apple 編譯由維護者帶到真正的 Mac 處理。
不再等待或啟動 Apple hosted Actions，不使用其計費額度。
先前 Google 程式與公開設定已收尾；2026-10-06 使用者建立 Google Cloud 專案（測試中）與 Windows／Linux 共用的 Desktop client，Apple／Android clients 尚未建立，
macOS 本機 Apple Development team／profile 已配置；其他 Apple target、正式 package identity／
Developer ID 簽章及公開隱私／支援設定仍需維護者配置。
現有安裝產物是 preview，完整 1.0 尚未完成；不再以未固定口徑的百分比回報。

## 2026-10-06 便箋在每台裝置依建立時間排列

使用者在另一台 Windows 安裝 CI 預覽版並登入，同步看起來正常（第一次跨裝置下載），但主畫面便箋順序和這台不同。
- 原因：清單照本機卡片順序顯示；投影保留本機既有順序、新收到的依卡片 ID（隨機 UUID）排。建立的裝置是建立先後，第一次同步的裝置是 ID 順序。
- 使用者決定：依建立時間，舊的在上。新卡片（`createCard`、從草稿建立）在 value 寫入 `createdAt`（注入的時鐘，UTC ISO 毫秒），後續版本沿用；
  revision 本來就保留未知 value 欄位，舊版 App 不受影響。投影對卡片改用 `compareCards`（`createdAt`，再 ID）；群組仍保留本機順序。
- 已存在、沒有 `createdAt` 的卡片在兩台都排在最前並依 ID，所以這台這幾張舊便箋的順序會變一次，之後兩台一致。
- SPEC-004 改寫排序規則並記錄 `createdAt` 欄位。
- 驗證：`npm test` 243 pass、11 skip；新增測試涵蓋時鐘倒退、更新沿用、編輯器草稿建立、舊卡片與格式不符，以及兩台以相反順序收到時結果相同。
  尚未發布新的預覽版，也未在兩台實機確認。沒有獨立審閱。

## 2026-10-06 Windows 預覽版由 CI 發布到 GitHub Release

使用者要在另一台 Windows 從 GitHub release 頁面直接下載 MSIX，參考另一個專案的手動 preview 發布與升版規則。
- 新增手動觸發的 `windows-preview.yml`：guard 解析 `Directory.Build.props` 版號、拒絕已存在的 `windows-v<版號>` tag／release、跑 `npm test`；
  Windows runner 檢查 Google 設定、匯入 preview 憑證、`Build-WindowsPackage.ps1 -LocalTestSign`；成功後才建立 tag 與 prerelease（MSIX、`.sha256`、CER、安裝說明）。
- 使用者選擇沿用本機 `CN=Work Fleet Preview` 憑證；PFX 以隨機密碼匯出、在本機重新載入確認後，連同 Google client secret 存為 repository secrets，專案 ID 與 client ID 存為 variables。
- 發布規則（AGENTS、deployment「Windows 預覽版發布」、ADR-028 修訂）：一般 commit／push 不升版、不發布；使用者要求時升 Windows 版號、push、觸發 workflow；已發布的 tag 不重用。
- 第一次執行（run 37469200056）三個 job 都通過（含 ubuntu 上的 `npm test`），發布 `windows-v0.1.0` prerelease。
  下載 release 檢查：MSIX 的 `.sha256` 相符；CER 指紋與本機 preview 憑證相同；本機 `signtool verify /pa` 通過；
  MSIX 內 `Config/public.json` 有專案 ID、Windows client ID 與 secret（與 `.env` 相同），secret 不在介面資產內。另一台電腦的實際安裝尚未驗收。

## 2026-10-06 Windows 真實 Google 登入與 Drive 上傳驗收（修正三個實測問題）

使用者依步驟建立 Google Cloud 專案（同意畫面測試中、Desktop client），填 `.env` 後安裝新包，在 Windows 以真實帳號登入成功，
帳號區顯示 email；Desktop client secret 的修正因此在真實 Google 上確認可用。
- 登入後顯示「1 筆等待同步」：第一次同步確認雲端是空的，才在本機建立預設群組「我的便箋」，這筆要下一次同步才送出。
- 發現的問題：設定改成一個視窗（`<dialog>`）後，`syncGoogle` 遇到任何開著的對話框就跳過，所以設定開著時自動同步不跑、
  「帳號與同步」頁的「立即同步」也按不動。改為只有設定以外的對話框、或資料頁正在備份／還原時才延後。
- 驗證：`npm test` 239 pass、11 skip；Windows 重新打包。這個修正沒有自動測試（UI probe 沒有 Google 連線的情境）。
- 修正後第一次真正上傳就失敗：「Google 續傳位置無效」。用 App 存的授權開一個 resumable session（不上傳、立即取消，沒有建立檔案）
  看 Google 實際回傳的 Location：除了 `uploadType`、`upload_id`，還帶回請求自己的 `fields`，並多一個 Google 的 `session_crd`。
  五份實作（JS adapter、Windows、Linux、Apple、Android）原本都只接受剛好那兩個參數，所以每次上傳都被擋。
  改為：協定、主機、port、路徑、無帳密與 fragment 照舊固定；query 每個參數名稱不重複、值只含安全字元，必須有 `uploadType=resumable` 與非空 `upload_id`。
  Windows 的 Location 改取原字串，相對網址不再丟出非預期例外。
- 驗證：`npm test` 240 pass、11 skip（新增真實 Location 形狀；拒絕清單改為重複 uploadType、multipart、缺 upload_id）；
  Linux Python 24 項通過（新增 upload session 兩項，11 skip）；Windows 重新打包、建置 0 錯誤。Apple／Android 未建置。
- 下一次同步改停在「Google Drive 包含無法辨識或不同版本的資料檔」。用 App 的授權只讀列出：appDataFolder 只有一個格式正確的 revision 檔（上傳已成功），
  但變更清單多一筆 Drive 第一次上傳時自動建立的「App Data」資料夾本身，只有 id／spaces／trashed，被當成資料檔驗證。
  另有 8 筆沒見過的 removed 變更（未完成上傳的預留 ID），FileSync 本來就略過。
- 修正：五份實作的變更清單都多要 `mimeType`；JS adapter 與原生共用的 `NativeGoogleFileStore` 略過資料夾（`driveFolder`），其他缺欄位的檔案仍然停下。
- 驗證：`npm test` 242 pass、11 skip（新增 adapter 與原生 store 各一項，用實測到的資料夾形狀）；Linux Python 24 項通過；Windows 重新打包、建置 0 錯誤。
  Apple／Android 未建置。沒有獨立審閱。
- 實測結果：使用者安裝後同步顯示「已同步 21:01」；再新增便箋（含附件）同步。用 App 的授權只讀列出 appDataFolder：
  3 個 revision、1 個 1,975,966 bytes 的 attachment（超過 1 MiB，走了分段續傳），名稱、appProperties 與 Drive 的 sha256Checksum 一致；
  逐一下載後 SHA-256 與記錄相符。這證明 Windows 的登入、上傳、續傳與變更清單在真實 Drive 上可用。
- 仍未驗收：另一台裝置從雲端下載與合併（需第二台裝置，例如 Linux VM）、衝突、授權 7 天到期後的重新登入、雲端重設，以及 Linux／Apple／Android。

## 2026-10-06 Windows／Linux Google Desktop client secret

準備建立真正的 Google Cloud 專案時確認：Desktop 類型 client 即使用 PKCE，Google 換 token 仍回 `client_secret is missing`，
原本 Windows／Linux 只送 client ID，真實登入會在換 token 這一步失敗。
- 新增選填 `WORK_FLEET_GOOGLE_WINDOWS_CLIENT_SECRET`、`WORK_FLEET_GOOGLE_LINUX_CLIENT_SECRET`；`config:check` 仍視為選填。
- `readBuildConfig` 只在指定平台時把該平台的 secret 放進 `google.secrets`；Windows 建置腳本改用 `build-web.mjs --platform windows`，
  Linux 封裝指定 linux。Android、Apple、`--print-config` 與介面資產都不含 secret。
- Windows `NativeGoogle` 與 Linux `google.py` 有 secret 時在授權碼交換與 refresh 都送出；設定格式不對時停用並回報。
- ADR-021 補修訂；`.env.example`、google-setup、setup-guide 同步。
- 驗證：`npm test` 239 pass、11 skip（新增 secret 只進指定平台、不進介面資產）；Linux Python 測試 22 項通過（新增 `test_linux_google.py`，11 skip）；
  Windows App 與測試專案建置 0 錯誤。**仍未用真實 Google 帳號登入或做 Drive 往返**，要等 Cloud 專案與 Desktop client 建好。沒有獨立審閱。

## 2026-10-06 Linux Python 下限降為 3.10（Ubuntu 22.04）

使用者想在 Hyper-V 的 Ubuntu 22.04 VM 安裝 DEB，但 22.04 內建 Python 3.10，原本的 `python3 (>= 3.12)` 無法滿足。
- 先確認程式碼不需要 3.12：Linux host 以 3.10 語法解析、以 3.11 編譯皆通過，vermin 判定最低 3.6。
- DEB `Depends` 與 tar.gz `package.json` 改為 3.10；ADR-024、Linux README、setup-guide 同步。
- 22.04 其他相依：amd64 的 jammy-security 有 `gir1.2-webkit2-4.1` 2.50.4（需要 2.40+，發行時的 2.36 不足）；
  `python3-cryptography` 3.4.8 已有 `AESGCM`。
- 新 `tests/test_linux_python_floor.py` 3 項，防止之後用到 3.11+ 語法；標準庫 API 不在檢查範圍。
- 尚未在 Ubuntu 22.04 實際安裝或執行。

## 2026-10-06 桌面層與桌布層便箋也是圓角

使用者發現桌面層、桌布層的便箋四角是直角，只有最上層是圓角；改不動的話最上層也改直角。
- 能改：附著場景是不透明視窗，CSS 圓角外的透明像素顯示不出來，所以改由視窗 region 把每張便箋裁成圓角矩形，
  半徑對齊 `scene.css` 的 `.card` 3px（依 DPI 換算），與參考專案用 region 裁圓角的作法相同。最上層照舊用 CSS 圓角。
- `--host-check` 加一項：測試頁畫的是直角紙，螢幕上紙的正角落必須被裁掉。
- 驗證：`--host-check`（角落被裁、中央為紙色）、桌布層探針（真實螢幕桌布層與桌面層皆為紙色）、UI 整合通過；
  composition 探針第一次在跨程序點擊判定失敗，接著重跑兩次通過，判定為執行中桌面活動造成的偶發。

## 2026-10-06 啟動時桌面層與桌布層是黑的，切換層級後才正常

使用者回報：開 App 時桌布層的便箋看不到（其實是黑塊落在黑桌布上），桌面層有黑影擋住捷徑；手動切換一次層級後才正常。
- 原因：場景啟動時先藏起視窗，再在隱藏狀態下建立視窗式 WebView2；這樣建立的 WebView2 在 Explorer 底下顯示後仍是黑的。
  切換層級走的是「WebView2 已存在 → 隱藏 → 顯示」，所以正常。先前的重現是先顯示再建立，順序跟 App 不同，沒抓到。
- 重現與比較（仿 Progman 宿主）：原順序全黑；顯示後切換 WebView2 可見狀態仍黑；在顯示中建立再隱藏則正常。
- 修正：新增 `DesktopSurface.Start`，附著場景在 WebView2 建立完成前保持顯示（region 為空，看不到也點不到），建立後才隱藏；
  `DesktopCoordinator.Initialize` 改用它。最上層照舊。
- 新自動測試 `--host-check DIR`：自行啟動仿 Progman 的置頂宿主程序，照 App 的順序掛上場景並讀螢幕，不需要使用者露出桌面；
  已加入 `Test-WindowsNative.ps1`。把啟動順序改回舊做法時這支測試會失敗（黑色），確認抓得到這個問題。
- 驗證：Windows App 與 UI 測試建置 0 錯誤；`--host-check`、UI 整合、桌布層探針通過。

## 2026-10-06 Windows 桌面層與桌布層在真實螢幕上看不到

使用者指出參考專案在同一台電腦上桌布層正常，是我們的實作問題，不是 Windows 的限制。
- 量測：桌布層探針加上真實螢幕檢查（`--wallpaper DIR --wait-desktop`，等使用者按 Win+D 露出桌面，用粉紅色假便箋讀螢幕像素）。
  使用者的桌布是純黑色背景。結果：桌布層 rgb(0,0,0)、桌面層 rgb(0,0,0)、最上層 rgb(224,80,160)。
  也就是掛在 Explorer 底下的兩層在螢幕上完全沒有畫出來，只有獨立的最上層正常；這支探針沒有套用 render popup 的滑鼠穿透，與那個修正無關。
  原本的探針只用 RenderTargetBitmap 在螢幕外比對 WPF 像素，所以一直顯示通過。
- 原因：場景是全螢幕的 WPF 逐像素透明視窗（AllowsTransparency，UpdateLayeredWindow）。這種視窗當成 Progman／WorkerW 的子視窗時，
  在 Windows 11 build 26200 上不會被合成到螢幕。參考專案每張便箋是不透明視窗，用視窗 region 裁出形狀，所以看得到。
- 第一次修正（不透明 WPF 視窗加 region）不夠：使用者安裝後桌面層變成黑色方塊蓋住捷徑，桌布層仍看不到（純黑桌布上的黑塊）。
- 真正原因：Progman 是 `WS_EX_NOREDIRECTIONBITMAP`，自己沒有 GDI／redirection surface；透過 WPF 繪圖的子視窗（不論透明與否）沒有地方被合成。
  參考專案的 Tauri 視窗由 WebView2 以 DirectComposition 畫進自己的子視窗，所以看得到。
- 重現：測試程式新增 `--host-window-dcomp`（另一個程序建立帶同樣樣式的置頂宿主）與 `--host-child HOST DIR VARIANT`（把場景掛進去讀螢幕）。
  一般宿主下原做法正常；仿 Progman 宿主下原做法全黑，軟體渲染變白，視窗式 WebView2 正常顯示。
- 修正：`DesktopSurface` 的附著場景（桌面層、桌布層）改用視窗式 `WebView2`，同一個不透明視窗負責顯示與輸入，region 只留便箋；
  最上層維持 composition WebView 與透明視窗。`DesktopSurface.WebView` 改為 `IWebView2`。
- 試過但不可靠、不能當證據的讀法：對 Progman 用 PrintWindow（PW_RENDERFULLCONTENT）與 DWM 縮圖，連最上層都讀錯。
- 驗證：仿 Progman 宿主下正式的附著場景顯示粉紅測試便箋；真實 Explorer 上桌布層、桌面層的真實螢幕檢查都讀到粉紅色（兩次重跑皆通過）；
  Windows UI 整合（含群組設定切層）、composition、桌布層探針全部通過。桌布層探針的 WPF 離屏像素檢查改為 WebView 的 CapturePreview。

## 2026-10-06 群組設定可以檢視與修改層級

使用者回報：安裝後桌面上看不到兩張便箋，而且群組設定裡沒有顯示與調整層級的地方。
- 先前把「主畫面不該看到或修改」理解成整個主視窗都不放層級，實際意思是層級屬於群組、不放在單張便箋上。
  現在群組旁的「⋯」對話框改名「群組設定」，電腦版多一個「桌面上的層級」（桌布層／桌面層／最上層），保存時寫入群組層級；
  新增群組時也可以先選。手機與瀏覽器預覽沒有這個選項；不支援桌布層的電腦，桌布層選項停用（目前已在桌布層時除外）。
- 看不到便箋：檢查使用者正在執行的 App 視窗（只讀視窗資訊），有便箋的場景是掛在 Explorer WorkerW 底下的桌布層，
  桌面層場景因為沒有便箋而隱藏，所以這組目前在桌布層（可能來自舊單張層級的轉換取最低層，或按區域鍵輪到桌布層）。
  桌布層在所有視窗與桌面圖示下方。原生桌布層探針只用離屏渲染比對像素，從未在實際螢幕上確認看得到；
  若桌面露出時桌布層仍看不到，就是這台 Windows 的桌布層在實際螢幕上沒有顯示，需要另外處理。
- Windows 原生 UI 探針改用群組設定切換層級，並改為檢查桌面層閒置便箋可點選但不能拖；
  快捷鍵探針兩段注入腳本都宣告 `const all`，同一頁第二段會因重複宣告失敗，改成各自包在區塊裡（上一輪改設定頁時引入）。
- 驗證：`npm test` 全部通過；Windows 原生 UI 探針（主畫面、桌面整合含群組設定切層、快捷鍵與系統匣、關閉）、
  桌布層探針、composition 探針都實際執行通過。

## 2026-10-06 換階時在桌面上顯示目前層級（OSD）

使用者要求先做換階提示，之後自行到各平台驗證與除錯。
- 做法：每次區域鍵或 Ctrl+Shift+0 生效後，桌面畫面資料多帶 `notice`
  （`id`、`rect`＝該組區域、`title`＝群組名稱、`text`＝桌布層／桌面層／最上層／調整位置、`step`／`steps`＝第幾階與共幾階）。
  最上層場景在區域中央畫一個深色提示，下方圓點標出目前在第幾階，約 1.5 秒淡出；主程式 1.6 秒後送出不含 `notice` 的畫面。
  連按時新的提示取代舊的，舊的計時不會提早清掉新的。全部鍵顯示「調整位置」或「回到原本層級」，不含圓點。
- 原生 host 只做兩件事：允許並檢查 `notice` 欄位，以及最上層在沒有便箋、但提示落在該螢幕時也保持顯示；提示永遠不進輸入區域。
  - Windows：`src/native/windows/core/DesktopFrame.cs`（解析）、`src/native/windows/app/DesktopCoordinator.cs` 的 `scene.applied`（顯示條件）。
  - macOS：`src/native/apple/macos/FleetSceneProtocol.swift`（解析）、`FleetSceneSurface.swift` 的 `apply`（顯示條件）。
  - Linux：`src/native/linux/scenes.py`（解析）、`surface.py` 的 `apply`（顯示條件）。
- 驗證：Windows App 與 UI 測試專案建置成功，Windows core probe 的畫面解析測試（含 notice 接受與拒絕）通過；
  Linux 解析器用產生的情境畫面逐一驗證，也拒絕格式錯誤的 notice；`npm test` 全部通過；提示樣式以場景 CSS 截圖確認。
  macOS 未在這台機器建置。實際按鍵時提示是否出現、是否擋到滑鼠，需要在三個平台安裝後確認；
  Linux 可跑 `tests/native/linux/scenes_probe.py`，新的 `notice` 情境會檢查最上層有顯示且輸入區域為空。

## 2026-10-06 層級改成群組設定，區域鍵改為四階

使用者決定：層級屬於群組的桌面 UI，主畫面不該看到或修改，所以從便箋詳情拿掉；
純桌面層（擋住底下但滑鼠穿透）沒有用處，輪播改成 桌布層 → 桌面層（可選取文字）→ 最上層（可選取文字）→ 最上層＋調整模式，再按回桌布層。
- 版面新增 `groupLayers`（群組 → 層級，每台電腦各自保存，不同步），沒有記錄的群組在桌面層。
  便箋位置不再有 `residentLayer`／`readOnlySelect`；`setCardPolicy` 只剩 `visible`，改層級用 `setGroupLayer`。
- 桌面層與最上層的便箋鎖定時一律可選取文字、點連結，不穿透滑鼠；桌布層固定穿透。原本預設穿透的桌面層便箋現在會擋住底下的圖示。
- 舊資料：開啟工作空間或還原舊備份時，每組取顯示中便箋（不含封存、刪除、隱藏）的最低層級，並移除單張欄位；備份格式兩種都接受。
- 合併群組時來源群組的層級移除，接收群組保留自己的；「重置桌面佈局」讓所有群組回到桌面層。
- 便箋詳情只剩「移至群組」與「在桌面顯示」。
- 原生測試用的 `tests/native/desktop-scenarios.mjs` 改用群組層級，情境名稱不變。
- 驗證：`npm test` 全部通過，含四階循環、群組層級的點擊行為、舊版單張層級轉換與舊備份還原。

## 2026-10-06 區域鍵逐階切換整組便箋的層級

使用者決定：Ctrl+Shift+1～9 每按一次，整組便箋依序換到 桌布層 → 桌面層 → 桌面層（可選取文字）→ 最上層 → 最上層＋調整模式，
再按回到桌布層；整組一起，以組內最低一張為起點。Ctrl+Shift+0 只負責「全部進入調整模式 → 各自回到原本層級」，不改層級。
- 「可選取文字」本來就是每張便箋各自的設定（`readOnlySelect`），不是全域設定，所以五階可以做到。
  第四階（最上層）沿用可選取文字，不做成滑鼠穿透；單張便箋仍可在詳情裡改成穿透，下次按區域鍵會再被統一。
- `src/layout/stages.js`：階段定義、下一階計算與整組切換；`LayoutStore.setCardsPolicy` 一次交易寫完整組。
  先寫層級再切換調整模式，離開調整模式時便箋直接落到新層級。主機沒有桌布層時從桌面層開始輪。
- 關閉「鎖定時也顯示便箋」時前幾階看不到，所以這時區域鍵只切換調整模式；瀏覽器預覽沒有層級，也維持只切換調整模式。
  按區域鍵時若「全部調整」或其他組正在調整，會先結束調整。
- 設定頁標題改為「便箋層級與位置」，說明各階順序；「所有群組」一列註明它只進出調整位置。
- 未做：換階時的畫面提示。要在桌面上短暫顯示「目前是哪一層」，需要在畫面資料加欄位，
  macOS 與 Linux 原生 host 會嚴格檢查欄位，得一起改，這台機器無法驗證，先不做。
- 驗證：`npm test` 全部通過，含新的五階循環、混合層級與整組交易測試；group-probe 通過；設定頁截圖確認。
  實際在桌面上按鍵換層需要安裝後測試。

## 2026-10-06 快捷鍵改成 0～9 對應桌面區域

使用者要求 Ctrl+Shift+0～9 都能設定：0 是全部，1～9 對應桌面切成的區域；頁面順序為快速記錄、顯示或隱藏桌面便箋、0～9。
- 原本數字鍵綁群組 ID，只有建立工作空間當下的群組拿到數字鍵，之後新增的群組沒有。
- 現在數字鍵綁區域（`@region1`～`@region9`），按下時作用於當下在該區域的群組；新工作空間預設 Ctrl+Shift+1～9。
  空白區域的鍵不送去註冊，不佔用其他程式的組合鍵。送給原生 host 的仍是群組 ID，所以 Windows／macOS／Linux 原生程式不用改。
- 舊設定：綁群組 ID 的鍵在開啟工作空間或還原備份時改成該群組所在區域，沒有鍵的區域補上預設數字；
  只在還有綁群組的鍵時做一次，之後清空的鍵不會被補回。舊備份仍可還原，還原後的鍵也已轉成區域（有單元測試）。
- 設定頁：快速記錄、顯示或隱藏桌面便箋；「便箋層級與位置」列出所有群組與區域 1～9。
  區域列顯示目前群組的名稱與便箋色，沒有群組顯示「空白」；切到快捷鍵頁時重新讀取，「桌面」頁剛換的區域會反映出來。
- Linux GlobalShortcuts portal 的綁定 ID 由鍵與目標組成；區域換了群組，該鍵會成為新的綁定，portal 可能再次詢問。
- 驗證：`npm test` 全部通過；group／browser／revision／restore-ui／automatic-backup 五支瀏覽器 probe 通過
  （group-probe 改為按區域操作）；寬版與 390px 截圖確認。原生全域鍵實際按壓未在本機自動測。

## 2026-10-06 Linux 金鑰圈鎖住不再誤報缺少金鑰

使用者在 Pi 上移除再重裝 DEB 後，看到「現有資料缺少原金鑰」，但金鑰其實還在，只是存在開機後鎖住的「Default Keyring」。
- 原因：鎖住的 gnome-keyring 項目只公開 `xdg:schema=org.freedesktop.Secret.Generic`，真正的 schema 名稱只留雜湊；
  `password_lookup_sync` 預設比對 schema 名稱，所以根本找不到鎖住的金鑰，不會要求解鎖，直接回傳 None。
  已在 Pi 以不解鎖的搜尋實測：比對 schema 名稱只找到 login 的項目，只比對屬性則同時找到鎖住的那把。
- 修正：schema 設 `DONT_MATCH_NAME`，鎖住的金鑰會由 libsecret 要求解鎖（libsecret 0.21.7 有已解鎖項目時優先使用，不會多跳視窗）。
  查不到時以不解鎖、不讀密碼的搜尋確認是否存在：有資料時回報「已鎖定或解鎖已取消」；沒有資料時也拒絕另建第二把金鑰，
  避免日後兩把都解鎖時 lookup 取到舊金鑰而解密失敗。真的沒有金鑰才維持「缺少原金鑰」。
- `google.py` 的 `Vault.read` 回傳 None 代表未連線，契約不變。
- 驗證：新 `tests/test_linux_vault.py` 6 項（以假 libsecret，修改前全部失敗）；真實金鑰圈上 `Vault.stored` 不解鎖即找到鎖住的金鑰。
- 同日使用者在 Pi 確認主視窗 X 收到系統匣在 Linux 實機正常。
- Pi 的預設金鑰圈已由使用者改為會自動解鎖的 login；舊 Default Keyring 仍留有一把鎖住的舊金鑰，新程式會優先使用已解鎖的那把。

## 2026-10-06 所有平台的安裝檔統一放在 build/

使用者要求輸出目錄固定，而且各平台安裝檔要在同一層，不要有的深有的淺；`build/` 或 `build/<平台>/` 都可以。
採用 `build/` 根目錄，因為 10-05 已決定 DEB 放在這裡，不需再搬。
- 發佈檔與 `.sha256` 直接放在 `build/`，同名覆蓋：Windows MSIX／ZIP（`-LocalTestSign` 另有 `WorkFleet-preview.cer`）、
  Apple 預覽 ZIP／DMG／IPA、Apple 正式 PKG／DMG／IPA、Android APK／AAB、Linux DEB 與 tar.gz（原在 `build/linux/`）。
- 中間產物改用固定工作目錄，每次清空：`build/windows/package`、`build/apple/preview-<macos|ios>`、
  `build/apple/export-<macos|ios>`、`build/linux/work-fleet-<版號>`。取代 `package-<guid>` 與 `mktemp` 隨機目錄。
  Windows 與 Apple 全部成功（含簽章、公證）後才移入 `build/`。
- 原本留在 `products/` 的 Apple 正式匯出改名移出：iOS `WorkFleet-<版號>-ios-<method>.ipa`、
  Mac App Store `WorkFleet-<版號>-macos-universal-app-store-connect.pkg`。
- Android 兩個入口在 Gradle 完成後依 `versionName` 找預期檔名並複製到 `build/`，找不到即失敗；
  `platform-version.mjs` 因此新增 android 讀取。
- Apple workflow 改從 `build/WorkFleet-*` 上傳。ADR-028、deployment、setup、testing 與各平台 README 同步。
- 各開發機上既有的 `build/windows/package-<guid>`、`build/apple/preview-*-XXXXXXXX` 舊交付目錄未動，由使用者自行清理。

作者檢查：完整 JS 231 項 223 通過、8 原生環境略過、0 失敗；Python 24／24 通過；docs check、`git diff --check`、bash 語法與 shellcheck 通過。
Linux 測試在隔離 checkout 實際建置，確認 `build/` 根目錄只多出 DEB、tar.gz 與兩個 `.sha256`，且 bundle 重建時清掉舊來源檔。
Windows／Apple／Android 的搬移邏輯在本機無法執行，只有靜態測試；沒有獨立審閱。

## 2026-10-06 各平台版號紀錄與發佈檔名

使用者要求發佈檔名完全由 repo 決定：不同開發機 clone 同一 commit、執行同一指令要得到相同檔名，
同一平台的不同建置入口也不能各自寫死版號；各平台各自記錄版號，不共用同一份版號檔。
- 版號紀錄：Windows `src/native/windows/Directory.Build.props`（取代兩個 csproj 各自的 `<Version>`）、
  Apple `src/native/apple/config/WorkFleet.xcconfig` 的 `MARKETING_VERSION`／`CURRENT_PROJECT_VERSION`、
  Android `build.gradle.kts` 的 `versionName`、Linux 新增 `src/native/linux/VERSION`。目前都是 `0.1.0`。
  原本分散寫死在 Linux／Windows／Apple 封裝腳本與 Windows 專案檔的版號全部移除，改由 `scripts/platform-version.mjs` 或產物 metadata 取得。
- 檔名：macOS 正式 `WorkFleet-<版號>-macos-universal.pkg|dmg`；預覽 `WorkFleet-<版號>-macos-universal-<unsigned|development>.zip`，
  新增 `--dmg`；iOS 預覽 `-ios-<unsigned|development>.ipa`、`-ios-simulator.zip`；Android `WorkFleet-<版號>-android-debug.apk|release.aab`；
  Windows 與 Linux 檔名不變。每個發佈檔旁輸出同名 `.sha256`，Apple workflow 一併上傳。
- 不受機器影響：macOS 命令列建置固定 `ARCHS=arm64 x86_64`、`ONLY_ACTIVE_ARCH=NO`，封裝前以 lipo 檢查；
  預覽的簽章後綴取自 App 本身的 codesign 結果；Apple 資源準備拒絕 Local.xcconfig 或命令列覆蓋版號。
- 先前手動產生的 `WorkFleet-0.1.0-macos-universal-development.dmg`／`-unsigned.dmg` 現在可由
  `build-native-app.sh --platform macos [--unsigned]` 加 `package-preview-app.sh --platform macos --dmg` 重現同名檔案。
- 決策補充於 ADR-028；deployment 新增「版號與發佈檔名」，setup／testing／各平台 README 同步。

作者檢查：`npm ci --ignore-scripts` 補齊本機缺少的 esbuild 後，完整 JS 230 項 222 通過、8 原生環境略過、0 失敗
（含新 `tests/release-versions.test.js` 4 項）；Python 24／24 通過，Linux 測試以不同於 repo 的版號實際封裝 DEB／tar.gz
並核對 `.sha256`。docs check、`git diff --check`、bash 語法與 shellcheck 通過。
本機（Raspberry Pi）沒有 Xcode、PowerShell、.NET 或 Android SDK：Apple 封裝腳本、Windows 腳本與 Gradle 的
`archivesName` 只做語法／靜態測試，未實際產出 MSIX、DMG、PKG、IPA、APK 或 AAB；macOS 改為 universal 後
hosted workflow 的建置時間也未測。沒有獨立審閱。

## 2026-10-06 設定整併成單一視窗

使用者指出帳號與「資料與備份」放在帳號選單、不在設定裡，不符合一般做法，並要求設定頁減少工程師口吻的說明。
- 設定改成一個視窗，分「帳號與同步」「資料與備份」「桌面」「快捷鍵」四頁；桌面與快捷鍵只在 Windows／macOS／Linux 出現。
  電腦上左側是頁面清單、右側是內容；手機是全螢幕的頁面清單，點進去後有返回，Android 返回鍵與 Esc 先回清單。手機恢復齒輪。
- 側欄左下角帳號區改為直接開「帳號與同步」，原本的帳號彈出選單移除；齒輪開設定（電腦回到上次的頁面，手機開清單）。
- 「帳號與同步」：頭像與帳號名稱、儲存位置一句話，下方同步（立即同步）、Google 帳號（登入／切換帳號／登出）、本機便箋（切換）。
- 「資料與備份」由原本獨立對話框改成設定頁（`backupPanel`），內容分匯出備份、從備份還原（較少用的兩個選項收進「更多選項」）、自動備份，最後隔開重設所有資料。
  備份或還原進行中不能離開這一頁或關閉設定；Esc 會取消正在進行的工作。
- 「桌面」與「快捷鍵」不再有保存按鈕，變更有效時立即套用：開關、我的群組、區域格局即時生效；快捷鍵離開欄位時套用，重複或格式不對時顯示原因且不套用。
  快捷鍵的註冊問題顯示在該列（例如「已被其他程式使用」），正常的不顯示；有註冊失敗才出現「重新註冊快捷鍵」。
- 群組區域預覽畫成一張小桌面，每一區用該群組的便箋顏色；各頁圖示用便箋顏色的小方塊。
- 文案改用使用者口吻並刪去內部說明，例如移除「全域最多 32 組，App 取得焦點時會暫停全域註冊…」「變更區域不搬動既有便箋；執行排列時才召回」等。
  桌布層無法使用時才顯示一行提示。帳號狀態不再用「·」串接（「已同步 14:32」）。

驗證：browser／group／restore-ui／automatic-backup／revision 五支 probe 通過；probe 與 Windows UI 測試、Apple StartupProbe 隨新結構與文案更新。
截圖檢查 1280 寬四頁與 390 寬清單、帳號、桌面、資料頁，另以模擬原生狀態檢查已登入時的帳號頁。Windows UI 測試只編譯未執行。
## 2026-10-06 重設所有資料與重置桌面佈局

使用者要求在設定加入重設所有資料（需警告、手機也能用），討論後分成兩組：
- 資料重置對「目前工作空間」：本機工作空間刪除這台裝置的資料；Google 工作空間連 Drive 一起清。
  手機不登入 Google 時本身就是本機記事軟體，所以手機也有本機資料可重置。
- 版面重置只在有桌面分層的 Windows／macOS／Linux，用語照 iOS「重置主畫面佈局」叫「重置桌面佈局」，不含快捷鍵。

重置桌面佈局（`274b9be`）：設定最下方，確認對話框說明影響範圍。`LayoutStore.reset` 把群組區域恢復預設格局、清空位置與復原歷史、
顯示桌面便箋、取消「屬於我的群組」，保留快捷鍵與 device id；之後 `placeNew` 把所有便箋放回各群組區域（桌面層、顯示、不可選字）。
兩次寫入之間中斷時，開 App 時的 `placeNew` 會補放。`desktop-core` 新增測試。

本機資料重置：「資料與備份」最下方「重設所有資料」，旁邊「先匯出備份」（捲到匯出區並聚焦密碼）。
警告對話框寫出對象（本機便箋／這台裝置）、會刪除與不受影響的項目，再放一次「先匯出備份」，勾選「我了解資料刪除後無法復原」後才能按「永久刪除並重設」。
流程比照切換帳號：停同步與自動備份、封存桌面場景、等進行中的寫入完成，再呼叫原生 `storage.reset`。
四個原生宿主都新增 `storage.reset`：在同一個交易刪除該 profile 的 records／attachments／staging 與備份金鑰、備份位置授權
（Windows `vault`／`capabilities`，其他平台 `secrets`），再 VACUUM 回收空間；回覆後沿用切換帳號的路徑重開同一個 profile。
Google 登入資料不在這些表（Windows 獨立 vault 檔、Apple Keychain、Linux Secret Service、Android 系統授權），所以不受影響。
瀏覽器預覽改為刪除 IndexedDB 的工作空間、附件與備份紀錄後重新載入。Google 工作空間的做法見本段下半。

驗證：`desktop-core` 47 項通過；Windows 原生 bridge 測試新增重設（刪除後讀不到工作空間、紀錄與附件，新工作空間可從頭保存）並通過；
Windows app 與測試專案建置 0 錯誤；瀏覽器預覽實測新增便箋、草稿後重設，重新載入只剩預設群組、0 張便箋、草稿入口隱藏，1280 與 390 寬截圖檢查對話框。
Apple／Android 原始碼未建置（依指示到 macOS 開發機），Linux 的資料庫需要 GI／Secret Service，本機只做語法檢查。

Google 工作空間連雲端重置（`resetSource`）：先在 appDataFolder 寫入新的 `reset` 種類標記檔，再列出並逐一刪除其他檔案（`google.delete`，已不存在視為完成），
重複列舉直到只剩標記，可清掉其他裝置在重置途中上傳的檔案；網路、限流、服務錯誤最多重試 5 次。全部刪完才清這台裝置的副本，中途失敗時本機資料仍在。
同步原本只會新增檔案，看到移除就停止（`source-file-missing`）。現在：變更清單中出現標記、且這台裝置持有舊檔案時回報 `source-reset`；
游標失效重新列舉時，已知檔案不見且有標記也回報 `source-reset`；從未收到的檔案被移除不再視為錯誤。新裝置或剛重置的裝置不持有舊檔案，標記不影響它們。
其他裝置遇到 `source-reset` 時帳號區顯示「雲端已重設」，跳出一次對話框：清除這台裝置的副本後重新同步、先匯出備份，或稍後；不會自動刪除。
四個原生宿主都接受 `reset` 檔案種類（上限 4 KiB）並新增 `google.delete`；Google 工作空間未登入時重設按鈕停用並說明原因。

驗證：`file-sync` 新增 3 項（標記讓持有舊檔的裝置停下、新裝置從清空的雲端開始、游標重建後仍辨識、限流重試與重置途中新增的檔案、刪除失敗回報），
`npm test` 225 pass、11 skip。Windows app 建置 0 錯誤。restore-ui 與 automatic-backup probe 在加入重設區塊後重跑通過（390 寬不溢出）；automatic-backup 第一次失敗、未留下訊息，之後連續 3 次通過，視為不穩定。Windows 的重設旗標改為讀一次即清除，避免之後的訊息再觸發一次重開。**Google 雲端重置沒有任何實機或真實 Drive 驗證**：
目前所有版本都還沒有配置 Google clients，使用者無法登入 Google，這條路徑現在走不到；Apple／Android／Linux 的 `google.delete` 也未建置。

## 2026-10-06 Windows 開著時桌面圖示點不到

使用者回報：Work Fleet 執行中（包含只在系統匣）時，桌面捷徑完全點不到。
原因：桌面場景用的 `WebView2CompositionControl` 會讓 WebView2 瀏覽器程序建立一個頂層 popup（`Chrome_WidgetWin_1`，標題沿用「Work Fleet 桌面」），
它一直可見、整個螢幕大（3840×2160）、`WS_EX_LAYERED|NOREDIRECTIONBITMAP|NOACTIVATE`、alpha 0，疊序就在 Explorer 的 `Progman` 正上方。
它沒有 `WS_EX_TRANSPARENT`，所以雖然看不見卻會接下滑鼠；桌面上沒有其他視窗遮住的地方，點擊都落在它身上，圖示收不到。
我們自己附在 `Progman` 下的兩個場景視窗沒有問題：顯示視窗是 layered＋transparent，輸入視窗在鎖定時是空 region。
本機以兩個獨立程序重現：同樣樣式的 alpha 0 popup 會吃掉下方視窗的 `WindowFromPoint`，加上 `WS_EX_TRANSPARENT` 後點擊傳到下方；從其他程序設定 ex style 也有效。
修正：`DesktopSurface.PassBrowserClicksThrough()` 找出瀏覽器程序中標題相同、layered 且不搶焦點、非 topmost 的 `Chrome_WidgetWin_1`，加上 `WS_EX_TRANSPARENT`。
場景初始化後、每次由隱藏轉為顯示、以及顯示後 300 ms 的重繪時各做一次。紙面輸入一直是從我們的輸入視窗轉送給 WebView，不經過這個 popup。
`DesktopIntegrationProbe` 新增檢查：場景顯示後，可見的 render popup 必須都是 click-through。

驗證：Windows app 與 UI 測試專案 Debug 建置 0 警告 0 錯誤；未執行完整原生測試（會在真實桌面建立場景並與執行中的安裝版搶快捷鍵）。
已在使用者執行中的安裝版上直接替這三個 popup 加上旗標作為暫時緩解，請使用者確認圖示可點；新包安裝後由程式自動處理。

## 2026-10-06 macOS universal 開發簽章 DMG（`3b65d7d`）

依使用者要求在 macOS 開發機重建 DMG，作法同 2026-10-05 的開發簽章版：Xcode 27.0（27A266a）、Node 24.21.0，
Debug、`ARCHS=arm64 x86_64`、`ONLY_ACTIVE_ARCH=NO`，以 `Local.xcconfig` 的 team `97JBZ3MFX5` 做 Apple Development 簽章，
再用 hdiutil UDZO 封裝（卷名 `Work Fleet 0.1.0`，內含 `Work Fleet.app`、Applications 捷徑與 README）。
內容含本日到 `3b65d7d` 的修改：空白／未修改草稿不保留、編輯中雙擊另一張、帳號區與手機抽屜等。
命令列的 `xcode-select` 指向 Command Line Tools，`xcodebuild` 須設 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`。

交付：`build/apple/preview-macos-universal-development-Mr4AH8Eh/WorkFleet-0.1.0-macos-universal-development.dmg`。
大小 2,998,135 bytes；SHA-256：`84abbe5a52c4a0b484a816a65af5600d3c43cba20d956cd44588728c564b8da0`。
取代 2026-10-05 的 `preview-macos-universal-development-os1ji0ur` 作為最新本機試用包；舊目錄未刪除。

作者檢查：建置成功，只有既有的 AppIntents metadata 警告；`hdiutil verify` 通過。唯讀掛載後
`codesign --verify --deep --strict` 通過，entitlements 含 Sandbox、application identifier、team 與 Keychain group；
主程式與兩個 dylib 都是 arm64／x86_64；bundle ID、版本 0.1.0（100）正確；
LICENSE／THIRD-PARTY-NOTICES 與來源一致；`main.bundle.js` 含本日修正。
紀錄：交付目錄的 `verification.json`／`dmg-verification.log`／`SHA256SUMS.txt`，建置 log `build/apple/macos-universal-development-3b65d7d.log`。
未安裝或啟動 App，未讀取使用者資料；這次只打包、未改程式，沒有重跑 `npm test` 或獨立審閱。
仍是只限已登記 Mac 的開發簽章包，沒有 Developer ID／公證。

## 2026-10-06 主視窗帳號區、手機抽屜與移除手機排列

使用者認為主視窗的 Google 登入與設定按鈕不像一般軟體，同意改為左側欄底部的帳號區，並要求手機一起調整、完全拔掉手機上的桌面排列。
- 側欄底部改為帳號區：頭像（已登入為 email 首字，否則為電腦圖示）、名稱與一行同步狀態（色點：已同步／同步中／等待同步／失敗／未連接），右側齒輪開設定。
  點帳號區開選單：帳號說明、立即同步、資料與備份、登入／切換 Google 帳號、切換到本機便箋、登出 Google。
  選單在寬螢幕從帳號區上方彈出，窄螢幕改為底部面板；用 `<dialog>` 實作，因為 iOS 16 沒有 popover。
- 「資料與備份」從設定對話框移到帳號選單；設定對話框標題改為「設定」，加上 Ctrl+,（macOS ⌘,）。桌面層連接說明移入設定對話框。
- 未完成草稿、分享收件匣只在有數量時出現；版本與衝突一直顯示（裡面有版本歷史），衝突數只在大於 0 時顯示。
- 寬度 ≤640px（手機直放、窄視窗）側欄改為抽屜：左上按鈕開啟，點群組、點遮罩、Esc、Android 返回關閉；不支援邊緣滑入，避免與系統返回手勢衝突。
  頂列只留抽屜按鈕、群組名稱與搜尋（按鈕展開搜尋欄）；新增改為右下角圓形「＋」。有衝突、收件匣或同步問題時，抽屜按鈕顯示小紅點。
  抽屜、頂列、底部面板的觸控目標至少 44px。641–950px（平板、手機橫放）維持原本較窄的常駐側欄。
- Android 返回鍵由上而下關閉：最上層對話框（編輯器等同保留草稿並關閉，忙碌中的對話框依原本規則不關）→ 搜尋 → 抽屜，都沒有才走原本的關閉流程。
  不改 Java：manifest 關閉預測式返回，`onBackPressed` 仍送出關閉要求，取消關閉會重設 Android 端狀態。原本「請先完成或關閉目前對話框」的拒絕訊息在 Android 不再出現。
  其他平台關閉時若只開著帳號選單，先收起選單再繼續關閉。
- iOS／Android（`native.info.platform`）完全不顯示排列：工具列（調整、上一張／下一張、堆疊、攤開、復原）、清單／桌面檢視切換、設定齒輪、模式標示、
  「桌面便箋已隱藏」橫幅，以及「更多操作」裡的「在桌面顯示」與「鎖定時可選取文字」（套用時不改這些值）；全域快捷鍵在手機上也不處理。
  上方「沒有桌面分層的平台隱藏常駐層級」一段所說「鎖定時可選取文字在手機畫布上仍有作用」已不適用：手機不再有畫布。
- iOS 根 view 背景由白色改為頁面的 `#F3F5F4`，安全區外的上下條與頁面同色；Android 原本就是這個顏色。

- 草稿連結改為 0 時隱藏後，改選其他卡（只局部重繪）時連結不會出現；數字與連結改由 `renderCounts()` 更新，完整重繪與改選都會呼叫。
  這也修掉上方「結束編輯時不保留未修改的既有便箋草稿」一段所列「改選其他卡時草稿數字可能要到下次完整重繪才更新」。

驗證：本機以 Edge 開瀏覽器預覽，截圖看過 1280 寬的側欄與帳號選單、390 寬的頂列、抽屜、底部面板、搜尋與清單；Ctrl+, 開啟設定、點遮罩關閉抽屜正常。
browser／group／revision／restore-ui／automatic-backup probe 全部通過；probe 改為先開抽屜或帳號選單。`npm test` 216 pass、10 skip。
browser-probe 拖放後立刻量紙面位置有競態：版面寫入後的重繪會在量測途中替換元素，本次的時序下 3/3 量到 null（改前 2/2 通過）。
probe 改為等紙面不再是拖曳中才量；拖放後的位置本身不變。另有兩次 probe 開頁停在「正在載入…」，之後連開 15 次預覽沒有重現。
手機的「隱藏排列」只能在預覽中模擬，Android 返回鍵與 iOS 背景色未在實機驗證（依指示到 macOS 開發機做）。沒有獨立審閱。

## 2026-10-06 就地編輯中雙擊另一張便箋

修正上一段審閱發現的既有問題：主視窗的「桌面檢視」畫布上，就地編輯一張便箋時雙擊另一張，第二張無法進入編輯，出現「正在保存，請稍候。」。
這個畫布只在沒有連接桌面分層時出現：瀏覽器預覽、手機與平板 App 的「桌面檢視」。
Windows／macOS 連接桌面分層後，主視窗改顯示版面地圖；桌面紙面的編輯經 desktop authority 依序執行，不走這段程式。
原因：第一下點擊的 `pointerup` 改選卡片時會保存前一份草稿；沒有桌面場景時 `run()` 不會排隊，
第二下的 `pointerdown` 與 `dblclick` 因此撞上忙碌中的 controller 而被拒絕。
`main.js` 讓舞台的 `pointerup`／`dblclick` 依序執行；存檔中的按壓不開始拖曳，也不再丟出錯誤。
`run()` 沒有全面改成排隊，因為手機轉背景時的草稿保存也走 `run()`，不應等在其他動作後面。

驗證：`browser-probe.mjs` 新增「編輯中雙擊另一張」步驟；本機以 Chrome 執行（暫時改 channel，repo 內容未改），完整 probe 通過；
拿掉修正時，新步驟在第二張的編輯框失敗。Chrome 臨時腳本重複雙擊 8 輪：修正前 8/8 失敗，修正後 0 失敗，連跑 3 次。
沒有在手機實測；手機 WebView 連點是否觸發 dblclick 未確認。本次沒有另外做獨立審閱。

## 2026-10-06 結束編輯時不保留未修改的既有便箋草稿

使用者回報：打開既有便箋編輯，未修改就關閉，也會留下一份與便箋相同的草稿，草稿數持續累積。
原因：開始就地編輯、桌面 editor 或完整編輯時立即保存一份便箋內容的草稿，結束時一律保留。
`Workspace.discardBlankDraft` 改為 `discardUnneededDraft`：除了空白草稿，草稿若與便箋目前版本的內容與群組完全相同
（缺少 attachments 欄位視同空陣列）也移除；便箋已在其他地方改版時，舊版本的副本保留。
`InteractionController` 新增 `releaseDraft` hook：`endEdit`、`activate`（含「完成」、切換範圍、Esc）、改選其他卡、formation 結束編輯後都會呼叫，
主畫面先清除目前草稿參照再移除，避免背景 flush 寫回。U23 因此擴大為任何結束編輯的路徑，並移除上一段「焦點不在編輯框時保留」的例外。
編輯交給另一個 editor 接續（桌面 editor 與主畫面就地編輯互換、桌面或就地編輯的「完整編輯」、從草稿清單繼續同一份草稿）以 `endEdit({ keepDraft: true })` 延續草稿。
移除只是整理：失敗時在狀態列顯示「草稿整理失敗」，不中斷「完成」、formation 等原本的操作，最多多留一份草稿。
狀態列依草稿是否仍存在顯示「已關閉，沒有需要保留的草稿」或「草稿已保留」。

驗證：core 測試涵蓋未修改副本移除、有修改保留、便箋在他處改版後保留、缺少 attachments 欄位的比較；
controller 測試確認 endEdit／select／formation／activate／Esc／reconcile 都會呼叫 hook，`keepDraft` 不會；另測未修改副本的祖先一併移除。`desktop-authority` 14 項通過。
`npm test` 218 pass、8 skip；Python unittest 23 通過、4 skip。
本機 Chrome 臨時腳本（未加入 repo probe）另測：存一張便箋後「調整此組」並雙擊紙面，未修改按「完成」或 Esc 都不留草稿，修改後按「完成」保留。
主畫面對既有便箋開啟完整編輯對話框後未修改就關閉、桌面 editor 互換與「完整編輯」接續，沒有經過介面實測。

獨立審閱沒有發現資料遺失、`missing-draft` 或死結。依建議將移除改為不中斷操作，並補 Esc／reconcile／祖先測試。
審閱另指出、本次未處理的情況：
- 就地編輯一張卡時雙擊另一張卡，第二張無法進入編輯，出現「正在保存，請稍候。」。Chrome 8/8 次重現，已 commit 版本同樣 8/8，屬既有問題，不是本次回歸（已於上一段修正）。
  舊版重現時同時累積 8 份草稿，新版為 0。
- 編輯期間便箋版本因標為完成、封存、轉組或同步而改變時，未修改的副本會被視為舊版本而保留；`#afterTransfer` 結束編輯不經 hook。
- 草稿清單開著時，桌面端結束編輯若移除了清單中的草稿，按「繼續編輯」只會顯示找不到草稿。
- 改選其他卡時只局部重繪，未完成草稿數字可能要到下次完整重繪才更新。

## 2026-10-06 關閉編輯時不保留空白草稿

使用者決定：在編輯框本身關閉時，沒有文字（去除空白後）、附件或其他內容欄位的草稿不保留，記為 SPEC-003 U23，Esc 規則與操作說明同步更新。
原本開啟「記下想法」就會立即存一份草稿，不論是點關閉、保留草稿還是按 Esc 都會留下，而介面沒有捨棄草稿的操作。
`Workspace.discardBlankDraft` 等待前面排隊的寫入完成，只在草稿空白時以單一 commit 移除它；
從其他草稿恢復來的祖先，只有本身也空白且自恢復後未變更時才一併移除。不空白時直接返回，不額外寫檔。
`closeEditor`（關閉鈕、保留草稿、對話框 Esc、桌面 editor 結束）與桌面就地編輯的 Esc 都會使用它，狀態列顯示「已關閉，空白內容不保留草稿」。
其他會中斷編輯的流程（合併群組、備份、版本衝突、設定），以及焦點不在編輯框時的操作範圍 Esc，仍保留草稿（已由下一段「未修改草稿」改為所有結束編輯的路徑一致處理）。
獨立審閱沒有發現資料遺失問題；依建議：刪除前先清空編輯狀態，避免自動備份或轉背景時把空白草稿寫回；
就地編輯在等待期間不再因輸入而出錯；帶標題、分享 metadata 等其他欄位的內容一律不視為空白。
審閱另指出既有卡片開啟編輯後未修改就關閉，仍會留下一份與卡片相同的草稿；這不在本次範圍，尚未處理。

先前 Pixel 上的空白草稿：App 沒有其他內容（0 張便箋、收件匣空），經使用者同意以 `pm clear` 清除 App 資料移除。

驗證：新增 core 測試涵蓋空白／只有空白字元／有文字／只有附件／只有標題／不存在的草稿、恢復草稿與祖先、排隊中的文字保存優先，以及不空白時不寫檔。
本機 Chrome（Playwright，臨時腳本，未加入 repo probe）測過：關閉鈕、保留草稿、Esc 關閉空白草稿都不保留；
有文字的草稿保留，清空後再關閉不影響原稿，重新載入後仍在。
Pixel 9 Pro 實機開啟「記下想法」後直接關閉，未完成草稿維持 0。桌面就地編輯的 Esc 路徑沒有經過介面實測。

## 2026-10-06 Android 實機版面：避開系統列與鍵盤

在 Pixel 9 Pro（Android 17）安裝 debug APK。手機上原有一個 10/5 在另一台機器建置的 1.0.0（versionCode 10000）。
因為 debug 簽章不同且版本號較高，無法覆蓋安裝；經使用者同意移除舊版後安裝 0.1.0。
舊版資料庫只有一筆工作空間紀錄，最後寫入是安裝後一分鐘。
App 冷啟動正常，logcat 沒有 crash 或 JavaScript 錯誤，只有系統 WebView 本身的 hiddenapi／藍牙／DNS warning。
主畫面標題與「記下想法」按鈕被狀態列遮住：targetSdk 36 在 Android 15+ 一律 edge-to-edge，
原生程式卻直接把 WebView 設為內容，沒有處理系統列空間。
`FleetActivity` 改以 FrameLayout 包住 WebView，在 SDK 35+ 依系統列、挖孔與鍵盤 insets 留白，背景色與頁面 `--desk` 一致，狀態列圖示改為深色；
SDK 35 以下維持原行為。

驗證：重新建置並覆蓋安裝後，標題位於狀態列下方，狀態列圖示為深色；點「記下想法」開啟鍵盤時，編輯框留在鍵盤上方。
獨立審閱未發現缺陷。依建議移除 `20e8ee4` 起直接對 WebView 設 padding 的舊 insets listener：
它沒能讓頁面避開狀態列，加上外層容器後已不會被呼叫，留著日後可能重複留白。移除後重新安裝，主畫面正常。
這部分只有實機截圖驗證，沒有自動化測試。鍵盤收起後頁面停留在捲動後的位置，需手動往下拉才看到標題。
測試關閉編輯框時留下一份空白草稿；介面沒有捨棄草稿的操作，之後經使用者同意以清除 App 資料移除（見下一段）。
Android Studio 與終端機的 adb 搶用 5037 連線埠，反覆出現 `ADB server didn't ACK`；不影響 App，但部分 adb 指令需要重試。
Android Studio 第一次 Sync 失敗後沒有自動建立 `app` Run configuration，需在 Edit Configurations 手動新增。

## 2026-10-06 沒有桌面分層的平台隱藏常駐層級

使用者要求手機不要出現層級設定。卡片「更多操作」只在有桌面場景（Windows／macOS／Linux 原生）時顯示「常駐層級」與其說明；
Android／iOS 與瀏覽器預覽隱藏，已存的層級值原樣保留。「鎖定時可選取文字」保留，因為它在手機與瀏覽器的畫布上仍有作用。
只跑 `node --check`；依使用者指示不在本機編譯 Android／iOS，改到 macOS 開發機驗證。

## 2026-10-06 常駐層級改稱「桌布層／桌面層／最上層」

使用者指出「浮動」會讓人以為可以拖；能否拖曳取決於調整模式，與層級無關。依使用者決定：

- 「常駐層級」選單由後到前排列：桌布層、桌面層、最上層（原為「桌面、浮動、桌布層」）。內部值 `wallpaper`／`desktop`／`floating` 不變。
- 層級說明逐一列出；最上層註明能否拖曳取決於調整模式。「暫時置頂」統一改為「暫時移到最上層」，側欄連線提示同步。
- setup-guide 與 SPEC-003 用語對照同步。只跑 `node --check`，未跑 probe。
- 以 `b4dbc6e` 重新打包並刪除 `f09405b` 包；包內 `main.js` 已是新層級名稱。

## 2026-10-06 介面用語改為「鎖定／調整」

使用者決定：日常模式改稱「鎖定」，操作模式改稱「調整」，離開按鈕叫「完成」；改文字仍叫「編輯」，避免撞名。

- 主畫面：「調整此組／調整全部／完成」、狀態列「鎖定中／正在調整 X」、設定「鎖定時也顯示桌面便箋」「鎖定時可選取文字（不穿透滑鼠）」、
  層級說明與快捷鍵名稱。系統匣：Windows「調整所有便箋／完成調整」，macOS／Linux「調整所有群組」，Linux 快捷鍵說明同步。
- 「調整範圍」相關錯誤訊息同步；指單次動作的「操作」（更多操作、桌面操作未完成、主機沒有此操作）與程式內部名稱不變。
- 舊的 `src/macos`、`src/web` 原型未改。setup-guide、testing 與瀏覽器 probe 斷言已更新，SPEC-003 加註用語對照；ADR 與研究紀錄保留原文。
- 只跑語法檢查（`node --check`、`py_compile`、C# 編譯），未跑 probe。
- 以 `f09405b` 重新打包並刪除 `bdb9d68` 包；包內 `index.html` 已是新用語。

## 2026-10-06 Windows 浮動便箋開 App 時空白

使用者回報：開 App 時沒有便箋浮出，按「已完成」後才冒出一張。本機資料只有兩張「aaa」：一張桌面層（左上角，在所有視窗下方，
只有露出桌面時看得到），一張浮動層（常駐置頂）。「只有一張浮出」是正常行為；「已完成」本身沒有作用，只是觸發重新發布畫面。

- 根因：場景初始化時視窗是隱藏的，第一幀在隱藏時畫好；`scene.applied` 顯示視窗後 WebView2 composition 不會自己重畫，
  浮動層視窗已顯示、DOM 也有卡片，畫面卻是空白，直到下一次發布才出現。
- 修正：`DesktopCoordinator` 在 surface 由隱藏轉為顯示後 300 ms 送一次 `desktop-repaint`（scene 既有的 opacity 微調，Linux 已在用）。
  立即送出無效（已實測），composition 在 Show 之後才非同步恢復。
- 驗證：以使用者資料用 Debug 版重開三次。未修版本開啟後該區截圖空白；修正後兩次啟動都直接看得到浮動便箋，不需任何操作。
  UI probe 只檢查場景 DOM 有 `.card`，看不出畫面是否真的畫出，這個缺口未補。
- 以 `bdb9d68` 重新打包並刪除 `005d6c2` 包；安裝包本身未再實機開啟確認。
- 未檢查 macOS 是否有同樣問題。另觀察到版面 grid area 存的是 2560×1392，螢幕是 150% DPI（邏輯 1707 寬），未調查。

## 2026-10-06 主畫面改以清單為主、版面地圖留空

使用者看不懂主畫面「桌面」分頁。查證後：它其實是「待處理」篩選，在畫布檢視時改名；
畫布是瀏覽器預覽時期的唯一桌面，接上原生場景後只把座標平移到主螢幕工作區原點，1:1 不縮放且裁切，
只看得到主螢幕左上角約主視窗大小的範圍，規格／ADR 都沒有定義它在原生版的角色。依使用者決定：

- 有 `desktopPresentation` 的原生版預設清單，不再畫主畫面畫布；另一檢視「版面地圖」只留 `renderLayoutMap()` stub 與空白畫布，
  之後要做全部螢幕縮小的地圖。瀏覽器預覽與沒有桌面場景的原生宿主仍用原畫布。
- 「待處理」固定名稱；「桌面便箋已隱藏」從畫布內移到篩選列下方橫幅，清單與畫布都看得到。
- 原生版在主畫面按 Enter 開啟完整編輯，不再進入看不到的就地編輯。
- 原生版首次啟動沒有「先記下一件事」大型空狀態，清單只顯示「這裡還沒有便箋。」。
- ADR-018 加註此決定；setup-guide 同步。Windows UI probe 改讀清單（未執行）；只跑 `node --check` 與 UI probe 專案編譯。
- 以 `005d6c2` 重新打包並刪除 `4c38819` 包；未跑 `Test-WindowsPackage.ps1`。
- 下一步依使用者指示專注實際桌面的拖拉。

## 2026-10-06 macOS Android Studio 找不到 Node

使用者在 macOS 用 Android Studio 開啟 `src/native/android`，Gradle Sync 失敗：`Cannot run program "node"`。
Android Studio 從 Dock 開啟，Gradle daemon 以 launchd PATH（`/usr/bin:/bin:/usr/sbin:/sbin`）啟動。
IDE 雖會把含 nvm 的登入 shell PATH 傳給每次建置，JVM 執行未帶路徑的指令時仍只搜尋 daemon 啟動時的 PATH。
因此 Homebrew 或 nvm 安裝的 Node 都會失敗；終端機帶完整 PATH、沿用 IDE 的 daemon 也重現同樣錯誤。
`app/build.gradle.kts` 在沒有明確設定 `workFleetNode`／`workFleetNpm` 時，依建置收到的 PATH 解析 `node`／`npm` 絕對路徑；
Windows 維持原行為。Android README 改寫相關說明，Gradle user property 保留為 IDE 不載入 shell 環境時的備案。

連帶問題：Android 建置執行 `npm ci` 會清除 Xcode 的依賴標記，下次 Xcode 建置再執行 nvm 的 npm 時，
`#!/usr/bin/env node` 會因 Xcode PATH 沒有 node 而失敗（已用 Xcode PATH 重現 `env: node: No such file or directory`）。
`prepare-apple-build.mjs` 呼叫 npm 時，把正在執行的 node 所在目錄加到 PATH 前面。

驗證：停掉 IDE 的 daemon，以 launchd PATH 啟動新 daemon，再用含 nvm 的 PATH 沿用同一 daemon：
`help` 設定成功，`assembleDebug` 執行 `npm ci` 並產生 `app-debug.apk`。
Xcode 的 PATH 加上 nvm npm 的情境下，資產準備完成 `npm ci` 並重建標記。
新增回歸測試：PATH 沒有 node 時，假 npm 仍能透過 shebang 執行；拿掉修正時這個測試會失敗。
`npm test` 215 pass、8 skip；Python unittest 23 通過、4 skip。
獨立審閱未發現缺陷。依其 Low 建議：有明確設定時不讀 PATH、略過相對 PATH 項目，
測試另外確認 npm 使用的就是執行腳本的同一個 node；調整後沿用 launchd PATH daemon 的設定階段仍成功。
尚未在 Android Studio 介面重新 Sync，也尚未安裝到 Android 實機。

## 2026-10-06 iOS 實機啟動修正

使用者要求把 App 安裝到 iPhone 16 Plus（iOS 27.0.1）。Xcode 建置先因 Node 不在 Xcode PATH 而失敗：
Node 由 nvm 安裝，在 Git 忽略的 `Local.xcconfig` 設定 `WORK_FLEET_NODE`／`WORK_FLEET_NPM` 後即可建置。
安裝後 App 一啟動就收到 SIGTRAP。從 iPhone 取得的 crash log 停在
`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`，原因是 iOS 27 SDK 要求採用 UIScene 生命週期。
iOS `Main.swift` 改由同檔的 `FleetSceneDelegate` 負責建立視窗與 FleetWebHost、Google URL 回呼（冷啟動與執行中）
及前背景保存事件。`prepare-apple-build.mjs` 在 iOS Info.plist 加入單一場景 manifest（不支援多場景），Share Extension 不加入。
獨立審閱指出：場景斷線再連線時，舊 host 會被 WebKit message handler 留住並持有工作空間 flock，
新場景因此開不起來；斷線也會讓背景保存的 background task 無法結束。已改為整個 process 共用一個 host
與背景保存狀態，再連線的場景沿用同一 WebView。

驗證：Xcode 27.0 的未簽章 iOS device Debug 建置與開發簽章建置都成功，產物 Info.plist 的 delegate 展開為
`WorkFleetIOS.FleetSceneDelegate`。改為共用 host 後重新簽章建置，以 devicectl 安裝到 iPhone；
App 啟動 20 秒後仍在執行，沒有新的 crash log。
從裝置截圖確認主畫面、群組、分享收件匣計數與「尚未啟用 Google 登入」提示正常顯示。
`npm test` 214 pass、8 skip；Python unittest 23 通過、4 skip；`apple-project.test.js` 新增 scene manifest 與單一場景斷言。
獨立審閱複查確認上述修正有效，另報兩個 Low 邊界情況，本次未修：
- WebContent process 被終止，同時場景也斷線時，再連線會沿用已停止的 host，畫面空白且不再顯示錯誤，需重開 App。
- 資料夾選擇器開啟時場景被拆除，`directoryContinuation` 沒有逾時，之後的資料夾選擇會一直回報不可用，直到 App 重啟。

尚未做完整編輯／附件／備份操作、iPad、Share Extension 實際分享、背景保存、場景重連或 Google 登入驗收。

## 2026-10-06 系統匣與 App 圖示

使用者回報 Windows 系統匣與工作列沒有圖示，並要求再確認 macOS／Linux。

- Windows：exe 先前未嵌入圖示，系統匣用系統預設 `IDI_APPLICATION`。新增 `scripts/generate-windows-icon.mjs`，
  以既有紙張圖示產生 16–256 px 的 `src/native/windows/app/WorkFleet.ico`（已提交），csproj 設 `ApplicationIcon`；
  WPF 視窗／工作列沿用內嵌圖示，系統匣以 `ExtractIconExW` 取小圖示，沒有內嵌時才回退預設圖示。
  MSIX 開始選單 logo（paper-44／50／150）原本就有；打包流程沒有 makepri，所以不加 targetsize 變體。
- macOS：App 圖示原本已設定（`AppIcon` asset catalog）；選單列先前只有文字「w.」，改為 SF Symbol `note.text` 樣板圖示。
- Linux：視窗圖示與 DEB 的 hicolor 圖示原本已設定；系統匣只靠圖示主題名稱，可攜 tar.gz／開發執行找不到。
  現在 AppIndicator 設 `set_icon_theme_path` 指向內附 `Icons/`，`Gtk.StatusIcon` 直接讀檔。
- 驗證：Windows Debug build 無錯，exe 內含 1 個圖示；Apple 用的 RGB PNG 輸出與已提交檔案位元相同；
  `host.py`／`tray.py` 通過 `py_compile`。未安裝新包看實際系統匣，未在 macOS／Linux 實機確認。
- 使用者指示需要打包才能確認的修改直接打包；已以 `4c38819` 重新打包並刪除 `8a941b3` 包。

## 2026-10-06 主視窗 X 收起到系統匣

使用者要求主視窗按 X 後仍常駐系統匣，並指示接下來一連串改動先不花時間測試。

- Windows：只攔 WM_SYSCOMMAND／SC_CLOSE（X、Alt+F4、工作列關閉），tray 可用時直接 Hide；
  系統匣「保存並結束」、程式內 Close 與 WM_CLOSE（含測試及 `CloseMainWindow()`）仍走 durable close。
- macOS：`windowShouldClose` 在選單列項目存在時 orderOut；結束走「保存並結束」或 Cmd+Q。
- Linux：`delete-event` 先嘗試 `Tray.hide()`，系統匣不可用才走保存退出。
- ADR-019 原「不把 X 改為默默常駐」已依使用者新決定改寫；ADR-023／025 與 setup-guide 同步。
- 驗證：Windows C# 編譯無錯（Debug build 只缺建置腳本產生的 `build/config/public.json`），
  `host.py` 通過 `py_compile`；未跑原生 probe、未在 macOS／Linux 實機確認。
- 側欄「收起主畫面」按鈕與 X 重複，依使用者指示移除；系統匣選單同名項目保留。
  Windows shortcut probe 改由 `DispatchAction("@hide")` 觸發同一收起流程（未執行）。
- 以 `8a941b3` 重新打包 `-LocalTestSign` MSIX；打包前 `build/windows` 已是空目錄，沒有舊包需刪。
  只做建置腳本內建的 signtool 驗證與包內 `index.html` 已無 `hide-main` 的檢查，未跑 `Test-WindowsPackage.ps1`。

## 2026-10-05 主視窗與紙色改版

使用者核准範圍為「主視窗＋紙色」，深色模式本輪不做。共用 `src/app` 與桌面層樣式依下列方向改版：
- 介面只用中性色與品牌松綠 `#245F50`，顏色留給群組紙色。桌面縮圖改為灰綠桌墊 `#C9D3CE`，群組格線平常淡顯。
  工具列分為操作模式切換、輪播箭頭與排列文字動作。中文取消負字距，字型改用各平台系統字型。
  CDP 實測 Windows 使用 Segoe UI Variable 與 Microsoft JhengHei UI；CSP 不允許外部字型，因此不打包字型。
- 九組紙色改為相鄰色相明顯不同的 `#FFE98A`、`#BFE6CF`、`#BCD8F5` 等。主視窗與桌面層共用，使用者桌面上的便箋顏色同步改變；
  清單卡片以紙色左邊線標示群組。
- `scene.css` 只改紙面邊線、「我的」標記與選取樣式。選取改用內縮 outline，不加外陰影（ADR-017 透明像素命中規則）；
  36px 標題帶與 160×96 最小尺寸不變。
- 新增「桌面便箋已隱藏」狀態：日常顯示關閉且沒有可見便箋時，縮圖說明隱藏張數並提供「顯示桌面便箋」，只有使用者按下才改設定。
  起因是 CDP 檢查真實資料時，2 張便箋因顯示關閉而桌面全空，畫面沒有任何說明。
- 移除標題上方無資訊的「你的工作空間」。`#storage-note` 由「·」串接改為分行，保留 Apple probe 檢查的開頭。

驗證：Debug＋CDP 在 1166×763、900、600 寬度截圖主畫面、清單、設定與草稿對話框，含注入但不存檔的示範卡；
`npm test` 213 pass、9 skip；Python unittest 23 通過、4 skip；`Test-WindowsNative.ps1` 通過（前景授權依規則 SKIP），
含紙面不透明、空白零 alpha 與跨程序穿透。Windows UI probe 新增流程：關閉日常顯示後須出現隱藏提示與張數，
按「顯示桌面便箋」後提示消失、卡片回到縮圖。`scene.css` 只經原生 alpha／命中 probe 間接驗證，未截圖看過實際桌面紙面；
未在 macOS、iOS、Android 實機檢查新樣式。之後以 `4341aa9` 重新打包，取代並刪除改版前的 `eede2d7` 包，安裝由使用者執行。

## 2026-10-05 Linux DEB 版號與輸出位置修正

依使用者指示，`0.1.0` 已表示早期版本，DEB 的套件版號與檔名不再附加 `~preview`。
Linux `build-native-app.sh --deb` 與 Windows `Build-LinuxPackage.ps1` 都直接輸出
`build/work-fleet_0.1.0_all.deb`；一般與 release 建置使用同一版號，release 仍檢查正式公開配置與 email。
共同封裝腳本在成功／失敗結束時清除本次 staging，不刪除既有產物；
source/runtime 副本與 tar.gz 的建置輸出仍在 `build/linux/`。

Raspberry Pi 實際執行完整建置，DEB 直接產生於 `build/` 根目錄，沒有手動搬檔。
目前交付：`build/work-fleet_0.1.0_all.deb`（177,248 bytes，Architecture: all）。
SHA-256：`9733e874acdaa22d55695ee740fc08d0c9df4b57bbd44fbc5a32671c4895a6f4`。
APT 已由 `0.1.0~preview` 更新為 `0.1.0`，再以最終根目錄 DEB 重新安裝；沒有升級或移除其他套件。
依先前清理要求刪除舊 DEB 與本次生成的 app／config／Linux 中間產物，`build/` 僅保留新 DEB。
下方先前 Pi 建置與清理的 `~preview` 版號、路徑與 hash 保留為歷史紀錄。

作者檢查：完整 Python 測試 23／23 通過，含雙模式版號、release 缺值、staging 清理與
含空白 checkout 路徑的完整建置輸出回歸；Bash 語法、套件 metadata／hash、
`dpkg-query`、`work-fleet --help`、`sudo -n apt-get check` 與 `dpkg --audit` 通過。
同步更新 setup／deployment／testing／Linux README 與 ADR-028。
本機無 PowerShell，未執行 Windows／Docker 建置入口；未驗收 GUI、使用者資料或 Google。沒有獨立審閱。

## 2026-10-05 Windows 本機 build 目錄整理與目前交付

依使用者要求整理 Windows 開發機上 Git 忽略的 `build/`：刪除 292 項、約 2.58 GB，包括各輪 probe／review 證據目錄、log、截圖、
一次性腳本與 SDK 授權查閱檔、舊 Windows 封裝、Linux staging、舊版 1.0.0 的 APK／DEB、過期的 Apple 生成專案與未被腳本使用的 npm cache。
本檔較早各節引用的 `build/` 證據路徑因此已不存在，紀錄內容保留。
保留腳本使用的 `app`、`config`、`dotnet-home`、`nuget-packages`、`gradle-home`、`toolchain`。

一次性的 Explorer 宿主盤點腳本改為 `scripts/windows/Get-ShellLayerInventory.ps1`，補上說明，
PowerShell 7 與 5.1 實際執行通過；它是唯讀診斷，用法見 testing 的桌布層段落。

目前交付：
- Windows（`df36150`，`-LocalTestSign`，含紙色改版、X 收起到系統匣、圖示、清單為主的主畫面、最上層便箋開啟重繪、鎖定／調整與三層命名、草稿整理與編輯中雙擊修正、帳號區與窄視窗抽屜、桌面圖示可點）：`build/windows/package-218998bf271a41899acecf7d9be85e3b/`。
  `WorkFleet-0.1.0-x64.msix` 24,932,271 bytes，SHA-256 `90488221d006d043cd531f743a3f0196fc64ec1d7a776975b89f0a4a6c5a7fa4`；
  簽章憑證 `A646FA7F1E38E5E99C7F1D5BC9C147A1D51C608D`，建置腳本 signtool 驗證通過。
  另有 `WorkFleet-0.1.0-x64.zip` 與公開 `WorkFleet-preview.cer`。
- Linux：保留 `build/linux/work-fleet_0.1.0~preview_all.deb` 與 `work-fleet-0.1.0.tar.gz`。Android 目前沒有 0.1.0 產物。

## 2026-10-05 本機 build 產物清理

依使用者要求盤點並清理本機 `build/`，只保留
`build/apple/preview-macos-universal-development-os1ji0ur/` 的最新開發簽章 universal DMG、
App 暫存副本、README、hash 與包裝驗證紀錄。DMG SHA-256 與原交付一致，`hdiutil verify` 通過。

可重用的啟動驗證已在 `scripts/testing/apple_startup_probe.py` 與
`tests/native/apple/StartupProbe.swift`；Apple 資產準備與授權複製也已提交。
臨時診斷片段、baseline 與 probe 來源副本沒有需要另行移入 repo 的程式；
結論已記錄於 [研究紀錄](docs/resreach/2026-10-05-apple-signed-startup-and-local-scripts.md) 與 ADR-033。

刪除 DerivedData、下載依賴／npm 快取、測試副本、舊包、暫存日誌、路徑指標與 Xcode 備份。
下方歷史段落引用的本機 Apple 暫存證據路徑已清除，測試結果保留為當時紀錄。
先前 Xcode target 的 Team 已移至 Git 忽略的 `src/native/apple/config/Local.xcconfig`，
project／iOS scheme 已還原；本次保留該本機配置。

作者檢查：清理後目錄、保留檔案 hash、DMG 完整性及文件／diff 檢查。
本次未修改產品程式或重跑編譯／回歸；沒有獨立審閱。

## 2026-10-05 修正 release 設定測試

`tests/config.test.js` 自建立後未隨 `scripts/config.mjs` 更新，導致兩項既有失敗。
逐版回測確認原因：`20e8ee4` 新增 Android web client、`f213f4e` 新增各平台隱私／支援 URL 與 email、
`279821d` 新增 Windows package ID／publisher，這些都是 `.env.example` 與各平台 release 檢查使用的必填欄位。
程式行為正確，只更新測試：Windows 完整設定回報無缺漏、Android 空設定列出完整 7 項、Windows 要求 package ID／publisher，
並新增 web client、package ID、HTTP／含帳密 URL 與 email 格式錯誤的拒絕案例。

作者檢查：本機 `node_modules` 尚未安裝 `530207b` 新增的 esbuild，Apple 專案測試因此失敗；
依 setup 執行 `npm ci --ignore-scripts` 後，完整 `npm test` 為 213 pass、0 fail、9 個平台／原生環境 skip。

## 2026-10-05 Windows 專案層級與 IDE 設定

依使用者要求，Windows 比照 Apple／Android 使用單一平台根目錄 `src/native/windows/`：
`WorkFleet.sln` 與 README 在根目錄，主程式移到 `app/`，核心移到 `core/`；
測試移到 `tests/native/windows/{core,ui}`，放在解決方案的 `tests` 資料夾。以 `git mv` 保留歷史。
組件名稱、namespace、`WorkFleet.exe` 與 MSIX identity 不變；Debug／Release 輸出改在 `app/bin/`。
提交 `.vscode` 的 C# Dev Kit 建議、預設解決方案、建置／原生測試 task 與兩個 F5 設定（一般、CDP 9339）。
`.gitignore` 放行 tasks／launch 並忽略 `.vs/`、`*.user`；`.sln` 固定 CRLF。
這是目錄與工具設定調整，不涉及架構決策，因此沒有新增 ADR。

作者檢查：搬移前刪除 Git 忽略的舊 `bin/`／`obj/`；locked restore 通過且 4 個 lockfile 內容未變。
解決方案建置 4 個專案 0 警告；`Test-WindowsNative.ps1 -SkipRestore` 完整通過（foreground grant 依規則 SKIP）。
以 Windows PowerShell 5.1 執行 build task 指令通過；未簽章 Release 封裝與 Release `-IncludeTests` 皆 0 警告／0 錯誤。
`npm test` 211 通過、8 個 native 依規則 skip、2 個失敗：`tests/config.test.js` 的 release 設定預期。
同一 HEAD 未修改的檔案也有這 2 個失敗，屬既有問題，本輪未處理。
紀錄：`build/windows-layout-native-tests.log`、`build/windows-layout-release-package.log`、
`build/native-checks-7b41e196-9965-4882-bdfe-cf231684cc0b/`。
本機沒有安裝 C# 擴充，VS Code 實際按 F5 除錯未驗證；沒有獨立審閱。

## 2026-10-05 Windows Debug WebView 檢查

依使用者要求，Debug 組態可開 WebView DevTools，Release／MSIX 一律不開。
`WebViewDiagnostics` 以 `#if DEBUG` 分流；主畫面與桌面場景使用同一設定。
loopback CDP 只在程序環境設 `WORK_FLEET_WEBVIEW_DEBUG_PORT` 時開啟，不合法 port 在 owner 鎖前拒絕。
使用者明確要求 Debug 沿用正式資料目錄，以便用 Debug 版追查正式資料的問題；未另設 Debug profile。
使用者未回覆是否需要可安裝的 Debug MSIX；本輪預設不提供，直接執行 Debug exe。
`Build-WindowsPackage.ps1` 在 Release `WorkFleet.dll` 發現 `remote-debugging` 即停止封裝。
決策見 [ADR-032](docs/decisions/032-windows-debug-webview-inspection.md)，ADR-015 狀態已標註修訂。

作者檢查：新 `--diagnostics` probe 確認未設變數不開 port、7 種不合法值被拒絕且之後同一目錄可開啟，
DevTools 已啟用、listener 只綁 loopback，CDP `/json/list` 有主文件，並經 WebSocket 讀取 DOM 狀態。
封裝掃描對 Debug `WorkFleet.dll` 命中、對 Release 未命中；Release 組態 probe 拒絕執行診斷模式。
第一次 Release `-IncludeTests` 建置因 `const` 常數條件觸發 CS0162 而失敗，改為 static property 後通過。
審閱修正後（shell 預設不合法 port 變數）`Test-WindowsNative.ps1 -SkipRestore` 完整通過（foreground grant 依規則 SKIP），未簽章 Release 封裝 0 警告／0 錯誤。
紀錄：`build/debug-webview-native-tests.log`、`build/debug-webview-release-package.log`、
`build/native-checks-2c41bfef-408d-4e0d-b90e-953bc72116bf/`。
本輪未重新安裝 MSIX；右鍵「檢查」選單沒有實機點擊驗證。
另由獨立 agent 唯讀審閱，未發現 Release 可開啟 DevTools／port 的路徑。依審閱修正：
ADR／services 改述 loopback 不分 Windows 使用者；
Test-WindowsNative 先清除外部設定的 port 變數，並要求封裝掃描命中 Debug DLL；HostError 代碼改連字號。

## 2026-10-05 macOS 開發簽章與啟動修正

使用者完成 Xcode Apple Development 憑證與 Register Device 後，已取得 team `97JBZ3MFX5`
的有效 identity 與允許本機的 wildcard profile（到期 2027-10-05）。保留使用者在 Xcode 修改的
project／iOS scheme，不提交機器簽章配置、憑證或 provisioning profile。

先前未簽章 App 的 Data Protection Keychain update 可重現 `-34018` missing entitlement；
本輪簽章含正確 Sandbox、application identifier、team identifier 與 Keychain access group。
另一個重複建置失敗來自唯讀依賴 LICENSE；notice copier 改為 `cp -f`，實際覆寫回歸通過。

有效簽章後，真 Keychain／SQLite 已通過，但 WKWebView 的本機 module script 仍載入失敗。
Apple 資產準備改用固定 esbuild 0.28.2 將主畫面與場景合併為 classic deferred scripts，
來源與其他平台仍為 ESM，保留 CSP／bridge／Sandbox 與完整 runtime LICENSE。
決策與診斷見 [ADR-033](docs/decisions/033-apple-local-script-bundles.md) 及
[研究紀錄](docs/resreach/2026-10-05-apple-signed-startup-and-local-scripts.md)。

以 Debug、`ARCHS=arm64 x86_64`、`ONLY_ACTIVE_ARCH=NO` 成功重建並開發簽章。
主程式與兩個 dylib 均含 arm64／x86_64；`codesign --verify --deep --strict`、
DMG 完整性與唯讀掛載後的實際簽章／架構／Keychain entitlement／資產核對通過。
新版交付與 hash 見本節下方，取代先前未簽章 DMG 作為本機試用入口。

交付：`build/apple/preview-macos-universal-development-os1ji0ur/WorkFleet-0.1.0-macos-universal-development.dmg`。
大小 2,984,301 bytes；SHA-256：`9fbb337e7503182f85913802d89d192a5a74fc2dda0e69e983dd56f4474e0998`。
交付目錄保留 `verification.json`／`dmg-verification.log`／`SHA256SUMS.txt`，授權聲明與最後來源一致。

`scripts/testing/apple_startup_probe.py` 在唯一 bundle identity 與獨立資料目錄編譯真原生 host：
Keychain 建立／更新／讀取、加密 SQLite 重開、主畫面 native bridge／renderer 初始化及
probe 自有 Keychain 清理全部通過。最終 probe 不替換正式 bridge handler，也不讀取使用者 workspace。
證據：`build/apple/native-startup-ndo0tdm1/`；交付的兩份腳本與測試版比較一致，僅正規化依賴來源路徑。

Apple 專案／資產回歸 4／4；完整 `npm test` 為 212 pass、8 個原生環境 skip、2 fail。
兩個 fail 都是既有 `tests/config.test.js` 對 release 必填欄位的舊期待，未修改的 `8664bde`
同樣失敗；baseline 證據在 `build/apple/config-baseline-4g952_ow/result.txt`。不將完整回歸宣稱為通過。
原生重建紀錄：`build/apple/macos-universal-development-rebuild.log`；JS 紀錄在同目錄的
`apple-development-tests.log`／`javascript-development-tests.log`。文件／diff 與腳本語法檢查通過。

此包是 Apple Development 的本機預覽，只允許 profile 登記裝置，沒有 Developer ID／公證。
未驗收 Intel 實機、iOS、Google 登入、IME／Spaces 或完整桌面互動；完整 1.0 仍未完成。
沒有獨立審閱可用；上述是作者執行的測試與機械檢查。沒有安裝產品、重設 Keychain、刪除個人資料或啟動 hosted Actions。

## 2026-10-05 macOS universal DMG（先前未簽章產物）

在 Apple Silicon Mac 使用 Xcode 27.0（27A266a）、macOS 27 SDK、Node 24.21.0／npm 12.2.0，
首次編譯目前的原生 WorkFleetMac。修正選單區域變數 `quit` 遮蔽同名方法造成的 selector 編譯錯誤，
不變更結束／保存流程；保留本輪 Xcode 產生的 SPM lockfile，以固定實際解析的依賴版本。

以 Debug、`ARCHS=arm64 x86_64`、`ONLY_ACTIVE_ARCH=NO`、`CODE_SIGNING_ALLOWED=NO` 成功建置。
本機沒有有效 code-signing identity；未繞過 Release 配置要求、停用產品安全儲存或建立憑證。
產出原生未簽章 preview，並以 hdiutil UDZO 封裝，內含 App、Applications 捷徑與使用限制說明。

交付：`build/apple/preview-macos-universal-pttdnsm8/WorkFleet-0.1.0-macos-universal-unsigned.dmg`。
大小 2,747,893 bytes；SHA-256：`e740adcb9f8dc9b5a4aa10211b0099ac83aa566966835d4b2a56bc1fb9733341`。
主程式、`WorkFleetMac.debug.dylib` 與 `__preview.dylib` 均含 arm64／x86_64；
`hdiutil verify` 通過，唯讀掛載後再次核對版本、bundle ID、各 binary 架構、renderer／公開配置及授權。
完成後已卸載檢查映像，未安裝或啟動產品 App、讀取個人便箋或啟動 hosted Actions。

Apple 專案／資產回歸 3／3、文件與 diff 檢查通過；雙架構原生編譯是 selector 修正的驗證。
建置有一項未使用 AppIntents 的 metadata extraction 警告；不影響編譯完成。
證據：`build/apple/macos-universal-rebuild.log`、`build/apple/apple-project-tests.log`，
及交付目錄中的 `verification.json`／`dmg-verification.log`／`SHA256SUMS.txt`。
沒有獨立審閱；未驗收產品 runtime、Keychain、Intel 實機、Google 登入、手勢／Spaces 或正式簽章／公證。
未簽章 preview 的 protected storage／Google 仍需合適的 Apple signing，不能當作完整可用版本或正式散布。

## 2026-10-05 Raspberry Pi Debian 建置與安裝

在 Raspberry Pi 5 Model B Rev 1.1、Debian 13.7 arm64、labwc／Wayland 環境，
使用 Node 24.21.0、Python 3.13.5 與 lockfile 依賴執行
`bash scripts/linux/build-native-app.sh --deb`，成功建立 source/runtime tar.gz 與
`build/linux/work-fleet_0.1.0~preview_all.deb`（176,964 bytes，Architecture: all）。
DEB SHA-256：`a356122d986bc7ac41d32304fd433da9be3093f3315fc7c1ff36279bdf434a68`。

APT 預檢後以 `sudo -n apt-get --no-remove -y install "$PWD/build/linux/work-fleet_0.1.0~preview_all.deb"`
成功安裝，並補齊 `python3-gi-cairo` 與 `gir1.2-keybinder-3.0`；沒有升級或移除其他套件。
`dpkg-query` 確認三個套件均為 `install ok installed`；`sudo -n apt-get check`、`dpkg --audit`、
`work-fleet --help`、已安裝 host 的 Python 模組載入與 `--help` 檢查通過。
Desktop entry 驗證通過，另提示 Office／Utility 雙主分類可能讓選單重複顯示；
host 載入另有未明確指定 Gdk 版本的 PyGIWarning，未阻止上述檢查。

可從應用程式選單開啟 Work Fleet，或執行 `work-fleet`。
本輪沒有啟動 GUI、操作金鑰圈／使用者便箋或驗收桌面分層、中文 IME、Google 往返。
產品程式碼未修改，沒有獨立審閱；安裝包保留在 Git 忽略的 `build/` 目錄。

依使用者要求清理後，交付檔移至 `build/work-fleet_0.1.0~preview_all.deb`，
大小與 SHA-256 均未變更；`build/` 僅保留此 DEB。
已移除產生的 web 資產、公開設定、npm 快取、DEB staging、Linux source/runtime 副本及 tar.gz。
已安裝的 `work-fleet` 仍為 `0.1.0~preview`，啟動器 `--help` 檢查通過。
本次只整理本機產物並更新此紀錄；建置腳本仍預設輸出到 `build/linux/`。

## 2026-10-05 試用版本降為 0.1.0

依使用者最新指示，不採用原先擬議的 `1.0.0.1` 升級版本，改為 `0.1.0`。
Windows App／core assembly 與 MSIX identity 均為 `0.1.0.0`，產物名稱改為 `WorkFleet-0.1.0-x64`。
package identity／publisher 與既有自我簽章憑證保留；只改版本 metadata，沒有回退功能或資料格式。
Apple Info.plist／封裝檔名、Android versionName／versionCode（0.1.0／100）、Linux bundle／DEB
及相關文件同步為 0.1.0；第三方依賴版本沒有變更，歷史實測紀錄保留。

以 `Build-WindowsPackage.ps1 -SkipRestore -LocalTestSign` 重新編譯，
自動選到原本已在機器信任存放區的憑證，原生 Release 與 SignTool 驗證均為 0 警告／0 錯誤。
目前交付目錄：`build/windows/package-34ab358242154674a558e7632588446b/`。

- 已簽章 `WorkFleet-0.1.0-x64.msix`：24,920,251 bytes／118 entries，identity version 0.1.0.0。
  SHA-256：`cf24930b1433f6f317ccec8a2e99594594286d22caa78ba3f466e1eb8a93e8c3`。
- `WorkFleet-0.1.0-x64.zip`：25,160,966 bytes／137 entries。
  SHA-256：`969eb3eee6d5601a0598a5c7748757bce1b7b00ed0b71ffcfdd6ed45cf47adda`。
- 配套公開 `WorkFleet-preview.cer` 與同一張簽章憑證相符，不含私鑰。

作者檢查：Windows package signing 回歸通過，實際 App／core assembly 版本 0.1.0.0，
壓縮檔完整且 DLL／renderer 與最後建置相同。Apple 可攜專案／資產準備測試 3／3 通過；
Linux 實際重建 DEB／tar.gz，bundle metadata 為 0.1.0，dpkg-deb 回報 0.1.0~preview。
改動 Bash 與 PowerShell 入口語法、Python archive 入口語法、文件與 diff 檢查通過。
紀錄：`build/windows-0.1.0-signed-build.log`、`build/preview-version-apple-tests.log`、
`build/preview-version-linux-package.log`。本輪未重跑產品互動測試，也未編譯 Apple／Android 原生二進位。
使用者已表示將自行刪除舊版重裝；本輪未解除安裝、安裝 App、修改信任或刪除任何資料，沒有獨立審閱。

## 2026-10-05 Windows 本機自我簽章試裝包

使用者指出已有自我簽章憑證，卻又收到未簽章 MSIX；核對真正的 Windows 憑證存放區後，
確認既有 `CN=Work Fleet Preview` 位於 CurrentUser/My 並有私鑰，
同一張公開憑證已在 LocalMachine/TrustedPeople 信任。上一輪建置漏用了該憑證。
補上 `Build-WindowsPackage.ps1 -LocalTestSign`，重用與 manifest publisher 完全相符、
有效且已信任的現有 code-signing 憑證；多張時使用 `-CertificateThumbprint` 指定。
缺少合適憑證時明確失敗，不回退交付未簽章檔案；不能與 `-Release` 或 timestamp 選項合用。
此模式不建立憑證、改信任或安裝 App；私鑰留原本存放區，只輸出公開 CER。
正式簽章的 HTTPS timestamp 入口保留，setup／deployment／testing 及 ADR-028 已同步。

本輪使用既有 thumbprint `A646FA7F1E38E5E99C7F1D5BC9C147A1D51C608D` 執行
`Build-WindowsPackage.ps1 -SkipRestore -LocalTestSign -CertificateThumbprint <thumbprint>`。
原生 Release 建置 0 警告／0 錯誤，MSIX 簽章成功，SignTool `/pa /v` 實際驗證成功，0 警告／0 錯誤。
簽章憑證至 2027-10-05 有效；本機已信任，可直接開啟新的 MSIX 安裝，不需 Windows Store 開發者帳號。
目前本機試裝交付使用 `build/windows/package-1f64d58d40694c6e86f0a9c0e6eead7f/`，
取代上一節未簽章 MSIX 作為試裝入口：

- `WorkFleet-1.0.0-x64.msix`：24,920,229 bytes，118 entries，已簽章。
  SHA-256：`3fd0739d4ac036ef85d698597d3698ec9cdb7b03c1137ddc4a203fc301e321ea`。
- `WorkFleet-1.0.0-x64.zip`：25,160,921 bytes，137 entries。
  SHA-256：`84f0299b146444675cefdade5d4252d253ee8666a0c987b3b9829e7e351dd298`。
- `WorkFleet-preview.cer`：796 bytes，與實際簽章相同，沒有私鑰。

作者檢查 `Test-WindowsPackage.ps1` 通過：四種不合法參數在建置前拒絕，
Windows 真正驗證簽章／機器信任、publisher／x64 manifest 與 companion CER 的公開性。
兩個壓縮檔完整，DLL／desktop renderer 與最後建置相同，MSIX 含真正的簽章 entry。
紀錄在 `build/windows-local-signed-build.log`；未重跑產品 runtime 回歸，未實際安裝或啟動 App。
沒有獨立審閱；沒有新增信任、匯出私鑰或申請商店帳號。

## 2026-10-05 Windows 安裝檔再次建置

依使用者要求，以 `main` 的 `e95c9f2` 程式碼執行
`scripts/windows/Build-WindowsPackage.ps1 -SkipRestore`，重新建置介面與原生 Release，0 警告／0 錯誤。
新產物位於 `build/windows/package-8ae5dfafb7d94baa90dc2c6d6364aa0d/`：

- `WorkFleet-1.0.0-x64.msix`：24,919,296 bytes，未簽章，安裝前仍需可信簽章。
  SHA-256：`7497e2239e1f39dcc15dee4576ae8caa46a24408ff261a98e452224b1df3acd8`。
- `WorkFleet-1.0.0-x64.zip`：25,160,919 bytes，完整解壓後執行 `WorkFleet.exe`。
  SHA-256：`a9d6b0ce5b546beefd63283111a3b37cbcb6567afbf1396b6887b7223263e83c`。

作者機械檢查確認兩個壓縮檔完整、必要入口／公開配置／x64 WebView2 loader 存在，
包內 DLL 與最後 Release 相同、desktop renderer 與最後介面建置相同，沒有 `.env` 或私鑰檔。
MSIX manifest 的 architecture 為 x64；本機已有 .NET 8 Desktop Runtime 8.0.31。
建置紀錄為 `build/windows-installer-build.log`；未重跑先前已通過的原生回歸。
未進行簽章、安裝或憑證信任變更，沒有獨立審閱；產品程式碼未修改。

## 2026-10-05 macOS／Linux 分層補齊與原生成果接續

依「都補完再停手」要求，完整核對維護者提供的參考 Linux layer-shell／DEB 實測報告，
包括 Pi 5／labwc 的 input shape、DMA-BUF、透明 WebKit 重畫及 pcmanfm 圖示限制。
macOS 增加 `desktopWindow + 1` 桌布場景；Linux layer-shell 增加 BACKGROUND，
desktop／floating 使用 BOTTOM／TOP。三層場景池、能力回報、frame 檢查、topology 與操作組退出還原均接入。
桌布場景固定穿透並拒絕 focus；Linux widget input shape、queue draw、size request 與重畫事件已補齊。
實際 Linux probe 另發現原本 Pycairo `subtract_rectangle`／`union_rectangle` 不存在，
已改用真正的 `Region.subtract`／`union`，修復原生紙面套用。
Linux 使用者未指定 renderer 時停用 DMA-BUF，未改用者桌布檔案或設定。
決策見 [ADR-031](docs/decisions/031-macos-and-linux-wallpaper-scenes.md)，
參考核對見 [研究紀錄](docs/resreach/2026-10-05-desktop-layer-reference-follow-through.md)；沒有複製參考程式碼。

作者檢查：Python 全套 19／19、共用桌面及 Apple 專案 JavaScript 66／66 通過。
Windows `Test-WindowsNative.ps1 -SkipRestore` 最終完整通過：35 項 native core／備份／frame、
10 項 JS→native、實際 WPF／WebView2／SQLite、composition／跨程序命中、顯示器／快捷鍵與 live Explorer 桌布探針。
首次執行遇到測試把 300 ms 回覆遺失時限也套到冷啟動，已分開啟動等待及測試時限，補上失敗 child 清理後完整重跑。
正向 foreground grant 依既有規則明確 SKIP；拒絕情境通過。
最終 Windows 證據：`build/native-checks-0a82d8a7-c373-44f4-9373-aede1989e9e5/`。

Linux 使用隔離 Ubuntu 24.04 x64／labwc 0.7.1／GTK 3.24.41／WebKit 2.52.6／gtk-layer-shell 0.8.2，
實際 owner→三個 WebView→native layer-shell 流程通過。共用 Workspace／InteractionController 產生八個情境，
涵蓋 wallpaper→操作組浮起→退出還原、desktop 可選字、常駐 floating、再切桌布及反覆隱藏／顯示。
合成器 PNG 確認操作組位於普通視窗上方、退出後回到其下，另一組保持背景；topology 重用位置不變。
實際 Wayland trace 確認 11 次桌布空 input region／無鍵盤需求提交及 2 次互動紙面提交。
最終 Linux 證據：`build/linux-layer-checks-final/`，包含版本、PNG、protocol trace 與輸入區域結果。
此測試不讀取個人便箋或桌面設定，未執行 Pi／V3D、pcmanfm-pi、實體拖曳／中文 IME 或多顯示器驗收。
pcmanfm 的桌布／圖示合一仍不能插到圖示下方；能力以 `wallpaperPlacement: background` 說明。
X11 保持兩層明示回退，不假冒圖示下方桌布能力。

macOS 原生來源與 `scripts/macos/test-desktop-layers.sh` 已完成，使用真實 AppKit 場景／協調器
檢查 WindowServer level、三層能力、geometry、穿透、桌布拒絕 focus 與 frame 拒絕互動旗標。
本機沒有 Apple SDK，未執行 Swift 編譯／WindowServer；clone 到 Mac 可開啟 repo 內的
`src/native/apple/WorkFleet.xcodeproj` 並執行該 probe。不啟動 Apple hosted Actions。
文件檢查、Bash 語法及 `git diff --check` 通過；沒有獨立審閱。

最後 Windows Release 重建 0 警告／0 錯誤，試用 ZIP／未簽章 MSIX 位於
`build/windows/package-c01aa5df65384bad80b2eae937943283/`。
ZIP 為 25,160,928 bytes／137 entries；包內 renderer／DLL 與最後建置相同，沒有 `.env` 或私鑰檔。
ZIP SHA-256：`3130cd2141fbbd973e2bd3cc5c296e879a3d0d4faeed025cd12f64cfbe48c446`。
Linux DEB／tar.gz 也已重建，原生來源及 renderer 與最後程式相同，沒有 `.env` 或私鑰檔。
`build/linux/work-fleet_1.0.0~preview_all.deb` 為 181,418 bytes，
SHA-256：`42eb3101f234b177ef9191cde0e71af9617d7f2a4706f8f40042709ee83e07ed`。
`build/linux/work-fleet-1.0.0.tar.gz` 為 223,231 bytes，
SHA-256：`94cbbc0f484230346d8ccae6d877bdc575609f186cc23a28d6e18c32dfe82077`。
本輪沒有自動安裝、修改憑證信任或發布商店；完整 1.0／五平台全部實機驗收仍未完成。

## 2026-10-05 Windows 桌布層實作

依使用者要求加入真正的 Explorer 桌布層。`NativeShellLayers` 分開圖示宿主與位於圖示下方的
WorkerW 宿主，檢查 Explorer process／可見性／疊序，僅在必要時發出有界的宿主建立訊息。
desktop 與 wallpaper 場景的自有視窗以 WS_CHILD 附著，floating 保持獨立 topmost；
附著前檢查 DPI 模式、保留 physical bounds 並換算 parent client coordinates；
renderer 與 input rect 以附著後實際 HWND DPI 計算，不沿用 monitor 的原本 DPI。
Windows compatibility manifest、三層場景池、TaskbarCreated 與宿主存活檢查已接入。
桌布層固定滑鼠穿透，禁止唯讀選字、拖曳或編輯；原生 frame 與 input region 同時檢查。
操作此組時將該組合資格卡片投影至 floating，退出依目前常駐設定回復，沒有改寫位置或偏好。
主畫面逐卡說明／能力提示、setup／testing、PLAN-003 與 ADR-017／018／020 已同步；決策見 ADR-030。
依維護者提供的 checkout 查閱輔助參考專案的分層行為及已知問題，本案使用獨立 C# 實作，未複製程式碼。

最後程式碼以 `Build-WindowsPackage.ps1 -SkipRestore` 重新編譯 Release，0 警告、0 錯誤。
試用 ZIP 及未簽章 MSIX 位於 `build/windows/package-fda1d856596f4cdea73ae46fba50a82f/`。
`WorkFleet-1.0.0-x64.zip` 為 25,160,760 bytes、137 entries，包內 DLL 與最後 Release 建置的 SHA-256 相同，
必要主程式／renderer／公開配置／x64 WebView2 loader 均存在，未包含 `.env` 或私鑰檔案。
ZIP SHA-256：`258fad7c65a19d49729e50249aa1f5bb3eff6df92394962d534785fdc0ee3012`。
試用前關閉舊版，完整解壓並執行 `WorkFleet.exe`；本輪沒有自動安裝或修改憑證信任。

作者檢查：共用桌面測試 `node --test tests/desktop-authority.test.js tests/desktop-core.test.js tests/desktop-transport.test.js`
63／63 通過。`Test-WindowsNative.ps1 -SkipRestore` 最終完整通過：35 項 native core／備份／scene 檢查、
10 項 JS→native 檢查、WPF 主畫面／保存／關閉、composition／跨程序命中、顯示器／快捷鍵及新增 wallpaper 探針。
主畫面實際 DOM 流程確認設定 wallpaper→操作此組→floating→結束→wallpaper→desktop。
原有 native adapter 字樣斷言已隨目前介面文案修正；第一次完整命令停在該舊斷言，修正後完整重跑通過。
原生 wallpaper 探針確認 parent 位於 Explorer 圖示下方、WS_CHILD／非 TOPMOST、實際 WebView 像素、
空 input region、原位置、反覆顯示與切層、不搶 foreground；合成表面圖片在本機檢查目錄。
測試環境為 Windows 11 build 26200、WebView2 154.0.4258.53、單顯示器 144 DPI；不讀取個人便箋。
最終原生證據目錄：`build/native-checks-1923ad46-35d1-4e51-9629-2e789f9ce159/`。
正向 foreground grant 依既有探針規則明確 SKIP（OS 未授權），拒絕情境通過。
文件檢查通過（98 份 Markdown、525 個相對連結），`git diff --check` 與變更憑證模式掃描通過。
沒有獨立審閱；未執行 Windows 10、實際重啟 Explorer、Win+D、虛擬桌面、混合 DPI／顯示器拔插矩陣。

## 2026-10-05 Windows 試用包重新打包

依使用者要求，以目前 `f7ce6fa` 程式碼執行
`scripts/windows/Build-WindowsPackage.ps1 -SkipRestore`，Release 建置成功，0 警告、0 錯誤。
產物位於本機 `build/windows/package-e0001a5006cf4fbba042918e997c33a8/`：
`WorkFleet-1.0.0-x64.zip`（25,156,520 bytes）及未簽章的 MSIX。
試用交付使用 ZIP：完整解壓後執行 `WorkFleet.exe`，所有附帶目錄須保留。
本機已安裝 .NET 8 Desktop Runtime 8.0.31 與 WebView2 Runtime 154.0.4258.53；
不需在這台電腦另外安裝 runtime。Google clients 尚未配置，試用以本機功能為主。

作者機械檢查確認 ZIP 的主程式、設定、renderer、vendor 模組及 x64 WebView2 loader 等
18 個必要檔案均存在，總共 137 個 ZIP entries，未包含 `.env`、私鑰或原始碼目錄。
ZIP SHA-256：`d9d1f384ef35a94283dbf18d30e0346ee2048bda75ec3ff4c11e8b2105d9d69d`。
Windows SDK MakeAppx 封裝成功；未進行簽章、安裝、GUI 操作或獨立審閱，未改產品程式碼。

## 2026-10-05 Apple 專案直接開啟交付

依本輪明確要求，將可攜的 `src/native/apple/WorkFleet.xcodeproj`、workspace、iOS／macOS shared schemes、
圖示與預設 xcconfig 納入 repo。Swift／資源／entitlements 參照改為 SOURCE_ROOT／SRCROOT 相對路徑，
專案生成不再讀取 `.env` 或帶入機器絕對路徑；Mac clone 後可直接開啟此專案。
Xcode 的 Prepare local resources phase 自動安裝 npm lockfile 依賴，產生各 target 的 Info.plist 與
主 App 的 renderer／公開配置；資產在忽略的 `.generated/<target>`。
Share Extension 不產生主 App 配置或安裝 npm。個人 app ID／App Group／Team／工具路徑使用忽略的
Local.xcconfig，範例與預設 preview 已提供；Google／商店欄位仍讀 `.env`。
CLI wrapper 使用同一份提交專案，不重寫 IDE 修改；可用非空 `.env` identity 覆蓋 xcconfig。
Xcode user-script sandboxing 關閉供 Node/npm bootstrap 使用，產品的 App Sandbox／Keychain／entitlements 保留。
結構生成器改為維護已提交專案；DerivedData／archive／export 保持 build/apple 的既有路徑。
README／setup／deployment／testing／.env.example 與 ADR-023／028 已同步，決策見 ADR-029。

作者的可攜性／資產檢查：`node --test tests/apple-project.test.js` 3 項通過，
涵蓋兩個含空白 checkout 路徑的穩定專案、相對 source／target／Extension／scheme 結構、
不嵌入本機配置、Info.plist／renderer／公開配置與 release 缺值。
`prepare-apple-build.mjs --platform ios` 實際執行 npm ci 並產生主 App 資產成功；
重用已下載的 lockfile npm cache，沒有觸發 Apple hosted Actions。
`node --check` 兩個 Node 入口、Git Bash `-n` 兩個 Bash 入口通過。
文件檢查器排除新增的原生 `.generated` 複本，避免將隨包 notices 當作 repository 文件。
`python -B scripts/testing/check_docs.py` 通過（97 份 Markdown、512 個相對連結），`git diff --check` 通過；
Git ignore 確認生成資產與 Local.xcconfig 不進 repo。
本機沒有 Xcode，未宣稱 IDE 載入、Swift 編譯、模擬器／實機、簽章或商店驗收通過；
沒有獨立審閱。Mac 原生編譯仍由維護者處理。

## 2026-10-05 Google 收尾與 Mac 交接

- 修正 Linux Google 狀態與共用 UI 欄位不一致，已登入帳號可接入 FileSync。
- Linux client／scope 變更不再阻止本機工作空間開啟；舊憑證不啟用，資料保留並提示登入。
  Drive 401 讓下次請求先刷新 token。
- 未配置 Google 的原生包停用登入按鈕；Google 帳號工作空間失去授權仍呈現本機資料，
  同步授權失效提供「重新登入 Google」。重新初始化會清除舊輪詢 timer。
- `.env.example` 增加 [Google 設定](docs/google-setup.md) 入口；新增 `config:check -- --google`
  及單一平台模式，與正式散布的簽章／商店缺項分開。
- 整理 Cloud／五平台 clients／Android SHA-1／Apple callback 設定與帳號搬移說明，
  修正 setup 舊有「未接 Google」描述。Mac 建置命令留給維護者執行。
- 依最新指示，本輪未執行測試、原生建置、真實 Google 登入或獨立審閱；
  既有 preview 安裝包尚未包含本輪 source 修正，需用最新 main 重新建置。

已確認產品語意以 [SPEC-003](docs/specs/003-desktop-cards-groups-and-formation.md)
及 [ADR-006](docs/decisions/006-card-group-and-formation-semantics.md) 為準：
一事一卡、通用群組、九組 grid、自由移位、顯式 formation／尺寸同意／undo、
只改 z-order 的輪播、指定組／All 操作、單擊選卡雙擊編輯、顯式拖放轉組。
整理期間另取得明確答覆：操作組暫時浮到一般 App 上方；採用標籤／Shift 的轉組手勢。

## 1.0 執行切片

| Slice | 範圍 | 狀態與證據 |
|---|---|---|
| 1 | 共用 Card/Group、formation、layout/undo、interaction、原子命令 | 已實作 `src/core`、`src/layout`、`src/interaction`、`contracts/desktop.d.ts`；39 個新核心測試及 8 個舊草稿測試通過；獨立唯讀審閱完成，已報問題均修正並複核 |
| 2 | 正式本機儲存、共用 renderer、Markdown/checklist/附件、完成/封存、完整設定 | 共用 UI／IndexedDB、Windows SQLite／DPAPI 已加入；macOS 簽章 fixture 的 Keychain／SQLite／主畫面初始化通過；Android／iOS／Linux 安全儲存的原生 runtime 尚未驗收 |
| 3 | Drive revision graph、OAuth、outbox、衝突、帳號隔離 | 共用版本圖／FileSync／衝突 UI 已實作；Windows 原生 Google 已建置，Android／Apple／Linux 原生授權與 Drive 程式已加入。2026-10-06 Google 專案與 Desktop client 已建立，Windows 真實登入與 Drive 上傳已驗收；跨裝置下載、Linux 與 Apple／Android 未驗收 |
| 4 | 含群組/版面/附件的手動、自動、加密備份及匯入/合併/取代還原 | 共用 ZIP／三種還原、Windows 原生備份已整合；Android SAF／Apple bookmark／Linux 原生目錄備份程式已加入，後三者 runtime 未執行 |
| 5 | Windows/macOS/Linux 原生 host、分層/穿透/快捷鍵/顯示器 | 三平台桌面場景、快捷鍵、系統匣／選單列與顯示器程式已加入；Windows 已建置，macOS 未編譯，Linux 未執行；完整 OS 矩陣仍缺 |
| 6 | iOS/Android 原生 App、檔案/OAuth/分享/生命週期 | Android 原生 preview APK 已產出，含資料／帳號、原生匯出、分享及加密收件匣；iOS 已以 Xcode 27 建置 Debug 開發簽章版並安裝至 iPhone，採用 UIScene 後主畫面可顯示，未產 IPA；兩者未做完整裝置操作／Google 驗收 |
| 7 | 安裝包、簽章與商店提交準備、授權盤點、最終 1.0 驗收 | Windows 試用 MSIX／ZIP、Android debug APK、Linux DEB／tar.gz、macOS universal 開發簽章 DMG 已產出；Apple export／PKG／DMG 與 Android upload signing 入口已加入。正式 AAB／Apple archive／Developer ID、公證、screenshots／SDK 授權最終盤點仍缺，沒有送審 |

切片順序可依依賴交錯；不因此縮減交付範圍。[ADR-008](docs/decisions/008-portable-interaction-core.md)
記錄使用者本輪範圍答覆及本機核心決策。

## Slice 1 實作與驗證

- 一事一卡、穩定群組 ID、九組限制與合法 row-major grid；內容保留格式及附件／未知擴充欄位。
- Workspace 單一寫入佇列：內容、草稿、待同步操作與版面在同一 persistence 邊界提交。
  轉組只改歸屬；保存失敗不發佈半套成功；版本競爭保留轉組意圖。
- 純 formation 預覽、量測摘要帶、堆疊／攤開、單次尺寸同意、跨組容量檢查、過期預覽拒絕。
- 依序 undo、尺寸／位置／base order 還原、較新本文與政策保留；轉組復原需版本符合。
- Group／All 與 active group 分離；輪播不搬卡；拖曳門檻、標籤／Shift 目標、取消、草稿 flush 與 IME 邊界。
- 新卡只取得自己的 placement；顯示器救回只移不可達卡；可注入不同 source/persist adapter。

已執行：`node --test tests/*.test.js` 47 通過（Node v24.21.0，Windows）；
`python3 -m unittest discover -s tests -p 'test_*.py' -v` 12 通過、1 錯誤（Python 3.13.7），
仍是原有 `Store.restore` 對 `rb` handle `fsync` 的 Windows 問題，未改該 prototype 路徑。
模型測試涵蓋 C01–C39/C43–C48 的相關語意子集，不代表這些 C 的真實 UI/原生/同步部分已全通過。

尚未接入：真實持久化 adapter、實際 renderer/host、附件 bytes、Google、正式備份、原生 package。
記憶體 persist 驗證的是交易契約與故障回滾，不能冒稱斷電後 OS 落盤已測。
獨立唯讀審閱已提出容量、過期預覽競爭、唯讀轉組、尾隨手勢抑制、同步後選卡、
佇列入參 mutation 與草稿 key 問題；均已加測與修正，獨立複核無剩餘 findings。
審閱者實際執行 46/46 JS 測試，最後 controller clone 修正另以隔離重現確認；
作者於最後版本執行 47/47。文件 59 份／293 相對連結及 `git diff --check` 通過。

Slice 1 已提交並推送 main：`81ab282`。

### Windows 既有 restore 回歸修正

後續獨立小修正把私有 staging 副本改以 `r+b` 開啟再 `fsync`，不更動來源備份的唯讀模式，
也保留 `os.link` 建立新目的檔且不覆寫的保護。新增 flush 失敗無發布／不改來源／可重試回歸。
Python 3.13.7（Windows）完整 14/14 通過；獨立唯讀審閱及三項 restore 測試通過。
這修復 0.1.0 驗證版已知問題，不把 SQLite 格式當成 1.0 可攜備份格式。
已提交並推送 main：`ac78f43`。

## Slice 2：本機 UI／IndexedDB 子切片

- `src/app` 實作共用介面：群組建立／重新命名、固定紙面就地編輯、完整 editor、
  Markdown／checklist、附件、完成／封存／刪除區還原、全文搜尋、草稿入口。
- `src/storage` 以真實 IndexedDB transaction 保存 Workspace，profile 分區、單 writer lease、
  revision CAS、附件 SHA-256 bytes 與 25 MiB 上限；没有便箋 localhost API。
- 實際指標事件接入普通拖移／標籤或 Shift 轉組、操作 scope、輪播、formation 預覽與 undo。
  顯示／層級／選字政策可保存；瀏覽器不聲稱提供 OS 層級、全域快捷鍵或桌面穿透。
- 草稿成功提交才消耗；多次恢復保留線性 lineage，僅移除仍符合基線的祖先。
  pending／failed 寫入提示離頁，保存失敗仍保留編輯內容；窄螢幕保留草稿與設定入口。
- Markdown 原始 HTML 當文字、生成 DOM 清理、限制連結；附件僅以純下載 bytes 提供，
  即使另開分頁也不在 App origin 執行 HTML。依賴已固定版本及授權，見 ADR-009／notices。

作者驗證：54/54 JavaScript 測試；`npm run build`；隔離真 Edge
`scripts/testing/browser-probe.mjs` 通過新增、Markdown/checklist、附件 bytes、重開、
inline 雙擊／切卡、普通／Shift 拖放與 undo、草稿恢復、filter/search 版面不變、
HTML 附件開新頁僅下載、IDB 慢寫 beforeunload、390px 草稿入口、單 writer 及 CAS／分區隔離。
文件檢查 60 份／301 相對連結與 `git diff --check` 通過。

獨立唯讀審閱完成：54/54 JS、真 Edge 重現並複核七類修正及多代草稿恢復，無未解決 findings。
其範圍不包含正式 Google／原生 host／備份／商店；本輪未重跑舊 Mac probe。
上述 UI 是 1.0 施工中的本機預覽，尚未把版本號升為 1.0，也未宣稱整個 Slice 2 完成。
已提交並推送 main：`f5ca93e`。

### 群組合併、格局與快捷鍵子切片

- 明確選擇目的群組，預覽活動／完成／封存／刪除區卡片及草稿後才合併；
  取消零寫入、過期預覽拒絕，保存失败全部回滾，最後一組不能移除。
- 卡片內容、附件、狀態及 geometry 保留；舊群組保存 redirect，草稿沿已知純 membership
  revision 邊延續，即使 autosave 在合併交易期間排隊也保留新輸入；中途正文更新仍產生衝突。
- 每機「屬於我」與快捷鍵保留有效目的；相關舊轉組 undo 失效，其他 geometry undo 可繼續使用。
  舊設定／新卡配置在 Workspace 原子提交點核對 group set，不能復活已退役群組。
- 設定提供群組區域交換、空區、可改的 group／All／capture／display 快捷鍵與多綁定。
  瀏覽器 scope 快捷鍵可安全結束 inline 編輯；IME、對話框及 Ctrl／Meta 編輯鍵優先。
  快捷鍵切組後，輪播與目前群組 formation 使用相同目標。

作者驗證：64/64 JavaScript 測試、本機 build、原 browser probe 及新增 group probe 通過；
後者包含真 Edge 的預覽／取消／合併、草稿恢復、封存內容、版面不變、區域交換及快捷鍵，
另驗證 CompositionEvent 生命周期、Ctrl+A 優先與範圍切換後的 formation 對象。
CompositionEvent 注入不等於已測實體中文輸入法候選視窗，原生全域鍵仍待 host 驗收。
文件 61 份／306 相對連結與 diff whitespace 檢查通過。

獨立唯讀審閱完成：群組／快捷鍵 10/10 tests、真 Edge 重現及修正複核，無未解決 finding。
獨立檢查涵蓋晚到 autosave、連續合併、重啟、正文衝突、交易失敗、排隊設定、全部卡片狀態、
附件引用、geometry、IME 事件註冊與編輯鍵優先。同步的多裝置 redirect cycle 仍需後續切片。
已提交並推送 main：`f43072b`。

## Slice 3：版本格式與圖分析子切片

採 [SPEC-004](docs/specs/004-revision-graph-and-file-sync.md)／
[ADR-011](docs/decisions/011-immutable-revision-graph.md) 的不可變完整值与 parent 集合。
`src/sources` 嚴格 JSON 拒絕重複欄位、無效 Unicode／unsafe integer、超限及非 JSON 資料；
保留未知 value 擴充。版本圖整批驗證、重播去重、collision／cycle／跨 entity 拒絕，
缺祖先時保留 pending 及舊完整 head；delete/edit 與晚到分支保留多 head。

使用者確認 Google／原生外部設定尚未建立，並要求可用 `.env.example` 配置。
現已接上 allowlist 設定讀取、shell／CI 優先、`npm run config:check` 及 build/config/public.json；
空值允許本機建置，指定平台的發佈設定檢查會回報缺值。沒有登入 token／簽章秘密寫入公開產物。

本切片尚未接 Workspace 遠端投影／同步 cursor／衝突 UI 或 Google adapter；
群組 redirect cycle、OAuth、原生安全儲存及真實雙 client 仍需後續實作與驗收。

作者驗證：完整 78/78 JS 通過；修正後來源／設定 14/14 再測通過；build、公開設定檢查、
文件 63 份／326 相對連結與 diff whitespace 通過。缺值的指定平台 config check 正確非零退出。
獨立唯讀審閱已完成，無未解決 finding；修正 App ID 平台交集及 JSON 超限前配置記憶體的問題。
獨立驗證包含全 Unicode scalar／16 種精確 byte 邊界、隨機 graph oracle、10,000 次 JSON 變形、
allowlist canary，及 48 MiB heap 的重複大字串／跳脫字串／百萬元素陣列，皆正常回報超限。
已提交並推送 main：`b95d8cb`。

### Workspace 投影、衝突與歷史子切片

- 本機命令同交易寫 revision／outbox；舊完整 outbox 遷入版本圖，缺歷史拒絕補造根版本。
- 來源接收原子保存圖、投影、衝突、群組版面參照與 cursor；故障保持舊 state／graph／layout。
  profile／source／session／runtime 與 expected cursor 都需符合；重啟可續 cursor，但必須重新建立 session。
- 多 head 阻止普通覆寫；UI 比較／採用／歷史恢復核對預覽 head 集合，建立新版本並保留所有舊內容。
  HTML 純文字與附件下載延用隔離政策；所有本機草稿保留。
- group redirect 投影不重寫 wire membership；循環／缺組有可達修復入口且 autosave 不被阻擋。
  十組先保留資料，整理回九組同交易恢復格局；既有 geometry／本機 entity 順序不變。
- 未完成轉組重試的 membership／outbox／undo／意圖消耗為單一提交，失敗不產生半套成功或重複意圖。

Google FileStore、真實 OAuth、附件遠端傳輸及五平台驗收仍未包含在這一子切片；沒有把 fixture 當真同步。

作者驗證：93/93 JS、build、三組真 Edge browser／group／revision probe 通過；
文件 63 份／328 相對連結與 diff whitespace 通過。并行 probe 曾一次初載超過 5 秒，
單獨重跑通過；另外修正 probe 在 DOM 替換瞬間讀到 null boundingBox 時可繼續 polling。
原 browser probe 抓到群組 UUID 排序導致順序改變，已修正並加測低排序新 ID 的情境。

獨立唯讀審閱完成，無未解決 finding；23/23 群組／Workspace tests、真 Edge 衝突與恢復通過。
複核包含保存失敗／queue 交錯／重啟、第三分支拒絕舊決議、草稿／geometry／附件保留、
HTML 只下載、390px 零有效群組恢復；十組→九組格局與轉組重試半套成功兩项 P2 均修正並複核。
這些結果不取代 Google、原生 host 或實體 OS IME 證據。
已提交並推送 main：`f960f8c`。

### FileStore／Drive 傳輸子切片

- FileSync 以固定 source／session 協調全掃描起點、changes 分頁、cursor／資料原子提交、
  outbox 與附件；全掃描中斷 cursor 保持 null，可重播先前保存的頁。
- 預產生 file ID 先寫入 durable reservation，再傳送不可變 bytes。回應遺失或本機 ack 失敗後
  沿用同 ID；409 讀回核對才承認成功。移除 outbox 不刪本機版本歷史。
- 附件先於引用它的版本傳送；下載 hash／size 檢查及 octet-stream 落盤。缺附件／未知格式／
  檔案消失或被修改均保留資料，不能用來源缺席推論刪除。
- GoogleDriveFileStore 實作 appDataFolder 專用 REST 路由、私有 metadata、預產生 ID、
  1 MiB resumable chunks／Range 續傳、4xx 重開 session、checksum／讀回確認、配額／撤權錯誤。
  將私密 Location 限制在固定 Google HTTPS host／路徑，錯誤不回顯遠端 body。
- 新裝置可建立空 profile 先接來源；single flight、退避、abort 及晚到 session 拒絕保留本機資料。
  Upload URL 只在 adapter 記憶體，程序重啟可從原 file ID 重送，未宣稱跨程序保留 byte offset。

接受範圍見 [ADR-012](docs/decisions/012-durable-file-store-and-drive-adapter.md)。
目前沒有原生 AuthorizedDriveRequest、OAuth／安全儲存或真 Google 帳號整合，也未在預覽 UI 宣稱已連接。
五平台 client 可見性與 live Drive、host／備份／商店仍屬完整目標的後續工作。

作者驗證：完整 124/124 JS、build、真 Edge／IndexedDB sync probe 通過。
probe 驗證 durable reservation、回應遺失重啟後同 file ID、校驗失敗不替換舊附件、profile 隔離、
兩個獨立 profile 的離線分支與重開保存。傳輸為合成 FileStore／scripted HTTP，沒有真 Google 證據。
文件 65 份／343 相對連結、UTF-8／LF 與 diff whitespace 通過。
獨立唯讀審閱完成，無未解決 finding；resumable 4xx 沿用失效 session 的 P2 已修正並複核。
獨立驗證包含 31/31 相關 tests、自建 REST 的 11 次成功回應遺失／5 次保存中止與重啟，
及真 Edge／IDB 的附件快照競爭、交易中止、校驗／分區、整頁失敗後重試與 disk/cache 一致。
已提交並推送 main：`d238319`。

## Slice 4：完整備份容器與加密子切片

- `src/backup` 捕獲單一 Workspace 快照，完整保存群組／卡片歷史、並行 heads／pending、
  全狀態、草稿／lineage、membership 基線、轉組意圖、每機 layout 及所有歷史附件 bytes。
  憑證、profile/provider 身分、cursor、upload URL 與 outbox 封包不攜帶。
- 嚴格 ZIP reader 校驗雙目錄、固定路徑、CRC／實際大小、無效 DEFLATE／尾垃圾、
  容量、manifest SHA／計數與 graph／引用。缺附件／hash 錯或未知 conflict 拒絕，不省略。
- 全 payload 用 WebCrypto PBKDF2-HMAC-SHA256／AES-256-GCM 加密；隨機 salt／nonce、header AAD，
  錯密碼或竄改不公開部分明文。產生 bytes 與 OS 確認保存尚是不同階段。
- stored 大檔分塊 CRC／複製；大量 graph／projection 分批提供取消；sync/async 共用 graph 規則。
  群組 redirect 與本機 reading preference 以 Map 避免大量查找的平方成本。
- 草稿 baseline 改按 canonical JSON 值比對，兼容舊欄位順序；未改祖先可消耗，另改祖先保留。
  Buffer 入參快照不共用底層記憶體，加密不會誤清 caller bytes。
- SPEC-002／ADR-013 定案完整格式、容量、三種還原與自動備份契約，取代 ADR-005 候選。
  fflate 0.8.3 MIT 僅用於 ZIP writer，授權及 browser module 隨本機 build 保留。

作者驗證：完整 146/146 JS、build；真 Edge browser／group／revision／sync／backup 五組 probe 通過。
backup probe 含 2 MiB 附件、草稿／layout、明文及加密往返、錯密碼、取消與零資料寫入。
三個 probe 同時啟動曾有 module fetch／初載 timeout，順序重跑通過，未藉此宣稱並行 preview 壓測通過。
另新增 20,000 entries 完整輸出／重開及 20,001 拒絕的容量測試，1/1 通過（Windows Node 24.21.0，約 67 秒）。
本 slice 合計 147 項通過；最後邊界修正單獨回歸，沒有重跑不受影響的 146 項。

獨立唯讀審閱已複核 ZIP／加密、Node/OpenSSL 雙向互通、惡意 DEFLATE、取消、Buffer、
lineage／故障回滾、120 個生成圖、2,880 次 group resolver 對照與真 Edge／IDB 零寫入。
最後 20,000 entries 的 off-by-one 亦已實測複核；獨立相關測試 89/89 通過，審閱結束無未解決 finding。
文件 67 份／361 相對連結、UTF-8／LF 與 diff whitespace 通過。
沒有把此 slice 當成實際還原、原生保存、排程、最低手機容量、Google 或五平台完整驗收。
已提交並推送 main：`eadbc1d`。

### 三種原子還原與手動備份 UI 子切片

- 匯入完整映射 card／group／revision／draft／未知 parent 身分；合併保留各分支與不同草稿；
  取代追加全部觀測 heads 的新版本，額外卡進刪除區、群組退休，保留歷史及兩邊草稿。
- 計畫綁 profile／revision，預覽零寫入；workspace／receipt／附件／layout／新 outbox 同一 IDB CAS
  transaction。失敗全部回滾，durable commit 回應遺失後可重啟讀 receipt，不會重複新增。
- 安全備份綁目前 profile／revision，成功保存才解鎖取代；檔案 adapter 先取使用者選定 handle，
  再 write／close／大小及 SHA 讀回。普通下載只回報交付瀏覽器，不能解鎖取代。
- 草稿異內容 ID collision 另配 ID 並傳遞 lineage；歧義 membership 自動延續邊暫停且預覽明示。
  版面可選保持目前或套用備份；只救不可達位置。大量新卡定位可取消，原子提交中停用取消。
- 設定「資料與備份」提供加密／明文輸出、驗證／目標與數量預覽、三種模式、明確重複及最近結果。

作者驗證完整 161/161 JS；最後檔案提交取消修正另跑 restore／file 15/15，本 slice 合計 162 項。
最後 build、真 Edge backup／restore UI／原 browser／group probes 通過。
真 IDB 含附件 abort 全回滾、回應遺失／重啟去重、CAS；UI 含真 OPFS 保存讀回、錯密碼、
取消／無效輸入零寫入、取代安全備份、原草稿／歷史保留、重啟及 390px 無橫向溢出。
獨立唯讀審閱完成，無未解決 finding：三模式 × 兩種版面、循環群組、多代草稿／pending／
再次備份、真 IDB 故障與完整 UI／OPFS 皆通過；80 項相關測試、最後修正另跑 15/15。
修正大量新卡取消延遲（獨立 5,000 卡約 3,271 ms 降至 11 ms）及 close 後取消誤報；
檔案提交後完成校驗，失敗明示可能已寫入，不承諾回滾已發布檔案。文件 67 份／361 相對連結、
UTF-8／LF 與 diff whitespace 通過。自動備份、原生 picker／外部磁碟、Google 及五平台驗收尚未完成。
已提交並推送 main：`059d0ff`。

### 自動備份 journal／排程子切片

- 獨立 profile CAS journal 保存 policy、pending、inventory 與上次成功／失敗；不進 Workspace／ZIP。
  有變化且滿 24 小時才執行，啟動／可見／resume 補跑；重複觸發合併，排隊時已可取消。
- 寫檔前持久記錄期望 bytes，成功後發 inventory；journal ack 可完整讀回確認，file ack 遺失以原工作恢復。
  部分檔保留為未確認；設定改動有新 policyId，換位置不清舊位置，vault／授權失效不降級明文。
- 清理核心僅對相同 schedule 的 verified inventory，先重驗最新成功檔；若遺失先保留舊份並重建。
  任何 journal 讀寫中斷也會 transient 暫停／通知，不能只因紀錄寫不進去就顯示正常。
- 自動 UI 依 host 能力顯示選位、加密、保留份數、立即／重試、停用及未確認檔。
  瀏覽器沒有安全 create-only／身分綁定刪除能力，入口明示停用；手動 ZIP 保存不受影響。

作者驗證 17/17 自動備份測試、相關備份合計 32/32、build，真 Edge automatic／restore UI／browser probes。
restore UI 初載曾一次 5 秒 timeout，順序重跑通過；未將不穩定的 preview 初載宣稱為壓測通過。
probe 使用真 IndexedDB journal 與合成原子 FileHost，含 UI 停用、reservation abort、回應遺失／重啟、
CAS、授權暫停與 ZIP bytes；沒有把 synthetic host 當成原生檔案或 OS vault 證據。
獨立唯讀審閱完成，無未解決 finding：17/17 回歸、真 Edge／IDB 的 reservation／file ack 遺失、
中止、CAS／profile 隔離、執行中停用、not-due 訊息及 390px UI 通過；檔案 host 為合成原子 fixture。
已複核排隊取消、policy 變更、journal 中途失聯通知與原 pending 恢復；FSA 自動 I/O 路徑已移除。
獨立初次頁面亦有一次 5 秒 timeout，診斷重開及完整探針通過。文件 69 份／373 相對連結、UTF-8／LF
與 diff whitespace 通過，scope／常見憑證模式檢查未發現私密資料。
自動備份完整交付仍需五平台原生 host／檔案／安全儲存，並持續本次完整 1.0 目標。
已提交並推送 main：`ed618d4`。

### Windows 原生主畫面／加密保存子切片

- WPF／WebView2 以固定 virtual host 載入封裝資產，沒有新的 listener；原生方法只接受資料。
  主文件／navigation 驗證、frame／遠端資產阻擋、明確能力報告；沒有任意路徑／SQL／vault 讀取 proxy。
- 單一原生 owner、SQLite WAL／FULL synchronous，record／journal 分開 CAS；DPAPI CurrentUser
  加密內容／附件／staging／vault payload，綁 profile／用途／身分，失敗不降級明文。
- 256 KiB 分塊、offset／SHA，1 MiB envelope 可容納 20,000 附件 token。
  workspace／還原 receipt／附件同交易；未完成暫存不可見，重啟清理孤立暫存。
  提交回應遺失只在完整 durable bytes 讀回吻合後回報成功。
- UI 可操作前完成 native readiness／close handler；關閉等所有 UI 命令及草稿保存，
  對話框／IME／保存失敗保留視窗。主畫面標示 Windows 本機加密、Google 未連接。
- 加入可重現 Build／Test-WindowsNative scripts、原生 contract、ADR-015／研究、完整 native licenses。

作者真 Windows core 15/15、JS→真 native bridge 7/7，WPF／WebView2 154.0.4258.53 probe 通過：
便箋／Markdown／附件、正常與關閉瞬間草稿保存、重開、frame／navigation 拒絕、未完成 dialog 拒絕關閉。
真 SQLite 注入 abort 回滾、CAS／版本連續、DPAPI tamper／purpose、profile 隔離、vault／附件重啟、
DB/WAL 不含合成明文 marker，原生 commit ack 遺失讀回亦通過。
完整 `Test-WindowsNative.ps1 -SkipRestore` 已通過；瀏覽器原 browser probe 回歸通過。
受限工具環境第一次 WebView2 browser process crash，改以一般使用者執行同一 binary 通過，
沒有使用 no-sandbox，也未把受限環境失敗列為通過。證據只使用 build 內新建合成資料。

獨立唯讀審閱完成，沒有未解決 finding：15/15 core、7/7 native JS、文件 71 份／388 相對連結，
已複核大量附件 manifest、readiness／ResizeObserver 旁路修正；獨立 Edge renderer 接真 native core
亦驗證 ack 遺失、附件回滾、profile 隔離、重啟與關閉等最後草稿保存。完整 WPF probe 屬作者證據。
最後 WPF probe 另加入暫扣 host.ready、resize 不可提早操作及初始化中安全關閉。
該探針發現未 ready 且 queue 已清空時，WPF Closing 內再次 Close 會拒絕重入；
已改為 dispatcher 延後準備關閉，最後真 WPF 完整探針回歸通過；獨立 source／probe 邏輯複核亦無新 finding。
Debug／Release 建置零 warning/error；scope／常見憑證模式、文件與 whitespace 檢查通過。
Windows 桌面層／穿透／全域鍵／顯示器、
自動檔案／backup vault 整合、Google、其他四平台、签章／商店仍未完成；完整 1.0 目標持續。
已提交並推送 main：`afce68f`。

### Windows 原生備份檔案／vault 子切片

- 本機 NTFS 資料夾由原生 picker 授權，檔案相對 held directory handle 操作；
  Volume GUID／128-bit file ID／建立時間只在 native 保存，profile-bound DPAPI metadata 不交 renderer。
- 手動每次建立新 UUID 檔並 Flush／SHA 讀回，保存證明可用於取代前安全備份。
  自動 pending 先持久保存，native 建檔身分先 reserve 再寫入；回應遺失可重開確認原檔。
- 清理只處理目前排程 verified inventory 的自建檔；最新有效檔保持鎖定至舊檔清理完成，
  舊檔核對身分／完整 bytes 後同 handle disposition。改過／被替換／未確認檔保留。
- Native reservation 寫入失敗後的同名檔只檢查存在，不讀取／認領，列為 unconfirmed 再建新工作。
- 自動備份改為 opaque key ID 呼叫 native encrypt；密碼以 DPAPI 保存而不回 renderer。
  .NET PBKDF2／AES-GCM 產物與 SPEC-002 共用 reader 互通；錯 key／壞 DPAPI／換目錄暫停，未降級明文。
- SQLite schema 2 加入 capabilities，保留既有資料；關閉等待自動 journal 收尾。
  新增 ADR-016／研究、contract、設定／安全／架構／測試文件。

作者驗證：core 15/15、NTFS 13/13、backup coordinator 3/3；真 native JS 10/10、
共用排程 20/20。真 WPF／WebView2 154.0.4258.53 probe 通過：原 editor／草稿回歸，
加密自動備份、手動匯出、真檔還原預覽及附件。只替換互動式 picker 結果，後續 I/O／IPC 皆實際執行。
完整 npm 回歸在最後三個新 scheduler 案例加入前為 181 pass／8 明確 skip；後續 scheduler/native 30/30 通過。
browser 與 automatic-backup Edge probes 通過。中文加密互通初測揭露測試 stdio codepage 問題，
helper 明確 UTF-8 後通過；產品 WebView bridge 本身不使用 stdio。

獨立唯讀審查完成，無未解 finding：原 128 MiB 最新檔競爭探針已無法改寫 latest；
真 Core／SQLite reserve abort→unconfirmed→新 job、壞 DPAPI／換目錄暫停均通過。
另獨立驗證 hardlink／symlink／祖先 reparse、POSIX 取代、可寫 mapping、Volume GUID 重開及加密互通；
相關 JS 31/31 通過。WPF 為作者證據。Debug／Release 零 warning/error，文件 73 份／400 相對連結通過。
不宣稱真 OS picker 自動操作、外接磁碟斷電、最低 Windows 版本、非 NTFS backend 或商店驗收已通過。
Windows 桌面層、Google、其他四平台及商店交付仍持續本次完整 1.0 目標。
已提交並推送 main：`e747a24`。

### Windows 原生場景與平台基礎子切片

- `DesktopSurface` 以真 CompositionControl 與共用 VisualBrush 繪製一個場景，
  兩個 WPF native windows 的 region 完整互補，半透明像素不重複繪製。
- 由後到前扣除被動卡的遮擋，跨程序 input region 只覆蓋最後可互動紙面；
  初建／退出 input 為空、失敗隱藏兩面，浮動／一般底層與成對關閉／隱藏保留活 view。
- 平衡 region 合成在作者本機將 20,000 分離格由約 4 秒降為 216 ms；
  這是一次 native 區域計算，不是 20,000 張 Markdown 卡的繪製或拖曳幀率。
- `NativeShortcuts` 實作真註冊／衝突／暫停／解除、MOD_NOREPEAT、保留與編輯鍵拒絕、
  清掉舊 WM_HOTKEY；`NativeDisplays` 明確回報 physical bounds／work area／每機 DPI。
- App／UI probe 統一 PerMonitorV2 與 Windows 19041 TFM，固定 SDK pack 10.0.19041.56，
  保留 projection／WinRT 授權。主畫面仍為唯一 Workspace owner；桌面 capability 尚未啟用。

作者離屏 probe：WebView2 154.0.4258.53 真 alpha／live mirror、另一程序的 OS hit、
混合遮擋、input／visual region 完整互補、topmost／resident、hide/show／close 通過。
實機盤點一個 144 DPI 顯示器，真快捷鍵註冊／衝突／釋放通過；callback 為自有 HWND 合成訊息。
完整 Windows 回歸 31 項 core／檔案檢查、10/10 JS/native 與真 WPF editor／備份 UI 通過。
UI／composition／platform 最終都透過 manifest-bearing `.exe` 重跑，入口明確斷言 PerMonitorV2；
修正早期 `dotnet .dll` 只採 System DPI 的測試入口。Debug／Release 零 warning/error。
獨立唯讀審查完成，無未解 finding：32 組／164,800 點覆蓋一致，20,000 區域約 225 ms；
成對關閉、延後且合併 CloseRequested 後同步 Dispose、常駐層校正皆通過。
尾隨換行的保留鍵／target 繞過已改成絕對 regex 邊界並複核；真快捷鍵衝突、暫停、釋放及舊訊息隔離通過。
文件 75 份／412 相對連結、UTF-8／LF 與 diff whitespace 通過；本 slice 未更動共用 JS 語意。

尚未宣稱真指標 capture／IME、Win+D／虛擬桌面、混合 DPI／拔插／休眠、
共用控制器与多表面草稿整合或其他平台完成。下一步接單一權威的桌面 coordinator 與產品入口。
已提交並推送 main：`efb2d92`。

### Windows 單一權威桌面整合切片

- 啟用 Windows 桌面 capability；每螢幕桌面／浮動表面接上共用 Workspace／InteractionController，
  原生 SQLite 仍為唯一 durable owner。桌面只取得呈現投影與固定命令，無 storage／backup／vault 方法。
- 固定 scene 文件、principal-bound 分片／完整 SHA、容量名額與共享唯讀 lease；
  frame／command 分別保留容量，畫面壓力不占滿最後草稿的傳輸額度。
- 每 view 單調 serial、結果 receipt、獨立 draft lane 及 pointer generation，
  避免重播、flush 死鎖、同 pointerId 的後續手勢被先前命令接管。
- 原生紙面可編輯、選取、拖曳、Markdown 呈現，群組 scope／版面／顯示偏好即時投影。
  就地編輯 durable ack、跨 view 凍結與接手、組字退出拒絕、失聯恢復及關閉保留最後文字已接線。
- 統一 reference DPI 邏輯座標、每螢幕 physical 視窗／input 裁切；Windows 無桌布層時明確 fallback。
  十組、長組名、合法超大紙面仍接受，不讓互動新增限制誤傷來源合併的可讀內容。

作者檢查：Debug／Release 零 warning/error，native core／NTFS／備份／scene transfer 34/34，
JS/native 10/10；完整 npm 回歸 201 pass／8 明確 skip，原生項目另行執行；
真 PerMonitorV2 WPF／WebView2／SQLite 完整 UI probe 通過。
桌面探針涵蓋 display-only 權限、1.2 MiB 中文分片、同卡重入、組字退出 barrier、保存／返回常駐，
以及延遲 storage commit 下關閉不提前解凍、重開取得最後草稿。
CompositionEvent 與離屏螢幕座標是合成資料，不當作真 OS IME／多顯示器驗收。
瀏覽器 probe 首輪曾停在載入畫面且無 pageerror；後續新 profile 診斷及完整重測通過，原因未確定。

獨立唯讀審查修正並複核：舊 receipt 重播、draft lane／主操作序列競爭、手勢世代、
跨 view 接手舊草稿、組字事件掛載、關閉解凍、失聯最後寫入、可讀群組界線及失敗手勢清理。
獨立 Edge 與真 WPF 驗證跨 view 接手最後文字、權限隔離、延遲落盤關閉／重開；
320 MiB frame 後仍容納四筆 16 MiB command，超額明確拒絕、釋放可重試，lease 隔離通過。
獨立審查無未解 finding；文件 77 份／425 相對連結、UTF-8／LF、diff whitespace 通過。
不宣稱作者檢查為獨立審查；本切片未加入 listener 或外部程式來源。

剩餘包含快捷鍵／焦點／系統匣、顯示器拓撲與完整 OS 互動矩陣、Google 原生授權、
其他四平台及商店交付；仍按使用者批准的完整 1.0 範圍繼續。
已提交並推送 main：`cd12a74`。

### 2026-10-05 Windows 快捷鍵、焦點與系統匣切片

- 真 RegisterHotKey 接入持久化設定及主 Workspace，逐鍵顯示衝突／保留／文字輸入狀態。
  App 前景時解除 OS 註冊，HTML 處理本地鍵；IME、AltGr、一般編輯鍵優先。
  新工作區 capture／toggle 採 Ctrl+Shift+N／D，既有設定保持原值並提供改鍵／重試。
- 原生前景 intent 在動作進入佇列前擷取，綁來源 view、一次性及五秒期限；
  保存／投影完成後再次檢查 foreground HWND 與最後輸入時間。過期或缺少 intent 不啟用視窗。
  同步及背景投影不取得焦點，不模擬按鍵或修改系統 foreground-lock 設定。
- Shell_NotifyIcon 與原生選單提供主畫面、快速記錄、全部操作、退出 scope、顯示切換、
  收起及保存退出。收起先保存草稿、保留單一 owner；缺少 tray 時不收起。
  自有 TaskbarCreated 重建入口；選單與關閉期間同步停用快捷鍵，設定更新不能解除 block。
- 就地 scope 轉換與完整 editor 先保存最後文字；合法 `hide`／`stop`／含 `.:` 群組 ID
  不與內部命令混淆。打包包含新 native shortcuts 模組；ADR-019、契約及操作文件同步更新。

作者最終檢查：npm 206 pass／8 明確 native 環境 skip；該原生部分另行執行。
Debug／Release 零 warning/error；34 native core／NTFS／備份／scene 與 10 JS/native 通過。
真 PerMonitorV2 WPF／WebView2／SQLite UI、composition、platform probes 通過；
實際 tray icon、保存／收起／重開、合成 IME scope 退出、原生註冊／衝突／釋放及 menu block 均涵蓋。
初測探針錯把 WPF IsActive 當成 OS foreground；改依 GetForegroundWindow 的 PID 後完整 UI 重測通過。
正向 OS foreground grant 因測試環境未可靠授權而明確 skip；null／過期拒絕仍有測試。
封裝資產的 Edge browser probe 通過；文件 79 份／436 相對連結、UTF-8／LF 及 whitespace 通過。

獨立唯讀審閱完成，沒有未解 finding。獨立 Edge 驗證 AltGr、提前擷取與延後沿用 intent、
群組 ID 路由；原生探針驗證一次性／跨 view／過期拒絕、tray 延遲不重新授權、
menu／close block 與真快捷鍵註冊。實測 WPF IsActive=True 但 foreground 為其他 PID 時，
新版正確恢復快捷鍵註冊。不宣稱實體按鍵、真 IME、Explorer 實際重啟或完整焦點矩陣已驗收。
本切片沒有新增 runtime 套件、listener 或外部程式來源。
顯示器拓撲與休眠、Google、其餘四平台與商店交付仍持續完整 1.0 目標。

## 2026-10-05 顯示器生命週期實作

前一快捷鍵／系統匣切片已推送 `db210d5`。
本切片接上 Windows 顯示器／工作區域／DPI／休眠通知與延遲重新列舉，立即暫停輸入、撤銷焦點授權。
owner 取消拖曳並持久保存不可達卡片救援，原生場景池保留編輯 WebView，依新 topology 套用 viewport。
投影、命令及輸入 ack 綁定 topology，草稿通道持續保存。上限 16 顯示器／32 存活場景。
依使用者 2026-10-05 指示優先實作，本切片沒有執行測試或獨立審閱，實體拔插／DPI／喚醒仍未驗收。
決策見 [ADR-020](docs/decisions/020-windows-display-lifecycle.md)。

## 2026-10-05 Windows Google 整合實作

顯示器切片已推送 `e46b71a`。Windows 新增 NativeGoogle：系統瀏覽器 PKCE／state、臨時 callback、
HTTPS userinfo 身分、DPAPI 憑證保存／refresh、固定 FileStore 語意、串流容量與檔案 SHA-256 校驗、續傳。
介面新增登入／切換、返回本機、登出、立即同步與 20 秒背景同步；帳號分區保存原資料，切換先保存草稿。
NativeGoogleFileStore 接既有 FileSync 的版本圖、outbox、衝突及游標交易。公開設定沿用 `.env.example`。
本切片只建置，依使用者指示未執行功能測試或獨立審閱。Google 專案未建立，真登入／Drive 往返未驗收。
macOS／Linux／iOS／Android 原生交付及商店準備仍繼續；未將 Windows 實作視為完整 1.0。
決策見 [ADR-021](docs/decisions/021-windows-google-account-and-sync.md)。

## 2026-10-05 Android 原生 App 實作

Windows Google 切片已推送 `3672993`。新增 Android Activity／受限 WebMessage bridge、封裝資產、
SQLite revision／附件原子交易、唯一 owner、Keystore 加密、SAF 手動／自動備份及安全清理。
原生備份密碼與 SPEC-002 加密 ZIP、Credential Manager 帳號選擇、AuthorizationClient Drive 授權，
userinfo 核對 sub、固定 FileStore bridge、續傳／校驗及帳號分區皆已加入程式。
renderer 支援 Android transport，沿用完整便箋／草稿／附件／同步／備份核心。
`.env.example` 新增 Android 所需的同專案 Web client ID；SDK 路徑可由 `.env` 或環境提供。
新增 Windows／Linux build wrappers、Gradle project、manifest 及自有 vector icon。
本機缺 Gradle／Android SDK：未編譯、未產 APK／AAB、未真機／Google 驗收；依指示未跑測試／審閱。
macOS／iOS／Linux host、各平台封裝與商店資料仍繼續完整範圍。見 [ADR-022](docs/decisions/022-android-native-host.md)。

## 2026-10-05 商店提交素材

Android 切片已推送 `20e8ee4`。新增繁中／英文商店文案、隱私發布文本、資料用途與截圖場景清單。
`.env.example`／config 增加公開隱私網址、支援網址與聯絡 email；release 配置檢查列出缺少值。
未建立開發者帳號、發布隱私頁、製造原生截圖、簽章或送商店；素材為實際提交準備，不能冒充已提交。
依使用者指示未跑測試或審閱。其餘原生平台與封裝仍繼續。見 [提交素材](docs/release/README.md)。

## 2026-10-05 Apple 原生 host 與桌面實作

前一商店資料切片已推送 `f213f4e`。本切片新增共用 Swift SQLite／Keychain 加密、原子附件／revision、
原生備份 bookmark／安全檔案流程／可攜加密、GoogleSignIn／固定 Drive transport／續傳，以及 WKWebView host。
macOS 接公開 AppKit visual／紙面 input panels、主畫面唯一 owner 命令路由、就地編輯、唯讀選字、
Carbon 全域快捷鍵／焦點 intent、選單列、顯示器／Space／休眠的 topology 更新與 editor surface 保留。
iOS 接 UIKit 主畫面、資料夾 picker、Google 回呼及前背景保存／同步通知；背景保存用有限
UIBackgroundTask 等待草稿／備份收尾，完成或到期即釋放。Android 同步加入前背景通知與關閉取消。
增加 Xcode 專案／shared schemes 產生器、兩平台自有 icons、entitlements、privacy manifest、
依賴授權複製與 build/archive 腳本。`.env.example` 修正 Google macOS client 類型為 Apple SDK 所需 iOS client。
各原生 host 增加關閉取消訊息；renderer 關閉因組字／對話框或保存失败取消時可再次嘗試。
本機沒有 Xcode／Swift SDK：未編譯 Apple 程式、未產 app/archive、未真 Google 或原生手勢驗收。
依使用者指示未跑測試／額外驗證，沒有獨立審閱。剩餘 Linux host、分享、各平台完整封裝及外部設定仍繼續。
見 [ADR-023](docs/decisions/023-apple-native-host-and-scenes.md) 與 [Apple 原生入口](src/native/apple/README.md)。

## 2026-10-05 Linux 原生主畫面／資料與來源

Apple 切片已推送 `d8d8509`。新增 Python／GTK／WebKitGTK 原生 owner，secure custom scheme
封裝資產、top-frame nonce bridge、網路資源阻擋與原生 chooser／關閉流程。
SQLite WAL／FULL、Secret Service key／AES-GCM、本機帳號分區、附件與 revision 同交易、flock
已加入；原生手動／自動／密碼備份及 journal／原生身分／保留份數清理接共用完整備份契約。
Google 系統瀏覽器 PKCE、限定 callback、金鑰圈 credential／refresh、userinfo 身分、
固定 Drive 語意與 bounded HTTPS、續傳／metadata／SHA-256 校驗已加入。
原生手機／無桌面能力主畫面的快速記錄快捷鍵不再呼叫桌面專用方法。
新增 Linux source/runtime package generator、desktop file／自有 icon、tar.gz 與 Debian 建置腳本。
本輪執行 `npm run build`、package generator 與 archive 產生，已建立
`build/linux/work-fleet-1.0.0.tar.gz`；這是來源與資產封裝，沒有在 Linux GUI／Secret Service 執行。
依指示未跑測試／額外驗證，沒有獨立審閱；未建立或安裝 deb、未真 Google。
Linux desktop surfaces／global shortcuts／tray、手機分享及各平台完整散布仍繼續，未縮小完整 1.0。
見 [ADR-024](docs/decisions/024-linux-native-owner-and-storage.md)。

## 2026-10-05 Linux 桌面接線

每螢幕 desktop／floating 原生場景、輸入區域、owner／scene mailbox 與 bounded transfer 已接入 GTK host。
X11 層級與 Keybinder、Wayland layer-shell 與 GlobalShortcuts portal 依 runtime 能力啟用；
系統實際鍵位描述回到設定。焦點／原生對話框暫停全域註冊；不支援的桌面保留主畫面並說明原因。
顯示器／工作區／休眠通知接入 topology 保存流程，既有場景保留 WebView 與草稿。
系統匣提供主畫面／快速記錄／All／顯示切換／保存退出；可用性確認後才允許隱藏主畫面。
帳號切換、renderer failure 與退出關閉原桌面工作階段，舊場景無法寫入新帳號。
封裝加入 Cairo GI bridge、Keybinder、layer-shell、AppIndicator／portal 依賴宣告。
本輪完成 web build、Linux package generator 與 tar.gz 產生；產物含這次桌面接線程式，沒有建立 deb。
依指示未跑測試／審閱，Windows 環境仍無 Linux GUI 執行證據；portal 重註冊的系統授權流程未確認。
完整 1.0 持續完成手機分享與平台散布，見 [ADR-025](docs/decisions/025-linux-desktop-scenes-and-shortcuts.md)。

## 2026-10-05 原生檔案匯出與手機分享

Android ACTION_CREATE_DOCUMENT、iOS UIDocumentPicker、macOS NSSavePanel 已接共用附件／草稿下載。
owner bounded transfer 與加密 staging 傳遞 bytes，不讓 renderer 指定原生檔案路徑。
iOS／Android 編輯器加入 Markdown 文字與單附件分享；原草稿先保存，取消分享保留原內容。
Android FileProvider 限定自有 cache exports、只讀 URI grant、32 份／256 MiB 與 24 小時暫存清理。
iOS 使用系統 activity sheet、完整暫存檔案保護、iPad popover、取消／逾時及帳號切換清理。
分享結果不冒稱已送達；HTML／SVG 附件仍只以檔案 bytes 匯出，沒有載入主 origin。
依指示未測試／審閱；Android／Apple SDK 缺失，原生 source 尚未編譯或執行。
外部分享接收／iOS Share Extension、五平台完整散布仍未完成。
本輪 web build、Apple Xcode 專案生成與 Linux tar.gz 更新完成，無 Android／Apple 原生 binary。
決策見 [ADR-026](docs/decisions/026-native-file-export-and-sharing.md)。

## 2026-10-05 外部分享收件匣

Android SEND／SEND_MULTIPLE、iOS Share Extension 與共用收件匣介面已加入。
文字／標題／網址與授權檔案先存至加密佇列，使用者選擇目前工作空間的群組後才保存為草稿。
SQLite 草稿成功後以原 item receipt 清除原項目；回覆遺失或清理失敗重試辨識已保存草稿／卡片。
256 KiB 文字、16 個檔案／25 MiB、64 份收件項目／512 MiB 上限，錯誤保留原內容。
Android no-backup 私有目錄＋Keystore／AES-GCM；iOS App Group container＋共享 Keychain／AES-GCM、
flock 與完整檔案保護。Extension 無主 App 的 DB／Google 權限，不強制開啟主 App。
Xcode 產生器含 Extension target、embed phase、依賴及 App Group entitlements；公開 group ID 可由 .env 配置。
依使用者指示未跑測試或審閱；Android／Apple SDK 不可用，沒有原生 binary 或 Extension 執行結果。
見 [ADR-027](docs/decisions/027-native-share-inbox-and-extension.md)，接續完整平台封裝與簽章準備。

## 2026-10-05 原生封裝與簽章入口

Windows SDK MakeAppx 與 .NET publish 已產出 `build/windows/package-b512e9e6ee014f2d9f558c5943ae34a6/`
中的 `WorkFleet-1.0.0-x64.msix` 與 `WorkFleet-1.0.0-x64.zip`；.NET Release 建置完成、0 errors／0 warnings。
這是未簽章 preview，沒有安裝／啟動結果；需 .NET 8 Desktop 與 WebView2 runtime。
公开 Windows package identity／publisher 可在 `.env.example` 設定，簽章入口使用既有憑證與 timestamp。
封裝脚本保存 MakeAppx log，每次使用新目錄，沒有自行建立／信任憑證。

Apple 新增本機 export options／archive 匯出、macOS hardened runtime、PKG／可選 DMG、
已有 Keychain profile 的公證／staple 入口。Android 新增 CI environment upload key 簽署 AAB；
`-Signed`／`--signed` 強制完整 inputs，秘密不進公共 JSON 或 `.env`。
缺少 Apple／Android SDK，這些原生封裝及簽章入口未執行，不視為產物已完成。
本輪 Apple Xcode project 更新與 Linux source/runtime tar.gz 重新產生完成，沒有執行原生 App。
依使用者指示未執行測試／審閱；沒有獨立 review。決策見
[ADR-028](docs/decisions/028-native-package-and-signing-entry-points.md)。

## 2026-10-05 Android 原生 APK 產出

新增 workspace toolchain installer：官方固定 SDK tools 15859902、Gradle 8.13／官方 SHA-256、
API 36／Build Tools 35.0.0，工具與 paths JSON 放在 `build/toolchain`，沒有更動系統 PATH。
已接受安裝所需 SDK 條款並完成本機安裝；既有 Microsoft JDK 17 用於原生編譯。
`.env`／process environment 的 SDK 路徑優先，Android build wrappers 可直接使用 workspace paths。

修正 Gradle `java` extension 遮蔽 File package 的簽章 DSL 編譯錯誤；Android 原生 Java 與資產
編譯／封裝完成。APK 加入根 LICENSE／THIRD-PARTY-NOTICES，不包含 SDK／Gradle 工具。
`Build-AndroidApp.ps1` 最後一次執行 `BUILD SUCCESSFUL`，36 tasks，產出
`build/android/WorkFleet-1.0.0-preview.apk`（11,145,974 bytes）。
這份 APK 使用 debug 簽章與 `app.workfleet.preview`；正式 app ID／Google／upload key 配置及 release AAB 仍待完成。
依使用者指示未執行測試／裝置操作／審閱，沒有真登入、分享或背景回收的執行結果，也沒有獨立 review。
Apple SDK、Linux GUI 環境仍不可用；完整 1.0 尚未完成。

## 2026-10-05 Linux DEB 與 Apple hosted build 入口

既有 Docker engine 為 Linux，使用官方 Ubuntu 24.04 image 的 dpkg-deb 成功封裝
`build/linux/work-fleet_1.0.0~preview_all.deb`。使用的 image digest：
`sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55`，已固定在 Windows wrapper 預設值。
容器只掛載生成的 Linux bundle／output 與 packager，執行 network none，沒有安裝 App／GTK。
共同 packager 使用新 staging、root archive ownership、有效 preview maintainer contact，
安裝 `/usr/bin/work-fleet` launcher、desktop entry、圖示與 license documents；正式 release 要求公開設定。
没有 Debian 安裝、GTK／Secret Service／desktop／Google 操作結果，DEB 產出不作 runtime 通過證據。

Apple 新增 Debug `--unsigned` 與 preview ZIP／device IPA packager；iOS 保留嵌入 Extension。
手動 `.github/workflows/apple-native-build.yml` 固定官方 action commit，在 hosted Mac 編譯原生
macOS／iOS；每 job 可選 5／10／20 分鐘（預設 10），artifact 保存七天，沒有測試或商店上傳。
本 repo 是 private；尚未啟動 hosted workflow，需維護者同意使用可能計費的 Actions 額度。
Apple 本機 SDK 仍缺，沒有 Apple 原生 binary；公開 team／OAuth／正式簽章亦未配置。
本輪沒有測試／審閱／獨立 review；完整 1.0 仍未達成。

## 2026-10-05 原生模組封裝修正與 Android 授權資料

共用 renderer 已引用 `native/files.js`／`native/capture.js`，原打包清單漏帶這兩個模組。
已補入 web assets 封裝，重新產出 Windows MSIX／ZIP、Android preview APK、Linux DEB／tar.gz，
並更新 Apple Xcode project assets；舊的封裝產物由這輪產物取代。
Windows 最新目錄為 `build/windows/package-752e12ff6aae49d7be24fdc43ace09ea/`，
內含 `WorkFleet-1.0.0-x64.msix`／`WorkFleet-1.0.0-x64.zip`，.NET 建置 0 errors／0 warnings。
Android 最新檔為 `build/android/WorkFleet-1.0.0-preview.apk`，最後建置 `BUILD SUCCESSFUL`。
Linux 最新檔為 `build/linux/work-fleet_1.0.0~preview_all.deb`，由 dpkg-deb 成功封裝。
以上仍為 preview／未正式簽章產物，沒有啟動 App 或做 OS 行為驗收。

Android Gradle 每 variant 依 resolved runtime graph 打包 SDK inventory／artifact SHA-256、
上游 POM／AAR／JAR notices，Apache-2.0 官方全文一併保留。使用新生成目錄，沒有刪除舊 build outputs。
本輪 debug inventory 含 58 個 runtime artifacts；58 份 POM 均取得，找到 7 份 embedded notices，
1 項 POM 未直接宣告 license，保留原 metadata status，沒有自行推定授權。
SDK cache 本機路径與憑證不進隨包 inventory；正式 AAB 的 SDK 條款仍依其 release inventory 確認。
依指示未做測試／審閱／獨立 review。Apple hosted build 額度授權仍待回覆，沒有啟動 Actions。
正式 OAuth／developer accounts／簽章、原生 screenshots 與五平台完整驗收仍缺，完整 1.0 未完成。

## 2026-10-05 Android Studio 與 Gradle Wrapper 建置

補齊 `src/native/android` 的 Gradle 8.13 Wrapper（Windows／Unix scripts、JAR、固定 distribution SHA-256），
可在 Android Studio Open 此目錄。官方 Wrapper 來源及授權已記錄於 THIRD-PARTY-NOTICES，保留 LICENSE／NOTICE。
Gradle Sync 直接讀取 `.env`／環境中的公開配置，不再依賴先前產生的 `build/config/public.json`。
Android 資產生成任務自動執行 lockfile `npm ci --ignore-scripts`，並將 renderer／vendor／bridge／config
產生到 `app/build/generated/web-assets`；APK 建置不需要先跑外部 `npm run build`。
release 同樣檢查正式公開設定，保留原簽章環境變數契約。
Windows／Linux 建置入口改用 Wrapper；README／setup／deployment／testing 已補 Android Studio Open、
Node／SDK／JDK 前置條件、Sync、Run／APK 操作及實際產物位置。

作者執行結果：`node --test tests/android-build.test.js` 3 項通過，涵蓋無生成資產的配置、
`.env` 更新、秘密排除、release 缺值／完整配置及獨立輸出路徑的完整資產。
`npm run build` 通過，保留其他平台的原預設輸出。
`gradlew.bat -p src/native/android --offline --no-daemon --console plain assembleDebug` BUILD SUCCESSFUL；
產出 `src/native/android/app/build/outputs/apk/debug/app-debug.apk`，11,253,673 bytes。
另在含空白路徑的隔離 checkout（沒有 `.env`、node_modules 或既有生成資產）完成 Wrapper APK 建置；
Gradle 自行安裝依賴、產生資產並編譯原生 Java。兩份 APK 的 ZIP 內容均確認有 renderer、
native/files、native/capture、vendor、公開配置與 SDK inventory。
另透過 Gradle Tooling API 取得 Android Studio 使用的 AndroidProject v2 模型，
確認 `app.workfleet.nativehost` 與 debug／release variants 可解析；此檢查未啟動 IDE GUI。
`python -B scripts/testing/check_docs.py` 通過（96 份 Markdown、502 個相對連結），`git diff --check` 通過。
使用既有已核對 SHA-256 的 distribution 填入 Wrapper cache；Maven/npm 依賴下載後重用 cache，
此處 `--offline` 為受限執行環境的驗證選項，不代表新 checkout 完全不需首次下載。
Java archive／debug keystore lock 在受限環境被拒絕，使用核准的建置權限完成；沒有修改產品安全設定。

本輪未操作 Android Studio GUI、模擬器／真裝置、Google 往返或商店；作者建置／回歸不是獨立審閱，
沒有獨立 review。正式 release／簽章／商店準備仍保留上方缺項。

## 2026-10-04 文件交付

- [完整規格](docs/specs/003-desktop-cards-groups-and-formation.md)：U／D／Q、資料分界、狀態轉移、故障行為、C01–C48。
- [需求演進](docs/resreach/2026-10-04-desktop-card-interaction-design.md)：保留各次修正及被取代方案。
- [平台研究](docs/resreach/2026-10-04-desktop-interaction-platform-feasibility.md)：API、既有報告、推論與未測範圍分開。
- [ADR-007](docs/decisions/007-desktop-scene-and-platform-host.md)：Proposed；renderer 自管卡片疊序，host 管原生能力。
- [PLAN-003](docs/plans/003-desktop-interaction-implementation.md)：契約、模型、renderer、平台、來源與發佈的交接順序。
- [接手文件](docs/handoff/2026-10-04-desktop-interaction-handoff.md)：必讀順序、不可偏離行為、何時詢問輔助參考位置。
- 主要入口及舊提案已加上優先序／範圍修訂標記，避免早期純文字／backup 排除清單被當成已批准需求。

文件檢查：`python -B scripts/testing/check_docs.py` 通過（58 份 Markdown、281 個相對連結、UTF-8／LF）；
`git diff --check` 通過。另核對 U01–U22、Q01–Q07、C01–C48 編號、索引與改動範圍。
本輪未修改產品程式，未重跑產品功能測試；沒有獨立審閱，作者的機械檢查不作獨立審閱證據。

## 接續工作

按上方 1.0 執行切片繼續，保留 SPEC-003 全部 U／D 及已答 Q 的完整範圍。
正式 host／SDK 選型需符合五平台與公開 API／商店目標，不能沿用 prototype server 作 1.0。
Drive 以 SPEC-004／ADR-012 整合原生授權；備份以 SPEC-002／ADR-013 接還原交易、自動排程及原生檔案流程。
Google 登入、OAuth 專案、實際 Drive 寫入與商店設定尚未完成。

## 目前交付

0.1.0 可操作驗證版已實作，從 `scripts/macos/start-validation.sh` 建置並啟動。
提供 Sandbox 原生 Mac 展示、WebKit／瀏覽器編輯器與單一 SQLite 權威服務。
原始接手基線為 `8a7da58`；遵照使用者要求直接 commit/push main，不另建分支或 PR。

**尚未達成完整平台驗收**：真實桌面手勢穿透、Spaces／多螢幕／休眠矩陣、真實手機、其他 OS 與商店均有未測項目。
不能把這次可操作版本或自動測試綠燈當成全部疑慮已通過。
詳見 [驗證報告](docs/validation/2026-10-03-validation-report.md)。

## 0.1.0 已完成的歷史交付

- AppKit 公開 API、ad-hoc 簽章、App Sandbox 與僅 outbound network entitlement。
- 真實 SQLite 更新到桌面，鎖定／不搶焦點政策、解鎖 WebKit 編輯／重新鎖定。
- 一般／圖示上方／圖示下方展示模式與可達選單列入口。
- 文字快速新增、待辦、Inbox 群組、Todo／In Progress／Done、完成／刪除／還原。
- 持久化、revision 競爭、operation 重試去重、tombstone、草稿保留／副本／匯出。
- online backup、全新路徑 restore、更換 epoch／撤銷舊裝置、還原中斷保護。
- 短效一次性 QR 邀請、viewer/editor 權限、裝置撤銷；非 loopback 強制 TLS。
- 13 個資料整合測試、8 個草稿測試、真實 WebKit 12 個操作斷言及 Mac probe。
- 獨立唯讀 review，修正資料遺失／來源切換／恢復邊界並複核。
- 可重現建置／啟動、API／安全／部署文件、runtime inventory 與 notices。

## 限制與剩餘工作

- Windows 原 restore `rb` handle 的 `fsync` 問題已在本輪修正，14 項 Python 回歸通過；詳見上方獨立修正記錄。歷史失敗證據保留，不撤銷原 Mac 結果。

- 真實點擊、雙擊、桌面框選、圖示拖拉：事件注入權限為 false，尚未取得通過證據。
- 模式已啟動／驗證旗標；Finder 圖示層次與全桌面行為仍需人工觀察。
- Spaces、Show Desktop、Mission Control、Stage Manager、全螢幕、多螢幕／拔插、休眠喚醒。
- 真實手機掃碼與 LAN／外網 HTTPS；瀏覽器 service worker 離線冷啟動。
- Windows MSIX、Linux 具體 compositor、Apple Silicon、iOS／Android 原生 package 與商店提交。
- 每機內容突出與 SPEC-003 的卡片場景／群組互動、真實日常 UX 回饋與大資料效能；不預設一卡一原生視窗。
- production 網路 hardening、Keychain／本機內容加密及正式散布產物授權稽核。

## 歷史基礎

Bootstrap minimal、backlog 需求、六份研究、獨立開發邊界與接手計畫已保留。
沒有搬入其他便箋應用大量程式碼／資產，也沒有加入 Agent 執行狀態流程。
