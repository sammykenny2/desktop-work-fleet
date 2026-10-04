import { summaryText } from '../core/contracts.js';

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

/** Shared conflict/history UI. Every action checks the heads shown when this view was built. */
export function showRevisionDialog({ workspace, storage, profileId, onChanged }) {
  const dialog = element('dialog', undefined, 'revision-dialog'); dialog.id = 'revision-dialog';
  const heading = element('h2', '版本與衝突');
  const message = element('p', '', 'revision-message'); message.setAttribute('role', 'status');
  const navigation = element('div', undefined, 'editor-tabs');
  const body = element('div', undefined, 'revision-body');
  let busy = false; let view = 'conflicts'; let historyKey; const urls = [];

  const action = (label, callback, className) => {
    const button = element('button', label, className); button.type = 'button';
    button.onclick = async () => {
      if (busy) return;
      busy = true; dialog.querySelectorAll('button,select').forEach(node => { node.disabled = true; });
      try { await callback(); message.textContent = ''; }
      catch (error) { message.textContent = error.message; }
      finally { busy = false; dialog.querySelectorAll('button,select').forEach(node => { node.disabled = false; }); }
    };
    return button;
  };
  const changed = async () => { try { await onChanged(); } finally { render(); } };
  const groupName = id => workspace.snapshot.groups.find(group => group.id === id)?.name || '群組尚待同步';
  const headsFor = (kind, id) => workspace.revisionHeads(kind, id).map(record => record.revisionId);

  function renderValue(record, { heads, fromHistory = false, repair = false } = {}) {
    const card = record.kind === 'card'; const value = record.value;
    const article = element('article', undefined, 'revision-option'); article.dataset.revisionId = record.revisionId;
    article.append(element('h4', card ? summaryText(value) : value.name));
    if (card) {
      const labels = [groupName(value.groupId), value.deleted ? '刪除區' : value.archived ? '封存' : value.completed ? '已完成' : '待處理'];
      article.append(element('p', labels.join(' · '), 'list-meta'));
      const text = element('pre', value.content.text, 'revision-text'); text.tabIndex = 0; article.append(text);
      if (value.content.attachments?.length) {
        const attachments = element('ul');
        for (const attachment of value.content.attachments) {
          const row = element('li');
          row.append(action(`下載附件：${attachment.name}`, async () => {
            const blob = await storage.getAttachment(profileId, attachment.id);
            if (!blob) throw new Error('附件尚未收到，原始引用仍保留，請完成同步後重試。');
            const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' })); urls.push(url);
            const anchor = element('a'); anchor.href = url; anchor.download = attachment.name; anchor.click();
          })); attachments.append(row);
        }
        article.append(attachments);
      }
    } else article.append(element('p', value.deleted ? `已合併至「${groupName(value.redirectGroupId)}」` : '使用中的群組'));
    const details = element('details'); details.append(element('summary', '版本資料'), element('code', record.revisionId));
    details.append(element('p', record.parents.length ? `承接 ${record.parents.length} 個版本` : '最初版本'));
    article.append(details);
    const apply = patch => workspace.resolveRevisions({ kind: record.kind, entityId: record.entityId,
      selectedRevision: record.revisionId, heads, patch, fromHistory });
    if (heads) {
      if (repair && !card) article.append(action('恢復此群組', async () => { await apply({ deleted: false }); await changed(); }, 'primary'));
      else if (repair && card) {
        const label = element('label', '改放到群組', 'field'); const select = element('select');
        for (const group of workspace.snapshot.groups.filter(group => !group.deleted)) select.append(new Option(group.name, group.id));
        label.append(select); article.append(label, action('保留內容並移至此組', async () => {
          if (!select.value) throw new Error('請先恢復或建立一個可用群組。');
          await apply({ groupId: select.value }); await changed();
        }, 'primary'));
      } else article.append(action(fromHistory ? '恢復為目前版本' : value.deleted ? '採用此刪除／合併版本' : '採用此版本', async () => {
        await apply({}); await changed();
      }, 'primary'));
    }
    return article;
  }

  function renderConflicts() {
    const conflicts = workspace.state.conflicts;
    if (!conflicts.length) { body.append(element('p', '目前沒有需要處理的版本。')); return; }
    body.append(element('p', '先比較內容，再選擇目前採用的版本。其他版本會保留在歷史中；未完成草稿不受影響。', 'hint'));
    for (const conflict of conflicts) {
      const section = element('section', undefined, 'revision-conflict');
      if (conflict.kind === 'revision') {
        section.append(element('h3', conflict.entityKind === 'card' ? '便箋有多個版本' : '群組有多個版本'));
        const options = element('div', undefined, 'revision-options');
        for (const record of workspace.revisionHeads(conflict.entityKind, conflict.entityId)) {
          options.append(renderValue(record, { heads: conflict.heads }));
        }
        section.append(options);
      } else if (conflict.kind === 'group-reference') {
        section.append(element('h3', conflict.reason === 'group-cycle' ? '群組合併形成循環' : '接收群組尚未收到'),
          element('p', '卡片及草稿仍保留。可等待同步補齊，或恢復這個群組。'));
        for (const record of workspace.revisionHeads('group', conflict.groupId)) {
          section.append(renderValue(record, { heads: headsFor('group', conflict.groupId), repair: true }));
        }
      } else if (conflict.kind === 'card-group') {
        section.append(element('h3', '便箋的群組需要處理'), element('p', '可先處理上方群組問題，或明確選擇另一組。'));
        for (const record of workspace.revisionHeads('card', conflict.cardId)) {
          section.append(renderValue(record, { heads: headsFor('card', conflict.cardId), repair: true }));
        }
      } else if (conflict.kind === 'group-overflow') {
        section.append(element('h3', `目前有 ${conflict.count} 個群組`), element('p', '所有資料都已保留。請在群組選單合併到最多九組，再安排桌面區域。'));
      } else if (conflict.kind === 'pending-revisions') {
        section.append(element('h3', '部分版本尚待同步補齊'), element('p', `${conflict.revisions.length} 個版本正在等待 ${conflict.missing.length} 個較早版本。現有內容與待補資料都已保留。`));
      } else if (conflict.kind === 'transfer') {
        section.append(element('h3', '先前轉組未完成'), element('p', `目的群組：${groupName(conflict.groupId)}。卡片在操作期間已更新。`));
        const card = workspace.snapshot.cards.find(card => card.id === conflict.cardId);
        if (card && !card.deleted) section.append(action('以目前版本重試轉組', async () => {
          await workspace.retryTransferIntent(conflict, card.revision); await changed();
        }));
        section.append(action('取消這次轉組意圖', async () => { await workspace.clearTransferIntent(conflict); await changed(); }));
      }
      body.append(section);
    }
  }

  function renderHistory() {
    body.append(element('p', '歷史從目前版本向較早版本顯示。恢復會建立新版本；後來的內容仍保留在歷史中。', 'hint'));
    const label = element('label', '選擇便箋或群組', 'field'); const select = element('select');
    const entities = [
      ...workspace.snapshot.cards.map(card => ({ kind: 'card', id: card.id, name: `便箋：${summaryText(card)}` })),
      ...workspace.snapshot.groups.map(group => ({ kind: 'group', id: group.id, name: `群組：${group.name}${group.deleted ? '（已合併）' : ''}` })),
    ];
    entities.forEach((entity, index) => select.append(new Option(entity.name, String(index))));
    const remembered = entities.findIndex(entity => `${entity.kind}:${entity.id}` === historyKey);
    if (remembered >= 0) select.value = String(remembered);
    label.append(select); body.append(label);
    const records = element('div'); body.append(records);
    const choose = () => {
      records.replaceChildren(); const entity = entities[Number(select.value)]; if (!entity) return;
      historyKey = `${entity.kind}:${entity.id}`;
      const history = workspace.revisionHistory(entity.kind, entity.id); const heads = headsFor(entity.kind, entity.id);
      let shown = 0;
      const more = action('顯示更早版本', async () => append());
      const append = () => {
        more.remove();
        for (const record of history.slice(shown, shown + 20)) records.append(renderValue(record, { heads, fromHistory: true }));
        shown += 20; if (shown < history.length) records.append(more);
      };
      records.append(element('p', `共 ${history.length} 個完整版本`)); append();
    };
    select.onchange = choose; choose();
  }

  function render() {
    for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    body.replaceChildren(); navigation.replaceChildren();
    const conflictTab = action('需要處理', async () => { view = 'conflicts'; render(); });
    const historyTab = action('版本歷史', async () => { view = 'history'; render(); });
    conflictTab.setAttribute('aria-pressed', String(view === 'conflicts'));
    historyTab.setAttribute('aria-pressed', String(view === 'history'));
    navigation.append(conflictTab, historyTab);
    if (view === 'conflicts') renderConflicts(); else renderHistory();
  }
  const actions = element('div', undefined, 'dialog-actions'); actions.append(action('關閉', async () => dialog.close()));
  dialog.append(heading, navigation, message, body, actions); document.body.append(dialog);
  dialog.oncancel = event => { if (busy) event.preventDefault(); };
  dialog.addEventListener('close', () => { urls.forEach(url => URL.revokeObjectURL(url)); dialog.remove(); });
  render(); dialog.showModal();
}
