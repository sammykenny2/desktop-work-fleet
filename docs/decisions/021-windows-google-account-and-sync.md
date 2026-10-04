# ADR-021: Windows Google 登入、帳號分區與同步

## Status

Accepted

## Context

ADR-012 的 FileSync／Drive adapter 已存在，需要原生授權、安全儲存及可操作的帳號入口。
Google Cloud 專案尚未建立，公開 client ID 使用既有 `.env.example`。

## Decision

Windows 使用外部系統瀏覽器、authorization code／PKCE S256、隨機 state。
臨時 loopback callback 只綁定 127.0.0.1 的 OS 空閒 port，完成／逾時即關閉。
以 Google HTTPS userinfo 的 sub 作穩定分區 ID；請求 openid、email 及 drive.appdata。
登入不使用嵌入 WebView，也不依 email 作資料分區。

NativeGoogle 持有 access／refresh token 與續傳 URL。憑證以 DPAPI 加密並原子保存，
refresh 在原生服務完成。renderer 只呼叫固定語意的 FileStore 命令，不能提供 URL、HTTP headers 或 token。
Google HTTPS 回應拒絕 redirect，限制串流容量。上傳先校驗本機內容，下載校驗 metadata 與 SHA-256。
1 MiB resumable chunks；續傳進度由 Google Range 回應決定，檔案 ID 由既有 FileSync reservation 保存。

每個 Google sub 使用 `google:<sub>` 工作區，本機資料使用 `local`。
切換前保存草稿、停止自動備份及舊同步、封鎖桌面命令，再關閉舊權威並重新載入帳號分區。
本機既有便箋保留，可用備份匯入；不在登入後自動上傳其他帳號或 local 的資料。
新帳號初次先讀來源，成功確認空來源才建立預設群組。使用者明確快速新增時也可建立群組。
背景每 20 秒嘗試同步，沿用 FileSync 的退避／衝突／outbox 規則；對話框與組字期間延後。
登出清除該帳號本機憑證並嘗試撤銷 Google token；便箋資料保留於原帳號分區。

## Consequences

- 不增加自家便箋 server，callback listener 只服務一次登入。
- 未填 client ID 仍能使用本機便箋；Google UI 回報設定需求。
- Google 專案建立、真登入／Drive 往返及其他平台授權仍有外部配置與平台驗收需求。

## Alternatives Considered

renderer 持有 token 或任意 HTTP bridge：拒絕，因為擴大憑證及網路能力暴露。
所有帳號共用一個本機工作區：拒絕，因為容易把便箋傳到錯誤帳號。

## References

- [ADR-012](012-durable-file-store-and-drive-adapter.md)
- [Google 原生 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google userinfo](https://developers.google.com/identity/openid-connect/reference)
- [服務與 port](../services.md)

*Decision made: 2026-10-05*
