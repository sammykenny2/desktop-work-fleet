# ADR-015: Windows 原生主畫面與加密儲存

## Status

Accepted，2026-10-04，限 Windows 管理／編輯主畫面、原生保存及受限 bridge。
桌面呈現仍依 ADR-007／SPEC-003 各項能力施工；本決策未把五平台縮成一般視窗。

## Context

共用 renderer／Workspace／完整備份已有可執行核心，原生主機須去掉預覽 listener，
讓原子交易、附件及自動 journal 落在主機掌握的儲存位置；OS 秘密不能透過通用 proxy 外洩。
目前可用 Windows／.NET 8 SDK，Google 專案及其他原生建置環境尚未建立。

## Decision

- Windows 管理／編輯視窗採 .NET WPF + WebView2 1.0.4258.31，載入封裝 ES modules。
  `https://work-fleet.invalid` 僅為 WebView2 virtual host mapping，沒有 DNS／HTTP listener。
  runtime 使用系統 Evergreen WebView2；目前依賴 .NET 8 Desktop Runtime，不包入 SDK。
- SQLite 使用 Microsoft.Data.Sqlite 10.0.12／SQLitePCLRaw 2.1.12，版本與内容 hash 進 lockfile。
  單一原生 owner 鎖、WAL + FULL synchronous；workspace 與 journal 各自 CAS revision。
  還原將 Workspace／receipt／附件同交易提交；未完成傳輸只進隔離 staging。
- DPAPI CurrentUser 加密 record、附件、staging 與 vault payload，entropy 綁 profile／用途／身分。
  解密失敗就停止該操作，不另建空白資料或改用明文；SQL 表名、profile／revision／hash 等索引不加密。
  vault 僅供 native caller，目前沒有 renderer 讀取密碼／token 方法，尚未接 OAuth 或自動備份加密。
- IPC 僅接受固定方法及資料，host 固定目前 profile；沒有路徑、任意 HTTP、SQL 或程式碼介面。
  精確主文件驗證、禁止 frame／其他頁面、deny cross-origin mapping，停用 host objects／DevTools。
  外部 HTTP(S)／mailto 只由使用者啟動的導航送系統 handler，不載入有權限的 WebView。
- 256 KiB chunk、完整 SHA／offset，1 MiB 訊息可容納 20,000 UUID 附件清單。
  單份 record 128 MiB、每附件 25 MiB，8 個活動 transfer／總聲明 256 MiB，
  加密 staging 最多 512 MiB／20,008 筆；超限明確拒絕，不截斷資料。
- 成功僅在 SQLite commit 後回報；回應遺失以完整 bytes 讀回核對。
  document 換代令舊回覆失效；新程序清理其獨占鎖所證明已無 owner 的 staging。
  關閉前等 UI 命令及草稿保存；未完成對話框／IME 提示先完成，保存失敗保留視窗。
- `.env.example` 繼續只提供公開建置設定；原生主畫面可在沒有 Google ID 的情況離線工作。
  舊瀏覽器 preview 與 native profile 是分開資料；不做隱含遷移或覆寫。

## Consequences

### Positive

共用語意及完整資料結構可原封接入 native CAS，真 Windows 能測提交／回滾／重啟。
內容不以明文進 SQLite／WAL，privileged bridge 不提供讀取作業系統秘密的通用入口。

### Negative

DPAPI 資料需要原 Windows 使用者金鑰；跨機／換帳號使用可攜備份，不能直接搬 DB 當作還原。
整份 record 寫入、DPAPI 與跨語言複製有記憶體成本；容量限制需在後續最低硬體驗收量測。

### Neutral

不宣稱同帳號惡意程式、RAM、pagefile、crash dump 或硬體斷電都受到這個加密邊界保護。
Windows 桌面層／穿透、全域快捷鍵、monitor mapping、原生檔案 picker／自動檔案、OAuth、
簽章及商店另行實作；其 capability 目前 false。macOS／Linux／iOS／Android 不由本 ADR 選定 SDK。

## Alternatives Considered

### 所有內容留在 WebView IndexedDB

已有 preview 實測，但不足以建立 host 的 OS 安全儲存／跨表面權威邊界，保留為 browser adapter。

### 把 Python prototype API 包成 local server

不符合 1.0 無自家便箋 server 的方向，因此 native 直接處理交易與訊息。

### 以通用 filesystem／eval proxy 快速連接 renderer

會把資料輸入轉為 OS 權限；採明確、限制容量與分區的 method contract。

## References

- [Windows 主機研究](../resreach/2026-10-04-windows-native-storage-and-webview.md)
- [原生契約](../../contracts/native.d.ts)、[ADR-009](009-local-renderer-and-persistence.md)、[ADR-014](014-durable-automatic-backups.md)
- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)、[PROGRESS](../../PROGRESS.md)
