# macOS 公開 API 桌面展示可行性研究

- 日期：2026-10-03
- 狀態：官方 API 靜態研究與推論，尚無本專案 macOS 實機結果。
- 問題：不使用 private API，能否接收資料、唯讀呈現於桌面附近，並讓滑鼠點不到？
- 發佈前提：目標包含 Mac App Store，故需納入 App Sandbox 與審查限制。

## 1. 目前結論與信心範圍

有合理的公開 API 路徑可驗證。滑鼠穿透、視窗焦點、視窗層級與 WebView 透明背景是可分別處理的事情。

最小候選是「不透明便箋卡片＋公開 AppKit 視窗 API＋背景接收資料」。卡片可以顯示實色背景，同時讓滑鼠事件穿過。

目前沒有證據足以宣稱本專案已能在所有 macOS、Spaces 或桌面設定下穩定工作，也未獲 App Store 審核通過。尤其桌布上方、Finder 圖示下方的細節，需要實機驗證。

## 2. 官方 API 證據

| 能力 | 公開 API／文件 | 可以支持的結論 |
|---|---|---|
| 滑鼠穿透 | NSWindow.ignoresMouseEvents | 可讓視窗對滑鼠事件透明 |
| 不成為鍵盤目標 | NSWindow.canBecomeKey | 可決定視窗是否能成為 key window |
| 視窗層級 | NSWindow.level、CGWindowLevelKey | 可研究公開的桌面與桌面圖示層級 |
| Spaces 等集合行為 | NSWindow.collectionBehavior | 有公開控制入口，實際組合仍需測試 |
| Sandbox 網路連線 | network.client entitlement | 可主動連到本機或其他機器的 server |

來源：[滑鼠事件](https://developer.apple.com/documentation/appkit/nswindow/ignoresmouseevents)、[Key window](https://developer.apple.com/documentation/appkit/nswindow/canbecomekey)、[NSWindow](https://developer.apple.com/documentation/appkit/nswindow)、[Window levels](https://developer.apple.com/documentation/coregraphics/cgwindowlevelkey)、[桌面圖示層](https://developer.apple.com/documentation/coregraphics/cgwindowlevelkey/desktopiconwindow)、[Network client](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.client)。

這些文件證明 API 是公開入口；「符合我們的桌面體驗」是後續組合驗證的問題。

## 3. 透明的兩種意思

### 輸入透明

點擊不由便箋接受，讓使用者操作下方的桌面或其他視窗。以公開的 ignoresMouseEvents 為主要研究入口。

### 視覺透明

能看見卡片背景後面的桌布，或呈現圓角、半透明與模糊效果。這與事件穿透沒有必要相依。

Tauri 的 transparent WebView window 在 macOS 有 private API 限制；官方設定文件明確警告其 App Store 相容性，並提及 windowEffects 的公開 API 路徑。這不代表所有 AppKit 透明視窗或所有視覺效果都需要 private API。[Tauri config](https://v2.tauri.app/reference/config/)

第一個探針先使用實色卡片，能避免把非必要的視覺效果混入桌面層與輸入驗證。這不是對最終外觀的限制。

## 4. 分層能力評估

| 目標 | 初步判斷 | 主要未知 |
|---|---|---|
| 一般視窗中唯讀顯示資料 | 可作基準對照 | 資料更新與焦點 |
| 一般 App 後方、桌面圖示上方 | 值得優先驗證的公開 API 組合 | Finder 重排、Show Desktop、Spaces |
| 桌布上方、圖示下方 | 候選能力，證據弱於前項 | 同層排序、系統桌布視窗與版本差異 |
| 滑鼠穿透 | 有直接公開 API | framework 封裝是否會重設狀態 |
| 不搶鍵盤焦點 | 有公開 API 可配合 | 啟動、更新與重新顯示時是否啟用 App |
| 鎖定／就地編輯切換 | 可設計成不同互動模式 | 重新鎖定時的焦點與草稿處理 |
| 所有桌面功能完全一致 | 尚不能保證 | 多螢幕、Stage Manager、全螢幕與系統版本 |

不要把某個固定數值或一次 orderBack 成功視為可靠桌布層方案。應以公開標準層級取值與實際排列證據判定。

## 5. 公開 API 的最小驗證版本

候選實驗目錄可在此 repo 中建立獨立 macOS spike；目錄名稱與實作尚未決定。本次只記錄計畫，不產生 App 程式碼。

建議先用小型 AppKit 原型驗證平台本身，內容包括：

- 一個簡單編輯／控制入口。
- 一張實色、唯讀展示卡片。
- 鎖定時忽略滑鼠、不成為 key window、不主動 activate。
- 比較一般視窗、桌面圖示上方與圖示下方的層級結果。
- 透過可控資料來源更新文字，不在更新時搶焦點。
- 在啟用 App Sandbox 的組態中執行。

若後續選擇 Tauri 或其他框架，需要再做該框架版本的整合驗證。AppKit 探針成功不等於特定 WebView 封裝成功。

## 6. Sandbox 與網路

Mac App Store 發佈需要 App Sandbox。[Apple App Sandbox](https://developer.apple.com/documentation/security/app-sandbox)

如果 App 主動建立 HTTPS 或其他 TCP 連線來收資料，network.client 是相關的 entitlement；TCP 連線建立後可以雙向傳送資料，不能把「收到 server 更新」直接理解成必須開 inbound listener。[Apple network entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.client)

若採 UDP discovery、Bonjour 或本機監聽 server，需另外檢查實際權限與 privacy 行為。不要只因資料來源是 local server，就提前加入廣泛權限。

## 7. 若以 Tauri 實作時的驗證項目

這些是候選檢查，不代表已決定採 Tauri：

- Cargo feature 的所有來源是否都沒有啟用 macos-private-api，包括 target-specific 依賴。
- Config 是否關閉相關 private API 選項。
- 建立視窗時是否仍要求依賴 private API 的 transparent 行為。
- 所用套件是否經其他 feature 間接啟用相同能力。
- Native window adapter 是否維持輸入、焦點與層級設定。
- 發佈產物、entitlements 與 sandbox 行為是否符合預期。

只改一個 JSON boolean，不能當作 private API 已被完全排除的證據。

## 8. 必須記錄的實機測試

| 場景 | 觀察 |
|---|---|
| 點擊便箋覆蓋的圖示與空白桌面 | 下方目標是否正確收到事件 |
| 桌面框選、拖動圖示、拖放檔案 | 便箋是否攔截、被移動或被選字 |
| 在編輯器打字時收到資料更新 | 文字焦點是否保持 |
| 開關普通 App 與 Finder 視窗 | 卡片是否留在預定層級 |
| Show Desktop、Mission Control、Spaces | 出現／隱藏與回復是否符合預期 |
| Stage Manager、全螢幕 App | 是否遮住工作內容或消失後無法恢復 |
| 多螢幕、不同縮放、拔插螢幕 | 位置與尺寸能否合理回復 |
| 休眠喚醒、網路中斷、server 恢復 | 舊內容可讀且同步狀態清楚 |
| Unlock／edit／lock | 草稿保留、輸入穿透與焦點正確復原 |
| Sandbox release 組態 | 與開發組態結果是否一致 |

紀錄 OS、硬體、螢幕、App build、entitlements、步驟與結果；失敗也應保存。此表目前所有項目均為未測。

## 9. 成功與降級條件

最低平台成功條件：接收更新、顯示未完成內容、滑鼠穿透、不搶鍵盤焦點，且不用 private API。

桌布層若不穩定，可先驗證桌面圖示上方的方案是否仍符合使用者需求。無法支持的功能需明確列出，不用「跨平台」掩蓋差異。App Store 可提交性與實際審核結果另外記錄。
