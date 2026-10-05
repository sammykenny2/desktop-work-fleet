# ADR-018: 單一工作區權威與 Windows 桌面表面整合

## Status

2026-10-05：[ADR-030](030-windows-explorer-wallpaper-layer.md) 加入第三個 wallpaper 場景及 Explorer 附著，
取代下方兩層與 Windows 不提供桌布層的原始限制；單一權威與傳輸政策保留。

Accepted，2026-10-04。採用共用命令／草稿協調及 Windows 呈現接線。
不代表全域快捷鍵、顯示器熱插拔、其他平台或完整桌面驗收已完成；實際狀態見 PROGRESS。

## Context

主畫面已擁有 Workspace、版面與 SQLite adapter；桌面表面需要顯示相同卡片、送出手勢及文字。
若每個 WebView 重開一個 Workspace，即使 native CAS 擋住競爭，仍會產生過期草稿與不同步操作狀態。
卡片本文可大於單次 IPC，因此不能把桌面編輯限縮成小字串，也不能暴露任意儲存方法。

## Decision

- 主畫面保持唯一 Workspace／InteractionController。`src/desktop` 的 authority 將固定命令送入既有控制器；
  場景只接收投影，不取得歷史、outbox、同步游標、原始附件或憑證。
- Windows 每顯示器使用桌面及浮動兩個場景，各沿用 ADR-017 的互補原生視窗。
  `DesktopCoordinator` 管理僅存在記憶體的 frame／command mailbox，場景不能調主畫面的 storage／backup bridge。
  載入固定 `/desktop/index.html`，阻擋其他文件、子 frame、遠端資源及下载。
- 畫面上限 128 MiB，文字命令 16 MiB；IPC 沿用 256 KiB 分片與 SHA-256。
  唯讀 lease 固定指向同一份已完成 bytes，發布新畫面不使讀取中的舊畫面變質。
  frame buffer 上限 320 MiB，command buffer 上限 64 MiB，合計 384 MiB；這不是整個瀏覽器程序的記憶體上限。
  超額明確回報，不截斷內容；主資料仍可從管理入口存取。
- session／view UUID、每 view 單調 serial、最近 256 個結果 receipt 防止舊視窗及重複命令寫入。
  過期結果不重新執行。拖曳另外綁定控制器產生的唯一 generation；pointerId 重用不取得先前手勢權限。
- 普通命令與主畫面動作共用執行序；草稿寫入使用獨立序列及名額。
  普通命令先等呼叫前已接收的草稿，再檢查編輯世代；不把 flush 的最後寫入排在等待它的退出命令後面。
- 就地文字每次保存必須收到 native durable ack 才前進 sequence。回覆不明時保留當時字串，先重試同 sequence，
  再送後續輸入。換視窗先凍結並保存原視窗，接手最後文字；同卡重複編輯沿用草稿。
- 關閉先拒絕普通場景命令，完成最後草稿後封住新命令、等待已接收工作，保持編輯凍結至 native 銷毀。
  若關閉失敗才恢復輸入。場景失聯先解除 flush 等待，再等已接受 draft lane 落盤，主畫面才接手最新草稿。
- Windows 座標使用啟動時主顯示器 DPI 的統一邏輯單位：physical 坐標除以 referenceDpi/96。
  每個顯示器以 SetWindowPos 明確覆蓋其 physical bounds；WebView ZoomFactor 為 referenceDpi/monitorDpi，
  input rect 先換為 WPF 邏輯座標再由 ADR-017 換成 native pixels。工作區採 work area，管理視窗 resize 不改版面。
  此選擇維持跨顯示器連續座標與一致像素紙面；不同 DPI 螢幕的感知字體大小仍需實機驗證。
- Windows 不提供桌布層時明確提示改以桌面層呈現，保留原偏好。來源合併帶來十組或長名稱仍顯示內容；
  九組限制只約束新建／formation，不作 native 整幀拒收條件。

## Consequences

### Positive

多表面共用一份交易與草稿權威；重試、接手、失聯及關閉的資料保存界線可直接測試。
現有附件、備份及完整編輯仍由主入口提供，場景無須擁有 OS 保存能力。

### Negative

目前傳輸完整投影，大量 Markdown 卡片的持續拖曳效能尚未壓測；多顯示器會增加 WebView 數量。
主畫面程序失敗會結束桌面工作階段；未收到 durable ack 的文字不宣稱已保存。
目前顯示器拓撲在啟動時建立，拔插／DPI 變更及原生快捷鍵整合仍另切片處理。

### Neutral

瀏覽器預覽繼續使用原本單畫面 IndexedDB 模式；此切片未新增 listener、runtime 套件或外部來源程式。

## Alternatives Considered

### 每表面各自開 Workspace

可重用完整主畫面初始化，但草稿與互動狀態會分歧、頻繁 CAS 拒絕；因此拒絕。

### 場景直接取得原生儲存 bridge

少一道轉送，但讓所有呈現文件擁有主工作區／vault 能力，且無法建立唯一控制器序列；因此拒絕。

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [ADR-017](017-windows-composition-surface-and-input.md)
- [Windows 場景傳輸與座標研究](../resreach/2026-10-04-windows-desktop-coordination.md)
- [桌面通道契約](../../contracts/desktop-scene.d.ts)

Decision made: 2026-10-04.
