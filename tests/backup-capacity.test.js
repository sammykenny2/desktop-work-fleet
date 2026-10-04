import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { BACKUP_LIMITS } from '../src/backup/archive.js';
import { createBackup, openBackup } from '../src/backup/payload.js';

test('the exact 20,000-entry boundary includes manifest, while one extra revision fails without omission', async () => {
  const workspace = await Workspace.create({ profileId: 'capacity-profile', deviceId: 'capacity-device',
    area: { x: 0, y: 0, width: 1200, height: 800 }, persist: async () => {} });
  const state = workspace.state; const group = state.groups[0]; state.outbox = [];
  const append = index => {
    const record = { format: 'work-fleet-revision', schemaVersion: 1, kind: 'card', entityId: 'capacity-card',
      revisionId: `capacity-${index}`, parents: index ? [`capacity-${index - 1}`] : [],
      value: { id: 'capacity-card', revision: `capacity-${index}`, groupId: group.id,
        content: { format: 'markdown', text: `version ${index}` }, deleted: false, archived: false, completed: false } };
    state.revisions.push(record); state.cards = [record.value];
  };
  // One group revision + card history + local/layout/manifest.
  for (let i = 0; i < BACKUP_LIMITS.entries - 4; i++) append(i);
  const input = { workspace: { state }, storage: { getAttachment: () => { throw new Error('no attachments expected'); } } };
  const result = await createBackup(input); const document = await openBackup(result.bytes);
  assert.equal(result.manifest.files.length + 1, BACKUP_LIMITS.entries);
  assert.equal(document.data.records.length, state.revisions.length);
  assert.equal(document.manifest.counts.cards, 1);
  append(BACKUP_LIMITS.entries - 4);
  await assert.rejects(createBackup(input), error => error.code === 'backup-limit');
});
