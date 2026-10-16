import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightCode } from '../src/app/markdown.js';
import { thumbnailBlob } from '../src/app/attachments.js';
import { NativeAttachments } from '../src/native/attachments.js';

test('explicit code languages produce escaped highlighting while unknown and large blocks stay plain', () => {
  const html = highlightCode('const message = "<script>bad()</script>";', 'js');
  assert.match(html, /hljs-keyword/); assert.match(html, /hljs-string/);
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
  assert.match(highlightCode('def message():\n    return 42', 'python'), /hljs-keyword/);
  assert.match(highlightCode('{"count":42}', 'json'), /hljs-number/);
  assert.equal(highlightCode('plain', undefined), null);
  assert.equal(highlightCode('plain', 'unknown-language'), null);
  assert.equal(highlightCode('a'.repeat(20001), 'js'), null);
});

test('thumbnail responses accept bounded PNG bytes, never arbitrary URLs or document bytes', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGNQiQ8AIgYIBQAWcgNNdvla9QAAAABJRU5ErkJggg==';
  assert.equal(thumbnailBlob(png).type, 'image/png');
  for (const invalid of ['https://example.com/a.png', btoa('<svg onload="bad()"/>'), 'a'.repeat(350001)]) {
    assert.throws(() => thumbnailBlob(invalid), error => error.code === 'attachment-preview');
  }
});

test('preview caching shares requests but never caches missing or failed attachments', async () => {
  let calls = 0; let available = false; let fail = false;
  const files = new NativeAttachments({ request: async (method, args) => {
    assert.equal(method, 'attachment.preview'); assert.equal(args.id, 'blob'); calls++;
    if (fail) throw new Error('offline'); return { available, png: null };
  } });
  const file = { id: 'blob', name: 'proof.pdf' };
  await files.preview(file); await files.preview(file); assert.equal(calls, 2);
  available = true; await Promise.all([files.preview(file), files.preview(file)]); assert.equal(calls, 3);
  await files.preview(file); assert.equal(calls, 3);
  fail = true; await assert.rejects(files.preview({ ...file, name: 'renamed.pdf' }));
  fail = false; await files.preview({ ...file, name: 'renamed.pdf' }); assert.equal(calls, 5);
});
