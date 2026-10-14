# Linux Secret Service 不主動提示的行為研究

研究日期：2026-10-15。結論用於 [ADR-048](../decisions/048-linux-offline-workspace-and-system-secrets.md)；測試使用私人 D-Bus 與合成資料。

## 官方證據

- [Prompts and Prompting](https://specifications.freedesktop.org/secret-service/latest/prompts.html)：需互動的操作回傳 prompt object，
  client 再呼叫 Prompt；因此不執行 Prompt 可以將需解鎖的工作暫停。這是 client 的行為契約，不是所有 provider 的 UI 保證。
- [Collection CreateItem](https://specifications.freedesktop.org/secret-service/latest/org.freedesktop.Secret.Collection.html)：
  CreateItem 回傳 item 與 prompt paths；replace 只替換該 collection 中匹配 attributes 的項目。
- [Aliases](https://specifications.freedesktop.org/secret-service/latest/aliases.html)：default／session 是 alias，須解析到 collection object path。
  本機 GI 的 `Secret.COLLECTION_SESSION` 值為字串 `session`，不能直接與 object path 比較。
- [libsecret password_store_sync](https://gnome.pages.gitlab.gnome.org/libsecret/func.password_store_sync.html)：session collection 不跨登入工作階段保存。
- [libsecret Service.open_sync](https://gnome.pages.gitlab.gnome.org/libsecret/type_func.Service.open_sync.html)：可以指定 D-Bus service name，
  建立新的 proxy。同步方法可能等待，不應放在 UI thread。
- [libsecret Collection.search_sync](https://gnome.pages.gitlab.gnome.org/libsecret/method.Collection.search_sync.html)：
  可以限定 collection 搜尋，`UNLOCK` 才要求解鎖。本實作只搜尋即時 Locked=false 的 collection，不用 `LOAD_SECRETS`。
- [KeePassXC Service.cpp](https://raw.githubusercontent.com/keepassxreboot/keepassxc/develop/src/fdosecrets/objects/Service.cpp)：
  `unlockBeforeSearch` 設定下，全域 SearchItems 可以自行打開解鎖對話框，並不經 Prompt.Prompt；
  因此單憑 Prompt monitor 沒有呼叫，不能推論任意 provider 都沒有 UI。此實作避開全域搜尋。

## 實測與推論

- 私人 gnome-keyring 中，已解鎖 collection 可透過 libsecret session encoding 與直接 CreateItem 保存及讀回。
  precheck 後鎖住 collection 的競爭情況會回報失敗，獨立 dbus-monitor 沒有觀察到 `Prompt.Prompt`。
- provider 重啟後舊 session 不應重用。以 GetNameOwner 偵測新 owner，重新 open proxy，合成秘密可再次讀取與保存；
  probe 不直接重設 production Vault，使用者資料與桌面 bus 不參與測試。
- libsecret 舊 service 的 collection callbacks 尚未完成時釋放 proxy 曾出現 GLib critical；保留舊 proxy 至 Vault 結束後，
  相同 restart probe 無警告。這是此次 Pi runtime 的證據，不代表所有 libsecret 版本皆存在同一問題。
- 多個 collection 可同時有同 attributes 秘密。canonical 讀取使用持久 default 的 collection 搜尋；
  不能假設全域 search 的第一筆正確，也不能依靠 item object path 一定巢狀在 collection 下。
- 真 probe 改用 collection 搜尋後，proxy 的舊 Locked／secret 快取曾允許讀取鎖定前的 token。
  即時 Properties.Get Locked 與新 GetSecret／session decode 後，相同未手動刷新快取的鎖定測試通過。
  外部更新合成 token 後也可立即讀到新值，不依賴主迴圈處理 cache 通知。

## 驗證界線

已驗證合成 gnome-keyring；沒有完整驗收 KWallet／其他 Secret Service provider、使用者重開機或正式 Google OAuth。
Secret Service 規格是 draft；此實作使用既有 CreateItem／Delete／alias／session 介面，沒有聲稱完整規格相容性。
