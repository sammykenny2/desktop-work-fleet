export default {
  // Local storage
  'errors.storage.storageBlocked': 'Another window is using an older data version. Close it and try again.',
  'errors.storage.storageAborted': 'Saving on this device was interrupted.',
  'errors.storage.lockUnavailable': "This browser doesn't support a safe single-writer lock. Use the native app or a newer browser.",
  'errors.storage.profileInvalid': 'Invalid account partition.',
  'errors.storage.workspaceInvalid': "The local data's ID or version is invalid.",
  'errors.storage.staleWriter': 'The data changed in another window. Your changes are kept; reload, then save again.',
  'errors.storage.revisionGap': "The versions saved on this device aren't consecutive.",
  'errors.storage.recordTransactionInvalid': 'The local record transaction is invalid. Your saved data is unchanged.',
  'errors.storage.incompatibleLocalData': 'This device has data from an older format. Keep it or explicitly reset this local profile before continuing.',

  // Attachments
  'errors.storage.attachmentListRequired': 'A complete attachment list is needed.',
  'errors.storage.attachmentListInvalid': 'The attachment list format or count is invalid.',
  'errors.storage.attachmentBytesRequired': 'Complete attachment bytes are needed.',
  'errors.storage.attachmentIdOrSizeInvalid': 'The attachment ID or size is invalid.',
  'errors.storage.attachmentIdDuplicate': 'An attachment ID is duplicated.',
  'errors.storage.attachmentChecksumFailed': 'An attachment failed its checksum.',
  'errors.storage.attachmentChecksumRestore': 'An attachment failed its checksum. Nothing was restored.',
  'errors.storage.attachmentSaveChecksum': 'The saved attachment failed its checksum.',

  // Native storage and transfers
  'errors.storage.nativeCapacity': 'The data on this device is over the native storage limit. Your current data is unchanged; export a backup first.',
  'errors.storage.profileMismatch': 'Native storage can only access the current account.',
  'errors.storage.transferOrder': 'The native transfer arrived out of order.',
  'errors.storage.downloadSizeInvalid': 'The native download size is invalid.',
  'errors.storage.downloadOrder': 'The native download arrived out of order.',
  'errors.storage.downloadChecksum': 'The native download failed its checksum.',
  'errors.storage.exportTooLarge': 'The file is larger than this device can export.',

  // Share inbox
  'errors.storage.captureListSize': 'The Share inbox list size is invalid.',
  'errors.storage.captureListInvalid': 'The Share inbox list format is invalid.',
  'errors.storage.captureItemInvalid': "The shared content's format or size is invalid. The original is kept.",
  'errors.storage.captureAttachmentInvalid': "A shared attachment's format is invalid.",
  'errors.storage.captureAttachmentsTooLarge': 'The shared attachments are over the total size limit.',
  'errors.storage.captureAttachmentIntegrity': 'A shared attachment failed its checksum. The original is kept.',

  // Google on native hosts
  'errors.storage.googleAccountRequired': "The current workspace's Google account is needed.",
  'errors.storage.googleSessionEnded': 'The Google session ended.',
  'errors.storage.googleCursorInvalid': 'The Google sync cursor is invalid.',
  'errors.storage.googlePageInvalid': 'The Google page is invalid.',
  'errors.storage.googlePageEndInvalid': 'The Google page end point is invalid.',
  'errors.storage.googleListingStateInvalid': 'The Google listing state is invalid.',
  'errors.storage.googleChangeInvalid': 'The Google change format is invalid.',
  'errors.storage.googleFileIdInvalid': 'The Google file ID is invalid.',
  'errors.storage.googleFileMismatch': "The Google file ID doesn't match.",
  'errors.storage.googleUploadMismatch': 'The Google upload result differs from the content.',
};
