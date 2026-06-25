/* Notification log + listeners, with repeat-grouping support. */
import { getSettings } from './settings.js';

// entry: { id, type, title, message, text, time, blocked, ruleId, rewritten,
//          source?, consoleLevel?, count, lastTime, groupKey }
export const notifLog = [];
export const logListeners = new Set();

function notify() {
    logListeners.forEach((fn) => { try { fn(); } catch (e) { /* noop */ } });
}

function trim() {
    const settings = getSettings();
    const limit = Math.max(10, settings.logLimit | 0);
    if (notifLog.length > limit) notifLog.length = limit;
}

/** Build the dedupe key used both for grouping and anti-spam. */
export function groupKeyFor(entry) {
    const status = entry.blocked ? 'b' : 's';
    const src = entry.source === 'console' ? 'c' : 't';
    return `${src}\u0000${status}\u0000${entry.type}\u0000${entry.text || ''}`;
}

/**
 * Push a log entry. When repeat-grouping is enabled and the most recent entry
 * shares the same group key within the window, bump its ×N counter instead of
 * adding a new row (devtools-style collapsing).
 *
 * Returns true if an existing entry was incremented (i.e. the toast was a
 * grouped repeat), false if a brand-new entry was added.
 */
export function pushLog(entry, { groupWindow = 0 } = {}) {
    entry.count = entry.count || 1;
    entry.lastTime = entry.time;
    entry.groupKey = groupKeyFor(entry);

    if (groupWindow > 0 && notifLog.length) {
        const head = notifLog[0];
        if (head.groupKey === entry.groupKey && (entry.time - head.lastTime) <= groupWindow) {
            head.count = (head.count || 1) + 1;
            head.lastTime = entry.time;
            trim();
            notify();
            return true;
        }
    }

    notifLog.unshift(entry);
    trim();
    notify();
    return false;
}

export function clearLog() {
    notifLog.length = 0;
    notify();
}
