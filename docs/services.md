# 服務與連接埠

更新：2026-10-03。

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
