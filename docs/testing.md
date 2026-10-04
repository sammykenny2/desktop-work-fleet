# 建置、測試與證據

更新：2026-10-04。新核心證據見 PROGRESS；既有 0.1.0 證據見 [驗證報告](validation/2026-10-03-validation-report.md)。

## 新互動驗收路由

新卡片／群組／formation 的要求見 [SPEC-003 C01–C48](specs/003-desktop-cards-groups-and-formation.md)，
分層策略見 [PLAN-003](plans/003-desktop-interaction-implementation.md)。
`tests/desktop-core.test.js` 驗證 grid、formation／容量、undo、操作 scope、手勢模型、
原子保存失敗、草稿安全退出與 adapter 替換；注入的記憶體 persist 不證明 OS 實際落盤。
測試名稱中的 C 編號只標示模擬語意部分；C16／C35／C40–C43／C46–C47 的原生能力仍需實際 host 驗收。
不能把舊測試綠燈列為新功能通過，也不為文件變更重新啟動舊 Mac probe。
文件工作執行 check_docs.py、git diff --check 與範圍／語意一致性檢查即可。

## 可重現命令

從 checkout 根目錄，無需 pip/npm install：

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.js
node --check src/web/app.js
bash scripts/macos/build-app.sh
python3 scripts/testing/macos_probe.py --web
python3 scripts/testing/macos_probe.py --mode 0
python3 scripts/testing/macos_probe.py --mode 2
python3 scripts/testing/check_docs.py
git diff --check
```

Python 測試與 Mac probe 需允許 loopback listener；某些 coding-agent 執行隔離層需額外允許。
這與被測 App 自身的 App Sandbox 不同：被測 app 一直保留簽署的 Sandbox entitlements。

`macos_probe.py` 只使用 TemporaryDirectory SQLite 與一次性邀請，實際啟動已簽署 App，
設定／快取使用獨立 `WorkFleet-Probe` 子目錄，網頁使用 nonpersistent WKWebsiteDataStore。
會短暫顯示／啟用驗證用編輯視窗。probe 逐項斷言，缺少事件或任一不符即失敗。
不要在其他人正使用鍵盤時執行焦點探針。輸出診斷不含筆記本文或憑證。

資料層測試涵蓋真實 HTTP、並行 writer、response-loss 重試、tombstone、backup/restore、
interrupted restore、配對 race、expiry/reuse、read-only、revoke、輸入限制與 storage failure。
WebKit 測試透過真實 DOM 與 server，傳輸斷線／回應遺失採可控注入。
Node 模型測試涵蓋跨分頁草稿／恢復與本機寫入失敗。

## 手勢測試 helper

```bash
xcrun swiftc -module-cache-path build/module-cache scripts/testing/input-probe.swift -o build/input-probe
build/input-probe
```

helper 先查公開 `CGPreflightPostEventAccess()`，無權限即回報並退出，不修改權限。
有權限時顯示專用測試目標，送出點擊／drag／keyup/down 並回報收到数量；
單獨跑 helper 只驗證測試目標，**不能證明另一個 App 的滑鼠穿透**。
真正桌面／Finder 框選與拖放的步驟及未測狀態記在報告。

## 產物檢查

```bash
codesign --verify --strict 'build/Work Fleet.app'
codesign -d --entitlements - 'build/Work Fleet.app'
otool -L 'build/Work Fleet.app/Contents/MacOS/WorkFleet'
```

最終 staged export 在乾淨目錄以空 module cache 重建成功；13 個 HTTP/SQLite、8 個 JS 與文件檢查也通過。
本版沒有應用第三方 package tree；系統／外部 runtime 與版本見
[runtime inventory](validation/runtime-inventory.json)。正式上架前需對實際封裝重做檢查。

最初 bootstrap／文件檢查歷史已保留於 Git；不能當成上述產品測試的替代證據。
