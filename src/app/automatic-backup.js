import { requireValue } from '../core/contracts.js';

const node = (tag, text) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; return value; };
const field = (text, control, className = 'field') => { const label = node('label', text); label.className = className; label.append(control); return label; };

export function automaticBackupSection(automatic, unavailable = null) {
  const section = node('section'); section.id = 'automatic-backup'; section.append(node('h3', '自動備份'));
  if (!automatic) {
    section.append(node('p', unavailable || '此環境尚未提供自動備份位置。'));
    return { element: section, dispose: () => {} };
  }
  const { service, files, vault } = automatic;
  const destination = node('p'); destination.id = 'auto-backup-destination';
  const status = node('p'); status.id = 'auto-backup-status'; status.setAttribute('role', 'status');
  const message = node('p'); message.id = 'auto-backup-message'; message.setAttribute('role', 'status');
  const unconfirmedFiles = node('details'); unconfirmedFiles.append(node('summary', '尚未確認的檔案（保留供檢查）'));
  const unconfirmedList = node('ul'); unconfirmedFiles.append(unconfirmedList);
  const keep = node('input'); keep.id = 'auto-backup-keep'; keep.type = 'number'; keep.min = '1'; keep.max = '90';
  const encrypted = node('input'); encrypted.id = 'auto-backup-encrypt'; encrypted.type = 'checkbox';
  const password = node('input'); password.id = 'auto-backup-password'; password.type = 'password'; password.autocomplete = 'new-password'; password.maxLength = 1024;
  const info = node('p', '有變更且距上次成功滿 24 小時才備份；啟動或恢復使用時補跑。新檔成功後才清理此排程的舊檔，換位置會保留舊檔。');
  const cryptoInfo = node('p'); let current = service.status; let chosen; let busy = false; let dirty = false;
  const retentionInfo = node('p'); retentionInfo.id = 'auto-backup-retention';
  keep.value = String(current.settings?.keep || 7); encrypted.checked = current.settings?.encrypted ?? true;
  const buttons = [];
  const report = result => {
    message.textContent = ['saved', 'recovered'].includes(result.kind) ? '本次檔案已保存並校驗。'
      : ({ disabled: '自動備份已停用。', 'not-due': '目前無需新增備份。', paused: '備份已暫停，請處理上方問題。', backoff: '正在等候重試，尚未新增備份。' }[result.kind] || '請查看目前備份狀態。');
  };
  const button = (id, text, work) => {
    const value = node('button', text); value.type = 'button'; value.id = id; buttons.push(value);
    value.onclick = async () => {
      if (busy) return; busy = true; refresh(); message.textContent = '';
      try { await work(); }
      catch (error) { message.textContent = error.name === 'AbortError' ? '已取消選擇。' : error.message; }
      finally { busy = false; refresh(); }
    };
    return value;
  };
  const choose = button('auto-backup-location', '選擇備份資料夾', async () => {
    chosen = await files.chooseDestination(); dirty = true;
  });
  const enable = button('auto-backup-enable', '保存設定並備份', async () => {
    const location = chosen || current.settings;
    requireValue(location, 'backup-location-required', '請先選擇備份資料夾。');
    let keyId = current.settings?.keyId || null;
    if (encrypted.checked) {
      requireValue(current.canEncrypt && vault, 'backup-vault-unavailable', '此環境沒有安全密碼儲存；可明確取消加密選項，或改用原生 App。');
      if (password.value || !keyId) {
        requireValue([...password.value].length >= 12, 'backup-password', '加密備份密碼至少 12 個字元。');
        keyId = await vault.create({ password: password.value }); password.value = '';
      }
    }
    await service.configure({ destinationId: location.destinationId, destinationName: location.destinationName,
      encrypted: encrypted.checked, keyId, keep: Number(keep.value) }); chosen = null; dirty = false;
    report(await service.run({ force: true }));
  });
  const run = button('auto-backup-now', '立即備份／重試', async () => {
    await files.authorize(current.settings.destinationId);
    report(await service.run({ force: true }));
  });
  const disable = button('auto-backup-disable', '停用自動備份', async () => {
    await service.disable(); message.textContent = '已停用；已保存的檔案保留。';
  });
  disable.onclick = async () => {
    if (!current.enabled) return;
    try { await service.disable(); message.textContent = '已停用；已保存的檔案保留。'; }
    catch (error) { message.textContent = error.message; }
    refresh();
  };
  function refresh() {
    const running = current.phase !== 'idle';
    for (const value of [...buttons, keep, encrypted, password]) value.disabled = busy || running;
    choose.disabled ||= !files.available || !current.canCreate; enable.disabled ||= !current.canCreate;
    keep.disabled ||= !current.canPrune;
    password.disabled ||= !encrypted.checked || !current.canEncrypt;
    run.disabled ||= !current.enabled || !current.canCreate; disable.disabled = !current.enabled;
    destination.textContent = `位置：${chosen?.destinationName || current.settings?.destinationName || '尚未選擇'}`;
    const last = current.lastSuccess ? new Date(current.lastSuccess.savedAt).toLocaleString() : '尚無成功紀錄';
    status.textContent = `${current.enabled ? (current.paused ? '已暫停，等待處理' : running ? '正在備份' : '已啟用') : '已停用'}。上次成功：${last}。`;
    if (current.error) status.textContent += ` 上次失敗：${current.error.message}`;
    const unconfirmed = [...current.inventory.filter(item => item.status === 'unconfirmed'), ...(current.pending ? [current.pending] : [])];
    if (unconfirmed.length) status.textContent += ` ${unconfirmed.length} 份檔案尚未確認，保留供檢查。`;
    unconfirmedFiles.hidden = unconfirmed.length === 0; unconfirmedList.replaceChildren();
    for (const file of unconfirmed) unconfirmedList.append(node('li', `${new Date(file.createdAt).toLocaleString()}：${file.name}`));
    cryptoInfo.textContent = current.canEncrypt ? '密碼只保存在本機安全儲存；仍請自行保管密碼，供換裝置時還原。'
      : '此瀏覽器沒有安全密碼儲存。若選擇未加密自動備份，檔案會包含可讀取的便箋與附件。';
    retentionInfo.textContent = !current.canCreate ? '此瀏覽器尚不支援自動備份，請使用上方的手動匯出。原生 App 檔案整合仍在開發。'
      : current.canPrune ? `目前保留 ${current.settings?.keep || keep.value} 份成功備份。`
      : '此環境會保留全部自動備份，保留份數尚不生效；請自行清理不需要的檔案。';
    enable.textContent = encrypted.checked ? '保存設定並加密備份' : '保存設定並以未加密檔案備份';
  }
  for (const control of [keep, encrypted, password]) control.oninput = () => { dirty = true; refresh(); };
  section.append(info, destination, choose, field('保留份數（1–90）', keep), retentionInfo, field('加密自動備份', encrypted, 'check'),
    cryptoInfo, field('加密密碼（已有密碼可留白）', password), enable, run, disable, status, unconfirmedFiles, message);
  const unsubscribe = service.subscribe(value => {
    current = value;
    if (!dirty && current.settings) { keep.value = String(current.settings.keep); encrypted.checked = current.settings.encrypted; }
    refresh();
  });
  return { element: section, dispose: () => { password.value = ''; unsubscribe(); } };
}
