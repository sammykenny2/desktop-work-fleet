import { requireValue } from '../core/contracts.js';
import { formatDate, t } from '../i18n/index.js';

const node = (tag, text, className) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value; };
const field = (text, control, className = 'field') => { const label = node('label', text); label.className = className; label.append(control); return label; };
const check = (text, control) => { const label = node('label', undefined, 'check'); label.append(control, document.createTextNode(text)); return label; };

export function automaticBackupSection(automatic, unavailable = null) {
  const section = node('section', undefined, 'settings-block'); section.id = 'automatic-backup'; section.append(node('h4', t('backup.automatic.title'), 'settings-heading'));
  if (!automatic) {
    section.append(node('p', unavailable || t('backup.automatic.unsupported'), 'hint'));
    return { element: section, dispose: () => {} };
  }
  const { service, files, vault } = automatic;
  const status = node('p', '', 'auto-backup-state'); status.id = 'auto-backup-status'; status.setAttribute('role', 'status');
  const destination = node('span', '', 'auto-backup-place'); destination.id = 'auto-backup-destination';
  const message = node('p', '', 'backup-message'); message.id = 'auto-backup-message'; message.setAttribute('role', 'status');
  const unconfirmedFiles = node('details', undefined, 'hint'); unconfirmedFiles.append(node('summary', t('backup.automatic.unconfirmedFiles')));
  const unconfirmedList = node('ul'); unconfirmedFiles.append(unconfirmedList);
  const keep = node('input'); keep.id = 'auto-backup-keep'; keep.type = 'number'; keep.min = '1'; keep.max = '90';
  const encrypted = node('input'); encrypted.id = 'auto-backup-encrypt'; encrypted.type = 'checkbox';
  const password = node('input'); password.id = 'auto-backup-password'; password.type = 'password'; password.autocomplete = 'new-password'; password.maxLength = 1024;
  const cryptoInfo = node('p', '', 'hint'); let current = service.status; let chosen; let busy = false; let dirty = false;
  const retentionInfo = node('p', '', 'hint'); retentionInfo.id = 'auto-backup-retention';
  keep.value = String(current.settings?.keep || 7); encrypted.checked = current.settings?.encrypted ?? true;
  const buttons = [];
  const report = result => {
    const texts = { disabled: () => t('backup.automatic.result.disabled'), 'not-due': () => t('backup.automatic.result.notDue'),
      paused: () => t('backup.automatic.result.paused'), backoff: () => t('backup.automatic.result.backoff') };
    message.textContent = ['saved', 'recovered'].includes(result.kind) ? t('backup.automatic.result.saved')
      : Object.hasOwn(texts, result.kind) ? texts[result.kind]() : t('backup.automatic.result.other');
  };
  const button = (id, text, work, className) => {
    const value = node('button', text, className); value.type = 'button'; value.id = id; buttons.push(value);
    value.onclick = async () => {
      if (busy) return; busy = true; refresh(); message.textContent = '';
      try { await work(); }
      catch (error) { message.textContent = error.name === 'AbortError' ? t('backup.automatic.chooseCancelled') : error.message; }
      finally { busy = false; refresh(); }
    };
    return value;
  };
  const choose = button('auto-backup-location', t('backup.automatic.chooseFolder'), async () => {
    chosen = await files.chooseDestination(); dirty = true;
  });
  const enable = button('auto-backup-enable', t('backup.automatic.enable'), async () => {
    const location = chosen || current.settings;
    requireValue(location, 'backup-location-required', t('backup.errors.folderRequired'));
    let keyId = current.settings?.keyId || null;
    if (encrypted.checked) {
      requireValue(current.canEncrypt && vault, 'backup-vault-unavailable', t('backup.errors.vaultUnavailable'));
      if (password.value || !keyId) {
        requireValue([...password.value].length >= 12, 'backup-password', t('backup.errors.passwordTooShort'));
        keyId = await vault.create({ password: password.value }); password.value = '';
      }
    }
    await service.configure({ destinationId: location.destinationId, destinationName: location.destinationName,
      encrypted: encrypted.checked, keyId, keep: Number(keep.value) }); chosen = null; dirty = false;
    report(await service.run({ force: true }));
  }, 'primary');
  const run = button('auto-backup-now', t('backup.automatic.now'), async () => {
    await files.authorize(current.settings.destinationId);
    report(await service.run({ force: true }));
  });
  const disable = button('auto-backup-disable', t('backup.automatic.disable'), async () => {});
  disable.onclick = async () => {
    if (!current.enabled) return;
    try { await service.disable(); message.textContent = t('backup.automatic.disabledKept'); }
    catch (error) { message.textContent = error.message; }
    refresh();
  };
  function refresh() {
    const running = current.phase !== 'idle';
    for (const value of [...buttons, keep, encrypted, password]) value.disabled = busy || running;
    choose.disabled ||= !files.available || !current.canCreate; enable.disabled ||= !current.canCreate;
    keep.disabled ||= !current.canPrune;
    password.disabled ||= !encrypted.checked || !current.canEncrypt;
    run.disabled ||= !current.enabled || !current.canCreate; disable.disabled = !current.enabled; disable.hidden = !current.enabled;
    destination.textContent = chosen?.destinationName || current.settings?.destinationName || t('backup.automatic.noFolder');
    const last = current.lastSuccess ? formatDate(current.lastSuccess.savedAt) : null;
    const state = !current.enabled ? (current.settings ? t('backup.automatic.state.off') : t('backup.automatic.state.notSet'))
      : current.paused ? t('backup.automatic.state.paused') : running ? t('backup.automatic.state.running')
      : last ? t('backup.automatic.state.lastBackup', { date: last }) : t('backup.automatic.state.on');
    status.textContent = current.error ? t('backup.automatic.state.withError', { state, error: current.error.message }) : state;
    status.classList.toggle('error', Boolean(current.paused || current.error));
    const unconfirmed = [...current.inventory.filter(item => item.status === 'unconfirmed'), ...(current.pending ? [current.pending] : [])];
    unconfirmedFiles.hidden = unconfirmed.length === 0; unconfirmedList.replaceChildren();
    for (const file of unconfirmed) unconfirmedList.append(node('li', t('backup.automatic.unconfirmedItem', { date: formatDate(file.createdAt), name: file.name })));
    cryptoInfo.textContent = current.canEncrypt ? t('backup.automatic.passwordStored') : t('backup.automatic.noVault');
    retentionInfo.textContent = !current.canCreate ? t('backup.automatic.unsupported')
      : current.canPrune ? '' : t('backup.automatic.noPrune');
    retentionInfo.hidden = !retentionInfo.textContent;
    enable.textContent = current.enabled ? t('backup.automatic.save') : t('backup.automatic.enable');
  }
  for (const control of [keep, encrypted, password]) control.oninput = () => { dirty = true; refresh(); };
  const place = node('div', undefined, 'auto-backup-row'); place.append(node('span', t('backup.automatic.location'), 'auto-backup-label'), destination, choose);
  const actions = node('div', undefined, 'reset-buttons'); actions.append(enable, run, disable);
  section.append(status, node('p', t('backup.automatic.hint'), 'hint'), place, field(t('backup.automatic.keep'), keep), retentionInfo,
    check(t('backup.automatic.encrypt'), encrypted), field(t('backup.automatic.password'), password), cryptoInfo, actions, unconfirmedFiles, message);
  const unsubscribe = service.subscribe(value => {
    current = value;
    if (!dirty && current.settings) { keep.value = String(current.settings.keep); encrypted.checked = current.settings.encrypted; }
    refresh();
  });
  return { element: section, dispose: () => { password.value = ''; unsubscribe(); } };
}
