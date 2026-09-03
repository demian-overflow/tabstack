/**
 * Bringing a window forward is not one call — a minimized window ignores
 * `focused: true` on its own and has to be restored in the same update, or the
 * tab activates invisibly behind everything and the click looks like a no-op.
 *
 * Pure so the rule is unit tested rather than rediscovered the next time a
 * window manager behaves differently.
 */

/** @param {string|undefined} windowState chrome.windows.Window['state'] */
export function focusArgs(windowState) {
  return windowState === 'minimized' ? { focused: true, state: 'normal' } : { focused: true };
}
