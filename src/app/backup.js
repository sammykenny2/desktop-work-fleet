import { openBackup } from '../backup/payload.js';
import { createSourceBackup } from '../backup/export.js';
import { prepareRestore, prepareLocalRestore, saveSafetyBackup } from '../backup/restore.js';
import { BACKUP_LIMITS, checkCancelled } from '../backup/archive.js';
import { browserBackupFiles } from '../backup/browser-files.js';
import { requireValue } from '../core/contracts.js';
import { formatDate, plural, t } from '../i18n/index.js';
import { automaticBackupSection } from './automatic-backup.js';
import { notifications } from './notifications.js';
import { actionRow, controlRow, infoRow, settingsCard, wideRow } from './settings-row.js';

const node = (tag, text, className) => {
  const value = document.createElement(tag); if (text !== undefined) value.textContent = text;
  if (className) value.className = className; return value;
};
const input = (id, type) => { const value = node('input'); value.id = id; value.type = type; return value; };
const check = (text, control) => { const label = node('label', undefined, 'check'); label.append(control, document.createTextNode(text)); return label; };
const button = (text, className) => { const value = node('button', text, className); value.type = 'button'; return value; };

function confirmKnownData(target, error, signal) {
  return new Promise(resolve => {
    const dialog = node('dialog'); dialog.id = 'backup-known-data-dialog';
    const cancel = button(t('common.cancel')); const proceed = button(t('backup.knownData.proceed')); proceed.id = 'export-known-data';
    let accepted = false;
    const abort = () => dialog.close();
    cancel.onclick = abort; proceed.onclick = () => { accepted = true; dialog.close(); };
    dialog.onclose = () => { signal?.removeEventListener('abort', abort); dialog.remove(); resolve(accepted); };
    const actions = node('div', undefined, 'dialog-actions'); actions.append(cancel, proceed);
    dialog.append(node('h2', t('backup.knownData.title')), node('p', target), node('p', error.message),
      node('p', t('backup.knownData.body')), actions);
    document.body.append(dialog); dialog.showModal();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  });
}

const syncSummary = manifest => t('backup.syncSummary.text', {
  lastSync: manifest.lastSuccessfulSyncAt ? formatDate(manifest.lastSuccessfulSyncAt) : t('backup.syncSummary.never'),
  pending: plural('backup.count.pendingOperations', manifest.pendingOperations), drafts: plural('backup.count.drafts', manifest.counts.drafts),
  conflicts: plural('backup.count.conflicts', manifest.counts.conflicts), revisions: plural('backup.count.pendingRevisions', manifest.counts.pendingRevisions),
});

// The warning names the exact workspace, lists what goes and what stays, and keeps a way back to the export.
function confirmReset(reset, goExport) {
  const dialog = node('dialog', undefined, 'reset-dialog'); dialog.id = 'reset-data-dialog';
  const agree = input('reset-agree', 'checkbox');
  const noticeId = `reset:${reset.target}`;
  const backup = button(t('backup.reset.exportFirst')); const cancel = button(t('common.cancel'));
  const confirm = button(t('backup.reset.confirm'), 'danger'); confirm.id = 'confirm-reset-data'; confirm.disabled = true;
  let running = false;
  const settle = () => { for (const control of [agree, backup, cancel]) control.disabled = running; confirm.disabled = running || !agree.checked; };
  agree.onchange = settle;
  backup.onclick = () => { dialog.close(); goExport(); };
  cancel.onclick = () => dialog.close();
  confirm.onclick = async () => {
    if (running || !agree.checked) return;
    running = true; settle(); notifications().clear(noticeId);
    const progress = text => notifications().show(text, { id: noticeId, context: reset.target, kind: 'progress' });
    progress(t('backup.reset.running'));
    // Success reopens the page on the emptied workspace, so only a failure comes back here.
    try { await reset.run(progress); notifications().clear(noticeId); }
    catch (error) { running = false; settle(); notifications().show(error.message, { id: noticeId, context: reset.target, kind: 'error' }); }
  };
  dialog.oncancel = event => { if (running) event.preventDefault(); };
  dialog.onclose = () => dialog.remove();
  dialog.append(node('h2', t('backup.reset.confirmTitle')), node('p', reset.target, 'reset-target'),
    node('p', reset.detail ?? (reset.cloud ? t('backup.reset.deletesCloud') : t('backup.reset.deletesLocal'))),
    ...reset.cloud ? [node('p', t('backup.reset.otherDevices')), node('p', t('backup.reset.updateDevices'))] : [],
    node('p', t('backup.reset.keeps', { items: reset.keeps.join(t('backup.reset.keepsSeparator')) })),
    check(t('backup.reset.agree'), agree));
  const actions = node('div', undefined, 'dialog-actions'); actions.append(backup, cancel, confirm); dialog.append(actions);
  document.body.append(dialog); dialog.showModal();
}

/**
 * The Data and backup page: export, restore, automatic backup and the reset. It mounts inside the settings window;
 * busy() tells the window to stay open while a backup or restore is running.
 */
export function backupPanel({ workspace, storage, getWorkAreas, flush, onChanged, files = browserBackupFiles(), automatic, automaticError, reset, cloudRestore, localRestore, backupSource, foreignIds = () => null, uninstallNotice, appVersion }) {
  const google = workspace.state.profileId.startsWith('google:');
  const target = backupSource?.target || (google ? t('backup.target.google') : t('backup.target.local'));
  const panel = node('div', undefined, 'backup-panel'); panel.id = 'backup-panel';
  const noticeId = `backup:${workspace.state.profileId}`;
  const encrypt = input('backup-encrypt', 'checkbox'); encrypt.className = 'switch'; encrypt.checked = true;
  const coverage = node('select'); coverage.id = 'backup-coverage';
  coverage.append(new Option(t('backup.coverage.complete'), 'complete-retained-history'), new Option(t('backup.coverage.current'), 'current-state-only'));
  const password = input('backup-password', 'password'); password.autocomplete = 'new-password'; password.maxLength = 1024; password.placeholder = t('backup.export.passwordPlaceholder');
  const fileInput = input('restore-file', 'file'); fileInput.accept = '.zip,application/zip';
  const readPassword = input('restore-password', 'password'); readPassword.autocomplete = 'current-password'; readPassword.maxLength = 1024; readPassword.placeholder = t('backup.restore.passwordPlaceholder');
  const mode = node('select'); mode.id = 'restore-mode';
  for (const [value, label] of [['import', t('backup.restore.modeImport')], ['merge', t('backup.restore.modeMerge')], ['replace', t('backup.restore.modeReplace')]]) mode.append(new Option(label, value));
  if (cloudRestore) mode.append(new Option(t('backup.restore.modeCloudReplace'), 'cloud-replace'));
  if (!google) mode.append(new Option(t('backup.restore.modeLocalReplace'), 'local-replace'));
  const localAgree = input('restore-local-agree', 'checkbox');
  const localWarning = node('div', undefined, 'settings-row restore-warning'); localWarning.hidden = true;
  localWarning.append(node('p', t('backup.restore.localWarning', { target })),
    node('p', t('backup.restore.localOptional')), check(t('backup.restore.localAgree'), localAgree));
  const cloudAgree = input('restore-cloud-agree', 'checkbox');
  const cloudWarning = node('div', undefined, 'settings-row restore-warning'); cloudWarning.hidden = true;
  if (cloudRestore) cloudWarning.append(node('p', t('backup.restore.cloudWarning', { target: cloudRestore.target })),
    node('p', t('backup.restore.cloudBackupRequired')),
    check(t('backup.restore.cloudAgree'), cloudAgree));
  const layout = input('restore-layout', 'checkbox'); const repeat = input('restore-repeat', 'checkbox');
  const preview = node('div'); preview.id = 'restore-preview';
  const safetyInfo = node('span', t('backup.restore.safetyHint'), 'row-value');
  const receiptList = node('details'); receiptList.id = 'restore-receipts';
  const automaticSection = automaticBackupSection(automatic, automaticError, workspace.state.profileId, target);
  let busy = false; let committing = false; let abort; let loaded; let plan; let safety;
  const controls = [];
  const action = (id, text, work, className) => {
    const value = button(text, className); value.id = id; controls.push(value);
    value.onclick = () => execute(work); return value;
  };
  let progressing = false;
  const say = (text, error = false, progress = false) => {
    progressing = progress;
    notifications().show(text, { id: noticeId, context: target, kind: error ? 'error' : progress ? 'progress' : 'info',
      action: progress && !committing ? { label: t('common.cancel'), run: () => abort?.abort() } : null });
  };
  const progress = ({ phase, completed, total }) => {
    if (phase === 'save-commit') { committing = true; refresh(); say(t('backup.progress.finishing'), false, true); return; }
    const values = { completed, total };
    const names = { read: () => t('backup.progress.read', values), write: () => t('backup.progress.write', values),
      attachments: () => t('backup.progress.attachments', values), encrypt: () => t('backup.progress.encrypt', values),
      decrypt: () => t('backup.progress.decrypt', values), save: () => t('backup.progress.save', values) };
    say(Object.hasOwn(names, phase) ? names[phase]() : t('backup.progress.other', values), false, true);
  };
  const resetPlan = () => { plan = null; safety = null; cloudAgree.checked = false; localAgree.checked = false; preview.replaceChildren(); refresh(); };
  function refresh() {
    for (const control of [...controls, coverage, encrypt, password, fileInput, readPassword, mode, layout, repeat, cloudAgree, localAgree]) control.disabled = busy;
    password.disabled = busy || !encrypt.checked; passwordRow.hidden = !encrypt.checked;
    const destructive = ['replace', 'cloud-replace'].includes(mode.value);
    cloudWarning.hidden = mode.value !== 'cloud-replace';
    localWarning.hidden = mode.value !== 'local-replace';
    confirm.hidden = !plan; confirm.disabled = busy || !plan || (destructive && !safety) || (mode.value === 'cloud-replace' && !cloudAgree.checked)
      || (mode.value === 'local-replace' && !localAgree.checked);
    saveSafety.hidden = !plan || (!destructive && mode.value !== 'local-replace'); safetyRow.hidden = saveSafety.hidden;
    previewRow.hidden = !plan; confirmRow.hidden = !plan;
    saveSafety.disabled = busy || !plan || (mode.value !== 'local-replace' && !files.canConfirmSave);
    safetyInfo.textContent = mode.value === 'local-replace' ? t('backup.restore.safetyOptional')
      : destructive && !files.canConfirmSave ? t('backup.restore.safetyUnavailable') : t('backup.restore.safetyHint');
    layout.disabled = busy || mode.value === 'local-replace';
  }
  async function execute(work) {
    if (busy) return; busy = true; abort = new AbortController(); refresh(); notifications().clear(noticeId); say(t('backup.status.working'), false, true);
    try { await work(abort.signal); }
    catch (error) {
      const cancelled = error.name === 'AbortError' || ['backup-cancelled', 'export-cancelled'].includes(error.code);
      say(cancelled && error.code !== 'export-cancelled' ? t('backup.status.cancelled') : error.message, !cancelled);
      if (['stale-restore-plan', 'restore-profile', 'missing-safety-backup'].includes(error.code)) resetPlan();
    } finally { if (progressing) notifications().clear(noticeId); busy = false; committing = false; abort = null; refresh(); }
  }
  const exportPassword = () => {
    if (!encrypt.checked) return undefined;
    requireValue([...password.value].length >= 12, 'backup-password', t('backup.errors.passwordTooShort')); return password.value;
  };
  const exportButton = action('export-backup', t('backup.export.action'), async signal => {
    const secret = exportPassword(); const destination = await files.chooseDestination();
    await flush(); checkCancelled(signal);
    if (google) say(t('backup.export.syncing'), false, true);
    const result = await createSourceBackup({ workspace, storage, appVersion, coverage: coverage.value, source: backupSource, password: secret, signal, progress,
      confirmKnownData: (error, signal) => confirmKnownData(target, error, signal) });
    await result.verify?.();
    const saved = await destination.save({ ...result, signal, progress }); password.value = '';
    say(t('backup.export.result', { saved: saved.saved ? t('backup.export.saved') : t('backup.export.downloaded'), target,
      scope: t(result.manifest.coverage?.mode === 'current-state-only' ? 'backup.coverage.current' : 'backup.coverage.complete'),
      summary: syncSummary(result.manifest) }));
  }, 'primary');
  const readButton = action('preview-restore', t('backup.restore.check'), async signal => {
    resetPlan(); await flush(); const file = fileInput.files[0];
    requireValue(file && file.size <= BACKUP_LIMITS.encryptedBytes, 'backup-limit', t('backup.errors.fileTooLarge'));
    loaded = await openBackup(new Uint8Array(await file.arrayBuffer()), { password: readPassword.value, signal, progress, requireCurrent: true });
    const options = { document: loaded, layout: layout.checked || mode.value === 'local-replace' ? 'backup' : 'preserve', repeat: repeat.checked, workAreas: getWorkAreas(), signal, placeLater: true };
    plan = mode.value === 'cloud-replace' ? await cloudRestore.prepare(options)
      : mode.value === 'local-replace' ? await prepareLocalRestore({ ...options, workspace })
      : await prepareRestore({ ...options, workspace, mode: mode.value, foreignIds: foreignIds() });
    const value = plan.preview; const counts = value.backup.counts;
    const after = { notes: plural('backup.count.notes', value.result.cards), groups: plural('backup.count.groups', value.result.groups) };
    preview.append(node('p', t('backup.preview.target', { target })), node('p', t('backup.preview.contents', { date: formatDate(value.backup.createdAt),
      notes: plural('backup.count.notes', counts.cards), groups: plural('backup.count.groups', counts.groups),
      drafts: plural('backup.count.drafts', counts.drafts), attachments: plural('backup.count.attachments', counts.attachments) })),
      node('p', syncSummary(value.backup)),
      node('p', t(value.backup.coverage?.mode === 'current-state-only' ? 'backup.coverage.currentHint' : 'backup.coverage.completeHint')),
      node('p', value.mode === 'cloud-replace' ? t('backup.preview.resultCloud', after) : value.mode === 'local-replace' ? t('backup.preview.resultLocal', after)
        : t('backup.preview.resultKeepDrafts', after)));
    if (value.mode === 'local-replace') preview.append(node('p', t('backup.preview.removed', { notes: plural('backup.count.notes', value.removed.cards),
      groups: plural('backup.count.groups', value.removed.groups), drafts: plural('backup.count.drafts', value.removed.drafts),
      revisions: plural('backup.count.historyVersions', value.removed.revisions) })));
    if (value.mode === 'replace') preview.append(node('p', plural('backup.preview.extraNotes', value.extraCards)));
    if (value.result.conflicts || value.result.pendingRevisions) preview.append(node('p', plural('backup.preview.versionsToResolve', value.result.conflicts + value.result.pendingRevisions)));
    if (value.recoveryGroup) preview.append(node('p', t('backup.preview.recoveryGroup', { group: value.recoveryGroup })));
    if (value.recoveredAsNew) preview.append(node('p', t('backup.preview.recoveredAsNew', { count: value.recoveredAsNew })));
    if (value.deferredPlacements) preview.append(node('p', plural('backup.preview.deferredPlacements', value.deferredPlacements)));
    say(t('backup.restore.ready'));
  });
  const saveSafety = action('save-safety-backup', t('backup.restore.saveSafety'), async signal => {
    if (mode.value === 'local-replace' && !files.canConfirmSave) {
      const secret = exportPassword(); const destination = await files.chooseDestination();
      await flush(); checkCancelled(signal);
      const result = await createSourceBackup({ workspace, storage, appVersion, password: secret, coverage: coverage.value, signal, progress });
      await result.verify?.();
      await destination.save({ ...result, signal, progress }); password.value = '';
      say(t('backup.restore.safetyDownloaded')); return;
    }
    const secret = exportPassword(); const destination = await files.chooseDestination({ requireConfirmed: true });
    await flush(); safety = await saveSafetyBackup({ workspace, storage, appVersion, save: value => destination.save({ ...value, progress }),
      password: secret, coverage: coverage.value, signal, progress }); password.value = '';
    requireValue(safety.binding.revision === plan.preview.revision, 'stale-restore-plan', t('backup.errors.changedDuringBackup'));
    say(t('backup.restore.safetySaved'));
  });
  const confirm = action('confirm-restore', t('backup.restore.confirm'), async signal => {
    requireValue(mode.value !== 'local-replace' || localAgree.checked, 'restore-consent', t('backup.errors.localConsent'));
    await flush(); checkCancelled(signal); committing = true; refresh(); say(t('backup.restore.restoring'), false, true);
    if (mode.value === 'cloud-replace') {
      await cloudRestore.run(plan, safety, (text, { error = false, progress = true } = {}) => say(text, error, progress)); return;
    }
    if (mode.value === 'local-replace' && localRestore) await localRestore(plan, signal);
    else await workspace.applyRestore(plan, { safetyBackup: safety, signal,
      persist: (state, revision, attachments, options) => storage.saveWithAttachments(state, revision, attachments, options) });
    resetPlan(); await onChanged(); renderReceipts(); say(t('backup.restore.done'));
  }, 'primary');
  function renderReceipts() {
    receiptList.replaceChildren(node('summary', t('backup.receipt.history'))); const receipts = Object.values(workspace.state.restoreReceipts || {}).slice(-3).reverse();
    receiptList.hidden = !receipts.length;
    const texts = { import: count => plural('backup.receipt.import', count), merge: count => plural('backup.receipt.merge', count),
      replace: count => plural('backup.receipt.replace', count), 'local-replace': count => plural('backup.receipt.localReplace', count) };
    for (const receipt of receipts) if (Object.hasOwn(texts, receipt.mode)) receiptList.append(node('p', texts[receipt.mode](receipt.addedDrafts), 'hint'));
  }
  const exportSection = node('section', undefined, 'settings-block'); const exportHeading = node('h4', t('backup.export.title'), 'settings-heading');
  const passwordRow = controlRow(t('backup.export.password'), null, password);
  exportSection.append(exportHeading, node('p', t('backup.export.hint'), 'hint'), settingsCard(
    infoRow(t('backup.export.source', { target }), google ? t('backup.export.googleHint') : null),
    controlRow(t('backup.coverage.label'), t('backup.coverage.choiceHint'), coverage),
    controlRow(t('backup.export.encrypt'), null, encrypt), passwordRow, actionRow(exportButton)));
  if (uninstallNotice) exportSection.append(node('p', uninstallNotice, 'settings-note'));
  const options = node('details', undefined, 'restore-options');
  options.append(node('summary', t('backup.restore.moreOptions')), check(t('backup.restore.layout'), layout), check(t('backup.restore.repeat'), repeat));
  // The second card is the checked file's answer, and shows only once there is one.
  const previewRow = wideRow(preview), safetyRow = infoRow(safetyInfo, null, saveSafety), confirmRow = actionRow(confirm);
  safetyRow.classList.add('stack-narrow');
  const restoreSection = node('section', undefined, 'settings-block');
  restoreSection.append(node('h4', t('backup.restore.title'), 'settings-heading'), settingsCard(
    controlRow(t('backup.restore.file'), null, fileInput, { stacked: true }), controlRow(t('backup.restore.password'), null, readPassword),
    controlRow(t('backup.restore.mode'), null, mode, { stacked: true }), cloudWarning, localWarning, wideRow(options), actionRow(readButton)),
    settingsCard(previewRow, safetyRow, confirmRow), receiptList);
  const goExport = () => { exportHeading.scrollIntoView({ block: 'start', behavior: 'smooth' }); (encrypt.checked ? password : exportButton).focus({ preventScroll: true }); };
  const resetSection = node('section', undefined, 'reset-section'); resetSection.hidden = !reset;
  if (reset) {
    // A backup is one tap away from the reset, here and again in the warning.
    const backupFirst = button(t('backup.reset.exportFirst')); backupFirst.onclick = goExport;
    const open = button(t('backup.reset.open'), 'danger-outline'); open.id = 'reset-data'; open.onclick = () => confirmReset(reset, goExport);
    // A blocked reset stays disabled and says why; otherwise it follows the panel's busy state.
    if (reset.blocked) open.disabled = true; else controls.push(open);
    controls.push(backupFirst);
    const buttons = node('div', undefined, 'reset-buttons'); buttons.append(backupFirst, open);
    resetSection.append(node('h4', t('backup.reset.title'), 'settings-heading'), node('p', reset.blocked || t('backup.reset.hint', { target: reset.target }), 'hint'), buttons);
  }
  panel.append(automaticSection.element, exportSection, restoreSection, resetSection);
  mode.onchange = () => { if (mode.value === 'local-replace') layout.checked = true; resetPlan(); };
  for (const control of [layout, repeat]) control.onchange = resetPlan;
  cloudAgree.onchange = refresh;
  localAgree.onchange = refresh;
  fileInput.onchange = () => { loaded = null; resetPlan(); };
  encrypt.onchange = refresh;
  renderReceipts(); refresh();
  return {
    element: panel,
    busy: () => busy || automaticSection.busy(),
    blocksSync: () => mode.value === 'cloud-replace' && Boolean(plan),
    abort: () => { if (!committing) abort?.abort(); },
    dispose: () => { password.value = ''; readPassword.value = ''; loaded = null; plan = null; safety = null; automaticSection.dispose(); panel.remove(); },
  };
}
