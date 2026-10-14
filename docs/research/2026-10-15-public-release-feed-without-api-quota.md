# 公開 Release feed 與公司出口 IP 配額

日期：2026-10-15。證據、決策與執行結果分開；決策見 [ADR-044](../decisions/044-desktop-in-app-updates-from-github-releases.md)，
本輪檢查結果見 [PROGRESS](../../PROGRESS.md)。

## 官方規則

[GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#primary-rate-limit-for-unauthenticated-users)
說明未驗證請求按來源 IP 計算，每小時 60 次，不是每個 App、員工或 repo 各有 60 次。
因此公司員工若經同一 NAT 出口連線，會共用這份額度；只做手動檢查不能保證查詢成功。
這項限制是 REST API 的配額，不代表所有 GitHub 公開網址都共用這份配額。

## 2026-10-15 實測

從同一台電腦、不帶 token 查詢，未修改 GitHub 或已安裝 App：

| 入口 | 結果 |
|---|---|
| 本 repo 的 `api.github.com/repos/.../releases?per_page=30` | 403；`X-RateLimit-Limit: 60`、`X-RateLimit-Remaining: 0`，body 指出 API 配額耗盡 |
| 本 repo 的 `github.com/.../releases.atom` | 200 |
| 維護者指定的 Electron 參考專案之公開 `releases.atom` | 200 |

參考專案的公開 GitHub provider 使用 `electron-updater` 6.8.9：先讀 Atom，預覽頻道選已發布 tag，
正式頻道用 GitHub 公開 `releases/latest`，再取得 tag 對應 metadata。只參考入口與行為，沒有複製程式碼。
上游來源：[GitHubProvider.ts](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/GitHubProvider.ts)。
master 內容可能變動；上述版本與入口是本機實際依賴的讀碼證據。

## 採納與限制

- Work Fleet 三平台改讀 Atom，以同 repo 的 alternate link 和 `<platform>-vX.Y.Z` 選 feed 中最高版本。
  版本不是發布日期排序；manifest／appcast／安裝檔網址由設定 repo 與驗證 tag 建立。
- 公開 Atom 只含已發布 release，但沒有可靠的 prerelease 欄位。現行 preview 包含 prerelease；其他頻道明確拒絕，
  正式頻道不能直接用同一邏輯。`releases/latest` 跨平台且排除預覽，不能代替本產品的 tag 篩選。
- Atom 是有限近期列表。非空 feed 沒有此平台時不能回答已是最新；顯示來源不足，長期各平台索引另行決策。
- 不需要更新舊 release 或發布新索引，現有 tag 的 `work-fleet-update.json`／`appcast.xml` 保持可讀。
  Atom 沒有 asset size，改以 manifest 預期值核對真實下載 bytes、SHA-256 與既有套件身分／簽章。
- GitHub 公開網頁仍可能拒絕請求；429 或帶 Retry-After 的 403 才在本流程標示限流，一般 403 標示來源拒絕。
  移除 60 次／小時 API 依賴不等於宣稱 GitHub 完全無限制。
