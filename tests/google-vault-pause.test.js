import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { formatDate, plural, t } from '../src/i18n/index.js';
import { NotificationQueue } from '../src/app/notifications.js';

// Run the actual account presenter with a bounded DOM/bridge fixture; no account data or browser is opened.
const source = await readFile(new URL('../src/app/main.js', import.meta.url), 'utf8');
const initialize = source.slice(source.indexOf('async function initializeGoogle()'), source.indexOf('function renderGoogleAccess()'));
const presenter = source.slice(source.indexOf('function renderGoogleAccess()'), source.indexOf('// The account chip'));
const synchronize = source.slice(source.indexOf('async function syncGoogle('), source.indexOf('function resetFailure('));
const syncPresentation = source.slice(source.indexOf('function setSync('), source.indexOf('// The drawer hides'));
const maintenance = source.slice(source.indexOf('function resetFailure('), source.indexOf('function scheduleMaintenance('));
const progress = source.slice(source.indexOf('function datasetProgressText('), source.indexOf('async function runDatasetChange('));
assert.ok(synchronize.length > 0 && !synchronize.includes('run(initialize)'), 'sync fixture must not include the app bootstrap');
const changeAccount = source.slice(source.indexOf('async function changeGoogleAccount('), source.indexOf('function resetPlan()'));
// main.js passes status text as a string or as a function that builds it in the current language.
const textOf = value => typeof value === 'function' ? value() : value;

async function fixture(profileId, account, state = {}, jobs = {}) {
  const nodes = new Map(); const timers = []; const syncs = []; const connections = []; let immediate = 0;
  const notices = new NotificationQueue({ schedule: () => 0, cancel() {} });
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { classList: { toggle() {} } }); return nodes.get(id); };
  const context = vm.createContext({
    profileId, googleAccount: null, syncTimer: null, syncService: null, t, textOf,
    notifications: () => notices, sectionName: id => t(id.startsWith('google:') ? 'app.sections.cloud' : 'app.sections.local'),
    native: { info: { profileId }, bridge: { request: async method => { assert.equal(method, 'google.status'); return account; } } },
    workspace: { state }, primary: { state }, storage: { getJob: async key => jobs[key] ?? null, putJob: async (key, value) => { jobs[key] = value; } }, sourceResetAsked: true,
    datasetStore: null, pendingReset: null, datasetProblem: null, maintenancePaused: false, scheduleMaintenance() {}, stopAutomatic: null, automatic: { service: { clearSettings: async () => {} } },
    maintenanceNotice: null, maintenanceFailure: null, maintenanceWork: null, nativeClosing: false,
    $, setText: (id, text) => { $(id).textContent = textOf(text); },
    clearInterval() {}, setInterval: (callback, delay) => { timers.push({ callback, delay }); return 1; }, addEventListener() {},
    renderAccount() {}, setSync: (...args) => syncs.push(args), syncGoogle: async () => { immediate++; },
    changeGoogleAccount() {}, askResumeCloudRestore() {}, askDatasetRecovery() { connections.push('recover-local-copy'); }, openSettings() {},
    NativeGoogleDatasetStore: class { constructor(bridge, info, accountId) { assert.equal(info.profileId, `google:${accountId}`); } },
    DatasetSync: class { constructor(options) { connections.push(options); } },
  });
  await vm.runInContext(`${presenter}\n${maintenance}\n${progress}\n${initialize}\ninitializeGoogle()`, context);
  return { nodes, timers, syncs, immediate, connections, context, notices };
}

test('locked vault keeps offline Google notes and a retry route without suggesting reauthentication', async () => {
  const f = await fixture('google:fixture', { configured: true, connected: false, accountId: 'fixture', paused: true, pauseReason: 'The system keyring is locked' });
  assert.equal(f.nodes.get('#google-value').textContent, t('sync.status.paused'));
  assert.equal(f.nodes.get('#google-sign-in').textContent, t('sync.google.switchAccount'));
  assert.equal(f.nodes.get('#google-sync').textContent, t('sync.actions.syncNow'));
  assert.equal(f.nodes.get('#sync-row').hidden, false);
  assert.equal(f.nodes.get('#google-sign-out').hidden, false);
  assert.equal(f.immediate, 0);
  assert.equal(f.timers.length, 1);
  assert.equal(f.timers[0].delay, 20000);
  assert.equal(f.syncs[0][0], 'attention');
  await f.nodes.get('#google-sync').onclick();
  assert.equal(f.context.googleAccount.accountId, 'fixture');
});

test('pending reset journals pause sync and a superseded transition exposes explicit recovery', async () => {
  for (const failed of [false, true]) {
    const jobs = { 'dataset-reset': { phase: 'capture', ready: false },
      ...failed ? { 'dataset-ui-error': { code: 'source-reset-superseded', message: 'Another reset won' } } : {} };
    const f = await fixture('google:fixture', { configured: true, connected: true, accountId: 'fixture' }, {}, jobs);
    assert.equal(f.immediate, 0); assert.equal(f.timers.length, 0); assert.equal(f.connections.length, 0);
    assert.equal(f.nodes.get('#google-sync').textContent, t(failed ? 'sync.recovery.options' : 'sync.status.resetting'));
    assert.equal(f.nodes.get('#google-sync').disabled, !failed);
    if (failed) { await f.nodes.get('#google-sync').onclick(); assert.deepEqual(f.connections, ['recover-local-copy']); }
  }
});

test('saved reset timeout uses continuation guidance and clearing does not claim readiness', async () => {
  const jobs = { 'dataset-reset': { phase: 'clearing', ready: false, deleted: 100, captured: 106 },
    'dataset-ui-error': { code: 'native-outcome-unknown', message: 'Keep your text and reopen Pin It Anywhere to check.' } };
  const f = await fixture('google:fixture', { configured: true, connected: true, accountId: 'fixture' }, {}, jobs);
  assert.equal(f.notices.items.get('maintenance:google:fixture').text, t('sync.reset.paused', { error: t('sync.reset.unconfirmed') }));
  assert.ok(f.notices.items.get('maintenance:google:fixture').action);
  assert.equal(f.context.maintenanceFailure.code, 'native-outcome-unknown');
  const text = vm.runInContext('datasetProgressText({ phase: "clearing", completed: 100, total: 106, ready: false })', f.context);
  assert.ok(text.includes('100 / 106')); assert.ok(!text.includes('New data is ready'));
});

test('a completed reset stays silent on reopening, while a newly completed job announces once', async () => {
  const jobs = { 'dataset-reset': { phase: 'complete', seeded: true, ready: true, deleted: 12, captured: 12 } };
  const f = await fixture('google:fixture', { configured: true, connected: true, accountId: 'fixture' }, {}, jobs);
  assert.equal(f.notices.items.size, 0);
  assert.equal(jobs['dataset-reset'].phase, 'complete', 'notification policy must preserve the durable reset journal');
  vm.runInContext('reportDatasetProgress({ phase: "complete", completed: 12, total: 12, ready: true })', f.context);
  assert.equal(f.notices.items.get('maintenance:google:fixture').text, t('sync.reset.cleaned'));
  assert.equal(f.notices.items.get('maintenance:google:fixture').context, t('app.sections.cloud'));
  f.notices.dismiss('maintenance:google:fixture');
  await vm.runInContext('initializeGoogle()', f.context);
  assert.equal(f.notices.items.size, 0);
});

test('unlock status updates the same account controls without starting OAuth', async () => {
  const f = await fixture('google:fixture', { configured: true, connected: false, accountId: 'fixture', paused: true });
  f.context.googleAccount = { configured: true, connected: true, accountId: 'fixture', email: 'synthetic@example.test', paused: false };
  vm.runInContext('renderGoogleAccess()', f.context);
  assert.equal(f.nodes.get('#google-value').textContent, 'synthetic@example.test');
  assert.equal(f.nodes.get('#google-sign-in').textContent, t('sync.google.switchAccount'));
  assert.equal(f.nodes.get('#sync-row').hidden, false);
});

test('hosts without optional vault pause fields retain connected and signed-out behaviour', async () => {
  const connected = await fixture('google:fixture', { configured: true, connected: true, accountId: 'fixture', email: 'synthetic@example.test' });
  assert.equal(connected.immediate, 1);
  assert.ok(connected.connections[0].fileStore, 'the app uses the dataset coordinator with an account-bound store');
  const local = await fixture('local', { configured: true, connected: false });
  assert.equal(local.nodes.get('#google-value').textContent, t('sync.google.signedOut'));
  assert.equal(local.nodes.get('#sync-row').hidden, true);
  assert.equal(local.timers.length, 0);
});

function syncFixture({ capability = true, unlock, sync, platform = 'windows', present = false } = {}) {
  const nodes = new Map(); const calls = []; const states = []; const retries = [];
  const notices = new NotificationQueue({ schedule: () => 0, cancel() {} });
  const account = { configured: true, connected: true, paused: false, accountId: 'fixture', email: 'synthetic@example.test' };
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { dataset: {} }); return nodes.get(id); };
  const context = vm.createContext({
    AbortController, maintenanceWork: null, syncRequested: false, datasetProblem: null, maintenancePaused: false,
    stopMaintenance: async () => {}, scheduleMaintenance() {}, datasetStore: null,
    profileId: 'google:fixture', googleAccount: { ...account, ...platform === 'android' ? {} : { connected: false, paused: true } }, t, plural, formatDate, textOf,
    native: { info: { platform, capabilities: { vaultUnlock: capability } }, bridge: { request: async method => {
      assert.equal(method, 'google.unlockVault'); calls.push(method); return unlock ? unlock() : account;
    } } },
    syncService: { sync: async options => { await options.onActivity(); calls.push(['sync', options.force]); if (sync) await sync(); return { phase: 'idle' }; } },
    syncBusy: false, nativeClosing: false, sharedIdsBlocked: false, accountBusy: false, composing: false, dataPanel: null, revisions: null, desktop: null, landingFailed: false,
    androidBackground: false, androidSyncEpoch: 0, syncRetry: null,
    listingLag: null, listingLagWaits: 0, setTimeout: (callback, delay) => retries.push({ callback, delay }), clearTimeout() {}, queueMicrotask, Date, Math,
    document: { visibilityState: 'visible', querySelectorAll: () => [] },
    shownSync: null, syncState: 'off', maintenanceNotice: null, updateAttention() {}, loadGoogleProfile() {},
    notifications: () => notices, sectionName: () => 'Cloud notes',
    $, setText: (id, text) => { $(id).textContent = textOf(text); },
    setSync: (...args) => states.push(args), renderAccount() {},
    stopCompanionBackups() {}, startCompanionBackups() {}, companionBackupsIdle: async () => {}, companions: [],
    flushDraft: async () => calls.push('flush'),
    workspace: { snapshot: { groups: [{ id: 'group' }] }, pendingCount: 0, sharedIds: () => [], layout: { placeNew: async () => {}, takeArrivedOffDesktop: () => [] },
      syncState: { lastSuccessfulSyncAt: '2026-11-03T01:00:00.000Z' } },
    activeGroups: snapshot => snapshot.groups, activeGroupId: 'group',
    controller: { reconcile: async () => {} }, workAreas: () => [], render() {},
  });
  vm.runInContext(`${presenter}\n${synchronize}`, context);
  if (present) {
    vm.runInContext(syncPresentation, context);
    const show = context.setSync; context.setSync = (...args) => { states.push(args); show(...args); };
  }
  return { nodes, calls, states, retries, context, notices, invoke: force => vm.runInContext(`syncGoogle(${force})`, context) };
}

// One turn of the real maintenance loop, with the cleanup step's outcome supplied.
const maintain = source.slice(source.indexOf('async function maintainDataset('), source.indexOf('async function confirmPurge('));
function maintenanceFixture({ step, resetPending = false, platform = 'windows' }) {
  const delays = [], notices = []; const nothing = () => {};
  const context = vm.createContext({ companions: [], primary: { state: {} }, workspace: { state: { cloudRestore: resetPending ? {} : null }, syncState: {}, layout: { placeNew: async () => {} } }, pendingReset: null, datasetProblem: null, maintenanceWork: null,
    maintenancePaused: false, accountBusy: false, syncBusy: false, nativeClosing: false, sharedIdsBlocked: false, editorBusy: false, composing: false, dataPanel: null, revisions: null,
    document: { visibilityState: 'visible', querySelectorAll: () => [] }, native: { info: { platform } }, androidBackground: false, androidSyncEpoch: 0,
    profileId: 'local', googleAccount: null, maintenanceAbort: { signal: { aborted: false } }, maintenanceFailure: null, datasetStore: null,
    purge: { step }, advanceDatasetRestore: step, resetFailure: error => ({ code: error.code, message: error.message }), storage: { putJob: async () => {}, deleteJob: async () => {}, getControl: async () => null, maintenance: async () => false },
    cleanupDatasetTransition: async () => false, setSync: nothing, showMaintenance: (...args) => notices.push(args), setText: nothing, syncRequested: false, syncGoogle: nothing, render: nothing, t,
    scheduleMaintenance: delay => delays.push(delay), $: () => ({}), reportDatasetProgress: nothing, controller: { reconcile: async () => {} }, workAreas: () => [], automatic: null });
  vm.runInContext(`${synchronize}\n${maintain}`, context);
  return { context, delays, notices, invoke: () => vm.runInContext('maintainDataset()', context) };
}
async function maintenanceDelay(options) {
  const f = maintenanceFixture(options); await f.invoke(); return f.delays.at(-1);
}
const visibility = async () => { throw Object.assign(new Error('Not listed yet'), { code: 'dataset-visibility' }); };

test('cleanup waiting for a listing asks Drive no more often than a sync does, while a reset keeps its pace', async () => {
  assert.equal(await maintenanceDelay({ step: visibility }), 20000);
  assert.equal(await maintenanceDelay({ step: visibility, resetPending: true }), 2500);
  assert.equal(await maintenanceDelay({ step: async () => null }), 2500);
  assert.equal(await maintenanceDelay({ step: async () => ({ phase: 'committed' }) }), 250);
});

const lagError = () => Object.assign(new Error('Not visible yet'), { code: 'dataset-visibility' });
const settle = () => new Promise(resolve => setImmediate(resolve));

for (const signal of ['host', 'visibility']) test(`Android ${signal} background signal stops automatic Drive checks`, async () => {
  const f = syncFixture({ platform: 'android', capability: false });
  if (signal === 'host') f.context.androidBackground = true;
  else f.context.document.visibilityState = 'hidden';
  await f.invoke(false);
  assert.deepEqual(f.calls, [], 'a locked or hidden phone must not start another Drive pass');
});

test('a hidden desktop keeps its resident synchronization', async () => {
  const f = syncFixture({ capability: false }); f.context.document.visibilityState = 'hidden';
  await f.invoke(false);
  assert.ok(f.calls.some(value => Array.isArray(value) && value[0] === 'sync'));
});

test('native Android pause/resume handlers suspend and coalesce automatic checks', async () => {
  const f = syncFixture({ platform: 'android', capability: false }); const events = new Map();
  f.context.native.bridge.onEvent = (name, action) => events.set(name, action);
  f.context.run = action => action(); f.context.automatic = null; f.context.stopAutomatic = null;
  f.context.syncService.resume = () => {};
  const start = source.indexOf("    native.bridge.onEvent('host-background'");
  const end = source.indexOf("    await native.bridge.request('host.ready');", start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(source.slice(start, end), f.context);
  events.get('host-background')({}); await settle(); f.calls.length = 0;
  await f.invoke(false); assert.equal(f.calls.length, 0);
  assert.equal(f.context.androidSyncEpoch, 1);
  events.get('host-foreground')(); events.get('host-foreground')(); await settle();
  assert.equal(f.calls.filter(value => Array.isArray(value) && value[0] === 'sync').length, 1);
});

test('Android background maintenance starts no purge or storage cleanup work', async () => {
  let calls = 0;
  const f = maintenanceFixture({ platform: 'android', step: async () => { calls++; return null; } });
  f.context.androidBackground = true; await f.invoke();
  assert.equal(calls, 0); assert.equal(f.notices.length, 0);
  f.context.androidBackground = false; await f.invoke(); assert.equal(calls, 1);
});

test('maintenance interrupted by Android suspension retries its journal without a permanent error toast', async () => {
  let first = true;
  const f = maintenanceFixture({ platform: 'android', step: async () => {
    if (!first) return null;
    first = false; f.context.androidBackground = true; f.context.androidSyncEpoch++;
    throw Object.assign(new Error('Background network unavailable'), { code: 'network' });
  } });
  await f.invoke(); assert.equal(f.notices.length, 0); assert.equal(f.context.maintenancePaused, false);
  f.context.androidBackground = false; await f.invoke(); assert.equal(f.notices.length, 0);
});

test('an explicit reset keeps its recorded failure even if Android was suspended', async () => {
  const f = maintenanceFixture({ platform: 'android', resetPending: true, step: async () => {
    f.context.androidBackground = true; f.context.androidSyncEpoch++;
    throw Object.assign(new Error('Reset network unavailable'), { code: 'network' });
  } });
  await f.invoke(); assert.equal(f.context.maintenancePaused, true); assert.equal(f.notices.length, 1);
  assert.equal(f.context.maintenanceFailure.code, 'network');
});

test('an Android request interrupted by suspension waits for one foreground retry and respects backoff', async () => {
  let reject, now = 1000, first = true;
  const f = syncFixture({ platform: 'android', capability: false, present: true,
    sync: () => first ? new Promise((_resolve, fail) => { reject = fail; }) : undefined });
  f.context.Date = class extends Date { static now() { return now; } };
  const pass = f.invoke(false); await settle();
  f.context.androidBackground = true; f.context.androidSyncEpoch++;
  f.context.syncService.status = { nextAttemptAt: 2000, error: { code: 'network' } };
  reject(Object.assign(new Error('Network unavailable'), { code: 'network' })); await pass; await settle();
  assert.equal(f.context.syncState, 'busy');
  assert.equal(f.nodes.get('#sync-status').textContent, t('sync.status.waiting'));
  assert.equal(f.notices.items.size, 0, 'suspension must not replay an obsolete failure on unlock');

  first = false; f.context.androidBackground = false;
  const before = f.calls.length;
  await f.invoke(false); await f.invoke(false);
  assert.equal(f.calls.length, before, 'resume must honor the provider retry deadline');
  assert.equal(f.retries.length, 1, 'duplicate resume triggers must share one retry');
  now = 2001; f.retries[0].callback(); await settle();
  assert.equal(f.context.syncState, 'ok'); assert.equal(f.notices.items.size, 0);
});

test('a late Android background failure cannot become a fresh foreground error', async () => {
  let reject;
  const f = syncFixture({ platform: 'android', capability: false, sync: () => new Promise((_resolve, fail) => { reject = fail; }) });
  const pass = f.invoke(false); await settle();
  f.context.androidSyncEpoch++;
  f.context.syncService.status = { nextAttemptAt: Date.now() + 1000, error: { code: 'network' } };
  reject(Object.assign(new Error('Old network request'), { code: 'network' })); await pass; await settle();
  assert.equal(f.states.some(value => value[0] === 'error'), false);
  assert.equal(f.retries.length, 1);
});

test('a current foreground network failure is visible, and its confirmed recovery clears the same toast', async () => {
  let offline = true;
  const f = syncFixture({ platform: 'android', capability: false, present: true,
    sync: () => { if (offline) throw Object.assign(new Error('Network unavailable'), { code: 'network' }); } });
  await f.invoke(false);
  assert.equal(f.context.syncState, 'error'); assert.equal(f.notices.items.get('sync:google:fixture').text, 'Network unavailable');
  offline = false; await f.invoke(false);
  assert.equal(f.context.syncState, 'ok'); assert.equal(f.notices.items.has('sync:google:fixture'), false);
});

test('an old Android retry cannot poll a replacement account or replay after manual sync', async () => {
  for (const action of ['account', 'manual']) {
    const f = syncFixture({ platform: 'android', capability: false });
    f.context.syncService.status = { nextAttemptAt: Date.now() + 1000 };
    await f.invoke(false); assert.equal(f.retries.length, 1);
    if (action === 'account') f.context.syncService = { sync: () => assert.fail('the previous account must not poll its replacement') };
    else await f.invoke(true);
    const before = f.calls.length; f.retries[0].callback(); await settle();
    assert.equal(f.calls.length, before);
  }
});

test('suspension never conceals an authorization failure', async () => {
  let reject;
  const f = syncFixture({ platform: 'android', capability: false, present: true, sync: () => new Promise((_resolve, fail) => { reject = fail; }) });
  const pass = f.invoke(false); await settle(); f.context.androidBackground = true; f.context.androidSyncEpoch++;
  reject(Object.assign(new Error('Sign in again'), { code: 'unauthorized' })); await pass;
  assert.equal(f.context.syncState, 'error'); assert.equal(f.notices.items.get('sync:google:fixture').text, 'Sign in again');
});

test('a fractional backoff still gets a retry that does not arrive early', async () => {
  const f = syncFixture({ sync: () => { throw lagError(); } });
  f.context.syncService.status = { nextAttemptAt: Date.now() + 1000.4 };
  await f.invoke(false);
  assert.ok(Number.isInteger(f.retries[0].delay)); assert.ok(f.retries[0].delay >= 1000);
});

test('a listing behind the feed shows as syncing and retries when the backoff ends, without reporting a failure', async () => {
  let lagging = true;
  const f = syncFixture({ sync: () => { if (lagging) throw lagError(); } });
  f.context.syncService.status = { nextAttemptAt: Date.now() + 5000 };
  await f.invoke(false);
  assert.equal(f.states.at(-1)[0], 'busy'); assert.equal(textOf(f.states.at(-1)[1]), t('sync.status.syncing'));
  assert.equal(f.retries.length, 1); assert.ok(f.retries[0].delay > 0 && f.retries[0].delay <= 5001);
  assert.ok(f.retries[0].delay >= f.context.syncService.status.nextAttemptAt - Date.now(), 'never a moment before the backoff ends');

  const passes = () => f.calls.filter(call => call[0] === 'sync').length, ran = passes();
  await f.invoke(false);
  assert.equal(passes(), ran, 'a timer tick during the wait starts nothing');
  await f.invoke(true);
  assert.equal(passes(), ran + 1, 'Sync now still can');

  lagging = false; f.retries.at(-1).callback(); await settle();
  assert.equal(f.states.at(-1)[0], 'ok');
  assert.equal(vm.runInContext('listingLagWaits', f.context), 0, 'a success ends the count');
});

test('a listing that stays behind the feed is reported after six waits', async () => {
  const f = syncFixture({ sync: () => { throw lagError(); } });
  f.context.syncService.status = { nextAttemptAt: 0 };
  await f.invoke(false);
  for (let i = 0; i < 5; i++) { f.retries.at(-1).callback(); await settle(); }
  assert.equal(f.retries.length, 6); assert.equal(f.states.at(-1)[0], 'busy');
  f.retries.at(-1).callback(); await settle();
  assert.equal(f.retries.length, 6); assert.equal(f.states.at(-1)[0], 'error');
});

test('a wait left by an account does not hold the next account back', async () => {
  const f = syncFixture({ sync: () => { throw lagError(); } });
  f.context.syncService.status = { nextAttemptAt: 0 };
  await f.invoke(false);
  const calls = [];
  f.context.syncService = { sync: async () => { calls.push('next account'); return { phase: 'idle' }; }, status: { nextAttemptAt: 0 } };
  await f.invoke(false);
  assert.deepEqual(calls, ['next account']);
});

test('manual sync requests native system unlock then continues the same account sync', async () => {
  const f = syncFixture();
  await f.invoke(true);
  assert.deepEqual(f.calls, ['google.unlockVault', 'flush', ['sync', true]]);
  assert.equal(f.context.googleAccount.accountId, 'fixture');
  assert.equal(f.nodes.get('#storage-note').textContent, t('sync.storage.google'));
  assert.equal(f.states.at(-1)[0], 'ok');
  assert.equal(f.context.syncBusy, false);
  assert.equal(f.nodes.get('#google-sync').disabled, false);
});

test('background sync never requests unlock even when the vault is locked', async () => {
  const f = syncFixture({ sync: () => { throw Object.assign(new Error('Keyring locked'), { code: 'vault-locked' }); } });
  await f.invoke(false);
  assert.deepEqual(f.calls, ['flush', ['sync', false]]);
  assert.equal(textOf(f.states.at(-1)[1]), t('sync.status.paused'));
});

test('quiet empty results retain the displayed completion time and skip draft/projection work', async () => {
  for (const force of [false, true]) {
    const f = syncFixture({ capability: false }); f.context.googleAccount.paused = false;
    f.context.syncService.sync = async () => ({ phase: 'idle', unchanged: true });
    f.context.controller.reconcile = () => assert.fail('An empty result must not rebuild the projection');
    f.context.render = () => assert.fail('An empty result must not redraw notes');
    await f.invoke(force);
    assert.deepEqual(f.calls, []);
    assert.equal(f.states.some(state => state[0] === 'busy'), force);
    assert.equal(textOf(f.states.at(-1)[1]), t('sync.status.syncedAt', {
      time: formatDate(f.context.workspace.syncState.lastSuccessfulSyncAt, { hour: '2-digit', minute: '2-digit' }),
    }));
  }
});

test('new work during a quiet check gets one immediate follow-up; pending uploads show activity', async () => {
  const f = syncFixture({ capability: false }); f.context.googleAccount.paused = false;
  let release, count = 0; const queued = [];
  f.context.queueMicrotask = callback => queued.push(callback);
  f.context.syncService.sync = async options => {
    if (++count === 1) { await new Promise(resolve => { release = resolve; }); return { phase: 'idle', unchanged: true }; }
    await options.onActivity(); f.context.workspace.pendingCount = 0; return { phase: 'idle' };
  };
  const checking = f.invoke(false);
  assert.equal(f.states.some(state => state[0] === 'busy'), false);
  f.context.workspace.pendingCount = 1; release(); await checking;
  assert.equal(f.states.at(-1)[0], 'pending'); assert.equal(queued.length, 1);
  queued[0](); assert.equal(f.states.at(-1)[0], 'busy');
  await new Promise(setImmediate);
  assert.equal(count, 2); assert.equal(f.states.at(-1)[0], 'ok'); assert.equal(queued.length, 1);
});

// ADR-064: DesktopOwner.perform runs one action at a time; this stands in for it and records what ran inside a turn.
function desktopQueue(f) {
  const queue = { turns: 0, depth: 0, ran: [], tail: Promise.resolve() };
  queue.perform = action => {
    const next = queue.tail.then(async () => {
      queue.turns++; queue.depth++;
      try { return await action(); } finally { queue.depth--; }
    });
    queue.tail = next.catch(() => {}); return next;
  };
  f.context.desktop = { perform: queue.perform };
  const record = (name, value) => (...args) => { queue.ran.push([name, queue.depth > 0]); return value?.(...args); };
  f.context.flushDraft = record('flush');
  f.context.controller.reconcile = record('reconcile');
  f.context.workspace.layout.placeNew = record('place');
  f.context.render = record('render');
  return queue;
}

test('on a desktop host the Drive pass runs outside the action queue; its flush and landing run inside', async () => {
  const f = syncFixture({ capability: false }); f.context.googleAccount.paused = false; const queue = desktopQueue(f);
  let held; const answered = new Promise(resolve => { held = resolve; });
  f.context.syncService.sync = async options => {
    assert.equal(queue.depth, 0, 'the pass must start outside the queue');
    await options.onActivity();
    assert.equal(queue.depth, 0, 'the flush must end its turn before Drive is asked anything');
    await answered;
    assert.equal(queue.depth, 0, 'waiting for Drive must not hold the queue');
    const received = await options.land(async () => { queue.ran.push(['receive', queue.depth > 0]); return 'received'; });
    assert.equal(received, 'received');
    return { phase: 'idle' };
  };
  const passing = f.invoke(false);
  await new Promise(setImmediate);
  let actionRan = false; await queue.perform(() => { actionRan = true; });
  assert.equal(actionRan, true, 'an action runs while Drive has not answered');
  held(); await passing;
  assert.deepEqual(queue.ran, [['flush', true], ['receive', true], ['reconcile', true], ['place', true], ['render', true]]);
  assert.equal(queue.turns, 3, 'flush, the action and the landing each take one turn');
  assert.equal(f.states.at(-1)[0], 'ok');
});

test('a landing depends on nothing after it, so a pass failing later still leaves its landing applied and shown', async () => {
  const f = syncFixture({ capability: false }); f.context.googleAccount.paused = false; const queue = desktopQueue(f);
  f.context.syncService.sync = async options => {
    await options.land(async () => { queue.ran.push(['receive', queue.depth > 0]); });
    throw Object.assign(new Error('Upload failed'), { code: 'network' });
  };
  await f.invoke(false);
  assert.deepEqual(queue.ran.map(([name]) => name), ['receive', 'reconcile', 'place', 'render']);
  assert.equal(f.states.at(-1)[0], 'error');
});

test('a pass landing as the app closes or changes account changes nothing on the screen', async () => {
  for (const flag of ['nativeClosing', 'accountBusy']) {
    const f = syncFixture({ capability: false }); f.context.googleAccount.paused = false; const queue = desktopQueue(f);
    f.context.syncService.sync = async options => {
      f.context[flag] = true;
      await options.land(async () => { queue.ran.push(['receive', true]); });
      return { phase: 'idle' };
    };
    await f.invoke(false);
    assert.deepEqual(queue.ran, [['receive', true]]);
  }
});

test('a flush whose turn comes after the account changed or the app began closing does not run', async () => {
  for (const flag of ['nativeClosing', 'accountBusy']) {
    const f = syncFixture({ capability: false }); f.context.googleAccount.paused = false; const queue = desktopQueue(f);
    let open; const holding = queue.perform(() => new Promise(resolve => { open = resolve; }));
    f.context.syncService.sync = async options => { const flushed = options.onActivity(); f.context[flag] = true; open(); await flushed; return { phase: 'idle' }; };
    await new Promise(setImmediate); await f.invoke(false); await holding;
    assert.deepEqual(queue.ran, []);
  }
});

test('a failure to show what landed is reported and leaves the pass going, so uploads still run', async () => {
  const f = syncFixture({ capability: false }); f.context.googleAccount.paused = false; const queue = desktopQueue(f);
  const shown = []; f.context.status = (text, error) => shown.push([text, error]);
  f.context.controller.reconcile = async () => { throw new Error('Reconcile failed'); };
  let continued = false;
  let invalidated = 0; f.context.syncService.invalidateIdle = () => { invalidated++; };
  f.context.syncService.sync = async options => {
    assert.equal(await options.land(async () => 'received'), 'received');
    continued = true; return { phase: 'idle' };
  };
  await f.invoke(false);
  assert.equal(continued, true); assert.deepEqual(shown, [['Reconcile failed', true]]);
  assert.equal(f.states.at(-1)[0], 'ok'); assert.equal(queue.depth, 0);
  assert.deepEqual(queue.ran, [['render', true]], 'what did land is drawn anyway');
  assert.equal(invalidated, 1, 'a quiet check lands nothing, so the next pass must take the full path to retry');
  f.context.syncService.sync = async () => ({ phase: 'idle', unchanged: true });
  await f.invoke(false);
  assert.equal(invalidated, 1, 'the retry is asked for once per failure');
});

// Nothing holding the queue may wait for a pass, because the pass waits for the queue to land.
const exportSource = source.slice(source.indexOf('function backupSourceOptions()'), source.indexOf('async function applyLocalRestore('));
const prepareSource = source.slice(source.indexOf('function cloudRestoreOptions()'), source.indexOf('function backupSourceOptions()'));
const flushSource = source.slice(source.indexOf('async function flushForBackup('), source.indexOf('function resetFailure('));
function dataFixture() {
  const calls = []; const queue = { depth: 0 };
  const perform = async action => { queue.depth++; try { return await action(); } finally { queue.depth--; } };
  const service = { whenIdle: async () => { calls.push(['whenIdle', queue.depth]); }, syncWaiting: async options => { calls.push(['sync', queue.depth, options.force, options.land === context.landSync]); return { phase: 'idle' }; } };
  const context = vm.createContext({ profileId: 'google:fixture', googleAccount: { connected: true, email: 'synthetic@example.test' }, native: {}, t, datasetProblem: null,
    syncService: service, workspace: { state: {} }, primary: { state: {} }, storage: {}, nativeClosing: false, accountBusy: false, maintenanceWork: null,
    syncBusy: false, $: () => ({}), setSync() {}, desktop: { perform }, landSync: receive => receive(), requireConnected() {}, datasetStore: {},
    prepareDatasetRestore: async () => 'plan', flushDraft: async () => { calls.push(['flush', queue.depth]); } });
  vm.runInContext(`${exportSource}\n${prepareSource}\n${flushSource}`, context);
  return { calls, context };
}

test('an export waits for a running pass outside the queue, then runs its own pass through the landing', async () => {
  const f = dataFixture();
  await vm.runInContext('backupSourceOptions()', f.context).sync();
  assert.deepEqual(f.calls, [['whenIdle', 0], ['sync', 0, true, true]]);
  assert.equal(f.context.syncBusy, false);
});

test('preparing a cloud restore runs its pass outside the queue and lands through it', async () => {
  const f = dataFixture();
  assert.equal(await vm.runInContext('cloudRestoreOptions()', f.context).prepare({}), 'plan');
  assert.deepEqual(f.calls, [['sync', 0, true, true]]);
});

test('an automatic backup waits for a running pass outside the queue before its flush, whose commits would void its snapshot', async () => {
  const f = dataFixture();
  await vm.runInContext('flushForBackup()', f.context);
  assert.deepEqual(f.calls, [['whenIdle', 0], ['flush', 1]]);
  f.context.syncService = null; f.calls.length = 0;
  await vm.runInContext('flushForBackup()', f.context);
  assert.deepEqual(f.calls, [['flush', 1]], 'a workspace without a sync service flushes at once');
});

const runner = source.slice(source.indexOf('async function run(action'), source.indexOf('function primaryArea('));
function runFixture({ syncBusy = false, pendingBefore = 0, action }) {
  let started = 0;
  const context = vm.createContext({ nativeClosing: false, sharedIdsBlocked: false, syncBusy, maintenanceWork: null, syncRequested: false, activeActions: new Set(), desktop: null,
    workspace: { pendingCount: pendingBefore }, adjustOverlayActive: () => false, status() {}, currentDraft: null, syncGoogle: () => { started++; } });
  vm.runInContext(runner, context);
  return { context, started: () => started, invoke: () => context.run(() => action(context)) };
}

test('a save during a running pass asks for one more pass after it', async () => {
  const f = runFixture({ syncBusy: true, pendingBefore: 1, action: context => { context.workspace.pendingCount = 2; } });
  await f.invoke();
  assert.equal(f.context.syncRequested, true); assert.equal(f.started(), 0);
});

test('an action that saves nothing during a pass costs no extra Drive request', async () => {
  const f = runFixture({ syncBusy: true, pendingBefore: 1, action: () => {} });
  await f.invoke();
  assert.equal(f.context.syncRequested, false); assert.equal(f.started(), 0);
});

test('with no pass running, only an action that adds an upload starts one', async () => {
  const quiet = runFixture({ pendingBefore: 2, action: () => {} });
  await quiet.invoke(); assert.equal(quiet.started(), 0);
  const saved = runFixture({ pendingBefore: 2, action: context => { context.workspace.pendingCount = 3; } });
  await saved.invoke(); assert.equal(saved.started(), 1);
});

test('an open versions page holds syncing, because its choices name the versions it shows', async () => {
  const f = syncFixture(); f.context.revisions = { busy: () => false };
  await f.invoke(false); await f.invoke(true);
  assert.deepEqual(f.calls, []);
  assert.equal(f.context.syncBusy, false);
});

test('cancelled or timed-out unlock keeps notes paused and a later click can retry', async () => {
  for (const code of ['vault-unlock-cancelled', 'vault-unlock-timeout']) {
    let cancel = true;
    const f = syncFixture({ unlock: () => {
      if (cancel) throw Object.assign(new Error('Unlock not finished'), { code });
      return { configured: true, connected: true, accountId: 'fixture', paused: false };
    } });
    await f.invoke(true);
    assert.deepEqual(f.calls, ['google.unlockVault']);
    assert.equal(textOf(f.states.at(-1)[1]), t('sync.status.paused'));
    assert.equal(f.context.syncBusy, false);
    assert.equal(f.nodes.get('#google-sync').disabled, false);
    assert.equal(f.nodes.get('#google-sync').disabled, false);
    cancel = false;
    await f.invoke(true);
    assert.deepEqual(f.calls, ['google.unlockVault', 'google.unlockVault', 'flush', ['sync', true]]);
    assert.equal(f.states.at(-1)[0], 'ok');
  }
});

test('hosts without unlock capability sync manually without a new bridge method', async () => {
  const f = syncFixture({ capability: false });
  f.context.googleAccount.paused = false;
  await f.invoke(true);
  assert.deepEqual(f.calls, ['flush', ['sync', true]]);
});

test('repeated clicks during the system prompt produce one request and no concurrent sync', async () => {
  let resolve;
  const f = syncFixture({ unlock: () => new Promise(done => { resolve = done; }) });
  const first = f.invoke(true);
  await f.invoke(true);
  assert.deepEqual(f.calls, ['google.unlockVault']);
  resolve({ configured: true, connected: true, accountId: 'fixture', paused: false });
  await first;
  assert.deepEqual(f.calls, ['google.unlockVault', 'flush', ['sync', true]]);
});

test('account switch, local mode and sign-out discard the old unlock response before saving or syncing', async () => {
  for (const action of ['switch', 'local', 'signOut']) {
    let resolve;
    const f = syncFixture({ unlock: () => new Promise(done => { resolve = done; }) });
    const first = f.invoke(true);
    f.context.accountBusy = true;
    f.context.syncService = null;
    f.context.profileId = action === 'switch' ? 'google:other' : 'local';
    const nextAccount = { accountId: action === 'switch' ? 'other' : null };
    f.context.googleAccount = nextAccount;
    resolve({ connected: true, accountId: 'fixture' });
    await first;
    assert.deepEqual(f.calls, ['google.unlockVault']);
    assert.equal(f.context.googleAccount, nextAccount);
    assert.equal(f.context.syncBusy, false);
    assert.equal(f.states.some(state => textOf(state[1]) === t('sync.status.failed')), false);
  }
});

test('closing the host or cancelling an old account prompt does not overwrite the next account UI', async () => {
  for (const closing of [true, false]) {
    let reject;
    const f = syncFixture({ unlock: () => new Promise((_resolve, fail) => { reject = fail; }) });
    const first = f.invoke(true);
    f.context.nativeClosing = closing;
    f.context.accountBusy = !closing;
    const nextAccount = { accountId: 'other', connected: true };
    f.context.googleAccount = nextAccount;
    reject(Object.assign(new Error('Old request cancelled'), { code: 'vault-unlock-cancelled' }));
    await first;
    assert.deepEqual(f.calls, ['google.unlockVault']);
    assert.equal(f.context.googleAccount, nextAccount);
    assert.equal(f.context.syncBusy, false);
    assert.equal(f.nodes.get('#google-sync').disabled, false);
    assert.equal(f.states.length, 2);
  }
});

test('cancelled account change or close leaves an immediately usable manual-sync button', async () => {
  for (const action of ['signOut', 'close']) {
    let reject;
    const f = syncFixture({ unlock: () => new Promise((_resolve, fail) => { reject = fail; }) });
    const first = f.invoke(true);
    if (action === 'signOut') {
      const oldSync = f.context.syncService;
      oldSync.stop = async () => {}; oldSync.whenIdle = async () => {};
      Object.assign(f.context, { syncTimer: null, clearInterval() {}, stopAutomatic: null, automatic: null,
        status() {}, initializeGoogle: async () => { f.context.syncService = oldSync; } });
      f.context.document.body = {};
      f.context.native.bridge.request = async method => {
        assert.equal(method, 'google.signOut');
        reject(Object.assign(new Error('Request cancelled'), { code: 'vault-unlock-cancelled' }));
        throw new Error('Account switch cancelled');
      };
      await vm.runInContext(`${changeAccount}\nchangeGoogleAccount('signOut')`, f.context);
      assert.equal(f.context.accountBusy, false);
      assert.equal(f.context.document.body.inert, false);
    } else {
      f.context.nativeClosing = true;
      reject(Object.assign(new Error('Request cancelled'), { code: 'vault-unlock-cancelled' }));
    }
    await first;
    assert.equal(f.nodes.get('#google-sync').disabled, false);
    f.context.nativeClosing = false;
    f.context.native.bridge.request = async method => {
      assert.equal(method, 'google.unlockVault');
      return { connected: true, accountId: 'fixture', paused: false };
    };
    await f.invoke(true);
    assert.deepEqual(f.calls.slice(-2), ['flush', ['sync', true]]);
    assert.equal(f.states.at(-1)[0], 'ok');
  }
});

test('cancelled Google sign-in preserves the workspace and restores editing, sync and backups', async () => {
  for (const code of ['google-cancelled', 'google-config']) {
    const f = syncFixture({ capability: false });
    f.context.googleAccount = { ...f.context.googleAccount, connected: true, paused: false };
    const calls = [], notices = [];
    const oldSync = f.context.syncService;
    oldSync.stop = async () => calls.push('stop-sync'); oldSync.whenIdle = async () => {};
    const workspace = f.context.workspace;
    Object.assign(f.context, {
      syncTimer: null, clearInterval() {}, stopAutomatic: () => calls.push('stop-backups'),
      automatic: { service: { whenIdle: async () => calls.push('backups-idle') } },
      startAutomaticBackup: () => { calls.push('restart-backups'); return () => {}; },
      status: (...args) => notices.push(args),
      initializeGoogle: async () => { calls.push('restore-sync'); f.context.syncService = oldSync; },
    });
    f.context.document.body = {};
    f.context.native.bridge.request = async method => {
      calls.push(method);
      throw Object.assign(new Error('Sign-in not finished'), { code });
    };
    await vm.runInContext(`${changeAccount}\nchangeGoogleAccount('signIn')`, f.context);
    assert.deepEqual(calls, ['stop-backups', 'backups-idle', 'stop-sync', 'google.signIn', 'restart-backups', 'restore-sync']);
    assert.equal(f.context.profileId, 'google:fixture');
    assert.equal(f.context.workspace, workspace);
    assert.equal(f.context.document.body.inert, false);
    assert.equal(f.context.accountBusy, false);
    assert.equal(notices.at(-1)[1], code !== 'google-cancelled');
    await f.invoke(true);
    assert.equal(f.states.at(-1)[0], 'ok');
  }
});
