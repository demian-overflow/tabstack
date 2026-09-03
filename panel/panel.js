/**
 * Side panel UI. The panel owns no state: it renders whatever is in
 * chrome.storage.local and asks the service worker to mutate it, so the
 * numbers here always match the numbers the keyboard uses.
 */
const list = document.getElementById('list');
const empty = document.getElementById('empty');

let stack = [];
let selected = 0; // 0-based index into `stack`

/**
 * The panel is shown in every window, so the worker cannot infer which one a
 * click came from — "open it here" has to name the window.
 */
const myWindow = chrome.windows.getCurrent().then((w) => w.id, () => undefined);

const REASONS = {
  'empty-slot': (p) => `Slot ${p.slot} is empty`,
  'unsupported-url': () => 'Cannot stack this page',
  'no-tab': () => 'No tab to stack',
};

/**
 * Every request reports. A jump that quietly fails — worker asleep, panel left
 * over from a previous version of the extension, slot already gone — used to
 * look exactly like a click that never registered.
 */
async function send(type, payload = {}) {
  try {
    const res = await chrome.runtime.sendMessage({ type, windowId: await myWindow, ...payload });
    if (res && res.ok === false) {
      note((REASONS[res.reason] || (() => `Could not ${type}: ${res.reason}`))(payload));
    } else {
      note('');
    }
    return res;
  } catch (err) {
    // The panel outlived the extension that opened it: its chrome.* handles are
    // dead and every further click would be a silent no-op.
    note(
      /context invalidated|Receiving end does not exist/i.test(String(err))
        ? 'Tabstack was reloaded — reopen this panel'
        : `Tabstack did not respond: ${String(err.message || err)}`,
    );
    return null;
  }
}

function note(text) {
  const el = document.getElementById('note');
  el.textContent = text;
  el.hidden = !text;
}

async function load() {
  const res = await send('get');
  stack = (res && res.stack) || [];
  render();
}

function render() {
  selected = Math.max(0, Math.min(selected, stack.length - 1));
  list.replaceChildren(...stack.map(row));
  empty.hidden = stack.length > 0;
  list.hidden = stack.length === 0;
}

function row(item, index) {
  const slot = index + 1;
  const li = document.createElement('li');
  li.className = 'row' + (index === selected ? ' selected' : '');
  li.dataset.slot = String(slot);

  const num = document.createElement('span');
  num.className = 'slot';
  num.textContent = slot <= 9 ? String(slot) : '·';

  const icon = document.createElement('img');
  icon.className = 'favicon';
  icon.alt = '';
  if (item.favIconUrl) {
    icon.src = item.favIconUrl;
    icon.addEventListener('error', () => icon.classList.add('blank'), { once: true });
  } else {
    icon.classList.add('blank');
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = item.title || item.url;
  const host = document.createElement('div');
  host.className = 'host';
  host.textContent = hostOf(item.url);
  meta.append(title, host);
  li.title = item.url;

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  actions.append(
    button('↑', 'Move up', () => act('move', { slot, delta: -1 })),
    button('↓', 'Move down', () => act('move', { slot, delta: 1 })),
    button('✕', 'Remove', () => act('remove', { slot }), 'x'),
  );

  li.append(num, icon, meta, actions);
  li.addEventListener('click', () => {
    selected = index;
    act('jump', { slot });
  });
  return li;
}

function button(label, title, onClick, className = '') {
  const el = document.createElement('button');
  el.textContent = label;
  el.title = title;
  el.className = className;
  el.addEventListener('click', (event) => {
    event.stopPropagation(); // don't also trigger the row's jump
    onClick();
  });
  return el;
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const act = (type, payload) => send(type, payload);

document.getElementById('add').addEventListener('click', () => act('push', {}));
document.getElementById('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('clear').addEventListener('click', () => {
  if (stack.length && confirm(`Remove all ${stack.length} stacked tabs?`)) act('clear', {});
});

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey) return;

  const digit = /^Digit([1-9])$/.exec(event.code);
  if (digit && !event.altKey) {
    const slot = Number(digit[1]);
    if (slot <= stack.length) {
      selected = slot - 1;
      act(event.shiftKey ? 'remove' : 'jump', { slot });
    }
    return event.preventDefault();
  }

  const step = event.code === 'ArrowDown' ? 1 : event.code === 'ArrowUp' ? -1 : 0;
  if (step) {
    if (event.altKey) act('move', { slot: selected + 1, delta: step });
    else {
      selected = Math.max(0, Math.min(stack.length - 1, selected + step));
      render();
    }
    return event.preventDefault();
  }

  if (event.code === 'Enter' && stack.length) {
    act('jump', { slot: selected + 1 });
    return event.preventDefault();
  }
  if ((event.code === 'Backspace' || event.code === 'Delete') && stack.length) {
    act('remove', { slot: selected + 1 });
    return event.preventDefault();
  }
});

// The service worker is the only writer; re-render whenever it commits.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.stack) return;
  stack = changes.stack.newValue || [];
  render();
});

load();
