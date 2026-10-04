# PLAN-003: 卡片、群組與跨平台桌面互動的實作交接

## Metadata

| Field | Value |
|---|---|
| Status | 實作已授權；執行狀態見 PROGRESS |
| Owner | 專案維護者 |
| Assigned To | 未指定 |
| Reviewer | 實作交付時安排獨立審閱；本輪沒有獨立審閱 |
| 日期 | 2026-10-04 |

## Related Spec

[SPEC-003](../specs/003-desktop-cards-groups-and-formation.md) 是行為與 C01–C48 驗收權威。
[ADR-006](../decisions/006-card-group-and-formation-semantics.md) 接受使用者已確認的產品語意；
[ADR-007](../decisions/007-desktop-scene-and-platform-host.md) 仍是呈現架構提案。
[ADR-008](../decisions/008-portable-interaction-core.md) 接受共用語意核心；後續對話已核准完整 editor／備份／逐卡設定範圍及五平台原生 App、商店準備。
執行狀態只寫 [PROGRESS](../../PROGRESS.md)，不在本計畫維護另一份完成清單。

## Overview

先完成一事一卡、群組／每機版面、formation 與互動命令，
再使同一組行為通過各平台 host 與 Google 同步的實際整合。
不能把計畫簡化成「先做純文字 CRUD，以後才補分組／桌面互動」。
同樣不能因技術不確定就先實作完整 server／PM 模型或另啟 Mac 探索專案。

此計畫補足 [PLAN-002](002-google-drive-notes-mvp.md) 的互動、群組和平台工作；
Google OAuth／衝突／備份仍需要自己的正式契約，舊版範圍裁切不再自動生效。

## Implementation phases

### Phase 1：需求交接及契約，先消除會改變資料模型的歧義

閱讀接手文件、SPEC-003、ADR-006／007 及平台研究。
U 與 D 可按文件開發；Q 只在開始依賴它的工作前詢問。
不重問使用者已接受的最上層與手勢，不把對文件整理的授權變成商店提交或改使用者桌面設定。

交付物：

- Card、Group、SourceRef、DeviceLayout、FormationPlan、InteractionState 的 typed 契約。
- 「一事一卡」與 checklist 子步驟的邊界，不先建多 issue 的 note 容器。
- MoveCardToGroup、MoveCard、ApplyFormation、UndoLayout、ActivateScope、CycleCard、
  BeginEdit／EndEdit 的命令與錯誤型別。
- 共享群組 metadata 的來源／版本／引用策略，並行超過九組的無損處理。
- 明確區分 content revision、device layout revision、當次 drag/session ID。
- 正式 runtime／renderer/host 候選比較：商店、授權、可控疊序、input region、可靠本機保存。

出口：至少可將 SPEC-003 的每條不變量對應到模型或命令，
不要只用 native window API 組合出一套無法脫離平台測試的邏輯。
若需輔助外部實作，依接手規則先向維護者取得位置；不自行搜尋整台磁碟。

### Phase 2：本機核心、formation 與可重現的互動模型

先用 in-memory/fake source 及隔離資料建立共用 fixture，不操作真實 Google 帳號。

交付物：

- 穩定群組 ID、單主要群組、九組限制與完整 grid validation。
- 不改歸屬的普通拖動；Group／All scope 與 active group 分離。
- 穩定 base order＋暫時 z-order 的 comparator，輪播不改 geometry。
- FormationPlanner：不變輸入、不直接寫 native window，輸出位置、基本疊序、resize request、overflow。
- 位置／尺寸同意分開，原子本機 layout transaction 與 undo。
- 初始卡片只安排自己的位置；遠端內容、群組變更不觸發背景 formation。
- 輸入狀態清理、雙擊／拖曳門檻、Esc／IME 邊界與草稿安全退出。

出口：C01–C15、C17、C21–C30、C31–C39、C44 的可模擬部分有可重現預期結果。
這是邏輯測試完成，不是原生分層或穿透完成。

### Phase 3：共同互動場景與可用的 editor 接口

交付物：

- 乾淨的普通畫面／操作畫面；只在操作或拖曳時出現需要的把手、接收標籤與狀態。
- 群組標籤與 Shift 區域 drop target、顏色加文字的候選提示、取消／完成／復原回饋。
- 卡片 action 的同一 MoveCardToGroup 命令；一般 App／手機入口不依賴桌面 geometry。
- 單擊選卡、雙擊編輯與可達的鍵盤／選單入口；文字區與拖曳把手不搶同一事件。
- 裝置本機突出、群組計數、grid 預覽與容量提示。
- 草稿寫入失敗、來源唯讀、同步衝突時的可恢復 UI。

出口：用可操作畫面驗證 C06–C13、C18–C30、C33–C34；
保留 render 截圖／操作記錄，標示一般 App／browser 與真正桌面 host 的差別。
不要重新做已被拒絕的 accordion，也不從外部專案搬設定頁。
內容 editor 的新能力依 Q01 確認；不能用完整純文字產品代替未決內容契約。

### Phase 4：三個目標桌面 host 的正式垂直切片

Windows、macOS、Linux 各自接相同語意 fixture；可依可用機器分批，但不能刪平台目標。
Mac 已有公開 API host 經驗，無需先重做舊探索性 probe。

| 平台工作 | 交付證據 |
|---|---|
| Windows host | 正常層／指定組浮起／退出恢復、拖放、提示不攔桌面、DPI 與 capture cleanup |
| macOS host | 公開 API＋Sandbox、一般 App 上方、拖拉轉組／編輯、返回原層與焦點 |
| labwc／Wayland host | layer-shell 能力、renderer 自管同層疊序、input region／configure／重繪、快捷鍵替代入口 |
| 各平台共通 | C16、C35、C36、C40–C43、C46–C47 的實際桌面證據 |

證據必須記 OS/build、compositor（Linux）、CPU、螢幕數／縮放、backend／封裝、測試方式。
逐項區分 pass、fail、not-run、unsupported；不以 API 呼叫成功當使用者畫面通過。
多螢幕需要額外設備時記為未測，先完成單螢幕共用行為，不在缺設備時假裝完成。
不擅自改 TCC、全域快捷鍵、compositor 設定或重啟使用者桌面工作階段。

出口：正常→群組操作→輪播→轉組→編輯→結束穿透的完整路徑，
以及取消／保存失敗／焦點離開的行為可在宣稱支援的環境重現。
不宣稱所有 GNOME／X11／其他 Wayland 都已支援同一原生呈現路徑。

### Phase 5：Google、多 client 與備份整合

依 PLAN-002 的來源與同步契約實作，不把原型 Python server 作為 1.0 常駐依賴。
群組與卡片內容需要同步；每機 layout、interaction scope 不串到別台機器。

交付物：

- 兩 client 的相同 cardId、groupId、不同 DeviceLayout；A formation 不移 B 版面。
- 遠端新增落在本機群組區域，不重排舊卡；已有位置的遠端轉組不自動召回。
- 轉組與改文／刪除／群組刪除並行時的衝突保存與重試去重。
- 裝置登出／帳號切換清掉暫時操作，隔離草稿、layout 與背景回應。
- 備份 schema 修訂納入群組／引用及已確認內容能力；Q02 確認後決定版面及還原模式。
  不能直接凍結沒有 groupId／群組資料的 SPEC-002 舊草案。

出口：C29–C39、C44、C48 的真實整合部分有證據；
mock/fake source 不冒充 Google 跨平台 client ID 存取成功。

### Phase 6：發佈與接手材料

- 按已確認的版本節奏交付 Windows/macOS/Linux，保留 Apple／Google 自有 App 目標。
- 本次亦交付 iOS／Android 原生 App 與商店提交準備，沿用共用資料命令，不以桌面操作手勢替代手機 UX。
- 對實際 package 列授權／轉遞依賴、簽章與商店配置，不從原 repo 的 MIT 推導全部依賴可直接使用。
- 最終操作文件要與快捷鍵註冊結果、Linux backend、可用層級一致。
- 保存 C01–C48 的證據映射與已知限制，執行狀態回寫 PROGRESS。
- 商店核准、真正跨裝置同步及原生桌面行為各自有門檻，不互相代替。

## Files to create or modify

以下是邏輯位置建議，實際檔名／語言隨 runtime 決定，沒有宣稱這些模組已存在：

| 邏輯範圍 | 交付物 |
|---|---|
| contracts/cards、groups、layout、interaction | typed schema、commands、capabilities、fixture |
| src/core | shared card/group、drafts、conditional transfer、outbox |
| src/layout | formation planner、device layout store、undo |
| src/interaction | scope/focus、gesture lifecycle、selection/edit policy |
| src/renderers | common scene、card/editor presentation、target highlights |
| src/platforms | Win/macOS/Linux host、keyboard／pointer／monitor adapters |
| src/sources | Drive/file source、group metadata、future source interface |
| tests | semantic／fault／renderer／native integration acceptance |
| docs | 決策、使用者操作、證據、授權與發佈狀態 |

不能因目錄示例而先建立大量空 class／bridge 或讓每張卡各自啟動同步。
既有 prototype 與報告保留，來源遷移需有明確轉換方案，不抹掉其已知 Windows restore 問題。

## Testing strategy

| 層 | 真正要驗的行為 |
|---|---|
| 模型／命令 | grid 邊界、歸屬不因移位改變、暫時 z 不污染 base、資料與 layout 不串台 |
| 規劃器 | 所有參與卡保留、尺寸授權、可容納時摘要可見、穩定重算、undo |
| 故障／並行 | draft fail、取消、捕捉中斷、目標刪除、同卡轉組競爭、轉組回應遺失 |
| 互動畫面 | click/drag/dblclick、Shift 切換、標籤目標、文字選取與 IME、微亮狀態一致 |
| 原生 host | 實際分層、桌面穿透、焦點與重新切層、縮放與顯示器回復 |
| Source | 真實 Google、多帳號隔離、不同 client ID、backup round-trip |

不得為文件變更重跑整套產品 probe；本輪只做文件連結、UTF-8/LF、差異與語意一致性檢查。
正式行為變更時選擇相應的回歸，別用鏡像實作細節的測試代替使用者結果。

## Risks and mitigations

| 風險 | 必須處理 |
|---|---|
| Q 被默認縮成舊版 MVP | 實作相關能力前明確決定，不重問已確認 U |
| Native window z-order 不可攜 | 可控場景／合成表面；不依賴 Wayland 同層未定義排序 |
| 表面太大攔住桌面 | input region／分表面策略及真實桌面驗收 |
| 微亮與實際提交不一致 | 同一目標解析器、pointer-up 重驗、穩定 groupId |
| 轉組覆蓋遠端本文 | 最小命令＋revision guard，保存雙方意圖 |
| formation 偷偷動別台／別組 | scope 快照與每機 transaction，C07／C08／C37 |
| 尺寸調整偷用永久同意 | 本次預覽選項與 undo；未允許保持尺寸 |
| 原參考位置未知 | 詢問維護者，繼續本 repo 契約與測試工作，不做全磁碟搜尋 |

## Progress log

2026-10-04 建立詳細接手計畫；完成／失敗／尚待工作只記根目錄 PROGRESS.md。
