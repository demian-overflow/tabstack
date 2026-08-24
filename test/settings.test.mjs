import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, LIMITS, normalize, diffFromDefaults } from '../lib/settings.js';

test('normalize fills in a missing or junk object with the defaults', () => {
  assert.deepEqual(normalize(undefined), DEFAULTS);
  assert.deepEqual(normalize(null), DEFAULTS);
  assert.deepEqual(normalize('nope'), DEFAULTS);
  assert.deepEqual(normalize({}), DEFAULTS);
});

test('normalize clamps the chord window to its documented range', () => {
  assert.equal(normalize({ leaderTimeoutMs: 50 }).leaderTimeoutMs, LIMITS.leaderTimeoutMs.min);
  assert.equal(normalize({ leaderTimeoutMs: 99999 }).leaderTimeoutMs, LIMITS.leaderTimeoutMs.max);
  assert.equal(normalize({ leaderTimeoutMs: 850 }).leaderTimeoutMs, 850);
});

test('normalize coerces the string a range input hands back', () => {
  assert.equal(normalize({ leaderTimeoutMs: '450' }).leaderTimeoutMs, 450);
  assert.equal(normalize({ leaderTimeoutMs: '450.6' }).leaderTimeoutMs, 451);
  assert.equal(normalize({ leaderTimeoutMs: 'abc' }).leaderTimeoutMs, DEFAULTS.leaderTimeoutMs);
});

test('normalize rejects enum values that are not offered', () => {
  assert.equal(normalize({ mode: 'direct' }).mode, 'direct');
  assert.equal(normalize({ mode: 'telepathy' }).mode, DEFAULTS.mode);
  assert.equal(normalize({ pushPosition: 'top' }).pushPosition, 'top');
  assert.equal(normalize({ pushPosition: 'sideways' }).pushPosition, DEFAULTS.pushPosition);
});

test('normalize drops unknown keys rather than storing them', () => {
  const out = normalize({ mode: 'direct', nonsense: 42 });
  assert.equal('nonsense' in out, false);
  assert.deepEqual(Object.keys(out).sort(), Object.keys(DEFAULTS).sort());
});

test('booleans survive checkbox-ish input', () => {
  assert.equal(normalize({ toasts: false }).toasts, false);
  assert.equal(normalize({ toasts: 0 }).toasts, false);
  assert.equal(normalize({ toasts: 'yes' }).toasts, true);
});

test('diffFromDefaults reports only what the user changed', () => {
  assert.deepEqual(diffFromDefaults(DEFAULTS), {});
  assert.deepEqual(diffFromDefaults({ mode: 'direct' }), { mode: 'direct' });
});
