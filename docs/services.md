# 服務與連接埠

更新：2026-10-03。

驗證服務預設 `127.0.0.1:9847`，以 `--host`／`--port` 配置。編輯頁與 API 同 origin。
啟動時若 port 衝突直接失敗，不會停止其他服務。測試使用 OS 分配的隨機 port。
已讀取可取得的 project-bootstrap port registry；未修改外部 registry。

macOS App 只有 network.client entitlement，沒有 listener。
LAN 必須使用 `--cert`、`--key`、`--origin https://主機:port`，手機需信任憑證且可達該主機。
QR 本身不提供 NAT 穿透；外網需自行部署可信 HTTPS 或 VPN。沒有啟用 Bonjour 或 UDP discovery。
