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
  初始組為 Ctrl+Shift+1，全部 Ctrl+Shift+0，快速記錄 Ctrl+Alt+N，顯示切換 Ctrl+Alt+D。
  新增的群組可在設定綁定；預覽只在目前視窗生效，不宣稱已向 OS 註冊全域鍵。
- 同 profile 不允許第二個獨立視窗寫入；保存中或失敗時離頁有提示。
  沒有 Google 同步，清除瀏覽器資料會失去預覽資料；正式備份功能尚待整合。

此預覽不是 OS 桌面浮層。逐卡層級保存偏好，實際分層／穿透／全域快捷鍵由原生 host 完成。

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

Google 設定步驟：在同一 Cloud project 啟用 Drive API，設定 OAuth consent screen／測試使用者，
桌面建立 Desktop app client，iOS 建立符合 bundle ID 的 client，Android 建立符合 package／
簽章憑證的 client。五平台必須實測可讀取同一 App 資料空間。
登入透過系統允許的 OAuth 介面；desktop loopback 回呼不能沿用於 iOS／Android。
依據 [Google native-app OAuth 文件](https://developers.google.com/identity/protocols/oauth2/native-app)
及 [loopback 平台限制](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration)。

不要在 `.env` 放 access/refresh token、簽章私鑰或 service-account JSON；登入憑證由原生安全儲存管理，
CI 簽章秘密由 CI secret／keychain 提供。Client ID 是公開應用識別，不能代替 OAuth 驗證。

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
