# PLAN-015: Persistent desktop note stacking

## Metadata

| Field | Value |
|---|---|
| Status | Shared implementation complete; macOS bridge and labwc acceptance exercised; Windows/X11/multi-display and independent review open |
| Owner | Project maintainer |
| Assigned To | Unassigned |
| Reviewer | Independent review and maintainer/native-host acceptance pending |

## Related Spec

[SPEC-014](../specs/014-desktop-note-stacking.md), with persistence and architectural ownership in
[ADR-072](../decisions/072-persistent-desktop-note-stacking.md). Existing gestures, layers and overlay behavior remain
owned by [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md) and
[ADR-042](../decisions/042-adjust-overlay-on-every-desktop-host.md).

## Overview

Add device-local visual labels beside placements, allocated by the shared desk owner. Feed a remembered sequence
into the existing scene projection; selection/active-group state no longer silently overrides it. Implement one
command path for browser preview and native scenes, preserving atomic per-profile moves and content isolation.
Prove interruption and reservation behavior before connecting it to live gestures. No new native window topology,
background service, dependency, schema version, version bump or publication is planned.

### Baseline inspected before implementation

| Owner | Behavior observed before implementation |
|---|---|
| `src/interaction/controller.js` | `sceneOrder()` sorts stable order plus transient group/selection/drag priorities; activation/select/cycle do not persist order. Quick moves save position only. |
| `src/layout/store.js` | Placements own numeric `order`; move/formation/transfer snapshots and Undo use geometry; reset drops placements/history. |
| `src/layout/formation.js` | Pure planner packs a stable card sequence and assigns stored numeric orders; a group raise is currently transient. |
| `src/core/combined-workspace.js` | Merges per-profile layouts; move routes to one owner; formations/Undo/reset loop through owners and need explicit interruption handling for this feature. |
| `src/layout/desk.js` | Device-wide desk record and serialized writes; its copies are persisted through open profiles. It does not currently allocate visual labels. |
| `src/desktop/authority.js`, `projection.js`, `scene.js` | Owner validates/deduplicates scene commands, projects ordered frames, and paints/hit-tests native scene papers. |

These baseline observations identify the integration owners; current verification boundaries are in docs/testing.md.

## Implementation Phases

### Phase 1: Confirm the contract and prove order persistence

- [x] Resolve approval of ADR-072/SPEC-014 defaults, particularly single-note versus group raises, attention-only Undo
  policy and quick-edit/cycle inclusion. Update the documents' status and the exact superseded SPEC-003/ADR-006
  clauses together when accepted; keep unchanged gesture/layer requirements.
- [x] Define pure comparison/promotion helpers: fallback legacy ordering, single promotion, stable group partition,
  formation block order and bounded label parsing/allocation. Keep arrangement/navigation `order` separate from
  visual `zOrder`. Specify owner-qualified identity at combined boundaries and reject ambiguous routing.
- [x] Add optional V1 placement labels and the desk high-water mark to contracts/validation/serialization. No eager
  rewrite; prove compatible prior-layout/backup round trips under ADR-073/SPEC-007. Define explicit absent-label handling in Undo and strict rejection of malformed imports.
- [x] Prove reservation before profile commit: serialize allocations, acknowledge the durable desk range, then save
  the command atomically in its owner. Reconcile after an unknown outcome before admitting another allocation.
  Read the largest durable counter/placement label on reopen, including a retained or restored profile.
  Separate receipt/counter changes from visual layout fingerprints, so reserving a command's range cannot make its
  own drag/preview stale; a real intervening position, membership or visual-order change still invalidates it.
- [x] Test desk-copy failure partway through persistence, crash before/after reservation and profile commit, retries,
  owner reopen, concurrent local/cloud commands, failed writes and maximum label boundary. Unused ranges are gaps,
  never visible completed operations. No allocation depends on wall-clock order.

**Deliverable/gate:** Z21/Z22 model and real record-store fault fixtures demonstrate no label reuse, cross-profile
collision or false success. Do not wire gestures until this gate passes. If existing desk receipt handling is
insufficient, fix that narrow persistence path with regression coverage before proceeding.

### Phase 2: Integrate attention and gesture commands

- [x] Add owner-routed, idempotent note/block promotion commands. Pure focus/render/reconcile calls remain read-only;
  an already-front result does not write. Attention changes affect local layout only, with existing save-error UX.
- [x] Persist block promotion on successful entry to single-group adjustment; All entry/exit preserve order. Preflight
  scope and unsaved-text barriers before allocating/committing. Duplicate menu/shortcut echoes cannot promote twice.
- [x] Integrate adjust click, cycle and quick-edit entry. Cycle uses the stable arrangement sequence; keep the existing
  key, opt-in, permissions and child-control exclusions. Main-window note selection/editing does not promote desktop papers.
- [x] Keep pointer-down/move order provisional. Successful drag/quick move/desktop transfer commits visual label and
  position/membership in one owner transaction with a pre-gesture Undo snapshot. Cancel discards only the preview.
- [x] Remove saved-order overrides driven solely by active group or selected note from scene ordering. Retain explicit
  held-drag/editor/overlay presentation and existing native layer/fallback/lift rules. Keep paint/input ordering aligned.
- [x] Make close/reload/sign-out barriers wait for admitted attention writes; reconcile unknown outcomes rather than
  replaying the action on recovery. Keep error messages English-first through existing catalogs if new text is needed.

**Deliverable:** Z01–Z07/Z11/Z14–Z16 pass through the production controller/authority and browser preview, with no
per-pointer-frame writes, synthetic-click double promotion, sync revision or outbox addition.

### Phase 3: Formation, Reset, placement, Undo and backup

- [x] Extend pure formation plans with the exact proposed visual sequence and a version/fingerprint that invalidates
  previews on relevant order changes. Assign stable Stack/Spread labels in group-region/member order, not selection
  order. A group formation appends its own block; All uses row-major blocks.
- [x] Add a bounded local layout batch journal for operations spanning owners. Capture operation ID, owners,
  identities, expected revisions, intended changes/ranges and inverses as needed; apply idempotently under the
  existing command/publication barrier. Recover before admitting dependent layout actions. Keep content transactions
  per profile; no new distributed content protocol. Handle partial failure without claiming all-profile completion.
- [x] Cover interrupted formation, Undo and Reset, including a partial write with unknown outcome, missing/unavailable
  owners, sign-out and a terminal purge. Recovery must not blindly replay after a later successful command. An
  unavailable owner keeps the batch pending/recoverable with accurate failure feedback rather than being skipped.
  Preflight owners before starting; a suspended batch fences dependent layout commands without blocking unrelated
  healthy profiles' capture/editing/sync. Define the incomplete-batch Undo result and stale-recovery refusal explicitly.
- [x] Reset labels deterministically with reset regions and core note creation order, retaining the selected
  new-paper size and the existing reset policies. Reset history is cleared, not added as a new Undo feature.
- [x] Give first placements a deterministic device-wide insertion range across profiles. Retained placements keep
  labels through hiding, sync, membership changes and display rescue. Cross-profile adoption keeps correct owner
  routing and coordinates through the existing move journal; the new identity gets a fresh placement label without
  promoting its entire target group or leaking labels to shared content.
- [x] Extend per-operation Undo with before/after labels and conditional restoration. Attention actions do not add
  steps; later attention labels survive Undo. Keep deleted identities absent, and keep batch Undo one user action.
- [x] Include only owned labels in portable layout backup/validation; rebase explicitly adopted order into a fresh
  device range, retaining other profiles' mutual order. Keep-layout imports preserve current labels; identity
  remapping and new placement rules also cover fresh identities and restore collisions. Never export the desk counter
  or foreign note IDs, and retain V1 with the compatible-addition evidence required by ADR-073/SPEC-007.

**Deliverable:** Z08–Z10/Z12/Z13/Z17–Z23 pass, including record-store restart/fault tests and actual ZIP round trips.
The batch journal is a targeted layout-operation requirement, not evidence that current multi-owner loops are atomic.

### Phase 4: Native acceptance and owning documentation

- [x] Extend shared native desktop scenarios with overlap cases, then run available macOS, Windows and Linux probes
  using real host scenes and production projection/command paths. Record build/runtime boundaries honestly.
- [ ] Verify Windows Desktop-layer lifted drag and attached-scene repaint; macOS group overlay/quick move and scene
  reload; Linux X11 and labwc layer-shell scene ordering/input. Check GNOME XWayland fallback through adjustment,
  without pretending resting quick move is supported there.
- [ ] Verify Wallpaper/Desktop/Top peers and cross-layer precedence, group opacity, pointer capture, click-through
  after Done, keyboard cycling, mixed DPI, more than one display and display loss. Unavailable environments remain
  unverified; a successful model/browser run does not replace this evidence.
- [x] Update architecture, testing procedures, platform caveats and English/Traditional Chinese user guides with
  actual implemented behavior and validation boundaries. Update the project snapshot only where current truth changes.
- [ ] Obtain independent review if available; author-run tests are not independent review. Commit ordinary slices
  locally and push only on an explicit request. No release action follows from this implementation plan.

**Deliverable:** Z24 acceptance matrix and corrected owning documentation; implementation status reflects remaining
native or review gaps rather than declaring every platform accepted from source compilation.

## Files to Create/Modify

Paths below identify the implementation owners; the actual changed scope is recorded in git history.

| File | Action | Purpose |
|---|---|---|
| `src/layout/stacking.js`, `src/layout/batch.js` | Create | Pure label operations and bounded recoverable multi-owner layout journal |
| `src/layout/store.js`, `desk.js`, `formation.js` | Modify | Durable labels, reservation, formation/reset and conditional Undo |
| `src/core/combined-workspace.js`, `workspace.js` | Modify | Device-wide allocation, owner routing and targeted multi-owner layout recovery |
| `src/storage/workspace-records.js` | Inspect/modify as needed | Durable control journal and existing receipt/CAS behavior; retain record-level saves |
| `contracts/desktop.d.ts`, `storage.d.ts` and existing validators | Modify as needed | V1 labels/Undo/batch types and strict import/local validation |
| `src/interaction/controller.js`, `src/desktop/authority.js` | Modify | Gesture/attention commit boundaries and duplicate/cancel handling |
| `src/desktop/projection.js`, `scene.js`, `src/app/main.js` | Modify | One ordered frame, aligned paint/input and preview/selection behavior |
| `src/backup/device-layout.js` and existing backup capture/restore owners | Modify as needed | Per-profile order round trip, remapping and adoption without foreign metadata |
| `tests/stacking.test.js` | Create | Pure promotion, fallback, cycle, label bounds and deterministic formation cases |
| `tests/desktop-core.test.js`, `desktop-authority.test.js`, `combined-workspace.test.js`, `workspace-records.test.js` | Extend | Production command/store and multi-profile interruption/failure tests |
| `tests/backup-payload.test.js`, `backup-restore.test.js`, `tests/native/desktop-scenarios.mjs` | Extend | Actual backup order round trips and native overlap scenarios |
| `docs/architecture.md`, `testing.md`, user-guide editions and affected platform READMEs | Modify with implementation | Actual behavior, acceptance procedures and limitations |

## Testing Strategy

Use SPEC-014 Z01–Z24 as observable assertions; do not test only that a comparator returns integers. Model tests use
interleaved groups in multiple profiles, duplicate legacy orders, mixed resident layers, cancellation, late messages,
Undo after attention and deterministic first placement/Reset. Store tests inject failures on both sides of each
reservation/commit/journal acknowledgment, reopen the store and compare the actual durable sequence and operation
receipts. Assert that ordering alone creates no content revision/outbox work.

Run the targeted Node suites as each slice changes behavior, then `npm test` and `npm run build` for the integrated
change. Follow [testing](../testing.md) for real record-store and native probe commands; extend shared scenarios
before running them. Check documentation with `python3 scripts/testing/check_docs.py` and `git diff --check`.
Shared/model, durable record-store, real-browser and available native evidence is described in docs/testing.md;
unavailable native environments and independent review remain explicitly open.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Transient selected/group comparator defeats saved order | High | Replace implicit sorting priorities; assert after Done, Undo, new placement and restart. |
| Independently allocated cloud/local ranks collide | High | One device reservation authority; monotonic durable high-water mark and ambiguous-write fencing. |
| Multi-profile batch stops halfway | High | Targeted layout journal, publication barrier, idempotent recovery and fault/restart tests before integration. |
| Attention creates excessive writes or Undo noise | Medium | Write once per completed intent, no-op if already front, no standalone attention Undo. |
| Visual promotions change Next/Previous candidates | Medium | Keep navigation/arrangement order separate from visual labels. |
| Restored layout imports foreign or incomparable order | High | Validate per-owner data, preserve internal order, reserve/rebase on explicit adoption. |
| Browser tests conceal native layer/input or repaint problems | High | Real overlapping native papers; per-backend layer, fallback, capture and display acceptance. |

---

*Created: 2026-11-14*
