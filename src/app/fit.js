// A paper shows as much of its text as its size allows and ends text that is cut off with "…"; nothing on it scrolls.
// Fitting only hides blocks, wraps the text of the one block that is cut and adds one mark, so it can be undone and
// run again whenever the paper changes size.

const containers = new Set(['UL', 'OL', 'BLOCKQUOTE', 'LI', 'DIV']);
const blocks = new Set([...containers, 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'TABLE', 'HR']);
// Lines can be counted in these; a table or a rule is either shown whole or hidden.
const lined = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'LI', 'BLOCKQUOTE', 'DIV']);
const shown = node => !node.classList.contains('fit-hidden');
const holdsBlocks = node => [...node.children].some(child => blocks.has(child.tagName));
const hide = node => node.classList.add('fit-hidden');

function unfitText(body) {
  for (const mark of body.querySelectorAll('.fit-more')) mark.remove();
  for (const wrap of body.querySelectorAll('.fit-lines')) wrap.replaceWith(...wrap.childNodes);
  for (const node of body.querySelectorAll('.fit-hidden')) node.classList.remove('fit-hidden');
}

// Counts the lines of a block whose text ends above the limit; text rectangles on one line overlap vertically.
function linesAbove(node, limit) {
  const range = document.createRange(); range.selectNodeContents(node);
  let lines = 0; let bottom = -Infinity;
  for (const rect of [...range.getClientRects()].filter(rect => rect.height > 0).sort((a, b) => a.top - b.top)) {
    if (rect.top < bottom - 1) { bottom = Math.max(bottom, rect.bottom); continue; }
    if (rect.bottom > limit + 0.5) break;
    lines++; bottom = rect.bottom;
  }
  return lines;
}

// Keeps the first lines of a block; the browser draws the "…" at the end of the last line it keeps.
function clampLines(node, lines) {
  const wrap = document.createElement('span'); wrap.className = 'fit-lines';
  wrap.style.setProperty('-webkit-line-clamp', String(lines));
  wrap.append(...node.childNodes); node.append(wrap);
}

// Ends the shown text inside a block whose own text fits: a "…" after its last word, or on its last line if that
// would add a line below the limit. A block without a line for it is hidden and the text ends before it.
function endIn(host, limit) {
  const mark = document.createElement('span'); mark.className = 'fit-more'; mark.textContent = '…';
  host.append(mark);
  if (host.getBoundingClientRect().bottom <= limit + 0.5) return;
  const lines = linesAbove(host, limit);
  if (lines > 0) { clampLines(host, lines); return; }
  mark.remove(); hide(host); endBefore(host, limit);
}

// Ends the text just before a hidden block: in the block shown before it, or where the hidden block was.
function endBefore(hidden, limit) {
  let host = hidden.previousElementSibling;
  while (host && !shown(host)) host = host.previousElementSibling;
  while (host && containers.has(host.tagName) && holdsBlocks(host)) {
    const last = [...host.children].filter(shown).at(-1);
    if (!last || !blocks.has(last.tagName)) break;
    host = last;
  }
  if (host && lined.has(host.tagName)) { endIn(host, limit); return; }
  if (host) { hide(host); endBefore(host, limit); return; }
  // Nothing shows before it here: a list left empty goes too, while a list item's own text takes the "…" after it.
  const parent = hidden.parentElement;
  const text = [...parent.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (!text && !parent.classList.contains('markdown') && ![...parent.children].some(shown)) { hide(parent); endBefore(parent, limit); return; }
  const mark = document.createElement('span'); mark.className = 'fit-more'; mark.textContent = '…';
  hidden.before(mark);
}

export function fitText(body) {
  unfitText(body);
  if (body.scrollHeight <= body.clientHeight + 1) return false;
  const style = getComputedStyle(body);
  const limit = body.getBoundingClientRect().top + body.clientTop + body.clientHeight - parseFloat(style.paddingBottom);
  let parent = body;
  for (;;) {
    const children = [...parent.children].filter(shown);
    const index = children.findIndex(child => child.getBoundingClientRect().bottom > limit + 0.5);
    // Only a margin or padding reaches past the limit; the text itself ends above it.
    if (index < 0) return body.querySelector('.fit-hidden') !== null;
    const cut = children[index];
    // The parent's own text, around inline elements, runs past the limit: its later blocks go and its lines are cut.
    if (!blocks.has(cut.tagName)) {
      for (const later of children.slice(index + 1)) if (blocks.has(later.tagName)) hide(later);
      const lines = parent === body ? 0 : linesAbove(parent, limit);
      if (lines > 0) clampLines(parent, lines);
      else if (parent !== body) { hide(parent); endBefore(parent, limit); }
      return true;
    }
    for (const later of children.slice(index + 1)) hide(later);
    if (containers.has(cut.tagName) && holdsBlocks(cut) && cut.getBoundingClientRect().top < limit) { parent = cut; continue; }
    // A table keeps the rows that fit and ends in its last shown cell.
    if (cut.tagName === 'TABLE') {
      const rows = [...cut.rows]; const kept = rows.filter(row => row.getBoundingClientRect().bottom <= limit + 0.5);
      if (kept.length) { for (const row of rows.slice(kept.length)) hide(row); endIn(kept.at(-1).cells[kept.at(-1).cells.length - 1], limit); }
      else { hide(cut); endBefore(cut, limit); }
      return true;
    }
    const lines = lined.has(cut.tagName) ? linesAbove(cut, limit) : 0;
    // A block whose text fits but whose padding does not still shows all of it; any text after it ends with "…".
    if (lines > 0 && lines >= linesAbove(cut, Infinity)) {
      if (body.querySelector('.fit-hidden')) endIn(cut, limit);
    } else if (lines > 0) clampLines(cut, lines);
    else { hide(cut); endBefore(cut, limit); }
    return true;
  }
}

// Attachment tiles sit in one row; a tile that wrapped onto a second row is hidden, so it cannot be seen or focused.
export function fitTiles(strip) {
  const tiles = [...strip.children];
  for (const tile of tiles) tile.classList.remove('fit-hidden-tile');
  const top = tiles[0]?.offsetTop;
  for (const tile of tiles) if (tile.offsetTop > top) tile.classList.add('fit-hidden-tile');
}

// One observer per surface fits each paper's text and tiles again whenever their size changes; an inline editor is left alone.
export function paperFitter() {
  const observer = new ResizeObserver(entries => {
    for (const { target } of entries) {
      if (!target.isConnected) continue;
      if (target.classList.contains('paper-files')) fitTiles(target);
      else if (!target.querySelector('textarea')) fitText(target);
    }
  });
  return { observe: node => observer.observe(node), unobserve: node => observer.unobserve(node), clear: () => observer.disconnect() };
}
