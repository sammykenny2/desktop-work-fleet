# 建置、測試與證據

更新：2026-10-04。新核心證據見 PROGRESS；既有 0.1.0 證據見 [驗證報告](validation/2026-10-03-validation-report.md)。

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

`tests/revisions.test.js` 驗證 SPEC-004 S01–S07：嚴格 JSON、正規 bytes、缺 parent／pending、
亂序分支／tombstone／晚到衝突、整批失敗及 12,000 筆反向歷史；不代表真 Google 已接入。
`tests/config.test.js` 驗證 `.env`／環境優先序、公開欄位 allowlist 及缺值／錯誤格式。
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

```powershell
.\scripts\windows\Test-WindowsNative.ps1
# 已 restore 可離線回歸：
.\scripts\windows\Test-WindowsNative.ps1 -SkipRestore
```

腳本建置 Debug app／probes，執行真 SQLite／DPAPI、JavaScript→native stdio bridge 及實際 WPF／WebView2。
資料庫、截圖皆寫入 `build/native-checks-*`／`build/native-js-*` 的獨立合成資料目錄；不讀取個人 App 資料。
WPF probe 使用螢幕外且不啟用的視窗，以 DOM 操作 editor、附件、關閉及重新開啟，截圖為 `ui/native-ui.png`。
另測加密自動備份、手動匯出與原生檔案的還原預覽；只替換互動 picker 結果，
原生檔案／DPAPI／SQLite／IPC 皆實際執行，沒有自動操作真 OS picker。
core probe 測 NTFS create-new、寫入／rename 競爭、部分檔保留、換檔不刪、同 handle 校驗／刪除、
目錄重開及替換拒絕；JS→native 測中文／emoji 密碼、跨程序 key／grant、ack 遺失恢復、
受管檔修改保留、manual 保存證明與失效／跨 profile key 不降級。
需要一般 Windows 使用者 session 與 WebView2 Runtime；受限工具環境若造成 WebView2 crash，需在可運行環境重測，
不能當作通過或停用 WebView2 sandbox。主畫面／保存測試不代表多螢幕、OS 桌面整合或真實斷電證據。

同一腳本另執行 `--composition` 與 `--platform` 原生基礎探針：

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

`npm test` 會明確 skip 8 個需要已建置 Windows helper 的 native integration tests；
`WORK_FLEET_NATIVE_TEST=1` 才執行它們，缺少 helper 即失敗，不假報成功。
若單獨執行，先用 `Build-WindowsApp.ps1 -Configuration Debug -IncludeTests`，再設變數並執行
`node --test tests/native-storage.test.js`。無 OS 依賴的 bridge 關閉／訊息容量測試每次都跑。

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
