import GLib from 'gi://GLib';

// Gated logging: set AMC_DEBUG=1 in the environment to surface internal
// warnings in the journal. Quiet by default, per the extensions.gnome.org
// "no excessive logging" review guideline.
const DEBUG = GLib.getenv('AMC_DEBUG') === '1';

export function warn(...args) {
    if (DEBUG)
        console.warn(...args);
}
