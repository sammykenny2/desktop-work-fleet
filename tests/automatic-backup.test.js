import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { copy, FleetError } from '../src/core/contracts.js';
import { sha256 } from '../src/sources/files.js';
import { AutomaticBackup } from '../src/backup/automatic.js';
import { openBackup } from '../src/backup/payload.js';
import { encryptBackup } from '../src/backup/encryption.js';
import { startAutomaticBackup } from '../src/backup/lifecycle.js';

const DAY = 86400000;
const text = value => ({ format: 'markdown', text: value, attachments: [] });
const policy = { destinationId: 'chosen-directory', destinationName: 'Test backups', encrypted: false, keep: 2 };
const fails = code => error => error.code === code;

test('an explicit workspace reset forgets automatic settings and ownership without deleting saved archives', async () => {
  const f = await fixture(); await f.service.load(); await f.service.configure(policy); await f.service.run({ force: true });
  const files = [...f.entries.keys()]; assert.equal(files.length, 1);
  await f.service.clearSettings();
  assert.equal(f.service.state.enabled, false); assert.equal(f.service.state.settings, null);
  assert.deepEqual(f.service.state.inventory, []); assert.deepEqual([...f.entries.keys()], files);
  assert.deepEqual(f.removals, []); assert.equal((await f.service.run({ force: true })).kind, 'disabled');
});
async function fixture(options = {}) {
  let content; let disk = null; let now = 1800000000000; let fault; let flush = async () => {};
  const entries = new Map(); const creates = []; const removals = [];
  const workspace = await Workspace.create({ profileId: crypto.randomUUID(), deviceId: crypto.randomUUID(),
    area: { x: 0, y: 0, width: 1200, height: 800 }, persist: async state => { content = copy(state); } });
  await workspace.createCard(text('saved note'));
  const key = job => `${job.profileId}/${job.destinationId}/${job.name}`;
  const inject = (stage, value) => { if (fault?.stage === stage && (!fault.when || fault.when(value))) { fault = null; throw new Error(`injected ${stage}`); } };
  const journal = {
    load: async profileId => { assert.equal(profileId, workspace.state.profileId); return copy(disk); },
    save: async (state, revision) => {
      assert.equal(disk?.revision ?? null, revision); inject('journal-before', state); disk = copy(state); inject('journal-after', state);
    },
  };
  const files = {
    canCreate: true,
    canPrune: true,
    read: async job => { assert.equal(job.profileId, workspace.state.profileId); return entries.get(key(job))?.slice() ?? null; },
    create: async job => {
      assert.equal(disk.pending.id, job.id, 'job must be durable before file publication');
      assert.equal(job.profileId, workspace.state.profileId); assert.equal(entries.has(key(job)), false, 'never overwrite');
      inject('create-before', job); entries.set(key(job), job.bytes.slice()); creates.push(copy({ ...job, bytes: undefined, signal: undefined }));
      inject('create-after', job); return { saved: true, receipt: crypto.randomUUID() };
    },
    remove: async job => {
      assert.notEqual(disk.lastSuccess.id, job.id, 'new verified backup must already be durable');
      const bytes = entries.get(key(job));
      if (bytes) assert.equal(await sha256(bytes), job.sha256, 'only unchanged owned files may be removed');
      entries.delete(key(job)); removals.push(job.id); inject('remove-after', job); return { removed: true };
    },
  };
  const storage = { getAttachment: async () => null };
  const make = () => new AutomaticBackup({ workspace, storage, journal, files, now: () => now,
    flush: () => flush(), ...options });
  const service = make();
  return { service, make, workspace, entries, creates, removals, files, journal, key,
    disk: () => copy(disk), content: () => copy(content), advance: value => { now += value; },
    fault: (stage, when) => { fault = { stage, when }; }, flush: action => { flush = action; },
    corruptJournal: action => { action(disk); } };
}

test('automatic backup is opt-in, coalesces concurrent triggers, preserves Workspace and saves a complete portable file', async () => {
  const f = await fixture(); const before = f.content();
  assert.equal((await f.service.run()).kind, 'disabled'); assert.equal(f.disk(), null);
  await f.service.configure(policy); const a = f.service.run(); const b = f.service.run(); assert.equal(a, b);
  assert.equal((await a).kind, 'saved'); assert.equal(f.creates.length, 1);
  const job = f.disk().lastSuccess; const document = await openBackup(f.entries.get(f.key({ ...job, profileId: before.profileId })));
  assert.deepEqual(document.data.records, before.revisions); assert.deepEqual(f.content(), before);
  assert.equal(f.disk().pending, null); assert.equal(f.disk().inventory[0].status, 'verified');
});

test('daily scheduling requires changes, catches up once after sleep and ignores journal-only mutations', async () => {
  const f = await fixture(); await f.service.configure(policy); await f.service.run();
  await f.workspace.createCard(text('later change')); f.advance(DAY / 2);
  assert.equal((await f.service.run()).kind, 'not-due'); f.advance(DAY * 10);
  assert.equal((await f.service.run()).kind, 'saved'); assert.equal(f.creates.length, 2);
  f.advance(DAY * 10); assert.equal((await f.service.run()).kind, 'not-due'); assert.equal(f.creates.length, 2);
});

test('reservation failure writes no file, while a lost journal acknowledgement is reconciled by exact durable readback', async () => {
  const f = await fixture(); await f.service.configure(policy);
  f.fault('journal-before', state => state.pending !== null);
  await assert.rejects(f.service.run(), /journal-before/); assert.equal(f.creates.length, 0); assert.equal(f.disk().pending, null);
  assert.equal((await f.service.run()).kind, 'backoff');
  f.fault('journal-after', state => state.pending !== null);
  assert.equal((await f.service.run({ force: true })).kind, 'saved'); assert.equal(f.creates.length, 1);
  f.fault('journal-after', state => state.pending === null && state.inventory.length === 2);
  assert.equal((await f.service.run({ force: true })).kind, 'saved'); assert.equal(f.disk().inventory.length, 2);
});

test('file-save response loss recovers the same durable job after reopening without another output or password', async () => {
  const f = await fixture(); await f.service.configure(policy); f.fault('create-after');
  await assert.rejects(f.service.run(), /create-after/); const pending = f.disk().pending;
  assert.equal(f.creates.length, 1); assert.equal(f.disk().inventory.length, 0);
  const restarted = f.make(); assert.equal((await restarted.run({ force: true })).kind, 'recovered');
  assert.equal(f.creates.length, 1); assert.equal(f.disk().lastSuccess.id, pending.id); assert.equal(f.disk().pending, null);
});

test('incomplete pending files remain untouched and get an unconfirmed inventory entry before a new unique output', async () => {
  const f = await fixture(); await f.service.configure(policy); f.fault('create-after');
  await assert.rejects(f.service.run(), /create-after/); const job = f.disk().pending; const jobKey = f.key({ ...job, profileId: f.workspace.state.profileId });
  f.entries.set(jobKey, new Uint8Array([1, 2, 3]));
  assert.equal((await f.make().run({ force: true })).kind, 'saved');
  assert.deepEqual(f.entries.get(jobKey), new Uint8Array([1, 2, 3]));
  assert.equal(f.disk().inventory.find(item => item.id === job.id).status, 'unconfirmed'); assert.equal(f.removals.length, 0);
});

test('retention only removes verified files from the active schedule after new success; switching destination retains old files', async () => {
  const f = await fixture(); await f.service.configure(policy);
  f.entries.set('unrelated-manual-backup.zip', new Uint8Array([99]));
  for (let i = 0; i < 4; i++) { await f.service.run({ force: true }); f.advance(DAY); }
  assert.equal(f.disk().inventory.length, 2); assert.equal(f.removals.length, 2);
  assert.deepEqual(f.entries.get('unrelated-manual-backup.zip'), new Uint8Array([99]));
  const old = f.disk().inventory.map(item => item.id);
  await f.service.configure({ ...policy, destinationId: 'new-location', keep: 1 });
  await f.service.run(); await f.service.run({ force: true });
  assert.ok(old.every(id => f.disk().inventory.some(item => item.id === id)));
  assert.equal(f.disk().inventory.length, 3); assert.equal(f.removals.length, 3);
});

test('save failure does not prune old backups, and a lost delete acknowledgement resumes without an additional backup', async () => {
  const f = await fixture(); await f.service.configure({ ...policy, keep: 1 }); await f.service.run();
  const first = f.disk().lastSuccess; f.fault('create-before');
  await assert.rejects(f.service.run({ force: true }), /create-before/); assert.equal(f.removals.length, 0);
  assert.ok(f.entries.has(f.key({ ...first, profileId: f.workspace.state.profileId })));
  f.fault('remove-after'); await assert.rejects(f.service.run({ force: true }), /remove-after/);
  assert.equal(f.disk().inventory.length, 2); const count = f.creates.length; f.advance(60000);
  assert.equal((await f.make().run()).kind, 'not-due'); assert.equal(f.disk().inventory.length, 1); assert.equal(f.creates.length, count);
});

test('retention rechecks the newest file before removing old ones and replaces a missing newest backup on retry', async () => {
  const f = await fixture(); await f.service.configure({ ...policy, keep: 1 }); await f.service.run();
  const oldest = f.disk().lastSuccess; const remove = f.files.remove;
  f.files.remove = async () => { throw new Error('temporarily cannot delete'); };
  await assert.rejects(f.service.run({ force: true }), /cannot delete/); f.files.remove = remove;
  const newest = f.disk().lastSuccess; f.entries.delete(f.key({ ...newest, profileId: f.workspace.state.profileId }));
  f.advance(60000); await assert.rejects(f.service.run(), fails('backup-latest-missing'));
  assert.ok(f.entries.has(f.key({ ...oldest, profileId: f.workspace.state.profileId })), 'older valid file survives');
  f.advance(120000); assert.equal((await f.service.run()).kind, 'saved');
  assert.equal(f.disk().inventory.length, 1); assert.notEqual(f.disk().lastSuccess.id, newest.id);
});

test('encrypted schedules require an available vault, pause on missing keys and never fall back to plaintext', async () => {
  const unavailable = await fixture();
  await assert.rejects(unavailable.service.configure({ ...policy, encrypted: true, keyId: 'key' }), fails('backup-vault-unavailable'));
  assert.equal(unavailable.disk(), null);
  let password; const f = await fixture({ vault: { available: true, encrypt: async ({ profileId, keyId, bytes, signal }) => {
    assert.equal(profileId, f.workspace.state.profileId); assert.equal(keyId, 'os-key-reference');
    if (!password) throw new FleetError('backup-key-unavailable', 'Key missing');
    return encryptBackup(bytes, password, { signal });
  } } });
  await f.service.configure({ ...policy, encrypted: true, keyId: 'os-key-reference' });
  await assert.rejects(f.service.run(), fails('backup-key-unavailable')); assert.equal(f.creates.length, 0);
  f.advance(DAY); assert.equal((await f.service.run()).kind, 'paused');
  password = 'vault only password 中文'; await f.service.run({ force: true });
  assert.equal(f.disk().lastSuccess.encrypted, true); assert.equal(JSON.stringify(f.disk()).includes(password), false);
  const bytes = f.entries.get(f.key({ ...f.disk().lastSuccess, profileId: f.workspace.state.profileId }));
  await assert.rejects(openBackup(bytes), fails('backup-password')); assert.equal((await openBackup(bytes, { password })).manifest.counts.cards, 1);
});

test('permission loss pauses until explicit retry, and disable cancels preparation then leaves the queue usable', async () => {
  const f = await fixture(); await f.service.configure(policy);
  const create = f.files.create; f.files.create = async () => { throw new FleetError('backup-permission', 'permission missing'); };
  await assert.rejects(f.service.run(), fails('backup-permission')); assert.equal((await f.service.run()).kind, 'paused');
  f.files.create = create;
  let release; let entered; const gate = new Promise(resolve => { release = resolve; }); const ready = new Promise(resolve => { entered = resolve; });
  f.flush(async () => { entered(); await gate; });
  const work = f.service.run({ force: true }); const rejected = assert.rejects(work, fails('backup-cancelled'));
  await ready; const disabled = f.service.disable(); release(); await rejected; await disabled;
  assert.equal(f.disk().enabled, false); assert.equal(f.creates.length, 0); assert.equal((await f.service.run({ force: true })).kind, 'disabled');
});

test('a broken encryptor returning plaintext is rejected before file reservation or publication', async () => {
  const f = await fixture({ vault: { available: true, encrypt: async ({ bytes }) => bytes.slice() } });
  await f.service.configure({ ...policy, encrypted: true, keyId: 'opaque-key' });
  await assert.rejects(f.service.run(), fails('unsupported-backup-encryption'));
  assert.equal(f.creates.length, 0); assert.equal(f.disk().pending, null); assert.equal(f.disk().lastSuccess, null);
});

test('pending files with missing ownership or changed identity stay unconfirmed while a fresh job is saved', async () => {
  for (const code of ['backup-file-unowned', 'backup-file-changed']) {
    const f = await fixture(); await f.service.configure(policy); f.fault('create-after');
    await assert.rejects(f.service.run(), /create-after/); const pending = f.disk().pending;
    const read = f.files.read; f.files.read = job => job.id === pending.id ? Promise.reject(new FleetError(code, 'changed')) : read(job);
    assert.equal((await f.make().run({ force: true })).kind, 'saved');
    assert.equal(f.disk().inventory.find(item => item.id === pending.id).status, 'unconfirmed'); assert.equal(f.removals.length, 0);
  }
});

test('vault protection loss and replaced directories pause scheduling until explicit retry', async () => {
  for (const code of ['backup-vault-unavailable', 'backup-directory-changed']) {
    const f = await fixture(); await f.service.configure(policy);
    f.files.create = async () => { throw new FleetError(code, 'explicit attention required'); };
    await assert.rejects(f.service.run(), fails(code)); f.advance(DAY);
    assert.equal((await f.make().run()).kind, 'paused'); assert.equal(f.creates.length, 0);
  }
});

test('malformed or cross-profile journal records stop before file access; queued settings own their input', async () => {
  const f = await fixture(); const mutable = { ...policy }; const operation = f.service.configure(mutable); mutable.keep = 0;
  await operation; assert.equal(f.disk().settings.keep, 2);
  await f.service.run(); f.corruptJournal(state => { state.inventory[0].name = '../foreign-file'; });
  const reopened = f.make(); const updates = []; reopened.subscribe(value => updates.push(value));
  await assert.rejects(reopened.run({ force: true }), fails('invalid-backup-journal')); assert.equal(f.creates.length, 1); assert.equal(f.removals.length, 0);
  assert.equal(reopened.status.error.code, 'invalid-backup-journal'); assert.equal(reopened.status.paused, true);
  assert.ok(updates.some(value => value.error?.code === 'invalid-backup-journal'));
  f.corruptJournal(state => { state.profileId = 'another-account'; });
  await assert.rejects(f.make().load(), fails('invalid-backup-journal'));
});

test('cancel and disable apply before a queued run starts, without creating any file', async () => {
  for (const disable of [false, true]) {
    const f = await fixture(); await f.service.configure(policy);
    const work = f.service.run(); const rejected = assert.rejects(work, fails('backup-cancelled'));
    const stopping = disable ? f.service.disable() : f.service.cancel(); await rejected; await stopping;
    assert.equal(f.creates.length, 0); assert.equal(f.disk().pending, null);
    if (disable) assert.equal(f.disk().enabled, false);
  }
});

test('changing encryption or key policy survives restart and requires a new backup even without content changes', async () => {
  const f = await fixture({ vault: { available: true, encrypt: ({ bytes }) => encryptBackup(bytes, 'a durable secret password') } });
  await f.service.configure(policy); await f.service.run(); const first = f.disk().lastSuccess;
  await f.service.configure({ ...policy, encrypted: true, keyId: 'key-one' });
  assert.equal((await f.make().run()).kind, 'saved'); const encrypted = f.disk().lastSuccess;
  assert.equal(encrypted.encrypted, true); assert.notEqual(encrypted.policyId, first.policyId);
  await f.service.configure({ ...policy, encrypted: true, keyId: 'key-two' });
  assert.equal((await f.make().run()).kind, 'saved'); assert.notEqual(f.disk().lastSuccess.policyId, encrypted.policyId);
});

test('a host without atomic owned-file deletion retains every file and exposes retention as unavailable', async () => {
  const f = await fixture(); f.files.canPrune = false; f.files.remove = async () => { throw new Error('must not call unsupported deletion'); };
  await f.service.configure({ ...policy, keep: 1 });
  for (let i = 0; i < 3; i++) await f.service.run({ force: true });
  assert.equal(f.disk().inventory.length, 3); assert.equal(f.service.status.canPrune, false); assert.equal(f.entries.size, 3);
});

test('missing create-new capability rejects configuration without a journal or file write', async () => {
  const f = await fixture(); f.files.canCreate = false;
  await assert.rejects(f.service.configure(policy), fails('backup-create-unavailable'));
  assert.equal(f.disk(), null); assert.equal(f.entries.size, 0); assert.equal(f.service.status.canCreate, false);
});

test('journal outage after file publication reports transient paused state and later recovers the same job', async () => {
  const f = await fixture(); await f.service.configure(policy);
  const load = f.journal.load; const save = f.journal.save; const create = f.files.create;
  f.files.create = async job => {
    const result = await create(job);
    f.journal.load = async () => { throw new Error('journal disconnected'); };
    f.journal.save = async () => { throw new Error('journal disconnected'); };
    return result;
  };
  const updates = []; f.service.subscribe(value => updates.push(value));
  await assert.rejects(f.service.run(), /journal disconnected/);
  assert.equal(f.service.status.paused, true); assert.match(f.service.status.error.message, /journal disconnected/);
  assert.ok(updates.some(value => value.paused && value.error)); assert.ok(f.disk().pending);
  f.journal.load = load; f.journal.save = save; f.files.create = create;
  assert.equal((await f.service.run({ force: true })).kind, 'recovered'); assert.equal(f.creates.length, 1);
});

test('lifecycle checks on startup and visible resume, suppresses hidden work and removes callbacks on stop', async () => {
  const events = new EventTarget(); const document = new EventTarget(); document.visibilityState = 'visible';
  let calls = 0; let cancellations = 0;
  const service = { run: async () => { calls++; throw new Error('reported through service status'); }, cancel: () => { cancellations++; } };
  const stop = startAutomaticBackup(service, { events, document });
  try {
    assert.equal(calls, 1); document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
    events.dispatchEvent(new Event('focus')); assert.equal(calls, 1);
    document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
    events.dispatchEvent(new Event('pageshow')); assert.equal(calls, 3); await Promise.resolve();
  } finally { stop(); }
  assert.equal(cancellations, 1); events.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 3);
});
