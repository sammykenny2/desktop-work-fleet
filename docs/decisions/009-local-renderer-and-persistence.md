# ADR-009: 本機 renderer、草稿與附件保存

## Status

Accepted（共用介面與瀏覽器 adapter），2026-10-04。
五平台原生 host、Google 同步與可攜備份仍由後續決策完成。

## Context

[ADR-008](008-portable-interaction-core.md) 的核心需要真實 DOM 操作及持久化邊界，
才能驗證固定紙面編輯、拖放、草稿恢復與附件。既有 0.1.0 HTTP／SQLite prototype
不能成為無便箋 server 的 1.0 執行架構。

## Decision

- `src/app` 使用原生 ES modules 與本機封裝資產。開發預覽僅提供靜態檔案，
  不接收便箋、附件或憑證。正式 host 不依賴開發 listener。
- 瀏覽器 adapter `src/storage/indexed-db.js` 以 profile 分區，單一 readwrite transaction
  做 revision 比對與整份 Workspace 提交，等 transaction complete 才回報成功。
  Web Locks 限制每個 profile 只有一個工作空間協調者，CAS 仍防止競爭寫入。
- 要求 IndexedDB strict durability；這是 API 要求，不是已完成斷電／硬體耐久驗收。
  原生檔案、OS 安全儲存與多表面 IPC 要沿用同一交易契約，另行實作。
- 草稿與卡片、outbox 同一保存邊界。提交草稿成功才刪除草稿；版本衝突可另存副本。
  恢復草稿帶有原稿基線，成功保存時只移除未再變更的原稿。
  尚在寫入或失敗時保留編輯內容及離頁提示；不以關頁後的非同步寫入保證資料安全。
- Marked 18.0.14 解析 GFM；原始 HTML 當文字顯示，再由 DOMPurify 3.4.16
  的允許清單清理生成 DOM。外部圖片不自動載入，連結僅允許 HTTP／HTTPS／mailto。
  Checklist 修改對應的已解析 task，保留 code block、跳脫文字及其餘原稿。
- 附件最多每檔 25 MiB，以 SHA-256 定址，bytes 先保存成功才寫入草稿引用。
  附件依 profile 隔離；下載 URL 一律使用 application/octet-stream，
  不在 App origin 呈現 HTML／SVG。原始 MIME metadata 與 bytes 保留供匯出及未來來源整合。
- 固定紙面可就地編輯，完整 editor 提供格式預覽與附件；關閉先保存草稿。
  清單、搜尋、封存／刪除檢視不改桌面 geometry；隱藏區域不能作為螢幕縮小證據。
- 依賴固定版本及 lockfile，build 複製 runtime ESM、完整授權與 notice；
  Playwright 僅為測試依賴，不打包瀏覽器。CSP 不允許遠端 script 或任意 inline script。

## Consequences

### Positive

- 真實瀏覽器可以獨立測試 renderer 與故障邊界，核心與原生 host 可分開迭代。
- 內容、草稿、待同步操作不會因 UI 先顯示成功而形成半套保存。
- 手機寬度也有草稿與設定入口；這不取代 iOS／Android 原生 App 的交付。

### Negative

- 整份 Workspace snapshot 寫入的容量及效能尚需大資料驗收；附件未引用 bytes 暫不自動清除。
- 瀏覽器儲存受 origin、瀏覽器 profile、使用者清除及配額限制；預覽不是正式備份。
- 不支援 Web Locks 的 browser 會明確拒絕開啟；原生 host 的能力與最低版本另驗收。

### Neutral

- 介面的常駐層級選項目前保存政策；瀏覽器不聲稱擁有 OS 分層／穿透／全域快捷鍵。
- 自動／加密備份、帳號 OAuth、群組合併與原生包裝仍須完成，沒有降低 1.0 範圍。

## Alternatives Considered

### 沿用 prototype localhost API

- 已有 SQLite 交易及舊 App；但不符合 1.0 無便箋 local server 的方向，因此不採用。

### 手寫 Markdown parser 或使用遠端 renderer

- 可少一個本機套件或減少封裝；但解析、安全、離線及隱私責任更難控制，因此不採用。

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [IndexedDB transaction](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction)
- [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [Marked](https://marked.js.org/using_advanced)
- [DOMPurify](https://github.com/cure53/DOMPurify)
- [第三方聲明](../../THIRD-PARTY-NOTICES.md)

*Decision made: 2026-10-04*
