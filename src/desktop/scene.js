import { NativeBridge, nativeTransport } from '../native/bridge.js';
import { renderMarkdown } from '../app/markdown.js';
import { renderAttachmentTiles } from '../app/attachments.js';
import { fitText, fitTiles, paperFitter } from '../app/fit.js';
import { DesktopClient, DesktopDraft } from './client.js';
import { download, parse } from './transport.js';
import { shortcutForEvent } from '../core/shortcuts.js';
import { createFrameRefresher } from './frame-refresh.js';
import { getLocale, localizeDocument, setLocale, t } from '../i18n/index.js';

const root = document.querySelector('#scene'); const status = document.querySelector('#scene-status');
const nodes = new Map(); const frozen = new Set(); const fitter = paperFitter();
let bridge, client, info, frame, editor = null, composing = false, gesture = null, lastError, displayPending = false;
let repaintPending = false; let drawnLocale = null;
const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const rect = (node, value) => Object.assign(node.style, { left: `${value.x}px`, top: `${value.y}px`, width: `${value.width}px`, height: `${value.height}px` });
const report = error => {
  status.textContent = error.message; status.hidden = false; if (editor) draftStatus(error.message, true);
  if (bridge && lastError !== error.message) { lastError = error.message; void bridge.request('scene.report', { message: String(error.message).slice(0,2000) }).catch(() => {}); }
};
const run = action => Promise.resolve().then(action).catch(report);
const point = event => ({ x: info.viewport.x + event.clientX, y: info.viewport.y + event.clientY });
const labels = () => (frame?.groups || []).filter(g => g.region).map(g => ({ groupId: g.id, x: g.region.x + 8, y: g.region.y + 5, width: 160, height: 28 }));
const button = (text, action) => { const node = make('button', text); node.type = 'button'; node.onclick = event => { event.stopPropagation(); void run(action); }; return node; };
function draftStatus(text, error = false) { const state = root.querySelector('.draft-state'); if (state) { state.textContent = text; state.classList.toggle('error', error); } }
function captureIntent() {
  try { return bridge.request('scene.intent').then(value => value.intent).catch(() => null); }
  catch { return Promise.resolve(null); }
}
async function saveDraft() {
  if (!editor || composing) return;
  const current = editor; draftStatus(t('desktop.draft.saving')); await current.flush(); if (editor === current) draftStatus(t('desktop.draft.saved'));
}
async function editAction(method) {
  if (!editor || composing) return;
  const intent = method === 'editor.full' ? captureIntent() : Promise.resolve(null);
  await saveDraft(); await client.command(method, { draftId: editor.draftId, sequence: editor.sequence }, await intent);
}
function updateFrozen() { const input = root.querySelector('textarea'); if (input) input.readOnly = frozen.size > 0; }
function render(next) {
  if (next.sessionId !== info.sessionId || frame && next.sequence <= frame.sequence) return false;
  const active = next.editor?.viewId === info.viewId ? next.editor : null;
  if (editor && editor.draftId !== active?.draftId && (editor.dirty || composing)) throw new Error(t('errors.desktop.unconfirmedInput'));
  // The scene shows the main window's language: every frame carries the owner's locale. Nodes that outlive a frame
  // follow a change here; buttons and region labels are rebuilt below, and status lines keep theirs until updated.
  setLocale(next.locale); const relocalized = drawnLocale !== getLocale();
  if (relocalized) {
    localizeDocument(); renderAdjustOverlay(false);
    root.querySelector('.inline-editor')?.setAttribute('aria-label', t('desktop.editor.label'));
  }
  if (!active) { editor = null; frozen.clear(); }
  else if (!editor || editor.draftId !== active.draftId) editor = new DesktopDraft(client, active);
  frame = next; status.hidden = true;
  for (const region of root.querySelectorAll('.region,.region-label')) region.remove();
  if (info.layer === 'floating' && frame.operationScope.kind !== 'none') for (const group of frame.groups.filter(g => g.region)) {
    const boundary = make('div', undefined, 'region'); rect(boundary, group.region); root.append(boundary);
    const label = make('div', group.name, `region-label${frame.dropTarget?.groupId === group.id ? ' target' : ''}`);
    label.style.left = `${group.region.x + 8}px`; label.style.top = `${group.region.y + 5}px`; root.append(label);
  }
  renderNotice(info.layer === 'floating' ? next.notice : null);
  const overlay = info.adjustOverlay === true && info.layer === 'floating' && next.operationScope.kind !== 'none';
  renderAdjustOverlay(overlay);
  const cards = next.cards.filter(card => card.layer === info.layer); const live = new Set(cards.map(card => card.id));
  for (const [id, item] of nodes) if (!live.has(id)) {
    item.disposeAttachments?.(); fitter.unobserve(item.body); fitter.unobserve(item.files); item.paper.remove(); nodes.delete(id);
  }
  cards.forEach((card, index) => {
    let item = nodes.get(card.id);
    if (!item) {
      const paper = make('article'); paper.dataset.cardId = card.id;
      const summary = make('div', '', 'card-summary'); const body = make('div', '', 'card-body markdown'); const actions = make('div', '', 'card-actions');
      // Attachments sit in their own row between the text and the buttons.
      const files = make('div', undefined, 'paper-files'); files.hidden = true;
      paper.append(summary, body, files, actions); root.append(paper); item = { paper, summary, body, files, actions }; nodes.set(card.id, item);
      fitter.observe(body); fitter.observe(files);
    }
    const { paper, summary, body, actions } = item;
    paper.className = `card${card.interactive ? ' interactive' : ''}${card.draggable ? ' operable' : ' selectable'}${card.selected ? ' selected' : ''}${card.mine ? ' mine' : ''}${card.completed ? ' completed' : ''}`;
    // Topmost papers resting outside the adjusted scope stay under the overlay's tint, like the papers on lower layers.
    paper.style.setProperty('--paper', card.color); paper.style.zIndex = String(overlay && !card.draggable ? -1 : index + 5); paper.tabIndex = card.draggable ? 0 : -1;
    paper.setAttribute('aria-label', card.summary); summary.textContent = card.summary; rect(paper, card.rect);
    if (editor?.cardId === card.id) {
      if (item.editorId !== editor.draftId) {
        item.disposeAttachments?.(); item.disposeAttachments = null; item.filesKey = null; item.files.hidden = true;
        item.editorId = editor.draftId; const input = make('textarea', undefined, 'inline-editor'); input.value = editor.text; input.setAttribute('aria-label', t('desktop.editor.label'));
        input.oninput = () => { editor.text = input.value; if (!composing) void run(saveDraft); };
        input.addEventListener('compositionstart', () => { composing = true; });
        input.addEventListener('compositionend', () => { composing = false; editor.text = input.value; void run(saveDraft); });
        input.onkeydown = event => {
          if (event.isComposing || composing) return;
          if (event.key === 'Escape' || (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault(); event.stopPropagation(); void run(() => editAction(event.key === 'Escape' ? 'editor.end' : 'editor.save'));
          }
        };
        body.replaceChildren(input, make('div', t('desktop.draft.saved'), 'draft-state'));
        queueMicrotask(() => { if (input.isConnected) input.focus(); });
      }
      updateFrozen();
      actions.replaceChildren(button(t('desktop.editor.retrySave'), saveDraft), button(t('desktop.editor.full'), () => editAction('editor.full')),
        button(t('common.save'), () => editAction('editor.save')));
    } else {
      const filesKey = JSON.stringify([card.revision, card.attachments || [], card.interactive]);
      const missingChanged = item.files.querySelector('.missing') && item.attachmentRevision !== next.workspaceRevision;
      // Attachment tiles and rendered text carry catalog labels, so a language change draws them again.
      if (relocalized || item.editorId || item.filesKey !== filesKey || missingChanged) {
        item.disposeAttachments?.(); item.filesKey = filesKey; item.attachmentRevision = next.workspaceRevision;
        item.files.hidden = !card.attachments?.length;
        const args = file => ({ cardId: card.id, revision: card.revision, attachmentId: file.id });
        item.disposeAttachments = renderAttachmentTiles(item.files, card.attachments || [], {
          preview: file => client.command('attachment.preview', args(file)),
          open: file => card.interactive ? client.command('attachment.open', args(file)) : Promise.resolve(), report,
        });
        for (const tile of item.files.querySelectorAll('button')) tile.disabled = !card.interactive;
        fitTiles(item.files);
      }
      const changed = relocalized || item.editorId || item.text !== card.text;
      if (changed) { renderMarkdown(body, card.text); item.text = card.text; item.editorId = null; }
      // A paper that starts or stops taking the mouse starts or stops scrolling, so its "…" goes or comes.
      if (changed || item.interactive !== card.interactive) fitText(body);
      item.interactive = card.interactive;
      actions.replaceChildren();
      if (card.draggable) actions.append(button(t('desktop.card.edit'), () => client.command('card.edit', { cardId: card.id })), button('⋯', async () => client.command('card.details', { cardId: card.id }, await captureIntent())));
    }
    if (gesture?.cardId === card.id && gesture.preview) rect(paper, gesture.preview);
  });
  drawnLocale = getLocale();
  return true;
}
// Where adjust mode is a modal overlay (every desktop host), the topmost scene tints its whole area and carries
// the controls the hidden main window would offer. The tint takes every click outside the adjusted papers.
function renderAdjustOverlay(on) {
  const shown = document.querySelector('.adjust-overlay');
  if (!on) { shown?.remove(); document.querySelector('.adjust-tools')?.remove(); return; }
  if (shown) return;
  const tools = make('div', undefined, 'adjust-tools'); tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', t('desktop.adjust.toolbar'));
  const arrange = kind => client.command('layout.arrange', { kind });
  const done = button(t('common.done'), async () => { await saveDraft(); await client.command('interaction.done', {}); }); done.classList.add('primary');
  tools.append(make('span', t('desktop.adjust.title'), 'adjust-title'), button(t('desktop.adjust.stack'), () => arrange('stack')),
    button(t('desktop.adjust.spread'), () => arrange('spread')), button(t('desktop.adjust.undo'), () => arrange('undo')), done);
  document.body.prepend(make('div', undefined, 'adjust-overlay')); document.body.append(tools);
}
// A notice is drawn once per id, so later frames carrying the same notice do not restart its fade.
function renderNotice(notice) {
  let shown = root.querySelector('.stage-notice');
  if (shown && shown.dataset.id !== String(notice?.id)) { shown.remove(); shown = null; }
  if (!notice || shown) return;
  shown = make('div', undefined, 'stage-notice'); shown.dataset.id = String(notice.id); shown.setAttribute('role', 'status');
  shown.append(make('div', notice.title, 'notice-title'), make('div', notice.text, 'notice-text'));
  if (notice.steps > 0) {
    const dots = make('div', undefined, 'notice-steps');
    for (let step = 1; step <= notice.steps; step++) dots.append(make('span', undefined, step === notice.step ? 'on' : undefined));
    shown.append(dots);
  }
  shown.style.left = `${notice.rect.x + notice.rect.width / 2}px`; shown.style.top = `${notice.rect.y + notice.rect.height / 2}px`;
  root.append(shown);
}
const refresh = createFrameRefresher(async () => {
  const value = await bridge.request('scene.frame'); if (!value) return;
  try {
    const next = parse(await download(value, offset => bridge.request('scene.read', { token: value.token, offset })));
    if (displayPending || (next.topology ?? 0) !== (info.topology ?? 0)) return;
    if (info.prepareFrames && !(await bridge.request('scene.prepare', { sequence: next.sequence, topology: next.topology ?? 0 })).accepted) return;
    if (render(next) || frame?.sequence === next.sequence) {
      if (document.visibilityState === 'visible') await new Promise(resolve => { requestAnimationFrame(resolve); setTimeout(resolve, 100); });
      await bridge.request('scene.applied', { sequence: next.sequence, topology: next.topology ?? 0 });
    }
  } finally { await bridge.request('scene.discard', { token: value.token }).catch(() => {}); }
});
function pointerArgs(current, event) { return { gestureId: current.id, pointerId: current.pointerId, point: point(event), shiftKey: event.shiftKey, labels: labels() }; }
function paintDrag(current, value) {
  current.preview = { ...current.origin, x: current.origin.x + value.x - current.start.x, y: current.origin.y + value.y - current.start.y };
  const paper = nodes.get(current.cardId)?.paper; if (paper) rect(paper, current.preview);
}
async function pump(current) {
  if (current.pumping) return current.pumping;
  current.pumping = (async () => {
    if (!(await current.down).accepted) return;
    while (current.latest && !current.ended) { const args = current.latest; current.latest = null; await client.command('pointer.move', args); }
  })().finally(() => { current.pumping = null; });
  return current.pumping;
}
async function cancel() {
  const current = gesture; if (!current || current.ended) return;
  current.ended = true; gesture = null;
  try {
    await current.pumping?.catch(() => {});
    // Even an unknown down/move outcome may have established the owner's gesture.
    await client.command('pointer.cancel', { gestureId: current.id, pointerId: current.pointerId });
  } finally {
    if (root.hasPointerCapture(current.pointerId)) root.releasePointerCapture(current.pointerId);
    await refresh();
  }
}
async function initialize() {
  // English until the first frame brings the main window's locale.
  localizeDocument();
  const transport = nativeTransport();
  if (!transport) throw new Error(t('errors.desktop.nativeOnly'));
  bridge = new NativeBridge(transport); info = await bridge.request('scene.info'); client = new DesktopClient(bridge, info);
  root.style.transform = `translate(${-info.viewport.x}px, ${-info.viewport.y}px)`;
  bridge.onEvent('desktop-frame', () => { void run(refresh); });
  bridge.onEvent('desktop-pointer-cancel', () => { void run(cancel); });
  bridge.onEvent('desktop-repaint', () => {
    if (repaintPending) return;
    repaintPending = true;
    const style = document.documentElement.style;
    const previous = style.opacity;
    style.opacity = '0.998';
    requestAnimationFrame(() => requestAnimationFrame(() => { style.opacity = previous; repaintPending = false; }));
  });
  bridge.onEvent('desktop-displays-changing', () => {
    displayPending = true;
    const current = gesture; gesture = null;
    if (current) { current.ended = true; if (root.hasPointerCapture(current.pointerId)) root.releasePointerCapture(current.pointerId); }
  });
  bridge.onEvent('desktop-viewport', message => {
    Object.assign(info, message.view, { topology: message.topology }); displayPending = false;
    root.style.transform = `translate(${-info.viewport.x}px, ${-info.viewport.y}px)`;
    void run(refresh);
  });
  bridge.onEvent('desktop-shortcuts', message => { info.bindings = message.bindings; });
  bridge.onEvent('desktop-focus', () => { (root.querySelector('textarea') || root.querySelector('.selected.operable') || root.querySelector('.operable'))?.focus(); });
  bridge.onEvent('desktop-unfreeze', message => { if (message.resume && message.draftId === editor?.draftId) frozen.delete(message.id); updateFrozen(); });
  bridge.onEvent('desktop-flush', message => { void run(async () => {
    frozen.add(message.id); updateFrozen(); let ok = false;
    try { if (!editor || editor.draftId !== message.draftId || composing) throw new Error(t('errors.desktop.finishInput')); await saveDraft(); ok = true; }
    catch (error) { report(error); }
    await bridge.request('scene.flushed', { id: message.id, draftId: message.draftId, sequence: editor?.sequence || 0, ok });
  }); });
  root.onpointerdown = event => {
    const paper = event.target.closest('.card.operable');
    if (displayPending || info.active === false || gesture || !paper || event.button !== 0 || event.target.closest('button,a,input,textarea,select')) return;
    const cardId = paper.dataset.cardId; const start = point(event); const id = crypto.randomUUID();
    gesture = { id, cardId, pointerId: event.pointerId, start, origin: frame.cards.find(c => c.id === cardId).rect,
      down: client.command('pointer.down', { gestureId: id, cardId, pointerId: event.pointerId, point: start, handle: Boolean(event.target.closest('.card-summary')) }) };
    gesture.down.catch(report); root.setPointerCapture(event.pointerId); event.preventDefault();
  };
  root.onpointermove = event => {
    if (!gesture || gesture.ended || gesture.pointerId !== event.pointerId) return;
    const current = gesture; current.latest = pointerArgs(current, event);
    if (Math.hypot(current.latest.point.x - current.start.x, current.latest.point.y - current.start.y) >= 5) paintDrag(current, current.latest.point);
    void run(() => pump(current));
  };
  root.onpointerup = event => { void run(async () => {
    const current = gesture; if (!current || current.ended || event.pointerId !== current.pointerId) return;
    const args = pointerArgs(current, event); current.ended = true;
    if (current.preview) paintDrag(current, args.point);
    try {
      await current.pumping;
      if ((await current.down).accepted) await client.command('pointer.up', args);
      await refresh();
    }
    catch (error) {
      await client.command('pointer.cancel', { gestureId: current.id, pointerId: current.pointerId }).catch(() => {}); throw error;
    }
    finally { gesture = null; if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId); await refresh(); }
  }); };
  root.onpointercancel = () => { void run(cancel); }; root.onlostpointercapture = () => { void run(cancel); };
  root.ondblclick = event => {
    const paper = event.target.closest('.card.operable');
    if (paper && !event.target.closest('button,a,input,textarea,select')) void run(() => client.command('card.edit', { cardId: paper.dataset.cardId }));
  };
  document.onkeydown = event => {
    const input = event.target.closest('input,textarea,select');
    const shortcut = shortcutForEvent(event, info.bindings || {}, { composing, editing: Boolean(input), inline: input?.matches('.inline-editor') });
    if (shortcut && !frozen.size) {
      event.preventDefault();
      const intent = captureIntent();
      void run(async () => { if (gesture) await cancel(); await saveDraft(); await client.command('interaction.shortcut', { key: shortcut.key }, await intent); }); return;
    }
    if (event.isComposing || composing || event.defaultPrevented || input) return;
    if (event.key === 'Escape') { event.preventDefault(); void run(() => gesture ? cancel() : client.command('interaction.escape')); }
    if (event.key === 'Enter') {
      const focusedId = event.target.closest('.card.operable')?.dataset.cardId;
      const selected = frame?.cards.find(c => c.draggable && (focusedId ? c.id === focusedId : c.selected));
      if (selected && !event.target.closest('button,a')) { event.preventDefault(); void run(() => client.command('card.edit', { cardId: selected.id })); }
    }
  };
  await refresh();
  addEventListener('pagehide', () => { client.close(); bridge.close(); });
}
void run(initialize);
