/**
 * Page-level keyboard layer.
 *
 * Three jobs:
 *  1. The second half of the Alt+S accord. Chrome swallows the Alt+S keydown to
 *     fire its command, so the page never sees that key and cannot detect the
 *     accord on its own; the service worker tells it when the accord is armed.
 *     The digit pressed while Alt is still down arrives here as an ordinary
 *     Alt+digit, and releasing Alt ends the accord.
 *  2. The Alt+J accord, which is jump-only and lives entirely here: no Chrome
 *     command is involved, so it costs none of the four suggested keys. Hold
 *     Alt, tap J, tap a digit. J itself may be released; only Alt must stay
 *     down. Letting go of Alt without a digit cancels — it never stacks.
 *  3. Direct Alt+1..9 / Alt+Shift+1..9, which sidestep the four-shortcut limit
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
  /** null, 'stack' (Alt+S, armed by the worker) or 'jump' (Alt+J, armed here). */
  let armed = null;
  let altDown = false;
  let hudTimer = null;
  let settings = { altDigitJump: true, altShiftDigitRemove: true, altJAccord: true, showHud: true, toasts: true };

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
      // Racing the tap: Alt may already be back up by the time this arrives
      // (the arm message costs a few ms), in which case the accord is over
      // before it began and the tab should just be stacked.
      if (!altDown) return send({ type: 'chord', action: 'commit' });
      armed = 'stack';
      if (msg.showHud) {
        // Only surface the list if the accord is genuinely being *held*, so a
        // quick tap does not flash a panel at you.
        hudTimer = setTimeout(() => ui.showHud(msg.stack, 'stack'), 180);
      }
      return;
    }
    if (msg.type === 'disarm') {
      disarm();
      return;
    }
    if (msg.type === 'toast' && settings.toasts) ui.toast(msg.text);
  });

  document.addEventListener('keydown', onKeyDown, true); // capture: beat the page
  document.addEventListener('keyup', onKeyUp, true);
  // Losing focus means the keyup may never arrive; end the accord rather than
  // leave it armed until the safety-net timeout.
  window.addEventListener('blur', () => {
    altDown = false;
    release();
  });

  function disarm() {
    armed = null;
    clearTimeout(hudTimer);
    ui.hideHud();
  }

  /** Resolve the Alt+S accord exactly once, and tell the worker how it ended. */
  function finish(action, slot) {
    disarm();
    send({ type: 'chord', action, slot });
  }

  /** Alt went up (or focus left): the stack accord commits, the jump accord just ends. */
  function release() {
    if (armed === 'stack') finish('commit');
    else if (armed === 'jump') disarm();
  }

  /**
   * Arm the Alt+J accord. The worker is not involved until a digit is chosen,
   * so the HUD fetches the stack itself.
   */
  function armJump() {
    armed = 'jump';
    if (!settings.showHud) return;
    send({ type: 'get' }, (res) => {
      if (armed !== 'jump' || !res || !res.stack) return;
      const items = res.stack.map((item, i) => ({ slot: i + 1, title: item.title }));
      hudTimer = setTimeout(() => ui.showHud(items, 'jump'), 180);
    });
  }

  function jumpTo(slot) {
    send({ type: 'jump', slot }, (res) => {
      if (res && !res.ok && settings.toasts) ui.toast(`Slot ${slot} is empty`);
    });
  }

  function removeSlot(slot) {
    send({ type: 'remove', slot }, (res) => {
      if (!settings.toasts) return;
      ui.toast(res && res.ok ? `Removed slot ${slot}` : `Slot ${slot} is empty`);
    });
  }

  function onKeyUp(event) {
    if (event.key !== 'Alt') return;
    altDown = false;
    // Released without choosing a slot: "stack this tab" for Alt+S, nothing for Alt+J.
    release();
  }

  function onKeyDown(event) {
    if (event.key === 'Alt') altDown = true;
    if (event.isComposing || event.repeat) return;

    if (armed === 'jump' && event.code === 'KeyJ') {
      // Tapping J again while still held: keep waiting for the digit.
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (armed) {
      const { action, slot, swallow } = resolveChord(event.code, { shiftKey: event.shiftKey });
      if (action === 'ignore') return;
      if (armed === 'stack') {
        finish(action, slot);
      } else {
        // Jump accord: a digit acts on its own, anything else just ends it.
        disarm();
        if (action === 'jump') jumpTo(slot);
        else if (action === 'remove') removeSlot(slot);
      }
      if (swallow) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (!event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.code === 'KeyJ' && !event.shiftKey) {
      if (!settings.altJAccord) return;
      armJump();
      // Swallow it so a page accesskey on J does not fire underneath.
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const digit = /^Digit([1-9])$/.exec(event.code);
    if (!digit) return;

    const slot = Number(digit[1]);
    if (event.shiftKey) {
      if (!settings.altShiftDigitRemove) return;
      removeSlot(slot);
    } else {
      if (!settings.altDigitJump) return;
      jumpTo(slot);
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

  const text = (value) => document.createTextNode(value);
  const strong = (value) => {
    const el = document.createElement('b');
    el.textContent = value;
    return el;
  };

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
        .hint {
          color: #9aa3b2; font-size: 11px; padding: 6px 6px 2px; margin-top: 4px;
          border-top: 1px solid #262b35;
        }
        .hint b { color: #f2f4f8; font-weight: 600; }
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
      showHud(items, mode) {
        if (!attach()) return;
        hud.replaceChildren();
        if (!items.length) {
          const none = document.createElement('div');
          none.className = 'none';
          none.textContent = 'Stack is empty';
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
        const hint = document.createElement('div');
        hint.className = 'hint';
        // No countdown bar: the accord ends when you let go, not on a timer.
        const tail = mode === 'jump' ? ' · release to cancel' : ' · release to stack';
        hint.append(...(items.length
          ? [text('press '), strong('1–9'), text(' to jump · '), strong('⇧'), text('+digit removes' + tail)]
          : [text(mode === 'jump' ? 'stack is empty — release to cancel' : 'release to stack this tab')]));
        hud.append(hint);
        hud.classList.add('show');
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
