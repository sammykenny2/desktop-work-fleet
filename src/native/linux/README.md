# Linux 原生 host

Python 3.10+、GTK 3、WebKitGTK 4.1（WebKit 2.40+）、PyGObject／cairo、libsecret／
Secret Service 與 cryptography，由 Linux distribution 提供。不是 Python 便箋 server；
原生 GTK 主畫面載入封裝的 `workfleet://app/app/index.html`，没有常駐 HTTP listener。
Python 3.10 是為了 Ubuntu 22.04；22.04 發行時的 WebKitGTK 2.36 不夠，需安裝 jammy-security 的更新版
（2026-10 amd64 為 2.50.4）。程式碼不可使用 3.11 以後的語法，由 `tests/test_linux_python_floor.py` 檢查。

```bash
npm ci --ignore-scripts
bash scripts/linux/build-native-app.sh
bash "build/linux/work-fleet-$(cat src/native/linux/VERSION)/run-work-fleet.sh"
# 在提供 Debian 工具的環境建立安裝包：
bash scripts/linux/build-native-app.sh --deb
bash scripts/linux/build-native-app.sh --release --deb
```

啟動腳本優先使用 `/usr/bin/python3`，避免 PATH 上的 pyenv／virtualenv `python3` 缺少發行版的 GI 繫結；
需要其他直譯器時以 `WORK_FLEET_PYTHON` 指定，沒有 `/usr/bin/python3` 的環境才使用 PATH 上的 `python3`。

`.env.example` 的 Linux client ID 使用 Google Desktop app 類型。Google 尚未設定時可離線
記錄；登入以系統瀏覽器 PKCE／state 及臨時 loopback callback，完成或 110 秒逾時即關閉。
登入後以 HTTPS userinfo sub 建立帳號分區；原生金鑰圈保存 refresh credential，renderer 不讀憑證。
Drive 僅固定 appDataFolder FileStore 操作，SHA-256／metadata 校驗與 1 MiB resumable chunks。

資料預設在 `$XDG_DATA_HOME/WorkFleet`（通常 `~/.local/share/WorkFleet`）；可用 `--data PATH`
指定同樣受保護的新目錄。AES-GCM 加密 SQLite payload 與原生 backup metadata；32-byte 主金鑰
由 libsecret 保存於使用者系統金鑰圈。金鑰圈缺失／鎖定／不可用時明確停止，不改存明文。
查詢以 application／kind／id 比對、不比對 schema 名稱（鎖住的 gnome-keyring 項目不公開它），
所以鎖住的金鑰會由 libsecret 要求解鎖；解鎖取消時回報「已鎖定」而非「缺少原金鑰」，也不另建第二把金鑰。
SQLite revision 與新附件同交易，flock 保持唯一 owner。清除金鑰圈會失去 DB 解密能力，
跨機備份使用 App 可攜 ZIP，不直接搬 SQLite 代替備份。

原生資料夾 chooser 保存授權位置與 device/inode 身分；新備份使用 O_EXCL／NOFOLLOW、
fsync／讀回確認。自動工作核對 journal、原生建立紀錄、最新已確認備份及保留份數，
只清理自己建立且仍符合原身分的檔案。檔案系統不支援確認操作時保留檔案並回報失敗。
可攜密碼備份與 Windows／Apple／Android 共用 PBKDF2-600000／AES-GCM ZIP 格式。

建置入口產生 source/runtime tar.gz，Debian variant 宣告 system runtime dependencies；
不攜帶私鑰、token、使用者資料或 Python／GTK 的複製二進位。簽章／repository 發布仍待實際環境。
Linux 版號記在同目錄的 `VERSION`，DEB、tar.gz 與 bundle 名稱都由它產生；早期版號不另加 `~preview`；
release 仍需正式公開 app 設定與支援 email 作 maintainer contact。
共同 `scripts/linux/package-deb.sh` 每次使用新的 staging，安裝 launcher／desktop entry／圖示與 notices。
Linux 與 Windows 建置入口直接產生 `build/work-fleet_<版號>_all.deb` 與同名 `.sha256`，不需手動搬檔；
staging 在封裝腳本結束時自動移除；tar.gz 與 DEB 同在 `build/`，source/runtime 副本在 `build/linux/`，每次建置重新產生。
Windows 可執行 `scripts/windows/Build-LinuxPackage.ps1`，以既有 Docker Linux engine 的固定 Ubuntu
image 使用 dpkg-deb 封裝；容器只掛載生成的 bundle／output 與 script，不執行 GTK 或安装 App。
layer-shell 每螢幕共用桌面 BOTTOM、浮層 TOP、桌布 BACKGROUND 三個 WebKit 場景；
主畫面保有唯一 Workspace，場景只送命令、草稿與 frame。
操作此組暫時轉浮層，結束按目前常駐偏好還原，不改位置。桌布層始終滑鼠穿透、沒有鍵盤焦點。
pcmanfm 把桌布與圖示畫在同一 surface，背景便箋不能插入圖示下方，可能仍顯示在圖示上方；
設定會說明這項限制。X11 保留兩層，要求桌布時明示回退 desktop，原偏好仍保存。
GNOME 的桌面圖示（DING）以透明視窗蓋住 X11 desktop-type 視窗並接收點擊，所以 `XDG_CURRENT_DESKTOP`
含 GNOME 時 X11 只讓群組常駐桌布層，桌面／最上層偏好明示回退桌布層。最上層在 GNOME 會鎖住其他視窗，
所以只在調整模式出現：遮罩覆蓋工作區、主視窗隱藏並在結束後回到原位，遮罩上提供堆疊、攤開、復原與完成；
見 [ADR-039](../../../docs/decisions/039-gnome-desktop-icons-and-x11-scene-size.md)。
GNOME Wayland 沒有 layer-shell，桌面便箋要經 XWayland：首次啟動會詢問，之後可在設定的「桌面」頁切換並重新啟動；
偏好存在資料目錄的 `display-backend.txt`，使用者自己設定的 `GDK_BACKEND` 優先並讓設定停用（[ADR-040](../../../docs/decisions/040-gnome-wayland-xwayland-choice.md)）。
正規 Xorg 工作階段未實測。
X11 使用原生窗口層級與輸入區域，場景涵蓋螢幕工作區（視窗管理員會把一般視窗推離工作列），
視窗不可調整大小，以 viewport size request 決定尺寸；
Wayland 使用 GtkLayerShell 支援的 compositor。
不支援 layer-shell 時回報原因，仍可在主畫面記錄。卡片外與不可互動的紙面不攔截桌面輸入。
輸入區域設於 GTK widget 並 queue draw，避免重新配置後失去穿透；明確設 viewport size request。
map／configure／frame 後合併完整重畫，避免透明 WebKit 的局部殘留。只有 Raspberry Pi（device-tree model）或
載入 V3D 驅動時，使用者未指定才預設 `WEBKIT_DISABLE_DMABUF_RENDERER=1`，接續 Pi／V3D 已知修正；
其他機器沿用 WebKit 預設，因為共享記憶體 renderer 會在移走的便箋原處留下殘影。
顯示器／工作區／休眠變更先停止場景輸入，保存草稿後由主畫面套用新版面，保留原 WebView。
X11 快捷鍵使用 Keybinder 3；否則使用 XDG GlobalShortcuts portal，需桌面提供相應 backend。
系統可改配按鍵，設定顯示實際 trigger description。App 焦點／對話框期間釋放全域註冊；
portal session 重建可能再次出現系統授權介面，實際流程仍待原生環境確認。
Ayatana／AppIndicator 或 Gtk.StatusIcon 提供系統匣；只在確認系統匣可用後隱藏主畫面。
系統匣退出沿用草稿保存流程；系統匣斷線時恢復主畫面，帳號切換則關閉舊桌面工作階段。
可用隔離 headless labwc 執行本產品原生場景回歸，命令見 [testing](../../../docs/testing.md)。
實際結果見 [PROGRESS](../../../PROGRESS.md)；沒有把 headless x64 測試當成 Pi／V3D、
pcmanfm-pi、libsecret、真 Google 或 Debian 安裝驗收。
