# PLAN-010: Unsaved changes instead of drafts

## Metadata

| Field | Value |
|---|---|
| Status | Completed, 2026-11-01; Windows builds and probes, an Xcode build and real desktop hosts not verified |
| Owner | Project maintainer |
| Assigned To | Coding agent |
| Reviewer | Separate review agent (read-only), 2026-11-01; its findings were fixed before the commit |
| Date | 2026-11-01 |

## Related Spec

[SPEC-003](../specs/003-desktop-cards-groups-and-formation.md) U23 and the quick edit, as changed by
[ADR-061](../decisions/061-unsaved-changes-instead-of-drafts.md).

## Overview

Keep the stored entries and their save path, enforce one set per note in `Workspace`, and give every view a working
snapshot that overlays unsaved changes and adds notes never saved. Then replace the draft UI (the sidebar list,
"Keep draft", the quick edit's Cancel) with the dot, Close, "Discard changes" and the conflict choices, and remove the
word "draft" from both locale catalogs and the native string tables. Native hosts only learn the optional `unsaved`
frame field.

## Implementation Phases

### Phase 1: Core

- [x] 1.1 `Workspace`: `working` snapshot (`workingCards`), `openDraft`, `unsavedChanges`, `discardChanges`; one set
  per note in `saveDraft` and `commitDraft`; `recoveredFrom` and `recoverDraft` removed.
- [x] 1.2 Unneeded rule also drops changes that still equal the revision they began from.
- [x] 1.3 `commitDraft` with `overwrite`, and saving onto the current revision when only flags or the group changed;
  local content-preserving revisions carry unsaved changes along.
- [x] 1.4 `transferCard` refuses to move a never-saved note to another group; group merge previews count never-saved
  notes as notes.
- [x] 1.5 Backups: no lineage validation; positions of never-saved notes left out; a restore keeps this device's set
  per note.

**Deliverables**: core and backup behaviour with unit tests.

### Phase 2: Main window and desktop

- [x] 2.1 Controller, formation, placement, rendering and the desktop authority read the working snapshot.
- [x] 2.2 Editor: continue unsaved changes, Close, "Discard changes" with undo, Overwrite and Save as a copy; the
  drafts list and its sidebar link removed; delete asks when a note has unsaved changes.
- [x] 2.3 Ticks on unsaved text; refused while the note is open in an editor.
- [x] 2.4 Dot on board, list, canvas and desktop papers; the desktop projection's `unsaved` flag; the quick edit's
  Cancel replaced by "Discard changes" (trash can).
- [x] 2.5 Share inbox accepts a share as a new unsaved note and opens it.
- [x] 2.6 Native frame validators on Windows, macOS and Linux accept the optional `unsaved` boolean.

**Deliverables**: the model end to end in the browser preview and the desktop scene protocol.

### Phase 3: Text, tests and documents

- [x] 3.1 en and zh-TW catalogs and native string tables without "draft".
- [x] 3.2 Unit tests and probes updated for the new model.
- [x] 3.3 SPEC-003, user guides (both editions), testing, indexes.

**Deliverables**: passing local checks; native builds and Windows probes recorded as not run where they cannot run.

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `src/core/workspace.js`, `src/core/groups.js` | Modify | Model, working snapshot, conflict choices |
| `src/backup/payload.js`, `src/backup/restore.js` | Modify | Lineage removed, positions, one set per note |
| `src/app/main.js`, `src/app/index.html`, `src/app/style.css` | Modify | Editor, dot, ticks, delete, share inbox |
| `src/desktop/authority.js`, `projection.js`, `scene.js`, `scene.css` | Modify | Working snapshot, dot, Discard changes |
| `src/native/capture.js` | Modify | Share as a new unsaved note |
| `src/native/{windows,apple,linux}` | Modify | Optional `unsaved` field, host strings |
| `src/i18n/locales/{en,zh-TW}` | Modify | Wording |
| `contracts/*.d.ts` | Modify | Draft shape, frame paper fields |
| `tests/`, `scripts/testing/` | Modify | Coverage |

## Technical Decisions

- Keep `drafts` and `draftId` as internal names: renaming would touch three native hosts and the backup format for
  no behaviour change.
- A fresh edit ID per editor that replaces the note's set on its first write, instead of keying entries by note, so
  the desktop protocol and the main window's editor identity stay as they are.
- Backups leave out positions of never-saved notes instead of relaxing layout validation.

## Testing Strategy

- **Unit Tests**: `node --test tests/*.test.js` for the Workspace model, backup and restore, group merge, desktop
  authority and projection.
- **Integration Tests**: the browser and scene probes in `docs/testing.md`.
- **Manual Testing**: Windows, macOS and Linux desktop quick edits with a real host; not possible from one machine.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A revision-writing path reads the working snapshot | High | Only display, layout and interaction read `working`; commands keep `snapshot` |
| Native hosts reject the new frame field | High | Optional field; validators updated in the same change |
| Overwrite replaces newer text from another device | Medium | Explicit choice; the replaced revision stays in history |

## Progress Log

| Date | Update |
|---|---|
| 2026-11-01 | Plan created with ADR-061 |
| 2026-11-01 | Phases 1–3 implemented; local JS, Python, browser and scene checks pass |

---

*Created: 2026-11-01*
*Author: Coding agent*
