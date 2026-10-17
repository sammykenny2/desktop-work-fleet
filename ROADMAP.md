# Roadmap

Updated: 2026-10-17. This document only sets the order of work and does not commit to release dates. It is not a status
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

Low cost, clear value:

- **Quick capture hides the main window again after saving**: when the main window was hidden and only shown by the
  shortcut, saving or pressing Esc hides it again. Today `saveEditor` only closes the editor, and the main window stays
  where it is.
- **Pasted or dropped images become attachments**: while editing, images can be pasted or dragged in directly; today
  attachments can only be added through the file picker.
- **Real-world sync check with the main window hidden**: on all three platforms, check whether the WebView throttles the
  20-second Google sync and desktop updates after the main window goes to the tray or menu bar; fix it only if a
  problem is confirmed.
- **Search ranking**: matches in the first line first, then in the first few lines, then the rest; today it is an
  unsorted substring filter.
- **Ticking checklists directly on the desktop**: when a paper is not click-through, clicking a checkbox toggles its
  completion and saves and syncs it, without entering text editing and without triggering a drag or a double-click edit
  by mistake. While click-through, papers still ignore clicks. For now this is listed for planning only.

Needs a product decision first:

- **Group transparency**: desktop papers take a per-group transparency; first decide the scope of the setting and
  whether it syncs across devices.
- **Guidance when data cannot be opened**: when the local database cannot be opened, point to the data location and the
  automatic backups and offer a way to restore, instead of only showing a generic error and stopping (so far confirmed
  only on Windows); first decide each platform's entry point and the actions it can offer.
- **Shortcuts on other Wayland compositors**: on desktops without a shortcut portal, such as sway, wayfire and Hyprland,
  binding `gapplication action` manually; first decide whether to only document it or also add actions such as showing
  the main window and quitting.
