# Tabstack

A keyboard-driven stack of tabs, living in the Chrome side panel.

`Alt+S` pushes the current tab onto a numbered stack. `Alt+1` … `Alt+9` jump
straight back to it. The side panel shows the same list in the same order, so
what you see and what you type never disagree.

<img src="icons/icon128.png" width="64" alt="">

## Install (unpacked)

1. `git clone https://github.com/demian-overflow/tabstack.git`
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → pick the repo directory.
4. Pin the toolbar icon; clicking it opens the side panel.

Requires Chrome 116+ (Side Panel API).

## Keys

| Key | Action | Where it works |
| --- | --- | --- |
| `Alt+S` | Stack the current tab | Everywhere (Chrome command) |
| `Alt+Shift+S` | Open the side panel | Everywhere (Chrome command) |
| `Alt+1`, `Alt+2` | Jump to slot 1 / 2 | Everywhere (Chrome command) |
| `Alt+3` … `Alt+9` | Jump to slot 3 … 9 | Normal pages (content script) |
| `Alt+Shift+1…9` | Remove that slot | Normal pages (content script) |
| `1` … `9` | Jump, when the panel has focus | Side panel |
| `↑` `↓` / `Enter` / `Backspace` | Select / open / remove | Side panel |
| `Alt+↑` `Alt+↓` | Reorder the selected item | Side panel |

Pushing a URL that is already stacked refreshes it in place rather than adding a
duplicate, and new tabs are **appended**, so a slot number stays put for as long
as that item lives. Muscle memory survives.

### Why these keys

Four separate layers get a veto over a keystroke before your extension code
runs, and each one is absolute — there is no "please let me have it" API.

```mermaid
flowchart TD
    K["keypress"] --> WM{"GNOME / mutter<br/>grabbed it?"}
    WM -->|yes| WMX["Alt+Tab, Alt+F2, Alt+F4,<br/>Alt+space, Alt+Escape"]
    WM -->|no| BR{"Chrome browser<br/>accelerator?"}
    BR -->|yes| BRX["Alt+F, Alt+E menu · Alt+D omnibox<br/>Alt+Home · Alt+←/→ · Alt+Shift+I/A<br/><b>always wins, cannot be overridden</b>"]
    BR -->|no| EX{"bound extension<br/>command?"}
    EX -->|yes| EXX["chrome.commands.onCommand<br/>works on every page, chrome:// included"]
    EX -->|no| PG["renderer: page JS,<br/>accesskeys, our content script"]
```

That top-down order is why the obvious binding does not work:

- **`Alt+F` is impossible.** It is Chrome's own menu accelerator on Windows and
  Linux (so is `Alt+E`), and the docs are explicit that browser shortcuts take
  priority and cannot be overridden. `chrome://extensions/shortcuts` will let you
  type it; it just never fires.
- **`Alt+S` is free** at both levels — not in Chrome's accelerator table, not in
  GNOME's default `Alt` bindings (which claim only function keys, `Tab`, `` ` ``,
  `space` and `Escape`).
- **`Alt+1` … `Alt+9` are free too.** Chrome switches tabs with `Ctrl+1…8`, not
  `Alt`, and GNOME's launcher shortcuts are on `Super`.

Two more limits shape the layout:

- **Only four shortcuts can ship pre-assigned** (`suggested_key`), no matter how
  many commands the extension declares. Nine slots do not fit, so the four go to
  what must work on `chrome://` pages — push, panel, slots 1 and 2 — and the rest
  are declared unbound for you to assign, or handled in-page.
- **`Ctrl+Alt+…` is rejected outright** by the commands API, to stay clear of
  `AltGr`. Every shortcut must contain `Ctrl` or `Alt`, optionally plus `Shift`.

`Alt+3`…`Alt+9` therefore run in a content script, which has no four-key limit
but only reaches pages an extension may inject into — not `chrome://`, the Web
Store, or the PDF viewer. If you lean on one of those slots, bind it once at
`chrome://extensions/shortcuts` and it starts working everywhere.

### Making a shortcut work outside Chrome

An extension command is browser-scoped by default: Chrome must be focused. A
command can ask for `"global": true` so it fires system-wide, but Chrome only
accepts `Ctrl+Shift+[0…9]` for those — a three-finger chord for something you
press dozens of times an hour, so Tabstack skips it. Anything richer (a GNOME custom shortcut that talks
to the extension while Chrome is in the background) needs a native messaging
host, which is a much bigger surface than this prototype wants.

Shortcuts you assign by hand live in the profile, not in the extension:
`~/.config/google-chrome/<Profile>/Preferences` under `extensions.commands`.
Chrome exposes no policy for pre-seeding them, so a fresh machine means
re-binding by hand at `chrome://extensions/shortcuts` — the four defaults above
exist precisely so that is optional.

## How it works

```mermaid
flowchart LR
    subgraph Input
        CMD["chrome.commands<br/>Alt+S, Alt+Shift+S, Alt+1/2"]
        CS["content/chord.js<br/>Alt+3…9, Alt+Shift+1…9"]
        UI["panel/panel.js<br/>click, digits, arrows"]
    end

    SW["background.js<br/>service worker"]
    ST[("chrome.storage.local<br/>stack[]")]
    TABS["chrome.tabs<br/>focus or create"]

    CMD -->|onCommand| SW
    CS -->|sendMessage| SW
    UI -->|sendMessage| SW
    SW -->|read / write| ST
    SW --> TABS
    ST -.->|onChanged| UI

    LIB["lib/stack.js<br/>pure, unit-tested"]
    SW -.->|push / at / removeAt / move| LIB
```

The service worker is the only writer. Every input path — keyboard command,
content script, panel click — funnels into the same handlers, and the panel
re-renders off `storage.onChanged` rather than keeping its own copy. That is why
the visual order and the keyboard order cannot drift apart.

`lib/stack.js` holds the ordering rules as pure functions with no Chrome APIs in
them, so the part that is easy to get subtly wrong is the part that runs under
`node --test`.

### Jumping to a slot

```mermaid
flowchart TD
    A["Alt+N"] --> B{"slot N exists?"}
    B -->|no| C["ignore"]
    B -->|yes| D{"remembered tabId<br/>still open with this URL?"}
    D -->|yes| E["activate tab<br/>focus its window"]
    D -->|no| F{"any open tab<br/>matching the URL?"}
    F -->|yes| G["activate it,<br/>re-learn the tabId"]
    F -->|no| H["open a new tab,<br/>store the tabId"]
```

URLs compare equal when they differ only by fragment, so `#section` links don't
strand an item. Closing a tab clears the remembered id but keeps the stack entry
— the slot still works, it just opens fresh.

## Data

One key in `chrome.storage.local`:

```jsonc
{
  "stack": [
    {
      "id": "1756... -k3f9a",   // stable identity across refreshes
      "url": "https://example.dev/docs",
      "title": "Docs — Example",
      "favIconUrl": "https://example.dev/favicon.ico",
      "tabId": 42,               // last known live tab, or null
      "addedAt": 1756000000000
    }
  ]
}
```

Nothing leaves the browser: no network calls, no analytics, no remote host
permissions.

## Development

```bash
npm test                    # pure stack logic, node --test
python3 tools/make-icons.py # regenerate icons (no image deps)
```

After editing, hit the reload arrow on `chrome://extensions`. Content-script
changes need the *page* reloaded too; service-worker changes do not.

Permissions the manifest asks for, and why:

| Permission | Why |
| --- | --- |
| `tabs` | Read the current tab's URL/title to stack it, and search open tabs to re-focus one instead of duplicating it |
| `storage` | Persist the stack across restarts |
| `sidePanel` | The UI |
| `<all_urls>` content script | The `Alt+3…9` key handler; it never reads page content |

## Status

Prototype (v0.1.1) — unpacked install, no Web Store listing. Known gaps:

- No drag-to-reorder in the panel (arrow buttons and `Alt+↑/↓` only).
- Slots beyond 9 are stored and clickable but have no keyboard binding.
- The stack is global, not per-window or per-profile-session.

## License

MIT
