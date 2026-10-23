export default {
  // Grid and groups
  'errors.core.gridInvalid': 'The grid can have at most 3 rows, 4 columns and 9 regions, and must fit every group.',
  'errors.core.slotsInvalid': "Each group needs its own region; empty regions don't create groups.",
  'errors.core.groupLimit': 'You can create up to nine groups. Tidy up your existing groups first.',
  'errors.core.groupOverflow': 'Sync brought more than nine groups. Your data is kept; tidy up your groups first.',
  'errors.core.groupNameRequired': 'Enter a group name.',
  'errors.core.groupUpdated': 'The group was updated. Try again.',
  'errors.core.groupsChanged': 'Groups changed. Reopen Settings or Arrange.',
  'errors.core.groupPendingSync': "Group data hasn't synced yet.",
  'errors.core.myGroupMissing': 'The group set as yours no longer exists.',

  // Group merges
  'errors.core.groupCycle': 'Merging these groups would create a loop. Resolve the group conflicts first.',
  'errors.core.groupDeletedNoRecipient': 'This group was deleted and has no receiving group.',
  'errors.core.groupRedirectSelf': "A receiving group can't point back to itself.",
  'errors.core.mergeSameGroup': 'Choose a different receiving group.',
  'errors.core.mergeGroupsMissing': 'Choose source and receiving groups that still exist.',
  'errors.core.mergePlanStale': 'Groups, notes or drafts changed after the preview. Preview again before merging.',

  // Shortcuts
  'errors.core.shortcutNotText': 'A shortcut must be text.',
  'errors.core.shortcutKeysInvalid': 'Use Ctrl, Alt or Meta with a letter, a digit or F1–F24, optionally with Shift.',
  'errors.core.shortcutSettingsInvalid': 'The shortcut settings are invalid.',
  'errors.core.shortcutTargetMissing': "The shortcut's group no longer exists.",

  // Data format
  'errors.core.schemaUnsupported': "This data format version isn't supported. The original data is kept.",
  'errors.core.kindUnknown': 'Unknown data kind.',

  // Notes
  'errors.core.contentInvalid': 'A note needs text and a format.',
  'errors.core.noteUpdatedElsewhere': 'Another action updated this note. Your draft and pending group move are kept.',
  'errors.core.conflictUnresolved': 'This item has several versions. Resolve the conflict first; your draft is kept.',
  'errors.core.noteUpdateForbidden': "A note update can't change its ID, version or group.",
  'errors.core.noteFlagInvalid': "A note's status must be true or false.",
  'errors.core.noteDuplicate': 'A note with this ID already exists. Save it as a copy.',
  'errors.core.deletedNoteChanged': 'This note in Deleted changed. Reload.',
  'errors.core.moveIntentHandled': 'This group move was already handled.',

  // Drafts
  'errors.core.draftRevisionCycle': "The group's version history is invalid. The draft wasn't submitted.",
  'errors.core.draftMissing': "This draft can't be found.",
  'errors.core.savedDraftMissing': "The saved draft can't be found.",
  'errors.core.draftIdInvalid': 'The draft ID is invalid.',

  // Versions and conflicts
  'errors.core.localHistoryIncomplete': 'The version history on this device is incomplete. Your data is kept; recover the source first.',
  'errors.core.revisionIdDuplicate': 'This version ID is already in use. Nothing was saved.',
  'errors.core.parentMissing': "The complete parent version can't be found. Nothing was saved.",
  'errors.core.resolutionForbidden': "Resolving a conflict can't change an ID or version.",
  'errors.core.resolutionStale': 'The versions changed after the preview. Compare them again before deciding.',
  'errors.core.chosenRevisionMissing': "The complete chosen version can't be found.",

  // Sync
  'errors.core.sourceIdRequired': 'A clear source ID is needed.',
  'errors.core.sourceMismatch': 'Each account or source needs its own workspace.',
  'errors.core.sessionStale': "The source connection ended or the account changed. The old response wasn't saved.",
  'errors.core.syncTimeInvalid': 'The sync completion time is invalid.',
  'errors.core.syncFileChanged': "An existing sync file was modified. Your data is kept; check the source's integrity.",
  'errors.core.syncFileRemoved': 'An existing sync file was removed. The copy on this device is kept.',
  'errors.core.pendingRevisionMissing': "The version waiting to sync can't be found.",
  'errors.core.outboxMissing': "This version already synced or isn't waiting to be sent.",
  'errors.core.uploadRevisionMismatch': "The file waiting to sync doesn't match its fixed version.",
  'errors.core.attachmentAddress': 'Attachments must be addressed by their content checksum.',
  'errors.core.retryMismatch': "The retried file content doesn't match the original action.",
  'errors.core.fileIdCollision': 'The source assigned a file ID that is already in use. Nothing was uploaded.',
  'errors.core.uploadResponseMismatch': "The upload response doesn't belong to the current action.",
  'errors.core.cursorInvalid': 'The sync cursor is invalid.',
  'errors.core.cursorStale': 'Newer sync progress exists. Get the cursor again.',
  'errors.core.initializationChanged': 'The initialization data changed. Sync again.',
  'errors.core.initializationPlanChanged': 'The initialization plan changed. Sync again.',
  'errors.core.resetJobMismatch': "This reset job doesn't belong to the current source.",

  // Restore
  'errors.core.restorePlanRequired': 'A valid preview and an atomic restore storage interface are needed.',
  'errors.core.restoreCancelled': 'Restore cancelled. Your current data is unchanged.',

  // Layout
  'errors.core.layoutChangedPlain': 'The layout changed.',
  'errors.core.layoutChangedByOther': 'Another writer changed the layout.',
  'errors.core.layoutChangedRetrySync': 'The layout changed. Try syncing again.',
  'errors.core.layoutStorageRequired': 'A reliable way to save the layout is needed.',
  'errors.core.layoutSettingUnknown': 'Unknown layout setting.',
  'errors.core.visibilityInvalid': 'A display setting must be true or false.',
  'errors.core.mainViewUnknown': 'Unknown main window view.',
  'errors.core.noteSettingUnknown': 'Unknown note display setting.',
  'errors.core.layerUnknown': 'Unknown layer.',
  'errors.core.colorUnknown': 'Unknown group color.',
  'errors.core.opacityInvalid': 'The opacity must be between 30% and 100%.',
  'errors.core.noDisplay': 'No display is available.',
  'errors.core.placementMissing': "The note's position can't be found.",
  'errors.core.positionInvalid': "The note's position is invalid.",
  'errors.core.paperSizeInvalid': 'The note size must be greater than zero.',
  'errors.core.arrangePlanStale': 'The data or layout changed after the preview. Preview again.',
  'errors.core.resizeNotAllowed': "Resizing notes wasn't allowed this time.",
  'errors.core.undoMoveNeedsSource': 'Undoing a group move needs the data source to check versions.',

  // Stack and spread
  'errors.core.formationUnknown': 'Unknown arrangement.',
  'errors.core.scopeRequired': 'Choose a group or all.',
  'errors.core.placementInvalid': "This note doesn't have a valid position yet.",
  'errors.core.measurementMissing': "The renderer must measure each note's summary height.",
  'errors.core.formationCapacity': "This arrangement doesn't fit the visible desktop. The layout is unchanged.",
  'errors.core.groupNoDesktopNotes': 'This group has no desktop notes. Choose which notes to show in the main window.',

  // Adjust
  'errors.core.busy': 'Saving. Please wait.',
  'errors.core.adjustScopeUnknown': 'Unknown Adjust scope.',
  'errors.core.scopeNoDesktopNotes': 'There are no desktop notes here. Choose which notes to show in the main window.',
  'errors.core.outsideAdjustScope': "This note isn't being adjusted.",
  'errors.core.quickMoveOff': "This note can't be moved this way right now.",
  'errors.core.readOnlyEdit': "The source is read-only, so it can't be edited.",
  'errors.core.readOnlyMove': "The source is read-only, so notes can't move to another group.",
  'errors.core.dragActive': 'A drag is already in progress.',
  'errors.core.dragStartInvalid': 'Invalid drag start point.',
  'errors.core.dragPointInvalid': 'Invalid drag position.',
};
