import test from 'node:test';
import assert from 'node:assert/strict';
import { focusArgs } from '../lib/focus.js';

test('a minimized window is restored as part of the same update', () => {
  assert.deepEqual(focusArgs('minimized'), { focused: true, state: 'normal' });
});

test('every other state only asks for focus, so a maximized window stays maximized', () => {
  for (const state of ['normal', 'maximized', 'fullscreen', 'locked-fullscreen', undefined]) {
    assert.deepEqual(focusArgs(state), { focused: true }, String(state));
  }
});
