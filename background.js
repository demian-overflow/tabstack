/**
 * Service worker: owns the stack in chrome.storage.local, the settings cache
 * from chrome.storage.sync, and the leader-chord timer. It is the only place
 * that talks to the Tabs API, so the keyboard and the panel can never disagree.
 */
import { push, at, removeAt, move, detachTab, makeItem, sameUrl, MAX_SLOTS } from './lib/stack.js';
import { DEFAULTS, SETTINGS_KEY, normalize } from './lib/settings.js';

const KEY = 'stack';

/* ------------------------------------------------------------------ state */

async function getStack() {
  const { [KEY]: stack } = await chrome.storage.local.get(KEY);
  return Array.isArray(stack) ? stack : [];
}

async function setStack(stack) {
  await chrome.storage.local.set({ [KEY]: stack });
  await paintBadge(stack);
  return stack;
}

let settingsCache = null;
async function getSettings() {
  if (settingsCache) return settingsCache;
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  settingsCache = normalize(stored[SETTINGS_KEY]);
  return settingsCache;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[SETTINGS_KEY]) settingsCache = normalize(changes[SETTINGS_KEY].newValue);
});

async function paintBadge(stack) {
  await chrome.action.setBadgeText({ text: stack.length ? String(stack.length) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#3d6ef5' });
}

async function currentTab(windowId) {
  const query = { active: true, ...(windowId ? { windowId } : { lastFocusedWindow: true }) };
  const [tab] = await chrome.tabs.query(query);
  return tab || null;
}

/* ------------------------------------------------------------- operations */

async function pushTab(tab) {
  if (!tab || !tab.url) return { ok: false, reason: 'no-tab' };
  if (!/^(https?|file|ftp):/i.test(tab.url)) {
    // chrome://, devtools:// etc. can be stacked but never re-opened
    // programmatically, so refuse rather than store a dead entry.
    return { ok: false, reason: 'unsupported-url' };
  }
  const settings = await getSettings();
  const stack = await getStack();
  const item = makeItem({
    url: tab.url,
    title: tab.title,
    favIconUrl: tab.favIconUrl,
    tabId: tab.id,
    now: Date.now(),
  });
  const result = push(stack, item, settings.pushPosition);
  await setStack(result.stack);
  return { ok: true, slot: result.slot, added: result.added, stack: result.stack };
}

async function jump(slot) {
  const settings = await getSettings();
  const stack = await getStack();
  const item = at(stack, slot);
  if (!item) return { ok: false, reason: 'empty-slot' };

  const tab = settings.reuseTab ? await findTab(item) : null;
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    if (item.tabId !== tab.id) {
      await setStack(stack.map((it) => (it.id === item.id ? { ...it, tabId: tab.id } : it)));
    }
    return { ok: true, slot, reused: true };
  }

  const created = await chrome.tabs.create({ url: item.url, active: true });
  await setStack(stack.map((it) => (it.id === item.id ? { ...it, tabId: created.id } : it)));
  return { ok: true, slot, reused: false };
}

async function findTab(item) {
  if (item.tabId != null) {
    const known = await chrome.tabs.get(item.tabId).catch(() => null);
    if (known && sameUrl(known.url, item.url)) return known;
  }
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => sameUrl(tab.url, item.url)) || null;
}

async function remove(slot) {
  const stack = await getStack();
  if (!at(stack, slot)) return { ok: false, reason: 'empty-slot' };
  await setStack(removeAt(stack, slot));
  return { ok: true, slot };
}

async function reorder(slot, delta) {
  await setStack(move(await getStack(), slot, delta));
  return { ok: true };
}

/* ----------------------------------------------------------- leader chord */

/**
 * Alt+S arms the chord instead of stacking immediately: a digit within the
 * window jumps to that slot, anything else (or the timeout) commits the push.
 *
 * The pending push is held here in memory. The service worker stays alive
 * while its timer is outstanding, and the window is under a second, so this
 * does not need the durability of storage.session.
 */
let pending = null;

function clearPending() {
  if (!pending) return null;
  clearTimeout(pending.timer);
  const held = pending;
  pending = null;
  return held;
}

async function arm(tab) {
  const settings = await getSettings();
  if (settings.mode === 'direct') return announce(tab, await pushTab(tab));

  await commitPending(); // a second Alt+S resolves the first chord

  const stack = await getStack();
  const armed = await tell(tab.id, {
    type: 'arm',
    stack: settings.showHud ? stack.map(hudItem) : [],
    timeoutMs: settings.leaderTimeoutMs,
    showHud: settings.showHud,
  });

  // No content script on this page (chrome://, Web Store, PDF viewer): there is
  // nothing that can catch the follow-up digit, so just do the obvious thing.
  if (!armed) return announce(tab, await pushTab(tab));

  pending = {
    tab,
    timer: setTimeout(() => void commitPending(), settings.leaderTimeoutMs),
  };
}

async function commitPending() {
  const held = clearPending();
  if (!held) return;
  const result = await pushTab(held.tab);
  await tell(held.tab.id, { type: 'disarm' });
  await announce(held.tab, result);
}

async function resolveChord(action, slot) {
  const held = clearPending();
  if (!held) return { ok: false, reason: 'not-armed' };

  switch (action) {
    case 'jump':
      return jump(slot);
    case 'remove': {
      const result = await remove(slot);
      await announce(held.tab, result, result.ok ? `Removed slot ${slot}` : `Slot ${slot} is empty`);
      return result;
    }
    case 'abort':
      return { ok: true, aborted: true };
    default: {
      // Any other key ends the chord as a plain push, and is left to the page.
      const result = await pushTab(held.tab);
      await announce(held.tab, result);
      return result;
    }
  }
}

const hudItem = (item, index) => ({
  slot: index + 1,
  title: item.title,
  favIconUrl: item.favIconUrl,
});

/** Fire-and-forget message to a tab; resolves false when nothing is listening. */
async function tell(tabId, message) {
  if (tabId == null) return false;
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false;
  }
}

async function announce(tab, result, override) {
  const settings = await getSettings();
  if (!settings.toasts || !tab) return result;
  let text = override;
  if (!text && result.ok && result.slot != null) {
    text = result.added === false ? `Already at ${result.slot}` : `Stacked as ${result.slot}`;
  } else if (!text && result.reason === 'unsupported-url') {
    text = 'Cannot stack this page';
  }
  if (text) await tell(tab.id, { type: 'toast', text });
  return result;
}

/* -------------------------------------------------------------- listeners */

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) await chrome.storage.sync.set({ [SETTINGS_KEY]: DEFAULTS });
  await paintBadge(await getStack());
});

chrome.runtime.onStartup.addListener(async () => paintBadge(await getStack()));

chrome.commands.onCommand.addListener(async (command, tab) => {
  const jumpMatch = /^jump-([1-9])$/.exec(command);
  if (jumpMatch) {
    clearPending();
    return void (await jump(Number(jumpMatch[1])));
  }

  switch (command) {
    case 'push-tab':
      return void (await arm(tab || (await currentTab())));
    case 'pop-tab': {
      const stack = await getStack();
      return void (await remove(stack.length));
    }
    case 'open-panel': {
      const windowId = tab ? tab.windowId : (await chrome.windows.getLastFocused()).id;
      // Must run inside the command's user gesture — no awaits before this.
      return void chrome.sidePanel.open({ windowId });
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const stack = await getStack();
  const next = detachTab(stack, tabId);
  if (next !== stack) await setStack(next);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, reason: String(err) }));
  return true; // keep the channel open for the async reply
});

async function handle(msg, sender) {
  switch (msg && msg.type) {
    case 'push': {
      const tab = sender.tab || (await currentTab());
      return announce(tab, await pushTab(tab));
    }
    case 'jump':
      return jump(msg.slot);
    case 'remove':
      return remove(msg.slot);
    case 'move':
      return reorder(msg.slot, msg.delta);
    case 'chord':
      return resolveChord(msg.action, msg.slot);
    case 'get':
      return { ok: true, stack: await getStack(), settings: await getSettings(), maxSlots: MAX_SLOTS };
    case 'settings':
      return { ok: true, settings: await getSettings() };
    case 'clear':
      await setStack([]);
      return { ok: true };
    default:
      return { ok: false, reason: 'unknown-message' };
  }
}
