import { copy, requireValue } from '../core/contracts.js';
import { cardPolicy } from '../interaction/controller.js';
import { canonicalJson } from '../sources/json.js';
import { sha256 } from '../sources/files.js';

const uuid = value => typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const methods = new Set(['pointer.down', 'pointer.move', 'pointer.up', 'pointer.cancel', 'card.select', 'card.edit',
  'card.details', 'card.transfer', 'editor.change', 'editor.save', 'editor.end', 'editor.full', 'interaction.escape', 'interaction.shortcut']);

/** Routes display-only views into the existing owner. This class never creates or persists another Workspace. */
export class DesktopAuthority {
  #workspace; #controller; #sessionId; #editor; #details; #shortcut; #perform; #views = new Map(); #seenViews = new Set();
  #receipts = new Map(); #tail = Promise.resolve(); #draftTail = Promise.resolve(); #pending = 0; #draftPending = 0; #gesture = null; #closed = false;
  #topology = 0; #displayPending = false;
  constructor({ workspace, controller, sessionId, editor, details, shortcut, perform = action => action() }) {
    requireValue(uuid(sessionId), 'desktop-session', '桌面工作階段身分無效。');
    this.#workspace = workspace; this.#controller = controller; this.#sessionId = sessionId;
    this.#editor = editor; this.#details = details; this.#shortcut = shortcut; this.#perform = perform;
  }
  get sessionId() { return this.#sessionId; }
  addView(viewId) {
    requireValue(!this.#closed && uuid(viewId) && !this.#seenViews.has(viewId) && this.#views.size < 64, 'desktop-view', '桌面視窗身分無效。');
    this.#views.set(viewId, { lastSerial: 0, active: true }); this.#seenViews.add(viewId);
  }
  invalidateDisplays() {
    this.#displayPending = true;
    if (this.#gesture && this.#controller.state.dragSession?.generation === this.#gesture.generation) this.#controller.cancelDrag();
    this.#gesture = null;
  }
  configureDisplays(topology, views) {
    requireValue(Number.isSafeInteger(topology) && topology >= this.#topology, 'desktop-topology', '桌面座標版本無效。');
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
    requireValue(!this.#closed && this.#views.has(viewId), 'desktop-view', '桌面視窗已失效。');
    const message = copy(envelope);
    const intent = typeof context.intent === 'string' ? context.intent : null;
    const topology = context.topology ?? 0;
    requireValue(message && message.sessionId === this.#sessionId && uuid(message.id) && methods.has(message.method)
      && Number.isSafeInteger(message.serial) && message.serial >= 1
      && message.args && typeof message.args === 'object' && !Array.isArray(message.args), 'desktop-command', '桌面命令無效。');
    const canonical = canonicalJson(message); const key = `${viewId}:${message.id}`;
    const previous = this.#receipts.get(key);
    const draftWrite = message.method === 'editor.change';
    if (!previous) requireValue(draftWrite ? this.#draftPending < 4 : this.#pending < 24, 'desktop-busy', '桌面操作忙碌，請稍候。');
    const digest = sha256(new TextEncoder().encode(canonical));
    if (previous) return (async () => {
      requireValue(await digest === await previous.digest, 'desktop-replay', '同一操作身分不可更改內容。');
      return copy(await previous.result);
    })();
    const view = this.#views.get(viewId);
    requireValue(message.serial > view.lastSerial, 'desktop-expired', '操作回覆已過期，未重新執行舊命令。');
    view.lastSerial = message.serial;
    if (draftWrite) this.#draftPending++; else this.#pending++;
    // A scope/edit command can await a view's flush barrier. Its final draft write must not queue behind that command.
    // Lifecycle commands wait only for writes already admitted, never future barrier writes.
    const earlierDrafts = this.#draftTail;
    const result = (draftWrite ? this.#draftTail : this.#tail).then(async () => {
      await digest;
      if (!draftWrite) await earlierDrafts;
      requireValue(!this.#closed && this.#views.get(viewId) === view, 'desktop-view', '桌面視窗已失效，尚未執行命令。');
      const invoke = () => {
        requireValue(!this.#closed && this.#views.get(viewId) === view, 'desktop-view', '桌面視窗已失效，尚未執行命令。');
        requireValue(draftWrite || !this.#displayPending && view.active && topology === this.#topology,
          'desktop-topology', '顯示器正在更新，請稍候再操作；目前文字仍保留。');
        return this.#invoke(viewId, message.method, message.args, intent);
      };
      return draftWrite ? invoke() : this.#perform(invoke);
    });
    const receipt = { digest, result, settled: false }; this.#receipts.set(key, receipt);
    const tail = result.catch(() => {}).finally(() => {
      if (draftWrite) this.#draftPending--; else this.#pending--; receipt.settled = true;
      for (const [oldKey, entry] of this.#receipts) {
        if (this.#receipts.size <= 256) break;
        if (entry.settled) this.#receipts.delete(oldKey);
      }
    });
    if (draftWrite) this.#draftTail = tail; else this.#tail = tail;
    return result.then(copy);
  }

  #card(cardId) {
    const card = this.#workspace.snapshot.cards.find(card => card.id === cardId);
    requireValue(card && cardPolicy(card, this.#workspace.layout.state, this.#controller.state).draggable,
      'outside-scope', '這張便箋目前不在調整範圍。');
    return card;
  }
  #point(point) {
    requireValue(point && Number.isFinite(point.x) && Number.isFinite(point.y)
      && Math.abs(point.x) <= 1_000_000 && Math.abs(point.y) <= 1_000_000, 'desktop-point', '桌面座標無效。');
    return point;
  }
  #matchGesture(viewId, args) {
    requireValue(this.#gesture?.viewId === viewId && this.#gesture.id === args.gestureId
      && this.#gesture.pointerId === args.pointerId, 'desktop-gesture', '這個指標不屬於目前拖曳。');
  }
  #labels(args) {
    const labels = args.labels ?? [];
    requireValue(Array.isArray(labels) && labels.length <= 9 && labels.every(label => label && typeof label.groupId === 'string'
      && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(label[key]))
      && label.width > 0 && label.height > 0), 'desktop-label', '群組接收標籤無效。');
    return labels;
  }

  async #invoke(viewId, method, args, intent) {
    const controller = this.#controller;
    const drag = controller.state.dragSession;
    if (this.#gesture && drag?.generation !== this.#gesture.generation) this.#gesture = null;
    switch (method) {
      case 'interaction.shortcut': {
        const bindings = this.#workspace.layout.state.shortcuts;
        requireValue(typeof args.key === 'string' && Object.hasOwn(bindings, args.key) && this.#shortcut,
          'desktop-shortcut', '快捷鍵已變更，請使用目前設定。');
        return this.#shortcut(bindings[args.key], intent);
      }
      case 'pointer.down': {
        requireValue(!this.#gesture && uuid(args.gestureId) && Number.isSafeInteger(args.pointerId) && args.pointerId >= 0,
          'desktop-gesture', '拖曳身分無效或另一個指標仍在操作。');
        this.#card(args.cardId); this.#point(args.point);
        const accepted = controller.pointerDown(args.cardId, args.point, { pointerId: args.pointerId, handle: args.handle === true });
        if (accepted) this.#gesture = { viewId, id: args.gestureId, pointerId: args.pointerId, cardId: args.cardId,
          generation: controller.state.dragSession.generation };
        return { accepted };
      }
      case 'pointer.move':
        this.#matchGesture(viewId, args);
        return controller.pointerMove(this.#point(args.point), { pointerId: args.pointerId, shiftKey: args.shiftKey === true, labels: this.#labels(args) });
      case 'pointer.up': {
        this.#matchGesture(viewId, args); const cardId = this.#gesture.cardId;
        this.#point(args.point); const labels = this.#labels(args);
        try {
          const result = await controller.pointerUp(args.point, { pointerId: args.pointerId, shiftKey: args.shiftKey === true, labels });
          if (result.kind === 'click') await controller.select(cardId, { gesture: true });
          return result;
        } finally { this.#gesture = null; }
      }
      case 'pointer.cancel':
        this.#matchGesture(viewId, args); controller.cancelDrag(); this.#gesture = null; return null;
      case 'card.select': this.#card(args.cardId); return controller.select(args.cardId, { gesture: true });
      case 'card.edit': this.#card(args.cardId); return this.#editor.begin(args.cardId, viewId);
      case 'card.details': this.#card(args.cardId); return this.#details(args.cardId, intent);
      case 'card.transfer': this.#card(args.cardId); return controller.moveToGroup(args.cardId, args.groupId);
      case 'editor.change': {
        const current = this.#editor.current();
        requireValue(current && current.viewId === viewId && current.draftId === args.draftId,
          'desktop-editor', '這個文字編輯視窗已失效，請保留輸入內容。');
        requireValue(typeof args.text === 'string' && Number.isSafeInteger(args.sequence) && args.sequence >= 1,
          'desktop-editor', '草稿輸入格式無效。');
        // Saved text can be retried after acknowledgement loss, but a delayed older edit cannot replace newer text.
        if (args.sequence <= current.sequence) {
          requireValue(args.sequence === current.sequence && args.text === current.text,
            'desktop-edit-order', '已收到較新的草稿輸入，未套用舊文字。');
          return { sequence: current.sequence };
        }
        requireValue(args.sequence === current.sequence + 1, 'desktop-edit-order', '草稿輸入順序不連續，請保留文字後重試。');
        await this.#editor.change({ ...current, text: args.text, sequence: args.sequence });
        return { sequence: args.sequence };
      }
      case 'editor.save': case 'editor.end': case 'editor.full': {
        const current = this.#editor.current();
        requireValue(current && current.viewId === viewId && current.draftId === args.draftId
          && current.sequence === args.sequence, 'desktop-editor', '草稿仍在保存或編輯視窗已失效。');
        return method === 'editor.save' ? this.#editor.save() : method === 'editor.full' ? this.#editor.full(intent) : this.#editor.end();
      }
      case 'interaction.escape': {
        const current = this.#editor.current();
        requireValue(!current || current.viewId === viewId, 'desktop-editor', '請先完成另一個視窗的文字輸入。');
        const result = await controller.escape({ consumed: args.consumed === true });
        if (!controller.state.dragSession) this.#gesture = null;
        return result;
      }
      default: throw new Error('Unreachable desktop command');
    }
  }
}
