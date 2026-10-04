import { Workspace } from '../core/workspace.js';
import { activeGroups, copy, eligible, gridRegions, summaryText, validateGrid } from '../core/contracts.js';
import { planFormation } from '../layout/formation.js';
import { InteractionController, cardPolicy, sceneOrder } from '../interaction/controller.js';
import { IndexedDbStorage, acquireProfile } from '../storage/indexed-db.js';
import { renderMarkdown } from './markdown.js';
import { toggleChecklist } from './checklist.js';

const $ = selector => document.querySelector(selector);
const colors = ['#fff6cc', '#e7f2e7', '#e5edf8', '#f7e7de', '#eee8f7', '#e2f0ef', '#f6e5ec', '#f1eddb', '#e7eaf1'];
let workspace; let storage; let controller; let lease;
let activeGroupId; let filter = 'active'; let listView = matchMedia('(max-width:640px)').matches;
let currentDraft = null; let draftSequence = 0; let draftPending = Promise.resolve(); let editorBusy = false;
let composing = false;
let formationMode = 'stack'; let formationPreview; let groupLabels = [];
let lastVisibleArea;
const attachmentUrls = new Map();
const unsavedDrafts = new Map();
const profileId = new URLSearchParams(location.search).get('profile') || 'local-preview';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, action, className) {
  const node = element('button', text, className); node.type = 'button';
  node.addEventListener('click', event => { event.stopPropagation(); run(action); }); return node;
}
function status(text, error = false) { $('#status').textContent = text; $('#status').classList.toggle('error', error); }
async function run(action) {
  try { await action(); }
  catch (error) { status(error.message, true); if (currentDraft) $('#draft-status').textContent = error.message; }
}
function screenArea() {
  const shell = $('#stage-shell'); const bounds = shell.getBoundingClientRect();
  if (!shell.hidden && bounds.width > 0 && bounds.height > 0) {
    lastVisibleArea = { x: 0, y: 0, width: Math.max(320, bounds.width - 2), height: Math.max(280, bounds.height - 2) };
  }
  return copy(lastVisibleArea || workspace?.layout.state.grid.area
    || { x: 0, y: 0, width: Math.max(320, innerWidth), height: Math.max(280, innerHeight) });
}
function groupColor(id) { return colors[Math.max(0, activeGroups(workspace.snapshot).findIndex(group => group.id === id)) % colors.length]; }
function currentCard(id) { return workspace.snapshot.cards.find(card => card.id === id); }
function fillGroups(select, selected, none = false) {
  select.replaceChildren();
  if (none) select.append(new Option('不特別突出', ''));
  for (const group of activeGroups(workspace.snapshot)) select.append(new Option(group.name, group.id));
  select.value = selected || '';
}

async function initialize() {
  storage = await IndexedDbStorage.open();
  lease = await acquireProfile(profileId);
  if (!lease.acquired) throw new Error('這個工作空間已在另一個視窗開啟。請使用原視窗，或關閉它後重新載入。');
  addEventListener('pagehide', () => { lease.release(); storage.close(); });
  addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  addEventListener('beforeunload', event => {
    if (unsavedDrafts.size) { event.preventDefault(); event.returnValue = ''; }
  });
  const saved = await storage.load(profileId);
  const persist = (state, revision) => storage.save(state, revision);
  workspace = saved ? new Workspace(saved, persist) : await Workspace.create({ profileId,
    deviceId: crypto.randomUUID(), area: screenArea(), persist });
  activeGroupId = activeGroups(workspace.snapshot)[0]?.id;
  controller = new InteractionController({ getSnapshot: () => workspace.snapshot, layout: workspace.layout,
    commands: workspace, saveDraft: async () => { if (currentDraft) await flushDraft(); } });
  await workspace.layout.placeNew(workspace.snapshot, [screenArea()]);
  $('#storage-note').textContent = '瀏覽器本機工作空間 · 尚未連接 Google';
  bindEvents(); render(); status('已開啟本機資料');
  let lastArea = JSON.stringify(screenArea());
  new ResizeObserver(() => {
    if ($('#stage-shell').hidden || !$('#stage-shell').getClientRects().length) return;
    const area = screenArea();
    if (JSON.stringify(area) === lastArea) return;
    lastArea = JSON.stringify(area);
    run(async () => {
      controller.cancelDrag();
      const result = await workspace.layout.recoverDisplays([area]);
      render(); if (result.rescued.length) status(`已將 ${result.rescued.length} 張不可達便箋移回可見範圍`);
    });
  }).observe($('#stage-shell'));
}

function matchesFilter(card) {
  if (filter === 'deleted') return card.deleted;
  if (card.deleted) return false;
  if (filter === 'archived') return card.archived;
  if (card.archived) return false;
  return filter === 'completed' ? card.completed : !card.completed;
}

function render() {
  const snapshot = workspace.snapshot; const groups = activeGroups(snapshot); const layout = workspace.layout.state;
  if (!groups.some(group => group.id === activeGroupId)) activeGroupId = groups[0]?.id;
  $('#groups').replaceChildren();
  for (const group of groups) {
    const row = element('div', undefined, `group-row${group.id === activeGroupId ? ' active' : ''}`);
    const choose = button('', () => { activeGroupId = group.id; render(); });
    const dot = element('span', undefined, 'group-dot'); dot.style.setProperty('--group-color', groupColor(group.id));
    choose.append(dot, element('span', group.name, 'group-name'),
      element('span', String(snapshot.cards.filter(card => card.groupId === group.id && !card.deleted && !card.archived).length), 'group-count'));
    row.append(choose, button('⋯', () => groupEditor(group), 'group-menu')); $('#groups').append(row);
  }
  $('#workspace-title').textContent = listView ? groups.find(group => group.id === activeGroupId)?.name || '我的便箋' : '我的便箋桌面';
  $('#draft-count').textContent = String(Object.keys(workspace.state.drafts).length);
  const scope = controller.state.operationScope;
  $('#operate-all').classList.toggle('operating', scope.kind === 'all');
  $('#operate-group').classList.toggle('operating', scope.kind === 'group');
  $('#stop-operation').hidden = scope.kind === 'none';
  $('#mode-label').textContent = scope.kind === 'none' ? '日常觀看' : scope.kind === 'all' ? '正在操作所有群組'
    : `正在操作 ${groups.find(group => group.id === scope.groupId)?.name || '群組'}`;
  $('#view-toggle').textContent = listView ? '桌面檢視' : '清單檢視';
  $('#view-toggle').setAttribute('aria-pressed', String(listView));
  const asList = listView || filter !== 'active' || Boolean($('#search').value);
  $('#stage-shell').hidden = asList; $('#list').hidden = !asList;
  document.querySelectorAll('[data-filter]').forEach(node => node.classList.toggle('active', node.dataset.filter === filter));
  const query = $('#search').value.trim().toLocaleLowerCase();
  const cards = snapshot.cards.filter(matchesFilter).filter(card => !query || card.content.text.toLocaleLowerCase().includes(query));
  $('#count').textContent = `${cards.length} 張便箋`;
  if (asList) renderList(cards.filter(card => query || card.groupId === activeGroupId));
  else renderStage(snapshot.cards);
  $('#empty').hidden = snapshot.cards.some(card => eligible(card, layout));
}

function renderStage(cards) {
  const stage = $('#stage'); stage.replaceChildren(); groupLabels = [];
  const layout = workspace.layout.state; const state = controller.state;
  let regions = [];
  try { regions = gridRegions(layout.grid, activeGroups(workspace.snapshot)); } catch (error) { status(error.message, true); }
  for (const region of regions.filter(region => region.groupId)) {
    const group = activeGroups(workspace.snapshot).find(group => group.id === region.groupId);
    const boundary = element('div', undefined, 'region'); boundary.dataset.groupId = group.id;
    rectStyle(boundary, region); stage.append(boundary);
    const label = element('div', group.name, 'region-label'); label.dataset.groupId = group.id;
    label.style.left = `${region.x + 8}px`; label.style.top = `${region.y + 5}px`; stage.append(label);
    groupLabels.push({ groupId: group.id, x: region.x + 8, y: region.y + 5, width: Math.max(84, label.offsetWidth), height: 30 });
  }
  let z = 5;
  for (const card of sceneOrder(cards, layout, state)) {
    const policy = cardPolicy(card, layout, state); const placement = layout.placements[card.id];
    if (!policy.visible || !placement) continue;
    const paper = element('article', undefined, 'card'); paper.dataset.cardId = card.id;
    paper.classList.toggle('operable', policy.draggable); paper.classList.toggle('selectable', !policy.draggable && placement.readOnlySelect);
    paper.classList.toggle('selected', state.selectedCardId === card.id); paper.classList.toggle('mine', layout.myGroupId === card.groupId);
    paper.classList.toggle('completed', card.completed);
    paper.style.setProperty('--paper', groupColor(card.groupId)); paper.style.zIndex = String(z++); rectStyle(paper, placement);
    paper.append(element('div', summaryText(card), 'card-summary'));
    const body = element('div', undefined, 'card-body markdown');
    if (policy.editing && currentDraft?.cardId === card.id && !$('#editor-dialog').open) {
      const input = element('textarea', undefined, 'inline-editor'); input.value = currentDraft.content.text;
      input.setAttribute('aria-label', '就地編輯便箋');
      input.oninput = () => { if (!editorBusy) { currentDraft.content.text = input.value; queueDraft(); } };
      input.oncompositionstart = () => { composing = true; controller.setComposing(true); };
      input.oncompositionend = () => { composing = false; controller.setComposing(false); };
      input.onkeydown = event => {
        if (event.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); run(async () => {
          await controller.endEdit(); currentDraft = null; render(); status('草稿已保留');
        }); }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); run(() => saveEditor()); }
      };
      body.append(input);
    } else renderMarkdown(body, card.content.text);
    paper.append(body);
    if (policy.draggable) {
      paper.tabIndex = 0; paper.setAttribute('aria-label', summaryText(card));
      const actions = element('div', undefined, 'card-actions');
      if (policy.editing) actions.append(button('完整編輯', () => openEditor(card, currentDraft)), button('保存', () => saveEditor()));
      else actions.append(button('編輯', () => beginInlineEdit(card)), button('⋯', () => cardDetails(card)));
      paper.append(actions);
    }
    stage.append(paper);
  }
}

function rectStyle(node, rect) { Object.assign(node.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }); }

function renderList(cards) {
  const list = $('#list'); list.replaceChildren();
  for (const card of cards) {
    const row = element('article', undefined, 'list-card');
    const content = element('div', undefined, 'list-content');
    content.append(element('h3', summaryText(card)), element('div', card.content.text, 'excerpt'));
    content.append(element('div', `${activeGroups(workspace.snapshot).find(group => group.id === card.groupId)?.name || '群組待同步'}${card.content.attachments?.length ? ` · ${card.content.attachments.length} 個附件` : ''}`, 'list-meta'));
    const actions = element('div', undefined, 'list-actions');
    if (card.deleted) actions.append(button('還原便箋', async () => { await workspace.restoreCard(card.id, card.revision); render(); status('已還原'); }));
    else actions.append(button('編輯', () => openEditor(card)), button(card.completed ? '回待處理' : '標為完成', () => changeCard(card.id, { completed: !card.completed })), button('更多操作', () => cardDetails(card)));
    row.append(content, actions); list.append(row);
  }
  if (!cards.length) list.append(element('p', '這裡還沒有便箋。', 'hint'));
}

async function changeCard(id, patch) {
  const card = currentCard(id); await workspace.updateCard(id, patch, card.revision);
  await controller.reconcile(); render(); status('已存本機');
}

function groupEditor(group) {
  const dialog = element('dialog'); const form = element('form');
  const title = element('h2', group ? '群組名稱' : '新增群組');
  const label = element('label', '名称', 'field'); const input = element('input'); input.required = true; input.maxLength = 80; input.value = group?.name || ''; label.append(input);
  const actions = element('div', undefined, 'dialog-actions');
  const save = element('button', '保存', 'primary'); save.type = 'submit';
  actions.append(button('取消', () => dialog.close()), save); form.append(title, label, actions); dialog.append(form); document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', event => { event.preventDefault(); run(async () => {
    if (group) await workspace.renameGroup(group.id, input.value, group.revision);
    else { const created = await workspace.createGroup(input.value); activeGroupId = created.id; }
    await workspace.layout.placeNew(workspace.snapshot, [screenArea()]); dialog.close(); render(); status('群組已保存');
  }); });
  dialog.showModal(); input.focus();
}

function cardDetails(card) {
  const dialog = element('dialog'); dialog.append(element('h2', summaryText(card)));
  const groupLabel = element('label', '移至群組', 'field'); const select = element('select'); fillGroups(select, card.groupId); groupLabel.append(select);
  const visibility = element('label', undefined, 'check'); const check = element('input'); check.type = 'checkbox'; check.checked = workspace.layout.state.placements[card.id]?.visible !== false; visibility.append(check, document.createTextNode('在桌面顯示'));
  const selection = element('label', undefined, 'check'); const selectable = element('input'); selectable.type = 'checkbox'; selectable.checked = workspace.layout.state.placements[card.id]?.readOnlySelect === true; selection.append(selectable, document.createTextNode('日常觀看可選取文字（不穿透滑鼠）'));
  const layer = element('label', '常駐層級', 'field'); const layers = element('select');
  for (const [value, name] of [['desktop', '桌面'], ['floating', '浮動'], ['wallpaper', '桌布層']]) layers.append(new Option(name, value));
  layers.value = workspace.layout.state.placements[card.id]?.residentLayer || 'desktop'; layer.append(layers);
  dialog.append(groupLabel, visibility, selection, layer, element('p', '此瀏覽器工作空間僅預覽卡片，沒有系統桌面分層或全域快捷鍵。', 'hint'));
  const actions = element('div', undefined, 'dialog-actions');
  actions.append(button(card.archived ? '取消封存' : '封存', async () => { await changeCard(card.id, { archived: !card.archived }); dialog.close(); }),
    button('移至刪除區', async () => { await changeCard(card.id, { deleted: true }); dialog.close(); }),
    button('取消', () => dialog.close()), button('套用', async () => {
      if (select.value !== card.groupId) await controller.moveToGroup(card.id, select.value);
      await workspace.layout.setCardPolicy(card.id, { visible: check.checked, readOnlySelect: selectable.checked, residentLayer: layers.value });
      await controller.reconcile(); dialog.close(); render(); status('已存本機');
    }, 'primary'));
  dialog.append(actions); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
}

async function openEditor(card = null, recovered = null) {
  if (controller.state.editingCardId && currentDraft) await controller.endEdit();
  currentDraft = recovered ? workspace.recoverDraft(recovered.id) : workspace.blankDraft(activeGroupId, card);
  currentDraft.content.attachments ||= [];
  $('#editor-title').textContent = card || recovered?.baseRevision ? '編輯便箋' : '記下想法';
  $('#editor-text').value = currentDraft.content.text; fillGroups($('#editor-group'), currentDraft.groupId);
  $('#editor-group').disabled = Boolean(currentDraft.baseRevision); $('#save-copy').hidden = true;
  $('#editor-dialog').showModal(); showEditorTab(false); await renderAttachments(); queueDraft(); $('#editor-text').focus();
}

async function beginInlineEdit(card, gesture = false) {
  if (controller.state.editingCardId === card.id && currentDraft?.cardId === card.id) {
    $('#stage .inline-editor')?.focus(); return;
  }
  if (!await controller.beginEdit(card.id, { gesture })) return;
  currentDraft = workspace.blankDraft(card.groupId, card); queueDraft(); render();
  $('#stage .inline-editor')?.focus();
}

function renderSelection() {
  const layout = workspace.layout.state; const state = controller.state;
  const order = sceneOrder(workspace.snapshot.cards, layout, state).map(card => card.id);
  $('#stage').querySelectorAll('.card').forEach(paper => {
    paper.classList.toggle('selected', paper.dataset.cardId === state.selectedCardId);
    paper.style.zIndex = String(5 + order.indexOf(paper.dataset.cardId));
  });
}

function closeInlineView(cardId) {
  const paper = [...$('#stage').querySelectorAll('.card')].find(node => node.dataset.cardId === cardId);
  const card = currentCard(cardId);
  if (paper && card) {
    renderMarkdown(paper.querySelector('.card-body'), card.content.text);
    paper.querySelector('.card-actions')?.replaceChildren(button('編輯', () => beginInlineEdit(card)), button('⋯', () => cardDetails(card)));
  }
  if (currentDraft?.cardId === cardId) currentDraft = null;
}

function queueDraft() {
  if (!currentDraft) return Promise.resolve();
  const sequence = ++draftSequence; const id = currentDraft.id;
  unsavedDrafts.set(id, sequence);
  $('#draft-status').textContent = '正在保存草稿…';
  draftPending = workspace.saveDraft(copy(currentDraft));
  draftPending.then(() => {
    if (unsavedDrafts.get(id) === sequence) unsavedDrafts.delete(id);
    if (sequence === draftSequence && currentDraft?.id === id) $('#draft-status').textContent = '草稿已存本機';
  }).catch(error => { if (currentDraft?.id === id) { $('#draft-status').textContent = `保存失敗：${error.message}`; status(`草稿保存失敗：${error.message}`, true); } });
  return draftPending;
}
async function flushDraft() { await queueDraft(); }
function setEditorBusy(value) {
  editorBusy = value; $('#editor-text').readOnly = value;
  $('#stage').querySelectorAll('.inline-editor').forEach(node => { node.readOnly = value; });
  $('#editor-form').querySelectorAll('button').forEach(node => { node.disabled = value; });
  $('#attachment-input').disabled = value;
  $('#editor-group').disabled = value || Boolean(currentDraft?.baseRevision);
}
async function closeEditor() {
  if (editorBusy) return;
  setEditorBusy(true);
  try { await flushDraft(); currentDraft = null; $('#editor-dialog').close(); controller.setComposing(false); await controller.endEdit(); render(); status('草稿已保留'); }
  finally { setEditorBusy(false); }
}
async function saveEditor(asCopy = false) {
  if (editorBusy || !currentDraft) return;
  setEditorBusy(true);
  try {
    await flushDraft();
    await workspace.commitDraft(currentDraft.id, { asCopy });
    currentDraft = null; $('#editor-dialog').close(); controller.setComposing(false); await controller.endEdit();
    await workspace.layout.placeNew(workspace.snapshot, [screenArea()]); render(); status('便箋已存本機');
  } catch (error) { if (error.code === 'conflict') $('#save-copy').hidden = false; throw error; }
  finally { setEditorBusy(false); }
}
function showEditorTab(preview) {
  $('#editor-text').hidden = preview; $('#editor-preview').hidden = !preview;
  $('#edit-tab').setAttribute('aria-pressed', String(!preview)); $('#preview-tab').setAttribute('aria-pressed', String(preview));
  if (preview) renderMarkdown($('#editor-preview'), currentDraft.content.text, { onToggle: index => run(async () => {
    if (editorBusy) return;
    currentDraft.content.text = toggleChecklist(currentDraft.content.text, index); $('#editor-text').value = currentDraft.content.text;
    queueDraft(); showEditorTab(true);
  }) });
}
async function renderAttachments() {
  for (const url of attachmentUrls.values()) URL.revokeObjectURL(url); attachmentUrls.clear();
  const list = $('#attachments'); list.replaceChildren();
  if (!currentDraft) return;
  for (const attachment of currentDraft.content.attachments || []) {
    const row = element('li'); const blob = await storage.getAttachment(profileId, attachment.id);
    if (blob) {
      // Download-only bytes: HTML/SVG attachments must never become same-origin executable documents.
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' })); attachmentUrls.set(attachment.id, url);
      const link = element('a', attachment.name); link.href = url; link.download = attachment.name; row.append(link);
    } else row.append(element('span', `${attachment.name}（尚未下載）`));
    row.append(element('span', `${Math.ceil(attachment.size / 1024)} KiB`), button('移除', async () => {
      if (editorBusy) return;
      currentDraft.content.attachments = currentDraft.content.attachments.filter(item => item.id !== attachment.id);
      await queueDraft(); await renderAttachments();
    })); list.append(row);
  }
}

function openFormation(mode) {
  formationMode = mode; $('#formation-title').textContent = mode === 'stack' ? '堆疊便箋' : '攤開便箋';
  $('#allow-resize').checked = false;
  $('#formation-scope').value = controller.state.operationScope.kind === 'all' ? 'all' : 'group';
  $('#formation-dialog').showModal(); updateFormation();
}
function updateFormation() {
  try {
    const snapshot = workspace.snapshot;
    const measure = element('div', '量測摘要', 'card-summary'); measure.style.position = 'absolute'; measure.style.visibility = 'hidden'; document.body.append(measure);
    const measuredBand = measure.getBoundingClientRect().height; measure.remove();
    const summaryBands = Object.fromEntries(snapshot.cards.map(card => [card.id, measuredBand]));
    for (const paper of $('#stage').querySelectorAll('.card')) summaryBands[paper.dataset.cardId] = paper.querySelector('.card-summary').getBoundingClientRect().height;
    formationPreview = planFormation({ snapshot, layout: workspace.layout.state,
      scope: $('#formation-scope').value === 'all' ? { kind: 'all' } : { kind: 'group', groupId: activeGroupId },
      mode: formationMode, workAreas: [screenArea()], summaryBands, allowResize: $('#allow-resize').checked });
    $('#formation-description').textContent = `排列 ${Object.keys(formationPreview.changes).length} 張便箋。${formationPreview.resized.length ? ` ${formationPreview.resized.length} 張會調整大小。` : ' 保持原尺寸。'}${formationPreview.overflow.length ? ` ${formationPreview.overflow.length} 張會超出群組區域。` : ''} 可透過復原還原這次排列。`;
    $('#apply-formation').disabled = false;
  } catch (error) { formationPreview = null; $('#formation-description').textContent = error.message; $('#apply-formation').disabled = true; }
}

function showSettings() {
  const layout = workspace.layout.state; $('#desktop-visible').checked = layout.desktopVisible;
  fillGroups($('#my-group'), layout.myGroupId, true); $('#grid-rows').value = String(layout.grid.rows); $('#grid-columns').value = String(layout.grid.columns);
  $('#settings-dialog').showModal(); previewGrid();
}
function previewGrid() {
  const rows = Number($('#grid-rows').value); const columns = Number($('#grid-columns').value); const groups = activeGroups(workspace.snapshot);
  const preview = $('#grid-preview'); preview.replaceChildren(); preview.style.gridTemplateColumns = `repeat(${columns},1fr)`;
  for (let i = 0; i < rows * columns; i++) preview.append(element('span', groups[i]?.name || '空區'));
  try { validateGrid(rows, columns, groups.length); $('#grid-message').textContent = `${rows} 列 × ${columns} 欄，共 ${rows * columns} 區。`; $('#save-settings').disabled = false; }
  catch (error) { $('#grid-message').textContent = error.message; $('#save-settings').disabled = true; }
}

function point(event) { const bounds = $('#stage').getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; }
function dragPaint(drag) {
  if (!drag) return;
  const paper = [...$('#stage').querySelectorAll('.card')].find(node => node.dataset.cardId === drag.cardId);
  if (paper && drag.dragging) { rectStyle(paper, drag.position); paper.classList.add('dragging'); paper.style.zIndex = '100'; }
  $('#stage').querySelectorAll('.region').forEach(node => { node.classList.toggle('dragging', drag.dragging); node.classList.toggle('target', node.dataset.groupId === drag.target?.groupId); });
  $('#stage').querySelectorAll('.region-label').forEach(node => {
    const target = node.dataset.groupId === drag.target?.groupId;
    node.classList.toggle('receiving', target); node.style.zIndex = drag.dragging ? '101' : '1';
    node.textContent = `${target ? '移至 ' : ''}${activeGroups(workspace.snapshot).find(group => group.id === node.dataset.groupId)?.name || ''}`;
  });
}

function bindEvents() {
  for (const id of ['new-card', 'empty-add']) $(`#${id}`).onclick = () => run(() => openEditor());
  $('#add-group').onclick = () => groupEditor();
  $('#search').oninput = render; $('#view-toggle').onclick = () => { listView = !listView; render(); };
  document.querySelectorAll('[data-filter]').forEach(node => { node.onclick = () => { filter = node.dataset.filter; render(); }; });
  $('#operate-group').onclick = () => run(async () => { await controller.activate({ kind: 'group', groupId: activeGroupId }); render(); });
  $('#operate-all').onclick = () => run(async () => { await controller.activate({ kind: 'all' }); render(); });
  $('#stop-operation').onclick = () => run(async () => { await controller.activate({ kind: 'none' }); render(); });
  $('#cycle-prev').onclick = () => { controller.cycle(activeGroupId, -1); render(); };
  $('#cycle-next').onclick = () => { controller.cycle(activeGroupId, 1); render(); };
  $('#stack').onclick = () => openFormation('stack'); $('#spread').onclick = () => openFormation('spread');
  $('#undo').onclick = () => run(async () => { await workspace.undo([screenArea()]); await controller.reconcile(); render(); status('已復原'); });
  $('#formation-scope').onchange = updateFormation; $('#allow-resize').onchange = updateFormation;
  $('#cancel-formation').onclick = () => $('#formation-dialog').close();
  $('#apply-formation').onclick = () => run(async () => { await controller.applyFormation(formationPreview); $('#formation-dialog').close(); render(); status('排列已完成，可按復原還原'); });
  $('#settings-button').onclick = showSettings; $('#cancel-settings').onclick = () => $('#settings-dialog').close();
  $('#grid-rows').onchange = previewGrid; $('#grid-columns').onchange = previewGrid;
  $('#save-settings').onclick = () => run(async () => {
    const rows = Number($('#grid-rows').value); const columns = Number($('#grid-columns').value); const groups = activeGroups(workspace.snapshot);
    await workspace.layout.configure({ desktopVisible: $('#desktop-visible').checked, myGroupId: $('#my-group').value || null,
      grid: { rows, columns, area: screenArea(), slots: Array.from({ length: rows * columns }, (_, i) => groups[i]?.id || null) } }, workspace.snapshot);
    $('#settings-dialog').close(); render(); status('設定已存本機，既有卡片位置不變');
  });
  $('#editor-text').oninput = () => { if (!currentDraft || editorBusy) return; currentDraft.content.text = $('#editor-text').value; queueDraft(); };
  $('#editor-text').oncompositionstart = () => { composing = true; controller.setComposing(true); }; $('#editor-text').oncompositionend = () => { composing = false; controller.setComposing(false); };
  $('#editor-group').onchange = () => { if (!editorBusy) { currentDraft.groupId = $('#editor-group').value; queueDraft(); } };
  $('#edit-tab').onclick = () => showEditorTab(false); $('#preview-tab').onclick = () => showEditorTab(true);
  $('#insert-task').onclick = () => { if (editorBusy) return; const text = $('#editor-text'); showEditorTab(false); text.setRangeText('- [ ] ', text.selectionStart, text.selectionEnd, 'end'); currentDraft.content.text = text.value; queueDraft(); text.focus(); };
  $('#editor-form').onsubmit = event => { event.preventDefault(); run(() => saveEditor()); };
  $('#save-copy').onclick = () => run(() => saveEditor(true));
  $('#keep-draft').onclick = () => run(closeEditor); $('#close-editor').onclick = () => run(closeEditor);
  $('#editor-dialog').oncancel = event => { event.preventDefault(); if (!composing) run(closeEditor); };
  $('#attachment-input').onchange = () => run(async () => {
    const files = [...$('#attachment-input').files]; setEditorBusy(true);
    try { for (const file of files) { const metadata = await storage.putAttachment(profileId, file); if (!currentDraft.content.attachments.some(item => item.id === metadata.id)) currentDraft.content.attachments.push(metadata); } await queueDraft(); await renderAttachments(); }
    finally { $('#attachment-input').value = ''; setEditorBusy(false); }
  });
  $('#drafts-button').onclick = () => {
    const list = $('#draft-list'); list.replaceChildren();
    for (const draft of Object.values(workspace.state.drafts)) {
      const row = element('div', undefined, 'draft-row'); row.append(element('p', draft.content.text.slice(0, 110) || '空白草稿'), button('繼續編輯', () => { $('#drafts-dialog').close(); return openEditor(null, draft); })); list.append(row);
    }
    if (!list.children.length) list.append(element('p', '沒有未完成草稿。')); $('#drafts-dialog').showModal();
  };
  $('#close-drafts').onclick = () => $('#drafts-dialog').close();
  const stage = $('#stage');
  stage.onpointerdown = event => {
    const paper = event.target.closest('.card.operable');
    if (!paper || event.button !== 0 || event.target.closest('button,a,input,select,textarea')) return;
    if (controller.pointerDown(paper.dataset.cardId, point(event), { pointerId: event.pointerId,
      handle: Boolean(event.target.closest('.card-summary')) })) { paper.setPointerCapture(event.pointerId); event.preventDefault(); }
  };
  stage.onpointermove = event => dragPaint(controller.pointerMove(point(event), { pointerId: event.pointerId, shiftKey: event.shiftKey, labels: groupLabels }));
  stage.onpointerup = event => run(async () => {
    const id = event.target.closest('.card')?.dataset.cardId;
    const result = await controller.pointerUp(point(event), { pointerId: event.pointerId, shiftKey: event.shiftKey, labels: groupLabels });
    if (result.kind === 'click' && id) {
      const previousEditor = controller.state.editingCardId;
      await controller.select(id, { gesture: true });
      if (previousEditor && !controller.state.editingCardId) closeInlineView(previousEditor);
      renderSelection();
    }
    else if (result.kind !== 'ignored') render();
    if (result.kind === 'transferred') status('已移至新群組，可按復原');
  });
  stage.onpointercancel = () => { controller.cancelDrag(); render(); };
  stage.addEventListener('lostpointercapture', () => { if (controller.cancelDrag()) render(); });
  stage.ondblclick = event => run(async () => {
    const paper = event.target.closest('.card.operable');
    if (!paper || event.target.closest('button,a,input,textarea,select')) return;
    await beginInlineEdit(currentCard(paper.dataset.cardId), true);
  });
  document.addEventListener('keydown', event => {
    if (event.isComposing || document.querySelector('dialog[open]') || event.target.closest('input,textarea,select')) return;
    if (event.key === 'Escape') { event.preventDefault(); run(async () => { await controller.escape(); render(); }); }
    if (event.key === 'Enter' && controller.state.selectedCardId) { event.preventDefault(); run(() => beginInlineEdit(currentCard(controller.state.selectedCardId))); }
    if (event.key === 'Shift' && controller.state.dragSession) dragPaint(controller.pointerMove(controller.state.dragSession.current, { pointerId: controller.state.dragSession.pointerId, shiftKey: true, labels: groupLabels }));
  });
  document.addEventListener('keyup', event => {
    if (event.key === 'Shift' && controller.state.dragSession) dragPaint(controller.pointerMove(controller.state.dragSession.current, { pointerId: controller.state.dragSession.pointerId, shiftKey: false, labels: groupLabels }));
  });
}

run(initialize);
