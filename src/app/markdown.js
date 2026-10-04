import DOMPurify from 'dompurify';
import { markdown } from './checklist.js';

export function renderMarkdown(element, text, { onToggle } = {}) {
  const clean = DOMPurify.sanitize(markdown.parse(text), {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input'],
    ALLOWED_ATTR: ['href', 'title', 'type', 'checked', 'disabled', 'start', 'align'],
    ALLOW_DATA_ATTR: false,
  });
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
