# 2026-10-05 Android 原生 host

## 官方證據

- [WebKit releases](https://developer.android.com/jetpack/androidx/releases/webkit)：採固定 1.16.0。
- [AGP 8.13](https://developer.android.com/build/releases/agp-8-13-0-release-notes)：8.13.2、Gradle 8.13、JDK 17。
- [Authorization](https://developer.android.com/identity/authorization)：Google 資料授權與帳號登入分開；AuthorizationClient 提供 access token／resolution。文件依賴範例為 Play Services Auth 22.0.0。
- [Google ID releases](https://developers.google.com/identity/android-credential-manager/releases)：Credential Manager 的明確 Google 按鈕流程；本切片固定相容版本 Google ID 1.1.1。
- [WebMessage listener](https://developer.android.com/reference/androidx/webkit/WebViewCompat)：固定 origin 與主 frame 驗證；不使用全域 JavaScriptInterface。

## 決策與界線

實作選擇见 ADR-022。這些官方 API 證據不代表原生編譯／真裝置／Google 專案驗收。
本機缺 Android SDK／Gradle，執行證據見 PROGRESS。
