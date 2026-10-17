# ADR-008: Portable interaction core and atomic local commands

## Status

Accepted, 2026-10-04, limited to the local semantic core and the 1.0 scope explicitly approved in this round.
Native hosts, the OAuth SDK and the production Drive wire format are delivered in later slices; this ADR does not
claim they are done.

## Context

The maintainer asked for implementation slice by slice, pushing directly to main, until the complete 1.0 is done.
The answers in the same round included Markdown, checklists, attachments, complete/archive, per-card display and
layer, selecting text while read-only, group and layout backup, automatic and encrypted backup, and import / merge
/ replace restore; the remaining details were delegated to best practice.
Delivery includes native Windows, macOS, Linux, iOS and Android apps and preparation for store submission.
Actually submitting to stores, buying certificates or creating accounts is still not an implied external operation
of this round.

## Decision

- Cards, groups, formation, geometry undo and the interaction controller use ES modules with no runtime package
  dependencies.
  The [type contract](../../contracts/desktop.d.ts) defines the boundary, and Node can run the semantic regression
  tests directly;
  Node, the Python HTTP service and desktop window handles are not put into the product data model.
- The Workspace is partitioned by profile, and commands are computed on a copy first; the new state is published
  only after persisting succeeds.
  Native storage adapters must save the whole transaction atomically and compare versions; in-memory tests are not
  passed off as evidence of writing to disk.
- One profile/device has exactly one local write coordinator. Layout, shared content, drafts and the outbox have
  separate fields;
  a group change commits the card's membership, this machine's position, undo and the pending operation together.
- Content revisions, layout revisions and pointer session identities are separate. A group change only changes
  membership and never overwrites the text with an old card snapshot.
  When a version race is found, the intent to change group is kept; undo is a new conditional operation.
- Formation is a pure calculation, committed explicitly, using the summary band measurements the renderer provides;
  size consent applies only to the current preview.
  Committing an expired preview is rejected. When capacity is not enough, everything stays as it was and a hint
  suggests managing in the main window or adjusting this arrangement; nothing is hidden, paged or shrunk
  automatically.
- Deleting or merging a group must, in the later UI, explicitly name the cards' target group and show a preview;
  it must never imply deleting cards.
  Synced data beyond the group limit is kept in full; creating a group and a formation that cannot fit report a
  clear error.
- Text, attachments and unrecognized content fields are kept in full; formal import validation must refuse a lossy
  conversion when it meets a required format it cannot understand.

## Consequences

### Positive

The same set of C cases can test the model first and then be reused by the desktop and phone adapters, without
copying five sets of interaction rules.
Replacing a source does not affect group or position semantics; layout undo does not roll back text, display
policy or other devices' operations.

### Negative

A single local coordinator and atomic persistence are required; renderers must not each load and overwrite the
same profile.
The current whole-snapshot transaction still needs performance measurements with large data to decide on a paged
local storage strategy.

### Neutral

The local outbox is not yet the Drive sync protocol, and native layering and input regions still have to be tested
on each platform.
This ADR does not adopt Tauri/Electron or add third-party dependencies, and does not treat an ordinary browser as
native desktop acceptance.

## Alternatives Considered

- Implementing gestures and formation separately in the five hosts: data semantics drift easily, so the shared
  core is extracted first.
- Turning the 0.1.0 Python server directly into the production authority: does not match the confirmed direction
  of having no note server of our own.
- Saving the move and the group change as two records: an interruption can leave a partial success; they are now
  one local transaction.

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [ADR-006](006-card-group-and-formation-semantics.md)
- [PLAN-003](../plans/003-desktop-interaction-implementation.md)
