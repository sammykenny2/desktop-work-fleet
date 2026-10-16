# 安全邊界

更新：2026-10-17。

## 1.0 本機 renderer

- [ADR-051](decisions/051-schema-evolution-and-atomic-migrations.md)：測試階段 JSON schema 維持 V1，保留基本格式檢查。
  不增加 schema 升級交易、原始副本或額外 bridge 權限；既有原子保存、加密、帳號隔離及可攜備份維持。

- 便箋、草稿、outbox 與版面在同一 IndexedDB 交易提交，成功前不發布新 Workspace。
  profile key 與附件 composite key 隔離資料；Web Locks 加 revision CAS 防止獨立 writer 覆寫。
- Markdown 原始 HTML 顯示為文字，生成 DOM 再經 DOMPurify 允許清單；不載入遠端圖片，
  HTTP／HTTPS／mailto 之外的連結移除，另開連結使用 noopener／noreferrer。
- [ADR-052](decisions/052-rich-papers-and-native-attachments.md)：程式碼上色只用封裝的 Highlight.js 與明確語言，
  生成標記仍清理；未指定／不支援與超出上色預算的內容保持純文字。原始 HTML／SVG 不在 App origin 執行。
  桌面附件只投影 id／name，主工作區核對目前版本、可見性／互動與附件歸屬後呼叫原生主文件。
  原生依目前 profile 讀取附件，產生私有、受管理的唯讀副本，縮圖只回傳 bounded PNG／blob URL；
  不接受來源路徑、程式或任意命令。系統縮圖與外部開啟需要明文暫存副本，正常切帳號／重設／結束時盡力清理，
  異常結束或 OS 檔案鎖可能留下暫存；外部修改不回存。可執行檔／捷徑／部分腳本不直接開啟。
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

## Linux 本機金鑰與憑證

[ADR-047](decisions/047-linux-local-key-without-keyring-prompts.md) 與 [ADR-048](decisions/048-linux-offline-workspace-and-system-secrets.md)
將離線便箋與需要系統秘密的功能分開。
AES-GCM payload 與 AAD 維持原格式；主金鑰在 App 資料目錄的 `storage-key`，目錄 0700／金鑰 0600、同使用者，
拒絕符號連結及過寬權限。金鑰完整寫入及 fsync 後 create-only 發布，沿用唯一 owner 鎖。
Google access／refresh token 與保存的自動備份密碼由已解鎖的持久 Secret Service default collection 保存，
不寫本機 credential／secret payload，也不在故障時 fallback。SQLite 只保存 reference、撤銷與清理狀態；
Google 憑證不進 workspace reset／ZIP／renderer，備份密碼 ID 綁定 profile。session collection 不可作持久保存。
先即時讀取 Locked 屬性，再搜尋已解鎖 collection 並重新 GetSecret，不使用舊 secret／Locked 快取。
避免 provider 的全域 SearchItems 自行觸發解鎖 UI；背景讀取與寫入／刪除不執行回傳的 Prompt。
vault 鎖住或不可用時只暫停 Google 同步／需要保存密碼的加密備份，便箋仍可使用。
使用者手動按「立即同步」才可開啟持久 default collection 的系統解鎖視窗；App 不接收金鑰圈密碼，
成功後使用原憑證接續同步，不必重新 OAuth。取消／逾時保留暫停與重試，關閉工作階段可取消 Prompt。
每次用 token 前重新讀 vault，不能繼續用先前快取的 token。慢 vault 不占用筆記儲存 worker 或 DB／bridge lock。
舊版只讀取已解鎖 keyring 項目、不要求解鎖，所有既有帳號的 payload 通過驗證才保存本機金鑰；
失敗不更換金鑰、不刪資料或原 keyring 項目。ADR-047 的舊本機憑證／備份密碼先移入 vault 並確認讀回後才刪除；
清理目前 SQLite／WAL 的 ciphertext，不聲稱實體抹除磁碟或舊備份。鎖住時保留待遷移副本但不使用，
因此完成遷移前仍有較弱的保護。登出先保存持久撤銷標記，阻止 vault 解鎖或重啟後重新匯入舊 token。
本機金鑰和 DB 在同目錄，保護邊界是 OS 帳號／檔案權限，不提供整個資料目錄被複製後的機密性；
root、同帳號惡意程序與未加密磁碟被讀取不在此保護邊界。完成秘密遷移後，複製此目錄不能取得 vault 中的權杖或備份密碼。
其他平台的儲存政策維持，Linux 本機內容的保護仍較弱；敏感跨機備份可明確選用密碼加密。

## Windows 原生主畫面

[ADR-015](decisions/015-windows-native-storage-and-editor-host.md) 以固定 packaged origin 與主文件識別 bridge caller；
阻擋 frame／其他頁面、遠端資產、任意 host objects／路徑／SQL／HTTP 方法。正式 App 不開 DevTools 或 debug port。
只有 Debug 組態可開 DevTools，且需程序環境明確指定才開 loopback CDP（[ADR-032](decisions/032-windows-debug-webview-inspection.md)）。
Windows profile 在 host 決定；renderer 只能取得此分區的內容，不能呼叫 vault.read。
record／附件／staging／vault payload 使用 DPAPI CurrentUser，scope entropy 綁 profile、用途和身分。
SQLite 索引 metadata 不加密；同 Windows 帳號程序、RAM／crash dump 不在此保護邊界。
安全儲存故障不退回明文；不要以複製 native DB 代替跨機 ZIP 備份。

IPC 有 1 MiB envelope／256 KiB chunk 上限及完整 SHA，20,000 token manifest 可一次提交。
上傳暫存與正式資料隔離，SQLite CAS transaction 一起保存 Workspace／receipt／附件；
同目錄唯一原生 owner，重啟回收失去 owner 的暫存。已提交回覆遺失只能以完整 bytes 確認，不能宣稱回滾。
正式畫面可互動前先準備關閉協定，保存失敗／未完成對話框保留視窗。
第二次啟動的 named pipe 名稱由使用者 SID 與資料目錄雜湊而成，ACL 只允許目前使用者，只接受固定的 `show` 請求、不傳資料或路徑；
`owner.lock` 仍是最後保護（ADR-043）。主視窗位置與啟動偏好存在資料目錄，不含便箋內容，也不進入備份或 Google。
App 內更新（ADR-044）只在使用者動作時由原生 host 連線：不帶任何憑證或 cookie，只用 HTTPS，查詢只讀設定 repo 的
`github.com/<repository>/releases.atom` 並拒絕轉址，不呼叫 REST API。XML 限 2 MiB、拒絕 DTD／外部實體，
只接受同 repo 的 Atom entry／alternate link 與合法平台 tag。manifest／appcast 與安裝檔 URL 固定由 repo／tag／單層檔名建立；
下載只允許 `github.com` 與 GitHub release 資產主機且最多三次轉址；回應與安裝檔有容量上限，安裝檔大小與 SHA-256 必須符合
release 的 `work-fleet-update.json`，MSIX 身分（Name／Publisher／架構）必須與已安裝套件相同且版本較高，簽章由 Windows 安裝時檢查。
這份 manifest 與安裝檔來自同一個 release，只防損毀與單一檔案被換，不防 GitHub 帳號被盜。renderer 不能指定任何 URL。
本機測試來源只由 `app.workfleet.updateprobe.*` 套件身分讀取，其他身分忽略。Linux 以 `dpkg-deb` 核對套件名稱 `work-fleet`、
架構與更高版本後才以 pkexec 安裝；DEB 沒有作業系統簽章檢查，只靠同一 release 的 manifest 與 SHA-256。
macOS 只自己查詢上述 Atom feed（拒絕轉址），之後由 Sparkle 依同 repo／tag 的 appcast 下載並自行跟隨 GitHub 轉址，上述主機白名單不適用；
Sparkle 以 appcast 的 EdDSA 簽章（App 內建公鑰）與 Apple 程式碼簽章（同 Team ID）驗證後才安裝。私鑰只在維護者的 Mac 鑰匙圈或 CI secret。
Windows 自動檔案與安全備份密碼整合見 ADR-016；OAuth 與其他平台仍需實作／驗收。
Native grants／file identity 以 DPAPI 保護並綁 profile，renderer 無路徑／metadata 讀取方法。
NTFS 子檔相對 held directory handle 建立；清理核對同 handle 的實體／size／SHA 後 disposition，
並持有最新有效備份的鎖到清理完成。不先驗 hash 再按 pathname 刪檔。
遇到換檔、reparse、改內容或存取競爭會保留並回報；native reservation 遺失的同名檔不讀取／認領。

Windows 場景使用獨立 `/desktop/index.html` 與固定命令白名單，不能呼叫主 bridge 的 storage／backup／vault。
frame 只含目前可呈現卡片及必要編輯文字，不含歷史、outbox、同步游標或附件 bytes。
每份分片 lease 綁定 native 指定的 owner/view；完整 SHA 驗證後才發布。不同主畫面工作階段不能重用 view。
場景只送固定互動命令，單一 Workspace 執行 durable 交易；關閉保留凍結直到 host.closeReady。
容量與失聯處理見 [ADR-018](decisions/018-single-owner-desktop-views.md)。

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
