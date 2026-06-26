/* ============================================================
 * Themes — ready-made colour presets for the toast notifications.
 *
 * Picking a theme flips the appearance into "override + colorOverride" mode
 * and copies the preset's colours into appearance.* so it reuses the exact
 * same CSS pipeline as the manual Look tab. Choosing "None" turns the colour
 * override back off (toasts keep ST's native look).
 *
 * Each theme also exposes a tiny `swatch` (bg/border/text) used to render the
 * little preview card in the Extensions settings panel.
 * ============================================================ */
import { getSettings, save } from './settings.js';
import { applyAppearanceCss } from './appearance.js';

export const THEME_NONE = 'none';

// id -> palette. `name` is an i18n key (themes.<id>).
export const THEMES = [
    {
        id: 'dark',
        name: 'themes.dark',
        bgColor: '#16181d',
        textColor: '#e7e9ee',
        borderColor: '#2c2f38',
        borderWidth: 1,
        borderRadius: 10,
    },
    {
        id: 'light',
        name: 'themes.light',
        bgColor: '#fbfbfd',
        textColor: '#1d1f24',
        borderColor: '#d7d9e0',
        borderWidth: 1,
        borderRadius: 10,
    },
    {
        id: 'coffee',
        name: 'themes.coffee',
        bgColor: '#2b1d17',
        textColor: '#f3e3d3',
        borderColor: '#7a4e34',
        borderWidth: 1,
        borderRadius: 10,
    },
    {
        id: 'nude',
        name: 'themes.nude',
        bgColor: '#efe3d8',
        textColor: '#4a3b30',
        borderColor: '#d8c3ad',
        borderWidth: 1,
        borderRadius: 12,
    },
    {
        id: 'dracula',
        name: 'themes.dracula',
        bgColor: '#282a36',
        textColor: '#f8f8f2',
        borderColor: '#bd93f9',
        borderWidth: 1,
        borderRadius: 10,
    },
    {
        id: 'midnight',
        name: 'themes.midnight',
        bgColor: '#0e1726',
        textColor: '#d7e3ff',
        borderColor: '#1f3a66',
        borderWidth: 1,
        borderRadius: 10,
    },
    {
        id: 'forest',
        name: 'themes.forest',
        bgColor: '#13241b',
        textColor: '#d8f0df',
        borderColor: '#2f6b48',
        borderWidth: 1,
        borderRadius: 10,
    },
    {
        id: 'rose',
        name: 'themes.rose',
        bgColor: '#2a1620',
        textColor: '#ffe1ec',
        borderColor: '#d3567f',
        borderWidth: 1,
        borderRadius: 12,
    },
    {
        id: 'ocean',
        name: 'themes.ocean',
        bgColor: '#0c2230',
        textColor: '#d4f1f9',
        borderColor: '#2a8fb5',
        borderWidth: 1,
        borderRadius: 10,
    },
    {
        id: 'amoled',
        name: 'themes.amoled',
        bgColor: '#000000',
        textColor: '#eaeaea',
        borderColor: '#333333',
        borderWidth: 1,
        borderRadius: 8,
    },
    {
        id: 'sunset',
        name: 'themes.sunset',
        bgColor: '#2d1726',
        textColor: '#ffe9d6',
        borderColor: '#e8763b',
        borderWidth: 1,
        borderRadius: 12,
    },
    {
        id: 'mono',
        name: 'themes.mono',
        bgColor: '#1c1c1c',
        textColor: '#fafafa',
        borderColor: '#fafafa',
        borderWidth: 2,
        borderRadius: 6,
    },
];

export function getThemeById(id) {
    return THEMES.find((t) => t.id === id) || null;
}

/**
 * Apply a theme by id. Passing THEME_NONE (or an unknown id) turns the colour
 * override off but keeps the user's other Look settings untouched.
 * @returns {boolean} true on success.
 */
export function applyTheme(id) {
    const settings = getSettings();
    const a = settings.appearance;
    settings.theme = id || THEME_NONE;

    if (!id || id === THEME_NONE) {
        a.colorOverride = false;
        applyAppearanceCss();
        save();
        return true;
    }

    const theme = getThemeById(id);
    if (!theme) {
        settings.theme = THEME_NONE;
        a.colorOverride = false;
        applyAppearanceCss();
        save();
        return false;
    }

    // A theme only changes colours — it must actually take effect, so make sure
    // override + colorOverride are on. Geometry/position/size stay as the user
    // set them (we only seed a sensible radius/border from the preset).
    a.override = true;
    a.colorOverride = true;
    a.bgColor = theme.bgColor;
    a.textColor = theme.textColor;
    a.borderColor = theme.borderColor;
    a.borderWidth = theme.borderWidth;
    a.borderRadius = theme.borderRadius;

    applyAppearanceCss();
    save();
    return true;
}

/* ============================================================
 * PANEL themes — restyle the Smart Notify drawer itself (the modal opened
 * from the wand menu), not the toasts.
 *
 * 'default' follows SillyTavern's theme variables (translucent + blur).
 * Every other preset paints a SOLID, fully opaque panel (no blur), driven by
 * CSS variables injected onto #smart-notify-modal plus the .sn-solid class.
 * ============================================================ */
export const PANEL_THEME_DEFAULT = 'default';

// id -> palette. `name` is an i18n key (panelThemes.<id>).
// bg = panel surface, fg = text, accent = highlights/active tab, border = lines.
export const PANEL_THEMES = [
    { id: 'dark',     name: 'panelThemes.dark',     bg: '#15171c', fg: '#e7e9ee', accent: '#6c8cff', border: '#2b2f39' },
    { id: 'light',    name: 'panelThemes.light',    bg: '#f7f8fb', fg: '#1d2024', accent: '#3b6cff', border: '#d9dde6' },
    { id: 'coffee',   name: 'panelThemes.coffee',   bg: '#241812', fg: '#f3e3d3', accent: '#d8a05a', border: '#5e3d28' },
    { id: 'nude',     name: 'panelThemes.nude',     bg: '#efe3d8', fg: '#4a3b30', accent: '#bd8a63', border: '#d8c3ad' },
    { id: 'dracula',  name: 'panelThemes.dracula',  bg: '#282a36', fg: '#f8f8f2', accent: '#bd93f9', border: '#44475a' },
    { id: 'midnight', name: 'panelThemes.midnight', bg: '#0d1422', fg: '#d7e3ff', accent: '#4d8dff', border: '#1f3a66' },
    { id: 'forest',   name: 'panelThemes.forest',   bg: '#10211a', fg: '#d8f0df', accent: '#4cc77f', border: '#2f6b48' },
    { id: 'rose',     name: 'panelThemes.rose',     bg: '#25131d', fg: '#ffe1ec', accent: '#ff6f9c', border: '#5a2a3c' },
    { id: 'ocean',    name: 'panelThemes.ocean',    bg: '#0a1f2c', fg: '#d4f1f9', accent: '#34b6e0', border: '#1c4a5e' },
    { id: 'amoled',   name: 'panelThemes.amoled',   bg: '#000000', fg: '#eaeaea', accent: '#8a9cff', border: '#262626' },
    { id: 'sunset',   name: 'panelThemes.sunset',   bg: '#271320', fg: '#ffe9d6', accent: '#ff8a4c', border: '#5a2f3a' },
    { id: 'mono',     name: 'panelThemes.mono',     bg: '#1b1b1b', fg: '#fafafa', accent: '#fafafa', border: '#3a3a3a' },
];

export function getPanelThemeById(id) {
    return PANEL_THEMES.find((t) => t.id === id) || null;
}

let panelStyleEl = null;
function ensurePanelStyleEl() {
    if (panelStyleEl && document.head.contains(panelStyleEl)) return panelStyleEl;
    panelStyleEl = document.getElementById('smart-notify-panel-theme-style');
    if (!panelStyleEl) {
        panelStyleEl = document.createElement('style');
        panelStyleEl.id = 'smart-notify-panel-theme-style';
        document.head.appendChild(panelStyleEl);
    }
    return panelStyleEl;
}

/**
 * Apply a panel theme by id. 'default' (or unknown) restores ST-driven look.
 * Solid themes inject opaque CSS variables and add the .sn-solid class so the
 * stylesheet drops the translucency/blur.
 * @returns {boolean}
 */
export function applyPanelTheme(id) {
    const settings = getSettings();
    settings.panelTheme = id || PANEL_THEME_DEFAULT;
    const el = ensurePanelStyleEl();
    const modal = document.getElementById('smart-notify-modal');

    if (!id || id === PANEL_THEME_DEFAULT) {
        el.textContent = '';
        if (modal) modal.classList.remove('sn-solid');
        save();
        return true;
    }

    const th = getPanelThemeById(id);
    if (!th) {
        settings.panelTheme = PANEL_THEME_DEFAULT;
        el.textContent = '';
        if (modal) modal.classList.remove('sn-solid');
        save();
        return false;
    }

    // Solid, opaque surface. We also derive a muted fg and subtle tints so the
    // existing component styles (chips, cards, hovers) keep working.
    el.textContent = `
#smart-notify-modal.sn-solid {
    --sn-bg: ${th.bg};
    --sn-fg: ${th.fg};
    --sn-accent: ${th.accent};
    --sn-border: ${th.border};
}`;
    if (modal) modal.classList.add('sn-solid');
    save();
    return true;
}

/** Remove the injected panel-theme <style> (for hot-reload disposal). */
export function disposePanelTheme() {
    if (panelStyleEl) { try { panelStyleEl.remove(); } catch (e) { /* noop */ } panelStyleEl = null; }
    const el = document.getElementById('smart-notify-panel-theme-style');
    if (el) el.remove();
}
