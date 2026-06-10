# Frosted Neon Glass UI Redesign — Design Spec

**Date:** 2026-06-10
**Status:** Approved direction (Frosted Neon Glass), pending spec review

## Goal

Replace the current flat look of the panel pill and popup card with a modern
glassmorphism design ("Frosted Neon Glass"): translucent layered glass, neon
accent glows derived from album art, real symbolic icons instead of emoji,
tasteful motion, and a set of built-in preset themes. Behavior (MPRIS,
seeking, volume, player switching) is unchanged — this is a visual-layer
redesign.

## Constraints

- GNOME Shell St CSS has **no `backdrop-filter`** — glass is faked with
  layered translucency, light "sheen" gradients, hairline inner borders, and
  `box-shadow` glows (all supported in St CSS).
- No fragile Clutter screen-clone blur effects.
- Must keep working on the GNOME versions in `metadata.json` (incl. GNOME 50).
- Animations must be cheap: timer-based like the existing marquee
  (~10 fps for EQ bars) or one-shot `actor.ease()` transitions.

## 1. Theming model (lib/theme.js, schema)

`accent-mode` gains a third value: `preset`.

- `adaptive` — accents extracted from album art (existing).
- `preset` — accents come from a named built-in theme (new).
- `custom` — accents from the two color settings (existing).

New settings keys:

- `theme-preset` (string): name of the active preset. Default `synthwave`.
- `enable-animations` (bool, default true): master switch for EQ bars,
  glow pulse, and entrance animation. Marquee keeps its own existing toggle.

Built-in presets (name → accent A, accent B):

| Preset        | Accent A (start) | Accent B (end) | Vibe |
|---------------|------------------|----------------|------|
| `synthwave`   | `#ff2d95` hot pink | `#7b2dff` electric purple | retro neon |
| `cyberpunk`   | `#00e5ff` cyan     | `#ff00aa` magenta         | gamer RGB |
| `aurora`      | `#2dd4bf` teal     | `#8b5cf6` violet          | current default vibe |
| `sunset-lofi` | `#ff7e5f` coral    | `#feb47b` peach           | chill / lo-fi |
| `toxic`       | `#a3ff12` lime     | `#00ffd5` mint            | gamer green |
| `crimson`     | `#ff3b3b` red      | `#ff9d00` amber           | intense |

Presets live in a `PRESETS` map exported from `theme.js` (single source of
truth — prefs UI reads the same map). `ThemeManager.accentA/accentB` resolve
the preset when mode is `preset`; everything downstream (gradient(), glow())
works unchanged.

## 2. Panel pill — neon glass capsule

- **Glass body:** translucent dark base (`rgba(15, 10, 28, 0.72)`) with a
  top-edge light sheen via a subtle white→transparent `background-gradient`
  overlay feel (St: layered `background-image: linear-gradient(...)` over the
  base color). Capsule radius stays 999px.
- **Neon border + outer glow:** keep 1px accent border, add
  `box-shadow: 0 0 10px <accentA @ ~0.35>` so the pill radiates the accent.
- **Art thumbnail:** rounded, with a 1px glowing accent ring.
- **EQ bars:** 3 bars (2px wide, 3–11px tall) next to the title, heights
  animated on a ~100ms timer with a randomized bounce pattern while
  `playbackStatus === 'Playing'`; frozen at low height when paused; hidden
  when `enable-animations` is off.
- **Icons:** replace ⏮ ▶ ⏭ emoji with `St.Icon` symbolic icons
  (`media-skip-backward-symbolic`, `media-playback-start-symbolic` /
  `media-playback-pause-symbolic`, `media-skip-forward-symbolic`).
- **Glow pulse:** while playing, the pill's outer glow alpha eases between
  ~0.25 and ~0.45 on a slow (~2.5s) cycle. Off when paused or animations
  disabled. Implemented on the same timer cadence as EQ (shared ticker).

## 3. Popup — frosted neon card

- **Card glass:** menu box gets translucent base (`rgba(10, 7, 20, 0.92)`),
  a diagonal light sheen (linear-gradient white @ 0.06 → transparent), 1px
  inner hairline (`rgba(255,255,255,0.09)`), 24px radius, and an outer accent
  glow `box-shadow: 0 0 24px <accentA @ ~0.30>`.
- **Album art hero:** 16px radius and a glow halo:
  `box-shadow: 0 6px 28px <accentA @ ~0.45>` — the cover looks backlit by its
  own colors. Fallback (no art) keeps the accent gradient.
- **Typography:** title 16px bold white; artist 12px in `accentA`; album 10px
  muted. Clear hierarchy.
- **Progress bar:** track 4px tall; gradient fill with soft glow
  (`box-shadow: 0 0 6px <accentA @ 0.5>`); a 10px circular knob in white with
  accent glow rides the end of the fill. Knob enlarges slightly while
  scrubbing.
- **Controls:** all `St.Icon` symbolic icons (shuffle, skip-back,
  play/pause, skip-forward, repeat). Play is a 48px circular gradient button
  with an outer glow ring that is stronger while playing. Shuffle/repeat
  active state keeps the accent-tinted chip look.
- **Volume row:** symbolic `audio-volume-low/high-symbolic` icons; slider
  matches the progress bar style (no knob needed).
- **Player switcher:** glass chips — translucent base, hairline border,
  brand-color dot; active chip gets accent glow border.
- **EQ bars** beside the title while playing (same component as the pill).
- **Entrance animation:** on menu open, the card eases from
  `opacity 0 / scale 0.96` to full over ~180ms (`actor.ease`,
  EASE_OUT_QUAD). Skipped when animations are disabled.
- **Button feedback:** hover brightens (existing CSS), press scales the
  button to 0.92 and back via `ease` for a tactile feel.

## 4. Shared EQ bars component

New small module `lib/eq-bars.js`: an `St.BoxLayout` of 3 `St.Widget` bars
with `start()/stop()/destroy()`, driven by one `GLib.timeout_add` at 100ms.
Bar heights follow a per-bar phase-shifted pseudo-random bounce. Colors come
from ThemeManager (gradient per bar or solid accentA). Used by both
panel-widget and popup; respects `enable-animations`.

## 5. Preferences UI (prefs.js)

- Accent mode row becomes three options: Adaptive / Preset / Custom.
- New Preset row (visible in preset mode): dropdown of the six presets with
  their display names.
- New "Enable animations" switch row under Behavior.
- Existing custom color pickers unchanged (shown in custom mode).

## 6. Files touched

| File | Change |
|------|--------|
| `schemas/...gschema.xml` | `preset` choice, `theme-preset`, `enable-animations` keys |
| `lib/theme.js` | `PRESETS` map, preset resolution in accentA/B |
| `lib/eq-bars.js` | new shared EQ bars component |
| `lib/panel-widget.js` | glass styles, symbolic icons, EQ bars, glow pulse |
| `lib/popup.js` | glass card, halo, knob slider, symbolic icons, EQ bars, entrance ease, press feedback |
| `stylesheet.css` | updated static classes (glass layers, icon buttons, chips) |
| `prefs.js` | preset selector, animations toggle |

## 7. Error handling

- Preset name not in `PRESETS` (e.g., hand-edited dconf) → fall back to
  `synthwave`.
- All timers guarded and removed on destroy (same discipline as existing
  marquee/position timers); EQ ticker stops when hidden, paused, or disabled.
- `actor.ease` calls guarded against destroyed actors via existing
  null-out-on-destroy pattern.

## 8. Testing

- Extend existing `tests/` checks: PRESETS map shape (valid hex pairs),
  ThemeManager preset resolution and fallback under plain gjs.
- Manual verification via the documented workflow: headless GNOME Shell +
  mock MPRIS player (see memory: Wayland caches modules; logout needed on
  the live session).

## Out of scope

- Real backdrop blur.
- Lyrics, visualizer spectrums from actual audio data (EQ bars are
  decorative, not FFT-driven).
- Light-theme variant.
