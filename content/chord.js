/**
 * Page-level keyboard handler.
 *
 * Chrome only lets an extension *suggest* four keyboard shortcuts, which is not
 * enough for nine slots, so Alt+1..Alt+9 are handled here instead. Where a real
 * command is bound (Alt+0, Alt+Shift+0, Alt+1, Alt+2 by default) Chrome consumes
 * the key before the page ever sees it and the service worker handles it — this
 * script simply never fires for those. Everything else lands here.
 *
 * Everything here keys off event.code, i.e. physical key position, so the
 * bindings survive a switch to a non-Latin keyboard layout.
 *
 * Trade-off: content scripts cannot run on chrome:// pages, the Web Store, or
 * the PDF viewer. Slots you use constantly are worth binding as real commands at
 * chrome://extensions/shortcuts, which work everywhere.
 */
(() => {
  const HANDLED = { jump: 'jump', remove: 'remove' };

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.isComposing || event.repeat) return;
      if (!event.altKey || event.ctrlKey || event.metaKey) return;

      const digit = /^Digit([1-9])$/.exec(event.code);
      if (digit) {
        const slot = Number(digit[1]);
        send(event.shiftKey ? HANDLED.remove : HANDLED.jump, { slot }, (res) => {
          if (event.shiftKey && res && res.ok) toast(`Removed slot ${slot}`);
          else if (res && !res.ok) toast(`Slot ${slot} is empty`);
        });
        return stop(event);
      }

      // Fallback for the push shortcut: only reached when Alt+0 is unbound as a
      // command, e.g. because another extension claimed it first.
      if (event.code === 'Digit0' && !event.shiftKey) {
        send('push', {}, (res) => {
          if (!res) return;
          if (res.ok) toast(res.added ? `Stacked as ${res.slot}` : `Already at ${res.slot}`);
          else if (res.reason === 'unsupported-url') toast('Cannot stack this page');
        });
        return stop(event);
      }
    },
    true, // capture: beat the page's own handlers
  );

  function stop(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function send(type, payload, done) {
    try {
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        void chrome.runtime.lastError; // service worker asleep / context torn down
        done(res);
      });
    } catch {
      /* extension reloaded under a live page; the next keypress will work */
    }
  }

  let host;
  let hideTimer;
  function toast(text) {
    if (!document.body) return;
    if (!host) {
      host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;inset:auto 16px 16px auto;';
      const shadow = host.attachShadow({ mode: 'closed' });
      const bubble = document.createElement('div');
      bubble.id = 'bubble';
      shadow.append(bubble);
      const style = document.createElement('style');
      style.textContent = `
        #bubble {
          font: 500 13px/1.4 ui-sans-serif, system-ui, sans-serif;
          color: #f2f4f8; background: #171a21; border: 1px solid #2b303b;
          border-radius: 8px; padding: 8px 12px; box-shadow: 0 6px 24px rgba(0,0,0,.35);
          opacity: 0; transform: translateY(4px); transition: opacity .12s, transform .12s;
        }
        #bubble.show { opacity: 1; transform: none; }`;
      shadow.append(style);
      host.__bubble = bubble;
    }
    if (!host.isConnected) document.body.append(host);
    host.__bubble.textContent = text;
    host.__bubble.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => host.__bubble.classList.remove('show'), 1400);
  }
})();
