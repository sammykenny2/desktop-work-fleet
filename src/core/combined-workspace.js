import { activeGroups, compareCards, compareId, copy, defaultGrid, eligible, PinItAnywhereError, gridRegions, groupKey, membershipKey, requireValue } from './contracts.js';
import { resolveGroupId } from './groups.js';
import { validateShortcuts } from './shortcuts.js';
import { deskFields, deskKey, DeskStore, hiddenGroups, seedDesk, settledColors, settleDesk } from '../layout/desk.js';
import { swapGroupColor, validColor } from '../layout/colors.js';
import { orderedGroups } from '../layout/order.js';
import { groupLayer } from '../layout/stages.js';
import { LayoutStore, mainViews } from '../layout/store.js';
import { paperDimensions, validPaperSize } from '../layout/paper-size.js';
import { t } from '../i18n/index.js';
import { isFront, layoutHighWater, maxOrder, orderRange, visualOrder, zeroOrder } from '../layout/stacking.js';
import { LayoutBatchJournal } from '../layout/batch.js';

const pick = (object, keep) => Object.fromEntries(Object.entries(object).filter(([key]) => keep(key)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The layout every consumer reads: the desk's per-computer values over each open profile's placements and per-group
 * looks. Writes go to whichever holds the value, and each profile's layout stays the atomic partner of its content.
 */
class CombinedLayout {
  #combined; #desk; #arrivedOff = []; #journal; #tail = Promise.resolve();
  constructor(combined, desk) {
    this.#combined = combined; this.#desk = desk;
    this.#journal = new LayoutBatchJournal(this.#profiles, desk);
    for (const { workspace } of this.#profiles) workspace.layout.setOrderAuthority({
      reserve: (count, floor) => desk.reserveOrders(count, maxOrder(this.#highWater(), floor)),
      isFront: ids => {
        const layout = this.state;
        return isFront(visualOrder(this.#combined.working.cards.filter(card => eligible(card, layout)
          && layout.placements[card.id]), layout).map(card => card.id), ids);
      },
      check: () => requireValue(!this.#journal.blocked, 'layout-batch-pending', t('errors.core.layoutBatchPending')),
    });
  }
  recoverBatch() { return this.#journal.recover(); }
  #perform(work) {
    const pending = this.#tail.then(async () => { await this.#journal.recover(); return work(); });
    this.#tail = pending.catch(() => {}); return pending;
  }
  async #simulate(profile, work) {
    const before = profile.workspace.layout.state, snapshot = profile.workspace.working;
    const layout = new LayoutStore(before, async () => {});
    const value = await work(layout, snapshot);
    return { step: { owner: profile.id, before, revision: before.revision, membership: membershipKey(snapshot, before), after: layout.state }, value };
  }
  #highWater() { return maxOrder(...this.#profiles.map(({ workspace }) => layoutHighWater(workspace.layout.state))); }
  get #profiles() { return this.#combined.profiles; }
  get desk() { return this.#desk; }

  get state() {
    const desk = this.#journal.beforeDesk(this.#desk.state); const groups = this.#combined.groups();
    const known = pick(hiddenGroups(desk, groups), id => desk.known[id] !== undefined);
    // A key for a region reserved for a collection that is not open acts on nothing, so shortcuts read the live slots.
    const open = new Set(groups.map(group => group.id));
    const merged = { schemaVersion: 1, revision: desk.revision, grid: desk.grid, liveSlots: desk.grid.slots.map(id => open.has(id) ? id : null), groupColors: desk.groupColors, hiddenGroups: known,
      placements: {}, owners: {}, history: [], groupLayers: {}, groupOpacity: {}, groupHighlights: {} };
    for (const key of deskFields) if (desk[key] !== undefined) merged[key] = desk[key];
    for (const { id, workspace } of this.#profiles) {
      const layout = this.#journal.before(id) ?? workspace.layout.state;
      merged.deviceId ??= layout.deviceId; merged.revision += layout.revision;
      Object.assign(merged.placements, layout.placements); merged.history.push(...layout.history);
      for (const cardId of Object.keys(layout.placements)) merged.owners[cardId] = id;
      Object.assign(merged.groupLayers, layout.groupLayers); Object.assign(merged.groupOpacity, layout.groupOpacity);
      Object.assign(merged.groupHighlights, layout.groupHighlights);
    }
    return merged;
  }
  whenIdle() { return Promise.all([this.#tail, this.#journal.whenIdle(), this.#desk.whenIdle(), ...this.#profiles.map(({ workspace }) => workspace.layout.whenIdle())]); }
  /** Read for every note drawn, so it skips merging the placements. */
  get groupColors() { return this.#desk.state.groupColors; }

  /** One profile's own layout: its sidebar order lives in its `grid.slots`. */
  of(profileId) { return this.#combined.profile(profileId).workspace.layout; }
  #ofCard(cardId) { return this.#combined.ownerOfCard(cardId).workspace; }
  #ofGroup(groupId) { return this.#combined.ownerOfGroup(groupId).workspace; }

  async settle() {
    const groups = this.#combined.groups(); const open = this.#profiles.map(profile => profile.id);
    const resolve = (id, owner) => {
      const profile = this.#profiles.find(item => item.id === owner);
      try { return profile ? resolveGroupId(profile.workspace.snapshot, id) : null; } catch { return null; }
    };
    await this.#desk.update(draft => {
      const settled = settleDesk(draft, groups, open, resolve);
      for (const group of groups) if (draft.known[group.id] !== group.profileId && !settled.grid.slots.includes(group.id)) this.#arrivedOff.push(group.id);
      return { desk: { ...settled, revision: draft.revision } };
    });
  }
  /** Groups new to this device that found no free region since the last call, so that the page can say so. */
  takeArrivedOffDesktop() { return this.#arrivedOff.splice(0); }

  placeNew(_snapshot, workAreas, paperSize = undefined, checkpoint = null) {
    return this.#perform(() => this.#placeNew(workAreas, paperSize, checkpoint));
  }
  async #placeNew(workAreas, paperSize, checkpoint) {
    await this.settle();
    const desk = this.#desk.state; const results = [];
    paperSize ??= paperDimensions(desk);
    const regions = gridRegions(desk.grid, []).filter(region => region.groupId);
    const hidden = hiddenGroups(desk, this.#combined.groups());
    for (const { workspace } of [...this.#profiles].sort((a, b) => compareId(a.id, b.id))) {
      const view = this.state;
      const occupied = this.#combined.working.cards.filter(card => view.placements[card.id] && eligible(card, view) && !workspace.holdsCard(card.id))
        .map(card => view.placements[card.id]);
      results.push(await workspace.layout.placeNew(workspace.working, workAreas, paperSize, checkpoint,
        { regions, hidden, occupied, completedVisible: desk.completedVisible === true }));
    }
    return { deferred: results.flatMap(result => result.deferred), groupOverflow: results.some(result => result.groupOverflow), groups: groupKey(this.#combined.snapshot) };
  }

  async configure(patch, snapshot) {
    await this.#journal.recover();
    patch = copy(patch);
    const allowed = ['grid', 'desktopVisible', 'completedVisible', 'quickMove', 'newPaperSize', 'shortcuts', 'mainView'];
    requireValue(Object.keys(patch).every(key => allowed.includes(key)), 'invalid-setting', t('errors.core.layoutSettingUnknown'));
    requireValue(groupKey(copy(snapshot)) === groupKey(this.#combined.snapshot), 'stale-groups', t('errors.core.groupsChanged'));
    const groups = this.#combined.groups();
    if (patch.grid) gridRegions(patch.grid, groups);
    requireValue(['desktopVisible', 'completedVisible', 'quickMove'].every(key => !(key in patch) || typeof patch[key] === 'boolean'),
      'invalid-setting', t('errors.core.visibilityInvalid'));
    if ('shortcuts' in patch) patch.shortcuts = validateShortcuts(patch.shortcuts, groups);
    requireValue(!('mainView' in patch) || mainViews.includes(patch.mainView), 'invalid-setting', t('errors.core.mainViewUnknown'));
    requireValue(!('newPaperSize' in patch) || validPaperSize(patch.newPaperSize), 'invalid-setting', t('errors.core.paperSizeUnknown'));
    return this.#desk.update(draft => { Object.assign(draft, patch); return { groups: groupKey(this.#combined.snapshot) }; });
  }

  setMainGroup(groupId) {
    requireValue(this.#combined.groups().some(group => group.id === groupId), 'missing-group', t('errors.common.groupMissing'));
    return this.#desk.update(draft => { draft.mainGroupId = groupId; });
  }
  setGroupColor(groupId, index) {
    const groups = this.#combined.groups();
    requireValue(validColor(index), 'invalid-setting', t('errors.core.colorUnknown'));
    requireValue(groups.some(group => group.id === groupId), 'missing-group', t('errors.common.groupMissing'));
    const open = this.#profiles.map(profile => profile.id);
    return this.#desk.update(draft => { draft.groupColors = swapGroupColor(settledColors(draft, groups, open), groupId, index); });
  }
  setGroupLayer(groupId, layer) { const workspace = this.#ofGroup(groupId); return workspace.layout.setGroupLayer(groupId, layer, workspace.snapshot); }
  setGroupOpacity(groupId, value) { const workspace = this.#ofGroup(groupId); return workspace.layout.setGroupOpacity(groupId, value, workspace.snapshot); }
  setGroupHighlight(groupId, on) { const workspace = this.#ofGroup(groupId); return workspace.layout.setGroupHighlight(groupId, on, workspace.snapshot); }
  setCardPolicy(cardId, patch) { return this.#ofCard(cardId).layout.setCardPolicy(cardId, patch); }

  /** A group moved to another collection wears what it wore. */
  async carryLooks(sourceId, targetId) {
    const state = this.state; const target = this.#ofGroup(targetId);
    // Not the layer a group new to this device arrives on: no stored layer means the desktop layer.
    await target.layout.setGroupLayer(targetId, groupLayer(state, sourceId), target.snapshot);
    if (state.groupOpacity[sourceId] !== undefined) await target.layout.setGroupOpacity(targetId, state.groupOpacity[sourceId], target.snapshot);
    if (state.groupHighlights[sourceId]) await target.layout.setGroupHighlight(targetId, true, target.snapshot);
  }
  /**
   * A group on its way here from another collection. Its region comes when the move ends, so it never grows the grid; until
   * then a free region shows the notes already moved in case the move stops. A source off the desktop keeps it off too.
   */
  admitMovedGroup(sourceId, targetId, profileId) {
    return this.#desk.update(draft => {
      draft.known[targetId] = profileId;
      const free = draft.grid.slots.indexOf(null);
      if (free >= 0 && draft.grid.slots.includes(sourceId)) draft.grid.slots[free] = targetId;
    });
  }
  /** When a group has moved completely, the target takes its region, colour and place as the group the main window shows. */
  handOverGroup(sourceId, targetId) {
    return this.#desk.update(draft => {
      const held = draft.grid.slots.indexOf(sourceId);
      if (held >= 0) {
        const other = draft.grid.slots.indexOf(targetId); if (other >= 0) draft.grid.slots[other] = null;
        draft.grid.slots[held] = targetId;
      }
      if (draft.groupColors[sourceId] !== undefined) {
        draft.groupColors[targetId] = draft.groupColors[sourceId]; delete draft.groupColors[sourceId];
      }
      if (draft.mainGroupId === sourceId) draft.mainGroupId = targetId;
    });
  }

  async move(cardId, position, expectedRevision) {
    return this.#perform(() => {
      requireValue(expectedRevision === undefined || expectedRevision === this.state.revision, 'stale-layout', t('errors.common.layoutChanged'));
      return this.#ofCard(cardId).layout.move(cardId, position);
    });
  }
  raise(ids) {
    if (!ids.length) return Promise.resolve(false);
    const owners = new Set(ids.map(id => this.#ofCard(id)));
    requireValue(owners.size === 1, 'other-collection', t('errors.core.otherCollection'));
    return this.#perform(() => [...owners][0].layout.raise(ids));
  }
  raiseGroup(groupId, snapshot) {
    const layout = this.state;
    return this.raise(visualOrder(snapshot.cards.filter(card => card.groupId === groupId && eligible(card, layout)
      && layout.placements[card.id]), layout).map(card => card.id));
  }

  /** A formation is one action to the user, so it undoes as one even when it moved papers of several profiles. */
  async applyFormation(plan, getSnapshot) {
    plan = copy(plan);
    return this.#perform(() => this.#formation(plan, getSnapshot));
  }
  async #formation(plan, getSnapshot) {
    plan = copy(plan); const state = this.state;
    requireValue(plan.layoutRevision === state.revision && plan.membership === membershipKey(getSnapshot(), state), 'stale-plan', t('errors.core.arrangePlanStale'));
    requireValue(plan.allowResize || plan.resized.length === 0, 'resize-consent', t('errors.core.resizeNotAllowed'));
    const batch = crypto.randomUUID(), steps = [];
    const labels = await this.#desk.reserveOrders(Object.keys(plan.changes).length, this.#highWater());
    requireValue(this.state.revision === plan.layoutRevision && membershipKey(getSnapshot(), this.state) === plan.membership,
      'stale-plan', t('errors.core.arrangePlanStale'));
    Object.values(plan.changes).forEach((rect, index) => { rect.zOrder = labels[index]; });
    for (const profile of this.#profiles) {
      const changes = pick(plan.changes, id => profile.workspace.holdsCard(id));
      if (Object.keys(changes).length) steps.push((await this.#simulate(profile, layout => layout.applyChanges(changes, batch))).step);
    }
    const desk = same(plan.grid, state.grid) ? null : { before: { grid: state.grid }, after: { grid: plan.grid } };
    requireValue(this.state.revision === plan.layoutRevision && membershipKey(getSnapshot(), this.state) === plan.membership,
      'stale-plan', t('errors.core.arrangePlanStale'));
    await this.#journal.run(steps, desk, batch);
    return { membership: plan.membership };
  }

  /** The newest action across profiles comes first, also after a restart; a formation across profiles undoes as one. */
  async undo(workAreas) {
    return this.#perform(() => this.#undo(workAreas));
  }
  async #undo(workAreas) {
    const tops = this.#profiles.map(({ workspace }) => ({ workspace, top: workspace.layout.state.history.at(-1) })).filter(item => item.top)
      .sort((a, b) => (b.top.at ?? 0) - (a.top.at ?? 0));
    if (!tops.length) return { kind: 'empty', rescued: [] };
    const { batch } = tops[0].top;
    if (!batch) return tops[0].workspace.undo(workAreas);
    const steps = []; let result;
    for (const item of tops.filter(item => item.top.batch === batch)) {
      const profile = this.#profiles.find(profile => profile.workspace === item.workspace);
      const simulated = await this.#simulate(profile, (layout, snapshot) => layout.undo(() => snapshot, workAreas));
      steps.push(simulated.step); result = simulated.value;
    }
    await this.#journal.run(steps);
    return result;
  }

  async reset(_snapshot, area, layer = null) {
    return this.#perform(async () => {
      const previous = this.#desk.state, groups = this.#combined.orderedGroups(), grid = defaultGrid(groups.slice(0, 9), area);
      const regions = gridRegions(grid), models = new Map(), bases = new Map(), occupied = [];
      for (const profile of this.#profiles) {
        const before = profile.workspace.layout.state;
        bases.set(profile.id, { owner: profile.id, before, revision: before.revision, membership: membershipKey(profile.workspace.working, before) });
        const layout = new LayoutStore(before, async () => {});
        layout.setOrderAuthority({ reserve: count => Promise.resolve(orderRange(zeroOrder, count)), isFront: () => false });
        await layout.reset(profile.workspace.working, area, layer, { listOnly: true }); models.set(profile.id, layout);
      }
      const hidden = Object.fromEntries(groups.filter(group => !grid.slots.includes(group.id)).map(group => [group.id, true]));
      const sequence = [];
      for (const region of regions.filter(region => region.groupId)) {
        const profile = this.#combined.ownerOfGroup(region.groupId), layout = models.get(profile.id);
        const snapshot = profile.workspace.working;
        snapshot.cards = snapshot.cards.filter(card => card.groupId === region.groupId);
        await layout.placeNew(snapshot, [area], paperDimensions(this.#desk.state), null, { regions, hidden, occupied, completedVisible: false });
        for (const card of snapshot.cards.sort(compareCards)) if (layout.state.placements[card.id]) {
          sequence.push([profile.id, card.id]);
          if (eligible(card, layout.state)) occupied.push(layout.state.placements[card.id]);
        }
      }
      const labels = await this.#desk.reserveOrders(sequence.length, this.#highWater());
      const after = new Map([...models].map(([id, layout]) => [id, layout.state]));
      sequence.forEach(([owner, id], index) => { after.get(owner).placements[id].zOrder = labels[index]; });
      const steps = this.#profiles.map(profile => ({ ...bases.get(profile.id), after: after.get(profile.id) }));
      const fields = ['grid', 'desktopVisible', 'known', 'completedVisible', 'quickMove'];
      await this.#journal.run(steps, { before: Object.fromEntries(fields.map(key => [key, previous[key] ?? null])),
        after: { grid, desktopVisible: true, known: {} }, unset: ['completedVisible', 'quickMove'] });
    });
  }

  async recoverDisplays(workAreas, primary) {
    const rescued = [];
    for (const { workspace } of this.#profiles) rescued.push(...(await workspace.layout.recoverDisplays(workAreas, primary)).rescued);
    const { x, y, width, height } = primary;
    await this.#desk.update(draft => { draft.grid.area = { x, y, width, height }; });
    return { reason: 'display-unreachable', rescued };
  }
}

/**
 * The open profiles as one workspace for the interface (ADR-066). Reads merge; a write goes to the profile holding that
 * note, group or unsaved change, and a request for one that no open profile holds is refused rather than guessed. Sync,
 * recovery and backups work on one profile's own Workspace, so `primary`, `state` and `syncState` answer for the primary.
 */
export class CombinedWorkspace {
  #profiles; #layout;
  #draftOwners = new Map();
  /**
   * `profiles` is `[{ id, workspace, storage }]` with the primary first. The desk is kept in every open profile, so that
   * resetting one collection's data leaves this computer's regions, shortcuts and colours; the local copy leads because
   * it is always open.
   */
  static async open(profiles) {
    const primary = profiles[0]; let saved = null;
    // Every open collection holds a copy. The one that changed last leads, for a collection can be closed, reset or unavailable
    // while another goes on: a reset one restarts its counter, so the time decides first. Each copy then catches up, so that the
    // next start can rely on any. A collection that cannot read or write misses out, and its trouble stays its own (FR33).
    const copies = await Promise.all(profiles.map(profile => profile.storage.getControl(deskKey).catch(() => null)));
    const later = (a, b) => (a.changedAt ?? 0) - (b.changedAt ?? 0) || a.revision - b.revision;
    for (const value of copies) if (value && (!saved || later(value, saved) > 0)) saved = value;
    const high = maxOrder(...copies.filter(Boolean).map(value => value.zOrderCounter),
      ...profiles.map(({ workspace }) => layoutHighWater(workspace.layout.state)));
    if (saved) saved = { ...saved, zOrderCounter: high };
    if (saved) await Promise.all(profiles.map((profile, index) => JSON.stringify(copies[index]) === JSON.stringify(saved) ? null : profile.storage.putControl(deskKey, saved).catch(() => {})));
    const desk = new DeskStore(saved ?? { ...seedDesk(primary.workspace.layout.state), zOrderCounter: high }, async (value, { reservation = false } = {}) => {
      const results = await Promise.allSettled(profiles.map(profile => profile.storage.putControl(deskKey, value)));
      const canonical = Math.max(0, profiles.findIndex(profile => profile.id === 'local'));
      if (reservation && results[canonical].status === 'rejected') throw results[canonical].reason;
      if (results.every(result => result.status === 'rejected')) throw results[0].reason;
    });
    const combined = new CombinedWorkspace(profiles, desk);
    // An unreadable/incomplete layout batch must not prevent unrelated note capture or sync.
    await combined.layout.recoverBatch().catch(() => {});
    await combined.layout.settle();
    return combined;
  }
  constructor(profiles, desk) {
    this.#profiles = profiles;
    this.#layout = new CombinedLayout(this, desk);
  }
  get profiles() { return this.#profiles; }
  get primary() { return this.#profiles[0].workspace; }
  get layout() { return this.#layout; }
  profile(id) {
    const profile = this.#profiles.find(item => item.id === id);
    requireValue(profile, 'invalid-profile', t('errors.storage.profileMismatch'));
    return profile;
  }

  #find(test, code, message) {
    const matches = this.#profiles.filter(test);
    requireValue(matches.length < 2, 'shared-ids', t('app.sections.sharedIds'));
    const [profile] = matches;
    if (!profile) throw new PinItAnywhereError(code, message());
    return profile;
  }
  /** Ids more than one open collection holds. Routing by id cannot tell these apart, so nothing should write while any exist. */
  sharedIds() {
    const seen = new Set(); const shared = new Set();
    for (const { workspace } of this.#profiles) {
      const own = new Set(workspace.ownIds());
      for (const id of own) if (seen.has(id)) shared.add(id);
      for (const id of own) seen.add(id);
    }
    return [...shared];
  }
  ownerOfCard(id) { return this.#find(({ workspace }) => workspace.holdsCard(id), 'missing-card', () => t('errors.common.noteMissing')); }
  ownerOfGroup(id) { return this.#find(({ workspace }) => workspace.holdsGroup(id), 'missing-group', () => t('errors.common.groupMissing')); }
  // The collection that holds or opened a draft keeps it: ids another collection has come to share must not redirect its text.
  #ownerOfDraft(draft) {
    return this.#profiles.find(({ workspace }) => workspace.holdsDraft(draft.id)) ?? this.#draftOwners.get(draft.id)
      ?? this.#find(({ workspace }) => workspace.holdsCard(draft.cardId) || workspace.holdsGroup(draft.groupId), 'missing-group', () => t('errors.common.groupMissing'));
  }
  #entity(kind, id) { return kind === 'group' ? this.ownerOfGroup(id) : this.ownerOfCard(id); }

  /** Active groups with their owner, in the order of the profiles. */
  groups() { return this.#profiles.flatMap(({ id, workspace }) => workspace.activeGroupList().map(group => ({ ...group, profileId: id }))); }
  /** Each profile's groups in that profile's own list order, one profile after another. */
  orderedGroups() {
    return this.#profiles.flatMap(({ id, workspace }) => orderedGroups({ grid: { slots: workspace.layout.slots } }, workspace.activeGroupList()).map(group => ({ ...group, profileId: id })));
  }
  #merge(read) {
    if (this.#profiles.length === 1) return read(this.#profiles[0].workspace);
    const parts = this.#profiles.map(({ workspace }) => read(workspace));
    return { groups: parts.flatMap(part => part.groups), cards: parts.flatMap(part => part.cards), writable: true,
      conflicts: parts.flatMap(part => part.conflicts ?? []), ...parts.some(part => part.drafts) ? { drafts: Object.assign({}, ...parts.map(part => part.drafts)) } : {} };
  }
  get snapshot() { return this.#merge(workspace => workspace.snapshot); }
  get working() { return this.#merge(workspace => workspace.working); }
  get state() { return this.primary.state; }
  get syncState() { return this.primary.syncState; }
  get currentFormat() { return this.primary.currentFormat; }
  get pendingCount() { return this.#profiles.reduce((sum, { workspace }) => sum + workspace.pendingCount, 0); }
  /** Grows with every saved change of any profile, so a desktop frame can tell it is newer. */
  get revision() { return this.#profiles.reduce((sum, { workspace }) => sum + workspace.state.revision, 0); }
  /** An unsaved change by its id, whichever profile holds it. */
  draft(id) { return this.#profiles.map(({ workspace }) => workspace.state.drafts[id]).find(Boolean) ?? null; }
  /** Conflicts plus unsaved text whose note was deleted forever: what the status bar counts. */
  #attentionIn({ workspace }) { const state = workspace.state; return state.conflicts.length + Object.values(state.drafts).filter(draft => draft.purged).length; }
  attentionCount() { return this.#profiles.reduce((sum, profile) => sum + this.#attentionIn(profile), 0); }
  /** The collection Versions and conflicts should open on, for the count spans them all. */
  firstNeedingAttention() { return this.#profiles.find(profile => this.#attentionIn(profile) > 0)?.id ?? null; }
  setOpenNote(open) { for (const { workspace } of this.#profiles) workspace.setOpenNote(open); }
  whenIdle() { return Promise.all([this.#layout.whenIdle(), ...this.#profiles.map(({ workspace }) => workspace.whenIdle())]); }

  revisionHeads(kind, id) { return this.#entity(kind, id).workspace.revisionHeads(kind, id); }
  unsavedChanges(cardId) { return this.#profiles.find(({ workspace }) => workspace.holdsCard(cardId))?.workspace.unsavedChanges(cardId) ?? null; }
  discardChanges(cardId) { return this.ownerOfCard(cardId).workspace.discardChanges(cardId); }
  openDraft(groupId, card = null) {
    const owner = card ? this.ownerOfCard(card.id) : this.ownerOfGroup(groupId);
    const draft = owner.workspace.openDraft(groupId, card);
    this.#draftOwners.set(draft.id, owner);
    return draft;
  }
  saveDraft(draft) { return this.#ownerOfDraft(draft).workspace.saveDraft(draft); }
  commitDraft(draftId, options) { return this.#find(({ workspace }) => workspace.holdsDraft(draftId), 'missing-card', () => t('errors.common.noteMissing')).workspace.commitDraft(draftId, options); }
  discardUnneededDraft(draftId) { return (this.#profiles.find(({ workspace }) => workspace.holdsDraft(draftId)) ?? this.#profiles[0]).workspace.discardUnneededDraft(draftId); }
  createCard(content, groupId) { return this.ownerOfGroup(groupId).workspace.createCard(content, groupId); }
  updateCard(cardId, patch, expectedRevision) { return this.ownerOfCard(cardId).workspace.updateCard(cardId, patch, expectedRevision); }
  restoreCard(cardId, expectedRevision, groupId = null, options = {}) { return this.ownerOfCard(cardId).workspace.restoreCard(cardId, expectedRevision, groupId, options); }

  /** Within a profile only; moving across goes through a confirmed move (SPEC-012). */
  async transferCard({ cardId, groupId, expectedRevision, position, expectedLayoutRevision }) {
    const { workspace } = this.ownerOfCard(cardId);
    requireValue(workspace.holdsGroup(groupId), 'other-collection', t('errors.core.otherCollection'));
    requireValue(expectedLayoutRevision === undefined || expectedLayoutRevision === this.#layout.state.revision, 'stale-layout', t('errors.common.layoutChanged'));
    return workspace.transferCard({ cardId, groupId, expectedRevision, position });
  }
  undo(workAreas) { return this.#layout.undo(workAreas); }

  /** A new group goes to the named profile, the primary unless one is named. */
  createGroup(name, profileId = this.#profiles[0].id) { return this.profile(profileId).workspace.createGroup(name); }
  ensureCaptureGroup() { return this.primary.ensureCaptureGroup(); }
  renameGroup(id, name, expectedRevision) { return this.ownerOfGroup(id).workspace.renameGroup(id, name, expectedRevision); }
  previewGroupMerge(sourceId, targetId) {
    const { workspace } = this.ownerOfGroup(sourceId);
    requireValue(workspace.holdsGroup(targetId), 'other-collection', t('errors.core.otherCollection'));
    return workspace.previewGroupMerge(sourceId, targetId);
  }
  /** The merged group's region passes to the group it joined, as soon as the merge lands. */
  async mergeGroup(plan) {
    const result = await this.ownerOfGroup(plan.sourceId).workspace.mergeGroup(plan);
    await this.#layout.settle();
    return result;
  }
  previewGroupDelete(id) { return this.ownerOfGroup(id).workspace.previewGroupDelete(id); }
  /** The deleted group's region frees up as soon as the delete lands. */
  async deleteGroup(id) {
    const result = await this.ownerOfGroup(id).workspace.deleteGroup(id);
    await this.#layout.settle();
    return result;
  }
}
