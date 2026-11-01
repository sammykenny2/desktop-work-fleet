export default {
  // Grid and groups
  'errors.core.gridInvalid': '格局最多 3 列、4 欄、9 區，且必須容納所有群組。',
  'errors.core.slotsInvalid': '每個群組必須有一個獨立區域；空區不會建立群組。',
  'errors.core.groupLimit': '最多可建立九個群組。請先整理現有群組。',
  'errors.core.groupOverflow': '同步帶來超過九組；資料保留，請先整理群組。',
  'errors.core.groupNameRequired': '請輸入群組名稱。',
  'errors.core.groupUpdated': '群組已更新，請重試。',
  'errors.core.groupsChanged': '群組已變更，請重新開啟設定或排列。',
  'errors.core.groupPendingSync': '群組資料尚待同步。',
  'errors.core.myGroupMissing': '屬於我的群組已不存在。',

  // Group merges
  'errors.core.groupCycle': '群組合併產生循環，請先處理群組衝突。',
  'errors.core.groupDeletedNoRecipient': '群組已刪除且沒有接收群組。',
  'errors.core.groupRedirectSelf': '接收群組不能再導回自己。',
  'errors.core.mergeSameGroup': '請選擇另一個接收群組。',
  'errors.core.mergeGroupsMissing': '請選擇仍存在的來源與接收群組。',
  'errors.core.mergePlanStale': '預覽後群組、便箋或未保存的修改已變更，請重新預覽再合併。',

  // Shortcuts
  'errors.core.shortcutNotText': '快捷鍵必須是文字。',
  'errors.core.shortcutKeysInvalid': '使用 Ctrl／Alt／Meta 搭配字母、數字或 F1–F24，可加 Shift。',
  'errors.core.shortcutSettingsInvalid': '快捷鍵設定無效。',
  'errors.core.shortcutTargetMissing': '快捷鍵的目標群組已不存在。',

  // Data format
  'errors.core.schemaUnsupported': '資料格式版本不受支援；原資料仍保留。',
  'errors.core.kindUnknown': '未知的資料種類。',

  // Notes
  'errors.core.contentInvalid': '便箋需要文字及格式。',
  'errors.core.noteUpdatedElsewhere': '卡片已由另一個操作更新；保留目前修改與轉組意圖。',
  'errors.core.conflictUnresolved': '這筆資料有多個版本，請先處理衝突；目前修改仍保留。',
  'errors.core.noteUpdateForbidden': '卡片更新不可修改身分、版本或群組。',
  'errors.core.noteFlagInvalid': '卡片狀態必須是布林值。',
  'errors.core.noteDuplicate': '卡片身分已存在，請另存副本。',
  'errors.core.deletedNoteChanged': '刪除區卡片已變更，請重新載入。',
  'errors.core.moveIntentHandled': '這筆轉組意圖已處理。',

  // Drafts
  'errors.core.draftRevisionCycle': '群組版本關係無效，修改尚未保留。',
  'errors.core.savedDraftMissing': '找不到要保存的修改。',
  'errors.core.draftIdInvalid': '編輯身分無效。',
  'errors.core.unsavedNoteMove': '這張便箋尚未保存。請先保存，或在編輯器裡選擇群組。',

  // Versions and conflicts
  'errors.core.localHistoryIncomplete': '本機版本歷史不完整，資料保留，請先恢復來源。',
  'errors.core.revisionIdDuplicate': '版本身分重複，尚未保存。',
  'errors.core.parentMissing': '找不到完整的父版本，尚未保存。',
  'errors.core.resolutionForbidden': '衝突決議不可修改身分或版本。',
  'errors.core.resolutionStale': '預覽後版本已變更，請重新比較再決定。',
  'errors.core.chosenRevisionMissing': '找不到完整的所選版本。',

  // Sync
  'errors.core.sourceIdRequired': '需要明確的來源身分。',
  'errors.core.sourceMismatch': '不同帳號或來源必須使用獨立工作空間。',
  'errors.core.sessionStale': '來源連線已結束或帳號已變更，舊回應未寫入。',
  'errors.core.syncTimeInvalid': '同步完成時間無效。',
  'errors.core.syncFileChanged': '原有同步檔案已被修改，資料仍保留，請處理來源完整性。',
  'errors.core.syncFileRemoved': '原有同步檔案已移除，副本仍保留。',
  'errors.core.pendingRevisionMissing': '找不到待同步版本。',
  'errors.core.outboxMissing': '這筆版本已同步或不在待送清單。',
  'errors.core.uploadRevisionMismatch': '待同步檔案與不可變版本不符。',
  'errors.core.attachmentAddress': '附件必須以內容校驗值定址。',
  'errors.core.retryMismatch': '重試的檔案內容與原始操作不符。',
  'errors.core.fileIdCollision': '來源配置了已使用的檔案身分，尚未上傳。',
  'errors.core.uploadResponseMismatch': '上傳回應不屬於目前操作。',
  'errors.core.cursorInvalid': '同步游標無效。',
  'errors.core.cursorStale': '已有更新的同步進度，請重新取得游標。',
  'errors.core.initializationChanged': '初始化資料已變更，請重新同步。',
  'errors.core.initializationPlanChanged': '初始化計畫已變更，請重新同步。',
  'errors.core.resetJobMismatch': '重設工作不屬於目前來源。',

  // Restore
  'errors.core.restorePlanRequired': '需要有效預覽及原子還原儲存介面。',
  'errors.core.restoreCancelled': '還原已取消，現有資料未變更。',

  // Layout
  'errors.core.layoutChangedPlain': '版面已變更。',
  'errors.core.layoutChangedByOther': '版面已由另一個寫入者變更。',
  'errors.core.layoutChangedRetrySync': '版面已變更，請重試同步。',
  'errors.core.layoutStorageRequired': '需要可靠的版面保存介面。',
  'errors.core.layoutSettingUnknown': '未知的版面設定。',
  'errors.core.visibilityInvalid': '顯示設定必須是布林值。',
  'errors.core.mainViewUnknown': '未知的主畫面檢視。',
  'errors.core.noteSettingUnknown': '未知的卡片顯示設定。',
  'errors.core.layerUnknown': '未知的常駐層級。',
  'errors.core.colorUnknown': '未知的群組顏色。',
  'errors.core.opacityInvalid': '不透明度必須介於 30% 到 100%。',
  'errors.core.noDisplay': '沒有可用顯示器。',
  'errors.core.placementMissing': '找不到卡片位置。',
  'errors.core.positionInvalid': '卡片位置無效。',
  'errors.core.paperSizeInvalid': '卡片尺寸必須大於零。',
  'errors.core.arrangePlanStale': '預覽後資料或版面已變更，請重新預覽。',
  'errors.core.resizeNotAllowed': '本次未允許改變卡片尺寸。',
  'errors.core.undoMoveNeedsSource': '轉組復原需由資料來源檢查版本。',

  // Stack and spread
  'errors.core.formationUnknown': '未知的排列方式。',
  'errors.core.scopeRequired': '請指定群組或全部。',
  'errors.core.placementInvalid': '卡片尚無有效位置。',
  'errors.core.measurementMissing': '需要 renderer 量測每張卡的摘要帶高度。',
  'errors.core.formationCapacity': '可見桌面放不下這次排列；原版面保持不變。',
  'errors.core.groupNoDesktopNotes': '這個群組沒有桌面便箋，請在主畫面管理顯示卡片。',

  // Adjust
  'errors.core.busy': '正在保存，請稍候。',
  'errors.core.adjustScopeUnknown': '未知的調整範圍。',
  'errors.core.scopeNoDesktopNotes': '這個範圍沒有桌面便箋，請在主畫面管理顯示卡片。',
  'errors.core.outsideAdjustScope': '此卡不在調整範圍。',
  'errors.core.quickMoveOff': '這張便箋目前不能用這種方式移動。',
  'errors.core.quickEditOff': '這張便箋目前不能用這種方式開啟。',
  'errors.core.readOnlyEdit': '來源是唯讀，無法編輯。',
  'errors.core.readOnlyMove': '來源是唯讀，無法轉組。',
  'errors.core.dragActive': '已有拖曳操作。',
  'errors.core.dragStartInvalid': '無效的拖曳起點。',
  'errors.core.dragPointInvalid': '無效的拖曳位置。',
};
