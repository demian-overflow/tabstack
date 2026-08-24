import test from 'node:test';
import assert from 'node:assert/strict';
import { push, at, removeAt, move, detachTab, makeItem, sameUrl, indexOfUrl } from '../lib/stack.js';

const item = (url, extra = {}) => makeItem({ url, title: url, now: 1, ...extra });
const urls = (stack) => stack.map((i) => i.url);

test('sameUrl ignores the fragment but not the path', () => {
  assert.ok(sameUrl('https://a.dev/x#top', 'https://a.dev/x'));
  assert.ok(!sameUrl('https://a.dev/x', 'https://a.dev/y'));
  assert.ok(!sameUrl('https://a.dev/x', null));
  assert.ok(!sameUrl('not a url', 'also not'));
});

test('push appends and keeps slot numbers stable', () => {
  let stack = [];
  for (const url of ['https://a.dev/', 'https://b.dev/', 'https://c.dev/']) {
    const res = push(stack, item(url));
    stack = res.stack;
    assert.equal(res.added, true);
  }
  assert.deepEqual(urls(stack), ['https://a.dev/', 'https://b.dev/', 'https://c.dev/']);
  assert.equal(at(stack, 2).url, 'https://b.dev/');
});

test('re-pushing a stacked url refreshes it in place instead of duplicating', () => {
  const first = push([], item('https://a.dev/', { title: 'old' })).stack;
  const res = push(first, item('https://a.dev/#section', { title: 'new', tabId: 42 }));
  assert.equal(res.added, false);
  assert.equal(res.slot, 1);
  assert.equal(res.stack.length, 1);
  assert.equal(res.stack[0].tabId, 42);
  assert.equal(res.stack[0].id, first[0].id, 'identity survives a refresh');
});

test('push does not mutate the input stack', () => {
  const before = push([], item('https://a.dev/')).stack;
  const copy = before.slice();
  push(before, item('https://b.dev/'));
  assert.deepEqual(before, copy);
});

test('at() rejects out-of-range and non-integer slots', () => {
  const stack = push([], item('https://a.dev/')).stack;
  assert.equal(at(stack, 0), null);
  assert.equal(at(stack, 2), null);
  assert.equal(at(stack, 1.5), null);
  assert.equal(at(stack, '1'), null);
});

test('removeAt closes the gap so later slots renumber', () => {
  let stack = [];
  for (const u of ['https://a.dev/', 'https://b.dev/', 'https://c.dev/']) stack = push(stack, item(u)).stack;
  const next = removeAt(stack, 2);
  assert.deepEqual(urls(next), ['https://a.dev/', 'https://c.dev/']);
  assert.equal(removeAt(next, 9), next, 'no-op for an empty slot');
});

test('move clamps at both ends', () => {
  let stack = [];
  for (const u of ['https://a.dev/', 'https://b.dev/', 'https://c.dev/']) stack = push(stack, item(u)).stack;
  assert.deepEqual(urls(move(stack, 3, -1)), ['https://a.dev/', 'https://c.dev/', 'https://b.dev/']);
  assert.deepEqual(urls(move(stack, 1, -1)), urls(stack), 'top stays put');
  assert.deepEqual(urls(move(stack, 3, +5)), urls(stack), 'bottom stays put');
});

test('detachTab forgets a closed tab but keeps the entry', () => {
  const stack = push([], item('https://a.dev/', { tabId: 7 })).stack;
  const next = detachTab(stack, 7);
  assert.equal(next.length, 1);
  assert.equal(next[0].tabId, null);
  assert.equal(next[0].url, 'https://a.dev/');
  assert.equal(detachTab(next, 7), next, 'unchanged stacks are returned identically');
});

test('indexOfUrl reports -1 when absent', () => {
  const stack = push([], item('https://a.dev/')).stack;
  assert.equal(indexOfUrl(stack, 'https://a.dev/'), 0);
  assert.equal(indexOfUrl(stack, 'https://z.dev/'), -1);
});
