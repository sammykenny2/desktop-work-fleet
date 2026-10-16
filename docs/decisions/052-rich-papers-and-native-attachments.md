# ADR-052: 便箋格式與原生附件縮圖／開啟

## Status

Accepted，2026-10-17。使用者要求實作附件縮圖、雙擊開啟、H1～H6 CSS 與程式碼上色；
明確排除桌面直接切換 checklist，不升版、不發布。

## Context

桌面便箋已解析 GFM，但只有 H1／H2 的簡易字級，程式碼沒有上色。
附件保存於帳號分區資料庫並參與既有同步／備份，桌面投影原先只有附件數量，不能直接操作附件。
ADR-009 的不執行原始 HTML／SVG 與 ADR-018 的單一權威邊界須保留。

## Decision

- 桌面、主畫面與編輯器預覽使用共用 CSS，六階標題依序縮小，程式碼保留縮排並在區塊內橫向捲動。
- 鎖定 Highlight.js 11.12.0／BSD-3-Clause，只封裝 common 語言集，不載入 CDN。
  只上色明確指定且支援的語言；未知、未指定或超過 20,000 字元的單一區塊保留純文字。
  便箋超過 100,000 字元時不上色；每次呈現最多上色 12 個區塊、合計 40,000 字元；主清單摘要不上色。
  產生的 span 再經 DOMPurify 清理，最多快取 64 個結果；原始 Markdown 不變。
- 附件以縮圖／系統檔案圖示與檔名呈現；雙擊或鍵盤啟用交由系統預設程式開啟。
  預覽失敗保留檔名與類型圖示，缺少本機 bytes 顯示尚未下載，開啟時回報需先同步。
- 桌面投影只增加附件 id／name，不傳原始附件。場景命令送到主工作區，核對目前卡片版本、可見性與附件歸屬；
  開啟另核對可互動狀態。場景沒有儲存、任意路徑或任意程式能力；重試沿用既有 receipt。
  縮圖使用獨立、有界的兩條背景通道，不排在普通桌面操作、草稿保存或 native storage queue 後面，
  也不因預覽完成重繪整份工作區。切換 profile／重設／結束時清理該工作階段，遲到結果不重新填入快取。
- 原生主文件新增 `attachment.preview`／`attachment.open`，只依目前 profile 的附件 id 讀取及驗證 bytes。
  原生介面自行產生私有暫存位置、清理檔名，不接受來源路徑／程式／命令列。
  預覽只回傳至多 256 KiB 的 PNG，前端轉為 blob URL；桌面 CSP 只放行 blob 圖片，仍不載入遠端圖片。
- Windows 使用 Shell Image Factory；macOS 使用 Quick Look 與 NSWorkspace 圖示；Linux 先用 GdkPixbuf，
  再嘗試已安裝、宣告相符 MIME 的桌面 thumbnailer，最後使用系統檔案圖示。
  Linux thumbnailer 的 Exec 解析為 argv，不經 shell；可預覽的類型依系統安裝狀態而異。
- 開啟的是唯讀附件副本，原資料不變；外部修改不會自動回存或同步。
  可執行檔、捷徑與部分腳本類型不提供直接開啟。受管理副本正常結束時盡力清除，
  OS／外部程式鎖住檔案或程序異常結束可能留在暫存目錄。
- 既有 V1 附件、同步與備份格式不變，不新增 migration；checklist 保持原行為。

## Consequences

### Positive

- 同一份內容在桌面與主畫面有一致格式；可直接查看或開啟附件。
- 不需要在 App WebView 執行附件文件或加入 Office／PDF 編輯器。

### Negative

- 系統縮圖與預設程式因機器而異；開啟不包含外部編輯回存。
- OS 產生縮圖及開啟附件時需要明文暫存副本；不能宣稱資料永遠不離開加密資料庫。
- macOS 簽章／沙盒及各 Linux 桌面環境仍需實機驗收，不能由共用瀏覽器測試替代。

### Neutral

- 本次不改 App 版號、發布流程、資料 schema 或 checklist 操作。

## References

- [ADR-009](009-local-renderer-and-persistence.md)、[ADR-018](018-single-owner-desktop-views.md)、[SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [Highlight.js](https://github.com/highlightjs/highlight.js)、[Marked 擴充](https://marked.js.org/using_pro)
- [Windows Shell Image Factory](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishellitemimagefactory)
- [Apple Quick Look](https://developer.apple.com/documentation/quicklookthumbnailing)
- [freedesktop 縮圖標準](https://specifications.freedesktop.org/thumbnail/latest/)、[GIO 預設程式](https://docs.gtk.org/gio/type_func.AppInfo.launch_default_for_uri.html)
