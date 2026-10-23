# ADR-018: Single workspace authority and Windows desktop surface integration

## Status

2026-10-24: the maintainer had the phone layout follow: its "+" also floats above the status row, which spans
the width, instead of beside the status. On every width the "+" keeps 16 px above the row and rises with it when a
long status wraps.

2026-10-23: the maintainer settled the main window's hierarchy on the phone's: the top bar names what is shown, a group
or a search through every group (the title then reads "Search results in all groups"), and ends with search; the
view bar below chooses how it is shown. Capture adds to one group, so it left the top bar for the floating "+" over
the notes on every screen, and shows only while the selected group's To do notes are on the board or in the list:
not under another filter, during a search, or on the canvas or layout map of every group. Quick capture first shows
the target group's To do on the board or list and ends a search; a saved new note shows and remembers its group.
A Capture button at the top of the sidebar, as in Gmail, was rejected: there it is global and ignores the selected folder.
Later that day the maintainer gave the status row back its whole width under the notes, conflicts at its left and the
passing status at its right, and moved the "+" up above it; the phone layout keeps the "+" beside its status. Board
papers no longer stretch with the window, which drew a narrow window's papers larger than a wide one's: each is the
240×240 square of a new desktop paper, and the width only changes how many fit in a row. The phone layout, at 640 px
and narrower, keeps two columns across, so a desktop window narrowed that far still stretches them, and between 641
and about 730 px one column fits.

2026-10-17: the user found the horizontal list hard to match to the notes on the desktop, and chose to make the
board the main window's default:
a grid of square papers shows the current group, with the same paper colour and title band as the desktop papers;
the list becomes compact rows, one note per row.
The two are switched at the right of the filter bar; the choice is stored as `mainView` in this device's layout
(unset means the board), and phones offer both.
The third option on desktop hosts is still the layout map stub, and in the browser preview the original canvas;
these two last only for the current session, and choosing them returns to To do.
The board grid reflows with the window width (since 2026-10-23 only the number of columns above the phone layout; the papers keep one size)
and does not represent desktop coordinates; the main window still does not mirror the desktop.

2026-10-06: the user decided that once native desktop scenes are connected, the main window no longer redraws the
notes in the top-left of the primary display as a 1:1 crop;
the default is the list, and the other view is a scaled-down layout map of all displays (for now only a stub and
a blank canvas); notes are moved on the real desktop.
The browser preview has no desktop scenes, so the original canvas remains the only desktop. The To do filter is no
longer renamed "Desktop" with the view.

2026-10-05: [ADR-030](030-windows-explorer-wallpaper-layer.md) added a third wallpaper scene and Explorer
attachment,
replacing the two layers below and the original limit that Windows offers no wallpaper layer; the single authority
and the transport policy stay.

Accepted, 2026-10-04. Adopts shared command and draft coordination and the Windows presentation wiring.
It does not mean global shortcuts, display hot-plugging, other platforms or full desktop acceptance are done;
current status is in [PROGRESS.md](../../PROGRESS.md).

## Context

The main window already owns the Workspace, the layout and the SQLite adapter; desktop surfaces need to show the
same cards and send gestures and text.
If every WebView opened its own Workspace, stale drafts and diverging operation state would appear even though the
native CAS blocks races.
Card text can be larger than one IPC message, so desktop editing cannot be limited to short strings, and arbitrary
storage methods cannot be exposed.

## Decision

- The main window stays the only Workspace / InteractionController. The authority in `src/desktop` sends fixed
  commands into the existing controller;
  scenes only receive the projection and never get history, the outbox, sync cursors, raw attachments or
  credentials.
- On Windows each display uses two scenes, desktop and floating, each reusing ADR-017's complementary native
  windows.
  `DesktopCoordinator` manages in-memory frame and command mailboxes, and scenes cannot call the main window's
  storage or backup bridge.
  They load the fixed `/desktop/index.html` and block other documents, child frames, remote resources and
  downloads.
- A frame is limited to 128 MiB and a text command to 16 MiB; IPC reuses 256 KiB chunks and SHA-256.
  A read-only lease points to the same finished bytes, so publishing a new frame never changes an old frame that is
  still being read.
  The frame buffer is limited to 320 MiB and the command buffer to 64 MiB, 384 MiB in total; this is not a memory
  limit for the whole browser process.
  Exceeding a limit is clearly reported and content is not truncated; the main data can still be reached from the
  management entry.
- Session and view UUIDs, a monotonic serial per view and receipts for the last 256 results stop old windows and
  duplicate commands from writing.
  Expired results are not executed again. A drag is also bound to a unique generation that the controller creates;
  a reused pointerId does not gain the rights of an earlier gesture.
- Ordinary commands and main window actions share one execution sequence; draft writes use a separate sequence and
  quota.
  An ordinary command first waits for drafts received before it was called and then checks the edit generation; the
  last write of a flush is never queued behind the exit command that waits for it.
- Each save of in-place text must receive a native durable ack before the sequence advances. When the reply is
  unclear, the string at that moment is kept, the same sequence is retried first,
  and later input is sent afterwards. Switching windows first freezes and saves the original window, then takes
  over the last text; editing the same card again reuses its draft.
- Closing first rejects ordinary scene commands, finishes the last draft, then seals new commands, waits for work
  already accepted, and keeps editing frozen until native destruction.
  Input is restored only if closing fails. When a scene is lost, flush waits are released first, then the accepted
  draft lane is awaited until written to disk, and only then does the main window take over the latest draft.
- Windows coordinates use one logical unit based on the primary display's DPI: physical coordinates divided by
  referenceDpi/96. Each applied display change takes referenceDpi from the new primary display, as a restart would
  ([ADR-020](020-windows-display-lifecycle.md)); placements keep their logical values.
  Each display is covered explicitly with SetWindowPos over its physical bounds; the WebView ZoomFactor is
  referenceDpi/monitorDpi,
  and input rects are first converted to WPF logical coordinates and then by ADR-017 into native pixels. The work
  area is used, and resizing the management window does not change the layout.
  This choice keeps coordinates continuous across displays and papers pixel-consistent; the perceived font size on
  displays with different DPI still needs verification on real hardware.
- When Windows offers no wallpaper layer, a clear hint says the desktop layer is used instead, and the original
  preference is kept. Ten groups or long names brought in by a source merge still show their content;
  the nine-group limit only applies to creation and formation and is not a reason for the native side to reject a
  whole frame.

## Consequences

### Positive

Several surfaces share one transaction and draft authority; the data-saving boundaries of retries, hand-over, lost
scenes and closing can be tested directly.
Existing attachments, backups and full editing are still provided by the main entry, and scenes do not need OS
storage capabilities.

### Negative

The full projection is transferred for now; continuous dragging with many Markdown cards has not been load-tested,
and multiple displays add WebViews.
A failure of the main window process ends the desktop session; text without a durable ack is not claimed as
saved.
The display topology is currently built at startup; plugging and unplugging, DPI changes and native shortcut
integration are handled in separate slices.

### Neutral

The browser preview keeps its original single-view IndexedDB mode; this slice adds no listener, runtime package or
external source code.

## Alternatives Considered

### Each surface opens its own Workspace

This would reuse the full main window initialization, but drafts and interaction state would diverge and CAS
rejections would be frequent; rejected.

### Scenes get the native storage bridge directly

One less forwarding step, but every presentation document would gain main workspace / vault capabilities, and no
single controller sequence could be built; rejected.

## 2026-10-09 revision: drag completion and the update order of attached frames

The reply to `pointer.up` / `pointer.cancel` first waits for the main window to publish the current geometry.
A scene's refresh call shares the same in-flight download and the following update, and the preview is kept after
release
until the latest frame has downloaded and native has applied it, so an old projection never pulls the card back to
its original position for a moment.

On Windows, `scene.info` reports an optional `prepareFrames`; after downloading, the scene first calls
`scene.prepare`,
and native validates the sequence and topology. If the paper geometry of an Explorer-attached surface changes, the
old surface is hidden first,
then the renderer is allowed to remove or move notes, and afterwards the new region is shown through the existing
`scene.applied`.
This avoids drawing a blank WebView background in the old opaque region first; after hiding or releasing, the
original Explorer parent is asked to redraw.
Other platforms that do not report this capability never call the new method; the wallpaper settings, note
content, geometry saving rules and IPC limits do not change.
The root cause of the white ghosting still needs confirmation with a new package on real hardware; the flow after
this fix and the added regression tests have not been run.

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [ADR-017](017-windows-composition-surface-and-input.md)
- [Windows scene transport and coordinate research](../research/2026-10-04-windows-desktop-coordination.md)
- [Desktop channel contract](../../contracts/desktop-scene.d.ts)

Decision made: 2026-10-04.
