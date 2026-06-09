# Awesome Media Controller — Design Spec

**Date:** 2026-06-09
**GNOME Target:** 45+ (tested on 50.2)
**Extension UUID:** `awesome-media-controller@awesome`

---

## Overview

A GNOME Shell extension that puts media controls in the top bar with Gen Z / Aurora Glass aesthetics. Built from scratch because existing media controller extensions (e.g. `mediacontrols@cliffniff.github.com`) are incompatible with GNOME 46+.

**Name:** Awesome Media Controller

---

## Architecture

Modular — 4 focused files, each with one clear responsibility.

```
awesome-media-controller@awesome/
├── metadata.json              — extension identity, GNOME version support
├── extension.js               — lifecycle only (enable / disable)
└── lib/
    ├── mpris.js               — D-Bus MPRIS watcher, manages all active players
    ├── panel-widget.js        — aurora glass pill widget in the top bar
    └── popup.js               — full card dropdown (art, controls, player switcher)
```

**Why not prefs.js for v1:** Settings UI is deferred. The extension works out of the box with sensible defaults.

---

## Component Designs

### `extension.js` — Lifecycle

```
enable()
  → create MprisWatcher
  → create PanelWidget(watcher)
  → PanelWidget adds itself to Main.panel

disable()
  → PanelWidget.destroy()  — removes from panel, disconnects signals
  → MprisWatcher.destroy() — closes D-Bus proxies
```

No state lives here. It's a pure lifecycle shell.

---

### `lib/mpris.js` — MPRIS Watcher

**Responsibility:** Own all D-Bus communication. Know which players exist, which is active, and emit signals when anything changes.

**How it works:**

1. On init, scan `org.freedesktop.DBus.ListNames()` for all names matching `org.mpris.MediaPlayer2.*`
2. For each name, create a `Gio.DBusProxy` on interface `org.mpris.MediaPlayer2.Player`
3. Watch `org.freedesktop.DBus` `NameOwnerChanged` signal — add proxy when a new player appears, remove when one exits
4. Track `activePlayer` = prefer the player with `PlaybackStatus=Playing`; if multiple are playing or all are paused, use the one that most recently emitted `PropertiesChanged`
5. Listen to `PropertiesChanged` on every proxy — re-emit as own `player-changed` GObject signal with the full metadata payload

**Signals emitted:**
- `player-changed` — metadata, playback status, shuffle, loop, volume changed on active player
- `players-list-changed` — a player appeared or disappeared (triggers switcher refresh)

**Commands (called by popup.js):**
- `playPause()`, `next()`, `previous()` — method calls on active player proxy
- `seekTo(positionMicroseconds)` — `SetPosition(trackId, absolutePosition)` method (not `Seek` which is relative)
- `setVolume(0.0–1.0)` — set `Volume` property
- `setActive(playerName)` — switch which player is considered active
- `setShuffle(bool)`, `setLoopStatus(string)` — set properties

**Data shape for `player-changed`:**
```js
{
  title: string,
  artist: string,       // joined if array
  album: string,
  artUrl: string,       // e.g. https://i.scdn.co/...
  playbackStatus: 'Playing' | 'Paused' | 'Stopped',
  shuffle: boolean,
  loopStatus: 'None' | 'Track' | 'Playlist',
  volume: number,       // 0.0 – 1.0
  position: number,     // microseconds
  length: number,       // microseconds (from mpris:length)
}
```

---

### `lib/panel-widget.js` — Aurora Glass Pill

**Responsibility:** Render the top-bar widget and handle clicks to open/close the popup.

**Implementation:**

- Extends `PanelMenu.Button` (from `resource:///org/gnome/shell/ui/panelMenu.js`)
- Added to `Main.panel` via `Main.panel.addToStatusArea('awesome-media-controller', widget)`
- Inner layout (`St.BoxLayout`):
  - **Thumbnail** — `St.Icon` or `Clutter.Actor` with album art (32×32, rounded). Falls back to a purple gradient placeholder if no art URL.
  - **Text column** — `St.Label` for title (bold, white), `St.Label` for artist (dim)
  - **Controls** — three `St.Button`: `⏮`, `▶/⏸`, `⏭`

**Aurora glass CSS** (applied via `style` property on the container):
```css
background: rgba(255,255,255,0.07);
border: 1px solid rgba(255,255,255,0.12);
border-radius: 999px;
box-shadow: 0 0 18px rgba(139,92,246,0.25);
/* gradient overlay via a child actor */
```

- Title marquee: if title > 20 chars, animate `St.Label` `translation-x` left via a `GLib.timeout_add` loop, resetting when popup is open
- Clicking the pill body opens the popup; clicking controls calls `mpris.playPause()` etc. directly without opening the popup
- Connects to `watcher::player-changed` to update text and art
- Hides itself entirely when no MPRIS player is active

**Album art loading:** Use `Gio.File.new_for_uri(artUrl).read_async()` → load into `GdkPixbuf.Pixbuf` → apply to a `Clutter.Image`. Done async so the shell never blocks.

---

### `lib/popup.js` — Full Card Dropdown

**Responsibility:** The full media card that drops from the panel pill.

**Rendered inside** the `PanelMenu.Button`'s `menu` (a `PopupMenu.PopupMenu`). Replaces the default menu items with a single custom `PopupMenu.PopupBaseMenuItem` containing a `St.Widget` tree.

**Layout (top to bottom):**

1. **Album art** — 260×260px, rounded 16px corners. Loads from `artUrl` async. Gradient placeholder until loaded.
2. **Track title** — 17px, 800 weight, white
3. **Artist** — 12px, 50% opacity
4. **Album** — 10px, 28% opacity
5. **Progress bar** — custom `St.DrawingArea` drawn via Cairo. Scrubable: `button-press-event` + `motion-event` calls `watcher.seekTo(absolutePosition)`. Updates position every 1s via `GLib.timeout_add` while popup is visible.
6. **Time labels** — elapsed / total, 9px
7. **Controls row** — shuffle `🔀` (active = purple tint), `⏮`, play/pause `▶⏸` (gradient, 46px), `⏭`, repeat `🔁`
8. **Volume row** — mute icon, scrubable bar (same pattern as progress), speaker icon
9. **Separator**
10. **Player switcher** — `St.BoxLayout` row of player pills. Each pill: colored dot (green=Spotify, orange=Firefox, etc.) + player name. Active player has purple border + glow. Clicking a pill calls `watcher.setActive(name)`.

**Updates:** The popup subscribes to `watcher::player-changed` while open. On close, it disconnects to avoid wasted updates.

---

## Data Flow

```
D-Bus (MPRIS) ──→ MprisWatcher
                      │
           player-changed signal
                      │
           ┌──────────┴──────────┐
           ▼                     ▼
    PanelWidget              Popup (when open)
    (pill text,              (art, progress,
     art thumb,               controls,
     play/pause)              switcher)
```

User interactions go the other way:

```
Button click in pill/popup ──→ MprisWatcher.playPause() / next() / etc.
                                       │
                               Gio.DBusProxy method call
                                       │
                               MPRIS player (Spotify etc.)
```

---

## Visual Design Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--aurora-purple` | `rgba(139,92,246,X)` | Primary accent, glow, active states |
| `--aurora-pink` | `rgba(236,72,153,X)` | Gradient endpoint, progress fill |
| `--aurora-cyan` | `rgba(6,182,212,X)` | Bottom-left ambient blob |
| `--glass-bg` | `rgba(255,255,255,0.07)` | Panel pill background |
| `--glass-border` | `rgba(255,255,255,0.12)` | Panel pill border |
| `--popup-bg` | `rgba(14,11,26,0.92)` | Popup background |
| `--text-primary` | `#ffffff` | Track title |
| `--text-secondary` | `rgba(255,255,255,0.45)` | Artist |
| `--text-tertiary` | `rgba(255,255,255,0.28)` | Album |

---

## Error Handling

- **No active player:** Pill hides completely (`widget.hide()`). Re-shows when MPRIS player appears.
- **Art URL fails to load:** Silently falls back to purple→pink gradient placeholder. No error thrown.
- **Player disappears while popup is open:** Popup shows "No player" state, switcher removes the dead player pill.
- **D-Bus call fails:** Log to `console.warn`, no crash. MPRIS is best-effort.

---

## GNOME Compatibility

- Uses ESM module syntax (`import`) — required for GNOME 45+
- `Extension` class from `resource:///org/gnome/shell/extensions/extension.js`
- No deprecated `imports.ui.*` — all via `resource:///org/gnome/shell/ui/` imports
- `metadata.json` lists shell-version: `["45","46","47","48","49","50"]`
- No GSettings schema required for v1 (no prefs UI)

---

## Out of Scope (v1)

- Preferences / settings UI
- Lyrics display
- Last.fm / scrobbling
- Notifications on track change
- Position in panel (defaults to right, near system tray)
