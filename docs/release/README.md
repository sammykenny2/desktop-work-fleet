# 商店提交準備

本目錄提供提交文案與資料清單；執行／建置／簽章／商店狀態只記在根目錄 PROGRESS。

- [繁中文案](store-listing.zh-TW.json)、[英文文案](store-listing.en-US.json)：名稱、簡述、完整說明。
- [隱私說明](privacy.zh-TW.md)：依實際維護者資料發布，公開 URL 設於 `.env`。
- [提交資料清單](submission-data.json)：資料用途、外部設定及截圖場景。

`.env.example` 的 app ID、Google clients、Apple team、隱私／支援網址與聯絡 email 是公開設定。
簽章 keystore、憑證、商店 API key、OAuth token 與密碼不放在 repo 或公共設定檔。
`node scripts/check-config.mjs --platform <platform>` 可列出缺少的公開配置。

Android 的 `bundleRelease` 產生未簽章 AAB，供既有簽章 pipeline／Play App Signing。
Google Android OAuth client 的 SHA-1 必須對應實際散布簽章；debug 與 Play 簽章分別配置。
Google Web client 用於 Credential Manager audience，屬同一 Google Cloud 專案。
正式提交使用實際原生套件截图，不以瀏覽器或設計稿充當原生證據。

請依最終原生套件及 SDK 資料清單填寫商店表單；本目錄不宣稱表單已送出或通過。
