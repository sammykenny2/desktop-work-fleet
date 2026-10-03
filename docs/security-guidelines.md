# 驗證版安全邊界

更新：2026-10-03。

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
