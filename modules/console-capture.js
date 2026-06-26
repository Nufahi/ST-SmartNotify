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

// ---------------------------------------------------------------------
// Burst guard (circuit breaker).
// A flood of console.* calls (e.g. an API retry loop) used to be captured
// one-by-one: each line was JSON.stringify'd, pushed to the log and triggered
// a full UI re-render. That could pin a CPU core, leak memory and freeze/crash
// the tab. We cap how many lines we capture per sliding window; once tripped,
// capture is paused for a cooldown and a single summary line is logged.
// The original console output is NEVER suppressed — only OUR capture is.
// ---------------------------------------------------------------------
const BURST_WINDOW_MS = 1000;   // sliding window
const BURST_MAX = 40;           // max captured lines per window before tripping
const BURST_COOLDOWN_MS = 5000; // pause capture this long after tripping
let burstCount = 0;
let burstWindowStart = 0;
let burstTrippedUntil = 0;
let burstDropped = 0;

// Hard ceilings so a single huge object can't lock the main thread.
const STRINGIFY_MAX_DEPTH = 4;
const STRINGIFY_MAX_KEYS = 100;
const STRINGIFY_MAX_ARR = 100;

// Guard against circular refs (and runaway size/depth) when stringifying
// console objects. Returns a replacer bound to a per-call depth map.
function jsonReplacer() {
    const seen = new WeakSet();
    const depths = new WeakMap();
    return function (key, value) {
        if (typeof value === 'function') return '[Function]';
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);

            // Track nesting depth via the parent (`this`) and bail out when too deep.
            const parentDepth = depths.has(this) ? depths.get(this) : 0;
            const myDepth = parentDepth + 1;
            depths.set(value, myDepth);
            if (myDepth > STRINGIFY_MAX_DEPTH) return '[Object: too deep]';

            // Cap very large arrays / objects so a giant payload can't lock the thread.
            if (Array.isArray(value)) {
                if (value.length > STRINGIFY_MAX_ARR) {
                    const out = value.slice(0, STRINGIFY_MAX_ARR);
                    out.push(`[+${value.length - STRINGIFY_MAX_ARR} more]`);
                    return out;
                }
                return value;
            }
            const keys = Object.keys(value);
            if (keys.length > STRINGIFY_MAX_KEYS) {
                const out = {};
                for (let i = 0; i < STRINGIFY_MAX_KEYS; i++) out[keys[i]] = value[keys[i]];
                out['[truncated]'] = `+${keys.length - STRINGIFY_MAX_KEYS} more keys`;
                return out;
            }
        }
        return value;
    };
}

function formatConsoleArgs(args) {
    const parts = [];
    for (const a of args) {
        if (a == null) { parts.push(String(a)); continue; }
        if (typeof a === 'string') { parts.push(a); continue; }
        const ta = typeof a;
        if (ta === 'number' || ta === 'boolean' || ta === 'bigint') { parts.push(String(a)); continue; }
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

/**
 * Returns true if capture should proceed, false if we're in a burst cooldown.
 * Maintains a sliding-window counter; trips a cooldown when the rate is too high.
 */
function burstAllows(now) {
    if (now < burstTrippedUntil) { burstDropped++; return false; }

    // Cooldown just ended — emit one summary line about what we skipped.
    if (burstDropped > 0 && now >= burstTrippedUntil) {
        const dropped = burstDropped;
        burstDropped = 0;
        burstCount = 0;
        burstWindowStart = now;
        // Use the ORIGINAL console so this note isn't recursively captured.
        try {
            (origConsole.warn || console.warn).call(
                console,
                `${LOG_PREFIX} console capture paused during burst — skipped ${dropped} line(s).`,
            );
        } catch (e) { /* noop */ }
        return true;
    }

    if (now - burstWindowStart > BURST_WINDOW_MS) {
        burstWindowStart = now;
        burstCount = 0;
    }
    if (++burstCount > BURST_MAX) {
        burstTrippedUntil = now + BURST_COOLDOWN_MS;
        burstDropped = 0;
        return false;
    }
    return true;
}

function captureConsole(level, args) {
    const settings = getSettings();
    const cc = settings.consoleCapture;
    if (!cc.enabled) return;
    if (!cc.levels[level]) return;

    // Circuit breaker: never let a console flood pin the CPU / freeze the tab.
    if (!burstAllows(Date.now())) return;

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
    // Reset the burst guard so re-enabling starts from a clean slate.
    burstCount = 0;
    burstWindowStart = 0;
    burstTrippedUntil = 0;
    burstDropped = 0;
}

// Turn capture on/off based on settings (called at init and from the UI).
export function syncConsoleCapture() {
    if (getSettings().consoleCapture.enabled) patchConsole();
    else unpatchConsole();
}

export function disposeConsole() {
    unpatchConsole();
}
