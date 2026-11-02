import { Workspace } from '../core/workspace.js';
import { activeGroups, copy, eligible, FleetError, gridRegions, summaryText } from '../core/contracts.js';
import { groupColors } from '../core/palette.js';
import { normalizeShortcut, regionKeyChanges, regionShortcuts, regionTarget, resolveShortcuts, shortcutActions, shortcutForEvent, shortcutRegion, validateShortcuts } from '../core/shortcuts.js';
import { planFormation } from '../layout/formation.js';
import { adjustStage, arrivalLayer, groupLayer, groupLayerOrder, restingLayer, stepGroup } from '../layout/stages.js';
import { mainGroup, mainView } from '../layout/store.js';
import { orderedGroups, reorderSlots } from '../layout/order.js';
import { settleGroupColors } from '../layout/colors.js';
import { groupOpacity, MIN_OPACITY } from '../layout/opacity.js';
import { InteractionController, cardPolicy, quickMoveKey, sceneOrder } from '../interaction/controller.js';
import { IndexedDbStorage, acquireProfile } from '../storage/indexed-db.js';
import { IndexedDbRecordStore } from '../storage/records-indexed-db.js';
import { NativeRecordStore } from '../storage/records-native.js';
import { WorkspaceRecordStorage } from '../storage/workspace-records.js';
import { renderMarkdown } from './markdown.js';
import { checklistProgress, toggleChecklist } from './checklist.js';
import { rankSearch } from './search.js';
import { canSetAside, causeKey, loadFailureCause, workspaceFailureCause } from './data-failure.js';
import { revisionPanel } from './conflicts.js';
import { backupPanel } from './backup.js';
import { AutomaticBackup } from '../backup/automatic.js';
import { IndexedDbBackupJournal, BrowserAutomaticFiles } from '../backup/browser-automatic.js';
import { startAutomaticBackup } from '../backup/lifecycle.js';
import { connectNative } from '../native/bridge.js';
import { NativeFiles } from '../native/files.js';
import { NativeAttachments } from '../native/attachments.js';
import { renderAttachmentTiles } from './attachments.js';
import { paperFitter } from './fit.js';
import { NativeCaptureInbox } from '../native/capture.js';
import { NativeStorage } from '../storage/native.js';
import { nativeBackupAdapters } from '../backup/native.js';
import { DesktopAuthority } from '../desktop/authority.js';
import { overlayMainStep } from '../desktop/overlay.js';
import { DesktopOwner } from '../desktop/owner.js';
import { projectDesktop } from '../desktop/projection.js';
import { NativeShortcutSettings } from '../native/shortcuts.js';
import { NativeGoogleDatasetStore } from '../native/google.js';
import { DatasetSync } from '../sources/dataset-sync.js';
import { DatasetHistory } from '../sources/dataset-history.js';
import { DatasetPurge } from '../sources/dataset-purge.js';
import { DatasetReset } from '../sources/dataset-reset.js';
import { cleanupDatasetTransition, previewDatasetRejoin, stageDatasetRejoin, startDatasetReset, stagePendingDatasetReset } from '../sources/dataset-transition.js';
import { prepareDatasetRestore, advanceDatasetRestore } from '../backup/dataset-restore.js';
import { createBackup, openBackup } from '../backup/payload.js';
import { saveSafetyBackup } from '../backup/restore.js';
import { formatDate, localizeDocument, onLocaleChange, plural, t } from '../i18n/index.js';
import { groupName } from '../core/group-name.js';
import { adoptHostLanguage, changeLanguage, languageOptions, languagePreference, startLanguage } from './language.js';

const $ = selector => document.querySelector(selector);
let workspace; let storage; let controller; let lease;
// The browser preview opens on its desktop canvas when there is room; desktop hosts and phones open on the papers.
let activeGroupId; let filter = 'active'; let showDesktop = !matchMedia('(max-width:640px)').matches;
let currentDraft = null; let draftSequence = 0; let draftPending = Promise.resolve(); let editorBusy = false;
let composing = false;
let formationMode = 'stack'; let formationPreview; let groupLabels = [];
let lastVisibleArea;
let settingsSlots = []; let settingsPage = null; let dataPanel = null; let revisions = null;
let automatic; let automaticError; let browserJournal;
let native; let nativeBackups; let stopAutomatic; let nativeClosing = false;
let nativeFiles; let attachmentFiles;
const noteAttachmentCleanup = []; const stageAttachmentCleanup = []; const editorAttachmentCleanup = [];
const boardFitter = paperFitter(); const stageFitter = paperFitter();
let captureInbox; let selectedCapture; let captureBusy = false;
let desktop; let desktopInfo; let remoteEditor = null;
// Quick capture brought the main window out of the tray or menu bar, so closing its editor puts the window back.
let editorHidesMain = false;
let nativeShortcuts; let shortcutStatus = []; let labwcShortcuts = null;
let googleAccount; let syncService; let syncTimer; let syncBusy = false; let accountBusy = false;
let datasetStore = null; let purge; let maintenanceTimer; let maintenanceWork = null; let maintenanceAbort = new AbortController();
let maintenancePaused = false; let syncRequested = false; let datasetProblem = null; let pendingReset = null;
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
// A status can offer one follow-up, such as undoing a delete, which runs once; the next status takes it away.
// Phones arrange no desktop, so "My group" means nothing there, even when a restored computer layout carries one.
const myGroupOf = layout => handheld ? null : layout.myGroupId;
// A short message floating above the page that leaves on its own or when closed; a newer one replaces it. The live
// region stays in the page and is emptied rather than hidden, so assistive technology announces every message.
let toastTimer = 0;
function closeToast() { clearTimeout(toastTimer); $('#toast').replaceChildren(); }
function toast(title, lines = []) {
  const close = element('button', '×', 'toast-close'); close.type = 'button'; close.setAttribute('aria-label', t('common.close'));
  close.onclick = event => { event.stopPropagation(); closeToast(); };
  $('#toast').replaceChildren(element('strong', title), ...lines.map(line => element('span', line)), close);
  clearTimeout(toastTimer); toastTimer = setTimeout(closeToast, 4000 + 1500 * lines.length);
}
function status(text, error = false, action = null) {
  $('#status').textContent = text; $('#status').classList.toggle('error', error);
  const follow = $('#status-action'); follow.hidden = !action; follow.textContent = action?.label ?? '';
  follow.onclick = action && (() => { follow.hidden = true; run(action.run); });
}
const textOf = text => typeof text === 'function' ? text() : text ?? '';
// Text set outside the render functions keeps how it was built, so relocalize() can build it again in a new language.
const shownText = new Map();
function setText(selector, text) { shownText.set(selector, text); $(selector).textContent = textOf(text); }
async function run(action, { duringAdjust = false } = {}) {
  if (nativeClosing) return;
  // A click can enter the queue before adjustment starts; admit owner UI again when its turn actually runs.
  const invoke = () => { if (duringAdjust || !adjustOverlayActive()) return action(); };
  const pending = desktop ? desktop.perform(invoke) : Promise.resolve().then(invoke); activeActions.add(pending);
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
// Each group's paper colour is this device's choice; the settled colours cover a group the layout has not stored yet.
function groupColor(id) {
  const stored = workspace.layout.state.groupColors;
  return groupColors[stored?.[id] ?? settleGroupColors(stored, activeGroups(workspace.snapshot))[id] ?? 0];
}
const colorNames = () => [t('app.colors.yellow'), t('app.colors.mint'), t('app.colors.blue'), t('app.colors.peach'), t('app.colors.lavender'),
  t('app.colors.teal'), t('app.colors.pink'), t('app.colors.sand'), t('app.colors.slate')];
// The note as this device shows it, with its unsaved changes; a note never saved has no revision (ADR-061).
function currentCard(id) { return workspace.working.cards.find(card => card.id === id); }
// The sidebar and every group picker list groups in this device's region order.
function shownGroups() { return orderedGroups(workspace.layout.state, activeGroups(workspace.snapshot)); }
// A group chosen in the sidebar or by a region key is remembered on this device, so after a restart the main window and
// quick capture return to it. A group that is gone falls back to the remembered one, which a merge carries to the
// receiving group, and then to the first. Remembering never holds up the action that chose the group; a failed write
// only says so.
const rememberedGroup = () => mainGroup(workspace.layout.state, shownGroups());
async function rememberGroup() {
  if (activeGroupId) await workspace.layout.setMainGroup(activeGroupId, workspace.snapshot).catch(error => status(error.message, true));
}
function fillGroups(select, selected, none = false) {
  select.replaceChildren();
  if (none) select.append(new Option(t('app.groups.none'), ''));
  for (const group of shownGroups()) select.append(new Option(groupName(group), group.id));
  select.value = selected || '';
}

async function initialize() {
  startLanguage();
  // What the page shows while it loads.
  status(t('app.status.loading')); setSync('off', () => t('sync.status.opening'));
  setText('#storage-note', () => t('sync.status.opening')); renderAccount();
  native = await connectNative();
  adoptHostLanguage(native);
  // A host's stored language can differ from the browser's, so the loading texts are shown again in it.
  if (native) { status(t('app.status.loading')); setSync('off', () => t('sync.status.opening')); renderAccount(); }
  if (native) {
    profileId = native.info.profileId;
    storage = new WorkspaceRecordStorage(new NativeRecordStore(native.bridge, native.info), profileId,
      { legacy: new NativeStorage(native.bridge, native.info) });
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
    // The phone apps are apps, not pages: two fingers, a double tap or a focused field do not zoom them. WKWebView keeps
    // the page's scale limits; Android also turns zoom off in its WebView settings.
    if (handheld) document.querySelector('meta[name="viewport"]').content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';
    if (native.info.platform === 'macos') {
      const gear = $('#settings-button'); gear.dataset.i18nAttr = 'aria-label:settings.title;title:app.sidebar.settingsTitleMac';
      gear.title = t('app.sidebar.settingsTitleMac');
    }
    lease = { acquired: true, release() {} };
  } else {
    lease = await acquireProfile(profileId);
    storage = new WorkspaceRecordStorage(await IndexedDbRecordStore.open(), profileId, { legacy: await IndexedDbStorage.open() });
  }
  if (!lease.acquired) throw new Error(t('app.errors.openElsewhere'));
  addEventListener('pagehide', () => { lease.release(); storage.close(); });
  addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  addEventListener('beforeunload', event => {
    if (unsavedDrafts.size) { event.preventDefault(); event.returnValue = ''; }
  });
  // A host that can show the data folder and set the data aside explains notes it cannot read instead of only failing.
  const recovery = native?.info.capabilities.dataRecovery === true;
  let saved;
  try { saved = await storage.load(profileId); }
  catch (error) {
    if (error.code === 'incompatible-local-data') return showIncompatibleLocal();
    if (recovery && loadFailureCause(error)) return showDataFailure(loadFailureCause(error)); throw error;
  }
  const persist = (...args) => storage.save(...args);
  if (saved) saved = await stagePendingDatasetReset(saved, storage);
  // Groups new to this computer, made here or brought by sign-in or sync, start at the back of its desktop.
  const backLayer = () => arrivalLayer(residentLayers());
  try { if (saved) workspace = new Workspace(saved, persist); }
  catch (error) { if (recovery && workspaceFailureCause(error, saved)) return showDataFailure(workspaceFailureCause(error, saved)); throw error; }
  workspace ||= await Workspace.create({ profileId,
    deviceId: crypto.randomUUID(), area: screenArea(), persist, current: true,
    bootstrapGroup: !profileId.startsWith('google:'), arrivalLayer: backLayer });
  const history = new DatasetHistory({ workspace, storage, fileStore: () => datasetStore });
  workspace.setHistory(history); storage.setAttachmentLoader(id => history.attachment(id));
  purge = new DatasetPurge({ workspace, storage, fileStore: () => datasetStore });
  workspace.setArrivalLayer(backLayer);
  // A new note open in a quick edit stays on the desktop while its text is cleared (ADR-061).
  workspace.setOpenNote(() => remoteEditor?.cardId ?? null);
  activeGroupId = rememberedGroup();
  controller = new InteractionController({ getSnapshot: () => workspace.working, layout: workspace.layout, workAreas,
    commands: workspace, saveDraft: async () => { if (currentDraft) await flushDraft(); },
    releaseDraft: async cardId => {
      if (currentDraft?.cardId !== cardId) return;
      // Clear first so a background flush cannot write the draft back while it is being discarded.
      const draft = currentDraft; currentDraft = null;
      // Dropping is housekeeping: a failure only leaves an extra draft, so report it without failing the action.
      try { await workspace.discardUnneededDraft(draft.id); } catch (error) { status(t('app.status.draftCleanupFailed', { error: error.message }), true); }
    } });
  // The regions move to today's primary display before new papers take a place in them.
  if (desktopInfo) await workspace.layout.recoverDisplays(workAreas(), screenArea());
  await workspace.layout.placeNew(workspace.working, workAreas());
  if (desktopInfo) initializeDesktop();
  setText('#storage-note', () => native ? t('sync.storage.device') : t('sync.storage.browser'));
  renderAccount(); setSync('off', () => native ? t('sync.status.deviceOnly') : t('sync.status.browserOnly'));
  try {
    const journal = native ? storage.journal() : await IndexedDbBackupJournal.open(); if (!native) browserJournal = journal;
    const files = nativeBackups?.files || new BrowserAutomaticFiles(); const vault = nativeBackups?.vault;
    const service = new AutomaticBackup({ workspace, storage, journal, files, vault, appVersion: native?.info.appVersion,
      flush: () => desktop ? desktop.perform(flushDraft) : flushDraft() }); await service.load();
    automatic = { service, files, vault }; stopAutomatic = startAutomaticBackup(service);
    addEventListener('pagehide', () => { stopAutomatic(); journal.close(); });
  } catch (error) { automaticError = error; }
  if (native) {
    native.bridge.onCloseRequested(() => { void prepareNativeClose(); });
    native.bridge.onEvent('update-state', message => { updateState = message.state; if ($('#settings-dialog').open) renderUpdate(); });
    native.bridge.onEvent('host-background', message => {
      stopAutomatic?.(); void run(async () => {
        await flushDraft(); await automatic?.service.whenIdle();
        if (message.id) await native.bridge.request('host.backgroundReady', { id: message.id });
      }, { duringAdjust: true });
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
    }, { duringAdjust: true }); });
    const note = $('#shortcut-note'); note.dataset.i18n = 'settings.shortcuts.noteGlobal'; note.textContent = t('settings.shortcuts.noteGlobal');
    addEventListener('pagehide', () => nativeShortcuts.close());
  }
  // A hidden page runs its timers only once a minute (WebView2, after one to two minutes in the tray), so the desktop hosts
  // tick every 20 seconds and sync follows that tick while the main window is hidden. Showing it again syncs at once.
  native?.bridge.onEvent('host-tick', () => { if (document.visibilityState === 'hidden') void syncGoogle(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncGoogle(); });
  displayBackend = native?.info.displayBackend ?? null;
  // GNOME Wayland without desktop papers points at the setting that brings them through XWayland.
  const displayHint = displayBackend?.current === 'wayland' && !displayBackend.fixed; const reason = native?.info.desktopReason;
  onLocaleChange(relocalize);
  bindEvents(); render(); status(reason ? displayHint ? t('app.status.desktopReasonXwayland', { reason }) : reason : t('app.status.opened'));
  $('#share-note').hidden = !native?.info.capabilities.fileShare;
  if (native) await initializeGoogle();
  scheduleMaintenance();
  addEventListener('pagehide', () => { clearTimeout(maintenanceTimer); maintenanceAbort.abort(); }, { once: true });
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
        render(); if (result.rescued.length) status(plural('app.status.rescued', result.rescued.length));
      });
    }, 250);
  }).observe($('#stage-shell'));
}

async function showIncompatibleLocal() {
  const dialog = $('#data-failure-dialog'), body = $('#data-failure-body'), actions = $('#data-failure-actions');
  dialog.querySelector('h2').textContent = t('app.incompatible.title');
  body.replaceChildren(element('p', t(profileId.startsWith('google:') ? 'app.incompatible.google' : 'app.incompatible.local')),
    element('p', t('app.incompatible.keep')));
  const agree = element('input'); agree.type = 'checkbox'; agree.id = 'discard-old-local-agree';
  const label = element('label', undefined, 'check'); label.append(agree, document.createTextNode(t('app.incompatible.agree'))); body.append(label);
  const discard = element('button', t('app.incompatible.discard'), 'danger'); discard.id = 'discard-old-local'; discard.disabled = true;
  agree.onchange = () => { discard.disabled = !agree.checked; };
  discard.onclick = async () => {
    discard.disabled = true; agree.disabled = true;
    try { await storage.reset(profileId); if (!native) { lease.release(); location.reload(); } }
    catch (error) { status(error.message, true); discard.disabled = false; agree.disabled = false; }
  };
  actions.replaceChildren();
  if (native?.info.capabilities.dataRecovery) actions.append(button(t('app.dataFailure.openFolder'), () => native.bridge.request('data.reveal')));
  actions.append(discard); dialog.oncancel = event => event.preventDefault(); dialog.showModal();
  status(t('app.incompatible.keep')); await native?.bridge.request('host.ready');
}

// SPEC-006 DO: the notes on this device could not be read. The window says why and shows the data folder; where it can
// help, it sets the data aside after a confirmation, and the host reopens this page on empty data.
async function showDataFailure(cause) {
  const dialog = $('#data-failure-dialog'); const body = $('#data-failure-body'); const actions = $('#data-failure-actions');
  const location = await native.bridge.request('data.location').catch(() => null);
  // Nothing behind it works without the notes, so the explanation stays until the data is set aside or the app quits;
  // Esc or a browser close request only shows it again.
  dialog.oncancel = event => event.preventDefault();
  dialog.onclose = () => dialog.showModal();
  // No workspace or controller exists yet, so its buttons report failures themselves instead of going through run().
  const button = (text, action, className) => {
    const node = element('button', text, className); node.type = 'button';
    node.onclick = () => { void Promise.resolve().then(action).catch(error => status(error.message, true)); }; return node;
  };
  const explain = () => {
    body.replaceChildren(element('p', t(causeKey(cause))));
    if (location?.path) body.append(element('p', t('app.dataFailure.folder')), element('code', location.path, 'data-failure-path'));
    actions.replaceChildren(button(t('app.dataFailure.openFolder'), () => native.bridge.request('data.reveal')));
    if (canSetAside(cause)) actions.append(button(t('app.dataFailure.setAside'), confirm));
  };
  const confirm = () => {
    body.replaceChildren(element('h3', t('app.dataFailure.confirmTitle')), element('p', t('app.dataFailure.confirmMove')),
      element('p', t('app.dataFailure.confirmGoogle')), element('p', t('app.dataFailure.confirmLocal')));
    actions.replaceChildren(button(t('common.cancel'), explain), button(t('app.dataFailure.confirm'), async () => {
      for (const control of actions.querySelectorAll('button')) control.disabled = true;
      body.append(element('p', t('app.dataFailure.settingAside')));
      await native.bridge.request('data.setAside');
    }, 'danger'));
  };
  explain(); status(t(causeKey(cause)), true); dialog.showModal();
}

async function initializeGoogle() {
  clearInterval(syncTimer);
  googleAccount = await native.bridge.request('google.status');
  const google = profileId.startsWith('google:'), connected = googleAccount.connected;
  const paused = google && googleAccount.paused === true;
  datasetStore = google && (connected || paused) ? new NativeGoogleDatasetStore(native.bridge, native.info, googleAccount.accountId) : null;
  pendingReset = await storage.getJob('dataset-reset');
  if (pendingReset && !pendingReset.seeded && !pendingReset.localSettingsCleared) {
    if (!automatic) throw automaticError ?? new Error(t('sync.errors.cannotSync'));
    await automatic.service.clearSettings();
    pendingReset = { ...pendingReset, localSettingsCleared: true }; await storage.putJob('dataset-reset', pendingReset);
  }
  const transitionError = await storage.getJob('dataset-ui-error');
  if (['dataset-changed', 'source-reset-superseded', 'initialization-conflict'].includes(transitionError?.code)) {
    datasetProblem = transitionError; maintenancePaused = true;
  }
  renderGoogleAccess(); renderAccount();
  $('#google-sign-in').onclick = () => { void changeGoogleAccount('signIn'); };
  $('#google-sign-out').onclick = () => { void changeGoogleAccount('signOut'); };
  $('#google-local').onclick = () => { void changeGoogleAccount('local'); };
  setText('#google-sync', workspace.state.cloudRestore ? () => t('sync.actions.resumeOverwrite') : () => t('sync.actions.syncNow'));
  $('#google-sync').onclick = () => {
    if (datasetProblem) { sourceResetAsked = false; void askDatasetRecovery(); }
    else if (workspace.state.cloudRestore) askResumeCloudRestore();
    else if (pendingReset && !pendingReset.ready && pendingReset.phase !== 'complete') { maintenancePaused = false; scheduleMaintenance(0); }
    else { maintenancePaused = false; scheduleMaintenance(); void syncGoogle(true); }
  };
  if (datasetProblem) {
    syncService = null; setText('#google-sync', () => t('sync.recovery.options'));
    setSync('attention', () => t('sync.recovery.paused'), datasetProblem.message); return;
  }
  if (workspace.state.cloudRestore) {
    syncService = null; stopAutomatic?.();
    setSync('attention', () => t('sync.status.overwriteUnfinished'), workspace.state.cloudRestore.error || (() => t('sync.detail.overwriteSaved')));
    return;
  }
  if (pendingReset && !pendingReset.ready && pendingReset.phase !== 'complete') {
    syncService = null; stopAutomatic?.();
    setText('#google-sync', () => t('sync.actions.resumeReset'));
    setSync('attention', () => t('sync.status.resetUnfinished'), () => t('sync.detail.resetUnfinished')); return;
  }
  if (datasetStore) {
    setText('#storage-note', paused ? () => t('sync.storage.paused') : () => t('sync.storage.google'));
    setSync(paused ? 'attention' : 'off', paused ? () => t('sync.status.paused') : () => t('sync.status.waiting'), paused ? googleAccount.pauseReason : '');
    syncService = new DatasetSync({ workspace, storage, fileStore: datasetStore });
    syncTimer = setInterval(() => { void syncGoogle(); }, 20000);
    addEventListener('online', () => { maintenancePaused = false; scheduleMaintenance(); void syncGoogle(); });
    addEventListener('pagehide', () => { clearInterval(syncTimer); void syncService?.stop(); });
    if (!paused) void syncGoogle();
  } else if (google) {
    setText('#storage-note', () => t('sync.storage.signInAgain'));
    setSync('attention', () => t('sync.status.signInAgain'), () => t('sync.detail.notesKept'));
  } else {
    setSync('off', googleAccount.configured ? () => t('sync.status.notConnected') : () => t('sync.status.deviceOnly'),
      googleAccount.configured ? () => t('sync.detail.signInSwitches') : '');
  }
}

function renderGoogleAccess() {
  const google = profileId.startsWith('google:');
  const connected = Boolean(googleAccount?.connected);
  const paused = google && googleAccount?.paused === true;
  const { email, configured } = googleAccount;
  $('#google-row').hidden = false; $('#local-row').hidden = !google; $('#sync-row').hidden = !(connected || paused);
  setText('#google-value', paused ? () => t('sync.status.paused') : connected ? email || (() => t('sync.account.google'))
    : configured ? () => t('sync.google.signedOut') : () => t('sync.google.unavailable'));
  $('#google-sign-in').hidden = !configured;
  setText('#google-sign-in', connected || paused ? () => t('sync.google.switchAccount') : google ? () => t('sync.google.signInAgain') : () => t('sync.google.signIn'));
  $('#google-sign-out').hidden = !(connected || paused);
}
// The account chip, the settings account card and identity say where the papers live and how syncing goes.
function renderAccount() {
  const connected = Boolean(googleAccount?.connected);
  if (!connected && googleProfile) { if (googleProfile.photo) URL.revokeObjectURL(googleProfile.photo); googleProfile = null; }
  const known =connected && googleProfile?.accountId === googleAccount.accountId ? googleProfile : null;
  const email = connected ? googleAccount.email || '' : '';
  const name = known?.name || (connected ? email || t('sync.account.google') : profileId.startsWith('google:') ? t('sync.account.google') : t('sync.account.localNotes'));
  for (const [avatar, initial, label] of [['#account-avatar', '#account-initial', '#account-name'], ['#identity-avatar', '#identity-initial', '#identity-name'],
    ['#settings-account-avatar', '#settings-account-initial', '#settings-account-name']]) {
    $(label).textContent = name;
    $(initial).textContent = connected ? [...name][0].toLocaleUpperCase() : ''; $(initial).hidden = !connected || Boolean(known?.photo);
    $(`${avatar} svg`).toggleAttribute('hidden', connected); $(avatar).classList.toggle('signed-in', connected);
    const photo = $(`${avatar} img`); photo.hidden = !known?.photo;
    if (known?.photo) photo.src = known.photo; else photo.removeAttribute('src');
  }
  // The name stands in for the email, which stays in the chip's tooltip and in Settings.
  if (email) $('#account-button').title = email; else $('#account-button').removeAttribute('title');
}
// After a sync reaches Google, the host reads the account's name and photo; until then, or without them, the chip shows
// the email. The page loads nothing from the network, so the photo arrives as bytes and shows from a blob URL. A failed
// read waits ten minutes before the next sync tries again.
let googleProfile = null; let profileLoading = null; let profileRetryAt = 0;
function loadGoogleProfile() {
  const accountId = googleAccount?.connected ? googleAccount.accountId : null;
  if (!accountId || !native?.bridge || googleProfile?.accountId === accountId || profileLoading === accountId || Date.now() < profileRetryAt) return;
  profileLoading = accountId;
  Promise.resolve().then(() => native.bridge.request('google.profile', { accountId })).then(result => {
    if (googleAccount?.connected && googleAccount.accountId === accountId) showGoogleProfile(accountId, result);
  }, () => { profileRetryAt = Date.now() + 600000; }).finally(() => { if (profileLoading === accountId) profileLoading = null; });
}
function showGoogleProfile(accountId, result) {
  const name = typeof result?.name === 'string' && result.name.length <= 256 ? result.name.trim() : '';
  const photo = result?.photo; let url = null;
  if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(photo?.type) && typeof photo.data === 'string' && photo.data.length <= 180000) {
    try { url = URL.createObjectURL(new Blob([Uint8Array.from(atob(photo.data), c => c.charCodeAt(0))], { type: photo.type })); } catch { url = null; }
  }
  if (googleProfile?.photo) URL.revokeObjectURL(googleProfile.photo);
  googleProfile = { accountId, name: name || null, photo: url };
  renderAccount();
}
// Text and detail are host or error text, or a function that builds catalog text; relocalize() shows the last state again.
let shownSync = null;
function setSync(state, text, detail = '') {
  shownSync = [state, text, detail]; const shownDetail = textOf(detail);
  syncState = state; $('#account').dataset.sync = state; $('#settings-dialog').dataset.sync = state;
  $('#sync-status').textContent = textOf(text); $('#sync-detail').textContent = textOf(text); $('#settings-account-status').textContent = textOf(text);
  $('#account-detail').textContent = shownDetail; $('#account-detail').hidden = !shownDetail; updateAttention();
  if (state === 'ok' || state === 'pending') loadGoogleProfile();
}
// The drawer hides the account chip and the sidebar links on phones, so their warnings show on the drawer button.
// Conflicts show in the status bar, outside the drawer.
function updateAttention() {
  $('#attention-dot').hidden = !(captureCount || ['error', 'attention'].includes(syncState));
}
async function syncGoogle(force = false) {
  // Settings edits nothing a sync could overwrite and holds Sync now, so it does not hold syncing; a running backup or
  // restore on its data page does, and so does the versions page, whose choices name the versions it shows.
  const settings = $('#settings-dialog');
  if (maintenanceWork) { syncRequested = true; return; }
  if (!syncService || syncBusy || nativeClosing || accountBusy || composing || dataPanel?.busy() || dataPanel?.blocksSync() || revisions
    || [...document.querySelectorAll('dialog[open]')].some(dialog => dialog !== settings)) return;
  const sourceSync = syncService; const sourceProfile = profileId;
  const current = () => !nativeClosing && !accountBusy && syncService === sourceSync && profileId === sourceProfile;
  syncBusy = true; $('#google-sync').disabled = true; setSync('busy', () => t('sync.status.syncing'));
  try {
    if (force && native?.info.capabilities?.vaultUnlock) {
      setSync('busy', () => t('sync.status.preparing'), () => t('sync.detail.unlockKeyring'));
      const unlockedAccount = await native.bridge.request('google.unlockVault');
      if (!current()) return;
      googleAccount = unlockedAccount;
      renderGoogleAccess(); renderAccount();
      setText('#storage-note', googleAccount.connected ? () => t('sync.storage.google') : () => t('sync.storage.signInAgain'));
      setSync('busy', () => t('sync.status.syncing'));
    }
    await (desktop ? desktop.perform(sync) : sync());
    async function sync() {
      if (!current()) return;
      await flushDraft();
      if (!current()) return;
      const result = await sourceSync.sync({ force });
      if (!current()) return;
      if (result?.phase === 'waiting-initialization') {
        setSync('attention', () => t('sync.status.waitingInitialization'), () => t('sync.detail.waitingInitialization')); return;
      }
      activeGroupId = activeGroups(workspace.snapshot).some(group => group.id === activeGroupId) ? activeGroupId : rememberedGroup();
      await controller.reconcile(); await workspace.layout.placeNew(workspace.working, workAreas()); render();
      if (googleAccount?.paused) {
        const account = await native.bridge.request('google.status');
        if (!current()) return;
        googleAccount = account; renderGoogleAccess(); renderAccount();
        setText('#storage-note', googleAccount.paused ? () => t('sync.storage.paused') : () => t('sync.storage.google'));
        if (googleAccount.paused) { setSync('attention', () => t('sync.status.paused'), googleAccount.pauseReason); return; }
      }
      const pending = workspace.pendingCount; const at = new Date();
      if (pending) setSync('pending', () => plural('sync.status.pending', pending));
      else setSync('ok', () => t('sync.status.syncedAt', { time: formatDate(at, { hour: '2-digit', minute: '2-digit' }) }));
    }
  } catch (error) {
    if (!current()) return;
    if (['dataset-changed', 'incompatible-cloud-data', 'initialization-conflict', 'source-reset-superseded'].includes(error.code)) {
      datasetProblem = error; maintenancePaused = true;
      setSync('attention', () => t('sync.recovery.paused'), error.message);
      setText('#google-sync', () => t('sync.recovery.options')); void askDatasetRecovery(); return;
    }
    const vaultPaused = ['vault-locked', 'vault-unavailable', 'storage-cleanup', 'vault-unlock-cancelled', 'vault-unlock-timeout'].includes(error.code);
    if (vaultPaused) {
      googleAccount = { ...googleAccount, connected: false, paused: true, pauseReason: error.message };
      renderGoogleAccess(); renderAccount();
    }
    setSync(vaultPaused ? 'attention' : 'error', vaultPaused ? () => t('sync.status.paused') : () => t('sync.status.failed'), error.message);
    if (error.code === 'unauthorized' || error.code === 'source-permission') setText('#google-sign-in', () => t('sync.google.signInGoogleAgain'));
  }
  finally { syncBusy = false; $('#google-sync').disabled = false; }
}

// Each turn performs one bounded cleanup unit. Normal sync gets priority, and dialogs/backup captures keep their view.
function scheduleMaintenance(delay = 1500) {
  clearTimeout(maintenanceTimer);
  if (nativeClosing || maintenanceAbort.signal.aborted) return;
  maintenanceTimer = setTimeout(() => { void maintainDataset(); }, delay);
}
async function stopMaintenance() {
  clearTimeout(maintenanceTimer); maintenanceAbort.abort(); await maintenanceWork?.catch(() => {});
}
async function maintainDataset() {
  if (maintenanceWork || maintenancePaused || accountBusy || syncBusy || nativeClosing || editorBusy || composing
    || dataPanel?.busy() || dataPanel?.blocksSync() || revisions || document.querySelector('dialog[open]')
    || profileId.startsWith('google:') && (!googleAccount?.connected || !workspace.syncState.dataset && !workspace.state.cloudRestore && !pendingReset)) {
    scheduleMaintenance(); return;
  }
  let more = false;
  maintenanceWork = (async () => {
    if (workspace.state.cloudRestore) {
      const result = await advanceDatasetRestore({ workspace, storage, fileStore: datasetStore, signal: maintenanceAbort.signal,
        progress: datasetProgress(text => { $('#cleanup-status').textContent = text; }) });
      more = true;
      if (result.complete) {
        await initializeGoogle(); if (automatic) stopAutomatic = startAutomaticBackup(automatic.service);
        await controller.reconcile(); render();
      }
      return;
    }
    const reset = datasetStore ? new DatasetReset(datasetStore, storage) : null;
    pendingReset = await reset?.status();
    if (pendingReset && pendingReset.phase !== 'complete') {
      const wasReady = pendingReset.ready;
      pendingReset = await reset.step({ signal: maintenanceAbort.signal }); more = pendingReset.phase !== 'complete';
      if (pendingReset.ready) $('#cleanup-status').textContent = t(more ? 'sync.reset.cleanup' : 'sync.reset.cleaned',
        { done: pendingReset.deleted, total: pendingReset.captured, folders: pendingReset.retainedFolders });
      else datasetProgress(text => { $('#cleanup-status').textContent = text; })({ phase: pendingReset.phase, completed: pendingReset.deleted, total: pendingReset.captured });
      if (!wasReady && pendingReset.ready) { await initializeGoogle(); if (automatic) stopAutomatic = startAutomaticBackup(automatic.service); }
      return;
    }
    const result = await purge.step({ signal: maintenanceAbort.signal });
    if (result) {
      more = true;
      const key = { pending: 'app.purge.pending', committed: 'app.purge.committed', 'cloud-cleanup': 'app.purge.committed',
        'local-cleanup': 'app.purge.local', complete: 'app.purge.complete', 'needs-preview': 'app.purge.review' }[result.phase];
      if (key) $('#cleanup-status').textContent = t(key);
      await controller.reconcile(); await workspace.layout.placeNew(workspace.working, workAreas()); render();
    } else more = await cleanupDatasetTransition(storage) || await storage.maintenance();
  })();
  try { await maintenanceWork; }
  catch (error) {
    if (!maintenanceAbort.signal.aborted) {
      maintenancePaused = true;
      $('#cleanup-status').textContent = t('app.purge.paused', { error: error.message });
      $('#retry-cleanup').hidden = false;
      if (['dataset-changed', 'source-reset-superseded'].includes(error.code)) {
        await storage.putJob('dataset-ui-error', { kind: 'dataset-ui-error', code: error.code, message: error.message });
        datasetProblem = error; setSync('attention', () => t('sync.recovery.paused'), error.message);
        setText('#google-sync', () => t('sync.recovery.options'));
      }
    }
  } finally {
    maintenanceWork = null;
    if (syncRequested) { syncRequested = false; void syncGoogle(); }
    scheduleMaintenance(more ? 250 : 2500);
  }
}

async function confirmPurge(ids) {
  if (!ids.length) return;
  const preview = await purge.preview(ids);
  const dialog = element('dialog'); dialog.id = 'purge-dialog';
  dialog.append(element('h2', t(ids.length === 1 ? 'app.purge.title' : 'app.purge.emptyTitle')),
    element('p', t('app.purge.warning', { count: ids.length })),
    element('p', t(profileId.startsWith('google:') ? 'app.purge.cloud' : 'app.purge.device')));
  const list = element('ul');
  for (const id of ids.slice(0, 10)) list.append(element('li', summaryText(workspace.snapshot.cards.find(card => card.id === id))));
  dialog.append(list);
  const cancel = button(t('common.cancel'), () => dialog.close());
  const confirm = button(t('app.purge.confirm'), async () => {
    confirm.disabled = true;
    try { await purge.enqueue(preview); dialog.close(); maintenancePaused = false; $('#cleanup-status').textContent = t('app.purge.pending'); scheduleMaintenance(0); }
    finally { confirm.disabled = false; }
  }, 'danger'); confirm.id = 'confirm-purge';
  const actions = element('div', undefined, 'dialog-actions'); actions.append(cancel, confirm); dialog.append(actions);
  dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
}

async function changeGoogleAccount(action) {
  if (accountBusy || nativeClosing || dataPanel?.busy()) return; accountBusy = true;
  const oldSync = syncService; clearInterval(syncTimer); stopAutomatic?.();
  try {
    await stopMaintenance(); await automatic?.service.whenIdle(); await oldSync?.stop(); await oldSync?.whenIdle(); syncService = null; datasetStore = null;
    desktop?.beginClose(); if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: true });
    await (desktop ? desktop.perform(flushDraft) : flushDraft()); await desktop?.whenIdle(); desktop?.sealClose();
    document.body.inert = true;
    if (action === 'signIn') {
      status(t('sync.google.signingIn'));
      const result = await native.bridge.request('google.signIn');
      await native.bridge.request('google.open', { accountId: result.accountId });
    } else await native.bridge.request(action === 'signOut' ? 'google.signOut' : 'google.local');
  } catch (error) {
    document.body.inert = false; status(error.message, error.code !== 'google-cancelled'); await desktop?.cancelClose();
    if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: false }).catch(() => {});
    if (automatic) stopAutomatic = startAutomaticBackup(automatic.service);
    accountBusy = false; maintenanceAbort = new AbortController(); await initializeGoogle(); scheduleMaintenance();
  }
}

// The workspace a data reset deletes, and what it leaves on this device.
function resetPlan() {
  const google = profileId.startsWith('google:');
  const keeps = [t('settings.data.keeps.backups')];
  if (captureInbox) keeps.push(t('settings.data.keeps.shares'));
  if (google) keeps.push(t('settings.data.keeps.googleSignIn'), t('settings.data.keeps.localNotes'));
  else if (googleAccount?.configured) keeps.push(t('settings.data.keeps.googleWorkspace'));
  return { cloud: google, keeps, run: resetWorkspace,
    // Clearing a Google workspace needs its Drive data, so it waits for a working sign-in.
    blocked: google && !googleAccount?.connected ? t('sync.errors.signInFirst') : null,
    target: google ? t('settings.data.target.googleAllDevices', { account: googleAccount?.email || t('sync.account.google') })
      : native ? t('settings.data.target.device') : t('settings.data.target.browser') };
}
function requireConnected() {
  if (!googleAccount?.connected) throw new Error(t('sync.errors.signInFirst'));
}

function cloudRestoreOptions() {
  if (!native || !googleAccount?.connected || !profileId.startsWith('google:') || workspace.state.cloudRestore) return null;
  return { target: googleAccount.email || t('sync.account.current'),
    prepare: async options => {
      requireConnected(); await maintenanceWork;
      if (!datasetProblem) {
        const result = await syncService?.sync({ force: true });
        if (result?.phase === 'waiting-initialization') throw new Error(t('sync.errors.initializingRestore'));
      }
      return prepareDatasetRestore({ ...options, workspace, storage, fileStore: datasetStore, recovery: Boolean(datasetProblem) });
    },
    run: (plan, safety, say) => runCloudRestore(say, { plan, safety }) };
}

function backupSourceOptions() {
  const google = profileId.startsWith('google:');
  return { target: google ? t('settings.data.target.google', { account: googleAccount?.email || t('sync.account.current') })
    : native ? t('settings.data.target.device') : t('settings.data.target.browser'),
    sync: async () => {
      if (!googleAccount?.connected || !syncService || workspace.state.cloudRestore || nativeClosing || accountBusy)
        throw new Error(t('sync.errors.cannotSync'));
      syncBusy = true; $('#google-sync').disabled = true; setSync('busy', () => t('sync.status.syncing'));
      try {
        const sync = async () => {
          const result = await syncService.sync({ force: true });
          if (result?.phase === 'waiting-initialization') throw new Error(t('sync.errors.initializingExport'));
          await controller.reconcile();
          await workspace.layout.placeNew(workspace.working, workAreas()); render();
        };
        await (desktop ? desktop.perform(sync) : sync());
        setSync('ok', () => t('sync.status.synced'));
      } catch (error) { setSync('error', () => t('sync.status.failed'), error.message); throw error; }
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

function datasetProgress(say) {
  return ({ phase, completed = 0, total = 0 }) => say(t(phase === 'capture' ? 'sync.reset.capturing'
    : phase === 'cleanup' || phase === 'journal-cleanup' ? 'sync.reset.deletingCloud' : 'sync.recovery.working', { done: completed, total }));
}

// The transition owns the writer until it reloads. Plan validation still uses the revision shown in its preview.
async function runDatasetChange(work) {
  if (accountBusy || nativeClosing) throw new Error(t('sync.errors.accountBusy'));
  accountBusy = true; clearInterval(syncTimer); stopAutomatic?.();
  const before = workspace.state, oldReset = await storage.getJob('dataset-reset');
  try {
    await stopMaintenance(); await automatic?.service.whenIdle();
    await syncService?.stop({ endSession: false }); await syncService?.whenIdle(); syncService = null;
    desktop?.beginClose(); if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: true });
    await desktop?.whenIdle(); desktop?.sealClose();
    await Promise.allSettled([...activeActions, draftPending]);
    document.body.inert = true;
    const cleared = await work();
    if (!cleared?.localReset) await storage.deleteJob('dataset-ui-error');
    currentDraft = null; unsavedDrafts.clear(); lease.release(); location.reload();
  } catch (error) {
    const saved = await storage.load(profileId).catch(() => null), job = await storage.getJob('dataset-reset').catch(() => null);
    // A committed generation or reset journal survives a missing acknowledgement. Never resume the old in-memory writer.
    if (saved && saved.revision !== before.revision || job?.operationId !== oldReset?.operationId || before.cloudRestore || oldReset && oldReset.phase !== 'complete') {
      await storage.putJob('dataset-ui-error', { kind: 'dataset-ui-error', code: error.code ?? 'storage-error', message: error.message }).catch(() => {});
      currentDraft = null; unsavedDrafts.clear(); lease.release(); location.reload(); return;
    }
    document.body.inert = false; await desktop?.cancelClose();
    if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: false }).catch(() => {});
    accountBusy = false; maintenanceAbort = new AbortController();
    if (automatic) stopAutomatic = startAutomaticBackup(automatic.service);
    if (native) await initializeGoogle(); scheduleMaintenance(); throw error;
  }
}

async function runCloudRestore(say, { plan, safety } = {}) {
  requireConnected();
  if (!plan) { maintenancePaused = false; scheduleMaintenance(0); say(t('sync.status.overwriteUnfinished')); return; }
  await runDatasetChange(async () => {
    await plan.stage(workspace, storage, datasetStore, safety);
  });
}

function askResumeCloudRestore() {
  if ([...document.querySelectorAll('dialog[open]')].some(dialog => dialog !== $('#settings-dialog'))) return;
  const dialog = element('dialog'), state = element('p', '', 'backup-message');
  const resume = element('button', t('sync.actions.resumeOverwrite'), 'danger'); resume.type = 'button';
  const cancel = element('button', t('common.later')); cancel.type = 'button'; cancel.onclick = () => dialog.close();
  resume.onclick = async () => {
    resume.disabled = true; cancel.disabled = true;
    try { await runCloudRestore(text => { state.textContent = text; }); dialog.close(); }
    catch (error) { state.textContent = error.message; resume.disabled = false; cancel.disabled = false; }
  };
  dialog.append(element('h2', t('sync.cloudRestore.title')),
    element('p', t('sync.cloudRestore.resumeReset', { account: googleAccount.email || t('sync.account.current') })),
    element('p', t('backup.reset.updateDevices')), state, cancel, resume);
  dialog.oncancel = event => { if (resume.disabled) event.preventDefault(); };
  dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
}

// Missing data is never deletion authority. Every replacement below has its own explicit scope and fresh remote checks.
async function askDatasetRecovery() {
  if (sourceResetAsked || [...document.querySelectorAll('dialog[open]')].some(dialog => dialog !== $('#settings-dialog'))) return;
  sourceResetAsked = true;
  const dialog = element('dialog'); dialog.id = 'source-reset-dialog';
  const message = element('p', '', 'backup-message'); message.setAttribute('role', 'status');
  const body = element('div'), actions = element('div', undefined, 'dialog-actions'); let busy = false;
  const action = (label, work, className) => {
    const control = element('button', label, className); control.type = 'button';
    control.onclick = async () => {
      if (busy) return; busy = true; actions.querySelectorAll('button').forEach(button => { button.disabled = true; });
      try { await work(); } catch (error) { message.textContent = error.message; }
      finally { busy = false; actions.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
    }; return control;
  };
  const exportFirst = action(t('sync.sourceReset.exportFirst'), async () => { dialog.close(); await openSettings('data'); });
  const later = action(t('common.later'), async () => dialog.close());
  const account = googleAccount?.email || t('sync.account.current');
  body.append(element('p', t('sync.recovery.kept', { account })), element('p', datasetProblem?.message ?? ''), element('p', t('backup.reset.updateDevices')));
  actions.append(exportFirst, later);
  if (datasetProblem?.code === 'incompatible-cloud-data' || datasetProblem?.code === 'initialization-conflict') {
    body.append(element('p', t('sync.recovery.legacy')));
    actions.append(action(t('sync.recovery.reset'), async () => { dialog.close(); await openSettings('data'); }, 'danger'));
  } else {
    actions.append(action(t('sync.recovery.rejoin'), async () => {
      requireConnected(); await flushDraft();
      const preview = await previewDatasetRejoin({ workspace, storage, fileStore: datasetStore });
      body.replaceChildren(element('p', t('sync.recovery.rejoinPreview', { account, pending: preview.pending, drafts: preview.drafts, cards: preview.cards })));
      actions.replaceChildren(exportFirst, later, action(t('sync.recovery.confirmRejoin'), async () => runDatasetChange(() =>
        stageDatasetRejoin({ workspace, storage, fileStore: datasetStore, preview })), 'danger'));
    }));
    actions.append(action(t('sync.recovery.recover'), async () => {
      requireConnected(); await flushDraft();
      // Only current content and locally available attachments may be promised after loss. The safety archive uses that same explicit coverage.
      const backup = await createBackup({ workspace, storage, coverage: 'current-state-only', appVersion: native?.info.appVersion });
      const document = await openBackup(backup.bytes, { requireCurrent: true });
      const plan = await prepareDatasetRestore({ workspace, storage, fileStore: datasetStore, document, workAreas: workAreas(), recovery: true });
      let safety = null;
      const confirm = action(t('sync.recovery.confirmRecover'), async () => runCloudRestore(text => { message.textContent = text; }, { plan, safety }), 'danger');
      confirm.disabled = true;
      body.replaceChildren(element('p', t('sync.recovery.recoverPreview', { account, cards: backup.manifest.counts.cards, drafts: backup.manifest.counts.drafts })),
        element('p', t('backup.coverage.currentHint')), element('p', t('backup.reset.updateDevices')));
      const password = element('input'); password.type = 'password'; password.autocomplete = 'new-password'; password.maxLength = 1024;
      const passwordLabel = element('label', t('backup.export.password'), 'field'); passwordLabel.append(password); body.append(passwordLabel);
      const save = action(t('backup.restore.saveSafety'), async () => {
        if ([...password.value].length < 12) throw new Error(t('backup.errors.passwordTooShort'));
        const destination = await nativeBackups.manual.chooseDestination({ requireConfirmed: true });
        safety = await saveSafetyBackup({ workspace, storage, password: password.value, coverage: 'current-state-only', appVersion: native.info.appVersion, save: value => destination.save(value) });
        password.value = '';
        confirm.disabled = false; message.textContent = t('backup.restore.safetySaved');
      });
      // A disabled confirmation is also guarded by the opaque safety receipt in plan.stage().
      confirm.onclick = async () => {
        if (busy || !safety) return; busy = true;
        try { await runCloudRestore(text => { message.textContent = text; }, { plan, safety }); }
        catch (error) { message.textContent = error.message; busy = false; }
      };
      actions.replaceChildren(later, save, confirm);
    }));
  }
  dialog.append(element('h2', t('sync.recovery.title')), body, message, actions);
  dialog.oncancel = event => { if (busy) event.preventDefault(); };
  dialog.onclose = () => { dialog.remove(); sourceResetAsked = false; }; document.body.append(dialog); dialog.showModal();
}

async function resetWorkspace(say, { cloud = profileId.startsWith('google:') } = {}) {
  if (cloud) {
    requireConnected();
    return runDatasetChange(async () => {
      const reset = new DatasetReset(datasetStore, storage), pending = await reset.status();
      const preview = !pending || pending.phase === 'complete' ? await reset.preview() : null;
      say(t('sync.reset.marking'));
      await startDatasetReset({ state: workspace.state, storage, fileStore: datasetStore, preview });
    });
  }
  return runDatasetChange(async () => {
    say(t('sync.reset.deletingDevice')); await browserJournal?.reset(profileId); await storage.reset(profileId); return { localReset: true };
  });
}

// A quick edit opens in the Top-layer view of the display that shows most of the paper (SPEC-003, 2026-10-24).
function editorView(cardId, fallback) {
  const rect = workspace.layout.state.placements[cardId]; if (!rect) return fallback;
  const span = (start, size, from, length) => Math.max(0, Math.min(start + size, from + length) - Math.max(start, from));
  const overlap = view => span(rect.x, rect.width, view.viewport.x, view.viewport.width) * span(rect.y, rect.height, view.viewport.y, view.viewport.height);
  const views = (desktopInfo?.views || []).filter(view => view.layer === 'floating' && view.active !== false && overlap(view) > 0);
  return views.sort((a, b) => overlap(b) - overlap(a))[0]?.viewId ?? fallback;
}
// Discarding drops a note's unsaved changes. The status line can bring them back while the note has no newer ones.
async function discardChanges(cardId) {
  const kept = workspace.unsavedChanges(cardId);
  await workspace.discardChanges(cardId);
  if (!kept) { status(t('app.status.closedNoChanges')); return; }
  status(t('app.status.changesDiscarded'), false, { label: t('app.status.undoDiscard'), run: async () => {
    if (currentDraft?.cardId === cardId || workspace.unsavedChanges(cardId)) throw new FleetError('conflict', t('app.status.discardUndoStale'));
    await workspace.saveDraft({ ...kept, id: crypto.randomUUID() });
    await workspace.layout.placeNew(workspace.working, workAreas()); render(); status(t('app.status.changesRestored'));
  } });
}
function currentDesktopEditor() {
  return remoteEditor && currentDraft?.id === remoteEditor.draftId && controller.state.editingCardId === remoteEditor.cardId ? copy(remoteEditor) : null;
}
function initializeDesktop() {
  const authority = new DesktopAuthority({ workspace, controller, sessionId: desktopInfo.sessionId,
    perform: action => desktop.perform(action),
    shortcut: (target, intent) => desktopAction(target, intent),
    check: (id, revision, task) => tickStep(id, revision, task),
    residentLayers: () => residentLayers(),
    liftQuickMove: () => desktopInfo?.liftQuickMove === true,
    arrange: kind => arrangeDesktop(kind),
    attachments: (method, file) => method === 'attachment.preview' ? previewAttachment(file) : openAttachment(file),
    editor: {
      current: currentDesktopEditor,
      begin: async (id, requester) => {
        if (editorBusy || composing || document.querySelector('dialog[open]')) throw new Error(t('app.errors.finishMainEdit'));
        const viewId = editorView(id, requester); const previous = currentDesktopEditor();
        if (previous?.cardId === id && previous.viewId === viewId) return { draftId: previous.draftId, sequence: previous.sequence };
        const reuseId = currentDraft?.cardId === id ? currentDraft.id : null;
        if (currentDraft) {
          if (controller.state.editingCardId) { if (!await controller.endEdit({ keepDraft: Boolean(reuseId) })) throw new Error(t('app.errors.finishInput')); }
          else await flushDraft();
        }
        // A quick edit continues the note's unsaved changes, as the main window's editor does (ADR-061). Where it starts
        // is settled before the paper enters editing, so a refusal leaves no paper editing without an editor.
        const card = currentCard(id); const next = reuseId && currentDraft?.id === reuseId ? currentDraft : workspace.openDraft(card.groupId, card);
        if (!await controller.beginEdit(id, { gesture: true })) return null;
        currentDraft = next; remoteEditor = null;
        await queueDraft(); remoteEditor = { cardId: id, draftId: currentDraft.id, viewId, text: currentDraft.content.text, sequence: 0 };
        render();
        // The scene that asked holds the pointer; the host hands the keyboard to the view that shows the editor.
        void desktop.whenPublished().then(sequence => native.bridge.request('desktop.focusEditor', { viewId, sequence })).catch(() => {});
        return { draftId: remoteEditor.draftId, sequence: 0 };
      },
      change: async value => {
        const draft = copy(currentDraft); draft.content.text = value.text;
        await workspace.saveDraft(draft);
        // The authority's separate draft lane may finish while a lifecycle action is waiting for its flush barrier.
        if (currentDraft?.id !== value.draftId || remoteEditor?.viewId !== value.viewId) throw new Error(t('app.errors.editorMoved'));
        currentDraft = draft; remoteEditor = copy(value);
      },
      save: () => saveEditor(),
      end: () => closeEditor(),
      cancel: () => discardEditor(),
      full: async intent => {
        await flushDraft(); const { id: draftId, cardId } = currentDraft;
        if (!await controller.endEdit({ keepDraft: true })) throw new Error(t('app.errors.finishInput')); remoteEditor = null; currentDraft = null;
        // The main window's editor continues the unsaved changes the quick edit kept; changes holding nothing go first.
        await workspace.discardUnneededDraft(draftId);
        await leaveAdjustOverlay(); await native.bridge.request('desktop.showMain', { intent }); await openEditor(currentCard(cardId) ?? null); render();
      },
    } });
  authority.configureDisplays(desktopInfo.topology ?? 0, desktopInfo.views);
  desktop = new DesktopOwner({ bridge: native.bridge, authority, editor: currentDesktopEditor,
    project: sequence => {
      const frame = projectDesktop({ snapshot: workspace.working, layout: workspace.layout.state, interaction: controller.state,
        sessionId: desktopInfo.sessionId, sequence, topology: desktopInfo.topology ?? 0, workspaceRevision: workspace.state.revision, layers: desktopInfo.layers, residentLayers: residentLayers(), editor: currentDesktopEditor(), notice: desktopNotice,
        quickMove: workspace.layout.state.quickMove === true && quickMoveOffered() ? quickMoveKey(native.info.platform) : null });
      // Settings only speaks up when a paper cannot sit on the layer it asks for.
      const [fallback] = frame.fallbacks; const layerName = layer => stageNames()[groupLayerOrder.indexOf(layer)];
      $('#desktop-note').hidden = !fallback;
      $('#desktop-note').textContent = fallback ? plural('settings.desktop.layerFallback', frame.fallbacks.length,
        { requested: layerName(fallback.requested), effective: layerName(fallback.effective) }) : '';
      return frame;
    },
    changed: () => render(), error: error => status(error.message, true),
    displays: async proposal => {
      controller.cancelDrag();
      // A quick edit closes on a display change and keeps changed text unsaved (ADR-061). An input method still
      // composing keeps it open instead, and its view is carried across the change as before.
      if (controller.state.operationScope.kind === 'none' && controller.state.editingCardId) await controller.endEdit().catch(() => false);
      const result = await workspace.layout.recoverDisplays(proposal.workAreas.map(({ x, y, width, height }) => ({ x, y, width, height })),
        primaryArea(proposal.workAreas));
      const editor = currentDesktopEditor();
      try {
        const info = await native.bridge.request('desktop.displays.apply', { topology: proposal.topology,
          editorViewId: editor?.viewId ?? null, editorRect: editor ? workspace.layout.state.placements[editor.cardId] : null });
        desktopInfo = info; authority.configureDisplays(info.topology, info.views); render();
        if (result.rescued.length) status(plural('app.status.rescued', result.rescued.length));
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
        // A quick edit has no other place to go on (SPEC-003, 2026-10-24): it closes and keeps its unsaved changes.
        if (controller.state.operationScope.kind === 'none' && controller.state.editingCardId === currentDraft.cardId) {
          await queueDraft(); await controller.endEdit({ keepDraft: true }); currentDraft = null; render();
        }
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
  if (!items.length) list.append(element('p', t('app.shareInbox.empty')));
  for (const item of items) {
    const preview = item.preview || t('app.shareInbox.file');
    list.append(button(item.fileCount ? plural('app.shareInbox.itemFiles', item.fileCount, { preview }) : preview, async () => {
      if (captureBusy) return;
      selectedCapture = item.damaged ? item : await captureInbox.item(item.id);
      $('#capture-preview').textContent = selectedCapture.text || selectedCapture.preview || t('app.shareInbox.attachmentsOnly'); $('#capture-preview').hidden = false;
      $('#capture-files').replaceChildren(...(selectedCapture.attachments || []).map(file => element('li', `${file.name} · ${Math.ceil(file.size / 1024)} KiB`)));
      $('#accept-capture').disabled = Boolean(item.damaged); $('#discard-capture').disabled = false;
    }));
  }
}

// Region keys act on the group now in that region; keys for empty regions are not taken from other apps.
function liveShortcuts() { const layout = workspace.layout.state; return resolveShortcuts(layout.shortcuts, layout.grid.slots); }
// Each shortcut row shows only what keeps a key from working; working keys stay quiet. Hosts report registrations
// against the resolved group, so rows match them by key.
function renderShortcutStatus() {
  const labels = { conflict: t('settings.shortcuts.status.conflict'), unavailable: t('settings.shortcuts.status.unavailable'),
    reserved: t('settings.shortcuts.status.reserved'), editing: t('settings.shortcuts.status.editing'), typing: t('settings.shortcuts.status.typing'),
    invalid: t('settings.shortcuts.status.invalid'), unwritten: t('settings.shortcuts.status.unwritten') };
  const layout = workspace.layout.state; const bound = regionShortcuts(layout.shortcuts, layout.grid.slots);
  for (const node of document.querySelectorAll('[data-shortcut-status]')) {
    const items = shortcutStatus.filter(item => bound[item.key] === node.dataset.shortcutStatus);
    const problems = items.filter(item => labels[item.status]);
    node.textContent = problems.map(item => t('settings.shortcuts.keyStatus', { key: item.key, status: labels[item.status] }))
      .join(t('settings.shortcuts.statusSeparator'));
    node.dataset.state = items.map(item => item.status).join(' '); node.classList.toggle('error', problems.length > 0);
  }
  $('#retry-shortcuts').hidden = Boolean(labwcShortcuts) || !shortcutStatus.some(item => ['conflict', 'unavailable'].includes(item.status));
  // labwc has no way for an app to register keys, so its own keybinds run them; the user writes them on purpose.
  $('#labwc-shortcuts').hidden = !labwcShortcuts;
  if (labwcShortcuts) {
    const { path } = labwcShortcuts;
    const notes = { absent: t('settings.shortcuts.labwc.absent', { path }), outdated: t('settings.shortcuts.labwc.outdated', { path }),
      current: t('settings.shortcuts.labwc.current', { path }) };
    $('#labwc-shortcuts-note').textContent = notes[labwcShortcuts.state] || notes.absent;
    $('#labwc-write').textContent = labwcShortcuts.state === 'current' ? t('settings.shortcuts.labwc.rewrite') : t('settings.shortcuts.labwc.write');
  }
}

async function desktopAction(target, intent) {
  if (composing || editorBusy || document.querySelector('dialog[open]')) throw new Error(t('app.errors.finishInputOrDialog'));
  if (target === '@hide') { await flushDraft(); await native.bridge.request('desktop.hideMain'); return; }
  // A Linux named action names a region, which stands for the group it holds now.
  const region = shortcutRegion(target);
  if (region !== null) { target = workspace.layout.state.grid.slots[region - 1]; if (!target) return; }
  if (target === shortcutActions.capture) {
    await leaveAdjustOverlay();
    const shown = desktop ? await native.bridge.request('desktop.showMain', { intent: intent ?? null }) : null;
    // Behind the editor the main window shows where the note goes.
    showToDo(); render();
    await openEditor(); editorHidesMain = Boolean(shown?.activated && shown.hidden && $('#editor-dialog').open); return;
  }
  // Hiding the desktop also closes a quick edit, keeping its draft, as the Settings switch does.
  if (target === shortcutActions.toggle) { await workspace.layout.configure({ desktopVisible: !workspace.layout.state.desktopVisible }, workspace.snapshot); await controller.reconcile(); }
  // A group key moves its group one stage on: wallpaper, desktop, topmost, adjust mode, wallpaper again, skipping a layer
  // this desktop does not offer.
  // Ctrl+Shift+0 keeps its own meaning: every group into adjust mode, then back to each paper's own layer. Papers hidden
  // while locked would not show the first stages and the browser preview has no layers, so there a group key only
  // switches adjust mode.
  else if (target !== shortcutActions.all && target !== '@stop' && desktop && workspace.layout.state.desktopVisible) {
    const layers = residentLayers();
    const stage = await stepGroup({ workspace, controller, groupId: target, wallpaper: layers.includes('wallpaper'), desktop: layers.includes('desktop'), floating: layers.includes('floating') });
    activeGroupId = target; const stages = desktopStages();
    announce(target, stageNames()[stage], stages.indexOf(stage) + 1, stages.length);
    await rememberGroup();
  }
  else {
    const changed = await controller.activate(target === '@stop' ? { kind: 'none' } : target === shortcutActions.all ? { kind: 'all' } : { kind: 'group', groupId: target });
    if (changed && target !== shortcutActions.all && target !== '@stop') { activeGroupId = target; await rememberGroup(); }
    const adjusting = controller.state.operationScope.kind !== 'none';
    if (changed) showCanvas();
    if (changed && desktop && target !== '@stop') {
      announce(target === shortcutActions.all ? null : target, adjusting ? t('app.stages.adjust')
        : target === shortcutActions.all ? t('app.desktop.backToLayers') : t('app.desktop.adjustDone'));
    }
  }
  render();
  if (intent && desktop && target !== shortcutActions.toggle && controller.state.operationScope.kind !== 'none') {
    const sequence = await desktop.whenPublished(); await native.bridge.request('desktop.focus', { intent, sequence });
  }
}

// After a group or all-groups key the topmost scene shows, for about a second and a half, which group moved and where
// it is now, with one dot per stage of the cycle. A newer notice replaces an older one, which then is not cleared early.
const stageNames = () => [t('app.stages.wallpaper'), t('app.stages.desktop'), t('app.stages.floating'), t('app.stages.adjust')];
// Layers a group can rest on; on GNOME Xwayland the topmost scene only carries the adjust overlay.
const residentLayers = () => desktopInfo?.residentLayers || desktopInfo?.layers || [];
// Quick move needs a resting layer that takes clicks; where papers rest only on the wallpaper it is not offered.
const quickMoveOffered = () => residentLayers().some(layer => layer !== 'wallpaper');
const desktopStages = () => [0, 1, 2].filter(stage => residentLayers().includes(groupLayerOrder[stage])).concat(adjustStage);
let desktopNotice = null; let noticeSerial = 0;
function announce(groupId, text, step = 0, steps = 0) {
  const layout = workspace.layout.state; const groups = activeGroups(workspace.snapshot);
  let rect = layout.grid.area;
  try { rect = groupId && gridRegions(layout.grid, groups).find(region => region.groupId === groupId) || rect; } catch { /* Overflowing groups use the whole area. */ }
  const id = ++noticeSerial;
  desktopNotice = { id, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    title: groupId ? groupName(groups.find(group => group.id === groupId)) || t('app.groups.fallback') : t('app.groups.all'), text, step, steps };
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
    status(composing ? t('app.close.finishInput') : t('app.close.finishDialog'), true); return;
  }
  nativeClosing = true; document.body.inert = true; desktop?.beginClose();
  try {
    if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: true });
    await stopMaintenance();
    await Promise.allSettled([...activeActions]);
    stopAutomatic?.(); await automatic?.service.whenIdle();
    if (desktop) { await desktop.whenIdle(); await desktop.perform(flushDraft); } else await flushDraft();
    if (desktop) { desktop.sealClose(); await desktop.whenIdle(); }
    if (unsavedDrafts.size) throw new Error(t('app.close.unsavedDrafts'));
    await native.bridge.request('host.closeReady');
  } catch (error) {
    await desktop?.cancelClose();
    await native.bridge.request('host.closeCancel').catch(() => {});
    if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: false }).catch(() => {});
    if (automatic) stopAutomatic = startAutomaticBackup(automatic.service);
    status(t('app.close.failed', { error: error.message }), true);
  }
  finally { nativeClosing = false; document.body.inert = false; maintenanceAbort = new AbortController(); scheduleMaintenance(); }
}

function renderGroupList(snapshot, layout, groups) {
  $('#groups').replaceChildren(); const reorderable = groups.every(group => layout.grid.slots.includes(group.id));
  for (const group of groups) {
    const row = element('div', undefined, `group-row${group.id === activeGroupId ? ' active' : ''}`);
    row.dataset.groupId = group.id;
    const choose = button('', async () => { activeGroupId = group.id; setDrawer(false); render(); await rememberGroup(); });
    const dot = element('span', undefined, 'group-dot'); dot.style.setProperty('--group-color', groupColor(group.id));
    choose.append(dot);
    if (myGroupOf(layout) === group.id) choose.append(sidebarMark(icon(starPath), 'group-star', t('app.groups.myGroupMark')));
    choose.append(element('span', groupName(group), 'group-name'));
    if (desktopInfo) choose.append(layerMark(groupLayer(layout, group.id)));
    choose.append(element('span', String(snapshot.cards.filter(card => card.groupId === group.id && !card.deleted && !card.archived).length), 'group-count'));
    // Groups move only while every group holds a region; past nine, regions cannot take a new order until a merge.
    if (reorderable) {
      row.classList.add('reorderable'); choose.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
      const grip = element('span', undefined, 'group-grip'); grip.setAttribute('aria-hidden', 'true');
      grip.append(icon('M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01')); row.append(grip);
    }
    row.append(choose, button('⋯', () => groupEditor(group), 'group-menu')); $('#groups').append(row);
  }
}

// Small marks in a group row: a star for My group, and on desktop computers the layer the group's papers rest on.
const starPath = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z';
// Three plates stacked back to front from the bottom; the group's plate is filled.
const layerPlates = { floating: 'M12 2.5 20 5.5 12 8.5 4 5.5Z', desktop: 'M12 9 20 12 12 15 4 12Z', wallpaper: 'M12 15.5 20 18.5 12 21.5 4 18.5Z' };
function sidebarMark(svg, className, label, tooltip = label) {
  const mark = element('span', undefined, className); mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', label);
  mark.title = tooltip; mark.append(svg); return mark;
}
// A layer this desktop cannot rest papers on shows where the papers really are; the tooltip says why, while screen
// readers hear only the layer's name inside the row's button.
function layerMark(layer) {
  const shown = restingLayer(layer, residentLayers()); const name = value => stageNames()[groupLayerOrder.indexOf(value)];
  const svg = icon(...Object.values(layerPlates));
  Object.keys(layerPlates).forEach((plate, index) => svg.children[index].classList.toggle('current', plate === shown));
  return sidebarMark(svg, 'group-layer', name(shown),
    shown === layer ? name(layer) : t('app.groupEditor.layerUnsupported', { layer: name(layer), fallback: name(shown) }));
}

// Dragging a group row reorders the regions, so the list, the desktop regions and the region keys keep one order;
// papers stay where they are. A mouse drags the whole row. A finger drags the grip at once, or the rest of the row once
// held still for a moment, as phone lists do; a finger that moves first scrolls the drawer.
let groupDrag = null; let groupDragClick = false; const groupHold = 350;
function reorderGroups(ids) {
  return run(async () => {
    const grid = workspace.layout.state.grid; const held = grid.slots.filter(Boolean);
    // A group that arrived during the drag goes last, and one that left drops out.
    const order = [...ids.filter(id => held.includes(id)), ...held.filter(id => !ids.includes(id))];
    // A refused order must not leave the rows where they were dropped.
    try { if (order.some((id, index) => id !== held[index])) await workspace.layout.configure({ grid: reorderSlots(grid, order) }, workspace.snapshot); }
    finally { render(); }
    // Region keys now act on other groups; say which, since nothing on screen shows it. Phones have no keys.
    const layout = workspace.layout.state; const changes = handheld ? [] : regionKeyChanges(layout.shortcuts, grid.slots, layout.grid.slots);
    if (changes.length) toast(t('app.groups.keysMoved'), changes.map(({ keys, groupId }) => t('app.groups.keyMoved',
      { keys: keys.join(t('app.groups.keySeparator')), group: groupName(activeGroups(workspace.snapshot).find(group => group.id === groupId)) })));
  });
}
function startGroupDrag(event) {
  const row = event.target.closest('.group-row.reorderable');
  if (!row || event.button !== 0 || groupDrag?.active || event.target.closest('.group-menu')) return;
  groupDrag = { pointerId: event.pointerId, row, startX: event.clientX, startY: event.clientY, active: false };
  if (event.pointerType !== 'touch') return;
  if (event.target.closest('.group-grip')) { activateGroupDrag(); return; }
  const drag = groupDrag; drag.hold = setTimeout(() => { if (groupDrag === drag) activateGroupDrag(); }, groupHold);
}
function activateGroupDrag() {
  // A render since the press replaced the row; the next press starts afresh.
  if (!groupDrag.row.isConnected) { clearTimeout(groupDrag.hold); groupDrag = null; return false; }
  // Capturing only now leaves a plain click on the row's own button.
  groupDrag.active = true; $('#groups').setPointerCapture(groupDrag.pointerId); getSelection()?.removeAllRanges();
  groupDrag.row.classList.add('dragging'); document.body.classList.add('group-dragging');
  return true;
}
function moveGroupDrag(event) {
  if (groupDrag?.pointerId !== event.pointerId) return;
  // A press released outside the list never reached it; hovering back must not start a drag.
  if (!(event.buttons & 1)) { endGroupDrag(event, false); return; }
  if (!groupDrag.active) {
    // A finger that moves before the hold ends is scrolling the drawer.
    if (groupDrag.hold) {
      if (Math.hypot(event.clientX - groupDrag.startX, event.clientY - groupDrag.startY) > 8) endGroupDrag(event, false);
      return;
    }
    if (Math.abs(event.clientY - groupDrag.startY) < 5 || !activateGroupDrag()) return;
  }
  event.preventDefault();
  const rows = [...$('#groups').querySelectorAll('.group-row.reorderable')].filter(row => row !== groupDrag.row);
  const before = rows.find(row => { const box = row.getBoundingClientRect(); return event.clientY < box.top + box.height / 2; });
  const end = $('#groups').querySelector('.group-row:not(.reorderable)');
  const target = before || end;
  if (groupDrag.row.nextElementSibling !== target) $('#groups').insertBefore(groupDrag.row, target);
}
function endGroupDrag(event, dropped) {
  if (groupDrag?.pointerId !== event.pointerId) return;
  const { active, row, hold } = groupDrag; groupDrag = null; clearTimeout(hold);
  if (!active) return;
  row.classList.remove('dragging'); document.body.classList.remove('group-dragging');
  // The click that ends a drag must not also choose the group.
  groupDragClick = true; setTimeout(() => { groupDragClick = false; }, 0);
  if (dropped) void reorderGroups([...$('#groups').querySelectorAll('.group-row.reorderable')].map(node => node.dataset.groupId));
  else render();
}
// Alt+Up and Alt+Down move the focused group one place, for keyboards.
function stepGroupOrder(event) {
  const row = event.target.closest('.group-row.reorderable');
  if (!row || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const ids = shownGroups().map(group => group.id).filter(id => workspace.layout.state.grid.slots.includes(id));
  const from = ids.indexOf(row.dataset.groupId); const to = from + (event.key === 'ArrowUp' ? -1 : 1);
  if (from < 0 || to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  const moved = row.dataset.groupId;
  void reorderGroups(ids).then(() => $('#groups').querySelector(`.group-row[data-group-id="${CSS.escape(moved)}"] button`)?.focus());
}

// A mouse drags a board paper or list row onto another group in the sidebar to move it there. A click, a double-click
// and ticking a step stay as they were; touch and the phone layout, whose sidebar is a closed drawer, keep "More
// actions" > "Move to group", as keyboards do. The list holds the capture, since a render may replace the note.
let noteDrag = null;
function startNoteDrag(event) {
  const note = event.target.closest('.movable');
  if (!note || noteDrag || event.button !== 0 || event.pointerType !== 'mouse' || narrow.matches
    || event.target.closest('a,button,input,select,textarea,.attachment-tile')) return;
  noteDrag = { pointerId: event.pointerId, cardId: note.dataset.cardId, x: event.clientX, y: event.clientY, active: false };
}
function moveNoteDrag(event) {
  if (noteDrag?.pointerId !== event.pointerId) return;
  if (!(event.buttons & 1)) { endNoteDrag(event, false); return; }
  const card = currentCard(noteDrag.cardId);
  if (!noteDrag.active) {
    if (Math.hypot(event.clientX - noteDrag.x, event.clientY - noteDrag.y) < 5) return;
    if (!card || card.deleted) { noteDrag = null; return; }
    noteDrag.active = true; $('#list').setPointerCapture(event.pointerId); getSelection()?.removeAllRanges();
    noteDrag.ghost = element('div', undefined, 'note-ghost'); noteDrag.ghost.style.setProperty('--paper', groupColor(card.groupId));
    noteDrag.ghost.append(element('span', summaryText(card)), element('span', '', 'ghost-target'));
    document.body.append(noteDrag.ghost); document.body.classList.add('note-dragging');
    $('#list').querySelector(`[data-card-id="${CSS.escape(card.id)}"]`)?.classList.add('dragging');
  }
  event.preventDefault();
  noteDrag.ghost.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 14}px)`;
  // Only another group takes the note; the label names the group, so colour is not the only sign.
  const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('#groups .group-row');
  const target = row && card && row.dataset.groupId !== card.groupId ? row : null;
  $('#groups').querySelectorAll('.group-row').forEach(node => node.classList.toggle('receiving', node === target));
  noteDrag.groupId = target?.dataset.groupId ?? null;
  noteDrag.ghost.lastChild.textContent = target ? t('app.stage.moveTo', { group: groupName(activeGroups(workspace.snapshot).find(group => group.id === noteDrag.groupId)) }) : '';
}
function endNoteDrag(event, dropped) {
  if (noteDrag?.pointerId !== event.pointerId) return;
  const { active, ghost, cardId, groupId } = noteDrag; noteDrag = null;
  if (!active) return;
  ghost.remove(); document.body.classList.remove('note-dragging');
  document.querySelectorAll('.group-row.receiving, #list .dragging').forEach(node => node.classList.remove('receiving', 'dragging'));
  if (dropped && groupId) void run(() => moveNoteToGroup(cardId, groupId));
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
  const snapshot = workspace.working; const layout = workspace.layout.state; const groups = shownGroups();
  if (!groups.some(group => group.id === activeGroupId)) activeGroupId = mainGroup(layout, groups);
  // A row being dragged stays where the pointer holds it; the drop renders the list again.
  if (!groupDrag?.active) renderGroupList(snapshot, layout, groups);
  const query = $('#search').value.trim().toLocaleLowerCase();
  // Filters and search look through papers the desktop does not show, so they always use the board or the list.
  const notesShown = !showDesktop || filter !== 'active' || Boolean(query); const view = notesShown ? mainView(layout) : 'desktop';
  // Search looks through every group, so the title stops naming the selected one while it has text.
  $('#workspace-title').textContent = query ? t('app.search.title')
    : notesShown ? groupName(groups.find(group => group.id === activeGroupId)) || t('app.groups.defaultName')
      : desktopInfo ? t('app.views.layoutMap') : t('app.views.desktopTitle');
  // Capture adds to the selected group's To do, so it shows only while that is what is shown: not under another
  // filter, a search or the canvas and layout map of every group.
  $('#compose').hidden = filter !== 'active' || Boolean(query) || view === 'desktop';
  $('#empty-trash').hidden = filter !== 'deleted';
  $('#empty-trash').disabled = !snapshot.cards.some(card => card.deleted);
  renderCounts();
  // Locked is the everyday state and shows nothing; adjust mode replaces the view bar with its own bar until Done.
  const scope = controller.state.operationScope; const adjusting = scope.kind !== 'none';
  $('main').classList.toggle('adjusting', adjusting); $('main').classList.toggle('desktop-shown', view === 'desktop');
  $('#adjust-bar').hidden = handheld || !adjusting; $('#stop-operation').hidden = !adjusting;
  // Search would swap the canvas being adjusted for the list, so it waits until Done. Desktop hosts adjust on the
  // desktop itself and keep it.
  const canvasAdjust = adjusting && !desktopInfo; $('#search').disabled = canvasAdjust; $('#search-toggle').disabled = canvasAdjust;
  $('#mode-label').textContent = !adjusting ? '' : scope.kind === 'all' ? t('app.mode.adjustingAll')
    : t('app.mode.adjustingGroup', { group: groupName(groups.find(group => group.id === scope.groupId)) || t('app.groups.fallback') });
  const desktopLabel = desktopInfo ? t('app.views.layoutMap') : t('app.views.desktop');
  $('#desktop-view-label').textContent = desktopLabel; $('[data-view="desktop"]').title = desktopLabel;
  document.querySelectorAll('[data-view]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.view === view)));
  // With real desktop scenes the main window never mirrors them; its desktop view is the layout map.
  $('#stage-shell').hidden = notesShown || Boolean(desktopInfo); $('#layout-map').hidden = notesShown || !desktopInfo; $('#list').hidden = !notesShown;
  document.querySelectorAll('[data-filter]').forEach(node => node.classList.toggle('active', node.dataset.filter === filter));
  const cards = rankSearch(snapshot.cards.filter(matchesFilter), query);
  const listCards = cards.filter(card => query || card.groupId === activeGroupId);
  const shown = snapshot.cards.filter(card => cardPolicy(card, layout, controller.state).visible).length;
  const hidden = shown ? 0 : snapshot.cards.filter(card => eligible(card, layout)).length;
  $('#count').textContent = notesShown ? plural('app.count.notes', listCards.length) : plural('app.count.desktopNotes', shown);
  if (notesShown) renderNotes(listCards, view, Boolean(query));
  else if (desktopInfo) renderLayoutMap();
  else renderStage(snapshot.cards);
  // Completed papers this device hides are still notes, so they never bring up the first-note prompt.
  const withCompleted = { ...layout, completedVisible: true };
  $('#empty').hidden = snapshot.cards.some(card => eligible(card, withCompleted));
  $('#desktop-hidden').hidden = handheld || !hidden || filter !== 'active' || Boolean(query);
  $('#desktop-hidden-text').textContent = plural('app.desktopHidden.text', hidden);
  desktop?.publish(); syncAdjustOverlay(); fitBars();
}

// Where adjust mode is a modal overlay (every desktop host), a focused main window steps aside while it is on
// and returns after any exit; one that was minimized or behind another app stays as it was. The focus is read before
// the overlay maps and takes it. Hiding waits for the overlay frame and showing for the frame without it, so one window
// always stays on screen and the returning main window is not stacked under a still-mapped overlay.
let adjustMain = { adjusting: false, aside: false }; let adjustSync = Promise.resolve();
const adjustOverlayActive = () => Boolean(desktopInfo?.adjustOverlay && controller.state.operationScope.kind !== 'none');
function syncAdjustOverlay() {
  // Read focus before making the owner inert: only the desktop scene accepts input during its modal adjustment.
  const focused = document.hasFocus(); document.documentElement.inert = adjustOverlayActive();
  if (!desktop || !desktopInfo?.adjustOverlay) return;
  const step = overlayMainStep(adjustMain, controller.state.operationScope.kind !== 'none', focused);
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
// The overlay's Stack and Spread apply to the adjusted scope at once, keeping sizes; Undo undoes like the main window.
async function arrangeDesktop(kind) {
  if (kind === 'undo') { await workspace.undo(workAreas()); await controller.reconcile(); render(); status(t('app.status.undone')); return null; }
  const scope = controller.state.operationScope;
  const plan = formationPlan(kind, scope.kind === 'all' ? { kind: 'all' } : { kind: 'group', groupId: scope.groupId }, false);
  await controller.applyFormation(plan); render(); status(t('app.status.arranged')); return null;
}

// Conflicts show in the status bar only while there are some; version history stays in Settings. Unsaved changes show
// on their notes (ADR-061).
function renderCounts() {
  const state = workspace.state;
  const conflictCount = state.conflicts.length + Object.values(state.drafts).filter(draft => draft.purged).length;
  $('#conflict-count').textContent = plural('app.conflicts.count', conflictCount); $('#conflicts-button').hidden = !conflictCount;
  $('#settings-conflict-count').textContent = String(conflictCount); $('#settings-conflict-count').hidden = !conflictCount;
}

function renderStage(cards) {
  for (const close of stageAttachmentCleanup.splice(0)) close();
  stageFitter.clear(); const stage = $('#stage'); stage.replaceChildren(); groupLabels = [];
  if (desktopInfo) { const area = screenArea(); stage.style.transform = `translate(${-area.x}px, ${-area.y}px)`; }
  const layout = workspace.layout.state; const state = controller.state;
  let regions = [];
  try { regions = gridRegions(layout.grid, activeGroups(workspace.snapshot)); } catch (error) { status(error.message, true); }
  for (const region of regions.filter(region => region.groupId)) {
    const group = activeGroups(workspace.snapshot).find(group => group.id === region.groupId);
    const boundary = element('div', undefined, 'region'); boundary.dataset.groupId = group.id;
    rectStyle(boundary, region); stage.append(boundary);
    const label = element('div', groupName(group), 'region-label'); label.dataset.groupId = group.id;
    label.style.left = `${region.x + 8}px`; label.style.top = `${region.y + 5}px`; stage.append(label);
    groupLabels.push({ groupId: group.id, x: region.x + 8, y: region.y + 5, width: Math.max(84, label.offsetWidth), height: 30 });
  }
  let z = 5;
  for (const card of sceneOrder(cards, layout, state)) {
    const policy = cardPolicy(card, layout, state); const placement = layout.placements[card.id];
    if (!policy.visible || !placement) continue;
    const paper = element('article', undefined, 'card'); paper.dataset.cardId = card.id;
    paper.classList.toggle('operable', policy.draggable); paper.classList.toggle('selectable', !policy.draggable && policy.interactive);
    paper.classList.toggle('selected', state.selectedCardId === card.id); paper.classList.toggle('mine', myGroupOf(layout) === card.groupId);
    paper.classList.toggle('completed', card.completed);
    paper.style.setProperty('--paper', groupColor(card.groupId)); paper.style.zIndex = String(z++); rectStyle(paper, placement);
    const summary = element('div', summaryText(card), 'card-summary'); if (card.unsaved) summary.append(unsavedDot());
    paper.append(summary);
    const body = element('div', undefined, 'card-body markdown');
    // The canvas stands in for the desktop, so papers that take clicks tick their steps there too.
    // Its boxes wait while a tick saves, so a second quick click cannot tick from the same, soon outdated revision.
    renderMarkdown(body, card.content.text, policy.interactive ? { onToggle: task => {
      for (const box of body.querySelectorAll('input[type="checkbox"]')) box.disabled = true;
      run(() => tickStep(card.id, card.revision, task).catch(error => { render(); throw error; }));
    } } : {});
    paper.append(body); stageFitter.observe(body);
    const strip = attachmentStrip(card.content.attachments || [], stageAttachmentCleanup, stageFitter); if (strip) paper.append(strip);
    // Adjust mode only arranges (SPEC-003, 2026-10-24): an adjusted paper has no Edit or "⋯" and opens no editor.
    if (policy.draggable) { paper.tabIndex = 0; paper.setAttribute('aria-label', paperLabel(card)); }
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
// A filled dot marks a note with unsaved changes, like a text editor's unsaved tab (ADR-061).
function unsavedDot() {
  const dot = element('span', undefined, 'unsaved-dot'); dot.title = t('app.notes.unsaved');
  dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', t('app.notes.unsaved')); return dot;
}
const paperLabel = card => card.unsaved ? t('app.notes.unsavedLabel', { note: summaryText(card) }) : summaryText(card);

// The board shows each paper as the 240 px square a new desktop paper is, however wide the window, until the phone
// layout's two columns take over at 640 px; the list keeps one row per paper.
function renderNotes(cards, view, acrossGroups) {
  for (const close of noteAttachmentCleanup.splice(0)) close();
  boardFitter.clear(); const list = $('#list'); list.replaceChildren(); list.setAttribute('aria-label', view === 'list' ? t('app.views.listLabel') : t('app.views.boardLabel'));
  if (!cards.length) { list.append(element('p', t('app.notes.empty'), 'hint')); return; }
  const groups = activeGroups(workspace.snapshot); const myGroupId = myGroupOf(workspace.layout.state);
  const holder = element('div', undefined, view === 'list' ? 'note-list' : 'board');
  for (const card of cards) {
    const title = summaryText(card);
    const note = element('article', undefined, view === 'list' ? 'note-row' : 'note-paper'); note.dataset.cardId = card.id;
    note.style.setProperty('--paper', groupColor(card.groupId));
    note.classList.toggle('completed', card.completed); note.classList.toggle('mine', myGroupId === card.groupId);
    // A board paper ticks its checklist steps in place, as the desktop papers do; its boxes wait while a tick saves.
    const body = element('div', undefined, 'note-body markdown');
    renderMarkdown(body, card.content.text, { highlight: view !== 'list', ...card.deleted ? {} : { onToggle: task => {
      for (const box of body.querySelectorAll('input[type="checkbox"]')) box.disabled = true;
      run(() => tickStep(card.id, card.revision, task).catch(error => { render(); throw error; }));
    } } });
    const meta = element('div', undefined, 'note-meta');
    const { done, total } = checklistProgress(card.content.text); const files = card.content.attachments?.length || 0;
    if (total) meta.append(element('span', plural('app.count.steps', total, { done })));
    if (files) meta.append(element('span', plural('app.count.attachments', files)));
    if (acrossGroups) meta.append(element('span', groupName(groups.find(group => group.id === card.groupId)) || t('app.groups.pendingSync')));
    const actions = element('div', undefined, 'note-actions');
    if (card.deleted) actions.append(button(t('app.notes.restore'), async () => { await workspace.restoreCard(card.id, card.revision); render(); status(t('app.status.restored')); }),
      button(t('app.purge.title'), () => confirmPurge([card.id]), 'danger'));
    else {
      // A note never saved has no revision to complete, move or delete yet (ADR-061); its editor saves or discards it.
      if (card.revision) {
        actions.append(iconButton(card.completed ? t('app.notes.markToDo') : t('app.notes.markCompleted'), card.completed ? ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'] : ['m5 12.5 4.5 4.5L19 7'],
          () => changeCard(card.id, { completed: !card.completed })),
        iconButton(t('app.notes.more'), ['M5.5 12h.01M12 12h.01M18.5 12h.01'], () => cardDetails(card, { edit: true })));
        note.classList.add('movable');
      }
      note.tabIndex = 0; note.setAttribute('aria-label', paperLabel(card));
      // A mouse opens the editor with a double-click, so a click that misses a checkbox opens nothing; a tap still opens
      // it, as phones have no double tap. Enter, Space and "More actions" > Edit open it too.
      // A click without a pointer (detail 0) comes from assistive technology and opens it as well. The editor starts from
      // the note as it is now, which a tick may have changed since this paper was drawn.
      let tapped = false; const opens = event => !event.target.closest('a,button,input');
      const edit = () => run(() => openEditor(currentCard(card.id) ?? card));
      note.onpointerdown = event => { tapped = event.pointerType === 'touch' || event.pointerType === 'pen'; };
      note.onmousedown = event => { if (event.detail > 1 && opens(event)) event.preventDefault(); };
      note.onclick = event => { if ((tapped || event.detail === 0) && opens(event)) edit(); };
      note.ondblclick = event => { if (!tapped && opens(event)) edit(); };
      note.onkeydown = event => { if (event.target === note && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); edit(); } };
    }
    const heading = element('h3', title, 'note-title'); if (card.unsaved) heading.append(unsavedDot());
    if (view === 'list') {
      const text = element('div', undefined, 'note-text');
      // A paper without its own title shows its first line as the title, so the excerpt starts after it.
      const plain = body.textContent.replace(/\s+/g, ' ').trim();
      text.append(heading, element('div', !card.content.title && plain.startsWith(title) ? plain.slice(title.length).trim() : plain, 'note-excerpt'));
      note.append(element('span', undefined, 'note-swatch'), text, meta, actions);
    } else {
      const foot = element('div', undefined, 'note-foot'); foot.append(meta, actions);
      note.append(heading, body); boardFitter.observe(body);
      const strip = attachmentStrip(card.content.attachments || [], noteAttachmentCleanup, boardFitter); if (strip) note.append(strip);
      note.append(foot);
    }
    holder.append(note);
  }
  list.append(holder);
}

async function changeCard(id, patch) {
  const card = currentCard(id); await workspace.updateCard(id, patch, card.revision);
  await controller.reconcile(); render(); status(t('app.status.savedLocally'));
}
// A checkbox on a paper ticks that step in place. A note with unsaved changes shows them, so the tick changes them and
// the note stays unsaved; a saved note gets a new revision (ADR-061). A note open in an editor (its first write may still
// be on the way to disk) waits until the editor closes.
async function tickStep(id, revision, task) {
  const card = currentCard(id);
  if (!card || card.revision !== revision) throw new FleetError('desktop-expired', t('errors.desktop.noteChanged'));
  if (currentDraft?.cardId === id) throw new FleetError('note-editing', t('errors.desktop.noteEditing'));
  const kept = workspace.unsavedChanges(id);
  if (kept) {
    await workspace.saveDraft({ ...kept, content: { ...kept.content, text: toggleChecklist(kept.content.text, task) } });
    render(); status(t('app.status.tickedUnsaved')); return;
  }
  await workspace.updateCard(id, { content: { ...card.content, text: toggleChecklist(card.content.text, task) } }, revision);
  await controller.reconcile(); render(); status(t('app.status.savedLocally'));
}

// Deleting asks nothing, as the status line offers to undo it and Deleted keeps the note. A note's unsaved changes go
// with it, so "More actions" asks first for such a note (ADR-061); undoing the delete brings both back.
async function deleteCard(id) {
  // A quick edit open on the note keeps its last text first, so that text goes with the delete instead of coming back.
  if (currentDraft?.cardId === id && controller.state.editingCardId === id) {
    if (!await controller.endEdit({ keepDraft: true })) throw new Error(t('app.errors.finishInput'));
    currentDraft = null; remoteEditor = null;
  }
  const kept = workspace.unsavedChanges(id);
  const deleted = await workspace.updateCard(id, { deleted: true }, currentCard(id).revision);
  if (kept) await workspace.discardChanges(id);
  await controller.reconcile(); render();
  status(t('app.status.deleted'), false, { label: t('app.status.undoDelete'), run: async () => {
    await workspace.restoreCard(id, deleted.revision);
    if (kept && !workspace.unsavedChanges(id)) await workspace.saveDraft({ ...kept, id: crypto.randomUUID() });
    render(); status(t('app.status.restored'));
  } });
}
// Asks before an action that also throws away unsaved changes, outside the action queue so the desktop is not held up
// while the question is open. Resolves true when confirmed.
function confirmAction(title, text, label) {
  return new Promise(resolve => {
    const dialog = element('dialog'); dialog.id = 'confirm-dialog'; let confirmed = false;
    const confirm = element('button', label, 'danger'); confirm.type = 'button'; confirm.onclick = () => { confirmed = true; dialog.close(); };
    const cancel = element('button', t('common.cancel')); cancel.type = 'button'; cancel.onclick = () => dialog.close();
    const actions = element('div', undefined, 'dialog-actions'); actions.append(cancel, confirm);
    dialog.append(element('h2', title), element('p', text), actions);
    dialog.addEventListener('close', () => { dialog.remove(); resolve(confirmed); }); document.body.append(dialog); dialog.showModal(); cancel.focus();
  });
}

// A note dropped on a sidebar group moves with the same command as "More actions" > "Move to group": a new version of
// the same note, its desktop paper where it was. Undo moves it back only while no other move has happened since.
async function moveNoteToGroup(id, groupId) {
  const from = currentCard(id).groupId; const nameOf = groupId => groupName(activeGroups(workspace.snapshot).find(group => group.id === groupId));
  await controller.moveToGroup(id, groupId); await controller.reconcile(); render();
  status(t('app.status.movedTo', { group: nameOf(groupId) }), false, { label: t('app.status.undoMove'), run: async () => {
    if (currentCard(id)?.groupId !== groupId) throw new FleetError('conflict', t('app.status.moveUndoStale'));
    await controller.moveToGroup(id, from); await controller.reconcile(); render(); status(t('app.status.undone'));
  } });
}

function groupEditor(group) {
  const dialog = element('dialog'); const form = element('form');
  const title = element('h2', group ? t('app.groupEditor.editTitle') : t('app.groupEditor.newTitle'));
  const label = element('label', t('app.groupEditor.name'), 'field'); const input = element('input'); input.required = true; input.maxLength = 80; input.value = groupName(group); label.append(input);
  // Which desktop layer the group sits on belongs to this computer; phones and the browser preview have no desktop layers.
  const layerField = desktop ? element('label', t('app.groupEditor.layer'), 'field') : null; const layers = element('select');
  // A new group is created on the back layer, so the dialog starts there too.
  const currentLayer = group ? groupLayer(workspace.layout.state, group.id) : arrivalLayer(residentLayers()) ?? 'desktop';
  if (layerField) {
    // A layer this desktop cannot rest papers on says so and names where they show instead, as the desktop note does.
    const stageName = value => stageNames()[groupLayerOrder.indexOf(value)];
    for (const [value, name] of [['wallpaper', t('app.groupEditor.layerWallpaper')], ['desktop', t('app.groupEditor.layerDesktop')], ['floating', t('app.groupEditor.layerFloating')]]) {
      const supported = residentLayers().includes(value);
      const option = new Option(supported ? name : t('app.groupEditor.layerUnsupported', { layer: stageName(value), fallback: stageName(restingLayer(value, residentLayers())) }), value);
      option.disabled = !supported && currentLayer !== value; layers.append(option);
    }
    layers.value = currentLayer; layerField.append(layers);
  }
  // The colour is this device's too. A new group is offered the colour it would take; choosing one another group wears
  // swaps the two, and each swatch names the group that wears it.
  const peers = activeGroups(workspace.snapshot).filter(item => item.id !== group?.id);
  const settled = settleGroupColors(workspace.layout.state.groupColors, group ? activeGroups(workspace.snapshot) : [...peers, { id: '' }]);
  const colorAtOpen = settled[group?.id ?? '']; const colorField = element('fieldset', undefined, 'field color-field');
  colorField.append(element('legend', t('app.groupEditor.color')));
  const swatches = element('div', undefined, 'swatches');
  colorNames().forEach((name, index) => {
    const wearer = peers.find(item => settled[item.id] === index);
    const swatch = element('label', undefined, 'swatch'); swatch.title = wearer ? t('app.groupEditor.colorWorn', { color: name, group: groupName(wearer) }) : name;
    const radio = element('input'); radio.type = 'radio'; radio.name = 'group-color'; radio.value = String(index); radio.checked = index === colorAtOpen;
    radio.setAttribute('aria-label', swatch.title);
    const chip = element('span'); chip.style.setProperty('--swatch', groupColors[index]); chip.classList.toggle('worn', Boolean(wearer));
    swatch.append(radio, chip); swatches.append(swatch);
  });
  colorField.append(swatches);
  // Papers resting on the Top layer can let the work beneath them show through; this desktop must offer that layer.
  const opacityAtOpen = group ? groupOpacity(workspace.layout.state, group.id) : 1;
  const opacityField = desktop && residentLayers().includes('floating') ? element('label', t('app.groupEditor.opacity'), 'field opacity-field') : null;
  const opacity = element('input'); opacity.type = 'range'; opacity.min = String(MIN_OPACITY * 100); opacity.max = '100'; opacity.step = '5';
  opacity.value = String(Math.round(opacityAtOpen * 100)); opacity.name = 'group-opacity';
  // The slider moves in fives, so a stored 0.33 shows as 35%; only moving it changes the setting.
  const opacityShown = opacity.value;
  const opacityValue = element('output'); const showOpacity = () => { opacityValue.textContent = t('app.groupEditor.opacityValue', { percent: opacity.value }); };
  opacity.oninput = showOpacity; showOpacity();
  if (opacityField) { const row = element('span', undefined, 'opacity-row'); row.append(opacity, opacityValue); opacityField.append(row); }
  const actions = element('div', undefined, 'dialog-actions');
  const save = element('button', t('common.save'), 'primary'); save.type = 'submit';
  if (group) {
    const merge = button(t('app.groupEditor.merge'), () => { dialog.close(); return openGroupMerge(group); });
    merge.disabled = activeGroups(workspace.snapshot).length < 2; actions.append(merge);
  }
  actions.append(button(t('common.cancel'), () => dialog.close()), save);
  form.append(title, label, colorField, ...layerField ? [layerField, element('p', t('app.groupEditor.layerHint'), 'hint')] : [],
    ...opacityField ? [opacityField, element('p', t('app.groupEditor.opacityHint'), 'hint')] : [], actions); dialog.append(form); document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', event => { event.preventDefault(); run(async () => {
    let groupId = group?.id;
    // A name left as shown is not renamed: a default name keeps following the UI language, and changing only this
    // device's layer neither syncs a group revision nor fails on a group that is in conflict.
    if (group) { if (input.value.trim() !== groupName(group)) await workspace.renameGroup(group.id, input.value, group.revision); }
    else { const created = await workspace.createGroup(input.value); activeGroupId = groupId = created.id; await rememberGroup(); }
    // A new group already took a layer and a colour when it was created; the dialog only guessed them at opening. Only
    // a choice the user changed is applied, so a sync landing meanwhile cannot make an untouched guess repaint a group.
    const layerNow = group ? currentLayer : groupLayer(workspace.layout.state, groupId);
    if (layerField && layers.value !== currentLayer && layers.value !== layerNow) await workspace.layout.setGroupLayer(groupId, layers.value, workspace.snapshot);
    const chosen = Number(form.elements['group-color'].value);
    const colorNow = group ? colorAtOpen : workspace.layout.state.groupColors?.[groupId];
    if (chosen !== colorAtOpen && chosen !== colorNow) await workspace.layout.setGroupColor(groupId, chosen, workspace.snapshot);
    if (opacityField && opacity.value !== opacityShown) await workspace.layout.setGroupOpacity(groupId, Number(opacity.value) / 100, workspace.snapshot);
    await workspace.layout.placeNew(workspace.working, workAreas()); dialog.close(); render(); status(t('app.status.groupSaved'));
  }); });
  dialog.showModal(); input.focus();
}

async function openGroupMerge(group) {
  if (!await controller.endEdit()) throw new Error(t('app.errors.finishTextInput'));
  currentDraft = null; render();
  const dialog = element('dialog'); dialog.id = 'merge-dialog'; dialog.append(element('h2', t('app.merge.title', { group: groupName(group) })));
  const field = element('label', t('app.groups.receiving'), 'field'); const select = element('select'); select.id = 'merge-target';
  select.append(new Option(t('app.merge.choose'), ''));
  for (const target of shownGroups().filter(item => item.id !== group.id)) select.append(new Option(groupName(target), target.id));
  field.append(select);
  const message = element('p'); message.id = 'merge-message'; message.setAttribute('role', 'status');
  const items = element('ul', undefined, 'merge-preview'); const actions = element('div', undefined, 'dialog-actions');
  let preview; let busy = false;
  const apply = button(t('app.merge.confirm'), async () => {
    if (!preview || busy) return;
    busy = true; apply.disabled = true; select.disabled = true; cancel.disabled = true;
    try {
      await workspace.mergeGroup(preview); await controller.reconcile();
      if (activeGroupId === group.id) activeGroupId = preview.targetId;
      dialog.close(); render(); status(t('app.status.groupMerged'));
    } catch (error) { message.textContent = error.message; preview = null; }
    finally { busy = false; select.disabled = false; cancel.disabled = false; }
  }, 'primary'); apply.disabled = true;
  const cancel = button(t('common.cancel'), () => { if (!busy) dialog.close(); });
  const refresh = () => {
    if (busy) return;
    items.replaceChildren(); preview = null; apply.disabled = true;
    if (!select.value) { message.textContent = t('app.merge.chooseHint'); return; }
    try {
      preview = workspace.previewGroupMerge(group.id, select.value);
      message.textContent = t('app.merge.summary', { notes: plural('app.count.notes', preview.cards.length + preview.unsavedNotes),
        group: groupName({ name: preview.targetName }) });
      for (const card of preview.cards) {
        const note = card.summary;
        items.append(element('li', card.deleted ? t('app.merge.itemDeleted', { note }) : card.archived ? t('app.merge.itemArchived', { note })
          : card.completed ? t('app.merge.itemCompleted', { note }) : note));
      }
      apply.disabled = false;
    } catch (error) { message.textContent = error.message; }
  };
  select.onchange = refresh;
  actions.append(cancel, button(t('app.merge.refresh'), refresh), apply);
  dialog.append(field, message, items, element('p', t('app.merge.undoHint'), 'hint'), actions);
  dialog.oncancel = event => { if (busy) event.preventDefault(); };
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); refresh(); dialog.showModal();
}

function deleteButton(cardId, dialog) {
  const node = element('button', t('app.card.delete')); node.type = 'button';
  node.addEventListener('click', async event => {
    event.stopPropagation();
    if (workspace.unsavedChanges(cardId) && !await confirmAction(t('app.card.deleteUnsavedTitle'), t('app.card.deleteUnsavedText'), t('app.card.delete'))) return;
    run(async () => { await deleteCard(cardId); dialog.close(); });
  });
  return node;
}
// Board and list notes also offer Edit here; papers on the canvas and the desktop have their own Edit button.
function cardDetails(card, { edit = false } = {}) {
  const dialog = element('dialog'); dialog.append(element('h2', summaryText(card)));
  const groupLabel = element('label', t('app.card.moveToGroup'), 'field'); const select = element('select'); fillGroups(select, card.groupId); groupLabel.append(select);
  const visibility = element('label', undefined, 'check'); const check = element('input'); check.type = 'checkbox'; check.checked = workspace.layout.state.placements[card.id]?.visible !== false; visibility.append(check, document.createTextNode(t('app.card.showOnDesktop')));
  // Which layer a paper sits on belongs to its group and changes only with the group's shortcut on the desktop.
  // Phones show no desktop papers, so the display option they cannot show stays unchanged.
  dialog.append(groupLabel, ...handheld ? [] : [visibility]);
  const actions = element('div', undefined, 'dialog-actions');
  if (edit) actions.append(button(t('app.card.edit'), async () => { dialog.close(); await openEditor(currentCard(card.id) ?? card); }));
  actions.append(button(card.archived ? t('app.card.unarchive') : t('app.card.archive'), async () => { await changeCard(card.id, { archived: !card.archived }); dialog.close(); }),
    deleteButton(card.id, dialog),
    button(t('common.cancel'), () => dialog.close()), button(t('app.card.apply'), async () => {
      if (select.value !== card.groupId) await controller.moveToGroup(card.id, select.value);
      if (!handheld) await workspace.layout.setCardPolicy(card.id, { visible: check.checked });
      await controller.reconcile(); dialog.close(); render(); status(t('app.status.savedLocally'));
    }, 'primary'));
  dialog.append(actions); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
}

async function ensureCaptureGroup() {
  const groups = activeGroups(workspace.snapshot);
  if (groups.length) {
    if (!groups.some(group => group.id === activeGroupId)) activeGroupId = rememberedGroup();
    return;
  }
  // A new or cleared account must receive its existing groups before choosing an initial group.
  if (profileId.startsWith('google:')) throw new FleetError('initial-sync-required', t('sync.errors.initialSyncRequired'));
  const group = await workspace.createGroup(t('app.groups.defaultName')); activeGroupId = group.id; render();
}

// The editor continues the note's unsaved changes, or starts from the note as saved; without a note it starts a new one
// (ADR-061).
async function openEditor(card = null) {
  if (composing) return;
  editorHidesMain = false;
  if (!card) await ensureCaptureGroup();
  if (controller.state.editingCardId && currentDraft) await controller.endEdit();
  remoteEditor = null;
  currentDraft = workspace.openDraft(activeGroupId, card);
  currentDraft.content.attachments ||= [];
  setText('#editor-title', currentDraft.baseRevision ? () => t('app.editor.editTitle') : () => t('app.actions.capture'));
  $('#editor-heading').value = currentDraft.content.title || '';
  $('#editor-text').value = currentDraft.content.text; fillGroups($('#editor-group'), currentDraft.groupId);
  $('#editor-group').disabled = Boolean(currentDraft.baseRevision); showConflictActions(null);
  $('#editor-dialog').showModal(); showEditorTab(false); await renderAttachments(); queueDraft(); $('#editor-text').focus();
}

function renderSelection() {
  const layout = workspace.layout.state; const state = controller.state;
  if (state.activeGroupId) activeGroupId = state.activeGroupId;
  $('#groups').querySelectorAll('.group-row').forEach(row => row.classList.toggle('active', row.dataset.groupId === activeGroupId));
  // Selecting another paper ends an edit and may keep its draft, so the drafts link can appear here.
  renderCounts();
  const order = sceneOrder(workspace.working.cards, layout, state).map(card => card.id);
  $('#stage').querySelectorAll('.card').forEach(paper => {
    paper.classList.toggle('selected', paper.dataset.cardId === state.selectedCardId);
    paper.style.zIndex = String(5 + order.indexOf(paper.dataset.cardId));
  });
  desktop?.publish();
}


function queueDraft() {
  if (!currentDraft) return Promise.resolve();
  const sequence = ++draftSequence; const id = currentDraft.id;
  unsavedDrafts.set(id, sequence);
  $('#draft-status').textContent = t('desktop.unsaved.writing');
  draftPending = workspace.saveDraft(copy(currentDraft));
  draftPending.then(() => {
    if (unsavedDrafts.get(id) === sequence) unsavedDrafts.delete(id);
    if (sequence === draftSequence && currentDraft?.id === id) $('#draft-status').textContent = t('desktop.unsaved.kept');
    // A new note is a note of its group from its first kept text (ADR-061), so it takes its desktop place at once:
    // arranging papers while its editor is still open must find it placed.
    const cardId = currentDraft?.id === id ? currentDraft.cardId : null;
    if (cardId && !workspace.layout.state.placements[cardId] && workspace.unsavedChanges(cardId)) {
      void workspace.layout.placeNew(workspace.working, workAreas()).catch(error => status(error.message, true));
    }
  }).catch(error => {
    if (currentDraft?.id !== id) return;
    $('#draft-status').textContent = t('app.editor.draftSaveFailed', { error: error.message });
    status(t('app.status.draftSaveFailed', { error: error.message }), true);
  });
  return draftPending;
}
async function flushDraft() {
  const editor = currentDesktopEditor();
  if (editor) {
    const sequence = await desktop.flush(editor);
    if (currentDesktopEditor()?.sequence !== sequence) throw new Error(t('app.errors.desktopDraftOrder'));
  }
  await queueDraft();
}
function setEditorBusy(value) {
  editorBusy = value; $('#editor-text').readOnly = value; $('#editor-heading').readOnly = value;
  $('#editor-form').querySelectorAll('button').forEach(node => { node.disabled = value; });
  $('#attachment-input').disabled = value;
  $('#editor-group').disabled = value || Boolean(currentDraft?.baseRevision);
}
// Closing keeps changed text as the note's unsaved changes and drops changes that hold nothing (SPEC-003 U23). A note
// never saved that keeps content takes a place on the desktop like any new note (ADR-061).
const closedStatus = draft => draft && workspace.unsavedChanges(draft.cardId) ? t('app.status.unsavedKept') : t('app.status.closed');
async function closeEditor() {
  if (editorBusy || composing) return;
  setEditorBusy(true);
  try {
    // Clear the editor before discarding so a background flush cannot write the blank text back.
    await flushDraft(); const draft = currentDraft;
    currentDraft = null; remoteEditor = null; $('#editor-dialog').close(); controller.setComposing(false);
    try { if (draft) { await workspace.discardUnneededDraft(draft.id); await workspace.layout.placeNew(workspace.working, workAreas()); } }
    finally { await controller.endEdit(); render(); }
    status(closedStatus(draft));
    await returnHiddenMain();
  }
  finally { setEditorBusy(false); }
}
// "Discard changes", in the editor or on a quick edit, returns the note to its saved revision, or removes a note never
// saved (ADR-061).
async function discardEditor() {
  if (editorBusy || composing) return;
  setEditorBusy(true);
  try {
    // Clear the editor first so a background flush cannot write the discarded text back.
    await flushDraft(); const draft = currentDraft;
    currentDraft = null; remoteEditor = null; $('#editor-dialog').close(); controller.setComposing(false);
    try { if (draft) await discardChanges(draft.cardId); }
    finally { await controller.endEdit(); render(); }
    await returnHiddenMain();
  } finally { setEditorBusy(false); }
}
// A refused save offers what the note still allows: Overwrite only when another revision of it replaced the one the
// changes began from, and Save as a copy also when it was deleted, has unresolved versions or already exists (ADR-061).
function showConflictActions(error) {
  const changed = error?.code === 'conflict' && Boolean(error.details?.actualRevision);
  $('#overwrite').hidden = !changed; $('#save-copy').hidden = !currentDraft?.purged && !changed && !['conflict', 'missing-card', 'duplicate-card', 'dataset-purged'].includes(error?.code);
}
// The tray may have gone since; the window then simply stays open.
async function returnHiddenMain() {
  if (!editorHidesMain) return;
  editorHidesMain = false;
  if (desktop && !document.querySelector('dialog[open]')) await native.bridge.request('desktop.hideMain').catch(() => {});
}
async function saveEditor({ asCopy = false, overwrite = false } = {}) {
  if (editorBusy || !currentDraft || composing) return;
  setEditorBusy(true);
  try {
    await flushDraft();
    // A new note's group, picked in the editor or not, becomes the one shown and remembered, as a sidebar choice does.
    const landed = currentDraft.baseRevision ? null : currentDraft.groupId;
    await workspace.commitDraft(currentDraft.id, { asCopy, overwrite });
    currentDraft = null; remoteEditor = null; $('#editor-dialog').close(); controller.setComposing(false); await controller.endEdit();
    if (landed) { activeGroupId = landed; showToDo(); }
    await workspace.layout.placeNew(workspace.working, workAreas()); render(); status(t('app.status.noteSaved'));
    if (landed) await rememberGroup();
    await returnHiddenMain();
  } catch (error) { showConflictActions(error); throw error; }
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
async function addAttachments(files) {
  if (editorBusy || composing || !currentDraft || !files.length) return;
  setEditorBusy(true);
  try {
    for (const file of files) {
      const metadata = await storage.putAttachment(profileId, file);
      if (!currentDraft.content.attachments.some(item => item.id === metadata.id)) currentDraft.content.attachments.push(metadata);
    }
    await queueDraft(); await renderAttachments();
  } finally { setEditorBusy(false); }
}
// A picture pasted from a screenshot or another app arrives as "image.png"; a dated name tells several apart.
function pastedName(file, index, files) {
  const image = file.type.startsWith('image/');
  if (file.name && !(image && /^image\.\w+$/i.test(file.name))) return file;
  const pad = value => String(value).padStart(2, '0'); const now = new Date();
  const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  const extension = /\.\w+$/.exec(file.name)?.[0] || (image ? `.${file.type.slice(6).replace('jpeg', 'jpg')}` : '');
  const name = t(image ? 'app.editor.pastedImage' : 'app.editor.pastedFile', { time }) + (files.length > 1 ? ` ${index + 1}` : '') + extension;
  return new File([file], name, { type: file.type, lastModified: file.lastModified });
}
async function previewAttachment(file) {
  if (attachmentFiles) return attachmentFiles.preview(file);
  return { available: Boolean(await storage.getAttachment(profileId, file.id)), png: null };
}
async function openAttachment(file) {
  if (attachmentFiles) return attachmentFiles.open(file);
  const blob = await storage.getAttachment(profileId, file.id);
  if (!blob) throw new Error(t('app.errors.attachmentMissing'));
  if (nativeFiles) return nativeFiles.export(new Uint8Array(await blob.arrayBuffer()), file.name);
  const url = URL.createObjectURL(blob); const link = element('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function appendAttachmentTiles(body, files, cleanups) {
  if (!files.length) return;
  const tiles = element('div'); body.append(tiles);
  cleanups.push(renderAttachmentTiles(tiles, files, { preview: previewAttachment, open: openAttachment, report: error => status(error.message, true) }));
}
// On a paper the attachments are one row of thumbnails along its bottom edge; the fitter hides tiles beyond the row.
function attachmentStrip(files, cleanups, fitter) {
  if (!files.length) return null;
  const strip = element('div', undefined, 'paper-files'); fitter.observe(strip);
  cleanups.push(renderAttachmentTiles(strip, files, { preview: previewAttachment, open: openAttachment, report: error => status(error.message, true) }));
  return strip;
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
      if (native?.info.capabilities.fileShare) row.append(button(t('app.editor.shareAttachment'), async () => {
        if (editorBusy) return;
        setEditorBusy(true);
        try {
          const result = await nativeFiles.export(new Uint8Array(blob), attachment.name, 'share');
          status(result.completed ? t('app.status.attachmentShared') : t('app.status.shareCancelled'));
        } finally { setEditorBusy(false); }
      }));
    } else row.append(element('span', t('app.editor.notDownloaded', { name: attachment.name })));
    row.append(element('span', `${Math.ceil(attachment.size / 1024)} KiB`), button(t('app.editor.removeAttachment'), async () => {
      if (editorBusy) return;
      currentDraft.content.attachments = currentDraft.content.attachments.filter(item => item.id !== attachment.id);
      await queueDraft(); await renderAttachments();
    })); list.append(row);
  }
}

function openFormation(mode) {
  if (adjustOverlayActive() || $('#formation-dialog').open) return;
  formationMode = mode; setText('#formation-title', mode === 'stack' ? () => t('app.formation.stackTitle') : () => t('app.formation.spreadTitle'));
  $('#allow-resize').checked = false;
  $('#formation-scope').value = controller.state.operationScope.kind === 'all' ? 'all' : 'group';
  $('#formation-dialog').showModal(); updateFormation();
}
function formationPlan(mode, scope, allowResize) {
  const snapshot = workspace.working;
  const measure = element('div', t('app.formation.measure'), 'card-summary'); measure.style.position = 'absolute'; measure.style.visibility = 'hidden'; document.body.append(measure);
  const measuredBand = measure.getBoundingClientRect().height; measure.remove();
  const summaryBands = Object.fromEntries(snapshot.cards.map(card => [card.id, measuredBand]));
  for (const paper of $('#stage').querySelectorAll('.card')) summaryBands[paper.dataset.cardId] = paper.querySelector('.card-summary').getBoundingClientRect().height;
  return planFormation({ snapshot, layout: workspace.layout.state, scope, mode, workAreas: workAreas(), summaryBands, allowResize });
}
function updateFormation() {
  try {
    formationPreview = formationPlan(formationMode, $('#formation-scope').value === 'all' ? { kind: 'all' } : { kind: 'group', groupId: activeGroupId },
      $('#allow-resize').checked);
    const { changes, resized, overflow } = formationPreview;
    const sentences = [plural('app.formation.arranges', Object.keys(changes).length),
      resized.length ? plural('app.formation.resized', resized.length) : t('app.formation.keepSize')];
    if (overflow.length) sentences.push(plural('app.formation.overflow', overflow.length));
    $('#formation-description').textContent = [...sentences, t('app.formation.undoHint')].join(' ');
    $('#apply-formation').disabled = false;
  } catch (error) { formationPreview = null; $('#formation-description').textContent = error.message; $('#apply-formation').disabled = true; }
}

// Settings is one window with a page per area. Wide screens show the page list beside the page; phones show the
// list first and slide into a page. Changes apply as soon as they are valid, so there is nothing to save.
const settingsTitle = page => page ? t(`settings.${page}.title`) : t('settings.title');
function renderLanguageSetting() {
  const select = $('#language');
  select.replaceChildren(...languageOptions().map(({ value, label }) => new Option(label, value)));
  select.value = languagePreference();
}
/** A language change redraws everything built from the catalogs; status lines refresh on their next update. */
function relocalize() {
  localizeDocument();
  for (const [selector, text] of shownText) $(selector).textContent = textOf(text);
  if (shownSync) setSync(...shownSync);
  render(); renderAccount();
  if ($('#editor-dialog').open && currentDraft) {
    fillGroups($('#editor-group'), currentDraft.groupId); void run(renderAttachments);
    if (!$('#editor-preview').hidden) showEditorTab(true);
  }
  if ($('#formation-dialog').open) updateFormation();
  if ($('#settings-dialog').open) {
    renderLanguageSetting(); renderDesktopSettings(); renderShortcutSettings();
    $('#settings-page-title').textContent = settingsTitle(settingsPage);
    // The data and versions pages are their panels' own markup, so an idle one is built again.
    if (settingsPage === 'data' && dataPanel && !dataPanel.busy()) { dataPanel.dispose(); dataPanel = null; void run(mountDataPanel); }
    if (settingsPage === 'revisions' && revisions && !revisions.busy()) { revisions.dispose(); revisions = null; void run(mountRevisions); }
  }
}
// Where the gear and Ctrl+, open settings: General, or the page list at phone width.
const settingsHome = () => narrow.matches ? null : 'general';
function openSettings(page = null) {
  const dialog = $('#settings-dialog');
  if (!dialog.open) { renderLanguageSetting(); renderDesktopSettings(); renderShortcutSettings(); renderAccount(); dialog.showModal(); }
  return showSettingsPage(page);
}
async function showSettingsPage(page) {
  if (page === null && !narrow.matches) page = settingsPage || 'general';
  // A running backup or restore keeps its page, and so does a version being chosen; leaving would drop its progress.
  if ((dataPanel?.busy() && page !== 'data') || (revisions?.busy() && page !== 'revisions')) return;
  if (page !== 'data') { dataPanel?.dispose(); dataPanel = null; }
  if (page !== 'revisions') { revisions?.dispose(); revisions = null; }
  settingsPage = page; const dialog = $('#settings-dialog');
  dialog.classList.toggle('listing', page === null);
  for (const panel of dialog.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== page;
  for (const item of dialog.querySelectorAll('[data-page]')) {
    if (item.dataset.page === page) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  }
  $('#settings-page-title').textContent = settingsTitle(page);
  if (page === 'general') renderLanguageSetting();
  $('.settings-body').scrollTop = 0;
  // Region rows name the group in each region, which the Desktop page may just have changed.
  if (page === 'shortcuts') renderShortcutSettings();
  if (page === 'data' && !dataPanel) await mountDataPanel();
  if (page === 'revisions' && !revisions) await mountRevisions();
}
// Choosing a version can rewrite the paper being edited, so any edit in progress is saved and closed first.
async function mountRevisions() {
  const host = $('#revisions-host');
  if (editorBusy || composing) { host.replaceChildren(element('p', t('settings.data.finishInput'), 'hint')); return; }
  if (currentDraft) await flushDraft();
  if (!await controller.endEdit()) { host.replaceChildren(element('p', t('settings.data.finishInput'), 'hint')); return; }
  currentDraft = null; render();
  // Settings may have closed or moved to another page while the edit was being saved.
  if (!$('#settings-dialog').open || settingsPage !== 'revisions') return;
  revisions = revisionPanel({ workspace, storage, profileId, onChanged: async () => {
    await controller.reconcile(); await workspace.layout.placeNew(workspace.working, workAreas()); render();
  } });
  host.replaceChildren(revisions.element);
}
async function mountDataPanel() {
  const host = $('#data-host');
  // Restore rewrites the workspace, so any edit in progress is saved and closed first.
  if (editorBusy || composing) { host.replaceChildren(element('p', t('settings.data.finishInput'), 'hint')); return; }
  if (currentDraft) await flushDraft();
  if (!await controller.endEdit()) { host.replaceChildren(element('p', t('settings.data.finishInput'), 'hint')); return; }
  currentDraft = null; controller.cancelDrag(); render();
  // Settings may have closed or moved to another page while the edit was being saved.
  if (!$('#settings-dialog').open || settingsPage !== 'data') return;
  dataPanel = backupPanel({ workspace, storage, getWorkAreas: workAreas, flush: flushDraft, automatic,
    automaticError: automaticError && t('settings.data.automaticOff', { error: automaticError.message }),
    files: nativeBackups?.manual, reset: resetPlan(), cloudRestore: cloudRestoreOptions(), backupSource: backupSourceOptions(), localRestore: applyLocalRestore,
    appVersion: native?.info.appVersion, uninstallNotice: native?.info.platform === 'windows' ? t('settings.data.uninstallNotice') : null,
    onChanged: async () => {
      // After a restore the main window shows the remembered group: the backup's when the layout was replaced.
      activeGroupId = rememberedGroup();
      await controller.reconcile(); await workspace.layout.placeNew(workspace.working, workAreas()); render();
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
  $('#display-detail').textContent = fixed ? t('settings.desktop.display.fixed')
    : pending ? t('settings.desktop.display.pending') : t('settings.desktop.display.hint');
}
// ADR-043: startup behaviour and the main window belong to this computer's host, not to the workspace or its backups.
// The switches show what the system actually does; a sign-in item the user turned off there stays off.
let hostPreferences = null;
const distributionName = value => ({ msix: t('settings.desktop.distribution.msix'), zip: t('settings.desktop.distribution.zip'),
  debug: t('settings.desktop.distribution.debug'), deb: t('settings.desktop.distribution.deb'), bundle: t('settings.desktop.distribution.bundle'),
  source: t('settings.desktop.distribution.source'), app: t('settings.desktop.distribution.app'),
  ios: t('settings.desktop.distribution.ios'), android: t('settings.desktop.distribution.android') })[value] || '';
// macOS keeps Work Fleet in the menu bar; Windows and Linux in the tray.
const menuBar = () => native?.info.platform === 'macos';
function renderHostSettings() {
  const available = native?.info.capabilities.hostPreferences === true; $('#host-settings').hidden = !available;
  // Where the host keeps the main window's placement, resetting the desktop layout also resets the window, and says so.
  const hint = $('#reset-layout-hint'); hint.dataset.i18n = available ? 'settings.desktop.resetLayout.hintWindow' : 'settings.desktop.resetLayout.hint';
  const text = $('#reset-layout-text'); text.dataset.i18n = available ? 'settings.desktop.resetLayout.confirmTextWindow' : 'settings.desktop.resetLayout.confirmText';
  hint.textContent = t(hint.dataset.i18n); text.textContent = t(text.dataset.i18n);
  // Every app shows its version; the phone apps update from their stores, so they have no update row.
  const version = native?.info.appVersion; $('#version-settings').hidden = !version; $('#update-row').hidden = !available;
  const heading = $('#version-heading'); heading.dataset.i18n = available ? 'settings.update.heading' : 'settings.update.versionHeading';
  heading.textContent = t(heading.dataset.i18n);
  if (version) {
    $('#app-version').textContent = t('settings.desktop.version', { version });
    $('#app-distribution').textContent = distributionName(native.info.distribution);
  }
  if (!available) return;
  $('#close-tray-label').textContent = menuBar() ? t('settings.desktop.closeToMenuBar') : t('settings.desktop.closeToTray');
  renderHostPreferences(); renderUpdate();
  if (native.info.capabilities.updates) void native.bridge.request('update.state').then(value => { updateState = value; renderUpdate(); }, error => status(error.message, true));
  void native.bridge.request('host.preferences.get').then(value => { hostPreferences = value; renderHostPreferences(); }, error => status(error.message, true));
}
function renderHostPreferences() {
  const value = hostPreferences;
  for (const id of ['#start-login', '#close-tray', '#open-main']) $(id).disabled = value === null;
  if (value === null) return;
  const start = value.startAtLogin; const fixed = ['disabled-by-user', 'disabled-by-policy', 'enabled-by-policy'].includes(start.state);
  // Each platform names the system page where the user changes the sign-in item.
  const windows = native.info.platform === 'windows'; const macos = native.info.platform === 'macos';
  const offByUser = windows ? t('settings.desktop.startLogin.offByUserWindows')
    : macos ? t('settings.desktop.startLogin.offByUserMacos') : t('settings.desktop.startLogin.offByUser');
  const approval = windows ? t('settings.desktop.startLogin.approvalWindows')
    : macos ? t('settings.desktop.startLogin.approvalMacos') : t('settings.desktop.startLogin.approval');
  $('#start-login').checked = start.enabled || start.state === 'requires-approval'; $('#start-login').disabled = !start.available || fixed;
  $('#start-login-detail').textContent = !start.available ? start.reason || t('settings.desktop.startLogin.unsupported')
    : start.state === 'disabled-by-user' ? offByUser
    : start.state === 'disabled-by-policy' ? t('settings.desktop.startLogin.offByPolicy')
    : start.state === 'enabled-by-policy' ? t('settings.desktop.startLogin.onByPolicy')
    : start.state === 'requires-approval' ? approval
    : t('settings.desktop.startLogin.on');
  $('#start-login-system').hidden = !(start.systemSettings && ['disabled-by-user', 'requires-approval'].includes(start.state));
  $('#close-tray').checked = value.closeToTray.enabled; $('#close-tray').disabled = !value.closeToTray.available;
  $('#close-tray-detail').textContent = value.closeToTray.available ? t('settings.desktop.closeToTrayOff')
    : menuBar() ? t('settings.desktop.noMenuBar') : t('settings.desktop.noTray');
  $('#open-main').checked = value.openMainAtLogin.enabled; $('#open-main').disabled = !value.openMainAtLogin.available;
}
// ADR-044: the host owns the update state; the page shows it and offers the one next step.
let updateState = null;
const updateActions = { check: 'update.check', download: 'update.download', install: 'update.install' };
function renderUpdate() {
  const when = value => value ? formatDate(value, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const state = updateState; const button = $('#update-action');
  if (!native?.info.capabilities.updates || !state) {
    $('#update-status').textContent = t('settings.update.title');
    $('#update-detail').textContent = native?.info.platform === 'windows' ? t('settings.update.msixOnly') : t('settings.update.notOffered');
    button.hidden = true; return;
  }
  const checked = state.lastCheckedAt ? t('settings.update.lastChecked', { time: when(state.lastCheckedAt) }) : t('settings.update.neverChecked');
  const percent = state.progress?.total ? Math.floor(state.progress.received * 100 / state.progress.total) : 0;
  const { version } = state;
  const [label, detail] = {
    unavailable: [t('settings.update.unavailable'), state.reason || ''],
    idle: [t('settings.update.check'), checked],
    checking: [t('settings.update.checking'), ''],
    up_to_date: [t('settings.update.upToDate'), checked],
    update_available: [t('settings.update.available', { version }), state.summary || ''],
    downloading: [t('settings.update.downloading', { version }), `${percent}%`],
    downloaded: [t('settings.update.downloaded', { version }), t('settings.update.installOnRestart')],
    installing: [t('settings.update.installing'), t('settings.update.reopens')],
    failed: [t('settings.update.failed'), ''],
  }[state.status] || [t('settings.update.title'), ''];
  $('#update-status').textContent = label;
  $('#update-detail').textContent = state.error?.message || detail;
  $('#update-detail').classList.toggle('error', Boolean(state.error));
  const action = { check: t('settings.update.check'), download: t('settings.update.download'), install: t('settings.update.install') }[state.nextAction];
  button.hidden = !action; if (action) button.textContent = action;
}
function runUpdateAction() {
  const action = updateActions[updateState?.nextAction]; if (!action) return;
  return run(async () => {
    // Installing closes Work Fleet through the usual close, which waits for open dialogs, so settings closes first.
    if (action === 'update.install') {
      if (dataPanel?.busy()) throw new Error(t('settings.errors.backupBusyInstall'));
      $('#settings-dialog').close();
    }
    updateState = await native.bridge.request(action); renderUpdate();
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
  $('#desktop-completed').checked = layout.completedVisible === true;
  $('#quick-move-row').hidden = !desktopInfo || !quickMoveOffered();
  $('#quick-move-label').textContent = t('settings.desktop.quickMove', { key: native?.info.platform === 'macos' ? '⌘' : 'Ctrl' });
  $('#desktop-quick-move').checked = layout.quickMove === true;
  settingsSlots = [...layout.grid.slots];
  fillGroups($('#my-group'), layout.myGroupId, true); $('#grid-rows').value = String(layout.grid.rows); $('#grid-columns').value = String(layout.grid.columns);
  previewGrid();
}
function applyLayout(patch) {
  // Hiding completed papers can take away the paper being edited or selected, as hiding one paper does.
  return run(async () => { await workspace.layout.configure(patch, workspace.snapshot); await controller.reconcile(); render(); });
}
// Quick capture and the desktop toggle come first, then 0 for every group and 1–9 for the desktop regions. Region
// rows show the group now in that region, by its current name and paper colour.
function renderShortcutSettings() {
  const layout = workspace.layout.state; const bound = regionShortcuts(layout.shortcuts, layout.grid.slots);
  const groups = activeGroups(workspace.snapshot);
  // Desktop hosts step through the layers they offer; the browser preview names every stage.
  const stages = desktopInfo ? desktopStages() : [0, 1, 2, adjustStage];
  $('#stage-hint').textContent = t('settings.shortcuts.stageHint', { stages: stages.map(stage => stageNames()[stage]).join(' → ') });
  const row = (target, name, { tile = null, label = name, empty = false, note = '' } = {}) => {
    const item = element('label', undefined, 'settings-row'); const text = element('span', undefined, 'row-text');
    const state = element('span', '', 'row-value'); state.dataset.shortcutStatus = target;
    text.append(element('span', name, empty ? 'row-label empty' : 'row-label'), element('span', note, 'row-value'), state);
    const input = element('input'); input.dataset.shortcutTarget = target; input.placeholder = t('settings.shortcuts.unset');
    input.setAttribute('aria-label', t('settings.shortcuts.inputLabel', { action: label }));
    input.value = Object.entries(bound).filter(([, value]) => value === target).map(([key]) => key).join(', ');
    input.oninput = checkShortcuts; input.onchange = applyShortcuts;
    if (tile) item.append(tile); item.append(text, input); return item;
  };
  $('#shortcut-actions').replaceChildren(row(shortcutActions.capture, t('settings.shortcuts.capture')), row(shortcutActions.toggle, t('settings.shortcuts.toggle')));
  const regions = [row(shortcutActions.all, t('app.groups.all'), { tile: $('#all-tile').content.firstElementChild.cloneNode(true),
    note: t('settings.shortcuts.allNote') })];
  for (let number = 1; number <= 9; number++) {
    const group = groups.find(item => item.id === layout.grid.slots[number - 1]);
    const tile = element('span', String(number), group ? 'region-tile' : 'region-tile empty'); tile.setAttribute('aria-hidden', 'true');
    if (group) tile.style.setProperty('--paper', groupColor(group.id));
    const name = groupName(group) || t('settings.desktop.emptyRegion');
    regions.push(row(regionTarget(number), name, { tile, label: t('settings.shortcuts.regionLabel', { number, group: name }), empty: !group }));
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
      if (Object.hasOwn(result, key)) throw new Error(t('settings.errors.duplicateShortcut'));
      result[key] = input.dataset.shortcutTarget;
    }
  }
  if (nativeShortcuts && Object.keys(result).length > 32) throw new Error(t('settings.errors.tooManyShortcuts'));
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
  const rows = Number($('#grid-rows').value); const columns = Number($('#grid-columns').value); const groups = shownGroups();
  if (reshape || settingsSlots.length !== rows * columns) {
    const ordered = settingsSlots.filter(id => id && groups.some(group => group.id === id));
    for (const group of groups) if (!ordered.includes(group.id)) ordered.push(group.id);
    settingsSlots = Array.from({ length: rows * columns }, (_, index) => ordered[index] || null);
  }
  const preview = $('#grid-preview'); preview.replaceChildren(); preview.style.gridTemplateColumns = `repeat(${columns},1fr)`;
  for (let i = 0; i < rows * columns; i++) {
    const cell = element('label'); const select = element('select');
    select.setAttribute('aria-label', t('settings.desktop.regionGroup', { number: i + 1 })); select.append(new Option(t('settings.desktop.emptyRegion'), ''));
    for (const group of groups) select.append(new Option(groupName(group), group.id));
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
    const name = groupName(activeGroups(workspace.snapshot).find(group => group.id === node.dataset.groupId));
    node.textContent = target ? t('app.stage.moveTo', { group: name }) : name;
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
// Without desktop scenes the papers being adjusted are on this window's canvas, so adjust mode shows it; the adjust bar
// covers the view switch until Done.
function showCanvas() {
  if (desktopInfo || handheld || controller.state.operationScope.kind === 'none') return;
  showDesktop = true; filter = 'active'; if ($('#search').value || $('.topbar').classList.contains('searching')) setSearching(false);
}
// Auto margins take only free space, so counting them never makes a fitting row look too wide.
function rowFits(row) {
  const items = [...row.children].filter(node => node.getClientRects().length && getComputedStyle(node).position !== 'absolute');
  const style = getComputedStyle(row); const px = value => parseFloat(value) || 0;
  const needed = items.reduce((sum, node) => { const own = getComputedStyle(node); return sum + node.scrollWidth + px(own.marginLeft) + px(own.marginRight); }, 0)
    + px(style.columnGap) * Math.max(0, items.length - 1) + px(style.paddingLeft) + px(style.paddingRight);
  return needed <= row.clientWidth + 1;
}
// A bar that does not fit its row, which depends on the language and the window, drops its labels: the view bar its
// view names, the adjust bar its Bring to front label. The name of what is adjusted shortens on its own.
function fitBars() {
  const bar = $('.view-bar'); bar.classList.remove('compact');
  if (!rowFits(bar)) bar.classList.add('compact');
  const adjust = $('#adjust-bar'); adjust.classList.remove('tight');
  if (!adjust.hidden && !rowFits(adjust)) adjust.classList.add('tight');
}
// The sidebar entry stays in place and keeps focus, except that the phone drawer closes onto the adjust bar, where
// Done takes it. Leaving adjust mode hides the adjust bar, so a control that had focus there hands it to the entry in
// the sidebar, or to the view switch while the phone drawer is closed.
function handOverFocus(before) {
  const bar = $('#adjust-bar'); const inSidebar = () => $('#sidebar').contains(document.activeElement);
  if (before?.closest?.('.adjust-entry')) { if (!bar.hidden && !inSidebar()) $('#stop-operation').focus(); return; }
  if (!before?.closest?.('#adjust-bar') || !bar.hidden) return;
  $('#operate-group').focus();
  if (!inSidebar()) $('.view-switch [aria-pressed="true"]')?.focus();
}
// A note that is being or was just captured is seen where it lands: its group's To do on the board or list, not a
// search, the canvas or the layout map of every group. A browser canvas still being adjusted stays.
function showToDo() {
  filter = 'active'; if ($('#search').value || $('.topbar').classList.contains('searching')) setSearching(false);
  if (controller.state.operationScope.kind === 'none') showDesktop = false;
}
function setSearching(on) {
  $('.topbar').classList.toggle('searching', on);
  // The label follows the state, and localizeDocument() puts the same one back after a language change.
  const toggle = $('#search-toggle'); toggle.dataset.i18nAttr = on ? 'aria-label:app.search.close' : 'aria-label:app.search.open';
  toggle.setAttribute('aria-label', on ? t('app.search.close') : t('app.search.open'));
  if (on) $('#search').focus();
  else if ($('#search').value) { $('#search').value = ''; render(); }
}
function bindEvents() {
  $('#empty-trash').onclick = () => run(() => confirmPurge(workspace.snapshot.cards.filter(card => card.deleted).map(card => card.id)));
  $('#retry-cleanup').onclick = () => { maintenancePaused = false; $('#retry-cleanup').hidden = true; scheduleMaintenance(0); };
  // Inert blocks real input and focus; capture also rejects synthetic or already dispatched owner input.
  for (const type of ['click', 'dblclick', 'pointerdown', 'keydown', 'submit']) document.addEventListener(type, event => {
    if (!adjustOverlayActive()) return;
    // An owned foreground window suspends global hotkeys, so its local desktop keys and Escape must still work.
    if (type === 'keydown' && (event.key === 'Escape' || shortcutForEvent(event, liveShortcuts()))) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  setDrawer(false); new ResizeObserver(fitBars).observe($('.view-bar'));
  // Capture keeps one gap above the status row, which grows when a long status wraps.
  new ResizeObserver(() => $('main').style.setProperty('--status-row', `${$('main > footer').offsetHeight}px`)).observe($('main > footer'));
  narrow.addEventListener('change', () => { setDrawer(false); if ($('#settings-dialog').open) void showSettingsPage(settingsPage); });
  $('#drawer-toggle').onclick = () => setDrawer(true); $('#scrim').onclick = () => setDrawer(false);
  $('#sidebar').addEventListener('click', event => { if (event.target.closest('.sidebar-links button')) setDrawer(false); });
  $('#search-toggle').onclick = () => setSearching(!$('.topbar').classList.contains('searching'));
  $('#search').addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('.topbar').classList.contains('searching')) { event.preventDefault(); setSearching(false); }
  });
  $('#compose').onclick = () => run(() => openEditor());
  const settings = $('#settings-dialog');
  // The account chip opens its own page; the gear opens General (the page list on phones).
  $('#account-button').onclick = () => { setDrawer(false); run(() => openSettings('account')); };
  $('#settings-button').onclick = () => { setDrawer(false); run(() => openSettings(settingsHome())); };
  for (const item of settings.querySelectorAll('[data-page]')) item.onclick = () => run(() => showSettingsPage(item.dataset.page));
  $('#settings-back').onclick = () => run(() => showSettingsPage(null));
  $('#language').onchange = () => run(async () => {
    $('#language-message').hidden = true;
    try { await changeLanguage($('#language').value); }
    catch (error) { renderLanguageSetting(); $('#language-message').textContent = error.message; $('#language-message').hidden = false; }
  });
  for (const id of ['#close-settings', '#close-settings-list']) $(id).onclick = () => { if (!dataPanel?.busy() && !revisions?.busy()) settings.close(); };
  settings.addEventListener('cancel', event => {
    if (dataPanel?.busy()) { event.preventDefault(); dataPanel.abort(); return; }
    if (revisions?.busy()) { event.preventDefault(); return; }
    // On phones, Back and Escape leave a page for the page list before closing.
    if (narrow.matches && settingsPage !== null) { event.preventDefault(); void showSettingsPage(null); }
  });
  settings.addEventListener('close', () => {
    dataPanel?.dispose(); dataPanel = null; revisions?.dispose(); revisions = null; if (narrow.matches) settingsPage = null;
    // Resolving the last conflict hides the status bar button that opened Settings, so once the browser has tried to
    // return focus there, it goes to the gear instead, or to the view switch while the phone drawer hides the gear.
    setTimeout(() => {
      if (document.activeElement !== document.body || document.querySelector('dialog[open]')) return;
      $('#settings-button').focus(); if (document.activeElement === document.body) $('.view-switch [aria-pressed="true"]')?.focus();
    });
  });
  $('#desktop-visible').onchange = () => applyLayout({ desktopVisible: $('#desktop-visible').checked });
  $('#desktop-completed').onchange = () => applyLayout({ completedVisible: $('#desktop-completed').checked });
  $('#desktop-quick-move').onchange = () => applyLayout({ quickMove: $('#desktop-quick-move').checked });
  $('#display-xwayland').onchange = () => run(async () => {
    displayBackend = await native.bridge.request('host.displayBackend', { xwayland: $('#display-xwayland').checked }); renderDisplaySetting();
  });
  // The close behind a restart refuses while any dialog is open, so settings closes first, as its own close button would.
  $('#display-restart').onclick = () => run(async () => {
    if (dataPanel?.busy()) throw new Error(t('settings.errors.backupBusyRestart'));
    $('#settings-dialog').close(); await native.bridge.request('host.restart');
  });
  $('#start-login').onchange = () => setHostPreference('startAtLogin', $('#start-login'));
  $('#close-tray').onchange = () => setHostPreference('closeToTray', $('#close-tray'));
  $('#open-main').onchange = () => setHostPreference('openMainAtLogin', $('#open-main'));
  $('#start-login-system').onclick = () => run(() => native.bridge.request('host.preferences.openSystem'));
  $('#update-action').onclick = () => runUpdateAction();
  $('#my-group').onchange = () => applyLayout({ myGroupId: $('#my-group').value || null });
  $('#grid-rows').onchange = () => previewGrid(true, true); $('#grid-columns').onchange = () => previewGrid(true, true);
  $('#retry-shortcuts').onclick = () => { void nativeShortcuts?.update(liveShortcuts(), true); };
  $('#labwc-write').onclick = () => run(async () => { await nativeShortcuts?.writeLabwc(); status(t('app.status.labwcWritten')); });
  $('#empty-add').onclick = () => run(() => openEditor());
  $('#show-desktop').onclick = () => run(async () => {
    await workspace.layout.configure({ desktopVisible: true }, workspace.snapshot); render(); status(t('app.status.desktopShown'));
  });
  $('#add-group').onclick = () => run(() => groupEditor());
  $('#toast').onclick = closeToast;
  const groupList = $('#groups');
  groupList.addEventListener('pointerdown', startGroupDrag); groupList.addEventListener('pointermove', moveGroupDrag);
  // A row dragged after a hold still has the drawer's panning, so its moves must not scroll; and a held finger must not
  // bring up the system's text selection or menu.
  groupList.addEventListener('touchmove', event => { if (groupDrag?.active && event.cancelable) event.preventDefault(); }, { passive: false });
  groupList.addEventListener('contextmenu', event => { if (groupDrag) event.preventDefault(); });
  groupList.addEventListener('pointerup', event => endGroupDrag(event, true)); groupList.addEventListener('pointercancel', event => endGroupDrag(event, false));
  // Only the list's own capture counts; a grip handing its touch capture to the list must not end the drag.
  groupList.addEventListener('lostpointercapture', event => { if (event.target === groupList) endGroupDrag(event, false); });
  groupList.addEventListener('click', event => { if (groupDragClick) { event.preventDefault(); event.stopPropagation(); } }, true);
  groupList.addEventListener('keydown', stepGroupOrder);
  const notes = $('#list');
  notes.addEventListener('pointerdown', startNoteDrag); notes.addEventListener('pointermove', moveNoteDrag);
  notes.addEventListener('pointerup', event => endNoteDrag(event, true)); notes.addEventListener('pointercancel', event => endNoteDrag(event, false));
  notes.addEventListener('lostpointercapture', event => { if (event.target === notes) endNoteDrag(event, false); });
  // An image or a selection must not start the browser's own drag while a note may be moving.
  notes.addEventListener('dragstart', event => { if (noteDrag) event.preventDefault(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !noteDrag?.active) return;
    event.preventDefault(); event.stopImmediatePropagation(); const { pointerId } = noteDrag;
    endNoteDrag({ pointerId }, false); if (notes.hasPointerCapture(pointerId)) notes.releasePointerCapture(pointerId);
  }, true);
  $('#search').oninput = render;
  // Board and list are this device's saved choice; the desktop canvas or layout map is only for this session and shows To do.
  document.querySelectorAll('[data-view]').forEach(node => { node.onclick = () => run(async () => {
    const view = node.dataset.view; showDesktop = view === 'desktop';
    if (showDesktop) { filter = 'active'; if ($('#search').value) setSearching(false); }
    else if (view !== mainView(workspace.layout.state)) await workspace.layout.configure({ mainView: view }, workspace.snapshot);
    render();
  }); });
  document.querySelectorAll('[data-filter]').forEach(node => { node.onclick = () => { filter = node.dataset.filter; render(); }; });
  // A phone drawer closes onto the adjust bar before adjusting starts; closing moves the focus, so it is read first.
  const adjust = scope => { const before = document.activeElement; setDrawer(false); run(async () => {
    if (document.querySelector('dialog[open]')) throw new Error(t('app.errors.finishInputOrDialog'));
    await controller.activate(scope); showCanvas(); render(); handOverFocus(before);
  }); };
  $('#operate-group').onclick = () => adjust({ kind: 'group', groupId: activeGroupId });
  $('#operate-all').onclick = () => adjust({ kind: 'all' });
  $('#stop-operation').onclick = () => adjust({ kind: 'none' });
  $('#cycle-prev').onclick = () => run(() => { controller.cycle(activeGroupId, -1); render(); });
  $('#cycle-next').onclick = () => run(() => { controller.cycle(activeGroupId, 1); render(); });
  $('#stack').onclick = () => run(() => openFormation('stack')); $('#spread').onclick = () => run(() => openFormation('spread'));
  $('#undo').onclick = () => run(async () => { await workspace.undo(workAreas()); await controller.reconcile(); render(); status(t('app.status.undone')); });
  $('#formation-scope').onchange = updateFormation; $('#allow-resize').onchange = updateFormation;
  $('#cancel-formation').onclick = () => $('#formation-dialog').close();
  $('#apply-formation').onclick = () => run(async () => { await controller.applyFormation(formationPreview); $('#formation-dialog').close(); render(); status(t('app.status.arranged')); });
  $('#reset-layout').onclick = () => run(() => $('#reset-layout-dialog').showModal());
  $('#cancel-reset-layout').onclick = () => $('#reset-layout-dialog').close();
  $('#confirm-reset-layout').onclick = () => run(async () => {
    if (editorBusy || composing) return;
    if (currentDraft) await flushDraft();
    if (!await controller.endEdit()) return;
    currentDraft = null; controller.cancelDrag(); await controller.activate({ kind: 'none' });
    // Every group goes to the back layer, where new groups start.
    await workspace.layout.reset(workspace.snapshot, screenArea(), arrivalLayer(residentLayers()));
    await workspace.layout.placeNew(workspace.working, workAreas()); await controller.reconcile();
    $('#reset-layout-dialog').close(); renderDesktopSettings(); render();
    // The main window goes back to its default size and position after the layout, which stays reset if this fails;
    // the status says so, as repeating the whole reset would undo any arranging done since.
    if (native?.info.capabilities.hostPreferences !== true) { status(t('app.status.layoutReset')); return; }
    try { await native.bridge.request('host.window.resetPlacement'); }
    catch (error) { status(t('app.status.layoutResetWindowFailed', { error: error.message }), true); return; }
    status(t('app.status.layoutWindowReset'));
  });
  $('#editor-text').oninput = () => { if (!currentDraft || editorBusy) return; currentDraft.content.text = $('#editor-text').value; queueDraft(); };
  // A blank title is left out, so a paper falls back to its first line and an empty draft is still empty.
  $('#editor-heading').oninput = () => {
    if (!currentDraft || editorBusy) return; const title = $('#editor-heading').value.trim();
    if (title) currentDraft.content.title = title; else delete currentDraft.content.title; queueDraft();
  };
  $('#editor-text').addEventListener('compositionstart', () => { composing = true; controller.setComposing(true); });
  $('#editor-text').addEventListener('compositionend', () => { composing = false; controller.setComposing(false); });
  $('#editor-group').onchange = () => { if (!editorBusy) { currentDraft.groupId = $('#editor-group').value; queueDraft(); } };
  $('#edit-tab').onclick = () => showEditorTab(false); $('#preview-tab').onclick = () => showEditorTab(true);
  $('#share-note').onclick = () => run(async () => {
    if (!currentDraft || editorBusy || composing) return;
    setEditorBusy(true);
    try {
      await flushDraft();
      const { title, text } = currentDraft.content;
      const bytes = new TextEncoder().encode(title ? `${title}\n\n${text}` : text);
      const result = await nativeFiles.export(bytes, 'work-fleet-note.md', bytes.length <= 128 * 1024 ? 'shareText' : 'share');
      status(result.completed ? t('app.status.noteShared') : t('app.status.shareCancelled'));
    } finally { setEditorBusy(false); }
  });
  $('#insert-task').onclick = () => { if (editorBusy) return; const text = $('#editor-text'); showEditorTab(false); text.setRangeText('- [ ] ', text.selectionStart, text.selectionEnd, 'end'); currentDraft.content.text = text.value; queueDraft(); text.focus(); };
  $('#editor-form').onsubmit = event => { event.preventDefault(); run(() => saveEditor()); };
  $('#save-copy').onclick = () => run(() => saveEditor({ asCopy: true }));
  $('#overwrite').onclick = () => run(() => saveEditor({ overwrite: true }));
  $('#discard-changes').onclick = () => run(discardEditor);
  $('#close-editor-button').onclick = () => run(closeEditor); $('#close-editor').onclick = () => run(closeEditor);
  $('#capture-inbox-button').onclick = () => run(async () => {
    await ensureCaptureGroup();
    fillGroups($('#capture-group'), activeGroupId); $('#capture-result').textContent = ''; $('#capture-inbox-dialog').showModal(); await refreshCaptures();
  });
  $('#close-capture').onclick = () => { if (!captureBusy) $('#capture-inbox-dialog').close(); };
  $('#capture-inbox-dialog').addEventListener('cancel', event => { if (captureBusy) event.preventDefault(); });
  $('#accept-capture').onclick = () => run(async () => {
    if (captureBusy || !selectedCapture) return; captureBusy = true; $('#accept-capture').disabled = true; $('#discard-capture').disabled = true; $('#capture-group').disabled = true; $('#capture-result').textContent = t('app.shareInbox.saving');
    try {
      const result = await captureInbox.accept(selectedCapture, $('#capture-group').value); selectedCapture = null;
      render(); await refreshCaptures(true); $('#capture-inbox-dialog').close();
      // A share becomes a new note with unsaved changes, opened for a look before it is saved (ADR-061).
      const note = result.unsaved ? currentCard(result.cardId) : null;
      if (note) { await workspace.layout.placeNew(workspace.working, workAreas()); await openEditor(note); }
      else status(t('app.shareInbox.accepted'));
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
    try { await addAttachments([...$('#attachment-input').files]); }
    finally { $('#attachment-input').value = ''; }
  });
  // Files pasted or dropped into the editor become attachments, as the file picker adds them; text stays text.
  const editorFiles = transfer => [...(transfer?.files || [])];
  $('#editor-dialog').addEventListener('paste', event => {
    const files = editorFiles(event.clipboardData); if (!files.length) return;
    event.preventDefault(); run(() => addAttachments(files.map(pastedName)));
  });
  $('#editor-dialog').addEventListener('dragover', event => {
    if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
  });
  $('#editor-dialog').addEventListener('drop', event => {
    const files = editorFiles(event.dataTransfer); if (!files.length) return;
    event.preventDefault(); run(() => addAttachments(files));
  });
  // The status bar shows conflicts only while there are some; the button opens their page in Settings, which waits for
  // an input in progress.
  $('#conflicts-button').onclick = () => run(() => openSettings('revisions'));
  const stage = $('#stage');
  // Stage gestures run in order, so a release never overtakes the one before it.
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
    if (result.kind === 'click' && id) { await controller.select(id, { gesture: true }); renderSelection(); }
    else if (result.kind !== 'ignored') { if (controller.state.activeGroupId) activeGroupId = controller.state.activeGroupId; render(); }
    if (result.kind === 'transferred') status(t('app.status.movedToGroup'));
  });
  stage.onpointercancel = () => { controller.cancelDrag(); render(); };
  stage.addEventListener('lostpointercapture', () => { if (controller.cancelDrag()) render(); });
  document.addEventListener('keydown', event => {
    if (event.isComposing || composing || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape' && document.body.classList.contains('drawer-open')) { event.preventDefault(); setDrawer(false); return; }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === ',' && !handheld) {
      event.preventDefault(); run(() => openSettings(settingsHome())); return;
    }
    const editControl = event.target.closest('input,textarea,select');
    // Shortcuts switch adjust scopes and desktop visibility, which phones and tablets do not have.
    const shortcut = !handheld && shortcutForEvent(event, liveShortcuts(), { editing: Boolean(editControl) });
    if (shortcut) {
      event.preventDefault();
      const admission = desktop && shortcut.target === shortcutActions.capture ? native.bridge.request('desktop.intent').catch(() => ({ intent: null })) : Promise.resolve({ intent: null });
      const before = document.activeElement;
      run(async () => { await desktopAction(shortcut.target, (await admission).intent); handOverFocus(before); }, { duringAdjust: true });
      return;
    }
    if (editControl) return;
    if (event.key === 'Escape') { event.preventDefault(); const before = document.activeElement; run(async () => { await controller.escape(); render(); handOverFocus(before); }, { duringAdjust: true }); }
    if (event.key === 'Shift' && controller.state.dragSession) dragPaint(controller.pointerMove(controller.state.dragSession.current, { pointerId: controller.state.dragSession.pointerId, shiftKey: true, labels: groupLabels }));
  });
  document.addEventListener('keyup', event => {
    if (event.key === 'Shift' && controller.state.dragSession) dragPaint(controller.pointerMove(controller.state.dragSession.current, { pointerId: controller.state.dragSession.pointerId, shiftKey: false, labels: groupLabels }));
  });
}

run(initialize);
