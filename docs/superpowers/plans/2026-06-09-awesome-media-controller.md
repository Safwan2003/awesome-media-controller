# Awesome Media Controller — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GNOME Shell 45+ extension that displays an Aurora Glass media control pill in the top bar with a full-card popup, scrubable progress, volume control, shuffle/repeat toggles, and multi-player switching.

**Architecture:** Modular — `extension.js` is lifecycle-only; `lib/mpris.js` owns all D-Bus/MPRIS communication and emits GObject signals; `lib/panel-widget.js` renders the top-bar pill; `lib/popup.js` renders the dropdown full-card. UI components subscribe to `MprisWatcher` signals and call its command methods.

**Tech Stack:** GJS (ES modules), GNOME Shell 45+ APIs — `gi://Gio`, `gi://St`, `gi://Clutter`, `gi://GLib`, `gi://GObject`, `gi://GdkPixbuf`, `gi://Soup` (v3), `resource:///org/gnome/shell/ui/panelMenu.js`, `resource:///org/gnome/shell/ui/popupMenu.js`

---

## File Map

| File | Responsibility |
|------|----------------|
| `metadata.json` | Extension identity, GNOME version list |
| `extension.js` | `enable()` / `disable()` lifecycle only |
| `lib/mpris.js` | D-Bus watcher, player proxies, signals, all commands |
| `lib/panel-widget.js` | Aurora glass pill widget, art thumbnail, marquee, controls |
| `lib/popup.js` | Full card popup: art, track info, progress, volume, switcher |

**Install path:** `~/.local/share/gnome-shell/extensions/awesome-media-controller@awesome/`

**Reload command** (run after every task to test):
```bash
EXT=awesome-media-controller@awesome
rsync -a --delete \
  --exclude='.git' --exclude='docs' --exclude='.superpowers' \
  /home/safwan/awesome-media-controller/ \
  ~/.local/share/gnome-shell/extensions/$EXT/
gnome-extensions disable $EXT 2>/dev/null; sleep 0.5; gnome-extensions enable $EXT
```

**Watch logs** (run in a separate terminal throughout):
```bash
journalctl -f -o cat /usr/bin/gnome-shell 2>/dev/null | grep -i "amc\|awesome\|js error\|extension"
```

---

## Task 1: Project scaffold + metadata

**Files:**
- Create: `metadata.json`
- Create: `extension.js`
- Create: `lib/` directory

- [ ] **Step 1: Create the extension directory and lib folder**

```bash
mkdir -p /home/safwan/awesome-media-controller/lib
```

- [ ] **Step 2: Write metadata.json**

```json
{
  "name": "Awesome Media Controller",
  "description": "Aurora Glass media controls in the GNOME top bar. Full-card popup with album art, progress, volume, shuffle, repeat, and multi-player switching.",
  "uuid": "awesome-media-controller@awesome",
  "shell-version": ["45", "46", "47", "48", "49", "50"],
  "version": 1,
  "url": "https://github.com/safwan/awesome-media-controller"
}
```

Save to: `/home/safwan/awesome-media-controller/metadata.json`

- [ ] **Step 3: Write skeleton extension.js**

```javascript
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class AwesomeMediaController extends Extension {
    enable() {
        console.log('AMC: enabled');
    }

    disable() {
        console.log('AMC: disabled');
    }
}
```

Save to: `/home/safwan/awesome-media-controller/extension.js`

- [ ] **Step 4: Install and verify the extension appears**

```bash
EXT=awesome-media-controller@awesome
mkdir -p ~/.local/share/gnome-shell/extensions/$EXT
rsync -a --delete \
  --exclude='.git' --exclude='docs' --exclude='.superpowers' \
  /home/safwan/awesome-media-controller/ \
  ~/.local/share/gnome-shell/extensions/$EXT/
gnome-extensions list | grep awesome
```

Expected: `awesome-media-controller@awesome`

- [ ] **Step 5: Enable the extension**

```bash
gnome-extensions enable awesome-media-controller@awesome
```

Expected: no error output. Check `journalctl` for `AMC: enabled`.

If GNOME says extension is not found: log out and back in once (needed on first install), then re-run the enable command.

- [ ] **Step 6: Commit**

```bash
cd /home/safwan/awesome-media-controller
git add metadata.json extension.js lib/.gitkeep 2>/dev/null || git add metadata.json extension.js
git commit -m "feat: project scaffold with metadata and skeleton extension"
```

---

## Task 2: MPRIS watcher (lib/mpris.js)

**Files:**
- Create: `lib/mpris.js`
- Modify: `extension.js`

- [ ] **Step 1: Write lib/mpris.js — full MPRIS watcher**

```javascript
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

const MPRIS_PLAYER_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Seek">
      <arg type="x" direction="in" name="Offset"/>
    </method>
    <method name="SetPosition">
      <arg type="o" direction="in" name="TrackId"/>
      <arg type="x" direction="in" name="Position"/>
    </method>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="LoopStatus"     type="s" access="readwrite"/>
    <property name="Shuffle"        type="b" access="readwrite"/>
    <property name="Metadata"       type="a{sv}" access="read"/>
    <property name="Volume"         type="d" access="readwrite"/>
    <property name="Position"       type="x" access="read"/>
    <property name="CanGoNext"      type="b" access="read"/>
    <property name="CanGoPrevious"  type="b" access="read"/>
    <property name="CanPlay"        type="b" access="read"/>
    <property name="CanPause"       type="b" access="read"/>
    <property name="CanSeek"        type="b" access="read"/>
  </interface>
</node>`;

const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(MPRIS_PLAYER_IFACE);

export const MprisWatcher = GObject.registerClass({
    Signals: {
        'player-changed':      {},
        'players-list-changed': {},
    },
}, class MprisWatcher extends GObject.Object {

    _init() {
        super._init();
        this._players = new Map(); // busName → { proxy, lastChanged }
        this._activePlayerName = null;
        this._nameWatchId = 0;
        this._initAsync();
    }

    async _initAsync() {
        try {
            const result = await Gio.DBus.session.call(
                'org.freedesktop.DBus',
                '/org/freedesktop/DBus',
                'org.freedesktop.DBus',
                'ListNames',
                null,
                new GLib.VariantType('(as)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );
            const [names] = result.deepUnpack();
            for (const name of names) {
                if (name.startsWith('org.mpris.MediaPlayer2.'))
                    await this._addPlayer(name);
            }
        } catch (e) {
            console.warn('AMC: ListNames failed:', e.message);
        }

        this._nameWatchId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus',
            'org.freedesktop.DBus',
            'NameOwnerChanged',
            '/org/freedesktop/DBus',
            null,
            Gio.DBusSignalFlags.NONE,
            this._onNameOwnerChanged.bind(this)
        );
    }

    _onNameOwnerChanged(_conn, _sender, _path, _iface, _signal, params) {
        const [name, oldOwner, newOwner] = params.deepUnpack();
        if (!name.startsWith('org.mpris.MediaPlayer2.')) return;
        if (newOwner && !oldOwner)
            this._addPlayer(name);
        else if (!newOwner && oldOwner)
            this._removePlayer(name);
    }

    async _addPlayer(busName) {
        if (this._players.has(busName)) return;
        try {
            const proxy = await new Promise((resolve, reject) => {
                new PlayerProxy(
                    Gio.DBus.session,
                    busName,
                    '/org/mpris/MediaPlayer2',
                    (p, err) => err ? reject(err) : resolve(p)
                );
            });

            const entry = { proxy, lastChanged: Date.now() };
            this._players.set(busName, entry);

            proxy.connect('g-properties-changed', () => {
                entry.lastChanged = Date.now();
                if (proxy.PlaybackStatus === 'Playing')
                    this._activePlayerName = busName;
                else if (!this._activePlayerName)
                    this._activePlayerName = busName;
                if (this._activePlayerName === busName)
                    this.emit('player-changed');
            });

            if (!this._activePlayerName || proxy.PlaybackStatus === 'Playing')
                this._activePlayerName = busName;

            this.emit('players-list-changed');
            if (this._activePlayerName === busName)
                this.emit('player-changed');
        } catch (e) {
            console.warn(`AMC: proxy failed for ${busName}:`, e.message);
        }
    }

    _removePlayer(busName) {
        if (!this._players.has(busName)) return;
        this._players.delete(busName);
        if (this._activePlayerName === busName)
            this._activePlayerName = this._pickBestPlayer();
        this.emit('players-list-changed');
        this.emit('player-changed');
    }

    _pickBestPlayer() {
        let best = null, bestTime = -1;
        for (const [name, entry] of this._players) {
            if (entry.proxy.PlaybackStatus === 'Playing') return name;
            if (entry.lastChanged > bestTime) { bestTime = entry.lastChanged; best = name; }
        }
        return best;
    }

    // ── Read API ──────────────────────────────────────────────────────────

    get activeProxy() {
        return this._players.get(this._activePlayerName)?.proxy ?? null;
    }

    getPlayerState() {
        const proxy = this.activeProxy;
        if (!proxy) return null;
        const meta = proxy.Metadata ?? {};
        const artistRaw = meta['xesam:artist']?.deepUnpack() ?? [];
        return {
            title:          meta['xesam:title']?.deepUnpack()  ?? '',
            artist:         Array.isArray(artistRaw) ? artistRaw.join(', ') : String(artistRaw),
            album:          meta['xesam:album']?.deepUnpack()  ?? '',
            artUrl:         meta['mpris:artUrl']?.deepUnpack() ?? '',
            length:         meta['mpris:length']?.deepUnpack() ?? 0,
            playbackStatus: proxy.PlaybackStatus ?? 'Stopped',
            shuffle:        proxy.Shuffle        ?? false,
            loopStatus:     proxy.LoopStatus     ?? 'None',
            volume:         proxy.Volume         ?? 1.0,
            position:       proxy.Position       ?? 0,
            trackId:        meta['mpris:trackid']?.deepUnpack() ?? '/org/mpris/MediaPlayer2/TrackList/NoTrack',
            playerName:     this._activePlayerName ?? '',
        };
    }

    getPlayerList() {
        return [...this._players.entries()].map(([busName, entry]) => ({
            busName,
            displayName: busName.replace('org.mpris.MediaPlayer2.', ''),
            isActive:    busName === this._activePlayerName,
            isPlaying:   entry.proxy.PlaybackStatus === 'Playing',
        }));
    }

    // ── Command API ───────────────────────────────────────────────────────

    playPause()  { this.activeProxy?.PlayPauseAsync().catch(e => console.warn('AMC:', e.message)); }
    next()       { this.activeProxy?.NextAsync().catch(e => console.warn('AMC:', e.message)); }
    previous()   { this.activeProxy?.PreviousAsync().catch(e => console.warn('AMC:', e.message)); }

    seekTo(positionMicroseconds) {
        const state = this.getPlayerState();
        if (!state) return;
        this.activeProxy?.SetPositionAsync(state.trackId, positionMicroseconds)
            .catch(e => console.warn('AMC seekTo:', e.message));
    }

    setVolume(vol) {
        if (!this.activeProxy) return;
        this.activeProxy.Volume = Math.max(0.0, Math.min(1.0, vol));
    }

    setShuffle(val) {
        if (!this.activeProxy) return;
        this.activeProxy.Shuffle = val;
    }

    setLoopStatus(val) {
        if (!this.activeProxy) return;
        this.activeProxy.LoopStatus = val;
    }

    setActive(busName) {
        if (!this._players.has(busName)) return;
        this._activePlayerName = busName;
        this.emit('player-changed');
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    destroy() {
        if (this._nameWatchId) {
            Gio.DBus.session.signal_unsubscribe(this._nameWatchId);
            this._nameWatchId = 0;
        }
        this._players.clear();
        this._activePlayerName = null;
    }
});
```

Save to: `/home/safwan/awesome-media-controller/lib/mpris.js`

- [ ] **Step 2: Update extension.js to create the watcher**

```javascript
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { MprisWatcher } from './lib/mpris.js';

export default class AwesomeMediaController extends Extension {
    enable() {
        this._watcher = new MprisWatcher();
        this._watcher.connect('player-changed', () => {
            const state = this._watcher.getPlayerState();
            console.log('AMC player-changed:', state?.title, state?.playbackStatus);
        });
        this._watcher.connect('players-list-changed', () => {
            const list = this._watcher.getPlayerList();
            console.log('AMC players:', list.map(p => p.displayName).join(', '));
        });
    }

    disable() {
        this._watcher?.destroy();
        this._watcher = null;
    }
}
```

- [ ] **Step 3: Sync, reload, and verify player discovery in logs**

```bash
EXT=awesome-media-controller@awesome
rsync -a --delete \
  --exclude='.git' --exclude='docs' --exclude='.superpowers' \
  /home/safwan/awesome-media-controller/ \
  ~/.local/share/gnome-shell/extensions/$EXT/
gnome-extensions disable $EXT 2>/dev/null; sleep 0.5; gnome-extensions enable $EXT
journalctl -n 20 -o cat /usr/bin/gnome-shell | grep -i "amc"
```

Expected output includes: `AMC players: spotify` and `AMC player-changed: love lost Playing`

- [ ] **Step 4: Commit**

```bash
cd /home/safwan/awesome-media-controller
git add lib/mpris.js extension.js
git commit -m "feat: MPRIS D-Bus watcher with player discovery and GObject signals"
```

---

## Task 3: Panel widget — Aurora Glass pill (lib/panel-widget.js)

**Files:**
- Create: `lib/panel-widget.js`
- Modify: `extension.js`

- [ ] **Step 1: Write lib/panel-widget.js**

```javascript
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export const PanelWidget = GObject.registerClass(
class PanelWidget extends PanelMenu.Button {

    _init(watcher) {
        super._init(0.5, 'Awesome Media Controller', false);
        this._watcher = watcher;
        this._playerChangedId = 0;
        this._marqueeTimerId = 0;
        this._currentArtUrl = '';
        this._buildUI();
        this._connectSignals();
        Main.panel.addToStatusArea('awesome-media-controller', this);
    }

    _buildUI() {
        // Aurora glass pill container
        this._pill = new St.BoxLayout({
            style: [
                'background-color: rgba(20, 14, 36, 0.88)',
                'border: 1px solid rgba(139, 92, 246, 0.3)',
                'border-radius: 999px',
                'padding: 3px 10px 3px 5px',
                'spacing: 0px',
            ].join(';'),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._pill);

        // Album art thumbnail (22×22 rounded square)
        this._artActor = new St.Widget({
            width: 22,
            height: 22,
            style: [
                'background-image: linear-gradient(135deg, #8b5cf6, #ec4899)',
                'border-radius: 5px',
            ].join(';'),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pill.add_child(this._artActor);

        // Text column
        const textBox = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin: 0 5px 0 7px;',
        });
        this._pill.add_child(textBox);

        this._titleLabel = new St.Label({
            text: '...',
            style: 'font-size: 11px; font-weight: bold; color: #ffffff;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._titleLabel.clutter_text.ellipsize = 3; // END
        this._titleLabel.clutter_text.max_length = 0;
        textBox.add_child(this._titleLabel);

        this._artistLabel = new St.Label({
            text: '',
            style: 'font-size: 9px; color: rgba(255,255,255,0.5);',
            y_align: Clutter.ActorAlign.CENTER,
        });
        textBox.add_child(this._artistLabel);

        // Control buttons
        const ctrlBox = new St.BoxLayout({
            style: 'spacing: 2px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pill.add_child(ctrlBox);

        this._prevBtn  = this._makeBtn('⏮');
        this._playBtn  = this._makeBtn('▶');
        this._nextBtn  = this._makeBtn('⏭');

        // Play button gets the gradient treatment
        this._playBtn.style = [
            'background-image: linear-gradient(135deg, #8b5cf6, #ec4899)',
            'border-radius: 50%',
            'width: 20px',
            'height: 20px',
            'color: #ffffff',
            'font-size: 9px',
            'margin: 0 2px',
        ].join(';');

        ctrlBox.add_child(this._prevBtn);
        ctrlBox.add_child(this._playBtn);
        ctrlBox.add_child(this._nextBtn);

        // Button click handlers — stop event so pill doesn't open the popup
        this._prevBtn.connect('clicked', (_btn) => {
            this._watcher.previous();
            return Clutter.EVENT_STOP;
        });
        this._playBtn.connect('clicked', (_btn) => {
            this._watcher.playPause();
            return Clutter.EVENT_STOP;
        });
        this._nextBtn.connect('clicked', (_btn) => {
            this._watcher.next();
            return Clutter.EVENT_STOP;
        });
    }

    _makeBtn(label) {
        return new St.Button({
            label,
            style: [
                'background-color: rgba(255,255,255,0.08)',
                'border-radius: 50%',
                'width: 20px',
                'height: 20px',
                'color: rgba(255,255,255,0.75)',
                'font-size: 9px',
            ].join(';'),
        });
    }

    _connectSignals() {
        this._playerChangedId = this._watcher.connect(
            'player-changed', () => this._update()
        );
        this._update();
    }

    _update() {
        const state = this._watcher.getPlayerState();
        if (!state || !state.title) {
            this.hide();
            return;
        }
        this.show();
        this._titleLabel.text  = state.title;
        this._artistLabel.text = state.artist;
        this._playBtn.label    = state.playbackStatus === 'Playing' ? '⏸' : '▶';
    }

    destroy() {
        if (this._playerChangedId) {
            this._watcher.disconnect(this._playerChangedId);
            this._playerChangedId = 0;
        }
        if (this._marqueeTimerId) {
            import('gi://GLib').then(({ default: GLib }) => GLib.source_remove(this._marqueeTimerId));
            this._marqueeTimerId = 0;
        }
        super.destroy();
    }
});
```

Save to: `/home/safwan/awesome-media-controller/lib/panel-widget.js`

- [ ] **Step 2: Update extension.js to create the widget**

```javascript
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { MprisWatcher } from './lib/mpris.js';
import { PanelWidget } from './lib/panel-widget.js';

export default class AwesomeMediaController extends Extension {
    enable() {
        this._watcher = new MprisWatcher();
        this._widget  = new PanelWidget(this._watcher);
    }

    disable() {
        this._widget?.destroy();
        this._widget = null;
        this._watcher?.destroy();
        this._watcher = null;
    }
}
```

- [ ] **Step 3: Sync and reload**

```bash
EXT=awesome-media-controller@awesome
rsync -a --delete \
  --exclude='.git' --exclude='docs' --exclude='.superpowers' \
  /home/safwan/awesome-media-controller/ \
  ~/.local/share/gnome-shell/extensions/$EXT/
gnome-extensions disable $EXT 2>/dev/null; sleep 0.5; gnome-extensions enable $EXT
```

Expected: Aurora glass pill appears in the top bar right side showing the current track title, artist, and prev/play/next buttons.

- [ ] **Step 4: Manually test controls**

With Spotify open:
- Click `⏮` → track goes to previous (no popup appears)
- Click `▶/⏸` → playback toggles (button label updates)
- Click `⏭` → next track
- Click the pill body (text area) → popup opens (empty for now, that's fine)

- [ ] **Step 5: Commit**

```bash
cd /home/safwan/awesome-media-controller
git add lib/panel-widget.js extension.js
git commit -m "feat: Aurora Glass panel pill with track info and inline controls"
```

---

## Task 4: Popup — full card (lib/popup.js, part 1: layout + track info)

**Files:**
- Create: `lib/popup.js`
- Modify: `lib/panel-widget.js`

- [ ] **Step 1: Write lib/popup.js — container + track info section**

```javascript
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// ── helpers ────────────────────────────────────────────────────────────────

export function formatTime(microseconds) {
    const s = Math.floor(Math.max(0, microseconds) / 1_000_000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ── MediaPopup ─────────────────────────────────────────────────────────────

export const MediaPopup = GObject.registerClass(
class MediaPopup extends GObject.Object {

    _init(panelButton, watcher) {
        super._init();
        this._btn     = panelButton;
        this._watcher = watcher;
        this._playerChangedId   = 0;
        this._playersListId     = 0;
        this._posTimerId        = 0;
        this._position          = 0;
        this._length            = 0;
        this._buildMenu();
        this._connectSignals();
    }

    _buildMenu() {
        const menu = this._btn.menu;

        // Override the default popup menu box style with aurora glass
        menu.box.set_style([
            'background-color: rgba(12, 9, 22, 0.95)',
            'border: 1px solid rgba(139, 92, 246, 0.2)',
            'border-radius: 20px',
            'padding: 0',
            'min-width: 0',
        ].join(';'));

        // Single PopupBaseMenuItem containing our card
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: '',
        });
        item.remove_all_children();
        item.set_style('padding: 0; margin: 0; border: none;');

        this._card = this._buildCard();
        item.add_child(this._card);
        menu.addMenuItem(item);

        // Update popup when opened
        menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._updateAll();
                this._startPositionTimer();
            } else {
                this._stopPositionTimer();
            }
        });
    }

    _buildCard() {
        // Outer card — 280px wide, aurora glow blobs via pseudo-elements not possible in St
        // so we use a dark base + purple border glow
        const card = new St.BoxLayout({
            vertical: true,
            style: [
                'padding: 16px 16px 14px 16px',
                'width: 280px',
            ].join(';'),
        });

        // ── Album art ─────────────────────────────────────────────────────
        this._artWidget = new St.Widget({
            height: 248,
            style: [
                'background-image: linear-gradient(135deg, #8b5cf6, #ec4899, #06b6d4)',
                'border-radius: 14px',
                'margin-bottom: 14px',
            ].join(';'),
        });
        card.add_child(this._artWidget);

        // ── Track info ────────────────────────────────────────────────────
        this._popupTitle = new St.Label({
            text: '',
            style: 'font-size: 16px; font-weight: bold; color: #ffffff; margin-bottom: 2px;',
        });
        this._popupTitle.clutter_text.ellipsize = 3;
        card.add_child(this._popupTitle);

        this._popupArtist = new St.Label({
            text: '',
            style: 'font-size: 12px; color: rgba(255,255,255,0.5); margin-bottom: 2px;',
        });
        card.add_child(this._popupArtist);

        this._popupAlbum = new St.Label({
            text: '',
            style: 'font-size: 10px; color: rgba(255,255,255,0.28); margin-bottom: 12px;',
        });
        card.add_child(this._popupAlbum);

        // ── Progress bar ──────────────────────────────────────────────────
        // Container for track + fill overlay
        this._progressContainer = new St.Widget({
            height: 16,         // tall hit target
            x_expand: true,
            style: 'margin-bottom: 4px;',
        });
        card.add_child(this._progressContainer);

        const progressTrack = new St.Widget({
            height: 3,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'background-color: rgba(255,255,255,0.1); border-radius: 99px;',
        });
        this._progressContainer.add_child(progressTrack);

        this._progressFill = new St.Widget({
            height: 3,
            width: 0,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'background-image: linear-gradient(to right, #8b5cf6, #ec4899); border-radius: 99px;',
        });
        this._progressContainer.add_child(this._progressFill);

        // Scrub on click
        this._progressContainer.reactive = true;
        this._progressContainer.connect('button-press-event', (_actor, event) => {
            const [x] = event.get_coords();
            const [actorX] = this._progressContainer.get_transformed_position();
            const w = this._progressContainer.width;
            const fraction = Math.max(0, Math.min(1, (x - actorX) / w));
            this._watcher.seekTo(Math.floor(fraction * this._length));
            return Clutter.EVENT_STOP;
        });

        // Time labels
        const timeRow = new St.BoxLayout({
            style: 'spacing: 0px; margin-bottom: 10px;',
        });
        this._elapsedLabel = new St.Label({
            text: '0:00',
            style: 'font-size: 9px; color: rgba(255,255,255,0.3);',
            x_expand: true,
        });
        this._totalLabel = new St.Label({
            text: '0:00',
            style: 'font-size: 9px; color: rgba(255,255,255,0.3);',
        });
        timeRow.add_child(this._elapsedLabel);
        timeRow.add_child(this._totalLabel);
        card.add_child(timeRow);

        // ── Controls row ──────────────────────────────────────────────────
        const ctrlRow = new St.BoxLayout({
            style: 'spacing: 8px; margin-bottom: 12px;',
            x_align: Clutter.ActorAlign.CENTER,
        });
        card.add_child(ctrlRow);

        this._shuffleBtn = this._makePopupBtn('🔀', 28);
        this._prevBtn2   = this._makePopupBtn('⏮', 34);
        this._playBtn2   = this._makePopupBtn('▶', 46);
        this._nextBtn2   = this._makePopupBtn('⏭', 34);
        this._repeatBtn  = this._makePopupBtn('🔁', 28);

        this._playBtn2.style = [
            'background-image: linear-gradient(135deg, #8b5cf6, #ec4899)',
            'border-radius: 50%',
            'width: 46px',
            'height: 46px',
            'color: #ffffff',
            'font-size: 17px',
        ].join(';');

        ctrlRow.add_child(this._shuffleBtn);
        ctrlRow.add_child(this._prevBtn2);
        ctrlRow.add_child(this._playBtn2);
        ctrlRow.add_child(this._nextBtn2);
        ctrlRow.add_child(this._repeatBtn);

        this._shuffleBtn.connect('clicked', () => {
            const state = this._watcher.getPlayerState();
            if (state) this._watcher.setShuffle(!state.shuffle);
        });
        this._prevBtn2.connect('clicked',  () => this._watcher.previous());
        this._playBtn2.connect('clicked',  () => this._watcher.playPause());
        this._nextBtn2.connect('clicked',  () => this._watcher.next());
        this._repeatBtn.connect('clicked', () => {
            const state = this._watcher.getPlayerState();
            if (!state) return;
            const next = { None: 'Track', Track: 'Playlist', Playlist: 'None' }[state.loopStatus] ?? 'None';
            this._watcher.setLoopStatus(next);
        });

        // ── Volume row ────────────────────────────────────────────────────
        const volRow = new St.BoxLayout({
            style: 'spacing: 8px; margin-bottom: 12px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        card.add_child(volRow);

        volRow.add_child(new St.Label({
            text: '🔇',
            style: 'font-size: 12px; color: rgba(255,255,255,0.3);',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this._volContainer = new St.Widget({
            height: 16,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const volTrack = new St.Widget({
            height: 3,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'background-color: rgba(255,255,255,0.1); border-radius: 99px;',
        });
        this._volFill = new St.Widget({
            height: 3,
            width: 0,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'background-image: linear-gradient(to right, #8b5cf6, #ec4899); border-radius: 99px;',
        });
        this._volContainer.add_child(volTrack);
        this._volContainer.add_child(this._volFill);
        this._volContainer.reactive = true;
        this._volContainer.connect('button-press-event', (_actor, event) => {
            const [x] = event.get_coords();
            const [ax] = this._volContainer.get_transformed_position();
            const fraction = Math.max(0, Math.min(1, (x - ax) / this._volContainer.width));
            this._watcher.setVolume(fraction);
            this._updateVolBar(fraction);
            return Clutter.EVENT_STOP;
        });
        volRow.add_child(this._volContainer);

        volRow.add_child(new St.Label({
            text: '🔊',
            style: 'font-size: 12px; color: rgba(255,255,255,0.3);',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        // ── Separator ─────────────────────────────────────────────────────
        card.add_child(new St.Widget({
            height: 1,
            x_expand: true,
            style: 'background-color: rgba(255,255,255,0.07); margin-bottom: 12px;',
        }));

        // ── Player switcher ───────────────────────────────────────────────
        this._switcherLabel = new St.Label({
            text: 'ACTIVE PLAYERS',
            style: 'font-size: 9px; font-weight: bold; color: rgba(255,255,255,0.2); margin-bottom: 8px; letter-spacing: 1.5px;',
        });
        card.add_child(this._switcherLabel);

        this._switcherRow = new St.BoxLayout({
            style: 'spacing: 6px;',
        });
        card.add_child(this._switcherRow);

        return card;
    }

    _makePopupBtn(label, size) {
        return new St.Button({
            label,
            style: [
                'background-color: rgba(255,255,255,0.07)',
                'border-radius: 50%',
                `width: ${size}px`,
                `height: ${size}px`,
                'color: rgba(255,255,255,0.65)',
                `font-size: ${Math.floor(size * 0.35)}px`,
            ].join(';'),
        });
    }

    // ── Updates ────────────────────────────────────────────────────────────

    _updateAll() {
        const state = this._watcher.getPlayerState();
        if (!state) return;

        this._popupTitle.text  = state.title;
        this._popupArtist.text = state.artist;
        this._popupAlbum.text  = state.album;

        this._position = state.position;
        this._length   = state.length;
        this._updateProgress();

        this._playBtn2.label  = state.playbackStatus === 'Playing' ? '⏸' : '▶';
        this._shuffleBtn.style = this._toggleBtnStyle(state.shuffle, 28);
        this._repeatBtn.style  = this._toggleBtnStyle(state.loopStatus !== 'None', 28);

        this._updateVolBar(state.volume);
        this._updateSwitcher();
        this._loadArt(state.artUrl);
    }

    _updateProgress() {
        this._elapsedLabel.text = formatTime(this._position);
        this._totalLabel.text   = formatTime(this._length);
        const w = this._progressContainer.width;
        if (w > 0 && this._length > 0) {
            const fraction = Math.max(0, Math.min(1, this._position / this._length));
            this._progressFill.width = Math.floor(w * fraction);
        }
    }

    _updateVolBar(vol) {
        const w = this._volContainer.width;
        if (w > 0) this._volFill.width = Math.floor(w * Math.max(0, Math.min(1, vol)));
    }

    _toggleBtnStyle(active, size) {
        return active
            ? ['background-color: rgba(139,92,246,0.3)', 'border-radius: 50%', `width: ${size}px`, `height: ${size}px`, 'color: #a78bfa', `font-size: ${Math.floor(size * 0.35)}px`].join(';')
            : ['background-color: rgba(255,255,255,0.07)', 'border-radius: 50%', `width: ${size}px`, `height: ${size}px`, 'color: rgba(255,255,255,0.65)', `font-size: ${Math.floor(size * 0.35)}px`].join(';');
    }

    _updateSwitcher() {
        this._switcherRow.remove_all_children();
        const players = this._watcher.getPlayerList();
        for (const player of players) {
            const pill = this._makePlayerPill(player);
            this._switcherRow.add_child(pill);
        }
        // Hide label + row when only one player
        const visible = players.length > 1;
        this._switcherLabel.visible = visible;
        this._switcherRow.visible   = visible;
    }

    _makePlayerPill(player) {
        const dotColor = this._playerColor(player.displayName);
        const dot = new St.Widget({
            width: 6, height: 6,
            style: `background-color: ${dotColor}; border-radius: 50%;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const label = new St.Label({
            text: player.displayName,
            style: 'font-size: 10px; font-weight: bold;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const row = new St.BoxLayout({
            style: 'spacing: 5px; padding: 4px 10px;',
            reactive: true,
        });
        row.add_child(dot);
        row.add_child(label);

        if (player.isActive) {
            row.style = [
                'background-color: rgba(139,92,246,0.2)',
                'border: 1px solid rgba(139,92,246,0.4)',
                'border-radius: 99px',
                'spacing: 5px',
                'padding: 4px 10px',
            ].join(';');
            label.style = 'font-size: 10px; font-weight: bold; color: #a78bfa;';
        } else {
            row.style = [
                'background-color: rgba(255,255,255,0.05)',
                'border: 1px solid rgba(255,255,255,0.08)',
                'border-radius: 99px',
                'spacing: 5px',
                'padding: 4px 10px',
            ].join(';');
            label.style = 'font-size: 10px; font-weight: bold; color: rgba(255,255,255,0.4);';
            row.connect('button-press-event', () => {
                this._watcher.setActive(player.busName);
                return Clutter.EVENT_STOP;
            });
        }
        return row;
    }

    _playerColor(name) {
        const n = name.toLowerCase();
        if (n.includes('spotify')) return '#1db954';
        if (n.includes('firefox') || n.includes('chromium') || n.includes('chrome')) return '#ff7139';
        if (n.includes('vlc'))     return '#ff8800';
        if (n.includes('rhythmbox') || n.includes('clementine')) return '#e87722';
        return '#8b5cf6';
    }

    _loadArt(_url) {
        // Placeholder — real implementation added in Task 5
    }

    // ── Position timer ─────────────────────────────────────────────────────

    _startPositionTimer() {
        this._stopPositionTimer();
        this._posTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            const state = this._watcher.getPlayerState();
            if (state?.playbackStatus === 'Playing') {
                this._position += 1_000_000; // +1 second
                this._updateProgress();
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPositionTimer() {
        if (this._posTimerId) {
            GLib.source_remove(this._posTimerId);
            this._posTimerId = 0;
        }
    }

    // ── Signal wiring ──────────────────────────────────────────────────────

    _connectSignals() {
        this._playerChangedId = this._watcher.connect('player-changed', () => {
            if (this._btn.menu.isOpen) this._updateAll();
        });
        this._playersListId = this._watcher.connect('players-list-changed', () => {
            if (this._btn.menu.isOpen) this._updateSwitcher();
        });
    }

    destroy() {
        this._stopPositionTimer();
        if (this._playerChangedId) {
            this._watcher.disconnect(this._playerChangedId);
            this._playerChangedId = 0;
        }
        if (this._playersListId) {
            this._watcher.disconnect(this._playersListId);
            this._playersListId = 0;
        }
    }
});
```

Save to: `/home/safwan/awesome-media-controller/lib/popup.js`

- [ ] **Step 2: Wire popup into panel-widget.js — replace the `_buildUI` constructor section**

Add the import at the top of `lib/panel-widget.js`:

```javascript
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { MediaPopup } from './popup.js';
```

Add popup creation at the end of `_init()` in PanelWidget, after `this._connectSignals()`:

```javascript
_init(watcher) {
    super._init(0.5, 'Awesome Media Controller', false);
    this._watcher = watcher;
    this._playerChangedId = 0;
    this._marqueeTimerId = 0;
    this._currentArtUrl = '';
    this._buildUI();
    this._connectSignals();
    this._popup = new MediaPopup(this, watcher);  // ← add this line
    Main.panel.addToStatusArea('awesome-media-controller', this);
}
```

Add `this._popup?.destroy()` before `super.destroy()` in `PanelWidget.destroy()`:

```javascript
destroy() {
    if (this._playerChangedId) {
        this._watcher.disconnect(this._playerChangedId);
        this._playerChangedId = 0;
    }
    this._popup?.destroy();
    this._popup = null;
    super.destroy();
}
```

- [ ] **Step 3: Sync and reload**

```bash
EXT=awesome-media-controller@awesome
rsync -a --delete \
  --exclude='.git' --exclude='docs' --exclude='.superpowers' \
  /home/safwan/awesome-media-controller/ \
  ~/.local/share/gnome-shell/extensions/$EXT/
gnome-extensions disable $EXT 2>/dev/null; sleep 0.5; gnome-extensions enable $EXT
```

- [ ] **Step 4: Test the popup**

- Click the pill → dark glass card drops down
- Song title, artist, album visible
- Progress bar shows position (fills as track plays)
- Clicking progress bar scrubs the track
- Play/pause/prev/next buttons in popup work
- Shuffle turns purple when active; repeat cycles None→Track→Playlist
- Volume bar click adjusts volume

- [ ] **Step 5: Commit**

```bash
cd /home/safwan/awesome-media-controller
git add lib/popup.js lib/panel-widget.js
git commit -m "feat: full-card popup with progress, volume, controls, player switcher"
```

---

## Task 5: Album art async loading

**Files:**
- Modify: `lib/popup.js`
- Modify: `lib/panel-widget.js`

- [ ] **Step 1: Add art loading helpers at the top of lib/popup.js**

Add these imports at the very top of `lib/popup.js`:

```javascript
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
```

Add these functions right after the imports, before the `formatTime` function:

```javascript
let _soupSession = null;
function getSoupSession() {
    if (!_soupSession) _soupSession = new Soup.Session();
    return _soupSession;
}

async function resolveArtPath(url) {
    if (!url) return null;

    if (url.startsWith('file://')) {
        const path = GLib.filename_from_uri(url, null)[0];
        return GLib.file_test(path, GLib.FileTest.EXISTS) ? path : null;
    }

    // Cache HTTPS art to /tmp so we don't re-download on every update
    const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, url, -1);
    const cachePath = `${GLib.get_tmp_dir()}/amc-art-${hash}`;

    if (GLib.file_test(cachePath, GLib.FileTest.EXISTS)) return cachePath;

    try {
        const msg   = Soup.Message.new('GET', url);
        const bytes = await getSoupSession().send_and_read_async(
            msg, GLib.PRIORITY_LOW, null
        );
        const file = Gio.File.new_for_path(cachePath);
        await file.replace_contents_bytes_async(
            bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null
        );
        return cachePath;
    } catch (e) {
        console.warn('AMC art load failed:', e.message);
        return null;
    }
}
```

- [ ] **Step 2: Replace the `_loadArt` stub in MediaPopup with the real implementation**

Replace the stub `_loadArt(_url) {}` in `lib/popup.js` with:

```javascript
_loadArt(url) {
    if (url === this._currentArtUrl) return;
    this._currentArtUrl = url;

    // Reset to gradient placeholder immediately
    this._artWidget.set_style([
        'background-image: linear-gradient(135deg, #8b5cf6, #ec4899, #06b6d4)',
        'border-radius: 14px',
        'margin-bottom: 14px',
    ].join(';'));

    if (!url) return;

    resolveArtPath(url).then(path => {
        if (path && url === this._currentArtUrl) {
            this._artWidget.set_style([
                `background-image: url("file://${path}")`,
                'background-size: cover',
                'border-radius: 14px',
                'margin-bottom: 14px',
            ].join(';'));
        }
    }).catch(() => {});
}
```

Also add `this._currentArtUrl = ''` to the field initialisations at the top of `_init`:

```javascript
_init(panelButton, watcher) {
    super._init();
    this._btn            = panelButton;
    this._watcher        = watcher;
    this._playerChangedId = 0;
    this._playersListId   = 0;
    this._posTimerId      = 0;
    this._position        = 0;
    this._length          = 0;
    this._currentArtUrl   = '';   // ← add this
    this._buildMenu();
    this._connectSignals();
}
```

- [ ] **Step 3: Add art thumbnail to the panel pill (lib/panel-widget.js)**

Add to the top of `lib/panel-widget.js`:

```javascript
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
```

Add these helpers after the imports in `lib/panel-widget.js` (same `resolveArtPath` function — duplicate it here for module independence):

```javascript
let _soupSession = null;
function getPillSession() {
    if (!_soupSession) _soupSession = new Soup.Session();
    return _soupSession;
}

async function resolveArtPath(url) {
    if (!url) return null;
    if (url.startsWith('file://')) {
        const path = GLib.filename_from_uri(url, null)[0];
        return GLib.file_test(path, GLib.FileTest.EXISTS) ? path : null;
    }
    const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, url, -1);
    const cachePath = `${GLib.get_tmp_dir()}/amc-art-${hash}`;
    if (GLib.file_test(cachePath, GLib.FileTest.EXISTS)) return cachePath;
    try {
        const msg   = Soup.Message.new('GET', url);
        const bytes = await getPillSession().send_and_read_async(msg, GLib.PRIORITY_LOW, null);
        const file  = Gio.File.new_for_path(cachePath);
        await file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        return cachePath;
    } catch (_e) { return null; }
}
```

Add `this._currentArtUrl = ''` in `PanelWidget._init` and add `_loadPillArt` method, then call it from `_update`:

In `PanelWidget._update()`, add after the label updates:

```javascript
_update() {
    const state = this._watcher.getPlayerState();
    if (!state || !state.title) { this.hide(); return; }
    this.show();
    this._titleLabel.text  = state.title;
    this._artistLabel.text = state.artist;
    this._playBtn.label    = state.playbackStatus === 'Playing' ? '⏸' : '▶';
    this._loadPillArt(state.artUrl);   // ← add this call
}
```

Add the `_loadPillArt` method to `PanelWidget`:

```javascript
_loadPillArt(url) {
    if (url === this._currentArtUrl) return;
    this._currentArtUrl = url;
    // Reset to gradient
    this._artActor.set_style([
        'background-image: linear-gradient(135deg, #8b5cf6, #ec4899)',
        'border-radius: 5px',
        'width: 22px',
        'height: 22px',
    ].join(';'));
    if (!url) return;
    resolveArtPath(url).then(path => {
        if (path && url === this._currentArtUrl) {
            this._artActor.set_style([
                `background-image: url("file://${path}")`,
                'background-size: cover',
                'border-radius: 5px',
                'width: 22px',
                'height: 22px',
            ].join(';'));
        }
    }).catch(() => {});
}
```

- [ ] **Step 4: Sync, reload, and verify album art**

```bash
EXT=awesome-media-controller@awesome
rsync -a --delete \
  --exclude='.git' --exclude='docs' --exclude='.superpowers' \
  /home/safwan/awesome-media-controller/ \
  ~/.local/share/gnome-shell/extensions/$EXT/
gnome-extensions disable $EXT 2>/dev/null; sleep 0.5; gnome-extensions enable $EXT
```

Expected:
- The 22×22 pill thumbnail shows the album art (should load within ~1s for Spotify)
- The popup's big square shows the album art when opened
- When track changes, the art updates

- [ ] **Step 5: Commit**

```bash
cd /home/safwan/awesome-media-controller
git add lib/popup.js lib/panel-widget.js
git commit -m "feat: async album art loading with /tmp cache, shown in pill and popup"
```

---

## Task 6: Title marquee scroll for long song names

**Files:**
- Modify: `lib/panel-widget.js`

- [ ] **Step 1: Add marquee logic to PanelWidget**

Add `GLib` to the imports at the top of `lib/panel-widget.js`:

```javascript
import GLib from 'gi://GLib';
```

Replace the `_connectSignals` method in `PanelWidget` with:

```javascript
_connectSignals() {
    this._playerChangedId = this._watcher.connect(
        'player-changed', () => this._update()
    );
    // Pause marquee when popup opens, resume when it closes
    this.menu.connect('open-state-changed', (_menu, open) => {
        if (open) this._stopMarquee();
        else      this._startMarquee();
    });
    this._update();
}
```

Add these three marquee methods to `PanelWidget`:

```javascript
_startMarquee() {
    this._stopMarquee();
    const text = this._titleLabel.text;
    if (text.length <= 18) return; // Short enough, no scrolling needed

    let offset = 0;
    const totalWidth = this._titleLabel.get_preferred_width(-1)[1];
    const visibleWidth = 130; // approximate visible width in px

    this._marqueeTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
        offset += 1;
        if (offset > totalWidth - visibleWidth + 20)
            offset = -visibleWidth;
        this._titleLabel.translation_x = -Math.max(0, offset);
        return GLib.SOURCE_CONTINUE;
    });
}

_stopMarquee() {
    if (this._marqueeTimerId) {
        GLib.source_remove(this._marqueeTimerId);
        this._marqueeTimerId = 0;
    }
    this._titleLabel.translation_x = 0;
}
```

Update `_update()` to restart the marquee when track changes:

```javascript
_update() {
    const state = this._watcher.getPlayerState();
    if (!state || !state.title) { this.hide(); this._stopMarquee(); return; }
    this.show();
    this._stopMarquee();
    this._titleLabel.text  = state.title;
    this._artistLabel.text = state.artist;
    this._playBtn.label    = state.playbackStatus === 'Playing' ? '⏸' : '▶';
    this._loadPillArt(state.artUrl);
    if (!this.menu.isOpen) this._startMarquee();
}
```

Update `destroy()` to call `_stopMarquee()`:

```javascript
destroy() {
    if (this._playerChangedId) {
        this._watcher.disconnect(this._playerChangedId);
        this._playerChangedId = 0;
    }
    this._stopMarquee();
    this._popup?.destroy();
    this._popup = null;
    super.destroy();
}
```

- [ ] **Step 2: Sync, reload, and test**

```bash
EXT=awesome-media-controller@awesome
rsync -a --delete \
  --exclude='.git' --exclude='docs' --exclude='.superpowers' \
  /home/safwan/awesome-media-controller/ \
  ~/.local/share/gnome-shell/extensions/$EXT/
gnome-extensions disable $EXT 2>/dev/null; sleep 0.5; gnome-extensions enable $EXT
```

Expected: songs with titles longer than ~18 chars scroll left in the pill. Scrolling pauses when the popup is open, resumes when it closes.

- [ ] **Step 3: Commit**

```bash
cd /home/safwan/awesome-media-controller
git add lib/panel-widget.js
git commit -m "feat: marquee scroll for long titles in panel pill"
```

---

## Task 7: Final wiring — full extension.js and install script

**Files:**
- Verify: `extension.js` — already complete from Task 2
- Create: `install.sh`

- [ ] **Step 1: Verify extension.js is the clean version from Task 2**

The file should be exactly:

```javascript
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { MprisWatcher } from './lib/mpris.js';
import { PanelWidget } from './lib/panel-widget.js';

export default class AwesomeMediaController extends Extension {
    enable() {
        this._watcher = new MprisWatcher();
        this._widget  = new PanelWidget(this._watcher);
    }

    disable() {
        this._widget?.destroy();
        this._widget = null;
        this._watcher?.destroy();
        this._watcher = null;
    }
}
```

If it still has the debug `console.log` statements from Task 2, replace the file with the content above.

- [ ] **Step 2: Create install.sh**

```bash
#!/usr/bin/env bash
set -e

EXT="awesome-media-controller@awesome"
DEST="$HOME/.local/share/gnome-shell/extensions/$EXT"

echo "Installing Awesome Media Controller..."
mkdir -p "$DEST"

rsync -a --delete \
  --exclude='.git' \
  --exclude='docs' \
  --exclude='.superpowers' \
  --exclude='install.sh' \
  "$(dirname "$0")/" \
  "$DEST/"

echo "Reloading extension..."
gnome-extensions disable "$EXT" 2>/dev/null || true
sleep 0.5
gnome-extensions enable "$EXT"

echo "Done! Check journalctl for errors:"
echo "  journalctl -f -o cat /usr/bin/gnome-shell | grep -i amc"
```

Save to: `/home/safwan/awesome-media-controller/install.sh`

```bash
chmod +x /home/safwan/awesome-media-controller/install.sh
```

- [ ] **Step 3: Run a full clean install via the script**

```bash
cd /home/safwan/awesome-media-controller
bash install.sh
```

Expected: Script prints "Done!" with no errors.

- [ ] **Step 4: Full end-to-end test**

Checklist:
- [ ] Aurora glass pill visible in top bar
- [ ] Title and artist shown correctly
- [ ] Pill thumbnail shows album art
- [ ] Long song titles scroll (marquee)
- [ ] `⏮` / `⏸` / `⏭` buttons work from the pill (no popup)
- [ ] Clicking the pill body opens the full card popup
- [ ] Popup shows big album art
- [ ] Track title, artist, album shown in popup
- [ ] Progress bar advances every second while playing
- [ ] Clicking the progress bar scrubs to that position
- [ ] Play/pause, prev, next in the popup work
- [ ] Shuffle button toggles purple ↔ dim
- [ ] Repeat cycles None → Track → Playlist
- [ ] Volume bar drag adjusts volume
- [ ] Player switcher row appears when multiple players are active
- [ ] Clicking an inactive player pill switches the active player
- [ ] Popup closes cleanly, marquee resumes

- [ ] **Step 5: Check logs for any warnings**

```bash
journalctl -n 50 -o cat /usr/bin/gnome-shell | grep -i "amc\|js error\|extension"
```

Expected: only `AMC:` startup messages, no error/warning lines.

- [ ] **Step 6: Final commit**

```bash
cd /home/safwan/awesome-media-controller
git add extension.js install.sh
git commit -m "feat: install script and final clean extension.js — extension complete"
```

---

## Quick Reference

| Action | Command |
|--------|---------|
| Install + reload | `bash /home/safwan/awesome-media-controller/install.sh` |
| Watch logs | `journalctl -f -o cat /usr/bin/gnome-shell \| grep -i amc` |
| Open Looking Glass | Alt+F2 → type `lg` → Enter (X11 only) |
| Disable extension | `gnome-extensions disable awesome-media-controller@awesome` |
| List errors | `gnome-extensions info awesome-media-controller@awesome` |
| GitHub: init repo | `cd ~/awesome-media-controller && git remote add origin <url> && git push -u origin master` |
