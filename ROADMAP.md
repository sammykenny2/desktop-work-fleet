# 開發方向

更新：2026-10-04。此文件只定順序，執行狀態以 PROGRESS.md 為準，不承諾發佈日期。

1. **最新需求與契約**：依 SPEC-003 的 U／D 凍結卡片、群組、每機版面、命令與來源邊界；
   只對開始依賴的 Q 提問。選型先面對三平台疊序／輸入能力與授權。
2. **本機核心與互動模型**：一事一卡、九組 grid、顯式 formation、尺寸同意、undo、
   普通拖曳與轉組分開、穩定輪播及可靠草稿；用隔離 fixture 驗證。
3. **可用呈現與平台 host**：乾淨 UI、群組／全組操作、提示與 editor，
   在 Windows、macOS、目前可測 Linux backend 接同一套驗收案例。
4. **Google 與跨裝置整合**：登入、帳號隔離、共享卡片／群組及可靠同步，
   每機 geometry 不串台；不新增自家便箋 server。
5. **備份範圍與完整往返**：按使用者確認的內容／版面／還原需求修訂 SPEC-002，
   群組與引用不可漏；舊草案不能直接作為排除功能的依據。
6. **平台發佈**：最低版本、安裝包、簽章／商店、授權、真實同步與桌面功能回歸各自列證據。
7. **後續擴充**：其他 source／renderer、PM／檢視與多歸屬；保留既有研究，不強迫首版導入。

詳細實作交接見 [PLAN-003](docs/plans/003-desktop-interaction-implementation.md)，
來源／Google 工作續接 [PLAN-002](docs/plans/002-google-drive-notes-mvp.md)。
[ADR-006](docs/decisions/006-card-group-and-formation-semantics.md) 是已接受語意，
[ADR-007](docs/decisions/007-desktop-scene-and-platform-host.md) 是技術提案。

Windows/macOS/Linux 是必要桌面目標；手機與桌面同版推出的節奏尚待決定。
某一 host 先整合不代表取消其他平台。使用既有 Mac 經驗，不重啟已暫停的探索 goal。
