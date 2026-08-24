import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, isModifierCode } from '../lib/chord.js';

test('a digit jumps to that slot', () => {
  assert.deepEqual(resolve('Digit3'), { action: 'jump', slot: 3, swallow: true });
  assert.deepEqual(resolve('Numpad7'), { action: 'jump', slot: 7, swallow: true });
});

test('shift plus a digit removes that slot', () => {
  assert.deepEqual(resolve('Digit2', { shiftKey: true }), { action: 'remove', slot: 2, swallow: true });
});

test('holding a modifier does not resolve the chord', () => {
  for (const code of ['ShiftLeft', 'ControlRight', 'AltLeft', 'MetaLeft', 'CapsLock']) {
    assert.equal(resolve(code).action, 'ignore', code);
    assert.equal(isModifierCode(code), true, code);
  }
});

test('Escape aborts, and is swallowed so the page does not also see it', () => {
  assert.deepEqual(resolve('Escape'), { action: 'abort', swallow: true });
});

test('any other key commits the push and is passed through to the page', () => {
  for (const code of ['KeyX', 'Enter', 'Space', 'Digit0', 'ArrowLeft']) {
    const out = resolve(code);
    assert.equal(out.action, 'commit', code);
    assert.equal(out.swallow, false, `${code} must reach the page`);
  }
});

test('the digit resolves the same whether or not Alt is still held', () => {
  // The accord is pressed with Alt down, so the digit arrives as Alt+3; a
  // sequence would deliver a bare 3. Both must mean the same thing.
  assert.deepEqual(resolve('Digit3', { altKey: true }), resolve('Digit3', { altKey: false }));
});

test('slot 0 is not a slot', () => {
  assert.equal(resolve('Digit0').action, 'commit');
  assert.equal(resolve('Digit0').slot, undefined);
});
