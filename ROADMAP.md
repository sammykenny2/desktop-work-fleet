# Roadmap

Updated: 2026-11-01. This document only sets the order of work and does not commit to release dates. It is not a status
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

## Next data-format boundary

The incompatible persistence redesign belongs in the next maintainer-approved minor application release, not a
compatible 0.4.x patch. No target version or publication is authorized by this roadmap.

- **Permanent deletion and history scale**: implement
  [ADR-062](docs/decisions/062-dataset-checkpoints-and-deletable-history.md),
  [SPEC-010](docs/specs/010-dataset-checkpoints-and-deletable-history.md) and
  [PLAN-011](docs/plans/011-dataset-checkpoints-and-deletable-history.md). Start record-level
  local storage alongside remote protocol proof. The minimum delivery adds checkpoint bootstrap,
  explicit legacy reset, Delete forever, Empty Trash and the necessary backup/recovery integration.
- **Capacity and later behavior**: follow with manual Clear this note's history, then selective version deletion;
  review larger complete-backup support as needed. Automatic whole-note Trash expiry needs a separate ADR.
  It concerns time in Trash, never per-version retention. Archive editability is a separate interaction decision.
