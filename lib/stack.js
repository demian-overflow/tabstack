/**
 * Pure stack operations. No Chrome APIs in here on purpose — this module is
 * imported by the service worker, by the side panel, and by `node --test`.
 *
 * A stack is an ordered array of items. Slot numbers are 1-based and stable:
 * pushing appends to the end, so item 3 stays item 3 for as long as it lives.
 */

export const MAX_SLOTS = 9; // Alt+1 .. Alt+9

/** Compare two URLs for "same page", ignoring the fragment. */
export function sameUrl(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    ua.hash = '';
    ub.hash = '';
    return ua.href === ub.href;
  } catch {
    return false;
  }
}

export function indexOfUrl(stack, url) {
  return stack.findIndex((item) => sameUrl(item.url, url));
}

/**
 * Add a tab to the stack. Re-pushing a URL that is already stacked is a no-op
 * that refreshes the item's metadata rather than creating a duplicate, so slot
 * numbers never churn under you.
 *
 * @param {'append'|'top'} position 'append' keeps existing slots put; 'top'
 *   puts the newest at slot 1 and renumbers everything below it.
 * @returns {{stack: Array, slot: number, added: boolean}}
 */
export function push(stack, item, position = 'append') {
  const existing = indexOfUrl(stack, item.url);
  if (existing !== -1) {
    const next = stack.slice();
    next[existing] = { ...next[existing], ...item, id: next[existing].id };
    return { stack: next, slot: existing + 1, added: false };
  }
  if (position === 'top') {
    return { stack: [item].concat(stack), slot: 1, added: true };
  }
  const next = stack.concat([item]);
  return { stack: next, slot: next.length, added: true };
}

/** @param {number} slot 1-based */
export function at(stack, slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > stack.length) return null;
  return stack[slot - 1];
}

/** @param {number} slot 1-based */
export function removeAt(stack, slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > stack.length) return stack;
  const next = stack.slice();
  next.splice(slot - 1, 1);
  return next;
}

/** Move the item in `slot` by `delta` positions, clamped to the ends. */
export function move(stack, slot, delta) {
  if (!Number.isInteger(slot) || slot < 1 || slot > stack.length) return stack;
  const from = slot - 1;
  const to = Math.max(0, Math.min(stack.length - 1, from + delta));
  if (from === to) return stack;
  const next = stack.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Forget a tab id that Chrome has closed, without dropping the stack entry. */
export function detachTab(stack, tabId) {
  if (!stack.some((item) => item.tabId === tabId)) return stack;
  return stack.map((item) => (item.tabId === tabId ? { ...item, tabId: null } : item));
}

export function makeItem({ url, title, favIconUrl, tabId, now }) {
  return {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    url,
    title: title || url,
    favIconUrl: favIconUrl || null,
    tabId: tabId ?? null,
    addedAt: now,
  };
}
