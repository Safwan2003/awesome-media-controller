import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { MediaPopup } from './popup.js';

export const PanelWidget = GObject.registerClass(
class PanelWidget extends PanelMenu.Button {

    _init(watcher) {
        super._init(0.5, 'Awesome Media Controller', false);
        this._watcher = watcher;
        this._playerChangedId = 0;
        this._playersListChangedId = 0;
        this._marqueeTimerId = 0;
        this._currentArtUrl = '';
        this._popup = null;
        this._buildUI();
        this._connectSignals();
        this._popup = new MediaPopup(this, watcher);
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
        this._titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
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
            spacing: 2,
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
        this._playersListChangedId = this._watcher.connect(
            'players-list-changed', () => this._update()
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
        this._popup?.destroy();
        this._popup = null;
        if (this._playerChangedId) {
            this._watcher.disconnect(this._playerChangedId);
            this._playerChangedId = 0;
        }
        if (this._playersListChangedId) {
            this._watcher.disconnect(this._playersListChangedId);
            this._playersListChangedId = 0;
        }
        if (this._marqueeTimerId) {
            GLib.source_remove(this._marqueeTimerId);
            this._marqueeTimerId = 0;
        }
        super.destroy();
    }
});
