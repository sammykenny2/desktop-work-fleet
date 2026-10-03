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
    status('本機保存失敗，請複製文字或匯出草稿；尚未送出。' + error.message, true, 'draft-state');
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
    label.textContent = (item.text || '空白草稿').slice(0, 55) + (item.pending ? ' · 待確認傳送' : '');
    row.append(label, button('取回', () => { if (!sending) { preserveCurrent(); loadDraft(store(() => drafts.recover(item))); } }), button('捨棄', () => {
      if (sending || !confirm('捨棄這份本機草稿？')) return;
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
  $('editor-title').textContent = draft?.revision ? '編輯便箋' : '隨手記一件事';
  for (const id of ['note-text', 'note-board', 'note-status']) $(id).disabled = !canWrite() || !!draft?.pending || sending;
  $('save').disabled = !canWrite() || sending;
  $('save').textContent = draft?.pending ? '重試同一筆傳送' : '保存';
  $('new-draft').disabled = sending;
  $('conflict').hidden = true;
  if (draft?.pending) {
    $('conflict').hidden = false;
    $('conflict-message').textContent = '上次傳送尚未確認。重試會使用同一操作編號；也可以保留原稿後另存副本。';
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
  status('草稿已保留在此裝置。', false, 'draft-state'); updateDraftList();
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
      if (!note.deleted) actions.append(button('編輯', () => { if (!sending) loadDraft(store(() => drafts.create(snapshot, note))); }),
        button(note.status === 'done' ? '還原為 Todo' : '完成', async () => {
          if (sending) return;
          const item = store(() => drafts.create(snapshot, note));
          loadDraft(store(() => drafts.edit(item, { status: note.status === 'done' ? 'todo' : 'done' }))); await send();
        }));
      actions.append(button(note.deleted ? '還原便箋' : '刪除', async () => {
        if (sending || (!note.deleted && !confirm('移到已刪除？之後可以還原。'))) return;
        loadDraft(store(() => drafts.action(snapshot, note, note.deleted ? 'restore' : 'delete'))); await send();
      }));
      article.append(actions);
    }
    $('notes').append(article);
  }
  if (!notes.length) { const p = document.createElement('p'); p.textContent = view === 'active' ? '暫時沒有未完成事項。想到什麼，就先記下來。' : '這個檢視目前沒有便箋。'; $('notes').append(p); }
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
    status('已同步 · ' + new Date().toLocaleTimeString());
    renderNotes();
    for (const id of ['note-text', 'note-board', 'note-status']) $(id).disabled = !canWrite() || !!draft?.pending || sending;
    $('save').disabled = !canWrite() || sending;
    if (draft && draft.epoch !== snapshot.epoch) {
      $('conflict').hidden = false;
      $('conflict-message').textContent = '資料已還原或來源已改變。舊草稿仍保留，請比對後另存新便箋。';
    }
  } catch (error) {
    status(error.status === 401 ? '存取已撤銷或到期。請重新配對；草稿仍保留。' : '離線或服務不可用 · 顯示上次內容；草稿仍保留。', true);
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
    status('已保存到 server。', false, 'draft-state');
    await sync();
  } catch (error) {
    $('conflict').hidden = false;
    $('conflict-message').textContent = error.status === 409
      ? '其他裝置已更新、刪除或還原資料。你的草稿仍在；請比對內容或另存新便箋。'
      : '傳送未確認，草稿與操作編號已保留。恢復連線後按「重試同一筆傳送」。';
    $('current-note').textContent = error.detail?.current?.text || '';
    status('尚未確認同步。草稿已保留。', true, 'draft-state');
  } finally {
    sending = false;
    if (!draft) showDraft();
    $('save').disabled = !canWrite(); $('new-draft').disabled = false;
    $('save').textContent = draft?.pending ? '重試同一筆傳送' : '保存';
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
        label.textContent = `${device.name} · ${device.role}${device.revoked ? ' · 已撤銷' : ''}`;
        row.append(label);
        if (!device.revoked && device.id !== snapshot.device) row.append(button('撤銷', async () => {
          await api('/api/revoke', { device: device.id }); label.textContent += ' · 已撤銷';
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
  } catch (error) { status('配對失敗：' + error.message + '。請取得新邀請。', true); }
};
$('make-invite').onclick = async () => {
  try {
    const result = await api('/api/invites', { role: $('invite-role').value });
    $('invite-result').textContent = `5 分鐘有效，一次性邀請：${result.url}`;
    setTimeout(() => { $('invite-result').textContent = '邀請已到期，請重新產生。'; }, 300000);
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
