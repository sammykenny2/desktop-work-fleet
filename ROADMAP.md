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

Decided on 2026-10-23:

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
