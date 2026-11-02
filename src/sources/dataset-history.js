import { copy, requireValue } from '../core/contracts.js';
import { datasetShard, verifyDatasetBytes } from './dataset-codec.js';
import { DatasetProtocol, listDatasetObjects } from './dataset-protocol.js';
import { canonicalJson } from './json.js';
import { t } from '../i18n/index.js';

const invalid = condition => requireValue(condition, 'invalid-dataset', t('errors.sources.datasetInvalid'));
const purged = condition => requireValue(condition, 'dataset-purged', t('errors.sources.datasetPurged'));

/** Selected-entity history is paged independently of current sync. Cached coverage is always explicit. */
export class DatasetHistory {
  #workspace; #storage; #provider;
  constructor({ workspace, storage, fileStore = () => null }) {
    this.#workspace = workspace; this.#storage = storage; this.#provider = typeof fileStore === 'function' ? fileStore : () => fileStore;
  }
  #binding() { return this.#workspace.syncState.dataset ?? null; }
  async purgedEntities(ids, { remote = true } = {}) {
    ids = [...new Set(ids)]; const binding = this.#binding(), found = new Set();
    for (const id of ids) if (await this.#storage.getControl(`local-purge:${id}`)
      || binding && await this.#storage.getControl(`purge:${binding.plan.datasetId}:${id}`)) found.add(id);
    if (remote && this.#workspace.state.profileId.startsWith('google:')) {
      const store = this.#provider(); requireValue(store && binding, 'history-offline', t('errors.sources.historyOffline'));
      const protocol = new DatasetProtocol(store, this.#storage);
      await protocol.assertGeneration(binding.descriptor, binding.plan);
      for (const marker of await protocol.purges(binding.plan, ids)) {
        found.add(marker.entityId); await this.#storage.putControl(`purge:${binding.plan.datasetId}:${marker.entityId}`, marker);
      }
      requireValue(this.#binding()?.plan.datasetId === binding.plan.datasetId, 'dataset-changed', t('errors.sources.datasetChanged'));
    }
    return [...found].sort();
  }
  async verifySnapshot(state, { remote = true } = {}) {
    const current = this.#workspace.state;
    requireValue(current.profileId === state.profileId && current.revision === state.revision
      && canonicalJson(current.sync.dataset ?? null) === canonicalJson(state.sync.dataset ?? null),
    'backup-snapshot-changed', t('errors.backup.exportWorkspaceChanged'));
    purged(!(await this.purgedEntities(state.cards.map(card => card.id), { remote })).length);
  }
  async assertAvailable(kind, entityId, { remote = true, binding = this.#binding() } = {}) {
    if (kind !== 'card') return;
    purged(!await this.#storage.getControl(`local-purge:${entityId}`));
    if (!binding) return;
    purged(!await this.#storage.getControl(`purge:${binding.plan.datasetId}:${entityId}`));
    const store = this.#provider();
    if (remote && store) {
      const protocol = new DatasetProtocol(store, this.#storage);
      await protocol.assertGeneration(binding.descriptor, binding.plan);
      const markers = await protocol.purges(binding.plan, [entityId]);
      for (const value of markers) await this.#storage.putControl(`purge:${binding.plan.datasetId}:${entityId}`, value);
      purged(!markers.length);
    }
    requireValue(this.#binding()?.plan.datasetId === binding.plan.datasetId, 'dataset-changed', t('errors.sources.datasetChanged'));
  }
  async folders(kind, entityId, binding = this.#binding(), checked = false) {
    const store = this.#provider(); requireValue(store && binding, 'history-offline', t('errors.sources.historyOffline'));
    if (!checked) await this.assertAvailable(kind, entityId, { binding });
    const folders = await listDatasetObjects(store, { scope: 'entity-folders', datasetId: binding.plan.datasetId, entities: [entityId] }, { limit: 32 });
    const parent = binding.plan.folders[kind === 'card' ? 'notes' : 'groups'];
    for (const folder of folders) invalid(folder.kind === 'folder' && folder.parentId === parent && folder.entityId === entityId
      && folder.role === (kind === 'card' ? 'note' : 'group'));
    return folders.sort((a, b) => a.id.localeCompare(b.id));
  }
  async #remember(value, file) {
    await this.#storage.cacheHistory([value.record]);
    await this.#storage.putControl(`history:${file.datasetId}:${file.revisionId}`, { file, attachments: value.attachments });
    for (const attachment of value.attachments) await this.#storage.putControl(`history-attachment:${file.datasetId}:${attachment.sha256}`, attachment);
  }
  async page(kind, entityId, { after = null, limit = 20 } = {}) {
    invalid(['card', 'group'].includes(kind) && Number.isInteger(limit) && limit > 0 && limit <= 50);
    const binding = this.#binding(), store = this.#provider();
    await this.assertAvailable(kind, entityId, { binding });
    const cloud = Boolean(binding && store);
    invalid(!after || after.kind === kind && after.entityId === entityId && after.datasetId === (binding?.plan.datasetId ?? null));
    const cursor = after ? copy(after) : { kind, entityId, datasetId: binding?.plan.datasetId ?? null, phase: 'local', position: null };
    if (cursor.phase === 'local') {
      const result = await this.#storage.page(kind, entityId, { after: cursor.position, limit });
      const next = result.next ? { ...cursor, position: result.next } : cloud ? { ...cursor, phase: 'remote', position: null } : null;
      return { records: result.records, next, coverage: binding ? 'cached' : 'complete' };
    }
    requireValue(cloud, 'history-offline', t('errors.sources.historyOffline'));
    cursor.folders ??= (await this.folders(kind, entityId, binding, true)).map(file => file.id);
    cursor.index ??= 0; cursor.files ??= []; cursor.pageToken ??= null;
    const entries = []; let pages = 0;
    while (entries.length < limit && cursor.index < cursor.folders.length) {
      if (!cursor.files.length) {
        if (++pages > 2) break; // Empty/duplicate folders cannot turn one UI page into an unbounded scan.
        const page = await store.listObjects({ query: { scope: 'history', datasetId: binding.plan.datasetId, parentId: cursor.folders[cursor.index] }, pageToken: cursor.pageToken });
        invalid(Array.isArray(page.files) && page.files.length <= 100 && !page.incomplete && (!page.nextPageToken || page.nextPageToken !== cursor.pageToken));
        cursor.files = page.files; cursor.pageToken = page.nextPageToken ?? null;
        for (const file of cursor.files) invalid(file.kind === 'revision' && file.entityId === entityId && file.parentId === cursor.folders[cursor.index]
          && file.datasetId === binding.plan.datasetId && file.shard === await datasetShard(kind, entityId));
        if (!cursor.files.length && !cursor.pageToken) { cursor.index++; continue; }
      }
      const file = cursor.files[0]; if (!file) continue;
      entries.push({ kind, entityId, revisionId: file.revisionId, file }); cursor.files.shift();
      if (!cursor.files.length && !cursor.pageToken) cursor.index++;
    }
    await this.assertAvailable(kind, entityId, { binding });
    await this.#storage.putControls(entries.map(({ file }) => ({ key: `history:${file.datasetId}:${file.revisionId}`, value: { file, attachments: null } })));
    return { records: [], entries, next: cursor.index < cursor.folders.length ? cursor : null, coverage: 'retained' };
  }
  async get(id, { file = null } = {}) {
    const local = await this.#storage.get(id);
    if (local && !file) { await this.assertAvailable(local.kind, local.entityId); return local; }
    const binding = this.#binding(), store = this.#provider();
    requireValue(binding && store, 'history-offline', t('errors.sources.historyOffline'));
    const location = file ? { file } : await this.#storage.getControl(`history:${binding.plan.datasetId}:${id}`);
    if (!location) return null;
    invalid(location.file.datasetId === binding.plan.datasetId && location.file.revisionId === id && location.file.kind === 'revision');
    const kind = location.file.shard === 'groups' ? 'group' : 'card';
    await this.assertAvailable(kind, location.file.entityId, { binding });
    const value = await new DatasetProtocol(store, this.#storage).read(location.file);
    invalid(!local || canonicalJson(local) === canonicalJson(value.record));
    await this.assertAvailable(kind, location.file.entityId, { binding }); await this.#remember(value, location.file);
    return value.record;
  }
  async attachment(id) {
    const binding = this.#binding(), store = this.#provider();
    if (!binding || !store) return null;
    const view = this.#workspace.syncState.datasetView ?? {};
    let file = null;
    for (const key of Object.values(view)) {
      const shard = await this.#storage.getControl(key);
      file = shard?.heads.flatMap(head => head.attachments).find(file => file.sha256 === id);
      if (file) break;
    }
    file ??= await this.#storage.getControl(`history-attachment:${binding.plan.datasetId}:${id}`);
    if (!file) return null;
    await this.assertAvailable('card', file.entityId, { binding });
    const bytes = await verifyDatasetBytes(file, await store.readObject({ file }));
    await this.assertAvailable('card', file.entityId, { binding });
    await this.#storage.putAttachmentBytes(this.#workspace.state.profileId, id, bytes);
    return new Blob([bytes], { type: 'application/octet-stream' });
  }
}
