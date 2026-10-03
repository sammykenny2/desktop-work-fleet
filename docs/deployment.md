# 平台與散布狀態

更新：2026-10-03；驗證版 0.1.0。

| 平台 | 可用產物／驗證入口 | 狀態 |
|---|---|---|
| macOS | `bash scripts/macos/build-app.sh` → Sandbox `.app` | x86_64 本機建置／啟動已測；ad-hoc 簽章 |
| Web | Python 服務提供靜態 editor | 真實 WebKit 與 HTTP 契約測試 |
| Windows | `py -3 src/server/work_fleet.py serve`；瀏覽器 | 原始碼可攜路徑；未在 Windows 執行，未製作 MSIX |
| Linux | `python3 src/server/work_fleet.py serve`；瀏覽器 | 未在 Linux 執行，未實作桌面 layer |
| iOS／Android | HTTPS 服務 + 瀏覽器配對頁 | 手機／QR 掃描未測，尚無原生 package |

Mac Apple Silicon 可在該機以相同腳本重建；本次僅測 x86_64，未建立 universal binary。
Framework 來自系統 SDK，沒有嵌入第三方 framework 或 Python runtime。
正式上架前需在 Xcode 配置 team／穩定 bundle ID、正式簽章、權限說明、封裝與 App Store 驗證。
本機 App Sandbox 成功不等於 Mac App Store 審查通過。

Windows 仍以 Store MSIX 為優先候選；未購買商業簽章憑證。後續在 Windows SDK 產生並驗證 MSIX，
逐項測 startup／桌面輸入穿透／打包權限，不能以瀏覽器結果取代。

Linux 的待測組合須逐一記錄 distro、CPU、X11/Wayland、桌面／compositor、runtime 與封裝。
例如 Ubuntu x86_64 GNOME Wayland、KDE Wayland、X11 是不同測試列，不能互推結果。
iOS／Android 需獨立 bundle/application ID、簽章、權限與商店審查。未建立帳號、付費或送審。

授權與外部 runtime 清單見 [第三方聲明](../THIRD-PARTY-NOTICES.md) 與 [依賴清單](validation/runtime-inventory.json)。
