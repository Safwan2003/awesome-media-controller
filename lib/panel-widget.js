import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { resolveArtPath } from './art.js';
import { verticalBoxProps } from './compat.js';
import { MediaPopup } from './popup.js';

export const PanelWidget = GObject.registerClass(
class PanelWidget extends PanelMenu.Button {

    _init(watcher, theme, settings) {
        super._init(0.5, 'Awesome Media Controller', false);
        this._watcher  = watcher;
        this._theme    = theme;
        this._settings = settings;
        this._playerChangedId = 0;
        this._playersListChangedId = 0;
        this._themeChangedId = 0;
        this._settingsIds = [];
        this._marqueeTimerId = 0;
        this._currentArtUrl = '';
        this._artPath = null;
        this._popup = null;
        this._buildUI();
        this._connectSignals();
        this._applyTheme();
        this._popup = new MediaPopup(this, watcher, theme);

        const position = settings.get_string('panel-position');
        const boxes = { left: 'left', center: 'center', right: 'right' };
        Main.panel.addToStatusArea('awesome-media-controller', this, 1, boxes[position] ?? 'center');
    }

    _buildUI() {
        this._pill = new St.BoxLayout({
            style_class: 'amc-pill',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._pill);

        // Album art thumbnail (22×22 rounded square)
        this._artActor = new St.Widget({
            width: 22,
            height: 22,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pill.add_child(this._artActor);

        // Text column
        const textBox = new St.BoxLayout({
            ...verticalBoxProps(),
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin: 0 5px 0 7px;',
        });
        this._pill.add_child(textBox);

        this._titleLabel = new St.Label({
            text: '...',
            style_class: 'amc-pill-title',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        textBox.add_child(this._titleLabel);

        this._artistLabel = new St.Label({
            text: '',
            style_class: 'amc-pill-artist',
            y_align: Clutter.ActorAlign.CENTER,
        });
        textBox.add_child(this._artistLabel);

        // Control buttons
        this._ctrlBox = new St.BoxLayout({
            style: 'spacing: 2px;',
            y_align: Clutter.ActorAlign.CENTER,
            visible: this._settings.get_boolean('show-pill-controls'),
        });
        this._pill.add_child(this._ctrlBox);

        this._prevBtn = this._makeBtn('media-skip-backward-symbolic');
        this._playIcon = new St.Icon({
            icon_name: 'media-playback-start-symbolic',
            icon_size: 10,
        });
        this._playBtn = new St.Button({
            style_class: 'amc-btn-accent',
            child: this._playIcon,
        });
        this._nextBtn = this._makeBtn('media-skip-forward-symbolic');

        this._ctrlBox.add_child(this._prevBtn);
        this._ctrlBox.add_child(this._playBtn);
        this._ctrlBox.add_child(this._nextBtn);

        this._prevBtn.connect('clicked', () => {
            this._watcher.previous();
            return Clutter.EVENT_STOP;
        });
        this._playBtn.connect('clicked', () => {
            this._watcher.playPause();
            return Clutter.EVENT_STOP;
        });
        this._nextBtn.connect('clicked', () => {
            this._watcher.next();
            return Clutter.EVENT_STOP;
        });
    }

    _makeBtn(iconName) {
        return new St.Button({
            style_class: 'amc-btn',
            style: 'width: 20px; height: 20px;',
            child: new St.Icon({ icon_name: iconName, icon_size: 10 }),
        });
    }

    _applyTheme() {
        const t = this._theme;
        this._pill.style = this._pillStyle(0.30);
        this._playBtn.style = [
            `background-image: ${t.gradient()}`,
            'width: 20px',
            'height: 20px',
            'margin: 0 2px',
        ].join(';');
        this._applyArtStyle();
    }

    // Border + outer glow; alpha varies during the playing pulse
    _pillStyle(glowAlpha) {
        const t = this._theme;
        return `border: 1px solid ${t.glow(0.35)}; box-shadow: 0 0 10px ${t.glow(glowAlpha)};`;
    }

    _applyArtStyle() {
        const t = this._theme;
        const base = `border-radius: 5px; width: 22px; height: 22px; ` +
                     `border: 1px solid ${t.glow(0.6)}; box-shadow: 0 0 6px ${t.glow(0.4)};`;
        this._artActor.style = this._artPath
            ? `background-image: url("file://${this._artPath}"); background-size: cover; ${base}`
            : `background-image: ${t.gradient()}; ${base}`;
    }

    _connectSignals() {
        this._playerChangedId = this._watcher.connect(
            'player-changed', () => this._update()
        );
        this._playersListChangedId = this._watcher.connect(
            'players-list-changed', () => this._update()
        );
        this._themeChangedId = this._theme.connect(
            'changed', () => this._applyTheme()
        );
        this._settingsIds = [
            this._settings.connect('changed::show-pill-controls', () => {
                this._ctrlBox.visible = this._settings.get_boolean('show-pill-controls');
            }),
            this._settings.connect('changed::enable-marquee', () => {
                this._stopMarquee();
                if (this.visible && !this.menu.isOpen) this._startMarquee();
            }),
        ];
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) this._stopMarquee();
            else      this._startMarquee();
        });
        // The actor can be destroyed from C (e.g. shell shutdown) without our
        // destroy() override running — tear down handlers either way
        this.connect('destroy', () => this._teardown());
        this._update();
    }

    _update() {
        if (!this._titleLabel) return; // already torn down
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
        this._playIcon.icon_name = state.playbackStatus === 'Playing'
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._loadPillArt(state.artUrl);
        if (!this.menu.isOpen) this._startMarquee();
    }

    _startMarquee() {
        if (!this._titleLabel) return;
        if (!this._settings.get_boolean('enable-marquee')) return;
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
        this._artPath = null;
        this._applyArtStyle();
        if (!url) {
            this._theme.setArtPath(null);
            return;
        }
        resolveArtPath(url).then(path => {
            if (url !== this._currentArtUrl || !this._artActor) return;
            this._artPath = path;
            this._theme.setArtPath(path);
            this._applyArtStyle();
        }).catch(() => {});
    }

    _teardown() {
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
        if (this._themeChangedId) {
            this._theme.disconnect(this._themeChangedId);
            this._themeChangedId = 0;
        }
        for (const id of this._settingsIds) this._settings.disconnect(id);
        this._settingsIds = [];
        this._stopMarquee();
        this._titleLabel = null;
        this._artActor = null;
    }

    destroy() {
        this._teardown();
        super.destroy();
    }
});
