import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class AwesomeMediaController extends Extension {
    enable() {
        console.log('AMC: enabled');
    }

    disable() {
        console.log('AMC: disabled');
    }
}
