/**
 * Settings UI. Writes straight to chrome.storage.sync; the service worker and
 * every content script pick the change up through storage.onChanged, so there
 * is no reload step and no second copy of the truth.
 */
import { DEFAULTS, LIMITS, SETTINGS_KEY, normalize } from '../lib/settings.js';

const FIELDS = Object.keys(DEFAULTS);
const el = (id) => document.getElementById(id);
const status = el('status');

const MODE_HINTS = {
  accord: 'Hold Alt+S and press 1…9 to jump to that slot. Let go without pressing one and the current tab is stacked.',
  direct: 'Alt+S stacks immediately. Jumping is left to Alt+1…9.',
};

let saveTimer = null;

async function load() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  apply(normalize(stored[SETTINGS_KEY]));
  await renderCommands();
}

function apply(settings) {
  for (const key of FIELDS) {
    const input = el(key);
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = settings[key];
    else input.value = settings[key];
  }
  reflect(settings);
}

/** Keep the dependent bits of the form honest about each other. */
function reflect(settings) {
  el('mode-hint').textContent = MODE_HINTS[settings.mode];
  el('timeout-field').hidden = settings.mode !== 'accord';
  el('timeout-out').textContent = `${settings.accordTimeoutMs} ms`;
}

function collect() {
  const raw = {};
  for (const key of FIELDS) {
    const input = el(key);
    if (!input) continue;
    raw[key] = input.type === 'checkbox' ? input.checked : input.value;
  }
  return normalize(raw);
}

function onInput() {
  const settings = collect();
  reflect(settings);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(settings), 150); // coalesce slider drags
}

async function save(settings) {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  flash('Saved');
}

function flash(text) {
  status.textContent = text;
  status.classList.add('show');
  setTimeout(() => status.classList.remove('show'), 1200);
}

/** Chrome is the source of truth for bindings — show what it actually has. */
async function renderCommands() {
  const commands = await chrome.commands.getAll();
  const list = el('commands');
  list.replaceChildren(
    ...commands
      .filter((command) => command.description)
      .map((command) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = command.description;
        const keys = document.createElement('span');
        if (command.shortcut) {
          keys.className = 'keys';
          keys.textContent = command.shortcut;
        } else {
          keys.className = 'unset';
          keys.textContent = 'not set';
        }
        li.append(name, keys);
        return li;
      }),
  );
}

document.addEventListener('input', onInput);
document.addEventListener('change', onInput);

el('open-shortcuts').addEventListener('click', () => {
  // A link cannot navigate to chrome://, but the tabs API can.
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

el('reset').addEventListener('click', async () => {
  apply(DEFAULTS);
  await save({ ...DEFAULTS });
});

// Reflect edits made in another window of this page, or by a future importer.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[SETTINGS_KEY]) apply(normalize(changes[SETTINGS_KEY].newValue));
});

// Slider bounds come from the same module the service worker validates against.
el('accordTimeoutMs').min = LIMITS.accordTimeoutMs.min;
el('accordTimeoutMs').max = LIMITS.accordTimeoutMs.max;

load();
