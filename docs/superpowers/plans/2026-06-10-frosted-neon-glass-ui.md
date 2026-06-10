# Frosted Neon Glass UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the panel pill and popup as "Frosted Neon Glass" — layered faux-glass, neon accent glows, symbolic icons, animated EQ bars, glow pulse, popup entrance animation — and add six built-in preset themes plus an animations toggle.

**Architecture:** Visual-layer change on the existing extension. `theme.js` gains a `PRESETS` map and a third `accent-mode` (`preset`); a new shared `lib/eq-bars.js` component renders animated bars in both pill and popup; all glass/glow styling is St CSS (`box-shadow`, layered `background-image` gradients — no real blur, which GNOME Shell doesn't support). Behavior (MPRIS, seek, volume, switching) untouched.

**Tech Stack:** GNOME Shell 50 extension (GJS ES modules, St/Clutter), GSettings schema, Adw/Gtk4 prefs, plain-gjs unit tests in `tests/test-theme.js`.

**Spec:** `docs/superpowers/specs/2026-06-10-frosted-neon-glass-ui-design.md`

**Verification environment (important):** The live Wayland session caches extension modules — never verify there. Use `gjs -m tests/test-theme.js` for unit tests and the headless-shell flow in Task 13 for integration.

---

### Task 1: Settings schema — preset mode, theme-preset, enable-animations

**Files:**
- Modify: `schemas/org.gnome.shell.extensions.awesome-media-controller.gschema.xml`

- [ ] **Step 1: Add the new choice and keys**

In the `accent-mode` key, add a `preset` choice and update the description:

```xml
    <key name="accent-mode" type="s">
      <choices>
        <choice value="adaptive"/>
        <choice value="preset"/>
        <choice value="custom"/>
      </choices>
      <default>'adaptive'</default>
      <summary>Accent color mode</summary>
      <description>adaptive: extract accent colors from the current album art; preset: use a named built-in theme; custom: use the colors below.</description>
    </key>
```

After the `accent-end` key, add:

```xml
    <key name="theme-preset" type="s">
      <default>'synthwave'</default>
      <summary>Built-in theme preset name (preset mode)</summary>
    </key>
```

After the `enable-marquee` key, add:

```xml
    <key name="enable-animations" type="b">
      <default>true</default>
      <summary>Enable EQ bars, glow pulse, and popup transitions</summary>
    </key>
```

- [ ] **Step 2: Verify the schema compiles**

Run: `glib-compile-schemas --strict --dry-run schemas/`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add schemas/
git commit -m "feat: schema keys for preset themes and animations toggle"
```

---

### Task 2: PRESETS map and resolvePreset in theme.js (TDD)

**Files:**
- Modify: `lib/theme.js`
- Test: `tests/test-theme.js`

- [ ] **Step 1: Write the failing test**

In `tests/test-theme.js`, extend the existing import line and append the new assertions at the end of the file (before any final summary/exit lines if present):

```js
// import line becomes:
import { extractPalette, rgbToHex, rgbToHsv, PRESETS, resolvePreset } from '../lib/theme.js';
```

```js
print('PRESETS');
const HEX = /^#[0-9a-f]{6}$/;
assert(Object.keys(PRESETS).length === 6, 'six built-in presets');
for (const [name, preset] of Object.entries(PRESETS)) {
    assert(typeof preset.label === 'string' && preset.label.length > 0, `${name} has a label`);
    assert(Array.isArray(preset.colors) && preset.colors.length === 2, `${name} has two colors`);
    assert(preset.colors.every((c) => HEX.test(c)), `${name} colors are lowercase hex`);
}

print('resolvePreset');
assert(resolvePreset('cyberpunk')[0] === '#00e5ff', 'finds preset by name');
assert(resolvePreset('does-not-exist')[0] === PRESETS['synthwave'].colors[0],
    'unknown name falls back to synthwave');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `gjs -m tests/test-theme.js`
Expected: FAIL — `SyntaxError`/import error: `PRESETS` is not exported.

- [ ] **Step 3: Implement PRESETS and resolvePreset**

In `lib/theme.js`, after the `extractPaletteFromFile` function and before the ThemeManager section, add:

```js
// ── Built-in theme presets ─────────────────────────────────────────────────
// Single source of truth: prefs.js reads labels from here too.

export const PRESETS = {
    'synthwave':   { label: 'Synthwave',    colors: ['#ff2d95', '#7b2dff'] },
    'cyberpunk':   { label: 'Cyberpunk',    colors: ['#00e5ff', '#ff00aa'] },
    'aurora':      { label: 'Aurora',       colors: ['#2dd4bf', '#8b5cf6'] },
    'sunset-lofi': { label: 'Sunset Lo-fi', colors: ['#ff7e5f', '#feb47b'] },
    'toxic':       { label: 'Toxic',        colors: ['#a3ff12', '#00ffd5'] },
    'crimson':     { label: 'Crimson',      colors: ['#ff3b3b', '#ff9d00'] },
};

/** Colors for a preset name, falling back to synthwave for unknown names */
export function resolvePreset(name) {
    return (PRESETS[name] ?? PRESETS['synthwave']).colors;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `gjs -m tests/test-theme.js`
Expected: all `ok:` lines including the new PRESETS/resolvePreset ones, no `FAIL`.

- [ ] **Step 5: Commit**

```bash
git add lib/theme.js tests/test-theme.js
git commit -m "feat: built-in theme presets map with fallback resolution"
```

---

### Task 3: ThemeManager preset mode (TDD)

**Files:**
- Modify: `lib/theme.js:99-179` (ThemeManager)
- Test: `tests/test-theme.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/test-theme.js` (and add `ThemeManager` to the import):

```js
// import line becomes:
import { extractPalette, rgbToHex, rgbToHsv, PRESETS, resolvePreset, ThemeManager } from '../lib/theme.js';
```

```js
print('ThemeManager preset mode');
function fakeSettings(values) {
    return {
        get_string(key) { return values[key]; },
        connect() { return 1; },
        disconnect() {},
    };
}

const tmPreset = new ThemeManager(fakeSettings({
    'accent-mode': 'preset', 'theme-preset': 'cyberpunk',
    'accent-start': '#111111', 'accent-end': '#222222',
}));
assert(tmPreset.accentA === '#00e5ff', 'preset mode resolves accentA');
assert(tmPreset.accentB === '#ff00aa', 'preset mode resolves accentB');

const tmBad = new ThemeManager(fakeSettings({
    'accent-mode': 'preset', 'theme-preset': 'nonsense',
    'accent-start': '#111111', 'accent-end': '#222222',
}));
assert(tmBad.accentA === PRESETS['synthwave'].colors[0], 'bad preset name falls back');

const tmCustom = new ThemeManager(fakeSettings({
    'accent-mode': 'custom',
    'accent-start': '#111111', 'accent-end': '#222222',
}));
assert(tmCustom.accentA === '#111111', 'custom mode still uses settings colors');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `gjs -m tests/test-theme.js`
Expected: `FAIL: preset mode resolves accentA` (preset mode currently falls through to `accent-start` → `#111111`).

- [ ] **Step 3: Implement preset resolution in ThemeManager**

In `lib/theme.js` ThemeManager, change the settings-watch list in `_init` to include the new key:

```js
        this._settingsIds = ['accent-mode', 'accent-start', 'accent-end', 'theme-preset'].map((key) =>
            settings.connect(`changed::${key}`, () => this.emit('changed'))
        );
```

Replace the `accentA` / `accentB` getters:

```js
    get accentA() {
        const mode = this._settings.get_string('accent-mode');
        if (mode === 'adaptive' && this._artColors) return this._artColors[0];
        if (mode === 'preset') return resolvePreset(this._settings.get_string('theme-preset'))[0];
        return this._settings.get_string('accent-start');
    }

    get accentB() {
        const mode = this._settings.get_string('accent-mode');
        if (mode === 'adaptive' && this._artColors) return this._artColors[1];
        if (mode === 'preset') return resolvePreset(this._settings.get_string('theme-preset'))[1];
        return this._settings.get_string('accent-end');
    }
```

(The `_adaptive` getter stays — `_setArtColors` still uses it. Adaptive mode without art colors falls through to `accent-start`/`accent-end`, same as today.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `gjs -m tests/test-theme.js`
Expected: all `ok:`, no `FAIL`.

- [ ] **Step 5: Commit**

```bash
git add lib/theme.js tests/test-theme.js
git commit -m "feat: ThemeManager resolves preset accent mode"
```

---

### Task 4: EqBars shared component

**Files:**
- Create: `lib/eq-bars.js`

St is only importable inside the shell, so there is no plain-gjs unit test; this component is exercised by the Task 13 headless run.

- [ ] **Step 1: Create the component**

`lib/eq-bars.js`:

```js
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

// Three decorative equalizer bars that bounce while music plays.
// Purely cosmetic (no audio data) — heights follow phase-shifted sines.

export const EqBars = GObject.registerClass(
class EqBars extends St.BoxLayout {

    _init(theme, { barWidth = 2, minHeight = 3, maxHeight = 11 } = {}) {
        super._init({ style: 'spacing: 2px;', y_align: Clutter.ActorAlign.CENTER });
        this._theme   = theme;
        this._min     = minHeight;
        this._max     = maxHeight;
        this._timerId = 0;
        this._phase   = 0;

        this._bars = [0, 1, 2].map(() => {
            const bar = new St.Widget({
                width: barWidth,
                height: minHeight,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(bar);
            return bar;
        });
        this.refreshColor();

        this.connect('destroy', () => {
            if (this._timerId) {
                GLib.source_remove(this._timerId);
                this._timerId = 0;
            }
        });
    }

    refreshColor() {
        for (const bar of this._bars)
            bar.style = `background-color: ${this._theme.accentA}; border-radius: 99px;`;
    }

    start() {
        if (this._timerId) return;
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._phase++;
            this._bars.forEach((bar, i) => {
                const t = this._phase * 0.9 + i * 2.1;
                const f = (Math.sin(t) + Math.sin(t * 1.7 + i)) / 4 + 0.5; // ~0..1
                bar.height = Math.round(this._min + f * (this._max - this._min));
            });
            return GLib.SOURCE_CONTINUE;
        });
    }

    /** Stop animating and freeze bars at resting height */
    stop() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        for (const bar of this._bars) bar.height = this._min;
    }
});
```

- [ ] **Step 2: Regression check + commit**

Run: `gjs -m tests/test-theme.js` — expected: all `ok:`.

```bash
git add lib/eq-bars.js
git commit -m "feat: shared animated EQ bars component"
```

---

### Task 5: Glass stylesheet

**Files:**
- Modify: `stylesheet.css` (full replacement below)

- [ ] **Step 1: Replace stylesheet.css with the glass version**

```css
/* Static structure lives here; themed colors (gradients, borders, glows)
   are applied inline by the ThemeManager at runtime. */

.amc-pill {
    background-color: rgba(15, 10, 28, 0.72);
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.10), rgba(255, 255, 255, 0.0));
    border-radius: 999px;
    padding: 3px 10px 3px 5px;
    transition-duration: 200ms;
}

.amc-pill-title {
    font-size: 11px;
    font-weight: bold;
    color: #ffffff;
}

.amc-pill-artist {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.55);
}

/* Neutral circular control button (glass chip) — hover/press handled here */
.amc-btn {
    background-color: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 99px;
    color: rgba(255, 255, 255, 0.8);
    transition-duration: 150ms;
}

.amc-btn:hover {
    background-color: rgba(255, 255, 255, 0.16);
    color: #ffffff;
}

.amc-btn:active {
    background-color: rgba(255, 255, 255, 0.26);
}

/* Gradient play button keeps its colors inline; hover adds a lift */
.amc-btn-accent {
    border-radius: 99px;
    color: #ffffff;
    transition-duration: 150ms;
}

.amc-btn-accent:hover {
    box-shadow: 0 0 12px rgba(255, 255, 255, 0.30);
}

.amc-popup-title {
    font-size: 16px;
    font-weight: bold;
    color: #ffffff;
    margin-bottom: 2px;
}

/* Artist color is the accent, applied inline by the theme */
.amc-popup-artist {
    font-size: 12px;
    margin-bottom: 2px;
}

.amc-popup-album {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.30);
    margin-bottom: 12px;
}

.amc-time-label {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.35);
}

.amc-switcher-label {
    font-size: 9px;
    font-weight: bold;
    color: rgba(255, 255, 255, 0.25);
    margin-bottom: 8px;
    letter-spacing: 1.5px;
}

.amc-player-pill {
    border-radius: 99px;
    padding: 4px 10px;
    transition-duration: 150ms;
}

.amc-player-pill:hover {
    background-color: rgba(255, 255, 255, 0.12);
}
```

- [ ] **Step 2: Commit**

```bash
git add stylesheet.css
git commit -m "feat: frosted glass stylesheet base"
```

---

### Task 6: Panel pill — glass styling, symbolic icons, art ring

**Files:**
- Modify: `lib/panel-widget.js`

- [ ] **Step 1: Replace emoji buttons with symbolic icons**

In `_buildUI`, replace the control-button construction (`this._prevBtn = ...` through `this._ctrlBox.add_child(this._nextBtn);`) with:

```js
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
```

Replace `_makeBtn`:

```js
    _makeBtn(iconName) {
        return new St.Button({
            style_class: 'amc-btn',
            style: 'width: 20px; height: 20px;',
            child: new St.Icon({ icon_name: iconName, icon_size: 10 }),
        });
    }
```

In `_update()`, replace the `this._playBtn.label = ...` line with:

```js
        this._playIcon.icon_name = state.playbackStatus === 'Playing'
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
```

- [ ] **Step 2: Glass pill border/glow and art ring**

Replace `_applyTheme` and `_applyArtStyle`:

```js
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
```

- [ ] **Step 3: Regression check + commit**

Run: `gjs -m tests/test-theme.js` — expected: all `ok:`.

```bash
git add lib/panel-widget.js
git commit -m "feat: glass pill with symbolic icons and glowing art ring"
```

---

### Task 7: Panel pill — EQ bars and glow pulse

**Files:**
- Modify: `lib/panel-widget.js`

- [ ] **Step 1: Add EQ bars to the pill**

Add the import at the top:

```js
import { EqBars } from './eq-bars.js';
```

In `_init`, add `this._pulseTimerId = 0;` next to the other field initializations.

In `_buildUI`, after `textBox` is added to the pill (after the artist label block) and before the `this._ctrlBox` block, insert:

```js
        this._eq = new EqBars(this._theme);
        this._eq.visible = false;
        this._pill.add_child(this._eq);
```

- [ ] **Step 2: Drive EQ + pulse from playback state**

In `_update()`, after the `this._loadPillArt(state.artUrl);` line, add:

```js
        const playing = state.playbackStatus === 'Playing';
        const animate = this._settings.get_boolean('enable-animations');
        this._eq.visible = animate;
        if (playing && animate) {
            this._eq.start();
            this._startPulse();
        } else {
            this._eq.stop();
            this._stopPulse();
        }
```

In the `!state || !state.title` early-return branch of `_update()`, add before `return;`:

```js
            this._eq?.stop();
            this._stopPulse();
```

Add the pulse methods after `_stopMarquee`:

```js
    // Slow sinusoidal breathing of the pill's outer glow while playing
    _startPulse() {
        if (this._pulseTimerId) return;
        let t = 0;
        this._pulseTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            if (!this._pill) return GLib.SOURCE_REMOVE;
            t += 0.25;
            this._pill.style = this._pillStyle(0.35 + 0.10 * Math.sin(t * 2.5));
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPulse() {
        if (this._pulseTimerId) {
            GLib.source_remove(this._pulseTimerId);
            this._pulseTimerId = 0;
        }
        if (this._pill) this._pill.style = this._pillStyle(0.30);
    }
```

- [ ] **Step 3: Wire theme + settings changes and teardown**

In `_applyTheme()`, add as the last line:

```js
        this._eq?.refreshColor();
```

In `_connectSignals()`, add to the `this._settingsIds` array:

```js
            this._settings.connect('changed::enable-animations', () => this._update()),
```

In `_teardown()`, add before `this._stopMarquee();`:

```js
        this._stopPulse();
```

and add `this._pill = null;` next to `this._titleLabel = null;`.

(Note: `_stopPulse`/`_pillStyle` guard on `this._pill`, so null it last. `this._eq` is destroyed with the pill actor; its destroy handler removes the timer.)

- [ ] **Step 4: Regression check + commit**

Run: `gjs -m tests/test-theme.js` — expected: all `ok:`.

```bash
git add lib/panel-widget.js
git commit -m "feat: pill EQ bars and breathing neon glow while playing"
```

---

### Task 8: Popup — glass card, art halo, accent typography, settings plumb-through

**Files:**
- Modify: `lib/popup.js`, `lib/panel-widget.js:31`

- [ ] **Step 1: Pass settings into MediaPopup**

In `lib/panel-widget.js` `_init`, change:

```js
        this._popup = new MediaPopup(this, watcher, theme, settings);
```

In `lib/popup.js` `_init`, change the signature and store it:

```js
    _init(panelButton, watcher, theme, settings) {
        super._init();
        this._btn      = panelButton;
        this._watcher  = watcher;
        this._theme    = theme;
        this._settings = settings;
```

(keep the rest of `_init` unchanged.)

- [ ] **Step 2: Glass card + halo + accent artist**

In `_applyTheme()`, replace the `this._menuBox.set_style([...])` call with:

```js
        this._menuBox.set_style([
            'background-color: rgba(10, 7, 20, 0.92)',
            'background-image: linear-gradient(160deg, rgba(255,255,255,0.07), rgba(255,255,255,0.0))',
            'border: 1px solid rgba(255, 255, 255, 0.09)',
            `box-shadow: 0 0 24px ${t.glow(0.30)}`,
            'border-radius: 24px',
            'padding: 0',
            'min-width: 0',
        ].join(';'));
```

and add after it:

```js
        this._popupArtist.style = `color: ${t.accentA};`;
```

Replace `_applyArtStyle()`:

```js
    _applyArtStyle() {
        const base = 'border-radius: 16px; margin-bottom: 14px; ' +
                     `box-shadow: 0 6px 28px ${this._theme.glow(0.45)};`;
        this._artWidget.style = this._artPath
            ? `background-image: url("file://${this._artPath}"); background-size: cover; ${base}`
            : `background-image: ${this._theme.gradient()}; ${base}`;
    }
```

- [ ] **Step 3: Regression check + commit**

Run: `gjs -m tests/test-theme.js` — expected: all `ok:`.

```bash
git add lib/popup.js lib/panel-widget.js
git commit -m "feat: frosted glass popup card with art halo and accent typography"
```

---

### Task 9: Popup — symbolic icons, glowing play button, press feedback

**Files:**
- Modify: `lib/popup.js`

- [ ] **Step 1: Replace emoji controls with symbolic icons**

In `_buildCard()`, replace the controls construction (`this._shuffleBtn = ...` through `this._repeatBtn = ...`) with:

```js
        this._shuffleBtn = this._makePopupBtn('media-playlist-shuffle-symbolic', 28);
        this._prevBtn2   = this._makePopupBtn('media-skip-backward-symbolic', 34);
        this._playIcon2  = new St.Icon({
            icon_name: 'media-playback-start-symbolic',
            icon_size: 20,
        });
        this._playBtn2   = new St.Button({
            style_class: 'amc-btn-accent',
            child: this._playIcon2,
        });
        this._addPressFeedback(this._playBtn2);
        this._nextBtn2   = this._makePopupBtn('media-skip-forward-symbolic', 34);
        this._repeatBtn  = this._makePopupBtn('media-playlist-repeat-symbolic', 28);
```

Replace the two volume emoji labels in the volume row with icons — the `🔇` one becomes:

```js
        volRow.add_child(new St.Icon({
            icon_name: 'audio-volume-low-symbolic',
            icon_size: 12,
            style: 'color: rgba(255,255,255,0.35);',
            y_align: Clutter.ActorAlign.CENTER,
        }));
```

and the `🔊` one becomes the same block with `icon_name: 'audio-volume-high-symbolic'`.

Replace `_makePopupBtn`:

```js
    _makePopupBtn(iconName, size) {
        const btn = new St.Button({
            style_class: 'amc-btn',
            style: `width: ${size}px; height: ${size}px;`,
            child: new St.Icon({ icon_name: iconName, icon_size: Math.floor(size * 0.45) }),
        });
        this._addPressFeedback(btn);
        return btn;
    }

    // Tactile press: scale down while pressed, spring back on release
    _addPressFeedback(btn) {
        btn.set_pivot_point(0.5, 0.5);
        btn.connect('notify::pressed', () => {
            if (!this._settings.get_boolean('enable-animations')) return;
            const s = btn.pressed ? 0.92 : 1.0;
            btn.ease({
                scale_x: s,
                scale_y: s,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
    }
```

In `_toggleBtnStyle`, drop the obsolete font-size (icons size themselves):

```js
    _toggleBtnStyle(active, size) {
        const dims = `width: ${size}px; height: ${size}px;`;
        return active
            ? `background-color: ${this._theme.glow(0.3)}; color: ${this._theme.accentA}; ${dims}`
            : dims;
    }
```

- [ ] **Step 2: Play button glow tied to playback**

In `_applyTheme()`, replace the `this._playBtn2.style = [...]` block with a call:

```js
        this._applyPlayBtnStyle();
```

and add the helper after `_applyTheme`:

```js
    _applyPlayBtnStyle() {
        const playing = this._watcher.getPlayerState()?.playbackStatus === 'Playing';
        const t = this._theme;
        this._playBtn2.style = [
            `background-image: ${t.gradient()}`,
            'width: 48px',
            'height: 48px',
            `box-shadow: 0 0 ${playing ? 16 : 8}px ${t.glow(playing ? 0.55 : 0.30)}`,
        ].join(';');
    }
```

In `_updateAll()`, replace the `this._playBtn2.label = ...` line with:

```js
        this._playIcon2.icon_name = state.playbackStatus === 'Playing'
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._applyPlayBtnStyle();
```

- [ ] **Step 3: Regression check + commit**

Run: `gjs -m tests/test-theme.js` — expected: all `ok:`.

```bash
git add lib/popup.js
git commit -m "feat: symbolic icon controls with glowing play button and press feedback"
```

---

### Task 10: Popup — thicker progress bar with glowing knob

**Files:**
- Modify: `lib/popup.js`

- [ ] **Step 1: Knob-capable slider**

In `_buildSlider`, change the signature to `_buildSlider(onChange, onCommit, withKnob = false)`, change both `height: 3` (track and fill) to `height: 4`, and after `container.add_child(fill);` add:

```js
        let knob = null;
        if (withKnob) {
            knob = new St.Widget({
                width: 10,
                height: 10,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
            });
            container.add_child(knob);
        }
```

Change the return to:

```js
        return [container, fill, knob];
```

In `_buildCard()`, change the progress slider destructure to:

```js
        [this._progressContainer, this._progressFill, this._progressKnob] = this._buildSlider(
```

(volume row destructure stays `[this._volContainer, this._volFill]` — its knob is unused.)

- [ ] **Step 2: Position and theme the knob**

Replace `_updateProgress()`:

```js
    _updateProgress() {
        this._elapsedLabel.text = formatTime(this._position);
        this._totalLabel.text   = formatTime(this._length);
        const w = this._progressContainer.width;
        let fillW = 0;
        if (w > 0 && this._length > 0) {
            const fraction = Math.max(0, Math.min(1, this._position / this._length));
            fillW = Math.floor(w * fraction);
        }
        this._progressFill.width = fillW;
        const size = this._scrubbing ? 12 : 10; // knob grows while scrubbing
        this._progressKnob.set_size(size, size);
        this._progressKnob.translation_x = Math.max(0, fillW - Math.floor(size / 2));
    }
```

In `_applyTheme()`, replace the `const fillStyle = ...` and the two fill assignments with:

```js
        const fillStyle = `background-image: ${t.gradient(90)}; border-radius: 99px; ` +
                          `box-shadow: 0 0 6px ${t.glow(0.5)};`;
        this._progressFill.style = fillStyle;
        this._volFill.style = fillStyle;
        this._progressKnob.style =
            `background-color: #ffffff; border-radius: 99px; box-shadow: 0 0 6px ${t.glow(0.8)};`;
```

- [ ] **Step 3: Regression check + commit**

Run: `gjs -m tests/test-theme.js` — expected: all `ok:`.

```bash
git add lib/popup.js
git commit -m "feat: glowing progress bar with scrub knob"
```

---

### Task 11: Popup — EQ bars and entrance animation

**Files:**
- Modify: `lib/popup.js`

- [ ] **Step 1: EQ bars next to the title**

Add the import:

```js
import { EqBars } from './eq-bars.js';
```

In `_buildCard()`, replace the title label block (`this._popupTitle = ...` through `card.add_child(this._popupTitle);`) with:

```js
        const titleRow = new St.BoxLayout({ style: 'spacing: 8px;' });
        this._popupTitle = new St.Label({
            text: '',
            style_class: 'amc-popup-title',
            x_expand: true,
        });
        this._popupTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        titleRow.add_child(this._popupTitle);
        this._eq = new EqBars(this._theme, { minHeight: 4, maxHeight: 12 });
        this._eq.visible = false;
        titleRow.add_child(this._eq);
        card.add_child(titleRow);
```

In `_updateAll()`, after the `this._loadArt(state.artUrl);` line, add:

```js
        const animate = this._settings.get_boolean('enable-animations');
        this._eq.visible = animate;
        if (animate && state.playbackStatus === 'Playing' && this._btn.menu.isOpen)
            this._eq.start();
        else
            this._eq.stop();
```

In `_applyTheme()`, add as the last line before `this._applyArtStyle();`:

```js
        this._eq?.refreshColor();
```

- [ ] **Step 2: Entrance animation on open**

In `_buildMenu()`, replace the `open-state-changed` handler body with:

```js
        this._openStateId = menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._updateAll();
                this._syncPosition();
                this._startPositionTimer();
                if (this._settings.get_boolean('enable-animations')) {
                    this._card.opacity = 0;
                    this._card.set_pivot_point(0.5, 0.5);
                    this._card.set_scale(0.96, 0.96);
                    this._card.ease({
                        opacity: 255,
                        scale_x: 1,
                        scale_y: 1,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
            } else {
                this._stopPositionTimer();
                this._eq?.stop();
            }
        });
```

In `destroy()`, add `this._eq = null;` next to `this._artWidget = null;` (the actor itself is destroyed with the card; its destroy handler removes the timer). Note `_updateAll()` already early-returns when `this._artWidget` is null, so the nulled `_eq` is never dereferenced afterward.

- [ ] **Step 3: Regression check + commit**

Run: `gjs -m tests/test-theme.js` — expected: all `ok:`.

```bash
git add lib/popup.js
git commit -m "feat: popup EQ bars and eased entrance animation"
```

---

### Task 12: Preferences — preset selector and animations toggle

**Files:**
- Modify: `prefs.js`

- [ ] **Step 1: Three-way mode + preset dropdown**

Add the import after the existing imports:

```js
import { PRESETS } from './lib/theme.js';
```

Replace the `modeRow` block with:

```js
        const modes = ['adaptive', 'preset', 'custom'];
        const modeRow = new Adw.ComboRow({
            title: 'Accent colors',
            model: Gtk.StringList.new(['Adaptive (from album art)', 'Preset theme', 'Custom']),
        });
        modeRow.selected = Math.max(0, modes.indexOf(settings.get_string('accent-mode')));
        modeRow.connect('notify::selected', () => {
            settings.set_string('accent-mode', modes[modeRow.selected]);
        });
        themeGroup.add(modeRow);

        const presetNames = Object.keys(PRESETS);
        const presetRow = new Adw.ComboRow({
            title: 'Preset theme',
            model: Gtk.StringList.new(presetNames.map((n) => PRESETS[n].label)),
        });
        presetRow.selected = Math.max(0, presetNames.indexOf(settings.get_string('theme-preset')));
        presetRow.connect('notify::selected', () => {
            settings.set_string('theme-preset', presetNames[presetRow.selected]);
        });
        themeGroup.add(presetRow);
```

Replace `syncSensitive` with:

```js
        const syncSensitive = () => {
            const mode = settings.get_string('accent-mode');
            presetRow.sensitive = mode === 'preset';
            startRow.sensitive  = mode === 'custom';
            endRow.sensitive    = mode === 'custom';
        };
```

- [ ] **Step 2: Animations switch**

After the marquee switch row, add:

```js
        panelGroup.add(switchRow('Animations', 'EQ bars, glow pulse, and popup transitions', 'enable-animations'));
```

- [ ] **Step 3: Commit**

```bash
git add prefs.js
git commit -m "feat: preset theme selector and animations toggle in prefs"
```

---

### Task 13: Integration verification (headless shell + mock player)

**Files:** none (verification only)

The live Wayland session caches modules — do NOT verify there.

- [ ] **Step 1: Unit tests and schema**

Run:
```bash
gjs -m tests/test-theme.js
glib-compile-schemas --strict --dry-run schemas/
```
Expected: all `ok:` lines, no `FAIL`; schema compiles silently.

- [ ] **Step 2: Deploy**

Run: `./install.sh`
Expected: rsync + "Compiling settings schema..." + no errors (the live-session enable at the end may be a no-op; that's fine).

- [ ] **Step 3: Headless smoke test with mock player**

Run:
```bash
dbus-run-session -- bash -c '
  gnome-shell --headless --virtual-monitor 800x600 &> /tmp/amc-shell.log &
  SHELL_PID=$!
  sleep 6
  gjs -m tests/mock-player.js &> /tmp/amc-mock.log &
  sleep 2
  gnome-extensions enable awesome-media-controller@awesome
  sleep 4
  gnome-extensions info awesome-media-controller@awesome
  kill $SHELL_PID
'
grep -iE "JS ERROR|Gjs-CRITICAL" /tmp/amc-shell.log || echo "CLEAN: no JS errors"
```
Expected: extension info shows `State: ACTIVE`; the grep prints `CLEAN: no JS errors` (or only pre-existing shell noise unrelated to the extension — anything mentioning `awesome-media-controller`, `amc`, `eq-bars`, `popup.js`, `panel-widget.js`, or `theme.js` is a failure to fix before proceeding).

- [ ] **Step 4: Prefs import sanity (optional but cheap)**

The prefs UI can only fully run inside the prefs app, but a parse/import check of the PRESETS path works in plain gjs:

```bash
gjs -m -c "import('file://$PWD/lib/theme.js').then(m => { print(Object.keys(m.PRESETS).join(',')); }).catch(e => { logError(e); imports.system.exit(1); });" 2>/dev/null || gjs -m tests/test-theme.js
```
Expected: preset names printed, or the fallback unit-test run passes.

- [ ] **Step 5: Final commit (if any fixes were needed)**

```bash
git status
# commit any fixes made during verification with descriptive messages
```

---

## Spec coverage map

| Spec section | Task(s) |
|---|---|
| §1 Theming model (preset mode, keys, PRESETS, fallback) | 1, 2, 3 |
| §2 Pill: glass body, glow border | 5, 6 |
| §2 Pill: art ring | 6 |
| §2 Pill: EQ bars, glow pulse | 4, 7 |
| §2 Pill: symbolic icons | 6 |
| §3 Popup: card glass, halo, typography | 5, 8 |
| §3 Popup: progress knob/glow | 10 |
| §3 Popup: symbolic icons, play glow, press feedback | 9 |
| §3 Popup: switcher chips (existing styling kept, hover via CSS) | 5 |
| §3 Popup: EQ bars, entrance animation | 4, 11 |
| §4 Shared EQ component | 4 |
| §5 Prefs UI | 12 |
| §7 Error handling (fallback, timer teardown) | 2, 4, 7, 11 |
| §8 Testing | 2, 3, 13 |
