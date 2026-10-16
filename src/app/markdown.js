import DOMPurify from 'dompurify';
import { markdown } from './checklist.js';
import hljs from 'highlight.js/lib/common';

const plain = text => text.replace(/\s+/g, ' ').trim();
const highlighted = new Map();
export function highlightCode(text, language) {
  const name = language?.toLowerCase();
  if (!name || text.length > 20000 || !hljs.getLanguage(name)) return null;
  const key = `${name}\0${text}`;
  if (!highlighted.has(key)) {
    if (highlighted.size >= 64) highlighted.delete(highlighted.keys().next().value);
    highlighted.set(key, hljs.highlight(text, { language: name, ignoreIllegals: true }).value);
  }
  return highlighted.get(key);
}

// A paper already shows its title in the top band; `title` drops an opening heading or paragraph that only repeats it.
export function renderMarkdown(element, text, { onToggle, title, highlight = true } = {}) {
  const clean = DOMPurify.sanitize(markdown.parse(text), {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input'],
    ALLOWED_ATTR: ['href', 'title', 'type', 'checked', 'disabled', 'start', 'align', 'class'],
    ALLOW_DATA_ATTR: false,
  });
  const first = clean.firstElementChild;
  if (title && /^(H[1-6]|P)$/.test(first?.tagName) && plain(first.textContent) === plain(title)) first.remove();
  let colourCharacters = 0, colourBlocks = 0;
  for (const node of clean.querySelectorAll('[class]')) {
    const language = node.matches('pre > code') && /^language-([\w+-]+)$/.exec(node.className)?.[1];
    node.removeAttribute('class');
    if (!language || !highlight || text.length > 100000 || colourBlocks >= 12 || colourCharacters + node.textContent.length > 40000) continue;
    colourCharacters += node.textContent.length; colourBlocks++;
    const html = highlightCode(node.textContent, language);
    if (html !== null) node.replaceChildren(DOMPurify.sanitize(html, {
      RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'], ALLOW_DATA_ATTR: false,
    }));
  }
  for (const link of clean.querySelectorAll('a')) {
    const href = link.getAttribute('href') || '';
    if (!/^(https?:|mailto:)/i.test(href)) link.removeAttribute('href');
    link.target = '_blank'; link.rel = 'noopener noreferrer';
  }
  let index = 0;
  for (const input of clean.querySelectorAll('input')) {
    if (input.type !== 'checkbox') { input.remove(); continue; }
    const taskIndex = index++;
    input.disabled = !onToggle;
    input.setAttribute('aria-label', `步驟 ${taskIndex + 1}`);
    if (onToggle) input.addEventListener('change', () => onToggle(taskIndex));
  }
  element.replaceChildren(clean);
}
