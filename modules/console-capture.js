/* Console capture: bring the detailed browser-console output into the log. */
import { LOG_PREFIX, uid } from './constants.js';
import { getSettings } from './settings.js';
import { pushLog } from './log.js';

// ---------------------------------------------------------------------
// Console CAPTURE: bring the detailed browser-console output into the log.
// ST often shows a terse toast ("API error") while the *full* details are
// printed via console.error/warn. We intercept window.console.* so those
// detailed lines appear in Smart Notify's Log panel.
// ---------------------------------------------------------------------
const CONSOLE_LEVELS = ['error', 'warn', 'info', 'log', 'debug'];
// map a console level to a toast-ish "type" for icon/colour reuse
const CONSOLE_TYPE = { error: 'error', warn: 'warning', info: 'info', log: 'info', debug: 'info' };
const origConsole = {};
let consolePatched = false;

// Guard against circular refs when stringifying console objects.
function jsonReplacer() {
    const seen = new WeakSet();
    return function (key, value) {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
        }
        if (typeof value === 'function') return '[Function]';
        return value;
    };
}

function formatConsoleArgs(args) {
    const parts = [];
    for (const a of args) {
        if (a == null) { parts.push(String(a)); continue; }
        if (typeof a === 'string') { parts.push(a); continue; }
        if (a instanceof Error) {
            parts.push(a.stack ? String(a.stack) : (a.name + ': ' + a.message));
            continue;
        }
        try {
            parts.push(JSON.stringify(a, jsonReplacer(), 2));
        } catch (e) {
            try { parts.push(String(a)); } catch (e2) { parts.push('[unserializable]'); }
        }
    }
    return parts.join(' ');
}

function captureConsole(level, args) {
    const settings = getSettings();
    const cc = settings.consoleCapture;
    if (!cc.enabled) return;
    if (!cc.levels[level]) return;

    let text = formatConsoleArgs(args);
    if (cc.ignoreOwn && text.indexOf(LOG_PREFIX) !== -1) return; // avoid feedback loops
    if (text.length > cc.maxLen) text = text.slice(0, cc.maxLen) + '\u2026 [truncated]';
    if (text.trim() === '') return;

    // First line acts as title, the rest as the detailed body.
    const nl = text.indexOf('\n');
    const title = nl === -1 ? text : text.slice(0, nl);
    const message = nl === -1 ? '' : text.slice(nl + 1);

    pushLog({
        id: uid(),
        source: 'console',
        consoleLevel: level,
        type: CONSOLE_TYPE[level] || 'info',
        title,
        message,
        text,
        time: Date.now(),
        blocked: false,
        ruleId: null,
        rewritten: false,
    }, { groupWindow: settings.rateLimit.groupRepeats ? settings.rateLimit.dedupeWindow : 0 });
}

function patchConsole() {
    if (consolePatched || typeof window.console === 'undefined') return;
    CONSOLE_LEVELS.forEach((level) => {
        const orig = window.console[level];
        if (typeof orig !== 'function') return;
        origConsole[level] = orig;
        window.console[level] = function (...args) {
            try { captureConsole(level, args); } catch (e) { /* never break logging */ }
            return orig.apply(this, args);
        };
    });
    consolePatched = true;
}

function unpatchConsole() {
    if (!consolePatched) return;
    CONSOLE_LEVELS.forEach((level) => {
        if (origConsole[level]) window.console[level] = origConsole[level];
    });
    consolePatched = false;
}

// Turn capture on/off based on settings (called at init and from the UI).
export function syncConsoleCapture() {
    if (getSettings().consoleCapture.enabled) patchConsole();
    else unpatchConsole();
}

export function disposeConsole() {
    unpatchConsole();
}
