// A web view's own menu offers Reload, Back and Inspect. In an app those mean nothing, and Reload throws away the running
// page. Text keeps its menu, so what is typed or selected can still be cut, copied and pasted.
const typed = 'textarea,[contenteditable="true"],input:not([type=checkbox],[type=radio],[type=range],[type=file],[type=button])';

function overSelection(doc, event) {
  const selection = doc.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
  return [...selection.getRangeAt(0).getClientRects()].some(box => event.clientX >= box.left && event.clientX <= box.right
    && event.clientY >= box.top && event.clientY <= box.bottom);
}

export function limitContextMenu(doc = document) {
  doc.addEventListener('contextmenu', event => {
    if (!event.target.closest?.(typed) && !overSelection(doc, event)) event.preventDefault();
  });
}
