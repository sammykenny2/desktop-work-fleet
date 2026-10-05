# 服務與連接埠

更新：2026-10-05。

驗證服務預設 `127.0.0.1:9847`，以 `--host`／`--port` 配置。編輯頁與 API 同 origin。
啟動時若 port 衝突直接失敗，不會停止其他服務。測試使用 OS 分配的隨機 port。
已讀取可取得的 project-bootstrap port registry；未修改外部 registry。

macOS App 只有 network.client entitlement，沒有 listener。
LAN 必須使用 `--cert`、`--key`、`--origin https://主機:port`，手機需信任憑證且可達該主機。
QR 本身不提供 NAT 穿透；外網需自行部署可信 HTTPS 或 VPN。沒有啟用 Bonjour 或 UDP discovery。

## 1.0 介面開發預覽

`npm run build` 後可執行 `python scripts/testing/serve_preview.py --port 0`。
它只在 loopback 提供 `build/app` 靜態資產；預設由 OS 選擇空 port，終端顯示實際 URL。
`--port` 可指定測試 port，衝突則啟動失敗，不停止其他 listener。
這不是便箋 API／權威資料 server；介面透過 IndexedDB 本機交易保存資料。
正式原生 App 需封裝這些本機資產，不依賴此開發 listener。

Windows 1.0 主畫面以 WebView2 virtual host mapping 載入 `https://work-fleet.invalid/app/index.html`。
該名稱只在 WebView2 內解析為封裝 Assets；沒有 DNS、TCP／HTTP listener 或新的 port。
原生 SQLite／DPAPI 經 WebMessage bridge 存取；沒有 local note server。

## Windows Debug WebView 檢查

只有 Debug 組態且啟動程序帶有 `WORK_FLEET_WEBVIEW_DEBUG_PORT` 時，WebView2 才在 loopback 開 CDP port，
port 由開發者指定（1024–65535），沒有固定預設值；Release／MSIX 不編入這條路徑。
port 衝突時 WebView2 不提供 CDP，不停止其他 listener。測試 probe 使用 OS 分配的空閒 port。
loopback 不分 Windows 使用者，本機任何程序都能經此 port 讀取解密後的便箋並呼叫原生 bridge；只在檢查期間開啟，詳見 [ADR-032](decisions/032-windows-debug-webview-inspection.md)。

## Windows Google 登入 callback

登入期間以 TcpListener 綁定 `127.0.0.1:0`，由 OS 分配空閒 port，路徑 `/oauth2/callback`。
只接受符合該次隨機 state 的 code；PKCE verifier 留在原生服務。完成、取消或 110 秒逾時即關閉。
此 listener 不提供便箋 API，不綁定 LAN、不使用固定 port，也不變更外部 port registry。
Google HTTPS token、userinfo 及 Drive 請求皆由原生端送出，renderer 不持有憑證或任意 HTTP 能力。

## Linux 原生與 Google callback

Linux GTK／WebKitGTK 以 secure custom scheme `workfleet://app` 提供封裝資產，沒有常駐 HTTP listener。
只有 Google 登入期間使用 `127.0.0.1:0`、固定 `/oauth2/callback`；PKCE／state 留 native，
完成、取消或 110 秒逾時後關閉。沒有新增固定 port、LAN listener 或外部 registry 修改。
