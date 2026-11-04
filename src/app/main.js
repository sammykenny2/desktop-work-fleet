import { Workspace } from '../core/workspace.js';
import { CombinedWorkspace } from '../core/combined-workspace.js';
import { CrossMove } from '../core/cross-move.js';
import { activeGroups, copy, eligible, FleetError, gridRegions, summaryText } from '../core/contracts.js';
import { groupColors } from '../core/palette.js';
import { normalizeShortcut, regionShortcuts, regionTarget, resolveShortcuts, shortcutActions, shortcutForEvent, shortcutRegion, validateShortcuts } from '../core/shortcuts.js';
import { planFormation } from '../layout/formation.js';
import { adjustStage, arrivalLayer, groupLayer, groupLayerOrder, restingLayer, stepGroup } from '../layout/stages.js';
import { groupHighlighted, mainGroup, mainView } from '../layout/store.js';
import { reorderSlots } from '../layout/order.js';
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
import { trashSections } from './trash.js';
import { notifications } from './notifications.js';
import { canSetAside, causeKey, loadFailureCause, workspaceFailureCause } from './data-failure.js';
import { revisionPanel } from './conflicts.js';
import { backupPanel } from './backup.js';
import { AutomaticBackup } from '../backup/automatic.js';
import { IndexedDbBackupJournal, BrowserAutomaticFiles } from '../backup/browser-automatic.js';
import { startAutomaticBackup } from '../backup/lifecycle.js';
import { connectNative, profileBridge } from '../native/bridge.js';
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
// `workspace` is every open profile as one, for the interface; `primary` and `storage` are the profile sync and recovery act on.
let workspace; let primary; let storage; let controller; let lease;
// The other open profiles beside the primary (ADR-066), each with its own storage, purge jobs and backups, and the ones that
// could not open, which do not stop the rest.
let companions = []; let unavailableProfiles = []; let crossMove = null;
let dataProfile = null; let revisionsProfile = null;
// The browser preview opens on its desktop canvas when there is room; desktop hosts and phones open on the papers.
let activeGroupId; let filter = 'active'; let trashOpen = false; let trashTab = 'all'; let showDesktop = !matchMedia('(max-width:640px)').matches;
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
let googleAccount; let syncService; let syncTimer; let syncBusy = false; let accountBusy = false; let listingLag = null; let listingLagWaits = 0;
let datasetStore = null; let purge; let maintenanceTimer; let maintenanceWork = null; let maintenanceAbort = new AbortController();
let maintenancePaused = false; let syncRequested = false; let datasetProblem = null; let pendingReset = null; let recoveryOwed = false; let landingFailed = false;
let maintenanceNotice = null; let maintenanceFailure = null;
let recoveryWork = null; let recoveryBusy = false;
let sharedIdsBlocked = false;
let syncState = 'off'; let captureCount = 0; let handheld = false; let sourceResetAsked = false;
const narrow = matchMedia('(max-width:640px)');
const activeActions = new Set();
const attachmentUrls = new Map(); let attachmentRender = 0;
const unsavedDrafts = new Map();
let profileId = new URLSearchParams(location.search).get('profile') || 'local-preview';
// A phone neither offers nor shows a highlight, even when a restored computer layout carries one. The value stays in the
// layout, so a backup made on the phone still gives it back to a computer.
const highlightShown = (layout, groupId) => !handheld && groupHighlighted(layout, groupId);

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
// A button whose handler decides for itself what waits in the action queue, which earlier actions and a landing sync hold.
function immediateButton(text, handler, className) {
  const node = element('button', text, className); node.type = 'button';
  node.addEventListener('click', event => { event.stopPropagation(); handler(); }); return node;
}
function button(text, action, className) { return immediateButton(text, () => run(action), className); }
// Passing results leave the layout alone. Undo stays available while other results use their own notice.
function status(text, error = false, action = null) {
  if (!text || text === t('app.status.loading')) return;
  const id = action ? 'undo' : error ? `status-error:${text}` : 'status';
  notifications().show(text, { id, renew: !error, kind: error ? 'error' : 'info',
    action: action && { label: action.label, run: () => run(action.run) } });
}
const textOf = text => typeof text === 'function' ? text() : text ?? '';
// Text set outside the render functions keeps how it was built, so relocalize() can build it again in a new language.
const shownText = new Map();
function setText(selector, text) { shownText.set(selector, text); $(selector).textContent = textOf(text); }
async function run(action, { duringAdjust = false, duringRecovery = false, rethrow = false } = {}) {
  if (nativeClosing || (sharedIdsBlocked && !duringRecovery)) return;
  const pendingBefore = workspace?.pendingCount ?? 0;
  // A click can enter the queue before adjustment starts; admit owner UI again when its turn actually runs.
  const invoke = () => { if ((!sharedIdsBlocked || duringRecovery) && (duringAdjust || !adjustOverlayActive())) return action(); };
  const pending = desktop ? desktop.perform(invoke) : Promise.resolve().then(invoke); activeActions.add(pending);
  try { await pending; }
  catch (error) { if (rethrow) throw error; status(error.message, true); }
  finally {
    activeActions.delete(pending);
    syncIfPending(pendingBefore);
  }
}
function syncIfPending(pendingBefore) {
  if (workspace?.pendingCount > pendingBefore) {
    if (syncBusy || maintenanceWork) syncRequested = true; else void syncGoogle();
  }
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
// Each group's paper colour is this device's choice; the settled colours cover a group the desk has not stored yet.
function groupColor(id) {
  const stored = workspace.layout.groupColors;
  return groupColors[stored?.[id] ?? settleGroupColors(stored, workspace.groups())[id] ?? 0];
}
const colorNames = () => [t('app.colors.yellow'), t('app.colors.mint'), t('app.colors.blue'), t('app.colors.peach'), t('app.colors.lavender'),
  t('app.colors.teal'), t('app.colors.pink'), t('app.colors.sand'), t('app.colors.slate')];
// The note as this device shows it, with its unsaved changes; a note never saved has no revision (ADR-061).
function currentCard(id) { return workspace.working.cards.find(card => card.id === id); }
// The sidebar and every group picker list each collection's groups in the order kept on this device.
function shownGroups() { return workspace.orderedGroups(); }
// A group chosen in the sidebar or by a region key is remembered on this device, so after a restart the main window and
// quick capture return to it. A group that is gone falls back to the remembered one, which a merge carries to the
// receiving group, and then to the first. Remembering never holds up the action that chose the group; a failed write
// only says so.
const rememberedGroup = () => mainGroup(workspace.layout.state, shownGroups());
async function rememberGroup() {
  if (activeGroupId) await workspace.layout.setMainGroup(activeGroupId, workspace.snapshot).catch(error => status(error.message, true));
}
// `only` limits a picker to one collection; with several shown, each gets a heading.
function fillGroups(select, selected, only = null) {
  select.replaceChildren();
  for (const { id } of workspace.profiles) {
    if (only && id !== only) continue;
    const options = shownGroups().filter(group => group.profileId === id).map(group => new Option(groupName(group), group.id));
    if (only || workspace.profiles.length < 2) { select.append(...options); continue; }
    const heading = document.createElement('optgroup'); heading.label = sectionName(id); heading.append(...options); select.append(heading);
  }
  select.value = selected || ''; if (select.selectedIndex < 0) select.selectedIndex = 0;
}
const sectionName = id => t(id.startsWith('google:') ? 'app.sections.cloud' : 'app.sections.local');
const profileContext = id => id === profileId ? { id, workspace: primary, storage, purge, automatic, automaticError, backups: nativeBackups, attachments: attachmentFiles }
  : companions.find(companion => companion.id === id);

async function initialize() {
  startLanguage();
  // What the page shows while it loads.
  status(t('app.status.loading')); setSync('off', () => t('sync.status.opening'));
  setText('#storage-note', () => t('sync.status.opening')); renderAccount();
  native = await connectNative();
  // Register before storage can return into a recovery screen. No Workspace exists there to flush.
  native?.bridge.onCloseRequested(() => { void prepareNativeClose(); });
  // Modal dialogs escape their parent's inert state. Also stop their input, including recovery before Workspace exists.
  for (const type of ['click', 'dblclick', 'pointerdown', 'keydown', 'beforeinput', 'input', 'change', 'submit', 'cancel']) {
    document.addEventListener(type, event => {
      if (nativeClosing) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }
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
  try { if (saved) primary = new Workspace(saved, persist); }
  catch (error) { if (recovery && workspaceFailureCause(error, saved)) return showDataFailure(workspaceFailureCause(error, saved)); throw error; }
  primary ||= await Workspace.create({ profileId,
    deviceId: crypto.randomUUID(), area: screenArea(), persist, current: true,
    // Every section starts empty. Only writing a note with no group anywhere creates one (ADR-067).
    bootstrapGroup: false, arrivalLayer: backLayer });
  const history = new DatasetHistory({ workspace: primary, storage, fileStore: () => datasetStore });
  primary.setHistory(history); storage.setAttachmentLoader(id => history.attachment(id));
  purge = new DatasetPurge({ workspace: primary, storage, fileStore: () => datasetStore });
  primary.setArrivalLayer(backLayer);
  // Signed in, the local notes open beside the account's. The browser preview has no account, so a probe names a second profile.
  const second = native ? native.info.companionProfile : new URLSearchParams(location.search).get('companion');
  if (second) await openCompanion(second, backLayer);
  workspace = await CombinedWorkspace.open([{ id: profileId, workspace: primary, storage }, ...companions]);
  // A move across that a crash interrupted finishes first, so nothing below sees a note half way.
  crossMove = new CrossMove(workspace); await crossMove.resume().catch(error => status(error.message, true));
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
    const service = new AutomaticBackup({ workspace: primary, storage, journal, files, vault, appVersion: native?.info.appVersion,
      flush: flushForBackup }); await service.load();
    automatic = { service, files, vault }; monitorAutomatic(automatic, profileId); stopAutomatic = startAutomaticBackup(service);
    addEventListener('pagehide', () => { stopAutomatic(); journal.close(); });
  } catch (error) { automaticError = error; }
  for (const companion of companions) {
    try {
      const journal = native ? companion.storage.journal() : await IndexedDbBackupJournal.open();
      const files = companion.backups?.files || new BrowserAutomaticFiles(); const vault = companion.backups?.vault;
      const service = new AutomaticBackup({ workspace: companion.workspace, storage: companion.storage, journal, files, vault, appVersion: native?.info.appVersion, flush: flushForBackup });
      await service.load(); companion.automatic = { service, files, vault }; monitorAutomatic(companion.automatic, companion.id);
      addEventListener('pagehide', () => { stopCompanionBackups(); journal.close(); });
    } catch (error) { companion.automaticError = error; }
  }
  startCompanionBackups();
  if (native) {
    native.bridge.onEvent('update-state', message => { updateState = message.state; if ($('#settings-dialog').open) renderUpdate(); });
    native.bridge.onEvent('host-background', message => {
      stopAutomatic?.(); stopCompanionBackups(); void run(async () => {
        await flushDraft(); await automatic?.service.whenIdle(); await companionBackupsIdle();
        if (message.id) await native.bridge.request('host.backgroundReady', { id: message.id });
      }, { duringAdjust: true, duringRecovery: true });
    });
    native.bridge.onEvent('host-foreground', () => {
      stopAutomatic?.(); if (automatic && !nativeClosing && !accountBusy && !sharedIdsBlocked) stopAutomatic = startAutomaticBackup(automatic.service);
      if (!nativeClosing && !accountBusy && !sharedIdsBlocked) startCompanionBackups();
      syncService?.resume();
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
  // A dialog's close event does not bubble, so one listener for all of them has to capture it.
  document.addEventListener('close', () => { if (recoveryOwed && datasetProblem) void askDatasetRecovery(); }, true);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { syncService?.resume(); void syncGoogle(); } });
  displayBackend = native?.info.displayBackend ?? null;
  // GNOME Wayland without desktop papers points at the setting that brings them through XWayland.
  const displayHint = displayBackend?.current === 'wayland' && !displayBackend.fixed; const reason = native?.info.desktopReason;
  onLocaleChange(relocalize);
  bindEvents(); render(); status(reason ? displayHint ? t('app.status.desktopReasonXwayland', { reason }) : reason
    : workspace.layout.takeArrivedOffDesktop().length ? t('app.status.arrivedOffDesktop') : '');
  document.body.dataset.ready = 'true';
  $('#share-note').hidden = !native?.info.capabilities.fileShare;
  if (native) await initializeGoogle();
  scheduleMaintenance();
  addEventListener('pagehide', () => { clearTimeout(maintenanceTimer); maintenanceAbort.abort(); }, { once: true });
  if (native?.info.capabilities.shareInbox) {
    captureInbox = new NativeCaptureInbox(native, primary, storage);
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

async function openCompanion(id, backLayer) {
  const scoped = native ? profileBridge(native.bridge, id) : null; const info = native ? { ...native.info, profileId: id } : null;
  if (!native) {
    const held = await acquireProfile(id); if (!held.acquired) throw new Error(t('app.errors.openElsewhere'));
    addEventListener('pagehide', () => held.release());
  }
  const own = native ? new WorkspaceRecordStorage(new NativeRecordStore(scoped, info), id, { legacy: new NativeStorage(scoped, info) })
    : new WorkspaceRecordStorage(await IndexedDbRecordStore.open(), id, { legacy: await IndexedDbStorage.open() });
  addEventListener('pagehide', () => own.close());
  try {
    const saved = await own.load(id); const persist = (...args) => own.save(...args);
    const opened = saved ? new Workspace(saved, persist) : await Workspace.create({ profileId: id, deviceId: crypto.randomUUID(), area: screenArea(), persist,
      current: true, bootstrapGroup: false, arrivalLayer: backLayer });
    const held = new Set([primary, ...companions.map(item => item.workspace)].flatMap(item => [...item.ownIds()]));
    // Only one backup restored into two collections with its ids kept can do this; routing by id could not tell them apart.
    if ([...opened.ownIds()].some(id => held.has(id))) throw new FleetError('shared-ids', t('app.sections.sharedIds'));
    const history = new DatasetHistory({ workspace: opened, storage: own, fileStore: () => null });
    opened.setHistory(history); own.setAttachmentLoader(attachment => history.attachment(attachment)); opened.setArrivalLayer(backLayer);
    companions.push({ id, workspace: opened, storage: own, purge: new DatasetPurge({ workspace: opened, storage: own, fileStore: () => null }),
      backups: native ? nativeBackupAdapters(scoped, info) : null, attachments: native?.info.capabilities.attachmentFiles ? new NativeAttachments(scoped) : null });
  } catch (error) { unavailableProfiles.push({ id, storage: own, error }); }
}

const stopCompanionBackups = () => { for (const companion of companions) { companion.stopAutomatic?.(); companion.stopAutomatic = null; } };
const startCompanionBackups = () => { for (const companion of companions) if (companion.automatic && !companion.stopAutomatic) companion.stopAutomatic = startAutomaticBackup(companion.automatic.service); };
function monitorAutomatic({ service, files }, profile) {
  let previous = null, success = JSON.stringify(service.status.lastSuccess ?? null); const id = `automatic-backup:${profile}`;
  const unsubscribe = service.subscribe(value => {
    const message = value.error?.message ?? null;
    if (!message && JSON.stringify(value.lastSuccess ?? null) !== success) {
      success = JSON.stringify(value.lastSuccess ?? null); previous = null;
      if (notifications().items.get(id)?.kind === 'error' || notifications().dismissed.get(id)?.kind === 'error') notifications().clear(id);
    }
    if (message && message !== previous) notifications().show(message, { id, context: sectionName(profile), kind: 'error',
      action: { label: t('common.retry'), run: () => run(async () => {
        const current = service.status;
        if (!current.enabled || !current.settings) return;
        await files.authorize(current.settings.destinationId);
        const result = await service.run({ force: true });
        if (service.status.error) throw new Error(service.status.error.message);
        if (['saved', 'recovered'].includes(result.kind)) notifications().show(t('backup.automatic.result.saved'), { id, context: sectionName(profile) });
      }, { rethrow: true }) } });
    if (message) previous = message;
  });
  addEventListener('pagehide', unsubscribe, { once: true });
}
const companionBackupsIdle = () => Promise.all(companions.map(companion => companion.automatic?.service.whenIdle()));

async function showIncompatibleLocal() {
  const dialog = $('#data-failure-dialog'), body = $('#data-failure-body'), actions = $('#data-failure-actions');
  const settings = $('#settings-dialog'), host = $('#data-host'), google = profileId.startsWith('google:');
  const note = element('p', '', 'backup-message'); note.setAttribute('role', 'status');
  // There is no Workspace/controller yet. Recovery Settings must not call their ordinary event handlers.
  let busy = false;
  const action = (label, work, className) => {
    const control = element('button', label, className); control.type = 'button';
    control.onclick = async () => {
      if (busy) return;
      try { await work(); } catch (error) { note.textContent = error.message; }
    }; return control;
  };
  dialog.querySelector('h2').textContent = t('app.incompatible.title');
  body.replaceChildren(element('p', t(google ? 'app.incompatible.google' : 'app.incompatible.local')),
    element('p', t('app.incompatible.keep')));
  const agree = element('input'); agree.type = 'checkbox'; agree.id = 'discard-old-local-agree';
  const label = element('label', undefined, 'check'); label.append(agree, document.createTextNode(t('app.incompatible.agree')));
  const discard = action(t('app.incompatible.discard'), async () => {
    if (!agree.checked) return;
    busy = true; discard.disabled = true; agree.disabled = true;
    try {
      // Native reset reopens the same signed-in profile; only the local copy is cleared in this step.
      recoveryWork = storage.reset(profileId); await recoveryWork;
      if (!native) { lease.release(); location.reload(); }
    } catch (error) {
      busy = false; discard.disabled = false; agree.disabled = false;
      throw error;
    } finally { recoveryWork = null; }
  }, 'danger');
  discard.id = 'discard-old-local'; discard.disabled = true;
  agree.onchange = () => { discard.disabled = !agree.checked; };
  host.replaceChildren(element('h3', t('app.incompatible.title')),
    element('p', t(google ? 'app.incompatible.google' : 'app.incompatible.local')), element('p', t('app.incompatible.keep')));
  if (google) host.append(element('p', t('app.incompatible.googleReset')));
  host.append(label, discard, note);
  if (native?.info.capabilities.dataRecovery) host.append(action(t('app.dataFailure.openFolder'), () => native.bridge.request('data.reveal')));
  const open = () => {
    dialog.close(); agree.checked = false; discard.disabled = true; note.textContent = '';
    settings.classList.remove('listing');
    for (const panel of settings.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== 'data';
    for (const item of settings.querySelectorAll('[data-page]')) {
      item.disabled = item.dataset.page !== 'data';
      if (item.dataset.page === 'data') item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    }
    $('#settings-page-title').textContent = t('settings.data.title'); $('#settings-back').hidden = true;
    settings.showModal();
  };
  const close = () => { if (!busy) settings.close(); };
  $('#close-settings').onclick = close; $('#close-settings-list').onclick = close;
  settings.oncancel = event => { if (busy) event.preventDefault(); };
  settings.onclose = () => { if (!dialog.open) dialog.showModal(); };
  $('#settings-button').onclick = open; $('#account-button').onclick = open;
  actions.replaceChildren(action(t('app.incompatible.openSettings'), open));
  dialog.oncancel = event => event.preventDefault(); dialog.showModal(); status(t('app.incompatible.keep'));
  if (native) {
    await native.bridge.request('host.ready');
    try { googleAccount = await native.bridge.request('google.status'); renderAccount(); }
    catch (error) { note.textContent = error.message; }
  }
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
    // Signed out, only the local notes open, so this is the way to them while the account's notes cannot open.
    if (profileId.startsWith('google:')) actions.append(button(t('app.dataFailure.signOut'), () => native.bridge.request('google.signOut')));
  };
  const confirm = () => {
    body.replaceChildren(element('h3', t('app.dataFailure.confirmTitle')), element('p', t('app.dataFailure.confirmMove')),
      element('p', t('app.dataFailure.confirmGoogle')), element('p', t('app.dataFailure.confirmLocal')));
    actions.replaceChildren(button(t('common.cancel'), explain), button(t('app.dataFailure.confirm'), async () => {
      for (const control of actions.querySelectorAll('button')) control.disabled = true;
      body.append(element('p', t('app.dataFailure.settingAside')));
      try { recoveryWork = native.bridge.request('data.setAside'); await recoveryWork; }
      finally { recoveryWork = null; }
    }, 'danger'));
  };
  explain(); status(t(causeKey(cause)), true); dialog.showModal();
  await native.bridge.request('host.ready');
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
  if (transitionError && (workspace.state.cloudRestore || pendingReset && pendingReset.phase !== 'complete')) {
    const failure = resetFailure(transitionError); maintenanceFailure = failure; maintenancePaused = true;
    showMaintenance(() => t('sync.reset.paused', { error: failure.message }), { retry: !datasetProblem, error: true });
  } else if (pendingReset && pendingReset.phase !== 'complete') {
    showMaintenance(() => datasetProgressText(resetProgress(pendingReset)));
  }
  renderGoogleAccess(); renderAccount();
  $('#google-sign-in').onclick = () => { void changeGoogleAccount('signIn'); };
  $('#google-sign-out').onclick = () => { void changeGoogleAccount('signOut'); };
  $('#google-sync').disabled = false;
  setText('#google-sync', workspace.state.cloudRestore ? () => t('sync.actions.resumeOverwrite') : () => t('sync.actions.syncNow'));
  $('#google-sync').onclick = () => {
    if (datasetProblem) { sourceResetAsked = false; void askDatasetRecovery(); }
    else if (workspace.state.cloudRestore) askResumeCloudRestore();
    else if (pendingReset && !pendingReset.ready && pendingReset.phase !== 'complete') resumeMaintenance();
    else { maintenancePaused = false; scheduleMaintenance(); void syncGoogle(true); }
  };
  if (datasetProblem) {
    syncService = null; setText('#google-sync', () => t('sync.recovery.options'));
    setSync('attention', () => t('sync.recovery.paused'), datasetProblem.message); return;
  }
  if (workspace.state.cloudRestore) {
    syncService = null; stopAutomatic?.();
    setSync('attention', () => t('sync.status.overwriteUnfinished'), maintenanceFailure?.message || workspace.state.cloudRestore.error || (() => t('sync.detail.overwriteSaved')));
    return;
  }
  if (pendingReset && !pendingReset.ready && pendingReset.phase !== 'complete') {
    syncService = null; stopAutomatic?.();
    setText('#google-sync', () => t(maintenancePaused ? 'sync.actions.resumeReset' : 'sync.status.resetting'));
    $('#google-sync').disabled = !maintenancePaused;
    setSync(maintenancePaused ? 'error' : 'busy', () => t(maintenancePaused ? 'sync.status.resetUnfinished' : 'sync.status.resetting'),
      maintenanceFailure?.message || (() => datasetProgressText(resetProgress(pendingReset)))); return;
  }
  if (datasetStore) {
    setText('#storage-note', paused ? () => t('sync.storage.paused') : () => t('sync.storage.google'));
    setSync(paused ? 'attention' : 'off', paused ? () => t('sync.status.paused') : () => t('sync.status.waiting'), paused ? googleAccount.pauseReason : '');
    syncService = new DatasetSync({ workspace: primary, storage, fileStore: datasetStore });
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
  $('#google-row').hidden = false; $('#sync-row').hidden = !(connected || paused);
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
  const name = known?.name || (connected ? email || t('sync.account.google') : profileId.startsWith('google:') ? t('sync.account.google')
    : googleAccount?.configured ? t('sync.account.signInPrompt') : t('sync.account.localNotes'));
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
  const problem = ['error', 'attention'].includes(state) && shownDetail;
  const explanation = state === 'off' ? shownDetail : '';
  $('#account-detail').textContent = explanation; $('#account-detail').hidden = !explanation;
  const id = `sync:${profileId}`;
  if (problem && !datasetProblem && !(maintenanceNotice?.error && textOf(maintenanceNotice.text).includes(shownDetail))) notifications().show(shownDetail, { id, kind: 'error', context: sectionName(profileId),
    action: { label: t('settings.account.title'), keepOpen: true, run: () => run(() => openSettings('account')) } });
  else if (['ok', 'off'].includes(state) || problem) notifications().clear(id);
  updateAttention();
  if (state === 'ok' || state === 'pending') loadGoogleProfile();
}
// The drawer hides the account chip and the sidebar links on phones, so their warnings show on the drawer button.
// Conflicts show in the status bar, outside the drawer.
function updateAttention() {
  $('#attention-dot').hidden = !(captureCount || ['error', 'attention'].includes(syncState));
}
async function syncGoogle(force = false) {
  // Recovery is an explicit user choice. Timers and foreground/online events must not retry the
  // blocked dataset and reopen its prompt over Settings while the user reads the reset controls.
  if (datasetProblem || sharedIdsBlocked) return;
  // A retry is already set for when the backoff ends, and starting earlier would only report the backoff as a failure.
  if (!force && listingLag?.service === syncService) return;
  // Settings edits nothing a sync could overwrite and holds Sync now, so it does not hold syncing; a running backup or
  // restore on its data page does, and so does the versions page, whose choices name the versions it shows.
  const settings = $('#settings-dialog');
  if (maintenanceWork) { syncRequested = true; return; }
  if (!syncService || syncBusy || nativeClosing || accountBusy || composing || dataPanel?.busy() || dataPanel?.blocksSync() || revisions
    || [...document.querySelectorAll('dialog[open]')].some(dialog => dialog !== settings)) return;
  const sourceSync = syncService; const sourceProfile = profileId;
  let completed = false;
  const current = () => !nativeClosing && !accountBusy && syncService === sourceSync && profileId === sourceProfile;
  syncBusy = true; $('#google-sync').disabled = true;
  const activity = async () => {
    if (!current()) return;
    setSync('busy', () => t('sync.status.syncing'));
    const flush = () => current() ? flushDraft() : undefined;
    await (desktop ? desktop.perform(flush) : flush());
  };
  if (force || workspace.pendingCount) setSync('busy', () => t('sync.status.syncing'));
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
    // Drive answers outside the action queue, so local work and the desktop stay usable during a sync (ADR-064).
    if (!current()) return;
    const result = await sourceSync.sync({ force, onActivity: activity, land: landSync });
    if (landingFailed) { landingFailed = false; sourceSync.invalidateIdle(); }
    if (!current()) return;
    completed = result?.phase === 'idle';
    if (completed) listingLagWaits = 0;
    if (result?.phase === 'waiting-initialization') {
      setSync('attention', () => t('sync.status.waitingInitialization'), () => t('sync.detail.waitingInitialization')); return;
    }
    if (googleAccount?.paused) {
      const account = await native.bridge.request('google.status');
      if (!current()) return;
      googleAccount = account; renderGoogleAccess(); renderAccount();
      setText('#storage-note', googleAccount.paused ? () => t('sync.storage.paused') : () => t('sync.storage.google'));
      if (googleAccount.paused) { setSync('attention', () => t('sync.status.paused'), googleAccount.pauseReason); return; }
    }
    const pending = workspace.pendingCount; const at = workspace.syncState.lastSuccessfulSyncAt;
    if (pending) setSync('pending', () => plural('sync.status.pending', pending));
    else if (result?.phase !== 'idle') setSync('busy', () => t('sync.status.syncing'));
    else setSync('ok', () => t('sync.status.syncedAt', { time: formatDate(at, { hour: '2-digit', minute: '2-digit' }) }));
  } catch (error) {
    if (!current()) return;
    if (['dataset-changed', 'incompatible-cloud-data', 'initialization-conflict', 'source-reset-superseded'].includes(error.code)) {
      datasetProblem = error; maintenancePaused = true;
      setSync('attention', () => t('sync.recovery.paused'), error.message);
      setText('#google-sync', () => t('sync.recovery.options')); void askDatasetRecovery(); return;
    }
    // Drive's filtered lists can lag its feed for a moment. Nothing failed and the cursor held, so this is only "not yet".
    // Six doubling backoffs always outlast the 30 seconds before uploads go ahead, so those run before any report.
    if (error.code === 'dataset-visibility' && listingLagWaits < 6) {
      listingLagWaits++;
      setSync('busy', () => t('sync.status.syncing'));
      const wait = listingLag = { service: sourceSync };
      // Rounded up, because a pass a moment before the backoff ends is refused and reported as a failure.
      setTimeout(() => { if (listingLag === wait) listingLag = null; void syncGoogle(); }, Math.ceil(Math.max(0, sourceSync.status.nextAttemptAt - Date.now())) + 1);
      return;
    }
    const vaultPaused = ['vault-locked', 'vault-unavailable', 'storage-cleanup', 'vault-unlock-cancelled', 'vault-unlock-timeout'].includes(error.code);
    if (vaultPaused) {
      googleAccount = { ...googleAccount, connected: false, paused: true, pauseReason: error.message };
      renderGoogleAccess(); renderAccount();
    }
    setSync(vaultPaused ? 'attention' : 'error', vaultPaused ? () => t('sync.status.paused') : () => t('sync.status.failed'), error.message);
    if (error.code === 'unauthorized' || error.code === 'source-permission') setText('#google-sign-in', () => t('sync.google.signInGoogleAgain'));
  }
  finally {
    syncBusy = false; $('#google-sync').disabled = false;
    const again = syncRequested || completed && workspace.pendingCount > 0; syncRequested = false;
    if (again && current()) queueMicrotask(() => { void syncGoogle(); });
  }
}
// What a pass pulled lands in one queue turn with everything that depends on it, so no action sees one without the other.
// A sync therefore waits for the queue here, and nothing holding the queue may wait for a sync.
function landSync(receive) {
  const land = async () => {
    const received = await receive();
    if (nativeClosing || accountBusy) return received;
    // The start checked for this, but such ids can arrive later, from another device. Routing by id would now write to the wrong
    // collection, so the page reopens at once, and that check sets the later collection aside with its explanation.
    if (workspace.sharedIds().length) {
      sharedIdsBlocked = true; stopAutomatic?.(); stopCompanionBackups();
      document.documentElement.inert = true;
      try { await flushDraft(); location.reload(); }
      catch (error) { document.documentElement.inert = false; showSharedIdsRecovery(error); }
      return received;
    }
    // The data is stored by now. Failing to show it must not stop uploads, and the next pass lands again to retry.
    try {
      activeGroupId = activeGroups(workspace.snapshot).some(group => group.id === activeGroupId) ? activeGroupId : rememberedGroup();
      try { await controller.reconcile(); await workspace.layout.placeNew(workspace.working, workAreas()); } finally { render(); }
      if (workspace.layout.takeArrivedOffDesktop().length) status(t('app.status.arrivedOffDesktop'));
    } catch (error) { landingFailed = true; status(error.message, true); }
    return received;
  };
  return desktop ? desktop.perform(land) : land();
}

// Ambiguous ids stop ordinary work. A failed flush keeps the page and any native quick editor alive until it can be saved.
function showSharedIdsRecovery(error) {
  status(error.message, true);
  const dialog = element('dialog'); dialog.id = 'shared-ids-recovery';
  const message = element('p', error.message, 'error'); message.setAttribute('role', 'status');
  const text = element('textarea'); text.readOnly = true; text.rows = 8; text.style.width = '100%';
  const showText = () => { text.value = [currentDraft?.content.title, currentDraft?.content.text].filter(Boolean).join('\n\n'); };
  showText();
  const field = element('label', t('app.sections.keptText'), 'field'); field.append(text);
  const retry = immediateButton(t('common.retry'), async () => {
    if (retry.disabled || nativeClosing) return;
    retry.disabled = true;
    const pending = desktop ? desktop.perform(flushDraft) : Promise.resolve().then(flushDraft); activeActions.add(pending);
    try { await pending; dialog.close(); document.documentElement.inert = true; location.reload(); }
    catch (error) { message.textContent = error.message; showText(); }
    finally { activeActions.delete(pending); retry.disabled = false; }
  }, 'primary');
  dialog.addEventListener('cancel', event => event.preventDefault());
  dialog.onclose = () => dialog.remove();
  dialog.append(element('h2', t('app.sections.saveBeforeReopen')), element('p', t('app.sections.saveBeforeReopenHint')), message, field, retry);
  document.body.append(dialog); dialog.showModal();
}

// A backup refuses a snapshot whose workspace changed while it was read, and a running pass's landing changes it.
async function flushForBackup() {
  await syncService?.whenIdle();
  await (desktop ? desktop.perform(flushDraft) : flushDraft());
}

function resetFailure(error) {
  return { kind: 'dataset-ui-error', code: error.code ?? 'storage-error',
    message: error.code === 'native-outcome-unknown' ? t('sync.reset.unconfirmed') : error.message };
}
function showMaintenance(text, { retry = false, error = false, completed = false, profile = profileId } = {}) {
  if (profile === profileId) maintenanceNotice = { text, retry, error, completed };
  const id = `maintenance:${profile}`;
  if (!textOf(text)) { notifications().clear(id); return; }
  notifications().show(textOf(text), { id, context: sectionName(profile), kind: error ? 'error' : completed ? 'info' : 'progress',
    action: retry ? { label: t(workspace.state.cloudRestore ? 'sync.actions.resumeOverwrite'
      : pendingReset && !pendingReset.ready ? 'sync.actions.resumeReset' : 'app.purge.retry'), run: resumeMaintenance } : null });
}
function resetProgress(job) {
  return { phase: job.phase, completed: job.deleted, total: job.captured, ready: job.ready, folders: job.retainedFolders };
}
function reportDatasetProgress(value) {
  const text = () => datasetProgressText(value); showMaintenance(text, { completed: value.phase === 'complete' });
  if (pendingReset && !pendingReset.ready && !workspace.state.cloudRestore) {
    setSync('busy', () => t('sync.status.resetting'), text);
    setText('#google-sync', () => t('sync.status.resetting')); $('#google-sync').disabled = true;
  }
}
function resumeMaintenance() {
  if (nativeClosing || maintenanceWork || datasetProblem) return;
  maintenancePaused = false;
  for (const companion of companions) if (companion.pausedUntil) companion.pausedUntil = 1;
  if (pendingReset && pendingReset.phase !== 'complete') reportDatasetProgress(resetProgress(pendingReset));
  else if (maintenanceNotice && !maintenanceNotice.completed) showMaintenance(maintenanceNotice.text);
  scheduleMaintenance(0);
}

// Each turn performs one cleanup unit. Settings can observe a confirmed reset; other dialogs and captures still wait.
function scheduleMaintenance(delay = 1500) {
  clearTimeout(maintenanceTimer);
  if (nativeClosing || maintenanceAbort.signal.aborted) return;
  maintenanceTimer = setTimeout(() => { void maintainDataset(); }, delay);
}
async function stopMaintenance() {
  clearTimeout(maintenanceTimer); maintenanceAbort.abort(); await maintenanceWork?.catch(() => {});
}
async function maintainDataset() {
  if (sharedIdsBlocked) return;
  const resetPending = workspace.state.cloudRestore || pendingReset && pendingReset.phase !== 'complete';
  // The account's own work waits for its sign-in; a local collection's does not.
  const sourceWaits = profileId.startsWith('google:') && (!googleAccount?.connected || !workspace.syncState.dataset && !workspace.state.cloudRestore && !pendingReset);
  if (datasetProblem || maintenanceWork || maintenancePaused || accountBusy || syncBusy || nativeClosing || editorBusy || composing
    || dataPanel?.busy() || dataPanel?.blocksSync() || revisions
    || [...document.querySelectorAll('dialog[open]')].some(dialog => !resetPending || dialog !== $('#settings-dialog'))
    || sourceWaits && !companions.length) {
    scheduleMaintenance(); return;
  }
  let more = false; let listingBehind = false;
  maintenanceWork = (async () => {
    for (const companion of companions) {
      if (companion.pausedUntil > Date.now()) continue;
      // Its turn again: its notice goes, and comes back only if it fails again.
      if (companion.pausedUntil) companion.pausedUntil = 0;
      try {
        if (await purgeStep(companion.purge, companion.id) || await companion.storage.maintenance()) { more = true; return; }
        const id = `maintenance:${companion.id}`;
        if (notifications().items.get(id)?.kind === 'error' || notifications().dismissed.get(id)?.kind === 'error') notifications().clear(id);
      }
      catch (error) {
        if (maintenanceAbort.signal.aborted) throw error;
        // Its trouble is its own: the others carry on, and this one tries again later or on Retry.
        companion.pausedUntil = Date.now() + 60000;
        showMaintenance(() => t('app.purge.paused', { error: error.message }), { retry: true, error: true, profile: companion.id });
      }
    }
    if (sourceWaits) return;
    if (maintenanceFailure) { await storage.deleteJob('dataset-ui-error'); maintenanceFailure = null; }
    if (workspace.state.cloudRestore) {
      const result = await advanceDatasetRestore({ workspace: primary, storage, fileStore: datasetStore, signal: maintenanceAbort.signal,
        progress: reportDatasetProgress });
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
      pendingReset = await reset.step({ signal: maintenanceAbort.signal, progress: reportDatasetProgress }); more = pendingReset.phase !== 'complete';
      if (!wasReady && pendingReset.ready) { await initializeGoogle(); if (automatic) stopAutomatic = startAutomaticBackup(automatic.service); }
      return;
    }
    if (await purgeStep(purge)) more = true;
    else {
      more = await cleanupDatasetTransition(storage) || await storage.maintenance();
      const datasetId = workspace.syncState.dataset?.plan.datasetId;
      if (pendingReset?.residualLegacy || datasetId && await storage.getControl(`legacy-residual:${datasetId}`))
        showMaintenance(() => t('sync.reset.residual'), { error: true });
    }
  })();
  try { await maintenanceWork; }
  catch (error) {
    if (!maintenanceAbort.signal.aborted) {
      maintenancePaused = error.code !== 'dataset-visibility';
      // Cleanup waiting for a listing asks Drive each time, so it asks no more often than a sync does. A reset keeps its pace.
      listingBehind = !resetPending && error.code === 'dataset-visibility';
      const failure = resetPending ? resetFailure(error) : { kind: 'dataset-ui-error', code: error.code ?? 'storage-error', message: error.message };
      if (resetPending && maintenancePaused) {
        maintenanceFailure = failure;
        await storage.putJob('dataset-ui-error', failure).catch(() => {});
        if (workspace.state.cloudRestore || !pendingReset?.ready) setSync('error',
          () => t(workspace.state.cloudRestore ? 'sync.status.overwriteUnfinished' : 'sync.status.resetUnfinished'), failure.message);
      }
      const message = () => t(resetPending ? 'sync.reset.paused' : 'app.purge.paused', { error: failure.message });
      showMaintenance(message, { retry: maintenancePaused, error: true });
      if (['dataset-changed', 'source-reset-superseded'].includes(error.code)) {
        await storage.putJob('dataset-ui-error', { kind: 'dataset-ui-error', code: error.code, message: error.message });
        datasetProblem = error; setSync('attention', () => t('sync.recovery.paused'), error.message);
        setText('#google-sync', () => t('sync.recovery.options'));
        showMaintenance(message, { error: true });
      }
    }
  } finally {
    maintenanceWork = null;
    if (pendingReset && !pendingReset.ready && pendingReset.phase !== 'complete') {
      $('#google-sync').disabled = !maintenancePaused && !datasetProblem;
      if (!datasetProblem) setText('#google-sync', () => t(maintenancePaused ? 'sync.actions.resumeReset' : 'sync.status.resetting'));
    }
    if (syncRequested) { syncRequested = false; void syncGoogle(); }
    scheduleMaintenance(listingBehind ? 20000 : more ? 250 : 2500);
  }
}

async function purgeStep(job, profile = profileId) {
  const result = await job.step({ signal: maintenanceAbort.signal });
  if (!result) return false;
  const key = { pending: 'app.purge.pending', committed: 'app.purge.committed', 'cloud-cleanup': 'app.purge.committed',
    'local-cleanup': 'app.purge.local', complete: 'app.purge.complete', 'needs-preview': 'app.purge.review' }[result.phase];
  if (key) showMaintenance(() => t(key), { profile, completed: result.phase === 'complete', error: result.phase === 'needs-preview' });
  await controller.reconcile(); await workspace.layout.placeNew(workspace.working, workAreas()); render();
  return true;
}
// Each collection purges its own notes; the dialog says what each part reaches.
async function confirmPurge(ids) {
  if (!ids.length) return;
  const parts = workspace.profiles.map(({ id }) => ({ id, ids: ids.filter(card => workspace.ownerOfCard(card).id === id) })).filter(part => part.ids.length);
  for (const part of parts) {
    try { part.preview = await profileContext(part.id).purge.preview(part.ids); }
    // Emptying cloud notes needs the account. That must not hold back what only this device keeps.
    catch (error) { part.problem = error.code === 'history-offline' ? t('app.purge.needsConnection', { section: sectionName(part.id) }) : error.message; }
  }
  const ready = parts.filter(part => part.preview); const chosen = ready.flatMap(part => part.ids);
  if (!ready.length) throw new Error(parts[0].problem);
  const dialog = element('dialog'); dialog.id = 'purge-dialog';
  dialog.append(element('h2', t(chosen.length === 1 ? 'app.purge.title' : 'app.purge.emptyTitle')),
    element('p', t('app.purge.warning', { count: chosen.length })),
    ...parts.filter(part => part.problem).map(part => element('p', t('app.purge.skipped', { section: sectionName(part.id), count: part.ids.length, problem: part.problem }), 'purge-skipped')),
    ...ready.map(part => element('p', t('app.purge.part', { section: sectionName(part.id), count: part.ids.length,
      reach: t(part.id.startsWith('google:') ? 'app.purge.cloud' : 'app.purge.device') }))));
  const list = element('ul');
  for (const id of chosen.slice(0, 10)) list.append(element('li', summaryText(workspace.snapshot.cards.find(card => card.id === id))));
  dialog.append(list);
  const cancel = button(t('common.cancel'), () => dialog.close());
  const confirm = button(t('app.purge.confirm'), async () => {
    confirm.disabled = true; let queued = false;
    try { for (const part of ready) { await profileContext(part.id).purge.enqueue(part.preview); queued = true; } }
    finally {
      confirm.disabled = false;
      // What is queued goes ahead whatever came after it, so Cancel must not stay on offer.
      if (queued) { dialog.close(); for (const companion of companions) if (companion.pausedUntil) companion.pausedUntil = 1; maintenancePaused = false; showMaintenance(() => t('app.purge.pending')); scheduleMaintenance(0); }
    }
  }, 'danger'); confirm.id = 'confirm-purge';
  const actions = element('div', undefined, 'dialog-actions'); actions.append(cancel, confirm); dialog.append(actions);
  dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
}

async function changeGoogleAccount(action) {
  if (accountBusy || nativeClosing || dataPanel?.busy()) return; accountBusy = true;
  const oldSync = syncService; clearInterval(syncTimer); stopAutomatic?.(); stopCompanionBackups();
  try {
    await stopMaintenance(); await automatic?.service.whenIdle(); await companionBackupsIdle(); await oldSync?.stop(); await oldSync?.whenIdle(); syncService = null; datasetStore = null;
    desktop?.beginClose(); if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: true });
    await (desktop ? desktop.perform(flushDraft) : flushDraft()); await desktop?.whenIdle(); desktop?.sealClose();
    document.body.inert = true;
    if (action === 'signIn') {
      status(t('sync.google.signingIn'));
      const result = await native.bridge.request('google.signIn');
      await native.bridge.request('google.open', { accountId: result.accountId });
    } else await native.bridge.request('google.signOut');
  } catch (error) {
    document.body.inert = false; status(error.message, error.code !== 'google-cancelled'); await desktop?.cancelClose();
    if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: false }).catch(() => {});
    if (automatic) stopAutomatic = startAutomaticBackup(automatic.service);
    startCompanionBackups();
    accountBusy = false; maintenanceAbort = new AbortController(); await initializeGoogle(); scheduleMaintenance();
  }
}

// The workspace a data reset deletes, and what it leaves on this device.
// Resetting a collection beside an account deletes only that collection's data; the page opens again without it.
function companionResetPlan(companion) {
  return { cloud: false, keeps: [t('settings.data.keeps.backups'), t('settings.data.keeps.otherCollection')], blocked: null, detail: t('backup.reset.deletesCollectionLocal'),
    target: t('settings.data.target.collection', { section: sectionName(companion.id) }),
    run: async say => {
      say(t('sync.reset.deletingDevice'));
      await runDatasetChange(async () => { await browserJournal?.reset(companion.id); await companion.storage.reset(companion.id); return { localReset: true }; });
      return { localReset: true };
    } };
}
function resetPlan() {
  const google = profileId.startsWith('google:');
  const keeps = [t('settings.data.keeps.backups')];
  if (captureInbox) keeps.push(t('settings.data.keeps.shares'));
  if (google) keeps.push(t('settings.data.keeps.googleSignIn'), t('settings.data.keeps.localNotes'));
  else if (googleAccount?.configured) keeps.push(t('settings.data.keeps.googleWorkspace'));
  return { cloud: google, keeps, run: resetWorkspace, detail: companions.length ? t('backup.reset.deletesCollectionCloud') : undefined,
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
        const result = await syncService?.syncWaiting({ force: true, land: landSync });
        if (result?.phase === 'waiting-initialization') throw new Error(t('sync.errors.initializingRestore'));
      }
      return prepareDatasetRestore({ ...options, workspace: primary, storage, fileStore: datasetStore, recovery: Boolean(datasetProblem) });
    },
    run: (plan, safety, say) => runCloudRestore(say, { plan, safety }) };
}

function backupSourceOptions() {
  const google = profileId.startsWith('google:');
  return { target: google ? t('settings.data.target.google', { account: googleAccount?.email || t('sync.account.current') })
    : native ? t('settings.data.target.device') : t('settings.data.target.browser'),
    sync: async () => {
      if (datasetProblem || !googleAccount?.connected || !syncService || workspace.state.cloudRestore || nativeClosing || accountBusy)
        throw new Error(t('sync.errors.cannotSync'));
      syncBusy = true; $('#google-sync').disabled = true; setSync('busy', () => t('sync.status.syncing'));
      try {
        // A pass already running can predate what this export covers, so the export has its own pass after it.
        const service = syncService; await service.whenIdle();
        const result = await service.syncWaiting({ force: true, land: landSync });
        if (result?.phase === 'waiting-initialization') throw new Error(t('sync.errors.initializingExport'));
        setSync('ok', () => t('sync.status.synced'));
      } catch (error) { setSync('error', () => t('sync.status.failed'), error.message); throw error; }
      finally { syncBusy = false; $('#google-sync').disabled = false; }
    } };
}

async function applyCompanionRestore(companion, plan, signal) {
  companion.stopAutomatic?.(); companion.stopAutomatic = null;
  try {
    await companion.automatic?.service.whenIdle();
    const apply = () => companion.workspace.applyRestore(plan, { signal,
      persist: (state, revision, attachments, options) => companion.storage.saveWithAttachments(state, revision, attachments, options) });
    return await (desktop ? desktop.perform(apply) : apply());
  } finally { startCompanionBackups(); }
}
async function applyLocalRestore(plan, signal) {
  stopAutomatic?.();
  try {
    await automatic?.service.whenIdle();
    const apply = () => primary.applyRestore(plan, { signal,
      persist: (state, revision, attachments, options) => storage.saveWithAttachments(state, revision, attachments, options) });
    return await (desktop ? desktop.perform(apply) : apply());
  } finally { if (automatic) stopAutomatic = startAutomaticBackup(automatic.service); }
}

function datasetProgressText({ phase, completed = 0, total = 0, ready = false, folders = 0 }) {
  const key = ['capture', 'capture-restart'].includes(phase) ? 'sync.reset.capturing'
    : phase === 'fence' ? 'sync.reset.marking'
    : phase === 'initialize' ? 'sync.reset.preparing'
    : phase === 'initialize-progress' ? 'sync.reset.initializing'
    : phase === 'initialize-verify' || phase === 'activate' || phase === 'cleanup' && !ready ? 'sync.reset.activating'
    : phase === 'clearing' ? 'sync.reset.clearing'
    : phase === 'cleanup' ? 'sync.reset.cleanup'
    : ['residual-audit', 'audit-restart', 'journal-cleanup'].includes(phase) ? 'sync.reset.verifying'
    : phase === 'complete' ? folders > 0 ? 'sync.reset.cleanedWithFolders' : 'sync.reset.cleaned' : 'sync.recovery.working';
  return t(key, { done: completed, total, folders });
}

// The transition owns the writer until it reloads. Plan validation still uses the revision shown in its preview.
async function runDatasetChange(work) {
  if (accountBusy || nativeClosing) throw new Error(t('sync.errors.accountBusy'));
  accountBusy = true; clearInterval(syncTimer); stopAutomatic?.(); stopCompanionBackups();
  const before = workspace.state, oldReset = await storage.getJob('dataset-reset');
  try {
    await stopMaintenance(); await automatic?.service.whenIdle(); await companionBackupsIdle();
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
    startCompanionBackups();
    if (native) await initializeGoogle(); scheduleMaintenance(); throw error;
  }
}

async function runCloudRestore(say, { plan, safety } = {}) {
  requireConnected();
  if (!plan) { resumeMaintenance(); say(t('sync.status.overwriteUnfinished')); return; }
  await runDatasetChange(async () => {
    await plan.stage(primary, storage, datasetStore, safety);
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
  if (nativeClosing || sourceResetAsked) return;
  // A pass can fail under any dialog; the question it could not ask over one is asked when the dialog closes.
  recoveryOwed = [...document.querySelectorAll('dialog[open]')].some(dialog => dialog !== $('#settings-dialog'));
  if (recoveryOwed) return;
  sourceResetAsked = true;
  const dialog = element('dialog'); dialog.id = 'source-reset-dialog';
  const message = element('p', '', 'backup-message'); message.setAttribute('role', 'status');
  const body = element('div'), actions = element('div', undefined, 'dialog-actions'); let busy = false;
  const ready = new WeakMap();
  const action = (label, work, className) => {
    const control = element('button', label, className); control.type = 'button';
    control.onclick = async () => {
      if (busy || nativeClosing) return; busy = true; recoveryBusy = true; actions.querySelectorAll('button').forEach(button => { button.disabled = true; });
      try { await work(); } catch (error) { message.textContent = error.message; }
      finally { busy = false; recoveryBusy = false; actions.querySelectorAll('button').forEach(button => { button.disabled = ready.has(button) && !ready.get(button)(); }); }
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
      const preview = await previewDatasetRejoin({ workspace: primary, storage, fileStore: datasetStore });
      body.replaceChildren(element('p', t('sync.recovery.rejoinPreview', { account, pending: preview.pending, drafts: preview.drafts, cards: preview.cards })));
      actions.replaceChildren(exportFirst, later, action(t('sync.recovery.confirmRejoin'), async () => runDatasetChange(() =>
        stageDatasetRejoin({ workspace: primary, storage, fileStore: datasetStore, preview })), 'danger'));
    }));
    actions.append(action(t('sync.recovery.recover'), async () => {
      requireConnected(); await flushDraft();
      // Only current content and locally available attachments may be promised after loss. The safety archive uses that same explicit coverage.
      const backup = await createBackup({ workspace: primary, storage, coverage: 'current-state-only', appVersion: native?.info.appVersion });
      const document = await openBackup(backup.bytes, { requireCurrent: true });
      const plan = await prepareDatasetRestore({ workspace: primary, storage, fileStore: datasetStore, document, workAreas: workAreas(), recovery: true });
      let safety = null;
      const confirm = action(t('sync.recovery.confirmRecover'), async () => runCloudRestore(text => { message.textContent = text; }, { plan, safety }), 'danger');
      confirm.disabled = true; ready.set(confirm, () => Boolean(safety));
      body.replaceChildren(element('p', t('sync.recovery.recoverPreview', { account, cards: backup.manifest.counts.cards, drafts: backup.manifest.counts.drafts })),
        element('p', t('backup.coverage.currentHint')), element('p', t('backup.reset.updateDevices')));
      const password = element('input'); password.type = 'password'; password.autocomplete = 'new-password'; password.maxLength = 1024;
      const passwordLabel = element('label', t('backup.export.password'), 'field'); passwordLabel.append(password); body.append(passwordLabel);
      const save = action(t('backup.restore.saveSafety'), async () => {
        if ([...password.value].length < 12) throw new Error(t('backup.errors.passwordTooShort'));
        const destination = await nativeBackups.manual.chooseDestination({ requireConfirmed: true });
        safety = await saveSafetyBackup({ workspace: primary, storage, password: password.value, coverage: 'current-state-only', appVersion: native.info.appVersion, save: value => destination.save(value) });
        password.value = '';
        confirm.disabled = false; message.textContent = t('backup.restore.safetySaved');
      });
      // A disabled confirmation is also guarded by the opaque safety receipt in plan.stage().
      confirm.onclick = async () => {
        if (busy || nativeClosing || !safety) return; busy = true; recoveryBusy = true;
        try { await runCloudRestore(text => { message.textContent = text; }, { plan, safety }); }
        catch (error) { message.textContent = error.message; busy = false; }
        finally { recoveryBusy = false; }
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
// Discarding drops a note's unsaved changes. A notification can bring them back while the note has no newer ones.
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
        sessionId: desktopInfo.sessionId, sequence, topology: desktopInfo.topology ?? 0, workspaceRevision: workspace.revision, layers: desktopInfo.layers, residentLayers: residentLayers(), editor: currentDesktopEditor(), notice: desktopNotice,
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
        currentDraft = copy(workspace.draft(draftId) || currentDraft); remoteEditor = null;
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
function liveShortcuts() { const layout = workspace.layout.state; return resolveShortcuts(layout.shortcuts, layout.liveSlots); }
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
  if (region !== null) { target = workspace.layout.state.liveSlots[region - 1]; if (!target) return; }
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
    activeGroupId = target; trashOpen = false; const stages = desktopStages();
    announce(target, stageNames()[stage], stages.indexOf(stage) + 1, stages.length);
    await rememberGroup();
  }
  else {
    const changed = await controller.activate(target === '@stop' ? { kind: 'none' } : target === shortcutActions.all ? { kind: 'all' } : { kind: 'group', groupId: target });
    if (changed && target !== shortcutActions.all && target !== '@stop') { activeGroupId = target; trashOpen = false; await rememberGroup(); }
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
  try { rect = groupId && gridRegions(layout.grid).find(region => region.groupId === groupId) || rect; } catch { /* Overflowing groups use the whole area. */ }
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
  if (workspace && native.info.platform === 'android' && dismissTopLayer()) { await native.bridge.request('host.closeCancel').catch(() => {}); return; }
  // Idle Settings, recovery notices and unconfirmed destructive choices own no work and must not veto Quit.
  // User operations that can need consent or replace the writer must finish/cancel before a close can start.
  if (composing) { await cancelNativeClose(t('app.close.finishInput')); return; }
  if (accountBusy || recoveryBusy || dataPanel?.busy() || revisions?.busy()) { await cancelNativeClose(t('app.close.finishOperation')); return; }
  const dialogs = [...document.querySelectorAll('dialog[open]')].map(dialog => [dialog, dialog.inert]);
  const stoppedSync = syncService;
  nativeClosing = true; document.body.inert = true; desktop?.beginClose();
  for (const [dialog] of dialogs) dialog.inert = true;
  // An action waiting for a confirmation would wait for ever behind an inert dialog, and so would the close.
  for (const waiting of document.querySelectorAll('#confirm-dialog')) waiting.close();
  clearInterval(syncTimer); stopAutomatic?.(); stopCompanionBackups();
  try {
    if (!workspace) await recoveryWork?.catch(() => {});
    else {
      if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: true });
      await stopMaintenance();
      await stoppedSync?.stop({ endSession: false }); await stoppedSync?.whenIdle();
      await Promise.allSettled([...activeActions]);
      await automatic?.service.whenIdle(); await companionBackupsIdle();
      if (desktop) { await desktop.whenIdle(); await desktop.perform(flushDraft); } else await flushDraft();
      if (desktop) { desktop.sealClose(); await desktop.whenIdle(); }
      await workspace.whenIdle(); await storage.whenIdle(); await Promise.all(companions.map(companion => companion.storage.whenIdle()));
      if (unsavedDrafts.size) throw new Error(t('app.close.unsavedDrafts'));
    }
    await native.bridge.request('host.closeReady');
    // Acknowledgement is terminal: the native host is tearing down scenes, transfers and the database.
    // Keep input and background producers stopped even if the host takes time to exit.
  } catch (error) {
    await desktop?.cancelClose();
    if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: false }).catch(() => {});
    nativeClosing = false; document.body.inert = false;
    for (const [dialog, inert] of dialogs) dialog.inert = inert;
    if (workspace) {
      if (stoppedSync && syncService === stoppedSync) {
        syncService = new DatasetSync({ workspace: primary, storage, fileStore: datasetStore });
        syncTimer = setInterval(() => { void syncGoogle(); }, 20000);
      }
      if (automatic) stopAutomatic = startAutomaticBackup(automatic.service);
      startCompanionBackups();
      maintenanceAbort = new AbortController(); scheduleMaintenance();
    }
    await cancelNativeClose(t('app.close.failed', { error: error.message }));
  }
}
async function cancelNativeClose(message) {
  status(message, true);
  // macOS presents the reason natively above Sparkle. Other hosts need a top-layer explanation, not a hidden status line.
  if (native.info.platform !== 'macos') {
    $('#close-error-dialog')?.remove();
    const dialog = element('dialog'); dialog.id = 'close-error-dialog';
    const close = element('button', t('common.close')); close.type = 'button'; close.onclick = () => dialog.close();
    dialog.append(element('h2', t('app.close.cancelled')), element('p', message), close);
    dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
  }
  await native.bridge.request('host.closeCancel', { message }).catch(() => {});
}

function renderGroupList(snapshot, layout, groups) {
  // A collection past nine groups, which only a sync can produce, cannot take a new order until a merge.
  const fixedOrder = new Set(workspace.profiles.filter(profile => activeGroups(profile.workspace.snapshot).length > 9).map(profile => profile.id));
  const nav = $('#groups'); nav.replaceChildren();
  const sections = new Map();
  for (const [index, { id }] of workspace.profiles.entries()) sections.set(id, renderSection(nav, id, index));
  for (const group of groups) {
    const row = element('div', undefined, `group-row${group.id === activeGroupId && !trashOpen ? ' active' : ''}`);
    row.dataset.groupId = group.id;
    const choose = button('', async () => { activeGroupId = group.id; trashOpen = false; setDrawer(false); render(); await rememberGroup(); });
    // A highlighted group's star takes the dot's place and colour, so the name keeps its position and width.
    const dot = highlightShown(layout, group.id) ? sidebarMark(icon(starPath), 'group-star', t('app.groups.highlightMark')) : element('span', undefined, 'group-dot');
    dot.style.setProperty('--group-color', groupColor(group.id));
    choose.append(dot);
    choose.append(element('span', groupName(group), 'group-name'));
    if (desktopInfo) choose.append(layout.hiddenGroups?.[group.id] ? offDesktopMark() : layerMark(groupLayer(layout, group.id)));
    choose.append(element('span', String(snapshot.cards.filter(card => card.groupId === group.id && !card.deleted && !card.archived).length), 'group-count'));
    if (!fixedOrder.has(group.profileId)) {
      row.classList.add('reorderable'); choose.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
      const grip = element('span', undefined, 'group-grip'); grip.setAttribute('aria-hidden', 'true');
      grip.append(icon('M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01')); row.append(grip);
    }
    row.append(choose, button('⋯', () => groupEditor(group), 'group-menu')); sections.get(group.profileId).append(row);
  }
  for (const { id } of workspace.profiles) {
    if (!groups.some(group => group.profileId === id)) sections.get(id).append(element('p', t('app.sections.empty'), 'section-empty'));
  }
  for (const entry of unavailableProfiles) {
    const section = renderSection(nav, entry.id, null);
    section.append(element('p', t('app.sections.unavailable', { error: entry.error.message }), 'section-empty'), button(t('app.sections.resetAction'), async () => {
      if (!await confirmAction(t('app.sections.resetTitle', { section: sectionName(entry.id) }), t('app.sections.resetText'), t('app.sections.resetAction'))) return;
      await entry.storage.reset(entry.id); location.reload();
    }, 'section-action'));
  }
  // Trash is no group: it takes no drop and no drag, and capture keeps filing into the group chosen before it (SPEC-012).
  const trash = element('div', undefined, `group-row trash-row${trashOpen ? ' active' : ''}`);
  // With no group row to choose, this row is also the way back out.
  const open = button('', () => { trashOpen = !groups.length ? !trashOpen : true; setDrawer(false); render(); });
  // As with search, the view that adjusting works on stays until Done.
  open.disabled = !desktopInfo && controller.state.operationScope.kind !== 'none';
  const mark = element('span', undefined, 'trash-mark'); mark.append(icon('M4 7h16', 'M9.5 7V4.5h5V7', 'M6.5 7l1 13h9l1-13', 'M10 11v5.5', 'M14 11v5.5'));
  open.append(mark, element('span', t('app.trash.title'), 'group-name'), element('span', String(snapshot.cards.filter(card => card.deleted).length), 'group-count'));
  const spacer = element('span', undefined, 'menu-spacer'); spacer.setAttribute('aria-hidden', 'true');
  trash.append(open, spacer); nav.append(trash);
}
// A heading with its own add button; the first section's button keeps its id for the keyboard order and probes.
function renderSection(nav, id, index) {
  const section = element('section', undefined, 'side-section'); section.dataset.profile = id; section.setAttribute('aria-label', sectionName(id));
  const label = element('div', undefined, 'section-label'); label.title = t(id.startsWith('google:') ? 'app.sections.cloudHint' : 'app.sections.localHint');
  label.append(element('span', sectionName(id)));
  if (index !== null) {
    const add = element('button', '\uFF0B'); add.type = 'button'; add.setAttribute('aria-label', t('app.sections.addGroup', { section: sectionName(id) })); add.title = add.getAttribute('aria-label');
    if (index === 0) add.id = 'add-group';
    add.onclick = () => run(() => groupEditor(null, id)); label.append(add);
  }
  section.append(label); nav.append(section); return section;
}
function offDesktopMark() {
  const svg = icon(...Object.values(layerPlates));
  return sidebarMark(svg, 'group-layer off', t('app.groups.offDesktop'));
}

// Small marks in a group row: a star for a highlighted group, and on desktop computers the layer the group's papers rest on.
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

// Dragging a group row changes only the order of its section: regions, region keys and papers stay (ADR-066). A mouse
// drags the whole row. A finger drags the grip at once, or the rest of the row once
// held still for a moment, as phone lists do; a finger that moves first scrolls the drawer.
let groupDrag = null; let groupDragClick = false; const groupHold = 350;
function reorderGroups(ids) {
  return run(async () => {
    // A refused order must not leave the rows where they were dropped.
    try {
      for (const { workspace: own } of workspace.profiles) {
        const grid = own.layout.state.grid; const held = grid.slots.filter(Boolean);
        // A group that arrived during the drag goes last, and one that left drops out.
        const order = [...ids.filter(id => held.includes(id)), ...held.filter(id => !ids.includes(id))];
        if (order.some((id, index) => id !== held[index])) await own.layout.configure({ grid: reorderSlots(grid, order) }, own.snapshot);
      }
    } finally { render(); }
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
  // A row moves within its own section; over another section it offers to move there.
  const section = groupDrag.row.parentElement;
  const over = document.elementFromPoint(event.clientX, event.clientY)?.closest('.side-section');
  const across = over && over !== section && over.dataset.profile && !unavailableProfiles.some(entry => entry.id === over.dataset.profile) ? over : null;
  document.querySelectorAll('.side-section.receiving').forEach(node => { if (node !== across) node.classList.remove('receiving'); });
  groupDrag.across = across?.dataset.profile ?? null;
  if (across) { across.classList.add('receiving'); return; }
  const rows = [...section.querySelectorAll('.group-row.reorderable')].filter(row => row !== groupDrag.row);
  const before = rows.find(row => { const box = row.getBoundingClientRect(); return event.clientY < box.top + box.height / 2; });
  const target = before || null;
  if (groupDrag.row.nextElementSibling !== target) section.insertBefore(groupDrag.row, target);
}
function endGroupDrag(event, dropped) {
  if (groupDrag?.pointerId !== event.pointerId) return;
  const { active, row, hold, across } = groupDrag; groupDrag = null; clearTimeout(hold);
  if (!active) return;
  document.querySelectorAll('.side-section.receiving').forEach(node => node.classList.remove('receiving'));
  row.classList.remove('dragging'); document.body.classList.remove('group-dragging');
  // The click that ends a drag must not also choose the group.
  groupDragClick = true; setTimeout(() => { groupDragClick = false; }, 0);
  if (dropped && across) { render(); void run(() => askMoveGroup(row.dataset.groupId, across)); return; }
  if (dropped) void reorderGroups([...$('#groups').querySelectorAll('.group-row.reorderable')].map(node => node.dataset.groupId));
  else render();
}
// Alt+Up and Alt+Down move the focused group one place, for keyboards.
function stepGroupOrder(event) {
  const row = event.target.closest('.group-row.reorderable');
  if (!row || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const section = workspace.ownerOfGroup(row.dataset.groupId).id;
  const ids = shownGroups().filter(group => group.profileId === section).map(group => group.id);
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
  const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('#groups .group-row[data-group-id]');
  const target = row && card && row.dataset.groupId !== card.groupId ? row : null;
  $('#groups').querySelectorAll('.group-row').forEach(node => node.classList.toggle('receiving', node === target));
  noteDrag.groupId = target?.dataset.groupId ?? null;
  noteDrag.ghost.lastChild.textContent = target ? t('app.stage.moveTo', { group: groupName(workspace.groups().find(group => group.id === noteDrag.groupId)) }) : '';
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
  // With no group anywhere there is nothing to filter, switch or adjust: only the prompt for a first note (ADR-067).
  // Search and Trash still work, because trashed notes outlive their groups.
  const noGroups = !groups.length && !trashOpen && !query;
  // Filters and search look through papers the desktop does not show, so they always use the board or the list.
  const notesShown = noGroups || trashOpen || !showDesktop || filter !== 'active' || Boolean(query); const view = notesShown ? mainView(layout) : 'desktop';
  // Search looks through every group, so the title stops naming the selected one while it has text.
  $('#workspace-title').textContent = trashOpen ? t('app.trash.title') : query ? t('app.search.title')
    // The first note lands in this section's new group, which does not exist yet to be named.
    : noGroups ? sectionName(profileId)
      : notesShown ? groupName(groups.find(group => group.id === activeGroupId))
        : desktopInfo ? t('app.views.layoutMap') : t('app.views.desktopTitle');
  // Capture adds to the selected group's To do, so it shows only while that is what is shown: not under another
  // filter, a search or the canvas and layout map of every group.
  $('#compose').hidden = noGroups || trashOpen || filter !== 'active' || Boolean(query) || view === 'desktop';
  $('#empty-trash').hidden = !trashOpen;
  $('.view-bar').classList.toggle('trash-visible', trashOpen);
  // The status tabs do not apply to Trash or to a search, which looks through every status (SPEC-012).
  $('.view-filters').hidden = noGroups || trashOpen || Boolean(query);
  $('.view-switch').hidden = noGroups;
  $('#search').placeholder = t(trashOpen ? 'app.trash.searchPlaceholder' : 'app.search.placeholder');
  $('#operate-group').disabled = trashOpen || !groups.length; $('#operate-all').disabled = trashOpen || !groups.length;
  // The layout map stays parked until it is more than a stub (ADR-018), so desktop hosts offer only the board and the list.
  $('[data-view="desktop"]').hidden = handheld || trashOpen || Boolean(desktopInfo);
  $('#empty-trash').disabled = !snapshot.cards.some(card => card.deleted && (trashTab === 'all' || workspace.ownerOfCard(card.id).id === trashTab));
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
  // With real desktop scenes the main window never mirrors them; its parked desktop view is the layout map.
  $('#stage-shell').hidden = notesShown || Boolean(desktopInfo); $('#layout-map').hidden = notesShown || !desktopInfo; $('#list').hidden = !notesShown;
  document.querySelectorAll('[data-filter]').forEach(node => node.classList.toggle('active', node.dataset.filter === filter));
  if (trashTab !== 'all' && !workspace.profiles.some(profile => profile.id === trashTab)) trashTab = 'all';
  renderTrashTabs();
  const inTrashTab = card => card.deleted && (trashTab === 'all' || workspace.ownerOfCard(card.id).id === trashTab);
  const cards = rankSearch(snapshot.cards.filter(card => trashOpen ? inTrashTab(card) : query ? !card.deleted : matchesFilter(card)), query);
  const listCards = cards.filter(card => trashOpen || query || card.groupId === activeGroupId);
  const shown = snapshot.cards.filter(card => cardPolicy(card, layout, controller.state).visible).length;
  const hidden = shown ? 0 : snapshot.cards.filter(card => eligible(card, layout)).length;
  $('#count').textContent = notesShown ? plural('app.count.notes', listCards.length) : plural('app.count.desktopNotes', shown);
  if (noGroups) renderFirstNotePrompt(view);
  else if (trashOpen) renderTrash(listCards, view, Boolean(query));
  else if (notesShown) renderNotes(listCards, view, Boolean(query), query ? rankSearch(snapshot.cards.filter(card => card.deleted), query).length : 0);
  else if (desktopInfo) renderLayoutMap();
  else renderStage(snapshot.cards);
  // Completed papers this device hides are still notes, so they never bring up the first-note prompt.
  const withCompleted = { ...layout, completedVisible: true, hiddenGroups: {} };
  $('#empty').hidden = snapshot.cards.some(card => eligible(card, withCompleted));
  $('#desktop-hidden').hidden = handheld || !hidden || trashOpen || filter !== 'active' || Boolean(query);
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
  const conflictCount = workspace.attentionCount();
  $('#conflict-count').textContent = plural('app.conflicts.count', conflictCount); $('#conflicts-button').hidden = !conflictCount;
  $('#settings-conflict-count').textContent = String(conflictCount); $('#settings-conflict-count').hidden = !conflictCount;
}

function renderStage(cards) {
  for (const close of stageAttachmentCleanup.splice(0)) close();
  stageFitter.clear(); const stage = $('#stage'); stage.replaceChildren(); groupLabels = [];
  if (desktopInfo) { const area = screenArea(); stage.style.transform = `translate(${-area.x}px, ${-area.y}px)`; }
  const layout = workspace.layout.state; const state = controller.state;
  let regions = [];
  try { regions = gridRegions(layout.grid); } catch (error) { status(error.message, true); }
  for (const region of regions.filter(region => region.groupId)) {
    const group = activeGroups(workspace.snapshot).find(group => group.id === region.groupId);
    // A region reserved for a collection that is not open draws nothing here.
    if (!group) continue;
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
    paper.classList.toggle('selected', state.selectedCardId === card.id); paper.classList.toggle('mine', highlightShown(layout, card.groupId));
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

// The regions of this computer and the groups off its desktop. A region of a collection that is not open stays reserved.
function renderLayoutMap() {
  const layout = workspace.layout.state; const groups = shownGroups(); const host = $('#layout-regions');
  host.style.gridTemplateColumns = `repeat(${layout.grid.columns},1fr)`;
  host.replaceChildren(...layout.grid.slots.map((id, index) => {
    const group = groups.find(item => item.id === id);
    const cell = element('div', undefined, group ? 'map-cell' : id ? 'map-cell waiting' : 'map-cell empty');
    if (group) cell.style.setProperty('--paper', groupColor(id));
    cell.append(element('small', t('app.layoutMap.region', { number: index + 1 })), element('strong', group ? groupName(group) : id ? t('settings.desktop.reservedRegion') : t('settings.desktop.emptyRegion')));
    return cell;
  }));
  const off = groups.filter(group => layout.hiddenGroups?.[group.id]);
  $('#layout-off').replaceChildren(...off.map(group => {
    const dot = element('span', undefined, 'group-dot'); dot.style.setProperty('--group-color', groupColor(group.id));
    const chip = element('span', undefined, 'off-chip'); chip.append(dot, element('span', groupName(group))); return chip;
  }));
  $('#layout-off-heading').hidden = !off.length;
}

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
function renderTrashTabs() {
  const tabs = $('#trash-tabs'); tabs.hidden = !trashOpen || workspace.profiles.length < 2; tabs.replaceChildren();
  if (tabs.hidden) return;
  for (const [value, label] of [['all', t('app.trash.all')], ...workspace.profiles.map(({ id }) => [id, sectionName(id)])]) {
    // Drawing the tabs again replaces the one just pressed, so the focus goes to its successor.
    const tab = immediateButton(label, () => { trashTab = value; render(); [...tabs.children].find(node => node.dataset.trashTab === value)?.focus(); }, value === trashTab ? 'active' : '');
    tab.dataset.trashTab = value; tab.setAttribute('aria-pressed', String(value === trashTab)); tabs.append(tab);
  }
}
function clearNotes(view) {
  for (const close of noteAttachmentCleanup.splice(0)) close();
  boardFitter.clear(); const list = $('#list'); list.replaceChildren(); list.setAttribute('aria-label', view === 'list' ? t('app.views.listLabel') : t('app.views.boardLabel'));
  return list;
}
// A search leaves Trash out, so it says below the results when Trash holds more that match (SPEC-012).
function renderNotes(cards, view, acrossGroups, matchesInTrash = 0) {
  const list = clearNotes(view);
  list.append(cards.length ? noteHolder(cards, view, acrossGroups) : element('p', t('app.notes.empty'), 'hint'));
  if (matchesInTrash) {
    // The count spans every collection, so the link does too.
    const link = immediateButton('', () => { trashOpen = true; trashTab = 'all'; render(); }, 'trash-link');
    link.append(element('span', plural('app.trash.matches', matchesInTrash)), element('span', t('app.trash.show')));
    list.append(link);
  }
}
// The canvas's first-note prompt, for every host and view. Its button is the one way a group appears by itself: the note
// needs somewhere to go, so openEditor makes the group first.
function renderFirstNotePrompt(view) {
  const add = button(t('app.empty.add'), () => openEditor(), 'primary');
  const prompt = element('div', undefined, 'first-note');
  prompt.append(element('div', '\uFF0B', 'empty-paper'), element('h2', t('app.empty.title')), element('p', t('app.empty.text')), add);
  clearNotes(view).append(prompt);
}
function renderTrash(cards, view, searching) {
  const list = clearNotes(view);
  if (!cards.length) { list.append(element('p', t(searching ? 'app.trash.noMatches' : 'app.trash.empty'), 'hint')); return; }
  const groups = workspace.working.groups;
  for (const section of trashSections(cards, shownGroups().map(group => group.id), { ranked: searching })) {
    const dot = element('span', undefined, 'group-dot'); dot.style.setProperty('--group-color', groupColor(section.groupId));
    const head = element('h2', undefined, 'trash-head');
    head.append(dot, element('span', groupName(groups.find(group => group.id === section.groupId)) || t('app.groups.pendingSync')), element('span', String(section.cards.length), 'count'));
    if (trashTab === 'all' && workspace.profiles.length > 1) head.append(element('span', sectionName(workspace.ownerOfCard(section.cards[0].id).id), 'source'));
    if (groups.find(group => group.id === section.groupId)?.movedAway) head.append(element('span', t('app.trash.groupGone'), 'gone'));
    list.append(head, noteHolder(section.cards, view, false));
  }
}
function noteHolder(cards, view, acrossGroups) {
  const groups = activeGroups(workspace.snapshot); const layout = workspace.layout.state;
  const holder = element('div', undefined, view === 'list' ? 'note-list' : 'board');
  for (const card of cards) {
    const title = summaryText(card);
    const note = element('article', undefined, view === 'list' ? 'note-row' : 'note-paper'); note.dataset.cardId = card.id;
    note.style.setProperty('--paper', groupColor(card.groupId));
    note.classList.toggle('completed', card.completed); note.classList.toggle('mine', highlightShown(layout, card.groupId));
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
    const actions = element('div', undefined, 'note-actions');
    if (card.deleted) actions.append(button(t('app.notes.restore'), () => restoreNote(card)),
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
    // Moved across, the original in Trash says where it went: on a line of its own, for the meta row clips.
    const moved = card.deleted && typeof card.movedTo?.group === 'string' ? element('div', t('app.trash.movedTo', { section: t(card.movedTo.section === 'cloud' ? 'app.sections.cloud' : 'app.sections.local'), group: groupName({ name: card.movedTo.group }) }), 'note-moved') : null;
    // Search results say where each note is on a line of their own: the meta row clips, and phones hide it in the list.
    const place = acrossGroups ? t('app.search.origin', { group: groupName(groups.find(group => group.id === card.groupId)) || t('app.groups.pendingSync'),
      status: t(card.archived ? 'app.filters.archived' : card.completed ? 'app.filters.completed' : 'app.filters.active') }) : '';
    const origin = acrossGroups ? element('div', workspace.profiles.length > 1 ? t('app.search.originSection', { section: sectionName(workspace.ownerOfCard(card.id).id), place }) : place, 'note-origin') : null;
    if (view === 'list') {
      const text = element('div', undefined, 'note-text');
      // A paper without its own title shows its first line as the title, so the excerpt starts after it.
      const plain = body.textContent.replace(/\s+/g, ' ').trim();
      text.append(heading, element('div', !card.content.title && plain.startsWith(title) ? plain.slice(title.length).trim() : plain, 'note-excerpt'));
      if (origin) text.append(origin);
      if (moved) text.append(moved);
      note.append(element('span', undefined, 'note-swatch'), text, meta, actions);
    } else {
      const foot = element('div', undefined, 'note-foot'); foot.append(meta, actions);
      note.append(heading, body); if (origin) note.append(origin); if (moved) note.append(moved); boardFitter.observe(body);
      const strip = attachmentStrip(card.content.attachments || [], noteAttachmentCleanup, boardFitter); if (strip) note.append(strip);
      note.append(foot);
    }
    holder.append(note);
  }
  return holder;
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

// Deleting asks nothing, as its notification offers Undo and Deleted keeps the note. A note's unsaved changes go
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
// A move inside a collection happens at once, with Undo; one across asks first, and the original in Trash is the way back.
async function moveNoteToGroup(id, groupId) {
  if (workspace.ownerOfGroup(groupId) !== workspace.ownerOfCard(id)) return askMoveNote(id, groupId);
  const from = currentCard(id).groupId; const nameOf = groupId => groupName(activeGroups(workspace.snapshot).find(group => group.id === groupId));
  // A note from a group off the desktop has no place yet, and needs one if this group is on it.
  await controller.moveToGroup(id, groupId); await settleMoved();
  status(t('app.status.movedTo', { group: nameOf(groupId) }), false, { label: t('app.status.undoMove'), run: async () => {
    if (currentCard(id)?.groupId !== groupId) throw new FleetError('conflict', t('app.status.moveUndoStale'));
    await controller.moveToGroup(id, from); await settleMoved(); status(t('app.status.undone'));
  } });
}

// Moving across (ADR-066): what a move does is said before it happens, and a note that cannot move says why.
function moveChip(id, name, color) {
  const chip = element('span', undefined, 'move-chip'); const dot = element('span', undefined, 'group-dot'); dot.style.setProperty('--group-color', color);
  chip.append(dot, element('span', name), element('small', sectionName(id))); return chip;
}
function moveDialog(title, path, lines, confirmLabel, confirm) {
  const dialog = element('dialog'); dialog.id = 'move-dialog';
  const route = element('div', undefined, 'move-path'); route.append(...path);
  const list = element('ul', undefined, 'effects'); list.append(...lines.map(line => element('li', line)));
  const actions = element('div', undefined, 'dialog-actions');
  actions.append(immediateButton(t('common.cancel'), () => dialog.close()), immediateButton(confirmLabel, () => { dialog.close(); confirm(); }, 'primary'));
  dialog.append(element('h2', title), route, list, actions);
  dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
}
function moveNotice(title, lines) {
  const dialog = element('dialog'); dialog.id = 'move-notice'; const actions = element('div', undefined, 'dialog-actions');
  actions.append(immediateButton(t('app.move.ok'), () => dialog.close(), 'primary'));
  dialog.append(element('h2', title), ...lines.map(line => element('p', line)), actions);
  dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
}
const moveEffects = (toId, fromId, one) => {
  const toCloud = toId.startsWith('google:');
  return [t(toCloud ? (one ? 'app.move.effectToCloudNote' : 'app.move.effectToCloudNotes') : (one ? 'app.move.effectToLocalNote' : 'app.move.effectToLocalNotes')),
    t(fromId.startsWith('google:') ? 'app.move.originalCloud' : 'app.move.originalLocal', { section: sectionName(fromId) }), t('app.move.history')];
};
async function endEditForMove() {
  if (controller.state.operationScope.kind !== 'none' || composing) throw new Error(t('app.errors.finishInputOrDialog'));
  if (currentDraft) await flushDraft();
  if (!await controller.endEdit()) throw new Error(t('app.errors.finishTextInput'));
  currentDraft = null;
}
async function askMoveNote(cardId, groupId) {
  await endEditForMove();
  const from = workspace.ownerOfCard(cardId); const to = workspace.ownerOfGroup(groupId); const card = currentCard(cardId);
  const refusal = crossMove.refusal(cardId);
  if (refusal) { moveNotice(t('app.move.refusedTitle'), [t(`errors.core.move.${refusal}`)]); return; }
  const source = from.workspace.state.groups.find(group => group.id === card.groupId); const target = workspace.groups().find(group => group.id === groupId);
  moveDialog(t('app.move.noteTitle', { section: sectionName(to.id) }),
    [element('strong', summaryText(card)), moveChip(from.id, groupName(source), groupColor(card.groupId)), element('span', '\u2192', 'move-arrow'), moveChip(to.id, groupName(target), groupColor(groupId))],
    moveEffects(to.id, from.id, true), t('app.move.confirmNote'), () => moveNoteAcross(cardId, groupId, to.id, target));
}
async function moveNoteAcross(cardId, groupId, section, target) {
  // Only moving can tell that an attachment cannot be fetched or that the note just changed; nothing has moved when it says so.
  const attempt = async action => {
    try { return await action(); }
    catch (error) {
      if (!String(error.code).startsWith('move-')) throw error;
      moveNotice(t('app.move.refusedTitle'), [error.message]); return null;
    }
  };
  try {
    // An attachment may have to come from Drive, which must not hold up a desktop's queue (ADR-064).
    const bytes = await attempt(() => crossMove.readAttachments(cardId));
    if (!bytes) return;
    await run(async () => {
      const moved = await attempt(() => crossMove.moveNote(cardId, groupId, bytes));
      // Refused late, a copy may still have been made.
      await settleMoved();
      if (moved) status(t('app.move.noteDone', { section: sectionName(section), group: groupName(target) }));
    });
  } catch (error) { status(error.message, true); }
}
async function settleMoved() { await workspace.layout.placeNew(workspace.working, workAreas()); await controller.reconcile(); render(); }
async function askMoveGroup(groupId, toProfile) {
  await endEditForMove();
  const from = workspace.ownerOfGroup(groupId); const group = workspace.groups().find(item => item.id === groupId);
  const earlier = await crossMove.groupTarget(groupId); const continuing = earlier?.toProfile === toProfile;
  if (!continuing && activeGroups(workspace.profile(toProfile).workspace.snapshot).length >= 9) {
    moveNotice(t('app.move.fullTitle', { section: sectionName(toProfile) }), [t('app.move.fullText', { section: sectionName(toProfile) })]); return;
  }
  const notes = workspace.working.cards.filter(card => card.groupId === groupId && !card.deleted);
  const movable = notes.filter(card => !crossMove.refusal(card.id));
  if (notes.length && !movable.length) { moveNotice(t('app.move.noneTitle'), [t('app.move.noneText')]); return; }
  const left = workspace.working.cards.filter(card => card.groupId === groupId && card.deleted).length;
  const count = test => movable.filter(test).length;
  const lines = [plural('app.move.groupCount', movable.length, { active: count(card => !card.completed && !card.archived), completed: count(card => card.completed && !card.archived), archived: count(card => card.archived) }),
    ...moveEffects(toProfile, from.id, false)];
  if (notes.length > movable.length) lines.push(plural('app.move.blocked', notes.length - movable.length));
  if (left) lines.push(plural('app.move.trashStays', left));
  lines.push(t('app.move.stopNote'));
  const color = groupColor(groupId);
  moveDialog(t('app.move.groupTitle', { group: groupName(group), section: sectionName(toProfile) }),
    [moveChip(from.id, groupName(group), color), element('span', '\u2192', 'move-arrow'), moveChip(toProfile, continuing ? t('app.move.continuing', { group: groupName(group) }) : t('app.move.newGroup', { group: groupName(group) }), color)],
    lines, t('app.move.confirmGroup'), () => startGroupMove(group, toProfile, movable.map(card => card.id)));
}
// The move is not one turn in the queue, or waiting for its own steps would stop it for good on a desktop. Each note takes
// its own turn, so the desktop answers between notes and closing the app waits for only the current one.
function startGroupMove(group, toProfile, ids) {
  const moving = moveGroupAcross(group, toProfile, ids).catch(error => status(error.message, true));
  activeActions.add(moving); void moving.finally(() => activeActions.delete(moving));
}
async function moveGroupAcross(group, toProfile, ids) {
  const perform = action => desktop ? desktop.perform(action) : action();
  const groupId = group.id; const from = workspace.ownerOfGroup(groupId); const pendingBefore = workspace.pendingCount;
  const target = await perform(() => crossMove.openGroup(groupId, toProfile));
  let stopping = false; let done = 0; let tried = 0; let failure = null;
  const dialog = element('dialog'); dialog.id = 'move-progress'; dialog.addEventListener('cancel', event => event.preventDefault());
  const bar = element('progress'); bar.max = ids.length || 1; bar.value = 0;
  const current = element('span', '', 'current'); const tally = element('span', `0 / ${ids.length}`, 'tally');
  const line = element('div', undefined, 'progress-line'); line.append(current, tally);
  const box = element('div', undefined, 'progress-box'); box.append(bar, line);
  const stop = immediateButton(t('app.move.stop'), () => { stopping = true; stop.disabled = true; stop.textContent = t('app.move.stopping'); });
  const actions = element('div', undefined, 'dialog-actions'); actions.append(stop);
  dialog.append(element('h2', t('app.move.progressTitle', { group: groupName(group), section: sectionName(toProfile) })), box,
    element('p', t(toProfile.startsWith('google:') ? 'app.move.progressCloud' : 'app.move.progressLocal'), 'hint'), actions);
  dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
  render();
  for (const id of ids) {
    if (stopping || nativeClosing) break;
    const card = currentCard(id); current.textContent = card ? summaryText(card) : '';
    try {
      // An attachment may have to come from Drive, which must not hold up a desktop's queue (ADR-064).
      const bytes = await crossMove.readAttachments(id);
      await perform(async () => { await crossMove.moveNote(id, target, bytes); await settleMoved(); }); done++;
    }
    catch (error) {
      failure = error;
      // A note that cannot move stays behind; anything else, such as a full disk, ends the move.
      if (!String(error.code).startsWith('move-')) break;
    }
    bar.value = ++tried; tally.textContent = `${done} / ${ids.length}`;
  }
  dialog.close();
  const finished = await perform(async () => {
    const result = await crossMove.finishGroup(groupId);
    if (result && activeGroupId === groupId) { activeGroupId = target; await rememberGroup(); }
    await settleMoved(); return result;
  });
  syncIfPending(pendingBefore);
  if (nativeClosing) return;
  const remaining = from.workspace.working.cards.filter(card => card.groupId === groupId && !card.deleted).length;
  const name = groupName(group); const section = sectionName(toProfile); const home = sectionName(from.id);
  // The notes already moved are in a group with no region of its own yet, so they have left the desktop for now.
  const offDesktop = workspace.layout.state.hiddenGroups?.[target] && workspace.layout.state.grid.slots.includes(groupId) ? [t('app.move.targetOff')] : [];
  if (finished) moveNotice(t('app.move.doneTitle'), [plural('app.move.doneText', done, { section, group: name })]);
  else if (stopping) moveNotice(t('app.move.stoppedTitle'), [t('app.move.stoppedText', { done, left: remaining, section: home, group: name }), t('app.move.again'), ...offDesktop]);
  else moveNotice(t('app.move.partialTitle'), [...failure ? [failure.message] : [], t('app.move.partialText', { done, left: remaining, section: home, group: name }), t('app.move.again'), ...offDesktop]);
}
// A note from a group that has moved away needs another group; with none left in its collection, the group comes back.
async function restoreNote(card) {
  const owner = workspace.ownerOfCard(card.id); const groups = shownGroups().filter(group => group.profileId === owner.id);
  const finish = async (groupId, options) => { await workspace.restoreCard(card.id, card.revision, groupId, options); await workspace.layout.placeNew(workspace.working, workAreas()); render(); status(t('app.status.restored')); };
  if (groups.some(group => group.id === card.groupId)) { await finish(null); return; }
  const gone = owner.workspace.state.groups.find(group => group.id === card.groupId);
  if (!groups.length) { await finish(null, { bringGroupBack: true }); return; }
  const dialog = element('dialog'); dialog.id = 'restore-target'; const select = element('select'); fillGroups(select, groups[0].id, owner.id);
  const field = element('label', t('app.trash.restoreTo'), 'field'); field.append(select);
  const actions = element('div', undefined, 'dialog-actions');
  actions.append(immediateButton(t('common.cancel'), () => dialog.close()), button(t('app.notes.restore'), async () => { await finish(select.value); dialog.close(); }, 'primary'));
  dialog.append(element('h2', t('app.trash.restoreTitle')), element('p', t('app.trash.restoreText', { group: groupName(gone), section: sectionName(owner.id) })), field, actions);
  dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
}

// Takes its turn in the queue, so an action from any window that came first can start adjusting or need no dialog in its
// way. The queue holds no Drive request, so that turn comes at once. An open dialog means repeated clicks open one.
function groupEditor(group, section = profileId) {
  if (nativeClosing || document.querySelector('dialog[open]')) return;
  const dialog = element('dialog'); const form = element('form');
  const title = element('h2', group ? t('app.groupEditor.editTitle') : workspace.profiles.length > 1 ? t('app.groupEditor.newTitleIn', { section: sectionName(section) }) : t('app.groupEditor.newTitle'));
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
  // Like the colour, this belongs to the device, so saving it records no group revision.
  const highlightAtOpen = Boolean(group) && groupHighlighted(workspace.layout.state, group.id);
  const highlightField = handheld ? null : element('label', undefined, 'check'); const highlight = element('input'); highlight.type = 'checkbox';
  highlight.name = 'group-highlight'; highlight.checked = highlightAtOpen; highlightField?.append(highlight, element('span', t('app.groupEditor.highlight')));
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
  // Saving and merging do write, so they take their turn in the queue. One press counts, and closing the dialog while it
  // waits withdraws it; once it is writing, the dialog stays until the outcome is known.
  let merge = null; let writing = false;
  const press = action => {
    if (save.disabled) return;
    const held = [save, merge].filter(control => control && !control.disabled);
    for (const control of held) control.disabled = true;
    void run(async () => {
      if (!dialog.open) return;
      writing = true;
      try { await action(); } finally { writing = false; }
    }).finally(() => { for (const control of held) control.disabled = false; });
  };
  if (group) {
    merge = immediateButton(t('app.groupEditor.merge'), () => press(() => { dialog.close(); return openGroupMerge(group); }));
    merge.disabled = shownGroups().filter(item => item.profileId === group.profileId).length < 2; actions.append(merge);
    for (const { id } of workspace.profiles) if (id !== group.profileId) {
      const away = immediateButton(t('app.groupEditor.moveTo', { section: sectionName(id) }), () => { if (writing) return; dialog.close(); run(() => askMoveGroup(group.id, id)); }, 'leading'); actions.prepend(away);
    }
    actions.prepend(immediateButton(t('app.groupEditor.delete'), () => { if (writing) return; dialog.close(); void askDeleteGroup(group); }, 'leading danger'));
  }
  actions.append(immediateButton(t('common.cancel'), () => { if (!writing) dialog.close(); }), save);
  dialog.addEventListener('cancel', event => { if (writing) event.preventDefault(); });
  form.append(title, label, colorField, ...highlightField ? [highlightField, element('p', t('app.groupEditor.highlightHint'), 'hint')] : [], ...layerField ? [layerField, element('p', t('app.groupEditor.layerHint'), 'hint')] : [],
    ...opacityField ? [opacityField, element('p', t('app.groupEditor.opacityHint'), 'hint')] : [], actions); dialog.append(form); document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', event => { event.preventDefault(); press(async () => {
    let groupId = group?.id;
    // A name left as shown is not renamed: a default name keeps following the UI language, and changing only this
    // device's layer neither syncs a group revision nor fails on a group that is in conflict. When a sync renamed the
    // group under this dialog, the refusal tells the user to try again, so the retry answers the version it reported.
    if (group) {
      if (input.value.trim() !== groupName(group)) await workspace.renameGroup(group.id, input.value, group.revision).catch(error => {
        group = activeGroups(workspace.snapshot).find(item => item.id === group.id) ?? group; throw error;
      });
    }
    else { const created = await workspace.createGroup(input.value, section); activeGroupId = groupId = created.id; trashOpen = false; await rememberGroup(); }
    // A new group already took a layer and a colour when it was created; the dialog only guessed them at opening. Only
    // a choice the user changed is applied, so a sync landing meanwhile cannot make an untouched guess repaint a group.
    const layerNow = group ? currentLayer : groupLayer(workspace.layout.state, groupId);
    if (layerField && layers.value !== currentLayer && layers.value !== layerNow) await workspace.layout.setGroupLayer(groupId, layers.value, workspace.snapshot);
    const chosen = Number(form.elements['group-color'].value);
    const colorNow = group ? colorAtOpen : workspace.layout.state.groupColors?.[groupId];
    if (chosen !== colorAtOpen && chosen !== colorNow) await workspace.layout.setGroupColor(groupId, chosen, workspace.snapshot);
    if (opacityField && opacity.value !== opacityShown) await workspace.layout.setGroupOpacity(groupId, Number(opacity.value) / 100, workspace.snapshot);
    if (highlightField && highlight.checked !== highlightAtOpen) await workspace.layout.setGroupHighlight(groupId, highlight.checked, workspace.snapshot);
    await workspace.layout.placeNew(workspace.working, workAreas()); dialog.close(); render(); workspace.layout.takeArrivedOffDesktop();
    status(t(!group && workspace.layout.state.hiddenGroups?.[groupId] ? 'app.status.groupOffDesktop' : 'app.status.groupSaved'));
  }); });
  dialog.showModal(); input.focus();
}

async function openGroupMerge(group) {
  if (!await controller.endEdit()) throw new Error(t('app.errors.finishTextInput'));
  currentDraft = null; render();
  const dialog = element('dialog'); dialog.id = 'merge-dialog'; dialog.append(element('h2', t('app.merge.title', { group: groupName(group) })));
  const field = element('label', t('app.groups.receiving'), 'field'); const select = element('select'); select.id = 'merge-target';
  select.append(new Option(t('app.merge.choose'), ''));
  for (const target of shownGroups().filter(item => item.id !== group.id && item.profileId === group.profileId)) select.append(new Option(groupName(target), target.id));
  field.append(select);
  const message = element('p'); message.id = 'merge-message'; message.setAttribute('role', 'status');
  const items = element('ul', undefined, 'merge-preview'); const actions = element('div', undefined, 'dialog-actions');
  let preview; let busy = false;
  const apply = button(t('app.merge.confirm'), async () => {
    if (!preview || busy) return;
    busy = true; apply.disabled = true; select.disabled = true; cancel.disabled = true;
    try {
      await workspace.mergeGroup(preview); await workspace.layout.placeNew(workspace.working, workAreas()); await controller.reconcile();
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

// The question stays outside the action queue, so the desktop is not held up while it is open. Any section's group can
// go, the last one too; its notes wait in Trash (ADR-067).
async function askDeleteGroup(group) {
  const endEdit = async () => {
    if (!await controller.endEdit()) throw new Error(t('app.errors.finishTextInput'));
    // Rendered at once: the desktop must stop showing the editor even if the question is cancelled or the delete refused.
    currentDraft = null; remoteEditor = null; render();
  };
  // A quick edit keeps its text first, so the question counts it.
  let plan = null;
  await run(async () => { await endEdit(); plan = workspace.previewGroupDelete(group.id); });
  if (!plan) return;
  const text = [...plan.notes ? [plural('app.groupDelete.notes', plan.notes)] : plan.unsaved ? [] : [t('app.groupDelete.empty')],
    ...plan.unsaved ? [plural('app.groupDelete.unsaved', plan.unsaved)] : []].join(' ');
  if (!await confirmAction(t('app.groupDelete.title', { group: groupName(group) }), text, t('app.groupEditor.delete'))) return;
  await run(async () => {
    await endEdit();
    // What arrived or was typed while the question was open has not been agreed to.
    if (workspace.previewGroupDelete(group.id).fingerprint !== plan.fingerprint) throw new Error(t('app.groupDelete.changed'));
    const result = await workspace.deleteGroup(group.id);
    await workspace.layout.placeNew(workspace.working, workAreas()); await controller.reconcile(); render();
    status(t(result.notes ? 'app.status.groupDeletedNotes' : 'app.status.groupDeleted'));
  });
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
      // A group in another section needs its own confirmation, so the rest of this dialog waits for another time.
      if (select.value !== card.groupId && workspace.ownerOfGroup(select.value) !== workspace.ownerOfCard(card.id)) { dialog.close(); await askMoveNote(card.id, select.value); return; }
      // A note from a group off the desktop has no place yet, and needs one if this group is on it.
      if (select.value !== card.groupId) { await controller.moveToGroup(card.id, select.value); await workspace.layout.placeNew(workspace.working, workAreas()); }
      // A note whose group is off the desktop has no place yet, so it has no display setting to change.
      if (!handheld && workspace.layout.state.placements[card.id]) await workspace.layout.setCardPolicy(card.id, { visible: check.checked });
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
  const group = await workspace.ensureCaptureGroup(); activeGroupId = group.id; render();
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
  $('#editor-text').value = currentDraft.content.text; fillGroups($('#editor-group'), currentDraft.groupId, workspace.ownerOfGroup(currentDraft.groupId).id);
  $('#editor-group').disabled = Boolean(currentDraft.baseRevision); showConflictActions(null);
  $('#editor-dialog').showModal(); showEditorTab(false); queueDraft(); $('#editor-text').focus();
  showAttachments();
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
    if (cardId && !workspace.layout.state.placements[cardId] && !workspace.layout.state.hiddenGroups?.[currentDraft?.groupId] && workspace.unsavedChanges(cardId)) {
      void workspace.layout.placeNew(workspace.working, workAreas()).catch(error => status(error.message, true));
    }
  }).catch(error => {
    if (currentDraft?.id !== id) return;
    $('#draft-status').textContent = '';
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
      const owner = workspace.ownerOfGroup(currentDraft.groupId);
      const metadata = await owner.storage.putAttachment(owner.id, file);
      if (!currentDraft.content.attachments.some(item => item.id === metadata.id)) currentDraft.content.attachments.push(metadata);
    }
    await queueDraft(); showAttachments();
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
// An attachment's id is the hash of its bytes, so whichever collection holds them holds the same file. Local collections
// come first, because the primary may go to Drive for what it lacks.
const attachmentReaders = () => [...companions, { storage, id: profileId, attachments: attachmentFiles }];
async function readAttachment(id) {
  for (const reader of attachmentReaders()) { const blob = await reader.storage.getAttachment(reader.id, id).catch(error => { if (reader.id === profileId) throw error; return null; }); if (blob) return blob; }
  return null;
}
async function previewAttachment(file) {
  if (attachmentFiles) {
    for (const reader of companions) { const result = await reader.attachments?.preview(file).catch(() => null); if (result?.available) return result; }
    return attachmentFiles.preview(file);
  }
  return { available: Boolean(await readAttachment(file.id)), png: null };
}
async function openAttachment(file) {
  if (attachmentFiles) {
    for (const reader of companions) { const held = await reader.attachments?.preview(file).catch(() => null); if (held?.available) return reader.attachments.open(file); }
    return attachmentFiles.open(file);
  }
  const blob = await readAttachment(file.id);
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
// An attachment not on this device comes from Drive, which no queue turn may wait for (ADR-064).
function showAttachments() {
  const shown = attachmentRender + 1;
  void renderAttachments().catch(error => { if (shown === attachmentRender && currentDraft) status(error.message, true); });
}
async function renderAttachments() {
  // Drive can answer after the editor closed or another render began; only the latest render may touch the list.
  const latest = ++attachmentRender, shown = currentDraft?.id;
  for (const close of editorAttachmentCleanup.splice(0)) close();
  for (const url of attachmentUrls.values()) URL.revokeObjectURL(url); attachmentUrls.clear();
  const list = $('#attachments'); list.replaceChildren();
  if (!currentDraft) return;
  for (const attachment of currentDraft.content.attachments || []) {
    const blob = await readAttachment(attachment.id);
    if (latest !== attachmentRender || shown !== currentDraft?.id) return;
    const row = element('li'); appendAttachmentTiles(row, [attachment], editorAttachmentCleanup);
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
      await queueDraft(); showAttachments();
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
/** A language change redraws everything built from the catalogs; notification messages refresh on their next update. */
function relocalize() {
  localizeDocument();
  for (const [selector, text] of shownText) $(selector).textContent = textOf(text);
  if (shownSync) setSync(...shownSync);
  render(); renderAccount();
  if ($('#editor-dialog').open && currentDraft) {
    fillGroups($('#editor-group'), currentDraft.groupId, workspace.ownerOfGroup(currentDraft.groupId).id); showAttachments();
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
// The Versions and Data pages work on one collection at a time; this chooses which, when there are several.
function collectionPicker(selected, change) {
  if (workspace.profiles.length < 2) return null;
  const label = element('label', t('app.sections.choose'), 'field collection-picker'); const select = element('select');
  for (const { id } of workspace.profiles) select.append(new Option(sectionName(id), id));
  // It shows what the page below it is on until the page changes, which it may refuse while busy.
  select.value = selected; select.onchange = () => { const chosen = select.value; select.value = selected; change(chosen); }; label.append(select); return label;
}
async function mountRevisions() {
  const host = $('#revisions-host');
  if (editorBusy || composing) { host.replaceChildren(element('p', t('settings.data.finishInput'), 'hint')); return; }
  if (currentDraft) await flushDraft();
  if (!await controller.endEdit()) { host.replaceChildren(element('p', t('settings.data.finishInput'), 'hint')); return; }
  currentDraft = null; render();
  // Settings may have closed or moved to another page while the edit was being saved.
  if (!$('#settings-dialog').open || settingsPage !== 'revisions') return;
  const shown = profileContext(revisionsProfile ?? profileId);
  revisions = revisionPanel({ workspace: shown.workspace, storage: shown.storage, profileId: shown.id, onChanged: async () => {
    await controller.reconcile(); await workspace.layout.placeNew(workspace.working, workAreas()); render();
  } });
  host.replaceChildren(...[collectionPicker(shown.id, id => {
    if (revisions?.busy()) return;
    revisionsProfile = id; revisions?.dispose(); revisions = null; void run(mountRevisions);
  })].filter(Boolean), revisions.element);
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
  const shown = profileContext(dataProfile ?? profileId); const own = shown.id === profileId;
  dataPanel = backupPanel({ workspace: shown.workspace, storage: shown.storage, getWorkAreas: workAreas, flush: flushDraft, automatic: shown.automatic,
    automaticError: shown.automaticError && t('settings.data.automaticOff', { error: shown.automaticError.message }),
    files: shown.backups?.manual, reset: own ? resetPlan() : companionResetPlan(shown), cloudRestore: own ? cloudRestoreOptions() : null, backupSource: own ? backupSourceOptions() : null,
    localRestore: own ? applyLocalRestore : (plan, signal) => applyCompanionRestore(shown, plan, signal),
    foreignIds: () => new Set(workspace.profiles.filter(profile => profile.id !== shown.id).flatMap(profile => { const state = profile.workspace.state; return [...state.cards, ...state.groups].map(item => item.id); })),
    appVersion: native?.info.appVersion, uninstallNotice: native?.info.platform === 'windows' ? t('settings.data.uninstallNotice') : null,
    onChanged: async () => {
      // After a restore the main window shows the remembered group.
      activeGroupId = rememberedGroup();
      await controller.reconcile(); await workspace.layout.placeNew(workspace.working, workAreas()); render();
    } });
  host.replaceChildren(...[collectionPicker(shown.id, id => {
    if (dataPanel?.busy()) return;
    dataProfile = id; dataPanel?.dispose(); dataPanel = null; void run(mountDataPanel);
  })].filter(Boolean), dataPanel.element);
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
    // Leave Settings for the native installation UI; the save-and-quit handshake owns final draft persistence.
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
  $('#grid-rows').value = String(layout.grid.rows); $('#grid-columns').value = String(layout.grid.columns);
  previewGrid();
}
function applyLayout(patch) {
  // Hiding completed papers can take away the paper being edited or selected, as hiding one paper does.
  return run(async () => {
    await workspace.layout.configure(patch, workspace.snapshot);
    // A group given a region now may hold notes never placed.
    if (patch.grid) await workspace.layout.placeNew(workspace.working, workAreas());
    await controller.reconcile(); render();
  });
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
  const controls = [...document.querySelectorAll('[data-shortcut-target]')];
  try { readShortcuts(); controls.forEach(control => control.removeAttribute('aria-invalid')); notifications().clear('shortcut-setting'); return true; }
  catch (error) {
    controls.find(control => control === document.activeElement)?.setAttribute('aria-invalid', 'true');
    notifications().show(error.message, { id: 'shortcut-setting', kind: 'error' }); return false;
  }
}
function applyShortcuts() {
  if (checkShortcuts()) applyLayout({ shortcuts: readShortcuts() });
}
// The grid preview is a small map of the screen; each cell is tinted with its group's paper colour.
function previewGrid(reshape = false, apply = false) {
  const rows = Number($('#grid-rows').value); const columns = Number($('#grid-columns').value); const groups = shownGroups();
  if (reshape || settingsSlots.length !== rows * columns) {
    // A smaller grid takes groups off the desktop and a larger one leaves its new regions empty: the choice stays the user's.
    // Reshaping starts from the regions as they are now: a group may have landed since this page drew them.
    const held = (reshape ? workspace.layout.state.grid.slots : settingsSlots).filter(Boolean);
    settingsSlots = Array.from({ length: rows * columns }, (_, index) => held[index] || null);
  }
  const preview = $('#grid-preview'); preview.replaceChildren(); preview.style.gridTemplateColumns = `repeat(${columns},1fr)`;
  for (let i = 0; i < rows * columns; i++) {
    const cell = element('label'); const select = element('select');
    select.setAttribute('aria-label', t('settings.desktop.regionGroup', { number: i + 1 })); select.append(new Option(t('settings.desktop.emptyRegion'), ''));
    for (const { id } of workspace.profiles) {
      const options = groups.filter(group => group.profileId === id).map(group => new Option(groupName(group), group.id));
      if (workspace.profiles.length < 2) { select.append(...options); continue; }
      const heading = document.createElement('optgroup'); heading.label = sectionName(id); heading.append(...options); select.append(heading);
    }
    // A region reserved for a collection that is not open keeps its place until the user changes it.
    if (settingsSlots[i] && !groups.some(group => group.id === settingsSlots[i])) select.append(new Option(t('settings.desktop.reservedRegion'), settingsSlots[i]));
    select.value = settingsSlots[i] || '';
    cell.classList.toggle('empty', !settingsSlots[i]); if (settingsSlots[i]) cell.style.setProperty('--paper', groupColor(settingsSlots[i]));
    select.onchange = () => {
      // A sync may have settled the regions since this page drew them.
      const live = workspace.layout.state.grid.slots; if (live.length === settingsSlots.length) settingsSlots = [...live];
      const next = select.value || null; const other = next ? settingsSlots.findIndex((id, index) => id === next && index !== i) : -1;
      if (other >= 0) settingsSlots[other] = settingsSlots[i];
      settingsSlots[i] = next; previewGrid(false, true);
    };
    cell.append(select); preview.append(cell);
  }
  const off = groups.filter(group => !settingsSlots.includes(group.id));
  $('#regions-off-heading').hidden = !off.length; $('#regions-off').hidden = !off.length; $('#regions-off').replaceChildren(...off.map(group => {
    const dot = element('span', undefined, 'group-dot'); dot.style.setProperty('--group-color', groupColor(group.id));
    const chip = element('span', undefined, 'off-chip'); chip.append(dot, element('span', groupName(group))); if (workspace.profiles.length > 1) chip.append(element('small', sectionName(group.profileId)));
    return chip;
  }));
  try {
    gridRegions({ rows, columns, slots: settingsSlots, area: screenArea() }); notifications().clear('grid-setting');
    for (const control of [$('#grid-rows'), $('#grid-columns')]) control.removeAttribute('aria-invalid');
    if (apply) applyLayout({ grid: { rows, columns, area: screenArea(), slots: [...settingsSlots] } });
  } catch (error) {
    for (const control of [$('#grid-rows'), $('#grid-columns')]) control.setAttribute('aria-invalid', 'true');
    notifications().show(error.message, { id: 'grid-setting', kind: 'error' });
  }
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
  showDesktop = true; filter = 'active'; trashOpen = false; if ($('#search').value || $('.topbar').classList.contains('searching')) setSearching(false);
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
  filter = 'active'; trashOpen = false; if ($('#search').value || $('.topbar').classList.contains('searching')) setSearching(false);
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
  $('#empty-trash').onclick = () => run(() => confirmPurge(workspace.snapshot.cards.filter(card => card.deleted && (trashTab === 'all' || workspace.ownerOfCard(card.id).id === trashTab)).map(card => card.id)));
  // Inert blocks real input and focus; capture also rejects synthetic or already dispatched owner input.
  for (const type of ['click', 'dblclick', 'pointerdown', 'keydown', 'submit']) document.addEventListener(type, event => {
    if (!adjustOverlayActive()) return;
    if (event.target.closest?.('.toast-close')) return;
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
    notifications().clear('language-setting'); $('#language').removeAttribute('aria-invalid');
    try { await changeLanguage($('#language').value); }
    catch (error) { renderLanguageSetting(); $('#language').setAttribute('aria-invalid', 'true'); notifications().show(error.message, { id: 'language-setting', kind: 'error' }); }
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
  $('#grid-rows').onchange = () => previewGrid(true, true); $('#grid-columns').onchange = () => previewGrid(true, true);
  $('#retry-shortcuts').onclick = () => { void nativeShortcuts?.update(liveShortcuts(), true); };
  $('#labwc-write').onclick = () => run(async () => { await nativeShortcuts?.writeLabwc(); status(t('app.status.labwcWritten')); });
  $('#empty-add').onclick = () => run(() => openEditor());
  $('#show-desktop').onclick = () => run(async () => {
    await workspace.layout.configure({ desktopVisible: true }, workspace.snapshot); render(); status(t('app.status.desktopShown'));
  });
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
    // A share lands in the account's collection. With no group there, the one it needs is made only if a share is kept.
    fillGroups($('#capture-group'), activeGroupId, profileId);
    if (!$('#capture-group').options.length) $('#capture-group').append(new Option(t('app.groups.defaultName'), ''));
    // The group shown may belong to the other section, which a share cannot land in.
    if ($('#capture-group').selectedIndex < 0) $('#capture-group').selectedIndex = 0;
    $('#capture-result').textContent = ''; $('#capture-inbox-dialog').showModal(); await refreshCaptures();
  });
  $('#close-capture').onclick = () => { if (!captureBusy) $('#capture-inbox-dialog').close(); };
  $('#capture-inbox-dialog').addEventListener('cancel', event => { if (captureBusy) event.preventDefault(); });
  $('#accept-capture').onclick = () => run(async () => {
    if (captureBusy || !selectedCapture) return; captureBusy = true; $('#accept-capture').disabled = true; $('#discard-capture').disabled = true; $('#capture-group').disabled = true; $('#capture-result').textContent = t('app.shareInbox.saving');
    try {
      let target = $('#capture-group').value;
      if (!target) { target = (await workspace.ensureCaptureGroup()).id; await workspace.layout.settle(); }
      const result = await captureInbox.accept(selectedCapture, target); selectedCapture = null;
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
  $('#conflicts-button').onclick = () => run(() => { revisionsProfile = workspace.firstNeedingAttention() ?? revisionsProfile; return openSettings('revisions'); });
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
