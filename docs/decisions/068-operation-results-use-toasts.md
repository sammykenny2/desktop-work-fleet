# ADR-068: Operation results use toasts

## Status

Accepted, 2026-11-05, following the maintainer's approval of the notification audit.

## Context

Operation results and failures occupied unrelated settings rows and the main window's status line. A completed Google
reset was read from its durable journal at startup and its old-file cleanup result returned to Data and backup, even
after the work had finished. The same maintenance row sat outside the collection picker. These messages looked like
current problems and changed the page layout. The maintainer asked for transient errors, warnings and information to
use toasts instead.

## Decision

- Shared, session-only notifications carry operation results, recoverable failures and progress. They do not change
  the workspace, backup or sync formats. Durable operation journals remain intact.
- Main-window results, backup/restore results, explicit automatic-backup results, maintenance, setting validation and
  revision/history errors use the same component. Sync keeps its compact account state; detailed failures use a toast.
  Frequent draft persistence and successful scheduled backups stay quiet.
- Ordinary results expire after 5–15 seconds according to text length. Hover, keyboard focus and a hidden page pause
  expiration. Errors, progress and notices with Undo or Retry remain until closed, acted on or resolved.
- A job key updates its existing notice. Repeating the same background failure neither stacks notices nor brings back
  a dismissed one. Closing progress suppresses later phases until the terminal result. A new attempt can report again.
  Each collection has its own keys and an explicit context label.
- A completed reset loaded at startup produces no notification. A job that completes in the current run announces
  once. Recent restore receipts move into a closed-by-default Recent restores disclosure.
- Notifications use a manual popover in the top layer. The host belongs to the topmost modal dialog, moving with dialog
  opening/closing, so notifications remain interactive and escape clipping without making another modal or taking focus.
  A positioned descendant is the fallback when Popover is unavailable. Text is inserted with textContent.
- The Data page places notifications below its header, leaving its export, restore and reset actions reachable. Dialog action rows
  are protected from overlap, also after the dialog scrolls. Progress belonging to a parent operation is hidden while a child requests consent, then
  returns; its Cancel does not compete with the consent dialog's Cancel. A blocking recovery dialog carries its own
  explanation without duplicating the same sync error in a toast. Navigation actions retain the failure until resolved.
- Errors use an alert live region; ordinary results and progress use status. Buttons have localized names. A notice
  never expires under keyboard focus. Closing it can return focus to the previous control.
- Destructive previews, explicit consent and blocking data-preservation/recovery dialogs remain dialogs. Last backup
  time, sync state and version-history coverage remain data. Explanatory help is separate from operation feedback.
- Undo keeps its existing stale-data checks and remains available through unrelated information. A later undoable
  action replaces the earlier Undo notice. Settings cancellation and irreversible-write barriers remain unchanged.

This supersedes status-line placement in SPEC-003 and ADR-061; operation semantics remain as documented there.

## Consequences

### Positive

Settings and phone layouts no longer grow to accommodate transient results. A result remains visible over settings or
a confirmation dialog. Old successful work is not presented as a new event.

### Negative

Toast lifecycle, modal ownership and keyboard focus need real-browser coverage. A long-lived failure must retain a
useful action or be closable; a short timeout is unsuitable for a decision that could lose data.

### Neutral

No native notification permission, operating-system notification service or persisted notification history is added.

## Alternatives Considered

- Keeping page-local messages preserves their stale placement and layout changes.
- Giving every notification a short timeout hides failures and Undo before the user can act.
- A very high z-index alone cannot escape modal-dialog layering or inertness.

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md), [ADR-061](061-unsaved-changes-instead-of-drafts.md).
- [HTML modal inertness](https://html.spec.whatwg.org/multipage/interaction.html#inert).
- [HTML popovers](https://html.spec.whatwg.org/multipage/popover.html).
- [Safari 17 Popover support](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/).
- [Verification](../testing.md).

*Decision made: 2026-11-05*
