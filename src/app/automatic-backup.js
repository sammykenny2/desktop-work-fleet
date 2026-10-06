import { requireValue } from '../core/contracts.js';

const node = (tag, text, className) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value; };
const field = (text, control, className = 'field') => { const label = node('label', text); label.className = className; label.append(control); return label; };
const check = (text, control) => { const label = node('label', undefined, 'check'); label.append(control, document.createTextNode(text)); return label; };

export function automaticBackupSection(automatic, unavailable = null) {
  const section = node('section', undefined, 'settings-block'); section.id = 'automatic-backup'; section.append(node('h4', '自動備份', 'settings-heading'));
  if (!automatic) {
    section.append(node('p', unavailable || '這裡不支援自動備份，請改用上方的「匯出備份」。', 'hint'));
    return { element: section, dispose: () => {} };
  }
  const { service, files, vault } = automatic;
  const status = node('p', '', 'auto-backup-state'); status.id = 'auto-backup-status'; status.setAttribute('role', 'status');
  const destination = node('span', '', 'auto-backup-place'); destination.id = 'auto-backup-destination';
  const message = node('p', '', 'backup-message'); message.id = 'auto-backup-message'; message.setAttribute('role', 'status');
  const unconfirmedFiles = node('details', undefined, 'hint'); unconfirmedFiles.append(node('summary', '還沒確認的備份檔'));
  const unconfirmedList = node('ul'); unconfirmedFiles.append(unconfirmedList);
  const keep = node('input'); keep.id = 'auto-backup-keep'; keep.type = 'number'; keep.min = '1'; keep.max = '90';
  const encrypted = node('input'); encrypted.id = 'auto-backup-encrypt'; encrypted.type = 'checkbox';
  const password = node('input'); password.id = 'auto-backup-password'; password.type = 'password'; password.autocomplete = 'new-password'; password.maxLength = 1024;
  const cryptoInfo = node('p', '', 'hint'); let current = service.status; let chosen; let busy = false; let dirty = false;
  const retentionInfo = node('p', '', 'hint'); retentionInfo.id = 'auto-backup-retention';
  keep.value = String(current.settings?.keep || 7); encrypted.checked = current.settings?.encrypted ?? true;
  const buttons = [];
  const report = result => {
    message.textContent = ['saved', 'recovered'].includes(result.kind) ? '已備份，檔案檢查無誤。'
      : ({ disabled: '自動備份已停用。', 'not-due': '今天已經備份過，沒有新的變更。', paused: '備份暫停了，請先處理上方的問題。', backoff: '稍後會自動重試。' }[result.kind] || '請查看上方的備份狀態。');
  };
  const button = (id, text, work, className) => {
    const value = node('button', text, className); value.type = 'button'; value.id = id; buttons.push(value);
    value.onclick = async () => {
      if (busy) return; busy = true; refresh(); message.textContent = '';
      try { await work(); }
      catch (error) { message.textContent = error.name === 'AbortError' ? '已取消選擇。' : error.message; }
      finally { busy = false; refresh(); }
    };
    return value;
  };
  const choose = button('auto-backup-location', '選擇資料夾', async () => {
    chosen = await files.chooseDestination(); dirty = true;
  });
  const enable = button('auto-backup-enable', '開啟自動備份', async () => {
    const location = chosen || current.settings;
    requireValue(location, 'backup-location-required', '請先選擇備份資料夾。');
    let keyId = current.settings?.keyId || null;
    if (encrypted.checked) {
      requireValue(current.canEncrypt && vault, 'backup-vault-unavailable', '這裡沒有安全密碼儲存；請取消加密，或改用 App。');
      if (password.value || !keyId) {
        requireValue([...password.value].length >= 12, 'backup-password', '加密備份密碼至少需要 12 個字元。');
        keyId = await vault.create({ password: password.value }); password.value = '';
      }
    }
    await service.configure({ destinationId: location.destinationId, destinationName: location.destinationName,
      encrypted: encrypted.checked, keyId, keep: Number(keep.value) }); chosen = null; dirty = false;
    report(await service.run({ force: true }));
  }, 'primary');
  const run = button('auto-backup-now', '立即備份', async () => {
    await files.authorize(current.settings.destinationId);
    report(await service.run({ force: true }));
  });
  const disable = button('auto-backup-disable', '停用', async () => {});
  disable.onclick = async () => {
    if (!current.enabled) return;
    try { await service.disable(); message.textContent = '自動備份已停用，之前的備份檔都還在。'; }
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
    destination.textContent = chosen?.destinationName || current.settings?.destinationName || '尚未選擇';
    const last = current.lastSuccess ? new Date(current.lastSuccess.savedAt).toLocaleString() : null;
    status.textContent = !current.enabled ? (current.settings ? '已停用' : '未開啟') : current.paused ? '已暫停' : running ? '正在備份…' : last ? `已開啟，上次備份 ${last}` : '已開啟';
    if (current.error) status.textContent += `。${current.error.message}`;
    status.classList.toggle('error', Boolean(current.paused || current.error));
    const unconfirmed = [...current.inventory.filter(item => item.status === 'unconfirmed'), ...(current.pending ? [current.pending] : [])];
    unconfirmedFiles.hidden = unconfirmed.length === 0; unconfirmedList.replaceChildren();
    for (const file of unconfirmed) unconfirmedList.append(node('li', `${new Date(file.createdAt).toLocaleString()}：${file.name}`));
    cryptoInfo.textContent = current.canEncrypt ? '密碼存在這台裝置；換裝置還原時需要它，請另外記下。'
      : '這裡沒有安全密碼儲存，自動備份只能不加密，任何人拿到檔案都能讀取。';
    retentionInfo.textContent = !current.canCreate ? '這裡不支援自動備份，請改用上方的「匯出備份」。'
      : current.canPrune ? '' : '這裡無法自動刪除舊檔，請自行清理。';
    retentionInfo.hidden = !retentionInfo.textContent;
    enable.textContent = current.enabled ? '儲存變更' : '開啟自動備份';
  }
  for (const control of [keep, encrypted, password]) control.oninput = () => { dirty = true; refresh(); };
  const place = node('div', undefined, 'auto-backup-row'); place.append(node('span', '位置', 'auto-backup-label'), destination, choose);
  const actions = node('div', undefined, 'reset-buttons'); actions.append(enable, run, disable);
  section.append(status, node('p', '有變更時每天備份一次。', 'hint'), place, field('保留份數', keep), retentionInfo,
    check('用密碼加密', encrypted), field('密碼（已設定可留白）', password), cryptoInfo, actions, unconfirmedFiles, message);
  const unsubscribe = service.subscribe(value => {
    current = value;
    if (!dirty && current.settings) { keep.value = String(current.settings.keep); encrypted.checked = current.settings.encrypted; }
    refresh();
  });
  return { element: section, dispose: () => { password.value = ''; unsubscribe(); } };
}
