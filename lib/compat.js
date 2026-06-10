import Clutter from 'gi://Clutter';
import { PACKAGE_VERSION } from 'resource:///org/gnome/shell/misc/config.js';

const SHELL_MAJOR = parseInt(PACKAGE_VERSION.split('.')[0], 10);

// St.BoxLayout's `vertical` was deprecated in favor of `orientation` in 48
export function verticalBoxProps() {
    return SHELL_MAJOR >= 48
        ? { orientation: Clutter.Orientation.VERTICAL }
        : { vertical: true };
}
