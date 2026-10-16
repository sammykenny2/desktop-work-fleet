# ADR-021: Windows Google 登入、帳號分區與同步

## Status

Accepted

2026-10-15 修訂：登出不再向 Google 撤銷授權（Windows、Linux、Apple、Android 一併修改）。
Google 的撤銷會移除整個專案的授權，同一帳號在其他裝置上的 token 全部失效，約一小時內陸續要求重新登入；
使用者回報多台機器陸續出現「Google 授權未完成或已失效，請重新登入。」並指出這種行為不能接受。
要撤銷 Work Fleet 的存取，請到 Google 帳戶的「第三方應用程式」移除。

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
登出只清除這台裝置上該帳號的憑證，不向 Google 撤銷授權（2026-10-15 修訂，見 Status）；便箋資料保留於原帳號分區。

## Consequences

- 不增加自家便箋 server，callback listener 只服務一次登入。
- 未填 client ID 仍能使用本機便箋；Google UI 回報設定需求。
- Google 專案建立、真登入／Drive 往返及其他平台授權仍有外部配置與平台驗收需求。

## Alternatives Considered

renderer 持有 token 或任意 HTTP bridge：拒絕，因為擴大憑證及網路能力暴露。
所有帳號共用一個本機工作區：拒絕，因為容易把便箋傳到錯誤帳號。

## 2026-10-06 修訂：Desktop client secret

建立真正的 Google 專案前確認：Desktop 類型 client 即使使用 PKCE，Google 換 token 端點仍回
`invalid_request: client_secret is missing`（文件把參數列為選填，實際仍要求）。
- Windows／Linux 的 Desktop client secret 改為選填設定，有值時隨授權碼交換與 refresh 一起送出。
- Google 把安裝型 App 的 client secret 視為不保密；它不能保護 token，安全邊界仍是 PKCE、state 與只綁 127.0.0.1 的 callback。
- secret 只寫進該平台 App 旁的設定檔，不進 renderer 資產，也不進 Android／Apple 包；Web client secret 仍不使用。
- 沒有 secret 時照舊不送，若 Google 日後接受純 PKCE 也不需改程式。

## References

- [ADR-012](012-durable-file-store-and-drive-adapter.md)
- [Google 原生 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google userinfo](https://developers.google.com/identity/openid-connect/reference)
- [服務與 port](../services.md)
- [Desktop PKCE 換 token 仍要求 client secret](https://discuss.google.dev/t/desktop-oauth-pkce-exchange-returns-invalid-request-after-successful-loopback-callback-with-no-client-secret/390526)

*Decision made: 2026-10-05*

## 2026-10-17 修訂：手機帳號選擇與取消

iOS／Android／Web OAuth clients 已建立。沿用 ADR-022／023 的原生授權與分區，不新增自家登入 server。
Android 在登入／登出時清除 Credential Manager 的本機選擇狀態，不撤銷 Google grant；
access token 依已確認的 sub 綁定快取，選另一帳號取得的 token 不能用於目前分區的待送內容。
登入的帳號選擇、Drive 授權與 userinfo 共用 110 秒期限，保留 bridge 回覆的時間；逾時／關閉後不再開啟晚到的授權視窗。
Apple 互動登入不預先 signOut；使用者取消時保留既有 SDK session 與便箋分區。
兩者將取消、網路／設定／憑證失敗轉成固定的產品提示，不把 SDK 原始錯誤或 token 回傳 renderer。
SDK 依據與未驗收界線見 [手機授權研究](../research/2026-10-17-mobile-google-sign-in.md)。
