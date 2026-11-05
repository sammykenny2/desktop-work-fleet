// In-place editing, on a desktop paper or a board paper: the actions' icons, and the second press that throwing away what
// was typed takes. It asks on the paper itself: a dialog would cover the note being written, and a desktop paper's Undo
// is in a main window that may be hidden. A pair of fast clicks is one press, and anything else the user does takes the
// question back. While it asks, whatever else would be said on that line waits for the question to go.
export const editorIcons = {
  full: 'M14 4h6v6M20 4l-6 6M10 20H4v-6M4 20l6-6', cancel: 'M6 6l12 12M18 6 6 18',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 10.5v6M14 10.5v6', save: 'M5 12.5l4.5 4.5L19 7.5',
};
export const SECOND_PRESS_MS = 400;
const ASKING_MS = 4000;

export function createSecondPress({ read, write, focus, buttons }) {
  let armed = null;
  const takeBack = () => {
    if (!armed) return;
    const { previous, timer } = armed; clearTimeout(timer); armed = null;
    for (const node of buttons()) node.classList.remove('armed');
    write(previous.text, previous.error);
  };
  return {
    takeBack,
    get method() { return armed?.method ?? null; },
    /** Whatever would be said on the line while the question is on it. */
    hold(text, error = false) { if (!armed?.asking) return false; armed.previous = { text, error }; return true; },
    /** Drops the question without touching a line that is about to go. */
    forget(draftId) { if (armed && armed.draftId !== draftId) { clearTimeout(armed.timer); armed = null; } },
    /** True when this press is the answer; otherwise it asks, or was too soon to count. */
    press({ method, question, node, draftId }) {
      if (armed?.method === method) return Date.now() - armed.at >= SECOND_PRESS_MS;
      takeBack();
      armed = { method, draftId, at: Date.now(), previous: read(), timer: setTimeout(takeBack, ASKING_MS) };
      node.classList.add('armed'); write(question, true); armed.asking = true;
      // Typing must reach the text, which takes the question back, rather than press the button again with Space or Enter.
      // Whoever came to the button by keyboard stays on it.
      if (!node.matches(':focus-visible')) focus();
      return false;
    },
  };
}
