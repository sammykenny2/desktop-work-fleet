import { copy, requireValue } from '../core/contracts.js';
import { cardPolicy } from '../interaction/controller.js';
import { restingLayer } from '../layout/stages.js';
import { resolveShortcuts } from '../core/shortcuts.js';
import { canonicalJson } from '../sources/json.js';
import { sha256 } from '../sources/files.js';
import { t } from '../i18n/index.js';

const uuid = value => typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const methods = new Set(['pointer.down', 'pointer.move', 'pointer.up', 'pointer.cancel', 'card.select', 'card.edit',
  'card.transfer', 'card.check', 'editor.change', 'editor.save', 'editor.end', 'editor.full', 'editor.cancel', 'interaction.escape', 'interaction.shortcut',
  'interaction.done', 'layout.arrange', 'attachment.preview', 'attachment.open']);
const arrangements = new Set(['stack', 'spread', 'undo']);

/** Routes display-only views into the existing owner. This class never creates or persists another Workspace. */
export class DesktopAuthority {
  #workspace; #controller; #sessionId; #editor; #check; #shortcut; #arrange; #perform; #residentLayers; #liftQuickMove; #views = new Map(); #seenViews = new Set();
  #receipts = new Map(); #tail = Promise.resolve(); #draftTail = Promise.resolve(); #pending = 0; #draftPending = 0; #gesture = null; #dropped = null; #closed = false;
  #topology = 0; #displayPending = false;
  #attachments;
  #previewTails = [Promise.resolve(), Promise.resolve()]; #previewNext = 0; #previewPending = 0;
  constructor({ workspace, controller, sessionId, editor, check, shortcut, arrange, attachments, residentLayers = () => ['desktop', 'floating'],
    liftQuickMove = () => false, perform = action => action() }) {
    requireValue(uuid(sessionId), 'desktop-session', t('errors.desktop.sessionInvalid'));
    this.#workspace = workspace; this.#controller = controller; this.#sessionId = sessionId;
    this.#editor = editor; this.#check = check; this.#shortcut = shortcut; this.#arrange = arrange; this.#perform = perform;
    this.#attachments = attachments; this.#residentLayers = residentLayers; this.#liftQuickMove = liftQuickMove;
  }
  get sessionId() { return this.#sessionId; }
  addView(viewId) {
    requireValue(!this.#closed && uuid(viewId) && !this.#seenViews.has(viewId) && this.#views.size < 64, 'desktop-view', t('errors.desktop.viewInvalid'));
    this.#views.set(viewId, { lastSerial: 0, active: true }); this.#seenViews.add(viewId);
  }
  invalidateDisplays() {
    this.#displayPending = true;
    if (this.#gesture && this.#controller.state.dragSession?.generation === this.#gesture.generation) this.#controller.cancelDrag();
    this.#gesture = null;
  }
  configureDisplays(topology, views) {
    requireValue(Number.isSafeInteger(topology) && topology >= this.#topology, 'desktop-topology', t('errors.desktop.topologyInvalid'));
    const live = new Set(views.map(view => view.viewId));
    for (const id of this.#views.keys()) if (!live.has(id)) this.removeView(id);
    for (const view of views) {
      if (!this.#views.has(view.viewId)) this.addView(view.viewId);
      this.#views.get(view.viewId).active = view.active !== false;
    }
    this.#topology = topology; this.#displayPending = false;
  }
  removeView(viewId) {
    this.#views.delete(viewId);
    if (this.#gesture?.viewId === viewId) {
      if (this.#controller.state.dragSession?.generation === this.#gesture.generation) this.#controller.cancelDrag();
      this.#gesture = null;
    }
  }
  close() {
    this.#closed = true; this.#views.clear();
    if (this.#gesture && this.#controller.state.dragSession?.generation === this.#gesture.generation) this.#controller.cancelDrag(); this.#gesture = null;
  }
  async whenIdle() { await Promise.all([this.#tail, this.#draftTail]); }
  async whenDraftIdle() { await this.#draftTail; }

  request(viewId, envelope, context = {}) {
    requireValue(!this.#closed && this.#views.has(viewId), 'desktop-view', t('errors.desktop.viewGone'));
    const message = copy(envelope);
    const intent = typeof context.intent === 'string' ? context.intent : null;
    const topology = context.topology ?? 0;
    requireValue(message && message.sessionId === this.#sessionId && uuid(message.id) && methods.has(message.method)
      && Number.isSafeInteger(message.serial) && message.serial >= 1
      && message.args && typeof message.args === 'object' && !Array.isArray(message.args), 'desktop-command', t('errors.desktop.commandInvalid'));
    const canonical = canonicalJson(message); const key = `${viewId}:${message.id}`;
    const previous = this.#receipts.get(key);
    const draftWrite = message.method === 'editor.change';
    const preview = message.method === 'attachment.preview';
    if (!previous) requireValue(preview ? this.#previewPending < 64 : draftWrite ? this.#draftPending < 4 : this.#pending < 24, 'desktop-busy', t('errors.desktop.busy'));
    const digest = sha256(new TextEncoder().encode(canonical));
    if (previous) return (async () => {
      requireValue(await digest === await previous.digest, 'desktop-replay', t('errors.desktop.replayChanged'));
      return copy(await previous.result);
    })();
    const view = this.#views.get(viewId);
    requireValue(message.serial > view.lastSerial, 'desktop-expired', t('errors.desktop.replyExpired'));
    view.lastSerial = message.serial;
    if (preview) this.#previewPending++; else if (draftWrite) this.#draftPending++; else this.#pending++;
    // A scope/edit command can await a view's flush barrier. Its final draft write must not queue behind that command.
    // Lifecycle commands wait only for writes already admitted, never future barrier writes.
    const earlierDrafts = this.#draftTail;
    const previewLane = preview ? this.#previewNext++ % this.#previewTails.length : 0;
    const result = (preview ? this.#previewTails[previewLane] : draftWrite ? this.#draftTail : this.#tail).then(async () => {
      await digest;
      if (!draftWrite && !preview) await earlierDrafts;
      requireValue(!this.#closed && this.#views.get(viewId) === view, 'desktop-view', t('errors.desktop.viewGoneNotRun'));
      const invoke = () => {
        requireValue(!this.#closed && this.#views.get(viewId) === view, 'desktop-view', t('errors.desktop.viewGoneNotRun'));
        requireValue(draftWrite || !this.#displayPending && view.active && topology === this.#topology,
          'desktop-topology', t('errors.desktop.displaysUpdating'));
        return this.#invoke(viewId, message.method, message.args, intent);
      };
      return draftWrite || preview ? invoke() : this.#perform(invoke);
    });
    const receipt = { digest, result, settled: false }; this.#receipts.set(key, receipt);
    const tail = result.catch(() => {}).finally(() => {
      if (preview) this.#previewPending--; else if (draftWrite) this.#draftPending--; else this.#pending--; receipt.settled = true;
      for (const [oldKey, entry] of this.#receipts) {
        if (this.#receipts.size <= 256) break;
        if (entry.settled) this.#receipts.delete(oldKey);
      }
    });
    if (preview) this.#previewTails[previewLane] = tail; else if (draftWrite) this.#draftTail = tail; else this.#tail = tail;
    return result.then(copy);
  }

  #card(cardId) {
    const card = this.#workspace.working.cards.find(card => card.id === cardId);
    requireValue(card && cardPolicy(card, this.#workspace.layout.state, this.#controller.state).draggable,
      'outside-scope', t('errors.desktop.outsideScope'));
    return card;
  }
  // Whether the paper takes clicks as the scenes draw it: a resting paper whose layer this desktop cannot offer rests on
  // the desktop or the wallpaper (see projectDesktop), and wallpaper papers let clicks through.
  #takesClicks(policy) {
    if (!policy.visible || !policy.interactive) return false;
    if (policy.draggable) return true;
    const resting = this.#residentLayers();
    return restingLayer(policy.layer, resting) !== 'wallpaper';
  }
  #point(point) {
    requireValue(point && Number.isFinite(point.x) && Number.isFinite(point.y)
      && Math.abs(point.x) <= 1_000_000 && Math.abs(point.y) <= 1_000_000, 'desktop-point', t('errors.desktop.pointInvalid'));
    return point;
  }
  #matchGesture(viewId, args) {
    requireValue(this.#gesture?.viewId === viewId && this.#gesture.id === args.gestureId
      && this.#gesture.pointerId === args.pointerId, 'desktop-gesture', t('errors.desktop.gestureMismatch'));
  }
  #labels(args) {
    const labels = args.labels ?? [];
    requireValue(Array.isArray(labels) && labels.length <= 9 && labels.every(label => label && typeof label.groupId === 'string'
      && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(label[key]))
      && label.width > 0 && label.height > 0), 'desktop-label', t('errors.desktop.labelsInvalid'));
    return labels;
  }

  async #invoke(viewId, method, args, intent) {
    const controller = this.#controller;
    const drag = controller.state.dragSession;
    // A quick move the owner ended (adjust mode began, or the paper stopped allowing it) ends quietly in its scene.
    if (this.#gesture && drag?.generation !== this.#gesture.generation) {
      this.#dropped = this.#gesture.quick ? this.#gesture : null; this.#gesture = null;
    }
    if (method.startsWith('pointer.') && method !== 'pointer.down' && this.#dropped?.viewId === viewId
      && this.#dropped.id === args.gestureId && this.#dropped.pointerId === args.pointerId) {
      if (method !== 'pointer.move') this.#dropped = null;
      return method === 'pointer.cancel' ? null : { kind: 'cancelled', reason: 'quick-move-ended' };
    }
    switch (method) {
      case 'attachment.preview': case 'attachment.open': {
        const card = this.#workspace.working.cards.find(value => value.id === args.cardId);
        requireValue(card && card.revision === args.revision, 'desktop-expired', t('errors.desktop.attachmentChanged'));
        const policy = cardPolicy(card, this.#workspace.layout.state, controller.state);
        requireValue(policy.visible && (method === 'attachment.preview' || this.#takesClicks(policy)), 'outside-scope', t('errors.desktop.cardUnavailable'));
        const file = card.content.attachments?.find(value => value.id === args.attachmentId);
        requireValue(file && this.#attachments, 'missing-attachment', t('errors.desktop.attachmentMissing'));
        const result = await this.#attachments(method, copy(file));
        requireValue(!this.#closed && this.#views.has(viewId), 'desktop-view', t('errors.desktop.viewGone'));
        return result;
      }
      case 'interaction.shortcut': {
        const layout = this.#workspace.layout.state; const bindings = resolveShortcuts(layout.shortcuts, layout.grid.slots);
        requireValue(typeof args.key === 'string' && Object.hasOwn(bindings, args.key) && this.#shortcut,
          'desktop-shortcut', t('errors.desktop.shortcutChanged'));
        return this.#shortcut(bindings[args.key], intent);
      }
      case 'pointer.down': {
        requireValue(!this.#gesture && uuid(args.gestureId) && Number.isSafeInteger(args.pointerId) && args.pointerId >= 0,
          'desktop-gesture', t('errors.desktop.gestureInvalid'));
        // A quick move starts on a resting paper that takes clicks as this host draws it, never on an adjusted one.
        const quick = args.quick === true; this.#dropped = null;
        if (quick) {
          const card = this.#workspace.working.cards.find(value => value.id === args.cardId && !value.deleted);
          const policy = card && cardPolicy(card, this.#workspace.layout.state, controller.state);
          requireValue(policy && !policy.draggable && this.#takesClicks(policy), 'outside-scope', t('errors.desktop.cardUnavailable'));
        } else this.#card(args.cardId);
        this.#point(args.point);
        const accepted = controller.pointerDown(args.cardId, args.point, { pointerId: args.pointerId, handle: args.handle === true, quick,
          lift: quick && this.#liftQuickMove() === true });
        if (accepted) this.#gesture = { viewId, id: args.gestureId, pointerId: args.pointerId, cardId: args.cardId, quick,
          generation: controller.state.dragSession.generation };
        return { accepted };
      }
      case 'pointer.move':
        this.#matchGesture(viewId, args);
        return controller.pointerMove(this.#point(args.point), { pointerId: args.pointerId, shiftKey: args.shiftKey === true, labels: this.#labels(args) });
      case 'pointer.up': {
        this.#matchGesture(viewId, args); const { cardId, quick } = this.#gesture;
        this.#point(args.point); const labels = this.#labels(args);
        try {
          const result = await controller.pointerUp(args.point, { pointerId: args.pointerId, shiftKey: args.shiftKey === true, labels });
          // A quick move that never passed the threshold changes nothing: a resting paper is not selected.
          if (result.kind === 'click' && !quick) await controller.select(cardId, { gesture: true });
          return result;
        } finally { this.#gesture = null; }
      }
      case 'pointer.cancel':
        this.#matchGesture(viewId, args); controller.cancelDrag(); this.#gesture = null; return null;
      case 'card.select': this.#card(args.cardId); return controller.select(args.cardId, { gesture: true });
      // Adjust mode only arranges (SPEC-003, 2026-10-24): a resting paper that takes clicks opens for a quick edit.
      case 'card.edit': {
        const card = this.#workspace.working.cards.find(value => value.id === args.cardId && !value.deleted);
        const policy = card && cardPolicy(card, this.#workspace.layout.state, controller.state);
        requireValue(policy && controller.state.operationScope.kind === 'none' && !policy.draggable && this.#takesClicks(policy),
          'outside-scope', t('errors.desktop.cardUnavailable'));
        return this.#editor.begin(args.cardId, viewId);
      }
      case 'card.transfer': this.#card(args.cardId); return controller.moveToGroup(args.cardId, args.groupId);
      // A checkbox on a paper that takes clicks ticks that step of the text it was drawn from, never a newer one.
      case 'card.check': {
        const card = this.#workspace.working.cards.find(value => value.id === args.cardId);
        requireValue(card && card.revision === args.revision, 'desktop-expired', t('errors.desktop.noteChanged'));
        const policy = cardPolicy(card, this.#workspace.layout.state, controller.state);
        requireValue(this.#takesClicks(policy) && !policy.editing && this.#check, 'outside-scope', t('errors.desktop.cardUnavailable'));
        requireValue(Number.isSafeInteger(args.task) && args.task >= 0, 'desktop-command', t('errors.desktop.commandInvalid'));
        return this.#check(card.id, card.revision, args.task);
      }
      case 'editor.change': {
        const current = this.#editor.current();
        requireValue(current && current.viewId === viewId && current.draftId === args.draftId,
          'desktop-editor', t('errors.desktop.editorGone'));
        requireValue(typeof args.text === 'string' && Number.isSafeInteger(args.sequence) && args.sequence >= 1,
          'desktop-editor', t('errors.desktop.draftInvalid'));
        // Saved text can be retried after acknowledgement loss, but a delayed older edit cannot replace newer text.
        if (args.sequence <= current.sequence) {
          requireValue(args.sequence === current.sequence && args.text === current.text,
            'desktop-edit-order', t('errors.desktop.draftStale'));
          return { sequence: current.sequence };
        }
        requireValue(args.sequence === current.sequence + 1, 'desktop-edit-order', t('errors.desktop.draftGap'));
        await this.#editor.change({ ...current, text: args.text, sequence: args.sequence });
        return { sequence: args.sequence };
      }
      case 'editor.save': case 'editor.end': case 'editor.full': case 'editor.cancel': {
        const current = this.#editor.current();
        requireValue(current && current.viewId === viewId && current.draftId === args.draftId
          && current.sequence === args.sequence, 'desktop-editor', t('errors.desktop.draftBusy'));
        if (method === 'editor.save') return this.#editor.save();
        if (method === 'editor.full') return this.#editor.full(intent);
        return method === 'editor.cancel' ? this.#editor.cancel() : this.#editor.end();
      }
      // The adjust overlay's own buttons, for desktops where the main window is hidden while adjusting.
      case 'interaction.done': return controller.activate({ kind: 'none' });
      case 'layout.arrange':
        requireValue(arrangements.has(args.kind) && this.#arrange && controller.state.operationScope.kind !== 'none',
          'desktop-arrange', t('errors.desktop.arrangeNotAdjusting'));
        return this.#arrange(args.kind);
      case 'interaction.escape': {
        const current = this.#editor.current();
        requireValue(!current || current.viewId === viewId, 'desktop-editor', t('errors.desktop.otherWindowEditing'));
        const result = await controller.escape({ consumed: args.consumed === true });
        if (!controller.state.dragSession) this.#gesture = null;
        return result;
      }
      default: throw new Error('Unreachable desktop command');
    }
  }
}
