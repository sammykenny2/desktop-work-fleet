import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { canonicalJson, JSON_LIMITS, parseJson } from '../src/sources/json.js';
import { decodeRevision, encodeRevision, revisionRecord, RevisionGraph } from '../src/sources/revisions.js';

const card = (revision, text = revision, parents = [], patch = {}) => revisionRecord('card', {
  id: 'card-1', revision, groupId: 'group-1', content: { text, format: 'markdown' },
  deleted: false, completed: false, archived: false, ...patch,
}, parents);
const ids = graph => graph.heads('card', 'card-1').map(record => record.revisionId);
const fails = code => error => error.code === code;

test('wire JSON round-trips unknown content, checklist, attachment references and Unicode deterministically', () => {
  const record = card('one', '', [], { content: { format: 'future-format', text: '記下 📝\n- [x] 完成',
    attachments: [{ id: 'blob', name: '筆記.txt', mediaType: 'text/plain', size: 12 }],
    future: { z: [false, null, 1.5], a: { keep: true } } }, extra: { preserve: true } });
  const encoded = encodeRevision(record);
  assert.deepEqual(decodeRevision(encoded), record);
  const reordered = Object.fromEntries(Object.entries(record).reverse());
  assert.deepEqual(encodeRevision(reordered), encoded);
  assert.equal(canonicalJson({ b: 1, a: -0 }), '{"a":0,"b":1}');
});

test('strict JSON rejects duplicate, escaped duplicate, unsafe keys, invalid UTF-8, surrogates and numbers', () => {
  for (const source of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"__proto__":{}}',
    '{"constructor":1}', '{"":"x"}', '{"x":"\\ud800"}', '"\udc00"', '1e999', '9007199254740993',
    '[1,]', '{"x":true,}', '01', '.2', 'NaN', 'true false', '\uFEFF{}', '"a\n"', '"\\x"', '']) {
    assert.throws(() => parseJson(source), fails('invalid-json'), JSON.stringify(source));
  }
  assert.throws(() => parseJson(new Uint8Array([0xc3, 0x28])), fails('invalid-json'));
  const variants = [undefined, NaN, Infinity, 2n, new Date(), new Map(), { a: undefined }, [, 1],
    { get secret() { throw new Error('must not invoke getters'); } }, { [Symbol('key')]: true }];
  const cyclic = {}; cyclic.self = cyclic; variants.push(cyclic);
  for (const value of variants) assert.throws(() => canonicalJson(value), fails('invalid-json'));
  assert.deepEqual(parseJson(' { "a": [false, null, -0.25, 1e2, "\\\"\\\\"] } '), { a: [false, null, -0.25, 100, '"\\'] });
});

test('JSON depth, byte and item limits fail explicitly instead of truncating', () => {
  const deep = '['.repeat(JSON_LIMITS.depth + 1) + '0' + ']'.repeat(JSON_LIMITS.depth + 1);
  assert.throws(() => parseJson(deep), fails('json-limit'));
  assert.throws(() => parseJson('"' + 'a'.repeat(JSON_LIMITS.bytes) + '"'), fails('json-limit'));
  assert.throws(() => canonicalJson(Array(JSON_LIMITS.nodes).fill(null)), fails('json-limit'));
  assert.throws(() => canonicalJson('\u0000'.repeat(Math.ceil(JSON_LIMITS.bytes / 6))), fails('json-limit'));
  assert.throws(() => canonicalJson('中'.repeat(Math.ceil(JSON_LIMITS.bytes / 3))), fails('json-limit'));
  assert.equal(new TextEncoder().encode(canonicalJson('a'.repeat(JSON_LIMITS.bytes - 2))).byteLength, JSON_LIMITS.bytes);
});

test('oversized repeated references fail within a small heap before building the full serialized payload', () => {
  const module = new URL('../src/sources/json.js', import.meta.url).href;
  for (const expression of ["Array(80).fill('x'.repeat(1024 * 1024))", 'Array(1000000).fill(null)', "'\\u0000'.repeat(4 * 1024 * 1024)"]) {
    const result = spawnSync(process.execPath, ['--max-old-space-size=48', '--input-type=module', '-e',
      `import { canonicalJson } from ${JSON.stringify(module)};
      const input = ${expression};
      try { canonicalJson(input); process.exitCode = 2; }
      catch (error) { if (error.code !== 'json-limit') throw error; }`], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  }
});

test('unknown envelope versions and malformed record identities never enter the graph', () => {
  const good = card('one'); const graph = new RevisionGraph([good]);
  for (const patch of [{ schemaVersion: 2 }, { format: 'other-app' }]) {
    assert.throws(() => graph.ingest([{ ...good, ...patch }]), fails('unsupported-revision-format'));
  }
  for (const patch of [{ extra: true }, { entityId: 'different' }, { revisionId: '../path' },
    { kind: 'unknown' }, { parents: ['one'] }, { parents: ['root', 'root'] }, { parents: Array(1025).fill('parent') },
    { value: { ...good.value, deleted: 'true' } }, { value: { ...good.value, content: { text: '', format: '' } } }]) {
    assert.throws(() => graph.ingest([{ ...good, ...patch }]), fails('invalid-revision-record'));
    assert.deepEqual(graph.records, [good]);
  }
});

test('two offline branches retain both heads in every arrival order and ignore wall clock fields', () => {
  const root = card('root'); const a = card('a', 'A', ['root'], { updatedAt: '2099-01-01' });
  const b = card('b', 'B', ['root'], { updatedAt: '1900-01-01' });
  for (const records of [[root, a, b], [b, a, root], [a, root, b], [b, root, a]]) {
    const graph = new RevisionGraph();
    for (const record of records) graph.ingest([record]);
    assert.deepEqual(ids(graph), ['a', 'b']); assert.deepEqual(graph.pending, []);
    assert.deepEqual(graph.entities(), [{ kind: 'card', entityId: 'card-1', heads: [a, b] }]);
  }
});

test('delete versus edit remains a conflict, explicit all-head resolution does not eat a late branch', () => {
  const root = card('root'); const deleted = card('deleted', 'original', ['root'], { deleted: true });
  const edited = card('edited', 'kept edit', ['root']);
  const graph = new RevisionGraph([root, deleted, edited]);
  assert.deepEqual(ids(graph), ['deleted', 'edited']);
  graph.ingest([card('resolved', 'combined', ['edited', 'deleted'])]);
  assert.deepEqual(ids(graph), ['resolved']);
  graph.ingest([card('late', 'offline third device', ['root'])]);
  assert.deepEqual(ids(graph), ['late', 'resolved']);
  assert.equal(graph.get('deleted').value.deleted, true);
});

test('missing parents and dependent descendants wait without hiding the previous complete head', () => {
  const graph = new RevisionGraph([card('root')]);
  graph.ingest([card('merge', 'resolved', ['root', 'unknown']), card('child', 'later', ['merge'])]);
  assert.deepEqual(ids(graph), ['root']); assert.deepEqual(graph.pending, ['child', 'merge']);
  assert.deepEqual(graph.missing, ['unknown']); assert.equal(graph.isComplete('merge'), false);
  graph.ingest([card('unknown', 'remote edit', ['root'])]);
  assert.deepEqual(ids(graph), ['child']); assert.deepEqual(graph.pending, []);
});

test('idempotent replay normalizes parent order, rejects immutable identity collisions atomically', () => {
  const graph = new RevisionGraph([card('root'), card('a', 'A', ['root']), card('b', 'B', ['root'])]);
  const merged = card('merged', 'AB', ['a', 'b']);
  graph.ingest([merged]); const before = graph.records;
  assert.equal(graph.ingest([{ ...merged, parents: ['b', 'a'] }, merged]).added, 0);
  assert.throws(() => graph.ingest([card('new', 'valid', ['merged']), card('a', 'tampered', ['root'])]), fails('revision-collision'));
  assert.deepEqual(graph.records, before);
});

test('cycles, cross-entity parents and delayed cross-kind parents reject the entire batch', () => {
  const graph = new RevisionGraph([card('root')]);
  assert.throws(() => graph.ingest([card('x', '', ['y']), card('y', '', ['x', 'unknown'])]), fails('revision-cycle'));
  const other = card('other', 'different', [], { id: 'card-2' });
  assert.throws(() => graph.ingest([other, card('child', '', ['other'])]), fails('parent-identity'));
  assert.equal(graph.size, 1);
  graph.ingest([card('pending', '', ['group-revision'])]);
  const group = revisionRecord('group', { id: 'group-1', revision: 'group-revision', name: 'Group', deleted: false });
  assert.throws(() => graph.ingest([group]), fails('parent-identity'));
  assert.equal(graph.get('group-revision'), null); assert.deepEqual(graph.pending, ['pending']);
});

test('graph never exposes mutable internals and two root records for one entity remain a conflict', () => {
  const input = card('a'); const graph = new RevisionGraph([input, card('b')]);
  input.value.content.text = 'mutation';
  graph.get('a').parents.push('fake'); graph.records[0].value.content.text = 'mutation';
  graph.heads('card', 'card-1')[0].value.completed = true;
  graph.entities()[0].heads.pop();
  assert.deepEqual(ids(graph), ['a', 'b']); assert.equal(graph.get('a').value.content.text, 'a');
  assert.equal(graph.get('a').value.completed, false);
});

test('long reverse histories are iterative and produce the same single final head', () => {
  const records = Array.from({ length: 12000 }, (_, i) => card(`r${i}`, `edit ${i}`, i ? [`r${i - 1}`] : []));
  const graph = new RevisionGraph(records.reverse());
  assert.equal(graph.size, records.length); assert.deepEqual(ids(graph), ['r11999']);
  assert.deepEqual(graph.missing, []); assert.deepEqual(graph.pending, []);
});
