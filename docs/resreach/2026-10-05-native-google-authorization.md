# 2026-10-05 原生 Google 授權

## 官方證據

- [Installed apps OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)：PKCE、外部瀏覽器、state、authorization code、refresh。桌面 loopback 仍適用；client_secret 欄位為 optional。
- [Loopback migration](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration)：桌面 client 可使用 loopback；不可套用到 iOS／Android client。
- [userinfo](https://developers.google.com/identity/openid-connect/reference)：透過 HTTPS Bearer userinfo 取得不變 sub，而非以 email 作帳號識別。

## 決策與界線

Windows 採 ADR-021，系統瀏覽器及原生 token 管理。手機使用各平台支援的登入 SDK／callback，不能沿用桌面 loopback。
本次未建立 Google Cloud 專案或登入真帳號，官方 API 證據不代表整合驗收完成。
