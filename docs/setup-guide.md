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
- 日常觀看無法改文；「操作此組／操作全部」後單擊選卡、雙擊就地編輯。
  Ctrl／Command＋Enter 保存；Esc 保留草稿並結束編輯。完整編輯可管理附件及預覽。
- 拖曳只移動位置；放在另一組接收標籤或按住 Shift 放到另一組區域才轉組。
  堆疊／攤開先預覽，調整大小須每次勾選；復原依序還原 geometry／轉組。
- 清單提供完成、封存、刪除區及還原；搜尋全文，窄螢幕保留草稿及設定入口。
  桌面仍標示已完成卡片，封存／刪除才退出桌面集合。顯示與排列設定不立即重排既有便箋。
- 群組旁的「⋯」可重新命名或合併／移除；先選接收群組並預覽所有卡片及草稿。
  確認後內容與位置保留，來源群組移除；不能以版面復原重建原群組。
- 設定可交換群組區域，並自訂每組、操作全部、快速記錄與顯示切換的快捷鍵。
  可用 Ctrl／Alt／Meta 搭配字母、數字或 F1–F24，可加 Shift；多組以逗號分隔，留空取消。
  新工作區初始組為 Ctrl+Shift+1，全部 Ctrl+Shift+0，快速記錄 Ctrl+Shift+N，顯示切換 Ctrl+Shift+D。
  瀏覽器若保留該組合可在設定改鍵；既有工作區的自訂／舊預設保持不變。
  新增的群組可在設定綁定；預覽只在目前視窗生效，不宣稱已向 OS 註冊全域鍵。
- 同 profile 不允許第二個獨立視窗寫入；保存中或失敗時離頁有提示。
  沒有 Google 同步，清除瀏覽器資料會失去預覽資料；可先用設定內「資料與備份」保存 ZIP。
- 「資料與備份」可匯出明文或密碼加密 ZIP，驗證預覽後選擇匯入／合併／取代。
  加密輸出至少 12 個字元，手動匯出的密碼不保存且無法找回；還原使用原密碼。
  匯入預設另建資料，合併依原身分保留分支；取代保留歷史並把額外便箋移至刪除區。
  取代需先成功保存目前資料的安全備份；只支援下載而無法確認保存的瀏覽器會停用此步驟。
  草稿仍留本機；版面是否套用另行選擇，既有新資料匯入不搬動舊卡。
  瀏覽器預覽的自動備份入口明示不支援並停用；Windows 原生操作見下方，其他平台進度見 PROGRESS。
- 「版本與衝突」可比較分支、採用版本、下載其附件、恢復較早內容，並处理群組合併循環。
  恢復會建立新版本，保留後來的內容；未完成草稿仍可取回。多分支尚未處理時一般保存會保留草稿並提示。
  群組沒有接收目的或超過九組時，資料保留並提供整理說明。未完成轉組可重試或取消該意圖。

此預覽不是 OS 桌面浮層。逐卡層級保存偏好，實際分層／穿透／全域快捷鍵由原生 host 完成。

## Windows 原生主畫面

Windows 10 build 19041+／11、.NET 8 SDK、Evergreen WebView2 Runtime 與 Node 22+；先執行 `npm ci --ignore-scripts`。
執行已建置 App 的電腦需 .NET 8 Desktop Runtime。主畫面、加密保存與桌面／浮動場景已接通。

```powershell
.\scripts\windows\Build-WindowsApp.ps1
& .\src\native\windows\bin\Release\net8.0-windows10.0.19041.0\WorkFleet.exe
```

資產與 native libraries／Licenses 隨輸出目錄保留，不單獨移動 exe。
Windows SDK targeting pack 固定為 10.0.19041.56；UI probe 也使用 App 的 PerMonitorV2 manifest。
這個 TFM 是建置下限，最低 OS／混合 DPI 實機驗收另見 PROGRESS。
沒有 Google ID 也能離線記錄；內容、附件、草稿、版面與備份 journal 儲存於
`%LOCALAPPDATA%\WorkFleet\fleet.sqlite3`，payload 使用目前 Windows 使用者的 DPAPI 保護。
同一路徑只允許一個 App，另一個視窗會提示使用原視窗。
關閉先等草稿保存及自動備份收尾；還在對話框或 IME 輸入時先完成該操作。
保存失败保留視窗及草稿；重新開啟會讀取已提交內容。

主畫面「操作群組／所有群組」讓對應卡片浮到一般 App 上方，退出後回到各卡常駐層。
桌面紙面可就地編輯，Ctrl+Enter 保存、Esc 保留草稿退出編輯；完整編輯回到主畫面處理附件等內容。
其他便箋預設穿透，逐卡可開啟日常文字選取。桌布層目前以桌面層呈現並提示，原偏好不改。
調整管理視窗大小不搬動桌面卡片；啟動採當時顯示器工作區。
Windows 全域快捷鍵依設定啟用；設定內顯示每鍵註冊、衝突或保留狀態，可重試或改鍵。
Ctrl+Alt 加字母／數字不作全域註冊，以保留 AltGr 產字；可改成 Ctrl+Shift 或 function-key 組合。
App 取得焦點時釋放全域註冊，由目前視窗處理本地按鍵；組字與對話框優先。
「收起主畫面」保存草稿後保持桌面及本機資料權威執行；系統匣可重新開啟、快速記錄、操作或退出。
視窗 X 仍是保存並退出；系統匣不可用時主畫面保持開啟。延遲後焦點若已改變，點一下浮動卡片即可繼續。
目前啟動採當時顯示器拓撲；熱插拔恢復仍待整合。
此功能連接不等於真滑鼠／IME、混合 DPI、Show Desktop 與虛擬桌面矩陣已全部驗收。

不要把原生 DB 當成跨機備份，DPAPI 需原 Windows 帳號金鑰。預覽 IndexedDB 與 native 是不同 profile，
不自動搬動既有資料。主畫面沿用上述 editor／群組／還原操作，仍未連 Google；
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
npm run config:check -- --platform windows
```

第一個命令列出五平台缺少哪些設定；指定平台時，缺少發佈所需公開設定即以非零狀態結束。
`npm run build` 讀取設定並產生 `build/config/public.json` 供原生封裝使用，僅輸出允許的公開欄位。
目前這是設定入口及驗證，不代表 Google 登入／原生封裝已完成；執行狀態見 PROGRESS。
FileSync／Google Drive REST adapter 已可執行合成傳輸測試；預覽尚未接原生受保護 HTTP／OAuth，
填 client ID 不會自動開啟登入，也不會傳送既有預覽資料。

Google 設定步驟：在同一 Cloud project 啟用 Drive API，設定 OAuth consent screen／測試使用者，
Windows／Linux 建立 Desktop app client；Google Apple SDK 的 macOS／iOS 皆建立符合各自
bundle ID 的 iOS 類型 client，Android 建立符合 package／
簽章憑證的 client。五平台必須實測可讀取同一 App 資料空間。
登入透過系統允許的 OAuth 介面；desktop loopback 回呼不能沿用於 iOS／Android。
依據 [Google native-app OAuth 文件](https://developers.google.com/identity/protocols/oauth2/native-app)
及 [loopback 平台限制](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration)。

不要在 `.env` 放 access/refresh token、簽章私鑰或 service-account JSON；登入憑證由原生安全儲存管理，
CI 簽章秘密由 CI secret／keychain 提供。Client ID 是公開應用識別，不能代替 OAuth 驗證。

## macOS／iOS 1.0 原生建置

需要完整 Xcode、Node 22+；macOS 13+／iOS 16+。公開設定放 `.env`，
Apple team 的 signing certificate／provisioning 於 Xcode 配置，私鑰不放設定檔。

```bash
npm ci --ignore-scripts
bash scripts/macos/build-native-app.sh --platform macos
bash scripts/macos/build-native-app.sh --platform ios --simulator
bash scripts/macos/build-native-app.sh --platform ios --release
```

產生 `build/apple/WorkFleet.xcodeproj` 與兩個 shared scheme；Release 產生 xcarchive。
原生主畫面接 SQLite／Keychain、原生資料夾備份、Google 授權／Drive；macOS 另接桌面場景、
全域鍵、選單列及螢幕生命週期。尚未在 Apple SDK 編譯；操作細節及剩餘交付見
[Apple README](../src/native/apple/README.md) 與 [PROGRESS](../PROGRESS.md)。

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
