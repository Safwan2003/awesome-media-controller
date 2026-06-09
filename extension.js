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
