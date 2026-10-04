import { Workspace } from '../core/workspace.js';
import { activeGroups, copy, eligible, gridRegions, summaryText } from '../core/contracts.js';
import { normalizeShortcut, shortcutActions, shortcutForEvent, validateShortcuts } from '../core/shortcuts.js';
import { planFormation } from '../layout/formation.js';
import { InteractionController, cardPolicy, sceneOrder } from '../interaction/controller.js';
import { IndexedDbStorage, acquireProfile } from '../storage/indexed-db.js';
import { renderMarkdown } from './markdown.js';
import { toggleChecklist } from './checklist.js';
import { showRevisionDialog } from './conflicts.js';
import { showBackupDialog } from './backup.js';
import { AutomaticBackup } from '../backup/automatic.js';
import { IndexedDbBackupJournal, BrowserAutomaticFiles } from '../backup/browser-automatic.js';
import { startAutomaticBackup } from '../backup/lifecycle.js';
import { connectNative } from '../native/bridge.js';
import { NativeFiles } from '../native/files.js';
import { NativeCaptureInbox } from '../native/capture.js';
import { NativeStorage } from '../storage/native.js';
import { nativeBackupAdapters } from '../backup/native.js';
import { DesktopAuthority } from '../desktop/authority.js';
import { DesktopOwner } from '../desktop/owner.js';
import { projectDesktop } from '../desktop/projection.js';
import { NativeShortcutSettings } from '../native/shortcuts.js';
import { NativeGoogleFileStore } from '../native/google.js';
import { FileSync } from '../sources/file-sync.js';

const $ = selector => document.querySelector(selector);
const colors = ['#fff6cc', '#e7f2e7', '#e5edf8', '#f7e7de', '#eee8f7', '#e2f0ef', '#f6e5ec', '#f1eddb', '#e7eaf1'];
let workspace; let storage; let controller; let lease;
let activeGroupId; let filter = 'active'; let listView = matchMedia('(max-width:640px)').matches;
let currentDraft = null; let draftSequence = 0; let draftPending = Promise.resolve(); let editorBusy = false;
let composing = false;
let formationMode = 'stack'; let formationPreview; let groupLabels = [];
let lastVisibleArea;
let settingsSlots = [];
let automatic; let automaticError;
let native; let nativeBackups; let stopAutomatic; let nativeClosing = false;
let nativeFiles;
let captureInbox; let selectedCapture; let captureBusy = false;
let desktop; let desktopInfo; let remoteEditor = null;
let nativeShortcuts; let shortcutStatus = [];
let googleAccount; let syncService; let syncTimer; let syncBusy = false; let accountBusy = false;
const activeActions = new Set();
const attachmentUrls = new Map();
const unsavedDrafts = new Map();
let profileId = new URLSearchParams(location.search).get('profile') || 'local-preview';

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
  if (nativeClosing) return;
  const pending = desktop ? desktop.perform(action) : Promise.resolve().then(action); activeActions.add(pending);
  try { await pending; }
  catch (error) { status(error.message, true); if (currentDraft) $('#draft-status').textContent = error.message; }
  finally { activeActions.delete(pending); }
}
function screenArea() {
  if (desktopInfo) { const { x, y, width, height } = desktopInfo.workAreas.find(area => area.primary) || desktopInfo.workAreas[0]; return { x, y, width, height }; }
  const shell = $('#stage-shell'); const bounds = shell.getBoundingClientRect();
  if (!shell.hidden && bounds.width > 0 && bounds.height > 0) {
    lastVisibleArea = { x: 0, y: 0, width: Math.max(320, bounds.width - 2), height: Math.max(280, bounds.height - 2) };
  }
  return copy(lastVisibleArea || workspace?.layout.state.grid.area
    || { x: 0, y: 0, width: Math.max(320, innerWidth), height: Math.max(280, innerHeight) });
}
function workAreas() { return desktopInfo ? desktopInfo.workAreas.map(({ x, y, width, height }) => ({ x, y, width, height })) : [screenArea()]; }
function groupColor(id) { return colors[Math.max(0, activeGroups(workspace.snapshot).findIndex(group => group.id === id)) % colors.length]; }
function currentCard(id) { return workspace.snapshot.cards.find(card => card.id === id); }
function fillGroups(select, selected, none = false) {
  select.replaceChildren();
  if (none) select.append(new Option('不特別突出', ''));
  for (const group of activeGroups(workspace.snapshot)) select.append(new Option(group.name, group.id));
  select.value = selected || '';
}

async function initialize() {
  native = await connectNative();
  if (native) {
    profileId = native.info.profileId; storage = new NativeStorage(native.bridge, native.info);
    nativeBackups = nativeBackupAdapters(native.bridge, native.info);
    if (native.info.capabilities.fileExport) {
      nativeFiles = new NativeFiles(native.bridge, native.info);
      const stopDownloads = nativeFiles.interceptDownloads(status); addEventListener('pagehide', stopDownloads, { once: true });
    }
    if (native.info.capabilities.desktopPresentation) desktopInfo = await native.bridge.request('desktop.info');
    lease = { acquired: true, release() {} };
  } else { storage = await IndexedDbStorage.open(); lease = await acquireProfile(profileId); }
  if (!lease.acquired) throw new Error('這個工作空間已在另一個視窗開啟。請使用原視窗，或關閉它後重新載入。');
  addEventListener('pagehide', () => { lease.release(); storage.close(); });
  addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  addEventListener('beforeunload', event => {
    if (unsavedDrafts.size) { event.preventDefault(); event.returnValue = ''; }
  });
  const saved = await storage.load(profileId);
  const persist = (state, revision) => storage.save(state, revision);
  workspace = saved ? new Workspace(saved, persist) : await Workspace.create({ profileId,
    deviceId: crypto.randomUUID(), area: screenArea(), persist, bootstrapGroup: !profileId.startsWith('google:') });
  activeGroupId = activeGroups(workspace.snapshot)[0]?.id;
  controller = new InteractionController({ getSnapshot: () => workspace.snapshot, layout: workspace.layout,
    commands: workspace, saveDraft: async () => { if (currentDraft) await flushDraft(); } });
  await workspace.layout.placeNew(workspace.snapshot, workAreas());
  if (desktopInfo) {
    await workspace.layout.recoverDisplays(workAreas());
    initializeDesktop();
    const note = element('p', '桌面已連接；操作群組可浮到其他 App 上方。', 'hint'); note.id = 'desktop-note'; $('#storage-note').after(note);
  }
  $('#storage-note').textContent = native ? '本機加密工作空間 · 尚未連接 Google' : '瀏覽器本機工作空間 · 尚未連接 Google';
  try {
    const journal = native ? storage.journal() : await IndexedDbBackupJournal.open();
    const files = nativeBackups?.files || new BrowserAutomaticFiles(); const vault = nativeBackups?.vault;
    const service = new AutomaticBackup({ workspace, storage, journal, files, vault,
      flush: () => desktop ? desktop.perform(flushDraft) : flushDraft() }); await service.load();
    automatic = { service, files, vault }; stopAutomatic = startAutomaticBackup(service);
    addEventListener('pagehide', () => { stopAutomatic(); journal.close(); });
  } catch (error) { automaticError = `自動備份尚未開啟：${error.message}`; }
  if (native) {
    native.bridge.onCloseRequested(() => { void prepareNativeClose(); });
    native.bridge.onEvent('host-background', message => {
      stopAutomatic?.(); void run(async () => {
        await flushDraft(); await automatic?.service.whenIdle();
        if (message.id) await native.bridge.request('host.backgroundReady', { id: message.id });
      });
    });
    native.bridge.onEvent('host-foreground', () => {
      stopAutomatic?.(); if (automatic && !nativeClosing && !accountBusy) stopAutomatic = startAutomaticBackup(automatic.service);
      void syncGoogle();
    });
    await native.bridge.request('host.ready');
    if (desktop) await native.bridge.request('desktop.start');
  }
  if (desktop) {
    nativeShortcuts = new NativeShortcutSettings(native.bridge, value => { shortcutStatus = value; renderShortcutStatus(); }, error => status(error.message, true));
    native.bridge.onEvent('desktop-action', message => { void run(async () => {
      try { await desktopAction(message.target, message.intent); }
      catch (error) { await native.bridge.request('desktop.showMain', { intent: message.intent }).catch(() => {}); throw error; }
    }); });
    $('#hide-main').hidden = false; $('#retry-shortcuts').hidden = false;
    $('#shortcut-note').textContent = '全域最多 32 組。App 取得焦點時會暫停全域註冊，改用視窗內快捷鍵；文字編輯、組字與對話框優先。';
    addEventListener('pagehide', () => nativeShortcuts.close());
  }
  bindEvents(); render(); status(native?.info.desktopReason || '已開啟本機資料');
  $('#share-note').hidden = !native?.info.capabilities.fileShare;
  if (native) await initializeGoogle();
  if (native?.info.capabilities.shareInbox) {
    captureInbox = new NativeCaptureInbox(native, workspace, storage); $('#capture-inbox-button').hidden = false;
    native.bridge.onEvent('host-capture', () => { void refreshCaptures().catch(error => status(error.message, true)); });
    native.bridge.onEvent('host-foreground', () => { void refreshCaptures().catch(error => status(error.message, true)); });
    await refreshCaptures();
  }
  let lastArea = JSON.stringify(screenArea());
  new ResizeObserver(() => {
    if (desktopInfo || $('#stage-shell').hidden || !$('#stage-shell').getClientRects().length) return;
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

async function initializeGoogle() {
  clearInterval(syncTimer);
  googleAccount = await native.bridge.request('google.status');
  $('#google-sign-in').hidden = false;
  $('#google-sign-in').disabled = !googleAccount.configured;
  $('#google-sign-in').textContent = googleAccount.connected ? '切換 Google 帳號' : profileId.startsWith('google:') ? '重新登入 Google' : '登入 Google';
  $('#google-sign-in').onclick = () => { void changeGoogleAccount('signIn'); };
  $('#google-sign-out').hidden = !googleAccount.connected;
  $('#google-local').hidden = !profileId.startsWith('google:');
  $('#google-sign-out').onclick = () => { void changeGoogleAccount('signOut'); };
  $('#google-local').onclick = () => { void changeGoogleAccount('local'); };
  $('#google-sync').hidden = !googleAccount.connected; $('#sync-status').hidden = false;
  $('#google-sync').onclick = () => { void syncGoogle(true); };
  if (googleAccount.connected) {
    $('#storage-note').textContent = `Google 工作空間 · ${googleAccount.email || googleAccount.accountId} · 本機加密保存`;
    syncService = new FileSync({ workspace, storage, fileStore: new NativeGoogleFileStore(native.bridge, native.info, googleAccount.accountId) });
    syncTimer = setInterval(() => { void syncGoogle(); }, 20000);
    addEventListener('online', () => { void syncGoogle(); });
    addEventListener('pagehide', () => { clearInterval(syncTimer); void syncService?.stop(); });
    void syncGoogle();
  } else {
    if (profileId.startsWith('google:')) $('#storage-note').textContent = 'Google 工作空間 · 尚未登入 · 本機加密保存';
    $('#sync-status').textContent = !googleAccount.configured ? '此安裝版本尚未啟用 Google 登入；可繼續使用本機便箋。'
      : profileId.startsWith('google:') ? '請重新登入此工作空間的 Google 帳號以繼續同步；本機便箋與待送內容保留。'
      : '登入後開啟獨立帳號工作空間；目前本機便箋保留。';
  }
}
async function syncGoogle(force = false) {
  if (!syncService || syncBusy || nativeClosing || accountBusy || document.querySelector('dialog[open]') || composing) return;
  syncBusy = true; $('#google-sync').disabled = true; $('#sync-status').textContent = '正在同步…';
  try {
    await (desktop ? desktop.perform(sync) : sync());
    async function sync() {
      await flushDraft(); await syncService.sync({ force });
      if (!activeGroups(workspace.snapshot).length && !workspace.snapshot.groups.length) await workspace.createGroup('我的便箋');
      activeGroupId = activeGroups(workspace.snapshot).some(group => group.id === activeGroupId) ? activeGroupId : activeGroups(workspace.snapshot)[0]?.id;
      await controller.reconcile(); await workspace.layout.placeNew(workspace.snapshot, workAreas()); render();
      const pending = workspace.pendingOperations.length;
      $('#sync-status').textContent = pending ? `本機已保存 · ${pending} 筆等待下一次同步` : `已同步 · ${new Date().toLocaleTimeString()}`;
    }
  } catch (error) {
    $('#sync-status').textContent = `${error.message} · 本機資料保留`;
    if (error.code === 'unauthorized' || error.code === 'source-permission') $('#google-sign-in').textContent = '重新登入 Google';
  }
  finally { syncBusy = false; $('#google-sync').disabled = false; }
}
async function changeGoogleAccount(action) {
  if (accountBusy || nativeClosing) return; accountBusy = true;
  const oldSync = syncService; clearInterval(syncTimer); stopAutomatic?.();
  try {
    await automatic?.service.whenIdle(); await oldSync?.stop(); syncService = null;
    desktop?.beginClose(); if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: true });
    await (desktop ? desktop.perform(flushDraft) : flushDraft()); await desktop?.whenIdle(); desktop?.sealClose();
    document.body.inert = true;
    if (action === 'signIn') {
      status('請完成原生 Google 登入與同步授權…');
      const result = await native.bridge.request('google.signIn');
      await native.bridge.request('google.open', { accountId: result.accountId });
    } else await native.bridge.request(action === 'signOut' ? 'google.signOut' : 'google.local');
  } catch (error) {
    document.body.inert = false; status(error.message, true); await desktop?.cancelClose();
    if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: false }).catch(() => {});
    if (automatic) stopAutomatic = startAutomaticBackup(automatic.service);
    accountBusy = false; await initializeGoogle();
  }
}

function currentDesktopEditor() {
  return remoteEditor && currentDraft?.id === remoteEditor.draftId && controller.state.editingCardId === remoteEditor.cardId ? copy(remoteEditor) : null;
}
function initializeDesktop() {
  const authority = new DesktopAuthority({ workspace, controller, sessionId: desktopInfo.sessionId,
    perform: action => desktop.perform(action),
    shortcut: (target, intent) => desktopAction(target, intent),
    details: async (id, intent) => { await native.bridge.request('desktop.showMain', { intent }); cardDetails(currentCard(id)); },
    editor: {
      current: currentDesktopEditor,
      begin: async (id, viewId) => {
        if (editorBusy || composing || document.querySelector('dialog[open]')) throw new Error('請先完成主畫面的目前編輯。');
        const previous = currentDesktopEditor();
        if (previous?.cardId === id && previous.viewId === viewId) return { draftId: previous.draftId, sequence: previous.sequence };
        const reuseId = currentDraft?.cardId === id ? currentDraft.id : null;
        if (currentDraft) {
          if (controller.state.editingCardId) { if (!await controller.endEdit()) throw new Error('请先完成目前輸入。'); }
          else await flushDraft();
        }
        const card = currentCard(id); if (!await controller.beginEdit(id, { gesture: true })) return null;
        currentDraft = reuseId && currentDraft?.id === reuseId ? currentDraft : workspace.blankDraft(card.groupId, card); remoteEditor = null;
        await queueDraft(); remoteEditor = { cardId: id, draftId: currentDraft.id, viewId, text: currentDraft.content.text, sequence: 0 };
        render(); return { draftId: remoteEditor.draftId, sequence: 0 };
      },
      change: async value => {
        const draft = copy(currentDraft); draft.content.text = value.text;
        await workspace.saveDraft(draft);
        // The authority's separate draft lane may finish while a lifecycle action is waiting for its flush barrier.
        if (currentDraft?.id !== value.draftId || remoteEditor?.viewId !== value.viewId) throw new Error('編輯入口已變更；草稿已保留。');
        currentDraft = draft; remoteEditor = copy(value);
      },
      save: () => saveEditor(),
      end: () => closeEditor(),
      full: async intent => {
        await flushDraft(); const draft = copy(currentDraft); const card = currentCard(draft.cardId);
        if (!await controller.endEdit()) throw new Error('請先完成目前輸入。'); remoteEditor = null;
        await native.bridge.request('desktop.showMain', { intent }); await openEditor(card, draft); render();
      },
    } });
  authority.configureDisplays(desktopInfo.topology ?? 0, desktopInfo.views);
  desktop = new DesktopOwner({ bridge: native.bridge, authority, editor: currentDesktopEditor,
    project: sequence => {
      const frame = projectDesktop({ snapshot: workspace.snapshot, layout: workspace.layout.state, interaction: controller.state,
        sessionId: desktopInfo.sessionId, sequence, topology: desktopInfo.topology ?? 0, workspaceRevision: workspace.state.revision, layers: desktopInfo.layers, editor: currentDesktopEditor() });
      if ($('#desktop-note')) $('#desktop-note').textContent = frame.fallbacks.length ? `${frame.fallbacks.length} 張便箋要求桌布層；Windows 目前以桌面層呈現，原偏好保留。` : '桌面已連接；操作群組可浮到其他 App 上方。';
      return frame;
    },
    changed: () => render(), error: error => status(error.message, true),
    displays: async proposal => {
      controller.cancelDrag();
      const result = await workspace.layout.recoverDisplays(proposal.workAreas.map(({ x, y, width, height }) => ({ x, y, width, height })));
      const editor = currentDesktopEditor();
      try {
        const info = await native.bridge.request('desktop.displays.apply', { topology: proposal.topology,
          editorViewId: editor?.viewId ?? null, editorRect: editor ? workspace.layout.state.placements[editor.cardId] : null });
        desktopInfo = info; authority.configureDisplays(info.topology, info.views); render();
        if (result.rescued.length) status(`已將 ${result.rescued.length} 張不可達便箋移回可見範圍`);
      } catch (error) {
        if (!nativeClosing) setTimeout(() => { if (!nativeClosing) void native.bridge.request('desktop.displays.retry').catch(() => {}); }, 3000);
        throw error;
      }
    },
    lost: async viewId => {
      if (remoteEditor?.viewId !== viewId) return;
      const draftId = remoteEditor.draftId;
      // Keep the main preview noneditable until every already accepted durable write settles.
      await authority.whenDraftIdle();
      if (remoteEditor?.viewId === viewId && currentDraft?.id === draftId) {
        currentDraft = copy(workspace.state.drafts[draftId] || currentDraft); remoteEditor = null;
      }
    },
    dismiss: async () => { await controller.activate({ kind: 'none' }); render(); },
  });
  addEventListener('pagehide', () => desktop.close());
}

async function refreshCaptures(force = false) {
  const items = await captureInbox.list(); $('#capture-count').textContent = items.length;
  if (!$('#capture-inbox-dialog').open || captureBusy && !force) return;
  const list = $('#capture-list'); list.replaceChildren(); selectedCapture = null;
  $('#capture-preview').hidden = true; $('#capture-files').replaceChildren(); $('#accept-capture').disabled = true; $('#discard-capture').disabled = true;
  if (!items.length) list.append(element('p', '目前沒有待接收的分享。'));
  for (const item of items) list.append(button(`${item.preview || '分享檔案'}${item.fileCount ? ` · ${item.fileCount} 個附件` : ''}`, async () => {
    if (captureBusy) return;
    selectedCapture = item.damaged ? item : await captureInbox.item(item.id);
    $('#capture-preview').textContent = selectedCapture.text || selectedCapture.preview || '只有附件'; $('#capture-preview').hidden = false;
    $('#capture-files').replaceChildren(...(selectedCapture.attachments || []).map(file => element('li', `${file.name} · ${Math.ceil(file.size / 1024)} KiB`)));
    $('#accept-capture').disabled = Boolean(item.damaged); $('#discard-capture').disabled = false;
  }));
}

function renderShortcutStatus() {
  const labels = { available: '已全域註冊', suspended: 'App 使用中，已釋放全域註冊', conflict: '其他程式已註冊', unavailable: '無法註冊', reserved: '系統保留', editing: '保留給文字編輯', typing: '保留給 AltGr 文字輸入，請改用 Ctrl+Shift', invalid: '格式不支援' };
  $('#shortcut-status').textContent = shortcutStatus.map(item => `${item.key}：${labels[item.status] || item.status}${item.triggerDescription ? `（${item.triggerDescription}）` : ''}`).join('；');
}

async function desktopAction(target, intent) {
  if (composing || editorBusy || document.querySelector('dialog[open]')) throw new Error('請先完成目前輸入或對話框。');
  if (target === '@hide') { await flushDraft(); await native.bridge.request('desktop.hideMain'); return; }
  if (target === shortcutActions.capture) {
    if (desktop) await native.bridge.request('desktop.showMain', { intent: intent ?? null });
    await openEditor(); return;
  }
  if (target === shortcutActions.toggle) await workspace.layout.configure({ desktopVisible: !workspace.layout.state.desktopVisible }, workspace.snapshot);
  else {
    const changed = await controller.activate(target === '@stop' ? { kind: 'none' } : target === shortcutActions.all ? { kind: 'all' } : { kind: 'group', groupId: target });
    if (changed && target !== shortcutActions.all && target !== '@stop') activeGroupId = target;
  }
  render();
  if (intent && desktop && target !== shortcutActions.toggle && controller.state.operationScope.kind !== 'none') {
    const sequence = await desktop.whenPublished(); await native.bridge.request('desktop.focus', { intent, sequence });
  }
}

async function prepareNativeClose() {
  if (nativeClosing) return;
  if (composing || [...document.querySelectorAll('dialog[open]')].some(dialog => dialog.id !== 'editor-dialog')) {
    await native.bridge.request('host.closeCancel').catch(() => {});
    status(composing ? '請先完成目前輸入，再關閉 App。' : '請先完成或關閉目前對話框，再關閉 App。', true); return;
  }
  nativeClosing = true; document.body.inert = true; desktop?.beginClose();
  try {
    if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: true });
    await Promise.allSettled([...activeActions]);
    stopAutomatic?.(); await automatic?.service.whenIdle();
    if (desktop) { await desktop.whenIdle(); await desktop.perform(flushDraft); } else await flushDraft();
    if (desktop) { desktop.sealClose(); await desktop.whenIdle(); }
    if (unsavedDrafts.size) throw new Error('仍有未保存草稿；請先保存或匯出，再關閉 App。');
    await native.bridge.request('host.closeReady');
  } catch (error) {
    await desktop?.cancelClose();
    await native.bridge.request('host.closeCancel').catch(() => {});
    if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: false }).catch(() => {});
    if (automatic) stopAutomatic = startAutomaticBackup(automatic.service);
    status(`尚未關閉：${error.message}`, true);
  }
  finally { nativeClosing = false; document.body.inert = false; }
}

function matchesFilter(card) {
  if (filter === 'deleted') return card.deleted;
  if (card.deleted) return false;
  if (filter === 'archived') return card.archived;
  if (card.archived) return false;
  return filter === 'completed' ? card.completed : !card.completed;
}

function render() {
  nativeShortcuts?.update(workspace.layout.state.shortcuts);
  if (remoteEditor && controller.state.editingCardId !== remoteEditor.cardId) { remoteEditor = null; currentDraft = null; }
  const snapshot = workspace.snapshot; const groups = activeGroups(snapshot); const layout = workspace.layout.state;
  if (!groups.some(group => group.id === activeGroupId)) activeGroupId = groups[0]?.id;
  $('#groups').replaceChildren();
  for (const group of groups) {
    const row = element('div', undefined, `group-row${group.id === activeGroupId ? ' active' : ''}`);
    row.dataset.groupId = group.id;
    const choose = button('', () => { activeGroupId = group.id; render(); });
    const dot = element('span', undefined, 'group-dot'); dot.style.setProperty('--group-color', groupColor(group.id));
    choose.append(dot, element('span', group.name, 'group-name'),
      element('span', String(snapshot.cards.filter(card => card.groupId === group.id && !card.deleted && !card.archived).length), 'group-count'));
    row.append(choose, button('⋯', () => groupEditor(group), 'group-menu')); $('#groups').append(row);
  }
  $('#workspace-title').textContent = listView ? groups.find(group => group.id === activeGroupId)?.name || '我的便箋' : '我的便箋桌面';
  $('#draft-count').textContent = String(Object.keys(workspace.state.drafts).length);
  $('#conflict-count').textContent = String(workspace.state.conflicts.length);
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
  const listCards = cards.filter(card => query || card.groupId === activeGroupId);
  $('[data-filter="active"]').textContent = listView || query ? '待處理' : '桌面';
  $('#count').textContent = asList ? `${listCards.length} 張便箋`
    : `${snapshot.cards.filter(card => cardPolicy(card, layout, controller.state).visible).length} 張桌面便箋`;
  if (asList) renderList(listCards);
  else renderStage(snapshot.cards);
  $('#empty').hidden = snapshot.cards.some(card => eligible(card, layout));
  desktop?.publish();
}

function renderStage(cards) {
  const stage = $('#stage'); stage.replaceChildren(); groupLabels = [];
  if (desktopInfo) { const area = screenArea(); stage.style.transform = `translate(${-area.x}px, ${-area.y}px)`; }
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
    if (policy.editing && currentDraft?.cardId === card.id && !remoteEditor && !$('#editor-dialog').open) {
      const input = element('textarea', undefined, 'inline-editor'); input.value = currentDraft.content.text;
      input.setAttribute('aria-label', '就地編輯便箋');
      input.oninput = () => { if (!editorBusy) { currentDraft.content.text = input.value; queueDraft(); } };
      input.addEventListener('compositionstart', () => { composing = true; controller.setComposing(true); });
      input.addEventListener('compositionend', () => { composing = false; controller.setComposing(false); });
      input.onkeydown = event => {
        if (event.isComposing || composing) return;
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
  const label = element('label', '名稱', 'field'); const input = element('input'); input.required = true; input.maxLength = 80; input.value = group?.name || ''; label.append(input);
  const actions = element('div', undefined, 'dialog-actions');
  const save = element('button', '保存', 'primary'); save.type = 'submit';
  if (group) {
    const merge = button('合併／移除群組', () => { dialog.close(); return openGroupMerge(group); });
    merge.disabled = activeGroups(workspace.snapshot).length < 2; actions.append(merge);
  }
  actions.append(button('取消', () => dialog.close()), save); form.append(title, label, actions); dialog.append(form); document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', event => { event.preventDefault(); run(async () => {
    if (group) await workspace.renameGroup(group.id, input.value, group.revision);
    else { const created = await workspace.createGroup(input.value); activeGroupId = created.id; }
    await workspace.layout.placeNew(workspace.snapshot, workAreas()); dialog.close(); render(); status('群組已保存');
  }); });
  dialog.showModal(); input.focus();
}

async function openGroupMerge(group) {
  if (!await controller.endEdit()) throw new Error('請先完成目前的文字輸入。');
  currentDraft = null; render();
  const dialog = element('dialog'); dialog.id = 'merge-dialog'; dialog.append(element('h2', `合併「${group.name}」`));
  const field = element('label', '接收群組', 'field'); const select = element('select'); select.id = 'merge-target';
  select.append(new Option('請選擇接收群組', ''));
  for (const target of activeGroups(workspace.snapshot).filter(item => item.id !== group.id)) select.append(new Option(target.name, target.id));
  field.append(select);
  const message = element('p'); message.id = 'merge-message'; message.setAttribute('role', 'status');
  const items = element('ul', undefined, 'merge-preview'); const actions = element('div', undefined, 'dialog-actions');
  let preview; let busy = false;
  const apply = button('確認合併並移除原群組', async () => {
    if (!preview || busy) return;
    busy = true; apply.disabled = true; select.disabled = true; cancel.disabled = true;
    try {
      await workspace.mergeGroup(preview); await controller.reconcile();
      if (activeGroupId === group.id) activeGroupId = preview.targetId;
      dialog.close(); render(); status('群組已合併，便箋內容與桌面位置已保留');
    } catch (error) { message.textContent = error.message; preview = null; }
    finally { busy = false; select.disabled = false; cancel.disabled = false; }
  }, 'primary'); apply.disabled = true;
  const cancel = button('取消', () => { if (!busy) dialog.close(); });
  const refresh = () => {
    if (busy) return;
    items.replaceChildren(); preview = null; apply.disabled = true;
    if (!select.value) { message.textContent = '選擇目的群組後，會先列出受影響的便箋。'; return; }
    try {
      preview = workspace.previewGroupMerge(group.id, select.value);
      message.textContent = `${preview.cards.length} 張便箋、${preview.draftCount} 份草稿移至「${preview.targetName}」。原群組移除，所有內容與桌面位置保留。`;
      for (const card of preview.cards) items.append(element('li', `${card.summary}${card.deleted ? '（刪除區）' : card.archived ? '（封存）' : card.completed ? '（已完成）' : ''}`));
      apply.disabled = false;
    } catch (error) { message.textContent = error.message; }
  };
  select.onchange = refresh;
  actions.append(cancel, button('重新預覽', refresh), apply);
  dialog.append(field, message, items, element('p', '合併不會排列便箋；「版面復原」不能重新建立已合併群組。', 'hint'), actions);
  dialog.oncancel = event => { if (busy) event.preventDefault(); };
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); refresh(); dialog.showModal();
}

function cardDetails(card) {
  const dialog = element('dialog'); dialog.append(element('h2', summaryText(card)));
  const groupLabel = element('label', '移至群組', 'field'); const select = element('select'); fillGroups(select, card.groupId); groupLabel.append(select);
  const visibility = element('label', undefined, 'check'); const check = element('input'); check.type = 'checkbox'; check.checked = workspace.layout.state.placements[card.id]?.visible !== false; visibility.append(check, document.createTextNode('在桌面顯示'));
  const selection = element('label', undefined, 'check'); const selectable = element('input'); selectable.type = 'checkbox'; selectable.checked = workspace.layout.state.placements[card.id]?.readOnlySelect === true; selection.append(selectable, document.createTextNode('日常觀看可選取文字（不穿透滑鼠）'));
  const layer = element('label', '常駐層級', 'field'); const layers = element('select');
  for (const [value, name] of [['desktop', '桌面'], ['floating', '浮動'], ['wallpaper', '桌布層']]) layers.append(new Option(name, value));
  layers.value = workspace.layout.state.placements[card.id]?.residentLayer || 'desktop'; layer.append(layers);
  dialog.append(groupLabel, visibility, selection, layer, element('p', desktop ? 'Windows 支援桌面與浮動層；桌布層暫以桌面層呈現，原偏好會保留。' : '此瀏覽器工作空間僅預覽卡片，沒有系統桌面分層或全域快捷鍵。', 'hint'));
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
  if (composing) return;
  if (!card && !recovered && !activeGroups(workspace.snapshot).length) {
    const group = await workspace.createGroup('我的便箋'); activeGroupId = group.id; render();
  }
  if (controller.state.editingCardId && currentDraft) await controller.endEdit();
  remoteEditor = null;
  currentDraft = recovered ? workspace.recoverDraft(recovered.id) : workspace.blankDraft(activeGroupId, card);
  currentDraft.content.attachments ||= [];
  $('#editor-title').textContent = card || recovered?.baseRevision ? '編輯便箋' : '記下想法';
  $('#editor-text').value = currentDraft.content.text; fillGroups($('#editor-group'), currentDraft.groupId);
  $('#editor-group').disabled = Boolean(currentDraft.baseRevision); $('#save-copy').hidden = true;
  $('#editor-dialog').showModal(); showEditorTab(false); await renderAttachments(); queueDraft(); $('#editor-text').focus();
}

async function beginInlineEdit(card, gesture = false) {
  if (composing) return;
  if (remoteEditor) {
    const same = currentDraft?.cardId === card.id;
    if (!await controller.endEdit()) return; remoteEditor = null;
    if (same) { await controller.beginEdit(card.id, { gesture }); render(); $('#stage .inline-editor')?.focus(); return; }
  }
  if (controller.state.editingCardId === card.id && currentDraft?.cardId === card.id) {
    $('#stage .inline-editor')?.focus(); return;
  }
  if (!await controller.beginEdit(card.id, { gesture })) return;
  activeGroupId = card.groupId;
  currentDraft = workspace.blankDraft(card.groupId, card); queueDraft(); render();
  $('#stage .inline-editor')?.focus();
}

function renderSelection() {
  const layout = workspace.layout.state; const state = controller.state;
  if (state.activeGroupId) activeGroupId = state.activeGroupId;
  $('#groups').querySelectorAll('.group-row').forEach(row => row.classList.toggle('active', row.dataset.groupId === activeGroupId));
  const order = sceneOrder(workspace.snapshot.cards, layout, state).map(card => card.id);
  $('#stage').querySelectorAll('.card').forEach(paper => {
    paper.classList.toggle('selected', paper.dataset.cardId === state.selectedCardId);
    paper.style.zIndex = String(5 + order.indexOf(paper.dataset.cardId));
  });
  desktop?.publish();
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
async function flushDraft() {
  const editor = currentDesktopEditor();
  if (editor) {
    const sequence = await desktop.flush(editor);
    if (currentDesktopEditor()?.sequence !== sequence) throw new Error('桌面草稿保存順序不符，尚未結束編輯。');
  }
  await queueDraft();
}
function setEditorBusy(value) {
  editorBusy = value; $('#editor-text').readOnly = value;
  $('#stage').querySelectorAll('.inline-editor').forEach(node => { node.readOnly = value; });
  $('#editor-form').querySelectorAll('button').forEach(node => { node.disabled = value; });
  $('#attachment-input').disabled = value;
  $('#editor-group').disabled = value || Boolean(currentDraft?.baseRevision);
}
async function closeEditor() {
  if (editorBusy || composing) return;
  setEditorBusy(true);
  try { await flushDraft(); currentDraft = null; remoteEditor = null; $('#editor-dialog').close(); controller.setComposing(false); await controller.endEdit(); render(); status('草稿已保留'); }
  finally { setEditorBusy(false); }
}
async function saveEditor(asCopy = false) {
  if (editorBusy || !currentDraft || composing) return;
  setEditorBusy(true);
  try {
    await flushDraft();
    await workspace.commitDraft(currentDraft.id, { asCopy });
    currentDraft = null; remoteEditor = null; $('#editor-dialog').close(); controller.setComposing(false); await controller.endEdit();
    await workspace.layout.placeNew(workspace.snapshot, workAreas()); render(); status('便箋已存本機');
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
      if (native?.info.capabilities.fileShare) row.append(button('分享', async () => {
        if (editorBusy) return;
        setEditorBusy(true);
        try { const result = await nativeFiles.export(new Uint8Array(blob), attachment.name, 'share'); status(result.completed ? '已開啟附件分享' : '已取消分享'); }
        finally { setEditorBusy(false); }
      }));
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
      mode: formationMode, workAreas: workAreas(), summaryBands, allowResize: $('#allow-resize').checked });
    $('#formation-description').textContent = `排列 ${Object.keys(formationPreview.changes).length} 張便箋。${formationPreview.resized.length ? ` ${formationPreview.resized.length} 張會調整大小。` : ' 保持原尺寸。'}${formationPreview.overflow.length ? ` ${formationPreview.overflow.length} 張會超出群組區域。` : ''} 可透過復原還原這次排列。`;
    $('#apply-formation').disabled = false;
  } catch (error) { formationPreview = null; $('#formation-description').textContent = error.message; $('#apply-formation').disabled = true; }
}

function showSettings() {
  const layout = workspace.layout.state; $('#desktop-visible').checked = layout.desktopVisible;
  settingsSlots = [...layout.grid.slots];
  fillGroups($('#my-group'), layout.myGroupId, true); $('#grid-rows').value = String(layout.grid.rows); $('#grid-columns').value = String(layout.grid.columns);
  const fields = $('#shortcut-fields'); fields.replaceChildren();
  const actions = [[shortcutActions.all, '操作所有便箋'], [shortcutActions.capture, '快速記錄'], [shortcutActions.toggle, '顯示／隱藏桌面便箋'],
    ...activeGroups(workspace.snapshot).map(group => [group.id, `操作「${group.name}」`])];
  for (const [target, name] of actions) {
    const label = element('label', name, 'field'); const input = element('input'); input.dataset.shortcutTarget = target;
    input.value = Object.entries(layout.shortcuts).filter(([, value]) => value === target).map(([key]) => key).join(', ');
    input.placeholder = '例如 Ctrl+Shift+1，多組用逗號分隔'; input.oninput = () => previewGrid(); label.append(input); fields.append(label);
  }
  $('#settings-dialog').showModal(); previewGrid();
}
function readShortcuts() {
  const result = {};
  for (const input of $('#shortcut-fields').querySelectorAll('input')) {
    if (!input.value.trim()) continue;
    for (const value of input.value.split(',')) {
      const key = normalizeShortcut(value);
      if (Object.hasOwn(result, key)) throw new Error('同一快捷鍵只能指定一個動作。');
      result[key] = input.dataset.shortcutTarget;
    }
  }
  if (nativeShortcuts && Object.keys(result).length > 32) throw new Error('此裝置最多設定 32 組快捷鍵。');
  return validateShortcuts(result, activeGroups(workspace.snapshot));
}
function previewGrid(reshape = false) {
  const rows = Number($('#grid-rows').value); const columns = Number($('#grid-columns').value); const groups = activeGroups(workspace.snapshot);
  if (reshape || settingsSlots.length !== rows * columns) {
    const ordered = settingsSlots.filter(id => id && groups.some(group => group.id === id));
    for (const group of groups) if (!ordered.includes(group.id)) ordered.push(group.id);
    settingsSlots = Array.from({ length: rows * columns }, (_, index) => ordered[index] || null);
  }
  const preview = $('#grid-preview'); preview.replaceChildren(); preview.style.gridTemplateColumns = `repeat(${columns},1fr)`;
  for (let i = 0; i < rows * columns; i++) {
    const field = element('label', `區域 ${i + 1}`); const select = element('select');
    select.setAttribute('aria-label', `區域 ${i + 1} 的群組`); select.append(new Option('空區', ''));
    for (const group of groups) select.append(new Option(group.name, group.id));
    select.value = settingsSlots[i] || '';
    select.onchange = () => {
      const next = select.value || null; const other = settingsSlots.findIndex((id, index) => id === next && index !== i);
      if (other >= 0) settingsSlots[other] = settingsSlots[i];
      settingsSlots[i] = next; previewGrid();
    };
    field.append(select); preview.append(field);
  }
  try { gridRegions({ rows, columns, slots: settingsSlots, area: screenArea() }, groups); readShortcuts(); $('#grid-message').textContent = `${rows} 列 × ${columns} 欄，共 ${rows * columns} 區。選取已使用的群組會交換區域。`; $('#save-settings').disabled = false; }
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
  desktop?.publish();
}

function bindEvents() {
  $('#hide-main').onclick = () => run(() => desktopAction('@hide'));
  $('#retry-shortcuts').onclick = () => { void nativeShortcuts?.update(workspace.layout.state.shortcuts, true); };
  for (const id of ['new-card', 'empty-add']) $(`#${id}`).onclick = () => run(() => openEditor());
  $('#add-group').onclick = () => groupEditor();
  $('#search').oninput = render; $('#view-toggle').onclick = () => { listView = !listView; render(); };
  document.querySelectorAll('[data-filter]').forEach(node => { node.onclick = () => { filter = node.dataset.filter; render(); }; });
  $('#operate-group').onclick = () => run(async () => { await controller.activate({ kind: 'group', groupId: activeGroupId }); render(); });
  $('#operate-all').onclick = () => run(async () => { await controller.activate({ kind: 'all' }); render(); });
  $('#stop-operation').onclick = () => run(async () => { await controller.activate({ kind: 'none' }); render(); });
  $('#cycle-prev').onclick = () => run(() => { controller.cycle(activeGroupId, -1); render(); });
  $('#cycle-next').onclick = () => run(() => { controller.cycle(activeGroupId, 1); render(); });
  $('#stack').onclick = () => openFormation('stack'); $('#spread').onclick = () => openFormation('spread');
  $('#undo').onclick = () => run(async () => { await workspace.undo(workAreas()); await controller.reconcile(); render(); status('已復原'); });
  $('#formation-scope').onchange = updateFormation; $('#allow-resize').onchange = updateFormation;
  $('#cancel-formation').onclick = () => $('#formation-dialog').close();
  $('#apply-formation').onclick = () => run(async () => { await controller.applyFormation(formationPreview); $('#formation-dialog').close(); render(); status('排列已完成，可按復原還原'); });
  $('#settings-button').onclick = showSettings; $('#cancel-settings').onclick = () => $('#settings-dialog').close();
  $('#backup-button').onclick = () => run(async () => {
    if (editorBusy || composing) return;
    if (currentDraft) await flushDraft();
    if (!await controller.endEdit()) return;
    currentDraft = null; controller.cancelDrag(); $('#settings-dialog').close(); render();
    showBackupDialog({ workspace, storage, getWorkAreas: workAreas, flush: flushDraft, automatic, automaticError, files: nativeBackups?.manual,
      onChanged: async () => { await controller.reconcile(); render(); } });
  });
  $('#grid-rows').onchange = () => previewGrid(true); $('#grid-columns').onchange = () => previewGrid(true);
  $('#save-settings').onclick = () => run(async () => {
    const rows = Number($('#grid-rows').value); const columns = Number($('#grid-columns').value);
    await workspace.layout.configure({ desktopVisible: $('#desktop-visible').checked, myGroupId: $('#my-group').value || null,
      shortcuts: readShortcuts(),
      grid: { rows, columns, area: screenArea(), slots: [...settingsSlots] } }, workspace.snapshot);
    $('#settings-dialog').close(); render(); status('設定已存本機，既有卡片位置不變');
  });
  $('#editor-text').oninput = () => { if (!currentDraft || editorBusy) return; currentDraft.content.text = $('#editor-text').value; queueDraft(); };
  $('#editor-text').addEventListener('compositionstart', () => { composing = true; controller.setComposing(true); });
  $('#editor-text').addEventListener('compositionend', () => { composing = false; controller.setComposing(false); });
  $('#editor-group').onchange = () => { if (!editorBusy) { currentDraft.groupId = $('#editor-group').value; queueDraft(); } };
  $('#edit-tab').onclick = () => showEditorTab(false); $('#preview-tab').onclick = () => showEditorTab(true);
  $('#share-note').onclick = () => run(async () => {
    if (!currentDraft || editorBusy || composing) return;
    setEditorBusy(true);
    try {
      await flushDraft();
      const bytes = new TextEncoder().encode(currentDraft.content.text);
      const result = await nativeFiles.export(bytes, 'work-fleet-note.md', bytes.length <= 128 * 1024 ? 'shareText' : 'share');
      status(result.completed ? '已開啟便箋文字分享' : '已取消分享');
    } finally { setEditorBusy(false); }
  });
  $('#insert-task').onclick = () => { if (editorBusy) return; const text = $('#editor-text'); showEditorTab(false); text.setRangeText('- [ ] ', text.selectionStart, text.selectionEnd, 'end'); currentDraft.content.text = text.value; queueDraft(); text.focus(); };
  $('#editor-form').onsubmit = event => { event.preventDefault(); run(() => saveEditor()); };
  $('#save-copy').onclick = () => run(() => saveEditor(true));
  $('#keep-draft').onclick = () => run(closeEditor); $('#close-editor').onclick = () => run(closeEditor);
  $('#capture-inbox-button').onclick = () => run(async () => {
    if (!activeGroups(workspace.snapshot).length) { const group = await workspace.createGroup('我的便箋'); activeGroupId = group.id; render(); }
    fillGroups($('#capture-group'), activeGroupId); $('#capture-result').textContent = ''; $('#capture-inbox-dialog').showModal(); await refreshCaptures();
  });
  $('#close-capture').onclick = () => { if (!captureBusy) $('#capture-inbox-dialog').close(); };
  $('#capture-inbox-dialog').addEventListener('cancel', event => { if (captureBusy) event.preventDefault(); });
  $('#accept-capture').onclick = () => run(async () => {
    if (captureBusy || !selectedCapture) return; captureBusy = true; $('#accept-capture').disabled = true; $('#discard-capture').disabled = true; $('#capture-group').disabled = true; $('#capture-result').textContent = '正在保存分享草稿…';
    try {
      const result = await captureInbox.accept(selectedCapture, $('#capture-group').value); selectedCapture = null;
      render(); await refreshCaptures(true); $('#capture-inbox-dialog').close();
      if (result.draftId) await openEditor(null, workspace.state.drafts[result.draftId]);
      else status('此分享已接收為便箋。');
    } catch (error) { render(); $('#capture-result').textContent = error.message; throw error; }
    finally { captureBusy = false; $('#capture-group').disabled = false; $('#accept-capture').disabled = !selectedCapture || Boolean(selectedCapture.damaged); $('#discard-capture').disabled = !selectedCapture; }
  });
  $('#discard-capture').onclick = () => { if (!captureBusy && selectedCapture) $('#discard-capture-dialog').showModal(); };
  $('#cancel-discard-capture').onclick = () => $('#discard-capture-dialog').close();
  $('#confirm-discard-capture').onclick = () => run(async () => {
    if (captureBusy || !selectedCapture) return; captureBusy = true;
    try { await captureInbox.discard(selectedCapture); $('#discard-capture-dialog').close(); selectedCapture = null; await refreshCaptures(true); }
    finally { captureBusy = false; }
  });
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
  $('#conflicts-button').onclick = () => run(async () => {
    if (editorBusy || composing) return;
    setEditorBusy(true);
    try {
      if (currentDraft) await flushDraft();
      if (!await controller.endEdit()) return;
      currentDraft = null; render();
      showRevisionDialog({ workspace, storage, profileId, onChanged: async () => {
        await controller.reconcile(); await workspace.layout.placeNew(workspace.snapshot, workAreas()); render();
      } });
    } finally { setEditorBusy(false); }
  });
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
    else if (result.kind !== 'ignored') { if (controller.state.activeGroupId) activeGroupId = controller.state.activeGroupId; render(); }
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
    if (event.isComposing || composing || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    const editControl = event.target.closest('input,textarea,select');
    const shortcut = shortcutForEvent(event, workspace.layout.state.shortcuts, { editing: Boolean(editControl), inline: editControl?.matches('.inline-editor') });
    if (shortcut) {
      event.preventDefault();
      const admission = desktop && shortcut.target === shortcutActions.capture ? native.bridge.request('desktop.intent').catch(() => ({ intent: null })) : Promise.resolve({ intent: null });
      run(async () => desktopAction(shortcut.target, (await admission).intent));
      return;
    }
    if (editControl) return;
    if (event.key === 'Escape') { event.preventDefault(); run(async () => { await controller.escape(); render(); }); }
    if (event.key === 'Enter' && controller.state.selectedCardId) { event.preventDefault(); run(() => beginInlineEdit(currentCard(controller.state.selectedCardId))); }
    if (event.key === 'Shift' && controller.state.dragSession) dragPaint(controller.pointerMove(controller.state.dragSession.current, { pointerId: controller.state.dragSession.pointerId, shiftKey: true, labels: groupLabels }));
  });
  document.addEventListener('keyup', event => {
    if (event.key === 'Shift' && controller.state.dragSession) dragPaint(controller.pointerMove(controller.state.dragSession.current, { pointerId: controller.state.dragSession.pointerId, shiftKey: false, labels: groupLabels }));
  });
}

run(initialize);
