import { requireValue, safeKey } from '../core/contracts.js';
import { t } from '../i18n/index.js';

export const JSON_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, depth: 64, nodes: 200000 });
const encoder = new TextEncoder();
const scalarString = value => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const invalid = condition => requireValue(condition, 'invalid-json', t('errors.sources.jsonInvalid'));

/** Protocol canonical form: sorted UTF-16 keys, JSON string escapes and ECMAScript finite numbers. */
export function canonicalJson(value) {
  let nodes = 0; let bytes = 0;
  const chunks = [];
  const ancestors = new Set();
  const reserve = count => {
    bytes += count;
    requireValue(bytes <= JSON_LIMITS.bytes, 'json-limit', t('errors.sources.jsonTooLarge'));
  };
  const literal = text => { reserve(text.length); chunks.push(text); };
  const string = text => {
    // Count escaped UTF-8 before allocating JSON.stringify's output, including repeated references.
    requireValue(text.length <= JSON_LIMITS.bytes - bytes, 'json-limit', t('errors.sources.jsonTooLarge'));
    reserve(2);
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = text.charCodeAt(++index); invalid(low >= 0xdc00 && low <= 0xdfff); reserve(4);
      } else {
        invalid(code < 0xdc00 || code > 0xdfff);
        reserve(code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code) ? 2
          : code < 32 ? 6 : code < 128 ? 1 : code < 2048 ? 2 : 3);
      }
    }
    chunks.push(JSON.stringify(text));
  };
  const visit = (item, depth) => {
    requireValue(depth <= JSON_LIMITS.depth && ++nodes <= JSON_LIMITS.nodes,
      'json-limit', t('errors.sources.jsonTooDeep'));
    if (item === null || typeof item === 'boolean') { literal(JSON.stringify(item)); return; }
    if (typeof item === 'number') {
      invalid(Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item)));
      literal(JSON.stringify(item)); return;
    }
    if (typeof item === 'string') { string(item); return; }
    invalid(item && typeof item === 'object' && !ancestors.has(item));
    invalid(Object.getOwnPropertySymbols(item).length === 0);
    ancestors.add(item);
    if (Array.isArray(item)) {
      requireValue(item.length <= JSON_LIMITS.nodes - nodes, 'json-limit', t('errors.sources.jsonTooManyItems'));
      invalid(Object.getOwnPropertyNames(item).length === item.length + 1);
      literal('[');
      for (let index = 0; index < item.length; index++) {
        if (index) literal(',');
        const descriptor = Object.getOwnPropertyDescriptor(item, index);
        invalid(descriptor && 'value' in descriptor && descriptor.enumerable);
        visit(descriptor.value, depth + 1);
      }
      literal(']');
    } else {
      invalid(Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null);
      literal('{'); let first = true;
      for (const key of Object.getOwnPropertyNames(item).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        invalid(safeKey(key) && 'value' in descriptor && descriptor.enumerable);
        if (!first) literal(','); first = false;
        string(key); literal(':'); visit(descriptor.value, depth + 1);
      }
      literal('}');
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  return chunks.join('');
}

/** Reject ambiguous JSON before JSON.parse could discard duplicate properties or round unsafe integers. */
export function parseJson(input) {
  let source;
  if (typeof input === 'string') source = input;
  else {
    invalid(input instanceof Uint8Array);
    requireValue(input.byteLength <= JSON_LIMITS.bytes, 'json-limit', t('errors.sources.jsonTooLarge'));
    try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input); }
    catch { invalid(false); }
  }
  requireValue(source.length <= JSON_LIMITS.bytes && encoder.encode(source).byteLength <= JSON_LIMITS.bytes,
    'json-limit', t('errors.sources.jsonTooLarge'));
  let offset = 0; let nodes = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(source[offset] || 'x')) offset++; };
  const string = () => {
    const start = offset++;
    while (offset < source.length) {
      const char = source[offset++];
      if (char === '"') {
        let value;
        try { value = JSON.parse(source.slice(start, offset)); } catch { invalid(false); }
        invalid(scalarString(value)); return value;
      }
      if (char === '\\') offset++;
    }
    invalid(false);
  };
  const read = depth => {
    requireValue(depth <= JSON_LIMITS.depth && ++nodes <= JSON_LIMITS.nodes,
      'json-limit', t('errors.sources.jsonTooDeep'));
    whitespace(); const char = source[offset];
    if (char === '"') return string();
    if (char === '[' || char === '{') {
      const array = char === '['; const end = array ? ']' : '}';
      const value = array ? [] : {}; const keys = new Set(); offset++; whitespace();
      if (source[offset] === end) { offset++; return value; }
      while (true) {
        if (array) value.push(read(depth + 1));
        else {
          whitespace(); invalid(source[offset] === '"'); const key = string();
          invalid(safeKey(key) && !keys.has(key)); keys.add(key); whitespace();
          invalid(source[offset++] === ':'); value[key] = read(depth + 1);
        }
        whitespace(); if (source[offset] === end) { offset++; return value; }
        invalid(source[offset++] === ',');
      }
    }
    for (const [word, value] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(word, offset)) { offset += word.length; return value; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(offset));
    invalid(number); offset += number[0].length;
    const value = Number(number[0]);
    invalid(Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)));
    return value;
  };
  const value = read(0); whitespace(); invalid(offset === source.length); return value;
}
