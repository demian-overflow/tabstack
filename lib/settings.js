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
  /** What the push shortcut does: 'accord' arms the chord, 'direct' stacks now. */
  mode: 'accord',
  /**
   * Safety net only. The accord normally ends the moment you release Alt; this
   * caps how long it can stay armed if that release is never seen — focus moved
   * to browser UI, the page navigated, the keyup was swallowed.
   */
  accordTimeoutMs: 1500,
  /** Show the on-page slot list while the accord is held. */
  showHud: true,
  /** Alt+1..9 jump directly, without holding the accord key. */
  altDigitJump: true,
  /**
   * Alt+J, then 1..9 while Alt is still held: a jump-only accord. Releasing
   * without a digit does nothing — it never stacks. Handled in the page, so it
   * costs no Chrome binding and follows the physical key under any layout.
   */
  altJAccord: true,
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
  accordTimeoutMs: { min: 200, max: 5000 },
  mode: ['accord', 'direct'],
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
