import { activeGroups, summaryText } from '../core/contracts.js';
import { groupName } from '../core/group-name.js';
import { orderedGroups } from '../layout/order.js';
import { plural, t } from '../i18n/index.js';

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

/** Shared conflict/history UI. Every action checks the heads shown when this view was built. */
export function showRevisionDialog({ workspace, storage, profileId, onChanged }) {
  const dialog = element('dialog', undefined, 'revision-dialog'); dialog.id = 'revision-dialog';
  const heading = element('h2', t('conflicts.title'));
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
  const groupLabel = id => groupName(workspace.snapshot.groups.find(group => group.id === id)) || t('conflicts.version.groupPending');
  const headsFor = (kind, id) => workspace.revisionHeads(kind, id).map(record => record.revisionId);

  function renderValue(record, { heads, fromHistory = false, repair = false } = {}) {
    const card = record.kind === 'card'; const value = record.value;
    const article = element('article', undefined, 'revision-option'); article.dataset.revisionId = record.revisionId;
    article.append(element('h4', card ? summaryText(value) : groupName(value)));
    if (card) {
      const labels = [groupLabel(value.groupId), value.deleted ? t('conflicts.version.deleted') : value.archived ? t('conflicts.version.archived')
        : value.completed ? t('conflicts.version.completed') : t('conflicts.version.toDo')];
      article.append(element('p', labels.join(' · '), 'list-meta'));
      const text = element('pre', value.content.text, 'revision-text'); text.tabIndex = 0; article.append(text);
      if (value.content.attachments?.length) {
        const attachments = element('ul');
        for (const attachment of value.content.attachments) {
          const row = element('li');
          row.append(action(t('conflicts.version.downloadAttachment', { name: attachment.name }), async () => {
            const blob = await storage.getAttachment(profileId, attachment.id);
            if (!blob) throw new Error(t('conflicts.errors.attachmentMissing'));
            const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' })); urls.push(url);
            const anchor = element('a'); anchor.href = url; anchor.download = attachment.name; anchor.click();
          })); attachments.append(row);
        }
        article.append(attachments);
      }
    } else article.append(element('p', value.deleted ? t('conflicts.version.mergedInto', { group: groupLabel(value.redirectGroupId) }) : t('conflicts.version.activeGroup')));
    const details = element('details'); details.append(element('summary', t('conflicts.version.details')), element('code', record.revisionId));
    details.append(element('p', record.parents.length ? plural('conflicts.version.parents', record.parents.length) : t('conflicts.version.first')));
    article.append(details);
    const apply = patch => workspace.resolveRevisions({ kind: record.kind, entityId: record.entityId,
      selectedRevision: record.revisionId, heads, patch, fromHistory });
    if (heads) {
      if (repair && !card) article.append(action(t('conflicts.version.restoreGroup'), async () => { await apply({ deleted: false }); await changed(); }, 'primary'));
      else if (repair && card) {
        const label = element('label', t('conflicts.version.moveToGroup'), 'field'); const select = element('select');
        // Groups are offered in this device's sidebar order.
        for (const group of orderedGroups(workspace.layout.state, activeGroups(workspace.snapshot))) select.append(new Option(groupName(group), group.id));
        label.append(select); article.append(label, action(t('conflicts.version.keepAndMove'), async () => {
          if (!select.value) throw new Error(t('conflicts.errors.noGroup'));
          await apply({ groupId: select.value }); await changed();
        }, 'primary'));
      } else article.append(action(fromHistory ? t('conflicts.version.restore') : value.deleted ? t('conflicts.version.useDeleted') : t('conflicts.version.use'), async () => {
        await apply({}); await changed();
      }, 'primary'));
    }
    return article;
  }

  function renderConflicts() {
    const conflicts = workspace.state.conflicts;
    if (!conflicts.length) { body.append(element('p', t('conflicts.list.none'))); return; }
    body.append(element('p', t('conflicts.list.hint'), 'hint'));
    for (const conflict of conflicts) {
      const section = element('section', undefined, 'revision-conflict');
      if (conflict.kind === 'revision') {
        section.append(element('h3', conflict.entityKind === 'card' ? t('conflicts.revision.noteTitle') : t('conflicts.revision.groupTitle')));
        const options = element('div', undefined, 'revision-options');
        for (const record of workspace.revisionHeads(conflict.entityKind, conflict.entityId)) {
          options.append(renderValue(record, { heads: conflict.heads }));
        }
        section.append(options);
      } else if (conflict.kind === 'group-reference') {
        section.append(element('h3', conflict.reason === 'group-cycle' ? t('conflicts.groupReference.cycleTitle') : t('conflicts.groupReference.missingTitle')),
          element('p', t('conflicts.groupReference.hint')));
        for (const record of workspace.revisionHeads('group', conflict.groupId)) {
          section.append(renderValue(record, { heads: headsFor('group', conflict.groupId), repair: true }));
        }
      } else if (conflict.kind === 'card-group') {
        section.append(element('h3', t('conflicts.noteGroup.title')), element('p', t('conflicts.noteGroup.hint')));
        for (const record of workspace.revisionHeads('card', conflict.cardId)) {
          section.append(renderValue(record, { heads: headsFor('card', conflict.cardId), repair: true }));
        }
      } else if (conflict.kind === 'group-overflow') {
        section.append(element('h3', plural('conflicts.groupOverflow.title', conflict.count)), element('p', t('conflicts.groupOverflow.hint')));
      } else if (conflict.kind === 'pending-revisions') {
        section.append(element('h3', t('conflicts.pending.title')), element('p', plural('conflicts.pending.hint', conflict.revisions.length,
          { earlier: plural('conflicts.pending.earlier', conflict.missing.length) })));
      } else if (conflict.kind === 'transfer') {
        section.append(element('h3', t('conflicts.transfer.title')), element('p', t('conflicts.transfer.hint', { group: groupLabel(conflict.groupId) })));
        const card = workspace.snapshot.cards.find(card => card.id === conflict.cardId);
        if (card && !card.deleted) section.append(action(t('conflicts.transfer.retry'), async () => {
          await workspace.retryTransferIntent(conflict, card.revision); await changed();
        }));
        section.append(action(t('conflicts.transfer.cancel'), async () => { await workspace.clearTransferIntent(conflict); await changed(); }));
      }
      body.append(section);
    }
  }

  function renderHistory() {
    body.append(element('p', t('conflicts.history.hint'), 'hint'));
    const label = element('label', t('conflicts.history.choose'), 'field'); const select = element('select');
    const entities = [
      ...workspace.snapshot.cards.map(card => ({ kind: 'card', id: card.id, name: t('conflicts.history.note', { summary: summaryText(card) }) })),
      ...workspace.snapshot.groups.map(group => ({ kind: 'group', id: group.id,
        name: group.deleted ? t('conflicts.history.mergedGroup', { group: groupName(group) }) : t('conflicts.history.group', { group: groupName(group) }) })),
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
      const more = action(t('conflicts.history.more'), async () => append());
      const append = () => {
        more.remove();
        for (const record of history.slice(shown, shown + 20)) records.append(renderValue(record, { heads, fromHistory: true }));
        shown += 20; if (shown < history.length) records.append(more);
      };
      records.append(element('p', plural('conflicts.history.count', history.length))); append();
    };
    select.onchange = choose; choose();
  }

  function render() {
    for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    body.replaceChildren(); navigation.replaceChildren();
    const conflictTab = action(t('conflicts.tab.conflicts'), async () => { view = 'conflicts'; render(); });
    const historyTab = action(t('conflicts.tab.history'), async () => { view = 'history'; render(); });
    conflictTab.setAttribute('aria-pressed', String(view === 'conflicts'));
    historyTab.setAttribute('aria-pressed', String(view === 'history'));
    navigation.append(conflictTab, historyTab);
    if (view === 'conflicts') renderConflicts(); else renderHistory();
  }
  const actions = element('div', undefined, 'dialog-actions'); actions.append(action(t('common.close'), async () => dialog.close()));
  dialog.append(heading, navigation, message, body, actions); document.body.append(dialog);
  dialog.oncancel = event => { if (busy) event.preventDefault(); };
  dialog.addEventListener('close', () => { urls.forEach(url => URL.revokeObjectURL(url)); dialog.remove(); });
  render(); dialog.showModal();
}
