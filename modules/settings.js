/* Settings: defaults, deep merge (with nested forward-compat), accessors. */
import { MODULE_NAME } from './constants.js';

export const SETTINGS_VERSION = 2;

export const defaultSettings = {
    enabled: true,
    // ready-made colour preset id for the TOASTS (see modules/themes.js).
    // 'none' = native look.
    theme: 'none',
    // ready-made colour preset id for the Smart Notify PANEL itself
    // (the drawer opened from the wand menu). 'default' = follow ST theme
    // (translucent, blurred). Any other id paints a solid, opaque panel.
    panelTheme: 'default',
    // global mute by type
    muteTypes: { success: false, info: false, warning: false, error: false },
    // rules: [{ id, pattern, isRegex, type, action ('mute'|'allow'|'rewrite'), replacement, enabled, hits }]
    rules: [],
    // appearance
    appearance: {
        override: false,
        position: 'toast-top-right', // toastr position class
        customPosition: null,        // {x, y} px from top-left when position === 'custom'
        width: 320,                  // px
        fontSize: 14,                // px
        duration: 5000,             // ms (timeOut)
        extendedDuration: 1000,     // ms (extendedTimeOut, hover)
        opacity: 1,
        // color/theme override
        colorOverride: false,
        bgColor: '#1e1e26',
        textColor: '#e8e8ea',
        borderColor: '#6c8cff',
        borderWidth: 1,             // px
        borderRadius: 8,            // px
    },
    // anti-spam
    rateLimit: {
        dedupeBurst: true,          // collapse identical toasts fired within window
        dedupeWindow: 3000,         // ms
        groupRepeats: true,         // show a ×N counter instead of fully dropping
        throttle: false,            // cap total toasts within a window
        throttleMax: 5,             // max toasts...
        throttleWindow: 5000,       // ...per this many ms
    },
    // console CAPTURE: pull the detailed browser-console output (the full
    // error behind a terse toast) INTO the Smart Notify log.
    consoleCapture: {
        enabled: false,             // intercept window.console.*
        levels: {                   // which console methods to capture
            error: true,
            warn: true,
            info: false,
            log: false,
            debug: false,
        },
        ignoreOwn: true,            // skip our own [Smart Notify] lines (avoid loops)
        maxLen: 4000,               // truncate very long console payloads
    },
    // log
    logLimit: 200,
    // UI
    autoOpenOnNew: false,
};

/** Deep-merge saved settings over defaults. Unknown keys (at any depth that
 *  corresponds to a plain object in defaults) are preserved for forward-compat. */
export function mergeSettings(defaults, saved) {
    const out = Array.isArray(defaults) ? [] : {};
    for (const k in defaults) {
        if (!Object.prototype.hasOwnProperty.call(defaults, k)) continue;
        const dv = defaults[k];
        const sv = saved ? saved[k] : undefined;
        if (dv && typeof dv === 'object' && !Array.isArray(dv)) {
            out[k] = mergeSettings(dv, (sv && typeof sv === 'object') ? sv : {});
        } else {
            out[k] = (sv !== undefined) ? sv : dv;
        }
    }
    // keep any extra saved keys (forward-compat) for plain objects at any depth
    if (saved && typeof saved === 'object' && !Array.isArray(saved) && !Array.isArray(defaults)) {
        for (const k in saved) {
            if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = saved[k];
        }
    }
    return out;
}

let _extensionSettings = null;
let _saveSettingsDebounced = null;

export function initSettings(context) {
    _extensionSettings = context.extensionSettings;
    _saveSettingsDebounced = context.saveSettingsDebounced;
    return getSettings();
}

export function getSettings() {
    _extensionSettings[MODULE_NAME] = mergeSettings(defaultSettings, _extensionSettings[MODULE_NAME]);
    return _extensionSettings[MODULE_NAME];
}

export function save() {
    if (_saveSettingsDebounced) _saveSettingsDebounced();
}
