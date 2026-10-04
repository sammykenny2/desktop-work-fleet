# ADR-013: 完整可攜備份與加密容器

## Status

Accepted，2026-10-04。依已批准 SPEC-003 Q01–Q07 定案，取代 ADR-005 的範圍及格式候選。
接受設計不等於還原、自動備份、原生檔案流程已交付；實際證據只記 PROGRESS。

## Context

共享資料已採 immutable graph。只備份當前本文會丟失衝突、草稿基線、附件及群組引用。
備份須能跨帳號讀取，ZIP 宣告值、路徑與密碼檔案不能變成無界分配或任意目標寫入的途徑。
使用者已核准完整備份、三種還原及五平台，並授權技術與容量決策。

## Decision

- 公開 v1 ZIP 保存全部已知 revisions、drafts、local preferences、device layout 及 SHA-256 附件。
  不含憑證／profile／provider／舊 outbox 封包；pending 原樣保留並標示 known-local-data。
- `src/backup` 不依賴來源；捕獲一次 Workspace 快照，reader 產生防禦性複製的 BackupDocument。
  verify／preview 不寫目標；restore 綁定 profile、revision、receipt 並原子提交。
- 使用 fflate 0.8.3（MIT）輸出 ZIP，reader 校驗 local／central 範圍、路徑、容量及 CRC；
  解壓採標準 DecompressionStream deflate-raw，拒絕不完整／尾隨 compressed stream。
- outer ZIP 僅 header + ciphertext；PBKDF2-HMAC-SHA256 600,000 iterations、隨機 salt 16 bytes、
  AES-256-GCM、隨機 nonce 12 bytes、128-bit tag、canonical header AAD。
  WebCrypto keys 不可匯出；不用自寫 cipher、ZipCrypto 或明文設定保存密碼。
- 20,000 entries／128 MiB expanded／136 MiB plain ZIP／25 MiB attachment，JSON 沿用 SPEC-004。
  按實際 bytes 校驗，超限／缺附件直接失敗，不能省略後宣稱完整。
- 新匯入映射 ID；合併核對 immutable identity；取代追加觀測全部 heads 的版本，保留歷史及草稿，
  額外卡片進刪除區。取代前保存安全備份，不直接刪 Drive 版本檔。
- RestorePlan 綁定預覽 revision；workspace／附件／草稿／版面／outbox／receipt 同一本機 CAS 交易。
  瀏覽器 File System Access 先取 handle，再 write／close／SHA 讀回確認；純下載不能解鎖取代。
  同名異內容草稿另配 ID 並延續 lineage；歧義 membership 邊暫停自動延續，不刪歷史。
- 自動備份預設關閉，24 小時有變化才執行，resume 補跑；預設七份且只修剪自身 inventory。
  加密排程依賴 OS 安全儲存，無法取得授權或 key 時停止，不降級明文。

## Consequences

### Positive

全部已知資料可驗證往返，卡片擴充不縮減；來源與 renderer 不必知道 ZIP 或密碼。
同一嚴格 reader 驗證匯出及還原，checksum 不被當成可信內容授權。

### Negative

完整歷史及附件增加記憶體和檔案量，本版不是無限容量串流資料庫。
WebCrypto AEAD 需完整 payload，原生 KDF 無法中斷；密碼遺失無法恢復。
格式不採一般 ZIP 工具的密碼介面；原生檔案、安全儲存與最低裝置容量另需驗收。

### Neutral

Node >=22 支援 deflate-raw，各 WebView 仍需能力檢查及實測。
備份加密不代表 Drive 或本機資料庫已端到端／at-rest 加密。
未收到的資料無法包含；保留 pending 比杜撰 ancestors 更符合完整性。

## Alternatives Considered

- 原樣複製 DB／Drive：綁 provider，可能帶憑證，不能替代公開可攜格式。
- head-only／plaintext-only：不符合完整範圍，丟失 lineage 及附件，拒絕。
- fflate Inflate reader：故障探針發現其接受部分無效 DEFLATE，改採原生嚴格串流。
- Argon2id：一般密碼雜湊有優點；本版因 WebCrypto 可攜性選 PBKDF2，避免新增 WASM 密碼依賴。
  沒有宣稱 PBKDF2 優於 Argon2id 或產品取得 FIPS 認證。

## References

- [SPEC-002](../specs/002-portable-backup-and-restore.md)
- [研究與官方來源](../resreach/2026-10-04-backup-container-and-encryption.md)
- [ADR-011](011-immutable-revision-graph.md)、[ADR-012](012-durable-file-store-and-drive-adapter.md)

Decision made: 2026-10-04.
