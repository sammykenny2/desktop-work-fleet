import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { areas, catalogs } from '../src/i18n/catalogs.js';
import { formatDate, getLocale, LOCALES, matchLocale, plural, resolveLocale, setLocale, t } from '../src/i18n/index.js';
import { languageOptions } from '../src/app/language.js';
import { nativeError } from '../src/native/bridge.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
const placeholders = text => [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match => match[1]).sort();
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root })
  .toString('utf8').split('\0').filter(file => file && existsSync(path.join(root, file)));
const sources = (folder, pattern) => files.filter(file => file.startsWith(folder) && pattern.test(file));
function inLocale(locale, action) {
  const previous = getLocale(); setLocale(locale);
  try { return action(); } finally { setLocale(previous); }
}

test('every locale has the same areas, keys and placeholders, with no empty text', () => {
  const english = areas.en;
  for (const locale of LOCALES) {
    assert.deepEqual(Object.keys(areas[locale]).sort(), Object.keys(english).sort(), locale);
    for (const [area, entries] of Object.entries(areas[locale])) {
      assert.deepEqual(Object.keys(entries).sort(), Object.keys(english[area]).sort(), `${locale} ${area}`);
      for (const [key, text] of Object.entries(entries)) {
        assert.ok(key.startsWith(`${area}.`), `${locale} ${key} belongs in ${key.split('.')[0]}.js`);
        assert.ok(typeof text === 'string' && text.trim(), `${locale} ${key} is empty`);
        assert.deepEqual(placeholders(text), placeholders(english[area][key]), `${locale} ${key} placeholders`);
      }
    }
  }
});

test('no catalog file repeats a key, which an object literal would silently drop', () => {
  for (const file of files.filter(file => /^src\/i18n\/locales\/[^/]+\/[^/]+\.js$/.test(file))) {
    const keys = [...read(file).matchAll(/^\s*(['"])([^'"]+)\1\s*:/gm)].map(match => match[2]);
    const repeated = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(repeated, [], file);
  }
});

test('lookups interpolate, fall back to English and pick plural forms', () => {
  assert.equal(t('settings.general.language'), 'Display language');
  assert.equal(inLocale('zh-TW', () => t('settings.general.language')), catalogs['zh-TW']['settings.general.language']);
  assert.equal(t('missing.key.for.test'), 'missing.key.for.test');
  assert.equal(inLocale('zh-TW', () => t('missing.key.for.test')), 'missing.key.for.test');
  assert.equal(formatDate('not a date'), '');
  assert.match(inLocale('en', () => formatDate('2026-10-17T00:00:00Z', { year: 'numeric', timeZone: 'UTC' })), /2026/);
  for (const key of Object.keys(catalogs.en).filter(key => key.endsWith('.one'))) {
    const base = key.slice(0, -4);
    assert.ok(Object.hasOwn(catalogs.en, `${base}.other`), `${base}.other`);
    assert.equal(plural(base, 1), t(`${base}.one`, { count: 1 }));
  }
});

test('system languages resolve with the documented rules', () => {
  for (const [tag, expected] of [['en', 'en'], ['en-US', 'en'], ['EN_gb', 'en'], ['zh', 'zh-TW'], ['zh-TW', 'zh-TW'],
    ['zh_TW.UTF-8', 'zh-TW'], ['zh-Hant', 'zh-TW'], ['zh-Hant-TW', 'zh-TW'], ['zh-HK', 'zh-TW'], ['zh-MO', 'zh-TW'],
    ['zh-CN', null], ['zh-Hans-CN', null], ['zh-SG', null], ['ja-JP', null], ['C', null], ['C.UTF-8', null], ['', null], [null, null]]) {
    assert.equal(matchLocale(tag), expected, String(tag));
  }
  assert.equal(resolveLocale('auto', ['ja-JP', 'zh-CN', 'zh-TW', 'en-US']), 'zh-TW');
  assert.equal(resolveLocale('auto', ['fr-FR']), 'en');
  assert.equal(resolveLocale('auto', []), 'en');
  assert.equal(resolveLocale('en', ['zh-TW']), 'en');
  assert.equal(resolveLocale('zh-TW', ['en-US']), 'zh-TW');
  assert.equal(resolveLocale('fr', ['zh-TW']), 'zh-TW');
});

test('display language options are named in the current UI language, as in Cats', () => {
  const labels = locale => inLocale(locale, () => languageOptions().map(option => `${option.value}=${option.label}`));
  assert.deepEqual(labels('en'), ['auto=Auto-detect', 'en=English', 'zh-TW=Traditional Chinese']);
  const zh = catalogs['zh-TW'];
  assert.deepEqual(labels('zh-TW'), [`auto=${zh['settings.general.languageAuto']}`, `en=${zh['settings.general.languageEnglish']}`,
    `zh-TW=${zh['settings.general.languageTraditionalChinese']}`]);
});

test('every key used in code and markup exists in English', () => {
  const missing = [];
  for (const file of sources('src/', /\.(js|mjs)$/)) {
    const text = read(file);
    for (const match of text.matchAll(/(?<![\w$.])t\(\s*'([^'$`]+)'/g)) if (!Object.hasOwn(catalogs.en, match[1])) missing.push(`${file}: ${match[1]}`);
    for (const match of text.matchAll(/(?<![\w$.])plural\(\s*'([^'$`]+)'/g)) {
      if (!Object.hasOwn(catalogs.en, `${match[1]}.other`)) missing.push(`${file}: ${match[1]}.other`);
    }
  }
  for (const file of sources('src/', /\.html$/)) {
    const text = read(file);
    for (const match of text.matchAll(/data-i18n="([^"]+)"/g)) if (!Object.hasOwn(catalogs.en, match[1])) missing.push(`${file}: ${match[1]}`);
    for (const match of text.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of match[1].split(';')) {
        const key = pair.split(':')[1]?.trim();
        if (!key || !Object.hasOwn(catalogs.en, key)) missing.push(`${file}: ${pair}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

// Error codes whose host message is meant verbatim; the page shows it in English. google-config tells a developer
// which build setting is missing.
const HOST_MESSAGE_CODES = new Set(['google-config']);
const NATIVE_SOURCES = /^src\/native\/(windows\/(app|core)\/.*\.cs|linux\/.*\.py|apple\/.*\.swift|android\/app\/src\/main\/.*\.java)$/;

test('every error code a native host sends has catalog text', () => {
  const codes = new Map();
  for (const file of files.filter(file => NATIVE_SOURCES.test(file))) {
    // A host error is a kebab-case code literal followed by its English message literal.
    for (const match of read(file).matchAll(/"([a-z][a-z0-9]{2,}(?:-[a-z0-9]+)*)"\s*,\s*f?"[A-Z]/g)) {
      if (!codes.has(match[1])) codes.set(match[1], file);
    }
  }
  const missing = [...codes].filter(([code]) => !HOST_MESSAGE_CODES.has(code) && !Object.hasOwn(catalogs.en, `nativeErrors.${code}`))
    .map(([code, file]) => `${code} (${file})`);
  assert.deepEqual(missing, []);
  assert.equal(inLocale('en', () => nativeError({ code: 'native-busy', message: 'Host text.' }).message), t('nativeErrors.native-busy'));
  assert.equal(nativeError({ code: 'code-without-entry', message: 'Host text.' }).message, 'Host text.');
  assert.equal(nativeError({}).code, 'native-error');
});

const NATIVE_TABLES = ['src/native/windows/core/HostText.cs', 'src/native/linux/text.py',
  'src/native/apple/Shared/FleetText.swift', 'src/native/android/app/src/main/java/app/workfleet/nativehost/HostText.java'];

/** Reads the locale blocks of a native string table: lines between "i18n:<locale>" and "i18n:end" markers. */
function nativeBlocks(text) {
  const blocks = {}; let locale = null;
  for (const line of text.split('\n')) {
    const marker = line.match(/i18n:([A-Za-z-]+)/);
    if (marker) { locale = marker[1] === 'end' ? null : marker[1]; if (locale) blocks[locale] = {}; continue; }
    if (!locale) continue;
    const strings = [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(match => match[1]);
    if (strings.length >= 2) blocks[locale][strings[0]] = strings.slice(1).join('');
  }
  return blocks;
}

test('every native string table has matching English and Traditional Chinese blocks', () => {
  for (const file of NATIVE_TABLES) {
    assert.ok(existsSync(path.join(root, file)), `${file} exists`);
    const blocks = nativeBlocks(read(file));
    assert.deepEqual(Object.keys(blocks).sort(), [...LOCALES].sort(), file);
    assert.ok(Object.keys(blocks.en).length > 0, `${file} has entries`);
    assert.deepEqual(Object.keys(blocks['zh-TW']).sort(), Object.keys(blocks.en).sort(), file);
    for (const [key, text] of Object.entries(blocks.en)) {
      assert.deepEqual(placeholders(blocks['zh-TW'][key]), placeholders(text), `${file} ${key}`);
    }
  }
});

// Chinese text outside the zh-TW catalogs and Chinese editions. Each place says why it needs Chinese, and `lines`
// caps how many lines of that file may contain it.
const CJK_EXCEPTIONS = [
  { file: 'src/sources/initial-group.js', lines: 1, reason: 'the shared initial group keeps its persisted V1 name' },
  { file: 'docs/i18n.md', lines: 16, reason: 'the Traditional Chinese option labels and the terminology pairs' },
  { file: 'tests/desktop-transport.test.js', lines: 1, reason: 'three-byte UTF-8 text makes chunk boundaries split a character' },
  { file: 'tests/automatic-backup.test.js', lines: 1, reason: 'a non-ASCII vault password' },
  { file: 'tests/backup-archive.test.js', lines: 2, reason: 'a non-ASCII password and manifest text through ZIP and encryption' },
  { file: 'tests/backup-payload.test.js', lines: 4, reason: 'Unicode note text, attachment bytes, file name and password' },
  { file: 'tests/backup-restore.test.js', lines: 2, reason: 'Unicode attachment bytes and text through a restore' },
  { file: 'tests/native-storage.test.js', lines: 4, reason: 'Unicode password, file name and text, and three-byte characters at the size limit' },
  { file: 'tests/revisions.test.js', lines: 3, reason: 'Unicode wire JSON round trips and three-byte characters at the byte limit' },
  { file: 'scripts/testing/automatic-backup-probe.mjs', lines: 2, reason: 'Chinese text and passwords through ZIP, encryption and the UI' },
  { file: 'scripts/testing/backup-probe.mjs', lines: 3, reason: 'Chinese text and passwords through ZIP, encryption and the UI' },
  { file: 'scripts/testing/restore-ui-probe.mjs', lines: 6, reason: 'Chinese text and passwords through ZIP, encryption and the UI' },
  { file: 'tests/test_linux_vault.py', lines: 2, reason: 'a UTF-8 secret round trip through Secret.Value' },
];
// Built from code points so this file itself stays free of the characters it looks for.
const CJK = new RegExp(`[${[[0x3000, 0x303f], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff], [0xff00, 0xffef]]
  .map(([first, last]) => `${String.fromCodePoint(first)}-${String.fromCodePoint(last)}`).join('')}]`);
const BINARY = /\.(png|jpg|jpeg|gif|ico|icns|jar|zip|rtf|keystore|cer|pfx|p12|der|woff2?|ttf|otf|xcassets)$/i;
const chineseEdition = file => /\.zh-TW\.[^/]+$/.test(file) || /_ZH\.[^/.]+$/.test(file) || file.startsWith('src/i18n/locales/zh-TW/');

test('no Chinese text outside catalogs, Chinese editions and documented exceptions', () => {
  const found = [];
  for (const file of files) {
    if (BINARY.test(file) || chineseEdition(file)) continue;
    const text = readFileSync(path.join(root, file));
    if (text.includes(0)) continue;
    let lines = text.toString('utf8').split('\n');
    if (NATIVE_TABLES.includes(file)) {
      let inChinese = false;
      lines = lines.filter(line => {
        const marker = line.match(/i18n:([A-Za-z-]+)/);
        if (marker) { inChinese = marker[1] === 'zh-TW'; return false; }
        return !inChinese;
      });
    }
    const count = lines.filter(line => CJK.test(line)).length;
    const allowed = CJK_EXCEPTIONS.find(exception => exception.file === file)?.lines ?? 0;
    if (count > allowed) found.push(`${file}: ${count} line(s)`);
  }
  assert.deepEqual(found, []);
});
