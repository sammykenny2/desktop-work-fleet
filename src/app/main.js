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
import { InteractionController, cardPolicy, sceneOrder } from '../interaction/controller.js';
import { IndexedDbStorage, acquireProfile } from '../storage/indexed-db.js';
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
import { fitText, paperFitter } from './fit.js';
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
function currentCard(id) { return workspace.snapshot.cards.find(card => card.id === id); }
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
    if (native.info.platform === 'macos') {
      const gear = $('#settings-button'); gear.dataset.i18nAttr = 'aria-label:settings.title;title:app.sidebar.settingsTitleMac';
      gear.title = t('app.sidebar.settingsTitleMac');
    }
    lease = { acquired: true, release() {} };
  } else { storage = await IndexedDbStorage.open(); lease = await acquireProfile(profileId); }
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
  catch (error) { if (recovery && loadFailureCause(error)) return showDataFailure(loadFailureCause(error)); throw error; }
  const persist = (state, revision) => storage.save(state, revision);
  // Groups new to this computer, made here or brought by sign-in or sync, start at the back of its desktop.
  const backLayer = () => arrivalLayer(residentLayers());
  try { if (saved) workspace = new Workspace(saved, persist); }
  catch (error) { if (recovery && workspaceFailureCause(error, saved)) return showDataFailure(workspaceFailureCause(error, saved)); throw error; }
  workspace ||= await Workspace.create({ profileId,
    deviceId: crypto.randomUUID(), area: screenArea(), persist, bootstrapGroup: !profileId.startsWith('google:'), arrivalLayer: backLayer });
  workspace.setArrivalLayer(backLayer);
  activeGroupId = rememberedGroup();
  controller = new InteractionController({ getSnapshot: () => workspace.snapshot, layout: workspace.layout,
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
  await workspace.layout.placeNew(workspace.snapshot, workAreas());
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
  const google = profileId.startsWith('google:'); const connected = googleAccount.connected;
  const paused = google && googleAccount.paused === true;
  renderGoogleAccess();
  $('#google-sign-in').onclick = () => { void changeGoogleAccount('signIn'); };
  $('#google-sign-out').onclick = () => { void changeGoogleAccount('signOut'); };
  $('#google-local').onclick = () => { void changeGoogleAccount('local'); };
  setText('#google-sync', workspace.state.cloudRestore ? () => t('sync.actions.resumeOverwrite') : () => t('sync.actions.syncNow'));
  $('#google-sync').onclick = () => {
    if (workspace.state.sourceReset?.superseded || workspace.state.cloudRestore?.resetJob?.superseded) { sourceResetAsked = false; askAfterSourceReset(); }
    else if (workspace.state.sourceReset) void openSettings('data');
    else if (workspace.state.cloudRestore) askResumeCloudRestore(); else void syncGoogle(true);
  };
  if (workspace.state.sourceReset) {
    syncService = null;
    if (workspace.state.sourceReset.superseded) {
      setText('#google-sync', () => t('sync.actions.refetch'));
      setSync('attention', () => t('sync.status.resetAgain'), () => t('sync.detail.resetStopped')); return;
    }
    setText('#google-sync', () => t('sync.actions.resumeReset'));
    setSync('attention', () => t('sync.status.resetUnfinished'), () => t('sync.detail.resetUnfinished')); return;
  }
  if (workspace.state.cloudRestore) {
    clearInterval(syncTimer); syncService = null;
    if (workspace.state.cloudRestore.resetJob?.superseded) {
      setText('#google-sync', () => t('sync.actions.refetch'));
      setSync('attention', () => t('sync.status.resetAgain'), () => t('sync.detail.overwriteStopped')); return;
    }
    setSync('attention', () => t('sync.status.overwriteUnfinished'), workspace.state.cloudRestore.error || (() => t('sync.detail.overwriteSaved')));
    return;
  }
  renderAccount();
  if (connected || paused) {
    setText('#storage-note', paused ? () => t('sync.storage.paused') : () => t('sync.storage.google'));
    setSync(paused ? 'attention' : 'off', paused ? () => t('sync.status.paused') : () => t('sync.status.waiting'), paused ? googleAccount.pauseReason : '');
    syncService = new FileSync({ workspace, storage, fileStore: new NativeGoogleFileStore(native.bridge, native.info, googleAccount.accountId), bootstrapGroup: true });
    syncTimer = setInterval(() => { void syncGoogle(); }, 20000);
    addEventListener('online', () => { void syncGoogle(); });
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
// The account chip and the settings identity say where the papers live and how syncing goes.
function renderAccount() {
  const connected = Boolean(googleAccount?.connected);
  if (!connected && googleProfile) { if (googleProfile.photo) URL.revokeObjectURL(googleProfile.photo); googleProfile = null; }
  const known =connected && googleProfile?.accountId === googleAccount.accountId ? googleProfile : null;
  const email = connected ? googleAccount.email || '' : '';
  const name = known?.name || (connected ? email || t('sync.account.google') : profileId.startsWith('google:') ? t('sync.account.google') : t('sync.account.localNotes'));
  for (const [avatar, initial, label] of [['#account-avatar', '#account-initial', '#account-name'], ['#identity-avatar', '#identity-initial', '#identity-name']]) {
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
  $('#sync-status').textContent = textOf(text); $('#sync-detail').textContent = textOf(text);
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
      await controller.reconcile(); await workspace.layout.placeNew(workspace.snapshot, workAreas()); render();
      if (googleAccount?.paused) {
        const account = await native.bridge.request('google.status');
        if (!current()) return;
        googleAccount = account; renderGoogleAccess(); renderAccount();
        setText('#storage-note', googleAccount.paused ? () => t('sync.storage.paused') : () => t('sync.storage.google'));
        if (googleAccount.paused) { setSync('attention', () => t('sync.status.paused'), googleAccount.pauseReason); return; }
      }
      const pending = workspace.pendingOperations.length; const at = new Date();
      if (pending) setSync('pending', () => plural('sync.status.pending', pending));
      else setSync('ok', () => t('sync.status.syncedAt', { time: formatDate(at, { hour: '2-digit', minute: '2-digit' }) }));
    }
  } catch (error) {
    if (!current()) return;
    if (error.code === 'source-reset') { setSync('attention', () => t('sync.status.cloudReset'), error.message); void run(askAfterSourceReset); return; }
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
async function changeGoogleAccount(action) {
  if (accountBusy || nativeClosing || dataPanel?.busy()) return; accountBusy = true;
  const oldSync = syncService; clearInterval(syncTimer); stopAutomatic?.();
  try {
    await automatic?.service.whenIdle(); await oldSync?.stop(); syncService = null;
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
    accountBusy = false; await initializeGoogle();
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
  const fileStore = new NativeGoogleFileStore(native.bridge, native.info, googleAccount.accountId);
  return { target: googleAccount.email || t('sync.account.current'),
    prepare: async options => {
      requireConnected();
      const result = await syncService?.sync({ force: true });
      if (result?.phase === 'waiting-initialization') throw new Error(t('sync.errors.initializingRestore'));
      return prepareCloudRestore({ ...options, workspace, sourceId: fileStore.sourceId });
    },
    run: (plan, safety, say) => runCloudRestore(say, { plan, safety, fileStore }) };
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
          await workspace.layout.placeNew(workspace.snapshot, workAreas()); render();
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

async function runCloudRestore(say, { plan, safety, fileStore } = {}) {
  if (accountBusy || nativeClosing) throw new Error(t('sync.errors.accountBusy'));
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
        if (['source-reset-superseded', 'source-reset'].includes(error.code) && saved.cloudRestore.resetJob) saved.cloudRestore.resetJob.superseded = true;
        saved.cloudRestore.error = String(error.message || t('sync.cloudRestore.incomplete')).slice(0, 2048);
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
  const resume = element('button', t('sync.actions.resumeOverwrite'), 'danger'); resume.type = 'button';
  const cancel = element('button', t('common.later')); cancel.type = 'button'; cancel.onclick = () => dialog.close();
  resume.onclick = async () => {
    resume.disabled = true; cancel.disabled = true;
    try { await runCloudRestore(text => { state.textContent = text; }); }
    catch (error) { state.textContent = error.message; resume.disabled = false; cancel.disabled = false; }
  };
  dialog.append(element('h2', t('sync.cloudRestore.title')),
    element('p', workspace.state.cloudRestore.phase === 'reset'
      ? t('sync.cloudRestore.resumeReset', { account: googleAccount.email || t('sync.account.current') })
      : t('sync.cloudRestore.resumeUpload')), state, cancel, resume);
  dialog.oncancel = event => { if (resume.disabled) event.preventDefault(); };
  dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
}
// Another device cleared this account's Drive data. This device keeps its copy until the user chooses.
function askAfterSourceReset() {
  if (sourceResetAsked || document.querySelector('dialog[open]')) return; sourceResetAsked = true;
  const dialog = element('dialog'); dialog.id = 'source-reset-dialog';
  const state = element('p', '', 'backup-message'); state.setAttribute('role', 'status');
  // Not through run(): the reset waits for the desktop owner's queue to empty, so it cannot run inside it.
  const clear = element('button', t('sync.sourceReset.clear'), 'danger'); clear.type = 'button';
  clear.onclick = async () => {
    for (const control of dialog.querySelectorAll('button')) control.disabled = true;
    try { await resetWorkspace(text => { state.textContent = text; }, { cloud: false }); }
    catch (error) { state.textContent = error.message; for (const control of dialog.querySelectorAll('button')) control.disabled = false; }
  };
  dialog.append(element('h2', t('sync.sourceReset.title')),
    element('p', t('sync.sourceReset.body', { account: googleAccount?.email || t('sync.account.this') })),
    element('p', t('sync.sourceReset.clearHint')), state);
  const actions = element('div', undefined, 'dialog-actions');
  actions.append(button(t('sync.sourceReset.exportFirst'), () => { dialog.close(); return openSettings('data'); }), button(t('common.later'), () => dialog.close()), clear);
  dialog.append(actions); dialog.oncancel = event => { if ([...dialog.querySelectorAll('button')].some(control => control.disabled)) event.preventDefault(); };
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
}
// Deletes the current workspace on this device and reopens it empty, stopping everything that could write it back.
async function resetWorkspace(say, { cloud = profileId.startsWith('google:') } = {}) {
  if (accountBusy || nativeClosing) throw new Error(t('sync.errors.accountBusy'));
  accountBusy = true; clearInterval(syncTimer); stopAutomatic?.();
  let resetAttempted = false;
  try {
    await automatic?.service.whenIdle(); await syncService?.stop(); syncService = null;
    desktop?.beginClose(); if (desktop) await native.bridge.request('desktop.shortcuts.block', { blocked: true });
    await desktop?.whenIdle(); desktop?.sealClose();
    await Promise.allSettled([...activeActions, draftPending]);
    // Nothing of this workspace is kept, so its unsaved drafts must not hold the page open.
    currentDraft = null; unsavedDrafts.clear(); document.body.inert = true;
    if (cloud) {
      requireConnected();
      say(t('sync.reset.marking'));
      resetAttempted = true;
      await resetSource(new NativeGoogleFileStore(native.bridge, native.info, googleAccount.accountId),
        { job: workspace.state.sourceReset, saveJob: job => workspace.saveSourceReset(job),
          progress: (done, total) => say(t('sync.reset.deletingCloud', { done, total })) });
    }
    say(t('sync.reset.deletingDevice'));
    await storage.reset(profileId);
    // Native hosts reopen the document on the emptied profile after replying; the browser reloads itself.
    if (!native) { await browserJournal?.reset(profileId); lease.release(); location.reload(); }
  } catch (error) {
    // A save may have succeeded before its reply was lost. Reopen the journal instead of restarting an old writer.
    const saved = await storage.load(profileId).catch(() => null);
    if (saved?.sourceReset) {
      if (error.code === 'source-reset-superseded') {
        saved.sourceReset.superseded = true;
        const revision = saved.revision; saved.revision++;
        await storage.save(saved, revision).catch(() => {});
      }
      location.reload(); return;
    }
    if (resetAttempted && !saved) { location.reload(); return; }
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
  const authority = new DesktopAuthority({ workspace, controller, sessionId: desktopInfo.sessionId,
    perform: action => desktop.perform(action),
    shortcut: (target, intent) => desktopAction(target, intent),
    check: (id, revision, task) => tickStep(id, revision, task),
    residentLayers: () => residentLayers(),
    details: async (id, intent) => { await leaveAdjustOverlay(); await native.bridge.request('desktop.showMain', { intent }); cardDetails(currentCard(id)); },
    arrange: kind => arrangeDesktop(kind),
    attachments: (method, file) => method === 'attachment.preview' ? previewAttachment(file) : openAttachment(file),
    editor: {
      current: currentDesktopEditor,
      begin: async (id, viewId) => {
        if (editorBusy || composing || document.querySelector('dialog[open]')) throw new Error(t('app.errors.finishMainEdit'));
        const previous = currentDesktopEditor();
        if (previous?.cardId === id && previous.viewId === viewId) return { draftId: previous.draftId, sequence: previous.sequence };
        const reuseId = currentDraft?.cardId === id ? currentDraft.id : null;
        if (currentDraft) {
          if (controller.state.editingCardId) { if (!await controller.endEdit({ keepDraft: Boolean(reuseId) })) throw new Error(t('app.errors.finishInput')); }
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
        if (currentDraft?.id !== value.draftId || remoteEditor?.viewId !== value.viewId) throw new Error(t('app.errors.editorMoved'));
        currentDraft = draft; remoteEditor = copy(value);
      },
      save: () => saveEditor(),
      end: () => closeEditor(),
      full: async intent => {
        await flushDraft(); const draft = copy(currentDraft); const card = currentCard(draft.cardId);
        if (!await controller.endEdit({ keepDraft: true })) throw new Error(t('app.errors.finishInput')); remoteEditor = null;
        await leaveAdjustOverlay(); await native.bridge.request('desktop.showMain', { intent }); await openEditor(card, draft); render();
      },
    } });
  authority.configureDisplays(desktopInfo.topology ?? 0, desktopInfo.views);
  desktop = new DesktopOwner({ bridge: native.bridge, authority, editor: currentDesktopEditor,
    project: sequence => {
      const frame = projectDesktop({ snapshot: workspace.snapshot, layout: workspace.layout.state, interaction: controller.state,
        sessionId: desktopInfo.sessionId, sequence, topology: desktopInfo.topology ?? 0, workspaceRevision: workspace.state.revision, layers: desktopInfo.layers, residentLayers: residentLayers(), editor: currentDesktopEditor(), notice: desktopNotice });
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
  finally { nativeClosing = false; document.body.inert = false; }
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
// papers stay where they are. A mouse drags the whole row; a finger drags the grip, so the drawer still scrolls.
let groupDrag = null; let groupDragClick = false;
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
  if (event.pointerType === 'touch' && !event.target.closest('.group-grip')) return;
  groupDrag = { pointerId: event.pointerId, row, startY: event.clientY, active: false };
  if (event.pointerType === 'touch') moveGroupDrag(event, true);
}
function moveGroupDrag(event, force = false) {
  if (groupDrag?.pointerId !== event.pointerId) return;
  // A press released outside the list never reached it; hovering back must not start a drag.
  if (!(event.buttons & 1)) { endGroupDrag(event, false); return; }
  if (!groupDrag.active) {
    if (!force && Math.abs(event.clientY - groupDrag.startY) < 5) return;
    // A render since the press replaced the row; the next press starts afresh.
    if (!groupDrag.row.isConnected) { groupDrag = null; return; }
    // Capturing only now leaves a plain click on the row's own button.
    groupDrag.active = true; $('#groups').setPointerCapture(event.pointerId);
    groupDrag.row.classList.add('dragging'); document.body.classList.add('group-dragging');
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
  const { active, row } = groupDrag; groupDrag = null;
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
  const snapshot = workspace.snapshot; const layout = workspace.layout.state; const groups = shownGroups();
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

// Drafts and the share inbox appear only when they hold something, and conflicts show in the status bar only while
// there are some; version history stays in Settings.
function renderCounts() {
  const draftCount = Object.keys(workspace.state.drafts).length; const conflictCount = workspace.state.conflicts.length;
  $('#draft-count').textContent = String(draftCount); $('#drafts-button').hidden = !draftCount;
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
    paper.append(element('div', summaryText(card), 'card-summary'));
    const body = element('div', undefined, 'card-body markdown');
    if (policy.editing && currentDraft?.cardId === card.id && !remoteEditor && !$('#editor-dialog').open) {
      const input = element('textarea', undefined, 'inline-editor'); input.value = currentDraft.content.text;
      input.setAttribute('aria-label', t('desktop.editor.label'));
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
      paper.append(body);
    } else {
      // The canvas stands in for the desktop, so papers that take clicks tick their steps there too.
      // Its boxes wait while a tick saves, so a second quick click cannot tick from the same, soon outdated revision.
      renderMarkdown(body, card.content.text, policy.interactive && !policy.editing ? { onToggle: task => {
        for (const box of body.querySelectorAll('input[type="checkbox"]')) box.disabled = true;
        run(() => tickStep(card.id, card.revision, task).catch(error => { render(); throw error; }));
      } } : {});
      paper.append(body); stageFitter.observe(body);
      const strip = attachmentStrip(card.content.attachments || [], stageAttachmentCleanup, stageFitter); if (strip) paper.append(strip);
    }
    if (policy.draggable) {
      paper.tabIndex = 0; paper.setAttribute('aria-label', summaryText(card));
      const actions = element('div', undefined, 'card-actions');
      if (policy.editing) actions.append(button(t('desktop.editor.full'), () => openEditor(card, currentDraft)), button(t('common.save'), () => saveEditor()));
      else actions.append(button(t('desktop.card.edit'), () => beginInlineEdit(card)), button('⋯', () => cardDetails(card)));
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

// The board shows each paper as the 240 px square a new desktop paper is, however wide the window, until the phone
// layout's two columns take over at 640 px; the list keeps one row per paper. Both open the editor.
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
    const body = element('div', undefined, 'note-body markdown'); renderMarkdown(body, card.content.text, { highlight: view !== 'list' });
    const meta = element('div', undefined, 'note-meta');
    const { done, total } = checklistProgress(card.content.text); const files = card.content.attachments?.length || 0;
    if (total) meta.append(element('span', plural('app.count.steps', total, { done })));
    if (files) meta.append(element('span', plural('app.count.attachments', files)));
    if (acrossGroups) meta.append(element('span', groupName(groups.find(group => group.id === card.groupId)) || t('app.groups.pendingSync')));
    const actions = element('div', undefined, 'note-actions');
    if (card.deleted) actions.append(button(t('app.notes.restore'), async () => { await workspace.restoreCard(card.id, card.revision); render(); status(t('app.status.restored')); }));
    else {
      actions.append(iconButton(card.completed ? t('app.notes.markToDo') : t('app.notes.markCompleted'), card.completed ? ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'] : ['m5 12.5 4.5 4.5L19 7'],
        () => changeCard(card.id, { completed: !card.completed })),
      iconButton(t('app.notes.more'), ['M5.5 12h.01M12 12h.01M18.5 12h.01'], () => cardDetails(card)));
      note.tabIndex = 0; note.setAttribute('aria-label', title);
      note.onclick = event => { if (!event.target.closest('a,button,input')) run(() => openEditor(card)); };
      note.onkeydown = event => { if (event.target === note && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); run(() => openEditor(card)); } };
    }
    const heading = element('h3', title, 'note-title');
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
// A checkbox on a desktop paper ticks that step in place, as a new revision of the note. A draft of the note, open in
// an editor (its first write may still be on the way to disk) or kept, would no longer match it, so ticking waits until
// that draft is saved or dropped.
async function tickStep(id, revision, task) {
  const card = currentCard(id);
  if (!card || card.revision !== revision) throw new FleetError('desktop-expired', t('errors.desktop.noteChanged'));
  if (currentDraft?.cardId === id || Object.values(workspace.state.drafts).some(draft => draft.cardId === id)) {
    throw new FleetError('draft-open', t('errors.desktop.noteHasDraft'));
  }
  await workspace.updateCard(id, { content: { ...card.content, text: toggleChecklist(card.content.text, task) } }, revision);
  await controller.reconcile(); render(); status(t('app.status.savedLocally'));
}

// Deleting asks nothing: the status line offers to undo it, and Deleted keeps the note until it is restored.
async function deleteCard(id) {
  const deleted = await workspace.updateCard(id, { deleted: true }, currentCard(id).revision);
  await controller.reconcile(); render();
  status(t('app.status.deleted'), false, { label: t('app.status.undoDelete'), run: async () => {
    await workspace.restoreCard(id, deleted.revision); render(); status(t('app.status.restored'));
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
    await workspace.layout.placeNew(workspace.snapshot, workAreas()); dialog.close(); render(); status(t('app.status.groupSaved'));
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
      message.textContent = t('app.merge.summary', { notes: plural('app.count.notes', preview.cards.length),
        drafts: plural('app.count.drafts', preview.draftCount), group: groupName({ name: preview.targetName }) });
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

function cardDetails(card) {
  const dialog = element('dialog'); dialog.append(element('h2', summaryText(card)));
  const groupLabel = element('label', t('app.card.moveToGroup'), 'field'); const select = element('select'); fillGroups(select, card.groupId); groupLabel.append(select);
  const visibility = element('label', undefined, 'check'); const check = element('input'); check.type = 'checkbox'; check.checked = workspace.layout.state.placements[card.id]?.visible !== false; visibility.append(check, document.createTextNode(t('app.card.showOnDesktop')));
  // Which layer a paper sits on belongs to its group and changes only with the group's shortcut on the desktop.
  // Phones show no desktop papers, so the display option they cannot show stays unchanged.
  dialog.append(groupLabel, ...handheld ? [] : [visibility]);
  const actions = element('div', undefined, 'dialog-actions');
  actions.append(button(card.archived ? t('app.card.unarchive') : t('app.card.archive'), async () => { await changeCard(card.id, { archived: !card.archived }); dialog.close(); }),
    button(t('app.card.delete'), async () => { await deleteCard(card.id); dialog.close(); }),
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

async function openEditor(card = null, recovered = null) {
  if (composing) return;
  editorHidesMain = false;
  if (!card && !recovered) await ensureCaptureGroup();
  if (controller.state.editingCardId && currentDraft) await controller.endEdit({ keepDraft: recovered?.id === currentDraft.id });
  remoteEditor = null;
  currentDraft = recovered ? workspace.recoverDraft(recovered.id) : workspace.blankDraft(activeGroupId, card);
  currentDraft.content.attachments ||= [];
  setText('#editor-title', card || recovered?.baseRevision ? () => t('app.editor.editTitle') : () => t('app.actions.capture'));
  $('#editor-heading').value = currentDraft.content.title || '';
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
    const body = paper.querySelector('.card-body'); renderMarkdown(body, card.content.text); fitText(body);
    paper.querySelector('.card-actions')?.replaceChildren(button(t('desktop.card.edit'), () => beginInlineEdit(card)), button('⋯', () => cardDetails(card)));
  }
  if (currentDraft?.cardId === cardId) currentDraft = null;
}

function queueDraft() {
  if (!currentDraft) return Promise.resolve();
  const sequence = ++draftSequence; const id = currentDraft.id;
  unsavedDrafts.set(id, sequence);
  $('#draft-status').textContent = t('desktop.draft.saving');
  draftPending = workspace.saveDraft(copy(currentDraft));
  draftPending.then(() => {
    if (unsavedDrafts.get(id) === sequence) unsavedDrafts.delete(id);
    if (sequence === draftSequence && currentDraft?.id === id) $('#draft-status').textContent = t('desktop.draft.saved');
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
  $('#stage').querySelectorAll('.inline-editor').forEach(node => { node.readOnly = value; });
  $('#editor-form').querySelectorAll('button').forEach(node => { node.disabled = value; });
  $('#attachment-input').disabled = value;
  $('#editor-group').disabled = value || Boolean(currentDraft?.baseRevision);
}
// Ending an edit drops a draft with nothing to keep: blank content or an unchanged copy of its card.
const closedStatus = draft => draft && !workspace.state.drafts[draft.id] ? t('app.status.closedNoDraft') : t('app.status.draftKept');
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
    await returnHiddenMain();
  }
  finally { setEditorBusy(false); }
}
// The tray may have gone since; the window then simply stays open.
async function returnHiddenMain() {
  if (!editorHidesMain) return;
  editorHidesMain = false;
  if (desktop && !document.querySelector('dialog[open]')) await native.bridge.request('desktop.hideMain').catch(() => {});
}
async function saveEditor(asCopy = false) {
  if (editorBusy || !currentDraft || composing) return;
  setEditorBusy(true);
  try {
    await flushDraft();
    // A new note's group, picked in the editor or not, becomes the one shown and remembered, as a sidebar choice does.
    const landed = currentDraft.baseRevision ? null : currentDraft.groupId;
    await workspace.commitDraft(currentDraft.id, { asCopy });
    currentDraft = null; remoteEditor = null; $('#editor-dialog').close(); controller.setComposing(false); await controller.endEdit();
    if (landed) { activeGroupId = landed; showToDo(); }
    await workspace.layout.placeNew(workspace.snapshot, workAreas()); render(); status(t('app.status.noteSaved'));
    if (landed) await rememberGroup();
    await returnHiddenMain();
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
  const snapshot = workspace.snapshot;
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
function openSettings(page = null) {
  const dialog = $('#settings-dialog');
  if (!dialog.open) { renderLanguageSetting(); renderDesktopSettings(); renderShortcutSettings(); renderAccount(); dialog.showModal(); }
  return showSettingsPage(page);
}
async function showSettingsPage(page) {
  if (page === null && !narrow.matches) page = settingsPage || 'account';
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
    await controller.reconcile(); await workspace.layout.placeNew(workspace.snapshot, workAreas()); render();
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
  $('#display-detail').textContent = fixed ? t('settings.desktop.display.fixed')
    : pending ? t('settings.desktop.display.pending') : t('settings.desktop.display.hint');
}
// ADR-043: startup behaviour and the main window belong to this computer's host, not to the workspace or its backups.
// The switches show what the system actually does; a sign-in item the user turned off there stays off.
let hostPreferences = null;
const distributionName = value => ({ msix: t('settings.desktop.distribution.msix'), zip: t('settings.desktop.distribution.zip'),
  debug: t('settings.desktop.distribution.debug'), deb: t('settings.desktop.distribution.deb'), bundle: t('settings.desktop.distribution.bundle'),
  source: t('settings.desktop.distribution.source'), app: t('settings.desktop.distribution.app') })[value] || '';
// macOS keeps Work Fleet in the menu bar; Windows and Linux in the tray.
const menuBar = () => native?.info.platform === 'macos';
function renderHostSettings() {
  const available = native?.info.capabilities.hostPreferences === true; $('#host-settings').hidden = !available;
  // Where the host keeps the main window's placement, resetting the desktop layout also resets the window, and says so.
  const hint = $('#reset-layout-hint'); hint.dataset.i18n = available ? 'settings.desktop.resetLayout.hintWindow' : 'settings.desktop.resetLayout.hint';
  const text = $('#reset-layout-text'); text.dataset.i18n = available ? 'settings.desktop.resetLayout.confirmTextWindow' : 'settings.desktop.resetLayout.confirmText';
  hint.textContent = t(hint.dataset.i18n); text.textContent = t(text.dataset.i18n);
  if (!available) return;
  $('#app-version').textContent = t('settings.desktop.version', { version: native.info.appVersion });
  $('#app-distribution').textContent = distributionName(native.info.distribution);
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
  // Inert blocks real input and focus; capture also rejects synthetic or already dispatched owner input.
  for (const type of ['click', 'dblclick', 'pointerdown', 'keydown', 'submit']) document.addEventListener(type, event => {
    if (!adjustOverlayActive()) return;
    // An owned foreground window suspends global hotkeys, so its local desktop keys and Escape must still work.
    if (type === 'keydown' && (event.key === 'Escape' || shortcutForEvent(event, liveShortcuts()))) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  setDrawer(false); new ResizeObserver(fitBars).observe($('.view-bar'));
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
  groupList.addEventListener('pointerdown', startGroupDrag); groupList.addEventListener('pointermove', event => moveGroupDrag(event));
  groupList.addEventListener('pointerup', event => endGroupDrag(event, true)); groupList.addEventListener('pointercancel', event => endGroupDrag(event, false));
  // Only the list's own capture counts; a grip handing its touch capture to the list must not end the drag.
  groupList.addEventListener('lostpointercapture', event => { if (event.target === groupList) endGroupDrag(event, false); });
  groupList.addEventListener('click', event => { if (groupDragClick) { event.preventDefault(); event.stopPropagation(); } }, true);
  groupList.addEventListener('keydown', stepGroupOrder);
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
    await workspace.layout.placeNew(workspace.snapshot, workAreas()); await controller.reconcile();
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
  $('#save-copy').onclick = () => run(() => saveEditor(true));
  $('#keep-draft').onclick = () => run(closeEditor); $('#close-editor').onclick = () => run(closeEditor);
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
      if (result.draftId) await openEditor(null, workspace.state.drafts[result.draftId]);
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
  $('#drafts-button').onclick = () => run(() => {
    const list = $('#draft-list'); list.replaceChildren();
    for (const draft of Object.values(workspace.state.drafts)) {
      const row = element('div', undefined, 'draft-row'); row.append(element('p', (draft.content.title || draft.content.text).slice(0, 110) || t('app.drafts.blank')), button(t('app.drafts.resume'), () => { $('#drafts-dialog').close(); return openEditor(null, draft); })); list.append(row);
    }
    if (!list.children.length) list.append(element('p', t('app.drafts.none'))); $('#drafts-dialog').showModal();
  });
  $('#close-drafts').onclick = () => $('#drafts-dialog').close();
  // The status bar shows conflicts only while there are some; the button opens their page in Settings, which waits for
  // an input in progress.
  $('#conflicts-button').onclick = () => run(() => openSettings('revisions'));
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
    if (result.kind === 'transferred') status(t('app.status.movedToGroup'));
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
      const before = document.activeElement;
      run(async () => { await desktopAction(shortcut.target, (await admission).intent); handOverFocus(before); }, { duringAdjust: true });
      return;
    }
    if (editControl) return;
    if (event.key === 'Escape') { event.preventDefault(); const before = document.activeElement; run(async () => { await controller.escape(); render(); handOverFocus(before); }, { duringAdjust: true }); }
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
