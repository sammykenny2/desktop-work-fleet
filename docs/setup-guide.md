# 建置與操作

更新：2026-10-03。驗證版 0.1.0；詳見 [驗證報告](validation/2026-10-03-validation-report.md)。

## 需求

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
