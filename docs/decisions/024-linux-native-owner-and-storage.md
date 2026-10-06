# ADR-024: Linux 原生主畫面、資料與 Google

## Status

Accepted，2026-10-05；加入程式及封裝入口，Linux runtime 未執行。2026-10-06 Python 下限改為 3.10。

## Context

1.0 要求 Linux 原生主畫面、受保護內容／授權、完整備份與檔案來源，不使用歷史便箋 server。
桌面呈現需按 compositor 能力回報；Windows 工作環境沒有 Linux GTK／Secret Service／顯示 session。
使用者要求先實作、不再投入驗證；此切片不把主畫面當作完整 Linux 桌面交付。

## Decision

- Python 3.10+／GTK 3／WebKitGTK 4.1（2.40+）／PyGObject；使用 distribution 提供的框架，
  不複製 OS runtime 二進位。secure custom scheme 只提供封裝資產，無常駐 HTTP listener。
  原定 3.12+；2026-10-06 依維護者指示降為 3.10，讓 Ubuntu 22.04 LTS 可安裝。當時檢查程式碼沒有用到
  3.11 以後的語法或標準庫 API（vermin 判定最低 3.6），所以只改相依宣告；之後由測試擋下 3.11+ 語法。
  22.04 的 WebKitGTK 需由 jammy-security 更新到 2.40+，發行時的 2.36 沒有 `evaluate_javascript`。
- 主 frame 注入封閉 nonce 的 transport；接收端確認 nonce 與固定 document URL。
  其他 navigation／frame、網路 subresources、WebKit permissions 不取得 native bridge 能力。
- 主畫面唯一 Workspace；SQLite WAL／FULL、revision CAS／附件同交易、flock owner。
  AES-GCM payload 綁定 profile／kind／id；32-byte key 由 libsecret Secret Service 保存。
  沒有金鑰圈／原 key 即停止，不使用明文 fallback。
- Google 系統瀏覽器 PKCE／state，110 秒限定 `127.0.0.1:0` callback。userinfo sub 核對帳號，
  refresh credential 留系統金鑰圈；Drive 固定 appDataFolder 操作、串流容量、metadata／SHA-256
  校驗及 1 MiB resumable chunks，renderer 無任意 HTTP／URL／credential 能力。
- 原生 chooser 給備份目錄權限，保存 device／inode 身分；新檔 O_EXCL／NOFOLLOW、fsync／讀回。
  journal／原生建立身分／最新有效備份／保留份數控制清理；可攜加密保持 SPEC-002 格式。
- source/runtime tar.gz 與 Debian package 建置入口；desktop file、自有 icon、依賴與 notices 隨封裝保存。
  不放 `.env`、token、金鑰、帳號資料或主機 SDK 路徑。
- Linux X11／Wayland desktop surfaces、global shortcuts／tray 在接續切片整合，保持完整 1.0 範圍。

## Consequences

Google 狀態與其他平台統一為 configured／connected／profileId／accountId／email。
client ID 或 scope 變更時停用舊授權並提示重新登入，保留該帳號便箋；Drive 401 讓下一次請求先更新 token。

Linux 主畫面沿用完整 editor、版本圖、FileSync、備份還原與 native storage 契約。
GTK／libsecret、Google、檔案系統與 compositor 的實際環境結果仍缺；source archive 不能當成原生操作驗收。
系統 runtime 授權留 distribution；最終 package 的版本／授權盤點仍需實際 Linux 散布產物。
不宣稱已安裝 Debian package、取得商店或完成 Linux 桌面交付。

## Alternatives Considered

原有 HTTP note server 不符合 1.0 來源邊界；金鑰寫回設定或 SQLite 明文違反本機保護需求。
重用 Windows／Apple 平台 API 不能提供 Linux 系統 chooser、金鑰圈及真正的原生窗口。
維持 Python 3.12+：2026-10-06 放棄，因為程式碼沒有用到 3.12 功能，卻會排除 Ubuntu 22.04 LTS；
在 22.04 另裝 deadsnakes Python 也不可行，系統的 python3-gi／cryptography 只支援內建的 3.10。

## References

- [Linux 原生入口](../../src/native/linux/README.md)、[ADR-012](012-durable-file-store-and-drive-adapter.md)。
- [WebKitGTK 4.1](https://webkitgtk.org/reference/webkit2gtk/stable/index.html)。
- [libsecret](https://gnome.pages.gitlab.gnome.org/libsecret/)。
- [Google native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)。
- [GTK layer shell](https://wmww.github.io/gtk-layer-shell/)。

*Decision made: 2026-10-05*
