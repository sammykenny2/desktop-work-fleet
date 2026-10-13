/**
 * Where adjust mode is a modal overlay, the main window steps aside only when it had the focus as adjust mode began,
 * so a window the user had minimized or left behind another app is not touched, and is not brought back afterwards.
 * Wayland does not tell an app that its window was minimized, so the focus is the one signal every host has.
 * Returns the next state and the visibility to ask the host for, or null for none.
 */
export function overlayMainStep(state, adjusting, focused) {
  if (adjusting === state.adjusting) return { state, visible: null };
  if (adjusting) return { state: { adjusting, aside: focused }, visible: focused ? false : null };
  return { state: { adjusting, aside: false }, visible: state.aside ? true : null };
}
