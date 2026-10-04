# Linux 原生 host

Python 3.12+、GTK 3、WebKitGTK 4.1（WebKit 2.40+）、PyGObject／cairo、libsecret／
Secret Service 與 cryptography，由 Linux distribution 提供。不是 Python 便箋 server；
原生 GTK 主畫面載入封裝的 `workfleet://app/app/index.html`，没有常駐 HTTP listener。

```bash
npm ci --ignore-scripts
bash scripts/linux/build-native-app.sh
bash build/linux/work-fleet-1.0.0/run-work-fleet.sh
# 在提供 Debian 工具的環境建立安裝包：
bash scripts/linux/build-native-app.sh --release --deb
```

`.env.example` 的 Linux client ID 使用 Google Desktop app 類型。Google 尚未設定時可離線
記錄；登入以系統瀏覽器 PKCE／state 及臨時 loopback callback，完成或 110 秒逾時即關閉。
登入後以 HTTPS userinfo sub 建立帳號分區；原生金鑰圈保存 refresh credential，renderer 不讀憑證。
Drive 僅固定 appDataFolder FileStore 操作，SHA-256／metadata 校驗與 1 MiB resumable chunks。

資料預設在 `$XDG_DATA_HOME/WorkFleet`（通常 `~/.local/share/WorkFleet`）；可用 `--data PATH`
指定同樣受保護的新目錄。AES-GCM 加密 SQLite payload 與原生 backup metadata；32-byte 主金鑰
由 libsecret 保存於使用者系統金鑰圈。金鑰圈缺失／鎖定／不可用時明確停止，不改存明文。
SQLite revision 與新附件同交易，flock 保持唯一 owner。清除金鑰圈會失去 DB 解密能力，
跨機備份使用 App 可攜 ZIP，不直接搬 SQLite 代替備份。

原生資料夾 chooser 保存授權位置與 device/inode 身分；新備份使用 O_EXCL／NOFOLLOW、
fsync／讀回確認。自動工作核對 journal、原生建立紀錄、最新已確認備份及保留份數，
只清理自己建立且仍符合原身分的檔案。檔案系統不支援確認操作時保留檔案並回報失敗。
可攜密碼備份與 Windows／Apple／Android 共用 PBKDF2-600000／AES-GCM ZIP 格式。

建置入口產生 source/runtime tar.gz，Debian variant 宣告 system runtime dependencies；
不攜帶私鑰、token、使用者資料或 Python／GTK 的複製二進位。簽章／repository 發布仍待實際環境。
主畫面與原生保存／Google／備份已加入程式；Linux desktop surfaces／global shortcuts／tray
持續接線，這個切片不宣稱 OS 桌面呈現已完成。
目前工作環境是 Windows，未執行 GTK／libsecret／Wayland／X11、真 Google 或 Debian 安裝。
