# Drive 不可變檔案傳輸研究

查閱：2026-10-04。下列為官方 API 證據；實際帳號／五平台驗收仍未執行。
程式按文件獨立實作，未複製官方 samples。接受的設計見 [ADR-012](../decisions/012-durable-file-store-and-drive-adapter.md)。

## 外部證據

- appDataFolder 使用 drive.appdata scope；create 的 parent 指向 appDataFolder，list 的 spaces 亦需指定。
  它與使用者可見 Drive 檔案空間不同，不應當成可直接管理的備份介面。
  [官方 app data guide](https://developers.google.com/workspace/drive/api/guides/appdata)
- files.generateIds 可指定 space=appDataFolder、type=files；這裡的參數是單數 space。
  [generateIds](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds)
- 預產生 ID 可在不確定先前結果時重用；成功建立後同 ID 重試會衝突。Resumable 先取得 Location，
  後續 PUT 可分段且非末段是 256 KiB 倍數。續傳先查狀態，依 Range 決定已收 bytes；
  404 或任何 4xx 要重開 session。上傳 session 有效期一週。
  [uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- files.list 的 pages 不保證滿頁；incompleteSearch 代表未完成列舉；file page token 遭拒絕時重新從第一頁開始。
  [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)
- changes.list 使用 spaces=appDataFolder。中間頁提供 nextPageToken，末頁提供 newStartPageToken；
  restrictToMyDrive=true 會排除 appDataFolder，不可加上此限制。
  [changes.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list)
- getStartPageToken 提供 changes 起點；其 API 沒有 spaces 參數。
  [getStartPageToken](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/getStartPageToken)
- File 的 size 是字串；sha256Checksum 是可能存在的唯讀內容校驗；appProperties 需經認證存取。
  [File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
- 401 需處理登入；403 依 reason 區分限流、配額／權限。429／5xx 使用退避，不以重試清除待送資料。
  [errors](https://developers.google.com/workspace/drive/api/guides/handle-errors)
- 同一 Cloud project 的多 client 可視為同一邏輯 App，使用者 scope 授權是 project 層級的信任。
  此模型支持同專案配置，但不能取代各平台 appDataFolder／appProperties 的實際可見性測試。
  [Cross-client identity](https://developers.google.com/identity/protocols/oauth2/cross-client-identity)

## 本專案推論與設計

資料先下載、驗證並原子保存後才推進 cursor；分頁中斷不回滾已保存資料。
上傳成功先核對 server checksum，缺少時實際讀回；409 也實際讀回，確保同 ID 內容一致。
來源被外部清除時保留本機版本並回報，需要明確恢復策略，不從缺檔猜刪除意圖。

原生 transport 必須限制 origin／redirect／回應容量。Resumable URI 當作受保護連線資訊，
不放入一般 JSON、診斷或備份；失去該 URI 可重建 session，持久化 file ID 仍維持同一操作。

## 未驗證

尚無真 Google 專案、OAuth clients、scope consent 或 live HTTP 結果。
文件及 scripted HTTP tests 不證明五平台 clients 在同專案的同帳號資料可見性、
Google 實際 consistency／quota／網路中斷或原生 OS 安全儲存。這些驗收保留於 S12。
