// The full editor's formatting tools. Notes are Markdown, so a tool only writes what a person could type. Each function
// takes the text and selection and returns the change to make, which leaves them testable without a page.
const LINE = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+)?(.*)$/s;

function lineRange(text, start, end) {
  const from = start > 0 ? text.lastIndexOf('\n', start - 1) + 1 : 0;
  // A selection ending at the start of a line does not reach into that line.
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const next = text.indexOf('\n', last);
  return { from, to: next < 0 ? text.length : next };
}

/** Gives the selected lines this prefix, replacing another list or heading mark; lines that all have it lose it. */
export function toggleLinePrefix(text, start, end, prefix) {
  const { from, to } = lineRange(text, start, end);
  const lines = text.slice(from, to).split('\n');
  const single = lines.length === 1;
  const written = lines.filter(line => single || line.trim());
  const carries = line => (LINE.exec(line)[2] ?? '').replace(/\[[ xX]\]/, '[ ]') === prefix;
  const removing = written.length > 0 && written.every(carries);
  const changed = lines.map(line => {
    if (!single && !line.trim()) return line;
    const [, indent, , rest] = LINE.exec(line);
    return `${indent}${removing ? '' : prefix}${rest}`;
  });
  const replacement = changed.join('\n');
  if (single) {
    // The caret stays on the same words, and never lands inside the mark.
    const [, indent, mark = '', rest] = LINE.exec(lines[0]);
    const before = indent.length + mark.length, after = changed[0].length - rest.length;
    const place = position => from + Math.max(after, position - from - before + after);
    return { from, to, replacement, selectionStart: place(start), selectionEnd: place(end) };
  }
  return { from, to, replacement, selectionStart: from, selectionEnd: from + replacement.length };
}

/** Wraps the selection in a mark such as `**`, or takes the mark off; with no selection the caret lands between two marks. */
export function toggleWrap(text, start, end, mark) {
  const size = mark.length; const selected = text.slice(start, end);
  if (selected.length >= size * 2 && selected.startsWith(mark) && selected.endsWith(mark)) {
    const replacement = selected.slice(size, -size);
    return { from: start, to: end, replacement, selectionStart: start, selectionEnd: start + replacement.length };
  }
  if (text.slice(start - size, start) === mark && text.slice(end, end + size) === mark) {
    return { from: start - size, to: end + size, replacement: selected, selectionStart: start - size, selectionEnd: end - size };
  }
  return { from: start, to: end, replacement: `${mark}${selected}${mark}`, selectionStart: start + size, selectionEnd: end + size };
}

/** Makes the change the way typing would, so Undo takes it back, and tells the page the text changed. */
export function applyTextEdit(input, edit) {
  input.focus(); input.setSelectionRange(edit.from, edit.to);
  const undoable = document.execCommand?.(edit.replacement ? 'insertText' : 'delete', false, edit.replacement);
  if (!undoable) {
    input.setRangeText(edit.replacement, edit.from, edit.to, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  input.setSelectionRange(edit.selectionStart, edit.selectionEnd);
}
