# PLAN-013: Cloud and local notes side by side

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress |
| **Owner** | Project maintainer |
| **Assigned To** | Claude |
| **Reviewer** | A separate agent per phase; maintainer acceptance on real devices |

## Related Spec

[SPEC-012: Cloud and local notes side by side](../specs/012-cloud-and-local-notes.md), under
[ADR-066](../decisions/066-cloud-and-local-notes-side-by-side.md).

## Overview

Each phase lands on main with tests and documents, and leaves the app working. Phase 1 stands alone. Phases 2 to 4 change
nothing a user sees until phase 4 shows the second section. No phase includes a version bump or a release.

## Implementation Phases

### Phase 1: Trash and search

- [ ] Trash row in the sidebar and its own view, separate from the status tabs
- [ ] Sections by group in the note and list views, most recently trashed first
- [ ] "This group" and "All" disabled, no capture or layout map in Trash
- [ ] Search across every status, with a link to matches in Trash; Trash searches itself
- [ ] Delete forever readable on every paper colour
- [ ] Tests, browser probes, SPEC-003, user guides

**Deliverables**: FR23, FR24, FR26, FR28 to FR32, without the collection tabs and FR27.

### Phase 2: Open two profiles

- [ ] Hosts route storage, transfer, attachment, backup and data methods by `profile`: Windows, Apple, Linux, Android
- [ ] Renderer stores scoped to a profile; browser preview included
- [ ] Host capability saying which extra profile may open

**Deliverables**: a page can read and write `local` while the primary is an account. No visible change.

### Phase 3: Combined workspace and desk

- [ ] `CombinedWorkspace`: merged reads, routed writes, undo across profiles
- [ ] Desk store: regions, shortcuts, switches, main view and group, colours; seeded from the primary
- [ ] Regions hold any groups; off-desktop groups are hidden; `placeNew` takes the desk's regions
- [ ] Interaction controller, authority and projection run on the combined objects
- [ ] Group `movedAway` state honoured by every active list
- [ ] Tests with three profiles

**Deliverables**: the page runs on the combined objects with one or more profiles. Single-profile behaviour unchanged apart
from FR8 to FR10.

### Phase 4: Two sections

- [ ] Sidebar sections, add buttons, headings; account chip and Account page without switching
- [ ] Sidebar order per section, free of regions and shortcuts
- [ ] Group regions settings, layout map, dimmed layer mark
- [ ] Trash tabs, collection labels, Empty Trash per tab
- [ ] Unavailable collection state; id-collision check
- [ ] Backups, reset and Versions and conflicts per collection
- [ ] SPEC-003, ADR-021, ADR-010 and user guide updates

**Deliverables**: FR1 to FR11, FR22, FR25, FR33 to FR37.

### Phase 5: Moves across

- [ ] Move journal and start-up recovery; moved-note creation; `movedTo`
- [ ] Note move: drag, "Move to group", confirmation, refusal reasons
- [ ] Group move: drag, settings button, progress with Stop, result; resume; `movedAway`; region and looks pass on
- [ ] Restoring from a moved-away group
- [ ] Crash-point tests at every journal step

**Deliverables**: FR12 to FR21, FR27.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/combined-workspace.js` | Create | Merged reads and routed writes |
| `src/layout/desk.js` | Create | Per-device record and combined layout state |
| `src/core/cross-move.js` | Create | Move journal, steps and recovery |
| `src/app/main.js`, `index.html`, `style.css` | Modify | Sidebar, Trash, search, dialogs |
| `src/core/contracts.js`, `src/layout/store.js`, `src/layout/formation.js` | Modify | Regions that do not hold every group |
| `src/storage/*` and hosts in `src/native/*` | Modify | Routing by profile |

## Technical Decisions

See ADR-066.

## Testing Strategy

- Unit tests with three profiles, so that nothing assumes two.
- A crash test at every step of a move, asserting one copy and no partial note.
- Browser probes with the preview's local profiles for both sections and moves; a stubbed Google status where needed.
- Native routing is tested per host in its existing test suite. This Mac can build Apple and run Linux in Docker; Windows runs
  in CI; Android is checked by its own build. Unrun checks are reported as such.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| A write reaches the wrong profile | Each session owns its staged tokens; `CombinedWorkspace` routes only by known ownership and refuses otherwise |
| Native changes unverified on some platforms | Keep routing small and alike; report what could not run; maintainer acceptance per device |
| A move duplicates or loses a note | Journal with a pre-chosen id, idempotent creation, crash tests at every step |
| Existing users see an old local section suddenly | Expected and harmless; documented in release notes when released |

## Progress Log

- 2026-11-04: Plan approved with the maintainer after a clickable mock.
