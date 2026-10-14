# 自動備份檔案能力與替換競爭

查閱：2026-10-04。決策見 [ADR-014](../decisions/014-durable-automatic-backups.md)。

## 外部證據

[WHATWG File System Standard](https://fs.spec.whatwg.org/#locator) 將 handle 連結至包含 root／path
的 locator，並明列檔案可由規格之外的應用修改；如何反映外部變化取決於實作。
這不能被當成永久 inode／檔案身分或條件式覆寫／刪除的承諾。

[Chromium remove() 出貨討論](https://groups.google.com/a/chromium.org/g/blink-dev/c/tESXuOfqQMQ)
說明直接以 handle 刪除及排他鎖；它沒有提供本產品所需的「期望 bytes／原實體」compare-and-delete
契約，因此不因方法名稱是 handle.remove 就推定替換競爭已解決。

## 本機實驗與推論

獨立 Edge／OPFS 合成探針在空檔檢查與 durable ownership 保存之間換成同名外來內容，
舊 handle 的 isSameEntry 仍可為 true，後續 writable 保存覆蓋替換檔。
另一探針在 hash 核對與 removeEntry 之間換檔，按名稱刪除仍命中替換檔。
這是受控合成檔案，未操作使用者私人資料。

因此移除瀏覽器自動建立／清理的實作，capability 明確 unavailable；手動選定目的檔保存仍保留。
這項結論只關於本產品自動檔案契約，不能推論所有 FSA 用途不安全。

## 驗證界線

自動 scheduler probe 用真 IndexedDB journal、共用 Workspace／ZIP 與合成原子 FileHost，
可驗證 reservation／ack／重啟／設定／UI／取消；不能證明 OS 檔案、vault 或五平台原生能力。
原生 host 必須另提供 create-only 與身分綁定清理的故障證據，不能用 pathname 前置檢查替代。
正式進度僅記 [PROGRESS](../../PROGRESS.md)。
