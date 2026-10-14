# ADR-047: Linux 啟動不依賴 keyring 密碼

## Status

Accepted，2026-10-15。取代 ADR-024 的本機金鑰與 Google 憑證保存政策；其餘 Linux 契約維持。

## Context

使用者回報 Raspberry Pi 加入登入自動啟動後，每次重開機都要求 keyring 密碼，輸入仍不能開啟 App，
並明確指出這個 UX 不能接受。原實作將整個工作空間的 AES-GCM 主金鑰放在 Secret Service，
所以只用本機便箋也會先執行可能要求解鎖的 password lookup；Google 憑證同樣依賴 keyring。
Pi 唯讀檢查找到兩把已解鎖同名儲存金鑰，只有一把通過所有既有 payload 的驗證；
這是解鎖後仍可能解密失敗的具體風險，尚未重現本次開機取到錯誤金鑰的完整路徑。

## Decision

- Linux 主金鑰保存於 App 資料目錄的 `storage-key`，32-byte 隨機 bytes、檔案 0600、目錄 0700，
  都必須屬於目前使用者；拒絕 symlink／非一般檔案／過寬權限。維持 AES-GCM payload／AAD 與 SQLite 交易格式。
- 沿用資料目錄的唯一 owner 鎖；完整寫入臨時檔、fsync 後 create-only 發布金鑰並 fsync 目錄。
  不覆寫既有金鑰。新目錄與已遷移資料啟動不查詢 storage keyring，不需要 Secret Service typelib。
- 舊版缺少本機金鑰但已有 DB 時，才讀原 Secret Service 的 `storage-key/v1`。
  `ALL | LOAD_SECRETS` 只讀已解鎖項目，絕不使用 `UNLOCK`、password lookup、store 或 clear。
  多把已解鎖同名金鑰逐把驗證，不依查詢排序選第一把。先唯讀驗證所有 profile 的 record／附件／staging／secret
  及已存在的 credential，通過後才保存相符的原金鑰。
  鎖定／缺失／錯誤金鑰／損毀時保留原資料與原 keyring，不另建金鑰、不繞過舊加密。
- 鎖定的舊資料顯示一次性遷移說明：在系統金鑰圈管理員解鎖後重新開啟，或由可攜備份還原。
  不自動觸發密碼視窗。完成遷移後 keyring 不能再阻擋本機便箋。
- Google 憑證保存於 SQLite 的獨立 `credentials` 表，使用主金鑰與帳號／用途 AAD 加密。
  首次使用帳號時讀取已解鎖的舊憑證並保存；鎖定或 Secret Service 不存在時以未登入狀態繼續開啟便箋，
  讓使用者重新登入 Google。新登入／refresh／登出均不寫 keyring。
  憑證跨 profile 切換與 workspace reset 保留；登出保存空值撤銷標記，阻止重新遷移舊 token。
- libsecret 移至可選 runtime／DEB Recommends，供舊資料遷移；不自動刪除或修改其他 App 的 keyring 設定。

## Consequences

### Positive

- 本機便箋、桌面呈現與登入啟動可直接使用，不因金鑰圈另行鎖定而出現密碼對話框。
- 舊資料維持原加密 bytes，驗證後保存相同金鑰，不需要重新加密整份 DB。
- Google 憑證不提供給 renderer、可攜 ZIP 或 workspace reset，且登出後不重用舊 token。

### Negative

- 主金鑰與 DB 在同目錄，這是 OS 帳號／檔案權限保護，無法阻止能讀取整個資料目錄的人解密。
  root、同帳號惡意程序、未加密磁碟的離線讀取仍可取得內容；不能宣稱 keyring 等級的磁碟保護。
- 舊資料仍須取得原金鑰，無法透過移除密碼視窗恢復遺失的金鑰；遺失本機金鑰同樣會失去解密能力。

### Neutral

- Windows／Apple／Android 的原生安全儲存政策與明確選擇的可攜密碼備份保持原有契約。
- 保留原 keyring 項目供恢復／舊版相容，降版的程式仍會依賴 keyring；不自動做全系統金鑰圈清理。

## Alternatives Considered

### 自動解鎖或修改系統 keyring 密碼

- 需要額外密碼或修改其他 App 的共同安全設定，無法提供可靠的直接啟動；不採用。

### 只延遲自動啟動

- 自動登入的金鑰圈可能持續鎖定，延遲沒有移除必要條件；不採用。

### 丟棄金鑰或重建 DB

- 舊便箋無法解密且可能失去資料，違反保留使用者資料要求；不採用。

## References

- [ADR-024](024-linux-native-owner-and-storage.md)、[ADR-043](043-desktop-window-placement-and-startup-behavior.md)。
- [Linux README](../../src/native/linux/README.md)、[安全邊界](../security-guidelines.md)、[測試](../testing.md)。
- [libsecret search_sync](https://gnome.pages.gitlab.gnome.org/libsecret/method.Service.search_sync.html)：
  `LOAD_SECRETS` 只載入已解鎖項目，`UNLOCK` 才要求解鎖（2026-10-15 查閱）。

---

*Decision made: 2026-10-15*
