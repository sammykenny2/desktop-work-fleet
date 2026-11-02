import { requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { validateDatasetFile } from './dataset-codec.js';
import { t } from '../i18n/index.js';

const missing = error => ['file-missing', 'source-file-missing'].includes(error.code);
const valid = condition => requireValue(condition, 'dataset-changed', t('errors.sources.datasetChanged'));

export function datasetDirectories(plan) {
  const folder = (id, parentId, role, extra = {}) => validateDatasetFile({ id, parentId, role,
    datasetId: plan.datasetId, kind: 'folder', ...extra });
  return [folder(plan.rootId, 'appDataFolder', 'root', { kind: 'dataset-root' }),
    ...['notes', 'groups', 'current', 'purges'].map(role => folder(plan.folders[role], plan.rootId, role)),
    ...Object.entries(plan.folders.shards).map(([shard, id]) => folder(id, plan.folders.current, `shard-${shard}`)),
    ...Object.entries(plan.folders.buckets).map(([shard, id]) => folder(id, plan.folders.purges, `bucket-${shard}`))];
}

/** Reserved shared IDs make concurrent first use idempotent. The generation root is never recreated here. */
export async function ensureDatasetDirectory(store, plan, id, { signal, guard = async () => {} } = {}) {
  const directories = new Map(datasetDirectories(plan).map(file => [file.id, file]));
  const ensure = async target => {
    const file = directories.get(target); valid(file);
    signal?.throwIfAborted();
    try { valid(canonicalJson(await store.getObject({ id: target, signal })) === canonicalJson(file)); return; }
    catch (error) { if (!missing(error)) throw error; valid(target !== plan.rootId); }
    await ensure(file.parentId); await guard(); signal?.throwIfAborted();
    try { await store.createFolder({ file, signal }); }
    catch (error) { if (!['file-exists', 'network', 'native-outcome-unknown'].includes(error.code)) throw error; }
    valid(canonicalJson(await store.getObject({ id: target, signal })) === canonicalJson(file));
  };
  await ensure(id);
}
