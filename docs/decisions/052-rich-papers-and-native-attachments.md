# ADR-052: Note formatting and native attachment thumbnails and opening

## Status

Accepted, 2026-10-17. The user asked for attachment thumbnails, double-click to open, H1–H6 CSS and code coloring;
ticking checklists directly on the desktop was explicitly excluded, with no version bump and no release.
Revised 2026-10-23: the maintainer included desktop checklist ticking (SPEC-003, 2026-10-23 addendum): papers that
take clicks send `card.check` with the revision they drew and the step index, and the main window saves it as a new
revision.

## Context

Desktop notes already parsed GFM, but had only simple H1/H2 font sizes and no code coloring.
Attachments are stored in the account-partitioned database and take part in the existing sync and backup; the desktop
projection used to carry only the attachment count, so attachments could not be used directly.
ADR-009's rule of never running raw HTML/SVG and ADR-018's single-authority boundary must be kept.

## Decision

- The desktop, the main window and the editor preview share one CSS: the six heading levels shrink in order, and code
  keeps its indentation and scrolls horizontally inside its block.
- Highlight.js is pinned at 11.12.0/BSD-3-Clause, only the common language set is bundled, and no CDN is loaded.
  Only explicitly named, supported languages are colored; unknown or unnamed languages, and any single block over
  20,000 characters, stay plain text.
  A note over 100,000 characters is not colored; each render colors at most 12 blocks and 40,000 characters in total;
  summaries in the main list are not colored.
  The generated spans are cleaned again by DOMPurify, and at most 64 results are cached; the original Markdown is
  unchanged.
- Attachments show as a thumbnail or system file icon with the file name; double-click or keyboard activation opens
  them in the system default app.
  A failed preview keeps the file name and type icon; when the local bytes are missing it shows that the attachment is
  not downloaded yet, and opening reports that a sync is needed first.
- The desktop projection adds only attachment id/name and never carries raw attachments. Scene commands go to the main
  workspace, which checks the current card revision, visibility and attachment ownership; opening also checks the
  interactive state. Scenes have no storage, arbitrary path or arbitrary program capability; retries reuse the existing
  receipt.
  Thumbnails use two separate, bounded background lanes that never queue behind ordinary desktop operations, draft
  saves or the native storage queue, and a finished preview does not redraw the whole workspace. Switching profile,
  resetting or exiting cleans up that session, and late results never refill the cache.
- The native main document gains `attachment.preview`/`attachment.open`, which read and verify bytes only by an
  attachment id of the current profile.
  The native side creates its own private temporary location and cleans the file name; it never accepts a source path,
  program or command line.
  A preview returns only a PNG of at most 256 KiB, which the front end turns into a blob URL; the desktop CSP allows
  only blob images and still loads no remote images.
- Windows uses the Shell Image Factory; macOS uses Quick Look and NSWorkspace icons; Linux tries GdkPixbuf first, then
  installed desktop thumbnailers that declare a matching MIME type, and finally the system file icon.
  The Exec of a Linux thumbnailer is parsed into argv, never through a shell; which types can be previewed depends on
  what the system has installed.
- What opens is a read-only copy of the attachment, and the original data is unchanged; external edits are not saved
  back or synced automatically.
  Executables, shortcuts and some script types cannot be opened directly. Managed copies are removed on a best-effort
  basis at normal exit; a file locked by the OS or an external program, or an abnormal process exit, may leave copies in
  the temporary directory.
- The existing V1 attachment, sync and backup formats are unchanged, no migration is added, and checklists keep their
  behavior.

## Consequences

### Positive

- The same content has the same formatting on the desktop and in the main window, and attachments can be viewed or
  opened directly.
- No attachment documents run in the app WebView, and no Office/PDF editor is added.

### Negative

- System thumbnails and default apps vary from machine to machine; opening does not include saving external edits back.
- The OS needs a plaintext temporary copy to make thumbnails and open attachments, so it cannot be claimed that data
  never leaves the encrypted database.
- macOS signing/sandbox and each Linux desktop environment still need real-device acceptance, which shared browser
  tests cannot replace.

### Neutral

- This change does not alter the app version, the release workflow, the data schema or checklist operations.

## References

- [ADR-009](009-local-renderer-and-persistence.md), [ADR-018](018-single-owner-desktop-views.md), [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [Highlight.js](https://github.com/highlightjs/highlight.js), [Marked extensions](https://marked.js.org/using_pro)
- [Windows Shell Image Factory](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishellitemimagefactory)
- [Apple Quick Look](https://developer.apple.com/documentation/quicklookthumbnailing)
- [freedesktop thumbnail standard](https://specifications.freedesktop.org/thumbnail/latest/), [GIO default apps](https://docs.gtk.org/gio/type_func.AppInfo.launch_default_for_uri.html)
