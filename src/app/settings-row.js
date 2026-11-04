// The cards of the settings pages, built in code the way index.html writes them out: what a row is and why on the left,
// its control on the right. Text that changes later is passed as its own element with the class it needs.
const node = (tag, text, className) => {
  const value = document.createElement(tag); if (text !== undefined) value.textContent = text;
  if (className) value.className = className; return value;
};
const textOf = (value, className) => value instanceof Node ? value : node('span', value, className);
const rowText = (label, hints) => {
  const text = node('span', undefined, 'row-text');
  text.append(textOf(label, 'row-label'), ...[hints].flat().filter(Boolean).map(hint => textOf(hint, 'row-value')));
  return text;
};

export function settingsCard(...rows) {
  const card = node('div', undefined, 'settings-list'); card.append(...rows); return card;
}

/** One control. The label is the control's name and the hint its description, so a screen reader does not read them as one name. */
export function controlRow(label, hint, control, { stacked = false } = {}) {
  const row = node('label', undefined, stacked ? 'settings-row stacked' : 'settings-row'); const text = rowText(label, hint);
  row.append(text, control); control.setAttribute('aria-label', label);
  const description = text.querySelector('.row-value');
  if (description) { description.id ||= `${control.id}-hint`; control.setAttribute('aria-describedby', description.id); }
  return row;
}

/** A statement, with the buttons that act on it if there are any. */
export function infoRow(label, hint, ...buttons) {
  const row = node('div', undefined, 'settings-row'); row.append(rowText(label, hint));
  if (buttons.length) { const actions = node('span', undefined, 'row-actions'); actions.append(...buttons); row.append(actions); }
  return row;
}

/** What a card leads to, at its end. */
export function actionRow(...buttons) {
  const row = node('div', undefined, 'settings-row row-footer'); row.append(...buttons); return row;
}

/** Anything else that takes the whole width of a row. */
export function wideRow(content, className) {
  const row = node('div', undefined, className ? `settings-row ${className}` : 'settings-row'); row.append(content); return row;
}
