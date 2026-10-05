# 專案進度

更新：2026-10-05。本檔是本 repo 的執行狀態權威。

## 目前優先方向

使用者已授權逐 slice 實作並直接 commit/push origin/main，直到完整 1.0 完成。
2026-10-05 最新指示要求先完成實作、不再投入驗證；未執行的检查不視為通過。
本次還明確納入 iOS／Android 原生 App 與商店提交準備，並核准完整 editor／逐卡設定／備份範圍。
核心測試通過不代表五平台或 Google 驗收已完成。

2026-10-05 最新指示改為先收尾；Apple 編譯由維護者帶到真正的 Mac 處理。
不再等待或啟動 Apple hosted Actions，不使用其計費額度。
本輪集中收尾 Google 程式與公開設定；Google 專案／各平台 clients 尚未建立，
Apple team、正式 package identity／簽章及公開隱私／支援設定仍需維護者配置。
現有安裝產物是 preview，完整 1.0 尚未完成；不再以未固定口徑的百分比回報。

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
| 2 | 正式本機儲存、共用 renderer、Markdown/checklist/附件、完成/封存、完整設定 | 共用 UI／IndexedDB、Windows SQLite／DPAPI 已加入；Android SQLite／Keystore、Apple SQLite／Keychain、Linux SQLite／Secret Service 程式已加入；後三者原生 runtime 尚未執行 |
| 3 | Drive revision graph、OAuth、outbox、衝突、帳號隔離 | 共用版本圖／FileSync／衝突 UI 已實作；Windows 原生 Google 已建置，Android／Apple／Linux 原生授權與 Drive 程式已加入。Google 專案未建立，真登入／Drive 未驗收 |
| 4 | 含群組/版面/附件的手動、自動、加密備份及匯入/合併/取代還原 | 共用 ZIP／三種還原、Windows 原生備份已整合；Android SAF／Apple bookmark／Linux 原生目錄備份程式已加入，後三者 runtime 未執行 |
| 5 | Windows/macOS/Linux 原生 host、分層/穿透/快捷鍵/顯示器 | 三平台桌面場景、快捷鍵、系統匣／選單列與顯示器程式已加入；Windows 已建置，macOS 未編譯，Linux 未執行；完整 OS 矩陣仍缺 |
| 6 | iOS/Android 原生 App、檔案/OAuth/分享/生命週期 | Android 原生 preview APK 已產出，含資料／帳號、原生匯出、分享及加密收件匣；iOS UIKit／Extension source 已加入，缺 Apple SDK，未產 iOS package；兩者未做裝置／Google 驗收 |
| 7 | 安裝包、簽章與商店提交準備、授權盤點、最終 1.0 驗收 | Windows 未簽章 MSIX／ZIP、Android debug APK、Linux DEB／tar.gz 已產出；Apple export／PKG／DMG／手動 hosted build 與 Android upload signing 入口已加入。正式 AAB／Apple binary／簽章、screenshots／SDK 授權最終盤點仍缺，沒有送審或建立帳號 |

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
