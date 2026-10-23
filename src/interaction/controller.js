import { activeGroups, containsPoint, copy, eligible, FleetError, gridRegions, inScope,
  requireValue, stableCards } from '../core/contracts.js';
import { groupLayer } from '../layout/stages.js';
import { reachable, rescueRect } from '../layout/store.js';
import { t } from '../i18n/index.js';

export const idleInteraction = () => ({ operationScope: { kind: 'none' }, activeGroupId: null,
  selectedCardId: null, editingCardId: null, dragSession: null });

export function cardPolicy(card, layout, state) {
  const participates = eligible(card, layout);
  const operating = participates && inScope(card, state.operationScope);
  const layer = operating ? 'floating' : groupLayer(layout, card.groupId);
  // Desktop and topmost papers take clicks and text selection while locked; wallpaper papers always let clicks through.
  return { visible: participates && (layout.desktopVisible || operating),
    interactive: operating || (participates && layout.desktopVisible && layer !== 'wallpaper'),
    draggable: operating, editing: operating && state.editingCardId === card.id, layer };
}

/** The key that starts a quick move (SPEC-003, 2026-10-24): Command on macOS, Ctrl elsewhere. */
export const quickMoveKey = platform => platform === 'macos' ? 'meta' : 'ctrl';

/**
 * Whether a quick move may start or finish on this card now: the device setting is on, nothing is adjusted or
 * edited, and the paper rests where it takes clicks. The authority adds the host's own layers on top of this.
 */
export function quickMovable(card, layout, state) {
  const policy = card ? cardPolicy(card, layout, state) : null;
  return Boolean(policy && layout.quickMove === true && state.operationScope.kind === 'none' && !state.editingCardId
    && policy.visible && policy.interactive && !policy.draggable);
}

/** Back-to-front within a native layer. Hosts split layers without changing these card identities. */
export function sceneOrder(cards, layout, state) {
  const drag = state.dragSession; const front = drag && (!drag.quick || drag.dragging) ? drag.cardId : null;
  const rank = card => front === card.id ? 3
    : state.selectedCardId === card.id ? 2 : state.activeGroupId === card.groupId ? 1 : 0;
  return stableCards(cards, layout).sort((a, b) => rank(a) - rank(b));
}

export function resolveDropTarget(point, shiftKey, labels, regions, groups) {
  const ids = new Set(groups.map(group => group.id));
  const label = labels.find(label => label.groupId && ids.has(label.groupId) && containsPoint(label, point));
  if (label) return { groupId: label.groupId, kind: 'label' };
  const region = shiftKey && regions.find(region => region.groupId && ids.has(region.groupId) && containsPoint(region, point));
  return region ? { groupId: region.groupId, kind: 'region' } : null;
}

/** Commands are injected; transferCard must persist membership, position and undo atomically. */
export class InteractionController {
  #state = idleInteraction();
  #getSnapshot;
  #layout;
  #commands;
  #saveDraft;
  #releaseDraft;
  #workAreas;
  #busy = false;
  #ending = null;
  #composing = false;
  #suppressedCard = null;

  constructor({ getSnapshot, layout, commands, saveDraft, releaseDraft, workAreas = () => [] }) {
    this.#getSnapshot = getSnapshot;
    this.#workAreas = workAreas;
    this.#layout = layout;
    this.#commands = commands;
    this.#saveDraft = saveDraft;
    this.#releaseDraft = releaseDraft;
  }

  get state() { return copy(this.#state); }
  setComposing(value) { this.#composing = Boolean(value); }
  #card(id) { return this.#getSnapshot().cards.find(card => card.id === id && !card.deleted); }
  #assertIdle() { requireValue(!this.#busy, 'busy', t('errors.core.busy')); }
  #participating(groupId) {
    const layout = this.#layout.state;
    return stableCards(this.#getSnapshot().cards.filter(card => eligible(card, layout)
      && (groupId === undefined || card.groupId === groupId)), layout);
  }

  async #flush() {
    if (this.#state.editingCardId) await this.#saveDraft(this.#state.editingCardId);
  }

  // Every way out of editing lets the owner drop a draft that holds nothing to keep, unless the edit is handed to another editor.
  async #finishEdit(keepDraft = false) {
    const cardId = this.#state.editingCardId; this.#state.editingCardId = null;
    if (cardId && !keepDraft) await this.#releaseDraft?.(cardId);
  }

  async activate(scope, { consumed = false } = {}) {
    scope = copy(scope);
    if (this.#composing || consumed) return false;
    this.#assertIdle();
    requireValue(['none', 'all', 'group'].includes(scope.kind), 'invalid-scope', t('errors.core.adjustScopeUnknown'));
    if (scope.kind === 'group') requireValue(activeGroups(this.#getSnapshot()).some(group => group.id === scope.groupId),
      'missing-group', t('errors.common.groupMissing'));
    if (scope.kind !== 'none' && !this.#participating(scope.kind === 'group' ? scope.groupId : undefined).length) {
      throw new FleetError('empty-scope', t('errors.core.scopeNoDesktopNotes'));
    }
    this.#busy = true;
    try {
      await this.#flush();
      const previous = this.#state.operationScope;
      const toggleOff = previous.kind === scope.kind && previous.groupId === scope.groupId;
      await this.#finishEdit();
      this.#state.dragSession = null;
      this.#state.operationScope = toggleOff ? { kind: 'none' } : copy(scope);
      if (this.#state.operationScope.kind === 'none') this.#state = idleInteraction();
      else if (scope.kind === 'group') {
        this.#state.activeGroupId = scope.groupId;
        if (this.#card(this.#state.selectedCardId)?.groupId !== scope.groupId) this.#state.selectedCardId = null;
      }
      return true;
    } finally { this.#busy = false; }
  }

  async select(cardId, { control = false, gesture = false } = {}) {
    if (control || (gesture && this.#suppressedCard === cardId)) return false;
    this.#assertIdle();
    const card = this.#card(cardId);
    requireValue(card && cardPolicy(card, this.#layout.state, this.#state).draggable, 'outside-scope', t('errors.core.outsideAdjustScope'));
    this.#busy = true;
    try {
      if (this.#state.editingCardId && this.#state.editingCardId !== cardId) {
        await this.#flush(); await this.#finishEdit();
      }
      this.#state.selectedCardId = cardId;
      this.#state.activeGroupId = card.groupId;
      return true;
    } finally { this.#busy = false; }
  }

  async beginEdit(cardId, options = {}) {
    if (options.control || this.#state.dragSession || (options.gesture && this.#suppressedCard === cardId)) return false;
    requireValue(this.#getSnapshot().writable, 'read-only', t('errors.core.readOnlyEdit'));
    if (!await this.select(cardId, options)) return false;
    this.#state.editingCardId = cardId;
    return true;
  }

  async endEdit({ keepDraft = false } = {}) {
    if (this.#composing) return false;
    this.#assertIdle(); this.#busy = true;
    try { await this.#flush(); await this.#finishEdit(keepDraft); return true; }
    finally { this.#busy = false; }
  }

  async escape({ consumed = false } = {}) {
    if (consumed || this.#composing) return false;
    this.#assertIdle();
    if (this.#state.dragSession) { this.cancelDrag(); return true; }
    if (this.#state.editingCardId) return this.endEdit();
    return this.activate({ kind: 'none' });
  }

  cycle(groupId, direction = 1) {
    this.#assertIdle();
    if (this.#state.editingCardId || this.#composing || this.#state.dragSession) return false;
    const cards = this.#participating(groupId);
    if (!cards.length) return false;
    const index = cards.findIndex(card => card.id === this.#state.selectedCardId);
    const next = index < 0 ? (direction < 0 ? cards.length - 1 : 0)
      : (index + (direction < 0 ? -1 : 1) + cards.length) % cards.length;
    this.#state.activeGroupId = groupId;
    this.#state.selectedCardId = cards[next].id;
    return true;
  }

  // A quick move drags one resting paper outside adjust mode; it is only ever an ordinary move.
  pointerDown(cardId, point, { pointerId = 1, control = false, handle = false, threshold = 5, quick = false } = {}) {
    this.#assertIdle();
    if (control || (this.#state.editingCardId === cardId && !handle)) return false;
    requireValue(!this.#state.dragSession, 'drag-active', t('errors.core.dragActive'));
    const card = this.#card(cardId); const layout = this.#layout.state;
    if (quick) requireValue(quickMovable(card, layout, this.#state), 'quick-move-off', t('errors.core.quickMoveOff'));
    else requireValue(card && cardPolicy(card, layout, this.#state).draggable, 'outside-scope', t('errors.core.outsideAdjustScope'));
    requireValue(layout.placements[cardId] && Number.isFinite(threshold) && threshold > 0
      && Number.isFinite(point.x) && Number.isFinite(point.y), 'invalid-pointer', t('errors.core.dragStartInvalid'));
    this.#suppressedCard = null;
    this.#state.dragSession = { generation: crypto.randomUUID(), cardId, pointerId, groupId: card.groupId, revision: card.revision,
      layoutRevision: layout.revision, start: copy(point), current: copy(point), origin: copy(layout.placements[cardId]),
      position: copy(layout.placements[cardId]), threshold, dragging: false, target: null,
      ...(quick ? { quick: true, layer: cardPolicy(card, layout, this.#state).layer } : {}) };
    return true;
  }

  pointerMove(point, { pointerId = 1, shiftKey = false, labels = [] } = {}) {
    const drag = this.#state.dragSession;
    if (!drag || this.#busy || drag.pointerId !== pointerId) return null;
    requireValue(Number.isFinite(point.x) && Number.isFinite(point.y), 'invalid-pointer', t('errors.core.dragPointInvalid'));
    drag.current = copy(point);
    if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) >= drag.threshold) drag.dragging = true;
    if (!drag.dragging) return copy(drag);
    drag.position = { ...drag.origin, x: drag.origin.x + point.x - drag.start.x, y: drag.origin.y + point.y - drag.start.y };
    if (drag.quick) return copy(drag);
    const groups = activeGroups(this.#getSnapshot());
    const layout = this.#layout.state;
    let regions = [];
    try { regions = gridRegions(layout.grid, groups); } catch { /* Invalid grid disables region transfer, not ordinary dragging. */ }
    drag.target = resolveDropTarget(point, shiftKey, labels, regions, groups);
    return copy(drag);
  }

  pointerUp(point, options = {}) {
    if (this.#ending) return this.#ending;
    this.#assertIdle();
    const drag = this.#state.dragSession;
    if (!drag || drag.pointerId !== (options.pointerId ?? 1)) return Promise.resolve({ kind: 'ignored' });
    const previousTarget = copy(drag.target);
    const previousPoint = copy(drag.current);
    if (drag.dragging && previousTarget && !activeGroups(this.#getSnapshot()).some(group => group.id === previousTarget.groupId)) {
      this.cancelDrag(); return Promise.resolve({ kind: 'cancelled', reason: 'target-changed' });
    }
    this.pointerMove(point, options);
    if (previousTarget && drag.target && previousTarget.groupId !== drag.target.groupId
      && point.x === previousPoint.x && point.y === previousPoint.y) {
      this.cancelDrag(); return Promise.resolve({ kind: 'cancelled', reason: 'target-changed' });
    }
    if (!drag.dragging) { this.#state.dragSession = null; return Promise.resolve({ kind: 'click' }); }
    if (drag.quick) return this.#endQuickMove(drag);
    this.#suppressedCard = drag.cardId;
    if (options.shiftKey && !drag.target) { this.cancelDrag(); return Promise.resolve({ kind: 'cancelled', reason: 'no-target' }); }
    this.#busy = true;
    this.#ending = (async () => {
      try {
        await this.#flush();
        if (drag.target && drag.target.groupId !== drag.groupId) {
          requireValue(this.#getSnapshot().writable, 'read-only', t('errors.core.readOnlyMove'));
          await this.#commands.transferCard({ cardId: drag.cardId, groupId: drag.target.groupId,
            expectedRevision: drag.revision, position: { x: drag.position.x, y: drag.position.y },
            expectedLayoutRevision: drag.layoutRevision });
          this.#afterTransfer(drag.cardId, drag.target.groupId);
          return { kind: 'transferred', cardId: drag.cardId, groupId: drag.target.groupId };
        }
        await this.#layout.move(drag.cardId, drag.position, drag.layoutRevision);
        return { kind: 'moved', cardId: drag.cardId };
      } finally { this.#state.dragSession = null; this.#busy = false; this.#ending = null; }
    })();
    return this.#ending;
  }

  // Whether a held quick move may still be saved: the paper still allows it, rests on the same layer and has not been
  // moved by anything else meanwhile. Other layout saves, such as a synced paper being placed, do not end it.
  #quickHolds(drag) {
    const card = this.#card(drag.cardId); const layout = this.#layout.state; const saved = layout.placements[drag.cardId];
    return quickMovable(card, layout, this.#state) && cardPolicy(card, layout, this.#state).layer === drag.layer
      && Boolean(saved) && saved.x === drag.origin.x && saved.y === drag.origin.y;
  }

  // A resting paper has no click or double click to suppress after the move.
  #endQuickMove(drag) {
    if (!this.#quickHolds(drag)) { this.cancelDrag(); return Promise.resolve({ kind: 'cancelled', reason: 'quick-move-ended' }); }
    const areas = this.#workAreas();
    const position = areas.length && !reachable(drag.position, areas) ? rescueRect(drag.position, areas) : drag.position;
    this.#busy = true;
    this.#ending = (async () => {
      try {
        await this.#layout.move(drag.cardId, { x: position.x, y: position.y });
        return { kind: 'moved', cardId: drag.cardId };
      } finally { this.#state.dragSession = null; this.#busy = false; this.#ending = null; }
    })();
    return this.#ending;
  }

  #afterTransfer(cardId, groupId) {
    if (this.#state.operationScope.kind === 'all') {
      this.#state.activeGroupId = groupId; this.#state.selectedCardId = cardId;
    } else if (this.#state.operationScope.kind === 'group' && groupId !== this.#state.operationScope.groupId) {
      if (this.#state.selectedCardId === cardId) this.#state.selectedCardId = null;
      if (this.#state.editingCardId === cardId) this.#state.editingCardId = null;
    }
  }

  async moveToGroup(cardId, groupId) {
    this.#assertIdle(); this.#busy = true;
    try {
      await this.#flush();
      requireValue(this.#getSnapshot().writable, 'read-only', t('errors.core.readOnlyMove'));
      const card = this.#card(cardId);
      requireValue(card, 'missing-card', t('errors.common.noteMissing'));
      await this.#commands.transferCard({ cardId, groupId, expectedRevision: card.revision });
      this.#afterTransfer(cardId, groupId);
    } finally { this.#busy = false; }
  }

  cancelDrag() {
    if (this.#busy || !this.#state.dragSession) return false;
    if (this.#state.dragSession.dragging && !this.#state.dragSession.quick) this.#suppressedCard = this.#state.dragSession.cardId;
    this.#state.dragSession = null;
    return true;
  }

  async applyFormation(plan) {
    plan = copy(plan);
    this.#assertIdle(); this.#busy = true;
    try {
      await this.#flush();
      await this.#layout.applyFormation(plan, this.#getSnapshot);
      await this.#finishEdit(); this.#state.dragSession = null; this.#state.selectedCardId = null;
      this.#state.activeGroupId = plan.scope.kind === 'group' ? plan.scope.groupId : null;
    } finally { this.#busy = false; }
  }

  async reconcile() {
    if (this.#busy) return;
    const drag = this.#state.dragSession;
    if (drag?.quick && !this.#quickHolds(drag)) this.cancelDrag();
    const editing = this.#card(this.#state.editingCardId);
    if (this.#state.editingCardId && (!editing || !eligible(editing, this.#layout.state)
      || !inScope(editing, this.#state.operationScope))) await this.endEdit();
    const selected = this.#card(this.#state.selectedCardId);
    const scope = this.#state.operationScope;
    if (this.#state.selectedCardId && (!selected || !eligible(selected, this.#layout.state)
      || (scope.kind === 'group' && !inScope(selected, scope)))) {
      const candidates = this.#participating(scope.kind === 'group' ? scope.groupId : this.#state.activeGroupId);
      const previousOrder = this.#layout.state.placements[this.#state.selectedCardId]?.order ?? 0;
      const next = candidates.find(card => this.#layout.state.placements[card.id]?.order >= previousOrder) || candidates.at(-1);
      this.#state.selectedCardId = next?.id ?? null;
      if (next) this.#state.activeGroupId = next.groupId;
    } else if (selected) {
      this.#state.activeGroupId = selected.groupId;
    }
    if (this.#state.operationScope.kind === 'group'
      && !activeGroups(this.#getSnapshot()).some(group => group.id === this.#state.operationScope.groupId)) {
      await this.activate({ kind: 'none' });
    }
  }
}
