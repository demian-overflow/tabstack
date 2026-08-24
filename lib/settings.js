/**
 * Settings live in chrome.storage.sync, so they roam with the Chrome profile;
 * the stack itself stays in chrome.storage.local because it is device-local tab
 * state. Keyboard *bindings* live in neither — Chrome owns those, and the only
 * way to change them is chrome://extensions/shortcuts.
 *
 * Pure module: normalize() is the single validation point, unit tested.
 */

export const SETTINGS_KEY = 'settings';

export const DEFAULTS = {
  /** What the push shortcut does: 'leader' arms a chord, 'direct' stacks now. */
  mode: 'leader',
  /** How long the chord stays armed before it commits the push, in ms. */
  leaderTimeoutMs: 700,
  /** Show the on-page slot list while the chord is armed. */
  showHud: true,
  /** Alt+1..9 jump directly, without the leader. */
  altDigitJump: true,
  /** Alt+Shift+1..9 remove a slot. */
  altShiftDigitRemove: true,
  /** Confirmation bubbles on the page. */
  toasts: true,
  /** Focus an already-open tab with the same URL instead of opening a second. */
  reuseTab: true,
  /** Where a newly stacked tab lands. 'append' keeps existing slot numbers put. */
  pushPosition: 'append',
};

export const LIMITS = {
  leaderTimeoutMs: { min: 200, max: 3000 },
  mode: ['leader', 'direct'],
  pushPosition: ['append', 'top'],
};

const clamp = (n, { min, max }) => Math.min(max, Math.max(min, n));

/** Coerce anything — old versions, hand-edited storage, undefined — into a valid settings object. */
export function normalize(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULTS };

  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = input[key];
    if (value === undefined || value === null) continue;

    if (typeof fallback === 'boolean') {
      out[key] = Boolean(value);
    } else if (typeof fallback === 'number') {
      const n = Number(value);
      out[key] = Number.isFinite(n) ? Math.round(clamp(n, LIMITS[key])) : fallback;
    } else if (Array.isArray(LIMITS[key])) {
      out[key] = LIMITS[key].includes(value) ? value : fallback;
    }
  }
  return out;
}

/** Only the keys that differ from the defaults, for a compact "reset" check. */
export function diffFromDefaults(settings) {
  return Object.fromEntries(
    Object.entries(normalize(settings)).filter(([k, v]) => DEFAULTS[k] !== v),
  );
}
