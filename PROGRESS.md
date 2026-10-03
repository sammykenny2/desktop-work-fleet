# 專案進度

更新：2026-10-03。本檔是本 repo 的執行狀態權威。

## 本輪優先方向

使用者將 1.0.0 收斂為 Google 帳號＋file based 的簡單便箋，第一版不架 local server，
同時要求先考慮異質來源與 renderer。已完成 [Drive MVP 可行性研究](docs/resreach/2026-10-03-google-drive-notes-mvp-feasibility.md)
及 [ADR-004（Proposed）](docs/decisions/004-google-drive-notes-mvp.md)。

已完成 [1.0 分階段計畫](docs/plans/002-google-drive-notes-mvp.md)、
[備份規格](docs/specs/002-portable-backup-and-restore.md) 與
[備份研究](docs/resreach/2026-10-03-appdata-backup-and-restore-design.md)。
規劃基線是 Drive appDataFolder；ZIP＋公開 JSON、快照範圍標示、
預覽後匯入為新便箋、草稿／衝突保留及中斷續傳見 [ADR-005](docs/decisions/005-portable-backup-and-restore.md)。
ADR-004／005 仍為 Proposed，SPEC／PLAN 為 Draft；不代表已實作或已接受所有細節。

接續順序：契約與選型 → 本機核心／備份往返 → Google 同步 → UI 整合 → 選定平台發佈。
尚待確定 1.0 平台發佈範圍、正式 runtime 與同步契約；不再以重做 Mac 探索性 probe 作為下一步。
Google 登入、OAuth 專案、SDK、Drive 寫入與商店配置都尚未實作或操作。
本輪未恢復先前暫停的驗證 goal。

ADR-003 與完整產品架構研究改為 Deferred，保留 PM／自架 server 的後續設計。
本次只更新文件；既有 0.1.0 程式與測試證據保留。
文件檢查：51 份 Markdown、195 個相對連結、UTF-8／LF 與 git diff --check 通過。
本輪沒有執行產品測試或獨立審閱；作者的格式／連結檢查不算獨立審閱。

## 目前交付

0.1.0 可操作驗證版已實作，從 `scripts/macos/start-validation.sh` 建置並啟動。
提供 Sandbox 原生 Mac 展示、WebKit／瀏覽器編輯器與單一 SQLite 權威服務。
原始接手基線為 `8a7da58`；遵照使用者要求直接 commit/push main，不另建分支或 PR。

**尚未達成完整平台驗收**：真實桌面手勢穿透、Spaces／多螢幕／休眠矩陣、真實手機、其他 OS 與商店均有未測項目。
不能把這次可操作版本或自動測試綠燈當成全部疑慮已通過。
詳見 [驗證報告](docs/validation/2026-10-03-validation-report.md)。

## 本次完成

- AppKit 公開 API、ad-hoc 簽章、App Sandbox 與僅 outbound network entitlement。
- 真實 SQLite 更新到桌面，鎖定／不搶焦點政策、解鎖 WebKit 編輯／重新鎖定。
- 一般／圖示上方／圖示下方展示模式與可達選單列入口。
- 文字快速新增、待辦、Inbox 群組、Todo／In Progress／Done、完成／刪除／還原。
- 持久化、revision 競爭、operation 重試去重、tombstone、草稿保留／副本／匯出。
- online backup、全新路徑 restore、更換 epoch／撤銷舊裝置、還原中斷保護。
- 短效一次性 QR 邀請、viewer/editor 權限、裝置撤銷；非 loopback 強制 TLS。
- 13 個資料整合測試、8 個草稿測試、真實 WebKit 12 個操作斷言及 Mac probe。
- 獨立唯讀 review，修正資料遺失／來源切換／恢復邊界並複核。
- 可重現建置／啟動、API／安全／部署文件、runtime inventory 與 notices。

## 限制與剩餘工作

- Windows 唯讀檢查：Python 3.13.7 下資料測試 12 通過、1 錯誤；restore 對 rb handle 執行 fsync 失敗（Bad file descriptor）。8 個 Node 草稿測試通過。這不是 Mac 結果的撤銷；Windows restore 仍待修正。

- 真實點擊、雙擊、桌面框選、圖示拖拉：事件注入權限為 false，尚未取得通過證據。
- 模式已啟動／驗證旗標；Finder 圖示層次與全桌面行為仍需人工觀察。
- Spaces、Show Desktop、Mission Control、Stage Manager、全螢幕、多螢幕／拔插、休眠喚醒。
- 真實手機掃碼與 LAN／外網 HTTPS；瀏覽器 service worker 離線冷啟動。
- Windows MSIX、Linux 具體 compositor、Apple Silicon、iOS／Android 原生 package 與商店提交。
- 每機內容突出、多個獨立便箋視窗、真實日常 UX 回饋與大資料效能。
- production 網路 hardening、Keychain／本機內容加密及正式散布產物授權稽核。

## 歷史基礎

Bootstrap minimal、backlog 需求、六份研究、獨立開發邊界與接手計畫已保留。
沒有搬入其他便箋應用大量程式碼／資產，也沒有加入 Agent 執行狀態流程。
