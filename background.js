/**
 * Service worker: owns the stack in chrome.storage.local and is the single
 * place that talks to the Tabs API. Both the keyboard commands and the side
 * panel go through the same handlers, so the two can never disagree.
 */
import { push, at, removeAt, move, detachTab, makeItem, sameUrl, MAX_SLOTS } from './lib/stack.js';

const KEY = 'stack';

async function getStack() {
  const { [KEY]: stack } = await chrome.storage.local.get(KEY);
  return Array.isArray(stack) ? stack : [];
}

async function setStack(stack) {
  await chrome.storage.local.set({ [KEY]: stack });
  await paintBadge(stack);
  return stack;
}

async function paintBadge(stack) {
  const text = stack.length ? String(stack.length) : '';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: '#3d6ef5' });
}

/** The tab the user is looking at, in the window the event came from. */
async function currentTab(windowId) {
  const query = { active: true, ...(windowId ? { windowId } : { lastFocusedWindow: true }) };
  const [tab] = await chrome.tabs.query(query);
  return tab || null;
}

async function pushTab(tab) {
  if (!tab || !tab.url) return { ok: false, reason: 'no-tab' };
  if (!/^(https?|file|ftp):/i.test(tab.url)) {
    // chrome://, devtools://, view-source:// etc. can be stacked but never
    // re-opened programmatically, so refuse rather than store a dead entry.
    return { ok: false, reason: 'unsupported-url' };
  }
  const stack = await getStack();
  const item = makeItem({
    url: tab.url,
    title: tab.title,
    favIconUrl: tab.favIconUrl,
    tabId: tab.id,
    now: Date.now(),
  });
  const result = push(stack, item);
  await setStack(result.stack);
  return { ok: true, slot: result.slot, added: result.added, stack: result.stack };
}

/** Focus the live tab for an item if one still exists, else open a new one. */
async function jump(slot) {
  const stack = await getStack();
  const item = at(stack, slot);
  if (!item) return { ok: false, reason: 'empty-slot' };

  const tab = await findTab(item);
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
  const stack = await getStack();
  await setStack(move(stack, slot, delta));
  return { ok: true };
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  await paintBadge(await getStack());
});

chrome.runtime.onStartup.addListener(async () => {
  await paintBadge(await getStack());
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  const jumpMatch = /^jump-([1-9])$/.exec(command);
  if (jumpMatch) return void (await jump(Number(jumpMatch[1])));

  switch (command) {
    case 'push-tab':
      return void (await pushTab(tab || (await currentTab())));
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

/** Keep slot numbers honest when Chrome closes a tab out from under us. */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const stack = await getStack();
  const next = detachTab(stack, tabId);
  if (next !== stack) await setStack(next);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, reason: String(err) }));
  return true; // keep the message channel open for the async reply
});

async function handle(msg, sender) {
  switch (msg && msg.type) {
    case 'push':
      return pushTab(sender.tab || (await currentTab()));
    case 'jump':
      return jump(msg.slot);
    case 'remove':
      return remove(msg.slot);
    case 'move':
      return reorder(msg.slot, msg.delta);
    case 'get':
      return { ok: true, stack: await getStack(), maxSlots: MAX_SLOTS };
    case 'clear':
      await setStack([]);
      return { ok: true };
    default:
      return { ok: false, reason: 'unknown-message' };
  }
}
