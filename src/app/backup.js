import { createBackup, openBackup } from '../backup/payload.js';
import { prepareRestore, saveSafetyBackup } from '../backup/restore.js';
import { BACKUP_LIMITS, checkCancelled } from '../backup/archive.js';
import { browserBackupFiles } from '../backup/browser-files.js';
import { requireValue } from '../core/contracts.js';
import { automaticBackupSection } from './automatic-backup.js';

const node = (tag, text, className) => {
  const value = document.createElement(tag); if (text !== undefined) value.textContent = text;
  if (className) value.className = className; return value;
};
const input = (id, type) => { const value = node('input'); value.id = id; value.type = type; return value; };
const field = (text, control, className = 'field') => { const label = node('label', text, className); label.append(control); return label; };
const button = (text, className) => { const value = node('button', text, className); value.type = 'button'; return value; };
const LOST = '所有便箋（含已完成、封存與刪除區）、群組、未完成草稿、附件、版本歷史、桌面佈局、快捷鍵與自動備份設定';

// The warning names the exact workspace, lists what goes and what stays, and keeps a way back to the export.
function confirmReset(reset, goExport) {
  const dialog = node('dialog', undefined, 'reset-dialog'); dialog.id = 'reset-data-dialog';
  const agree = input('reset-agree', 'checkbox');
  const acknowledge = node('label', undefined, 'check'); acknowledge.append(agree, document.createTextNode('我了解資料刪除後無法復原'));
  const state = node('p', '', 'backup-message'); state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
  const backup = button('先匯出備份'); const cancel = button('取消');
  const confirm = button('永久刪除並重設', 'danger'); confirm.id = 'confirm-reset-data'; confirm.disabled = true;
  let running = false;
  const settle = () => { for (const control of [agree, backup, cancel]) control.disabled = running; confirm.disabled = running || !agree.checked; };
  agree.onchange = settle;
  backup.onclick = () => { dialog.close(); goExport(); };
  cancel.onclick = () => dialog.close();
  confirm.onclick = async () => {
    if (running || !agree.checked) return;
    running = true; settle(); state.classList.remove('error'); state.textContent = '正在重設…';
    // Success reopens the page on the emptied workspace, so only a failure comes back here.
    try { await reset.run(text => { state.textContent = text; }); }
    catch (error) { running = false; settle(); state.textContent = error.message; state.classList.add('error'); }
  };
  dialog.oncancel = event => { if (running) event.preventDefault(); };
  dialog.onclose = () => dialog.remove();
  dialog.append(node('h2', '重設所有資料？'), node('p', `對象：${reset.target}`, 'reset-target'),
    node('p', `將永久刪除${reset.cloud ? '這台裝置與 Google Drive 上' : '這台裝置上'}的${LOST}。`),
    ...reset.cloud ? [node('p', '所有登入這個 Google 帳號的裝置都會受影響：它們下次同步時會發現雲端已重設，並詢問如何處理自己的副本。')] : [],
    node('p', `不受影響：${reset.keeps.join('、')}。`), node('p', '刪除後無法復原；需要保留的內容請先匯出備份。'),
    acknowledge, state);
  const actions = node('div', undefined, 'dialog-actions'); actions.append(backup, cancel, confirm); dialog.append(actions);
  document.body.append(dialog); dialog.showModal();
}

export function showBackupDialog({ workspace, storage, getWorkAreas, flush, onChanged, targetName = '目前本機工作空間', files = browserBackupFiles(), automatic, automaticError, reset }) {
  const dialog = node('dialog'); dialog.id = 'backup-dialog'; dialog.className = 'backup-dialog';
  const message = node('p', '備份包含本機已知資料；尚未收到的遠端內容不在其中。', 'backup-message');
  message.id = 'backup-status'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const encrypt = input('backup-encrypt', 'checkbox'); encrypt.checked = true;
  const password = input('backup-password', 'password'); password.autocomplete = 'new-password'; password.maxLength = 1024;
  const fileInput = input('restore-file', 'file'); fileInput.accept = '.zip,application/zip';
  const readPassword = input('restore-password', 'password'); readPassword.autocomplete = 'current-password'; readPassword.maxLength = 1024;
  const mode = node('select'); mode.id = 'restore-mode';
  for (const [value, label] of [['import', '匯入為新資料'], ['merge', '依資料身分合併'], ['replace', '取代目前可見狀態']]) mode.append(new Option(label, value));
  const layout = input('restore-layout', 'checkbox'); const repeat = input('restore-repeat', 'checkbox');
  const preview = node('div'); preview.id = 'restore-preview';
  const safetyInfo = node('p', '取代前，需先成功保存目前資料的安全備份。', 'hint');
  const receiptList = node('div'); receiptList.id = 'restore-receipts';
  const automaticSection = automaticBackupSection(automatic, automaticError);
  let busy = false; let committing = false; let abort; let loaded; let plan; let safety;
  const controls = [];
  const action = (id, text, work, className) => {
    const value = node('button', text, className); value.id = id; value.type = 'button'; controls.push(value);
    value.onclick = () => execute(work); return value;
  };
  const say = (text, error = false) => { message.textContent = text; message.classList.toggle('error', error); };
  const progress = ({ phase, completed, total }) => {
    if (phase === 'save-commit') { committing = true; refresh(); say('正在完成檔案保存與校驗…'); return; }
    const names = { read: '驗證檔案', write: '整理備份', attachments: '讀取附件', encrypt: '加密', decrypt: '解密', save: '保存檔案' };
    say(`${names[phase] || '處理中'}：${completed} / ${total}`);
  };
  const resetPlan = () => { plan = null; safety = null; preview.replaceChildren(); refresh(); };
  function refresh() {
    for (const control of [...controls, encrypt, password, fileInput, readPassword, mode, layout, repeat]) control.disabled = busy;
    password.disabled = busy || !encrypt.checked;
    confirm.disabled = busy || !plan || (mode.value === 'replace' && !safety);
    saveSafety.hidden = mode.value !== 'replace'; safetyInfo.hidden = mode.value !== 'replace';
    saveSafety.disabled = busy || !plan || !files.canConfirmSave;
    cancel.disabled = !busy || committing; close.disabled = busy;
    if (mode.value === 'replace' && !files.canConfirmSave) safetyInfo.textContent = '此環境無法確認檔案保存；取代需在支援確認保存的 App 或瀏覽器執行。';
  }
  async function execute(work) {
    if (busy) return; busy = true; abort = new AbortController(); refresh();
    try { await work(abort.signal); }
    catch (error) {
      say(error.name === 'AbortError' || error.code === 'backup-cancelled' ? '工作已取消。' : error.message, true);
      if (['stale-restore-plan', 'restore-profile', 'missing-safety-backup'].includes(error.code)) resetPlan();
    } finally { busy = false; committing = false; abort = null; refresh(); }
  }
  const exportPassword = () => {
    if (!encrypt.checked) return undefined;
    requireValue([...password.value].length >= 12, 'backup-password', '加密備份密碼至少需要 12 個字元。'); return password.value;
  };
  const exportButton = action('export-backup', '匯出備份', async signal => {
    const secret = exportPassword(); const destination = await files.chooseDestination();
    await flush(); checkCancelled(signal);
    const result = await createBackup({ workspace, storage, password: secret, signal, progress });
    const saved = await destination.save({ ...result, signal, progress }); password.value = '';
    say(saved.saved ? '備份已保存並校驗。' : '已交給瀏覽器下載，請確認下載檔案已保存。');
  });
  const readButton = action('preview-restore', '驗證並預覽', async signal => {
    resetPlan(); await flush(); const file = fileInput.files[0];
    requireValue(file && file.size <= BACKUP_LIMITS.encryptedBytes, 'backup-limit', '請選擇容量上限內的 ZIP 備份。');
    loaded = await openBackup(new Uint8Array(await file.arrayBuffer()), { password: readPassword.value, signal, progress });
    plan = await prepareRestore({ workspace, document: loaded, mode: mode.value, layout: layout.checked ? 'backup' : 'preserve',
      repeat: repeat.checked, workAreas: getWorkAreas(), signal });
    const value = plan.preview; const counts = value.backup.counts;
    preview.append(node('h3', '還原預覽'), node('p', `目標：${targetName}。方式：${mode.selectedOptions[0].textContent}。`),
      node('p', `備份時間：${new Date(value.backup.createdAt).toLocaleString()}。最後成功同步：${value.backup.lastSuccessfulSyncAt ? new Date(value.backup.lastSuccessfulSyncAt).toLocaleString() : '尚無記錄'}。`),
      node('p', `包含 ${counts.cards} 張便箋、${counts.groups} 個群組、${counts.drafts} 份草稿、${counts.attachments} 個附件。`),
      node('p', `備份時有 ${value.backup.pendingOperations} 筆待同步操作、${counts.conflicts} 項衝突、${counts.pendingRevisions} 個尚缺前置資料的版本。`),
      node('p', `還原後共 ${value.result.cards} 張便箋、${value.result.groups} 個群組（含刪除區與退役群組）；新增 ${value.addedDrafts} 份草稿。原草稿保留。`));
    if (value.mode === 'replace') preview.append(node('p', `將把額外 ${value.extraCards} 張便箋移至刪除區，退休 ${value.retiredGroups} 個額外群組；歷史仍保留。`));
    if (value.result.conflicts || value.result.pendingRevisions) preview.append(node('p', `保留 ${value.result.conflicts} 項衝突與 ${value.result.pendingRevisions} 個尚缺前置資料的版本。`));
    if (value.recoveryGroup) preview.append(node('p', `新增「${value.recoveryGroup}」作為可繼續記錄的群組。`));
    if (value.ambiguousRebases) preview.append(node('p', `${value.ambiguousRebases} 條草稿轉組基線有歧義，暫停其自動延續；兩邊歷史保留。`));
    if (value.deferredPlacements) preview.append(node('p', `${value.deferredPlacements} 張便箋需先修復群組，之後才顯示在桌面。`));
    say('已驗證，尚未還原。請確認目標與模式。');
  });
  const saveSafety = action('save-safety-backup', '先保存還原前備份', async signal => {
    const secret = exportPassword(); const destination = await files.chooseDestination({ requireConfirmed: true });
    await flush(); safety = await saveSafetyBackup({ workspace, storage, save: value => destination.save({ ...value, progress }),
      password: secret, signal, progress }); password.value = '';
    requireValue(safety.binding.revision === plan.preview.revision, 'stale-restore-plan', '保存期間資料已變更，請重新預覽。');
    say('還原前備份已保存並校驗，可以確認取代。');
  });
  const confirm = action('confirm-restore', '確認還原', async signal => {
    await flush(); checkCancelled(signal); committing = true; refresh(); say('正在保存還原結果…');
    await workspace.applyRestore(plan, { safetyBackup: safety, signal,
      persist: (state, revision, attachments) => storage.saveWithAttachments(state, revision, attachments) });
    resetPlan(); await onChanged(); renderReceipts(); say('已還原到本機；草稿不會自動提交。同步狀態請查看目前來源。');
  }, 'primary');
  const cancel = node('button', '取消工作'); cancel.id = 'cancel-backup'; cancel.type = 'button'; cancel.onclick = () => { if (!committing) abort?.abort(); };
  const close = node('button', '關閉'); close.id = 'close-backup'; close.type = 'button'; close.onclick = () => dialog.close();
  function renderReceipts() {
    receiptList.replaceChildren(); const receipts = Object.values(workspace.state.restoreReceipts || {}).slice(-5).reverse();
    if (receipts.length) receiptList.append(node('h3', '最近還原結果'));
    for (const receipt of receipts) receiptList.append(node('p', `${{ import: '匯入', merge: '合併', replace: '取代' }[receipt.mode]}已存本機；新增 ${receipt.addedDrafts} 份草稿。`));
  }
  const exportHeading = node('h3', '匯出目前資料');
  const goExport = () => { exportHeading.scrollIntoView({ block: 'start', behavior: 'smooth' }); (encrypt.checked ? password : exportButton).focus({ preventScroll: true }); };
  const resetSection = node('section', undefined, 'reset-section'); resetSection.hidden = !reset;
  if (reset) {
    // A backup is one tap away from the reset, here and again in the warning.
    const backupFirst = button('先匯出備份'); backupFirst.onclick = goExport;
    const open = button('重設所有資料…', 'danger'); open.id = 'reset-data'; open.onclick = () => confirmReset(reset, goExport);
    controls.push(backupFirst, open);
    const buttons = node('div', undefined, 'reset-buttons'); buttons.append(backupFirst, open);
    resetSection.append(node('h3', '重設所有資料'), node('p', `刪除「${reset.target}」的所有便箋與設定，回到全新狀態。`, 'hint'), buttons);
  }
  dialog.append(node('h2', '資料與備份'), exportHeading, field('加密備份', encrypt, 'check'),
    field('輸出密碼（至少 12 字元；還原前安全備份也使用此密碼）', password), exportButton,
    node('h3', '從備份還原'), field('選擇 ZIP 備份', fileInput), field('此檔案的密碼（未加密可留白）', readPassword),
    field('還原方式', mode), field('套用備份版面（新匯入只套用新卡片的位置）', layout, 'check'),
    field('若曾還原這份備份，仍明確再還原一次', repeat, 'check'), readButton, preview, safetyInfo, saveSafety, message, receiptList, automaticSection.element, resetSection);
  const actions = node('div', undefined, 'dialog-actions'); actions.append(cancel, close, confirm); dialog.append(actions);
  for (const control of [mode, layout, repeat]) control.onchange = resetPlan;
  fileInput.onchange = () => { loaded = null; resetPlan(); };
  encrypt.onchange = refresh;
  dialog.oncancel = event => { if (busy) { event.preventDefault(); if (!committing) abort?.abort(); } };
  dialog.onclose = () => { password.value = ''; readPassword.value = ''; loaded = null; plan = null; safety = null; automaticSection.dispose(); dialog.remove(); };
  document.body.append(dialog); renderReceipts(); refresh(); dialog.showModal();
}
