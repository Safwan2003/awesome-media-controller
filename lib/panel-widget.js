import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { MediaPopup } from './popup.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

// ── Pill art loading helpers ───────────────────────────────────────────────

let _pillSoupSession = null;
function getPillSession() {
    if (!_pillSoupSession) _pillSoupSession = new Soup.Session();
    return _pillSoupSession;
}

async function resolveArtPath(url) {
    if (!url) return null;
    if (url.startsWith('file://')) {
        const path = GLib.filename_from_uri(url)[0];
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
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) this._stopMarquee();
            else      this._startMarquee();
        });
        this._update();
    }

    _update() {
        const state = this._watcher.getPlayerState();
        if (!state || !state.title) {
            this.hide();
            this._stopMarquee();
            return;
        }
        this.show();
        this._stopMarquee();
        this._titleLabel.text  = state.title;
        this._artistLabel.text = state.artist;
        this._playBtn.label    = state.playbackStatus === 'Playing' ? '⏸' : '▶';
        this._loadPillArt(state.artUrl);
        if (!this.menu.isOpen) this._startMarquee();
    }

    _startMarquee() {
        if (!this._titleLabel) return;
        this._stopMarquee();
        const text = this._titleLabel.text;
        if (text.length <= 18) return;

        let offset = 0;
        const visibleWidth = 130;

        this._marqueeTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            if (!this._titleLabel) return GLib.SOURCE_REMOVE;
            const totalWidth = this._titleLabel.get_preferred_width(-1)[1];
            if (totalWidth <= visibleWidth) return GLib.SOURCE_CONTINUE;
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
        if (this._titleLabel)
            this._titleLabel.translation_x = 0;
    }

    _loadPillArt(url) {
        if (url === this._currentArtUrl) return;
        this._currentArtUrl = url;
        this._artActor.set_style([
            'background-image: linear-gradient(135deg, #8b5cf6, #ec4899)',
            'border-radius: 5px',
            'width: 22px',
            'height: 22px',
        ].join(';'));
        if (!url) return;
        resolveArtPath(url).then(path => {
            if (path && url === this._currentArtUrl && this._artActor) {
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
        this._stopMarquee();
        this._titleLabel = null;
        this._artActor = null;
        super.destroy();
    }
});
