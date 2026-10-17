import { Marked } from 'marked';
import { FleetError } from '../core/contracts.js';
import { t } from '../i18n/index.js';

const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export const markdown = new Marked({ gfm: true, breaks: false,
  renderer: { html: ({ text }) => escapeHtml(text) } });

function tasks(text) {
  const found = [];
  markdown.walkTokens(markdown.lexer(text), token => {
    if (token.type === 'list_item' && token.task) found.push({ checked: token.checked });
  });
  return found;
}

/** Done and total checklist steps, counted from parsed GFM tasks like toggleChecklist. */
export function checklistProgress(text) {
  const found = tasks(text);
  return { done: found.filter(task => task.checked).length, total: found.length };
}

// Confirm a source-character edit against parsed GFM tasks, so code blocks and escaped lookalikes never toggle.
export function toggleChecklist(text, taskIndex) {
  const original = tasks(text);
  if (!Number.isInteger(taskIndex) || !original[taskIndex]) throw new FleetError('missing-task', t('notes.errors.taskMissing'));
  const expected = original.map((task, index) => ({ ...task, checked: index === taskIndex ? !task.checked : task.checked }));
  for (const match of text.matchAll(/\[[ xX]\]/g)) {
    const offset = match.index + 1;
    const changed = text.slice(0, offset) + (original[taskIndex].checked ? ' ' : 'x') + text.slice(offset + 1);
    if (JSON.stringify(tasks(changed)) === JSON.stringify(expected)) return changed;
  }
  throw new FleetError('task-changed', t('notes.errors.taskChanged'));
}
