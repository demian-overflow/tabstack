# Tabstack

A keyboard-driven stack of tabs, living in the Chrome side panel.

`Alt+S` is one accord, not a sequence. **Hold it** and a numbered list of the
stack appears on the page; keep holding and press `1`…`9` to jump to that slot.
**Let go** without pressing a digit and the current tab is stacked. The side
panel shows the same list in the same order, so what you see and what you type
never disagree.

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
| `Alt+S` (tap) | Stack the current tab | Everywhere (Chrome command) |
| `Alt+S`+`1…9` | Jump to that slot, all held together | Normal pages |
| `Alt+S`+`⇧`+`1…9` | Remove that slot | Normal pages |
| `Alt+S`+`Esc` | Cancel — no stack, no jump | Normal pages |
| `Alt+Shift+S` | Open the side panel | Everywhere (Chrome command) |
| `Alt+1`, `Alt+2` | Jump to slot 1 / 2, on its own | Everywhere (Chrome command) |
| `Alt+3` … `Alt+9` | Jump to slot 3 … 9, on its own | Normal pages (content script) |
| `Alt+Shift+1…9` | Remove that slot | Normal pages (content script) |
| `1` … `9` | Jump, when the panel has focus | Side panel |
| `↑` `↓` / `Enter` / `Backspace` | Select / open / remove | Side panel |
| `Alt+↑` `Alt+↓` | Reorder the selected item | Side panel |

Pushing a URL that is already stacked refreshes it in place rather than adding a
duplicate, and new tabs are **appended**, so a slot number stays put for as long
as that item lives. Muscle memory survives.

Everything above is configurable, including turning the accord off entirely —
see [Settings](#settings).

### How the accord actually works

`chrome.commands` registers single accelerators, and `Alt+S+1` is not one of
them — Chrome has no notion of a three-key accord, and `S` is not a modifier it
can match on. What saves it is that **the page never needs to see `S` at all**:

```
Alt down ─────────────────────────────────────── Alt up
     S down (swallowed by Chrome → command fires)
              1 down  →  arrives as an ordinary Alt+1
```

Chrome swallows the `Alt+S` keydown to fire the command, so the content script
cannot detect the accord itself — the service worker tells it. From there the
digit is just an `Alt+digit` keydown like any other, and the release of `Alt` —
which the page *does* see — is what ends the accord.

```mermaid
sequenceDiagram
    participant U as You
    participant C as Chrome
    participant SW as service worker
    participant P as page (content script)

    U->>C: Alt down, S down
    C->>SW: commands.onCommand (Alt+S)
    SW->>P: arm (stack contents)
    Note over P: Alt already up? commit at once
    P-->>U: slot list, after 180 ms of holding
    alt digit while still held
        U->>P: 1 (as Alt+1)
        P->>SW: accord → jump 1
        SW->>SW: cancel the pending push
        SW-->>U: focus slot 1
    else Alt released
        U->>P: keyup Alt
        P->>SW: accord → commit
        SW-->>U: tab stacked
    end
```

The push is *deferred, not undone*: nothing is written until the accord ends, so
you never see a stray entry appear and vanish. Because the release commits it,
a plain tap of `Alt+S` still lands immediately — there is no timeout in the
common path. Two details make that hold up in practice:

- **A tap can outrun the arm message.** If `Alt` is already back up when it
  arrives, the content script commits straight away instead of arming.
- **Holding the accord makes `S` autorepeat**, re-firing the command several
  times a second. Repeats on the same tab are treated as "still held" rather
  than as new presses.

The hold limit in settings is only a safety net for when the release is never
seen at all — focus jumped to the omnibox, the page navigated mid-accord.

On a page where no content script can run — `chrome://`, the Web Store, the PDF
viewer, the new tab page — nothing answers the arm message, so the service
worker stacks the tab immediately instead of arming an accord nothing could
watch. The direct `Alt+1`/`Alt+2` commands keep working there too.

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
- **`Ctrl+E` is out for the same reason** — it is Chrome's *search from
  anywhere*, the twin of `Ctrl+K`. `Ctrl`+letter is nearly full: Chrome owns
  D F G H J K L N O P R S T U W, and A C V X Y Z are the universal edit keys.
- **`Alt+S` is free**, and so is the digit row: Chrome switches tabs with
  `Ctrl+1…8`, not `Alt`, and GNOME's launcher shortcuts are on `Super`. Watch
  out when testing across browsers, though — Firefox's `Alt` bindings are a
  different set entirely, and a collision there says nothing about Chrome.
- **Letters carry one risk digits do not**: a page `accesskey` or a GTK menu
  mnemonic can claim them at the renderer layer (a *bound command* still wins),
  and — see below — a letter can stop matching when you switch layout.

Two more limits shape the layout:

- **Only four shortcuts can ship pre-assigned** (`suggested_key`), no matter how
  many commands the extension declares. Nine slots do not fit, so the four go to
  what must work on `chrome://` pages — the accord key, the panel, and slots 1 and 2
  — and the rest are declared unbound for you to assign, or handled in-page.
  The accord exists precisely to reach the other slots without spending binds
  on them.
- **The grammar is narrow.** Every shortcut must contain `Ctrl` or `Alt`, with
  `Shift` optional. `Ctrl+Alt+…` is rejected outright (to stay clear of `AltGr`),
  and there is no `Super`/`Meta` modifier, no `F1`–`F12`, and no `Fn` — the `Fn`
  key is resolved inside the keyboard's own firmware and never reaches the
  kernel, let alone the browser.

`Alt+3`…`Alt+9` therefore run in a content script, which has no four-key limit
but only reaches pages an extension may inject into — not `chrome://`, the Web
Store, or the PDF viewer. If you lean on one of those slots, bind it once at
`chrome://extensions/shortcuts` and it starts working everywhere.

### Non-Latin keyboard layouts

If you keep several layouts (`us,ru,ua`, say), letter-based *commands* are the
thing most likely to break: under a Cyrillic layout the physical `S` key no
longer reports as `S`. Digits do not move — `1` is `1` in Latin and Cyrillic
alike — so `Alt+1`/`Alt+2` are the safest bindings on such a machine.

Everything Tabstack handles itself is immune: both the chord follow-up and the
direct `Alt+3…9` match on `event.code`, the physical key position, so they work
the same under any layout. If `Alt+S` ever stops firing after a layout switch,
that is Chrome's binding, not the extension's — rebind the accord key to a digit at
`chrome://extensions/shortcuts` and the chord behaves identically.

### Making a shortcut work outside Chrome

An extension command is browser-scoped by default: Chrome must be focused. A
command can ask for `"global": true` so it fires system-wide, but Chrome only
accepts `Ctrl+Shift+[0…9]` for those — a three-finger chord for something you
press dozens of times an hour, so Tabstack skips it. Anything richer (a GNOME
custom shortcut that talks to the extension while Chrome is in the background)
needs a native messaging host, which is a much bigger surface than this
prototype wants.

If the legal combinations genuinely run out, the fix belongs below the browser:
a remapper like [`keyd`](https://github.com/rvaiya/keyd) can turn an unused
physical key — `Menu`, `Caps Lock` — into a held layer that *emits* `Alt+digit`.
Chrome then sees an ordinary, legal shortcut and never knows the difference,
which is the closest thing to an `Fn` layer that an extension can be given.

Shortcuts you assign by hand live in the profile, not in the extension:
`~/.config/google-chrome/<Profile>/Preferences` under `extensions.commands`.
Chrome exposes no policy for pre-seeding them, so a fresh machine means
re-binding by hand at `chrome://extensions/shortcuts` — the four defaults above
exist precisely so that is optional. The settings page reads them back with
`chrome.commands.getAll()` so you can see what Chrome actually accepted.

## Settings

Open them from the gear in the side panel, or right-click the toolbar icon →
*Options*.

| Setting | Default | What it changes |
| --- | --- | --- |
| Mode | `accord` | `accord` waits for the release; `direct` stacks the moment you press `Alt+S` |
| Hold limit | `1500 ms` | Safety net if the `Alt` release is never seen; not the normal path |
| Slot list on page | on | The HUD, after 180 ms of holding |
| `Alt+1…9` jumps | on | Direct jumps without holding `S` |
| `Alt+⇧+1…9` removes | on | Direct removal |
| Confirmation bubbles | on | The on-page toasts |
| New tab lands | bottom | `top` makes the newest slot 1, at the cost of renumbering |
| Reuse open tab | on | Focus an existing tab with that URL instead of opening a second |

### Where state lives

Three different stores, because three different things are being kept:

| What | Where | Why there |
| --- | --- | --- |
| Settings | `chrome.storage.sync` | Small, and worth roaming with your Chrome profile to a second machine |
| The stack | `chrome.storage.local` | Device-specific tab state, and far past `sync`'s 8 KB-per-item quota |
| Key bindings | The browser profile — `Preferences` → `extensions.commands` | Chrome owns them; an extension may *suggest* four defaults and read the rest via `chrome.commands.getAll()`, but there is **no API to set one** |

That last row is why the settings page shows your live bindings read-only, with
a button through to `chrome://extensions/shortcuts`. Anything claiming to rebind
an extension shortcut from inside the extension is claiming something the
platform does not offer.

Settings are validated in one place — `normalize()` in `lib/settings.js` — so
hand-edited or out-of-date storage degrades to the defaults instead of reaching
the service worker as a bad value.

## How it works

```mermaid
flowchart LR
    subgraph Input
        CMD["chrome.commands<br/>Alt+S, Alt+Shift+S, Alt+1/2"]
        CS["content/chord.js<br/>chord follow-up, Alt+3…9"]
        UI["panel/panel.js<br/>click, digits, arrows"]
    end

    OPT["options/options.js<br/>settings form"]
    SW["background.js<br/>service worker"]
    ST[("chrome.storage.local<br/>stack[]")]
    CFG[("chrome.storage.sync<br/>settings")]
    TABS["chrome.tabs<br/>focus or create"]

    CMD -->|onCommand| SW
    CS -->|sendMessage| SW
    UI -->|sendMessage| SW
    SW -->|read / write| ST
    SW --> TABS
    OPT -->|write| CFG
    CFG -.->|onChanged| SW
    CFG -.->|onChanged| CS
    ST -.->|onChanged| UI

    LIB["lib/stack.js · lib/chord.js · lib/settings.js<br/>pure, unit-tested"]
    SW -.-> LIB
```

The service worker is the only writer. Every input path — keyboard command,
content script, panel click — funnels into the same handlers, and the panel
re-renders off `storage.onChanged` rather than keeping its own copy. That is why
the visual order and the keyboard order cannot drift apart.

Every panel request reports back, and a failure gets a line at the bottom of the
panel rather than nothing at all — an empty slot, a page that cannot be stacked,
or a panel left over from a previous load of the extension, which is otherwise
indistinguishable from a click that never registered.

`lib/stack.js` holds the ordering rules as pure functions with no Chrome APIs in
them, so the part that is easy to get subtly wrong is the part that runs under
`node --test`. `lib/focus.js` is there for the same reason: what it takes to
actually bring a window forward is a rule worth pinning down in a test.

### Jumping to a slot

```mermaid
flowchart TD
    A["Alt+N"] --> B{"slot N exists?"}
    B -->|no| C["say so"]
    B -->|yes| D{"remembered tabId<br/>still open with this URL?"}
    D -->|yes| E["activate it"]
    D -->|no| F{"any open tab<br/>matching the URL?"}
    F -->|yes| G["activate it,<br/>re-learn the tabId"]
    F -->|no| H["open a new tab <b>in the window<br/>you asked from</b>, store the tabId"]
    E --> R["raise that window —<br/>restoring it if minimized"]
    G --> R
    H --> R
    R --> S{"window manager<br/>refused the raise?"}
    S -->|yes| S1["tab is active anyway;<br/>alt-tab to it"]
    S -->|no| S2["done"]
```

URLs compare equal when they differ only by fragment, so `#section` links don't
strand an item. Closing a tab clears the remembered id but keeps the stack entry
— the slot still works, it just opens fresh.

Two details that only show up with more than one window open. A minimized window
ignores a bare focus request, so the raise asks for `state: 'normal'` in the same
call — otherwise the tab activates invisibly and the click looks ignored. And
raising is *best effort*: a Linux window manager may decline it, which must not
turn a completed jump into a failed one. The panel says which window it is in
when it asks, so a slot that is not open yet opens **there**, not in whichever
window Chrome last considered focused.

## Data

The stack, in `chrome.storage.local`:

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
npm test                    # pure logic: stack, chord, settings — node --test
python3 tools/make-icons.py # regenerate icons (no image deps)
```

The four `lib/` modules hold everything that is easy to get subtly wrong —
slot renumbering, which key resolves the chord, settings validation, what a
window needs in order to come forward — with no
Chrome APIs in them, so they run under `node --test` rather than by hand in a
browser. `content/chord.js` inlines a copy of `resolve()` because content
scripts are not ES modules; the test suite covers the module, and the copy is
kept to the same handful of lines deliberately.

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

Prototype (v0.3.1) — unpacked install, no Web Store listing. Known gaps:

- No drag-to-reorder in the panel (arrow buttons and `Alt+↑/↓` only).
- Slots beyond 9 are stored and clickable but have no keyboard binding — the
  accord reads a single digit, not a multi-digit number.
- The pending push is held in the service worker's memory. If Chrome tears the
  worker down mid-accord the push is dropped; over the length of a keypress this
  has not been observed, but it is not guaranteed by the platform.
- The stack is global, not per-window or per-profile-session.

## License

MIT
