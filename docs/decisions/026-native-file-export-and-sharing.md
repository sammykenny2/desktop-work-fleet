# ADR-026: Native file export and phone sharing

## Status

Accepted, 2026-10-05; the code is added, and the Android/Apple native SDKs have not yet been compiled or run.

## Context

Phone WebViews do not guarantee browser blob downloads; in 1.0, attachments, drafts and phone sharing need platform
capabilities.
The main window is still the only data owner; sharing does not change cards, groups or sync revisions.

## Decision

- A host with fileExport intercepts the shared blob download, passes the bytes through a bounded transfer with SHA-256 and
  encrypted staging, then saves them with the native file picker. The renderer only passes the file name and the operation
  and cannot specify native paths or URIs.
- Android uses ACTION_CREATE_DOCUMENT; iOS uses UIDocumentPicker; macOS uses NSSavePanel.
  Cancelling the save returns "not completed"; export does not replace the confirmed backup flow of SPEC-002.
- The phone editor saves the draft before sharing. Text up to 128 KiB is shared as system text, and larger text is shared as
  a Markdown file; attachments share only the file bytes, and HTML/SVG is not executed in the main document.
- Android FileProvider serves only cache exports and grants the receiving app a temporary read-only URI permission.
  Limits are 32 files/256 MiB; the next share cleans up the app's own temporary files older than 24 hours.
- The iOS system activity sheet supports the iPad popover; temporary files use complete file protection and are cleaned up on
  completion, cancellation, timeout or account switch. An open share sheet does not mean that the recipient received anything.

## Consequences

Attachment and draft export on phones and the Apple desktop has a native path; Android and iOS have entry points for sharing
text and a single attachment.
The native runtime, provider differences and real-device sharing have not been run. Receiving external shares and the iOS
Share Extension are still to be implemented; this slice does not mean that the full phone or store delivery is complete.

## Alternatives Considered

Handing the blob URL to an external browser cannot provide the in-app bytes. Exposing a filesystem path or the whole cache
directory exceeds the permission needed to share a single file. Treating a successful export as a safe backup confirmation
would confuse the save guarantees of the two operations.

## References

- [ADR-022](022-android-native-host.md), [ADR-023](023-apple-native-host-and-scenes.md).
- [Android file sharing](https://developer.android.com/training/secure-file-sharing).
- [Apple document export](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller/init(forexporting:ascopy:)).

*Decision made: 2026-10-05*
