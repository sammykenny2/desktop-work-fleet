/** Isolated IndexedDB component benchmark. Usage: node scripts/testing/dataset-performance-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit] [--million] [--output build/dataset-performance.json] */
import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/dataset-performance-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit] [--million] [--output build/dataset-performance.json]\nCreates disposable browser databases. Measures real record-store commits and Workspace operations, excluding DOM, native bridges and network. --million adds one million materialized history rows.');
  process.exit(0);
}
const arg = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const base = new URL(arg('--url', '')); assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
const engine = arg('--browser', 'chromium'); assert.ok(['chromium', 'webkit'].includes(engine));
const browser = await ({ chromium, webkit })[engine].launch({ headless: true });
const context = await browser.newContext(); const page = await context.newPage();
const fixtures = [[2000, 20000], [2000, 100000], [5000, 100000]];
if (process.argv.includes('--million')) fixtures.push([2000, 1000000]);
const report = { date: new Date().toISOString(), hardware: { cpu: os.cpus()[0].model, cores: os.cpus().length,
  memoryGiB: Math.round(os.totalmem() / 2 ** 30), platform: os.platform(), release: os.release(), arch: os.arch() },
node: process.version, browser: engine, browserVersion: browser.version(), samples: 12, warmups: 2,
scope: 'Workspace + real IndexedDB, strict durable commits; no DOM/layout/network/native bridge. History setup excluded. Current texts have 128 ASCII characters plus a note number; no attachments.', results: [] };
const output = arg('--output', `build/dataset-performance-${engine}.json`);
const saveReport = async () => { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`); };
try {
  await page.goto(new URL('/app/style.css', base).href);
  for (const [current, history] of fixtures) {
    console.log(`Seeding ${current} notes / ${history} materialized versions in ${engine}`);
    let result;
    try { result = await page.evaluate(async ({ current, history }) => {
      const { Workspace } = await import('/core/workspace.js');
      const { revisionRecord } = await import('/sources/revisions.js');
      const { IndexedDbRecordStore } = await import('/storage/records-indexed-db.js');
      const { WorkspaceRecordStorage } = await import('/storage/workspace-records.js');
      const { recordTransaction } = await import('/storage/records.js');
      const { rankSearch } = await import('/app/search.js');
      const name = `benchmark-${crypto.randomUUID()}`, profile = 'local';
      const records = await IndexedDbRecordStore.open(name, { legacyName: null });
      let storage = new WorkspaceRecordStorage(records, profile);
      const starter = await Workspace.create({ profileId: profile, current: true, deviceId: crypto.randomUUID(),
        area: { x: 0, y: 0, width: 1400, height: 900 }, persist: async () => {} });
      const sample = await starter.createCard({ format: 'markdown', text: 'x'.repeat(128), attachments: [] });
      const state = starter.state, group = state.revisions.find(record => record.kind === 'group');
      state.cards = Array.from({ length: current }, (_, i) => ({ ...sample, id: crypto.randomUUID(), revision: crypto.randomUUID(), content: { ...sample.content, text: `${sample.content.text} note ${i}` } }));
      state.revisions = [group, ...state.cards.map(card => revisionRecord('card', card))];
      state.revision = 0; await storage.save(state, null);
      const active = (await records.get(profile, 'meta', 'active')).value;
      let expected = (await records.status(profile)).revision;
      const retained = history - current;
      for (let offset = 0; offset < retained; offset += 400) {
        const rows = Array.from({ length: Math.min(400, retained - offset) }, (_, i) => {
          const card = state.cards[(offset + i) % current], id = crypto.randomUUID();
          const value = revisionRecord('card', { ...card, revision: id });
          return { collection: 'history', key: `${active.historyGeneration}:${id}`, entity: `${active.historyGeneration}:card:${card.id}`, ordinal: expected + 1, value };
        });
        const receipt = await records.commit(recordTransaction(profile, expected, rows), expected); expected = receipt.revision;
      }
      let counts;
      const reset = () => { counts = { reads: 0, historyReads: 0, writes: 0, serializedBytes: 0 }; };
      const get = records.get.bind(records), page = records.page.bind(records), commit = records.commit.bind(records);
      records.get = async (...args) => { const value = await get(...args); counts.reads += value ? 1 : 0; if (args[1] === 'history') counts.historyReads++; return value; };
      records.page = async (...args) => { const value = await page(...args); counts.reads += value.rows.length; if (args[1].collection === 'history') counts.historyReads += value.rows.length; return value; };
      records.commit = async (...args) => { counts.writes += args[0].puts.length + args[0].deletes.length; counts.serializedBytes += new TextEncoder().encode(JSON.stringify(args[0])).length; return commit(...args); };
      const series = {};
      async function sampleTime(name, work) {
        reset(); const start = performance.now(); await work(); const ms = performance.now() - start;
        (series[name] ??= []).push({ ms, ...counts });
      }
      let workspace;
      for (let i = 0; i < 14; i++) {
        await sampleTime('open', async () => {
          storage = new WorkspaceRecordStorage(records, profile);
          workspace = new Workspace(await storage.load(profile), (...args) => storage.save(...args), undefined, undefined, { history: storage });
        });
        const card = workspace.snapshot.cards[0], draft = workspace.blankDraft(card.groupId, card); draft.content.text += 'a';
        await sampleTime('type', () => workspace.saveDraft(draft));
        await sampleTime('save', () => workspace.commitDraft(draft.id));
        await sampleTime('search', () => rankSearch(workspace.working.cards, 'note 19'));
        const concurrentDraft = workspace.blankDraft(card.groupId, workspace.snapshot.cards[0]); concurrentDraft.content.text += 'b';
        await sampleTime('typeWithMaintenance', () => Promise.all([storage.putJob('benchmark-maintenance', { kind: 'benchmark' }), workspace.saveDraft(concurrentDraft)]));
        await workspace.commitDraft(concurrentDraft.id);
      }
      const stats = {};
      for (const [name, entries] of Object.entries(series)) {
        const measured = entries.slice(2), ordered = measured.map(item => item.ms).sort((a, b) => a - b);
        stats[name] = { p50ms: +ordered[Math.floor(ordered.length * 0.5)].toFixed(2), p95ms: +ordered[Math.ceil(ordered.length * 0.95) - 1].toFixed(2),
          maxReads: Math.max(...measured.map(item => item.reads)), maxHistoryReads: Math.max(...measured.map(item => item.historyReads)),
          maxWrites: Math.max(...measured.map(item => item.writes)), maxSerializedBytes: Math.max(...measured.map(item => item.serializedBytes)) };
      }
      records.close(); await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = reject; });
      return { current, history, stats };
    }, { current, history }); } catch (error) {
      report.failure = { current, history, message: error.message }; await saveReport(); throw error;
    }
    for (const metric of Object.values(result.stats)) assert.equal(metric.maxHistoryReads, 0);
    assert.equal(result.stats.type.maxWrites, 2);
    report.results.push(result); await saveReport(); console.log(JSON.stringify(result));
  }
  console.log(`PASS bounded current operations; report: ${output}`);
} finally { await context.close(); await browser.close(); }
