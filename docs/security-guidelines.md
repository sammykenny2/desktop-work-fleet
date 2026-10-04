# 安全邊界

更新：2026-10-04。

## 1.0 本機 renderer

- 便箋、草稿、outbox 與版面在同一 IndexedDB 交易提交，成功前不發布新 Workspace。
  profile key 與附件 composite key 隔離資料；Web Locks 加 revision CAS 防止獨立 writer 覆寫。
- Markdown 原始 HTML 顯示為文字，生成 DOM 再經 DOMPurify 允許清單；不載入遠端圖片，
  HTTP／HTTPS／mailto 之外的連結移除，另開連結使用 noopener／noreferrer。
- 附件依 SHA-256 定址，單檔至多 25 MiB；下載包裝為 application/octet-stream，
  不以 App origin 執行使用者 HTML／SVG。儲存的 bytes 及原始 MIME metadata 不改寫。
- script 全部本機封裝，importmap 以 build 時 CSP hash 授權；不用遠端 script 或 CDN。
- pending／failed 草稿保留記憶體內容並提示離頁；正常成功以 transaction complete 為準。
  不能保證瀏覽器程序被強制結束前尚未落盤的輸入存活，也不把本機 cache 當備份。
- 同步版本採嚴格 JSON 與不可變 ID；重複欄位、collision、cycle 或跨 entity parent 整批拒絕。
  來源 session 必須符合 profile／source／runtime，資料與 cursor 同交易；晚到回應不能跨帳號寫入。
  多 head 與歷史均保留；普通命令不能靜默消耗衝突，明確決議還需核對完整 head 集合。
  來源無關交易及 scripted Drive REST 已測，Google OAuth／原生 transport 仍需另外驗收。
- FileSync 在上傳前保存固定 file ID／digest／size；409 必須讀回核對，ack 才能消耗 outbox。
  已確認檔案 ID 不可更改內容；遠端刪檔／格式未知／不完整列舉停止推進，不刪本機版本。
  Google adapter 限制 Location 為同一 HTTPS API host／上傳路徑，錯誤不回顯私密 response body。
  受保護原生 HTTP 尚須實作拒絕 redirect、串流大小限制及帳號撤銷；不得把此介面公開為 renderer 任意請求。
  Upload URL 目前僅在 adapter 記憶體，程序重啟用持久 file ID 安全重送；不進 JSON／backup／log。
- 開發 listener 僅 loopback 靜態資產，沒有便箋或 token API。原生 host 的 OAuth、OS 安全儲存、
  加密備份與正式封裝尚需各自驗收，不能由此介面測試代替。

## 既有 0.1.0 驗證版

- 鎖定是防誤觸；server 另外強制 viewer/editor/admin 權限。
- token 使用 256-bit 隨機值；DB 只保存 SHA-256。一次性配對碼 192-bit，效期 300 秒。
- 本機 owner token、server DB 權限 0600，資料目录 0700；App config 在 Sandbox container 以 0600 保存。
- Web token／草稿／快取保存在本 origin 的 localStorage；沒有端到端加密或 Keychain 整合。
  共用 OS 帳號、瀏覽器清理、磁碟損壞可能造成洩漏或遺失；提供草稿匯出。
- QR 只含 origin 與一次性 code，使用 URL fragment；配對頁讀取後移除 fragment。
  不放永久管理員密鑰，不透過第三方 QR 服務。
- 非 loopback 服務必須 TLS；App 禁止遠端 HTTP，不停用憑證驗證。
- server 限制 Host/Origin/body/content type，使用 CSP、textContent 和參數化 SQL。
- diagnostics 不記錄 token／code／筆記文字。測試只用臨時合成資料。
- 備份含私人資料與 credential hashes；restore 撤銷舊装置並換 epoch，原 DB 不被覆寫。
- App 只有 App Sandbox、network.client entitlement；未申請網路 server、檔案全面存取或 Apple Events。
- 公開網路負載、防濫用節流、加密 at rest、Keychain、正式簽章及商店審查尚未完成。
  Python 標準庫 HTTP 服務定位為個人驗證，未宣稱已完成 production security hardening。

另見 [API](api.md)、[驗證報告](validation/2026-10-03-validation-report.md)。
