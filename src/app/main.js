import { Workspace } from '../core/workspace.js';
import { activeGroups, copy, eligible, gridRegions, summaryText } from '../core/contracts.js';
import { normalizeShortcut, regionShortcuts, regionTarget, resolveShortcuts, shortcutActions, shortcutForEvent, validateShortcuts } from '../core/shortcuts.js';
import { planFormation } from '../layout/formation.js';
import { adjustStage, groupLayer, groupLayerOrder, stepGroup } from '../layout/stages.js';
import { mainView } from '../layout/store.js';
import { InteractionController, cardPolicy, sceneOrder } from '../interaction/controller.js';
import { IndexedDbStorage, acquireProfile } from '../storage/indexed-db.js';
import { renderMarkdown } from './markdown.js';
import { checklistProgress, toggleChecklist } from './checklist.js';
import { showRevisionDialog } from './conflicts.js';
import { backupPanel } from './backup.js';
import { AutomaticBackup } from '../backup/automatic.js';
import { IndexedDbBackupJournal, BrowserAutomaticFiles } from '../backup/browser-automatic.js';
import { startAutomaticBackup } from '../backup/lifecycle.js';
import { connectNative } from '../native/bridge.js';
import { NativeFiles } from '../native/files.js';
import { NativeAttachments } from '../native/attachments.js';
import { renderAttachmentTiles } from './attachments.js';
import { NativeCaptureInbox } from '../native/capture.js';
import { NativeStorage } from '../storage/native.js';
import { nativeBackupAdapters } from '../backup/native.js';
import { DesktopAuthority } from '../desktop/authority.js';
import { overlayMainStep } from '../desktop/overlay.js';
import { DesktopOwner } from '../desktop/owner.js';
import { projectDesktop } from '../desktop/projection.js';
import { NativeShortcutSettings } from '../native/shortcuts.js';
import { NativeGoogleFileStore } from '../native/google.js';
import { FileSync, resetSource } from '../sources/file-sync.js';
import { prepareCloudRestore, stageCloudRestore, resumeCloudRestore } from '../backup/cloud-restore.js';

const $ = selector => document.querySelector(selector);
// Group paper, shared with the desktop scenes. Neighbouring entries differ in hue so the first groups stay distinct.
const colors = ['#ffe98a', '#bfe6cf', '#bcd8f5', '#f9c8b6', '#d9ccf2', '#b5e0dc', '#f5c6da', '#f2ddb0', '#cdd5e3'];
let workspace; let storage; let controller; let lease;
// The browser preview opens on its desktop canvas when there is room; desktop hosts and phones open on the papers.
let activeGroupId; let filter = 'active'; let showDesktop = !matchMedia('(max-width:640px)').matches;
let currentDraft = null; let draftSequence = 0; let draftPending = Promise.resolve(); let editorBusy = false;
let composing = false;
let formationMode = 'stack'; let formationPreview; let groupLabels = [];
let lastVisibleArea;
let settingsSlots = []; let settingsPage = null; let dataPanel = null;
let automatic; let automaticError; let browserJournal;
let native; let nativeBackups; let stopAutomatic; let nativeClosing = false;
let nativeFiles; let attachmentFiles;
const noteAttachmentCleanup = []; const stageAttachmentCleanup = []; const editorAttachmentCleanup = [];
let captureInbox; let selectedCapture; let captureBusy = false;
let desktop; let desktopInfo; let remoteEditor = null;
let nativeShortcuts; let shortcutStatus = []; let labwcShortcuts = null;
let googleAccount; let syncService; let syncTimer; let syncBusy = false; let accountBusy = false;
let syncState = 'off'; let captureCount = 0; let handheld = false; let sourceResetAsked = false;
const narrow = matchMedia('(max-width:640px)');
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
function primaryArea(workAreas) { const { x, y, width, height } = workAreas.find(area => area.primary) || workAreas[0]; return { x, y, width, height }; }
function screenArea() {
  if (desktopInfo) return primaryArea(desktopInfo.workAreas);
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
  if (none) select.append(new Option('不指定', ''));
  for (const group of activeGroups(workspace.snapshot)) select.append(new Option(group.name, group.id));
  select.value = selected || '';
}

async function initialize() {
  native = await connectNative();
  if (native) {
    profileId = native.info.profileId; storage = new NativeStorage(native.bridge, native.info);
    nativeBackups = nativeBackupAdapters(native.bridge, native.info);
    if (native.info.capabilities.attachmentFiles) attachmentFiles = new NativeAttachments(native.bridge);
    if (native.info.capabilities.fileExport) {
      nativeFiles = new NativeFiles(native.bridge, native.info);
      const stopDownloads = nativeFiles.interceptDownloads(status); addEventListener('pagehide', stopDownloads, { once: true });
    }
    // Real desktop scenes show the papers, so the main window opens on the board or list instead of a second canvas.
    if (native.info.capabilities.desktopPresentation) { desktopInfo = await native.bridge.request('desktop.info'); showDesktop = false; }
    // Phones and tablets show no desktop papers, so nothing there arranges them: no canvas, layout tools or settings.
    handheld = ['ios', 'android'].includes(native.info.platform);
    if (handheld) { showDesktop = false; document.querySelectorAll('[data-arrange]').forEach(node => { node.hidden = true; }); }
    if (native.info.platform === 'macos') $('#settings-button').title = '設定（⌘,）';
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
    commands: workspace, saveDraft: async () => { if (currentDraft) await flushDraft(); },
    releaseDraft: async cardId => {
      if (currentDraft?.cardId !== cardId) return;
      // Clear first so a background flush cannot write the draft back while it is being discarded.
      const draft = currentDraft; currentDraft = null;
      // Dropping is housekeeping: a failure only leaves an extra draft, so report it without failing the action.
      try { await workspace.discardUnneededDraft(draft.id); } catch (error) { status(`草稿整理失敗：${error.message}`, true); }
    } });
  // The regions move to today's primary display before new papers take a place in them.
  if (desktopInfo) await workspace.layout.recoverDisplays(workAreas(), screenArea());
  await workspace.layout.placeNew(workspace.snapshot, workAreas());
  if (desktopInfo) initializeDesktop();
  $('#storage-note').textContent = native ? '加密保存在這台裝置' : '保存在這個瀏覽器';
  renderAccount(); setSync('off', native ? '只存在這台裝置' : '只存在這個瀏覽器');
  try {
    const journal = native ? storage.journal() : await IndexedDbBackupJournal.open(); if (!native) browserJournal = journal;
    const files = nativeBackups?.files || new BrowserAutomaticFiles(); const vault = nativeBackups?.vault;
    const service = new AutomaticBackup({ workspace, storage, journal, files, vault, appVersion: native?.info.appVersion,
      flush: () => desktop ? desktop.perform(flushDraft) : flushDraft() }); await service.load();
    automatic = { service, files, vault }; stopAutomatic = startAutomaticBackup(service);
    addEventListener('pagehide', () => { stopAutomatic(); journal.close(); });
  } catch (error) { automaticError = `自動備份尚未開啟：${error.message}`; }
  if (native) {
    native.bridge.onCloseRequested(() => { void prepareNativeClose(); });
    native.bridge.onEvent('update-state', message => { updateState = message.state; if ($('#settings-dialog').open) renderUpdate(); });
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
    nativeShortcuts = new NativeShortcutSettings(native.bridge, (value, labwc) => { shortcutStatus = value; labwcShortcuts = labwc; renderShortcutStatus(); }, error => status(error.message, true));
    native.bridge.onEvent('desktop-action', message => { void run(async () => {
      try { await desktopAction(message.target, message.intent); }
      catch (error) { await native.bridge.request('desktop.showMain', { intent: message.intent }).catch(() => {}); throw error; }
    }); });
    $('#shortcut-note').textContent = '在任何程式中都能使用。一個動作可以設多組，用逗號分開。';
    addEventListener('pagehide', () => nativeShortcuts.close());
  }
  displayBackend = native?.info.displayBackend ?? null;
  // GNOME Wayland without desktop papers points at the setting that brings them through XWayland.
  const displayHint = displayBackend?.current === 'wayland' && !displayBackend.fixed ? ' 可在設定的「桌面」頁改用 XWayland。' : '';
  bindEvents(); render(); status(native?.info.desktopReason ? native.info.desktopReason + displayHint : '已開啟本機資料');
  $('#share-note').hidden = !native?.info.capabilities.fileShare;
  if (native) await initializeGoogle();
  if (native?.info.capabilities.shareInbox) {
    captureInbox = new NativeCaptureInbox(native, workspace, storage);
    native.bridge.onEvent('host-capture', () => { void refreshCaptures().catch(error => status(error.message, true)); });
    native.bridge.onEvent('host-foreground', () => { void refreshCaptures().catch(error => status(error.message, true)); });
    await refreshCaptures();
  }
  // The browser canvas is the work area: the first observation lays the regions on it, and resizing the window writes
  // the layout once the size settles rather than on every frame.
  let lastArea = JSON.stringify(workspace.layout.state.grid.area); let resizeTimer = null;
  new ResizeObserver(() => {
    if (desktopInfo) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if ($('#stage-shell').hidden || !$('#stage-shell').getClientRects().length) return;
      const area = screenArea();
      if (JSON.stringify(area) === lastArea) return;
      lastArea = JSON.stringify(area);
      run(async () => {
        controller.cancelDrag();
        const result = await workspace.layout.recoverDisplays([area], area);
        render(); if (result.rescued.length) status(`已將 ${result.rescued.length} 張不可達便箋移回可見範圍`);
      });
    }, 250);
  }).observe($('#stage-shell'));
}

async function initializeGoogle() {
  clearInterval(syncTimer);
  googleAccount = await native.bridge.request('google.status');
  const google = profileId.startsWith('google:'); const connected = googleAccount.connected;
  const paused = google && googleAccount.paused === true;
  renderGoogleAccess();
  $('#google-sign-in').onclick = () => { void changeGoogleAccount('signIn'); };
  $('#google-sign-out').onclick = () => { void changeGoogleAccount('signOut'); };
  $('#google-local').onclick = () => { void changeGoogleAccount('local'); };
  $('#google-sync').textContent = workspace.state.cloudRestore ? '繼續覆蓋 Google' : '立即同步';
  $('#google-sync').onclick = () => {
    if (workspace.state.cloudRestore) askResumeCloudRestore(); else void syncGoogle(true);
  };
  if (workspace.state.cloudRestore) {
    clearInterval(syncTimer); syncService = null;
    setSync('attention', 'Google 覆蓋尚未完成', workspace.state.cloudRestore.error || '還原資料已保存在這台裝置；請按「繼續覆蓋 Google」。');
    return;
  }
  renderAccount();
  if (connected || paused) {
    $('#storage-note').textContent = paused ? '便箋可離線使用；系統安全儲存可用後會繼續同步' : '同步到你的 Google 帳號';
    setSync(paused ? 'attention' : 'off', paused ? '同步暫停' : '等待同步', paused ? googleAccount.pauseReason : '');
    syncService = new FileSync({ workspace, storage, fileStore: new NativeGoogleFileStore(native.bridge, native.info, googleAccount.accountId) });
    syncTimer = setInterval(() => { void syncGoogle(); }, 20000);
    addEventListener('online', () => { void syncGoogle(); });
    addEventListener('pagehide', () => { clearInterval(syncTimer); void syncService?.stop(); });
    if (!paused) void syncGoogle();
  } else if (google) {
    $('#storage-note').textContent = '重新登入後才會繼續同步';
    setSync('attention', '請重新登入 Google', '這台裝置上的便箋和還沒同步的修改都還在。');
  } else {
    setSync('off', googleAccount.configured ? '尚未連接 Google' : '只存在這台裝置',
      googleAccount.configured ? '登入後會改用該帳號的便箋；這裡的本機便箋會留在這台裝置。' : '');
  }
}
function renderGoogleAccess() {
  const google = profileId.startsWith('google:');
  const connected = Boolean(googleAccount?.connected);
  const paused = google && googleAccount?.paused === true;
  $('#google-row').hidden = false; $('#local-row').hidden = !google; $('#sync-row').hidden = !(connected || paused);
  $('#google-value').textContent = paused ? '同步暫停' : connected ? googleAccount.email || 'Google 帳號' : googleAccount.configured ? '未登入' : '這個版本還不能登入';
  $('#google-sign-in').hidden = !googleAccount.configured;
  $('#google-sign-in').textContent = connected || paused ? '切換帳號' : google ? '重新登入' : '登入';
  $('#google-sign-out').hidden = !(connected || paused);
}
// The account chip and the settings identity say where the papers live and how syncing goes.
function renderAccount() {
  const connected = Boolean(googleAccount?.connected);
  const name = connected ? googleAccount.email || 'Google 帳號' : profileId.startsWith('google:') ? 'Google 帳號' : '本機便箋';
  for (const [avatar, initial, label] of [['#account-avatar', '#account-initial', '#account-name'], ['#identity-avatar', '#identity-initial', '#identity-name']]) {
    $(label).textContent = name;
    $(initial).textContent = connected ? [...name][0].toLocaleUpperCase() : ''; $(initial).hidden = !connected;
    $(`${avatar} svg`).toggleAttribute('hidden', connected); $(avatar).classList.toggle('signed-in', connected);
  }
}
function setSync(state, text, detail = '') {
  syncState = state; $('#account').dataset.sync = state; $('#settings-dialog').dataset.sync = state;
  $('#sync-status').textContent = text; $('#sync-detail').textContent = text;
  $('#account-detail').textContent = detail; $('#account-detail').hidden = !detail; updateAttention();
}
// The drawer hides the account chip and the sidebar links on phones, so their warnings show on the drawer button.
function updateAttention() {
  $('#attention-dot').hidden = !(workspace?.state.conflicts.length || captureCount || ['error', 'attention'].includes(syncState));
}
async function syncGoogle(force = false) {
  // Settings edits nothing a sync could overwrite and holds 立即同步, so it does not hold syncing; a running backup or
  // restore on its data page does.
  const settings = $('#settings-dialog');
  if (!syncService || syncBusy || nativeClosing || accountBusy || composing || dataPanel?.busy() || dataPanel?.blocksSync()
    || [...document.querySelectorAll('dialog[open]')].some(dialog => dialog !== settings)) return;
  const sourceSync = syncService; const sourceProfile = profileId;
  const current = () => !nativeClosing && !accountBusy && syncService === sourceSync && profileId === sourceProfile;
  syncBusy = true; $('#google-sync').disabled = true; setSync('busy', '正在同步…');
  try {
    if (force && native?.info.capabilities?.vaultUnlock) {
      setSync('busy', '正在準備同步…', '金鑰圈若已鎖定，請在系統視窗中解鎖；完成後會接續同步。');
      const unlockedAccount = await native.bridge.request('google.unlockVault');
      if (!current()) return;
      googleAccount = unlockedAccount;
      renderGoogleAccess(); renderAccount();
      $('#storage-note').textContent = googleAccount.connected ? '同步到你的 Google 帳號' : '重新登入後才會繼續同步';
      setSync('busy', '正在同步…');
    }
    await (desktop ? desktop.perform(sync) : sync());
    async function sync() {
      if (!current()) return;
      await flushDraft();
      if (!current()) return;
      await sourceSync.sync({ force });
      if (!current()) return;
      if (!activeGroups(workspace.snapshot).length && !workspace.snapshot.groups.length) await workspace.createGroup('我的便箋');
      activeGroupId = activeGroups(workspace.snapshot).some(group => group.id === activeGroupId) ? activeGroupId : activeGroups(workspace.snapshot)[0]?.id;
      await controller.reconcile(); await workspace.layout.placeNew(workspace.snapshot, workAreas()); render();
      if (googleAccount?.paused) {
        const account = await native.bridge.request('google.status');
        if (!current()) return;
        googleAccount = account; renderGoogleAccess(); renderAccount();
        $('#storage-note').textContent = googleAccount.paused ? '便箋可離線使用；系統安全儲存可用後會繼續同步' : '同步到你的 Google 帳號';
        if (googleAccount.paused) { setSync('attention', '同步暫停', googleAccount.pauseReason); return; }
      }
      const pending = workspace.pendingOperations.length;
      if (pending) setSync('pending', `${pending} 筆等待同步`);
      else setSync('ok', `已同步 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    }
  } catch (error) {
    if (!current()) return;
    if (error.code === 'source-reset') { setSync('attention', '雲端已重設', error.message); askAfterSourceReset(); return; }
    const vaultPaused = ['vault-locked', 'vault-unavailable', 'storage-cleanup', 'vault-unlock-cancelled', 'vault-unlock-timeout'].includes(error.code);
    if (vaultPaused) {
      googleAccount = { ...googleAccount, connected: false, paused: true, pauseReason: error.message };
      renderGoogleAccess(); renderAccount();
    }
    setSync(vaultPaused ? 'attention' : 'error', vaultPaused ? '同步暫停' : '同步失敗', error.message);
    if (error.code === 'unauthorized' || error.code === 'source-permission') $('#google-sign-in').textContent = '重新登入 Google';
  }
  finally { syncBusy = false; $('#google-sync').disabled = false; }
}
async function changeGoogleAccount(action) {
  if (accountBusy || nativeClosing || dataPanel?.busy()) return; accountBusy = true;
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
    document.body.inert = false; status(error.message, error.code !== 'google-cancelled'); await desktop?.cancelClose();
    if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: false }).catch(() => {});
    if (automatic) stopAutomatic = startAutomaticBackup(automatic.service);
    accountBusy = false; await initializeGoogle();
  }
}

// The workspace a data reset deletes, and what it leaves on this device.
function resetPlan() {
  const google = profileId.startsWith('google:');
  const keeps = ['已保存的備份 ZIP 檔'];
  if (captureInbox) keeps.push('分享收件匣中尚未接收的分享');
  if (google) keeps.push('Google 登入狀態', '這台裝置上的本機便箋');
  else if (googleAccount?.configured) keeps.push('這台裝置上的 Google 帳號工作空間');
  return { cloud: google, keeps, run: resetWorkspace,
    // Clearing a Google workspace needs its Drive data, so it waits for a working sign-in.
    blocked: google && !googleAccount?.connected ? '請先在帳號選單重新登入 Google，才能一併清除雲端資料。' : null,
    target: google ? `${googleAccount?.email || 'Google 帳號'} 的 Google 工作空間（所有裝置）` : native ? '本機便箋（這台裝置）' : '本機便箋（這個瀏覽器）' };
}
function requireConnected() {
  if (!googleAccount?.connected) throw new Error('請先在帳號選單重新登入 Google，才能一併清除雲端資料。');
}

function cloudRestoreOptions() {
  if (!native || !googleAccount?.connected || !profileId.startsWith('google:') || workspace.state.cloudRestore) return null;
  const fileStore = new NativeGoogleFileStore(native.bridge, native.info, googleAccount.accountId);
  return { target: googleAccount.email || '目前 Google 帳號',
    prepare: async options => {
      requireConnected();
      await syncService?.sync({ force: true });
      return prepareCloudRestore({ ...options, workspace, sourceId: fileStore.sourceId });
    },
    run: (plan, safety, say) => runCloudRestore(say, { plan, safety, fileStore }) };
}

function backupSourceOptions() {
  const google = profileId.startsWith('google:');
  return { target: google ? `${googleAccount?.email || '目前 Google 帳號'} 的 Google 工作空間` : native ? '本機便箋（這台裝置）' : '本機便箋（這個瀏覽器）',
    sync: async () => {
      if (!googleAccount?.connected || !syncService || workspace.state.cloudRestore || nativeClosing || accountBusy)
        throw new Error('目前無法同步 Google；請確認登入、網路與尚未完成的覆蓋作業。');
      syncBusy = true; $('#google-sync').disabled = true; setSync('busy', '正在同步…');
      try {
        const sync = async () => {
          await syncService.sync({ force: true }); await controller.reconcile();
          await workspace.layout.placeNew(workspace.snapshot, workAreas()); render();
        };
        await (desktop ? desktop.perform(sync) : sync());
        setSync('ok', '已同步');
      } catch (error) { setSync('error', '同步失敗', error.message); throw error; }
      finally { syncBusy = false; $('#google-sync').disabled = false; }
    } };
}

async function applyLocalRestore(plan, signal) {
  stopAutomatic?.();
  try {
    await automatic?.service.whenIdle();
    const apply = () => workspace.applyRestore(plan, { signal,
      persist: (state, revision, attachments, options) => storage.saveWithAttachments(state, revision, attachments, options) });
    return await (desktop ? desktop.perform(apply) : apply());
  } finally { if (automatic) stopAutomatic = startAutomaticBackup(automatic.service); }
}

async function runCloudRestore(say, { plan, safety, fileStore } = {}) {
  if (accountBusy || nativeClosing) throw new Error('帳號或關閉作業進行中，請稍後再試。');
  requireConnected(); accountBusy = true; clearInterval(syncTimer); stopAutomatic?.();
  let durable = false;
  try {
    await automatic?.service.whenIdle();
    desktop?.beginClose(); if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: true });
    await desktop?.whenIdle(); desktop?.sealClose();
    await Promise.allSettled([...activeActions, draftPending]);
    await syncService?.stop({ endSession: false }); await syncService?.whenIdle(); syncService = null;
    document.body.inert = true;
    fileStore ||= new NativeGoogleFileStore(native.bridge, native.info, googleAccount.accountId);
    let state;
    if (plan) state = await stageCloudRestore({ workspace, storage, fileStore, plan, safetyBackup: safety });
    else state = await storage.load(profileId);
    durable = Boolean(state?.cloudRestore);
    await resumeCloudRestore({ state, storage, fileStore, progress: say });
    location.reload();
  } catch (error) {
    // A lost save acknowledgement or a failed remote step must reopen the durable job, never the old writer.
    const saved = await storage.load(profileId).catch(() => null);
    durable ||= Boolean(saved?.cloudRestore);
    if (durable) {
      if (saved?.cloudRestore) {
        saved.cloudRestore.error = String(error.message || '覆蓋尚未完成').slice(0, 2048);
        const revision = saved.revision; saved.revision++;
        await storage.save(saved, revision).catch(() => {});
      }
      location.reload(); return;
    }
    document.body.inert = false; await desktop?.cancelClose();
    if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: false }).catch(() => {});
    accountBusy = false;
    if (automatic) stopAutomatic = startAutomaticBackup(automatic.service);
    await initializeGoogle(); throw error;
  }
}

function askResumeCloudRestore() {
  if ([...document.querySelectorAll('dialog[open]')].some(dialog => dialog !== $('#settings-dialog'))) return;
  const dialog = element('dialog'); const state = element('p', '', 'backup-message');
  const resume = element('button', '繼續覆蓋 Google', 'danger'); resume.type = 'button';
  const cancel = element('button', '稍後'); cancel.type = 'button'; cancel.onclick = () => dialog.close();
  resume.onclick = async () => {
    resume.disabled = true; cancel.disabled = true;
    try { await runCloudRestore(text => { state.textContent = text; }); }
    catch (error) { state.textContent = error.message; resume.disabled = false; cancel.disabled = false; }
  };
  dialog.append(element('h2', '完成 Google 覆蓋'),
    element('p', workspace.state.cloudRestore.phase === 'reset'
      ? `將繼續清空 ${googleAccount.email || '目前 Google 帳號'} 的 Work Fleet 雲端資料，再上傳已保存的還原資料。其他裝置請先停止同步。`
      : '將繼續上傳已保存的還原資料，不會再次清空雲端。'), state, cancel, resume);
  dialog.oncancel = event => { if (resume.disabled) event.preventDefault(); };
  dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
}
// Another device cleared this account's Drive data. This device keeps its copy until the user chooses.
function askAfterSourceReset() {
  if (sourceResetAsked || document.querySelector('dialog[open]')) return; sourceResetAsked = true;
  const dialog = element('dialog'); dialog.id = 'source-reset-dialog';
  const state = element('p', '', 'backup-message'); state.setAttribute('role', 'status');
  // Not through run(): the reset waits for the desktop owner's queue to empty, so it cannot run inside it.
  const clear = element('button', '清除這台裝置的副本', 'danger'); clear.type = 'button';
  clear.onclick = async () => {
    for (const control of dialog.querySelectorAll('button')) control.disabled = true;
    try { await resetWorkspace(text => { state.textContent = text; }, { cloud: false }); }
    catch (error) { state.textContent = error.message; for (const control of dialog.querySelectorAll('button')) control.disabled = false; }
  };
  dialog.append(element('h2', '雲端資料已重設'),
    element('p', `${googleAccount?.email || '這個 Google 帳號'} 的 Work Fleet 雲端資料已在其他裝置重設。這台裝置上的副本還在，但已停止同步。`),
    element('p', '清除副本後會從目前的雲端重新同步；這台裝置尚未同步的修改也會一起刪除，需要的話請先匯出備份。'), state);
  const actions = element('div', undefined, 'dialog-actions');
  actions.append(button('先匯出備份', () => { dialog.close(); return openSettings('data'); }), button('稍後', () => dialog.close()), clear);
  dialog.append(actions); dialog.oncancel = event => { if ([...dialog.querySelectorAll('button')].some(control => control.disabled)) event.preventDefault(); };
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
}
// Deletes the current workspace on this device and reopens it empty, stopping everything that could write it back.
async function resetWorkspace(say, { cloud = profileId.startsWith('google:') } = {}) {
  if (accountBusy || nativeClosing) throw new Error('帳號或關閉作業進行中，請稍後再試。');
  accountBusy = true; clearInterval(syncTimer); stopAutomatic?.();
  try {
    await automatic?.service.whenIdle(); await syncService?.stop(); syncService = null;
    desktop?.beginClose(); if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: true });
    await desktop?.whenIdle(); desktop?.sealClose();
    await Promise.allSettled([...activeActions, draftPending]);
    // Nothing of this workspace is kept, so its unsaved drafts must not hold the page open.
    currentDraft = null; unsavedDrafts.clear(); document.body.inert = true;
    if (cloud) {
      requireConnected();
      say('正在標記雲端重設…');
      await resetSource(new NativeGoogleFileStore(native.bridge, native.info, googleAccount.accountId),
        { progress: (done, total) => say(`正在刪除雲端資料：${done} / ${total}`) });
    }
    say('正在刪除這台裝置上的資料…');
    await storage.reset(profileId);
    // Native hosts reopen the document on the emptied profile after replying; the browser reloads itself.
    if (!native) { await browserJournal?.reset(profileId); lease.release(); location.reload(); }
  } catch (error) {
    document.body.inert = false; await desktop?.cancelClose();
    if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: false }).catch(() => {});
    if (automatic) stopAutomatic = startAutomaticBackup(automatic.service);
    accountBusy = false; if (native) await initializeGoogle();
    throw error;
  }
}

function currentDesktopEditor() {
  return remoteEditor && currentDraft?.id === remoteEditor.draftId && controller.state.editingCardId === remoteEditor.cardId ? copy(remoteEditor) : null;
}
function initializeDesktop() {
  $('#stage-hint').textContent = `每按一次換到下一階：${desktopStages().map(stage => stageNames[stage]).join(' → ')}。數字對應「桌面」頁的區域，由左到右、由上到下。`;
  const authority = new DesktopAuthority({ workspace, controller, sessionId: desktopInfo.sessionId,
    perform: action => desktop.perform(action),
    shortcut: (target, intent) => desktopAction(target, intent),
    details: async (id, intent) => { await leaveAdjustOverlay(); await native.bridge.request('desktop.showMain', { intent }); cardDetails(currentCard(id)); },
    arrange: kind => arrangeDesktop(kind),
    attachments: (method, file) => method === 'attachment.preview' ? previewAttachment(file) : openAttachment(file),
    editor: {
      current: currentDesktopEditor,
      begin: async (id, viewId) => {
        if (editorBusy || composing || document.querySelector('dialog[open]')) throw new Error('請先完成主畫面的目前編輯。');
        const previous = currentDesktopEditor();
        if (previous?.cardId === id && previous.viewId === viewId) return { draftId: previous.draftId, sequence: previous.sequence };
        const reuseId = currentDraft?.cardId === id ? currentDraft.id : null;
        if (currentDraft) {
          if (controller.state.editingCardId) { if (!await controller.endEdit({ keepDraft: Boolean(reuseId) })) throw new Error('请先完成目前輸入。'); }
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
        if (!await controller.endEdit({ keepDraft: true })) throw new Error('請先完成目前輸入。'); remoteEditor = null;
        await leaveAdjustOverlay(); await native.bridge.request('desktop.showMain', { intent }); await openEditor(card, draft); render();
      },
    } });
  authority.configureDisplays(desktopInfo.topology ?? 0, desktopInfo.views);
  desktop = new DesktopOwner({ bridge: native.bridge, authority, editor: currentDesktopEditor,
    project: sequence => {
      const frame = projectDesktop({ snapshot: workspace.snapshot, layout: workspace.layout.state, interaction: controller.state,
        sessionId: desktopInfo.sessionId, sequence, topology: desktopInfo.topology ?? 0, workspaceRevision: workspace.state.revision, layers: desktopInfo.layers, residentLayers: residentLayers(), editor: currentDesktopEditor(), notice: desktopNotice });
      // Settings only speaks up when a paper cannot sit on the layer it asks for.
      const [fallback] = frame.fallbacks; const layerName = layer => stageNames[groupLayerOrder.indexOf(layer)];
      $('#desktop-note').hidden = !fallback;
      $('#desktop-note').textContent = fallback ? `${frame.fallbacks.length} 張便箋設在${layerName(fallback.requested)}，但這台電腦目前不支援，先放在${layerName(fallback.effective)}。` : '';
      return frame;
    },
    changed: () => render(), error: error => status(error.message, true),
    displays: async proposal => {
      controller.cancelDrag();
      const result = await workspace.layout.recoverDisplays(proposal.workAreas.map(({ x, y, width, height }) => ({ x, y, width, height })),
        primaryArea(proposal.workAreas));
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
  const items = await captureInbox.list(); captureCount = items.length;
  $('#capture-count').textContent = items.length; $('#capture-inbox-button').hidden = !items.length; updateAttention();
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

// Region keys act on the group now in that region; keys for empty regions are not taken from other apps.
function liveShortcuts() { const layout = workspace.layout.state; return resolveShortcuts(layout.shortcuts, layout.grid.slots); }
// Each shortcut row shows only what keeps a key from working; working keys stay quiet. Hosts report registrations
// against the resolved group, so rows match them by key.
function renderShortcutStatus() {
  const labels = { conflict: '已被其他程式使用', unavailable: '無法使用', reserved: '系統保留', editing: '保留給文字輸入', typing: '請改用 Ctrl+Shift 組合', invalid: '不支援這個組合', unwritten: '尚未寫入 labwc 設定' };
  const layout = workspace.layout.state; const bound = regionShortcuts(layout.shortcuts, layout.grid.slots);
  for (const node of document.querySelectorAll('[data-shortcut-status]')) {
    const items = shortcutStatus.filter(item => bound[item.key] === node.dataset.shortcutStatus);
    const problems = items.filter(item => labels[item.status]);
    node.textContent = problems.map(item => `${item.key} ${labels[item.status]}`).join('；');
    node.dataset.state = items.map(item => item.status).join(' '); node.classList.toggle('error', problems.length > 0);
  }
  $('#retry-shortcuts').hidden = Boolean(labwcShortcuts) || !shortcutStatus.some(item => ['conflict', 'unavailable'].includes(item.status));
  // labwc has no way for an app to register keys, so its own keybinds run them; the user writes them on purpose.
  $('#labwc-shortcuts').hidden = !labwcShortcuts;
  if (labwcShortcuts) {
    const notes = { absent: `labwc 不提供程式註冊全域快捷鍵的方式。寫入後，目前的快捷鍵會加進 ${labwcShortcuts.path} 中由 Work Fleet 管理的區塊（原檔先備份），並重新載入 labwc 設定。`,
      outdated: `快捷鍵已變更，${labwcShortcuts.path} 中的組合需要重新寫入。`, current: `${labwcShortcuts.path} 已包含目前的快捷鍵；之後變更組合時需再寫入一次。` };
    $('#labwc-shortcuts-note').textContent = notes[labwcShortcuts.state] || notes.absent;
    $('#labwc-write').textContent = labwcShortcuts.state === 'current' ? '重新寫入 labwc 設定' : '寫入 labwc 設定';
  }
}

async function desktopAction(target, intent) {
  if (composing || editorBusy || document.querySelector('dialog[open]')) throw new Error('請先完成目前輸入或對話框。');
  if (target === '@hide') { await flushDraft(); await native.bridge.request('desktop.hideMain'); return; }
  if (target === shortcutActions.capture) {
    await leaveAdjustOverlay();
    if (desktop) await native.bridge.request('desktop.showMain', { intent: intent ?? null });
    await openEditor(); return;
  }
  if (target === shortcutActions.toggle) await workspace.layout.configure({ desktopVisible: !workspace.layout.state.desktopVisible }, workspace.snapshot);
  // A group key moves its group one stage on: wallpaper, desktop, topmost, adjust mode, wallpaper again, skipping a layer
  // this desktop does not offer.
  // Ctrl+Shift+0 keeps its own meaning: every group into adjust mode, then back to each paper's own layer. Papers hidden
  // while locked would not show the first stages and the browser preview has no layers, so there a group key only
  // switches adjust mode.
  else if (target !== shortcutActions.all && target !== '@stop' && desktop && workspace.layout.state.desktopVisible) {
    const layers = residentLayers();
    const stage = await stepGroup({ workspace, controller, groupId: target, wallpaper: layers.includes('wallpaper'), desktop: layers.includes('desktop'), floating: layers.includes('floating') });
    activeGroupId = target; const stages = desktopStages();
    announce(target, stageNames[stage], stages.indexOf(stage) + 1, stages.length);
  }
  else {
    const changed = await controller.activate(target === '@stop' ? { kind: 'none' } : target === shortcutActions.all ? { kind: 'all' } : { kind: 'group', groupId: target });
    if (changed && target !== shortcutActions.all && target !== '@stop') activeGroupId = target;
    const adjusting = controller.state.operationScope.kind !== 'none';
    if (changed && desktop && target !== '@stop') announce(target === shortcutActions.all ? null : target, adjusting ? '調整位置' : target === shortcutActions.all ? '回到原本層級' : '結束調整');
  }
  render();
  if (intent && desktop && target !== shortcutActions.toggle && controller.state.operationScope.kind !== 'none') {
    const sequence = await desktop.whenPublished(); await native.bridge.request('desktop.focus', { intent, sequence });
  }
}

// After a group or all-groups key the topmost scene shows, for about a second and a half, which group moved and where
// it is now, with one dot per stage of the cycle. A newer notice replaces an older one, which then is not cleared early.
const stageNames = ['桌布層', '桌面層', '最上層', '調整位置'];
// Layers a group can rest on; on GNOME Xwayland the topmost scene only carries the adjust overlay.
const residentLayers = () => desktopInfo?.residentLayers || desktopInfo?.layers || [];
const desktopStages = () => [0, 1, 2].filter(stage => residentLayers().includes(groupLayerOrder[stage])).concat(adjustStage);
let desktopNotice = null; let noticeSerial = 0;
function announce(groupId, text, step = 0, steps = 0) {
  const layout = workspace.layout.state; const groups = activeGroups(workspace.snapshot);
  let rect = layout.grid.area;
  try { rect = groupId && gridRegions(layout.grid, groups).find(region => region.groupId === groupId) || rect; } catch { /* Overflowing groups use the whole area. */ }
  const id = ++noticeSerial;
  desktopNotice = { id, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    title: groupId ? groups.find(group => group.id === groupId)?.name || '群組' : '所有群組', text, step, steps };
  setTimeout(() => { if (desktopNotice?.id === id) { desktopNotice = null; desktop?.publish(); } }, 1600);
}

// Android's back button arrives as a close request; like other Android apps it first dismisses whatever is on top.
function dismissTopLayer() {
  const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  // A synthetic cancel runs each dialog's own guard, such as keeping a busy dialog open or keeping the editor's draft.
  if (dialog) { if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close(); return true; }
  if ($('.topbar').classList.contains('searching')) { setSearching(false); return true; }
  if (document.body.classList.contains('drawer-open')) { setDrawer(false); return true; }
  return false;
}
async function prepareNativeClose() {
  if (nativeClosing) return;
  if (native.info.platform === 'android' && dismissTopLayer()) { await native.bridge.request('host.closeCancel').catch(() => {}); return; }
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
  nativeShortcuts?.update(liveShortcuts());
  if (remoteEditor && controller.state.editingCardId !== remoteEditor.cardId) { remoteEditor = null; currentDraft = null; }
  const snapshot = workspace.snapshot; const groups = activeGroups(snapshot); const layout = workspace.layout.state;
  if (!groups.some(group => group.id === activeGroupId)) activeGroupId = groups[0]?.id;
  $('#groups').replaceChildren();
  for (const group of groups) {
    const row = element('div', undefined, `group-row${group.id === activeGroupId ? ' active' : ''}`);
    row.dataset.groupId = group.id;
    const choose = button('', () => { activeGroupId = group.id; setDrawer(false); render(); });
    const dot = element('span', undefined, 'group-dot'); dot.style.setProperty('--group-color', groupColor(group.id));
    choose.append(dot, element('span', group.name, 'group-name'),
      element('span', String(snapshot.cards.filter(card => card.groupId === group.id && !card.deleted && !card.archived).length), 'group-count'));
    row.append(choose, button('⋯', () => groupEditor(group), 'group-menu')); $('#groups').append(row);
  }
  const query = $('#search').value.trim().toLocaleLowerCase();
  // Filters and search look through papers the desktop does not show, so they always use the board or the list.
  const notesShown = !showDesktop || filter !== 'active' || Boolean(query); const view = notesShown ? mainView(layout) : 'desktop';
  $('#workspace-title').textContent = notesShown ? groups.find(group => group.id === activeGroupId)?.name || '我的便箋' : desktopInfo ? '版面地圖' : '我的便箋桌面';
  renderCounts();
  const scope = controller.state.operationScope;
  $('#operate-all').classList.toggle('operating', scope.kind === 'all');
  $('#operate-group').classList.toggle('operating', scope.kind === 'group');
  $('#stop-operation').hidden = scope.kind === 'none';
  $('#mode-label').textContent = scope.kind === 'none' ? '鎖定中' : scope.kind === 'all' ? '正在調整所有群組'
    : `正在調整 ${groups.find(group => group.id === scope.groupId)?.name || '群組'}`;
  $('#desktop-view-label').textContent = desktopInfo ? '版面地圖' : '桌面'; $('[data-view="desktop"]').title = desktopInfo ? '版面地圖' : '桌面';
  document.querySelectorAll('[data-view]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.view === view)));
  // With real desktop scenes the main window never mirrors them; its desktop view is the layout map.
  $('#stage-shell').hidden = notesShown || Boolean(desktopInfo); $('#layout-map').hidden = notesShown || !desktopInfo; $('#list').hidden = !notesShown;
  document.querySelectorAll('[data-filter]').forEach(node => node.classList.toggle('active', node.dataset.filter === filter));
  const cards = snapshot.cards.filter(matchesFilter).filter(card => !query || card.content.text.toLocaleLowerCase().includes(query));
  const listCards = cards.filter(card => query || card.groupId === activeGroupId);
  const shown = snapshot.cards.filter(card => cardPolicy(card, layout, controller.state).visible).length;
  const hidden = shown ? 0 : snapshot.cards.filter(card => eligible(card, layout)).length;
  $('#count').textContent = notesShown ? `${listCards.length} 張便箋` : `${shown} 張桌面便箋`;
  if (notesShown) renderNotes(listCards, view, Boolean(query));
  else if (desktopInfo) renderLayoutMap();
  else renderStage(snapshot.cards);
  $('#empty').hidden = snapshot.cards.some(card => eligible(card, layout));
  $('#desktop-hidden').hidden = handheld || !hidden || filter !== 'active' || Boolean(query);
  $('#desktop-hidden-text').textContent = `${hidden} 張便箋目前不顯示在桌面上；顯示後會回到原本的位置。`;
  desktop?.publish(); syncAdjustOverlay();
}

// Where adjust mode is a modal overlay (every desktop host), a focused main window steps aside while it is on
// and returns after any exit; one that was minimized or behind another app stays as it was. The focus is read before
// the overlay maps and takes it. Hiding waits for the overlay frame and showing for the frame without it, so one window
// always stays on screen and the returning main window is not stacked under a still-mapped overlay.
let adjustMain = { adjusting: false, aside: false }; let adjustSync = Promise.resolve();
function syncAdjustOverlay() {
  if (!desktop || !desktopInfo?.adjustOverlay) return;
  const step = overlayMainStep(adjustMain, controller.state.operationScope.kind !== 'none', document.hasFocus());
  adjustMain = step.state;
  if (step.visible === null) return;
  adjustSync = adjustSync.then(async () => {
    await desktop.whenPublished(); await native.bridge.request('desktop.mainVisible', { visible: step.visible });
  }).catch(error => status(error.message, true));
}
// The overlay covers the main window, so anything that needs the main window ends adjust mode first.
async function leaveAdjustOverlay() {
  if (!desktopInfo?.adjustOverlay || controller.state.operationScope.kind === 'none') return;
  await controller.activate({ kind: 'none' }); render(); await adjustSync;
}
// The overlay's 堆疊／攤開 apply to the adjusted scope at once, keeping sizes; 復原 undoes like the main window.
async function arrangeDesktop(kind) {
  if (kind === 'undo') { await workspace.undo(workAreas()); await controller.reconcile(); render(); status('已復原'); return null; }
  const scope = controller.state.operationScope;
  const plan = formationPlan(kind, scope.kind === 'all' ? { kind: 'all' } : { kind: 'group', groupId: scope.groupId }, false);
  await controller.applyFormation(plan); render(); status('排列已完成，可按復原還原'); return null;
}

// Drafts and the share inbox appear only when they hold something; version history stays reachable.
function renderCounts() {
  const draftCount = Object.keys(workspace.state.drafts).length; const conflictCount = workspace.state.conflicts.length;
  $('#draft-count').textContent = String(draftCount); $('#drafts-button').hidden = !draftCount;
  $('#conflict-count').textContent = String(conflictCount); $('#conflict-count').hidden = !conflictCount; updateAttention();
}

function renderStage(cards) {
  for (const close of stageAttachmentCleanup.splice(0)) close();
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
    paper.classList.toggle('operable', policy.draggable); paper.classList.toggle('selectable', !policy.draggable && policy.interactive);
    paper.classList.toggle('selected', state.selectedCardId === card.id); paper.classList.toggle('mine', layout.myGroupId === card.groupId);
    paper.classList.toggle('completed', card.completed);
    paper.style.setProperty('--paper', groupColor(card.groupId)); paper.style.zIndex = String(z++); rectStyle(paper, placement);
    paper.append(element('div', summaryText(card), 'card-summary'));
    const body = element('div', undefined, 'card-body markdown');
    if (policy.editing && currentDraft?.cardId === card.id && !remoteEditor && !$('#editor-dialog').open) {
      const input = element('textarea', undefined, 'inline-editor'); input.value = currentDraft.content.text;
      input.setAttribute('aria-label', '就地編輯便箋');
      input.oninput = () => { if (!editorBusy && currentDraft) { currentDraft.content.text = input.value; queueDraft(); } };
      input.addEventListener('compositionstart', () => { composing = true; controller.setComposing(true); });
      input.addEventListener('compositionend', () => { composing = false; controller.setComposing(false); });
      input.onkeydown = event => {
        if (event.isComposing || composing) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); run(async () => {
          const draft = currentDraft; await controller.endEdit(); currentDraft = null; render(); status(closedStatus(draft));
        }); }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); run(() => saveEditor()); }
      };
      body.append(input);
    } else { renderMarkdown(body, card.content.text, { title: summaryText(card) }); appendAttachmentTiles(body, card.content.attachments || [], stageAttachmentCleanup); }
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

// Stub: a scaled map of every display, its group regions and paper positions comes later; papers move on the real desktop.
function renderLayoutMap() {}

function rectStyle(node, rect) { Object.assign(node.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }); }

const svgNs = 'http://www.w3.org/2000/svg';
function icon(...paths) {
  const svg = document.createElementNS(svgNs, 'svg'); svg.setAttribute('class', 'icon'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) { const path = document.createElementNS(svgNs, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}
function iconButton(label, paths, action) { const node = button('', action, 'note-action'); node.setAttribute('aria-label', label); node.title = label; node.append(icon(...paths)); return node; }

// The board shows each paper as the square it is on the desktop; the list keeps one row per paper. Both open the editor.
function renderNotes(cards, view, acrossGroups) {
  for (const close of noteAttachmentCleanup.splice(0)) close();
  const list = $('#list'); list.replaceChildren(); list.setAttribute('aria-label', view === 'list' ? '便箋清單' : '便箋牆');
  if (!cards.length) { list.append(element('p', '這裡還沒有便箋。', 'hint')); return; }
  const groups = activeGroups(workspace.snapshot); const { myGroupId } = workspace.layout.state;
  const holder = element('div', undefined, view === 'list' ? 'note-list' : 'board');
  for (const card of cards) {
    const title = summaryText(card);
    const note = element('article', undefined, view === 'list' ? 'note-row' : 'note-paper'); note.dataset.cardId = card.id;
    note.style.setProperty('--paper', groupColor(card.groupId));
    note.classList.toggle('completed', card.completed); note.classList.toggle('mine', myGroupId === card.groupId);
    const body = element('div', undefined, 'note-body markdown'); renderMarkdown(body, card.content.text, { title, highlight: view !== 'list' });
    if (view !== 'list') appendAttachmentTiles(body, card.content.attachments || [], noteAttachmentCleanup);
    const meta = element('div', undefined, 'note-meta');
    const { done, total } = checklistProgress(card.content.text); const files = card.content.attachments?.length || 0;
    if (total) meta.append(element('span', `${done}/${total} 步驟`));
    if (files) meta.append(element('span', `${files} 個附件`));
    if (acrossGroups) meta.append(element('span', groups.find(group => group.id === card.groupId)?.name || '群組待同步'));
    const actions = element('div', undefined, 'note-actions');
    if (card.deleted) actions.append(button('還原便箋', async () => { await workspace.restoreCard(card.id, card.revision); render(); status('已還原'); }));
    else {
      actions.append(iconButton(card.completed ? '回待處理' : '標為完成', card.completed ? ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'] : ['m5 12.5 4.5 4.5L19 7'],
        () => changeCard(card.id, { completed: !card.completed })),
      iconButton('更多操作', ['M5.5 12h.01M12 12h.01M18.5 12h.01'], () => cardDetails(card)));
      note.tabIndex = 0; note.setAttribute('aria-label', title);
      note.onclick = event => { if (!event.target.closest('a,button,input')) run(() => openEditor(card)); };
      note.onkeydown = event => { if (event.target === note && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); run(() => openEditor(card)); } };
    }
    const heading = element('h3', title, 'note-title');
    if (view === 'list') {
      const text = element('div', undefined, 'note-text');
      text.append(heading, element('div', body.textContent.replace(/\s+/g, ' ').trim(), 'note-excerpt'));
      note.append(element('span', undefined, 'note-swatch'), text, meta, actions);
    } else {
      const foot = element('div', undefined, 'note-foot'); foot.append(meta, actions);
      note.append(heading, body, foot);
    }
    holder.append(note);
  }
  list.append(holder);
}

async function changeCard(id, patch) {
  const card = currentCard(id); await workspace.updateCard(id, patch, card.revision);
  await controller.reconcile(); render(); status('已存本機');
}

function groupEditor(group) {
  const dialog = element('dialog'); const form = element('form');
  const title = element('h2', group ? '群組設定' : '新增群組');
  const label = element('label', '名稱', 'field'); const input = element('input'); input.required = true; input.maxLength = 80; input.value = group?.name || ''; label.append(input);
  // Which desktop layer the group sits on belongs to this computer; phones and the browser preview have no desktop layers.
  const layerField = desktop ? element('label', '桌面上的層級', 'field') : null; const layers = element('select');
  const currentLayer = group ? groupLayer(workspace.layout.state, group.id) : 'desktop';
  if (layerField) {
    // A layer this desktop cannot rest papers on says so and names where they show instead, as the desktop note does.
    const fallback = stageNames[groupLayerOrder.indexOf(residentLayers().includes('desktop') ? 'desktop' : 'wallpaper')];
    for (const [value, name] of [['wallpaper', '桌布層：在圖示下方，滑鼠穿透'], ['desktop', '桌面層：在圖示上方，可選取文字'], ['floating', '最上層：在所有視窗上方']]) {
      const supported = residentLayers().includes(value);
      const option = new Option(supported ? name : `${name.split('：')[0]}：這台電腦目前不支援，會顯示在${fallback}`, value);
      option.disabled = !supported && currentLayer !== value; layers.append(option);
    }
    layers.value = currentLayer; layerField.append(layers);
  }
  const actions = element('div', undefined, 'dialog-actions');
  const save = element('button', '保存', 'primary'); save.type = 'submit';
  if (group) {
    const merge = button('合併／移除群組', () => { dialog.close(); return openGroupMerge(group); });
    merge.disabled = activeGroups(workspace.snapshot).length < 2; actions.append(merge);
  }
  actions.append(button('取消', () => dialog.close()), save);
  form.append(title, label, ...layerField ? [layerField, element('p', '也可以按這組的快捷鍵依序切換。', 'hint')] : [], actions); dialog.append(form); document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', event => { event.preventDefault(); run(async () => {
    let groupId = group?.id;
    if (group) await workspace.renameGroup(group.id, input.value, group.revision);
    else { const created = await workspace.createGroup(input.value); activeGroupId = groupId = created.id; }
    if (layerField && layers.value !== currentLayer) await workspace.layout.setGroupLayer(groupId, layers.value, workspace.snapshot);
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
  // Which layer a paper sits on belongs to its group and changes only with the group's shortcut on the desktop.
  // Phones show no desktop papers, so the display option they cannot show stays unchanged.
  dialog.append(groupLabel, ...handheld ? [] : [visibility]);
  const actions = element('div', undefined, 'dialog-actions');
  actions.append(button(card.archived ? '取消封存' : '封存', async () => { await changeCard(card.id, { archived: !card.archived }); dialog.close(); }),
    button('移至刪除區', async () => { await changeCard(card.id, { deleted: true }); dialog.close(); }),
    button('取消', () => dialog.close()), button('套用', async () => {
      if (select.value !== card.groupId) await controller.moveToGroup(card.id, select.value);
      if (!handheld) await workspace.layout.setCardPolicy(card.id, { visible: check.checked });
      await controller.reconcile(); dialog.close(); render(); status('已存本機');
    }, 'primary'));
  dialog.append(actions); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
}

async function openEditor(card = null, recovered = null) {
  if (composing) return;
  if (!card && !recovered && !activeGroups(workspace.snapshot).length) {
    const group = await workspace.createGroup('我的便箋'); activeGroupId = group.id; render();
  }
  if (controller.state.editingCardId && currentDraft) await controller.endEdit({ keepDraft: recovered?.id === currentDraft.id });
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
    if (!await controller.endEdit({ keepDraft: same })) return; remoteEditor = null;
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
  // Selecting another paper ends an edit and may keep its draft, so the drafts link can appear here.
  renderCounts();
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
// Ending an edit drops a draft with nothing to keep: blank content or an unchanged copy of its card.
const closedStatus = draft => draft && !workspace.state.drafts[draft.id] ? '已關閉，沒有需要保留的草稿' : '草稿已保留';
async function closeEditor() {
  if (editorBusy || composing) return;
  setEditorBusy(true);
  try {
    // Clear the editor before discarding so a background flush cannot write the blank draft back.
    await flushDraft(); const draft = currentDraft;
    currentDraft = null; remoteEditor = null; $('#editor-dialog').close(); controller.setComposing(false);
    try { if (draft) await workspace.discardUnneededDraft(draft.id); }
    finally { await controller.endEdit(); render(); }
    status(closedStatus(draft));
  }
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
async function previewAttachment(file) {
  if (attachmentFiles) return attachmentFiles.preview(file);
  return { available: Boolean(await storage.getAttachment(profileId, file.id)), png: null };
}
async function openAttachment(file) {
  if (attachmentFiles) return attachmentFiles.open(file);
  const blob = await storage.getAttachment(profileId, file.id);
  if (!blob) throw new Error('附件尚未下載，請先完成同步。');
  if (nativeFiles) return nativeFiles.export(new Uint8Array(await blob.arrayBuffer()), file.name);
  const url = URL.createObjectURL(blob); const link = element('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function appendAttachmentTiles(body, files, cleanups) {
  if (!files.length) return;
  const tiles = element('div'); body.append(tiles);
  cleanups.push(renderAttachmentTiles(tiles, files, { preview: previewAttachment, open: openAttachment, report: error => status(error.message, true) }));
}
async function renderAttachments() {
  for (const close of editorAttachmentCleanup.splice(0)) close();
  for (const url of attachmentUrls.values()) URL.revokeObjectURL(url); attachmentUrls.clear();
  const list = $('#attachments'); list.replaceChildren();
  if (!currentDraft) return;
  for (const attachment of currentDraft.content.attachments || []) {
    const row = element('li'); appendAttachmentTiles(row, [attachment], editorAttachmentCleanup); const blob = await storage.getAttachment(profileId, attachment.id);
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
function formationPlan(mode, scope, allowResize) {
  const snapshot = workspace.snapshot;
  const measure = element('div', '量測摘要', 'card-summary'); measure.style.position = 'absolute'; measure.style.visibility = 'hidden'; document.body.append(measure);
  const measuredBand = measure.getBoundingClientRect().height; measure.remove();
  const summaryBands = Object.fromEntries(snapshot.cards.map(card => [card.id, measuredBand]));
  for (const paper of $('#stage').querySelectorAll('.card')) summaryBands[paper.dataset.cardId] = paper.querySelector('.card-summary').getBoundingClientRect().height;
  return planFormation({ snapshot, layout: workspace.layout.state, scope, mode, workAreas: workAreas(), summaryBands, allowResize });
}
function updateFormation() {
  try {
    formationPreview = formationPlan(formationMode, $('#formation-scope').value === 'all' ? { kind: 'all' } : { kind: 'group', groupId: activeGroupId },
      $('#allow-resize').checked);
    $('#formation-description').textContent = `排列 ${Object.keys(formationPreview.changes).length} 張便箋。${formationPreview.resized.length ? ` ${formationPreview.resized.length} 張會調整大小。` : ' 保持原尺寸。'}${formationPreview.overflow.length ? ` ${formationPreview.overflow.length} 張會超出群組區域。` : ''} 可透過復原還原這次排列。`;
    $('#apply-formation').disabled = false;
  } catch (error) { formationPreview = null; $('#formation-description').textContent = error.message; $('#apply-formation').disabled = true; }
}

// Settings is one window with a page per area. Wide screens show the page list beside the page; phones show the
// list first and slide into a page. Changes apply as soon as they are valid, so there is nothing to save.
const settingsTitles = { account: '帳號與同步', data: '資料與備份', desktop: '桌面', shortcuts: '快捷鍵' };
function openSettings(page = null) {
  const dialog = $('#settings-dialog');
  if (!dialog.open) { renderDesktopSettings(); renderShortcutSettings(); renderAccount(); dialog.showModal(); }
  return showSettingsPage(page);
}
async function showSettingsPage(page) {
  if (page === null && !narrow.matches) page = settingsPage || 'account';
  // A running backup or restore keeps its page; leaving would drop its progress.
  if (dataPanel?.busy() && page !== 'data') return;
  if (page !== 'data') { dataPanel?.dispose(); dataPanel = null; }
  settingsPage = page; const dialog = $('#settings-dialog');
  dialog.classList.toggle('listing', page === null);
  for (const panel of dialog.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== page;
  for (const item of dialog.querySelectorAll('[data-page]')) {
    if (item.dataset.page === page) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  }
  $('#settings-page-title').textContent = settingsTitles[page] || '設定';
  $('.settings-body').scrollTop = 0;
  // Region rows name the group in each region, which the 桌面 page may just have changed.
  if (page === 'shortcuts') renderShortcutSettings();
  if (page === 'data' && !dataPanel) await mountDataPanel();
}
async function mountDataPanel() {
  const host = $('#data-host');
  // Restore rewrites the workspace, so any edit in progress is saved and closed first.
  if (editorBusy || composing) { host.replaceChildren(element('p', '請先完成目前的輸入。', 'hint')); return; }
  if (currentDraft) await flushDraft();
  if (!await controller.endEdit()) { host.replaceChildren(element('p', '請先完成目前的輸入。', 'hint')); return; }
  currentDraft = null; controller.cancelDrag(); render();
  dataPanel = backupPanel({ workspace, storage, getWorkAreas: workAreas, flush: flushDraft, automatic, automaticError,
    files: nativeBackups?.manual, reset: resetPlan(), cloudRestore: cloudRestoreOptions(), backupSource: backupSourceOptions(), localRestore: applyLocalRestore,
    appVersion: native?.info.appVersion, uninstallNotice: native?.info.platform === 'windows' ? '使用 MSIX 時，解除安裝會清除這台裝置的便箋、草稿、設定與登入。請先匯出備份；已匯出的 ZIP 與 Google 雲端資料會保留。' : null,
    onChanged: async () => {
      if (!activeGroups(workspace.snapshot).some(group => group.id === activeGroupId)) activeGroupId = activeGroups(workspace.snapshot)[0]?.id;
      await controller.reconcile(); render();
    } });
  host.replaceChildren(dataPanel.element);
}
// Only GNOME Wayland can switch: desktop papers there need XWayland, which also carries the main window after a restart.
let displayBackend = null;
function renderDisplaySetting() {
  $('#display-row').hidden = !displayBackend;
  if (!displayBackend) return;
  const fixed = displayBackend.fixed === true;
  const chosen = fixed ? displayBackend.current : displayBackend.preference ?? displayBackend.current; const pending = chosen !== displayBackend.current;
  $('#display-xwayland').checked = chosen === 'x11'; $('#display-xwayland').disabled = fixed; $('#display-restart').hidden = !pending;
  $('#display-detail').textContent = fixed ? '目前由環境變數 GDK_BACKEND 決定顯示方式，這個設定不會生效。'
    : pending ? '重新啟動後生效；未保存的文字會先保存。'
    : 'GNOME Wayland 的桌面便箋需要 XWayland；主畫面的輸入法與縮放也會一起改走 XWayland。';
}
// ADR-043: startup behaviour and the main window belong to this computer's host, not to the workspace or its backups.
// The switches show what the system actually does; a sign-in item the user turned off there stays off.
let hostPreferences = null;
const distributionNames = { msix: '安裝版（MSIX）', zip: '免安裝版（ZIP）', debug: '開發版', deb: '安裝版（DEB）', bundle: '免安裝版', source: '原始碼執行', app: 'macOS App' };
const trayName = () => native?.info.platform === 'macos' ? '選單列' : '系統匣';
function renderHostSettings() {
  const available = native?.info.capabilities.hostPreferences === true; $('#host-settings').hidden = !available;
  if (!available) return;
  $('#app-version').textContent = `Work Fleet ${native.info.appVersion}（預覽）`;
  $('#app-distribution').textContent = distributionNames[native.info.distribution] || '';
  $('#close-tray-label').textContent = `關閉主畫面時保留在${trayName()}`;
  renderHostPreferences(); renderUpdate();
  if (native.info.capabilities.updates) void native.bridge.request('update.state').then(value => { updateState = value; renderUpdate(); }, error => status(error.message, true));
  void native.bridge.request('host.preferences.get').then(value => { hostPreferences = value; renderHostPreferences(); }, error => status(error.message, true));
}
function renderHostPreferences() {
  const value = hostPreferences;
  for (const id of ['#start-login', '#close-tray', '#open-main']) $(id).disabled = value === null;
  if (value === null) return;
  const start = value.startAtLogin; const fixed = ['disabled-by-user', 'disabled-by-policy', 'enabled-by-policy'].includes(start.state);
  const system = native.info.platform === 'windows' ? ' Windows 的「啟動應用程式」' : native.info.platform === 'macos' ? '系統設定的「登入項目」' : '系統設定';
  $('#start-login').checked = start.enabled || start.state === 'requires-approval'; $('#start-login').disabled = !start.available || fixed;
  $('#start-login-detail').textContent = !start.available ? start.reason || '這台電腦目前不支援登入時啟動。'
    : start.state === 'disabled-by-user' ? `已在${system}關閉，請到那裡重新開啟。`
    : start.state === 'disabled-by-policy' ? '已由系統管理原則關閉。'
    : start.state === 'enabled-by-policy' ? '已由系統管理原則開啟。'
    : start.state === 'requires-approval' ? `需要在${system}允許後才會生效。`
    : '登入後桌面便箋就會出現。';
  $('#start-login-system').hidden = !(start.systemSettings && ['disabled-by-user', 'requires-approval'].includes(start.state));
  $('#close-tray').checked = value.closeToTray.enabled; $('#close-tray').disabled = !value.closeToTray.available;
  $('#close-tray-detail').textContent = value.closeToTray.available ? '關閉時，關閉主畫面會保存並結束 Work Fleet。' : `目前沒有${trayName()}，關閉主畫面一律保存並結束。`;
  $('#open-main').checked = value.openMainAtLogin.enabled; $('#open-main').disabled = !value.openMainAtLogin.available;
}
// ADR-044: the host owns the update state; the page shows it and offers the one next step.
let updateState = null;
const updateActions = { check: ['檢查更新', 'update.check'], download: ['下載更新', 'update.download'], install: ['重新啟動並安裝', 'update.install'] };
function renderUpdate() {
  const when = value => value ? new Date(value).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const state = updateState; const button = $('#update-action');
  if (!native?.info.capabilities.updates || !state) {
    $('#update-status').textContent = 'App 內更新';
    $('#update-detail').textContent = native?.info.platform === 'windows' ? '只有安裝版（MSIX）支援 App 內更新。' : '這個平台的 App 內更新尚未提供。';
    button.hidden = true; return;
  }
  const checked = state.lastCheckedAt ? `上次檢查：${when(state.lastCheckedAt)}` : '尚未檢查';
  const percent = state.progress?.total ? Math.floor(state.progress.received * 100 / state.progress.total) : 0;
  const [label, detail] = {
    unavailable: ['無法使用 App 內更新', state.reason || ''],
    idle: ['檢查更新', checked],
    checking: ['正在檢查更新…', ''],
    up_to_date: ['已是最新版本', checked],
    update_available: [`有新版本 ${state.version}`, state.summary || ''],
    downloading: [`正在下載 ${state.version}…`, `${percent}%`],
    downloaded: [`${state.version} 已下載`, '重新啟動後安裝；未保存的文字會先保存。'],
    installing: ['正在保存並安裝…', 'Work Fleet 會關閉，安裝完成後重新開啟。'],
    failed: ['更新沒有完成', ''],
  }[state.status] || ['App 內更新', ''];
  $('#update-status').textContent = label;
  $('#update-detail').textContent = state.error?.message || detail;
  $('#update-detail').classList.toggle('error', Boolean(state.error));
  const action = updateActions[state.nextAction];
  button.hidden = !action; if (action) button.textContent = action[0];
}
function runUpdateAction() {
  const action = updateActions[updateState?.nextAction]; if (!action) return;
  return run(async () => {
    // Installing closes Work Fleet through the usual close, which waits for open dialogs, so settings closes first.
    if (action[1] === 'update.install') {
      if (dataPanel?.busy()) throw new Error('備份或還原進行中，完成後再安裝更新。');
      $('#settings-dialog').close();
    }
    updateState = await native.bridge.request(action[1]); renderUpdate();
  });
}
function setHostPreference(name, input) {
  return run(async () => {
    try { hostPreferences = await native.bridge.request('host.preferences.set', { name, value: input.checked }); }
    finally { renderHostPreferences(); }
  });
}
function renderDesktopSettings() {
  renderDisplaySetting(); renderHostSettings();
  const layout = workspace.layout.state; $('#desktop-visible').checked = layout.desktopVisible;
  settingsSlots = [...layout.grid.slots];
  fillGroups($('#my-group'), layout.myGroupId, true); $('#grid-rows').value = String(layout.grid.rows); $('#grid-columns').value = String(layout.grid.columns);
  previewGrid();
}
function applyLayout(patch) {
  return run(async () => { await workspace.layout.configure(patch, workspace.snapshot); render(); });
}
// Quick capture and the desktop toggle come first, then 0 for every group and 1–9 for the desktop regions. Region
// rows show the group now in that region, by its current name and paper colour.
function renderShortcutSettings() {
  const layout = workspace.layout.state; const bound = regionShortcuts(layout.shortcuts, layout.grid.slots);
  const groups = activeGroups(workspace.snapshot);
  const row = (target, name, { tile = null, label = name, empty = false, note = '' } = {}) => {
    const item = element('label', undefined, 'settings-row'); const text = element('span', undefined, 'row-text');
    const state = element('span', '', 'row-value'); state.dataset.shortcutStatus = target;
    text.append(element('span', name, empty ? 'row-label empty' : 'row-label'), element('span', note, 'row-value'), state);
    const input = element('input'); input.dataset.shortcutTarget = target; input.placeholder = '未設定'; input.setAttribute('aria-label', `${label}的快捷鍵`);
    input.value = Object.entries(bound).filter(([, value]) => value === target).map(([key]) => key).join(', ');
    input.oninput = checkShortcuts; input.onchange = applyShortcuts;
    if (tile) item.append(tile); item.append(text, input); return item;
  };
  $('#shortcut-actions').replaceChildren(row(shortcutActions.capture, '快速記錄'), row(shortcutActions.toggle, '顯示或隱藏桌面便箋'));
  const regions = [row(shortcutActions.all, '所有群組', { tile: $('#all-tile').content.firstElementChild.cloneNode(true),
    note: '全部進入調整位置，再按一次回到各自的層級' })];
  for (let number = 1; number <= 9; number++) {
    const group = groups.find(item => item.id === layout.grid.slots[number - 1]);
    const tile = element('span', String(number), group ? 'region-tile' : 'region-tile empty'); tile.setAttribute('aria-hidden', 'true');
    if (group) tile.style.setProperty('--paper', groupColor(group.id));
    regions.push(row(regionTarget(number), group?.name || '空白', { tile, label: `區域 ${number}（${group?.name || '空白'}）`, empty: !group }));
  }
  $('#shortcut-regions').replaceChildren(...regions);
  renderShortcutStatus(); checkShortcuts();
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
  if (nativeShortcuts && Object.keys(result).length > 32) throw new Error('最多可以設定 32 組快捷鍵。');
  return validateShortcuts(result, activeGroups(workspace.snapshot));
}
function checkShortcuts() {
  try { readShortcuts(); $('#shortcut-message').hidden = true; return true; }
  catch (error) { $('#shortcut-message').textContent = error.message; $('#shortcut-message').hidden = false; return false; }
}
function applyShortcuts() {
  if (checkShortcuts()) applyLayout({ shortcuts: readShortcuts() });
}
// The grid preview is a small map of the screen; each cell is tinted with its group's paper colour.
function previewGrid(reshape = false, apply = false) {
  const rows = Number($('#grid-rows').value); const columns = Number($('#grid-columns').value); const groups = activeGroups(workspace.snapshot);
  if (reshape || settingsSlots.length !== rows * columns) {
    const ordered = settingsSlots.filter(id => id && groups.some(group => group.id === id));
    for (const group of groups) if (!ordered.includes(group.id)) ordered.push(group.id);
    settingsSlots = Array.from({ length: rows * columns }, (_, index) => ordered[index] || null);
  }
  const preview = $('#grid-preview'); preview.replaceChildren(); preview.style.gridTemplateColumns = `repeat(${columns},1fr)`;
  for (let i = 0; i < rows * columns; i++) {
    const cell = element('label'); const select = element('select');
    select.setAttribute('aria-label', `區域 ${i + 1} 的群組`); select.append(new Option('空白', ''));
    for (const group of groups) select.append(new Option(group.name, group.id));
    select.value = settingsSlots[i] || '';
    cell.classList.toggle('empty', !settingsSlots[i]); if (settingsSlots[i]) cell.style.setProperty('--paper', groupColor(settingsSlots[i]));
    select.onchange = () => {
      const next = select.value || null; const other = settingsSlots.findIndex((id, index) => id === next && index !== i);
      if (other >= 0) settingsSlots[other] = settingsSlots[i];
      settingsSlots[i] = next; previewGrid(false, true);
    };
    cell.append(select); preview.append(cell);
  }
  try {
    gridRegions({ rows, columns, slots: settingsSlots, area: screenArea() }, groups); $('#grid-message').hidden = true;
    if (apply) applyLayout({ grid: { rows, columns, area: screenArea(), slots: [...settingsSlots] } });
  } catch (error) { $('#grid-message').textContent = error.message; $('#grid-message').hidden = false; }
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

// On phones and narrow windows the sidebar is a drawer over the page. It opens only from its button: the left screen
// edge belongs to the system back gesture on Android and to back navigation on iOS.
function setDrawer(open) {
  open &&= narrow.matches;
  const leaving = !open && document.body.classList.contains('drawer-open') && $('#sidebar').contains(document.activeElement);
  document.body.classList.toggle('drawer-open', open); $('#scrim').hidden = !open;
  $('main').inert = open; $('#sidebar').inert = narrow.matches && !open;
  $('#drawer-toggle').setAttribute('aria-expanded', String(open));
  if (open) ($('#groups .group-row.active button') || $('#sidebar button:not([hidden])'))?.focus();
  else if (leaving) $('#drawer-toggle').focus();
}
// Phones fold the search field into an app bar button.
function setSearching(on) {
  $('.topbar').classList.toggle('searching', on);
  $('#search-toggle').setAttribute('aria-label', on ? '結束搜尋' : '搜尋');
  if (on) $('#search').focus();
  else if ($('#search').value) { $('#search').value = ''; render(); }
}
function bindEvents() {
  setDrawer(false);
  narrow.addEventListener('change', () => { setDrawer(false); if ($('#settings-dialog').open) void showSettingsPage(settingsPage); });
  $('#drawer-toggle').onclick = () => setDrawer(true); $('#scrim').onclick = () => setDrawer(false);
  $('#sidebar').addEventListener('click', event => { if (event.target.closest('.sidebar-links button')) setDrawer(false); });
  $('#search-toggle').onclick = () => setSearching(!$('.topbar').classList.contains('searching'));
  $('#search').addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('.topbar').classList.contains('searching')) { event.preventDefault(); setSearching(false); }
  });
  $('#compose').onclick = () => run(() => openEditor());
  const settings = $('#settings-dialog');
  // The account chip opens its own page; the gear opens settings where it was left (the page list on phones).
  $('#account-button').onclick = () => { setDrawer(false); run(() => openSettings('account')); };
  $('#settings-button').onclick = () => { setDrawer(false); run(() => openSettings(null)); };
  for (const item of settings.querySelectorAll('[data-page]')) item.onclick = () => run(() => showSettingsPage(item.dataset.page));
  $('#settings-back').onclick = () => run(() => showSettingsPage(null));
  for (const id of ['#close-settings', '#close-settings-list']) $(id).onclick = () => { if (!dataPanel?.busy()) settings.close(); };
  settings.addEventListener('cancel', event => {
    if (dataPanel?.busy()) { event.preventDefault(); dataPanel.abort(); return; }
    // On phones, Back and Escape leave a page for the page list before closing.
    if (narrow.matches && settingsPage !== null) { event.preventDefault(); void showSettingsPage(null); }
  });
  settings.addEventListener('close', () => { dataPanel?.dispose(); dataPanel = null; if (narrow.matches) settingsPage = null; });
  $('#desktop-visible').onchange = () => applyLayout({ desktopVisible: $('#desktop-visible').checked });
  $('#display-xwayland').onchange = () => run(async () => {
    displayBackend = await native.bridge.request('host.displayBackend', { xwayland: $('#display-xwayland').checked }); renderDisplaySetting();
  });
  // The close behind a restart refuses while any dialog is open, so settings closes first, as its own close button would.
  $('#display-restart').onclick = () => run(async () => {
    if (dataPanel?.busy()) throw new Error('備份或還原進行中，完成後再重新啟動。');
    $('#settings-dialog').close(); await native.bridge.request('host.restart');
  });
  $('#start-login').onchange = () => setHostPreference('startAtLogin', $('#start-login'));
  $('#close-tray').onchange = () => setHostPreference('closeToTray', $('#close-tray'));
  $('#open-main').onchange = () => setHostPreference('openMainAtLogin', $('#open-main'));
  $('#start-login-system').onclick = () => run(() => native.bridge.request('host.preferences.openSystem'));
  $('#update-action').onclick = () => runUpdateAction();
  $('#reset-window').onclick = () => run(async () => { await native.bridge.request('host.window.resetPlacement'); status('主視窗已回到預設大小與位置'); });
  $('#my-group').onchange = () => applyLayout({ myGroupId: $('#my-group').value || null });
  $('#grid-rows').onchange = () => previewGrid(true, true); $('#grid-columns').onchange = () => previewGrid(true, true);
  $('#retry-shortcuts').onclick = () => { void nativeShortcuts?.update(liveShortcuts(), true); };
  $('#labwc-write').onclick = () => run(async () => { await nativeShortcuts?.writeLabwc(); status('已寫入 labwc 快捷鍵設定'); });
  for (const id of ['new-card', 'empty-add']) $(`#${id}`).onclick = () => run(() => openEditor());
  $('#show-desktop').onclick = () => run(async () => {
    await workspace.layout.configure({ desktopVisible: true }, workspace.snapshot); render(); status('已顯示桌面便箋');
  });
  $('#add-group').onclick = () => groupEditor();
  $('#search').oninput = render;
  // Board and list are this device's saved choice; the desktop canvas or layout map is only for this session and shows 待處理.
  document.querySelectorAll('[data-view]').forEach(node => { node.onclick = () => run(async () => {
    const view = node.dataset.view; showDesktop = view === 'desktop';
    if (showDesktop) { filter = 'active'; if ($('#search').value) setSearching(false); }
    else if (view !== mainView(workspace.layout.state)) await workspace.layout.configure({ mainView: view }, workspace.snapshot);
    render();
  }); });
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
  $('#reset-layout').onclick = () => $('#reset-layout-dialog').showModal();
  $('#cancel-reset-layout').onclick = () => $('#reset-layout-dialog').close();
  $('#confirm-reset-layout').onclick = () => run(async () => {
    if (editorBusy || composing) return;
    if (currentDraft) await flushDraft();
    if (!await controller.endEdit()) return;
    currentDraft = null; controller.cancelDrag(); await controller.activate({ kind: 'none' });
    await workspace.layout.reset(workspace.snapshot, screenArea());
    await workspace.layout.placeNew(workspace.snapshot, workAreas()); await controller.reconcile();
    $('#reset-layout-dialog').close(); renderDesktopSettings(); render(); status('桌面佈局已重置');
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
  // A double click lands while the first click is still saving the previous draft, so stage gestures run in order.
  let stageQueue = Promise.resolve();
  const stageRun = action => (stageQueue = stageQueue.then(() => run(action)));
  stage.onpointerdown = event => {
    const paper = event.target.closest('.card.operable');
    if (!paper || event.button !== 0 || event.target.closest('button,a,input,select,textarea')) return;
    let started;
    try { started = controller.pointerDown(paper.dataset.cardId, point(event), { pointerId: event.pointerId,
      handle: Boolean(event.target.closest('.card-summary')) }); }
    catch (error) { if (error.code === 'busy') return; throw error; }
    if (started) { paper.setPointerCapture(event.pointerId); event.preventDefault(); }
  };
  stage.onpointermove = event => dragPaint(controller.pointerMove(point(event), { pointerId: event.pointerId, shiftKey: event.shiftKey, labels: groupLabels }));
  stage.onpointerup = event => stageRun(async () => {
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
  stage.ondblclick = event => stageRun(async () => {
    const paper = event.target.closest('.card.operable');
    if (!paper || event.target.closest('button,a,input,textarea,select')) return;
    await beginInlineEdit(currentCard(paper.dataset.cardId), true);
  });
  document.addEventListener('keydown', event => {
    if (event.isComposing || composing || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape' && document.body.classList.contains('drawer-open')) { event.preventDefault(); setDrawer(false); return; }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === ',' && !handheld) {
      event.preventDefault(); run(() => openSettings(null)); return;
    }
    const editControl = event.target.closest('input,textarea,select');
    // Shortcuts switch adjust scopes and desktop visibility, which phones and tablets do not have.
    const shortcut = !handheld && shortcutForEvent(event, liveShortcuts(), { editing: Boolean(editControl), inline: editControl?.matches('.inline-editor') });
    if (shortcut) {
      event.preventDefault();
      const admission = desktop && shortcut.target === shortcutActions.capture ? native.bridge.request('desktop.intent').catch(() => ({ intent: null })) : Promise.resolve({ intent: null });
      run(async () => desktopAction(shortcut.target, (await admission).intent));
      return;
    }
    if (editControl) return;
    if (event.key === 'Escape') { event.preventDefault(); run(async () => { await controller.escape(); render(); }); }
    // The main window has no paper to edit in place when real desktop scenes are connected.
    if (event.key === 'Enter' && controller.state.selectedCardId && !event.target.closest('button,a')) {
      event.preventDefault(); const card = currentCard(controller.state.selectedCardId);
      if (card) run(() => desktopInfo ? openEditor(card) : beginInlineEdit(card));
    }
    if (event.key === 'Shift' && controller.state.dragSession) dragPaint(controller.pointerMove(controller.state.dragSession.current, { pointerId: controller.state.dragSession.pointerId, shiftKey: true, labels: groupLabels }));
  });
  document.addEventListener('keyup', event => {
    if (event.key === 'Shift' && controller.state.dragSession) dragPaint(controller.pointerMove(controller.state.dragSession.current, { pointerId: controller.state.dragSession.pointerId, shiftKey: false, labels: groupLabels }));
  });
}

run(initialize);
