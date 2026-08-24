/**
 * The leader chord, as a pure decision function.
 *
 * Alt+S arms it; the next keystroke decides what happened. Keeping this
 * separate from the DOM means the interesting part — which key means what —
 * is unit tested rather than eyeballed in a browser.
 */

/** Keys that must not resolve the chord: you can hold Shift before a digit. */
export function isModifierCode(code) {
  return /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(code) || code === 'CapsLock';
}

/**
 * @param {string} code  KeyboardEvent.code — physical position, layout-proof
 * @param {{shiftKey?: boolean}} mods
 * @returns {{action: 'jump'|'remove'|'abort'|'commit'|'ignore', slot?: number, swallow: boolean}}
 *   `swallow` says whether to preventDefault: never swallow the key that merely
 *   ends the chord, or typing "s" then "x" would eat the "x".
 */
export function resolve(code, { shiftKey = false } = {}) {
  if (isModifierCode(code)) return { action: 'ignore', swallow: false };
  if (code === 'Escape') return { action: 'abort', swallow: true };

  const digit = /^Digit([1-9])$/.exec(code) || /^Numpad([1-9])$/.exec(code);
  if (digit) {
    return { action: shiftKey ? 'remove' : 'jump', slot: Number(digit[1]), swallow: true };
  }
  return { action: 'commit', swallow: false };
}
