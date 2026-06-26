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
