/* ============================================================
 * I18N — lightweight translation layer.
 * Strings live in i18n/<lang>.json next to the extension root. The language
 * is auto-detected from SillyTavern's UI locale, falling back to navigator
 * language and finally to English. RU users get Russian, everyone else EN.
 * ============================================================ */
import { EXT_PATH, LOG_PREFIX } from './constants.js';

const I18N_FALLBACK = 'en';
const I18N_SUPPORTED = ['en', 'ru'];

let I18N_LANG = I18N_FALLBACK;
let I18N_STRINGS = {};
let I18N_FALLBACK_STRINGS = {};

function i18nDetectLang() {
    const candidates = [];
    try {
        const c = SillyTavern?.getContext?.();
        if (c) {
            if (typeof c.getCurrentLocale === 'function') candidates.push(c.getCurrentLocale());
            candidates.push(c?.powerUserSettings?.locale);
            candidates.push(c?.accountStorage?.getItem?.('language'));
        }
    } catch (e) { /* ignore */ }
    try { candidates.push(localStorage.getItem('language')); } catch (e) { /* ignore */ }
    try { candidates.push(navigator.language || navigator.userLanguage); } catch (e) { /* ignore */ }

    for (const raw of candidates) {
        if (typeof raw !== 'string' || !raw) continue;
        const lang = raw.toLowerCase().split(/[-_]/)[0];
        if (I18N_SUPPORTED.includes(lang)) return lang;
    }
    return I18N_FALLBACK;
}

export async function i18nLoad() {
    I18N_LANG = i18nDetectLang();
    // Load English first as the fallback so a missing key never surfaces a raw key.
    try {
        const res = await fetch(`/${EXT_PATH}/i18n/${I18N_FALLBACK}.json`);
        if (res.ok) I18N_FALLBACK_STRINGS = await res.json();
    } catch (e) {
        console.warn(`${LOG_PREFIX} i18n: failed to load fallback (${I18N_FALLBACK})`, e);
    }
    if (I18N_LANG === I18N_FALLBACK) {
        I18N_STRINGS = I18N_FALLBACK_STRINGS;
        return;
    }
    try {
        const res = await fetch(`/${EXT_PATH}/i18n/${I18N_LANG}.json`);
        if (res.ok) {
            I18N_STRINGS = await res.json();
        } else {
            I18N_STRINGS = I18N_FALLBACK_STRINGS;
            I18N_LANG = I18N_FALLBACK;
        }
    } catch (e) {
        console.warn(`${LOG_PREFIX} i18n: failed to load ${I18N_LANG}`, e);
        I18N_STRINGS = I18N_FALLBACK_STRINGS;
        I18N_LANG = I18N_FALLBACK;
    }
}

/** Translate a key, substituting {{var}} placeholders from params. Falls back
 *  to English, then to the raw key so missing strings stay visible. */
export function t(key, params) {
    let str = I18N_STRINGS[key];
    if (str === undefined) str = I18N_FALLBACK_STRINGS[key];
    if (str === undefined) return key;
    if (!params) return str;
    return str.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** Apply translations to a DOM subtree using data-i18n attributes:
 *    data-i18n="key"             -> textContent
 *    data-i18n-title="key"       -> title attribute
 *    data-i18n-placeholder="key" -> placeholder attribute
 *    data-i18n-aria-label="key"  -> aria-label attribute */
export function i18nApplyDom(root) {
    if (!root) return;
    root = root.jquery ? root[0] : root;
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    const attrs = [
        ['data-i18n-title', 'title'],
        ['data-i18n-placeholder', 'placeholder'],
        ['data-i18n-aria-label', 'aria-label'],
    ];
    for (const [dataAttr, realAttr] of attrs) {
        root.querySelectorAll(`[${dataAttr}]`).forEach((el) => {
            el.setAttribute(realAttr, t(el.getAttribute(dataAttr)));
        });
    }
}
