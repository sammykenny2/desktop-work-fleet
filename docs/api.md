# 驗證版 API

更新：2026-10-03。實作：`src/server/work_fleet.py`，schema 1；所有寫入以 SQLite transaction 提交。

同一 origin 提供 HTML 與 JSON。JSON API 使用 `Authorization: Bearer <device-token>`；
只有 `POST /api/pair` 不需 token。每次請求重新檢查裝置角色與撤銷狀態。
回應及靜態頁面 `Cache-Control: no-store`；service worker 只保存無憑證的 editor shell。

| Method/path | 行為 |
|---|---|
| GET /api/snapshot | epoch、role、device、全部 notes（含 tombstone） |
| POST /api/operations | create／update／delete／restore；editor/admin |
| POST /api/pair | `{code,name}` 交換一次性邀請，回傳裝置 token |
| POST /api/invites | admin 產生 viewer/editor 邀請；有效 300 秒 |
| GET /api/devices | admin 列出 id/name/role/revoked，不回 token |
| POST /api/revoke | admin 撤銷 `{device}`；不可撤銷自己 |

建立便箋的 body：

```json
{
  "epoch": "由 snapshot 取得的世代 UUID",
  "operation": "每筆操作固定的 UUID",
  "action": "create",
  "id": "新便箋 UUID",
  "text": "想法\n- [ ] 待辦",
  "board": "Inbox",
  "status": "todo"
}
```

`status` 僅有 `todo`、`in_progress`、`done`。文字 1–12000 字、群組 1–80 字。
群組是便箋的簡單標籤，不引入專案／Agent 必填欄位。待辦以 `- [ ]`／`- [x]` 表示。

更新使用 `action:update`、`revision` 與 `patch:{text?,board?,status?}`。
刪除／還原使用 `action:delete|restore` 與 `revision`；只允許明確 restore 讓 tombstone 復原。

競爭寫入回 409 及 `current`；epoch 不符回 `epoch_changed`。
已提交的同裝置／同 operation／相同 body 重試，回原本結果而不重複寫入。
operation 被改用於不同 body 回 409。已撤銷裝置重試舊 operation 仍回 401。

收到網路錯誤或 503 不能推論 server 未寫入；client 保存原 body 與 operation 後重送。
草稿不因 poll、409 或 401 被覆蓋。UI 允許另存副本，並保留原草稿供比較。
備份恢復後全部裝置需重新配對，舊 epoch 的草稿必須明確另存。

請求 body 上限 64 KiB；寫入必須 application/json。驗證 Host 與 Origin，無跨 origin CORS。
HTTPS origin 由服務設定，不信任轉送的 Host。沒有 JSONP、任意檔案服務或遠端程式碼入口。
