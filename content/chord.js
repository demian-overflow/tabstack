/**
 * Page-level keyboard layer.
 *
 * Two jobs:
 *  1. The follow-up half of the leader chord. Alt+S is a real Chrome command,
 *     so the service worker sees it and asks this script to catch the next key.
 *     Chrome commands are single accelerators — there is no sequence syntax —
 *     so a chord can only be completed down here, in the renderer.
 *  2. Direct Alt+1..9 / Alt+Shift+1..9, which sidestep the four-shortcut limit
 *     on suggested keys.
 *
 * Everything keys off event.code — physical key position — so the bindings
 * survive a switch to a non-Latin keyboard layout.
 *
 * Trade-off: content scripts cannot run on chrome:// pages, the Web Store, the
 * PDF viewer, or the new tab page. The service worker detects that (nothing
 * answers its "arm" message) and falls back to stacking immediately.
 */
(() => {
  // A single closure keeps the armed state and the UI in step.
  const ui = createUi();
  let armed = false;
  let settings = { altDigitJump: true, altShiftDigitRemove: true, toasts: true };

  chrome.runtime.sendMessage({ type: 'settings' }, (res) => {
    void chrome.runtime.lastError;
    if (res && res.settings) settings = res.settings;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings && changes.settings.newValue) {
      settings = changes.settings.newValue;
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'arm') {
      armed = true;
      if (msg.showHud) ui.showHud(msg.stack, msg.timeoutMs);
      return;
    }
    if (msg.type === 'disarm') {
      armed = false;
      ui.hideHud();
      return;
    }
    if (msg.type === 'toast' && settings.toasts) ui.toast(msg.text);
  });

  document.addEventListener('keydown', onKeyDown, true); // capture: beat the page

  function onKeyDown(event) {
    if (event.isComposing || event.repeat) return;

    if (armed) {
      const { action, slot, swallow } = resolveChord(event.code, { shiftKey: event.shiftKey });
      if (action === 'ignore') return;
      armed = false;
      ui.hideHud();
      send({ type: 'chord', action, slot });
      if (swallow) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const digit = /^Digit([1-9])$/.exec(event.code);
    if (!digit) return;

    const slot = Number(digit[1]);
    if (event.shiftKey) {
      if (!settings.altShiftDigitRemove) return;
      send({ type: 'remove', slot }, (res) => {
        if (!settings.toasts) return;
        ui.toast(res && res.ok ? `Removed slot ${slot}` : `Slot ${slot} is empty`);
      });
    } else {
      if (!settings.altDigitJump) return;
      send({ type: 'jump', slot }, (res) => {
        if (res && !res.ok && settings.toasts) ui.toast(`Slot ${slot} is empty`);
      });
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /** Mirrors lib/chord.js — content scripts are not ES modules, so it is inlined. */
  function resolveChord(code, { shiftKey }) {
    if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(code) || code === 'CapsLock') {
      return { action: 'ignore', swallow: false };
    }
    if (code === 'Escape') return { action: 'abort', swallow: true };
    const digit = /^Digit([1-9])$/.exec(code) || /^Numpad([1-9])$/.exec(code);
    if (digit) return { action: shiftKey ? 'remove' : 'jump', slot: Number(digit[1]), swallow: true };
    return { action: 'commit', swallow: false };
  }

  function send(message, done) {
    try {
      chrome.runtime.sendMessage(message, (res) => {
        void chrome.runtime.lastError; // worker asleep, or context torn down
        if (done) done(res);
      });
    } catch {
      /* extension reloaded under a live page; the next keypress will work */
    }
  }

  function createUi() {
    let host = null;
    let hud = null;
    let bubble = null;
    let hideTimer = null;

    function mount() {
      if (host) return;
      host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;inset:auto 16px 16px auto;';
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = `
        :host { all: initial; }
        .card {
          font: 500 13px/1.4 ui-sans-serif, system-ui, sans-serif;
          color: #f2f4f8; background: #171a21; border: 1px solid #2b303b;
          border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.4);
          opacity: 0; transform: translateY(4px); transition: opacity .1s, transform .1s;
        }
        .card.show { opacity: 1; transform: none; }
        #bubble { padding: 8px 12px; margin-top: 8px; }
        #hud { padding: 8px; min-width: 220px; max-width: 320px; }
        .row { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; }
        .slot {
          font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
          background: #262b35; color: #9aa3b2; border-radius: 4px; padding: 3px 5px; min-width: 16px; text-align: center;
        }
        .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .none { color: #9aa3b2; padding: 4px 6px; }
        .meter { height: 2px; background: #3d6ef5; border-radius: 2px; margin: 6px 6px 2px; transform-origin: left; }
      `;
      hud = document.createElement('div');
      hud.id = 'hud';
      hud.className = 'card';
      bubble = document.createElement('div');
      bubble.id = 'bubble';
      bubble.className = 'card';
      shadow.append(style, hud, bubble);
    }

    function attach() {
      mount();
      if (!host.isConnected && document.body) document.body.append(host);
      return host.isConnected;
    }

    return {
      showHud(items, timeoutMs) {
        if (!attach()) return;
        hud.replaceChildren();
        if (!items.length) {
          const none = document.createElement('div');
          none.className = 'none';
          none.textContent = 'Stack empty — release to stack this tab';
          hud.append(none);
        } else {
          for (const item of items.slice(0, 9)) {
            const row = document.createElement('div');
            row.className = 'row';
            const slot = document.createElement('span');
            slot.className = 'slot';
            slot.textContent = String(item.slot);
            const name = document.createElement('span');
            name.className = 'name';
            name.textContent = item.title || '';
            row.append(slot, name);
            hud.append(row);
          }
        }
        const meter = document.createElement('div');
        meter.className = 'meter';
        hud.append(meter);
        hud.classList.add('show');
        // Visual countdown of the chord window, so the timeout is never a mystery.
        meter.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], {
          duration: timeoutMs,
          easing: 'linear',
          fill: 'forwards',
        });
      },
      hideHud() {
        if (hud) hud.classList.remove('show');
      },
      toast(text) {
        if (!attach()) return;
        bubble.textContent = text;
        bubble.classList.add('show');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => bubble.classList.remove('show'), 1400);
      },
    };
  }
})();
