import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
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
        this._openStateId       = 0;
        this._posTimerId        = 0;
        this._position          = 0;
        this._length            = 0;
        this._currentArtUrl     = '';
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
        this._openStateId = menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._updateAll();
                this._startPositionTimer();
            } else {
                this._stopPositionTimer();
            }
        });
    }

    _buildCard() {
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
        this._popupTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
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
        this._progressContainer = new St.Widget({
            height: 16,
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
            style: 'margin-bottom: 10px;',
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
            spacing: 8,
            style: 'margin-bottom: 12px;',
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
            spacing: 8,
            style: 'margin-bottom: 12px;',
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
            spacing: 6,
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
        this._switcherRow.destroy_all_children();
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
            spacing: 5,
            style: 'padding: 4px 10px;',
            reactive: true,
        });
        row.add_child(dot);
        row.add_child(label);

        if (player.isActive) {
            row.style = [
                'background-color: rgba(139,92,246,0.2)',
                'border: 1px solid rgba(139,92,246,0.4)',
                'border-radius: 99px',
                'padding: 4px 10px',
            ].join(';');
            row.reactive = false;
            label.style = 'font-size: 10px; font-weight: bold; color: #a78bfa;';
        } else {
            row.style = [
                'background-color: rgba(255,255,255,0.05)',
                'border: 1px solid rgba(255,255,255,0.08)',
                'border-radius: 99px',
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
                this._position = Math.min(this._position + 1_000_000, this._length || Infinity); // +1 second, capped at track length
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
        if (this._openStateId) {
            this._btn.menu.disconnect(this._openStateId);
            this._openStateId = 0;
        }
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
