import { onLocaleChange, t } from '../i18n/index.js';

/** Session-only notices. Keys update a job in place; dismissed identical background failures stay dismissed. */
export class NotificationQueue {
  constructor({ changed = () => {}, now = () => Date.now(), schedule = (callback, delay) => setTimeout(callback, delay), cancel = id => clearTimeout(id) } = {}) {
    this.items = new Map(); this.dismissed = new Map(); this.sequence = 0;
    this.changed = changed; this.now = now; this.schedule = schedule; this.cancel = cancel;
  }
  show(text, { id = `notice-${++this.sequence}`, kind = 'info', action = null, duration, context = '', renew = false } = {}) {
    if (!text) { this.clear(id); return id; }
    const signature = JSON.stringify([text, kind, action?.label, context]);
    const old = this.items.get(id);
    if (old?.signature === signature && !renew) { old.action = action; return id; }
    const dismissed = this.dismissed.get(id);
    if (!renew && (dismissed?.signature === signature || dismissed?.kind === 'progress' && kind === 'progress')) return id;
    this.dismissed.delete(id);
    if (old) this.cancel(old.timer);
    const remaining = duration ?? (kind === 'error' || kind === 'progress' || action ? Infinity : Math.max(5000, Math.min(15000, text.length * 60)));
    const item = { id, text, context, kind, action, signature, remaining, pauses: old?.pauses ?? new Set() };
    this.items.delete(id); this.items.set(id, item); this.arm(item); this.changed(); return id;
  }
  arm(item) {
    item.started = this.now();
    if (Number.isFinite(item.remaining) && !item.pauses.size) item.timer = this.schedule(() => this.dismiss(item.id), item.remaining);
  }
  pause(id, reason, paused) {
    const item = this.items.get(id); if (!item) return;
    if (paused && !item.pauses.has(reason)) {
      if (!item.pauses.size) { this.cancel(item.timer); item.remaining -= this.now() - item.started; }
      item.pauses.add(reason);
    } else if (!paused && item.pauses.delete(reason) && !item.pauses.size) this.arm(item);
  }
  dismiss(id) {
    const item = this.items.get(id); if (!item) return;
    this.dismissed.set(id, { signature: item.signature, kind: item.kind }); this.remove(id);
  }
  clear(id) { this.dismissed.delete(id); this.remove(id); }
  remove(id) {
    const item = this.items.get(id); if (!item) return;
    this.cancel(item.timer); this.items.delete(id); this.changed();
  }
}

let shared;
/** Import-safe: the DOM and observers are created only when the page first uses a notice. */
export function notifications() { return shared ??= createNotifications(document); }

export function createNotifications(doc) {
  const host = doc.createElement('div'); host.className = 'toast-host'; host.id = 'toast-host';
  host.setAttribute('popover', 'manual'); host.setAttribute('role', 'region');
  const popover = typeof host.showPopover === 'function';
  if (!popover) { host.removeAttribute('popover'); host.dataset.fallback = 'true'; }
  const isOpen = () => popover && host.matches(':popover-open');
  const views = new Map(), dialogs = [];
  const queue = new NotificationQueue({ changed: render });
  const modal = node => node.isConnected && node.matches('dialog:modal');
  const owner = () => dialogs.filter(modal).at(-1) ?? [...doc.querySelectorAll('dialog:modal')].at(-1) ?? doc.body;
  const observer = new MutationObserver(records => {
    for (const record of records) if (record.type === 'attributes' && modal(record.target)) {
      const index = dialogs.indexOf(record.target); if (index >= 0) dialogs.splice(index, 1);
      dialogs.push(record.target);
    }
    place();
  });
  function place() {
    for (let index = dialogs.length - 1; index >= 0; index--) if (!modal(dialogs[index])) dialogs.splice(index, 1);
    const parent = owner();
    if (host.parentElement !== parent) {
      if (isOpen()) host.hidePopover();
      parent.append(host);
    }
    host.dataset.modal = String(parent !== doc.body);
    // A parent operation waits while a child asks for consent. Its Cancel must not compete with the decision's Cancel.
    for (const view of views.values()) view.root.hidden = view.kind === 'progress' && view.owner !== parent
      && parent !== doc.body && !['settings-dialog', 'editor-dialog'].includes(parent.id);
    const visible = [...views.values()].some(view => !view.root.hidden);
    if (!popover) host.style.position = parent === doc.body ? 'fixed' : 'absolute';
    if (popover && visible && !isOpen()) host.showPopover();
    else if (!visible && isOpen()) host.hidePopover();
    host.style.top = ''; host.style.bottom = ''; host.style.maxHeight = '';
    if (parent !== doc.body && visible) {
      // The phone's Data page ends in restore/reset actions; its page list and Account page have actions at the top.
      if (parent.classList.contains('settings') && !parent.classList.contains('listing')
        && parent.querySelector('[data-panel=data]')?.hidden === false && doc.defaultView.innerWidth <= 640) {
        const header = [...parent.querySelectorAll('.settings-head,.nav-head')].map(node => node.getBoundingClientRect()).find(rect => rect.width && rect.height);
        if (header) {
          const top = header.bottom + 8 - (popover ? 0 : parent.getBoundingClientRect().top);
          host.style.top = `${Math.ceil(top)}px`; host.style.bottom = 'auto';
          host.style.maxHeight = `${Math.max(44, Math.min(doc.defaultView.innerHeight * 0.4, doc.defaultView.innerHeight - top - 16))}px`;
          return;
        }
      }
      const bounds = host.getBoundingClientRect();
      const actions = [...parent.querySelectorAll(':scope > .dialog-actions, :scope > form > .dialog-actions, :scope > button')]
        .map(node => node.getBoundingClientRect()).filter(rect => rect.width && rect.height);
      if (actions.some(rect => bounds.bottom > rect.top && bounds.top < rect.bottom && bounds.right > rect.left && bounds.left < rect.right)) {
        const top = Math.min(...actions.map(rect => rect.top)) - (popover ? 0 : parent.getBoundingClientRect().top);
        const height = popover ? doc.defaultView.innerHeight : parent.getBoundingClientRect().height;
        host.style.bottom = `${Math.ceil(height - top + 12)}px`;
        host.style.maxHeight = `${Math.max(44, Math.floor(top - 28))}px`;
      }
    }
  }
  function render() {
    host.setAttribute('aria-label', t('common.notifications'));
    for (const [id, view] of views) if (!queue.items.has(id)) {
      // Expiration never moves focus; a focused notice is paused until focus leaves.
      view.root.remove(); views.delete(id);
    }
    for (const item of queue.items.values()) {
      let view = views.get(item.id);
      if (!view) {
        const root = doc.createElement('div'); root.className = 'toast'; root.dataset.noticeId = item.id;
        const copy = doc.createElement('div'); copy.className = 'toast-copy'; copy.setAttribute('aria-atomic', 'true');
        const context = doc.createElement('div'); context.className = 'toast-context';
        const message = doc.createElement('div'); message.className = 'toast-message'; copy.append(context, message);
        const action = doc.createElement('button'); action.type = 'button'; action.className = 'toast-action';
        const close = doc.createElement('button'); close.type = 'button'; close.className = 'toast-close'; close.textContent = '×';
        close.onclick = event => {
          const focused = root.contains(doc.activeElement) || event.detail > 0, returnFocus = view.returnFocus;
          queue.dismiss(item.id);
          if (focused && returnFocus?.isConnected && !returnFocus.closest('[inert]')) returnFocus.focus({ preventScroll: true });
        };
        action.onclick = async () => {
          const current = queue.items.get(item.id); if (!current?.action || action.disabled) return;
          action.disabled = true;
          try { await current.action.run(); if (!current.action.keepOpen && queue.items.get(item.id) === current) queue.clear(item.id); }
          catch (error) { queue.show(error.message, { id: item.id, kind: 'error', context: current.context, action: current.action }); }
          finally { action.disabled = false; }
        };
        root.addEventListener('pointerenter', () => queue.pause(item.id, 'pointer', true));
        root.addEventListener('pointerleave', () => queue.pause(item.id, 'pointer', false));
        root.addEventListener('pointerdown', () => {
          // Safari can blur an input without focusing a clicked button, so remember it before the default pointer action.
          if (!root.contains(doc.activeElement)) view.returnFocus = doc.activeElement;
        });
        root.addEventListener('focusin', event => {
          if (event.relatedTarget && !root.contains(event.relatedTarget)) view.returnFocus = event.relatedTarget;
          queue.pause(item.id, 'focus', true);
        });
        root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) queue.pause(item.id, 'focus', false); });
        root.append(copy, action, close); host.append(root); view = { root, copy, context, message, action, close }; views.set(item.id, view);
      }
      view.root.dataset.kind = item.kind;
      if (item.kind === 'progress' && view.kind !== 'progress') view.owner = owner();
      view.kind = item.kind;
      view.root.dataset.latest = String(item === [...queue.items.values()].at(-1));
      view.message.classList.toggle('error', item.kind === 'error');
      view.copy.setAttribute('role', item.kind === 'error' ? 'alert' : 'status');
      view.context.hidden = !item.context; if (view.context.textContent !== item.context) view.context.textContent = item.context;
      if (view.message.textContent !== item.text) view.message.textContent = item.text;
      view.action.hidden = !item.action; view.action.textContent = item.action?.label ?? '';
      view.close.setAttribute('aria-label', t('common.dismissNotification'));
      queue.pause(item.id, 'hidden', doc.hidden);
    }
    place();
  }
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  new ResizeObserver(place).observe(host);
  doc.defaultView.addEventListener('resize', place);
  doc.addEventListener('visibilitychange', () => { for (const id of queue.items.keys()) queue.pause(id, 'hidden', doc.hidden); });
  onLocaleChange(render);
  return queue;
}
