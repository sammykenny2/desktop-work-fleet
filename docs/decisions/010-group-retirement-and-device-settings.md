# ADR-010: 群組合併與穩定裝置設定

## Status

Accepted（本機合併命令與設定），2026-10-04。
遠端 revision graph 的合併循環及依賴處理仍屬同步切片，不由本記錄宣稱已完成。

## Context

SPEC-003 Q06 已核准群組刪除／合併必須選擇目的群組並預覽，不能隱含刪卡。
變更群組後，既有草稿、已刪除卡片、快捷鍵及每機格局仍需有有效對象。
單改 group.deleted 會使資料失去可達入口；無條件重設草稿版本則可能覆蓋其他修改。

## Decision

- 同一「合併／移除群組」流程處理空組與有資料的群組；目的必須是另一個仍存在的群組。
  最後一組不能移除。預覽包含活動、完成、封存、刪除區卡片與草稿數量。
- 預覽 fingerprint 固定來源與目標群組版本、所有受影響卡片版本及草稿；
  進入 Workspace 原子提交點時重新驗證，變動則要求重新預覽，不自動接受新範圍。
- 所有卡片只改主要群組及 revision；内容、附件、完成／封存／刪除狀態完整保留。
  舊群組留下 tombstone 與 redirectGroupId，晚到的本機快速記錄沿有效目的群組處理。
  找不到依賴或存在 redirect cycle 時明確報錯，不能猜一個群組或刪資料。
- 草稿的 groupId 與已知純歸屬變更的 baseRevision 同步更新，包括恢復 lineage。
  本機 membershipRebases 只記錄合併產生的純歸屬 revision 邊；晚到 autosave 在
  序列化保存點沿這些邊前進，遇到正文更新即停，保留原本的版本衝突。
  此對照是本機協調資料，不是可攜內容或跨帳號同步授權。
- 群組、卡片、草稿、outbox、版面設定於同一交易提交。保存失敗時三者皆保持原值；
  即使群組尚未取得區域、geometry 沒有變動，也必須執行共享資料交易。
- 所有卡片 geometry 保留；來源群組的區域留空，「屬於我」與快捷鍵轉至目的群組。
  舊的相關轉組 undo 失效並移除；其他 geometry undo 保留。
  合併不是 layout undo，不用「復原排列」重新建立群組，確認介面會先說明。
- 群組區域可交換，ID 與快捷鍵對象保持穩定。排隊的舊設定／新卡配置在原子保存點
  重新核對 group set，防止將已退役群組重新寫回 grid 或本機偏好。
- 快捷鍵採穩定群組 ID 或明確全域動作 ID，允許多個綁定指向同一動作；
  canonical key 重複、無效 modifier、消失的群組會被拒絕。
  預覽僅在目前 browser 視窗接收快捷鍵；原生 host 必須另回報全域註冊成敗。
- 範圍快捷鍵可在 inline 編輯中先保存草稿再切換／退出；CompositionEvent 生命周期、
  子對話框與 Ctrl／Meta 的全選、複製、剪下、貼上、復原／重做優先歸 editor。
  成功選卡或切組後，側欄目前群組與輪播／群組 formation 使用同一目標。

## Consequences

### Positive

- 合併保留所有內容與桌面擺放，未完成草稿仍可安全提交。
- 快捷鍵與群組位置分離，設定失敗不留下部分變更。

### Negative

- Tombstone 與 membership revision 對照增加儲存量，目前不做自動 GC。
- 合併後不能用 layout undo 重建原群組；可建立新群組再明確移動卡片。
- 其他裝置並行合併可能产生循環；同步切片必須保留衝突與依賴，不能略過此驗收。

### Neutral

- 完成狀態不自動移除桌面顯示；桌面會標示完成樣式，清單的待處理 filter 排除完成卡片。
  封存／刪除／明確隱藏才退出桌面集合。

## Alternatives Considered

- 直接刪除群組與全部卡片：違反已批准的不隱含刪卡要求，因此不採用。
- 預覽後按當下全量資料無條件合併：使用者未看過的新資料會被改動，因此不採用。
- 草稿一律換成最新 revision：可能覆蓋正文衝突，因此只沿可證明的純 membership 邊前進。

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [ADR-008](008-portable-interaction-core.md)
- [ADR-009](009-local-renderer-and-persistence.md)

*Decision made: 2026-10-04*
