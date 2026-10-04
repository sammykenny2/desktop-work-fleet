# 專案進度

更新：2026-10-04。本檔是本 repo 的執行狀態權威。

## 目前優先方向

使用者已授權逐 slice 實作、驗證並直接 commit/push origin/main，直到完整 1.0 完成。
本次還明確納入 iOS／Android 原生 App 與商店提交準備，並核准完整 editor／逐卡設定／備份範圍。
核心測試通過不代表五平台或 Google 驗收已完成；完整目標持續進行。

已確認產品語意以 [SPEC-003](docs/specs/003-desktop-cards-groups-and-formation.md)
及 [ADR-006](docs/decisions/006-card-group-and-formation-semantics.md) 為準：
一事一卡、通用群組、九組 grid、自由移位、顯式 formation／尺寸同意／undo、
只改 z-order 的輪播、指定組／All 操作、單擊選卡雙擊編輯、顯式拖放轉組。
整理期間另取得明確答覆：操作組暫時浮到一般 App 上方；採用標籤／Shift 的轉組手勢。

## 1.0 執行切片

| Slice | 範圍 | 狀態與證據 |
|---|---|---|
| 1 | 共用 Card/Group、formation、layout/undo、interaction、原子命令 | 已實作 `src/core`、`src/layout`、`src/interaction`、`contracts/desktop.d.ts`；39 個新核心測試及 8 個舊草稿測試通過；獨立唯讀審閱完成，已報問題均修正並複核 |
| 2 | 正式本機儲存、共用 renderer、Markdown/checklist/附件、完成/封存、完整設定 | 本機 UI／IndexedDB、群組合併／移除、區域與快捷鍵設定已完成並經真 Edge 與獨立審閱；原生保存整合、大容量與完整平台設定仍待補齊 |
| 3 | Drive revision graph、OAuth、outbox、衝突、帳號隔離 | 嚴格 JSON／不可變 revision graph 已有實作及故障測試；Workspace／Drive 整合待接，Google 設定尚未建立 |
| 4 | 含群組/版面/附件的手動、自動、加密備份及匯入/合併/取代還原 | 範圍已核准，格式與交易實作尚待完成 |
| 5 | Windows/macOS/Linux 原生 host、分層/穿透/快捷鍵/顯示器 | 尚待整合；C16/C35/C40–C43/C46–C47 原生證據不能以邏輯測試代替 |
| 6 | iOS/Android 原生 App、檔案/OAuth/分享/生命週期 | 已納入本次範圍；尚待實作與裝置驗收 |
| 7 | 安裝包、簽章與商店提交準備、授權盤點、最終 1.0 驗收 | 尚待完成；沒有送審、購買憑證或建立帳號 |

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
Drive／備份承接 ADR-004／005 的 Proposed 設計，須補上群組模型與已核准完整範圍。
Google 登入、OAuth 專案、SDK、Drive 寫入、正式商店設定都未實作或操作。

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
