# Apple 原生 App

macOS 13+／iOS 16+，需要完整 Xcode（Swift 5.10+）、Node 22+。此目錄為 1.0 原生 host，
不使用歷史 Python server。主畫面與手機 editor 共用封裝資產；macOS 另接桌面／浮動場景。

```bash
npm ci --ignore-scripts
bash scripts/macos/build-native-app.sh --platform macos
bash scripts/macos/build-native-app.sh --platform ios --simulator
bash scripts/macos/build-native-app.sh --platform ios --release
```

產生的 `build/apple/WorkFleet.xcodeproj` 含共用 Swift、兩個 scheme、封裝資產、圖示、
privacy manifest 與 entitlements。可在 Xcode 開啟專案選擇裝置；產生器需在 Mac 執行。
SDK 固定 GoogleSignIn 9.2.0；SPM checkout 根目錄授權文本於簽章前複製到 bundle Licenses。
Release 先檢查 `.env` 公開設定，再 archive；簽章／provisioning 在 Xcode／Keychain 配置。
商店 export／上傳仍由持有帳號及簽章的人員執行，腳本不含私鑰。

GoogleSignIn Apple SDK 的 macOS、iOS client 都使用 **iOS 類型 OAuth client**，各自符合
實際 bundle ID，分別填 `.env` 的 MACOS／IOS client ID。產生器加入 reversed client URL scheme。
Apple 簽章憑證與 Keychain access group 是登入及安全保存的必要條件；未簽章 simulator 不代表真登入可用。

SQLite 位於 App Sandbox 的 Application Support/WorkFleet，內容、附件與原生 metadata 用
Keychain AES-256-GCM 加密。DB 同 revision CAS 與附件寫入為單一交易，flock 保持單一 owner。
WKWebView 僅主 frame 的封裝 document 可呼叫 bridge；桌面視窗沒有 DB／檔案／憑證能力。
資料夾選擇保留 bookmark 與檔案系統身分；自動備份 journal 及密碼受原生保護，密碼不回傳 renderer。
可攜備份保持 SPEC-002 PBKDF2／AES-GCM ZIP，換裝置還原須自行保存原密碼。

macOS 桌面 visual panel 始終 ignoresMouseEvents；只有可操作或已開啟唯讀選字的紙面建立
透明輸入區域，遮蓋部分依 renderer 疊序裁切。就地 editor 留在相同 WKWebView；主畫面是唯一內容 owner。
桌面層用公開 desktopIconWindow level，浮動層用 floating level；桌布層偏好保留並回報 desktop fallback。
快捷鍵以 Carbon RegisterEventHotKey 註冊，App 或 editor 使用中釋放全域鍵；衝突在設定顯示。
選單列支援重新開啟、快速記錄、操作、顯示與保存退出。螢幕／Space／休眠通知會暫停輸入，
保留 editor surface，待 owner 保存救援位置後套用新 topology；背景更新不主動取得鍵盤焦點。

這些是已加入的程式與建置入口。本機為 Windows，未編譯 Apple 程式、產生 app/archive 或執行原生驗收。
全螢幕／Spaces、透明輸入转送、IME、多螢幕及正式 Google 登入的實機結果仍缺。

附件／草稿下載走原生匯出：macOS NSSavePanel、iOS UIDocumentPicker，保留取消結果。
iOS 編輯器提供 Markdown 文字與單附件分享，使用 UIActivityViewController／iPad popover。
傳輸沿用有容量與 SHA-256 核對的 owner staging；分享暫存使用完整檔案保護，完成／取消後清除。
原生對話框逾時或帳號切換終止待處理的 iOS 匯出。分享至其他 App 不表示已送達收件人。
外部分享接收與 Share Extension 尚未加入，仍屬完整手機交付範圍。
