# Roadmap

Updated: 2026-10-23. This document only sets the order of work and does not commit to release dates. It is not a status
record: the current state is in [PROGRESS.md](PROGRESS.md) and the history of each version in
[docs/release-notes.md](docs/release-notes.md).

1. **Latest requirements and contracts**: following the U and D items of SPEC-003, freeze cards, groups, per-device
   layout, commands and the source boundary; ask only about the Q items that work starts to depend on. Technology
   choices first face the stacking-order and input capabilities of the three platforms, and licensing.
2. **Local core and interaction model**: one card per thing, a nine-group grid, explicit formation, size consent, undo,
   ordinary drags kept apart from group transfer, stable cycling and reliable drafts; verified with isolated fixtures.
3. **Usable presentation and platform hosts**: a clean UI, per-group and all-group operations, hints and the editor,
   connected to the same acceptance cases on Windows, macOS and the Linux backends that can be tested now.
4. **Google and cross-device integration**: sign-in, account isolation, shared cards and groups, and reliable sync,
   without per-device geometry leaking between devices; no note server of our own is added.
5. **Backup scope and complete round trips**: revise SPEC-002 according to the content, layout and restore needs the
   user confirmed; groups and references must not be missed, and old drafts cannot directly serve as grounds for
   excluding features.
6. **Platform release**: minimum versions, installers, signing and stores, licensing, real sync and desktop feature
   regressions each record their own evidence.
7. **Later extensions**: other sources and renderers, PM and views, and multiple membership; keep the existing research
   without forcing it into the first version.

The detailed implementation handoff is in [PLAN-003](docs/plans/003-desktop-interaction-implementation.md);
source and Google work continues in [PLAN-002](docs/plans/002-google-drive-notes-mvp.md).
[ADR-006](docs/decisions/006-card-group-and-formation-semantics.md) holds the accepted semantics;
[ADR-007](docs/decisions/007-desktop-scene-and-platform-host.md) is a technical proposal.

This 1.0 includes the Windows, macOS and Linux and the iOS and Android native apps, plus store submission preparation;
the scope is in the answered Q items of SPEC-003. Integrating one host first does not cancel the other platforms. Use the
existing Mac experience; do not restart the paused exploration goal.

## 0.3.x

Being scheduled for 0.3.x does not mean a design is approved; these are behaviour ideas, each implemented independently.
On 2026-10-23 the maintainer asked for all of them, in this order: the low-cost items first, then guidance when data
cannot be opened, group transparency, and shortcuts on other Wayland compositors. Each item leaves this list in the
commit that implements it.

Low cost, clear value:

- **Pasted or dropped images become attachments**: files pasted or dropped into the editor become attachments, as the
  file picker adds them; pasted and dropped text stays text. Today attachments can only be added through the file
  picker.
- **Real-world sync check with the main window hidden**: on all three platforms, check whether the WebView throttles the
  20-second Google sync and desktop updates after the main window goes to the tray or menu bar; fix it only if a
  problem is confirmed.
- **Search ranking**: notes whose title, or first line when there is no title, matches come first, then notes matching
  in the first five lines of the text, then the rest, each tier in the existing order. Today it is an unsorted
  substring filter.
- **Ticking checklists directly on the desktop**: when a paper is not click-through, clicking a checkbox toggles its
  completion and saves and syncs it, without entering text editing and without triggering a drag or a double-click edit
  by mistake. While click-through, papers still ignore clicks. The maintainer included it on 2026-10-23, replacing the
  exclusion in the 2026-10-17 addendum of SPEC-003.

Decided on 2026-10-23:

- **Guidance when data cannot be opened**: on every desktop platform, when the local data cannot be opened at start,
  the message names the cause where it can be told apart (damaged, disk full, in use or not permitted, cannot be
  decrypted under this account), shows where the data is with a way to open that folder, and, where starting again
  can help, offers to set the data aside and start with empty data. Setting aside only renames the data folder after
  an explicit confirmation and never deletes it. The confirmation says what comes back: a Google workspace's notes
  return from Drive after signing in, while this device's layout, colours, shortcuts and unsynced drafts stay only in
  the set-aside copy; a local workspace comes back only from a backup ZIP. Data that cannot be decrypted first points to the
  system account it belongs to. The existing messages for a second instance, a newer database and unknown
  package data stay.
- **Group transparency**: each group can make its Top-layer papers see-through, so they do not hide the work beneath
  them. It is a device setting kept next to the group's colour and never syncs. Only the paper turns see-through:
  text, checkboxes and attachment thumbnails stay solid. It applies while a paper rests on the Top layer, on every
  platform; papers on the Wallpaper and Desktop layers and papers being adjusted stay opaque (on Windows those two
  layers live in Explorer's desktop window, which cannot show transparent pixels). The opacity goes from 30% to 100%,
  100% by default, and the main window's board and list do not change.
- **Shortcuts on other Wayland compositors**: the Linux app exposes every shortcut action, plus showing the main window
  and quitting, as named GApplication actions, so a keybinding in sway, wayfire or another compositor without a
  GlobalShortcuts portal can run `gapplication action <app id> <action>`; the user guide gives examples. labwc keeps
  the rc.xml keybinds that Settings writes.

## 0.4.x

Being scheduled for 0.4.x does not mean a design is approved.

Needs an ADR first:

- **Permanent deletion**: "Delete forever" and "Empty Deleted" in the Deleted filter, possibly with automatic emptying
  after a set time, as Google Keep (7 days), Apple Notes and Notion (about 30 days) offer. Today a deleted note's text,
  attachments and every revision stay in Google Drive, on every device and in every backup. Revisions are immutable and
  each holds the full content, so the ADR first decides: whether a purge leaves an empty tombstone or removes the
  history; how the purge syncs, and how devices that are offline or on an older version are kept from bringing the
  content back; what happens to an edit made at the same time on another device; how restoring an older backup treats
  purged notes; when an attachment's bytes can go; and which clock an automatic period follows. Unlike "Move to
  Deleted", these actions cannot be undone and ask for confirmation. It changes SPEC-002 and SPEC-004.
