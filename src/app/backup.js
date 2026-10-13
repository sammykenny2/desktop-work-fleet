import { openBackup } from '../backup/payload.js';
import { createSourceBackup } from '../backup/export.js';
import { prepareRestore, prepareLocalRestore, saveSafetyBackup } from '../backup/restore.js';
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
const check = (text, control) => { const label = node('label', undefined, 'check'); label.append(control, document.createTextNode(text)); return label; };
const button = (text, className) => { const value = node('button', text, className); value.type = 'button'; return value; };
const LOST = '所有便箋（含已完成、封存與刪除區）、群組、未完成草稿、附件、版本歷史、桌面佈局、快捷鍵與自動備份設定';

function confirmKnownData(target, error, signal) {
  return new Promise(resolve => {
    const dialog = node('dialog'); dialog.id = 'backup-known-data-dialog';
    const cancel = button('取消'); const proceed = button('只備份這台已知資料'); proceed.id = 'export-known-data';
    let accepted = false;
    const abort = () => dialog.close();
    cancel.onclick = abort; proceed.onclick = () => { accepted = true; dialog.close(); };
    dialog.onclose = () => { signal?.removeEventListener('abort', abort); dialog.remove(); resolve(accepted); };
    dialog.append(node('h2', 'Google 同步未完成'), node('p', target), node('p', error.message),
      node('p', '這份備份只能包含這台裝置已知的資料與草稿，可能缺少其他裝置的最新修改。'), cancel, proceed);
    document.body.append(dialog); dialog.showModal();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  });
}

const syncSummary = manifest => `最後成功同步：${manifest.lastSuccessfulSyncAt ? new Date(manifest.lastSuccessfulSyncAt).toLocaleString() : '沒有紀錄'}；${manifest.pendingOperations} 筆待同步、${manifest.counts.drafts} 份草稿、${manifest.counts.conflicts} 個衝突、${manifest.counts.pendingRevisions} 個待補版本。`;

// The warning names the exact workspace, lists what goes and what stays, and keeps a way back to the export.
function confirmReset(reset, goExport) {
  const dialog = node('dialog', undefined, 'reset-dialog'); dialog.id = 'reset-data-dialog';
  const agree = input('reset-agree', 'checkbox');
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
  dialog.append(node('h2', '重設所有資料？'), node('p', reset.target, 'reset-target'),
    node('p', `會永久刪除${reset.cloud ? '這台裝置與 Google 雲端上' : '這台裝置上'}的${LOST}。`),
    ...reset.cloud ? [node('p', '登入這個 Google 帳號的其他裝置，下次同步時會詢問要不要清除自己的副本。')] : [],
    node('p', `不受影響：${reset.keeps.join('、')}。`),
    check('我了解刪除後無法復原', agree), state);
  const actions = node('div', undefined, 'dialog-actions'); actions.append(backup, cancel, confirm); dialog.append(actions);
  document.body.append(dialog); dialog.showModal();
}

/**
 * The 資料與備份 page: export, restore, automatic backup and the reset. It mounts inside the settings window;
 * busy() tells the window to stay open while a backup or restore is running.
 */
export function backupPanel({ workspace, storage, getWorkAreas, flush, onChanged, files = browserBackupFiles(), automatic, automaticError, reset, cloudRestore, localRestore, backupSource, uninstallNotice, appVersion }) {
  const google = workspace.state.profileId.startsWith('google:');
  const target = backupSource?.target || (google ? '目前 Google 帳號的工作空間' : '本機便箋（這台裝置）');
  const panel = node('div', undefined, 'backup-panel'); panel.id = 'backup-panel';
  const message = node('p', '', 'backup-message');
  message.id = 'backup-status'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const encrypt = input('backup-encrypt', 'checkbox'); encrypt.checked = true;
  const password = input('backup-password', 'password'); password.autocomplete = 'new-password'; password.maxLength = 1024; password.placeholder = '至少 12 個字元';
  const fileInput = input('restore-file', 'file'); fileInput.accept = '.zip,application/zip';
  const readPassword = input('restore-password', 'password'); readPassword.autocomplete = 'current-password'; readPassword.maxLength = 1024; readPassword.placeholder = '沒有加密可留白';
  const mode = node('select'); mode.id = 'restore-mode';
  for (const [value, label] of [['import', '加入成新的便箋'], ['merge', '與目前的便箋合併'], ['replace', '取代目前的便箋']]) mode.append(new Option(label, value));
  if (cloudRestore) mode.append(new Option('清空 Google 後，從備份還原', 'cloud-replace'));
  if (!google) mode.append(new Option('清空本機後，從備份還原', 'local-replace'));
  const localAgree = input('restore-local-agree', 'checkbox');
  const localWarning = node('div'); localWarning.hidden = true;
  localWarning.append(node('p', `會以備份完整取代${target}的便箋、群組、歷史、草稿、附件與版面。舊內容不會留在刪除區；Google 雲端與其他工作空間不受影響。`),
    node('p', '備份目前資料是可選的；自動備份設定與已保存的 ZIP 檔會保留。'), check('我了解目前本機內容會永久被備份取代', localAgree));
  const cloudAgree = input('restore-cloud-agree', 'checkbox');
  const cloudWarning = node('div'); cloudWarning.hidden = true;
  if (cloudRestore) cloudWarning.append(node('p', `將永久清空 ${cloudRestore.target} 的所有 Work Fleet 雲端便箋、群組、歷史與附件，再還原這份備份。其他裝置請先停止同步。`),
    node('p', '目前資料必須先匯出備份。備份中的草稿只還原到這台裝置，不會自動發布。'),
    check('我了解這會永久清空 Google 的 Work Fleet 資料', cloudAgree));
  const layout = input('restore-layout', 'checkbox'); const repeat = input('restore-repeat', 'checkbox');
  const preview = node('div'); preview.id = 'restore-preview';
  const safetyInfo = node('p', '取代前，先把目前的資料存一份備份。', 'hint');
  const receiptList = node('div'); receiptList.id = 'restore-receipts';
  const automaticSection = automaticBackupSection(automatic, automaticError);
  let busy = false; let committing = false; let abort; let loaded; let plan; let safety;
  const controls = [];
  const action = (id, text, work, className) => {
    const value = button(text, className); value.id = id; controls.push(value);
    value.onclick = () => execute(work); return value;
  };
  const say = (text, error = false) => { message.textContent = text; message.classList.toggle('error', error); };
  const progress = ({ phase, completed, total }) => {
    if (phase === 'save-commit') { committing = true; refresh(); say('正在完成保存…'); return; }
    const names = { read: '讀取檔案', write: '整理資料', attachments: '讀取附件', encrypt: '加密', decrypt: '解密', save: '保存檔案' };
    say(`${names[phase] || '處理中'}：${completed} / ${total}`);
  };
  const resetPlan = () => { plan = null; safety = null; cloudAgree.checked = false; localAgree.checked = false; preview.replaceChildren(); refresh(); };
  function refresh() {
    for (const control of [...controls, encrypt, password, fileInput, readPassword, mode, layout, repeat, cloudAgree, localAgree]) control.disabled = busy;
    password.disabled = busy || !encrypt.checked;
    const destructive = ['replace', 'cloud-replace'].includes(mode.value);
    cloudWarning.hidden = mode.value !== 'cloud-replace';
    localWarning.hidden = mode.value !== 'local-replace';
    confirm.hidden = !plan; confirm.disabled = busy || !plan || (destructive && !safety) || (mode.value === 'cloud-replace' && !cloudAgree.checked)
      || (mode.value === 'local-replace' && !localAgree.checked);
    saveSafety.hidden = !plan || (!destructive && mode.value !== 'local-replace'); safetyInfo.hidden = saveSafety.hidden;
    saveSafety.disabled = busy || !plan || (mode.value !== 'local-replace' && !files.canConfirmSave);
    cancel.hidden = !busy; cancel.disabled = committing;
    safetyInfo.textContent = mode.value === 'local-replace' ? '可以直接確認還原；需要保留舊內容時，再選擇先備份。'
      : destructive && !files.canConfirmSave ? '這裡無法確認備份已保存，所以不能取代；請改用 App。' : '取代前，先把目前的資料存一份備份。';
    layout.disabled = busy || mode.value === 'local-replace';
  }
  async function execute(work) {
    if (busy) return; busy = true; abort = new AbortController(); refresh(); say('正在處理…');
    try { await work(abort.signal); }
    catch (error) {
      say(error.name === 'AbortError' || error.code === 'backup-cancelled' ? '已取消。' : error.message, true);
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
    if (google) say('正在同步 Google，完成後匯出備份…');
    const result = await createSourceBackup({ workspace, storage, appVersion, source: backupSource, password: secret, signal, progress,
      confirmKnownData: (error, signal) => confirmKnownData(target, error, signal) });
    const saved = await destination.save({ ...result, signal, progress }); password.value = '';
    say(`${saved.saved ? '備份已保存，檔案檢查無誤。' : '已交給瀏覽器下載，請確認檔案已保存。'} ${target}；${google ? result.knownDataOnly ? '僅含這台已知副本，Google 同步未完成。' : '包含本次同步取得的雲端便箋，以及這台的草稿；不含其他裝置尚未上傳的內容。' : '本機完整已知資料。'} ${syncSummary(result.manifest)}`);
  }, 'primary');
  const readButton = action('preview-restore', '檢查檔案', async signal => {
    resetPlan(); await flush(); const file = fileInput.files[0];
    requireValue(file && file.size <= BACKUP_LIMITS.encryptedBytes, 'backup-limit', '請選擇容量上限內的 ZIP 備份。');
    loaded = await openBackup(new Uint8Array(await file.arrayBuffer()), { password: readPassword.value, signal, progress });
    const options = { document: loaded, layout: layout.checked || mode.value === 'local-replace' ? 'backup' : 'preserve', repeat: repeat.checked, workAreas: getWorkAreas(), signal };
    plan = mode.value === 'cloud-replace' ? await cloudRestore.prepare(options)
      : mode.value === 'local-replace' ? await prepareLocalRestore({ ...options, workspace })
      : await prepareRestore({ ...options, workspace, mode: mode.value });
    const value = plan.preview; const counts = value.backup.counts;
    preview.append(node('p', `還原目標：${target}`), node('p', `${new Date(value.backup.createdAt).toLocaleString()} 的備份，包含 ${counts.cards} 張便箋、${counts.groups} 個群組、${counts.drafts} 份草稿、${counts.attachments} 個附件。`),
      node('p', syncSummary(value.backup)),
      node('p', `還原後共 ${value.result.cards} 張便箋、${value.result.groups} 個群組；${value.mode === 'cloud-replace' ? '目前的草稿只留在取代前備份中。' : value.mode === 'local-replace' ? '只保留備份中的草稿與歷史。' : '目前的草稿都會保留。'}`));
    if (value.mode === 'local-replace') preview.append(node('p', `將清除目前 ${value.removed.cards} 張便箋、${value.removed.groups} 個群組、${value.removed.drafts} 份草稿與 ${value.removed.revisions} 個歷史版本，再還原備份。`));
    if (value.mode === 'replace') preview.append(node('p', `目前多出的 ${value.extraCards} 張便箋會移到刪除區，可以再還原。`));
    if (value.result.conflicts || value.result.pendingRevisions) preview.append(node('p', `有 ${value.result.conflicts + value.result.pendingRevisions} 個版本需要之後在「版本與衝突」處理。`));
    if (value.recoveryGroup) preview.append(node('p', `會新增「${value.recoveryGroup}」群組。`));
    if (value.deferredPlacements) preview.append(node('p', `${value.deferredPlacements} 張便箋要等群組整理好才會出現在桌面。`));
    say('檔案可以還原，確認內容後按「確認還原」。');
  });
  const saveSafety = action('save-safety-backup', '先備份目前資料', async signal => {
    if (mode.value === 'local-replace' && !files.canConfirmSave) {
      const secret = exportPassword(); const destination = await files.chooseDestination();
      await flush(); checkCancelled(signal);
      const result = await createSourceBackup({ workspace, storage, appVersion, password: secret, signal, progress });
      await destination.save({ ...result, signal, progress }); password.value = '';
      say('已交給瀏覽器下載目前資料，請確認檔案已保存；這不影響本機完整還原的確認。'); return;
    }
    const secret = exportPassword(); const destination = await files.chooseDestination({ requireConfirmed: true });
    await flush(); safety = await saveSafetyBackup({ workspace, storage, appVersion, save: value => destination.save({ ...value, progress }),
      password: secret, signal, progress }); password.value = '';
    requireValue(safety.binding.revision === plan.preview.revision, 'stale-restore-plan', '備份期間資料有變更，請重新檢查檔案。');
    say('已備份目前資料，可以確認取代。');
  });
  const confirm = action('confirm-restore', '確認還原', async signal => {
    requireValue(mode.value !== 'local-replace' || localAgree.checked, 'restore-consent', '請先確認永久取代目前本機內容。');
    await flush(); checkCancelled(signal); committing = true; refresh(); say('正在還原…');
    if (mode.value === 'cloud-replace') { await cloudRestore.run(plan, safety, say); return; }
    if (mode.value === 'local-replace' && localRestore) await localRestore(plan, signal);
    else await workspace.applyRestore(plan, { safetyBackup: safety, signal,
      persist: (state, revision, attachments, options) => storage.saveWithAttachments(state, revision, attachments, options) });
    resetPlan(); await onChanged(); renderReceipts(); say('已還原。草稿不會自動送出，需要時請從「未完成草稿」繼續。');
  }, 'primary');
  const cancel = button('取消'); cancel.id = 'cancel-backup'; cancel.onclick = () => { if (!committing) abort?.abort(); };
  function renderReceipts() {
    receiptList.replaceChildren(); const receipts = Object.values(workspace.state.restoreReceipts || {}).slice(-3).reverse();
    for (const receipt of receipts) receiptList.append(node('p', `最近一次${{ import: '加入', merge: '合併', replace: '取代', 'local-replace': '清空本機後' }[receipt.mode]}還原新增了 ${receipt.addedDrafts} 份草稿。`, 'hint'));
  }
  const exportSection = node('section', undefined, 'settings-block'); const exportHeading = node('h4', '匯出備份', 'settings-heading');
  exportSection.append(exportHeading, node('p', `備份來源：${target}`, 'hint'),
    node('p', '把便箋、群組、草稿與附件存成一個 ZIP 檔。本機與 Google 使用相同格式，可以互相還原。', 'hint'),
    ...google ? [node('p', '匯出前會同步 Google；備份含本次同步取得的雲端便箋與這台的草稿。其他裝置未上傳的內容與草稿不會包含。', 'hint')] : [],
    check('用密碼加密', encrypt), field('密碼', password), exportButton);
  if (uninstallNotice) exportSection.append(node('p', uninstallNotice, 'hint'));
  const options = node('details', undefined, 'restore-options');
  options.append(node('summary', '更多選項'), check('一併還原桌面位置', layout), check('這份備份還原過也照樣還原', repeat));
  const restoreSection = node('section', undefined, 'settings-block');
  restoreSection.append(node('h4', '從備份還原', 'settings-heading'), field('備份檔案', fileInput), field('檔案密碼', readPassword),
    field('還原方式', mode), cloudWarning, localWarning, options, readButton, preview, safetyInfo, saveSafety, confirm, receiptList);
  const goExport = () => { exportHeading.scrollIntoView({ block: 'start', behavior: 'smooth' }); (encrypt.checked ? password : exportButton).focus({ preventScroll: true }); };
  const resetSection = node('section', undefined, 'reset-section'); resetSection.hidden = !reset;
  if (reset) {
    // A backup is one tap away from the reset, here and again in the warning.
    const backupFirst = button('先匯出備份'); backupFirst.onclick = goExport;
    const open = button('重設所有資料…', 'danger'); open.id = 'reset-data'; open.onclick = () => confirmReset(reset, goExport);
    // A blocked reset stays disabled and says why; otherwise it follows the panel's busy state.
    if (reset.blocked) open.disabled = true; else controls.push(open);
    controls.push(backupFirst);
    const buttons = node('div', undefined, 'reset-buttons'); buttons.append(backupFirst, open);
    resetSection.append(node('h4', '重設所有資料', 'settings-heading'), node('p', reset.blocked || `刪除${reset.target}的所有資料，回到全新狀態。`, 'hint'), buttons);
  }
  const status = node('div', undefined, 'backup-status-bar'); status.append(message, cancel);
  panel.append(status, exportSection, restoreSection, automaticSection.element, resetSection);
  mode.onchange = () => { if (mode.value === 'local-replace') layout.checked = true; resetPlan(); };
  for (const control of [layout, repeat]) control.onchange = resetPlan;
  cloudAgree.onchange = refresh;
  localAgree.onchange = refresh;
  fileInput.onchange = () => { loaded = null; resetPlan(); };
  encrypt.onchange = refresh;
  renderReceipts(); refresh();
  return {
    element: panel,
    busy: () => busy,
    blocksSync: () => mode.value === 'cloud-replace' && Boolean(plan),
    abort: () => { if (!committing) abort?.abort(); },
    dispose: () => { password.value = ''; readPassword.value = ''; loaded = null; plan = null; safety = null; automaticSection.dispose(); panel.remove(); },
  };
}
