# macOS 驗證版 0.1.0 報告

日期：2026-10-03（Asia/Taipei）。原始基線 `8a7da58`。
交付範圍為可操作驗證版；尚未取得所有平台與桌面手勢的通過證據。

## 環境與產物

- macOS 26.7.1，build 25G241，x86_64；執行時偵測到 1 個螢幕。
- Command Line Tools，Swift 6.3.3，deployment target macOS 13.0。
- Python 3.14.7，SQLite 3.51.0；Node 24.21.0 僅用於 JS 測試。
- `build/Work Fleet.app`，bundle ID `io.workfleet.validation`，ad-hoc 簽章。
- `codesign --verify --strict` 通過。實際 entitlements 僅有 `app-sandbox`、`network.client`。
- `otool -L` 僅列 Apple 系統 framework／dylib 與系統 Swift runtime；沒有嵌入第三方 framework。
- `src/server/`、`src/web/`、`src/macos/` 均為本專案原創；沒有搬入舊應用程式／資產。
- 另以 staged index 匯出乾淨目錄，從空的 Swift module cache 完成 build 與 strict codesign 驗證；13 個 HTTP/SQLite、8 個 JS 與文件檢查也在該副本通過。該副本的 `python3` 為 CLT 3.9.6（主要測試環境仍為 3.14.7；文件的支援目標為 3.12+）。
- [建置與操作](../setup-guide.md)、[API](../api.md)、[依賴清單](runtime-inventory.json)。

## 通過（依證據限定範圍）

| 疑慮 | 證據與結果 |
|---|---|
| 是否真的能收資料 | 真實 signed app 在 Sandbox 啟動，輪詢臨時 HTTP/SQLite；note count 0→1、revisionSum 0→1 |
| Sandbox 是否有效 | container=true；試寫 `/Users/Shared/` 的合成測試檔被 NSCocoaErrorDomain 513 拒絕；主動網路連線成功 |
| 唯讀與焦點政策 | 鎖定 snapshots 均 ignoresMouse=true、canBecomeKey=false、isKey=false；原生畫面確認可讀 |
| 背景資料更新搶焦點 | 更新前後 frontmost PID 相同，背景階段 baseline 未改變；只涵蓋此測試期間 |
| 解鎖／重鎖 | unlock 後 ignoresMouse=false、canBecomeKey=true；relock 後恢復 true/false 且不是 key window |
| 真實編輯與共同來源 | Sandbox 中的 WebKit 透過實際 DOM 表單保存，SQLite 可讀；原生 snapshot 收到新增後的內容数量 |
| 快速記錄／待辦 | WebKit 新增、`- [ ]` 勾選持久化、Done 隱藏／還原、刪除／還原通過；無額外必填工作流程 |
| 兩個 client 同改 | HTTP 兩個獨立裝置並行寫入，只有一個 200，另一個 409/current；WebKit 的敗方草稿仍在 |
| 回應遺失重試 | WebKit 丟棄 server 已提交的 response 後按重試，只有一筆；重開 DB 後相同 operation 回相同結果 |
| 斷線重試 | 在真實 WebKit 的 transport 注入連線失敗，草稿和相同 operation 保留；恢復 transport 後重送成功 |
| 草稿保留 | 輸入後逐次落地，實際 WebView reload 後取回；兩分頁取回各用独立 record，成功送出不刪別人的草稿 |
| 保存失敗 | 注入 localStorage quota error，禁止切換丟失 memory；第一筆尚未落地文字也保留；SQLite 寫入失敗 rollback，重試可成功 |
| 刪除與離線重連 | tombstone 拒絕舊 revision 更新與重用相同 id；只有明確 restore 可復原 |
| 備份恢復 | online backup、還原新路徑、內容回復、epoch 改變、舊 token 拒絕、舊 epoch 草稿 409 |
| 中斷恢復 | 在 backup copy 後故障注入，未發布目的 DB；完成授權輪換後才以 atomic create-only 發布 |
| 裝置配對 | 一次性、逾期、並行兌換只有一次成功、viewer 禁寫、撤銷後讀／寫／舊 operation retry 均被拒絕 |
| QR | 原生 CoreImage 產生真實短效邀請 QR，CoreImage 解碼回相同 URL；未含永久 token。不是手機相機實測 |
| 公開 API | 原始碼及連結產物檢查未見 private API；AppKit/WebKit/CoreImage 為系統公開框架，沒有 Tauri private feature |

資料層：13 個 Python HTTP/SQLite 整合測試。
草稿模型：8 個 Node 測試。
真實 WebKit：12 個流程斷言，涵蓋第一階段 10 項與實際 reload 後 2 項。
執行命令見 [testing](../testing.md)。

## 失敗／阻礙與已修正問題

- **自動真實輸入注入受阻**：`CGPreflightPostEventAccess()` 回傳 false。測試沒有要求或修改 TCC 權限，
  因此未送出合成滑鼠／鍵盤事件，也未把旗標測試標成真實穿透通過。
- 初版原生 stack document view 缺少高度，取得的 app-owned render 為空；改為明確 canvas／文字 frame 後重新擷取並確認內容正常。
- 獨立 review 發現跨分頁共用草稿 key、首次 quota failure、換來源舊 WebView、恢復中斷與配對等待競態；均修正並加上對應回歸驗證。
- WebKit 測試初版在模組 ready 前提交表單、沒有等待非同步按鈕，造成假失敗；改為等待初始化及狀態後重跑通過。
- 目前完成執行的自動測試沒有尚未修正的失敗。以下未測項目仍是平台驗收缺口。

## 尚未測／不宣稱通過

| 項目 | 接續驗證方法 |
|---|---|
| 真實滑鼠穿透 | 鎖定面板蓋住桌面圖示後點擊、雙擊；空白處框選，拖動測試檔案穿過面板。確認事件到 Finder，便箋不被選字或移動 |
| 圖示上下層排序 | 三種 mode 已實際啟動及驗證設定／收資料；仍需以 Finder 圖示和普通 App 視窗目視確認層次。app-owned PNG 不能證明 compositor 排列 |
| 持續打字時更新 | 在另一個編輯器持續鍵入，同時第二 client 改便箋；確認所有字元留在原 App |
| Spaces／Show Desktop／Mission Control | 逐一切換、進出桌面、移動 Space；記錄面板出現／恢復與焦點 |
| Stage Manager／全螢幕 | 開關 Stage Manager、全螢幕與退出；檢查內容遮擋與恢復 |
| 多螢幕／縮放／拔插 | 實際接第二螢幕，切主螢幕與拔插，測面板可达性與尺寸；本次只有 1 個螢幕 |
| 休眠喚醒／實際網路中斷 | 本次測 transport failure 與 DB restart；未操作整台 Mac 休眠或路由器斷線 |
| 瀏覽器離線冷啟動 | service worker 已提供 editor shell cache；Safari/Chrome 完整離線重啟尚未實測。原生離線快取可讀，冷啟動 editor 仍需 server |
| 真實手機／LAN TLS／外網 | 可信 HTTPS、手機信任與網路可達性準備後掃描 QR，操作配對／撤銷。loopback QR 不可直接供手機連線 |
| 其他 OS／CPU | Windows、Linux、Apple Silicon、iOS、Android 尚未建置／執行；不能沿用此 Mac 結果 |
| 商店／正式散布 | 無正式簽章身分，未 notarize、未建立 MSIX／手機 package，未送 Apple/Google/Microsoft 商店 |
| UX 使用者評估 | 本次測操作正確性，尚未取得日常使用回饋；本機突出與多個獨立便箋視窗尚未實作 |

## 本機可操作交付

啟動腳本已完整執行，`http://127.0.0.1:9847` 提供服務；一般 App（非 probe）已成功配對為管理員。
初始化時資料目錄不存在，僅建立本 App 的 `~/.work-fleet/` 資料，未讀寫其他應用內容。
本機另有 `build/work-fleet-validation-macos-x86_64.zip`；建置產物不提交 Git，從原始碼可重建。

## 可重現證據與畫面

- [Sandbox／WebKit 執行事件](macos-web-probe.json)：只含合成資料計數、狀態與斷言名稱，不含 token／筆記本文。
- [一般視窗探針](macos-normal-probe.json)、[圖示下方探針](macos-below-probe.json)。
- [桌面卡片渲染](desktop.png)、[編輯介面渲染](editor.png)：僅擷取 App 自己的 view，使用合成資料；不是使用者桌面截圖。

## 獨立 review

另一个唯讀 reviewer 檢查 server、草稿、原生配對、probe 與修正。
以独立故障注入複核 interrupted restore 及旧憑證拒絕，最後複核指定修正未發現新的阻擋問題。
作者執行的建置與測試沒有當成獨立 review。商店、production 網路安全與完整平台矩陣仍未稽核。
