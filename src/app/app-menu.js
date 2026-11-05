// A small menu of the app's own, where a web view would show its menu: at the pointer for a right click, under a button
// otherwise, and along the bottom edge on a phone, where a thumb reaches it (see style.css).
let active = null;

export function closeAppMenu() {
  if (!active) return false;
  active(); return true;
}

export function openAppMenu(items, where) {
  closeAppMenu();
  const opener = where instanceof Element ? where : document.activeElement;
  const menu = document.createElement('div'); menu.className = 'app-menu'; menu.setAttribute('role', 'menu');
  const close = ({ refocus = true } = {}) => {
    if (active !== close) return; active = null; menu.remove();
    document.removeEventListener('pointerdown', outside, true); removeEventListener('resize', atPointer);
    if (refocus && opener?.isConnected) opener.focus({ preventScroll: true });
  };
  const dismiss = () => close({ refocus: false });
  const outside = event => { if (!menu.contains(event.target)) dismiss(); };
  // A resize moves what the menu points at. Along a phone's bottom edge it stays right, and a keyboard going away, as
  // focus moves to the menu, resizes the page.
  const atPointer = () => { if (innerWidth > 640) dismiss(); };
  for (const item of items) {
    const node = document.createElement('button'); node.type = 'button'; node.setAttribute('role', 'menuitem'); node.textContent = item.label;
    if (item.danger) node.classList.add('danger-item');
    node.onclick = () => { close(); item.action(); };
    menu.append(node);
  }
  const moveFocus = step => {
    const nodes = [...menu.querySelectorAll('button')]; if (!nodes.length) return;
    const at = nodes.indexOf(document.activeElement); nodes[(at + step + nodes.length) % nodes.length].focus();
  };
  menu.onkeydown = event => {
    if (event.key === 'ArrowDown') moveFocus(1);
    else if (event.key === 'ArrowUp') moveFocus(-1);
    else if (event.key === 'Escape') close();
    else if (event.key === 'Tab') close();
    else return;
    event.preventDefault(); event.stopPropagation();
  };
  // A modal dialog keeps everything else inert, so the menu has to sit inside it.
  ([...document.querySelectorAll('dialog:modal')].at(-1) ?? document.body).append(menu);
  if (innerWidth > 640) {
    const box = where instanceof Element ? where.getBoundingClientRect() : { left: where.x, bottom: where.y };
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`;
    menu.style.top = `${box.bottom + height + 8 > innerHeight ? Math.max(8, innerHeight - height - 8) : box.bottom}px`;
  }
  active = close;
  document.addEventListener('pointerdown', outside, true); addEventListener('resize', atPointer);
  menu.querySelector('button')?.focus({ preventScroll: true });
  return menu;
}
