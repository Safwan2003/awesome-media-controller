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
