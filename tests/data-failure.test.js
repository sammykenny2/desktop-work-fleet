import test from 'node:test';
import assert from 'node:assert/strict';
import { canSetAside, causeKey, loadFailureCause, workspaceFailureCause } from '../src/app/data-failure.js';
import { FleetError } from '../src/core/contracts.js';
import { catalogs } from '../src/i18n/catalogs.js';

const causes = ['data-damaged', 'data-full', 'data-in-use', 'data-denied', 'data-key', 'data-unreadable'];

test('a failed load names a data cause, and other failures keep their own message', () => {
  for (const cause of causes) assert.equal(loadFailureCause(new FleetError(cause, 'host')), cause);
  assert.equal(loadFailureCause(new FleetError('vault-unavailable', 'DPAPI')), 'data-key');
  assert.equal(loadFailureCause(new FleetError('storage-integrity', 'AES-GCM')), 'data-key');
  let syntax; try { JSON.parse('{not json'); } catch (error) { syntax = error; }
  assert.equal(loadFailureCause(syntax), 'data-damaged');
  for (const code of ['native-closed', 'native-timeout', 'message-size', 'invalid-request']) assert.equal(loadFailureCause(new FleetError(code, 'bridge')), null);
  assert.equal(loadFailureCause(undefined), null);
});

test('a refused record is damaged unless a newer version wrote it, and a fault in this version is no data failure', () => {
  const schema = new FleetError('unsupported-schema', 'not this version');
  assert.equal(workspaceFailureCause(schema, { schemaVersion: 2 }), null, 'a newer version keeps its own message');
  for (const saved of [{ foo: 1 }, { schemaVersion: '1' }, { schemaVersion: 0 }, null]) assert.equal(workspaceFailureCause(schema, saved), 'data-damaged');
  assert.equal(workspaceFailureCause(new FleetError('invalid-workspace', 'broken'), { schemaVersion: 1 }), 'data-damaged');
  assert.equal(workspaceFailureCause(new TypeError('cards is not iterable'), { schemaVersion: 1 }), null);
});

test('only damaged or undecryptable data can be set aside, and every cause has text in every locale', () => {
  assert.deepEqual(causes.filter(canSetAside), ['data-damaged', 'data-key']);
  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const cause of causes) assert.ok(catalog[causeKey(cause)], `${locale} explains ${cause}`);
  }
  assert.equal(causeKey('data-something-new'), 'app.dataFailure.unreadable');
});
