import { Drafts, statuses, cacheKey, credentialKey } from './model.js';
const $ = id => document.getElementById(id);
const drafts = new Drafts(localStorage);
let token = window.workFleetNative?.token || localStorage.getItem(credentialKey) || '';
let snapshot = { epoch: '', notes: [], role: 'viewer' };
let draft = null;
let view = 'active';
let syncing = false;
let sending = false;
let storageFailed = false;
let generation = 0;
try { snapshot = JSON.parse(localStorage.getItem(cacheKey)) || snapshot; } catch { /* retain damaged cache */ }
const canWrite = () => snapshot.role !== 'viewer' && !!token;
function status(text, error = false, id = 'connection-state') {
  $(id).textContent = text;
  $(id).classList.toggle('error', error);
}
function store(action, protectsDraft = true) {
  try { return action(); }
  catch (error) {
    if (protectsDraft) storageFailed = true;
    status('Not sent: saving on this device failed. Copy the text or export your drafts. ' + error.message, true, 'draft-state');
    throw error;
  }
}
async function api(path, body) {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status, detail: result });
  return result;
}
function updateDraftList() {
  const list = drafts.list();
  $('draft-count').textContent = `(${list.length})`;
  $('drafts').replaceChildren();
  for (const item of list) {
    const row = document.createElement('div');
    const label = document.createElement('span');
    label.textContent = (item.text || 'Empty draft').slice(0, 55) + (item.pending ? ' · Send not confirmed' : '');
    row.append(label, button('Recover', () => { if (!sending) { preserveCurrent(); loadDraft(store(() => drafts.recover(item))); } }), button('Discard', () => {
      if (sending || !confirm('Discard this local draft?')) return;
      store(() => drafts.remove(item));
      if (draft?.key === item.key) { draft = null; showDraft(); }
      updateDraftList();
    }));
    $('drafts').append(row);
  }
}
function showDraft() {
  $('note-text').value = draft?.text || '';
  $('note-board').value = draft?.board || 'Inbox';
  $('note-status').value = draft?.status || 'todo';
  $('editor-title').textContent = draft?.revision ? 'Edit note' : 'Capture a thought';
  for (const id of ['note-text', 'note-board', 'note-status']) $(id).disabled = !canWrite() || !!draft?.pending || sending;
  $('save').disabled = !canWrite() || sending;
  $('save').textContent = draft?.pending ? 'Retry the same send' : 'Save';
  $('new-draft').disabled = sending;
  $('conflict').hidden = true;
  if (draft?.pending) {
    $('conflict').hidden = false;
    $('conflict-message').textContent = 'The last send was not confirmed. Retrying reuses the same operation ID; you can also keep the original and save a copy.';
    $('current-note').textContent = '';
  }
}
function preserveCurrent() {
  if (storageFailed && draft) { store(() => drafts.write(draft)); storageFailed = false; }
}
function loadDraft(value) {
  preserveCurrent();
  draft = value; showDraft(); updateDraftList(); $('note-text').focus();
}
function capture() {
  if (!canWrite() || sending || draft?.pending) return;
  if (!draft) draft = drafts.blank(snapshot);
  const patch = { text: $('note-text').value, board: $('note-board').value, status: $('note-status').value };
  // Keep the in-memory text even if durable storage fails.
  draft = { ...draft, ...patch };
  store(() => drafts.write(draft)); storageFailed = false;
  status('Draft kept on this device.', false, 'draft-state'); updateDraftList();
}
function button(title, action) {
  const node = document.createElement('button'); node.textContent = title; node.type = 'button';
  node.addEventListener('click', () => Promise.resolve().then(action).catch(error => status(error.message, true)));
  return node;
}
function renderNotes() {
  $('notes').replaceChildren();
  const notes = snapshot.notes.filter(note => view === 'trash' ? note.deleted : !note.deleted && (view === 'done' ? note.status === 'done' : note.status !== 'done'));
  for (const note of notes) {
    const article = document.createElement('article');
    article.dataset.id = note.id;
    article.classList.toggle('progress', note.status === 'in_progress');
    const title = document.createElement('h3'); title.textContent = `${note.board} · ${statuses[note.status]}`;
    article.append(title);
    const lines = note.text.split('\n');
    lines.forEach((line, index) => {
      const match = /^- \[([ xX])\] (.*)$/.exec(line);
      if (match) {
        const label = document.createElement('label'); label.className = 'todo-line';
        const check = document.createElement('input'); check.type = 'checkbox'; check.checked = match[1] !== ' ';
        check.disabled = !canWrite() || note.deleted || sending;
        const span = document.createElement('span'); span.textContent = match[2]; label.append(check, span);
        check.onchange = async () => {
          lines[index] = `- [${check.checked ? 'x' : ' '}] ${match[2]}`;
          try { const item = store(() => drafts.create(snapshot, note)); loadDraft(store(() => drafts.edit(item, { text: lines.join('\n') }))); await send(); }
          catch (error) { status(error.message, true); }
        };
        article.append(label);
      } else { const p = document.createElement('p'); p.textContent = line; article.append(p); }
    });
    if (canWrite()) {
      const actions = document.createElement('div'); actions.className = 'row';
      if (!note.deleted) actions.append(button('Edit', () => { if (!sending) loadDraft(store(() => drafts.create(snapshot, note))); }),
        button(note.status === 'done' ? 'Back to Todo' : 'Mark done', async () => {
          if (sending) return;
          const item = store(() => drafts.create(snapshot, note));
          loadDraft(store(() => drafts.edit(item, { status: note.status === 'done' ? 'todo' : 'done' }))); await send();
        }));
      actions.append(button(note.deleted ? 'Restore note' : 'Delete', async () => {
        if (sending || (!note.deleted && !confirm('Move to Deleted? You can restore it later.'))) return;
        loadDraft(store(() => drafts.action(snapshot, note, note.deleted ? 'restore' : 'delete'))); await send();
      }));
      article.append(actions);
    }
    $('notes').append(article);
  }
  if (!notes.length) { const p = document.createElement('p'); p.textContent = view === 'active' ? 'Nothing open right now. Write down whatever comes to mind.' : 'No notes in this view.'; $('notes').append(p); }
  $('admin').hidden = snapshot.role !== 'admin';
}
async function sync() {
  if (!token || syncing) return;
  syncing = true;
  const currentGeneration = generation;
  try {
    const next = await api('/api/snapshot');
    if (currentGeneration !== generation) return;
    snapshot = next;
    store(() => localStorage.setItem(cacheKey, JSON.stringify(snapshot)), false);
    status('Synced · ' + new Date().toLocaleTimeString());
    renderNotes();
    for (const id of ['note-text', 'note-board', 'note-status']) $(id).disabled = !canWrite() || !!draft?.pending || sending;
    $('save').disabled = !canWrite() || sending;
    if (draft && draft.epoch !== snapshot.epoch) {
      $('conflict').hidden = false;
      $('conflict-message').textContent = 'The data was restored or its source changed. Your old draft is kept; compare them, then save it as a new note.';
    }
  } catch (error) {
    status(error.status === 401 ? 'Access was revoked or has expired. Pair again; your drafts are kept.' : 'Offline or service unavailable · Showing the last content; your drafts are kept.', true);
  } finally { syncing = false; }
}
async function send() {
  if (sending || !draft || !canWrite()) return;
  if (!draft.text.trim() && !draft.pending) return;
  try { draft = store(() => drafts.prepare(draft)); storageFailed = false; } catch { return; }
  sending = true; showDraft();
  const submitted = draft;
  try {
    await api('/api/operations', submitted.pending);
    store(() => drafts.remove(submitted));
    draft = null;
    status('Saved to the server.', false, 'draft-state');
    await sync();
  } catch (error) {
    $('conflict').hidden = false;
    $('conflict-message').textContent = error.status === 409
      ? 'Another device updated, deleted or restored the data. Your draft is still here; compare the text or save it as a new note.'
      : 'The send was not confirmed; the draft and its operation ID are kept. When you are back online, choose "Retry the same send".';
    $('current-note').textContent = error.detail?.current?.text || '';
    status('Sync not confirmed yet. Draft kept.', true, 'draft-state');
  } finally {
    sending = false;
    if (!draft) showDraft();
    $('save').disabled = !canWrite(); $('new-draft').disabled = false;
    $('save').textContent = draft?.pending ? 'Retry the same send' : 'Save';
    updateDraftList(); renderNotes();
  }
}
$('note-form').onsubmit = event => { event.preventDefault(); try { capture(); void send(); } catch { /* visible storage error */ } };
for (const id of ['note-text', 'note-board', 'note-status']) $(id).addEventListener('input', () => { try { capture(); } catch { /* preserve current text */ } });
$('new-draft').onclick = () => { if (!storageFailed && !sending) { draft = null; showDraft(); $('note-text').focus(); } };
$('copy-draft').onclick = () => { if (draft && snapshot.epoch && !sending) loadDraft(store(() => drafts.copy(draft, snapshot.epoch))); };
$('refresh').onclick = sync;
for (const node of document.querySelectorAll('[data-view]')) node.onclick = () => {
  view = node.dataset.view;
  for (const item of document.querySelectorAll('[data-view]')) item.setAttribute('aria-pressed', String(item === node));
  renderNotes();
};
$('settings-toggle').onclick = async () => {
  $('settings').hidden = !$('settings').hidden;
  if (!$('settings').hidden && snapshot.role === 'admin') {
    try {
      const { devices } = await api('/api/devices'); $('devices').replaceChildren();
      for (const device of devices) {
        const row = document.createElement('div'); const label = document.createElement('span');
        label.textContent = `${device.name} · ${device.role}${device.revoked ? ' · Revoked' : ''}`;
        row.append(label);
        if (!device.revoked && device.id !== snapshot.device) row.append(button('Revoke', async () => {
          await api('/api/revoke', { device: device.id }); label.textContent += ' · Revoked';
        }));
        $('devices').append(row);
      }
    } catch (error) { status(error.message, true); }
  }
};
$('server-address').textContent = location.origin;
$('re-pair').onclick = () => { $('pairing').hidden = false; };
$('pair-form').onsubmit = async event => {
  event.preventDefault();
  try {
    const result = await api('/api/pair', { code: $('pair-code').value.trim(), name: $('device-name').value });
    store(() => localStorage.setItem(credentialKey, result.token), false);
    token = result.token; generation++; snapshot = { epoch: '', notes: [], role: 'viewer' };
    localStorage.removeItem(cacheKey);
    $('pair-code').value = ''; $('pairing').hidden = true;
    await sync(); showDraft();
  } catch (error) { status('Pairing failed: ' + error.message + '. Get a new invite.', true); }
};
$('make-invite').onclick = async () => {
  try {
    const result = await api('/api/invites', { role: $('invite-role').value });
    $('invite-result').textContent = `One-time invite, valid for 5 minutes: ${result.url}`;
    setTimeout(() => { $('invite-result').textContent = 'The invite has expired. Create a new one.'; }, 300000);
  } catch (error) { status(error.message, true); }
};
$('export-drafts').onclick = () => {
  const blob = new Blob([JSON.stringify({ drafts: drafts.list(), current: draft }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'work-fleet-drafts.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
const code = new URLSearchParams(location.hash.slice(1)).get('pair');
if (code) { $('pair-code').value = code; history.replaceState(null, '', location.pathname); }
$('pairing').hidden = !!token && !code;
window.addEventListener('storage', updateDraftList);
window.addEventListener('online', sync);
window.addEventListener('beforeunload', event => { if (storageFailed) { event.preventDefault(); event.returnValue = ''; } });
renderNotes(); showDraft(); updateDraftList(); void sync(); setInterval(sync, 2500);
if ('serviceWorker' in navigator && !window.workFleetNative) navigator.serviceWorker.register('/sw.js').catch(() => {});

window.workFleetFlushDraft = () => {
  try { preserveCurrent(); return !storageFailed && !sending; } catch { return false; }
};

window.workFleetDraftState = () => ({ count: drafts.list().length, storageFailed, sending });
