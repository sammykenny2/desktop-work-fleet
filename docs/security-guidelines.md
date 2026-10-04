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

## Windows 原生主畫面

[ADR-015](decisions/015-windows-native-storage-and-editor-host.md) 以固定 packaged origin 與主文件識別 bridge caller；
阻擋 frame／其他頁面、遠端資產、任意 host objects／路徑／SQL／HTTP 方法。正式 App 不開 DevTools 或 debug port。
Windows profile 在 host 決定；renderer 只能取得此分區的內容，不能呼叫 vault.read。
record／附件／staging／vault payload 使用 DPAPI CurrentUser，scope entropy 綁 profile、用途和身分。
SQLite 索引 metadata 不加密；同 Windows 帳號程序、RAM／crash dump 不在此保護邊界。
安全儲存故障不退回明文；不要以複製 native DB 代替跨機 ZIP 備份。

IPC 有 1 MiB envelope／256 KiB chunk 上限及完整 SHA，20,000 token manifest 可一次提交。
上傳暫存與正式資料隔離，SQLite CAS transaction 一起保存 Workspace／receipt／附件；
同目錄唯一原生 owner，重啟回收失去 owner 的暫存。已提交回覆遺失只能以完整 bytes 確認，不能宣稱回滾。
正式畫面可互動前先準備關閉協定，保存失敗／未完成對話框保留視窗。
Windows 自動檔案與安全備份密碼整合見 ADR-016；OAuth 與其他平台仍需實作／驗收。
Native grants／file identity 以 DPAPI 保護並綁 profile，renderer 無路徑／metadata 讀取方法。
NTFS 子檔相對 held directory handle 建立；清理核對同 handle 的實體／size／SHA 後 disposition，
並持有最新有效備份的鎖到清理完成。不先驗 hash 再按 pathname 刪檔。
遇到換檔、reparse、改內容或存取競爭會保留並回報；native reservation 遺失的同名檔不讀取／認領。

## 1.0 可攜備份

- `src/backup` 只從捕獲的 profile 讀取完整快照及 SHA-256 附件；不攜帶 token／provider／舊 outbox。
  reader 驗證整份檔案前沒有目標寫入。CRC／SHA 不是作者信任證明，內容仍視為外部輸入。
- ZIP 固定路徑白名單、local/central／CRC／實際輸出核對；拒絕 traversal／link／ZIP64／重複或未知路徑。
  大型 entry 及 graph 分批提供取消；20,000 entries、128 MiB expanded、25 MiB attachment 上限不作靜默截斷。
- 加密是整個內層 ZIP 的 AES-256-GCM + PBKDF2-HMAC-SHA256 600,000，隨機 salt/nonce、header AAD。
  tag 成功才解析；KDF 固定白名單，密碼不進設定／log／`.env`；GC 字串沒有保證清除。
  Windows 自動備份用 DPAPI vault，原生 PBKDF2／AES-GCM 產物與共用 reader 互通；其他平台仍需驗收。
  排程只取得加密結果，沒有取回已保存密碼的 bridge；不能把容器加密宣稱為 Drive 加密。
- 還原使用經驗證的 BackupDocument／不可偽造建構的 RestorePlan，綁 profile 及 workspace revision；
  預覽零寫入，提交以 CAS 在同一 IDB transaction 寫狀態／receipt／附件，重啟依 receipt 去重。
  取代安全備份以可信檔案 adapter 的 write／close／讀回校驗證明保存；純下載或普通 JSON 不足以解鎖。
- 自動備份／原生保存需遵循 [SPEC-002](specs/002-portable-backup-and-restore.md) 的自有 inventory
  與授權範圍；已實作狀態只看 PROGRESS。瀏覽器保存 probe 不代表外部磁碟斷電耐久。
- 自動備份先保存 profile／policy／期望 hash 的 pending，驗證完成後才記成功及清理 verified inventory。
  host 必須原子避免覆寫同名替換檔、避免刪除非原本實體；瀏覽器自動檔案能力 unavailable，
  不以兩次 pathname 查驗掩蓋競爭。加密 key 參照隔離 profile，不進 ZIP／`.env`。
  journal 失效須發佈 transient 暫停訊息，不能因失敗紀錄也無法寫入而顯示正常。

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
