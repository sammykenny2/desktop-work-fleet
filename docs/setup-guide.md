# 建置與操作

更新：2026-10-04。新介面與既有 0.1.0 分開啟動；實作進度見 [PROGRESS](../PROGRESS.md)。

## 1.0 本機介面開發預覽

需要 Node 22+、Python 3.12+ 及支援 IndexedDB／Web Locks 的瀏覽器。
本輪實測 Windows、Node 24.21.0、Python 3.13.7 與已安裝的 Edge；其他 browser／原生 host 另驗收。

```bash
npm ci --ignore-scripts
npm run build
python scripts/testing/serve_preview.py --port 0
```

開啟輸出的 `/app/index.html` URL，Ctrl-C 結束開發預覽。
`--port 0` 使用空 port；要重用原本的瀏覽器資料，指定同一個可用 port，
因為 IndexedDB 依 origin 隔離。這是開發靜態資產 listener，沒有便箋 API。

- 「記下想法」開啟 editor，支援 Markdown／checklist；可附加每檔至多 25 MiB 的檔案。
  附件僅下載，不直接執行 HTML／SVG。保存完成會移除對應草稿，保留草稿則可稍後繼續。
- 便箋平時是「鎖定」狀態，無法改文；按「調整此組／調整全部」進入調整模式後單擊選卡、雙擊就地編輯，按「完成」回到鎖定。
  桌面版的調整模式以半透明遮罩覆蓋螢幕，上方有堆疊、攤開、復原與完成；進入時主視窗有焦點才會先最小化，結束後恢復
  （[ADR-042](decisions/042-adjust-overlay-on-every-desktop-host.md)）。
  Ctrl／Command＋Enter 保存；Esc 保留草稿並結束編輯；空白或未修改的內容不保留草稿。完整編輯可管理附件及預覽。
- 拖曳只移動位置；放在另一組接收標籤或按住 Shift 放到另一組區域才轉組。
  堆疊／攤開先預覽，調整大小須每次勾選；復原依序還原 geometry／轉組。
- 清單提供完成、封存、刪除區及還原；搜尋全文；窄螢幕與手機把側欄收進左上角按鈕開啟的抽屜，新增改用右下角「＋」。
  桌面仍標示已完成卡片，封存／刪除才退出桌面集合。設定（側欄左下角齒輪，Ctrl+,）的變更立即生效，但不會重排既有便箋。
- 群組旁的「⋯」可重新命名或合併／移除；先選接收群組並預覽所有卡片及草稿。
  確認後內容與位置保留，來源群組移除；不能以版面復原重建原群組。
- 設定可交換群組區域，並自訂快速記錄、顯示切換、調整全部群組與調整區域 1–9 的快捷鍵。
  可用 Ctrl／Alt／Meta 搭配字母、數字或 F1–F24，可加 Shift；多組以逗號分隔，留空取消。
  預設快速記錄 Ctrl+Shift+N，顯示切換 Ctrl+Shift+D，全部 Ctrl+Shift+0，區域 1–9 為 Ctrl+Shift+1–9。
  桌面版的區域鍵每按一次，整組便箋換到下一階：桌布層 → 桌面層 → 最上層 → 調整位置，再按回到桌布層。
  層級屬於群組、每台電腦各自保存，只能用區域鍵切換；不支援桌布層的桌面跳過桌布層。
  每次切換，該組區域中央會在最上層短暫顯示群組名稱、目前層級與各階的圓點，約 1.5 秒後淡出，不會擋住滑鼠。
  Ctrl+Shift+0 讓所有群組進入調整位置，再按一次各自回到原本的層級。
  關閉「鎖定時也顯示便箋」時，或在瀏覽器預覽中，區域鍵只切換該組的調整位置，不換層級。
  區域由左到右、由上到下編號；數字鍵跟著區域，作用於當下在該區域的群組，空白區域的鍵不向系統註冊。
  舊版綁在群組上的鍵，開啟時改成該群組所在的區域，沒有鍵的區域補上預設數字。
  瀏覽器若保留該組合可在設定改鍵；預覽只在目前視窗生效，不宣稱已向 OS 註冊全域鍵。
- 同 profile 不允許第二個獨立視窗寫入；保存中或失敗時離頁有提示。
  沒有 Google 同步，清除瀏覽器資料會失去預覽資料；可先用「設定 → 資料與備份」保存 ZIP。
- 「資料與備份」可匯出明文或密碼加密 ZIP，驗證預覽後選擇匯入／合併／取代。
  加密輸出至少 12 個字元，手動匯出的密碼不保存且無法找回；還原使用原密碼。
  匯入預設另建資料，合併依原身分保留分支；取代保留歷史並把額外便箋移至刪除區。
  取代需先成功保存目前資料的安全備份；只支援下載而無法確認保存的瀏覽器會停用此步驟。
- 本機工作空間另有「清空本機後，從備份還原」：檢查 ZIP、核對清除數量、勾選永久取代，再確認。
  不需先重設或強制備份舊內容；同交易替換便箋、歷史、草稿、附件與版面，失敗保留原資料。
  舊內容不留在刪除區，自動備份設定與其他工作空間保留；仍可選「先備份目前資料」。
  本機與 Google 備份格式相同；Google 匯出先同步，失敗須明確選擇只備份已知副本。
  下載 Google ZIP、切換本機後還原即可離線使用；詳細雙向流程見 [Google 設定](google-setup.md)。
- 目前測試階段便箋與備份的資料格式維持 V1，更新欄位不會啟動 schema 升級或建立額外副本。
  資料版本政策見 [SPEC-007](specs/007-schema-evolution-and-migrations.md)；平常仍可使用既有 ZIP 備份。
- 「資料與備份」最下方的「重設所有資料」刪除目前工作空間在這台裝置上的便箋、群組、草稿、附件、歷史、佈局、快捷鍵與自動備份設定，
  旁邊有「先匯出備份」；需勾選「我了解資料刪除後無法復原」才能執行。已保存的備份 ZIP、分享收件匣與其他工作空間不受影響。
  Google 工作空間會連 Drive 的資料一起清，所有使用這個帳號的裝置都受影響（見 [Google 設定](google-setup.md)）。
- 桌面版「設定」最下方的「重置桌面佈局」只把這台電腦的便箋放回各群組區域並恢復預設顯示方式，不動內容、群組與快捷鍵。
  草稿仍留本機；版面是否套用另行選擇，既有新資料匯入不搬動舊卡。
  瀏覽器預覽的自動備份入口明示不支援並停用；Windows 原生操作見下方，其他平台進度見 PROGRESS。
- 「版本與衝突」可比較分支、採用版本、下載其附件、恢復較早內容，並处理群組合併循環。
  恢復會建立新版本，保留後來的內容；未完成草稿仍可取回。多分支尚未處理時一般保存會保留草稿並提示。
  群組沒有接收目的或超過九組時，資料保留並提供整理說明。未完成轉組可重試或取消該意圖。

此預覽不是 OS 桌面浮層。逐卡層級保存偏好，實際分層／穿透／全域快捷鍵由原生 host 完成。

## Windows 原生主畫面

建置需 Windows 10 build 19041+／11、.NET 10 SDK、Evergreen WebView2 Runtime 與 Node 22+；先執行 `npm ci --ignore-scripts`。
MSIX 最低版本為 22000，涵蓋早期 Windows 11／23H2 與 24H2+，在安裝資格上排除 Windows 10；MaxVersionTested 保留 26200。
2026-10-09 已在 23H2 build 22631／144 DPI 通過隔離原生探針與三層真螢幕像素檢查，並驗證未簽章 MSIX 內容；正常互動與 MSIX 安裝仍待使用者驗收。
沒有本輪其他版本設備，既有 26200／25H2 紀錄不等於 26100／24H2 實測。支援與未測範圍見 [ADR-034](decisions/034-windows-11-compatibility-and-install-floor.md)、[接手入口](handoff/2026-10-09-windows-11-compatibility-handoff.md) 與 PROGRESS；Store 尚未正式提交。
直接執行 `Build-WindowsApp.ps1`／IDE 的一般建置產物需 .NET 10 Desktop Runtime；`Build-WindowsPackage.ps1` 的 MSIX／ZIP 預設自帶 runtime。
兩者仍需 Evergreen WebView2 Runtime。主畫面、加密保存與桌面／浮動場景已接通。

```powershell
.\scripts\windows\Build-WindowsApp.ps1
& .\src\native\windows\app\bin\Release\net10.0-windows10.0.19041.0\WorkFleet.exe
```

資產與 native libraries／Licenses 隨輸出目錄保留，不單獨移動 exe。
IDE 使用 `src/native/windows/WorkFleet.sln`；VS Code 開啟根目錄即有 C# Dev Kit 建議與 F5 設定，
目錄結構與開啟方式見 [Windows README](../src/native/windows/README.md)。
`-Configuration Debug` 的 App 在右鍵選單提供「檢查」（DevTools）。設定 `WORK_FLEET_WEBVIEW_DEBUG_PORT` 才開 loopback CDP。
Release 與 MSIX 都不開；用法見 [測試](testing.md)、決策見 [ADR-032](decisions/032-windows-debug-webview-inspection.md)。
Windows SDK targeting pack 固定為 10.0.19041.56；UI probe 也使用 App 的 PerMonitorV2 manifest。
這個 TFM 是建置下限，不是支援的最低 OS；混合 DPI 實機驗收另見 PROGRESS。
沒有 Google ID 也能離線記錄；內容、附件、草稿、版面與備份 journal 儲存於
ZIP／Debug 的 `%LOCALAPPDATA%\WorkFleet\fleet.sqlite3`，或 MSIX 套件私有資料區的
`LocalCache\Local\WorkFleet\fleet.sqlite3`，payload 使用目前 Windows 使用者的 DPAPI 保護。
MSIX 更新保留資料；解除安裝清除套件內全部本機／Google 帳號資料、設定、憑證及 cache。
重裝前先匯出 ZIP；匯出的檔案與 Google 雲端不受影響。舊獨立目錄需以舊版／ZIP 匯出再於 MSIX 匯入，不自動搬移或刪除。
登入 Google 後若要全部覆蓋，使用「清空 Google 後，從備份還原」，詳見 [Google 操作](google-setup.md)。
同一路徑只允許一個 App，另一個視窗會提示使用原視窗。
關閉先等草稿保存及自動備份收尾；還在對話框或 IME 輸入時先完成該操作。
保存失败保留視窗及草稿；重新開啟會讀取已提交內容。

主畫面「調整此組／調整全部」讓對應卡片暫時移到最上層，按「完成」後回到該組的層級。
桌面紙面可就地編輯，Ctrl+Enter 保存、Esc 保留草稿退出編輯（空白或未修改不保留）；完整編輯回到主畫面處理附件等內容。
每個群組在一個層級上，由後到前為桌布層、桌面層、最上層；新群組在桌面層。按該組的區域鍵（預設 Ctrl+Shift+1–9）依序切換。
桌面層與最上層的便箋鎖定時也可以選取文字、點連結，不會穿透滑鼠；桌布層固定穿透。
Windows Explorer 環境的桌布層附著到圖示下方。電腦版在群組旁的「⋯」→「群組設定」選「桌面上的層級」，
也可以按該組的區域鍵切換；手機與瀏覽器預覽沒有這個選項。便箋詳情只保留「在桌面顯示」。
設定的「鎖定時也顯示桌面便箋」需開啟，才會在鎖定狀態常駐。
主畫面不再鏡像桌面版面；拖拉直接在桌面上進行。篩選列右側切換「便箋」（正方形紙張網格）或「清單」，
選擇記在這台裝置；點一張便箋開啟編輯。第三個「版面地圖」目前只是空白預留畫面。
新便箋預設 240×240 正方形；已在桌面上的便箋維持原尺寸，重置桌面佈局後才套用。
宿主不可用時會提示暫以桌面層呈現，原偏好保留；分層決策見 [ADR-030](decisions/030-windows-explorer-wallpaper-layer.md)。
macOS 同一操作入口使用 AppKit 三層；Linux layer-shell 使用三個原生 band。
pcmanfm 桌面將桌布和圖示畫在同一 surface，便箋無法放在圖示下方，所以不提供桌布層；它與 X11 的桌布偏好都回退桌面層。
上述範圍、穿透／重畫及原生驗證見 [ADR-031](decisions/031-macos-and-linux-wallpaper-scenes.md)。
調整管理視窗大小不搬動桌面卡片；啟動採當時顯示器工作區。
Windows 全域快捷鍵依設定啟用；設定內顯示每鍵註冊、衝突或保留狀態，可重試或改鍵。
Ctrl+Alt 加字母／數字不作全域註冊，以保留 AltGr 產字；可改成 Ctrl+Shift 或 function-key 組合。
App 取得焦點時釋放全域註冊，由目前視窗處理本地按鍵；組字與對話框優先。
視窗 X 或系統匣「收起主畫面」後，桌面及本機資料權威繼續執行；系統匣可重新開啟、快速記錄、操作或退出。
視窗 X 收起到系統匣（macOS 為選單列），結束請用系統匣「保存並結束」；系統匣不可用時 X 才保存並退出。延遲後焦點若已改變，點一下浮動卡片即可繼續。
目前啟動採當時顯示器拓撲；熱插拔恢復仍待整合。
此功能連接不等於真滑鼠／IME、混合 DPI、Show Desktop 與虛擬桌面矩陣已全部驗收。

不要把原生 DB 當成跨機備份，DPAPI 需原 Windows 帳號金鑰。預覽 IndexedDB 與 native 是不同 profile，
不自動搬動既有資料。主畫面沿用上述 editor／群組／還原操作，Google 設定與登入見下節；
手動匯出使用原生資料夾選擇器，每次建立 `work-fleet-backup-UUID.zip` 新檔並讀回校驗。
自動備份預設關閉，在「資料與備份」選位置、密碼及保留份數後啟用；
預設保留七份，有變更且距成功滿 24 小時才備份，開啟／恢復時補跑。
密碼由 DPAPI 保存在目前 Windows 帳號，renderer 只取得金鑰 ID；換裝置還原仍需自行保管原密碼。
停用或換位置會保留舊檔；未完成、被改過或替換的檔案會保留並顯示問題。
保存目前只支援本機 NTFS 資料夾，拒絕網路磁碟、FAT／exFAT、symlink／junction。
讀取可攜備份仍可使用一般檔案選擇器。未自動操作真 OS picker 或測外部磁碟斷電耐久。
原生測試命令見 [Testing](testing.md)，技術邊界見 [ADR-015](decisions/015-windows-native-storage-and-editor-host.md)
及 [ADR-016](decisions/016-windows-native-backup-files-and-vault.md)、[ADR-018](decisions/018-single-owner-desktop-views.md)、
[ADR-019](decisions/019-windows-shortcuts-and-tray.md)。

## Google 與原生建置設定

把根目錄 [.env.example](../.env.example) 複製為 `.env`，依平台填入公開 client ID、
Google Cloud project ID、原生 bundle/package ID，Apple 平台另填 team ID。
尚未建立時保留空值，本機預覽照常建置；`.env` 已被 Git 忽略，shell／CI 同名值優先。
`ANDROID_HOME`、`JAVA_HOME`、`DEVELOPER_DIR` 是 SDK 工具鏈位置，範例中以註解保留，
實際原生建置仍需相對應 OS／SDK；設定路徑不代表已有裝置驗收證據。

```bash
npm run config:check
npm run config:check -- --google --platform windows
npm run config:check -- --platform windows
```

第一個命令列出五平台缺少哪些設定；`--google` 只列 Google 設定，不要求商店／簽章欄位。
指定平台時，缺少該模式所需公開設定即以非零狀態結束。
`npm run build` 讀取設定並產生 `build/config/public.json` 供原生封裝使用，僅輸出允許的公開欄位。
各平台共用的產品行為（例如登入啟動等待系統匣的秒數）不在 `.env`，而是來自 repo 的 `config/startup.json`，一併寫進同一檔。
Windows 建置腳本改用 `node scripts/build-web.mjs --platform windows`，另把 Windows Desktop client secret 寫進同一檔；
Linux 封裝也只寫入 Linux 的 secret，其他平台與介面資產都不含 secret。
Android Gradle 直接讀取目前設定並在其生成資產目錄產生配置，不依賴這份預先生成檔。
五平台原生 host 已接 Google 登入、受保護 token 及 Drive appDataFolder 同步程式；
Google Cloud 專案／client 尚未建立，未做真實登入或 Drive 往返。執行狀態見 PROGRESS。
填 client ID 並重新建置後，從原生主畫面登入；瀏覽器開發預覽仍只有本機資料。
登入不會自動傳送既有 local／瀏覽器預覽資料；client 建立及搬移方式見
[Google 設定](google-setup.md)。

Google 設定步驟：在同一 Cloud project 啟用 Drive API，設定 OAuth consent screen／測試使用者，
Windows／Linux 建立 Desktop app client；Google Apple SDK 的 macOS／iOS 皆建立符合各自
bundle ID 的 iOS 類型 client，Android 建立符合 package／
簽章憑證的 client。五平台必須實測可讀取同一 App 資料空間。
登入透過系統允許的 OAuth 介面；desktop loopback 回呼不能沿用於 iOS／Android。
依據 [Google native-app OAuth 文件](https://developers.google.com/identity/protocols/oauth2/native-app)
及 [loopback 平台限制](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration)。

不要在 `.env` 放 access/refresh token、簽章私鑰或 service-account JSON；登入憑證由原生安全儲存管理，
CI 簽章秘密由 CI secret／keychain 提供。Client ID 是公開應用識別，不能代替 OAuth 驗證。

## Android 1.0 建置

在 Android Studio 使用 **Open** 選擇 `src/native/android`，完成 Gradle Sync，再選 `app`／`debug` 並 Run 或 Build APK。
需要 Node 22+／npm 可從 IDE 的 PATH 找到、JDK 17 或相容新版本、Android SDK Platform 36／Build Tools 35.0.0。
專案附 Gradle 8.13 Wrapper，Gradle 自動安裝 lockfile 依賴並產生介面及公開配置；不需預先 `npm run build`。
未填 `.env` 時可以使用本機 preview；Google 與正式 release 配置另見 [Android README](../src/native/android/README.md)。

```powershell
# 在 src/native/android 目錄
.\gradlew.bat assembleDebug
```

APK 位於 `src/native/android/app/build/outputs/apk/debug/WorkFleet-<versionName>-android-debug.apk`；
`Build-AndroidApp.ps1`／`build-android-app.sh` 會再複製到 `build/`；
版號與各平台檔名見 [散布文件](deployment.md#版號與發佈檔名)。
修改 `.env` application ID 後重新 Sync；`local.properties` 為 IDE 產生的本機 SDK 路徑，不提交版本控制。

## macOS／iOS 1.0 原生建置

需要完整 Xcode、Node 22+／npm；macOS 13+／iOS 16+。
clone 後直接開啟 `src/native/apple/WorkFleet.xcodeproj`，選 WorkFleetIOS＋Simulator 或 WorkFleetMac。
專案已提交並使用相對路徑；Xcode 自動安裝依賴與產生資產，不需要先執行生成器或 web build。
Google／商店公開設定放 `.env`；直接 Xcode 的 app ID／App Group／Team 放在忽略的
`src/native/apple/config/Local.xcconfig`，範例同目錄。簽章憑證／provisioning 於 Xcode 配置，私鑰不放設定檔。

```bash
open src/native/apple/WorkFleet.xcodeproj
# 或使用同一份專案的命令列入口：
bash scripts/macos/build-native-app.sh --platform macos
bash scripts/macos/build-native-app.sh --platform ios --simulator
bash scripts/macos/build-native-app.sh --platform ios --release
bash scripts/macos/package-preview-app.sh --platform macos --dmg
```

腳本使用已提交的專案；DerivedData／Release xcarchive／export 保留於忽略的 `build/apple/`。
macOS 命令列建置一律含 arm64／x86_64；預覽封裝依 App 的版號與簽章命名，`--dmg` 產生 DMG，安裝檔放在 `build/`。
原生主畫面接 SQLite／Keychain、原生資料夾備份、Google 授權／Drive；macOS 另接桌面場景、
全域鍵、選單列及螢幕生命週期。macOS Debug universal 已在 Xcode 編譯並產生 Apple Development 簽章 DMG，
獨立 fixture 的 Keychain／SQLite／主畫面初始化通過；iOS、Developer ID／公證與完整操作尚未驗收。
本機 Mac 必須在 WorkFleetMac target 的 Signing & Capabilities 選 Team、啟用自動簽章並完成 Register Device。
操作細節及剩餘交付見
[Apple README](../src/native/apple/README.md) 與 [PROGRESS](../PROGRESS.md)。

iOS 分享接收另嵌入 `<APP_ID>.share` Extension；在同一 Apple team 為 App／Extension 啟用
App Groups。直接 IDE 使用 Local.xcconfig 的 WORK_FLEET_APP_GROUP_ID；CLI 可用 `.env` 覆蓋，
預設採 `group.<WORK_FLEET_APP_ID>`。實際 signing profiles 需包含此 group，憑證留 Xcode／Keychain。

## 原生安裝包與簽章入口

Windows x64 封裝預設使用 self-contained .NET 10 Desktop，MSIX／ZIP 接收端不用另外安裝 .NET；WebView2 仍是執行前置條件。
建置端需要 .NET SDK，Windows SDK 提供 MakeAppx／SignTool。首次打包會還原 win-x64 runtime packs，完成後才可使用 `-SkipRestore`。
公開 identity／publisher 由 `.env.example` 配置；preview 可以暫不設定正式 Google 帳號。

```powershell
.\scripts\windows\Build-WindowsPackage.ps1
.\scripts\windows\Build-WindowsPackage.ps1 -LocalTestSign
.\scripts\windows\Build-WindowsPackage.ps1 -Release -CertificateThumbprint <thumbprint> -TimestampUrl <https-url>
.\scripts\windows\Build-AndroidApp.ps1 -Signed
.\scripts\windows\Build-LinuxPackage.ps1
```

Windows 的 MSIX／ZIP 輸出到 `build/`（工作目錄 `build/windows/package` 每次重建），未提供憑證時 MSIX 未簽章。
本機試裝使用 `-LocalTestSign`：重用 CurrentUser/My 中與 manifest publisher 完全相符、
有效且已在 LocalMachine/TrustedPeople 信任的 code-signing 憑證；多張時用 `-CertificateThumbprint` 指定。
這個模式必須成功簽章及通過本機信任驗證才交付，另輸出不含私鑰的 `WorkFleet-preview.cer`。
已信任該憑證的電腦可直接開啟 MSIX 安裝，不需 Windows Store 開發者帳號。
其他測試電腦需先信任該公開 CER；參考 [Microsoft 本機簽章說明](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide)。
腳本不建立憑證、修改信任或安裝 App；`-LocalTestSign` 不使用 timestamp，不能與 `-Release` 合用。
Windows 若已有 JDK 17 但缺少 Android SDK，可先執行
`scripts/windows/Install-AndroidToolchain.ps1 -AcceptSdkLicenses`；須先閱讀並接受
[SDK 條款](https://developer.android.com/studio#terms-and-conditions)。工具、API 36、Build Tools 35.0.0
與 paths JSON 放在 `build/toolchain`，不修改機器 PATH。之後 `Build-AndroidApp.ps1` 可直接讀取路徑。
Android 簽章的四個 process／CI environment inputs 見 [商店準備](release/README.md)，不寫入 `.env`。

Apple 先使用上一節 Release 入口產生 archive，再在有 Xcode 的 Mac 匯出：

```bash
bash scripts/macos/package-native-app.sh --platform ios --method app-store-connect
bash scripts/macos/package-native-app.sh --platform macos --method developer-id --dmg
bash scripts/linux/build-android-app.sh --signed
```

Apple 可使用 `--archive` 指定既有 archive；macOS 正式簽章與公證另提供 installer／application identity
及 Keychain notary profile，詳見 [散布文件](deployment.md)。這些入口不建立商店帳號或自動送審。

## Linux 1.0 原生建置

需要 Linux 的 Python 3.10+、GTK 3、WebKitGTK 4.1、PyGObject／cairo
及 cryptography。新工作空間與完成主金鑰遷移的離線便箋不需要 keyring。
Google 權杖、保存的自動備份密碼及舊資料首次遷移需要 libsecret／已解鎖的持久 Secret Service；
鎖住時只暫停相關功能，開機與背景同步不要求密碼（[ADR-048](decisions/048-linux-offline-workspace-and-system-secrets.md)）。
自動登入可能讓金鑰圈保持鎖定；按「立即同步」會開啟系統解鎖視窗，成功後接續同步，取消／逾時可再次重試。
原生主畫面／SQLite／加密／Google／備份與桌面場景已接入。
X11 全域鍵可使用 Keybinder 3；Wayland 桌面需 GtkLayerShell 支援，快捷鍵需 GlobalShortcuts portal
backend。系統匣依 Ayatana／AppIndicator 或 Gtk.StatusIcon 可用性啟用；缺能力時主畫面仍可記錄。

```bash
npm ci --ignore-scripts
bash scripts/linux/build-native-app.sh
bash "build/linux/work-fleet-$(cat src/native/linux/VERSION)/run-work-fleet.sh"
bash scripts/linux/build-native-app.sh --deb
bash scripts/linux/build-native-app.sh --release --deb
```

GNOME Wayland（例如 Ubuntu 22.04 預設）沒有 layer-shell，桌面便箋要經 XWayland；首次啟動會詢問是否改用，
之後可在設定的「桌面」頁切換（[ADR-040](decisions/040-gnome-wayland-xwayland-choice.md)），也可直接以 `GDK_BACKEND=x11 work-fleet` 啟動。
經 XWayland 時群組只常駐桌布層（[ADR-039](decisions/039-gnome-desktop-icons-and-x11-scene-size.md)）。
Raspberry Pi OS（labwc）等 layer-shell 桌面的常駐層不受遮罩限制（預設 pcmanfm 桌面沒有桌布層），調整模式同樣以遮罩覆蓋整個螢幕並隱藏主視窗。
產生 source/runtime tar.gz；`--deb` 需 Debian 工具，`--release` 另需正式公開設定。隔離 headless Linux compositor
的原生場景及私人合成金鑰圈檢查見 testing／PROGRESS，不代替使用者重開機或安裝驗收；細節見 [Linux README](../src/native/linux/README.md)。

Windows 可用既有 Docker Linux engine 執行 `Build-LinuxPackage.ps1`，以固定 Ubuntu image 的
dpkg-deb 產生 preview DEB；不要求本機有 Linux GUI，也不執行 App。`-Release` 要求公開正式設定。
Linux 與 Windows 建置入口都直接產生 `build/work-fleet_<版號>_all.deb`，不需手動搬檔。
tar.gz 與 DEB 同在 `build/`，source/runtime 副本在 `build/linux/`；DEB staging 在封裝結束時自動清除。
DEB 適用提供上述系統依賴的發行版。
版號記在 `src/native/linux/VERSION`；一般與 release 建置都使用此版號，早期版本不另加 `~preview`。

Apple 手動建置 workflow 在 `.github/workflows/apple-native-build.yml`；選擇 macOS、iOS 或兩者，
在 hosted Mac 編譯原生 Debug App，輸出未簽章 ZIP／device IPA。公開設定使用同名 GitHub
repository variables；不設值時採 preview ID／無 Google 的本機模式。
公開 repository 的 hosted runner 不計費；手動 workflow 仍需使用者授權才啟動。
取得 developer account／簽章後仍需前述正式 archive／export；未簽章 device IPA 需要重新簽署才可安裝。

## 既有 0.1.0 需求

- macOS 13+、Command Line Tools（`xcode-select --install`）；已測 macOS 26.7.1 x86_64、Swift 6.3.3。
- Python 3.12+，含標準庫 sqlite3；已測 Python 3.14.7／SQLite 3.51.0。
- Node 22+ 只用於 JavaScript 測試；已測 Node 24.21.0。
- 無 pip/npm runtime 套件、不需 npm install，不需正式簽章憑證。
- 本機 ad-hoc 簽章適用驗證；跨機散布與商店仍需正式簽章／封裝驗證。

## macOS 一次啟動

從 checkout 根目錄：

```bash
bash scripts/macos/start-validation.sh
```

指令建置 `build/Work Fleet.app`，啟動 loopback 服務，使用一次性管理員邀請配對 Mac。
資料預設在 `~/.work-fleet/`，App 設定與離線快取在自己的 Sandbox container。
終端 Ctrl-C 停止本次啟動的 server；選單列 WF → 結束關閉 App。
可用 `WORK_FLEET_DATA` 指定 repo 外的資料目錄，以 `--port 9848` 更換 port。
已占用的 port 會直接失敗，不停止其他服務。

## 分開啟動與第二個 client

```bash
bash scripts/macos/build-app.sh
python3 src/server/work_fleet.py serve
```

另一個終端產生管理員邀請（邀請輸出是短效祕密，勿提交／分享永久 token）：

```bash
python3 src/server/work_fleet.py invite --role admin
open 'build/Work Fleet.app'
```

在選單列 WF → 連線與展示，輸入 `http://127.0.0.1:9847` 與輸出的 `code`。
Mac 已配對後，可從控制窗產生 editor QR；從 Web 管理頁可選唯讀或可編輯並撤銷裝置。

開啟 `http://127.0.0.1:9847`，使用另一份 editor 邀請配對瀏覽器：

```bash
python3 src/server/work_fleet.py invite --role editor
```

瀏覽器與 App 使用同一份 server 資料。Safari/WebKit 各自保留本機草稿，不共用儲存空間。

## 操作

- 快速記錄：WF → 快速記錄／解鎖，輸入文字後保存；群組預設 Inbox。
- 支援 Todo、In Progress、Done；Done 與已刪除分開查看並可還原。
- 文字中的 `- [ ]` 與 `- [x]` 呈現可勾選待辦。
- WF → 鎖定後展示唯讀便箋；仍每 2 秒收資料，預設位於桌面圖示上方。
- 控制窗可切換一般視窗、圖示上方、圖示下方。圖示下方為實驗模式。
- Web 輪詢每 2.5 秒；離線顯示上次內容，草稿逐次輸入保存。
- 網路錯誤保留原操作並顯示「重試同一筆傳送」；衝突提供目前內容及另存副本。
- 「保留的草稿」可取回，取回建立獨立草稿避免分頁互相刪除；原稿須明確捨棄。
- 連線与裝置 → 匯出本機草稿可下載 JSON；目前無自動匯入或合併功能。

## LAN／手機 QR

loopback QR 僅供同一台 Mac，手機掃描不會因此取得網路路徑。
LAN 請使用手機信任的 TLS 憑證，設定精確 hostname/origin，例如：

```bash
python3 src/server/work_fleet.py serve --host 0.0.0.0 --port 9847 \
  --origin https://fleet.example.test:9847 --cert /secure/path/cert.pem --key /secure/path/key.pem
```

先用該 HTTPS URL 配對 Mac，再產生 QR；手機確認網址與名稱後提交一次性邀請。
憑證、DNS／主機名解析與 LAN 可達性需自行配置。未加入忽略 TLS 驗證或自動信任憑證的功能。
外網存取需可信 HTTPS 部署或 VPN；尚未測真實手機／外網／商店封裝。

## 備份與恢復

備份可在 server 運作時執行；目的檔不得已存在：

```bash
python3 src/server/work_fleet.py backup /secure/path/fleet-backup.sqlite3
```

先停止 server，還原到**新資料路徑**（不覆寫目前 DB）：

```bash
python3 src/server/work_fleet.py --db /secure/path/restored.sqlite3 restore /secure/path/fleet-backup.sqlite3
python3 src/server/work_fleet.py --db /secure/path/restored.sqlite3 serve
python3 src/server/work_fleet.py --db /secure/path/restored.sqlite3 invite --role admin
```

恢復會換 epoch、撤銷全部裝置並清除邀請／操作重試紀錄。重新配對後讀取 restored snapshot；
舊草稿仍保留，但不可直接覆蓋新資料世代。原 DB、備份與裝置上的未同步草稿分別保管。
備份包含私人內容與 token hashes，應放在受保護且必要時加密的儲存位置。
